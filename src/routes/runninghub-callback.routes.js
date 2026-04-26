/**
 * RunningHub OpenAPI webhook — POST when a task finishes (`event`: `TASK_END`).
 * Body: { event, taskId, eventData } where `eventData` matches `/openapi/v2/query` result fields.
 *
 * Always respond 200 when the payload is parseable so RunningHub does not retry indefinitely.
 * Optional: set RUNNINGHUB_WEBHOOK_SECRET and include the same value in the webhook URL query `secret`
 * (appended automatically by getRunningHubWebhookUrl()) or header `x-runninghub-webhook-secret`.
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
import { materializeNsfwMotionOutputFromRunpodResponse } from "../services/nsfw-motion.service.js";
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
  const taskId = String(body.taskId || body.eventData?.taskId || "").trim();
  const eventData = body.eventData && typeof body.eventData === "object" ? body.eventData : body;

  if (event && event !== "TASK_END") {
    console.log(`[RunningHub Callback] ignored event=${event} taskId=${taskId || "—"}`);
    return ack({ ignored: true });
  }

  if (!taskId) {
    console.warn("[RunningHub Callback] missing taskId");
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

  const status = String(eventData.status || "").toUpperCase();

  try {
    if (status === "SUCCESS") {
      if (gen.type === "nsfw-video-motion") {
        const outputUrl = await materializeNsfwMotionOutputFromRunpodResponse(eventData);
        if (!outputUrl) {
          await prisma.generation.update({
            where: { id: gen.id },
            data: {
              status: "failed",
              errorMessage: getErrorMessageForDb("RunningHub task completed but returned no video URL"),
              completedAt: new Date(),
            },
          });
          try {
            await refundGeneration(gen.id);
          } catch {
            /* ignore */
          }
          console.warn(`[RunningHub Callback] motion ${gen.id.slice(0, 8)} no output URL`);
          return ack();
        }
        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: "completed",
            outputUrl,
            completedAt: new Date(),
            errorMessage: null,
            providerResponse: {
              runninghub: { taskId, usage: eventData.usage || null, via: "webhook" },
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

      const rawUrl = extractRunningHubOutputUrl(eventData.results);
      if (!rawUrl) {
        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: "failed",
            errorMessage: getErrorMessageForDb("RunningHub task completed but returned no output URL"),
            completedAt: new Date(),
          },
        });
        try {
          await refundGeneration(gen.id);
        } catch {
          /* ignore */
        }
        console.warn(`[RunningHub Callback] ${gen.id.slice(0, 8)} SUCCESS but no URL`);
        return ack();
      }
      let finalUrl = rawUrl;
      try {
        finalUrl = await mirrorProviderOutputUrl(rawUrl, "video/mp4");
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
              usage: eventData.usage || null,
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

    if (status === "FAILED" || status === "CANCELLED" || status === "CANCELED") {
      const errText =
        eventData.errorMessage
        || (eventData.failedReason && (eventData.failedReason.message || JSON.stringify(eventData.failedReason).slice(0, 240)))
        || eventData.errorCode
        || `RunningHub ${status}`;
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

    console.log(`[RunningHub Callback] taskId=${taskId.slice(0, 12)}… status=${status || "?"} (no-op)`);
    return ack();
  } catch (e) {
    console.error("[RunningHub Callback] handler error:", e?.message || e);
    return ack();
  }
});

export default router;
