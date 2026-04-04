/**
 * Real Avatars — powered by HeyGen Photo Avatar IV + ElevenLabs TTS
 *
 * Routes:
 *   GET    /api/avatars?modelId=         list avatars for a model (+ run billing check)
 *   POST   /api/avatars                  create avatar (upload photo + assign to model)
 *   DELETE /api/avatars/:id              delete avatar
 *   POST   /api/avatars/:id/generate     generate a video with an avatar
 *   GET    /api/avatar-videos/:videoId   poll video status
 *   GET    /api/avatars/:id/videos       list videos for an avatar
 */

import express from "express";
import multer from "multer";
import prisma from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { getGenerationPricing } from "../services/generation-pricing.service.js";
import { uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import { assertHttpsAllowedAssetUrl } from "../utils/publicAssetHost.js";
import {
  checkAndExpireCredits,
  getTotalCredits,
  deductCredits,
  refundCredits,
} from "../services/credit.service.js";
import {
  uploadAsset,
  createPhotoAvatarGroup,
  addLookToAvatarGroup,
  trainPhotoAvatarGroup,
  getPhotoAvatarStatus,
  pollAvatarUntilReady,
  deletePhotoAvatar,
  deletePhotoAvatarGroup,
  generateAvatarVideo,
  pollVideoUntilReady,
} from "../services/heygen.service.js";

const router = express.Router();
router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image files are allowed for avatar photos"));
  },
});

const MAX_GROUPS_PER_USER = 3;
const MAX_LOOKS_PER_GROUP = 3;
const MAX_TOTAL_SLOTS = MAX_GROUPS_PER_USER * MAX_LOOKS_PER_GROUP; // 9
const MAX_VIDEO_SECONDS = 600; // 10 minutes
const WORDS_PER_SECOND = 2.5;  // average speech rate

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimateDuration(script) {
  const words = script.trim().split(/\s+/).length;
  return Math.max(5, Math.round(words / WORDS_PER_SECOND));
}

async function waitForPhotoGenerationSuccess(generationId, maxMs = 8 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  let delay = 5_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.floor(delay * 1.35), 20_000);
    const row = await getPhotoAvatarStatus(generationId);
    if (row.status === "completed") return row;
    if (row.status === "failed") {
      throw new Error("HeyGen look generation failed");
    }
  }
  throw new Error("HeyGen look generation timed out");
}

