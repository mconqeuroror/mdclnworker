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
