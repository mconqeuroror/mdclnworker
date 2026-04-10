import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import Stripe from "stripe";
import { recordReferralCommissionFromPayment } from "../services/referral.service.js";
import { deleteElevenLabsVoice } from "../services/elevenlabs.service.js";
import { purgeAllBlobAndR2ForUser } from "../utils/userStoragePurge.js";
import {
  inferSubscriptionCreditsFromAmount,
  normalizeCreditUnits,
  resolveSubscriptionBillingCycle,
} from "../utils/creditUnits.js";
import { rolloverSubPoolToPurchasedUpdate } from "../services/credit.service.js";
import {
  listVoiceHostingDueReport,
  runMonthlyVoiceBillingForUser,
  runMonthlyVoiceBillingForAllUsers,
} from "../services/voice-monthly-billing.service.js";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || process.env.TESTING_STRIPE_SECRET_KEY;

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia", timeout: 30_000, maxNetworkRetries: 1 })
  : null;

const PURCHASE_ID_PREFIX = "purchase_";

function encodePurchaseId(txId) {
  return `${PURCHASE_ID_PREFIX}${txId}`;
}

function decodePurchaseId(encoded) {
  if (!encoded || typeof encoded !== "string") return null;
  if (!encoded.startsWith(PURCHASE_ID_PREFIX)) return null;
  return encoded.slice(PURCHASE_ID_PREFIX.length);
}

function inferPurchaseBucket(tx) {
  const type = String(tx?.type || "").toLowerCase();
  const description = String(tx?.description || "").toLowerCase();
  if (type === "subscription" || description.includes("subscription")) {
    return "subscription";
  }
  return "purchased";
}

async function refundByPaymentSessionId(paymentSessionId, idempotencyKey = null) {
  if (!stripe) throw new Error("Stripe not configured");

  const sid = String(paymentSessionId || "").trim();
  if (!sid) throw new Error("Missing paymentSessionId");

  if (sid.startsWith("pi_")) {
    return await stripe.refunds.create(
      {
        payment_intent: sid,
        reason: "requested_by_customer",
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
  }

  if (sid.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(sid);
    if (session.payment_intent) {
      return await stripe.refunds.create(
        {
          payment_intent: String(session.payment_intent),
          reason: "requested_by_customer",
        },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
    }
    if (session.subscription) {
      const subId = String(session.subscription);
      const sub = await stripe.subscriptions.retrieve(subId, {
        expand: ["latest_invoice.payment_intent"],
      });
      const latestPi = sub.latest_invoice?.payment_intent;
      const latestPiId =
        typeof latestPi === "string"
          ? latestPi
          : typeof latestPi === "object"
            ? latestPi?.id
            : null;
      if (!latestPiId) throw new Error(`No refundable payment intent found for checkout session ${sid}`);
      return await stripe.refunds.create(
        {
          payment_intent: latestPiId,
          reason: "requested_by_customer",
        },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
    }
    throw new Error(`No payment intent or subscription found for checkout session ${sid}`);
  }

  if (sid.startsWith("in_")) {
    const invoice = await stripe.invoices.retrieve(sid);
    const pi = invoice.payment_intent;
    const piId = typeof pi === "string" ? pi : typeof pi === "object" ? pi?.id : null;
    if (!piId) throw new Error(`No payment intent found for invoice ${sid}`);
    return await stripe.refunds.create(
      {
        payment_intent: piId,
        reason: "requested_by_customer",
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
  }

  if (sid.startsWith("sub_")) {
    const sub = await stripe.subscriptions.retrieve(sid, {
      expand: ["latest_invoice.payment_intent"],
    });
    const latestPi = sub.latest_invoice?.payment_intent;
    const latestPiId =
      typeof latestPi === "string"
        ? latestPi
        : typeof latestPi === "object"
          ? latestPi?.id
          : null;
    if (!latestPiId) throw new Error(`No refundable payment intent found for subscription ${sid}`);
    const refund = await stripe.refunds.create(
      {
        payment_intent: latestPiId,
        reason: "requested_by_customer",
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (["active", "trialing", "past_due"].includes(sub.status)) {
      await stripe.subscriptions.update(sid, { cancel_at_period_end: true });
    }
    return refund;
  }

  throw new Error(`Unsupported Stripe paymentSessionId format: ${sid}`);
}

async function deductUserCreditsForPurchaseRefund(tx, userId, amount, bucket) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, subscriptionCredits: true, purchasedCredits: true, credits: true },
  });
  if (!user) throw new Error("User not found");

  let sub = user.subscriptionCredits || 0;
  let purchased = user.purchasedCredits || 0;
  let legacy = user.credits || 0;
  let remaining = Math.max(0, amount || 0);
  let deducted = 0;

  const apply = (pool) => {
    if (remaining <= 0) return;
    if (pool === "subscription") {
      const used = Math.min(sub, remaining);
      sub -= used;
      remaining -= used;
      deducted += used;
      return;
    }
    if (pool === "purchased") {
      const used = Math.min(purchased, remaining);
      purchased -= used;
      remaining -= used;
      deducted += used;
      return;
    }
    const used = Math.min(legacy, remaining);
    legacy -= used;
    remaining -= used;
    deducted += used;
  };

  if (bucket === "subscription") {
    apply("subscription");
    apply("purchased");
    apply("legacy");
  } else {
    apply("purchased");
    apply("legacy");
    apply("subscription");
  }

  await tx.user.update({
    where: { id: userId },
    data: {
      subscriptionCredits: sub,
      purchasedCredits: purchased,
      credits: legacy,
    },
  });

  return { deducted, shortfall: Math.max(0, remaining), balances: { sub, purchased, legacy } };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Usage-based revenue: 1 credit spent ≈ $0.01 (1¢) */
const CREDIT_TO_USD = 0.01;

function getPeriodRange(period = "week", year = null, date = null, startDate = null, endDate = null) {
  const now = new Date();
  const p = String(period || "week").toLowerCase();

  // Custom inclusive date range (YYYY-MM-DD) — daily tracking & metrics for span
  if (p === "range" && startDate && endDate) {
    const s = new Date(String(startDate));
    const e = new Date(String(endDate));
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      const start = startOfDay(s <= e ? s : e);
      const end = endOfDay(e >= s ? e : s);
      return { start, end, label: `range_${dayKey(start)}_${dayKey(end)}` };
    }
  }

  // Specific calendar day from daily tracking (YYYY-MM-DD)
  if (p === "date" && date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      return { start: startOfDay(d), end: endOfDay(d), label: `date_${date}` };
    }
  }

  if (p === "day") {
    return { start: startOfDay(now), end: endOfDay(now), label: "today" };
  }

  if (p === "week") {
    const start = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    return { start, end: endOfDay(now), label: "last_7_days" };
  }

  if (p === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    return { start, end: endOfDay(now), label: "this_month" };
  }

  const selectedYear = Number.isFinite(parseInt(year, 10)) ? parseInt(year, 10) : now.getFullYear();
  const start = new Date(selectedYear, 0, 1);
  start.setHours(0, 0, 0, 0);
  const end = selectedYear === now.getFullYear()
    ? endOfDay(now)
    : new Date(selectedYear, 11, 31, 23, 59, 59, 999);

  return { start, end, label: `year_${selectedYear}`, selectedYear };
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function isVideoGenerationType(type) {
  const t = String(type || "").toLowerCase();
  if (!t) return false;
  return t.includes("video") || t === "talking-head" || t === "face-swap";
}

function normalizeSubscriptionStatus(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return "cancelled";
  return s === "canceled" ? "cancelled" : s;
}

function inferTierFromSubscription(subscription, fallbackTier = null) {
  const metaTier = subscription?.metadata?.tierId || subscription?.metadata?.tier;
  if (metaTier && typeof metaTier === "string") return metaTier.toLowerCase();

  const priceIds = (subscription?.items?.data || [])
    .map((item) => String(item?.price?.id || "").toLowerCase())
    .filter(Boolean);
  const nicknames = (subscription?.items?.data || [])
    .map((item) => String(item?.price?.nickname || "").toLowerCase())
    .filter(Boolean);

  const text = [...priceIds, ...nicknames].join(" ");
  if (text.includes("business")) return "business";
  if (text.includes("pro")) return "pro";
  if (text.includes("starter")) return "starter";
  return fallbackTier || null;
}

function inferBillingCycleFromSubscription(subscription, fallbackBilling = null) {
  const interval = subscription?.items?.data?.[0]?.price?.recurring?.interval;
  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return fallbackBilling || null;
}

function pickBestSubscription(subscriptions = []) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return null;
  const rank = {
    active: 0,
    trialing: 1,
    past_due: 2,
    unpaid: 3,
    incomplete: 4,
    cancelled: 5,
    canceled: 5,
    incomplete_expired: 6,
  };

  return [...subscriptions].sort((a, b) => {
    const ra = rank[String(a?.status || "").toLowerCase()] ?? 99;
    const rb = rank[String(b?.status || "").toLowerCase()] ?? 99;
    if (ra !== rb) return ra - rb;
    return (b?.created || 0) - (a?.created || 0);
  })[0];
}

function parseSourceFromPaymentSessionId(paymentSessionId) {
  const sourceId = String(paymentSessionId || "").trim();
  if (!sourceId) return null;
  if (sourceId.startsWith("cs_")) return { sourceType: "stripe_checkout_session", sourceId };
  if (sourceId.startsWith("pi_")) return { sourceType: "stripe_payment_intent", sourceId };
  if (sourceId.startsWith("in_")) return { sourceType: "stripe_invoice", sourceId };
  if (sourceId.startsWith("sub_")) return { sourceType: "stripe_subscription", sourceId };
  return null;
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function subscriptionCreditsExpireAtFromInvoice(invoice, billingCycle) {
  const periodEndSec = invoice?.lines?.data?.[0]?.period?.end ?? invoice?.period_end;
  if (periodEndSec && typeof periodEndSec === "number") {
    const d = new Date(periodEndSec * 1000);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const fallback = new Date();
  if (billingCycle === "annual") fallback.setFullYear(fallback.getFullYear() + 1);
  else fallback.setMonth(fallback.getMonth() + 1);
  return fallback;
}

async function collectMissingRefillInvoices({
  days = 90,
  userId = null,
  email = null,
}) {
  if (!stripe) throw new Error("Stripe not configured");

  const startedAt = Date.now();
  const sinceSec = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
  const userWhere = { stripeCustomerId: { not: null } };
  if (userId) userWhere.id = userId;
  if (email) userWhere.email = { equals: String(email).trim(), mode: "insensitive" };

  const users = [];
  const USER_BATCH_SIZE = 500;
  let userBatchesScanned = 0;
  let cursorId = null;
  while (true) {
    const batch = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        email: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        subscriptionTier: true,
        subscriptionBillingCycle: true,
        subscriptionStatus: true,
      },
      orderBy: { id: "asc" },
      take: USER_BATCH_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    users.push(...batch);
    userBatchesScanned += 1;
    cursorId = batch[batch.length - 1].id;
  }

  const findings = [];
  const errors = [];
  const seenInvoiceIds = new Set();
  let subscriptionsScanned = 0;
  let invoicesScanned = 0;
  let invoicesPaidPositive = 0;
  let invoicesRefundSkipped = 0;
  let invoicesUnsupportedReasonSkipped = 0;
  let invoicesAlreadyCreditedSkipped = 0;

  for (const user of users) {
    try {
      let subs = [];
      if (user.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
          if (sub) subs.push(sub);
        } catch (err) {
          if (err?.code !== "resource_missing") throw err;
        }
      }
      if (subs.length === 0 && user.stripeCustomerId) {
        const listed = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: "all",
          limit: 20,
        });
        subs = listed?.data || [];
      }

      for (const sub of subs) {
        const subscriptionId = sub?.id;
        if (!subscriptionId) continue;
        subscriptionsScanned += 1;
        const invoices = await stripe.invoices.list({
          subscription: subscriptionId,
          status: "paid",
          created: { gte: sinceSec },
          limit: 100,
        });

        for (const invoice of invoices?.data || []) {
          if (!invoice?.id || seenInvoiceIds.has(invoice.id)) continue;
          seenInvoiceIds.add(invoice.id);
          invoicesScanned += 1;

          const paidAmountCents = parseInt(String(invoice.amount_paid || 0), 10) || 0;
          if (paidAmountCents <= 0) continue;
          invoicesPaidPositive += 1;
          if (await invoiceHasRefundActivity(invoice)) {
            invoicesRefundSkipped += 1;
            continue;
          }
          const billingReason = String(invoice.billing_reason || "");
          if (!["subscription_cycle", "subscription_create"].includes(billingReason)) {
            invoicesUnsupportedReasonSkipped += 1;
            continue;
          }

          const existingCreditTx = await prisma.creditTransaction.findFirst({
            where: { paymentSessionId: invoice.id },
            select: { id: true, createdAt: true, amount: true },
          });
          if (existingCreditTx) {
            invoicesAlreadyCreditedSkipped += 1;
            continue;
          }

          const billingCycle = resolveSubscriptionBillingCycle(sub);
          const inferredCredits = inferSubscriptionCreditsFromAmount(
            invoice.subtotal_excluding_tax || invoice.subtotal || invoice.amount_paid || invoice.amount_due || 0,
            billingCycle,
          );
          const metadataCredits = normalizeCreditUnits(sub.metadata?.credits);
          const effectiveCredits = metadataCredits || inferredCredits || 0;

          findings.push({
            invoiceId: invoice.id,
            subscriptionId,
            stripeCustomerId:
              (typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id) ||
              user.stripeCustomerId ||
              null,
            user: {
              id: user.id,
              email: user.email,
              subscriptionStatus: user.subscriptionStatus,
              subscriptionTier: user.subscriptionTier,
              subscriptionBillingCycle: user.subscriptionBillingCycle,
            },
            amountPaidCents: paidAmountCents,
            currency: invoice.currency || "usd",
            billingReason,
            paidAt: invoice.status_transitions?.paid_at
              ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
              : null,
            createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
            metadataTierId: sub.metadata?.tierId || null,
            billingCycle,
            expectedCredits: effectiveCredits,
            creditsSource: metadataCredits ? "subscription_metadata" : inferredCredits ? "amount_inference" : "unknown",
          });
        }
      }
    } catch (error) {
      errors.push({
        userId: user.id,
        email: user.email,
        message: error?.message || String(error),
      });
    }
  }

  findings.sort((a, b) => {
    const aTs = new Date(a.createdAt || 0).getTime();
    const bTs = new Date(b.createdAt || 0).getTime();
    return bTs - aTs;
  });

  return {
    scannedUsers: users.length,
    progress: {
      userBatchSize: USER_BATCH_SIZE,
      userBatchesScanned,
      usersMatched: users.length,
      usersProcessed: users.length,
      subscriptionsScanned,
      invoicesScanned,
      invoicesPaidPositive,
      invoicesRefundSkipped,
      invoicesUnsupportedReasonSkipped,
      invoicesAlreadyCreditedSkipped,
      missingInvoicesFound: findings.length,
      userErrors: errors.length,
      durationMs: Date.now() - startedAt,
    },
    findings,
    errors,
  };
}

async function invoiceHasRefundActivity(invoice) {
  if (!stripe || !invoice) return false;

  const paymentIntentId =
    typeof invoice.payment_intent === "string"
      ? invoice.payment_intent
      : invoice.payment_intent?.id || null;

  if (paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["charges.data.refunds"],
      });
      const charges = paymentIntent?.charges?.data || [];
      for (const charge of charges) {
        if ((charge?.amount_refunded || 0) > 0 || charge?.refunded === true) {
          return true;
        }
        const refunds = charge?.refunds?.data || [];
        if (
          refunds.some(
            (r) =>
              (r?.amount || 0) > 0 &&
              !["failed", "canceled"].includes(String(r?.status || "").toLowerCase()),
          )
        ) {
          return true;
        }
      }
    } catch (error) {
      // Fail-safe: if we cannot verify refund state, do not treat invoice as reconcilable.
      console.warn(
        `[admin-refill-audit] refund check failed for payment_intent ${paymentIntentId}:`,
        error?.message,
      );
      return true;
    }
  }

  const chargeId = typeof invoice.charge === "string" ? invoice.charge : null;
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId, { expand: ["refunds"] });
      if ((charge?.amount_refunded || 0) > 0 || charge?.refunded === true) return true;
      const refunds = charge?.refunds?.data || [];
      if (
        refunds.some(
          (r) =>
            (r?.amount || 0) > 0 &&
            !["failed", "canceled"].includes(String(r?.status || "").toLowerCase()),
        )
      ) {
        return true;
      }
    } catch (error) {
      console.warn(
        `[admin-refill-audit] refund check failed for charge ${chargeId}:`,
        error?.message,
      );
      return true;
    }
  }

  return false;
}

