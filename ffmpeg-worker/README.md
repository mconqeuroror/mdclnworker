# FFmpeg worker (Docker)

HTTP service that runs **video/image repurposer** jobs (`processVideoBatch` / `processImageBatch`) with system **FFmpeg** + **exiftool**.

**Standalone repo (minimal, Docker-only):** [`github.com/typekpaco2002/ffpmeg`](https://github.com/typekpaco2002/ffpmeg) — use that for Hetzner/Easypanel/Railway worker deploys.

## Build (from this monorepo root)

The `Dockerfile` expects the **full app repo root** (it copies `package.json` and `src/` used by `src/services/video-repurpose.service.js`).

```bash
docker build -f ffmpeg-worker/Dockerfile -t ffmpeg-worker .
```

## Run

```bash
docker run -d --name ffmpeg-worker -p 3100:3100 \
  -e PORT=3100 \
  -e FFMPEG_WORKER_API_KEY=your-shared-secret \
  ffmpeg-worker
```

- `GET /health` — FFmpeg/ffprobe check  
- `POST /job` — requires header `X-API-Key: <same as FFMPEG_WORKER_API_KEY>`
- **Vercel Blob mode (Content Studio, no R2):** send `vercelBlobOutput: true`, `outputBlobPrefix: "content-studio/…"` (must start with `content-studio/`), and set **`BLOB_READ_WRITE_TOKEN`** on the worker (same token as the app). Outputs upload via `@vercel/blob` `put()`.  
- Optional: `callbackUrl`, `callbackSecret`, `jobRef` on `/job` — worker POSTs the same JSON as the HTTP response when the job finishes (see `docs/FFMPEG_WORKER_CALLBACK.md`).

**Integration test (from dev machine):**

```bash
FFMPEG_WORKER_URL=https://your-worker.example.com FFMPEG_WORKER_API_KEY=secret node scripts/test-ffmpeg-worker.mjs
```

See `docs/DEPLOY_RAILWAY_HETZNER_FFMPEG.md` in this repo for Railway + Hetzner deployment.
