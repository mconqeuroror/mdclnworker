/**
 * When a KIE image task completes via callback and the generation has pipelinePayload
 * (image -> video pipeline), run the video step and wire the generation to the video taskId.
 */
import prisma from "../lib/prisma.js";
import { generateVideoWithMotionKie } from "./kie.service.js";
import { ensureKieAccessibleUrl } from "../utils/kieUpload.js";
import { preprocessReferenceVideoForKling } from "./video.service.js";
import requestQueue from "./queue.service.js";
import { getErrorMessageForDb } from "../lib/userError.js";

async function registerKieTaskForGeneration(taskId, generationId, kind = "pipeline-video") {
  if (!taskId || !generationId) return;
  const gen = await prisma.generation.findUnique({
    where: { id: generationId },
    select: { userId: true },
  });
  await prisma.kieTask.upsert({
    where: { taskId },
    update: {
      entityType: "generation",
      entityId: generationId,
      step: "final",
      userId: gen?.userId || null,
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
      userId: gen?.userId || null,
      status: "processing",
      payload: { type: kind },
    },
  });
}

/**
 * Find generation by pipelinePayload.imageTaskId and run the video step.
 * @param {string} taskId - KIE image taskId that just completed
 * @param {string} imageUrl - result URL from callback (will be mirrored to R2 by callback before this)
 * @returns {Promise<boolean>} true if pipeline was found and continuation started
 */
export async function runPipelineContinuation(taskId, imageUrl) {
  if (!taskId || !imageUrl || !imageUrl.startsWith("http")) return false;

  const gen = await prisma.generation.findFirst({
    where: {
      pipelinePayload: { path: ["imageTaskId"], equals: taskId },
    },
    select: { id: true, pipelinePayload: true },
  });

  if (!gen?.pipelinePayload || typeof gen.pipelinePayload !== "object") return false;
  const payload = gen.pipelinePayload;
  const kind = payload.kind;

  if (kind === "quick_video") {
    return runQuickVideoContinuation(gen.id, payload, imageUrl);
  }
  if (kind === "complete_recreation") {
    return runCompleteRecreationContinuation(gen.id, payload, imageUrl);
  }
  return false;
}

async function runQuickVideoContinuation(generationId, payload, imageUrl) {
  const { referenceVideoUrl, referenceVideoUrlKie, modelId, ultra } = payload;
  if (!referenceVideoUrl || !modelId) {
    console.warn("[KIE Pipeline] quick_video missing referenceVideoUrl or modelId");
    return false;
  }

  const model = await prisma.savedModel.findUnique({
    where: { id: modelId },
    select: { photo1Url: true, photo2Url: true, photo3Url: true },
  });
  if (!model) {
    console.warn("[KIE Pipeline] quick_video model not found:", modelId);
    return false;
  }

  try {
    // Use pre-uploaded Blob URL from submission when present so callback doesn't re-upload
    const kieVideoUrl = referenceVideoUrlKie && referenceVideoUrlKie.startsWith("http")
      ? referenceVideoUrlKie
      : await ensureKieAccessibleUrl(
          await preprocessReferenceVideoForKling(referenceVideoUrl).catch(() => referenceVideoUrl),
          "reference video"
        );
    const kieImageUrl = await ensureKieAccessibleUrl(imageUrl, "generated image");

    const videoResult = await requestQueue.enqueue(() =>
      generateVideoWithMotionKie(kieImageUrl, kieVideoUrl, {
        ultra: !!ultra,
        onTaskSubmitted: async (videoTaskId) => {
          await prisma.generation.update({
            where: { id: generationId },
            data: {
              replicateModel: `kie-task:${videoTaskId}`,
              pipelinePayload: { ...payload, videoTaskId },
            },
          });
          await registerKieTaskForGeneration(videoTaskId, generationId, "quick-video");
        },
      })
    );

    if (videoResult?.success && videoResult?.deferred) {
      if (videoResult.taskId) {
        await registerKieTaskForGeneration(videoResult.taskId, generationId, "quick-video");
      }
      console.log("[KIE Pipeline] quick_video video step submitted for gen %s [%s]", generationId, ultra ? "pro" : "std");
      return true;
    }
    if (videoResult?.success && videoResult?.outputUrl) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "completed",
          outputUrl: videoResult.outputUrl,
          completedAt: new Date(),
          pipelinePayload: null,
        },
      });
      return true;
    }
    throw new Error(videoResult?.error || "Video step failed");
  } catch (err) {
    console.error("[KIE Pipeline] quick_video continuation error:", err?.message);
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "failed", errorMessage: getErrorMessageForDb(err?.message || "Pipeline video step failed"), pipelinePayload: null },
    }).catch(() => {});
    const { refundGeneration } = await import("../services/credit.service.js");
    await refundGeneration(generationId).catch(() => {});
    return true; // we handled it
  }
}

