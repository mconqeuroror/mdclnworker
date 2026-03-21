import express from "express";
import prisma from "../lib/prisma.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import {
  signup,
  login,
  googleAuth,
  getProfile,
  verifyEmail,
  resendVerificationCode,
  requestPasswordReset,
  resetPassword,
  refreshToken,
  changePassword,
  updateProfile,
  requestEmailChange,
  verifyEmailChange,
  checkEmail,
  firebaseSignup,
  verifyFirebaseEmail,
  resendFirebaseCode,
  logout,
} from "../controllers/auth.controller.js";
import {
  generateImageWithIdentity,
  describeTargetImage,
  generateVideoWithMotion,
  generateCompleteRecreation,
  getGenerationById,
  getGenerations,
  getMonthlyStats,
  batchDeleteGenerations,
  extractVideoFrames, // NEW: Extract frames from video
  prepareVideoGeneration,
  completeVideoGeneration,
  generateVideoDirectly, // NEW: Simplified one-step video generation
  generateVideoFromPrompt, // NEW: Prompt-based video generation with Kling V2.5
  generateFaceSwap,
  generatePromptBasedImage,
  cleanupStuckGenerations,
  faceSwapImage,
  generateTalkingHeadVideo,
  getVoices,
  getVoicePreview,
} from "../controllers/generation.controller.js";
import {
  createModel,
  getUserModels,
  getModelById,
  deleteModel,
  updateModel,
  generateAIModel,
  generateAIModelReference,
  generateAIModelPoses,
  generateAdvancedModel,
  generateTrialReference,
  trialUploadReal,
  completeOnboarding,
  lockSpecialOffer,
} from "../controllers/model.controller.js";
import {
  getVoicePlatformStatus,
  postModelVoiceDesignPreviews,
  postModelVoiceDesignConfirm,
  postModelVoiceClone,
} from "../controllers/model-voice.controller.js";
import {
  initializeTrainingSession,
  generateTrainingImages,
  startTrainingSession,
  regenerateTrainingImage,
  getTrainingImages,
  trainLora,
  getLoraTrainingStatus,
  assignTrainingImages,
  generateNsfwImage,
  generateNudesPack,
  generateNsfwPrompt,
  planNsfwGeneration,
  autoSelectChips,
  generateAdvancedNsfw,
  testFaceRefGeneration,
  testFaceRefStatus,
  createLora,
  getModelLoras,
  setActiveLora,
  deleteLora,
  updateLoraAppearance,
  autoDetectLoraAppearance,
  saveAppearance,
  getAppearance,
  generateNsfwVideoFromImage,
  extendNsfwVideo,
} from "../controllers/nsfw.controller.js";
import multer from "multer";
import { handleUpload } from "@vercel/blob/client";
import { isVercelBlobConfigured, uploadBufferToBlob } from "../utils/kieUpload.js";

const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/x-mp4", "video/quicktime", "video/webm",
];

const voiceCloneUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    const okMime = file.mimetype === "audio/mpeg" || file.mimetype === "audio/mp3";
    if (okMime || name.endsWith(".mp3")) cb(null, true);
    else cb(new Error("Only MP3 files are allowed for voice clone."));
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_UPLOAD_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else if (file.mimetype?.startsWith("video/")) {
      cb(null, true);
    } else if (file.mimetype === "application/octet-stream" && /\.(mp4|mov|webm|m4v)$/i.test(file.originalname || "")) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Accepted: images and videos only.`));
    }
  },
});
import {
  getAllUsers,
  getUserById,
  getUserPurchases,
  refundUserPurchase,
  addCreditsToUser,
  updateUserSettings,
  getDashboardStats,
  getStripeRevenue,
  deleteUser,
  getRecentActivity,
  recoverPayment,
  syncUserStripeState,
  reconcileAllSubscriptions,
  reconcileReferralCommissions,
} from "../controllers/admin.controller.js";
import jwt from "jsonwebtoken";
import { authMiddleware, setAuthCookie, setRefreshCookie } from "../middleware/auth.middleware.js";
import { adminMiddleware } from "../middleware/admin.middleware.js";
import requestQueue from "../services/queue.service.js";
import {
  authLimiter,
  refreshLimiter,
  signupLimiter,
  passwordResetLimiter,
  generationLimiter,
  modelsLimiter, // ✅ FIX: Added for /models endpoint rate limiting
  voiceDesignPreviewLimiter,
  generationsLimiter, // ✅ FIX: Added for /generations endpoint rate limiting
  apiLimiter,
  downloadLimiter,
} from "../middleware/rateLimiter.js";
import { getGenerationPricing } from "../services/generation-pricing.service.js";
import {
  validateSignup,
  validateLogin,
  validateEmailVerification,
  validateResendCode,
  validatePasswordResetRequest,
  validatePasswordReset,
  validateModelCreation,
  validateModelUpdate,
  validateGeneration,
} from "../middleware/validation.js";
import {
  generate2FASecret,
  verify2FA,
  disable2FA,
  get2FAStatus,
} from "../controllers/twoFactor.controller.js";
import stripeRoutes from "./stripe.routes.js";
import nowpaymentsRoutes from "./nowpayments.routes.js";
import adminRoutes from "./admin.routes.js";
import designerStudioRoutes from "./designer-studio.routes.js";
import referralRoutes from "./referral.routes.js";
import draftRoutes from "./draft.routes.js";
import reformatterRoutes from "./reformatter.routes.js";
import { sendFrontendErrorAlert } from "../services/email.service.js";
import rateLimit from "express-rate-limit";
import { getAppBranding } from "../services/branding.service.js";

const router = express.Router();
const consumedImpersonationJtis = new Map();
const generationIdempotencyCache = new Map();

function purgeOldImpersonationJtis() {
  const now = Date.now();
  for (const [jti, expMs] of consumedImpersonationJtis.entries()) {
    if (expMs <= now) consumedImpersonationJtis.delete(jti);
  }
}

function getGenerationIdempotencyEntry(key) {
  const entry = generationIdempotencyCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    generationIdempotencyCache.delete(key);
    return null;
  }
  return entry;
}

router.get("/brand", async (_req, res) => {
  try {
    const branding = await getAppBranding();
    res.json({ success: true, branding });
  } catch (error) {
    console.error("Brand endpoint error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch branding" });
  }
});

// KIE webhook callback is mounted in server.js BEFORE body parsing so it receives raw body

// Health check
router.get("/health", (req, res) => {
  const queueStats = requestQueue.getStats();
  res.json({
    success: true,
    message: "Model Clone API is running",
    version: "3.0.0 - Email Verification + Credit System + Queue",
    workflow: "WaveSpeed + HD 720p + Credits + Bronze Tier Queue",
    queue: {
      active: queueStats.active,
      queued: queueStats.queued,
      maxConcurrent: queueStats.maxConcurrent,
      total: queueStats.total,
    },
    timestamp: new Date().toISOString(),
  });
});

// Frontend error reporting — auto-emails admin with full context, never exposes stack to user
// Rate-limited to prevent spam: 5 reports per IP per 15 minutes
const errorReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many error reports" },
});
router.post("/errors/report", errorReportLimiter, async (req, res) => {
  // Always respond 200 — client must not block on this
  res.json({ received: true });

  try {
    const {
      message,
      stack,
      componentStack,
      url,
      userId,
      userEmail,
      userAgent,
    } = req.body;

    if (!message) return;

    // Silently drop translate-related insertBefore errors — those are a known
    // browser-translate side effect, already guarded client-side.
    const lowerMsg = String(message).toLowerCase();
    if (
      lowerMsg.includes("insertbefore") ||
      lowerMsg.includes("notfounderror") && lowerMsg.includes("node")
    ) {
      return;
    }

    await sendFrontendErrorAlert({
      message,
      stack,
      componentStack,
      url,
      userId,
      userEmail,
      userAgent: userAgent || req.headers["user-agent"],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("⚠️ Error in /errors/report handler:", err.message);
  }
});

// Debug endpoint to check email configuration (admin only)
router.get(
  "/debug/email-config",
  authMiddleware,
  adminMiddleware,
  (req, res) => {
    res.json({
      resendApiKey: process.env.RESEND_API_KEY ? "Configured" : "NOT SET",
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  },
);

// NSFW Routes - Multi-LoRA management
router.post("/nsfw/lora/create", authMiddleware, generationLimiter, createLora);
router.get("/nsfw/loras/:modelId", authMiddleware, getModelLoras);
router.post("/nsfw/lora/set-active", authMiddleware, generationLimiter, setActiveLora);
router.delete("/nsfw/lora/:loraId", authMiddleware, generationLimiter, deleteLora);
router.put("/nsfw/lora/:loraId/appearance", authMiddleware, updateLoraAppearance);
router.post("/nsfw/lora/:loraId/auto-appearance", authMiddleware, autoDetectLoraAppearance);
router.post("/nsfw/appearance/save", authMiddleware, saveAppearance);
router.get("/nsfw/appearance/:modelId", authMiddleware, getAppearance);

// NSFW Routes - Legacy & training
router.post("/nsfw/initialize-training", authMiddleware, generationLimiter, initializeTrainingSession);
router.post("/nsfw/generate-training-images", authMiddleware, generationLimiter, generateTrainingImages);
router.post("/nsfw/start-training-session", authMiddleware, generationLimiter, startTrainingSession);
router.post("/nsfw/regenerate-training-image", authMiddleware, generationLimiter, regenerateTrainingImage);
router.post("/nsfw/assign-training-images", authMiddleware, generationLimiter, assignTrainingImages);

// Register pre-uploaded training images (uploaded via presigned URLs directly to R2)
router.post("/nsfw/register-training-images", authMiddleware, async (req, res) => {
  try {
    const { modelId, loraId, imageUrls } = req.body;
    const userId = req.user.userId;

    if (!modelId || !imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ success: false, message: "modelId and imageUrls are required" });
    }
    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model || model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { allowCustomLoraTrainingPhotos: true } });
    if (!user?.allowCustomLoraTrainingPhotos) {
      return res.status(403).json({ success: false, message: "Custom LoRA training photo uploads are disabled for this account." });
    }
    const targetLoraId = loraId || model.activeLoraId;
    if (!targetLoraId) {
      return res.status(400).json({ success: false, message: "No active LoRA found." });
    }
    const maxImages = 30;
    const existingCount = await prisma.loraTrainingImage.count({ where: { loraId: targetLoraId } });
    const available = Math.max(0, maxImages - existingCount);
    const toRegister = imageUrls.slice(0, available);
    const trimmed = imageUrls.length - toRegister.length;
    const created = [];
    for (const url of toRegister) {
      const img = await prisma.loraTrainingImage.create({
        data: { modelId: model.id, loraId: targetLoraId, imageUrl: url },
        select: { id: true, imageUrl: true },
      });
      created.push(img);
    }
    return res.json({ success: true, images: created, uploadedCount: created.length, trimmed });
  } catch (error) {
    console.error("Register training images error:", error);
    return res.status(500).json({ success: false, message: "Failed to register training images" });
  }
});

router.post("/nsfw/upload-training-images", authMiddleware, upload.array("photos", 30), async (req, res) => {
  try {
    const { modelId, loraId } = req.body;
    const userId = req.user.userId;

    if (!modelId || !req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "modelId and photos are required" });
    }

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model || model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { allowCustomLoraTrainingPhotos: true },
    });
    if (!user?.allowCustomLoraTrainingPhotos) {
      return res.status(403).json({
        success: false,
        message: "Custom LoRA training photo uploads are disabled for this account.",
      });
    }

    const targetLoraId = loraId || model.activeLoraId;
    if (!targetLoraId) {
      return res.status(400).json({ success: false, message: "No active LoRA found. Create a training session first." });
    }

    const targetLora = await prisma.trainedLora.findUnique({ where: { id: targetLoraId } });
    const isProMode = targetLora?.trainingMode === "pro";
    const maxImages = isProMode ? 30 : 15;
    const requiredImages = isProMode ? 30 : 15;

    // Default behavior: uploading custom photos replaces previous custom uploads
    // for this LoRA to avoid stale image accumulation and misleading counters.
    const replaceExistingCustom =
      String(req.body?.replaceExistingCustom ?? "true").toLowerCase() !== "false";
    if (replaceExistingCustom) {
      await prisma.loraTrainingImage.deleteMany({
        where: {
          loraId: targetLoraId,
          generationId: null,
        },
      });
    }

    const existingCount = await prisma.loraTrainingImage.count({
      where: { loraId: targetLoraId, status: "completed" },
    });

    const slotsRemaining = Math.max(0, maxImages - existingCount);
    let filesToProcess = req.files;
    let trimmed = 0;

    if (filesToProcess.length > slotsRemaining) {
      trimmed = filesToProcess.length - slotsRemaining;
      filesToProcess = filesToProcess.slice(0, slotsRemaining);
    }

    if (filesToProcess.length === 0) {
      return res.status(400).json({
        success: false,
        message: `This LoRA already has ${existingCount}/${maxImages} images. No more slots available.`,
      });
    }

    if (!isR2Configured()) {
      return res.status(503).json({
        success: false,
        message: "R2 storage is required for LoRA training uploads but is not configured.",
      });
    }

    const uploadedUrls = [];
    for (const file of filesToProcess) {
      const url = await uploadFileToR2(file, "training");
      uploadedUrls.push(url);
    }

    const createdImages = [];
    for (const url of uploadedUrls) {
      const img = await prisma.loraTrainingImage.create({
        data: {
          modelId: modelId,
          loraId: targetLoraId,
          imageUrl: url,
          status: "completed",
        },
      });
      createdImages.push(img);
    }

    const totalImages = existingCount + createdImages.length;

    if (totalImages >= requiredImages) {
      await prisma.trainedLora.update({
        where: { id: targetLoraId },
        data: { status: "images_ready" },
      });
    }

    console.log(`✅ Uploaded ${uploadedUrls.length} training images for LoRA ${targetLoraId}${trimmed > 0 ? ` (${trimmed} trimmed - over limit)` : ""}`);
    res.json({
      success: true,
      images: createdImages,
      totalImages,
      uploadedCount: createdImages.length,
      trimmed,
      trimmedMessage: trimmed > 0
        ? `Only ${filesToProcess.length} of ${filesToProcess.length + trimmed} images were uploaded. The LoRA has ${totalImages}/${maxImages} slots filled.`
        : null,
    });
  } catch (error) {
    console.error("❌ Upload training images error:", error);
    res.status(500).json({ success: false, message: "Failed to upload training images" });
  }
});
router.get("/nsfw/training-images/:modelId", authMiddleware, getTrainingImages);
router.post("/nsfw/train-lora", authMiddleware, generationLimiter, trainLora);
router.get("/nsfw/training-status/:modelId", authMiddleware, getLoraTrainingStatus);
router.post("/nsfw/generate", authMiddleware, generationLimiter, generateNsfwImage);
router.post("/nsfw/nudes-pack", authMiddleware, generationLimiter, generateNudesPack);
router.post("/nsfw/generate-prompt", authMiddleware, generationLimiter, generateNsfwPrompt);
router.post("/nsfw/plan-generation", authMiddleware, generationLimiter, planNsfwGeneration);
router.post("/nsfw/auto-select", authMiddleware, generationLimiter, autoSelectChips);
router.post("/nsfw/generate-advanced", authMiddleware, generationLimiter, generateAdvancedNsfw);
router.post("/nsfw/test-face-ref", authMiddleware, generationLimiter, testFaceRefGeneration);
router.get("/nsfw/test-face-ref-status/:requestId", authMiddleware, testFaceRefStatus);
router.post("/nsfw/generate-video", authMiddleware, generationLimiter, generateNsfwVideoFromImage);
router.post("/nsfw/extend-video", authMiddleware, generationLimiter, extendNsfwVideo);

// ============================================
// AUTH ROUTES (with rate limiting and input validation)
// ============================================
router.post("/auth/check-email", authLimiter, checkEmail);
router.post("/auth/firebase-signup", signupLimiter, firebaseSignup);
router.post("/auth/verify-firebase-email", authLimiter, verifyFirebaseEmail);
router.post("/auth/resend-firebase-code", authLimiter, resendFirebaseCode);
router.post("/auth/signup", signupLimiter, validateSignup, signup);
router.post(
  "/auth/verify-email",
  authLimiter,
  validateEmailVerification,
  verifyEmail,
);
router.post(
  "/auth/resend-code",
  authLimiter,
  validateResendCode,
  resendVerificationCode,
);
router.post("/auth/login", authLimiter, validateLogin, login);
router.post("/auth/google", authLimiter, googleAuth);
router.post("/auth/refresh", refreshLimiter, refreshToken);

// Admin impersonation: validate token from link and set auth cookies (no auth required)
router.get("/auth/impersonate-login", authLimiter, (req, res) => {
  try {
    const token = (req.query.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, error: "Missing token" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.impersonatedBy) {
      return res.status(403).json({ success: false, error: "Invalid impersonation token" });
    }
    purgeOldImpersonationJtis();
    if (decoded.jti && consumedImpersonationJtis.has(decoded.jti)) {
      return res.status(401).json({ success: false, error: "This impersonation link has already been used" });
    }
    const accessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    const refreshTokenValue = jwt.sign(
      { userId: decoded.userId, email: decoded.email, type: "refresh" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    setAuthCookie(res, accessToken);
    setRefreshCookie(res, refreshTokenValue);
    if (decoded.jti) {
      const expMs = Number(decoded.exp || 0) * 1000 || Date.now() + 10 * 60 * 1000;
      consumedImpersonationJtis.set(decoded.jti, expMs);
    }
    prisma.adminAuditLog.create({
      data: {
        adminUserId: decoded.impersonatedBy,
        action: "impersonation_login",
        targetType: "user",
        targetId: decoded.userId,
        detailsJson: JSON.stringify({
          targetEmail: decoded.email,
          jti: decoded.jti || null,
          at: new Date().toISOString(),
        }),
      },
    }).catch((err) => {
      console.error("Impersonation audit log error:", err?.message || err);
    });
    console.log(`🔑 Admin impersonation login: ${decoded.email} (by admin ${decoded.impersonatedBy})`);
    res.json({ success: true });
  } catch (err) {
    console.error("Impersonate login error:", err.message);
    res.status(401).json({ success: false, error: err.message || "Invalid or expired token" });
  }
});

router.get("/auth/profile", authMiddleware, getProfile);
router.post(
  "/auth/request-password-reset",
  passwordResetLimiter,
  validatePasswordResetRequest,
  requestPasswordReset,
);
router.post(
  "/auth/reset-password",
  passwordResetLimiter,
  validatePasswordReset,
  resetPassword,
);
router.post(
  "/auth/change-password",
  authMiddleware,
  authLimiter,
  changePassword,
);
router.put("/auth/profile", authMiddleware, authLimiter, updateProfile);
router.post("/auth/change-email/request", authMiddleware, authLimiter, requestEmailChange);
router.post("/auth/change-email/verify", authMiddleware, authLimiter, verifyEmailChange);
router.post("/auth/logout", logout);

// ============================================
// TWO-FACTOR AUTHENTICATION ROUTES
// ============================================
router.get("/auth/2fa/status", authMiddleware, get2FAStatus);
router.post("/auth/2fa/generate", authMiddleware, generate2FASecret);
router.post("/auth/2fa/verify", authMiddleware, verify2FA);
router.post("/auth/2fa/disable", authMiddleware, disable2FA);

// ============================================
// FILE UPLOAD ROUTES
// ============================================

// Upload config: when Blob is configured, client should use direct-to-blob (no file through server → no 413).
router.get("/upload/config", authMiddleware, (req, res) => {
  res.json({
    directToBlob: isVercelBlobConfigured(),
  });
});

// Client direct-to-blob: server only returns a token (JSON). File is uploaded browser → Vercel Blob (no 413).
router.post("/upload/blob", authMiddleware, async (req, res) => {
  if (!isVercelBlobConfigured()) {
    return res.status(503).json({ error: "Blob storage not configured" });
  }
  try {
    const body = req.body;
    if (!body || typeof body.type !== "string") {
      return res.status(400).json({ error: "Invalid handleUpload body" });
    }
    const requestWithUrl = { ...req, url: req.originalUrl || req.url || "/api/upload/blob" };
    const jsonResponse = await handleUpload({
      body,
      request: requestWithUrl,
      onBeforeGenerateToken: async (pathname, _clientPayload, multipart) => {
        const allowedContentTypes = [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "application/octet-stream",
        ];
        return {
          allowedContentTypes,
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("[upload/blob] Client upload completed:", blob?.url?.slice(0, 80));
      },
    });
    return res.json(jsonResponse);
  } catch (err) {
    console.error("[upload/blob] handleUpload error:", err?.message || err);
    return res.status(400).json({ error: err?.message || "Upload token failed" });
  }
});

// Presigned URL for direct browser → R2 upload (bypasses Vercel 4.5MB body limit)
router.post("/upload/presign", authMiddleware, async (req, res) => {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({ success: false, error: "File storage is not configured" });
    }
    const { contentType, folder = "uploads" } = req.body || {};
    if (!contentType) return res.status(400).json({ success: false, error: "contentType required" });

    const allowedFolders = ["uploads", "training", "support-attachments", "generations"];
    const safeFolder = allowedFolders.includes(folder) ? folder : "uploads";
    const extension = contentType.split("/")[1]?.replace("jpeg", "jpg") || "bin";

    const { uploadUrl, publicUrl } = await getR2PresignedUploadUrl(safeFolder, extension, contentType, 300);
    return res.json({ success: true, uploadUrl, publicUrl });
  } catch (error) {
    console.error("Presign error:", error);
    return res.status(500).json({ success: false, error: "Failed to generate upload URL" });
  }
});

router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: "No file uploaded" });
      }

      // Prefer Vercel Blob for generation inputs so KIE can access URLs (R2 presigned/public URLs often unreachable by KIE).
      if (isVercelBlobConfigured()) {
        const filename = (req.file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
        const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : (req.file.mimetype?.split("/")[1] || "bin");
        const safeName = filename.includes(".") ? filename : `file.${ext}`;
        let contentType = req.file.mimetype || "application/octet-stream";
        if (contentType === "application/octet-stream" && /^(mp4|mov|webm)$/.test(ext)) {
          contentType = ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4";
        }
        const url = await uploadBufferToBlob(req.file.buffer, safeName, contentType, "user-uploads");
        console.log("✅ File uploaded to Vercel Blob (KIE-accessible):", url.slice(0, 80));
        return res.json({ success: true, url });
      }

      if (!isR2Configured()) {
        return res.status(503).json({ success: false, error: "File storage is not configured" });
      }

      const url = await uploadFileToR2(req.file, "uploads");
      console.log("✅ File uploaded to R2:", url);

      res.json({ success: true, url });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ success: false, error: "Upload failed" });
    }
  },
);

// ============================================
// MODEL MANAGEMENT ROUTES (with validation)
// ============================================
router.post(
  "/models",
  authMiddleware,
  modelsLimiter,
  validateModelCreation,
  createModel,
); // ✅ FIX: Added modelsLimiter
router.get("/models", authMiddleware, modelsLimiter, getUserModels); // ✅ FIX: Added modelsLimiter
router.get(
  "/models/status/:id",
  authMiddleware,
  modelsLimiter,
  async (req, res) => {
    // Quick status check for model generation (used during onboarding)
    try {
      const model = await prisma.savedModel.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
        select: {
          id: true,
          status: true,
          photo1Url: true,
          photo2Url: true,
          photo3Url: true,
        },
      });
      if (!model) return res.status(404).json({ error: "Model not found" });
      res.json({ status: model.status || "ready", model });
    } catch (error) {
      console.error("Model status check error:", error);
      res.status(500).json({ error: "Failed to check model status" });
    }
  },
);

// Custom ElevenLabs voice per model (design / clone) — register before /models/:id
router.get(
  "/models/voice-platform/status",
  authMiddleware,
  modelsLimiter,
  getVoicePlatformStatus,
);
router.post(
  "/models/:modelId/voice/design-previews",
  authMiddleware,
  voiceDesignPreviewLimiter,
  postModelVoiceDesignPreviews,
);
router.post(
  "/models/:modelId/voice/design-confirm",
  authMiddleware,
  generationLimiter,
  postModelVoiceDesignConfirm,
);
router.post(
  "/models/:modelId/voice/clone",
  authMiddleware,
  generationLimiter,
  voiceCloneUpload.single("audio"),
  postModelVoiceClone,
);

router.get("/models/:id", authMiddleware, modelsLimiter, getModelById); // ✅ FIX: Added modelsLimiter
router.put(
  "/models/:id",
  authMiddleware,
  modelsLimiter,
  validateModelUpdate,
  updateModel,
);
router.delete("/models/:id", authMiddleware, modelsLimiter, deleteModel); // ✅ FIX: Added modelsLimiter

// Generate AI Model from parameters (creates fictional person) - Legacy single-step
router.post(
  "/models/generate-ai",
  authMiddleware,
  modelsLimiter,
  generateAIModel,
);

// Generate AI Model - Phase 1: Reference Image
router.post(
  "/models/generate-reference",
  authMiddleware,
  modelsLimiter,
  generateAIModelReference,
);

// Generate AI Model - Phase 2: 3 Poses from Reference
router.post(
  "/models/generate-poses",
  authMiddleware,
  modelsLimiter,
  generateAIModelPoses,
);

// Generate AI Model - Advanced (Nano Banana with user photos + prompt)
router.post(
  "/models/generate-advanced",
  authMiddleware,
  modelsLimiter,
  generateAdvancedModel,
);

// ============================================
// ONBOARDING & FREE TRIAL ROUTES
// ============================================

// Generate FREE trial reference image (once per user)
router.post(
  "/onboarding/trial-generate",
  authMiddleware,
  modelsLimiter,
  generateTrialReference,
);

// Upload real photos during onboarding trial
router.post(
  "/onboarding/trial-upload",
  authMiddleware,
  modelsLimiter,
  upload.fields([
    { name: "face1", maxCount: 1 },
    { name: "face2", maxCount: 1 },
    { name: "body", maxCount: 1 },
  ]),
  trialUploadReal,
);

// Mark onboarding as completed
router.post("/onboarding/complete", authMiddleware, completeOnboarding);

// Lock special offer (user skipped - never show again)
router.post("/onboarding/lock-offer", authMiddleware, lockSpecialOffer);

// ============================================
// COURSE ROUTES
// ============================================
router.post("/course/complete-video", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { videoNumber } = req.body;
    
    if (!videoNumber || ![1, 2].includes(videoNumber)) {
      return res.status(400).json({ success: false, message: "Invalid video number" });
    }
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    if (videoNumber <= user.freeVideosCompleted) {
      return res.json({ success: true, freeVideosCompleted: user.freeVideosCompleted });
    }
    
    if (videoNumber === 2 && user.freeVideosCompleted < 1) {
      return res.status(400).json({ success: false, message: "Complete video 1 first" });
    }
    
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { freeVideosCompleted: videoNumber },
    });
    
    res.json({ success: true, freeVideosCompleted: updated.freeVideosCompleted });
  } catch (error) {
    console.error("Course video completion error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/course/status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true, premiumFeaturesUnlocked: true },
    });

    res.json({
      success: true,
      courseUnlocked: user?.subscriptionStatus === "active" || user?.premiumFeaturesUnlocked === true,
    });
  } catch (error) {
    console.error("Course status error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============================================
// ADMIN ROUTES (Admin only)
// ============================================
router.get("/admin/stats", authMiddleware, adminMiddleware, getDashboardStats);
router.get("/admin/stripe-revenue", authMiddleware, adminMiddleware, getStripeRevenue);
router.get("/admin/users", authMiddleware, adminMiddleware, getAllUsers);
router.get("/admin/users/:id", authMiddleware, adminMiddleware, getUserById);
router.get("/admin/users/:id/purchases", authMiddleware, adminMiddleware, getUserPurchases);
router.post("/admin/users/:id/purchases/:purchaseId/refund", authMiddleware, adminMiddleware, refundUserPurchase);
router.post("/admin/users/:id/stripe-sync", authMiddleware, adminMiddleware, syncUserStripeState);
router.post("/admin/subscriptions/reconcile", authMiddleware, adminMiddleware, reconcileAllSubscriptions);
router.post("/admin/referrals/reconcile", authMiddleware, adminMiddleware, reconcileReferralCommissions);
router.post(
  "/admin/credits/add",
  authMiddleware,
  adminMiddleware,
  addCreditsToUser,
);
router.post(
  "/admin/users/settings",
  authMiddleware,
  adminMiddleware,
  updateUserSettings,
);
router.delete("/admin/users/:id", authMiddleware, adminMiddleware, deleteUser);
router.post(
  "/admin/recover-payment",
  authMiddleware,
  adminMiddleware,
  recoverPayment,
);
router.get(
  "/admin/activity",
  authMiddleware,
  adminMiddleware,
  getRecentActivity,
);

// ============================================
// GENERATION ROUTES - YOUR WORKFLOW
// ============================================

/**
 * Step 1: Image with identity preservation
 * POST /api/generate/image-identity
 * Body: {
 *   identityImages: [url1, url2, url3],
 *   targetImage: url,
 *   aspectRatio: "9:16"
 * }
 */
router.post(
  "/generate/image-identity",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateImageWithIdentity,
);

/**
 * Describe a target image using Grok Vision
 * POST /api/generate/describe-target
 * Body: { targetImageUrl, modelName?, clothesMode? }
 */
router.post(
  "/generate/describe-target",
  authMiddleware,
  generationLimiter,
  describeTargetImage,
);

/**
 * Step 2: Video with motion transfer
 * POST /api/generate/video-motion
 * Body: {
 *   generatedImageUrl: url,
 *   referenceVideoUrl: url,
 *   prompt: ""
 * }
 */
router.post(
  "/generate/video-motion",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateVideoWithMotion,
);

/**
 * Complete workflow (Steps 1 + 2)
 * POST /api/generate/complete-recreation
 * Body: {
 *   modelIdentityImages: [url1, url2, url3],
 *   videoScreenshot: url,
 *   originalVideoUrl: url,
 *   videoPrompt: ""
 * }
 */
router.post(
  "/generate/complete-recreation",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateCompleteRecreation,
);

// ============================================
// NEW VIDEO PIPELINE (Multi-step with FFmpeg)
// ============================================

/**
 * NEW: Step 0 - Extract frames from video (FREE)
 * POST /api/generate/extract-frames
 * Body: {
 *   referenceVideoUrl: url
 * }
 * Returns: 3 high-quality frames at different timestamps
 */
router.post(
  "/generate/extract-frames",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  extractVideoFrames,
);

/**
 * NEW: Step 1 - Prepare video (user picked frame, now generate 3 variations)
 * POST /api/generate/prepare-video
 * Body: {
 *   modelImages: [url1, url2, url3],
 *   selectedFrameUrl: url (from extract-frames step)
 * }
 */
router.post(
  "/generate/prepare-video",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  prepareVideoGeneration,
);

/**
 * NEW: Step 2 - Complete video (user picked variation)
 * POST /api/generate/complete-video
 * Body: {
 *   selectedImageUrl: url,
 *   referenceVideoUrl: url
 * }
 */
router.post(
  "/generate/complete-video",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  completeVideoGeneration,
);

/**
 * SIMPLIFIED VIDEO GENERATION - One-step TikTok/Reel format
 * POST /api/generate/video-direct
 * Body: {
 *   modelId: uuid,
 *   referenceVideoUrl: url
 * }
 * Automatically uses model photos, generates in 720p 9:16 format
 */
router.post(
  "/generate/video-directly",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateVideoDirectly,
);

/**
 * PROMPT-BASED VIDEO GENERATION - Image + Prompt → Video with Kling V2.5 Turbo
 * POST /api/generate/video-prompt
 * Body: {
 *   imageUrl: url,
 *   prompt: string,
 *   duration: 5 | 10 (seconds)
 * }
 * Pricing: 5s = 60 credits, 10s = 100 credits
 */
router.post(
  "/generate/video-prompt",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateVideoFromPrompt,
);

/**
 * Face Swap - Swap faces in video
 * POST /api/generate/face-swap
 * Body: {
 *   sourceVideoUrl: url,
 *   modelId: uuid,
 *   videoDuration: number (seconds),
 *   targetGender: 'all' | 'female' | 'male' (optional),
 *   targetIndex: number (optional, 0 = no limit)
 *   maxDuration: number (optional, 0 = no limit)
 * }
 * Pricing: 10 credits per second
 */
router.post(
  "/generate/face-swap",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateFaceSwap,
);
// Alias for backward compatibility
router.post(
  "/generate/face-swap-video",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateFaceSwap,
);

/**
 * v42a: Face Swap Image - Swap faces in image
 * POST /api/generate/image-faceswap
 * Body: {
 *   targetImageUrl: url,
 *   sourceImageUrl: url
 * }
 * Pricing: 10 credits
 */
router.post(
  "/generate/image-faceswap",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  faceSwapImage,
);

/**
 * Advanced Image Generation - Direct AI model control
 * POST /api/generate/advanced
 * Submits to WaveSpeed and saves request ID - background poller handles tracking
 */
router.post(
  "/generate/advanced",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  async (req, res) => {
    let creditsDeducted = false;
    let generationCreated = false;
    let userId = null;
    let creditsNeeded = 0;
    let refundCredits = null;
    try {
      const { modelId, engine, prompt, referencePhotos = [] } = req.body;
      userId = req.user.userId;
      const rawIdempotencyKey =
        (typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey : "") ||
        (typeof req.headers["x-idempotency-key"] === "string" ? req.headers["x-idempotency-key"] : "");
      const normalizedIdempotencyKey = rawIdempotencyKey.trim();
      const dedupeKey = normalizedIdempotencyKey ? `${userId}:advanced:${normalizedIdempotencyKey}` : null;
      if (dedupeKey) {
        const existing = getGenerationIdempotencyEntry(dedupeKey);
        if (existing?.payload) {
          return res.json(existing.payload);
        }
      }

      if (!modelId) {
        return res.status(400).json({ success: false, error: "Model ID is required" });
      }
      if (!prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, error: "Prompt is required" });
      }
      if (!["nano-banana", "seedream"].includes(engine)) {
        return res.status(400).json({ success: false, error: "Invalid engine. Use 'nano-banana' or 'seedream'" });
      }

      const model = await prisma.savedModel.findFirst({
        where: { id: modelId, userId },
      });
      if (!model) {
        return res.status(404).json({ success: false, error: "Model not found or you don't have access" });
      }

      creditsNeeded = engine === "nano-banana" ? 20 : 10;
      const creditService = await import("../services/credit.service.js");
      const { checkAndExpireCredits, getTotalCredits, deductCredits, refundGeneration } = creditService;
      refundCredits = creditService.refundCredits;

      const user = await checkAndExpireCredits(userId);
      const totalCredits = getTotalCredits(user);
      if (totalCredits < creditsNeeded) {
        return res.status(403).json({
          success: false,
          message: `Not enough credits. Need ${creditsNeeded}, have ${totalCredits}.`,
        });
      }
      await deductCredits(userId, creditsNeeded);
      creditsDeducted = true;

      const identityImages = referencePhotos.length > 0
        ? referencePhotos
        : [model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean);

      // Build appearance from model's savedAppearance (single source of truth for all generations)
      const { buildAppearancePrefix } = await import("../utils/appearancePrompt.js");
      const appearancePrefix = buildAppearancePrefix({
        savedAppearance: model.savedAppearance,
        age: model.age ?? undefined,
      });
      const enrichedPrompt = appearancePrefix + prompt.trim();

      const replicateModelLabel = engine === "seedream" ? "wavespeed-seedream-v4.5-edit" : "kie-nano-banana-pro";
      const generation = await prisma.generation.create({
        data: {
          userId,
          modelId,
          type: "advanced-image",
          status: "processing",
          prompt: prompt.trim(),
          creditsCost: creditsNeeded,
          replicateModel: replicateModelLabel,
        },
      });
      generationCreated = true;

      await prisma.creditTransaction.create({
        data: {
          userId,
          amount: -creditsNeeded,
          type: "generation",
          description: `Advanced image generation (${engine})`,
        },
      });

      const successPayload = {
        success: true,
        generationId: generation.id,
        creditsUsed: creditsNeeded,
        message: "Generation started",
      };
      if (dedupeKey) {
        generationIdempotencyCache.set(dedupeKey, {
          payload: successPayload,
          expiresAt: Date.now() + 2 * 60 * 1000,
        });
      }
      res.json(successPayload);

      (async () => {
        const { generateImageWithNanoBananaKie } = await import("../services/kie.service.js");
        const { generateImageWithSeedreamWaveSpeed } = await import("../services/wavespeed.service.js");
        const { getUserFriendlyGenerationError } = await import("../utils/generationErrorMessages.js");
        const opts = engine === "seedream"
          ? { aspectRatio: "9:16" }
          : { aspectRatio: "9:16", resolution: "2K", outputFormat: "png" };
        opts.onTaskCreated = async (taskId) => {
          await prisma.generation.update({
            where: { id: generation.id },
            data: { replicateModel: engine === "seedream" ? `wavespeed-seedream:${taskId}` : `kie-task:${taskId}` },
          });
        };
        try {
          const result = engine === "seedream"
            ? await generateImageWithSeedreamWaveSpeed(identityImages, enrichedPrompt, opts)
            : await generateImageWithNanoBananaKie(identityImages, enrichedPrompt, opts);
          if (result?.success && result?.deferred && result?.taskId) {
            await prisma.generation.update({
              where: { id: generation.id },
              data: { replicateModel: engine === "seedream" ? `wavespeed-seedream:${result.taskId}` : `kie-task:${result.taskId}` },
            });
            console.log(`🍌 [Advanced] KIE ${engine} submitted; result will arrive via callback (task ${result.taskId})`);
          } else if (result?.success && result?.outputUrl) {
            await prisma.generation.update({
              where: { id: generation.id },
              data: { status: "completed", outputUrl: result.outputUrl, completedAt: new Date() },
            });
            console.log(`🍌 [Advanced] KIE ${engine} complete: ${generation.id}`);
          } else {
            const errMsg = result?.error || "Generation failed";
            const friendlyMessage = getUserFriendlyGenerationError(errMsg);
            await refundGeneration(generation.id).catch(() => {});
            await prisma.generation.update({
              where: { id: generation.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb(friendlyMessage), completedAt: new Date() },
            }).catch(() => {});
            console.error(`🍌 [Advanced] KIE ${engine} failed: ${generation.id}`, errMsg);
          }
        } catch (err) {
          console.error("Advanced generation KIE error:", err);
          const friendlyMessage = getUserFriendlyGenerationError(err?.message || String(err));
          await refundGeneration(generation.id).catch(() => {});
          await prisma.generation.update({
            where: { id: generation.id },
            data: { status: "failed", errorMessage: getErrorMessageForDb(friendlyMessage), completedAt: new Date() },
          }).catch(() => {});
        }
      })().catch((err) => console.error("Advanced KIE background error:", err));
    } catch (error) {
      console.error("Advanced generation error:", error);
      if (creditsDeducted && !generationCreated) {
        try {
          await refundCredits(userId, creditsNeeded);
          console.log(`✅ Refunded ${creditsNeeded} credits after advanced generation setup failure`);
        } catch (refundErr) {
          console.error(`🚨 CRITICAL: Failed to refund ${creditsNeeded} credits for user ${userId} after advanced gen error:`, refundErr.message);
        }
      }
      res.status(500).json({ success: false, error: error.message || "Generation failed" });
    }
  },
);

// Appearance option sets for analyze-looks — must match client chip options (nsfwSelectors appearance groups)
const ANALYZE_LOOKS_OPTIONS = {
  gender: ["female", "male"],
  ethnicity: ["caucasian", "latina", "asian", "east asian", "south asian", "middle eastern", "black african", "mixed race", "pacific islander"],
  hairColor: ["blonde hair", "brunette hair", "black hair", "red hair", "pink hair", "platinum blonde hair", "auburn hair", "silver hair", "white hair", "strawberry blonde hair", "dark brown hair", "light brown hair", "honey blonde hair"],
  hairType: ["long straight hair", "long wavy hair", "long curly hair", "short straight hair", "short curly hair", "medium length hair", "ponytail", "braided hair", "messy bun", "hair down over shoulders", "pigtails", "twin braids", "half up half down", "wet slicked back hair", "bob cut", "pixie cut", "bangs with long hair"],
  skinTone: ["pale white skin", "fair skin", "light skin", "lightly tanned skin", "tanned skin", "olive skin", "caramel skin", "brown skin", "dark brown skin", "dark skin", "sun-kissed skin", "porcelain skin"],
  eyeColor: ["blue eyes", "green eyes", "brown eyes", "hazel eyes", "grey eyes", "dark brown eyes", "light brown eyes", "amber eyes"],
  eyeShape: ["almond shaped eyes", "round eyes", "hooded eyes", "upturned eyes", "monolid eyes", "deep set eyes", "large doe eyes"],
  faceShape: ["oval face", "round face", "heart shaped face", "square jaw face", "diamond face", "long face", "soft angular face"],
  noseShape: ["small button nose", "straight narrow nose", "slightly upturned nose", "wide nose", "aquiline nose", "flat bridge nose", "petite nose"],
  lipSize: ["thin lips", "medium lips", "full lips", "plump lips", "bow shaped lips", "wide lips"],
  bodyType: ["slim body", "athletic body", "curvy body", "petite body", "thick body", "slim sporty body", "muscular body", "hourglass body", "pear shaped body", "slim thick body"],
  height: ["short stature", "average height", "tall stature", "very tall stature"],
  breastSize: ["small perky breasts", "medium sized breasts", "large round breasts", "huge breasts", "natural teardrop breasts"],
  buttSize: ["small tight butt", "round medium butt", "large round butt", "thick bubble butt", "athletic toned butt"],
  waist: ["very narrow waist", "slim waist", "average waist", "wide waist", "tiny waist wide hips"],
  hips: ["narrow hips", "average hips", "wide hips", "very wide hips", "curvy wide hips"],
  tattoos: ["no tattoos", "small tattoos", "arm sleeve tattoo", "multiple tattoos", "full body tattoos", "navel piercing", "nipple piercings", "nose piercing"],
};

/**
 * Analyze Looks - Detect model appearance from uploaded photos using Grok vision
 * POST /api/generate/analyze-looks
 * Body: { imageUrls: string[] } — 1–3 photo URLs
 * Returns: { looks: { gender, age, ethnicity, hairColor, ... } } — keys/values match model look chips
 * Cost: 10 credits
 */
router.post("/generate/analyze-looks", authMiddleware, async (req, res) => {
  let creditDeducted = false;

  try {
    const pricing = await getGenerationPricing();
    const ANALYZE_CREDIT_COST = pricing.analyzeLooks;
    const { imageUrls, freeForOnboarding = false } = req.body;

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ success: false, message: "At least one image URL is required" });
    }

    const { deductCredits, getTotalCredits, checkAndExpireCredits } = await import("../services/credit.service.js");
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { onboardingCompleted: true },
    });
    const allowFreeOnboarding = !!freeForOnboarding && user && user.onboardingCompleted === false;
    if (!allowFreeOnboarding) {
      const balances = await checkAndExpireCredits(req.user.userId);
      if (getTotalCredits(balances) < ANALYZE_CREDIT_COST) {
        return res.status(403).json({ success: false, message: "Not enough credits. Auto-detect costs 10 credits." });
      }
      await deductCredits(req.user.userId, ANALYZE_CREDIT_COST);
      creditDeducted = true;
    }

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("AI service not configured");

    const validUrls = imageUrls.slice(0, 3);
    const checkedUrls = [];
    for (const url of validUrls) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") continue;
        const host = parsed.hostname.toLowerCase();
        if (host === "localhost" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || host === "0.0.0.0") continue;
        const head = await fetch(url, { method: "HEAD" });
        const size = parseInt(head.headers.get("content-length") || "0", 10);
        if (size > 20 * 1024 * 1024) {
          console.warn(`⚠️ Skipping oversized image (${(size / 1024 / 1024).toFixed(1)}MB): ${url.substring(0, 80)}`);
          continue;
        }
        if (size === 0 && !head.headers.get("content-length")) {
          const probe = await fetch(url, { headers: { Range: "bytes=0-20971519" } });
          const buf = await probe.arrayBuffer();
          if (buf.byteLength > 20 * 1024 * 1024) {
            console.warn(`⚠️ Skipping oversized image (probe ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB): ${url.substring(0, 80)}`);
            continue;
          }
        }
        checkedUrls.push(url);
      } catch {
        continue;
      }
    }
    if (checkedUrls.length === 0) {
      throw new Error("All provided images are too large or invalid for analysis (max 20MB each)");
    }

    const imageBlocks = checkedUrls.map(url => ({
      type: "image_url",
      image_url: { url },
    }));

    const optionsBlock = Object.entries(ANALYZE_LOOKS_OPTIONS)
      .map(([key, opts]) => `${key}: ${JSON.stringify(opts)}`)
      .join("\n");

    const systemPrompt = `You are an expert at analyzing photos of people to determine their physical appearance for AI model configuration.

