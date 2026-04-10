import express from "express";
import multer from "multer";
import prisma from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { uploadFileToR2, deleteFromR2, isR2Configured } from "../utils/r2.js";
import {
  validateGenerationUploadFull,
  sendUploadGuardResponse,
} from "../lib/generationUploadGuards.js";
import {
  getBlobClientUploadMaxBytes,
  formatBlobUploadMaxForMessage,
} from "../config/blobUpload.js";

const router = express.Router();

const ALLOWED_DRAFT_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/x-mp4", "video/quicktime", "video/webm",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getBlobClientUploadMaxBytes() },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_DRAFT_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else if (file.mimetype?.startsWith("video/")) {
      cb(null, true);
    } else if (file.mimetype === "application/octet-stream" && /\.(mp4|mov|webm|m4v)$/i.test(file.originalname || "")) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed.`));
    }
  },
});

const VALID_FEATURES = ["generate-image", "generate-video", "nsfw", "nsfw-img2img", "repurposer", "prompt-image"];

// PostgreSQL stores data as Json (already an object) and imageUrls as String[]
// Keep deserializeDraft for forward compatibility — handles both native PG types and legacy string-serialized values
function deserializeDraft(draft) {
  if (!draft) return null;
  return {
    ...draft,
    data: typeof draft.data === "string" ? JSON.parse(draft.data) : draft.data,
    imageUrls: Array.isArray(draft.imageUrls)
      ? draft.imageUrls
      : typeof draft.imageUrls === "string"
        ? JSON.parse(draft.imageUrls)
        : [],
  };
}

router.get("/:feature", authMiddleware, async (req, res) => {
  try {
    const { feature } = req.params;
    if (!VALID_FEATURES.includes(feature)) {
      return res.status(400).json({ success: false, message: "Invalid feature" });
    }

    const draft = await prisma.draftTask.findUnique({
      where: { userId_feature: { userId: req.user.userId, feature } },
    });

    res.json({ success: true, draft: deserializeDraft(draft) });
  } catch (error) {
    console.error("Error fetching draft:", error);
    res.status(500).json({ success: false, message: "Failed to fetch draft" });
  }
});

router.put("/:feature", authMiddleware, async (req, res) => {
  try {
    const { feature } = req.params;
    if (!VALID_FEATURES.includes(feature)) {
      return res.status(400).json({ success: false, message: "Invalid feature" });
    }

    const { data, imageUrls } = req.body;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ success: false, message: "data is required and must be an object" });
    }

    const draft = await prisma.draftTask.upsert({
      where: { userId_feature: { userId: req.user.userId, feature } },
      create: {
        userId: req.user.userId,
        feature,
        data: data,
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      },
      update: {
        data: data,
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      },
    });

    res.json({ success: true, draft: deserializeDraft(draft) });
  } catch (error) {
    console.error("Error saving draft:", error);
    res.status(500).json({ success: false, message: "Failed to save draft" });
  }
});

router.delete("/:feature", authMiddleware, async (req, res) => {
  try {
    const { feature } = req.params;
    if (!VALID_FEATURES.includes(feature)) {
      return res.status(400).json({ success: false, message: "Invalid feature" });
    }

    const draft = await prisma.draftTask.findUnique({
      where: { userId_feature: { userId: req.user.userId, feature } },
    });

    if (!draft) {
      return res.json({ success: true, message: "No draft to delete" });
    }

    if (draft.imageUrls && isR2Configured()) {
      const urls = typeof draft.imageUrls === "string" ? JSON.parse(draft.imageUrls) : draft.imageUrls;
      for (const url of urls) {
        try {
          if (url.includes("drafts/")) {
            await deleteFromR2(url);
          }
        } catch (e) {
          console.warn("Failed to delete draft R2 file:", url, e.message);
        }
      }
    }

    await prisma.draftTask.deleteMany({
      where: { userId: req.user.userId, feature },
    });

    res.json({ success: true, message: "Draft deleted" });
  } catch (error) {
    console.error("Error deleting draft:", error);
    res.status(500).json({ success: false, message: "Failed to delete draft" });
  }
});

router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }

    const guard = await validateGenerationUploadFull(req.file, "default");
    if (!guard.ok) return sendUploadGuardResponse(res, guard);

    if (!isR2Configured()) {
      return res.status(500).json({ success: false, message: "Storage not configured" });
    }

    const url = await uploadFileToR2(req.file, "drafts");
    res.json({ success: true, url });
  } catch (error) {
    console.error("Error uploading draft file:", error);
    res.status(500).json({ success: false, message: "Failed to upload file" });
  }
});

router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    const maxLabel = formatBlobUploadMaxForMessage();
    const maxBytes = getBlobClientUploadMaxBytes();
    const msg =
      `Upload rejected: larger than the server limit of ${maxLabel}. ` +
      `That number is the cap — not your file size. HEIC/MOV conversion or huge PNGs often exceed the limit; try a smaller JPEG.`;
    return res.status(413).json({
      success: false,
      code: "FILE_TOO_LARGE",
      message: msg,
      error: msg,
      maxUploadBytes: maxBytes,
      maxUploadLabel: maxLabel,
      solution:
        "Resize or export JPEG, or raise BLOB_CLIENT_UPLOAD_MAX_BYTES to match your plan.",
    });
  }
  if (
    err &&
    err.message &&
    typeof err.message === "string" &&
    /not allowed/i.test(err.message)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_FILE_TYPE",
      message: err.message,
      error: err.message,
      solution:
        "Use JPG, PNG, WebP, or GIF for images, or MP4, WebM, or MOV for video.",
    });
  }
  return next(err);
});

export default router;
