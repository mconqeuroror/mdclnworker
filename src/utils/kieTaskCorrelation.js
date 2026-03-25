/**
 * Persist KIE taskId ↔ generation correlation with retries.
 * Prevents KIE callbacks arriving before Prisma commits or after transient DB errors.
 */
import prisma from "../lib/prisma.js";

// Correlation can be delayed by transient Prisma pool pressure.
// Keep a longer retry window so KIE webhooks can reliably map to generations.
const DEFAULT_DELAYS_MS = [0, 100, 250, 500, 1000, 2000, 4000];

/**
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.generationId
 * @param {string|null} [opts.userId]
 * @param {string} [opts.kind="generation"] - payload.type for kieTask row
 * @param {Record<string, unknown>} [opts.extraGenerationData] - merged into prisma.generation.update data (e.g. pipelinePayload)
 */
export async function persistKieGenerationCorrelation({
  taskId,
  generationId,
  userId = null,
  kind = "generation",
  extraGenerationData = {},
  delaysMs = DEFAULT_DELAYS_MS,
}) {
  if (!taskId || !generationId) return;

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const row = await prisma.generation.findUnique({
      where: { id: generationId },
      select: { userId: true },
    });
    resolvedUserId = row?.userId ?? null;
  }

  let lastErr;
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i]) await new Promise((r) => setTimeout(r, delaysMs[i]));
    try {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          replicateModel: `kie-task:${taskId}`,
          ...extraGenerationData,
        },
      });

      await prisma.kieTask.upsert({
        where: { taskId },
        update: {
          entityType: "generation",
          entityId: generationId,
          step: "final",
          userId: resolvedUserId,
          status: "processing",
          payload: { type: kind },
          errorMessage: null,
          outputUrl: null,
          completedAt: null,
        },
        create: {
          taskId,
          provider: "kie",
          entityType: "generation",
          entityId: generationId,
          step: "final",
          userId: resolvedUserId,
          status: "processing",
          payload: { type: kind },
        },
      });
      return;
    } catch (e) {
      lastErr = e;
      console.warn(
        `[KIE correlation] persist attempt ${i + 1}/${delaysMs.length} failed for gen ${generationId.slice(0, 8)}:`,
        e?.message,
      );
    }
  }
  console.error(
    `[KIE correlation] FAILED to persist task ${taskId?.slice(0, 12)} for gen ${generationId?.slice(0, 8)} — KIE callback may not match:`,
    lastErr?.message,
  );
}
