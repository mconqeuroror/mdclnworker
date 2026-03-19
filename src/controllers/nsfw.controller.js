/**
 * NSFW Controller - Handles LoRA training and NSFW content generation
 *
 * Flow:
 * 1. Create a LoRA record for a model
 * 2. Assign training images from gallery (standard: 15, pro: 30)
 * 3. Train LoRA on fal.ai (training remains on fal.ai)
 * 4. Once LoRA is ready, generate NSFW content via self-hosted ComfyUI on Runpod
 *
 * Multi-LoRA: Each model can have multiple trained LoRAs.
 * An "active" LoRA is selected via SavedModel.activeLoraId.
 *
 * SECURITY: Only AI-generated models can use NSFW features
 */

import prisma from "../lib/prisma.js";
import {
  generateTriggerWord,
  normalizeCaptionSubjectClass,
  startLoraTraining,
  checkTrainingStatus,
  getTrainingResult,
  archiveLoraToR2,
  submitNsfwGeneration,
  checkNsfwGenerationStatus,
  pollNsfwJob,
  getNsfwGenerationResult,
  archiveNsfwImageToR2,
  buildNsfwPrompt,
  faceSwapWithFal,
} from "../services/fal.service.js";
import { submitNsfwVideo, pollNsfwVideo, submitNsfwVideoExtend } from "../services/wavespeed.service.js";
import { generateImageWithNanoBananaKie } from "../services/kie.service.js";
import { generateImageWithSeedreamWaveSpeed } from "../services/wavespeed.service.js";
import requestQueue from "../services/queue.service.js";
import {
  checkAndExpireCredits,
  getTotalCredits,
  deductCredits,
  deductCreditsTx,
  refundCredits,
  refundGeneration,
} from "../services/credit.service.js";
import { isR2Configured, mirrorToR2, reMirrorToR2, deleteFromR2 } from "../utils/r2.js";
import { mirrorToBlob, isVercelBlobConfigured } from "../utils/kieUpload.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import { cleanupOldGenerations } from "./generation.controller.js";
import { resolveNsfwResolution } from "../utils/nsfwResolution.js";

// Models with age < 18 cannot use NSFW or LoRA (policy)
function isMinorModel(model) {
  return model && typeof model.age === "number" && model.age < 18;
}

// Single source of truth: full LoRA-style appearance keys (chips or custom text per category)
const APPEARANCE_VALID_KEYS = [
  "gender", "heritage", "ethnicity", "hairColor", "hairType", "hairLength", "hairTexture",
  "skinTone", "eyeColor", "eyeShape", "faceShape", "noseShape", "lipSize", "bodyType", "height",
  "breastSize", "buttSize", "waist", "hips", "tattoos", "faceType", "style",
];

// Upload media for KIE — use Vercel Blob if configured (guaranteed public), else R2
async function ensureKieUrl(url) {
  if (!url?.startsWith("http")) return url;
  if (isVercelBlobConfigured()) return mirrorToBlob(url, "kie-media");
  return reMirrorToR2(url, "generations").catch(() => url);
}
import { validateImageUrl, validateImageUrls } from "../utils/fileValidation.js";
import { getSafeErrorMessage } from "../utils/safe-error.js";
import {
  NUDES_PACK_CREDITS_PER_IMAGE,
  validateNudesPackPoseIds,
  getNudesPackPoseById,
} from "../../shared/nudesPackPoses.js";

async function cleanupTrainingDataset(loraId, modelId) {
  try {
    console.log(`🧹 Cleaning up training dataset for LoRA ${loraId || "legacy"}, model ${modelId}...`);

    const whereClause = loraId
      ? { loraId, status: "completed" }
      : { modelId, loraId: null, status: "completed" };

    const trainingImages = await prisma.loraTrainingImage.findMany({
      where: whereClause,
      select: { id: true, imageUrl: true },
    });

    let deletedR2 = 0;
    for (const img of trainingImages) {
      if (img.imageUrl && img.imageUrl.includes("r2.dev")) {
        try {
          await deleteFromR2(img.imageUrl);
          deletedR2++;
        } catch (err) {
          console.warn(`  ⚠️ Failed to delete R2 training image: ${err.message}`);
        }
      }
    }

    if (trainingImages.length > 0) {
      await prisma.loraTrainingImage.deleteMany({
        where: { id: { in: trainingImages.map(i => i.id) } },
      });
    }

    console.log(`🧹 Training dataset cleanup done: ${deletedR2} R2 files deleted, ${trainingImages.length} DB records removed`);
  } catch (error) {
    console.error("🧹 Training dataset cleanup error (non-critical):", error.message);
  }
}

async function awardFirstLoraTrainingBonus({ userId, modelId, targetLoraId = null }) {
  const BONUS_CREDITS = 200;
  return prisma.$transaction(async (tx) => {
    const existingBonus = await tx.creditTransaction.findFirst({
      where: { userId, type: "first_lora_bonus" },
    });
    if (existingBonus) return 0;

    const userModels = await tx.savedModel.findMany({
      where: { userId },
      select: { id: true, loraStatus: true },
    });
    const userModelIds = userModels.map((m) => m.id);

    // Only award once for the user's first successfully trained LoRA.
    const hasOtherReadyLora = await tx.trainedLora.findFirst({
      where: {
        modelId: { in: userModelIds },
        status: "ready",
        ...(targetLoraId ? { id: { not: targetLoraId } } : {}),
      },
      select: { id: true },
    });
    if (hasOtherReadyLora) return 0;

    // Legacy fallback: when trainedLora rows are not involved, rely on model loraStatus.
    const hasOtherLegacyReady = userModels.some(
      (m) => m.id !== modelId && m.loraStatus === "ready",
    );
    if (hasOtherLegacyReady) return 0;

    await tx.user.update({
      where: { id: userId },
      data: { purchasedCredits: { increment: BONUS_CREDITS } },
    });
    await tx.creditTransaction.create({
      data: {
        userId,
        amount: BONUS_CREDITS,
        type: "first_lora_bonus",
        description: `First LoRA training bonus - ${BONUS_CREDITS} free credits`,
      },
    });
    console.log(`🎁 Awarded ${BONUS_CREDITS} bonus credits to user ${userId} for first LoRA training`);
    return BONUS_CREDITS;
  });
}

// Credit costs
const CREDITS_FOR_LORA_TRAINING = 750;
const CREDITS_FOR_PRO_LORA_TRAINING = 1500;
const CREDITS_FOR_TRAINING_SESSION = 750;
const CREDITS_PER_NSFW_IMAGE = 30;
const CREDITS_PER_NSFW_DOUBLE = 50;
const CREDITS_PER_TRAINING_IMAGE = 30;
const CREDITS_FOR_FACE_REFERENCE = 30;

async function persistTrainingImageUrl(url) {
  if (!url) return url;
  if (!isR2Configured()) return url;
  try {
    return await mirrorToR2(url, "training");
  } catch (error) {
    console.error("⚠️ Failed to mirror training image to R2:", error.message);
    return url;
  }
}

// ============================================
// Attribute helpers
// ============================================
function buildAttributeList(attrs = {}) {
  if (!attrs || typeof attrs !== "object") return [];
  const order = [
    "hairColor",
    "hairType",
    "skinTone",
    "eyeColor",
    "lipSize",
    "breastSize",
    "makeup",
    "outfit",
    "expression",
    "poseStyle",
    "bodyPose",
    "cameraAngle",
    "shotType",
    "background",
    "lighting",
    "flash",
    "timeOfDay",
    "colorMood",
    "cameraLens",
    "composition",
    "nailsColor",
    "nailsFinish",
    "props",
    "extra",
  ];

  return order
    .map((key) => {
      const val = attrs[key];
      return typeof val === "string" ? val.trim() : "";
    })
    .filter((v) => v);
}

function summarizeAttributes(attrs = {}, fallbackString = "") {
  const labelMap = {
    hairColor: "Hair",
    hairType: "Hair Type",
    skinTone: "Skin",
    eyeColor: "Eyes",
    lipSize: "Lips",
    breastSize: "Breast size",
    makeup: "Makeup",
    outfit: "Outfit",
    expression: "Expression",
    poseStyle: "Pose style",
    bodyPose: "Body pose",
    cameraAngle: "Camera angle",
    shotType: "Shot type",
    background: "Background",
    lighting: "Lighting",
    flash: "Flash",
    timeOfDay: "Time of day",
    colorMood: "Color mood",
    cameraLens: "Lens",
    composition: "Composition",
    nailsColor: "Nail color",
    nailsFinish: "Nail finish",
    props: "Props",
    extra: "Extra",
  };

  const lines = Object.entries(labelMap)
    .map(([key, label]) => {
      const val = attrs?.[key];
      return typeof val === "string" && val.trim()
        ? `- ${label}: ${val.trim()}`
        : null;
    })
    .filter(Boolean);

  if (fallbackString && fallbackString.trim()) {
    lines.push(`- Other: ${fallbackString.trim()}`);
  }

  return lines.length ? lines.join("\n") : "- None provided";
}

// ============================================
// AI-DETERMINED LORA STRENGTH
// Uses Grok to analyze the prompt/scene and decide
// optimal LoRA strength based on face visibility rules
// ============================================
async function determineLoraStrengthWithAI(prompt, attributes) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    console.log("⚠️ No OPENROUTER_API_KEY, falling back to default LoRA strength 0.70");
    return 0.70;
  }

  const combined = `${prompt || ""} ${attributes || ""}`.trim();
  if (!combined) return 0.70;

  const systemPrompt = `You are a LoRA strength calculator for AI image generation. Determine the optimal LoRA strength for a face/identity LoRA based on face visibility.

STRENGTH GUIDELINES (0.55 to 0.80):
- 0.80: Face is the main focus (selfies, portraits, close-up face shots, headshots)
- 0.75: Face clearly visible and important (POV shots, looking at camera, mirror selfies)
- 0.70: Face visible but not the main focus (medium shots, casual poses, standing, sitting)
- 0.65: Face partially visible or at distance (full body shots, from behind but looking back, lying down)
- 0.60: Face barely visible or hidden (from behind, face down, looking away, body-focused shots)
- 0.55: Face not visible at all (pure body shots from behind, back view, no face in frame)
IMPORTANT: When in doubt, use 0.70. Too high causes face distortion/mutations.

INPUT SCENE: "${combined}"

OUTPUT: Return ONLY a single decimal number between 0.55 and 0.80. Nothing else. Example: 0.70`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "x-ai/grok-4.1-fast",
        max_tokens: 32,
        messages: [{ role: "user", content: systemPrompt }],
      }),
    });

    if (!response.ok) {
      console.error("⚠️ Grok LoRA strength API error, falling back to 0.70");
      return 0.70;
    }

    const result = await response.json();
    let rawContent = result.choices?.[0]?.message?.content || "";
    rawContent = rawContent.includes("<think>")
      ? rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
      : rawContent.trim();

    const parsed = parseFloat(rawContent);
    if (isNaN(parsed) || parsed < 0.40 || parsed > 0.90) {
      console.log(`⚠️ AI returned invalid LoRA strength "${rawContent}", falling back to 0.70`);
      return 0.70;
    }

    const clamped = Math.max(0.55, Math.min(0.80, parsed));
    console.log(`🤖 AI determined LoRA strength: ${clamped} (raw: ${rawContent})`);
    return clamped;
  } catch (error) {
    console.error("⚠️ LoRA strength AI call failed:", error.message);
    return 0.70;
  }
}

// ============================================
// HELPER: Sync legacy SavedModel fields from TrainedLora
// ============================================
async function syncLegacyLoraFields(modelId, loraId) {
  if (!loraId) {
    await prisma.savedModel.update({
      where: { id: modelId },
      data: {
        activeLoraId: null,
        loraStatus: null,
        loraUrl: null,
        loraTriggerWord: null,
        loraTrainedAt: null,
        loraFalRequestId: null,
        loraError: null,
        faceReferenceUrl: null,
      },
    });
    return;
  }

  const lora = await prisma.trainedLora.findUnique({ where: { id: loraId } });
  if (!lora) return;

  await prisma.savedModel.update({
    where: { id: modelId },
    data: {
      activeLoraId: loraId,
      loraStatus: lora.status,
      loraUrl: lora.loraUrl,
      loraTriggerWord: lora.triggerWord,
      loraTrainedAt: lora.trainedAt,
      loraFalRequestId: lora.falRequestId,
      loraError: lora.error,
      faceReferenceUrl: lora.faceReferenceUrl,
      nsfwUnlocked: lora.status === "ready" ? true : undefined,
    },
  });
}

