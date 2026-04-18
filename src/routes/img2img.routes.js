/**
 * img2img Pipeline Routes
 *
 * POST /api/img2img/generate
 *   Body: { inputImageUrl, loraUrl, triggerWord, lookDescription?, loraStrength?, denoise? (stage-1, default 0.6), seed? }
 *   Auth: required (JWT cookie)
 *   Credits: deducted upfront (30 credits for generate, 0 for describe), refunded on failure
 *   Returns: { jobId } — client polls /status/:jobId
 *
 * GET /api/img2img/status/:jobId
 *   Returns: { status, outputUrl?, prompt?, error? }
 */

import express from "express";
import prisma from "../lib/prisma.js";
import { resolveRunpodWebhookUrl } from "../lib/runpodWebhookUrl.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
  runImg2ImgPipeline,
  extractPromptFromImage,
  generateImg2Img,
  submitImg2ImgJob,
  submitDescribeJob,
  getRunpodJobStatus,
  isRunpodJobIdValidationError,
  parseRunpodHandlerOutput,
  extractCaptionFromRunpodOutput,
  injectModelIntoPrompt,
} from "../services/img2img.service.js";
import { isR2Configured } from "../utils/r2.js";
import { isVercelBlobConfigured, uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import {
  checkAndExpireCredits,
  getTotalCredits,
  deductCredits,
  refundCredits,
  refundGeneration,
} from "../services/credit.service.js";

const router = express.Router();

// img2img routes accept base64-encoded images in the JSON body.
// The default 10 MB global limit is too small for high-res images, so we
// apply a larger per-route limit here before the auth middleware runs.
const LARGE_JSON = express.json({ limit: "50mb" });

const DESCRIBE_CREDIT_COST = 0;
const IMG2IMG_CREDIT_COST = 30;
const RUNPOD_WATCHDOG_MIN_AGE_MS = Number(process.env.RUNPOD_WATCHDOG_MIN_AGE_MS) || 30 * 60 * 1000;

// In-memory job store (per-process; sufficient for async polling pattern)
const jobs = new Map();

// ── Background sweeper: finalize completed RunPod img2img jobs ────────────────
// This prevents "generated on RunPod but never appears in app" when:
// - the client stops polling
// - the server hot-reloads
// - a status request fails transiently
const IMG2IMG_SWEEP_INTERVAL = 10_000;
let _img2imgSweepRunning = false;
setInterval(async () => {
  if (_img2imgSweepRunning) return;
  _img2imgSweepRunning = true;
  try {
    const candidates = await prisma.generation.findMany({
      where: {
        type: "nsfw",
        outputUrl: null,
        status: { in: ["pending", "processing"] },
        createdAt: { lt: new Date(Date.now() - RUNPOD_WATCHDOG_MIN_AGE_MS) },
        AND: [
          { inputImageUrl: { contains: "\"mode\":\"img2img\"" } },
          { inputImageUrl: { contains: "runpodJobId" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        userId: true,
        prompt: true,
        inputImageUrl: true,
        providerTaskId: true,
        creditsCost: true,
        creditsRefunded: true,
      },
    });

    for (const gen of candidates) {
      let meta = {};
      try {
        meta = gen.inputImageUrl ? JSON.parse(gen.inputImageUrl) : {};
      } catch {
        continue;
      }
      const runpodJobId =
        (typeof gen.providerTaskId === "string" && gen.providerTaskId.trim()) ||
        meta.runpodJobId;
      if (!runpodJobId) continue;

      let rp;
      try {
        rp = await getRunpodJobStatus(runpodJobId);
      } catch (e) {
        if (isRunpodJobIdValidationError(e)) {
          await prisma.generation.update({
            where: { id: gen.id },
            data: {
              status: "failed",
              errorMessage: getErrorMessageForDb("Invalid RunPod job id"),
              completedAt: new Date(),
            },
          });
          if (!gen.creditsRefunded) {
            await refundGeneration(gen.id);
            await prisma.creditTransaction.create({
              data: {
                userId: gen.userId,
                amount: gen.creditsCost,
                type: "refund",
                description: "img2img refund (sweeper): invalid RunPod job id",
              },
            });
          }
          jobs.set(gen.id, {
            status: "failed",
            userId: gen.userId,
            error: "Invalid RunPod job id",
            completedAt: Date.now(),
          });
          continue;
        }
        throw e;
      }
      const rpStatus = rp.status;

      if (rpStatus === "COMPLETED") {
        const output = parseRunpodHandlerOutput(rp.output);
        if (!output) throw new Error("RunPod returned empty or unparsable output");
        if (output?.error) throw new Error(output.error);
        const images = output?.images || [];
        if (!images.length) throw new Error("Generation completed but returned no images");

        let outputUrl;
        if (isVercelBlobConfigured() || isR2Configured()) {
          const buffer = Buffer.from(images[0].base64, "base64");
          outputUrl = await uploadBufferToBlobOrR2(buffer, "nsfw-generations", "png", "image/png");
        } else {
          outputUrl = `data:image/png;base64,${images[0].base64}`;
        }

        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "completed", outputUrl, completedAt: new Date(), errorMessage: null },
        });

        jobs.set(gen.id, { status: "completed", userId: gen.userId, outputUrl, prompt: gen.prompt, completedAt: Date.now() });
      } else if (rpStatus === "FAILED" || rpStatus === "CANCELLED") {
        const errMsg = rp.output?.error || rp.error || "Generation failed";
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "failed", errorMessage: getErrorMessageForDb(String(errMsg)), completedAt: new Date() },
        });

        if (!gen.creditsRefunded) {
          await refundGeneration(gen.id);
          await prisma.creditTransaction.create({
            data: {
              userId: gen.userId,
              amount: gen.creditsCost,
              type: "refund",
              description: `img2img refund (sweeper): ${String(errMsg).slice(0, 100)}`,
            },
          });
        }

        jobs.set(gen.id, { status: "failed", userId: gen.userId, error: String(errMsg), completedAt: Date.now() });
      }
    }
  } catch (e) {
    console.warn("img2img sweeper error:", e?.message || e);
  } finally {
    _img2imgSweepRunning = false;
  }
}, IMG2IMG_SWEEP_INTERVAL);

