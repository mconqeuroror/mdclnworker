import prisma from "../lib/prisma.js";
import { getR2PublicUrl, hasR2Object } from "../utils/r2.js";

const CREATE_TUTORIAL_SLOT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "TutorialSlotVideo" (
    "slotKey" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TutorialSlotVideo_pkey" PRIMARY KEY ("slotKey")
);
`;

let ensureTutorialSlotTablePromise = null;

/** Idempotent: creates TutorialSlotVideo if missing (avoids 500 when migrate was not run on prod). */
async function ensureTutorialSlotVideoTable() {
  if (!ensureTutorialSlotTablePromise) {
    ensureTutorialSlotTablePromise = prisma.$executeRawUnsafe(CREATE_TUTORIAL_SLOT_TABLE_SQL).catch((e) => {
      ensureTutorialSlotTablePromise = null;
      throw e;
    });
  }
  return ensureTutorialSlotTablePromise;
}

export function isTutorialSlotTableError(err) {
  const code = err?.code;
  const msg = String(err?.message || "");
  return code === "P2021" || /TutorialSlotVideo.*does not exist/i.test(msg) || /relation.*TutorialSlotVideo.*does not exist/i.test(msg);
}

export function getTutorialSlotSlug(slotKey) {
  return String(slotKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
}

export const TUTORIAL_SLOTS = [
  { key: "models.my-models", label: "My Models" },
  { key: "generate.video.recreate", label: "Generate Content - Recreate Video" },
  { key: "generate.video.prompt", label: "Generate Content - Prompt Video" },
  { key: "generate.video.faceswap", label: "Generate Content - Face Swap Video" },
  { key: "generate.video.talking", label: "Generate Content - Talking Video" },
  { key: "creator.nanobanana-pro", label: "Creator Studio - Image Generation" },
  { key: "creator.voice-studio", label: "Creator Studio - Voice Studio" },
  { key: "creator.real-avatars", label: "Creator Studio - Real Avatars" },
  { key: "nsfw.training", label: "NSFW - Training" },
  { key: "nsfw.generate", label: "NSFW - Generate" },
  { key: "nsfw.video", label: "NSFW - Video" },
  { key: "nsfw.img2img", label: "NSFW - Img2Img" },
];

const TUTORIAL_SLOT_MAP = new Map(TUTORIAL_SLOTS.map((slot) => [slot.key, slot]));

export function isValidTutorialSlot(slotKey) {
  return TUTORIAL_SLOT_MAP.has(String(slotKey || "").trim());
}

export function getTutorialSlot(slotKey) {
  return TUTORIAL_SLOT_MAP.get(String(slotKey || "").trim()) || null;
}

export function getTutorialR2Key(slotKey) {
  return `static/tutorials/${getTutorialSlotSlug(slotKey)}.mp4`;
}

export function getTutorialPublicUrl(slotKey) {
  return getR2PublicUrl(getTutorialR2Key(slotKey));
}

/**
 * Persist Vercel Blob (or any stable HTTPS) URL for a tutorial slot after admin upload.
 */
export async function upsertTutorialSlotVideoUrl(slotKey, videoUrl) {
  const key = String(slotKey || "").trim();
  if (!key || !videoUrl?.trim()) return null;
  await ensureTutorialSlotVideoTable();
  return prisma.tutorialSlotVideo.upsert({
    where: { slotKey: key },
    create: { slotKey: key, videoUrl: videoUrl.trim() },
    update: { videoUrl: videoUrl.trim() },
  });
}

export async function getTutorialCatalog() {
  const slotKeys = TUTORIAL_SLOTS.map((s) => s.key);
  let dbByKey = new Map();
  try {
    await ensureTutorialSlotVideoTable();
    const rows = await prisma.tutorialSlotVideo.findMany({
      where: { slotKey: { in: slotKeys } },
      select: { slotKey: true, videoUrl: true },
    });
    dbByKey = new Map(rows.map((r) => [r.slotKey, r.videoUrl]));
  } catch (e) {
    console.warn("[tutorials] TutorialSlotVideo read failed (run migrations?):", e?.message || e);
  }

  const entries = await Promise.all(
    TUTORIAL_SLOTS.map(async (slot) => {
      const dbUrl = dbByKey.get(slot.key)?.trim();
      if (dbUrl) {
        return { key: slot.key, label: slot.label, exists: true, url: dbUrl, source: "db" };
      }
      const r2Key = getTutorialR2Key(slot.key);
      const exists = await hasR2Object(r2Key);
      return {
        key: slot.key,
        label: slot.label,
        exists,
        url: exists ? getR2PublicUrl(r2Key) : null,
        source: exists ? "r2" : null,
      };
    }),
  );

  const byKey = entries.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});

  return { entries, byKey };
}
