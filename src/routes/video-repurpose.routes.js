import express from "express";
import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { spawn as spawnChild } from "child_process";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import {
  processVideoBatch,
  processImageBatch,
  probeInput,
  checkFfmpegAvailable,
  buildMetadataInstruction,
  buildMetadataInstructionsForCopies,
  buildFfmpegMetadataCommand,
  FFMPEG_BIN,
  FFPROBE_BIN,
} from "../services/video-repurpose.service.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import prisma from "../lib/prisma.js";
import { uploadToR2, isR2Configured, deleteFromR2, getR2PresignedPutForKey, getPresignedGetUrl, isBlobOnlyStorageMode } from "../utils/r2.js";
import { postRepurposeJobToWorker } from "../services/ffmpeg-worker-client.js";
import { getSafeErrorMessage } from "../utils/safe-error.js";
import { buildAiRepurposeFilters } from "../services/repurpose-ai-filters.js";
import { checkAndExpireCredits, deductCredits, getTotalCredits } from "../services/credit.service.js";
import { getPublicAppBaseUrl } from "../lib/app-public-url.js";
import { isVercelBlobConfigured, uploadBufferToBlob, mirrorToBlob } from "../utils/kieUpload.js";

const execFileAsync = promisify(execFileCb);
const MAX_VIDEO_DURATION_SEC = 60;
const router = express.Router();

// Use os.tmpdir() so on Vercel we write under /tmp (writable); process.cwd()/tmp is read-only and causes ENOENT
const STORAGE_ROOT = path.join(os.tmpdir(), "video_repurpose");
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_JOBS_PER_USER = 3;
const MAX_HISTORY_PER_USER = 20;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(STORAGE_ROOT, "uploads");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp4";
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "video") {
      const isVideo = file.mimetype.startsWith("video/");
      const isImage = ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.mimetype);
      if (!isVideo && !isImage) {
        cb(new Error("Only video or image files are allowed"));
        return;
      }
    }
    cb(null, true);
  },
});

const jobs = new Map();
const MAX_CONCURRENT = 2;
let activeCount = 0;
const waitingQueue = [];
const compareInFlightByUser = new Map();
const MAX_COMPARE_CONCURRENT_PER_USER = 1;
const MAX_COMPARE_CONCURRENT_GLOBAL = 3;
let activeCompareGlobal = 0;
const compareGlobalWaitQueue = [];
const COMPARE_WAIT_TIMEOUT_MS = 10_000;

const AI_REPURPOSE_CREDIT_COST = 10;

async function buildWorkerOutputTarget({ userId, jobId, copies, isImage }) {
  if (!isVercelBlobConfigured()) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for worker repurpose.");
  }
  return {
    vercelBlobOutput: true,
    outputBlobPrefix: `content-studio/repurpose/${userId}/${jobId}`,
  };
}

async function applyRepurposeSmartFiltersAndCharge(userId, settings, { isImage, hasAudio }) {
  if (settings.useAiOptimization !== true) return { ok: true };
  try {
    await checkAndExpireCredits(userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionCredits: true, purchasedCredits: true, credits: true },
    });
    const total = getTotalCredits(user || {});
    if (total < AI_REPURPOSE_CREDIT_COST) {
      return {
        ok: false,
        status: 402,
        error: `Smart optimization requires ${AI_REPURPOSE_CREDIT_COST} credits. You have ${total}.`,
      };
    }
    await deductCredits(userId, AI_REPURPOSE_CREDIT_COST);
    settings.filters = buildAiRepurposeFilters({ isImage, hasAudio });
    return { ok: true };
  } catch (e) {
    const msg = e?.message || "Could not deduct credits.";
    if (msg.includes("Insufficient") || msg.includes("Need")) {
      return { ok: false, status: 402, error: msg };
    }
    console.error("applyRepurposeSmartFiltersAndCharge:", e);
    return { ok: false, status: 500, error: "Credit deduction failed." };
  }
}

function acquireCompareGlobalSlot(timeoutMs = COMPARE_WAIT_TIMEOUT_MS) {
  if (activeCompareGlobal < MAX_COMPARE_CONCURRENT_GLOBAL) {
    activeCompareGlobal += 1;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const idx = compareGlobalWaitQueue.indexOf(waiter);
      if (idx >= 0) compareGlobalWaitQueue.splice(idx, 1);
      resolve(false);
    }, timeoutMs);
    compareGlobalWaitQueue.push(waiter);
  });
}

function releaseCompareGlobalSlot() {
  activeCompareGlobal = Math.max(0, activeCompareGlobal - 1);
  if (compareGlobalWaitQueue.length > 0 && activeCompareGlobal < MAX_COMPARE_CONCURRENT_GLOBAL) {
    const waiter = compareGlobalWaitQueue.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      activeCompareGlobal += 1;
      waiter.resolve(true);
    }
  }
}

function cleanupJobFiles(job) {
  try {
    if (job.outputDir && fs.existsSync(job.outputDir)) {
      fs.rmSync(job.outputDir, { recursive: true, force: true });
    }
    if (job.videoPath && fs.existsSync(job.videoPath)) fs.unlinkSync(job.videoPath);
    if (job.watermarkPath && fs.existsSync(job.watermarkPath)) fs.unlinkSync(job.watermarkPath);
  } catch {}
}

function getQueuePosition(jobId) {
  const idx = waitingQueue.findIndex((item) => item.jobId === jobId);
  return idx === -1 ? 0 : idx + 1;
}

function processNext() {
  while (activeCount < MAX_CONCURRENT && waitingQueue.length > 0) {
    const next = waitingQueue.shift();
    if (!next) break;
    const job = jobs.get(next.jobId);
    if (!job || job.status === "failed") continue;

    for (let i = 0; i < waitingQueue.length; i++) {
      const wj = jobs.get(waitingQueue[i].jobId);
      if (wj && wj.status === "queued") {
        wj.message = `Queue position: #${i + 1}`;
        wj.queuePosition = i + 1;
      }
    }

    activeCount++;
    runJob(next.jobId, next.videoPath, next.watermarkPath, next.outputDir, next.settings, next.isImage);
  }
}

async function runJob(jobId, videoPath, watermarkPath, outputDir, settings, isImage) {
  const job = jobs.get(jobId);
  if (!job) { activeCount = Math.max(0, activeCount - 1); processNext(); return; }
  job.status = "running";
  job.progress = 1;
  job.message = "Checking FFmpeg...";
  job.queuePosition = 0;
  try {
    await prisma.repurposeJob.updateMany({ where: { id: jobId }, data: { status: "running", progress: 1, message: "Checking FFmpeg..." } });
  } catch {}

  // On Vercel (or when no ffmpeg binary) use @ffmpeg/ffmpeg WASM; otherwise use system FFmpeg.
  let useWasm = process.env.VERCEL === "1";
  if (!useWasm) {
    try {
      await checkFfmpegAvailable();
    } catch (e) {
      useWasm = true;
      job.message = "Using FFmpeg WASM (no binary available)...";
    }
  } else {
    job.message = "Starting FFmpeg (WASM)...";
  }

  if (!useWasm) {
    job.message = "Starting FFmpeg...";
  }
  try {
    await prisma.repurposeJob.updateMany({ where: { id: jobId }, data: { progress: 1, message: job.message } });
  } catch {}

  const progressCb = (percent, message) => {
    const j = jobs.get(jobId);
    if (j) {
      j.progress = Math.max(0, Math.min(100, percent));
      j.message = message;
    }
  };

  try {
    const processFn = isImage ? processImageBatch : processVideoBatch;
    const outputs = await processFn(videoPath, watermarkPath, outputDir, settings, progressCb, { useWasm });
    job.status = "completed";
    job.progress = 100;
    job.message = "Done.";
    job.outputs = outputs.map((o) => ({
      file_name: o.fileName,
      download_url: `/video-repurpose/jobs/${jobId}/download/${o.fileName}`,
      metadata_warnings: o.metadata?.warnings || [],
    }));

    job._persisting = true;
    persistJobToHistory(jobId, job.userId, outputs, outputDir, settings, isImage)
      .catch((err) => console.error("Failed to persist repurpose history:", err))
      .finally(() => { const j = jobs.get(jobId); if (j) j._persisting = false; });
  } catch (e) {
    console.error("Video repurpose job failed:", e);
    job.status = "failed";
    job.message = "Processing failed.";
    job.error = e.message;
    try {
      await prisma.repurposeJob.updateMany({ where: { id: jobId }, data: { status: "failed", message: "Processing failed.", errorMessage: e?.message || "Unknown error" } });
    } catch {}
  }

  try {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
  } catch {}

  activeCount = Math.max(0, activeCount - 1);
  processNext();
}

async function persistJobToHistory(jobId, userId, outputs, outputDir, settings, isImage) {
  const useBlob = isVercelBlobConfigured();
  const useR2 = isR2Configured() && !isBlobOnlyStorageMode();
  if (!useBlob && !useR2) {
    console.warn("Storage not configured, skipping repurpose history persistence");
    return;
  }

  const uploadedOutputs = [];
  for (const o of outputs) {
    try {
      const filePath = path.join(outputDir, o.fileName);
      if (!fs.existsSync(filePath)) continue;
      const buffer = fs.readFileSync(filePath);
      const mimeType = isImage ? "image/jpeg" : "video/mp4";
      const url = useBlob
        ? await uploadBufferToBlob(buffer, o.fileName, mimeType, `content-studio/repurpose/${userId}/${jobId}`)
        : await uploadToR2(buffer, `repurpose/${userId}/${jobId}/${o.fileName}`, mimeType);
      const stats = fs.statSync(filePath);
      uploadedOutputs.push({ fileName: o.fileName, fileUrl: url, fileSize: stats.size });
    } catch (err) {
      console.error(`Failed to upload repurpose output ${o.fileName}:`, err.message);
    }
  }

  if (uploadedOutputs.length === 0) return;

  const existing = await prisma.repurposeJob.findUnique({ where: { id: jobId }, include: { outputs: true } });
  if (existing) {
    if (existing.outputs?.length > 0) return;
    await prisma.repurposeJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        message: "Done.",
        errorMessage: null,
        copies: uploadedOutputs.length,
        outputs: {
          create: uploadedOutputs.map((o) => ({
            fileName: o.fileName,
            fileUrl: o.fileUrl,
            fileSize: o.fileSize,
          })),
        },
      },
    });
    await cleanupOldHistory(userId);
    return;
  }

  await prisma.repurposeJob.create({
    data: {
      id: jobId,
      userId,
      copies: uploadedOutputs.length,
      status: "completed",
      progress: 100,
      message: "Done.",
      outputs: {
        create: uploadedOutputs.map((o) => ({
          fileName: o.fileName,
          fileUrl: o.fileUrl,
          fileSize: o.fileSize,
        })),
      },
    },
  });

  await cleanupOldHistory(userId);
}

