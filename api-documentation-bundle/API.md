# ModelClone HTTP API — documentation index

All JSON routes are under the **`/api`** prefix unless noted. The **machine-readable contract** (paths, methods, auth classes) is **[docs/openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json)** — regenerate with `npm run openapi:generate` after route changes. Narrative payloads and errors remain in **`API_INTEGRATORS_REFERENCE.md`**. The canonical route list is assembled in **`src/routes/api.routes.js`**, **`src/server.js`**, and mounted route modules under **`src/routes/`**.

## For integrators (external developers)

| Document | Contents |
|----------|----------|
| **[API_FULL_INTEGRATOR_SINGLE_FILE.md](./API_FULL_INTEGRATOR_SINGLE_FILE.md)** | **All-in-one handoff:** index + user guide + admin keys + storage + Vercel wrapper + FFmpeg worker notes + full integrator reference + generated OpenAPI appendix. Regenerate: `npm run docs:api-full-integrator`. |
| **[API_INTEGRATORS_REFERENCE.md](./API_INTEGRATORS_REFERENCE.md)** | **Full reference:** user/product routes (generations, uploads, NSFW/LoRA, Creator Studio, …). **Excludes** Stripe/crypto checkout — not part of the programmatic API for wrappers. |
| **[openapi/modelclone-api.openapi.json](./openapi/modelclone-api.openapi.json)** | **OpenAPI 3.0** inventory: every `/api` route (method + path), security scheme per route (`X-Api-Key` vs admin JWT vs public). Regenerate: `npm run openapi:generate`. |
| [API_USERS.md](./API_USERS.md) | Short guide: base URL, **API key** auth (`mcl_…`), **Business-plan access flow**, CORS, rate limits, async polling, **media URLs & storage**, endpoint map. |
| [ADMIN_PUBLIC_API.md](./ADMIN_PUBLIC_API.md) | How admins create/revoke keys (internal). |

## For backend / DevOps

| Document | Contents |
|----------|----------|
| [STORAGE_AND_MIRRORING.md](./STORAGE_AND_MIRRORING.md) | **Vercel Blob vs R2**, folder prefixes (`kie-relay/`, `generations/`, …), KIE relay, remirror queue, env vars. |
| [VERCEL_API_WRAPPER.md](./VERCEL_API_WRAPPER.md) | Second Vercel project (`modelclone-api/`), callbacks, LoRA webhooks (Slovak). |
| [modelclone-api/README.md](./WRAPPER_VERCEL.md) | Submodule build, `GITHUB_SUBMODULE_TOKEN`, links to docs above. |

## Standalone documentation bundle (new repo)

The folder **`api-documentation-bundle/`** at the repository root contains the same API docs + OpenAPI + setup guides for publishing as a **separate git repository** (beta testers, partners). Start at **`api-documentation-bundle/README.md`**. Refresh copies after doc changes using **`api-documentation-bundle/SYNC_FROM_MONOREPO.md`**.

## Environment template

See **`.env.example`** at the repository root for variable names and comments.
