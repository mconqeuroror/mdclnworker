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
  assertWithinSavedVoiceLimit,
  estimateVoiceAudioCredits,
  voiceCreditsForAction,
  VOICE_DESIGN_CREDITS_INITIAL,
  VOICE_DESIGN_CREDITS_RECREATE,
  VOICE_CLONE_CREDITS_INITIAL,
  VOICE_CLONE_CREDITS_RECREATE,
  VOICE_AUDIO_CREDITS_PER_1K_CHARS,
  VOICE_AUDIO_REGEN_CREDITS_PER_1K_CHARS,
  VOICE_MAX_CHARS,
  VOICE_MAX_DURATION_SEC,
  VOICE_MAX_SAVED_VOICES_PER_MODEL,
  VOICE_TTS_MODEL_ID,
  getVoicePlatformConfig,
  countModelsWithCustomVoice,
} from "../services/voice-platform.service.js";
import {
  designVoicePreviews,
  createVoiceFromDesignPreview,
  cloneVoiceFromMp3Buffer,
  textToSpeech,
  estimateAudioDuration,
  deleteElevenLabsVoice,
  deleteElevenLabsVoiceStrict,
} from "../services/elevenlabs.service.js";
import {
  VOICE_STUDIO_LANGUAGE_OPTIONS,
  normalizeVoiceStudioLanguageCode,
  mergeVoiceDescriptionWithLanguage,
  mergeVoiceDescriptionForDesign,
  normalizeVoiceStudioGender,
} from "../constants/voiceStudioLanguages.js";

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

async function storeModelVoiceSampleAudio(buffer) {
  if (!isR2Configured()) {
    throw new Error("Voice sample storage is not configured (R2 required).");
  }
  return uploadBufferToR2(buffer, "model-voice-samples", "mp3", "audio/mpeg");
}

async function storeGeneratedVoiceAudioMp3(buffer) {
  if (!isR2Configured()) {
    throw new Error("Generated voice audio storage is not configured (R2 required).");
  }
  return uploadBufferToR2(buffer, "model-voice-audio", "mp3", "audio/mpeg");
}

function isManagedR2Url(url) {
  const publicBase = process.env.R2_PUBLIC_URL || "";
  return Boolean(url && publicBase && url.startsWith(publicBase));
}

async function deleteManagedR2Url(url) {
  if (!url || !isR2Configured() || !isManagedR2Url(url)) return;
  try {
    await deleteFromR2(url);
  } catch (error) {
    console.warn("deleteManagedR2Url failed (non-fatal):", error.message);
  }
}

async function requirePaidVoiceAccess(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      subscriptionStatus: true,
      premiumFeaturesUnlocked: true,
      subscriptionCredits: true,
      purchasedCredits: true,
      credits: true,
      creditsExpireAt: true,
    },
  });
  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }
  const status = String(user.subscriptionStatus || "").toLowerCase();
  const allowed =
    user.role === "admin" ||
    user.premiumFeaturesUnlocked === true ||
    status === "active" ||
    status === "trialing";
  if (!allowed) {
    const err = new Error("Voice Studio is available for paid subscription users only.");
    err.statusCode = 403;
    throw err;
  }
  return user;
}

function mapModelVoice(voice) {
  if (!voice) return null;
  return {
    id: voice.id,
    type: voice.type,
    name: voice.name,
    description: voice.description,
    language: voice.language,
    gender: voice.gender || null,
    previewUrl: voice.previewUrl,
    sampleAudioUrl: voice.sampleAudioUrl,
    isDefault: Boolean(voice.isDefault),
    createdAt: voice.createdAt,
    updatedAt: voice.updatedAt,
    elevenLabsVoiceId: voice.elevenLabsVoiceId,
  };
}