// Purge completed/failed jobs older than 2 hours to avoid memory leak
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.completedAt && job.completedAt < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000);

// ── Background sweeper: finalize stranded img2img-describe rows ──────────────
// The /describe-status route runs the polling fallback ONLY while a client is
// actively polling. If the user closes the tab AND the RunPod webhook fails to
// land, the row stays "processing" forever. This sweeper finalizes such rows
// the same way the webhook handler would — extract caption, run Grok inject,
// persist {prompt, rawDescription} — so the next /describe-status read returns
// the recovered result instead of "processing".
const DESCRIBE_SWEEP_INTERVAL = 30_000;
const DESCRIBE_SWEEP_MIN_AGE_MS = 90_000; // give webhook + active polling a head start
let _describeSweepRunning = false;
setInterval(async () => {
  if (_describeSweepRunning) return;
  _describeSweepRunning = true;
  try {
    const candidates = await prisma.generation.findMany({
      where: {
        type: "img2img-describe",
        status: { in: ["pending", "processing", "queued"] },
        createdAt: { lt: new Date(Date.now() - DESCRIBE_SWEEP_MIN_AGE_MS) },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        userId: true,
        inputImageUrl: true,
        providerTaskId: true,
        createdAt: true,
      },
    });

    for (const gen of candidates) {
      let meta = {};
      try { meta = gen.inputImageUrl ? JSON.parse(gen.inputImageUrl) : {}; } catch { continue; }
      const runpodJobId =
        (typeof gen.providerTaskId === "string" && gen.providerTaskId.trim()) ||
        meta.runpodJobId;
      if (!runpodJobId) continue;

      let rp;
      try {
        rp = await getRunpodJobStatus(runpodJobId, { useImageAnalysisEndpoint: true });
      } catch (e) {
        if (isRunpodJobIdValidationError(e)) {
          await prisma.generation.updateMany({
            where: { id: gen.id, status: { in: ["queued", "processing", "pending"] } },
            data: {
              status: "failed",
              errorMessage: getErrorMessageForDb("Invalid RunPod job id").slice(0, 500),
              completedAt: new Date(),
            },
          });
          continue;
        }
        // Transient RunPod error — leave the row alone and try again next tick.
        continue;
      }

      const st = String(rp?.status || "").toUpperCase();

      if (st === "FAILED" || st === "CANCELLED") {
        const errMsg = rp?.error || rp?.output?.error || "RunPod describe job failed";
        await prisma.generation.updateMany({
          where: { id: gen.id, status: { in: ["queued", "processing", "pending"] } },
          data: {
            status: "failed",
            errorMessage: getErrorMessageForDb(String(errMsg)).slice(0, 500),
            completedAt: new Date(),
          },
        });
        console.warn(
          `[describe-sweeper] job ${gen.id} (runpod=${runpodJobId}) finalized as FAILED: ${String(errMsg).slice(0, 120)}`,
        );
        continue;
      }

      if (st === "COMPLETED") {
        const rawOut = rp.output ?? rp.result ?? rp;
        const caption = extractCaptionFromRunpodOutput(rawOut);
        if (!caption) {
          await prisma.generation.updateMany({
            where: { id: gen.id, status: { in: ["queued", "processing", "pending"] } },
            data: {
              status: "failed",
              errorMessage: "JoyCaption returned no text",
              completedAt: new Date(),
            },
          });
          console.warn(
            `[describe-sweeper] job ${gen.id} (runpod=${runpodJobId}) COMPLETED but no caption extractable`,
          );
          continue;
        }

        const triggerWord = meta.triggerWord || "";
        const lookDescription = meta.lookDescription || "";
        let prompt;
        try {
          prompt = await injectModelIntoPrompt(caption, triggerWord, lookDescription);
        } catch (grokErr) {
          console.error(`[describe-sweeper] Grok inject failed for ${gen.id}: ${grokErr.message}`);
          prompt = caption;
        }

        const upd = await prisma.generation.updateMany({
          where: { id: gen.id, status: { in: ["queued", "processing", "pending"] } },
          data: {
            status: "completed",
            pipelinePayload: JSON.stringify({ prompt, rawDescription: caption }),
            completedAt: new Date(),
          },
        });
        if (upd.count > 0) {
          console.log(
            `✅ [describe-sweeper] job ${gen.id} recovered (webhook+poll both missed; runpod=${runpodJobId})`,
          );
        }
      }
      // IN_QUEUE / IN_PROGRESS / unknown — leave alone, retry next tick.
    }
  } catch (e) {
    console.warn("describe sweeper error:", e?.message || e);
  } finally {
    _describeSweepRunning = false;
  }
}, DESCRIBE_SWEEP_INTERVAL);

