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
  creatorStudioFluxKontextPro: 10,
  creatorStudioFluxKontextMax: 20,
  creatorStudioWan27ImagePro: 24,
  creatorStudioIdeogramTurbo: 7,
  creatorStudioIdeogramBalanced: 14,
  creatorStudioIdeogramQuality: 20,
  creatorStudioSeedream45Edit: 10,
  creatorStudioAssetCreate: 100,
  nanoBananaFlash1K: 4,
  nanoBanana2Flash4K: 8,
  nanoBananaPro4K: 24,

  // Real Avatars — HeyGen Photo Avatar IV
  avatarCreation: 1000,   // one-time creation fee
  avatarMonthly: 500,     // monthly maintenance per avatar
  avatarVideoPerSec: 5,   // per second of generated video

  /** Legacy; recreate classic tier uses videoRecreateMotionProPerSec */
  videoRecreateStdPerSec: 10,
  /** kling-2.6/motion-control @ 1080p (default “classic” recreate) */
  videoRecreateMotionProPerSec: 18,
  videoRecreateUltraPerSec: 25,
  wan22AnimateMove720pPerSec: 12.5,
  wan22AnimateMove580pPerSec: 9.5,
  wan22AnimateMove480pPerSec: 6,
  wan22AnimateReplace720pPerSec: 12.5,
  wan22AnimateReplace580pPerSec: 9.5,
  wan22AnimateReplace480pPerSec: 6,

  // Veo 3.1
  veo31GenerateFast1080p8s: 60,
  veo31GenerateQuality1080p8s: 250,
  veo31ExtendFast: 60,
  veo31ExtendQuality: 250,
  veo31Render1080p: 5,
  veo31Upscale4k: 120,

  // Sora 2 Pro
  sora2Standard10Frames: 300,
  sora2Standard15Frames: 540,
  sora2High10Frames: 660,
  sora2High15Frames: 1260,
  sora2Storyboard10s: 150,
  sora2Storyboard15To25s: 270,
  /** KIE sora-watermark-remover — ~$0.016/s at current credit policy (same basis as Seedance WM). */
  sora2WatermarkRemoverPerSec: 6.4,

  // Kling generation (non-motion)
  kling30StdNoSoundPerSec: 14,
  kling30StdSoundPerSec: 20,
  kling30ProNoSoundPerSec: 18,
  kling30ProSoundPerSec: 27,
  kling26NoSound5s: 55,
  kling26NoSound10s: 110,
  kling26Sound5s: 110,
  kling26Sound10s: 220,

  // Seedance 2 (KIE) — user pricing policy (2x provider cost)
  // Standard model
  seedance2Standard480WithVideoPerSec: 23,
  seedance2Standard480NoVideoPerSec: 38,
  seedance2Standard720WithVideoPerSec: 50,
  seedance2Standard720NoVideoPerSec: 82,
  // Fast model
  seedance2Fast480WithVideoPerSec: 16,
  seedance2Fast480NoVideoPerSec: 31,
  seedance2Fast720WithVideoPerSec: 40,
  seedance2Fast720NoVideoPerSec: 66,

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
    sanitized[key] = Math.round(value * 1000) / 1000;
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