// ============================================
// NEW ENDPOINT: Create a LoRA record
// POST /api/nsfw/lora/create
// Body: { modelId, name?, defaultAppearance? }
// ============================================
export async function createLora(req, res) {
  try {
    const { modelId, name, defaultAppearance, trainingMode } = req.body;
    const userId = req.user.userId;
    const mode = trainingMode === "pro" ? "pro" : "standard";

    if (!modelId) {
      return res.status(400).json({ success: false, message: "modelId is required" });
    }

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW features are only available for AI-generated models.",
      });
    }
    if (isMinorModel(model)) {
      return res.status(403).json({
        success: false,
        message: "Models under 18 cannot be used for LoRA training.",
      });
    }

    const existingCount = await prisma.trainedLora.count({ where: { modelId } });
    const loraName = name || `LoRA #${existingCount + 1}`;

    // Use model.savedAppearance as default so new LoRA gets single source of truth
    const sourceAppearance = defaultAppearance && typeof defaultAppearance === "object" ? defaultAppearance : (model.savedAppearance && typeof model.savedAppearance === "object" ? model.savedAppearance : null);
    let sanitizedAppearance = null;
    if (sourceAppearance) {
      sanitizedAppearance = {};
      for (const key of APPEARANCE_VALID_KEYS) {
        const v = sourceAppearance[key];
        if (v != null && typeof v === "string" && v.trim()) {
          sanitizedAppearance[key] = v.trim();
        }
      }
      if (Object.keys(sanitizedAppearance).length === 0) sanitizedAppearance = null;
    }

    const lora = await prisma.trainedLora.create({
      data: {
        modelId,
        name: loraName,
        status: "awaiting_images",
        trainingMode: mode,
        defaultAppearance: sanitizedAppearance,
      },
    });

    console.log(`✅ Created LoRA "${loraName}" for model ${modelId} (appearance: ${sanitizedAppearance ? Object.keys(sanitizedAppearance).length + ' fields' : 'none'})`);

    res.json({
      success: true,
      lora,
    });
  } catch (error) {
    console.error("❌ Create LoRA error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// NEW ENDPOINT: Get all LoRAs for a model
// GET /api/nsfw/loras/:modelId
// ============================================
export async function getModelLoras(req, res) {
  try {
    const { modelId } = req.params;
    const userId = req.user.userId;

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const loras = await prisma.trainedLora.findMany({
      where: { modelId },
      include: {
        _count: {
          select: { trainingImages: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      success: true,
      loras: loras.map((l) => ({
        ...l,
        // SQLite stores JSON fields as strings — parse back to object for the client
        defaultAppearance: l.defaultAppearance
          ? (typeof l.defaultAppearance === "string" ? (() => { try { return JSON.parse(l.defaultAppearance); } catch { return null; } })() : l.defaultAppearance)
          : null,
        trainingImageCount: l._count.trainingImages,
        _count: undefined,
      })),
      activeLoraId: model.activeLoraId,
    });
  } catch (error) {
    console.error("❌ Get model LoRAs error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// NEW ENDPOINT: Set active LoRA
// POST /api/nsfw/lora/set-active
// Body: { modelId, loraId }
// ============================================
export async function setActiveLora(req, res) {
  try {
    const { modelId, loraId } = req.body;
    const userId = req.user.userId;

    if (!modelId || !loraId) {
      return res.status(400).json({ success: false, message: "modelId and loraId are required" });
    }

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const lora = await prisma.trainedLora.findUnique({ where: { id: loraId } });
    if (!lora || lora.modelId !== modelId) {
      return res.status(400).json({ success: false, message: "LoRA not found or does not belong to this model" });
    }
    if (lora.status !== "ready") {
      return res.status(400).json({ success: false, message: "Can only activate a LoRA with status 'ready'" });
    }

    await syncLegacyLoraFields(modelId, loraId);

    console.log(`✅ Set active LoRA ${loraId} for model ${modelId}`);

    res.json({
      success: true,
      message: "Active LoRA updated",
      activeLoraId: loraId,
    });
  } catch (error) {
    console.error("❌ Set active LoRA error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// NEW ENDPOINT: Delete a LoRA
// DELETE /api/nsfw/lora/:loraId
// ============================================
export async function deleteLora(req, res) {
  try {
    const { loraId } = req.params;
    const userId = req.user.userId;

    const lora = await prisma.trainedLora.findUnique({
      where: { id: loraId },
      include: { model: true },
    });

    if (!lora) {
      return res.status(404).json({ success: false, message: "LoRA not found" });
    }
    if (lora.model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (lora.status === "training") {
      return res.status(409).json({
        success: false,
        message: "Cannot delete LoRA while training is in progress",
      });
    }

    const modelId = lora.modelId;

    if (lora.status === "ready" && lora.model.nsfwUnlocked) {
      const readyCount = await prisma.trainedLora.count({
        where: { modelId, status: "ready" },
      });

      if (readyCount <= 1) {
        await prisma.savedModel.update({
          where: { id: modelId },
          data: { nsfwUnlocked: false },
        });
      }
    }

    const wasActive = lora.model.activeLoraId === loraId;

    const trainingImages = await prisma.loraTrainingImage.findMany({
      where: { loraId },
      select: { imageUrl: true },
    });
    for (const img of trainingImages) {
      if (img.imageUrl && (img.imageUrl.includes("r2.dev") || img.imageUrl.includes(process.env.R2_PUBLIC_URL || "__r2__"))) {
        try { await deleteFromR2(img.imageUrl); } catch (e) { /* best-effort */ }
      }
    }
    if (lora.loraUrl && (lora.loraUrl.includes("r2.dev") || lora.loraUrl.includes(process.env.R2_PUBLIC_URL || "__r2__"))) {
      try { await deleteFromR2(lora.loraUrl); } catch (e) { /* best-effort */ }
    }

    await prisma.loraTrainingImage.deleteMany({ where: { loraId } });
    await prisma.trainedLora.delete({ where: { id: loraId } });

    if (wasActive) {
      const nextReadyLora = await prisma.trainedLora.findFirst({
        where: { modelId, status: "ready", id: { not: loraId } },
        orderBy: { createdAt: "desc" },
      });
      await syncLegacyLoraFields(modelId, nextReadyLora?.id || null);
    }

    console.log(`🗑️ Deleted LoRA ${loraId} from model ${modelId}`);

    res.json({
      success: true,
      message: "LoRA deleted",
      clearedActive: wasActive,
    });
  } catch (error) {
    console.error("❌ Delete LoRA error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// UPDATE LoRA default appearance
// PUT /api/nsfw/lora/:loraId/appearance
// Body: { appearance: { hairColor, hairType, ... } }
// ============================================
export async function updateLoraAppearance(req, res) {
  try {
    const { loraId } = req.params;
    const userId = req.user.userId;
    const { appearance } = req.body;

    const lora = await prisma.trainedLora.findUnique({
      where: { id: loraId },
      include: { model: true },
    });

    if (!lora) return res.status(404).json({ success: false, message: "LoRA not found" });
    if (lora.model.userId !== userId) return res.status(403).json({ success: false, message: "Not authorized" });

    // Single source of truth: write to MODEL so one place drives all prompts and LoRA looks
    let sanitized = null;
    if (appearance && typeof appearance === "object") {
      sanitized = {};
      for (const key of APPEARANCE_VALID_KEYS) {
        const v = appearance[key];
        if (v != null && typeof v === "string" && v.trim()) {
          sanitized[key] = v.trim();
        }
      }
      if (Object.keys(sanitized).length === 0) sanitized = null;
    }

    const modelId = lora.modelId;
    await prisma.savedModel.update({
      where: { id: modelId },
      data: { savedAppearance: Object.keys(sanitized || {}).length > 0 ? sanitized : null },
    });
    await prisma.trainedLora.update({
      where: { id: loraId },
      data: { defaultAppearance: sanitized },
    });

    console.log(`✅ Updated appearance for model ${modelId} (LoRA ${loraId}): ${sanitized ? Object.keys(sanitized).length + ' fields' : 'cleared'} — single source of truth`);
    res.json({ success: true, defaultAppearance: sanitized });
  } catch (error) {
    console.error("❌ Update LoRA appearance error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// AUTO-DETECT LoRA appearance via Grok Vision
// POST /api/nsfw/lora/:loraId/auto-appearance
// ============================================
const APPEARANCE_OPTIONS = {
  ethnicity: ["caucasian", "latina", "asian", "east asian", "south asian", "middle eastern", "black african", "mixed race", "pacific islander"],
  hairColor: ["blonde hair", "brunette hair", "black hair", "red hair", "pink hair", "platinum blonde hair", "auburn hair", "silver hair", "white hair", "strawberry blonde hair", "dark brown hair", "light brown hair", "honey blonde hair"],
  hairType: ["long straight hair", "long wavy hair", "long curly hair", "short straight hair", "short curly hair", "medium length hair", "ponytail", "braided hair", "messy bun", "hair down over shoulders", "pigtails", "twin braids", "half up half down", "wet slicked back hair", "bob cut", "pixie cut", "bangs with long hair"],
  skinTone: ["pale white skin", "fair skin", "light skin", "lightly tanned skin", "tanned skin", "olive skin", "caramel skin", "brown skin", "dark brown skin", "dark skin", "sun-kissed skin", "porcelain skin"],
  eyeColor: ["blue eyes", "green eyes", "brown eyes", "hazel eyes", "grey eyes", "dark brown eyes", "light brown eyes", "amber eyes"],
  eyeShape: ["almond shaped eyes", "round eyes", "hooded eyes", "upturned eyes", "monolid eyes", "deep set eyes", "large doe eyes"],
  faceShape: ["oval face", "round face", "heart shaped face", "square jaw face", "diamond face", "long face", "soft angular face"],
  noseShape: ["small button nose", "straight narrow nose", "slightly upturned nose", "wide nose", "aquiline nose", "flat bridge nose", "petite nose"],
  lipSize: ["thin lips", "medium lips", "full lips", "plump lips", "bow shaped lips", "wide lips"],
  bodyType: ["slim body", "athletic body", "curvy body", "petite body", "thick body", "slim sporty body", "muscular body", "hourglass body", "pear shaped body", "slim thick body"],
  height: ["short stature", "average height", "tall stature", "very tall stature"],
  breastSize: ["small perky breasts", "medium sized breasts", "large round breasts", "huge breasts", "natural teardrop breasts"],
  buttSize: ["small tight butt", "round medium butt", "large round butt", "thick bubble butt", "athletic toned butt"],
  waist: ["very narrow waist", "slim waist", "average waist", "wide waist", "tiny waist wide hips"],
  hips: ["narrow hips", "average hips", "wide hips", "very wide hips", "curvy wide hips"],
  tattoos: ["no tattoos", "small tattoos", "arm sleeve tattoo", "multiple tattoos", "full body tattoos", "navel piercing", "nipple piercings", "nose piercing"],
};

const SUPPORTED_VISION_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);

function inferImageMimeFromUrl(url) {
  if (typeof url !== "string") return null;
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".jpeg") || clean.endsWith(".jpg")) return "image/jpeg";
  if (clean.endsWith(".png")) return "image/png";
  return null;
}

async function buildVisionImageMessage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error("Image payload is empty");
    }
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image is too large for auto-detect (max 10MB per image)");
    }

    let mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!SUPPORTED_VISION_MIME_TYPES.has(mime)) {
      mime = inferImageMimeFromUrl(url) || mime;
    }
    if (!SUPPORTED_VISION_MIME_TYPES.has(mime)) {
      throw new Error(
        `Unsupported image content type: ${mime || "unknown"} (supported: jpeg/png)`
      );
    }

    return {
      ok: true,
      message: {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` },
      },
    };
  } catch (error) {
    return { ok: false, warning: error?.message || "Failed to prepare image for vision model" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function autoDetectLoraAppearance(req, res) {
  try {
    const { loraId } = req.params;
    const userId = req.user.userId;
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "Auto-detect is temporarily unavailable (missing AI provider key)",
      });
    }

    const lora = await prisma.trainedLora.findUnique({
      where: { id: loraId },
      include: { model: true },
    });

    if (!lora) return res.status(404).json({ success: false, message: "LoRA not found" });
    if (lora.model.userId !== userId) return res.status(403).json({ success: false, message: "Not authorized" });

    const photos = [lora.model.photo1Url, lora.model.photo2Url, lora.model.photo3Url, lora.model.thumbnail]
      .filter(Boolean);
    if (photos.length === 0) return res.status(400).json({ success: false, message: "No photos available for this model" });

    const optionsBlock = Object.entries(APPEARANCE_OPTIONS)
      .map(([key, opts]) => `${key}: ${JSON.stringify(opts)}`)
      .join("\n");

    const systemPrompt = `You are an expert physical appearance analyst for AI model training. You will receive ${photos.length} photo(s) of the same person. Your job is to build a COMPREHENSIVE and PRECISE profile of this person's physical features so that an AI image generator can recreate them consistently across different scenes and poses.

CRITICAL: Be as thorough as possible. Fill in EVERY category you can determine. Cross-reference all photos to ensure accuracy. Look at the full body, face, hair, skin, and overall build. This profile is used to maintain model consistency — missing fields mean the AI will generate inconsistent results.

Return ONLY a valid JSON object (no markdown, no explanation) with these keys. Each value MUST be one of the allowed options listed below — pick the single closest match for EACH category:

${optionsBlock}

IMPORTANT GUIDELINES:
- Ethnicity: Determine from facial features, skin tone, and overall appearance
- Hair: Note both the natural color AND the style/length visible across photos
- Skin tone: Be precise — distinguish between fair, light, tanned, olive, etc.
- Eye color and shape: Look closely at close-up photos if available
- Face shape and nose: Critical for model consistency
- Body: Assess body type, breast size, butt shape, waist, and hips from full/partial body shots
- Height: Estimate relative to surroundings if possible
- Tattoos/piercings: Note any visible body modifications

Try to fill ALL fields. Only omit a key if it is truly impossible to determine from any of the photos.`;

    const { default: OpenAI } = await import("openai");
    const grok = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    console.log(`🔍 Auto-detecting appearance for LoRA ${loraId} from ${photos.length} photos`);

    const preparedImages = await Promise.all(photos.map((url) => buildVisionImageMessage(url)));
    const imageMessages = preparedImages.filter((x) => x.ok).map((x) => x.message);
    const imageWarnings = preparedImages.filter((x) => !x.ok).map((x) => x.warning);
    if (imageWarnings.length > 0) {
      console.warn(`⚠️ Auto-detect image prep warnings for ${loraId}:`, imageWarnings);
    }
    if (imageMessages.length === 0) {
      return res.status(422).json({
        success: false,
        message: "No valid training photos were available for AI auto-detect (supported: jpg/png).",
      });
    }

    let completion;
    try {
      completion = await grok.chat.completions.create({
        model: "x-ai/grok-4.1-fast",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              ...imageMessages,
              { type: "text", text: "Analyze this person's full appearance across all photos. Be thorough — fill every category you can. Return the complete JSON." },
            ],
          },
        ],
        max_tokens: 600,
        temperature: 0.15,
      });
    } catch (providerError) {
      const providerMessage = providerError?.message || "";
      const providerStatus = providerError?.status;
      console.error("❌ Vision provider error:", providerStatus, providerMessage);
      if (/unsupported content-type/i.test(providerMessage)) {
        return res.status(422).json({
          success: false,
          message: "One or more LoRA photos use an unsupported image type for AI auto-detect.",
        });
      }
      return res.status(502).json({
        success: false,
        message: "AI provider error while auto-detecting appearance. Please try again.",
      });
    }

    const content = completion.choices?.[0]?.message?.content;
    const raw =
      typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
        ? content
            .map((part) => {
              if (typeof part === "string") return part;
              if (part && typeof part === "object") return part.text || part.content || "";
              return "";
            })
            .join("\n")
            .trim()
        : content && typeof content === "object"
        ? String(content.text || content.content || "")
        : "";

    console.log(`🔍 Grok raw response: ${raw || "[empty]"}`);
    if (!raw) {
      return res.status(502).json({ success: false, message: "AI returned an empty response" });
    }

    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("❌ Grok returned no valid JSON:", raw);
      return res.status(502).json({ success: false, message: "AI did not return valid appearance data" });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (_parseError) {
      console.error("❌ Failed to parse AI JSON:", jsonMatch[0]);
      return res.status(502).json({ success: false, message: "AI returned malformed appearance JSON" });
    }

    const validated = {};
    for (const [key, allowedValues] of Object.entries(APPEARANCE_OPTIONS)) {
      const value = typeof parsed[key] === "string" ? parsed[key].trim() : "";
      if (!value) continue;
      const canonical = allowedValues.find((opt) => opt.toLowerCase() === value.toLowerCase());
      if (canonical) {
        validated[key] = canonical;
      } else {
        // No chip match — store as custom so the Custom field is filled
        validated[key] = value;
      }
    }

    if (Object.keys(validated).length === 0) {
      return res.status(422).json({ success: false, message: "AI could not detect any appearance features" });
    }

    const modelId = lora.modelId;

    await prisma.trainedLora.update({
      where: { id: loraId },
      data: { defaultAppearance: validated },
    });

    // Single source of truth: also write to model.savedAppearance so prompts and chips use it everywhere
    await prisma.savedModel.update({
      where: { id: modelId },
      data: { savedAppearance: validated },
    });

    console.log(`✅ Auto-detected appearance for LoRA ${loraId} (synced to model ${modelId}): ${JSON.stringify(validated)}`);
    res.json({ success: true, defaultAppearance: validated });
  } catch (error) {
    console.error("❌ Auto-detect appearance error:", error);
    res.status(500).json({ success: false, message: "Failed to auto-detect appearance" });
  }
}

// ============================================
// LEGACY ENDPOINT: Initialize training session
// POST /api/nsfw/initialize-training
// Body: { modelId }
// ============================================
export async function initializeTrainingSession(req, res) {
  let userId = null;
  let modelId = null;

  try {
    modelId = req.body.modelId;
    userId = req.user.userId;

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
    });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to access this model" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW features are only available for AI-generated models. This protects real people's privacy and consent.",
      });
    }
    if (isMinorModel(model)) {
      return res.status(403).json({
        success: false,
        message: "Models under 18 cannot be used for LoRA training.",
      });
    }
    if (model.loraSessionPaid) {
      return res.status(400).json({
        success: false,
        message: "Training session already initialized. You can now generate images.",
        alreadyPaid: true,
      });
    }
    if (model.nsfwUnlocked || model.loraStatus === "ready") {
      return res.status(400).json({ success: false, message: "LoRA is already trained for this model." });
    }

    const creditsNeeded = CREDITS_FOR_TRAINING_SESSION;

    await prisma.$transaction(async (tx) => {
      await deductCreditsTx(tx, userId, creditsNeeded);
      await tx.savedModel.update({
        where: { id: modelId },
        data: { loraStatus: "awaiting_images", loraSessionPaid: true },
      });
    });

    console.log(`💳 Deducted ${creditsNeeded} credits for training session initialization`);

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

    res.json({
      success: true,
      message: "Training session initialized! You can now generate the 15 training images.",
      creditsUsed: creditsNeeded,
      creditsRemaining: getTotalCredits(updatedUser),
    });
  } catch (error) {
    console.error("❌ Initialize training session error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// MODIFIED ENDPOINT: Assign training images
// POST /api/nsfw/assign-training-images
// Body: { modelId, loraId, images: [{ generationId }] }
// ============================================
export async function assignTrainingImages(req, res) {
  try {
    const { modelId, loraId, images } = req.body;
    const userId = req.user.userId;

    if (!modelId || !images || !Array.isArray(images)) {
      return res.status(400).json({
        success: false,
        message: "modelId and images array are required",
      });
    }

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW features are only available for AI-generated models.",
      });
    }

    let targetLoraId = loraId;
    let targetLora = null;

    if (targetLoraId) {
      targetLora = await prisma.trainedLora.findUnique({ where: { id: targetLoraId } });
      if (!targetLora || targetLora.modelId !== modelId) {
        return res.status(400).json({ success: false, message: "LoRA not found or does not belong to this model" });
      }
      if (targetLora.status === "training") {
        return res.status(400).json({ success: false, message: "LoRA training already in progress" });
      }
      if (targetLora.status === "ready" && targetLora.loraUrl) {
        return res.status(400).json({ success: false, message: "LoRA already trained" });
      }
    }

    const isProMode = targetLora?.trainingMode === "pro";
    const requiredImages = isProMode ? 30 : 15;
    const maxImages = isProMode ? 30 : 15;

    if (images.length < requiredImages) {
      return res.status(400).json({
        success: false,
        message: `${isProMode ? "Pro mode requires exactly" : "Basic mode requires exactly"} ${requiredImages} images. Got ${images.length}.`,
      });
    }
    if (images.length > maxImages) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${maxImages} images allowed. Got ${images.length}.`,
      });
    }

    const galleryImages = images.filter((i) => i.generationId);
    const customImages = images.filter((i) => i.customImageId);

    // Frontend may send composite ids like "uuid-0" (from list item id); DB has plain uuid
    const normalizeGenerationId = (id) => (typeof id === "string" ? id.replace(/-\d+$/, "") : id) || id;
    const generationIds = galleryImages.map((i) => i.generationId);
    const uniqueGenerationIds = [...new Set(generationIds.map(normalizeGenerationId))];
    let generations = [];
    if (uniqueGenerationIds.length > 0) {
      generations = await prisma.generation.findMany({
        where: {
          id: { in: uniqueGenerationIds },
          userId,
          status: "completed",
        },
        select: { id: true, outputUrl: true, modelId: true },
      });

      const foundIds = new Set(generations.map((g) => g.id));
      const missingIds = uniqueGenerationIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        console.log("❌ SECURITY: Some generation IDs not found / not owned by user:", missingIds);
        return res.status(403).json({
          success: false,
          message: "All selected gallery images must belong to your account.",
        });
      }

      // Log any cross-model selections for auditing (not a security issue — user owns all their generations)
      const crossModel = generations.filter((g) => g.modelId && g.modelId !== modelId);
      if (crossModel.length > 0) {
        console.log(`ℹ️ [assign-training-images] ${crossModel.length} generation(s) from other models selected by user ${userId} for training model ${modelId} — allowed`);
      }
    }

    if (customImages.length > 0) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { allowCustomLoraTrainingPhotos: true },
      });
      if (!user?.allowCustomLoraTrainingPhotos) {
        return res.status(403).json({
          success: false,
          message: "Custom training photo uploads are not enabled for your account.",
        });
      }
    }

    const persistedByGenerationId = await Promise.all(
      generations.map(async (g) => [g.id, await persistTrainingImageUrl(g.outputUrl)]),
    );
    const genMap = new Map(persistedByGenerationId);

    const customMap = new Map();
    if (customImages.length > 0) {
      const customIdsToResolve = [];
      for (const img of customImages) {
        const inlineUrl =
          typeof img?.imageUrl === "string"
            ? img.imageUrl.trim()
            : typeof img?.outputUrl === "string"
              ? img.outputUrl.trim()
              : "";

        if (inlineUrl) {
          customMap.set(img.customImageId || inlineUrl, inlineUrl);
          continue;
        }

        if (img.customImageId) {
          customIdsToResolve.push(img.customImageId);
          continue;
        }

        return res.status(400).json({
          success: false,
          message: "Each custom training image must include imageUrl or customImageId.",
        });
      }

      if (customIdsToResolve.length > 0) {
        const found = await prisma.loraTrainingImage.findMany({
          where: { id: { in: customIdsToResolve } },
          select: { id: true, imageUrl: true },
        });
        for (const c of found) {
          customMap.set(c.id, c.imageUrl);
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      if (targetLoraId) {
        await tx.loraTrainingImage.deleteMany({ where: { loraId: targetLoraId } });
      } else {
        await tx.loraTrainingImage.deleteMany({ where: { modelId, loraId: null } });
      }

      const trainingImageData = [];
      for (const img of galleryImages) {
        const realId = normalizeGenerationId(img.generationId);
        trainingImageData.push({
          modelId,
          loraId: targetLoraId || null,
          imageUrl: genMap.get(realId),
          imageType: "general",
          imageIndex: 0,
          generationId: realId,
          status: "completed",
          prompt: null,
        });
      }
      for (const img of customImages) {
        const customUrl = customMap.get(img.customImageId) || img.imageUrl || img.outputUrl || null;
        if (!customUrl) {
          return res.status(400).json({
            success: false,
            message: "Invalid custom training image payload.",
          });
        }
        trainingImageData.push({
          modelId,
          loraId: targetLoraId || null,
          imageUrl: customUrl,
          imageType: "general",
          imageIndex: 0,
          generationId: null,
          status: "completed",
          prompt: null,
        });
      }

      await tx.loraTrainingImage.createMany({ data: trainingImageData });

      if (targetLoraId) {
        await tx.trainedLora.update({
          where: { id: targetLoraId },
          data: { status: "images_ready" },
        });
      } else {
        await tx.savedModel.update({
          where: { id: modelId },
          data: { loraStatus: "images_ready" },
        });
      }
    });

    console.log(`✅ Assigned ${images.length} training images${targetLoraId ? ` for LoRA ${targetLoraId}` : ""} on model ${modelId}`);

    res.json({
      success: true,
      message: "Training images assigned! You can now start LoRA training.",
    });
  } catch (error) {
    console.error("❌ Assign training images error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// LEGACY ENDPOINT: Generate training images
// POST /api/nsfw/generate-training-images
// Body: { modelId, imageType }
// ============================================
export async function generateTrainingImages(req, res) {
  let userId = null;

  try {
    const { modelId, imageType } = req.body;
    userId = req.user.userId;

    if (!["selfie", "half_body", "full_body"].includes(imageType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid image type. Must be 'selfie', 'half_body', or 'full_body'",
      });
    }

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
      include: {
        trainingImages: { where: { imageType } },
      },
    });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to access this model" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW features are only available for AI-generated models. This protects real people's privacy and consent.",
      });
    }
    if (isMinorModel(model)) {
      return res.status(403).json({
        success: false,
        message: "Models under 18 cannot be used for LoRA training.",
      });
    }
    if (!model.loraSessionPaid) {
      return res.status(403).json({
        success: false,
        message: "Training session not initialized. Please pay for the session first.",
        needsInitialization: true,
      });
    }

    console.log(`📸 Generating ${imageType} images (credits already paid via session)`);

    const existingImages = await prisma.loraTrainingImage.findMany({
      where: { modelId, imageType },
    });
    const completedIndexes = existingImages
      .filter((img) => img.status === "completed" && img.imageUrl)
      .map((img) => img.imageIndex);

    console.log(`📸 Already completed indexes for ${imageType}:`, completedIndexes);

    await prisma.savedModel.update({
      where: { id: modelId },
      data: { loraStatus: "generating_images" },
    });

    // Respond immediately — frontend polls /nsfw/training-images/:modelId for progress
    res.json({
      success: true,
      message: `Starting ${imageType} image generation in background...`,
      images: [],
      failed: [],
      skipped: 0,
      totalCompleted: 0,
      pending: true,
    });

    // Generate in background
    (async () => {
      const prompts = buildTrainingPrompts(imageType, { ...(() => { try { return JSON.parse(model.aiGenerationParams || "{}"); } catch(e) { return {}; } })(), ...(model.savedAppearance || {}) });
      const rawIdentityImages = [model.photo1Url, model.photo2Url, model.photo3Url];

    // Force re-upload model photos to fresh R2 URLs so KIE can download them
    // (pub-xxx.r2.dev CDN can be slow/unreachable from KIE's servers)
    let identityImages = rawIdentityImages;
    try {
      identityImages = await Promise.all(
        rawIdentityImages.map((u, i) => ensureKieUrl(u))
      );
      console.log(`📸 Re-mirrored ${identityImages.length} identity images for KIE`);
    } catch (mirrorErr) {
      console.warn(`⚠️ Failed to re-mirror identity images: ${mirrorErr.message} — using originals`);
    }

    const generatedImages = [];
    const failedImages = [];

    for (let i = 0; i < 5; i++) {
      const imageIndex = i + 1;

      if (completedIndexes.includes(imageIndex)) {
        console.log(`⏭️ Skipping ${imageType} image ${imageIndex} (already completed)`);
        continue;
      }

      try {
        console.log(`\n📸 Generating ${imageType} image ${imageIndex}/5...`);

        const trainingImage = await prisma.loraTrainingImage.upsert({
          where: {
            modelId_imageType_imageIndex: {
              modelId,
              imageType,
              imageIndex: imageIndex,
            },
          },
          create: {
            modelId,
            imageType,
            imageIndex: imageIndex,
            status: "generating",
            prompt: prompts[i],
            imageUrl: "",
          },
          update: {
            status: "generating",
            prompt: prompts[i],
            errorMsg: null,
          },
        });

        const result = await requestQueue.enqueue(async () => {
          return await generateImageWithNanoBananaKie(identityImages, prompts[i], {
            resolution: "2k",
            aspectRatio: imageType === "selfie" ? "1:1" : "9:16",
          });
        });

        if (result.success) {
          const persistedUrl = await persistTrainingImageUrl(result.outputUrl);
          await prisma.loraTrainingImage.update({
            where: { id: trainingImage.id },
            data: { status: "completed", imageUrl: persistedUrl },
          });

          generatedImages.push({
            id: trainingImage.id,
            imageType,
            imageIndex: imageIndex,
            imageUrl: persistedUrl,
          });

          console.log(`✅ ${imageType} image ${imageIndex} generated`);
        } else {
          throw new Error(result.error || "Generation failed");
        }
      } catch (error) {
        console.error(`❌ Failed to generate ${imageType} image ${imageIndex}:`, error.message);

        await prisma.loraTrainingImage.updateMany({
          where: { modelId, imageType, imageIndex: imageIndex },
          data: { status: "failed", errorMsg: error.message },
        });

        failedImages.push({ imageType, imageIndex: imageIndex, error: "Generation failed" });
      }
    }

    const skippedCount = completedIndexes.length;
    const newlyGenerated = generatedImages.length;
    const newlyFailed = failedImages.length;

    if (failedImages.length > 0) {
      console.log(`⚠️ ${failedImages.length} ${imageType} images failed to generate`);
    }

    console.log(`📸 ${imageType} summary: ${skippedCount} skipped (already done), ${newlyGenerated} newly generated, ${newlyFailed} failed`);

    const allImagesForType = await prisma.loraTrainingImage.findMany({
      where: { modelId, imageType },
    });
    const completedCount = allImagesForType.filter((img) => img.status === "completed" && img.imageUrl).length;

    const allTrainingImages = await prisma.loraTrainingImage.findMany({
      where: { modelId },
    });
    const totalCompleted = allTrainingImages.filter((img) => img.status === "completed" && img.imageUrl).length;
    const totalFailed = allTrainingImages.filter((img) => img.status === "failed").length;

    let newStatus = "generating_images";
    if (totalCompleted === 15) {
      newStatus = "images_ready";
    } else if (totalCompleted + totalFailed === 15) {
      newStatus = "partial_failure";
    } else if (totalCompleted > 0 || totalFailed > 0) {
      newStatus = "partial_failure";
    }

    await prisma.savedModel.update({
      where: { id: modelId },
      data: { loraStatus: newStatus },
    });

    console.log(`📊 Model status updated to: ${newStatus} (${totalCompleted}/15 completed, ${totalFailed} failed)`);
    })().catch((bgErr) => console.error("❌ Background training image error:", bgErr.message));

  } catch (error) {
    console.error("❌ Generate training images error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
}

// ============================================
// LEGACY ENDPOINT: Start training session
// POST /api/nsfw/start-training-session
// Body: { modelId }
// ============================================
export async function startTrainingSession(req, res) {
  let creditsDeducted = 0;
  let userId = null;
  let modelId = null;

  try {
    modelId = req.body.modelId;
    userId = req.user.userId;

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to access this model" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW features are only available for AI-generated models. This protects real people's privacy and consent.",
      });
    }

    const creditsNeeded = CREDITS_FOR_TRAINING_SESSION;

    const transactionResult = await prisma.$transaction(async (tx) => {
      const lockedModel = [await tx.savedModel.findUnique({
        where: { id: modelId },
        select: { loraStatus: true, nsfwUnlocked: true },
      })];

      if (lockedModel[0]?.loraStatus === "training" || lockedModel[0]?.loraStatus === "generating_images") {
        return { error: "Training session already in progress", status: 400 };
      }
      if (lockedModel[0]?.nsfwUnlocked) {
        return { error: "LoRA is already trained for this model", status: 400 };
      }

      await deductCreditsTx(tx, userId, creditsNeeded);
      await tx.savedModel.update({
        where: { id: modelId },
        data: { loraStatus: "generating_images" },
      });

      return { success: true };
    });

    if (transactionResult.error) {
      return res.status(transactionResult.status).json({
        success: false,
        message: transactionResult.error,
      });
    }

    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits for full training session (atomic)`);

    const identityImages = [model.photo1Url, model.photo2Url, model.photo3Url];

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

    res.json({
      success: true,
      message: "Training session started! Generating 15 images...",
      creditsUsed: creditsNeeded,
      creditsRemaining: getTotalCredits(updatedUser),
    });

    // Background generation
    const MAX_RETRIES = 2;
    const imageTypes = ["selfie", "half_body", "full_body"];

    async function generateSingleImage(imageType, index, prompt, retryCount = 0) {
      try {
        console.log(`\n📸 Generating ${imageType} image ${index}/5${retryCount > 0 ? ` (retry ${retryCount})` : ""}...`);

        const trainingImage = await prisma.loraTrainingImage.upsert({
          where: {
            modelId_imageType_imageIndex: {
              modelId,
              imageType,
              imageIndex: index,
            },
          },
          create: {
            modelId,
            imageType,
            imageIndex: index,
            status: "generating",
            prompt: prompt,
            imageUrl: "",
          },
          update: {
            status: "generating",
            prompt: prompt,
            errorMsg: null,
          },
        });

        const result = await requestQueue.enqueue(async () => {
          return await generateImageWithNanoBananaKie(identityImages, prompt, {
            resolution: "2k",
            aspectRatio: imageType === "selfie" ? "1:1" : "9:16",
          });
        });

        if (result.success) {
          const persistedUrl = await persistTrainingImageUrl(result.outputUrl);
          await prisma.loraTrainingImage.update({
            where: { id: trainingImage.id },
            data: { status: "completed", imageUrl: persistedUrl },
          });
          console.log(`✅ ${imageType} image ${index} generated`);
          return true;
        } else {
          throw new Error(result.error || "Generation failed");
        }
      } catch (error) {
        console.error(`❌ Failed ${imageType} image ${index}:`, error.message);

        await prisma.loraTrainingImage.updateMany({
          where: { modelId, imageType, imageIndex: index },
          data: { status: "failed", errorMsg: error.message },
        });
        return false;
      }
    }

    // PASS 1: Generate all 15 images
    console.log(`\n🚀 PASS 1: Generating all 15 training images...`);
    for (const imageType of imageTypes) {
      const prompts = buildTrainingPrompts(imageType, { ...(() => { try { return JSON.parse(model.aiGenerationParams || "{}"); } catch(e) { return {}; } })(), ...(model.savedAppearance || {}) });
      for (let i = 0; i < 5; i++) {
        await generateSingleImage(imageType, i + 1, prompts[i], 0);
      }
    }

    // PASS 2 & 3: Retry failed images
    for (let retryPass = 1; retryPass <= MAX_RETRIES; retryPass++) {
      const failedImgs = await prisma.loraTrainingImage.findMany({
        where: { modelId, status: "failed" },
      });

      if (failedImgs.length === 0) {
        console.log(`\n✅ All images completed - no retries needed!`);
        break;
      }

      console.log(`\n🔄 RETRY PASS ${retryPass}: Retrying ${failedImgs.length} failed images...`);

      for (const failedImage of failedImgs) {
        const prompts = buildTrainingPrompts(failedImage.imageType, model.aiGenerationParams);
        const prompt = prompts[failedImage.imageIndex - 1];
        await generateSingleImage(failedImage.imageType, failedImage.imageIndex, prompt, retryPass);
      }
    }

    // Check final status
    const completedCount = await prisma.loraTrainingImage.count({
      where: { modelId, status: "completed" },
    });
    const failedCount = await prisma.loraTrainingImage.count({
      where: { modelId, status: "failed" },
    });

    if (completedCount >= 15) {
      await prisma.savedModel.update({
        where: { id: modelId },
        data: { loraStatus: "images_ready" },
      });
      console.log(`\n✅ All 15 training images generated successfully!`);
    } else {
      await prisma.savedModel.update({
        where: { id: modelId },
        data: { loraStatus: "partial_failure" },
      });
      console.log(`\n⚠️ Training session completed with ${completedCount}/15 images. ${failedCount} failed after retries.`);
    }
  } catch (error) {
    console.error("❌ Start training session error:", error);

    if (creditsDeducted > 0 && userId) {
      await refundCredits(userId, creditsDeducted);
      console.log(`💰 Refunded ${creditsDeducted} credits due to error`);

      if (modelId) {
        await prisma.savedModel.update({
          where: { id: modelId },
          data: { loraStatus: null },
        }).catch(() => {});
      }
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
}

// ============================================
// LEGACY ENDPOINT: Regenerate a single training image
// POST /api/nsfw/regenerate-training-image
// Body: { trainingImageId }
// ============================================
export async function regenerateTrainingImage(req, res) {
  let userId = null;
  let creditsDeducted = 0;

  try {
    const { trainingImageId } = req.body;
    userId = req.user.userId;

    const trainingImage = await prisma.loraTrainingImage.findUnique({
      where: { id: trainingImageId },
      include: { model: true },
    });

    if (!trainingImage) {
      return res.status(404).json({ success: false, message: "Training image not found" });
    }
    if (trainingImage.model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const isFailed = trainingImage.status === "failed";

    if (!isFailed) {
      const creditsNeeded = CREDITS_PER_TRAINING_IMAGE;
      const user = await checkAndExpireCredits(userId);
      const totalCredits = getTotalCredits(user);

      if (totalCredits < creditsNeeded) {
        return res.status(403).json({
          success: false,
          message: `Need ${creditsNeeded} credits. You have ${totalCredits} credits.`,
        });
      }

      await deductCredits(userId, creditsNeeded);
      creditsDeducted = creditsNeeded;
      console.log(`💰 Charged ${creditsNeeded} credits for re-rolling completed image`);
    } else {
      console.log(`🆓 Free regeneration for failed image`);
    }

    await prisma.loraTrainingImage.update({
      where: { id: trainingImageId },
      data: { status: "generating" },
    });

    const prompts = buildTrainingPrompts(trainingImage.imageType, { ...(() => { try { return JSON.parse(trainingImage.model.aiGenerationParams || "{}"); } catch(e) { return {}; } })(), ...(trainingImage.model.savedAppearance || {}) });
    const prompt = prompts[trainingImage.imageIndex - 1] + `, variation ${Date.now()}`;

    const rawIdentityImages = [
      trainingImage.model.photo1Url,
      trainingImage.model.photo2Url,
      trainingImage.model.photo3Url,
    ];

    // Force re-upload model photos to fresh R2 URLs for KIE
    const identityImages = await Promise.all(
      rawIdentityImages.map(u => ensureKieUrl(u))
    );

    const result = await requestQueue.enqueue(async () => {
      return await generateImageWithNanoBananaKie(identityImages, prompt, {
        resolution: "2k",
        aspectRatio: trainingImage.imageType === "selfie" ? "1:1" : "9:16",
      });
    });

    if (result.success) {
      const persistedUrl = await persistTrainingImageUrl(result.outputUrl);
      await prisma.loraTrainingImage.update({
        where: { id: trainingImageId },
        data: { status: "completed", imageUrl: persistedUrl, prompt },
      });

      const completedCount = await prisma.loraTrainingImage.count({
        where: { modelId: trainingImage.modelId, status: "completed" },
      });

      const currentStatus = trainingImage.model.loraStatus;
      if (
        completedCount >= 15 &&
        !trainingImage.model.nsfwUnlocked &&
        (currentStatus === "partial_failure" || currentStatus === "generating_images")
      ) {
        await prisma.savedModel.update({
          where: { id: trainingImage.modelId },
          data: { loraStatus: "images_ready" },
        });
        console.log(`✅ All 15 images now completed - updated status to images_ready`);
      }

      const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

      res.json({
        success: true,
        message: isFailed ? "Image regenerated successfully (free retry)" : "Image regenerated successfully",
        image: { id: trainingImageId, imageUrl: persistedUrl },
        creditsUsed: creditsDeducted,
        creditsRemaining: getTotalCredits(updatedUser),
        allImagesCompleted: completedCount >= 15,
      });
    } else {
      if (creditsDeducted > 0) {
        await refundCredits(userId, creditsDeducted);
        console.log(`💸 Refunded ${creditsDeducted} credits due to failed regeneration`);
      }

      await prisma.loraTrainingImage.update({
        where: { id: trainingImageId },
        data: { status: "failed", errorMsg: result.error },
      });

      res.status(500).json({ success: false, message: "Regeneration failed" });
    }
  } catch (error) {
    console.error("❌ Regenerate training image error:", error);

    if (creditsDeducted > 0) {
      await refundCredits(userId, creditsDeducted);
      console.log(`💸 Refunded ${creditsDeducted} credits due to error`);
    }

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

// ============================================
// MODIFIED ENDPOINT: Get training images
// GET /api/nsfw/training-images/:modelId
// Query: ?loraId=xxx (optional)
// ============================================
export async function getTrainingImages(req, res) {
  try {
    const { modelId } = req.params;
    const loraId = req.query.loraId;
    const userId = req.user.userId;

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model || model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const whereClause = { modelId };
    if (loraId) {
      whereClause.loraId = loraId;
    }

    const trainingImages = await prisma.loraTrainingImage.findMany({
      where: whereClause,
      orderBy: { createdAt: "asc" },
    });

    // Build full gallery pool from completed image generations linked to this model.
    // Match by: direct modelId, or inputImageUrl containing any of the model's asset URLs.
    // We intentionally skip the relation-join name filter (fragile) and rely on
    // direct modelId + asset URL fallbacks which are more reliable.
    const modelAssetUrls = [
      model.photo1Url,
      model.photo2Url,
      model.photo3Url,
      model.thumbnail,
    ].filter((v) => typeof v === "string" && v.trim().length > 0 && !v.includes("processing"));

    // Build OR conditions: direct modelId match first, then asset URL fallbacks
    const orConditions = [
      { modelId },
    ];

    // Add inputImageUrl fallbacks for each asset URL
    for (const url of modelAssetUrls) {
      orConditions.push({ inputImageUrl: { contains: url } });
    }

    // Add prompt-contains-model-name fallback for legacy records
    if (model.name && model.name.trim().length > 1) {
      orConditions.push({ prompt: { contains: model.name.trim(), mode: "insensitive" } });
    }

    // All image generation types (exclude video). Include advanced-image so Ultra-realism outputs appear in gallery.
    const IMAGE_GENERATION_TYPES = [
      "nsfw",
      "image",
      "image-identity",
      "prompt-image",
      "face-swap",
      "face-swap-image",
      "advanced-image",
    ];

    const linkedGenerations = await prisma.generation.findMany({
      where: {
        userId,
        status: "completed",
        outputUrl: { not: null },
        type: { in: IMAGE_GENERATION_TYPES },
        OR: orConditions,
      },
      orderBy: { createdAt: "desc" },
      take: 50000,
      select: {
        id: true,
        modelId: true,
        type: true,
        outputUrl: true,
        status: true,
        createdAt: true,
      },
    });

    console.log(`[getTrainingImages] modelId=${modelId} name="${model.name}" assetUrls=${modelAssetUrls.length} → linkedGenerations=${linkedGenerations.length}`);

    const allReady =
      trainingImages.length >= 15 &&
      trainingImages.every((i) => i.status === "completed" && i.imageUrl);

    res.json({
      success: true,
      trainingImages,
      linkedGenerations,
      totalCount: trainingImages.length,
      allReady,
      loraStatus: model.loraStatus,
    });
  } catch (error) {
    console.error("❌ Get training images error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

// ============================================
// MODIFIED ENDPOINT: Train LoRA
// POST /api/nsfw/train-lora
// Body: { modelId, loraId }
// ============================================
export async function trainLora(req, res) {
  let creditsDeducted = 0;
  let userId = null;
  let modelId = null;
  let targetLoraId = null;

  try {
    const { modelId: bodyModelId, loraId } = req.body;
    modelId = bodyModelId;
    userId = req.user.userId;

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW training is only available for AI-generated models.",
      });
    }

    targetLoraId = loraId;
    let targetLora = null;

    if (targetLoraId) {
      targetLora = await prisma.trainedLora.findUnique({
        where: { id: targetLoraId },
        include: { trainingImages: { where: { status: "completed" } } },
      });
      if (!targetLora || targetLora.modelId !== modelId) {
        return res.status(400).json({ success: false, message: "LoRA not found or does not belong to this model" });
      }
      if (targetLora.status === "training") {
        return res.status(400).json({ success: false, message: "LoRA training is already in progress" });
      }
      if (targetLora.status === "ready" && targetLora.loraUrl) {
        return res.status(400).json({ success: false, message: "LoRA is already trained" });
      }

      const isProMode = targetLora.trainingMode === "pro";
      const requiredImages = isProMode ? 30 : 15;
      if (targetLora.trainingImages.length < requiredImages) {
        return res.status(400).json({
          success: false,
          message: `Need at least ${requiredImages} training images. Currently have ${targetLora.trainingImages.length} completed.`,
        });
      }
    } else {
      // Legacy path: get images from model directly
      const trainingImages = await prisma.loraTrainingImage.findMany({
        where: { modelId, status: "completed", loraId: null },
      });

      if (trainingImages.length < 15) {
        return res.status(400).json({
          success: false,
          message: `Need at least 15 training images. Currently have ${trainingImages.length} completed.`,
        });
      }

      if (model.loraStatus === "training") {
        return res.status(400).json({ success: false, message: "LoRA training is already in progress" });
      }
      if (model.loraStatus === "ready" && model.loraUrl) {
        return res.status(400).json({ success: false, message: "LoRA is already trained for this model" });
      }
    }

    const isProTraining = targetLora?.trainingMode === "pro";
    const creditsNeeded = isProTraining ? CREDITS_FOR_PRO_LORA_TRAINING : CREDITS_FOR_LORA_TRAINING;
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for LoRA training. You have ${totalCredits} credits.`,
        creditsNeeded,
        creditsAvailable: totalCredits,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits for LoRA training`);

    const triggerWord = generateTriggerWord(model.name);
    console.log(`🔑 Generated trigger word: ${triggerWord}`);

    // Lock immediately before long-running preprocessing (captioning + ZIP creation)
    // so duplicate submissions cannot start parallel trainings for the same LoRA.
    if (targetLoraId) {
      await prisma.trainedLora.update({
        where: { id: targetLoraId },
        data: {
          status: "training",
          triggerWord,
          falRequestId: null,
          error: null,
        },
      });
      await syncLegacyLoraFields(modelId, targetLoraId);
    } else {
      await prisma.savedModel.update({
        where: { id: modelId },
        data: {
          loraStatus: "training",
          loraTriggerWord: triggerWord,
          loraFalRequestId: null,
          loraError: null,
        },
      });
    }

    let imageUrls;
    if (targetLoraId && targetLora) {
      imageUrls = targetLora.trainingImages.map((i) => i.imageUrl);
    } else {
      const imgs = await prisma.loraTrainingImage.findMany({
        where: { modelId, status: "completed", loraId: null },
      });
      imageUrls = imgs.map((i) => i.imageUrl);
    }

    let aiParams = {};
    try {
      aiParams =
        typeof model.aiGenerationParams === "string"
          ? JSON.parse(model.aiGenerationParams)
          : model.aiGenerationParams || {};
    } catch {
      aiParams = {};
    }
    const captionSubjectClass = normalizeCaptionSubjectClass(aiParams.gender);

    const trainingResult = await startLoraTraining(imageUrls, triggerWord, {
      steps: isProTraining ? 9000 : 4500,
      loraRank: isProTraining ? 32 : 16,
      captionSubjectClass,
    });

    if (!trainingResult.success) {
      await refundCredits(userId, creditsNeeded);
      creditsDeducted = 0;

      if (targetLoraId) {
        await prisma.trainedLora.update({
          where: { id: targetLoraId },
          data: { status: "failed", error: trainingResult.error },
        });
      } else {
        await prisma.savedModel.update({
          where: { id: modelId },
          data: { loraStatus: "failed", loraError: trainingResult.error },
        });
      }

      return res.status(500).json({
        success: false,
        message: trainingResult.error || "Failed to start LoRA training",
      });
    }

    if (targetLoraId) {
      await prisma.trainedLora.update({
        where: { id: targetLoraId },
        data: {
          triggerWord,
          falRequestId: trainingResult.requestId,
          error: null,
        },
      });
      await syncLegacyLoraFields(modelId, targetLoraId);
    } else {
      await prisma.savedModel.update({
        where: { id: modelId },
        data: {
          loraStatus: "training",
          loraTriggerWord: triggerWord,
          loraFalRequestId: trainingResult.requestId,
          loraError: null,
        },
      });
    }

    res.json({
      success: true,
      message: "LoRA training started! It can take a while and has no hard timeout.",
      requestId: trainingResult.requestId,
      triggerWord,
      creditsUsed: creditsNeeded,
    });
  } catch (error) {
    console.error("❌ Train LoRA error:", error);

    // Ensure the UI doesn't stay in an ambiguous "draft" state after a submit failure.
    try {
      if (targetLoraId) {
        await prisma.trainedLora.update({
          where: { id: targetLoraId },
          data: {
            status: "failed",
            error: error.message || "Failed to start LoRA training",
          },
        });
      } else if (modelId) {
        await prisma.savedModel.update({
          where: { id: modelId },
          data: {
            loraStatus: "failed",
            loraError: error.message || "Failed to start LoRA training",
          },
        });
      }
    } catch (statusErr) {
      console.error("⚠️ Failed to persist LoRA failure status:", statusErr.message);
    }

    if (creditsDeducted > 0 && userId) {
      try {
        await refundCredits(userId, creditsDeducted);
        console.log(`💰 Refunded ${creditsDeducted} credits for failed LoRA training`);
      } catch (refundErr) {
        console.error("❌ Failed to refund credits:", refundErr);
      }
    }

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

// ============================================
// MODIFIED ENDPOINT: Get LoRA training status
// GET /api/nsfw/training-status/:modelId
// Query: ?loraId=xxx (optional)
// ============================================
export async function getLoraTrainingStatus(req, res) {
  try {
    const { modelId } = req.params;
    const loraIdParam = req.query.loraId;
    const userId = req.user.userId;

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model || model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const targetLoraId = loraIdParam || model.activeLoraId;

    if (targetLoraId) {
      const lora = await prisma.trainedLora.findUnique({ where: { id: targetLoraId } });

      if (!lora || lora.modelId !== modelId) {
        return res.json({
          success: true,
          status: "none",
          nsfwUnlocked: model.nsfwUnlocked,
        });
      }

      if (lora.status !== "training" || !lora.falRequestId) {
        return res.json({
          success: true,
          status: lora.status || "none",
          loraUrl: lora.loraUrl,
          triggerWord: lora.triggerWord,
          nsfwUnlocked: model.nsfwUnlocked,
          loraId: lora.id,
        });
      }

      try {
        const falStatus = await checkTrainingStatus(lora.falRequestId);

        if (falStatus.status === "COMPLETED") {
          const result = await getTrainingResult(lora.falRequestId);
          const falUrl = result.loraUrl;
          if (!falUrl) {
            await prisma.trainedLora.update({
              where: { id: targetLoraId },
              data: { status: "failed", error: "Training completed but no LoRA URL returned" },
            });
            return res.json({ success: true, status: "failed", error: "No LoRA URL", loraId: targetLoraId });
          }
          const ARCHIVE_DEADLINE_MS = 120_000;
          let permanentUrl = falUrl;
          try {
            permanentUrl = await Promise.race([
              archiveLoraToR2(falUrl, model.name, 90_000),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Archive timeout")), ARCHIVE_DEADLINE_MS)),
            ]);
          } catch (archiveErr) {
            console.warn("⚠️ LoRA archive skipped (timeout or error) — using fal URL:", archiveErr?.message);
          }

          await prisma.trainedLora.update({
            where: { id: targetLoraId },
            data: {
              status: "ready",
              loraUrl: permanentUrl,
              trainedAt: new Date(),
              error: null,
            },
          });

          const isFirstReady = !(await prisma.trainedLora.findFirst({
            where: { modelId, status: "ready", id: { not: targetLoraId } },
          }));

          const updateData = { nsfwUnlocked: true };
          if (isFirstReady || !model.activeLoraId) {
            updateData.activeLoraId = targetLoraId;
          }
          await prisma.savedModel.update({
            where: { id: modelId },
            data: updateData,
          });

          await syncLegacyLoraFields(modelId, updateData.activeLoraId || model.activeLoraId);

          let firstLoraBonus = 0;
          try {
            firstLoraBonus = await awardFirstLoraTrainingBonus({
              userId,
              modelId,
              targetLoraId,
            });
          } catch (bonusErr) {
            console.error("⚠️ First LoRA bonus check failed (non-critical):", bonusErr.message);
          }

          cleanupTrainingDataset(targetLoraId, modelId)
            .catch((err) => console.error("🧹 Training dataset cleanup failed (non-critical):", err.message));

          return res.json({
            success: true,
            status: "ready",
            loraUrl: permanentUrl,
            triggerWord: lora.triggerWord,
            nsfwUnlocked: true,
            loraId: targetLoraId,
            firstLoraBonus,
          });
        }

        if (falStatus.status === "FAILED") {
          await prisma.trainedLora.update({
            where: { id: targetLoraId },
            data: { status: "failed", error: "Training failed on fal.ai" },
          });

          if (model.activeLoraId === targetLoraId) {
            await syncLegacyLoraFields(modelId, targetLoraId);
          }

          try {
            const loraRecord = await prisma.trainedLora.findUnique({ where: { id: targetLoraId }, select: { trainingMode: true } });
            const refundAmount = loraRecord?.trainingMode === "pro"
              ? CREDITS_FOR_PRO_LORA_TRAINING
              : CREDITS_FOR_LORA_TRAINING;
            await refundCredits(userId, refundAmount);
            console.log(`💰 Refunded ${refundAmount} credits to user ${userId} for failed LoRA training ${targetLoraId}`);
          } catch (refundErr) {
            console.error(`⚠️ Failed to refund credits for failed LoRA training ${targetLoraId}:`, refundErr.message);
          }

          return res.json({
            success: true,
            status: "failed",
            error: "Training failed on fal.ai",
            loraId: targetLoraId,
          });
        }

        return res.json({
          success: true,
          status: "training",
          falStatus: falStatus.status,
          loraId: targetLoraId,
        });
      } catch (falError) {
        console.error("fal.ai status check error:", falError);
        return res.json({
          success: true,
          status: "training",
          message: "Checking status...",
          loraId: targetLoraId,
        });
      }
    }

    // Legacy fallback: check SavedModel fields
    if (model.loraStatus !== "training" || !model.loraFalRequestId) {
      return res.json({
        success: true,
        status: model.loraStatus || "none",
        loraUrl: model.loraUrl,
        triggerWord: model.loraTriggerWord,
        nsfwUnlocked: model.nsfwUnlocked,
      });
    }

    try {
      const falStatus = await checkTrainingStatus(model.loraFalRequestId);

      if (falStatus.status === "COMPLETED") {
        const result = await getTrainingResult(model.loraFalRequestId);
        const falUrl = result?.loraUrl;
        let permanentUrl = falUrl;
        if (falUrl) {
          try {
            permanentUrl = await Promise.race([
              archiveLoraToR2(falUrl, model.name, 90_000),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Archive timeout")), 120_000)),
            ]);
          } catch (archiveErr) {
            console.warn("⚠️ LoRA archive skipped (legacy path):", archiveErr?.message);
          }
        }

        await prisma.savedModel.update({
          where: { id: modelId },
          data: {
            loraStatus: "ready",
            loraUrl: permanentUrl || falUrl,
            loraTrainedAt: new Date(),
            nsfwUnlocked: true,
          },
        });

        let firstLoraBonus = 0;
        try {
          firstLoraBonus = await awardFirstLoraTrainingBonus({ userId, modelId });
        } catch (bonusErr) {
          console.error("⚠️ First LoRA bonus check failed (legacy path, non-critical):", bonusErr.message);
        }

        cleanupTrainingDataset(null, modelId)
          .catch((err) => console.error("🧹 Training dataset cleanup failed (non-critical):", err.message));

        return res.json({
          success: true,
          status: "ready",
          loraUrl: permanentUrl,
          triggerWord: model.loraTriggerWord,
          nsfwUnlocked: true,
          firstLoraBonus,
        });
      }

      if (falStatus.status === "FAILED") {
        await prisma.savedModel.update({
          where: { id: modelId },
          data: { loraStatus: "failed", loraError: "Training failed on fal.ai" },
        });

        return res.json({
          success: true,
          status: "failed",
          error: "Training failed on fal.ai",
        });
      }

      return res.json({
        success: true,
        status: "training",
        falStatus: falStatus.status,
      });
    } catch (falError) {
      console.error("fal.ai status check error:", falError);
      return res.json({
        success: true,
        status: "training",
        message: "Checking status...",
      });
    }
  } catch (error) {
    console.error("❌ Get training status error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * Admin-only: optional base KSampler (Comfy node 276) steps/cfg for NSFW RunPod gen.
 * Non-admins cannot use this — body fields are ignored unless role === admin.
 */
function getAdminNsfwSamplerOptions(req, options) {
  if (req.user?.role !== "admin") {
    return { adminBaseSamplerSteps: null, adminBaseSamplerCfg: null };
  }
  const o = options?.adminNsfwOverrides;
  if (!o || typeof o !== "object") {
    return { adminBaseSamplerSteps: null, adminBaseSamplerCfg: null };
  }
  let adminBaseSamplerSteps = null;
  let adminBaseSamplerCfg = null;
  if (o.steps != null && String(o.steps).trim() !== "") {
    const s = parseInt(String(o.steps), 10);
    if (Number.isFinite(s)) adminBaseSamplerSteps = Math.min(150, Math.max(1, s));
  }
  if (o.cfg != null && String(o.cfg).trim() !== "") {
    const c = Number(o.cfg);
    if (Number.isFinite(c)) adminBaseSamplerCfg = Math.min(8, Math.max(1, c));
  }
  return { adminBaseSamplerSteps, adminBaseSamplerCfg };
}

// ============================================
// MODIFIED ENDPOINT: Generate NSFW image
// POST /api/nsfw/generate
// Body: { modelId, prompt, attributes?, options?, skipFaceSwap?, faceSwapImageUrl? }
// options.adminNsfwOverrides?: { steps?: number, cfg?: number } — admin only
// ============================================
export async function generateNsfwImage(req, res) {
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;
  const generationIds = [];
  let creditsAssigned = 0;

  try {
    const {
      modelId,
      prompt,
      attributes = "",
      options = {},
      skipFaceSwap = false,
      faceSwapImageUrl = null,
      sceneDescription = "",
    } = req.body;
    userId = req.user.userId;

    const requestedQuantity = parseInt(req.body.quantity) || 1;
    const imageQuantity = requestedQuantity === 2 ? 2 : 1;

    const attributesDetail = req.body.attributesDetail || {};
    const detailAttributes = buildAttributeList(attributesDetail).join(", ");
    let attributesString = attributes || "";
    if (!attributesString && detailAttributes) {
      attributesString = detailAttributes;
    }

    if (!modelId || !prompt) {
      return res.status(400).json({
        success: false,
        message: "Model ID and prompt are required",
      });
    }

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW generation is only available for AI-generated models.",
      });
    }
    if (isMinorModel(model)) {
      return res.status(403).json({
        success: false,
        message: "Models under 18 cannot use NSFW features.",
      });
    }
    if (!model.nsfwUnlocked) {
      return res.status(403).json({
        success: false,
        message: "Please train a LoRA first to unlock NSFW generation.",
      });
    }

    let loraUrl = model.loraUrl;
    let loraTriggerWord = model.loraTriggerWord;
    let activeFaceReferenceUrl = model.faceReferenceUrl;
    let activeLoraName = model.name;

    if (model.activeLoraId) {
      const activeLora = await prisma.trainedLora.findUnique({
        where: { id: model.activeLoraId },
      });
      if (activeLora && activeLora.status === "ready") {
        loraUrl = activeLora.loraUrl;
        loraTriggerWord = activeLora.triggerWord;
        activeFaceReferenceUrl = activeLora.faceReferenceUrl || activeFaceReferenceUrl;
        activeLoraName = activeLora.name || model.name;
      }
    }

    if (!loraUrl || !loraTriggerWord) {
      return res.status(400).json({
        success: false,
        message: "LoRA not properly configured for this model.",
      });
    }

    let faceReferenceUrl = null;
    if (!skipFaceSwap) {
      if (faceSwapImageUrl) {
        const validGalleryImage = await prisma.generation.findFirst({
          where: {
            userId: userId,
            modelId: modelId,
            outputUrl: faceSwapImageUrl,
            status: "completed",
            type: { in: ["prompt-image", "image", "face-swap-image", "nsfw"] },
          },
        });

        if (!validGalleryImage) {
          console.log("❌ SECURITY: Face swap image not from user's model gallery");
          return res.status(403).json({
            success: false,
            message: "Face swap image must be from your gallery (generated for this model)",
          });
        }

        console.log("✅ SECURITY: Face swap image validated - from user's gallery for model", modelId);
        faceReferenceUrl = faceSwapImageUrl;
      } else {
        faceReferenceUrl = activeFaceReferenceUrl || null;
      }
    }

    if (skipFaceSwap) {
      console.log("⏭️ Face swap skipped by user request");
    } else if (faceSwapImageUrl) {
      console.log("🔄 Using custom face swap image from gallery");
    }

    const faceSwapExtra = skipFaceSwap ? 0 : 10;
    const baseCredits = imageQuantity === 2 ? CREDITS_PER_NSFW_DOUBLE : CREDITS_PER_NSFW_IMAGE;
    const creditsNeeded = baseCredits + (imageQuantity * faceSwapExtra);
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for ${imageQuantity} image(s)${skipFaceSwap ? "" : " with face swap"}. You have ${totalCredits} credits.`,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits for ${imageQuantity} NSFW image(s) (base: ${baseCredits}, face swap: ${!skipFaceSwap})`);

    const userOverrideStrength = options.loraStrength || null;
    const adminSamplerOpts = getAdminNsfwSamplerOptions(req, options);
    const resolutionPreset =
      options?.resolution ||
      req.body.resolution ||
      (req.body.width && req.body.height ? `${req.body.width}x${req.body.height}` : undefined);
    const resSpec = resolveNsfwResolution(resolutionPreset);
    const postProcessing = {
      blur: {
        enabled: options?.postProcessing?.blur?.enabled !== false,
        strength: Number(options?.postProcessing?.blur?.strength ?? 0.3),
      },
      grain: {
        enabled: options?.postProcessing?.grain?.enabled !== false,
        strength: Number(options?.postProcessing?.grain?.strength ?? 0.06),
      },
    };
    let firstGeneration = null;

    const perImageCredits = imageQuantity === 2 
      ? [30 + faceSwapExtra, 20 + faceSwapExtra] 
      : [CREDITS_PER_NSFW_IMAGE + faceSwapExtra];

    for (let i = 0; i < imageQuantity; i++) {
      const thisCost = perImageCredits[i];
      creditsAssigned += thisCost;

      const generation = await prisma.generation.create({
        data: {
          userId,
          modelId,
          type: "nsfw",
          prompt: prompt.trim(),
          status: "processing",
          creditsCost: thisCost,
          replicateModel: "comfyui-nsfw",
          isNsfw: true,
        },
      });
      generationIds.push(generation.id);
      if (i === 0) firstGeneration = generation;

      const submission = await submitNsfwGeneration({
        loraUrl,
        triggerWord: loraTriggerWord,
        userPrompt: prompt,
        attributes: attributesString,
        sceneDescription: sceneDescription || prompt,
        chipSelections: attributesDetail,
        options: {
          quickFlow: options.quickFlow === true,
          loraStrength: userOverrideStrength,
          postProcessing,
          resolution: resSpec.presetId,
          ...adminSamplerOpts,
        },
      });

      if (!submission.success) {
        await refundGeneration(generation.id);
        await prisma.generation.update({
          where: { id: generation.id },
          data: { status: "failed", errorMessage: getErrorMessageForDb(submission.error) },
        });
        const unassignedCredits = creditsNeeded - creditsAssigned;
        if (unassignedCredits > 0) {
          await refundCredits(userId, unassignedCredits);
        }
        creditsDeducted = 0;
        return res.status(400).json({
          success: false,
          message: submission.error || "Failed to start generation",
        });
      }

      const rp = submission.resolvedParams || {};
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          inputImageUrl: JSON.stringify({
            comfyuiPromptId: submission.requestId,
            loraUrl,
            triggerWord: loraTriggerWord,
            loraName: activeLoraName || "Unknown",
            faceReferenceUrl: faceReferenceUrl || null,
            girlLoraStrength: rp.girlLoraStrength ?? 0.70,
            activePose: rp.activePose || null,
            activePoseStrength: rp.activePoseStrength ?? 0,
            runningMakeup: rp.runningMakeup ?? false,
            runningMakeupStrength: rp.runningMakeupStrength ?? 0,
            cumEffect: rp.cumEffect ?? false,
            cumStrength: rp.cumStrength ?? 0,
            seed: rp.seed ?? null,
            steps: rp.steps ?? 50,
            cfg: rp.cfg ?? 3,
            width: rp.width ?? resSpec.width,
            height: rp.height ?? resSpec.height,
            resolutionPreset: rp.resolutionPreset ?? resSpec.presetId,
            sampler: rp.sampler ?? "dpmpp_2m",
            scheduler: rp.scheduler ?? "beta",
            builtPrompt: rp.prompt || null,
            blurEnabled: rp?.postProcessing?.blur?.enabled ?? true,
            blurStrength: rp?.postProcessing?.blur?.strength ?? 0.3,
            grainEnabled: rp?.postProcessing?.grain?.enabled ?? true,
            grainStrength: rp?.postProcessing?.grain?.strength ?? 0.06,
          }),
        },
      });

      processNsfwGenerationInBackground(
        generation.id,
        submission.requestId,
        userId,
        thisCost,
        faceReferenceUrl,
      ).catch((error) => {
        console.error("❌ Background NSFW processing error:", error);
      });
    }

    generationId = generationIds[0];
    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

    res.json({
      success: true,
      message: imageQuantity === 2 
        ? "2 NSFW images generating! Check Live Preview."
        : "NSFW generation started! Check Live Preview.",
      generation: {
        id: firstGeneration.id,
        type: "nsfw",
        status: "processing",
        prompt: prompt.trim(),
        createdAt: firstGeneration.createdAt,
      },
      generations: generationIds.map(id => ({ id, status: "processing" })),
      creditsUsed: creditsNeeded,
      creditsRemaining: getTotalCredits(updatedUser),
      imageQuantity,
    });
  } catch (error) {
    console.error("❌ Generate NSFW error:", error);

    if (creditsDeducted > 0 && userId) {
      for (const gId of generationIds) {
        try { await refundGeneration(gId); } catch (e) { console.error("Refund error:", e.message); }
      }
      const unassignedCredits = creditsDeducted - creditsAssigned;
      if (unassignedCredits > 0) {
        await refundCredits(userId, unassignedCredits);
      }
    }

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}

// ============================================
// POST /api/nsfw/nudes-pack — batch 15 cr/image (looks + trigger injected server-side)
// Body: { modelId, poseIds: string[], attributes?, attributesDetail?, sceneDescription?, skipFaceSwap?, faceSwapImageUrl?, options?, resolution? }
// ============================================
export async function generateNudesPack(req, res) {
  let creditsDeducted = 0;
  const userId = req.user?.userId;
  const generationIds = [];
  const queuedGenerationIds = [];
  const failures = [];

  try {
    const {
      modelId,
      poseIds,
      skipFaceSwap = false,
      faceSwapImageUrl = null,
      sceneDescription: packSceneNote = "",
      options = {},
    } = req.body;

    const attributesDetail = req.body.attributesDetail || {};
    const attributes = req.body.attributes || "";
    const detailAttributes = buildAttributeList(attributesDetail).join(", ");
    let attributesString = attributes || "";
    if (!attributesString && detailAttributes) {
      attributesString = detailAttributes;
    }

    const v = validateNudesPackPoseIds(poseIds);
    if (!v.ok) {
      return res.status(400).json({ success: false, message: v.error });
    }

    if (!modelId) {
      return res.status(400).json({ success: false, message: "Model ID is required" });
    }

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW generation is only available for AI-generated models.",
      });
    }
    if (isMinorModel(model)) {
      return res.status(403).json({
        success: false,
        message: "Models under 18 cannot use NSFW features.",
      });
    }
    if (!model.nsfwUnlocked) {
      return res.status(403).json({
        success: false,
        message: "Please train a LoRA first to unlock NSFW generation.",
      });
    }

    let loraUrl = model.loraUrl;
    let loraTriggerWord = model.loraTriggerWord;
    let activeFaceReferenceUrl = model.faceReferenceUrl;
    let activeLoraName = model.name;

    if (model.activeLoraId) {
      const activeLora = await prisma.trainedLora.findUnique({
        where: { id: model.activeLoraId },
      });
      if (activeLora && activeLora.status === "ready") {
        loraUrl = activeLora.loraUrl;
        loraTriggerWord = activeLora.triggerWord;
        activeFaceReferenceUrl = activeLora.faceReferenceUrl || activeFaceReferenceUrl;
        activeLoraName = activeLora.name || model.name;
      }
    }

    if (!loraUrl || !loraTriggerWord) {
      return res.status(400).json({
        success: false,
        message: "LoRA not properly configured for this model.",
      });
    }

    let faceReferenceUrl = null;
    if (!skipFaceSwap) {
      if (faceSwapImageUrl) {
        const validGalleryImage = await prisma.generation.findFirst({
          where: {
            userId,
            modelId,
            outputUrl: faceSwapImageUrl,
            status: "completed",
            type: { in: ["prompt-image", "image", "face-swap-image", "nsfw"] },
          },
        });
        if (!validGalleryImage) {
          return res.status(403).json({
            success: false,
            message: "Face swap image must be from your gallery (generated for this model)",
          });
        }
        faceReferenceUrl = faceSwapImageUrl;
      } else {
        faceReferenceUrl = activeFaceReferenceUrl || null;
      }
    }

    const creditsNeeded = poseIds.length * NUDES_PACK_CREDITS_PER_IMAGE;
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for this nudes pack (${poseIds.length} × ${NUDES_PACK_CREDITS_PER_IMAGE}). You have ${totalCredits} credits.`,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    const userOverrideStrength = options.loraStrength || null;
    const adminSamplerOpts = getAdminNsfwSamplerOptions(req, options);
    const resolutionPreset =
      options?.resolution ||
      req.body.resolution ||
      (req.body.width && req.body.height ? `${req.body.width}x${req.body.height}` : undefined);
    const resSpec = resolveNsfwResolution(resolutionPreset);
    const postProcessing = {
      blur: {
        enabled: options?.postProcessing?.blur?.enabled !== false,
        strength: Number(options?.postProcessing?.blur?.strength ?? 0.3),
      },
      grain: {
        enabled: options?.postProcessing?.grain?.enabled !== false,
        strength: Number(options?.postProcessing?.grain?.strength ?? 0.06),
      },
    };

    let queuedCount = 0;

    for (let idx = 0; idx < poseIds.length; idx++) {
      const poseId = poseIds[idx];
      const pose = getNudesPackPoseById(poseId);
      if (!pose) {
        failures.push({ poseId, error: "Unknown pose" });
        await refundCredits(userId, NUDES_PACK_CREDITS_PER_IMAGE);
        continue;
      }

      const looksTail = attributesString ? `, ${attributesString}` : "";
      const userPrompt = `${pose.promptFragment}${looksTail}`.trim();
      const sceneLine = [packSceneNote.trim(), `Nudes pack ${idx + 1}/${poseIds.length}: ${pose.title}`]
        .filter(Boolean)
        .join(" · ");

      const generation = await prisma.generation.create({
        data: {
          userId,
          modelId,
          type: "nsfw",
          prompt: `[${pose.id}] ${userPrompt}`,
          status: "processing",
          creditsCost: NUDES_PACK_CREDITS_PER_IMAGE,
          replicateModel: "comfyui-nsfw",
          isNsfw: true,
        },
      });
      generationIds.push(generation.id);

      const submission = await submitNsfwGeneration({
        loraUrl,
        triggerWord: loraTriggerWord,
        userPrompt,
        attributes: attributesString,
        sceneDescription: sceneLine || userPrompt,
        chipSelections: attributesDetail,
        options: {
          quickFlow: options.quickFlow === true,
          loraStrength: userOverrideStrength,
          postProcessing,
          resolution: resSpec.presetId,
          ...adminSamplerOpts,
        },
      });

      if (!submission.success) {
        await refundGeneration(generation.id);
        await prisma.generation.update({
          where: { id: generation.id },
          data: { status: "failed", errorMessage: getErrorMessageForDb(submission.error) },
        });
        failures.push({ poseId, error: submission.error || "Submit failed" });
        continue;
      }

      const rp = submission.resolvedParams || {};
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          inputImageUrl: JSON.stringify({
            comfyuiPromptId: submission.requestId,
            loraUrl,
            triggerWord: loraTriggerWord,
            loraName: activeLoraName || "Unknown",
            faceReferenceUrl: faceReferenceUrl || null,
            nudesPackPoseId: pose.id,
            girlLoraStrength: rp.girlLoraStrength ?? 0.70,
            activePose: rp.activePose || null,
            activePoseStrength: rp.activePoseStrength ?? 0,
            runningMakeup: rp.runningMakeup ?? false,
            runningMakeupStrength: rp.runningMakeupStrength ?? 0,
            cumEffect: rp.cumEffect ?? false,
            cumStrength: rp.cumStrength ?? 0,
            seed: rp.seed ?? null,
            steps: rp.steps ?? 50,
            cfg: rp.cfg ?? 3,
            width: rp.width ?? resSpec.width,
            height: rp.height ?? resSpec.height,
            resolutionPreset: rp.resolutionPreset ?? resSpec.presetId,
            sampler: rp.sampler ?? "dpmpp_2m",
            scheduler: rp.scheduler ?? "beta",
            builtPrompt: rp.prompt || null,
            blurEnabled: rp?.postProcessing?.blur?.enabled ?? true,
            blurStrength: rp?.postProcessing?.blur?.strength ?? 0.3,
            grainEnabled: rp?.postProcessing?.grain?.enabled ?? true,
            grainStrength: rp?.postProcessing?.grain?.strength ?? 0.06,
          }),
        },
      });

      processNsfwGenerationInBackground(
        generation.id,
        submission.requestId,
        userId,
        NUDES_PACK_CREDITS_PER_IMAGE,
        faceReferenceUrl,
      ).catch((error) => {
        console.error("❌ Nudes pack background error:", error);
      });
      queuedCount += 1;
      queuedGenerationIds.push(generation.id);
    }

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

    return res.json({
      success: true,
      message:
        failures.length === 0
          ? `Nudes pack started: ${poseIds.length} image(s) queued.`
          : `Nudes pack partially queued: ${queuedCount} ok, ${failures.length} failed (credits refunded for failures).`,
      generations: queuedGenerationIds.map((id) => ({ id, status: "processing" })),
      failures,
      creditsUsed: queuedCount * NUDES_PACK_CREDITS_PER_IMAGE,
      creditsRemaining: getTotalCredits(updatedUser),
      poseCount: poseIds.length,
    });
  } catch (error) {
    console.error("❌ Nudes pack error:", error);
    if (creditsDeducted > 0 && userId) {
      for (const gId of generationIds) {
        try {
          await refundGeneration(gId);
        } catch (e) {
          console.error("Nudes pack refund gen:", e.message);
        }
      }
      const fromRows = generationIds.length * NUDES_PACK_CREDITS_PER_IMAGE;
      const remainder = creditsDeducted - fromRows;
      if (remainder > 0) {
        try {
          await refundCredits(userId, remainder);
        } catch (e) {
          console.error("Nudes pack remainder refund:", e.message);
        }
      }
    }
    return res.status(500).json({ success: false, message: "Server error starting nudes pack" });
  }
}

