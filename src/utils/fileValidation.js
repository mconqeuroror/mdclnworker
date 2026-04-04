import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { kieConstraints, waveSpeedConstraints } from "../config/providerMediaConstraints.js";

const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const SUPPORTED_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SUPPORTED_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/x-mp4",
  "video/webm",
  "video/quicktime",
]);

function getExtensionFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot === -1) return null;
    return pathname.substring(lastDot + 1).toLowerCase().split(/[?#]/)[0];
  } catch {
    return null;
  }
}

function validateImageUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return { valid: false, message: "Invalid image URL provided." };
  }
  const ext = getExtensionFromUrl(url);
  if (ext && !SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
    const friendlyType = ext.toUpperCase();
    return {
      valid: false,
      message: `Unsupported image format: .${friendlyType}. Please upload a JPG, PNG, or WebP image.`,
    };
  }
  return { valid: true };
}

function validateVideoUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return { valid: false, message: "Invalid video URL provided." };
  }
  const ext = getExtensionFromUrl(url);
  if (ext && !SUPPORTED_VIDEO_EXTENSIONS.has(ext)) {
    const friendlyType = ext.toUpperCase();
    return {
      valid: false,
      message: `Unsupported video format: .${friendlyType}. Please upload an MP4, WebM, or MOV video.`,
    };
  }
  return { valid: true };
}

