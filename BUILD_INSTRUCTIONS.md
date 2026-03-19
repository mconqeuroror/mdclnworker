# ModelClone RunPod Serverless Worker - Build & Deploy

Repo: [mconqeuroror/mdcln](https://github.com/mconqeuroror/mdcln)

## Architecture
- **Docker image**: ComfyUI + custom nodes + Python deps + `handler.py`
- **Network volume** (recommended): mounted at `/runpod-volume` — models download here on first boot via `start.sh`
- **API**: Backend sends a full Comfy **API prompt** (`input.prompt` dict). Handler posts it to `http://127.0.0.1:8188/prompt` and reads **SaveImage node `289`** by default.

## Workflow readiness (NSFW image gen)

The [modelclone](https://github.com/typekpaco2002/mdlcln) backend builds prompts from `attached_assets/nsfw_core_workflow.json` (graph + `extra.ue_links` for **Anything Everywhere**). This worker includes the required custom nodes:

| Need | Package (`custom_nodes.list`) |
|------|--------------------------------|
| `LoadLoraFromUrlOrPath` | `bollerdominik/ComfyUI-load-lora-from-url` |
| `CR Apply LoRA Stack`, `CR SDXL Aspect Ratio` | `Suzie1/ComfyUI_Comfyroll_CustomNodes` |
| `Anything Everywhere` (refiner MODEL/CLIP/VAE broadcast) | `chrisgoringe/cg-use-everywhere` |
| `Seed (rgthree)` | `rgthree/rgthree-comfy` |
| `String Literal` (optional in raw graph; backend strips/injects text) | `alexopus/ComfyUI-Image-Saver` |
| `Image Film Grain` | `WASasquatch/was-node-suite-comfyui` |
| Core samplers / loaders | ComfyUI built-in |

**Not required on the worker** for the backend-built prompt: Crystools (graph primitives are stripped server-side).

## Required RunPod environment

- **`CIVITAI_API_KEY`** — **required** for downloading the Z-Image Turbo NSFW UNet on first boot (`zImageTurboNSFW_43BF16AIO.safetensors`). Without it, the UNet step in `start.sh` fails and image generation will break.
- **Network volume** (~200GB recommended) — attach at `/runpod-volume` so VAE/CLIP/UNet/checkpoint persist.

## Models (must match workflow filenames)

`start.sh` downloads to `/runpod-volume/models/...` (or `ComfyUI/models` if no volume):

| File | Role |
|------|------|
| `vae/ae.safetensors` | VAELoader node `246` |
| `clip/qwen_3_4b.safetensors` | CLIPLoader node `248` |
| `unet/zImageTurboNSFW_43BF16AIO.safetensors` | UNETLoader node `247` (CivitAI) |
| `checkpoints/pornworksRealPorn_Illustrious_v4_04.safetensors` | CheckpointLoaderSimple refiner path |

User/pose LoRAs are loaded **by URL** via `LoadLoraFromUrlOrPath` (no bake needed).

`workflow_api.json` in this repo is a **reference UI export**; the live app sends API prompts built from the modelclone template. **UNET name in that JSON must stay aligned** with `start.sh` (`43BF16AIO`).

## Quick deploy

### 1. Build & push image
```bash
docker build -t yourdockerhub/modelclone-worker:latest .
docker push yourdockerhub/modelclone-worker:latest
```

### 2. RunPod serverless endpoint
- Image: your pushed image  
- **Env**: `CIVITAI_API_KEY`  
- **Network volume** at `/runpod-volume`  
- GPU: 4090 / A100 class (~20GB+ VRAM)  

### 3. Optional: bake models into image
Uncomment in `Dockerfile`:
```dockerfile
ARG CIVITAI_API_KEY
ENV CIVITAI_API_KEY=$CIVITAI_API_KEY
RUN /workspace/setup_models.sh
```
Build with: `docker build --build-arg CIVITAI_API_KEY=... .`

## File overview

| File | Purpose |
|------|---------|
| `Dockerfile` | ComfyUI + nodes + deps |
| `start.sh` | Models, symlinks, ComfyUI, handler |
| `handler.py` | RunPod handler (`input.prompt`, optional `upload_images`) |
| `custom_nodes.list` | GitHub repos for custom nodes |
| `setup_custom_nodes.sh` | Clone list during image build |
| `setup_models.sh` | Optional bake (HF + CivitAI UNet if `CIVITAI_API_KEY` set) |
| `workflow_api.json` | Reference workflow (keep UNET filename in sync) |

## Troubleshooting

1. **Missing UNet** — Set `CIVITAI_API_KEY`; check logs for `[!!] FAILED to download from CivitAI`.  
2. **Unknown node type** — Call handler with `{"input": {"debug_nodes": true}}` and compare to workflow `class_type` values.  
3. **Refiner disconnected** — Backend must apply `ue_links` (modelclone `comfyUiGraphToApiPrompt`) so checkpoint `MODEL`/`CLIP`/`VAE` reach nodes `45`, `8`, `21`, `28`, `42`.  
4. **Outdated docs** — Do **not** use `z_image_turbo_bf16_nsfw_v2.safetensors` with the current workflow; filename must be `zImageTurboNSFW_43BF16AIO.safetensors`.
