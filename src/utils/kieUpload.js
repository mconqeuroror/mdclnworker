/**
 * Vercel Blob + optional R2.
 *
 * - Vercel Blob does not TTL-expire objects; they persist until explicitly deleted via the API.
 * - kie-relay/: temporary provider relay only — safe to delete after KIE/WaveSpeed consumes the URL.
 * - generations/, user-uploads/: durable user media — only delete when the user removes content (or explicit admin ops).
 */
import { put, del } from "@vercel/blob";
import { reMirrorToR2, isR2Configured, uploadBufferToR2 } from "./r2.js";
import { deleteStoredMediaUrl } from "./storageDelete.js";
import {
  isMirrorRedisConfigured,
  mirrorRedisGet,
  mirrorRedisSet,
  mirrorRedisForget,
  mirrorRedisAcquireOrWait,
  mirrorRedisReleaseLock,
} from "../lib/mirrorRedisCache.js";

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export function isVercelBlobConfigured() {
  return !!BLOB_TOKEN;
}

/**
 * Upload a buffer to Vercel Blob and return the public URL.
 * @param {Buffer} buffer
 * @param {string} filename - e.g. "image.jpg", "video.mp4"
 * @param {string} contentType
 * @param {string} folder - "kie-relay" (temp), "user-uploads" (generation inputs), "tutorials" (admin slot videos, persistent)
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
    // Long CDN/browser cache; does not delete the blob (Vercel has no storage TTL).
    cacheControlMaxAge:
      folder === "kie-relay" ? 3600 : 31536000,
  });

  console.log(`[Blob/KIE relay] Uploaded: ${blob.url.slice(0, 80)}`);
  return blob.url;
}

/** New uploads: Vercel Blob when configured, else R2 (legacy). */
export async function uploadBufferToBlobOrR2(buffer, folder, extension, contentType) {
  if (isVercelBlobConfigured()) {
    const safeFile = `file.${extension || "bin"}`;
    return uploadBufferToBlob(buffer, safeFile, contentType || "application/octet-stream", folder);
  }
  return uploadBufferToR2(buffer, folder, extension, contentType);
}

function isBlobHostUrl(url) {
  return (
    typeof url === "string"
    && (url.includes("vercel-storage.com") || url.includes("blob.vercel.app"))
  );
}

/**
 * Delete a Vercel Blob URL after KIE has finished with it.
 * Only paths under kie-relay/ — never generations/, user-uploads/, tutorials/, etc.
 */
export async function deleteBlobAfterKie(blobUrl) {
  if (!blobUrl || !BLOB_TOKEN) return;
  if (!isBlobHostUrl(blobUrl)) return;
  let pathname = "";
  try {
    pathname = new URL(blobUrl).pathname;
  } catch {
    return;
  }
  if (!pathname.includes("/kie-relay/")) return;
  try {
    await del(blobUrl, { token: BLOB_TOKEN });
    console.log(`[Blob/KIE relay] Cleaned up: ${blobUrl.slice(0, 80)}`);
  } catch (_) {
    // Non-critical
  }
}

/** User-owned durable prefixes — only these may be removed by user-initiated delete flows. */
const USER_DURABLE_BLOB_PATH_MARKERS = ["/generations/", "/user-uploads/"];

function isUserDurableBlobPath(url) {
  if (!isBlobHostUrl(url)) return false;
  try {
    const pathname = new URL(url).pathname;
    return USER_DURABLE_BLOB_PATH_MARKERS.some((m) => pathname.includes(m));
  } catch {
    return USER_DURABLE_BLOB_PATH_MARKERS.some((m) => url.includes(m));
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
const MIRROR_CACHE_TTL_MS = 10 * 60 * 1000;
const MIRROR_CACHE_TTL_MEDIA_MS = 60 * 60 * 1000;
const mirrorInFlight = new Map();
const mirrorCache = new Map();
/** Same-instance dedupe for mirrorProviderOutputUrl when Redis is enabled */
const providerMirrorInFlight = new Map();
const PROVIDER_MIRROR_PURPOSE = "provider-out";

function getMirrorCacheKey(sourceUrl, purpose = "default") {
  return `${purpose}:${sourceUrl}`;
}

function getCachedMirror(sourceUrl, purpose = "default") {
  const entry = mirrorCache.get(getMirrorCacheKey(sourceUrl, purpose));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    mirrorCache.delete(getMirrorCacheKey(sourceUrl, purpose));
    return null;
  }
  return entry.blobUrl;
}

/** Drop cache entry so the next mirror re-fetches and re-uploads. */
function forgetMirror(sourceUrl, purpose = "default") {
  mirrorCache.delete(getMirrorCacheKey(sourceUrl, purpose));
  if (isMirrorRedisConfigured()) {
    mirrorRedisForget(purpose, sourceUrl).catch(() => {});
  }
}

function rememberMirror(sourceUrl, blobUrl, ttlMs = MIRROR_CACHE_TTL_MS, purpose = "default") {
  mirrorCache.set(getMirrorCacheKey(sourceUrl, purpose), {
    blobUrl,
    expiresAt: Date.now() + ttlMs,
  });
  if (isMirrorRedisConfigured() && blobUrl) {
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    mirrorRedisSet(purpose, sourceUrl, blobUrl, ttlSec).catch(() => {});
  }
}

export function getBlobFilename(sourceUrl, ext) {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const base = pathname.split("/").pop() || `file.${ext}`;
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
    return safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
  } catch {
    return `file.${ext}`;
  }
}

