# ModelClone — API dokumentácia (samostatný balík)

Tento priečinok je **kompletná publikovateľná dokumentácia** HTTP API: payloady, chyby, úložisko, OpenAPI, návod na deploy a beta program.

## Obsah

| Súbor | Účel |
|--------|------|
| **[API.md](./API.md)** | Index dokumentácie |
| **[API_FULL_INTEGRATOR_SINGLE_FILE.md](./API_FULL_INTEGRATOR_SINGLE_FILE.md)** | **Jeden súbor — celý handoff** (index + návody + referencia + generovaný OpenAPI apendix); v monorepe: `npm run docs:api-full-integrator` |
| **[API_USERS.md](./API_USERS.md)** | Integrátori: auth, Business flow, CORS, polling, mapa endpointov |
| **[API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md)** | **Hlavný referenčný dokument** — request/response podľa režimov, chybové kódy, rozšírené API (img2img, repurposer, drafts, …) |
| **[openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json)** | OpenAPI 3.0 — všetky cesty `/api`, triedy zabezpečenia |
| **[ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md)** | Interné: ako vydávať a revokovať API kľúče (admin panel / admin JWT) |
| **[STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md)** | Vercel Blob vs R2, priečinky, KIE relay |
| **[VERCEL_API_WRAPPER.md](./VERCEL_API_WRAPPER.md)** | Druhý Vercel projekt, callbacky, NSFW/LoRA na satellite deployi |
| **[WRAPPER_VERCEL.md](./WRAPPER_VERCEL.md)** | README `modelclone-api/` — submodule, build, checklist |
| **[ENVIRONMENT.md](./ENVIRONMENT.md)** | Prehľad premenných prostredia pre backend |
| **[SETUP_MARTIN.md](./SETUP_MARTIN.md)** | **Návod pre teba** — ako všetko spojazdniť (monorepo + Vercel + kľúče) |
| **[BETA_TESTERS.md](./BETA_TESTERS.md)** | Text / checklist pre prvých beta testerov |
| **[SYNC_FROM_MONOREPO.md](./SYNC_FROM_MONOREPO.md)** | Ako obnoviť súbory z hlavného ModelClone repa |

## Nové git repozitár (odporúčaný postup)

Z koreňa **hlavného** ModelClone repozitára (kde už existuje `api-documentation-bundle/`):

```bash
# skopíruj priečinok inde alebo použi subtree; príklad: nový repozitár
mkdir ../modelclone-api-docs && cp -r api-documentation-bundle/. ../modelclone-api-docs/
cd ../modelclone-api-docs
git init
git add .
git commit -m "Initial ModelClone API documentation bundle"
# pridaj remote a push na GitHub / GitLab
```

Na Windows (PowerShell) môžeš použiť rovnakú logiku s `Copy-Item -Recurse`.

## Zdroj pravdy

- **Kód a generátor OpenAPI** sú v hlavnom monorepe ModelClone (`src/`, `scripts/generate-openapi.mjs`).
- Tento balík sa **neaktualizuje sám** — po zmenách API spusti postup v [SYNC_FROM_MONOREPO.md](./SYNC_FROM_MONOREPO.md).

## Licencia / zdieľanie

Obsah môžeš zdieľať s beta testermi alebo partnermi podľa vlastných obchodných podmienok; technické údaje (URL, kľúče) nikdy neukladaj do verejného repa.
