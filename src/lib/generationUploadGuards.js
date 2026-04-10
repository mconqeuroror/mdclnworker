/**
 * Early rejection for generation-related uploads with clear message + solution.
 * Use after multer has populated req.file / memory buffers.
 */
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { getFfprobePathSync, getFfmpegPathSync } from "../utils/ffmpeg-path.js";
import {
  getBlobClientUploadMaxBytes,
  formatBlobUploadMaxForMessage,
} from "../config/blobUpload.js";
import { waveSpeedConstraints } from "../config/providerMediaConstraints.js";

const execFileAsync = promisify(execFile);

const FFPROBE_BIN = getFfprobePathSync(getFfmpegPathSync());

export const GENERATION_UPLOAD_LIMITS = {
  /** Longest consumer of generic user video uploads = WaveSpeed video-face-swap */
  get genericVideoMaxDurationSec() {
    return waveSpeedConstraints.videoFaceSwap.videoMaxDurationSec;
  },
  get genericVideoMinDurationSec() {
    return waveSpeedConstraints.videoFaceSwap.videoMinDurationSec;
  },
};

function uploadMaxBytes() {
  return getBlobClientUploadMaxBytes();
}

function uploadMaxLabel() {
  return formatBlobUploadMaxForMessage();
}

const MODEL_PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MODEL_PHOTO_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

const GEN_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const GEN_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

const GEN_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/x-mp4",
  "video/webm",
  "video/quicktime",
]);
const GEN_VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);

function extFromName(originalname) {
  const e = path.extname(originalname || "").replace(/^\./, "").toLowerCase();
  return e.split("?")[0] || "";
}

/** Stable byte length for multer files (some clients report `size` as 0). */
export function uploadFileByteLength(file) {
  if (!file) return 0;
  const fromField = Number(file.size);
  const buf = file.buffer;
  const fromBuf =
    Buffer.isBuffer(buf) ? buf.length : typeof buf?.byteLength === "number" ? buf.byteLength : 0;
  if (Number.isFinite(fromField) && fromField > 0) return Math.floor(fromField);
  return Math.max(0, fromBuf);
}

function formatMb(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  const mb = n / (1024 * 1024);
  const dec = mb < 10 ? 2 : 1;
  return `${mb.toFixed(dec)} MB`;
}

/**
 * @returns {Promise<number|null>} duration seconds, or null if probe unavailable/failed
 */