async function trainGroupWhenReady(groupId, lookGenerationId = null) {
  if (lookGenerationId) {
    await waitForPhotoGenerationSuccess(lookGenerationId);
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const train = await trainPhotoAvatarGroup(groupId);
      return train?.generationId || null;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      const notReadyYet = message.includes("No valid image for training found");
      if (!notReadyYet || attempt === 4) break;
      const backoff = attempt * 8_000;
      console.warn(`[Avatar] train not ready for group ${groupId}, retry ${attempt}/4 in ${Math.round(backoff / 1000)}s`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastError || new Error("HeyGen train failed");
}

async function markAvatarReadyById(avatarId, heygenAvatarId) {
  const result = await prisma.avatar.updateMany({
    where: {
      id: avatarId,
      status: { in: ["processing", "pending"] },
    },
    data: {
      status: "ready",
      heygenAvatarId: heygenAvatarId || undefined,
      errorMessage: null,
    },
  });
  return result.count > 0;
}

async function markAvatarFailedAndRefund(avatarId, reason) {
  const row = await prisma.avatar.findUnique({
    where: { id: avatarId },
    select: { id: true, userId: true, status: true, creditsCost: true },
  });
  if (!row || row.status === "failed" || row.status === "ready") return false;
  const updated = await prisma.avatar.updateMany({
    where: { id: avatarId, status: { in: ["processing", "pending"] } },
    data: { status: "failed", errorMessage: reason || "Avatar creation failed" },
  });
  if (updated.count > 0) {
    await refundCredits(row.userId, row.creditsCost || 0).catch(() => {});
    return true;
  }
  return false;
}

async function markVideoCompleted(videoId, outputUrl, duration) {
  const updated = await prisma.avatarVideo.updateMany({
    where: { id: videoId, status: { in: ["processing", "pending"] } },
    data: {
      status: "completed",
      outputUrl: outputUrl || null,
      duration: duration ?? null,
      completedAt: new Date(),
      errorMessage: null,
    },
  });
  return updated.count > 0;
}

async function markVideoFailedAndRefund(videoId, reason) {
  const row = await prisma.avatarVideo.findUnique({
    where: { id: videoId },
    select: { id: true, userId: true, status: true, creditsCost: true },
  });
  if (!row || row.status === "failed" || row.status === "completed") return false;
  const updated = await prisma.avatarVideo.updateMany({
    where: { id: videoId, status: { in: ["processing", "pending"] } },
    data: {
      status: "failed",
      errorMessage: reason || "Avatar video generation failed",
      completedAt: new Date(),
    },
  });
  if (updated.count > 0) {
    await refundCredits(row.userId, row.creditsCost || 0).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Charge 500cr monthly maintenance fee for any avatar that hasn't been billed
 * in the last 30 days. Suspends avatars if the user has insufficient credits.
 */
async function runMonthlyBillingForUser(userId) {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - THIRTY_DAYS);

  const dueRaw = await prisma.avatar.findMany({
    where: {
      userId,
      status: { in: ["ready", "processing", "suspended"] },
      lastBilledAt: { lt: cutoff },
      heygenGroupId: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!dueRaw.length) return;

  // Charge once per HeyGen group, not per look row.
  const dueByGroup = new Map();
  for (const row of dueRaw) {
    const key = String(row.heygenGroupId || "");
    if (!key || dueByGroup.has(key)) continue;
    dueByGroup.set(key, row);
  }
  const due = [...dueByGroup.values()];
  if (!due.length) return;

  const pricing = await getGenerationPricing();
  const monthlyCost = pricing.avatarMonthly ?? 500;

  for (const avatar of due) {
    const user = await checkAndExpireCredits(userId);
    const hasCredits = getTotalCredits(user) >= monthlyCost;

    if (hasCredits) {
      await deductCredits(userId, monthlyCost);
      await prisma.avatar.updateMany({
        where: { userId, heygenGroupId: avatar.heygenGroupId },
        data: { lastBilledAt: new Date(), status: "ready" },
      });
      console.log(`💳 [Avatar] Monthly fee charged: ${monthlyCost}cr for avatar ${avatar.id}`);
    } else {
      await prisma.avatar.updateMany({
        where: { userId, heygenGroupId: avatar.heygenGroupId },
        data: { status: "suspended", lastBilledAt: new Date() },
      });
      console.warn(`⚠️  [Avatar] Insufficient credits for monthly fee — avatar ${avatar.id} suspended`);
    }
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/avatars?modelId=xxx */
router.get("/", async (req, res) => {
  const { modelId } = req.query;
  if (!modelId) return res.status(400).json({ error: "modelId is required" });

  // Verify the model belongs to this user
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId: req.user.id },
    select: { id: true, name: true, elevenLabsVoiceId: true, elevenLabsVoiceType: true, elevenLabsVoiceName: true },
  });
  if (!model) return res.status(404).json({ error: "Model not found" });

  await runMonthlyBillingForUser(req.user.id).catch(e =>
    console.error("[Avatar] Monthly billing error:", e.message)
  );

  const avatars = await prisma.avatar.findMany({
    where: { modelId, userId: req.user.id },
    orderBy: { createdAt: "asc" },
    include: {
      videos: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true, status: true, outputUrl: true, duration: true,
          creditsCost: true, createdAt: true, completedAt: true, errorMessage: true,
          script: true,
        },
      },
    },
  });

  return res.json({ avatars, model });
});

/** POST /api/avatars — create a new avatar (multipart photo or JSON { modelId, name, photoUrl } after client → Blob) */
async function createAvatarFromPhotoBuffer(req, res, buffer, mimeType) {
  const { modelId, name } = req.body;

  if (!modelId) return res.status(400).json({ error: "modelId is required" });
  if (!name?.trim()) return res.status(400).json({ error: "Avatar name is required" });

  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId: req.user.id },
    select: { id: true, elevenLabsVoiceId: true },
  });
  if (!model) return res.status(404).json({ error: "Model not found" });

  if (!model.elevenLabsVoiceId) {
    return res.status(400).json({
      error: "This model has no default voice. Please create and select one in Voice Studio first.",
      code: "NO_VOICE",
    });
  }

  const modelAvatars = await prisma.avatar.findMany({
    where: { userId: req.user.id, modelId },
    select: { id: true, heygenGroupId: true },
    orderBy: { createdAt: "asc" },
  });
  const existingGroupId = modelAvatars.find((a) => !!a.heygenGroupId)?.heygenGroupId || null;
  if (existingGroupId && modelAvatars.length >= MAX_LOOKS_PER_GROUP) {
    return res.status(400).json({
      error: `This avatar group already has ${MAX_LOOKS_PER_GROUP} looks.`,
      code: "LOOK_LIMIT_REACHED",
    });
  }

  const userAvatars = await prisma.avatar.findMany({
    where: { userId: req.user.id },
    select: { heygenGroupId: true },
  });
  const totalSlots = userAvatars.length;
  const groupCount = new Set(userAvatars.map((a) => a.heygenGroupId).filter(Boolean)).size;
  if (totalSlots >= MAX_TOTAL_SLOTS) {
    return res.status(400).json({
      error: `You reached the total Real Avatar slot limit (${MAX_TOTAL_SLOTS}).`,
      code: "SLOT_LIMIT_REACHED",
    });
  }
  if (!existingGroupId && groupCount >= MAX_GROUPS_PER_USER) {
    return res.status(400).json({
      error: `You can create at most ${MAX_GROUPS_PER_USER} avatar groups.`,
      code: "GROUP_LIMIT_REACHED",
    });
  }

  const pricing = await getGenerationPricing();
  const creationCost = pricing.avatarCreation ?? 1000;

  const user = await checkAndExpireCredits(req.user.id);
  if (getTotalCredits(user) < creationCost) {
    return res.status(402).json({
      error: `Insufficient credits. Avatar creation costs ${creationCost} credits.`,
    });
  }

  await deductCredits(req.user.id, creationCost);

  const ext = mimeType.split("/")[1] || "jpg";
  let photoUrl;
  try {
    photoUrl = await uploadBufferToBlobOrR2(buffer, "avatars", ext, mimeType);
  } catch (err) {
    await refundCredits(req.user.id, creationCost).catch(() => {});
    return res.status(500).json({ error: "Failed to upload photo: " + err.message });
  }

  const avatar = await prisma.avatar.create({
    data: {
      userId: req.user.id,
      modelId,
      name: name.trim(),
      photoUrl,
      status: "processing",
      creditsCost: creationCost,
      heygenGroupId: existingGroupId,
    },
  });

  res.json({ success: true, avatar });

  processAvatarCreation(avatar.id, req.user.id, buffer, mimeType, ext, creationCost, existingGroupId).catch((err) =>
    console.error(`[Avatar] Background creation failed for ${avatar.id}:`, err.message),
  );
}

