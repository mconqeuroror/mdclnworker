import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { authMiddleware, setAuthCookie, setRefreshCookie } from "../middleware/auth.middleware.js";
import { adminMiddleware } from "../middleware/admin.middleware.js";
import { BackupService } from "../services/backup.service.js";
import { sendPromoEmail } from "../services/email.service.js";
import { getAppBranding, updateAppBranding, clearTutorialVideo, clearLanderDemoVideo } from "../services/branding.service.js";
import multer from "multer";
import { getBlobClientUploadMaxBytes } from "../config/blobUpload.js";
import { del } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";
import { isVercelBlobConfigured, uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import { isR2Configured, uploadBufferToR2, uploadFileToR2, mirrorToR2 } from "../utils/r2.js";
import {
  getTutorialCatalog,
  getTutorialSlot,
  isTutorialSlotTableError,
  isValidTutorialSlot,
  uploadTutorialSlotMedia,
  upsertTutorialSlotVideoUrl,
} from "../services/tutorial-videos.service.js";
import {
  getLatestEndpointHealthSnapshots,
  getTelemetryOverview,
} from "../services/telemetry.service.js";
import {
  DEFAULT_GENERATION_PRICING,
  getGenerationPricingContract,
  getGenerationPricing,
  updateGenerationPricing,
  resetGenerationPricing,
  validateGenerationPricingPatch,
} from "../services/generation-pricing.service.js";
import {
  getPromptTemplateOverrides,
  getPromptTemplateValue,
  upsertPromptTemplateOverrides,
} from "../services/prompt-template-config.service.js";
import {
  DEFAULT_WINBACK_EMAIL_TEMPLATE,
  getWinbackEmailTemplate,
  upsertWinbackEmailTemplate,
} from "../services/winback-email-template.service.js";
import {
  getNudesPackPoseOverrides,
  upsertNudesPackPoseOverrides,
  getEffectiveNudesPackPoses,
} from "../services/nudes-pack-config.service.js";
import { NUDES_PACK_POSES } from "../../shared/nudesPackPoses.js";
import {
  DEFAULT_GENERATION_SAFETY_CONFIG,
  getGenerationSafetyConfig,
  upsertGenerationSafetyConfig,
} from "../services/generation-safety-config.service.js";
import { fetchAllProviderBalances } from "../services/provider-balances.service.js";
import {
  getVoicePlatformConfig,
  updateVoicePlatformMaxVoices,
  countModelsWithCustomVoice,
} from "../services/voice-platform.service.js";
import {
  listElevenLabsAccountVoices,
  deleteElevenLabsVoiceStrict,
} from "../services/elevenlabs.service.js";

const router = express.Router();
const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_URL = "https://api.kie.ai/api/v1";
const MARKETING_CAMPAIGN_ACTION = "marketing_campaign";
const SENDGRID_MAX_EMAILS_PER_MINUTE = Math.max(
  1,
  parseInt(process.env.SENDGRID_MAX_EMAILS_PER_MINUTE || "600", 10) || 600,
);
const SENDGRID_WINDOW_MS = 60_000;

const PROMPT_TEMPLATE_KNOWN_KEYS = [
  "modelcloneXZImageTurbo",
  "soulxZImageTurbo",
  "nsfwPromptGenerator",
  "analyzeLooksSystemPrompt",
  "enhancePromptNanoBananaSystem",
  "enhancePromptNsfwSystem",
  "nudesPackPromptGeneratorSystem",
  "nudesPackPromptGeneratorUserWrapper",
  "describeTargetImageSystemPrompt",
  "img2imgInjectSystemPrompt",
  "falCaptionSystemPrompt",
  "falLoraSelectorSystemPrompt",
  "nsfwLoraStrengthSystemPrompt",
  "nsfwAutoDetectAppearanceSystemPrompt",
  "nsfwAutoSelectOptionsSystemPrompt",
  "nanoBananaModelPromptEnhancerSystem",
  "nanoBananaModelPromptEnhancerUserWrapper",
  "nanoBananaModelReferenceBasePrompt",
  "nanoBananaModelSelfieBasePrompt",
  "nanoBananaModelPortraitBasePrompt",
  "nanoBananaModelFullBodyBasePrompt",
];

const PROMPT_TEMPLATE_DEFAULTS = {
  modelcloneXZImageTurbo:
    `You are a senior prompt director for Z-Image Turbo (Tongyi-MAI 6B S3-DiT Turbo). Your job is to transform a user's rough idea into one polished, detailed POSITIVE prompt that produces stunning, photorealistic results.

Z-Image Turbo responds best to natural descriptive prose, not tag lists. Write one flowing paragraph that covers:
1. Shot type + framing (close-up portrait, cowboy shot, full body, POV, etc.)
2. Subject description — if MODEL IDENTITY CONTEXT is provided, weave those traits in naturally as the subject. Do not invent conflicting attributes.
3. Exact clothing, state of dress, and what is or isn't covered — be precise and explicit if the scene calls for it
4. Action, pose, expression, eye contact
5. Environment and background with specific details
6. Lighting setup (golden hour, studio softbox, candlelight, neon, etc.)
7. Camera feel (35mm f/1.8, telephoto compression, smartphone POV, etc.)
8. Overall mood and color grading

Rules:
- Output ONLY the final positive prompt — no preamble, no explanation, no headings
- NEVER include negative terms, quality disclaimers, or anatomy constraints — those are handled separately
- If trigger word is provided in the identity context, do NOT include it — it is injected automatically
- Preserve every user-specified detail; only add richness, never contradict or water down the request
- Keep it under 200 words, one clean paragraph`,
  soulxZImageTurbo:
    `You are a senior prompt director for Z-Image Turbo (Tongyi-MAI 6B S3-DiT Turbo). Your job is to transform a user's rough idea into one polished, detailed POSITIVE prompt that produces stunning, photorealistic results.

Z-Image Turbo responds best to natural descriptive prose, not tag lists. Write one flowing paragraph that covers:
1. Shot type + framing (close-up portrait, cowboy shot, full body, POV, etc.)
2. Subject description — if MODEL IDENTITY CONTEXT is provided, weave those traits in naturally as the subject. Do not invent conflicting attributes.
3. Exact clothing, state of dress, and what is or isn't covered — be precise and explicit if the scene calls for it
4. Action, pose, expression, eye contact
5. Environment and background with specific details
6. Lighting setup (golden hour, studio softbox, candlelight, neon, etc.)
7. Camera feel (35mm f/1.8, telephoto compression, smartphone POV, etc.)
8. Overall mood and color grading

Rules:
- Output ONLY the final positive prompt — no preamble, no explanation, no headings
- NEVER include negative terms, quality disclaimers, or anatomy constraints — those are handled separately
- If trigger word is provided in the identity context, do NOT include it — it is injected automatically
- Preserve every user-specified detail; only add richness, never contradict or water down the request
- Keep it under 200 words, one clean paragraph`,
  nsfwPromptGenerator:
    'You are an expert prompt engineer for Z-Image Turbo with private amateur smartphone realism. Keep outputs raw, imperfect, non-studio, logically consistent, and identity-locked to provided model attributes/chips. Output format must be exactly one JSON array with one prompt string.',
  analyzeLooksSystemPrompt:
    "You are an expert at analyzing photos of people to determine physical appearance for AI model configuration. Return one JSON object for the same person across all photos, using exact allowed option values and age as integer 1-120.",
  enhancePromptNanoBananaSystem:
    "You are a creative director prompt engineer for Nano Banana Pro. Rewrite user ideas into production-ready prompts with specific subject/action/context/composition/style, preserve user intent and modelLooks, keep results photoreal and distinctive, and enforce true selfie POV constraints when selfie is requested.",
  enhancePromptNsfwSystem:
    "You are an expert prompt engineer for an Illustrious-based NSFW ComfyUI diffusion model (checkpoint: pornworksRealPorn_Illustrious). This model is trained on Danbooru and responds best to tag-format prompts, not sentences.\n\nYour job: transform a rough user idea into an optimized POSITIVE tag-format superprompt. Output ONLY the final tag list — no explanation, no preamble. Do NOT include any negative tags — negative prompts are handled separately by the system.\n\n## RULES FOR THIS MODEL:\n- Comma-separated short tag phrases — NOT sentences\n- Always lead with quality boosters: \"masterpiece, best quality, ultra-detailed, ultra-realistic, 8k uhd, RAW photo, sharp focus\"\n- Subject tags: precise age, ethnicity, body type, skin tone\n- Feature tags: hair color, hair length, hair style, eye color\n- Clothing tags: explicit and specific — fabric, fit, coverage level\n- Action/pose: \"arching back\", \"lying on satin sheets\", \"looking at viewer\", \"bedroom eyes\", \"parted lips\"\n- Setting: \"indoor\", \"bedroom\", \"dimly lit room\", \"bokeh background\", \"soft ambient light\"\n- Camera: \"close-up\", \"cowboy shot\", \"POV\", \"from below\"\n- Lighting: \"soft diffused light\", \"dramatic side lighting\", \"candlelight glow\", \"rim light\"\n\n## OUTPUT:\nPositive tag list only, comma-separated. 40–70 tags.",
  nudesPackPromptGeneratorSystem:
    "You are an expert prompt engineer for Z-Image Turbo NSFW generation focused on realistic private smartphone-photo feel. Respect model attributes and logical constraints, avoid contradictions, and output exactly one JSON array with one prompt.",
  nudesPackPromptGeneratorUserWrapper:
    "Compose one final NSFW prompt for this nudes-pack item. Use the full request as source-of-truth.\n\n{{REQUEST}}",
  describeTargetImageSystemPrompt:
    'You are an expert at describing reference images for AI identity recreation. Start with model name, describe scene/pose/camera/lighting/background/mood, avoid identity-trait details, keep under 150 words, output one paragraph only.',
  img2imgInjectSystemPrompt:
    "You are an expert prompt engineer for ComfyUI ZIT img2img workflows. Output one clean prompt that starts with trigger word, rewrites TARGET_CHARACTER_LOOKS into natural prose (no field labels), preserves scene/camera/lighting from original prompt, and swaps only identity.",
  falCaptionSystemPrompt:
    "You are an expert image captioner for Z-Image Turbo LoRA training datasets. Start each caption with trigger word (+ locked subject class if provided), describe visible pose/camera/clothing/environment/lighting/style, avoid fixed identity over-specification, and keep concise training-stable captions.",
  falLoraSelectorSystemPrompt:
    "You are an LoRA selector assistant. Pick pose LoRA and enhancement LoRAs from allowed lists based on scene/chips/final prompt, respect logical rules, and return only one-line JSON with strengths and effect toggles.",
  nsfwLoraStrengthSystemPrompt:
    "You are a LoRA strength calculator for AI image generation. Return only one decimal between 0.55 and 0.80 based on face visibility prominence in the scene.",
  nsfwAutoDetectAppearanceSystemPrompt:
    "You are an expert physical appearance analyst for AI model training. Analyze all photos of the same person and return complete JSON using only allowed selector options.",
  nsfwAutoSelectOptionsSystemPrompt:
    "You are a smart assistant that maps scene descriptions to the best matching predefined selector options. Respect logical constraints, choose only relevant keys, and output only valid JSON.",
  nanoBananaModelPromptEnhancerSystem:
    "You are a senior prompt director for Nano Banana Pro. Rewrite prompts with concrete specifics, coherent camera/light direction, preserved identity constraints, and premium realistic quality. For ai-model-reference, force stunning unique realism; for ai-model-selfie, force palm/arm-length selfie POV constraints.",
  nanoBananaModelPromptEnhancerUserWrapper:
    "Rewrite this Nano Banana prompt using best practices while preserving all mandatory identity and reference constraints.\n\nOperation: {{OPERATION}}\nAspect ratio: {{ASPECT_RATIO}}\nResolution: {{RESOLUTION}}\nReference count: {{REFERENCE_COUNT}}\n\nBase prompt:\n{{PROMPT}}",
  nanoBananaModelReferenceBasePrompt:
    "beautiful portrait photo of {{ARTICLE}} {{SUBJECT}}, {{HERITAGE_TEXT}}, {{FACE_TYPE_TEXT}}, {{HAIR_TEXT}}, {{EYE_TEXT}}, {{LIP_TEXT}}, {{BODY_TYPE_TEXT}}, {{STYLE_TEXT}}, {{SAVED_APPEARANCE_TEXT}}, {{REFERENCE_PROMPT}}, high quality, detailed face, clear features, photorealistic, attractive, {{SKIN_TEXTURE}}",
  nanoBananaModelSelfieBasePrompt:
    "Using image 1 as identity reference, create a close-up selfie of this exact same person. {{PROFILE_SENTENCE}} Keep the exact same face, facial features, hair color, eye color. True self-captured palm/arm-length first-person selfie POV, front-facing camera vibe, attractive selfie pose, alluring expression, no second photographer, no visible phone/device in hand, no mirror reflection. {{BASE_ENHANCEMENT}}. High quality, photorealistic, natural skin texture with visible pores, clear skin without acne.",
  nanoBananaModelPortraitBasePrompt:
    "Using images 1 and 2 as identity reference, create a 3/4 angle portrait of this exact same person. {{PROFILE_SENTENCE}} Keep the exact same face, facial features, hair color, eye color from the reference images. Captivating look, studio lighting. {{BASE_ENHANCEMENT}}. High quality, photorealistic, natural skin texture with visible pores, clear skin without acne.",
  nanoBananaModelFullBodyBasePrompt:
    "Using images 1 and 2 as identity references, create a full body photo of the same person. Preserve exact identity: face structure, skin tone, hairline, eye shape and key facial details from references. Outfit/clothing: {{OUTFIT_TEXT}}. Body proportions: {{BODY_DESCRIPTOR}}. Character/profile traits: {{CHARACTER_DESCRIPTOR}}. Pose/composition: full figure visible from head to toe, natural realistic anatomy, professional lighting. {{EXTRA_DIRECTION}} Photorealistic, high quality details, natural skin texture.",
};

async function buildEffectivePromptTemplates(overrides = {}) {
  const effective = {};
  for (const key of PROMPT_TEMPLATE_KNOWN_KEYS) {
    const raw = overrides?.[key];
    if (typeof raw === "string" && raw.trim()) {
      effective[key] = raw;
      continue;
    }
    const fallback = PROMPT_TEMPLATE_DEFAULTS[key] || "";
    effective[key] = await getPromptTemplateValue(key, fallback);
  }
  return effective;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createSendGridRateLimiter(maxPerMinute = SENDGRID_MAX_EMAILS_PER_MINUTE) {
  let windowStart = Date.now();
  let sentInWindow = 0;
  return async (emailCount = 1) => {
    const units = Math.max(1, parseInt(emailCount, 10) || 1);
    while (true) {
      const now = Date.now();
      if (now - windowStart >= SENDGRID_WINDOW_MS) {
        windowStart = now;
        sentInWindow = 0;
      }
      if (sentInWindow + units <= maxPerMinute) {
        sentInWindow += units;
        return;
      }
      const waitMs = Math.max(250, SENDGRID_WINDOW_MS - (now - windowStart) + 50);
      await sleep(waitMs);
    }
  };
}

function parseJsonSafe(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function updateMarketingCampaignAudit(campaignId, updater) {
  const row = await prisma.adminAuditLog.findFirst({
    where: { action: MARKETING_CAMPAIGN_ACTION, targetId: campaignId },
    select: { id: true, detailsJson: true },
  });
  if (!row) return null;
  const prev = parseJsonSafe(row.detailsJson, {}) || {};
  const next = await updater(prev);
  await prisma.adminAuditLog.update({
    where: { id: row.id },
    data: { detailsJson: JSON.stringify(next) },
  });
  return next;
}

const uploadEmailVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/x-mp4", "video/quicktime", "video/webm"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else if (file.mimetype?.startsWith("video/")) cb(null, true);
    else if (file.mimetype === "application/octet-stream" && /\.(mp4|mov|webm|m4v)$/i.test(file.originalname || "")) cb(null, true);
    else cb(new Error("Only video files (MP4, MOV, WebM) are allowed."));
  },
});

