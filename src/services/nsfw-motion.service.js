/**
 * NSFW Motion Control video (Motion X) via RunningHub AI app + media upload.
 *
 * - POST /api/nsfw/generate-motion-video
 * - Generation type: nsfw-video-motion
 *
 * Flow: download public reference + driving video URLs, upload to RunningHub binary API
 * (`POST {RUNNINGHUB_MEDIA_UPLOAD_BASE}/openapi/v2/media/upload/binary`), then
 * `POST {RUNNINGHUB_API_BASE}/openapi/v2/run/workflow/{workflowId}` with `nodeInfoList`, poll
 * `POST /openapi/v2/query` — mirror the output mp4 to Blob/R2 (RunningHub result URLs expire ~24h).
 *
 * Env: RUNNINGHUB_API_KEY, RUNNINGHUB_MOTION_WORKFLOW_ID (default below; legacy RUNNINGHUB_MOTION_APP_ID still read as fallback),
 * optional RUNNINGHUB_API_BASE / RUNNINGHUB_MEDIA_UPLOAD_BASE,
 * optional OpenAPI: TASK_END webhook via same public base as the rest of the app (`getRunningHubWebhookUrl()`), optional RUNNINGHUB_MOTION_WEBHOOK_URL override; RUNNINGHUB_MOTION_RETAIN_SECONDS (10–180, enterprise).
 * Driving video is re-encoded for VHS (OpenCV `VideoCapture` + `grab()`) before upload (unless NSFW_MOTION_TRANSCODE=false).
 * Default codec is **MPEG-4 Part 2 (mpeg4 / mp4v)** — often more reliable than H.264 on some OpenCV+FFmpeg builds; override with
 * NSFW_MOTION_VHS_VIDEO_CODEC=libx264. Optional constant frame rate: NSFW_MOTION_VHS_CFR_FPS=30 (0=off) helps broken fps metadata.
 * Uses the same FFmpeg worker as repurposer/reformatter (`FFMPEG_WORKER_URL` + `FFMPEG_WORKER_API_KEY`).
 * Driving URL is mirrored to Blob (when configured) or re-uploaded to Blob/R2 so the worker can fetch it
 * — same pattern as `POST /api/reformatter/convert-with-worker`. Tries `/transcode` returnBytes, then R2 presigned PUT.
 * Fallback: local ffmpeg (`FFMPEG_PATH`) when the worker is not configured.
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
import { getRunningHubWebhookUrl } from "./runninghub.service.js";
import { postTranscodeJobToWorker, postTranscodeJobToWorkerReturnBytes } from "./ffmpeg-worker-client.js";
import { uploadBufferToBlobOrR2, mirrorToBlob, isVercelBlobConfigured } from "../utils/kieUpload.js";
import { isR2Configured, getR2PresignedPutForKey } from "../utils/r2.js";
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
 * (check cv2 compatibility locally) before it's POSTed to RunningHub. Default ON; set to "false" to skip.
 */
const NSFW_MOTION_DEBUG_UPLOAD_BLOB =
  String(process.env.NSFW_MOTION_DEBUG_UPLOAD_BLOB || "true").toLowerCase() !== "false";

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
 * Audio mux options shared by both VHS transcode profiles. We keep the source audio so RunningHub's
 * VHS_LoadVideo emits a real `audio` output that downstream VHS_VideoCombine nodes can save into the
 * final MP4 (otherwise every Motion X output is silent regardless of how the workflow is wired).
 *
 * `-map 0:v:0 -map 0:a:0?` keeps things deterministic when the source has multiple streams and stays
 * silent when the source has no audio at all (the `?` suffix makes the audio map optional). AAC LC at
 * 128 kbps stereo @ 48 kHz is the safest baseline that ComfyUI / VHS_LoadVideo + downstream
 * VHS_VideoCombine accept on every RunningHub instance type. Override with `NSFW_MOTION_VHS_AUDIO=off`
 * to fall back to silent uploads (legacy behaviour).
 */
function getMotionVhsAudioOpts() {
  const raw = String(process.env.NSFW_MOTION_VHS_AUDIO ?? "aac").toLowerCase();
  const off = raw === "0" || raw === "off" || raw === "false" || raw === "no" || raw === "none" || raw === "an";
  if (off) return ["-an"];
  return [
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-ar",
    "48000",
  ];
}

