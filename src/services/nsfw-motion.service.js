/**
 * NSFW Motion Control video generation (Wan 2.2 Animate, dedicated RunPod worker).
 *
 * Worker repo: https://github.com/mconqeuroror/motion (built from runpod-mdcln-motion/)
 * Endpoint env: RUNPOD_MOTION_ENDPOINT_ID  (must be set, no fallback to image worker)
 * Auth env:    RUNPOD_API_KEY              (shared with the image worker)
 *
 * Public surface:
 *   - submitNsfwMotionVideo(opts, webhookUrl?, generationId?)
 *       Fetches the user's reference image + driving video, base64-encodes them,
 *       loads the patched workflow JSON, sets duration / FPS / seed, and POSTs to
 *       `${BASE}/run`. Returns `{ success, requestId, seed }`.
 *
 *   - extractNsfwMotionVideo(rawOut)
 *       Parses the worker's response shape and returns
 *       `{ base64, format, filename }` for the first mp4 output. The worker emits
 *       `videos[]` (preferred) but the older VHS schema uses `gifs[]` — we accept
 *       both to be safe.
 *
 *   - extractNsfwMotionSeed(rawOut)
 *       Best-effort lift of the workflow seed (workflow node "249") from the
 *       worker's echo, useful for "extend" flows in the future.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

// Default reference frame width × height fed into the workflow.
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 1280;
const DEFAULT_FPS = 30;
const DEFAULT_DURATION_SECS = 5;
const DEFAULT_NEGATIVE_PROMPT = [
  "oversaturated, overexposed, static, blurry details, subtitles, watermark,",
  "painting style, artwork, still image, gray tones, worst quality, low quality,",
  "JPEG artifacts, ugly, deformed, extra fingers, poorly drawn hands, poorly drawn face,",
  "mutated, disfigured, malformed limbs, fused fingers, frozen frame, cluttered background,",
  "three legs, crowd in background, walking backwards",
].join(" ");

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
        const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
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

async function fetchAsBase64(url, label, expectedKind /* "image" | "video" */) {
  if (!url) throw new Error(`${label}: URL is empty`);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`${label}: only http(s) URLs are supported (got "${url.slice(0, 80)}")`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`${label}: download failed (${err.message || "fetch error"})`);
  }
  clearTimeout(timer);
  if (!resp.ok) {
    throw new Error(`${label}: HTTP ${resp.status} ${resp.statusText}`);
  }
  const fallbackCt = expectedKind === "video" ? "video/mp4" : "image/jpeg";
  const contentType = pickContentType(resp.headers, fallbackCt);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ext = extensionFromContentType(contentType, expectedKind === "video" ? "mp4" : "jpg");
  return {
    base64: buf.toString("base64"),
    contentType,
    extension: ext,
    bytes: buf.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Build payload + submit
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.referenceImageUrl      — public URL of the user's NSFW reference image
 * @param {string} opts.drivingVideoUrl        — public URL of the user-uploaded driving mp4
 * @param {string} [opts.prompt]               — positive prompt, applied to CLIPTextEncode node "336"
 * @param {string} [opts.negativePrompt]       — negative prompt, applied to node "335"
 * @param {number} [opts.durationSecs]         — total duration; sets node "255"
 * @param {number} [opts.skipSecs]             — leading seconds of driving video to skip; node "254"
 * @param {number} [opts.fps]                  — output FPS; node "257"
 * @param {number} [opts.width]                — generation width; node "264"
 * @param {number} [opts.height]               — generation height; node "265"
 * @param {number} [opts.seed]                 — workflow seed; node "249"
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
    negativePrompt = DEFAULT_NEGATIVE_PROMPT,
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

  if (workflow["249"]?.inputs) workflow["249"].inputs.seed = finalSeed;
  if (workflow["254"]?.inputs) workflow["254"].inputs.value = finalSkip;
  if (workflow["255"]?.inputs) workflow["255"].inputs.value = finalDuration;
  if (workflow["257"]?.inputs) workflow["257"].inputs.value = finalFps;
  if (workflow["264"]?.inputs) workflow["264"].inputs.value = finalW;
  if (workflow["265"]?.inputs) workflow["265"].inputs.value = finalH;
  if (workflow["276"]?.inputs) workflow["276"].inputs.value = finalBlockSwap;
  if (workflow["296"]?.inputs) workflow["296"].inputs.value = !!torchCompile;

  if (typeof prompt === "string" && prompt.trim() && workflow["336"]?.inputs) {
    workflow["336"].inputs.text = prompt.trim();
  }
  if (typeof negativePrompt === "string" && negativePrompt.trim() && workflow["335"]?.inputs) {
    workflow["335"].inputs.text = negativePrompt.trim();
  }

  // The handler patches the input filenames after upload; these defaults are kept
  // only as descriptive placeholders so the workflow validates if upload is skipped.
  const refFilename = "ref.jpg";
  const driveFilename = "drive.mp4";
  if (workflow["167"]?.inputs) workflow["167"].inputs.image = refFilename;
  if (workflow["52"]?.inputs) workflow["52"].inputs.video = driveFilename;

  // ── Fetch + base64 the user assets ───────────────────────────────────────
  let imgFile;
  let vidFile;
  try {
    imgFile = await fetchAsBase64(referenceImageUrl, "Reference image", "image");
    vidFile = await fetchAsBase64(drivingVideoUrl, "Driving video", "video");
  } catch (e) {
    return { success: false, error: e.message };
  }

  // Worker upload field names match the handler.py contract
  const uploadImages = [
    {
      node_id: "167",
      filename: `ref.${imgFile.extension}`,
      data: imgFile.base64,
    },
  ];
  const uploadVideos = [
    {
      node_id: "52",
      filename: `drive.${vidFile.extension}`,
      data: vidFile.base64,
    },
  ];

  // Re-set node filenames to match what we send so the handler patch is a no-op
  // if the worker rejects upload (it'll still try to find these files locally).
  if (workflow["167"]?.inputs) workflow["167"].inputs.image = `ref.${imgFile.extension}`;
  if (workflow["52"]?.inputs) workflow["52"].inputs.video = `drive.${vidFile.extension}`;

  console.log(
    `[NSFW/motion] submit endpoint=${RUNPOD_MOTION_ENDPOINT_ID} ` +
      `dur=${finalDuration}s skip=${finalSkip}s fps=${finalFps} ${finalW}x${finalH} ` +
      `seed=${finalSeed} torchCompile=${!!torchCompile} blockSwap=${finalBlockSwap} ` +
      `refBytes=${imgFile.bytes} driveBytes=${vidFile.bytes}` +
      (webhookUrl ? ` webhook=${webhookUrl.slice(0, 80)}` : ""),
  );

  // ── POST to /run ─────────────────────────────────────────────────────────
  const body = {
    input: {
      prompt: workflow,
      upload_images: uploadImages,
      upload_videos: uploadVideos,
      output_node_id: WORKFLOW_OUTPUT_NODE,
      timeout: DEFAULT_JOB_TIMEOUT_SECS,
      meta: generationId
        ? { generationId: String(generationId), kind: "nsfw-video-motion" }
        : { kind: "nsfw-video-motion" },
    },
  };
  if (webhookUrl) body.webhook = webhookUrl;

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
    bytes: { image: imgFile.bytes, video: vidFile.bytes },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Output extraction
// ──────────────────────────────────────────────────────────────────────────

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
  let o = raw;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (typeof o !== "object" || o === null) return null;

  // Unwrap RunPod top-level { output: ... }
  if (o.output && typeof o.output === "object") {
    o = o.output;
  }

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
    const base64 =
      typeof v.base64 === "string"
        ? v.base64
        : typeof v.data === "string"
          ? v.data
          : null;
    if (!base64 || base64.length < 100) continue;
    return {
      base64,
      format: v.format || "video/h264-mp4",
      filename: v.filename || "motion.mp4",
    };
  }

  // Image-only fallback (treat first image as a single-frame "video" placeholder).
  if (Array.isArray(o.images)) {
    for (const img of o.images) {
      const base64 =
        typeof img === "string"
          ? img
          : typeof img?.base64 === "string"
            ? img.base64
            : null;
      if (base64 && base64.length > 100) {
        return { base64, format: "image/png", filename: "frame.png" };
      }
    }
  }

  return null;
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
