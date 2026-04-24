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
MIN_UPSCALE_FILE_BYTES=5242880

# Ensure critical Python deps are present (Docker build may target a different Python)
echo ">>> Ensuring runtime Python dependencies..."
pip install -q --no-cache-dir \
    "huggingface-hub>=0.25.0" hf_transfer \
    sqlalchemy aiosqlite 2>/dev/null || true

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
    echo "--- [1/4] VAE: ae.safetensors (335MB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
        "${target_dir}/vae/ae.safetensors"

    echo ""
    echo "--- [2/4] CLIP: qwen_3_4b.safetensors (8GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
        "${target_dir}/clip/qwen_3_4b.safetensors"

    echo ""
    echo "--- [3/4] UNet: zImageTurboNSFW_62BF16.safetensors (network volume / S3) ---"
    echo "  (No public HuggingFace auto-download for this file — place it under unet/ on the volume.)"
    if [ ! -f "${target_dir}/unet/zImageTurboNSFW_62BF16.safetensors" ]; then
        echo ""
        echo "  ╔══════════════════════════════════════════════════════════════╗"
        echo "  ║  FATAL: zImageTurboNSFW_62BF16.safetensors NOT FOUND       ║"
        echo "  ║  Upload to models/unet/ (RunPod volume or S3 sync).         ║"
        echo "  ║  NSFW txt2img / img2img / MCX will fail without it.         ║"
        echo "  ╚══════════════════════════════════════════════════════════════╝"
        echo ""
    fi
    # Remove old v4.3 model if present (migrated to v2.0 from self-hosted HF mirror)
    if [ -f "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors" ]; then
        echo "  [CLEANUP] Removing old v4.3 model..."
        rm -f "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors"
    fi

    # Symlink UNet into checkpoints/ so CheckpointLoaderSimple (refiner) finds the same file
    if [ -f "${target_dir}/unet/zImageTurboNSFW_62BF16.safetensors" ]; then
        ln -sf "${target_dir}/unet/zImageTurboNSFW_62BF16.safetensors" \
               "${target_dir}/checkpoints/zImageTurboNSFW_62BF16.safetensors"
        echo "  [OK] Symlinked UNet into checkpoints/"
    fi

    echo ""
    echo "--- [4/4] Upscaler: 4xFaceUpDAT.pth ---"
    mkdir -p "${target_dir}/upscale_models"
    download_if_missing \
        "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
        "${target_dir}/upscale_models/4xFaceUpDAT.pth"
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
    for subdir in checkpoints clip loras vae unet diffusion_models upscale_models; do
        mkdir -p "${VOLUME_MODELS}/${subdir}"
        rm -rf "${MODELS_DIR}/${subdir}"
        ln -sfn "${VOLUME_MODELS}/${subdir}" "${MODELS_DIR}/${subdir}"
        echo "  [OK] Linked: ${MODELS_DIR}/${subdir} -> ${VOLUME_MODELS}/${subdir}"
    done
    # Volume may have an empty upscale_models dir (failed prior download). Re-attempt into linked path.
    if [ ! -f "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" ]; then
        echo ">>> [RETRY] Upscale model missing after volume link — downloading 4xFaceUpDAT.pth..."
        mkdir -p "${MODELS_DIR}/upscale_models"
        download_if_missing \
            "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
            "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth"
    fi
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

if [ ! -f "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" ]; then
    echo ">>> [WARN] 4xFaceUpDAT.pth still missing — UltimateSDUpscale will fail until it downloads."
    echo ">>>         API server can set NSFW_COMFY_BYPASS_UPSCALE=1 to skip upscale in the workflow."
fi

# Corrupt / HTML error pages from failed wget are often tiny; real 4xFaceUpDAT.pth is tens of MB.
UPSCALE_PTH="${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth"
if [ -f "$UPSCALE_PTH" ]; then
    USZ=$(stat -c%s "$UPSCALE_PTH" 2>/dev/null || echo 0)
    if [ "$USZ" -lt "$MIN_UPSCALE_FILE_BYTES" ]; then
        echo ">>> [FIX] Upscale file too small (${USZ} bytes, min ${MIN_UPSCALE_FILE_BYTES}) — re-downloading..."
        rm -f "$UPSCALE_PTH"
        download_if_missing \
            "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
            "$UPSCALE_PTH"
    fi
fi

