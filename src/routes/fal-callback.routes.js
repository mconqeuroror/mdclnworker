/**
 * fal.ai webhook callbacks.
 *
 * POST /api/fal/webhook/training  — LoRA training completed
 * POST /api/fal/webhook/faceswap  — Face-swap job completed
 *
 * fal.ai signs every delivery with ED25519 using keys from:
 *   https://rest.fal.ai/.well-known/jwks.json
 *
 * Signature verification is enforced in production (warn-only in dev).
 * Always respond 200 so fal.ai does not retry on our errors.
 */
import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import {
  getTrainingResult,
  archiveNsfwImageToR2,
} from "../services/fal.service.js";
import {
  finalizeTrainingCompletion,
  syncLegacyLoraFields,
} from "../controllers/nsfw.controller.js";
import { enqueueCleanupOldGenerations } from "../controllers/generation.controller.js";
import { refundCredits } from "../services/credit.service.js";

const router = express.Router();

// ── JWKS / Signature verification ─────────────────────────────────────────────

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const JWKS_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 h

let _jwksCache = null;
let _jwksCacheTime = 0;

async function fetchJwks() {
  const now = Date.now();
  if (_jwksCache && now - _jwksCacheTime < JWKS_CACHE_DURATION_MS) return _jwksCache;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = await res.json();
  _jwksCache = data.keys || [];
  _jwksCacheTime = now;
  return _jwksCache;
}

/**
 * Verify the ED25519 signature from fal.ai webhook headers.
 * Returns true if valid, false if invalid or headers missing.
 * On JWKS fetch failure, returns null (treat as "unknown").
 */
async function verifyFalSignature(rawBody, headers) {
  const requestId = headers["x-fal-webhook-request-id"];
  const userId    = headers["x-fal-webhook-user-id"];
  const timestamp = headers["x-fal-webhook-timestamp"];
  const sigHex    = headers["x-fal-webhook-signature"];

  if (!requestId || !userId || !timestamp || !sigHex) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    console.warn("[fal webhook] timestamp out of ±5 min window:", timestamp);
    return false;
  }

  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const message  = Buffer.from([requestId, userId, timestamp, bodyHash].join("\n"), "utf-8");

  try {
    const keys  = await fetchJwks();
    const sigBuf = Buffer.from(sigHex, "hex");
    for (const key of keys) {
      if (!key.x) continue;
      // base64url → base64 → Buffer
      const pubBuf = Buffer.from(key.x.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const keyObj = crypto.createPublicKey({ key: pubBuf, format: "raw", type: "ed25519" });
      if (crypto.verify(null, message, keyObj, sigBuf)) return true;
    }
    return false;
  } catch (e) {
    console.warn("[fal webhook] signature verify error:", e?.message);
    return null; // unknown
  }
}

/** Parse raw body buffer into a JS object and return both. */
function parseBody(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    parsed = null;
  }
  return { raw, parsed };
}

/** Shared auth + parse middleware for all fal webhook sub-routes. */
async function falWebhookMiddleware(req, res, next) {
  const { raw, parsed } = parseBody(req);
  if (!parsed) return res.status(200).json({ ok: false, reason: "invalid_json" });
  req._rawBody = raw;
  req.body = parsed;

  const sigResult = await verifyFalSignature(raw, req.headers).catch(() => null);
  if (process.env.NODE_ENV === "production") {
    // Fail closed in production: never process unsigned/unverifiable webhook payloads.
    if (sigResult !== true) {
      console.warn("[fal webhook] ❌ rejected webhook: signature verification failed");
      return res.status(401).json({ ok: false, reason: "invalid_signature" });
    }
  } else if (sigResult !== true) {
    console.warn("[fal webhook] signature invalid/unverified (dev mode — continuing)");
  }
  next();
}

// ── /training ─────────────────────────────────────────────────────────────────

