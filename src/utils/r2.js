import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

let s3Client = null;

function getS3Client() {
  if (!s3Client) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      console.warn("⚠️ R2 credentials not configured");
      return null;
    }
    
    s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    console.log("✅ R2 client initialized");
  }
  return s3Client;
}

export function isR2Configured() {
  const configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && R2_PUBLIC_URL);
  if (!configured && (R2_ACCOUNT_ID || R2_ACCESS_KEY_ID || R2_SECRET_ACCESS_KEY || R2_BUCKET_NAME)) {
    console.warn("⚠️ R2 partially configured but missing required env vars. Need: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL");
  }
  return configured;
}

export async function uploadToR2(buffer, key, contentType = "image/jpeg") {
  const client = getS3Client();
  if (!client) {
    throw new Error("R2 not configured");
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await client.send(command);
  
  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  console.log(`✅ Uploaded to R2: ${publicUrl}`);
  return publicUrl;
}

/**
 * Presigned PUT URL for a fixed key (e.g. for n8n to upload repurpose outputs directly to R2).
 * @param {string} key - Full R2 key, e.g. repurpose/{userId}/{jobId}/repurpose_001.mp4
 * @param {string} contentType - MIME type
 * @param {number} expiresIn - Seconds until URL expires (default 3600)
 */
export async function getR2PresignedPutForKey(key, contentType = "video/mp4", expiresIn = 3600) {
  const client = getS3Client();
  if (!client) throw new Error("R2 not configured");
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn,
    unhoistableHeaders: new Set(["x-amz-checksum-crc32", "x-amz-sdk-checksum-algorithm"]),
  });
  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  return { uploadUrl, publicUrl, key };
}

export async function uploadFileToR2(file, folder = "uploads") {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 10);
  const extension = file.originalname?.split(".").pop() || "jpg";
  const key = `${folder}/${timestamp}_${randomId}.${extension}`;
  
  const contentType = file.mimetype || "application/octet-stream";
  
  return uploadToR2(file.buffer, key, contentType);
}

export async function uploadBufferToR2(buffer, folder = "uploads", extension = "jpg", contentType = "image/jpeg") {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 10);
  const key = `${folder}/${timestamp}_${randomId}.${extension}`;
  
  return uploadToR2(buffer, key, contentType);
}

/** Upload support chat attachment. Use folder support-attachments/; set 30-day lifecycle on this prefix in R2/Cloudflare dashboard if desired. */
export async function uploadSupportAttachmentToR2(buffer, extension = "jpg", contentType = "image/jpeg") {
  return uploadBufferToR2(buffer, "support-attachments", extension, contentType);
}

/**
 * Resolve object key from a public R2 URL (custom R2_PUBLIC_URL or *.r2.dev).
 * @returns {string|null}
 */