// ============================================
// Background processor for NSFW generation
// ============================================
const nsfwPollQueue = [];
let nsfwPollRunning = false;
const NSFW_POLL_INTERVAL = 10000;
const NSFW_MAX_POLL_TIME = 20 * 60 * 1000;

function enqueueNsfwPoll(generationId, requestId, userId, creditsNeeded, faceReferenceUrl) {
  nsfwPollQueue.push({ generationId, requestId, userId, creditsNeeded, faceReferenceUrl, enqueuedAt: Date.now() });
  console.log(`📥 [Q] Queued NSFW poll for ${generationId} (queue size: ${nsfwPollQueue.length})`);
  if (!nsfwPollRunning) {
    nsfwPollRunning = true;
    runNsfwPollQueue();
  }
}

async function runNsfwPollQueue() {
  while (nsfwPollQueue.length > 0) {
    const job = nsfwPollQueue[0];
    const { generationId, requestId, faceReferenceUrl } = job;
    console.log(`\n🔥 [Q] Polling ${generationId} (${nsfwPollQueue.length} in queue)`);

    try {
      const pollResult = await pollNsfwJob(requestId, NSFW_MAX_POLL_TIME);
      const result = await getNsfwGenerationResult(requestId, pollResult._runpodOutput);

      if (result.outputUrls && result.outputUrls.length > 0) {
        let permanentUrls = result.outputUrls;

        if (faceReferenceUrl) {
          console.log(`🔄 [Q] Face-swapping ${permanentUrls.length} images...`);
          const swappedUrls = [];
          for (let i = 0; i < permanentUrls.length; i++) {
            try {
              const swapResult = await faceSwapWithFal(permanentUrls[i], faceReferenceUrl);
              swappedUrls.push(swapResult.success && swapResult.outputUrl ? swapResult.outputUrl : permanentUrls[i]);
            } catch {
              swappedUrls.push(permanentUrls[i]);
            }
          }
          permanentUrls = swappedUrls;
        }

        const outputUrlValue = permanentUrls.length === 1 ? permanentUrls[0] : JSON.stringify(permanentUrls);
        await prisma.generation.update({
          where: { id: generationId },
          data: { status: "completed", outputUrl: outputUrlValue, completedAt: new Date() },
        });
        console.log(`✅ [Q] ${generationId.slice(0, 8)} completed (${permanentUrls.length} imgs)`);
      } else {
        throw new Error("No output URLs in result");
      }
    } catch (error) {
      console.error(`❌ [Q] ${generationId.slice(0, 8)} error: ${error.message}`);
      await refundGeneration(generationId);
      await prisma.generation.update({
        where: { id: generationId },
        data: { status: "failed", errorMessage: getErrorMessageForDb(error.message || "Generation failed") },
      }).catch(() => {});
    }

    nsfwPollQueue.shift();
  }

  nsfwPollRunning = false;
  console.log(`📭 [Q] NSFW poll queue empty`);
}

