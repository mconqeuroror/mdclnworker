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
  submitFaceSwapJob,
  getFalCallbackUrl,
  isFalConfigured,
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
import { enqueueCleanupOldGenerations } from "./generation.controller.js";
import { resolveNsfwResolution } from "../utils/nsfwResolution.js";
import { enforceGeneratedContentDeletionBlock } from "../utils/generated-content-deletion-guard.js";
import { resolveRunpodWebhookUrl } from "../lib/runpodWebhookUrl.js";

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
  getNudesPackCreditsPerImage,
  getNudesPackTotalCredits,
  getNudesPackCreditsSplit,
} from "../../shared/nudesPackPoses.js";
import {
  validateNudesPackPoseIdsEffective,
  getNudesPackPoseByIdEffective,
  getNudesPackAdditiveHintForPose,
} from "../services/nudes-pack-config.service.js";
import { getPromptTemplateValue } from "../services/prompt-template-config.service.js";
import { getGenerationPricing } from "../services/generation-pricing.service.js";

export async function cleanupTrainingDataset(loraId, modelId) {
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

export async function awardFirstLoraTrainingBonus({ userId, modelId, targetLoraId = null }) {
  const BONUS_CREDITS = 250;
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

async function resolveLoraTrainingCredits(isPro) {
  const pricing = await getGenerationPricing();
  const raw = isPro
    ? Number(pricing.loraTrainingPro ?? CREDITS_FOR_PRO_LORA_TRAINING)
    : Number(pricing.loraTrainingStandard ?? CREDITS_FOR_LORA_TRAINING);
  const n = Math.ceil(Number.isFinite(raw) ? raw : (isPro ? CREDITS_FOR_PRO_LORA_TRAINING : CREDITS_FOR_LORA_TRAINING));
  return Math.max(0, n);
}
const LORA_STALE_RECOVERY_MS = Number(process.env.LORA_STALE_RECOVERY_MS) || 4 * 60 * 60 * 1000;
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

  let systemPrompt = `You are a LoRA strength calculator for AI image generation. Determine the optimal LoRA strength for a face/identity LoRA based on face visibility.

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
  systemPrompt = await getPromptTemplateValue("nsfwLoraStrengthSystemPrompt", systemPrompt);

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
export async function syncLegacyLoraFields(modelId, loraId) {
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
// SHARED HELPER: Persist a completed LoRA training result to DB.
// Called by both the polling status-check endpoint and the fal.ai webhook.
// Returns { loraUrl, firstLoraBonus }.
// ============================================
export async function finalizeTrainingCompletion({ loraId, modelId, userId, loraUrl: falUrl, modelName }) {
  const ARCHIVE_DEADLINE_MS = 120_000;
  let permanentUrl = falUrl;
  try {
    permanentUrl = await Promise.race([
      archiveLoraToR2(falUrl, modelName, 90_000),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Archive timeout")), ARCHIVE_DEADLINE_MS)),
    ]);
  } catch (archiveErr) {
    console.warn("⚠️ LoRA archive skipped (timeout/error) — using fal URL:", archiveErr?.message);
  }

  if (loraId) {
    await prisma.trainedLora.update({
      where: { id: loraId },
      data: { status: "ready", loraUrl: permanentUrl, trainedAt: new Date(), error: null },
    });

    const model = await prisma.savedModel.findUnique({ where: { id: modelId }, select: { id: true, activeLoraId: true } });
    const isFirstReady = !(await prisma.trainedLora.findFirst({
      where: { modelId, status: "ready", id: { not: loraId } },
    }));
    const updateData = { nsfwUnlocked: true };
    if (isFirstReady || !model?.activeLoraId) updateData.activeLoraId = loraId;
    await prisma.savedModel.update({ where: { id: modelId }, data: updateData });
    await syncLegacyLoraFields(modelId, updateData.activeLoraId || model?.activeLoraId);
  } else {
    // Legacy path: SavedModel only (no TrainedLora row)
    await prisma.savedModel.update({
      where: { id: modelId },
      data: { loraStatus: "ready", loraUrl: permanentUrl || falUrl, loraTrainedAt: new Date(), nsfwUnlocked: true },
    });
  }

  let firstLoraBonus = 0;
  try {
    firstLoraBonus = await awardFirstLoraTrainingBonus({ userId, modelId, targetLoraId: loraId ?? null });
  } catch (e) {
    console.error("⚠️ First LoRA bonus check failed (non-critical):", e?.message);
  }

  cleanupTrainingDataset(loraId, modelId).catch((e) =>
    console.error("🧹 Training dataset cleanup failed (non-critical):", e?.message)
  );

  return { loraUrl: permanentUrl, firstLoraBonus };
}

async function failLoraAndRefundIfStillTraining({
  loraId,
  modelId,
  modelActiveLoraId,
  userId,
  trainingMode,
  errorMessage,
}) {
  const msg = getErrorMessageForDb(errorMessage || "LoRA training failed");
  const updated = await prisma.trainedLora.updateMany({
    where: { id: loraId, status: "training" },
    data: {
      status: "failed",
      error: msg,
    },
  });
  if (updated.count === 0) return { updated: false, refunded: false };

  try {
    await syncLegacyLoraFields(modelId, modelActiveLoraId || null);
  } catch (syncErr) {
    console.error(`⚠️ Failed to sync legacy LoRA fields for ${loraId}:`, syncErr?.message);
  }

  const refundAmount = await resolveLoraTrainingCredits(trainingMode === "pro");
  try {
    await refundCredits(userId, refundAmount);
    console.log(`💰 Refunded ${refundAmount} credits to user ${userId} for stale/failed LoRA ${loraId}`);
    return { updated: true, refunded: true };
  } catch (refundErr) {
    console.error(`⚠️ Failed to refund stale/failed LoRA ${loraId}:`, refundErr?.message);
    return { updated: true, refunded: false };
  }
}

export async function recoverStaleLoraTrainings({
  staleAfterMs = LORA_STALE_RECOVERY_MS,
  onlyLoraId = null,
} = {}) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const where = {
    status: "training",
    updatedAt: { lt: cutoff },
    ...(onlyLoraId ? { id: onlyLoraId } : {}),
  };

  const staleRows = await prisma.trainedLora.findMany({
    where,
    include: {
      model: {
        select: {
          id: true,
          name: true,
          userId: true,
          activeLoraId: true,
        },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: onlyLoraId ? 1 : 60,
  });

  if (!staleRows.length) {
    return { checked: 0, completed: 0, failed: 0, refunded: 0 };
  }

  let completed = 0;
  let failed = 0;
  let refunded = 0;

  for (const lora of staleRows) {
    const ageMinutes = Math.round((Date.now() - new Date(lora.updatedAt).getTime()) / 60000);
    try {
      if (!lora.falRequestId) {
        const result = await failLoraAndRefundIfStillTraining({
          loraId: lora.id,
          modelId: lora.modelId,
          modelActiveLoraId: lora.model?.activeLoraId || null,
          userId: lora.model.userId,
          trainingMode: lora.trainingMode,
          errorMessage: `LoRA preprocessing stalled after ${ageMinutes} min (no provider request id)`,
        });
        if (result.updated) {
          failed += 1;
          if (result.refunded) refunded += 1;
        }
        continue;
      }

      const status = await checkTrainingStatus(lora.falRequestId);
      if (status.status === "COMPLETED") {
        const result = await getTrainingResult(lora.falRequestId);
        const falUrl = result?.loraUrl;
        if (!falUrl) {
          const failRes = await failLoraAndRefundIfStillTraining({
            loraId: lora.id,
            modelId: lora.modelId,
            modelActiveLoraId: lora.model?.activeLoraId || null,
            userId: lora.model.userId,
            trainingMode: lora.trainingMode,
            errorMessage: "Training completed but no LoRA URL returned",
          });
          if (failRes.updated) {
            failed += 1;
            if (failRes.refunded) refunded += 1;
          }
          continue;
        }

        await finalizeTrainingCompletion({
          loraId: lora.id,
          modelId: lora.modelId,
          userId: lora.model.userId,
          loraUrl: falUrl,
          modelName: lora.model?.name || "model",
        });
        completed += 1;
        continue;
      }

      if (status.status === "FAILED") {
        const failRes = await failLoraAndRefundIfStillTraining({
          loraId: lora.id,
          modelId: lora.modelId,
          modelActiveLoraId: lora.model?.activeLoraId || null,
          userId: lora.model.userId,
          trainingMode: lora.trainingMode,
          errorMessage: `Training failed on fal.ai (stale recovery after ${ageMinutes} min)`,
        });
        if (failRes.updated) {
          failed += 1;
          if (failRes.refunded) refunded += 1;
        }
        continue;
      }

      const failRes = await failLoraAndRefundIfStillTraining({
        loraId: lora.id,
        modelId: lora.modelId,
        modelActiveLoraId: lora.model?.activeLoraId || null,
        userId: lora.model.userId,
        trainingMode: lora.trainingMode,
        errorMessage: `Training timed out after ${ageMinutes} min (last provider status: ${status.status})`,
      });
      if (failRes.updated) {
        failed += 1;
        if (failRes.refunded) refunded += 1;
      }
    } catch (error) {
      console.error(`⚠️ Stale LoRA recovery error for ${lora.id}:`, error?.message || error);
      const failRes = await failLoraAndRefundIfStillTraining({
        loraId: lora.id,
        modelId: lora.modelId,
        modelActiveLoraId: lora.model?.activeLoraId || null,
        userId: lora.model.userId,
        trainingMode: lora.trainingMode,
        errorMessage: `Stale recovery failed: ${error?.message || "unknown error"}`,
      });
      if (failRes.updated) {
        failed += 1;
        if (failRes.refunded) refunded += 1;
      }
    }
  }

  return {
    checked: staleRows.length,
    completed,
    failed,
    refunded,
  };
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
    if (enforceGeneratedContentDeletionBlock(req, res)) return;

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

    let systemPrompt = `You are an expert physical appearance analyst for AI model training. You will receive ${photos.length} photo(s) of the same person. Your job is to build a COMPREHENSIVE and PRECISE profile of this person's physical features so that an AI image generator can recreate them consistently across different scenes and poses.

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
    systemPrompt = await getPromptTemplateValue("nsfwAutoDetectAppearanceSystemPrompt", systemPrompt);

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
            resolution: "2K",
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
            resolution: "2K",
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
        resolution: "2K",
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
    const creditsNeeded = await resolveLoraTrainingCredits(isProTraining);

    if (!isFalConfigured()) {
      return res.status(503).json({
        success: false,
        message:
          "LoRA training is unavailable: fal.ai API key is not configured. Set FAL_KEY or FAL_API_KEY in the server environment.",
        code: "FAL_NOT_CONFIGURED",
      });
    }
    if (!isR2Configured()) {
      return res.status(503).json({
        success: false,
        message: "LoRA training requires file storage (R2). Configure R2 credentials.",
        code: "R2_NOT_CONFIGURED",
      });
    }

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

    const trainingWebhookUrl = getFalCallbackUrl("training");
    if (trainingWebhookUrl) {
      console.log(`🔔 LoRA training webhook: ${trainingWebhookUrl}`);
    } else {
      console.warn("⚠️ No CALLBACK_BASE_URL set — LoRA training will rely on polling only");
    }

    // Captioning + ZIP + fal submit can exceed HTTP limits (504). Run after response via waitUntil on Vercel.
    const bgPayload = {
      userId,
      creditsNeeded,
      modelId,
      targetLoraId,
      imageUrls: [...imageUrls],
      triggerWord,
      isProTraining,
      captionSubjectClass,
      trainingWebhookUrl,
    };

    const runTrainLoraBackground = async () => {
      const {
        userId: uid,
        creditsNeeded: cost,
        modelId: mid,
        targetLoraId: lid,
        imageUrls: urls,
        triggerWord: tw,
        isProTraining: pro,
        captionSubjectClass: csc,
        trainingWebhookUrl: wh,
      } = bgPayload;

      try {
        const trainingResult = await startLoraTraining(urls, tw, {
          steps: pro ? 9000 : 4500,
          loraRank: pro ? 32 : 16,
          captionSubjectClass: csc,
          webhookUrl: wh,
        });

        if (!trainingResult.success) {
          await refundCredits(uid, cost);
          if (lid) {
            await prisma.trainedLora.update({
              where: { id: lid },
              data: { status: "failed", error: trainingResult.error },
            });
            await syncLegacyLoraFields(mid, lid);
          } else {
            await prisma.savedModel.update({
              where: { id: mid },
              data: { loraStatus: "failed", loraError: trainingResult.error },
            });
          }
          return;
        }

        if (lid) {
          await prisma.trainedLora.update({
            where: { id: lid },
            data: {
              triggerWord: tw,
              falRequestId: trainingResult.requestId,
              error: null,
            },
          });
          await syncLegacyLoraFields(mid, lid);
        } else {
          await prisma.savedModel.update({
            where: { id: mid },
            data: {
              loraStatus: "training",
              loraTriggerWord: tw,
              loraFalRequestId: trainingResult.requestId,
              loraError: null,
            },
          });
        }
        console.log(`✅ LoRA fal job submitted in background: ${trainingResult.requestId}`);
      } catch (e) {
        console.error("❌ Train LoRA background error:", e?.message || e);
        try {
          await refundCredits(uid, cost);
        } catch (re) {
          console.error("❌ Train LoRA background refund failed:", re?.message || re);
        }
        try {
          if (lid) {
            await prisma.trainedLora.update({
              where: { id: lid },
              data: {
                status: "failed",
                error: e?.message || "Failed to start LoRA training",
              },
            });
            await syncLegacyLoraFields(mid, lid);
          } else if (mid) {
            await prisma.savedModel.update({
              where: { id: mid },
              data: {
                loraStatus: "failed",
                loraError: e?.message || "Failed to start LoRA training",
              },
            });
          }
        } catch (se) {
          console.error("⚠️ Failed to persist LoRA failure after background error:", se?.message);
        }
      }
    };

    const bgPromise = runTrainLoraBackground();
    if (process.env.VERCEL) {
      try {
        const { waitUntil } = await import("@vercel/functions");
        waitUntil(bgPromise);
      } catch (e) {
        console.warn("Train LoRA: waitUntil unavailable, background may not complete on serverless:", e?.message);
        void bgPromise;
      }
    } else {
      void bgPromise;
    }

    return res.status(202).json({
      success: true,
      deferred: true,
      message:
        "LoRA preprocessing started (captioning and dataset upload). This runs in the background — poll training status; fal training begins once a request id appears.",
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
      let lora = await prisma.trainedLora.findUnique({ where: { id: targetLoraId } });

      if (!lora || lora.modelId !== modelId) {
        return res.json({
          success: true,
          status: "none",
          nsfwUnlocked: model.nsfwUnlocked,
        });
      }

      // Self-heal stale training rows during user polling (fallback in addition to cron/server intervals).
      if (
        lora.status === "training" &&
        new Date(lora.updatedAt).getTime() < Date.now() - LORA_STALE_RECOVERY_MS
      ) {
        try {
          await recoverStaleLoraTrainings({ onlyLoraId: lora.id });
          lora = await prisma.trainedLora.findUnique({ where: { id: targetLoraId } });
          if (!lora || lora.modelId !== modelId) {
            return res.json({
              success: true,
              status: "none",
              nsfwUnlocked: model.nsfwUnlocked,
            });
          }
        } catch (staleErr) {
          console.error("Stale LoRA check in status endpoint failed:", staleErr?.message);
        }
      }

      if (lora.status !== "training" || !lora.falRequestId) {
        return res.json({
          success: true,
          status: lora.status || "none",
          loraUrl: lora.loraUrl,
          triggerWord: lora.triggerWord,
          nsfwUnlocked: model.nsfwUnlocked,
          loraId: lora.id,
          preprocessing: lora.status === "training" && !lora.falRequestId,
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

          const { loraUrl: permanentUrl, firstLoraBonus } = await finalizeTrainingCompletion({
            loraId: targetLoraId,
            modelId,
            userId,
            loraUrl: falUrl,
            modelName: model.name,
          });

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
            const refundAmount = await resolveLoraTrainingCredits(loraRecord?.trainingMode === "pro");
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
        preprocessing: model.loraStatus === "training" && !model.loraFalRequestId,
      });
    }

    try {
      const falStatus = await checkTrainingStatus(model.loraFalRequestId);

      if (falStatus.status === "COMPLETED") {
        const result = await getTrainingResult(model.loraFalRequestId);
        const falUrl = result?.loraUrl;
        if (!falUrl) {
          await prisma.savedModel.update({
            where: { id: modelId },
            data: { loraStatus: "failed", loraError: "Training completed but no LoRA URL returned" },
          });
          return res.json({ success: true, status: "failed", error: "No LoRA URL" });
        }

        const { loraUrl: permanentUrl, firstLoraBonus } = await finalizeTrainingCompletion({
          loraId: null,
          modelId,
          userId,
          loraUrl: falUrl,
          modelName: model.name,
        });

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

      const nsfwWebhookUrl = resolveRunpodWebhookUrl({
        generationId: generation.id,
        kind: "nsfw",
      });
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
      }, nsfwWebhookUrl);

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
          providerTaskId: submission.requestId,
          inputImageUrl: JSON.stringify({
            runpodJobId: submission.requestId,
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

/**
 * Run async mapper over items with at most `concurrency` calls in flight. Results preserve input order.
 */
async function mapWithConcurrencyLimit(items, concurrency, mapper) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.floor(Number(concurrency)) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ============================================
// POST /api/nsfw/nudes-pack — dynamic cr/image: 15 @ 30 poses → 30 @ 1 pose (linear); looks + trigger server-side
// Body: { modelId, poseIds: string[], attributes?, attributesDetail?, sceneDescription?, skipFaceSwap?, faceSwapImageUrl?, options?, resolution? }
// Env: NSFW_NUDES_PACK_PROMPT_CONCURRENCY (default 4) — parallel Grok prompt calls before RunPod submit
// ============================================
export async function generateNudesPack(req, res) {
  let creditsDeducted = 0;
  /** @type {number[]} */
  let creditsSplitForPack = [];
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

    const v = await validateNudesPackPoseIdsEffective(poseIds);
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

    const genPricingForPack = await getGenerationPricing();
    const nudesPackPricing = {
      nudesPackCreditsMin: genPricingForPack.nudesPackCreditsMin,
      nudesPackCreditsMax: genPricingForPack.nudesPackCreditsMax,
    };
    creditsSplitForPack = getNudesPackCreditsSplit(poseIds.length, nudesPackPricing);
    const creditsNeeded = getNudesPackTotalCredits(poseIds.length, nudesPackPricing);
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for this nudes pack (~${getNudesPackCreditsPerImage(poseIds.length, nudesPackPricing)} cr/image avg for ${poseIds.length} poses). You have ${totalCredits} credits.`,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    const userOverrideStrength = options.loraStrength || null;
    const adminSamplerOpts = getAdminNsfwSamplerOptions(req, options);
    // Nudes pack is always 9:16 portrait (IG story / vertical format) — resolution override is ignored
    const resSpec = resolveNsfwResolution("768x1344");
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

    /** @type {{ idx: number, poseId: string, pose: { id: string, title: string, summary: string, category: string, promptFragment: string }, thisCreditCost: number }[]} */
    const packRows = [];
    for (let idx = 0; idx < poseIds.length; idx++) {
      const thisCreditCost =
        creditsSplitForPack[idx] ?? getNudesPackCreditsPerImage(poseIds.length, nudesPackPricing);
      const poseId = poseIds[idx];
      const pose = await getNudesPackPoseByIdEffective(poseId);
      if (!pose) {
        failures.push({ poseId, error: "Unknown pose" });
        await refundCredits(userId, thisCreditCost);
        continue;
      }
      packRows.push({ idx, poseId, pose, thisCreditCost });
    }

    if (packRows.length === 0) {
      await refundCredits(userId, creditsNeeded);
      return res.status(400).json({
        success: false,
        message: "No valid poses selected.",
      });
    }

    /** @type {{ idx: number, poseId: string, pose: { id: string, title: string, summary: string, category: string, promptFragment: string }, thisCreditCost: number, generationId: string }[]} */
    const rowsWithGen = [];
    for (const row of packRows) {
      const generation = await prisma.generation.create({
        data: {
          userId,
          modelId,
          type: "nsfw",
          prompt: `[nudes-pack-queued] ${row.pose.id}`,
          status: "queued",
          creditsCost: row.thisCreditCost,
          replicateModel: "comfyui-nsfw",
          isNsfw: true,
        },
      });
      generationIds.push(generation.id);
      rowsWithGen.push({ ...row, generationId: generation.id });
    }

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });

    // Vercel/serverless: fire-and-forget async is killed when the response is sent — nothing reaches RunPod.
    // waitUntil() keeps the function alive until prompts + RunPod submits finish (see vercel.json maxDuration).
    const nudesPackBackgroundWork = (async () => {
      let queuedCount = 0;
      const bgFailures = [];

      try {
        const promptConcurrencyRaw = process.env.NSFW_NUDES_PACK_PROMPT_CONCURRENCY;
        const promptConcurrency = Math.max(
          1,
          Math.min(12, Number.parseInt(String(promptConcurrencyRaw ?? "4"), 10) || 4),
        );
        console.log(
          `📦 Nudes pack (background): generating ${rowsWithGen.length} AI prompts with concurrency=${promptConcurrency}`,
        );

        const promptedRows = await mapWithConcurrencyLimit(rowsWithGen, promptConcurrency, async (row) => {
          const { idx, pose } = row;
          const modelLooksText = buildAttributeList(attributesDetail).join(", ") || attributesString || "";
          const userRequestForAi = [
            packSceneNote.trim() ? `Global scene note: ${packSceneNote.trim()}` : null,
            `Pose summary: ${pose.summary || ""}`,
            `Pose prompt fragment: ${pose.promptFragment || ""}`,
            modelLooksText ? `Model look variables: ${modelLooksText}` : null,
          ]
            .filter(Boolean)
            .join("\n");
          const composedFallbackPrompt = [
            pose.promptFragment || "",
            pose.summary || "",
            modelLooksText ? `Model look variables: ${modelLooksText}` : "",
            packSceneNote.trim() ? `Scene note: ${packSceneNote.trim()}` : "",
          ]
            .filter(Boolean)
            .join(". ")
            .trim();

          let finalUserPrompt = composedFallbackPrompt || pose.summary || pose.promptFragment || "";
          try {
            const aiPrompt = await runNsfwPromptGenerationForModel(
              model,
              userRequestForAi,
              attributesDetail,
              attributesString,
              { mode: "nudes-pack", pose },
            );
            if (aiPrompt && typeof aiPrompt === "string" && aiPrompt.trim()) {
              if (isNsfwPromptLogicalConflict(aiPrompt)) {
                console.warn(`Nudes pack ${pose.id}: AI reported logical conflict — using composed pose fallback`);
                finalUserPrompt = composedFallbackPrompt || pose.summary || pose.promptFragment || "";
              } else {
                finalUserPrompt = aiPrompt.trim();
              }
            }
          } catch (promptErr) {
            console.error(`Nudes pack AI prompt failed for ${pose.id}:`, promptErr?.message || promptErr);
            finalUserPrompt = composedFallbackPrompt || pose.summary || pose.promptFragment || "";
          }

          return { ...row, finalUserPrompt, userRequestForAi };
        });

        for (const row of promptedRows) {
          const { idx, poseId, pose, thisCreditCost, finalUserPrompt, userRequestForAi, generationId } = row;

          const sceneLine = [packSceneNote.trim(), `Nudes pack ${idx + 1}/${poseIds.length}: ${pose.title}`]
            .filter(Boolean)
            .join(" · ");

          await prisma.generation.update({
            where: { id: generationId },
            data: {
              prompt: `[${pose.id}] ${finalUserPrompt}`,
              status: "processing",
            },
          });

          const nsfwWebhookUrl = resolveRunpodWebhookUrl({
            generationId,
            kind: "nsfw",
          });
          const submission = await submitNsfwGeneration({
            loraUrl,
            triggerWord: loraTriggerWord,
            userPrompt: finalUserPrompt,
            attributes: attributesString,
            sceneDescription: userRequestForAi || sceneLine || finalUserPrompt,
            chipSelections: attributesDetail,
            options: {
              nudesPack: true,
              quickFlow: options.quickFlow === true,
              loraStrength: userOverrideStrength,
              postProcessing,
              resolution: resSpec.presetId,
              packAdditiveLoraHint: getNudesPackAdditiveHintForPose(pose.id),
              ...adminSamplerOpts,
            },
          }, nsfwWebhookUrl);

          if (!submission.success) {
            await refundGeneration(generationId);
            await prisma.generation.update({
              where: { id: generationId },
              data: { status: "failed", errorMessage: getErrorMessageForDb(submission.error) },
            });
            bgFailures.push({ poseId, error: submission.error || "Submit failed" });
            continue;
          }

          const rp = submission.resolvedParams || {};
          await prisma.generation.update({
            where: { id: generationId },
            data: {
              providerTaskId: submission.requestId,
              inputImageUrl: JSON.stringify({
                runpodJobId: submission.requestId,
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
            generationId,
            submission.requestId,
            userId,
            thisCreditCost,
            faceReferenceUrl,
          ).catch((error) => {
            console.error("❌ Nudes pack background error:", error);
          });
          queuedCount += 1;
        }

        if (bgFailures.length) {
          console.warn(`📦 Nudes pack: ${bgFailures.length} submit failure(s)`, bgFailures);
        }
        console.log(
          `📦 Nudes pack background done: ${queuedCount} submitted, ${bgFailures.length} submit error(s)`,
        );
      } catch (bgErr) {
        console.error("❌ Nudes pack background fatal:", bgErr?.message || bgErr);
        for (const id of generationIds) {
          try {
            const g = await prisma.generation.findUnique({ where: { id } });
            if (g && (g.status === "queued" || g.status === "processing")) {
              await refundGeneration(id);
              await prisma.generation.update({
                where: { id },
                data: {
                  status: "failed",
                  errorMessage: getErrorMessageForDb(bgErr?.message || "Pack failed to start"),
                },
              });
            }
          } catch (e) {
            console.error("Nudes pack fatal cleanup:", e?.message);
          }
        }
      }
    })();

    if (process.env.VERCEL) {
      try {
        const { waitUntil } = await import("@vercel/functions");
        waitUntil(nudesPackBackgroundWork);
      } catch (e) {
        console.warn("Nudes pack: waitUntil unavailable, background may not complete on serverless:", e?.message);
        void nudesPackBackgroundWork;
      }
    } else {
      void nudesPackBackgroundWork;
    }

    res.json({
      success: true,
      message: `Nudes pack queued: ${poseIds.length} image(s). You can leave this page — they will appear in your gallery when ready.`,
      generations: generationIds.map((id) => ({ id, status: "queued" })),
      failures,
      creditsPerImage: getNudesPackCreditsPerImage(poseIds.length, nudesPackPricing),
      creditsUsed: creditsNeeded,
      creditsRemaining: getTotalCredits(updatedUser),
      poseCount: poseIds.length,
      async: true,
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
      const fromRows = creditsSplitForPack
        .slice(0, generationIds.length)
        .reduce((a, b) => a + b, 0);
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
// Background processor for NSFW generation (RunPod)
// Parallel poll workers — match RunPod concurrency so jobs aren't stuck behind each other.
// Env: NSFW_POLL_CONCURRENCY (default 5), NSFW_MAX_RUNNING_MS (90m), NSFW_MAX_WALL_MS (180m)
// Nudes packs + busy RunPod queues can sit IN_QUEUE a long time; wall must exceed worst-case queue+run.
// ============================================
const nsfwPollQueue = [];
let nsfwActivePollWorkers = 0;
const NSFW_POLL_CONCURRENCY = Math.max(
  1,
  Math.min(20, Number(process.env.NSFW_POLL_CONCURRENCY) || 5),
);
const NSFW_MAX_RUNNING_MS = Number(process.env.NSFW_MAX_RUNNING_MS) || 90 * 60 * 1000;
const NSFW_MAX_WALL_MS = Number(process.env.NSFW_MAX_WALL_MS) || 180 * 60 * 1000;

console.log(
  `🔥 NSFW RunPod poll: ${NSFW_POLL_CONCURRENCY} concurrent workers · running timeout ${Math.round(NSFW_MAX_RUNNING_MS / 60000)}m · wall ${Math.round(NSFW_MAX_WALL_MS / 60000)}m`,
);

/**
 * R2 upload + optional face swap + DB complete. Idempotent via updateMany(status in processing|pending).
 * Used by background poll and POST /api/runpod/callback.
 */
export async function finalizeNsfwRunpodGeneration(generationId, requestId, runpodOutput) {
  const gen = await prisma.generation.findUnique({ where: { id: generationId } });
  if (!gen) {
    console.warn(`[NSFW finalize] generation ${generationId} not found`);
    return { ok: false, reason: "not_found" };
  }
  if (gen.status !== "processing" && gen.status !== "pending") {
    return { ok: true, skipped: true, reason: "already_finalized" };
  }

  let inputData = {};
  try {
    inputData = typeof gen.inputImageUrl === "string" ? JSON.parse(gen.inputImageUrl) : gen.inputImageUrl || {};
  } catch {
    inputData = {};
  }
  const faceReferenceUrl = inputData?.faceReferenceUrl || null;

  const result = await getNsfwGenerationResult(requestId, runpodOutput);
  if (!result.outputUrls?.length) {
    throw new Error("No output URLs in result");
  }

  let permanentUrls = result.outputUrls;
  if (faceReferenceUrl) {
    const faceswapWebhookUrl = getFalCallbackUrl("faceswap");
    if (faceswapWebhookUrl) {
      // Async path: submit all faceswaps with webhook, store state, return early
      console.log(`🔄 [finalize] Submitting ${permanentUrls.length} async faceswap(s) via webhook…`);
      const faceSwapJobs = [];
      for (let i = 0; i < permanentUrls.length; i++) {
        try {
          const reqId = await submitFaceSwapJob(permanentUrls[i], faceReferenceUrl, faceswapWebhookUrl);
          faceSwapJobs.push({ requestId: reqId, imageIndex: i, originalUrl: permanentUrls[i] });
          console.log(`  ↗ Faceswap job ${i}: ${reqId}`);
        } catch (e) {
          console.warn(`⚠️ [finalize] Faceswap job ${i} submit failed: ${e?.message} — using original`);
          faceSwapJobs.push({ requestId: null, imageIndex: i, originalUrl: permanentUrls[i] });
        }
      }
      // Jobs that failed submission resolve immediately with their original URL
      const resolvedUrls = {};
      for (const j of faceSwapJobs) {
        if (!j.requestId) resolvedUrls[String(j.imageIndex)] = j.originalUrl;
      }
      const pending = faceSwapJobs.filter((j) => j.requestId);
      if (pending.length === 0) {
        // All failed — fall through to immediate completion with original URLs
        permanentUrls = faceSwapJobs.map((j) => j.originalUrl);
      } else {
        await prisma.generation.update({
          where: { id: generationId },
          data: {
            pipelinePayload: {
              faceSwapJobs,
              faceReferenceUrl,
              totalImages: permanentUrls.length,
              resolvedUrls,
              originalUrls: permanentUrls,
            },
          },
        });
        console.log(`🔄 [finalize] ${generationId.slice(0, 8)} waiting for ${pending.length} faceswap webhook(s)`);
        return { ok: true, pending: true, reason: "faceswap_pending" };
      }
    } else {
      // Sync fallback: poll inline (original behaviour)
      console.log(`🔄 [finalize] Face-swapping ${permanentUrls.length} images (sync fallback)…`);
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
  }

  const outputUrlValue = permanentUrls.length === 1 ? permanentUrls[0] : JSON.stringify(permanentUrls);
  const updated = await prisma.generation.updateMany({
    where: { id: generationId, status: { in: ["processing", "pending"] } },
    data: {
      status: "completed",
      outputUrl: outputUrlValue,
      completedAt: new Date(),
      errorMessage: null,
    },
  });
  if (updated.count === 0) {
    return { ok: true, skipped: true, reason: "race_lost" };
  }
  console.log(`✅ [finalize] ${generationId.slice(0, 8)} completed (${permanentUrls.length} imgs)`);
  if (gen.userId && gen.modelId) {
    enqueueCleanupOldGenerations(gen.userId, gen.modelId);
  }
  return { ok: true };
}

function enqueueNsfwPoll(generationId, requestId, userId, creditsNeeded, faceReferenceUrl) {
  nsfwPollQueue.push({ generationId, requestId, userId, creditsNeeded, faceReferenceUrl, enqueuedAt: Date.now() });
  console.log(
    `📥 [Q] Queued NSFW poll for ${generationId} (pending ${nsfwPollQueue.length}, active ${nsfwActivePollWorkers}/${NSFW_POLL_CONCURRENCY})`,
  );
  pumpNsfwPollWorkers();
}

function pumpNsfwPollWorkers() {
  while (nsfwActivePollWorkers < NSFW_POLL_CONCURRENCY && nsfwPollQueue.length > 0) {
    const job = nsfwPollQueue.shift();
    nsfwActivePollWorkers++;
    runOneNsfwPollJob(job)
      .catch((e) => console.error("[NSFW poll worker] unexpected:", e?.message || e))
      .finally(() => {
        nsfwActivePollWorkers--;
        if (nsfwPollQueue.length > 0) {
          pumpNsfwPollWorkers();
        } else if (nsfwActivePollWorkers === 0) {
          console.log(`📭 [Q] NSFW poll queue empty`);
        }
      });
  }
}

async function runOneNsfwPollJob(job) {
  const { generationId, requestId } = job;
  console.log(`\n🔥 [Q] Polling ${generationId.slice(0, 8)}…`);

  try {
    const pollResult = await pollNsfwJob(requestId, NSFW_MAX_RUNNING_MS, NSFW_MAX_WALL_MS);
    if (pollResult.error) {
      throw new Error(pollResult.error);
    }

    const cached = pollResult.result?._runpodOutput;
    await finalizeNsfwRunpodGeneration(generationId, requestId, cached);
  } catch (error) {
    console.error(`❌ [Q] ${generationId.slice(0, 8)} error: ${error.message}`);
    await refundGeneration(generationId);
    await prisma.generation
      .update({
        where: { id: generationId },
        data: { status: "failed", errorMessage: getErrorMessageForDb(error.message || "Generation failed") },
      })
      .catch(() => {});
  }
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

/** True when Grok returned the reserved conflict sentinel (see system prompt OUTPUT). */
function isNsfwPromptLogicalConflict(prompt) {
  const s = typeof prompt === "string" ? prompt.trim() : "";
  return s.startsWith("[Error:") || /Irresolvable logical conflict/i.test(s);
}

function humanizeNsfwPromptConflict(prompt) {
  const s = typeof prompt === "string" ? prompt.trim() : "Please clarify your scene.";
  const inner = s.match(/^\[Error:\s*(.+?)\]\s*$/);
  return inner ? inner[1].trim() : s.replace(/^\[|\]$/g, "").trim() || "Please clarify your scene.";
}

function applyPromptTemplatePlaceholders(template, values = {}) {
  let out = String(template || "");
  for (const [key, value] of Object.entries(values)) {
    const token = `{{${key}}}`;
    out = out.split(token).join(String(value ?? ""));
  }
  return out;
}

/** Shared Grok prompt builder (also used by plan-generation). */
async function runNsfwPromptGenerationForModel(
  model,
  userRequest,
  clientDetail = {},
  clientAttributes = "",
  context = {},
) {
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
    const rawGender = String(
      attributesDetail.gender ||
      lockedAppearance.gender ||
      aiParams.gender ||
      "",
    ).toLowerCase();
    const genderClass =
      rawGender.includes("male") || rawGender.includes("man")
        ? "man"
        : rawGender.includes("female") || rawGender.includes("woman")
          ? "woman"
          : "person";

    let systemPrompt = `You are an expert prompt engineer for Z-Image Turbo (a fast ~6B turbo/distilled transformer). Your ONLY goal is prompts that read as REAL amateur smartphone nudes — private gallery energy: raw, imperfect, NOT studio/DSLR/cinematic/AI-art polish.

=== HOW Z-IMAGE TURBO NSFW CHECKPOINTS WORK BEST (2026) ===
• The model prefers LONG, DETAILED NATURAL LANGUAGE: full sentences that tell one coherent "story" of the photo (who, where, light, pose, mood, a few props).
• It is HURT by: (1) a huge comma-separated tag dump at the END, especially duplicate quality/realism/artifact phrases; (2) repetition and redundancy; (3) stacking conflicting "realism boosters"; (4) mixing amateur/smartphone vibe with polished or explicit-porn-aesthetic language; (5) hyper-specific anatomical micromanagement (causes mutations, perspective breaks, or stylized porn look).
• The server appends a SHORT technical tail automatically (QUALITY_SUFFIX). Your JSON output must NOT mirror that tail — do NOT paste long lists of camera/skin/JPEG/flash phrases at the end.

=== LENGTH & SHAPE ===
• Target 50–120 words of FLOWING prose (one or two paragraphs of connected sentences). Stay under ~130 words total.
• Integrate light, mood, and texture INTO the narrative early or mid-prompt — NOT as 15+ repeated clauses stacked at the tail.
• ONE DOMINANT LIGHT SOURCE, described ONCE coherently. For dim indoor amateur nudes, prefer harsh DIRECT PHONE FLASH FROM THE FRONT (signature look). Do NOT say "harsh flash from the side" and later "frontal flash washing out skin" — that conflicts and causes bad lighting blends. Pick one: e.g. frontal phone flash with sharp shadows behind the body, OR soft window daylight for day scenes — not both fighting each other.

=== LoRA TRIGGER + IDENTITY (IMPORTANT) ===
• Start with: TRIGGER_WORD + minimal class word, e.g. "lora_example woman, ..." — then scene/pose/variables.
• Do NOT re-list every fixed trait every time (full face recipe, hair, eyes, lips, makeup) — that weakens the trigger and can cause inconsistency. The LoRA carries identity; add only LIGHT reminders if needed, then SCENE.

=== EXPLICIT / PARTNERED SCENES ===
• Describe the act in SHORT NARRATIVE prose, not clinical micromanagement (avoid stacking "average-sized erect penis penetrating... labia stretched... POV scale... proportional..." in one long chain).
• Prefer one clear CAMERA ANGLE: e.g. "low side angle" OR "three-quarter view" OR "POV from above" — do not demand simultaneous "side profile showing insertion detail" AND "missionary front-facing POV" in ways that fight each other.
• Safer example shape: "his average erect cock deep inside her from a side angle, her labia visibly gripping the shaft, bodies pressed close" — not a paragraph of isolated anatomy specs.

=== AMATEUR PHOTO IDENTITY ===
Private phone-gallery feel: spontaneous, imperfect. For true solo framing there is only the female subject in frame. For partnered/POV sex, the prompt describes her + visible male parts as the scene requires — do not add ethics disclaimers or filler like "consensual explicit adult" (the server handles framing).
Weave 2–4 mundane clutter items into the story (charger, bottle, clothes, rumpled sheets). Backgrounds: messy, lived-in — never a clean studio set.

=== ANTI-CINEMATIC (keep output looking like a real phone pic, not a shoot) ===
Avoid: professional/studio lighting, rim light, dramatic shadows, golden-hour glow, volumetric light, "editorial", "photoshoot", warm lamp as hero light.
Indoor night default: ONE dominant light — usually harsh frontal phone flash (see above). Daytime: flat window light. Composition: slightly casual/off-center OK. Background: messy/lived-in.

=== ANTI-MUTATION & CLARITY ===
- Complex poses: say what each hand does; chain body head-to-toe in one clear flow when helpful.
- Solo-framed scenes only: you may imply a single subject — do NOT write "one person only" or "solo girl" if the scene is partnered sex / visible penetration / oral on a penis (server fixes the tail; contradicting breaks output).
- NEVER use "boyfriend", "partner", "someone else" — causes phantom people.
- Blowjobs: default ONE hand on shaft (vary left/right across generations); second hand on thigh, floor, or hair — unless user asked for huge/two-hand.
- Sex acts: short narrative beats a long clinical anatomy checklist; avoid mixing "side profile insertion detail" with incompatible "POV scale" phrases in one prompt.

=== PROMPT STYLE ===
• 50–120 words, flowing sentences. End on SCENE content — NOT a second wall of duplicate quality tags (the server adds a short QUALITY_SUFFIX).
• BAD: stacking "shot on iPhone… smartphone… grainy… no color grading… raw…" after you already described the scene.
• GOOD: one tight paragraph (or two short ones) + stop.

=== REALISM ANCHORS (server tail — DO NOT REPEAT) ===
A compact technical suffix is appended after your text. Do NOT re-list camera model, JPEG artifacts, flash, skin pores, grain, "unedited raw", etc. in your JSON — that dilutes Turbo and muddies the scene you wrote.
Your job: scene + pose + expression + clutter + ONE clear light description.

=== BANNED TERMS (never use) ===
"ultra detailed", "8k", "masterpiece", "best quality", "professional photography", "DSLR", "studio lighting", "color grading", "bokeh", "cinematic", "editorial", "magazine quality", "sharp focus", "high resolution", "dramatic lighting", "rim light", "golden glow", "photoshoot", "taken by boyfriend/partner", "volumetric", "god rays", "hyperrealistic"

=== FRAMING & SELFIES (short) ===
Direct photo of the subject; no backstage/meta. Mirror selfie: iPhone visible in reflection, describe the room. Non-mirror bed/overhead: no phone in hand; no "boyfriend/partner". Avoid selfie stick/tripod mentions.

=== EXPLICIT PARTNERED / POV (narrative, not a tag list) ===
When the scene needs penetration or oral: only the visible male part (penis) may appear — no full male body. Girl stays the focus. Describe scale in plain language once if needed ("average erect cock", "realistic adult scale") — do NOT chain five separate scale/POV/labia-spec clauses.
Blowjob: kneeling, looking up, mouth on penis, one hand on shaft (vary left/right), other hand on thigh or floor — unless user asked for huge/two-hand.
Doggy: POV from behind; her hands on bed/sheets; no hand on penis in frame.
Missionary: pick ONE clear angle (e.g. three-quarter or side view showing connection, OR POV from above) — avoid "side profile + missionary + full insertion detail + POV scale" all fighting each other.
Expressions: subtle pleasure (biting lip, half-closed eyes) — no ahegao by default. "Slightly damp skin" or "light sheen" not drenched sweat.

=== STRUCTURE SCAFFOLDS (expand into flowing prose — do NOT append duplicate quality tags) ===
A) Mirror: trigger + woman, bathroom mirror selfie, iPhone in reflection, scene, mood, one light description, clutter.
B) Bed overhead: trigger + woman, on bed, overhead angle, expression, sheets, dim room + frontal flash.
C) Blowjob POV: trigger + kneeling, mouth on penis, one hand on shaft, eye contact, floor/bedroom, messy hair.
D) Doggy: trigger + all fours, arched back, look back, penetration from behind, hands on mattress, POV behind.
E) Missionary (example shape — ~85 words, single light source, narrative):
"[trigger] woman lying on her back on rumpled white sheets in a dim bedroom at night, harsh direct phone flash from the front washing out her skin slightly and casting sharp shadows behind her. She's in missionary with bodies pressed close, one leg hooked around his waist, his average erect cock deep inside her from a side angle so her stretched labia grip the shaft visibly. She squeezes one breast and grips the sheets with the other hand, biting her lower lip with half-closed eyes, flushed cheeks, messy hair on the pillow. Charging cable by her thigh, water bottle on the nightstand, hoodie on the floor. Candid amateur smartphone photo feel."
Adapt traits to MODEL ATTRIBUTES + user scene; do not copy verbatim unless the scenario matches.

=== GOLD STANDARD (mirror — structure only) ===
Strong mirror selfie: trigger + scene in ~75–90 words, ONE coherent light description, 2–4 clutter props, no duplicate quality tail at the end. Do NOT re-list "natural skin texture, pores, anatomically correct" in a second paragraph — the server adds a short suffix.

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
- Start with the model trigger + minimal class (e.g. "${triggerWord} woman"); do not paste the full attribute list again as a second portrait block — the LoRA already encodes identity; scene and pose carry the image.
- Subject gender lock: output MUST keep the subject as "${genderClass}" consistently. Do not switch biological sex markers in anatomy words.
- Do NOT invent traits, clothing, or accessories not requested.
- Use ONLY provided attributes + user request. Do not add elements the user did not ask for.
- Backgrounds must have realistic imperfections and clutter — messy, lived-in, mundane.
- NEVER include logically impossible combinations.
- Write as coherent descriptive phrases with natural flow, not random comma-separated tags.
- NEVER mention another person, boyfriend, partner, or photographer in the prompt.
- The photo must look like a REAL private nude from a smartphone — raw, imperfect, spontaneous.
- If the scene is explicit partnered sex / POV penetration / oral on a penis, describe anatomy and position clearly; do NOT write "solo girl" or "one person only" in your JSON prompt — the server appends the correct solo vs partnered quality tail automatically. Contradicting solo + sex in the same prompt breaks the image.

OUTPUT: Return ONLY a JSON array with one prompt: ["prompt text here"]. No markdown fences, no explanation.
If the user request combined with locked attributes implies an unresolvable logical contradiction (cannot be one coherent photo even after dropping minor elements), return exactly: ["[Error: Irresolvable logical conflict in request — please clarify]"].`;
    const mode = String(context?.mode || "").trim().toLowerCase();
    const systemTemplateKey = mode === "nudes-pack" ? "nudesPackPromptGeneratorSystem" : "nsfwPromptGenerator";
    systemPrompt = await getPromptTemplateValue(systemTemplateKey, systemPrompt);

    const defaultUserWrapper =
      mode === "nudes-pack"
        ? "Compose one final NSFW prompt for this nudes-pack item. Use the full request as source-of-truth.\n\n{{REQUEST}}"
        : "{{REQUEST}}";
    const wrapperTemplate =
      mode === "nudes-pack"
        ? await getPromptTemplateValue("nudesPackPromptGeneratorUserWrapper", defaultUserWrapper)
        : defaultUserWrapper;
    const userMessage = applyPromptTemplatePlaceholders(wrapperTemplate, {
      REQUEST: userRequest,
      MODEL_NAME: model?.name || "",
      MODE: mode || "default",
      POSE_ID: context?.pose?.id || "",
      POSE_TITLE: context?.pose?.title || "",
    });

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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
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
    if (isNsfwPromptLogicalConflict(generatedPrompt)) {
      return res.status(400).json({
        success: false,
        message: humanizeNsfwPromptConflict(generatedPrompt),
      });
    }
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
  cameraDevice: ["shot on iPhone 15 Pro", "shot on iPhone 14", "shot on Samsung Galaxy S24 Ultra", "front facing selfie camera", "rear smartphone camera angle"],
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

  let systemPrompt = `You are a smart assistant that reads a user's scene description and picks the BEST matching options from predefined selector lists.

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
  systemPrompt = await getPromptTemplateValue("nsfwAutoSelectOptionsSystemPrompt", systemPrompt);

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
    const stripped = content.replace(/```json\s*|```\s*/g, "").trim();

    // Pass 1: try parsing the first complete {...} block (handles trailing text after closing brace)
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    let parsed = false;
    if (jsonMatch) {
      try {
        selections = JSON.parse(jsonMatch[0]);
        parsed = true;
      } catch {
        // Pass 2: JSON is malformed (AI thinking mixed in). Extract "key":"value" pairs directly.
      }
    }

    if (!parsed) {
      // Robustly pull out every "key":"value" pair that appears in the string,
      // ignoring surrounding commentary. First occurrence wins on duplicate keys.
      const kvRegex = /"([^"\r\n]+)"\s*:\s*"([^"\r\n]*)"/g;
      let m;
      while ((m = kvRegex.exec(stripped)) !== null) {
        const [, k, v] = m;
        if (!(k in selections)) selections[k] = v;
      }
      if (Object.keys(selections).length === 0) {
        throw new Error("no key-value pairs found in AI response");
      }
    }
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

/** Returns true only if this invocation won pending→processing (at most one winner per job). */
async function tryClaimNsfwAutoSelectJob(jobId) {
  const r = await prisma.nsfwAutoSelectJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "processing" },
  });
  return r.count === 1;
}

