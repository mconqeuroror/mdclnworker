/**
 * PiAPI.ai client — Seedance 2 video generation.
 *
 * API reference: https://api.piapi.ai/api/v1/task
 * Auth: X-API-Key header
 *
 * Mode mapping from Creator Studio internal modes:
 *   t2v        → text_to_video
 *   i2v        → first_last_frames  (image_urls: [firstFrame])
 *   edit       → first_last_frames  (image_urls: [firstFrame, lastFrame])
 *   multi-ref  → omni_reference
 */

const PIAPI_API_KEY = process.env.PIAPI_API_KEY;
const PIAPI_BASE_URL = "https://api.piapi.ai";

function getPiapiCallbackUrl() {
  const base = process.env.PIAPI_CALLBACK_URL || process.env.CALLBACK_BASE_URL || process.env.KIE_CALLBACK_URL || "";
  if (!base) return null;
  const clean = base.replace(/\/api\/kie\/callback\/?$/, "").replace(/\/$/, "");
  return `${clean}/api/piapi/callback`;
}

/** Valid piapi aspect ratios for Seedance 2 */
const VALID_PIAPI_ASPECT_RATIOS = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"]);

function normalizePiapiAspectRatio(raw, mode) {
  if (mode === "first_last_frames") return "auto";
  const s = String(raw || "16:9");
  return VALID_PIAPI_ASPECT_RATIOS.has(s) ? s : "16:9";
}

/**
 * Maps Creator Studio mode string to piapi Seedance mode.
 * @param {string} csMode - "t2v" | "i2v" | "edit" | "multi-ref"
 */
function mapSeedanceMode(csMode) {
  switch (String(csMode || "").toLowerCase()) {
    case "i2v":
    case "edit":
      return "first_last_frames";
    case "multi-ref":
      return "omni_reference";
    case "t2v":
    default:
      return "text_to_video";
  }
}

/**
 * Submit a Seedance 2 generation task to piapi.ai.
 *
 * @param {object} options
 * @param {"t2v"|"i2v"|"edit"|"multi-ref"} options.csMode       - Creator Studio mode
 * @param {string}   options.prompt
 * @param {string}   [options.taskType]       - "seedance-2-preview" | "seedance-2-fast-preview"
 * @param {number}   [options.duration]       - integer 4–15 (default 5)
 * @param {string}   [options.aspectRatio]    - "16:9" etc.
 * @param {string}   [options.firstFrameUrl]  - used in i2v / edit / first_last_frames
 * @param {string}   [options.lastFrameUrl]   - used in edit / first_last_frames
 * @param {string[]} [options.referenceImageUrls] - for multi-ref mode
 * @param {string[]} [options.referenceVideoUrls] - for multi-ref mode
 * @param {string[]} [options.referenceAudioUrls] - for multi-ref mode (mp3/wav only, ≤15s)
 * @param {Function} [options.onTaskCreated]  - called with task_id after submit
 *
 * @returns {Promise<{ success: true, deferred: true, taskId: string }>}
 */
export async function generateSeedancePiapi(options = {}) {
  if (!PIAPI_API_KEY) {
    throw new Error("PIAPI_API_KEY is not configured.");
  }

  const callbackUrl = getPiapiCallbackUrl();
  if (!callbackUrl) {
    throw new Error("[PiAPI/Seedance] Callback URL is required (set PIAPI_CALLBACK_URL or CALLBACK_BASE_URL).");
  }

  const csMode = String(options.csMode || "t2v").toLowerCase();
  const piapiMode = mapSeedanceMode(csMode);

  // task_type mapping
  const rawType = String(options.taskType || "seedance-2").toLowerCase();
  const taskType =
    rawType === "seedance-2-fast-preview" || rawType === "seedance-2-fast"
      ? "seedance-2-fast"
      : "seedance-2";

  // Duration: integer 4–15, default 5
  const rawDuration = Number(options.duration);
  const duration = Number.isInteger(rawDuration) && rawDuration >= 4 && rawDuration <= 15
    ? rawDuration
    : 5;

  const aspectRatio = normalizePiapiAspectRatio(options.aspectRatio, piapiMode);

  // Build input payload based on mode
  const input = {
    prompt: String(options.prompt || "").trim(),
    mode: piapiMode,
    duration,
    aspect_ratio: aspectRatio,
  };

  if (piapiMode === "first_last_frames") {
    const imgs = [
      options.firstFrameUrl ? String(options.firstFrameUrl).trim() : null,
      options.lastFrameUrl ? String(options.lastFrameUrl).trim() : null,
    ].filter(Boolean);
    if (!imgs.length) {
      throw new Error("[PiAPI/Seedance] first_last_frames mode requires at least one image URL.");
    }
    input.image_urls = imgs;
  } else if (piapiMode === "omni_reference") {
    const imgs = Array.isArray(options.referenceImageUrls)
      ? options.referenceImageUrls.filter(Boolean).slice(0, 12)
      : [];
    const vids = Array.isArray(options.referenceVideoUrls)
      ? options.referenceVideoUrls.filter(Boolean).slice(0, 1)
      : [];
    const auds = Array.isArray(options.referenceAudioUrls)
      ? options.referenceAudioUrls.filter(Boolean).slice(0, 3)
      : [];

    if (imgs.length + vids.length + auds.length === 0) {
      throw new Error("[PiAPI/Seedance] omni_reference mode requires at least one image or video reference.");
    }
    if (auds.length > 0 && imgs.length === 0 && vids.length === 0) {
      throw new Error("[PiAPI/Seedance] omni_reference: audio-only is not allowed — provide at least one image or video.");
    }
    if (imgs.length) input.image_urls = imgs;
    if (vids.length) input.video_urls = vids;
    if (auds.length) input.audio_urls = auds;
  }

  const body = {
    model: "seedance",
    task_type: taskType,
    input,
    config: {
      webhook_config: {
        endpoint: callbackUrl,
        secret: "",
      },
    },
  };

  console.log(
    `[PiAPI/Seedance] Submitting task_type=${taskType} mode=${piapiMode} duration=${duration}s aspect=${aspectRatio}`,
    JSON.stringify(body).slice(0, 400),
  );

  const res = await fetch(`${PIAPI_BASE_URL}/api/v1/task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": PIAPI_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[PiAPI/Seedance] HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`[PiAPI/Seedance] Invalid JSON response: ${text.slice(0, 200)}`);
  }

  if (data.code !== 200) {
    throw new Error(`[PiAPI/Seedance] API error (code ${data.code}): ${data.message || "unknown"}`);
  }

  const taskId = data.data?.task_id;
  if (!taskId) {
    throw new Error(`[PiAPI/Seedance] No task_id in response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  console.log(`[PiAPI/Seedance] Task submitted: ${taskId} (${taskType} / ${piapiMode})`);

  if (typeof options.onTaskCreated === "function") {
    try { await options.onTaskCreated(taskId); } catch (e) {
      console.warn("[PiAPI/Seedance] onTaskCreated callback failed:", e?.message);
    }
  }

  return { success: true, deferred: true, taskId };
}