async function processNsfwGenerationInBackground(
  generationId,
  requestId,
  userId,
  creditsNeeded,
  faceReferenceUrl = null,
) {
  enqueueNsfwPoll(generationId, requestId, userId, creditsNeeded, faceReferenceUrl);
}

// ============================================
// Build training prompts (legacy helper)
// ============================================
function buildTrainingPrompts(imageType, aiParams) {
  let params = {};
  try {
    params = typeof aiParams === "string" ? JSON.parse(aiParams) : aiParams || {};
  } catch (e) {
    params = {};
  }

  const gender = params.gender || "woman";
  const age = params.age || "20s";

  // Build appearance descriptor from all available fields
  const heritage = params.heritage || "";
  const hairColor = params.hairColor || "";
  const hairLength = params.hairLength || "";
  const hairTexture = params.hairTexture || "";
  const eyeColor = params.eyeColor || "";
  const bodyType = params.bodyType || "";

  const appearanceParts = [
    heritage ? `${heritage} heritage` : "",
    hairLength || hairTexture || hairColor
      ? `${[hairLength, hairTexture, hairColor].filter(Boolean).join(" ")} hair`
      : "",
    eyeColor ? `${eyeColor} eyes` : "",
  ].filter(Boolean);
  const appearanceDesc = appearanceParts.length > 0 ? `, ${appearanceParts.join(", ")}` : "";

  const bodyDescriptorMap = {
    slim: "slim figure",
    athletic: "athletic figure",
    curvy: "curvy figure",
    petite: "petite figure",
    hourglass: "hourglass figure",
    muscular: "muscular figure",
  };
  const bodyDesc = bodyType ? `, ${bodyDescriptorMap[bodyType] || bodyType + " figure"}` : "";

  const skinDetails =
    "natural skin texture with visible pores, not plastic or airbrushed, realistic skin, clear skin without acne, no pimples, no blemishes, healthy glowing skin";
  const photoStyle =
    "amateur photo taken by friend, smartphone quality, casual candid shot, authentic moment, well-lit but not studio";
  const baseDescription = `${age} ${gender}${appearanceDesc}${bodyDesc}, ${skinDetails}, ${photoStyle}`;

  const prompts = {
    selfie: [
      `${baseDescription}, casual selfie, looking at camera, genuine smile, natural daylight from window, relaxed vibe`,
      `${baseDescription}, mirror selfie, slight angle, playful expression, bedroom or bathroom background, everyday moment`,
      `${baseDescription}, front-facing phone selfie, natural expression, good lighting, authentic casual look`,
      `${baseDescription}, close-up selfie, warm genuine smile, cozy indoor lighting, friend taking photo vibe`,
      `${baseDescription}, selfie, eye contact with camera, minimal makeup, bright natural light, candid moment`,
    ],
    half_body: [
      `${baseDescription}, half body shot, casual pose, standing at home, living room background, snapshot style`,
      `${baseDescription}, upper body, relaxed natural pose, sitting on couch, everyday setting, candid photo`,
      `${baseDescription}, waist-up shot, casual confident pose, kitchen or bedroom background, friend taking photo`,
      `${baseDescription}, half body, comfortable sitting pose, cafe or home setting, natural snapshot`,
      `${baseDescription}, torso shot, natural stance, outdoor patio or balcony, casual lifestyle photo`,
    ],
    full_body: [
      `${baseDescription}, full body shot, casual standing pose, living room or bedroom, everyday photo`,
      `${baseDescription}, full body, relaxed natural pose, at home setting, snapshot taken by friend`,
      `${baseDescription}, full length shot, casual stance, outdoor backyard or park, natural daylight`,
      `${baseDescription}, complete body shot, relaxed pose, mirror photo, casual outfit, authentic moment`,
      `${baseDescription}, full body, gentle pose, hotel room or apartment, vacation photo style`,
    ],
  };

  return prompts[imageType] || prompts.selfie;
}