/** Run Grok + persist result. Caller must have successfully claimed (status is processing). */
async function executeNsfwAutoSelectJobWork(jobId) {
  const row = await prisma.nsfwAutoSelectJob.findUnique({
    where: { id: jobId },
    select: { userId: true, modelId: true, description: true },
  });
  if (!row) {
    await prisma.nsfwAutoSelectJob.updateMany({
      where: { id: jobId, status: "processing" },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb("Auto-select job missing"),
        completedAt: new Date(),
      },
    });
    return;
  }

  try {
    const selections = await runNsfwAutoSelectSelections(row.userId, row.modelId, row.description);
    await prisma.nsfwAutoSelectJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        selections,
        completedAt: new Date(),
        errorMessage: null,
      },
    });
  } catch (e) {
    const raw = e?.message || "Auto-select failed";
    let httpMessage = raw;
    if (raw === "Model not found") httpMessage = raw;
    else if (raw === "AI not configured" || raw === "AI auto-select failed") httpMessage = raw;
    await prisma.nsfwAutoSelectJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(String(httpMessage).slice(0, 500)),
        completedAt: new Date(),
      },
    });
  }
}

/** waitUntil path: claim then run work (losers no-op). */
async function processNsfwAutoSelectJob(jobId) {
  if (!(await tryClaimNsfwAutoSelectJob(jobId))) return;
  await executeNsfwAutoSelectJobWork(jobId);
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

    const modelExists = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
      select: { id: true },
    });
    if (!modelExists) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    const job = await prisma.nsfwAutoSelectJob.create({
      data: {
        userId,
        modelId,
        description: description.trim().slice(0, 500),
        status: "pending",
      },
    });

    const runBg = () => processNsfwAutoSelectJob(job.id);
    try {
      const { waitUntil } = await import("@vercel/functions");
      waitUntil(runBg());
    } catch (e) {
      console.warn("NSFW auto-select: waitUntil unavailable, relying on status polling:", e?.message);
      void runBg();
    }

    return res.status(202).json({
      success: true,
      jobId: job.id,
      status: "pending",
    });
  } catch (error) {
    console.error("Auto-select error:", error);
    const msg = error?.message || "Failed to auto-select";
    res.status(500).json({ success: false, message: msg });
  }
}

