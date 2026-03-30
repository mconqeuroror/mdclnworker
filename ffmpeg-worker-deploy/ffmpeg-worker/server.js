/**
 * FFmpeg worker service — runs on Hetzner (or any server with ffmpeg + exiftool).
 * Receives repurpose jobs from the main app (Railway), runs processVideoBatch/processImageBatch,
 * uploads outputs to R2 via presigned PUT URLs, or to Vercel Blob when vercelBlobOutput + outputBlobPrefix + BLOB_READ_WRITE_TOKEN (Content Studio).
 *
 * Run from repo root: node ffmpeg-worker/server.js
 * Requires: FFMPEG_WORKER_API_KEY, PORT (default 3100)
 *
 * Optional: callbackUrl + callbackSecret — after the job finishes, POST same JSON as /job response
 * (plus jobRef if sent) to callbackUrl so modelclone can update DB without polling.
 */
import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { processVideoBatch, processImageBatch, checkFfmpegAvailable } from "../src/services/video-repurpose.service.js";

const app = express();
const PORT = Number(process.env.PORT) || 3100;
const API_KEY = process.env.FFMPEG_WORKER_API_KEY;

const JSON_LIMIT = process.env.FFMPEG_WORKER_JSON_LIMIT || "4mb";
app.use(express.json({ limit: JSON_LIMIT }));

function requireAuth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query?.apiKey;
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized", message: "Invalid or missing X-API-Key" });
  }
  next();
}

