# ModelClone API — full integrator guide (single file)

> **Built:** 2026-04-12T20:04:47.341Z. Regenerate from repo root: `node scripts/build-api-full-integrator-doc.mjs`.

## How to use this document

This file merges the **human-written** API docs under `docs/` with a **machine-generated** appendix derived from the OpenAPI spec. Together they are intended to be enough for an external team to ship a **full API wrapper** (auth, generations, uploads, admin key flows, storage semantics, and optional worker callbacks).

- **Canonical OpenAPI JSON** (for clients and CI): [`docs/openapi/modelclone-api.openapi.json`](./openapi/modelclone-api.openapi.json) — run `npm run openapi:generate` after server route changes.
- **Relative links** between chapters may still point at `*.md` filenames; those files are the same content as the sections below (search by title).

---

<a id="index-api-md"></a>

## Index — API.md

# ModelClone HTTP API — documentation index

All JSON routes are under the **`/api`** prefix unless noted. The **machine-readable contract** (paths, methods, auth classes) is **[docs/openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json)** — regenerate with `npm run openapi:generate` after route changes. Narrative payloads and errors remain in **`API_INTEGRATORS_REFERENCE.md`**. The canonical route list is assembled in **`src/routes/api.routes.js`**, **`src/server.js`**, and mounted route modules under **`src/routes/`**.

## For integrators (external developers)

| Document | Contents |
|----------|----------|
| **[API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md)** | **Full reference:** user/product routes (generations, uploads, NSFW/LoRA, Creator Studio, …). **Excludes** Stripe/crypto checkout — not part of the programmatic API for wrappers. |
| **[openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json)** | **OpenAPI 3.0** inventory: every `/api` route (method + path), security scheme per route (`X-Api-Key` vs admin JWT vs public). Regenerate: `npm run openapi:generate`. |
| [API_USERS.md](./API_USERS.md) | Short guide: base URL, **API key** auth (`mcl_…`), **Business-plan access flow**, CORS, rate limits, async polling, **media URLs & storage**, endpoint map. |
| [ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md) | How admins create/revoke keys (internal). |

## For backend / DevOps

| Document | Contents |
|----------|----------|
| [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md) | **Vercel Blob vs R2**, folder prefixes (`kie-relay/`, `generations/`, …), KIE relay, remirror queue, env vars. |
| [VERCEL_API_WRAPPER.md](./VERCEL_API_WRAPPER.md) | Second Vercel project (`modelclone-api/`), callbacks, LoRA webhooks (Slovak). |
| [modelclone-api/README.md](./WRAPPER_VERCEL.md) | Submodule build, `GITHUB_SUBMODULE_TOKEN`, links to docs above. |

## Standalone documentation bundle (new repo)

The folder **`api-documentation-bundle/`** at the repository root contains the same API docs + OpenAPI + setup guides for publishing as a **separate git repository** (beta testers, partners). Start at **`api-documentation-bundle/README.md`**. Refresh copies after doc changes using **`api-documentation-bundle/SYNC_FROM_MONOREPO.md`**.

## Environment template

See **`.env.example`** at the repository root for variable names and comments.

---

<a id="user-automation-guide-api-users-md"></a>

## User & automation guide — API_USERS.md

# ModelClone HTTP API — integrátor guide

This document is for **developers** integrating with ModelClone on behalf of a user account. For internal admin operations (issuing keys), see [ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md).

**Full API reference (payloads, responses, errors per mode):** [API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md)

**OpenAPI 3.0 (machine-readable route list + auth classes):** [openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json) — regenerate from the repo with `npm run openapi:generate`.

**Documentation index:** [API.md](./API.md)  
**Where files are stored (Blob vs R2, KIE relay):** [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md)

## Business API access (commercial flow)

1. **Billing** — API is sold and paid **outside** the programmatic API (contract, invoice, wire, etc.). Consumer checkout (`/api/stripe`, `/api/crypto`) is for the web app, not the automation SKU.
2. **Account state** — The target user must have **`subscriptionTier: business`** and **`subscriptionStatus`** **`active`** or **`trialing`** in the database (after you provision them the same way as any Business subscriber).
3. **Key issuance** — A ModelClone **admin** creates an API key ([ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md) or `POST /api/admin/users/{id}/api-keys` with an admin JWT). Without Business + active/trialing, key creation returns **`403`** with `code: API_KEY_REQUIRES_BUSINESS_PLAN`.
4. **Automation** — The integrator calls product routes with **`X-Api-Key: mcl_…`**. The backend treats the request as **that user**: same credits, limits, NSFW gates, and ownership rules as the browser app. The only difference is you can drive it from scripts, backends, or schedulers.

## Base URL

Production API base URL:

- `https://www.api-modelclone.com/api`

All application routes are under the **`/api`** prefix.

Examples:

- `https://www.api-modelclone.com/api/health`
- `https://www.api-modelclone.com/api/models`

Staging/local deployments can use different hostnames, but expose the **same** `/api` surface when running the same backend.

## Authentication

An API key is created by ModelClone admins and tied to a **single user account**. That user’s **credits, subscription, and limits** apply to every request.

Send the secret on **every** authenticated request, using **one** of:

| Method | Header |
|--------|--------|
| Recommended | `X-Api-Key: mcl_...` |
| Alternative | `Authorization: ApiKey mcl_...` |
| Alternative | `Authorization: Bearer mcl_...` |

Do **not** send a JWT `Bearer` token and an `mcl_` API key in conflicting ways; use the API key for programmatic access.

### Unauthenticated endpoints

Some routes are public (e.g. `GET /api/health`, `GET /api/brand`, auth signup/login). Most product features require the API key as above.

### Errors (auth)

Typical responses:

- `401` — missing/invalid key, or invalid JWT where applicable  
  `{ "success": false, "message": "No token provided" | "Invalid API key" | ... }`
- `403` — account suspended (`banLocked`) or CORS origin not allowed for this key  
  `{ "success": false, "code": "ACCOUNT_BAN_LOCKED", ... }` or a CORS-related message

## Cookies

The web app uses HTTP-only cookies for sessions. **API key clients do not need cookies**; the key replaces session auth for user routes.

## CORS (browser apps)

If the key was created with a **CORS allowlist**, requests from a browser must send an `Origin` header that matches one of the configured origins exactly. Server-to-server clients (no `Origin`, or non-browser) are unaffected by CORS rules.

## Rate limiting

Limits are applied per IP or per authenticated user id (including API-key auth). Examples from the backend:

- Auth endpoints: stricter per-15-minute windows in production.
- Generations: per-minute cap per user (configurable via `GENERATION_RATE_LIMIT_MAX`, default `60`).
- Models / generations list: dedicated limiters.

On limit exceeded, responses are usually **`429`** with a JSON body containing `success: false` and a `message`.

## Response shape

Many endpoints return JSON like:

```json
{ "success": true, ... }
```

or on failure:

```json
{ "success": false, "message": "...", "code": "OPTIONAL_CODE" }
```

Exact fields vary by route; always check HTTP status and `success` when present.

## Async jobs and polling

Image/video and some NSFW flows create **background work**. Typical pattern:

1. `POST` to a generation endpoint → response includes an id / job id / generation id.
2. Poll `GET /api/generations/:id` or the route documented in the response until `status` is terminal (`completed`, `failed`, etc.).

Use the same API key for polling as for the initial request.

## Media URLs in API responses

Completed generations and uploads usually return **HTTPS URLs** to binary assets (images, video). Treat them as **opaque strings** until you fetch them.

### Vercel Blob (typical on production)

When the server has `BLOB_READ_WRITE_TOKEN` configured, durable outputs are often stored on **Vercel Blob**. URLs usually contain **`vercel-storage.com`** or **`blob.vercel.app`**. These are intended to be **stable** until the user or an admin deletes the object.

### Temporary provider URLs

Some flows may still return a **vendor CDN URL** (KIE, fal, WaveSpeed, etc.), especially if storage is misconfigured or a mirror step failed. Those URLs **may expire**; poll the generation until the backend replaces them with a durable URL when remirror succeeds.

### R2 (legacy / fallback)

If Blob is not configured but Cloudflare R2 is, URLs may use your **`R2_PUBLIC_URL`** host. Same contract: stable until deleted.

### API-only or second deployment

Calling a **different hostname** (e.g. a dedicated API Vercel project) does not change the logic: whatever storage that deployment’s env points to is where new bytes land. Existing rows in the shared database may still reference Blob/R2 URLs created by another deployment.

**Implementation detail:** see [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md).

## Uploads

Authenticated upload helpers include routes such as:

- `GET /api/upload/config`
- `POST /api/upload/blob`
- `POST /api/upload/presign`

Use `multipart/form-data` where the route expects file fields (see comments in `src/routes/api.routes.js`).

## OpenAPI / machine-readable spec

There is **no generated OpenAPI file** in this repository. Use **[API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md)** for structured request/response documentation, and for raw enumeration:

- `src/routes/api.routes.js`
- `src/server.js` (additional `app.use` mounts)

## Endpoint map (user-facing)

The canonical list lives in **`src/routes/api.routes.js`** (and additional routers mounted from `src/server.js`). Below is a **grouped overview** — not every optional body field is listed; inspect controllers or existing app traffic for details.

### Account & profile

- `POST /api/auth/*` — signup, login, refresh, password flows, Google, etc.
- `GET /api/auth/profile`, `PUT /api/auth/profile`
- `POST /api/auth/logout` (no-op for pure API-key clients but safe to call)
- `GET|POST /api/auth/2fa/*` — two-factor setup

### Models

- `GET /api/models` — list
- `GET /api/models/:id` — detail
- `POST /api/models` — create (and related AI/trial flows mounted on `/api/models/...`)
- `PUT /api/models/:id`, `DELETE /api/models/:id`
- Voice: `/api/models/:modelId/voice/...`, `/api/models/:modelId/voices/...`

### Uploads & pricing

- `GET /api/upload/config`
- `POST /api/upload/blob`, `POST /api/upload/presign`
- `GET /api/pricing/generation`

### Generations (core)

- `GET /api/generations`, `GET /api/generations/:id`, `GET /api/generations/monthly-stats`
- `POST /api/generations/batch-delete`

Representative **`POST /api/generate/*`** routes (all require auth unless noted):

- `/generate/image-identity`
- `/generate/describe-target`
- `/generate/video-motion`
- `/generate/complete-recreation`
- `/generate/extract-frames`
- `/generate/prepare-video`, `/generate/complete-video`
- `/generate/video-directly`
- `/generate/video-prompt`
- `/generate/face-swap`, `/generate/face-swap-video`, `/generate/image-faceswap`
- `/generate/advanced`
- `/generate/prompt-image`
- `/generate/analyze-looks`, `/generate/enhance-prompt`
- Creator studio: `/generate/creator-studio`, `.../video`, `.../extend`, `.../mask-upload`, `.../assets`, etc.
- `/generate/talking-head`

### Voices (talking head helpers)

- `GET /api/voices`
- `GET /api/voices/:voiceId/preview`

### NSFW / LoRA (namespaced)

Under **`/api/nsfw/`**, including for example:

- LoRA CRUD and training: `/nsfw/lora/*`, `/nsfw/train-lora`, `/nsfw/training-status/:modelId`, training images upload/list, …
- Generation: `/nsfw/generate`, `/nsfw/nudes-pack`, `/nsfw/generate-advanced`, video/extend, plan/auto-select jobs with `.../status/:jobId`, etc.

### Onboarding & misc

- `POST /api/onboarding/complete`, `/api/onboarding/lock-offer`
- `GET|POST /api/course/*`
- `GET /api/tutorials/catalog`, `GET /api/brand`

### Referrals (user)

- **`GET/POST /api/referrals/me/*`** and public `resolve`
- **`/api/referrals/admin/*`** — requires admin JWT (same as web admin)

**Not in integrator scope:** `/api/stripe` and `/api/crypto` exist on the full server for the web checkout; they are **omitted** from [API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md). Third-party wrappers should use **API keys + product routes** only, not payment flows.

### Other routers mounted under `/api` (and parallel mounts)

- `/api/drafts`, `/api/reformatter`, `/api/lander-new`, `/api/affiliate-lander`, `/api/heygen` (callbacks as applicable)
- **`/api/video-repurpose`** — repurposer (mounted from `src/server.js`)
- **`/api/img2img`** — img2img pipeline
- **`/api/viral-reels`** — viral reels / streaming routes
- **`/api/support`** — support routes

Admin-only surfaces (`/api/admin/*`, `/api/designer-studio`, `/api/avatars`, etc.) follow the same rules as the web app: **admin JWT** (or equivalent), not end-user API keys.

## Support

For a new key, rotated key, or CORS changes, contact your ModelClone admin. For contractually agreed SLAs and URLs, use the values they provide outside this repo.

## See also

- [Full integrator API reference](./API_INTEGRATORS_REFERENCE.md)
- [Admin guide (API keys)](./ADMIN_PUBLIC_API.md)
- [Storage & mirroring (implementation)](./STORAGE_AND_MIRRORING.md)
- [API documentation index](./API.md)
- [Deploy notes](./WRAPPER_VERCEL.md)

---

<a id="admin-api-keys-admin-public-api-md"></a>

## Admin API keys — ADMIN_PUBLIC_API.md

# Admin: ModelClone verejné API a API kľúče

Tento dokument je pre **administrátorov ModelClone** (interný tím), nie pre integrátorov. Pre vývojárov, ktorí volajú API, použite [API_USERS.md](./API_USERS.md) a kompletný referenčný popis endpointov [API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md). Index: [API.md](./API.md). Úložisko výstupov (Blob/R2): [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md).

## Účel