router.post(
  "/",
  (req, res, next) => {
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("application/json")) return next();
    return express.json({ limit: "2mb" })(req, res, next);
  },
  async (req, res, next) => {
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("application/json")) return next();
    const { modelId, name, photoUrl: remoteUrl } = req.body || {};
    if (!modelId || !name?.trim() || !remoteUrl) {
      return res.status(400).json({ error: "modelId, name, and photoUrl (https) are required" });
    }
    let href;
    try {
      href = assertHttpsAllowedAssetUrl(String(remoteUrl), "photoUrl");
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    let r;
    try {
      r = await fetch(href);
    } catch {
      return res.status(400).json({ error: "Failed to fetch photo" });
    }
    if (!r.ok) return res.status(400).json({ error: "Photo URL returned an error" });
    const mimeType = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) {
      return res.status(400).json({ error: "photoUrl must point to an image" });
    }
    const buffer = Buffer.from(await r.arrayBuffer());
    const maxBytes = 20 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return res.status(400).json({ error: "Photo is too large" });
    }
    return createAvatarFromPhotoBuffer(req, res, buffer, mimeType);
  },
  upload.single("photo"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Photo is required" });
    return createAvatarFromPhotoBuffer(req, res, req.file.buffer, req.file.mimetype);
  },
);

