import { downloadTelegramFile } from "../../../services/telegramBot.js";
import { uploadBufferToR2 } from "../../../utils/r2.js";
import { inferImageExt, inferMediaExt, isHttpUrl } from "./helpers.js";

// ── Download a file from Telegram and upload to R2 ────────────
async function resolveFileToR2(fileId, hintContentType = "", hintFileName = "") {
  const downloaded = await downloadTelegramFile(fileId);
  const ct = String(downloaded.contentType || hintContentType || "").toLowerCase();
  const fp = downloaded.filePath || hintFileName || "";
  const ext = inferMediaExt(ct, fp, "bin");
  const safeCt = ct || "application/octet-stream";
  return uploadBufferToR2(downloaded.buffer, "telegram-legacy-inputs", ext, safeCt);
}

// ── Resolve image input (photo or image document) ─────────────
export async function resolveImage(message) {
  // Prefer Telegram photo (best quality)
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  if (photos.length) {
    const best = photos[photos.length - 1];
    const downloaded = await downloadTelegramFile(best.file_id);
    const ct = String(downloaded.contentType || "image/jpeg").toLowerCase();
    const safeCt = ct.startsWith("image/") ? ct : "image/jpeg";
    const ext = inferImageExt(safeCt, downloaded.filePath || "");
    return uploadBufferToR2(downloaded.buffer, "telegram-legacy-inputs", ext, safeCt);
  }

  // Image document (file sent as file, not compressed)
  const doc = message?.document;
  if (doc?.file_id) {
    const mime = String(doc.mime_type || "").toLowerCase();
    const name = String(doc.file_name || "").toLowerCase();
    const isImg = mime.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(name);
    if (isImg) {
      const dl = await downloadTelegramFile(doc.file_id);
      const ct = String(dl.contentType || doc.mime_type || "image/jpeg").toLowerCase();
      const safeCt = ct.startsWith("image/") ? ct : `image/${inferImageExt("", name)}`;
      const ext = inferImageExt(safeCt, dl.filePath || name);
      return uploadBufferToR2(dl.buffer, "telegram-legacy-inputs", ext, safeCt);
    }
  }

  return null;
}

// ── Resolve video input (video message or video document) ─────
export async function resolveVideo(message) {
  const video = message?.video;
  if (video?.file_id) {
    const dl = await downloadTelegramFile(video.file_id);
    const ct = String(dl.contentType || video.mime_type || "video/mp4");
    const ext = inferMediaExt(ct, dl.filePath || "", "mp4");
    return uploadBufferToR2(dl.buffer, "telegram-legacy-inputs", ext, ct);
  }

  const doc = message?.document;
  if (doc?.file_id) {
    const mime = String(doc.mime_type || "").toLowerCase();
    const name = String(doc.file_name || "").toLowerCase();
    const isVid = mime.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(name);
    if (isVid) {
      const dl = await downloadTelegramFile(doc.file_id);
      const ct = String(dl.contentType || doc.mime_type || "video/mp4");
      const ext = inferMediaExt(ct, dl.filePath || name, "mp4");
      return uploadBufferToR2(dl.buffer, "telegram-legacy-inputs", ext, ct);
    }
  }

  return null;
}

// ── Resolve any media (image or video) ────────────────────────
export async function resolveMedia(message, { allowImages = true, allowVideos = true } = {}) {
  if (allowImages) {
    const imgUrl = await resolveImage(message).catch(() => null);
    if (imgUrl && isHttpUrl(imgUrl)) return { url: imgUrl, kind: "image" };
  }
  if (allowVideos) {
    const vidUrl = await resolveVideo(message).catch(() => null);
    if (vidUrl && isHttpUrl(vidUrl)) return { url: vidUrl, kind: "video" };
  }
  return null;
}

// ── Resolve audio input ───────────────────────────────────────
export async function resolveAudio(message) {
  const audio = message?.audio;
  if (audio?.file_id) {
    const mime = String(audio.mime_type || "").toLowerCase();
    const name = String(audio.file_name || "").toLowerCase();
    const isMp3 = mime.includes("mpeg") || mime.includes("mp3") || name.endsWith(".mp3");
    const dl = await downloadTelegramFile(audio.file_id);
    return {
      buffer: dl.buffer,
      fileName: name || "audio.mp3",
      mimeType: isMp3 ? "audio/mpeg" : (mime || "audio/mpeg"),
    };
  }

  const doc = message?.document;
  if (doc?.file_id) {
    const mime = String(doc.mime_type || "").toLowerCase();
    const name = String(doc.file_name || "").toLowerCase();
    const isAudio = mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/i.test(name);
    if (isAudio) {
      const dl = await downloadTelegramFile(doc.file_id);
      return { buffer: dl.buffer, fileName: name || "audio.mp3", mimeType: mime || "audio/mpeg" };
    }
  }

  const voice = message?.voice;
  if (voice?.file_id) {
    const dl = await downloadTelegramFile(voice.file_id);
    return { buffer: dl.buffer, fileName: "voice.ogg", mimeType: String(dl.contentType || voice.mime_type || "audio/ogg") };
  }

  return null;
}

// ── Detect what media types are in a message ──────────────────
export function detectMediaTypes(message) {
  const docMime = String(message?.document?.mime_type || "").toLowerCase();
  const docName = String(message?.document?.file_name || "").toLowerCase();
  const hasDoc = Boolean(message?.document?.file_id);
  return {
    hasImage:
      (Array.isArray(message?.photo) && message.photo.length > 0) ||
      (hasDoc && (docMime.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(docName))),
    hasVideo:
      Boolean(message?.video?.file_id) ||
      (hasDoc && (docMime.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(docName))),
    hasAudio:
      Boolean(message?.audio?.file_id) ||
      Boolean(message?.voice?.file_id) ||
      (hasDoc && (docMime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/i.test(docName))),
  };
}

// ── Upscale: download R2 URL → post as multipart ─────────────
export async function downloadImageBufferFromUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to download image (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ctHeader = String(res.headers.get("content-type") || "").toLowerCase();
  const ext = inferImageExt(ctHeader, url);
  const mimeType = ctHeader.startsWith("image/") ? ctHeader : `image/${ext === "png" ? "png" : "jpeg"}`;
  return { buffer, mimeType, fileName: `upscale.${ext}` };
}
