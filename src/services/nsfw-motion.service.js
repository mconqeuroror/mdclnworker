/**
 * NSFW Motion Control video generation (Wan 2.2 Animate, dedicated RunPod worker).
 *
 * Single backend for all product entry points:
 *   - POST /api/nsfw/generate-motion-video (NSFW Studio “NSFW Motion Control”, Create “Motion X”)
 *   - Generation type: nsfw-video-motion · worker: RUNPOD_MOTION_ENDPOINT_ID
 *
 * Flow: the client uploads reference + driving video to public URLs (e.g. blob) and passes them here.
 *
 * **Default:** the API downloads both URLs and sends `upload_images` + `upload_videos` (base64) so Comfy
 * always receives the files, even if the serverless image does not implement `reference_image_url` /
 * `driving_video_url` downloads.
 *
 * **Fallback:** if the JSON body would exceed RunPod’s ~10 MiB limit, we send only the two URLs
 * (smaller request) and the **worker** must download them (see `runpod-mdcln-motion/handler.py`).
 *
 * Endpoint: `RUNPOD_MOTION_ENDPOINT_ID` · Auth: `RUNPOD_API_KEY`
 *   - extractNsfwMotionVideo / materializeNsfwMotionOutputFromRunpodResponse / checkNsfwMotionStatus
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_MOTION_ENDPOINT_ID =
  String(process.env.RUNPOD_MOTION_ENDPOINT_ID || "").trim() || null;

const BASE_URL = RUNPOD_MOTION_ENDPOINT_ID
  ? `https://api.runpod.ai/v2/${RUNPOD_MOTION_ENDPOINT_ID}`
  : null;

const WORKFLOW_OUTPUT_NODE = "226"; // KIARA_AnimateX VHS_VideoCombine
const SUBMIT_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 20_000;
const DEFAULT_JOB_TIMEOUT_SECS = 1800;
/** RunPod serverless `/run` body limit; base64 submit must stay under this. */
const RUNPOD_MAX_JSON_BYTES = 9.5 * 1024 * 1024;
/** Do not download more than this per URL (aligns with motion worker cap). */
const MOTION_URL_FETCH_MAX_BYTES = 450 * 1024 * 1024;
const URL_FETCH_TIMEOUT_MS = 600_000;

// Default reference frame width × height fed into the workflow.
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 1280;
const DEFAULT_FPS = 30;
const DEFAULT_DURATION_SECS = 5;

if (!RUNPOD_API_KEY) {
  console.warn("⚠️ RUNPOD_API_KEY not set — NSFW motion control will not work");
}
if (!RUNPOD_MOTION_ENDPOINT_ID) {
  console.warn(
    "⚠️ RUNPOD_MOTION_ENDPOINT_ID not set — NSFW motion control will not work. " +
      "Point this at the serverless endpoint built from github.com/mconqeuroror/motion.",
  );
} else {
  console.log(`[NSFW/motion] endpoint=${RUNPOD_MOTION_ENDPOINT_ID}`);
}

// ──────────────────────────────────────────────────────────────────────────
// Workflow JSON loader (cached)
// ──────────────────────────────────────────────────────────────────────────

let cachedWorkflow = null;

