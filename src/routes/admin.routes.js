import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { authMiddleware, setAuthCookie, setRefreshCookie } from "../middleware/auth.middleware.js";
import { adminMiddleware } from "../middleware/admin.middleware.js";
import { BackupService } from "../services/backup.service.js";
import { sendPromoEmail } from "../services/email.service.js";
import { getAppBranding, updateAppBranding } from "../services/branding.service.js";
import multer from "multer";
import { isR2Configured, uploadBufferToR2, uploadFileToR2, mirrorToR2 } from "../utils/r2.js";
import {
  getLatestEndpointHealthSnapshots,
  getTelemetryOverview,
} from "../services/telemetry.service.js";
import {
  DEFAULT_GENERATION_PRICING,
  getGenerationPricing,
  updateGenerationPricing,
  resetGenerationPricing,
} from "../services/generation-pricing.service.js";
import { fetchAllProviderBalances } from "../services/provider-balances.service.js";
import {
  getVoicePlatformConfig,
  updateVoicePlatformMaxVoices,
  countModelsWithCustomVoice,
} from "../services/voice-platform.service.js";

const router = express.Router();
const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_URL = "https://api.kie.ai/api/v1";

const uploadEmailVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/x-mp4", "video/quicktime", "video/webm"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else if (file.mimetype?.startsWith("video/")) cb(null, true);
    else if (file.mimetype === "application/octet-stream" && /\.(mp4|mov|webm|m4v)$/i.test(file.originalname || "")) cb(null, true);
    else cb(new Error("Only video files (MP4, MOV, WebM) are allowed."));
  },
});

// All admin routes require authentication and admin role
router.use(authMiddleware, adminMiddleware);

router.get("/branding", async (_req, res) => {
  try {
    const branding = await getAppBranding();
    res.json({ success: true, branding });
  } catch (error) {
    console.error("Error fetching brand settings:", error);
    res.status(500).json({ success: false, error: "Failed to fetch brand settings" });
  }
});

router.put("/branding", async (req, res) => {
  try {
    const { appName, logoUrl, faviconUrl, baseUrl } = req.body || {};
    const branding = await updateAppBranding({ appName, logoUrl, faviconUrl, baseUrl });
    res.json({ success: true, branding });
  } catch (error) {
    console.error("Error updating brand settings:", error);
    res.status(400).json({ success: false, error: error.message || "Failed to update brand settings" });
  }
});

router.get("/pricing/generation", async (_req, res) => {
  try {
    const pricing = await getGenerationPricing();
    res.json({ success: true, pricing, defaults: DEFAULT_GENERATION_PRICING });
  } catch (error) {
    console.error("Error fetching generation pricing:", error);
    res.status(500).json({ success: false, error: "Failed to fetch generation pricing" });
  }
});

router.put("/pricing/generation", async (req, res) => {
  try {
    const patch = req.body?.pricing && typeof req.body.pricing === "object"
      ? req.body.pricing
      : req.body;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return res.status(400).json({ success: false, error: "Pricing payload object is required" });
    }
    const pricing = await updateGenerationPricing(patch);
    res.json({ success: true, pricing });
  } catch (error) {
    console.error("Error updating generation pricing:", error);
    res.status(500).json({ success: false, error: "Failed to update generation pricing" });
  }
});

router.post("/pricing/generation/reset", async (_req, res) => {
  try {
    const pricing = await resetGenerationPricing();
    res.json({ success: true, pricing });
  } catch (error) {
    console.error("Error resetting generation pricing:", error);
    res.status(500).json({ success: false, error: "Failed to reset generation pricing" });
  }
});

router.get("/voice-platform/config", async (_req, res) => {
  try {
    const cfg = await getVoicePlatformConfig();
    const used = await countModelsWithCustomVoice();
    res.json({
      success: true,
      maxCustomElevenLabsVoices: cfg.maxCustomElevenLabsVoices,
      usedCustomVoices: used,
    });
  } catch (error) {
    console.error("Error fetching voice platform config:", error);
    res.status(500).json({ success: false, error: "Failed to fetch voice platform config" });
  }
});

router.put("/voice-platform/config", async (req, res) => {
  try {
    const row = await updateVoicePlatformMaxVoices(req.body?.maxCustomElevenLabsVoices);
    const used = await countModelsWithCustomVoice();
    res.json({
      success: true,
      maxCustomElevenLabsVoices: row.maxCustomElevenLabsVoices,
      usedCustomVoices: used,
    });
  } catch (error) {
    console.error("Error updating voice platform config:", error);
    res.status(400).json({ success: false, error: error.message || "Failed to update voice platform config" });
  }
});

/**
 * GET /api/admin/provider-balances
 * Live balances / account probes (KIE, OpenRouter, fal, WaveSpeed, Apify, ElevenLabs).
 * API keys stay server-side.
 */
router.get("/provider-balances", async (_req, res) => {
  try {
    const data = await fetchAllProviderBalances();
    res.json(data);
  } catch (error) {
    console.error("Error fetching provider balances:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to fetch provider balances" });
  }
});

/**
 * GET /api/admin/stats
 * Get platform statistics
 */
router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsers,
      totalModels,
      totalGenerations,
      totalCreditsIssued,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.savedModel.count(),
      prisma.generation.count(),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: "purchase" },
      }),
      prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          credits: true,
          role: true,
          isVerified: true,
          createdAt: true,
        },
      }),
    ]);

    const stats = {
      totalUsers,
      totalModels,
      totalGenerations,
      totalCreditsIssued: totalCreditsIssued._sum.amount || 0,
      recentUsers,
    };

    res.json(stats);
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

/**
 * GET /api/admin/users
 * Get all users with pagination
 */
router.get("/users", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          credits: true,
          role: true,
          isVerified: true,
          proAccess: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          subscriptionTier: true,
          subscriptionCredits: true,
          purchasedCredits: true,
          totalCreditsUsed: true,
          allowCustomLoraTrainingPhotos: true,
          createdAt: true,
          _count: { select: { generations: true } },
        },
      }),
      prisma.user.count(),
    ]);

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/**
 * POST /api/admin/users/:userId/pro-access
 * Set or clear Pro Studio access for a user (invite-only /pro)
 */
