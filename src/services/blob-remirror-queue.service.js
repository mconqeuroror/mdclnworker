import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { isVercelBlobConfigured, mirrorExternalUrlToPersistentBlob } from "../utils/kieUpload.js";

const MIRROR_PROVIDER = "blob-remirror";
const MIRROR_STEP = "generation-output";
const MAX_ATTEMPTS = 12;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 25;

let drainInFlight = null;
let deferredDrainTimer = null;

function isBlobUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.includes("vercel-storage.com") || url.includes("blob.vercel.app");
}

function toSafeErrorMessage(err) {
  return String(err?.message || err || "unknown error").slice(0, 500);
}

function buildTaskId(generationId, sourceUrl) {
  const hash = crypto.createHash("sha1").update(String(sourceUrl)).digest("hex").slice(0, 16);
  return `blob-remirror:${generationId}:${hash}`;
}

function parseAttemptInfo(payload) {
  const attempts = Number(payload?.attempts);
  return Number.isFinite(attempts) && attempts > 0 ? attempts : 0;
}

function computeBackoffMs(attempts) {
  const exp = Math.min(10, Math.max(0, attempts - 1));
  return Math.min(MAX_BACKOFF_MS, 60_000 * (2 ** exp));
}

function shouldTreatAsRateLimit(errorMessage) {
  const msg = String(errorMessage || "").toLowerCase();
  return (
    msg.includes("429")
    || msg.includes("rate limit")
    || msg.includes("too many request")
    || msg.includes("quota")
    || msg.includes("throttle")
  );
}

function isDueTask(payload, nowMs) {
  const nextAttemptAt = payload?.nextAttemptAt ? Date.parse(payload.nextAttemptAt) : 0;
  if (!Number.isFinite(nextAttemptAt) || nextAttemptAt <= 0) return true;
  return nextAttemptAt <= nowMs;
}

async function upsertMirrorTask({ generationId, userId, sourceUrl, contentTypeHint, reason }) {
  if (!generationId || !sourceUrl?.startsWith("http")) return;
  const taskId = buildTaskId(generationId, sourceUrl);
  const existing = await prisma.kieTask.findUnique({ where: { taskId } });
  const nowIso = new Date().toISOString();
  const nextPayload = {
    ...(existing?.payload || {}),
    sourceUrl,
    contentTypeHint: contentTypeHint || "image/png",
    reason: reason || existing?.payload?.reason || "deferred-remirror",
    nextAttemptAt: existing?.payload?.nextAttemptAt || nowIso,
    attempts: parseAttemptInfo(existing?.payload),
    queuedAt: existing?.payload?.queuedAt || nowIso,
    lastError: existing?.payload?.lastError || null,
  };

  await prisma.kieTask.upsert({
    where: { taskId },
    update: {
      provider: MIRROR_PROVIDER,
      entityType: "generation",
      entityId: generationId,
      step: MIRROR_STEP,
      userId: userId || existing?.userId || null,
      status: "processing",
      payload: nextPayload,
      errorMessage: existing?.errorMessage || null,
      completedAt: null,
    },
    create: {
      taskId,
      provider: MIRROR_PROVIDER,
      entityType: "generation",
      entityId: generationId,
      step: MIRROR_STEP,
      userId: userId || null,
      status: "processing",
      payload: nextPayload,
    },
  });
}

function scheduleDeferredDrain(delayMs = 20_000) {
  if (deferredDrainTimer) return;
  deferredDrainTimer = setTimeout(() => {
    deferredDrainTimer = null;
    processPendingBlobRemirrorQueue({ limit: DEFAULT_BATCH_LIMIT }).catch(() => {});
  }, Math.max(1000, delayMs));
}

export async function enqueueGenerationBlobRemirror({
  generationId,
  userId = null,
  sourceUrl,
  contentTypeHint = "image/png",
  reason = "mirror-failed",
}) {
  if (!isVercelBlobConfigured()) return;
  if (!generationId || !sourceUrl?.startsWith("http")) return;
  if (isBlobUrl(sourceUrl)) return;
  await upsertMirrorTask({ generationId, userId, sourceUrl, contentTypeHint, reason });
  scheduleDeferredDrain(15_000);
}

