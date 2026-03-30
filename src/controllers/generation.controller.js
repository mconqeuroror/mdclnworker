import prisma from "../lib/prisma.js";
import {
  faceSwapVideo,
} from "../services/wavespeed.service.js";
import {
  generateImageWithNanoBananaKie,
  generateTextToImageNanoBananaKie,
  generateVideoWithMotionKie,
  generateVideoWithKling26Kie,
  generateVideoWithWanAnimateMoveKie,
  generateVideoWithWanAnimateReplaceKie,
  generateVideoWithSora2ProKie,
  generateVideoWithKlingTextKie,
  generateVideoWithVeo31Kie,
  extendVideoWithVeo31Kie,
} from "../services/kie.service.js";
import { submitPiApiTask } from "../services/piapi.service.js";
import {
  generateImageWithIdentityWaveSpeed,
  generateImageWithSeedreamWaveSpeed,
} from "../services/wavespeed.service.js";
import {
  extractFrameFromVideo,
  extractFramesFromVideo,
  generateVariations,
  preprocessReferenceVideoForKling,
  preprocessAudioForTalkingHead,
} from "../services/video.service.js";
import requestQueue from "../services/queue.service.js";
import {
  checkAndExpireCredits,
  getTotalCredits,
  deductCredits,
  refundCredits,
  refundGeneration,
} from "../services/credit.service.js";
import { isR2Configured, mirrorToR2, reMirrorToR2 } from "../utils/r2.js";
import {
  mirrorToBlob,
  isVercelBlobConfigured,
  mirrorExternalUrlToPersistentBlob,
} from "../utils/kieUpload.js";
import { deleteStoredMediaFromOutputField } from "../utils/storageDelete.js";
import {
  validateImageUrl,
  validateVideoUrl,
  validateImageUrls,
  validateNanoBananaInputImages,
  validateSeedreamEditImages,
  validateFaceSwapSourceVideoUrl,
  validateTalkingHeadAvatarImageUrl,
} from "../utils/fileValidation.js";
import { waveSpeedConstraints } from "../config/providerMediaConstraints.js";
import { getUserFriendlyGenerationError } from "../utils/generationErrorMessages.js";
import { buildAppearancePrefix } from "../utils/appearancePrompt.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import { getGenerationPricing } from "../services/generation-pricing.service.js";
import {
  IDENTITY_RECREATE_MODEL_CLOTHES,
  IDENTITY_RECREATE_REFERENCE_CLOTHES,
} from "../constants/identityRecreationPrompts.js";
import { persistKieGenerationCorrelation } from "../utils/kieTaskCorrelation.js";
import {
  RECREATE_ENGINE,
  normalizeRecreateEngine,
  normalizeWanResolution,
  getRecreateReplicateModel,
} from "../config/kie-video-catalog.js";
import {
  estimateRecreateCredits,
  getRecreateCreditsPerSecond,
} from "../services/video-generation-pricing.js";

const PERSISTED_IMAGE_TYPES = new Set([
  "image",
  "image-identity",
  "prompt-image",
  "face-swap-image",
  "advanced-image",
  "nsfw",
]);

async function registerKieTaskForGeneration(taskId, generationId, userId, kind = "generation") {
  if (!taskId || !generationId) return;
  await prisma.kieTask.upsert({
    where: { taskId },
    update: {
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

function isR2Url(url) {
  if (!url || typeof url !== "string") return false;
  const publicBase = process.env.R2_PUBLIC_URL || "";
  return url.includes("r2.dev") || (publicBase && url.includes(publicBase));
}

function isOurPersistedBlobUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.includes("vercel-storage.com") || url.includes("blob.vercel.app");
}

function isPersistedOutputStorageUrl(url) {
  return isR2Url(url) || isOurPersistedBlobUrl(url);
}

async function submitRecreateVideoTask({
  imageUrl,
  referenceVideoUrl,
  recreateEngine = RECREATE_ENGINE.KLING,
  recreateUltra = false,
  wanResolution = "580p",
  videoPrompt = "",
  onTaskSubmitted,
}) {
  if (normalizeRecreateEngine(recreateEngine) === RECREATE_ENGINE.WAN) {
    return generateVideoWithWanAnimateMoveKie(imageUrl, referenceVideoUrl, {
      resolution: normalizeWanResolution(wanResolution),
      nsfwChecker: false,
      onTaskSubmitted,
    });
  }
  return generateVideoWithMotionKie(imageUrl, referenceVideoUrl, {
    videoPrompt,
    ultra: !!recreateUltra,
    onTaskSubmitted,
  });
}

/** Prefer Vercel Blob for completed image outputs; fall back to R2 when Blob fails or is off. */
async function ensureGenerationOutputPersisted(generation) {
  if (!generation || generation.status !== "completed") return generation;
  if (!PERSISTED_IMAGE_TYPES.has(generation.type)) return generation;
  if (!generation.outputUrl || typeof generation.outputUrl !== "string") return generation;

  const useBlob = isVercelBlobConfigured();
  const useR2 = isR2Configured();
  if (!useBlob && !useR2) return generation;

  const raw = generation.outputUrl.trim();
  if (!raw) return generation;

  const mirrorOne = async (url) => {
    if (typeof url !== "string" || !url.startsWith("http")) return url;
    if (isPersistedOutputStorageUrl(url)) return url;
    if (useBlob) {
      try {
        return await mirrorExternalUrlToPersistentBlob(url, "generations");
      } catch (e) {
        console.warn(`⚠️ Blob persist failed (${e?.message}) — ${useR2 ? "falling back to R2" : "keeping provider URL"}`);
        if (useR2) return await mirrorToR2(url, "generations");
        return url;
      }
    }
    return await mirrorToR2(url, "generations");
  };

  try {
    if (raw.startsWith("[")) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return generation;
      const mirrored = await Promise.all(parsed.map((url) => mirrorOne(url)));
      const changed = mirrored.some((url, i) => url !== parsed[i]);
      if (!changed) return generation;
      const nextOutput = JSON.stringify(mirrored);
      await prisma.generation.update({
        where: { id: generation.id },
        data: { outputUrl: nextOutput },
      });
      return { ...generation, outputUrl: nextOutput };
    }
  } catch (error) {
    console.warn(`⚠️ Failed parsing outputUrl JSON for generation ${generation.id}:`, error.message);
    return generation;
  }

  if (!raw.startsWith("http") || isPersistedOutputStorageUrl(raw)) return generation;

  const mirrored = await mirrorOne(raw);
  if (!mirrored || mirrored === raw) return generation;

  await prisma.generation.update({
    where: { id: generation.id },
    data: { outputUrl: mirrored },
  });
  return { ...generation, outputUrl: mirrored };
}

/**
 * Ensure a media URL is reliably accessible to KIE.
 * Always force re-downloads and re-uploads to R2 — never uses cached CDN URL
 * which can time out from KIE's servers (pub-xxx.r2.dev is slow for KIE).
 */
async function ensureKieAccessibleUrl(url, label = "media") {
  if (!url || !url.startsWith("http")) return url;
  // Vercel Blob: guaranteed public URL, always reachable from KIE servers
  if (isVercelBlobConfigured()) {
    return mirrorToBlob(url, "kie-media");
  }
  // Fallback: R2 CDN (may not work from KIE servers in some regions)
  return reMirrorToR2(url, "generations");
}

/**
 * Generate image with identity preservation
 * YOUR WORKFLOW - Step 1 only
 */
export async function generateImageWithIdentity(req, res) {
  try {
    const {
      modelId,
      identityImages,
      targetImage,
      aspectRatio,
      size,
      quantity = 1,
      prompt,
      clothesMode,
      tempGenerationIds, // v46 FIX: Receive temp IDs from frontend
    } = req.body;
    const userId = req.user.userId;

    // Validate
    if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Model ID is required",
      });
    }

    // Verify ownership
    const modelOwnership = await prisma.savedModel.findUnique({
      where: { id: modelId },
    });

    if (!modelOwnership || modelOwnership.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Model not found or unauthorized",
      });
    }

    if (
      !identityImages ||
      !Array.isArray(identityImages) ||
      identityImages.length !== 3
    ) {
      return res.status(400).json({
        success: false,
        message: "Need exactly 3 identity images (array of URLs)",
      });
    }

    if (!targetImage) {
      return res.status(400).json({
        success: false,
        message: "Need target image URL",
      });
    }

    const identityCheck = validateImageUrls(identityImages);
    if (!identityCheck.valid) {
      return res.status(400).json({ success: false, message: identityCheck.message });
    }
    const targetCheck = validateImageUrl(targetImage);
    if (!targetCheck.valid) {
      return res.status(400).json({ success: false, message: targetCheck.message });
    }
    const seedreamInputsCheck = await validateSeedreamEditImages([...identityImages, targetImage], "wavespeed");
    if (!seedreamInputsCheck.valid) {
      return res.status(400).json({ success: false, message: seedreamInputsCheck.message });
    }

    // Validate quantity (1-10)
    const imageQuantity = Math.min(Math.max(parseInt(quantity) || 1, 1), 10);
    const pricing = await getGenerationPricing();
    const creditsNeeded = imageQuantity * pricing.imageIdentity;

    // Check credits (with expiration check)
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits to generate ${imageQuantity} image(s). You have ${totalCredits} credits.`,
      });
    }

    // Identity: "model" = outfit from image 3; "reference" = outfit + scene styling from image 4 + optional user edit
    let customPrompt;
    if (clothesMode === "reference") {
      customPrompt =
        IDENTITY_RECREATE_REFERENCE_CLOTHES +
        (prompt && prompt.trim() ? ` Additional direction: ${prompt.trim()}` : "");
    } else {
      // "model" or legacy "random" — keep model clothes from image 3, no user prompt
      customPrompt = IDENTITY_RECREATE_MODEL_CLOTHES;
    }

    const startTime = Date.now();
    console.log(
      `\n🎨 Generating ${imageQuantity} image(s) - Cost: ${creditsNeeded} credits`,
    );
    console.log(
      `📝 Final prompt (will be used for ALL ${imageQuantity} images): ${customPrompt}`,
    );

    // ✅ FIX: Deduct credits BEFORE generation (with refund on failure)
    await deductCredits(userId, creditsNeeded);
    console.log(`💳 Deducted ${creditsNeeded} credits upfront`);

    await prisma.creditTransaction.create({
      data: {
        userId,
        amount: -creditsNeeded,
        type: "generation",
        description: `Image identity generation (${imageQuantity} image${imageQuantity > 1 ? 's' : ''})`,
      },
    });

    // Create all generation records synchronously so we can return IDs immediately
    const generationRecords = [];
    for (let i = 0; i < imageQuantity; i++) {
      const tempId = tempGenerationIds?.[i] || null;
      const gen = await prisma.generation.create({
        data: {
          userId,
          modelId,
          type: "image-identity",
          prompt: customPrompt,
          inputImageUrl: JSON.stringify({ identityImages, targetImage }),
          status: "processing",
          creditsCost: 10,
          replicateModel: "wavespeed-seedream-v4.5-edit",
        },
      });
      generationRecords.push({ gen, tempId, index: i + 1 });
    }

    // Respond immediately so the frontend can re-submit while we process
    res.json({
      success: true,
      message: `Processing ${imageQuantity} image(s) in background`,
      generation: generationRecords[0]?.gen || null,
      generations: generationRecords.map(r => ({ id: r.gen.id, tempId: r.tempId, index: r.index })),
      creditsUsed: creditsNeeded,
    });

    // Process images in background (after response is sent)
    (async () => {
      const generatedImages = [];
      const failedGenerations = [];
      let successfulCount = 0;
      const startTime = Date.now();

      // Ensure identity images and target are accessible to the provider before processing
      const [kieIdentityImages, kieTargetImage] = await Promise.all([
        Promise.all(identityImages.map((u, i) => ensureKieAccessibleUrl(u, `identity-${i+1}`))),
        ensureKieAccessibleUrl(targetImage, "target-image"),
      ]).catch(() => [identityImages, targetImage]);

      try {
        for (const { gen: generation, index } of generationRecords) {
          try {
            const queueStats = requestQueue.getStats();
            console.log(`Queue: ${queueStats.active}/${queueStats.maxConcurrent} active, ${queueStats.queued} queued`);

            const result = await requestQueue.enqueue(async () => {
              return await generateImageWithIdentityWaveSpeed(kieIdentityImages, kieTargetImage, {
                size,
                customImagePrompt: customPrompt,
                onTaskCreated: async (taskId) => {
                  await prisma.generation.update({
                    where: { id: generation.id },
                    data: { replicateModel: `wavespeed-seedream:${taskId}` },
                  });
                },
              });
            });

            if (result.success && result.deferred && result.taskId) {
              await prisma.generation.update({
                where: { id: generation.id },
                data: { replicateModel: `wavespeed-seedream:${result.taskId}` },
              });
              successfulCount++;
              console.log(`✅ Image ${index} submitted to WaveSpeed; result will arrive via callback (task ${result.taskId})`);
            } else if (result.success && result.outputUrl) {
              await prisma.generation.update({
                where: { id: generation.id },
                data: { status: "completed", outputUrl: result.outputUrl, completedAt: new Date() },
              });
              generatedImages.push({ id: generation.id, url: result.outputUrl, index });
              successfulCount++;
              console.log(`✅ Image ${index} generated: ${result.outputUrl}`);
            } else {
              await prisma.generation.update({
                where: { id: generation.id },
                data: { status: "failed", errorMessage: getErrorMessageForDb(result.error), completedAt: new Date() },
              });
              failedGenerations.push({ id: generation.id, index, error: result.error });
              console.log(`❌ Image ${index} failed: ${result.error}`);
            }
          } catch (error) {
            await prisma.generation.update({
              where: { id: generation.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb(error.message), completedAt: new Date() },
            }).catch(() => {});
            failedGenerations.push({ id: generation.id, index, error: error.message });
          }
        }
      } finally {
        // Always refund failed generations — runs even if the loop throws unexpectedly
        for (const failed of failedGenerations) {
          await refundGeneration(failed.id).catch(() => {});
        }
        const totalTimeMs = Date.now() - startTime;
        console.log(`\n🎉 Background: ${successfulCount}/${imageQuantity} images done (${Math.round(totalTimeMs / 1000)}s)`);
      }
    })().catch(err => console.error("Background image-identity error:", err.message));
  } catch (error) {
    console.error("Generate image error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * Describe a target/reference image using Grok Vision
 * Returns a scene description with the model name injected
 */
export async function describeTargetImage(req, res) {
  let creditDeducted = false;
  try {
    const pricing = await getGenerationPricing();
    const ANALYZE_CREDIT_COST = pricing.describeTargetImage;
    const { targetImageUrl, modelName, clothesMode } = req.body;
    const userId = req.user.userId;

    if (!targetImageUrl) {
      return res.status(400).json({ success: false, message: "Target image URL is required" });
    }

    try {
      const parsed = new URL(targetImageUrl);
      const hostname = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:" || hostname === "localhost" || hostname.startsWith("127.") || hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname === "0.0.0.0") {
        return res.status(400).json({ success: false, message: "Invalid image URL" });
      }
    } catch {
      return res.status(400).json({ success: false, message: "Invalid image URL" });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "Image analysis is temporarily unavailable",
      });
    }

    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    if (totalCredits < ANALYZE_CREDIT_COST) {
      return res.status(403).json({
        success: false,
        message: `Need ${ANALYZE_CREDIT_COST} 🪙. You have ${totalCredits} 🪙.`,
      });
    }
    await deductCredits(userId, ANALYZE_CREDIT_COST);
    creditDeducted = true;

    const { default: OpenAI } = await import("openai");
    const grok = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let imageContent;
    try {
      const imgResponse = await fetch(targetImageUrl, { signal: controller.signal });
      if (!imgResponse.ok) throw new Error(`Failed to fetch image (${imgResponse.status})`);
      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      if (buffer.length > 10 * 1024 * 1024) throw new Error("Image too large (max 10MB)");
      let mime = (imgResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mime)) {
        const ext = targetImageUrl.split("?")[0].toLowerCase();
        if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) mime = "image/jpeg";
        else if (ext.endsWith(".png")) mime = "image/png";
        else if (ext.endsWith(".webp")) mime = "image/webp";
      }
      imageContent = {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` },
      };
    } catch (err) {
      return res.status(400).json({ success: false, message: `Could not process image: ${err.message}` });
    } finally {
      clearTimeout(timeout);
    }

    const safeName = (modelName || "the model").trim();

    const clothesInstruction = clothesMode === "reference"
      ? "Describe the clothes/outfit in detail as they should be kept exactly."
      : "Do NOT describe any clothing or outfit — the outfit will be handled separately. Skip all mentions of clothes, lingerie, accessories, shoes, or any wearables.";

    const systemPrompt = `You are an expert at describing reference images for AI identity recreation.
Your task: analyze this image and write a detailed scene description that will be used to recreate this exact scene with a different person named "${safeName}".

RULES:
1. Start the description with: "${safeName}" followed by a natural description
2. Describe the SCENE in detail: pose, body position, camera angle, lighting, background/setting, mood
3. ${clothesInstruction}
4. Do NOT describe the person's face, hair color, eye color, skin tone, or body type — those will come from the model's own photos
5. DO describe: pose, expression type (smiling, serious, etc.), hand positions, leg positions, sitting/standing/lying
6. Explicitly include: lighting conditions (e.g. soft window light, studio key light, golden hour); how light falls on the scene and skin; hair texture and movement in frame (e.g. wind, static); and facial angle / camera angle for the pose
7. Keep it under 150 words, single paragraph, no bullet points
8. Be specific about spatial composition — where is the person in frame, what's around them
9. Output ONLY the description text, nothing else`;

    const completion = await grok.chat.completions.create({
      model: "x-ai/grok-4.1-fast",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Describe this reference image for recreating the scene with ${safeName}:` },
            imageContent,
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0.4,
    });

    const description = completion.choices[0]?.message?.content?.trim();

    if (!description) {
      return res.status(500).json({ success: false, message: "Failed to generate description" });
    }

    console.log(`🔍 Grok described target image for model "${safeName}": ${description.slice(0, 100)}...`);

    res.json({
      success: true,
      description,
      creditsUsed: ANALYZE_CREDIT_COST,
    });
  } catch (error) {
    console.error("Describe target image error:", error);
    if (creditDeducted) {
      try {
        await refundCredits(req.user.userId, ANALYZE_CREDIT_COST);
      } catch (refundError) {
        console.error("Failed to refund analyze-image credit:", refundError?.message || refundError);
      }
    }
    res.status(500).json({ success: false, message: "Failed to analyze image" });
  }
}

/**
 * Background processing for Video Motion Generation
 * Processes video generation asynchronously after returning response to client
 */
async function processVideoMotionInBackground(
  generationId,
  generatedImageUrl,
  referenceVideoUrl,
  prompt,
  userId,
  creditsNeeded,
  keepAudio = true,
  ultra = false,
  recreateEngine = RECREATE_ENGINE.KLING,
  wanResolution = "580p",
) {
  try {
    console.log(
      `\n🔄 Starting video motion generation for ${generationId}`,
    );
    console.log(`🔊 Keep audio from video: ${keepAudio}`);

    // Generate video with motion transfer
    console.log("\n📍 Generating video with motion transfer...");
    // Ensure both image and video are accessible to KIE (mirror to fresh R2 URLs)
    const kieAccessibleImageUrl = await ensureKieAccessibleUrl(generatedImageUrl, "starting image");
    const preprocessedRefVideo = await preprocessReferenceVideoForKling(referenceVideoUrl).catch(() => referenceVideoUrl);
    const kieAccessibleVideoUrl = await ensureKieAccessibleUrl(preprocessedRefVideo, "reference video");
    const videoResult = await requestQueue.enqueue(async () =>
      submitRecreateVideoTask({
        imageUrl: kieAccessibleImageUrl,
        referenceVideoUrl: kieAccessibleVideoUrl,
        recreateEngine,
        recreateUltra: ultra,
        wanResolution,
        videoPrompt: prompt || "",
        onTaskSubmitted: async (taskId) => {
          await persistKieGenerationCorrelation({
            taskId,
            generationId,
            userId,
            kind: "video-motion",
          });
        },
      })
    );

    if (videoResult.deferred) {
      // Result will arrive via KIE callback; generation already has kie-task:taskId
      console.log("\n⏳ Video motion submitted; result will arrive via callback.");
      return;
    }
    if (videoResult.success && videoResult.outputUrl) {
      // SUCCESS: Update generation record with video URL (sync path when callback not used)
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          outputUrl: videoResult.outputUrl,
          completedAt: new Date(),
        },
      });

      console.log("\n✅ ========================================");
      console.log("✅ VIDEO MOTION GENERATION COMPLETE!");
      console.log("✅ ========================================");
      console.log(`🎥 Generated Video: ${videoResult.outputUrl}\n`);
    } else {
      throw new Error(
        `Video generation failed: ${videoResult.error || "Unknown error"}`,
      );
    }
  } catch (error) {
    console.error(
      `❌ Video motion generation failed for ${generationId}:`,
      error,
    );

    // Refund credits atomically (prevents double-refunds from watchdog)
    try {
      await refundGeneration(generationId);
      console.log(`💰 Credits refunded for generation ${generationId}`);
    } catch (refundError) {
      console.error("❌ Failed to refund credits:", refundError);
    }

    // Update generation status to failed — wrapped so DB errors don't hide the refund
    try {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(error.message || "Unknown error during video motion generation"),
          completedAt: new Date(),
        },
      });
    } catch (dbErr) {
      console.error(`⚠️ Failed to update generation ${generationId} to failed status:`, dbErr.message);
    }
  }
}

/**
 * Generate video with motion transfer
 * User provides a generated image + reference video
 * Credit formula: (duration * 2) + 2 base credits
 */
export async function generateVideoWithMotion(req, res) {
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const {
      modelId,
      generatedImageUrl,
      referenceVideoUrl,
      videoDuration,
      prompt,
      tempId,
      keepAudio = true,
      ultra = false,
      ultraMode,
      recreateEngine,
      wanResolution,
    } = req.body;
    const useUltra = ultra === true || ultraMode === true;
    const recreateEngineNormalized = normalizeRecreateEngine(recreateEngine);
    const wanResolutionNormalized = normalizeWanResolution(wanResolution);
    userId = req.user.userId;

    // Validate required fields
    if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Model ID is required",
      });
    }

    if (!generatedImageUrl) {
      return res.status(400).json({
        success: false,
        message: "Generated image URL is required. First generate an image, then use it here.",
      });
    }

    if (!referenceVideoUrl) {
      return res.status(400).json({
        success: false,
        message: "Reference video URL is required",
      });
    }

    const imgCheck = validateImageUrl(generatedImageUrl);
    if (!imgCheck.valid) {
      return res.status(400).json({ success: false, message: imgCheck.message });
    }
    const vidCheck = validateVideoUrl(referenceVideoUrl);
    if (!vidCheck.valid) {
      return res.status(400).json({ success: false, message: vidCheck.message });
    }

    if (!videoDuration || videoDuration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Video duration in seconds is required",
      });
    }

    // Verify model ownership
    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
    });

    if (!model || model.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Model not found or unauthorized",
      });
    }

    // Check credits (with expiration check)
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    const pricing = await getGenerationPricing();
    const perSec = getRecreateCreditsPerSecond(pricing, {
      engine: recreateEngineNormalized,
      ultra: useUltra,
      wanResolution: wanResolutionNormalized,
    });
    const creditsNeeded = estimateRecreateCredits(pricing, {
      durationSeconds: videoDuration,
      engine: recreateEngineNormalized,
      ultra: useUltra,
      wanResolution: wanResolutionNormalized,
    });

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for ${videoDuration}s video. You have ${totalCredits} credits.`,
      });
    }

    // Deduct credits BEFORE generation
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded; // Track for emergency refund
    const tierLog =
      recreateEngineNormalized === RECREATE_ENGINE.WAN
        ? `wan-animate-move-${wanResolutionNormalized}`
        : (useUltra ? "ultra-3.0-1080p" : "classic-2.6-1080p");
    console.log(`💳 Deducted ${creditsNeeded} credits upfront (motion ${tierLog})`);

    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId,
        type: "video",
        prompt: prompt || "Motion transfer",
        inputImageUrl: generatedImageUrl,
        inputVideoUrl: referenceVideoUrl,
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: getRecreateReplicateModel({
          engine: recreateEngineNormalized,
          ultra: useUltra,
          wanResolution: wanResolutionNormalized,
        }),
        duration: videoDuration,
      },
    });
    generationId = generation.id; // Track for emergency refund

    // Add to queue to prevent overwhelming WaveSpeed API
    console.log("📋 Adding video motion to queue...");
    const queueStats = requestQueue.getStats();
    console.log(
      `Queue: ${queueStats.active}/${queueStats.maxConcurrent} active, ${queueStats.queued} queued`,
    );

    // Process in background
    processVideoMotionInBackground(
      generation.id,
      generatedImageUrl,
      referenceVideoUrl,
      prompt || "",
      userId,
      creditsNeeded,
      keepAudio,
      useUltra,
      recreateEngineNormalized,
      wanResolutionNormalized,
    ).catch((error) => {
      console.error("❌ Background processing error:", error);
    });

    // Return immediately with processing status
    res.json({
      success: true,
      message: "Video generation started! This will take 2-3 minutes.",
      generation: {
        id: generation.id,
        tempId: tempId,
        type: "video",
        status: "processing",
        duration: videoDuration,
        createdAt: generation.createdAt,
        estimatedTime: "2-3 minutes",
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: totalCredits - creditsNeeded,
      pricingMeta: { perSec },
    });
  } catch (error) {
    console.error("Generate video error:", error);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          // Generation record exists - use atomic refund
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          // No generation record - refund directly
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
        // Watchdog will clean up stuck generations on restart
      }
    }
    
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * Complete recreation pipeline
 * YOUR FULL WORKFLOW - Both steps together
 * FIXED: Now uses upfront deduction with proper refund handling
 */
