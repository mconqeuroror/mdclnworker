/**
 * Per-provider / per-model input limits for generation (URLs we send to third-party APIs).
 *
 * Defaults incorporate research notes (March 2026) + official pages where cited.
 * Override any value with PROVIDER_LIMIT_* env vars (bytes = plain integers).
 */

import { getBlobClientUploadMaxBytes } from "./blobUpload.js";

function envInt(name, fallback) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return fallback;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFloat(name, fallback) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Comma-separated list, e.g. "5,10" */
function envStringList(name, fallback) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return fallback;
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** KIE — https://docs.kie.ai — model slugs match createTask `model` field */
export const kieConstraints = {
  nanoBananaPro: {
    docHint: "docs.kie.ai — Nano Banana Pro",
    imageMaxBytes: envInt("PROVIDER_LIMIT_KIE_NANO_BANANA_PRO_IMAGE_MAX_BYTES", 30 * 1024 * 1024),
    maxReferenceImages: envInt("PROVIDER_LIMIT_KIE_NANO_BANANA_PRO_MAX_IMAGES", 8),
  },
  seedream45Edit: {
    docHint: "docs.kie.ai/market/seedream/4-5-edit — image_urls[]",
    /** KIE marketing: up to 10 for Seedream 4.x; AIML API cites 14 for same family — default 10, raise via env if you confirm 14 with KIE. */
    maxImageUrls: envInt("PROVIDER_LIMIT_KIE_SEEDREAM_45_EDIT_MAX_IMAGE_URLS", 10),
    imageMaxBytes: envInt("PROVIDER_LIMIT_KIE_SEEDREAM_45_EDIT_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
  },
  kling26ImageToVideo: {
    docHint: "docs.kie.ai/market/kling/image-to-video — duration 5|10 in examples; image size not in KIE doc (Kuaishou ~10MB cited elsewhere)",
    imageMaxBytes: envInt("PROVIDER_LIMIT_KIE_KLING_26_I2V_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
    allowedDurationSeconds: envStringList("PROVIDER_LIMIT_KIE_KLING_26_I2V_ALLOWED_DURATIONS", ["5", "10"]),
  },
  kling30Video: {
    docHint: "docs.kie.ai/market/kling/kling-3.0 — duration enum: 3–15 (any integer string)",
    imageMaxBytes: envInt("PROVIDER_LIMIT_KIE_KLING_30_VIDEO_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
    allowedDurationSeconds: envStringList(
      "PROVIDER_LIMIT_KIE_KLING_30_VIDEO_ALLOWED_DURATIONS",
      ["3","4","5","6","7","8","9","10","11","12","13","14","15"],
    ),
  },
  /** docs.kie.ai/market/kling/motion-control */
  kling26MotionControl: {
    docHint: "KIE official motion-control: ref image ≤10MB JPEG/PNG; video 3–30s, ≤100MB; MP4/MOV/MKV",
    imageMaxBytes: envInt("PROVIDER_LIMIT_KIE_KLING_26_MOTION_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
    videoMaxBytes: envInt("PROVIDER_LIMIT_KIE_KLING_26_MOTION_VIDEO_MAX_BYTES", 100 * 1024 * 1024),
    videoMinDurationSec: envFloat("PROVIDER_LIMIT_KIE_KLING_26_MOTION_VIDEO_MIN_SEC", 3),
    videoMaxDurationSec: envFloat("PROVIDER_LIMIT_KIE_KLING_26_MOTION_VIDEO_MAX_SEC", 30),
  },
  /** docs.kie.ai/market/kling/motion-control-v3 — mirror v2.6 until you confirm MKV/size deltas */
  kling30MotionControl: {
    docHint: "KIE motion-control v3 — confirm vs v2.6 (MKV, byte limits); defaults match v2.6",
    imageMaxBytes: envInt("PROVIDER_LIMIT_KIE_KLING_30_MOTION_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
    videoMaxBytes: envInt("PROVIDER_LIMIT_KIE_KLING_30_MOTION_VIDEO_MAX_BYTES", 100 * 1024 * 1024),
    videoMinDurationSec: envFloat("PROVIDER_LIMIT_KIE_KLING_30_MOTION_VIDEO_MIN_SEC", 3),
    videoMaxDurationSec: envFloat("PROVIDER_LIMIT_KIE_KLING_30_MOTION_VIDEO_MAX_SEC", 30),
  },
};

/**
 * WaveSpeed — wavespeed.ai/models + docs-api
 */
export const waveSpeedConstraints = {
  seedreamV45Edit: {
    docHint: "bytedance/seedream-v4.5/edit",
    imageMaxBytes: envInt("PROVIDER_LIMIT_WS_SEEDREAM_V45_EDIT_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
  },
  /** wavespeed.ai/models/wavespeed-ai/video-face-swap — max duration 10 min official; byte max not published */
  videoFaceSwap: {
    docHint: "WS video-face-swap: 10 min max duration; conservative 500MB byte guard (docs silent on bytes)",
    videoMaxBytes: envInt(
      "PROVIDER_LIMIT_WS_VIDEO_FACE_SWAP_MAX_BYTES",
      500 * 1024 * 1024,
    ),
    videoMinDurationSec: envFloat("PROVIDER_LIMIT_WS_VIDEO_FACE_SWAP_MIN_SEC", 0.4),
    videoMaxDurationSec: envFloat("PROVIDER_LIMIT_WS_VIDEO_FACE_SWAP_MAX_SEC", 10 * 60),
  },
  /** JAI Portal + community: JPEG/PNG/WebP; max bytes not in official WS page — 10MB pragmatic */
  imageFaceSwap: {
    docHint: "wavespeed-ai/image-face-swap — formats JPEG/PNG/WebP; ≤10 faces/image per third-party docs",
    imageMaxBytes: envInt("PROVIDER_LIMIT_WS_IMAGE_FACE_SWAP_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
    maxFacesPerImage: envInt("PROVIDER_LIMIT_WS_IMAGE_FACE_SWAP_MAX_FACES", 10),
  },
  /** docs-api kwaivgi/kling-v2-ai-avatar-standard — up to 5 min output; image byte max not published */
  klingV2AiAvatarStandard: {
    docHint: "Kling v2 AI avatar via WaveSpeed; align user text with ElevenLabs paid TTS (5k)",
    imageMaxBytes: envInt("PROVIDER_LIMIT_WS_KLING_V2_AVATAR_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
    maxOutputClipDurationSec: envFloat("PROVIDER_LIMIT_WS_KLING_V2_AVATAR_MAX_OUTPUT_SEC", 5 * 60),
    textMaxChars: envInt("PROVIDER_LIMIT_WS_KLING_V2_AVATAR_TEXT_MAX_CHARS", 5000),
  },
  /** Catalog exists; public input limits thin — use WAN 2.2 720p family as baseline until WS publishes */
  wan22SpicyImageToVideo: {
    docHint: "wan-2.2-spicy-image-to-video — see wan-2.2-i2v-720p family for baseline",
    imageMaxBytes: envInt("PROVIDER_LIMIT_WS_WAN22_SPICY_I2V_IMAGE_MAX_BYTES", 10 * 1024 * 1024),
    outputResolutionHint: "720p",
  },
  wan22SpicyVideoExtend: {
    docHint: "wan-2.2-spicy-video-extend — limits not documented; conservative defaults",
    videoMaxBytes: envInt("PROVIDER_LIMIT_WS_WAN22_SPICY_EXTEND_VIDEO_MAX_BYTES", 500 * 1024 * 1024),
  },
};

/** fal.ai — fal-ai/z-image-turbo-trainer-v2 */
export const falConstraints = {
  zImageTurboTrainerV2: {
    docHint: "fal.ai z-image trainer — ZIP via URL; min ~10 images recommended; ZIP/pixel caps not published",
    zipMaxBytes: envInt("PROVIDER_LIMIT_FAL_Z_IMAGE_TRAINER_ZIP_MAX_BYTES", 500 * 1024 * 1024),
    minRecommendedImages: envInt("PROVIDER_LIMIT_FAL_Z_IMAGE_TRAINER_MIN_IMAGES", 10),
    /** Z-Image Turbo inference ~4MP — pragmatic cap for assets inside ZIP (not enforced byte-by-byte here) */
    maxMegapixelsPerImage: envInt("PROVIDER_LIMIT_FAL_Z_IMAGE_TRAINER_MAX_MEGAPIXELS", 4),
  },
};

/** HeyGen — docs.heygen.com; byte limits often behind reference/limits */
export const heyGenConstraints = {
  photoAvatar: {
    docHint: "upload.heygen.com/v1/talking_photo — JPEG in examples; max bytes not public",
    /** Conservative until limits table confirmed */
    uploadMaxBytes: envInt("PROVIDER_LIMIT_HEYGEN_PHOTO_AVATAR_MAX_BYTES", 25 * 1024 * 1024),
  },
  videoGenerationTextMaxChars: envInt("PROVIDER_LIMIT_HEYGEN_VIDEO_TEXT_MAX_CHARS", 5000),
};

/** ElevenLabs — elevenlabs.io/docs; clone file size often unspecified in public pages */
export const elevenLabsConstraints = {
  voiceCloneUploadMaxBytes: envInt(
    "PROVIDER_LIMIT_ELEVENLABS_VOICE_CLONE_MAX_BYTES",
    25 * 1024 * 1024,
  ),
  ttsMaxCharsPaid: envInt("PROVIDER_LIMIT_ELEVENLABS_TTS_MAX_CHARS", 5000),
};

/**
 * OpenRouter — confirm at openrouter.ai/models for exact routed model.
 * x-ai/grok-4.1-fast: window/output not verified here; override via env when you lock values.
 */
export const openRouterConstraints = {
  defaultContextTokens: envInt("PROVIDER_LIMIT_OPENROUTER_CONTEXT_TOKENS", 131_072),
  defaultMaxOutputTokens: envInt("PROVIDER_LIMIT_OPENROUTER_MAX_OUTPUT_TOKENS", 16_384),
};

/** Your RunPod handler — not enforced by RunPod platform */
export const runPodConstraints = {
  docHint: "Document limits in your serverless handler; platform is memory/disk of the pod",
  notePublicUrlsOnly: true,
};

/** Replicate admin / test routes */
export const replicateConstraints = {
  maxUploadBytesPerFile: envInt("PROVIDER_LIMIT_REPLICATE_MAX_UPLOAD_BYTES", 500 * 1024 * 1024),
  defaultTimeoutMinutes: envInt("PROVIDER_LIMIT_REPLICATE_TIMEOUT_MINUTES", 30),
};

/**
 * Genuinely undocumented after research (March 2026) — still need vendor confirmation.
 * @type {{ area: string, modelOrEndpoint: string, stillMissing: string[] }[]}
 */
export const PROVIDER_SPEC_GAPS = [
  {
    area: "WaveSpeed",
    modelOrEndpoint: "wavespeed-ai/video-face-swap",
    stillMissing: ["Max video file size in bytes (we use 500MB default)"],
  },
  {
    area: "WaveSpeed",
    modelOrEndpoint: "wavespeed-ai/image-face-swap",
    stillMissing: ["Official max image bytes", "Official max resolution"],
  },
  {
    area: "WaveSpeed",
    modelOrEndpoint: "kwaivgi/kling-v2-ai-avatar-standard",
    stillMissing: ["Max input image bytes", "Explicit input formats in WS doc"],
  },
  {
    area: "WaveSpeed",
    modelOrEndpoint: "wan-2.2-spicy (I2V + extend)",
    stillMissing: ["Published input size/duration/resolution tables"],
  },
  {
    area: "KIE",
    modelOrEndpoint: "seedream/4.5-edit",
    stillMissing: ["Per-image max bytes in KIE docs"],
  },
  {
    area: "KIE",
    modelOrEndpoint: "kling-2.6/image-to-video & kling-3.0/video",
    stillMissing: ["Official max input image bytes", "Full aspect-ratio matrix in KIE docs"],
  },
  {
    area: "KIE",
    modelOrEndpoint: "kling-3.0/motion-control",
    stillMissing: ["Confirm parity with v2.6 on MKV, durations, byte caps"],
  },
  {
    area: "fal.ai",
    modelOrEndpoint: "fal-ai/z-image-turbo-trainer-v2",
    stillMissing: ["Official max ZIP bytes", "Max training image count", "Enforced megapixel limit inside ZIP"],
  },
  {
    area: "HeyGen",
    modelOrEndpoint: "photo avatar upload",
    stillMissing: ["Official max upload bytes (see docs.heygen.com/reference/limits)"],
  },
  {
    area: "ElevenLabs",
    modelOrEndpoint: "voices/add (clone)",
    stillMissing: ["Hard per-file byte limit in API reference if not public"],
  },
];
