# Návod: ako spojazdniť ModelClone API (pre prevádzku)

Krátky runbook pre **teba** (majiteľa / admina), nie pre integrátorov. Predpokladáš **Vercel** + **PostgreSQL** (napr. Neon) ako v produkcii.

---

## 1. Čo musí byť nasadené

| Komponent | Účel |
|-----------|------|
| **Backend** | Jeden alebo dva Vercel projekty so **rovnakým** `src/server.js` (monorepo root alebo satellite `modelclone-api` so submodule `core/`). |
| **Databáza** | Jedna `DATABASE_URL` — kredity, používatelia, API kľúče (`ApiKey` model). |
| **Frontend (voliteľné pre API)** | Samotné API nevyžaduje tvoj web, ale admin panel na vydávanie kľúčov beží typicky na `modelclone.app`. |

---

## 2. Minimálne premenné prostredia (backend)

Kompletný zoznam je v [ENVIRONMENT.md](./ENVIRONMENT.md). Pre funkčné generácie a webhooky musíš mať aspoň:

- `DATABASE_URL`, `JWT_SECRET`
- `CALLBACK_BASE_URL` = verejná **HTTPS** URL **toho** backendu, ktorý má prijímať KIE / WaveSpeed / fal callbacky (ak voláš API na inom hoste ako webhooky, pozri [VERCEL_API_WRAPPER.md](./VERCEL_API_WRAPPER.md))
- Kľúče providerov, ktoré používaš (KIE, WaveSpeed, OpenRouter, fal, RunPod, … podľa funkcií)
- Blob/R2 podľa [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md)

**Druhý Vercel projekt len na API (bez checkoutu):** `REQUIRE_PAYMENT_SECRETS=false` — Stripe/crypto rieši hlavná app, nie tento deploy.

Po každej zmene env na Verceli urob **Redeploy**.

---

## 3. Dva Vercel projekty (voliteľné)

- **Projekt A** — hlavná appka (frontend + API alebo len API).
- **Projekt B** — `modelclone-api` repo: ten istý kód cez `core/` submodule, **iný hostname**, môžeš mať **iné** KIE/fal kľúče (kvóty / náklady).

**Dôležité:** Ak máš dva hosty, rozhodni sa, kam smeruje **`CALLBACK_BASE_URL`** pre každý projekt — inak webhooky dokončia job na „zlom“ servery. Detaily: [WRAPPER_VERCEL.md](./WRAPPER_VERCEL.md).

---

## 4. API kľúče (`mcl_…`) — obchodný proces

1. Zákazník má mať v DB **`subscriptionTier: business`** a **`subscriptionStatus`: `active` alebo `trialing`** (po platbe mimo app alebo po úprave v admine).
2. V **admin paneli** otvor používateľa → **API** → vytvor kľúč (alebo cez admin JWT `POST /api/admin/users/:id/api-keys` — pozri [ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md)).
3. Ak tier/status nesedia, backend vráti **`403`** + `API_KEY_REQUIRES_BUSINESS_PLAN`.
4. Kľúč ulož bezpečne; v DB je len hash — druhý raz sa nezobrazí.

---

## 5. Overenie po deployi

```bash
curl -sS "https://TVOJ-HOST/api/health"
curl -sS -H "X-Api-Key: mcl_..." "https://TVOJ-HOST/api/auth/profile"
```

Očakávaj JSON; `401` znamená zlý alebo chýbajúci kľúč.

---

## 6. Beta testerom čo poslať

- Base URL API (napr. `https://api.tvoja-domena.app`).
- Odkaz na tento repozitár alebo export PDF / GitBook z týchto markdown súborov.
- Krátky text z [BETA_TESTERS.md](./BETA_TESTERS.md).

---

## 7. Aktualizácia dokumentácie po zmene kódu

V hlavnom monorepe:

```bash
npm run openapi:generate
# potom skopíruj aktualizované .md a openapi JSON do tohto balíka — pozri SYNC_FROM_MONOREPO.md
```

---

## 8. Časté problémy

| Symptóm | Čo skontrolovať |
|---------|------------------|
| `401 Invalid API key` | Revokovaný kľúč, preklep, zlý header (`X-Api-Key`). |
| `403` CORS | Pri kľúči s allowlistom musí sedieť `Origin` z prehliadača. |
| Generácia visí v `processing` | Webhook neprišiel — `CALLBACK_BASE_URL`, firewall, URL v providerovi. |
| `403` pri vytvorení kľúča | Používateľ nie je Business alebo nie je active/trialing. |

Podrobnejšie chyby a payloady: [API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md).
