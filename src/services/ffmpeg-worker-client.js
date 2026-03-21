import { getFfmpegWorkerBaseUrls } from "../lib/ffmpeg-worker-env.js";

const WORKER_JOB_TIMEOUT_MS = Math.min(600_000, Math.max(60_000, Number(process.env.FFMPEG_WORKER_JOB_TIMEOUT_MS) || 600_000));

async function postToWorker(endpoint, body) {
  const apiKey = process.env.FFMPEG_WORKER_API_KEY;
  if (!apiKey) throw new Error("FFMPEG_WORKER_API_KEY is not configured");
  const bases = getFfmpegWorkerBaseUrls();
  if (bases.length === 0) throw new Error("FFMPEG_WORKER_URL (or FFMPEG_WORKER_FALLBACK_URL) is not configured");
  let lastErr = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WORKER_JOB_TIMEOUT_MS),
      });
      const text = await res.text();
      let data;
      const isHtml = text.trimStart().startsWith("<");
      try {
        data = JSON.parse(text);
      } catch {
        // HTML error page (e.g. "Cannot POST /transcode" from an old worker) — don't leak raw HTML
        data = { ok: false, message: isHtml ? `Worker HTTP ${res.status} (endpoint not found — redeploy the ffmpeg worker)` : (text?.slice(0, 200) || `HTTP ${res.status}`) };
      }
      if (res.ok && data.ok) return { ...data, _workerBase: base };
      lastErr = new Error(data.message || data.error || `Worker HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("FFmpeg worker unreachable");
}

/**
 * POST /job to external ffmpeg worker(s). Tries FFMPEG_WORKER_URL then FFMPEG_WORKER_FALLBACK_URL.
 * @param {object} body - Same JSON as ffmpeg-worker server expects (inputUrl, settings, isImage, outputPutUrls, …)
 */
export async function postRepurposeJobToWorker(body) {
  return postToWorker("job", body);
}

/**
 * POST /transcode to external ffmpeg worker — simple single-file transcode (no repurpose pipeline).
 * @param {object} body
 * @param {string}   body.inputUrl               - Source video/audio URL (must be publicly accessible)
 * @param {string}   [body.vfFilter]             - ffmpeg -vf string (e.g. "hqdn3d=1.5:3:6:2.5,scale=-2:720")
 * @param {string[]} [body.audioOptions]         - Additional ffmpeg audio output options (e.g. ["-c:a","copy"])
 * @param {string[]} [body.extraOptions]         - Any other ffmpeg output options
 * @param {{ putUrl: string, publicUrl: string, contentType?: string }} body.outputPutUrl
 *   - Presigned PUT URL to upload the transcoded result; publicUrl is returned on success
 */
export async function postTranscodeJobToWorker(body) {
  return postToWorker("transcode", body);
}
