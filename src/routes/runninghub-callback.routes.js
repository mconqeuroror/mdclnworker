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
import { deductCredits, refundGeneration } from "../services/credit.service.js";
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

/** Max JSON body size for RunningHub TASK_END callbacks. */
const RH_CALLBACK_BODY_LIMIT = "4mb";

/**
 * Parse webhook JSON without losing Snowflake-scale task ids. If RH sends
 * `"taskId": 2052460115914858498`, `express.json` decodes it as a IEEE double
 * and the id no longer matches Postgres — we never find the generation row.
 * Rewriting large numeric task ids to strings before `JSON.parse` preserves
 * exact digits.
 */
function parseRunningHubWebhookBody(buf) {
  const raw = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf || "");
  const fixed = raw
    .replace(/"taskId"\s*:\s*(\d{16,})/g, '"taskId":"$1"')
    .replace(/"task_id"\s*:\s*(\d{16,})/g, '"task_id":"$1"');
  return JSON.parse(fixed);
}

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
  const pick = (v) => {
    if (v == null) return "";
    if (typeof v === "bigint") return String(v);
    if (typeof v === "number" && Number.isFinite(v)) {
      if (!Number.isSafeInteger(v)) {
        console.warn(
          "[RunningHub Callback] taskId arrived as unsafe integer — check JSON parsing (large ids must be strings)",
        );
      }
      return String(Math.trunc(v));
    }
    return String(v).trim();
  };
  return pick(
    body.taskId ||
      body.task_id ||
      body.eventData?.taskId ||
      body.eventData?.task_id ||
      body.eventData?.data?.taskId ||
      body.data?.taskId ||
      "",
  );
}

/**
 * Tag every webhook with a short request id so a single delivery can be
 * traced end-to-end across the parse → ack → background-process steps.
 */
function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Synchronous URL extraction — pure in-memory, no network. Picks the best
 * candidate result URL from the webhook payload without mirroring.
 *
 * For motion-x: this is `motionXPreferredResultUrl` (results[2] = lipsync
 * output) with a fallback to the first video.
 * For everything else: `extractRunningHubOutputUrl` (first video, then
 * first image, then any URL).
 */
function pickRawOutputUrlSync({ gen, eventData, body }) {
  if (gen.type === "nsfw-video-motion") {
    const url = pickMotionRawUrl(eventData) || pickMotionRawUrl(body);
    if (url) return url;
  }
  // Non-motion or motion fallback: search every results-like array we know.
  const candidates = [
    eventData?.results,
    body?.results,
    eventData?.data?.results,
    body?.data?.results,
    eventData?.eventData?.results,
    eventData?.eventData?.data?.results,
  ];
  for (const arr of candidates) {
    if (Array.isArray(arr) && arr.length > 0) {
      const u = extractRunningHubOutputUrl(arr);
      if (u) return u;
    }
  }
  return null;
}

/**
 * Replicates motion-x's "results[2] is the final KIARA_AnimateX output"
 * heuristic without importing the heavy mirror codepath.
 */
function pickMotionRawUrl(rp) {
  if (!rp || typeof rp !== "object") return null;
  const candidates = [
    rp.results,
    rp.data?.results,
    rp.eventData?.results,
    rp.eventData?.data?.results,
    rp.body?.results,
    rp.output?.results,
    rp.outputs,
    rp.data?.outputs,
  ];
  let results = null;
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      results = c;
      break;
    }
  }
  if (!results) return null;
  const httpUrl = (row) => {
    if (!row || typeof row !== "object") return null;
    const u = typeof row.url === "string" ? row.url.trim() : "";
    if (u.startsWith("http")) return u;
    const t = typeof row.text === "string" ? row.text.trim() : "";
    return t.startsWith("http") ? t : null;
  };
  const looksVideo = (row, url) => {
    if (!url) return false;
    const ot = String(row?.outputType || row?.type || "").toLowerCase();
    if (ot.includes("video") || ["mp4", "mov", "webm", "m4v"].includes(ot)) return true;
    return /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(url);
  };
  // Preferred slot for motion workflow (KIARA_AnimateX lipsync).
  const preferred = results[2];
  const preferredUrl = httpUrl(preferred);
  if (preferred && preferredUrl && looksVideo(preferred, preferredUrl)) return preferredUrl;
  // Otherwise first video result.
  for (const r of results) {
    const u = httpUrl(r);
    if (u && looksVideo(r, u)) return u;
  }
  // Last resort: any URL.
  for (const r of results) {
    const u = httpUrl(r);
    if (u) return u;
  }
  return null;
}

