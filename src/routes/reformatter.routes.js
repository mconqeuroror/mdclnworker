import express from "express";
import multer from "multer";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { isR2Configured, getR2PresignedPutForKey, isBlobOnlyStorageMode } from "../utils/r2.js";
import { convertAndStoreMedia, isConvertibleMedia } from "../services/media-reformatter.service.js";
import { postFramesJobToWorker, postRepurposeJobToWorker } from "../services/ffmpeg-worker-client.js";
import { isVercelBlobConfigured, mirrorToBlob } from "../utils/kieUpload.js";

const router = express.Router();
const CONVERTER_JOB_RETENTION_DAYS = 30;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isConvertibleMedia(file)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Upload an image or video that can be converted."));
    }
  },
});

function getFileNameFromUrl(sourceUrl, fallback = "upload.bin") {
  try {
    const pathname = new URL(sourceUrl).pathname || "";
    const last = pathname.split("/").pop() || "";
    return decodeURIComponent(last) || fallback;
  } catch {
    return fallback;
  }
}

async function buildWorkerOutputTarget(userId, jobId, isVideo) {
  if (isVercelBlobConfigured()) {
    return {
      vercelBlobOutput: true,
      outputBlobPrefix: `content-studio/conversions/${userId}/${jobId}`,
    };
  }
  if (!isR2Configured()) {
    throw new Error("File storage is not configured (Blob/R2)");
  }
  const outputExt = isVideo ? "mp4" : "jpg";
  const contentType = isVideo ? "video/mp4" : "image/jpeg";
  const fileName = `converted.${outputExt}`;
  const key = `conversions/${userId}/${jobId}/${fileName}`;
  const { uploadUrl, publicUrl } = await getR2PresignedPutForKey(key, contentType, 3600);
  return {
    outputPutUrls: [{ putUrl: uploadUrl, publicUrl, contentType }],
    fallbackPublicUrl: publicUrl,
  };
}

/** Browser (ffmpeg.wasm) path: create a converter job and return presigned PUT URL so client can convert in browser and upload result. */
router.post("/prepare-browser", authMiddleware, express.json(), async (req, res) => {
  try {
    if (isBlobOnlyStorageMode()) {
      return res.status(409).json({
        success: false,
        message: "Browser conversion presign is disabled in Blob-only mode. Use /api/upload/blob + /reformatter/convert-with-worker.",
      });
    }
    if (!isR2Configured()) {
      return res.status(503).json({ success: false, message: "File storage is not configured" });
    }
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { targetExt, originalFileName } = req.body || {};
    const ext = (targetExt === "mp4" ? "mp4" : "jpg").toLowerCase();
    const contentType = ext === "mp4" ? "video/mp4" : "image/jpeg";
    const id = crypto.randomBytes(8).toString("hex");
    const key = `conversions/${userId}/${Date.now()}-${id}.${ext}`;
    const { uploadUrl, publicUrl } = await getR2PresignedPutForKey(key, contentType, 3600);

    const job = await prisma.converterJob.create({
      data: {
        userId,
        originalFileName: typeof originalFileName === "string" ? originalFileName.slice(0, 512) : null,
        status: "processing",
        outputExt: ext,
      },
    });

    return res.json({
      success: true,
      jobId: job.id,
      uploadUrl,
      publicUrl,
      outputExt: ext,
      outputContentType: contentType,
    });
  } catch (e) {
    console.error("Reformatter prepare-browser error:", e?.message);
    return res.status(500).json({ success: false, message: e?.message || "Failed to prepare upload" });
  }
});

/** Register a completed conversion (client uploaded to R2 and calls this with the final output URL). */
router.post("/register-completed", authMiddleware, express.json(), async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { jobId, outputUrl, originalFileName, outputExt } = req.body || {};
    if (!jobId || !outputUrl || typeof outputUrl !== "string" || !outputUrl.startsWith("http")) {
      return res.status(400).json({ success: false, message: "jobId and outputUrl (public URL) are required" });
    }
    const job = await prisma.converterJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) {
      return res.status(404).json({ success: false, message: "Converter job not found" });
    }
    const expiresAt = new Date(Date.now() + CONVERTER_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await prisma.converterJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        outputUrl: outputUrl.trim().slice(0, 2048),
        outputExt: outputExt || job.outputExt,
        originalFileName: typeof originalFileName === "string" ? originalFileName.slice(0, 512) : job.originalFileName,
        completedAt: new Date(),
        expiresAt,
      },
    });
    return res.json({ success: true, message: "Conversion saved", expiresAt: expiresAt.toISOString() });
  } catch (e) {
    console.error("Reformatter register-completed error:", e?.message);
    return res.status(500).json({ success: false, message: e?.message || "Failed to register" });
  }
});