function loadMotionWorkflow() {
  if (cachedWorkflow) return JSON.parse(JSON.stringify(cachedWorkflow));

  const candidates = [
    path.join(process.cwd(), "runpod-mdcln", "workflows", "nsfw_motion_api.json"),
    path.join(__dirname, "..", "..", "runpod-mdcln", "workflows", "nsfw_motion_api.json"),
    path.join(process.cwd(), "runpod-mdcln-motion", "workflow_api.json"),
    path.join(__dirname, "..", "..", "runpod-mdcln-motion", "workflow_api.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        // Some exported workflow files include UTF-8 BOM (U+FEFF), which
        // breaks JSON.parse in production if not stripped first.
        const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
        const parsed = JSON.parse(raw);
        cachedWorkflow = parsed;
        return JSON.parse(JSON.stringify(parsed));
      } catch (e) {
        console.error(`[NSFW/motion] failed to parse ${p}:`, e.message);
      }
    }
  }
  throw new Error(
    "NSFW motion workflow JSON not found (expected runpod-mdcln/workflows/nsfw_motion_api.json)",
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
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

function jsonUtf8Length(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

/** Fetch a public URL into a buffer; caps size and timeout. */
async function fetchUrlBuffer(url, label, expectedKind /* "image" | "video" */) {
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
      `${label}: file is too large to pull on the API (${(Number(cl) / (1024 * 1024)).toFixed(0)} MB; max ${MOTION_URL_FETCH_MAX_BYTES / (1024 * 1024)} MB)`,
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

function motionInputBase(workflow, generationId) {
  return {
    prompt: workflow,
    output_node_id: WORKFLOW_OUTPUT_NODE,
    timeout: DEFAULT_JOB_TIMEOUT_SECS,
    meta: generationId
      ? { generationId: String(generationId), kind: "nsfw-video-motion" }
      : { kind: "nsfw-video-motion" },
  };
}

/**
 * Comfy template placeholders — also what URL-handoff / worker must resolve after download.
 * Do not send ref.${arbitrary} to URL mode; handler patches with Comfy’s returned `saved` name.
 */
function applyDefaultMotionInputFilenames(workflow) {
  if (workflow["167"]?.inputs) workflow["167"].inputs.image = "ref.jpg";
  if (workflow["52"]?.inputs) workflow["52"].inputs.video = "drive.mp4";
}

// ──────────────────────────────────────────────────────────────────────────
// Build payload + submit
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.referenceImageUrl      — public URL of the user's NSFW reference image
 * @param {string} opts.drivingVideoUrl        — public URL of the user-uploaded driving mp4
 * @param {string} [opts.prompt]               — positive prompt, applied to CLIPTextEncode node "336"
 * @param {string} [opts.negativePrompt]       — if set, overrides node "335"; omit to keep workflow JSON default
 * @param {number} [opts.durationSecs]         — total duration; sets node "255"
 * @param {number} [opts.skipSecs]             — leading seconds of driving video to skip; node "254"
 * @param {number} [opts.fps]                  — output FPS; node "257"
 * @param {number} [opts.width]                — generation width; node "264"
 * @param {number} [opts.height]               — generation height; node "265"
 * @param {number} [opts.seed]                 — workflow seed; KSampler node "353"
 * @param {boolean} [opts.torchCompile]        — enable torch.compile path; node "296"
 * @param {number} [opts.blockSwap]            — block-swap count for low-VRAM GPUs; node "276"
 * @param {string|null} [webhookUrl]
 * @param {string|null} [generationId]
 * @returns {Promise<{success: boolean, requestId?: string, seed?: number, bytes?: {image: number, video: number}, error?: string}>}
 */
export async function submitNsfwMotionVideo(opts, webhookUrl = null, generationId = null) {
  if (!RUNPOD_API_KEY) {
    return { success: false, error: "RUNPOD_API_KEY not configured" };
  }
  if (!BASE_URL) {
    return { success: false, error: "RUNPOD_MOTION_ENDPOINT_ID not configured" };
  }

  const {
    referenceImageUrl,
    drivingVideoUrl,
    prompt,
    negativePrompt,
    durationSecs,
    skipSecs = 0,
    fps = DEFAULT_FPS,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    seed,
    torchCompile = false,
    blockSwap = 0,
  } = opts || {};

  if (!referenceImageUrl) return { success: false, error: "referenceImageUrl is required" };
  if (!drivingVideoUrl) return { success: false, error: "drivingVideoUrl is required" };

  let workflow;
  try {
    workflow = loadMotionWorkflow();
  } catch (e) {
    return { success: false, error: e.message };
  }

  // ── Patch workflow params ────────────────────────────────────────────────
  const finalDuration = clampInt(durationSecs, 1, 30, DEFAULT_DURATION_SECS);
  const finalSkip = clampInt(skipSecs, 0, 600, 0);
  const finalFps = clampInt(fps, 8, 60, DEFAULT_FPS);
  const finalW = clampInt(width, 256, 1536, DEFAULT_WIDTH);
  const finalH = clampInt(height, 256, 1536, DEFAULT_HEIGHT);
  const finalBlockSwap = clampInt(blockSwap, 0, 40, 0);
  const finalSeed = Number.isFinite(Number(seed))
    ? Math.trunc(Math.abs(Number(seed))) % 2 ** 53
    : Math.floor(Math.random() * 2 ** 53);

  if (workflow["353"]?.inputs) workflow["353"].inputs.seed = finalSeed;
  if (workflow["257"]?.inputs) workflow["257"].inputs.value = finalFps;
  if (workflow["264"]?.inputs) workflow["264"].inputs.value = finalW;
  if (workflow["265"]?.inputs) workflow["265"].inputs.value = finalH;
  if (workflow["276"]?.inputs) workflow["276"].inputs.value = finalBlockSwap;
  if (workflow["296"]?.inputs) workflow["296"].inputs.value = !!torchCompile;
  // PathchSageAttentionKJ (node 322): "auto" imports optional `sageattention` which is
  // not installed in the motion worker image — force Comfy to use stock attention.
  if (workflow["322"]?.inputs) workflow["322"].inputs.sage_attention = "disabled";

  // Match Comfy “as saved” unless the caller overrides (empty 336 / baked-in 335 in nsfw_motion_api.json).
  if (typeof prompt === "string" && prompt.trim() && workflow["336"]?.inputs) {
    workflow["336"].inputs.text = prompt.trim();
  }
  if (typeof negativePrompt === "string" && negativePrompt.trim() && workflow["335"]?.inputs) {
    workflow["335"].inputs.text = negativePrompt.trim();
  }

  if (workflow["254"]?.inputs) workflow["254"].inputs.value = finalSkip;
  if (workflow["255"]?.inputs) workflow["255"].inputs.value = finalDuration;
  applyDefaultMotionInputFilenames(workflow);

  const refStr = String(referenceImageUrl).trim();
  const drvStr = String(drivingVideoUrl).trim();
  if (!isPublicHttpUrl(refStr) || !isPublicHttpUrl(drvStr)) {
    return {
      success: false,
      error:
        "Reference image and driving video must be public http(s) URLs (upload to blob/storage first, then pass those links).",
    };
  }

  let img;
  let vid;
  try {
    img = await fetchUrlBuffer(refStr, "Reference image", "image");
    vid = await fetchUrlBuffer(drvStr, "Driving video", "video");
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }

  /** ~4/3 of raw bytes in base64 + JSON overhead; skip huge base64 alloc when URL handoff is inevitable. */
  const estUploadJson =
    80_000 + Math.ceil((img.bytes + vid.bytes) * 4 / 3) + 2_000_000;
  const willFitUpload = estUploadJson <= RUNPOD_MAX_JSON_BYTES;

  let body;
  let submitMode;
  if (!willFitUpload) {
    // URL handoff: workflow must keep template names ref.jpg / drive.mp4 — handler downloads and patches to Comfy’s saved name.
    applyDefaultMotionInputFilenames(workflow);
    body = {
      input: {
        ...motionInputBase(workflow, generationId),
        reference_image_url: refStr,
        driving_video_url: drvStr,
      },
    };
    if (webhookUrl) body.webhook = webhookUrl;
    submitMode = "url_fallback";
    console.warn(
      `[NSFW/motion] Source media is large (~${(img.bytes + vid.bytes) / (1024 * 1024) | 0} MiB raw); ` +
        "using URL-only /run body (under RunPod 10 MiB). Worker must support reference_image_url + driving_video_url.",
    );
  } else {
    if (workflow["167"]?.inputs) workflow["167"].inputs.image = `ref.${img.extension}`;
    if (workflow["52"]?.inputs) workflow["52"].inputs.video = `drive.${vid.extension}`;

    const uploadBody = {
      input: {
        ...motionInputBase(workflow, generationId),
        upload_images: [
          { node_id: "167", filename: `ref.${img.extension}`, data: img.buffer.toString("base64") },
        ],
        upload_videos: [
          { node_id: "52", filename: `drive.${vid.extension}`, data: vid.buffer.toString("base64") },
        ],
      },
    };
    if (webhookUrl) uploadBody.webhook = webhookUrl;
    const uploadJsonBytes = jsonUtf8Length(uploadBody);
    if (uploadJsonBytes <= RUNPOD_MAX_JSON_BYTES) {
      body = uploadBody;
      submitMode = "upload";
    } else {
      applyDefaultMotionInputFilenames(workflow);
      body = {
        input: {
          ...motionInputBase(workflow, generationId),
          reference_image_url: refStr,
          driving_video_url: drvStr,
        },
      };
      if (webhookUrl) body.webhook = webhookUrl;
      submitMode = "url_fallback";
      console.warn(
        `[NSFW/motion] Measured JSON ~${(uploadJsonBytes / (1024 * 1024)).toFixed(1)} MiB exceeds limit; ` +
          "using URL-only handoff.",
      );
    }
  }

  {
    const inp = body?.input;
    const keys = inp && typeof inp === "object" ? Object.keys(inp).sort() : [];
    const nImg = Array.isArray(inp?.upload_images) ? inp.upload_images.length : 0;
    const nVid = Array.isArray(inp?.upload_videos) ? inp.upload_videos.length : 0;
    const hasRefU = Boolean(inp?.reference_image_url);
    const hasDrvU = Boolean(inp?.driving_video_url);
    console.log(
      `[NSFW/motion] run payload: mode=${submitMode} input.keys=[${keys.join(",")}] ` +
        `refUrl=${hasRefU} drvUrl=${hasDrvU} upload_images=${nImg} upload_videos=${nVid} ` +
        `genId=${generationId || "—"}`,
    );
  }

  const lastBodySize = Buffer.byteLength(JSON.stringify(body), "utf8");

  if (!webhookUrl) {
    console.warn(
      "[NSFW/motion] No RunPod webhook URL (set CALLBACK_BASE_URL or RUNPOD_WEBHOOK_URL). " +
        "Completions depend on GET /generations/:id or the RunPod reconcile cron polling /status.",
    );
  }
  console.log(
    `[NSFW/motion] submit mode=${submitMode} endpoint=${RUNPOD_MOTION_ENDPOINT_ID} ` +
      `dur=${finalDuration}s skip=${finalSkip}s fps=${finalFps} ${finalW}x${finalH} ` +
      `seed=${finalSeed} torchCompile=${!!torchCompile} blockSwap=${finalBlockSwap} ` +
      `jsonBytes≈${lastBodySize}` +
      (webhookUrl ? ` webhook=${webhookUrl.slice(0, 80)}` : ""),
  );

  // ── POST to /run ─────────────────────────────────────────────────────────

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${BASE_URL}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: `RunPod submit fetch failed: ${err.message}` };
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return {
      success: false,
      error: `RunPod submit HTTP ${resp.status}: ${text.slice(0, 400)}`,
    };
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return { success: false, error: `RunPod submit returned non-JSON: ${e.message}` };
  }
  const requestId =
    data.id || data.request_id || data.requestId || data.task_id || data.taskId;
  if (!requestId) {
    return {
      success: false,
      error: `RunPod submit returned no job id: ${JSON.stringify(data).slice(0, 400)}`,
    };
  }

  console.log(`[NSFW/motion] job submitted: ${requestId}`);
  return {
    success: true,
    requestId,
    seed: finalSeed,
    bytes: {
      image: img?.bytes ?? 0,
      video: vid?.bytes ?? 0,
      mode: submitMode === "upload" ? "upload" : "url_fallback",
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Output extraction
// ──────────────────────────────────────────────────────────────────────────

/**
 * RunPod webhooks and `/status` often nest the handler payload several levels deep, e.g.
 * `{ output: { output: { videos: [...] } } }` or stringified `output`, which breaks a
 * single `output` unwrap. RunPod may also wrap the handler dict as a one-element **array**
 * under `output`. This walks `output` / `result` / `data` and JSON-strings until we find
 * an object that has `videos` / `gifs` / `images` or Comfy `outputs`.
 */
export function normalizeNsfwMotionRunpodOutput(input) {
  let o = input;
  for (let depth = 0; depth < 12; depth++) {
    if (o == null) return null;
    if (typeof o === "string") {
      const t = o.trim();
      if (!t) return null;
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          o = JSON.parse(t);
          continue;
        } catch {
          return null;
        }
      }
      return null;
    }
    if (Array.isArray(o)) {
      if (o.length === 1 && o[0] != null && typeof o[0] === "object") {
        o = o[0];
        continue;
      }
      return o;
    }
    if (typeof o !== "object") return o;

    const hasVideos = Array.isArray(o.videos) && o.videos.length > 0;
    const hasGifs = Array.isArray(o.gifs) && o.gifs.length > 0;
    const hasComfyOut = o.outputs && typeof o.outputs === "object" && Object.keys(o.outputs).length > 0;
    const hasImages = Array.isArray(o.images) && o.images.length > 0;
    if (hasVideos || hasGifs || hasComfyOut || hasImages) return o;

    if (o.output != null) {
      o = o.output;
      continue;
    }
    if (o.result != null) {
      o = o.result;
      continue;
    }
    if (o.data != null && typeof o.data === "object") {
      o = o.data;
      continue;
    }
    return o;
  }
  return o;
}

function stripDataUrlBase64(s) {
  if (typeof s !== "string" || s.length < 8) return s;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  const i = s.indexOf("base64,");
  if (i >= 0) return s.slice(i + 7);
  return s;
}

/**
 * Pulls the first mp4 video out of a worker response. Accepts the shape produced
 * by `runpod-mdcln-motion/handler.py`:
 *   { videos: [{ filename, format, base64, node_id }], ... }
 * Falls back to an `images[]` shape if the worker happens to return only frames.
 *
 * @param {*} raw — anything: string, parsed JSON, or already the inner output.
 * @returns {{base64: string, format: string, filename: string} | null}
 */
export function extractNsfwMotionVideo(raw) {
  if (raw == null) return null;
  const normalized = normalizeNsfwMotionRunpodOutput(raw);
  let o = normalized != null ? normalized : raw;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (typeof o !== "object" || o === null) return null;
  o = normalizeNsfwMotionRunpodOutput(o) || o;

  const candidates = [];
  if (Array.isArray(o.videos)) candidates.push(...o.videos);
  if (Array.isArray(o.gifs)) candidates.push(...o.gifs);

  // Worker also surfaces ComfyUI raw outputs[] — scan them as a final resort.
  const outputs = o?.outputs;
  if (outputs && typeof outputs === "object") {
    const preferred = ["226", "300", "301", "303"];
    const order = [...preferred, ...Object.keys(outputs).filter((k) => !preferred.includes(k))];
    for (const nodeId of order) {
      const node = outputs[nodeId];
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node.videos)) candidates.push(...node.videos);
      if (Array.isArray(node.gifs)) candidates.push(...node.gifs);
    }
  }

  for (const v of candidates) {
    if (!v) continue;
    const rawB64 =
      typeof v.base64 === "string"
        ? v.base64
        : typeof v.data === "string"
          ? v.data
          : null;
    const base64 = rawB64 ? stripDataUrlBase64(rawB64) : null;
    if (!base64 || base64.length < 80) continue;
    return {
      base64,
      format: v.format || "video/h264-mp4",
      filename: v.filename || "motion.mp4",
    };
  }

  // Image-only fallback (treat first image as a single-frame "video" placeholder).
  if (Array.isArray(o.images)) {
    for (const img of o.images) {
      const rawB64 =
        typeof img === "string"
          ? img
          : typeof img?.base64 === "string"
            ? img.base64
            : null;
      const base64 = rawB64 ? stripDataUrlBase64(rawB64) : null;
      if (base64 && base64.length > 80) {
        return { base64, format: "image/png", filename: "frame.png" };
      }
    }
  }

  return null;
}

