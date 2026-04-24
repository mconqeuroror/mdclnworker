# Obnovenie tohto balíka z hlavného ModelClone repozitára

Dokumentácia v `api-documentation-bundle/` je **kópia** súborov z monorepa. Po úpravách API spusti v **koreni monorepa** (nie v tomto priečinku):

## 1. Regenerovať OpenAPI

```bash
npm run openapi:generate
```

Výstup: `docs/openapi/modelclone-api.openapi.json`.

## 2. Skopírovať súbory do balíka

**Linux / macOS (z koreňa monorepa):**

```bash
cp docs/API.md docs/API_USERS.md docs/API_INTEGRATORS_REFERENCE.md \
   docs/ADMIN_PUBLIC_API.md docs/STORAGE_AND_MIRRORING.md docs/VERCEL_API_WRAPPER.md \
   docs/API_FULL_INTEGRATOR_SINGLE_FILE.md \
   api-documentation-bundle/
mkdir -p api-documentation-bundle/openapi
cp docs/openapi/modelclone-api.openapi.json api-documentation-bundle/openapi/
cp modelclone-api/README.md api-documentation-bundle/WRAPPER_VERCEL.md
```

**Windows PowerShell (z koreňa monorepa):**

```powershell
Copy-Item docs\API.md,docs\API_USERS.md,docs\API_INTEGRATORS_REFERENCE.md,docs\ADMIN_PUBLIC_API.md,docs\STORAGE_AND_MIRRORING.md,docs\VERCEL_API_WRAPPER.md,docs\API_FULL_INTEGRATOR_SINGLE_FILE.md -Destination api-documentation-bundle\
New-Item -ItemType Directory -Force -Path api-documentation-bundle\openapi | Out-Null
Copy-Item docs\openapi\modelclone-api.openapi.json api-documentation-bundle\openapi\
Copy-Item modelclone-api\README.md api-documentation-bundle\WRAPPER_VERCEL.md
```

## 3. Opraviť odkazy pre samostatný repozitár

Spusti (z koreňa monorepa):

```bash
node api-documentation-bundle/scripts/strip-monorepo-links.mjs
```

Potom **manuálne** skontroluj a doladi odkazy podľa poslednej verzie [README.md](./README.md) v balíku (tabuľky v `API.md`, `VERCEL_API_WRAPPER.md`, prvý odsek v `API_INTEGRATORS_REFERENCE.md` — pozri históriu commitov v monorepe).

Alternatíva: po `cp` spusti len úpravy z kroku 2 v tomto súbore historicky uložené v gite v `api-documentation-bundle/`.

## 4. Súbory výhradne v balíku (neprepisujú sa z docs/)

Tieto zostávajú len tu — upravuj ich podľa potreby:

- `README.md` (hub)
- `SETUP_MARTIN.md`
- `BETA_TESTERS.md`
- `ENVIRONMENT.md`
- `SYNC_FROM_MONOREPO.md`
- `scripts/strip-monorepo-links.mjs`