router.post(
  "/training",
  express.raw({ type: () => true, limit: "2mb" }),
  falWebhookMiddleware,
  async (req, res) => {
    const body      = req.body;
    const requestId = body.request_id ?? body.requestId;
    const status    = body.status; // "OK" | "ERROR"

    console.log(`[fal/training] requestId=${requestId?.slice(0, 12)} status=${status}`);

    if (!requestId) return res.status(200).json({ ok: false, reason: "no_request_id" });

    try {
      // ── TrainedLora path ────────────────────────────────────────────────────
      const lora = await prisma.trainedLora.findFirst({
        where: { falRequestId: requestId, status: "training" },
        include: { model: { select: { id: true, userId: true, name: true, activeLoraId: true } } },
      });

      if (lora) {
        const modelId = lora.modelId;
        const userId  = lora.model?.userId;

        if (status === "ERROR") {
          const errMsg = body.error || body.payload?.detail?.[0]?.msg || "Training failed on fal.ai";
          await prisma.trainedLora.update({
            where: { id: lora.id },
            data: { status: "failed", error: errMsg },
          });
          if (lora.model?.activeLoraId === lora.id) await syncLegacyLoraFields(modelId, lora.id);
          // Refund credits on failure
          if (userId) {
            try {
              const CREDITS_FOR_LORA_TRAINING     = Number(process.env.LORA_TRAINING_COST) || 500;
              const CREDITS_FOR_PRO_LORA_TRAINING = Number(process.env.PRO_LORA_TRAINING_COST) || 1000;
              const refundAmount = lora.trainingMode === "pro"
                ? CREDITS_FOR_PRO_LORA_TRAINING
                : CREDITS_FOR_LORA_TRAINING;
              await refundCredits(userId, refundAmount);
              console.log(`💰 [fal/training webhook] Refunded ${refundAmount} credits to user ${userId}`);
            } catch (e) {
              console.error("[fal/training webhook] refund failed:", e?.message);
            }
          }
          console.log(`❌ [fal/training webhook] LoRA ${lora.id.slice(0, 8)} failed`);
          return res.status(200).json({ ok: true });
        }

        // Extract loraUrl from webhook payload; fall back to fetching result
        let falUrl = body.payload?.diffusers_lora_file?.url ?? body.payload?.lora_file?.url ?? null;
        if (!falUrl) {
          try {
            const result = await getTrainingResult(requestId);
            falUrl = result?.loraUrl;
          } catch (e) {
            console.error("[fal/training webhook] getTrainingResult fallback failed:", e?.message);
          }
        }

        if (!falUrl) {
          await prisma.trainedLora.update({
            where: { id: lora.id },
            data: { status: "failed", error: "Webhook delivered OK but no LoRA URL in payload" },
          });
          console.error("[fal/training webhook] no loraUrl in payload for requestId", requestId);
          return res.status(200).json({ ok: false, reason: "no_lora_url" });
        }

        await finalizeTrainingCompletion({
          loraId:    lora.id,
          modelId,
          userId,
          loraUrl:   falUrl,
          modelName: lora.model?.name,
        });

        console.log(`✅ [fal/training webhook] LoRA ${lora.id.slice(0, 8)} ready`);
        return res.status(200).json({ ok: true });
      }

      // ── Legacy SavedModel path (no TrainedLora row) ─────────────────────────
      const model = await prisma.savedModel.findFirst({
        where: { loraFalRequestId: requestId, loraStatus: "training" },
        select: { id: true, userId: true, name: true },
      });

      if (model) {
        if (status === "ERROR") {
          const errMsg = body.error || "Training failed on fal.ai";
          await prisma.savedModel.update({
            where: { id: model.id },
            data: { loraStatus: "failed", loraError: errMsg },
          });
          console.log(`❌ [fal/training webhook] legacy model ${model.id.slice(0, 8)} failed`);
          return res.status(200).json({ ok: true });
        }

        let falUrl = body.payload?.diffusers_lora_file?.url ?? body.payload?.lora_file?.url ?? null;
        if (!falUrl) {
          try {
            const result = await getTrainingResult(requestId);
            falUrl = result?.loraUrl;
          } catch (e) {
            console.error("[fal/training webhook] legacy getTrainingResult failed:", e?.message);
          }
        }

        if (!falUrl) {
          await prisma.savedModel.update({
            where: { id: model.id },
            data: { loraStatus: "failed", loraError: "Webhook OK but no LoRA URL in payload" },
          });
          return res.status(200).json({ ok: false, reason: "no_lora_url" });
        }

        await finalizeTrainingCompletion({
          loraId:    null,
          modelId:   model.id,
          userId:    model.userId,
          loraUrl:   falUrl,
          modelName: model.name,
        });

        console.log(`✅ [fal/training webhook] legacy model ${model.id.slice(0, 8)} ready`);
        return res.status(200).json({ ok: true });
      }

      console.warn("[fal/training webhook] no match for requestId:", requestId?.slice(0, 12));
      return res.status(200).json({ ok: true, skipped: true, reason: "no_match" });
    } catch (e) {
      console.error("[fal/training webhook] unhandled error:", e?.message);
      return res.status(200).json({ ok: false, error: e?.message });
    }
  }
);

// ── /faceswap ─────────────────────────────────────────────────────────────────

