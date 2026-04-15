import express from "express";
import prisma from "../lib/prisma.js";
import { isAllowedPublicAssetHost } from "../utils/publicAssetHost.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import { enforceGeneratedContentDeletionBlock } from "../utils/generated-content-deletion-guard.js";
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
  generateCreatorStudio,
  generateCreatorStudioVideo,
  extendCreatorStudioVideo,
  getCreatorStudioVideo4k,
  getCreatorStudioVideo1080p,
  uploadCreatorStudioMask,
  listCreatorStudioAssets,
  createCreatorStudioAsset,
  deleteCreatorStudioAsset,
} from "../controllers/generation.controller.js";
import { processPendingBlobRemirrorQueue } from "../services/blob-remirror-queue.service.js";
import { runSignupNoPurchaseWinbackCampaign } from "../services/signup-winback-email.service.js";
import { runPiapiWatchdog, runWavespeedSeedreamWatchdog } from "../services/generation-poller.service.js";
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
  trialUploadFromBlobUrls,
  completeOnboarding,
  lockSpecialOffer,
} from "../controllers/model.controller.js";
import {
  getVoicePlatformStatus,
  getModelVoiceStudio,
  postModelVoiceDesignPreviews,
  postModelVoiceDesignConfirm,
  postModelVoiceClone,
  postModelVoicesDesignPreviews,
  postModelVoicesDesignConfirm,
  postModelVoicesClone,
  postSelectModelVoice,
  deleteModelVoice,
  postGenerateModelVoiceAudio,
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
  getNsfwPlanGenerationJobStatus,
  autoSelectChips,
  getNsfwAutoSelectJobStatus,
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
  recoverStuckNsfwGenerations,
  adminRecoverFailedNsfwRunpod,
  recoverStaleLoraTrainings,
} from "../controllers/nsfw.controller.js";
import multer from "multer";
import { handleUpload } from "@vercel/blob/client";
import { isVercelBlobConfigured, uploadBufferToBlob } from "../utils/kieUpload.js";
import {
  validateNanoBananaInputImages,
  validateSeedreamEditImages,
} from "../utils/fileValidation.js";
import {
  validateGenerationUploadFull,
  validateGenerationUploadSync,
  sendUploadGuardResponse,
} from "../lib/generationUploadGuards.js";
import {
  getBlobClientUploadMaxBytes,
  formatBlobUploadMaxForMessage,
} from "../config/blobUpload.js";

const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/x-mp4", "video/quicktime", "video/webm",
];

async function registerKieTaskForGeneration(taskId, generationId, userId, kind = "generation") {
  if (!taskId || !generationId) return;
  await prisma.kieTask.upsert({
    where: { taskId },
    update: {
      provider: "kie",
      entityType: "generation",
      entityId: generationId,
      step: "final",
      userId: userId || null,
      status: "processing",
      payload: { type: kind },
      errorMessage: null,
      outputUrl: null,
      completedAt: null,
    },
    create: {
      taskId,
      provider: "kie",
      entityType: "generation",
      entityId: generationId,
      step: "final",
      userId: userId || null,
      status: "processing",
      payload: { type: kind },
    },
  });
}

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
  limits: { fileSize: getBlobClientUploadMaxBytes() },
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
  auditSubscriptionRefills,
  reconcileSubscriptionRefills,
  syncUserStripeState,
  reconcileAllSubscriptions,
  reconcileReferralCommissions,
  listUserApiKeys,
  createUserApiKey,
  revokeUserApiKey,
  listMyApiKeys,
  createMyApiKey,
  regenerateMyApiKey,
  revokeMyApiKey,
  getVoiceHostingDue,
  postVoiceHostingRunBilling,
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
import { getGenerationPricing, getGenerationPricingContract } from "../services/generation-pricing.service.js";
import { getEffectiveNudesPackPoses } from "../services/nudes-pack-config.service.js";
import { getPromptTemplateValue } from "../services/prompt-template-config.service.js";
import {
  submitModelCloneXJob,
} from "../services/modelcloneX.service.js";
import {
  MODELCLONE_X_CATEGORY,
  LEGACY_SOULX_CATEGORY,
  TRAINED_LORA_CATEGORIES_MODELCLONE_X,
} from "../constants/modelcloneX.js";
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
import avatarRoutes from "./avatar.routes.js";
import heygenCallbackRoutes from "./heygen-callback.routes.js";
import landerNewRoutes from "./lander-new.routes.js";
import adminLanderNewRoutes from "./admin-lander-new.routes.js";
import affiliateLanderPublicRoutes from "./affiliate-lander-public.routes.js";
import adminAffiliateLanderRoutes from "./admin-affiliate-lander.routes.js";
import { sendFrontendErrorAlert } from "../services/email.service.js";
import rateLimit from "express-rate-limit";
import { getAppBranding } from "../services/branding.service.js";
import { getTutorialCatalog } from "../services/tutorial-videos.service.js";

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

