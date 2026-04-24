# ModelClone reel worker (Docker / EasyPanel)

HTTP service that runs the same Python `reelscraper` (Playwright + Chromium) as the main repo. Deploy this app on a **Docker** host (EasyPanel, VPS, etc.) and point the ModelClone API at it with `REEL_SCRAPER_WORKER_URL`.

## Build context

Use the **included `Dockerfile`** (Playwright base image + pinned `playwright` pip package). Do not deploy as a bare “Python app” with only `requirements-worker.txt` unless you also run `playwright install chromium` and install OS deps — the Dockerfile handles that.

From the folder that contains `Dockerfile`, `app/`, and `reelscraper/`:

```bash
docker build -t modelclone-reel-worker .
```

## Sync Python package from the monorepo

Before building or zipping, copy the latest `reelscraper` sources from the main repo:

```bash
node scripts/sync-easypanel-reel-worker.mjs
```

(Run from the ModelClone repository root.)

## Environment variables (container)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Listen port (default `8790`). EasyPanel often sets this. |
| `REEL_SCRAPER_WORKER_SECRET` | Recommended | Shared secret; main API sends `Authorization: Bearer <secret>`. If unset, **no auth** (only use on private network). |
| `INSTAGRAM_SESSIONID` | No | Instagram `sessionid` cookie — optional; omit for anonymous scraping. |
| `REEL_SCRAPER_SCROLL_ROUNDS` | No | Default `18` — more scroll passes when not logged in (range 3–40). |
| `REEL_SCRAPER_SCROLL_DELAY_MS` | No | e.g. `1200,2800` — min/max ms between scrolls (anonymous tuning). |
| `REEL_SCRAPER_INITIAL_WAIT_MS` | No | Default `3500` — wait after load before scrolling (ms). |
| `REEL_SCRAPER_SINGLE_REEL_WAIT_MS` | No | Default `4000` — wait on single-reel refresh (ms). |
| `REEL_SCRAPER_PROXY` | No | Single HTTP/SOCKS URL for Chromium (`http://user:pass@host:port`). If unset, `HTTPS_PROXY` / `HTTP_PROXY` are used. |
| `REEL_SCRAPER_PROXY_LIST` | No | Many URLs: newline-separated or `|||`‑separated. **One random URL per scrape** (rotation). Overrides `REEL_SCRAPER_PROXY` when non-empty. |
| `REEL_SCRAPER_PROXY_FILE` | No | Path to a file, **one proxy URL per line** (see `proxies.example.txt`). Highest priority when the file exists and has lines. |
| `REEL_SCRAPER_PROXY_BYPASS` | No | Comma-separated hosts to skip proxy (Playwright `bypass`); falls back to `NO_PROXY`. |
| `REEL_SCRAPER_DISABLE_PROXY` | No | Set to `1` to ignore `REEL_SCRAPER_PROXY` and system proxy env vars. |

## EasyPanel (high level)

1. Create an app from **Dockerfile** (upload this directory or connect Git and set **Dockerfile path** to `deploy/easypanel-reel-worker/Dockerfile` and build context to that folder).
2. **Publish port**: map host → container `PORT` (default 8790; EasyPanel often sets `PORT=80` inside the container).
3. Set **environment** as above; generate a long random `REEL_SCRAPER_WORKER_SECRET`.
4. **Health check**: HTTP GET `http://<container>:<PORT>/health` → `{"status":"ok",...}`.
5. After deploy, open **`GET /**` on the public URL. The JSON must list **`POST /v1/scrape/profile-form`**. If that route is missing (or you get **404** on `profile-form`), you are still on an **old image** — rebuild/redeploy with the latest `app/main.py` (version **1.1.0+** in `/` and `/health`).
6. On the ModelClone API server, set:
   - `REEL_SCRAPER_WORKER_URL=https://your-worker-host` (no trailing slash required)
   - `REEL_SCRAPER_WORKER_SECRET=<same as container>`
7. Do **not** install Python/Playwright on the API host if everything goes through this worker.

### Start command (important)

Use the image **default `CMD`** (inlined in the `Dockerfile` — no shell script file, so Windows CRLF cannot break `exec`).

Do **not** set a custom start command to bare `uvicorn` or `/usr/local/bin/uvicorn` — that binary often uses a different Python path and you get `ModuleNotFoundError: No module named 'playwright'` even after a successful build.

If your panel forces a command, use:

` python3 -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT} `

If you still see `exec /app/docker-entrypoint.sh: no such file`, the platform may be caching an old **entrypoint** — clear it (empty = use Dockerfile defaults) and rebuild.

## API

- `GET /health` — no auth
- `POST /v1/scrape/profile` — JSON body `{"username":"instagram","limit":27}` — returns JSON array of reel objects
- `POST /v1/scrape/reel` — JSON body `{"url":"https://www.instagram.com/reel/..."}` — returns JSON array (0 or 1 item)
- `POST /v1/scrape/profile-form` — `multipart/form-data` fields `username`, `limit` (optional, default 27). **Use this if Windows `curl` keeps mangling JSON.**
- `POST /v1/scrape/reel-form` — form field `url`

When `REEL_SCRAPER_WORKER_SECRET` is set on the worker, send header `Authorization: Bearer <secret>`.

### Windows: if you see `json_invalid` / `Expecting property name enclosed in double quotes`

PowerShell and `curl.exe` often break JSON bodies (encoding, quotes). Use one of these:

**A — Form POST (no JSON body):**

```powershell
curl.exe -sS -X POST "https://your-worker.example.com/v1/scrape/profile-form" `
  -H "Authorization: Bearer your-secret" `
  -F "username=instagram" `
  -F "limit=3"
```

**B — JSON from a file** (repo includes `example-profile.json`; use `--data-binary` with `@`):

```powershell
curl.exe -sS -X POST "https://your-worker.example.com/v1/scrape/profile" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer your-secret" `
  --data-binary "@example-profile.json"
```

(Run the command from the folder that contains `example-profile.json`, or pass a full path after `@`.)

### Test from Windows

`.\test-scrape-profile.ps1` (same folder) sends valid JSON via `Invoke-RestMethod` — prefer it over manual `curl`.

## Resource notes

- Scraping is CPU/memory heavy; give the container **at least 2 GB RAM** and avoid tiny shared-CPU plans if possible.
- Instagram may rate-limit; optional `INSTAGRAM_SESSIONID` helps.