async function probeVideoDurationSeconds(buffer, extHint) {
  const ext = extHint && /^[a-z0-9]+$/i.test(extHint) ? extHint : "mp4";
  const tmpPath = path.join(
    os.tmpdir(),
    `gen-upload-probe-${crypto.randomUUID()}.${ext}`,
  );
  try {
    fs.writeFileSync(tmpPath, buffer);
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", tmpPath],
      { timeout: 25_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout || "{}");
    const d = parseFloat(data.format?.duration);
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Synchronous checks only (size + type).
 * @param {import("multer").File} file
 * @param {"default" | "modelPhoto"} profile
 * @returns {{ ok: true, kind: "image"|"video" } | { ok: false, status: number, code: string, message: string, solution: string }}
 */
export function validateGenerationUploadSync(file, profile = "default") {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return {
      ok: false,
      status: 400,
      code: "NO_FILE",
      message: "No file was uploaded.",
      solution: "Choose a file and try again.",
    };
  }

  const mime = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
  const ext = extFromName(file.originalname);
  const size = uploadFileByteLength(file);

  if (profile === "modelPhoto") {
    const extOk = ext && MODEL_PHOTO_EXT.has(ext);
    const mimeOk = MODEL_PHOTO_MIMES.has(mime);
    const octetOk =
      mime === "application/octet-stream" && extOk;
    if (!mimeOk && !octetOk) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_FILE_TYPE",
        message: "This file type is not supported for model photos.",
        solution: "Upload JPG, PNG, or WebP images only (one clear face per photo).",
      };
    }
    if (size > uploadMaxBytes()) {
      return {
        ok: false,
        status: 413,
        code: "FILE_TOO_LARGE",
        message: `Photo is too large (${formatMb(size)}). Maximum per file is ${uploadMaxLabel()} (storage provider limit).`,
        solution:
          "Reduce file size to fit your plan, or raise BLOB_CLIENT_UPLOAD_MAX_BYTES if your provider allows a larger cap.",
      };
    }
    return { ok: true, kind: "image" };
  }

  const isVideo =
    GEN_VIDEO_MIMES.has(mime) ||
    (mime.startsWith("video/") && GEN_VIDEO_EXT.has(ext)) ||
    (mime === "application/octet-stream" && GEN_VIDEO_EXT.has(ext));

  const isImage =
    GEN_IMAGE_MIMES.has(mime) ||
    (mime.startsWith("image/") && GEN_IMAGE_EXT.has(ext)) ||
    (mime === "application/octet-stream" && GEN_IMAGE_EXT.has(ext));

  if (!isVideo && !isImage) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_FILE_TYPE",
      message: `This file type is not supported (${mime || "unknown"}).`,
      solution:
        "Use JPG, PNG, WebP, or GIF for images, or MP4, WebM, or MOV for video.",
    };
  }

  if (isImage) {
    if (!GEN_IMAGE_MIMES.has(mime) && !(mime.startsWith("image/") && GEN_IMAGE_EXT.has(ext)) && !(mime === "application/octet-stream" && GEN_IMAGE_EXT.has(ext))) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_IMAGE_TYPE",
        message: "Unsupported image format.",
        solution: "Use JPG, PNG, WebP, or GIF.",
      };
    }
    if (size > uploadMaxBytes()) {
      return {
        ok: false,
        status: 413,
        code: "FILE_TOO_LARGE",
        message: `Image is too large (${formatMb(size)}). Maximum per file is ${uploadMaxLabel()} (storage provider limit).`,
        solution:
          "Reduce file size to fit your plan, or raise BLOB_CLIENT_UPLOAD_MAX_BYTES if your provider allows a larger cap.",
      };
    }
    return { ok: true, kind: "image" };
  }

  if (!GEN_VIDEO_MIMES.has(mime) && !(mime.startsWith("video/") && GEN_VIDEO_EXT.has(ext)) && !(mime === "application/octet-stream" && GEN_VIDEO_EXT.has(ext))) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_VIDEO_TYPE",
      message: "Unsupported video format.",
      solution: "Use MP4 (H.264), WebM, or MOV.",
    };
  }
  if (size > uploadMaxBytes()) {
    return {
      ok: false,
      status: 413,
      code: "FILE_TOO_LARGE",
      message: `Video is too large (${formatMb(size)}). Maximum per file is ${uploadMaxLabel()} (storage provider limit).`,
      solution:
        "Use a smaller file or multipart blob upload within your provider’s cap; adjust BLOB_CLIENT_UPLOAD_MAX_BYTES to match your plan if needed.",
    };
  }
  return { ok: true, kind: "video", extHint: ext || "mp4" };
}

/**
 * Full validation including video duration when ffprobe runs (skipped if probe fails, e.g. some serverless).
 * @param {import("multer").File} file
 * @param {"default" | "modelPhoto"} profile
 */
export async function validateGenerationUploadFull(file, profile = "default") {
  const sync = validateGenerationUploadSync(file, profile);
  if (!sync.ok) return sync;
  if (sync.kind !== "video") return { ok: true, kind: sync.kind };

  const durationSec = await probeVideoDurationSeconds(file.buffer, sync.extHint);
  if (durationSec == null) {
    return {
      ok: true,
      kind: "video",
      durationVerified: false,
    };
  }

  if (durationSec < GENERATION_UPLOAD_LIMITS.genericVideoMinDurationSec) {
    return {
      ok: false,
      status: 400,
      code: "VIDEO_TOO_SHORT",
      message: `Video is too short (${durationSec.toFixed(1)}s).`,
      solution: "Use a clip at least about half a second long.",
    };
  }
  if (durationSec > GENERATION_UPLOAD_LIMITS.genericVideoMaxDurationSec) {
    return {
      ok: false,
      status: 400,
      code: "VIDEO_TOO_LONG",
      message: `Video is too long (${Math.round(durationSec)}s). Maximum length is ${GENERATION_UPLOAD_LIMITS.genericVideoMaxDurationSec}s (${Math.round(GENERATION_UPLOAD_LIMITS.genericVideoMaxDurationSec / 60)} minutes) for uploads.`,
      solution: "Trim the video in your editor or phone, then upload again.",
    };
  }

  return { ok: true, kind: "video", durationVerified: true, durationSec };
}

export function sendUploadGuardResponse(res, failure) {
  const body = {
    success: false,
    code: failure.code,
    message: failure.message,
    solution: failure.solution,
    error: failure.error !== undefined ? failure.error : failure.message,
  };
  return res.status(failure.status).json(body);
}