- Každý **API kľúč** je naviazaný na konkrétneho **používateľa** v produkčnej databáze (`User`).
- Volania s týmto kľúčom majú **rovnaké kredity, subscription limity a pravidlá** ako keby bol používateľ prihlásený v aplikácii.
- **Ban-lock** (`banLocked`) platí aj pre API: zablokovaný účet nedostane úspešnú autentifikáciu ani cez kľúč.

## Kde v admin rozhraní

1. Otvor **Admin** (ModelClone admin panel).
2. Sekcia **Users**.
3. Pri riadku používateľa klikni na tlačidlo **API** (ikona kľúča).
4. V modálnom okne môžeš:
   - zobraziť existujúce kľúče (vidíš len **prefix**, nie celý secret),
   - **vytvoriť** nový kľúč,
   - **revokovať** kľúč.

## Vytvorenie kľúča

**Podmienka:** používateľ musí mať v DB **`subscriptionTier` = `business`** (bez ohľadu na veľkosť písmen) a **`subscriptionStatus`** **`active`** alebo **`trialing`**. Inak `POST …/api-keys` vráti **`403`** s `code: API_KEY_REQUIRES_BUSINESS_PLAN` (platí aj HTTP API pre admina). Najprv teda nastav Business predplatné (alebo ho zaznamenaj po platbe mimo app). *(Kľúče vytvorené pred zavedením tejto kontroly ostanú funkčné, kým ich nerevokuješ.)*

- **Label (voliteľné):** interný popis (napr. „Partner X – produkcia“).
- **CORS origins (voliteľné):** JSON pole stringov, napr. `["https://app.partner.sk"]`.
  - Prázdne = typické **server-to-server** volania (bez obmedzenia podľa `Origin`).
  - Vyplnené = pri volaní z prehliadača musí presne sedieť hlavička `Origin` s jednou z hodnôt v poli; inak odpoveď **403**.

Po vytvorení sa **jednorazovo** zobrazí celý secret (`mcl_…`). Tento reťazec **ulož bezpečne**; v databáze ostane len hash a prefix.

## Revokácia

- **Revoke** okamžite zneplatní kľúč; klienti s ním dostanú `401 Invalid API key`.
- Revokované kľúče zostanú v zozname označené; nový kľúč vždy vytvor ako nový záznam.

## Bezpečnostné odporúčania

- Kľúče dávaj len dôveryhodným stranám; majú rovnocenný prístup k účtu ako session (v rámci user endpointov).
- Pre integrácie z **prehliadača** vždy nastav **CORS allowlist** na konkrétne domény, nie `*`.
- Pri úniku kľúča okamžite **revoke** a vydaj nový.
- Nevkladaj API kľúče do verejných repozitárov ani do front-end bundle.

## Druhý Vercel deploy (workers / oddelené provider kľúče)

Môžeš mať **druhý** Vercel projekt so **rovnakým** repom a **rovnakou** `DATABASE_URL`. Je to stále **celý** backend (repurposer, reformatter, webhooky, admin, poller — všetko), len v Environment Variables dáš **iné API kľúče** k providerom (KIE, fal, …), ak chceš oddeliť kvóty alebo náklady.

Integrátori volajú host tohto deployu; **HTTP API kľúče** (`mcl_…`) fungujú rovnako, lebo sú v **tej istej** databáze.

Podrobnejšie: [modelclone-api/README.md](./WRAPPER_VERCEL.md).

## Databáza

Model `ApiKey` je v hlavnom `prisma/schema.prisma`. Po zmene schémy na prostredí spusti napr.:

```bash
npx prisma db push
```

(albo váš schválený migračný proces).

## Admin HTTP API (pre automatizáciu)

Ak má admin **JWT** (rovnako ako pri práci z webu), môže volať:

| Metóda | Cesta | Popis |
|--------|--------|--------|
| `GET` | `/api/admin/users/:userId/api-keys` | Zoznam kľúčov (bez secretov) |
| `POST` | `/api/admin/users/:userId/api-keys` | Telo: `{ "name": "…", "corsOrigins": ["https://…"] }` – v odpovedi raz pole `key` |
| `DELETE` | `/api/admin/users/:userId/api-keys/:keyId` | Revokácia |

Vyžaduje sa rola **admin** (`adminMiddleware`), nie len API kľúč bežného používateľa.

## Odkazy

- [Dokumentácia pre používateľov API](./API_USERS.md)
- [README verejného API balíka](./WRAPPER_VERCEL.md)

---

<a id="storage-mirroring-storage-and-mirroring-md"></a>

## Storage & mirroring — STORAGE_AND_MIRRORING.md

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

---

<a id="vercel-api-wrapper-vercel-api-wrapper-md"></a>

## Vercel API wrapper — VERCEL_API_WRAPPER.md

# Vercel wrapper (`modelclone-api/`) — kompletný prehľad

Tento dokument dopĺňa [modelclone-api/README.md](./WRAPPER_VERCEL.md) v monorepe. Popisuje, či wrapper **bezpečne pokrýva NSFW generácie, LoRA tréning** a čo musíš mať v env / DNS.

## Čo wrapper vôbec robí

- **`api/index.js`** načíta **`core/src/server.js`** — žiadna „lite“ verzia.
- **`vercel.json`** spustí rovnaký build ako hlavný projekt (`prisma generate`, `ensure-ffmpeg`, `npm run build`), výstup SPA je `core/dist/public`.
- Všetky routy vrátane **`/api/nsfw/*`**, **`/api/fal/webhook/*`**, **`/api/kie/callback`**, RunPod, WaveSpeed, atď. sú **identické** s hlavnou appkou.

Ak teda na tomto Vercel projekte nastavíš rovnaké (alebo zámerne iné) secrets ako na webe, správanie NSFW a tréningu je **rovnaké** ako pri hlavnom backende.

---

## NSFW generácie

- Volajú sa cez rovnaké endpointy ako v dokumentácii [API_USERS.md](./API_USERS.md) (`/api/nsfw/...`).
- Autentifikácia: JWT alebo **`mcl_…` API kľúč** (ak ho používateľ dostane z adminu).
- **Kredity a limity** sedia s webom, ak je **rovnaká `DATABASE_URL`**.

### Čo musí byť správne na tomto hoste

1. **`CALLBACK_BASE_URL`** (alebo ekvivalent, ktorý kód používa spolu s ním — pozri `getKieCallbackUrl` / fal helpery) musí byť **verejná HTTPS URL tohto** Vercel projektu, ak majú KIE / interné joby posielať výsledky **sem**.
2. Ak generácie dokončuje **fal / KIE cez webhook**, provider musí vedieť zavolať napr.:
   - `https://<tvoj-api-vercel>/api/kie/callback`
   - `https://<tvoj-api-vercel>/api/fal/webhook/...`
3. V **CORS** na Verceli už máš v hlavnom `vercel.json` hlavičky pre KIE callback; wrapper ich kopíruje.

Ak necháš `CALLBACK_BASE_URL` na **hlavnej doméne**, ale klient volá **druhý** host, callbacky pôjdu na hlavný server — to môže byť zámer (jedna „worker“ doména na volania, druhá na webhooky) alebo chyba. **Dohodni si jednu pravdu** podľa toho, kde bežia joby.

---

## Trénovanie modelov (LoRA na fal)

- Tréning beží na **strane fal**; náš backend len **enqueue** + **stav v DB** + **webhook** pri dokončení (`/api/fal/webhook/training` a súvisiace cesty — pozri `src/routes/fal-callback.routes.js`).
- Pre tento Vercel deploy musí fal dostať webhook URL odvodenú od **`CALLBACK_BASE_URL`** (funkcia `getFalWebhookUrl` v `fal.service.js`).

### Povinné env (skrátene)

- **`FAL_KEY`** alebo **`FAL_API_KEY`** — na tomto projekte môžeš mať **iný** kľúč ako na webe (oddelené kvóty).
- **`CALLBACK_BASE_URL`** = `https://<presne-tento-deployment>` ak majú webhooky padať sem.

Bez správneho callbacku sa LoRA môže na fal dokončiť, ale **backend neaktualizuje** `trainedLora` / `loraUrl`.

---

## Limity Vercelu (dôležité)

- **`maxDuration`: 300 s** na `api/index.js` — dlhé **synchrónne** requesty môžu naraziť na strop. Väčšina NSFW / generácií je **async** (okamžitá odpoveď + webhook alebo polling) — to je v poriadku.
- **Serverless**: studené štarty; prvý request môže byť pomalší. Na kritické webhooky to zvyčajne nevadí.
- **FFmpeg** v bundli je pre Vercel špeciálne riešený (`ensure-ffmpeg`, exclude veľkých balíkov) — rovnako ako na hlavnom projekte. Repurposer na serverless môže mať obmedzenia (to platí **pre každý** Vercel deploy z tohto kódu, nie len pre wrapper).

---

## Submodule `core/`

- Build vždy beží v **`core/`**. Ak je submodule starý, nasadíš starý kód — **aktualizuj** `core` (`git submodule update --remote` podľa vašej politiky).
- **Súkromný** `core` repo: na Verceli **`GITHUB_SUBMODULE_TOKEN`** (pozri `modelclone-api/scripts/vercel-install.sh`).

---

## Súhrn: bude to fungovať na NSFW + tréning?

**Áno**, ak:

- `DATABASE_URL` (a zvyšok DB-related env) zodpovedá očakávaniu,
- **`CALLBACK_BASE_URL`** (a fal/KIE kľúče) smerujú na **správny** host pre tento deploy,
- webhooky z fal/KIE môžu **HTTPS** volať tento Vercel projekt.

Wrapper **nijak neorezáva** NSFW ani LoRA — je to ten istý `server.js`.

---

## Kde je „kompletná“ dokumentácia

| Téma | Súbor |
|------|--------|
| Wrapper repo, submodule, Vercel install | [modelclone-api/README.md](./WRAPPER_VERCEL.md) |
| Tento súbor — NSFW, LoRA, callbacky, limity | [docs/VERCEL_API_WRAPPER.md](./VERCEL_API_WRAPPER.md) |
| HTTP API kľúče (admin) | [docs/ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md) |
| Endpointy pre integrátorov | [docs/API_USERS.md](./API_USERS.md), plné payloady [docs/API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md) |
| Úložisko výstupov (Vercel Blob vs R2, KIE relay) | [docs/STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md) |
| Index API dokumentácie | [docs/API.md](./API.md) |

Ak niečo z tohto chýba v tvojom procese (napr. interný runbook pre env), dopln ho u vás v tíme — v repozitári sú pokryté technické závislosti.

---

<a id="ffmpeg-worker-client-modelclone-ffmpeg-worker-client-md"></a>

## FFmpeg worker client — MODELCLONE_FFMPEG_WORKER_CLIENT.md

# Calling the FFmpeg worker from modelclone

Use the same **`settings`** object the repurposer already builds (`copies`, `filters`, `metadata`) — see `VideoRepurposerPage.jsx` and `POST /video-repurpose/prepare-browser`.

## Outline

1. Upload input (and optional watermark) to R2; build **presigned GET** URLs for the worker to download.
2. For each output copy, create **presigned PUT** + public URL (same as `prepare-browser`).
3. `POST` to `FFMPEG_WORKER_URL/job` with `X-API-Key: FFMPEG_WORKER_API_KEY`.

## Example (Node / server)

```js
const res = await fetch(`${process.env.FFMPEG_WORKER_URL.replace(/\/$/, "")}/job`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.FFMPEG_WORKER_API_KEY,
  },
  body: JSON.stringify({
    inputUrl: presignedGetInput,
    watermarkUrl: presignedGetWatermarkOrUndefined,
    isImage: false,
    settings: { copies, filters, metadata },
    outputPutUrls: outputs.map((o) => ({
      putUrl: o.uploadUrl,
      publicUrl: o.publicUrl,
      contentType: "video/mp4",
    })),
    jobRef: { jobId: prismaJob.id },
    callbackUrl: `${process.env.APP_PUBLIC_URL}/api/video-repurpose/worker-callback`,
    callbackSecret: process.env.FFMPEG_WORKER_CALLBACK_SECRET,
  }),
});
const data = await res.json();
if (!data.ok) throw new Error(data.message || "Worker failed");
```

Wire **`/api/video-repurpose/worker-callback`** in a later PR (verify `X-Callback-Secret`, update `repurposeJob`).

## Env (modelclone)

| Variable | Description |
|----------|-------------|
| `FFMPEG_WORKER_URL` | Primary worker base URL (no trailing slash). |
| `FFMPEG_WORKER_FALLBACK_URL` | Optional backup (e.g. Easypanel ffpmeg) if primary is down — same API and usually same `FFMPEG_WORKER_API_KEY`. |
| `FFMPEG_WORKER_API_KEY` | Shared secret (same as worker’s `FFMPEG_WORKER_API_KEY`) |
| `FFMPEG_WORKER_CALLBACK_SECRET` | Optional; must match what you send as `callbackSecret` and validate in callback route |

Use `getFfmpegWorkerBaseUrls()` from `src/lib/ffmpeg-worker-env.js` to get `[primary, …fallback]` for ordered retries.

---

<a id="ffmpeg-worker-callback-ffmpeg-worker-callback-md"></a>

## FFmpeg worker callback — FFMPEG_WORKER_CALLBACK.md

# FFmpeg worker (`ffpmeg`) — optional callback (no polling)

When **modelclone** (or n8n) sends `POST /job` to the worker, the response already includes `outputUrls` and `outputFileNames`. For **async-style** integration, the worker can also **POST the same JSON** to your app when the job finishes.

## Request body (extra fields)

| Field | Type | Description |
|--------|------|-------------|
| `callbackUrl` | string | HTTPS URL to `POST` when the job completes (success or failure). |
| `callbackSecret` | string | Optional. Sent as header `X-Callback-Secret` so your route can verify the caller. |
| `jobRef` | any JSON | Optional. Echoed back in the callback payload (e.g. `{ "jobId": "uuid" }` from Prisma). |

