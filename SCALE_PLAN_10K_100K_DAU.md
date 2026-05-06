# Scale Plan: 10k → 100k DAU

> **Status snapshot (May 2026):** Stack today handles tens to low hundreds of
> concurrent users comfortably. The errors you pasted (Neon connection pool
> timeouts, "Can't reach database server", 30 s post-generation reveal) are
> the first symptoms of the next bottleneck. This document is the staged
> roadmap to lift those ceilings without a rewrite.
>
> Each phase below is sized so it can be executed independently. The hot-path
> fixes from Phase 0 are already shipped on `typekpaco/main`.

---

## Current architecture (where the bytes go)

```
┌──────────┐    ┌──────────────┐    ┌─────────────────┐
│  Client  │ ─▶ │ Vercel Edge  │ ─▶ │ Vercel Functions │
│ (React)  │    │  (CDN/Auth)  │    │ (Express monolith)│
└──────────┘    └──────────────┘    └─────────────────┘
                                            │
                ┌───────────────────────────┼───────────────────────────────┐
                ▼                           ▼                               ▼
        ┌──────────────┐          ┌──────────────────┐          ┌────────────────────┐
        │  Neon PG     │          │   Redis (Upstash │          │  Object storage     │
        │  (single DB) │          │   /Vercel KV)    │          │  R2 + Vercel Blob   │
        └──────────────┘          └──────────────────┘          └────────────────────┘
                                            │
                                  ┌─────────┴──────────┐
                                  ▼                    ▼
                          mirror cache + lock   rate-limit bridge

External providers: Stripe, RunPod, KIE, Wavespeed, FAL, ElevenLabs, NowPayments,
HeyGen, Vercel Blob, Cloudflare R2.
```

### Single most loaded path right now

- `GET /api/generations` polled by every authenticated browser tab
  - Default cadence pre-fix: **5 s while tab visible**, regardless of state
  - Each call: 1 `findMany` + 1 `count` + 1 `apiRequestMetric` INSERT (telemetry)
  - At 1 000 concurrent active users: **~600 queries/s** on a single Neon compute

This pattern alone is what drove the connection pool exhaustion in your logs.

---

## Phase 0 — Already shipped (today, May 6 2026)

These are the fixes that landed in the commit you'll see on
`typekpaco/main` immediately after this document is written.

### 0.1  Prisma client overhaul (`src/lib/prisma.js`)

**Before:** hard-coded `connection_limit=25, pool_timeout=60`, no retries, no
`pgbouncer` flag, no graceful shutdown.

**After:**
- `pgbouncer=true` is now appended to `DATABASE_URL` automatically →
  prepared-statement-safe with Neon's pooler.
- `connection_limit` and `pool_timeout` are env-tunable (`PRISMA_CONNECTION_LIMIT`
  default 10, `PRISMA_POOL_TIMEOUT` default 10 s). The 60 s timeout previously
  let bad requests stack up forever; 10 s fails fast and frees the slot.
- Transient-error retry middleware via `client.$extends`. Catches Neon's
  cold-start ("Can't reach database server"), connection resets, pool
  starvation, and Prisma codes P1001 / P1002 / P1008 / P1017 / P2024. Up to
  3 attempts with 250 ms → 500 ms → 1 s exponential backoff + jitter.
- Graceful shutdown on `beforeExit` / `SIGTERM` / `SIGINT` so pools drain.
- Logs trimmed in production (`error` only) — `warn` and `query` are surprisingly
  CPU-intensive at high QPS.

> **Action required from you:** point `DATABASE_URL` at Neon's **pooler** host
> (the one with `-pooler` in the hostname) and set `DIRECT_URL` to the direct
> host for migrations. Vercel env var changes only — no code redeploy needed.

### 0.2  Telemetry off the request path (`src/services/telemetry.service.js`)

**Before:** every API request did a synchronous `prisma.apiRequestMetric.create()`
on `res.finish`. With `TELEMETRY_REQUEST_SAMPLE_RATE` defaulting to 1 (100%),
the polling endpoints alone wrote thousands of rows per minute.