// ── POST /api/img2img/describe ────────────────────────────────────────────────
// Submits a JoyCaption RunPod job and returns immediately with a describeJobId.
// Client polls GET /api/img2img/describe-status/:id for the result.
router.post("/describe", LARGE_JSON, authMiddleware, async (req, res) => {
  const userId = req.user.userId || req.user.id;
  const { inputImageUrl, inputImageBase64, triggerWord, lookDescription = "" } = req.body;

  if ((!inputImageUrl && !inputImageBase64) || !triggerWord) {
    return res.status(400).json({ error: "Missing required fields: inputImageUrl or inputImageBase64, triggerWord" });
  }

  const isValidUrl = inputImageUrl && /^https?:\/\//i.test(inputImageUrl);
  if (!inputImageBase64 && !isValidUrl) {
    return res.status(400).json({
      error: "inputImageUrl must be a valid http/https URL, or supply inputImageBase64 instead",
    });
  }

  if (DESCRIBE_CREDIT_COST > 0) {
    try {
      const freshUser = await checkAndExpireCredits(userId);
      const total = getTotalCredits(freshUser);
      if (total < DESCRIBE_CREDIT_COST) {
        return res.status(402).json({ error: `Not enough credits (need ${DESCRIBE_CREDIT_COST}, have ${total})` });
      }
      await deductCredits(userId, DESCRIBE_CREDIT_COST);
    } catch (err) {
      console.error("Credit deduction failed for /describe:", err.message);
      return res.status(500).json({ error: "Failed to deduct credits" });
    }
  }

  let gen = null;
  try {
    // Create the pending job first so fast RunPod webhooks always have a row to pair against.
    gen = await prisma.generation.create({
      data: {
        userId,
        type: "img2img-describe",
        status: "processing",
        prompt: triggerWord,
        inputImageUrl: JSON.stringify({ triggerWord, lookDescription }),
        creditsCost: DESCRIBE_CREDIT_COST,
      },
    });

    const webhookUrl = resolveRunpodWebhookUrl({
      generationId: gen.id,
      kind: "img2img-describe",
    });
    const runpodJobId = await submitDescribeJob(inputImageBase64 || null, inputImageUrl || null, webhookUrl);

    await prisma.generation.update({
      where: { id: gen.id },
      data: {
        providerTaskId: runpodJobId,
        inputImageUrl: JSON.stringify({ runpodJobId, triggerWord, lookDescription }),
      },
    });

    console.log(
      `🔍 [img2img/describe] Job ${runpodJobId} submitted → describeJobId ${gen.id} ` +
      `webhook=${webhookUrl ? webhookUrl.slice(0, 96) + (webhookUrl.length > 96 ? "…" : "") : "(none — will be stranded!)"}`,
    );
    return res.json({ describeJobId: gen.id });
  } catch (err) {
    console.error("❌ /describe submit failed:", err.message);
    if (gen?.id) {
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: "failed", errorMessage: err.message.slice(0, 500) },
      }).catch(() => {});
    }
    if (DESCRIBE_CREDIT_COST > 0) {
      try { await refundCredits(userId, DESCRIBE_CREDIT_COST); } catch {}
    }
    return res.status(500).json({ success: false, error: err.message || "Failed to start analysis" });
  }
});