router.post("/users/:userId/pro-access", async (req, res) => {
  try {
    const { userId } = req.params;
    const { proAccess } = req.body;
    if (typeof proAccess !== "boolean") {
      return res.status(400).json({ error: "proAccess must be a boolean" });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { proAccess },
    });
    res.json({ success: true, proAccess });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    console.error("Error updating pro access:", error);
    res.status(500).json({ error: "Failed to update pro access" });
  }
});

/**
 * POST /api/admin/backup/create
 * Create a new backup of all user data
 */
router.post("/backup/create", async (req, res) => {
  try {
    const result = await BackupService.createBackup();
    res.json(result);
  } catch (error) {
    console.error("Error creating backup:", error);
    res.status(500).json({ error: "Failed to create backup" });
  }
});

/**
 * GET /api/admin/backup/history
 * Get list of all backups
 */
router.get("/backup/history", async (req, res) => {
  try {
    const backups = await BackupService.getBackupHistory();
    res.json({ backups });
  } catch (error) {
    console.error("Error fetching backup history:", error);
    res.status(500).json({ error: "Failed to fetch backup history" });
  }
});

/**
 * POST /api/admin/backup/restore-credits
 * Restore user credits from a backup file
 */
router.post("/backup/restore-credits", async (req, res) => {
  try {
    const { backupData } = req.body;

    if (!backupData) {
      return res.status(400).json({ error: "Backup data is required" });
    }

    const result = await BackupService.restoreCreditsFromBackup(backupData);
    res.json(result);
  } catch (error) {
    console.error("Error restoring credits:", error);
    res.status(500).json({ error: "Failed to restore credits from backup" });
  }
});

/**
 * GET /api/admin/users/:userId/models
 * Get all models for a specific user (for NSFW override management)
 */
router.get("/users/:userId/models", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const models = await prisma.savedModel.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        thumbnail: true,
        isAIGenerated: true,
        nsfwOverride: true,
        nsfwUnlocked: true,
        loraStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      userEmail: user.email,
      models,
    });
  } catch (error) {
    console.error("Error fetching user models:", error);
    res.status(500).json({ success: false, error: "Failed to fetch models" });
  }
});

/**
 * POST /api/admin/models/:modelId/nsfw-override
 * Toggle NSFW override for a specific model
 */
router.post("/models/:modelId/nsfw-override", async (req, res) => {
  try {
    const { modelId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, error: "enabled must be a boolean" });
    }

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
      select: { id: true, name: true, userId: true },
    });

    if (!model) {
      return res.status(404).json({ success: false, error: "Model not found" });
    }

    const updatedModel = await prisma.savedModel.update({
      where: { id: modelId },
      data: { nsfwOverride: enabled },
      select: {
        id: true,
        name: true,
        nsfwOverride: true,
        isAIGenerated: true,
      },
    });

    console.log(`🔓 Admin ${req.user.email} set nsfwOverride=${enabled} for model "${model.name}" (${modelId})`);

    res.json({
      success: true,
      model: updatedModel,
      message: `NSFW ${enabled ? "enabled" : "disabled"} for model "${model.name}"`,
    });
  } catch (error) {
    console.error("Error toggling NSFW override:", error);
    res.status(500).json({ success: false, error: "Failed to update NSFW override" });
  }
});

/**
 * POST /api/admin/models/:modelId/fix-photos
 * Fix model photo URLs (for cases where R2 upload stored empty files)
 */
router.post("/models/:modelId/fix-photos", async (req, res) => {
  try {
    const { modelId } = req.params;
    const { photo1Url, photo2Url, photo3Url } = req.body;

    if (!photo1Url && !photo2Url && !photo3Url) {
      return res.status(400).json({ success: false, error: "At least one photo URL is required" });
    }

    const urls = [photo1Url, photo2Url, photo3Url].filter(Boolean);
    for (const url of urls) {
      if (!url.startsWith("https://")) {
        return res.status(400).json({ success: false, error: "All photo URLs must be valid HTTPS URLs" });
      }
    }

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
      select: { id: true, name: true },
    });

    if (!model) {
      return res.status(404).json({ success: false, error: "Model not found" });
    }

    const updateData = {};
    if (photo1Url) {
      updateData.photo1Url = photo1Url;
      updateData.thumbnail = photo1Url;
    }
    if (photo2Url) updateData.photo2Url = photo2Url;
    if (photo3Url) updateData.photo3Url = photo3Url;

    const updatedModel = await prisma.savedModel.update({
      where: { id: modelId },
      data: updateData,
    });

    console.log(`🔧 Admin ${req.user.email} fixed photos for model "${model.name}" (${modelId})`);

    res.json({
      success: true,
      message: `Photos updated for model "${model.name}"`,
      model: {
        id: updatedModel.id,
        name: updatedModel.name,
        photo1Url: updatedModel.photo1Url,
        photo2Url: updatedModel.photo2Url,
        photo3Url: updatedModel.photo3Url,
      },
    });
  } catch (error) {
    console.error("Error fixing model photos:", error);
    res.status(500).json({ success: false, error: "Failed to fix model photos" });
  }
});

/**
 * POST /api/admin/users/:userId/credits
 * Manually adjust user credits
 */
router.post("/users/:userId/credits", async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, reason } = req.body;

    if (!amount || typeof amount !== "number") {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
    });

    // Log the manual credit adjustment
    await prisma.creditTransaction.create({
      data: {
        userId,
        amount,
        type: amount > 0 ? "purchase" : "generation",
        description: reason || `Manual adjustment by admin`,
        paymentSessionId: `admin_${Date.now()}`,
      },
    });

    res.json({
      success: true,
      newCredits: user.credits,
      adjustment: amount,
    });
  } catch (error) {
    console.error("Error adjusting credits:", error);
    res.status(500).json({ error: "Failed to adjust credits" });
  }
});

/**
 * POST /api/admin/upload-email-video
 * Upload a video for use in marketing emails. Stores in R2 under email-videos/ and returns public URL.
 */
router.post(
  "/upload-email-video",
  (req, res, next) => {
    uploadEmailVideo.single("video")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "Video file too large. Max 200MB." });
        }
        return res.status(400).json({ error: err?.message || "Invalid video file" });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No video file uploaded" });
      }
      if (!isR2Configured()) {
        return res.status(503).json({ error: "R2 storage is not configured; cannot host email videos." });
      }
      const url = await uploadFileToR2(req.file, "email-videos");
      res.json({ success: true, url });
    } catch (err) {
      console.error("Upload email video error:", err);
      res.status(500).json({ error: err?.message || "Upload failed" });
    }
  }
);