export async function generateCompleteRecreation(req, res) {
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let imageGenId = null;
  let videoGenId = null;
  let userId = null;

  try {
    const {
      modelId,
      modelIdentityImages,
      videoScreenshot,
      originalVideoUrl,
      videoPrompt,
      ultra = false,
      ultraMode,
      recreateEngine,
      wanResolution,
      videoDuration = 5,
      aspectRatio,
      numFrames,
    } = req.body;
    const useUltra = ultra === true || ultraMode === true;
    const recreateEngineNormalized = normalizeRecreateEngine(recreateEngine);
    const wanResolutionNormalized = normalizeWanResolution(wanResolution);
    userId = req.user.userId;

    // Validate
    if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Model ID is required",
      });
    }

    // Verify ownership
    const modelOwnership = await prisma.savedModel.findUnique({
      where: { id: modelId },
    });

    if (!modelOwnership || modelOwnership.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Model not found or unauthorized",
      });
    }

    if (
      !modelIdentityImages ||
      !Array.isArray(modelIdentityImages) ||
      modelIdentityImages.length !== 3
    ) {
      return res.status(400).json({
        success: false,
        message: "Need exactly 3 model identity images",
      });
    }

    const invalidImages = modelIdentityImages.filter(url => !url || typeof url !== 'string' || !url.startsWith('http'));
    if (invalidImages.length > 0) {
      return res.status(400).json({
        success: false,
        message: "One or more model photos are missing or invalid. Please update your model photos and try again.",
      });
    }

    if (!videoScreenshot || !originalVideoUrl) {
      return res.status(400).json({
        success: false,
        message: "Need video screenshot and original video URL",
      });
    }

    const modelImgCheck = validateImageUrls(modelIdentityImages);
    if (!modelImgCheck.valid) {
      return res.status(400).json({ success: false, message: modelImgCheck.message });
    }
    const screenshotCheck = validateImageUrl(videoScreenshot);
    if (!screenshotCheck.valid) {
      return res.status(400).json({ success: false, message: screenshotCheck.message });
    }
    const origVideoCheck = validateVideoUrl(originalVideoUrl);
    if (!origVideoCheck.valid) {
      return res.status(400).json({ success: false, message: origVideoCheck.message });
    }

    // Check credits (image identity step + recreate video step)
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    const pricing = await getGenerationPricing();
    const imageCredits = typeof pricing.imageIdentity === "number" ? pricing.imageIdentity : 10;
    const recreateSeconds = Math.max(1, Number(videoDuration) || 5);
    const videoCredits = estimateRecreateCredits(pricing, {
      durationSeconds: recreateSeconds,
      engine: recreateEngineNormalized,
      ultra: useUltra,
      wanResolution: wanResolutionNormalized,
    });
    const creditsNeeded = imageCredits + videoCredits;

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for complete recreation. You have ${totalCredits} credits.`,
      });
    }

    // ✅ FIX: Deduct credits UPFRONT before any generation
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits upfront for complete recreation`);

    // Upload all inputs to Blob first so KIE can fetch them immediately; then submit in one shot
    console.log("\n📍 Uploading inputs to Blob for KIE...");
    const [kieModelImages, kieVideoScreenshot, kieOriginalVideoUrl] = await Promise.all([
      Promise.all(
        modelIdentityImages.map((u, i) => ensureKieAccessibleUrl(u, `model-photo-${i+1}`))
      ).catch(() => modelIdentityImages),
      ensureKieAccessibleUrl(videoScreenshot, "video-screenshot").catch(() => videoScreenshot),
      ensureKieAccessibleUrl(originalVideoUrl, "original-video").catch(() => originalVideoUrl),
    ]);

    // Create image generation record
    const imageGen = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId,
        type: "image-identity",
        prompt: "Complete pipeline - image",
        inputImageUrl: JSON.stringify({ modelIdentityImages, videoScreenshot }),
        status: "processing",
        creditsCost: imageCredits,
        replicateModel: "wavespeed-seedream-v4.5-edit",
      },
    });
    imageGenId = imageGen.id;

    console.log("📋 Adding complete recreation to queue...");
    const queueStats = requestQueue.getStats();
    console.log(
      `Queue stats: Active: ${queueStats.active}, Queued: ${queueStats.queued}`,
    );

    // Create video gen upfront so callback can find it by pipelinePayload.imageTaskId when image completes
    // Store pre-uploaded Blob URL so callback doesn't re-upload the reference video
    const pipelinePayload = {
      kind: "complete_recreation",
      imageGenId: imageGen.id,
      videoPrompt: videoPrompt || "",
      originalVideoUrl,
      originalVideoUrlKie: kieOriginalVideoUrl,
      userId,
      modelId,
      ultra: useUltra,
      recreateEngine: recreateEngineNormalized,
      wanResolution: wanResolutionNormalized,
    };
    const videoGen = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId,
        type: "video",
        prompt: videoPrompt || "Complete pipeline - video",
        inputVideoUrl: originalVideoUrl,
        status: "processing",
        creditsCost: videoCredits,
        replicateModel: getRecreateReplicateModel({
          engine: recreateEngineNormalized,
          ultra: useUltra,
          wanResolution: wanResolutionNormalized,
        }),
        pipelinePayload,
      },
    });
    videoGenId = videoGen.id;

    console.log("\n📍 STEP 1/2: Submitting image to WaveSpeed Seedream (inputs already on Blob)...");
    const imageResult = await requestQueue.enqueue(async () => {
      return await generateImageWithIdentityWaveSpeed(kieModelImages, kieVideoScreenshot, {
        aspectRatio: "9:16",
        onTaskCreated: async (taskId) => {
          await prisma.generation.update({
            where: { id: videoGen.id },
            data: { pipelinePayload: { ...pipelinePayload, imageTaskId: taskId } },
          });
        },
      });
    });

    if (imageResult.success && imageResult.deferred) {
      res.json({
        success: true,
        message: "Image and video are generating; results will appear when ready.",
        generations: {
          image: { id: imageGen.id, status: "processing" },
          video: { id: videoGen.id, status: "processing" },
        },
        creditsUsed: creditsNeeded,
        creditsRemaining: totalCredits - creditsNeeded,
      });
      return;
    }

    if (imageResult.success && imageResult.outputUrl) {
      await prisma.generation.update({
        where: { id: imageGen.id },
        data: {
          status: "completed",
          outputUrl: imageResult.outputUrl,
          completedAt: new Date(),
        },
      });
      console.log(`✅ Image generated: ${imageResult.outputUrl}`);

      console.log("\n📍 STEP 2/2: Generating video with motion (kie.ai Kling 2.6)...");
      const videoForPreprocess = kieOriginalVideoUrl || originalVideoUrl;
      const preprocessedOrigVideo = await preprocessReferenceVideoForKling(videoForPreprocess).catch(() => videoForPreprocess);
      const kieVideoUrl2 = await ensureKieAccessibleUrl(preprocessedOrigVideo, "reference video");
      const kieImageUrl2 = await ensureKieAccessibleUrl(imageResult.outputUrl, "generated image");
      const videoResult = await requestQueue.enqueue(async () =>
        submitRecreateVideoTask({
          imageUrl: kieImageUrl2,
          referenceVideoUrl: kieVideoUrl2,
          recreateEngine: recreateEngineNormalized,
          recreateUltra: useUltra,
          wanResolution: wanResolutionNormalized,
          videoPrompt: videoPrompt || "",
          onTaskSubmitted: async (taskId) => {
            await persistKieGenerationCorrelation({
              taskId,
              generationId: videoGen.id,
              userId,
              kind: "video-motion",
              extraGenerationData: { pipelinePayload: null },
            });
          },
        })
      );

      if (videoResult.success && videoResult.deferred) {
        if (videoResult.taskId) {
          await persistKieGenerationCorrelation({
            taskId: videoResult.taskId,
            generationId: videoGen.id,
            userId,
            kind: "video-motion",
            extraGenerationData: { pipelinePayload: null },
          });
        }
        res.json({
          success: true,
          message: "Image ready; video is generating and will appear when ready.",
          generations: {
            image: { id: imageGen.id, url: imageResult.outputUrl },
            video: { id: videoGen.id, status: "processing" },
          },
          creditsUsed: creditsNeeded,
          creditsRemaining: totalCredits - creditsNeeded,
        });
        return;
      }
      if (videoResult.success && videoResult.outputUrl) {
        await prisma.generation.update({
          where: { id: videoGen.id },
          data: {
            inputImageUrl: imageResult.outputUrl,
            outputUrl: videoResult.outputUrl,
            status: "completed",
            completedAt: new Date(),
            pipelinePayload: null,
          },
        });

        res.json({
          success: true,
          message:
            "Complete recreation successful! Your model is now in the video.",
          generations: {
            image: {
              id: imageGen.id,
              url: imageResult.outputUrl,
            },
            video: {
              id: videoGen.id,
              url: videoResult.outputUrl,
            },
          },
          creditsUsed: creditsNeeded,
          creditsRemaining: totalCredits - creditsNeeded,
        });
      } else {
        throw new Error(`Video generation failed: ${videoResult?.error || "Unknown error"}`);
      }
    } else {
      await prisma.generation.update({
        where: { id: imageGen.id },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(imageResult.error),
        },
      });
      await prisma.generation.update({
        where: { id: videoGen.id },
        data: { status: "failed", errorMessage: getErrorMessageForDb(imageResult.error || "Image step failed"), pipelinePayload: null },
      });

      const refundedFromRecord = await refundGeneration(imageGen.id);
      const remainingToRefund = creditsNeeded - refundedFromRecord;
      if (remainingToRefund > 0) {
        await refundCredits(userId, remainingToRefund);
      }
      console.log(`💰 Refunded ${creditsNeeded} credits total for failed pipeline (${refundedFromRecord} from record + ${remainingToRefund} direct)`);

      res.status(500).json({
        success: false,
        message: "Pipeline failed",
        error: imageResult.error,
      });
    }
  } catch (error) {
    console.error("Complete recreation error:", error);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (imageGenId) {
          // Refund via generation record first
          const refundedFromRecord = await refundGeneration(imageGenId);
          // Refund remaining credits not covered by the record
          const remainingToRefund = creditsDeducted - refundedFromRecord;
          if (remainingToRefund > 0) {
            await refundCredits(userId, remainingToRefund);
          }
          console.log(`🔄 Emergency refund: ${creditsDeducted} credits (${refundedFromRecord} from record + ${remainingToRefund} direct)`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * Get single generation by ID
 */
export async function getGenerationById(req, res) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const generation = await prisma.generation.findFirst({
      where: { id, userId },
      select: {
        id: true,
        modelId: true,
        type: true,
        prompt: true,
        duration: true,
        outputUrl: true,
        inputImageUrl: true,
        status: true,
        createdAt: true,
        completedAt: true,
        errorMessage: true,
        isTrial: true,
      },
    });

    if (!generation) {
      return res.status(404).json({ success: false, message: "Generation not found" });
    }

    let resolvedGeneration = generation;
    try {
      resolvedGeneration = await ensureGenerationOutputPersisted(generation);
    } catch (healError) {
      console.warn(`⚠️ Failed to self-heal generation ${generation.id} output URL:`, healError.message);
    }

    res.json({ success: true, generation: resolvedGeneration });
  } catch (error) {
    console.error("Get generation by ID error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * Get generation history
 */
export async function getGenerations(req, res) {
  try {
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const { type, modelId, status, limit = 50, offset = 0, includeTotal = "true" } = req.query;

    const where = { userId };
    if (type) {
      if (type === "video") {
        where.type = { in: ["video", "prompt-video", "face-swap", "nsfw-video", "nsfw-video-extend", "recreate-video", "talking-head", "creator-studio-video"] };
      } else if (type === "image") {
        where.type = { in: ["image", "image-identity", "prompt-image", "face-swap-image"] };
      } else {
        where.type = type;
      }
    }
    if (status) {
      if (status.includes(',')) {
        where.status = { in: status.split(',') };
      } else {
        where.status = status;
      }
    }
    if (modelId) {
      where.modelId = modelId;
    }

    const generations = await prisma.generation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: parseInt(limit),
      skip: parseInt(offset),
      select: {
        id: true,
        modelId: true,
        type: true,
        prompt: true,
        duration: true,
        outputUrl: true,
        inputImageUrl: true,
        provider: true,
        providerTaskId: true,
        providerFamily: true,
        providerMode: true,
        providerType: true,
        parentTaskId: true,
        extendEligible: true,
        originalGenerationId: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const HEAL_BATCH_SIZE = 5;
    const healedGenerations = [];
    for (let i = 0; i < generations.length; i += HEAL_BATCH_SIZE) {
      const batch = generations.slice(i, i + HEAL_BATCH_SIZE);
      const healed = await Promise.all(
        batch.map(async (generation) => {
          try {
            return await ensureGenerationOutputPersisted(generation);
          } catch (healError) {
            console.warn(`⚠️ Failed to self-heal generation ${generation.id} output URL:`, healError.message);
            return generation;
          }
        })
      );
      healedGenerations.push(...healed);
    }

    const shouldIncludeTotal = includeTotal !== "false";
    const total = shouldIncludeTotal
      ? await prisma.generation.count({ where })
      : undefined;

    res.json({
      success: true,
      generations: healedGenerations,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) },
      retention: {
        maxCompletedPerModel: getMaxCompletedGenerationsPerModel(),
      },
    });
  } catch (error) {
    console.error("Get generations error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * GET /api/generations/monthly-stats
 * Returns image and video generation counts for the current calendar month.
 */
export async function getMonthlyStats(req, res) {
  try {
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [imageCount, videoCount] = await Promise.all([
      prisma.generation.count({
        where: {
          userId,
          status: "completed",
          createdAt: { gte: firstOfMonth },
          type: { in: ["image", "image-identity", "prompt-image", "face-swap-image"] },
        },
      }),
      prisma.generation.count({
        where: {
          userId,
          status: "completed",
          createdAt: { gte: firstOfMonth },
          type: { in: ["video", "prompt-video", "face-swap", "recreate-video", "talking-head", "nsfw-video", "nsfw-video-extend", "creator-studio-video"] },
        },
      }),
    ]);

    res.json({ success: true, images: imageCount, videos: videoCount });
  } catch (error) {
    console.error("Get monthly stats error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * Auto-cleanup: cap completed generations per model per user (storage control).
 * Oldest completed rows are deleted when over the cap. Runs after each successful completion
 * (KIE callback, WaveSpeed callback, generation poller).
 *
 * IMPORTANT: cleanup is opt-in. When it runs, we remove oldest DB rows only for R2 file cleanup.
 * Vercel Blob user assets (generations/, user-uploads/) are never deleted by this job — no TTL, no cap-based Blob deletes.
 *
 * Env:
 *   - ENABLE_GENERATION_AUTO_CLEANUP=true|1|yes|on → enable cleanup logic
 *   - MAX_COMPLETED_GENERATIONS_PER_MODEL
 *       - unset while enabled → 200
 *       - 0 or negative → disabled (no automatic deletion)
 *       - positive integer → max completed rows kept per (userId, modelId)
 */
const MAX_GENERATIONS_PER_MODEL_CAP = 500_000;

export function getMaxCompletedGenerationsPerModel() {
  const enabled = String(process.env.ENABLE_GENERATION_AUTO_CLEANUP || "")
    .trim()
    .toLowerCase();
  const isEnabled = ["1", "true", "yes", "on"].includes(enabled);
  if (!isEnabled) return null;

  const raw = process.env.MAX_COMPLETED_GENERATIONS_PER_MODEL;
  if (raw === undefined || String(raw).trim() === "") return 200;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return 200;
  if (n <= 0) return null; // unlimited — skip auto-delete
  return Math.min(Math.max(n, 1), MAX_GENERATIONS_PER_MODEL_CAP);
}

async function deleteR2GenerationAssetMaybe(u) {
  if (!u || typeof u !== "string") return;
  const r2pub = process.env.R2_PUBLIC_URL || "";
  if (!u.includes("r2.dev") && !(r2pub && u.includes(r2pub))) return;
  try {
    const { deleteFromR2 } = await import("../utils/r2.js");
    await deleteFromR2(u);
  } catch (_) { /* best-effort */ }
}

/** Auto-cleanup: free R2 only. Blob URLs stay reachable (orphan rows removed from DB only for cap). */
async function deleteGenerationOutputAssetsAutoCleanup(outputUrl) {
  if (!outputUrl) return;
  const t = String(outputUrl).trim();
  try {
    if (t.startsWith("[")) {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        for (const u of arr) await deleteR2GenerationAssetMaybe(u);
        return;
      }
    }
  } catch (_) { /* single URL */ }
  await deleteR2GenerationAssetMaybe(t);
}

/** User deleted history: remove R2 + Blob for our URLs. */
async function deleteGenerationOutputAssetsUserDelete(outputUrl) {
  await deleteStoredMediaFromOutputField(outputUrl);
}

export async function cleanupOldGenerations(userId, modelId) {
  try {
    if (!userId || !modelId) return;

    const maxKeep = getMaxCompletedGenerationsPerModel();
    if (maxKeep == null) return;

    const completedCount = await prisma.generation.count({
      where: { userId, modelId, status: "completed" },
    });

    if (completedCount <= maxKeep) return;

    const toDelete = completedCount - maxKeep;

    const oldestGenerations = await prisma.generation.findMany({
      where: { userId, modelId, status: "completed" },
      orderBy: { createdAt: "asc" },
      take: toDelete,
      select: { id: true, outputUrl: true },
    });

    if (oldestGenerations.length > 0) {
      for (const gen of oldestGenerations) {
        await deleteGenerationOutputAssetsAutoCleanup(gen.outputUrl);
      }
      const ids = oldestGenerations.map((g) => g.id);
      await prisma.generation.deleteMany({
        where: { id: { in: ids } },
      });
      console.log(
        `🧹 Auto-cleanup: Removed ${ids.length} old generation row(s) for model ${modelId} (kept ${maxKeep}); Vercel Blob files untouched`,
      );
    }
  } catch (error) {
    console.error("🧹 Auto-cleanup error:", error.message);
  }
}

/** Schedule history-cap cleanup after a generation completes (non-blocking); logs failures. */
export function enqueueCleanupOldGenerations(userId, modelId) {
  if (!userId || !modelId) return;
  cleanupOldGenerations(userId, modelId).catch((err) => {
    console.warn(
      "[enqueueCleanupOldGenerations]",
      `userId=${userId} modelId=${modelId}:`,
      err?.message || err,
    );
  });
}

async function cleanupAllModelsForUser(userId) {
  try {
    if (!userId) return;
    const models = await prisma.savedModel.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const model of models) {
      await cleanupOldGenerations(userId, model.id);
    }
  } catch (error) {
    console.error("🧹 Cleanup all models error:", error.message);
  }
}

/**
 * Batch delete generations
 */
export async function batchDeleteGenerations(req, res) {
  try {
    const { generationIds } = req.body;
    const userId = req.user.userId;

    if (
      !generationIds ||
      !Array.isArray(generationIds) ||
      generationIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Need an array of generation IDs",
      });
    }

    // Block deletion of any generation that is still in-flight
    const activeGens = await prisma.generation.findMany({
      where: {
        id: { in: generationIds },
        userId,
        status: { in: ["pending", "processing"] },
      },
      select: { id: true },
    });

    if (activeGens.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete ${activeGens.length} generation(s) that are still processing. Wait for them to finish or fail first.`,
        activeIds: activeGens.map((g) => g.id),
      });
    }

    const owned = await prisma.generation.findMany({
      where: { id: { in: generationIds }, userId },
      select: { id: true, outputUrl: true },
    });
    for (const g of owned) {
      await deleteGenerationOutputAssetsUserDelete(g.outputUrl);
    }

    const result = await prisma.generation.deleteMany({
      where: {
        id: { in: generationIds },
        userId: userId,
      },
    });

    console.log(
      `🗑️  Batch deleted ${result.count} generation(s) for user ${userId}`,
    );

    res.json({
      success: true,
      message: `Deleted ${result.count} generation(s)`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error("❌ Batch delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete generations",
      error: error.message,
    });
  }
}

/**
 * NEW PIPELINE - Step 0: Extract high-quality frames from video
 * Extract 10 frames at different timestamps for user to choose from
 * Cost: FREE (no generation yet)
 */
export async function extractVideoFrames(req, res) {
  try {
    const { referenceVideoUrl } = req.body;
    const userId = req.user.userId;

    if (!referenceVideoUrl) {
      return res.status(400).json({
        success: false,
        message: "Need reference video URL",
      });
    }

    console.log("\n🎬 ============================================");
    console.log("🎬 EXTRACTING VIDEO FRAMES");
    console.log("🎬 ============================================");
    console.log(`🎥 Reference video: ${referenceVideoUrl}`);

    // Extract 10 high-quality frames using FFmpeg for better mobile selection
    const result = await extractFramesFromVideo(referenceVideoUrl, {
      numFrames: 10,
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to extract frames from video",
        error: result.error,
      });
    }

    console.log("\n🎉 Frame extraction complete!");
    console.log(`📸 Extracted ${result.frames.length} frames`);
    console.log("👤 User can now pick the best frame!\n");

    res.json({
      success: true,
      message: "Frames extracted successfully! Pick the best one to continue.",
      frames: result.frames,
      videoDuration: result.videoDuration,
    });
  } catch (error) {
    console.error("❌ Extract frames error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
}

/**
 * NEW PIPELINE - Step 1: Prepare video generation
 * User picked best frame, now generate 3 variations for user to choose
 * Cost: 30 credits (3 variations × 10 credits each)
 * FIXED: Now uses upfront deduction with proper refund handling
 */
export async function prepareVideoGeneration(req, res) {
  // Track credit state for emergency refund
  let creditsDeducted = 0;
  let userId = null;
  const generationIds = []; // Track created generation records

  try {
    const { modelId, modelImages, selectedFrameUrl } = req.body;
    userId = req.user.userId;

    // Validate
    if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Model ID is required",
      });
    }

    // Verify ownership
    const modelOwnership = await prisma.savedModel.findUnique({
      where: { id: modelId },
    });

    if (!modelOwnership || modelOwnership.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Model not found or unauthorized",
      });
    }

    if (
      !modelImages ||
      !Array.isArray(modelImages) ||
      modelImages.length !== 3
    ) {
      return res.status(400).json({
        success: false,
        message: "Need exactly 3 model images",
      });
    }

    if (!selectedFrameUrl) {
      return res.status(400).json({
        success: false,
        message: "Need selected frame URL (from frame extraction step)",
      });
    }

    const modelImgsCheck = validateImageUrls(modelImages);
    if (!modelImgsCheck.valid) {
      return res.status(400).json({ success: false, message: modelImgsCheck.message });
    }
    const frameCheck = validateImageUrl(selectedFrameUrl);
    if (!frameCheck.valid) {
      return res.status(400).json({ success: false, message: frameCheck.message });
    }

    // Check credits (need 30 credits for 3 variations @ 10 credits each)
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    const creditsNeeded = 30; // 3 variations × 10 credits

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for video preparation (3 variations). You have ${totalCredits} credits.`,
      });
    }

    // ✅ FIX: Deduct credits UPFRONT before any generation
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits upfront for video preparation`);

    console.log("\n🎬 ============================================");
    console.log("🎬 VIDEO PREPARATION PIPELINE");
    console.log("🎬 ============================================");
    console.log(`📸 Model images: ${modelImages.length}`);
    console.log(`🖼️  Selected frame: ${selectedFrameUrl}`);

    // Generate 3 variations from the selected frame
    console.log("\n🎨 Generating 3 variations with your model...");
    const variations = await generateVariations(
      generateImage,
      modelImages,
      selectedFrameUrl,
      3,
      { size: "2K" },
    );

    if (variations.length === 0) {
      // Refund all credits since nothing was generated
      await refundCredits(userId, creditsNeeded);
      console.log(`💰 Refunded ${creditsNeeded} credits - no variations generated`);
      
      return res.status(500).json({
        success: false,
        message: "Failed to generate any variations",
      });
    }

    // Save variations to database
    const variationRecords = [];
    for (const variation of variations) {
      const gen = await prisma.generation.create({
        data: {
          userId,
          modelId: modelId,
          type: "image",
          prompt: `Video prep variation ${variation.id}`,
          inputImageUrl: JSON.stringify({ modelImages, selectedFrameUrl }),
          outputUrl: variation.imageUrl,
          status: "completed",
          creditsCost: 10,
          replicateModel: "wavespeed-seedream-v4.5-edit",
          completedAt: new Date(),
        },
      });
      generationIds.push(gen.id);

      variationRecords.push({
        id: gen.id,
        variationNumber: variation.id,
        imageUrl: variation.imageUrl,
      });
    }

    const creditsUsed = variations.length * 1;
    const creditsToRefund = creditsNeeded - creditsUsed;
    if (creditsToRefund > 0) {
      await refundCredits(userId, creditsToRefund);
      console.log(`💰 Refunded ${creditsToRefund} credits for unused variations`);
    }

    console.log("\n🎉 ============================================");
    console.log("🎉 VIDEO PREPARATION COMPLETE!");
    console.log("🎉 ============================================");
    console.log(`📸 Selected frame: ${selectedFrameUrl}`);
    console.log(`🎨 Generated ${variations.length} variations`);
    console.log(`💳 Credits used: ${creditsUsed}`);
    console.log("👤 User can now pick the best one!\n");

    res.json({
      success: true,
      message: "Video preparation complete! Pick your favorite variation.",
      selectedFrame: selectedFrameUrl,
      variations: variationRecords,
      creditsUsed,
      creditsRemaining: totalCredits - creditsUsed,
    });
  } catch (error) {
    console.error("❌ Prepare video error:", error);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationIds.length > 0) {
          // Refund via generation records
          let totalRefunded = 0;
          for (const genId of generationIds) {
            const refunded = await refundGeneration(genId);
            totalRefunded += refunded;
          }
          // Refund remaining (for variations that weren't created)
          const remainingToRefund = creditsDeducted - totalRefunded;
          if (remainingToRefund > 0) {
            await refundCredits(userId, remainingToRefund);
          }
          console.log(`🔄 Emergency refund: ${creditsDeducted} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
}

/**
 * NEW PIPELINE - Step 2: Complete video generation
 * User has picked a variation, now generate video
 * FIXED: Now uses upfront deduction with proper refund handling
 */
export async function completeVideoGeneration(req, res) {
  // Track credit state for emergency refund
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const {
      modelId,
      selectedImageUrl,
      referenceVideoUrl,
      prompt,
      ultra = false,
      ultraMode,
      recreateEngine,
      wanResolution,
      videoDuration = 5,
    } = req.body;
    const useUltra = ultra === true || ultraMode === true;
    const recreateEngineNormalized = normalizeRecreateEngine(recreateEngine);
    const wanResolutionNormalized = normalizeWanResolution(wanResolution);
    userId = req.user.userId;

    if (!selectedImageUrl || !referenceVideoUrl) {
      return res.status(400).json({
        success: false,
        message: "Need selected image URL and reference video URL",
      });
    }

    const selImgCheck = validateImageUrl(selectedImageUrl);
    if (!selImgCheck.valid) {
      return res.status(400).json({ success: false, message: selImgCheck.message });
    }
    const refVidCheck = validateVideoUrl(referenceVideoUrl);
    if (!refVidCheck.valid) {
      return res.status(400).json({ success: false, message: refVidCheck.message });
    }

    // Check user credits
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    const pricing = await getGenerationPricing();
    const creditsNeeded = estimateRecreateCredits(pricing, {
      durationSeconds: videoDuration,
      engine: recreateEngineNormalized,
      ultra: useUltra,
      wanResolution: wanResolutionNormalized,
    });

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for video generation. You have ${totalCredits} credits.`,
      });
    }

    // ✅ FIX: Deduct credits UPFRONT before any generation
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits upfront for video completion`);

    console.log("🎬 Generating final video...");
    console.log(`📸 Selected image: ${selectedImageUrl}`);
    console.log(`🎥 Reference video: ${referenceVideoUrl}`);
    if (prompt) {
      console.log(`💡 Custom prompt: ${prompt}`);
    }

    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId || null,
        type: "video",
        prompt: prompt || "Video generation from selected variation",
        inputImageUrl: selectedImageUrl,
        inputVideoUrl: referenceVideoUrl,
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: getRecreateReplicateModel({
          engine: recreateEngineNormalized,
          ultra: useUltra,
          wanResolution: wanResolutionNormalized,
        }),
      },
    });
    generationId = generation.id;

    // Add to queue
    console.log("📋 Adding video completion to queue...");
    const queueStats = requestQueue.getStats();
    console.log(
      `Queue: ${queueStats.active}/${queueStats.maxConcurrent} active, ${queueStats.queued} queued`,
    );

    const preprocessedRefVideo3 = await preprocessReferenceVideoForKling(referenceVideoUrl).catch(() => referenceVideoUrl);
    const kieVideoUrl3 = await ensureKieAccessibleUrl(preprocessedRefVideo3, "reference video");
    const kieImageUrl3 = await ensureKieAccessibleUrl(selectedImageUrl, "selected image");
    const result = await requestQueue.enqueue(async () =>
      submitRecreateVideoTask({
        imageUrl: kieImageUrl3,
        referenceVideoUrl: kieVideoUrl3,
        recreateEngine: recreateEngineNormalized,
        recreateUltra: useUltra,
        wanResolution: wanResolutionNormalized,
        videoPrompt: prompt || "",
        onTaskSubmitted: async (taskId) => {
          await persistKieGenerationCorrelation({
            taskId,
            generationId: generation.id,
            userId,
            kind: "video-motion",
          });
        },
      })
    );

    if (result.success && result.deferred) {
      if (result.taskId) {
        await persistKieGenerationCorrelation({
          taskId: result.taskId,
          generationId: generation.id,
          userId,
          kind: "video-motion",
        });
      }
      res.json({
        success: true,
        message: "Video is generating and will appear when ready.",
        generation: { id: generation.id, type: "video", status: "processing" },
        creditsUsed: creditsNeeded,
        creditsRemaining: totalCredits - creditsNeeded,
      });
      return;
    }
    if (result.success && result.outputUrl) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: "completed",
          outputUrl: result.outputUrl,
          completedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: "Video generated successfully!",
        generation: {
          id: generation.id,
          videoUrl: result.outputUrl,
          type: "video",
          status: "completed",
        },
        creditsUsed: creditsNeeded,
        creditsRemaining: totalCredits - creditsNeeded,
      });
    } else {
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(result.error),
        },
      });

      // Refund via atomic refundGeneration
      const refunded = await refundGeneration(generation.id);
      console.log(`💰 Refunded ${refunded} credits for failed video generation`);

      res.status(500).json({
        success: false,
        message: "Video generation failed",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Complete video error:", error);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

/**
 * SIMPLIFIED VIDEO GENERATION - One-step TikTok/Reel format
 * Takes model + video, generates directly in 720p 9:16 format
 * No frame extraction, no variations - just direct generation
 * Pricing: 20 credits flat
 */
/**
 * Background processing for Quick Video Generation
 * Implements the correct 2-step workflow:
 * 1. Extract frame from video
 * 2. Generate image with model's identity
 * 3. Generate video with that image
 * 4. Use generated image as thumbnail
 */
async function processQuickVideoInBackground(
  generationId,
  model,
  referenceVideoUrl,
  userId,
  creditsNeeded,
  ultra = false,
  recreateEngine = RECREATE_ENGINE.KLING,
  wanResolution = "580p",
) {
  try {
    const tierLabel =
      normalizeRecreateEngine(recreateEngine) === RECREATE_ENGINE.WAN
        ? `wan-animate-move-${normalizeWanResolution(wanResolution)}`
        : (ultra ? "motion-pro-plus" : "motion-classic");
    console.log(
      `\n🔄 Starting background processing for generation ${generationId} [${tierLabel}]`,
    );

    // STEP 1: Extract first frame from reference video
    console.log("\n📍 STEP 1/3: Extracting frame from reference video...");
    const frameResult = await extractFrameFromVideo(referenceVideoUrl, 1);

    if (!frameResult.success || !frameResult.frameUrl) {
      throw new Error(
        `Frame extraction failed: ${frameResult.error || "Unknown error"}`,
      );
    }

    console.log(`✅ Frame extracted: ${frameResult.frameUrl}`);

    // STEP 2: Upload all inputs to Blob so KIE can fetch immediately; then submit image
    console.log("\n📍 Uploading inputs to Blob for KIE...");
    const identityImages = [model.photo1Url, model.photo2Url, model.photo3Url];

    const missingPhotos = identityImages.filter(url => !url || !url.startsWith('http'));
    if (missingPhotos.length > 0) {
      throw new Error(`Model is missing ${missingPhotos.length} photo(s). Please update the model photos before generating a video.`);
    }

    const [kieIdentityImgs, kieFrameUrl, kieReferenceVideoUrl] = await Promise.all([
      Promise.all(
        identityImages.map((u, i) => ensureKieAccessibleUrl(u, `model-photo-${i+1}`))
      ).catch(() => identityImages),
      ensureKieAccessibleUrl(frameResult.frameUrl, "frame").catch(() => frameResult.frameUrl),
      (async () => {
        const preprocessed = await preprocessReferenceVideoForKling(referenceVideoUrl).catch(() => referenceVideoUrl);
        return ensureKieAccessibleUrl(preprocessed, "reference video");
      })(),
    ]);

    console.log("\n📍 STEP 2/3: Submitting image to WaveSpeed (inputs already on Blob)...");
    const imageResult = await requestQueue.enqueue(async () => {
      return await generateImageWithIdentityWaveSpeed(kieIdentityImgs, kieFrameUrl, {
        aspectRatio: "9:16",
        customImagePrompt: IDENTITY_RECREATE_MODEL_CLOTHES,
        onTaskCreated: async (taskId) => {
          await prisma.generation.update({
            where: { id: generationId },
            data: {
              pipelinePayload: {
                kind: "quick_video",
                imageTaskId: taskId,
                referenceVideoUrl,
                referenceVideoUrlKie: kieReferenceVideoUrl,
                modelId: model.id,
                userId,
                creditsNeeded,
                ultra,
                recreateEngine: normalizeRecreateEngine(recreateEngine),
                wanResolution: normalizeWanResolution(wanResolution),
              },
            },
          });
        },
      });
    });

    if (imageResult.success && imageResult.deferred) {
      console.log("\n✅ Image task submitted [%s]; video will be sent to KIE when WaveSpeed callback fires", tierLabel);
      return;
    }

    if (!imageResult.success || !imageResult.outputUrl) {
      throw new Error(
        `Image generation failed: ${imageResult.error || "Unknown error"}`,
      );
    }

    console.log(`✅ Image generated: ${imageResult.outputUrl}`);

    // STEP 3: Generate video using the generated image + reference video (sync path when no callback)
    console.log("\n📍 STEP 3/3: Generating final video...");
    const kieVideoUrl4 = kieReferenceVideoUrl || await ensureKieAccessibleUrl(
      (await preprocessReferenceVideoForKling(referenceVideoUrl).catch(() => referenceVideoUrl)),
      "reference video"
    );
    const kieImageUrl4 = await ensureKieAccessibleUrl(imageResult.outputUrl, "generated image");
    const videoResult = await requestQueue.enqueue(async () =>
      submitRecreateVideoTask({
        imageUrl: kieImageUrl4,
        referenceVideoUrl: kieVideoUrl4,
        recreateEngine,
        recreateUltra: ultra,
        wanResolution,
        onTaskSubmitted: async (taskId) => {
          await persistKieGenerationCorrelation({
            taskId,
            generationId,
            userId,
            kind: "video-motion",
          });
        },
      })
    );

    if (videoResult.success && videoResult.deferred) {
      if (videoResult.taskId) {
        await persistKieGenerationCorrelation({
          taskId: videoResult.taskId,
          generationId,
          userId,
          kind: "video-motion",
        });
      }
      console.log("\n✅ Video task submitted; result will arrive via callback (task " + videoResult.taskId + ")");
      return;
    }
    if (videoResult.success && videoResult.outputUrl) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          outputUrl: videoResult.outputUrl,
          inputImageUrl: imageResult.outputUrl,
          completedAt: new Date(),
        },
      });

      console.log("\n✅ QUICK VIDEO GENERATION COMPLETE!");
      console.log(`🖼️  Generated Image (thumbnail): ${imageResult.outputUrl}`);
      console.log(`🎥 Generated Video: ${videoResult.outputUrl}\n`);
    } else {
      throw new Error(
        `Video generation failed: ${videoResult?.error || "Unknown error"}`,
      );
    }
  } catch (error) {
    console.error(
      `❌ Quick video generation failed for ${generationId}:`,
      error,
    );

    // Refund credits atomically (prevents double-refunds from watchdog)
    try {
      await refundGeneration(generationId);
      console.log(`💰 Credits refunded for generation ${generationId}`);
    } catch (refundError) {
      console.error("❌ Failed to refund credits:", refundError);
    }

    // Update generation status to failed
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(error.message || "Unknown error during quick video generation"),
      },
    });
  }
}