async function reconcileMissingRefillInvoice(invoiceId) {
  if (!stripe) throw new Error("Stripe not configured");

  const invoice = await stripe.invoices.retrieve(invoiceId);
  const paidAmountCents = parseInt(String(invoice?.amount_paid || 0), 10) || 0;
  if (paidAmountCents <= 0) {
    return { status: "skipped", reason: "invoice_not_paid", invoiceId };
  }
  if (await invoiceHasRefundActivity(invoice)) {
    return { status: "skipped", reason: "invoice_refunded", invoiceId };
  }

  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || null;
  if (!subscriptionId) {
    return { status: "skipped", reason: "missing_subscription_id", invoiceId };
  }

  const billingReason = String(invoice.billing_reason || "");
  if (!["subscription_cycle", "subscription_create"].includes(billingReason)) {
    return { status: "skipped", reason: `unsupported_billing_reason:${billingReason || "unknown"}`, invoiceId };
  }

  const existingTx = await prisma.creditTransaction.findFirst({
    where: { paymentSessionId: invoiceId },
    select: { id: true },
  });
  if (existingTx) {
    return { status: "already_processed", invoiceId };
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const billingCycle = resolveSubscriptionBillingCycle(subscription);

  const inferredCredits = inferSubscriptionCreditsFromAmount(
    invoice.subtotal_excluding_tax || invoice.subtotal || invoice.amount_paid || invoice.amount_due || 0,
    billingCycle,
  );
  const metadataCredits = normalizeCreditUnits(subscription.metadata?.credits);
  let parsedCredits = metadataCredits || inferredCredits || 0;

  if (!parsedCredits) {
    const firstGrant = await prisma.creditTransaction.findFirst({
      where: { paymentSessionId: subscriptionId, amount: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      select: { amount: true },
    });
    parsedCredits = firstGrant?.amount || 0;
  }

  if (!parsedCredits) {
    return { status: "skipped", reason: "unable_to_resolve_credits", invoiceId, subscriptionId };
  }

  const stripeCustomerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || null;

  let user = await prisma.user.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: {
      id: true,
      email: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      subscriptionBillingCycle: true,
    },
  });

  if (!user) {
    const metadataUserId = subscription.metadata?.userId || null;
    if (metadataUserId) {
      user = await prisma.user.findUnique({
        where: { id: metadataUserId },
        select: {
          id: true,
          email: true,
          subscriptionTier: true,
          subscriptionStatus: true,
          subscriptionBillingCycle: true,
        },
      });
    }
  }

  if (!user && stripeCustomerId) {
    user = await prisma.user.findFirst({
      where: { stripeCustomerId },
      select: {
        id: true,
        email: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionBillingCycle: true,
      },
    });
  }

  if (!user) {
    return { status: "skipped", reason: "user_not_found_for_invoice", invoiceId, subscriptionId };
  }

  const resolvedTierId = subscription.metadata?.tierId || user.subscriptionTier || "starter";
  const creditsExpireAt = subscriptionCreditsExpireAtFromInvoice(invoice, billingCycle);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          amount: parsedCredits,
          type: "purchase",
          description: `Subscription renewal reconcile: ${resolvedTierId}`,
          paymentSessionId: invoiceId,
        },
      });

      const prior = await tx.user.findUnique({
        where: { id: user.id },
        select: { subscriptionCredits: true },
      });
      const rollover = rolloverSubPoolToPurchasedUpdate(prior?.subscriptionCredits);

      await tx.user.update({
        where: { id: user.id },
        data: {
          ...rollover,
          stripeSubscriptionId: subscriptionId,
          subscriptionTier: resolvedTierId,
          subscriptionStatus: "active",
          subscriptionBillingCycle: billingCycle,
          subscriptionCredits: parsedCredits,
          creditsExpireAt,
        },
      });
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return { status: "already_processed", invoiceId };
    }
    throw error;
  }

  await recordReferralCommissionFromPayment({
    referredUserId: user.id,
    purchaseAmountCents: paidAmountCents,
    sourceType: "stripe_invoice",
    sourceId: invoiceId,
  }).catch((err) => {
    console.warn(`[admin-refill-reconcile] referral commission record failed for invoice ${invoiceId}:`, err?.message);
  });

  return {
    status: "reconciled",
    invoiceId,
    subscriptionId,
    userId: user.id,
    email: user.email,
    credits: parsedCredits,
    amountPaidCents: paidAmountCents,
  };
}