async function processAvatarCreation(avatarId, userId, photoBuffer, mimeType, ext, creationCost, existingGroupId = null) {
  try {
    console.log(`[Avatar] Starting HeyGen avatar creation for ${avatarId}`);

    // 1. Upload image to HeyGen
    const uploaded = await uploadAsset(photoBuffer, `avatar_${avatarId}.${ext}`, mimeType, "photo_avatar");
    const imageKey = uploaded.imageKey;
    if (!imageKey) throw new Error("HeyGen upload did not return image_key");

    let groupId = existingGroupId;
    let lookGenerationId = null;
    if (groupId) {
      // Add a new look to existing avatar group
      const added = await addLookToAvatarGroup(groupId, [imageKey]);
      lookGenerationId = added.generationId || null;
    } else {
      const created = await createPhotoAvatarGroup(imageKey, `Avatar ${avatarId}`);
      groupId = created.groupId;
      lookGenerationId = created.generationId || null;
    }
    const trainGenerationId = await trainGroupWhenReady(groupId, lookGenerationId);

    // Persist groupId then poll status endpoint until we receive look/avatar_id.
    await prisma.avatar.update({ where: { id: avatarId }, data: { heygenGroupId: groupId } });
    // Webhook-first: wait for HeyGen webhook to finalize.
    // Fallback watchdog polls after a grace period in case webhook is missed.
    const pollTarget = trainGenerationId || lookGenerationId || null;
    if (pollTarget) {
      setTimeout(async () => {
        try {
          const current = await prisma.avatar.findUnique({
            where: { id: avatarId },
            select: { status: true },
          });
          if (!current || current.status !== "processing") return;
          const ready = await pollAvatarUntilReady(pollTarget);
          const changed = await markAvatarReadyById(avatarId, ready.avatarId);
          if (changed) {
            console.log(`✅ [Avatar] Watchdog finalized avatar ${avatarId} ready (${ready.avatarId})`);
          }
        } catch (watchErr) {
          const changed = await markAvatarFailedAndRefund(
            avatarId,
            watchErr?.message || "Avatar creation watchdog failed",
          );
          if (changed) {
            console.warn(`⚠️ [Avatar] Watchdog marked avatar ${avatarId} failed`);
          }
        }
      }, 90_000);
    } else {
      console.warn(`[Avatar] No HeyGen generation ID returned for avatar ${avatarId}; relying on webhook only`);
    }

    console.log(`✅ [Avatar] Avatar ${avatarId} submitted; awaiting webhook`);
  } catch (err) {
    console.error(`❌ [Avatar] Creation failed for ${avatarId}: ${err.message}`);
    await markAvatarFailedAndRefund(avatarId, err.message);

    console.log(`💳 [Avatar] Refunded ${creationCost}cr to user ${userId} after creation failure`);
  }
}

/** DELETE /api/avatars/:id */
router.delete("/:id", async (req, res) => {
  const avatar = await prisma.avatar.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!avatar) return res.status(404).json({ error: "Avatar not found" });

  // Delete look on HeyGen (best-effort)
  if (avatar.heygenAvatarId) {
    deletePhotoAvatar(avatar.heygenAvatarId).catch((e) =>
      console.warn("[Avatar] HeyGen look delete failed (ignoring):", e.message),
    );
  }

  // If this was the last look in a group, delete the whole group.
  if (avatar.heygenGroupId) {
    const remainingLooks = await prisma.avatar.count({
      where: {
        userId: req.user.id,
        heygenGroupId: avatar.heygenGroupId,
        NOT: { id: avatar.id },
      },
    });
    if (remainingLooks === 0) {
      deletePhotoAvatarGroup(avatar.heygenGroupId).catch((e) =>
        console.warn("[Avatar] HeyGen group delete failed (ignoring):", e.message),
      );
    }
  }

  // Cascade-delete videos and avatar record
  await prisma.avatarVideo.deleteMany({ where: { avatarId: avatar.id } });
  await prisma.avatar.delete({ where: { id: avatar.id } });

  return res.json({ success: true });
});