// ============================================
// MODIFIED ENDPOINT: Generate NSFW prompt
// POST /api/nsfw/generate-prompt
// Body: { modelId, userRequest }
// ============================================

/** Shared Grok prompt builder (also used by plan-generation). */
async function runNsfwPromptGenerationForModel(model, userRequest, clientDetail = {}, clientAttributes = "") {
  let triggerWord = model.loraTriggerWord || "lora_" + model.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    let lockedAppearance = {};

    if (model.activeLoraId) {
      const activeLora = await prisma.trainedLora.findUnique({
        where: { id: model.activeLoraId },
      });
      if (activeLora) {
        if (activeLora.triggerWord) triggerWord = activeLora.triggerWord;
        const raw = activeLora.defaultAppearance;
        if (raw && typeof raw === "object") lockedAppearance = { ...raw };
        else if (typeof raw === "string") {
          try {
            lockedAppearance = JSON.parse(raw) || {};
          } catch {
            lockedAppearance = {};
          }
        }
      }
    }
    if (Object.keys(lockedAppearance).length === 0 && model.savedAppearance) {
      const raw = model.savedAppearance;
      if (typeof raw === "object") lockedAppearance = { ...raw };
      else if (typeof raw === "string") {
        try {
          lockedAppearance = JSON.parse(raw) || {};
        } catch {
          lockedAppearance = {};
        }
      }
    }

    // Prompt is based on locked LoRA look + scene. Merge client chips (e.g. auto-matched) but locked overrides.
    const attributesDetail = { ...clientDetail, ...lockedAppearance };
    const attributesString = buildAttributeList(attributesDetail).join(", ") || clientAttributes;
    const combinedAttributes = [
      buildAttributeList(attributesDetail).join(", "),
      clientAttributes,
    ]
      .filter(Boolean)
      .join(", ");
    const attributeSummary = summarizeAttributes(attributesDetail, attributesString);

    let aiParams = {};
    try {
      aiParams =
        typeof model.aiGenerationParams === "string"
          ? JSON.parse(model.aiGenerationParams)
          : model.aiGenerationParams || {};
    } catch (e) {
      aiParams = {};
    }

    const systemPrompt = `You are an expert prompt engineer for Z-Image Turbo (a 6B single-stream diffusion model). Your ONLY goal is to produce prompts that generate REAL-LOOKING amateur smartphone nudes — the kind found on a girl's private phone gallery. These are RAW, unedited, imperfect smartphone photos. NOT professional, NOT cinematic, NOT studio, NOT DSLR, NOT AI art.

=== Z-IMAGE TURBO PROMPTING PRINCIPLES ===
Z-Image Turbo uses natural language processing — it understands full descriptive sentences, relationships between objects, and spatial placement. Follow these principles:

1. NATURAL LANGUAGE OVER KEYWORDS: Write rich, descriptive phrases — NOT keyword tag dumps. Describe as if telling someone what the photo looks like. Example: "lying on rumpled white sheets with phone charger on the nightstand, dim overhead ceiling light, phone flash washing out her skin slightly" is better than "bed, sheets, lamp, charger".
   • Prefer CONNECTED SENTENCES over comma lists. Z-Image Turbo's text encoder (Qwen lineage) rewards full sentences with spatial relationships and causality. Example: "She lies on her side on an unmade bed, one leg bent and raised, phone flash catching the curve of her hip and the faint stretch marks on her thigh." This beats tag-dumps every time.

2. PROMPT PRIORITY ORDER (most important elements FIRST):
   a) Subject identity (trigger word + physical traits)
   b) Pose, action, and body position
   c) Outfit / clothing state
   d) Expression and emotion
   e) Environment and props (with realistic clutter)
   f) Lighting (phone flash or natural room light ONLY)
   g) Camera device and angle
   h) Realism anchors (skin texture, compression, smartphone artifacts)

3. PROMPT LENGTH: Aim for 50–100 words of flowing descriptive sentences and short phrases. Turbo-class models now reward richer scene narration over ultra-short prompts. Avoid exceeding 130 words — focus diffuses. Too short = vague; every word should serve the scene.

4. IN-PROMPT CONSTRAINTS (Z-Image has no negative prompt — encode constraints positively):
   Instead of saying what NOT to include, describe what IS there. For example: "natural skin texture with visible pores and slight blemishes" inherently prevents airbrushed/smooth skin. Add "no extra limbs, no distorted hands" ONLY when mutation risk is high (complex poses, multiple body parts).

5. PHYSICAL COHERENCE: Every element must be physically possible in the same frame. Mentally simulate the photo: Can this pose exist in this environment? Does the lighting match the time of day?

=== AMATEUR PHOTO IDENTITY (CRITICAL — this defines the entire output style) ===
The photo MUST look like it was taken on a smartphone by the girl herself. Think: private nudes from a phone gallery, bathroom mirror selfie at 2am, quick nude snap before shower, candid bedroom self-timer photo with bad lighting. The image should feel SPONTANEOUS, UNPLANNED, and IMPERFECT. There is ONLY ONE person in the photo — the girl. No one else exists in the scene.

Key amateur markers to ALWAYS include:
- Phone flash harsh wash-out on skin (for dim/night scenes) OR flat overhead ceiling light (for indoor scenes) OR natural window daylight (for daytime)
- Slight overexposure from flash, uneven lighting, visible shadows
- Minor lens distortion from wide-angle phone camera
- Background clutter (always weave in 2–4 small mundane items): crumpled blanket corner, half-empty water bottle on nightstand, charging cable snaking across sheets, discarded hoodie on floor, phone case nearby, unmade bed, clothes on floor — never clean/minimal studio sets
- Natural untouched skin: visible pores, slight blemishes, skin folds, natural body texture — NOT smooth, NOT plastic, NOT airbrushed
- Casual, unstaged feeling — the pose should feel natural, not like a model posing for a photoshoot

=== ANTI-CINEMATIC RULES (CRITICAL — violations produce bad output) ===
The #1 failure mode is generating images that look like STUDIO SHOTS or PROFESSIONAL PHOTOGRAPHY. To prevent this:
- NEVER mention or imply: professional lighting, studio setup, artistic composition, rim lighting, backlighting, dramatic shadows, moody atmosphere, warm golden light from lamps
- NEVER describe elaborate lighting setups. Real amateur photos have ONE light source: phone flash, ceiling light, or window
- Lamps should be OFF. In dim rooms, the PHONE FLASH is the primary light source, creating harsh flat frontal lighting with washed-out skin highlights
- If daytime: simple flat daylight from window. NOT "golden hour" or "warm sunlight streaming in"
- The composition should feel ACCIDENTAL, not composed. Slightly off-center, maybe slightly tilted, imperfect framing
- Background should be MESSY and MUNDANE — not aesthetically arranged

=== DEFAULT LIGHTING (PHONE FLASH — HAMMER THIS) ===
Unless the user EXPLICITLY requests daytime or natural window light, treat harsh direct smartphone flash as the DEFAULT for dim/indoor/private-gallery feel. It should read as the ONLY dominant light source. Prefer phrasing like: "harsh frontal phone flash washing out skin highlights, creating sharp shadows behind her" or "strong on-camera flash bloom with slight lens flare." Recent strong results treat flash as almost mandatory indoors — do not default to soft or cinematic room glow.

=== ANTI-MUTATION RULES (CRITICAL) ===
- For any pose involving hands: specify exactly what EACH hand is doing and where it is.
- For complex body poses: describe the body position from top to bottom (head → torso → hips → legs → feet).
- For any full-body or 3/4 body shot: chain head-to-toe in one flow, e.g. "head tilted slightly, shoulders relaxed, torso twisted gently, hips angled, knees bent, feet pointed naturally."
- When hands are visible or the pose is complex, add "proportional limbs, five fingers per hand, correct hand placement" (keeps Turbo from limb drift).
- Always include "one person only" to prevent ghost limbs/second person artifacts.
- NEVER mention "boyfriend", "someone else", "another person", "partner" — this causes phantom person artifacts.
- For close-ups: specify what body parts are IN FRAME and what is NOT visible.
- Include "anatomically correct, natural body proportions" for full/mid body shots.
- For POV oral or penetrative sex: anchor realistic scale ("average-sized penis", "proportional to her hand") and default to exactly ONE hand on shaft for blowjobs; vary left vs right between generations. Two hands on shaft only if the user explicitly asked for huge/large.
- For face focus: add "detailed face, natural facial features, symmetrical eyes".

=== PROMPT STYLE (CRITICAL — this determines quality) ===
- Prefer 50–100 words of flowing sentences + light phrasing (see PRINCIPLE 3). Stay direct — no filler adjectives — but narration beats ultra-short tag lines for Turbo variants.
- Do NOT bloat past ~130 words. Each sentence should ADD scene, pose, light, or spatial clarity.
- Focus on: POSE + BODY (chain when needed) + EXPRESSION + 2–4 clutter/prop details + dominant light.
- The QUALITY_SUFFIX already adds all the amateur/phone/skin texture markers — do NOT repeat those in the scene prompt.
- BAD (cinematic + redundant): "beautiful young woman lying on bed with messy sheets in a bedroom with warm lighting, soft expression, natural skin, casual amateur look, phone photo, candid"
- GOOD (narrative + flash): "She lies back on rumpled grey sheets, legs spread, one hand on her breast and biting her lower lip; harsh phone flash blows out her chest and leaves the headboard in deep shadow, charger cable tangled near her hip."

=== REALISM ANCHORS (included automatically via QUALITY_SUFFIX — do NOT repeat) ===
The QUALITY_SUFFIX already handles: smartphone camera, skin texture, auto-exposure, jpeg artifacts, phone flash, motion blur, grainy low light, solo girl, anatomically correct. 
Your prompt only needs to add:
- The SCENE and POSE specifics (with sentence flow where helpful)
- 2–4 mundane clutter items (charger, bottle, clothes, blanket corner, case on nightstand — see AMATEUR PHOTO IDENTITY)
- Do NOT repeat phone flash, skin texture, or camera type — QUALITY_SUFFIX already covers these
- NEVER say "taken by boyfriend" or "taken by someone" — this generates phantom people

=== BANNED TERMS (these destroy the amateur look — NEVER use any of these) ===
"ultra detailed", "8k", "masterpiece", "best quality", "professional photography", "RAW photo", "DSLR", "studio lighting", "color grading", "bokeh", "cinematic", "editorial", "magazine quality", "sharp focus", "high resolution", "dramatic lighting", "rim light", "backlit", "warm lamp light", "golden glow", "artistic", "styled", "posed professionally", "photoshoot", "backstage", "behind the scenes", "taken by boyfriend", "taken by partner", "warm ambient light", "volumetric", "god rays", "rim glow", "catchlight", "specular highlight" (unless clearly flash-caused), "film grain emulation", "hyperrealistic"

=== LIGHTING RULES (STRICT) ===
- DEFAULT: Unless user asked for daytime/window light, use harsh direct phone flash as the ONLY dominant source (see DEFAULT LIGHTING above). Describe wash-out, sharp shadow falloff, optional slight flare — not soft box or lamp glow.
- PHONE FLASH is the DEFAULT for indoor/dim/night scenes. It creates harsh, flat, frontal white light that slightly washes out skin. This is the #1 amateur lighting signature.
- Overhead ceiling light: flat, unflattering, slightly yellow — the other common indoor light
- Window daylight: flat, even, slightly blue-white — for daytime scenes
- NEVER use lamp/bedside light as primary — lamps create the cinematic warm glow that makes photos look professional
- NEVER mix multiple light sources — real phone photos have ONE dominant light
- If the scene is a bedroom at night: phone flash ON, all lamps OFF, ceiling light OFF or dim

=== FRAMING RULES ===
- The photo is ALWAYS a DIRECT photo of the girl. Never backstage, never behind-the-scenes, never showing phone screens or camera equipment.
- Mirror selfie: she is taking the photo herself, phone visible in mirror reflection, "taking a selfie with iPhone in bathroom mirror"
- Normal selfie: front camera, arm extended or close, "iPhone front camera selfie"
- Third person: someone took a photo directly of her, NOT "taken by boyfriend" — just describe the angle and framing
- NEVER describe the photo AS IF someone else is in the room. The camera just exists — describe what the camera sees, not who holds it.

=== SELFIE RULES ===
- Mirror selfie: include "taking a selfie with iPhone". Mirror is part of the pose — do NOT also mention "mirror" in background. Phone SHOULD be visible in mirror reflection.
- Front-camera selfies (non-mirror): "close-up front camera selfie, arm extended slightly out of frame, slight wide-angle distortion on cheeks and forehead."
- Overhead / top-down body shots: "high overhead angle looking straight down at her body on the bed, foreshortened legs closer to camera, natural phone perspective" — no phone visible in frame.
- Bed selfie / casual nude: Do NOT show phone in her hand. Frame as overhead/top-down or natural relaxed pose. No phone visible. No second person mentioned.
- Overhead selfie: "overhead angle looking down at body" — DO NOT mention phone, boyfriend, partner, or any second person.
- NEVER say "selfie stick", "tripod", or "timer photo visible" — keep the capture device invisible except in mirror reflections.
- General rule: Only mirror selfies should show a phone. All other non-mirror photos use "overhead angle" or "rear camera angle" with NO mention of who holds it.

=== POV SEX & BLOWJOB RULES (CRITICAL — explicit content with anatomical accuracy) ===
Sex position photos should show REALISTIC amateur sex content. Include appropriate male anatomy (penis, erection) when the pose implies penetration or oral sex — this is critical for realism. However, NEVER show a full second person/body — only the relevant body part (penis) entering the frame. The girl is always the focus.
- GENITAL SCALE (CRITICAL): Penis must look like a normal adult size in POV — proportional to her hands and face, not filling the entire frame. Prefer phrases like "average-sized erect penis", "realistic scale penis", "penis proportional to her hand". NEVER imply porn-star exaggeration unless the user explicitly asks for huge/large.
- POV or penetration shots: describe anatomy and position ONLY from what the camera sees — e.g. "close-up view between spread thighs, vulva glistening, phone flash illuminating inner labia and wetness" — NEVER imply a holder, partner, boyfriend, or second person. No "his hands", no "he"; only her body + the single visible male part if needed.
- Reinforce: NEVER "boyfriend", "partner", "someone else" — that spawns phantom people.

BLOWJOB / DEEPTHROAT POV:
- Frame: Close-up or mid-shot from above, looking down at girl
- Camera angle: "POV first person angle looking down"
- Girl is kneeling, face looking UP at camera
- Mouth: "mouth wrapped around tip and upper shaft, looking up at camera with [expression]" — describe contact so it reads as oral sex happening, not hovering
- HANDS (CRITICAL — DEFAULT ONE HAND): Use EXACTLY ONE hand on the penis unless the user explicitly asked for "huge cock", "massive", "two hands", or similar. Each generation, pick EITHER left OR right hand for the shaft grip (vary across outputs). The other hand must NOT grip the shaft — place it on her own thigh, knee, floor for balance, or tucked hair — never stacked both hands on shaft by default.
- Do NOT use "both hands gripping shaft" or "two hands wrapped around shaft" unless the user explicitly wanted oversized anatomy.
- Include: subtle "saliva at lips, slight wetness on chin" when appropriate — avoid extreme drool unless deepthroat/gagging is requested
- Include: "erect penis in her mouth" or "penis entering mouth from above" with realistic scale
- Key phrase: "kneeling blowjob, mouth on penis, one hand on shaft, looking up at camera, POV from above"

HANDJOB POV:
- Frame: Mid-shot from partner's perspective looking down
- Girl's hand(s) gripping average-scale erect penis — "hand wrapped around shaft" (one or two hands OK here since the act is handjob, not oral)
- Expression: eye contact, playful or focused
- Show penis in her hand(s) for realism

TITFUCK POV:
- Frame: Looking down at her chest from above
- Girl lying on back or kneeling, pushing breasts together around penis
- "pressing breasts together around penis, looking up at camera"
- POV from above angle

MISSIONARY / SEX POSITIONS:
- Missionary (must read as ACTUAL intercourse): girl lying on back, legs spread or wrapped; describe CLEAR CONTACT — labia parted around shaft, visible insertion depth, bodies aligned, not a disconnected floating penis. Use average-scale penis language. One hand squeezing her own breast or gripping sheet, looking up at camera, natural pleasure expression (NOT extreme moaning or ahegao). Example shape: "missionary on bed, legs spread, average-sized penis penetrating pussy, connection visible at entrance, one hand on breast, biting lip, POV from above"
- Doggy: CRITICAL — shot from MAN'S POV behind her. Girl on all fours, penis entering from behind visible, visible anus and pussy, looking back over shoulder at camera BEHIND her, "doggy style on all fours, penis entering from behind, arched back, visible anus and pussy, looking back over shoulder at camera behind her, POV from behind". NEVER describe or show a hand holding/gripping the penis in doggy POV — the only hands visible are HER hands (on bed, sheets, mattress). The penis is entering from behind from the viewer's POV with NO hand in frame.
- For ALL sex positions: show anatomically correct genitals and penetration. Only the penis is visible — no male torso/legs/face.
- For ALL sex positions: girl must be ACTIVELY engaged — holding/squeezing her own breasts, gripping sheets, or touching herself. NEVER just lying still.
- Expressions in sex poses: use SUBTLE natural pleasure — "biting lower lip", "eyes half closed with pleasure", "soft moan expression", "pleasure face". NEVER use ahegao, rolled-back eyes, or extreme orgasm faces (these cause mutations without a specialized LoRA).
- Movement cues: "flushed cheeks, messy hair, slightly damp skin" (NOT drenched in sweat — keep it subtle and natural)

IMPORTANT SWEAT/WETNESS IN SEX POSES:
- Use "slightly damp skin" or "light sheen on skin" instead of "sweaty" or "drenched in sweat"
- Sex photos should look NATURAL and CASUAL, not like intense athletic activity
- Flushed cheeks and messy hair convey the mood better than excessive sweat
- For blowjob/oral scenes: do NOT add running makeup, smeared mascara, or sweaty skin by default. Keep skin clean and natural unless the user explicitly requested those effects

SELFIE PHOTOS — NO PHONE IN HAND:
- For bed selfies or casual nude photos, do NOT show phone in her hand unless it's specifically a mirror selfie
- Instead, frame as "overhead angle looking down" or "rear camera angle" — do NOT mention who holds the camera
- The girl should look natural and relaxed, NOT posing with a phone
- Exception: mirror selfies specifically should show phone reflection in mirror
- NEVER mention boyfriend, partner, or any second person in any prompt

=== PROVEN WINNING PATTERNS (use these structures — expand with sentence flow to ~50–100 words when needed) ===
These patterns are structural scaffolds. Flesh them out with connected sentences, 2–4 clutter items, and dominant phone flash (unless user chose daylight). The QUALITY_SUFFIX handles amateur/phone/skin markers automatically — do NOT repeat them here.

PATTERN A — Mirror selfie:
"[trigger], mirror selfie in bathroom, iPhone visible in reflection, [hair], [outfit/nudity], [expression], phone flash, messy [room]"

PATTERN B — Bed nude (overhead, NO phone visible):
"[trigger], lying on bed [nude/outfit], overhead angle looking down at body, [expression], hair spread on pillow, messy [color] sheets, dim room phone flash"

PATTERN C — Blowjob POV (default ONE hand on shaft; vary left vs right between generations):
"[trigger], POV blowjob, girl on knees looking up at camera, mouth around average-sized erect penis, right hand gripping lower shaft, left hand braced on her thigh, messy hair falling forward, bedroom floor, eye contact with camera"
BLOWJOB VARIATIONS (randomize; prefer single-hand unless user asked for huge):
- Tip sucking: "lips around glans, tongue on frenulum, one hand loosely at base, other hand on knee, looking up"
- Alternate hand: swap to "left hand on shaft, right hand on floor for balance"
- Two-handed (ONLY if user asked for large/huge): "both hands stacked on shaft, mouth on tip"
- Deepthroat: "penis deep in mouth, watery eyes, ONE hand at base of shaft, other hand on thigh, slight drool"
- Side licking: "tongue along side of shaft, one hand guiding lightly, playful expression"

PATTERN D — Doggy style (PROVEN BEST — pic 10 was "very good, very real"):
"[trigger], doggy style on all fours on bed, arched back, looking over shoulder at camera, average-sized erect penis entering from behind with visible penetration, visible anus and pussy, one hand gripping sheets other hand on mattress, slightly damp skin, messy hair, white sheets, POV from behind, no hand on penis"

PATTERN E — Bent over (PROVEN BEST — pic 13 was "veeery real"):
"[trigger], bent over showing ass, hands pulling panties down, looking back over shoulder at camera, visible pussy from behind, standing in bedroom, playful smirk"

PATTERN F — Missionary POV (penetration must look connected and proportional):
"[trigger], missionary on bed, lying on back legs spread, average-sized penis penetrating pussy with visible contact at entrance, labia stretched around shaft, one hand squeezing breast, biting lip, messy hair on pillow, flushed cheeks, POV from above"

KEY INSIGHT: Strong Turbo prompts are 50–100 words, sentence-driven, spatially clear, flash-forward indoors, with mundane clutter. No flowery portrait clichés — the LoRA handles the face. Do NOT repeat QUALITY_SUFFIX content.

When user selections map to any of these scenarios, STRONGLY prefer these proven structures. Adapt to user's chip selections but keep the structural flow intact.

=== LOGICAL CONSISTENCY (think step-by-step before writing) ===
${buildConstraintRulesText()}
- Before writing: mentally simulate the entire photo — can every element physically coexist?
- If selections contain contradictions, drop the less important element and keep core intent.
- Wet scenes (shower/pool/rain) → wet body, wet hair, no dry outfits
- Lying poses → need a surface (bed/floor/couch), not standing backgrounds
- Indoor lighting ≠ outdoor settings. Flash ≠ daylight.

=== INPUT ===
SCENE (preset or user-written): '${userRequest}'
LOCKED LORA LOOK + MATCHED CHIPS (identity/appearance — use these, do not invent):
${attributeSummary}
Inline: ${combinedAttributes || "none"}

MODEL ATTRIBUTES:
- Name/Trigger: ${triggerWord}
- Gender: ${aiParams.gender || "woman"}
- Age: ${model.age ? model.age + " years old" : aiParams.age || "20s"}
- Body type: ${aiParams.bodyType || "fit"}
- Hair color: ${aiParams.hairColor || "not specified"}
- Eye color: ${aiParams.eyeColor || "not specified"}
- Skin tone: ${aiParams.skinTone || "not specified"}
- Ethnicity: ${aiParams.ethnicity || "not specified"}

=== FINAL RULES ===
- Do NOT invent traits, clothing, or accessories not requested.
- Use ONLY provided attributes + user request. Do not add elements the user did not ask for.
- Backgrounds must have realistic imperfections and clutter — messy, lived-in, mundane.
- NEVER include logically impossible combinations.
- Write as coherent descriptive phrases with natural flow, not random comma-separated tags.
- NEVER mention another person, boyfriend, partner, or photographer in the prompt.
- The photo must look like a REAL private nude from a smartphone — raw, imperfect, spontaneous.

OUTPUT: Return ONLY a JSON array with one prompt: ["prompt text here"]. No extra text.`;

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      throw new Error("AI service not configured");
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "x-ai/grok-4.1-fast",
        max_tokens: 2048,
        messages: [{ role: "user", content: systemPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Grok API error:", errorText);
      throw new Error("Failed to generate prompt");
    }

    const result = await response.json();
    const rawContent = result.choices?.[0]?.message?.content || "[]";
    const content = rawContent.includes("<think>")
      ? rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
      : rawContent;

    let generatedPrompt = "";
    try {
      const cleanContent = content.replace(/```json\s*|```\s*/g, "").trim();
      const promptArray = JSON.parse(cleanContent);
      generatedPrompt = promptArray[0] || "";
    } catch (e) {
      generatedPrompt = content.trim();
    }

    return generatedPrompt;
}

export async function generateNsfwPrompt(req, res) {
  try {
    const userId = req.user.userId;
    const { modelId, userRequest } = req.body;
    const clientAttributes = req.body.attributes || "";
    const clientDetail = req.body.attributesDetail || {};

    if (!modelId || !userRequest) {
      return res.status(400).json({
        success: false,
        message: "Model ID and user request (scene) are required",
      });
    }

    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
    });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    const generatedPrompt = await runNsfwPromptGenerationForModel(
      model,
      userRequest,
      clientDetail,
      clientAttributes,
    );
    res.json({ success: true, prompt: generatedPrompt });
  } catch (error) {
    console.error("Generate prompt error:", error);
    const msg = error?.message || "";
    if (msg === "AI service not configured") {
      return res.status(500).json({ success: false, message: msg });
    }
    res.status(500).json({
      success: false,
      message: msg || "Failed to generate prompt",
    });
  }
}

