import prisma from "../lib/prisma.js";
import { isR2Configured } from "../utils/r2.js";
import { uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import { getUserFriendlyGenerationError } from "../utils/generationErrorMessages.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import { enqueueCleanupOldGenerations } from "../controllers/generation.controller.js";
import { refundGeneration } from "../services/credit.service.js";
import { pollUpscalerJob, extractUpscalerImage } from "./upscaler.service.js";
import { pollModelCloneXJob, extractModelCloneXImages } from "./modelcloneX.service.js";
import http from "http";
const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_URL = "https://api.wavespeed.ai/api/v3";

/**
 * Background service that continuously polls pending generations
 * and updates their status in the database
 */
class GenerationPollerService {
  constructor() {
    this.isRunning = false;
    this.pollInterval = 5000; // Poll every 5 seconds
    this.activePollers = new Map(); // Track active polling promises
    this.failureCounts = new Map(); // Track consecutive 400/error counts per generation
    this.runningSince = new Map(); // Track when provider confirms a job is actually running
    this.MAX_CONSECUTIVE_FAILURES = 20; // After 20 consecutive poll failures (~100s), mark as failed
    this.REQUEST_TIMEOUT_MS = 15000;
  }

  /**
   * Start the background poller
   */
  start() {
    if (this.isRunning) {
      console.log("⚠️  Generation poller already running");
      return;
    }

    this.isRunning = true;
    console.log("🚀 Starting generation poller service...");
    this.poll();

    const PORT = process.env.PORT || 5000;
    this.selfPingInterval = setInterval(() => {
      http.get(`http://localhost:${PORT}/health`, (res) => {
        res.resume();
      }).on('error', () => {});
    }, 10000);
  }

  /**
   * Stop the background poller
   */
  stop() {
    this.isRunning = false;
    if (this.selfPingInterval) {
      clearInterval(this.selfPingInterval);
      this.selfPingInterval = null;
    }
    console.log("🛑 Stopping generation poller service...");
  }

  /**
   * Main polling loop - runs continuously
   */
  async poll() {
    while (this.isRunning) {
      try {
        await this.checkPendingGenerations();
      } catch (error) {
        console.error("❌ Error in generation poller:", error);
      }

      // Wait before next poll
      await this.sleep(this.pollInterval);
    }
  }

  /**
   * Check all pending generations and update their status
   */
  async checkPendingGenerations() {
    // Always reconcile stale KIE generations, even when there are no WaveSpeed-pollable rows.
    // Some KIE generation types are intentionally excluded from WaveSpeed polling, and if
    // their callback is missed they would otherwise stay stuck in "processing" forever.
    await this.reconcileStaleKieGenerations();
    await this.reconcileStalePiapiGenerations();
    await this.reconcileStaleWavespeedSeedreamGenerations();
    await this.reconcileStaleRunpodGenerations();

    // Find all processing generations
    // Exclude talking-head type - it uses inline polling in the background process
    // Exclude nsfw type - it uses RunComfy polling in nsfw.controller.js
    const pendingGenerations = await prisma.generation.findMany({
      where: {
        status: "processing",
        type: {
          notIn: [
            "talking-head",
            "nsfw",
            "nsfw-video",
            "nsfw-video-extend",
            "prompt-image",
            "prompt-video",
            "image-identity",
            "motion-transfer",
            "complete-recreation",
            "face-swap",
            "advanced-image",
            "upscale",
            "modelclone-x",
            "soulx",
          ],
        },
      },
      select: {
        id: true,
        replicateModel: true, // This stores the WaveSpeed request ID
        createdAt: true,
      },
    });

    if (pendingGenerations.length === 0) {
      return;
    }

    const wavespeedOnly = pendingGenerations.filter((gen) => {
      if (gen.replicateModel && gen.replicateModel.startsWith("kie-")) return false;
      if (gen.replicateModel && gen.replicateModel.startsWith("piapi-")) return false; // handled via PiAPI callback
      if (gen.replicateModel && gen.replicateModel.startsWith("piapi-task:")) return false; // handled via PiAPI callback
      if (gen.replicateModel && gen.replicateModel.startsWith("wavespeed-seedream:")) return false; // completed via WaveSpeed webhook
      return true;
    });

    if (wavespeedOnly.length === 0) {
      return;
    }

    console.log(
      `🔍 Polling ${wavespeedOnly.length} pending generation(s)...`,
    );

    // Poll each generation (in parallel for efficiency)
    const promises = wavespeedOnly.map((gen) =>
      this.pollGeneration(gen.id, gen.replicateModel, gen.createdAt),
    );

    await Promise.allSettled(promises);
  }

  /**
   * Poll a single generation and update its status
   */
  async pollGeneration(generationId, requestId, createdAt) {
    // Skip if we're already polling this generation
    if (this.activePollers.has(generationId)) {
      return;
    }

    this.activePollers.set(generationId, true);

    const TIMEOUT_SECONDS = 90 * 60; // 90 minutes max for any generation
    const QUEUED_STATES = new Set(["queued", "pending", "waiting", "submitted", "created", "starting"]);
    const RUNNING_STATES = new Set(["processing", "running", "in_progress", "in-progress"]);

    try {
      const ageInSeconds = createdAt
        ? (Date.now() - new Date(createdAt).getTime()) / 1000
        : null;

      if (!requestId) {
        // Grace period: don't mark as failed if generation is younger than 30 seconds
        // This prevents race condition where polling runs before requestId is saved to DB
        if (ageInSeconds !== null && ageInSeconds < 30) {
          console.log(
            `⏳ Generation ${generationId} has no request ID yet, but is only ${ageInSeconds.toFixed(1)}s old - will retry`,
          );
          return; // Don't mark as failed, will retry on next poll
        }

        console.log(
          `⚠️  Generation ${generationId} has no request ID after ${(ageInSeconds || 0).toFixed(1)}s, marking as failed`,
        );
        await this.markFailed(generationId, "No WaveSpeed request ID found", { refund: true });
        return;
      }

      // Poll WaveSpeed API
      const pollUrl = `${WAVESPEED_API_URL}/predictions/${requestId}/result`;

      const response = await this.fetchWithTimeout(
        pollUrl,
        {
          headers: {
            Authorization: `Bearer ${WAVESPEED_API_KEY}`,
          },
        },
        this.REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        if (response.status === 429) {
        }
        // Provider 5xx = confirmed provider-side server failure => fail + immediate refund
        if (response.status >= 500) {
          console.error(
            `❌ Generation ${generationId} provider server failure (HTTP ${response.status}), refunding immediately`,
          );
          this.failureCounts.delete(generationId);
          this.runningSince.delete(generationId);
          await this.markFailed(generationId, `WaveSpeed provider server error (${response.status})`, { refund: true });
          return;
        }

        const prevCount = this.failureCounts.get(generationId) || 0;
        const newCount = prevCount + 1;
        this.failureCounts.set(generationId, newCount);

        if (newCount >= this.MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `❌ Generation ${generationId} failed ${newCount} consecutive polls (HTTP ${response.status}), marking as failed`,
          );
          this.failureCounts.delete(generationId);
          this.runningSince.delete(generationId);
          await this.markFailed(
            generationId,
            `WaveSpeed API returned ${response.status} for ${newCount} consecutive polls`,
            { refund: true },
          );
          return;
        }

        if (newCount === 1 || newCount % 5 === 0) {
          console.error(
            `❌ Failed to poll generation ${generationId}: ${response.status} (attempt ${newCount}/${this.MAX_CONSECUTIVE_FAILURES})`,
          );
        }
        return;
      }

      this.failureCounts.delete(generationId);

      const result = await response.json();
      const actualData = result.data || result;
      const status = actualData.status;
      const normalizedStatus = String(status || "").toLowerCase();
      const outputs = actualData.outputs || [];

      // Check if completed
      if (outputs && outputs.length > 0) {
        this.runningSince.delete(generationId);
        await this.markCompleted(generationId, outputs[0]);
        return;
      }

      // Check status for completion
      if (
        status === "succeeded" ||
        status === "completed" ||
        status === "success" ||
        status === "finished"
      ) {
        const output =
          actualData.output ||
          actualData.result ||
          actualData.url ||
          outputs[0];
        if (output) {
          this.runningSince.delete(generationId);
          await this.markCompleted(generationId, output);
          return;
        }
      }

      // Check if failed
      if (status === "failed" || status === "error") {
        this.runningSince.delete(generationId);
        const rawMsg =
          actualData.error ||
          result.error ||
          result.message ||
          "Generation failed";
        const errorMsg = getUserFriendlyGenerationError(rawMsg);
        await this.markFailed(generationId, errorMsg, { refund: true });
        return;
      }

      // Dynamic timeout: only count timeout while provider reports RUNNING/PROCESSING.
      if (RUNNING_STATES.has(normalizedStatus)) {
        const runningStartedAt = this.runningSince.get(generationId) || Date.now();
        if (!this.runningSince.has(generationId)) {
          this.runningSince.set(generationId, runningStartedAt);
          console.log(`▶️ Generation ${generationId} entered RUNNING state — timeout clock started`);
        }

        const runningSeconds = (Date.now() - runningStartedAt) / 1000;
        if (runningSeconds > TIMEOUT_SECONDS) {
          console.log(
            `⏰ Generation ${generationId} timed out after ${Math.round(runningSeconds / 60)}min in RUNNING state, marking failed`,
          );
          this.runningSince.delete(generationId);
          await this.markFailed(generationId, "Generation timed out while in progress (90 min)", { refund: true });
          return;
        }
      } else if (QUEUED_STATES.has(normalizedStatus)) {
        // Explicitly keep timeout paused while queued.
        this.runningSince.delete(generationId);
      }

      // Still processing - do nothing, will check again on next poll
    } catch (error) {
      const prevCount = this.failureCounts.get(generationId) || 0;
      const newCount = prevCount + 1;
      this.failureCounts.set(generationId, newCount);

      if (newCount >= this.MAX_CONSECUTIVE_FAILURES) {
        console.error(
          `❌ Generation ${generationId} errored ${newCount} consecutive times: ${error.message}, marking as failed`,
        );
        this.failureCounts.delete(generationId);
        this.runningSince.delete(generationId);
        await this.markFailed(
          generationId,
          `Polling error after ${newCount} attempts: ${error.message}`,
          { refund: true },
        ).catch(() => {});
      } else if (newCount === 1 || newCount % 5 === 0) {
        console.error(
          `❌ Error polling generation ${generationId} (attempt ${newCount}/${this.MAX_CONSECUTIVE_FAILURES}):`,
          error.message,
        );
      }
    } finally {
      this.activePollers.delete(generationId);
    }
  }

  /**
   * Mark generation as completed
   * Downloads output from WaveSpeed and uploads to R2 for permanent storage
   */
  async markCompleted(generationId, outputUrl) {
    console.log(`✅ Generation ${generationId} completed: ${outputUrl}`);

    let finalUrl = outputUrl;

    // Try to save to R2 for permanent storage (WaveSpeed deletes after 7 days)
    if (isR2Configured()) {
      try {
        const r2Url = await this.downloadAndUploadToR2(outputUrl, generationId);
        if (r2Url) {
          finalUrl = r2Url;
          console.log(`📦 Saved to R2: ${r2Url}`);
        }
      } catch (error) {
        console.error(`⚠️ Failed to save to R2, using WaveSpeed URL: ${error.message}`);
        // Keep original WaveSpeed URL as fallback
      }
    }

    const updatedGen = await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "completed",
        outputUrl: finalUrl,
        completedAt: new Date(),
      },
      select: { userId: true, modelId: true },
    });

    if (updatedGen.userId && updatedGen.modelId) {
      enqueueCleanupOldGenerations(updatedGen.userId, updatedGen.modelId);
    }
  }

  /**
   * Download output from WaveSpeed and upload to R2
   */
  async downloadAndUploadToR2(sourceUrl, generationId) {
    // Download from WaveSpeed
    const response = await this.fetchWithTimeout(sourceUrl, {}, this.REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";
    
    // Determine extension from content type, with URL fallback
    let extension = "png";
    if (contentType.includes("video/mp4") || contentType.includes("video/mpeg")) {
      extension = "mp4";
    } else if (contentType.includes("video/webm")) {
      extension = "webm";
    } else if (contentType.includes("video/")) {
      extension = "mp4";
    } else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      extension = "jpg";
    } else if (contentType.includes("webp")) {
      extension = "webp";
    } else if (sourceUrl.match(/\.mp4(\?|$)/i)) {
      extension = "mp4";
    } else if (sourceUrl.match(/\.webm(\?|$)/i)) {
      extension = "webm";
    }

    // Ensure correct content type for video files
    const finalContentType = (extension === "mp4" || extension === "webm")
      ? (extension === "mp4" ? "video/mp4" : "video/webm")
      : contentType;

    // Upload to R2 in "generations" folder
    const r2Url = await uploadBufferToBlobOrR2(buffer, "generations", extension, finalContentType);
    return r2Url;
  }

  /**
   * Mark generation as failed and refund credits (if any were charged)
   */
  async markFailed(generationId, errorMessage, { refund = false } = {}) {
    console.log(`❌ Generation ${generationId} failed: ${errorMessage}`);

    // Refund FIRST — before DB update — so credits are never lost even if DB update fails
    if (refund) {
      try {
        const refunded = await refundGeneration(generationId);
        if (refunded > 0) {
          console.log(`💰 Refunded ${refunded} credits for failed generation ${generationId}`);
        }
      } catch (refundErr) {
        console.error(`🚨 CRITICAL: Refund FAILED for generation ${generationId}: ${refundErr.message}. Manual recovery needed.`);
      }
    }

    try {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(errorMessage),
          completedAt: new Date(),
        },
      });
    } catch (dbErr) {
      console.error(`⚠️ Failed to update generation ${generationId} status to failed: ${dbErr.message}`);
    }
  }

  /**
   * Reconcile KIE-backed generations that are stuck in "processing".
   * KIE tasks run in detached background functions — if the Vercel instance
   * that started them gets recycled the generation never gets updated.
   * This watchdog checks KIE directly and marks them completed or failed.
   * We check (1) any generation with kie-task: that is at least 2 min old (so taskId was stored),
   * and (2) generations with only model name that are 15+ min old (timeout only).
   */
  async reconcileStaleKieGenerations() {
    const KIE_API_KEY = process.env.KIE_API_KEY;
    if (!KIE_API_KEY) return;

    const MIN_AGE_FOR_TASK_ID_MS = 2 * 60 * 1000;  // 2 min — allow onTaskSubmitted to run
    const IMAGE_STALE_MS = 15 * 60 * 1000;
    const VIDEO_STALE_MS = 50 * 60 * 1000;
    const now = Date.now();

    // (1) Generations with stored taskId: check every poll (2+ min old so taskId is saved)
    const withTaskId = await prisma.generation.findMany({
      where: {
        status: "processing",
        replicateModel: { startsWith: "kie-task:" },
        createdAt: { lt: new Date(now - MIN_AGE_FOR_TASK_ID_MS) },
      },
      select: { id: true, type: true, replicateModel: true, createdAt: true, creditsCost: true },
      take: 50,
    });

    // (2) Generations with only model name (no taskId), 15+ min old — timeout only
    const staleAllKie = await prisma.generation.findMany({
      where: {
        status: "processing",
        replicateModel: { startsWith: "kie-" },
        createdAt: { lt: new Date(now - IMAGE_STALE_MS) },
      },
      select: { id: true, type: true, replicateModel: true, createdAt: true, creditsCost: true },
      take: 30,
    });
    const staleNoTaskId = staleAllKie.filter((g) => !g.replicateModel?.startsWith("kie-task:"));

    const staleKieGens = [...withTaskId, ...staleNoTaskId];
    if (staleKieGens.length === 0) return;

    if (withTaskId.length > 0) {
      console.log(`[KIE Watchdog] Checking ${withTaskId.length} KIE task(s) with taskId + ${staleNoTaskId.length} stale (no taskId)...`);
    }

    for (const gen of staleKieGens) {
      const ageMs = now - new Date(gen.createdAt).getTime();
      const isVideo = gen.type && (gen.type.includes("video") || gen.type === "motion-transfer");
      const staleThreshold = isVideo ? VIDEO_STALE_MS : IMAGE_STALE_MS;

      // Extract taskId from replicateModel field (stored as "kie-task:<taskId>")
      // If it's a plain model name like "kie-kling-2.6-motion-control" the task ID
      // was never persisted — we can only time-out these, not recover them.
      const isTaskId = gen.replicateModel?.startsWith("kie-task:");
      const taskId = isTaskId ? gen.replicateModel.replace(/^kie-task:/, "").trim() : null;

      // For generations without taskId, only act once they're past stale threshold
      if (!taskId && ageMs < staleThreshold) continue;

      if (!taskId) {
        // No recoverable task ID — apply hard timeout only
        const hardTimeout = isVideo ? 75 * 60 * 1000 : 25 * 60 * 1000;
        if (ageMs > hardTimeout) {
          await prisma.generation.update({
            where: { id: gen.id },
            data: { status: "failed", errorMessage: getErrorMessageForDb(`Generation timed out after ${Math.round(ageMs / 60000)} min (no task ID stored)`), completedAt: new Date() },
          });
          try { await refundGeneration(gen.id); } catch { /**/ }
          console.log(`[KIE Watchdog] ⏱ No-taskId timeout ${gen.id.slice(0, 8)} after ${Math.round(ageMs / 60000)} min`);
        }
        continue;
      }

      try {
        const kieRes = await this.fetchWithTimeout(
          `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
          { headers: { Authorization: `Bearer ${KIE_API_KEY}` } },
          15000,
        );
        if (!kieRes.ok) {
          console.warn(`[KIE Watchdog] ${gen.id.slice(0, 8)} HTTP ${kieRes.status} — skipping`);
          continue;
        }
        const kieJson = await kieRes.json();
        const data = kieJson?.data ?? kieJson;
        const state = String(data?.state || "").toLowerCase();

        const normState = String(state || "").toLowerCase();
        const isSuccessState = ["success", "succeeded", "completed", "finished", "done"].includes(normState);
        const isFailedState = ["fail", "failed", "error", "cancelled", "canceled"].includes(normState);
        const isRunningState = ["waiting", "queuing", "queued", "generating", "processing", "running", "pending", "submitted", "created", "starting"].includes(normState);

        if (isSuccessState) {
          // Extract output URL
          let outputUrl = null;
          try {
            const rj = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
            outputUrl = rj?.resultUrls?.[0] || rj?.result_urls?.[0] || rj?.url;
            if (!outputUrl && Array.isArray(rj)) outputUrl = rj[0];
            if (!outputUrl && typeof rj === "string" && rj.startsWith("http")) outputUrl = rj;
          } catch { /**/ }
          outputUrl = outputUrl || data.resultUrl || data.outputUrl || data.url;

          if (outputUrl) {
            // Try to archive to R2
            let finalUrl = outputUrl;
            if (isR2Configured()) {
              try {
                const dlRes = await this.fetchWithTimeout(outputUrl, {}, 60000);
                if (dlRes.ok) {
                  const buf = Buffer.from(await dlRes.arrayBuffer());
                  const ct = dlRes.headers.get("content-type") || "image/png";
                  const ext = outputUrl.match(/\.(mp4|webm|jpg|jpeg|webp|png)(\?|$)/i)?.[1]?.toLowerCase() || "jpg";
                  finalUrl = await uploadBufferToBlobOrR2(buf, "generations", ext, ct);
                }
              } catch (e) {
                console.warn(`[KIE Watchdog] R2 archive failed for ${gen.id.slice(0, 8)}: ${e.message}`);
              }
            }
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "completed", outputUrl: finalUrl, completedAt: new Date() },
            });
            console.log(`[KIE Watchdog] ✅ Recovered ${gen.id.slice(0, 8)} → ${finalUrl.slice(0, 80)}`);
          } else {
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb("Generation succeeded but returned no output URL"), completedAt: new Date() },
            });
          }
        } else if (isFailedState) {
          const failMsg = data.failMsg || data.failCode || "KIE generation failed";
          await prisma.generation.update({
            where: { id: gen.id },
            data: { status: "failed", errorMessage: getErrorMessageForDb(failMsg), completedAt: new Date() },
          });
          // Refund credits
          try { await refundGeneration(gen.id); } catch { /**/ }
          console.log(`[KIE Watchdog] ❌ Marked failed ${gen.id.slice(0, 8)}: ${failMsg}`);
        } else if (isRunningState) {
          // Still running — only fail if way past max timeout
          const hardTimeout = isVideo ? 75 * 60 * 1000 : 25 * 60 * 1000;
          if (ageMs > hardTimeout) {
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb(`Task timed out after ${Math.round(ageMs / 60000)} min (state: ${normState})`), completedAt: new Date() },
            });
            try { await refundGeneration(gen.id); } catch { /**/ }
            console.log(`[KIE Watchdog] ⏱ Hard-timeout ${gen.id.slice(0, 8)} after ${Math.round(ageMs / 60000)} min`);
          }
        } else {
          // Unknown state — apply hard timeout
          const hardTimeout = isVideo ? 75 * 60 * 1000 : 25 * 60 * 1000;
          if (ageMs > hardTimeout) {
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb(`Task unknown state "${state}" after ${Math.round(ageMs / 60000)} min`), completedAt: new Date() },
            });
            try { await refundGeneration(gen.id); } catch { /**/ }
          }
        }
      } catch (e) {
        console.warn(`[KIE Watchdog] Error checking ${gen.id.slice(0, 8)}: ${e.message}`);
      }
    }
  }

  /**
   * Reconcile WaveSpeed Seedream generations whose webhook was never delivered.
   * Rows with replicateModel "wavespeed-seedream:*" are excluded from the main
   * WaveSpeed poll loop (they rely on the webhook), so this is the only fallback.
   *
   * Polls GET /api/v3/predictions/{requestId}/result for each stuck gen.
   */
  async reconcileStaleWavespeedSeedreamGenerations() {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    if (!WAVESPEED_API_KEY) return;

    const MIN_AGE_MS = 3 * 60 * 1000;   // 3 min grace for webhook delivery
    const HARD_TIMEOUT_MS = 25 * 60 * 1000; // 25 min max for image tasks
    const now = Date.now();

    const stale = await prisma.generation.findMany({
      where: {
        status: "processing",
        replicateModel: { startsWith: "wavespeed-seedream:" },
        createdAt: { lt: new Date(now - MIN_AGE_MS) },
      },
      select: { id: true, replicateModel: true, createdAt: true, userId: true },
      take: 30,
      orderBy: { createdAt: "asc" },
    });

    if (stale.length === 0) return;
    console.log(`[WaveSpeed Seedream Watchdog] Checking ${stale.length} stuck task(s)…`);

    for (const gen of stale) {
      const ageMs = now - new Date(gen.createdAt).getTime();
      const taskId = gen.replicateModel.replace(/^wavespeed-seedream:/, "").trim();
      if (!taskId) continue;

      try {
        const res = await this.fetchWithTimeout(
          `https://api.wavespeed.ai/api/v3/predictions/${encodeURIComponent(taskId)}/result`,
          { headers: { Authorization: `Bearer ${WAVESPEED_API_KEY}` } },
          20_000,
        );

        if (!res.ok) {
          if (ageMs > HARD_TIMEOUT_MS) {
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb(`WaveSpeed task timed out after ${Math.round(ageMs / 60000)} min (HTTP ${res.status})`), completedAt: new Date() },
            });
            try { await refundGeneration(gen.id); } catch { /**/ }
            console.log(`[WaveSpeed Seedream Watchdog] ⏱ Timeout ${gen.id.slice(0, 8)} (HTTP ${res.status})`);
          } else {
            console.warn(`[WaveSpeed Seedream Watchdog] ${gen.id.slice(0, 8)} HTTP ${res.status} — skipping`);
          }
          continue;
        }

        const json = await res.json();
        const data = json?.data ?? json;
        const status = String(data?.status || "").toLowerCase();
        const isCompleted = ["completed", "succeeded", "success", "finished"].includes(status);
        const isFailed = ["failed", "error", "cancelled", "canceled"].includes(status);

        if (isCompleted) {
          const outputs = data?.outputs;
          const rawUrl = Array.isArray(outputs) && outputs.length > 0
            ? (typeof outputs[0] === "string" ? outputs[0] : outputs[0]?.url)
            : null;
          const outputUrl = rawUrl && String(rawUrl).startsWith("http") ? String(rawUrl) : null;

          if (outputUrl) {
            let finalUrl = outputUrl;
            try {
              const { mirrorProviderOutputUrl } = await import("../utils/kieUpload.js");
              finalUrl = await mirrorProviderOutputUrl(outputUrl, "image/png");
            } catch (e) {
              console.warn(`[WaveSpeed Seedream Watchdog] Mirror failed ${gen.id.slice(0, 8)}: ${e.message}`);
            }
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "completed", outputUrl: finalUrl, completedAt: new Date() },
            });
            console.log(`[WaveSpeed Seedream Watchdog] ✅ Recovered ${gen.id.slice(0, 8)} → ${finalUrl.slice(0, 80)}`);
          } else {
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb("WaveSpeed task completed but returned no output URL"), completedAt: new Date() },
            });
            try { await refundGeneration(gen.id); } catch { /**/ }
            console.warn(`[WaveSpeed Seedream Watchdog] ⚠ Completed but no URL ${gen.id.slice(0, 8)}`);
          }
        } else if (isFailed) {
          const errMsg = data?.error || `WaveSpeed task ${status}`;
          await prisma.generation.update({
            where: { id: gen.id },
            data: { status: "failed", errorMessage: getErrorMessageForDb(String(errMsg)), completedAt: new Date() },
          });
          try { await refundGeneration(gen.id); } catch { /**/ }
          console.log(`[WaveSpeed Seedream Watchdog] ❌ Marked failed ${gen.id.slice(0, 8)}: ${errMsg}`);
        } else if (ageMs > HARD_TIMEOUT_MS) {
          await prisma.generation.update({
            where: { id: gen.id },
            data: { status: "failed", errorMessage: getErrorMessageForDb(`WaveSpeed task timed out after ${Math.round(ageMs / 60000)} min (state: ${status})`), completedAt: new Date() },
          });
          try { await refundGeneration(gen.id); } catch { /**/ }
          console.log(`[WaveSpeed Seedream Watchdog] ⏱ Timeout ${gen.id.slice(0, 8)} state=${status}`);
        }
        // still running → no-op
      } catch (e) {
        console.warn(`[WaveSpeed Seedream Watchdog] Error checking ${gen.id.slice(0, 8)}: ${e.message}`);
      }
    }
  }

  /**
   * Reconcile PiAPI (Seedance) generations whose webhook was never delivered.
   * Primary path is the PiAPI callback; this is the recovery path.
   *
   * Polls GET https://api.piapi.ai/api/v1/task/{taskId} for each stuck gen.
   */
  async reconcileStalePiapiGenerations() {
    const PIAPI_API_KEY = process.env.PIAPI_API_KEY;
    if (!PIAPI_API_KEY) return;

    const MIN_AGE_MS = 2 * 60 * 1000;   // 2 min grace before checking
    const HARD_TIMEOUT_MS = 75 * 60 * 1000; // 75 min max for video
    const now = Date.now();

    const stale = await prisma.generation.findMany({
      where: {
        status: "processing",
        replicateModel: { startsWith: "piapi-task:" },
        createdAt: { lt: new Date(now - MIN_AGE_MS) },
      },
      select: { id: true, replicateModel: true, createdAt: true, creditsCost: true },
      take: 30,
      orderBy: { createdAt: "asc" },
    });

    if (stale.length === 0) return;
    console.log(`[PiAPI Watchdog] Checking ${stale.length} stuck PiAPI task(s)…`);

    for (const gen of stale) {
      const ageMs = now - new Date(gen.createdAt).getTime();
      const taskId = gen.replicateModel.replace(/^piapi-task:/, "").trim();
      if (!taskId) continue;

      try {
        const res = await this.fetchWithTimeout(
          `https://api.piapi.ai/api/v1/task/${encodeURIComponent(taskId)}`,
          { headers: { "X-API-Key": PIAPI_API_KEY, "Content-Type": "application/json" } },
          20_000,
        );

        if (!res.ok) {
          if (ageMs > HARD_TIMEOUT_MS) {
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb(`PiAPI task timed out after ${Math.round(ageMs / 60000)} min (HTTP ${res.status})`), completedAt: new Date() },
            });
            try { await refundGeneration(gen.id); } catch { /**/ }
            console.log(`[PiAPI Watchdog] ⏱ Timeout ${gen.id.slice(0, 8)} (HTTP ${res.status})`);
          } else {
            console.warn(`[PiAPI Watchdog] ${gen.id.slice(0, 8)} HTTP ${res.status} — skipping`);
          }
          continue;
        }

        const json = await res.json();
        // PiAPI response: { code, data: { task_id, status, output, error } }
        const data = json?.data && typeof json.data === "object" ? json.data : json;
        const status = String(data?.status || "").toLowerCase();
        const isCompleted = ["completed", "success", "succeeded", "finished", "done"].includes(status);
        const isFailed = ["failed", "fail", "error", "cancelled", "canceled"].includes(status);

        if (isCompleted) {
          const out = data?.output || {};
          const asUrl = (v) => {
            if (!v) return null;
            if (typeof v === "string") return v.startsWith("http") ? v : null;
            if (typeof v === "object") {
              const c = v.url || v.video || v.video_url || v.result_url || null;
              return typeof c === "string" && c.startsWith("http") ? c : null;
            }
            return null;
          };
          const videoUrl = asUrl(out.video) || asUrl(out.url) || asUrl(out.video_url)
            || asUrl(out.result_url) || asUrl(out.result_video_url)
            || (Array.isArray(out.videos) ? asUrl(out.videos[0]) : null)
            || null;

          if (videoUrl) {
            let finalUrl = videoUrl;
            try {
              const { mirrorProviderOutputUrl } = await import("../utils/kieUpload.js");
              finalUrl = await mirrorProviderOutputUrl(videoUrl, "video/mp4");
            } catch (e) {
              console.warn(`[PiAPI Watchdog] Mirror failed for ${gen.id.slice(0, 8)}: ${e.message}`);
            }
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "completed", outputUrl: finalUrl, completedAt: new Date(), pipelinePayload: null },
            });
            console.log(`[PiAPI Watchdog] ✅ Recovered ${gen.id.slice(0, 8)} → ${finalUrl.slice(0, 80)}`);
          } else {
            await prisma.generation.update({
              where: { id: gen.id },
              data: { status: "failed", errorMessage: getErrorMessageForDb("PiAPI task completed but returned no output URL"), completedAt: new Date() },
            });
            try { await refundGeneration(gen.id); } catch { /**/ }
            console.warn(`[PiAPI Watchdog] ⚠ Completed but no URL ${gen.id.slice(0, 8)}`);
          }
        } else if (isFailed) {
          const errMsg = data?.error?.message || data?.error?.raw_message || `PiAPI task ${status}`;
          await prisma.generation.update({
            where: { id: gen.id },
            data: { status: "failed", errorMessage: getErrorMessageForDb(errMsg), completedAt: new Date() },
          });
          try { await refundGeneration(gen.id); } catch { /**/ }
          console.log(`[PiAPI Watchdog] ❌ Marked failed ${gen.id.slice(0, 8)}: ${errMsg}`);
        } else if (ageMs > HARD_TIMEOUT_MS) {
          await prisma.generation.update({
            where: { id: gen.id },
            data: { status: "failed", errorMessage: getErrorMessageForDb(`PiAPI task timed out after ${Math.round(ageMs / 60000)} min (state: ${status})`), completedAt: new Date() },
          });
          try { await refundGeneration(gen.id); } catch { /**/ }
          console.log(`[PiAPI Watchdog] ⏱ Timeout ${gen.id.slice(0, 8)} state=${status}`);
        }
        // still running → no-op
      } catch (e) {
        console.warn(`[PiAPI Watchdog] Error checking ${gen.id.slice(0, 8)}: ${e.message}`);
      }
    }
  }

  /**
   * Reconcile RunPod-backed generations that should be completed via callback.
   * Callback remains primary path; polling here is recovery for missed callbacks.
   */
  async reconcileStaleRunpodGenerations({
    limit = 30,
    includeTimedOutFailed = false,
  } = {}) {
    const RUNPOD_GRACE_MS = Number(process.env.RUNPOD_WATCHDOG_MIN_AGE_MS) || 30 * 60 * 1000;
    const FAILED_LOOKBACK_MS = 72 * 60 * 60 * 1000;
    const now = Date.now();
    const safeLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 30));

    const where = {
      type: { in: ["upscale", "modelclone-x", "soulx", "nsfw"] },
      OR: [
        {
          status: "processing",
          createdAt: { lt: new Date(now - RUNPOD_GRACE_MS) },
        },
      ],
    };

    if (includeTimedOutFailed) {
      where.OR.push({
        status: "failed",
        outputUrl: null,
        completedAt: { gt: new Date(now - FAILED_LOOKBACK_MS) },
      });
    }

    const rows = await prisma.generation.findMany({
      where,
      select: {
        id: true,
        type: true,
        status: true,
        inputImageUrl: true,
        outputUrl: true,
        errorMessage: true,
        userId: true,
        modelId: true,
        createdAt: true,
      },
      take: safeLimit,
      orderBy: { createdAt: "asc" },
    });

    const stats = {
      scanned: rows.length,
      checkedWithRunpodJobId: 0,
      completedRecovered: 0,
      completedRecoveredFromFailed: 0,
      failedMarked: 0,
      stillRunning: 0,
      skippedNoRunpodJobId: 0,
      skippedFailedNotTimedOut: 0,
      errors: 0,
    };

    if (rows.length === 0) return stats;

    for (const gen of rows) {
      // For failed rows we only retry likely timeout-style failures.
      if (gen.status === "failed") {
        const msg = String(gen.errorMessage || "").toLowerCase();
        const likelyTimedOut =
          msg.includes("timed out") ||
          msg.includes("took too long") ||
          msg.includes("temporary") ||
          msg.includes("unavailable");
        if (!includeTimedOutFailed || !likelyTimedOut) {
          stats.skippedFailedNotTimedOut += 1;
          continue;
        }
      }

      let runpodJobId = typeof gen.providerTaskId === "string" ? gen.providerTaskId.trim() : null;
      try {
        const meta = JSON.parse(gen.inputImageUrl || "{}");
        runpodJobId = runpodJobId || (typeof meta?.runpodJobId === "string" ? meta.runpodJobId.trim() : null);
      } catch {
        runpodJobId = runpodJobId || null;
      }
      if (!runpodJobId) {
        stats.skippedNoRunpodJobId += 1;
        continue;
      }
      stats.checkedWithRunpodJobId += 1;

      try {
        const rp = gen.type === "upscale"
          ? await pollUpscalerJob(runpodJobId)
          : await pollModelCloneXJob(runpodJobId);
        const status = String(rp?.status || "").toLowerCase();

        if (["failed", "error", "timed_out", "timed-out", "cancelled", "canceled"].includes(status)) {
          const msg =
            rp?.error ||
            rp?.output?.error ||
            (typeof rp?.output === "string" ? rp.output : null) ||
            `RunPod ${status}`;
          await this.markFailed(gen.id, msg, { refund: gen.status === "processing" });
          stats.failedMarked += 1;
          continue;
        }

        if (status !== "completed") {
          stats.stillRunning += 1;
          continue;
        }

        let imageData = null;
        if (gen.type === "upscale") {
          imageData = extractUpscalerImage(rp);
        } else {
          const imgs = extractModelCloneXImages(rp);
          imageData = imgs[0] || null;
        }

        if (!imageData) {
          await this.markFailed(gen.id, "RunPod completed but returned no image", { refund: true });
          continue;
        }

        let outputUrl = imageData;
        if (!imageData.startsWith("http")) {
          const buf = Buffer.from(imageData, "base64");
          outputUrl = await uploadBufferToBlobOrR2(
            buf,
            gen.type === "upscale" ? "upscale" : gen.type === "nsfw" ? "nsfw" : "modelclone-x",
            "png",
            "image/png",
          );
        }

        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "completed", outputUrl, completedAt: new Date(), errorMessage: null },
        });
        if (gen.userId && gen.modelId) {
          enqueueCleanupOldGenerations(gen.userId, gen.modelId);
        }
        stats.completedRecovered += 1;
        if (gen.status === "failed") stats.completedRecoveredFromFailed += 1;
      } catch (err) {
        stats.errors += 1;
        if (String(err?.message || "").trim()) {
          console.warn(`[RunPod Watchdog] ${gen.id.slice(0, 8)} ${gen.type}: ${err.message}`);
        }
      }
    }

    return stats;
  }

  /**
   * Helper to sleep
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

// Create singleton instance
const generationPoller = new GenerationPollerService();

export default generationPoller;

/** Standalone export for use in cron/admin routes that can't import the full class instance */
export async function runPiapiWatchdog() {
  return generationPoller.reconcileStalePiapiGenerations();
}

export async function runWavespeedSeedreamWatchdog() {
  return generationPoller.reconcileStaleWavespeedSeedreamGenerations();
}

export async function runRunpodWatchdog(options = {}) {
  return generationPoller.reconcileStaleRunpodGenerations(options);
}