/** Get presigned PUT URL to upload the **input** file (before conversion). Enables "submit and leave" flow. */
router.post("/prepare-input", authMiddleware, express.json(), async (req, res) => {
  try {
    if (isBlobOnlyStorageMode()) {
      return res.status(409).json({
        success: false,
        message: "Input presign is disabled in Blob-only mode. Upload with /api/upload/blob.",
      });
    }
    if (!isR2Configured()) {
      return res.status(503).json({ success: false, message: "File storage is not configured" });
    }
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { originalFileName } = req.body || {};
    const name = typeof originalFileName === "string" && originalFileName.trim() ? originalFileName.trim() : "upload";
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase().replace("jpeg", "jpg") : "bin";
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : "bin";
    const contentType = req.body?.contentType || (safeExt === "mp4" || safeExt === "mov" ? "video/mp4" : "application/octet-stream");
    const id = crypto.randomBytes(8).toString("hex");
    const key = `conversions/${userId}/input/${Date.now()}-${id}.${safeExt}`;
    const { uploadUrl, publicUrl } = await getR2PresignedPutForKey(key, contentType, 3600);
    return res.json({ success: true, uploadUrl, publicUrl, key, originalFileName: name });
  } catch (e) {
    console.error("Reformatter prepare-input error:", e?.message);
    return res.status(500).json({ success: false, message: e?.message || "Failed to prepare upload" });
  }
});

/**
 * Run conversion via external FFmpeg worker (ffpmeg). Same upload flow as convert-background
 * but processing happens on the worker using repurposer pipelines (best for mp4/mov; exotic codecs may fail).
 */
router.post("/convert-with-worker", authMiddleware, express.json(), async (req, res) => {
  try {
    if (!isVercelBlobConfigured() && !isR2Configured()) {
      return res.status(503).json({ success: false, message: "File storage is not configured (Blob/R2)" });
    }
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { inputUrl: inputUrlRaw, originalFileName } = req.body || {};
    if (!inputUrlRaw || typeof inputUrlRaw !== "string" || !inputUrlRaw.startsWith("http")) {
      return res.status(400).json({ success: false, message: "inputUrl (public URL of uploaded file) is required" });
    }
    const name = typeof originalFileName === "string" ? originalFileName : "upload";
    const lower = name.toLowerCase();
    const isVideo = /\.(mov|mp4|m4v|avi|mkv|wmv|flv|webm|mpeg|mpg|3gp)$/.test(lower);
    const isImage = !isVideo;

    const job = await prisma.converterJob.create({
      data: {
        userId,
        originalFileName: name.slice(0, 512),
        status: "processing",
      },
    });

    // Respond immediately so the client can show "Processing" in history if the user leaves the tab.
    // Worker runs in the background (same pattern as convert-background).
    res.json({
      success: true,
      jobId: job.id,
      message: "Conversion started. You can leave this page — check Conversion history for progress.",
    });

    void (async () => {
      try {
        const outputExt = isVideo ? "mp4" : "jpg";
        const target = await buildWorkerOutputTarget(userId, job.id, isVideo);
        const workerInputUrl = isVercelBlobConfigured()
          ? await mirrorToBlob(inputUrlRaw.trim())
          : inputUrlRaw.trim();

        const wr = await postRepurposeJobToWorker({
          inputUrl: workerInputUrl,
          isImage,
          settings: { copies: 1, filters: {}, metadata: {} },
          ...(target.outputPutUrls ? { outputPutUrls: target.outputPutUrls } : {}),
          ...(target.vercelBlobOutput ? { vercelBlobOutput: true, outputBlobPrefix: target.outputBlobPrefix } : {}),
          jobRef: { converterJobId: job.id, source: "reformatter-convert-with-worker" },
        });

        const outUrl = wr.outputUrls?.[0] || target.fallbackPublicUrl || "";
        const expiresAt = new Date(Date.now() + CONVERTER_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await prisma.converterJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            outputUrl: outUrl,
            outputExt,
            completedAt: new Date(),
            expiresAt,
          },
        });
      } catch (inner) {
        const msg = (inner?.message || "Worker failed").slice(0, 500);
        console.error("Reformatter convert-with-worker async error:", inner?.message);
        await prisma.converterJob.update({
          where: { id: job.id },
          data: { status: "failed", errorMessage: msg, completedAt: new Date() },
        }).catch(() => {});
      }
    })();
  } catch (e) {
    console.error("Reformatter convert-with-worker error:", e?.message);
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to start conversion.",
    });
  }
});

