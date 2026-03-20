# Deploying to Vercel

**.env is not deployed.** Vercel does not use a `.env` file in production. You must set all variables in the dashboard.

## Required: set environment variables

In **Vercel Dashboard** → your project → **Settings** → **Environment Variables**, add at least:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. Neon) |
| `JWT_SECRET` | Secret for signing JWTs |
| `NODE_ENV` | `production` |

Plus any others your app uses (Stripe, APIs, etc.). Without `DATABASE_URL` and `JWT_SECRET`, the server will exit on startup.

### Optional: NSFW RunPod polling (long-running Node only)

If NSFW image generation uses the in-process RunPod poller, tune concurrency and timeouts to match your RunPod worker count:

| Variable | Default | Description |
|----------|---------|-------------|
| `NSFW_POLL_CONCURRENCY` | `5` | How many RunPod jobs we poll in parallel (align with max concurrent workers on RunPod). |
| `NSFW_MAX_RUNNING_MS` | `5400000` (90 min) | Max time in `IN_PROGRESS` (queue time excluded). |
| `NSFW_MAX_WALL_MS` | `10800000` (180 min) | Absolute max wall time per job (includes `IN_QUEUE`). |
| `NSFW_STUCK_MAX_AGE_SEC` | `12000` (200 min) | Recovery poller fails stuck `processing` rows older than this (should be ≥ wall time). |
| `NSFW_NUDES_PACK_PROMPT_CONCURRENCY` | `4` | Max parallel Grok “Create prompt” calls when starting a nudes pack (1–12; higher = faster prompt phase, more OpenRouter load). |
| `RUNPOD_WEBHOOK_URL` | _(unset)_ | Optional. If set, sent as top-level `webhook` on RunPod serverless `/run` ([RunPod docs](https://docs.runpod.io/serverless/endpoints/job-operations)) so RunPod POSTs job completion to your URL. **The app still completes generations via in-process polling** unless you add a route that finalizes the same `generation` row idempotently (avoid double-complete if both webhook and poll run). |
| `NSFW_STUCK_CLEANUP_MINUTES` | `200` | **Critical for nudes packs / RunPod batches.** The global stuck-generation watchdog used to treat `type: nsfw` like normal images (15 min) and marked long RunPod jobs as failed while RunPod was still working. NSFW rows now use this longer threshold (45–300 min clamp). |
| `NSFW_RECOVERY_POLL_CONCURRENCY` | `8` | How many NSFW `processing` rows we poll in parallel each 30s tick (faster catch-up for large batches). |

## Note on this stack

This app is a **long-running Node server** (Express + Vite dev or built frontend). Vercel is **serverless**. For a standard Vercel deployment:

- The server entry skips Replit-only steps (pid2) and DB sync (prisma db push) when `VERCEL=1` is set (Vercel sets this automatically).
- Run Prisma migrations (e.g. `prisma migrate deploy`) separately (e.g. in a build step or CI), not on every cold start.

For a persistent server with DB push at startup, consider **Replit**, **Railway**, **Render**, or **Fly.io** instead.
