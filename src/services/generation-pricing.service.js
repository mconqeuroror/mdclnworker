import prisma from "../lib/prisma.js";

export const DEFAULT_GENERATION_PRICING = Object.freeze({
  modelCreateAi: 900,
  modelStep1Reference: 150,
  modelStep2Poses: 750,
  modelFromPhotosAdvanced: 900,

  imageIdentity: 10,
  imagePromptCasual: 20,
  imagePromptNsfw: 30,
  nsfwImageDouble: 50,
  imageFaceSwap: 10,
  analyzeLooks: 10,
  describeTargetImage: 10,
  enhancePromptDefault: 1,
  enhancePromptNsfw: 1,
  upscalerImage: 5,
  synthIdRemove: 20,
  modelcloneXNoModel1: 10,
  modelcloneXWithModel1: 15,
  modelcloneXNoModel2: 15,
  modelcloneXWithModel2: 25,
  modelcloneXExtraStepsPer10: 5,
  /** NSFW + ModelClone-X LoRA training (fal.ai) — standard vs pro dataset / steps */
  loraTrainingStandard: 750,
  loraTrainingPro: 1500,

  /** NSFW nudes pack — per-image range (full selection vs single pose); see shared/nudesPackPoses */
  nudesPackCreditsMin: 15,
  nudesPackCreditsMax: 30,

  // Creator Studio — NanoBanana Pro
  creatorStudio1K2K: 20,
  creatorStudio4K: 25,
  creatorStudioFluxKontextPro: 10,
  creatorStudioFluxKontextMax: 20,
  creatorStudioWan27Image: 5,
  creatorStudioWan27ImagePro: 10,
  creatorStudioIdeogramTurbo: 7,
  creatorStudioIdeogramBalanced: 14,
  creatorStudioIdeogramQuality: 20,
  creatorStudioSeedream45Edit: 10,
  creatorStudioGptImage2: 10,
  creatorStudioAssetCreate: 100,
  nanoBananaFlash1K: 4,
  nanoBanana2Flash4K: 8,
  nanoBananaPro4K: 24,

  // Real Avatars — HeyGen Photo Avatar IV
  avatarCreation: 1000,   // one-time creation fee
  avatarMonthly: 500,     // monthly maintenance per avatar
  avatarVideoPerSec: 5,   // per second of generated video

  /** Custom ElevenLabs voice — hosting debited from user credit balance every ~30 days per saved voice */
  voiceMonthly: 1000,

  /** Legacy; recreate classic tier uses videoRecreateMotionProPerSec */
  videoRecreateStdPerSec: 10,
  /** Motion X / NSFW Motion Control (RunningHub) */
  motionXPerSec: 6.5,
  /** kling-2.6/motion-control @ 1080p (default “classic” recreate) */
  videoRecreateMotionProPerSec: 18,
  videoRecreateUltraPerSec: 25,
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

  // Sora 2 Pro (legacy KIE pricing — kept for historical gens / UI fallbacks)
  sora2Standard10Frames: 300,
  sora2Standard15Frames: 540,
  sora2High10Frames: 660,
  sora2High15Frames: 1260,
  sora2Storyboard10s: 150,
  sora2Storyboard15To25s: 270,
  /** KIE sora-watermark-remover — ~$0.016/s at current credit policy (same basis as Seedance WM). */
  sora2WatermarkRemoverPerSec: 6.4,

  // Sora via RunningHub (rhart-video-s-official) — user pays 2× provider cost (100 credits ≈ $1).
  // image-to-video-pro: 720p=$0.3/s → 60 cr/s, 1080p=$0.5/s → 100 cr/s.
  soraRh720pI2vPerSec: 60,
  soraRh1080pI2vPerSec: 100,
  // text-to-video-pro: 720x1280 / 1280x720 = $0.3/s (60), 1024x1792 / 1792x1024 = $0.5/s (100),
  // 1080x1920 / 1920x1080 = $0.7/s (140).
  soraRh720T2vPerSec: 60,
  soraRh1024T2vPerSec: 100,
  soraRh1080T2vPerSec: 140,

  // Kling generation (non-motion)
  kling30StdNoSoundPerSec: 14,
  kling30StdSoundPerSec: 20,
  kling30ProNoSoundPerSec: 18,
  kling30ProSoundPerSec: 27,
  kling26NoSound5s: 55,
  kling26NoSound10s: 110,
  kling26Sound5s: 110,
  kling26Sound10s: 220,

  // Seedance 2 (piapi.ai) — flat per-second rate (legacy, kept for historical generations)
  seedance2StandardPerSec: 20,
  seedance2FastPerSec: 16,

  // Seedance 2.0 Global via RunningHub (bytedance/seedance-2.0-global).
  // User pays 2× provider cost. 100 credits ≈ $1.
  // I2V and multimodal (no reference video): per-second flat rate, billed by generated seconds.
  seedance2Rh480PerSec: 20,          // $0.10/s × 2
  seedance2Rh720PerSec: 40,          // $0.20/s × 2
  seedance2RhNative1080pPerSec: 100, // $0.50/s × 2
  seedance2Rh1080pPerSec: 48,        // $0.24/s × 2 (upscaled from 720p)
  seedance2Rh2kPerSec: 52,           // $0.26/s × 2 (upscaled)
  seedance2Rh4kPerSec: 58,           // $0.29/s × 2 (upscaled)
  // Seedance Multimodal WITH reference video: billed on max(inputDuration+genDuration, minBillable).
  // Native tiers (480/720/native1080p) use a single per-second rate.
  seedance2Rh480WithVideoPerSec: 12,          // $0.06/s × 2
  seedance2Rh720WithVideoPerSec: 24,          // $0.12/s × 2
  seedance2RhNative1080pWithVideoPerSec: 60,  // $0.30/s × 2
  // Upscaled tiers (1080p/2k/4k) with reference video: base × billable + addon × generated.
  seedance2Rh1080pWithVideoBasePerSec: 24,   // $0.12/s × 2
  seedance2Rh1080pWithVideoAddonPerSec: 8,   // $0.04/s × 2
  seedance2Rh2kWithVideoBasePerSec: 24,      // $0.12/s × 2
  seedance2Rh2kWithVideoAddonPerSec: 12,     // $0.06/s × 2
  seedance2Rh4kWithVideoBasePerSec: 24,      // $0.12/s × 2
  seedance2Rh4kWithVideoAddonPerSec: 18,     // $0.09/s × 2

  videoPrompt5s: 60,
  videoPrompt10s: 100,
  videoFaceSwapPerSec: 10,
  talkingHeadMin: 70,
  talkingHeadPerSecondX10: 13,
});

