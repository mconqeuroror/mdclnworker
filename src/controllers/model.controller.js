import prisma from "../lib/prisma.js";
import { toUserError, isTransientAiUpstreamError } from "../lib/userError.js";
import {
  generateAIModelPhotos,
  generateReferenceImage,
  generateModelPosesFromReference,
  buildModelPosesPrompts,
  isExplicitContentError,
} from "../services/wavespeed.service.js";
import { generateImageWithNanoBananaKie, getKieCallbackUrl } from "../services/kie.service.js";
import {
  checkAndExpireCredits,
  getTotalCredits,
  deductCredits,
  refundCredits,
} from "../services/credit.service.js";
import { isR2Configured, uploadFileToR2, mirrorToR2 } from "../utils/r2.js";
import { buildAppearancePrefix } from "../utils/appearancePrompt.js";
import { getGenerationPricing } from "../services/generation-pricing.service.js";
import { deleteElevenLabsVoice } from "../services/elevenlabs.service.js";
import {
  deleteStoredMediaUrl,
  deleteStoredMediaFromOutputField,
} from "../utils/storageDelete.js";
import { persistKieGenerationCorrelation } from "../utils/kieTaskCorrelation.js";
import {
  validateGenerationUploadSync,
  sendUploadGuardResponse,
} from "../lib/generationUploadGuards.js";

const ONBOARDING_TRIAL_REFERENCE_TYPE = "onboarding_trial_reference";

/**
 * Get model limit based on subscription tier
 */
function getModelLimit(subscriptionTier) {
  const limits = {
    starter: 1,
    pro: 2,
    business: 4,
  };
  return limits[subscriptionTier] || 1; // Default to 1 if no tier or unknown tier
}

function buildStructuredGenerationError(errorMessage, fallbackMessage) {
  const safeError = String(errorMessage || "");
  if (isExplicitContentError(safeError)) {
    return {
      status: 422,
      body: {
        success: false,
        code: "PROMPT_FLAGGED",
        errorType: "content_policy",
        message: "Your prompt contains content that cannot be processed.",
        solution: "Please use a different description or images and try again.",
      },
    };
  }

  const { message, solution } = toUserError(safeError || fallbackMessage);
  return {
    status: 500,
    body: {
      success: false,
      code: "GENERATION_FAILED",
      errorType: "generation_error",
      message: message || "Generation failed. Please try again.",
      solution: solution || "Please try again. If it keeps happening, contact support.",
    },
  };
}

async function registerKieTask(taskId, entityType, entityId, step, userId, payload = null) {
  if (!taskId) return;
  await prisma.kieTask.upsert({
    where: { taskId },
    update: {
      entityType,
      entityId,
      step,
      userId: userId || null,
      status: "processing",
      payload: payload ?? undefined,
      errorMessage: null,
      outputUrl: null,
      completedAt: null,
    },
    create: {
      taskId,
      entityType,
      entityId,
      step,
      userId: userId || null,
      status: "processing",
      payload: payload ?? undefined,
    },
  });
}

function isMissingVoiceStudioTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    (message.includes("modelvoice") || message.includes("generatedvoiceaudio")) &&
    (message.includes("does not exist") ||
      message.includes("no such table") ||
      message.includes("relation") ||
      message.includes("table"))
  );
}

/**
 * Create a new saved model
 */