function handleVideoUpload(fieldName = "video") {
  return (req, res, next) => {
    uploadEmailVideo.single(fieldName)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            success: false,
            error: "Video file too large. Max 200MB.",
          });
        }
        return res.status(400).json({
          success: false,
          error: err?.message || "Invalid video file",
        });
      }
      next();
    });
  };
}

// All admin routes require authentication and admin role
router.use(authMiddleware, adminMiddleware);

router.get("/branding", async (_req, res) => {
  try {
    const branding = await getAppBranding();
    res.json({ success: true, branding });
  } catch (error) {
    console.error("Error fetching brand settings:", error);
    res.status(500).json({ success: false, error: "Failed to fetch brand settings" });
  }
});

router.put("/branding", async (req, res) => {
  try {
    const {
      appName,
      logoUrl,
      faviconUrl,
      baseUrl,
      tutorialVideoUrl,
      landerDemoVideoUrl,
      termsMarkdown,
      privacyMarkdown,
      cookiesMarkdown,
    } = req.body || {};
    const branding = await updateAppBranding({
      appName,
      logoUrl,
      faviconUrl,
      baseUrl,
      tutorialVideoUrl,
      landerDemoVideoUrl,
      termsMarkdown,
      privacyMarkdown,
      cookiesMarkdown,
    });
    res.json({ success: true, branding });
  } catch (error) {
    console.error("Error updating brand settings:", error);
    res.status(400).json({ success: false, error: error.message || "Failed to update brand settings" });
  }
});

// POST /api/admin/tutorial-video — upload a new tutorial video to R2
router.post(
  "/tutorial-video",
  handleVideoUpload("video"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: "No video file provided" });
      if (!isR2Configured()) return res.status(503).json({ success: false, error: "R2 storage not configured" });

      const ext = req.file.originalname?.match(/\.[^.]+$/)?.[0]?.toLowerCase() || ".mp4";
      const key = `static/dashboard_video${ext}`;
      const url = await uploadBufferToR2(req.file.buffer, key, req.file.mimetype || "video/mp4");

      // Persist URL in branding
      const branding = await getAppBranding();
      await updateAppBranding({ ...branding, tutorialVideoUrl: url });

      res.json({ success: true, url });
    } catch (error) {
      console.error("Tutorial video upload error:", error);
      res.status(500).json({ success: false, error: error.message || "Upload failed" });
    }
  },
);

// DELETE /api/admin/tutorial-video — reset tutorial video to default
router.delete("/tutorial-video", async (_req, res) => {
  try {
    await clearTutorialVideo();
    res.json({ success: true });
  } catch (error) {
    console.error("Tutorial video delete error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/lander-demo-video — upload MP4 for /create-ai-model hero demo (R2)
router.post(
  "/lander-demo-video",
  handleVideoUpload("video"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: "No video file provided" });
      if (!isR2Configured()) return res.status(503).json({ success: false, error: "R2 storage not configured" });

      const ext = req.file.originalname?.match(/\.[^.]+$/)?.[0]?.toLowerCase() || ".mp4";
      const key = `static/create_ai_model_lander_demo${ext}`;
      const url = await uploadBufferToR2(req.file.buffer, key, req.file.mimetype || "video/mp4");

      const branding = await getAppBranding();
      await updateAppBranding({ ...branding, landerDemoVideoUrl: url });

      res.json({ success: true, url });
    } catch (error) {
      console.error("Lander demo video upload error:", error);
      res.status(500).json({ success: false, error: error.message || "Upload failed" });
    }
  },
);

router.delete("/lander-demo-video", async (_req, res) => {
  try {
    await clearLanderDemoVideo();
    res.json({ success: true });
  } catch (error) {
    console.error("Lander demo video delete error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/tutorial-video-slots", async (_req, res) => {
  try {
    const catalog = await getTutorialCatalog();
    res.json({ success: true, slots: catalog.entries, byKey: catalog.byKey });
  } catch (error) {
    console.error("Tutorial slots fetch error:", error);
    res.status(500).json({ success: false, error: error.message || "Failed to load tutorial slots" });
  }
});

// Client → Vercel Blob (admin only): browser uploads directly; server mints tokens via handleUpload (no server-side put()).
router.post("/upload/blob", async (req, res) => {
  if (!isVercelBlobConfigured()) {
    return res.status(503).json({ success: false, error: "Blob storage not configured" });
  }
  try {
    const body = req.body;
    if (!body || typeof body.type !== "string") {
      return res.status(400).json({ success: false, error: "Invalid handleUpload body" });
    }
    const requestWithUrl = { ...req, url: req.originalUrl || req.url || "/api/admin/upload/blob" };
    const jsonResponse = await handleUpload({
      body,
      request: requestWithUrl,
      onBeforeGenerateToken: async (pathname, clientPayload, _multipart) => {
        if (typeof pathname !== "string" || !pathname.startsWith("tutorials/")) {
          throw new Error("Tutorial uploads must use pathname under tutorials/");
        }
        const slot = String(clientPayload || "").trim();
        if (!isValidTutorialSlot(slot)) {
          throw new Error("Invalid tutorial slot");
        }
        return {
          allowedContentTypes: [
            "video/mp4",
            "video/quicktime",
            "video/webm",
            "video/x-msvideo",
            "application/octet-stream",
          ],
          maximumSizeInBytes: getBlobClientUploadMaxBytes(),
          addRandomSuffix: true,
          tokenPayload: slot,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("[admin/blob] Tutorial client upload completed:", blob?.url?.slice(0, 80));
      },
    });
    return res.json(jsonResponse);
  } catch (err) {
    console.error("[admin/upload/blob] handleUpload error:", err?.message || err);
    return res.status(400).json({ success: false, error: err?.message || "Upload token failed" });
  }
});

// After client upload(), persist the public blob URL for this slot.
router.post("/tutorial-video-slot-commit", async (req, res) => {
  try {
    const slotKey = String(req.body?.slot || "").trim();
    const url = String(req.body?.url || "").trim();
    if (!isValidTutorialSlot(slotKey)) {
      return res.status(400).json({ success: false, error: "Invalid tutorial slot" });
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ success: false, error: "Invalid video URL" });
    }
    if (parsed.protocol !== "https:") {
      return res.status(400).json({ success: false, error: "Video URL must be https" });
    }
    await upsertTutorialSlotVideoUrl(slotKey, url);
    const slot = getTutorialSlot(slotKey);
    res.json({
      success: true,
      slot: slotKey,
      label: slot?.label || slotKey,
      url,
      storage: "vercel-blob-client",
    });
  } catch (error) {
    console.error("Tutorial slot commit error:", error);
    if (isTutorialSlotTableError(error)) {
      return res.status(503).json({
        success: false,
        error:
          "Database could not store the tutorial URL (TutorialSlotVideo table). Grant CREATE on the DB or run prisma migrate deploy.",
      });
    }
    res.status(500).json({ success: false, error: error.message || "Save failed" });
  }
});

router.post(
  "/tutorial-video-slot",
  handleVideoUpload("video"),
  async (req, res) => {
    let uploadedUrl = null;
    let storageKind = null;
    try {
      if (!req.file) return res.status(400).json({ success: false, error: "No video file provided" });

      const slotKey = String(req.body?.slot || "").trim();
      if (!isValidTutorialSlot(slotKey)) {
        return res.status(400).json({ success: false, error: "Invalid tutorial slot" });
      }

      const { url, storage } = await uploadTutorialSlotMedia(
        req.file.buffer,
        slotKey,
        req.file.originalname,
        req.file.mimetype || "video/mp4",
      );
      uploadedUrl = url;
      storageKind = storage;
      await upsertTutorialSlotVideoUrl(slotKey, url);

      const slot = getTutorialSlot(slotKey);
      res.json({
        success: true,
        slot: slotKey,
        label: slot?.label || slotKey,
        url,
        storage,
      });
    } catch (error) {
      if (uploadedUrl && storageKind === "vercel-blob" && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          await del(uploadedUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
        } catch (_) {
          /* non-fatal */
        }
      }
      console.error("Tutorial slot upload error:", error);
      if (isTutorialSlotTableError(error)) {
        return res.status(503).json({
          success: false,
          error:
            "Database could not store the tutorial URL (TutorialSlotVideo table). Grant CREATE on the DB or run prisma migrate deploy.",
        });
      }
      res.status(500).json({ success: false, error: error.message || "Upload failed" });
    }
  },
);

router.get("/pricing/generation", async (_req, res) => {
  try {
    const pricing = await getGenerationPricing();
    res.json({
      success: true,
      pricing,
      defaults: DEFAULT_GENERATION_PRICING,
      contract: getGenerationPricingContract(),
    });
  } catch (error) {
    console.error("Error fetching generation pricing:", error);
    res.status(500).json({ success: false, error: "Failed to fetch generation pricing" });
  }
});

router.put("/pricing/generation", async (req, res) => {
  try {
    const patch = req.body?.pricing && typeof req.body.pricing === "object"
      ? req.body.pricing
      : req.body;
    const validation = validateGenerationPricingPatch(patch);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error || "Invalid generation pricing payload",
        unknownKeys: validation.unknownKeys,
        invalidValueKeys: validation.invalidValueKeys,
      });
    }
    const pricing = await updateGenerationPricing(patch);
    res.json({ success: true, pricing });
  } catch (error) {
    console.error("Error updating generation pricing:", error);
    res.status(500).json({ success: false, error: "Failed to update generation pricing" });
  }
});