/**
 * H.264 "main" MP4 with explicit avc1 tag + bt.709 color + CFR + repeated parameter sets. This is
 * the widest-compatibility cv2 profile — broader than baseline for some headless OpenCV builds
 * that only ship avc1/main support. Use for VHS_LoadVideo on ComfyUI/RunningHub.
 *
 * Audio: pass-through-then-AAC mux via {@link getMotionVhsAudioOpts} so the source audio survives
 * into the RunningHub upload (and therefore into the final Motion X MP4).
 */
const MOTION_VHS_X264_OUT_BASE = [
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
  "-movflags",
  "+faststart",
];
/** MPEG-4 Part 2 fallback — sometimes works where libx264 doesn't, but less reliable overall. */
const MOTION_VHS_MPEG4_OUT_BASE = [
  "-c:v",
  "mpeg4",
  "-vtag",
  "mp4v",
  "-q:v",
  "5",
  "-pix_fmt",
  "yuv420p",
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
  const baseOpts =
    getMotionVhsVideoCodec() === "libx264" ? [...MOTION_VHS_X264_OUT_BASE] : [...MOTION_VHS_MPEG4_OUT_BASE];
  return [...baseOpts, ...getMotionVhsAudioOpts()];
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
/** Published ComfyUI workflow on RunningHub (OpenAPI `run/workflow/{id}`). */
const DEFAULT_MOTION_WORKFLOW_ID = "2048356312307736578";
const RUNNINGHUB_MOTION_WORKFLOW_ID = String(
  process.env.RUNNINGHUB_MOTION_WORKFLOW_ID ||
    process.env.RUNNINGHUB_MOTION_APP_ID ||
    DEFAULT_MOTION_WORKFLOW_ID,
).trim() || null;

const RUNNINGHUB_API_BASE = (String(process.env.RUNNINGHUB_API_BASE || "https://www.runninghub.ai").trim() ||
  "https://www.runninghub.ai").replace(/\/$/, "");
const RUNNINGHUB_MEDIA_UPLOAD_BASE = (String(
  process.env.RUNNINGHUB_MEDIA_UPLOAD_BASE || "https://www.runninghub.cn",
).trim() || "https://www.runninghub.cn").replace(/\/$/, "");

const MOTION_NODE_VIDEO = String(process.env.RUNNINGHUB_MOTION_VIDEO_NODE_ID || "52").trim();
const MOTION_NODE_IMAGE = String(process.env.RUNNINGHUB_MOTION_IMAGE_NODE_ID || "167").trim();
/** `POST /openapi/v2/run/workflow/{id}`: optional `webhookUrl` (RunningHub posts when task completes). */
const RUNNINGHUB_MOTION_WEBHOOK_URL = String(process.env.RUNNINGHUB_MOTION_WEBHOOK_URL || "").trim() || null;
/** OpenAPI: instance retention 10–180s (Enterprise Shared API keys). */
const RUNNINGHUB_MOTION_RETAIN_SECONDS_RAW = String(
  process.env.RUNNINGHUB_MOTION_RETAIN_SECONDS || "0",
).trim();

const SUBMIT_TIMEOUT_MS = 90_000;
const QUERY_TIMEOUT_MS = 30_000;
/** Motion X uploads / source URL fetches can be large; allow up to 1h per request. */
const UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;
const MOTION_URL_FETCH_MAX_BYTES = 450 * 1024 * 1024;
const URL_FETCH_TIMEOUT_MS = 60 * 60 * 1000;

if (!RUNNINGHUB_API_KEY) {
  console.warn("⚠️ RUNNINGHUB_API_KEY not set — NSFW motion control (Motion X) will not work");
} else {
  console.log(
    `[NSFW/motion] provider=runninghub workflowId=${RUNNINGHUB_MOTION_WORKFLOW_ID} uploadBase=${RUNNINGHUB_MEDIA_UPLOAD_BASE}`,
  );
}

/**
 * @returns {Record<string, unknown>} Merged into `run/workflow` body: optional `webhookUrl`, `retainSeconds` (when 10–180).
 */
function runningHubWorkflowRunBodyExtras() {
  const o = {};
  const wh = RUNNINGHUB_MOTION_WEBHOOK_URL || getRunningHubWebhookUrl();
  if (wh) {
    o.webhookUrl = wh;
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
 * URL the ffmpeg worker can fetch — mirrors reformatter: Blob relay when `BLOB_READ_WRITE_TOKEN` is set,
 * else uploads the already-downloaded bytes to Blob/R2 so the worker is not limited to URLs only
 * reachable from the API host.
 *
 * @param {string} originalUrl
 * @param {{ buffer: Buffer, extension: string, contentType: string }} vid
 * @returns {Promise<string>}
 */
async function resolveDrivingVideoUrlForFfmpegWorker(originalUrl, vid) {
  const u = String(originalUrl || "").trim();
  if (!u.startsWith("http")) return u;
  if (isVercelBlobConfigured()) {
    try {
      const mirrored = await mirrorToBlob(u, "kie-media");
      if (mirrored && String(mirrored).startsWith("http")) {
        console.log("[NSFW/motion] ffmpeg worker input: mirrorToBlob (same as reformatter)");
        return mirrored.trim();
      }
    } catch (e) {
      console.warn("[NSFW/motion] mirrorToBlob for ffmpeg worker failed:", e?.message || e);
    }
  }
  try {
    const published = await uploadBufferToBlobOrR2(
      vid.buffer,
      "user-uploads",
      vid.extension,
      vid.contentType,
    );
    console.log("[NSFW/motion] ffmpeg worker input: published copy for worker fetch");
    return String(published).trim();
  } catch (e) {
    console.warn("[NSFW/motion] could not publish driving video for worker, using original URL:", e?.message || e);
    return u;
  }
}

async function finalizeWorkerTranscodedMp4(buf, probeLabel) {
  if (!Buffer.isBuffer(buf) || buf.length < 256) return null;
  if (!bufferContainsFtypMp4(buf)) {
    console.warn(`[NSFW/motion] worker ${probeLabel}: output missing ftyp`);
    return null;
  }
  const vProbe = await validateVhsTranscodedBufferWithFfprobe(buf, probeLabel);
  if (!vProbe.ok) {
    console.warn(`[NSFW/motion] worker ${probeLabel} failed ffprobe (VHS):`, vProbe.reason);
    return null;
  }
  return buf;
}

/**
 * VHS-friendly transcode via the external ffmpeg worker (`POST /transcode`).
 * Tries returnBytes first; if that fails (older worker), uses R2 presigned PUT when R2 is configured.
 * @param {string} workerInputUrl - http(s) URL the worker can fetch (use {@link resolveDrivingVideoUrlForFfmpegWorker})
 * @returns {Promise<Buffer | null>}
 */
async function transcodeDrivingVideoViaFfmpegWorker(workerInputUrl) {
  const u = String(workerInputUrl || "").trim();
  if (!u.startsWith("http") || !isFfmpegWorkerReachable()) return null;
  const codec = getMotionVhsVideoCodec();
  const vf = getMotionVhsVf();
  const outOpts = getMotionVhsFfmpegOutputOpts();
  console.log(
    `[NSFW/motion] worker transcode start inputUrl=${u.slice(0, 100)}` +
      (u.length > 100 ? "…" : "") +
      ` codec=${codec} cfrFpsOut=${getMotionVhsCfrFps() || "off"} vf=${vf.slice(0, 64)}… extraOptions=${outOpts.join(" ")}`,
  );

  try {
    const { buffer, bytes } = await postTranscodeJobToWorkerReturnBytes({
      inputUrl: u,
      vfFilter: vf,
      extraOptions: [...outOpts],
      outputContainerExt: ".mp4",
    });
    if (!Buffer.isBuffer(buffer) || buffer.length < 256) {
      console.warn(`[NSFW/motion] worker returnBytes: output too small (${bytes} B)`);
    } else {
      console.log(
        `[NSFW/motion] worker returnBytes ok outBytes=${buffer.length} outSha16=${shortBufferSha16(buffer)}`,
      );
      const ok = await finalizeWorkerTranscodedMp4(buffer, "worker-returnbytes");
      if (ok) return ok;
    }
  } catch (e) {
    console.warn("[NSFW/motion] ffmpeg worker transcode (returnBytes) failed:", e?.message || e);
  }

  if (isR2Configured()) {
    try {
      const id = randomBytes(8).toString("hex");
      const key = `nsfw-motion-vhs/${Date.now()}-${id}.mp4`;
      const { uploadUrl, publicUrl } = await getR2PresignedPutForKey(key, "video/mp4", 3600);
      await postTranscodeJobToWorker({
        inputUrl: u,
        vfFilter: vf,
        extraOptions: [...outOpts],
        outputPutUrl: { putUrl: uploadUrl, publicUrl, contentType: "video/mp4" },
      });
      const outResp = await fetch(publicUrl, { signal: AbortSignal.timeout(120_000) });
      if (!outResp.ok) {
        throw new Error(`fetch transcoded output: HTTP ${outResp.status}`);
      }
      const buf = Buffer.from(await outResp.arrayBuffer());
      console.log(
        `[NSFW/motion] worker transcode (R2 PUT) ok outBytes=${buf.length} outSha16=${shortBufferSha16(buf)}`,
      );
      return await finalizeWorkerTranscodedMp4(buf, "worker-r2-put");
    } catch (e) {
      console.warn("[NSFW/motion] ffmpeg worker transcode (R2 PUT) failed:", e?.message || e);
    }
  }

  return null;
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

/**
 * Value for workflow `nodeInfoList[].fieldValue` after `upload/binary`.
 * RunningHub returns `data.fileName` like `openapi/<hash>.mp4`; Comfy VHS_LoadVideo resolves files under
 * input using that path — stripping to basename breaks loading on the server.
 * Same logic for reference image (node 167) and driving video (node 52); RH may use flat or prefixed paths — we pass through whatever path they return.
 */
function fieldValueFromUploadData(data) {
  if (!data || typeof data !== "object") return null;
  const name = data.fileName || data.file_name || data.filename;
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }
  if (typeof data.download_url === "string" && data.download_url) {
    const s = data.download_url.split("?")[0] || data.download_url;
    try {
      const p = new URL(s, "https://www.runninghub.cn").pathname.replace(/^\/+/, "");
      if (p) return p;
    } catch {
      /* relative path */
    }
    const p = s.split("/").filter(Boolean);
    if (p.length) return p.join("/");
  }
  return null;
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [contentType]
 * @param {string} [logLabel] — "image" | "video" | etc. for logs when the response shape breaks
 * @returns {Promise<string | null>} Value for `fieldValue` in nodeInfoList, or null on hard failure
 */
export async function uploadBufferToRunningHub(
  buffer,
  filename,
  contentType = "application/octet-stream",
  logLabel = "media",
) {
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
    const dataPreview =
      j.data && typeof j.data === "object"
        ? JSON.stringify(j.data).slice(0, 400)
        : String(j.data ?? "").slice(0, 200);
    console.warn(
      `[NSFW/motion] RunningHub upload/binary [${logLabel}]: cannot derive workflow fieldValue — ` +
        "expected `data.fileName` (full path, e.g. openapi/…) or parseable `data.download_url`. " +
        `data=${dataPreview || "(none)"}`,
    );
    throw new Error(
      `RunningHub media upload [${logLabel}]: missing fileName / parseable download_url — ` +
        "workflow nodeInfoList would get an empty fieldValue (check RunningHub response format).",
    );
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
  if (!RUNNINGHUB_MOTION_WORKFLOW_ID) {
    return { success: false, error: "RUNNINGHUB_MOTION_WORKFLOW_ID not configured" };
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
    const workerInputUrl = isFfmpegWorkerReachable()
      ? await resolveDrivingVideoUrlForFfmpegWorker(drvStr, vid)
      : drvStr;
    let workerOut = await transcodeDrivingVideoViaFfmpegWorker(workerInputUrl);
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
          "(SHA-256 → filename), so unchanged bytes reuse a filename that may already be bad upstream. " +
          "Motion uses the same ffmpeg worker as repurposer/reformatter when `FFMPEG_WORKER_URL` and " +
          "`FFMPEG_WORKER_API_KEY` are set (with Blob mirror for worker fetch, like convert-with-worker). " +
          "If the worker is old, redeploy it so `POST /transcode` supports returnBytes or R2 PUT output. " +
          "Otherwise set `FFMPEG_PATH` on the API host for local ffmpeg.",
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
        "Enable transcode (default on) and configure the ffmpeg worker or FFMPEG_PATH.",
    };
  }

  const videoFilename = `drive-${generationId || "g"}.${videoUploadExt}`;

  let imageFieldValue;
  let videoFieldValue;
  try {
    imageFieldValue = await uploadBufferToRunningHub(img.buffer, imageFilename, img.contentType, "image");
    console.log(
      `[NSFW/motion] RunningHub upload/binary (image) clientName=${imageFilename} bytes=${img.bytes} fieldValue=${imageFieldValue}`,
    );
    videoFieldValue = await uploadBufferToRunningHub(
      videoBufferToUpload,
      videoFilename,
      videoContentType,
      "video",
    );
    console.log(
      `[NSFW/motion] RunningHub upload/binary (video) clientName=${videoFilename} contentType=${videoContentType} ` +
        `bodyBytes=${videoBufferToUpload.length} bodySha16=${outSha} fieldValue=${videoFieldValue} ` +
        `(use full path from API in workflow; identical fieldValue ⇒ identical file bytes)`,
    );
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }

  const finalSeed = Number.isFinite(Number(seed))
    ? Math.trunc(Math.abs(Number(seed))) % 2 ** 53
    : Math.floor(Math.random() * 2 ** 53);

  const runBody = {
    addMetadata: true,
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
    // OpenAPI example uses the JSON string "false".
    usePersonalQueue: "false",
    ...runningHubWorkflowRunBodyExtras(),
  };
  if (RUNNINGHUB_MOTION_WEBHOOK_URL) {
    console.log(
      "[NSFW/motion] run/workflow including webhookUrl=",
      `${RUNNINGHUB_MOTION_WEBHOOK_URL.slice(0, 100)}${RUNNINGHUB_MOTION_WEBHOOK_URL.length > 100 ? "…" : ""}`,
    );
  }
  let submitRes;
  try {
    const path = `/openapi/v2/run/workflow/${encodeURIComponent(RUNNINGHUB_MOTION_WORKFLOW_ID)}`;
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
export function mapRunningHubQueryStatus(st) {
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
 * Resolve the status string from any RunningHub response shape.
 * Flat: `{ status: "SUCCESS", results: [...] }`
 * Wrapped: `{ code: 0, msg: "ok", data: { status, results } }`
 * Webhook-ish: `{ eventData: { status, ... } }`
 * Returns the first non-empty status string we find or null.
 */
export function pickRunningHubStatus(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.status,
    data.taskStatus,
    data.data?.status,
    data.eventData?.status,
    data.eventData?.data?.status,
    data.body?.status,
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s) return s;
  }
  return null;
}

export function pickRunningHubError(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.errorMessage,
    data.error,
    data.failedReason?.message,
    data.failedReason,
    data.data?.errorMessage,
    data.data?.error,
    data.data?.failedReason?.message,
    data.eventData?.errorMessage,
    data.eventData?.error,
    data.eventData?.data?.errorMessage,
    data.errorCode,
    data.data?.errorCode,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const j = JSON.stringify(c).slice(0, 240);
      if (j && j !== "{}") return j;
    }
  }
  return null;
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
  const rawStatus = pickRunningHubStatus(data);
  const mapped = mapRunningHubQueryStatus(rawStatus);
  // Cross-check: even if the wrapper says "queued", a results[] full of
  // video URLs means the job is done. RH has been observed to lag the
  // status flip by a poll cycle in some regions.
  const hasResults = Boolean(findResultsArray(data));
  if (mapped === "success" || (hasResults && mapped !== "failed")) {
    return { ...data, status: "success" };
  }
  if (mapped === "failed") {
    return {
      ...data,
      status: "failed",
      error: pickRunningHubError(data) || "RunningHub task failed",
    };
  }
  if (mapped === "unknown" && pickRunningHubError(data)) {
    return { ...data, status: "failed", error: pickRunningHubError(data) || "Failed" };
  }
  return { ...data, status: "in_progress" };
}

/**
 * Motion X Comfy workflow emits multiple video outputs (e.g. head-tracking preview first).
 * The user-facing result is the 3rd slot (index 2) among the typical 4 outputs.
 */
const MOTION_X_FINAL_RESULT_INDEX = 2;

function resultHttpUrl(row) {
  if (!row || typeof row !== "object") return null;
  const u = row.url;
  if (typeof u === "string" && u.trim().startsWith("http")) return u.trim();
  const txt = row.text;
  if (typeof txt === "string" && txt.trim().startsWith("http")) return txt.trim();
  return null;
}

function resultLooksLikeVideo(row, url = resultHttpUrl(row)) {
  if (!url) return false;
  const outputType = String(row?.outputType || row?.type || row?.mimeType || row?.contentType || "").toLowerCase();
  if (outputType.includes("video") || ["mp4", "mov", "webm", "m4v"].includes(outputType)) return true;

  const haystack = [
    url,
    row?.fileName,
    row?.filename,
    row?.name,
    row?.path,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(haystack);
}

/**
 * RunningHub responses arrive in several shapes depending on the API version
 * and whether they come from /openapi/v2/query (flat) vs the TASK_END
 * webhook (sometimes wrapped). Walk the common candidate paths and return
 * the first results[] we find. Without this, a wrapped payload silently
 * loses the video URL and we mark the gen failed even though RH succeeded.
 */
function findResultsArray(rp) {
  if (!rp || typeof rp !== "object") return null;
  const candidates = [
    rp.results,
    rp.data?.results,
    rp.eventData?.results,
    rp.eventData?.data?.results,
    rp.body?.results,
    rp.output?.results,
    rp.outputs,
    rp.data?.outputs,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return null;
}

function motionXPreferredResultUrl(queryLike) {
  const results = findResultsArray(queryLike);
  if (!results) return null;
  const row = results[MOTION_X_FINAL_RESULT_INDEX];
  if (!row) return null;
  const url = resultHttpUrl(row);
  return resultLooksLikeVideo(row, url) ? url : null;
}

/**
 * Pick first mp4 (or any video) URL from a RunningHub query `results` array.
 */
function firstVideoResultUrl(queryLike) {
  const results = findResultsArray(queryLike);
  if (!results) return null;
  for (const r of results) {
    const url = resultHttpUrl(r);
    if (resultLooksLikeVideo(r, url)) return url;
  }
  return null;
}

/**
 * Last-resort fallback: any HTTP url anywhere in the response that looks
 * like media. Used when the row metadata (outputType, fileName) doesn't
 * tag it as a video but the URL itself does.
 */
function anyMediaUrl(queryLike) {
  const results = findResultsArray(queryLike);
  if (!results) return null;
  for (const r of results) {
    const u = resultHttpUrl(r);
    if (u) return u;
  }
  return null;
}

const RH_FETCH_TIMEOUT_MS = 60 * 60 * 1000;

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
    console.warn("[NSFW/motion] output mirror fetch failed:", e?.message || e);
    return null;
  }
  clearTimeout(t);
  if (!r.ok) {
    console.warn(`[NSFW/motion] output mirror fetch HTTP ${r.status}`);
    return null;
  }
  try {
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length < 64) return null;
    const ct = pickContentType(r.headers, "video/mp4");
    const isPng = (ct || "").toLowerCase().includes("image/png");
    if (isPng) {
      return uploadBufferToBlobOrR2(buf, "nsfw-video-motion", "png", "image/png");
    }
    return uploadBufferToBlobOrR2(buf, "nsfw-video-motion", "mp4", "video/mp4");
  } catch (e) {
    console.warn("[NSFW/motion] output mirror upload failed:", e?.message || e);
    return null;
  }
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
 * Finalize output. Accepts every shape RunningHub has been observed to
 * send — flat `query` response, wrapped `data: {results}`, webhook
 * `eventData` envelope, and legacy nested RunPod shapes. We search hard
 * because returning null here causes the webhook handler to mark the
 * generation FAILED and refund credits, so a single missed result path
 * costs the user a video they actually rendered on the GPU.
 *
 * @returns {Promise<string | null>}
 */
export async function materializeNsfwMotionOutputFromRunpodResponse(rp) {
  if (!rp || typeof rp !== "object") return null;

  const preferred = motionXPreferredResultUrl(rp);
  const vUrl = preferred || firstVideoResultUrl(rp);
  if (vUrl) {
    const mirrored = await mirrorHttpVideoToOurStorage(vUrl);
    return mirrored || vUrl;
  }

  // Some RH variants put the URL in `text` instead of `url` (legacy).
  const results = findResultsArray(rp);
  if (results && results[0]?.text && typeof results[0].text === "string") {
    const textUrl = results[0].text.trim();
    if (textUrl.startsWith("http") && resultLooksLikeVideo(results[0], textUrl)) {
      const mirrored = await mirrorHttpVideoToOurStorage(textUrl);
      return mirrored || textUrl;
    }
  }

  // Last-resort: any media URL in the response, even if metadata doesn't
  // tag it as video. Better to mirror a possibly-wrong asset than to
  // refund a user who actually got their generation done on RH's side.
  const anyUrl = anyMediaUrl(rp);
  if (anyUrl) {
    console.warn(
      "[NSFW/motion] materialize: falling back to first media URL (no tagged video). url=",
      anyUrl.slice(0, 120),
    );
    const mirrored = await mirrorHttpVideoToOurStorage(anyUrl);
    return mirrored || anyUrl;
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
  return Boolean(RUNNINGHUB_API_KEY && RUNNINGHUB_MOTION_WORKFLOW_ID);
}
