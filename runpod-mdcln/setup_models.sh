#!/bin/bash
set -e

MODELS_DIR="/workspace/ComfyUI/models"
UPSCALE_GDRIVE_FILE_ID="1d3wPbtjFcgCkWAMVFQalOuQHdiNmfc5i"
UPSCALE_HF_URL="https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth"
MIN_UPSCALE_FILE_BYTES=5242880

download_4x_face_up_dat() {
    local dest="$1"
    local id="${UPSCALE_GDRIVE_FILE_ID}"
    local tmp="${dest}.tmp"
    local cook="/tmp/gdrive_ck_setup_$$.txt"
    local sz

    mkdir -p "$(dirname "$dest")"
    rm -f "$tmp" "$cook"

    echo "  [DL] Downloading: $(basename "$dest") (Google Drive) ..."
    local page confirm
    page=$(wget -q --save-cookies "$cook" --keep-session-cookies \
        "https://drive.google.com/uc?export=download&id=${id}" -O -) || true
    confirm=$(echo "$page" | sed -n 's/.*confirm=\([0-9A-Za-z_][0-9A-Za-z_]*\).*/\1/p' | head -1)
    if [ -z "$confirm" ]; then
        confirm="t"
    fi

    wget -q --show-progress --load-cookies "$cook" -O "$tmp" \
        "https://drive.google.com/uc?export=download&confirm=${confirm}&id=${id}" || true
    sz=$(stat -c%s "$tmp" 2>/dev/null || echo 0)
    rm -f "$cook"

    if [ "$sz" -lt "$MIN_UPSCALE_FILE_BYTES" ]; then
        rm -f "$tmp"
        echo "  [DL] Retry: direct confirm=1 ..."
        wget -q --show-progress -O "$tmp" \
            "https://drive.google.com/uc?export=download&confirm=1&id=${id}" || true
        sz=$(stat -c%s "$tmp" 2>/dev/null || echo 0)
    fi

    if [ "$sz" -ge "$MIN_UPSCALE_FILE_BYTES" ]; then
        mv "$tmp" "$dest"
        echo "  [OK] Downloaded: $(basename "$dest") ($(du -h "$dest" | cut -f1))"
        return 0
    fi

    rm -f "$tmp"
    echo "  [DL] Fallback: HuggingFace mirror ..."
    wget -q --show-progress --timeout=60 --tries=2 -O "$tmp" "$UPSCALE_HF_URL" || true
    sz=$(stat -c%s "$tmp" 2>/dev/null || echo 0)
    if [ "$sz" -ge "$MIN_UPSCALE_FILE_BYTES" ]; then
        mv "$tmp" "$dest"
        echo "  [OK] Downloaded: $(basename "$dest") ($(du -h "$dest" | cut -f1))"
        return 0
    fi
    rm -f "$tmp"
    return 1
}

mkdir -p "${MODELS_DIR}/checkpoints"
mkdir -p "${MODELS_DIR}/clip"
mkdir -p "${MODELS_DIR}/vae"
mkdir -p "${MODELS_DIR}/loras"
mkdir -p "${MODELS_DIR}/unet"
mkdir -p "${MODELS_DIR}/upscale_models"
mkdir -p "${MODELS_DIR}/seedvr2"

echo ">>> Downloading all models..."

echo "  [1/6] Downloading VAE: ae.safetensors (335MB)..."
wget -q --show-progress -O "${MODELS_DIR}/vae/ae.safetensors" \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors"

echo "  [2/6] Downloading CLIP: qwen_3_4b.safetensors (8GB)..."
wget -q --show-progress -O "${MODELS_DIR}/clip/qwen_3_4b.safetensors" \
    "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"

# Must match UNETLoader in workflow (same file as start.sh + modelclone attached_assets).
echo "  [3/6] UNet: zImageTurboNSFW_43BF16AIO.safetensors (CivitAI)..."
if [ -z "${CIVITAI_API_KEY}" ]; then
    echo "  [!!] CIVITAI_API_KEY is not set — skipping UNet bake."
    echo "      Use network volume + start.sh at runtime, or: docker build --build-arg CIVITAI_API_KEY=..."
else
    CIVITAI_URL="https://civitai.com/api/download/models/2682644?type=Model&format=SafeTensor&size=pruned&fp=fp16&token=${CIVITAI_API_KEY}"
    wget -q --show-progress --content-disposition -O "${MODELS_DIR}/unet/zImageTurboNSFW_43BF16AIO.safetensors" \
        "${CIVITAI_URL}"
fi

echo "  [4/6] Downloading upscaler: 4xFaceUpDAT.pth (Google Drive, fallback HF)..."
mkdir -p "${MODELS_DIR}/upscale_models"
# Non-fatal: start.sh will re-download at runtime if this fails (network/SSL issues in build env)
download_4x_face_up_dat "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" || \
  echo "  [WARN] Upscaler download failed during build — will be downloaded at container start via start.sh"

echo "  [5/6] Downloading SeedVR2 VAE: ema_vae_fp16.safetensors (~501MB)..."
wget -q --show-progress -O "${MODELS_DIR}/seedvr2/ema_vae_fp16.safetensors" \
    "https://huggingface.co/Osrivers/SEEDVR2/resolve/main/ema_vae_fp16.safetensors"

echo "  [6/6] Downloading SeedVR2 DiT: seedvr2_ema_7b_fp16.safetensors (~16.5GB)..."
if [ "${SKIP_SEEDVR2_MODELS:-0}" = "1" ]; then
    echo "  [SKIP] SKIP_SEEDVR2_MODELS=1 — skipping 16.5GB DiT model bake."
else
    wget -q --show-progress -O "${MODELS_DIR}/seedvr2/seedvr2_ema_7b_fp16.safetensors" \
        "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_7b_fp16.safetensors"
fi

echo ""
echo ">>> All models downloaded!"