async function cleanupOldHistory(userId) {
  try {
    const allJobs = await prisma.repurposeJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { outputs: true },
    });

    if (allJobs.length <= MAX_HISTORY_PER_USER) return;

    const toDelete = allJobs.slice(MAX_HISTORY_PER_USER);
    for (const job of toDelete) {
      for (const output of job.outputs) {
        try { await deleteFromR2(output.fileUrl); } catch {}
      }
      await prisma.repurposeJob.delete({ where: { id: job.id } });
    }
    console.log(`Cleaned up ${toDelete.length} old repurpose jobs for user ${userId}`);
  } catch (err) {
    console.error("Failed to cleanup old repurpose history:", err.message);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - new Date(job.createdAt).getTime() > JOB_TTL_MS) {
      if (job._persisting) continue;
      cleanupJobFiles(job);
      jobs.delete(id);
      const qIdx = waitingQueue.findIndex((w) => w.jobId === id);
      if (qIdx !== -1) waitingQueue.splice(qIdx, 1);
    }
  }
  try {
    const compareDir = path.join(STORAGE_ROOT, "compare");
    if (fs.existsSync(compareDir)) {
      const files = fs.readdirSync(compareDir);
      for (const file of files) {
        const filePath = path.join(compareDir, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > JOB_TTL_MS) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (e) { /* best-effort compare cleanup */ }
}, 60 * 1000);

// n8n callback: no auth (validated by secret). Must be before authMiddleware.
router.post("/n8n-callback", express.json(), async (req, res) => {
  try {
    const { jobId, status, secret, outputs, error: errorMessage } = req.body || {};
    if (secret !== process.env.N8N_CALLBACK_SECRET) {
      return res.status(401).json({ ok: false, error: "Invalid secret" });
    }
    if (!jobId || !status) {
      return res.status(400).json({ ok: false, error: "Missing jobId or status" });
    }
    const job = jobs.get(jobId);
    if (!job) {
      try {
        const db = await prisma.repurposeJob.findUnique({ where: { id: jobId }, include: { outputs: true } });
        if (!db) return res.status(404).json({ ok: false, error: "Job not found" });
        if (db.status === "completed" || db.status === "failed") {
          return res.status(200).json({ ok: true });
        }
      } catch {
        return res.status(404).json({ ok: false, error: "Job not found" });
      }
    }
    const statusMsg = status === "completed" ? "Done." : "Processing failed.";
    const outList = Array.isArray(outputs) ? outputs : [];
    const jobOutputs = outList.map((o) => ({
      file_name: o.fileName || o.file_name,
      download_url: o.fileUrl ? (o.fileUrl.startsWith("http") ? o.fileUrl : `${process.env.R2_PUBLIC_URL || ""}/${o.fileUrl}`) : null,
      metadata_warnings: o.metadata_warnings || [],
    })).filter((o) => o.file_name);
    if (job) {
      job.status = status;
      job.progress = status === "completed" ? 100 : 0;
      job.message = statusMsg;
      job.error = status === "failed" ? (errorMessage || "Processing failed.") : null;
      job.outputs = jobOutputs.length ? jobOutputs : job.outputs || [];
    }
    try {
      await prisma.repurposeJob.updateMany({
        where: { id: jobId },
        data: {
          status,
          progress: status === "completed" ? 100 : 0,
          message: statusMsg,
          errorMessage: status === "failed" ? (errorMessage || "Processing failed.") : null,
        },
      });
      if (status === "completed" && jobOutputs.length > 0) {
        const existing = await prisma.repurposeJob.findUnique({ where: { id: jobId }, include: { outputs: true } });
        if (existing && (existing.outputs?.length || 0) === 0) {
          await prisma.repurposeOutput.createMany({
            data: jobOutputs.map((o) => ({
              jobId,
              fileName: o.file_name,
              fileUrl: o.download_url || "",
              fileSize: 0,
            })),
          });
        }
      }
    } catch (e) {
      console.error("n8n callback DB update failed:", e?.message);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("n8n callback error:", e);
    return res.status(500).json({ ok: false, error: "Callback failed" });
  }
});

/**
 * FFmpeg worker → app progress (same secret as worker POST /job). No user JWT.
 * Updates DB + in-memory job map so polling GET /jobs/:jobId shows progress.
 */
router.post("/worker-progress", express.json({ limit: "64kb" }), async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"] || req.body?.secret;
    if (!process.env.FFMPEG_WORKER_API_KEY || apiKey !== process.env.FFMPEG_WORKER_API_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    const { jobId, progress, message } = req.body || {};
    if (!jobId || typeof progress !== "number") {
      return res.status(400).json({ ok: false, error: "Missing jobId or progress" });
    }
    const row = await prisma.repurposeJob.findUnique({ where: { id: jobId } });
    if (!row) return res.status(404).json({ ok: false, error: "Job not found" });
    if (row.status === "completed" || row.status === "failed") {
      return res.json({ ok: true, ignored: true });
    }
    const p = Math.max(0, Math.min(100, Math.round(progress)));
    const msg = typeof message === "string" ? message.slice(0, 500) : "Processing…";
    const j = jobs.get(jobId);
    if (j) {
      j.progress = p;
      j.message = msg;
      if (j.status === "queued") j.status = "processing";
    }
    await prisma.repurposeJob.updateMany({
      where: { id: jobId, status: { notIn: ["completed", "failed"] } },
      data: { progress: p, message: msg },
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    console.error("worker-progress error:", e?.message);
    return res.status(500).json({ ok: false, error: "Failed to record progress" });
  }
});

router.use(authMiddleware);

/** Browser (ffmpeg.wasm) flow: create job and return presigned PUT URLs so the client can process in-browser and upload. */
router.post("/prepare-browser", requireActiveSubscription, express.json(), async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  try {
    if (isBlobOnlyStorageMode()) {
      return res.status(409).json({
        ok: false,
        error: "Browser repurpose presigned uploads are disabled in Blob-only mode. Use worker-based repurpose.",
      });
    }
    if (!isR2Configured()) {
      return res.status(503).json({ ok: false, error: "Storage not configured. Browser repurpose is unavailable." });
    }
    const { settings: settingsRaw, isImage, sourceInfo: sourceInfoRaw } = req.body || {};
    let settings = {};
    try {
      settings = typeof settingsRaw === "string" ? JSON.parse(settingsRaw) : settingsRaw || {};
    } catch {}
    const copies = Math.min(5, Math.max(1, parseInt(settings.copies) || 1));
    settings.copies = copies;

    const imageMode = !!isImage;
    const sourceInfo = sourceInfoRaw && typeof sourceInfoRaw === "object" ? sourceInfoRaw : {};
    const hasAudio = sourceInfo.hasAudio !== false;

    const creditResult = await applyRepurposeSmartFiltersAndCharge(userId, settings, {
      isImage: imageMode,
      hasAudio,
    });
    if (!creditResult.ok) {
      return res.status(creditResult.status || 500).json({ ok: false, error: creditResult.error });
    }

    const metadataInstructions = buildMetadataInstructionsForCopies(settings.metadata || {}, copies);
    const metadataInstruction = metadataInstructions[0] || buildMetadataInstruction(settings.metadata || {});
    const jobId = uuidv4();
    const outputExt = imageMode ? "jpg" : "mp4";
    const contentType = imageMode ? "image/jpeg" : "video/mp4";
    const outputs = [];
    for (let i = 1; i <= copies; i++) {
      const fileName = `repurpose_${String(i).padStart(3, "0")}.${outputExt}`;
      const key = `repurpose/${userId}/${jobId}/${fileName}`;
      const { uploadUrl, publicUrl } = await getR2PresignedPutForKey(key, contentType, 3600);
      outputs.push({ fileName, uploadUrl, fileUrl: publicUrl });
    }
    jobs.set(jobId, {
      id: jobId,
      userId,
      status: "processing",
      progress: 5,
      message: "Processing in browser...",
      outputs: [],
      error: null,
      createdAt: new Date().toISOString(),
      outputDir: null,
      videoPath: null,
      watermarkPath: null,
      isImage: imageMode,
    });
    await prisma.repurposeJob.create({
      data: {
        id: jobId,
        userId,
        copies,
        status: "processing",
        progress: 5,
        message: "Processing in browser...",
      },
    });
    return res.json({
      ok: true,
      jobId,
      outputs,
      metadataInstructions,
      metadataInstruction: metadataInstruction || undefined,
      isImage: imageMode,
      filters: settings.useAiOptimization === true ? settings.filters : undefined,
      creditsCharged: settings.useAiOptimization === true ? AI_REPURPOSE_CREDIT_COST : 0,
    });
  } catch (e) {
    console.error("prepare-browser error:", e?.message);
    return res.status(500).json({ ok: false, error: e?.message || "Failed to prepare job." });
  }
});

/** Browser flow: mark job completed and register output file URLs after client uploaded to R2. */
router.post("/complete-browser", requireActiveSubscription, express.json(), async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  try {
    const { jobId, outputs: outputsRaw } = req.body || {};
    if (!jobId || !Array.isArray(outputsRaw) || outputsRaw.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing jobId or outputs." });
    }
    const job = jobs.get(jobId);
    const dbJob = await prisma.repurposeJob.findFirst({ where: { id: jobId, userId }, include: { outputs: true } });
    if (!dbJob) {
      return res.status(404).json({ ok: false, error: "Job not found." });
    }
    if (dbJob.status !== "processing") {
      return res.status(400).json({ ok: false, error: "Job is not in processing state." });
    }
    const jobOutputs = outputsRaw.map((o) => ({
      file_name: o.fileName || o.file_name,
      fileUrl: o.fileUrl || o.download_url || "",
    })).filter((o) => o.file_name && o.fileUrl);
    if (jobOutputs.length === 0) {
      return res.status(400).json({ ok: false, error: "No valid outputs." });
    }
    const outList = jobOutputs.map((o) => ({
      file_name: o.file_name,
      download_url: o.fileUrl.startsWith("http") ? o.fileUrl : `${process.env.R2_PUBLIC_URL || ""}/${o.fileUrl}`,
      metadata_warnings: [],
    }));
    if (job) {
      job.status = "completed";
      job.progress = 100;
      job.message = "Done.";
      job.error = null;
      job.outputs = outList;
    }
    await prisma.repurposeJob.updateMany({
      where: { id: jobId, userId },
      data: { status: "completed", progress: 100, message: "Done.", errorMessage: null },
    });
    await prisma.repurposeOutput.createMany({
      data: jobOutputs.map((o) => ({
        jobId,
        fileName: o.file_name,
        fileUrl: outList.find((x) => x.file_name === o.file_name)?.download_url || o.fileUrl,
        fileSize: 0,
      })),
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error("complete-browser error:", e?.message);
    return res.status(500).json({ ok: false, error: e?.message || "Failed to complete job." });
  }
});

async function downloadUrlToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: HTTP ${res.status}`);
  const dest = fs.createWriteStream(destPath);
  await pipeline(res.body, dest);
}

/** Build payload and POST to n8n webhook; throws on failure. */
async function sendRepurposeJobToN8n(req, jobId, userId, videoUrl, watermarkUrl, settings, isImage, outputsWithPresigned) {
  const webhookUrl = process.env.N8N_REPURPOSE_WEBHOOK_URL;
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (!webhookUrl || !secret) throw new Error("N8N webhook or callback secret not configured");
  const baseUrl = process.env.APP_URL || (req.protocol + "://" + req.get("host"));
  const callbackUrl = `${baseUrl.replace(/\/$/, "")}/api/video-repurpose/n8n-callback`;
  const metadataInstruction = buildMetadataInstruction(settings.metadata || {});
  const ffmpegCommand = buildFfmpegMetadataCommand(metadataInstruction);
  const body = {
    jobId,
    userId,
    fileUrl: videoUrl,
    watermarkUrl: watermarkUrl || null,
    settings,
    isImage: !!isImage,
    callbackUrl,
    secret,
    outputs: outputsWithPresigned,
    copies: settings.copies || 1,
    metadataInstruction: metadataInstruction || undefined,
    ffmpegCommand,
  };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n webhook failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function handleGenerateFromUrl(req, res, userId) {
  const { videoUrl, watermarkUrl, settings: settingsRaw } = req.body;
  let tmpVideoPath = null;
  let tmpWatermarkPath = null;
  try {
    let settings = {};
    try { settings = JSON.parse(settingsRaw || "{}"); } catch {}
    const copies = Math.min(5, Math.max(1, parseInt(settings.copies) || 1));
    settings.copies = copies;

    // N8N repurpose path disabled: metadata is always applied by us (server applyMetadata / client getMetadataArgs), not by N8N.
    if (false && process.env.REPURPOSER_MODE === "n8n" && process.env.N8N_REPURPOSE_WEBHOOK_URL && isR2Configured()) {
      const jobId = uuidv4();
      const isImage = ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes((videoUrl.split("?")[0].split(".").pop() || "").toLowerCase());
      const outputExt = isImage ? "jpg" : "mp4";
      const contentType = isImage ? "image/jpeg" : "video/mp4";
      const outputsWithPresigned = [];
      for (let i = 1; i <= copies; i++) {
        const fileName = `repurpose_${String(i).padStart(3, "0")}.${outputExt}`;
        const key = `repurpose/${userId}/${jobId}/${fileName}`;
        const { uploadUrl, publicUrl } = await getR2PresignedPutForKey(key, contentType, 3600);
        outputsWithPresigned.push({ fileName, uploadUrl, fileUrl: publicUrl });
      }
      jobs.set(jobId, {
        id: jobId, userId, status: "running", progress: 10, message: "Processing on n8n...",
        outputs: [], error: null, createdAt: new Date().toISOString(), outputDir: null, videoPath: null, watermarkPath: null, isImage,
      });
      try {
        await prisma.repurposeJob.create({
          data: { id: jobId, userId, copies, status: "running", progress: 10, message: "Processing on n8n..." },
        });
      } catch (dbErr) {
        console.warn("RepurposeJob create (n8n) failed:", dbErr?.message);
      }
      try {
        await sendRepurposeJobToN8n(req, jobId, userId, videoUrl, watermarkUrl || null, settings, isImage, outputsWithPresigned);
        return res.json({ ok: true, job_id: jobId });
      } catch (err) {
        console.error("sendRepurposeJobToN8n error:", err.message);
        const job = jobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = err.message || "Failed to send job to n8n.";
        }
        try {
          await prisma.repurposeJob.updateMany({ where: { id: jobId }, data: { status: "failed", errorMessage: err.message || "Failed to send job to n8n." } });
        } catch {}
        return res.status(500).json({ ok: false, error: err.message || "Failed to send job to n8n." });
      }
    }

    const ext = videoUrl.split("?")[0].split(".").pop()?.toLowerCase() || "mp4";
    const uploadsDir = path.join(STORAGE_ROOT, "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });
    tmpVideoPath = path.join(uploadsDir, `${uuidv4()}.${ext}`);
    await downloadUrlToFile(videoUrl, tmpVideoPath);

    if (watermarkUrl) {
      const wExt = watermarkUrl.split("?")[0].split(".").pop()?.toLowerCase() || "png";
      tmpWatermarkPath = path.join(uploadsDir, `${uuidv4()}.${wExt}`);
      await downloadUrlToFile(watermarkUrl, tmpWatermarkPath);
    }

    const isImage = ["jpg","jpeg","png","webp","gif","bmp"].includes(ext);
    let urlProbeHasAudio = true;
    if (!isImage) {
      const info = await probeInput(tmpVideoPath);
      urlProbeHasAudio = info.hasAudio !== false;
      if (info.duration > MAX_VIDEO_DURATION_SEC) {
        return res.status(400).json({ error: `Video too long. Max ${MAX_VIDEO_DURATION_SEC}s, got ${Math.round(info.duration)}s.` });
      }
    }

    const urlCredit = await applyRepurposeSmartFiltersAndCharge(userId, settings, {
      isImage,
      hasAudio: isImage ? false : urlProbeHasAudio,
    });
    if (!urlCredit.ok) {
      if (tmpVideoPath && fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
      if (tmpWatermarkPath && fs.existsSync(tmpWatermarkPath)) fs.unlinkSync(tmpWatermarkPath);
      return res.status(urlCredit.status || 500).json({ ok: false, error: urlCredit.error });
    }

    const jobId = uuidv4();
    const outputDir = path.join(STORAGE_ROOT, "outputs", jobId);
    jobs.set(jobId, {
      id: jobId, userId, status: "queued", progress: 0,
      message: "Job queued.", outputs: [], error: null,
      createdAt: new Date().toISOString(),
      outputDir, videoPath: tmpVideoPath, watermarkPath: tmpWatermarkPath, isImage,
    });
    try {
      await prisma.repurposeJob.create({
        data: { id: jobId, userId, copies: settings.copies || 1, status: "queued", progress: 0, message: "Job queued." },
      });
    } catch (dbErr) {
      console.warn("RepurposeJob create (queue) failed:", dbErr?.message);
    }
    const queueItem = { jobId, videoPath: tmpVideoPath, watermarkPath: tmpWatermarkPath, outputDir, settings, isImage };
    waitingQueue.push(queueItem);
    processNext();
    return res.json({ ok: true, job_id: jobId });
  } catch (err) {
    if (tmpVideoPath && fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
    if (tmpWatermarkPath && fs.existsSync(tmpWatermarkPath)) fs.unlinkSync(tmpWatermarkPath);
    console.error("handleGenerateFromUrl error:", err.message);
    return res.status(500).json({ ok: false, error: err.message || "Failed to process video URL." });
  }
}

async function handleGenerateWithWorkerFromUrl(req, res, userId) {
  const { videoUrl, watermarkUrl, settings: settingsRaw } = req.body || {};
  if (!isVercelBlobConfigured()) {
    return res.status(503).json({ ok: false, error: "Blob storage not configured. Set BLOB_READ_WRITE_TOKEN." });
  }
  if (!videoUrl || typeof videoUrl !== "string") {
    return res.status(400).json({ ok: false, error: "videoUrl is required." });
  }

  const uploadsDir = path.join(STORAGE_ROOT, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const ext = (videoUrl.split("?")[0].split(".").pop() || "").toLowerCase();
  const probeExt = ext || "mp4";
  const probePath = path.join(uploadsDir, `${uuidv4()}.${probeExt}`);
  let probeHasAudio = true;
  let isImage = false;

  try {
    await downloadUrlToFile(videoUrl, probePath);
    isImage = isImageByNameOrMime(videoUrl, "");
    if (!isImage) {
      const info = await probeInput(probePath);
      probeHasAudio = info.hasAudio !== false;
      if (info.duration > MAX_VIDEO_DURATION_SEC) {
        return res.status(400).json({
          ok: false,
          error: `Video is too long. Maximum allowed duration is ${MAX_VIDEO_DURATION_SEC} seconds.`,
        });
      }
    }
  } catch (e) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to validate input URL." });
  } finally {
    try { if (fs.existsSync(probePath)) fs.unlinkSync(probePath); } catch {}
  }

  let settings = {};
  try {
    settings = typeof settingsRaw === "string" ? JSON.parse(settingsRaw || "{}") : (settingsRaw || {});
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid settings JSON." });
  }
  const copies = Math.min(5, Math.max(1, parseInt(settings.copies) || 1));
  settings.copies = copies;
  const dm = settings.metadata?.device_metadata || {};
  settings.metadata = {
    ...(settings.metadata || {}),
    device_metadata: {
      ...dm,
      uniqueDevicePerCopy: dm.deviceMode === "random_unique",
    },
  };

  const creditResult = await applyRepurposeSmartFiltersAndCharge(userId, settings, {
    isImage,
    hasAudio: isImage ? false : probeHasAudio,
  });
  if (!creditResult.ok) {
    return res.status(creditResult.status || 500).json({ ok: false, error: creditResult.error });
  }

  const rawJobId = typeof req.body?.jobId === "string" ? req.body.jobId.trim() : "";
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let jobId;
  if (rawJobId && uuidRe.test(rawJobId)) {
    const dup = await prisma.repurposeJob.findUnique({ where: { id: rawJobId } });
    if (dup) return res.status(409).json({ ok: false, error: "Job id already in use." });
    jobId = rawJobId;
  } else {
    jobId = uuidv4();
  }

  await prisma.repurposeJob.create({
    data: {
      id: jobId,
      userId,
      copies,
      status: "processing",
      progress: 10,
      message: "Preparing signed URLs…",
    },
  });

  jobs.set(jobId, {
    id: jobId,
    userId,
    status: "processing",
    progress: 10,
    message: "Preparing signed URLs…",
    outputs: [],
    error: null,
    createdAt: new Date().toISOString(),
    outputDir: null,
    videoPath: null,
    watermarkPath: null,
    isImage,
  });

  const patchJobProgress = async (p, msg) => {
    const j = jobs.get(jobId);
    if (j) {
      j.progress = p;
      j.message = msg;
    }
    await prisma.repurposeJob.updateMany({
      where: { id: jobId, userId },
      data: { progress: p, message: msg.slice(0, 500) },
    }).catch(() => {});
  };

  const outputTarget = await buildWorkerOutputTarget({ userId, jobId, copies, isImage });

  await patchJobProgress(22, "Sending to FFmpeg worker…");
  const baseUrl = getPublicAppBaseUrl();
  const progressUrl = baseUrl ? `${baseUrl}/api/video-repurpose/worker-progress` : undefined;
  const effectiveInputUrl = await mirrorToBlob(videoUrl);
  const effectiveWatermarkUrl = watermarkUrl ? await mirrorToBlob(watermarkUrl) : undefined;
  const workerPayload = {
    inputUrl: effectiveInputUrl,
    watermarkUrl: effectiveWatermarkUrl,
    settings,
    isImage,
    ...outputTarget,
    jobRef: { jobId, source: "modelclone-generate-with-worker-url" },
    ...(progressUrl ? { progressUrl } : {}),
  };

  try {
    const wr = await postRepurposeJobToWorker(workerPayload);
    const outList = (wr.outputFileNames || []).map((fn, i) => {
      const fileUrl = wr.outputUrls?.[i] || "";
      return {
        file_name: fn,
        download_url: fileUrl.startsWith("http") ? fileUrl : `/video-repurpose/jobs/${jobId}/download/${fn}`,
        fileUrl,
        metadata_warnings: wr.outputMetadataWarnings?.[i] || [],
      };
    });

    jobs.set(jobId, {
      id: jobId,
      userId,
      status: "completed",
      progress: 100,
      message: "Done.",
      outputs: outList,
      error: null,
      createdAt: new Date().toISOString(),
      outputDir: null,
      videoPath: null,
      watermarkPath: null,
      isImage,
    });
    await prisma.repurposeJob.updateMany({
      where: { id: jobId, userId },
      data: { status: "completed", progress: 100, message: "Done.", errorMessage: null },
    });
    await prisma.repurposeOutput.createMany({
      data: outList.map((o, i) => ({
        jobId,
        fileName: o.file_name,
        fileUrl: wr.outputUrls?.[i] || o.fileUrl || "",
        fileSize: 0,
      })),
    });
    return res.json({ ok: true, job_id: jobId, queue_position: 0, mode: "worker", outputs: outList });
  } catch (we) {
    await prisma.repurposeJob.updateMany({
      where: { id: jobId, userId },
      data: {
        status: "failed",
        message: "Worker failed.",
        errorMessage: getSafeErrorMessage(we) || we?.message || "FFmpeg worker failed",
      },
    }).catch(() => {});
    const j = jobs.get(jobId);
    if (j) {
      j.status = "failed";
      j.progress = 0;
      j.message = "Worker failed.";
      j.error = getSafeErrorMessage(we) || we?.message || "FFmpeg worker failed.";
    }
    return res.status(502).json({ ok: false, error: getSafeErrorMessage(we) || we?.message || "FFmpeg worker failed." });
  }
}

async function requireActiveSubscription(req, res, next) {
  try {
    const userId = req.user?.id || req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true, role: true, premiumFeaturesUnlocked: true },
    });
    if (!user) {
      return res.status(403).json({ ok: false, error: "Active subscription required to use the Photo / Video Repurposer." });
    }
    if (user.role === "admin" || user.premiumFeaturesUnlocked === true) return next();
    if (user.subscriptionStatus !== "active") {
      return res.status(403).json({
        ok: false,
        error: "Active subscription required to use the Photo / Video Repurposer.",
      });
    }
    return next();
  } catch (error) {
    console.error("Subscription check error:", error);
    return res.status(500).json({ ok: false, error: "Failed to verify subscription." });
  }
}

router.post(
  "/generate",
  requireActiveSubscription,
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "watermark", maxCount: 1 },
  ]),
  async (req, res) => {
      const userId = req.user?.id || req.user?.userId;

      // URL-based input: browser uploaded to R2 via presigned URL, now passes the public URL
      if (req.body?.videoUrl && !req.files?.video?.[0]) {
        return handleGenerateFromUrl(req, res, userId);
      }

      if (!req.files?.video?.[0]) {
        return res.status(400).json({ ok: false, error: "Missing file. Please upload a video or image." });
      }

      try {
        const activeJobCount = [...jobs.values()].filter((j) => j.userId === userId && (j.status === "queued" || j.status === "running")).length;
      if (activeJobCount >= MAX_JOBS_PER_USER) {
        try {
          if (req.files.video[0].path && fs.existsSync(req.files.video[0].path)) fs.unlinkSync(req.files.video[0].path);
          if (req.files?.watermark?.[0]?.path && fs.existsSync(req.files.watermark[0].path)) fs.unlinkSync(req.files.watermark[0].path);
        } catch {}
        return res.status(429).json({ ok: false, error: `Maximum ${MAX_JOBS_PER_USER} active jobs per user. Please wait for current jobs to finish.` });
      }

      let settings;
      try {
        settings = JSON.parse(req.body.settings || "{}");
      } catch {
        try {
          if (req.files.video[0].path && fs.existsSync(req.files.video[0].path)) fs.unlinkSync(req.files.video[0].path);
          if (req.files?.watermark?.[0]?.path && fs.existsSync(req.files.watermark[0].path)) fs.unlinkSync(req.files.watermark[0].path);
        } catch {}
        return res.status(400).json({ ok: false, error: "Invalid settings JSON." });
      }

      const copies = Math.min(5, Math.max(1, parseInt(settings.copies) || 1));
      settings.copies = copies;

      const videoPath = req.files.video[0].path;
      const watermarkPath = req.files.watermark?.[0]?.path || null;
      const isImage = req.files.video[0].mimetype.startsWith("image/");
      let probeHasAudio = true;
      if (!isImage) {
        const info = await probeInput(videoPath);
        probeHasAudio = info.hasAudio !== false;
        if (info.duration > MAX_VIDEO_DURATION_SEC) {
          fs.unlinkSync(videoPath);
          if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
          return res.status(400).json({ error: `Video is too long. Maximum allowed duration is ${MAX_VIDEO_DURATION_SEC} seconds. Your video is ${Math.round(info.duration)}s.` });
        }
      }

      const creditResult = await applyRepurposeSmartFiltersAndCharge(userId, settings, {
        isImage,
        hasAudio: isImage ? false : probeHasAudio,
      });
      if (!creditResult.ok) {
        try {
          if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
          if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
        } catch {}
        return res.status(creditResult.status || 500).json({ ok: false, error: creditResult.error });
      }

      const jobId = uuidv4();
      const outputDir = path.join(STORAGE_ROOT, "outputs", jobId);

      // N8N repurpose path disabled: metadata is always applied by us (server applyMetadata), not by N8N.
      if (false && process.env.REPURPOSER_MODE === "n8n" && process.env.N8N_REPURPOSE_WEBHOOK_URL && isR2Configured()) {
        const videoExt = path.extname(req.files.video[0].originalname)?.slice(1) || (isImage ? "jpg" : "mp4");
        const inputKey = `repurpose-input/${userId}/${jobId}/input.${videoExt}`;
        const videoBuffer = fs.readFileSync(videoPath);
        const videoContentType = req.files.video[0].mimetype || (isImage ? "image/jpeg" : "video/mp4");
        const videoUrl = await uploadToR2(videoBuffer, inputKey, videoContentType);
        let watermarkUrl = null;
        if (watermarkPath && fs.existsSync(watermarkPath)) {
          const wExt = path.extname(req.files.watermark?.[0]?.originalname)?.slice(1) || "png";
          const wKey = `repurpose-input/${userId}/${jobId}/watermark.${wExt}`;
          watermarkUrl = await uploadToR2(fs.readFileSync(watermarkPath), wKey, req.files.watermark[0].mimetype || "image/png");
        }
        const outputExt = isImage ? "jpg" : "mp4";
        const contentType = isImage ? "image/jpeg" : "video/mp4";
        const outputsWithPresigned = [];
        for (let i = 1; i <= copies; i++) {
          const fileName = `repurpose_${String(i).padStart(3, "0")}.${outputExt}`;
          const key = `repurpose/${userId}/${jobId}/${fileName}`;
          const { uploadUrl, publicUrl } = await getR2PresignedPutForKey(key, contentType, 3600);
          outputsWithPresigned.push({ fileName, uploadUrl, fileUrl: publicUrl });
        }
        jobs.set(jobId, {
          id: jobId, userId, status: "running", progress: 10, message: "Processing on n8n...",
          outputs: [], error: null, createdAt: new Date().toISOString(), outputDir: null, videoPath, watermarkPath, isImage,
        });
        try {
          await prisma.repurposeJob.create({
            data: { id: jobId, userId, copies: settings.copies || 1, status: "running", progress: 10, message: "Processing on n8n..." },
          });
        } catch (dbErr) {
          console.warn("RepurposeJob create (n8n) failed:", dbErr?.message);
        }
        try {
          await sendRepurposeJobToN8n(req, jobId, userId, videoUrl, watermarkUrl, settings, isImage, outputsWithPresigned);
          try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath); } catch {}
          return res.json({ ok: true, job_id: jobId, queue_position: 0 });
        } catch (err) {
          console.error("sendRepurposeJobToN8n error:", err.message);
          jobs.get(jobId).status = "failed";
          jobs.get(jobId).error = err.message || "Failed to send job to n8n.";
          try {
            await prisma.repurposeJob.updateMany({ where: { id: jobId }, data: { status: "failed", errorMessage: err.message } });
          } catch {}
          try { if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath); } catch {}
          return res.status(500).json({ ok: false, error: err.message || "Failed to send job to n8n." });
        }
      }

      jobs.set(jobId, {
        id: jobId,
        userId,
        status: "queued",
        progress: 0,
        message: "Job queued.",
        outputs: [],
        error: null,
        createdAt: new Date().toISOString(),
        outputDir,
        videoPath,
        watermarkPath,
        isImage,
      });
      try {
        await prisma.repurposeJob.create({
          data: { id: jobId, userId, copies: settings.copies || 1, status: "queued", progress: 0, message: "Job queued." },
        });
      } catch (dbErr) {
        console.warn("RepurposeJob create (queue) failed:", dbErr?.message);
      }

      const queueItem = { jobId, videoPath, watermarkPath, outputDir, settings, isImage };
      waitingQueue.push(queueItem);

      const queuePos = waitingQueue.length;
      if (activeCount >= MAX_CONCURRENT) {
        jobs.get(jobId).message = `Queue position: #${queuePos}`;
        jobs.get(jobId).queuePosition = queuePos;
      }

      processNext();

      res.json({ ok: true, job_id: jobId, queue_position: activeCount >= MAX_CONCURRENT ? queuePos : 0 });
    } catch (e) {
      console.error("Generate error:", e);
      res.status(500).json({ ok: false, error: "Generation failed." });
    }
  },
);