router.post("/pricing/generation/reset", async (_req, res) => {
  try {
    const pricing = await resetGenerationPricing();
    res.json({ success: true, pricing, contract: getGenerationPricingContract() });
  } catch (error) {
    console.error("Error resetting generation pricing:", error);
    res.status(500).json({ success: false, error: "Failed to reset generation pricing" });
  }
});

router.get("/prompt-templates", async (_req, res) => {
  try {
    const templates = await getPromptTemplateOverrides();
    const effectiveTemplates = await buildEffectivePromptTemplates(templates);
    res.json({
      success: true,
      templates,
      effectiveTemplates,
      knownKeys: PROMPT_TEMPLATE_KNOWN_KEYS,
    });
  } catch (error) {
    console.error("Error fetching prompt templates:", error);
    res.status(500).json({ success: false, error: "Failed to fetch prompt templates" });
  }
});

router.put("/prompt-templates", async (req, res) => {
  try {
    const next = req.body?.templates && typeof req.body.templates === "object"
      ? req.body.templates
      : req.body;
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return res.status(400).json({ success: false, error: "Templates object is required" });
    }
    const templates = await upsertPromptTemplateOverrides(next, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    const effectiveTemplates = await buildEffectivePromptTemplates(templates);
    res.json({ success: true, templates, effectiveTemplates, knownKeys: PROMPT_TEMPLATE_KNOWN_KEYS });
  } catch (error) {
    console.error("Error updating prompt templates:", error);
    res.status(500).json({ success: false, error: "Failed to update prompt templates" });
  }
});

router.get("/winback-email-template", async (_req, res) => {
  try {
    const template = await getWinbackEmailTemplate();
    res.json({ success: true, template, defaults: DEFAULT_WINBACK_EMAIL_TEMPLATE });
  } catch (error) {
    console.error("Error fetching winback email template:", error);
    res.status(500).json({ success: false, error: "Failed to fetch winback email template" });
  }
});

router.put("/winback-email-template", async (req, res) => {
  try {
    const next = req.body?.template && typeof req.body.template === "object"
      ? req.body.template
      : req.body;
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return res.status(400).json({ success: false, error: "Template object is required" });
    }
    const template = await upsertWinbackEmailTemplate(next, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    res.json({ success: true, template, defaults: DEFAULT_WINBACK_EMAIL_TEMPLATE });
  } catch (error) {
    console.error("Error updating winback email template:", error);
    res.status(500).json({ success: false, error: "Failed to update winback email template" });
  }
});

router.get("/safety-checker-config", async (_req, res) => {
  try {
    const config = await getGenerationSafetyConfig();
    res.json({ success: true, config, defaults: DEFAULT_GENERATION_SAFETY_CONFIG });
  } catch (error) {
    console.error("Error fetching safety checker config:", error);
    res.status(500).json({ success: false, error: "Failed to fetch safety checker config" });
  }
});

router.put("/safety-checker-config", async (req, res) => {
  try {
    const next = req.body?.config && typeof req.body.config === "object"
      ? req.body.config
      : req.body;
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return res.status(400).json({ success: false, error: "Config object is required" });
    }
    const config = await upsertGenerationSafetyConfig(next, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    res.json({ success: true, config });
  } catch (error) {
    console.error("Error updating safety checker config:", error);
    res.status(500).json({ success: false, error: "Failed to update safety checker config" });
  }
});

router.get("/nudes-pack-poses", async (_req, res) => {
  try {
    const overrides = await getNudesPackPoseOverrides();
    const poses = await getEffectiveNudesPackPoses();
    const catalog = NUDES_PACK_POSES.map((pose) => {
      const override = overrides?.[pose.id] || {};
      const enabled = override.enabled !== false;
      return {
        ...pose,
        ...(typeof override.title === "string" ? { title: override.title } : {}),
        ...(typeof override.summary === "string" ? { summary: override.summary } : {}),
        ...(typeof override.promptFragment === "string" ? { promptFragment: override.promptFragment } : {}),
        ...(typeof override.category === "string" ? { category: override.category } : {}),
        enabled,
      };
    });
    res.json({ success: true, overrides, poses, catalog });
  } catch (error) {
    console.error("Error fetching nudes-pack poses:", error);
    res.status(500).json({ success: false, error: "Failed to fetch nudes-pack poses" });
  }
});

router.put("/nudes-pack-poses", async (req, res) => {
  try {
    const next = req.body?.overrides && typeof req.body.overrides === "object"
      ? req.body.overrides
      : req.body;
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return res.status(400).json({ success: false, error: "Overrides object is required" });
    }
    const overrides = await upsertNudesPackPoseOverrides(next, {
      userId: req.user?.userId,
      email: req.user?.email,
    });
    const poses = await getEffectiveNudesPackPoses();
    const catalog = NUDES_PACK_POSES.map((pose) => {
      const override = overrides?.[pose.id] || {};
      const enabled = override.enabled !== false;
      return {
        ...pose,
        ...(typeof override.title === "string" ? { title: override.title } : {}),
        ...(typeof override.summary === "string" ? { summary: override.summary } : {}),
        ...(typeof override.promptFragment === "string" ? { promptFragment: override.promptFragment } : {}),
        ...(typeof override.category === "string" ? { category: override.category } : {}),
        enabled,
      };
    });
    res.json({ success: true, overrides, poses, catalog });
  } catch (error) {
    console.error("Error updating nudes-pack poses:", error);
    res.status(500).json({ success: false, error: "Failed to update nudes-pack poses" });
  }
});

router.get("/voice-platform/config", async (_req, res) => {
  try {
    const cfg = await getVoicePlatformConfig();
    const used = await countModelsWithCustomVoice();
    res.json({
      success: true,
      maxCustomElevenLabsVoices: cfg.maxCustomElevenLabsVoices,
      usedCustomVoices: used,
    });
  } catch (error) {
    console.error("Error fetching voice platform config:", error);
    res.status(500).json({ success: false, error: "Failed to fetch voice platform config" });
  }
});

router.put("/voice-platform/config", async (req, res) => {
  try {
    const row = await updateVoicePlatformMaxVoices(req.body?.maxCustomElevenLabsVoices);
    const used = await countModelsWithCustomVoice();
    res.json({
      success: true,
      maxCustomElevenLabsVoices: row.maxCustomElevenLabsVoices,
      usedCustomVoices: used,
    });
  } catch (error) {
    console.error("Error updating voice platform config:", error);
    res.status(400).json({ success: false, error: error.message || "Failed to update voice platform config" });
  }
});

function isMissingModelVoiceTable(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  const modelName = String(error?.meta?.modelName || "").toLowerCase();
  const table = String(error?.meta?.table || "").toLowerCase();
  const mentionsModelVoice =
    message.includes("modelvoice") || modelName.includes("modelvoice") || table.includes("modelvoice");
  return (
    (code === "P2021" && mentionsModelVoice) ||
    (mentionsModelVoice &&
      (message.includes("does not exist") ||
        message.includes("no such table") ||
        message.includes("relation") ||
        message.includes("table")))
  );
}

router.post("/voice-platform/cleanup-zombies", async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const rawLimit = parseInt(String(req.body?.limit ?? "300"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 5000) : 300;

    const [accountVoices, legacyRefs, studioRefs] = await Promise.all([
      listElevenLabsAccountVoices(),
      prisma.savedModel.findMany({
        where: { elevenLabsVoiceId: { not: null } },
        select: { elevenLabsVoiceId: true },
        distinct: ["elevenLabsVoiceId"],
      }),
      prisma.modelVoice
        .findMany({
          select: { elevenLabsVoiceId: true },
          distinct: ["elevenLabsVoiceId"],
        })
        .catch((error) => {
          if (isMissingModelVoiceTable(error)) return [];
          throw error;
        }),
    ]);

    const referencedIds = new Set();
    for (const row of legacyRefs) {
      if (row?.elevenLabsVoiceId) referencedIds.add(row.elevenLabsVoiceId);
    }
    for (const row of studioRefs) {
      if (row?.elevenLabsVoiceId) referencedIds.add(row.elevenLabsVoiceId);
    }

    // "Zombie" = custom app voice in ElevenLabs (mc_*) that is no longer referenced in DB.
    const zombies = accountVoices
      .filter((voice) => {
        const voiceId = String(voice?.voice_id || "").trim();
        const name = String(voice?.name || "").toLowerCase();
        if (!voiceId) return false;
        if (!name.startsWith("mc_")) return false;
        return !referencedIds.has(voiceId);
      })
      .slice(0, limit);

    const result = {
      success: true,
      dryRun,
      scannedAccountVoices: accountVoices.length,
      referencedVoiceIds: referencedIds.size,
      zombieCandidates: zombies.length,
      limitApplied: limit,
      deleted: 0,
      failed: 0,
      failures: [],
      sample: zombies.slice(0, 20).map((voice) => ({
        voiceId: String(voice?.voice_id || ""),
        name: String(voice?.name || ""),
        category: String(voice?.category || ""),
      })),
      usedCustomVoices: await countModelsWithCustomVoice(),
    };

    if (!dryRun) {
      for (const voice of zombies) {
        const voiceId = String(voice?.voice_id || "").trim();
        if (!voiceId) continue;
        try {
          await deleteElevenLabsVoiceStrict(voiceId);
          result.deleted += 1;
        } catch (error) {
          result.failed += 1;
          if (result.failures.length < 20) {
            result.failures.push({
              voiceId,
              name: String(voice?.name || ""),
              error: error?.message || "Delete failed",
            });
          }
        }
      }
    }

    res.json(result);
  } catch (error) {
    console.error("Error cleaning zombie voices:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to clean zombie voices" });
  }
});

