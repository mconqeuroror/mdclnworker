import prisma from "../lib/prisma.js";
import { getStripeForAccount } from "../lib/stripeClients.js";
import {
  inferSubscriptionCreditsFromAmount,
  normalizeCreditUnits,
  resolveSubscriptionBillingCycle,
  getSubscriptionPricing,
} from "../utils/creditUnits.js";
import { rolloverSubPoolToPurchasedUpdate } from "./credit.service.js";

/**
 * Stripe credit reconciliation service.
 *
 * The webhook pipeline (checkout.session.completed → payment_intent.succeeded
 * → invoice.payment_succeeded) has multiple safety nets, but each layer can
 * still fail in unusual cases:
 *   - Stripe webhook delivery dies and stops retrying.
 *   - subscription.metadata.credits is missing (legacy / portal upgrades / hand-edited).
 *   - The invoice fires with billing_reason="subscription_create" before
 *     /confirm-subscription, but the user's stripeSubscriptionId was already
 *     written by customer.subscription.updated, so the safety net is skipped
 *     and the price doesn't match a known tier within tolerance.
 *
 * This service is the LAST-RESORT, idempotent backfill: given a user, look at
 * every paid Stripe invoice / one-time checkout session in the user's history
 * and ensure each one has a matching CreditTransaction with the correct
 * paymentSessionId. If one is missing, derive credits from (in order):
 *   1. invoice line metadata.credits
 *   2. subscription.metadata.credits
 *   3. user.subscriptionTier × billingCycle pricing table
 *   4. amount-based inference (within 20% tolerance)
 *
 * Idempotency: every grant uses the same paymentSessionId scheme as the
 * webhook (subscriptionId for subscription invoices and the first cycle,
 * invoice.id for renewals, checkout session id for one-time). The UNIQUE
 * constraint on CreditTransaction.paymentSessionId means re-running this
 * service for the same user is always safe — already-credited invoices
 * silently no-op.
 */

const ACCOUNTS = ["new", "legacy"];