Analyze the provided photo(s) and return a JSON object. Each value MUST be exactly one of the allowed options below (copy the string exactly).
- age: integer (estimated age 1–120). All other keys: use the exact option strings from the lists.

${optionsBlock}

Rules:
- Return ONLY valid JSON, no markdown or explanation.
- For each key, pick the single closest match from its allowed list. Copy the option string exactly (e.g. "blonde hair" not "blonde").
- If no option fits the person, use a short custom description (e.g. "auburn wavy hair"); it will be stored as a custom value.
- Omit a key only if the trait is impossible to determine from the photos.
- Age can be from 1 to 120 (use your best estimate from the photos).`;

    const requestBody = {
      model: "x-ai/grok-4.1-fast",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: "Analyze the person in these photos. Return JSON with age (integer) and the appearance keys above, using only the allowed option strings." },
          ],
        },
      ],
      max_tokens: 600,
      temperature: 0.1,
    };

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI service error ${aiResponse.status}: ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim();
    if (!rawContent) throw new Error("AI service returned empty response");

    const jsonStr = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    const toParse = jsonMatch ? jsonMatch[0] : jsonStr;
    let looks;
    try {
      looks = JSON.parse(toParse);
    } catch {
      throw new Error(`Failed to parse AI response as JSON: ${rawContent}`);
    }

    const sanitized = {};
    if (looks.age !== undefined) {
      const ageInt = parseInt(looks.age, 10);
      if (!isNaN(ageInt)) sanitized.age = Math.max(1, Math.min(120, ageInt));
    }
    for (const [key, allowed] of Object.entries(ANALYZE_LOOKS_OPTIONS)) {
      const value = typeof looks[key] === "string" ? looks[key].trim() : "";
      if (!value) continue;
      const canonical = allowed.find((opt) => opt.toLowerCase() === value.toLowerCase());
      if (canonical) {
        sanitized[key] = canonical;
      } else {
        // No chip match — store as custom so the Custom field is filled
        sanitized[key] = value;
      }
    }

    if (creditDeducted) {
      // Log credit transaction — non-fatal
      try {
        const { default: prismaClient } = await import("../lib/prisma.js");
        await prismaClient.creditTransaction.create({
          data: {
            userId: req.user.userId,
            type: "usage",
            amount: -ANALYZE_CREDIT_COST,
            description: "AI auto-detect model looks (Grok vision)",
          },
        });
      } catch (txErr) {
        console.error("⚠️ Failed to log credit transaction for analyze-looks (non-fatal):", txErr.message);
      }
    }

    res.json({
      success: true,
      looks: sanitized,
      creditsUsed: creditDeducted ? ANALYZE_CREDIT_COST : 0,
      freeOnboarding: !creditDeducted,
    });

  } catch (error) {
    console.error("Analyze looks error:", error.message);
    if (creditDeducted) {
      try {
        const { refundCredits } = await import("../services/credit.service.js");
        await refundCredits(req.user.userId, ANALYZE_CREDIT_COST);
      } catch (refundErr) {
        console.error("Failed to refund analyze-looks credit:", refundErr.message);
      }
    }
    res.status(500).json({ success: false, message: "Failed to analyze looks. Your credit has been refunded." });
  }
});

/**
 * Enhance Prompt - AI-powered prompt enhancement
 * POST /api/generate/enhance-prompt
 * Body: {
 *   prompt: string
 * }
 */
router.post("/generate/enhance-prompt", authMiddleware, async (req, res) => {
  let creditDeducted = false;

  try {
    // mode: "casual" | "nsfw" | "ultra-realism"
    const { prompt, mode = "casual", modelLooks } = req.body;
    const pricing = await getGenerationPricing();
    const ENHANCE_CREDIT_COST =
      mode === "nsfw" ? pricing.enhancePromptNsfw : pricing.enhancePromptDefault;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, message: "Prompt is required" });
    }

    const {
      deductCredits,
      refundCredits,
      getTotalCredits,
      checkAndExpireCredits,
    } = await import("../services/credit.service.js");

    const user = await checkAndExpireCredits(req.user.userId);
    if (getTotalCredits(user) < ENHANCE_CREDIT_COST) {
      return res.status(403).json({
        success: false,
        message: `Not enough credits. AI enhancement costs ${ENHANCE_CREDIT_COST} credits.`,
      });
    }

    if (ENHANCE_CREDIT_COST > 0) {
      await deductCredits(req.user.userId, ENHANCE_CREDIT_COST);
      creditDeducted = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Model-aware system prompts — each tuned to the exact generation backend
    // ─────────────────────────────────────────────────────────────────────────

    // Shared Nano Banana Pro rules (used by both casual and ultra-realism modes)
    const NANO_BANANA_SYSTEM = `You are an expert prompt engineer for Google's Nano Banana Pro image model — a photorealistic AI that excels at editorial-quality, cinema-grade imagery.