/**
 * GET /api/admin/provider-balances
 * Live balances / account probes (KIE, OpenRouter, fal, WaveSpeed, Apify, ElevenLabs).
 * API keys stay server-side.
 */
router.get("/provider-balances", async (_req, res) => {
  try {
    const data = await fetchAllProviderBalances();
    res.json(data);
  } catch (error) {
    console.error("Error fetching provider balances:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to fetch provider balances" });
  }
});

/**
 * GET /api/admin/stats
 * Get platform statistics
 */
router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsers,
      totalModels,
      totalGenerations,
      totalCreditsIssued,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.savedModel.count(),
      prisma.generation.count(),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "purchase" },
      }),
      prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          credits: true,
          role: true,
          isVerified: true,
          createdAt: true,
        },
      }),
    ]);

    const stats = {
      totalUsers,
      totalModels,
      totalGenerations,
      totalCreditsIssued: totalCreditsIssued._sum.amount || 0,
      recentUsers,
    };

    res.json(stats);
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

/**
 * GET /api/admin/users
 * Get all users with pagination
 */
router.get("/users", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          credits: true,
          role: true,
          isVerified: true,
          proAccess: true,
          banLocked: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          subscriptionTier: true,
          subscriptionCredits: true,
          purchasedCredits: true,
          totalCreditsUsed: true,
          allowCustomLoraTrainingPhotos: true,
          createdAt: true,
          _count: { select: { generations: true } },
        },
      }),
      prisma.user.count(),
    ]);

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/**
 * POST /api/admin/users/:userId/pro-access
 * Set or clear Pro Studio access for a user (invite-only /pro)
 */
router.post("/users/:userId/pro-access", async (req, res) => {
  try {
    const { userId } = req.params;
    const { proAccess } = req.body;
    if (typeof proAccess !== "boolean") {
      return res.status(400).json({ error: "proAccess must be a boolean" });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { proAccess },
    });
    res.json({ success: true, proAccess });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    console.error("Error updating pro access:", error);
    res.status(500).json({ error: "Failed to update pro access" });
  }
});

/**
 * POST /api/admin/users/:userId/ban-lock
 * Full lockout: cannot log in, refresh, or use authenticated APIs; password reset suppressed.
 */
router.post("/users/:userId/ban-lock", async (req, res) => {
  try {
    const { userId } = req.params;
    const { banLocked } = req.body;
    if (typeof banLocked !== "boolean") {
      return res.status(400).json({ error: "banLocked must be a boolean" });
    }
    if (userId === req.user.userId) {
      return res.status(400).json({ error: "You cannot change your own ban-lock status" });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { banLocked },
    });
    res.json({ success: true, banLocked });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    console.error("Error updating ban-lock:", error);
    res.status(500).json({ error: "Failed to update ban-lock" });
  }
});

/**
 * POST /api/admin/backup/create
 * Create a new backup of all user data
 */
router.post("/backup/create", async (req, res) => {
  try {
    const result = await BackupService.createBackup();
    res.json(result);
  } catch (error) {
    console.error("Error creating backup:", error);
    res.status(500).json({ error: "Failed to create backup" });
  }
});

/**
 * GET /api/admin/backup/history
 * Get list of all backups
 */
router.get("/backup/history", async (req, res) => {
  try {
    const backups = await BackupService.getBackupHistory();
    res.json({ backups });
  } catch (error) {
    console.error("Error fetching backup history:", error);
    res.status(500).json({ error: "Failed to fetch backup history" });
  }
});

/**
 * POST /api/admin/backup/restore-credits
 * Restore user credits from a backup file
 */
router.post("/backup/restore-credits", async (req, res) => {
  try {
    const { backupData } = req.body;

    if (!backupData) {
      return res.status(400).json({ error: "Backup data is required" });
    }

    const result = await BackupService.restoreCreditsFromBackup(backupData);
    res.json(result);
  } catch (error) {
    console.error("Error restoring credits:", error);
    res.status(500).json({ error: "Failed to restore credits from backup" });
  }
});

/**
 * GET /api/admin/users/:userId/models
 * Get all models for a specific user (for NSFW override management)
 */
router.get("/users/:userId/models", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const models = await prisma.savedModel.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        thumbnail: true,
        isAIGenerated: true,
        nsfwOverride: true,
        nsfwUnlocked: true,
        looksUnlockedByAdmin: true,
        loraStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      userEmail: user.email,
      models,
    });
  } catch (error) {
    console.error("Error fetching user models:", error);
    res.status(500).json({ success: false, error: "Failed to fetch models" });
  }
});

/**
 * POST /api/admin/models/:modelId/nsfw-override
 * Toggle NSFW override for a specific model
 */
router.post("/models/:modelId/nsfw-override", async (req, res) => {
  try {
    const { modelId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, error: "enabled must be a boolean" });
    }

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
      select: { id: true, name: true, userId: true },
    });

    if (!model) {
      return res.status(404).json({ success: false, error: "Model not found" });
    }

    const updatedModel = await prisma.savedModel.update({
      where: { id: modelId },
      data: { nsfwOverride: enabled },
      select: {
        id: true,
        name: true,
        nsfwOverride: true,
        isAIGenerated: true,
      },
    });

    console.log(`🔓 Admin ${req.user.email} set nsfwOverride=${enabled} for model "${model.name}" (${modelId})`);

    res.json({
      success: true,
      model: updatedModel,
      message: `NSFW ${enabled ? "enabled" : "disabled"} for model "${model.name}"`,
    });
  } catch (error) {
    console.error("Error toggling NSFW override:", error);
    res.status(500).json({ success: false, error: "Failed to update NSFW override" });
  }
});

/**
 * POST /api/admin/models/:modelId/looks-unlock
 * Unlock or lock model looks/photos for the user (so they can edit or not)
 */
router.post("/models/:modelId/looks-unlock", async (req, res) => {
  try {
    const { modelId } = req.params;
    const { unlocked } = req.body;

    if (typeof unlocked !== "boolean") {
      return res.status(400).json({ success: false, error: "unlocked must be a boolean" });
    }

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
      select: { id: true, name: true, userId: true },
    });

    if (!model) {
      return res.status(404).json({ success: false, error: "Model not found" });
    }

    const updatedModel = await prisma.savedModel.update({
      where: { id: modelId },
      data: { looksUnlockedByAdmin: unlocked },
      select: {
        id: true,
        name: true,
        looksUnlockedByAdmin: true,
      },
    });

    console.log(`🔓 Admin ${req.user.email} set looksUnlockedByAdmin=${unlocked} for model "${model.name}" (${modelId})`);

    res.json({
      success: true,
      model: updatedModel,
      message: unlocked ? "Model looks unlocked — user can edit photos/looks" : "Model looks locked",
    });
  } catch (error) {
    console.error("Error toggling looks unlock:", error);
    res.status(500).json({ success: false, error: "Failed to update looks unlock" });
  }
});

/**
 * POST /api/admin/models/:modelId/fix-photos
 * Fix model photo URLs (for cases where R2 upload stored empty files)
 */
router.post("/models/:modelId/fix-photos", async (req, res) => {
  try {
    const { modelId } = req.params;
    const { photo1Url, photo2Url, photo3Url } = req.body;

    if (!photo1Url && !photo2Url && !photo3Url) {
      return res.status(400).json({ success: false, error: "At least one photo URL is required" });
    }

    const urls = [photo1Url, photo2Url, photo3Url].filter(Boolean);
    for (const url of urls) {
      if (!url.startsWith("https://")) {
        return res.status(400).json({ success: false, error: "All photo URLs must be valid HTTPS URLs" });
      }
    }

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
      select: { id: true, name: true },
    });

    if (!model) {
      return res.status(404).json({ success: false, error: "Model not found" });
    }

    const updateData = {};
    if (photo1Url) {
      updateData.photo1Url = photo1Url;
      updateData.thumbnail = photo1Url;
    }
    if (photo2Url) updateData.photo2Url = photo2Url;
    if (photo3Url) updateData.photo3Url = photo3Url;

    const updatedModel = await prisma.savedModel.update({
      where: { id: modelId },
      data: updateData,
    });

    console.log(`🔧 Admin ${req.user.email} fixed photos for model "${model.name}" (${modelId})`);

    res.json({
      success: true,
      message: `Photos updated for model "${model.name}"`,
      model: {
        id: updatedModel.id,
        name: updatedModel.name,
        photo1Url: updatedModel.photo1Url,
        photo2Url: updatedModel.photo2Url,
        photo3Url: updatedModel.photo3Url,
      },
    });
  } catch (error) {
    console.error("Error fixing model photos:", error);
    res.status(500).json({ success: false, error: "Failed to fix model photos" });
  }
});

/**
 * POST /api/admin/users/:userId/credits
 * Manually adjust user credits
 */
router.post("/users/:userId/credits", async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, reason } = req.body;

    if (!amount || typeof amount !== "number") {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
    });

    // Log the manual credit adjustment
    await prisma.creditTransaction.create({
      data: {
        userId,
        amount,
        type: amount > 0 ? "purchase" : "generation",
        description: reason || `Manual adjustment by admin`,
        paymentSessionId: `admin_${Date.now()}`,
      },
    });

    res.json({
      success: true,
      newCredits: user.credits,
      adjustment: amount,
    });
  } catch (error) {
    console.error("Error adjusting credits:", error);
    res.status(500).json({ error: "Failed to adjust credits" });
  }
});

/**
 * POST /api/admin/upload-email-video
 * Upload a video for use in marketing emails. Stores in R2 under email-videos/ and returns public URL.
 */
router.post(
  "/upload-email-video",
  (req, res, next) => {
    uploadEmailVideo.single("video")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "Video file too large. Max 200MB." });
        }
        return res.status(400).json({ error: err?.message || "Invalid video file" });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No video file uploaded" });
      }
      if (!isR2Configured()) {
        return res.status(503).json({ error: "R2 storage is not configured; cannot host email videos." });
      }
      const url = await uploadFileToR2(req.file, "email-videos");
      res.json({ success: true, url });
    } catch (err) {
      console.error("Upload email video error:", err);
      res.status(500).json({ error: err?.message || "Upload failed" });
    }
  }
);

/**
 * POST /api/admin/marketing-campaigns
 * Create a campaign tracking record (stored in AdminAuditLog for persistence).
 */