export async function auditSubscriptionRefills(req, res) {
  try {
    if (!stripe) {
      return res.status(503).json({ success: false, message: "Stripe not configured" });
    }

    const days = clampInt(req.body?.days ?? req.query?.days, 90, 1, 365);
    const userId = req.body?.userId || req.query?.userId || null;
    const email = req.body?.email || req.query?.email || null;

    const { scannedUsers, progress, findings, errors } = await collectMissingRefillInvoices({
      days,
      userId,
      email,
    });

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "audit_subscription_refills",
        targetType: "stripe_subscription_refills",
        detailsJson: JSON.stringify({
          days,
          userId: userId || null,
          email: email || null,
          scannedUsers,
          progress,
          findings: findings.length,
          errors: errors.length,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      summary: {
        days,
        scannedUsers,
        missingRefills: findings.length,
        errors: errors.length,
        progress,
      },
      findings,
      errors,
    });
  } catch (error) {
    console.error("Audit subscription refills error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to audit subscription refills",
    });
  }
}

export async function reconcileSubscriptionRefills(req, res) {
  try {
    if (!stripe) {
      return res.status(503).json({ success: false, message: "Stripe not configured" });
    }

    const dryRun = String(req.body?.dryRun ?? req.query?.dryRun ?? "true").toLowerCase() !== "false";
    const days = clampInt(req.body?.days ?? req.query?.days, 90, 1, 365);
    const userId = req.body?.userId || req.query?.userId || null;
    const email = req.body?.email || req.query?.email || null;
    const requestedInvoiceIds = Array.isArray(req.body?.invoiceIds)
      ? req.body.invoiceIds.map((v) => String(v || "").trim()).filter((v) => v.startsWith("in_"))
      : [];

    let invoiceIds = requestedInvoiceIds;
    let sourceFindingsCount = 0;
    let sourceScanProgress = null;
    if (invoiceIds.length === 0) {
      const { findings, progress } = await collectMissingRefillInvoices({
        days,
        userId,
        email,
      });
      sourceScanProgress = progress;
      sourceFindingsCount = findings.length;
      invoiceIds = findings.map((f) => f.invoiceId).filter(Boolean);
    } else {
      sourceFindingsCount = invoiceIds.length;
    }

    const uniqueInvoiceIds = [...new Set(invoiceIds)];
    const results = [];
    const summary = {
      dryRun,
      requestedInvoices: uniqueInvoiceIds.length,
      sourceFindingsCount,
      sourceScanProgress,
      reconciled: 0,
      alreadyProcessed: 0,
      skipped: 0,
      failed: 0,
    };
    const processStartedAt = Date.now();

    for (const invoiceId of uniqueInvoiceIds) {
      try {
        if (dryRun) {
          const invoice = await stripe.invoices.retrieve(invoiceId);
          const paidAmountCents = parseInt(String(invoice?.amount_paid || 0), 10) || 0;
          const subscriptionId =
            typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || null;
          results.push({
            status: "dry_run_candidate",
            invoiceId,
            subscriptionId,
            amountPaidCents: paidAmountCents,
            billingReason: invoice.billing_reason || null,
          });
          summary.skipped += 1;
          continue;
        }

        const outcome = await reconcileMissingRefillInvoice(invoiceId);
        results.push(outcome);
        if (outcome.status === "reconciled") summary.reconciled += 1;
        else if (outcome.status === "already_processed") summary.alreadyProcessed += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        results.push({
          status: "failed",
          invoiceId,
          reason: error?.message || String(error),
        });
      }
    }

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: dryRun ? "reconcile_subscription_refills_dry_run" : "reconcile_subscription_refills_execute",
        targetType: "stripe_subscription_refills",
        detailsJson: JSON.stringify({
          days,
          userId: userId || null,
          email: email || null,
          ...summary,
          processingDurationMs: Date.now() - processStartedAt,
        }),
      },
    }).catch(() => {});

    summary.processingDurationMs = Date.now() - processStartedAt;

    return res.json({
      success: true,
      summary,
      results,
    });
  } catch (error) {
    console.error("Reconcile subscription refills error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to reconcile subscription refills",
    });
  }
}

async function resolveStripeAmountCentsFromSource({ sourceType, sourceId }) {
  if (!stripe || !sourceType || !sourceId) return 0;
  try {
    if (sourceType === "stripe_checkout_session") {
      const session = await stripe.checkout.sessions.retrieve(sourceId);
      let amount = session.amount_total || 0;
      if (!amount && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription), {
          expand: ["latest_invoice"],
        });
        amount = sub.latest_invoice?.amount_paid || sub.latest_invoice?.amount_due || 0;
      }
      return amount || 0;
    }
    if (sourceType === "stripe_payment_intent") {
      const pi = await stripe.paymentIntents.retrieve(sourceId);
      return pi.amount_received || pi.amount || 0;
    }
    if (sourceType === "stripe_invoice") {
      const invoice = await stripe.invoices.retrieve(sourceId);
      return invoice.amount_paid || invoice.amount_due || 0;
    }
    if (sourceType === "stripe_subscription") {
      const sub = await stripe.subscriptions.retrieve(sourceId, {
        expand: ["latest_invoice"],
      });
      return sub.latest_invoice?.amount_paid || sub.latest_invoice?.amount_due || 0;
    }
  } catch (error) {
    console.warn(`[referral-reconcile] Amount resolve failed for ${sourceType}:${sourceId}:`, error?.message);
    return 0;
  }
  return 0;
}

/**
 * Get all users with pagination
 */
export async function getAllUsers(req, res) {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } }
          ]
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          credits: true,
          subscriptionCredits: true,
          purchasedCredits: true,
          creditsExpireAt: true,
          totalCreditsUsed: true,
          maxModels: true,
          allowCustomLoraTrainingPhotos: true,
          premiumFeaturesUnlocked: true,
          isVerified: true,
          subscriptionTier: true,
          subscriptionStatus: true,
          proAccess: true,
          banLocked: true,
          createdAt: true,
          _count: {
            select: {
              generations: true,
              savedModels: true
            }
          }
        }
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      success: true,
      users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * Get user details by ID
 */