/** Send job to external FFmpeg worker (ffpmeg). */
router.post(
  "/generate-with-worker",
  requireActiveSubscription,
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "watermark", maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    let videoPath = null;
    let watermarkPath = null;
    try {
      if (req.body?.videoUrl && !req.files?.video?.[0]) {
        return handleGenerateWithWorkerFromUrl(req, res, userId);
      }
      if (!isVercelBlobConfigured()) {
        return res.status(503).json({ ok: false, error: "Blob storage not configured. Set BLOB_READ_WRITE_TOKEN." });
      }
      if (!req.files?.video?.[0]) {
        return res.status(400).json({ ok: false, error: "Missing file. Upload a video or image." });
      }
      videoPath = req.files.video[0].path;
      watermarkPath = req.files.watermark?.[0]?.path || null;

      let settings = {};
      try {
        settings = JSON.parse(req.body.settings || "{}");
      } catch {
        return res.status(400).json({ ok: false, error: "Invalid settings JSON." });
      }
      const copies = Math.min(5, Math.max(1, parseInt(settings.copies) || 1));
      settings.copies = copies;
      const dm = settings.metadata?.device_metadata || {};
      settings.metadata = {
        ...(settings.metadata || {}),
        device_metadata: {
          ...dm,
          uniqueDevicePerCopy: dm.deviceMode === "random_unique",
        },
      };

      const isImage = req.files.video[0].mimetype.startsWith("image/");
      let probeHasAudio = true;
      if (!isImage) {
        const info = await probeInput(videoPath);
        probeHasAudio = info.hasAudio !== false;
        if (info.duration > MAX_VIDEO_DURATION_SEC) {
          try {
            if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
          } catch {}
          return res.status(400).json({
            ok: false,
            error: `Video is too long. Maximum allowed duration is ${MAX_VIDEO_DURATION_SEC} seconds.`,
          });
        }
      }

      const creditResult = await applyRepurposeSmartFiltersAndCharge(userId, settings, {
        isImage,
        hasAudio: isImage ? false : probeHasAudio,
      });
      if (!creditResult.ok) {
        try {
          if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
          if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
        } catch {}
        return res.status(creditResult.status || 500).json({ ok: false, error: creditResult.error });
      }

      const rawJobId = typeof req.body?.jobId === "string" ? req.body.jobId.trim() : "";
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      let jobId;
      if (rawJobId && uuidRe.test(rawJobId)) {
        const dup = await prisma.repurposeJob.findUnique({ where: { id: rawJobId } });
        if (dup) {
          return res.status(409).json({ ok: false, error: "Job id already in use." });
        }
        jobId = rawJobId;
      } else {
        jobId = uuidv4();
      }

      const videoExt = path.extname(req.files.video[0].originalname || "").replace(/^\./, "") || (isImage ? "jpg" : "mp4");
      const videoBuffer = fs.readFileSync(videoPath);
      const videoContentType = req.files.video[0].mimetype || (isImage ? "image/jpeg" : "video/mp4");
      await prisma.repurposeJob.create({
        data: {
          id: jobId,
          userId,
          copies,
          status: "processing",
          progress: 10,
          message: "Uploading to storage…",
        },
      });

      jobs.set(jobId, {
        id: jobId,
        userId,
        status: "processing",
        progress: 10,
        message: "Uploading to storage…",
        outputs: [],
        error: null,
        createdAt: new Date().toISOString(),
        outputDir: null,
        videoPath: null,
        watermarkPath: null,
        isImage,
      });

      const patchJobProgress = async (p, msg) => {
        const j = jobs.get(jobId);
        if (j) {
          j.progress = p;
          j.message = msg;
        }
        await prisma.repurposeJob.updateMany({
          where: { id: jobId, userId },
          data: { progress: p, message: msg.slice(0, 500) },
        }).catch(() => {});
      };

      await patchJobProgress(16, "Preparing storage…");
      const inputUrl = await uploadBufferToBlob(videoBuffer, `input.${videoExt}`, videoContentType, "user-uploads");

      let watermarkUrl = null;
      if (watermarkPath && fs.existsSync(watermarkPath)) {
        const wBuf = fs.readFileSync(watermarkPath);
        const wExt = path.extname(req.files.watermark?.[0]?.originalname || "").replace(/^\./, "") || "png";
        const wCt = req.files.watermark?.[0]?.mimetype || "image/png";
        watermarkUrl = await uploadBufferToBlob(wBuf, `watermark.${wExt}`, wCt, "user-uploads");
      }

      const outputTarget = await buildWorkerOutputTarget({ userId, jobId, copies, isImage });

      await patchJobProgress(22, "Sending to FFmpeg worker…");

      const baseUrl = getPublicAppBaseUrl();
      const progressUrl = baseUrl ? `${baseUrl}/api/video-repurpose/worker-progress` : undefined;

      const workerPayload = {
        inputUrl,
        watermarkUrl: watermarkUrl || undefined,
        settings,
        isImage,
        ...outputTarget,
        jobRef: { jobId, source: "modelclone-generate-with-worker" },
        ...(progressUrl ? { progressUrl } : {}),
      };

      try {
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
      } catch {
        /* ignore */
      }
      videoPath = null;
      watermarkPath = null;

      let wr;
      try {
        wr = await postRepurposeJobToWorker(workerPayload);
      } catch (we) {
        await prisma.repurposeJob.updateMany({
          where: { id: jobId, userId },
          data: {
            status: "failed",
            message: "Worker failed.",
            errorMessage: getSafeErrorMessage(we) || we?.message || "FFmpeg worker failed",
          },
        }).catch(() => {});
        const j = jobs.get(jobId);
        if (j) {
          j.status = "failed";
          j.progress = 0;
          j.message = "Worker failed.";
          j.error = getSafeErrorMessage(we) || we?.message || "FFmpeg worker failed.";
        }
        return res.status(502).json({
          ok: false,
          error: getSafeErrorMessage(we) || we?.message || "FFmpeg worker failed.",
        });
      }

      const outList = (wr.outputFileNames || []).map((fn, i) => {
        const fileUrl = wr.outputUrls?.[i] || "";
        return {
          file_name: fn,
          download_url: fileUrl.startsWith("http")
            ? fileUrl
            : `/video-repurpose/jobs/${jobId}/download/${fn}`,
          fileUrl,
          metadata_warnings: wr.outputMetadataWarnings?.[i] || [],
        };
      });

      jobs.set(jobId, {
        id: jobId,
        userId,
        status: "completed",
        progress: 100,
        message: "Done.",
        outputs: outList,
        error: null,
        createdAt: new Date().toISOString(),
        outputDir: null,
        videoPath: null,
        watermarkPath: null,
        isImage,
      });

      await prisma.repurposeJob.updateMany({
        where: { id: jobId, userId },
        data: { status: "completed", progress: 100, message: "Done.", errorMessage: null },
      });
      await prisma.repurposeOutput.createMany({
        data: outList.map((o, i) => ({
          jobId,
          fileName: o.file_name,
          fileUrl: wr.outputUrls?.[i] || o.fileUrl || "",
          fileSize: 0,
        })),
      });

      return res.json({
        ok: true,
        job_id: jobId,
        queue_position: 0,
        mode: "worker",
        outputs: outList,
      });
    } catch (e) {
      console.error("generate-with-worker error:", e?.message);
      try {
        if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        if (watermarkPath && fs.existsSync(watermarkPath)) fs.unlinkSync(watermarkPath);
      } catch {}
      return res.status(500).json({
        ok: false,
        error: getSafeErrorMessage(e) || e?.message || "Worker repurpose failed.",
      });
    }
  },
);