function mapGeneratedVoiceAudio(audio) {
  if (!audio) return null;
  return {
    id: audio.id,
    voiceId: audio.voiceId,
    script: audio.script,
    characterCount: audio.characterCount,
    estimatedDurationSec: audio.estimatedDurationSec,
    actualDurationSec: audio.actualDurationSec,
    creditsCost: audio.creditsCost,
    isRegeneration: audio.isRegeneration,
    sourceAudioId: audio.sourceAudioId,
    status: audio.status,
    audioUrl: audio.audioUrl,
    errorMessage: audio.errorMessage,
    voiceName: audio.voiceNameSnapshot,
    voiceType: audio.voiceTypeSnapshot,
    previewUrl: audio.previewUrlSnapshot,
    createdAt: audio.createdAt,
    completedAt: audio.completedAt,
    updatedAt: audio.updatedAt,
  };
}

async function getOwnedModel(userId, modelId, extraSelect = {}) {
  return prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: {
      id: true,
      userId: true,
      name: true,
      status: true,
      elevenLabsVoiceId: true,
      elevenLabsVoiceType: true,
      elevenLabsVoiceName: true,
      modelVoicePreviewUrl: true,
      ...extraSelect,
    },
  });
}

async function getModelVoicesForUser(userId, modelId) {
  try {
    return await prisma.modelVoice.findMany({
      where: { userId, modelId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  } catch (error) {
    if (isMissingVoiceStudioTableError(error)) {
      console.warn("ModelVoice table missing; returning empty voice list until migration is applied.");
      return [];
    }
    throw error;
  }
}

async function getGeneratedVoiceHistoryForUser(userId, modelId) {
  try {
    return await prisma.generatedVoiceAudio.findMany({
      where: { userId, modelId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  } catch (error) {
    if (isMissingVoiceStudioTableError(error)) {
      console.warn("GeneratedVoiceAudio table missing; returning empty voice history until migration is applied.");
      return [];
    }
    throw error;
  }
}

async function syncSavedModelDefaultVoice(tx, modelId) {
  const defaultVoice = await tx.modelVoice.findFirst({
    where: { modelId, isDefault: true },
    orderBy: { createdAt: "asc" },
  });

  await tx.savedModel.update({
    where: { id: modelId },
    data: {
      elevenLabsVoiceId: defaultVoice?.elevenLabsVoiceId || null,
      elevenLabsVoiceType: defaultVoice?.type || null,
      elevenLabsVoiceName: defaultVoice?.name || null,
      modelVoicePreviewUrl: defaultVoice?.previewUrl || null,
    },
  });

  return defaultVoice;
}

async function ensureSingleDefaultVoice(tx, modelId, selectedVoiceId = null) {
  const voices = await tx.modelVoice.findMany({
    where: { modelId },
    orderBy: { createdAt: "asc" },
    select: { id: true, isDefault: true },
  });
  if (!voices.length) {
    await syncSavedModelDefaultVoice(tx, modelId);
    return null;
  }

  const targetId =
    selectedVoiceId && voices.some((voice) => voice.id === selectedVoiceId)
      ? selectedVoiceId
      : voices.find((voice) => voice.isDefault)?.id || voices[0].id;

  await tx.modelVoice.updateMany({
    where: { modelId },
    data: { isDefault: false },
  });
  await tx.modelVoice.update({
    where: { id: targetId },
    data: { isDefault: true },
  });
  return syncSavedModelDefaultVoice(tx, modelId);
}

async function removeStoredModelVoiceAssets(voice, { strictProviderDelete = false } = {}) {
  if (!voice) return;
  if (voice.elevenLabsVoiceId) {
    if (strictProviderDelete) {
      await deleteElevenLabsVoiceStrict(voice.elevenLabsVoiceId);
    } else {
      await deleteElevenLabsVoice(voice.elevenLabsVoiceId);
    }
  }
  await deleteManagedR2Url(voice.previewUrl);
  await deleteManagedR2Url(voice.sampleAudioUrl);
}

async function buildVoiceStudioPayload(userId, modelId) {
  const [model, voices, history, config] = await Promise.all([
    getOwnedModel(userId, modelId),
    getModelVoicesForUser(userId, modelId),
    getGeneratedVoiceHistoryForUser(userId, modelId),
    getVoicePlatformConfig(),
  ]);

  if (!model) return null;

  const user = await checkAndExpireCredits(userId);
  return {
    model: {
      id: model.id,
      name: model.name,
      status: model.status,
      defaultVoiceId: voices.find((voice) => voice.isDefault)?.id || null,
    },
    voices: voices.map(mapModelVoice),
    history: history.map(mapGeneratedVoiceAudio),
    creditsAvailable: getTotalCredits(user),
    limits: {
      maxSavedVoicesPerModel: VOICE_MAX_SAVED_VOICES_PER_MODEL,
      maxCustomVoices: config.maxCustomElevenLabsVoices,
      usedCustomVoices: await countModelsWithCustomVoice(),
      maxChars: VOICE_MAX_CHARS,
      maxDurationSec: VOICE_MAX_DURATION_SEC,
    },
    pricing: {
      designInitial: VOICE_DESIGN_CREDITS_INITIAL,
      designRecreate: VOICE_DESIGN_CREDITS_RECREATE,
      cloneInitial: VOICE_CLONE_CREDITS_INITIAL,
      cloneRecreate: VOICE_CLONE_CREDITS_RECREATE,
      audioPer1kChars: VOICE_AUDIO_CREDITS_PER_1K_CHARS,
      audioRegenPer1kChars: VOICE_AUDIO_REGEN_CREDITS_PER_1K_CHARS,
    },
    languageOptions: VOICE_STUDIO_LANGUAGE_OPTIONS,
  };
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
        audioPer1kChars: VOICE_AUDIO_CREDITS_PER_1K_CHARS,
        audioRegenPer1kChars: VOICE_AUDIO_REGEN_CREDITS_PER_1K_CHARS,
      },
      limits: {
        maxSavedVoicesPerModel: VOICE_MAX_SAVED_VOICES_PER_MODEL,
        maxChars: VOICE_MAX_CHARS,
        maxDurationSec: VOICE_MAX_DURATION_SEC,
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
        message: "You must confirm consent to create a saved model voice.",
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
      const phrase = "Hey, this is my saved model voice for your creator studio audio.";
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
          description: `Saved model voice (design) for model ${model.name}`,
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
      const phrase = "Hey, this is my cloned model voice for your creator studio audio.";
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
          description: `Saved model voice (clone) for model ${model.name}`,
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

/**
 * GET /api/models/:modelId/voices
 */
export async function getModelVoiceStudio(req, res) {
  try {
    const userId = req.user.userId;
    const { modelId } = req.params;
    await requirePaidVoiceAccess(userId);

    const payload = await buildVoiceStudioPayload(userId, modelId);
    if (!payload) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }

    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("getModelVoiceStudio:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load voice studio",
    });
  }
}

/**
 * POST /api/models/:modelId/voices/design-previews
 */
export async function postModelVoicesDesignPreviews(req, res) {
  try {
    const userId = req.user.userId;
    await requirePaidVoiceAccess(userId);
    const { modelId } = req.params;
    const voiceDescription = String(req.body?.voiceDescription || "").trim();
    const language = normalizeVoiceStudioLanguageCode(req.body?.language);

    if (voiceDescription.length < 20 || voiceDescription.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Voice description must be between 20 and 2000 characters.",
      });
    }

    const model = await getOwnedModel(userId, modelId);
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.status === "processing") {
      return res.status(400).json({
        success: false,
        message: "Wait until the model finishes generating before creating a voice.",
      });
    }

    const voices = await getModelVoicesForUser(userId, modelId);
    assertWithinSavedVoiceLimit(voices.length);

    const fullDescription = mergeVoiceDescriptionWithLanguage(voiceDescription, language);
    if (fullDescription.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Description plus language hint is too long. Shorten the text (max 2000 characters total).",
      });
    }

    const previews = await designVoicePreviews(fullDescription);
    return res.json({
      success: true,
      previews: previews.map((preview) => ({
        generatedVoiceId: preview.generatedVoiceId,
        audioBase64: preview.audioBase64,
      })),
    });
  } catch (error) {
    console.error("postModelVoicesDesignPreviews:", error);
    const status = error.code === "VOICE_MODEL_LIMIT" ? 403 : error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to generate voice previews",
      code: error.code,
    });
  }
}