export async function getUserById(req, res) {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        generations: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        savedModels: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * List user purchases that can be refunded by admin
 */
export async function getUserPurchases(req, res) {
  try {
    const { id: userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, referredByUserId: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const purchases = await prisma.creditTransaction.findMany({
      where: {
        userId,
        amount: { gt: 0 },
        paymentSessionId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        amount: true,
        type: true,
        description: true,
        paymentSessionId: true,
        createdAt: true,
      },
    });

    const refundMarkers = purchases.map((p) => `admin_purchase_refund_for:${p.id}:`);
    const refundTxs = refundMarkers.length
      ? await prisma.creditTransaction.findMany({
          where: { userId, description: { in: refundMarkers } },
          select: { description: true, createdAt: true, paymentSessionId: true },
        })
      : [];
    const refundedByPurchaseId = new Map();
    for (const r of refundTxs) {
      const raw = String(r.description || "");
      const purchaseTxId = raw.replace("admin_purchase_refund_for:", "").replace(":", "");
      if (!purchaseTxId) continue;
      refundedByPurchaseId.set(purchaseTxId, {
        refundedAt: r.createdAt,
        refundSessionId: r.paymentSessionId || null,
      });
    }

    return res.json({
      success: true,
      user,
      purchases: purchases.map((p) => ({
        purchaseId: encodePurchaseId(p.id),
        txId: p.id,
        amountCredits: p.amount,
        type: p.type,
        description: p.description,
        paymentSessionId: p.paymentSessionId,
        createdAt: p.createdAt,
        refunded: refundedByPurchaseId.has(p.id),
        refundMeta: refundedByPurchaseId.get(p.id) || null,
      })),
    });
  } catch (error) {
    console.error("Get user purchases error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Refund a specific purchase for a user (Stripe + credit reversal + referral clawback)
 */
export async function refundUserPurchase(req, res) {
  try {
    const { id: userId, purchaseId } = req.params;
    const txId = decodePurchaseId(purchaseId);
    if (!txId) {
      return res.status(400).json({ success: false, message: "Invalid purchaseId" });
    }
    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe not configured" });
    }

    const purchaseTx = await prisma.creditTransaction.findFirst({
      where: {
        id: txId,
        userId,
        amount: { gt: 0 },
        paymentSessionId: { not: null },
      },
      select: {
        id: true,
        userId: true,
        amount: true,
        type: true,
        description: true,
        paymentSessionId: true,
        createdAt: true,
      },
    });
    if (!purchaseTx) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    const alreadyRefunded = await prisma.creditTransaction.findFirst({
      where: {
        userId,
        description: `admin_purchase_refund_for:${purchaseTx.id}:`,
      },
      select: { id: true },
    });
    if (alreadyRefunded) {
      return res.status(409).json({ success: false, message: "This purchase is already refunded" });
    }

    const lockKey = `admin_purchase_refund_lock_${purchaseTx.id}`;
    try {
      await prisma.creditTransaction.create({
        data: {
          userId,
          amount: 0,
          type: "refund",
          description: `admin_purchase_refund_lock_for:${purchaseTx.id}:pending`,
          paymentSessionId: lockKey,
        },
      });
    } catch (lockErr) {
      if (lockErr?.code === "P2002") {
        return res.status(409).json({
          success: false,
          message: "Refund already in progress for this purchase",
        });
      }
      throw lockErr;
    }

    let stripeRefund;
    try {
      stripeRefund = await refundByPaymentSessionId(
        purchaseTx.paymentSessionId,
        `admin_refund_purchase_${purchaseTx.id}`,
      );
    } catch (stripeErr) {
      await prisma.creditTransaction
        .deleteMany({ where: { paymentSessionId: lockKey } })
        .catch(() => {});
      throw stripeErr;
    }
    const bucket = inferPurchaseBucket(purchaseTx);

    let outcome;
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const deduction = await deductUserCreditsForPurchaseRefund(
          tx,
          userId,
          purchaseTx.amount,
          bucket,
        );

      await tx.creditTransaction.create({
        data: {
          userId,
          amount: -deduction.deducted,
          type: "refund",
          description: `admin_purchase_refund_for:${purchaseTx.id}:`,
          paymentSessionId: `admin_refund_${stripeRefund.id}`,
        },
      });

      const firstPurchase = await tx.creditTransaction.findFirst({
        where: {
          userId,
          amount: { gt: 0 },
          paymentSessionId: { not: null },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      let referralClawback = null;
      if (firstPurchase?.id === purchaseTx.id) {
        const firstCommission = await tx.referralCommission.findFirst({
          where: { referredUserId: userId },
          orderBy: { createdAt: "asc" },
          select: { id: true, referrerUserId: true, commissionCents: true },
        });

        if (firstCommission) {
          const clawbackCents = firstCommission.commissionCents || 0;
          if (clawbackCents > 0) {
            await tx.referralCommission.update({
              where: { id: firstCommission.id },
              data: { commissionCents: { decrement: clawbackCents } },
            });
          }

          await tx.creditTransaction.create({
            data: {
              userId: firstCommission.referrerUserId,
              amount: 0,
              type: "refund",
              description: `admin_referral_clawback:${firstCommission.id}:${purchaseTx.id}`,
              paymentSessionId: `admin_referral_clawback_${firstCommission.id}_${stripeRefund.id}`,
            },
          });

          const [rewardAgg, paidAgg] = await Promise.all([
            tx.referralCommission.aggregate({
              where: { referrerUserId: firstCommission.referrerUserId },
              _sum: { commissionCents: true },
            }),
            tx.referralPayoutRequest.aggregate({
              where: { userId: firstCommission.referrerUserId, status: "paid" },
              _sum: { amountCents: true },
            }),
          ]);

          referralClawback = {
            commissionId: firstCommission.id,
            referrerUserId: firstCommission.referrerUserId,
            clawbackCents,
            resultingEligibleCents:
              (rewardAgg._sum.commissionCents || 0) - (paidAgg._sum.amountCents || 0),
          };
        }
      }

      await tx.adminAuditLog.create({
        data: {
          adminUserId: req.user.userId,
          adminEmail: req.user.email || null,
          action: "refund_user_purchase",
          targetType: "credit_transaction",
          targetId: purchaseTx.id,
          detailsJson: JSON.stringify({
            purchaseTxId: purchaseTx.id,
            paymentSessionId: purchaseTx.paymentSessionId,
            stripeRefundId: stripeRefund.id,
            purchaseCredits: purchaseTx.amount,
            deductedCredits: deduction.deducted,
            shortfallCredits: deduction.shortfall,
            bucket,
            referralClawback,
          }),
        },
      });

        await tx.creditTransaction.deleteMany({
          where: { paymentSessionId: lockKey },
        });

        return { deduction, referralClawback };
      });
    } catch (dbErr) {
      // Stripe refund may have already succeeded. Persist a durable marker so this
      // can be safely reconciled and alerted without silent financial drift.
      await prisma.creditTransaction
        .upsert({
          where: { paymentSessionId: `admin_refund_reconcile_needed_${purchaseTx.id}` },
          create: {
            userId,
            amount: 0,
            type: "refund",
            description: `admin_refund_reconcile_needed_for:${purchaseTx.id}:stripe_refund_${stripeRefund?.id || "unknown"}`,
            paymentSessionId: `admin_refund_reconcile_needed_${purchaseTx.id}`,
          },
          update: {},
        })
        .catch(() => {});
      await prisma.creditTransaction
        .deleteMany({ where: { paymentSessionId: lockKey } })
        .catch(() => {});
      throw dbErr;
    }

    return res.json({
      success: true,
      message: "Purchase refunded successfully",
      refund: {
        stripeRefundId: stripeRefund.id,
        status: stripeRefund.status,
      },
      credits: {
        purchaseCredits: purchaseTx.amount,
        deducted: outcome.deduction.deducted,
        shortfall: outcome.deduction.shortfall,
      },
      referralClawback: outcome.referralClawback,
    });
  } catch (error) {
    console.error("Refund user purchase error:", error);
    const msg = error?.type === "StripeInvalidRequestError"
      ? `Stripe error: ${error.message}`
      : (error?.message || "Server error");
    return res.status(500).json({ success: false, message: msg });
  }
}

/**
 * Add credits to user
 */
export async function addCreditsToUser(req, res) {
  try {
    const { userId, credits, reason = 'Admin gift' } = req.body;

    if (!userId || !credits || credits <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userId or credits amount'
      });
    }

    // Add to purchasedCredits only (never expire) - legacy 'credits' field not used to prevent double-counting
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        purchasedCredits: { increment: parseInt(credits) }
      },
      select: {
        id: true,
        email: true,
        name: true,
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true
      }
    });

    const totalCredits = (user.subscriptionCredits || 0) + (user.purchasedCredits || 0) + (user.credits || 0);
    console.log(`✅ Admin ${req.user.email} added ${credits} credits to ${user.email}. Reason: ${reason}. Total now: ${totalCredits}`);

    try {
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.user.userId,
          action: "add_credits",
          targetType: "user",
          targetId: userId,
          detailsJson: JSON.stringify({ credits: parseInt(credits), reason, totalCredits }),
        },
      });
    } catch (auditErr) {
      console.error("⚠️ Audit log error:", auditErr.message);
    }

    res.json({
      success: true,
      message: `Added ${credits} credits to ${user.email}`,
      user
    });
  } catch (error) {
    console.error('Add credits error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * Update user settings (maxModels, etc.)
 */
export async function updateUserSettings(req, res) {
  try {
    const { userId, maxModels, allowCustomLoraTrainingPhotos, premiumFeaturesUnlocked, subscriptionTier, subscriptionStatus } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID required'
      });
    }

    const updateData = {};
    
    if (maxModels !== undefined) {
      const parsedMaxModels = parseInt(maxModels);
      if (isNaN(parsedMaxModels) || parsedMaxModels < 0) {
        return res.status(400).json({
          success: false,
          message: 'Max models must be a valid non-negative number'
        });
      }
      updateData.maxModels = parsedMaxModels;
    }

    if (allowCustomLoraTrainingPhotos !== undefined) {
      if (typeof allowCustomLoraTrainingPhotos !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "allowCustomLoraTrainingPhotos must be a boolean",
        });
      }
      updateData.allowCustomLoraTrainingPhotos = allowCustomLoraTrainingPhotos;
    }

    if (premiumFeaturesUnlocked !== undefined) {
      if (typeof premiumFeaturesUnlocked !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "premiumFeaturesUnlocked must be a boolean",
        });
      }
      updateData.premiumFeaturesUnlocked = premiumFeaturesUnlocked;
    }

    if (subscriptionTier !== undefined) {
      const validTiers = ["free", "starter", "pro", "business"];
      if (!validTiers.includes(subscriptionTier)) {
        return res.status(400).json({
          success: false,
          message: `subscriptionTier must be one of: ${validTiers.join(", ")}`,
        });
      }
      updateData.subscriptionTier = subscriptionTier;
    }

    if (subscriptionStatus !== undefined) {
      const validStatuses = ["active", "canceled", "cancelled", "past_due", "unpaid", "trialing", null];
      if (!validStatuses.includes(subscriptionStatus)) {
        return res.status(400).json({
          success: false,
          message: `subscriptionStatus must be one of: active, canceled, past_due, unpaid, trialing, or null`,
        });
      }
      updateData.subscriptionStatus = subscriptionStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid settings provided",
      });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        maxModels: true,
        allowCustomLoraTrainingPhotos: true,
        premiumFeaturesUnlocked: true,
        subscriptionTier: true,
        subscriptionStatus: true,
      }
    });

    const changeDetails = `maxModels=${updateData.maxModels ?? "unchanged"}, allowCustomLoraTrainingPhotos=${updateData.allowCustomLoraTrainingPhotos ?? "unchanged"}, premiumFeaturesUnlocked=${updateData.premiumFeaturesUnlocked ?? "unchanged"}, subscriptionTier=${updateData.subscriptionTier ?? "unchanged"}, subscriptionStatus=${updateData.subscriptionStatus ?? "unchanged"}`;
    console.log(`✅ Admin ${req.user.email} updated settings for ${user.email}. ${changeDetails}`);

    try {
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.user.userId,
          action: "update_user_settings",
          targetType: "user",
          targetId: userId,
          detailsJson: changeDetails,
        },
      });
    } catch (auditErr) {
      console.error("⚠️ Audit log error:", auditErr.message);
    }

    res.json({
      success: true,
      message: `User settings updated successfully`,
      user
    });
  } catch (error) {
    console.error('Update user settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(req, res) {
  try {
    const { period = "week", year, date, startDate, endDate } = req.query;
    const range = getPeriodRange(period, year, date, startDate, endDate);

    const rangeDays =
      (range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000) + 1;
    if (rangeDays > 366) {
      return res.status(400).json({
        success: false,
        message: "Date range cannot exceed 366 days",
      });
    }

    const [
      totalUsersInPeriod,
      verifiedUsersInPeriod,
      totalGenerationsInPeriod,
      creditsUsedInPeriodAgg,
      totalLegacyCredits,
      totalSubscriptionCredits,
      totalPurchasedCredits,
      periodUsersCreated,
      periodUsersPotentialOutflow,
      periodGenerations,
      allTimeTopUsers,
      earliestUser,
    ] = await Promise.all([
      prisma.user.count({
        where: { createdAt: { gte: range.start, lte: range.end } },
      }),
      prisma.user.count({
        where: {
          isVerified: true,
          createdAt: { gte: range.start, lte: range.end },
        },
      }),
      prisma.generation.count({
        where: { createdAt: { gte: range.start, lte: range.end } },
      }),
      prisma.generation.aggregate({
        where: { createdAt: { gte: range.start, lte: range.end } },
        _sum: { creditsCost: true },
      }),
      prisma.user.aggregate({ _sum: { credits: true } }),
      prisma.user.aggregate({ _sum: { subscriptionCredits: true } }),
      prisma.user.aggregate({ _sum: { purchasedCredits: true } }),
      prisma.user.findMany({
        where: { createdAt: { gte: range.start, lte: range.end } },
        select: { createdAt: true },
      }),
      prisma.user.findMany({
        where: {
          updatedAt: { gte: range.start, lte: range.end },
          subscriptionStatus: { in: ["canceled", "cancelled", "unpaid", "past_due"] },
        },
        select: { updatedAt: true },
      }),
      prisma.generation.findMany({
        where: { createdAt: { gte: range.start, lte: range.end } },
        select: { createdAt: true, type: true, creditsCost: true },
      }),
      prisma.user.findMany({
        where: {
          generations: {
            some: { createdAt: { gte: range.start, lte: range.end } }
          }
        },
        orderBy: { totalCreditsUsed: 'desc' },
        take: 10,
        select: {
          id: true,
          email: true,
          name: true,
          totalCreditsUsed: true,
          credits: true,
          subscriptionCredits: true,
          purchasedCredits: true,
          subscriptionTier: true,
          _count: { select: { generations: true } },
        },
      }),
      prisma.user.findFirst({
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    // Recent signups (last 7 days, global helper metric)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentSignups = await prisma.user.count({
      where: {
        createdAt: { gte: sevenDaysAgo }
      }
    });

    // Daily tracking series for selected period
    const dailyMap = new Map();
    const cursor = startOfDay(range.start);
    const rangeEnd = endOfDay(range.end);
    while (cursor <= rangeEnd) {
      const k = dayKey(cursor);
      dailyMap.set(k, {
        date: k,
        usersInflow: 0,
        usersOutflow: 0,
        imageGenerations: 0,
        videoGenerations: 0,
        creditsSpent: 0,
        estimatedRevenue: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const u of periodUsersCreated) {
      const k = dayKey(u.createdAt);
      if (dailyMap.has(k)) dailyMap.get(k).usersInflow += 1;
    }
    for (const u of periodUsersPotentialOutflow) {
      const k = dayKey(u.updatedAt);
      if (dailyMap.has(k)) dailyMap.get(k).usersOutflow += 1;
    }
    let videoGenerations = 0;
    let imageGenerations = 0;
    for (const g of periodGenerations) {
      const k = dayKey(g.createdAt);
      const isVideo = isVideoGenerationType(g.type);
      if (isVideo) videoGenerations += 1;
      else imageGenerations += 1;

      if (dailyMap.has(k)) {
        if (isVideo) dailyMap.get(k).videoGenerations += 1;
        else dailyMap.get(k).imageGenerations += 1;
        const spent = g.creditsCost || 0;
        dailyMap.get(k).creditsSpent += spent;
      }
    }

    const dailySeries = Array.from(dailyMap.values()).map((row) => ({
      ...row,
      estimatedRevenue: Number((row.creditsSpent * CREDIT_TO_USD).toFixed(2)),
    }));

    // Period totals
    const creditsUsedInPeriod = creditsUsedInPeriodAgg._sum.creditsCost || 0;
    const estimatedRevenue = Number((creditsUsedInPeriod * CREDIT_TO_USD).toFixed(2));
    const totalCreditsRemaining =
      (totalLegacyCredits._sum.credits || 0) +
      (totalSubscriptionCredits._sum.subscriptionCredits || 0) +
      (totalPurchasedCredits._sum.purchasedCredits || 0);

    const earliestYear = earliestUser?.createdAt
      ? new Date(earliestUser.createdAt).getFullYear()
      : new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    const availableYears = [];
    for (let y = currentYear; y >= earliestYear; y -= 1) {
      availableYears.push(y);
    }

    res.json({
      success: true,
      stats: {
        period: {
          key: String(period || "week"),
          start: range.start,
          end: range.end,
          selectedYear: range.selectedYear || null,
          availableYears,
        },
        users: {
          total: totalUsersInPeriod,
          verified: verifiedUsersInPeriod,
          recentSignups
        },
        generations: {
          total: totalGenerationsInPeriod,
          images: imageGenerations || 0,
          videos: videoGenerations || 0
        },
        credits: {
          totalUsed: creditsUsedInPeriod,
          totalRemaining: totalCreditsRemaining,
          estimatedRevenue: estimatedRevenue.toFixed(2)
        },
        topUsers: allTimeTopUsers,
        dailySeries,
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * Delete/ban user
 */
export async function deleteUser(req, res) {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own admin account'
      });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (stripe && user.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(user.stripeSubscriptionId);
        console.log(`🔴 Cancelled Stripe subscription ${user.stripeSubscriptionId} for user ${user.email}`);
      } catch (stripeErr) {
        if (stripeErr.code === 'resource_missing') {
          console.log(`ℹ️ Stripe subscription ${user.stripeSubscriptionId} already cancelled/missing`);
        } else {
          console.warn(`⚠️ Failed to cancel Stripe subscription for ${user.email}:`, stripeErr.message);
        }
      }
    }

    try {
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.user.userId,
          adminEmail: req.user.email,
          action: "delete_user",
          targetType: "user",
          targetId: id,
          detailsJson: JSON.stringify({ email: user.email, name: user.name }),
        },
      });
    } catch (auditErr) {
      console.error("⚠️ Audit log error:", auditErr.message);
    }

    const voiceIdSet = new Set();
    const modelsForVoices = await prisma.savedModel.findMany({
      where: { userId: id },
      select: { elevenLabsVoiceId: true },
    });
    const modelVoicesRows = await prisma.modelVoice.findMany({
      where: { userId: id },
      select: { elevenLabsVoiceId: true },
    });
    for (const m of modelsForVoices) {
      if (m.elevenLabsVoiceId) voiceIdSet.add(m.elevenLabsVoiceId);
    }
    for (const m of modelVoicesRows) {
      if (m.elevenLabsVoiceId) voiceIdSet.add(m.elevenLabsVoiceId);
    }
    for (const vid of voiceIdSet) {
      try {
        await deleteElevenLabsVoice(vid);
      } catch (_) { /* best-effort */ }
    }

    await purgeAllBlobAndR2ForUser(id);

    await prisma.user.delete({ where: { id } });

    console.log(`✅ Admin ${req.user.email} deleted user ${user.email} (storage + ElevenLabs cleaned)`);

    res.json({
      success: true,
      message: `User ${user.email} deleted successfully`
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * Get recent activity
 */
export async function getRecentActivity(req, res) {
  try {
    const { limit = 20 } = req.query;

    const recentGenerations = await prisma.generation.findMany({
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });

    res.json({
      success: true,
      activity: recentGenerations
    });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function recoverPayment(req, res) {
  try {
    const { stripeId } = req.body;

    if (!stripeId || typeof stripeId !== "string") {
      return res.status(400).json({ success: false, message: "Provide a Stripe subscription ID (sub_...) or payment intent ID (pi_...)" });
    }

    if (!stripe) {
      return res.status(500).json({ success: false, message: "Stripe not configured" });
    }

    const trimmed = stripeId.trim();
    let result = {};

    if (trimmed.startsWith("sub_")) {
      const subscription = await stripe.subscriptions.retrieve(trimmed, {
        expand: ["latest_invoice.payment_intent"],
      });

      const { userId, tierId, credits: creditsStr } = subscription.metadata || {};
      if (!userId || !creditsStr) {
        return res.status(400).json({
          success: false,
          message: `Subscription ${trimmed} has no userId/credits in metadata. Metadata: ${JSON.stringify(subscription.metadata)}`,
        });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({ success: false, message: `User ${userId} not found in database` });
      }

      const billingCycle = resolveSubscriptionBillingCycle(subscription);
      const credits = normalizeCreditUnits(creditsStr);
      if (!credits) {
        return res.status(400).json({ success: false, message: `Invalid credits value in metadata: "${creditsStr}"` });
      }

      const existingTx = await prisma.creditTransaction.findUnique({
        where: { paymentSessionId: trimmed },
      });
      if (existingTx) {
        return res.json({
          success: true,
          alreadyProcessed: true,
          message: `Credits already awarded for subscription ${trimmed} on ${existingTx.createdAt.toISOString()}`,
          user: { email: user.email, id: user.id },
          credits,
        });
      }

      const paymentIntent = subscription.latest_invoice?.payment_intent;
      const piStatus = typeof paymentIntent === "object" ? paymentIntent.status : null;
      const subStatus = subscription.status;

      if (piStatus !== "succeeded" && !["active", "trialing"].includes(subStatus)) {
        return res.status(400).json({
          success: false,
          message: `Payment not confirmed. Subscription status: ${subStatus}, Payment intent status: ${piStatus || "unknown"}. Cannot recover.`,
        });
      }

      const now = new Date();
      const creditsExpireAt = new Date(now);
      if (billingCycle === "annual") {
        creditsExpireAt.setFullYear(creditsExpireAt.getFullYear() + 1);
      } else {
        creditsExpireAt.setMonth(creditsExpireAt.getMonth() + 1);
      }

      await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId,
            amount: credits,
            type: "subscription",
            description: `${(tierId || "unknown").charAt(0).toUpperCase() + (tierId || "unknown").slice(1)} subscription (${billingCycle || "monthly"}) — admin recovery`,
            paymentSessionId: trimmed,
          },
        });

        const prior = await tx.user.findUnique({
          where: { id: userId },
          select: { subscriptionCredits: true },
        });
        const rollover = rolloverSubPoolToPurchasedUpdate(prior?.subscriptionCredits);
        if (Object.keys(rollover).length) {
          console.log(
            `💾 admin-recovery: rolling ${prior?.subscriptionCredits || 0} existing subscription credits → purchased before overwrite`,
          );
        }

        await tx.user.update({
          where: { id: userId },
          data: {
            ...rollover,
            stripeSubscriptionId: trimmed,
            subscriptionTier: tierId || "starter",
            subscriptionStatus: "active",
            subscriptionBillingCycle: billingCycle || "monthly",
            subscriptionCredits: credits,
            creditsExpireAt,
            maxModels: 999,
          },
        });
      });

      result = {
        type: "subscription",
        credits,
        tierId: tierId || "starter",
        billingCycle,
        user: { email: user.email, id: user.id },
      };

    } else if (trimmed.startsWith("pi_")) {
      const paymentIntent = await stripe.paymentIntents.retrieve(trimmed);

      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({
          success: false,
          message: `Payment intent status is "${paymentIntent.status}" — not succeeded. Cannot recover.`,
        });
      }

      const { userId, credits: creditsStr, type } = paymentIntent.metadata || {};
      if (!userId || !creditsStr) {
        return res.status(400).json({
          success: false,
          message: `Payment intent ${trimmed} has no userId/credits in metadata. Metadata: ${JSON.stringify(paymentIntent.metadata)}`,
        });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({ success: false, message: `User ${userId} not found in database` });
      }

      const credits = normalizeCreditUnits(creditsStr);

      const existingTx = await prisma.creditTransaction.findUnique({
        where: { paymentSessionId: trimmed },
      });
      if (existingTx) {
        return res.json({
          success: true,
          alreadyProcessed: true,
          message: `Credits already awarded for PI ${trimmed} on ${existingTx.createdAt.toISOString()}`,
          user: { email: user.email, id: user.id },
          credits,
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId,
            amount: credits,
            type: "purchase",
            description: `${type || "one-time"} purchase: ${credits} credits — admin recovery`,
            paymentSessionId: trimmed,
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            purchasedCredits: { increment: credits },
          },
        });
      });

      result = {
        type: type || "one-time",
        credits,
        user: { email: user.email, id: user.id },
      };

    } else {
      return res.status(400).json({
        success: false,
        message: "ID must start with sub_ (subscription) or pi_ (payment intent)",
      });
    }

    console.log(`✅ Admin ${req.user.email} recovered payment ${trimmed}: ${JSON.stringify(result)}`);

    try {
      await prisma.adminAuditLog.create({
        data: {
          adminUserId: req.user.userId,
          action: "recover_payment",
          targetType: "user",
          targetId: result.user.id,
          detailsJson: JSON.stringify({ stripeId: trimmed, ...result }),
        },
      });
    } catch (auditErr) {
      console.error("⚠️ Audit log error:", auditErr.message);
    }

    res.json({
      success: true,
      message: `Recovered ${result.credits} credits for ${result.user.email}`,
      ...result,
    });
  } catch (error) {
    console.error("❌ Recover payment error:", error);
    const msg = error.type === "StripeInvalidRequestError"
      ? `Stripe error: ${error.message}`
      : "Server error during payment recovery";
    res.status(500).json({ success: false, message: msg });
  }
}

export async function syncUserStripeState(req, res) {
  try {
    if (!stripe) {
      return res.status(503).json({ success: false, message: "Stripe not configured" });
    }

    const { id: userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionBillingCycle: true,
      },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let customerId = user.stripeCustomerId || null;
    let candidateSubscriptions = [];

    if (!customerId && user.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 5 });
      const activeCustomer = (customers.data || []).find((c) => !c.deleted);
      customerId = activeCustomer?.id || null;
    }

    if (customerId) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
        expand: ["data.items.data.price"],
      });
      candidateSubscriptions = subscriptions?.data || [];
    } else if (user.stripeSubscriptionId) {
      try {
        const fallbackSub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
          expand: ["items.data.price"],
        });
        candidateSubscriptions = fallbackSub ? [fallbackSub] : [];
        if (!customerId && fallbackSub?.customer) {
          customerId = String(fallbackSub.customer);
        }
      } catch (error) {
        if (error?.code !== "resource_missing") throw error;
      }
    }

    const bestSub = pickBestSubscription(candidateSubscriptions);
    const normalizedStatus = normalizeSubscriptionStatus(bestSub?.status);
    const isActiveish = ["active", "trialing", "past_due", "unpaid"].includes(normalizedStatus);
    const cancelledAt = bestSub?.canceled_at
      ? new Date(bestSub.canceled_at * 1000)
      : null;
    const currentPeriodEnd = bestSub?.current_period_end
      ? new Date(bestSub.current_period_end * 1000)
      : null;

    const updateData = bestSub
      ? {
          stripeCustomerId: customerId || user.stripeCustomerId || null,
          stripeSubscriptionId: isActiveish ? bestSub.id : null,
          subscriptionStatus: normalizedStatus,
          subscriptionTier: isActiveish ? inferTierFromSubscription(bestSub, user.subscriptionTier) : null,
          subscriptionBillingCycle: isActiveish
            ? inferBillingCycleFromSubscription(bestSub, user.subscriptionBillingCycle)
            : null,
          creditsExpireAt: isActiveish ? currentPeriodEnd : null,
          subscriptionCancelledAt: !isActiveish ? (cancelledAt || new Date()) : null,
          ...(isActiveish ? {} : { subscriptionCredits: 0 }),
        }
      : {
          stripeCustomerId: customerId || user.stripeCustomerId || null,
          stripeSubscriptionId: null,
          subscriptionStatus: "cancelled",
          subscriptionTier: null,
          subscriptionBillingCycle: null,
          creditsExpireAt: null,
          subscriptionCancelledAt: new Date(),
          subscriptionCredits: 0,
        };

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        subscriptionTier: true,
        subscriptionBillingCycle: true,
        creditsExpireAt: true,
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "sync_user_stripe_state",
        targetType: "user",
        targetId: userId,
        detailsJson: JSON.stringify({
          stripeCustomerId: updatedUser.stripeCustomerId,
          stripeSubscriptionId: updatedUser.stripeSubscriptionId,
          subscriptionStatus: updatedUser.subscriptionStatus,
          subscriptionTier: updatedUser.subscriptionTier,
          subscriptionBillingCycle: updatedUser.subscriptionBillingCycle,
          subscriptionsFound: candidateSubscriptions.length,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: "Stripe state synced",
      user: updatedUser,
      stripe: {
        customerId: customerId || null,
        subscriptionsFound: candidateSubscriptions.length,
        selectedSubscriptionId: bestSub?.id || null,
      },
    });
  } catch (error) {
    console.error("Sync user Stripe state error:", error);
    const msg = error?.type === "StripeInvalidRequestError"
      ? `Stripe error: ${error.message}`
      : (error?.message || "Server error");
    return res.status(500).json({ success: false, message: msg });
  }
}