/**
 * SIMPLIFIED VIDEO GENERATION - Quick Video Generation (2-step automatic)
 */
export async function generateVideoDirectly(req, res) {
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const {
      modelId,
      referenceVideoUrl,
      videoDuration,
      tempId,
      ultra = false,
      ultraMode,
      selectedImageUrl,
      recreateEngine,
      wanResolution,
    } = req.body; // selectedImageUrl = user's first frame (identity already applied) → skip identity step
    userId = req.user.userId;
    const useUltraDirect = ultra === true || ultraMode === true;
    const recreateEngineNormalized = normalizeRecreateEngine(recreateEngine);
    const wanResolutionNormalized = normalizeWanResolution(wanResolution);

    // Validate inputs
    if (!referenceVideoUrl) {
      return res.status(400).json({
        success: false,
        message: "Reference video URL is required",
      });
    }

    const directVidCheck = validateVideoUrl(referenceVideoUrl);
    if (!directVidCheck.valid) {
      return res.status(400).json({ success: false, message: directVidCheck.message });
    }

    if (!videoDuration || videoDuration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Video duration in seconds is required",
      });
    }

    // When user provides first-frame image (already identity-changed), go straight to KIE — no identity step
    const hasFirstFrameImage = selectedImageUrl && typeof selectedImageUrl === "string" && selectedImageUrl.startsWith("http");
    if (hasFirstFrameImage) {
      const imgCheck = validateImageUrl(selectedImageUrl);
      if (!imgCheck.valid) {
        return res.status(400).json({ success: false, message: imgCheck.message });
      }
    } else if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Model ID or first-frame image (selectedImageUrl) is required",
      });
    }

    // Credits check
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    const pricing = await getGenerationPricing();
    const creditsNeeded = estimateRecreateCredits(pricing, {
      durationSeconds: videoDuration,
      engine: recreateEngineNormalized,
      ultra: useUltraDirect,
      wanResolution: wanResolutionNormalized,
    });

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for ${videoDuration}s video. You have ${totalCredits} credits.`,
      });
    }

    if (hasFirstFrameImage) {
      // Direct path: first-frame image + reference video → KIE (no identity step, no frame extract)
      console.log("\n🎬 VIDEO RECREATE (direct): first-frame image + video → KIE");
      await deductCredits(userId, creditsNeeded);
      creditsDeducted = creditsNeeded;

      const generation = await prisma.generation.create({
        data: {
          userId,
          modelId: modelId || null,
          type: "video",
          prompt: "Video recreate (direct)",
          inputImageUrl: selectedImageUrl,
          inputVideoUrl: referenceVideoUrl,
          status: "processing",
          creditsCost: creditsNeeded,
          replicateModel: getRecreateReplicateModel({
            engine: recreateEngineNormalized,
            ultra: useUltraDirect,
            wanResolution: wanResolutionNormalized,
          }),
          duration: videoDuration,
        },
      });
      generationId = generation.id;

      const [kieImageUrl, kieVideoUrl] = await Promise.all([
        ensureKieAccessibleUrl(selectedImageUrl, "first-frame image"),
        (async () => {
          const preprocessed = await preprocessReferenceVideoForKling(referenceVideoUrl).catch(() => referenceVideoUrl);
          return ensureKieAccessibleUrl(preprocessed, "reference video");
        })(),
      ]).catch((err) => {
        console.error("[Video direct] Blob upload failed:", err?.message);
        throw err;
      });

      const result = await requestQueue.enqueue(async () =>
        submitRecreateVideoTask({
          imageUrl: kieImageUrl,
          referenceVideoUrl: kieVideoUrl,
          recreateEngine: recreateEngineNormalized,
          recreateUltra: useUltraDirect,
          wanResolution: wanResolutionNormalized,
          onTaskSubmitted: async (taskId) => {
            await persistKieGenerationCorrelation({
              taskId,
              generationId: generation.id,
              userId,
              kind: "video-motion",
            });
          },
        })
      );

      if (result?.success && result?.deferred) {
        if (result.taskId) {
          await persistKieGenerationCorrelation({
            taskId: result.taskId,
            generationId: generation.id,
            userId,
            kind: "video-motion",
          });
        }
        return res.json({
          success: true,
          message: "Video is generating and will appear when ready.",
          generation: { id: generation.id, type: "video", status: "processing", tempId, createdAt: generation.createdAt },
          creditsUsed: creditsNeeded,
          creditsRemaining: totalCredits - creditsNeeded,
        });
      }
      if (result?.success && result?.outputUrl) {
        await prisma.generation.update({
          where: { id: generation.id },
          data: { status: "completed", outputUrl: result.outputUrl, completedAt: new Date() },
        });
        return res.json({
          success: true,
          message: "Video generated.",
          generation: { id: generation.id, type: "video", status: "completed", outputUrl: result.outputUrl, tempId },
          creditsUsed: creditsNeeded,
          creditsRemaining: totalCredits - creditsNeeded,
        });
      }
      const errMsg = result?.error || "Video submission failed";
      await prisma.generation.update({
        where: { id: generation.id },
        data: { status: "failed", errorMessage: getErrorMessageForDb(errMsg), completedAt: new Date() },
      }).catch(() => {});
      await refundGeneration(generation.id).catch(() => {});
      creditsDeducted = 0;
      return res.status(500).json({ success: false, message: errMsg });
    }

    // Legacy path: model + video → extract frame → identity recreate → callback → KIE
    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId },
    });
    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found or you do not own this model",
      });
    }

    console.log("\n🎬 QUICK VIDEO (2-step): model + video → identity on frame → KIE");
    console.log(`📸 Model: ${model.name}`);
    console.log(`🎥 Video: ${referenceVideoUrl}`);
    console.log(`💰 Credits: ${creditsNeeded}`);

    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId,
        type: "video",
        prompt: "Quick video generation",
        inputImageUrl: JSON.stringify([
          model.photo1Url,
          model.photo2Url,
          model.photo3Url,
        ]),
        inputVideoUrl: referenceVideoUrl,
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: getRecreateReplicateModel({
          engine: recreateEngineNormalized,
          ultra: useUltraDirect,
          wanResolution: wanResolutionNormalized,
        }),
        duration: videoDuration,
      },
    });
    generationId = generation.id;

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`✅ Credits deducted: ${creditsNeeded}`);

    console.log("📋 Adding quick video generation to queue...");
    const queueStats = requestQueue.getStats();
    console.log(
      `Queue: ${queueStats.active}/${queueStats.maxConcurrent} active, ${queueStats.queued} queued`,
    );

    processQuickVideoInBackground(
      generation.id,
      model,
      referenceVideoUrl,
      userId,
      creditsNeeded,
      useUltraDirect,
      recreateEngineNormalized,
      wanResolutionNormalized,
    ).catch((error) => {
      console.error("❌ Background processing error:", error);
    });

    // Return immediately with processing status
    res.json({
      success: true,
      message: "Quick video generation started! This will take 2-3 minutes.",
      generation: {
        id: generation.id,
        tempId: tempId, // v46 FIX: Return tempId to frontend
        type: "video",
        status: "processing",
        duration: videoDuration, // v47 FIX: Return actual duration to prevent default override
        estimatedTime: "2-3 minutes",
        createdAt: generation.createdAt, // v46 FIX: Include createdAt to avoid Invalid Date
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: totalCredits - creditsNeeded,
    });
  } catch (error) {
    console.error("Quick video generation error:", error);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
}

/**
 * Face swap video
 * Swaps face in a source video with a model's face
 * Pricing: 10 credits per second
 */
/**
 * Background worker for face swap generation
 * Processes face swap API call without blocking frontend response
 */
async function processFaceSwapInBackground(
  generationId,
  userId,
  sourceVideoUrl,
  faceImageUrl,
  options,
  creditsNeeded,
) {
  try {
    console.log(
      `\n🔄 Background face swap processing for generation ${generationId}...`,
    );

    // Add to queue to prevent overwhelming WaveSpeed API
    console.log("📋 Adding face swap to queue...");
    const queueStats = requestQueue.getStats();
    console.log(
      `Queue stats: Active: ${queueStats.active}, Queued: ${queueStats.queued}, Max: ${queueStats.maxConcurrent}`,
    );

    // Call WaveSpeed API
    const result = await requestQueue.enqueue(async () => {
      return await faceSwapVideo(sourceVideoUrl, faceImageUrl, options);
    });

    if (result.success && result.outputUrl) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          outputUrl: result.outputUrl,
          completedAt: new Date(),
        },
      });
      console.log(`✅ Face swap ${generationId} completed successfully!`);
    } else if (result.success && result.deferred) {
      console.log(`⏳ Face swap ${generationId} submitted; result will arrive via callback`);
    } else {
      throw new Error(result.error || "Face swap API returned failure");
    }
  } catch (error) {
    console.error(
      `❌ Background face swap failed for generation ${generationId}:`,
      error,
    );

    // Refund credits atomically (prevents double-refunds from watchdog)
    await refundGeneration(generationId);
    console.log(`💰 Credits refunded for generation ${generationId}`);

    // Mark as failed
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(error.message),
        completedAt: new Date(),
      },
    });
  }
}

export async function generateFaceSwap(req, res) {
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const {
      sourceVideoUrl,
      modelId,
      targetGender = "all",
      targetIndex = 0,
      maxDuration = 0,
      videoDuration,
      tempId, // v46 FIX: Receive tempId
    } = req.body;
    userId = req.user.userId;

    // Validate inputs
    if (!sourceVideoUrl) {
      return res.status(400).json({
        success: false,
        message: "Source video URL is required",
      });
    }

    if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Face model is required",
      });
    }

    if (!videoDuration || videoDuration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Video duration in seconds is required",
      });
    }

    const sourceVideoCheck = await validateFaceSwapSourceVideoUrl(sourceVideoUrl);
    if (!sourceVideoCheck.valid) {
      return res.status(400).json({
        success: false,
        code: "SOURCE_VIDEO_INVALID",
        message: sourceVideoCheck.message,
        error: sourceVideoCheck.message,
        solution:
          "Use MP4 (H.264) when possible, up to 10 minutes and within the configured byte cap (default 500MB — PROVIDER_LIMIT_WS_VIDEO_FACE_SWAP_MAX_BYTES). Re-upload if the link cannot be verified.",
      });
    }

    // Get model to extract face image (using first photo - front-facing)
    const model = await prisma.savedModel.findFirst({
      where: {
        id: modelId,
        userId: userId,
      },
    });

    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Face model not found",
      });
    }

    // Use first photo from the model (front-facing selfie)
    const faceImageUrl = model.photo1Url;

    const pricing = await getGenerationPricing();
    // Calculate credits per second for face-swap video
    const creditsNeeded = Math.ceil(videoDuration * pricing.videoFaceSwapPerSec);

    // Check user credits (with expiration check)
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits for ${videoDuration}s video. You have ${totalCredits} credits.`,
      });
    }

    console.log(
      `\n🎭 Face swap requested: ${videoDuration}s video = ${creditsNeeded} credits`,
    );

    // Create generation record
    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId, // Associate with model for filtering
        type: "face-swap",
        prompt: `Face swap - ${videoDuration}s video`,
        inputImageUrl: JSON.stringify({
          sourceVideoUrl,
          faceImageUrl,
          modelId,
        }),
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: "wavespeed-video-face-swap",
        duration: videoDuration,
      },
    });
    generationId = generation.id; // Track for emergency refund

    // Deduct credits upfront
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded; // Track for emergency refund

    console.log(`✅ Face swap generation created! ID: ${generation.id}`);

    // Return immediately to frontend
    res.json({
      success: true,
      message: "Face swap generation started!",
      generation: {
        id: generation.id,
        tempId: tempId, // v46 FIX: Return tempId to frontend
        type: "face-swap",
        status: "processing",
        duration: videoDuration, // v47 FIX: Return duration to prevent default override
        prompt: `Face swap - ${videoDuration}s video`,
        createdAt: generation.createdAt,
      },
      creditsUsed: creditsNeeded,
    });

    // Process in background (don't await)
    processFaceSwapInBackground(
      generation.id,
      userId,
      sourceVideoUrl,
      faceImageUrl,
      { targetGender, targetIndex, maxDuration },
      creditsNeeded,
    ).catch((error) => {
      console.error(
        `❌ Background face swap failed for ${generation.id}:`,
        error,
      );
    });
  } catch (error) {
    console.error("Face swap error:", error.message);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res
      .status(500)
      .json({ success: false, message: "Failed to start face swap. Please try again." });
  }
}

