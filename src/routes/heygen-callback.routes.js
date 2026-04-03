import express from "express";
import prisma from "../lib/prisma.js";
import { refundCredits } from "../services/credit.service.js";

const router = express.Router();

function normalizeStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (["completed", "success", "succeeded", "ready", "finished"].includes(s)) return "completed";
  if (["failed", "fail", "error"].includes(s)) return "failed";
  return "processing";
}

async function completeAvatarVideoByRecord(videoRecord, payload) {
  if (!videoRecord) return false;
  const status = normalizeStatus(payload?.status || payload?.state);
  if (status === "completed") {
    const updated = await prisma.avatarVideo.updateMany({
      where: { id: videoRecord.id, status: { in: ["processing", "pending"] } },
      data: {
        status: "completed",
        outputUrl: payload?.video_url || payload?.url || payload?.videoUrl || null,
        duration: Number(payload?.duration || 0) || null,
        completedAt: new Date(),
        errorMessage: null,
      },
    });
    return updated.count > 0;
  }
  if (status === "failed") {
    const updated = await prisma.avatarVideo.updateMany({
      where: { id: videoRecord.id, status: { in: ["processing", "pending"] } },
      data: {
        status: "failed",
        errorMessage: payload?.error?.message || payload?.error_message || payload?.message || "HeyGen video failed",
        completedAt: new Date(),
      },
    });
    if (updated.count > 0) {
      await refundCredits(videoRecord.userId, videoRecord.creditsCost || 0).catch(() => {});
      return true;
    }
  }
  return false;
}

async function completeAvatarLookByRecord(avatarRecord, payload) {
  if (!avatarRecord) return false;
  const status = normalizeStatus(payload?.status || payload?.state);
  if (status === "completed") {
    const heygenAvatarId =
      payload?.avatar_id || payload?.avatarId || payload?.look_avatar_id || payload?.result?.avatar_id || null;
    const updated = await prisma.avatar.updateMany({
      where: { id: avatarRecord.id, status: { in: ["processing", "pending"] } },
      data: {
        status: "ready",
        heygenAvatarId: heygenAvatarId || avatarRecord.heygenAvatarId || undefined,
        errorMessage: null,
      },
    });
    return updated.count > 0;
  }
  if (status === "failed") {
    const updated = await prisma.avatar.updateMany({
      where: { id: avatarRecord.id, status: { in: ["processing", "pending"] } },
      data: {
        status: "failed",
        errorMessage: payload?.error?.message || payload?.error_message || payload?.message || "HeyGen avatar generation failed",
      },
    });
    if (updated.count > 0) {
      await refundCredits(avatarRecord.userId, avatarRecord.creditsCost || 0).catch(() => {});
      return true;
    }
  }
  return false;
}

router.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const event = String(body?.event || body?.type || "").toLowerCase();
    const data = body?.event_data || body?.data || body;
    const callbackId = String(data?.callback_id || data?.callbackId || "").trim();
    const videoId = String(data?.video_id || data?.videoId || "").trim();
    const avatarId = String(data?.avatar_id || data?.avatarId || "").trim();
    const groupId = String(data?.group_id || data?.groupId || data?.avatar_group_id || "").trim();

    // Video completion events
    if (event.includes("avatar_video") || videoId || callbackId) {
      let record = null;
      if (callbackId) {
        record = await prisma.avatarVideo.findFirst({
          where: { id: callbackId },
          select: { id: true, userId: true, creditsCost: true, status: true },
        });
      }
      if (!record && videoId) {
        record = await prisma.avatarVideo.findFirst({
          where: { heygenVideoId: videoId },
          select: { id: true, userId: true, creditsCost: true, status: true },
        });
      }
      if (record) {
        await completeAvatarVideoByRecord(record, data);
      }
      return res.json({ success: true });
    }

    // Photo avatar / look completion events
    if (event.includes("photo_avatar") || avatarId || groupId) {
      let avatarRecord = null;
      if (callbackId) {
        avatarRecord = await prisma.avatar.findFirst({
          where: { id: callbackId },
          select: { id: true, userId: true, creditsCost: true, status: true, heygenAvatarId: true },
        });
      }
      if (!avatarRecord && avatarId) {
        avatarRecord = await prisma.avatar.findFirst({
          where: { heygenAvatarId: avatarId },
          select: { id: true, userId: true, creditsCost: true, status: true, heygenAvatarId: true },
        });
      }
      if (!avatarRecord && groupId) {
        avatarRecord = await prisma.avatar.findFirst({
          where: {
            heygenGroupId: groupId,
            status: { in: ["processing", "pending"] },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, userId: true, creditsCost: true, status: true, heygenAvatarId: true },
        });
      }
      if (avatarRecord) {
        await completeAvatarLookByRecord(avatarRecord, data);
      }
      return res.json({ success: true });
    }

    return res.json({ success: true, ignored: true });
  } catch (error) {
    console.error("[HeyGen webhook] error:", error);
    // Always ack to avoid endless retries; watchdog polling remains fallback.
    return res.json({ success: true });
  }
});

export default router;