/**
 * Reconcile subscription state from Stripe for all users that have a Stripe customer or subscription ID.
 * Fetches current subscription from Stripe and updates our DB (status, tier, billing, creditsExpireAt).
 * Use after webhook gaps or to fix stuck memberships.
 */
export async function reconcileAllSubscriptions(req, res) {
  try {
    if (!stripe) {
      return res.status(503).json({ success: false, message: "Stripe not configured" });
    }

    const limit = Math.min(
      2000,
      Math.max(1, parseInt(req.body?.limit ?? req.query?.limit ?? "1000", 10) || 1000),
    );

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { stripeCustomerId: { not: null } },
          { stripeSubscriptionId: { not: null } },
        ],
      },
      take: limit,
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionBillingCycle: true,
      },
    });

    let updated = 0;
    const errors = [];

    for (const user of users) {
      try {
        let customerId = user.stripeCustomerId || null;
        let candidateSubscriptions = [];

        if (!customerId && user.email) {
          const customers = await stripe.customers.list({ email: user.email, limit: 5 });
          const activeCustomer = (customers.data || []).find((c) => !c.deleted);
          customerId = activeCustomer?.id || null;
        }

        if (customerId) {
          const list = await stripe.subscriptions.list({
            customer: customerId,
            status: "all",
            limit: 20,
            expand: ["data.items.data.price"],
          });
          candidateSubscriptions = list?.data || [];
        } else if (user.stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
              expand: ["items.data.price"],
            });
            candidateSubscriptions = sub ? [sub] : [];
            if (!customerId && sub?.customer) customerId = String(sub.customer);
          } catch (e) {
            if (e?.code === "resource_missing") candidateSubscriptions = [];
            else throw e;
          }
        }

        const bestSub = pickBestSubscription(candidateSubscriptions);
        const normalizedStatus = normalizeSubscriptionStatus(bestSub?.status);
        const isActiveish = ["active", "trialing", "past_due", "unpaid"].includes(normalizedStatus);
        const cancelledAt = bestSub?.canceled_at ? new Date(bestSub.canceled_at * 1000) : null;
        const currentPeriodEnd = bestSub?.current_period_end
          ? new Date(bestSub.current_period_end * 1000)
          : null;

        const updateData = bestSub
          ? {
              stripeCustomerId: customerId || user.stripeCustomerId || null,
              stripeSubscriptionId: isActiveish ? bestSub.id : null,
              subscriptionStatus: normalizedStatus,
              subscriptionTier: isActiveish ? inferTierFromSubscription(bestSub, user.subscriptionTier) : null,
              subscriptionBillingCycle: isActiveish
                ? inferBillingCycleFromSubscription(bestSub, user.subscriptionBillingCycle)
                : null,
              creditsExpireAt: isActiveish ? currentPeriodEnd : null,
              subscriptionCancelledAt: !isActiveish ? (cancelledAt || new Date()) : null,
              ...(isActiveish ? {} : { subscriptionCredits: 0 }),
            }
          : {
              stripeCustomerId: customerId || user.stripeCustomerId || null,
              stripeSubscriptionId: null,
              subscriptionStatus: "cancelled",
              subscriptionTier: null,
              subscriptionBillingCycle: null,
              creditsExpireAt: null,
              subscriptionCancelledAt: new Date(),
              subscriptionCredits: 0,
            };

        await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
        updated += 1;
      } catch (err) {
        const msg = err?.message || String(err);
        errors.push({ userId: user.id, email: user.email || null, error: msg });
        console.warn(`[reconcile-subscriptions] User ${user.id} (${user.email}): ${msg}`);
      }
    }

    const adminUserId = req.user?.userId ?? null;
    const adminEmail = req.user?.email ?? null;
    try {
      await prisma.adminAuditLog.create({
        data: {
          adminUserId,
          adminEmail,
          action: "reconcile_all_subscriptions",
          targetType: "global",
          targetId: null,
          detailsJson: JSON.stringify({
            processed: users.length,
            updated,
            errors: errors.length,
            limit,
          }),
        },
      });
    } catch (auditErr) {
      console.warn("Audit log error:", auditErr?.message);
    }

    return res.json({
      success: true,
      message: `Reconciled subscriptions: ${updated} updated, ${errors.length} errors`,
      processed: users.length,
      updated,
      errors: errors.slice(0, 50),
    });
  } catch (error) {
    console.error("Reconcile all subscriptions error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to reconcile subscriptions",
    });
  }
}