/**
 * POST /api/models/:modelId/voices/design-confirm
 */
export async function postModelVoicesDesignConfirm(req, res) {
  const userId = req.user.userId;
  const { modelId } = req.params;
  let creditsCharged = 0;
  let createdVoice = null;
  let previewUrl = null;

  try {
    await requirePaidVoiceAccess(userId);
    const generatedVoiceId = String(req.body?.generatedVoiceId || "").trim();
    const voiceDescription = String(req.body?.voiceDescription || "").trim();
    const language = normalizeVoiceStudioLanguageCode(req.body?.language);
    const gender = normalizeVoiceStudioGender(req.body?.gender);
    const fullDescription = mergeVoiceDescriptionForDesign(voiceDescription, language, gender);

    if (!consentOk(req.body?.consentConfirmed)) {
      return res.status(400).json({
        success: false,
        message: "You must confirm consent to create a saved model voice.",
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

    const model = await getOwnedModel(userId, modelId);
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.status === "processing") {
      return res.status(400).json({ success: false, message: "Model is still processing." });
    }

    const existingVoices = await getModelVoicesForUser(userId, modelId);
    assertWithinSavedVoiceLimit(existingVoices.length);
    await assertWithinVoiceCap({
      modelId: model.id,
      hasExistingVoice: existingVoices.length > 0 || Boolean(model.elevenLabsVoiceId),
    });

    const cost = voiceCreditsForAction("design", existingVoices.length > 0);
    const user = await checkAndExpireCredits(userId);
    if (getTotalCredits(user) < cost) {
      return res.status(403).json({
        success: false,
        message: `Not enough credits. Design voice costs ${cost} credits.`,
      });
    }

    await deductCredits(userId, cost);
    creditsCharged = cost;

    const voiceName = internalVoiceLabel(model);
    const { voiceId } = await createVoiceFromDesignPreview({
      voiceName,
      voiceDescription: fullDescription,
      generatedVoiceId,
    });
    createdVoice = { elevenLabsVoiceId: voiceId };

    const phrase = "Hey, this is my saved model voice for your creator studio audio.";
    const audioBuffer = await textToSpeech(phrase, voiceId, {
      modelId: VOICE_TTS_MODEL_ID,
      stability: 0.5,
      similarityBoost: 0.75,
    });
    previewUrl = await storeModelVoicePreviewMp3(audioBuffer, model.id);

    const newVoice = await prisma.$transaction(async (tx) => {
      const voice = await tx.modelVoice.create({
        data: {
          userId,
          modelId: model.id,
          elevenLabsVoiceId: voiceId,
          type: "design",
          name: voiceName,
          description: voiceDescription,
          language,
          gender: gender || null,
          previewUrl,
          isDefault: existingVoices.length === 0,
        },
      });

      if (existingVoices.length === 0) {
        await syncSavedModelDefaultVoice(tx, model.id);
      }

      await tx.creditTransaction.create({
        data: {
          userId,
          amount: -cost,
          type: "usage",
          description: `Saved model voice (design) for model ${model.name}`,
        },
      });

      return voice;
    });

    const payload = await buildVoiceStudioPayload(userId, model.id);
    return res.json({
      success: true,
      voice: mapModelVoice(newVoice),
      creditsUsed: cost,
      ...payload,
    });
  } catch (error) {
    console.error("postModelVoicesDesignConfirm:", error);
    if (createdVoice?.elevenLabsVoiceId) {
      await deleteElevenLabsVoice(createdVoice.elevenLabsVoiceId).catch(() => {});
    }
    if (previewUrl) {
      await deleteManagedR2Url(previewUrl);
    }
    if (creditsCharged > 0) {
      await refundCredits(userId, creditsCharged).catch(() => {});
    }
    const status =
      error.code === "VOICE_CAP" || error.code === "VOICE_MODEL_LIMIT"
        ? 403
        : error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to create voice",
      code: error.code,
    });
  }
}