function expiryFromInvoice(invoice, billingCycle) {
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

function deriveCreditsFromSubscription(subscription, billedAmountCents, billingCycle, fallbackTierId) {
  const metaCredits = normalizeCreditUnits(subscription?.metadata?.credits);
  if (metaCredits > 0) return { credits: metaCredits, source: "metadata" };

  const tierId = subscription?.metadata?.tierId || fallbackTierId;
  if (tierId) {
    const tierPricing = getSubscriptionPricing(tierId, billingCycle || "monthly");
    if (tierPricing?.credits) {
      return { credits: tierPricing.credits, source: `tier:${tierId}` };
    }
  }

  const inferred = inferSubscriptionCreditsFromAmount(billedAmountCents, billingCycle);
  if (inferred > 0) {
    return { credits: inferred, source: "amount-inference" };
  }

  return { credits: 0, source: "none" };
}

async function getCustomerIdsForUser(user) {
  /** @type {Array<{ account: "new"|"legacy", customerId: string }>} */
  const result = [];
  if (user.stripeCustomerId) {
    result.push({ account: "new", customerId: user.stripeCustomerId });
  }
  if (user.legacyStripeCustomerId && user.legacyStripeCustomerId !== user.stripeCustomerId) {
    result.push({ account: "legacy", customerId: user.legacyStripeCustomerId });
  }
  // Defensive: also try resolving by email on each account when no stored id.
  if (!result.length && user.email) {
    for (const account of ACCOUNTS) {
      const stripe = getStripeForAccount(account);
      if (!stripe) continue;
      try {
        const customers = await stripe.customers.list({ email: user.email, limit: 1 });
        const c = customers.data?.[0];
        if (c?.id) result.push({ account, customerId: c.id });
      } catch (e) {
        console.warn(`[reconcile] customers.list(${account}) for ${user.email} failed: ${e.message}`);
      }
    }
  }
  return result;
}

/**
 * Reconcile a single paid invoice into the user's credit ledger.
 * Returns one of: { granted: true, credits, source, kind }, { skipped: "..." }, or { error: "..." }.
 *
 * @param {object} ctx
 * @param {object} ctx.invoice - expanded Stripe invoice
 * @param {object} ctx.user
 * @param {"new"|"legacy"} ctx.account
 */
async function reconcileInvoice({ invoice, user, account }) {
  const stripe = getStripeForAccount(account);
  if (!stripe) return { skipped: `no_stripe_client_for_${account}` };
  if (invoice.status !== "paid") return { skipped: `invoice_status_${invoice.status}` };

  const paid = parseInt(String(invoice.amount_paid || 0), 10) || 0;
  if (paid <= 0) return { skipped: "zero_amount_paid" };

  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id || null;

  const billedAmountCents =
    invoice.subtotal_excluding_tax ||
    invoice.subtotal ||
    invoice.amount_paid ||
    invoice.amount_due ||
    0;

  const billingReason = invoice.billing_reason || null;

  // ---- Subscription invoice branch
  if (subscriptionId) {
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (e) {
      return { error: `retrieve_subscription_failed:${e.message}` };
    }

    const billingCycle = resolveSubscriptionBillingCycle(subscription);
    const tierId = subscription.metadata?.tierId || user.subscriptionTier || null;

    const { credits, source } = deriveCreditsFromSubscription(
      subscription,
      billedAmountCents,
      billingCycle,
      tierId,
    );
    if (!credits) {
      return {
        error: `cannot_derive_credits (sub=${subscriptionId}, billed=${billedAmountCents}, cycle=${billingCycle}, tier=${tierId})`,
      };
    }

    // Idempotency key: matches webhook conventions exactly.
    //   subscription_create / first cycle  → subscriptionId
    //   subscription_cycle (renewal)        → invoice.id
    //   anything else (manual, etc.)        → invoice.id is safer
    const idempotencyKey =
      billingReason === "subscription_create"
        ? subscriptionId
        : billingReason === "subscription_cycle"
          ? invoice.id
          : invoice.id;

    // Cross-key check: also inspect both keys to avoid double-grant when
    // different webhooks claimed different keys historically.
    const existing = await prisma.creditTransaction.findFirst({
      where: {
        userId: user.id,
        paymentSessionId: { in: [idempotencyKey, invoice.id, subscriptionId].filter(Boolean) },
        amount: { gt: 0 },
      },
    });
    if (existing) {
      return { skipped: `already_credited_via_${existing.paymentSessionId}` };
    }

    const expiry = expiryFromInvoice(invoice, billingCycle);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            amount: credits,
            type: "subscription",
            description: `Reconcile (${source}): ${tierId || "plan"} ${billingCycle} — invoice ${invoice.id}, sub ${subscriptionId}`,
            paymentSessionId: idempotencyKey,
            stripeAccount: account,
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
            stripeSubscriptionId:
              account === "new" ? subscriptionId : user.stripeSubscriptionId,
            legacyStripeSubscriptionId:
              account === "legacy" ? subscriptionId : user.legacyStripeSubscriptionId,
            subscriptionTier: tierId || user.subscriptionTier,
            subscriptionStatus: "active",
            subscriptionBillingCycle: billingCycle,
            subscriptionCredits: credits,
            creditsExpireAt: expiry,
            maxModels: 999,
          },
        });
      });
    } catch (txErr) {
      if (txErr.code === "P2002") {
        return { skipped: "p2002_unique_violation" };
      }
      return { error: `tx_failed:${txErr.message}` };
    }

    return {
      granted: true,
      kind: "subscription",
      credits,
      source,
      subscriptionId,
      invoiceId: invoice.id,
      idempotencyKey,
    };
  }

  // ---- Standalone invoice (rare for one-time products; usually goes through
  // checkout.session.completed). Use invoice.id as the idempotency key.
  const lineMeta = invoice.lines?.data?.[0]?.metadata || {};
  const metaCredits = normalizeCreditUnits(lineMeta.credits);
  if (!metaCredits) return { skipped: "non_subscription_no_metadata_credits" };

  const existing = await prisma.creditTransaction.findUnique({
    where: { paymentSessionId: invoice.id },
  });
  if (existing) return { skipped: "invoice_already_credited" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          amount: metaCredits,
          type: "purchase",
          description: `Reconcile one-time invoice ${invoice.id}`,
          paymentSessionId: invoice.id,
          stripeAccount: account,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { purchasedCredits: { increment: metaCredits } },
      });
    });
  } catch (txErr) {
    if (txErr.code === "P2002") return { skipped: "p2002_unique_violation" };
    return { error: `tx_failed:${txErr.message}` };
  }

  return {
    granted: true,
    kind: "one-time-invoice",
    credits: metaCredits,
    source: "invoice-line-metadata",
    invoiceId: invoice.id,
  };
}

