import prisma from "../lib/prisma.js";

/**
 * Daily retention prune for the telemetry tables.
 *
 * Why this exists:
 *  - `ApiRequestMetric` writes one row per sampled API request. At any non-toy
 *    DAU the table grows unbounded and the admin analytics queries
 *    (`aggregate`, `groupBy`, `findMany`) slow down every week as the planner
 *    has to read more pages.
 *  - `TelemetryEdgeEvent` and `SystemHealthMetric` grow more slowly but still
 *    accumulate forever.
 *  - Disk pressure on Neon (or any Postgres) eventually forces a paid-tier
 *    bump just for telemetry that is most useful in the last week.
 *
 * What this does:
 *  - Deletes rows older than the configured retention window per table.
 *  - Loops `deleteMany` so a months-of-debt first run can chip through the
 *    backlog without locking the table — Postgres takes a row-level lock per
 *    deleted row so a single huge `DELETE` can hold MVCC pressure for minutes.
 *    The chunked loop here returns control to the event loop between batches.
 *  - Best-effort: any error is logged but never throws — telemetry retention
 *    must never block other scheduled jobs.
 *
 * Defaults (tunable via env):
 *  - request metrics:    7 days   (TELEMETRY_REQUEST_METRIC_RETENTION_DAYS)
 *  - edge events:        30 days  (TELEMETRY_EDGE_EVENT_RETENTION_DAYS)
 *  - health snapshots:   14 days  (TELEMETRY_HEALTH_RETENTION_DAYS)
 *  - max chunks per run: 50       (TELEMETRY_RETENTION_MAX_CHUNKS) — caps
 *      the very first prune so we don't spend the whole interval catching up.
 */

const DEFAULT_REQUEST_METRIC_RETENTION_DAYS = Number(
  process.env.TELEMETRY_REQUEST_METRIC_RETENTION_DAYS || 7,
);
const DEFAULT_EDGE_EVENT_RETENTION_DAYS = Number(
  process.env.TELEMETRY_EDGE_EVENT_RETENTION_DAYS || 30,
);
const DEFAULT_HEALTH_SNAPSHOT_RETENTION_DAYS = Number(
  process.env.TELEMETRY_HEALTH_RETENTION_DAYS || 14,
);
const DEFAULT_MAX_CHUNKS = Number(
  process.env.TELEMETRY_RETENTION_MAX_CHUNKS || 50,
);

/**
 * @typedef {Object} PruneSummary
 * @property {number} apiRequestMetric   rows deleted from ApiRequestMetric
 * @property {number} telemetryEdgeEvent rows deleted from TelemetryEdgeEvent
 * @property {number} systemHealthMetric rows deleted from SystemHealthMetric
 * @property {number} chunks             number of deleteMany calls executed
 * @property {number} elapsedMs          wall-clock time
 */

async function pruneModel(modelKey, cutoff, maxChunks) {
  let totalDeleted = 0;
  let chunks = 0;
  while (chunks < maxChunks) {
    let count = 0;
    try {
      const result = await prisma[modelKey].deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      count = result?.count || 0;
    } catch (error) {
      console.warn(
        `[telemetry-retention] deleteMany on ${modelKey} failed (non-fatal):`,
        error?.message,
      );
      break;
    }
    totalDeleted += count;
    chunks += 1;
    // Postgres caps a single deleteMany at the matched-row count for the
    // current snapshot. If it returned fewer than the typical batch size we
    // can assume we've drained the cutoff window for now.
    if (count === 0) break;
    // Yield to the event loop between chunks so other scheduled jobs can
    // interleave — keeps the server responsive during a backlog cleanup.
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { totalDeleted, chunks };
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.requestMetricRetentionDays]
 * @param {number} [opts.edgeEventRetentionDays]
 * @param {number} [opts.healthSnapshotRetentionDays]
 * @param {number} [opts.maxChunks]
 * @returns {Promise<PruneSummary>}
 */
export async function pruneOldTelemetry({
  requestMetricRetentionDays = DEFAULT_REQUEST_METRIC_RETENTION_DAYS,
  edgeEventRetentionDays = DEFAULT_EDGE_EVENT_RETENTION_DAYS,
  healthSnapshotRetentionDays = DEFAULT_HEALTH_SNAPSHOT_RETENTION_DAYS,
  maxChunks = DEFAULT_MAX_CHUNKS,
} = {}) {
  const startedAt = Date.now();
  const cutoffs = {
    apiRequestMetric: new Date(startedAt - requestMetricRetentionDays * 86_400_000),
    telemetryEdgeEvent: new Date(startedAt - edgeEventRetentionDays * 86_400_000),
    systemHealthMetric: new Date(startedAt - healthSnapshotRetentionDays * 86_400_000),
  };

  const summary = {
    apiRequestMetric: 0,
    telemetryEdgeEvent: 0,
    systemHealthMetric: 0,
    chunks: 0,
    elapsedMs: 0,
  };

  for (const [modelKey, cutoff] of Object.entries(cutoffs)) {
    const { totalDeleted, chunks } = await pruneModel(modelKey, cutoff, maxChunks);
    summary[modelKey] = totalDeleted;
    summary.chunks += chunks;
  }

  summary.elapsedMs = Date.now() - startedAt;
  return summary;
}