/** POST /api/avatars/:id/generate — generate a video */
router.post("/:id/generate", async (req, res) => {
  const { script } = req.body;

  if (!script?.trim()) return res.status(400).json({ error: "Script is required" });

  const avatar = await prisma.avatar.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: {
      model: {
        select: { id: true, elevenLabsVoiceId: true },
      },
    },
  });
  if (!avatar) return res.status(404).json({ error: "Avatar not found" });
  if (avatar.status !== "ready") {
    return res.status(400).json({ error: `Avatar is ${avatar.status}. Only ready avatars can generate videos.` });
  }
  if (!avatar.heygenAvatarId) {
    return res.status(400).json({ error: "Avatar has no HeyGen ID. Please contact support." });
  }
  if (!avatar.model.elevenLabsVoiceId) {
    return res.status(400).json({ error: "Model has no voice configured." });
  }

  const trimmedScript = script.trim();
  const estimatedSecs = estimateDuration(trimmedScript);

  if (estimatedSecs > MAX_VIDEO_SECONDS) {
    return res.status(400).json({
      error: `Script is too long. Maximum video length is ${MAX_VIDEO_SECONDS / 60} minutes (~${
        Math.round(MAX_VIDEO_SECONDS * WORDS_PER_SECOND)
      } words).`,
    });
  }

  const pricing = await getGenerationPricing();
  const costPerSec = pricing.avatarVideoPerSec ?? 5;
  const creditsCost = estimatedSecs * costPerSec;

  const user = await checkAndExpireCredits(req.user.id);
  if (getTotalCredits(user) < creditsCost) {
    return res.status(402).json({
      error: `Insufficient credits. Estimated cost: ${creditsCost}cr (${estimatedSecs}s × ${costPerSec}cr/s).`,
    });
  }

  // Deduct upfront
  await deductCredits(req.user.id, creditsCost);

  const videoRecord = await prisma.avatarVideo.create({
    data: {
      userId: req.user.id,
      avatarId: avatar.id,
      script: trimmedScript,
      status: "processing",
      creditsCost,
    },
  });

  res.json({ success: true, video: videoRecord, estimatedSecs, creditsCost });

  // Background
  processVideoGeneration(
    videoRecord.id,
    req.user.id,
    avatar.heygenAvatarId,
    avatar.model.elevenLabsVoiceId,
    trimmedScript,
    creditsCost
  ).catch(e => console.error(`[Avatar] Video generation failed for ${videoRecord.id}:`, e.message));
});

async function processVideoGeneration(videoId, userId, heygenAvatarId, elevenLabsVoiceId, script, creditsCost) {
  try {
    console.log(`[Avatar] Generating video ${videoId}`);

    // AV4 with ElevenLabs voice provider (eleven_v3), no pre-rendered audio pipeline.
    const heygenVideoId = await generateAvatarVideo({
      avatarId: heygenAvatarId,
      inputText: script,
      heygenVoiceId: elevenLabsVoiceId,
      title: `Modelclone Avatar ${videoId}`,
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
      test: false,
      callbackId: videoId,
    });

    await prisma.avatarVideo.update({
      where: { id: videoId },
      data: { heygenVideoId },
    });

    // Webhook-first completion; fallback watchdog polling.
    setTimeout(async () => {
      try {
        const row = await prisma.avatarVideo.findUnique({
          where: { id: videoId },
          select: { status: true },
        });
        if (!row || row.status !== "processing") return;
        const result = await pollVideoUntilReady(heygenVideoId);
        const changed = await markVideoCompleted(videoId, result.videoUrl, result.duration);
        if (changed) console.log(`✅ [Avatar] Watchdog completed video ${videoId}`);
      } catch (watchErr) {
        const changed = await markVideoFailedAndRefund(
          videoId,
          watchErr?.message || "Avatar video watchdog failed",
        );
        if (changed) console.warn(`⚠️ [Avatar] Watchdog marked video ${videoId} failed`);
      }
    }, 75_000);

    console.log(`✅ [Avatar] Video ${videoId} submitted; awaiting webhook`);
  } catch (err) {
    console.error(`❌ [Avatar] Video ${videoId} failed: ${err.message}`);
    await markVideoFailedAndRefund(videoId, err.message);

    console.log(`💳 [Avatar] Refunded ${creditsCost}cr to user ${userId} after video failure`);
  }
}

/** GET /api/avatar-videos/:videoId — poll video status */
router.get("/videos/:videoId", async (req, res) => {
  // Note: this path is mounted under /api/avatars, but we want /api/avatar-videos/:id
  // Use the router.get approach on /api/avatar-videos instead (mounted separately)
  const video = await prisma.avatarVideo.findFirst({
    where: { id: req.params.videoId, userId: req.user.id },
  });
  if (!video) return res.status(404).json({ error: "Video not found" });
  return res.json({ video });
});

/** GET /api/avatars/:id/videos */
router.get("/:id/videos", async (req, res) => {
  const avatar = await prisma.avatar.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: { id: true },
  });
  if (!avatar) return res.status(404).json({ error: "Avatar not found" });

  const videos = await prisma.avatarVideo.findMany({
    where: { avatarId: avatar.id, userId: req.user.id },
    orderBy: { createdAt: "desc" },
  });

  return res.json({ videos });
});

export { router as avatarRoutes };
export default router;