router.post("/marketing-campaigns", async (req, res) => {
  try {
    const { subject, headline, audience } = req.body || {};
    if (!subject || !headline) {
      return res.status(400).json({ success: false, error: "subject and headline are required" });
    }
    const campaignId = randomUUID();
    const now = new Date().toISOString();
    const details = {
      campaignId,
      subject: String(subject).slice(0, 250),
      headline: String(headline).slice(0, 250),
      audience: audience && typeof audience === "object" ? audience : {},
      status: "running",
      cursor: 0,
      totalUsers: 0,
      excluded: 0,
      sent: 0,
      failed: 0,
      errors: [],
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      cancelledAt: null,
    };
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: MARKETING_CAMPAIGN_ACTION,
        targetType: "marketing_campaign",
        targetId: campaignId,
        detailsJson: JSON.stringify(details),
      },
    });
    return res.json({ success: true, campaignId, campaign: details });
  } catch (error) {
    console.error("Error creating marketing campaign:", error);
    return res.status(500).json({ success: false, error: "Failed to create campaign" });
  }
});

/**
 * GET /api/admin/marketing-campaigns
 * List recent campaign progress/history.
 */
router.get("/marketing-campaigns", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const rows = await prisma.adminAuditLog.findMany({
      where: { action: MARKETING_CAMPAIGN_ACTION },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { targetId: true, detailsJson: true, createdAt: true, adminEmail: true },
    });
    const campaigns = rows.map((row) => {
      const d = parseJsonSafe(row.detailsJson, {}) || {};
      return {
        campaignId: row.targetId,
        createdAt: row.createdAt,
        adminEmail: row.adminEmail,
        ...d,
      };
    });
    return res.json({ success: true, campaigns });
  } catch (error) {
    console.error("Error listing marketing campaigns:", error);
    return res.status(500).json({ success: false, error: "Failed to load campaigns" });
  }
});

/**
 * POST /api/admin/marketing-campaigns/:campaignId/cancel
 */
