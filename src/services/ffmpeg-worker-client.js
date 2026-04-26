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
      // Enrich the error with the URL so logs show exactly what was attempted
      const enriched = new Error(`FFmpeg worker fetch failed [${base}/${endpoint}]: ${e.message}`);
      enriched.cause = e;
      lastErr = enriched;
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

/**
 * POST /transcode with `returnBytes: true` — the worker streams the output file bytes back in
 * the HTTP response (no R2 / no presigned PUT required). Use for small-to-medium files (<~200 MB)
 * where the bytes can be held in memory on the API. Input must still be a public http(s) URL.
 *
 * @param {object} body
 * @param {string}   body.inputUrl
 * @param {string}   [body.vfFilter]
 * @param {string[]} [body.audioOptions]
 * @param {string[]} [body.extraOptions]
 * @param {string}   [body.outputContainerExt] — e.g. ".mp4" (default)
 * @returns {Promise<{ buffer: Buffer, bytes: number, workerBase: string | null }>}
 */
export async function postTranscodeJobToWorkerReturnBytes(body) {
  const apiKey = process.env.FFMPEG_WORKER_API_KEY;
  if (!apiKey) throw new Error("FFMPEG_WORKER_API_KEY is not configured");
  const bases = getFfmpegWorkerBaseUrls();
  if (bases.length === 0) throw new Error("FFMPEG_WORKER_URL (or FFMPEG_WORKER_FALLBACK_URL) is not configured");
  let lastErr = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/transcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ ...body, returnBytes: true }),
        signal: AbortSignal.timeout(WORKER_JOB_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg;
        try { msg = JSON.parse(text)?.message || JSON.parse(text)?.error; } catch {}
        if (!msg) msg = text.slice(0, 200) || `HTTP ${res.status}`;
        lastErr = new Error(`Worker HTTP ${res.status}: ${msg}`);
        continue;
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/octet-stream")) {
        const peek = await res.text().catch(() => "");
        lastErr = new Error(
          `Worker returned unexpected content-type '${ct}' (expected octet-stream). ` +
            "Redeploy the ffmpeg worker so returnBytes mode is supported: " +
            (peek ? peek.slice(0, 200) : `HTTP ${res.status}`),
        );
        continue;
      }
      const expectedLen = Number(res.headers.get("content-length") || res.headers.get("x-transcode-bytes") || 0);
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      if (expectedLen > 0 && buffer.length !== expectedLen) {
        lastErr = new Error(
          `Worker returnBytes truncated: received ${buffer.length} / expected ${expectedLen}. Likely a broken TCP connection.`,
        );
        console.warn(`[ffmpeg-worker] ${lastErr.message} (base=${base})`);
        continue;
      }
      return {
        buffer,
        bytes: buffer.length,
        workerBase: base,
      };
    } catch (e) {
      lastErr = new Error(`FFmpeg worker (returnBytes) fetch failed [${base}/transcode]: ${e.message}`);
    }
  }
  throw lastErr || new Error("FFmpeg worker unreachable (returnBytes)");
}

/**
 * POST /frames to external ffmpeg worker — extract video frames at specific timestamps.
 * @param {object}   body
 * @param {string}   body.inputUrl        - Publicly accessible video URL
 * @param {number[]} body.timestamps      - Seconds at which to extract each frame
 * @param {{ putUrl: string, publicUrl: string }[]} body.outputPutUrls
 *   - One presigned R2 PUT URL per timestamp; worker uploads each JPEG then returns publicUrls
 * @returns {{ ok: boolean, frameUrls: string[] }}
 */
export async function postFramesJobToWorker(body) {
  return postToWorker("frames", body);
}