// ============================================
// LOGICAL CONSTRAINTS ENGINE
// Prevents contradictory chip combinations
// ============================================
const LOGICAL_CONSTRAINTS = [
  {
    id: "mirror_selfie_no_mirror_bg",
    description: "Mirror selfie pose already implies a mirror — don't add mirror as background or prop",
    when: { poseStyle: ["mirror selfie pose"] },
    then: {
      remove: { background: ["modern bathroom with mirror"], props: ["mirror in background"] },
      force: { composition: "mirror selfie framing" },
    },
  },
  {
    id: "mirror_framing_implies_mirror_selfie",
    description: "Mirror selfie framing implies mirror selfie pose",
    when: { composition: ["mirror selfie framing"] },
    then: {
      remove: { background: ["modern bathroom with mirror"], props: ["mirror in background"] },
      force: { poseStyle: "mirror selfie pose" },
    },
  },
  {
    id: "lying_poses_need_surface",
    description: "Lying poses require a bed, floor, or horizontal surface — not standing backgrounds",
    when: { poseStyle: ["lying on bed pose", "lying on stomach pose", "missionary position", "face down ass up"] },
    then: {
      remove: { background: ["outdoor balcony", "staircase", "gym locker room", "office desk"] },
      suggest: { background: ["cozy bedroom with rumpled sheets and phone charger on nightstand", "hotel room bed", "luxury hotel suite"] },
    },
  },
  {
    id: "hair_spread_on_pillow_needs_lying",
    description: "Hair spread on pillow only makes sense when lying down",
    when: { hairState: ["hair spread on pillow"] },
    then: {
      force: { poseStyle: "lying on bed pose" },
      suggest: { props: ["pillows"] },
    },
  },
  {
    id: "shower_implies_wet",
    description: "Shower/bath backgrounds imply wet body and hair",
    when: { background: ["shower with glass door", "bathtub filled with water"] },
    then: {
      force: { wetness: "wet from shower" },
      suggest: { hairState: ["wet hair clinging to body"], skinCondition: ["sweaty glistening skin"] },
      remove: { outfit: ["schoolgirl skirt and unbuttoned top", "nurse costume", "maid outfit", "stockings and garter belt"] },
    },
  },
  {
    id: "pool_jacuzzi_implies_wet_swimwear",
    description: "Pool/jacuzzi settings imply water and swimwear",
    when: { background: ["jacuzzi hot tub", "pool side lounger"] },
    then: {
      suggest: { outfit: ["tiny bikini", "fully nude"], wetness: ["body covered in water droplets"] },
      remove: { outfit: ["stockings and garter belt", "schoolgirl skirt and unbuttoned top", "nurse costume", "maid outfit", "fishnet bodysuit"] },
    },
  },
  {
    id: "fully_nude_no_clothing_props",
    description: "Fully nude means no clothing-related actions",
    when: { outfit: ["fully nude"] },
    then: {
      remove: { action: ["taking off bra", "pulling down panties"], bodyPose: ["covering face shyly"] },
    },
  },
  {
    id: "car_backseat_constraints",
    description: "Car backseat limits poses and backgrounds",
    when: { background: ["car backseat"] },
    then: {
      remove: { poseStyle: ["lying on bed pose", "lying on stomach pose", "face down ass up", "splits pose", "legs behind head flexible"], props: ["rumpled white sheets", "pillows", "fairy lights string", "rose petals"] },
    },
  },
  {
    id: "crying_makeup_consistency",
    description: "Crying expressions should have running makeup, not clean makeup",
    when: { expression: ["sad teary eyes", "crying with mascara running"] },
    then: {
      force: { makeup: "wet smeared mascara running down cheeks" },
      suggest: { wetness: ["smeared makeup after crying"], skinCondition: ["flushed red cheeks"] },
    },
  },
  {
    id: "no_makeup_overrides_makeup_state",
    description: "No makeup means clean face — no running mascara or smudged lipstick",
    when: { makeup: ["no makeup fresh skin"] },
    then: {
      remove: { wetness: ["smeared makeup after crying"], expression: ["crying with mascara running"] },
    },
  },
  {
    id: "bed_head_needs_bed",
    description: "Bed head messy hair implies just woke up / in bed",
    when: { hairState: ["bed head messy"] },
    then: {
      suggest: { background: ["cozy bedroom with rumpled sheets and phone charger on nightstand", "hotel room bed"], props: ["rumpled white sheets", "pillows"] },
    },
  },
  {
    id: "hands_tied_limits_actions",
    description: "Hands tied behind back prevents hand-related actions",
    when: { bodyPose: ["hands tied behind back"] },
    then: {
      remove: { bodyPose: ["hands in hair", "hands on hips", "one hand on breast", "cupping breasts", "pushing breasts together", "spreading pussy with fingers", "grabbing own ass cheeks", "finger in mouth"], action: ["masturbating with fingers", "fingering pussy", "touching clit", "handjob POV", "anal fingering"] },
      suggest: { props: ["handcuffs"], accessories: ["collar with ring"] },
    },
  },
  {
    id: "pov_angles_camera_consistency",
    description: "POV first person angle implies rear camera / partner's perspective, not selfie",
    when: { cameraAngle: ["POV first person angle"] },
    then: {
      remove: { cameraDevice: ["front facing selfie camera"], poseStyle: ["mirror selfie pose"], composition: ["mirror selfie framing"] },
      force: { cameraDevice: "rear camera held by someone else" },
    },
  },
  {
    id: "selfie_camera_implies_selfie_angle",
    description: "Front facing selfie camera implies selfie-compatible angles",
    when: { cameraDevice: ["front facing selfie camera"] },
    then: {
      remove: { cameraAngle: ["over the shoulder angle", "POV first person angle"] },
    },
  },
  {
    id: "candle_light_needs_candles",
    description: "Candle light glow should have candles as props",
    when: { lighting: ["candle light warm glow"] },
    then: {
      force: { props: "candles" },
      suggest: { timeOfDay: ["nighttime indoor lighting", "late evening dim light"] },
    },
  },
  {
    id: "outdoor_no_indoor_lighting",
    description: "Outdoor backgrounds shouldn't have indoor-only lighting",
    when: { background: ["outdoor balcony", "pool side lounger"] },
    then: {
      remove: { lighting: ["moody dim bedroom lamp", "overhead ceiling light", "ring light glow", "candle light warm glow"], flash: ["phone flash on in dim room"] },
      suggest: { lighting: ["soft natural window light from side", "golden hour warm light"] },
    },
  },
  {
    id: "flash_implies_dim",
    description: "Phone flash implies dim environment",
    when: { flash: ["phone flash on in dim room"] },
    then: {
      remove: { timeOfDay: ["daylight through window", "sunset glow through curtains"] },
      suggest: { timeOfDay: ["nighttime indoor lighting", "late evening dim light"] },
    },
  },
  {
    id: "panties_down_no_pulling_action",
    description: "Panties already pulled down — don't also select the pulling action",
    when: { outfit: ["panties pulled down to thighs"] },
    then: {
      remove: { action: ["pulling down panties"] },
    },
  },
  {
    id: "towel_open_implies_shower",
    description: "Towel pulled open implies after shower context",
    when: { outfit: ["towel pulled open exposing body"] },
    then: {
      suggest: { background: ["modern bathroom with mirror"], hairState: ["wet hair clinging to body"], wetness: ["wet from shower"] },
    },
  },
  {
    id: "blowjob_forces_pov_kneeling",
    description: "Blowjob/deepthroat needs kneeling + POV angle + looking up",
    when: { action: ["blowjob POV", "deepthroat", "gagging drool"] },
    then: {
      force: { cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
      suggest: { poseStyle: ["kneeling pose"], expression: ["submissive looking up", "mouth slightly open"] },
      remove: { poseStyle: ["mirror selfie pose", "lying on bed pose", "lying on stomach pose", "standing pose", "seated on bed pose"], composition: ["mirror selfie framing"] },
    },
  },
  {
    id: "titfuck_forces_pov",
    description: "Titfuck needs pushing breasts together + POV from above",
    when: { action: ["titfuck POV"] },
    then: {
      force: { bodyPose: "pushing breasts together", cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
      remove: { poseStyle: ["mirror selfie pose", "standing pose"], composition: ["mirror selfie framing"] },
    },
  },
  {
    id: "missionary_forces_lying",
    description: "Missionary position needs lying on back with legs spread, hand on breast",
    when: { poseStyle: ["missionary position"] },
    then: {
      force: { cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
      suggest: { bodyPose: ["legs spread wide", "one hand on breast"], skinCondition: ["flushed red cheeks"], hairState: ["messy sex hair", "hair spread on pillow"], expression: ["pleasure face biting lip"] },
      remove: { background: ["outdoor balcony", "pool side lounger", "gym locker room", "office desk", "staircase"], poseStyle: ["mirror selfie pose"], composition: ["mirror selfie framing"] },
    },
  },
  {
    id: "reverse_cowgirl_forces_behind_view",
    description: "Reverse cowgirl shows back/ass from behind",
    when: { poseStyle: ["reverse cowgirl position"] },
    then: {
      force: { cameraDevice: "rear camera held by someone else" },
      suggest: { bodyPose: ["arched back", "looking over shoulder"], skinCondition: ["flushed red cheeks"] },
      remove: { composition: ["mirror selfie framing"], poseStyle: ["mirror selfie pose"] },
    },
  },
  {
    id: "doggy_forces_behind_angle",
    description: "Doggy style needs POV from behind, girl looking back",
    when: { poseStyle: ["doggy style pose"] },
    then: {
      force: { cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
      suggest: { bodyPose: ["arched back", "looking over shoulder", "gripping bed sheets"], skinCondition: ["flushed red cheeks"], hairState: ["messy sex hair"], expression: ["pleasure face biting lip"] },
      remove: { composition: ["mirror selfie framing"], poseStyle: ["mirror selfie pose"], background: ["outdoor balcony", "pool side lounger", "staircase"] },
    },
  },
  {
    id: "prone_bone_forces_lying_stomach",
    description: "Prone bone is face-down on bed",
    when: { poseStyle: ["prone bone position"] },
    then: {
      force: { cameraDevice: "rear camera held by someone else" },
      suggest: { bodyPose: ["arched back"], hairState: ["messy sex hair"], skinCondition: ["flushed red cheeks"] },
      remove: { composition: ["mirror selfie framing"], poseStyle: ["mirror selfie pose"], background: ["outdoor balcony", "pool side lounger", "staircase", "gym locker room"] },
    },
  },
];

function applyConstraints(selections) {
  const result = { ...selections };
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 5) {
    changed = false;
    iterations++;

    for (const rule of LOGICAL_CONSTRAINTS) {
      const triggered = Object.entries(rule.when).some(([key, values]) =>
        values.includes(result[key])
      );

      if (!triggered) continue;

      if (rule.then.remove) {
        for (const [key, blockedValues] of Object.entries(rule.then.remove)) {
          if (blockedValues.includes(result[key])) {
            result[key] = "";
            changed = true;
          }
        }
      }

      if (rule.then.force) {
        for (const [key, forcedValue] of Object.entries(rule.then.force)) {
          if (result[key] !== forcedValue) {
            result[key] = forcedValue;
            changed = true;
          }
        }
      }
    }
  }

  return result;
}

function getBlockedOptions(selections) {
  const blocked = {};

  for (const rule of LOGICAL_CONSTRAINTS) {
    const triggered = Object.entries(rule.when).some(([key, values]) =>
      values.includes(selections[key])
    );
    if (!triggered) continue;

    if (rule.then.remove) {
      for (const [key, values] of Object.entries(rule.then.remove)) {
        if (!blocked[key]) blocked[key] = new Set();
        values.forEach(v => blocked[key].add(v));
      }
    }
  }

  const result = {};
  for (const [key, valueSet] of Object.entries(blocked)) {
    result[key] = [...valueSet];
  }
  return result;
}

function buildConstraintRulesText(lockedList = []) {
  return LOGICAL_CONSTRAINTS
    .filter(rule => {
      const allKeys = [...Object.keys(rule.when), ...Object.keys(rule.then.remove || {}), ...Object.keys(rule.then.force || {}), ...Object.keys(rule.then.suggest || {})];
      return !allKeys.every(k => lockedList.includes(k));
    })
    .map(rule => `- ${rule.description}`)
    .join("\n");
}

// Canonical selector options (server-side source of truth)
const CANONICAL_OPTIONS = {
  hairColor: ["blonde hair", "brunette hair", "black hair", "red hair", "pink hair", "platinum blonde hair", "auburn hair", "silver hair", "white hair"],
  hairType: ["long straight hair", "long wavy hair", "long curly hair", "short straight hair", "short curly hair", "medium length hair", "ponytail", "braided hair", "messy bun", "hair down over shoulders", "pigtails", "twin braids", "half up half down", "wet slicked back hair"],
  skinTone: ["pale white skin", "fair skin", "lightly tanned skin", "tanned skin", "olive skin", "dark skin", "sun-kissed skin"],
  eyeColor: ["blue eyes", "green eyes", "brown eyes", "hazel eyes", "grey eyes", "dark brown eyes"],
  lipSize: ["thin lips", "medium lips", "full lips", "plump lips"],
  breastSize: ["small perky breasts", "medium sized breasts", "large breasts", "huge breasts"],
  bodyType: ["slim body", "athletic body", "curvy body", "petite body", "thick body", "slim sporty body", "muscular body"],
  makeup: ["no makeup fresh skin", "natural soft makeup", "glam makeup with eyeliner and gloss", "smoky eye makeup matte lips", "red lipstick", "nude lip gloss", "wet smeared mascara running down cheeks", "smudged lipstick", "mascara tears streaking down face", "runny eyeliner after crying", "glossy wet lips"],
  expression: ["soft smile", "seductive gaze", "serious expression", "playful expression", "eyes closed blissful expression", "biting lower lip", "mouth slightly open", "looking away shyly", "sad teary eyes", "crying with mascara running", "moaning face eyes half closed", "pleasure face biting lip", "gagging expression watery eyes", "exhausted satisfied look", "submissive looking up", "surprised wide eyes open mouth", "bratty smirk", "innocent doe eyes"],
  skinCondition: ["sweaty glistening skin", "oiled shiny skin", "goosebumps on skin", "flushed red cheeks", "hickeys on neck", "tan lines visible", "freckles on face and shoulders"],
  nailsColor: ["red nail polish", "black nail polish", "white nail polish", "pink nail polish", "french tip nails", "nude nail polish", "no nail polish natural nails"],
  nailsLength: ["short neat nails", "medium length nails", "long stiletto nails", "long almond nails", "glossy finish nails", "matte finish nails"],
  accessories: ["choker necklace", "belly button piercing", "nipple piercings", "tongue piercing", "hoop earrings", "ankle bracelet", "thin gold chain necklace", "collar with ring", "glasses on face", "no jewelry"],
  outfit: ["fully nude", "panties pulled down to thighs", "sports bra pulled up exposing breasts", "red lingerie set", "black lingerie set", "white lingerie set", "tiny bikini", "lace bodysuit", "oversized t-shirt no pants", "crop top and thong", "sheer see-through top", "tank top and shorts", "bra and panties", "stockings and garter belt", "fishnet bodysuit", "schoolgirl skirt and unbuttoned top", "nurse costume", "maid outfit", "wet white t-shirt see-through", "ripped clothes half torn off", "only wearing thigh-high socks", "towel pulled open exposing body"],
  poseStyle: ["mirror selfie pose", "standing pose", "seated on bed pose", "kneeling pose", "lying on bed pose", "lying on stomach pose", "doggy style pose", "squatting pose", "leaning forward pose", "on all fours", "bent over", "missionary position", "face down ass up", "splits pose", "legs behind head flexible", "reverse cowgirl position", "prone bone position", "standing bent over"],
  bodyPose: ["arched back", "hip popped to the side", "legs crossed", "legs spread wide", "hands in hair", "hands on hips", "one hand on breast", "looking over shoulder", "turned away showing ass", "spreading pussy with fingers", "grabbing own ass cheeks", "cupping breasts", "finger in mouth", "hands tied behind back", "covering face shyly", "pushing breasts together", "gripping bed sheets", "legs wrapped up", "biting finger", "hands above head"],
  action: ["masturbating with fingers", "using vibrator", "using dildo", "inserting dildo", "sucking dildo", "riding dildo", "fingering pussy", "touching clit", "anal fingering", "blowjob POV", "deepthroat", "handjob POV", "titfuck POV", "licking lips seductively", "taking off bra", "pulling down panties", "spreading ass cheeks", "tongue out playful", "gagging drool"],
  fluids: ["cum on face", "cum on tits", "cum on stomach", "cum on ass", "cum dripping from mouth", "cum on thighs", "cum on back", "creampie dripping", "drool dripping from mouth", "spit on chest", "covered in cum facial"],
  wetness: ["wet hair dripping", "body covered in water droplets", "oiled up body glistening", "sweaty after sex", "wet from shower", "saliva strings", "messy hair after sex", "smeared makeup after crying"],
  hairState: ["messy sex hair", "hair stuck to sweaty face", "hair pulled back in fist", "hair covering one eye", "wet hair clinging to body", "bed head messy", "hair spread on pillow"],
  cameraDevice: ["shot on iPhone 15 Pro", "shot on iPhone 14", "shot on Samsung Galaxy S24 Ultra", "front facing selfie camera", "rear camera held by someone else"],
  cameraAngle: ["eye-level angle", "low angle shot", "high angle shot looking down", "overhead selfie angle", "over the shoulder angle", "POV first person angle"],
  shotType: ["tight close-up", "mid-shot waist up", "full body shot", "wide shot with environment"],
  composition: ["centered framing", "rule of thirds framing", "mirror selfie framing", "candid snapshot framing", "slightly tilted casual angle"],
  focus: ["focus on face", "focus on breasts", "focus on ass", "focus on pussy close-up", "focus on feet", "focus on lips", "focus on eyes", "focus on full body", "focus on hands and nails", "focus on stomach and hips"],
  background: ["cozy bedroom with rumpled sheets and phone charger on nightstand", "modern bathroom with mirror", "dim bedroom with fairy lights", "living room couch", "hotel room bed", "outdoor balcony", "kitchen counter", "car backseat", "shower with glass door", "bathtub filled with water", "gym locker room", "dorm room messy", "luxury hotel suite", "jacuzzi hot tub", "pool side lounger", "office desk", "staircase"],
  props: ["rumpled white sheets", "pillows", "fairy lights string", "candles", "wine glass", "phone on bed", "clothes on floor", "mirror in background", "rose petals", "sex toys on nightstand", "handcuffs", "blindfold", "collar and leash", "lollipop", "whipped cream", "ice cubes", "towel on floor", "condom wrapper on bed"],
  lighting: ["flat overhead ceiling light", "natural window daylight", "dim room phone flash only", "overhead fluorescent light", "harsh bathroom light"],
  flash: ["phone flash on harsh frontal light", "no flash natural light only"],
  timeOfDay: ["daylight through window", "nighttime indoor lighting", "late evening dim light", "sunset glow through curtains"],
  colorMood: ["warm tones", "cool tones", "neutral tones", "vibrant neon colors", "muted desaturated tones", "soft pink tones"],
};

// ============================================
// AUTO-SELECT: AI picks matching chips from scene description
// POST /api/nsfw/auto-select
// Body: { description, modelId }
// ============================================
async function runNsfwAutoSelectSelections(userId, modelId, description) {
  const model = await prisma.savedModel.findFirst({ where: { id: modelId, userId } });
  if (!model) {
    throw new Error("Model not found");
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    throw new Error("AI not configured");
  }

  let lockedList = [];
  if (model.activeLoraId) {
    const activeLora = await prisma.trainedLora.findUnique({ where: { id: model.activeLoraId } });
    if (activeLora?.defaultAppearance) {
      lockedList = Object.keys(activeLora.defaultAppearance).filter(k => activeLora.defaultAppearance[k]);
    }
  }

  const optionsDescription = Object.entries(CANONICAL_OPTIONS)
    .filter(([key]) => !lockedList.includes(key))
    .map(([key, values]) => `"${key}": [${values.map(v => `"${v}"`).join(", ")}]`)
    .join("\n");

  const systemPrompt = `You are a smart assistant that reads a user's scene description and picks the BEST matching options from predefined selector lists.

SCENE DESCRIPTION: "${description}"

AVAILABLE SELECTOR OPTIONS (pick AT MOST one value per key, only if relevant to the scene):
${optionsDescription}

LOGICAL CONSTRAINTS (you MUST respect these — violating them produces broken images):
${buildConstraintRulesText(lockedList)}

RULES:
1. Match the user's description ACCURATELY. Only pick options that are clearly stated or directly implied. Do NOT infer explicit or sexual details from vague preset names (e.g. "bed selfie" means a casual selfie in bed — do not add topless/nude/rumpled sheets unless the description says so).
2. Return ONLY a JSON object mapping keys to the selected option value.
3. Do NOT pick options for keys that have no relevance to the description. Less is better than wrong.
4. The values MUST be exact strings from the provided options lists. Do not paraphrase or modify them.
5. Do NOT include any keys listed here (they are locked): ${lockedList.length > 0 ? lockedList.join(", ") : "none"}
6. THINK about logical consistency BEFORE outputting. Ask yourself: "Do these options make sense together in the same scene?" If not, fix conflicts.
7. Do NOT auto-add "sweaty glistening skin", "wet smeared mascara running down cheeks", or running makeup for blowjob/oral scenes unless the user EXPLICITLY asks for it. Blowjobs should default to clean, natural skin.
8. Return ONLY valid JSON. No explanation, no markdown, no extra text.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "x-ai/grok-4.1-fast",
      max_tokens: 1024,
      messages: [{ role: "user", content: systemPrompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Grok auto-select error:", errorText);
    throw new Error("AI auto-select failed");
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content || "{}";
  const content = rawContent.includes("<think>")
    ? rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    : rawContent;

  let selections = {};
  try {
    const cleaned = content.replace(/```json\s*|```\s*/g, "").trim();
    selections = JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse auto-select response:", content);
    throw new Error("AI returned invalid response");
  }

  const validated = {};
  for (const [key, value] of Object.entries(selections)) {
    if (lockedList.includes(key)) continue;
    if (CANONICAL_OPTIONS[key] && CANONICAL_OPTIONS[key].includes(value)) {
      validated[key] = value;
    }
  }

  const constrained = applyConstraints(validated);
  for (const key of Object.keys(constrained)) {
    if (lockedList.includes(key)) delete constrained[key];
    if (!constrained[key]) delete constrained[key];
  }

  console.log(`✅ Auto-select: "${description.substring(0, 50)}..." → ${Object.keys(constrained).length} chips selected (constraints applied)`);

  return constrained;
}

export async function autoSelectChips(req, res) {
  try {
    const { description, modelId } = req.body;
    const userId = req.user.userId;

    if (!description || typeof description !== "string" || description.length > 500) {
      return res.status(400).json({ success: false, message: "Description is required (max 500 chars)" });
    }

    if (!modelId) {
      return res.status(400).json({ success: false, message: "Model ID is required" });
    }

    const constrained = await runNsfwAutoSelectSelections(userId, modelId, description);
    res.json({ success: true, selections: constrained });
  } catch (error) {
    console.error("Auto-select error:", error);
    const msg = error?.message || "Failed to auto-select";
    if (msg === "Model not found") {
      return res.status(404).json({ success: false, message: msg });
    }
    if (msg === "AI not configured") {
      return res.status(500).json({ success: false, message: msg });
    }
    res.status(500).json({ success: false, message: msg });
  }
}

// ============================================
// PLAN: auto-select chips + generate prompt in one step (simple flow)
// POST /api/nsfw/plan-generation
// Body: { modelId, userRequest }
// ============================================
export async function planNsfwGeneration(req, res) {
  try {
    const userId = req.user.userId;
    const { modelId, userRequest } = req.body;

    if (!modelId || !userRequest || typeof userRequest !== "string" || !userRequest.trim()) {
      return res.status(400).json({
        success: false,
        message: "Model ID and scene description are required",
      });
    }

    const desc = userRequest.trim().slice(0, 500);

    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
    });
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    const selections = await runNsfwAutoSelectSelections(userId, modelId, desc);
    const attrsStr = Object.values(selections).filter(Boolean).join(", ");
    const prompt = await runNsfwPromptGenerationForModel(model, desc, selections, attrsStr);

    res.json({
      success: true,
      selections,
      prompt,
      sceneDescription: desc,
    });
  } catch (error) {
    console.error("planNsfwGeneration error:", error);
    const msg = error?.message || "Failed to plan generation";
    if (msg === "Model not found") {
      return res.status(404).json({ success: false, message: msg });
    }
    res.status(500).json({ success: false, message: msg });
  }
}

// ============================================
// Test endpoints (unchanged)
// ============================================
export async function testFaceRefGeneration(req, res) {
  try {
    const userId = req.user.userId;
    const { modelId, prompt, loraStrength = 0.7, nsfwStrength = 0.3 } = req.body;

    if (!modelId || !prompt) {
      return res.status(400).json({ success: false, message: "Model ID and prompt required" });
    }

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model || model.userId !== userId) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    if (!model.loraUrl) {
      return res.status(400).json({ success: false, message: "Model has no LoRA trained" });
    }

    const FAL_API_KEY = process.env.FAL_API_KEY;
    const requestBody = {
      "Model Lora URL": model.loraUrl,
      "Model LORA strenght": loraStrength,
      Prompt: prompt,
      "Img Width": 1024,
      "Img Height": 1024,
      "Num Images": 1,
      "Inference Steps": 100,
      "Guidance Scale (CFG)": 2.5,
      "NSFW strenght": nsfwStrength,
    };

    console.log("📸 Test face ref generation:", { modelId, prompt: prompt.substring(0, 50) });

    const response = await fetch("https://queue.fal.run/fal-ai/flux-pro-finetuned-v1", {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      return res.status(500).json({ success: false, message: "Failed to submit test generation" });
    }

    const result = await response.json();
    return res.json({ success: true, requestId: result.request_id });
  } catch (error) {
    console.error("Test face ref error:", error);
    return res.status(500).json({ success: false, message: getSafeErrorMessage(error, "Test generation failed") });
  }
}

export async function testFaceRefStatus(req, res) {
  try {
    const { requestId } = req.params;
    const FAL_API_KEY = process.env.FAL_API_KEY;

    const response = await fetch(
      `https://queue.fal.run/fal-ai/flux-pro-finetuned-v1/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${FAL_API_KEY}` } },
    );

    if (!response.ok) {
      return res.status(500).json({ success: false, message: "Failed to check status" });
    }

    const statusData = await response.json();

    if (statusData.status === "COMPLETED") {
      const resultRes = await fetch(
        `https://queue.fal.run/fal-ai/flux-pro-finetuned-v1/requests/${requestId}`,
        { headers: { Authorization: `Key ${FAL_API_KEY}` } },
      );
      const resultData = await resultRes.json();
      const outputUrl = resultData.images?.[0]?.url || resultData.output?.images?.[0]?.url;

      return res.json({ status: "COMPLETED", outputUrl });
    }

    return res.json({ status: statusData.status });
  } catch (error) {
    console.error("Test face ref status error:", error);
    return res.status(500).json({ success: false, message: getSafeErrorMessage(error, "Failed to check status") });
  }
}

// ============================================
// Advanced NSFW Generation (unchanged)
// ============================================
export async function generateAdvancedNsfw(req, res) {
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const {
      modelId,
      model = "nano-banana",
      prompt,
      referencePhotos = [],
      aspectRatio = "1024x1024",
    } = req.body;
    userId = req.user.userId;

    console.log("\n🎯 ADVANCED NSFW GENERATION");
    console.log("Model:", model);
    console.log("Prompt:", prompt?.substring(0, 100));
    console.log("Reference photos:", referencePhotos.length);

    if (!modelId || !prompt) {
      return res.status(400).json({ success: false, message: "Model ID and prompt are required" });
    }

    const savedModel = await prisma.savedModel.findUnique({ where: { id: modelId } });

    if (!savedModel) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (savedModel.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (!savedModel.isAIGenerated && !savedModel.nsfwOverride) {
      return res.status(403).json({
        success: false,
        message: "NSFW generation is only available for verified models.",
      });
    }

    if (referencePhotos.length > 0) {
      const refCheck = validateImageUrls(referencePhotos);
      if (!refCheck.valid) {
        return res.status(400).json({ success: false, message: refCheck.message });
      }
    }

    const user = await checkAndExpireCredits(userId);
    const userCredits = getTotalCredits(user);
    const creditCost = model === "nano-banana" ? 30 : 20;

    if (userCredits < creditCost) {
      return res.status(403).json({
        success: false,
        message: `Not enough credits. Need ${creditCost}, have ${userCredits}`,
      });
    }

    await deductCredits(userId, creditCost);
    creditsDeducted = creditCost;

    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId,
        type: "nsfw",
        status: "processing",
        creditsCost: creditCost,
        prompt: prompt.trim(),
        isNsfw: true,
      },
    });
    generationId = generation.id;

    let identityImages = [];
    if (referencePhotos.length > 0) {
      identityImages = referencePhotos;
    } else {
      identityImages = [savedModel.photo1Url, savedModel.photo2Url, savedModel.photo3Url].filter(Boolean);
    }

    console.log("Using identity images:", identityImages.length);

    let result;
    // Normalize WaveSpeed-style "1024x1024" to kie.ai aspect ratio "1:1"
    const kieAspectRatio = aspectRatio === "1024x1024" ? "1:1" : aspectRatio;

    if (model === "seedream") {
      console.log("Using Seedream V4.5 Edit via WaveSpeed");
      result = await generateImageWithSeedreamWaveSpeed(identityImages, prompt, {
        aspectRatio: kieAspectRatio,
        onTaskCreated: async (taskId) => {
          await prisma.generation.update({
            where: { id: generationId },
            data: { replicateModel: `wavespeed-seedream:${taskId}` },
          });
        },
      });
    } else {
      console.log("Using Nano Banana Pro via kie.ai");
      result = await generateImageWithNanoBananaKie(identityImages, prompt, {
        aspectRatio: kieAspectRatio,
        resolution: "2k",
        onTaskCreated: async (taskId) => {
          await prisma.generation.update({
            where: { id: generationId },
            data: { replicateModel: `kie-task:${taskId}` },
          });
          await prisma.kieTask.upsert({
            where: { taskId },
            update: {
              entityType: "generation",
              entityId: generationId,
              step: "final",
              userId,
              status: "processing",
              payload: { type: "nsfw" },
              errorMessage: null,
              outputUrl: null,
              completedAt: null,
            },
            create: {
              taskId,
              provider: "kie",
              entityType: "generation",
              entityId: generationId,
              step: "final",
              userId,
              status: "processing",
              payload: { type: "nsfw" },
            },
          });
        },
      });
    }

    if (result?.success && result?.deferred && result?.taskId) {
      await prisma.generation.update({
        where: { id: generationId },
        data: { replicateModel: model === "seedream" ? `wavespeed-seedream:${result.taskId}` : `kie-task:${result.taskId}` },
      });
      if (model !== "seedream") {
        await prisma.kieTask.upsert({
          where: { taskId: result.taskId },
          update: {
            entityType: "generation",
            entityId: generationId,
            step: "final",
            userId,
            status: "processing",
            payload: { type: "nsfw" },
            errorMessage: null,
            outputUrl: null,
            completedAt: null,
          },
          create: {
            taskId: result.taskId,
            provider: "kie",
            entityType: "generation",
            entityId: generationId,
            step: "final",
            userId,
            status: "processing",
            payload: { type: "nsfw" },
          },
        });
      }
      return res.json({
        success: true,
        generation: { id: generationId, status: "processing" },
        creditsUsed: creditCost,
        message: "Generation started; result will appear when ready.",
      });
    }

    if (!result?.success || !result?.outputUrl) {
      throw new Error(result?.error || "Generation failed - no output URL");
    }

    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "completed", outputUrl: result.outputUrl, completedAt: new Date() },
    });

    console.log("Advanced NSFW generation completed:", result.outputUrl);

    return res.json({
      success: true,
      generation: {
        id: generationId,
        outputUrl: result.outputUrl,
        status: "completed",
      },
      creditsUsed: creditCost,
    });
  } catch (error) {
    console.error("❌ Advanced NSFW generation error:", error.message);

    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          await refundGeneration(generationId);
        } else {
          await refundCredits(userId, creditsDeducted);
        }
        console.log("💰 Refunded", creditsDeducted, "credits");
      } catch (refundError) {
        console.error("Refund error:", refundError.message);
      }
    }

    if (generationId) {
      try {
        await prisma.generation.update({
          where: { id: generationId },
          data: { status: "failed", errorMessage: getErrorMessageForDb(error.message), completedAt: new Date() },
        });
      } catch (dbErr) {
        console.error("⚠️ Failed to update NSFW generation to failed:", dbErr.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Generation failed",
    });
  }
}

