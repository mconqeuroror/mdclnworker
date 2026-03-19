import prisma from "../lib/prisma.js";
import { isR2Configured, uploadBufferToR2, deleteFromR2 } from "../utils/r2.js";
import {
  checkAndExpireCredits,
  deductCredits,
  getTotalCredits,
  refundCredits,
} from "../services/credit.service.js";
import {
  assertWithinVoiceCap,
  voiceCreditsForAction,
  VOICE_DESIGN_CREDITS_INITIAL,
  VOICE_DESIGN_CREDITS_RECREATE,
  VOICE_CLONE_CREDITS_INITIAL,
  VOICE_CLONE_CREDITS_RECREATE,
  getVoicePlatformConfig,
  countModelsWithCustomVoice,
} from "../services/voice-platform.service.js";
import {
  designVoicePreviews,
  createVoiceFromDesignPreview,
  cloneVoiceFromMp3Buffer,
  textToSpeech,
  deleteElevenLabsVoice,
  deleteElevenLabsVoiceStrict,
} from "../services/elevenlabs.service.js";
import {
  VOICE_STUDIO_LANGUAGE_OPTIONS,
  normalizeVoiceStudioLanguageCode,
  mergeVoiceDescriptionWithLanguage,
} from "../constants/voiceStudioLanguages.js";

function consentOk(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function internalVoiceLabel(model) {
  const short = String(model.id).replace(/-/g, "").slice(0, 10);
  return `mc_${short}_${Date.now()}`;
}

async function removeOldModelVoiceAssets(model) {
  if (model.elevenLabsVoiceId) {
    await deleteElevenLabsVoiceStrict(model.elevenLabsVoiceId);
  }
  const url = model.modelVoicePreviewUrl;
  if (url && isR2Configured()) {
    try {
      const publicBase = process.env.R2_PUBLIC_URL || "";
      if (publicBase && url.startsWith(publicBase)) {
        await deleteFromR2(url);
      }
    } catch (e) {
      console.warn("removeOldModelVoiceAssets: R2 delete failed (non-fatal)", e.message);
    }
  }
}

async function storeModelVoicePreviewMp3(buffer, modelId) {
  if (!isR2Configured()) {
    throw new Error("Voice preview storage is not configured (R2 required).");
  }
  const keyFolder = "model-voice-previews";
  return uploadBufferToR2(buffer, keyFolder, "mp3", "audio/mpeg");
}

/**
 * GET /api/models/voice-platform/status
 */
export async function getVoicePlatformStatus(req, res) {
  try {
    const userId = req.user.userId;
    const config = await getVoicePlatformConfig();
    const used = await countModelsWithCustomVoice();
    const user = await checkAndExpireCredits(userId);
    const credits = getTotalCredits(user);
    return res.json({
      success: true,
      usedCustomVoices: used,
      maxCustomVoices: config.maxCustomElevenLabsVoices,
      creditsAvailable: credits,
      pricing: {
        designInitial: VOICE_DESIGN_CREDITS_INITIAL,
        designRecreate: VOICE_DESIGN_CREDITS_RECREATE,
        cloneInitial: VOICE_CLONE_CREDITS_INITIAL,
        cloneRecreate: VOICE_CLONE_CREDITS_RECREATE,
      },
      languageOptions: VOICE_STUDIO_LANGUAGE_OPTIONS,
    });
  } catch (error) {
    console.error("getVoicePlatformStatus:", error);
    return res.status(500).json({ success: false, message: "Failed to load voice platform status" });
  }
}

/**
 * POST /api/models/:modelId/voice/design-previews
 * Body: { voiceDescription: string, language?: string } — language = ISO-style code from languageOptions (optional)
 */
export async function postModelVoiceDesignPreviews(req, res) {
  try {
    const userId = req.user.userId;
    const { modelId } = req.params;
    const voiceDescription = String(req.body?.voiceDescription || "").trim();
    const language = normalizeVoiceStudioLanguageCode(req.body?.language);

    if (voiceDescription.length < 20 || voiceDescription.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Voice description must be between 20 and 2000 characters.",
      });
    }

    const fullDescription = mergeVoiceDescriptionWithLanguage(voiceDescription, language);
    if (fullDescription.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Description plus language hint is too long. Shorten the text (max 2000 characters total).",
      });
    }

    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
      select: { id: true, status: true },
    });
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.status === "processing") {
      return res.status(400).json({
        success: false,
        message: "Wait until the model finishes generating before creating a voice.",
      });
    }

    const previews = await designVoicePreviews(fullDescription);
    if (!previews.length) {
      return res.status(502).json({
        success: false,
        message: "No previews returned from voice service. Try a different description.",
      });
    }

    return res.json({
      success: true,
      previews: previews.map((p) => ({
        generatedVoiceId: p.generatedVoiceId,
        audioBase64: p.audioBase64,
      })),
    });
  } catch (error) {
    console.error("postModelVoiceDesignPreviews:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate voice previews",
    });
  }
}

