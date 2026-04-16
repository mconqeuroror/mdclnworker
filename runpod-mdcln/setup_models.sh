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
mkdir -p "${MODELS_DIR}/seedvr2"

echo ">>> Downloading all models (all from HuggingFace)..."

echo "  [1/6] Downloading VAE: ae.safetensors (335MB)..."
download_hf \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
    "${MODELS_DIR}/vae/ae.safetensors"

echo "  [2/6] Downloading CLIP: qwen_3_4b.safetensors (8GB)..."
download_hf \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
    "${MODELS_DIR}/clip/qwen_3_4b.safetensors"

echo "  [3/6] UNet: zImageTurboNSFW_20BF16AIO.safetensors (HuggingFace)..."
download_hf \
    "https://huggingface.co/bigckck/Z-Image_Turbo_NSFW_2.0bf16_aio/resolve/main/zImageTurboNSFW_20BF16AIO.safetensors" \
    "${MODELS_DIR}/unet/zImageTurboNSFW_20BF16AIO.safetensors"

echo "  [4/6] Downloading upscaler: 4xFaceUpDAT.pth..."
download_hf \
    "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
    "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" || \
  echo "  [WARN] Upscaler download failed during build — will be downloaded at container start via start.sh"

echo "  [5/6] Downloading SeedVR2 VAE: ema_vae_fp16.safetensors (~501MB)..."
download_hf \
    "https://huggingface.co/Osrivers/SEEDVR2/resolve/main/ema_vae_fp16.safetensors" \
    "${MODELS_DIR}/seedvr2/ema_vae_fp16.safetensors"

echo "  [6/6] Downloading SeedVR2 DiT: seedvr2_ema_7b_fp16.safetensors (~16.5GB)..."
if [ "${SKIP_SEEDVR2_MODELS:-0}" = "1" ]; then
    echo "  [SKIP] SKIP_SEEDVR2_MODELS=1 — skipping 16.5GB DiT model bake."
else
    download_hf \
        "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_7b_fp16.safetensors" \
        "${MODELS_DIR}/seedvr2/seedvr2_ema_7b_fp16.safetensors"
fi

echo ""
echo ">>> All models downloaded!"