/**
 * Watchdog: Auto-fail generations stuck in processing for too long
 * Call this periodically (e.g., from a cron job or on startup)
 * Note: Video recreations can take 10-15+ minutes, so timeout is set to 60 minutes
 */
export async function cleanupStuckGenerations(req, res) {
  try {
    const IMAGE_TIMEOUT_MINUTES = 15;
    const VIDEO_TIMEOUT_MINUTES = 45;
    /** RunPod NSFW + nudes packs can run 30–90+ min behind queue; do NOT use the 15m image cutoff. */
    const NSFW_CLEANUP_TIMEOUT_MINUTES = Math.max(
      45,
      Math.min(300, Number(process.env.NSFW_STUCK_CLEANUP_MINUTES) || 200),
    );
    const nowMs = Date.now();
    const imageCutoffMs = nowMs - IMAGE_TIMEOUT_MINUTES * 60 * 1000;
    const videoCutoffMs = nowMs - VIDEO_TIMEOUT_MINUTES * 60 * 1000;
    const nsfwCutoffMs = nowMs - NSFW_CLEANUP_TIMEOUT_MINUTES * 60 * 1000;

    console.log(
      `\n🔍 Checking for stuck generations (image>${IMAGE_TIMEOUT_MINUTES}m, video>${VIDEO_TIMEOUT_MINUTES}m, nsfw>${NSFW_CLEANUP_TIMEOUT_MINUTES}m)...`,
    );

    // Find all generations stuck in processing or pending
    const processingGenerations = await prisma.generation.findMany({
      where: {
        status: {
          in: ["processing", "pending"],
        },
      },
    });

    const videoLikeTypes = new Set(["video", "prompt-video", "talking-head-video", "complete-recreation-video"]);
    const stuckGenerations = processingGenerations.filter((gen) => {
      const createdMs = new Date(gen.createdAt).getTime();
      const t = String(gen.type || "");
      const isVideoLike = videoLikeTypes.has(t);
      if (isVideoLike) return createdMs < videoCutoffMs;
      if (t === "nsfw") return createdMs < nsfwCutoffMs;
      return createdMs < imageCutoffMs;
    });

    if (stuckGenerations.length === 0) {
      console.log("✅ No stuck generations found");
      return res?.json({
        success: true,
        message: "No stuck generations found",
        cleaned: 0,
      });
    }

    console.log(
      `⚠️  Found ${stuckGenerations.length} stuck generation(s), marking as failed...`,
    );

    // Mark each as failed and refund credits if needed
    let cleanedCount = 0;
    for (const gen of stuckGenerations) {
      // All generation types now deduct credits upfront, so refund them all
      // Use atomic refund to prevent double-refunds
      let refundStatus = "no credits to refund";
      if (gen.creditsCost > 0 && !gen.creditsRefunded) {
        const refunded = await refundGeneration(gen.id);
        if (refunded) {
          refundStatus = `refunded ${gen.creditsCost} credits`;
          console.log(
            `  💰 Refunded ${gen.creditsCost} credits to user ${gen.userId} (${gen.type})`,
          );
        } else {
          refundStatus = "already refunded or failed";
        }
      }

      const gt = String(gen.type || "");
      const timeoutMinutes = videoLikeTypes.has(gt)
        ? VIDEO_TIMEOUT_MINUTES
        : gt === "nsfw"
          ? NSFW_CLEANUP_TIMEOUT_MINUTES
          : IMAGE_TIMEOUT_MINUTES;

      // Mark as failed
      await prisma.generation.update({
        where: { id: gen.id },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(
            `Generation timed out (>${timeoutMinutes} minutes for ${gen.type || "unknown"})`
          ),
          completedAt: new Date(),
        },
      });

      console.log(
        `  ❌ Marked generation ${gen.id} (${gen.type}) as failed - ${refundStatus}`,
      );
      cleanedCount++;
    }

    console.log(`\n✅ Cleaned up ${cleanedCount} stuck generation(s)`);

    // ============================================
    // KIE callback task recovery (dedicated mapping)
    // ============================================
    const STALE_MODEL_MINUTES = 15;
    const staleModelThreshold = new Date(Date.now() - STALE_MODEL_MINUTES * 60 * 1000);
    const staleModelTasks = await prisma.kieTask.findMany({
      where: {
        provider: "kie",
        entityType: "saved_model_photo",
        status: "processing",
        createdAt: { lt: staleModelThreshold },
      },
      select: { taskId: true, entityId: true },
    });
    if (staleModelTasks.length > 0) {
      console.warn(`⚠️ Found ${staleModelTasks.length} stale KIE model task(s); failing associated models...`);
    }
    for (const stale of staleModelTasks) {
      const model = await prisma.savedModel.findUnique({
        where: { id: stale.entityId },
        select: { id: true, status: true, aiGenerationParams: true },
      });
      if (!model || model.status === "ready" || model.status === "failed") {
        await prisma.kieTask.updateMany({
          where: { taskId: stale.taskId },
          data: { status: "failed", errorMessage: getErrorMessageForDb("Task became stale"), completedAt: new Date() },
        });
        continue;
      }

      const params = model.aiGenerationParams || {};
      const updateParams = {
        ...params,
        lastError: "Generation timed out waiting for KIE callback",
        failedAt: new Date().toISOString(),
      };
      if (params?.type === "advanced-model" && params?.userId && params?.creditsNeeded && !params?.refundedAt) {
        try {
          await refundCredits(params.userId, Number(params.creditsNeeded));
          updateParams.refundedAt = new Date().toISOString();
        } catch (refundErr) {
          console.error("⚠️ Failed to refund stale advanced-model credits:", refundErr?.message);
        }
      }

      await prisma.savedModel.update({
        where: { id: model.id },
        data: { status: "failed", aiGenerationParams: updateParams },
      });
      await prisma.kieTask.updateMany({
        where: { taskId: stale.taskId },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb("Generation timed out waiting for KIE callback"),
          completedAt: new Date(),
        },
      });
    }

    // ============================================
    // NSFW Training Session Cleanup
    // Find models stuck in "generating_images" for over 1 hour
    // ============================================
    const NSFW_TIMEOUT_MINUTES = 60;
    const nsfwTimeoutThreshold = new Date(Date.now() - NSFW_TIMEOUT_MINUTES * 60 * 1000);
    
    console.log(`\n🔍 Checking for stuck NSFW training sessions (older than ${NSFW_TIMEOUT_MINUTES} minutes)...`);
    
    const stuckNsfwModels = await prisma.savedModel.findMany({
      where: {
        loraStatus: "generating_images",
        updatedAt: {
          lt: nsfwTimeoutThreshold,
        },
      },
    });
    
    let nsfwCleanedCount = 0;
    if (stuckNsfwModels.length > 0) {
      console.log(`⚠️  Found ${stuckNsfwModels.length} stuck NSFW training session(s)...`);
      
      for (const model of stuckNsfwModels) {
        // Check how many images were completed
        const completedCount = await prisma.loraTrainingImage.count({
          where: {
            modelId: model.id,
            status: "completed",
          },
        });
        
        // Set status based on completion
        const newStatus = completedCount >= 15 ? "images_ready" : "partial_failure";
        
        await prisma.savedModel.update({
          where: { id: model.id },
          data: { loraStatus: newStatus },
        });
        
        console.log(`  📸 Model ${model.id}: ${completedCount}/15 images -> ${newStatus}`);
        nsfwCleanedCount++;
      }
      
      console.log(`\n✅ Cleaned up ${nsfwCleanedCount} stuck NSFW training session(s)`);
    } else {
      console.log("✅ No stuck NSFW training sessions found");
    }

    if (res) {
      return res.json({
        success: true,
        message: `Cleaned up ${cleanedCount} stuck generation(s), ${nsfwCleanedCount} NSFW session(s)`,
        cleaned: cleanedCount,
        nsfwCleaned: nsfwCleanedCount,
        details: stuckGenerations.map((g) => ({
          id: g.id,
          type: g.type,
          ageMinutes: Math.floor(
            (Date.now() - new Date(g.createdAt).getTime()) / 60000,
          ),
        })),
      });
    }
  } catch (error) {
    console.error("❌ Cleanup error:", error);
    if (res) {
      return res.status(500).json({
        success: false,
        message: "Cleanup failed",
        error: error.message,
      });
    }
  }
}

