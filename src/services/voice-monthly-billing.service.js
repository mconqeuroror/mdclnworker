import Stripe from "stripe";
import prisma from "../lib/prisma.js";
import { getGenerationPricing } from "./generation-pricing.service.js";
import {
  checkAndExpireCredits,
  getTotalCredits,
  deductCredits,
} from "./credit.service.js";
import { deleteElevenLabsVoice } from "./elevenlabs.service.js";
import {
  sendVoiceAutoChargeSuccessEmail,
  sendVoiceGracePeriodEmail,
  sendVoiceDeletedDueToNonPaymentEmail,
} from "./email.service.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// $0.012 per credit — matches the one-time credits purchase rate in stripe.routes.js
const PRICE_PER_CREDIT_USD = 0.012;

/**
 * Attempt an off-session Stripe charge against the customer's saved payment method.
 * Returns { success, chargeId, error }.
 */
async function attemptStripeAutoCharge(stripeCustomerId, credits) {
  if (!stripeCustomerId) return { success: false, error: "no_stripe_customer" };
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return { success: false, error: "stripe_not_configured" };

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
  const amountCents = Math.round(credits * PRICE_PER_CREDIT_USD * 100);
  if (amountCents < 50) return { success: false, error: "amount_too_small" };

  // Resolve the saved payment method: prefer the subscription default,
  // then fall back to any saved card on the customer.
  let paymentMethodId = null;
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return { success: false, error: "customer_deleted" };

    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (defaultPm && typeof defaultPm === "object") {
      paymentMethodId = defaultPm.id;
    } else if (typeof defaultPm === "string") {
      paymentMethodId = defaultPm;
    }

    if (!paymentMethodId) {
      // Try listing saved cards
      const pms = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: "card",
        limit: 1,
      });
      paymentMethodId = pms.data?.[0]?.id ?? null;
    }
  } catch (e) {
    console.warn("[VoiceBilling] Failed to retrieve Stripe PM:", e?.message);
    return { success: false, error: e?.message || "stripe_lookup_failed" };
  }

  if (!paymentMethodId) return { success: false, error: "no_payment_method" };

  try {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: `Voice hosting auto top-up (${credits} credits)`,
      metadata: { type: "voice_hosting_auto_topup", credits: String(credits) },
    });

    if (pi.status === "succeeded") {
      return { success: true, chargeId: pi.id, amountUsd: amountCents / 100 };
    }
    return { success: false, error: `pi_status_${pi.status}`, chargeId: pi.id };
  } catch (e) {
    // authentication_required = 3DS needed; treat as failed
    const code = e?.code || e?.type || e?.message || "stripe_error";
    console.warn("[VoiceBilling] Stripe off-session charge failed:", code);
    return { success: false, error: String(code) };
  }
}

/**
 * Handle a single voice (or legacy model) that cannot be billed from credits.
 * Tries an automatic Stripe top-up. On success: adds credits + bills normally.
 * On failure: enters a 3-day grace period and emails the user.
 * Returns "charged" | "grace_period".
 */