function validateImageUrls(urls) {
  if (!Array.isArray(urls)) return { valid: false, message: "Expected an array of image URLs." };
  for (let i = 0; i < urls.length; i++) {
    const result = validateImageUrl(urls[i]);
    if (!result.valid) {
      return { valid: false, message: `Image ${i + 1}: ${result.message}` };
    }
  }
  return { valid: true };
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)}MB`;
}

function isGenericOctetStream(contentType) {
  if (!contentType) return false;
  const ct = String(contentType).toLowerCase();
  return ct === "application/octet-stream" || ct === "binary/octet-stream";
}

async function inspectRemoteFile(url) {
  // Some storage backends are slow to respond to HEAD.
  // Retry + increase timeouts to avoid aborting validation during KIE submissions.
  let lastErr;
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      let res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
      if (!res.ok && (res.status === 405 || res.status === 403)) {
        res = await fetch(url, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.timeout(30_000),
        });
      }
      if (!res.ok) {
        throw new Error(`File URL returned HTTP ${res.status}. Re-upload the file and try again.`);
      }
      const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const sizeHeader = res.headers.get("content-length");
      const sizeBytes = sizeHeader ? parseInt(sizeHeader, 10) : null;
      return {
        extension: getExtensionFromUrl(url),
        contentType,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr || new Error("Failed to inspect remote file");
}

async function probeRemoteVideoDuration(url, extensionHint = "mp4") {
  const meta = await probeRemoteVideoMeta(url, extensionHint);
  return meta?.duration ?? null;
}

async function probeRemoteVideoMeta(url, extensionHint = "mp4") {
  const ext = extensionHint || getExtensionFromUrl(url) || "mp4";
  const tmpPath = path.join(
    os.tmpdir(),
    `provider-validate-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}.${ext}`,
  );

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);
    const { probeInput } = await import("../services/video-repurpose.service.js");
    const info = await probeInput(tmpPath);
    return {
      duration: Number.isFinite(info?.duration) ? info.duration : null,
      width: Number.isFinite(info?.width) ? info.width : null,
      height: Number.isFinite(info?.height) ? info.height : null,
    };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

async function validateRemoteMedia(url, rules) {
  const {
    label,
    kind,
    allowedExtensions,
    allowedMimeTypes,
    maxBytes,
    minDurationSec,
    maxDurationSec,
  } = rules;

  const basic = kind === "video" ? validateVideoUrl(url) : validateImageUrl(url);
  if (!basic.valid) return basic;

  let meta;
  try {
    meta = await inspectRemoteFile(url);
  } catch (error) {
    return { valid: false, message: `${label}: ${error.message}` };
  }

  if (meta.extension && allowedExtensions && !allowedExtensions.has(meta.extension)) {
    return {
      valid: false,
      message: `${label}: unsupported ${kind} format. Allowed formats: ${Array.from(allowedExtensions).map((x) => x.toUpperCase()).join(", ")}.`,
    };
  }

  if (
    meta.contentType &&
    allowedMimeTypes &&
    !allowedMimeTypes.has(meta.contentType) &&
    !isGenericOctetStream(meta.contentType)
  ) {
    return {
      valid: false,
      message: `${label}: unsupported ${kind} content type (${meta.contentType}).`,
    };
  }

  if (maxBytes && meta.sizeBytes && meta.sizeBytes > maxBytes) {
    return {
      valid: false,
      message: `${label}: file is too large (${formatMb(meta.sizeBytes)}). Maximum allowed is ${formatMb(maxBytes)}.`,
    };
  }

  if (kind === "video" && (minDurationSec || maxDurationSec)) {
    try {
      const durationSec = await probeRemoteVideoDuration(url, meta.extension || "mp4");
      if (!Number.isFinite(durationSec)) {
        // If we can't verify duration, don't submit to KIE (it will 422).
        return {
          valid: false,
          message: `${label}: could not verify video duration. Re-upload the file and try again.`,
        };
      }

      if (minDurationSec && durationSec < minDurationSec) {
        return {
          valid: false,
          message: `${label}: video is too short (${durationSec.toFixed(1)}s). Minimum allowed is ${minDurationSec}s.`,
        };
      }
      if (maxDurationSec && durationSec > maxDurationSec) {
        return {
          valid: false,
          message: `${label}: video is too long (${durationSec.toFixed(1)}s). Maximum allowed is ${maxDurationSec}s.`,
        };
      }
    } catch (error) {
      return {
        valid: false,
        message: `${label}: could not verify video duration (${error.message}). Re-upload the file and try again.`,
      };
    }
  }

  return { valid: true, meta };
}

const MIME_IMAGE_JPEG_PNG_WEBP = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_IMAGE_JPEG_PNG = new Set(["image/jpeg", "image/png"]);
const MIME_VIDEO_MP4_MOV = new Set(["video/mp4", "video/x-mp4", "video/quicktime"]);
const MIME_VIDEO_MP4_MOV_MKV = new Set([
  "video/mp4",
  "video/x-mp4",
  "video/quicktime",
  "video/x-matroska",
]);

async function validateNanoBananaInputImages(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return { valid: true };
  const { imageMaxBytes, maxReferenceImages } = kieConstraints.nanoBananaPro;
  if (urls.length > maxReferenceImages) {
    return {
      valid: false,
      message: `Too many reference images (${urls.length}). KIE Nano Banana Pro allows at most ${maxReferenceImages}.`,
    };
  }
  for (let i = 0; i < urls.length; i++) {
    const result = await validateRemoteMedia(urls[i], {
      label: `Reference image ${i + 1}`,
      kind: "image",
      allowedExtensions: new Set(["jpg", "jpeg", "png", "webp"]),
      allowedMimeTypes: MIME_IMAGE_JPEG_PNG_WEBP,
      maxBytes: imageMaxBytes,
    });
    if (!result.valid) return result;
  }
  return { valid: true };
}

/**
 * @param {"kie" | "wavespeed"} [provider="wavespeed"]
 */
async function validateSeedreamEditImages(urls, provider = "wavespeed") {
  if (!Array.isArray(urls) || urls.length === 0) return { valid: true };
  if (provider === "kie") {
    const maxUrls = kieConstraints.seedream45Edit.maxImageUrls;
    if (urls.length > maxUrls) {
      return {
        valid: false,
        message: `Too many images (${urls.length}) for KIE seedream/4.5-edit. Maximum is ${maxUrls}. Set PROVIDER_LIMIT_KIE_SEEDREAM_45_EDIT_MAX_IMAGE_URLS if your account allows more (e.g. 14).`,
      };
    }
  }
  const maxBytes =
    provider === "kie"
      ? kieConstraints.seedream45Edit.imageMaxBytes
      : waveSpeedConstraints.seedreamV45Edit.imageMaxBytes;
  for (let i = 0; i < urls.length; i++) {
    const result = await validateRemoteMedia(urls[i], {
      label: `Reference image ${i + 1}`,
      kind: "image",
      allowedExtensions: new Set(["jpg", "jpeg", "png", "webp"]),
      allowedMimeTypes: MIME_IMAGE_JPEG_PNG_WEBP,
      maxBytes,
    });
    if (!result.valid) return result;
  }
  return { valid: true };
}

async function validateKlingImageToVideoInput(imageUrl, options = {}) {
  const useKling3 = options.useKling3 === true;
  const maxBytes = useKling3
    ? kieConstraints.kling30Video.imageMaxBytes
    : kieConstraints.kling26ImageToVideo.imageMaxBytes;
  return validateRemoteMedia(imageUrl, {
    label: "Input image",
    kind: "image",
    allowedExtensions: new Set(["jpg", "jpeg", "png", "webp"]),
    allowedMimeTypes: MIME_IMAGE_JPEG_PNG_WEBP,
    maxBytes,
  });
}

/** Face-swap source video (URL) — WaveSpeed video-face-swap (see providerMediaConstraints). */
async function validateFaceSwapSourceVideoUrl(url) {
  const c = waveSpeedConstraints.videoFaceSwap;
  return validateRemoteMedia(url, {
    label: "Source video",
    kind: "video",
    allowedExtensions: SUPPORTED_VIDEO_EXTENSIONS,
    allowedMimeTypes: SUPPORTED_VIDEO_MIMES,
    maxBytes: c.videoMaxBytes,
    minDurationSec: c.videoMinDurationSec,
    maxDurationSec: c.videoMaxDurationSec,
  });
}

async function validateKlingMotionInputs(imageUrl, videoUrl, ultra = false) {
  const motion = ultra ? kieConstraints.kling30MotionControl : kieConstraints.kling26MotionControl;
  const imageResult = await validateRemoteMedia(imageUrl, {
    label: "Reference image",
    kind: "image",
    allowedExtensions: new Set(["jpg", "jpeg", "png"]),
    allowedMimeTypes: MIME_IMAGE_JPEG_PNG,
    maxBytes: motion.imageMaxBytes,
  });
  if (!imageResult.valid) return imageResult;

  return validateRemoteMedia(videoUrl, {
    label: "Motion video",
    kind: "video",
    allowedExtensions: ultra ? new Set(["mp4", "mov"]) : new Set(["mp4", "mov", "mkv"]),
    allowedMimeTypes: ultra ? MIME_VIDEO_MP4_MOV : MIME_VIDEO_MP4_MOV_MKV,
    maxBytes: motion.videoMaxBytes,
    minDurationSec: motion.videoMinDurationSec,
    maxDurationSec: motion.videoMaxDurationSec,
  });
}

/** Talking head — WaveSpeed kwaivgi/kling-v2-ai-avatar-standard (input portrait). */
async function validateTalkingHeadAvatarImageUrl(url) {
  const maxBytes = waveSpeedConstraints.klingV2AiAvatarStandard.imageMaxBytes;
  return validateRemoteMedia(url, {
    label: "Avatar image",
    kind: "image",
    allowedExtensions: new Set(["jpg", "jpeg", "png", "webp"]),
    allowedMimeTypes: MIME_IMAGE_JPEG_PNG_WEBP,
    maxBytes,
  });
}

async function validateSeedanceReferenceVideoPixelsUrl(url) {
  const basic = validateVideoUrl(url);
  if (!basic.valid) return basic;
  const maxPixels = Math.max(1, parseInt(process.env.PROVIDER_LIMIT_KIE_SEEDANCE2_R2V_MAX_PIXELS || "927408", 10) || 927408);
  try {
    const info = await probeRemoteVideoMeta(url);
    const width = Number(info?.width || 0);
    const height = Number(info?.height || 0);
    if (width > 0 && height > 0 && width * height > maxPixels) {
      return {
        valid: false,
        message: `Seedance reference video resolution is too high (${width}x${height} = ${width * height} px). Maximum allowed is ${maxPixels} pixels.`,
      };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      message: `Could not validate Seedance reference video resolution (${error?.message || "unknown error"}).`,
    };
  }
}

export async function validateContentType(url, type = "image") {
  const supported = type === "video" ? SUPPORTED_VIDEO_MIMES : SUPPORTED_IMAGE_MIMES;
  const friendlyList = type === "video" ? "MP4, WebM, or MOV" : "JPG, PNG, or WebP";
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType && !supported.has(contentType) && !isGenericOctetStream(contentType)) {
      return {
        valid: false,
        message: `Unsupported ${type} format (${contentType}). Please upload a ${friendlyList} file.`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: true };
  }
}

export {
  validateImageUrl,
  validateVideoUrl,
  validateImageUrls,
  validateNanoBananaInputImages,
  validateSeedreamEditImages,
  validateKlingImageToVideoInput,
  validateKlingMotionInputs,
  validateFaceSwapSourceVideoUrl,
  validateTalkingHeadAvatarImageUrl,
  validateSeedanceReferenceVideoPixelsUrl,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
};