async function reconcileCheckoutSession({ session, user, account }) {
  const stripe = getStripeForAccount(account);
  if (!stripe) return { skipped: `no_stripe_client_for_${account}` };
  if (session.payment_status !== "paid") return { skipped: `session_status_${session.payment_status}` };

  const meta = session.metadata || {};
  const credits = normalizeCreditUnits(meta.credits);
  if (!credits) return { skipped: "session_no_metadata_credits" };

  // Pure subscriptions are handled by reconcileInvoice via subscription's
  // latest invoice; skip here to avoid double-bookkeeping.
  if (session.mode === "subscription") return { skipped: "session_is_subscription" };

  const idempotencyKey = session.id;
  const existing = await prisma.creditTransaction.findUnique({
    where: { paymentSessionId: idempotencyKey },
  });
  if (existing) return { skipped: "session_already_credited" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          amount: credits,
          type: "purchase",
          description: `Reconcile checkout session ${session.id}`,
          paymentSessionId: idempotencyKey,
          stripeAccount: account,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { purchasedCredits: { increment: credits } },
      });
    });
  } catch (txErr) {
    if (txErr.code === "P2002") return { skipped: "p2002_unique_violation" };
    return { error: `tx_failed:${txErr.message}` };
  }

  return {
    granted: true,
    kind: "one-time-session",
    credits,
    source: "session-metadata",
    sessionId: session.id,
  };
}

/**
 * Top-level entry point.
 * Walks every Stripe customer the user has on either account, lists recent
 * paid invoices + checkout sessions, and reconciles each into the credit
 * ledger. Idempotent.
 *
 * @param {string} userId
 * @param {{ lookbackDays?: number, maxInvoices?: number, maxSessions?: number }} [opts]
 * @returns {Promise<{
 *   userId: string,
 *   customers: Array<{ account: "new"|"legacy", customerId: string }>,
 *   results: Array<object>,
 *   totalGranted: number,
 *   creditsGranted: number,
 * }>}
 */
export async function reconcileUserCredits(userId, opts = {}) {
  const { lookbackDays = 90, maxInvoices = 100, maxSessions = 100 } = opts;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`User not found: ${userId}`);

  const customers = await getCustomerIdsForUser(user);
  if (!customers.length) {
    return { userId, customers: [], results: [], totalGranted: 0, creditsGranted: 0 };
  }

  const sinceUnix = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
  const allResults = [];
  let totalGranted = 0;
  let creditsGranted = 0;

  for (const { account, customerId } of customers) {
    const stripe = getStripeForAccount(account);
    if (!stripe) continue;

    // 1) Paid invoices (covers subscriptions + invoiced one-time charges)
    try {
      const invoices = await stripe.invoices.list({
        customer: customerId,
        status: "paid",
        limit: Math.min(maxInvoices, 100),
        created: { gte: sinceUnix },
      });
      for (const invoice of invoices.data) {
        try {
          const result = await reconcileInvoice({ invoice, user, account });
          allResults.push({
            kind: "invoice",
            account,
            invoiceId: invoice.id,
            subscriptionId: typeof invoice.subscription === "string" ? invoice.subscription : null,
            ...result,
          });
          if (result.granted) {
            totalGranted += 1;
            creditsGranted += result.credits || 0;
          }
        } catch (e) {
          console.error(`[reconcile] invoice ${invoice.id} failed:`, e.message);
          allResults.push({ kind: "invoice", account, invoiceId: invoice.id, error: e.message });
        }
      }
    } catch (e) {
      console.error(`[reconcile] invoices.list(${account}/${customerId}) failed:`, e.message);
    }

    // 2) Checkout sessions (covers one-time purchases that may not have invoices)
    try {
      const sessions = await stripe.checkout.sessions.list({
        customer: customerId,
        limit: Math.min(maxSessions, 100),
      });
      for (const session of sessions.data) {
        if (session.created && session.created < sinceUnix) continue;
        try {
          const result = await reconcileCheckoutSession({ session, user, account });
          allResults.push({
            kind: "session",
            account,
            sessionId: session.id,
            ...result,
          });
          if (result.granted) {
            totalGranted += 1;
            creditsGranted += result.credits || 0;
          }
        } catch (e) {
          console.error(`[reconcile] session ${session.id} failed:`, e.message);
          allResults.push({ kind: "session", account, sessionId: session.id, error: e.message });
        }
      }
    } catch (e) {
      console.error(`[reconcile] sessions.list(${account}/${customerId}) failed:`, e.message);
    }
  }

  console.log(
    `[reconcile] user=${userId} customers=${customers.length} granted=${totalGranted} (+${creditsGranted} credits)`,
  );

  return {
    userId,
    customers,
    results: allResults,
    totalGranted,
    creditsGranted,
  };
}