function getJobForUser(jobId, userId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.userId !== userId) return null;
  return job;
}

router.get("/jobs/:jobId", async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  const { jobId } = req.params;
  let job = getJobForUser(jobId, userId);
  if (job) {
    const queuePos = job.status === "queued" ? getQueuePosition(job.id) : 0;
    const message = queuePos > 0 ? `Queue position: #${queuePos}` : job.message;
    return res.json({
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        message,
        outputs: job.outputs,
        error: job.error,
        queue_position: queuePos,
      },
    });
  }
  try {
    const dbJob = await prisma.repurposeJob.findFirst({
      where: { id: jobId, userId },
      include: { outputs: { orderBy: { createdAt: "asc" } } },
    });
    if (!dbJob) return res.status(404).json({ ok: false, error: "Job not found." });
    const outputs = (dbJob.outputs || []).map((o) => ({
      file_name: o.fileName,
      download_url: `/video-repurpose/jobs/${jobId}/download/${o.fileName}`,
      fileUrl: o.fileUrl,
      metadata_warnings: [],
    }));
    return res.json({
      ok: true,
      job: {
        id: dbJob.id,
        status: dbJob.status,
        progress: dbJob.progress ?? (dbJob.status === "completed" ? 100 : 0),
        message: dbJob.message ?? (dbJob.status === "completed" ? "Done." : "Queued."),
        outputs,
        error: dbJob.errorMessage ?? null,
        queue_position: 0,
      },
    });
  } catch (e) {
    console.error("GET /jobs/:jobId DB fallback error:", e?.message);
    return res.status(500).json({ ok: false, error: "Failed to load job." });
  }
});

