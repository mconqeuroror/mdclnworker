import prisma from "../lib/prisma.js";
import { isVercelBlobConfigured, uploadBufferToBlob } from "../utils/kieUpload.js";
import { getR2PublicUrl, hasR2Object, isR2Configured, uploadToR2 } from "../utils/r2.js";

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

function isBlobUnauthorizedError(err) {
  const msg = String(err?.message || err?.cause?.message || "");
  const status = err?.status ?? err?.response?.status ?? err?.statusCode;
  return status === 401 || /(^|\s)401(\s|$)|unauthorized|invalid token|BlobAccessError/i.test(msg);
}

/**
 * Tutorial slot uploads: prefer R2 (same stack as the rest of the app; avoids Vercel Blob 401 when token/store mismatch).
 * Uses Vercel Blob only when R2 is not configured.
 */
export async function uploadTutorialSlotMedia(buffer, slotKey, originalFilename, contentType) {
  const mime = contentType || "video/mp4";
  if (isR2Configured()) {
    const r2Key = getTutorialR2Key(slotKey);
    const url = await uploadToR2(buffer, r2Key, mime);
    return { url, storage: "r2" };
  }
  if (!isVercelBlobConfigured()) {
    throw new Error(
      "No storage for tutorials: set R2 env vars (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL) or BLOB_READ_WRITE_TOKEN for Vercel Blob.",
    );
  }
  const ext = originalFilename?.match(/\.[^.]+$/)?.[0]?.toLowerCase() || ".mp4";
  const filename = `${getTutorialSlotSlug(slotKey)}${ext}`;
  try {
    const url = await uploadBufferToBlob(buffer, filename, mime, "tutorials");
    return { url, storage: "vercel-blob" };
  } catch (e) {
    if (isBlobUnauthorizedError(e)) {
      throw new Error(
        "Vercel Blob returned 401 (invalid or expired BLOB_READ_WRITE_TOKEN, or token from another project). Regenerate a Read/Write token in Vercel → Storage → your Blob store, or configure R2 and tutorial uploads will use R2 instead.",
      );
    }
    throw e;
  }
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
