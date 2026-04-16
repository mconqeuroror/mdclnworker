#!/bin/bash
# NOTE: Do NOT use 'set -e' here. Several inline Python scripts call into
# native libraries (tokenizers Rust code, torch) that can segfault or panic,
# killing the Python process with a non-zero exit. With set -e that would
# abort the entire startup before the handler starts, crash-looping workers.
# Critical errors use explicit 'exit 1' instead.

echo "========================================="
echo "ModelClone ComfyUI Worker Starting..."
echo "========================================="

COMFYUI_DIR="/workspace/ComfyUI"
MODELS_DIR="${COMFYUI_DIR}/models"
VOLUME_DIR="/runpod-volume"
VOLUME_MODELS="${VOLUME_DIR}/models"

export HF_HUB_ENABLE_HF_TRANSFER=1

# Ensure critical Python deps are present (use python3 -m pip to match the Python that runs ComfyUI)
echo ">>> Ensuring runtime Python dependencies..."
python3 -m pip install --no-cache-dir \
    "huggingface-hub>=0.25.0" hf_transfer \
    sqlalchemy aiosqlite || echo "  [WARN] pip install failed — ComfyUI may crash if it needs sqlalchemy"

download_if_missing() {
    local url="$1"
    local dest="$2"
    local name="$(basename $dest)"

    if [ -f "$dest" ]; then
        local sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
        if [ "$sz" -gt 1000 ]; then
            echo "  [OK] Already exists: $name"
            return 0
        fi
        echo "  [FIX] Replacing corrupt/empty $(basename "$dest") (${sz} bytes)..."
        rm -f "$dest"
    fi

    echo "  [DL] Downloading: $name ..."
    mkdir -p "$(dirname $dest)"
    if wget -q --show-progress -O "${dest}.tmp" "$url" 2>&1; then
        mv "${dest}.tmp" "$dest"
        echo "  [OK] Downloaded: $name ($(du -h "$dest" | cut -f1))"
    else
        echo "  [!!] FAILED to download: $name (will retry on next boot)"
        rm -f "${dest}.tmp"
    fi
}

setup_models() {
    local target_dir="$1"

    mkdir -p "${target_dir}/checkpoints"
    mkdir -p "${target_dir}/clip"
    mkdir -p "${target_dir}/vae"
    mkdir -p "${target_dir}/loras"
    mkdir -p "${target_dir}/diffusion_models"
    mkdir -p "${target_dir}/unet"

    echo ""
    echo "--- [1/3] VAE: ae.safetensors (335MB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
        "${target_dir}/vae/ae.safetensors"

    echo ""
    echo "--- [2/3] CLIP: qwen_3_4b.safetensors (8GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
        "${target_dir}/clip/qwen_3_4b.safetensors"

    echo ""
    echo "--- [3/3] UNet: zImageTurboNSFW_20BF16AIO.safetensors (HuggingFace) ---"
    download_if_missing \
        "https://huggingface.co/bigckck/Z-Image_Turbo_NSFW_2.0bf16_aio/resolve/main/zImageTurboNSFW_20BF16AIO.safetensors" \
        "${target_dir}/unet/zImageTurboNSFW_20BF16AIO.safetensors"
    if [ ! -f "${target_dir}/unet/zImageTurboNSFW_20BF16AIO.safetensors" ]; then
        echo ""
        echo "  ╔══════════════════════════════════════════════════════════════╗"
        echo "  ║  FATAL: zImageTurboNSFW_20BF16AIO.safetensors NOT FOUND    ║"
        echo "  ║  NSFW / MCX / img2img workflows will ALL fail.             ║"
        echo "  ╚══════════════════════════════════════════════════════════════╝"
        echo ""
    fi
    # Remove old v4.3 model if present (migrated to v2.0 from self-hosted HF mirror)
    if [ -f "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors" ]; then
        echo "  [CLEANUP] Removing old v4.3 model..."
        rm -f "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors"
    fi

    # Symlink AIO model into checkpoints/ so CheckpointLoaderSimple workflows also find it
    if [ -f "${target_dir}/unet/zImageTurboNSFW_20BF16AIO.safetensors" ]; then
        ln -sf "${target_dir}/unet/zImageTurboNSFW_20BF16AIO.safetensors" \
               "${target_dir}/checkpoints/zImageTurboNSFW_20BF16AIO.safetensors"
        echo "  [OK] Symlinked AIO model into checkpoints/"
    fi

}

# -----------------------------------------------
# Set HuggingFace cache location
# -----------------------------------------------
if [ -d "$VOLUME_DIR" ]; then
    export HF_HOME="${VOLUME_DIR}/hf_cache"
    mkdir -p "${HF_HOME}"
    echo ">>> Network volume found at $VOLUME_DIR"
    echo ">>> HF_HOME set to ${HF_HOME}"
    echo ">>> Downloading ComfyUI models to network volume (skipping existing)..."
    setup_models "${VOLUME_MODELS}"

    echo ""
    echo ">>> Symlinking network volume models into ComfyUI..."
    for subdir in checkpoints clip loras vae unet diffusion_models; do
        mkdir -p "${VOLUME_MODELS}/${subdir}"
        rm -rf "${MODELS_DIR}/${subdir}"
        ln -sfn "${VOLUME_MODELS}/${subdir}" "${MODELS_DIR}/${subdir}"
        echo "  [OK] Linked: ${MODELS_DIR}/${subdir} -> ${VOLUME_MODELS}/${subdir}"
    done
    # Clean up old SeedVR2/JoyCaption dirs from previous builds
    rm -rf "${VOLUME_MODELS}/seedvr2" 2>/dev/null || true
    rm -rf "${MODELS_DIR}/seedvr2" "${MODELS_DIR}/SEEDVR2" 2>/dev/null || true
    rm -rf "${VOLUME_MODELS}/LLavacheckpoints" "${MODELS_DIR}/LLavacheckpoints" 2>/dev/null || true