router.post("/marketing-campaigns/:campaignId/cancel", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const updated = await updateMarketingCampaignAudit(campaignId, (prev) => ({
      ...prev,
      status: prev?.status === "completed" ? "completed" : "cancelled",
      cancelledAt: prev?.status === "completed" ? prev?.cancelledAt || null : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    if (!updated) return res.status(404).json({ success: false, error: "Campaign not found" });
    return res.json({ success: true, campaign: updated });
  } catch (error) {
    console.error("Error cancelling marketing campaign:", error);
    return res.status(500).json({ success: false, error: "Failed to cancel campaign" });
  }
});

/**
 * POST /api/admin/send-marketing-email
 * Send a marketing email to users (excluding unsubscribes). Optional audience filters.
 * Body: { subject, heroImageUrl, imageUrls, videoUrl?, headline, bodyText, ctaText, ctaUrl, testEmail (optional),
 *        audience?: { verifiedOnly?, subscriptionStatuses?, subscriptionTiers?, minSpendCents?, maxSpendCents?, minReferrals?, regions?, languages? } }
 */
router.post("/send-marketing-email", async (req, res) => {
  try {
    const { subject, heroImageUrl, imageUrls, videoUrl, headline, bodyText, ctaText, ctaUrl, testEmail, audience, cursor, campaignId } = req.body;

    if (!subject || !headline || !bodyText) {
      return res.status(400).json({ error: "subject, headline, and bodyText are required" });
    }

    const sgMail = (await import("@sendgrid/mail")).default;
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SENDGRID_API_KEY not configured" });
    }
    sgMail.setApiKey(apiKey);

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || "support@modelclone.app";
    const branding = await getAppBranding();
    const BRAND = { name: branding.appName };
    const baseUrl = (branding.baseUrl || "https://modelclone.app").replace(/\/$/, "");
    const logoUrl = branding.logoUrl || `${baseUrl}/logo-512.png`;
    const safeHeroImageUrl = typeof heroImageUrl === "string" ? heroImageUrl.trim() : "";
    const safeImageUrls = Array.isArray(imageUrls)
      ? imageUrls
          .filter((u) => typeof u === "string")
          .map((u) => u.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const safeVideoUrl = typeof videoUrl === "string" ? videoUrl.trim() : "";

    const escapeHtml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    /** Generate a signed unsubscribe token for one recipient email. */
    const buildUnsubscribeToken = (email) =>
      jwt.sign(
        { sub: email, purpose: "unsubscribe" },
        process.env.JWT_SECRET,
        { expiresIn: "180d" },
      );

    const buildEmailHtml = (userName, recipientEmail) => {
      const unsubToken = buildUnsubscribeToken(recipientEmail);
      const unsubUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(BRAND.name)} - ${escapeHtml(subject)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background-color: #f5f5f3; font-family: 'DM Sans', sans-serif; color: #1a1a1a; padding: 48px 16px 64px; -webkit-font-smoothing: antialiased; }
    .wrapper { max-width: 560px; margin: 0 auto; }
    .brand-bar { margin-bottom: 28px; padding: 0 4px; text-align: center; }
    .brand-mark { width: 42px; height: 42px; border-radius: 10px; overflow: hidden; background: #1a1a1a; display: block; margin: 0 auto 8px; }
    .brand-mark img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .brand-name { font-size: 15px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.2px; display: block; text-align: center; }
    .card { background: #ffffff; border-radius: 4px; border: 1px solid #e2e2de; overflow: hidden; }
    .card-accent { height: 3px; background: #1a1a1a; }
    .card-body { padding: 48px 48px 44px; }
    .section-label { font-size: 11px; font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: #9b9b93; margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 600; color: #111; letter-spacing: -0.5px; line-height: 1.3; margin-bottom: 16px; }
    .greeting-text { font-size: 15px; font-weight: 300; color: #555550; line-height: 1.7; margin-bottom: 24px; white-space: pre-line; }
    .greeting-text strong { color: #1a1a1a; font-weight: 500; }
    .divider { height: 1px; background: #e8e8e4; margin: 0 0 24px; }
    .hero { width: 100%; border-radius: 4px; margin-bottom: 20px; border: 1px solid #e2e2de; }
    .gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0 0 24px; }
    .gallery img { width: 100%; border: 1px solid #e2e2de; border-radius: 4px; display:block; }
    .video-wrap { margin: 0 0 24px; }
    .video-wrap video { width: 100%; max-height: 320px; border: 1px solid #e2e2de; border-radius: 4px; display: block; }
    .video-link { display: inline-block; margin-top: 8px; font-size: 14px; font-weight: 600; color: #111; text-decoration: underline; }
    .cta-wrap { margin: 16px 0 26px; }
    .cta-btn { display: inline-block; text-decoration: none; background: #111; color: #fff !important; font-size: 13px; font-weight: 600; padding: 10px 14px; border-radius: 4px; }
    .note { font-size: 13px; color: #9b9b93; line-height: 1.65; font-weight: 300; }
    .note + .note { margin-top: 12px; }
    .card-footer { padding: 20px 48px; background: #fafaf8; border-top: 1px solid #e8e8e4; text-align: center; }
    .footer-brand { font-size: 12px; font-weight: 500; color: #1a1a1a; }
    .footer-legal { font-size: 11px; color: #b5b5ae; }
    .meta { margin-top: 24px; padding: 0 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; }
    .meta-text { font-size: 11px; color: #b5b5ae; }
    .unsub-link { font-size: 11px; color: #b5b5ae; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="brand-bar">
      <div class="brand-mark"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(BRAND.name)}" /></div>
      <span class="brand-name">${escapeHtml(BRAND.name)}</span>
    </div>

    <div class="card">
      <div class="card-accent"></div>
      <div class="card-body">
        <div class="section-label">Platform Update</div>
        <h1>${escapeHtml(headline)}${userName ? `,<br>${escapeHtml(userName)}.` : ''}</h1>
        ${safeHeroImageUrl ? `<img class="hero" src="${escapeHtml(safeHeroImageUrl)}" alt="Hero image" />` : ""}
        ${safeImageUrls.length ? `<div class="gallery">${safeImageUrls.map((url) => `<img src="${escapeHtml(url)}" alt="Email image" />`).join("")}</div>` : ""}
        ${safeVideoUrl ? `<div class="video-wrap"><video src="${escapeHtml(safeVideoUrl)}" controls preload="metadata" poster="">Your browser does not support the video tag.</video><br /><a class="video-link" href="${escapeHtml(safeVideoUrl)}" target="_blank" rel="noopener">Watch video</a></div>` : ""}
        <p class="greeting-text">${escapeHtml(bodyText)}</p>
        ${ctaText && ctaUrl ? `<div class="cta-wrap"><a class="cta-btn" href="${escapeHtml(ctaUrl)}">${escapeHtml(ctaText)}</a></div>` : ""}
        <div class="divider"></div>
        <p class="note">Do not share sensitive account details through email links unless you trust the source.</p>
        <p class="note">If this message was not expected, you can safely ignore it.</p>
      </div>
      <div class="card-footer">
        <span class="footer-brand">${escapeHtml(BRAND.name)}</span><br />
        <span class="footer-legal">© 2025 ${escapeHtml(BRAND.name)}. All rights reserved.</span>
      </div>
    </div>

    <div class="meta">
      <span class="meta-text">This is an automated message. Please do not reply.</span>
      <span class="meta-text">${escapeHtml(baseUrl.replace(/^https?:\/\//, ""))}</span>
      <a class="unsub-link" href="${unsubUrl}">Unsubscribe</a>
    </div>
  </div>
</body>
</html>
    `;
    };

    const NO_TRACKING = {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: false },
    };

    if (testEmail) {
      const msg = {
        to: testEmail,
        from: { email: fromEmail, name: BRAND.name },
        subject,
        html: buildEmailHtml("Test User", testEmail),
        trackingSettings: NO_TRACKING,
      };
      await sgMail.send(msg);
      return res.json({ success: true, message: `Test email sent to ${testEmail}` });
    }

    // Fetch unsubscribed emails to exclude
    const unsubRecords = await prisma.emailUnsubscribe.findMany({ select: { email: true } });
    const unsubSet = new Set(unsubRecords.map((r) => r.email.toLowerCase()));

    // Audience filters (default: verified only)
    const aud = audience && typeof audience === "object" ? audience : {};
    const verifiedOnly = aud.verifiedOnly !== false;
    const subscriptionStatuses = Array.isArray(aud.subscriptionStatuses) ? aud.subscriptionStatuses.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : null;
    const subscriptionTiers = Array.isArray(aud.subscriptionTiers) ? aud.subscriptionTiers.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : null;
    const minSpendCents = typeof aud.minSpendCents === "number" && aud.minSpendCents >= 0 ? aud.minSpendCents : null;
    const maxSpendCents = typeof aud.maxSpendCents === "number" && aud.maxSpendCents >= 0 ? aud.maxSpendCents : null;
    const minReferrals = typeof aud.minReferrals === "number" && aud.minReferrals >= 0 ? aud.minReferrals : null;
    const regions = Array.isArray(aud.regions) ? aud.regions.filter((s) => typeof s === "string").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
    const languages = Array.isArray(aud.languages) ? aud.languages.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : null;

    const where = {};
    if (verifiedOnly) where.isVerified = true;
    if (subscriptionStatuses?.length) where.subscriptionStatus = { in: subscriptionStatuses };
    if (subscriptionTiers?.length) where.subscriptionTier = { in: subscriptionTiers };
    if (regions?.length) where.region = { in: regions };
    if (languages?.length) where.marketingLanguage = { in: languages };

    let candidateUsers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        _count: { select: { referrals: true } },
      },
    });

    if (minReferrals != null) {
      candidateUsers = candidateUsers.filter((u) => (u._count?.referrals ?? 0) >= minReferrals);
    }

    if (minSpendCents != null || maxSpendCents != null) {
      const ids = candidateUsers.map((u) => u.id);
      const spendByUser = new Map();
      // Batch to avoid "too many bind variables" (DB limit ~32767)
      const SPEND_QUERY_CHUNK = 5000;
      for (let i = 0; i < ids.length; i += SPEND_QUERY_CHUNK) {
        const chunk = ids.slice(i, i + SPEND_QUERY_CHUNK);
        const txs = await prisma.creditTransaction.findMany({
          where: { userId: { in: chunk }, type: "purchase" },
          select: { userId: true, amount: true },
        });
        for (const tx of txs) {
          spendByUser.set(tx.userId, (spendByUser.get(tx.userId) ?? 0) + tx.amount);
        }
      }
      candidateUsers = candidateUsers.filter((u) => {
        const spend = spendByUser.get(u.id) ?? 0;
        if (minSpendCents != null && spend < minSpendCents) return false;
        if (maxSpendCents != null && spend > maxSpendCents) return false;
        return true;
      });
    }

    const users = candidateUsers
      .map((u) => ({ email: u.email, name: u.name }))
      .filter((u) => !unsubSet.has(u.email.toLowerCase()));

    if (campaignId) {
      const row = await prisma.adminAuditLog.findFirst({
        where: { action: MARKETING_CAMPAIGN_ACTION, targetId: String(campaignId) },
        select: { detailsJson: true },
      });
      const details = parseJsonSafe(row?.detailsJson, {}) || {};
      if (details.status === "cancelled") {
        return res.status(409).json({ success: false, error: "Campaign cancelled" });
      }
    }

    console.log(`Sending marketing email to ${users.length} users (${unsubSet.size} excluded as unsubscribed)...`);

    const startCursor = Math.max(0, parseInt(cursor, 10) || 0);
    let sent = 0;
    let failed = 0;
    const errors = [];
    // SendGrid v3 Mail Send supports up to 1000 personalizations/recipients per request.
    const BATCH_SIZE = Math.min(600, SENDGRID_MAX_EMAILS_PER_MINUTE);
    const MAX_RECORDED_ERRORS = 200;
    const RUN_BUDGET_MS = 240_000; // stay below Vercel 300s hard timeout
    const runStartedAt = Date.now();
    const reserveSendWindow = createSendGridRateLimiter(SENDGRID_MAX_EMAILS_PER_MINUTE);

    const getErrorStatus = (err) =>
      err?.code ||
      err?.response?.statusCode ||
      err?.response?.status ||
      err?.statusCode ||
      null;
    const isRetriableSendgridError = (err) => {
      const status = Number(getErrorStatus(err));
      const msg = String(err?.message || "").toLowerCase();
      if (status === 429 || status >= 500) return true;
      return (
        msg.includes("timeout") ||
        msg.includes("timed out") ||
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("rate limit")
      );
    };
    const pushError = (text) => {
      if (!text) return;
      if (errors.length < MAX_RECORDED_ERRORS) errors.push(text);
    };
    const sendBatchWithRetry = async (messages, maxRetries = 4) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await reserveSendWindow(messages.length);
          await sgMail.send(messages);
          return;
        } catch (err) {
          if (attempt === maxRetries || !isRetriableSendgridError(err)) throw err;
          const backoffMs = Math.min(8000, 600 * (2 ** attempt)) + Math.floor(Math.random() * 350);
          await sleep(backoffMs);
        }
      }
    };
    const mapWithConcurrency = async (items, concurrency, handler) => {
      const out = new Array(items.length);
      let cursorIdx = 0;
      const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          const idx = cursorIdx++;
          if (idx >= items.length) return;
          out[idx] = await handler(items[idx], idx);
        }
      });
      await Promise.all(workers);
      return out;
    };

    let nextCursor = startCursor;
    for (let i = startCursor; i < users.length; i += BATCH_SIZE) {
      if (Date.now() - runStartedAt > RUN_BUDGET_MS) {
        nextCursor = i;
        break;
      }
      const batch = users.slice(i, i + BATCH_SIZE);
      const messages = batch.map((user) => ({
        to: user.email,
        from: { email: fromEmail, name: BRAND.name },
        subject,
        html: buildEmailHtml(user.name ? user.name.split(" ")[0] : null, user.email),
        trackingSettings: NO_TRACKING,
      }));

      const batchNo = Math.floor(i / BATCH_SIZE) + 1;
      try {
        await sendBatchWithRetry(messages);
        sent += messages.length;
        console.log(`Batch ${batchNo}: sent ${messages.length} emails (total: ${sent})`);
      } catch (error) {
        console.error(`Batch ${batchNo} failed as bulk, retrying per-recipient...`, error?.message || error);
        pushError(`Batch ${batchNo} bulk failure: ${error?.message || "unknown error"}`);
        const settled = await mapWithConcurrency(batch, 5, async (user) => {
          try {
            await sendBatchWithRetry([{
              to: user.email,
              from: { email: fromEmail, name: BRAND.name },
              subject,
              html: buildEmailHtml(user.name ? user.name.split(" ")[0] : null, user.email),
              trackingSettings: NO_TRACKING,
            }], 2);
            return { ok: true };
          } catch (err) {
            return { ok: false, err };
          }
        });
        settled.forEach((r, idx) => {
          if (r?.ok) {
            sent += 1;
          } else {
            failed += 1;
            pushError(`${batch[idx].email}: ${r?.err?.message || "send failed"}`);
          }
        });
        console.log(`Batch ${batchNo}: fallback complete (total sent: ${sent}, failed: ${failed})`);
      }
      nextCursor = i + batch.length;
    }

    const hasMore = nextCursor < users.length;
    if (hasMore) {
      console.log(`Marketing email partial run: ${sent} sent, ${failed} failed, next cursor ${nextCursor}/${users.length}`);
    } else {
      console.log(`Marketing email complete: ${sent} sent, ${failed} failed`);
    }

    if (campaignId) {
      await updateMarketingCampaignAudit(String(campaignId), (prev) => {
        const prevErrors = Array.isArray(prev?.errors) ? prev.errors : [];
        const mergedErrors = [...prevErrors, ...(errors || [])].slice(0, 300);
        return {
          ...prev,
          campaignId: String(campaignId),
          status: hasMore ? "running" : "completed",
          cursor: nextCursor,
          totalUsers: users.length,
          excluded: unsubSet.size,
          sent: Number(prev?.sent || 0) + sent,
          failed: Number(prev?.failed || 0) + failed,
          errors: mergedErrors,
          updatedAt: new Date().toISOString(),
          completedAt: hasMore ? null : new Date().toISOString(),
        };
      });
    }

    res.json({
      success: true,
      totalUsers: users.length,
      excluded: unsubSet.size,
      cursorStart: startCursor,
      nextCursor,
      hasMore,
      sent,
      failed,
      campaignId: campaignId || null,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const campaignId = req.body?.campaignId;
    if (campaignId) {
      await updateMarketingCampaignAudit(String(campaignId), (prev) => ({
        ...prev,
        status: "failed",
        updatedAt: new Date().toISOString(),
        errors: [...(Array.isArray(prev?.errors) ? prev.errors : []), error?.message || "Failed to send marketing email"].slice(0, 300),
      })).catch(() => {});
    }
    console.error("Error sending marketing email:", error?.message, error?.stack);
    res.status(500).json({ error: error?.message || "Failed to send marketing email" });
  }
});

router.post("/send-promo-50off", async (req, res) => {
  try {
    const { testEmail, users: providedUsers } = req.body;

    if (testEmail) {
      const result = await sendPromoEmail(testEmail, "Test User");
      return res.json({ success: result.success, message: `Test promo email sent to ${testEmail}` });
    }

    // Always exclude unsubscribed emails
    const unsubRecords = await prisma.emailUnsubscribe.findMany({ select: { email: true } });
    const unsubSet = new Set(unsubRecords.map((r) => r.email.toLowerCase()));

    let users;
    if (providedUsers && Array.isArray(providedUsers) && providedUsers.length > 0) {
      users = providedUsers.filter((u) => !unsubSet.has((u.email || "").toLowerCase()));
      console.log(`Using ${users.length} provided users (${providedUsers.length - users.length} excluded as unsubscribed)`);
    } else {
      const allUsers = await prisma.user.findMany({
        where: { isVerified: true },
        select: { email: true, name: true },
      });
      users = allUsers.filter((u) => !unsubSet.has(u.email.toLowerCase()));
      console.log(`Found ${users.length} users (${unsubSet.size} excluded as unsubscribed)`);
    }

    console.log(`\n📧 Sending 50% OFF promo email to ${users.length} verified users...`);

    let sent = 0;
    let failed = 0;
    const errors = [];
    const reserveSendWindow = createSendGridRateLimiter(SENDGRID_MAX_EMAILS_PER_MINUTE);
    const BATCH_SIZE = Math.min(200, SENDGRID_MAX_EMAILS_PER_MINUTE);
    const CONCURRENCY = 5;
    const sendPromoWithRetry = async (email, firstName, maxRetries = 3) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await reserveSendWindow(1);
          return await sendPromoEmail(email, firstName);
        } catch (err) {
          if (attempt === maxRetries) throw err;
          const backoffMs = Math.min(8000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 300);
          await sleep(backoffMs);
        }
      }
      return { success: false, error: "unknown_error" };
    };

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const results = new Array(batch.length);
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
        while (true) {
          const idx = nextIndex++;
          if (idx >= batch.length) return;
          const user = batch[idx];
          try {
            const value = await sendPromoWithRetry(user.email, user.name ? user.name.split(" ")[0] : null);
            results[idx] = { status: "fulfilled", value };
          } catch (reason) {
            results[idx] = { status: "rejected", reason };
          }
        }
      });
      await Promise.all(workers);

      results.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value.success) {
          sent++;
        } else {
          failed++;
          errors.push(`${batch[idx].email}: ${r.status === "rejected" ? r.reason : r.value?.error}`);
        }
      });

      console.log(`📧 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${sent} sent, ${failed} failed`);
    }

    console.log(`\n✅ Promo email campaign complete: ${sent} sent, ${failed} failed`);

    res.json({
      success: true,
      totalUsers: users.length,
      excluded: unsubSet.size,
      sent,
      failed,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    });
  } catch (error) {
    console.error("Error sending promo emails:", error);
    res.status(500).json({ error: "Failed to send promo emails" });
  }
});

/**
 * POST /api/admin/assign-lora
 * Assign an external LoRA to a user's model by email + model name
 * Creates TrainedLora entry, links it to SavedModel, and enables NSFW
 */
router.post("/assign-lora", async (req, res) => {
  try {
    const { email, modelName, loraUrl, triggerWord, configUrl, enableNsfw } = req.body;

    if (!email || !loraUrl) {
      return res.status(400).json({ success: false, error: "email and loraUrl are required" });
    }

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: `User not found: ${email}` });
    }

    let model;
    if (modelName) {
      model = await prisma.savedModel.findFirst({
        where: { userId: user.id, name: { contains: modelName, mode: "insensitive" } },
      });
    } else {
      model = await prisma.savedModel.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!model) {
      return res.status(404).json({ success: false, error: `No model found for user ${email}${modelName ? ` with name "${modelName}"` : ""}` });
    }

    const loraName = triggerWord || modelName || model.name || "custom_lora";

    const trainedLora = await prisma.trainedLora.create({
      data: {
        modelId: model.id,
        name: loraName,
        status: "ready",
        loraUrl: loraUrl,
        triggerWord: triggerWord || "muclemommy_lora",
        trainedAt: new Date(),
      },
    });

    const updateData = {
      activeLoraId: trainedLora.id,
      loraStatus: "ready",
      loraUrl: loraUrl,
      loraTriggerWord: triggerWord || "musclemommy_lora",
      loraTrainedAt: new Date(),
    };

    if (enableNsfw !== false) {
      updateData.nsfwOverride = true;
      updateData.nsfwUnlocked = true;
    }

    await prisma.savedModel.update({
      where: { id: model.id },
      data: updateData,
    });

    console.log(`🔧 Admin ${req.user.email} assigned LoRA to model "${model.name}" (${model.id}) for user ${email}`);
    console.log(`   LoRA URL: ${loraUrl}`);
    console.log(`   Trigger: ${triggerWord || "muclemommy_lora"}`);
    console.log(`   NSFW: ${enableNsfw !== false ? "enabled" : "not changed"}`);

    res.json({
      success: true,
      message: `LoRA assigned to model "${model.name}" for ${email}`,
      data: {
        modelId: model.id,
        modelName: model.name,
        loraId: trainedLora.id,
        loraUrl,
        triggerWord: triggerWord || "muclemommy_lora",
        nsfwEnabled: enableNsfw !== false,
      },
    });
  } catch (error) {
    console.error("Error assigning LoRA:", error);
    res.status(500).json({ success: false, error: "Failed to assign LoRA" });
  }
});

/**
 * POST /api/admin/lora-recovery
 * Recover already-finished fal LoRA to R2 and attach to user model.
 * Body: { userId, modelName, falLoraUrl, triggerWord?, enableNsfw? }
 */
router.post("/lora-recovery", async (req, res) => {
  try {
    const {
      userId,
      modelName,
      falLoraUrl,
      triggerWord,
      enableNsfw = true,
    } = req.body || {};

    if (!userId || !modelName || !falLoraUrl) {
      return res.status(400).json({
        success: false,
        error: "userId, modelName, and falLoraUrl are required",
      });
    }

    if (!isVercelBlobConfigured() && !isR2Configured()) {
      return res.status(500).json({
        success: false,
        error: "Blob or R2 storage is not configured",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: String(userId).trim() },
      select: { id: true, email: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const model = await prisma.savedModel.findFirst({
      where: {
        userId: user.id,
        name: { contains: String(modelName).trim(), mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    });
    if (!model) {
      return res.status(404).json({
        success: false,
        error: `No model found for user with name like "${modelName}"`,
      });
    }

    // Pull the LoRA artifact from fal and persist it in our own R2 bucket.
    const sourceUrl = String(falLoraUrl).trim();
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return res.status(400).json({
        success: false,
        error: `Failed to download fal LoRA URL (HTTP ${response.status})`,
      });
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    const MAX_LORA_BYTES = 1 * 1024 * 1024 * 1024; // 1GB safety cap
    if (contentLength > MAX_LORA_BYTES) {
      return res.status(400).json({
        success: false,
        error: `LoRA file too large (${contentLength} bytes)`,
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      return res.status(400).json({
        success: false,
        error: "Downloaded LoRA file is empty",
      });
    }
    if (buffer.length > MAX_LORA_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Downloaded LoRA file too large (${buffer.length} bytes)`,
      });
    }

    const recoveredLoraUrl = await uploadBufferToBlobOrR2(
      buffer,
      "loras",
      "safetensors",
      "application/octet-stream",
    );

    const finalTriggerWord = String(triggerWord || model.name || "recovered_lora").trim();
    const falMarker = `manual-recovery:${Date.now()}`;

    const trainedLora = await prisma.trainedLora.create({
      data: {
        modelId: model.id,
        name: `${model.name} (Recovered)`,
        status: "ready",
        trainingMode: "standard",
        loraUrl: recoveredLoraUrl,
        triggerWord: finalTriggerWord,
        trainedAt: new Date(),
        falRequestId: falMarker,
      },
      select: { id: true, loraUrl: true, triggerWord: true, falRequestId: true },
    });

    await prisma.savedModel.update({
      where: { id: model.id },
      data: {
        activeLoraId: trainedLora.id,
        loraStatus: "ready",
        loraUrl: recoveredLoraUrl,
        loraTriggerWord: finalTriggerWord,
        loraTrainedAt: new Date(),
        loraFalRequestId: falMarker,
        ...(enableNsfw !== false ? { nsfwOverride: true, nsfwUnlocked: true } : {}),
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "lora_recovery",
        targetType: "saved_model",
        targetId: model.id,
        detailsJson: JSON.stringify({
          userId: user.id,
          userEmail: user.email,
          modelName: model.name,
          sourceFalLoraUrl: sourceUrl,
          recoveredLoraUrl,
          trainedLoraId: trainedLora.id,
          triggerWord: finalTriggerWord,
          nsfwEnabled: enableNsfw !== false,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: `LoRA recovered for model "${model.name}"`,
      data: {
        userId: user.id,
        modelId: model.id,
        modelName: model.name,
        loraId: trainedLora.id,
        loraUrl: recoveredLoraUrl,
        triggerWord: finalTriggerWord,
        nsfwEnabled: enableNsfw !== false,
      },
    });
  } catch (error) {
    console.error("Error during LoRA recovery:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to recover LoRA",
    });
  }
});

function parseKieTaskId(replicateModel) {
  if (!replicateModel || typeof replicateModel !== "string") return null;
  if (!replicateModel.startsWith("kie-task:")) return null;
  const taskId = replicateModel.slice("kie-task:".length).trim();
  return taskId || null;
}

function extractKieOutputUrl(data) {
  if (!data || typeof data !== "object") return null;
  let outputUrl = null;
  try {
    const resultJson = typeof data.resultJson === "string"
      ? JSON.parse(data.resultJson)
      : data.resultJson;
    outputUrl =
      resultJson?.resultUrls?.[0] ||
      resultJson?.result_urls?.[0] ||
      resultJson?.url ||
      null;
    if (!outputUrl && Array.isArray(resultJson)) outputUrl = resultJson[0] || null;
    if (!outputUrl && typeof resultJson === "string" && resultJson.startsWith("http")) {
      outputUrl = resultJson;
    }
  } catch {
    if (typeof data.resultJson === "string" && data.resultJson.startsWith("http")) {
      outputUrl = data.resultJson;
    }
  }
  return outputUrl || data.resultUrl || data.outputUrl || data.output_url || data.url || null;
}

/**
 * POST /api/admin/lost-generations/reconcile
 * Body: { userId: string, limit?: number, dryRun?: boolean }
 * Scans FAILED KIE generations for user and recovers outputs if KIE task already succeeded.
 */
router.post("/lost-generations/reconcile", async (req, res) => {
  try {
    const { userId, limit = 200, dryRun = true } = req.body || {};
    const safeInput = String(userId || "").trim();
    const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 200));
    const runDry = dryRun !== false;

    if (!safeInput) {
      return res.status(400).json({ success: false, error: "User ID, email or name is required" });
    }
    if (!KIE_API_KEY) {
      return res.status(500).json({ success: false, error: "KIE_API_KEY is not configured" });
    }

    // Resolve user by ID, email, or name (case-insensitive)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(safeInput);
    const isEmail = safeInput.includes("@");

    let targetUser = null;
    if (isUuid) {
      targetUser = await prisma.user.findUnique({
        where: { id: safeInput },
        select: { id: true, email: true, name: true },
      });
    } else if (isEmail) {
      targetUser = await prisma.user.findFirst({
        where: { email: { equals: safeInput, mode: "insensitive" } },
        select: { id: true, email: true, name: true },
      });
    } else {
      targetUser = await prisma.user.findFirst({
        where: { name: { equals: safeInput, mode: "insensitive" } },
        select: { id: true, email: true, name: true },
      });
    }

    if (!targetUser) {
      return res.status(404).json({ success: false, error: `User not found for: ${safeInput}` });
    }

    const safeUserId = targetUser.id;

    const candidates = await prisma.generation.findMany({
      where: {
        userId: safeUserId,
        status: "failed",
        replicateModel: { startsWith: "kie-task:" },
      },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        type: true,
        status: true,
        outputUrl: true,
        replicateModel: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    const results = [];
    let recovered = 0;
    let recoverable = 0;

    for (const gen of candidates) {
      const taskId = parseKieTaskId(gen.replicateModel);
      if (!taskId) {
        results.push({ generationId: gen.id, recovered: false, reason: "missing_task_id" });
        continue;
      }

      try {
        const kieRes = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_API_KEY}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!kieRes.ok) {
          results.push({ generationId: gen.id, taskId, recovered: false, reason: `kie_http_${kieRes.status}` });
          continue;
        }

        const kieJson = await kieRes.json();
        const data = kieJson?.data ?? kieJson;
        const state = String(data?.state || "").toLowerCase();
        if (state !== "success") {
          results.push({ generationId: gen.id, taskId, recovered: false, reason: state || "not_success" });
          continue;
        }

        const providerUrl = extractKieOutputUrl(data);
        if (!providerUrl) {
          results.push({ generationId: gen.id, taskId, recovered: false, reason: "success_without_output_url" });
          continue;
        }

        recoverable += 1;
        if (runDry) {
          results.push({
            generationId: gen.id,
            taskId,
            recovered: false,
            dryRun: true,
            reason: "recoverable",
            providerUrl,
          });
          continue;
        }

        let finalUrl = providerUrl;
        if (isR2Configured()) {
          try {
            finalUrl = await mirrorToR2(providerUrl, "generations");
          } catch (mirrorErr) {
            console.warn(`[reconcile] R2 mirror failed for ${gen.id}, using provider URL:`, mirrorErr?.message);
          }
        }

        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: "completed",
            outputUrl: finalUrl,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        recovered += 1;
        results.push({
          generationId: gen.id,
          taskId,
          recovered: true,
          outputUrl: finalUrl,
        });
      } catch (e) {
        console.error(`[reconcile] Error recovering ${gen.id}:`, e?.message);
        results.push({ generationId: gen.id, taskId, recovered: false, reason: e?.message || "reconcile_error" });
      }
    }

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "lost_generation_reconcile",
        targetType: "user",
        targetId: safeUserId,
        detailsJson: JSON.stringify({
          userEmail: targetUser.email,
          limit: safeLimit,
          dryRun: runDry,
          scanned: candidates.length,
          recoverable,
          recovered,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: runDry
        ? `Dry run complete: ${recoverable}/${candidates.length} recoverable`
        : `Reconciliation complete: recovered ${recovered}/${candidates.length}`,
      data: {
        userId: safeUserId,
        userEmail: targetUser.email,
        dryRun: runDry,
        scanned: candidates.length,
        recoverable,
        recovered,
        results,
      },
    });
  } catch (error) {
    console.error("Lost generation reconciliation error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to reconcile lost generations",
    });
  }
});

/**
 * POST /api/admin/lost-generations/reconcile-all
 * Body: { limit?: number, dryRun?: boolean }
 * Runs lost content reconciliation for ALL users (failed KIE generations with kie-task:).
 * Use to restore content from KIE when callbacks were missed.
 */
router.post("/lost-generations/reconcile-all", async (req, res) => {
  try {
    const { limit = 500, dryRun = true } = req.body || {};
    const safeLimit = Math.max(1, Math.min(2000, parseInt(limit, 10) || 500));
    const runDry = dryRun !== false;

    if (!KIE_API_KEY) {
      return res.status(500).json({ success: false, error: "KIE_API_KEY is not configured" });
    }

    const candidates = await prisma.generation.findMany({
      where: {
        status: "failed",
        replicateModel: { startsWith: "kie-task:" },
      },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        outputUrl: true,
        replicateModel: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    const results = [];
    let recovered = 0;
    let recoverable = 0;

    for (const gen of candidates) {
      const taskId = parseKieTaskId(gen.replicateModel);
      if (!taskId) {
        results.push({ generationId: gen.id, userId: gen.userId, recovered: false, reason: "missing_task_id" });
        continue;
      }

      try {
        const kieRes = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_API_KEY}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!kieRes.ok) {
          results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: `kie_http_${kieRes.status}` });
          continue;
        }

        const kieJson = await kieRes.json();
        const data = kieJson?.data ?? kieJson;
        const state = String(data?.state || "").toLowerCase();
        if (state !== "success") {
          results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: state || "not_success" });
          continue;
        }

        const providerUrl = extractKieOutputUrl(data)
          || (Array.isArray(data?.resultUrls) && data.resultUrls[0]) || null;
        if (!providerUrl) {
          results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: "success_without_output_url" });
          continue;
        }

        recoverable += 1;
        if (runDry) {
          results.push({
            generationId: gen.id,
            userId: gen.userId,
            taskId,
            recovered: false,
            dryRun: true,
            reason: "recoverable",
            providerUrl,
          });
          continue;
        }

        let finalUrl = providerUrl;
        if (isR2Configured()) {
          try {
            finalUrl = await mirrorToR2(providerUrl, "generations");
          } catch (mirrorErr) {
            console.warn(`[reconcile-all] R2 mirror failed for ${gen.id}, using provider URL:`, mirrorErr?.message);
          }
        }

        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: "completed",
            outputUrl: finalUrl,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        recovered += 1;
        results.push({
          generationId: gen.id,
          userId: gen.userId,
          taskId,
          recovered: true,
          outputUrl: finalUrl,
        });
      } catch (e) {
        console.error(`[reconcile-all] Error recovering ${gen.id}:`, e?.message);
        results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: e?.message || "reconcile_error" });
      }
    }

    const uniqueUsers = [...new Set(candidates.map(g => g.userId))].length;

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "lost_generation_reconcile_all",
        targetType: "all_users",
        targetId: null,
        detailsJson: JSON.stringify({
          limit: safeLimit,
          dryRun: runDry,
          scanned: candidates.length,
          uniqueUsers,
          recoverable,
          recovered,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: runDry
        ? `Dry run complete: ${recoverable}/${candidates.length} recoverable (${uniqueUsers} users)`
        : `Reconciliation complete: recovered ${recovered}/${candidates.length} (${uniqueUsers} users)`,
      data: {
        dryRun: runDry,
        scanned: candidates.length,
        uniqueUsers,
        recoverable,
        recovered,
        results,
      },
    });
  } catch (error) {
    console.error("Lost generation reconcile-all error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to reconcile lost generations for all users",
    });
  }
});

router.post("/bulk-import-gallery", async (req, res) => {
  try {
    const { userId, modelId, imageUrls, prompt } = req.body;

    if (!userId || !modelId || !imageUrls || !Array.isArray(imageUrls)) {
      return res.status(400).json({ success: false, error: "userId, modelId, and imageUrls[] required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    if (!model) return res.status(404).json({ success: false, error: "Model not found" });

    const results = [];
    for (const url of imageUrls) {
      const gen = await prisma.generation.create({
        data: {
          userId,
          modelId,
          type: "nsfw",
          prompt: prompt || "Imported reference photo",
          creditsCost: 0,
          creditsRefunded: false,
          actualCostUSD: 0,
          outputUrl: url,
          status: "completed",
          isNsfw: true,
          isTrial: false,
          completedAt: new Date(),
        },
      });
      results.push(gen.id);
    }

    res.json({ success: true, count: results.length, generationIds: results });
  } catch (error) {
    console.error("Error bulk importing gallery:", error);
    res.status(500).json({ success: false, error: "Failed to bulk import gallery" });
  }
});

/**
 * GET /api/admin/telemetry/overview
 * Admin telemetry summary for traffic, infra, and edge cases
 */
router.get("/telemetry/overview", async (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const overview = await getTelemetryOverview(hours);
    res.json({ success: true, telemetry: overview });
  } catch (error) {
    console.error("Error fetching telemetry overview:", error);
    res.status(500).json({ success: false, error: "Failed to fetch telemetry overview" });
  }
});

/**
 * GET /api/admin/telemetry/requests
 * Paginated raw traffic entries
 */
router.get("/telemetry/requests", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [items, total] = await Promise.all([
      prisma.apiRequestMetric.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          method: true,
          routePath: true,
          normalizedPath: true,
          statusCode: true,
          durationMs: true,
          userId: true,
          isAdmin: true,
          requestBytes: true,
          responseBytes: true,
          createdAt: true,
        },
      }),
      prisma.apiRequestMetric.count({
        where: { createdAt: { gte: since } },
      }),
    ]);

    res.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      filters: { hours },
    });
  } catch (error) {
    console.error("Error fetching telemetry requests:", error);
    res.status(500).json({ success: false, error: "Failed to fetch telemetry requests" });
  }
});

/**
 * GET /api/admin/telemetry/edge-events
 * Recent edge-case events (rate-limit, slow requests, server errors)
 */
router.get("/telemetry/edge-events", async (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 100));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const events = await prisma.telemetryEdgeEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventType: true,
        severity: true,
        message: true,
        routePath: true,
        statusCode: true,
        userId: true,
        detailsJson: true,
        createdAt: true,
      },
    });

    res.json({ success: true, events, filters: { hours, limit } });
  } catch (error) {
    console.error("Error fetching telemetry edge events:", error);
    res.status(500).json({ success: false, error: "Failed to fetch telemetry edge events" });
  }
});