export async function reconcileReferralCommissions(req, res) {
  try {
    const scanAllRaw = req.body?.scanAll ?? req.query?.scanAll ?? false;
    const scanAll = String(scanAllRaw).toLowerCase() === "true" || scanAllRaw === true;
    const requestedLimit = parseInt(req.body?.limit ?? req.query?.limit ?? "250", 10);
    const limit = scanAll
      ? null
      : Math.min(5000, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 250));
    const dryRunRaw = req.body?.dryRun ?? req.query?.dryRun ?? true;
    const dryRun = String(dryRunRaw).toLowerCase() !== "false";

    const referredUsers = scanAll
      ? await prisma.user.findMany({
          where: { referredByUserId: { not: null } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            email: true,
            referredByUserId: true,
          },
        })
      : await prisma.user.findMany({
          where: { referredByUserId: { not: null } },
          take: limit,
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            email: true,
            referredByUserId: true,
          },
        });

    const summary = {
      scanned: referredUsers.length,
      eligibleForBackfill: 0,
      alreadyCredited: 0,
      skippedNoFirstPurchase: 0,
      skippedUnsupportedSource: 0,
      skippedAmountUnresolved: 0,
      created: 0,
      failed: 0,
    };
    const items = [];

    for (const user of referredUsers) {
      const [existingCommission, firstPurchase] = await Promise.all([
        prisma.referralCommission.findFirst({
          where: { referredUserId: user.id },
          select: { id: true, sourceType: true, sourceId: true, commissionCents: true, createdAt: true },
        }),
        prisma.creditTransaction.findFirst({
          where: {
            userId: user.id,
            amount: { gt: 0 },
            paymentSessionId: { not: null },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            paymentSessionId: true,
            amount: true,
            type: true,
            description: true,
            createdAt: true,
          },
        }),
      ]);

      if (existingCommission) {
        summary.alreadyCredited += 1;
        items.push({
          userId: user.id,
          email: user.email,
          status: "already_credited",
          existingCommissionId: existingCommission.id,
        });
        continue;
      }

      if (!firstPurchase?.paymentSessionId) {
        summary.skippedNoFirstPurchase += 1;
        items.push({
          userId: user.id,
          email: user.email,
          status: "skipped_no_first_purchase",
        });
        continue;
      }

      const source = parseSourceFromPaymentSessionId(firstPurchase.paymentSessionId);
      if (!source) {
        summary.skippedUnsupportedSource += 1;
        items.push({
          userId: user.id,
          email: user.email,
          status: "skipped_unsupported_source",
          paymentSessionId: firstPurchase.paymentSessionId,
        });
        continue;
      }

      const purchaseAmountCents = await resolveStripeAmountCentsFromSource(source);
      if (!purchaseAmountCents || purchaseAmountCents <= 0) {
        summary.skippedAmountUnresolved += 1;
        items.push({
          userId: user.id,
          email: user.email,
          status: "skipped_amount_unresolved",
          sourceType: source.sourceType,
          sourceId: source.sourceId,
        });
        continue;
      }

      summary.eligibleForBackfill += 1;
      if (dryRun) {
        items.push({
          userId: user.id,
          email: user.email,
          status: "would_create",
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          purchaseAmountCents,
        });
        continue;
      }

      try {
        const result = await recordReferralCommissionFromPayment({
          referredUserId: user.id,
          purchaseAmountCents,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
        });
        if (result?.recorded) {
          summary.created += 1;
          items.push({
            userId: user.id,
            email: user.email,
            status: "created",
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            purchaseAmountCents,
            commissionCents: result.commissionCents || 0,
          });
        } else {
          items.push({
            userId: user.id,
            email: user.email,
            status: "skipped_noop",
            sourceType: source.sourceType,
            sourceId: source.sourceId,
          });
        }
      } catch (error) {
        summary.failed += 1;
        items.push({
          userId: user.id,
          email: user.email,
          status: "failed",
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          error: error?.message || "unknown_error",
        });
      }
    }

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: dryRun ? "reconcile_referrals_dry_run" : "reconcile_referrals_execute",
        targetType: "referral_commission",
        detailsJson: JSON.stringify({ limit: limit ?? "all", scanAll, summary }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      dryRun,
      limit: limit ?? "all",
      scanAll,
      summary,
      items,
    });
  } catch (error) {
    console.error("Reconcile referral commissions error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to reconcile referral commissions",
    });
  }
}

