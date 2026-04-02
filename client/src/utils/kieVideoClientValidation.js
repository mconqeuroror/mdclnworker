/**
 * Client-side guards before KIE motion / prompt-video requests.
 * Defaults mirror `src/config/providerMediaConstraints.js` (kieConstraints) without env overrides.
 */

export const KLING_MOTION = {
  imageMaxBytes: 10 * 1024 * 1024,
  videoMaxBytes: 100 * 1024 * 1024,
  videoMinDurationSec: 3,
  videoMaxDurationSec: 30,
};

/** WAN animate-move has no duration probe on server; conservative byte caps align with WS spicy extend. */
export const WAN_RECREATE_MOTION = {
  imageMaxBytes: 10 * 1024 * 1024,
  videoMaxBytes: 500 * 1024 * 1024,
};

export const KLING_I2V = {
  imageMaxBytes: 10 * 1024 * 1024,
  allowedDurations: [5, 10],
};

export function formatMegabytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0MB";
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 || mb % 1 === 0 ? mb.toFixed(0) : mb.toFixed(1);
  return `${rounded}MB`;
}

/**
 * @param {File|Blob|undefined|null} file
 * @param {number} maxBytes
 * @param {string} label - e.g. "Reference video"
 */
export function validateLocalFileMaxBytes(file, maxBytes, label) {
  if (!file || typeof file.size !== "number") return { ok: true };
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `${label} is too large (${formatMegabytes(file.size)}). Maximum allowed is ${formatMegabytes(maxBytes)}.`,
    };
  }
  return { ok: true };
}

/**
 * @param {number} durationSec - from HTMLVideoElement.duration after loadedmetadata
 */
export function validateKlingMotionDuration(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return {
      ok: false,
      message: "Could not read reference video duration. Re-upload the file and try again.",
    };
  }
  const { videoMinDurationSec: min, videoMaxDurationSec: max } = KLING_MOTION;
  if (durationSec + 1e-6 < min) {
    return {
      ok: false,
      message: `Reference video is too short (${durationSec.toFixed(1)}s). For Kling motion control it must be between ${min}s and ${max}s.`,
    };
  }
  if (durationSec > max + 1e-6) {
    return {
      ok: false,
      message: `Reference video is too long (${durationSec.toFixed(1)}s). Maximum allowed is ${max}s.`,
    };
  }
  return { ok: true };
}

export function validatePromptVideoDuration(duration) {
  const n = Number(duration);
  if (!KLING_I2V.allowedDurations.includes(n)) {
    return {
      ok: false,
      message: "Duration must be 5 or 10 seconds.",
    };
  }
  return { ok: true };
}

function loadNaturalImageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });
}

/**
 * Pragmatic pixel / aspect checks for Kling motion start frame and image-to-video.
 * Skips silently if the image cannot be decoded (e.g. CORS on third-party URLs).
 *
 * @param {string} imageSrc - blob:, data:, or http(s) URL
 */
export async function validateKlingStartFrameDimensions(imageSrc) {
  if (!imageSrc || typeof imageSrc !== "string") return { ok: true };
  try {
    const { w, h } = await loadNaturalImageSize(imageSrc);
    if (w < 64 || h < 64) {
      return {
        ok: false,
        message: `Starting image is too small (${w}×${h} px). Use at least 64×64 pixels.`,
      };
    }
    if (w > 4096 || h > 4096) {
      return {
        ok: false,
        message: `Starting image is too large (${w}×${h} px). Maximum side length is 4096 pixels.`,
      };
    }
    const ratio = w / h;
    if (ratio < 0.25 || ratio > 4) {
      return {
        ok: false,
        message: `Image aspect ratio is too extreme (${w}×${h}). Use an image closer to portrait or landscape (between about 1:4 and 4:1).`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