/**
 * Generate image from text prompt using user's model
 * User provides: modelId + creative prompt
 * System: Fetches model photos + generates image based on prompt
 * Uses Nano Banana Pro Edit for better identity preservation
 */
/**
 * Build generation prompt for Nano Banana Pro Edit
 * Format: Use images 1, 2, 3 as identity reference + user prompt
 */
function buildGenerationPrompt(
  userPrompt,
  style = "professional",
  contentRating = "pg13",
  referenceCount = 3,
) {
  const refList =
    referenceCount === 2 ? "reference images 1 and 2" : "reference images 1, 2, and 3";

  // Scene recreation format - place the person from reference images into user's described scene
  const finalPrompt = `Recreate the person from ${refList} into this scene: ${userPrompt.trim()}. Maintain exact facial features, face structure, skin tone, hair color, and eye color from the reference images. The result should look like a real person.`;

  return finalPrompt;
}

// Prompt-based image: Seedream 4.5 Edit (WaveSpeed) for spicy/uncensored; Nano Banana (KIE) for casual.

export async function generatePromptBasedImage(req, res) {
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const {
      modelId,
      prompt,
      quantity = 1,
      style = "amateur",
      contentRating = "sexy",
      useNsfw = false,
      useCustomPrompt = false, // true = raw prompt without prefixes
    } = req.body;
    userId = req.user.userId;

    // Spicy / sexy / uncensored → Seedream 4.5 Edit (WaveSpeed). SFW → Nano Banana.
    const contentLower = String(contentRating || "").toLowerCase();
    const useSeedream = useNsfw || ["sexy", "spicy", "uncensored"].includes(contentLower);

    if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Need model ID",
      });
    }

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Need a text prompt describing what you want to create",
      });
    }

    const pricing = await getGenerationPricing();
    const creditsNeeded = useSeedream ? pricing.imagePromptNsfw : pricing.imagePromptCasual;

    const model = await prisma.savedModel.findUnique({
      where: { id: modelId },
    });

    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    if (model.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to use this model",
      });
    }

    const modelIdentityImages = [model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean);
    const requiredReferenceCount = useSeedream ? 3 : 2;
    if (modelIdentityImages.length < requiredReferenceCount) {
      return res.status(400).json({
        success: false,
        message: `Model is missing reference photos. ${useSeedream ? "Seedream (spicy/uncensored)" : "Casual"} mode requires ${requiredReferenceCount} photo(s).`,
      });
    }
    const identityImages = modelIdentityImages.slice(0, requiredReferenceCount);

    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits. You have ${totalCredits} credits.`,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;
    console.log(`💳 Deducted ${creditsNeeded} credits upfront`);

    // Inject model looks (savedAppearance + age) into prompt for character consistency
    const appearancePrefix = buildAppearancePrefix({
      savedAppearance: model.savedAppearance ?? undefined,
      age: model.age ?? undefined,
    });

    // Custom prompt = raw user input, AI enhanced = add prefixes
    const basePrompt = useCustomPrompt
      ? `Using reference images ${requiredReferenceCount === 2 ? "1 and 2" : "1, 2, and 3"} as identity reference for the person's face and features. Create a photo of this exact same person: ${prompt.trim()}. Keep the exact same face, facial features, hair color, eye color from the reference images. High quality, photorealistic.`
      : buildGenerationPrompt(prompt, style, contentRating, requiredReferenceCount);
    const finalPrompt = (appearancePrefix || "") + basePrompt;
    const providerInputCheck = useSeedream
      ? await validateSeedreamEditImages(identityImages, "wavespeed")
      : await validateNanoBananaInputImages(identityImages);
    if (!providerInputCheck.valid) {
      return res.status(400).json({ success: false, message: providerInputCheck.message });
    }

    const aiModel = useSeedream ? "wavespeed-seedream-v4.5-edit" : "kie-nano-banana-pro";
    console.log(`\n${useSeedream ? "🌙" : "🍌"} PROMPT-BASED GENERATION (${useSeedream ? "WaveSpeed Seedream 4.5 Edit" : "KIE Nano Banana Pro"})`);
    console.log(`📸 Model: ${model.name || "Unnamed"}`);
    console.log(`💭 User prompt: ${prompt}`);
    console.log(`📝 Final prompt: ${finalPrompt}`);
    console.log(`🔞 Seedream (spicy/uncensored): ${useSeedream ? "YES" : "NO"}`);
    console.log(`✏️ Custom Prompt: ${useCustomPrompt ? "YES (raw)" : "NO (AI enhanced)"}`);
    console.log(`🧷 Identity refs routed: ${identityImages.length} (${useSeedream ? "Seedream 4.5 expects 3" : "Nano Banana expects 2"})`);

    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId,
        type: "prompt-image",
        prompt: prompt.trim(),
        inputImageUrl: identityImages.join(","),
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: aiModel,
      },
    });
    generationId = generation.id; // Track for emergency refund

    console.log(`✅ Generation created: ${generation.id}`);

    // Process in background (don't await)
    processPromptImageInBackground(
      generation.id,
      identityImages,
      finalPrompt,
      userId,
      creditsNeeded,
      useSeedream // Seedream 4.5 for spicy/uncensored
    ).catch((error) => {
      console.error("❌ Background processing error:", error);
    });

    // Return immediately with processing status
    res.json({
      success: true,
      message: "Generating! Check Live Preview.",
      generation: {
        id: generation.id,
        type: "prompt-image",
        status: "processing",
        createdAt: generation.createdAt,
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: totalCredits - creditsNeeded,
    });
  } catch (error) {
    console.error("❌ Prompt-based generation error:", error);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
}

