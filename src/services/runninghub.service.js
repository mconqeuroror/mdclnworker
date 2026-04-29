/**
 * RunningHub AI service — Seedance 2.0 Global (ByteDance) + Sora (rhart-video-s-official).
 *
 * API docs:
 *   POST https://www.runninghub.ai/openapi/v2/bytedance/seedance-2.0-global/image-to-video
 *   POST https://www.runninghub.ai/openapi/v2/bytedance/seedance-2.0-global/multimodal-video
 *   POST https://www.runninghub.ai/openapi/v2/rhart-video-s-official/image-to-video-pro
 *   POST https://www.runninghub.ai/openapi/v2/rhart-video-s-official/text-to-video-pro
 *   POST https://www.runninghub.ai/openapi/v2/query                 (task status)
 *   POST https://www.runninghub.cn/openapi/v2/media/upload/binary   (file upload)
 *
 * Auth: Authorization: Bearer ${RUNNINGHUB_API_KEY}
 * Task states: QUEUED | RUNNING | SUCCESS | FAILED
 * Output URLs are valid for 24h only — callers MUST mirror to persistent storage on success.
 *
 * When `getRunningHubWebhookUrl()` returns a URL, task submissions include `webhookUrl` and
 * RunningHub POSTs `TASK_END` to `/api/runninghub/callback`. The poller remains a fallback for
 * missed webhooks. Persist `runninghub-task:<taskId>` in generation.replicateModel (Creator Studio)
 * or `providerTaskId` / raw task id for NSFW motion.
 */

const RUNNINGHUB_API_KEY = process.env.RUNNINGHUB_API_KEY;
const RUNNINGHUB_BASE_URL = "https://www.runninghub.ai";
const RUNNINGHUB_UPLOAD_BASE_URL = "https://www.runninghub.cn";
const RUNNINGHUB_REQUEST_TIMEOUT_MS = 30_000;

if (!RUNNINGHUB_API_KEY) {
  console.warn("⚠️ RUNNINGHUB_API_KEY not set — Seedance/Sora video features will be unavailable");
}

function assertApiKey() {
  if (!RUNNINGHUB_API_KEY) {
    throw new Error("RUNNINGHUB_API_KEY is not configured.");
  }
}

function rhHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${RUNNINGHUB_API_KEY}`,
  };
}

/**
 * Public HTTPS URL for RunningHub `webhookUrl` (TASK_END callbacks).
 * Uses the same public base you already set for the app / KIE — no extra env required:
 * tries CALLBACK_BASE_URL, NEXT_PUBLIC_APP_URL, FRONTEND_URL, CLIENT_URL, APP_PUBLIC_URL, PUBLIC_URL, APP_URL,
 * then origin of VITE_API_URL, then VERCEL_URL. Path is always `/api/runninghub/callback`.
 * Optional hard override: RUNNINGHUB_WEBHOOK_URL (full URL). Optional RUNNINGHUB_WEBHOOK_SECRET → `?secret=` on built URL.
 */
export function getRunningHubWebhookUrl() {
  const explicit = String(process.env.RUNNINGHUB_WEBHOOK_URL || "").trim();
  if (explicit.startsWith("http")) return explicit;

  const candidates = [
    process.env.CALLBACK_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.APP_PUBLIC_URL,
    process.env.PUBLIC_URL,
    process.env.APP_URL,
  ];

  let basePath = null;
  for (const raw of candidates) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const base = s.replace(/\/$/, "");
    const withProtocol = base.startsWith("http") ? base : `https://${base}`;
    basePath = `${withProtocol.replace(/\/$/, "")}/api/runninghub/callback`;
    break;
  }

  if (!basePath) {
    const viteApi = String(process.env.VITE_API_URL || "").trim();
    if (viteApi.startsWith("http")) {
      try {
        const u = new URL(viteApi);
        basePath = `${u.protocol}//${u.host}/api/runninghub/callback`;
      } catch {
        /* ignore */
      }
    }
  }

  if (!basePath) {
    const vercel = process.env.VERCEL_URL;
    if (vercel) {
      basePath = `https://${vercel.replace(/^https?:\/\//, "").split("/")[0]}/api/runninghub/callback`;
    }
  }

  if (!basePath) return null;
  if (basePath.startsWith("http://localhost")) {
    console.warn(
      "[RunningHub] webhook URL resolves to localhost — omitting webhookUrl (set CALLBACK_BASE_URL or FRONTEND_URL to a public HTTPS origin)",
    );
    return null;
  }
  const secret = String(process.env.RUNNINGHUB_WEBHOOK_SECRET || "").trim();
  if (secret) {
    const sep = basePath.includes("?") ? "&" : "?";
    return `${basePath}${sep}secret=${encodeURIComponent(secret)}`;
  }
  return basePath;
}