export async function getNsfwAutoSelectJobStatus(req, res) {
  try {
    const userId = req.user.userId;
    const { jobId } = req.params;
    if (!jobId || typeof jobId !== "string") {
      return res.status(400).json({ success: false, message: "Job ID required" });
    }

    let job = await prisma.nsfwAutoSelectJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    if (job.status === "pending") {
      const claimed = await tryClaimNsfwAutoSelectJob(jobId);
      if (claimed) {
        await executeNsfwAutoSelectJobWork(jobId);
      }
      job = await prisma.nsfwAutoSelectJob.findUnique({ where: { id: jobId } });
    }

    if (job.status === "completed") {
      return res.json({
        success: true,
        status: "completed",
        selections: job.selections && typeof job.selections === "object" ? job.selections : {},
      });
    }
    if (job.status === "failed") {
      return res.json({
        success: false,
        status: "failed",
        message: job.errorMessage || "Auto-select failed",
      });
    }

    return res.json({ success: true, status: "processing" });
  } catch (error) {
    console.error("getNsfwAutoSelectJobStatus error:", error);
    res.status(500).json({ success: false, message: "Failed to load job status" });
  }
}

// ============================================
// PLAN: auto-select chips + generate prompt (async 202 + poll, like NsfwAutoSelectJob)
// POST /api/nsfw/plan-generation → 202 { jobId }
// GET  /api/nsfw/plan-generation/status/:jobId
// ============================================