export async function processPendingBlobRemirrorQueue({ limit = DEFAULT_BATCH_LIMIT } = {}) {
  if (drainInFlight) return drainInFlight;

  drainInFlight = (async () => {
    if (!isVercelBlobConfigured()) {
      return { scanned: 0, processed: 0, completed: 0, rescheduled: 0, failed: 0, skipped: 0 };
    }

    const now = Date.now();
    const tasks = await prisma.kieTask.findMany({
      where: {
        provider: MIRROR_PROVIDER,
        entityType: "generation",
        status: "processing",
      },
      orderBy: { createdAt: "asc" },
      take: Math.max(1, Math.min(200, limit * 4)),
    });

    const dueTasks = tasks.filter((t) => isDueTask(t.payload || {}, now)).slice(0, limit);
    const stats = {
      scanned: tasks.length,
      processed: 0,
      completed: 0,
      rescheduled: 0,
      failed: 0,
      skipped: 0,
    };

    for (const task of dueTasks) {
      stats.processed += 1;
      const payload = task.payload || {};
      const sourceUrl = String(payload.sourceUrl || "").trim();
      const generationId = task.entityId;
      const attempts = parseAttemptInfo(payload);

      if (!sourceUrl.startsWith("http") || !generationId) {
        stats.failed += 1;
        await prisma.kieTask.update({
          where: { taskId: task.taskId },
          data: { status: "failed", errorMessage: "Invalid mirror payload", completedAt: new Date() },
        });
        continue;
      }

      try {
        const generation = await prisma.generation.findUnique({
          where: { id: generationId },
          select: { id: true, outputUrl: true },
        });
        if (!generation) {
          stats.failed += 1;
          await prisma.kieTask.update({
            where: { taskId: task.taskId },
            data: { status: "failed", errorMessage: "Generation not found", completedAt: new Date() },
          });
          continue;
        }

        if (isBlobUrl(generation.outputUrl)) {
          stats.completed += 1;
          await prisma.kieTask.update({
            where: { taskId: task.taskId },
            data: {
              status: "completed",
              outputUrl: generation.outputUrl,
              errorMessage: null,
              completedAt: new Date(),
              payload: { ...payload, completedAt: new Date().toISOString(), resultUrl: generation.outputUrl },
            },
          });
          continue;
        }

        const persistedUrl = await mirrorExternalUrlToPersistentBlob(sourceUrl, "generations");
        if (!persistedUrl || !isBlobUrl(persistedUrl)) {
          throw new Error("Mirror returned non-blob URL");
        }

        await prisma.generation.update({
          where: { id: generationId },
          data: { outputUrl: persistedUrl },
        });

        stats.completed += 1;
        await prisma.kieTask.update({
          where: { taskId: task.taskId },
          data: {
            status: "completed",
            outputUrl: persistedUrl,
            errorMessage: null,
            completedAt: new Date(),
            payload: { ...payload, completedAt: new Date().toISOString(), resultUrl: persistedUrl, attempts: attempts + 1 },
          },
        });
      } catch (err) {
        const msg = toSafeErrorMessage(err);
        const nextAttempts = attempts + 1;
        const exhausted = nextAttempts >= MAX_ATTEMPTS;

        if (exhausted) {
          stats.failed += 1;
          await prisma.kieTask.update({
            where: { taskId: task.taskId },
            data: {
              status: "failed",
              errorMessage: msg,
              completedAt: new Date(),
              payload: { ...payload, attempts: nextAttempts, lastError: msg, failedAt: new Date().toISOString() },
            },
          });
          continue;
        }

        const delayMs = shouldTreatAsRateLimit(msg) ? computeBackoffMs(nextAttempts + 1) : computeBackoffMs(nextAttempts);
        const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
        stats.rescheduled += 1;
        await prisma.kieTask.update({
          where: { taskId: task.taskId },
          data: {
            status: "processing",
            errorMessage: msg,
            payload: {
              ...payload,
              attempts: nextAttempts,
              lastError: msg,
              lastAttemptAt: new Date().toISOString(),
              nextAttemptAt,
            },
          },
        });
      }
    }

    return stats;
  })();

  try {
    return await drainInFlight;
  } finally {
    drainInFlight = null;
  }
}