/**
 * GET /api/admin/telemetry/endpoint-health
 * Latest endpoint health snapshot run
 */
router.get("/telemetry/endpoint-health", async (req, res) => {
  try {
    const data = await getLatestEndpointHealthSnapshots();
    res.json({ success: true, ...data });
  } catch (error) {
    console.error("Error fetching endpoint health snapshots:", error);
    res.status(500).json({ success: false, error: "Failed to fetch endpoint health snapshots" });
  }
});

/**
 * GET /api/admin/safety/child-incidents
 * Immutable records of blocked child-sexual generation attempts.
 */
router.get("/safety/child-incidents", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.childSafetyIncident.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.childSafetyIncident.count(),
    ]);

    return res.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching child safety incidents:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch child safety incidents" });
  }
});

router.post("/impersonate", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, banLocked: true },
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (targetUser.banLocked) {
      return res.status(403).json({
        success: false,
        message: "Cannot impersonate a ban-locked account. Unban first if you need access.",
      });
    }

    const jti = randomUUID();
    const impersonateToken = jwt.sign(
      { userId: targetUser.id, email: targetUser.email, impersonatedBy: req.user.userId, jti },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );
    const decodedToken = jwt.decode(impersonateToken);
    const expiresAt = decodedToken?.exp ? new Date(decodedToken.exp * 1000).toISOString() : null;
    const baseUrl =
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      `${req.protocol}://${req.get("host")}`;
    const normalizedBase = String(baseUrl || "").replace(/\/+$/, "");
    const relativeLoginUrl = `/admin-login?token=${impersonateToken}`;
    const absoluteLoginUrl = `${normalizedBase}${relativeLoginUrl}`;

    console.log(`🔑 Admin ${req.user.email} impersonating user ${targetUser.email} (${targetUser.id})`);

    res.json({
      success: true,
      token: impersonateToken,
      loginUrl: relativeLoginUrl,
      absoluteLoginUrl,
      expiresAt,
      user: targetUser,
    });
  } catch (error) {
    console.error("Impersonate error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * GET /api/admin/email-unsubscribes
 * Returns the full list of unsubscribed emails.
 */
router.get("/email-unsubscribes", async (_req, res) => {
  try {
    const records = await prisma.emailUnsubscribe.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, total: records.length, unsubscribes: records });
  } catch (error) {
    console.error("Error fetching unsubscribes:", error);
    res.status(500).json({ error: "Failed to fetch unsubscribes" });
  }
});