router.post(
  "/faceswap",
  express.raw({ type: () => true, limit: "2mb" }),
  falWebhookMiddleware,
  async (req, res) => {
    const body      = req.body;
    const requestId = body.request_id ?? body.requestId;
    const status    = body.status; // "OK" | "ERROR"

    console.log(`[fal/faceswap] requestId=${requestId?.slice(0, 12)} status=${status}`);

    if (!requestId) return res.status(200).json({ ok: false, reason: "no_request_id" });

    try {
      // Find the generation that has this requestId in its pipelinePayload.faceSwapJobs
      const candidates = await prisma.generation.findMany({
        where: {
          status: { in: ["processing", "pending"] },
          NOT: { pipelinePayload: null },
          createdAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
        },
        select: { id: true, pipelinePayload: true, userId: true, modelId: true },
      });

      const gen = candidates.find((g) => {
        const jobs = g.pipelinePayload?.faceSwapJobs;
        return Array.isArray(jobs) && jobs.some((j) => j.requestId === requestId);
      });

      if (!gen) {
        console.warn("[fal/faceswap webhook] no generation for requestId:", requestId?.slice(0, 12));
        return res.status(200).json({ ok: true, skipped: true, reason: "no_match" });
      }

      const payload      = gen.pipelinePayload;
      const jobs         = payload.faceSwapJobs;
      const job          = jobs.find((j) => j.requestId === requestId);
      const resolvedUrls = { ...(payload.resolvedUrls || {}) };

      if (status === "OK") {
        // Extract output URL from ComfyUI faceswap result
        // Shape: payload.outputs["249"].images[0].url  (same as pollFaceSwapResult)
        const outputs = body.payload?.outputs || {};
        let outputUrl = null;
        for (const nodeId of Object.keys(outputs)) {
          const node = outputs[nodeId];
          if (node?.images?.[0]?.url) { outputUrl = node.images[0].url; break; }
        }
        if (!outputUrl) {
          outputUrl =
            body.payload?.images?.[0]?.url
            ?? body.payload?.data?.images?.[0]?.url
            ?? null;
        }

        if (outputUrl) {
          try { outputUrl = await archiveNsfwImageToR2(outputUrl); } catch {}
          resolvedUrls[String(job.imageIndex)] = outputUrl;
          console.log(`  ✅ Faceswap ${job.imageIndex} resolved: ${outputUrl?.slice(0, 60)}`);
        } else {
          console.warn(`  ⚠️ Faceswap ${job.imageIndex} OK but no URL — using original`);
          resolvedUrls[String(job.imageIndex)] = job.originalUrl;
        }
      } else {
        // Error: fall back to original image
        console.warn(`  ⚠️ Faceswap ${job.imageIndex} ERROR — using original`);
        resolvedUrls[String(job.imageIndex)] = job.originalUrl;
      }

      const totalImages  = payload.totalImages || jobs.length;
      const originalUrls = payload.originalUrls || jobs.map((j) => j.originalUrl);

      if (Object.keys(resolvedUrls).length >= totalImages) {
        // All faceswaps done — finalise the generation
        const finalUrls = originalUrls.map((orig, i) => resolvedUrls[String(i)] ?? orig);
        const outputUrlValue = finalUrls.length === 1 ? finalUrls[0] : JSON.stringify(finalUrls);

        const updated = await prisma.generation.updateMany({
          where: { id: gen.id, status: { in: ["processing", "pending"] } },
          data: {
            status: "completed",
            outputUrl: outputUrlValue,
            completedAt: new Date(),
            errorMessage: null,
            pipelinePayload: null,
          },
        });

        if (updated.count > 0) {
          console.log(`✅ [fal/faceswap webhook] generation ${gen.id.slice(0, 8)} completed (${finalUrls.length} imgs)`);
          if (gen.userId && gen.modelId) {
            enqueueCleanupOldGenerations(gen.userId, gen.modelId);
          }
        } else {
          console.log(`[fal/faceswap webhook] generation ${gen.id.slice(0, 8)} already finalised (race)`);
        }
      } else {
        // Still waiting for other faceswaps
        await prisma.generation.update({
          where: { id: gen.id },
          data: { pipelinePayload: { ...payload, resolvedUrls } },
        });
        console.log(
          `[fal/faceswap webhook] ${gen.id.slice(0, 8)} ${Object.keys(resolvedUrls).length}/${totalImages} done`
        );
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[fal/faceswap webhook] unhandled error:", e?.message);
      return res.status(200).json({ ok: false, error: e?.message });
    }
  }
);

export default router;