export const GENERATION_PRICING_KEYS = Object.freeze(Object.keys(DEFAULT_GENERATION_PRICING));
const GENERATION_PRICING_KEY_SET = new Set(GENERATION_PRICING_KEYS);

const CACHE_TTL_MS = 5_000;
let pricingCache = null;
let pricingCacheAt = 0;
const MOTION_X_LEGACY_DEFAULT = 30;
const MOTION_X_MIGRATED_DEFAULT = 6.5;

function sanitizePricingObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const sanitized = {};
  for (const key of GENERATION_PRICING_KEYS) {
    if (!(key in input)) continue;
    const raw = input[key];
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isFinite(value) || value < 0) continue;
    sanitized[key] = Math.round(value * 1000) / 1000;
  }
  return sanitized;
}

export function validateGenerationPricingPatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      error: "Pricing payload object is required",
      unknownKeys: [],
      invalidValueKeys: [],
      cleanPatch: {},
    };
  }
  const unknownKeys = [];
  const invalidValueKeys = [];
  for (const [key, raw] of Object.entries(input)) {
    if (!GENERATION_PRICING_KEY_SET.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isFinite(value) || value < 0) invalidValueKeys.push(key);
  }
  if (unknownKeys.length > 0) {
    return {
      valid: false,
      error: `Unknown generation pricing keys: ${unknownKeys.join(", ")}`,
      unknownKeys,
      invalidValueKeys,
      cleanPatch: {},
    };
  }
  if (invalidValueKeys.length > 0) {
    return {
      valid: false,
      error: `Invalid generation pricing values for keys: ${invalidValueKeys.join(", ")} (must be finite numbers >= 0)`,
      unknownKeys,
      invalidValueKeys,
      cleanPatch: {},
    };
  }
  return {
    valid: true,
    error: null,
    unknownKeys: [],
    invalidValueKeys: [],
    cleanPatch: sanitizePricingObject(input),
  };
}

export function getGenerationPricingContract() {
  return {
    keys: GENERATION_PRICING_KEYS,
    defaults: DEFAULT_GENERATION_PRICING,
    strict: true,
  };
}

export async function getGenerationPricing({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && pricingCache && now - pricingCacheAt < CACHE_TTL_MS) {
    return pricingCache;
  }

  const row = await prisma.generationPricingConfig.findUnique({
    where: { id: "global" },
    select: { values: true, updatedAt: true },
  });

  let raw = row?.values || {};
  if (typeof raw === "object" && raw) {
    let migrated = false;

    // motionX legacy migration
    const currentMotionX = Number(raw.motionXPerSec);
    if (Number.isFinite(currentMotionX) && currentMotionX === MOTION_X_LEGACY_DEFAULT) {
      raw = { ...raw, motionXPerSec: MOTION_X_MIGRATED_DEFAULT };
      migrated = true;
    }

    // Prompt enhancer: old default was 10, new default is 1
    if (Number(raw.enhancePromptDefault) === 10) {
      raw = { ...raw, enhancePromptDefault: 1 };
      migrated = true;
    }
    if (Number(raw.enhancePromptNsfw) === 10) {
      raw = { ...raw, enhancePromptNsfw: 1 };
      migrated = true;
    }

    // SynthID Remover: old default was 10, new default is 20
    if (Number(raw.synthIdRemove) === 10) {
      raw = { ...raw, synthIdRemove: 20 };
      migrated = true;
    }

    if (migrated && row) {
      try {
        await prisma.generationPricingConfig.update({
          where: { id: "global" },
          data: { values: raw },
        });
      } catch {}
    }
  }
  const overrides = sanitizePricingObject(raw);
  const merged = { ...DEFAULT_GENERATION_PRICING, ...overrides };

  if (row) {
    const hasUnknownKeys = Object.keys(raw).some((key) => !GENERATION_PRICING_KEY_SET.has(key));
    const cleanStoredValues = { ...DEFAULT_GENERATION_PRICING, ...overrides };
    const differsFromClean = JSON.stringify(raw) !== JSON.stringify(cleanStoredValues);
    if (hasUnknownKeys || differsFromClean) {
      await prisma.generationPricingConfig.update({
        where: { id: "global" },
        data: { values: cleanStoredValues },
      });
    }
  }

  pricingCache = merged;
  pricingCacheAt = now;
  return merged;
}

export async function updateGenerationPricing(patch) {
  const current = await getGenerationPricing({ forceRefresh: true });
  const validation = validateGenerationPricingPatch(patch);
  if (!validation.valid) {
    const err = new Error(validation.error || "Invalid generation pricing payload");
    err.statusCode = 400;
    err.details = {
      unknownKeys: validation.unknownKeys,
      invalidValueKeys: validation.invalidValueKeys,
    };
    throw err;
  }
  const next = { ...current, ...validation.cleanPatch };

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