Your job: transform a rough user idea into a superprompt using the 6-component structure below. Think through the scene carefully before writing. Output ONLY the final prompt — no explanation, no headers, no preamble.

## CONTENT RULES (STRICT — non-negotiable):
- This model is SFW ONLY. Never include nudity, explicit sexuality, genitalia, bare breasts, explicit poses, or any adult-only content.
- If the user's idea is sexual or explicit, redirect it to a tasteful, sensual-but-clothed equivalent (e.g. "intimate bedroom scene" → elegant loungewear, soft lighting, suggestive but fully clothed).
- Suggestive is allowed; explicit is not.

## THE 6-COMPONENT STRUCTURE (include all six, in order):
1. SUBJECT — Hyper-specific. Age, ethnicity, build, key features, expression. E.g. "A 28-year-old Scandinavian woman with natural freckles, sun-kissed skin, calm confident gaze"
2. COMPOSITION — Camera framing + angle. E.g. "Tight 85mm portrait", "low-angle wide shot", "close-up, slight Dutch angle", "over-the-shoulder POV"
3. ACTION — Precise motion or pose. E.g. "mid-stride on wet pavement", "glancing over shoulder", "sipping espresso, one hand flat on marble table"
4. SETTING — Full environment with tactile detail. E.g. "rain-slicked neon Tokyo alley at midnight", "minimalist concrete loft with afternoon light streaming through floor-to-ceiling windows"
5. LIGHTING — Physics-specific. E.g. "volumetric fog, rim light from camera left", "harsh direct flash, deep shadows under chin", "golden hour backlight, warm lens flare"
6. STYLE/MEDIUM — Precise aesthetic. E.g. "editorial photography, raw 35mm film grain", "cinematic, teal and amber color grade", "1990s Polaroid aesthetic, slightly overexposed"

