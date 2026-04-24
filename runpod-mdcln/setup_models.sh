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
mkdir -p "${MODELS_DIR}/vae"
mkdir -p "${MODELS_DIR}/loras"
mkdir -p "${MODELS_DIR}/unet"
mkdir -p "${MODELS_DIR}/upscale_models"

echo ">>> Downloading NSFW generation models (all from HuggingFace)..."

echo "  [1/4] Downloading VAE: ae.safetensors (335MB)..."
download_hf \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
    "${MODELS_DIR}/vae/ae.safetensors"

echo "  [2/4] Downloading CLIP: qwen_3_4b.safetensors (8GB)..."
download_hf \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
    "${MODELS_DIR}/clip/qwen_3_4b.safetensors"

echo "  [3/4] UNet: zImageTurboNSFW_62BF16.safetensors — not on public HF under this name."
echo "        Copy to ${MODELS_DIR}/unet/ from your RunPod network volume (S3) or supply the file before build."

echo "  [4/4] Downloading upscaler: 4xFaceUpDAT.pth..."
download_hf \
    "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
    "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" || \
  echo "  [WARN] Upscaler download failed during build — will be downloaded at container start via start.sh"

echo ""
echo ">>> All models downloaded!"