async function handleInsufficientCreditsForVoice({
  userId,
  voiceId,       // ModelVoice.id  (null for legacy)
  legacyModelId, // SavedModel.id  (null for ModelVoice)
  voiceName,
  monthlyCost,
  user,          // User row with stripeCustomerId + email
  getAppBaseUrl,
}) {
  const stripeResult = await attemptStripeAutoCharge(user.stripeCustomerId, monthlyCost);

  if (stripeResult.success) {
    // Credit the top-up to the user's account
    const amountCents = Math.round(monthlyCost * PRICE_PER_CREDIT_USD * 100);
    await prisma.user.update({
      where: { id: userId },
      data: { purchasedCredits: { increment: monthlyCost } },
    });
    await prisma.creditTransaction.create({
      data: {
        userId,
        amount: monthlyCost,
        type: "purchase",
        description: `Auto top-up for voice hosting — ${voiceName || voiceId || legacyModelId} (Stripe ${stripeResult.chargeId})`,
      },
    });

    // Now deduct for billing
    await deductCredits(userId, monthlyCost);

    if (voiceId) {
      await prisma.modelVoice.update({
        where: { id: voiceId },
        data: {
          voiceMonthlyLastBilledAt: new Date(),
          voiceBillingStatus: "active",
          voiceBillingGraceEndsAt: null,
        },
      });
    } else {
      await prisma.savedModel.update({
        where: { id: legacyModelId },
        data: { legacyVoiceMonthlyLastBilledAt: new Date(), legacyVoiceBillingSuspended: false },
      });
    }

    await prisma.creditTransaction.create({
      data: {
        userId,
        amount: -monthlyCost,
        type: "usage",
        description: `Voice hosting (monthly) — ${voiceName || voiceId || legacyModelId}`,
      },
    });

    const amountUsd = (amountCents / 100).toFixed(2);
    console.log(`💳 [Voice] Auto-charged $${amountUsd} for voice ${voiceId || legacyModelId}`);

    // Email: card charged
    if (user.email) {
      const baseUrl = (getAppBaseUrl?.() || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
      sendVoiceAutoChargeSuccessEmail(user.email, {
        voiceName,
        credits: monthlyCost,
        amountUsd,
        dashboardUrl: `${baseUrl}/voice-studio`,
      }).catch((e) => console.warn("[VoiceBilling] auto-charge success email failed:", e?.message));
    }
    return "charged";
  }

  // Stripe charge failed (or no PM) — enter grace period
  const graceEndsAt = new Date(Date.now() + THREE_DAYS_MS);

  if (voiceId) {
    await prisma.modelVoice.update({
      where: { id: voiceId },
      data: {
        voiceBillingStatus: "grace_period",
        voiceMonthlyLastBilledAt: new Date(),
        voiceBillingGraceEndsAt: graceEndsAt,
      },
    });
  } else {
    // Legacy model: use suspended flag (no grace field there) but also store in a note
    await prisma.savedModel.update({
      where: { id: legacyModelId },
      data: { legacyVoiceBillingSuspended: true, legacyVoiceMonthlyLastBilledAt: new Date() },
    });
  }

  console.warn(`⚠️  [Voice] Auto-charge failed (${stripeResult.error}) — grace period until ${graceEndsAt.toISOString()} for voice ${voiceId || legacyModelId}`);

  // Email: top up or voice deleted
  if (user.email) {
    const baseUrl = (getAppBaseUrl?.() || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
    sendVoiceGracePeriodEmail(user.email, {
      voiceName,
      credits: monthlyCost,
      graceEndsAt,
      topupUrl: `${baseUrl}/credits`,
    }).catch((e) => console.warn("[VoiceBilling] grace period email failed:", e?.message));
  }
  return "grace_period";
}

/**
 * Delete all ModelVoice rows whose grace period has expired.
 * Removes the voice from ElevenLabs and sends the user a final notification.
 */
export async function processExpiredVoiceGracePeriods() {
  const now = new Date();

  const expired = await prisma.modelVoice.findMany({
    where: {
      voiceBillingStatus: "grace_period",
      voiceBillingGraceEndsAt: { lt: now },
    },
    select: {
      id: true,
      userId: true,
      elevenLabsVoiceId: true,
      name: true,
      user: { select: { email: true } },
    },
  });

  if (expired.length === 0) return { deleted: 0 };

  console.log(`[Voice] Processing ${expired.length} expired grace period voice(s)…`);
  let deleted = 0;

  for (const voice of expired) {
    try {
      // Delete from ElevenLabs
      if (voice.elevenLabsVoiceId) {
        await deleteElevenLabsVoice(voice.elevenLabsVoiceId);
      }
      // Delete DB row
      await prisma.modelVoice.delete({ where: { id: voice.id } });
      deleted += 1;
      console.log(`🗑️  [Voice] Deleted voice ${voice.id} (EL: ${voice.elevenLabsVoiceId}) after grace period`);

      // Email user
      if (voice.user?.email) {
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "").replace(/\/$/, "");
        sendVoiceDeletedDueToNonPaymentEmail(voice.user.email, {
          voiceName: voice.name || voice.id,
          topupUrl: `${baseUrl}/credits`,
        }).catch((e) => console.warn("[VoiceBilling] deletion email failed:", e?.message));
      }
    } catch (e) {
      console.error(`[Voice] Failed to delete expired grace voice ${voice.id}:`, e?.message);
    }
  }

  return { deleted };
}

/**
 * Charge monthly hosting for each custom ElevenLabs voice (ModelVoice row).
 * Legacy models with only SavedModel.elevenLabsVoiceId and zero ModelVoice rows
 * are billed once per model via SavedModel legacy fields.
 *
 * Insufficient credits → attempt Stripe auto top-up → if that fails → 3-day grace period.
 */
export async function runMonthlyVoiceBillingForUser(userId) {
  if (!userId) return { charged: 0, gracePeriod: 0, skipped: 0 };

  // First: clean up any expired grace periods for this user
  await processExpiredVoiceGracePeriods();

  const pricing = await getGenerationPricing();
  const monthlyCost = Math.max(0, Math.round(Number(pricing.voiceMonthly) || 1000));
  if (monthlyCost <= 0) return { charged: 0, gracePeriod: 0, skipped: 0 };

  // Fetch user for Stripe ID and email
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, stripeCustomerId: true },
  });
  if (!user) return { charged: 0, gracePeriod: 0, skipped: 0 };

  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  let charged = 0;
  let gracePeriod = 0;

  // ── ModelVoice rows ──────────────────────────────────────────────────────
  const dueVoices = await prisma.modelVoice.findMany({
    where: {
      userId,
      voiceMonthlyLastBilledAt: { lt: cutoff },
      voiceBillingStatus: { in: ["active", "suspended"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, modelId: true, voiceMonthlyLastBilledAt: true, voiceBillingStatus: true },
  });

  for (const voice of dueVoices) {
    const freshUser = await checkAndExpireCredits(userId);
    const hasCredits = getTotalCredits(freshUser) >= monthlyCost;

    if (hasCredits) {
      await deductCredits(userId, monthlyCost);
      await prisma.modelVoice.update({
        where: { id: voice.id },
        data: {
          voiceMonthlyLastBilledAt: new Date(),
          voiceBillingStatus: "active",
          voiceBillingGraceEndsAt: null,
        },
      });
      await prisma.creditTransaction.create({
        data: {
          userId,
          amount: -monthlyCost,
          type: "usage",
          description: `Voice hosting (monthly) — ${voice.name || voice.id}`,
        },
      });
      charged += monthlyCost;
      console.log(`💳 [Voice] Monthly hosting charged: ${monthlyCost}cr for voice ${voice.id}`);
    } else {
      const outcome = await handleInsufficientCreditsForVoice({
        userId,
        voiceId: voice.id,
        legacyModelId: null,
        voiceName: voice.name || voice.id,
        monthlyCost,
        user,
      });
      if (outcome === "charged") {
        charged += monthlyCost;
      } else {
        gracePeriod += 1;
      }
    }
  }

  // ── Legacy SavedModel voices ─────────────────────────────────────────────
  const legacyModels = await prisma.savedModel.findMany({
    where: {
      userId,
      elevenLabsVoiceId: { not: null },
      modelVoices: { none: {} },
    },
    select: {
      id: true,
      name: true,
      elevenLabsVoiceId: true,
      legacyVoiceMonthlyLastBilledAt: true,
      legacyVoiceBillingSuspended: true,
      createdAt: true,
    },
  });

  for (const model of legacyModels) {
    const lastBilled = model.legacyVoiceMonthlyLastBilledAt ?? model.createdAt;
    if (lastBilled >= cutoff) continue;

    const freshUser = await checkAndExpireCredits(userId);
    const hasCredits = getTotalCredits(freshUser) >= monthlyCost;

    if (hasCredits) {
      await deductCredits(userId, monthlyCost);
      await prisma.savedModel.update({
        where: { id: model.id },
        data: { legacyVoiceMonthlyLastBilledAt: new Date(), legacyVoiceBillingSuspended: false },
      });
      await prisma.creditTransaction.create({
        data: {
          userId,
          amount: -monthlyCost,
          type: "usage",
          description: `Voice hosting (monthly, legacy) — ${model.name || model.id}`,
        },
      });
      charged += monthlyCost;
      console.log(`💳 [Voice] Monthly hosting charged: ${monthlyCost}cr (legacy) for model ${model.id}`);
    } else {
      const outcome = await handleInsufficientCreditsForVoice({
        userId,
        voiceId: null,
        legacyModelId: model.id,
        voiceName: model.name || model.id,
        monthlyCost,
        user,
      });
      if (outcome === "charged") {
        charged += monthlyCost;
      } else {
        gracePeriod += 1;
      }
    }
  }

  return { charged, gracePeriod, skipped: 0 };
}

/**
 * Admin/report: voices and legacy models whose hosting period has elapsed (same rules as billing).
 */
export async function listVoiceHostingDueReport() {
  const pricing = await getGenerationPricing();
  const monthlyCost = Math.max(0, Math.round(Number(pricing.voiceMonthly) || 1000));
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const dueModelVoices = await prisma.modelVoice.findMany({
    where: {
      voiceMonthlyLastBilledAt: { lt: cutoff },
      voiceBillingStatus: { in: ["active", "suspended", "grace_period"] },
    },
    select: {
      id: true,
      userId: true,
      modelId: true,
      name: true,
      voiceMonthlyLastBilledAt: true,
      voiceBillingStatus: true,
      voiceBillingGraceEndsAt: true,
    },
    orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
  });

  const legacyCandidates = await prisma.savedModel.findMany({
    where: { elevenLabsVoiceId: { not: null }, modelVoices: { none: {} } },
    select: {
      id: true,
      userId: true,
      name: true,
      legacyVoiceMonthlyLastBilledAt: true,
      legacyVoiceBillingSuspended: true,
      createdAt: true,
    },
    orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
  });

  const legacyDue = legacyCandidates.filter((m) => {
    const last = m.legacyVoiceMonthlyLastBilledAt ?? m.createdAt;
    return last < cutoff;
  });

  const userIds = new Set([
    ...dueModelVoices.map((v) => v.userId),
    ...legacyDue.map((m) => m.userId),
  ]);

  const users = userIds.size === 0 ? [] : await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, email: true },
  });
  const emailById = Object.fromEntries(users.map((u) => [u.id, u.email]));

  const items = [];
  for (const v of dueModelVoices) {
    items.push({
      kind: "modelVoice",
      userId: v.userId,
      email: emailById[v.userId] || null,
      voiceId: v.id,
      modelId: v.modelId,
      name: v.name,
      lastBilledAt: v.voiceMonthlyLastBilledAt?.toISOString?.() || null,
      billingStatus: v.voiceBillingStatus,
      graceEndsAt: v.voiceBillingGraceEndsAt?.toISOString?.() || null,
      creditsIfCharged: monthlyCost,
    });
  }
  for (const m of legacyDue) {
    const last = m.legacyVoiceMonthlyLastBilledAt ?? m.createdAt;
    items.push({
      kind: "legacy",
      userId: m.userId,
      email: emailById[m.userId] || null,
      modelId: m.id,
      name: m.name,
      lastBilledAt: last?.toISOString?.() || null,
      billingStatus: m.legacyVoiceBillingSuspended ? "suspended" : "active",
      creditsIfCharged: monthlyCost,
    });
  }

  return {
    voiceMonthlyCredits: monthlyCost,
    cutoffAt: cutoff.toISOString(),
    totalDueItems: items.length,
    distinctUsers: userIds.size,
    items,
  };
}