/**
 * POST /api/models/:modelId/voices/clone
 */
export async function postModelVoicesClone(req, res) {
  const userId = req.user.userId;
  const { modelId } = req.params;
  let creditsCharged = 0;
  let createdVoiceId = null;
  let previewUrl = null;
  let sampleAudioUrl = null;

  try {
    await requirePaidVoiceAccess(userId);

    if (!consentOk(req.body?.consent)) {
      return res.status(400).json({
        success: false,
        message: "You must confirm consent to clone a voice from your audio.",
      });
    }

    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, message: "One MP3 file is required (field: audio)." });
    }

    const model = await getOwnedModel(userId, modelId);
    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (model.status === "processing") {
      return res.status(400).json({ success: false, message: "Model is still processing." });
    }

    const existingVoices = await getModelVoicesForUser(userId, modelId);
    assertWithinSavedVoiceLimit(existingVoices.length);
    await assertWithinVoiceCap({
      modelId: model.id,
      hasExistingVoice: existingVoices.length > 0 || Boolean(model.elevenLabsVoiceId),
    });

    const cost = voiceCreditsForAction("clone", existingVoices.length > 0);
    const user = await checkAndExpireCredits(userId);
    if (getTotalCredits(user) < cost) {
      return res.status(403).json({
        success: false,
        message: `Not enough credits. Voice clone costs ${cost} credits.`,
      });
    }

    await deductCredits(userId, cost);
    creditsCharged = cost;

    const language = normalizeVoiceStudioLanguageCode(req.body?.language);
    const voiceName = internalVoiceLabel(model);
    const cloned = await cloneVoiceFromMp3Buffer({
      voiceName,
      description: `Clone for model ${model.name}`,
      mp3Buffer: file.buffer,
      filename: file.originalname || "voice.mp3",
      labels: language ? { language } : undefined,
    });
    createdVoiceId = cloned.voiceId;

    sampleAudioUrl = await storeModelVoiceSampleAudio(file.buffer);
    const previewBuffer = await textToSpeech(
      "Hey, this is my cloned voice for your creator studio audio.",
      createdVoiceId,
      {
        modelId: VOICE_TTS_MODEL_ID,
        stability: 0.5,
        similarityBoost: 0.75,
      },
    );
    previewUrl = await storeModelVoicePreviewMp3(previewBuffer, model.id);

    const newVoice = await prisma.$transaction(async (tx) => {
      const voice = await tx.modelVoice.create({
        data: {
          userId,
          modelId: model.id,
          elevenLabsVoiceId: createdVoiceId,
          type: "clone",
          name: voiceName,
          description: `Clone for model ${model.name}`,
          language,
          gender: gender || null,
          previewUrl,
          sampleAudioUrl,
          isDefault: existingVoices.length === 0,
        },
      });

      if (existingVoices.length === 0) {
        await syncSavedModelDefaultVoice(tx, model.id);
      }

      await tx.creditTransaction.create({
        data: {
          userId,
          amount: -cost,
          type: "usage",
          description: `Saved model voice (clone) for model ${model.name}`,
        },
      });

      return voice;
    });

    const payload = await buildVoiceStudioPayload(userId, model.id);
    return res.json({
      success: true,
      voice: mapModelVoice(newVoice),
      creditsUsed: cost,
      ...payload,
    });
  } catch (error) {
    console.error("postModelVoicesClone:", error);
    if (createdVoiceId) {
      await deleteElevenLabsVoice(createdVoiceId).catch(() => {});
    }
    if (previewUrl) {
      await deleteManagedR2Url(previewUrl);
    }
    if (sampleAudioUrl) {
      await deleteManagedR2Url(sampleAudioUrl);
    }
    if (creditsCharged > 0) {
      await refundCredits(userId, creditsCharged).catch(() => {});
    }
    const status =
      error.code === "VOICE_CAP" || error.code === "VOICE_MODEL_LIMIT"
        ? 403
        : error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Voice clone failed",
      code: error.code,
    });
  }
}

