/**
 * KIE "lost generation" recovery — failed rows with kie-task: in replicateModel
 * (same logic as POST /api/admin/lost-generations/reconcile-all).
 */
import prisma from "../lib/prisma.js";
import { isR2Configured, mirrorToR2 } from "../utils/r2.js";

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_URL = "https://api.kie.ai/api/v1";

function parseKieTaskId(replicateModel) {
  if (!replicateModel || typeof replicateModel !== "string") return null;
  if (!replicateModel.startsWith("kie-task:")) return null;
  const taskId = replicateModel.slice("kie-task:".length).trim();
  return taskId || null;
}

function extractKieOutputUrl(data) {
  if (!data || typeof data !== "object") return null;
  let outputUrl = null;
  try {
    const resultJson =
      typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
    outputUrl =
      resultJson?.resultUrls?.[0] ||
      resultJson?.result_urls?.[0] ||
      resultJson?.url ||
      null;
    if (!outputUrl && Array.isArray(resultJson)) outputUrl = resultJson[0] || null;
    if (!outputUrl && typeof resultJson === "string" && resultJson.startsWith("http")) {
      outputUrl = resultJson;
    }
  } catch {
    if (typeof data.resultJson === "string" && data.resultJson.startsWith("http")) {
      outputUrl = data.resultJson;
    }
  }
  return outputUrl || data.resultUrl || data.outputUrl || data.output_url || data.url || null;
}

/**
 * @param {{ dryRun?: boolean, limit?: number }} opts
 * @returns {Promise<{ scanned: number, recoverable: number, recovered: number, results: object[] }>}
 */
export async function runKieLostGenerationReconcileAll(opts = {}) {
  const runDry = opts.dryRun !== false;
  const safeLimit = Math.max(1, Math.min(2000, parseInt(opts.limit, 10) || 500));

  if (!KIE_API_KEY) {
    return {
      skipped: true,
      reason: "KIE_API_KEY is not configured",
      scanned: 0,
      recoverable: 0,
      recovered: 0,
      results: [],
    };
  }

  const candidates = await prisma.generation.findMany({
    where: {
      status: "failed",
      replicateModel: { startsWith: "kie-task:" },
    },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      outputUrl: true,
      replicateModel: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  const results = [];
  let recovered = 0;
  let recoverable = 0;

  for (const gen of candidates) {
    const taskId = parseKieTaskId(gen.replicateModel);
    if (!taskId) {
      results.push({ generationId: gen.id, userId: gen.userId, recovered: false, reason: "missing_task_id" });
      continue;
    }

    try {
      const kieRes = await fetch(
        `${KIE_API_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        {
          headers: { Authorization: `Bearer ${KIE_API_KEY}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!kieRes.ok) {
        results.push({
          generationId: gen.id,
          userId: gen.userId,
          taskId,
          recovered: false,
          reason: `kie_http_${kieRes.status}`,
        });
        continue;
      }

      const kieJson = await kieRes.json();
      const data = kieJson?.data ?? kieJson;
      const state = String(data?.state || "").toLowerCase();
      if (state !== "success") {
        results.push({
          generationId: gen.id,
          userId: gen.userId,
          taskId,
          recovered: false,
          reason: state || "not_success",
        });
        continue;
      }

      const providerUrl =
        extractKieOutputUrl(data) || (Array.isArray(data?.resultUrls) && data.resultUrls[0]) || null;
      if (!providerUrl) {
        results.push({
          generationId: gen.id,
          userId: gen.userId,
          taskId,
          recovered: false,
          reason: "success_without_output_url",
        });
        continue;
      }

      recoverable += 1;
      if (runDry) {
        results.push({
          generationId: gen.id,
          userId: gen.userId,
          taskId,
          recovered: false,
          dryRun: true,
          reason: "recoverable",
          providerUrl,
        });
        continue;
      }

      let finalUrl = providerUrl;
      if (isR2Configured()) {
        try {
          finalUrl = await mirrorToR2(providerUrl, "generations");
        } catch (mirrorErr) {
          console.warn(`[kie-reconcile] R2 mirror failed for ${gen.id}, using provider URL:`, mirrorErr?.message);
        }
      }

      await prisma.generation.update({
        where: { id: gen.id },
        data: {
          status: "completed",
          outputUrl: finalUrl,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      recovered += 1;
      results.push({
        generationId: gen.id,
        userId: gen.userId,
        taskId,
        recovered: true,
        outputUrl: finalUrl,
      });
    } catch (e) {
      console.error(`[kie-reconcile] Error recovering ${gen.id}:`, e?.message);
      results.push({
        generationId: gen.id,
        userId: gen.userId,
        recovered: false,
        reason: e?.message || "reconcile_error",
      });
    }
  }

  return {
    scanned: candidates.length,
    recoverable,
    recovered,
    results,
  };
}