## PRO TECHNIQUES — apply where relevant:
- Micro-textures: skin pores, fabric fibers, brushed steel grain, water droplets on glass
- Camera gear: "shot on full-frame camera, 85mm f/1.8, shallow depth of field, natural bokeh"
- Lighting physics: "soft contact shadows", "volumetric god rays through blinds", "specular highlights on wet skin"
- Color grading: "Kodak Portra tones", "teal and amber LUT", "desaturated muted film look"
- Text in scene: use double quotes + specify font style (e.g. neon sign reads "OPEN", bold condensed sans-serif)
- Realism wrapper: always include concrete lighting (e.g. "soft key light", "golden hour backlight"), camera feel (e.g. "shallow depth of field", "natural bokeh"), and skin texture ("natural skin texture", "visible pores") where it fits the scene.
- Always end with negative constraints: "no nudity, no explicit content, no deformed hands, no extra limbs, no CGI, no cartoon, no plastic skin, no overly smooth AI skin, no motion blur, no watermark, no floating objects, no artifacts"

## OUTPUT:
Single flowing paragraph. Natural descriptive English. Max 130 words. End with the negative constraints line.`;

    const systemPrompts = {
      // Casual image generation — also uses Nano Banana Pro via kie.ai
      "casual": NANO_BANANA_SYSTEM,

      // Advanced ultra-realism — WaveSpeed Nano Banana Pro, identical model
      "ultra-realism": NANO_BANANA_SYSTEM,

      // NSFW — Illustrious ComfyUI checkpoint on RunPod — Danbooru tag format
      "nsfw": `You are an expert prompt engineer for an Illustrious-based NSFW ComfyUI diffusion model (checkpoint: pornworksRealPorn_Illustrious). This model is trained on Danbooru and responds best to tag-format prompts, not sentences.

