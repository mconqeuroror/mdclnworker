# ModelClone RunPod Serverless Worker - Build & Deploy

Repo: [mconqeuroror/mdclnworker](https://github.com/mconqeuroror/mdclnworker)

## Architecture
- **Docker image**: ComfyUI + custom nodes + Python deps + `handler.py`
- **NSFW generation only** — no JoyCaption, no SeedVR2, no describe/upscaler workflows
- **`patch_comfy_sdxl_pooled.py`** (runs at **image build**): Patches `comfy/model_base.py` so SDXL `encode_adm` does not crash when **Qwen CLIP** returns no pooled embedding (`clip_pooled` is `None`).
- **Network volume** (recommended): mounted at `/runpod-volume` — VAE/CLIP/upscaler download on first boot; **NSFW UNet** `zImageTurboNSFW_62BF16.safetensors` must exist on the volume (no default public mirror in `start.sh`).
- **API**: Backend sends a full Comfy **API prompt** (`input.prompt` dict). Handler posts it to `http://127.0.0.1:8188/prompt` and reads **SaveImage node `289`** by default.

## Models (VAE/CLIP/upscaler baked; NSFW UNet supplied on volume)

| File | Source | Size | Role |
|------|--------|------|------|
| `vae/ae.safetensors` | `Comfy-Org/z_image_turbo` | 335MB | VAE for NSFW + Z-Image workflows |
| `text_encoders/qwen_3_4b.safetensors` (+ symlink in `clip/`) | `Comfy-Org/z_image_turbo` | 8GB | Qwen text encoder / CLIPLoader compatibility |
| `diffusion_models/z_image_turbo_bf16.safetensors` | `Comfy-Org/z_image_turbo` | ~12.3GB | Z-Image Turbo diffusion model |
| `checkpoints/z_image_turbo_bf16.safetensors` (symlink) | local symlink to `diffusion_models/z_image_turbo_bf16.safetensors` | ~12.3GB | Classic checkpoint loader compatibility |
| `model_patches/Z-Image-Turbo-Fun-Controlnet-Union.safetensors` | `alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union` | ~3.1GB | ControlNet patch for Z-Image Turbo |
| `depthanything/da3_base.safetensors` | `depth-anything/DA3-BASE` | ~1.1GB | DepthAnythingV3 cache (optional prefetch) |
| `unet/zImageTurboNSFW_62BF16.safetensors` | Place on network volume / S3 (same basename in `checkpoints/`) | ~12–23GB | UNETLoader `247` + CheckpointLoaderSimple `304` |
| `upscale_models/4xFaceUpDAT.pth` | `Acly/Upscaler` | 148MB | UpscaleModelLoader (UltimateSDUpscale) |

User/pose LoRAs are loaded **by URL** via `LoadLoraFromUrlOrPath` (no bake needed).

## Custom nodes (NSFW workflows)

| Need | Package (`custom_nodes.list`) |
|------|-------------------------------|
| `LoadLoraFromUrlOrPath` | `bollerdominik/ComfyUI-load-lora-from-url` |
| `LoadLoraFromUrlOrPath` (alt implementation) | `a-und-b/ComfyUI_LoRA_from_URL` |
| `CR Apply LoRA Stack`, `CR SDXL Aspect Ratio` | `Suzie1/ComfyUI_Comfyroll_CustomNodes` |
| `Anything Everywhere` (refiner MODEL/CLIP/VAE broadcast) | `chrisgoringe/cg-use-everywhere` |
| `Seed (rgthree)` | `rgthree/rgthree-comfy` |
| `String Literal` | `alexopus/ComfyUI-Image-Saver` |
| `String Literal` / saver helpers (alt) | `giriss/comfy-image-saver` |
| `Image Film Grain` | `WASasquatch/was-node-suite-comfyui` |
| `ETN_ApplyMaskToImage` (img2img) | `Acly/comfyui-tooling-nodes` |
| `UltimateSDUpscale` | `ssitu/ComfyUI_UltimateSDUpscale` |
| `DepthAnythingV3` nodes | `PozzettiAndrea/ComfyUI-DepthAnythingV3` |
| `easy loraStackApply` helpers | `yolain/ComfyUI-Easy-Use` |
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
- NSFW base UNet is expected on the network volume (see table)

## File overview

| File | Purpose |
|------|---------|
| `Dockerfile` | ComfyUI + nodes + deps |
| `start.sh` | Models, symlinks, ComfyUI, handler |
| `handler.py` | RunPod handler (`input.prompt`, optional `upload_images`) |
| `custom_nodes.list` | GitHub repos for custom nodes |
| `setup_custom_nodes.sh` | Clone list during image build |
| `setup_models.sh` | Bake VAE/CLIP/upscaler; UNet must be copied separately |
| `workflow_api.json` | Reference workflow (keep UNET filename in sync) |
| `workflows/mcx_i2i.json` | Z-Image Turbo i2i **UI** workflow (reference). Some nodes were saved with Comfy **0.17.x** metadata; the image may pin an older Comfy — if Comfy reports unknown nodes (e.g. `ImageScaleToTotalPixels`, `QwenImageDiffsynthControlnet`), bump the ComfyUI tag in `Dockerfile` to match. |

## Troubleshooting

1. **Missing UNet** — Ensure `models/unet/zImageTurboNSFW_62BF16.safetensors` exists on the volume (S3 sync or upload). `start.sh` symlinks it to `checkpoints/`.
2. **Unknown node type** — Call handler with `{"input": {"debug_nodes": true}}` and compare to workflow `class_type` values.
3. **Refiner disconnected** — Backend must apply `ue_links` (modelclone `comfyUiGraphToApiPrompt`) so checkpoint `MODEL`/`CLIP`/`VAE` reach nodes `45`, `8`, `21`, `28`, `42`.
4. **Filename drift** — Backend + workflows use `zImageTurboNSFW_62BF16.safetensors` (`src/config/nsfwZImageModel.js`).