/**
 * Upload the first video from a RunPod `/status` (or webhook) payload. Shared by
 * `runpod-callback`, the RunPod watchdog, and `GET /generations/:id` recovery.
 * @returns {Promise<string | null>} Public URL, or `null` if not complete / no video.
 */
export async function materializeNsfwMotionOutputFromRunpodResponse(rp) {
  try {
    /** Try full envelope, then common subtrees (webhook + `/status` differ). */
    const tryRoots = [
      rp,
      rp?.output,
      Array.isArray(rp?.output) && rp.output[0] != null ? rp.output[0] : null,
      rp?.result,
      rp?.data,
      rp?.data?.output,
      Array.isArray(rp?.data?.output) && rp.data.output[0] != null ? rp.data.output[0] : null,
    ].filter((x) => x != null);
    let video = null;
    for (const root of tryRoots) {
      video = extractNsfwMotionVideo(root);
      if (video?.base64) break;
    }
    if (!video || !video.base64) return null;
    if (typeof video.base64 === "string" && video.base64.startsWith("http")) {
      return video.base64;
    }
    const b64clean = String(video.base64).replace(/\s+/g, "");
    const buf = Buffer.from(b64clean, "base64");
    if (!buf.length) {
      console.warn("[NSFW/motion] materialize: decoded empty buffer (invalid base64?)");
      return null;
    }
    const isPng = (video.format || "").toLowerCase().startsWith("image/");
    if (isPng) {
      return await uploadBufferToBlobOrR2(buf, "nsfw-video-motion", "png", "image/png");
    }
    return await uploadBufferToBlobOrR2(buf, "nsfw-video-motion", "mp4", "video/mp4");
  } catch (e) {
    console.warn("[NSFW/motion] materializeNsfwMotionOutputFromRunpodResponse:", e?.message || e);
    return null;
  }
}

