/**
 * KIE.AI webhook callback — KIE POSTs here when a task completes.
 * Payload: { code, data: { taskId, state, resultJson?, failCode?, failMsg? }, msg }
 * resultJson is a JSON string; parse it to get resultUrls array.
 * Always return 200 OK so KIE does not retry.
 */
import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { refundGeneration, refundCredits } from "../services/credit.service.js";
import { enqueueCleanupOldGenerations } from "../controllers/generation.controller.js";
import { deleteBlobAfterKie, mirrorProviderOutputUrl } from "../utils/kieUpload.js";
import { runPipelineContinuation } from "../services/kie-pipeline-continuation.service.js";
import { getErrorMessageForDb } from "../lib/userError.js";
import { generateImageWithNanoBananaKie } from "../services/kie.service.js";

const router = express.Router();
const WEBHOOK_HMAC_KEY = process.env.WEBHOOK_HMAC_KEY;
const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_URL = "https://api.kie.ai/api/v1";

const CORS_ORIGIN = "https://api.kie.ai";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function upsertKieTask(taskId, entityType, entityId, step, userId, payload = null) {
  if (!taskId) return;
  await prisma.kieTask.upsert({
    where: { taskId },
    update: {
      entityType,
      entityId,
      step,
      userId: userId || null,
      status: "processing",
      payload: payload ?? undefined,
      errorMessage: null,
      outputUrl: null,
      completedAt: null,
    },
    create: {
      taskId,
      entityType,
      entityId,
      step,
      userId: userId || null,
      status: "processing",
      payload: payload ?? undefined,
    },
  });
}

async function markKieTaskCompleted(taskId, outputUrl = null) {
  await prisma.kieTask.updateMany({
    where: { taskId },
    data: {
      status: "completed",
      outputUrl: outputUrl || null,
      errorMessage: null,
      completedAt: new Date(),
    },
  });
}

async function markKieTaskFailed(taskId, errorMessage) {
  await prisma.kieTask.updateMany({
    where: { taskId },
    data: {
      status: "failed",
      errorMessage: getErrorMessageForDb(errorMessage || "KIE callback failed"),
      completedAt: new Date(),
    },
  });
}

function verifyWebhookSignature(body, timestamp, receivedSignature) {
  if (!WEBHOOK_HMAC_KEY || !timestamp || !receivedSignature) return !WEBHOOK_HMAC_KEY;
  const taskId = body?.data?.taskId || body?.taskId || body?.data?.task_id;
  if (!taskId) return false;
  const message = `${taskId}.${timestamp}`;
  const expected = crypto.createHmac("sha256", WEBHOOK_HMAC_KEY).update(message).digest("base64");
  if (expected.length !== receivedSignature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSignature));
  } catch {
    return false;
  }
}

/** Recursively find first string that looks like an HTTP(S) URL in obj (for nested payloads). */
function findFirstHttpUrl(obj, seen = new Set()) {
  if (obj == null || seen.has(obj)) return null;
  if (typeof obj === "string" && obj.startsWith("http")) return obj;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const u = findFirstHttpUrl(item, seen);
      if (u) return u;
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const key of ["url", "outputUrl", "output_url", "video_url", "result_video_url", "result_image_url", "videoUrl", "imageUrl"]) {
      const u = findFirstHttpUrl(obj[key], seen);
      if (u) return u;
    }
    for (const v of Object.values(obj)) {
      const u = findFirstHttpUrl(v, seen);
      if (u) return u;
    }
  }
  return null;
}