## Callback payload — success

Same as the HTTP 200 body from `/job`:

```json
{
  "ok": true,
  "outputUrls": ["https://..."],
  "outputFileNames": ["stem_repurpose_001.jpg"],
  "jobRef": { "jobId": "..." }
}
```

## Callback payload — failure

Same as the HTTP 500 body:

```json
{
  "ok": false,
  "error": "Job failed",
  "message": "FFmpeg failed…",
  "jobRef": { "jobId": "..." }
}
```

## Modelclone (future)

Add a route e.g. `POST /api/video-repurpose/worker-callback` that:

1. Verifies `X-Callback-Secret` matches `FFMPEG_WORKER_CALLBACK_SECRET` in env.
2. Reads `jobRef.jobId`, updates `repurposeJob` + outputs in the DB.
3. Returns `200` quickly.

The worker does **not** wait for the callback to succeed; failures are logged only.

## Env (worker)

| Variable | Default | Description |
|----------|---------|-------------|
| `FFMPEG_WORKER_CALLBACK_TIMEOUT_MS` | `120000` | Max wait for callback HTTP (capped at 300s). |
| `FFMPEG_WORKER_JSON_LIMIT` | `4mb` | Max JSON body size for `/job`. |

---

<a id="full-integrator-reference-api-integrators-reference-md"></a>

## Full integrator reference — API_INTEGRATORS_REFERENCE.md

# ModelClone HTTP API — full integrator reference

**Audience:** developers calling ModelClone on behalf of a user (API key `mcl_…` or JWT).  
**Scope:** user-facing **product** routes under `/api` (generations, uploads, NSFW/LoRA, Creator Studio, repurposer, drafts, support, etc.) registered in `routes/api.routes.js` and closely related behavior. **Excluded:** admin-only surfaces, **payment rails** (`/api/stripe`, `/api/crypto` — checkout is web-app only; not part of the programmatic integrator contract), payment webhooks, provider callbacks, routes that require browser-only flows unless noted.

**Maintenance:** When the API changes, update this file and the cited controllers. The repository does not ship OpenAPI; this document is the structured contract overview.

### Related docs

| Topic | Document |
|--------|-----------|
| Short integrator guide (auth, CORS, polling, Business flow) | [API_USERS.md](./API_USERS.md) |
| OpenAPI 3.0 route inventory (`npm run openapi:generate`) | [openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json) |
| Doc index | [API.md](./API.md) |
| Blob vs R2, media URLs | [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md) |
| Admin API keys | [ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md) |

---

## Table of contents