export async function createModel(req, res) {
  try {
    const { name, photo1Url, photo2Url, photo3Url, savedAppearance } = req.body;
    const userId = req.user.userId;

    // Validate
    if (!name || !photo1Url || !photo2Url || !photo3Url) {
      return res.status(400).json({
        success: false,
        message:
          "Need model name and exactly 3 photos (photo1Url, photo2Url, photo3Url)",
      });
    }

    // Get user maxModels setting and current model count
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { maxModels: true, subscriptionTier: true, role: true },
    });

    const currentModelCount = await prisma.savedModel.count({
      where: { userId },
    });

    const modelLimit = user?.maxModels ?? getModelLimit(user?.subscriptionTier);

    // Check if user has reached their model limit (admins are exempt)
    if (user?.role !== 'admin' && currentModelCount >= modelLimit) {
      return res.status(403).json({
        success: false,
        message: `Model limit reached. You can create up to ${modelLimit} model(s). Contact admin to increase your limit.`,
        currentCount: currentModelCount,
        limit: modelLimit,
      });
    }

    // Check if model name already exists for this user
    const existing = await prisma.savedModel.findFirst({
      where: { userId, name },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Model named "${name}" already exists. Please choose a different name.`,
      });
    }

    // Create model
    // IMPORTANT: User-uploaded photos are NOT AI-generated
    // This means NSFW features will NOT be available for this model
    // This protects real people from non-consensual content
    const model = await prisma.savedModel.create({
      data: {
        userId,
        name,
        photo1Url,
        photo2Url,
        photo3Url,
        thumbnail: photo1Url, // Use first photo as thumbnail
        isAIGenerated: false,  // User-uploaded = NO NSFW allowed
        ...(savedAppearance && typeof savedAppearance === "object" && { savedAppearance }),
      },
    });

    res.json({
      success: true,
      message: `Model "${name}" created successfully!`,
      model: {
        id: model.id,
        name: model.name,
        photo1Url: model.photo1Url,
        photo2Url: model.photo2Url,
        photo3Url: model.photo3Url,
        thumbnail: model.thumbnail,
        createdAt: model.createdAt,
        isAIGenerated: false,
        savedAppearance: model.savedAppearance ?? null,
      },
    });
  } catch (error) {
    console.error("Create model error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Get all user's models
 */
export async function getUserModels(req, res) {
  try {
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.sub;
    if (!userId) {
      console.warn("GetUserModels: missing userId on req.user", { keys: req.user ? Object.keys(req.user) : [] });
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const models = await prisma.savedModel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        photo1Url: true,
        photo2Url: true,
        photo3Url: true,
        thumbnail: true,
        createdAt: true,
        // NSFW fields
        isAIGenerated: true,
        nsfwOverride: true,
        loraStatus: true,
        loraSessionPaid: true,
        loraUrl: true,
        loraTriggerWord: true,
        nsfwUnlocked: true,
        looksUnlockedByAdmin: true,
        age: true,
        activeLoraId: true,
        savedAppearance: true,
        aiGenerationParams: true,
        status: true,
        elevenLabsVoiceId: true,
        elevenLabsVoiceType: true,
        elevenLabsVoiceName: true,
        modelVoicePreviewUrl: true,
      },
    });

    // Get user maxModels setting for model limit info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { maxModels: true },
    });

    const modelLimit = user?.maxModels ?? getModelLimit(user?.subscriptionTier);

    res.json({
      success: true,
      models,
      count: models.length,
      limit: modelLimit,
      canCreateMore: models.length < modelLimit,
    });
  } catch (error) {
    console.error("Get models error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Get single model by ID
 */
export async function getModelById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const model = await prisma.savedModel.findFirst({
      where: { id, userId },
      include: {
        modelVoices: {
          select: {
            elevenLabsVoiceId: true,
            previewUrl: true,
            sampleAudioUrl: true,
          },
        },
        generatedVoiceAudios: {
          select: {
            audioUrl: true,
          },
        },
      },
    });

    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    res.json({
      success: true,
      model: {
        id: model.id,
        name: model.name,
        photo1Url: model.photo1Url,
        photo2Url: model.photo2Url,
        photo3Url: model.photo3Url,
        thumbnail: model.thumbnail,
        createdAt: model.createdAt,
        status: model.status,
        elevenLabsVoiceId: model.elevenLabsVoiceId,
        elevenLabsVoiceType: model.elevenLabsVoiceType,
        elevenLabsVoiceName: model.elevenLabsVoiceName,
        modelVoicePreviewUrl: model.modelVoicePreviewUrl,
      },
    });
  } catch (error) {
    console.error("Get model error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Delete model
 */
export async function deleteModel(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const model = await prisma.savedModel.findFirst({
      where: { id, userId },
    });

    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    const activeGens = await prisma.generation.count({
      where: { modelId: id, status: { in: ["processing", "pending"] } },
    });
    if (activeGens > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete model while ${activeGens} generation(s) are in progress. Please wait for them to complete.`,
      });
    }

    const generations = await prisma.generation.findMany({
      where: { modelId: id },
      select: { outputUrl: true, inputImageUrl: true, inputVideoUrl: true },
    });
    for (const g of generations) {
      await deleteStoredMediaUrl(g.inputImageUrl);
      await deleteStoredMediaUrl(g.inputVideoUrl);
      await deleteStoredMediaFromOutputField(g.outputUrl);
    }

    const trainedLoras = await prisma.trainedLora.findMany({
      where: { modelId: id },
      select: { loraUrl: true, faceReferenceUrl: true },
    });
    for (const tl of trainedLoras) {
      await deleteStoredMediaUrl(tl.loraUrl);
      await deleteStoredMediaUrl(tl.faceReferenceUrl);
    }

    const trainingImages = await prisma.loraTrainingImage.findMany({
      where: { modelId: id },
      select: { imageUrl: true },
    });
    for (const ti of trainingImages) {
      await deleteStoredMediaUrl(ti.imageUrl);
    }

    for (const url of [model.photo1Url, model.photo2Url, model.photo3Url, model.thumbnail, model.loraUrl, model.faceReferenceUrl, model.modelVoicePreviewUrl]) {
      await deleteStoredMediaUrl(url);
    }

    const avatars = await prisma.avatar.findMany({
      where: { modelId: id },
      include: { videos: true },
    });
    for (const av of avatars) {
      await deleteStoredMediaUrl(av.photoUrl);
      for (const vid of av.videos || []) await deleteStoredMediaUrl(vid.outputUrl);
    }

    let modelVoices = [];
    let generatedVoiceAudios = [];
    try {
      [modelVoices, generatedVoiceAudios] = await Promise.all([
        prisma.modelVoice.findMany({
          where: { modelId: id },
          select: { elevenLabsVoiceId: true, previewUrl: true, sampleAudioUrl: true },
        }),
        prisma.generatedVoiceAudio.findMany({
          where: { modelId: id },
          select: { audioUrl: true, previewUrlSnapshot: true },
        }),
      ]);
    } catch (error) {
      if (!isMissingVoiceStudioTableError(error)) {
        throw error;
      }
      console.warn("Voice Studio tables missing during model delete; skipping related voice cleanup.");
    }

    modelVoices = Array.isArray(modelVoices) ? modelVoices : [];
    generatedVoiceAudios = Array.isArray(generatedVoiceAudios) ? generatedVoiceAudios : [];

    const voiceIdsToDelete = new Set(
      [
        model.elevenLabsVoiceId,
        ...modelVoices.map((voice) => voice.elevenLabsVoiceId),
      ].filter(Boolean),
    );
    for (const voiceId of voiceIdsToDelete) {
      try {
        await deleteElevenLabsVoice(voiceId);
      } catch (e) { /* best-effort */ }
    }

    for (const voice of modelVoices) {
      await deleteStoredMediaUrl(voice.previewUrl);
      await deleteStoredMediaUrl(voice.sampleAudioUrl);
    }
    for (const audio of generatedVoiceAudios) {
      await deleteStoredMediaUrl(audio.audioUrl);
      await deleteStoredMediaUrl(audio.previewUrlSnapshot);
    }

    await prisma.generation.deleteMany({ where: { modelId: id } });

    await prisma.savedModel.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: `Model "${model.name}" deleted successfully`,
    });
  } catch (error) {
    console.error("Delete model error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Update model
 */
export async function updateModel(req, res) {
  try {
    const { id } = req.params;
    const { name, photo1Url, photo2Url, photo3Url, age, savedAppearance } = req.body;
    const userId = req.user.userId;

    if (age !== undefined && age !== null && age !== "") {
      const ageNum = parseInt(age, 10);
      if (isNaN(ageNum) || ageNum < 1 || ageNum > 85) {
        return res.status(400).json({ success: false, message: "Age must be between 1 and 85" });
      }
    }

    // Validate savedAppearance if provided — strip `age` from it (age lives on model.age only)
    if (savedAppearance !== undefined && savedAppearance !== null) {
      if (typeof savedAppearance !== "object" || Array.isArray(savedAppearance)) {
        return res.status(400).json({ success: false, message: "savedAppearance must be an object" });
      }
      // Ensure age never leaks into savedAppearance JSON
      delete savedAppearance.age;
    }

    const model = await prisma.savedModel.findFirst({
      where: { id, userId },
    });

    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    // Check if photos are locked (AI-generated, NSFW override, or LoRA trained) unless admin unlocked
    const photosLocked =
      (model.isAIGenerated || model.nsfwOverride || model.nsfwUnlocked) && !model.looksUnlockedByAdmin;
    const isChangingPhotos = photo1Url || photo2Url || photo3Url;

    if (photosLocked && isChangingPhotos) {
      return res.status(403).json({
        success: false,
        message: "Photos are locked. Models with NSFW access cannot have their photos changed to protect against misuse.",
        photosLocked: true,
      });
    }

    // Check if new name conflicts with existing model
    if (name && name !== model.name) {
      const existing = await prisma.savedModel.findFirst({
        where: {
          userId,
          name,
          id: { not: id },
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Model named "${name}" already exists`,
        });
      }
    }

    const updatedModel = await prisma.savedModel.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(photo1Url && { photo1Url, thumbnail: photo1Url }),
        ...(photo2Url && { photo2Url }),
        ...(photo3Url && { photo3Url }),
        ...(age !== undefined && { age: (age === null || age === "") ? null : parseInt(age, 10) }),
        ...(savedAppearance !== undefined && { savedAppearance }),
      },
    });

    res.json({
      success: true,
      message: "Model updated successfully",
      model: {
        id: updatedModel.id,
        name: updatedModel.name,
        age: updatedModel.age,
        savedAppearance: updatedModel.savedAppearance,
        aiGenerationParams: updatedModel.aiGenerationParams,
        photo1Url: updatedModel.photo1Url,
        photo2Url: updatedModel.photo2Url,
        photo3Url: updatedModel.photo3Url,
        thumbnail: updatedModel.thumbnail,
        createdAt: updatedModel.createdAt,
        elevenLabsVoiceId: updatedModel.elevenLabsVoiceId,
        elevenLabsVoiceType: updatedModel.elevenLabsVoiceType,
        elevenLabsVoiceName: updatedModel.elevenLabsVoiceName,
        modelVoicePreviewUrl: updatedModel.modelVoicePreviewUrl,
      },
    });
  } catch (error) {
    console.error("Update model error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Generate AI model from parameters and prompt
 * Creates a fictional person with 3 consistent photos
 */
export async function generateAIModel(req, res) {
  let creditsDeducted = 0;
  let userId = null;
  
  try {
    const { name, prompt, gender, age, hairColor, eyeColor, style } =
      req.body;
    userId = req.user.userId;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Model name is required",
      });
    }

    if (!gender) {
      return res.status(400).json({
        success: false,
        message: "Gender is required",
      });
    }

    // Get user and check model limit
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { maxModels: true, subscriptionTier: true, role: true },
    });

    const currentModelCount = await prisma.savedModel.count({
      where: { userId },
    });

    const modelLimit = user?.maxModels ?? 999;

    if (user?.role !== 'admin' && currentModelCount >= modelLimit) {
      return res.status(403).json({
        success: false,
        message: `Model limit reached. You can create up to ${modelLimit} model(s). Contact admin to increase your limit.`,
        currentCount: currentModelCount,
        limit: modelLimit,
      });
    }

    // Check if model name already exists
    const existing = await prisma.savedModel.findFirst({
      where: { userId, name },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Model named "${name}" already exists. Please choose a different name.`,
      });
    }

    // AI model generation uses KIE (kie.ai) — require API key
    if (!process.env.KIE_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "AI model generation is not configured. Please contact support.",
      });
    }

    const pricing = await getGenerationPricing();
    const creditsNeeded = pricing.modelCreateAi;
    const userCredits = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(userCredits);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits to generate AI model. You have ${totalCredits} credits.`,
      });
    }

    // Deduct credits upfront
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits for AI model generation`);

    // Generate AI model photos
    console.log("\n🤖 Starting AI model generation...");
    console.log("Parameters:", {
      name,
      prompt,
      gender,
      age,
      hairColor,
      eyeColor,
      style,
    });

    const generationResult = await generateAIModelPhotos({
      prompt: prompt || "",
      gender,
      age,
      hairColor,
      eyeColor,
      style: style || "professional",
    });

    if (!generationResult.success) {
      // Refund credits on all generation failures (including prompt moderation)
      try {
        await refundCredits(userId, creditsNeeded);
        console.log(
          `💰 Refunded ${creditsNeeded} credits due to generation failure`,
        );
      } catch (refundError) {
        console.error("CRITICAL: Failed to refund credits:", refundError);
      }

      const failure = buildStructuredGenerationError(
        generationResult.error,
        "AI model generation failed. Please try a different prompt.",
      );
      return res.status(failure.status).json(failure.body);
    }

    const { photo1Url, photo2Url, photo3Url } = generationResult.photos;

    // Create model in database
    // Mark as AI-generated for NSFW eligibility
    const model = await prisma.savedModel.create({
      data: {
        userId,
        name,
        photo1Url,
        photo2Url,
        photo3Url,
        thumbnail: photo1Url,
        isAIGenerated: true,  // AI-generated = eligible for NSFW
        aiGenerationParams: JSON.stringify({
          prompt: prompt || "",
          gender,
          age,
          hairColor,
          eyeColor,
          style: style || "professional",
          generatedAt: new Date().toISOString(),
        }),
      },
    });

    // Get updated credits
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true,
      },
    });

    const remainingCredits =
      (updatedUser.credits || 0) +
      (updatedUser.subscriptionCredits || 0) +
      (updatedUser.purchasedCredits || 0);

    res.json({
      success: true,
      message: `AI Model "${name}" generated successfully!`,
      model: {
        id: model.id,
        name: model.name,
        photo1Url: model.photo1Url,
        photo2Url: model.photo2Url,
        photo3Url: model.photo3Url,
        thumbnail: model.thumbnail,
        createdAt: model.createdAt,
        isAIGenerated: true,
        nsfwUnlocked: false,
        loraStatus: null,
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: remainingCredits,
    });
  } catch (error) {
    console.error("Generate AI model error:", error);
    
    // CRITICAL: Refund credits if deducted before error
    let refundSuccess = false;
    if (creditsDeducted > 0 && userId) {
      try {
        await refundCredits(userId, creditsDeducted);
        refundSuccess = true;
        console.log(`💰 Emergency refund: ${creditsDeducted} credits returned due to server error`);
      } catch (refundError) {
        console.error("CRITICAL: Failed to refund credits:", refundError);
      }
    }
    
    const message = refundSuccess
      ? "Server error - your credits have been refunded"
      : creditsDeducted > 0
        ? "Server error - please contact support for credit refund"
        : "Server error";
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      errorType: "server_error",
      message,
    });
  }
}

