/**
 * WaveSpeed webhook — WaveSpeed POSTs here when a task completes (e.g. Seedream V4.5 Edit).
 * Payload: { id, model, input, outputs?, status, created_at, error? }
 * Always return 200 quickly so WaveSpeed does not retry.
 * If WAVESPEED_WEBHOOK_SECRET is set, verify HMAC_SHA256(secret_without_whsec_prefix, "{webhook-id}.{webhook-timestamp}.{raw_body}").
 * If unset, requests are accepted (logs a one-time warning) — set the secret in production for security.
 */
import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { isR2Configured, uploadBufferToR2 } from "../utils/r2.js";
import { refundGeneration } from "../services/credit.service.js";
import { cleanupOldGenerations } from "../controllers/generation.controller.js";
import { deleteBlobAfterKie } from "../utils/kieUpload.js";
import { runPipelineContinuation } from "../services/kie-pipeline-continuation.service.js";
import { getErrorMessageForDb } from "../lib/userError.js";

const router = express.Router();
const WAVESPEED_WEBHOOK_SECRET = process.env.WAVESPEED_WEBHOOK_SECRET;
const CORS_ORIGIN = "https://api.wavespeed.ai";
let warnedMissingWaveSpeedWebhookSecret = false;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, webhook-id, webhook-timestamp, webhook-signature");
}

function verifyWebhookSignature(rawBody, webhookId, timestamp, receivedSignature) {
  if (!WAVESPEED_WEBHOOK_SECRET || !webhookId || !timestamp || !receivedSignature) {
    return !WAVESPEED_WEBHOOK_SECRET;
  }
  const secret = String(WAVESPEED_WEBHOOK_SECRET).replace(/^whsec_/i, "");
  const message = `${webhookId}.${timestamp}.${rawBody}`;
  const expectedHex = crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
  const receivedHex = receivedSignature.startsWith("v3,") ? receivedSignature.slice(3).trim() : receivedSignature;
  if (expectedHex.length !== receivedHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex, "hex"));
  } catch {
    return false;
  }
}

/** Mirror WaveSpeed result to R2 with retries. Returns final R2 URL or original on failure. */
async function mirrorResultToR2(outputUrl, contentTypeHint = "image/png") {
  if (!isR2Configured()) return outputUrl;
  const maxAttempts = 3;
  const delayMs = 1500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const dl = await fetch(outputUrl, { signal: AbortSignal.timeout(60_000) });
      if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      const ct = dl.headers.get("content-type") || contentTypeHint;
      const ext = outputUrl.match(/\.(mp4|webm|jpg|jpeg|webp|png)(\?|$)/i)?.[1]?.toLowerCase() || "png";
      return await uploadBufferToR2(buf, "generations", ext, ct);
    } catch (e) {
      console.warn("[WaveSpeed Callback] R2 mirror attempt %s/%s failed: %s", attempt, maxAttempts, e?.message);
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
      else return outputUrl;
    }
  }
  return outputUrl;
}

router.options("/", (req, res) => {
  setCorsHeaders(res);
  res.status(200).end();
});