1. [Conventions](#1-conventions)  
2. [Authentication](#2-authentication)  
3. [Error handling](#3-error-handling)  
4. [Trusted media URLs (SSRF)](#4-trusted-media-urls-ssrf)  
5. [Core types](#5-core-types)  
6. [Uploads & pricing](#6-uploads--pricing)  
7. [Models](#7-models)  
8. [Generations — list, get, delete](#8-generations--list-get-delete)  
9. [Generation modes — SFW / core](#9-generation-modes--sfw--core)  
10. [Creator Studio](#10-creator-studio)  
11. [Voices & talking head](#11-voices--talking-head)  
12. [NSFW & LoRA](#12-nsfw--lora)  
13. [Extended: img2img](#13-extended-img2img-apiimg2img)  
14. [Extended: video repurposer](#14-extended-video-repurposer-apivideo-repurpose)  
15. [Extended: media reformatter](#15-extended-media-reformatter-apireformatter)  
16. [Extended: drafts](#16-extended-drafts-apidrafts)  
17. [Extended: support chat](#17-extended-support-chat-apisupport)  
18. [Extended: viral reels](#18-extended-viral-reels-apiviral-reels)  
19. [Other routers (referrals, avatars)](#19-other-routers-referrals-avatars)  
20. [Public & misc](#20-public--misc)  

---

## 1. Conventions

- **Base path:** all routes below are prefixed with `/api` (e.g. `POST /api/generate/advanced` → full path `/api/generate/advanced`).
- **Content-Type:** use `application/json` for JSON bodies unless the endpoint specifies `multipart/form-data`.
- **Timestamps:** ISO-8601 strings where returned (e.g. `createdAt`, `completedAt`).
- **Boolean query flags:** e.g. `GET /api/generations?includeTotal=false`.
- **Credits:** integer pool per user; insufficient credits → usually `403` or `402` with a `message` (exact status varies by endpoint — see sections below).
- **Async jobs:** many `POST` handlers create a `Generation` (or job) and return immediately with `status: "processing"`. Poll `GET /api/generations/:id` until `status` is terminal (`completed` or `failed`).
- **Idempotency (subset):** `POST /api/generate/advanced` accepts `idempotencyKey` in body or header `X-Idempotency-Key` (see [§9.10](#910-post-apigenerateadvanced)).

---

## 2. Authentication

| Header | Example |
|--------|---------|
| `X-Api-Key` | `mcl_…` |
| `Authorization` | `ApiKey mcl_…` or `Bearer mcl_…` |

JWT session cookies are used by the web app; **integrators normally use the API key only.**

---

## 3. Error handling

Responses are JSON. Shapes are **not fully uniform**; always inspect HTTP status.

### 3.1 Common status codes

| Status | Meaning |
|--------|---------|
| `200` | Success (sync result or OK). |
| `202` | Accepted — background job started (`jobId` in some NSFW helpers). |
| `400` | Bad request / validation / business rule (missing field, invalid enum). |
| `401` | Missing or invalid auth. |
| `402` | Payment-like insufficient credits (some endpoints). |
| `403` | Forbidden (ownership, ban, NSFW locked, CORS on API key). |
| `404` | Resource not found. |
| `409` | Conflict (e.g. cannot delete in-flight generations). |
| `413` | Upload too large (`FILE_TOO_LARGE`, see multer handler in `api.routes.js`). |
| `429` | Rate limited. |
| `500` | Server error. |
| `503` | Dependency unavailable (storage, fal, OpenRouter, etc.). |
| `504` | Upstream timeout (e.g. analyze-looks). |

### 3.2 Typical JSON shapes

**Generic success (many routes):**

```json
{ "success": true, ... }
```

**Generic failure:**

```json
{ "success": false, "message": "Human-readable explanation" }
```

**Validation (`express-validator` — routes using `handleValidationErrors`):**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "photo1Url", "message": "Invalid photo 1 URL" }]
}
```

**Structured provider / upload errors (examples):**

```json
{
  "success": false,
  "code": "SOURCE_VIDEO_INVALID",
  "message": "...",
  "solution": "..."
}
```

**Ban lock:**

```json
{ "success": false, "code": "ACCOUNT_BAN_LOCKED", ... }
```

---

## 4. Trusted media URLs (SSRF)

### 4.1 `validateGeneration` middleware

Routes using `middleware/validation.js` restrict string URL fields to hosts matching an allowlist (substring match on hostname), including for example:

`res.cloudinary.com`, `*.cloudinary.com`, `replicate.delivery`, `wavespeed.ai`, `storage.googleapis.com`, `*.amazonaws.com`, `*.cloudfront.net`, `*.r2.dev`, `blob.vercel-storage.com`, `kie.ai`, `fal.media`, `fal.run`, `runpod.io`, etc.

Validated field names include (when present in body): `prompt` (length), `targetImage`, `sourceImage`, `faceImage`, `videoUrl`, `referenceVideoUrl`, `imageUrl`, `identityImages[]`.

**Note:** Some routes use **additional** URL fields **not** listed in `validateGeneration` (e.g. `modelIdentityImages`, `modelImages`, `referencePhotos`). Those are validated in controllers via `utils/fileValidation.js` (`validateImageUrl`, `validateImageUrls`, `validateVideoUrl`, …) with a **different** allowlist. **Always use HTTPS URLs your deployment can fetch and that pass server checks.**

---

## 5. Core types

### 5.1 `Generation` (subset returned by `GET /api/generations/:id`)

| Field | Type | Notes |
|-------|------|--------|
| `id` | string (UUID) | Poll key. |
| `modelId` | string \| null | |
| `type` | string | e.g. `image`, `video`, `prompt-video`, `face-swap`, `nsfw`, `nsfw-video`, `advanced-image`, `creator-studio`, … |
| `prompt` | string | |
| `duration` | number \| null | Seconds where applicable. |
| `outputUrl` | string \| null | Present when `completed` (may be Blob or provider URL). |
| `inputImageUrl` | string \| null | Sometimes JSON string with extra metadata. |
| `status` | string | `pending`, `processing`, `completed`, `failed`, … |
| `errorMessage` | string \| null | User-safe message when `failed`. |
| `createdAt`, `completedAt` | string (ISO) | |
| `isTrial` | boolean | |

List endpoint `GET /api/generations` returns the same fields (expanded selection includes provider metadata). Pagination:

```json
{
  "success": true,
  "generations": [ ... ],
  "pagination": { "total": 123, "limit": 50, "offset": 0 },
  "retention": { "maxCompletedPerModel": null }
}
```

Query filters: `type`, `modelId`, `status` (comma-separated list allowed), `limit`, `offset`, `includeTotal`.

---

## 6. Uploads & pricing

### 6.1 `GET /api/upload/config`

**Auth:** required.

**Response:**

```json
{
  "directToBlob": true,
  "maxUploadBytes": 524288000,
  "maxUploadLabel": "500 MB"
}
```

### 6.2 `POST /api/upload/blob`

**Auth:** required.  
**Body:** Vercel Blob `handleUpload` protocol (see [`@vercel/blob/client`](https://vercel.com/docs/storage/vercel-blob/using-blob-sdk#client-uploads)) — not a custom JSON schema.  
**Errors:** `400` with `{ "error": "..." }`, or `503` if Blob not configured.

### 6.3 `POST /api/upload/presign`

**Auth:** required.  
**Body:**

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `contentType` | string | yes | MIME type |
| `folder` | string | no | `uploads` \| `training` \| `support-attachments` \| `generations` |

**Response:** `{ "success": true, "uploadUrl", "publicUrl" }`  
**Errors:** `409` if Blob-only mode disallows R2 presign; `503` if R2 missing.

### 6.4 `POST /api/upload`

**Auth:** required.  
**Content-Type:** `multipart/form-data`; field name **`file`**.

**Response:** `{ "success": true, "url": "<https://...>" }`

### 6.5 `GET /api/pricing/generation`

**Auth:** required.  
**Response:** `{ "success": true, "pricing": { ... } }` — numeric rates for UI parity with server charges.

---

## 7. Models

### 7.1 `POST /api/models`

**Auth:** required. Middleware: `validateModelCreation`.

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | yes | 1–100 chars; `^[a-zA-Z0-9\s\-_\.]*$` |
| `photo1Url`, `photo2Url`, `photo3Url` | string | yes | Valid URL, max 1000 chars |

**Errors:** `400` validation array.

### 7.2 `GET /api/models`

**Auth:** required. Returns user’s models (shape from `controllers/model.controller.js`).

### 7.3 `GET /api/models/:id`

**Auth:** required.

### 7.4 `PUT /api/models/:id`

**Auth:** required. `validateModelUpdate` — all fields optional; same rules as create for provided fields; optional `age` 1–120.

### 7.5 `DELETE /api/models/:id`

**Auth:** required.

### 7.6 `GET /api/models/status/:id`

**Auth:** required. **Response:** `{ "status": "ready" | ..., "model": { id, status, photo1Url, ... } }` or `404`.

### 7.7 AI model creation (phased)

| Method | Path | Body summary |
|--------|------|----------------|
| POST | `/api/models/generate-ai` | See `controllers/model.controller.js` — legacy single-step. |
| POST | `/api/models/generate-reference` | Phase 1 — reference image. |
| POST | `/api/models/generate-poses` | Phase 2 — poses from reference. |
| POST | `/api/models/generate-advanced` | Advanced AI model flow. |
| POST | `/api/models/trial-reference` | Trial reference. |
| POST | `/api/models/trial-upload-real` | Multipart trial upload. |
| POST | `/api/models/trial-upload-blob` | Blob URL based trial. |

**Note:** Exact JSON bodies for AI flows are large and evolve; inspect the corresponding handler in `model.controller.js` for the current required fields.

### 7.8 Per-model voice (ElevenLabs)

| Method | Path | Body / form |
|--------|------|-------------|
| GET | `/api/models/voice-platform/status` | — |
| POST | `/api/models/:modelId/voice/design-previews` | JSON: `voiceDescription`, `language` |
| POST | `/api/models/:modelId/voice/design-confirm` | JSON: `generatedVoiceId`, `voiceDescription`, `language`, `consentConfirmed` |
| POST | `/api/models/:modelId/voice/clone` | `multipart/form-data`: field **`audio`** (MP3) |
| GET | `/api/models/:modelId/voices` | — |
| POST | `/api/models/:modelId/voices/design-previews` | JSON: `voiceDescription`, `language`, optional `gender` |
| POST | `/api/models/:modelId/voices/design-confirm` | JSON: `generatedVoiceId`, `voiceDescription`, `language`, `consentConfirmed` |
| POST | `/api/models/:modelId/voices/clone` | multipart `audio` |
| POST | `/api/models/:modelId/voices/:voiceId/select` | JSON: `voiceId` optional in path |
| DELETE | `/api/models/:modelId/voices/:voiceId` | — |
| POST | `/api/models/:modelId/voices/generate-audio` | JSON: `voiceId`, `script`, optional `language`, `regenerateFromId` |

---

## 8. Generations — list, get, delete

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/generations` | Query: `type`, `modelId`, `status`, `limit`, `offset`, `includeTotal`. |
| GET | `/api/generations/:id` | Single generation (subset fields). |
| GET | `/api/generations/monthly-stats` | `{ success, images, videos }` for current month. |
| POST | `/api/generations/batch-delete` | Body: `{ "generationIds": string[] }`. **409** if any id still `pending`/`processing`. |

---

## 9. Generation modes — SFW / core

Unless noted, **Auth:** required, **`validateGeneration`** + **`generationLimiter`**.

### 9.1 `POST /api/generate/image-identity`

**Body:**

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `modelId` | string | yes | |
| `targetImage` | string (URL) | yes | |
| `aspectRatio` | string | no | |
| `size` | string | no | |
| `quantity` | number | no | 1–10, default 1 |
| `prompt` | string | no | max 3000 (middleware) |
| `clothesMode` | string | no | |
| `tempGenerationIds` | string[] | no | client correlation |

**Success:** returns generation payload(s) per controller (may include multiple ids for quantity > 1).  
**Errors:** `400` missing fields; `403` model ownership.

### 9.2 `POST /api/generate/describe-target`

**Body:** `targetImageUrl` (required, HTTPS), optional `modelName`, `clothesMode`.  
**Credits:** priced via `pricing.describeTargetImage`.  
**Errors:** `400` invalid URL; `403` credits; `503` OpenRouter missing.

### 9.3 `POST /api/generate/video-motion`

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `generatedImageUrl` | string | yes |
| `referenceVideoUrl` | string | yes |
| `videoDuration` | number | yes (>0) |
| `modelId` | string | no |
| `prompt` | string | no |
| `keepAudio` | boolean | no (default true) |
| `ultra` / `ultraMode` | boolean | no |
| `recreateEngine` | string | no |
| `wanResolution` | string | no |
| `tempId` | string | no |

**Errors:** `400` validation; `403` credits.

### 9.4 `POST /api/generate/complete-recreation`

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `modelId` | string | yes |
| `modelIdentityImages` | string[3] | yes — exactly 3 HTTPS URLs |
| `videoScreenshot` | string | yes |
| `originalVideoUrl` | string | yes |
| `videoPrompt` | string | no |
| `ultra` / `ultraMode` | boolean | no |
| `recreateEngine` | string | no |
| `wanResolution` | string | no |
| `videoDuration` | number | no (default 5) |
| `aspectRatio` | string | no |
| `numFrames` | number | no |

### 9.5 `POST /api/generate/extract-frames`

**Body:** `{ "referenceVideoUrl": string }`  
**Response:** `{ "success": true, "frames": [...], "videoDuration": number }`  
**Cost:** free (no credits).

### 9.6 `POST /api/generate/prepare-video`

**Body:** `modelId`, `modelImages` (exactly 3 URLs), `selectedFrameUrl`.

**Response:** `{ "success", "variations": [{ "id", "variationNumber", "imageUrl" }], "creditsUsed", ... }`

### 9.7 `POST /api/generate/complete-video`

**Body:** `selectedImageUrl`, `referenceVideoUrl`, optional `modelId`, `prompt`, `ultra`, `recreateEngine`, `wanResolution`, `videoDuration`.

### 9.8 `POST /api/generate/video-directly`

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `referenceVideoUrl` | string | yes |
| `videoDuration` | number | yes |
| `selectedImageUrl` | string | yes | identity frame |
| `ultra` / `ultraMode` | boolean | no |
| `recreateEngine` | string | no |
| `wanResolution` | string | no |
| `tempId` | string | no |

*(Route comment in code may mention `modelId`; the controller above does not require it.)*

### 9.9 `POST /api/generate/video-prompt`

**Body:** `imageUrl`, `prompt`, `duration` (`5` \| `10`), optional `tempId`.

**Response:** `{ "success": true, "generation": { ... }, "creditsUsed" }`

**Errors:** `400` bad duration / missing fields; **402** possible for credits in some code paths.

### 9.10 `POST /api/generate/advanced`

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `modelId` | string | yes |
| `engine` | string | yes | `nano-banana` \| `seedream` |
| `prompt` | string | yes | |
| `referencePhotos` | string[] | no | if empty, uses model photos |
| `idempotencyKey` | string | no | or header `X-Idempotency-Key` |

**Response:** `{ "success": true, "generationId", "creditsUsed", "message" }` — async completion via KIE/WaveSpeed callbacks.

**Errors:** `400` invalid engine / validation; `403` credits; `404` model.

### 9.11 `POST /api/generate/analyze-looks`

**Body:** `imageUrls` (string[], at least one public **https** URL, ≤3 used), optional `freeForOnboarding` (boolean, only when user not finished onboarding).

**Response:** `{ "success": true, "looks": { ... }, "creditsUsed", "freeOnboarding" }`

**Errors:** `400` no usable images; `403` credits; `504` timeout.

### 9.12 `POST /api/generate/enhance-prompt`

**Body:** `prompt` (required), `mode` optional `casual` \| `nsfw` \| `ultra-realism`, optional `modelLooks` object.

**Response:** `{ "success": true, "enhancedPrompt", "creditsUsed" }`

### 9.13 `POST /api/generate/prompt-image`

**Body:**

| Field | Type | Default | Notes |
|-------|------|---------|--------|
| `modelId` | string | — | required |
| `prompt` | string | — | required |
| `quantity` | number | 1 | |
| `style` | string | `amateur` | |
| `contentRating` | string | `sexy` | affects Seedream vs Nano route |
| `useNsfw` | boolean | false | forces Seedream path when true |
| `useCustomPrompt` | boolean | false | skip appearance prefix when true |

### 9.14 `POST /api/generate/image-faceswap`

**Body:** `targetImageUrl`, `sourceImageUrl`, optional `tempId`.

**Response:** immediate `processing` generation; poll `GET /api/generations/:id`.

**Errors:** **402** insufficient credits.

### 9.15 `POST /api/generate/face-swap` (alias: `/api/generate/face-swap-video`)

**Body:**

| Field | Type | Required |
|-------|------|----------|
| `sourceVideoUrl` | string | yes |
| `modelId` | string | yes |
| `videoDuration` | number | yes |
| `targetGender` | string | no | `all` \| `female` \| `male` |
| `targetIndex` | number | no |
| `maxDuration` | number | no |
| `tempId` | string | no |

**Errors:** `400` + optional `code: "SOURCE_VIDEO_INVALID"` with `solution`.

### 9.16 `POST /api/generate/talking-head`

**Body:** `imageUrl`, `voiceId`, `text` (5–`textMaxChars`), optional `tempId`, `prompt`.

**Errors:** **402** credits; `400` length / missing fields.

---

## 10. Creator Studio

### 10.1 `POST /api/generate/creator-studio`

**Body (main fields):**

| Field | Type | Notes |
|-------|------|--------|
| `prompt` | string | required |
| `referencePhotos` | string[] | max 8 URLs |
| `aspectRatio` | string | one of: `1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, `3:2`, `5:4`, `4:5`, `21:9` |
| `resolution` | string | `1K` \| `2K` \| `4K` |
| `generationModel` | string | see list below |
| `inputImageUrl`, `maskUrl` | string | required for some models |
| `numImages` | number | 1–4 |
| `outputFormat` | string | e.g. `jpeg` / `png` |
| … | … | Ideogram / Seedream / Flux-specific knobs in controller |

**`generationModel` values:** `nano-banana-pro`, `flux-kontext-pro`, `flux-kontext-max`, `wan-2-7-image`, `wan-2-7-image-pro`, `ideogram-v3-text`, `ideogram-v3-edit`, `ideogram-v3-remix`, `seedream-v4-5-edit`.

### 10.2 `POST /api/generate/creator-studio/video`

**Body:** large matrix — **`family`** (`sora2`, `kling26`, `kling30`, `veo31`, `wan22`, `wan26`, `wan27`, `seedance2` or aliases), **`mode`** (per-family), **`prompt`**, plus family-specific URLs (`imageUrl`, `referenceImageUrl`, `inputVideoUrl`, …), durations, quality flags. See `controllers/generation.controller.js` and `CREATOR_STUDIO_VIDEO_ALLOWED_MODES`.

### 10.3 `POST /api/generate/creator-studio/video/extend`

Extends an existing creator-studio video generation — body includes source task/generation linkage (see controller).

### 10.4 Assets & mask

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/generate/creator-studio/mask-upload` | Multipart mask upload handler |
| GET | `/api/generate/creator-studio/assets` | List assets |
| POST | `/api/generate/creator-studio/assets` | Create asset |
| DELETE | `/api/generate/creator-studio/assets/:assetId` | Delete |

---

## 11. Voices & talking head

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/voices` | ElevenLabs voice catalog |
| GET | `/api/voices/:voiceId/preview?language=en` | Preview audio |

Talking head generation: [§9.16](#916-post-apigeneratetalking-head).

---

## 12. NSFW & LoRA

** Preconditions (typical):** model must be AI-generated or `nsfwOverride`; user age gates; many flows require `nsfwUnlocked` / trained LoRA. Expect **`403`** with explanatory `message` when blocked.

### 12.1 LoRA CRUD

| Method | Path | Body / params |
|--------|------|----------------|
| POST | `/api/nsfw/lora/create` | `modelId`, optional `name`, `defaultAppearance`, `trainingMode` (`standard` \| `pro`) |
| GET | `/api/nsfw/loras/:modelId` | — |
| POST | `/api/nsfw/lora/set-active` | `modelId`, `loraId` |
| DELETE | `/api/nsfw/lora/:loraId` | — |
| PUT | `/api/nsfw/lora/:loraId/appearance` | `{ "appearance": { ... } }` — keys from server `APPEARANCE_VALID_KEYS` |
| POST | `/api/nsfw/lora/:loraId/auto-appearance` | — |
| POST | `/api/nsfw/appearance/save` | `modelId`, `appearance` object |
| GET | `/api/nsfw/appearance/:modelId` | — |

### 12.2 Training flow

| Method | Path | Body |
|--------|------|------|
| POST | `/api/nsfw/initialize-training` | `{ "modelId" }` — charges training session credits |
| POST | `/api/nsfw/generate-training-images` | See controller |
| POST | `/api/nsfw/start-training-session` | See controller |
| POST | `/api/nsfw/regenerate-training-image` | See controller |
| POST | `/api/nsfw/assign-training-images` | `modelId`, `images: [{ "generationId": string }]`, optional `loraId` |
| POST | `/api/nsfw/register-training-images` | See `api.routes.js` inline handler |
| POST | `/api/nsfw/upload-training-images` | `multipart/form-data`, field **`photos`** (array, up to 30) |
| GET | `/api/nsfw/training-images/:modelId` | — |
| POST | `/api/nsfw/train-lora` | `{ "modelId", "loraId"? }` |
| GET | `/api/nsfw/training-status/:modelId` | — |

**Important:** `trainLora` returns **`503`** with `code: "R2_NOT_CONFIGURED"` if R2 env is missing — even when Blob is used elsewhere; confirm server config.

### 12.3 NSFW generation

| Method | Path | Body summary |
|--------|------|----------------|
| POST | `/api/nsfw/generate` | `modelId`, `prompt`, optional `attributes`, `attributesDetail`, `options`, `skipFaceSwap`, `faceSwapImageUrl`, `sceneDescription`, `quantity` (1 or 2) |
| POST | `/api/nsfw/nudes-pack` | `modelId`, `poseIds` (validated list), optional `attributes`, `attributesDetail`, `sceneDescription`, `skipFaceSwap`, `faceSwapImageUrl`, `options`, `resolution` |
| GET | `/api/nsfw/nudes-pack-poses` | Active pose catalog |
| POST | `/api/nsfw/generate-prompt` | `modelId`, `userRequest`, optional `attributes`, `attributesDetail` → `{ prompt }` |
| POST | `/api/nsfw/plan-generation` | `modelId`, `userRequest` → **202** `{ jobId, status }` |
| GET | `/api/nsfw/plan-generation/status/:jobId` | → `completed` \| `processing` \| `failed` + `selections`, `prompt`, … |
| POST | `/api/nsfw/auto-select` | `modelId`, `description` (≤500 chars) → **202** `{ jobId }` |
| GET | `/api/nsfw/auto-select/status/:jobId` | chip suggestions when done |
| POST | `/api/nsfw/generate-advanced` | `modelId`, `prompt`, `model` (`nano-banana` \| …), `referencePhotos[]`, `aspectRatio` |
| POST | `/api/nsfw/test-face-ref` | test harness |
| GET | `/api/nsfw/test-face-ref-status/:requestId` | |
| POST | `/api/nsfw/generate-video` | `modelId`, `imageUrl` (must be user’s completed generation for that model), `prompt?`, `duration` `5` \| `8` |
| POST | `/api/nsfw/extend-video` | `generationId` (source NSFW video), `duration` `5` \| `8`, `prompt?` |

---

## 13. Extended: img2img (`/api/img2img`)

Source: `routes/img2img.routes.js`. **Auth:** user JWT or API key on all routes below.

**JSON body limit:** `POST /describe` and `POST /generate` use a **50MB** JSON parser so `inputImageBase64` can be large.

### `POST /api/img2img/describe`

Starts a JoyCaption / RunPod “describe” job (credits: **0** in current code).

| Field | Type | Required |
|-------|------|----------|
| `inputImageUrl` | string | one of URL or base64 |
| `inputImageBase64` | string | alternative to URL |
| `triggerWord` | string | yes |
| `lookDescription` | string | no |

**Response:** `{ "describeJobId": "<uuid>" }` — this id is a `Generation` row; poll describe-status.

**Errors:** `400` missing fields / bad URL; `402` if credit cost > 0 and low balance; `500` submit failure.

### `GET /api/img2img/describe-status/:id`

`:id` = `describeJobId` from `/describe`.

**Response (examples):**

- Processing: `{ "status": "processing" }`
- Done: `{ "status": "completed", "prompt": "...", "rawDescription": "..." }`
- Failed: `{ "status": "failed", "error": "..." }`

### `POST /api/img2img/generate`

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `inputImageUrl` | string | one of | HTTPS URL |
| `inputImageBase64` | string | one of | avoids hotlink issues |
| `loraUrl` | string | yes | |
| `triggerWord` | string | yes | |
| `lookDescription` | string | no | |
| `loraStrength` | number | no | default `0.8` |
| `denoise` | number | no | default `0.6` |
| `seed` | number | no | |
| `modelId` | string | no | stored on generation |
| `prompt` / `prebuiltPrompt` | string | no | if set, skips full caption pipeline |

**Credits:** **30** upfront.

**Response:** `{ "jobId": "<generation uuid>", "status": "processing" }` — `jobId` is `Generation.id`.

### `GET /api/img2img/status/:jobId`

**Response:**

- `{ "jobId", "status": "completed", "outputUrl", "prompt" }`
- `{ "jobId", "status": "failed", "error": "..." }`
- `{ "jobId", "status": "processing" | "pending" }` while RunPod runs

**Errors:** `404` if not your job.

### `POST /api/img2img/recover-runpod`

**Body:** `{ "runpodJobId": string, "modelId"?: string, "prompt"?: string }` — repair path for ops; creates a new generation linked to RunPod.

---

## 14. Extended: video repurposer (`/api/video-repurpose`)

Source: `routes/video-repurpose.routes.js`.

**Subscription:** most user routes use `requireActiveSubscription` (active subscription, **trialing does not count** here — unlike support — unless `premiumFeaturesUnlocked` or admin). Returns **`403`** `{ ok: false, error: "Active subscription required..." }` when blocked.

**Internal (no user JWT):**

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/video-repurpose/n8n-callback` | Body `secret` must match `N8N_CALLBACK_SECRET` |
| POST | `/api/video-repurpose/worker-progress` | Header `x-api-key` or body `secret` = `FFMPEG_WORKER_API_KEY` |

### `POST /api/video-repurpose/prepare-browser`

**Auth:** JWT/API key + active subscription. **JSON** body:

| Field | Type | Notes |
|-------|------|--------|
| `settings` | object or JSON string | must include `copies` (clamped 1–5); may include `metadata`, `useAiOptimization` |
| `isImage` | boolean | image vs video mode |
| `sourceInfo` | object | optional; `hasAudio` affects smart-filter credit path |

**Smart optimization:** if `settings.useAiOptimization === true`, server charges **10 credits** and injects AI filter presets.

**Response:** `{ ok: true, jobId, outputs: [{ fileName, uploadUrl, fileUrl }], metadataInstructions, isImage, filters?, creditsCharged }`

**Errors:** **`409`** if Blob-only mode (browser presign disabled — use worker flow); **`503`** if R2 not configured.

### `POST /api/video-repurpose/complete-browser`

**Body:** `{ "jobId": string, "outputs": [{ "fileName"|"file_name", "fileUrl"|"download_url" }] }`

**Response:** `{ "ok": true }` or `400`/`404`/`500`.

### `POST /api/video-repurpose/generate`

**Content-Type:** `multipart/form-data`.

| Part | Required | Notes |
|------|----------|--------|
| `video` | usually yes | video or image file (unless URL flow — see below) |
| `watermark` | no | optional overlay |
| `settings` | yes | JSON string: `copies` (1–5), `metadata`, `useAiOptimization`, … |

**Alternate:** body field `videoUrl` (and no file) triggers server download path (`handleGenerateFromUrl`).

**Limits:** max **3** concurrent queued/running jobs per user (**429**); video length max **60s** (**400**); upload size per multer config (e.g. 200MB).

**Response:** `{ "ok": true, "job_id": "<uuid>", "queue_position": number }`

### `POST /api/video-repurpose/generate-with-worker`

Same multipart shape as `/generate`; requires **`BLOB_READ_WRITE_TOKEN`** for worker output (**503** if missing). Uses external FFmpeg worker.

### `GET /api/video-repurpose/jobs/:jobId`

**Response:** `{ "ok": true, "job": { id, status, progress, message, outputs[], error, queue_position } }`

### `GET /api/video-repurpose/jobs/:jobId/download/:fileName`

Streams file from disk or redirects to stored `fileUrl` (302).

### `GET /api/video-repurpose/history`

**Response:** `{ "ok": true, "jobs": [...], "limit": 20 }` — completed jobs only.

### `DELETE /api/video-repurpose/history/:jobId`

Deletes job + R2 outputs (best-effort).

### `POST /api/video-repurpose/compare`

**Multipart:** fields **`videoA`**, **`videoB`** (both videos or both images). **429** if user already has a compare in flight; **503** if global compare pool busy.

**Response:** large JSON from `buildCompareResponse` (probe metadata, SSIM for video, etc.).

### `POST /api/video-repurpose/compare-url`

**JSON:** `{ "fileAUrl", "fileBUrl", "fileAName"?, "fileBName"?, "mimeA"?, "mimeB"? }` — URLs must pass server allowlist (`isAllowedCompareUrl`).

---

## 15. Extended: media reformatter (`/api/reformatter`)

Source: `routes/reformatter.routes.js`. **Auth:** required on all routes.

| Method | Path | Body / form | Response notes |
|--------|------|-------------|----------------|
| POST | `/api/reformatter/prepare-browser` | JSON: `targetExt` (`mp4`\|`jpg`), `originalFileName`? | `{ success, jobId, uploadUrl, publicUrl, outputExt, outputContentType }` — **409** if Blob-only mode |
| POST | `/api/reformatter/register-completed` | JSON: `jobId`, `outputUrl` (https), `originalFileName`?, `outputExt`? | Marks converter job completed |
| POST | `/api/reformatter/prepare-input` | JSON: `originalFileName`?, `contentType`? | Presigned PUT for **input** file — **409** Blob-only |
| POST | `/api/reformatter/convert-with-worker` | JSON: `inputUrl` (public http(s)), `originalFileName`? | **200** `{ success, jobId, message }` then async worker; poll status |
| POST | `/api/reformatter/convert-background` | JSON: `inputUrl`, `originalFileName`? | Same async pattern; server FFmpeg if available |
| GET | `/api/reformatter/status/:jobId` | — | `{ success, job: { id, status, outputUrl, outputExt, errorMessage, ... } }` |
| GET | `/api/reformatter/history` | Query: `limit` (max 100), `cursor` | `{ success, jobs, nextCursor }` |
| POST | `/api/reformatter/convert` | `multipart` field **`file`** OR JSON fields `sourceUrl`, `sourceMime`, `fileName` | Sync-style conversion when upload fits |

Retention: completed converter jobs store `expiresAt` (~**30 days**).

---

## 16. Extended: drafts (`/api/drafts`)

Source: `routes/draft.routes.js`. **Auth:** required.

**Valid `feature` path segments:** `generate-image`, `generate-video`, `nsfw`, `nsfw-img2img`, `repurposer`, `prompt-image`.

| Method | Path | Body |
|--------|------|------|
| GET | `/api/drafts/:feature` | — → `{ success, draft \| null }` |
| PUT | `/api/drafts/:feature` | `{ "data": object (required), "imageUrls"?: string[] }` |
| DELETE | `/api/drafts/:feature` | — |
| POST | `/api/drafts/upload` | `multipart` field **`file`** → `{ success, url }` (R2 `drafts/` — **500** if R2 not configured) |

---

## 17. Extended: support chat (`/api/support`)

Source: `routes/support.routes.js`. **Auth:** required. **Subscription:** active, **trialing**, admin, or `premiumFeaturesUnlocked` (**403** otherwise).

| Method | Path | Body |
|--------|------|------|
| POST | `/api/support/chat/start` | — → `{ success, sessionId }` |
| POST | `/api/support/chat/message` | `multipart`: `sessionId`, `userMessage`, optional `isEndOfChat`; optional file field **`attachments`** (max 1 image) |

**Outbound:** server POSTs JSON to an n8n webhook (hardcoded URL in route file). **502/503** on automation failure. **500** if R2 missing when attachments used.

---

## 18. Extended: viral reels (`/api/viral-reels`)

Source: `routes/viral-reels.routes.js`.

**Subscription:** `requireSub` — **active** or **trialing**, admin, or `premiumFeaturesUnlocked` (**403** `Subscription required`).

**Media routes** accept JWT from cookie/`Authorization` **or** short-lived query JWT from `stream-token` / `media-token` (`type: reel_media`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/viral-reels/` | List top reels (JSON array from `getTopReels`) |
| GET | `/api/viral-reels/media-token` | `{ token }` for thumbnail proxy |
| GET | `/api/viral-reels/media?url=...` | Proxies allowed-host image URLs |
| GET | `/api/viral-reels/:id/stream-token` | `{ token }` scoped to reel |
| GET | `/api/viral-reels/:id/stream` | Video stream / redirect |
| GET | `/api/viral-reels/:id/download` | Attachment-style download |
| GET | `/api/viral-reels/cron-scrape` | Cron / infra (see route for secrets) |
| `POST` … | `/api/viral-reels/admin/*` | **Admin JWT** — profiles, scrape triggers, logs |

**Stream errors:** **`502`** `{ error: "video_expired", message: "..." }` when CDN URL stale and refresh fails.

---

## 19. Other routers (referrals, avatars)

**Billing:** Stripe and cryptocurrency checkout live on the same origin in the monolith but are **not** described here — wrappers should not depend on them; end users buy credits/plans through the official web app (or your separate commercial agreement with ModelClone).

| Prefix | Integrator notes |
|--------|------------------|
| `/api/referrals` | Referral capture and dashboard — `referral.routes.js`. |
| `/api/avatars` | HeyGen photo avatar IV — `avatar.routes.js` (auth + multipart where applicable). |
| `/api/heygen` | Provider callbacks — not for generic API clients. |
| `/api/designer-studio` | **Admin JWT only.** |

---

## 20. Public & misc

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | No |
| GET | `/api/brand` | No |
| GET | `/api/tutorials/catalog` | No |
| POST | `/api/errors/report` | Rate-limited, public error telemetry |

---

*End of reference. For admin API keys and user impersonation, see [ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md).*

---

## Appendix A — Route catalog (generated from OpenAPI)

This section is **generated** from `docs/openapi/modelclone-api.openapi.json`. Use that JSON file for codegen (OpenAPI Generator, `openapi-typescript`, etc.). Narrative request/response fields are in **API_INTEGRATORS_REFERENCE.md** (included above).

### Security schemes (`components.securitySchemes`)

#### `ModelCloneApiKey`

```json
{
  "type": "apiKey",
  "in": "header",
  "name": "X-Api-Key",
  "description": "Per-user secret starting with `mcl_`. Issued after Business plan + admin key creation. Optional CORS allowlist on the key for browser calls."
}
```

#### `ModelCloneBearer`

```json
{
  "type": "http",
  "scheme": "bearer",
  "bearerFormat": "JWT",
  "description": "Same JWT as the web app (cookie or Authorization). For server automation, prefer `X-Api-Key`."
}
```

#### `AdminSession`

```json
{
  "type": "http",
  "scheme": "bearer",
  "bearerFormat": "JWT",
  "description": "Admin panel session — role must be admin."
}
```

### Operations by path

#### GET `/admin/activity`

- **operationId:** `get_admin_activity`
- **summary:** GET /admin/activity
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/affiliate-lander/`

- **operationId:** `get_admin_affiliate-lander_`
- **summary:** GET /admin/affiliate-lander/
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/affiliate-lander/`

- **operationId:** `post_admin_affiliate-lander_`
- **summary:** POST /admin/affiliate-lander/
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/admin/affiliate-lander/{suffix}`

- **operationId:** `delete_admin_affiliate-lander_suffix`
- **summary:** DELETE /admin/affiliate-lander/{suffix}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/affiliate-lander/{suffix}/config`

- **operationId:** `get_admin_affiliate-lander_suffix_config`
- **summary:** GET /admin/affiliate-lander/{suffix}/config
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/affiliate-lander/{suffix}/draft`

- **operationId:** `put_admin_affiliate-lander_suffix_draft`
- **summary:** PUT /admin/affiliate-lander/{suffix}/draft
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/affiliate-lander/{suffix}/publish`

- **operationId:** `post_admin_affiliate-lander_suffix_publish`
- **summary:** POST /admin/affiliate-lander/{suffix}/publish
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/assign-lora`

- **operationId:** `post_admin_assign-lora`
- **summary:** POST /admin/assign-lora
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/backup/create`

- **operationId:** `post_admin_backup_create`
- **summary:** POST /admin/backup/create
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/backup/history`

- **operationId:** `get_admin_backup_history`
- **summary:** GET /admin/backup/history
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/backup/restore-credits`

- **operationId:** `post_admin_backup_restore-credits`
- **summary:** POST /admin/backup/restore-credits
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/branding`

- **operationId:** `get_admin_branding`
- **summary:** GET /admin/branding
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/branding`

- **operationId:** `put_admin_branding`
- **summary:** PUT /admin/branding
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/bulk-import-gallery`

- **operationId:** `post_admin_bulk-import-gallery`
- **summary:** POST /admin/bulk-import-gallery
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/cleanup-generations`

- **operationId:** `post_admin_cleanup-generations`
- **summary:** POST /admin/cleanup-generations
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/credits/add`

- **operationId:** `post_admin_credits_add`
- **summary:** POST /admin/credits/add
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/discount-codes`

- **operationId:** `get_admin_discount-codes`
- **summary:** GET /admin/discount-codes
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/discount-codes`

- **operationId:** `post_admin_discount-codes`
- **summary:** POST /admin/discount-codes
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PATCH `/admin/discount-codes/{id}`

- **operationId:** `patch_admin_discount-codes_id`
- **summary:** PATCH /admin/discount-codes/{id}
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/admin/discount-codes/{id}`

- **operationId:** `delete_admin_discount-codes_id`
- **summary:** DELETE /admin/discount-codes/{id}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/email-unsubscribes`

- **operationId:** `get_admin_email-unsubscribes`
- **summary:** GET /admin/email-unsubscribes
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/admin/email-unsubscribes/{email}`

- **operationId:** `delete_admin_email-unsubscribes_email`
- **summary:** DELETE /admin/email-unsubscribes/{email}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/impersonate`

- **operationId:** `post_admin_impersonate`
- **summary:** POST /admin/impersonate
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/lander-demo-video`

- **operationId:** `post_admin_lander-demo-video`
- **summary:** POST /admin/lander-demo-video
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/admin/lander-demo-video`

- **operationId:** `delete_admin_lander-demo-video`
- **summary:** DELETE /admin/lander-demo-video
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/lander-new/config`

- **operationId:** `get_admin_lander-new_config`
- **summary:** GET /admin/lander-new/config
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/lander-new/draft`

- **operationId:** `put_admin_lander-new_draft`
- **summary:** PUT /admin/lander-new/draft
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/lander-new/publish`

- **operationId:** `post_admin_lander-new_publish`
- **summary:** POST /admin/lander-new/publish
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/lora-recovery`

- **operationId:** `post_admin_lora-recovery`
- **summary:** POST /admin/lora-recovery
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/lost-generations/reconcile`

- **operationId:** `post_admin_lost-generations_reconcile`
- **summary:** POST /admin/lost-generations/reconcile
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/lost-generations/reconcile-all`

- **operationId:** `post_admin_lost-generations_reconcile-all`
- **summary:** POST /admin/lost-generations/reconcile-all
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/marketing-campaigns`

- **operationId:** `get_admin_marketing-campaigns`
- **summary:** GET /admin/marketing-campaigns
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/marketing-campaigns`

- **operationId:** `post_admin_marketing-campaigns`
- **summary:** POST /admin/marketing-campaigns
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/marketing-campaigns/{campaignId}/cancel`

- **operationId:** `post_admin_marketing-campaigns_campaignId_cancel`
- **summary:** POST /admin/marketing-campaigns/{campaignId}/cancel
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/models/{modelId}/fix-photos`

- **operationId:** `post_admin_models_modelId_fix-photos`
- **summary:** POST /admin/models/{modelId}/fix-photos
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/models/{modelId}/looks-unlock`

- **operationId:** `post_admin_models_modelId_looks-unlock`
- **summary:** POST /admin/models/{modelId}/looks-unlock
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/models/{modelId}/nsfw-override`

- **operationId:** `post_admin_models_modelId_nsfw-override`
- **summary:** POST /admin/models/{modelId}/nsfw-override
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/nudes-pack-poses`

- **operationId:** `get_admin_nudes-pack-poses`
- **summary:** GET /admin/nudes-pack-poses
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/nudes-pack-poses`

- **operationId:** `put_admin_nudes-pack-poses`
- **summary:** PUT /admin/nudes-pack-poses
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/pricing/generation`

- **operationId:** `get_admin_pricing_generation`
- **summary:** GET /admin/pricing/generation
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/pricing/generation`

- **operationId:** `put_admin_pricing_generation`
- **summary:** PUT /admin/pricing/generation
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/pricing/generation/reset`

- **operationId:** `post_admin_pricing_generation_reset`
- **summary:** POST /admin/pricing/generation/reset
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/prompt-templates`

- **operationId:** `get_admin_prompt-templates`
- **summary:** GET /admin/prompt-templates
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/prompt-templates`

- **operationId:** `put_admin_prompt-templates`
- **summary:** PUT /admin/prompt-templates
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/provider-balances`

- **operationId:** `get_admin_provider-balances`
- **summary:** GET /admin/provider-balances
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/recover-payment`

- **operationId:** `post_admin_recover-payment`
- **summary:** POST /admin/recover-payment
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/referrals/reconcile`

- **operationId:** `post_admin_referrals_reconcile`
- **summary:** POST /admin/referrals/reconcile
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/safety-checker-config`

- **operationId:** `get_admin_safety-checker-config`
- **summary:** GET /admin/safety-checker-config
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/safety-checker-config`

- **operationId:** `put_admin_safety-checker-config`
- **summary:** PUT /admin/safety-checker-config
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/safety/child-incidents`

- **operationId:** `get_admin_safety_child-incidents`
- **summary:** GET /admin/safety/child-incidents
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/send-marketing-email`

- **operationId:** `post_admin_send-marketing-email`
- **summary:** POST /admin/send-marketing-email
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/send-promo-50off`

- **operationId:** `post_admin_send-promo-50off`
- **summary:** POST /admin/send-promo-50off
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/stats`

- **operationId:** `get_admin_stats`
- **summary:** GET /admin/stats
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/stripe-revenue`

- **operationId:** `get_admin_stripe-revenue`
- **summary:** GET /admin/stripe-revenue
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/subscriptions/reconcile`

- **operationId:** `post_admin_subscriptions_reconcile`
- **summary:** POST /admin/subscriptions/reconcile
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/subscriptions/refills/audit`

- **operationId:** `post_admin_subscriptions_refills_audit`
- **summary:** POST /admin/subscriptions/refills/audit
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/subscriptions/refills/reconcile`

- **operationId:** `post_admin_subscriptions_refills_reconcile`
- **summary:** POST /admin/subscriptions/refills/reconcile
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/telemetry/edge-events`

- **operationId:** `get_admin_telemetry_edge-events`
- **summary:** GET /admin/telemetry/edge-events
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/telemetry/endpoint-health`

- **operationId:** `get_admin_telemetry_endpoint-health`
- **summary:** GET /admin/telemetry/endpoint-health
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/telemetry/overview`

- **operationId:** `get_admin_telemetry_overview`
- **summary:** GET /admin/telemetry/overview
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/telemetry/requests`

- **operationId:** `get_admin_telemetry_requests`
- **summary:** GET /admin/telemetry/requests
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/tutorial-video`

- **operationId:** `post_admin_tutorial-video`
- **summary:** POST /admin/tutorial-video
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/admin/tutorial-video`

- **operationId:** `delete_admin_tutorial-video`
- **summary:** DELETE /admin/tutorial-video
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/tutorial-video-slot`

- **operationId:** `post_admin_tutorial-video-slot`
- **summary:** POST /admin/tutorial-video-slot
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/tutorial-video-slot-commit`

- **operationId:** `post_admin_tutorial-video-slot-commit`
- **summary:** POST /admin/tutorial-video-slot-commit
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/tutorial-video-slots`

- **operationId:** `get_admin_tutorial-video-slots`
- **summary:** GET /admin/tutorial-video-slots
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/upload-email-video`

- **operationId:** `post_admin_upload-email-video`
- **summary:** POST /admin/upload-email-video
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/upload/blob`

- **operationId:** `post_admin_upload_blob`
- **summary:** POST /admin/upload/blob
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/users`

- **operationId:** `get_admin_users`
- **summary:** GET /admin/users
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/users/{id}`

- **operationId:** `get_admin_users_id`
- **summary:** GET /admin/users/{id}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/admin/users/{id}`

- **operationId:** `delete_admin_users_id`
- **summary:** DELETE /admin/users/{id}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/users/{id}/api-keys`

- **operationId:** `get_admin_users_id_api-keys`
- **summary:** GET /admin/users/{id}/api-keys
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/users/{id}/api-keys`

- **operationId:** `post_admin_users_id_api-keys`
- **summary:** POST /admin/users/{id}/api-keys
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/admin/users/{id}/api-keys/{keyId}`

- **operationId:** `delete_admin_users_id_api-keys_keyId`
- **summary:** DELETE /admin/users/{id}/api-keys/{keyId}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/users/{id}/purchases`

- **operationId:** `get_admin_users_id_purchases`
- **summary:** GET /admin/users/{id}/purchases
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/users/{id}/purchases/{purchaseId}/refund`

- **operationId:** `post_admin_users_id_purchases_purchaseId_refund`
- **summary:** POST /admin/users/{id}/purchases/{purchaseId}/refund
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/users/{id}/stripe-sync`

- **operationId:** `post_admin_users_id_stripe-sync`
- **summary:** POST /admin/users/{id}/stripe-sync
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/users/{userId}/ban-lock`

- **operationId:** `post_admin_users_userId_ban-lock`
- **summary:** POST /admin/users/{userId}/ban-lock
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/users/{userId}/credits`

- **operationId:** `post_admin_users_userId_credits`
- **summary:** POST /admin/users/{userId}/credits
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/users/{userId}/models`

- **operationId:** `get_admin_users_userId_models`
- **summary:** GET /admin/users/{userId}/models
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/users/{userId}/pro-access`

- **operationId:** `post_admin_users_userId_pro-access`
- **summary:** POST /admin/users/{userId}/pro-access
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/users/settings`

- **operationId:** `post_admin_users_settings`
- **summary:** POST /admin/users/settings
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/voice-hosting/due`

- **operationId:** `get_admin_voice-hosting_due`
- **summary:** GET /admin/voice-hosting/due
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/admin/voice-hosting/run`

- **operationId:** `post_admin_voice-hosting_run`
- **summary:** POST /admin/voice-hosting/run
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/admin/voice-platform/config`

- **operationId:** `get_admin_voice-platform_config`
- **summary:** GET /admin/voice-platform/config
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/admin/voice-platform/config`

- **operationId:** `put_admin_voice-platform_config`
- **summary:** PUT /admin/voice-platform/config
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/affiliate-lander/{suffix}/published`

- **operationId:** `get_affiliate-lander_suffix_published`
- **summary:** GET /affiliate-lander/{suffix}/published
- **tags:** `Landers`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/2fa/disable`

- **operationId:** `post_auth_2fa_disable`
- **summary:** POST /auth/2fa/disable
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/2fa/generate`

- **operationId:** `post_auth_2fa_generate`
- **summary:** POST /auth/2fa/generate
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/auth/2fa/status`

- **operationId:** `get_auth_2fa_status`
- **summary:** GET /auth/2fa/status
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/2fa/verify`

- **operationId:** `post_auth_2fa_verify`
- **summary:** POST /auth/2fa/verify
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/change-email/request`

- **operationId:** `post_auth_change-email_request`
- **summary:** POST /auth/change-email/request
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/change-email/verify`

- **operationId:** `post_auth_change-email_verify`
- **summary:** POST /auth/change-email/verify
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/change-password`

- **operationId:** `post_auth_change-password`
- **summary:** POST /auth/change-password
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/check-email`

- **operationId:** `post_auth_check-email`
- **summary:** POST /auth/check-email
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/firebase-signup`

- **operationId:** `post_auth_firebase-signup`
- **summary:** POST /auth/firebase-signup
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/google`

- **operationId:** `post_auth_google`
- **summary:** POST /auth/google
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/auth/impersonate-login`

- **operationId:** `get_auth_impersonate-login`
- **summary:** GET /auth/impersonate-login
- **tags:** `Auth`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/login`

- **operationId:** `post_auth_login`
- **summary:** POST /auth/login
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/logout`

- **operationId:** `post_auth_logout`
- **summary:** POST /auth/logout
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/auth/profile`

- **operationId:** `get_auth_profile`
- **summary:** GET /auth/profile
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/auth/profile`

- **operationId:** `put_auth_profile`
- **summary:** PUT /auth/profile
- **tags:** `Auth`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/refresh`

- **operationId:** `post_auth_refresh`
- **summary:** POST /auth/refresh
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/request-password-reset`

- **operationId:** `post_auth_request-password-reset`
- **summary:** POST /auth/request-password-reset
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/resend-code`

- **operationId:** `post_auth_resend-code`
- **summary:** POST /auth/resend-code
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/resend-firebase-code`

- **operationId:** `post_auth_resend-firebase-code`
- **summary:** POST /auth/resend-firebase-code
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/reset-password`

- **operationId:** `post_auth_reset-password`
- **summary:** POST /auth/reset-password
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/signup`

- **operationId:** `post_auth_signup`
- **summary:** POST /auth/signup
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/verify-email`

- **operationId:** `post_auth_verify-email`
- **summary:** POST /auth/verify-email
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/auth/verify-firebase-email`

- **operationId:** `post_auth_verify-firebase-email`
- **summary:** POST /auth/verify-firebase-email
- **tags:** `Auth`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/avatars/`

- **operationId:** `get_avatars_`
- **summary:** GET /avatars/
- **tags:** `Avatars`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/avatars/`

- **operationId:** `post_avatars_`
- **summary:** POST /avatars/
- **tags:** `Avatars`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/avatars/{id}`

- **operationId:** `delete_avatars_id`
- **summary:** DELETE /avatars/{id}
- **tags:** `Avatars`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/avatars/{id}/generate`

- **operationId:** `post_avatars_id_generate`
- **summary:** POST /avatars/{id}/generate
- **tags:** `Avatars`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/avatars/{id}/videos`

- **operationId:** `get_avatars_id_videos`
- **summary:** GET /avatars/{id}/videos
- **tags:** `Avatars`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/avatars/videos/{videoId}`

- **operationId:** `get_avatars_videos_videoId`
- **summary:** GET /avatars/videos/{videoId}
- **tags:** `Avatars`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/brand`

- **operationId:** `get_brand`
- **summary:** GET /brand
- **tags:** `Public`
- **security:** *(none declared)*

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/course/complete-video`

- **operationId:** `post_course_complete-video`
- **summary:** POST /course/complete-video
- **tags:** `Course`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/course/status`

- **operationId:** `get_course_status`
- **summary:** GET /course/status
- **tags:** `Course`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/cron/kie-recovery`

- **operationId:** `get_cron_kie-recovery`
- **summary:** GET /cron/kie-recovery — Cron or deployment secret — not for customer API keys.
- **tags:** `Infrastructure`
- **security:** *(none declared)*

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/debug/email-config`

- **operationId:** `get_debug_email-config`
- **summary:** GET /debug/email-config
- **tags:** `Debug`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/designer-studio/kling-i2v`

- **operationId:** `post_designer-studio_kling-i2v`
- **summary:** POST /designer-studio/kling-i2v
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/designer-studio/kling-motion`

- **operationId:** `post_designer-studio_kling-motion`
- **summary:** POST /designer-studio/kling-motion
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/designer-studio/nano-banana-pro`

- **operationId:** `post_designer-studio_nano-banana-pro`
- **summary:** POST /designer-studio/nano-banana-pro
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/designer-studio/task/{taskId}`

- **operationId:** `get_designer-studio_task_taskId`
- **summary:** GET /designer-studio/task/{taskId}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/download`

- **operationId:** `get_download`
- **summary:** GET /download
- **tags:** `Download`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/drafts/{feature}`

- **operationId:** `get_drafts_feature`
- **summary:** GET /drafts/{feature}
- **tags:** `Drafts`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/drafts/{feature}`

- **operationId:** `put_drafts_feature`
- **summary:** PUT /drafts/{feature}
- **tags:** `Drafts`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/drafts/{feature}`

- **operationId:** `delete_drafts_feature`
- **summary:** DELETE /drafts/{feature}
- **tags:** `Drafts`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/drafts/upload`

- **operationId:** `post_drafts_upload`
- **summary:** POST /drafts/upload
- **tags:** `Drafts`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/errors/report`

- **operationId:** `post_errors_report`
- **summary:** POST /errors/report
- **tags:** `Public`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/advanced`

- **operationId:** `post_generate_advanced`
- **summary:** POST /generate/advanced
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/analyze-looks`

- **operationId:** `post_generate_analyze-looks`
- **summary:** POST /generate/analyze-looks
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/complete-recreation`

- **operationId:** `post_generate_complete-recreation`
- **summary:** POST /generate/complete-recreation
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/complete-video`

- **operationId:** `post_generate_complete-video`
- **summary:** POST /generate/complete-video
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/creator-studio`

- **operationId:** `post_generate_creator-studio`
- **summary:** POST /generate/creator-studio
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/generate/creator-studio/assets`

- **operationId:** `get_generate_creator-studio_assets`
- **summary:** GET /generate/creator-studio/assets
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/creator-studio/assets`

- **operationId:** `post_generate_creator-studio_assets`
- **summary:** POST /generate/creator-studio/assets
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/generate/creator-studio/assets/{assetId}`

- **operationId:** `delete_generate_creator-studio_assets_assetId`
- **summary:** DELETE /generate/creator-studio/assets/{assetId}
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/creator-studio/mask-upload`

- **operationId:** `post_generate_creator-studio_mask-upload`
- **summary:** POST /generate/creator-studio/mask-upload
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/creator-studio/video`

- **operationId:** `post_generate_creator-studio_video`
- **summary:** POST /generate/creator-studio/video
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/creator-studio/video/extend`

- **operationId:** `post_generate_creator-studio_video_extend`
- **summary:** POST /generate/creator-studio/video/extend
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/describe-target`

- **operationId:** `post_generate_describe-target`
- **summary:** POST /generate/describe-target
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/enhance-prompt`

- **operationId:** `post_generate_enhance-prompt`
- **summary:** POST /generate/enhance-prompt
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/extract-frames`

- **operationId:** `post_generate_extract-frames`
- **summary:** POST /generate/extract-frames
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/face-swap`

- **operationId:** `post_generate_face-swap`
- **summary:** POST /generate/face-swap
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/face-swap-video`

- **operationId:** `post_generate_face-swap-video`
- **summary:** POST /generate/face-swap-video
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/image-faceswap`

- **operationId:** `post_generate_image-faceswap`
- **summary:** POST /generate/image-faceswap
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/image-identity`

- **operationId:** `post_generate_image-identity`
- **summary:** POST /generate/image-identity
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/prepare-video`

- **operationId:** `post_generate_prepare-video`
- **summary:** POST /generate/prepare-video
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/prompt-image`

- **operationId:** `post_generate_prompt-image`
- **summary:** POST /generate/prompt-image
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/talking-head`

- **operationId:** `post_generate_talking-head`
- **summary:** POST /generate/talking-head
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/video-directly`

- **operationId:** `post_generate_video-directly`
- **summary:** POST /generate/video-directly
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/video-motion`

- **operationId:** `post_generate_video-motion`
- **summary:** POST /generate/video-motion
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generate/video-prompt`

- **operationId:** `post_generate_video-prompt`
- **summary:** POST /generate/video-prompt
- **tags:** `Generation`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/generations`

- **operationId:** `get_generations`
- **summary:** GET /generations
- **tags:** `Generations`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/generations/{id}`

- **operationId:** `get_generations_id`
- **summary:** GET /generations/{id}
- **tags:** `Generations`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/generations/batch-delete`

- **operationId:** `post_generations_batch-delete`
- **summary:** POST /generations/batch-delete
- **tags:** `Generations`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/generations/monthly-stats`

- **operationId:** `get_generations_monthly-stats`
- **summary:** GET /generations/monthly-stats
- **tags:** `Generations`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/health`

- **operationId:** `get_health`
- **summary:** GET /health
- **tags:** `Public`
- **security:** *(none declared)*

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/heygen/webhook`

- **operationId:** `post_heygen_webhook`
- **summary:** POST /heygen/webhook — HeyGen provider callback — not for customer API keys.
- **tags:** `Infrastructure`
- **security:** *(none declared)*

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/img2img/describe`

- **operationId:** `post_img2img_describe`
- **summary:** POST /img2img/describe
- **tags:** `Img2img`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/img2img/describe-status/{id}`

- **operationId:** `get_img2img_describe-status_id`
- **summary:** GET /img2img/describe-status/{id}
- **tags:** `Img2img`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/img2img/generate`

- **operationId:** `post_img2img_generate`
- **summary:** POST /img2img/generate
- **tags:** `Img2img`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/img2img/recover-runpod`

- **operationId:** `post_img2img_recover-runpod`
- **summary:** POST /img2img/recover-runpod
- **tags:** `Img2img`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/img2img/status/{jobId}`

- **operationId:** `get_img2img_status_jobId`
- **summary:** GET /img2img/status/{jobId}
- **tags:** `Img2img`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/lander-new/config`

- **operationId:** `get_lander-new_config`
- **summary:** GET /lander-new/config
- **tags:** `Landers`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/modelclone-x/character/{loraId}`

- **operationId:** `delete_modelclone-x_character_loraId`
- **summary:** DELETE /modelclone-x/character/{loraId}
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/modelclone-x/character/create`

- **operationId:** `post_modelclone-x_character_create`
- **summary:** POST /modelclone-x/character/create
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/modelclone-x/character/train`

- **operationId:** `post_modelclone-x_character_train`
- **summary:** POST /modelclone-x/character/train
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/modelclone-x/character/training-status/{loraId}`

- **operationId:** `get_modelclone-x_character_training-status_loraId`
- **summary:** GET /modelclone-x/character/training-status/{loraId}
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/modelclone-x/character/upload-images`

- **operationId:** `post_modelclone-x_character_upload-images`
- **summary:** POST /modelclone-x/character/upload-images
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/modelclone-x/characters/{modelId}`

- **operationId:** `get_modelclone-x_characters_modelId`
- **summary:** GET /modelclone-x/characters/{modelId}
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/modelclone-x/config`

- **operationId:** `get_modelclone-x_config`
- **summary:** GET /modelclone-x/config
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/modelclone-x/generate`

- **operationId:** `post_modelclone-x_generate`
- **summary:** POST /modelclone-x/generate
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/modelclone-x/status/{generationId}`

- **operationId:** `get_modelclone-x_status_generationId`
- **summary:** GET /modelclone-x/status/{generationId}
- **tags:** `Modelclone-x`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/models`

- **operationId:** `get_models`
- **summary:** GET /models
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models`

- **operationId:** `post_models`
- **summary:** POST /models
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/models/{id}`

- **operationId:** `get_models_id`
- **summary:** GET /models/{id}
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/models/{id}`

- **operationId:** `put_models_id`
- **summary:** PUT /models/{id}
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/models/{id}`

- **operationId:** `delete_models_id`
- **summary:** DELETE /models/{id}
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voice/clone`

- **operationId:** `post_models_modelId_voice_clone`
- **summary:** POST /models/{modelId}/voice/clone
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voice/design-confirm`

- **operationId:** `post_models_modelId_voice_design-confirm`
- **summary:** POST /models/{modelId}/voice/design-confirm
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voice/design-previews`

- **operationId:** `post_models_modelId_voice_design-previews`
- **summary:** POST /models/{modelId}/voice/design-previews
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/models/{modelId}/voices`

- **operationId:** `get_models_modelId_voices`
- **summary:** GET /models/{modelId}/voices
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/models/{modelId}/voices/{voiceId}`

- **operationId:** `delete_models_modelId_voices_voiceId`
- **summary:** DELETE /models/{modelId}/voices/{voiceId}
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voices/{voiceId}/select`

- **operationId:** `post_models_modelId_voices_voiceId_select`
- **summary:** POST /models/{modelId}/voices/{voiceId}/select
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voices/clone`

- **operationId:** `post_models_modelId_voices_clone`
- **summary:** POST /models/{modelId}/voices/clone
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voices/design-confirm`

- **operationId:** `post_models_modelId_voices_design-confirm`
- **summary:** POST /models/{modelId}/voices/design-confirm
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voices/design-previews`

- **operationId:** `post_models_modelId_voices_design-previews`
- **summary:** POST /models/{modelId}/voices/design-previews
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/{modelId}/voices/generate-audio`

- **operationId:** `post_models_modelId_voices_generate-audio`
- **summary:** POST /models/{modelId}/voices/generate-audio
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/generate-advanced`

- **operationId:** `post_models_generate-advanced`
- **summary:** POST /models/generate-advanced
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/generate-ai`

- **operationId:** `post_models_generate-ai`
- **summary:** POST /models/generate-ai
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/generate-poses`

- **operationId:** `post_models_generate-poses`
- **summary:** POST /models/generate-poses
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/models/generate-reference`

- **operationId:** `post_models_generate-reference`
- **summary:** POST /models/generate-reference
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/models/status/{id}`

- **operationId:** `get_models_status_id`
- **summary:** GET /models/status/{id}
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/models/voice-platform/status`

- **operationId:** `get_models_voice-platform_status`
- **summary:** GET /models/voice-platform/status
- **tags:** `Models`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/appearance/{modelId}`

- **operationId:** `get_nsfw_appearance_modelId`
- **summary:** GET /nsfw/appearance/{modelId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/appearance/save`

- **operationId:** `post_nsfw_appearance_save`
- **summary:** POST /nsfw/appearance/save
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/assign-training-images`

- **operationId:** `post_nsfw_assign-training-images`
- **summary:** POST /nsfw/assign-training-images
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/auto-select`

- **operationId:** `post_nsfw_auto-select`
- **summary:** POST /nsfw/auto-select
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/auto-select/status/{jobId}`

- **operationId:** `get_nsfw_auto-select_status_jobId`
- **summary:** GET /nsfw/auto-select/status/{jobId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/extend-video`

- **operationId:** `post_nsfw_extend-video`
- **summary:** POST /nsfw/extend-video
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/generate`

- **operationId:** `post_nsfw_generate`
- **summary:** POST /nsfw/generate
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/generate-advanced`

- **operationId:** `post_nsfw_generate-advanced`
- **summary:** POST /nsfw/generate-advanced
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/generate-prompt`

- **operationId:** `post_nsfw_generate-prompt`
- **summary:** POST /nsfw/generate-prompt
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/generate-training-images`

- **operationId:** `post_nsfw_generate-training-images`
- **summary:** POST /nsfw/generate-training-images
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/generate-video`

- **operationId:** `post_nsfw_generate-video`
- **summary:** POST /nsfw/generate-video
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/initialize-training`

- **operationId:** `post_nsfw_initialize-training`
- **summary:** POST /nsfw/initialize-training
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/nsfw/lora/{loraId}`

- **operationId:** `delete_nsfw_lora_loraId`
- **summary:** DELETE /nsfw/lora/{loraId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PUT `/nsfw/lora/{loraId}/appearance`

- **operationId:** `put_nsfw_lora_loraId_appearance`
- **summary:** PUT /nsfw/lora/{loraId}/appearance
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/lora/{loraId}/auto-appearance`

- **operationId:** `post_nsfw_lora_loraId_auto-appearance`
- **summary:** POST /nsfw/lora/{loraId}/auto-appearance
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/lora/create`

- **operationId:** `post_nsfw_lora_create`
- **summary:** POST /nsfw/lora/create
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/lora/set-active`

- **operationId:** `post_nsfw_lora_set-active`
- **summary:** POST /nsfw/lora/set-active
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/loras/{modelId}`

- **operationId:** `get_nsfw_loras_modelId`
- **summary:** GET /nsfw/loras/{modelId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/nudes-pack`

- **operationId:** `post_nsfw_nudes-pack`
- **summary:** POST /nsfw/nudes-pack
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/nudes-pack-poses`

- **operationId:** `get_nsfw_nudes-pack-poses`
- **summary:** GET /nsfw/nudes-pack-poses
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/plan-generation`

- **operationId:** `post_nsfw_plan-generation`
- **summary:** POST /nsfw/plan-generation
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/plan-generation/status/{jobId}`

- **operationId:** `get_nsfw_plan-generation_status_jobId`
- **summary:** GET /nsfw/plan-generation/status/{jobId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/regenerate-training-image`

- **operationId:** `post_nsfw_regenerate-training-image`
- **summary:** POST /nsfw/regenerate-training-image
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/register-training-images`

- **operationId:** `post_nsfw_register-training-images`
- **summary:** POST /nsfw/register-training-images
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/start-training-session`

- **operationId:** `post_nsfw_start-training-session`
- **summary:** POST /nsfw/start-training-session
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/test-face-ref`

- **operationId:** `post_nsfw_test-face-ref`
- **summary:** POST /nsfw/test-face-ref
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/test-face-ref-status/{requestId}`

- **operationId:** `get_nsfw_test-face-ref-status_requestId`
- **summary:** GET /nsfw/test-face-ref-status/{requestId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/train-lora`

- **operationId:** `post_nsfw_train-lora`
- **summary:** POST /nsfw/train-lora
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/training-images/{modelId}`

- **operationId:** `get_nsfw_training-images_modelId`
- **summary:** GET /nsfw/training-images/{modelId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/nsfw/training-status/{modelId}`

- **operationId:** `get_nsfw_training-status_modelId`
- **summary:** GET /nsfw/training-status/{modelId}
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/nsfw/upload-training-images`

- **operationId:** `post_nsfw_upload-training-images`
- **summary:** POST /nsfw/upload-training-images
- **tags:** `NSFW`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/onboarding/complete`

- **operationId:** `post_onboarding_complete`
- **summary:** POST /onboarding/complete
- **tags:** `Onboarding`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/onboarding/lock-offer`

- **operationId:** `post_onboarding_lock-offer`
- **summary:** POST /onboarding/lock-offer
- **tags:** `Onboarding`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/onboarding/trial-generate`

- **operationId:** `post_onboarding_trial-generate`
- **summary:** POST /onboarding/trial-generate
- **tags:** `Onboarding`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/onboarding/trial-upload`

- **operationId:** `post_onboarding_trial-upload`
- **summary:** POST /onboarding/trial-upload
- **tags:** `Onboarding`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/plans`

- **operationId:** `get_plans`
- **summary:** GET /plans
- **tags:** `Public`
- **security:** *(none declared)*

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/pricing/generation`

- **operationId:** `get_pricing_generation`
- **summary:** GET /pricing/generation
- **tags:** `Pricing`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/referrals/admin/overview`

- **operationId:** `get_referrals_admin_overview`
- **summary:** GET /referrals/admin/overview
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/admin/payout-requests/{id}/mark-paid`

- **operationId:** `post_referrals_admin_payout-requests_id_mark-paid`
- **summary:** POST /referrals/admin/payout-requests/{id}/mark-paid
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/referrals/admin/reconciliation`

- **operationId:** `get_referrals_admin_reconciliation`
- **summary:** GET /referrals/admin/reconciliation
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/admin/reconciliation/link`

- **operationId:** `post_referrals_admin_reconciliation_link`
- **summary:** POST /referrals/admin/reconciliation/link
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/admin/users/{userId}/add-bonus`

- **operationId:** `post_referrals_admin_users_userId_add-bonus`
- **summary:** POST /referrals/admin/users/{userId}/add-bonus
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/admin/users/{userId}/mark-paid`

- **operationId:** `post_referrals_admin_users_userId_mark-paid`
- **summary:** POST /referrals/admin/users/{userId}/mark-paid
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/admin/users/{userId}/set-advanced`

- **operationId:** `post_referrals_admin_users_userId_set-advanced`
- **summary:** POST /referrals/admin/users/{userId}/set-advanced
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/capture`

- **operationId:** `post_referrals_capture`
- **summary:** POST /referrals/capture
- **tags:** `Referrals`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/me/code`

- **operationId:** `post_referrals_me_code`
- **summary:** POST /referrals/me/code
- **tags:** `Referrals`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/referrals/me/overview`

- **operationId:** `get_referrals_me_overview`
- **summary:** GET /referrals/me/overview
- **tags:** `Referrals`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/referrals/me/request-payout`

- **operationId:** `post_referrals_me_request-payout`
- **summary:** POST /referrals/me/request-payout
- **tags:** `Referrals`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/referrals/resolve/{suffix}`

- **operationId:** `get_referrals_resolve_suffix`
- **summary:** GET /referrals/resolve/{suffix}
- **tags:** `Referrals`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/reformatter/convert`

- **operationId:** `post_reformatter_convert`
- **summary:** POST /reformatter/convert
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/reformatter/convert-background`

- **operationId:** `post_reformatter_convert-background`
- **summary:** POST /reformatter/convert-background
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/reformatter/convert-with-worker`

- **operationId:** `post_reformatter_convert-with-worker`
- **summary:** POST /reformatter/convert-with-worker
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/reformatter/history`

- **operationId:** `get_reformatter_history`
- **summary:** GET /reformatter/history
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/reformatter/prepare-browser`

- **operationId:** `post_reformatter_prepare-browser`
- **summary:** POST /reformatter/prepare-browser
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/reformatter/prepare-input`

- **operationId:** `post_reformatter_prepare-input`
- **summary:** POST /reformatter/prepare-input
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/reformatter/register-completed`

- **operationId:** `post_reformatter_register-completed`
- **summary:** POST /reformatter/register-completed
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/reformatter/status/{jobId}`

- **operationId:** `get_reformatter_status_jobId`
- **summary:** GET /reformatter/status/{jobId}
- **tags:** `Reformatter`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/support/chat/message`

- **operationId:** `post_support_chat_message`
- **summary:** POST /support/chat/message
- **tags:** `Support`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/support/chat/start`

- **operationId:** `post_support_chat_start`
- **summary:** POST /support/chat/start
- **tags:** `Support`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/test-replicate/generate`

- **operationId:** `post_test-replicate_generate`
- **summary:** POST /test-replicate/generate
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/test-replicate/upload`

- **operationId:** `post_test-replicate_upload`
- **summary:** POST /test-replicate/upload
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/tutorials/catalog`

- **operationId:** `get_tutorials_catalog`
- **summary:** GET /tutorials/catalog
- **tags:** `Public`
- **security:** *(none declared)*

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/upload`

- **operationId:** `post_upload`
- **summary:** POST /upload
- **tags:** `Upload`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/upload/blob`

- **operationId:** `post_upload_blob`
- **summary:** POST /upload/blob
- **tags:** `Upload`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/upload/config`

- **operationId:** `get_upload_config`
- **summary:** GET /upload/config
- **tags:** `Upload`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/upload/presign`

- **operationId:** `post_upload_presign`
- **summary:** POST /upload/presign
- **tags:** `Upload`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/upscale`

- **operationId:** `post_upscale`
- **summary:** POST /upscale
- **tags:** `Upscale`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/upscale/status/{generationId}`

- **operationId:** `get_upscale_status_generationId`
- **summary:** GET /upscale/status/{generationId}
- **tags:** `Upscale`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/compare`

- **operationId:** `post_video-repurpose_compare`
- **summary:** POST /video-repurpose/compare
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/compare-url`

- **operationId:** `post_video-repurpose_compare-url`
- **summary:** POST /video-repurpose/compare-url
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/complete-browser`

- **operationId:** `post_video-repurpose_complete-browser`
- **summary:** POST /video-repurpose/complete-browser
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/generate`

- **operationId:** `post_video-repurpose_generate`
- **summary:** POST /video-repurpose/generate
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/generate-with-worker`

- **operationId:** `post_video-repurpose_generate-with-worker`
- **summary:** POST /video-repurpose/generate-with-worker
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/video-repurpose/history`

- **operationId:** `get_video-repurpose_history`
- **summary:** GET /video-repurpose/history
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/video-repurpose/history/{jobId}`

- **operationId:** `delete_video-repurpose_history_jobId`
- **summary:** DELETE /video-repurpose/history/{jobId}
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/video-repurpose/jobs/{jobId}`

- **operationId:** `get_video-repurpose_jobs_jobId`
- **summary:** GET /video-repurpose/jobs/{jobId}
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/video-repurpose/jobs/{jobId}/download/{fileName}`

- **operationId:** `get_video-repurpose_jobs_jobId_download_fileName`
- **summary:** GET /video-repurpose/jobs/{jobId}/download/{fileName}
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/n8n-callback`

- **operationId:** `post_video-repurpose_n8n-callback`
- **summary:** POST /video-repurpose/n8n-callback
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/prepare-browser`

- **operationId:** `post_video-repurpose_prepare-browser`
- **summary:** POST /video-repurpose/prepare-browser
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/video-repurpose/worker-progress`

- **operationId:** `post_video-repurpose_worker-progress`
- **summary:** POST /video-repurpose/worker-progress
- **tags:** `Video repurposer`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/`

- **operationId:** `get_viral-reels_`
- **summary:** GET /viral-reels/
- **tags:** `Viral reels`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/{id}/download`

- **operationId:** `get_viral-reels_id_download`
- **summary:** GET /viral-reels/{id}/download
- **tags:** `Viral reels`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/{id}/stream`

- **operationId:** `get_viral-reels_id_stream`
- **summary:** GET /viral-reels/{id}/stream
- **tags:** `Viral reels`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/{id}/stream-token`

- **operationId:** `get_viral-reels_id_stream-token`
- **summary:** GET /viral-reels/{id}/stream-token
- **tags:** `Viral reels`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/assign-groups`

- **operationId:** `post_viral-reels_admin_assign-groups`
- **summary:** POST /viral-reels/admin/assign-groups
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/clear-reels`

- **operationId:** `post_viral-reels_admin_clear-reels`
- **summary:** POST /viral-reels/admin/clear-reels
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/admin/logs`

- **operationId:** `get_viral-reels_admin_logs`
- **summary:** GET /viral-reels/admin/logs
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/admin/profiles`

- **operationId:** `get_viral-reels_admin_profiles`
- **summary:** GET /viral-reels/admin/profiles
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/profiles`

- **operationId:** `post_viral-reels_admin_profiles`
- **summary:** POST /viral-reels/admin/profiles
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### PATCH `/viral-reels/admin/profiles/{id}`

- **operationId:** `patch_viral-reels_admin_profiles_id`
- **summary:** PATCH /viral-reels/admin/profiles/{id}
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### DELETE `/viral-reels/admin/profiles/{id}`

- **operationId:** `delete_viral-reels_admin_profiles_id`
- **summary:** DELETE /viral-reels/admin/profiles/{id}
- **tags:** `Admin`
- **security:** AdminSession

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/profiles/{id}/scrape`

- **operationId:** `post_viral-reels_admin_profiles_id_scrape`
- **summary:** POST /viral-reels/admin/profiles/{id}/scrape
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/profiles/bulk`

- **operationId:** `post_viral-reels_admin_profiles_bulk`
- **summary:** POST /viral-reels/admin/profiles/bulk
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/recalculate`

- **operationId:** `post_viral-reels_admin_recalculate`
- **summary:** POST /viral-reels/admin/recalculate
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/trigger-hot`

- **operationId:** `post_viral-reels_admin_trigger-hot`
- **summary:** POST /viral-reels/admin/trigger-hot
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/trigger-scrape`

- **operationId:** `post_viral-reels_admin_trigger-scrape`
- **summary:** POST /viral-reels/admin/trigger-scrape
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### POST `/viral-reels/admin/trigger-warm`

- **operationId:** `post_viral-reels_admin_trigger-warm`
- **summary:** POST /viral-reels/admin/trigger-warm
- **tags:** `Admin`
- **security:** AdminSession

**Request body**

- **application/json**: object


**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/cron-scrape`

- **operationId:** `get_viral-reels_cron-scrape`
- **summary:** GET /viral-reels/cron-scrape — Cron or deployment secret — not for customer API keys.
- **tags:** `Infrastructure`
- **security:** *(none declared)*

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/media`

- **operationId:** `get_viral-reels_media`
- **summary:** GET /viral-reels/media
- **tags:** `Viral reels`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/viral-reels/media-token`

- **operationId:** `get_viral-reels_media-token`
- **summary:** GET /viral-reels/media-token
- **tags:** `Viral reels`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/voices`

- **operationId:** `get_voices`
- **summary:** GET /voices
- **tags:** `Voices`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


#### GET `/voices/{voiceId}/preview`

- **operationId:** `get_voices_voiceId_preview`
- **summary:** GET /voices/{voiceId}/preview
- **tags:** `Voices`
- **security:** ModelCloneApiKey **or** ModelCloneBearer

**Responses**

| Code | Description |
|------|-------------|
| `200` | Success — JSON body shape varies by endpoint; see human-readable API reference. |
| `400` | Validation or bad input |
| `401` | Missing or invalid authentication |
| `403` | Banned account, CORS mismatch, insufficient tier, or ownership violation |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |


### OpenAPI `info` (embedded description)

## Who this is for

Integrators and Business customers automating the same actions a user performs in the ModelClone web app.

## Commercial access flow

1. **Contract & billing** — API access is sold **outside** this HTTP surface (invoice, order form, or your commercial agreement). Hosted card/crypto checkout under `/api/stripe` and `/api/crypto` is for the consumer web app, not the automation contract.
2. **Business subscription on the account** — The user record must carry **tier `business`** and subscription status **`active` or `trialing`** (set via your normal subscription pipeline or admin tools after payment).
3. **API key issuance** — A ModelClone admin creates an API key in the admin panel (or via `POST /api/admin/users/{userId}/api-keys` with an admin JWT). The plaintext secret is shown **once** (`mcl_…`).
4. **Automation** — Requests use `X-Api-Key: mcl_…` (or `Authorization: ApiKey mcl_…` / `Bearer mcl_…`). The server applies the **same credit limits, NSFW locks, and ownership rules** as the browser session for that user.

## Scope of this document

Machine-readable **inventory** of routes (method + path + auth class). Detailed request/field documentation lives in `docs/API_INTEGRATORS_REFERENCE.md`. Additional mounts on the same server (e.g. KIE/WaveSpeed **webhooks** under `/api/kie/callback`, `/api/wavespeed/callback`) are provider-facing, not customer API key flows.

## Servers

Use your deployment base URL. Paths below are relative to the `/api` prefix (e.g. `GET /health` → `https://YOUR_HOST/api/health`).

