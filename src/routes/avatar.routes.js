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
import { adminMiddleware } from "../middleware/admin.middleware.js";
import { getGenerationPricing } from "../services/generation-pricing.service.js";
import { textToSpeech } from "../services/elevenlabs.service.js";
import { uploadBufferToR2 } from "../utils/r2.js";
import {
  uploadAsset,
  createPhotoAvatar,
  pollAvatarUntilReady,
  deletePhotoAvatar,
  generateAvatarVideo,
  pollVideoUntilReady,
} from "../services/heygen.service.js";

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image files are allowed for avatar photos"));
  },
});

const MAX_AVATARS_PER_MODEL = 3;
const MAX_VIDEO_SECONDS = 600; // 10 minutes
const WORDS_PER_SECOND = 2.5;  // average speech rate

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimateDuration(script) {
  const words = script.trim().split(/\s+/).length;
  return Math.max(5, Math.round(words / WORDS_PER_SECOND));
}

/**
 * Charge 500cr monthly maintenance fee for any avatar that hasn't been billed
 * in the last 30 days. Suspends avatars if the user has insufficient credits.
 */
async function runMonthlyBillingForUser(userId) {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - THIRTY_DAYS);

  const due = await prisma.avatar.findMany({
    where: {
      userId,
      status: { in: ["ready", "processing", "suspended"] },
      lastBilledAt: { lt: cutoff },
    },
  });

  if (!due.length) return;

  const pricing = await getGenerationPricing();
  const monthlyCost = pricing.avatarMonthly ?? 500;

  for (const avatar of due) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    const hasCredits = user && user.credits >= monthlyCost;

    if (hasCredits) {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { credits: { decrement: monthlyCost } },
        }),
        prisma.avatar.update({
          where: { id: avatar.id },
          data: { lastBilledAt: new Date(), status: avatar.status === "suspended" ? "ready" : avatar.status },
        }),
      ]);
      console.log(`💳 [Avatar] Monthly fee charged: ${monthlyCost}cr for avatar ${avatar.id}`);
    } else {
      await prisma.avatar.update({
        where: { id: avatar.id },
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

/** POST /api/avatars — create a new avatar */
router.post("/", upload.single("photo"), async (req, res) => {
  const { modelId, name } = req.body;

  if (!modelId) return res.status(400).json({ error: "modelId is required" });
  if (!name?.trim()) return res.status(400).json({ error: "Avatar name is required" });
  if (!req.file) return res.status(400).json({ error: "Photo is required" });

  // Verify model ownership
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId: req.user.id },
    select: { id: true, elevenLabsVoiceId: true },
  });
  if (!model) return res.status(404).json({ error: "Model not found" });

  // Voice is required — all avatars for a model share the model's voice
  if (!model.elevenLabsVoiceId) {
    return res.status(400).json({
      error: "This model has no voice. Please create a custom voice for it first in Model Settings.",
      code: "NO_VOICE",
    });
  }

  // Enforce 3-avatar limit
  const existing = await prisma.avatar.count({ where: { modelId, userId: req.user.id } });
  if (existing >= MAX_AVATARS_PER_MODEL) {
    return res.status(400).json({
      error: `You can have at most ${MAX_AVATARS_PER_MODEL} avatars per model. Delete one to create a new one.`,
      code: "LIMIT_REACHED",
    });
  }

  // Credit check
  const pricing = await getGenerationPricing();
  const creationCost = pricing.avatarCreation ?? 1000;

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { credits: true },
  });
  if (!user || user.credits < creationCost) {
    return res.status(402).json({
      error: `Insufficient credits. Avatar creation costs ${creationCost} credits.`,
    });
  }

  // Deduct credits upfront
  await prisma.user.update({
    where: { id: req.user.id },
    data: { credits: { decrement: creationCost } },
  });

  // Upload photo to R2 for our own storage
  const ext = req.file.mimetype.split("/")[1] || "jpg";
  let photoUrl;
  try {
    photoUrl = await uploadBufferToR2(req.file.buffer, "avatars", ext, req.file.mimetype);
  } catch (err) {
    await prisma.user.update({ where: { id: req.user.id }, data: { credits: { increment: creationCost } } });
    return res.status(500).json({ error: "Failed to upload photo: " + err.message });
  }

  // Create DB record immediately so UI can show processing state
  const avatar = await prisma.avatar.create({
    data: {
      userId: req.user.id,
      modelId,
      name: name.trim(),
      photoUrl,
      status: "processing",
      creditsCost: creationCost,
    },
  });

  res.json({ success: true, avatar });

  // Process in background
  processAvatarCreation(avatar.id, req.user.id, req.file.buffer, req.file.mimetype, ext, creationCost).catch(
    err => console.error(`[Avatar] Background creation failed for ${avatar.id}:`, err.message)
  );
});