/**
 * Extract the first video frame as JPEG using the external FFmpeg worker.
 * Free utility tool (no credits); output is persisted in conversion history.
 */
router.post("/extract-first-frame", authMiddleware, express.json(), async (req, res) => {
  try {
    if (!isVercelBlobConfigured() && !isR2Configured()) {
      return res.status(503).json({ success: false, message: "File storage is not configured (Blob/R2)" });
    }
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { inputUrl: inputUrlRaw, originalFileName } = req.body || {};
    if (!inputUrlRaw || typeof inputUrlRaw !== "string" || !inputUrlRaw.startsWith("http")) {
      return res.status(400).json({ success: false, message: "inputUrl (public URL of uploaded file) is required" });
    }
    const name = typeof originalFileName === "string" ? originalFileName : "video";
    const lower = name.toLowerCase();
    const isVideo = /\.(mov|mp4|m4v|avi|mkv|wmv|flv|webm|mpeg|mpg|3gp)$/.test(lower);
    if (!isVideo) {
      return res.status(400).json({ success: false, message: "Only video files are supported for first-frame extraction." });
    }

    const job = await prisma.converterJob.create({
      data: {
        userId,
        originalFileName: name.slice(0, 512),
        status: "processing",
        outputExt: "jpg",
      },
    });

    try {
      const target = isVercelBlobConfigured()
        ? {
            vercelBlobOutput: true,
            outputBlobPrefix: `content-studio/conversions/${userId}/${job.id}/first-frame`,
            fallbackPublicUrl: null,
          }
        : (() => {
            const key = `conversions/${userId}/${job.id}/first-frame.jpg`;
            return getR2PresignedPutForKey(key, "image/jpeg", 3600).then(({ uploadUrl, publicUrl }) => ({
              outputPutUrls: [{ putUrl: uploadUrl, publicUrl }],
              fallbackPublicUrl: publicUrl,
            }));
          })();
      const resolvedTarget = await target;
      const workerInputUrl = isVercelBlobConfigured() ? await mirrorToBlob(inputUrlRaw.trim()) : inputUrlRaw.trim();

      const wr = await postFramesJobToWorker({
        inputUrl: workerInputUrl,
        timestamps: [0],
        ...(resolvedTarget.outputPutUrls ? { outputPutUrls: resolvedTarget.outputPutUrls } : {}),
        ...(resolvedTarget.vercelBlobOutput
          ? { vercelBlobOutput: true, outputBlobPrefix: resolvedTarget.outputBlobPrefix }
          : {}),
        jobRef: { converterJobId: job.id, source: "reformatter-first-frame" },
      });
      const outUrl = wr?.frameUrls?.[0] || resolvedTarget.fallbackPublicUrl || "";
      if (!outUrl) {
        throw new Error("Worker finished but no frame URL was returned");
      }

      const expiresAt = new Date(Date.now() + CONVERTER_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await prisma.converterJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          outputUrl: outUrl,
          outputExt: "jpg",
          completedAt: new Date(),
          expiresAt,
        },
      });

      return res.json({
        success: true,
        jobId: job.id,
        outputUrl: outUrl,
        outputExt: "jpg",
        message: "First frame extracted successfully.",
      });
    } catch (inner) {
      const msg = (inner?.message || "First frame extraction failed").slice(0, 500);
      await prisma.converterJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: msg, completedAt: new Date() },
      }).catch(() => {});
      throw inner;
    }
  } catch (e) {
    console.error("Reformatter extract-first-frame error:", e?.message);
    return res.status(500).json({ success: false, message: e?.message || "Failed to extract first frame." });
  }
});

