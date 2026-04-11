import prisma from "../lib/prisma.js";

/** First saved voice on a model (design path). */
export const VOICE_DESIGN_CREDITS_INITIAL = 500;
/** Additional saved voices on the same model (design path). */
export const VOICE_DESIGN_CREDITS_RECREATE = 250;
/** First saved voice (clone path). */
export const VOICE_CLONE_CREDITS_INITIAL = 1000;
/** Additional saved voices (clone path). */
export const VOICE_CLONE_CREDITS_RECREATE = 500;
export const VOICE_AUDIO_CREDITS_PER_1K_CHARS = 72;
export const VOICE_AUDIO_REGEN_CREDITS_PER_1K_CHARS = 36;
export const VOICE_TTS_MODEL_ID = "eleven_v3";
export const VOICE_MAX_SAVED_VOICES_PER_MODEL = 3;
export const VOICE_MAX_CHARS = 5000;
export const VOICE_MAX_DURATION_SEC = 300;

/**
 * Singleton row id for VoicePlatformConfig
 */
const CONFIG_ID = "global";
const DEFAULT_VOICE_PLATFORM_CONFIG = {
  id: CONFIG_ID,
  maxCustomElevenLabsVoices: 200,
};

function isMissingVoicePlatformConfigTable(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("voiceplatformconfig") &&
    (message.includes("does not exist") ||
      message.includes("no such table") ||
      message.includes("relation") ||
      message.includes("table"))
  );
}

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

export async function getVoicePlatformConfig() {
  try {
    let row = await prisma.voicePlatformConfig.findUnique({
      where: { id: CONFIG_ID },
    });
    if (!row) {
      row = await prisma.voicePlatformConfig.create({
        data: DEFAULT_VOICE_PLATFORM_CONFIG,
      });
    }
    return row;
  } catch (error) {
    if (isMissingVoicePlatformConfigTable(error)) {
      console.warn(
        "VoicePlatformConfig table missing; using default voice platform config until migration is applied.",
      );
      return { ...DEFAULT_VOICE_PLATFORM_CONFIG };
    }
    throw error;
  }
}

export async function updateVoicePlatformMaxVoices(maxCustomElevenLabsVoices) {
  const n = parseInt(String(maxCustomElevenLabsVoices), 10);
  if (!Number.isFinite(n) || n < 1 || n > 1_000_000) {
    throw new Error("maxCustomElevenLabsVoices must be between 1 and 1000000");
  }
  return prisma.voicePlatformConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, maxCustomElevenLabsVoices: n },
    update: { maxCustomElevenLabsVoices: n },
  });
}

/**
 * Count unique persisted custom ElevenLabs voices for platform-wide cap checks.
 *
 * We intentionally union voice ids from both storage paths:
 * - modelVoice (new multi-voice studio)
 * - savedModel.elevenLabsVoiceId (legacy/default pointer)
 *
 * This keeps admin counters and enforcement aligned even when one model stores
 * multiple voices or when legacy pointers still exist.
 */
export async function countModelsWithCustomVoice() {
  const legacyRowsPromise = prisma.savedModel.findMany({
    where: { elevenLabsVoiceId: { not: null } },
    select: { elevenLabsVoiceId: true },
    distinct: ["elevenLabsVoiceId"],
  });
  const studioRowsPromise = prisma.modelVoice
    .findMany({
      where: { elevenLabsVoiceId: { not: null } },
      select: { elevenLabsVoiceId: true },
      distinct: ["elevenLabsVoiceId"],
    })
    .catch((error) => {
      if (isMissingModelVoiceTable(error)) {
        return [];
      }
      throw error;
    });
  const [studioRows, legacyRows] = await Promise.all([studioRowsPromise, legacyRowsPromise]);

  const ids = new Set();
  for (const row of studioRows) {
    if (row?.elevenLabsVoiceId) ids.add(row.elevenLabsVoiceId);
  }
  for (const row of legacyRows) {
    if (row?.elevenLabsVoiceId) ids.add(row.elevenLabsVoiceId);
  }

  return ids.size;
}

/**
 * @param {{ modelId: string, hasExistingVoice: boolean }} args
 */
export async function assertWithinVoiceCap({ modelId, hasExistingVoice }) {
  const { maxCustomElevenLabsVoices } = await getVoicePlatformConfig();
  const used = await countModelsWithCustomVoice();
  if (hasExistingVoice) return { used, max: maxCustomElevenLabsVoices };
  if (used >= maxCustomElevenLabsVoices) {
    const err = new Error(
      `Custom voice limit reached for this platform (${used}/${maxCustomElevenLabsVoices}). Try again later or contact support.`,
    );
    err.code = "VOICE_CAP";
    throw err;
  }
  return { used, max: maxCustomElevenLabsVoices };
}

export function voiceCreditsForAction(type, isRecreate) {
  if (type === "design") {
    return isRecreate ? VOICE_DESIGN_CREDITS_RECREATE : VOICE_DESIGN_CREDITS_INITIAL;
  }
  if (type === "clone") {
    return isRecreate ? VOICE_CLONE_CREDITS_RECREATE : VOICE_CLONE_CREDITS_INITIAL;
  }
  throw new Error("Invalid voice type");
}

export function estimateVoiceAudioCredits(characterCount, isRegeneration = false) {
  const chars = Math.max(0, parseInt(String(characterCount || 0), 10) || 0);
  if (chars <= 0) return 0;
  const rate = isRegeneration
    ? VOICE_AUDIO_REGEN_CREDITS_PER_1K_CHARS
    : VOICE_AUDIO_CREDITS_PER_1K_CHARS;
  return Math.max(1, Math.ceil((chars / 1000) * rate));
}

export function assertWithinSavedVoiceLimit(existingCount) {
  const count = parseInt(String(existingCount || 0), 10) || 0;
  if (count >= VOICE_MAX_SAVED_VOICES_PER_MODEL) {
    const err = new Error(`You can save up to ${VOICE_MAX_SAVED_VOICES_PER_MODEL} voices per model.`);
    err.code = "VOICE_MODEL_LIMIT";
    throw err;
  }
}
