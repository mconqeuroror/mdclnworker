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
  upscalerImage: 5,
  soulxNoModel1: 10,
  soulxWithModel1: 15,
  soulxNoModel2: 15,
  soulxWithModel2: 25,
  soulxExtraStepsPer10: 5,

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
  // WAN 2.6 (official t2v / i2v), resolution-based pricing
  // 720p: 64/128/192 for 5/10/15s => 12.8 credits/sec
  // 1080p: 96/192/288 for 5/10/15s => 19.2 credits/sec
  wan26T2v720pPerSec: 12.8,
  wan26T2v1080pPerSec: 19.2,
  wan26I2v720pPerSec: 12.8,
  wan26I2v1080pPerSec: 19.2,
  // WAN 2.7 video suite (set to current provisional defaults; adjust in admin pricing)
  wan27T2v720pPerSec: 14.4,
  wan27T2v1080pPerSec: 21.6,
  wan27I2v720pPerSec: 14.4,
  wan27I2v1080pPerSec: 21.6,
  wan27R2v720pPerSec: 14.4,
  wan27R2v1080pPerSec: 21.6,
  wan27Edit720pPerSec: 14.4,
  wan27Edit1080pPerSec: 21.6,

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

  // Seedance 2 (piapi.ai) — flat per-second rate (provider: $0.10/s standard, $0.08/s fast → 2× markup)
  seedance2StandardPerSec: 20,
  seedance2FastPerSec: 16,

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