async function tryClaimNsfwPlanGenerationJob(jobId) {
  const r = await prisma.nsfwPlanGenerationJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "processing" },
  });
  return r.count === 1;
}

async function executeNsfwPlanGenerationJobWork(jobId) {
  const row = await prisma.nsfwPlanGenerationJob.findUnique({
    where: { id: jobId },
    select: { userId: true, modelId: true, userRequest: true },
  });
  if (!row) {
    await prisma.nsfwPlanGenerationJob.updateMany({
      where: { id: jobId, status: "processing" },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb("Plan job missing"),
        completedAt: new Date(),
      },
    });
    return;
  }

  const desc = row.userRequest;
  try {
    const model = await prisma.savedModel.findFirst({
      where: { id: row.modelId, userId: row.userId },
    });
    if (!model) {
      await prisma.nsfwPlanGenerationJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb("Model not found"),
          completedAt: new Date(),
        },
      });
      return;
    }

    const selections = await runNsfwAutoSelectSelections(row.userId, row.modelId, desc);
    const attrsStr = Object.values(selections).filter(Boolean).join(", ");
    const prompt = await runNsfwPromptGenerationForModel(model, desc, selections, attrsStr);

    if (isNsfwPromptLogicalConflict(prompt)) {
      await prisma.nsfwPlanGenerationJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(humanizeNsfwPromptConflict(prompt)),
          selections,
          completedAt: new Date(),
        },
      });
      return;
    }

    await prisma.nsfwPlanGenerationJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        selections,
        prompt,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
  } catch (e) {
    const raw = e?.message || "Failed to plan generation";
    let httpMessage = raw;
    if (raw === "Model not found") httpMessage = raw;
    else if (raw === "AI not configured" || raw === "AI auto-select failed") httpMessage = raw;
    await prisma.nsfwPlanGenerationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(String(httpMessage).slice(0, 500)),
        completedAt: new Date(),
      },
    });
  }
}

