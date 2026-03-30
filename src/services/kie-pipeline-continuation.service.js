/**
 * When a KIE image task completes via callback and the generation has pipelinePayload
 * (image -> video pipeline), run the video step and wire the generation to the video taskId.
 */
import prisma from "../lib/prisma.js";
import {
  generateVideoWithMotionKie,
  generateVideoWithWanAnimateMoveKie,
} from "./kie.service.js";
import { ensureKieAccessibleUrl } from "../utils/kieUpload.js";
import { preprocessReferenceVideoForKling } from "./video.service.js";
import requestQueue from "./queue.service.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import { persistKieGenerationCorrelation } from "../utils/kieTaskCorrelation.js";
import {
  RECREATE_ENGINE,
  normalizeRecreateEngine,
  normalizeWanResolution,
} from "../config/kie-video-catalog.js";

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
      onTaskSubmitted,
    });
  }
  return generateVideoWithMotionKie(imageUrl, referenceVideoUrl, {
    ultra: !!recreateUltra,
    videoPrompt,
    onTaskSubmitted,
  });
}

async function runQuickVideoContinuation(generationId, payload, imageUrl) {
  const {
    referenceVideoUrl,
    referenceVideoUrlKie,
    ultra,
    recreateEngine = RECREATE_ENGINE.KLING,
    wanResolution = "580p",
  } = payload;
  if (!referenceVideoUrl) {
    console.warn("[KIE Pipeline] quick_video missing referenceVideoUrl");
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
      submitRecreateVideoTask({
        imageUrl: kieImageUrl,
        referenceVideoUrl: kieVideoUrl,
        recreateEngine,
        recreateUltra: !!ultra,
        wanResolution,
        onTaskSubmitted: async (videoTaskId) => {
          await persistKieGenerationCorrelation({
            taskId: videoTaskId,
            generationId,
            kind: "quick-video",
            extraGenerationData: {
              pipelinePayload: { ...payload, videoTaskId },
            },
          });
        },
      })
    );

    if (videoResult?.success && videoResult?.deferred) {
      if (videoResult.taskId) {
        await persistKieGenerationCorrelation({
          taskId: videoResult.taskId,
          generationId,
          kind: "quick-video",
          extraGenerationData: {
            pipelinePayload: { ...payload, videoTaskId: videoResult.taskId },
          },
        });
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
  const {
    originalVideoUrl,
    originalVideoUrlKie,
    videoPrompt,
    ultra,
    imageGenId,
    recreateEngine = RECREATE_ENGINE.KLING,
    wanResolution = "580p",
  } = payload;
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
      submitRecreateVideoTask({
        imageUrl: kieImageUrl,
        referenceVideoUrl: kieVideoUrl,
        recreateEngine,
        recreateUltra: !!ultra,
        wanResolution,
        videoPrompt: videoPrompt || "",
        onTaskSubmitted: async (videoTaskId) => {
          await persistKieGenerationCorrelation({
            taskId: videoTaskId,
            generationId,
            kind: "complete-recreation-video",
            extraGenerationData: {
              pipelinePayload: { ...payload, videoTaskId },
            },
          });
        },
      })
    );

    if (videoResult?.success && videoResult?.deferred) {
      if (videoResult.taskId) {
        await persistKieGenerationCorrelation({
          taskId: videoResult.taskId,
          generationId,
          kind: "complete-recreation-video",
          extraGenerationData: {
            pipelinePayload: { ...payload, videoTaskId: videoResult.taskId },
          },
        });
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
