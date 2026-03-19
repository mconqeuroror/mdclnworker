import prisma from "../lib/prisma.js";

export const VOICE_DESIGN_CREDITS_INITIAL = 1000;
export const VOICE_DESIGN_CREDITS_RECREATE = 500;
export const VOICE_CLONE_CREDITS_INITIAL = 2000;
export const VOICE_CLONE_CREDITS_RECREATE = 1000;

/**
 * Singleton row id for VoicePlatformConfig
 */
const CONFIG_ID = "global";

export async function getVoicePlatformConfig() {
  let row = await prisma.voicePlatformConfig.findUnique({
    where: { id: CONFIG_ID },
  });
  if (!row) {
    row = await prisma.voicePlatformConfig.create({
      data: {
        id: CONFIG_ID,
        maxCustomElevenLabsVoices: 200,
      },
    });
  }
  return row;
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

/** Count models that currently hold a custom ElevenLabs voice (platform-wide cap). */
export async function countModelsWithCustomVoice() {
  return prisma.savedModel.count({
    where: { elevenLabsVoiceId: { not: null } },
  });
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
