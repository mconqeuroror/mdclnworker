#!/bin/bash
set -e

MODELS_DIR="/workspace/ComfyUI/models"

mkdir -p "${MODELS_DIR}/checkpoints"
mkdir -p "${MODELS_DIR}/clip"
mkdir -p "${MODELS_DIR}/vae"
mkdir -p "${MODELS_DIR}/loras"
mkdir -p "${MODELS_DIR}/unet"
mkdir -p "${MODELS_DIR}/upscale_models"

echo ">>> Downloading all models..."

echo "  [1/4] Downloading VAE: ae.safetensors (335MB)..."
wget -q --show-progress -O "${MODELS_DIR}/vae/ae.safetensors" \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors"

echo "  [2/4] Downloading CLIP: qwen_3_4b.safetensors (8GB)..."
wget -q --show-progress -O "${MODELS_DIR}/clip/qwen_3_4b.safetensors" \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"

echo "  [3/4] Downloading UNet: zImageTurboNSFW_43BF16AIO.safetensors (12GB)..."
wget -q --show-progress -O "${MODELS_DIR}/unet/zImageTurboNSFW_43BF16AIO.safetensors" \
    "https://huggingface.co/tewea/z_image_turbo_bf16_nsfw/resolve/main/z_image_turbo_bf16_nsfw_v2.safetensors"

echo "  [4/4] Downloading upscaler: 4xFaceUpDAT.pth..."
wget -q --show-progress -O "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" \
    "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth"

echo ""
echo ">>> All models downloaded!"
