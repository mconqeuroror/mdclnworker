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
| `diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors` (+ symlink in `checkpoints/`) | Civitai `2682644` (auth required, env `CIVITAI_API_TOKEN`) | ~6GB | Optional smaller NSFW UNET — **not** used by `modelclonex_*_api.json` (those merge `unet/zImageTurboNSFW_62BF16.safetensors` + `z_image_turbo_bf16` so volume-only pods pass UNETLoader validation) |
| `checkpoints/pornworksRealPorn_Illustrious_v4_04.safetensors` | Civitai `2114370` (auth required, env `CIVITAI_API_TOKEN`) | ~6GB | Illustrious-base NSFW checkpoint (debug) |
| `ultralytics/bbox/face_yolov8m.pt` | `Bingsu/adetailer` (HF) | ~50MB | Impact / FaceDetailer bbox |
| `sams/sam_vit_b_01ec64.pth` | Meta Segment Anything | ~375MB | Impact SAMLoader (typical default) |

### Civitai downloads (optional)

The two files above are pulled at runtime by `start.sh` via `download_civitai`,
which uses `https://civitai.com/api/download/models/<id>` (the `civitai.red`
mirror returns 404 and was retired). Auth is sent as
`Authorization: Bearer ${CIVITAI_API_TOKEN}` — set this env var on the RunPod
endpoint/template (Civitai → Account → API Keys). If the token is missing the
worker logs `[SKIP]` for these files and continues to boot normally.

User/pose LoRAs are loaded **by URL** via `LoadLoraFromUrlOrPath` (no bake needed).

### Kie.ai (optional)

For workflows using **KIE_NanoBananaPro_Image**, set RunPod env **`KIE_API_KEY`**. `start.sh` writes `custom_nodes/ComfyUI-Kie-API/config/kie_key.txt` at boot.

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
| Core samplers / loaders / **ModelPatchLoader**, **QwenImageDiffsynthControlnet**, etc. | ComfyUI **v0.17.2** (pinned in `Dockerfile`) |
| `FaceDetailer`, `SAMLoader`, `UltralyticsDetectorProvider`, `ImpactImageInfo` | `ltdrdata/ComfyUI-Impact-Pack` + `ltdrdata/ComfyUI-Impact-Subpack` |
| `MaskPreview+`, essentials | `cubiq/ComfyUI_essentials` |
| `EveryPersonSegDetail` | `CoiiChan/comfyui-every-person-seg-coii` |
| `KIE_NanoBananaPro_Image` | `gateway/ComfyUI-Kie-API` (+ RunPod env **`KIE_API_KEY`** → `kie_key.txt`; Kie.ai credits) |

**First cold boot:** `ComfyUI-Crystools`, `ComfyUI-DepthAnythingV3`, `ComfyUI-Easy-Use`,
`was-node-suite-comfyui`, and `ComfyUI_UltimateSDUpscale` are **not** in the Docker
layer — `start.sh` clones them and runs `pip install -r requirements.txt` before
ComfyUI starts (shrinks build/export time; adds one-time startup latency on a fresh volume).

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
| `workflows/mcx_i2i.json` | Z-Image Turbo i2i **UI** workflow (reference). Requires Comfy **≥ v0.17.x** for nodes such as `ImageScaleToTotalPixels` / `QwenImageDiffsynthControlnet` (image pins **v0.17.2**). |

## Troubleshooting

1. **Missing UNet** — Ensure `models/unet/zImageTurboNSFW_62BF16.safetensors` exists on the volume (S3 sync or upload). `start.sh` symlinks it to `checkpoints/`.
2. **Unknown node type** — Call handler with `{"input": {"debug_nodes": true}}` and compare to workflow `class_type` values.
3. **Refiner disconnected** — Backend must apply `ue_links` (modelclone `comfyUiGraphToApiPrompt`) so checkpoint `MODEL`/`CLIP`/`VAE` reach nodes `45`, `8`, `21`, `28`, `42`.
4. **Filename drift** — Backend + workflows use `zImageTurboNSFW_62BF16.safetensors` (`src/config/nsfwZImageModel.js`).