router.get("/jobs/:jobId/download/:fileName", async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  const { jobId, fileName } = req.params;
  const safeName = path.basename(fileName);
  const job = getJobForUser(jobId, userId);
  if (job?.outputDir) {
    const filePath = path.join(job.outputDir, safeName);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(safeName).toLowerCase();
      const imageExts = [".jpg", ".jpeg", ".png", ".webp"];
      if (imageExts.includes(ext)) {
        const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        res.setHeader("Content-Type", mime);
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
        return res.sendFile(path.resolve(filePath));
      }
      return res.download(filePath, safeName);
    }
  }
  try {
    const dbJob = await prisma.repurposeJob.findFirst({
      where: { id: jobId, userId, status: "completed" },
      include: { outputs: true },
    });
    if (!dbJob) return res.status(404).json({ ok: false, error: "Job not found." });
    const output = dbJob.outputs?.find((o) => o.fileName === safeName);
    if (!output?.fileUrl) return res.status(404).json({ ok: false, error: "File not found." });
    if (output.fileUrl.startsWith("http")) {
      return res.redirect(302, output.fileUrl);
    }
    return res.status(404).json({ ok: false, error: "File URL is invalid." });
  } catch (e) {
    console.error("Download DB fallback error:", e?.message);
    return res.status(500).json({ ok: false, error: "Download failed." });
  }
});