if [ "${REQUIRE_UPSCALE_MODEL:-0}" = "1" ] && [ ! -f "$UPSCALE_PTH" ]; then
    echo ">>> ERROR: REQUIRE_UPSCALE_MODEL=1 but 4xFaceUpDAT.pth is missing after downloads."
    exit 1
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

echo ""
echo "--- Checking ssitu/ComfyUI_UltimateSDUpscale (UltimateSDUpscale node) ---"
ULTIMATESD_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI_UltimateSDUpscale"
if [ -d "${ULTIMATESD_DIR}" ]; then
    echo "  [OK] ComfyUI_UltimateSDUpscale already installed"
else
    echo "  [!!] ComfyUI_UltimateSDUpscale missing — installing..."
    git clone --depth 1 "https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git" "${ULTIMATESD_DIR}"
    if [ -f "${ULTIMATESD_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${ULTIMATESD_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI_UltimateSDUpscale installed!"
fi

# Clean up old SeedVR2/JoyCaption nodes from previous builds
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler" 2>/dev/null || true
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI_LayerStyle_Advance" 2>/dev/null || true
rm -rf "${COMFYUI_DIR}/custom_nodes/ComfyUI-JoyCaption" 2>/dev/null || true

echo ""
echo ">>> Upscale models directory (UltimateSDUpscale / UpscaleModelLoader):"
ls -la "${MODELS_DIR}/upscale_models" 2>/dev/null || echo "  [!!] missing ${MODELS_DIR}/upscale_models"
if [ -L "${MODELS_DIR}/upscale_models" ]; then
    echo "  (symlink -> $(readlink -f "${MODELS_DIR}/upscale_models" 2>/dev/null || readlink "${MODELS_DIR}/upscale_models"))"
fi
for p in "${MODELS_DIR}/upscale_models"/*.pth; do
    [ -e "$p" ] || continue
    echo "  $(du -h "$p" 2>/dev/null | cut -f1)  $(basename "$p")"
done

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
import os
import urllib.request

required = {
    "LoadLoraFromUrlOrPath",
    "CR Apply LoRA Stack",
    "CR SDXL Aspect Ratio",
    "UltimateSDUpscale",
    "UpscaleModelLoader",
    "Seed (rgthree)",
    "Image Film Grain",
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

REQUIRED_UPSCALE = "4xFaceUpDAT.pth"

def upscale_model_choices(info):
    ul = info.get("UpscaleModelLoader") or {}
    inp = ul.get("input") or ul.get("inputs") or {}
    req = inp.get("required") or {}
    mn = req.get("model_name")
    if mn is None:
        return []
    if not isinstance(mn, list) or len(mn) == 0:
        return []
    if mn[0] == "COMBO" and len(mn) > 1:
        opts = mn[1]
        if isinstance(opts, list):
            return [x for x in opts if isinstance(x, str)]
        if isinstance(opts, dict):
            for key in ("options", "choices", "values"):
                v = opts.get(key)
                if isinstance(v, list):
                    return [x for x in v if isinstance(x, str)]
    first = mn[0]
    if isinstance(first, list):
        return [x for x in first if isinstance(x, str)]
    if isinstance(first, str) and first not in ("COMBO", "STRING", "INT", "FLOAT", "BOOLEAN"):
        return [x for x in mn if isinstance(x, str)]
    for item in mn:
        if isinstance(item, list):
            return [x for x in item if isinstance(x, str)]
    return []

try:
    choices = upscale_model_choices(data)
    if REQUIRED_UPSCALE in choices:
        print(f">>> Upscale model OK: {REQUIRED_UPSCALE} is registered in ComfyUI ({len(choices)} file(s) in upscale_models)")
    else:
        print(f">>> WARN: {REQUIRED_UPSCALE} not in UpscaleModelLoader list (got {len(choices)} entries). Check models path / symlinks.")
        if choices[:5]:
            print(f">>>      Sample: {choices[:5]}")
        if os.environ.get("REQUIRE_UPSCALE_MODEL") == "1":
            print(">>> ERROR: REQUIRE_UPSCALE_MODEL=1 — refusing to start without upscaler registered.")
            raise SystemExit(1)
except SystemExit:
    raise
except Exception as e:
    print(f">>> WARN: could not verify UpscaleModelLoader choices: {e}")
PYEOF

echo ">>> Starting RunPod serverless handler..."
cd /workspace
python3 handler.py
