/**
 * PiAPI.ai webhook callback — piapi POSTs here when a Seedance 2 task completes.
 *
 * Payload shape:
 * {
 *   code: 200,
 *   data: {
 *     task_id: string,
 *     status: "Completed" | "Processing" | "Pending" | "Failed" | "Staged",
 *     output: { video: string } | null,
 *     error: { code: number, message: string }
 *   },
 *   message: "success"
 * }
 *
 * Always respond 200 so piapi does not retry on transient handler errors.
 */
import express from "express";
import prisma from "../lib/prisma.js";
import { refundGeneration } from "../services/credit.service.js";
import { mirrorProviderOutputUrl } from "../utils/kieUpload.js";
import { getErrorMessageForDb } from "../lib/userError.js";

const router = express.Router();

function ack(res, msg = "ok") {
  if (!res.headersSent) res.status(200).json({ received: true, msg });
}

router.options("/", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

router.post("/", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  let taskId = null;
  try {
    const payload = req.body || {};
    const data = payload.data || {};
    taskId = String(data.task_id || "").trim();
    const status = String(data.status || "").toLowerCase();
    const outputVideo = data.output?.video || null;
    const errorMsg = data.error?.message || null;

    if (!taskId) {
      console.warn("[PiAPI Callback] No task_id in payload:", JSON.stringify(payload).slice(0, 200));
      return ack(res, "no task_id");
    }

    console.log(`[PiAPI Callback] task_id=${taskId} status=${status} hasVideo=${!!outputVideo}`);

    // Ignore intermediate states — only act on terminal states
    if (status !== "completed" && status !== "failed") {
      return ack(res, "intermediate state");
    }

    const gen = await prisma.generation.findFirst({
      where: { providerTaskId: taskId },
      select: {
        id: true,
        userId: true,
        status: true,
        type: true,
        providerTaskId: true,
      },
    });

    if (!gen) {
      console.warn(`[PiAPI Callback] No generation found for task_id=${taskId.slice(0, 16)}`);
      return ack(res, "generation not found");
    }

    if (gen.status === "completed") {
      console.log(`[PiAPI Callback] Generation ${gen.id.slice(0, 8)} already completed, ack`);
      return ack(res, "already completed");
    }

    if (status === "completed" && outputVideo) {
      const finalUrl = await mirrorProviderOutputUrl(outputVideo, "video/mp4");
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: "completed", outputUrl: finalUrl, completedAt: new Date(), pipelinePayload: null },
      });
      console.log(`[PiAPI Callback] Completed gen ${gen.id.slice(0, 8)} → ${finalUrl.slice(0, 80)}`);
    } else {
      const errText = getErrorMessageForDb(errorMsg || `PiAPI task ${status}`);
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: "failed", errorMessage: errText, completedAt: new Date(), pipelinePayload: null },
      });
      try { await refundGeneration(gen.id); } catch (e) {
        console.warn(`[PiAPI Callback] Refund failed for gen ${gen.id.slice(0, 8)}: ${e?.message}`);
      }
      console.warn(`[PiAPI Callback] Failed gen ${gen.id.slice(0, 8)}: ${errText}`);
    }

    return ack(res);
  } catch (err) {
    console.error(`[PiAPI Callback] Unhandled error for task_id=${taskId}:`, err?.message);
    return ack(res, "handler error");
  }
});

export default router;