async function downloadToFile(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(new URL(url).pathname) || ".bin";
  const tmp = path.join(os.tmpdir(), `ffmpeg-worker-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

async function uploadToPutUrl(putUrl, filePath, contentType) {
  const body = fs.readFileSync(filePath);
  const res = await fetch(putUrl, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType || "application/octet-stream" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
  }
}

const BLOB_PREFIX_RE = /^content-studio\/[a-zA-Z0-9/_\-]+$/;

/**
 * Upload encoded files to Vercel Blob (same BLOB_READ_WRITE_TOKEN as your Content Studio app on Vercel).
 * Run worker from modelclone repo root so @vercel/blob resolves from node_modules.
 */
async function uploadOutputsToVercelBlob(outputs, outputBlobPrefix, isImage) {
  const { put } = await import("@vercel/blob");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set on the worker");
  const base = outputBlobPrefix.replace(/\/$/, "");
  const urls = [];
  for (let i = 0; i < outputs.length; i++) {
    const filePath = outputs[i].absolutePath;
    const buf = fs.readFileSync(filePath);
    const ext =
      path.extname(filePath).replace(/^\./, "").toLowerCase() ||
      (isImage ? "jpg" : "mp4");
    const ct =
      ext === "png" ? "image/png" :
      ext === "webp" ? "image/webp" :
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
      ext === "webm" ? "video/webm" : "video/mp4";
    const pathname = `${base}/out_${i}.${ext}`;
    const blob = await put(pathname, buf, { access: "public", token, contentType: ct });
    urls.push(blob.url);
  }
  return urls;
}

/** Forward FFmpeg progress to main app (same X-API-Key as incoming requests). */
function createProgressForwarder(progressUrl, jobRef, apiKey) {
  if (!progressUrl || !/^https?:\/\//i.test(String(progressUrl).trim())) return () => {};
  const jobId = typeof jobRef === "object" && jobRef?.jobId ? jobRef.jobId : null;
  if (!jobId || !apiKey) return () => {};
  let lastPct = -1;
  let lastSent = 0;
  return (percent, message) => {
    const p = Number(percent);
    const scaled = Math.max(8, Math.min(94, Math.round(22 + (Number.isFinite(p) ? p : 0) / 100 * 72)));
    const now = Date.now();
    if (scaled === lastPct && now - lastSent < 800) return;
    if (now - lastSent < 280 && Math.abs(scaled - lastPct) < 1) return;
    lastPct = scaled;
    lastSent = now;
    void fetch(String(progressUrl).trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        jobId,
        progress: scaled,
        message: typeof message === "string" ? message.slice(0, 220) : "Processing…",
      }),
    }).catch(() => {});
  };
}

async function postProgressOnce(progressUrl, apiKey, jobId, progress, message) {
  if (!progressUrl || !jobId || !apiKey) return;
  try {
    await fetch(String(progressUrl).trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ jobId, progress, message: message.slice(0, 220) }),
    });
  } catch {
    /* ignore */
  }
}

const CALLBACK_TIMEOUT_MS = Math.min(
  300_000,
  Math.max(5_000, Number(process.env.FFMPEG_WORKER_CALLBACK_TIMEOUT_MS) || 120_000),
);

/**
 * Fire-and-forget: notify modelclone (or n8n) when job completes — same payload shape as HTTP response.
 */
async function fireCallback(callbackUrl, callbackSecret, payload) {
  if (!callbackUrl || typeof callbackUrl !== "string") return;
  const u = callbackUrl.trim();
  if (!/^https?:\/\//i.test(u)) {
    console.warn("[callback] skipped: invalid URL");
    return;
  }
  try {
    const headers = { "Content-Type": "application/json", "User-Agent": "ffpmeg-worker/1.0" };
    if (callbackSecret != null && String(callbackSecret).length > 0) {
      headers["X-Callback-Secret"] = String(callbackSecret);
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), CALLBACK_TIMEOUT_MS);
    const r = await fetch(u, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      const txt = await r.text();
      console.warn(`[callback] ${u} → HTTP ${r.status}: ${txt.slice(0, 300)}`);
    } else {
      console.log(`[callback] ok → ${u.slice(0, 80)}…`);
    }
  } catch (err) {
    console.warn("[callback] failed:", err?.message || err);
  }
}

/**
 * POST /job
 * Body: {
 *   inputUrl, watermarkUrl?, inputStem?, settings: { copies, filters, metadata },
 *   isImage: boolean,
 *   outputPutUrls: [ { putUrl, publicUrl, contentType? }, ... ],
 *   callbackUrl?: string,      // POST result here after success/failure (non-blocking)
 *   callbackSecret?: string,   // sent as X-Callback-Secret
 *   jobRef?: string | object,  // echoed back for correlation (e.g. prisma job id)
 *   progressUrl?: string,      // POST { jobId, progress, message } during encode (X-API-Key)
 *   vercelBlobOutput?: boolean, // if true: upload to Vercel Blob (requires BLOB_READ_WRITE_TOKEN on worker + outputBlobPrefix)
 *   outputBlobPrefix?: string,  // e.g. content-studio/reformat/<generationId> — must start with content-studio/
 * }
 */
app.post("/job", requireAuth, async (req, res) => {
  const {
    inputUrl,
    watermarkUrl,
    inputStem,
    settings,
    isImage,
    outputPutUrls,
    callbackUrl,
    callbackSecret,
    jobRef,
    progressUrl,
    vercelBlobOutput,
    outputBlobPrefix,
  } = req.body || {};

  const useBlob = vercelBlobOutput === true;
  const prefixRaw = typeof outputBlobPrefix === "string" ? outputBlobPrefix.trim() : "";

  if (useBlob) {
    if (!inputUrl || !settings) {
      return res.status(400).json({ error: "Bad request", message: "inputUrl and settings are required" });
    }
    if (!prefixRaw || !BLOB_PREFIX_RE.test(prefixRaw)) {
      return res.status(400).json({
        error: "Bad request",
        message: "outputBlobPrefix must match content-studio/... (safe path for Vercel Blob)",
      });
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(503).json({
        error: "BLOB_READ_WRITE_TOKEN not set on worker",
        message: "Set the same BLOB_READ_WRITE_TOKEN as Content Studio so outputs upload to Blob",
      });
    }
  } else if (!inputUrl || !outputPutUrls?.length || !settings) {
    return res.status(400).json({ error: "Bad request", message: "inputUrl, outputPutUrls, and settings are required" });
  }

  const tempDir = path.join(os.tmpdir(), `ffmpeg-worker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  let inputPath = null;
  let watermarkPath = null;
  const safeJobRef = jobRef !== undefined ? jobRef : null;

  try {
    inputPath = await downloadToFile(inputUrl);
    if (inputStem) {
      const ext = path.extname(inputPath);
      const renamed = path.join(tempDir, `${inputStem}${ext}`);
      fs.renameSync(inputPath, renamed);
      inputPath = renamed;
    } else {
      const moved = path.join(tempDir, path.basename(inputPath));
      fs.renameSync(inputPath, moved);
      inputPath = moved;
    }

    if (watermarkUrl) {
      watermarkPath = await downloadToFile(watermarkUrl);
      const wmDest = path.join(tempDir, path.basename(watermarkPath));
      fs.renameSync(watermarkPath, wmDest);
      watermarkPath = wmDest;
    }

    const outputDir = path.join(tempDir, "out");
    fs.mkdirSync(outputDir, { recursive: true });

    const progressCb = createProgressForwarder(progressUrl, safeJobRef, API_KEY);
    const processFn = isImage ? processImageBatch : processVideoBatch;
    const outputs = await processFn(inputPath, watermarkPath || null, outputDir, settings, progressCb, { useWasm: false });

    if (!useBlob && outputs.length > outputPutUrls.length) {
      throw new Error(`Worker produced ${outputs.length} outputs but only ${outputPutUrls.length} put URLs provided`);
    }

    const jid = typeof safeJobRef === "object" && safeJobRef?.jobId ? safeJobRef.jobId : null;
    if (progressUrl && jid) {
      await postProgressOnce(progressUrl, API_KEY, jid, 96, "Uploading outputs…");
    }

    let publicUrls;
    if (useBlob) {
      publicUrls = await uploadOutputsToVercelBlob(outputs, prefixRaw, isImage);
    } else {
      const contentType = isImage ? "image/jpeg" : "video/mp4";
      for (let i = 0; i < outputs.length; i++) {
        const putSpec = outputPutUrls[i];
        const filePath = outputs[i].absolutePath;
        await uploadToPutUrl(putSpec.putUrl, filePath, putSpec.contentType || contentType);
      }
      publicUrls = outputs.map((o, i) => outputPutUrls[i].publicUrl);
    }
    const result = {
      ok: true,
      outputUrls: publicUrls,
      outputFileNames: outputs.map((o) => o.fileName),
      outputMetadataWarnings: outputs.map((o) => o?.metadata?.warnings || []),
      outputMetadataApplied: outputs.map((o) => Boolean(o?.metadata?.applied)),
      jobRef: safeJobRef,
    };
    res.json(result);
    void fireCallback(callbackUrl, callbackSecret, result);
  } catch (e) {
    console.error("FFmpeg worker job error:", e);
    const errPayload = {
      ok: false,
      error: "Job failed",
      message: e?.message || String(e),
      jobRef: safeJobRef,
    };
    if (!res.headersSent) {
      res.status(500).json(errPayload);
    }
    void fireCallback(callbackUrl, callbackSecret, errPayload);
  } finally {
    try {
      if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
});

/**
 * POST /transcode
 * Simple single-file ffmpeg transcode — no repurpose pipeline, no aspect-ratio changes.
 * Used by the main app for operations like reference-video denoise+scale, audio normalization, etc.
 *
 * Body: {
 *   inputUrl: string,
 *   vfFilter?: string,        // ffmpeg -vf value (e.g. "hqdn3d=1.5:3:6:2.5,scale=-2:720")
 *   audioOptions?: string[],  // additional audio output opts (e.g. ["-c:a","copy"])
 *   extraOptions?: string[],  // any other output opts (e.g. ["-movflags","+faststart"])
 *   outputPutUrl: { putUrl: string, publicUrl: string, contentType?: string }
 * }
 */
app.post("/transcode", requireAuth, async (req, res) => {
  const { inputUrl, vfFilter, audioOptions = [], extraOptions = [], outputPutUrl } = req.body || {};

  if (!inputUrl || !outputPutUrl?.putUrl || !outputPutUrl?.publicUrl) {
    return res.status(400).json({ ok: false, error: "Bad request", message: "inputUrl and outputPutUrl (putUrl + publicUrl) are required" });
  }

  const { execFile } = await import("child_process");
  const { promisify: prom } = await import("util");
  const execFileAsync = prom(execFile);

  const tempDir = path.join(os.tmpdir(), `transcode-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  let inputPath = null;
  const outExt = (() => {
    try { return path.extname(new URL(outputPutUrl.publicUrl).pathname) || ".mp4"; } catch { return ".mp4"; }
  })();
  const outPath = path.join(tempDir, `out${outExt}`);

  try {
    inputPath = await downloadToFile(inputUrl);
    const moved = path.join(tempDir, path.basename(inputPath));
    fs.renameSync(inputPath, moved);
    inputPath = moved;

    // Build ffmpeg args
    const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
    const args = ["-y", "-fflags", "+discardcorrupt", "-err_detect", "ignore_err", "-i", inputPath];
    if (vfFilter) args.push("-vf", vfFilter);
    if (Array.isArray(audioOptions)) args.push(...audioOptions);
    if (Array.isArray(extraOptions)) args.push(...extraOptions);
    args.push(outPath);

    console.log(`[transcode] ffmpeg ${args.join(" ")}`);
    await execFileAsync(ffmpegBin, args, { timeout: 300_000 });

    await uploadToPutUrl(outputPutUrl.putUrl, outPath, outputPutUrl.contentType || "video/mp4");

    const result = { ok: true, outputUrl: outputPutUrl.publicUrl };
    console.log(`[transcode] ✅ done → ${outputPutUrl.publicUrl.slice(0, 80)}`);
    res.json(result);
  } catch (e) {
    console.error("[transcode] error:", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});

/**
 * POST /frames
 * Extract one or more frames from a video at specific timestamps.
 *
 * Body: {
 *   inputUrl: string,
 *   timestamps: number[],
 *   outputPutUrls: [{ putUrl: string, publicUrl: string }]
 * }
 * Returns: { ok: true, frameUrls: string[] }
 */
app.post("/frames", requireAuth, async (req, res) => {
  const { inputUrl, timestamps, outputPutUrls } = req.body || {};

  if (!inputUrl || !Array.isArray(timestamps) || timestamps.length === 0 || !Array.isArray(outputPutUrls)) {
    return res.status(400).json({ ok: false, error: "Bad request", message: "inputUrl, timestamps[], and outputPutUrls[] are required" });
  }
  if (timestamps.length !== outputPutUrls.length) {
    return res.status(400).json({ ok: false, error: "Bad request", message: "timestamps and outputPutUrls must have the same length" });
  }

  const { execFile } = await import("child_process");
  const { promisify: prom } = await import("util");
  const execFileAsync = prom(execFile);

  const tempDir = path.join(os.tmpdir(), `frames-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  let inputPath = null;

  try {
    inputPath = await downloadToFile(inputUrl);
    const moved = path.join(tempDir, path.basename(inputPath));
    fs.renameSync(inputPath, moved);
    inputPath = moved;

    const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
    const frameUrls = [];

    for (let i = 0; i < timestamps.length; i++) {
      const t = Math.max(0, Number(timestamps[i]) || 0);
      const framePath = path.join(tempDir, `frame_${i}_${Date.now()}.jpg`);
      const args = [
        "-y",
        "-ss", String(t),
        "-i", inputPath,
        "-frames:v", "1",
        "-q:v", "2",
        "-vf", "scale=-2:1080",
        framePath,
      ];
      await execFileAsync(ffmpegBin, args, { timeout: 60_000 });
      await uploadToPutUrl(outputPutUrls[i].putUrl, framePath, "image/jpeg");
      frameUrls.push(outputPutUrls[i].publicUrl);
      try { fs.unlinkSync(framePath); } catch (_) {}
    }

    res.json({ ok: true, frameUrls });
  } catch (e) {
    console.error("[frames] error:", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});

app.get("/health", async (_req, res) => {
  try {
    await checkFfmpegAvailable();
    return res.json({ ok: true, service: "ffmpeg-worker" });
  } catch (e) {
    return res.status(503).json({ ok: false, error: e?.message || "FFmpeg check failed" });
  }
});

app.get("/", (_req, res) => {
  res.json({
    service: "ffmpeg-worker",
    endpoints: [
      "GET /health",
      "POST /job (X-API-Key required; optional callbackUrl, callbackSecret, jobRef)",
      "POST /transcode (X-API-Key required; inputUrl + vfFilter/audioOptions + outputPutUrl)",
      "POST /frames (X-API-Key required; inputUrl + timestamps[] + outputPutUrls[])",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`FFmpeg worker listening on port ${PORT}`);
});
