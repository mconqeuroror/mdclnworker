# ModelClone RunPod Serverless Worker - Build & Deploy

Repo: [mconqeuroror/mdclnworker](https://github.com/mconqeuroror/mdclnworker)

## Architecture
- **Docker image**: ComfyUI + custom nodes + Python deps + `handler.py`
- **NSFW generation only** — no JoyCaption, no SeedVR2, no describe/upscaler workflows
- **`patch_comfy_sdxl_pooled.py`** (runs at **image build**): Patches `comfy/model_base.py` so SDXL `encode_adm` does not crash when **Qwen CLIP** returns no pooled embedding (`clip_pooled` is `None`).
- **Network volume** (optional): mounted at `/runpod-volume` — models download here on first boot via `start.sh`
- **API**: Backend sends a full Comfy **API prompt** (`input.prompt` dict). Handler posts it to `http://127.0.0.1:8188/prompt` and reads **SaveImage node `289`** by default.

## Models (~32GB total, baked into image)

| File | Source | Size | Role |
|------|--------|------|------|
| `vae/ae.safetensors` | `Comfy-Org/z_image_turbo` | 335MB | VAELoader node `246` |
| `clip/qwen_3_4b.safetensors` | `Comfy-Org/z_image_turbo` | 8GB | CLIPLoader node `248` |
| `unet/zImageTurboNSFW_20BF16AIO.safetensors` | `bigckck/Z-Image_Turbo_NSFW_2.0bf16_aio` | ~23GB | UNETLoader node `247` |
| `upscale_models/4xFaceUpDAT.pth` | `Acly/Upscaler` | 148MB | UpscaleModelLoader (UltimateSDUpscale) |

User/pose LoRAs are loaded **by URL** via `LoadLoraFromUrlOrPath` (no bake needed).

## Custom nodes (NSFW workflows)

| Need | Package (`custom_nodes.list`) |
|------|-------------------------------|
| `LoadLoraFromUrlOrPath` | `bollerdominik/ComfyUI-load-lora-from-url` |
| `CR Apply LoRA Stack`, `CR SDXL Aspect Ratio` | `Suzie1/ComfyUI_Comfyroll_CustomNodes` |
| `Anything Everywhere` (refiner MODEL/CLIP/VAE broadcast) | `chrisgoringe/cg-use-everywhere` |
| `Seed (rgthree)` | `rgthree/rgthree-comfy` |
| `String Literal` | `alexopus/ComfyUI-Image-Saver` |
| `Image Film Grain` | `WASasquatch/was-node-suite-comfyui` |
| `ETN_ApplyMaskToImage` (img2img) | `Acly/comfyui-tooling-nodes` |
| `UltimateSDUpscale` | `ssitu/ComfyUI_UltimateSDUpscale` |
| Core samplers / loaders | ComfyUI built-in |

## Quick deploy

### 1. Build & push image
```bash
docker build -t yourdockerhub/modelclone-worker:latest .
docker push yourdockerhub/modelclone-worker:latest
```

### 2. RunPod serverless endpoint
- Image: your pushed image
- **Network volume** at `/runpod-volume` (optional — models baked in)
- GPU: 4090 / A100 class (~20GB+ VRAM)
- No API keys needed — all models are on HuggingFace

## File overview

| File | Purpose |
|------|---------|
| `Dockerfile` | ComfyUI + nodes + deps |
| `start.sh` | Models, symlinks, ComfyUI, handler |
| `handler.py` | RunPod handler (`input.prompt`, optional `upload_images`) |
| `custom_nodes.list` | GitHub repos for custom nodes |
| `setup_custom_nodes.sh` | Clone list during image build |
| `setup_models.sh` | Bake models at build time (all from HuggingFace) |
| `workflow_api.json` | Reference workflow (keep UNET filename in sync) |

## Troubleshooting

1. **Missing UNet** — Check logs for `[!!] FAILED to download` — the HuggingFace source may be temporarily unavailable.
2. **Unknown node type** — Call handler with `{"input": {"debug_nodes": true}}` and compare to workflow `class_type` values.
3. **Refiner disconnected** — Backend must apply `ue_links` (modelclone `comfyUiGraphToApiPrompt`) so checkpoint `MODEL`/`CLIP`/`VAE` reach nodes `45`, `8`, `21`, `28`, `42`.
4. **Outdated docs** — Filename must be `zImageTurboNSFW_20BF16AIO.safetensors`.