/** Parse data.resultJson (JSON string) to get output URL; matches kie.service.js poll extraction + video keys and extra payload shapes. */
function parseResultJsonAndGetUrl(resultJson) {
  if (resultJson == null || resultJson === "") return null;
  try {
    const parsed = typeof resultJson === "string" ? JSON.parse(resultJson) : resultJson;
    const urls = parsed?.resultUrls ?? parsed?.result_urls ?? parsed?.output_urls ?? parsed?.urls;
    if (Array.isArray(urls) && urls[0]) {
      const first = typeof urls[0] === "string" ? urls[0] : urls[0]?.url ?? urls[0]?.href;
      if (first && typeof first === "string" && first.startsWith("http")) return first;
    }
    const single =
      parsed?.url ?? parsed?.video_url ?? parsed?.result_video_url ?? parsed?.result_image_url
      ?? parsed?.outputUrl ?? parsed?.output_url
      ?? parsed?.result?.url ?? parsed?.result?.outputUrl ?? parsed?.result?.output_url
      ?? parsed?.result?.video_url ?? parsed?.result?.result_video_url ?? parsed?.result?.result_image_url
      ?? parsed?.data?.url ?? parsed?.data?.outputUrl ?? parsed?.data?.output_url
      ?? (Array.isArray(parsed?.result?.resultUrls) ? parsed.result.resultUrls[0] : null)
      ?? (Array.isArray(parsed?.result?.result_urls) ? parsed.result.result_urls[0] : null)
      ?? (Array.isArray(parsed?.outputs) && typeof parsed.outputs[0] === "string" ? parsed.outputs[0] : null)
      ?? (parsed?.outputs?.[0]?.url ?? parsed?.outputs?.[0])
      ?? (parsed?.files?.[0]?.url ?? (typeof parsed?.files?.[0] === "string" && parsed.files[0]))
      ?? (parsed?.images?.[0]?.url ?? (typeof parsed?.images?.[0] === "string" && parsed.images[0]))
      ?? (parsed?.videos?.[0]?.url ?? (typeof parsed?.videos?.[0] === "string" && parsed.videos[0]));
    if (single && typeof single === "string" && single.startsWith("http")) return single;
    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "string" && parsed[0].startsWith("http"))
      return parsed[0];
    return findFirstHttpUrl(parsed);
  } catch {}
  return null;
}

// OPTIONS preflight — CORS for KIE
router.options("/", (req, res) => {
  setCorsHeaders(res);
  res.status(200).end();
});