/**
 * Background mirror — best-effort upgrade of the COS URL to our permanent
 * blob storage. Runs AFTER we've responded 200 to RH and after the row is
 * already marked `completed`. If this fails the user still has a working
 * video for ~24h via the COS URL, and the watchdog can re-mirror later.
 *
 * NOTE: On Vercel serverless this is best-effort only; the function may
 * be terminated after res.send() before the mirror completes. That's
 * acceptable — the row is already completed with a valid (24h) URL, and
 * the watchdog will re-mirror as long as we mark the row as
 * `providerResponse.needsMirror = true`.
 */
async function mirrorOutputUrlInBackground({ rid, gen, taskId, rawUrl, eventData }) {
  const t0 = Date.now();
  try {
    const IMAGE_GENERATION_TYPES = new Set(["synthid-remove", "upscale"]);
    const mimeHint = IMAGE_GENERATION_TYPES.has(gen.type) ? "image/png" : "video/mp4";
    let finalUrl = rawUrl;
    if (gen.type === "nsfw-video-motion") {
      // For motion-x use the dedicated mirror (handles content-type sniffing
      // for the RH/COS quirks specific to that workflow).
      const mirrored = await materializeNsfwMotionOutputFromRunpodResponse({
        results: [{ url: rawUrl, outputType: "mp4" }],
      });
      if (mirrored && mirrored !== rawUrl) finalUrl = mirrored;
    } else {
      try {
        finalUrl = await mirrorProviderOutputUrl(rawUrl, mimeHint);
      } catch (e) {
        console.warn(
          `[RunningHub Callback ${rid}] mirror upgrade failed gen=${gen.id.slice(0, 8)}: ${e?.message}`,
        );
        return;
      }
    }
    if (!finalUrl || finalUrl === rawUrl) {
      console.log(
        `[RunningHub Callback ${rid}] mirror upgrade skipped gen=${gen.id.slice(0, 8)} (no change)`,
      );
      return;
    }
    await prisma.generation.update({
      where: { id: gen.id },
      data: {
        outputUrl: finalUrl,
        providerResponse: {
          runninghub: {
            taskId,
            usage: eventData?.usage || null,
            sourceUrl: rawUrl,
            via: "webhook+mirror",
          },
          outputUrl: finalUrl,
        },
      },
    });
    console.log(
      `[RunningHub Callback ${rid}] 🪞 mirror upgrade gen=${gen.id.slice(0, 8)} → ${finalUrl.slice(0, 72)}… (${Date.now() - t0}ms)`,
    );
  } catch (e) {
    console.error(
      `[RunningHub Callback ${rid}] background mirror error gen=${gen?.id?.slice(0, 8)}:`,
      e?.message || e,
    );
  }
}