/**
 * POST /api/models/:modelId/voices/:voiceId/select
 */
export async function postSelectModelVoice(req, res) {
  try {
    const userId = req.user.userId;
    const { modelId, voiceId } = req.params;
    await requirePaidVoiceAccess(userId);

    const voice = await prisma.modelVoice.findFirst({
      where: { id: voiceId, modelId, userId },
      select: { id: true, modelId: true },
    });
    if (!voice) {
      return res.status(404).json({ success: false, message: "Voice not found" });
    }

    await prisma.$transaction(async (tx) => {
      await ensureSingleDefaultVoice(tx, modelId, voiceId);
    });

    const payload = await buildVoiceStudioPayload(userId, modelId);
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("postSelectModelVoice:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to select voice",
    });
  }
}

/**
 * DELETE /api/models/:modelId/voices/:voiceId
 */
export async function deleteModelVoice(req, res) {
  try {
    const userId = req.user.userId;
    const { modelId, voiceId } = req.params;
    await requirePaidVoiceAccess(userId);

    const voice = await prisma.modelVoice.findFirst({
      where: { id: voiceId, modelId, userId },
    });
    if (!voice) {
      return res.status(404).json({ success: false, message: "Voice not found" });
    }

    await removeStoredModelVoiceAssets(voice, { strictProviderDelete: true });

    await prisma.$transaction(async (tx) => {
      await tx.modelVoice.delete({
        where: { id: voice.id },
      });
      await ensureSingleDefaultVoice(tx, modelId);
    });

    const payload = await buildVoiceStudioPayload(userId, modelId);
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("deleteModelVoice:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete voice",
    });
  }
}

