/**
 * Upload media to Vercel Blob as a TEMPORARY RELAY for KIE submissions only.
 *
 * Architecture:
 * - R2 = permanent storage for all user content (unchanged)
 * - Vercel Blob = short-lived relay ONLY for KIE downloads
 *   KIE can't reach R2 CDN (pub-xxx.r2.dev) so we temporarily host
 *   the file on Blob, let KIE download it, then delete from Blob after.
 *
 * Nothing stored in R2 is ever deleted or modified by this module.
 */
import { put, del } from "@vercel/blob";
import { reMirrorToR2 } from "../utils/r2.js";

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export function isVercelBlobConfigured() {
  return !!BLOB_TOKEN;
}

/**
 * Upload a buffer to Vercel Blob and return the public URL.
 * @param {Buffer} buffer
 * @param {string} filename - e.g. "image.jpg", "video.mp4"
 * @param {string} contentType
 * @param {string} folder - "kie-relay" (temp, may be deleted after KIE) or "user-uploads" (persisted for generation inputs)
 * @returns {Promise<string>} public blob URL
 */
export async function uploadBufferToBlob(buffer, filename, contentType, folder = "kie-relay") {
  if (!BLOB_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set");

  const ts = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const blobPath = `${folder}/${ts}_${random}_${filename}`;

  const blob = await put(blobPath, buffer, {
    access: "public",
    contentType,
    token: BLOB_TOKEN,
    addRandomSuffix: false,
  });

  console.log(`[Blob/KIE relay] Uploaded: ${blob.url.slice(0, 80)}`);
  return blob.url;
}

/**
 * Delete a Vercel Blob URL after KIE has finished with it.
 * Safe to call — won't throw if delete fails.
 * @param {string} blobUrl
 */
export async function deleteBlobAfterKie(blobUrl) {
  if (!blobUrl || !BLOB_TOKEN) return;
  if (!blobUrl.includes("vercel-storage.com") && !blobUrl.includes("blob.vercel.app")) return;
  // Only delete temporary relay copies (kie-relay/), never user-uploads (user uploads for generation)
  if (!blobUrl.includes("/kie-relay/")) return;
  try {
    await del(blobUrl, { token: BLOB_TOKEN });
    console.log(`[Blob/KIE relay] Cleaned up: ${blobUrl.slice(0, 80)}`);
  } catch (_) {
    // Non-critical — Vercel Blob auto-expires old files anyway
  }
}

/**
 * Read image dimensions from buffer without external deps.
 * Supports JPEG and PNG.
 */
function getImageDimensions(buffer, ext) {
  try {
    if ((ext === "jpg" || ext === "jpeg") && buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let i = 2;
      while (i < buffer.length - 8) {
        if (buffer[i] === 0xFF) {
          const marker = buffer[i + 1];
          const len = buffer.readUInt16BE(i + 2);
          if (marker >= 0xC0 && marker <= 0xC3) {
            return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
          }
          i += 2 + len;
        } else i++;
      }
    }
    if (ext === "png" && buffer.slice(1, 4).toString() === "PNG") {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (ext === "webp" && buffer.slice(8, 12).toString() === "WEBP") {
      // VP8 format
      if (buffer.slice(12, 16).toString() === "VP8 ") {
        return { width: (buffer.readUInt16LE(26) & 0x3FFF), height: (buffer.readUInt16LE(28) & 0x3FFF) };
      }
    }
  } catch (_) {}
  return null;
}

const MIRROR_RETRIES = 3;
const MIRROR_RETRY_DELAY_MS = 2000;
const MIRROR_FETCH_TIMEOUT_MS = 90_000;

/** Verify a URL is reachable (HEAD). Throws if not 2xx. */
async function verifyUrlReachable(url, label = "url") {
  const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  if (!head.ok) {
    throw new Error(`${label} returned ${head.status} — file unreachable; re-upload and try again.`);
  }
}

/**
 * Download from any URL and upload to Vercel Blob as a temporary KIE relay.
 * When Blob is configured we never return the source URL on failure — KIE cannot access R2.
 * Retries upload and verifies the Blob URL is reachable before returning.
 * @param {string} sourceUrl - R2 URL or any public URL
 * @returns {Promise<string>} temporary public Vercel Blob URL for KIE
 */
export async function mirrorToBlob(sourceUrl) {
  if (!sourceUrl?.startsWith("http")) return sourceUrl;
  if (!BLOB_TOKEN) {
    console.warn("[Blob] BLOB_READ_WRITE_TOKEN not set — using source URL (KIE may fail)");
    return sourceUrl;
  }
  // Already on Vercel Blob — verify reachable then return
  if (sourceUrl.includes("vercel-storage.com") || sourceUrl.includes("blob.vercel.app")) {
    try {
      await verifyUrlReachable(sourceUrl, "Blob URL");
    } catch (e) {
      console.warn(`[Blob] Existing Blob URL not reachable: ${e?.message}`);
    }
    return sourceUrl;
  }

  let lastErr;
  for (let attempt = 1; attempt <= MIRROR_RETRIES; attempt++) {
    try {
      console.log(`[Blob/KIE relay] Fetching (attempt ${attempt}/${MIRROR_RETRIES}): ${sourceUrl.slice(0, 80)}`);
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(MIRROR_FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "image/jpeg";

      const ext = sourceUrl.match(/\.(mp4|webm|jpg|jpeg|webp|png)(\?|$)/i)?.[1]?.toLowerCase()
        || (ct.includes("mp4") ? "mp4" : ct.includes("webm") ? "webm"
          : ct.includes("jpg") || ct.includes("jpeg") ? "jpg"
          : ct.includes("webp") ? "webp" : "jpg");

      let outBuffer = buffer;
      if (ext !== "mp4" && ext !== "webm") {
        const dims = getImageDimensions(buffer, ext);
        if (dims) {
          console.log(`[Blob/KIE relay] Image dimensions: ${dims.width}x${dims.height}`);
          if (dims.width <= 300 || dims.height <= 300) {
            throw new Error(`Image too small (${dims.width}x${dims.height}) — use at least 301px in each dimension.`);
          }
          const ratio = dims.width / dims.height;
          if (ratio < 0.4 || ratio > 2.5) {
            throw new Error(`Image aspect ratio ${ratio.toFixed(2)} is not supported; use between 0.4 and 2.5.`);
          }
          const minSide = Math.min(dims.width, dims.height);
          if (minSide < 1024) {
            try {
              const sharp = (await import("sharp")).default;
              const w = dims.width < dims.height ? 1024 : null;
              const h = dims.width < dims.height ? null : 1024;
              outBuffer = await sharp(buffer).resize(w, h).toBuffer();
              console.log(`[Blob/KIE relay] Upscaled to 1024px min for KIE`);
            } catch (e) {
              console.warn("[Blob/KIE relay] Upscale skipped:", e?.message);
            }
          }
        }
      }

      const finalCt = ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm"
        : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

      const blobUrl = await uploadBufferToBlob(outBuffer, `file.${ext}`, finalCt);
      await verifyUrlReachable(blobUrl, "Blob upload");
      console.log(`[Blob/KIE relay] ✅ Ready: ${blobUrl.slice(0, 100)} (${buffer.length} bytes)`);
      return blobUrl;
    } catch (err) {
      lastErr = err;
      console.warn(`[Blob] mirror attempt ${attempt}/${MIRROR_RETRIES} failed: ${err?.message}`);
      if (attempt < MIRROR_RETRIES) {
        await new Promise(r => setTimeout(r, MIRROR_RETRY_DELAY_MS));
      }
    }
  }
  console.warn(`[Blob] mirror failed after ${MIRROR_RETRIES} attempts — returning source URL so content is not missing`);
  return sourceUrl;
}

/**
 * Ensure a media URL is accessible to KIE (Blob relay or R2 re-mirror).
 * Use this before passing URLs to KIE or WaveSpeed pipeline steps.
 */
export async function ensureKieAccessibleUrl(url, _label = "media") {
  if (!url || !url.startsWith("http")) return url;
  if (isVercelBlobConfigured()) return mirrorToBlob(url);
  return reMirrorToR2(url, "generations");
}