/** POST a JSON body to the given RunningHub endpoint and return the parsed task submission response. */
async function rhPost(endpointPath, body, label) {
  assertApiKey();
  const url = `${RUNNINGHUB_BASE_URL}${endpointPath}`;
  const wh = getRunningHubWebhookUrl();
  const payload = wh && typeof body === "object" && body !== null ? { ...body, webhookUrl: wh } : body;
  const res = await fetch(url, {
    method: "POST",
    headers: rhHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(RUNNINGHUB_REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[RunningHub/${label}] HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`[RunningHub/${label}] Invalid JSON response: ${text.slice(0, 200)}`);
  }
  const taskId = json?.taskId || json?.data?.taskId || json?.data?.task_id;
  const status = String(json?.status || json?.data?.status || "").toUpperCase();
  const errorCode = json?.errorCode || json?.data?.errorCode;
  const errorMessage = json?.errorMessage || json?.data?.errorMessage;
  if (errorCode || status === "FAILED") {
    throw new Error(
      `[RunningHub/${label}] API error (${errorCode || "FAILED"}): ${errorMessage || "unknown error"}`,
    );
  }
  if (!taskId || typeof taskId !== "string") {
    throw new Error(
      `[RunningHub/${label}] No taskId in response: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return { taskId, status: status || "QUEUED", raw: json };
}

/**
 * Query current task status and (once SUCCESS) its outputs.
 * Returns the raw response JSON as documented, with a normalized `status` (uppercase).
 */
export async function queryRunningHubTask(taskId) {
  assertApiKey();
  if (!taskId) throw new Error("[RunningHub/query] taskId is required");
  const res = await fetch(`${RUNNINGHUB_BASE_URL}/openapi/v2/query`, {
    method: "POST",
    headers: rhHeaders(),
    body: JSON.stringify({ taskId: String(taskId) }),
    signal: AbortSignal.timeout(RUNNINGHUB_REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[RunningHub/query] HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`[RunningHub/query] Invalid JSON: ${text.slice(0, 200)}`);
  }
  return {
    taskId: json?.taskId || String(taskId),
    status: String(json?.status || "").toUpperCase(),
    errorCode: json?.errorCode || null,
    errorMessage: json?.errorMessage || null,
    failedReason: json?.failedReason || null,
    usage: json?.usage || null,
    results: Array.isArray(json?.results) ? json.results : [],
    raw: json,
  };
}

/** Pick the first video/image URL from a RunningHub results array. */
export function extractRunningHubOutputUrl(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const videoExt = new Set(["mp4", "mov", "webm", "m4v"]);
  const imageExt = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
  const videoHit = results.find(
    (r) => r?.url && videoExt.has(String(r.outputType || "").toLowerCase()),
  );
  if (videoHit?.url) return videoHit.url;
  const imageHit = results.find(
    (r) => r?.url && imageExt.has(String(r.outputType || "").toLowerCase()),
  );
  if (imageHit?.url) return imageHit.url;
  const anyHit = results.find((r) => typeof r?.url === "string" && r.url.startsWith("http"));
  return anyHit?.url || null;
}

/** Optional: upload a local buffer to RunningHub; returns the download_url usable as firstFrameUrl etc. */
export async function uploadFileToRunningHub(buffer, fileName, contentType = "application/octet-stream") {
  assertApiKey();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("[RunningHub/upload] buffer is required");
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: contentType }),
    fileName || "upload.bin",
  );
  const res = await fetch(`${RUNNINGHUB_UPLOAD_BASE_URL}/openapi/v2/media/upload/binary`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RUNNINGHUB_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[RunningHub/upload] HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`[RunningHub/upload] Invalid JSON: ${text.slice(0, 200)}`);
  }
  if (json?.code !== 0) {
    throw new Error(`[RunningHub/upload] API error (${json?.code}): ${json?.message || "unknown"}`);
  }
  const url = json?.data?.download_url || null;
  if (!url) throw new Error(`[RunningHub/upload] No download_url in response`);
  return url;
}

// ── Enum helpers ─────────────────────────────────────────────────────────────

const SEEDANCE_RESOLUTIONS = new Set(["480p", "720p", "native1080p", "1080p", "2k", "4k"]);
const SEEDANCE_DURATIONS = new Set(["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]);
const SEEDANCE_RATIOS = new Set(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);

const SORA_I2V_RESOLUTIONS = new Set(["720p", "1080p"]);
const SORA_T2V_SIZES = new Set([
  "720x1280", "1280x720",
  "1024x1792", "1792x1024",
  "1080x1920", "1920x1080",
]);
const SORA_DURATIONS = new Set(["4", "8", "12", "16", "20"]);

function normalizeSeedanceResolution(value) {
  const normalized = String(value || "720p").toLowerCase();
  return SEEDANCE_RESOLUTIONS.has(normalized) ? normalized : "720p";
}

function normalizeSeedanceDuration(value) {
  const normalized = String(value ?? "5").trim();
  return SEEDANCE_DURATIONS.has(normalized) ? normalized : "5";
}

function normalizeSeedanceRatio(value) {
  if (!value) return "adaptive";
  const normalized = String(value).toLowerCase();
  return SEEDANCE_RATIOS.has(normalized) ? normalized : "adaptive";
}

function normalizeSoraI2VResolution(value) {
  const normalized = String(value || "720p").toLowerCase();
  return SORA_I2V_RESOLUTIONS.has(normalized) ? normalized : "720p";
}

function normalizeSoraT2VSize(value) {
  const normalized = String(value || "1280x720");
  return SORA_T2V_SIZES.has(normalized) ? normalized : "1280x720";
}

function normalizeSoraDuration(value) {
  const normalized = String(value ?? "8").trim();
  return SORA_DURATIONS.has(normalized) ? normalized : "8";
}

// ── Seedance 2.0 Global — image-to-video (first/last frame) ──────────────────

/**
 * Submit a Seedance 2.0 Global image-to-video task. Mode: supply firstFrameUrl (+ optional lastFrameUrl).
 *
 * @param {object} options
 * @param {string}   options.firstFrameUrl   - Public URL of the first frame image (required)
 * @param {string}   [options.lastFrameUrl]  - Public URL of the last frame image (optional)
 * @param {string}   [options.prompt]        - Text prompt (0–20480 chars; optional per API)
 * @param {string}   [options.resolution]    - 480p | 720p | native1080p | 1080p | 2k | 4k (default 720p)
 * @param {string|number} [options.duration] - 4..15 seconds (default 5)
 * @param {string}   [options.ratio]         - adaptive | 16:9 | 4:3 | 1:1 | 3:4 | 9:16 | 21:9 (default adaptive)
 * @param {boolean}  [options.generateAudio] - Generate audio (default false)
 * @param {boolean}  [options.realPersonMode] - Real-person conversion (default false)
 * @param {string[]} [options.conversionSlots] - Which frames to convert: all | firstFrameUrl | lastFrameUrl
 * @param {boolean}  [options.returnLastFrame] - Return the last frame image of the generated video
 * @returns {Promise<{ success: true, deferred: true, taskId: string }>}
 */
export async function generateSeedanceI2VRunningHub(options = {}) {
  const firstFrameUrl = String(options.firstFrameUrl || "").trim();
  if (!firstFrameUrl) {
    throw new Error("[RunningHub/seedance-i2v] firstFrameUrl is required.");
  }
  const body = {
    prompt: String(options.prompt || "").trim(),
    resolution: normalizeSeedanceResolution(options.resolution),
    duration: normalizeSeedanceDuration(options.duration),
    firstFrameUrl,
    lastFrameUrl: options.lastFrameUrl ? String(options.lastFrameUrl).trim() : null,
    generateAudio: options.generateAudio === true,
    ratio: normalizeSeedanceRatio(options.ratio),
    realPersonMode: options.realPersonMode === true,
    conversionSlots: Array.isArray(options.conversionSlots) ? options.conversionSlots : [],
    returnLastFrame: options.returnLastFrame === true,
  };
  const { taskId } = await rhPost(
    "/openapi/v2/bytedance/seedance-2.0-global/image-to-video",
    body,
    "seedance-i2v",
  );
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

// ── Seedance 2.0 Global — multimodal (up to 9 images / 3 videos / 3 audios) ─

/**
 * Submit a Seedance 2.0 Global multimodal task (image/video/audio references).
 *
 * @param {object} options
 * @param {string}   options.prompt                - Required, 1–20480 chars
 * @param {string[]} [options.imageUrls]           - Up to 9 reference images
 * @param {string[]} [options.videoUrls]           - Up to 3 reference videos
 * @param {string[]} [options.audioUrls]           - Up to 3 reference audios
 * @param {string}   [options.resolution]          - 480p | 720p | native1080p | 1080p | 2k | 4k
 * @param {string|number} [options.duration]       - 4..15 seconds
 * @param {string}   [options.ratio]               - adaptive | 16:9 | ...
 * @param {boolean}  [options.generateAudio]
 * @param {boolean}  [options.realPersonMode]
 * @param {string[]} [options.conversionSlots]     - all | image1..image9 | video1..video3
 * @param {boolean}  [options.returnLastFrame]
 */
export async function generateSeedanceMultimodalRunningHub(options = {}) {
  const prompt = String(options.prompt || "").trim();
  if (!prompt) {
    throw new Error("[RunningHub/seedance-multimodal] prompt is required.");
  }
  const body = {
    prompt,
    resolution: normalizeSeedanceResolution(options.resolution),
    duration: normalizeSeedanceDuration(options.duration),
    imageUrls: Array.isArray(options.imageUrls) ? options.imageUrls.filter(Boolean).slice(0, 9) : [],
    videoUrls: Array.isArray(options.videoUrls) ? options.videoUrls.filter(Boolean).slice(0, 3) : [],
    audioUrls: Array.isArray(options.audioUrls) ? options.audioUrls.filter(Boolean).slice(0, 3) : [],
    generateAudio: options.generateAudio === true,
    ratio: normalizeSeedanceRatio(options.ratio),
    realPersonMode: options.realPersonMode === true,
    conversionSlots: Array.isArray(options.conversionSlots) ? options.conversionSlots : [],
    returnLastFrame: options.returnLastFrame === true,
  };
  const { taskId } = await rhPost(
    "/openapi/v2/bytedance/seedance-2.0-global/multimodal-video",
    body,
    "seedance-multimodal",
  );
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

// ── Sora — image-to-video-pro (rhart-video-s-official) ──────────────────────

/**
 * Submit a Sora image-to-video task (rhart-video-s-official/image-to-video-pro).
 *
 * @param {object} options
 * @param {string} options.prompt       - Required
 * @param {string} options.imageUrl     - Required; dimensions must be 720x1280 | 1280x720 | 1024x1792 | 1792x1024
 * @param {string} [options.resolution] - 720p | 1080p (default 720p)
 * @param {string|number} [options.duration] - 4 | 8 | 12 | 16 | 20 (default 8)
 */
export async function generateSoraI2VRunningHub(options = {}) {
  const prompt = String(options.prompt || "").trim();
  const imageUrl = String(options.imageUrl || "").trim();
  if (!prompt) throw new Error("[RunningHub/sora-i2v] prompt is required.");
  if (!imageUrl) throw new Error("[RunningHub/sora-i2v] imageUrl is required.");
  const body = {
    prompt,
    resolution: normalizeSoraI2VResolution(options.resolution),
    duration: normalizeSoraDuration(options.duration),
    imageUrl,
  };
  const { taskId } = await rhPost(
    "/openapi/v2/rhart-video-s-official/image-to-video-pro",
    body,
    "sora-i2v",
  );
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

// ── Sora — text-to-video-pro (rhart-video-s-official) ───────────────────────

/**
 * Submit a Sora text-to-video task (rhart-video-s-official/text-to-video-pro).
 *
 * @param {object} options
 * @param {string} options.prompt        - Required
 * @param {string} [options.size]        - 720x1280 | 1280x720 | 1024x1792 | 1792x1024 | 1080x1920 | 1920x1080
 * @param {string|number} [options.duration] - 4 | 8 | 12 | 16 | 20 (default 8)
 */
export async function generateSoraT2VRunningHub(options = {}) {
  const prompt = String(options.prompt || "").trim();
  if (!prompt) throw new Error("[RunningHub/sora-t2v] prompt is required.");
  const body = {
    prompt,
    size: normalizeSoraT2VSize(options.size),
    duration: normalizeSoraDuration(options.duration),
  };
  const { taskId } = await rhPost(
    "/openapi/v2/rhart-video-s-official/text-to-video-pro",
    body,
    "sora-t2v",
  );
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

export const RUNNINGHUB_TASK_PREFIX = "runninghub-task:";

export const RUNNINGHUB_ENUMS = Object.freeze({
  SEEDANCE_RESOLUTIONS: Array.from(SEEDANCE_RESOLUTIONS),
  SEEDANCE_DURATIONS: Array.from(SEEDANCE_DURATIONS),
  SEEDANCE_RATIOS: Array.from(SEEDANCE_RATIOS),
  SORA_I2V_RESOLUTIONS: Array.from(SORA_I2V_RESOLUTIONS),
  SORA_T2V_SIZES: Array.from(SORA_T2V_SIZES),
  SORA_DURATIONS: Array.from(SORA_DURATIONS),
});

// ── SynthID / Watermark Remover ───────────────────────────────────────────────

const SYNTHID_REMOVER_APP_ID = "2049470466959613953";
const SYNTHID_IMAGE_NODE_ID = "11";

/**
 * Submit a SynthID / digital watermark removal job via RunningHub AI App.
 *
 * @param {string} imageUrl - Publicly accessible image URL or base64 data URI
 * @returns {Promise<{ taskId: string, status: string }>}
 */
export async function submitSynthIdRemoveJob(imageUrl) {
  assertApiKey();
  if (!imageUrl) throw new Error("[SynthIDRemove] imageUrl is required");

  const webhookUrl = getRunningHubWebhookUrl();
  const payload = {
    nodeInfoList: [
      {
        nodeId: SYNTHID_IMAGE_NODE_ID,
        fieldName: "image",
        fieldValue: imageUrl,
      },
    ],
    instanceType: "plus", // 48GB VRAM — SeedVR2 OOMs on default 24GB for large images
    ...(webhookUrl ? { webhookUrl } : {}),
  };

  const res = await fetch(
    `${RUNNINGHUB_BASE_URL}/openapi/v2/run/ai-app/${SYNTHID_REMOVER_APP_ID}`,
    {
      method: "POST",
      headers: rhHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RUNNINGHUB_REQUEST_TIMEOUT_MS),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[SynthIDRemove] HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`[SynthIDRemove] Invalid JSON: ${text.slice(0, 200)}`);
  }
  const taskId = json?.taskId || json?.data?.taskId;
  const errorCode = json?.errorCode || json?.data?.errorCode;
  const errorMessage = json?.errorMessage || json?.data?.errorMessage;
  if (errorCode || String(json?.status || "").toUpperCase() === "FAILED") {
    throw new Error(`[SynthIDRemove] API error (${errorCode}): ${errorMessage || "unknown"}`);
  }
  if (!taskId) {
    throw new Error(`[SynthIDRemove] No taskId in response: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { taskId: String(taskId), status: String(json?.status || "QUEUED").toUpperCase() };
}
