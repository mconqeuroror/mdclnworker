/**
 * Cross-reference Vercel log inventory with *database* sources that still have truth:
 * - `ApiRequestMetric.routePath` stores the full path (UUIDs not stripped) for sampled requests.
 * - `KieTask` maps `taskId` → `entityId` (generation id) + `userId` + optional `outputUrl`.
 *
 * This can recreate **missing** `Generation` rows when logs show activity and the join succeeds.
 * Does NOT recover credit rows (use disaster-recovery Stripe path for that).
 */
import prisma from "../lib/prisma.js";
import {
  buildMergedVercelMessagesByRequestId,
  buildVercelLogInventoryReport,
  extractGenerationIdFromPath,
  extractGenerationIdsFromVercelMessageText,
  normalizeVercelPath,
} from "./vercel-log-inventory.service.js";
import { isR2Configured, mirrorToR2 } from "../utils/r2.js";

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_URL = "https://api.kie.ai/api/v1";

function extractAllGenerationIdsFromVercelRows(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const p = normalizeVercelPath(row?.requestPath || "");
    const a = extractGenerationIdFromPath(p);
    if (a) set.add(a);
    const p2 = normalizeVercelPath(String(row?.message || ""));
    const b = extractGenerationIdFromPath(p2);
    if (b) set.add(b);
    for (const g of extractGenerationIdsFromVercelMessageText(row?.message)) {
      if (g) set.add(g);
    }
  }
  return [...set];
}

/**
 * For each generation id, find a row in api_request_metrics where routePath CONTAINS that id
 * and userId is set (auth was resolved on the server for that request).
 * Only a **sampled** fraction of traffic is stored (TELEMETRY_REQUEST_SAMPLE_RATE, default 1 in env).
 */
export async function mapGenerationIdsToUserIdsFromMetrics(generationIds, since) {
  const out = new Map();
  if (!Array.isArray(generationIds) || generationIds.length === 0) return out;
  const sinceDate = since instanceof Date && !Number.isNaN(since.getTime()) ? since : null;

  const valid = generationIds.filter((g) => g && typeof g === "string" && g.length >= 32);
  if (valid.length === 0) return out;

  /** One query per batch to avoid N round-trips. */
  const batchSize = 30;
  for (let i = 0; i < valid.length; i += batchSize) {
    const batch = valid.slice(i, i + batchSize);
    const rows = await prisma.apiRequestMetric.findMany({
      where: {
        userId: { not: null },
        ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
        OR: batch.map((gid) => ({ routePath: { contains: gid } })),
      },
      orderBy: { createdAt: "asc" },
      select: { userId: true, routePath: true },
    });
    for (const gid of batch) {
      if (out.has(gid)) continue;
      const hit = rows.find((r) => r.userId && r.routePath && r.routePath.includes(gid));
      if (hit) out.set(gid, hit.userId);
    }
  }
  return out;
}

function extractKieOutputUrlFromData(data) {
  if (!data) return null;
  try {
    const resultJson = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
    return (
      resultJson?.resultUrls?.[0] ||
      resultJson?.result_urls?.[0] ||
      resultJson?.url ||
      (Array.isArray(resultJson) && resultJson[0]) ||
      null
    );
  } catch {
    return null;
  }
}

async function fetchKieTaskStatus(taskId) {
  if (!KIE_API_KEY) return { error: "no_kie_key" };
  const res = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { error: `http_${res.status}` };
  const kieJson = await res.json();
  return kieJson?.data ?? kieJson;
}

/**
 * @param {object} opts
 * @param {object[]|null} [opts.vercelLogRows] — for inventory + id extraction
 * @param {string[]} [opts.kieTaskIds] — from inventory regex
 * @param {string[]} [opts.generationIds] — explicit
 * @param {Date} [opts.since] — bound metrics lookup
 * @param {boolean} [opts.dryRun]
 */