/**
 * POST /api/models/:modelId/voice/design-confirm
 * Body: { generatedVoiceId, voiceDescription, consentConfirmed, language?: string }
 */
export async function postModelVoiceDesignConfirm(req, res) {
  const userId = req.user.userId;
  const { modelId } = req.params;
  let creditsCharged = 0;

  try {
    const generatedVoiceId = String(req.body?.generatedVoiceId || "").trim();
    const voiceDescription = String(req.body?.voiceDescription || "").trim();
    const language = normalizeVoiceStudioLanguageCode(req.body?.language);
    const fullDescription = mergeVoiceDescriptionWithLanguage(voiceDescription, language);

    if (!consentOk(req.body?.consentConfirmed)) {
      return res.status(400).json({
        success: false,
        message: "You must confirm consent to create a custom voice.",
      });
    }
    if (!generatedVoiceId || voiceDescription.length < 20 || voiceDescription.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Invalid preview or description.",
      });
    }
    if (fullDescription.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Description plus language hint is too long (max 2000 characters total).",
      });
    }

    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
    });
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.status === "processing") {
      return res.status(400).json({
        success: false,
        message: "Model is still processing.",
      });
    }

    const hasExisting = Boolean(model.elevenLabsVoiceId);
    await assertWithinVoiceCap({ modelId: model.id, hasExistingVoice: hasExisting });

    const cost = voiceCreditsForAction("design", hasExisting);
    const user = await checkAndExpireCredits(userId);
    if (getTotalCredits(user) < cost) {
      return res.status(403).json({
        success: false,
        message: `Not enough credits. Design voice costs ${cost} credits.`,
      });
    }

    await deductCredits(userId, cost);
    creditsCharged = cost;

    if (hasExisting) {
      await removeOldModelVoiceAssets(model);
      await prisma.savedModel.update({
        where: { id: model.id },
        data: {
          elevenLabsVoiceId: null,
          elevenLabsVoiceType: null,
          elevenLabsVoiceName: null,
          modelVoicePreviewUrl: null,
        },
      });
    }

    const voiceName = internalVoiceLabel(model);
    const { voiceId } = await createVoiceFromDesignPreview({
      voiceName,
      voiceDescription: fullDescription,
      generatedVoiceId,
    });

    let previewUrl = null;
    try {
      const phrase = "Hey, this is my custom voice for your talking head videos.";
      const audioBuffer = await textToSpeech(phrase, voiceId, {
        stability: 0.5,
        similarityBoost: 0.75,
      });
      previewUrl = await storeModelVoicePreviewMp3(audioBuffer, model.id);
    } catch (previewErr) {
      console.error("Design voice preview upload failed:", previewErr.message);
      await deleteElevenLabsVoice(voiceId);
      await refundCredits(userId, creditsCharged).catch(() => {});
      creditsCharged = 0;
      return res.status(500).json({
        success: false,
        message: "Voice was created but preview failed. Credits refunded. Try again.",
      });
    }

    try {
      await prisma.savedModel.update({
        where: { id: model.id },
        data: {
          elevenLabsVoiceId: voiceId,
          elevenLabsVoiceType: "design",
          elevenLabsVoiceName: voiceName,
          modelVoicePreviewUrl: previewUrl,
        },
      });

      await prisma.creditTransaction.create({
        data: {
          userId,
          amount: -cost,
          type: "usage",
          description: `Custom voice (design) for model ${model.name}`,
        },
      });
    } catch (dbErr) {
      console.error("DB update after design voice:", dbErr);
      await deleteElevenLabsVoice(voiceId);
      await refundCredits(userId, creditsCharged).catch(() => {});
      creditsCharged = 0;
      return res.status(500).json({
        success: false,
        message: "Failed to save voice on your account. Credits refunded.",
      });
    }

    return res.json({
      success: true,
      model: {
        id: model.id,
        elevenLabsVoiceId: voiceId,
        elevenLabsVoiceType: "design",
        elevenLabsVoiceName: voiceName,
        modelVoicePreviewUrl: previewUrl,
      },
      creditsUsed: cost,
    });
  } catch (error) {
    console.error("postModelVoiceDesignConfirm:", error);
    if (creditsCharged > 0) {
      await refundCredits(userId, creditsCharged).catch(() => {});
    }
    const code = error.code === "VOICE_CAP" ? 403 : 500;
    return res.status(code).json({
      success: false,
      message: error.message || "Failed to create voice",
      code: error.code,
    });
  }
}

