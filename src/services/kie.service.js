/**
 * KIE.AI service — rebuilt from official API spec.
 *
 * API docs:
 *   POST https://api.kie.ai/api/v1/jobs/createTask
 *   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=xxx
 *
 * Task states: waiting | queuing | generating | success | fail
 * On success, result is in data.resultJson (JSON string with resultUrls array)
 * On fail, error is in data.failMsg and data.failCode
 */

import { isR2Configured } from "../utils/r2.js";
import { uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import { IDENTITY_RECREATE_MODEL_CLOTHES } from "../constants/identityRecreationPrompts.js";
import {
  validateNanoBananaInputImages,
  validateSeedreamEditImages,
  validateKlingImageToVideoInput,
  validateKlingMotionInputs,
} from "../utils/fileValidation.js";
import { kieConstraints } from "../config/providerMediaConstraints.js";
import { verifyUrlReachable } from "../utils/kieUpload.js";
import {
  KIE_VIDEO_MODEL_CATALOG,
  normalizeWanResolution,
} from "../config/kie-video-catalog.js";

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_URL = "https://api.kie.ai/api/v1";

// ─── Queue config: 100 concurrent jobs app-wide, 20 new submissions per 10s ──
const KIE_MAX_CONCURRENT = Math.max(1, parseInt(process.env.KIE_MAX_CONCURRENT || "100", 10));
const KIE_MAX_SUBMISSIONS_PER_10S = Math.max(1, Math.min(100, parseInt(process.env.KIE_MAX_SUBMISSIONS_PER_10S || "20", 10)));
const KIE_RATE_WINDOW_MS = 10_000;

// ─── Polling config ──────────────────────────────────────────────────────────
const KIE_POLL_INTERVAL_FAST_MS = 3_000;    // poll every 3s for first 2 min (detect completion sooner)
const KIE_POLL_INTERVAL_MS      = 5_000;    // poll every 5s after 2 min
const KIE_POLL_FAST_WINDOW_MS   = 2 * 60 * 1000; // first 2 min = fast polling
const KIE_POLL_INITIAL_DELAY_MS = 1_000;    // delay before first poll (let KIE register task)
const KIE_POLL_TIMEOUT_IMAGE_MS = 5  * 60 * 1000;  // 5 min for images
const KIE_POLL_TIMEOUT_VIDEO_MS = 35 * 60 * 1000;  // 35 min for videos

// ─── In-memory queue state ───────────────────────────────────────────────────
const kieJobQueue         = [];
let   kieActiveCount      = 0;
const kieSubmitTimestamps = [];

if (!KIE_API_KEY) {
  console.warn("⚠️ KIE_API_KEY not set — kie.ai features will be unavailable");
}


/**
 * Public URL for KIE to POST task completion callbacks.
 * Must be an absolute public URL (not localhost). Used when creating KIE tasks.
 * If this is wrong or unreachable, deferred jobs never get the callback and run forever — set CALLBACK_BASE_URL or KIE_CALLBACK_URL correctly.
 * Final value: ${CALLBACK_BASE_URL}/api/kie/callback
 * Priority: KIE_CALLBACK_URL (full) > CALLBACK_BASE_URL > NEXT_PUBLIC_APP_URL > APP_PUBLIC_URL / PUBLIC_URL / APP_URL > VERCEL_URL.
 */
export function getKieCallbackUrl() {
  const explicit = process.env.KIE_CALLBACK_URL;
  if (explicit && typeof explicit === "string" && explicit.startsWith("http")) return explicit.trim();
  const callbackBase = process.env.CALLBACK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (callbackBase) {
    const base = callbackBase.replace(/\/$/, "").trim();
    const withProtocol = base.startsWith("http") ? base : `https://${base}`;
    return `${withProtocol.replace(/\/$/, "")}/api/kie/callback`;
  }
  const baseUrl = process.env.APP_PUBLIC_URL || process.env.PUBLIC_URL || process.env.APP_URL;
  if (baseUrl) {
    const base = baseUrl.replace(/\/$/, "").replace(/^https?:\/\//, "").split("/")[0];
    const protocol = baseUrl.trim().toLowerCase().startsWith("http:") ? "http" : "https";
    return `${protocol}://${base}/api/kie/callback`;
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").split("/")[0]}/api/kie/callback`;
  return null;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

function processKieQueue() {
  while (kieActiveCount < KIE_MAX_CONCURRENT && kieJobQueue.length > 0) {
    const job = kieJobQueue.shift();
    kieActiveCount++;
    console.log(`[KIE] Starting job — active: ${kieActiveCount}/${KIE_MAX_CONCURRENT}, waiting: ${kieJobQueue.length}`);
    job.run()
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        kieActiveCount--;
        console.log(`[KIE] Job done — active: ${kieActiveCount}/${KIE_MAX_CONCURRENT}, waiting: ${kieJobQueue.length}`);
        processKieQueue();
      });
  }
}

function enqueueKieJob(fn) {
  return new Promise((resolve, reject) => {
    kieJobQueue.push({ run: fn, resolve, reject });
    console.log(`[KIE] Enqueued — active: ${kieActiveCount}/${KIE_MAX_CONCURRENT}, waiting: ${kieJobQueue.length}`);
    processKieQueue();
  });
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

function trimSubmitTimestamps() {
  const cutoff = Date.now() - KIE_RATE_WINDOW_MS;
  while (kieSubmitTimestamps.length && kieSubmitTimestamps[0] < cutoff) {
    kieSubmitTimestamps.shift();
  }
}

async function waitForRateSlot(label) {
  trimSubmitTimestamps();
  while (kieSubmitTimestamps.length >= KIE_MAX_SUBMISSIONS_PER_10S) {
    const waitMs = Math.max(500, kieSubmitTimestamps[0] + KIE_RATE_WINDOW_MS - Date.now());
    console.log(`[KIE] Rate limit hit (${kieSubmitTimestamps.length}/${KIE_MAX_SUBMISSIONS_PER_10S} in 10s) — waiting ${(waitMs / 1000).toFixed(1)}s for ${label}`);
    await new Promise(r => setTimeout(r, waitMs));
    trimSubmitTimestamps();
  }
  kieSubmitTimestamps.push(Date.now());
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Motion-control: use documented wire format:
 *   { model, callBackUrl, input: { ... } }
 */
function normalizeKieCreateRequestBody(rawBody, label) {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new Error(`[KIE] Invalid request body for ${label}: expected object`);
  }
  const body = { ...rawBody };
  let input = body.input;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error(`[KIE] Invalid request body for ${label}: input must be an object (failed to parse JSON string)`);
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`[KIE] Invalid request body for ${label}: input must be an object, not a JSON string`);
  }

  const model = String(body.model || "");
  if (model.includes("motion-control")) {
    const coerceUrlArray = (v, field) => {
      if (v == null) return [];
      if (Array.isArray(v)) {
        return v
          .map((x) => {
            if (typeof x === "string" && x.trim().startsWith("http")) return x.trim();
            if (x && typeof x === "object" && typeof x.url === "string" && x.url.startsWith("http")) return x.url.trim();
            return null;
          })
          .filter(Boolean);
      }
      if (typeof v === "string") {
        const s = v.trim();
        if (s.startsWith("http")) return [s];
        try {
          const p = JSON.parse(s);
          if (Array.isArray(p)) return coerceUrlArray(p, field);
          if (p && typeof p === "object") {
            return coerceUrlArray(p.video_urls || p.input_urls || [], field);
          }
        } catch {
          /* ignore */
        }
      }
      if (typeof v === "object" && v !== null && typeof v.input === "string") {
        try {
          const inner = JSON.parse(v.input);
          if (inner && typeof inner === "object") {
            if (field === "video_urls" && inner.video_urls) return coerceUrlArray(inner.video_urls, field);
            if (field === "input_urls" && inner.input_urls) return coerceUrlArray(inner.input_urls, field);
          }
        } catch {
          /* ignore */
        }
      }
      return [];
    };

    const next = { ...input };
    next.input_urls = coerceUrlArray(next.input_urls, "input_urls");
    next.video_urls = coerceUrlArray(next.video_urls, "video_urls");
    if (!next.input_urls.length || !next.video_urls.length) {
      throw new Error(
        `[KIE] Invalid motion-control payload for ${label}: input_urls and video_urls must each contain at least one http(s) URL`,
      );
    }

    // Keep motion-control payload structure aligned with the known working content-studio format.
    const mRaw = String(next.mode ?? "").trim().toLowerCase();
    if (mRaw === "1080p" || mRaw === "pro" || mRaw === "professional") {
      next.mode = "1080p";
    } else if (mRaw === "720p" || mRaw === "std" || mRaw === "standard" || mRaw === "") {
      next.mode = "720p";
    } else {
      next.mode = "720p";
    }
    const characterOrientation =
      next.character_orientation === "image" || next.character_orientation === "video"
        ? next.character_orientation
        : "video";
    next.character_orientation = characterOrientation;
    if (model.includes("kling-3.0")) {
      if (!next.background_source) next.background_source = "input_video";
    } else {
      delete next.background_source;
    }

    body.input = next;
  } else {
    body.input = input;
  }

  return body;
}

/** Avoid logging multi-KB HTML error pages (Cloudflare 502, etc.). */
function kieHttpErrorMessage(status, text) {
  const body = String(text || "");
  const looksLikeHtml = /<!DOCTYPE/i.test(body) || /<html[\s>]/i.test(body);
  if (looksLikeHtml || (status >= 500 && body.length > 400)) {
    return `AI service HTTP ${status} (upstream temporarily unavailable — try again shortly)`;
  }
  return `AI service HTTP ${status}: ${body.slice(0, 300)}`;
}

/**
 * Submit a task to KIE API. Returns taskId string.
 */
async function kieCreateTask(requestBody, label = "task") {
  await waitForRateSlot(label);

  const body = normalizeKieCreateRequestBody(requestBody, label);

  const modelName = String(body.model || "");
  const motionControl = modelName.includes("motion-control");
  if (typeof body.input !== "object" || body.input === null || Array.isArray(body.input)) {
    throw new Error(`[KIE] createTask requires input as object (got ${typeof body.input})`);
  }

  console.log(
    `[KIE] Submitting ${label} (input=${typeof body.input}${motionControl ? ", motion-control" : ""}):`,
    JSON.stringify(body).slice(0, 320),
  );

  const res = await fetch(`${KIE_API_URL}/jobs/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KIE_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(kieHttpErrorMessage(res.status, text));
  }

  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`AI service invalid response: ${text.slice(0, 200)}`);
  }

  if (data.code !== 200) {
    throw new Error(`AI service error (code ${data.code}): ${data.message || data.msg || "unknown"}`);
  }

  const taskId = data.data?.taskId;
  if (!taskId) throw new Error(`AI service returned no task ID: ${JSON.stringify(data).slice(0, 200)}`);

  console.log(`[KIE] Task submitted: ${taskId} (${label})`);
  return taskId;
}

async function kiePostJson(endpointPath, requestBody, label = "task") {
  await waitForRateSlot(label);
  const res = await fetch(`${KIE_API_URL}${endpointPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KIE_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(kieHttpErrorMessage(res.status, text));
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`AI service invalid response: ${text.slice(0, 200)}`);
  }
  if (data.code !== 200) {
    throw new Error(`AI service error (code ${data.code}): ${data.message || data.msg || "unknown"}`);
  }
  const taskId = data.data?.taskId || data.data?.task_id || data.taskId || data.task_id;
  if (!taskId) throw new Error(`AI service returned no task ID: ${JSON.stringify(data).slice(0, 200)}`);
  return taskId;
}

/**
 * Fetch current KIE task status once (no polling). For designer-studio / admin polling.
 * @returns {{ state, outputUrl?, failMsg?, resultJson? }}
 */
export async function getKieTaskStatus(taskId) {
  if (!KIE_API_KEY) throw new Error("KIE_API_KEY not set");
  const res = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${taskId}`, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`KIE status HTTP ${res.status}`);
  const json = await res.json();
  const data = json.data ?? json;
  const state = String(data.state ?? "").toLowerCase();
  let outputUrl = null;
  if (state === "success" && data.resultJson) {
    try {
      const resultJson = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
      const urls = resultJson?.resultUrls ?? resultJson?.result_urls ?? resultJson?.output_urls ?? resultJson?.urls;
      if (Array.isArray(urls) && urls[0]) outputUrl = typeof urls[0] === "string" ? urls[0] : urls[0]?.url ?? urls[0]?.href;
      if (!outputUrl) outputUrl = resultJson?.url ?? resultJson?.outputUrl ?? resultJson?.output_url ?? resultJson?.video_url ?? resultJson?.result_video_url ?? resultJson?.result_image_url;
    } catch {}
  }
  return { state, outputUrl: outputUrl || data.resultUrl || data.outputUrl, failMsg: data.failMsg || data.failCode, resultJson: data.resultJson };
}

/**
 * Poll a KIE task until done. Returns the output URL.
 * Throws on hard failure or timeout.
 */
async function kiePollTask(taskId, timeoutMs, label = "task") {
  const deadline = Date.now() + timeoutMs;
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;

    // Adaptive interval: poll every 5s for first 2 min, then every 8s
    const elapsed = Date.now() - startTime;
    const interval = elapsed < KIE_POLL_FAST_WINDOW_MS
      ? KIE_POLL_INTERVAL_FAST_MS
      : KIE_POLL_INTERVAL_MS;

    // First attempt: short delay to let KIE register the task
    // Subsequent attempts: full interval
    await new Promise(r => setTimeout(r, attempts === 1 ? KIE_POLL_INITIAL_DELAY_MS : interval));

    let data;
    try {
      const res = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
        signal: AbortSignal.timeout(28_000),
      });
      if (!res.ok) {
        console.warn(`[KIE] Poll HTTP ${res.status} for ${taskId} (attempt ${attempts}) — retrying`);
        continue;
      }
      const json = await res.json();
      data = json.data ?? json;
    } catch (err) {
      console.warn(`[KIE] Poll fetch error for ${taskId} (attempt ${attempts}): ${err.message} — retrying`);
      continue;
    }

    const state = String(data.state ?? "").toLowerCase();
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`[KIE] ${label} ${taskId} state: ${state} (attempt ${attempts}, ${elapsedSec}s elapsed, ${Math.round((deadline - Date.now()) / 1000)}s left)`);

    if (state === "success") {
      // Parse resultJson to get output URL — cover every known KIE payload shape
      let outputUrl = null;
      try {
        const resultJson = typeof data.resultJson === "string"
          ? JSON.parse(data.resultJson)
          : data.resultJson;
        if (resultJson) {
          // Array of URLs (most common)
          const urlsArray =
            resultJson?.resultUrls ?? resultJson?.result_urls ??
            resultJson?.output_urls ?? resultJson?.urls ?? resultJson?.outputs;
          if (Array.isArray(urlsArray) && urlsArray[0]) {
            const first = urlsArray[0];
            outputUrl = typeof first === "string" ? first : first?.url ?? first?.href ?? null;
          }
          // Single URL fields
          if (!outputUrl) {
            outputUrl =
              resultJson?.url ?? resultJson?.outputUrl ?? resultJson?.output_url ??
              resultJson?.video_url ?? resultJson?.result_video_url ?? resultJson?.result_image_url ??
              resultJson?.result?.url ?? resultJson?.result?.outputUrl ??
              resultJson?.data?.url ?? resultJson?.data?.outputUrl ??
              resultJson?.output ?? resultJson?.image ?? resultJson?.video ?? null;
          }
          // Bare array
          if (!outputUrl && Array.isArray(resultJson) && typeof resultJson[0] === "string") {
            outputUrl = resultJson[0];
          }
          // Bare string
          if (!outputUrl && typeof resultJson === "string" && resultJson.startsWith("http")) {
            outputUrl = resultJson;
          }
        }
      } catch {
        if (typeof data.resultJson === "string" && data.resultJson.startsWith("http")) {
          outputUrl = data.resultJson;
        }
      }
      // Fallback to top-level fields on the poll response
      outputUrl = outputUrl ||
        data.resultUrl || data.outputUrl || data.output_url ||
        data.url || data.video_url || data.result_video_url || data.image_url;

      if (!outputUrl) {
        console.error(`[KIE] Task ${taskId} succeeded but no URL found:`, JSON.stringify(data).slice(0, 500));
        throw new Error("Generation succeeded but no output URL was returned");
      }

      console.log(`[KIE] ✅ ${label} complete: ${outputUrl}`);
      return outputUrl;
    }

    if (state === "fail") {
      const failMsg = data.failMsg || data.failCode || "Unknown failure";
      console.error(`[KIE] ❌ Task ${taskId} failed — failMsg: "${failMsg}", failCode: "${data.failCode}", full data:`, JSON.stringify(data).slice(0, 500));
      throw new Error(`AI service generation failed: ${failMsg}`);
    }

    // States: waiting | queuing | generating — keep polling
  }

  throw new Error(`AI service task timed out after ${Math.round(timeoutMs / 60000)} minutes`);
}

/**
 * Submit a KIE task. When callback URL is set: add callBackUrl, create task, run onTaskCreated, return deferred (no polling).
 * Callback handler receives result from KIE, mirrors to R2, and updates the generation (or continues pipeline).
 * When no callback URL (e.g. local dev): poll until done, then archive to R2 and return outputUrl.
 * Retries up to 3 times on transient KIE failures (busy, server error, timeout).
 */
async function kieRun(requestBody, label, timeoutMs, options = {}) {
  const MAX_ATTEMPTS = 3;
  let lastErr;
  const callbackUrl = getKieCallbackUrl();
  const forcePolling = options.forcePolling === true; // e.g. create-model-with-AI reference image — no generation record to pair callback to
  const useCallback = !!callbackUrl && !forcePolling;
  if (!forcePolling && !callbackUrl) {
    throw new Error(`[KIE] Callback URL is required for ${label} (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const isRateLimit = lastErr && (lastErr.message || "").toLowerCase().includes("429") || (lastErr?.message || "").toLowerCase().includes("rate limit");
      // Rate limit: wait just past the 10s KIE window. Other transient: short backoff.
      const backoff = isRateLimit ? 11_000 : attempt * 5_000; // 11s for 429, 5s/10s otherwise
      console.log(`[KIE] Retrying ${label} (attempt ${attempt}/${MAX_ATTEMPTS}) after ${backoff / 1000}s — reason: ${lastErr?.message?.slice(0, 100)}`);
      await new Promise(r => setTimeout(r, backoff));
    }

    try {
      const body = { ...requestBody };
      if (callbackUrl && !forcePolling) {
        body.callBackUrl = callbackUrl;
        if (attempt === 1) console.log(`[KIE] ${label} using callback: ${callbackUrl}`);
      } else if (forcePolling && attempt === 1) {
        console.log(`[KIE] ${label} force polling (no callback)`);
      }
      const taskId = await kieCreateTask(body, label);
      if (typeof options.onTaskCreated === "function") {
        try {
          await options.onTaskCreated(taskId);
        } catch (e) {
          console.warn("[KIE] onTaskCreated failed:", e?.message);
        }
      }
      if (useCallback) {
        console.log(`[KIE] ${label} deferred — result will arrive via callback (task ${taskId})`);
        return { success: true, deferred: true, taskId };
      }
      const rawUrl = await kiePollTask(taskId, timeoutMs, label);
      const outputUrl = await archiveToR2(rawUrl);
      return { success: true, outputUrl, taskId };
    } catch (err) {
      lastErr = err;
      const msg = (err?.message || "").toLowerCase();
      // Retry on transient KIE errors only
      const isTransient =
        msg.includes("busy") ||
        msg.includes("server issue") ||
        msg.includes("overload") ||
        msg.includes("capacity") ||
        msg.includes("timeout") ||
        msg.includes("timed out") ||
        msg.includes("internal") ||
        msg.includes("unavailable") ||
        msg.includes("http 5") ||
        msg.includes("http 429") ||
        msg.includes("rate limit") ||
        msg.includes("fetch failed") ||       // Node.js network-level fetch error
        msg.includes("network") ||
        msg.includes("econnreset") ||
        msg.includes("econnrefused") ||
        msg.includes("socket") ||
        msg.includes("dns") ||
        err?.name === "TypeError" ||           // fetch() throws TypeError on network failure
        err?.code === "ECONNRESET" ||
        err?.code === "ETIMEDOUT";

      if (isTransient && attempt < MAX_ATTEMPTS) {
        console.warn(`[KIE] Transient failure on ${label} (attempt ${attempt}): ${err.message}`);
        continue;
      }
      // Hard failure or last attempt — propagate
      throw err;
    }
  }

  throw lastErr;
}