**After:**
- In-memory ring buffer per metric type (`apiRequestMetric`, `telemetryEdgeEvent`).
- Flush every `TELEMETRY_FLUSH_INTERVAL_MS` (default 15 s) **or** when the
  buffer hits `TELEMETRY_FLUSH_BATCH_SIZE` (default 200), whichever first.
- Single `createMany` per flush instead of 200 individual INSERTs.
- Drops oldest items if the buffer ever exceeds `TELEMETRY_MAX_BUFFER` (default
  5 000) — telemetry is best-effort, not at-least-once.
- Drains on `SIGTERM` / `beforeExit` so we don't lose the last partial batch.

**Net effect:** ≥ 99 % reduction in DB write QPS from telemetry. The endpoint
that previously wrote 1 000 rows/min from polling now writes 5–10 batched rows.

### 0.3  Adaptive frontend polling (`useGenerations.js`, `App.jsx`)

**Before:** 5 s polling regardless of state, with `staleTime: 10 s` so the UI
sometimes waited 10–15 s after a webhook completion to show the result.

**After:**
- **2 s polling while at least one generation is processing** → completion
  surfaces in the UI within 2 s of the webhook landing.
- **30 s polling while idle** → 15× lower load on `/api/generations` when
  nobody's actively generating.
- `staleTime: 0` so manual refetches (e.g. right after submitting a job) hit
  the network immediately.

Affects two hooks: `useGenerations` (per-page) and the global notifier in
`App.jsx`.

### 0.4  Side-effect isolation in payment endpoints (commit `fab5b4b`)

Already documented in the previous billing message. Side-effect failures no
longer return 500 to the user after credits were committed.

---

## Phase 1 — DB layer hardening (≈ 1–2 days, target: 5k DAU comfortable)

### 1.1  Switch to Neon pooler URL

In Neon's console, copy the connection string with `-pooler` in the host. Set
two env vars in Vercel:

```
DATABASE_URL=postgresql://...-pooler.../db?sslmode=require
DIRECT_URL=postgresql://.../db?sslmode=require
```

Update `prisma/schema.prisma` to add `directUrl`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Re-run `prisma migrate deploy` once after the change.

### 1.2  Hot-path Redis read cache

Cache the response of `/api/generations` per user for **2 seconds**. At 2 s
poll interval per tab and 2 s cache TTL, multiple browser tabs / devices for
the same user collapse to 1 DB hit per 2 s instead of N.

```js
// src/services/generations-cache.service.js (new)
const TTL_MS = 2000;
const KEY = (userId, qs) => `gen:list:${userId}:${qs}`;
// GET → JSON parse, otherwise hit Prisma + SET
```

Same pattern for `/api/auth/me` (TTL 30 s; invalidate on credit change /
profile update).

### 1.3  Index audit

Run `EXPLAIN ANALYZE` on the top 10 most-frequent queries and add composite
indexes where missing. Likely candidates:
- `Generation (userId, createdAt DESC)` — already implicit via PK ordering, but
  verify a btree exists.
- `Generation (userId, status, createdAt DESC)` for filtered list views.
- `CreditTransaction (userId, createdAt DESC)`.
- `ApiRequestMetric (normalizedPath, createdAt DESC)` — already exists, double-check.

### 1.4  Prune ApiRequestMetric / TelemetryEdgeEvent

Cron job that deletes rows older than **7 days** for `ApiRequestMetric` and
**30 days** for `TelemetryEdgeEvent`. Without this, both tables grow forever
and the analytics queries (admin panel) get slower every week.

```sql
DELETE FROM "ApiRequestMetric" WHERE "createdAt" < now() - interval '7 days';
DELETE FROM "TelemetryEdgeEvent" WHERE "createdAt" < now() - interval '30 days';
```

Schedule via existing scheduled-tasks runner inside `server.js` at 03:00 UTC daily.

---

## Phase 2 — Realtime push (≈ 3–5 days, target: 20k DAU)

Polling is the wrong primitive at scale. Replace `/api/generations` polling
for **live status only** with Server-Sent Events. Keep polling as fallback.

### 2.1  Server-side: SSE endpoint

