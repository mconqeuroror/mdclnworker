/**
 * NSFW Motion Control video (Motion X) via RunningHub AI app + media upload.
 *
 * - POST /api/nsfw/generate-motion-video
 * - Generation type: nsfw-video-motion
 *
 * Flow: download public reference + driving video URLs, upload to RunningHub binary API
 * (`POST {RUNNINGHUB_MEDIA_UPLOAD_BASE}/openapi/v2/media/upload/binary`), then
 * `POST {RUNNINGHUB_API_BASE}/openapi/v2/run/ai-app/{appId}` with `nodeInfoList`, poll
 * `POST /openapi/v2/query` — mirror the output mp4 to Blob/R2 (RunningHub result URLs expire ~24h).
 *
 * Env: RUNNINGHUB_API_KEY, RUNNINGHUB_MOTION_APP_ID (default below), optional RUNNINGHUB_API_BASE / RUNNINGHUB_MEDIA_UPLOAD_BASE,
 * optional OpenAPI: RUNNINGHUB_MOTION_WEBHOOK_URL, RUNNINGHUB_MOTION_RETAIN_SECONDS (10–180, enterprise).
 * Driving video is re-encoded for VHS (OpenCV `VideoCapture` + `grab()`) before upload (unless NSFW_MOTION_TRANSCODE=false).
 * Default codec is **MPEG-4 Part 2 (mpeg4 / mp4v)** — often more reliable than H.264 on some OpenCV+FFmpeg builds; override with
 * NSFW_MOTION_VHS_VIDEO_CODEC=libx264. Optional constant frame rate: NSFW_MOTION_VHS_CFR_FPS=30 (0=off) helps broken fps metadata.
 * Uses the external FFmpeg worker in `returnBytes` mode — worker streams the transcoded MP4 back
 * in the HTTP response (no R2 or Blob presign needed). Fallback: local ffmpeg (FFMPEG_PATH).
 *
 * The hosted app workflow may not expose prompt/duration/skip via the API; those are accepted
 * for billing / UX and stored on the generation row, but are not always sent to RunningHub.
 */

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getFfmpegWorkerBaseUrls } from "../lib/ffmpeg-worker-env.js";
import { postTranscodeJobToWorkerReturnBytes } from "./ffmpeg-worker-client.js";
import { uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import { getFfprobePathSync, getFfmpegPathSync } from "../utils/ffmpeg-path.js";

const execFileAsync = promisify(execFile);

/** Re-encode driving clip for VHS; default codec is mpeg4 (NSFW_MOTION_VHS_VIDEO_CODEC=libx264 for H.264). */
const NSFW_MOTION_TRANSCODE = String(process.env.NSFW_MOTION_TRANSCODE || "true").toLowerCase() !== "false";
/**
 * Escape hatch (OFF by default): allow uploading bytes identical to the source driving file. Only useful
 * for debugging — RunningHub content-addresses uploads, so it's almost always a no-op that keeps failing.
 */
const NSFW_MOTION_ALLOW_UNTRANSCODED =
  String(process.env.NSFW_MOTION_ALLOW_UNTRANSCODED || "false").toLowerCase() === "true";
/** When true, prints ffmpeg/ffprobe/R2 env-availability flags before transcode to help debug config. */
const NSFW_MOTION_LOG_ENV = String(process.env.NSFW_MOTION_LOG_ENV || "false").toLowerCase() === "true";
/**
 * Debug: upload the transcoded driving clip to Vercel Blob so you can download and inspect it
 * (check cv2 compatibility locally) before it's POSTed to RunningHub. Default OFF.
 */
const NSFW_MOTION_DEBUG_UPLOAD_BLOB =
  String(process.env.NSFW_MOTION_DEBUG_UPLOAD_BLOB || "false").toLowerCase() === "true";

const FTYP_SIG = Buffer.from("ftyp");

/**
 * @param {Buffer} b
 * @returns {boolean} True if buffer looks like an MP4/ISO with an ftyp box (avoids 0 B / junk uploads)
 */
function bufferContainsFtypMp4(b) {
  if (!Buffer.isBuffer(b) || b.length < 32) return false;
  const n = Math.min(b.length, 1_000_000);
  return b.subarray(0, n).indexOf(FTYP_SIG) >= 0;
}

/** First 16 hex chars of SHA-256 of buffer (trace whether transcode actually changed bytes). */
function shortBufferSha16(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return "empty";
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/**
 * H.264 "main" MP4 with explicit avc1 tag + bt.709 color + CFR + repeated parameter sets. This is
 * the widest-compatibility cv2 profile — broader than baseline for some headless OpenCV builds
 * that only ship avc1/main support. Use for VHS_LoadVideo on ComfyUI/RunningHub.
 */
const MOTION_VHS_X264_OUT = [
  "-c:v",
  "libx264",
  "-profile:v",
  "main",
  "-level",
  "4.0",
  "-preset",
  "medium",
  "-crf",
  "23",
  "-g",
  "30",
  "-keyint_min",
  "30",
  "-sc_threshold",
  "0",
  "-x264-params",
  "repeat-headers=1:force-cfr=1",
  "-pix_fmt",
  "yuv420p",
  "-color_range",
  "tv",
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-tag:v",
  "avc1",
  "-an",
  "-movflags",
  "+faststart",
];
/** MPEG-4 Part 2 fallback — sometimes works where libx264 doesn't, but less reliable overall. */
const MOTION_VHS_MPEG4_OUT = [
  "-c:v",
  "mpeg4",
  "-vtag",
  "mp4v",
  "-q:v",
  "5",
  "-pix_fmt",
  "yuv420p",
  "-an",
  "-movflags",
  "+faststart",
];

function getMotionVhsVideoCodec() {
  const t = String(process.env.NSFW_MOTION_VHS_VIDEO_CODEC || "libx264").toLowerCase();
  if (t === "libx264" || t === "h264" || t === "x264" || t === "h.264" || t === "avc") {
    return "libx264";
  }
  if (t === "mpeg4" || t === "mp4v" || t === "msmpeg4" || t === "part2") {
    return "mpeg4";
  }
  return "libx264";
}

/**
 * -vf: CFR via `fps=` filter (broadly supported across ffmpeg versions, unlike -fps_mode),
 *      yuv420 + even dimensions + SAR=1. This guarantees CFR even if older ffmpeg ignores -fps_mode.
 * @returns {string}
 */
function getMotionVhsVf() {
  const cfr = getMotionVhsCfrFps();
  const parts = [];
  if (cfr > 0) parts.push(`fps=${cfr}`);
  parts.push("format=yuv420p", "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=bicubic", "setsar=1");
  return parts.join(",");
}

/**
 * @returns {number} Output CFR frame rate (0 = do not force CFR).
 */
function getMotionVhsCfrFps() {
  const raw = String(process.env.NSFW_MOTION_VHS_CFR_FPS ?? "30").toLowerCase();
  const off = raw === "0" || raw === "off" || raw === "false" || raw === "no";
  const n = off ? 0 : Number.parseInt(String(process.env.NSFW_MOTION_VHS_CFR_FPS ?? "30"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @returns {string[]}
 */
function getMotionVhsFfmpegOutputOpts() {
  return getMotionVhsVideoCodec() === "libx264" ? [...MOTION_VHS_X264_OUT] : [...MOTION_VHS_MPEG4_OUT];
}

/**
 * ffprobe gate before RunningHub: reject 0/0 r_frame_rate or nb_frames=0 when possible.
 * If ffprobe is missing, logs a warning and allows (avoids hard-failing on hosts without it).
 * Set NSFW_MOTION_VHS_FFPROBE=false to skip the probe.
 * @param {Buffer} buffer
 * @param {string} where — log label
 * @returns {Promise<{ ok: boolean, reason?: string, probeJson?: object, skipped?: boolean, ffprobeError?: boolean }>}
 */
async function validateVhsTranscodedBufferWithFfprobe(buffer, where) {
  if (String(process.env.NSFW_MOTION_VHS_FFPROBE || "true").toLowerCase() === "false") {
    return { ok: true, skipped: true };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 256) {
    return { ok: false, reason: "buffer too small" };
  }
  const id = randomBytes(6).toString("hex");
  const tmp = path.join(os.tmpdir(), `vhs-ffp-${id}.mp4`);
  const ff = getFfmpegPathSync();
  const prob = getFfprobePathSync(ff);
  try {
    await fs.writeFile(tmp, buffer);
    const { stdout } = await execFileAsync(
      prob,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt",
        "-of",
        "json",
        tmp,
      ],
      { maxBuffer: 2_000_000, timeout: 45_000 },
    );
    const j = JSON.parse(stdout);
    const s = j && Array.isArray(j.streams) ? j.streams[0] : null;
    if (!s) {
      return { ok: false, reason: "ffprobe: no v:0", probeJson: j };
    }
    const { codec_name, r_frame_rate, nb_frames, pix_fmt } = s;
    if (r_frame_rate === "0/0" || r_frame_rate === 0) {
      return { ok: false, reason: `r_frame_rate=${r_frame_rate}`, probeJson: s };
    }
    if (nb_frames !== undefined && Number(nb_frames) === 0) {
      return { ok: false, reason: "nb_frames=0", probeJson: s };
    }
    const out = { codec_name, r_frame_rate, nb_frames, pix_fmt };
    console.log(`[NSFW/motion] ffprobe ok [${where}]`, JSON.stringify(out));
    return { ok: true, probeJson: out };
  } catch (e) {
    const errText = e?.message || String(e);
    if (/ENOENT|spawn|not find|ffprobe/gi.test(errText)) {
      console.warn(
        "[NSFW/motion] ffprobe not runnable — skipping VHS pre-upload validation (set FFPROBE_PATH or install):",
        errText.slice(0, 200),
      );
      return { ok: true, skipped: true, ffprobeError: true, warn: errText };
    }
    console.warn(`[NSFW/motion] ffprobe failed [${where}]:`, errText);
    return { ok: true, warn: errText, ffprobeError: true, skipped: true };
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

const RUNNINGHUB_API_KEY = String(process.env.RUNNINGHUB_API_KEY || "").trim();
const DEFAULT_MOTION_APP_ID = "2048360380644204545";
const RUNNINGHUB_MOTION_APP_ID =
  String(process.env.RUNNINGHUB_MOTION_APP_ID || DEFAULT_MOTION_APP_ID).trim() || null;

const RUNNINGHUB_API_BASE = (String(process.env.RUNNINGHUB_API_BASE || "https://www.runninghub.ai").trim() ||
  "https://www.runninghub.ai").replace(/\/$/, "");
const RUNNINGHUB_MEDIA_UPLOAD_BASE = (String(
  process.env.RUNNINGHUB_MEDIA_UPLOAD_BASE || "https://www.runninghub.cn",
).trim() || "https://www.runninghub.cn").replace(/\/$/, "");

const MOTION_NODE_VIDEO = String(process.env.RUNNINGHUB_MOTION_VIDEO_NODE_ID || "52").trim();
const MOTION_NODE_IMAGE = String(process.env.RUNNINGHUB_MOTION_IMAGE_NODE_ID || "167").trim();
/** `POST /openapi/v2/run/ai-app/{id}`: optional `webhookUrl` (RunningHub posts when task completes). */
const RUNNINGHUB_MOTION_WEBHOOK_URL = String(process.env.RUNNINGHUB_MOTION_WEBHOOK_URL || "").trim() || null;
/** OpenAPI: instance retention 10–180s (Enterprise Shared API keys). */
const RUNNINGHUB_MOTION_RETAIN_SECONDS_RAW = String(
  process.env.RUNNINGHUB_MOTION_RETAIN_SECONDS || "0",
).trim();

const SUBMIT_TIMEOUT_MS = 90_000;
const QUERY_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 600_000;
const MOTION_URL_FETCH_MAX_BYTES = 450 * 1024 * 1024;
const URL_FETCH_TIMEOUT_MS = 600_000;

if (!RUNNINGHUB_API_KEY) {
  console.warn("⚠️ RUNNINGHUB_API_KEY not set — NSFW motion control (Motion X) will not work");
} else {
  console.log(
    `[NSFW/motion] provider=runninghub appId=${RUNNINGHUB_MOTION_APP_ID} uploadBase=${RUNNINGHUB_MEDIA_UPLOAD_BASE}`,
  );
}

/**
 * @returns {Record<string, unknown>} Merged into `run/ai-app` body: optional `webhookUrl`, `retainSeconds` (when 10–180).
 */
function runningHubAiAppRunBodyExtras() {
  const o = {};
  if (RUNNINGHUB_MOTION_WEBHOOK_URL) {
    o.webhookUrl = RUNNINGHUB_MOTION_WEBHOOK_URL;
  }
  if (RUNNINGHUB_MOTION_RETAIN_SECONDS_RAW) {
    const n = Number.parseInt(RUNNINGHUB_MOTION_RETAIN_SECONDS_RAW, 10);
    if (Number.isFinite(n) && n >= 10 && n <= 180) {
      o.retainSeconds = n;
    }
  }
  return o;
}

function isPublicHttpUrl(s) {
  const t = String(s || "").trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    const h = (u.hostname || "").toLowerCase();
    if (!h || h === "localhost" || h === "127.0.0.1") return false;
    return true;
  } catch {
    return false;
  }
}

function pickContentType(headers, fallback) {
  const ct = headers?.get?.("content-type") || "";
  return (ct.split(";")[0] || "").trim() || fallback;
}

function extensionFromContentType(contentType, fallback) {
  if (!contentType) return fallback;
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return map[contentType.toLowerCase()] || fallback;
}

/**
 * Re-encode driving clip for VHS (OpenCV): see getMotionVhsVideoCodec() / getMotionVhsFfmpegOutputOpts().
 * @param {Buffer} inputBuffer
 * @param {string} sourceExt — e.g. mp4, webm, mov
 * @returns {Promise<Buffer | null>}
 */
async function transcodeDrivingVideoForVhsLocally(inputBuffer, sourceExt) {
  const id = randomBytes(8).toString("hex");
  const safeExt = String(sourceExt || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
  const inPath = path.join(os.tmpdir(), `rh-mo-in-${id}.${safeExt}`);
  const outPath = path.join(os.tmpdir(), `rh-mo-out-${id}.mp4`);
  const ff = getFfmpegPathSync();
  const inBytes = inputBuffer.length;
  const inSha = shortBufferSha16(inputBuffer);
  console.log(
    `[NSFW/motion] local transcode start inBytes=${inBytes} inSha16=${inSha} ext=${safeExt} ` +
      `codec=${getMotionVhsVideoCodec()} cfrOutFps=${getMotionVhsCfrFps() || "off"}`,
  );
  try {
    await fs.writeFile(inPath, inputBuffer);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inPath,
      "-vf",
      getMotionVhsVf(),
      ...getMotionVhsFfmpegOutputOpts(),
      outPath,
    ];
    console.log(
      "[NSFW/motion] local transcode running ffmpeg (first args): -y -i … -vf " +
        getMotionVhsVf().slice(0, 50) +
        "… " +
        getMotionVhsFfmpegOutputOpts().join(" "),
    );
    await execFileAsync(ff, args, { maxBuffer: 50 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    const out = await fs.readFile(outPath);
    if (out.length < 256) {
      console.warn(`[NSFW/motion] local transcode: output too small (${out.length} B)`);
      return null;
    }
    if (!bufferContainsFtypMp4(out)) {
      console.warn("[NSFW/motion] local transcode output missing ftyp — treating as failed");
      return null;
    }
    const outSha = shortBufferSha16(out);
    console.log(
      `[NSFW/motion] local transcode done outBytes=${out.length} outSha16=${outSha} ` +
        `sameShaAsInput=${outSha === inSha} (if true, input may already be same-bytes; still re-encode)`,
    );
    const vProbe = await validateVhsTranscodedBufferWithFfprobe(out, "local-ffmpeg");
    if (!vProbe.ok) {
      console.warn("[NSFW/motion] local transcode failed ffprobe gate:", vProbe.reason, vProbe.probeJson);
      return null;
    }
    return out;
  } catch (e) {
    console.warn("[NSFW/motion] ffmpeg transcode failed:", e?.message || e);
    return null;
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

function isFfmpegWorkerReachable() {
  return (
    getFfmpegWorkerBaseUrls().length > 0 &&
    Boolean(String(process.env.FFMPEG_WORKER_API_KEY || "").trim())
  );
}

/**
 * VHS-friendly transcode via the external ffmpeg worker using `returnBytes` mode. The worker
 * downloads the source, runs ffmpeg, and streams the output MP4 back in the HTTP response body
 * — no R2 or Vercel Blob needed.
 * @param {string} publicDrivingUrl - Public http(s) URL the worker can fetch
 * @returns {Promise<Buffer | null>}
 */
async function transcodeDrivingVideoViaFfmpegWorker(publicDrivingUrl) {
  const u = String(publicDrivingUrl || "").trim();
  if (!u.startsWith("http") || !isFfmpegWorkerReachable()) return null;
  const codec = getMotionVhsVideoCodec();
  const vf = getMotionVhsVf();
  const outOpts = getMotionVhsFfmpegOutputOpts();
  console.log(
    `[NSFW/motion] worker transcode (returnBytes) start inputUrl=${u.slice(0, 100)}` +
      (u.length > 100 ? "…" : "") +
      ` codec=${codec} cfrFpsOut=${getMotionVhsCfrFps() || "off"} vf=${vf.slice(0, 64)}… extraOptions=${outOpts.join(" ")}`,
  );
  let buf;
  try {
    const { buffer, bytes } = await postTranscodeJobToWorkerReturnBytes({
      inputUrl: u,
      vfFilter: vf,
      extraOptions: [...outOpts],
      outputContainerExt: ".mp4",
    });
    buf = buffer;
    if (!Buffer.isBuffer(buf) || buf.length < 256) {
      console.warn(`[NSFW/motion] worker returnBytes: output too small (${bytes} B)`);
      return null;
    }
    if (!bufferContainsFtypMp4(buf)) {
      console.warn("[NSFW/motion] worker returnBytes: output missing ftyp — treating as failed");
      return null;
    }
    console.log(
      `[NSFW/motion] worker returnBytes ok outBytes=${buf.length} outSha16=${shortBufferSha16(buf)}`,
    );
  } catch (e) {
    console.warn("[NSFW/motion] ffmpeg worker transcode (returnBytes) failed:", e?.message || e);
    return null;
  }
  const vProbe = await validateVhsTranscodedBufferWithFfprobe(buf, "worker-returnbytes");
  if (!vProbe.ok) {
    console.warn(
      "[NSFW/motion] worker returnBytes output failed ffprobe (bad for VHS):",
      vProbe.reason,
    );
    return null;
  }
  return buf;
}

/**
 * @param {string} url
 * @param {string} label
 * @param {string} expectedKind
 * @returns {Promise<{ buffer: Buffer, contentType: string, extension: string, bytes: number }>}
 */
export async function fetchUrlBufferForMotion(url, label, expectedKind) {
  if (!url) throw new Error(`${label}: URL is empty`);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`${label}: only http(s) URLs are supported`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`${label}: download failed (${err.message || "fetch"})`);
  }
  clearTimeout(timer);
  if (!resp.ok) {
    throw new Error(`${label}: HTTP ${resp.status} ${resp.statusText}`);
  }
  const cl = resp.headers.get("content-length");
  if (cl && Number.isFinite(Number(cl)) && Number(cl) > MOTION_URL_FETCH_MAX_BYTES) {
    throw new Error(
      `${label}: file is too large (${(Number(cl) / (1024 * 1024)).toFixed(0)} MB)`,
    );
  }
  const fallbackCt = expectedKind === "video" ? "video/mp4" : "image/jpeg";
  const contentType = pickContentType(resp.headers, fallbackCt);
  const ab = await resp.arrayBuffer();
  if (ab.byteLength > MOTION_URL_FETCH_MAX_BYTES) {
    throw new Error(
      `${label}: download too large (~${(ab.byteLength / (1024 * 1024)).toFixed(0)} MB)`,
    );
  }
  const buf = Buffer.from(ab);
  const ext = extensionFromContentType(contentType, expectedKind === "video" ? "mp4" : "jpg");
  return { buffer: buf, contentType, extension: ext, bytes: buf.length };
}

function fieldValueFromUploadData(data) {
  if (!data || typeof data !== "object") return null;
  const name = data.fileName || data.file_name || data.filename;
  if (typeof name === "string" && name.trim()) {
    const t = name.trim();
    if (t.includes("/")) {
      return t.split("/").pop() || t;
    }
    return t;
  }
  if (typeof data.download_url === "string" && data.download_url) {
    const s = data.download_url.split("?")[0] || data.download_url;
    const p = s.split("/").filter(Boolean);
    if (p.length) return p[p.length - 1];
  }
  return null;
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [contentType]
 * @returns {Promise<string | null>} Value for `fieldValue` in nodeInfoList, or null on hard failure
 */
export async function uploadBufferToRunningHub(buffer, filename, contentType = "application/octet-stream") {
  const uploadUrl = `${RUNNINGHUB_MEDIA_UPLOAD_BASE}/openapi/v2/media/upload/binary`;
  const form = new FormData();
  const file = new globalThis.File([buffer], filename, { type: contentType });
  form.append("file", file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${RUNNINGHUB_API_KEY}` },
      body: form,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`RunningHub media upload request failed: ${e.message || e}`);
  }
  clearTimeout(timer);
  const text = await resp.text().catch(() => "");
  let j;
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(
      `RunningHub media upload HTTP ${resp.status}: ${(text || "").slice(0, 400)}`,
    );
  }
  if (j.data && fieldValueFromUploadData(j.data)) {
    /* ok */
  } else if (Number(j.code) === 0 || j.code === "0" || j.success === true) {
    if (!j.data) throw new Error("RunningHub media upload: empty data");
  } else {
    const msg = j.message || j.msg || "upload failed";
    throw new Error(`RunningHub media upload: ${msg} (${(text || "").slice(0, 300)})`);
  }
  const v = fieldValueFromUploadData(j.data);
  if (!v) {
    throw new Error("RunningHub media upload: missing fileName in response");
  }
  return v;
}

async function postRunningHubJson(path, body) {
  const url = `${RUNNINGHUB_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const t = setTimeout(
    () => controller.abort(),
    path.includes("query") ? QUERY_TIMEOUT_MS : SUBMIT_TIMEOUT_MS,
  );
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    throw new Error(`RunningHub request failed: ${e.message || e}`);
  }
  clearTimeout(t);
  const text = await resp.text().catch(() => "");
  let j;
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = { _raw: text };
  }
  if (!resp.ok) {
    throw new Error(
      `RunningHub HTTP ${resp.status}: ${(text || JSON.stringify(j)).slice(0, 500)}`,
    );
  }
  return j;
}

/**
 * @param {object} opts
 * @param {string} opts.referenceImageUrl
 * @param {string} opts.drivingVideoUrl
 * @param {string} [opts.prompt] — optional; not sent if the AI app has no bound nodes
 * @param {string} [opts.negativePrompt]
 * @param {number} [opts.durationSecs]
 * @param {number} [opts.skipSecs]
 * @param {number} [opts.fps] [opts.width] [opts.height] [opts.seed] [opts.torchCompile] [opts.blockSwap]
 * @param {string|null} [generationId]
 * @returns {Promise<{ success: boolean, requestId?: string, seed?: number, bytes?: object, error?: string }>}
 */
export async function submitNsfwMotionVideo(opts, generationId = null) {
  if (!RUNNINGHUB_API_KEY) {
    return { success: false, error: "RUNNINGHUB_API_KEY not configured" };
  }
  if (!RUNNINGHUB_MOTION_APP_ID) {
    return { success: false, error: "RUNNINGHUB_MOTION_APP_ID not configured" };
  }

  const { referenceImageUrl, drivingVideoUrl, seed } = opts || {};
  if (!referenceImageUrl) return { success: false, error: "referenceImageUrl is required" };
  if (!drivingVideoUrl) return { success: false, error: "drivingVideoUrl is required" };

  const refStr = String(referenceImageUrl).trim();
  const drvStr = String(drivingVideoUrl).trim();
  if (!isPublicHttpUrl(refStr) || !isPublicHttpUrl(drvStr)) {
    return {
      success: false,
      error:
        "Reference image and driving video must be public http(s) URLs (upload to storage first, then pass those links).",
    };
  }

  let img;
  let vid;
  try {
    img = await fetchUrlBufferForMotion(refStr, "Reference image", "image");
    vid = await fetchUrlBufferForMotion(drvStr, "Driving video", "video");
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }

  const imageFilename = `ref-${generationId || "g"}.${img.extension}`;

  console.log(
    `[NSFW/motion] VHS trace [gen=${generationId || "—"}] downloaded: drivingBytes=${vid.bytes} drivingSha16=${shortBufferSha16(vid.buffer)} refImageBytes=${img.bytes}`,
  );

  if (NSFW_MOTION_LOG_ENV) {
    console.log(
      `[NSFW/motion] env: FFMPEG_WORKER_URL=${Boolean(getFfmpegWorkerBaseUrls().length)} ` +
        `FFMPEG_WORKER_API_KEY=${Boolean(String(process.env.FFMPEG_WORKER_API_KEY || "").trim())} ` +
        `FFMPEG_PATH=${String(process.env.FFMPEG_PATH || "(unset)")} ` +
        `codec=${getMotionVhsVideoCodec()} cfrFps=${getMotionVhsCfrFps() || "off"} ` +
        `STRICT_ALWAYS=true ALLOW_UNTRANSCODED=${NSFW_MOTION_ALLOW_UNTRANSCODED}`,
    );
  }

  let videoBufferToUpload = vid.buffer;
  let videoUploadExt = vid.extension;
  let videoContentType = vid.contentType;
  let transcodeSource = null;
  if (NSFW_MOTION_TRANSCODE) {
    let workerOut = await transcodeDrivingVideoViaFfmpegWorker(drvStr);
    if (workerOut && !bufferContainsFtypMp4(workerOut)) {
      console.warn("[NSFW/motion] worker transcode not a valid MP4; trying local ffmpeg");
      workerOut = null;
    }
    let tc = workerOut || (await transcodeDrivingVideoForVhsLocally(vid.buffer, vid.extension));
    if (tc && !bufferContainsFtypMp4(tc)) {
      console.warn("[NSFW/motion] local transcode not a valid MP4");
      tc = null;
    }
    if (tc) {
      videoBufferToUpload = Buffer.from(tc);
      videoUploadExt = "mp4";
      videoContentType = "video/mp4";
      transcodeSource = workerOut ? "ffmpeg worker" : "local ffmpeg";
      const mb = videoBufferToUpload.length / (1024 * 1024);
      console.log(
        `[NSFW/motion] driving video transcoded (${transcodeSource}, ${getMotionVhsVideoCodec()}) for VHS MP4 ≈${mb.toFixed(2)} MiB (was ${vid.extension})`,
      );
    } else {
      return {
        success: false,
        error:
          "Driving video could not be re-encoded for VHS (OpenCV). RunningHub content-addresses uploads " +
          "(SHA-256 → filename), so uploading raw bytes reuses the same filename that already failed on their side. " +
          "Configure EXACTLY ONE of: (a) FFMPEG_PATH to /usr/bin/ffmpeg on the API host, or " +
          "(b) FFMPEG_WORKER_URL + FFMPEG_WORKER_API_KEY (worker streams bytes back, no R2/Blob needed). " +
          "To debug, set NSFW_MOTION_LOG_ENV=true and resubmit.",
      };
    }
  }

  // Hard gate: if we are about to upload bytes identical to the driving source, RunningHub will
  // re-use the exact same filename hash that already failed on VHS — never upload no-op re-encodes.
  const sourceSha = shortBufferSha16(vid.buffer);
  const outSha = shortBufferSha16(videoBufferToUpload);
  const bytesDiffer = outSha !== sourceSha;
  console.log(
    `[NSFW/motion] VHS trace [gen=${generationId || "—"}] pre-RunningHub upload: ` +
      `videoOutBytes=${videoBufferToUpload.length} videoOutSha16=${outSha} ` +
      `sourceSha16=${sourceSha} bytesDiffer=${bytesDiffer} transcodeSource=${transcodeSource || "none"} ` +
      `ext=${videoUploadExt} ftypHeadHex=${videoBufferToUpload.subarray(0, 32).toString("hex")}`,
  );

  if (NSFW_MOTION_DEBUG_UPLOAD_BLOB && videoBufferToUpload.length > 0) {
    try {
      const debugUrl = await uploadBufferToBlobOrR2(
        videoBufferToUpload,
        "nsfw-motion-debug",
        "mp4",
        "video/mp4",
      );
      console.log(
        `[NSFW/motion] DEBUG transcoded clip mirrored to Blob for inspection: ${debugUrl}`,
      );
    } catch (e) {
      console.warn("[NSFW/motion] DEBUG upload to Blob failed:", e?.message || e);
    }
  }
  if (NSFW_MOTION_TRANSCODE && !bytesDiffer && !NSFW_MOTION_ALLOW_UNTRANSCODED) {
    return {
      success: false,
      error:
        `Transcode produced identical bytes to the source (sha16=${outSha}). RunningHub would re-use ` +
        "the same filename hash that already failed on VHS (cv). Verify the ffmpeg re-encode actually ran; " +
        "set NSFW_MOTION_ALLOW_UNTRANSCODED=true only for one-off debugging.",
    };
  }
  if (!NSFW_MOTION_TRANSCODE && !NSFW_MOTION_ALLOW_UNTRANSCODED) {
    return {
      success: false,
      error:
        "NSFW_MOTION_TRANSCODE=false is not supported for Motion X (VHS_LoadVideo requires cv-friendly MP4). " +
        "Enable transcode (default on) and configure FFMPEG_PATH or FFMPEG_WORKER_URL + R2.",
    };
  }

  const videoFilename = `drive-${generationId || "g"}.${videoUploadExt}`;

  let imageFieldValue;
  let videoFieldValue;
  try {
    imageFieldValue = await uploadBufferToRunningHub(img.buffer, imageFilename, img.contentType);
    console.log(
      `[NSFW/motion] RunningHub POST ${RUNNINGHUB_MEDIA_UPLOAD_BASE}/.../upload/binary (video) ` +
        `fileName=${videoFilename} contentType=${videoContentType} bodyBytes=${videoBufferToUpload.length} bodySha16=${outSha}`,
    );
    videoFieldValue = await uploadBufferToRunningHub(
      videoBufferToUpload,
      videoFilename,
      videoContentType,
    );
    console.log(
      `[NSFW/motion] RunningHub video fieldValue (server-side name, typically hash of file bytes)=${videoFieldValue} — ` +
        `repeated names across different source videos means identical upload bytes`,
    );
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }

  const finalSeed = Number.isFinite(Number(seed))
    ? Math.trunc(Math.abs(Number(seed))) % 2 ** 53
    : Math.floor(Math.random() * 2 ** 53);

  const runBody = {
    // Official OpenAPI examples and call records include this for AI-app runs.
    randomSeed: true,
    nodeInfoList: [
      {
        nodeId: MOTION_NODE_VIDEO,
        fieldName: "video",
        fieldValue: videoFieldValue,
        description: "video",
      },
      {
        nodeId: MOTION_NODE_IMAGE,
        fieldName: "image",
        fieldValue: imageFieldValue,
        description: "image",
      },
    ],
    instanceType: "default",
    // Official curl uses the JSON string "false" (not boolean); some stacks expect this shape.
    usePersonalQueue: "false",
    retainSeconds: 0,
    ...runningHubAiAppRunBodyExtras(),
  };
  if (RUNNINGHUB_MOTION_WEBHOOK_URL) {
    console.log(
      "[NSFW/motion] run/ai-app including webhookUrl=",
      `${RUNNINGHUB_MOTION_WEBHOOK_URL.slice(0, 100)}${RUNNINGHUB_MOTION_WEBHOOK_URL.length > 100 ? "…" : ""}`,
    );
  }
  let submitRes;
  try {
    const path = `/openapi/v2/run/ai-app/${encodeURIComponent(RUNNINGHUB_MOTION_APP_ID)}`;
    submitRes = await postRunningHubJson(path, runBody);
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }

  const errMsg = submitRes && (submitRes.errorMessage || submitRes.message);
  if (errMsg && String(errMsg).trim() && !submitRes.taskId) {
    return { success: false, error: `RunningHub submit: ${errMsg}` };
  }

  const requestId = submitRes.taskId || submitRes.task_id;
  if (!requestId) {
    return {
      success: false,
      error: `RunningHub submit returned no taskId: ${JSON.stringify(submitRes).slice(0, 500)}`,
    };
  }

  const st0 = String(submitRes.status || "").toUpperCase();
  if (st0 && ["FAILED", "CANCELLED"].includes(st0)) {
    return {
      success: false,
      error: `RunningHub: ${st0} ${errMsg || ""}`.trim(),
    };
  }

  console.log(
    `[NSFW/motion] RunningHub task=${requestId} genId=${generationId || "—"} ` +
      `up≈${((img.bytes + videoBufferToUpload.length) / (1024 * 1024)).toFixed(2)} MiB`,
  );

  return {
    success: true,
    requestId: String(requestId),
    seed: finalSeed,
    bytes: { image: img.bytes, video: videoBufferToUpload.length, mode: "runninghub" },
  };
}

/**
 * @param {string} st
 * @returns {"success" | "failed" | "in_progress" | "unknown"}
 */
function mapRunningHubQueryStatus(st) {
  const u = String(st || "").toUpperCase();
  if (u === "SUCCESS" || u === "COMPLETED" || u === "SUCCEEDED" || u === "DONE")
    return "success";
  if (u === "FAILED" || u === "CANCELLED" || u === "CANCELED" || u === "ERROR") return "failed";
  if (u === "QUEUED" || u === "RUNNING" || u === "PENDING" || u === "IN_QUEUE" || u === "IN_PROGRESS")
    return "in_progress";
  if (!u) return "unknown";
  return "in_progress";
}

/**
 * Polling: POST /openapi/v2/query { taskId }.
 * Returns a normalized object so generation-poller and GET /generations/:id accept `status` the same
 * as the former RunPod poll (`success` / `failed` / in-progress string).
 * @param {string} jobId
 */
export async function checkNsfwMotionStatus(jobId) {
  if (!RUNNINGHUB_API_KEY) {
    return { status: "failed", error: "RUNNINGHUB_API_KEY not configured" };
  }
  if (!jobId) {
    return { status: "failed", error: "No task id" };
  }
  let data;
  try {
    data = await postRunningHubJson("/openapi/v2/query", { taskId: String(jobId) });
  } catch (e) {
    return { status: "in_progress", error: e.message, _transient: true };
  }
  const mapped = mapRunningHubQueryStatus(data.status);
  if (mapped === "success") {
    return { ...data, status: "success" };
  }
  if (mapped === "failed") {
    return {
      ...data,
      status: "failed",
      error: data.errorMessage || data.error || data.failedReason || "RunningHub task failed",
    };
  }
  if (mapped === "unknown" && (data.errorMessage || data.errorCode)) {
    return { ...data, status: "failed", error: data.errorMessage || data.errorCode || "Failed" };
  }
  return { ...data, status: "in_progress" };
}

/**
 * Pick first mp4 (or any video) URL from a RunningHub query `results` array.
 */
function firstVideoResultUrl(queryLike) {
  if (!queryLike || !Array.isArray(queryLike.results)) return null;
  for (const r of queryLike.results) {
    if (!r) continue;
    const ot = String(r.outputType || "").toLowerCase();
    if (r.url && (ot === "mp4" || ot === "webm" || ot === "mov" || (ot && ot.includes("video")))) {
      return r.url;
    }
  }
  for (const r of queryLike.results) {
    if (r?.url && (String(r.url).toLowerCase().endsWith(".mp4") || String(r.url).includes("video")))
      return r.url;
  }
  for (const r of queryLike.results) {
    if (r?.url) return r.url;
  }
  return null;
}

const RH_FETCH_TIMEOUT_MS = 600_000;

/**
 * Download a temporary RunningHub / COS URL and mirror to our blob storage.
 * @param {string} publicUrl
 * @returns {Promise<string | null>}
 */
async function mirrorHttpVideoToOurStorage(publicUrl) {
  if (typeof publicUrl !== "string" || !publicUrl.startsWith("http")) return null;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), RH_FETCH_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(publicUrl, { signal: c.signal });
  } catch (e) {
    clearTimeout(t);
    return null;
  }
  clearTimeout(t);
  if (!r.ok) return null;
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length < 64) return null;
  const ct = pickContentType(r.headers, "video/mp4");
  const isPng = (ct || "").toLowerCase().includes("image/png");
  if (isPng) {
    return uploadBufferToBlobOrR2(buf, "nsfw-video-motion", "png", "image/png");
  }
  return uploadBufferToBlobOrR2(buf, "nsfw-video-motion", "mp4", "video/mp4");
}

/**
 * RunPod webhook/status compatibility: deep-unwrapped handler output, base64 video.
 * @param {*} raw
 */
export function normalizeNsfwMotionRunpodOutput(input) {
  void input;
  return null;
}

export function extractNsfwMotionVideo(_raw) {
  return null;
}

/**
 * Finalize output: RunningHub `query` body with `results[].url`, or legacy RunPod nested shapes.
 * @returns {Promise<string | null>}
 */
export async function materializeNsfwMotionOutputFromRunpodResponse(rp) {
  if (!rp || typeof rp !== "object") return null;

  const vUrl = firstVideoResultUrl(rp);
  if (vUrl) {
    return mirrorHttpVideoToOurStorage(vUrl);
  }
  if (Array.isArray(rp.results) && rp.results[0]?.text && typeof rp.results[0].text === "string") {
    if (rp.results[0].text.trim().startsWith("http")) {
      return mirrorHttpVideoToOurStorage(rp.results[0].text.trim());
    }
  }
  return null;
}

/**
 * @param {*} raw
 */
export function extractNsfwMotionSeed(_raw) {
  return null;
}

/**
 * @returns {boolean}
 */
export function isNsfwMotionConfigured() {
  return Boolean(RUNNINGHUB_API_KEY && RUNNINGHUB_MOTION_APP_ID);
}