async function runCompleteRecreationContinuation(generationId, payload, imageUrl) {
  const { originalVideoUrl, originalVideoUrlKie, videoPrompt, ultra, imageGenId } = payload;
  if (!originalVideoUrl && !originalVideoUrlKie) {
    console.warn("[KIE Pipeline] complete_recreation missing originalVideoUrl");
    return false;
  }

  if (imageGenId) {
    await prisma.generation.update({
      where: { id: imageGenId },
      data: { status: "completed", outputUrl: imageUrl, completedAt: new Date() },
    }).catch(() => {});
  }

  try {
    // Use pre-uploaded Blob URL when present; otherwise preprocess + ensure
    const videoForPreprocess = originalVideoUrlKie && originalVideoUrlKie.startsWith("http")
      ? originalVideoUrlKie
      : originalVideoUrl;
    const preprocessed = await preprocessReferenceVideoForKling(videoForPreprocess).catch(() => videoForPreprocess);
    const kieVideoUrl = await ensureKieAccessibleUrl(preprocessed, "reference video");
    const kieImageUrl = await ensureKieAccessibleUrl(imageUrl, "generated image");

    const videoResult = await requestQueue.enqueue(() =>
      generateVideoWithMotionKie(kieImageUrl, kieVideoUrl, {
        videoPrompt: videoPrompt || "",
        ultra: !!ultra,
        onTaskSubmitted: async (videoTaskId) => {
          await prisma.generation.update({
            where: { id: generationId },
            data: {
              replicateModel: `kie-task:${videoTaskId}`,
              pipelinePayload: { ...payload, videoTaskId },
            },
          });
          await registerKieTaskForGeneration(videoTaskId, generationId, "complete-recreation-video");
        },
      })
    );

    if (videoResult?.success && videoResult?.deferred) {
      if (videoResult.taskId) {
        await registerKieTaskForGeneration(videoResult.taskId, generationId, "complete-recreation-video");
      }
      console.log("[KIE Pipeline] complete_recreation video step submitted for gen", generationId);
      return true;
    }
    if (videoResult?.success && videoResult?.outputUrl) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          outputUrl: videoResult.outputUrl,
          status: "completed",
          completedAt: new Date(),
          pipelinePayload: null,
        },
      });
      if (imageGenId) {
        await prisma.generation.update({
          where: { id: imageGenId },
          data: { status: "completed", outputUrl: imageUrl, completedAt: new Date() },
        }).catch(() => {});
      }
      return true;
    }
    throw new Error(videoResult?.error || "Video step failed");
  } catch (err) {
    console.error("[KIE Pipeline] complete_recreation continuation error:", err?.message);
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "failed", errorMessage: getErrorMessageForDb(err?.message || "Pipeline video step failed"), pipelinePayload: null },
    }).catch(() => {});
    const { refundGeneration } = await import("../services/credit.service.js");
    await refundGeneration(generationId).catch(() => {});
    return true;
  }
}