// Background processor for prompt-based image generation
async function processPromptImageInBackground(
  generationId,
  identityImages,
  customPrompt,
  userId,
  creditsNeeded,
  useSeedream = false // Seedream 4.5 Edit (spicy/uncensored) vs Nano Banana (casual)
) {
  try {
    const emoji = useSeedream ? "🌙" : "🍌";
    const modelName = useSeedream ? "WaveSpeed Seedream 4.5 Edit" : "KIE Nano Banana Pro";
    console.log(`\n${emoji} [BG] Starting prompt image processing for ${generationId} (${modelName})`);

    // Upload inputs to Blob first so KIE/WaveSpeed can fetch immediately when we submit
    const kieImages = await Promise.all(
      (identityImages || []).map((u, i) => ensureKieAccessibleUrl(u, `prompt-img-${i + 1}`))
    ).catch(() => identityImages || []);

    const queueStats = requestQueue.getStats();
    console.log(
      `📋 Queue: ${queueStats.active}/${queueStats.maxConcurrent} active, ${queueStats.queued} queued`
    );

    const result = await requestQueue.enqueue(async () => {
      if (useSeedream) {
        const onTaskCreated = async (taskId) => {
          await prisma.generation.update({
            where: { id: generationId },
            data: { replicateModel: `wavespeed-seedream:${taskId}` },
          });
        };
        return await generateImageWithSeedreamWaveSpeed(kieImages, customPrompt, {
          onTaskCreated,
        });
      } else {
        const onTaskCreated = async (taskId) => {
          await prisma.generation.update({
            where: { id: generationId },
            data: { replicateModel: `kie-task:${taskId}` },
          });
          await registerKieTaskForGeneration(taskId, generationId, userId, "prompt-image");
        };
        return await generateImageWithNanoBananaKie(kieImages, customPrompt, {
          aspectRatio: "9:16",
          resolution: "2K",
          onTaskCreated,
        });
      }
    });

    if (result.success && result.deferred && result.taskId) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          replicateModel: `wavespeed-seedream:${result.taskId}`,
        },
      });
      console.log(`✅ [BG] Prompt image submitted; result will arrive via callback (task ${result.taskId})`);
    } else if (result.success && result.outputUrl) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          outputUrl: result.outputUrl,
          completedAt: new Date(),
        },
      });
      console.log(`✅ [BG] Prompt image completed: ${result.outputUrl}`);
    } else {
      // Refund credits atomically (prevents double-refunds from watchdog)
      await refundGeneration(generationId);
      console.log(`✅ [BG] Credits refunded for generation ${generationId}`);

      const friendlyError = getUserFriendlyGenerationError(result.error);
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(friendlyError),
        },
      });
      console.log(`❌ [BG] Prompt image failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`❌ [BG] Prompt image error:`, error.message);

    // Refund credits atomically (prevents double-refunds from watchdog)
    await refundGeneration(generationId);
    console.log(`✅ [BG] Credits refunded for generation ${generationId}`);

    const friendlyError = getUserFriendlyGenerationError(error.message);
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(friendlyError),
      },
    });
  }
}

/**
 * Generate video from image + prompt using Kling V2.5 Turbo
 * POST /generate/video-prompt
 */
export async function generateVideoFromPrompt(req, res) {
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const { imageUrl, prompt, duration = 5, tempId } = req.body;
    userId = req.user.userId;

    if (!imageUrl || !prompt) {
      return res.status(400).json({
        success: false,
        message: "Image URL and prompt are required",
      });
    }

    const imgUrlCheck = validateImageUrl(imageUrl);
    if (!imgUrlCheck.valid) {
      return res.status(400).json({ success: false, message: imgUrlCheck.message });
    }

    if (![5, 10].includes(duration)) {
      return res.status(400).json({
        success: false,
        message: "Duration must be 5 or 10 seconds",
      });
    }

    const pricing = await getGenerationPricing();
    const creditsNeeded = duration === 5 ? pricing.videoPrompt5s : pricing.videoPrompt10s;

    // Check credits (with expiration check)
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(400).json({
        success: false,
        message: `Insufficient credits. Need ${creditsNeeded}, have ${totalCredits}`,
      });
    }

    // ✅ FIX: Use deductCredits() function for proper credit management
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded; // Track for emergency refund
    console.log(`💳 Deducted ${creditsNeeded} credits upfront (Prompt Video)`);

    // Create generation record
    const generation = await prisma.generation.create({
      data: {
        userId,
        type: "prompt-video",
        prompt,
        inputImageUrl: imageUrl,
        status: "processing",
        creditsCost: creditsNeeded,
        duration: duration,
      },
    });
    generationId = generation.id; // Track for emergency refund

    processPromptVideoInBackground(
      generation.id,
      imageUrl,
      prompt,
      duration,
      userId,
      creditsNeeded,
    );

    res.json({
      success: true,
      message: "Video generation started!",
      generation: {
        ...generation,
        tempId: tempId, // v46 FIX: Return tempId to frontend
      },
      creditsUsed: creditsNeeded,
    });
  } catch (error) {
    console.error("❌ Prompt video generation error:", error);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
}

/**
 * Background processor for Prompt Video generation
 */
async function processPromptVideoInBackground(
  generationId,
  imageUrl,
  prompt,
  duration,
  userId,
  creditsNeeded,
) {
  try {
    console.log(`\n🔄 Background processing prompt video ${generationId} via kie.ai Kling 2.6...`);

    const kieImageUrl = await ensureKieAccessibleUrl(imageUrl, "prompt-video image").catch(() => imageUrl);

    // Inject cinematography language and negative prompt for better Kling 3.0 realism
    const cinematographySuffix = " Shallow depth of field, natural bokeh, cinematic lighting, natural motion.";
    const negativePrompt = " Avoid: CGI, cartoon, plastic skin, overexposed, motion blur, watermark.";
    const enhancedPrompt = (prompt && prompt.trim() ? prompt.trim() + "." : "Cinematic shot, natural movement.") + cinematographySuffix + negativePrompt;

    const result = await generateVideoWithKling26Kie(kieImageUrl, enhancedPrompt, {
      duration,
      onTaskCreated: async (taskId) => {
        await prisma.generation.update({
          where: { id: generationId },
          data: { replicateModel: `kie-task:${taskId}` },
        });
        await registerKieTaskForGeneration(taskId, generationId, userId, "prompt-video");
      },
    });

    if (!result.success) {
      throw new Error(result.error || "Kling 2.6 video generation failed");
    }

    // When KIE uses callback we get deferred: true and no outputUrl — callback will update when done
    if (result.deferred) {
      if (result.taskId) {
        await registerKieTaskForGeneration(result.taskId, generationId, userId, "prompt-video");
      }
      console.log(`✅ Prompt video ${generationId} submitted to KIE; result will arrive via callback`);
      return;
    }

    if (!result.outputUrl) {
      throw new Error("AI service returned success but no video URL");
    }

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "completed",
        outputUrl: result.outputUrl,
        completedAt: new Date(),
      },
    });

    console.log(`✅ Generation ${generationId} completed successfully!`);
  } catch (error) {
    console.error(
      `❌ Background processing failed for generation ${generationId}:`,
      error,
    );

    await refundGeneration(generationId);
    console.log(`💰 Credits refunded for generation ${generationId}`);

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(error.message),
      },
    });
  }
}

// v48 FIX: Background processing function for Face Swap Image
async function processFaceSwapImageInBackground(
  generationId,
  targetImageUrl,
  sourceImageUrl,
  userId,
  creditsNeeded,
) {
  try {
    console.log(
      `🚀 [BG] Starting Face Swap Image processing for generation ${generationId}`,
    );

    const { faceSwapImage: faceSwapImageService } = await import(
      "../services/wavespeed.service.js"
    );
    const result = await faceSwapImageService(targetImageUrl, sourceImageUrl);

    if (!result.success) {
      throw new Error(result.error || "Face swap failed");
    }
    if (!result.outputUrl) {
      throw new Error("Face swap returned success but no output URL");
    }

    console.log(
      `✅ [BG] Face swap completed for generation ${generationId}:`,
      result.outputUrl,
    );

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "completed",
        outputUrl: result.outputUrl,
        completedAt: new Date(),
      },
    });

    console.log(`✅ [BG] Generation ${generationId} marked as completed`);
  } catch (error) {
    console.error(
      `❌ [BG] Face swap image error for generation ${generationId}:`,
      error,
    );

    // Refund credits atomically (prevents double-refunds from watchdog)
    await refundGeneration(generationId);
    console.log(`✅ [BG] Credits refunded for generation ${generationId}`);

    // Mark generation as failed
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(error.message),
      },
    });
  }
}

// v42a: Face swap in image endpoint
export async function faceSwapImage(req, res) {
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const { targetImageUrl, sourceImageUrl, tempId } = req.body; // v46 FIX: Receive tempId
    userId = req.user.userId;

    console.log("📸 Face Swap Image Request");
    console.log("   User ID:", userId);
    console.log("   Target Image URL:", targetImageUrl);
    console.log("   Source Image URL:", sourceImageUrl);

    if (!targetImageUrl || !sourceImageUrl) {
      return res.status(400).json({
        success: false,
        message: "Both targetImageUrl and sourceImageUrl are required",
      });
    }

    const tgtCheck = validateImageUrl(targetImageUrl);
    if (!tgtCheck.valid) {
      return res.status(400).json({ success: false, message: tgtCheck.message });
    }
    const srcCheck = validateImageUrl(sourceImageUrl);
    if (!srcCheck.valid) {
      return res.status(400).json({ success: false, message: srcCheck.message });
    }

    // Check user credits (with expiration check)
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    const pricing = await getGenerationPricing();
    const creditsNeeded = pricing.imageFaceSwap;
    if (totalCredits < creditsNeeded) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. Face swap requires ${creditsNeeded} credits.`,
      });
    }

    console.log("💰 Current credits:", totalCredits);

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded; // Track for emergency refund
    console.log(
      "✅ Credits deducted. New balance:",
      totalCredits - creditsNeeded,
    );

    // v48 FIX: Create generation with processing status first
    const generation = await prisma.generation.create({
      data: {
        userId,
        type: "face-swap-image",
        prompt: "Face swap",
        status: "processing",
        outputUrl: null,
        creditsCost: creditsNeeded,
        inputImageUrl: JSON.stringify({
          targetImageUrl,
          sourceImageUrl,
        }),
      },
    });
    generationId = generation.id; // Track for emergency refund

    console.log("✅ Generation created with ID:", generation.id);

    // v48 FIX: Process in background, return immediately
    processFaceSwapImageInBackground(
      generation.id,
      targetImageUrl,
      sourceImageUrl,
      userId,
      creditsNeeded,
    ).catch((error) => {
      console.error("❌ Background processing error:", error);
    });

    // Return immediately with processing status
    res.json({
      success: true,
      message: "Face swap started! This will take 10-30 seconds.",
      generation: {
        id: generation.id,
        tempId: tempId, // v46 FIX: Return tempId to frontend
        type: "face-swap-image",
        status: "processing",
        createdAt: generation.createdAt,
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: totalCredits - creditsNeeded,
    });
  } catch (error) {
    console.error("❌ Face swap image error:", error.message);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Failed to swap face in image. Please try again.",
    });
  }
}

/**
 * Generate talking head video
 * Combines ElevenLabs TTS + Kling V2 AI Avatar Standard
 * Kling V2: High-quality lip-sync with expressive animation, $0.056/sec
 * Credit formula: ~13 credits per second of audio (minimum 70 credits)
 */
