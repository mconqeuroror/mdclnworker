import { getFfmpegWorkerBaseUrls } from "../lib/ffmpeg-worker-env.js";

const WORKER_JOB_TIMEOUT_MS = Math.min(600_000, Math.max(60_000, Number(process.env.FFMPEG_WORKER_JOB_TIMEOUT_MS) || 600_000));

/**
 * POST /job to external ffpmeg worker(s). Tries FFMPEG_WORKER_URL then FFMPEG_WORKER_FALLBACK_URL.
 * @param {object} body - Same JSON as ffmpeg-worker server expects (inputUrl, settings, isImage, outputPutUrls, …)
 */
export async function postRepurposeJobToWorker(body) {
  const apiKey = process.env.FFMPEG_WORKER_API_KEY;
  if (!apiKey) {
    throw new Error("FFMPEG_WORKER_API_KEY is not configured");
  }
  const bases = getFfmpegWorkerBaseUrls();
  if (bases.length === 0) {
    throw new Error("FFMPEG_WORKER_URL (or FFMPEG_WORKER_FALLBACK_URL) is not configured");
  }
  let lastErr = null;
  for (const base of bases) {
    try {
      const url = `${base}/job`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WORKER_JOB_TIMEOUT_MS),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, message: text?.slice(0, 200) || `HTTP ${res.status}` };
      }
      if (res.ok && data.ok) {
        return { ...data, _workerBase: base };
      }
      lastErr = new Error(data.message || data.error || `Worker HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("FFmpeg worker unreachable");
}