async function processAvatarCreation(avatarId, userId, photoBuffer, mimeType, ext, creationCost) {
  try {
    console.log(`[Avatar] Starting HeyGen avatar creation for ${avatarId}`);

    // 1. Upload image to HeyGen
    const imageAssetId = await uploadAsset(photoBuffer, `avatar_${avatarId}.${ext}`, mimeType);

    // 2. Submit photo avatar creation
    const groupId = await createPhotoAvatar(imageAssetId, `Avatar ${avatarId}`);

    // Persist groupId
    await prisma.avatar.update({ where: { id: avatarId }, data: { heygenGroupId: groupId } });

    // 3. Poll until ready
    const { avatarId: heygenAvatarId } = await pollAvatarUntilReady(groupId);

    // 4. Mark as ready
    await prisma.avatar.update({
      where: { id: avatarId },
      data: { status: "ready", heygenAvatarId },
    });

    console.log(`✅ [Avatar] Avatar ${avatarId} is ready (HeyGen ID: ${heygenAvatarId})`);
  } catch (err) {
    console.error(`❌ [Avatar] Creation failed for ${avatarId}: ${err.message}`);

    await prisma.avatar.update({
      where: { id: avatarId },
      data: { status: "failed", errorMessage: err.message },
    });

    // Refund credits
    await prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: creationCost } },
    });

    console.log(`💳 [Avatar] Refunded ${creationCost}cr to user ${userId} after creation failure`);
  }
}

/** DELETE /api/avatars/:id */
router.delete("/:id", async (req, res) => {
  const avatar = await prisma.avatar.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!avatar) return res.status(404).json({ error: "Avatar not found" });

  // Delete from HeyGen (best-effort)
  if (avatar.heygenGroupId) {
    deletePhotoAvatar(avatar.heygenGroupId).catch(e =>
      console.warn("[Avatar] HeyGen delete failed (ignoring):", e.message)
    );
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

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { credits: true },
  });
  if (!user || user.credits < creditsCost) {
    return res.status(402).json({
      error: `Insufficient credits. Estimated cost: ${creditsCost}cr (${estimatedSecs}s × ${costPerSec}cr/s).`,
    });
  }

  // Deduct upfront
  await prisma.user.update({
    where: { id: req.user.id },
    data: { credits: { decrement: creditsCost } },
  });

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

    // 1. Generate audio from script using ElevenLabs
    const audioBuffer = await textToSpeech(script, elevenLabsVoiceId, {
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
    });

    // 2. Upload audio to HeyGen
    const audioAssetId = await uploadAsset(
      audioBuffer,
      `avatar_video_${videoId}.mp3`,
      "audio/mpeg"
    );

    // 3. Submit video generation
    const heygenVideoId = await generateAvatarVideo(heygenAvatarId, audioAssetId);

    await prisma.avatarVideo.update({
      where: { id: videoId },
      data: { heygenVideoId },
    });

    // 4. Poll until done
    const result = await pollVideoUntilReady(heygenVideoId);

    // 5. Finalize
    await prisma.avatarVideo.update({
      where: { id: videoId },
      data: {
        status: "completed",
        outputUrl: result.videoUrl,
        duration: result.duration,
        completedAt: new Date(),
      },
    });

    console.log(`✅ [Avatar] Video ${videoId} completed`);
  } catch (err) {
    console.error(`❌ [Avatar] Video ${videoId} failed: ${err.message}`);

    await prisma.avatarVideo.update({
      where: { id: videoId },
      data: { status: "failed", errorMessage: err.message, completedAt: new Date() },
    });

    // Refund credits
    await prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: creditsCost } },
    });

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