// ── Stripe revenue cache (2 min TTL per period key) ─────────────────────────
const _stripeCache = new Map();
const STRIPE_CACHE_TTL = 2 * 60 * 1000;

function getStripeCache(key) {
  const entry = _stripeCache.get(key);
  if (entry && Date.now() - entry.ts < STRIPE_CACHE_TTL) return entry.data;
  return null;
}
function setStripeCache(key, data) {
  _stripeCache.set(key, { ts: Date.now(), data });
}

function isLiveActiveStripeSubscription(sub) {
  const status = String(sub?.status || "").toLowerCase();
  // Strict active count to match Stripe "active subscription" expectation.
  return status === "active";
}

function stripeSubscriptionCustomerId(sub) {
  if (!sub?.customer) return null;
  return typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;
}

/**
 * Source-of-truth live subscription set from Stripe.
 * We list account subscriptions and filter to "active-like" statuses.
 */
async function listLiveSubscriptionsForMrr(stripeClient) {
  const allSubs = await stripeClient.subscriptions
    .list({
      status: "all",
      limit: 100,
      expand: ["data.items.data.price"],
    })
    .autoPagingToArray({ limit: 10_000 });
  return (allSubs || []).filter(isLiveActiveStripeSubscription);
}

/** Churn in date range — Search API filters by canceled_at (no full-table scan). */
async function countChurnCanceledInPeriod(stripeClient, periodStart, periodEnd) {
  try {
    const list = await stripeClient.subscriptions
      .search({
        query: `status:'canceled' AND canceled_at>=${periodStart} AND canceled_at<=${periodEnd}`,
        limit: 100,
      })
      .autoPagingToArray({ limit: 2_000 });
    return list.length;
  } catch (e) {
    console.warn("Stripe subscriptions.search (churn) unavailable or failed:", e.message);
    return 0;
  }
}