/**
 * DELETE /api/admin/email-unsubscribes/:email
 * Remove an email from the unsubscribe list (re-subscribe).
 */
router.delete("/email-unsubscribes/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    await prisma.emailUnsubscribe.deleteMany({ where: { email } });
    res.json({ success: true, message: `${email} removed from unsubscribe list` });
  } catch (error) {
    console.error("Error removing unsubscribe:", error);
    res.status(500).json({ error: "Failed to remove unsubscribe" });
  }
});

router.get("/discount-codes", async (_req, res) => {
  try {
    const codes = await prisma.discountCode.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, codes });
  } catch (error) {
    console.error("Error fetching discount codes:", error);
    res.status(500).json({ error: "Failed to fetch discount codes" });
  }
});

router.post("/discount-codes", async (req, res) => {
  try {
    const { code, discountType, discountValue, appliesTo, validFrom, validUntil, maxUses, minPurchaseAmount } = req.body;

    if (!code || !discountValue || !validUntil) {
      return res.status(400).json({ error: "Code, discount value, and expiry date are required" });
    }

    const normalized = code.trim().toUpperCase();

    const existing = await prisma.discountCode.findUnique({ where: { code: normalized } });
    if (existing) {
      return res.status(400).json({ error: "A discount code with this name already exists" });
    }

    if (discountType === "percentage" && (discountValue <= 0 || discountValue > 100)) {
      return res.status(400).json({ error: "Percentage discount must be between 1 and 100" });
    }

    const created = await prisma.discountCode.create({
      data: {
        code: normalized,
        discountType: discountType || "percentage",
        discountValue: parseFloat(discountValue),
        appliesTo: appliesTo || "both",
        validFrom: validFrom ? new Date(validFrom) : new Date(),
        validUntil: new Date(validUntil),
        maxUses: maxUses ? parseInt(maxUses) : null,
        minPurchaseAmount: minPurchaseAmount ? parseFloat(minPurchaseAmount) : null,
      },
    });

    res.json({ success: true, code: created });
  } catch (error) {
    console.error("Error creating discount code:", error);
    res.status(500).json({ error: "Failed to create discount code" });
  }
});

router.patch("/discount-codes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { discountType, discountValue, appliesTo, validFrom, validUntil, maxUses, minPurchaseAmount, isActive } = req.body;

    const updates = {};
    if (discountType !== undefined) updates.discountType = discountType;
    if (discountValue !== undefined) updates.discountValue = parseFloat(discountValue);
    if (appliesTo !== undefined) updates.appliesTo = appliesTo;
    if (validFrom !== undefined) updates.validFrom = new Date(validFrom);
    if (validUntil !== undefined) updates.validUntil = new Date(validUntil);
    if (maxUses !== undefined) updates.maxUses = maxUses ? parseInt(maxUses) : null;
    if (minPurchaseAmount !== undefined) updates.minPurchaseAmount = minPurchaseAmount ? parseFloat(minPurchaseAmount) : null;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await prisma.discountCode.update({
      where: { id },
      data: updates,
    });

    res.json({ success: true, code: updated });
  } catch (error) {
    console.error("Error updating discount code:", error);
    res.status(500).json({ error: "Failed to update discount code" });
  }
});

router.delete("/discount-codes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.discountCode.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({ success: true, message: "Discount code deactivated" });
  } catch (error) {
    console.error("Error deactivating discount code:", error);
    res.status(500).json({ error: "Failed to deactivate discount code" });
  }
});

export default router;
