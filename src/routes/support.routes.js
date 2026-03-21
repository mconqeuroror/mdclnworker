import express from "express";
import crypto from "crypto";
import multer from "multer";
import prisma from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { isR2Configured, uploadSupportAttachmentToR2 } from "../utils/r2.js";

const router = express.Router();
const SUPPORT_WEBHOOK_URL = "https://automations-n8n.nnp9hi.easypanel.host/webhook/support-automated";
const SUPPORT_WEBHOOK_TIMEOUT_MS = 180000;

const supportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images are allowed (JPEG, PNG, WebP, GIF)"));
    }
  },
});

function requireActiveSubscription(req, res, next) {
  const userId = req.user.userId;
  prisma.user
    .findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true, role: true, premiumFeaturesUnlocked: true },
    })
    .then((user) => {
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      const status = String(user.subscriptionStatus || "").toLowerCase();
      const allowed =
        status === "active" ||
        status === "trialing" ||
        user.role === "admin" ||
        Boolean(user.premiumFeaturesUnlocked);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "Support chat is available for active subscribers only",
        });
      }
      next();
    })
    .catch((err) => {
      console.error("Support subscription check error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    });
}

/** Start a new support chat session. Returns a unique sessionId (globally unique). */
router.post("/chat/start", authMiddleware, requireActiveSubscription, (req, res) => {
  const sessionId = crypto.randomUUID();
  res.json({ success: true, sessionId });
});

/** Send a message to the support agent. Optional single image attachment (sent only with message). */
router.post(
  "/chat/message",
  authMiddleware,
  requireActiveSubscription,
  supportUpload.array("attachments", 1),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const sessionId = req.body.sessionId;
      const userMessage = typeof req.body.userMessage === "string" ? req.body.userMessage.trim() : "";
      const isEndOfChat =
        req.body.isEndOfChat === true ||
        req.body.isEndOfChat === "true" ||
        req.body.isEndOfChat === 1 ||
        req.body.isEndOfChat === "1";

      if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
        return res.status(400).json({ success: false, message: "sessionId is required" });
      }
      if (!userMessage) {
        return res.status(400).json({ success: false, message: "userMessage is required" });
      }
      // Image must be sent with a message, never alone
      const hasAttachments = req.files && req.files.length > 0;
      if (hasAttachments && !userMessage) {
        return res.status(400).json({ success: false, message: "Message is required when sending an image" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      const email = user?.email ?? "";
      const username = user?.name ?? user?.email ?? String(userId);

      let attachmentUrls = [];
      if (hasAttachments) {
        if (!isR2Configured()) {
          console.error("❌ Support chat: R2 not configured, cannot upload attachment");
          return res.status(500).json({ success: false, message: "File upload is not available. Please try again without an image or contact support." });
        }
        const file = req.files[0];
        const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : file.mimetype === "image/gif" ? "gif" : "jpg";
        try {
          const url = await uploadSupportAttachmentToR2(file.buffer, ext, file.mimetype);
          console.log("✅ Support attachment uploaded to R2:", url);
          attachmentUrls.push(url);
        } catch (uploadErr) {
          console.error("❌ Support chat: R2 upload failed:", uploadErr.message);
          return res.status(500).json({ success: false, message: "Failed to upload image. Please try again." });
        }
      }

      const payload = {
        userId,
        sessionId: sessionId.trim(),
        userMessage,
        isEndOfChat,
        attachments: attachmentUrls,
        email,
        username,
      };

      console.log("📤 Support webhook payload:", {
        userId,
        sessionId: payload.sessionId,
        hasMessage: !!userMessage,
        isEndOfChat,
        attachmentCount: attachmentUrls.length,
        attachmentUrls,
      });

      try {
        const webhookRes = await fetch(SUPPORT_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(SUPPORT_WEBHOOK_TIMEOUT_MS),
        });

        if (!webhookRes.ok) {
          const text = await webhookRes.text();
          console.error("Support webhook error:", webhookRes.status, text);
          if (isEndOfChat) {
            return res.json({ success: true, ended: true, ignoredWebhookError: true });
          }
          return res.status(502).json({
            success: false,
            message: "Support agent temporarily unavailable",
            details: text.slice(0, 200),
          });
        }

        const data = await webhookRes.json().catch(() => ({}));
        if (isEndOfChat) {
          return res.json({ success: true, ended: true });
        }
        return res.json({ success: true, ...data });
      } catch (webhookErr) {
        console.error("Support webhook request error:", webhookErr);
        if (isEndOfChat) {
          return res.json({ success: true, ended: true, ignoredWebhookError: true });
        }
        const code = webhookErr?.cause?.code || webhookErr?.code;
        const isUnreachable =
          code === "ENOTFOUND" ||
          code === "ECONNREFUSED" ||
          code === "ETIMEDOUT" ||
          code === "EAI_AGAIN" ||
          (typeof webhookErr?.message === "string" &&
            /fetch failed|getaddrinfo|network|ECONNRESET/i.test(webhookErr.message));
        return res.status(isUnreachable ? 503 : 502).json({
          success: false,
          message: isUnreachable
            ? "Support automation is temporarily unreachable. Please try again in a few minutes."
            : "Support agent temporarily unavailable",
          code: isUnreachable ? "SUPPORT_WEBHOOK_UNREACHABLE" : "SUPPORT_WEBHOOK_ERROR",
        });
      }
    } catch (err) {
      console.error("Support chat message error:", err);
      res.status(500).json({
        success: false,
        message: err.message || "Failed to send message",
      });
    }
  }
);

export default router;