export async function generateTalkingHeadVideo(req, res) {
  const { generateTalkingHead } = await import("../services/wavespeed.service.js");
  const { textToSpeech, uploadAudioToR2, estimateAudioDuration } = await import("../services/elevenlabs.service.js");
  
  // Track credit state for emergency refund in outer catch
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const { imageUrl, voiceId, text, tempId, prompt } = req.body;
    userId = req.user.userId;

    console.log("\n🗣️ TALKING HEAD VIDEO REQUEST");
    console.log("   User ID:", userId);
    console.log("   Image URL:", imageUrl);
    console.log("   Voice ID:", voiceId);
    console.log("   Text length:", text?.length, "characters");
    if (prompt) console.log("   Prompt:", prompt);

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Image URL is required",
      });
    }

    const talkImgCheck = validateImageUrl(imageUrl);
    if (!talkImgCheck.valid) {
      return res.status(400).json({ success: false, message: talkImgCheck.message });
    }

    if (!voiceId) {
      return res.status(400).json({
        success: false,
        message: "Voice selection is required",
      });
    }

    if (!text || text.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "Text must be at least 5 characters",
      });
    }

    const textMaxChars = waveSpeedConstraints.klingV2AiAvatarStandard.textMaxChars;
    if (text.length > textMaxChars) {
      return res.status(400).json({
        success: false,
        message: `Text must be ${textMaxChars} characters or less`,
      });
    }

    // Estimate duration using voice-specific speed profile (no buffer needed)
    const estimatedDuration = estimateAudioDuration(text, voiceId);
    // Kling V2 Avatar ($0.056/sec) + ElevenLabs (~$0.005/sec) = ~$0.061/sec
    // At $0.01/credit with 50% margin: ~13 credits/sec in new units
    // Minimum 5 sec from WaveSpeed = 70 credits minimum
    const pricing = await getGenerationPricing();
    const creditsNeeded = Math.max(
      pricing.talkingHeadMin,
      Math.ceil(estimatedDuration * pricing.talkingHeadPerSecondX10),
    );

    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);

    if (totalCredits < creditsNeeded) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. Talking head requires ~${creditsNeeded} credits.`,
      });
    }

    console.log(`💰 Estimated duration: ${estimatedDuration}s, Credits: ${creditsNeeded}`);

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded; // Track for emergency refund
    console.log("✅ Credits deducted:", creditsNeeded);

    const generation = await prisma.generation.create({
      data: {
        userId,
        type: "talking-head",
        prompt: text.substring(0, 255),
        status: "processing",
        outputUrl: null,
        creditsCost: creditsNeeded,
        inputImageUrl: JSON.stringify({ imageUrl, voiceId }),
      },
    });
    generationId = generation.id; // Track for emergency refund

    console.log("✅ Generation created:", generation.id);

    processTalkingHeadInBackground(
      generation.id,
      imageUrl,
      voiceId,
      text,
      userId,
      creditsNeeded,
      prompt || null,
      generateTalkingHead,
      textToSpeech,
      uploadAudioToR2
    ).catch((error) => {
      console.error("❌ Background processing error:", error);
    });

    res.json({
      success: true,
      message: "Talking head video started! This may take 1-2 minutes.",
      generation: {
        id: generation.id,
        tempId: tempId,
        type: "talking-head",
        status: "processing",
        createdAt: generation.createdAt,
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: totalCredits - creditsNeeded,
    });
  } catch (error) {
    console.error("❌ Talking head error:", error.message);
    
    // Emergency refund: Handle credits that were deducted but processing failed
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          const refunded = await refundGeneration(generationId);
          console.log(`🔄 Emergency refund via generation ${generationId}: ${refunded} credits`);
        } else {
          await refundCredits(userId, creditsDeducted);
          console.log(`🔄 Emergency direct refund: ${creditsDeducted} credits`);
        }
      } catch (refundError) {
        console.error(`❌ Emergency refund failed:`, refundError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Failed to generate talking head video. Please try again.",
    });
  }
}

async function processTalkingHeadInBackground(
  generationId,
  imageUrl,
  voiceId,
  text,
  userId,
  creditsCharged,
  prompt,
  generateTalkingHead,
  textToSpeech,
  uploadAudioToR2
) {
  // Import explicit content detection helpers
  const { isExplicitContentError, getExplicitContentUserMessage } = await import("../services/wavespeed.service.js");
  const { mirrorToR2 } = await import("../utils/r2.js");
  const isRetryableTalkingHeadError = (message) => {
    const m = String(message || "").toLowerCase();
    return (
      m.includes("429") ||
      m.includes("404") ||
      m.includes("not found") ||
      m.includes("not ready") ||
      m.includes("rate limit") ||
      m.includes("too many requests") ||
      m.includes("timeout") ||
      m.includes("temporar") ||
      m.includes("internal") ||
      m.includes("unavailable")
    );
  };
  
  try {
    console.log(`\n🗣️ [BG] Starting talking head processing for ${generationId}`);
    console.log(`💰 [BG] Credits charged: ${creditsCharged}`);
    if (prompt) console.log(`💬 [BG] Prompt: ${prompt}`);

    console.log("🎙️ [BG] Generating audio with ElevenLabs...");
    const audioBuffer = await textToSpeech(text, voiceId);
    const processedAudio = await preprocessAudioForTalkingHead(audioBuffer).catch(() => audioBuffer);

    console.log("☁️ [BG] Uploading audio to R2...");
    const audioResult = await uploadAudioToR2(processedAudio);
    const audioUrl = audioResult.url;
    const actualDuration = audioResult.duration || 0;
    
    console.log(`⏱️ [BG] Actual audio duration: ${actualDuration.toFixed(2)}s`);

    // Ensure provider input is durable/public from our own storage.
    const imageUrlForProvider = await mirrorToR2(imageUrl, "talking-head-inputs");
    if (imageUrlForProvider !== imageUrl) {
      console.log(`📦 [BG] Mirrored talking-head image to R2: ${imageUrlForProvider}`);
    }

    console.log("🎬 [BG] Generating talking head with Kling V2...");
    let result;
    try {
      result = await generateTalkingHead(imageUrlForProvider, audioUrl, prompt);
    } catch (firstError) {
      if (!isRetryableTalkingHeadError(firstError?.message)) {
        throw firstError;
      }
      console.warn(`⚠️ [BG] Talking head transient failure, retrying once: ${firstError?.message}`);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      result = await generateTalkingHead(imageUrlForProvider, audioUrl, prompt);
    }

    if (!result?.outputUrl) {
      throw new Error("Talking head returned no output URL");
    }

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "completed",
        outputUrl: result.outputUrl,
        completedAt: new Date(),
        duration: actualDuration,
      },
    });

    console.log(`✅ [BG] Talking head completed: ${result.outputUrl}`);
    console.log(`💰 [BG] Final cost: ${creditsCharged} credits`);
  } catch (error) {
    console.error(`❌ [BG] Talking head failed:`, error.message);

    // Refund credits atomically (prevents double-refunds from watchdog)
    await refundGeneration(generationId);
    console.log(`✅ [BG] Credits refunded for generation ${generationId}`);

    // Detect explicit content errors and provide user-friendly message
    let userErrorMessage = error.message;
    if (isExplicitContentError(error.message)) {
      userErrorMessage = getExplicitContentUserMessage(error.message);
      console.log(`⚠️ [BG] Explicit content detected - showing user-friendly message`);
    }

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: getErrorMessageForDb(userErrorMessage),
      },
    });
  }
}

/**
 * Get available ElevenLabs voices
 */
export async function getVoices(req, res) {
  try {
    const { getVoices: getElVoices } = await import("../services/elevenlabs.service.js");
    let voices = await getElVoices();

    const modelId = typeof req.query.modelId === "string" ? req.query.modelId.trim() : "";
    const userId = req.user?.userId;
    if (modelId && userId) {
      const model = await prisma.savedModel.findFirst({
        where: { id: modelId, userId },
        select: { name: true },
      });
      const modelVoices = await prisma.modelVoice.findMany({
        where: { modelId, userId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          elevenLabsVoiceId: true,
          type: true,
          name: true,
          gender: true,
          previewUrl: true,
          isDefault: true,
        },
      });

      if (modelVoices.length > 0) {
        const modelName = model?.name || "My model";
        const customVoices = modelVoices.map((voice) => {
          const previewUrl = voice.previewUrl || "";
          return {
            id: voice.elevenLabsVoiceId,
            name: voice.name || `${modelName}'s voice`,
            modelName,
            voiceType: voice.type || "design",
            category: "custom",
            labels: {
              gender: voice.gender || "female",
              source: "model_custom",
              default: voice.isDefault ? "true" : "false",
            },
            languages: ["en", "sk", "cs"],
            originalPreviewUrl: previewUrl,
            previewUrls: {
              en: previewUrl,
              sk: previewUrl,
              cs: previewUrl,
            },
            isModelCustom: true,
            isDefaultModelVoice: Boolean(voice.isDefault),
            modelVoiceRecordId: voice.id,
          };
        });
        voices = [...customVoices, ...voices];
      } else if (model) {
        const legacyModel = await prisma.savedModel.findFirst({
          where: { id: modelId, userId },
          select: {
            elevenLabsVoiceId: true,
            elevenLabsVoiceType: true,
            modelVoicePreviewUrl: true,
            elevenLabsVoiceName: true,
            name: true,
          },
        });
        if (legacyModel?.elevenLabsVoiceId) {
          const previewUrl = legacyModel.modelVoicePreviewUrl || "";
          const modelName = legacyModel.name || "My model";
          const displayName = legacyModel.elevenLabsVoiceName || `${modelName}'s voice`;
          const custom = {
            id: legacyModel.elevenLabsVoiceId,
            name: displayName,
            modelName,
            voiceType: legacyModel.elevenLabsVoiceType || "design",
            category: "custom",
            labels: { gender: "female", source: "model_custom" },
            languages: ["en", "sk", "cs"],
            originalPreviewUrl: previewUrl,
            previewUrls: {
              en: previewUrl,
              sk: previewUrl,
              cs: previewUrl,
            },
            isModelCustom: true,
          };
          voices = [custom, ...voices];
        }
      }
    }

    res.json({
      success: true,
      voices,
    });
  } catch (error) {
    console.error("❌ Get voices error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch voices. Please try again.",
    });
  }
}

/**
 * Generate voice preview in specified language
 * Uses caching - first request generates and stores, subsequent requests serve from cache
 */
export async function getVoicePreview(req, res) {
  try {
    const { voiceId } = req.params;
    const { language = "en" } = req.query;
    
    if (!voiceId) {
      return res.status(400).json({
        success: false,
        message: "Voice ID is required",
      });
    }

    // Validate language
    const validLanguages = ["en", "sk", "cs"];
    const lang = validLanguages.includes(language) ? language : "en";

    console.log(`🔊 Preview request for voice ${voiceId} in ${lang}`);
    
    const { generateVoicePreview } = await import("../services/elevenlabs.service.js");
    const result = await generateVoicePreview(voiceId, lang);
    
    // If we have a cached URL, redirect to it
    if (result.cachedUrl) {
      console.log(`🔊 Redirecting to cached preview: ${result.cachedUrl}`);
      return res.redirect(result.cachedUrl);
    }
    
    // Otherwise return the buffer directly
    if (result.buffer) {
      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Length": result.buffer.length,
        "Cache-Control": "public, max-age=86400", // Cache for 24 hours
      });
      return res.send(result.buffer);
    }
    
    throw new Error("No audio data available");
  } catch (error) {
    console.error("❌ Voice preview error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate preview. Please try again.",
    });
  }
}

// ---------------------------------------------------------------------------
// CREATOR STUDIO — NanoBanana Pro
// No model required. Pass 0–8 reference photos; if none provided it falls
// back to text-to-image. Uses the same KIE callback path as all other tasks.
// ---------------------------------------------------------------------------

const CREATOR_STUDIO_ASPECT_RATIOS = [
  "1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2",
  "5:4", "4:5", "21:9",
];
const CREATOR_STUDIO_RESOLUTIONS = ["1K", "2K", "4K"];
const CREATOR_STUDIO_MODELS = ["nano-banana-pro"];
const CREATOR_STUDIO_VIDEO_FAMILIES = ["sora2", "kling26", "kling30", "veo31", "wan22", "seedance2"];

function normalizeCreatorStudioVideoMode(family, mode) {
  const fam = String(family || "").toLowerCase();
  const normalized = String(mode || "").toLowerCase();
  if (fam === "veo31") {
    if (normalized === "extend") return "extend";
    if (normalized === "t2v") return "t2v";
    if (normalized === "i2v") return "i2v";
    return "ref2v";
  }
  if (fam === "wan22") {
    if (normalized === "replace") return "replace";
    return "move";
  }
  if (fam === "seedance2") {
    if (normalized === "i2v") return "i2v";
    if (normalized === "edit") return "edit";
    if (normalized === "extend") return "extend";
    return "t2v";
  }
  if (fam === "sora2") return normalized === "i2v" ? "i2v" : "t2v";
  if (fam === "kling26") return normalized === "i2v" ? "i2v" : "t2v";
  if (fam === "kling30") return normalized === "i2v" ? "i2v" : "t2v";
  return "t2v";
}

function buildKlingPromptWithSound(prompt, soundEnabled, soundPrompt) {
  const base = String(prompt || "").trim();
  if (!soundEnabled) return base;
  const sound = String(soundPrompt || "").trim();
  if (!sound) return base;
  if (!base) return `sound prompt: ${sound}`;
  return `${base}, sound prompt: ${sound}`;
}

function estimateCreatorStudioVideoCredits(pricing, payload) {
  const family = String(payload.family || "").toLowerCase();
  const mode = normalizeCreatorStudioVideoMode(family, payload.mode);
  const duration = Number(payload.durationSeconds || 8);
  const seconds = Number.isFinite(duration) ? Math.max(1, duration) : 8;
  const speed = String(payload.speed || "fast").toLowerCase() === "quality" ? "quality" : "fast";
  const sound = payload.soundEnabled === true;
  if (family === "sora2") {
    const nFrames = String(payload.nFrames || "10") === "15" ? "15" : "10";
    const size = String(payload.size || "standard").toLowerCase() === "high" ? "high" : "standard";
    if (size === "high") return nFrames === "15" ? pricing.sora2High15Frames : pricing.sora2High10Frames;
    return nFrames === "15" ? pricing.sora2Standard15Frames : pricing.sora2Standard10Frames;
  }
  if (family === "kling26") {
    const bucket = seconds >= 10 ? "10s" : "5s";
    if (sound) return bucket === "10s" ? pricing.kling26Sound10s : pricing.kling26Sound5s;
    return bucket === "10s" ? pricing.kling26NoSound10s : pricing.kling26NoSound5s;
  }
  if (family === "kling30") {
    const quality = String(payload.kling30Quality || "std").toLowerCase() === "pro" ? "pro" : "std";
    const perSec = quality === "pro"
      ? (sound ? pricing.kling30ProSoundPerSec : pricing.kling30ProNoSoundPerSec)
      : (sound ? pricing.kling30StdSoundPerSec : pricing.kling30StdNoSoundPerSec);
    return Math.ceil(seconds * perSec);
  }
  if (family === "veo31") {
    if (mode === "extend") {
      return speed === "quality" ? pricing.veo31ExtendQuality : pricing.veo31ExtendFast;
    }
    return speed === "quality" ? pricing.veo31GenerateQuality1080p8s : pricing.veo31GenerateFast1080p8s;
  }
  if (family === "wan22") {
    const resolution = String(payload.wanResolution || "580p");
    const perSec = mode === "replace"
      ? pricing[`wan22AnimateReplace${resolution}PerSec`]
      : pricing[`wan22AnimateMove${resolution}PerSec`];
    return Math.ceil(seconds * (Number(perSec) || 0));
  }
  if (family === "seedance2") {
    const fast = String(payload.seedanceTaskType || "seedance-2-preview") === "seedance-2-fast-preview";
    const perSec = mode === "edit"
      ? (fast ? pricing.seedance2FastPreviewEditCreditsPerSec : pricing.seedance2PreviewEditCreditsPerSec)
      : (fast ? pricing.seedance2FastPreviewCreditsPerSec : pricing.seedance2PreviewCreditsPerSec);
    return Math.ceil(seconds * (Number(perSec) || 0));
  }
  return 0;
}