export async function restoreUserActivityFromLogsAndDatabaseHints(opts = {}) {
  const dryRun = opts.dryRun !== false;
  const since = opts.since instanceof Date ? opts.since : null;
  const rows = Array.isArray(opts.vercelLogRows) ? opts.vercelLogRows : [];

  const inventory = rows.length
    ? buildVercelLogInventoryReport(rows)
    : { totalRows: 0, kieTaskIds: [], generationIdsInPaths: [] };
  const fromPaths = extractAllGenerationIdsFromVercelRows(rows);
  const fromInvG = Array.isArray(inventory.generationIdsInPaths) ? inventory.generationIdsInPaths : [];
  const explicitG = Array.isArray(opts.generationIds) ? opts.generationIds : [];
  const kieFromOpts = Array.isArray(opts.kieTaskIds) ? opts.kieTaskIds : [];
  const kieFromInv = Array.isArray(inventory.kieTaskIds) ? inventory.kieTaskIds : [];

  const mergedBlobs = rows.length ? buildMergedVercelMessagesByRequestId(rows) : new Map();
  const fromMergedMessages = new Set();
  const kieFromMergedRid = new Set();
  const reKieCb = /\[KIE Callback\]\s*taskId=([a-f0-9]+)/gi;
  for (const text of mergedBlobs.values()) {
    for (const g of extractGenerationIdsFromVercelMessageText(text)) {
      if (g) fromMergedMessages.add(g);
    }
    let m;
    const r = new RegExp(reKieCb.source, "gi");
    while ((m = r.exec(text)) !== null) {
      if (m[1]) kieFromMergedRid.add(m[1]);
    }
  }

  const allKie = [...new Set([...kieFromOpts, ...kieFromInv, ...kieFromMergedRid].filter(Boolean))];

  const kieRows = allKie.length
    ? await prisma.kieTask.findMany({
        where: { taskId: { in: allKie } },
        select: {
          taskId: true,
          entityId: true,
          entityType: true,
          userId: true,
          status: true,
          outputUrl: true,
          payload: true,
        },
      })
    : [];

  const fromKieEntityIds = kieRows
    .filter((k) => k.entityType === "generation" && k.entityId)
    .map((k) => k.entityId);
  const allGenIds = [
    ...new Set([...fromPaths, ...fromInvG, ...explicitG, ...fromKieEntityIds, ...fromMergedMessages]),
  ];

  const metricsMap = allGenIds.length
    ? await mapGenerationIdsToUserIdsFromMetrics(allGenIds, since)
    : new Map();

  const report = {
    dryRun,
    vercel: {
      totalRows: inventory.totalRows || 0,
      byFamily: inventory.byFamily,
      countGenerationIdsInPaths: (inventory.generationIdsInPaths || []).length,
      mergedRequestIdBlobs: mergedBlobs.size,
      extraGenerationIdsFromMergedBlobs: fromMergedMessages.size,
      extraKieTaskIdsFromMergedBlobs: kieFromMergedRid.size,
    },
    metricsUserMatches: Object.fromEntries(metricsMap),
    kieTaskRows: kieRows.length,
    generations: { examined: 0, alreadyExist: 0, created: 0, skipped: 0, details: [] },
  };

  /** @type {Map<string, { taskId: string, userId: string|null, outputUrl: string|null, entityId: string }>} */
  const byGenId = new Map();
  for (const kt of kieRows) {
    if (kt.entityType === "generation" && kt.entityId) {
      if (!byGenId.has(kt.entityId)) {
        byGenId.set(kt.entityId, {
          taskId: kt.taskId,
          userId: kt.userId,
          outputUrl: kt.outputUrl,
          entityId: kt.entityId,
        });
      }
    }
  }
  const needKieByEntity = allGenIds.filter((g) => g && !byGenId.has(g));
  if (needKieByEntity.length) {
    const more = await prisma.kieTask.findMany({
      where: { entityType: "generation", entityId: { in: needKieByEntity } },
      orderBy: { createdAt: "desc" },
    });
    for (const kt of more) {
      if (!byGenId.has(kt.entityId)) {
        byGenId.set(kt.entityId, {
          taskId: kt.taskId,
          userId: kt.userId,
          outputUrl: kt.outputUrl,
          entityId: kt.entityId,
        });
      }
    }
  }

  for (const genId of allGenIds) {
    report.generations.examined += 1;
    if (!genId) continue;
    const existing = await prisma.generation.findUnique({
      where: { id: genId },
      select: { id: true, userId: true, status: true, outputUrl: true },
    });
    if (existing) {
      report.generations.alreadyExist += 1;
      report.generations.details.push({ genId, action: "skip_exists" });
      continue;
    }

    const kie = byGenId.get(genId) || null;
    const userId = kie?.userId || metricsMap.get(genId) || null;

    if (!userId) {
      report.generations.skipped += 1;
      report.generations.details.push({ genId, action: "skip_no_user", note: "no userId from ApiRequestMetric or KieTask" });
      continue;
    }

    if (!kie) {
      report.generations.skipped += 1;
      report.generations.details.push({
        genId,
        userId,
        action: "skip_no_kie",
        note: "no KieTask for this generation id — cannot fetch provider output",
      });
      continue;
    }

    let outputUrl = kie?.outputUrl || null;
    let replicate = kie ? `kie-task:${kie.taskId}` : null;
    let st = "completed";
    if (kie && !outputUrl) {
      const d = await fetchKieTaskStatus(kie.taskId);
      if (d?.state && String(d.state).toLowerCase() === "success") {
        outputUrl = extractKieOutputUrlFromData(d) || d?.url || null;
      } else {
        st = "failed";
        report.generations.details.push({
          genId,
          action: dryRun ? "would_recover" : "recover",
          kieState: d?.state || d?.error,
        });
      }
    }
    if (outputUrl && isR2Configured() && !dryRun) {
      try {
        outputUrl = await mirrorToR2(outputUrl, "generations");
      } catch (e) {
        console.warn("[user-activity-restore] r2 mirror:", e?.message);
      }
    }

    if (dryRun) {
      report.generations.details.push({ genId, userId, action: "would_create", outputUrl: outputUrl || null, replicate, status: st });
      continue;
    }

    try {
      await prisma.generation.create({
        data: {
          id: genId,
          userId,
          type: "image",
          prompt: "Restored from Vercel log + KIE/metrics correlation",
          creditsCost: 0,
          status: st,
          outputUrl: outputUrl || null,
          replicateModel: replicate,
          completedAt: st === "completed" && outputUrl ? new Date() : null,
          provider: "kie",
        },
      });
      report.generations.created += 1;
      report.generations.details.push({ genId, userId, action: "created" });
    } catch (e) {
      report.generations.skipped += 1;
      report.generations.details.push({ genId, userId, action: "error", error: e?.message });
    }
  }

  return report;
}
