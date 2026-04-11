/**
 * RunPod serverless webhook — RunPod POSTs here when a job completes (optional; polling still works).
 * URL is sent on every RunPod `/run` when `resolveRunpodWebhookUrl()` returns a value:
 *   - RUNPOD_WEBHOOK_URL (full URL), or
 *   - {CALLBACK_BASE_URL}/api/runpod/callback (?secret= when RUNPOD_WEBHOOK_SECRET is set)
 * @see https://docs.runpod.io/serverless/endpoints/webhooks
 */
import express from "express";
import prisma from "../lib/prisma.js";
import { normalizeRunpodNsfwOutput } from "../services/fal.service.js";
import { finalizeNsfwRunpodGeneration } from "../controllers/nsfw.controller.js";
import { refundCredits, refundGeneration } from "../services/credit.service.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import {
  extractCaptionFromRunpodOutput,
  injectModelIntoPrompt,
  parseRunpodHandlerOutput,
} from "../services/img2img.service.js";
import { extractUpscalerImage } from "../services/upscaler.service.js";
import { extractModelCloneXImages } from "../services/modelcloneX.service.js";
import { uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";

const router = express.Router();
const SECRET = process.env.RUNPOD_WEBHOOK_SECRET?.trim();
const RUNPOD_WEBHOOK_BODY_LIMIT = process.env.RUNPOD_WEBHOOK_BODY_LIMIT || "200mb";

// RunPod can send very large callback payloads (base64 image outputs).
// Keep a dedicated high limit here so webhook requests are not rejected with 413.
router.use(express.json({ limit: RUNPOD_WEBHOOK_BODY_LIMIT }));
router.use(express.urlencoded({ extended: true, limit: RUNPOD_WEBHOOK_BODY_LIMIT }));

function verifyWebhook(req) {
  if (!SECRET) {
    if (process.env.NODE_ENV === "production") {
      console.error("[RunPod webhook] RUNPOD_WEBHOOK_SECRET is required in production");
      return false;
    }
    console.warn("[RunPod webhook] RUNPOD_WEBHOOK_SECRET unset — allowing callback (dev only)");
    return true;
  }
  const q = req.query?.secret ?? req.query?.token;
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const header = req.headers["x-runpod-secret"];
  return q === SECRET || header === SECRET || bearer === SECRET;
}

async function findNsfwGenerationByRunpodJobId(jobId) {
  if (!jobId) return null;
  const direct = await prisma.generation.findFirst({
    where: {
      type: "nsfw",
      status: { in: ["processing", "pending"] },
      createdAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      OR: [
        { inputImageUrl: { contains: `"runpodJobId":"${jobId}"` } },
        { inputImageUrl: { contains: `"comfyuiPromptId":"${jobId}"` } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (direct) return direct;

  const rows = await prisma.generation.findMany({
    where: {
      type: "nsfw",
      status: { in: ["processing", "pending"] },
      createdAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    },
    take: 200,
    orderBy: { createdAt: "desc" },
  });
  return rows.find((g) => {
    try {
      const j = typeof g.inputImageUrl === "string" ? JSON.parse(g.inputImageUrl) : g.inputImageUrl;
      return j?.comfyuiPromptId === jobId || j?.runpodJobId === jobId;
    } catch {
      return false;
    }
  }) || null;
}

async function findGenerationByRunpodJobId(jobId, types) {
  if (!jobId) return null;
  const direct = await prisma.generation.findFirst({
    where: {
      type: { in: types },
      status: { in: ["processing", "pending"] },
      createdAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      inputImageUrl: { contains: `"runpodJobId":"${jobId}"` },
    },
    orderBy: { createdAt: "desc" },
  });
  if (direct) return direct;

  const rows = await prisma.generation.findMany({
    where: {
      type: { in: types },
      status: { in: ["processing", "pending"] },
      createdAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  return rows.find((g) => {
    try {
      const j = JSON.parse(g.inputImageUrl || "{}");
      return j?.runpodJobId === jobId;
    } catch { return false; }
  }) || null;
}

async function findDescribeJobByRunpodJobId(jobId) {
  if (!jobId) return null;
  const direct = await prisma.generation.findFirst({
    where: {
      type: "img2img-describe",
      status: { in: ["processing", "pending"] },
      createdAt: { gt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      inputImageUrl: { contains: `"runpodJobId":"${jobId}"` },
    },
    orderBy: { createdAt: "desc" },
  });
  if (direct) return direct;

  const rows = await prisma.generation.findMany({
    where: {
      type: "img2img-describe",
      status: { in: ["processing", "pending"] },
      createdAt: { gt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
    },
    take: 50,
    orderBy: { createdAt: "desc" },
  });
  return rows.find((g) => {
    try {
      const j = JSON.parse(g.inputImageUrl || "{}");
      return j?.runpodJobId === jobId;
    } catch {
      return false;
    }
  }) || null;
}

async function handleRunpodCallback(req, res) {
  if (!verifyWebhook(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    // Some providers/proxies may deliver webhook fields via query params on GET.
    // Prefer JSON body when present; otherwise fall back to query.
    const body =
      req.body && typeof req.body === "object" && Object.keys(req.body).length > 0
        ? req.body
        : (req.query || {});
    const jobId = body.id || body.requestId || body.jobId;
    const st = String(body.status || body.state || body.jobStatus || "").toUpperCase();
    const rawOut = body.output ?? body.result ?? body.data?.output ?? body.data ?? null;

    if (!jobId) {
      // Health/probe style callback with only secret in query — acknowledge.
      if (req.method === "GET") {
        return res.status(200).json({ ok: true, probe: true });
      }
      return res.status(200).json({ ok: false, reason: "no_job_id" });
    }

    // ── Check for img2img-describe job first ─────────────────────────────────
    const describeGen = await findDescribeJobByRunpodJobId(jobId);
    if (describeGen) {
      if (st === "FAILED" || st === "CANCELLED") {
        const msg = rawOut?.error || body.error || "RunPod describe job failed";
        await prisma.generation.updateMany({
          where: { id: describeGen.id, status: { in: ["processing", "pending"] } },
          data: { status: "failed", errorMessage: getErrorMessageForDb(String(msg)), completedAt: new Date() },
        });
        return res.status(200).json({ ok: true, type: "describe", failed: true });
      }

      if (st === "COMPLETED") {
        const caption = extractCaptionFromRunpodOutput(rawOut);
        if (!caption) {
          await prisma.generation.update({
            where: { id: describeGen.id },
            data: { status: "failed", errorMessage: "JoyCaption returned no text" },
          });
          return res.status(200).json({ ok: true, type: "describe", failed: true, reason: "no_caption" });
        }

        let meta = {};
        try { meta = JSON.parse(describeGen.inputImageUrl || "{}"); } catch {}
        const { triggerWord = "", lookDescription = "" } = meta;

        let prompt;
        try {
          prompt = await injectModelIntoPrompt(caption, triggerWord, lookDescription);
        } catch (grokErr) {
          console.error("[RunPod webhook] Grok inject failed:", grokErr.message);
          prompt = caption;
        }

        await prisma.generation.update({
          where: { id: describeGen.id },
          data: {
            status: "completed",
            pipelinePayload: JSON.stringify({ prompt, rawDescription: caption }),
            completedAt: new Date(),
          },
        });
        console.log(`✅ [RunPod webhook] describe job ${describeGen.id} completed`);
        return res.status(200).json({ ok: true, type: "describe" });
      }

      return res.status(200).json({ ok: true, skipped: true, type: "describe", status: st });
    }

    // ── Upscaler / Soul-X generation ─────────────────────────────────────────
    const imageGen = await findGenerationByRunpodJobId(jobId, ["upscale", "modelclone-x", "soulx"]);
    if (imageGen) {
      if (st === "FAILED" || st === "CANCELLED") {
        const msg = rawOut?.error || body.error || "RunPod job failed";
        await refundGeneration(imageGen.id).catch(() => {});
        await prisma.generation.updateMany({
          where: { id: imageGen.id, status: { in: ["processing", "pending"] } },
          data: { status: "failed", errorMessage: getErrorMessageForDb(String(msg)), completedAt: new Date() },
        });
        console.log(`[RunPod webhook] ${imageGen.type} job ${imageGen.id} failed: ${msg}`);
        return res.status(200).json({ ok: true, type: imageGen.type, failed: true });
      }

      if (st === "COMPLETED") {
        // Extract image — upscaler returns single image, soulx returns array
        let imageData = null;
        if (imageGen.type === "upscale") {
          imageData = extractUpscalerImage(rawOut);
        } else {
          const imgs = extractModelCloneXImages(rawOut);
          imageData = imgs[0] || null;
        }

        if (!imageData) {
          const msg = "RunPod completed but returned no image";
          console.warn(`[RunPod webhook] ${imageGen.type} COMPLETED but no image in output for ${jobId}`);
          await refundGeneration(imageGen.id).catch(() => {});
          await prisma.generation.updateMany({
            where: { id: imageGen.id, status: { in: ["processing", "pending"] } },
            data: { status: "failed", errorMessage: msg, completedAt: new Date() },
          });
          return res.status(200).json({ ok: true, type: imageGen.type, failed: true, reason: "no_image" });
        }

        let outputUrl;
        try {
          if (imageData.startsWith("http")) {
            outputUrl = imageData;
          } else {
            const buf = Buffer.from(imageData, "base64");
            outputUrl = await uploadBufferToBlobOrR2(buf, imageGen.type, "png", "image/png");
          }
        } catch (uploadErr) {
          console.error(`[RunPod webhook] ${imageGen.type} upload error:`, uploadErr.message);
          outputUrl = `data:image/png;base64,${imageData}`;
        }

        await prisma.generation.update({
          where: { id: imageGen.id },
          data: { status: "completed", outputUrl, completedAt: new Date() },
        });
        console.log(`✅ [RunPod webhook] ${imageGen.type} job ${imageGen.id} completed → ${outputUrl.slice(0, 80)}`);
        return res.status(200).json({ ok: true, type: imageGen.type });
      }

      return res.status(200).json({ ok: true, skipped: true, type: imageGen.type, status: st });
    }

    // ── NSFW generation ───────────────────────────────────────────────────────
    const gen = await findNsfwGenerationByRunpodJobId(jobId);
    if (!gen) {
      console.warn(`[RunPod webhook] no processing generation for job ${jobId}`);
      return res.status(200).json({ ok: true, skipped: true, reason: "no_generation" });
    }

    if (st === "FAILED" || st === "CANCELLED") {
      const msg = rawOut?.error || body.error || "RunPod job failed";
      try {
        await refundGeneration(gen.id);
      } catch (e) {
        console.error("[RunPod webhook] refund:", e.message);
      }
      await prisma.generation.updateMany({
        where: { id: gen.id, status: { in: ["processing", "pending"] } },
        data: {
          status: "failed",
          errorMessage: getErrorMessageForDb(String(msg)),
          completedAt: new Date(),
        },
      });
      return res.status(200).json({ ok: true, failed: true });
    }

    if (st !== "COMPLETED") {
      return res.status(200).json({ ok: true, skipped: true, status: st });
    }

    const out = normalizeRunpodNsfwOutput(parseRunpodHandlerOutput(rawOut) ?? rawOut);
    if (!out?.images?.length) {
      console.warn(`[RunPod webhook] COMPLETED but no images for ${jobId}`);
      return res.status(200).json({ ok: true, skipped: true, reason: "no_images" });
    }

    await finalizeNsfwRunpodGeneration(gen.id, jobId, out);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[RunPod webhook]", e);
    // 200 so RunPod does not hammer retries; fix via polling / logs
    return res.status(200).json({ ok: false, error: e.message });
  }
}

router.post("/callback", handleRunpodCallback);
router.get("/callback", handleRunpodCallback);

export default router;
