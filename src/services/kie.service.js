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

import { isR2Configured, uploadBufferToR2 } from "../utils/r2.js";
import { IDENTITY_RECREATE_MODEL_CLOTHES } from "../constants/identityRecreationPrompts.js";

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
 * Submit a task to KIE API. Returns taskId string.
 */
async function kieCreateTask(requestBody, label = "task") {
  await waitForRateSlot(label);

  console.log(`[KIE] Submitting ${label}:`, JSON.stringify(requestBody).slice(0, 300));

  const res = await fetch(`${KIE_API_URL}/jobs/createTask`, {
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
    throw new Error(`AI service HTTP ${res.status}: ${text.slice(0, 300)}`);
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
      const r2Url      = await uploadBufferToR2(buffer, "generations", ext, finalCt);

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

  // model: "nano-banana-2" for model-pose generation (cheaper, Gemini 3.1 Flash)
  //        "nano-banana-pro" for casual/advanced generation (higher quality)
  // Both use image_input for reference images (up to 8 / 14 respectively)
  const modelName = options.model || "nano-banana-pro";
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
  const modelName = options.model || "nano-banana-pro";
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
    { forcePolling: options.forcePolling },
  );
  return result;
}

/**
 * Kling 3.0 image-to-video with motion (recreate video).
 * @param {string} imageUrl - starting frame image
 * @param {string} videoUrl - reference video for motion (passed as end frame or element)
 * @param {object} options - { prompt, duration, mode, onTaskSubmitted }
 */
async function generateVideoWithMotionKieInternal(imageUrl, videoUrl, options = {}) {
  console.log(`[KIE/kling-motion] image="${imageUrl.slice(0, 120)}"`);
  console.log(`[KIE/kling-motion] video="${videoUrl.slice(0, 120)}"`);
  const useUltraMotionControl = options.ultra === true;

  // Soft pre-flight check — warn on failure but never block; KIE validates URLs itself.
  try {
    const headRes = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    console.log(`[KIE/kling-motion] Image HEAD: ${headRes.status}, content-type: ${headRes.headers.get("content-type")}, size: ${headRes.headers.get("content-length")} bytes`);
    if (!headRes.ok) console.warn(`[KIE/kling-motion] ⚠️ Image URL HEAD ${headRes.status} — submitting anyway`);
  } catch (e) {
    console.warn(`[KIE/kling-motion] ⚠️ Image URL check timed out/failed: ${e.message} — submitting anyway`);
  }
  try {
    const videoHead = await fetch(videoUrl, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    if (!videoHead.ok) console.warn(`[KIE/kling-motion] ⚠️ Video URL HEAD ${videoHead.status} — submitting anyway`);
  } catch (e) {
    console.warn(`[KIE/kling-motion] ⚠️ Video URL check timed out/failed: ${e.message} — submitting anyway`);
  }

  const prompt = options.videoPrompt || options.prompt || "No distortion, no blur, background matches with the image source, the character's movements are consistent with the video.";

  // Model-specific mode candidates based on conflicting KIE docs/examples:
  // - kling-2.6 docs show enum 720p/1080p
  // - kling-3.0 text mentions std/pro, but examples still show 720p
  // Try the documented candidates in a sensible order per model.
  const model = useUltraMotionControl ? "kling-3.0/motion-control" : "kling-2.6/motion-control";
  const modeCandidates = useUltraMotionControl
    ? ["720p", "1080p", "pro", "std"]
    : ["1080p", "720p", "pro", "std"];
  const requestBody = {
    model,
    input: {
      prompt,
      input_urls: [imageUrl],
      video_urls: [videoUrl],
      character_orientation: "video",
      // set dynamically per candidate before submission
      mode: modeCandidates[0],
      ...(useUltraMotionControl ? { background_source: "input_video" } : {}),
    },
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
      let taskId = null;
      let lastModeErr = null;
      for (const mode of modeCandidates) {
        requestBody.input.mode = mode;
        try {
          console.log(
            `[KIE/${motionLabel}] Submitting to KIE (${useUltraMotionControl ? "ultra/3.0" : "std/2.6"}) mode=${mode} attempt ${attempt}:`,
            JSON.stringify(requestBody.input).slice(0, 220),
          );
          taskId = await kieCreateTask(requestBody, motionLabel);
          break;
        } catch (modeErr) {
          const m = String(modeErr?.message || "").toLowerCase();
          const isModeValidation =
            m.includes("mode is not within the range of allowed options") ||
            (m.includes("mode") && (m.includes("invalid") || m.includes("allowed")));
          if (isModeValidation) {
            lastModeErr = modeErr;
            console.warn(`[KIE/${motionLabel}] mode=${mode} rejected by API, trying fallback mode`);
            continue;
          }
          throw modeErr;
        }
      }
      if (!taskId) {
        throw lastModeErr || new Error("[KIE/kling-motion] all mode candidates were rejected");
      }

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
 * Kling image-to-video (2.6 or 3.0).
 * @param {string} imageUrl - starting image
 * @param {string} prompt
 * @param {object} options - { duration, useKling3, sound, onTaskCreated, forcePolling }
 */
async function generateVideoWithKling26KieInternal(imageUrl, prompt, options = {}) {
  const duration = String(options.duration || 5);
  const useKling3 = options.useKling3 === true;
  const model = useKling3 ? "kling-3.0/image-to-video" : "kling-2.6/image-to-video";
  console.log(`[KIE/kling-i2v] model=${model}, image="${imageUrl.slice(0, 80)}", duration=${duration}s`);

  const result = await kieRun(
    {
      model,
      input: {
        image_urls: [imageUrl],
        prompt,
        duration,
        sound: options.sound === true,
      },
    },
    useKling3 ? "kling-i2v-3" : "kling-i2v",
    KIE_POLL_TIMEOUT_VIDEO_MS,
    { onTaskCreated: options.onTaskCreated, forcePolling: options.forcePolling },
  );
  return result;
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