router.get("/tutorials/catalog", async (_req, res) => {
  try {
    const catalog = await getTutorialCatalog();
    res.json({ success: true, tutorials: catalog.entries, byKey: catalog.byKey });
  } catch (error) {
    console.error("Tutorial catalog endpoint error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch tutorial catalog" });
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

    for (const file of filesToProcess) {
      const check = validateGenerationUploadSync(file, "modelPhoto");
      if (!check.ok) return sendUploadGuardResponse(res, check);
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
router.post("/nsfw/nudes-pack", authMiddleware, (_req, res) => res.status(503).json({ success: false, message: "Nudes Pack is temporarily unavailable." }));
router.get("/nsfw/nudes-pack-poses", authMiddleware, (_req, res) => res.status(503).json({ success: false, message: "Nudes Pack is temporarily unavailable." }));
router.post("/nsfw/generate-prompt", authMiddleware, generationLimiter, generateNsfwPrompt);
router.post("/nsfw/plan-generation", authMiddleware, generationLimiter, planNsfwGeneration);
router.get("/nsfw/plan-generation/status/:jobId", authMiddleware, getNsfwPlanGenerationJobStatus);
router.post("/nsfw/auto-select", authMiddleware, generationLimiter, autoSelectChips);
router.get("/nsfw/auto-select/status/:jobId", authMiddleware, getNsfwAutoSelectJobStatus);
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
router.get("/auth/impersonate-login", authLimiter, async (req, res) => {
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
    const targetUser = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { banLocked: true },
    });
    if (targetUser?.banLocked) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BAN_LOCKED",
        error: "This account has been suspended.",
      });
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

// Current user — HTTP API keys (Business plan; same storage as admin-issued keys)
router.get("/user/api-keys", authMiddleware, listMyApiKeys);
router.post("/user/api-keys", authMiddleware, authLimiter, createMyApiKey);
router.post("/user/api-keys/:keyId/regenerate", authMiddleware, authLimiter, regenerateMyApiKey);
router.delete("/user/api-keys/:keyId", authMiddleware, authLimiter, revokeMyApiKey);

// ============================================
// FILE UPLOAD ROUTES
// ============================================

// Upload config: when Blob is configured, client should use direct-to-blob (no file through server → no 413).
router.get("/upload/config", authMiddleware, (req, res) => {
  res.json({
    directToBlob: isVercelBlobConfigured(),
    maxUploadBytes: getBlobClientUploadMaxBytes(),
    maxUploadLabel: formatBlobUploadMaxForMessage(),
  });
});

// Merged generation pricing (admin-overridable) — for UI that must match server charges (e.g. Create AI Model).
router.get("/pricing/generation", authMiddleware, async (_req, res) => {
  try {
    const pricing = await getGenerationPricing();
    res.json({ success: true, pricing, contract: getGenerationPricingContract() });
  } catch (error) {
    console.error("GET /pricing/generation error:", error);
    res.status(500).json({ success: false, message: "Failed to load pricing" });
  }
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
          maximumSizeInBytes: getBlobClientUploadMaxBytes(),
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

// Presigned URL for direct browser -> R2 upload (legacy fallback).
router.post("/upload/presign", authMiddleware, async (req, res) => {
  try {
    if (isBlobOnlyStorageMode()) {
      return res.status(409).json({
        success: false,
        error: "R2-style presigned upload is disabled in Blob-only mode. Use /api/upload/blob instead.",
      });
    }
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

      const guard = await validateGenerationUploadFull(req.file, "default");
      if (!guard.ok) return sendUploadGuardResponse(res, guard);

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
router.get(
  "/models/:modelId/voices",
  authMiddleware,
  modelsLimiter,
  getModelVoiceStudio,
);
router.post(
  "/models/:modelId/voices/design-previews",
  authMiddleware,
  voiceDesignPreviewLimiter,
  postModelVoicesDesignPreviews,
);
router.post(
  "/models/:modelId/voices/design-confirm",
  authMiddleware,
  generationLimiter,
  postModelVoicesDesignConfirm,
);
router.post(
  "/models/:modelId/voices/clone",
  authMiddleware,
  generationLimiter,
  voiceCloneUpload.single("audio"),
  postModelVoicesClone,
);
router.post(
  "/models/:modelId/voices/:voiceId/select",
  authMiddleware,
  generationLimiter,
  postSelectModelVoice,
);
router.delete(
  "/models/:modelId/voices/:voiceId",
  authMiddleware,
  generationLimiter,
  deleteModelVoice,
);
router.post(
  "/models/:modelId/voices/generate-audio",
  authMiddleware,
  generationLimiter,
  postGenerateModelVoiceAudio,
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
router.get("/admin/users/:id/api-keys", authMiddleware, adminMiddleware, listUserApiKeys);
router.post("/admin/users/:id/api-keys", authMiddleware, adminMiddleware, createUserApiKey);
router.delete("/admin/users/:id/api-keys/:keyId", authMiddleware, adminMiddleware, revokeUserApiKey);
router.get("/admin/users/:id/purchases", authMiddleware, adminMiddleware, getUserPurchases);
router.post("/admin/users/:id/purchases/:purchaseId/refund", authMiddleware, adminMiddleware, refundUserPurchase);
router.post("/admin/users/:id/stripe-sync", authMiddleware, adminMiddleware, syncUserStripeState);
router.post("/admin/subscriptions/reconcile", authMiddleware, adminMiddleware, reconcileAllSubscriptions);
router.post("/admin/subscriptions/refills/audit", authMiddleware, adminMiddleware, auditSubscriptionRefills);
router.post("/admin/subscriptions/refills/reconcile", authMiddleware, adminMiddleware, reconcileSubscriptionRefills);
router.post("/admin/referrals/reconcile", authMiddleware, adminMiddleware, reconcileReferralCommissions);
router.get("/admin/voice-hosting/due", authMiddleware, adminMiddleware, getVoiceHostingDue);
router.post("/admin/voice-hosting/run", authMiddleware, adminMiddleware, postVoiceHostingRunBilling);
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
router.post(
  "/admin/nsfw/recover-failed-runpod",
  authMiddleware,
  adminMiddleware,
  adminRecoverFailedNsfwRunpod,
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
      const providerInputCheck = engine === "seedream"
        ? await validateSeedreamEditImages(identityImages, "wavespeed")
        : await validateNanoBananaInputImages(identityImages);
      if (!providerInputCheck.valid) {
        return res.status(400).json({ success: false, error: providerInputCheck.message });
      }

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
          ? {}
          : { aspectRatio: "9:16", resolution: "2K", outputFormat: "png" };
        opts.onTaskCreated = async (taskId) => {
          await prisma.generation.update({
            where: { id: generation.id },
            data: {
              replicateModel: engine === "seedream"
                ? `wavespeed-seedream:${taskId}`
                : `kie-task:${taskId}`,
            },
          });
          if (engine !== "seedream") {
            await registerKieTaskForGeneration(taskId, generation.id, userId, "advanced-image");
          }
        };
        try {
          const result = engine === "seedream"
            ? await generateImageWithSeedreamWaveSpeed(identityImages, enrichedPrompt, opts)
            : await generateImageWithNanoBananaKie(identityImages, enrichedPrompt, opts);
          if (result?.success && result?.deferred && result?.taskId) {
            await prisma.generation.update({
              where: { id: generation.id },
              data: {
                replicateModel: engine === "seedream"
                  ? `wavespeed-seedream:${result.taskId}`
                  : `kie-task:${result.taskId}`,
              },
            });
            if (engine !== "seedream") {
              await registerKieTaskForGeneration(result.taskId, generation.id, userId, "advanced-image");
            }
            console.log(`🍌 [Advanced] ${engine === "seedream" ? "WaveSpeed" : "KIE"} ${engine} submitted; result will arrive via callback (task ${result.taskId})`);
          } else if (result?.success && result?.outputUrl) {
            await prisma.generation.update({
              where: { id: generation.id },
              data: { status: "completed", outputUrl: result.outputUrl, completedAt: new Date() },
            });
            console.log(`🍌 [Advanced] ${engine === "seedream" ? "WaveSpeed" : "KIE"} ${engine} complete: ${generation.id}`);
          } else {
            const errMsg = result?.error || "Generation failed";
            const friendlyMessage = getUserFriendlyGenerationError(errMsg);
            await refundGeneration(generation.id).catch(() => {});
            await prisma.generation.update({
              where: { id: generation.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb(friendlyMessage), completedAt: new Date() },
            }).catch(() => {});
            console.error(`🍌 [Advanced] ${engine === "seedream" ? "WaveSpeed" : "KIE"} ${engine} failed: ${generation.id}`, errMsg);
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

/** Strip markdown fences and extract a single top-level JSON object or array string. */
function extractTopLevelJsonSlice(s) {
  const t = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!t) return null;
  const startObj = t.indexOf("{");
  const startArr = t.indexOf("[");
  const useArray = startArr !== -1 && (startObj === -1 || startArr < startObj);
  const open = useArray ? "[" : "{";
  const close = useArray ? "]" : "}";
  const start = useArray ? startArr : startObj;
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Models sometimes return a JSON array (one object per image). We need one looks object.
 * - age: median of numeric ages present
 * - other keys: first non-empty wins (image order: face refs before body)
 */
function mergeAnalyzeLooksArray(objects) {
  const merged = {};
  const ages = [];
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    if (obj.age !== undefined && obj.age !== null) {
      const a = parseInt(String(obj.age).trim(), 10);
      if (!Number.isNaN(a)) ages.push(Math.max(1, Math.min(120, a)));
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "age") continue;
      const str = typeof v === "string" ? v.trim() : v != null && v !== "" ? String(v).trim() : "";
      if (str && merged[k] == null) merged[k] = str;
    }
  }
  if (ages.length) {
    ages.sort((a, b) => a - b);
    const mid = Math.floor(ages.length / 2);
    merged.age =
      ages.length % 2 !== 0 ? ages[mid] : Math.round((ages[mid - 1] + ages[mid]) / 2);
  }
  return merged;
}

function parseAnalyzeLooksResponse(rawContent) {
  const trimmed = rawContent?.trim();
  if (!trimmed) throw new Error("AI service returned empty response");

  const slice = extractTopLevelJsonSlice(trimmed) ?? trimmed;
  let parsed;
  try {
    parsed = JSON.parse(slice);
  } catch {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`Failed to parse AI response as JSON: ${trimmed.slice(0, 500)}`);
    }
  }

  if (Array.isArray(parsed)) {
    const objects = parsed.filter((x) => x && typeof x === "object" && !Array.isArray(x));
    if (objects.length === 0) throw new Error("AI returned an empty JSON array");
    return objects.length === 1 ? objects[0] : mergeAnalyzeLooksArray(objects);
  }
  if (parsed && typeof parsed === "object") return parsed;
  throw new Error("AI response JSON must be an object or array of objects");
}

/**
 * Analyze Looks - Detect model appearance from uploaded photos using Grok vision
 * POST /api/generate/analyze-looks
 * Body: { imageUrls: string[] } — 1–3 photo URLs
 * Returns: { looks: { gender, age, ethnicity, hairColor, ... } } — keys/values match model look chips
 * Cost: 10 credits
 */
router.post("/generate/analyze-looks", authMiddleware, async (req, res) => {
  let creditDeducted = false;
  let ANALYZE_CREDIT_COST = 0;
  const URL_CHECK_TIMEOUT_MS = 12_000;
  const AI_TIMEOUT_MS = 70_000;

  try {
    const pricing = await getGenerationPricing();
    ANALYZE_CREDIT_COST = pricing.analyzeLooks;
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

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      return res.status(503).json({ success: false, message: "AI service not configured" });
    }

    const validUrls = imageUrls.slice(0, 3);
    const checkedUrls = [];
    for (const url of validUrls) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") continue;
        const host = parsed.hostname.toLowerCase();
        if (host === "localhost" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || host === "0.0.0.0") continue;
        const head = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(URL_CHECK_TIMEOUT_MS),
        });
        const size = parseInt(head.headers.get("content-length") || "0", 10);
        if (size > 20 * 1024 * 1024) {
          console.warn(`⚠️ Skipping oversized image (${(size / 1024 / 1024).toFixed(1)}MB): ${url.substring(0, 80)}`);
          continue;
        }
        if (size === 0 && !head.headers.get("content-length")) {
          const probe = await fetch(url, {
            headers: { Range: "bytes=0-20971519" },
            signal: AbortSignal.timeout(URL_CHECK_TIMEOUT_MS),
          });
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
      return res.status(400).json({
        success: false,
        message:
          "No usable images: each must be a public https URL under 20MB. Check size and that the link returns the image (not a login page).",
      });
    }

    if (!allowFreeOnboarding) {
      const balances = await checkAndExpireCredits(req.user.userId);
      if (getTotalCredits(balances) < ANALYZE_CREDIT_COST) {
        return res.status(403).json({ success: false, message: "Not enough credits. Auto-detect costs 10 credits." });
      }
      await deductCredits(req.user.userId, ANALYZE_CREDIT_COST);
      creditDeducted = true;
    }

    const imageBlocks = checkedUrls.map(url => ({
      type: "image_url",
      image_url: { url },
    }));

    const optionsBlock = Object.entries(ANALYZE_LOOKS_OPTIONS)
      .map(([key, opts]) => `${key}: ${JSON.stringify(opts)}`)
      .join("\n");

    let systemPrompt = `You are an expert at analyzing photos of people to determine their physical appearance for AI model configuration.

The images are always the SAME person (different angles or face/body shots). Return ONE JSON object describing that single person. Do NOT return a JSON array of multiple people.

Each value MUST be exactly one of the allowed options below (copy the string exactly), except age is an integer 1–120.
- age: integer (estimated age 1–120). All other keys: use the exact option strings from the lists.

${optionsBlock}

Rules:
- Return ONLY one JSON object (not an array), no markdown or explanation.
- For each key, pick the single closest match from its allowed list. Copy the option string exactly (e.g. "blonde hair" not "blonde").
- If no option fits the person, use a short custom description (e.g. "auburn wavy hair"); it will be stored as a custom value.
- Omit a key only if the trait is impossible to determine from any of the photos.
- Combine evidence from all photos into that one object (e.g. body type from a full-body shot, face traits from close-ups).`;
    systemPrompt = await getPromptTemplateValue("analyzeLooksSystemPrompt", systemPrompt);

    const requestBody = {
      model: "x-ai/grok-4.1-fast",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: "These photos show one same person. Return a single JSON object (not an array) with age (integer) and the appearance keys above, using only the allowed option strings where possible." },
          ],
        },
      ],
      max_tokens: 400,
      temperature: 0.1,
      response_format: { type: "json_object" },
    };

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI service error ${aiResponse.status}: ${errText}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim();
    const looks = parseAnalyzeLooksResponse(rawContent);

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
    const timeoutLike =
      String(error?.name || "").toLowerCase() === "timeouterror" ||
      String(error?.message || "").toLowerCase().includes("timed out") ||
      String(error?.message || "").toLowerCase().includes("timeout") ||
      String(error?.message || "").toLowerCase().includes("aborted");
    if (creditDeducted) {
      try {
        const { refundCredits } = await import("../services/credit.service.js");
        await refundCredits(req.user.userId, ANALYZE_CREDIT_COST);
      } catch (refundErr) {
        console.error("Failed to refund analyze-looks credit:", refundErr.message);
      }
    }
    res.status(timeoutLike ? 504 : 500).json({
      success: false,
      message: timeoutLike
        ? "Analyze looks timed out. Please retry with fewer/smaller images. Your credit has been refunded."
        : "Failed to analyze looks. Your credit has been refunded.",
    });
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
  // Must be in outer scope so the catch block can refund reliably.
  let ENHANCE_CREDIT_COST = 0;

  try {
    // mode: "casual" | "nsfw" | "ultra-realism"
    const { prompt, mode = "casual", modelLooks } = req.body;
    const pricing = await getGenerationPricing();
    ENHANCE_CREDIT_COST =
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
    const NANO_BANANA_SYSTEM = `You are a creative director prompt engineer for Nano Banana Pro.

Rewrite user ideas into clear production prompts that follow Nano Banana best practices.

Core rules:
1) Be specific and concrete: subject, action, context, composition, style.
2) Prefer positive framing ("empty street") over negative-only instructions.
3) Include camera direction: framing, angle, lens feel, depth of field.
4) Use one coherent lighting setup (avoid conflicting light directions).
5) Add materiality/texture only where relevant (fabric, skin, metal, surfaces).
6) Keep prompts internally consistent and easy for a single image model to execute.
7) If modelLooks are provided, treat them as identity-critical and include them naturally.
8) Preserve user intent exactly; never drift away from requested scene/action/mood.
9) Make the result visually exceptional and distinctive while still believable and photorealistic.
10) If the user asks for a selfie, enforce true self-capture framing: palm/arm-length POV, first-person front-camera vibe, no second photographer, no visible phone in hand, no mirror unless explicitly requested.
11) Return only final prompt text, no headings or explanation.

Suggested structure:
[Subject + identity details] + [Action/pose] + [Location/context] + [Composition/camera] + [Lighting] + [Style/finish]

Safety:
- This mode is SFW. If input is explicit, convert to tasteful fully-clothed equivalent while preserving mood.

Length target:
- 70-160 words, one clean paragraph.`;

    let systemPrompts = {
      // Casual image generation — also uses Nano Banana Pro via kie.ai
      "casual": NANO_BANANA_SYSTEM,

      // Advanced ultra-realism — WaveSpeed Nano Banana Pro, identical model
      "ultra-realism": NANO_BANANA_SYSTEM,

      // NSFW — Z Image Turbo prose prompting style
      "nsfw": `You are a professional AI image prompt engineer specializing in Z Image Turbo (prose-based diffusion model).

Rewrite a rough NSFW request into one coherent descriptive paragraph that reads like a real photo caption, not tags.

Hard rules:
- No keyword chains, no comma-separated tag dumps, no quality-token spam.
- One coherent light source only.
- Pose must be anatomically plausible and described observationally.
- Keep environmental grounding concise (2-3 details max).
- Include authenticity cues (grain, slight blur, uneven light) naturally.
- Keep the result logically consistent and physically plausible.

Output only final prompt text (no explanation).`,
    };

    const nanoBananaSharedPrompt = (
      await getPromptTemplateValue("enhancePromptNanoBananaSystem", NANO_BANANA_SYSTEM)
    ).trim() || NANO_BANANA_SYSTEM;

    systemPrompts = {
      ...systemPrompts,
      // One shared Nano Banana system prompt for both casual + ultra-realism.
      casual: nanoBananaSharedPrompt,
      "ultra-realism": nanoBananaSharedPrompt,
      nsfw: await getPromptTemplateValue("enhancePromptNsfwSystem", systemPrompts.nsfw),
    };

    const systemPromptBase = systemPrompts[mode] || systemPrompts.casual;
    const nanoBananaNonNegotiables = `
NON-NEGOTIABLE QUALITY + CONSISTENCY POLICY:
- Keep all user-requested details and modelLooks constraints intact; do not add conflicting changes.
- Improve quality with realistic, specific composition/light details, but never change the core idea.
- For selfie requests: enforce palm/arm-length first-person selfie POV, no second-person photographer, no phone held in hand, and no mirror unless user explicitly asks for mirror selfie.`;
    const systemPrompt =
      mode === "casual" || mode === "ultra-realism"
        ? `${systemPromptBase}\n${nanoBananaNonNegotiables}`
        : systemPromptBase;

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
        signal: AbortSignal.timeout(35_000),
      });
      if (!aiResponse.ok) {
        const err = await aiResponse.text();
        throw new Error(`AI service error ${aiResponse.status}: ${err}`);
      }
      const aiData = await aiResponse.json();
      return aiData.choices?.[0]?.message?.content;
    };

    // Start conservative (0.3) for reliable quality; retry creative (0.7) if empty
    let rawContent = await callOpenRouterEnhance(0.3, 450);
    if (!rawContent || !String(rawContent).trim()) {
      console.warn("[enhance-prompt] Empty first response; retrying with higher temperature");
      rawContent = await callOpenRouterEnhance(0.7, 550);
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
 * CREATOR STUDIO — NanoBanana Pro with configurable aspect ratio & resolution
 * POST /api/generate/creator-studio
 */
router.post(
  "/generate/creator-studio",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateCreatorStudio,
);

router.post(
  "/generate/creator-studio/video",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  generateCreatorStudioVideo,
);

router.post(
  "/generate/creator-studio/video/extend",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  extendCreatorStudioVideo,
);

router.post(
  "/generate/creator-studio/video/4k",
  authMiddleware,
  generationLimiter,
  validateGeneration,
  getCreatorStudioVideo4k,
);

router.get(
  "/generate/creator-studio/video/1080p",
  authMiddleware,
  generationsLimiter,
  getCreatorStudioVideo1080p,
);

router.post(
  "/generate/creator-studio/mask-upload",
  authMiddleware,
  generationLimiter,
  uploadCreatorStudioMask,
);

router.get(
  "/generate/creator-studio/assets",
  authMiddleware,
  listCreatorStudioAssets,
);

router.post(
  "/generate/creator-studio/assets",
  authMiddleware,
  generationLimiter,
  createCreatorStudioAsset,
);

router.delete(
  "/generate/creator-studio/assets/:assetId",
  authMiddleware,
  deleteCreatorStudioAsset,
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
let warnedMissingCronSecretForKieRecovery = false;
router.get("/cron/kie-recovery", async (req, res) => {
  const secret = req.query.secret || req.headers["x-cron-secret"];
  const isVercelCron = Boolean(req.headers["x-vercel-cron"]);
  if (!process.env.CRON_SECRET) {
    if (!warnedMissingCronSecretForKieRecovery) {
      warnedMissingCronSecretForKieRecovery = true;
      console.warn("[cron/kie-recovery] CRON_SECRET is not set; relying on x-vercel-cron header only.");
    }
  }
  if (!isVercelCron && process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // Also recover stuck NSFW image/video jobs in serverless deployments where in-memory pollers are ephemeral.
  try {
    await recoverStuckNsfwGenerations({ startContinuous: false });
  } catch (error) {
    console.error("[cron/kie-recovery] NSFW recovery failed:", error?.message || error);
  }
  try {
    const stale = await recoverStaleLoraTrainings();
    if ((stale?.checked || 0) > 0) {
      console.log("[cron/kie-recovery] LoRA stale recovery:", stale);
    }
  } catch (error) {
    console.error("[cron/kie-recovery] LoRA stale recovery failed:", error?.message || error);
  }
  try {
    const stats = await processPendingBlobRemirrorQueue({ limit: 30 });
    if (stats?.processed) {
      console.log("[cron/kie-recovery] Blob re-mirror queue:", stats);
    }
  } catch (error) {
    console.error("[cron/kie-recovery] Blob re-mirror queue failed:", error?.message || error);
  }
  try {
    const summary = await runSignupNoPurchaseWinbackCampaign();
    if ((summary?.sent || 0) > 0 || (summary?.converted || 0) > 0) {
      console.log("[cron/kie-recovery] Signup winback campaign:", summary);
    }
  } catch (error) {
    console.error("[cron/kie-recovery] Signup winback campaign failed:", error?.message || error);
  }
  // Recover stuck PiAPI (Seedance) and WaveSpeed Seedream tasks whose webhooks were missed
  try {
    await runPiapiWatchdog();
  } catch (error) {
    console.error("[cron/kie-recovery] PiAPI watchdog failed:", error?.message || error);
  }
  try {
    await runWavespeedSeedreamWatchdog();
  } catch (error) {
    console.error("[cron/kie-recovery] WaveSpeed Seedream watchdog failed:", error?.message || error);
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
router.use("/lander-new", landerNewRoutes);
router.use("/admin/lander-new", authMiddleware, adminMiddleware, adminLanderNewRoutes);
router.use("/affiliate-lander", affiliateLanderPublicRoutes);
router.use("/admin/affiliate-lander", authMiddleware, adminMiddleware, adminAffiliateLanderRoutes);

// ============================================
// REAL AVATARS (HeyGen Photo Avatar IV)
// ============================================
router.use("/avatars", avatarRoutes);
router.use("/heygen", heygenCallbackRoutes);

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
import { isR2Configured, uploadFileToR2, getR2PresignedUploadUrl, isBlobOnlyStorageMode } from "../utils/r2.js";

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

// Handle Multer upload limits and file filter errors with explicit message + solution.
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    const maxLabel = formatBlobUploadMaxForMessage();
    const maxBytes = getBlobClientUploadMaxBytes();
    const msg =
      `Upload rejected: larger than the server limit of ${maxLabel}. ` +
      `That value is the maximum allowed — not your file’s size. ` +
      `If your photo looks small on disk, HEIC/MOV→JPEG/MP4 conversion in the browser or a very large PNG often produces a much bigger upload; try a smaller JPEG export.`;
    return res.status(413).json({
      success: false,
      code: "FILE_TOO_LARGE",
      message: msg,
      error: msg,
      maxUploadBytes: maxBytes,
      maxUploadLabel: maxLabel,
      solution:
        "Resize or re-export as JPEG, or raise BLOB_CLIENT_UPLOAD_MAX_BYTES if your Blob/storage plan allows a higher cap.",
    });
  }
  if (
    err &&
    err.message &&
    typeof err.message === "string" &&
    /not allowed|Accepted: images and videos/i.test(err.message)
  ) {
    const msg = err.message.includes("Accepted:")
      ? err.message
      : "That file type is not allowed for uploads.";
    return res.status(400).json({
      success: false,
      code: "INVALID_FILE_TYPE",
      message: msg,
      error: msg,
      solution:
        "Use JPG, PNG, WebP, or GIF for images, or MP4, WebM, or MOV for video.",
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
const isAllowedDownloadHost = isAllowedPublicAssetHost;

const DOWNLOAD_PROXY_MAX_BYTES = 120 * 1024 * 1024; // 120 MB
const DOWNLOAD_PROXY_TIMEOUT_MS = 60_000;
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

// ── Upscaler ──────────────────────────────────────────────────────────────────
import {
  submitUpscalerJob,
} from "../services/upscaler.service.js";
import { resolveRunpodWebhookUrl } from "../lib/runpodWebhookUrl.js";

const upscalerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are supported for upscaling."));
  },
});

router.post(
  "/upscale",
  authMiddleware,
  generationLimiter,
  upscalerUpload.single("image"),
  async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    if (!req.file) return res.status(400).json({ success: false, error: "No image file provided" });

    const { deductCredits, checkAndExpireCredits, refundCredits, getTotalCredits } = await import("../services/credit.service.js");

    let generationId = null;
    let creditDeducted = false;

    try {
      const pricing = await getGenerationPricing();
      const upscalerCost = Number(pricing.upscalerImage ?? 5);
      const user = await checkAndExpireCredits(userId);
      const totalCredits = getTotalCredits(user);
      if (totalCredits < upscalerCost) {
        return res.status(402).json({
          success: false,
          error: `Not enough credits. Upscaling costs ${upscalerCost} (you have ${totalCredits}).`,
          creditsNeeded: upscalerCost,
          creditsAvailable: totalCredits,
        });
      }

      const imageBuffer = req.file.buffer;
      const imageBase64 = imageBuffer.toString("base64");
      const filename = `upscale_${Date.now()}.jpg`;

      // Create generation record
      const gen = await prisma.generation.create({
        data: {
          userId,
          type: "upscale",
          prompt: "",
          creditsCost: upscalerCost,
          status: "processing",
          inputImageUrl: JSON.stringify({ submitting: true }),
        },
      });
      generationId = gen.id;

      // Deduct credits
      await deductCredits(userId, upscalerCost);
      creditDeducted = true;

      // Submit to RunPod (with webhook so results arrive even if client stops polling)
      const webhookUrl = resolveRunpodWebhookUrl({
        generationId,
        kind: "upscale",
      });
      const runpodJobId = await submitUpscalerJob(imageBase64, filename, webhookUrl);

      // Update record with job ID
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          providerTaskId: runpodJobId,
          inputImageUrl: JSON.stringify({ runpodJobId }),
        },
      });

      return res.json({ success: true, generationId, runpodJobId });
    } catch (err) {
      console.error("[Upscaler] submit error:", err.message);
      if (creditDeducted && userId) {
        try {
          const gen = generationId ? await prisma.generation.findUnique({ where: { id: generationId }, select: { creditsCost: true } }) : null;
          await refundCredits(userId, gen?.creditsCost || 0);
        } catch {}
      }
      if (generationId) {
        await prisma.generation.update({
          where: { id: generationId },
          data: { status: "failed", errorMessage: err.message.slice(0, 500) },
        }).catch(() => {});
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.get("/upscale/status/:generationId", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  const { generationId } = req.params;

  try {
    const gen = await prisma.generation.findUnique({ where: { id: generationId } });
    if (!gen || gen.userId !== userId) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    // Already done
    if (gen.status === "completed" || gen.status === "failed") {
      return res.json({
        success: true,
        status: gen.status,
        imageUrl: gen.outputUrl ?? null,
        error: gen.errorMessage ?? null,
      });
    }

    // Callback-only mode: no direct RunPod polling here.
    // Stuck rows are reconciled by watchdog (>= 30 min).
    return res.json({ success: true, status: "processing" });
  } catch (err) {
    console.error("[Upscaler] status error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MODELCLONE-X GENERATION ROUTES (legacy /api/soulx/* → 308 → /api/modelclone-x/*)
// ─────────────────────────────────────────────────────────────────────────────

router.use((req, res, next) => {
  if (req.path.startsWith("/soulx")) {
    const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(308, `${req.baseUrl}${req.path.replace(/^\/soulx/, "/modelclone-x")}${q}`);
  }
  next();
});

const MODELCLONE_X_SFW_SYSTEM_PROMPT = `You are a senior prompt director for Z-Image Turbo (Tongyi-MAI 6B S3-DiT Turbo) focused on SFW portrait/lifestyle outputs. Your job is to transform a user's rough idea into one polished, detailed POSITIVE prompt that produces stunning, photorealistic results.

Z-Image Turbo responds best to natural descriptive prose, not tag lists. Write one flowing paragraph that covers:
1. Shot type + framing (close-up portrait, cowboy shot, full body, POV, etc.)
2. Subject description — if MODEL IDENTITY CONTEXT is provided, weave those traits in naturally as the subject. Do not invent conflicting attributes.
3. Exact clothing and styling details — be precise and grounded
4. Action, pose, expression, eye contact
5. Environment and background with specific details
6. Lighting setup (golden hour, studio softbox, candlelight, neon, etc.)
7. Camera feel (35mm f/1.8, telephoto compression, smartphone POV, etc.)
8. Overall mood and color grading

Rules:
- Output ONLY the final positive prompt — no preamble, no explanation, no headings, no code block
- NEVER include negative terms, quality disclaimers, or anatomy constraints — those are handled separately
- If trigger word is provided in the identity context, do NOT include it — it is injected automatically
- Preserve every user-specified detail; only add richness, never contradict or water down the request
- Keep it under 200 words, one clean paragraph
- STRICT SFW POLICY: no nudity, no explicit sexual acts, no exposed genitals, no explicit erotic phrasing
- If user asks for explicit/NSFW content, rewrite to a tasteful SFW equivalent while preserving composition/mood`;

function parseMaybeJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractPromptFromOptimizer(rawContent) {
  if (!rawContent) return "";
  const raw = String(rawContent).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!raw) return "";

  const codeBlock = raw.match(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)```/);
  let prompt = codeBlock ? codeBlock[1] : raw;
  prompt = prompt
    .replace(/^✅\s*Optimized Z-Image-Turbo Prompt \(ready to paste\):?/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  return prompt;
}

function buildModelCloneXModelIdentityContext(model, lora = null) {
  if (!model || typeof model !== "object") return "";

  const modelLooks = parseMaybeJsonObject(model.savedAppearance);
  const loraLooks = parseMaybeJsonObject(lora?.defaultAppearance);
  const aiParams = parseMaybeJsonObject(model.aiGenerationParams);
  const looks = { ...modelLooks, ...loraLooks };

  // Fill gaps from legacy aiGenerationParams for models without savedAppearance.
  // Use an allowlist to avoid polluting context with non-look metadata keys
  // (e.g. type, userId, creditsNeeded, photoConfigs) present in newer aiGenerationParams.
  const LEGACY_LOOK_KEYS = [
    "hairColor", "hairLength", "hairTexture", "hairType",
    "eyeColor", "eyeShape",
    "bodyType", "height",
    "heritage", "ethnicity", "skinTone",
    "faceType", "faceShape", "noseShape",
    "lipSize", "breastSize", "buttSize", "waist", "hips",
    "style", "tattoos",
  ];
  for (const k of LEGACY_LOOK_KEYS) {
    if (!looks[k] && aiParams[k]) looks[k] = aiParams[k];
  }

  const gender = String(looks.gender || aiParams.gender || "").trim();
  const ageNumber = Number.parseInt(
    model.age ?? looks.age ?? aiParams.age ?? "",
    10,
  );
  const age = Number.isFinite(ageNumber) ? String(ageNumber) : "";

  const looksLines = Object.entries(looks)
    .filter(([k, v]) => v != null && String(v).trim() && !["gender", "age"].includes(k))
    .map(([k, v]) => `- ${k}: ${String(v).trim()}`);

  const lines = [];
  if (gender) lines.push(`- gender: ${gender}`);
  if (age) lines.push(`- age: ${age}`);
  if (looksLines.length) lines.push(...looksLines);
  return lines.join("\n");
}

async function optimizeModelCloneXPrompt({
  userPrompt,
  withCharacter = false,
  modelIdentityContext = "",
}) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) return userPrompt;

  const preferredModel = String(
    process.env.MODELCLONE_X_PROMPT_MODEL || process.env.SOULX_PROMPT_MODEL || "x-ai/grok-4",
  ).trim();
  const modelCandidates = Array.from(new Set([preferredModel, "x-ai/grok-4.1-fast"])).filter(Boolean);
  let systemPrompt = (await getPromptTemplateValue("modelcloneXPromptOptimizerSystem", "")).trim();
  if (!systemPrompt) {
    systemPrompt = (await getPromptTemplateValue("modelcloneXZImageTurbo", "")).trim();
  }
  if (!systemPrompt) {
    systemPrompt = (await getPromptTemplateValue("soulxZImageTurbo", "")).trim();
  }
  if (!systemPrompt) systemPrompt = MODELCLONE_X_SFW_SYSTEM_PROMPT;

  const defaultUserWrapper = `User request: "{{USER_PROMPT}}"

{{IDENTITY_BLOCK}}
Hard rules:
- Final output must remain SFW (no nudity/explicit sexual content).

Generate the optimized prompt now.`;
  const userWrapperTemplate =
    (await getPromptTemplateValue("modelcloneXPromptOptimizerUserWrapper", defaultUserWrapper)).trim() ||
    defaultUserWrapper;
  const wrapperFilled = userWrapperTemplate
    .replaceAll("{{USER_PROMPT}}", String(userPrompt || "").trim())
    .replaceAll(
      "{{IDENTITY_BLOCK}}",
      withCharacter && modelIdentityContext
        ? `MODEL IDENTITY CONTEXT (must be injected as core subject identity with the user request):\n${String(modelIdentityContext || "").trim()}\n\n- Integrate model identity naturally so outputs keep this person consistent across generations.\n`
        : "",
    )
    .replaceAll("{{MODEL_IDENTITY_CONTEXT}}", String(modelIdentityContext || "").trim())
    .replaceAll("{{WITH_CHARACTER}}", withCharacter ? "true" : "false");
  const userContent = wrapperFilled;

  let lastError = null;
  for (const modelName of modelCandidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65_000);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_tokens: 900,
          temperature: 0.4,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 500)}`);
      }

      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      const optimized = extractPromptFromOptimizer(raw);
      if (optimized) return optimized;
      throw new Error("OpenRouter returned empty optimized prompt");
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      console.warn(`[ModelCloneX] Prompt optimization failed on ${modelName}: ${err.message}`);
    }
  }

  if (lastError) throw lastError;
  return userPrompt;
}

// POST /api/modelclone-x/generate
router.get("/modelclone-x/config", authMiddleware, async (_req, res) => {
  try {
    const pricing = await getGenerationPricing();
    const toCredits = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const trainingStandard = toCredits(pricing.loraTrainingStandard, 750);
    const trainingPro = toCredits(pricing.loraTrainingPro, 1500);
    return res.json({
      success: true,
      pricing: {
        noModel1: toCredits(pricing.modelcloneXNoModel1, 10),
        withModel1: toCredits(pricing.modelcloneXWithModel1, 15),
        noModel2: toCredits(pricing.modelcloneXNoModel2, 15),
        withModel2: toCredits(pricing.modelcloneXWithModel2, 25),
        extraStepsPer10: toCredits(pricing.modelcloneXExtraStepsPer10, 5),
        trainingStandard,
        trainingPro,
        // Legacy aliases for older clients expecting LoRA-specific naming.
        loraTrainingStandard: trainingStandard,
        loraTrainingPro: trainingPro,
        standardLoraPrice: trainingStandard,
        proLoraPrice: trainingPro,
      },
      limits: {
        includedSteps: 20,
        includedStepsNoModel: 20,
        includedStepsWithModel: 50,
        maxSteps: 100,
        minCfg: 0,
        maxCfg: 6,
        defaultSteps: 20,
        defaultStepsNoModel: 20,
        defaultStepsWithModel: 50,
        defaultCfg: 2,
      },
    });
  } catch (error) {
    console.error("Failed to load modelclone-x config:", error);
    return res.status(500).json({ success: false, error: "Failed to load ModelClone-X config" });
  }
});

router.post("/modelclone-x/generate", authMiddleware, generationLimiter, async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const {
    prompt,
    modelId = null,
    characterLoraId = null,
    aspectRatio = "9:16",
    quantity = 1,
    steps = null,
    cfg = 2,
    loraStrength = 0.8,
  } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ success: false, error: "Prompt is required" });
  }

  const qty = quantity === 2 ? 2 : 1;
  const useCharacter = Boolean(modelId && characterLoraId);
  const defaultStepsForMode = useCharacter ? 50 : 20;
  const parsedSteps = Number(steps);
  const safeSteps = Math.max(
    1,
    Math.min(100, Math.round(Number.isFinite(parsedSteps) ? parsedSteps : defaultStepsForMode)),
  );
  const safeCfg = Math.max(0, Math.min(6, Number(cfg) || 0));
  const safeLoraStrength = Math.max(0, Math.min(1, Number(loraStrength) || 0.8));

  const { deductCredits, checkAndExpireCredits, refundCredits } = await import("../services/credit.service.js");
  const pricing = await getGenerationPricing();

  await checkAndExpireCredits(userId);

  // Determine credit cost
  const baseCost =
    qty === 2
      ? (useCharacter ? Number(pricing.modelcloneXWithModel2 ?? 25) : Number(pricing.modelcloneXNoModel2 ?? 15))
      : (useCharacter ? Number(pricing.modelcloneXWithModel1 ?? 15) : Number(pricing.modelcloneXNoModel1 ?? 10));
  const extraStepsPer10 = Math.max(0, Number(pricing.modelcloneXExtraStepsPer10 ?? 5));
  const includedStepsForPricing = useCharacter ? 50 : 20;
  const extraStepBlocks = safeSteps > includedStepsForPricing
    ? Math.ceil((safeSteps - includedStepsForPricing) / 10)
    : 0;
  const extraCostPerImage = extraStepBlocks * extraStepsPer10;
  const costEachBase = qty === 2
    ? [Math.ceil(baseCost / 2), Math.floor(baseCost / 2)]
    : [baseCost];
  const costEach = costEachBase.map((c) => c + extraCostPerImage);
  const costPer = costEach.reduce((sum, c) => sum + c, 0);

  let loraUrl = null;
  let triggerWord = null;
  let modelForPrompt = null;
  let loraForPrompt = null;

  if (useCharacter) {
    modelForPrompt = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
      select: {
        id: true,
        age: true,
        savedAppearance: true,
        aiGenerationParams: true,
      },
    });
    if (!modelForPrompt) {
      return res.status(404).json({ success: false, error: "Model not found or you don't have access." });
    }

    const lora = await prisma.trainedLora.findFirst({
      where: {
        id: characterLoraId,
        modelId,
        status: "ready",
        category: { in: [...TRAINED_LORA_CATEGORIES_MODELCLONE_X, "nsfw"] },
      },
    });
    if (!lora) {
      return res.status(400).json({ success: false, error: "Selected LoRA not found or not ready for generation." });
    }
    loraForPrompt = lora;
    loraUrl = lora.loraUrl;
    triggerWord = lora.triggerWord;
  }

  const inputPrompt = prompt.trim();
  let optimizedPrompt = inputPrompt;
  try {
    const identityContext = useCharacter ? buildModelCloneXModelIdentityContext(modelForPrompt, loraForPrompt) : "";
    optimizedPrompt = await optimizeModelCloneXPrompt({
      userPrompt: inputPrompt,
      withCharacter: useCharacter,
      modelIdentityContext: identityContext,
    });
  } catch (optErr) {
    console.warn("[ModelCloneX] Prompt optimization fallback to raw prompt:", optErr.message);
  }

  const deducted = await deductCredits(userId, costPer);
  if (!deducted) {
    return res.status(402).json({ success: false, error: "Insufficient credits" });
  }

  const generationIds = [];
  const numJobs = qty === 2 ? 2 : 1;

  // For qty=2, submit two separate single-image jobs
  for (let i = 0; i < numJobs; i++) {
    const thisCost = costEach[i] || costPer;
    let gen;
    try {
      gen = await prisma.generation.create({
        data: {
          userId,
          modelId: modelId || null,
          type: "modelclone-x",
          prompt: inputPrompt,
          status: "processing",
          creditsCost: thisCost,
          replicateModel: "comfyui-modelclone-x",
        },
      });

      const modelcloneXWebhookUrl = resolveRunpodWebhookUrl({
        generationId: gen.id,
        kind: "modelclone-x",
      });
      const jobId = await submitModelCloneXJob({
        prompt: optimizedPrompt,
        aspectRatio,
        loraUrl,
        loraStrength: safeLoraStrength,
        triggerWord,
        steps: safeSteps,
        cfg: safeCfg,
      }, modelcloneXWebhookUrl);

      await prisma.generation.update({
        where: { id: gen.id },
        data: {
          providerTaskId: jobId,
          inputImageUrl: JSON.stringify({ runpodJobId: jobId, provider: "runpod-modelclone-x" }),
        },
      });

      generationIds.push(gen.id);
    } catch (err) {
      console.error("[ModelCloneX] Generation submit error:", err.message);
      if (gen) {
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "failed", errorMessage: err.message },
        });
      }
      await refundCredits(userId, costPer);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.json({
    success: true,
    generationIds,
    applied: {
      steps: safeSteps,
      cfg: safeCfg,
      loraStrength: safeLoraStrength,
      includedStepsForPricing,
      extraStepBlocks,
      extraCostPerImage,
    },
  });
});