export async function generateCreatorStudio(req, res) {
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;

  try {
    const {
      prompt = "",
      referencePhotos = [],   // 0–8 public image URLs
      aspectRatio = "1:1",
      resolution = "1K",
      nanoBananaModel = "nano-banana-pro",
    } = req.body;

    userId = req.user.userId;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ success: false, message: "A prompt is required." });
    }
    if (!CREATOR_STUDIO_ASPECT_RATIOS.includes(aspectRatio)) {
      return res.status(400).json({ success: false, message: `Invalid aspect ratio.` });
    }
    if (!CREATOR_STUDIO_RESOLUTIONS.includes(resolution)) {
      return res.status(400).json({ success: false, message: `Invalid resolution.` });
    }
    const modelName = CREATOR_STUDIO_MODELS.includes(nanoBananaModel) ? nanoBananaModel : "nano-banana-pro";

    const refs = Array.isArray(referencePhotos)
      ? referencePhotos.filter((u) => typeof u === "string" && u.length > 0).slice(0, 8)
      : [];
    const refsCheck = await validateNanoBananaInputImages(refs);
    if (!refsCheck.valid) {
      return res.status(400).json({ success: false, message: refsCheck.message });
    }

    const pricing = await getGenerationPricing();
    const creditsNeeded = resolution === "4K" ? pricing.creatorStudio4K : pricing.creatorStudio1K2K;

    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits, you have ${totalCredits}.`,
      });
    }

    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    const generation = await prisma.generation.create({
      data: {
        userId,
        type: "creator-studio",
        prompt: prompt.trim(),
        inputImageUrl: refs.join(",") || null,
        status: "processing",
        creditsCost: creditsNeeded,
        replicateModel: `kie-${modelName}`,
        pipelinePayload: JSON.stringify({ aspectRatio, resolution, nanoBananaModel: modelName, refCount: refs.length }),
      },
    });
    generationId = generation.id;

    processCreatorStudioInBackground(
      generation.id,
      refs,
      prompt.trim(),
      userId,
      creditsNeeded,
      aspectRatio,
      resolution,
      modelName
    ).catch((err) => console.error("❌ Creator Studio background error:", err));

    return res.json({
      success: true,
      message: "Generating!",
      generation: {
        id: generation.id,
        type: "creator-studio",
        status: "processing",
        createdAt: generation.createdAt,
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: totalCredits - creditsNeeded,
    });
  } catch (error) {
    console.error("❌ Creator Studio generation error:", error);
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          await refundGeneration(generationId);
        } else {
          await refundCredits(userId, creditsDeducted);
        }
      } catch (refundErr) {
        console.error("❌ Creator Studio refund failed:", refundErr);
      }
    }
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
}

async function processCreatorStudioInBackground(
  generationId,
  refs,
  promptText,
  userId,
  creditsNeeded,
  aspectRatio,
  resolution,
  modelName
) {
  console.log(`\n🍌 [Creator Studio] gen=${generationId} refs=${refs.length} model=${modelName} ${aspectRatio} ${resolution}`);

  try {
    const onTaskCreated = async (taskId) => {
      await prisma.generation.update({
        where: { id: generationId },
        data: { replicateModel: `kie-task:${taskId}` },
      });
      await registerKieTaskForGeneration(taskId, generationId, userId, "creator-studio");
    };

    let result;

    if (refs.length === 0) {
      // Pure text-to-image — no identity references
      result = await requestQueue.enqueue(() =>
        generateTextToImageNanoBananaKie(promptText, {
          aspectRatio,
          resolution,
          model: modelName,
          onTaskCreated,
        })
      );
    } else {
      // Image-guided generation — upload refs so KIE can fetch them
      const kieImages = await Promise.all(
        refs.map((u, i) => ensureKieAccessibleUrl(u, `cs-ref-${i + 1}`))
      ).catch(() => refs);

      result = await requestQueue.enqueue(() =>
        generateImageWithNanoBananaKie(kieImages, promptText, {
          aspectRatio,
          resolution,
          model: modelName,
          onTaskCreated,
        })
      );
    }

    if (result.success && result.deferred && result.taskId) {
      await prisma.generation.update({
        where: { id: generationId },
        data: { replicateModel: `kie-task:${result.taskId}` },
      });
      console.log(`✅ [Creator Studio] Deferred; callback expected for task ${result.taskId}`);
    } else if (result.success && result.outputUrl) {
      await prisma.generation.update({
        where: { id: generationId },
        data: { status: "completed", outputUrl: result.outputUrl, completedAt: new Date() },
      });
      console.log(`✅ [Creator Studio] Completed inline: ${result.outputUrl}`);
    } else {
      throw new Error(result.error || "Unknown KIE failure");
    }
  } catch (error) {
    console.error(`❌ [Creator Studio] Background failed for ${generationId}:`, error.message);
    try {
      await prisma.generation.update({
        where: { id: generationId },
        data: { status: "failed", errorMessage: error.message },
      });
      await refundGeneration(generationId);
    } catch (dbErr) {
      console.error("❌ [Creator Studio] DB/refund error:", dbErr);
    }
  }
}

async function processCreatorStudioVideoInBackground({
  generationId,
  userId,
  family,
  mode,
  prompt,
  imageUrl,
  referenceImageUrl,
  endFrameUrl,
  thirdImageUrl,
  inputVideoUrl,
  durationSeconds,
  nFrames,
  size,
  soraQuality,
  removeWatermark,
  speed,
  soundEnabled,
  soundPrompt,
  kling30Quality,
  kling30MultiShot,
  klingElements,
  aspectRatio,
  seedanceTaskType,
  wanResolution,
  originalTaskId = null,
  originalGenerationId = null,
  veoSeeds = null,
  veoEnableTranslation = true,
  veoWatermark = "",
}) {
  const lowerFamily = String(family || "").toLowerCase();
  const normalizedMode = normalizeCreatorStudioVideoMode(lowerFamily, mode);
  try {
    const onTaskSubmitted = async (taskId) => {
      await persistKieGenerationCorrelation({
        taskId,
        generationId,
        userId,
        kind: "creator-studio-video",
        extraGenerationData: {
          provider: "kie",
          providerTaskId: taskId,
          providerFamily: lowerFamily,
          providerMode: normalizedMode,
          providerType: normalizedMode,
          parentTaskId: originalTaskId,
          originalGenerationId,
        },
      });
    };

    const finalPrompt = (lowerFamily === "kling26" || lowerFamily === "kling30")
      ? buildKlingPromptWithSound(prompt, soundEnabled, soundPrompt)
      : String(prompt || "");

    let result;
    if (lowerFamily === "sora2") {
      result = await requestQueue.enqueue(() =>
        generateVideoWithSora2ProKie({
          mode: normalizedMode,
          prompt: finalPrompt,
          imageUrl,
          nFrames: String(nFrames || "10"),
          size: String(size || "standard"),
          quality: String(soraQuality || "standard"),
          aspectRatio: String(aspectRatio || "landscape"),
          removeWatermark: removeWatermark === true,
          onTaskSubmitted,
        }),
      );
    } else if (lowerFamily === "kling26") {
      if (normalizedMode === "i2v") {
        result = await requestQueue.enqueue(() =>
          generateVideoWithKling26Kie(imageUrl, finalPrompt, {
            duration: String(durationSeconds || 5),
            useKling3: false,
            sound: !!soundEnabled,
            aspectRatio: String(aspectRatio || "1:1"),
            onTaskCreated: onTaskSubmitted,
          }),
        );
      } else {
        result = await requestQueue.enqueue(() =>
          generateVideoWithKlingTextKie(finalPrompt, {
            useKling3: false,
            duration: String(durationSeconds || 5),
            sound: !!soundEnabled,
            aspectRatio: String(aspectRatio || "1:1"),
            onTaskSubmitted,
          }),
        );
      }
    } else if (lowerFamily === "kling30") {
      if (normalizedMode === "i2v") {
        result = await requestQueue.enqueue(() =>
          generateVideoWithKling26Kie(imageUrl, finalPrompt, {
            duration: String(durationSeconds || 5),
            useKling3: true,
            sound: !!soundEnabled,
            aspectRatio: String(aspectRatio || "16:9"),
            mode: kling30Quality || "std",
            multiShots: !!kling30MultiShot,
            endFrameUrl: String(endFrameUrl || ""),
            klingElements: Array.isArray(klingElements) ? klingElements : [],
            onTaskCreated: onTaskSubmitted,
          }),
        );
      } else {
        result = await requestQueue.enqueue(() =>
          generateVideoWithKlingTextKie(finalPrompt, {
            useKling3: true,
            duration: String(durationSeconds || 5),
            sound: !!soundEnabled,
            aspectRatio: String(aspectRatio || "16:9"),
            quality: kling30Quality || "std",
            multiShots: !!kling30MultiShot,
            klingElements: Array.isArray(klingElements) ? klingElements : [],
            onTaskSubmitted,
          }),
        );
      }
    } else if (lowerFamily === "veo31") {
      if (normalizedMode === "extend") {
        result = await requestQueue.enqueue(() =>
          extendVideoWithVeo31Kie({
            originalTaskId,
            prompt: String(finalPrompt || ""),
            duration: String(durationSeconds || 8),
            speed: speed || "fast",
            onTaskSubmitted,
          }),
        );
      } else {
        const veoMode = normalizedMode === "t2v"
          ? "TEXT_2_VIDEO"
          : normalizedMode === "i2v"
            ? "FIRST_AND_LAST_FRAMES_2_VIDEO"
            : "REFERENCE_2_VIDEO";
        result = await requestQueue.enqueue(() =>
          generateVideoWithVeo31Kie({
            mode: veoMode,
            prompt: String(finalPrompt || ""),
            imageUrl,
            referenceImageUrl,
            endFrameUrl,
            thirdImageUrl,
            speed: speed || "fast",
            aspectRatio: String(aspectRatio || "16:9"),
            seeds: veoSeeds,
            enableTranslation: veoEnableTranslation !== false,
            watermark: veoWatermark || undefined,
            onTaskSubmitted,
          }),
        );
      }
    } else if (lowerFamily === "wan22") {
      result = await requestQueue.enqueue(() =>
        (normalizedMode === "replace"
          ? generateVideoWithWanAnimateReplaceKie(imageUrl, inputVideoUrl, {
              resolution: String(wanResolution || "580p"),
              onTaskSubmitted,
            })
          : generateVideoWithWanAnimateMoveKie(imageUrl, inputVideoUrl, {
              resolution: String(wanResolution || "580p"),
              onTaskSubmitted,
            })),
      );
    } else if (lowerFamily === "seedance2") {
      const submit = await requestQueue.enqueue(() =>
        submitPiApiTask({
          model: "seedance",
          task_type: String(seedanceTaskType || "seedance-2-preview"),
          input: {
            prompt: String(finalPrompt || ""),
            duration: Number(durationSeconds) || 5,
            aspect_ratio: String(aspectRatio || "16:9"),
            ...(imageUrl ? { image_urls: [String(imageUrl)] } : {}),
            ...(inputVideoUrl ? { video_urls: [String(inputVideoUrl)] } : {}),
            ...(normalizedMode === "extend" ? { parent_task_id: String(originalTaskId || "") } : {}),
          },
        }),
      );
      const taskId = submit?.data?.data?.task_id || submit?.data?.data?.taskId || submit?.data?.task_id || submit?.data?.taskId;
      if (!taskId) {
        throw new Error("Seedance task submission did not return task id.");
      }
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          provider: "piapi",
          replicateModel: `piapi-task:${taskId}`,
          providerTaskId: taskId,
          providerResponse: submit?.data || null,
        },
      });
      result = { success: true, deferred: true, taskId };
    } else {
      throw new Error(`Unsupported Creator Studio video family: ${lowerFamily}`);
    }

    if (result?.success && result?.deferred && result?.taskId) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          replicateModel: lowerFamily === "seedance2" ? `piapi-task:${result.taskId}` : `kie-task:${result.taskId}`,
          providerTaskId: result.taskId,
        },
      });
      return;
    }
    if (result?.success && result?.outputUrl) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          outputUrl: result.outputUrl,
          completedAt: new Date(),
          providerResponse: { outputUrl: result.outputUrl },
        },
      });
      return;
    }
    throw new Error(result?.error || "Unknown video generation error");
  } catch (error) {
    console.error(`❌ [Creator Studio video] Background failed for ${generationId}:`, error.message);
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "failed", errorMessage: getErrorMessageForDb(error.message || "Generation failed") },
    }).catch(() => {});
    await refundGeneration(generationId).catch(() => {});
  }
}

export async function generateCreatorStudioVideo(req, res) {
  let creditsDeducted = 0;
  let generationId = null;
  let userId = null;
  try {
    userId = req.user.userId;
    const {
      family = "kling30",
      mode = "t2v",
      prompt = "",
      imageUrl = "",
      referenceImageUrl = "",
      endFrameUrl = "",
      thirdImageUrl = "",
      inputVideoUrl = "",
      durationSeconds = 8,
      nFrames = "10",
      size = "standard",
      soraQuality = "standard",
      removeWatermark = false,
      speed = "fast",
      soundEnabled = false,
      soundPrompt = "",
      kling30Quality = "std",
      kling30MultiShot = false,
      klingElements = [],
      aspectRatio = "16:9",
      seedanceTaskType = "seedance-2-preview",
      wanResolution = "580p",
      originalTaskId = null,
      originalGenerationId = null,
      veoSeeds = null,
      veoEnableTranslation = true,
      veoWatermark = "",
    } = req.body || {};

    const lowerFamily = String(family || "").toLowerCase();
    if (!CREATOR_STUDIO_VIDEO_FAMILIES.includes(lowerFamily)) {
      return res.status(400).json({ success: false, message: "Unsupported video family." });
    }
    const normalizedMode = normalizeCreatorStudioVideoMode(lowerFamily, mode);
    if (!prompt?.trim()) {
      return res.status(400).json({ success: false, message: "A prompt is required." });
    }
    if ((lowerFamily === "sora2" || lowerFamily === "kling26" || lowerFamily === "kling30" || lowerFamily === "seedance2") && normalizedMode === "i2v" && !imageUrl) {
      return res.status(400).json({ success: false, message: "Image URL is required for image-to-video mode." });
    }
    if (lowerFamily === "veo31") {
      if (normalizedMode === "ref2v" && !referenceImageUrl && !imageUrl) {
        return res.status(400).json({ success: false, message: "Reference image is required for Veo reference mode." });
      }
      if (normalizedMode === "ref2v" && String(speed || "fast").toLowerCase() !== "fast") {
        return res.status(400).json({ success: false, message: "Veo REFERENCE_2_VIDEO currently supports only fast mode (veo3_fast)." });
      }
      if (normalizedMode === "i2v" && !imageUrl) {
        return res.status(400).json({ success: false, message: "Start frame image is required for Veo i2v." });
      }
      if (normalizedMode === "extend" && !originalTaskId) {
        return res.status(400).json({ success: false, message: "Original task id is required for Veo extend." });
      }
    }
    if (lowerFamily === "wan22") {
      if (!inputVideoUrl || !imageUrl) {
        return res.status(400).json({ success: false, message: "WAN mode requires both input video and image." });
      }
    }
    if (lowerFamily === "seedance2") {
      if (!["seedance-2-preview", "seedance-2-fast-preview"].includes(String(seedanceTaskType))) {
        return res.status(400).json({ success: false, message: "Invalid Seedance task type." });
      }
      if (normalizedMode === "edit" && !inputVideoUrl) {
        return res.status(400).json({ success: false, message: "Seedance video edit requires input video." });
      }
      if (normalizedMode === "extend" && !originalTaskId) {
        return res.status(400).json({ success: false, message: "Seedance extend requires original task id." });
      }
    }

    const pricing = await getGenerationPricing();
    const creditsNeeded = estimateCreatorStudioVideoCredits(pricing, {
      family: lowerFamily,
      mode: normalizedMode,
      durationSeconds,
      nFrames,
      size,
      speed,
      soundEnabled,
      kling30Quality,
      seedanceTaskType,
      wanResolution,
    });
    if (!Number.isFinite(creditsNeeded) || creditsNeeded <= 0) {
      return res.status(400).json({ success: false, message: "Could not calculate credits for this configuration." });
    }
    const user = await checkAndExpireCredits(userId);
    const totalCredits = getTotalCredits(user);
    if (totalCredits < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits, you have ${totalCredits}.`,
      });
    }
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    const generation = await prisma.generation.create({
      data: {
        userId,
        type: "creator-studio-video",
        prompt: String(prompt || "").trim(),
        duration: Number(durationSeconds) || null,
        inputImageUrl: imageUrl || referenceImageUrl || null,
        inputVideoUrl: inputVideoUrl || null,
        status: "processing",
        creditsCost: creditsNeeded,
        provider: lowerFamily === "seedance2" ? "piapi" : "kie",
        providerFamily: lowerFamily,
        providerMode: normalizedMode,
        providerType: normalizedMode,
        providerModel: `${lowerFamily === "seedance2" ? "piapi" : "kie"}-${lowerFamily}-${normalizedMode}`,
        parentTaskId: originalTaskId,
        originalGenerationId: originalGenerationId || null,
        replicateModel: `${lowerFamily === "seedance2" ? "piapi" : "kie"}-${lowerFamily}-${normalizedMode}`,
        extendEligible: (lowerFamily === "veo31" || lowerFamily === "seedance2") && normalizedMode !== "extend",
        providerRequest: {
          family: lowerFamily,
          mode: normalizedMode,
          imageUrl,
          referenceImageUrl,
          endFrameUrl,
          thirdImageUrl,
          inputVideoUrl,
          durationSeconds,
          nFrames,
          size,
          soraQuality,
          removeWatermark,
          speed,
          soundEnabled,
          soundPrompt,
          kling30Quality,
          kling30MultiShot,
          klingElements,
          aspectRatio,
          seedanceTaskType,
          wanResolution,
          originalTaskId,
          veoSeeds,
          veoEnableTranslation,
          veoWatermark,
        },
      },
    });
    generationId = generation.id;

    processCreatorStudioVideoInBackground({
      generationId: generation.id,
      userId,
      family: lowerFamily,
      mode: normalizedMode,
      prompt: String(prompt || "").trim(),
      imageUrl,
      referenceImageUrl,
      endFrameUrl,
      thirdImageUrl,
      inputVideoUrl,
      durationSeconds,
      nFrames,
      size,
      soraQuality,
      removeWatermark,
      speed,
      soundEnabled,
      soundPrompt,
      kling30Quality,
      kling30MultiShot,
      klingElements,
      aspectRatio,
      seedanceTaskType,
      wanResolution,
      originalTaskId,
      originalGenerationId,
      veoSeeds,
      veoEnableTranslation,
      veoWatermark,
    }).catch((err) => console.error("❌ Creator Studio video background error:", err));

    return res.json({
      success: true,
      message: "Video generation started!",
      generation: {
        id: generation.id,
        type: "creator-studio-video",
        status: "processing",
        createdAt: generation.createdAt,
      },
      creditsUsed: creditsNeeded,
      creditsRemaining: totalCredits - creditsNeeded,
    });
  } catch (error) {
    console.error("❌ Creator Studio video generation error:", error);
    if (creditsDeducted > 0 && userId) {
      try {
        if (generationId) {
          await refundGeneration(generationId);
        } else {
          await refundCredits(userId, creditsDeducted);
        }
      } catch (refundErr) {
        console.error("❌ Creator Studio video refund failed:", refundErr);
      }
    }
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
}

export async function extendCreatorStudioVideo(req, res) {
  const payload = { ...(req.body || {}), family: "veo31", mode: "extend" };
  req.body = payload;
  return generateCreatorStudioVideo(req, res);
}

export async function handlePiApiCallback(req, res) {
  try {
    const body = req.body || {};
    const data = body?.data || body;
    const taskId = data?.task_id || data?.taskId || body?.task_id || body?.taskId || body?.id;
    if (!taskId) return res.status(200).json({ success: true, ignored: "missing_task_id" });

    const generation = await prisma.generation.findFirst({
      where: { providerTaskId: String(taskId) },
      select: { id: true, status: true, creditsRefunded: true },
    });
    if (!generation) return res.status(200).json({ success: true, ignored: "generation_not_found" });

    const rawStatus = String(data?.status || body?.status || "").toLowerCase();
    const outputUrl =
      data?.output?.video ||
      data?.output?.video_url ||
      data?.output?.url ||
      body?.output?.video ||
      body?.outputUrl ||
      null;

    if (rawStatus.includes("completed") || outputUrl) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: "completed",
          outputUrl: outputUrl || undefined,
          completedAt: new Date(),
          providerResponse: body,
        },
      });
      return res.status(200).json({ success: true });
    }

    if (rawStatus.includes("failed")) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(data?.error?.message || body?.message || "PiAPI task failed"),
          providerResponse: body,
        },
      });
      if (!generation.creditsRefunded) {
        await refundGeneration(generation.id).catch(() => {});
      }
      return res.status(200).json({ success: true });
    }

    await prisma.generation.update({
      where: { id: generation.id },
      data: {
        status: "processing",
        providerResponse: body,
      },
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ PiAPI callback handling failed:", error);
    return res.status(200).json({ success: true });
  }
}
