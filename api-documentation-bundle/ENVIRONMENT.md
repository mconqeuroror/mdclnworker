# Premenné prostredia — prehľad (backend)

Plný šablónový súbor s komentármi je v hlavnom ModelClone repozitári ako **`.env.example`**. Tu sú zoskupené najčastejšie hodnoty potrebné na prevádzku API a generácií.

## Povinné (produkcia)

| Premenná | Popis |
|----------|--------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Tajný kľúč pre JWT (min. 32 znakov v produkcii) |
| `NODE_ENV` | `production` |

## Verejné URL a callbacky

| Premenná | Popis |
|----------|--------|
| `CALLBACK_BASE_URL` | HTTPS základ pre odvodené webhook URL (KIE, WaveSpeed, …) |
| `FRONTEND_URL` / `CLIENT_URL` | Webová appka (CORS, redirecty) |
| `WEBHOOK_HMAC_KEY` | Overenie KIE callbackov (odporúčané) |
| `WAVESPEED_WEBHOOK_SECRET` | Voliteľné overenie WaveSpeed webhooku |

## AI / generovanie (podľa toho, čo používaš)

| Premenná | Popis |
|----------|--------|
| `KIE_API_KEY` | KIE.ai |
| `WAVESPEED_API_KEY` | WaveSpeed |
| `OPENROUTER_API_KEY` | Grok / LLM asistenti |
| `FAL_API_KEY` / `FAL_KEY` | fal.ai (LoRA, …) |
| `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`, … | NSFW / Comfy |
| `ELEVENLABS_API_KEY` | Hlasy |
| `HEYGEN_API_KEY` | Avatary |

## Úložisko

| Premenná | Popis |
|----------|--------|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (KIE relay, uploady) |
| `R2_*` | Cloudflare R2 (účty, kľúče, bucket, public URL) |

## Platby (iba webová appka)

`STRIPE_*`, `NOWPAYMENTS_*` — len na deployi, kde beží checkout. **Samostatný API deploy** (bez platieb): nastav **`REQUIRE_PAYMENT_SECRETS=false`**, inak v produkcii server očakáva aj tieto premenné (pozri `.env.example` v monorepe).

## Ďalšie

| Premenná | Popis |
|----------|--------|
| `CRON_SECRET` | Ochrana cron endpointov |
| `FFMPEG_WORKER_URL`, `FFMPEG_WORKER_API_KEY` | Externý worker (repurpose) |
| `REDIS_URL` / `UPSTASH_*` | Voliteľná cache / rate limit |
| `SENDGRID_*` | E-maily |

---

Pre presné názvy a defaulty pozri **`.env.example`** v monorepe.
