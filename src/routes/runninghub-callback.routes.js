/**
 * RunningHub OpenAPI webhook — POST when a task finishes (`event`: `TASK_END`).
 *
 * RunningHub has shipped at least three observed body shapes over time:
 *   1. Flat:    `{ event, taskId, eventData: { status, results, ... } }`
 *   2. Wrapped: `{ event, taskId, eventData: { code, msg, data: { status, results } } }`
 *   3. Top-level (no envelope): `{ taskId, status, results, ... }`
 *
 * The handler must accept all of them, otherwise users see "RH succeeded but
 * nothing landed in the app" — which is exactly the bug we're fixing here.
 *
 * Always respond 200 when the payload is parseable so RunningHub does not
 * retry indefinitely. When we can't find a useful status/URL, we leave the
 * row in `processing` and let the cron poller (`runRunpodWatchdog`,
 * `reconcileStaleRunningHubGenerations`) finalize it via `/openapi/v2/query`.
 *
 * Optional hardening: RUNNINGHUB_WEBHOOK_SECRET — same value in URL `?secret=`
 * (auto-appended when set) or header `x-runninghub-webhook-secret`.
 */
import express from "express";
import prisma from "../lib/prisma.js";
import { refundGeneration } from "../services/credit.service.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import { mirrorProviderOutputUrl } from "../utils/kieUpload.js";
import {
  extractRunningHubOutputUrl,
  RUNNINGHUB_TASK_PREFIX,
} from "../services/runninghub.service.js";
import {
  materializeNsfwMotionOutputFromRunpodResponse,
  pickRunningHubStatus,
  pickRunningHubError,
  mapRunningHubQueryStatus,
} from "../services/nsfw-motion.service.js";
import { enqueueCleanupOldGenerations } from "../controllers/generation.controller.js";

const router = express.Router();