/**
 * Best-effort seed echo for downstream "extend" UX. Worker doesn't echo seed
 * directly, so we look at the workflow snapshot the handler returns (if any).
 */
export function extractNsfwMotionSeed(raw) {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    const inner = o?.output ?? o;
    const seedNode =
      inner?.workflow?.["353"]?.inputs?.seed ??
      inner?.prompt?.["353"]?.inputs?.seed ??
      inner?.workflow?.["249"]?.inputs?.seed ??
      inner?.prompt?.["249"]?.inputs?.seed ??
      null;
    if (Number.isFinite(Number(seedNode))) return Math.trunc(Number(seedNode));
  } catch {}
  return null;
}

/**
 * Async polling fallback (used by the recovery cron when webhook is missed).
 */
export async function checkNsfwMotionStatus(jobId) {
  if (!BASE_URL || !RUNPOD_API_KEY) {
    return { status: "FAILED", error: "Motion endpoint not configured" };
  }
  const url = `${BASE_URL}/status/${jobId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      if (resp.status === 404) return { status: "IN_QUEUE" };
      const text = await resp.text().catch(() => "");
      return { status: "FAILED", error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
    }
    return await resp.json();
  } catch (err) {
    clearTimeout(timer);
    return { status: "IN_PROGRESS", error: err.message };
  }
}

export function isNsfwMotionConfigured() {
  return Boolean(RUNPOD_API_KEY && RUNPOD_MOTION_ENDPOINT_ID);
}
