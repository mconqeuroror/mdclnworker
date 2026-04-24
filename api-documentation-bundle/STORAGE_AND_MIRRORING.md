# Storage, mirroring, and durable media (implementation)

This document describes **where generated and uploaded bytes end up** in production. It corrects the shorthand “everything goes to R2”: on current ModelClone deployments, **Vercel Blob is preferred** whenever `BLOB_READ_WRITE_TOKEN` is set.

## TL;DR

| Condition | Behaviour |
|-----------|-----------|
| `BLOB_READ_WRITE_TOKEN` set | New uploads and most “mirror” paths use **Vercel Blob** (`*.public.blob.vercel-storage.com` or `blob.vercel.app`). |
| Blob unset, R2 fully configured | Legacy path: **Cloudflare R2** via S3 API (`R2_*` env). |
| Neither configured | Many flows **keep the provider’s temporary URL** (may expire). |

The helper `uploadBufferToBlobOrR2` in `src/utils/kieUpload.js` implements: **Blob if token present, else R2**.

## Blob-only mode for user-facing mirrors

In `src/utils/r2.js`:

- `FORCE_BLOB_ONLY_STORAGE` defaults to **on** (any value other than `false`).
- When **both** Blob token and blob-only mode are active, functions named `mirrorToR2` / blob-or-R2 upload paths that check `isBlobOnlyMode()` **persist to Vercel Blob**, not R2 — the name is historical.

Set `FORCE_BLOB_ONLY_STORAGE=false` only if you intentionally want those code paths to use R2 when R2 is configured (advanced / legacy).

## Folder semantics (Vercel Blob paths)

Defined and documented in `src/utils/kieUpload.js`:

| Prefix | Role |
|--------|------|
| `kie-relay/` | **Temporary** copies so **KIE (and similar)** can fetch inputs that R2 or private URLs cannot serve. Safe to delete after the provider finishes (`deleteBlobAfterKie` only touches this prefix). |
| `user-uploads/` | **Durable** user media (e.g. long-lived inputs, some video relay, `mirrorProviderOutputUrl` persistence). |
| `generations/` | **Durable** generation outputs stored on Blob (e.g. KIE callback archive via `uploadBufferToBlobOrR2` into `generations`). |
| `nsfw-generations/` | NSFW / RunPod / fal flows that upload buffers after generation. |
| `training/` | NSFW LoRA training images mirrored from external URLs. |
| `tutorials/`, `avatars/`, etc. | Other product features as named in code. |

Vercel Blob objects **do not auto-expire** by TTL; they persist until deleted through app logic or the Blob API (`src/utils/storageDelete.js` uses `@vercel/blob` `del`).

## KIE relay (`mirrorToBlob`)

KIE often cannot fetch arbitrary URLs (e.g. some R2 URLs). When Blob is configured, `mirrorToBlob` in `kieUpload.js`:

1. Downloads the source URL (with retries, optional Redis-backed dedupe).
2. Uploads to **`kie-relay/`** (short cache headers) or **`user-uploads/`** for video / `kie-media` purpose (longer-lived).
3. Optionally cleans relay blobs after the callback (`deleteBlobAfterKie`).

Redis (`REDIS_URL` / Upstash / KV mirror helpers) reduces duplicate mirrors across serverless instances.

## “Archive” after KIE completes

`archiveToR2` in `src/services/kie.service.js` is **misnamed** for Blob-first setups: it downloads the KIE result URL and calls `uploadBufferToBlobOrR2(buffer, "generations", …)` — so with Blob configured, the **durable URL is on Vercel Blob**, not R2. If **neither** Blob nor R2 is usable, it falls back to the raw KIE URL (may expire).

## `mirrorToR2` / `reMirrorToR2` / `mirrorExternalUrlToPersistentBlob`

- **`mirrorExternalUrlToPersistentBlob`**: download public URL → upload to Blob under a folder (e.g. `generations/`). Requires `BLOB_READ_WRITE_TOKEN`; used in blob-only mirroring and remirror jobs.
- **`mirrorToR2`**: if blob-only + Blob configured → delegates to persistent Blob mirror; else classic download + `uploadBufferToBlobOrR2` (Blob still wins if token set); if no storage, returns original URL.
- **`reMirrorToR2`**: used when re-serving URLs to KIE (presigned R2 GET vs Blob relay) — see `r2.js` and `ensureKieAccessibleUrl` in `kieUpload.js`.

## Deferred Blob remirror queue

`src/services/blob-remirror-queue.service.js` enqueues work when a generation should eventually get a **durable Blob URL** but immediate mirror failed (rate limits, timeouts). Tasks use `kieTask` rows with provider `blob-remirror`. The server process drains pending items (`processPendingBlobRemirrorQueue` from `server.js`).

## API and second Vercel deployment

There is **no separate storage path** for “API only”. The same `server.js` runs: if the API deployment has **`BLOB_READ_WRITE_TOKEN`** (and optionally Redis), results mirror to **that project’s Blob store** unless you share tokens/stores with the web project by configuration.

**Important:** two Vercel projects with **different** Blob tokens have **different** Blob stores; URLs in the database always point to wherever they were uploaded.

## Environment variables (storage-related)

| Variable | Purpose |
|----------|---------|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read/write — **primary** durable + relay storage when set. |
| `FORCE_BLOB_ONLY_STORAGE` | Default effective `true`; set to `false` to allow R2 in historically named paths when both are configured. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | R2 when Blob is not used or for presigned flows. |
| Redis / Upstash / KV (see `.env.example`) | Optional mirror dedupe and rate-limit friendliness across instances. |

## Key source files

- `src/utils/kieUpload.js` — Blob upload, relay, persistent mirror, `uploadBufferToBlobOrR2`.
- `src/utils/r2.js` — R2 client, blob-only branching, `mirrorToR2`, `reMirrorToR2`.
- `src/utils/storageDelete.js` — delete Blob objects for user-initiated removal.
- `src/services/kie.service.js` — `archiveToR2` (persist completion output).
- `src/services/blob-remirror-queue.service.js` — deferred durable Blob mirror.
- `src/routes/kie-callback.routes.js` — enqueue remirror, input blob cleanup.

## See also

- [API_USERS.md](./API_USERS.md) — integrator guide (auth, polling, **media URLs**).
- [VERCEL_API_WRAPPER.md](./VERCEL_API_WRAPPER.md) — second deploy / callbacks (Slovak).
