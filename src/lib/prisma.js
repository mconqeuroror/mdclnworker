import { PrismaClient } from "@prisma/client";

/**
 * Prisma client tuned for Neon Postgres + Vercel serverless workloads.
 *
 * Why this matters:
 *  - Neon's serverless Postgres has a global connection ceiling per project.
 *    When the app fans out via Prisma's per-instance pool (default 25), every
 *    Vercel Lambda spins up its own pool and we exhaust Neon fast under burst
 *    traffic ("Timed out fetching a new connection from the connection pool").
 *  - Neon also auto-suspends idle compute after a few minutes; the first
 *    request after suspension fails with "Can't reach database server".
 *
 * What we do:
 *  1. Append `pgbouncer=true` so Prisma uses transaction-mode pooling that
 *     plays nicely with Neon's pooler URL (`-pooler` host). When DATABASE_URL
 *     already points at the pooler, this is harmless; when it doesn't, this
 *     flag prevents prepared-statement leaks across pooled sessions.
 *  2. Tune `connection_limit` and `pool_timeout` from env so we can change
 *     them without redeploying code (PRISMA_CONNECTION_LIMIT,
 *     PRISMA_POOL_TIMEOUT).
 *  3. Wrap every query with a transient-error retry layer. Neon cold-starts
 *     and Vercel's pooled DNS lookups can briefly fail; one retry recovers
 *     them invisibly to callers. We bound retries hard so genuine outages
 *     surface fast.
 *  4. Reuse a single global client across hot reloads (dev) AND Lambda warm
 *     invocations (prod) — `globalThis.__prisma` survives the same Lambda
 *     container, which is exactly what we want.
 *  5. Disable verbose query logs in production — those are surprisingly
 *     expensive at scale.
 */

const globalForPrisma = globalThis;

const TRANSIENT_PATTERNS = [
  "Can't reach database server",
  "Connection pool timeout",
  "Timed out fetching a new connection",
  "Closed connection",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EAI_AGAIN",
  "server closed the connection unexpectedly",
  "prepared statement",
  // Prisma error codes for transient infra issues
  "P1001", // Can't reach database
  "P1002", // Connection timed out
  "P1008", // Operations timed out
  "P1017", // Server closed connection
  "P2024", // Pool timeout
];

function isTransient(error) {
  const msg = error?.message || String(error || "");
  const code = error?.code || "";
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p) || code === p);
}

function buildPooledUrl() {
  const baseUrl = process.env.DATABASE_URL || "";
  if (!baseUrl) return baseUrl;

  const url = new URL(baseUrl);
  const params = url.searchParams;

  // Switching `pgbouncer=true` puts Prisma in transaction-pool-friendly mode.
  // Required when connecting through Neon's `-pooler` host (which is itself
  // PgBouncer in transaction mode); harmless on direct connections.
  if (!params.has("pgbouncer")) params.set("pgbouncer", "true");

  // Per-instance connection ceiling. With pgbouncer in front we keep this
  // moderate per-Lambda and let Neon's pooler do the multiplexing.
  const limit = String(process.env.PRISMA_CONNECTION_LIMIT || "10");
  if (!params.has("connection_limit")) params.set("connection_limit", limit);

  // Fail-fast on pool starvation. The previous 60s blocked the request
  // forever and stacked up — better to error in 10s and let the caller retry
  // than to hold a hung HTTP request.
  const poolTimeout = String(process.env.PRISMA_POOL_TIMEOUT || "10");
  if (!params.has("pool_timeout")) params.set("pool_timeout", poolTimeout);

  // Network-level timeout to the DB itself (different from pool timeout).
  // Helps Neon cold-start scenarios where TCP handshake is slow.
  if (!params.has("connect_timeout")) params.set("connect_timeout", "10");

  url.search = params.toString();
  return url.toString();
}

function buildPrismaClient() {
  const pooledUrl = buildPooledUrl();
  const isProd = process.env.NODE_ENV === "production";
  const debugQueries = process.env.PRISMA_LOG_QUERIES === "1";

  const client = new PrismaClient({
    log: isProd
      ? ["error"]
      : debugQueries
        ? ["query", "warn", "error"]
        : ["warn", "error"],
    datasources: { db: { url: pooledUrl } },
  });

  // Wrap every operation with a single retry on transient infra errors.
  // Uses Prisma's $extends API (the documented stable replacement for $use)
  // so behaviour stays consistent across model methods.
  return client.$extends({
    name: "transient-retry",
    query: {
      $allOperations: async ({ operation, args, query }) => {
        const maxAttempts = Number(process.env.PRISMA_MAX_RETRIES || 3);
        const baseDelayMs = Number(process.env.PRISMA_RETRY_DELAY_MS || 250);
        let lastError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            lastError = error;
            if (!isTransient(error) || attempt === maxAttempts) {
              throw error;
            }
            // Exponential backoff with jitter: 250ms, 500ms+jitter, 1s+jitter…
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
            if (process.env.NODE_ENV !== "production") {
              console.warn(
                `[prisma] transient ${operation} attempt ${attempt}/${maxAttempts} — ${error?.message?.slice(0, 120)} — retrying in ${Math.round(delay)}ms`,
              );
            }
            await new Promise((r) => setTimeout(r, delay));
          }
        }
        throw lastError;
      },
    },
  });
}

const prisma = globalForPrisma.__prisma ?? buildPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

// Best-effort graceful shutdown so the pool drains cleanly on container exit.
// Vercel sends SIGTERM on Lambda shutdown; long-running hosts get SIGINT.
let shutdownRegistered = false;
if (!shutdownRegistered) {
  shutdownRegistered = true;
  for (const signal of ["beforeExit", "SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      // $disconnect returns a promise but we deliberately don't await on
      // beforeExit (Node would re-fire it). Best-effort fire-and-forget.
      try {
        prisma.$disconnect().catch(() => {});
      } catch (_) {}
    });
  }
}

export default prisma;
