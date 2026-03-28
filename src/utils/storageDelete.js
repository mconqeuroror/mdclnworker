/**
 * Delete user-owned media from Vercel Blob or Cloudflare R2 (best-effort).
 * Skips third-party URLs (Fal, WaveSpeed, etc.) and admin tutorial blobs.
 */
import { del } from "@vercel/blob";
import { deleteFromR2, extractR2KeyFromPublicUrl } from "./r2.js";

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

/** Prefixes in Blob pathname we allow deleting for user/account/model purge (not tutorials/). */
const DELETABLE_BLOB_PATH_MARKERS = [
  "/generations/",
  "/user-uploads/",
  "/kie-relay/",
  "/models/",
  "/nsfw-generations/",
  "/model-voice-samples/",
  "/model-voice-previews/",
  "/model-voice-audio/",
  "/loras/",
  "/avatars/",
  "/frames/",
  "/temp-audio/",
  "/uploads/",
  "/training/",
  "/support-attachments/",
  "/repurpose/",
  "/converter/",
  "/conversions/",
  "/kie-media/",
  "/lora-training/",
  "/talking-head-audio/",
];

function isBlobHostUrl(url) {
  return (
    typeof url === "string"
    && (url.includes("vercel-storage.com") || url.includes("blob.vercel.app"))
  );
}

function isDeletableUserBlobUrl(url) {
  if (!isBlobHostUrl(url) || !BLOB_TOKEN) return false;
  if (url.includes("/tutorials/")) return false;
  try {
    const pathname = new URL(url).pathname;
    return DELETABLE_BLOB_PATH_MARKERS.some((m) => pathname.includes(m));
  } catch {
    return DELETABLE_BLOB_PATH_MARKERS.some((m) => url.includes(m));
  }
}

/**
 * @param {string | null | undefined} url
 */
export async function deleteStoredMediaUrl(url) {
  if (!url || typeof url !== "string") return;
  const t = url.trim();
  if (!t.startsWith("http")) return;

  if (isDeletableUserBlobUrl(t)) {
    try {
      await del(t, { token: BLOB_TOKEN });
    } catch (_) { /* best-effort */ }
  }

  const r2Key = extractR2KeyFromPublicUrl(t);
  if (r2Key) {
    try {
      await deleteFromR2(t);
    } catch (_) { /* best-effort */ }
  }
}

/**
 * outputUrl may be a single URL or JSON string array of URLs.
 * @param {string | null | undefined} outputUrl
 */
export async function deleteStoredMediaFromOutputField(outputUrl) {
  if (!outputUrl || typeof outputUrl !== "string") return;
  const t = outputUrl.trim();
  try {
    if (t.startsWith("[")) {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        for (const u of arr) await deleteStoredMediaUrl(u);
        return;
      }
    }
  } catch (_) { /* single URL */ }
  await deleteStoredMediaUrl(t);
}

/**
 * @param {Iterable<string | null | undefined>} urls
 */
export async function deleteStoredMediaUrls(urls) {
  for (const u of urls) {
    await deleteStoredMediaUrl(u);
  }
}