/**
 * POST /api/models/:modelId/voice/clone — multipart field "audio" (single MP3)
 */
export async function postModelVoiceClone(req, res) {
  const userId = req.user.userId;
  const { modelId } = req.params;
  let creditsCharged = 0;

  try {
    if (!consentOk(req.body?.consent)) {
      return res.status(400).json({
        success: false,
        message: "You must confirm consent to clone a voice from your audio.",
      });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: "One MP3 file is required (field: audio)." });
    }

    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
    });
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.status === "processing") {
      return res.status(400).json({
        success: false,
        message: "Model is still processing.",
      });
    }

    const hasExisting = Boolean(model.elevenLabsVoiceId);
    await assertWithinVoiceCap({ modelId: model.id, hasExistingVoice: hasExisting });

    const cost = voiceCreditsForAction("clone", hasExisting);
    const user = await checkAndExpireCredits(userId);
    if (getTotalCredits(user) < cost) {
      return res.status(403).json({
        success: false,
        message: `Not enough credits. Voice clone costs ${cost} credits.`,
      });
    }

    await deductCredits(userId, cost);
    creditsCharged = cost;

    if (hasExisting) {
      await removeOldModelVoiceAssets(model);
      await prisma.savedModel.update({
        where: { id: model.id },
        data: {
          elevenLabsVoiceId: null,
          elevenLabsVoiceType: null,
          elevenLabsVoiceName: null,
          modelVoicePreviewUrl: null,
        },
      });
    }

    const lang = normalizeVoiceStudioLanguageCode(req.body?.language);
    const voiceName = internalVoiceLabel(model);
    const { voiceId } = await cloneVoiceFromMp3Buffer({
      voiceName,
      description: `Clone for model ${model.name}`,
      mp3Buffer: file.buffer,
      filename: file.originalname || "voice.mp3",
      labels: lang ? { language: lang } : undefined,
    });

    let previewUrl = null;
    try {
      const phrase = "Hey, this is my cloned voice for your talking head videos.";
      const audioBuffer = await textToSpeech(phrase, voiceId, {
        stability: 0.5,
        similarityBoost: 0.75,
      });
      previewUrl = await storeModelVoicePreviewMp3(audioBuffer, model.id);
    } catch (previewErr) {
      console.error("Clone voice preview upload failed:", previewErr.message);
      await deleteElevenLabsVoice(voiceId);
      await refundCredits(userId, creditsCharged).catch(() => {});
      creditsCharged = 0;
      return res.status(500).json({
        success: false,
        message: "Voice was cloned but preview failed. Credits refunded. Try again.",
      });
    }

    try {
      await prisma.savedModel.update({
        where: { id: model.id },
        data: {
          elevenLabsVoiceId: voiceId,
          elevenLabsVoiceType: "clone",
          elevenLabsVoiceName: voiceName,
          modelVoicePreviewUrl: previewUrl,
        },
      });

      await prisma.creditTransaction.create({
        data: {
          userId,
          amount: -cost,
          type: "usage",
          description: `Custom voice (clone) for model ${model.name}`,
        },
      });
    } catch (dbErr) {
      console.error("DB update after voice clone:", dbErr);
      await deleteElevenLabsVoice(voiceId);
      await refundCredits(userId, creditsCharged).catch(() => {});
      creditsCharged = 0;
      return res.status(500).json({
        success: false,
        message: "Failed to save voice on your account. Credits refunded.",
      });
    }

    return res.json({
      success: true,
      model: {
        id: model.id,
        elevenLabsVoiceId: voiceId,
        elevenLabsVoiceType: "clone",
        elevenLabsVoiceName: voiceName,
        modelVoicePreviewUrl: previewUrl,
      },
      creditsUsed: cost,
    });
  } catch (error) {
    console.error("postModelVoiceClone:", error);
    if (creditsCharged > 0) {
      await refundCredits(userId, creditsCharged).catch(() => {});
    }
    const code = error.code === "VOICE_CAP" ? 403 : 500;
    return res.status(code).json({
      success: false,
      message: error.message || "Voice clone failed",
      code: error.code,
    });
  }
}
