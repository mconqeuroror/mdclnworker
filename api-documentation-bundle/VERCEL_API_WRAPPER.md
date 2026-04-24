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