Your job: transform a rough user idea into an optimized tag-format superprompt. Think through every visual detail carefully. Output ONLY the final tag list — no explanation, no preamble.

## RULES FOR THIS MODEL:
- Comma-separated short tag phrases — NOT sentences
- Always lead with quality boosters: "masterpiece, best quality, ultra-detailed, ultra-realistic, 8k uhd, RAW photo, sharp focus"
- Subject tags: precise age, ethnicity, body type, skin tone
- Feature tags: hair color, hair length, hair style, eye color
- Clothing tags: explicit and specific — fabric, fit, coverage level
- Action/pose: "arching back", "lying on satin sheets", "looking at viewer", "bedroom eyes", "parted lips"
- Setting: "indoor", "bedroom", "dimly lit room", "bokeh background", "soft ambient light"
- Camera: "close-up", "cowboy shot", "POV", "from below"
- Lighting: "soft diffused light", "dramatic side lighting", "candlelight glow", "rim light"
- Always end with negative: "worst quality, low quality, deformed hands, extra limbs, bad anatomy, watermark, text, blurry, artifacts"

## OUTPUT:
Tag list, comma-separated. 40–70 tags.`,
    };

    const systemPrompt = systemPrompts[mode] || systemPrompts["casual"];

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      throw new Error("AI service not configured");
    }

    const modelContext = modelLooks && typeof modelLooks === "object" && Object.keys(modelLooks).length > 0
      ? `\n\nMODEL APPEARANCE (the subject of this image — always incorporate these traits):\n${
          Object.entries(modelLooks)
            .filter(([, v]) => v)
            .map(([k, v]) => `• ${k}: ${v}`)
            .join("\n")
        }`
      : "";

    const callOpenRouterEnhance = async (temperature, maxTokens) => {
      const requestBody = {
        model: "x-ai/grok-4.1-fast",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `User's idea: "${prompt.trim()}"${modelContext}\n\nWrite the superprompt now:` },
        ],
        max_tokens: maxTokens,
        temperature,
      };
      const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });
      if (!aiResponse.ok) {
        const err = await aiResponse.text();
        throw new Error(`AI service error ${aiResponse.status}: ${err}`);
      }
      const aiData = await aiResponse.json();
      return aiData.choices?.[0]?.message?.content;
    };

    let rawContent = await callOpenRouterEnhance(0.7, 400);
    if (!rawContent || !String(rawContent).trim()) {
      console.warn("[enhance-prompt] Empty first response; retrying with lower temperature");
      rawContent = await callOpenRouterEnhance(0.3, 500);
    }
    if (!rawContent || !String(rawContent).trim()) {
      throw new Error("AI service returned empty response");
    }
    const enhancedPrompt = String(rawContent).trim();

    // Log credit transaction — non-fatal: if this fails the user still gets their prompt
    if (ENHANCE_CREDIT_COST > 0) {
      try {
        const { default: prismaClient } = await import("../lib/prisma.js");
        await prismaClient.creditTransaction.create({
          data: {
            userId: req.user.userId,
            type: "usage",
            amount: -ENHANCE_CREDIT_COST,
            description: `AI prompt enhancement (${mode} mode, Grok reasoning)`,
          },
        });
      } catch (txErr) {
        console.error("⚠️ Failed to log credit transaction for prompt enhancement (non-fatal):", txErr.message);
      }
    }

    res.json({
      success: true,
      enhancedPrompt,
      creditsUsed: ENHANCE_CREDIT_COST,
    });

  } catch (error) {
    console.error("Prompt enhancement error:", error.message);
    // Refund credit if it was deducted before the AI call failed
    if (creditDeducted) {
      try {
        const { refundCredits } = await import("../services/credit.service.js");
        await refundCredits(req.user.userId, ENHANCE_CREDIT_COST);
        console.log(`✅ Refunded ${ENHANCE_CREDIT_COST} credit to user ${req.user.userId} after enhancement failure`);
      } catch (refundErr) {
        console.error(`❌ CRITICAL: Failed to refund enhancement credit for user ${req.user.userId}:`, refundErr.message);
      }
    }
    res.status(500).json({
      success: false,
      message: "Failed to enhance prompt. Your credit has been refunded.",
    });
  }
});