// ── GET /api/img2img/describe-status/:id ─────────────────────────────────────
// Returns { status, prompt?, rawDescription?, error? }
// If still processing, checks RunPod directly and finalizes if ready.
router.get("/describe-status/:id", authMiddleware, async (req, res) => {
  const userId = req.user.userId || req.user.id;
  const { id } = req.params;

  // Disable conditional caching — identical "processing" bodies were being served
  // as HTTP 304 by Vercel/proxies, and the client treats empty bodies as errors.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const gen = await prisma.generation.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        status: true,
        inputImageUrl: true,
        pipelinePayload: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    if (!gen) return res.status(404).json({ error: "Describe job not found" });
    if (gen.userId !== userId) return res.status(403).json({ error: "Unauthorized" });

    // Already resolved
    if (gen.status === "completed") {
      let result = {};
      try { result = JSON.parse(gen.pipelinePayload || "{}"); } catch {}
      return res.json({ status: "completed", prompt: result.prompt, rawDescription: result.rawDescription });
    }
    if (gen.status === "failed") {
      return res.json({ status: "failed", error: gen.errorMessage || "Analysis failed" });
    }

    // Webhook-first, polling-fallback mode.
    // RunPod webhooks regularly fail to land on Vercel (network blips, region
    // routing, sandboxed deployments) and previously left describe jobs stuck
    // in "processing" until the watchdog reconciled them — surfacing as
    // "Analysis timed out" on the client. Now: while the row is still
    // processing, ask RunPod directly. If it's done, finalize here using the
    // exact same logic as the webhook handler.
    let meta = {};
    try { meta = JSON.parse(gen.inputImageUrl || "{}"); } catch {}
    const runpodJobId = meta.runpodJobId || (gen).providerTaskId;

    if (runpodJobId) {
      try {
        // Describe jobs are submitted to the dedicated JoyCaption (analysis)
        // endpoint, NOT the gen endpoint. Job ids only resolve against the
        // endpoint that issued them, so we must pass the flag here or every
        // poll silently 404s and the client always times out at 5 min.
        const poll = await getRunpodJobStatus(runpodJobId, { useImageAnalysisEndpoint: true });
        const st = String(poll?.status || "").toUpperCase();

        if (st === "FAILED" || st === "CANCELLED") {
          const errMsg =
            poll?.error ||
            poll?.output?.error ||
            "RunPod describe job failed";
          // updateMany guards against the webhook landing between this read
          // and the write — only finalize if still in a non-terminal state.
          await prisma.generation.updateMany({
            where: { id: gen.id, status: { in: ["queued", "processing", "pending"] } },
            data: {
              status: "failed",
              errorMessage: getErrorMessageForDb(String(errMsg)).slice(0, 500),
              completedAt: new Date(),
            },
          });
          console.warn(
            `⚠️ [img2img/describe-status] job ${gen.id} (runpod=${runpodJobId}) ` +
            `finalized as FAILED via polling fallback: ${String(errMsg).slice(0, 120)}`,
          );
          return res.json({ status: "failed", error: String(errMsg) });
        }

        if (st === "COMPLETED") {
          // Mirror the webhook handler: hand raw `output` to the extractor,
          // which already normalizes ComfyUI / wrapped shapes internally.
          const rawOut = poll.output ?? poll.result ?? poll;
          const caption = extractCaptionFromRunpodOutput(rawOut);

          if (!caption) {
            let dump = "";
            try { dump = JSON.stringify(rawOut).slice(0, 1500); } catch { dump = String(rawOut).slice(0, 1500); }
            console.warn(
              `[img2img/describe-status] job ${gen.id} (runpod=${runpodJobId}) ` +
              `COMPLETED but no caption extracted via polling fallback. ` +
              `rawOutKeys=${rawOut && typeof rawOut === "object" ? Object.keys(rawOut).slice(0, 15).join(",") : typeof rawOut} ` +
              `rawOut=${dump}`,
            );
            await prisma.generation.updateMany({
              where: { id: gen.id, status: { in: ["queued", "processing", "pending"] } },
              data: {
                status: "failed",
                errorMessage: "JoyCaption returned no text",
                completedAt: new Date(),
              },
            });
            return res.json({ status: "failed", error: "JoyCaption returned no text" });
          }

          const triggerWord = meta.triggerWord || "";
          const lookDescription = meta.lookDescription || "";
          let prompt;
          try {
            prompt = await injectModelIntoPrompt(caption, triggerWord, lookDescription);
          } catch (grokErr) {
            console.error("[img2img/describe-status] Grok inject failed:", grokErr.message);
            prompt = caption;
          }

          const upd = await prisma.generation.updateMany({
            where: { id: gen.id, status: { in: ["queued", "processing", "pending"] } },
            data: {
              status: "completed",
              pipelinePayload: JSON.stringify({ prompt, rawDescription: caption }),
              completedAt: new Date(),
            },
          });

          if (upd.count > 0) {
            console.log(
              `✅ [img2img/describe-status] job ${gen.id} completed via polling fallback ` +
              `(webhook never arrived for runpod=${runpodJobId})`,
            );
          } else {
            // Webhook beat us to it — re-read the canonical row.
            const fresh = await prisma.generation.findUnique({
              where: { id: gen.id },
              select: { status: true, pipelinePayload: true, errorMessage: true },
            });
            if (fresh?.status === "completed") {
              let r = {};
              try { r = JSON.parse(fresh.pipelinePayload || "{}"); } catch {}
              return res.json({ status: "completed", prompt: r.prompt, rawDescription: r.rawDescription });
            }
            if (fresh?.status === "failed") {
              return res.json({ status: "failed", error: fresh.errorMessage || "Analysis failed" });
            }
          }
          return res.json({ status: "completed", prompt, rawDescription: caption });
        }
        // st is IN_PROGRESS / IN_QUEUE / unknown — fall through to "processing".
      } catch (pollErr) {
        // Don't fail the client poll on a transient RunPod hiccup — just keep
        // returning "processing" so the next tick retries.
        console.warn(
          `[img2img/describe-status] RunPod poll failed for job ${gen.id} ` +
          `(runpod=${runpodJobId}): ${pollErr.message}`,
        );
      }
    } else {
      console.warn(
        `[img2img/describe-status] job ${gen.id} has no runpodJobId yet — ` +
        `still waiting for /describe to persist providerTaskId.`,
      );
    }

    // Include ts so the body is never byte-identical across polls (defense in
    // depth vs 304 caching by Vercel/proxies).
    return res.json({ status: "processing", ts: Date.now() });
  } catch (err) {
    console.error("❌ /describe-status error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/img2img/generate ────────────────────────────────────────────────
router.post("/generate", LARGE_JSON, authMiddleware, async (req, res) => {
  const userId = req.user.userId || req.user.id;
  const {
    inputImageUrl,
    inputImageBase64,       // alternative to inputImageUrl — avoids server-side hotlink issues
    loraUrl,
    triggerWord,
    lookDescription = "",
    loraStrength = 0.8,
    denoise = 0.6,
    seed,
    modelId,
    prompt: prebuiltPrompt, // if provided, skip JoyCaption+inject steps
  } = req.body;

  if ((!inputImageUrl && !inputImageBase64) || !loraUrl || !triggerWord) {
    return res.status(400).json({
      error: "Missing required fields: inputImageUrl or inputImageBase64, loraUrl, triggerWord",
    });
  }

  // Use placeholder URL for DB records when base64 was supplied directly
  const effectiveInputUrl = inputImageUrl || "base64-upload";

  // ── Credit check + atomic deduction ─────────────────────────────────────────
  let deducted = false;
  try {
    const freshUser = await checkAndExpireCredits(userId);
    const total = getTotalCredits(freshUser);
    if (total < IMG2IMG_CREDIT_COST) {
      return res.status(402).json({
        error: `Not enough credits (need ${IMG2IMG_CREDIT_COST}, have ${total})`,
      });
    }

    await deductCredits(userId, IMG2IMG_CREDIT_COST);

    await prisma.creditTransaction.create({
      data: {
        userId,
        amount: -IMG2IMG_CREDIT_COST,
        type: "generation",
        description: `img2img — ${triggerWord}`,
      },
    });
    deducted = true;
  } catch (err) {
    console.error("Credit deduction failed:", err.message);
    return res.status(500).json({ error: "Failed to deduct credits" });
  }

  // ── Create DB record first (robust across restarts) ─────────────────────────
  // We use Generation.id as the jobId the client polls.
  let generation;
  try {
    generation = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId || undefined,
        type: "nsfw",
        prompt: (prebuiltPrompt || "").trim() || "img2img (pending)",
        outputUrl: null,
        inputImageUrl: JSON.stringify({
          mode: "img2img",
          sourceImage: effectiveInputUrl,
          loraUrl,
          triggerWord,
          loraStrength: Number(loraStrength),
          denoise: Number(denoise),
          seed: seed != null ? Number(seed) : null,
        }),
        creditsCost: IMG2IMG_CREDIT_COST,
        status: "processing",
        isNsfw: true,
      },
    });
  } catch (dbErr) {
    console.error("Failed to create img2img generation record:", dbErr.message);
    if (deducted) {
      try {
        await refundCredits(userId, IMG2IMG_CREDIT_COST);
      } catch {}
    }
    return res.status(500).json({ error: "Failed to create generation record" });
  }

  const jobId = generation.id;
  jobs.set(jobId, { status: "processing", userId, createdAt: Date.now(), generationId: jobId });

  res.json({ jobId, status: "processing" });

  // ── Background pipeline ─────────────────────────────────────────────────────
  (async () => {
    jobs.set(jobId, { ...jobs.get(jobId), status: "processing" });

    try {
      if (prebuiltPrompt) {
        // Fast + robust path:
        // Submit the RunPod job and store the RunPod job id in the DB.
        // The client polling endpoint will finalize + save the outputUrl when RunPod completes.
        const { runpodJobId, resolvedSeed } = await submitImg2ImgJob({
          imageUrl: effectiveInputUrl,
          imageBase64Provided: inputImageBase64 || null,
          prompt: prebuiltPrompt,
          loraUrl,
          loraStrength: Number(loraStrength),
          denoise: Number(denoise),
          seed: seed != null ? Number(seed) : undefined,
        });

        await prisma.generation.update({
          where: { id: jobId },
          data: {
            prompt: prebuiltPrompt,
            inputImageUrl: JSON.stringify({
              mode: "img2img",
              sourceImage: effectiveInputUrl,
              loraUrl,
              triggerWord,
              loraStrength: Number(loraStrength),
              denoise: Number(denoise),
              seed: resolvedSeed,
              runpodJobId,
            }),
          },
        });

        jobs.set(jobId, {
          ...jobs.get(jobId),
          status: "processing",
          runpodJobId,
        });
      } else {
        // Legacy slow path: run full pipeline and save immediately.
        const result = await runImg2ImgPipeline({
          inputImageUrl: effectiveInputUrl,
          inputImageBase64: inputImageBase64 || null,
          loraUrl,
          triggerWord,
          lookDescription,
          loraStrength: parseFloat(loraStrength),
          denoise: parseFloat(denoise),
          seed: seed != null ? parseInt(seed) : undefined,
        });

        if (!result?.outputUrl) {
          throw new Error("Pipeline returned no output URL");
        }

        await prisma.generation.update({
          where: { id: jobId },
          data: {
            prompt: result.prompt,
            outputUrl: result.outputUrl,
            status: "completed",
            completedAt: new Date(),
          },
        });

        jobs.set(jobId, {
          ...jobs.get(jobId),
          status: "completed",
          outputUrl: result.outputUrl,
          prompt: result.prompt,
          completedAt: Date.now(),
        });
      }
    } catch (err) {
      console.error(`❌ img2img job ${jobId} failed:`, err.message);

      if (deducted) {
        try {
          await refundGeneration(jobId);
          await prisma.creditTransaction.create({
            data: {
              userId,
              amount: IMG2IMG_CREDIT_COST,
              type: "refund",
              description: `img2img refund: ${err.message.slice(0, 100)}`,
            },
          });
          console.log(`💸 Refunded ${IMG2IMG_CREDIT_COST} credits to ${userId}`);
        } catch (refundErr) {
          console.error("⚠️  Refund failed:", refundErr.message);
        }
      }

      try {
        await prisma.generation.update({
          where: { id: jobId },
          data: { status: "failed", errorMessage: getErrorMessageForDb(err.message), completedAt: new Date() },
        });
      } catch {}

      jobs.set(jobId, {
        ...jobs.get(jobId),
        status: "failed",
        error: "Generation failed",
        completedAt: Date.now(),
      });
    }
  })().catch((fatalErr) => {
    console.error(`💥 img2img job ${jobId} uncaught error:`, fatalErr);
    // Mark the generation as failed and refund credits — this is the last-resort handler
    prisma.generation.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: getErrorMessageForDb(fatalErr.message || "Internal error"), completedAt: new Date() },
    }).catch(() => {});
    // Refund credits — the inner catch may not have run if the error escaped early
    refundGeneration(jobId).then((refunded) => {
      if (refunded > 0) {
        prisma.creditTransaction.create({
          data: { userId, amount: refunded, type: "refund", description: "img2img generation failed (fatal)" },
        }).catch(() => {});
      }
    }).catch(() => {});
    jobs.set(jobId, {
      ...jobs.get(jobId),
      status: "failed",
      error: "Generation failed",
      completedAt: Date.now(),
    });
  });
});