```js
// GET /api/generations/stream
//   sets Content-Type: text/event-stream
//   subscribes to a Redis pub/sub channel "user:{userId}:generations"
//   pushes every status change as a single SSE event
```

When a webhook (RunPod / KIE / Wavespeed / FAL) updates a generation row, also
publish to that channel. The frontend re-reads the row on the SSE event and
updates React Query cache directly without an HTTP round-trip.

### 2.2  Frontend: drop polling for active jobs

`useGenerations` keeps the 30 s idle poll as a safety net but disables the 2 s
active poll when SSE is connected.

### 2.3  Bonus: optimistic completion via webhook payload

Webhook handlers already have the new generation row state. Have them ship the
full row over Redis pub/sub so the SSE event is self-contained — no second DB
read needed on the receiving side.

**Net effect:** UI completion latency drops from 0–2 s (Phase 0) to **near
zero**. `/api/generations` QPS drops by another ~95 %.

---

## Phase 3 — Heavy work off the request path (≈ 1 week, target: 50k DAU)

### 3.1  Job queue for everything async

Today, several "fire and forget" things still happen inside the HTTP request:
- Image mirroring to Vercel Blob / R2 (`ensureGenerationOutputPersisted`)
- Background pose generation for special-offer models
- Webhook back-pressure on Stripe/RunPod failures

Use **BullMQ on Redis** (you already have ioredis):

```
queue: "media-mirror"      → mirrors provider URLs to durable storage
queue: "model-poses"       → generates 2-pose followups for paid models
queue: "stripe-reconcile"  → background reconcile of paid invoices (uses the
                             reconcileUserCredits service from the Phase 0
                             billing fixes)
queue: "video-poll"        → poll long-running video jobs that can't use webhooks
```

A single `worker.js` entry point runs alongside the web service (separate
Vercel function or a small Fly.io / Render box). Queue-watcher runs at most
10 jobs concurrently per type → predictable DB load.

### 3.2  Provider call deduplication via Redis

Already exists for blob mirror via `mirrorRedisAcquireOrWait` — extend the same
pattern to:
- Wavespeed pose generation (currently can be triggered twice from
  `/verify-special-offer` and the webhook).
- RunPod NSFW submissions where retries can spawn duplicate workloads.

Pattern: `SET NX EX` lock keyed on the natural-id (e.g. paymentIntentId),
holders do the work, others wait for the cache to fill, then return.

### 3.3  Read replica for analytics

Admin panel queries (`/api/admin/telemetry/*`, `/api/admin/stats`,
`/api/admin/users`) are heavy aggregates that don't need transactional
consistency. Move them to a Neon read replica:

```prisma
datasource db {
  provider     = "postgresql"
  url          = env("DATABASE_URL")
  directUrl    = env("DIRECT_URL")
}

// In code:
const adminPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_REPLICA } },
});
```

Wire this client only in `admin.routes.js` analytics handlers. The primary
DB load goes down by 10–20 % when the admin dashboard is in use.

### 3.4  Server-side sampling tier

Once Phase 0 batching is live, you may still want to drop the sample rate
under load. Add a circuit breaker:

```
if (DB latency p99 > 500ms) → telemetry sample rate drops to 0.1
if (recovery sustained 60s) → returns to configured rate
```

Implementation: 30 s rolling window of Prisma query durations in memory,
expose via `/api/admin/health` and feed back into `recordApiRequestMetric`.

---

## Phase 4 — Horizontal scale (≈ 2 weeks, target: 100k DAU)

### 4.1  Split the monolith into 3 services

```
web        → Express on Vercel — auth, routes, webhooks (low CPU)
worker     → BullMQ workers   — Fly.io / Render (CPU-bound media work)
realtime   → SSE / WebSocket  — Cloudflare Workers Durable Objects or Fly.io
```

Each scales independently. The web service is mostly I/O (DB + provider
calls). Workers are CPU-heavy (image post-processing, mirroring). Realtime
should run on a long-lived process that holds connections — Vercel functions
are wrong for this past ~1k connections.

### 4.2  CDN-cache the public, non-personal endpoints