router.post("/", express.raw({ type: "*/*", limit: RH_CALLBACK_BODY_LIMIT }), async (req, res) => {
  const rid = shortId();
  const tStart = Date.now();
  const ack = (extra = {}) => {
    if (!res.headersSent) res.status(200).json({ received: true, ...extra });
  };

  if (!verifyWebhookSecret(req)) {
    console.warn(`[RunningHub Callback ${rid}] secret mismatch — refusing 401`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  let body = {};
  try {
    body = parseRunningHubWebhookBody(req.body);
    if (!body || typeof body !== "object") body = {};
  } catch (e) {
    console.warn(`[RunningHub Callback ${rid}] invalid JSON body:`, e?.message || e);
    return ack({ parseError: true });
  }

  const isMotionXGen = (g) => g?.type === "nsfw-video-motion";
  const logPfx = (g) =>
    isMotionXGen(g) ? `[Motion-X/RunningHub ${rid}]` : `[RunningHub Callback ${rid}]`;
  const event = String(body.event || "").toUpperCase();
  const taskId = resolveTaskId(body);
  const eventData = resolveEventData(body);

  // Always log that we received SOMETHING — without this, "no callback ever
  // arrived" and "callback arrived but we ignored it" look identical from
  // production logs.
  console.log(
    `[RunningHub Callback ${rid}] hit event=${event || "(none)"} taskId=${taskId ? `${taskId.slice(0, 12)}…` : "—"} keys=${Object.keys(body).slice(0, 8).join(",")}`,
  );

  if (event && event !== "TASK_END") {
    console.log(`[RunningHub Callback ${rid}] ignored event=${event} taskId=${taskId || "—"}`);
    return ack({ ignored: true });
  }

  if (!taskId) {
    console.warn(
      `[RunningHub Callback ${rid}] missing taskId; body keys=${Object.keys(body).slice(0, 20).join(",")} raw=${JSON.stringify(body).slice(0, 300)}`,
    );
    return ack();
  }

  let gen;
  try {
    gen = await findGenerationForRunningHubTask(taskId);
  } catch (e) {
    console.error(`[RunningHub Callback ${rid}] find generation error:`, e?.message);
    return ack();
  }

  if (!gen) {
    console.warn(`[RunningHub Callback ${rid}] no generation for taskId=${taskId.slice(0, 12)}…`);
    return ack();
  }

  const lp = logPfx(gen);

  // True duplicate — already delivered.
  if (gen.status === "completed" && gen.outputUrl) {
    console.log(`${lp} duplicate gen=${gen.id.slice(0, 8)} already completed`);
    return ack({ duplicate: true });
  }

  const rawStatus = pickRunningHubStatus(eventData) || pickRunningHubStatus(body);
  const mapped = mapRunningHubQueryStatus(rawStatus);

  const rawUrlEarly = pickRawOutputUrlSync({ gen, eventData, body });
  const hasTopLevelResults =
    (Array.isArray(eventData?.results) && eventData.results.length > 0) ||
    (Array.isArray(body?.results) && body.results.length > 0) ||
    (Array.isArray(body?.eventData?.results) && body.eventData.results.length > 0);

  const looksLikeSuccess =
    mapped === "success" ||
    (mapped !== "failed" && (hasTopLevelResults || Boolean(rawUrlEarly)));

  /**
   * RunPod watchdog polls RunningHub sooner than TASK_END arrives. RH has been
   * observed to return transient / lagging FAILURE while the workflow is
   * still finishing; we mark `failed`, then TASK_END succeeds. Without this,
   * we ack "duplicate" and the user never gets the video (production logs:
   * "duplicate gen=… already status=failed").
   */
  const recoveringFromFalseFailure =
    gen.status === "failed" &&
    !gen.outputUrl &&
    looksLikeSuccess &&
    Boolean(rawUrlEarly);

  if (gen.status !== "processing" && !recoveringFromFalseFailure) {
    console.log(
      `${lp} skip gen=${gen.id.slice(0, 8)} status=${gen.status} (not processing; no late-success recovery)`,
    );
    return ack({ duplicate: true });
  }

  if (recoveringFromFalseFailure) {
    console.warn(
      `${lp} 🔁 recovering gen=${gen.id.slice(0, 8)} from status=failed — applying TASK_END success (watchdog/callback race)`,
    );
  }

  console.log(
    `${lp} gen=${gen.id.slice(0, 8)} type=${gen.type} rawStatus=${rawStatus || "(none)"} mapped=${mapped} success=${looksLikeSuccess}`,
  );

  if (looksLikeSuccess) {
    // Fast path: pick the raw COS URL synchronously (in-memory, no
    // network), mark the row `completed` immediately, ack RH, and mirror
    // to permanent storage in the background.
    //
    // Why this shape: on Vercel the function is terminated as soon as
    // res.send() returns, so any setImmediate/work-after-ack does NOT
    // reliably run. Updating the DB BEFORE ack guarantees the user sees
    // their finished video the moment RH posts to us (via the 24h-valid
    // COS URL). The background mirror is a best-effort upgrade — if it
    // doesn't finish, the watchdog re-mirrors next cron tick.
    const rawUrl = rawUrlEarly || pickRawOutputUrlSync({ gen, eventData, body });
    if (!rawUrl) {
      console.warn(
        `${lp} gen=${gen.id.slice(0, 8)} SUCCESS without parseable URL; deferring to poller. body=${JSON.stringify(body).slice(0, 400)}`,
      );
      return ack({ deferred: true });
    }

    try {
      if (
        recoveringFromFalseFailure &&
        gen.creditsRefunded &&
        gen.userId &&
        typeof gen.creditsCost === "number" &&
        gen.creditsCost > 0
      ) {
        try {
          await deductCredits(gen.userId, gen.creditsCost);
          console.warn(
            `${lp} 💳 Re-charged ${gen.creditsCost} credits (watchdog had refunded after a false failure; reversing for delivered output)`,
          );
        } catch (chargeErr) {
          console.error(
            `${lp} 🚨 VIDEO DELIVERED but credit re-charge failed — manual reconcile user=${gen.userId} gen=${gen.id}: ${chargeErr?.message}`,
          );
        }
      }

      await prisma.generation.update({
        where: { id: gen.id },
        data: {
          status: "completed",
          outputUrl: rawUrl,
          completedAt: new Date(),
          errorMessage: null,
          creditsRefunded: false,
          pipelinePayload: gen.type === "nsfw-video-motion" ? undefined : null,
          providerResponse: {
            runninghub: {
              taskId,
              usage: eventData?.usage || null,
              sourceUrl: rawUrl,
              via: recoveringFromFalseFailure ? "webhook+late-recovery" : "webhook",
            },
            outputUrl: rawUrl,
          },
        },
      });
      console.log(
        `${lp} ✅ completed gen=${gen.id.slice(0, 8)} type=${gen.type} → ${rawUrl.slice(0, 72)}… (${Date.now() - tStart}ms, raw COS)`,
      );
    } catch (e) {
      console.error(`${lp} DB update failed for gen=${gen.id.slice(0, 8)}:`, e?.message || e);
      return ack({ error: true });
    }

    if (gen.userId && gen.modelId) {
      try {
        enqueueCleanupOldGenerations(gen.userId, gen.modelId);
      } catch {
        /* ignore */
      }
    }

    ack({ completed: true });

    // Best-effort mirror to permanent storage. On Vercel this may be cut
    // short by the function terminating; the watchdog will re-mirror on
    // its next cron tick if outputUrl still points to COS.
    setImmediate(() => {
      mirrorOutputUrlInBackground({ rid, gen, taskId, rawUrl, eventData }).catch((e) => {
        console.error(
          `[RunningHub Callback ${rid}] background mirror unhandled:`,
          e?.message || e,
        );
      });
    });
    return;
  }

  if (mapped === "failed") {
    try {
      const errText =
        pickRunningHubError(eventData) ||
        pickRunningHubError(body) ||
        `RunningHub ${rawStatus || "FAILED"}`;
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
      console.log(`${lp} ❌ ${gen.id.slice(0, 8)}: ${String(errText).slice(0, 160)}`);
    } catch (e) {
      console.error(`${lp} failure path error:`, e?.message || e);
    }
    return ack({ failed: true });
  }

  console.log(
    `${lp} gen=${gen.id.slice(0, 8)} status=${rawStatus || "?"} (deferred to poller); body keys=${Object.keys(body).slice(0, 12).join(",")}`,
  );
  return ack({ deferred: true });
});

export default router;