router.get("/history", async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const jobs = await prisma.repurposeJob.findMany({
      where: { userId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_PER_USER,
      include: { outputs: { orderBy: { createdAt: "asc" } } },
    });
    res.json({ ok: true, jobs, limit: MAX_HISTORY_PER_USER });
  } catch (e) {
    console.error("History fetch error:", e);
    res.status(500).json({ ok: false, error: "Failed to fetch history." });
  }
});

router.delete("/history/:jobId", async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const job = await prisma.repurposeJob.findFirst({
      where: { id: req.params.jobId, userId },
      include: { outputs: true },
    });
    if (!job) return res.status(404).json({ ok: false, error: "Job not found." });
    for (const output of job.outputs) {
      try { await deleteFromR2(output.fileUrl); } catch {}
    }
    await prisma.repurposeJob.delete({ where: { id: job.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("History delete error:", e);
    res.status(500).json({ ok: false, error: "Failed to delete." });
  }
});

const compareUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(STORAGE_ROOT, "compare");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safeBase = path
        .basename(file.originalname || "upload")
        .replace(/[^A-Za-z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBase}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/") || ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only video or image files are allowed"));
  },
});

async function probeVideo(filePath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v", "error",
      "-show_entries", "format=duration,size,bit_rate,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,bit_rate,sample_rate,channels",
      "-of", "json", filePath,
    ], { timeout: 15000 });
    return JSON.parse(stdout || "{}");
  } catch { return {}; }
}

async function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function computeSSIM(videoA, videoB) {
  return new Promise((resolve) => {
    const proc = spawnChild(FFMPEG_BIN, [
      "-i", videoA, "-i", videoB,
      "-lavfi", `[0:v]scale=320:240:flags=bicubic[a];[1:v]scale=320:240:flags=bicubic[b];[a][b]ssim=stats_file=-`,
      "-f", "null", "-",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", () => {
      const match = stderr.match(/All:([0-9.]+)/);
      resolve(match ? parseFloat(match[1]) : null);
    });
    proc.on("error", () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 60000);
  });
}

// Image SSIM at full native resolution (no scale — more precise for single frames)
async function computeImageSSIM(imageA, imageB) {
  return new Promise((resolve) => {
    const proc = spawnChild(FFMPEG_BIN, [
      "-i", imageA, "-i", imageB,
      "-lavfi", `[0:v][1:v]ssim=stats_file=-`,
      "-f", "null", "-",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", () => {
      const match = stderr.match(/All:([0-9.]+)/);
      resolve(match ? parseFloat(match[1]) : null);
    });
    proc.on("error", () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 30000);
  });
}