/**
 * Run voice hosting billing for every user who has at least one billable voice.
 * Use for cron or one-time backfill after deploy.
 */
export async function runMonthlyVoiceBillingForAllUsers() {
  // Process expired grace periods globally first
  try {
    await processExpiredVoiceGracePeriods();
  } catch (e) {
    console.error("[Voice] processExpiredVoiceGracePeriods failed:", e?.message);
  }

  const fromModelVoice = await prisma.modelVoice.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  const fromLegacy = await prisma.savedModel.findMany({
    where: { elevenLabsVoiceId: { not: null }, modelVoices: { none: {} } },
    distinct: ["userId"],
    select: { userId: true },
  });

  const ids = new Set();
  for (const row of fromModelVoice) ids.add(row.userId);
  for (const row of fromLegacy) ids.add(row.userId);

  const summary = {
    users: ids.size,
    totalChargedCredits: 0,
    totalGracePeriodVoices: 0,
    errors: [],
  };

  for (const uid of ids) {
    try {
      const r = await runMonthlyVoiceBillingForUser(uid);
      summary.totalChargedCredits += r.charged;
      summary.totalGracePeriodVoices += r.gracePeriod;
    } catch (e) {
      summary.errors.push({ userId: uid, message: String(e?.message || e) });
      console.error(`[Voice] Monthly billing failed for user ${uid}:`, e);
    }
  }

  return summary;
}

