# ModelClone API — beta program (pre testerov)

Vitajte v uzavretej beta verzii HTTP API. Tento dokument stručne dopĺňa technickú špecifikáciu v tomto repozitári.

## Čo beta znamená

- API je **stabilné na úrovni účtu**: rovnaké kredity, limity a pravidlá ako pri používaní webovej aplikácie ModelClone.
- **Payloady a chyby** nie sú vždy 100 % jednotné medzi všetkými endpointmi — vždy kontrolujte HTTP status a telo odpovede (pozri hlavnú referenciu).
- **SLA a dostupnosť** v beta fáze nie sú garantované; ohláste výpadky cez dohodnutý kanál.

## Čo od vás očakávame

- Kľúč **`mcl_…`** nikde neukladajte do verejného kódu ani repozitára.
- Pri úniku kľúča okamžite kontaktujte nás — kľúč revokujeme a vydáme nový.
- Bugy a nejasnosti posielajte s **časom**, **endpointom**, **HTTP statusom** a **časťou odpovede** (bez citlivých údajov).

## Technické odkazy (v tomto balíku)

| Čo čítajte | Súbor |
|------------|--------|
| Ako posielať kľúč, CORS, polling generácií | [API_USERS.md](./API_USERS.md) |
| Podrobné payloady, chyby, rozšírené API | [API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md) |
| Strojovo čitateľný zoznam ciest | [openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json) |

**Base URL** a presný hostname dostanete od tímu ModelClone (nie je v tomto repozitári).

## Čo API zámerne neobsahuje

- **Platobné brány** (Stripe, crypto checkout) pre automatizáciu — predplatné a Business prístup riešte s ModelClone obchodne.
- **Admin rozhranie** — na vydávanie kľúčov potrebujete dohodu s ModelClone (nie je súčasťou verejného API pre integrátorov).

## Rýchly test

```http
GET /api/health
```

```http
GET /api/auth/profile
X-Api-Key: mcl_…
```

Ďakujeme za spätnú väzbu — pomáha nám doladiť verejnú verziu API.
