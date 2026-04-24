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