/**
 * POST /api/models/:modelId/voices/generate-audio
 * Body: { voiceId, script, regenerateFromId? }
 */
export async function postGenerateModelVoiceAudio(req, res) {
  const userId = req.user.userId;
  const { modelId } = req.params;
  let creditsCharged = 0;
  let audioRecordId = null;

  try {
    await requirePaidVoiceAccess(userId);
    const voiceId = String(req.body?.voiceId || "").trim();
    const regenerateFromId = String(req.body?.regenerateFromId || "").trim() || null;
    const script = String(req.body?.script || "").trim();

    if (!voiceId) {
      return res.status(400).json({ success: false, message: "Voice is required." });
    }
    if (!script) {
      return res.status(400).json({ success: false, message: "Script is required." });
    }
    if (script.length > VOICE_MAX_CHARS) {
      return res.status(400).json({
        success: false,
        message: `Script is too long. Maximum is ${VOICE_MAX_CHARS} characters.`,
      });
    }

    const [model, voice, existingAudio] = await Promise.all([
      getOwnedModel(userId, modelId),
      prisma.modelVoice.findFirst({
        where: { id: voiceId, modelId, userId },
      }),
      regenerateFromId
        ? prisma.generatedVoiceAudio.findFirst({
            where: { id: regenerateFromId, modelId, userId },
          })
        : Promise.resolve(null),
    ]);

    if (!model) {
      return res.status(404).json({ success: false, message: "Model not found" });
    }
    if (!voice) {
      return res.status(404).json({ success: false, message: "Voice not found" });
    }
    if (regenerateFromId && !existingAudio) {
      return res.status(404).json({ success: false, message: "Original audio not found for regeneration." });
    }
    if (regenerateFromId && existingAudio?.status === "processing") {
      return res.status(409).json({
        success: false,
        message: "This clip is already regenerating. Wait for it to finish.",
      });
    }

    const estimatedDurationSec = estimateAudioDuration(script, voice.elevenLabsVoiceId);
    if (estimatedDurationSec > VOICE_MAX_DURATION_SEC) {
      return res.status(400).json({
        success: false,
        message: `Script is too long. Maximum generated length is ${Math.round(VOICE_MAX_DURATION_SEC / 60)} minutes.`,
      });
    }

    const creditsCost = estimateVoiceAudioCredits(script.length, Boolean(regenerateFromId));
    const user = await checkAndExpireCredits(userId);
    if (getTotalCredits(user) < creditsCost) {
      return res.status(403).json({
        success: false,
        message: `Not enough credits. This audio generation costs ${creditsCost} credits.`,
      });
    }

    await deductCredits(userId, creditsCost);
    creditsCharged = creditsCost;

    /** In-place regeneration: same history row, new file replaces old R2 object. */
    if (regenerateFromId && existingAudio) {
      audioRecordId = regenerateFromId;
      const previousStatus = existingAudio.status;
      const previousErrorMessage = existingAudio.errorMessage;

      await prisma.generatedVoiceAudio.update({
        where: { id: regenerateFromId },
        data: { status: "processing", errorMessage: null },
      });

      try {
        const audioBuffer = await textToSpeech(script, voice.elevenLabsVoiceId, {
          modelId: VOICE_TTS_MODEL_ID,
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0.15,
        });
        const audioUrl = await storeGeneratedVoiceAudioMp3(audioBuffer);
        const oldUrl = existingAudio.audioUrl;

        const completedRecord = await prisma.$transaction(async (tx) => {
          const record = await tx.generatedVoiceAudio.update({
            where: { id: regenerateFromId },
            data: {
              voiceId: voice.id,
              script,
              characterCount: script.length,
              estimatedDurationSec,
              creditsCost,
              isRegeneration: true,
              status: "completed",
              audioUrl,
              actualDurationSec: estimatedDurationSec,
              completedAt: new Date(),
              voiceNameSnapshot: voice.name,
              voiceTypeSnapshot: voice.type,
              elevenLabsVoiceIdSnapshot: voice.elevenLabsVoiceId,
              previewUrlSnapshot: voice.previewUrl,
              errorMessage: null,
            },
          });

          await tx.creditTransaction.create({
            data: {
              userId,
              amount: -creditsCost,
              type: "usage",
              description: `Voice audio regeneration for model ${model.name}`,
            },
          });

          return record;
        });

        await deleteManagedR2Url(oldUrl);

        const payload = await buildVoiceStudioPayload(userId, modelId);
        return res.json({
          success: true,
          audio: mapGeneratedVoiceAudio(completedRecord),
          creditsUsed: creditsCost,
          ...payload,
        });
      } catch (regenError) {
        console.error("postGenerateModelVoiceAudio (regen):", regenError);
        if (creditsCharged > 0) {
          await refundCredits(userId, creditsCharged).catch(() => {});
          creditsCharged = 0;
        }
        await prisma.generatedVoiceAudio
          .update({
            where: { id: regenerateFromId },
            data: {
              status: previousStatus,
              errorMessage: previousErrorMessage,
            },
          })
          .catch(() => {});
        return res.status(regenError.statusCode || 500).json({
          success: false,
          message: regenError.message || "Failed to regenerate audio",
        });
      }
    }

    const initialRecord = await prisma.generatedVoiceAudio.create({
      data: {
        userId,
        modelId,
        voiceId: voice.id,
        script,
        characterCount: script.length,
        estimatedDurationSec,
        creditsCost,
        isRegeneration: false,
        sourceAudioId: null,
        status: "processing",
        voiceNameSnapshot: voice.name,
        voiceTypeSnapshot: voice.type,
        elevenLabsVoiceIdSnapshot: voice.elevenLabsVoiceId,
        previewUrlSnapshot: voice.previewUrl,
      },
    });
    audioRecordId = initialRecord.id;

    const audioBuffer = await textToSpeech(script, voice.elevenLabsVoiceId, {
      modelId: VOICE_TTS_MODEL_ID,
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.15,
    });
    const audioUrl = await storeGeneratedVoiceAudioMp3(audioBuffer);

    const completedRecord = await prisma.$transaction(async (tx) => {
      const record = await tx.generatedVoiceAudio.update({
        where: { id: initialRecord.id },
        data: {
          status: "completed",
          audioUrl,
          actualDurationSec: estimatedDurationSec,
          completedAt: new Date(),
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          amount: -creditsCost,
          type: "usage",
          description: `Voice audio generation for model ${model.name}`,
        },
      });

      return record;
    });

    const payload = await buildVoiceStudioPayload(userId, modelId);
    return res.json({
      success: true,
      audio: mapGeneratedVoiceAudio(completedRecord),
      creditsUsed: creditsCost,
      ...payload,
    });
  } catch (error) {
    console.error("postGenerateModelVoiceAudio:", error);
    if (creditsCharged > 0) {
      await refundCredits(userId, creditsCharged).catch(() => {});
    }
    if (audioRecordId) {
      await prisma.generatedVoiceAudio.updateMany({
        where: { id: audioRecordId, status: "processing" },
        data: {
          status: "failed",
          errorMessage: error.message || "Audio generation failed",
          completedAt: new Date(),
        },
      }).catch(() => {});
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to generate audio",
    });
  }
}