Endpoints that take no user context can be cached at the Vercel edge:
- `GET /api/health`, `GET /api/brand`, `GET /api/plans`
- `GET /api/voices` (public catalog; ~10 minute TTL)
- `GET /api/lander/*` (marketing pages)

Use Vercel's built-in edge cache headers:

```
Cache-Control: public, s-maxage=600, stale-while-revalidate=60
```

Cuts Lambda invocations for these by ~99 %.

### 4.3  Database sharding plan (only if needed)

Probably **not** needed at 100k DAU on a single Neon Scale plan, but the plan
exists:
- Hot tables (`Generation`, `CreditTransaction`, `ApiRequestMetric`) get a
  per-month partition.
- Cold tables (`AdminAuditLog`, archived metrics) move to a long-term
  archive Postgres.
- User-scoped sharding (10 shards by `userId` hash) is the last resort —
  expect 4–6 weeks of work and a downtime window.

### 4.4  Multi-region considerations

If users are heavily concentrated in EU / APAC, consider a Neon read replica
per region + Vercel Edge Functions for read-heavy GETs. Writes stay in the
primary region. Acceptable replication lag: 2–5 s.

---

## Phase 5 — Operational hardening (continuous)

### 5.1  Fail-safe payment reconciliation cron

Run `reconcileUserCredits` (the new Phase 0 service) hourly across users with
active subscriptions whose `lastPaidInvoiceAt` doesn't have a matching
`CreditTransaction`. Catches webhook delivery dead letters automatically.

### 5.2  Provider health circuit breakers

Wrap every external provider client (RunPod, KIE, Wavespeed, FAL,
ElevenLabs) in a circuit breaker that:
- Opens after 5 consecutive failures within 60 s.
- Returns `503 service unavailable` immediately while open.
- Half-opens after 30 s with a single probe request.

Stops the app from melting when a provider has a regional outage.

### 5.3  Per-user concurrency limits

Already exists via `apiLimiter` and `generationsLimiter`. Audit the limits and
add **per-user concurrent generation cap** (e.g. max 3 parallel video gens
per user). Stops a single bad-actor / runaway script from monopolising
RunPod / KIE workers.

### 5.4  Observability stack

You already have Vercel logs + telemetry tables. Recommended additions for
100k DAU:
- **Sentry** for unhandled errors with source maps (free for first 5k errors/mo).
- **Better Stack** or **Axiom** for log aggregation (Vercel logs are not
  searchable past 3 days on free plan).
- **Grafana Cloud free tier** with Prometheus scrape of `/api/admin/health`
  for connection pool / queue depth / response time.

### 5.5  Backups

Neon already snapshots automatically. Verify the **point-in-time recovery
window** matches your plan tier. Add a `pg_dump` to S3 daily as a
belt-and-braces second backup that you control.

---

## Concrete dollar-cost projections

| DAU       | Stack changes                           | Est. monthly infra |
|-----------|------------------------------------------|--------------------|
| 1k–10k    | Phase 0 + 1                              | $200–$600          |
| 10k–25k   | Phase 0 + 1 + 2                          | $600–$1,500        |
| 25k–50k   | + Phase 3 (queue, replica)               | $1,500–$3,500      |
| 50k–100k  | + Phase 4 (worker split, edge CDN)       | $3,500–$8,000      |

Big chunks: Neon Scale (~$700/mo at 100k), RunPod GPU (variable, dominant),
Vercel Pro ($20+ usage), Upstash / Vercel Redis ($30–$200), object storage
(R2 is essentially free for egress).

---

## What to do this week

1. **Validate Phase 0 changes in production.** Watch Vercel logs for the next
   24 h. The "Timed out fetching a new connection" errors should disappear.
2. **Set the Neon pooler URL** in Vercel env vars (`DATABASE_URL` → pooler,
   `DIRECT_URL` → direct).
3. **Run the index audit** (Section 1.3). Anything missing → add migration.
4. **Add the 7-day pruning cron** for `ApiRequestMetric` (Section 1.4). Your
   current table size for that one alone will dominate disk after 6 months.

After that, plan Phase 2 (SSE) — it's the single biggest UX win remaining,
and it lifts the polling load that's still in the system.