function verifyWebhookSecret(req) {
  const secret = String(process.env.RUNNINGHUB_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;
  const q = typeof req.query?.secret === "string" ? req.query.secret : "";
  const h = req.headers["x-runninghub-webhook-secret"];
  const headerVal = typeof h === "string" ? h : "";
  return q === secret || headerVal === secret;
}

async function findGenerationForRunningHubTask(taskId) {
  const t = String(taskId || "").trim();
  if (!t) return null;
  const prefixed = `${RUNNINGHUB_TASK_PREFIX}${t}`;
  return prisma.generation.findFirst({
    where: {
      OR: [
        { replicateModel: prefixed },
        { providerTaskId: t },
        { AND: [{ type: "nsfw-video-motion" }, { replicateModel: t }] },
      ],
    },
  });
}

/**
 * Resolve the canonical eventData object we should reason about. RH has
 * been observed to send wrapped (`eventData: { code, msg, data: {...} }`)
 * and flat (`eventData: { status, results }`) shapes, plus rare cases
 * where there's no envelope at all (`{ taskId, status, results }`).
 */
function resolveEventData(body) {
  if (!body || typeof body !== "object") return {};
  // Wrapped: prefer the inner `data` over the envelope when present.
  if (body.eventData && typeof body.eventData === "object") {
    if (
      body.eventData.data &&
      typeof body.eventData.data === "object" &&
      (body.eventData.data.status !== undefined ||
        Array.isArray(body.eventData.data.results))
    ) {
      return body.eventData.data;
    }
    return body.eventData;
  }
  if (body.data && typeof body.data === "object") {
    return body.data;
  }
  return body;
}

/**
 * Pick the taskId from any of the shapes RH may use.
 */
function resolveTaskId(body) {
  if (!body || typeof body !== "object") return "";
  return String(
    body.taskId ||
      body.task_id ||
      body.eventData?.taskId ||
      body.eventData?.task_id ||
      body.eventData?.data?.taskId ||
      body.data?.taskId ||
      "",
  ).trim();
}

router.post("/", express.json({ limit: "4mb" }), async (req, res) => {
  const ack = (extra = {}) => {
    if (!res.headersSent) res.status(200).json({ received: true, ...extra });
  };

  if (!verifyWebhookSecret(req)) {
    console.warn("[RunningHub Callback] secret mismatch");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const event = String(body.event || "").toUpperCase();
  const taskId = resolveTaskId(body);
  const eventData = resolveEventData(body);

  if (event && event !== "TASK_END") {
    console.log(`[RunningHub Callback] ignored event=${event} taskId=${taskId || "—"}`);
    return ack({ ignored: true });
  }

  if (!taskId) {
    // Log a slice of the body so we can diagnose unexpected shapes in prod.
    console.warn(
      "[RunningHub Callback] missing taskId; body keys=",
      Object.keys(body).slice(0, 20),
      "raw=",
      JSON.stringify(body).slice(0, 300),
    );
    return ack();
  }

  let gen;
  try {
    gen = await findGenerationForRunningHubTask(taskId);
  } catch (e) {
    console.error("[RunningHub Callback] find generation:", e?.message);
    return ack();
  }

  if (!gen) {
    console.warn(`[RunningHub Callback] no generation for taskId=${taskId.slice(0, 12)}…`);
    return ack();
  }

  if (gen.status !== "processing") {
    return ack({ duplicate: true });
  }

  const rawStatus = pickRunningHubStatus(eventData) || pickRunningHubStatus(body);
  const mapped = mapRunningHubQueryStatus(rawStatus);
  // Treat presence of a results[] as implicit success — we've seen RH
  // omit/lag the status field in some webhook deliveries even when the
  // job clearly finished and produced output URLs.
  const looksLikeSuccess =
    mapped === "success" ||
    (mapped !== "failed" && Array.isArray(eventData?.results) && eventData.results.length > 0);

  try {
    if (looksLikeSuccess) {
      if (gen.type === "nsfw-video-motion") {
        // Pass the FULL body too — sometimes the URLs are at top-level
        // and our envelope-resolver picked the wrong layer.
        const outputUrl =
          (await materializeNsfwMotionOutputFromRunpodResponse(eventData)) ||
          (await materializeNsfwMotionOutputFromRunpodResponse(body));
        if (!outputUrl) {
          // RH says SUCCESS but we couldn't find a URL. Do NOT mark this
          // failed and refund — the cron poller will re-query
          // /openapi/v2/query (which often returns the URLs in a more
          // predictable shape) and either succeed or properly fail it.
          console.warn(
            `[RunningHub Callback] motion ${gen.id.slice(0, 8)} SUCCESS without parseable URL; leaving processing for poller. body=${JSON.stringify(body).slice(0, 400)}`,
          );
          return ack({ deferred: true });
        }
        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: "completed",
            outputUrl,
            completedAt: new Date(),
            errorMessage: null,
            providerResponse: {
              runninghub: { taskId, usage: eventData?.usage || null, via: "webhook" },
              outputUrl,
            },
          },
        });
        if (gen.userId && gen.modelId) {
          try {
            enqueueCleanupOldGenerations(gen.userId, gen.modelId);
          } catch {
            /* ignore */
          }
        }
        console.log(`[RunningHub Callback] ✅ motion ${gen.id.slice(0, 8)} → ${outputUrl.slice(0, 72)}…`);
        return ack({ completed: true });
      }

      // Non-motion (Creator Studio etc.) path — be equally tolerant.
      const results =
        (Array.isArray(eventData?.results) && eventData.results) ||
        (Array.isArray(body?.results) && body.results) ||
        (Array.isArray(eventData?.data?.results) && eventData.data.results) ||
        [];
      const rawUrl = extractRunningHubOutputUrl(results);
      if (!rawUrl) {
        console.warn(
          `[RunningHub Callback] ${gen.id.slice(0, 8)} SUCCESS but no URL parseable; leaving for poller. body=${JSON.stringify(body).slice(0, 400)}`,
        );
        return ack({ deferred: true });
      }
      const IMAGE_GENERATION_TYPES = new Set(["synthid-remove", "upscale"]);
      const mimeHint = IMAGE_GENERATION_TYPES.has(gen.type) ? "image/png" : "video/mp4";
      let finalUrl = rawUrl;
      try {
        finalUrl = await mirrorProviderOutputUrl(rawUrl, mimeHint);
      } catch (e) {
        console.warn(`[RunningHub Callback] mirror failed ${gen.id.slice(0, 8)}: ${e?.message}`);
      }
      await prisma.generation.update({
        where: { id: gen.id },
        data: {
          status: "completed",
          outputUrl: finalUrl,
          completedAt: new Date(),
          pipelinePayload: null,
          providerResponse: {
            runninghub: {
              taskId,
              usage: eventData?.usage || null,
              sourceUrl: rawUrl,
              via: "webhook",
            },
            outputUrl: finalUrl,
          },
        },
      });
      if (gen.userId && gen.modelId) {
        try {
          enqueueCleanupOldGenerations(gen.userId, gen.modelId);
        } catch {
          /* ignore */
        }
      }
      console.log(`[RunningHub Callback] ✅ ${gen.id.slice(0, 8)} → ${finalUrl.slice(0, 72)}…`);
      return ack({ completed: true });
    }

    if (mapped === "failed") {
      const errText = pickRunningHubError(eventData) || pickRunningHubError(body) || `RunningHub ${rawStatus || "FAILED"}`;
      await prisma.generation.update({
        where: { id: gen.id },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(errText),
          completedAt: new Date(),
        },
      });
      try {
        await refundGeneration(gen.id);
      } catch {
        /* ignore */
      }
      console.log(`[RunningHub Callback] ❌ ${gen.id.slice(0, 8)}: ${String(errText).slice(0, 160)}`);
      return ack({ failed: true });
    }

    // Unknown shape (no recognizable status, no results). Don't touch the
    // row — the cron poller will resolve it via /openapi/v2/query.
    console.log(
      `[RunningHub Callback] taskId=${taskId.slice(0, 12)}… status=${rawStatus || "?"} (deferred to poller); body keys=${Object.keys(body).slice(0, 12)}`,
    );
    return ack({ deferred: true });
  } catch (e) {
    console.error("[RunningHub Callback] handler error:", e?.message || e);
    return ack();
  }
});

export default router;