/**
 * Block TTS / previews when hosting fee left this voice suspended or in grace period.
 */
export async function assertElevenLabsVoiceUsableForUser(userId, elevenLabsVoiceId) {
  if (!userId || !elevenLabsVoiceId) return;
  const elId = String(elevenLabsVoiceId).trim();
  if (!elId) return;

  const mv = await prisma.modelVoice.findFirst({
    where: { userId, elevenLabsVoiceId: elId },
    select: { voiceBillingStatus: true },
  });
  if (mv) {
    if (mv.voiceBillingStatus === "suspended" || mv.voiceBillingStatus === "grace_period") {
      const err = new Error(
        "This custom voice is paused until the monthly hosting fee is paid. Add credits and open Voice Studio to refresh billing.",
      );
      err.statusCode = 403;
      err.code = "VOICE_BILLING_SUSPENDED";
      throw err;
    }
    return;
  }

  const legacy = await prisma.savedModel.findFirst({
    where: { userId, elevenLabsVoiceId: elId },
    select: { legacyVoiceBillingSuspended: true },
  });
  if (legacy?.legacyVoiceBillingSuspended) {
    const err = new Error(
      "This custom voice is paused until the monthly hosting fee is paid. Add credits and open Voice Studio to refresh billing.",
    );
    err.statusCode = 403;
    err.code = "VOICE_BILLING_SUSPENDED";
    throw err;
  }
}