/**
 * Prompt-Based Image Generation - Create images from text prompts using model's face
 * POST /api/generate/prompt-image
 * Body: {
 *   modelId: uuid,
 *   prompt: string,
 *   quantity: number (1-10, default 1),
 *   style: 'professional' | 'amateur' (default: 'professional'),
 *   contentRating: 'pg13' | 'sexy' (default: 'pg13')
 * }
 * Pricing: 10-20 credits per image (engine-dependent)
 */
router.post(
  "/generate/prompt-image",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generatePromptBasedImage,
);

/**
 * Get ElevenLabs voices for talking head
 * GET /api/voices
 */
router.get("/voices", authMiddleware, getVoices);

/**
 * Generate voice preview in specified language
 * GET /api/voices/:voiceId/preview?language=en|sk|cs
 */
router.get("/voices/:voiceId/preview", authMiddleware, getVoicePreview);

/**
 * Talking Head Video Generation - Animate image with speech
 * POST /api/generate/talking-head
 * Body: {
 *   imageUrl: string,
 *   voiceId: string,
 *   text: string (5-2000 characters)
 * }
 * Pricing: ~70 credits base, scales with text length
 */
router.post(
  "/generate/talking-head",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateTalkingHeadVideo,
);

// Monthly generation counts for the current user (must be before /:id to avoid param conflict)
router.get("/generations/monthly-stats", authMiddleware, getMonthlyStats);

// Get single generation by ID (for polling)
router.get("/generations/:id", authMiddleware, getGenerationById);

// Get generation history
router.get("/generations", authMiddleware, generationsLimiter, getGenerations); // ✅ FIX: Added generationsLimiter

// Batch delete generations
router.post(
  "/generations/batch-delete",
  authMiddleware,
  batchDeleteGenerations,
);

// Cleanup stuck generations (watchdog endpoint - can be called by cron or manually)
router.post(
  "/admin/cleanup-generations",
  authMiddleware,
  adminMiddleware,
  cleanupStuckGenerations,
);

// Cron-safe watchdog for callback-only KIE flows (no auth, requires CRON_SECRET)
router.get("/cron/kie-recovery", async (req, res) => {
  const secret = req.query.secret || req.headers["x-cron-secret"];
  const isVercelCron = Boolean(req.headers["x-vercel-cron"]);
  if (!process.env.CRON_SECRET) {
    console.warn("[cron/kie-recovery] CRON_SECRET is not set; relying on x-vercel-cron header only.");
  }
  if (!isVercelCron && process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return cleanupStuckGenerations(req, res);
});

// ============================================
// PRICING PLANS
// ============================================
router.get("/plans", (req, res) => {
  res.json({
    success: true,
    plans: [
      {
        id: "starter",
        name: "Starter",
        price: 29,
        imageCredits: 750,
        videoCredits: 150,
        features: [
          "750 AI images with identity preservation",
          "150 AI videos with motion transfer",
          "Your exact WaveSpeed workflow",
          "Email support",
        ],
      },
      {
        id: "creator",
        name: "Creator",
        price: 59,
        imageCredits: 2000,
        videoCredits: 400,
        featured: true,
        features: [
          "2000 AI images",
          "400 AI videos",
          "Identity preservation",
          "Motion transfer",
          "Priority support",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: 99,
        imageCredits: 5000,
        videoCredits: 1000,
        features: [
          "5000 AI images",
          "1000 AI videos",
          "All features",
          "24/7 support",
        ],
      },
      {
        id: "agency",
        name: "Agency",
        price: 299,
        imageCredits: 20000,
        videoCredits: 4000,
        features: [
          "20000 AI images",
          "4000 AI videos",
          "White-label",
          "API access",
          "Dedicated support",
        ],
      },
    ],
  });
});

// ============================================
// STRIPE PAYMENT ROUTES
// ============================================
router.use("/stripe", stripeRoutes);

// ============================================
// CRYPTO PAYMENT ROUTES (NOWPayments)
// ============================================
router.use("/crypto", nowpaymentsRoutes);
router.use("/referrals", referralRoutes);
router.use("/drafts", draftRoutes);
router.use("/reformatter", reformatterRoutes);

// ============================================
// ADMIN ROUTES (Backup, Stats, User Management)
// ============================================
router.use("/admin", adminRoutes);

// ============================================
// DESIGNER STUDIO (Admin only — Nano Banana Pro, Kling I2V, Kling Motion)
// ============================================
router.use("/designer-studio", authMiddleware, adminMiddleware, designerStudioRoutes);

// ============================================
// TEST REPLICATE API (Admin only, hidden)
// ============================================
import Replicate from "replicate";
import { isR2Configured, uploadFileToR2, getR2PresignedUploadUrl } from "../utils/r2.js";

router.post(
  "/test-replicate/upload",
  authMiddleware,
  adminMiddleware,
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: "No file uploaded" });
      }

      if (!isR2Configured()) {
        return res.status(503).json({ success: false, error: "File storage is not configured" });
      }

      const url = await uploadFileToR2(req.file, "test");
      res.json({ success: true, url });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ success: false, error: "Upload failed" });
    }
  },
);

// Handle Multer upload limits with explicit user-facing message.
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "File too big. Max upload size is 200MB.",
      code: "FILE_TOO_BIG",
    });
  }
  if (err && err.message && /only mp3/i.test(err.message)) {
    return res.status(400).json({ success: false, message: err.message });
  }
  return next(err);
});