else
    export HF_HOME="/root/.cache/huggingface"
    mkdir -p "${HF_HOME}"
    echo ">>> No network volume — downloading models directly into ComfyUI..."
    setup_models "${MODELS_DIR}"
fi

# -----------------------------------------------
# Self-heal: ensure required custom nodes are installed.
# This check runs at boot so even an old Docker image gets the right nodes.
# -----------------------------------------------
LORA_URL_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-load-lora-from-url"

echo ""
echo "--- Checking bollerdominik/ComfyUI-load-lora-from-url (LoadLoraFromUrlOrPath) ---"
if [ -d "${LORA_URL_DIR}" ]; then
    echo "  [OK] ComfyUI-load-lora-from-url already installed"
else
    echo "  [!!] ComfyUI-load-lora-from-url missing — installing..."
    git clone --depth 1 "https://github.com/bollerdominik/ComfyUI-load-lora-from-url.git" "${LORA_URL_DIR}"
    if [ -f "${LORA_URL_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${LORA_URL_DIR}/requirements.txt"
    fi
    echo "  [OK] ComfyUI-load-lora-from-url installed!"
fi

echo ""
echo "--- Checking glifxyz/ComfyUI-GlifNodes ---"
GLIFNODES_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-GlifNodes"
if [ -d "${GLIFNODES_DIR}" ]; then
    echo "  [OK] ComfyUI-GlifNodes already installed"
else
    echo "  [!!] ComfyUI-GlifNodes missing — installing..."
    git clone --depth 1 "https://github.com/glifxyz/ComfyUI-GlifNodes.git" "${GLIFNODES_DIR}"
    if [ -f "${GLIFNODES_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${GLIFNODES_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI-GlifNodes installed!"
fi
# Remove old node packages if they exist (superseded)
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI_LoRA_from_URL" 2>/dev/null || true
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI-EasyCivitai-XTNodes" 2>/dev/null || true

# Clean up old upscaler/SeedVR2/JoyCaption nodes from previous builds
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI_UltimateSDUpscale" 2>/dev/null || true
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler" 2>/dev/null || true
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI_LayerStyle_Advance" 2>/dev/null || true
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI-JoyCaption" 2>/dev/null || true

# Clean up leftover upscale models from previous builds
rm -rf "${MODELS_DIR}/upscale_models" 2>/dev/null || true

echo ""
echo ">>> Model files available (.safetensors):"
find ${MODELS_DIR} -name "*.safetensors" -type f -o -name "*.safetensors" -type l 2>/dev/null | while read f; do
    echo "  $(du -h "$f" 2>/dev/null | cut -f1)  $(basename $f)"
done

echo ""
echo ">>> Starting ComfyUI on port 8188..."
cd ${COMFYUI_DIR}
LISTEN_ADDR="${COMFYUI_LISTEN:-0.0.0.0}"
echo ">>> Binding ComfyUI to ${LISTEN_ADDR}:8188"

COMFYUI_LOG="/tmp/comfyui_output.log"
: > "${COMFYUI_LOG}"

python3 main.py \
    --listen ${LISTEN_ADDR} \
    --port 8188 \
    --disable-auto-launch \
    --disable-metadata \
    2>&1 | tee -a "${COMFYUI_LOG}" &

COMFYUI_PID=$!
echo ">>> ComfyUI PID: ${COMFYUI_PID}"

echo ">>> Waiting for ComfyUI to be ready..."
MAX_WAIT=300
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s http://127.0.0.1:8188/system_stats > /dev/null 2>&1; then
        echo ">>> ComfyUI is READY! (took ${WAITED}s)"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 20)) -eq 0 ]; then
        echo "  Still waiting... (${WAITED}s)"
    fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo ">>> ERROR: ComfyUI failed to start within ${MAX_WAIT}s"
    exit 1
fi

echo ">>> Validating required node types for NSFW workflows..."
python3 - <<'PYEOF'
import json
import urllib.request

required = {
    "LoadLoraFromUrlOrPath",
    "CR Apply LoRA Stack",
    "CR SDXL Aspect Ratio",
    "Seed (rgthree)",
    "UNETLoader",
    "CLIPLoader",
}

try:
    with urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
except Exception as e:
    print(f">>> WARN: failed to query ComfyUI object_info: {e}")
    print(">>> Continuing anyway — handler will validate per-job")
    exit(0)

missing = sorted([n for n in required if n not in data])
if missing:
    print(">>> WARN: some expected workflow nodes are missing (handler will report per-job):")
    for n in missing:
        print(f"    - {n}")
else:
    print(">>> All required node types validated OK")
PYEOF

echo ">>> Starting RunPod serverless handler..."
cd /workspace
python3 handler.py
