#!/bin/bash
set -e

MODELS_DIR="/workspace/ComfyUI/models"

export HF_HUB_ENABLE_HF_TRANSFER=1

download_hf() {
    local url="$1"
    local dest="$2"
    local name="$(basename "$dest")"

    mkdir -p "$(dirname "$dest")"
    echo "  [DL] Downloading: $name ..."
    if wget -q --show-progress -O "${dest}.tmp" "$url" 2>&1; then
        mv "${dest}.tmp" "$dest"
        echo "  [OK] Downloaded: $name ($(du -h "$dest" | cut -f1))"
    else
        echo "  [!!] FAILED to download: $name"
        rm -f "${dest}.tmp"
        return 1
    fi
}

mkdir -p "${MODELS_DIR}/checkpoints"
mkdir -p "${MODELS_DIR}/clip"
mkdir -p "${MODELS_DIR}/text_encoders"
mkdir -p "${MODELS_DIR}/vae"
mkdir -p "${MODELS_DIR}/loras"
mkdir -p "${MODELS_DIR}/unet"
mkdir -p "${MODELS_DIR}/diffusion_models"
mkdir -p "${MODELS_DIR}/model_patches"
mkdir -p "${MODELS_DIR}/depthanything"
mkdir -p "${MODELS_DIR}/upscale_models"

echo ">>> Downloading NSFW generation models (all from HuggingFace)..."

echo "  [1/4] Downloading VAE: ae.safetensors (335MB)..."
download_hf \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
    "${MODELS_DIR}/vae/ae.safetensors"

echo "  [2/4] Downloading CLIP: qwen_3_4b.safetensors (8GB)..."
download_hf \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
    "${MODELS_DIR}/text_encoders/qwen_3_4b.safetensors"
ln -sfn "${MODELS_DIR}/text_encoders/qwen_3_4b.safetensors" "${MODELS_DIR}/clip/qwen_3_4b.safetensors"

echo "  [3/6] Downloading diffusion model: z_image_turbo_bf16.safetensors (~12.3GB)..."
download_hf \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors" \
    "${MODELS_DIR}/diffusion_models/z_image_turbo_bf16.safetensors"
# Also expose as a classic checkpoint for CheckpointLoaderSimple workflows.
ln -sfn "${MODELS_DIR}/diffusion_models/z_image_turbo_bf16.safetensors" "${MODELS_DIR}/checkpoints/z_image_turbo_bf16.safetensors"

echo "  [4/6] Downloading model patch: Z-Image-Turbo-Fun-Controlnet-Union (~3.1GB)..."
download_hf \
    "https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union/resolve/main/Z-Image-Turbo-Fun-Controlnet-Union.safetensors" \
    "${MODELS_DIR}/model_patches/Z-Image-Turbo-Fun-Controlnet-Union.safetensors"

echo "  [5/6] UNet: zImageTurboNSFW_62BF16.safetensors — not on public HF under this name."
echo "        Copy to ${MODELS_DIR}/unet/ from your RunPod network volume (S3) or supply the file before build."

echo "  [6/6] Downloading upscaler: 4xFaceUpDAT.pth..."
download_hf \
    "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
    "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" || \
  echo "  [WARN] Upscaler download failed during build — will be downloaded at container start via start.sh"

echo "  [opt] Pre-caching DepthAnythingV3 model: da3_base.safetensors..."
TARGET_DEPTH_DIR="${MODELS_DIR}/depthanything" python3 - <<'PYEOF' || true
import os
from huggingface_hub import hf_hub_download

depth_dir = os.environ["TARGET_DEPTH_DIR"]
os.makedirs(depth_dir, exist_ok=True)
hf_hub_download(
    repo_id="depth-anything/DA3-BASE",
    filename="da3_base.safetensors",
    local_dir=depth_dir,
    local_dir_use_symlinks=False,
)
print("DepthAnythingV3 cache ready.")
PYEOF

echo ""
echo ">>> All models downloaded!"