/**
 * Generate reference image for AI model (Phase 1)
 * User can regenerate until satisfied, then continue to Phase 2
 */
export async function generateAIModelReference(req, res) {
  let creditsDeducted = 0;
  let userId = null;
  
  try {
    const {
      referencePrompt,
      gender,
      age,
      savedAppearance,
      hairColor,
      hairLength,
      hairTexture,
      lipSize,
      faceType,
      eyeColor,
      style,
      bodyType,
      heritage,
    } = req.body;
    userId = req.user.userId;

    // Validate required fields
    if (!gender) {
      return res.status(400).json({
        success: false,
        message: "Gender is required",
      });
    }

    if (!process.env.KIE_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "AI model generation is not configured. Please contact support.",
      });
    }

    const pricing = await getGenerationPricing();
    // Step 1 pricing
    const isRegeneration = req.body.regenerate === true;
    const creditsNeeded = pricing.modelStep1Reference;
    const userCredits = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(userCredits);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits to ${isRegeneration ? 'regenerate face' : 'create AI model reference'}. You have ${totalCredits} credits.`,
      });
    }

    // Deduct credits upfront
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(
      `💳 Deducted ${creditsNeeded} credits for ${isRegeneration ? 'face regeneration' : 'AI model creation (full cost upfront)'}`,
    );

    // Generate reference image
    console.log("\n🤖 Starting reference image generation...");
    console.log("Parameters:", {
      referencePrompt,
      gender,
      age,
      savedAppearance,
      hairColor,
      hairLength,
      hairTexture,
      lipSize,
      faceType,
      eyeColor,
      style,
      bodyType,
      heritage,
    });

    const generationResult = await generateReferenceImage({
      referencePrompt: referencePrompt || "",
      gender,
      age,
      savedAppearance: savedAppearance && typeof savedAppearance === "object" ? savedAppearance : undefined,
      hairColor,
      hairLength,
      hairTexture,
      lipSize,
      faceType,
      eyeColor,
      style: style || "natural",
      bodyType,
      heritage,
    });

    if (!generationResult.success) {
      // Refund credits on all generation failures (including prompt moderation)
      try {
        await refundCredits(userId, creditsNeeded);
        console.log(
          `💰 Refunded ${creditsNeeded} credits due to generation failure`,
        );
      } catch (refundError) {
        console.error("CRITICAL: Failed to refund credits:", refundError);
      }

      const failure = buildStructuredGenerationError(
        generationResult.error,
        "Reference image generation failed. Please try a different prompt.",
      );
      return res.status(failure.status).json(failure.body);
    }

    // Get updated credits
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true,
      },
    });

    const remainingCredits =
      (updatedUser.credits || 0) +
      (updatedUser.subscriptionCredits || 0) +
      (updatedUser.purchasedCredits || 0);

    res.json({
      success: true,
      message: "Reference image generated successfully!",
      referenceUrl: generationResult.referenceUrl,
      creditsUsed: creditsNeeded,
      creditsRemaining: remainingCredits,
    });
  } catch (error) {
    console.error("Generate reference image error:", error);
    
    // CRITICAL: Refund credits if deducted before error
    let refundSuccess = false;
    if (creditsDeducted > 0 && userId) {
      try {
        await refundCredits(userId, creditsDeducted);
        refundSuccess = true;
        console.log(`💰 Emergency refund: ${creditsDeducted} credits returned due to server error`);
      } catch (refundError) {
        console.error("CRITICAL: Failed to refund credits:", refundError);
      }
    }
    
    const message = refundSuccess
      ? "Server error - your credits have been refunded"
      : creditsDeducted > 0
        ? "Server error - please contact support for credit refund"
        : "Server error";
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      errorType: "server_error",
      message,
    });
  }
}

/**
 * Generate 3 model poses from reference image (Phase 2)
 * Returns immediately with status="generating"; photos are produced in the background.
 * Frontend polls /models/status/:id until status === "ready".
 */
export async function generateAIModelPoses(req, res) {
  let creditsDeducted = 0;
  let userId = null;
  try {
    const {
      name,
      referenceUrl,
      posesPrompt,
      outfitType,
      poseStyle,
      gender,
      age,
      hairColor,
      hairLength,
      hairTexture,
      lipSize,
      faceType,
      eyeColor,
      style,
      bodyType,
      heritage,
    } = req.body;
    userId = req.user.userId;

    if (!name) {
      return res.status(400).json({ success: false, message: "Model name is required" });
    }
    if (!referenceUrl) {
      return res.status(400).json({ success: false, message: "Reference image URL is required" });
    }
    if (!process.env.KIE_API_KEY) {
      return res.status(503).json({ success: false, message: "AI model generation is not configured. Please contact support." });
    }

    const pricing = await getGenerationPricing();
    // Step 2 pricing
    const creditsNeeded = pricing.modelStep2Poses;
    const userCredits = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(userCredits);
    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits to complete AI model generation. You have ${totalCredits} credits.`,
      });
    }
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    let modelAge = null;
    if (age !== undefined && age !== null && age !== "") {
      const parsedAge = parseInt(age, 10);
      if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
        return res.status(400).json({ success: false, message: "Age must be between 1 and 120" });
      }
      modelAge = parsedAge;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { maxModels: true, subscriptionTier: true, role: true },
    });

    const currentModelCount = await prisma.savedModel.count({ where: { userId } });
    const modelLimit = user?.maxModels ?? 999;

    if (user?.role !== "admin" && currentModelCount >= modelLimit) {
      return res.status(403).json({
        success: false,
        message: `Model limit reached. You can create up to ${modelLimit} model(s). Contact admin to increase your limit.`,
        currentCount: currentModelCount,
        limit: modelLimit,
      });
    }

    const existing = await prisma.savedModel.findFirst({ where: { userId, name } });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Model named "${name}" already exists. Please choose a different name.`,
      });
    }

    const callbackUrl = getKieCallbackUrl();
    if (!callbackUrl) {
      return res.status(503).json({
        success: false,
        message: "KIE callback URL is not configured. Please contact support.",
      });
    }

    // Pre-compute all prompts so callback chain can use stable values.
    const posesOptions = {
      posesPrompt: posesPrompt || "",
      outfitType: outfitType || "",
      poseStyle: poseStyle || "seductive",
      gender: gender || "",
      hairColor: hairColor || "",
      hairLength: hairLength || "",
      hairTexture: hairTexture || "",
      lipSize: lipSize || "",
      faceType: faceType || "",
      eyeColor: eyeColor || "",
      style: style || "",
      bodyType: bodyType || "",
      heritage: heritage || "",
    };
    const { selfiePrompt, portraitPrompt, fullBodyPrompt } = buildModelPosesPrompts(referenceUrl, posesOptions);

    // Create in processing state; callback marks done only after mirror+save.
    const model = await prisma.savedModel.create({
      data: {
        userId,
        name,
        photo1Url: "",
        photo2Url: "",
        photo3Url: "",
        thumbnail: "",
        status: "processing",
        isAIGenerated: true,
        aiGenerationParams: {
          type: "model-poses",
          referenceUrl,
          selfiePrompt,
          portraitPrompt,
          fullBodyPrompt,
          posesOptions,
          generatedAt: new Date().toISOString(),
          userId,
          creditsNeeded,
        },
        savedAppearance: {
          gender: gender || "",
          hairColor: hairColor || "",
          hairLength: hairLength || "",
          hairTexture: hairTexture || "",
          lipSize: lipSize || "",
          faceType: faceType || "",
          eyeColor: eyeColor || "",
          style: style || "",
          bodyType: bodyType || "",
          heritage: heritage || "",
        },
        ...(modelAge ? { age: modelAge } : {}),
      },
    });

    // Submit photo 1 immediately; callback route chains photo2/photo3.
    const photo1Result = await generateImageWithNanoBananaKie(
      [referenceUrl],
      selfiePrompt,
      {
        model: "nano-banana-pro",
        resolution: "2K",
        aspectRatio: "1:1",
        onTaskCreated: async (taskId) => {
          await registerKieTask(taskId, "saved_model_photo", model.id, "photo1", userId, {
            flow: "model-poses",
          });
          await prisma.savedModel.update({
            where: { id: model.id },
            data: {
              aiGenerationParams: {
                type: "model-poses",
                referenceUrl,
                selfiePrompt,
                portraitPrompt,
                fullBodyPrompt,
                posesOptions,
                photo1TaskId: taskId,
                generatedAt: new Date().toISOString(),
                userId,
                creditsNeeded,
              },
            },
          });
        },
      },
    );

    if (!photo1Result?.deferred || !photo1Result?.taskId) {
      await prisma.savedModel.update({
        where: { id: model.id },
        data: { status: "failed" },
      });
      await refundCredits(userId, creditsNeeded);
      creditsDeducted = 0;
      return res.status(500).json({
        success: false,
        message: "Failed to submit model generation task to KIE callback flow.",
      });
    }

    return res.status(202).json({
      success: true,
      modelStatus: "processing",
      message: `AI Model "${name}" is processing.`,
      model: {
        id: model.id,
        name: model.name,
        status: "processing",
        photo1Url: null,
        photo2Url: null,
        photo3Url: null,
        thumbnail: null,
        createdAt: model.createdAt,
        isAIGenerated: true,
        nsfwUnlocked: false,
        loraStatus: null,
      },
    });

  } catch (error) {
    console.error("Generate AI model poses error:", error);
    if (creditsDeducted > 0 && userId) {
      try {
        await refundCredits(userId, creditsDeducted);
      } catch (refundErr) {
        console.error("Failed to refund credits after pose generation error:", refundErr.message);
      }
    }
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
}

/**
 * Generate FREE trial reference image (no credits charged)
 * Only available once per user during onboarding
 */
export async function generateTrialReference(req, res) {
  try {
    const {
      referencePrompt,
      gender,
      age,
      hairColor,
      hairLength,
      hairTexture,
      lipSize,
      faceType,
      eyeColor,
      style,
      bodyType,
      heritage,
      savedAppearance,
    } = req.body;
    const userId = req.user.userId;

    if (age !== undefined && age !== null && age !== "") {
      const parsedAge = parseInt(age, 10);
      if (isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
        return res.status(400).json({
          success: false,
          message: "Age must be between 1 and 120",
        });
      }
    }

    // Check if user has already used their free trial
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hasUsedFreeTrial: true, onboardingCompleted: true },
    });

    // Skip trial check in development for testing (production only)
    const isProduction = process.env.NODE_ENV === 'production';
    if (user.hasUsedFreeTrial && isProduction) {
      return res.status(403).json({
        success: false,
        message: "You have already used your free trial. Purchase credits to continue.",
        code: "TRIAL_ALREADY_USED",
      });
    }

    // Validate required fields
    if (!gender) {
      return res.status(400).json({
        success: false,
        message: "Gender is required",
      });
    }

    console.log("\n🎁 Starting FREE TRIAL reference image generation (KIE callback + client polls generation)...");
    console.log("User:", userId);
    console.log("Parameters:", {
      referencePrompt,
      gender,
      age,
      hairColor,
      hairLength,
      hairTexture,
      lipSize,
      faceType,
      eyeColor,
      style,
      bodyType,
      heritage,
    });

    const inflight = await prisma.generation.findFirst({
      where: {
        userId,
        type: ONBOARDING_TRIAL_REFERENCE_TYPE,
        status: { in: ["pending", "processing"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (inflight) {
      return res.status(202).json({
        success: true,
        deferred: true,
        generationId: inflight.id,
        message:
          "Trial portrait is still generating. Poll GET /api/generations/:id until status is completed or failed.",
        isTrial: true,
        creditsUsed: 0,
      });
    }

    const promptSummary =
      [referencePrompt, gender, style || "natural"].filter(Boolean).join(" · ").slice(0, 2000)
      || "Onboarding trial reference";

    const generation = await prisma.generation.create({
      data: {
        userId,
        type: ONBOARDING_TRIAL_REFERENCE_TYPE,
        prompt: promptSummary,
        creditsCost: 0,
        status: "processing",
        isTrial: true,
        resolution: "2K",
      },
    });

    const generationResult = await generateReferenceImage(
      {
        referencePrompt: referencePrompt || "",
        gender,
        age,
        hairColor,
        hairLength,
        hairTexture,
        lipSize,
        faceType,
        eyeColor,
        style: style || "natural",
        bodyType,
        heritage,
        savedAppearance,
      },
      {
        deferred: true,
        onTaskCreated: (taskId) =>
          persistKieGenerationCorrelation({
            taskId,
            generationId: generation.id,
            userId,
            kind: ONBOARDING_TRIAL_REFERENCE_TYPE,
          }),
      },
    );

    if (!generationResult.success) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: "failed",
          errorMessage: (generationResult.error || "Trial generation failed").slice(0, 2000),
          completedAt: new Date(),
        },
      });
      const { message, solution } = toUserError(generationResult.error);
      return res.status(500).json({
        success: false,
        message,
        solution,
      });
    }

    return res.status(202).json({
      success: true,
      deferred: true,
      generationId: generation.id,
      taskId: generationResult.taskId,
      message:
        "Trial portrait submitted. Poll GET /api/generations/:id until completed; outputUrl will contain the image.",
      isTrial: true,
      creditsUsed: 0,
    });
  } catch (error) {
    console.error("Generate trial reference error:", error);
    const { message, solution } = toUserError(error?.message);
    const status = isTransientAiUpstreamError(error?.message) ? 503 : 500;
    res.status(status).json({ success: false, message, solution });
  }
}

/**
 * Upload real photos during onboarding trial
 * Creates a model for the user with uploaded photos
 */
export async function trialUploadReal(req, res) {
  try {
    const userId = req.user.userId;

    // Check if user has already used their free trial
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hasUsedFreeTrial: true },
    });

    // Skip trial check in development for testing (production only)
    const isProduction = process.env.NODE_ENV === 'production';
    if (user.hasUsedFreeTrial && isProduction) {
      return res.status(403).json({
        success: false,
        message: "You have already used your free trial. Purchase credits to continue.",
        code: "TRIAL_ALREADY_USED",
      });
    }

    // Check if files were uploaded
    if (!req.files || !req.files.face1 || !req.files.face2 || !req.files.body) {
      return res.status(400).json({
        success: false,
        message: "Please upload 2 face photos and 1 body photo",
      });
    }

    for (const key of ["face1", "face2", "body"]) {
      const f = req.files[key][0];
      const check = validateGenerationUploadSync(f, "modelPhoto");
      if (!check.ok) return sendUploadGuardResponse(res, check);
    }

    let photo1Url, photo2Url, photo3Url;

    if (!isR2Configured()) {
      return res.status(503).json({ success: false, message: "File storage is not configured" });
    }

    console.log("\n📸 Uploading trial photos to R2...");
    
    [photo1Url, photo2Url, photo3Url] = await Promise.all([
      uploadFileToR2(req.files.face1[0], "models"),
      uploadFileToR2(req.files.face2[0], "models"),
      uploadFileToR2(req.files.body[0], "models"),
    ]);

    console.log("✅ Photos uploaded successfully");

    // Create model for user
    // IMPORTANT: User-uploaded photos are NOT AI-generated
    // This means NSFW features will NOT be available for this model
    // This protects real people from non-consensual content
    const modelName = req.body.name || "My Model";

    // Parse savedAppearance if provided (sent as JSON string in FormData)
    let savedAppearance = null;
    if (req.body.savedAppearance) {
      try {
        savedAppearance = typeof req.body.savedAppearance === "string"
          ? JSON.parse(req.body.savedAppearance)
          : req.body.savedAppearance;
      } catch {
        savedAppearance = null;
      }
    }

    // Parse age if provided
    let modelAge = null;
    if (req.body.age) {
      const parsedAge = parseInt(req.body.age, 10);
      if (!isNaN(parsedAge) && parsedAge >= 18 && parsedAge <= 90) {
        modelAge = parsedAge;
      }
    }

    const model = await prisma.savedModel.create({
      data: {
        userId,
        name: modelName,
        photo1Url,
        photo2Url,
        photo3Url,
        thumbnail: photo1Url,
        isAIGenerated: false,
        ...(savedAppearance && { savedAppearance }),
        ...(modelAge && { age: modelAge }),
      },
    });

    // Mark user as having used their free trial
    await prisma.user.update({
      where: { id: userId },
      data: { hasUsedFreeTrial: true },
    });

    console.log("✅ Trial model created - user marked as hasUsedFreeTrial=true");

    res.json({
      success: true,
      message: "Model created successfully!",
      model: {
        id: model.id,
        name: model.name,
        photo1Url: model.photo1Url,
        photo2Url: model.photo2Url,
        photo3Url: model.photo3Url,
        thumbnail: model.thumbnail,
        savedAppearance: model.savedAppearance || null,
      },
      isTrial: true,
    });
  } catch (error) {
    console.error("Trial upload error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Mark user's onboarding as completed
 */
export async function completeOnboarding(req, res) {
  try {
    const userId = req.user.userId;

    await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true },
    });

    res.json({
      success: true,
      message: "Onboarding completed",
    });
  } catch (error) {
    console.error("Complete onboarding error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function lockSpecialOffer(req, res) {
  try {
    const userId = req.user.userId;

    await prisma.user.update({
      where: { id: userId },
      data: { 
        specialOfferLockedAt: new Date(),
        onboardingCompleted: true,
      },
    });

    res.json({
      success: true,
      message: "Offer locked - redirecting to dashboard",
    });
  } catch (error) {
    console.error("Lock special offer error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function generateAdvancedModel(req, res) {
  let creditsDeducted = 0;
  let userId = null;

  try {
    const { name, photoConfigs, age: ageInput, gender, savedAppearance } = req.body;
    userId = req.user.userId;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Model name is required" });
    }
    if (!photoConfigs || !Array.isArray(photoConfigs) || photoConfigs.length !== 3) {
      return res.status(400).json({ success: false, message: "Exactly 3 photo configs required (selfie, portrait, full body)" });
    }

    // Age: allow 1–120. Stored on model; if < 18, NSFW and LoRA are blocked elsewhere.
    let modelAge = null;
    if (ageInput !== undefined && ageInput !== null && ageInput !== "") {
      const parsed = parseInt(ageInput, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 120) {
        return res.status(400).json({ success: false, message: "Age must be between 1 and 120" });
      }
      modelAge = parsed;
    }

    for (let i = 0; i < 3; i++) {
      const cfg = photoConfigs[i];
      if (!cfg.prompt || !cfg.prompt.trim()) {
        return res.status(400).json({ success: false, message: `Photo ${i + 1} requires a prompt` });
      }
      if (!cfg.referencePhotos || !Array.isArray(cfg.referencePhotos) || cfg.referencePhotos.length === 0) {
        return res.status(400).json({ success: false, message: `Photo ${i + 1} requires at least one reference photo` });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { maxModels: true, subscriptionTier: true, role: true },
    });

    const currentModelCount = await prisma.savedModel.count({ where: { userId } });
    const modelLimit = user?.maxModels ?? 999;

    if (user?.role !== 'admin' && currentModelCount >= modelLimit) {
      return res.status(403).json({
        success: false,
        message: `Model limit reached. You can create up to ${modelLimit} model(s).`,
      });
    }

    const existing = await prisma.savedModel.findFirst({ where: { userId, name: name.trim() } });
    if (existing) {
      return res.status(400).json({ success: false, message: `Model "${name}" already exists.` });
    }

    // Generate-from-photos uses KIE (kie.ai) — require API key
    if (!process.env.KIE_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "AI model generation is not configured. Please contact support.",
      });
    }

    const pricing = await getGenerationPricing();
    const creditsNeeded = pricing.modelFromPhotosAdvanced;
    const userCredits = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(userCredits);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for advanced model creation. You have ${totalCredits}.`,
      });
    }

    // Ensure all reference photo URLs are reachable (KIE must be able to fetch them)
    const allRefUrls = [...new Set(photoConfigs.flatMap((c) => c.referencePhotos || []).filter(Boolean))];
    for (const url of allRefUrls) {
      try {
        const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
        if (!head.ok) {
          return res.status(400).json({
            success: false,
            message: `Reference image could not be loaded (HTTP ${head.status}). Please re-upload the photo and try again.`,
          });
        }
      } catch (e) {
        console.warn("Reference photo HEAD check failed:", url, e?.message);
        return res.status(400).json({
          success: false,
          message: "One or more reference photos could not be reached. Please re-upload and try again.",
        });
      }
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits for advanced model creation`);

    // Pre-compute all 3 prompts now so they can be stored and reused in callback hops.
    const appearanceForPrompt = typeof savedAppearance === "object" && savedAppearance !== null
      ? { ...savedAppearance, gender: gender || savedAppearance.gender }
      : gender ? { gender } : {};
    const appearancePrefix = buildAppearancePrefix({ savedAppearance: appearanceForPrompt, age: modelAge });

    const PHOTO_ASPECTS    = ["1:1", "3:4", "9:16"];
    const PHOTO_PREFIXES   = [
      "Close-up selfie portrait of this person.",
      "Portrait photo of this person from a slightly different angle.",
      "Full body shot of this person.",
    ];
    const PHOTO_SUFFIXES   = [
      "High quality, clear face, well-lit, natural skin texture.",
      "Natural expression, professional photography, soft lighting.",
      "Shows full figure, professional photography, good lighting, natural pose.",
    ];
    const BLENDED_IDENTITY = "Synthesize a NEW fictional person by blending traits from the reference images. Do NOT exactly recreate any real person from the references. Keep one consistent synthesized identity across all generated shots.";

    const builtPhotoConfigs = photoConfigs.map((cfg, i) => ({
      fullPrompt: [appearancePrefix, BLENDED_IDENTITY, PHOTO_PREFIXES[i], cfg.prompt.trim(), PHOTO_SUFFIXES[i]].filter(Boolean).join(" "),
      referencePhotos: cfg.referencePhotos,
      aspectRatio: PHOTO_ASPECTS[i],
    }));

    const callbackUrl = getKieCallbackUrl();
    if (!callbackUrl) {
      await refundCredits(userId, creditsNeeded);
      creditsDeducted = 0;
      return res.status(503).json({
        success: false,
        message: "KIE callback URL is not configured. Please contact support.",
      });
    }

    // Create model in processing state. Callback chain fills photo URLs.
    const model = await prisma.savedModel.create({
      data: {
        userId,
        name: name.trim(),
        photo1Url: "",
        photo2Url: "",
        photo3Url: "",
        thumbnail: "",
        status: "processing",
        isAIGenerated: true,
        age: modelAge,
        ...(savedAppearance && typeof savedAppearance === "object" && Object.keys(savedAppearance).length > 0
          ? { savedAppearance }
          : {}),
        aiGenerationParams: {
          type: "advanced-model",
          userId,
          creditsNeeded,
          photoConfigs: builtPhotoConfigs,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    // Submit first photo immediately using ALL submitted reference images.
    // This establishes the strongest initial identity anchor.
    const cfg0 = builtPhotoConfigs[0];
    const stepRefs0 = [
      ...new Set(
        builtPhotoConfigs.flatMap((cfg) => Array.isArray(cfg.referencePhotos) ? cfg.referencePhotos : []),
      ),
    ]
      .filter(Boolean)
      .slice(0, 8);
    const result1 = await generateImageWithNanoBananaKie(
      stepRefs0,
      cfg0.fullPrompt,
      {
        model: "nano-banana-pro",
        resolution: "2K",
        aspectRatio: cfg0.aspectRatio,
        onTaskCreated: async (taskId) => {
          await registerKieTask(taskId, "saved_model_photo", model.id, "photo1", userId, {
            flow: "advanced-model",
          });
          await prisma.savedModel.update({
            where: { id: model.id },
            data: {
              aiGenerationParams: {
                type: "advanced-model",
                userId,
                creditsNeeded,
                photoConfigs: builtPhotoConfigs,
                photo1TaskId: taskId,
                generatedAt: new Date().toISOString(),
              },
            },
          });
        },
      },
    );

    if (!result1?.deferred || !result1?.taskId) {
      await prisma.savedModel.update({ where: { id: model.id }, data: { status: "failed" } });
      await refundCredits(userId, creditsNeeded);
      creditsDeducted = 0;
      return res.status(500).json({
        success: false,
        message: "Failed to submit advanced model generation task to KIE callback flow.",
      });
    }

    await prisma.creditTransaction.create({
      data: {
        userId,
        amount: -creditsNeeded,
        type: "generation",
        description: `Advanced model creation: ${name.trim()}`,
      },
    });

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true, subscriptionCredits: true, purchasedCredits: true },
    });
    const remainingCredits = (updatedUser.credits || 0) + (updatedUser.subscriptionCredits || 0) + (updatedUser.purchasedCredits || 0);

    return res.status(202).json({
      success: true,
      modelStatus: "processing",
      message: `AI Model "${name.trim()}" is processing.`,
      model: {
        id: model.id,
        name: model.name,
        status: "processing",
        photo1Url: null,
        photo2Url: null,
        photo3Url: null,
        thumbnail: null,
        createdAt: model.createdAt,
        isAIGenerated: true,
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: remainingCredits,
    });

  } catch (error) {
    console.error("Advanced model generation error:", error?.message, error?.stack);
    if (!res.headersSent) {
      if (creditsDeducted > 0 && userId) {
        try {
          await refundCredits(userId, creditsDeducted);
          console.log(`💰 Refunded ${creditsDeducted} credits due to error`);
        } catch (refundError) {
          console.error("Refund error:", refundError);
        }
      }
      const { message: userMessage, solution } = toUserError(error?.message);
      res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        errorType: "server_error",
        message: userMessage,
        solution,
        ...(process.env.NODE_ENV === "development" && error?.message ? { detail: error.message } : {}),
      });
    }
  }
}

export default {
  createModel,
  getUserModels,
  getModelById,
  deleteModel,
  updateModel,
  generateAIModel,
  generateAIModelReference,
  generateAIModelPoses,
  generateAdvancedModel,
  generateTrialReference,
  trialUploadReal,
  completeOnboarding,
  lockSpecialOffer,
};