router.post("/", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  setCorsHeaders(res);
  const ack = () => {
    if (!res.headersSent) res.status(200).json({ received: true });
  };

  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : (req.body && typeof req.body === "string" ? req.body : "");
    const webhookId = req.headers["webhook-id"];
    const timestamp = req.headers["webhook-timestamp"];
    const signature = req.headers["webhook-signature"];

    if (WAVESPEED_WEBHOOK_SECRET) {
      const age = timestamp ? Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) : 999;
      if (age > 300) {
        console.warn("[WaveSpeed Callback] Rejected: timestamp too old");
        return res.status(401).json({ error: "Invalid webhook timestamp" });
      }
      if (!verifyWebhookSignature(rawBody, webhookId, timestamp, signature)) {
        console.warn("[WaveSpeed Callback] Invalid signature");
        return res.status(401).json({ error: "Invalid signature" });
      }
    } else if (!warnedMissingWaveSpeedWebhookSecret) {
      warnedMissingWaveSpeedWebhookSecret = true;
      console.warn(
        "[WaveSpeed Callback] WAVESPEED_WEBHOOK_SECRET not set — accepting webhooks without signature verification (set secret in production for security)",
      );
    }

    let body;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      console.warn("[WaveSpeed Callback] Invalid JSON body");
      return ack();
    }

    const taskId = body.id ?? body.request_id ?? body.task_id;
    const status = body.status;
    const normalizedStatus = String(status || "").toLowerCase();
    const outputs = body.outputs;
    const errorMsg = body.error;

    if (!taskId) {
      console.log("[WaveSpeed Callback] No task id in body");
      return ack();
    }

    const isSuccessStatus = ["completed", "succeeded", "success", "finished"].includes(normalizedStatus);
    const isFailedStatus = ["failed", "error", "cancelled", "canceled"].includes(normalizedStatus);

    const outputUrl = isSuccessStatus && Array.isArray(outputs) && outputs.length > 0
      ? (typeof outputs[0] === "string" ? outputs[0] : outputs[0]?.url)
      : null;
    const finalUrl = (outputUrl && outputUrl.startsWith("http"))
      ? await mirrorResultToR2(outputUrl, "image/png")
      : outputUrl;

    // Pipeline: image -> video (taskId stored in pipelinePayload.imageTaskId on the video gen)
    const pipelineGen = await prisma.generation.findFirst({
      where: { pipelinePayload: { path: ["imageTaskId"], equals: String(taskId) } },
      select: { id: true },
    });
    if (pipelineGen && isSuccessStatus && finalUrl) {
      await runPipelineContinuation(String(taskId), finalUrl);
      console.log("[WaveSpeed Callback] Paired pipeline gen %s to taskId %s", pipelineGen.id.slice(0, 8), String(taskId).slice(0, 12));
      return ack();
    }
    if (pipelineGen && isFailedStatus) {
      const err = errorMsg || "WaveSpeed task failed";
      await prisma.generation.update({
        where: { id: pipelineGen.id },
        data: { status: "failed", errorMessage: getErrorMessageForDb(err), completedAt: new Date(), pipelinePayload: null },
      });
      try { await refundGeneration(pipelineGen.id); } catch {}
      console.log("[WaveSpeed Callback] pipeline failed %s", pipelineGen.id.slice(0, 8));
      return ack();
    }

    const gen = await prisma.generation.findFirst({
      where: {
        OR: [
          { replicateModel: `wavespeed-seedream:${taskId}` },
          { replicateModel: String(taskId) }, // nsfw-video / nsfw-video-extend store raw requestId
        ],
      },
      select: { id: true, userId: true, modelId: true, status: true, type: true },
    });

    if (!gen) {
      console.log("[WaveSpeed Callback] No generation for taskId %s", String(taskId).slice(0, 20));
      return ack();
    }

    if (gen.status === "completed") {
      console.log("[WaveSpeed Callback] Generation %s already completed", gen.id.slice(0, 8));
      return ack();
    }

    if (isSuccessStatus && finalUrl) {
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: "completed", outputUrl: finalUrl, completedAt: new Date() },
      });
      console.log("[WaveSpeed Callback] Paired gen %s to taskId %s", gen.id.slice(0, 8), String(taskId).slice(0, 12));
      if (gen.userId && gen.modelId) {
        cleanupOldGenerations(gen.userId, gen.modelId).catch(() => {});
      }
      try {
        // Skip deleting input Blobs for types that feed into video (e.g. pipeline image); leave for TTL/cleanup.
        if (gen.type !== "video") {
          const row = await prisma.generation.findUnique({
            where: { id: gen.id },
            select: { inputImageUrl: true, inputVideoUrl: true },
          });
          if (row?.inputImageUrl) deleteBlobAfterKie(row.inputImageUrl).catch(() => {});
          if (row?.inputVideoUrl) deleteBlobAfterKie(row.inputVideoUrl).catch(() => {});
        }
      } catch {}
      console.log("[WaveSpeed Callback] completed %s", gen.id.slice(0, 8));
    } else if (isFailedStatus) {
      const err = errorMsg || (status === "failed" ? "WaveSpeed task failed" : "Unknown status");
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: "failed", errorMessage: getErrorMessageForDb(err), completedAt: new Date() },
      });
      try { await refundGeneration(gen.id); } catch {}
      console.log("[WaveSpeed Callback] failed %s: %s", gen.id.slice(0, 8), err);
    } else {
      // Ignore non-terminal statuses from webhook and let polling/callback continue.
      console.log("[WaveSpeed Callback] task %s status=%s (non-terminal), waiting", String(taskId).slice(0, 12), String(status));
    }
  } catch (err) {
    console.error("[WaveSpeed Callback] Error:", err?.message || err);
  } finally {
    ack();
  }
});

export default router;