/**
 * POST /api/admin/send-marketing-email
 * Send a marketing email to users (excluding unsubscribes). Optional audience filters.
 * Body: { subject, heroImageUrl, imageUrls, videoUrl?, headline, bodyText, ctaText, ctaUrl, testEmail (optional),
 *        audience?: { verifiedOnly?, subscriptionStatuses?, subscriptionTiers?, minSpendCents?, maxSpendCents?, minReferrals?, regions?, languages? } }
 */
router.post("/send-marketing-email", async (req, res) => {
  try {
    const { subject, heroImageUrl, imageUrls, videoUrl, headline, bodyText, ctaText, ctaUrl, testEmail, audience } = req.body;

    if (!subject || !headline || !bodyText) {
      return res.status(400).json({ error: "subject, headline, and bodyText are required" });
    }

    const sgMail = (await import("@sendgrid/mail")).default;
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "SENDGRID_API_KEY not configured" });
    }
    sgMail.setApiKey(apiKey);

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || "support@modelclone.app";
    const branding = await getAppBranding();
    const BRAND = { name: branding.appName };
    const baseUrl = (branding.baseUrl || "https://modelclone.app").replace(/\/$/, "");
    const logoUrl = branding.logoUrl || `${baseUrl}/logo-512.png`;
    const safeHeroImageUrl = typeof heroImageUrl === "string" ? heroImageUrl.trim() : "";
    const safeImageUrls = Array.isArray(imageUrls)
      ? imageUrls
          .filter((u) => typeof u === "string")
          .map((u) => u.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const safeVideoUrl = typeof videoUrl === "string" ? videoUrl.trim() : "";

    const escapeHtml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    /** Generate a signed unsubscribe token for one recipient email. */
    const buildUnsubscribeToken = (email) =>
      jwt.sign(
        { sub: email, purpose: "unsubscribe" },
        process.env.JWT_SECRET,
        { expiresIn: "180d" },
      );

    const buildEmailHtml = (userName, recipientEmail) => {
      const unsubToken = buildUnsubscribeToken(recipientEmail);
      const unsubUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(BRAND.name)} - ${escapeHtml(subject)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background-color: #f5f5f3; font-family: 'DM Sans', sans-serif; color: #1a1a1a; padding: 48px 16px 64px; -webkit-font-smoothing: antialiased; }
    .wrapper { max-width: 560px; margin: 0 auto; }
    .brand-bar { margin-bottom: 28px; padding: 0 4px; text-align: center; }
    .brand-mark { width: 42px; height: 42px; border-radius: 10px; overflow: hidden; background: #1a1a1a; display: block; margin: 0 auto 8px; }
    .brand-mark img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .brand-name { font-size: 15px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.2px; display: block; text-align: center; }
    .card { background: #ffffff; border-radius: 4px; border: 1px solid #e2e2de; overflow: hidden; }
    .card-accent { height: 3px; background: #1a1a1a; }
    .card-body { padding: 48px 48px 44px; }
    .section-label { font-size: 11px; font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: #9b9b93; margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 600; color: #111; letter-spacing: -0.5px; line-height: 1.3; margin-bottom: 16px; }
    .greeting-text { font-size: 15px; font-weight: 300; color: #555550; line-height: 1.7; margin-bottom: 24px; white-space: pre-line; }
    .greeting-text strong { color: #1a1a1a; font-weight: 500; }
    .divider { height: 1px; background: #e8e8e4; margin: 0 0 24px; }
    .hero { width: 100%; border-radius: 4px; margin-bottom: 20px; border: 1px solid #e2e2de; }
    .gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0 0 24px; }
    .gallery img { width: 100%; border: 1px solid #e2e2de; border-radius: 4px; display:block; }
    .video-wrap { margin: 0 0 24px; }
    .video-wrap video { width: 100%; max-height: 320px; border: 1px solid #e2e2de; border-radius: 4px; display: block; }
    .video-link { display: inline-block; margin-top: 8px; font-size: 14px; font-weight: 600; color: #111; text-decoration: underline; }
    .cta-wrap { margin: 16px 0 26px; }
    .cta-btn { display: inline-block; text-decoration: none; background: #111; color: #fff !important; font-size: 13px; font-weight: 600; padding: 10px 14px; border-radius: 4px; }
    .note { font-size: 13px; color: #9b9b93; line-height: 1.65; font-weight: 300; }
    .note + .note { margin-top: 12px; }
    .card-footer { padding: 20px 48px; background: #fafaf8; border-top: 1px solid #e8e8e4; text-align: center; }
    .footer-brand { font-size: 12px; font-weight: 500; color: #1a1a1a; }
    .footer-legal { font-size: 11px; color: #b5b5ae; }
    .meta { margin-top: 24px; padding: 0 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; }
    .meta-text { font-size: 11px; color: #b5b5ae; }
    .unsub-link { font-size: 11px; color: #b5b5ae; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="brand-bar">
      <div class="brand-mark"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(BRAND.name)}" /></div>
      <span class="brand-name">${escapeHtml(BRAND.name)}</span>
    </div>

    <div class="card">
      <div class="card-accent"></div>
      <div class="card-body">
        <div class="section-label">Platform Update</div>
        <h1>${escapeHtml(headline)}${userName ? `,<br>${escapeHtml(userName)}.` : ''}</h1>
        ${safeHeroImageUrl ? `<img class="hero" src="${escapeHtml(safeHeroImageUrl)}" alt="Hero image" />` : ""}
        ${safeImageUrls.length ? `<div class="gallery">${safeImageUrls.map((url) => `<img src="${escapeHtml(url)}" alt="Email image" />`).join("")}</div>` : ""}
        ${safeVideoUrl ? `<div class="video-wrap"><video src="${escapeHtml(safeVideoUrl)}" controls preload="metadata" poster="">Your browser does not support the video tag.</video><br /><a class="video-link" href="${escapeHtml(safeVideoUrl)}" target="_blank" rel="noopener">Watch video</a></div>` : ""}
        <p class="greeting-text">${escapeHtml(bodyText)}</p>
        ${ctaText && ctaUrl ? `<div class="cta-wrap"><a class="cta-btn" href="${escapeHtml(ctaUrl)}">${escapeHtml(ctaText)}</a></div>` : ""}
        <div class="divider"></div>
        <p class="note">Do not share sensitive account details through email links unless you trust the source.</p>
        <p class="note">If this message was not expected, you can safely ignore it.</p>
      </div>
      <div class="card-footer">
        <span class="footer-brand">${escapeHtml(BRAND.name)}</span><br />
        <span class="footer-legal">© 2025 ${escapeHtml(BRAND.name)}. All rights reserved.</span>
      </div>
    </div>

    <div class="meta">
      <span class="meta-text">This is an automated message. Please do not reply.</span>
      <span class="meta-text">${escapeHtml(baseUrl.replace(/^https?:\/\//, ""))}</span>
      <a class="unsub-link" href="${unsubUrl}">Unsubscribe</a>
    </div>
  </div>
</body>
</html>
    `;
    };

    const NO_TRACKING = {
      clickTracking: { enable: false, enableText: false },
      openTracking: { enable: false },
    };

    if (testEmail) {
      const msg = {
        to: testEmail,
        from: { email: fromEmail, name: BRAND.name },
        subject,
        html: buildEmailHtml("Test User", testEmail),
        trackingSettings: NO_TRACKING,
      };
      await sgMail.send(msg);
      return res.json({ success: true, message: `Test email sent to ${testEmail}` });
    }

    // Fetch unsubscribed emails to exclude
    const unsubRecords = await prisma.emailUnsubscribe.findMany({ select: { email: true } });
    const unsubSet = new Set(unsubRecords.map((r) => r.email.toLowerCase()));

    // Audience filters (default: verified only)
    const aud = audience && typeof audience === "object" ? audience : {};
    const verifiedOnly = aud.verifiedOnly !== false;
    const subscriptionStatuses = Array.isArray(aud.subscriptionStatuses) ? aud.subscriptionStatuses.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : null;
    const subscriptionTiers = Array.isArray(aud.subscriptionTiers) ? aud.subscriptionTiers.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : null;
    const minSpendCents = typeof aud.minSpendCents === "number" && aud.minSpendCents >= 0 ? aud.minSpendCents : null;
    const maxSpendCents = typeof aud.maxSpendCents === "number" && aud.maxSpendCents >= 0 ? aud.maxSpendCents : null;
    const minReferrals = typeof aud.minReferrals === "number" && aud.minReferrals >= 0 ? aud.minReferrals : null;
    const regions = Array.isArray(aud.regions) ? aud.regions.filter((s) => typeof s === "string").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
    const languages = Array.isArray(aud.languages) ? aud.languages.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : null;

    const where = {};
    if (verifiedOnly) where.isVerified = true;
    if (subscriptionStatuses?.length) where.subscriptionStatus = { in: subscriptionStatuses };
    if (subscriptionTiers?.length) where.subscriptionTier = { in: subscriptionTiers };
    if (regions?.length) where.region = { in: regions };
    if (languages?.length) where.marketingLanguage = { in: languages };

    let candidateUsers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        _count: { select: { referrals: true } },
      },
    });

    if (minReferrals != null) {
      candidateUsers = candidateUsers.filter((u) => (u._count?.referrals ?? 0) >= minReferrals);
    }

    if (minSpendCents != null || maxSpendCents != null) {
      const ids = candidateUsers.map((u) => u.id);
      const spendByUser = new Map();
      // Batch to avoid "too many bind variables" (DB limit ~32767)
      const SPEND_QUERY_CHUNK = 5000;
      for (let i = 0; i < ids.length; i += SPEND_QUERY_CHUNK) {
        const chunk = ids.slice(i, i + SPEND_QUERY_CHUNK);
        const txs = await prisma.creditTransaction.findMany({
          where: { userId: { in: chunk }, type: "purchase" },
          select: { userId: true, amount: true },
        });
        for (const tx of txs) {
          spendByUser.set(tx.userId, (spendByUser.get(tx.userId) ?? 0) + tx.amount);
        }
      }
      candidateUsers = candidateUsers.filter((u) => {
        const spend = spendByUser.get(u.id) ?? 0;
        if (minSpendCents != null && spend < minSpendCents) return false;
        if (maxSpendCents != null && spend > maxSpendCents) return false;
        return true;
      });
    }

    const users = candidateUsers
      .map((u) => ({ email: u.email, name: u.name }))
      .filter((u) => !unsubSet.has(u.email.toLowerCase()));

    console.log(`Sending marketing email to ${users.length} users (${unsubSet.size} excluded as unsubscribed)...`);

    let sent = 0;
    let failed = 0;
    const errors = [];
    const BATCH_SIZE = 100;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const messages = batch.map((user) => ({
        to: user.email,
        from: { email: fromEmail, name: BRAND.name },
        subject,
        html: buildEmailHtml(user.name ? user.name.split(" ")[0] : null, user.email),
        trackingSettings: NO_TRACKING,
      }));

      try {
        await sgMail.send(messages);
        sent += messages.length;
        console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: sent ${messages.length} emails (total: ${sent})`);
      } catch (error) {
        failed += messages.length;
        errors.push(error.message);
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
      }

      if (i + BATCH_SIZE < users.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(`Marketing email complete: ${sent} sent, ${failed} failed`);

    res.json({
      success: true,
      totalUsers: users.length,
      excluded: unsubSet.size,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error sending marketing email:", error?.message, error?.stack);
    res.status(500).json({ error: error?.message || "Failed to send marketing email" });
  }
});

router.post("/send-promo-50off", async (req, res) => {
  try {
    const { testEmail, users: providedUsers } = req.body;

    if (testEmail) {
      const result = await sendPromoEmail(testEmail, "Test User");
      return res.json({ success: result.success, message: `Test promo email sent to ${testEmail}` });
    }

    // Always exclude unsubscribed emails
    const unsubRecords = await prisma.emailUnsubscribe.findMany({ select: { email: true } });
    const unsubSet = new Set(unsubRecords.map((r) => r.email.toLowerCase()));

    let users;
    if (providedUsers && Array.isArray(providedUsers) && providedUsers.length > 0) {
      users = providedUsers.filter((u) => !unsubSet.has((u.email || "").toLowerCase()));
      console.log(`Using ${users.length} provided users (${providedUsers.length - users.length} excluded as unsubscribed)`);
    } else {
      const allUsers = await prisma.user.findMany({
        where: { isVerified: true },
        select: { email: true, name: true },
      });
      users = allUsers.filter((u) => !unsubSet.has(u.email.toLowerCase()));
      console.log(`Found ${users.length} users (${unsubSet.size} excluded as unsubscribed)`);
    }

    console.log(`\n📧 Sending 50% OFF promo email to ${users.length} verified users...`);

    let sent = 0;
    let failed = 0;
    const errors = [];
    const BATCH_SIZE = 50;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((user) => sendPromoEmail(user.email, user.name ? user.name.split(" ")[0] : null))
      );

      results.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value.success) {
          sent++;
        } else {
          failed++;
          errors.push(`${batch[idx].email}: ${r.status === "rejected" ? r.reason : r.value?.error}`);
        }
      });

      console.log(`📧 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${sent} sent, ${failed} failed`);

      if (i + BATCH_SIZE < users.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(`\n✅ Promo email campaign complete: ${sent} sent, ${failed} failed`);

    res.json({
      success: true,
      totalUsers: users.length,
      excluded: unsubSet.size,
      sent,
      failed,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    });
  } catch (error) {
    console.error("Error sending promo emails:", error);
    res.status(500).json({ error: "Failed to send promo emails" });
  }
});

/**
 * POST /api/admin/assign-lora
 * Assign an external LoRA to a user's model by email + model name
 * Creates TrainedLora entry, links it to SavedModel, and enables NSFW
 */
router.post("/assign-lora", async (req, res) => {
  try {
    const { email, modelName, loraUrl, triggerWord, configUrl, enableNsfw } = req.body;

    if (!email || !loraUrl) {
      return res.status(400).json({ success: false, error: "email and loraUrl are required" });
    }

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: `User not found: ${email}` });
    }

    let model;
    if (modelName) {
      model = await prisma.savedModel.findFirst({
        where: { userId: user.id, name: { contains: modelName, mode: "insensitive" } },
      });
    } else {
      model = await prisma.savedModel.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!model) {
      return res.status(404).json({ success: false, error: `No model found for user ${email}${modelName ? ` with name "${modelName}"` : ""}` });
    }

    const loraName = triggerWord || modelName || model.name || "custom_lora";

    const trainedLora = await prisma.trainedLora.create({
      data: {
        modelId: model.id,
        name: loraName,
        status: "ready",
        loraUrl: loraUrl,
        triggerWord: triggerWord || "muclemommy_lora",
        trainedAt: new Date(),
      },
    });

    const updateData = {
      activeLoraId: trainedLora.id,
      loraStatus: "ready",
      loraUrl: loraUrl,
      loraTriggerWord: triggerWord || "musclemommy_lora",
      loraTrainedAt: new Date(),
    };

    if (enableNsfw !== false) {
      updateData.nsfwOverride = true;
      updateData.nsfwUnlocked = true;
    }

    await prisma.savedModel.update({
      where: { id: model.id },
      data: updateData,
    });

    console.log(`🔧 Admin ${req.user.email} assigned LoRA to model "${model.name}" (${model.id}) for user ${email}`);
    console.log(`   LoRA URL: ${loraUrl}`);
    console.log(`   Trigger: ${triggerWord || "muclemommy_lora"}`);
    console.log(`   NSFW: ${enableNsfw !== false ? "enabled" : "not changed"}`);

    res.json({
      success: true,
      message: `LoRA assigned to model "${model.name}" for ${email}`,
      data: {
        modelId: model.id,
        modelName: model.name,
        loraId: trainedLora.id,
        loraUrl,
        triggerWord: triggerWord || "muclemommy_lora",
        nsfwEnabled: enableNsfw !== false,
      },
    });
  } catch (error) {
    console.error("Error assigning LoRA:", error);
    res.status(500).json({ success: false, error: "Failed to assign LoRA" });
  }
});

/**
 * POST /api/admin/lora-recovery
 * Recover already-finished fal LoRA to R2 and attach to user model.
 * Body: { userId, modelName, falLoraUrl, triggerWord?, enableNsfw? }
 */
router.post("/lora-recovery", async (req, res) => {
  try {
    const {
      userId,
      modelName,
      falLoraUrl,
      triggerWord,
      enableNsfw = true,
    } = req.body || {};

    if (!userId || !modelName || !falLoraUrl) {
      return res.status(400).json({
        success: false,
        error: "userId, modelName, and falLoraUrl are required",
      });
    }

    if (!isR2Configured()) {
      return res.status(500).json({
        success: false,
        error: "R2 storage is not configured",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: String(userId).trim() },
      select: { id: true, email: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const model = await prisma.savedModel.findFirst({
      where: {
        userId: user.id,
        name: { contains: String(modelName).trim(), mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    });
    if (!model) {
      return res.status(404).json({
        success: false,
        error: `No model found for user with name like "${modelName}"`,
      });
    }

    // Pull the LoRA artifact from fal and persist it in our own R2 bucket.
    const sourceUrl = String(falLoraUrl).trim();
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return res.status(400).json({
        success: false,
        error: `Failed to download fal LoRA URL (HTTP ${response.status})`,
      });
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    const MAX_LORA_BYTES = 1 * 1024 * 1024 * 1024; // 1GB safety cap
    if (contentLength > MAX_LORA_BYTES) {
      return res.status(400).json({
        success: false,
        error: `LoRA file too large (${contentLength} bytes)`,
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      return res.status(400).json({
        success: false,
        error: "Downloaded LoRA file is empty",
      });
    }
    if (buffer.length > MAX_LORA_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Downloaded LoRA file too large (${buffer.length} bytes)`,
      });
    }

    const recoveredLoraUrl = await uploadBufferToR2(
      buffer,
      "loras",
      "safetensors",
      "application/octet-stream",
    );

    const finalTriggerWord = String(triggerWord || model.name || "recovered_lora").trim();
    const falMarker = `manual-recovery:${Date.now()}`;

    const trainedLora = await prisma.trainedLora.create({
      data: {
        modelId: model.id,
        name: `${model.name} (Recovered)`,
        status: "ready",
        trainingMode: "standard",
        loraUrl: recoveredLoraUrl,
        triggerWord: finalTriggerWord,
        trainedAt: new Date(),
        falRequestId: falMarker,
      },
      select: { id: true, loraUrl: true, triggerWord: true, falRequestId: true },
    });

    await prisma.savedModel.update({
      where: { id: model.id },
      data: {
        activeLoraId: trainedLora.id,
        loraStatus: "ready",
        loraUrl: recoveredLoraUrl,
        loraTriggerWord: finalTriggerWord,
        loraTrainedAt: new Date(),
        loraFalRequestId: falMarker,
        ...(enableNsfw !== false ? { nsfwOverride: true, nsfwUnlocked: true } : {}),
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "lora_recovery",
        targetType: "saved_model",
        targetId: model.id,
        detailsJson: JSON.stringify({
          userId: user.id,
          userEmail: user.email,
          modelName: model.name,
          sourceFalLoraUrl: sourceUrl,
          recoveredLoraUrl,
          trainedLoraId: trainedLora.id,
          triggerWord: finalTriggerWord,
          nsfwEnabled: enableNsfw !== false,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: `LoRA recovered for model "${model.name}"`,
      data: {
        userId: user.id,
        modelId: model.id,
        modelName: model.name,
        loraId: trainedLora.id,
        loraUrl: recoveredLoraUrl,
        triggerWord: finalTriggerWord,
        nsfwEnabled: enableNsfw !== false,
      },
    });
  } catch (error) {
    console.error("Error during LoRA recovery:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to recover LoRA",
    });
  }
});

function parseKieTaskId(replicateModel) {
  if (!replicateModel || typeof replicateModel !== "string") return null;
  if (!replicateModel.startsWith("kie-task:")) return null;
  const taskId = replicateModel.slice("kie-task:".length).trim();
  return taskId || null;
}

function extractKieOutputUrl(data) {
  if (!data || typeof data !== "object") return null;
  let outputUrl = null;
  try {
    const resultJson = typeof data.resultJson === "string"
      ? JSON.parse(data.resultJson)
      : data.resultJson;
    outputUrl =
      resultJson?.resultUrls?.[0] ||
      resultJson?.result_urls?.[0] ||
      resultJson?.url ||
      null;
    if (!outputUrl && Array.isArray(resultJson)) outputUrl = resultJson[0] || null;
    if (!outputUrl && typeof resultJson === "string" && resultJson.startsWith("http")) {
      outputUrl = resultJson;
    }
  } catch {
    if (typeof data.resultJson === "string" && data.resultJson.startsWith("http")) {
      outputUrl = data.resultJson;
    }
  }
  return outputUrl || data.resultUrl || data.outputUrl || data.output_url || data.url || null;
}

/**
 * POST /api/admin/lost-generations/reconcile
 * Body: { userId: string, limit?: number, dryRun?: boolean }
 * Scans FAILED KIE generations for user and recovers outputs if KIE task already succeeded.
 */
router.post("/lost-generations/reconcile", async (req, res) => {
  try {
    const { userId, limit = 200, dryRun = true } = req.body || {};
    const safeInput = String(userId || "").trim();
    const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 200));
    const runDry = dryRun !== false;

    if (!safeInput) {
      return res.status(400).json({ success: false, error: "User ID, email or name is required" });
    }
    if (!KIE_API_KEY) {
      return res.status(500).json({ success: false, error: "KIE_API_KEY is not configured" });
    }

    // Resolve user by ID, email, or name (case-insensitive)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(safeInput);
    const isEmail = safeInput.includes("@");

    let targetUser = null;
    if (isUuid) {
      targetUser = await prisma.user.findUnique({
        where: { id: safeInput },
        select: { id: true, email: true, name: true },
      });
    } else if (isEmail) {
      targetUser = await prisma.user.findFirst({
        where: { email: { equals: safeInput, mode: "insensitive" } },
        select: { id: true, email: true, name: true },
      });
    } else {
      targetUser = await prisma.user.findFirst({
        where: { name: { equals: safeInput, mode: "insensitive" } },
        select: { id: true, email: true, name: true },
      });
    }

    if (!targetUser) {
      return res.status(404).json({ success: false, error: `User not found for: ${safeInput}` });
    }

    const safeUserId = targetUser.id;

    const candidates = await prisma.generation.findMany({
      where: {
        userId: safeUserId,
        status: "failed",
        replicateModel: { startsWith: "kie-task:" },
      },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        type: true,
        status: true,
        outputUrl: true,
        replicateModel: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    const results = [];
    let recovered = 0;
    let recoverable = 0;

    for (const gen of candidates) {
      const taskId = parseKieTaskId(gen.replicateModel);
      if (!taskId) {
        results.push({ generationId: gen.id, recovered: false, reason: "missing_task_id" });
        continue;
      }

      try {
        const kieRes = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_API_KEY}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!kieRes.ok) {
          results.push({ generationId: gen.id, taskId, recovered: false, reason: `kie_http_${kieRes.status}` });
          continue;
        }

        const kieJson = await kieRes.json();
        const data = kieJson?.data ?? kieJson;
        const state = String(data?.state || "").toLowerCase();
        if (state !== "success") {
          results.push({ generationId: gen.id, taskId, recovered: false, reason: state || "not_success" });
          continue;
        }

        const providerUrl = extractKieOutputUrl(data);
        if (!providerUrl) {
          results.push({ generationId: gen.id, taskId, recovered: false, reason: "success_without_output_url" });
          continue;
        }

        recoverable += 1;
        if (runDry) {
          results.push({
            generationId: gen.id,
            taskId,
            recovered: false,
            dryRun: true,
            reason: "recoverable",
            providerUrl,
          });
          continue;
        }

        let finalUrl = providerUrl;
        if (isR2Configured()) {
          try {
            finalUrl = await mirrorToR2(providerUrl, "generations");
          } catch (mirrorErr) {
            console.warn(`[reconcile] R2 mirror failed for ${gen.id}, using provider URL:`, mirrorErr?.message);
          }
        }

        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: "completed",
            outputUrl: finalUrl,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        recovered += 1;
        results.push({
          generationId: gen.id,
          taskId,
          recovered: true,
          outputUrl: finalUrl,
        });
      } catch (e) {
        console.error(`[reconcile] Error recovering ${gen.id}:`, e?.message);
        results.push({ generationId: gen.id, taskId, recovered: false, reason: e?.message || "reconcile_error" });
      }
    }

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "lost_generation_reconcile",
        targetType: "user",
        targetId: safeUserId,
        detailsJson: JSON.stringify({
          userEmail: targetUser.email,
          limit: safeLimit,
          dryRun: runDry,
          scanned: candidates.length,
          recoverable,
          recovered,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: runDry
        ? `Dry run complete: ${recoverable}/${candidates.length} recoverable`
        : `Reconciliation complete: recovered ${recovered}/${candidates.length}`,
      data: {
        userId: safeUserId,
        userEmail: targetUser.email,
        dryRun: runDry,
        scanned: candidates.length,
        recoverable,
        recovered,
        results,
      },
    });
  } catch (error) {
    console.error("Lost generation reconciliation error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to reconcile lost generations",
    });
  }
});

/**
 * POST /api/admin/lost-generations/reconcile-all
 * Body: { limit?: number, dryRun?: boolean }
 * Runs lost content reconciliation for ALL users (failed KIE generations with kie-task:).
 * Use to restore content from KIE when callbacks were missed.
 */
router.post("/lost-generations/reconcile-all", async (req, res) => {
  try {
    const { limit = 500, dryRun = true } = req.body || {};
    const safeLimit = Math.max(1, Math.min(2000, parseInt(limit, 10) || 500));
    const runDry = dryRun !== false;

    if (!KIE_API_KEY) {
      return res.status(500).json({ success: false, error: "KIE_API_KEY is not configured" });
    }

    const candidates = await prisma.generation.findMany({
      where: {
        status: "failed",
        replicateModel: { startsWith: "kie-task:" },
      },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        outputUrl: true,
        replicateModel: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    const results = [];
    let recovered = 0;
    let recoverable = 0;

    for (const gen of candidates) {
      const taskId = parseKieTaskId(gen.replicateModel);
      if (!taskId) {
        results.push({ generationId: gen.id, userId: gen.userId, recovered: false, reason: "missing_task_id" });
        continue;
      }

      try {
        const kieRes = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_API_KEY}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!kieRes.ok) {
          results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: `kie_http_${kieRes.status}` });
          continue;
        }

        const kieJson = await kieRes.json();
        const data = kieJson?.data ?? kieJson;
        const state = String(data?.state || "").toLowerCase();
        if (state !== "success") {
          results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: state || "not_success" });
          continue;
        }

        const providerUrl = extractKieOutputUrl(data)
          || (Array.isArray(data?.resultUrls) && data.resultUrls[0]) || null;
        if (!providerUrl) {
          results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: "success_without_output_url" });
          continue;
        }

        recoverable += 1;
        if (runDry) {
          results.push({
            generationId: gen.id,
            userId: gen.userId,
            taskId,
            recovered: false,
            dryRun: true,
            reason: "recoverable",
            providerUrl,
          });
          continue;
        }

        let finalUrl = providerUrl;
        if (isR2Configured()) {
          try {
            finalUrl = await mirrorToR2(providerUrl, "generations");
          } catch (mirrorErr) {
            console.warn(`[reconcile-all] R2 mirror failed for ${gen.id}, using provider URL:`, mirrorErr?.message);
          }
        }

        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: "completed",
            outputUrl: finalUrl,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        recovered += 1;
        results.push({
          generationId: gen.id,
          userId: gen.userId,
          taskId,
          recovered: true,
          outputUrl: finalUrl,
        });
      } catch (e) {
        console.error(`[reconcile-all] Error recovering ${gen.id}:`, e?.message);
        results.push({ generationId: gen.id, userId: gen.userId, taskId, recovered: false, reason: e?.message || "reconcile_error" });
      }
    }

    const uniqueUsers = [...new Set(candidates.map(g => g.userId))].length;

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: req.user.userId,
        adminEmail: req.user.email || null,
        action: "lost_generation_reconcile_all",
        targetType: "all_users",
        targetId: null,
        detailsJson: JSON.stringify({
          limit: safeLimit,
          dryRun: runDry,
          scanned: candidates.length,
          uniqueUsers,
          recoverable,
          recovered,
        }),
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: runDry
        ? `Dry run complete: ${recoverable}/${candidates.length} recoverable (${uniqueUsers} users)`
        : `Reconciliation complete: recovered ${recovered}/${candidates.length} (${uniqueUsers} users)`,
      data: {
        dryRun: runDry,
        scanned: candidates.length,
        uniqueUsers,
        recoverable,
        recovered,
        results,
      },
    });
  } catch (error) {
    console.error("Lost generation reconcile-all error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to reconcile lost generations for all users",
    });
  }
});

router.post("/bulk-import-gallery", async (req, res) => {
  try {
    const { userId, modelId, imageUrls, prompt } = req.body;

    if (!userId || !modelId || !imageUrls || !Array.isArray(imageUrls)) {
      return res.status(400).json({ success: false, error: "userId, modelId, and imageUrls[] required" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    if (!model) return res.status(404).json({ success: false, error: "Model not found" });

    const results = [];
    for (const url of imageUrls) {
      const gen = await prisma.generation.create({
        data: {
          userId,
          modelId,
          type: "nsfw",
          prompt: prompt || "Imported reference photo",
          creditsCost: 0,
          creditsRefunded: false,
          actualCostUSD: 0,
          outputUrl: url,
          status: "completed",
          isNsfw: true,
          isTrial: false,
          completedAt: new Date(),
        },
      });
      results.push(gen.id);
    }

    res.json({ success: true, count: results.length, generationIds: results });
  } catch (error) {
    console.error("Error bulk importing gallery:", error);
    res.status(500).json({ success: false, error: "Failed to bulk import gallery" });
  }
});

/**
 * GET /api/admin/telemetry/overview
 * Admin telemetry summary for traffic, infra, and edge cases
 */
router.get("/telemetry/overview", async (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const overview = await getTelemetryOverview(hours);
    res.json({ success: true, telemetry: overview });
  } catch (error) {
    console.error("Error fetching telemetry overview:", error);
    res.status(500).json({ success: false, error: "Failed to fetch telemetry overview" });
  }
});

/**
 * GET /api/admin/telemetry/requests
 * Paginated raw traffic entries
 */
router.get("/telemetry/requests", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [items, total] = await Promise.all([
      prisma.apiRequestMetric.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          method: true,
          routePath: true,
          normalizedPath: true,
          statusCode: true,
          durationMs: true,
          userId: true,
          isAdmin: true,
          requestBytes: true,
          responseBytes: true,
          createdAt: true,
        },
      }),
      prisma.apiRequestMetric.count({
        where: { createdAt: { gte: since } },
      }),
    ]);

    res.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      filters: { hours },
    });
  } catch (error) {
    console.error("Error fetching telemetry requests:", error);
    res.status(500).json({ success: false, error: "Failed to fetch telemetry requests" });
  }
});

/**
 * GET /api/admin/telemetry/edge-events
 * Recent edge-case events (rate-limit, slow requests, server errors)
 */
router.get("/telemetry/edge-events", async (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 100));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const events = await prisma.telemetryEdgeEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventType: true,
        severity: true,
        message: true,
        routePath: true,
        statusCode: true,
        userId: true,
        detailsJson: true,
        createdAt: true,
      },
    });

    res.json({ success: true, events, filters: { hours, limit } });
  } catch (error) {
    console.error("Error fetching telemetry edge events:", error);
    res.status(500).json({ success: false, error: "Failed to fetch telemetry edge events" });
  }
});

/**
 * GET /api/admin/telemetry/endpoint-health
 * Latest endpoint health snapshot run
 */
router.get("/telemetry/endpoint-health", async (req, res) => {
  try {
    const data = await getLatestEndpointHealthSnapshots();
    res.json({ success: true, ...data });
  } catch (error) {
    console.error("Error fetching endpoint health snapshots:", error);
    res.status(500).json({ success: false, error: "Failed to fetch endpoint health snapshots" });
  }
});

router.post("/impersonate", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const jti = randomUUID();
    const impersonateToken = jwt.sign(
      { userId: targetUser.id, email: targetUser.email, impersonatedBy: req.user.userId, jti },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );
    const decodedToken = jwt.decode(impersonateToken);
    const expiresAt = decodedToken?.exp ? new Date(decodedToken.exp * 1000).toISOString() : null;
    const baseUrl =
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      `${req.protocol}://${req.get("host")}`;
    const normalizedBase = String(baseUrl || "").replace(/\/+$/, "");
    const relativeLoginUrl = `/admin-login?token=${impersonateToken}`;
    const absoluteLoginUrl = `${normalizedBase}${relativeLoginUrl}`;

    console.log(`🔑 Admin ${req.user.email} impersonating user ${targetUser.email} (${targetUser.id})`);

    res.json({
      success: true,
      token: impersonateToken,
      loginUrl: relativeLoginUrl,
      absoluteLoginUrl,
      expiresAt,
      user: targetUser,
    });
  } catch (error) {
    console.error("Impersonate error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * GET /api/admin/email-unsubscribes
 * Returns the full list of unsubscribed emails.
 */
router.get("/email-unsubscribes", async (_req, res) => {
  try {
    const records = await prisma.emailUnsubscribe.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, total: records.length, unsubscribes: records });
  } catch (error) {
    console.error("Error fetching unsubscribes:", error);
    res.status(500).json({ error: "Failed to fetch unsubscribes" });
  }
});

/**
 * DELETE /api/admin/email-unsubscribes/:email
 * Remove an email from the unsubscribe list (re-subscribe).
 */
router.delete("/email-unsubscribes/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    await prisma.emailUnsubscribe.deleteMany({ where: { email } });
    res.json({ success: true, message: `${email} removed from unsubscribe list` });
  } catch (error) {
    console.error("Error removing unsubscribe:", error);
    res.status(500).json({ error: "Failed to remove unsubscribe" });
  }
});

router.get("/discount-codes", async (_req, res) => {
  try {
    const codes = await prisma.discountCode.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, codes });
  } catch (error) {
    console.error("Error fetching discount codes:", error);
    res.status(500).json({ error: "Failed to fetch discount codes" });
  }
});

router.post("/discount-codes", async (req, res) => {
  try {
    const { code, discountType, discountValue, appliesTo, validFrom, validUntil, maxUses, minPurchaseAmount } = req.body;

    if (!code || !discountValue || !validUntil) {
      return res.status(400).json({ error: "Code, discount value, and expiry date are required" });
    }

    const normalized = code.trim().toUpperCase();

    const existing = await prisma.discountCode.findUnique({ where: { code: normalized } });
    if (existing) {
      return res.status(400).json({ error: "A discount code with this name already exists" });
    }

    if (discountType === "percentage" && (discountValue <= 0 || discountValue > 100)) {
      return res.status(400).json({ error: "Percentage discount must be between 1 and 100" });
    }

    const created = await prisma.discountCode.create({
      data: {
        code: normalized,
        discountType: discountType || "percentage",
        discountValue: parseFloat(discountValue),
        appliesTo: appliesTo || "both",
        validFrom: validFrom ? new Date(validFrom) : new Date(),
        validUntil: new Date(validUntil),
        maxUses: maxUses ? parseInt(maxUses) : null,
        minPurchaseAmount: minPurchaseAmount ? parseFloat(minPurchaseAmount) : null,
      },
    });

    res.json({ success: true, code: created });
  } catch (error) {
    console.error("Error creating discount code:", error);
    res.status(500).json({ error: "Failed to create discount code" });
  }
});

router.patch("/discount-codes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { discountType, discountValue, appliesTo, validFrom, validUntil, maxUses, minPurchaseAmount, isActive } = req.body;

    const updates = {};
    if (discountType !== undefined) updates.discountType = discountType;
    if (discountValue !== undefined) updates.discountValue = parseFloat(discountValue);
    if (appliesTo !== undefined) updates.appliesTo = appliesTo;
    if (validFrom !== undefined) updates.validFrom = new Date(validFrom);
    if (validUntil !== undefined) updates.validUntil = new Date(validUntil);
    if (maxUses !== undefined) updates.maxUses = maxUses ? parseInt(maxUses) : null;
    if (minPurchaseAmount !== undefined) updates.minPurchaseAmount = minPurchaseAmount ? parseFloat(minPurchaseAmount) : null;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await prisma.discountCode.update({
      where: { id },
      data: updates,
    });

    res.json({ success: true, code: updated });
  } catch (error) {
    console.error("Error updating discount code:", error);
    res.status(500).json({ error: "Failed to update discount code" });
  }
});

router.delete("/discount-codes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.discountCode.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({ success: true, message: "Discount code deactivated" });
  } catch (error) {
    console.error("Error deactivating discount code:", error);
    res.status(500).json({ error: "Failed to deactivate discount code" });
  }
});

export default router;