/**
 * Live Stripe Revenue
 * GET /api/admin/stripe-revenue?period=week
 */
export async function getStripeRevenue(req, res) {
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: "Stripe not configured",
      data: null,
    });
  }

  try {
    const { period = "week", year, date, startDate, endDate, bust } = req.query;
    const range = getPeriodRange(period, year, date, startDate, endDate);

    const rangeDays =
      (range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000) + 1;
    if (rangeDays > 366) {
      return res.status(400).json({
        success: false,
        message: "Date range cannot exceed 366 days",
      });
    }

    const cacheKey = `${period}:${year || ""}:${date || ""}:${startDate || ""}:${endDate || ""}`;
    if (!bust) {
      const cached = getStripeCache(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
    }

    const periodStart = Math.floor(range.start.getTime() / 1000);
    const periodEnd   = Math.floor(range.end.getTime()   / 1000);

    // DB count is kept as a diagnostic signal (sync drift), not the source of truth for "live active subs".
    const dbActiveSubUsersCount = await prisma.user.count({
      where: {
        subscriptionStatus: "active",
        stripeSubscriptionId: { not: null },
        subscriptionCancelledAt: null,
      },
    });

    // No global Promise.race — Stripe paging can exceed 90s on larger accounts.
    const [allCharges, allActiveSubs, churnInPeriod] = await Promise.all([
      stripe.charges
        .list({
          limit: 100,
          created: { gte: periodStart, lte: periodEnd },
        })
        .autoPagingToArray({ limit: 2_000 }),
      listLiveSubscriptionsForMrr(stripe),
      countChurnCanceledInPeriod(stripe, periodStart, periodEnd),
    ]);
    const liveActiveSubscriptionsCount = allActiveSubs.length;
    const liveActiveCustomersCount = new Set(
      allActiveSubs.map(stripeSubscriptionCustomerId).filter(Boolean),
    ).size;

    // ── Tally charges ────────────────────────────────────────────────────────
    let periodRevenueCents = 0;
    let periodChargeCount  = 0;
    let periodRefundCents  = 0;
    for (const ch of allCharges) {
      if (ch.status === "succeeded") {
        periodRevenueCents += ch.amount;
        periodChargeCount  += 1;
        periodRefundCents  += ch.amount_refunded || 0;
      }
    }

    // ── MRR + plan breakdown: only Stripe subs that match our DB active users ──
    const planBreakdown = {};
    let mrrCents = 0;

    for (const sub of allActiveSubs) {
      for (const item of (sub.items?.data || [])) {
        const price = item.price;
        if (!price) continue;
        const amountCents  = price.unit_amount || 0;
        const monthlyValue = price.recurring?.interval === "year"
          ? Math.round(amountCents / 12)
          : amountCents;
        mrrCents += monthlyValue;

        const label = price.nickname || price.id;
        planBreakdown[label] = planBreakdown[label] || { count: 0, mrrCents: 0 };
        planBreakdown[label].count    += 1;
        planBreakdown[label].mrrCents += monthlyValue;
      }
    }

    const planList = Object.entries(planBreakdown)
      .map(([name, v]) => ({ name, count: v.count, mrrCents: v.mrrCents }))
      .sort((a, b) => b.mrrCents - a.mrrCents);

    const result = {
      period: { key: period, start: range.start, end: range.end },
      periodRevenue: {
        amountCents: periodRevenueCents - periodRefundCents,
        grossCents:  periodRevenueCents,
        refundCents: periodRefundCents,
        chargeCount: periodChargeCount,
      },
      subscriptions: {
        active: liveActiveCustomersCount,
        activeSubscriptions: liveActiveSubscriptionsCount,
        mrrCents,
        arrCents: mrrCents * 12,
        churnInPeriod,
        plans: planList,
        source: "stripe_live",
        dbActiveUsers: dbActiveSubUsersCount,
      },
    };

    setStripeCache(cacheKey, result);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("getStripeRevenue error:", err.message);
    const key = `${req.query?.period ?? "week"}:${req.query?.year ?? ""}:${req.query?.date ?? ""}:${req.query?.startDate ?? ""}:${req.query?.endDate ?? ""}`;
    const cached = getStripeCache(key);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true, staleFallback: true });
    }
    return res.status(500).json({
      success: false,
      message: err.message || "Stripe revenue failed — try Refresh in a moment.",
    });
  }
}

/**
 * List API keys for a user (admin). Secrets are never returned.
 */
export async function listUserApiKeys(req, res) {
  try {
    const { id: userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const keys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        corsOrigins: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
    });
    return res.json({ success: true, keys });
  } catch (error) {
    console.error("listUserApiKeys error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Create API key for user. Plaintext key returned once in `key` field.
 */
export async function createUserApiKey(req, res) {
  try {
    const { id: userId } = req.params;
    const { name, corsOrigins } = req.body || {};
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        subscriptionTier: true,
        subscriptionStatus: true,
      },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const tier = String(user.subscriptionTier || "").toLowerCase();
    const subStatus = String(user.subscriptionStatus || "").toLowerCase();
    const subscriptionActive = ["active", "trialing"].includes(subStatus);
    if (tier !== "business" || !subscriptionActive) {
      return res.status(403).json({
        success: false,
        code: "API_KEY_REQUIRES_BUSINESS_PLAN",
        message:
          "API keys require an active Business plan (subscription status active or trialing). Upgrade the account or adjust subscription in admin before issuing keys.",
      });
    }
    const plain = `mcl_${randomBytes(32).toString("base64url")}`;
    const keyPrefix = plain.slice(0, 16);
    const keyHash = await bcrypt.hash(plain, 12);
    let corsJson = null;
    if (corsOrigins != null) {
      if (typeof corsOrigins === "string") {
        corsJson = corsOrigins.trim() || null;
      } else if (Array.isArray(corsOrigins)) {
        corsJson = JSON.stringify(corsOrigins.map((o) => String(o).trim()).filter(Boolean));
      }
    }
    const row = await prisma.apiKey.create({
      data: {
        userId,
        name: name != null ? String(name).slice(0, 200) : null,
        keyPrefix,
        keyHash,
        corsOrigins: corsJson,
      },
    });
    return res.json({
      success: true,
      key: plain,
      apiKey: {
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        corsOrigins: row.corsOrigins,
        createdAt: row.createdAt,
      },
    });
  } catch (error) {
    console.error("createUserApiKey error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function getVoiceHostingDue(req, res) {
  try {
    const report = await listVoiceHostingDueReport();
    return res.json({ success: true, ...report });
  } catch (error) {
    console.error("getVoiceHostingDue error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to load voice hosting report" });
  }
}

/**
 * POST body: { userId?: string } — if userId set, bill that user only; otherwise all users with voices.
 */
export async function postVoiceHostingRunBilling(req, res) {
  try {
    const userId = req.body?.userId != null ? String(req.body.userId).trim() : "";
    if (userId) {
      const result = await runMonthlyVoiceBillingForUser(userId);
      return res.json({
        success: true,
        scope: "user",
        userId,
        result,
      });
    }
    const summary = await runMonthlyVoiceBillingForAllUsers();
    return res.json({
      success: true,
      scope: "all",
      summary,
    });
  } catch (error) {
    console.error("postVoiceHostingRunBilling error:", error);
    return res.status(500).json({ success: false, message: error.message || "Voice billing run failed" });
  }
}

export async function revokeUserApiKey(req, res) {
  try {
    const { id: userId, keyId } = req.params;
    const existing = await prisma.apiKey.findFirst({
      where: { id: keyId, userId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "API key not found" });
    }
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error("revokeUserApiKey error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

export default {
  getAllUsers,
  getUserById,
  getUserPurchases,
  refundUserPurchase,
  addCreditsToUser,
  updateUserSettings,
  getDashboardStats,
  getStripeRevenue,
  deleteUser,
  getRecentActivity,
  recoverPayment,
  auditSubscriptionRefills,
  reconcileSubscriptionRefills,
  syncUserStripeState,
  reconcileAllSubscriptions,
  reconcileReferralCommissions,
  listUserApiKeys,
  createUserApiKey,
  revokeUserApiKey,
  getVoiceHostingDue,
  postVoiceHostingRunBilling,
};