const CREDITS_NSFW_VIDEO_5S = 50;
const CREDITS_NSFW_VIDEO_8S = 80;

export async function generateNsfwVideoFromImage(req, res) {
  let creditsDeducted = 0;
  let generationId = null;

  try {
    const { modelId, imageUrl, prompt, duration } = req.body;
    const userId = req.user.userId;

    if (!modelId || !imageUrl) {
      return res.status(400).json({ success: false, message: "Model ID and image URL are required" });
    }

    const nsfwImgCheck = validateImageUrl(imageUrl);
    if (!nsfwImgCheck.valid) {
      return res.status(400).json({ success: false, message: nsfwImgCheck.message });
    }

    const videoDuration = duration === 8 ? 8 : 5;
    const creditsNeeded = videoDuration === 8 ? CREDITS_NSFW_VIDEO_8S : CREDITS_NSFW_VIDEO_5S;

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model || model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    let validImage = await prisma.generation.findFirst({
      where: {
        userId,
        modelId,
        outputUrl: imageUrl,
        status: "completed",
        type: { in: ["nsfw", "prompt-image", "image", "face-swap-image"] },
      },
    });

    if (!validImage) {
      validImage = await prisma.generation.findFirst({
        where: {
          userId,
          modelId,
          outputUrl: { contains: imageUrl },
          status: "completed",
          type: { in: ["nsfw", "prompt-image", "image", "face-swap-image"] },
        },
      });
    }

    if (!validImage) {
      return res.status(403).json({ success: false, message: "Image must be from your NSFW gallery" });
    }

    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for ${videoDuration}s video. You have ${totalCredits} credits.`,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    const basePrompt = prompt || "cinematic motion, natural movement, high quality";
    const videoPrompt = `${basePrompt}. Natural pose energy, subtle weight shift, dynamic feel.`;

    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId,
        type: "nsfw-video",
        prompt: videoPrompt,
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: null,
        isNsfw: true,
        inputImageUrl: JSON.stringify({ sourceImage: imageUrl, duration: videoDuration }),
      },
    });
    generationId = generation.id;

    const submission = await submitNsfwVideo(imageUrl, videoPrompt, { duration: videoDuration });

    if (!submission.success) {
      await refundGeneration(generation.id);
      await prisma.generation.update({
        where: { id: generation.id },
        data: { status: "failed", errorMessage: getErrorMessageForDb(submission.error) },
      });
      return res.status(500).json({ success: false, message: "Video generation failed" });
    }

    if (submission.seed) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          inputImageUrl: JSON.stringify({ sourceImage: imageUrl, duration: videoDuration, seed: submission.seed }),
        },
      });
    }

    await prisma.generation.update({
      where: { id: generation.id },
      data: { replicateModel: submission.requestId },
    });

    console.log(`🎬 NSFW video submitted: ${generation.id} | WaveSpeed: ${submission.requestId} | ${videoDuration}s | ${creditsNeeded} credits`);

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

    return res.json({
      success: true,
      generationId: generation.id,
      creditsUsed: creditsNeeded,
      creditsRemaining: getTotalCredits(updatedUser),
      duration: videoDuration,
    });
  } catch (error) {
    console.error("❌ NSFW video generation error:", error);
    try {
      if (creditsDeducted > 0 && generationId) {
        await refundGeneration(generationId);
      } else if (creditsDeducted > 0) {
        await refundCredits(req.user.userId, creditsDeducted);
      }
    } catch (refundErr) {
      console.error("🚨 CRITICAL: NSFW video refund failed:", refundErr.message);
    }
    return res.status(500).json({ success: false, message: "Video generation failed" });
  }
}

const CREDITS_VIDEO_EXTEND_5S = 50;
const CREDITS_VIDEO_EXTEND_8S = 80;

export async function extendNsfwVideo(req, res) {
  let creditsDeducted = 0;
  let generationId = null;

  try {
    const { generationId: sourceGenId, duration, prompt } = req.body;
    const userId = req.user.userId;

    if (!sourceGenId) {
      return res.status(400).json({ success: false, message: "Source generation ID is required" });
    }

    const extendDuration = duration === 8 ? 8 : 5;
    const creditsNeeded = extendDuration === 8 ? CREDITS_VIDEO_EXTEND_8S : CREDITS_VIDEO_EXTEND_5S;

    const sourceGen = await prisma.generation.findUnique({ where: { id: sourceGenId } });
    if (!sourceGen || sourceGen.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized or generation not found" });
    }

    if (!sourceGen.outputUrl || sourceGen.status !== "completed") {
      return res.status(400).json({ success: false, message: "Source video must be completed" });
    }

    if (!["nsfw-video", "nsfw-video-extend"].includes(sourceGen.type)) {
      return res.status(400).json({ success: false, message: "Can only extend NSFW videos" });
    }

    const videoUrl = sourceGen.outputUrl;

    let sourceSeed = null;
    try {
      const sourceData = JSON.parse(sourceGen.inputImageUrl || "{}");
      sourceSeed = sourceData.seed || null;
      if (!sourceSeed && sourceData.sourceGenerationId) {
        const originalGen = await prisma.generation.findUnique({ where: { id: sourceData.sourceGenerationId } });
        if (originalGen?.inputImageUrl) {
          const originalData = JSON.parse(originalGen.inputImageUrl || "{}");
          sourceSeed = originalData.seed || null;
        }
      }
    } catch (e) {}

    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for ${extendDuration}s extension. You have ${totalCredits} credits.`,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    const baseExtendPrompt = prompt || sourceGen.prompt || "continue the motion naturally, smooth transition";
    const videoPrompt = `${baseExtendPrompt}. Natural pose energy, subtle weight shift, dynamic feel.`;

    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId: sourceGen.modelId,
        type: "nsfw-video-extend",
        prompt: videoPrompt,
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: null,
        isNsfw: true,
        inputImageUrl: JSON.stringify({
          sourceVideoUrl: videoUrl,
          sourceGenerationId: sourceGenId,
          extendDuration: extendDuration,
          seed: sourceSeed,
        }),
      },
    });
    generationId = generation.id;

    const submission = await submitNsfwVideoExtend(videoUrl, videoPrompt, { duration: extendDuration, seed: sourceSeed });

    if (!submission.success) {
      await refundGeneration(generation.id);
      creditsDeducted = 0;
      await prisma.generation.update({
        where: { id: generation.id },
        data: { status: "failed", errorMessage: getErrorMessageForDb(submission.error) },
      });
      return res.status(500).json({ success: false, message: "Video extension failed" });
    }

    await prisma.generation.update({
      where: { id: generation.id },
      data: { replicateModel: submission.requestId },
    });

    console.log(`🎬 NSFW video extend submitted: ${generation.id} | WaveSpeed: ${submission.requestId} | +${extendDuration}s | ${creditsNeeded} credits`);

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

    return res.json({
      success: true,
      generationId: generation.id,
      creditsUsed: creditsNeeded,
      creditsRemaining: getTotalCredits(updatedUser),
      extendDuration,
    });
  } catch (error) {
    console.error("❌ NSFW video extend error:", error);
    if (creditsDeducted > 0) {
      if (generationId) {
        try { await refundGeneration(generationId); } catch (e) { console.error("Refund via generation failed:", e.message); }
      } else {
        try { await refundCredits(req.user.userId, creditsDeducted); } catch (e) { console.error("Direct refund failed:", e.message); }
      }
    }
    return res.status(500).json({ success: false, message: "Video extension failed" });
  }
}

