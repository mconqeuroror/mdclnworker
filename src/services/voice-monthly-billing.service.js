import prisma from "../lib/prisma.js";
import { getGenerationPricing } from "./generation-pricing.service.js";
import {
  checkAndExpireCredits,
  getTotalCredits,
  deductCredits,
} from "./credit.service.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Charge monthly hosting for each custom ElevenLabs voice (ModelVoice row).
 * Legacy models with only SavedModel.elevenLabsVoiceId and zero ModelVoice rows
 * are billed once per model via SavedModel legacy fields.
 *
 * Mirrors avatar monthly billing: insufficient credits → suspended until paid.
 */
export async function runMonthlyVoiceBillingForUser(userId) {
  if (!userId) return { charged: 0, suspended: 0, skipped: 0 };

  const pricing = await getGenerationPricing();
  const monthlyCost = Math.max(0, Math.round(Number(pricing.voiceMonthly) || 1000));
  if (monthlyCost <= 0) {
    return { charged: 0, suspended: 0, skipped: 0 };
  }

  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  let charged = 0;
  let suspended = 0;

  const dueVoices = await prisma.modelVoice.findMany({
    where: {
      userId,
      voiceMonthlyLastBilledAt: { lt: cutoff },
      voiceBillingStatus: { in: ["active", "suspended"] },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      modelId: true,
      voiceMonthlyLastBilledAt: true,
      voiceBillingStatus: true,
    },
  });

  for (const voice of dueVoices) {
    const user = await checkAndExpireCredits(userId);
    const hasCredits = getTotalCredits(user) >= monthlyCost;

    if (hasCredits) {
      await deductCredits(userId, monthlyCost);
      await prisma.modelVoice.update({
        where: { id: voice.id },
        data: {
          voiceMonthlyLastBilledAt: new Date(),
          voiceBillingStatus: "active",
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
      await prisma.modelVoice.update({
        where: { id: voice.id },
        data: {
          voiceBillingStatus: "suspended",
          voiceMonthlyLastBilledAt: new Date(),
        },
      });
      suspended += 1;
      console.warn(`⚠️  [Voice] Insufficient credits for hosting — voice ${voice.id} suspended`);
    }
  }

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

    const user = await checkAndExpireCredits(userId);
    const hasCredits = getTotalCredits(user) >= monthlyCost;

    if (hasCredits) {
      await deductCredits(userId, monthlyCost);
      await prisma.savedModel.update({
        where: { id: model.id },
        data: {
          legacyVoiceMonthlyLastBilledAt: new Date(),
          legacyVoiceBillingSuspended: false,
        },
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
      await prisma.savedModel.update({
        where: { id: model.id },
        data: {
          legacyVoiceBillingSuspended: true,
          legacyVoiceMonthlyLastBilledAt: new Date(),
        },
      });
      suspended += 1;
      console.warn(`⚠️  [Voice] Insufficient credits for hosting — legacy voice on model ${model.id} suspended`);
    }
  }

  return { charged, suspended, skipped: 0 };
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
      voiceBillingStatus: { in: ["active", "suspended"] },
    },
    select: {
      id: true,
      userId: true,
      modelId: true,
      name: true,
      voiceMonthlyLastBilledAt: true,
      voiceBillingStatus: true,
    },
    orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
  });

  const legacyCandidates = await prisma.savedModel.findMany({
    where: {
      elevenLabsVoiceId: { not: null },
      modelVoices: { none: {} },
    },
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

  const users =
    userIds.size === 0
      ? []
      : await prisma.user.findMany({
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
  const fromModelVoice = await prisma.modelVoice.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  const fromLegacy = await prisma.savedModel.findMany({
    where: {
      elevenLabsVoiceId: { not: null },
      modelVoices: { none: {} },
    },
    distinct: ["userId"],
    select: { userId: true },
  });

  const ids = new Set();
  for (const row of fromModelVoice) ids.add(row.userId);
  for (const row of fromLegacy) ids.add(row.userId);

  const summary = {
    users: ids.size,
    totalChargedCredits: 0,
    totalSuspendedVoices: 0,
    errors: [],
  };

  for (const uid of ids) {
    try {
      const r = await runMonthlyVoiceBillingForUser(uid);
      summary.totalChargedCredits += r.charged;
      summary.totalSuspendedVoices += r.suspended;
    } catch (e) {
      summary.errors.push({ userId: uid, message: String(e?.message || e) });
      console.error(`[Voice] Monthly billing failed for user ${uid}:`, e);
    }
  }

  return summary;
}

/**
 * Block TTS / previews when hosting fee left this voice suspended.
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
    if (mv.voiceBillingStatus === "suspended") {
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