// ─── R2 archiving ─────────────────────────────────────────────────────────────

async function archiveToR2(sourceUrl) {
  if (!isR2Configured()) {
    // R2 not configured — return the original KIE URL so the generation still completes.
    // The URL may expire eventually but the generation succeeds now.
    console.warn("[KIE] R2 not configured — returning raw KIE URL without archiving:", sourceUrl.slice(0, 80));
    return sourceUrl;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[KIE] Archiving to R2 (attempt ${attempt}/3): ${sourceUrl.slice(0, 80)}`);
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

      const buffer     = Buffer.from(await res.arrayBuffer());
      const ct         = res.headers.get("content-type") || "image/png";
      const ext        = sourceUrl.match(/\.(mp4|webm|jpg|jpeg|webp|png)(\?|$)/i)?.[1]?.toLowerCase()
                      || (ct.includes("mp4") ? "mp4" : ct.includes("webm") ? "webm"
                        : ct.includes("jpg") || ct.includes("jpeg") ? "jpg"
                        : ct.includes("webp") ? "webp" : "png");
      const finalCt    = ext === "mp4" ? "video/mp4" : ext === "webm" ? "video/webm" : ct;
      const r2Url      = await uploadBufferToBlobOrR2(buffer, "generations", ext, finalCt);

      console.log(`[KIE] Archived to R2: ${r2Url}`);
      return r2Url;
    } catch (err) {
      console.error(`[KIE] Archive attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  console.error("[KIE] All 3 R2 archive attempts failed — returning raw KIE URL as fallback:", sourceUrl.slice(0, 80));
  return sourceUrl; // Return original URL — generation succeeds, URL may expire but user gets their result now
}

// ─── Generation functions ─────────────────────────────────────────────────────

/**
 * Seedream V4.5 Edit — multi-image editing/identity transfer.
 * @param {string[]} images - array of image URLs
 * @param {string} prompt
 * @param {object} options - { aspectRatio, quality }
 */
async function generateImageWithSeedreamKieInternal(images, prompt, options = {}) {
  console.log(`[KIE/seedream] images=${images.length}, prompt="${prompt.slice(0, 80)}"`);
  const validation = await validateSeedreamEditImages(images, "kie");
  if (!validation.valid) {
    throw new Error(validation.message);
  }
  const result = await kieRun(
    {
      model: "seedream/4.5-edit",
      input: {
        prompt,
        image_urls: images,
        aspect_ratio: options.aspectRatio || "9:16",
        quality: options.quality || "basic",
      },
    },
    "seedream-edit",
    KIE_POLL_TIMEOUT_IMAGE_MS,
    { onTaskCreated: options.onTaskCreated },
  );
  return result;
}

/**
 * Identity recreation: Seedream 4.5 Edit with identity + target image.
 * @param {string[]} identityImages - identity reference photos (3)
 * @param {string} targetImage - pose/scene image to recreate
 * @param {object} options
 */
async function generateImageWithIdentityKieInternal(identityImages, targetImage, options = {}) {
  const allImages = [...identityImages, targetImage];
  const prompt = options.customImagePrompt || IDENTITY_RECREATE_MODEL_CLOTHES;
  return generateImageWithSeedreamKieInternal(allImages, prompt, {
    aspectRatio: options.aspectRatio || "9:16",
    quality: options.quality || "basic",
    onTaskCreated: options.onTaskCreated,
  });
}

/**
 * Nano Banana Pro — identity-preserving image generation with KIE elements.
 * Uses kling_elements to pass identity images, then references them in prompt.
 * @param {string[]} images - identity/reference images (min 2)
 * @param {string} prompt
 * @param {object} options - { aspectRatio, resolution, outputFormat }
 */
async function generateImageWithNanoBananaKieInternal(images, prompt, options = {}) {
  console.log(`[KIE/nano-banana] images=${images.length}`);
  console.log(`[KIE/nano-banana] image URLs:`, images.map(u => u.slice(0, 80)));
  console.log(`[KIE/nano-banana] prompt="${prompt.slice(0, 80)}"`);
  const validation = await validateNanoBananaInputImages(images);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const modelName = "nano-banana-pro";
  const result = await kieRun(
    {
      model: modelName,
      input: {
        prompt,
        image_input: images.slice(0, 8),
        aspect_ratio: options.aspectRatio || "9:16",
        resolution: options.resolution || "1K",
      },
    },
    modelName,
    KIE_POLL_TIMEOUT_IMAGE_MS,
    { onTaskCreated: options.onTaskCreated, forcePolling: options.forcePolling },
  );
  return result;
}

/**
 * Nano Banana Pro — text-to-image (no identity images). Uses Pro model for best quality.
 */
async function generateTextToImageNanoBananaKieInternal(prompt, options = {}) {
  const modelName = "nano-banana-pro";
  console.log(`[KIE/${modelName}] text-to-image prompt="${prompt.slice(0, 80)}"`);
  const result = await kieRun(
    {
      model: modelName,
      input: {
        prompt,
        aspect_ratio: options.aspectRatio || "1:1",
        resolution: options.resolution || "1K",
      },
    },
    modelName,
    KIE_POLL_TIMEOUT_IMAGE_MS,
    { forcePolling: options.forcePolling, onTaskCreated: options.onTaskCreated },
  );
  return result;
}

/**
 * Kling 3.0 image-to-video with motion (recreate video).
 * @param {string} imageUrl - starting frame image
 * @param {string} videoUrl - reference video for motion (passed as end frame or element)
 * @param {object} options - { prompt, videoPrompt, ultra, ultraMode, motion1080p, motion720p, motionMode, characterOrientation, onTaskSubmitted }
 * Default output resolution is 1080p for both 2.6 (classic) and 3.0 (ultra). Pass motion720p: true or motionMode "720p"|"std"|"standard" to force 720p.
 * Payload shape matches content-studio for both 2.6 and 3.0 motion-control.
 */
async function generateVideoWithMotionKieInternal(imageUrl, videoUrl, options = {}) {
  console.log(`[KIE/kling-motion] image="${imageUrl.slice(0, 120)}"`);
  console.log(`[KIE/kling-motion] video="${videoUrl.slice(0, 120)}"`);
  const useUltraMotionControl = options.ultra === true || options.ultraMode === true;
  const validation = await validateKlingMotionInputs(imageUrl, videoUrl, useUltraMotionControl);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const img = typeof imageUrl === "string" ? imageUrl.trim() : String(imageUrl || "");
  const vid = typeof videoUrl === "string" ? videoUrl.trim() : String(videoUrl || "");

  try {
    await verifyUrlReachable(img, "Motion input image");
    await verifyUrlReachable(vid, "Motion input video");
  } catch (e) {
    throw new Error(
      `Motion media URL is not reachable (KIE must download it). Re-upload your image/video and try again. ${e?.message || ""}`,
    );
  }

  // Requested behavior: do not send prompt for motion-control recreate (2.6 or 3.0).
  // We intentionally omit `input.prompt` entirely.

  const model = useUltraMotionControl ? "kling-3.0/motion-control" : "kling-2.6/motion-control";
  const force720 =
    options.motion720p === true ||
    options.motionMode === "720p" ||
    options.motionMode === "std" ||
    options.motionMode === "standard";
  const mode = force720 ? "720p" : "1080p";

  const inputObj = {
    input_urls: [img],
    video_urls: [vid],
    mode,
    character_orientation:
      options.characterOrientation === "image" || options.characterOrientation === "video"
        ? options.characterOrientation
        : "video",
  };
  if (useUltraMotionControl) {
    inputObj.background_source = "input_video";
  }

  const requestBody = {
    model,
    input: inputObj,
  };

  const callbackUrl = getKieCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[KIE/kling-motion] Callback URL is required (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)");
  }
  requestBody.callBackUrl = callbackUrl;
  console.log(`[KIE/kling-motion] Using callback URL: ${callbackUrl}`);

  // Use kieRun for retry logic, but fire onTaskSubmitted after first successful submission
  const MAX_ATTEMPTS = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const backoff = attempt * 30_000;
      console.log(`[KIE/kling-motion] Retrying (attempt ${attempt}/${MAX_ATTEMPTS}) after ${backoff / 1000}s`);
      await new Promise(r => setTimeout(r, backoff));
    }

    try {
      const motionLabel = useUltraMotionControl ? "kling-motion-ultra" : "kling-motion";
      console.log(
        `[KIE/${motionLabel}] Submitting to KIE (${useUltraMotionControl ? "ultra/3.0" : "std/2.6"}) mode=${mode} attempt ${attempt}:`,
        JSON.stringify(requestBody.input).slice(0, 220),
      );
      const taskId = await kieCreateTask(requestBody, motionLabel);

      // Fire callback after first successful task creation
      if (typeof options.onTaskSubmitted === "function") {
        try { await options.onTaskSubmitted(taskId); } catch (_) {}
      }

      // Callback-only retrieval: results are finalized in /api/kie/callback
      console.log(`[KIE/kling-motion] Deferred: result will arrive via callback for task ${taskId}`);
      return { success: true, deferred: true, taskId };
    } catch (err) {
      lastErr = err;
      const msg = (err?.message || "").toLowerCase();
      const isTransient =
        msg.includes("busy") || msg.includes("server issue") || msg.includes("overload") ||
        msg.includes("capacity") || msg.includes("timeout") || msg.includes("timed out") ||
        msg.includes("internal") || msg.includes("unavailable") || msg.includes("http 5") ||
        msg.includes("http 429") || msg.includes("rate limit") || msg.includes("fetch failed") ||
        msg.includes("network") || msg.includes("econnreset") || err?.name === "TypeError";

      if (isTransient && attempt < MAX_ATTEMPTS) {
        console.warn(`[KIE/kling-motion] Transient failure (attempt ${attempt}): ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

/**
 * Wan 2.2 animate-move recreate (image + reference video).
 * Uses callback-only completion flow, same as motion-control recreate.
 */
async function generateVideoWithWanAnimateMoveKieInternal(imageUrl, videoUrl, options = {}) {
  console.log(`[KIE/wan-animate-move] image="${imageUrl.slice(0, 120)}"`);
  console.log(`[KIE/wan-animate-move] video="${videoUrl.slice(0, 120)}"`);

  const img = typeof imageUrl === "string" ? imageUrl.trim() : String(imageUrl || "");
  const vid = typeof videoUrl === "string" ? videoUrl.trim() : String(videoUrl || "");
  const resolution = normalizeWanResolution(options.resolution);

  try {
    await verifyUrlReachable(img, "WAN animate input image");
    await verifyUrlReachable(vid, "WAN animate input video");
  } catch (e) {
    throw new Error(
      `Wan animate media URL is not reachable (KIE must download it). Re-upload your image/video and try again. ${e?.message || ""}`,
    );
  }

  const callbackUrl = getKieCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[KIE/wan-animate-move] Callback URL is required (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)");
  }

  const modelName = KIE_VIDEO_MODEL_CATALOG.recreate.wan22AnimateMove.model;
  const requestBody = {
    model: modelName,
    callBackUrl: callbackUrl,
    input: {
      video_url: vid,
      image_url: img,
      resolution,
      nsfw_checker: options.nsfwChecker === true,
    },
  };

  const MAX_ATTEMPTS = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const backoff = attempt * 30_000;
      console.log(`[KIE/wan-animate-move] Retrying (attempt ${attempt}/${MAX_ATTEMPTS}) after ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
    }
    try {
      console.log(
        `[KIE/wan-animate-move] Submitting mode=${resolution} attempt ${attempt}:`,
        JSON.stringify(requestBody.input),
      );
      const taskId = await kieCreateTask(requestBody, "wan-animate-move");
      if (typeof options.onTaskSubmitted === "function") {
        try { await options.onTaskSubmitted(taskId); } catch (_) {}
      }
      console.log(`[KIE/wan-animate-move] Deferred: result will arrive via callback for task ${taskId}`);
      return { success: true, deferred: true, taskId };
    } catch (err) {
      lastErr = err;
      const msg = (err?.message || "").toLowerCase();
      const isTransient =
        msg.includes("busy") || msg.includes("server issue") || msg.includes("overload") ||
        msg.includes("capacity") || msg.includes("timeout") || msg.includes("timed out") ||
        msg.includes("internal") || msg.includes("unavailable") || msg.includes("http 5") ||
        msg.includes("http 429") || msg.includes("rate limit") || msg.includes("fetch failed") ||
        msg.includes("network") || msg.includes("econnreset") || err?.name === "TypeError";
      if (isTransient && attempt < MAX_ATTEMPTS) {
        console.warn(`[KIE/wan-animate-move] Transient failure (attempt ${attempt}): ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

async function generateVideoWithWanAnimateReplaceKieInternal(imageUrl, videoUrl, options = {}) {
  console.log(`[KIE/wan-animate-replace] image="${imageUrl.slice(0, 120)}"`);
  console.log(`[KIE/wan-animate-replace] video="${videoUrl.slice(0, 120)}"`);

  const img = typeof imageUrl === "string" ? imageUrl.trim() : String(imageUrl || "");
  const vid = typeof videoUrl === "string" ? videoUrl.trim() : String(videoUrl || "");
  const resolution = normalizeWanResolution(options.resolution);

  const callbackUrl = getKieCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[KIE/wan-animate-replace] Callback URL is required (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)");
  }

  const requestBody = {
    model: "wan/2-2-animate-replace",
    callBackUrl: callbackUrl,
    input: {
      video_url: vid,
      image_url: img,
      resolution,
      nsfw_checker: options.nsfwChecker === true,
    },
  };

  const taskId = await kieCreateTask(requestBody, "wan-animate-replace");
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

/**
 * Kling image-to-video (2.6 or 3.0).
 * @param {string} imageUrl - starting image
 * @param {string} prompt
 * @param {object} options - { duration, useKling3, sound, onTaskCreated, forcePolling }
 */
async function generateVideoWithKling26KieInternal(imageUrl, prompt, options = {}) {
  const useKling3 = options.useKling3 === true;
  const duration = String(options.duration ?? "5").trim();
  const allowed = useKling3
    ? kieConstraints.kling30Video.allowedDurationSeconds
    : kieConstraints.kling26ImageToVideo.allowedDurationSeconds;
  if (!allowed.includes(duration)) {
    throw new Error(
      `Invalid Kling image-to-video duration "${duration}". Use one of: ${allowed.join(", ")} (seconds per KIE docs).`,
    );
  }
  const model = useKling3 ? "kling-3.0/video" : "kling-2.6/image-to-video";
  const firstImageUrl = String(imageUrl || "").trim();
  const endFrameUrl = String(options.endFrameUrl || "").trim();
  const imageUrls = [firstImageUrl, endFrameUrl].filter(Boolean).slice(0, 2);
  const aspectRatio = options.aspectRatio || "16:9";
  console.log(`[KIE/kling-i2v] model=${model}, image="${firstImageUrl.slice(0, 80)}", duration=${duration}s`);
  const validation = await validateKlingImageToVideoInput(firstImageUrl, { useKling3: options.useKling3 === true });
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const result = await kieRun(
    {
      model,
      input: {
        image_urls: imageUrls.length ? imageUrls : [firstImageUrl],
        prompt,
        duration,
        sound: options.sound === true,
        ...(useKling3
          ? {
              aspect_ratio: aspectRatio,
              mode: options.mode === "pro" ? "pro" : "std",
              multi_shots: options.multiShots === true,
              ...(Array.isArray(options.klingElements) && options.klingElements.length
                ? { kling_elements: options.klingElements.slice(0, 3) }
                : {}),
            }
          : {}),
      },
    },
    useKling3 ? "kling-i2v-3" : "kling-i2v",
    KIE_POLL_TIMEOUT_VIDEO_MS,
    { onTaskCreated: options.onTaskCreated, forcePolling: options.forcePolling },
  );
  return result;
}

async function generateVideoWithSora2ProKieInternal(options = {}) {
  const mode = options.mode === "i2v" ? "i2v" : "t2v";
  const model = mode === "i2v"
    ? KIE_VIDEO_MODEL_CATALOG.sora2Pro.imageToVideoModel
    : KIE_VIDEO_MODEL_CATALOG.sora2Pro.textToVideoModel;
  const callbackUrl = getKieCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[KIE/sora2] Callback URL is required (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)");
  }
  const nFrames = String(options.nFrames || "10");
  const size = options.size === "high" ? "high" : "standard";
  const input = {
    prompt: String(options.prompt || ""),
    aspect_ratio: options.aspectRatio === "portrait" ? "portrait" : "landscape",
    n_frames: nFrames === "15" ? "15" : "10",
    size,
    quality: options.quality === "high" ? "high" : "standard",
    remove_watermark: options.removeWatermark === true,
    upload_method: "s3",
  };
  if (mode === "i2v") {
    const imageUrl = String(options.imageUrl || "").trim();
    if (!imageUrl) throw new Error("Sora2 image-to-video requires imageUrl.");
    input.image_urls = [imageUrl];
  }
  if (Array.isArray(options.characterIdList) && options.characterIdList.length) {
    input.character_id_list = options.characterIdList.slice(0, 5).map((v) => String(v)).filter(Boolean);
  }

  const requestBody = {
    model,
    callBackUrl: callbackUrl,
    input,
  };
  const taskId = await kieCreateTask(requestBody, `sora2-${mode}`);
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

async function generateVideoWithKlingTextKieInternal(prompt, options = {}) {
  const useKling3 = options.useKling3 === true;
  const model = useKling3
    ? KIE_VIDEO_MODEL_CATALOG.klingVideo.kling30VideoModel
    : KIE_VIDEO_MODEL_CATALOG.klingVideo.kling26TextToVideoModel;
  const callbackUrl = getKieCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[KIE/kling-text] Callback URL is required (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)");
  }
  const duration = String(options.duration ?? "5").trim();
  const input = {
    prompt: String(prompt || ""),
    duration: useKling3
      ? (["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"].includes(duration) ? duration : "5")
      : (duration === "10" ? "10" : "5"),
    sound: options.sound === true,
  };
  if (useKling3) {
    input.aspect_ratio = options.aspectRatio || "16:9";
    input.mode = options.quality === "pro" ? "pro" : "std";
    input.multi_shots = options.multiShots === true;
    if (options.multiShots === true) {
      input.multi_prompt = [{ prompt: String(prompt || ""), duration: Math.min(12, Math.max(1, Number(duration) || 5)) }];
    }
    if (Array.isArray(options.klingElements) && options.klingElements.length) {
      input.kling_elements = options.klingElements.slice(0, 3);
    }
  } else if (options.aspectRatio) {
    input.aspect_ratio = options.aspectRatio;
  }
  const taskId = await kieCreateTask({ model, callBackUrl: callbackUrl, input }, useKling3 ? "kling30-t2v" : "kling26-t2v");
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

async function generateVideoWithVeo31KieInternal(options = {}) {
  const callbackUrl = getKieCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[KIE/veo31] Callback URL is required (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)");
  }
  const endpoint = KIE_VIDEO_MODEL_CATALOG.veo31.generate.endpoint;
  const model = options.speed === "quality" ? "veo3" : "veo3_fast";
  const generationType = options.mode === "FIRST_AND_LAST_FRAMES_2_VIDEO"
    ? "FIRST_AND_LAST_FRAMES_2_VIDEO"
    : options.mode === "TEXT_2_VIDEO"
      ? "TEXT_2_VIDEO"
      : "REFERENCE_2_VIDEO";
  const aspectRatio = (options.aspectRatio === "9:16" || options.aspectRatio === "Auto") ? options.aspectRatio : "16:9";

  const candidates = [
    options.imageUrl,
    options.referenceImageUrl,
    options.endFrameUrl,
    options.thirdImageUrl,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const dedupedImageUrls = [...new Set(candidates)];
  let imageUrls = [];
  if (generationType === "FIRST_AND_LAST_FRAMES_2_VIDEO") {
    imageUrls = dedupedImageUrls.slice(0, 2);
  } else if (generationType === "REFERENCE_2_VIDEO") {
    imageUrls = dedupedImageUrls.slice(0, 3);
  }

  if (generationType === "REFERENCE_2_VIDEO" && model !== "veo3_fast") {
    throw new Error("REFERENCE_2_VIDEO currently supports only veo3_fast.");
  }
  if (generationType !== "TEXT_2_VIDEO" && imageUrls.length === 0) {
    throw new Error(`${generationType} requires at least one image URL.`);
  }

  const requestBody = {
    prompt: String(options.prompt || ""),
    model,
    generationType,
    aspect_ratio: aspectRatio,
    callBackUrl: callbackUrl,
    enableTranslation: options.enableTranslation !== false,
  };
  if (imageUrls.length) requestBody.imageUrls = imageUrls;
  const seed = Number(options.seeds);
  if (Number.isInteger(seed) && seed >= 10000 && seed <= 99999) requestBody.seeds = seed;
  if (options.watermark) requestBody.watermark = String(options.watermark);

  const taskId = await kiePostJson(endpoint, requestBody, "veo31-generate");
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

async function extendVideoWithVeo31KieInternal(options = {}) {
  const callbackUrl = getKieCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[KIE/veo31-extend] Callback URL is required (set KIE_CALLBACK_URL / CALLBACK_BASE_URL)");
  }
  const endpoint = KIE_VIDEO_MODEL_CATALOG.veo31.extend.endpoint;
  const model = options.speed === "quality" ? "quality" : "fast";
  const requestBody = {
    model,
    callBackUrl: callbackUrl,
    taskId: String(options.originalTaskId || ""),
    prompt: String(options.prompt || ""),
    duration: String(options.duration || "8"),
  };
  if (!requestBody.taskId) {
    throw new Error("Veo extend requires original task id.");
  }
  const taskId = await kiePostJson(endpoint, requestBody, "veo31-extend");
  if (typeof options.onTaskSubmitted === "function") {
    try { await options.onTaskSubmitted(taskId); } catch {}
  }
  return { success: true, deferred: true, taskId };
}

// ─── Public API — all go through the queue ────────────────────────────────────

export function generateImageWithSeedreamKie(...args) {
  return enqueueKieJob(() => generateImageWithSeedreamKieInternal(...args));
}
export function generateImageWithIdentityKie(...args) {
  return enqueueKieJob(() => generateImageWithIdentityKieInternal(...args));
}
export function generateImageWithNanoBananaKie(...args) {
  return enqueueKieJob(() => generateImageWithNanoBananaKieInternal(...args));
}
export function generateTextToImageNanoBananaKie(...args) {
  return enqueueKieJob(() => generateTextToImageNanoBananaKieInternal(...args));
}
export function generateVideoWithMotionKie(...args) {
  return enqueueKieJob(() => generateVideoWithMotionKieInternal(...args));
}
export function generateVideoWithKling26Kie(...args) {
  return enqueueKieJob(() => generateVideoWithKling26KieInternal(...args));
}
export function generateVideoWithWanAnimateMoveKie(...args) {
  return enqueueKieJob(() => generateVideoWithWanAnimateMoveKieInternal(...args));
}
export function generateVideoWithWanAnimateReplaceKie(...args) {
  return enqueueKieJob(() => generateVideoWithWanAnimateReplaceKieInternal(...args));
}
export function generateVideoWithSora2ProKie(...args) {
  return enqueueKieJob(() => generateVideoWithSora2ProKieInternal(...args));
}
export function generateVideoWithKlingTextKie(...args) {
  return enqueueKieJob(() => generateVideoWithKlingTextKieInternal(...args));
}
export function generateVideoWithVeo31Kie(...args) {
  return enqueueKieJob(() => generateVideoWithVeo31KieInternal(...args));
}
export function extendVideoWithVeo31Kie(...args) {
  return enqueueKieJob(() => extendVideoWithVeo31KieInternal(...args));
}
