# ModelClone API — samostatný Vercel projekt (git repo)

Tento priečinok je **koreň vlastného git repozitára**, ktorý napojíš na **druhý** Vercel projekt. Backend je **rovnaký** ako v hlavnom monorepe — ťahá sa cez git submodule **`core/`** (celý ModelClone / `rest-express` repo).

## Čo je v tomto repozitári

| Súbor / priečinok | Účel |
|-------------------|------|
| `api/index.js` | Vercel serverless vstup → `core/src/server.js` |
| `vercel.json` | Build, crons, rewrites, `outputDirectory` do `core/dist/public` |
| `scripts/vercel-install.sh` | Submodule + `npm install` v `core/` (voliteľný PAT pre private repo) |
| `core/` | **Submodule** — necommituješ obsah, len referenciu v gite |

Funkčne máš **všetko** čo hlavný backend: `/api/*`, repurposer, reformatter, webhooky, admin, poller, atď. Rovnaká **`DATABASE_URL`**, iné **provider API kľúče** v Environment Variables na tomto Vercel projekte.

## Jednorazový setup (nový GitHub repo)

1. Skopíruj **obsah** priečinka `modelclone-api/` do nového repa (alebo tento priečinok sprav ako root nového repa).
2. Pridaj submodule na hlavný kód:

   ```bash
   git submodule add https://github.com/TVOJ_ORG/modelclone.git core
   git submodule update --init --recursive
   git add .gitmodules core
   git commit -m "Add core submodule"
   ```

3. Pushni na GitHub a vytvor **Vercel projekt** z tohto repa.
4. V Vercel → Settings → Environment Variables skopíruj z hlavnej app všetko potrebné (`DATABASE_URL`, `JWT_SECRET`, …) a nastav **vlastné** KIE / fal / … kľúče podľa potreby.
5. Ak je **`core` private repo**, v Vercel pridaj napr. `GITHUB_SUBMODULE_TOKEN` (read-only PAT) — `scripts/vercel-install.sh` ho použije pri clone.

## Lokálny vývoj

```bash
git submodule update --init --recursive
cd core
npm install
npm run dev
```

## Je tam „všetko“?

Áno — ide o **ten istý** `src/server.js` a rovnaké routy ako pri hlavnom deployi. Rozdiel je len **iný hostname** na Verceli a **iné env** (kľúče providerov). HTTP API kľúče `mcl_…` fungujú rovnako, ak je rovnaká databáza.

**Dôležité:** Tento priečinok **neobsahuje duplikát backendu** — len `api/index.js` a Vercel konfig. Všetka logika (OpenAPI generátor, Business kontrola pri vytváraní API kľúča, routy) je v **`core/`** submodule. Po každom pushi zmien do hlavného monorepa musíš v **satellite** repozitári **aktualizovať pointer submodule** `core` na ten istý commit a pushnúť satellite repo, inak Vercel nasadí starý kód.

### Checklist: monorepo + samostatný Vercel (`modelclone-api`)

| Krok | Kde | Čo |
|------|-----|-----|
| 1 | Hlavný repo (live ModelClone) | Commitni a pushni zmeny (`docs/openapi/`, `scripts/generate-openapi.mjs`, `src/controllers/admin.controller.js` — Business + API kľúč, atď.). |
| 2 | Satellite repo (tento priečinok ako root) | `git submodule update --remote core` alebo v `core/` checkoutni nový commit z monorepa; v satellite: `git add core` + commit „Bump core submodule“ + push. |
| 3 | Vercel | Redeploy oboch projektov (alebo auto z GitHubu). Na API projekte musí byť rovnaká `DATABASE_URL` / `JWT_SECRET` ako očakávaš pre API kľúče. |

OpenAPI JSON a dokumentácia sú v submodule ceste **`core/docs/openapi/modelclone-api.openapi.json`**. Po aktualizácii `core` môžeš lokálne z koreňa satellite repa spustiť `npm run openapi:generate` (vyžaduje existujúci `core/`).

## Dokumentácia (komplet podľa témy)

| Čo | Kde (v tomto dokumentačnom balíku) |
|----|-----|
| **Tento wrapper** (submodule, build, Vercel, token) | Tento súbor (`WRAPPER_VERCEL.md`) |
| **NSFW, LoRA tréning, callbacky, Vercel limity** | [VERCEL_API_WRAPPER.md](./VERCEL_API_WRAPPER.md) |
| Admin a API kľúče | [ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md) |
| Integrátori / endpointy | [API_USERS.md](./API_USERS.md), [API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md), [openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json) |
| Úložisko / mirror (Blob, R2) | [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md) |
| Index API docs | [API.md](./API.md) |

> **Stručne:** Wrapper **neorezáva** NSFW ani tréning — je to stále `core/src/server.js`. Funguje to rovnako ako hlavný backend, ak máš na tomto Vercel projekte správne **`CALLBACK_BASE_URL`**, **fal/KIE kľúče** a **`DATABASE_URL`**. Podrobnosti a nástrahy (webhooky, 300s limit) sú v `VERCEL_API_WRAPPER.md`.

## Alternatíva bez samostatného git

Dva Vercel projekty môžu ukazovať na **jeden** GitHub repo (root monorepa) s rovnakým `vercel.json` v koreni — líšia sa len Environment Variables. Samostatný repo je voliteľný, ak ho chceš mať oddelene.

## Poznámka k hlavnému monorepu

Ak si submodule `core/` inicializuješ **vnútri** klonu monorepa (pre test), v koreni monorepa je v `.gitignore` položka `modelclone-api/core/`, aby sa ti omylom necommitoval duplicitný checkout.