export function extractR2KeyFromPublicUrl(url) {
  if (!url || typeof url !== "string") return null;
  const pub = R2_PUBLIC_URL ? String(R2_PUBLIC_URL).replace(/\/$/, "") : "";
  if (pub && (url.startsWith(`${pub}/`) || url === pub)) {
    const rest = url.startsWith(`${pub}/`) ? url.slice(pub.length + 1) : url.slice(pub.length).replace(/^\//, "");
    const key = rest.split("?")[0]?.trim();
    return key || null;
  }
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".r2.dev")) {
      const key = u.pathname.replace(/^\//, "").split("?")[0]?.trim();
      return key || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function deleteFromR2(url) {
  const client = getS3Client();
  if (!client) {
    throw new Error("R2 not configured");
  }

  const key = extractR2KeyFromPublicUrl(url);
  if (!key) {
    console.warn(`⚠️ deleteFromR2: unsupported URL (not our R2 public URL): ${String(url).slice(0, 96)}`);
    return;
  }

  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  await client.send(command);
  console.log(`✅ Deleted from R2: ${key}`);
}

export async function hasR2Object(key) {
  const client = getS3Client();
  if (!client) return false;
  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch {
    return false;
  }
}

export function getR2PublicUrl(key) {
  return `${R2_PUBLIC_URL}/${key}`;
}

/**
 * Generate a presigned URL for direct browser → R2 upload.
 * The browser PUTs directly to R2, bypassing the API server (and Vercel's 4.5MB body limit).
 * @param {string} folder - e.g. "uploads", "training"
 * @param {string} extension - e.g. "jpg", "mp4"
 * @param {string} contentType - MIME type
 * @param {number} expiresIn - seconds until URL expires (default 300)
 */
export async function getR2PresignedUploadUrl(folder = "uploads", extension = "jpg", contentType = "image/jpeg", expiresIn = 300) {
  const client = getS3Client();
  if (!client) throw new Error("R2 not configured");

  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 10);
  const key = `${folder}/${timestamp}_${randomId}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn,
    unhoistableHeaders: new Set(["x-amz-checksum-crc32", "x-amz-sdk-checksum-algorithm"]),
  });
  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  return { uploadUrl, publicUrl, key };
}

/**
 * Generate a presigned GET URL for a key — bypasses CDN, always accessible.
 * Used when external services (like KIE) can't access pub-xxx.r2.dev CDN.
 * @param {string} key - R2 object key
 * @param {number} expiresIn - seconds (default 3600 = 1 hour)
 */
export async function getPresignedGetUrl(key, expiresIn = 3600) {
  const client = getS3Client();
  if (!client) throw new Error("R2 not configured");
  const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
  return getSignedUrl(client, command, {
    expiresIn,
    unhoistableHeaders: new Set(["x-amz-checksum-crc32", "x-amz-sdk-checksum-algorithm"]),
  });
}

/**
 * Force re-download and re-upload to R2 regardless of source.
 * Returns a presigned GET URL so external services like KIE can reliably download it
 * (pub-xxx.r2.dev CDN can be blocked/slow from KIE's servers).
 */
export async function reMirrorToR2(url, folder = "generations") {
  if (!url || !url.startsWith("http")) return url;
  const { uploadBufferToBlobOrR2, isVercelBlobConfigured } = await import("./kieUpload.js");
  if (!isVercelBlobConfigured() && !isR2Configured()) return url;

  try {
    console.log(`📥 Force re-mirroring for KIE: ${url.slice(0, 70)}...`);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

    let buffer = Buffer.from(await response.arrayBuffer());
    const ct = response.headers.get("content-type") || "image/jpeg";
    const ext = url.match(/\.(mp4|webm|jpg|jpeg|webp|png)(\?|$)/i)?.[1]?.toLowerCase()
              || (ct.includes("mp4") ? "mp4" : ct.includes("webm") ? "webm"
                : ct.includes("jpg") || ct.includes("jpeg") ? "jpg"
                : ct.includes("webp") ? "webp" : "jpg");
    if (ext !== "mp4" && ext !== "webm") {
      try {
        const sharp = (await import("sharp")).default;
        const meta = await sharp(buffer).metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        if (w > 0 && h > 0 && Math.min(w, h) < 1024) {
          const nw = w < h ? 1024 : null;
          const nh = w < h ? null : 1024;
          buffer = await sharp(buffer).resize(nw, nh).toBuffer();
          console.log(`📐 Upscaled image to 1024px min for KIE`);
        }
      } catch (e) {
        console.warn("⚠️ reMirrorToR2 upscale skip:", e?.message);
      }
    }
    const finalCt = ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ct;
    const storedUrl = await uploadBufferToBlobOrR2(buffer, folder, ext, finalCt);
    if (isVercelBlobConfigured() && (storedUrl.includes("vercel-storage.com") || storedUrl.includes("blob.vercel.app"))) {
      console.log(`✅ KIE relay URL (Blob): ${storedUrl.slice(0, 80)}`);
      return storedUrl;
    }
    const key = extractR2KeyFromPublicUrl(storedUrl);
    if (key && isR2Configured()) {
      const presignedGetUrl = await getPresignedGetUrl(key, 7200);
      console.log(`✅ Presigned GET URL for KIE (R2): ${presignedGetUrl.slice(0, 80)}`);
      return presignedGetUrl;
    }
    return storedUrl;
  } catch (err) {
    console.warn(`⚠️ reMirrorToR2 failed: ${err.message} — using original URL`);
    return url;
  }
}

/**
 * Download an image from external URL and re-upload to R2
 * This ensures we own the files and they don't expire
 * @param {string} externalUrl - URL to download from (WaveSpeed, Replicate, etc.)
 * @param {string} folder - R2 folder to upload to
 * @returns {Promise<string>} - R2 public URL
 */
export async function mirrorToR2(externalUrl, folder = "models") {
  const { isVercelBlobConfigured } = await import("./kieUpload.js");
  if (!isVercelBlobConfigured() && !isR2Configured()) {
    console.warn("⚠️ No blob/R2 storage, returning original URL");
    return externalUrl;
  }

  if (externalUrl.includes("vercel-storage.com") || externalUrl.includes("blob.vercel.app")) {
    return externalUrl;
  }
  // Skip if already on R2
  if (externalUrl.includes("r2.dev") || (R2_PUBLIC_URL && externalUrl.includes(R2_PUBLIC_URL))) {
    console.log(`✓ Already on R2: ${externalUrl.substring(0, 50)}...`);
    return externalUrl;
  }
  // External sources (WaveSpeed / provider/CDN) can be slow.
  // Increase timeout + retry to reduce "operation was aborted due to timeout".
  const MIRROR_DOWNLOAD_TIMEOUT_MS = 120_000;
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`📥 Mirroring to R2 (attempt ${attempt}/${MAX_ATTEMPTS}): ${externalUrl.substring(0, 60)}...`);

      const response = await fetch(externalUrl, { signal: AbortSignal.timeout(MIRROR_DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Failed to download: HTTP ${response.status}`);
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    const MAX_MIRROR_SIZE = 100 * 1024 * 1024;
    if (contentLength > MAX_MIRROR_SIZE) {
      throw new Error(`File too large to mirror: ${contentLength} bytes (max ${MAX_MIRROR_SIZE})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_MIRROR_SIZE) {
      throw new Error(`Downloaded file too large: ${buffer.length} bytes (max ${MAX_MIRROR_SIZE})`);
    }
    const contentType = response.headers.get("content-type") || "image/png";
    
    // Determine extension from content-type or URL
    let extension = "png";
    if (contentType.includes("video/mp4") || contentType.includes("video/mpeg")) {
      extension = "mp4";
    } else if (contentType.includes("video/webm")) {
      extension = "webm";
    } else if (contentType.includes("video/")) {
      extension = "mp4";
    } else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      extension = "jpg";
    } else if (contentType.includes("webp")) {
      extension = "webp";
    } else if (externalUrl.match(/\.mp4(\?|$)/i)) {
      extension = "mp4";
    } else if (externalUrl.match(/\.webm(\?|$)/i)) {
      extension = "webm";
    } else if (externalUrl.includes(".jpg") || externalUrl.includes(".jpeg")) {
      extension = "jpg";
    } else if (externalUrl.includes(".webp")) {
      extension = "webp";
    }
    
    // Upload to R2
    // Ensure correct content type for video files
    const finalContentType = (extension === "mp4" || extension === "webm")
      ? (extension === "mp4" ? "video/mp4" : "video/webm")
      : contentType;

      const { uploadBufferToBlobOrR2 } = await import("./kieUpload.js");
      const storedUrl = await uploadBufferToBlobOrR2(buffer, folder, extension, finalContentType);
      console.log(`✅ Mirrored to storage: ${storedUrl}`);

      return storedUrl;
    } catch (error) {
      const isExpectedFailure = /HTTP (403|404|410)/i.test(error.message);
      if (isExpectedFailure) {
        console.warn(`⚠️ R2 mirror skipped (${error.message}): ${externalUrl.substring(0, 80)}...`);
        return externalUrl;
      }
      console.error(`❌ Failed to mirror to R2 (attempt ${attempt}/${MAX_ATTEMPTS}): ${error.message}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      return externalUrl;
    }
  }
}
