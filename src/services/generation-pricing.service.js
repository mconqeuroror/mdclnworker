import prisma from "../lib/prisma.js";

export const DEFAULT_GENERATION_PRICING = Object.freeze({
  modelCreateAi: 900,
  modelStep1Reference: 150,
  modelStep2Poses: 750,
  modelFromPhotosAdvanced: 900,

  imageIdentity: 10,
  imagePromptCasual: 20,
  imagePromptNsfw: 10,
  imageFaceSwap: 10,
  analyzeLooks: 10,
  describeTargetImage: 10,
  enhancePromptDefault: 10,
  enhancePromptNsfw: 10,

  // Creator Studio — NanoBanana Pro
  creatorStudio1K2K: 20,
  creatorStudio4K: 25,

  // Real Avatars — HeyGen Photo Avatar IV
  avatarCreation: 1000,   // one-time creation fee
  avatarMonthly: 500,     // monthly maintenance per avatar
  avatarVideoPerSec: 5,   // per second of generated video

  videoRecreateStdPerSec: 10,
  /** 2.6 motion-control at 1080p (user-facing “Motion Control Pro”) */
  videoRecreateMotionProPerSec: 18,
  videoRecreateUltraPerSec: 25,
  videoPrompt5s: 60,
  videoPrompt10s: 100,
  videoFaceSwapPerSec: 10,
  talkingHeadMin: 70,
  talkingHeadPerSecondX10: 13,
});

const CACHE_TTL_MS = 5_000;
let pricingCache = null;
let pricingCacheAt = 0;

function sanitizePricingObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const sanitized = {};
  for (const key of Object.keys(DEFAULT_GENERATION_PRICING)) {
    if (!(key in input)) continue;
    const raw = input[key];
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isFinite(value) || value < 0) continue;
    sanitized[key] = Math.round(value);
  }
  return sanitized;
}

export async function getGenerationPricing({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && pricingCache && now - pricingCacheAt < CACHE_TTL_MS) {
    return pricingCache;
  }

  const row = await prisma.generationPricingConfig.findUnique({
    where: { id: "global" },
    select: { values: true },
  });

  const overrides = sanitizePricingObject(row?.values || {});
  const merged = { ...DEFAULT_GENERATION_PRICING, ...overrides };
  pricingCache = merged;
  pricingCacheAt = now;
  return merged;
}

export async function updateGenerationPricing(patch) {
  const current = await getGenerationPricing({ forceRefresh: true });
  const sanitizedPatch = sanitizePricingObject(patch);
  const next = { ...current, ...sanitizedPatch };

  await prisma.generationPricingConfig.upsert({
    where: { id: "global" },
    update: { values: next },
    create: { id: "global", values: next },
  });

  pricingCache = next;
  pricingCacheAt = Date.now();
  return next;
}

export async function resetGenerationPricing() {
  const next = { ...DEFAULT_GENERATION_PRICING };
  await prisma.generationPricingConfig.upsert({
    where: { id: "global" },
    update: { values: next },
    create: { id: "global", values: next },
  });
  pricingCache = next;
  pricingCacheAt = Date.now();
  return next;
}
