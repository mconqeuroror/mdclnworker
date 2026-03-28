import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import ffmpeg from "fluent-ffmpeg";
import { getFfmpegPathSync } from "../utils/ffmpeg-path.js";
import { isR2Configured } from "../utils/r2.js";
import { isVercelBlobConfigured, uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";

// ffmpeg.wasm is for browser only; server conversion requires native ffmpeg binary.
const SERVER_CONVERSION_UNAVAILABLE_MSG =
  "Server conversion is not available on this deployment (FFmpeg required). Use \"Convert in browser\" and keep the tab open.";

let ffmpegPathSet = false;
function ensureFfmpegPath() {
  if (!ffmpegPathSet) {
    ffmpeg.setFfmpegPath(getFfmpegPathSync());
    ffmpegPathSet = true;
  }
}

function isFfmpegUnavailableError(e) {
  const msg = (e?.message || String(e)).toLowerCase();
  return /enoent|not found|spawn|ffmpeg|ffprobe|no such file/i.test(msg);
}

const IMAGE_EXTENSIONS = new Set([
  "heic",
  "heif",
  "avif",
  "bmp",
  "tif",
  "tiff",
  "gif",
  "png",
  "webp",
  "jpg",
  "jpeg",
]);

const VIDEO_EXTENSIONS = new Set([
  "mov",
  "qt",
  "avi",
  "mkv",
  "wmv",
  "m4v",
  "flv",
  "mpeg",
  "mpg",
  "3gp",
  "webm",
  "mp4",
]);

function getFileExtension(fileName = "") {
  const ext = path.extname(fileName).replace(".", "").toLowerCase();
  return ext || "";
}

function detectMediaKind(file) {
  const ext = getFileExtension(file?.originalname);
  const mime = (file?.mimetype || "").toLowerCase();

  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  return "unknown";
}

function createTempPath(extension) {
  const safeExt = String(extension || "tmp").replace(/[^a-z0-9]/gi, "");
  const id = crypto.randomBytes(10).toString("hex");
  return path.join(os.tmpdir(), `media-reformatter-${Date.now()}-${id}.${safeExt}`);
}

async function removeTempFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore cleanup errors.
  }
}

async function convertImageWithSharp(inputBuffer) {
  const sharp = (await import("sharp")).default;
  return sharp(inputBuffer)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function convertImageWithFfmpeg(inputBuffer, inputExt) {
  const inPath = createTempPath(inputExt || "img");
  const outPath = createTempPath("jpg");

  try {
    await fs.promises.writeFile(inPath, inputBuffer);
    ensureFfmpegPath();
    await new Promise((resolve, reject) => {
      ffmpeg(inPath)
        .outputOptions(["-frames:v 1", "-q:v 2"])
        .output(outPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
    return await fs.promises.readFile(outPath);
  } catch (e) {
    if (isFfmpegUnavailableError(e)) {
      throw new Error(SERVER_CONVERSION_UNAVAILABLE_MSG);
    }
    throw e;
  } finally {
    await removeTempFile(inPath);
    await removeTempFile(outPath);
  }
}

async function convertVideoToMp4(inputBuffer, inputExt) {
  const inPath = createTempPath(inputExt || "video");
  const outPath = createTempPath("mp4");

  try {
    await fs.promises.writeFile(inPath, inputBuffer);
    ensureFfmpegPath();
    await new Promise((resolve, reject) => {
      ffmpeg(inPath)
        .outputOptions([
          "-map 0:v:0",
          "-map 0:a:0?",
          "-c:v libx264",
          "-preset veryfast",
          "-crf 22",
          "-pix_fmt yuv420p",
          "-c:a aac",
          "-movflags +faststart",
        ])
        .output(outPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
    return await fs.promises.readFile(outPath);
  } catch (e) {
    if (isFfmpegUnavailableError(e)) {
      throw new Error(SERVER_CONVERSION_UNAVAILABLE_MSG);
    }
    throw e;
  } finally {
    await removeTempFile(inPath);
    await removeTempFile(outPath);
  }
}

export function isConvertibleMedia(file) {
  return detectMediaKind(file) !== "unknown";
}

export async function convertAndStoreMedia(file, options = {}) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    throw new Error("Invalid file upload");
  }

  const mediaKind = detectMediaKind(file);
  const originalExt = getFileExtension(file.originalname);
  const originalMime = (file.mimetype || "application/octet-stream").toLowerCase();

  if (mediaKind === "unknown") {
    throw new Error("Unsupported media type for conversion");
  }

  const folder = options.folder || "conversions";
  let outputBuffer = file.buffer;
  let outputExt = originalExt || (mediaKind === "image" ? "jpg" : "mp4");
  let outputMime = originalMime;
  let converted = false;

  if (mediaKind === "image") {
    if (originalExt !== "jpg" && originalExt !== "jpeg") {
      try {
        outputBuffer = await convertImageWithSharp(file.buffer);
      } catch {
        outputBuffer = await convertImageWithFfmpeg(file.buffer, originalExt);
      }
      outputExt = "jpg";
      outputMime = "image/jpeg";
      converted = true;
    }
  } else if (mediaKind === "video") {
    if (originalExt !== "mp4") {
      outputBuffer = await convertVideoToMp4(file.buffer, originalExt);
      outputExt = "mp4";
      outputMime = "video/mp4";
      converted = true;
    }
  }

  if (!isVercelBlobConfigured() && !isR2Configured()) {
    throw new Error("Media storage is not configured (Blob or R2 required).");
  }
  const outputUrl = await uploadBufferToBlobOrR2(outputBuffer, folder, outputExt, outputMime);

  return {
    success: true,
    mediaKind,
    converted,
    outputUrl,
    downloadUrl: outputUrl,
    originalFormat: originalExt || "unknown",
    convertedFormat: outputExt,
    originalMime,
    convertedMime: outputMime,
    originalSizeBytes: file.size || file.buffer.length,
    convertedSizeBytes: outputBuffer.length,
    fileName: file.originalname,
  };
}