function shouldFallbackToSourceUrl(sourceUrl) {
  if (!sourceUrl) return false;
  return !sourceUrl.includes("r2.dev");
}

/** Verify a URL is reachable (HEAD / Range GET). Throws if not 2xx. */
export async function verifyUrlReachable(url, label = "url") {
  let res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  if (!res.ok && (res.status === 403 || res.status === 405)) {
    res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!res.ok) {
    throw new Error(`${label} returned ${res.status} — file unreachable; re-upload and try again.`);
  }
}

/**
 * Download from any URL and upload to Vercel Blob as a temporary KIE relay.
 * When Blob is configured we never return the source URL on failure — KIE cannot access R2.
 * Retries upload and verifies the Blob URL is reachable before returning.
 * @param {string} sourceUrl - R2 URL or any public URL
 * @returns {Promise<string>} temporary public Vercel Blob URL for KIE
 */
export async function mirrorToBlob(sourceUrl, purpose = "default") {
  if (!sourceUrl?.startsWith("http")) return sourceUrl;
  if (!BLOB_TOKEN) {
    console.warn("[Blob] BLOB_READ_WRITE_TOKEN not set — using source URL (KIE may fail)");
    return sourceUrl;
  }
  const cacheKey = getMirrorCacheKey(sourceUrl, purpose);
  const cacheTtlMs = purpose === "kie-media" ? MIRROR_CACHE_TTL_MEDIA_MS : MIRROR_CACHE_TTL_MS;
  const cached = getCachedMirror(sourceUrl, purpose);
  if (cached) {
    console.log(`[Blob/KIE relay] Reusing cached mirror: ${cached.slice(0, 80)}`);
    return cached;
  }
  if (isMirrorRedisConfigured()) {
    const fromRedis = await mirrorRedisGet(purpose, sourceUrl);
    if (fromRedis) {
      mirrorCache.set(cacheKey, { blobUrl: fromRedis, expiresAt: Date.now() + cacheTtlMs });
      console.log(`[Blob/KIE relay] Reusing Redis-cached mirror: ${fromRedis.slice(0, 80)}`);
      return fromRedis;
    }
  }
  const existing = mirrorInFlight.get(cacheKey);
  if (existing) {
    console.log(`[Blob/KIE relay] Awaiting in-flight mirror for: ${sourceUrl.slice(0, 80)}`);
    return existing;
  }

  let lockHeld = false;
  if (isMirrorRedisConfigured()) {
    const lockState = await mirrorRedisAcquireOrWait(purpose, sourceUrl);
    if (lockState.fromCache && lockState.url) {
      mirrorCache.set(cacheKey, { blobUrl: lockState.url, expiresAt: Date.now() + cacheTtlMs });
      console.log(`[Blob/KIE relay] Reusing Redis mirror (after wait): ${lockState.url.slice(0, 80)}`);
      return lockState.url;
    }
    lockHeld = lockState.acquired;
  }
  // Already on Vercel Blob — verify reachable then return
  if (sourceUrl.includes("vercel-storage.com") || sourceUrl.includes("blob.vercel.app")) {
    try {
      await verifyUrlReachable(sourceUrl, "Blob URL");
      rememberMirror(sourceUrl, sourceUrl, cacheTtlMs, purpose);
      return sourceUrl;
    } catch (e) {
      console.warn(`[Blob] Existing Blob URL not reachable: ${e?.message}`);
    }
  }

  const mirrorPromise = (async () => {
    let lastErr;
    for (let attempt = 1; attempt <= MIRROR_RETRIES; attempt++) {
      try {
        console.log(`[Blob/KIE relay] Fetching (attempt ${attempt}/${MIRROR_RETRIES}): ${sourceUrl.slice(0, 80)}`);
        const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(MIRROR_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) {
          throw new Error("Downloaded file is empty — source URL has no content");
        }
        const ct = res.headers.get("content-type") || "image/jpeg";

        const ext = sourceUrl.match(/\.(mp4|webm|mov|jpg|jpeg|webp|png)(\?|$)/i)?.[1]?.toLowerCase()
          || (ct.includes("mp4") ? "mp4" : ct.includes("webm") ? "webm"
            : ct.includes("jpg") || ct.includes("jpeg") ? "jpg"
            : ct.includes("webp") ? "webp" : "jpg");

        let outBuffer = buffer;
        if (ext !== "mp4" && ext !== "webm" && ext !== "mov") {
          const dims = getImageDimensions(buffer, ext);
          if (dims) {
            console.log(`[Blob/KIE relay] Image dimensions: ${dims.width}x${dims.height}`);
            const ratio = dims.width / dims.height;
            if (ratio < 0.4 || ratio > 2.5) {
              throw new Error(`Image aspect ratio ${ratio.toFixed(2)} is not supported; use between 0.4 and 2.5.`);
            }
            const minSide = Math.min(dims.width, dims.height);
            if (minSide < 1024) {
              try {
                const sharp = (await import("sharp")).default;
                const scale = 1024 / minSide;
                const tw = Math.round(dims.width * scale);
                const th = Math.round(dims.height * scale);
                outBuffer = await sharp(buffer).resize(tw, th).toBuffer();
                console.log(`[Blob/KIE relay] Upscaled ${dims.width}x${dims.height} → ${tw}x${th} for KIE (min side 1024)`);
              } catch (e) {
                console.warn("[Blob/KIE relay] Upscale failed:", e?.message);
                if (minSide <= 300) {
                  throw new Error(
                    `Image too small (${dims.width}x${dims.height}) — use a larger or higher-resolution photo.`,
                  );
                }
              }
            }
          }
        }

        const finalCt =
          ext === "mp4" ? "video/mp4"
            : ext === "webm" ? "video/webm"
              : ext === "mov" ? "video/quicktime"
                : ext === "png" ? "image/png"
                  : ext === "webp" ? "image/webp" : "image/jpeg";

        // Video mirrors must stay on durable Blob paths: kie-relay/ is short-lived and must not be
        // reused if a stale cache points at a deleted object (KIE then sees "URL has no content").
        const isVideo = ext === "mp4" || ext === "webm" || ext === "mov";
        // Generation source media ("kie-media") must remain available for at least ~1h.
        // Keep these in user-uploads (never auto-cleaned by deleteBlobAfterKie).
        const blobFolder = purpose === "kie-media" || isVideo ? "user-uploads" : "kie-relay";

        const blobUrl = await uploadBufferToBlob(
          outBuffer,
          isVideo ? `motion-kie-${getBlobFilename(sourceUrl, ext)}` : getBlobFilename(sourceUrl, ext),
          finalCt,
          blobFolder,
        );
        await verifyUrlReachable(blobUrl, "Blob upload");
        rememberMirror(sourceUrl, blobUrl, cacheTtlMs, purpose);
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
    if (shouldFallbackToSourceUrl(sourceUrl)) {
      console.warn(`[Blob] mirror failed after ${MIRROR_RETRIES} attempts — falling back to source URL`);
      return sourceUrl;
    }
    throw lastErr || new Error("Blob mirror failed");
  })().finally(async () => {
    mirrorInFlight.delete(cacheKey);
    if (lockHeld) {
      await mirrorRedisReleaseLock(purpose, sourceUrl).catch(() => {});
    }
  });

  mirrorInFlight.set(cacheKey, mirrorPromise);
  return mirrorPromise;
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

const PROVIDER_MIRROR_FETCH_MS = 90_000;

function isDurableMirroredUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (url.includes("vercel-storage.com") || url.includes("blob.vercel.app")) return true;
  const r2pub = process.env.R2_PUBLIC_URL;
  if (r2pub && url.includes(r2pub)) return true;
  return url.includes("r2.dev");
}

/**
 * Fetch a provider result URL and persist bytes to durable storage.
 * Prefers Vercel Blob (`user-uploads`) when configured, else R2; returns original URL if all attempts fail.
 * When REDIS_URL is set, successful Blob/R2 URLs are cached and cross-instance deduped.
 */
export async function mirrorProviderOutputUrl(outputUrl, contentTypeHint = "image/png") {
  if (!outputUrl?.startsWith("http")) return outputUrl;

  const purpose = PROVIDER_MIRROR_PURPOSE;
  const providerTtlSec = 3600;

  async function runFetchOnce() {
    const maxAttempts = 3;
    const delayMs = 2500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const dl = await fetch(outputUrl, { signal: AbortSignal.timeout(PROVIDER_MIRROR_FETCH_MS) });
        if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        if (!buf.length) throw new Error("empty body");
        const ct = dl.headers.get("content-type") || contentTypeHint;
        const ext =
          outputUrl.match(/\.(mp4|webm|mov|jpg|jpeg|webp|png)(\?|$)/i)?.[1]?.toLowerCase()
          || (ct.includes("mp4") ? "mp4"
            : ct.includes("webm") ? "webm"
              : ct.includes("png") ? "png"
                : ct.includes("webp") ? "webp" : "jpg");
        const finalCt =
          ext === "mp4" ? "video/mp4"
            : ext === "webm" ? "video/webm"
              : ext === "mov" ? "video/quicktime"
                : ext === "png" ? "image/png"
                  : ext === "webp" ? "image/webp" : "image/jpeg";
        return await uploadBufferToBlobOrR2(buf, "user-uploads", ext, finalCt);
      } catch (e) {
        console.warn(`[mirrorProviderOutputUrl] attempt ${attempt}/${maxAttempts} failed: ${e?.message}`);
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return outputUrl;
  }

  if (!isMirrorRedisConfigured()) {
    return runFetchOnce();
  }

  const cached = await mirrorRedisGet(purpose, outputUrl);
  if (cached) return cached;

  const inflightKey = getMirrorCacheKey(outputUrl, purpose);
  const existing = providerMirrorInFlight.get(inflightKey);
  if (existing) return existing;

  const lockState = await mirrorRedisAcquireOrWait(purpose, outputUrl, { waitMs: 180_000, pollMs: 350 });
  if (lockState.fromCache && lockState.url) return lockState.url;
  const lockHeld = lockState.acquired;

  const promise = (async () => {
    try {
      const url = await runFetchOnce();
      if (isDurableMirroredUrl(url)) {
        await mirrorRedisSet(purpose, outputUrl, url, providerTtlSec);
      }
      return url;
    } finally {
      if (lockHeld) await mirrorRedisReleaseLock(purpose, outputUrl).catch(() => {});
      providerMirrorInFlight.delete(inflightKey);
    }
  })();

  providerMirrorInFlight.set(inflightKey, promise);
  return promise;
}

const MIRROR_PERSIST_TIMEOUT_MS = 120_000;

/**
 * Download a public URL and store bytes on Vercel Blob (durable folder, e.g. generations/).
 * No-op if already a Blob URL. Throws if Blob is not configured or download fails.
 */
export async function mirrorExternalUrlToPersistentBlob(sourceUrl, folder = "generations") {
  if (!sourceUrl?.startsWith("http")) return sourceUrl;
  if (!BLOB_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  if (sourceUrl.includes("vercel-storage.com") || sourceUrl.includes("blob.vercel.app")) {
    return sourceUrl;
  }
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(MIRROR_PERSIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`mirror persist: download HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error("mirror persist: empty body");
  const ctRaw = res.headers.get("content-type") || "application/octet-stream";
  const ct = ctRaw.split(";")[0].trim() || "application/octet-stream";
  const extFromUrl = sourceUrl.match(/\.(png|jpg|jpeg|webp|gif|mp4|webm|mov)(\?|$)/i)?.[1]?.toLowerCase();
  const ext =
    extFromUrl
    || (ct.includes("png") ? "png"
      : ct.includes("webp") ? "webp"
        : ct.includes("mp4") ? "mp4"
          : ct.includes("webm") ? "webm"
            : ct.includes("quicktime") || ct.includes("mov") ? "mov" : "jpg");
  const finalCt =
    ext === "mp4" ? "video/mp4"
      : ext === "webm" ? "video/webm"
        : ext === "mov" ? "video/quicktime"
          : ext === "png" ? "image/png"
            : ext === "webp" ? "image/webp" : "image/jpeg";
  const filename = getBlobFilename(sourceUrl, ext);
  return uploadBufferToBlob(buffer, filename, finalCt, folder);
}

/** @deprecated Prefer deleteStoredMediaUrl from storageDelete.js */
export async function deletePersistedBlobIfPossible(blobUrl) {
  await deleteStoredMediaUrl(blobUrl);
}