async function processNsfwPlanGenerationJob(jobId) {
  if (!(await tryClaimNsfwPlanGenerationJob(jobId))) return;
  await executeNsfwPlanGenerationJobWork(jobId);
}

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

    const modelExists = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
      select: { id: true },
    });
    if (!modelExists) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    const job = await prisma.nsfwPlanGenerationJob.create({
      data: {
        userId,
        modelId,
        userRequest: userRequest.trim().slice(0, 500),
        status: "pending",
      },
    });

    const runBg = () => processNsfwPlanGenerationJob(job.id);
    try {
      const { waitUntil } = await import("@vercel/functions");
      waitUntil(runBg());
    } catch (e) {
      console.warn("NSFW plan-generation: waitUntil unavailable, relying on status polling:", e?.message);
      void runBg();
    }

    return res.status(202).json({
      success: true,
      jobId: job.id,
      status: "pending",
    });
  } catch (error) {
    console.error("planNsfwGeneration error:", error);
    const msg = error?.message || "Failed to plan generation";
    res.status(500).json({ success: false, message: msg });
  }
}

export async function getNsfwPlanGenerationJobStatus(req, res) {
  try {
    const userId = req.user.userId;
    const { jobId } = req.params;
    if (!jobId || typeof jobId !== "string") {
      return res.status(400).json({ success: false, message: "Job ID required" });
    }

    let job = await prisma.nsfwPlanGenerationJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    if (job.status === "pending") {
      const claimed = await tryClaimNsfwPlanGenerationJob(jobId);
      if (claimed) {
        await executeNsfwPlanGenerationJobWork(jobId);
      }
      job = await prisma.nsfwPlanGenerationJob.findUnique({ where: { id: jobId } });
    }

    if (job.status === "completed") {
      return res.json({
        success: true,
        status: "completed",
        selections: job.selections && typeof job.selections === "object" ? job.selections : {},
        prompt: job.prompt || "",
        sceneDescription: job.userRequest,
      });
    }
    if (job.status === "failed") {
      return res.json({
        success: false,
        status: "failed",
        message: job.errorMessage || "Plan failed",
        selections: job.selections && typeof job.selections === "object" ? job.selections : {},
        sceneDescription: job.userRequest,
      });
    }

    return res.json({ success: true, status: "processing" });
  } catch (error) {
    console.error("getNsfwPlanGenerationJobStatus error:", error);
    res.status(500).json({ success: false, message: "Failed to load job status" });
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

    const falKey = (process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
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
        Authorization: `Key ${falKey}`,
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
    const falKey = (process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();

    const response = await fetch(
      `https://queue.fal.run/fal-ai/flux-pro-finetuned-v1/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${falKey}` } },
    );

    if (!response.ok) {
      return res.status(500).json({ success: false, message: "Failed to check status" });
    }

    const statusData = await response.json();

    if (statusData.status === "COMPLETED") {
      const resultRes = await fetch(
        `https://queue.fal.run/fal-ai/flux-pro-finetuned-v1/requests/${requestId}`,
        { headers: { Authorization: `Key ${falKey}` } },
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
// Advanced NSFW — responds immediately; Seedream/KIE submit runs in background (avoids 504 when WS polls inline).
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

    // Normalize WaveSpeed-style "1024x1024" to kie.ai aspect ratio "1:1"
    const kieAspectRatio = aspectRatio === "1024x1024" ? "1:1" : aspectRatio;

    // Immediate response (mirrors POST /generate/advanced-image): WaveSpeed submit + optional waitForResult run in IIFE below.
    res.json({
      success: true,
      deferred: true,
      generationId,
      generation: { id: generationId, status: "processing" },
      creditsUsed: creditCost,
      message: "Generation started; result will appear when ready.",
    });

    void (async () => {
      const { getUserFriendlyGenerationError } = await import("../utils/generationErrorMessages.js");
      try {
        let result;
        if (model === "seedream") {
          console.log("Using Seedream 4.5 Edit via WaveSpeed (background)");
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
          console.log("Using Nano Banana Pro via kie.ai (background)");
          result = await generateImageWithNanoBananaKie(identityImages, prompt, {
            aspectRatio: kieAspectRatio,
            resolution: "2K",
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
            data: {
              replicateModel:
                model === "seedream"
                  ? `wavespeed-seedream:${result.taskId}`
                  : `kie-task:${result.taskId}`,
            },
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
          return;
        }

        if (result?.success && result?.outputUrl) {
          await prisma.generation.update({
            where: { id: generationId },
            data: { status: "completed", outputUrl: result.outputUrl, completedAt: new Date() },
          });
          console.log("Advanced NSFW generation completed:", result.outputUrl);
          return;
        }

        const errMsg = result?.error || "Generation failed - no output URL";
        const friendlyMessage = getUserFriendlyGenerationError(errMsg);
        await refundGeneration(generationId).catch(() => {});
        await prisma.generation
          .update({
            where: { id: generationId },
            data: {
              status: "failed",
              errorMessage: getErrorMessageForDb(friendlyMessage),
              completedAt: new Date(),
            },
          })
          .catch(() => {});
        console.error("❌ Advanced NSFW generation failed:", errMsg);
      } catch (error) {
        console.error("❌ Advanced NSFW background error:", error?.message || error);
        const friendlyMessage = getUserFriendlyGenerationError(error?.message || String(error));
        try {
          await refundGeneration(generationId);
        } catch (refundError) {
          console.error("Refund error:", refundError.message);
        }
        try {
          await prisma.generation.update({
            where: { id: generationId },
            data: {
              status: "failed",
              errorMessage: getErrorMessageForDb(friendlyMessage),
              completedAt: new Date(),
            },
          });
        } catch (dbErr) {
          console.error("⚠️ Failed to update NSFW generation to failed:", dbErr.message);
        }
      }
    })();
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

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Generation failed",
      });
    }
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
  recoverStaleLoraTrainings,
  startNsfwPoller,
  generateNsfwVideoFromImage,
  extendNsfwVideo,
};

let nsfwPollerInterval = null;
let nsfwPollerRunning = false;

const NSFW_RECOVERY_POLL_CONCURRENCY = Math.max(
  1,
  Math.min(20, Number(process.env.NSFW_RECOVERY_POLL_CONCURRENCY) || 8),
);

async function pollProcessingNsfwGenerations() {
  if (nsfwPollerRunning) return;
  nsfwPollerRunning = true;

  try {
    const processingGens = await prisma.generation.findMany({
      where: {
        status: { in: ['queued', 'processing', 'pending'] },
        type: { in: ['nsfw', 'nsfw-video', 'nsfw-video-extend'] },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (processingGens.length === 0) {
      nsfwPollerRunning = false;
      return;
    }

    console.log(
      `\n🔄 [NSFW Poller] Checking ${processingGens.length} processing generation(s) (concurrency=${NSFW_RECOVERY_POLL_CONCURRENCY})`,
    );

    for (let i = 0; i < processingGens.length; i += NSFW_RECOVERY_POLL_CONCURRENCY) {
      const chunk = processingGens.slice(i, i + NSFW_RECOVERY_POLL_CONCURRENCY);
      await Promise.all(chunk.map((gen) => pollSingleNsfwGeneration(gen)));
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

  const replicate = typeof gen.replicateModel === "string" ? gen.replicateModel.trim() : "";
  const replicateLooksLikeTaskId =
    replicate &&
    !replicate.startsWith("kie-") &&
    !replicate.startsWith("wavespeed-") &&
    !replicate.startsWith("piapi-") &&
    !replicate.startsWith("comfyui-");

  const requestId =
    gen.providerTaskId ||
    inputData?.runpodJobId ||
    inputData?.comfyuiPromptId ||
    inputData?.runcomfyRequestId ||
    (replicateLooksLikeTaskId ? replicate : null);

  if (!requestId) {
    const age = Date.now() - new Date(gen.createdAt).getTime();
    // queued jobs are expected to be promoted quickly by background submitter; if not, fail+refund.
    const queuedTimeoutMs = 10 * 60 * 1000;
    const processingTimeoutMs = 20 * 60 * 1000;
    const timeoutMs = gen.status === "queued" ? queuedTimeoutMs : processingTimeoutMs;
    if (age > timeoutMs) {
      try {
        await refundGeneration(gen.id);
        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: 'failed',
            errorMessage: getErrorMessageForDb(
              gen.status === "queued"
                ? "Generation queue submission stalled before provider task creation"
                : "No provider request ID found",
            ),
            completedAt: new Date(),
          },
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
      try {
        const fin = await finalizeNsfwRunpodGeneration(gen.id, requestId, status._runpodOutput);
        if (fin.ok && !fin.skipped) {
          console.log(`  ✅ ${gen.id.substring(0, 8)} COMPLETED via recovery poller`);
        }
      } catch (e) {
        console.error(`  ❌ finalize error for ${gen.id.substring(0, 8)}:`, e.message);
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
      // Must be ≥ NSFW_MAX_WALL_MS (recovery poller must not fail rows still eligible for main poll)
      const stuckMaxSec = Number(process.env.NSFW_STUCK_MAX_AGE_SEC) || 200 * 60;
      if (age > stuckMaxSec) {
        try {
          await refundGeneration(gen.id);
        } catch (e) {
          console.error(`  ⏰ ${gen.id.substring(0,8)} refund error on TIMEOUT:`, e.message);
        }
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: 'failed', errorMessage: getErrorMessageForDb(`Generation timed out (${Math.round(stuckMaxSec / 60)} min)`), completedAt: new Date() },
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
  console.log(
    `🚀 Starting continuous NSFW generation poller (every 30s, up to ${NSFW_RECOVERY_POLL_CONCURRENCY} jobs in parallel)...`,
  );
  pollProcessingNsfwGenerations();
  nsfwPollerInterval = setInterval(pollProcessingNsfwGenerations, 30000);
}

export async function recoverStuckNsfwGenerations({ startContinuous = true } = {}) {
  await pollProcessingNsfwGenerations();
  if (startContinuous) {
    startNsfwPoller();
  }
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
