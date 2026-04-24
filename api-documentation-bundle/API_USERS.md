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