// GET /api/modelclone-x/status/:generationId
router.get("/modelclone-x/status/:generationId", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  const { generationId } = req.params;

  try {
    const gen = await prisma.generation.findUnique({ where: { id: generationId } });
    if (!gen || gen.userId !== userId) {
      return res.status(404).json({ success: false, error: "Generation not found" });
    }

    if (gen.status === "completed") {
      return res.json({ success: true, status: "completed", imageUrl: gen.outputUrl });
    }
    if (gen.status === "failed") {
      return res.json({ success: true, status: "failed", error: gen.errorMessage });
    }

    // Callback-only mode: no direct RunPod polling here.
    // Stuck rows are reconciled by watchdog (>= 30 min).
    return res.json({ success: true, status: "processing" });
  } catch (err) {
    console.error("[ModelCloneX] status error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MODELCLONE-X CHARACTER IDENTITY (TrainedLora category modelclone-x; legacy soulx)
// ─────────────────────────────────────────────────────────────────────────────

function isModelCloneXLoraCategory(category) {
  return category === MODELCLONE_X_CATEGORY || category === LEGACY_SOULX_CATEGORY;
}

// POST /api/modelclone-x/character/create
router.post("/modelclone-x/character/create", authMiddleware, generationLimiter, async (req, res) => {
  try {
    const { modelId, name, trainingMode } = req.body;
    const userId = req.user.userId;
    const mode = trainingMode === "pro" ? "pro" : "standard";

    if (!modelId) return res.status(400).json({ success: false, message: "modelId is required" });

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model) return res.status(404).json({ success: false, message: "Model not found" });
    if (model.userId !== userId) return res.status(403).json({ success: false, message: "Not authorized" });

    const existing = await prisma.trainedLora.findFirst({
      where: { modelId, category: { in: TRAINED_LORA_CATEGORIES_MODELCLONE_X } },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A ModelClone-X character identity already exists for this model.",
        lora: existing,
      });
    }

    const loraName = name?.trim() || `${model.name || "Character"} ModelClone-X`;

    const lora = await prisma.trainedLora.create({
      data: {
        modelId,
        name: loraName,
        status: "awaiting_images",
        trainingMode: mode,
        category: MODELCLONE_X_CATEGORY,
      },
    });

    return res.json({ success: true, lora });
  } catch (err) {
    console.error("[ModelCloneX] create character error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/modelclone-x/characters/:modelId
router.get("/modelclone-x/characters/:modelId", authMiddleware, async (req, res) => {
  try {
    const { modelId } = req.params;
    const userId = req.user.userId;

    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model || model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const characters = await prisma.trainedLora.findMany({
      where: {
        modelId,
        category: { in: [...TRAINED_LORA_CATEGORIES_MODELCLONE_X, "nsfw"] },
      },
      include: { trainingImages: { select: { id: true, imageUrl: true, status: true } } },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ success: true, characters });
  } catch (err) {
    console.error("[ModelCloneX] get characters error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/modelclone-x/character/:loraId
router.delete("/modelclone-x/character/:loraId", authMiddleware, async (req, res) => {
  try {
    const { loraId } = req.params;
    const userId = req.user.userId;
    if (enforceGeneratedContentDeletionBlock(req, res)) return;

    const lora = await prisma.trainedLora.findUnique({
      where: { id: loraId },
      include: { model: { select: { userId: true } } },
    });
    if (!lora || lora.model.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (!isModelCloneXLoraCategory(lora.category)) {
      return res.status(400).json({ success: false, message: "Not a ModelClone-X character" });
    }

    await prisma.trainedLora.delete({ where: { id: loraId } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[ModelCloneX] delete character error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/modelclone-x/character/upload-images  → same flow as NSFW training uploads
router.post(
  "/modelclone-x/character/upload-images",
  authMiddleware,
  upload.array("photos", 30),
  async (req, res) => {
    const { loraId, modelId } = req.body;
    const userId = req.user.userId;

    if (!loraId) return res.status(400).json({ success: false, message: "loraId required" });

    try {
      const lora = await prisma.trainedLora.findUnique({
        where: { id: loraId },
        include: { model: { select: { userId: true } } },
      });
      if (!lora || lora.model.userId !== userId || !isModelCloneXLoraCategory(lora.category)) {
        return res.status(403).json({ success: false, message: "Not authorized" });
      }

      const files = req.files;
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, message: "No files uploaded" });
      }

      const { uploadFileToR2 } = await import("../utils/r2.js");
      const uploadedUrls = [];

      for (const file of files) {
        const url = await uploadFileToR2(file, "training");
        await prisma.loraTrainingImage.create({
          data: {
            modelId: lora.modelId,
            loraId: lora.id,
            imageUrl: url,
            status: "completed",
          },
        });
        uploadedUrls.push(url);
      }

      return res.json({ success: true, uploadedUrls });
    } catch (err) {
      console.error("[ModelCloneX] upload images error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// GET /api/modelclone-x/character/training-status/:loraId
router.get("/modelclone-x/character/training-status/:loraId", authMiddleware, async (req, res) => {
  try {
    const { loraId } = req.params;
    const userId = req.user.userId;

    const lora = await prisma.trainedLora.findUnique({
      where: { id: loraId },
      include: {
        model: { select: { userId: true } },
        trainingImages: { select: { id: true, imageUrl: true, status: true } },
      },
    });

    if (!lora || lora.model.userId !== userId || !isModelCloneXLoraCategory(lora.category)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    return res.json({ success: true, lora });
  } catch (err) {
    console.error("[ModelCloneX] training status error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/modelclone-x/character/train  → fal.ai training (same worker as NSFW LoRA)
router.post("/modelclone-x/character/train", authMiddleware, generationLimiter, async (req, res) => {
  const { trainLora } = await import("../controllers/nsfw.controller.js");
  return trainLora(req, res);
});

export default router;