// ── POST /api/img2img/recover-runpod ──────────────────────────────────────────
// Manual recovery: attach a RunPod requestId (job id) to a new Generation record.
// Useful if RunPod finished but the app didn't persist the result (restart/hot-reload).
router.post("/recover-runpod", authMiddleware, async (req, res) => {
  const userId = req.user.userId || req.user.id;
  const { runpodJobId, modelId, prompt } = req.body || {};

  if (!runpodJobId || typeof runpodJobId !== "string") {
    return res.status(400).json({ error: "Missing required field: runpodJobId" });
  }

  try {
    const generation = await prisma.generation.create({
      data: {
        userId,
        modelId: modelId || undefined,
        type: "nsfw",
        prompt: (prompt || "Recovered img2img").trim(),
        outputUrl: null,
        inputImageUrl: JSON.stringify({
          mode: "img2img",
          runpodJobId,
          recovered: true,
        }),
        creditsCost: 0,
        status: "processing",
        isNsfw: true,
      },
    });

    jobs.set(generation.id, { status: "processing", userId, createdAt: Date.now(), generationId: generation.id, runpodJobId });
    return res.json({ jobId: generation.id, status: "processing" });
  } catch (e) {
    console.error("recover-runpod failed:", e?.message || e);
    return res.status(500).json({ error: "Failed to create recovery generation" });
  }
});

// ── GET /api/img2img/status/:jobId ────────────────────────────────────────────
// jobId is the Generation.id created in /generate. This makes status polling
// robust even if the server restarts (no reliance on in-memory Maps).
router.get("/status/:jobId", authMiddleware, async (req, res) => {
  const { jobId } = req.params;
  const userId = req.user.userId || req.user.id;

  const gen = await prisma.generation.findFirst({
    where: { id: jobId, userId },
    select: {
      id: true,
      status: true,
      outputUrl: true,
      prompt: true,
      inputImageUrl: true,
      providerTaskId: true,
      errorMessage: true,
      creditsCost: true,
      creditsRefunded: true,
    },
  });

  if (!gen) return res.status(404).json({ error: "Job not found" });

  if (gen.status === "completed") {
    return res.json({ jobId, status: "completed", outputUrl: gen.outputUrl, prompt: gen.prompt });
  }
  if (gen.status === "failed") {
    return res.json({ jobId, status: "failed", error: gen.errorMessage || "Generation failed" });
  }

  // Callback-only mode: no direct RunPod polling here.
  // Stuck rows are reconciled by watchdog (>= 30 min).
  return res.json({ jobId, status: gen.status || "processing" });
});

export default router;