// Perceptual hash: resize both images to 32x32 grayscale, extract raw pixels, compute Hamming distance
// Lower result = more similar (0 = identical hash)
async function computePHash(filePath) {
  return new Promise((resolve) => {
    const chunks = [];
    const proc = spawnChild(FFMPEG_BIN, [
      "-i", filePath,
      "-vf", "scale=32:32:flags=lanczos,format=gray",
      "-vframes", "1",
      "-f", "rawvideo",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.on("close", () => {
      const buf = Buffer.concat(chunks);
      if (buf.length < 32) return resolve(null);
      // DCT-based pHash: compute mean, build 64-bit hash
      const pixels = Array.from(buf.slice(0, 1024)); // 32x32 = 1024 bytes
      const mean = pixels.reduce((s, v) => s + v, 0) / pixels.length;
      const bits = pixels.map((v) => (v >= mean ? 1 : 0));
      resolve(bits);
    });
    proc.on("error", () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 20000);
  });
}

function hammingDistance(bitsA, bitsB) {
  if (!bitsA || !bitsB || bitsA.length !== bitsB.length) return null;
  let diff = 0;
  for (let i = 0; i < bitsA.length; i++) if (bitsA[i] !== bitsB[i]) diff++;
  return diff / bitsA.length; // 0 = identical, 1 = completely different
}

async function computePSNR(videoA, videoB) {
  return new Promise((resolve) => {
    const proc = spawnChild(FFMPEG_BIN, [
      "-i", videoA, "-i", videoB,
      "-lavfi", `[0:v]scale=320:240:flags=bicubic[a];[1:v]scale=320:240:flags=bicubic[b];[a][b]psnr=stats_file=-`,
      "-f", "null", "-",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", () => {
      const match = stderr.match(/average:([0-9.inf]+)/);
      if (match) {
        const val = match[1] === "inf" ? Infinity : parseFloat(match[1]);
        resolve(val);
      } else resolve(null);
    });
    proc.on("error", () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 60000);
  });
}

// Image PSNR at native resolution
async function computeImagePSNR(imageA, imageB) {
  return new Promise((resolve) => {
    const proc = spawnChild(FFMPEG_BIN, [
      "-i", imageA, "-i", imageB,
      "-lavfi", `[0:v][1:v]psnr=stats_file=-`,
      "-f", "null", "-",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", () => {
      const match = stderr.match(/average:([0-9.inf]+)/);
      if (match) {
        const val = match[1] === "inf" ? Infinity : parseFloat(match[1]);
        resolve(val);
      } else resolve(null);
    });
    proc.on("error", () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 30000);
  });
}

const EXIFTOOL_PATH = process.env.EXIFTOOL_PATH || "exiftool";

async function getExifData(filePath) {
  try {
    const { stdout } = await execFileAsync(EXIFTOOL_PATH, ["-j", filePath], { timeout: 10000 });
    const arr = JSON.parse(stdout || "[]");
    return arr[0] || {};
  } catch { return {}; }
}

function computeStreamParamsSimilarity(probeA, probeB) {
  const vA = (probeA.streams || []).find((s) => s.codec_type === "video") || {};
  const vB = (probeB.streams || []).find((s) => s.codec_type === "video") || {};
  const aA = (probeA.streams || []).find((s) => s.codec_type === "audio") || {};
  const aB = (probeB.streams || []).find((s) => s.codec_type === "audio") || {};
  const fmtTagsA = probeA.format?.tags || {};
  const fmtTagsB = probeB.format?.tags || {};

  const checks = [
    [vA.profile, vB.profile],
    [vA.level, vB.level],
    [vA.r_frame_rate, vB.r_frame_rate],
    [vA.color_primaries, vB.color_primaries],
    [vA.color_transfer, vB.color_transfer],
    [vA.color_space, vB.color_space],
    [vA.color_range, vB.color_range],
    [vA.handler_name, vB.handler_name],
    [aA.sample_rate, aB.sample_rate],
    [aA.channels, aB.channels],
    [aA.handler_name, aB.handler_name],
    [fmtTagsA.creation_time, fmtTagsB.creation_time],
    [fmtTagsA.comment, fmtTagsB.comment],
    [fmtTagsA.encoder, fmtTagsB.encoder],
  ];

  let total = 0, matching = 0;
  for (const [a, b] of checks) {
    if (a !== undefined || b !== undefined) {
      total++;
      if (String(a ?? "") === String(b ?? "")) matching++;
    }
  }
  return total > 0 ? matching / total : 1.0;
}

// Image-specific stream params: dimensions, codec, color space, bit depth, pixel format
function computeImageParamsSimilarity(probeA, probeB) {
  const vA = (probeA.streams || []).find((s) => s.codec_type === "video") || {};
  const vB = (probeB.streams || []).find((s) => s.codec_type === "video") || {};
  const checks = [
    [vA.codec_name, vB.codec_name],           // jpeg vs jpeg
    [vA.width, vB.width],                      // resolution width
    [vA.height, vB.height],                    // resolution height
    [vA.pix_fmt, vB.pix_fmt],                  // pixel format (yuvj420p, rgb24, etc.)
    [vA.color_space, vB.color_space],
    [vA.color_range, vB.color_range],
    [vA.color_primaries, vB.color_primaries],
    [vA.bits_per_raw_sample, vB.bits_per_raw_sample], // bit depth
  ];
  let total = 0, matching = 0;
  for (const [a, b] of checks) {
    if (a !== undefined || b !== undefined) {
      total++;
      if (String(a ?? "") === String(b ?? "")) matching++;
    }
  }
  return total > 0 ? matching / total : 1.0;
}

function computeMetaSimilarity(exifA, exifB) {
  const keys = [
    "Make", "Model", "Software", "CreateDate", "ModifyDate",
    "GPSLatitude", "GPSLongitude", "Comment", "UserComment",
    "ColorPrimaries", "TransferCharacteristics", "MatrixCoefficients",
    "HandlerVendorID", "HandlerDescription", "CreationTime",
  ];
  let total = 0, matching = 0;
  for (const key of keys) {
    const vA = exifA[key] !== undefined ? String(exifA[key]) : null;
    const vB = exifB[key] !== undefined ? String(exifB[key]) : null;
    if (vA !== null || vB !== null) {
      total++;
      if (vA === vB) matching++;
    }
  }
  return total > 0 ? matching / total : 0.5; // 0.5 = unknown when no EXIF (avoid "100% match" when exiftool failed)
}

// Extended EXIF comparison for images — checks camera model, GPS, ICC profile, JPEG quality
function computeImageMetaSimilarity(exifA, exifB) {
  const keys = [
    "Make", "Model", "LensModel", "Software", "CreateDate", "ModifyDate",
    "DateTimeOriginal", "GPSLatitude", "GPSLongitude", "GPSAltitude",
    "Comment", "UserComment", "ImageDescription",
    "ColorSpace", "ICCProfileName", "ColorComponents",
    "XResolution", "YResolution", "ResolutionUnit",
    "ExifImageWidth", "ExifImageHeight",
    "Orientation", "Flash", "FocalLength", "FNumber", "ExposureTime",
    "ISO", "WhiteBalance", "ExposureProgram",
  ];
  let total = 0, matching = 0;
  for (const key of keys) {
    const vA = exifA[key] !== undefined ? String(exifA[key]) : null;
    const vB = exifB[key] !== undefined ? String(exifB[key]) : null;
    if (vA !== null || vB !== null) {
      total++;
      if (vA === vB) matching++;
    }
  }
  return total > 0 ? matching / total : 0.5; // 0.5 = unknown when no EXIF (avoid "100% match" when exiftool failed)
}

function isImageByNameOrMime(name = "", mime = "") {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("image/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(jpg|jpeg|png|webp)$/i.test(n);
}

function isAllowedCompareUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".r2.dev")) return true;
    if (host.includes("blob.vercel-storage.com")) return true;
    if (host.endsWith(".cloudfront.net")) return true;
    if (host.endsWith(".wavespeed.ai")) return true;
    if (host.endsWith(".replicate.delivery")) return true;
    const r2Public = process.env.R2_PUBLIC_URL;
    if (r2Public) {
      const r2Host = new URL(r2Public).hostname.toLowerCase();
      if (host === r2Host) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function buildCompareResponse(pathA, pathB, isImageComparison, nameA = "fileA", nameB = "fileB") {
  let exifA = {};
  let exifB = {};
  try {
    [exifA, exifB] = await Promise.all([getExifData(pathA), getExifData(pathB)]);
  } catch {
    exifA = {};
    exifB = {};
  }
  const [hashA, hashB, probeA, probeB] = await Promise.all([
    getFileHash(pathA),
    getFileHash(pathB),
    probeVideo(pathA),
    probeVideo(pathB),
  ]);

  const exactMatch = hashA === hashB;
  let ssim = null;
  let psnr = null;
  let pHashSimilarity = null;
  if (!exactMatch) {
    if (isImageComparison) {
      const [ssimR, psnrR, pHashA, pHashB] = await Promise.all([
        computeImageSSIM(pathA, pathB),
        computeImagePSNR(pathA, pathB),
        computePHash(pathA),
        computePHash(pathB),
      ]);
      ssim = ssimR;
      psnr = psnrR;
      const hd = hammingDistance(pHashA, pHashB);
      pHashSimilarity = hd !== null ? 1 - hd : null;
    } else {
      [ssim, psnr] = await Promise.all([
        computeSSIM(pathA, pathB),
        computePSNR(pathA, pathB),
      ]);
    }
  } else {
    ssim = 1.0;
    psnr = Infinity;
    pHashSimilarity = 1.0;
  }

  const videoA_stream = (probeA.streams || []).find((s) => s.codec_type === "video") || {};
  const videoB_stream = (probeB.streams || []).find((s) => s.codec_type === "video") || {};
  const audioA_stream = (probeA.streams || []).find((s) => s.codec_type === "audio") || {};
  const audioB_stream = (probeB.streams || []).find((s) => s.codec_type === "audio") || {};

  let sizeA = 0;
  let sizeB = 0;
  try {
    sizeA = parseInt(probeA.format?.size, 10) || (fs.existsSync(pathA) ? fs.statSync(pathA).size : 0);
    sizeB = parseInt(probeB.format?.size, 10) || (fs.existsSync(pathB) ? fs.statSync(pathB).size : 0);
  } catch {
    try { sizeA = fs.statSync(pathA).size; } catch {}
    try { sizeB = fs.statSync(pathB).size; } catch {}
  }
  const durA = parseFloat(probeA.format?.duration) || 0;
  const durB = parseFloat(probeB.format?.duration) || 0;

  const ssimScore = ssim !== null ? ssim : 0.5;
  const psnrScore = psnr === Infinity ? 1.0 : psnr === null ? 0.5 : Math.min(Math.max((psnr - 20) / 40, 0), 1);
  const durScore = (durA > 0 && durB > 0) ? 1 - Math.min(Math.abs(durA - durB) / Math.max(durA, durB), 1) : 1.0;
  const sizeScore = sizeA > 0 ? 1 - Math.min(Math.abs(sizeA - sizeB) / Math.max(sizeA, sizeB), 1) : 1.0;

  let overallSimilarity;
  let streamScore;
  let metaScore;
  if (isImageComparison) {
    const pHashScore = pHashSimilarity !== null ? pHashSimilarity : 0.5;
    metaScore = computeImageMetaSimilarity(exifA, exifB);
    streamScore = computeImageParamsSimilarity(probeA, probeB);
    overallSimilarity = exactMatch ? 1.0 : parseFloat((
      ssimScore * 0.30 + psnrScore * 0.10 + pHashScore * 0.30 + sizeScore * 0.05 + metaScore * 0.25
    ).toFixed(6));
  } else {
    streamScore = computeStreamParamsSimilarity(probeA, probeB);
    metaScore = computeMetaSimilarity(exifA, exifB);
    overallSimilarity = exactMatch ? 1.0 : parseFloat((
      ssimScore * 0.30 + psnrScore * 0.10 + durScore * 0.05 + sizeScore * 0.05 + streamScore * 0.30 + metaScore * 0.20
    ).toFixed(6));
  }

  let verdict;
  if (exactMatch) verdict = "IDENTICAL";
  else if (overallSimilarity >= 0.95) verdict = "VISUALLY_IDENTICAL";
  else if (overallSimilarity >= 0.85) verdict = "VERY_SIMILAR";
  else if (overallSimilarity >= 0.70) verdict = "SIMILAR";
  else if (overallSimilarity >= 0.50) verdict = "SOMEWHAT_SIMILAR";
  else verdict = "DIFFERENT";

  const metaDiffKeys = isImageComparison ? [
    "Make", "Model", "LensModel", "Software", "CreateDate", "ModifyDate", "DateTimeOriginal",
    "GPSLatitude", "GPSLongitude", "GPSAltitude", "Comment", "UserComment", "ImageDescription",
    "ColorSpace", "ICCProfileName", "Orientation", "Flash", "FocalLength", "FNumber", "ExposureTime", "ISO",
  ] : [
    "Make", "Model", "Software", "CreateDate", "ModifyDate", "GPSLatitude", "GPSLongitude", "Comment", "UserComment",
    "ColorPrimaries", "TransferCharacteristics", "MatrixCoefficients", "HandlerVendorID", "HandlerDescription", "CreationTime",
  ];
  const metaDiffs = [];
  for (const key of metaDiffKeys) {
    const vA = exifA[key] !== undefined ? String(exifA[key]) : null;
    const vB = exifB[key] !== undefined ? String(exifB[key]) : null;
    if (vA !== vB) metaDiffs.push({ field: key, videoA: vA, videoB: vB });
  }

  return {
    ok: true,
    comparison: {
      verdict,
      exact_match: exactMatch,
      overall_similarity: overallSimilarity,
      is_image_comparison: isImageComparison,
      scores: isImageComparison ? {
        ssim: parseFloat(ssimScore.toFixed(4)),
        psnr: parseFloat(psnrScore.toFixed(4)),
        phash: pHashSimilarity !== null ? parseFloat(pHashSimilarity.toFixed(4)) : null,
        filesize: parseFloat(sizeScore.toFixed(4)),
        metadata: parseFloat(metaScore.toFixed(4)),
      } : {
        ssim: parseFloat(ssimScore.toFixed(4)),
        psnr: parseFloat(psnrScore.toFixed(4)),
        duration: parseFloat(durScore.toFixed(4)),
        filesize: parseFloat(sizeScore.toFixed(4)),
        stream: parseFloat(streamScore.toFixed(4)),
        metadata: parseFloat(metaScore.toFixed(4)),
      },
      ssim: ssim !== null ? (ssim === 1 ? 1 : parseFloat(ssim.toFixed(6))) : null,
      psnr: psnr !== null ? (psnr === Infinity ? "inf" : parseFloat(psnr.toFixed(2))) : null,
      phash_similarity: pHashSimilarity !== null ? parseFloat(pHashSimilarity.toFixed(4)) : null,
      file: {
        videoA: { size: sizeA, hash: hashA, name: nameA },
        videoB: { size: sizeB, hash: hashB, name: nameB },
        size_diff_bytes: Math.abs(sizeA - sizeB),
        size_diff_percent: sizeA > 0 ? parseFloat((Math.abs(sizeA - sizeB) / sizeA * 100).toFixed(2)) : 0,
      },
      video: {
        videoA: {
          resolution: `${videoA_stream.width || "?"}x${videoA_stream.height || "?"}`,
          codec: videoA_stream.codec_name || "?",
          profile: videoA_stream.profile || "?",
          level: videoA_stream.level || "?",
          framerate: videoA_stream.r_frame_rate || "?",
          duration: durA,
          bitrate: parseInt(probeA.format?.bit_rate) || 0,
          color_primaries: videoA_stream.color_primaries || "?",
          color_range: videoA_stream.color_range || "?",
          handler: videoA_stream.handler_name || "?",
        },
        videoB: {
          resolution: `${videoB_stream.width || "?"}x${videoB_stream.height || "?"}`,
          codec: videoB_stream.codec_name || "?",
          profile: videoB_stream.profile || "?",
          level: videoB_stream.level || "?",
          framerate: videoB_stream.r_frame_rate || "?",
          duration: durB,
          bitrate: parseInt(probeB.format?.bit_rate) || 0,
          color_primaries: videoB_stream.color_primaries || "?",
          color_range: videoB_stream.color_range || "?",
          handler: videoB_stream.handler_name || "?",
        },
      },
      audio: {
        videoA: { codec: audioA_stream.codec_name || "none", sample_rate: audioA_stream.sample_rate || "?", channels: audioA_stream.channels || 0, handler: audioA_stream.handler_name || "?" },
        videoB: { codec: audioB_stream.codec_name || "none", sample_rate: audioB_stream.sample_rate || "?", channels: audioB_stream.channels || 0, handler: audioB_stream.handler_name || "?" },
      },
      metadata_diffs: metaDiffs,
    },
  };
}

router.post(
  "/compare",
  requireActiveSubscription,
  compareUpload.fields([
    { name: "videoA", maxCount: 1 },
    { name: "videoB", maxCount: 1 },
  ]),
  async (req, res) => {
    const files = [];
    const userId = req.user?.id || req.user?.userId;
    let lockAcquired = false;
    let globalLockAcquired = false;
    try {
      const active = compareInFlightByUser.get(userId) || 0;
      if (active >= MAX_COMPARE_CONCURRENT_PER_USER) {
        return res.status(429).json({
          ok: false,
          error: "You already have a compare job running. Please wait for it to finish.",
        });
      }
      compareInFlightByUser.set(userId, active + 1);
      lockAcquired = true;
      globalLockAcquired = await acquireCompareGlobalSlot();
      if (!globalLockAcquired) {
        return res.status(503).json({
          ok: false,
          error: "Compare system is busy. Please try again in a few seconds.",
        });
      }

      if (!req.files?.videoA?.[0] || !req.files?.videoB?.[0]) {
        try {
          if (req.files?.videoA?.[0]?.path && fs.existsSync(req.files.videoA[0].path)) fs.unlinkSync(req.files.videoA[0].path);
          if (req.files?.videoB?.[0]?.path && fs.existsSync(req.files.videoB[0].path)) fs.unlinkSync(req.files.videoB[0].path);
        } catch {}
        return res.status(400).json({ ok: false, error: "Upload two files to compare." });
      }

      const pathA = req.files.videoA[0].path;
      const pathB = req.files.videoB[0].path;
      const mimeA = req.files.videoA[0].mimetype || "";
      const mimeB = req.files.videoB[0].mimetype || "";
      const isImageA = mimeA.startsWith("image/");
      const isImageB = mimeB.startsWith("image/");
      const isImageComparison = isImageA && isImageB;
      if (isImageA !== isImageB) {
        try { if (fs.existsSync(pathA)) fs.unlinkSync(pathA); if (fs.existsSync(pathB)) fs.unlinkSync(pathB); } catch {}
        return res.status(400).json({ ok: false, error: "Compare requires two videos or two images, not one of each." });
      }
      files.push(pathA, pathB);

      const response = await buildCompareResponse(
        pathA,
        pathB,
        isImageComparison,
        req.files.videoA[0].originalname,
        req.files.videoB[0].originalname,
      );
      res.json(response);
    } catch (e) {
      console.error("Compare error:", e);
      res.status(500).json({ ok: false, error: getSafeErrorMessage(e, "Comparison failed.") });
    } finally {
      for (const f of files) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
      }
      if (globalLockAcquired) {
        releaseCompareGlobalSlot();
      }
      if (lockAcquired) {
        const current = compareInFlightByUser.get(userId) || 0;
        if (current <= 1) compareInFlightByUser.delete(userId);
        else compareInFlightByUser.set(userId, current - 1);
      }
    }
  },
);

router.post("/compare-url", requireActiveSubscription, express.json(), async (req, res) => {
  const files = [];
  const userId = req.user?.id || req.user?.userId;
  let lockAcquired = false;
  let globalLockAcquired = false;
  try {
    const active = compareInFlightByUser.get(userId) || 0;
    if (active >= MAX_COMPARE_CONCURRENT_PER_USER) {
      return res.status(429).json({ ok: false, error: "You already have a compare job running. Please wait for it to finish." });
    }
    compareInFlightByUser.set(userId, active + 1);
    lockAcquired = true;
    globalLockAcquired = await acquireCompareGlobalSlot();
    if (!globalLockAcquired) {
      return res.status(503).json({ ok: false, error: "Compare system is busy. Please try again in a few seconds." });
    }

    const { fileAUrl, fileBUrl, fileAName, fileBName, mimeA = "", mimeB = "" } = req.body || {};
    if (!fileAUrl || !fileBUrl) {
      return res.status(400).json({ ok: false, error: "fileAUrl and fileBUrl are required." });
    }
    if (!isAllowedCompareUrl(fileAUrl) || !isAllowedCompareUrl(fileBUrl)) {
      return res.status(400).json({ ok: false, error: "Unsupported compare URL host." });
    }

    const compareDir = path.join(STORAGE_ROOT, "compare");
    fs.mkdirSync(compareDir, { recursive: true });
    const pathA = path.join(compareDir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_A_${path.basename(fileAName || "fileA.mp4")}`);
    const pathB = path.join(compareDir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_B_${path.basename(fileBName || "fileB.mp4")}`);
    await downloadUrlToFile(fileAUrl, pathA);
    await downloadUrlToFile(fileBUrl, pathB);
    files.push(pathA, pathB);

    const isImageA = isImageByNameOrMime(fileAName || fileAUrl, mimeA);
    const isImageB = isImageByNameOrMime(fileBName || fileBUrl, mimeB);
    if (isImageA !== isImageB) {
      return res.status(400).json({ ok: false, error: "Compare requires two videos or two images, not one of each." });
    }

    const response = await buildCompareResponse(
      pathA,
      pathB,
      isImageA && isImageB,
      fileAName || path.basename(pathA),
      fileBName || path.basename(pathB),
    );
    return res.json(response);
  } catch (e) {
    console.error("Compare-url error:", e);
    return res.status(500).json({ ok: false, error: getSafeErrorMessage(e, "Comparison failed.") });
  } finally {
    for (const f of files) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
    if (globalLockAcquired) releaseCompareGlobalSlot();
    if (lockAcquired) {
      const current = compareInFlightByUser.get(userId) || 0;
      if (current <= 1) compareInFlightByUser.delete(userId);
      else compareInFlightByUser.set(userId, current - 1);
    }
  }
});

export default router;