/** Start conversion on the server (runs in background so user can leave). Requires FFmpeg on the server. */
router.post("/convert-background", authMiddleware, express.json(), async (req, res) => {
  try {
    if (!isVercelBlobConfigured() && !isR2Configured()) {
      return res.status(503).json({ success: false, message: "File storage is not configured" });
    }
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { inputUrl, originalFileName } = req.body || {};
    if (!inputUrl || typeof inputUrl !== "string" || !inputUrl.startsWith("http")) {
      return res.status(400).json({ success: false, message: "inputUrl (public URL of uploaded file) is required" });
    }
    const job = await prisma.converterJob.create({
      data: {
        userId,
        originalFileName: typeof originalFileName === "string" ? originalFileName.slice(0, 512) : null,
        status: "processing",
      },
    });
    res.json({ success: true, jobId: job.id, message: "Conversion started. You can leave this page and check Conversion history." });

    (async () => {
      try {
        const response = await fetch(inputUrl.trim(), { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`Failed to fetch input: HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
        const file = {
          buffer,
          originalname: originalFileName || "upload",
          mimetype: contentType,
          size: buffer.length,
        };
        if (!isConvertibleMedia(file)) {
          throw new Error("Unsupported file type for conversion");
        }
        const result = await convertAndStoreMedia(file, { folder: "conversions" });
        const expiresAt = new Date(Date.now() + CONVERTER_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await prisma.converterJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            outputUrl: result.outputUrl,
            outputExt: result.convertedFormat,
            completedAt: new Date(),
            expiresAt,
          },
        });
      } catch (err) {
        console.error("Reformatter convert-background error:", err?.message);
        let msg = err?.message || "Conversion failed";
        if (/ENOENT|not found|ffmpeg|ffprobe/i.test(msg)) {
          msg = "Server conversion is not available on this deployment (FFmpeg required). Use “Convert in browser” and keep the tab open.";
        }
        await prisma.converterJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            errorMessage: msg.slice(0, 500),
            completedAt: new Date(),
          },
        }).catch(() => {});
      }
    })();
  } catch (e) {
    console.error("Reformatter convert-background error:", e?.message);
    return res.status(500).json({ success: false, message: e?.message || "Failed to start conversion" });
  }
});

/** Poll status of a converter job (for "submit and leave" flow). */
router.get("/status/:jobId", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const job = await prisma.converterJob.findFirst({
      where: { id: req.params.jobId, userId },
      select: { id: true, status: true, outputUrl: true, outputExt: true, originalFileName: true, errorMessage: true, completedAt: true, expiresAt: true },
    });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    return res.json({ success: true, job });
  } catch (e) {
    console.error("Reformatter status error:", e?.message);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get status" });
  }
});

/** List converter job history for the current user (outputs kept for ~1 month). */
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const cursor = req.query.cursor || undefined;
    const jobs = await prisma.converterJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        originalFileName: true,
        outputUrl: true,
        outputExt: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
        expiresAt: true,
      },
    });
    const hasMore = jobs.length > limit;
    const list = hasMore ? jobs.slice(0, limit) : jobs;
    const nextCursor = hasMore ? list[list.length - 1].id : null;
    return res.json({ success: true, jobs: list, nextCursor });
  } catch (e) {
    console.error("Reformatter history error:", e?.message);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load history" });
  }
});

router.post("/convert", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!isVercelBlobConfigured() && !isR2Configured()) {
      return res.status(503).json({
        success: false,
        message: "File storage is not configured",
      });
    }

    let inputFile = req.file || null;

    // JSON flow for large files:
    // upload directly to R2 first, then send sourceUrl here for conversion.
    if (!inputFile && req.body?.sourceUrl) {
      const sourceUrl = String(req.body.sourceUrl).trim();
      const sourceMime = String(req.body.sourceMime || "").toLowerCase().trim();
      const fileName = String(req.body.fileName || "").trim() || getFileNameFromUrl(sourceUrl);

      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) {
        return res.status(400).json({
          success: false,
          message: `Failed to download source file (HTTP ${response.status})`,
        });
      }

      const contentType = sourceMime || String(response.headers.get("content-type") || "").toLowerCase();
      const buffer = Buffer.from(await response.arrayBuffer());
      inputFile = {
        originalname: fileName,
        mimetype: contentType || "application/octet-stream",
        size: buffer.length,
        buffer,
      };
    }

    if (!inputFile) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Provide multipart file or sourceUrl.",
      });
    }

    if (!isConvertibleMedia(inputFile)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported file type. Upload an image or video that can be converted.",
      });
    }

    const result = await convertAndStoreMedia(inputFile, { folder: "conversions" });
    return res.json(result);
  } catch (error) {
    console.error("Content reformatter error:", error);
    return res.status(400).json({
      success: false,
      message: error?.message || "Failed to convert file",
    });
  }
});

export default router;