export default {
  createLora,
  getModelLoras,
  setActiveLora,
  deleteLora,
  initializeTrainingSession,
  generateTrainingImages,
  startTrainingSession,
  regenerateTrainingImage,
  assignTrainingImages,
  getTrainingImages,
  trainLora,
  getLoraTrainingStatus,
  generateNsfwImage,
  generateNudesPack,
  generateNsfwPrompt,
  planNsfwGeneration,
  generateAdvancedNsfw,
  testFaceRefGeneration,
  testFaceRefStatus,
  recoverStuckNsfwGenerations,
  startNsfwPoller,
  generateNsfwVideoFromImage,
  extendNsfwVideo,
};

let nsfwPollerInterval = null;
let nsfwPollerRunning = false;

async function pollProcessingNsfwGenerations() {
  if (nsfwPollerRunning) return;
  nsfwPollerRunning = true;

  try {
    const processingGens = await prisma.generation.findMany({
      where: {
        status: { in: ['processing', 'pending'] },
        type: 'nsfw',
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (processingGens.length === 0) {
      nsfwPollerRunning = false;
      return;
    }

    console.log(`\n🔄 [NSFW Poller] Checking ${processingGens.length} processing generation(s)`);

    for (const gen of processingGens) {
      await pollSingleNsfwGeneration(gen);
    }
  } catch (error) {
    console.error('❌ [NSFW Poller] Error:', error.message);
  }

  nsfwPollerRunning = false;
}

async function pollSingleNsfwGeneration(gen) {
  let inputData;
  try {
    inputData = typeof gen.inputImageUrl === 'string' ? JSON.parse(gen.inputImageUrl) : gen.inputImageUrl;
  } catch {
    inputData = {};
  }

  if (inputData?.mode === 'img2img') {
    return;
  }

  const requestId = inputData?.comfyuiPromptId || inputData?.runcomfyRequestId;
  if (!requestId) {
    const age = Date.now() - new Date(gen.createdAt).getTime();
    if (age > 20 * 60 * 1000) {
      try {
        await refundGeneration(gen.id);
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: 'failed', errorMessage: getErrorMessageForDb('No ComfyUI prompt ID found'), completedAt: new Date() },
        });
        console.log(`  ⚠️ ${gen.id.substring(0,8)} - no requestId, refunded & failed`);
      } catch (e) {
        console.error(`  ⚠️ ${gen.id.substring(0,8)} - no-requestId cleanup error:`, e.message);
      }
    }
    return;
  }

  try {
    const status = await checkNsfwGenerationStatus(requestId);

    if (status.status === 'COMPLETED') {
      const result = await getNsfwGenerationResult(requestId, status._runpodOutput);
      if (result.outputUrls && result.outputUrls.length > 0) {
        let permanentUrls = result.outputUrls;

        const faceReferenceUrl = inputData?.faceReferenceUrl;
        if (faceReferenceUrl) {
          console.log(`  🔄 Face-swapping ${permanentUrls.length} images for ${gen.id.substring(0,8)}...`);
          const swappedUrls = [];
          for (const imgUrl of permanentUrls) {
            try {
              const swapResult = await faceSwapWithFal(imgUrl, faceReferenceUrl);
              swappedUrls.push(swapResult.success && swapResult.outputUrl ? swapResult.outputUrl : imgUrl);
            } catch {
              swappedUrls.push(imgUrl);
            }
          }
          permanentUrls = swappedUrls;
        }

        const outputUrlValue = permanentUrls.length === 1 ? permanentUrls[0] : JSON.stringify(permanentUrls);
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: 'completed', outputUrl: outputUrlValue, completedAt: new Date() },
        });
        console.log(`  ✅ ${gen.id.substring(0,8)} COMPLETED - ${permanentUrls.length} image(s) archived to R2`);
        if (gen.userId && gen.modelId) {
          cleanupOldGenerations(gen.userId, gen.modelId).catch(() => {});
        }
      }
    } else if (status.status === 'FAILED') {
      try {
        await refundGeneration(gen.id);
      } catch (e) {
        console.error(`  ❌ ${gen.id.substring(0,8)} refund error on FAILED:`, e.message);
      }
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: 'failed', errorMessage: getErrorMessageForDb(status.error || 'Generation failed on ComfyUI'), completedAt: new Date() },
      }).catch(() => {});
      console.log(`  ❌ ${gen.id.substring(0,8)} FAILED: ${status.error || 'ComfyUI error'}, credits refunded`);
    } else {
      const age = Math.round((Date.now() - new Date(gen.createdAt).getTime()) / 1000);
      console.log(`  ⏳ ${gen.id.substring(0,8)} still ${status.status} (${age}s old)`);
      if (age > 30 * 60) {
        try {
          await refundGeneration(gen.id);
        } catch (e) {
          console.error(`  ⏰ ${gen.id.substring(0,8)} refund error on TIMEOUT:`, e.message);
        }
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: 'failed', errorMessage: getErrorMessageForDb('Generation timed out (30 min)'), completedAt: new Date() },
        }).catch(() => {});
        console.log(`  ⏰ ${gen.id.substring(0,8)} TIMED OUT after ${age}s, credits refunded`);
      }
    }
  } catch (error) {
    console.error(`  ❌ Poll error for ${gen.id.substring(0,8)}: ${error.message}`);
  }
}

function startNsfwPoller() {
  if (nsfwPollerInterval) return;
  console.log('🚀 Starting continuous NSFW generation poller (every 30s, one at a time)...');
  pollProcessingNsfwGenerations();
  nsfwPollerInterval = setInterval(pollProcessingNsfwGenerations, 30000);
}

async function recoverStuckNsfwGenerations() {
  await pollProcessingNsfwGenerations();
  startNsfwPoller();
}

export async function saveAppearance(req, res) {
  try {
    const { modelId, appearance } = req.body;
    const userId = req.user.userId;

    if (!modelId) {
      return res.status(400).json({ success: false, message: "Model ID is required" });
    }

    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
    });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    let sanitized = {};
    if (appearance && typeof appearance === "object") {
      for (const key of APPEARANCE_VALID_KEYS) {
        const v = appearance[key];
        if (v != null && typeof v === "string" && v.trim()) {
          sanitized[key] = v.trim();
        }
      }
    }

    await prisma.savedModel.update({
      where: { id: modelId },
      data: { savedAppearance: Object.keys(sanitized).length > 0 ? sanitized : null },
    });

    console.log(`✅ Saved appearance for model ${modelId}: ${Object.keys(sanitized).length} fields`);
    return res.json({ success: true, savedAppearance: sanitized });
  } catch (error) {
    console.error("Error saving appearance:", error);
    return res.status(500).json({ success: false, message: "Failed to save appearance" });
  }
}

export async function getAppearance(req, res) {
  try {
    const { modelId } = req.params;
    const userId = req.user.userId;

    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
      select: { savedAppearance: true },
    });

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    return res.json({ success: true, savedAppearance: model.savedAppearance || null });
  } catch (error) {
    console.error("Error loading appearance:", error);
    return res.status(500).json({ success: false, message: "Failed to load appearance" });
  }
}