// Raw body: mounted before express.json() in server.js
router.post("/", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  setCorsHeaders(res);
  const ack = () => {
    if (!res.headersSent) res.status(200).json({ code: 200, msg: "received" });
  };

  try {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString("utf8"));
      } catch {
        console.warn("[KIE Callback] Invalid JSON body (raw buffer)");
        return ack();
      }
    } else if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        console.warn("[KIE Callback] Invalid JSON body");
        return ack();
      }
    }
    if (!body || typeof body !== "object") {
      console.warn("[KIE Callback] Invalid body");
      return ack();
    }

    const code = body.code;
    const data = body.data || {};
    const taskId = data.taskId ?? body.taskId ?? data.task_id ?? body.task_id;
    const state = data.state; // "success" | "fail"
    const resultJson = data.resultJson; // JSON string
    const failCode = data.failCode ?? null;
    const failMsg = data.failMsg ?? null;
    const msg = body.msg || "";

    let resultUrls = [];
    if (Array.isArray(data.resultUrls) && data.resultUrls.length) {
      resultUrls = data.resultUrls;
    } else if (Array.isArray(body.resultUrls) && body.resultUrls.length) {
      resultUrls = body.resultUrls;
    } else if (resultJson != null) {
      try {
        const parsed = typeof resultJson === "string" ? JSON.parse(resultJson) : resultJson;
        resultUrls = Array.isArray(parsed?.resultUrls)
          ? parsed.resultUrls
          : Array.isArray(parsed?.result_urls)
            ? parsed.result_urls
            : Array.isArray(parsed?.output_urls)
              ? parsed.output_urls
              : Array.isArray(parsed?.urls)
                ? parsed.urls
                : [];
        if (resultUrls.length === 0) {
          const one = parseResultJsonAndGetUrl(resultJson);
          if (one) resultUrls = [one];
        }
      } catch {}
    }

    console.log("[KIE Callback] taskId=%s state=%s resultUrls=%s", taskId ?? "?", state ?? "?", JSON.stringify(resultUrls));

    if (!taskId || typeof taskId !== "string") {
      console.warn("[KIE Callback] Missing taskId — keys: " + (body ? Object.keys(body).join(",") : "none"));
      return ack();
    }

    const mappedTask = await prisma.kieTask.findUnique({
      where: { taskId },
    });
    if (mappedTask?.status === "completed") {
      console.log("[KIE Callback] Task %s already completed, ack", taskId.slice(0, 12));
      return ack();
    }

    if (WEBHOOK_HMAC_KEY) {
      const ts = req.headers["x-webhook-timestamp"];
      const sig = req.headers["x-webhook-signature"];
      if (!verifyWebhookSignature(body, ts, sig)) {
        console.warn("[KIE Callback] Invalid signature");
        if (!res.headersSent) return res.status(401).json({ error: "Invalid signature" });
        return;
      }
    } else if (process.env.NODE_ENV === "production") {
      console.warn("[KIE Callback] WEBHOOK_HMAC_KEY missing in production — rejecting unverified callback");
      if (!res.headersSent) return res.status(503).json({ error: "Webhook signing not configured" });
      return;
    }

    const normalizedState = String(state || "").toLowerCase();
    const successStates = new Set(["success", "succeeded", "completed", "finished", "done"]);
    const failedStates = new Set(["fail", "failed", "error", "canceled", "cancelled"]);
    const nonTerminalStates = new Set(["waiting", "queued", "queuing", "processing", "generating", "running", "pending", "submitted", "created", "starting"]);
    const isTerminalSuccess = successStates.has(normalizedState);
    const isTerminalFailure = failedStates.has(normalizedState);
    let outputUrl = null;
    if (isTerminalSuccess || code === 200) {
      outputUrl =
        parseResultJsonAndGetUrl(resultJson)
        || (resultUrls[0] && typeof resultUrls[0] === "string" && resultUrls[0].startsWith("http") ? resultUrls[0] : null)
        || (data.outputUrl && data.outputUrl.startsWith("http") ? data.outputUrl : null)
        || (data.output_url && data.output_url.startsWith("http") ? data.output_url : null)
        || (data.resultUrl && data.resultUrl.startsWith("http") ? data.resultUrl : null)
        || (data.url && data.url.startsWith("http") ? data.url : null)
        || (data.video_url && data.video_url.startsWith("http") ? data.video_url : null)
        || (body.outputUrl && body.outputUrl.startsWith("http") ? body.outputUrl : null)
        || (body.output_url && body.output_url.startsWith("http") ? body.output_url : null)
        || (body.result?.outputUrl && body.result.outputUrl.startsWith("http") ? body.result.outputUrl : null)
        || (body.result?.url && body.result.url.startsWith("http") ? body.result.url : null);
      if (!outputUrl && KIE_API_KEY) {
        try {
          const r = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
            headers: { Authorization: `Bearer ${KIE_API_KEY}` },
            signal: AbortSignal.timeout(15_000),
          });
          if (r.ok) {
            const j = await r.json();
            const d = j?.data ?? j;
            outputUrl =
              parseResultJsonAndGetUrl(d?.resultJson)
              || (d?.resultUrls?.[0] && d.resultUrls[0].startsWith("http") ? d.resultUrls[0] : null)
              || (d?.result_urls?.[0] && d.result_urls[0].startsWith("http") ? d.result_urls[0] : null)
              || (d?.video_url && d.video_url.startsWith("http") ? d.video_url : null)
              || (d?.result_video_url && d.result_video_url.startsWith("http") ? d.result_video_url : null)
              || (d?.outputUrl && d.outputUrl.startsWith("http") ? d.outputUrl : null)
              || (d?.output_url && d.output_url.startsWith("http") ? d.output_url : null)
              || (d?.url && d.url.startsWith("http") ? d.url : null);
          }
        } catch (e) {
          console.warn("[KIE Callback] recordInfo fallback failed:", e?.message);
        }
      }
      if (!outputUrl) {
        console.warn("[KIE Callback] success but no outputUrl — taskId=%s dataKeys=%s resultJsonLen=%s", taskId?.slice(0, 12), Object.keys(data || {}).join(","), typeof resultJson === "string" ? resultJson.length : (resultJson ? "obj" : "null"));
      }
    }
    const isSuccess = isTerminalSuccess || (!normalizedState && !!outputUrl);
    const isFailure = isTerminalFailure || (normalizedState === "fail");

    if (!isSuccess && !isFailure && nonTerminalStates.has(normalizedState)) {
      console.log("[KIE Callback] Non-terminal update taskId=%s state=%s", taskId.slice(0, 12), normalizedState);
      return ack();
    }

    // ── Model-photo generation with dedicated KieTask correlation ───────────────
    if (mappedTask?.entityType === "saved_model_photo") {
      const modelId = mappedTask.entityId;
      const step = mappedTask.step;
      const model = await prisma.savedModel.findUnique({
        where: { id: modelId },
        select: {
          id: true,
          userId: true,
          status: true,
          photo1Url: true,
          photo2Url: true,
          photo3Url: true,
          aiGenerationParams: true,
        },
      });
      if (!model) {
        await markKieTaskFailed(taskId, `Saved model not found (${modelId})`);
        return ack();
      }

      const params = model.aiGenerationParams || {};
      const flow = params.type || mappedTask?.payload?.flow || "model-poses";

      const failModel = async (reason) => {
        const nextParams = { ...params, lastError: reason, failedAt: new Date().toISOString() };
        if ((flow === "advanced-model" || flow === "model-poses") && params?.userId && params?.creditsNeeded && !params?.refundedAt) {
          try {
            await refundCredits(params.userId, Number(params.creditsNeeded));
            nextParams.refundedAt = new Date().toISOString();
          } catch (e) {
            console.error("[KIE Callback] model refund failed:", e?.message);
          }
        }
        await prisma.savedModel.update({
          where: { id: model.id },
          data: { status: "failed", aiGenerationParams: nextParams },
        });
      };

      if (isFailure) {
        const reason = [failCode, failMsg].filter(Boolean).join(" — ") || msg || "KIE task failed";
        await markKieTaskFailed(taskId, reason);
        await failModel(reason);
        return ack();
      }
      if (!outputUrl) {
        await markKieTaskFailed(taskId, "Callback success but no output URL");
        await failModel("Callback success but no output URL");
        return ack();
      }

      const finalUrl = await mirrorProviderOutputUrl(outputUrl, "image/png");
      await markKieTaskCompleted(taskId, finalUrl);

      if (step === "photo1") {
        await prisma.savedModel.update({
          where: { id: model.id },
          data: { photo1Url: finalUrl, thumbnail: finalUrl, status: "processing" },
        });

        if (flow === "model-poses") {
          const referenceUrl = params.referenceUrl;
          const portraitPrompt = params.portraitPrompt;
          const fullBodyPrompt = params.fullBodyPrompt;
          try {
            const [r2, r3] = await Promise.all([
              generateImageWithNanoBananaKie([referenceUrl, finalUrl], portraitPrompt, {
                model: "nano-banana-pro",
                resolution: "2K",
                aspectRatio: "3:4",
                onTaskCreated: async (newTaskId) => {
                  await upsertKieTask(newTaskId, "saved_model_photo", model.id, "photo2", model.userId, { flow: "model-poses" });
                },
              }),
              generateImageWithNanoBananaKie([referenceUrl, finalUrl], fullBodyPrompt, {
                model: "nano-banana-pro",
                resolution: "2K",
                aspectRatio: "9:16",
                onTaskCreated: async (newTaskId) => {
                  await upsertKieTask(newTaskId, "saved_model_photo", model.id, "photo3", model.userId, { flow: "model-poses" });
                },
              }),
            ]);

            const nextParams = {
              ...params,
              photo1TaskId: taskId,
              photo2TaskId: r2?.taskId || null,
              photo3TaskId: r3?.taskId || null,
            };
            await prisma.savedModel.update({
              where: { id: model.id },
              data: { aiGenerationParams: nextParams },
            });
          } catch (e) {
            await failModel(e?.message || "Failed submitting photos 2+3");
          }
          return ack();
        }

        // advanced-model: submit photo 2 anchored to generated photo1
        try {
          const cfg1 = params.photoConfigs?.[1];
          if (!cfg1) throw new Error("Missing advanced-model photo config #2");
          const refs2 = [finalUrl];
          const r2 = await generateImageWithNanoBananaKie(refs2, cfg1.fullPrompt, {
            model: "nano-banana-pro",
            resolution: "2K",
            aspectRatio: cfg1.aspectRatio,
            onTaskCreated: async (newTaskId) => {
              await upsertKieTask(newTaskId, "saved_model_photo", model.id, "photo2", model.userId, { flow: "advanced-model" });
            },
          });
          await prisma.savedModel.update({
            where: { id: model.id },
            data: {
              aiGenerationParams: { ...params, photo1TaskId: taskId, photo2TaskId: r2?.taskId || null, generatedUrls: [finalUrl] },
            },
          });
        } catch (e) {
          await failModel(e?.message || "Failed submitting advanced photo2");
        }
        return ack();
      }

      if (step === "photo2") {
        await prisma.savedModel.update({ where: { id: model.id }, data: { photo2Url: finalUrl, status: "processing" } });

        if (flow === "advanced-model") {
          try {
            const refreshed = await prisma.savedModel.findUnique({
              where: { id: model.id },
              select: { photo1Url: true },
            });
            const photo1Url = refreshed?.photo1Url || params.generatedUrls?.[0];
            const cfg2 = params.photoConfigs?.[2];
            if (!cfg2 || !photo1Url) throw new Error("Missing photo1/cfg for advanced photo3");
            // advanced-model: submit photo 3 anchored to generated photo1
            const refs3 = [photo1Url];
            const r3 = await generateImageWithNanoBananaKie(refs3, cfg2.fullPrompt, {
              model: "nano-banana-pro",
              resolution: "2K",
              aspectRatio: cfg2.aspectRatio,
              onTaskCreated: async (newTaskId) => {
                await upsertKieTask(newTaskId, "saved_model_photo", model.id, "photo3", model.userId, { flow: "advanced-model" });
              },
            });
            await prisma.savedModel.update({
              where: { id: model.id },
              data: {
                aiGenerationParams: {
                  ...params,
                  photo2TaskId: taskId,
                  photo3TaskId: r3?.taskId || null,
                  generatedUrls: [photo1Url, finalUrl],
                },
              },
            });
          } catch (e) {
            await failModel(e?.message || "Failed submitting advanced photo3");
          }
          return ack();
        }
      }

      if (step === "photo3") {
        await prisma.savedModel.update({ where: { id: model.id }, data: { photo3Url: finalUrl, status: "processing" } });
      }

      const refreshed = await prisma.savedModel.findUnique({
        where: { id: model.id },
        select: { photo1Url: true, photo2Url: true, photo3Url: true },
      });
      if (refreshed?.photo1Url && refreshed?.photo2Url && refreshed?.photo3Url) {
        await prisma.savedModel.update({
          where: { id: model.id },
          data: { thumbnail: refreshed.photo1Url, status: "ready" },
        });
      }
      return ack();
    }
    // ── End mapped model-photo handler ───────────────────────────────────────────

    // Pipeline: image -> video (taskId stored in pipelinePayload.imageTaskId on the video gen)
    const pipelineGen = await prisma.generation.findFirst({
      where: { pipelinePayload: { path: ["imageTaskId"], equals: taskId } },
      select: { id: true },
    });
    if (pipelineGen) {
      if (isSuccess && outputUrl) {
        const finalUrl = await mirrorProviderOutputUrl(outputUrl, "image/png");
        await runPipelineContinuation(taskId, finalUrl);
        console.log("[KIE Callback] Paired pipeline gen %s to taskId %s", pipelineGen.id.slice(0, 8), taskId.slice(0, 12));
      } else {
        const errorText = isSuccess ? "Callback success but no output URL" : [failCode, failMsg].filter(Boolean).join(" — ") || msg || "Generation failed";
        await prisma.generation.update({
          where: { id: pipelineGen.id },
          data: { status: "failed", errorMessage: getErrorMessageForDb(errorText), completedAt: new Date(), pipelinePayload: null },
        });
        try { await refundGeneration(pipelineGen.id); } catch {}
        console.log("[KIE Callback] Pipeline gen %s failed: %s", pipelineGen.id.slice(0, 8), errorText);
      }
      return ack();
    }

    const genSelect = {
      id: true,
      userId: true,
      modelId: true,
      creditsCost: true,
      status: true,
      type: true,
      isTrial: true,
    };

    // Retry: KIE may callback before Prisma commits task correlation (kie-task: / kieTask row).
    let gen = null;
    let mappedForGen = mappedTask;
    // KIE callbacks can arrive before Prisma commits correlation.
    // For fail states we still prefer to wait a bit so we can mark Generation failed
    // (otherwise Generation may stay "processing" forever).
    const correlationDelaysMs = isSuccess ? [0, 100, 250, 500, 1000, 2000] : [0, 200, 600, 1200, 2400, 4800];
    for (let attempt = 0; attempt < correlationDelaysMs.length && !gen; attempt++) {
      const delayMs = correlationDelaysMs[attempt];
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (attempt > 0) mappedForGen = await prisma.kieTask.findUnique({ where: { taskId } });

      if (mappedForGen?.entityType === "generation") {
        gen = await prisma.generation.findUnique({
          where: { id: mappedForGen.entityId },
          select: genSelect,
        });
      }
      if (!gen) {
        gen = await prisma.generation.findFirst({
          where: { replicateModel: `kie-task:${taskId}` },
          select: genSelect,
        });
      }
      if (!gen) {
        gen = await prisma.generation.findFirst({
          where: { pipelinePayload: { path: ["videoTaskId"], equals: taskId } },
          select: genSelect,
        });
      }
    }

    if (!gen) {
      const errorText =
        [failCode, failMsg].filter(Boolean).join(" — ") || msg || "KIE task failed but no generation correlation was found";

      // Fail the KIE task row so it doesn't stay "processing" forever.
      await markKieTaskFailed(taskId, errorText);

      console.warn(
        "[KIE Callback] No generation found for taskId %s — marked KieTask failed; check CALLBACK_BASE_URL and replicateModel/pipelinePayload. error=%s",
        taskId?.slice(0, 12),
        errorText?.slice(0, 200),
      );
      return ack();
    }

    const kieTaskRowNow = await prisma.kieTask.findUnique({ where: { taskId } });
    if (!kieTaskRowNow) {
      await upsertKieTask(taskId, "generation", gen.id, "final", gen.userId, { type: gen.type });
    }

    if (gen.status === "completed") {
      console.log("[KIE Callback] Generation %s already completed, ack", gen.id);
      return ack();
    }

    if (isSuccess) {
      if (outputUrl) {
        const isVideoType = ["video", "prompt-video", "recreate-video", "talking-head", "nsfw-video", "nsfw-video-extend", "creator-studio-video"].includes(gen.type);
        const finalUrl = await mirrorProviderOutputUrl(outputUrl, isVideoType ? "video/mp4" : "image/png");
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "completed", outputUrl: finalUrl, completedAt: new Date(), pipelinePayload: null },
        });
        await markKieTaskCompleted(taskId, finalUrl);
        console.log("[KIE Callback] Paired gen %s to taskId %s", gen.id.slice(0, 8), taskId.slice(0, 12));
        if (gen.type === "onboarding_trial_reference" && gen.isTrial && gen.userId) {
          try {
            await prisma.user.update({
              where: { id: gen.userId },
              data: { hasUsedFreeTrial: true },
            });
          } catch (e) {
            console.warn("[KIE Callback] trial hasUsedFreeTrial update failed:", e?.message);
          }
        }
        if (gen.userId && gen.modelId) {
          enqueueCleanupOldGenerations(gen.userId, gen.modelId);
        }
        try {
          // Don't delete input Blobs for video: KIE may still be fetching them (queue delay). Leave for Blob TTL or manual cleanup.
          if (!isVideoType) {
            const row = await prisma.generation.findUnique({
              where: { id: gen.id },
              select: { inputImageUrl: true, inputVideoUrl: true },
            });
            if (row?.inputImageUrl) {
              deleteBlobAfterKie(row.inputImageUrl).catch((err) => {
                console.warn("[KIE Callback] deleteBlobAfterKie inputImageUrl:", err?.message || err);
              });
            }
            if (row?.inputVideoUrl) {
              deleteBlobAfterKie(row.inputVideoUrl).catch((err) => {
                console.warn("[KIE Callback] deleteBlobAfterKie inputVideoUrl:", err?.message || err);
              });
            }
          }
        } catch (e) {
          console.warn("[KIE Callback] input blob cleanup lookup failed:", e?.message || e);
        }
        console.log("[KIE Callback] ✅ %s completed via webhook", gen.id.slice(0, 8));
      } else {
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "failed", errorMessage: getErrorMessageForDb("Callback success but no output URL"), completedAt: new Date(), pipelinePayload: null },
        });
        try { await refundGeneration(gen.id); } catch {}
        await markKieTaskFailed(taskId, "Callback success but no output URL");
        console.warn("[KIE Callback] Success but no URL for %s", gen.id.slice(0, 8));
      }
      } else if (isFailure) {
      const errorText = [failCode, failMsg].filter(Boolean).join(" — ") || msg || "Generation failed";
      if (failCode || failMsg) console.log("[KIE Callback] failCode=%s failMsg=%s", failCode, failMsg);
      await prisma.generation.update({
        where: { id: gen.id },
        data: { status: "failed", errorMessage: getErrorMessageForDb(errorText), completedAt: new Date(), pipelinePayload: null },
      });
      try { await refundGeneration(gen.id); } catch {}
      await markKieTaskFailed(taskId, errorText);
      console.log("[KIE Callback] ❌ %s failed: %s", gen.id.slice(0, 8), errorText);
      } else {
        // Non-terminal callback update: keep generation in processing.
        console.log("[KIE Callback] Waiting for terminal state taskId=%s state=%s", taskId.slice(0, 12), normalizedState || "unknown");
    }
  } catch (err) {
    console.error("[KIE Callback] Unhandled error:", err?.message || err);
    // Still ack so KIE does not retry; processing can be reconciled by poller
  } finally {
    ack();
  }
});

export default router;