router.post(
  "/test-replicate/generate",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { prompt, model, imageUrl, referenceUrls } = req.body;

      // Validate model
      const allowedModels = ["flux-nsfw", "seedream", "sdxl"];
      if (!allowedModels.includes(model)) {
        return res.status(400).json({ success: false, error: "Invalid model" });
      }

      if (!prompt) {
        return res
          .status(400)
          .json({ success: false, error: "Prompt is required" });
      }

      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
      });

      let output;
      let usedModel;

      if (model === "flux-nsfw") {
        // Flux NSFW uncensored model
        usedModel = "lucataco/flux-uncensored";
        output = await replicate.run("lucataco/flux-uncensored", {
          input: {
            prompt: prompt,
            go_fast: true,
            megapixels: "1",
            num_outputs: 1,
            aspect_ratio: "9:16",
            output_format: "webp",
            output_quality: 80,
            num_inference_steps: 4,
          },
        });
      } else if (model === "seedream") {
        // Seedream V4.5 with identity
        usedModel = "bytedance/seedream-v4.5";
        const images =
          referenceUrls && referenceUrls.length > 0
            ? [...referenceUrls, imageUrl].filter(Boolean)
            : undefined;

        output = await replicate.run("bytedance/seedream-v4.5", {
          input: {
            prompt: prompt,
            image: images,
            aspect_ratio: "9:16",
            size: "1K",
            guidance_scale: 2.5,
            num_outputs: 1,
          },
        });
      } else if (model === "sdxl") {
        // SDXL with img2img support and safety checker disabled
        usedModel = "stability-ai/sdxl";
        const sdxlInput = {
          prompt: prompt,
          negative_prompt: "blurry, bad quality, distorted",
          width: 1024,
          height: 1024,
          num_outputs: 1,
          disable_safety_checker: true,
        };

        // Add reference image for img2img mode
        if (imageUrl) {
          sdxlInput.image = imageUrl;
          sdxlInput.prompt_strength = 0.8; // How much to transform (0-1)
        }

        output = await replicate.run(
          "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc",
          {
            input: sdxlInput,
          },
        );
      }

      console.log("[TEST] Raw output type:", typeof output, output);

      // Handle different output formats from different models
      let resultImage;
      if (Array.isArray(output)) {
        // Most models return array of URLs or FileOutput objects
        const firstItem = output[0];
        resultImage =
          typeof firstItem === "string"
            ? firstItem
            : firstItem?.url || firstItem;
      } else if (typeof output === "object" && output !== null) {
        // Some models return FileOutput object with .url()
        resultImage = output.url ? output.url() : JSON.stringify(output);
      } else {
        resultImage = output;
      }

      console.log("[TEST] Parsed image URL:", resultImage);

      res.json({
        success: true,
        image: resultImage,
        model: usedModel,
        prompt: prompt,
        output: output, // Include raw for debugging
      });
    } catch (error) {
      console.error("Test Replicate error:", error);
      res.status(500).json({ success: false, error: "Test generation failed" });
    }
  },
);

// ============================================
// DOWNLOAD PROXY - Fixes CORS issues for file downloads
// ============================================
// Authenticated endpoint for CORS-safe downloads from trusted hosts
function isAllowedDownloadHost(hostname) {
  const allowedDomains = [
    "r2.dev",
    "cloudfront.net",
    "wavespeed.ai",
    "replicate.delivery",
  ];
  const lower = String(hostname || "").toLowerCase();
  return allowedDomains.some(
    (domain) => lower === domain || lower.endsWith(`.${domain}`),
  );
}

const DOWNLOAD_PROXY_MAX_BYTES = 120 * 1024 * 1024; // 120 MB
const DOWNLOAD_PROXY_TIMEOUT_MS = 20_000;
const DOWNLOAD_DEBUG_LOGS = process.env.NODE_ENV !== "production";
const debugDownload = (...args) => {
  if (DOWNLOAD_DEBUG_LOGS) console.log("[DOWNLOAD]", ...args);
};

/** Strip chars that break Node/HTTP headers (CRLF, NUL, non-ASCII) — use ASCII fallback + RFC 5987 filename*. */
function sanitizeFilenameForContentDisposition(name) {
  const s = String(name || "download")
    .replace(/[\r\n\x00-\x1f\x7f]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  const base = s.length > 0 ? s.slice(0, 180) : "download";
  return /^\.+$/.test(base) ? "download" : base;
}

/** Safe Content-Disposition for attachment (avoids ERR_INVALID_CHAR from emoji / @ / Unicode). */
function buildAttachmentContentDisposition(originalFilename) {
  const asciiName = sanitizeFilenameForContentDisposition(originalFilename);
  const utf8Star = encodeURIComponent(String(originalFilename || "download"))
    .replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Star}`;
}

router.get("/download", authMiddleware, downloadLimiter, async (req, res) => {
  try {
    const { url, filename } = req.query;

    debugDownload("Request received:", {
      url: url?.substring(0, 50),
      filename,
    });

    if (!url) {
      return res.status(400).json({ success: false, error: "URL is required" });
    }

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL" });
    }
    const isAllowed = isAllowedDownloadHost(urlObj.hostname);

    debugDownload("Domain check:", {
      hostname: urlObj.hostname,
      isAllowed,
    });

    if (!isAllowed) {
      return res
        .status(403)
        .json({ success: false, error: "Domain not allowed" });
    }

    // Fetch with a timeout to avoid hanging connections
    debugDownload("Fetching file from:", url.substring(0, 80));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_PROXY_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      debugDownload("Fetch failed with status:", response.status);
      return res
        .status(response.status)
        .json({ success: false, error: "Failed to fetch file" });
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (Number.isFinite(contentLength) && contentLength > DOWNLOAD_PROXY_MAX_BYTES) {
      return res.status(413).json({
        success: false,
        error: "File too large to download via proxy",
      });
    }

    // Get the file buffer
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > DOWNLOAD_PROXY_MAX_BYTES) {
      return res.status(413).json({
        success: false,
        error: "File too large to download via proxy",
      });
    }
    debugDownload("File fetched, size:", buffer.byteLength);

    // PRIORITY 1: Detect content type from response headers (most reliable)
    const serverContentType = response.headers.get("content-type")?.toLowerCase() || "";
    debugDownload("Server content-type:", serverContentType);

    let extension = "bin";
    let contentType = "application/octet-stream";

    // Check server content-type first (most reliable for videos)
    if (serverContentType.includes("video/mp4") || serverContentType.includes("video/")) {
      extension = "mp4";
      contentType = "video/mp4";
    } else if (serverContentType.includes("image/png")) {
      extension = "png";
      contentType = "image/png";
    } else if (serverContentType.includes("image/jpeg") || serverContentType.includes("image/jpg")) {
      extension = "jpg";
      contentType = "image/jpeg";
    } else if (serverContentType.includes("image/webp")) {
      extension = "webp";
      contentType = "image/webp";
    } else if (serverContentType.includes("image/gif")) {
      extension = "gif";
      contentType = "image/gif";
    } else {
      // PRIORITY 2: Fallback to URL path or filename if server didn't provide content-type
      const urlPath = urlObj.pathname.toLowerCase();
      
      if (urlPath.includes(".mp4") || (filename && filename.toLowerCase().endsWith(".mp4"))) {
        extension = "mp4";
        contentType = "video/mp4";
      } else if (urlPath.includes(".png") || (filename && filename.toLowerCase().endsWith(".png"))) {
        extension = "png";
        contentType = "image/png";
      } else if (urlPath.includes(".jpg") || urlPath.includes(".jpeg") ||
                (filename && (filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".jpeg")))) {
        extension = "jpg";
        contentType = "image/jpeg";
      } else if (urlPath.includes(".webp") || (filename && filename.toLowerCase().endsWith(".webp"))) {
        extension = "webp";
        contentType = "image/webp";
      } else {
        // PRIORITY 3: Magic byte detection for unknown types
        const bytes = new Uint8Array(buffer.slice(0, 12));
        
        // MP4 signature: starts with ftyp at byte 4
        if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
          extension = "mp4";
          contentType = "video/mp4";
          debugDownload("Detected MP4 from magic bytes");
        }
        // PNG signature: 89 50 4E 47
        else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
          extension = "png";
          contentType = "image/png";
          debugDownload("Detected PNG from magic bytes");
        }
        // JPEG signature: FF D8 FF
        else if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
          extension = "jpg";
          contentType = "image/jpeg";
          debugDownload("Detected JPEG from magic bytes");
        }
        // WebP signature: RIFF....WEBP
        else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                 bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
          extension = "webp";
          contentType = "image/webp";
          debugDownload("Detected WebP from magic bytes");
        }
        // GIF signature: GIF89a or GIF87a
        else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
          extension = "gif";
          contentType = "image/gif";
          debugDownload("Detected GIF from magic bytes");
        }
      }
    }

    debugDownload("Final detection - extension:", extension, "contentType:", contentType);

    // Generate filename - ALWAYS use detected extension to prevent wrong file types
    let downloadFilename;
    if (filename) {
      // Remove any existing extension and add the correct one based on actual content
      const baseName = filename.replace(/\.[^/.]+$/, "");
      downloadFilename = `${baseName}.${extension}`;
    } else {
      downloadFilename = `download_${Date.now()}.${extension}`;
    }
    
    debugDownload("Original filename:", filename, "-> Final filename:", downloadFilename);

    // Set headers for download
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", buildAttachmentContentDisposition(downloadFilename));
    res.setHeader("Content-Length", buffer.byteLength);

    debugDownload(
      "Sending file:",
      downloadFilename,
      "type:",
      contentType,
    );

    // Send the file
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("[DOWNLOAD] Error:", error);
    res.status(500).json({ success: false, error: "Download failed" });
  }
});

export default router;
