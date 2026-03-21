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

download_if_missing() {
    local url="$1"
    local dest="$2"
    local name="$(basename $dest)"

    if [ -f "$dest" ]; then
        echo "  [OK] Already exists: $name"
        return 0
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
    mkdir -p "${target_dir}/LLavacheckpoints"

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
    echo "--- [3/4] UNet: zImageTurboNSFW_43BF16AIO.safetensors (CivitAI) ---"
    if [ -f "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors" ]; then
        echo "  [OK] Already exists: zImageTurboNSFW_43BF16AIO.safetensors"
    else
        echo "  [DL] Downloading from CivitAI (requires API key)..."
        mkdir -p "${target_dir}/unet"
        CIVITAI_URL="https://civitai.com/api/download/models/2682644?type=Model&format=SafeTensor&size=pruned&fp=fp16&token=${CIVITAI_API_KEY}"
        if wget -q --show-progress --content-disposition -O "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors.tmp" "${CIVITAI_URL}" 2>&1; then
            mv "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors.tmp" "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors"
            echo "  [OK] Downloaded: zImageTurboNSFW_43BF16AIO.safetensors ($(du -h "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors" | cut -f1))"
        else
            echo "  [!!] FAILED to download from CivitAI. Check CIVITAI_API_KEY env var."
            rm -f "${target_dir}/unet/zImageTurboNSFW_43BF16AIO.safetensors.tmp"
        fi
    fi
    if [ -f "${target_dir}/unet/zImageTurboNSFW_20BF16AIO.safetensors" ]; then
        echo "  [CLEANUP] Removing old v2.0 model..."
        rm -f "${target_dir}/unet/zImageTurboNSFW_20BF16AIO.safetensors"
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
# Points at network volume so LLM downloads (JoyCaption) persist across reboots
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
    for subdir in checkpoints clip loras vae unet diffusion_models LLavacheckpoints upscale_models; do
        if [ -d "${VOLUME_MODELS}/$subdir" ]; then
            rm -rf "${MODELS_DIR}/$subdir"
            ln -sf "${VOLUME_MODELS}/$subdir" "${MODELS_DIR}/$subdir"
            echo "  [OK] Linked: $subdir"
        fi
    done
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
LAYERSTYLE_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI_LayerStyle_Advance"
JOYCAPTION_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-JoyCaption"

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

echo ""
echo "--- Checking chflame163/ComfyUI_LayerStyle_Advance (JoyCaption nodes) ---"
if grep -qr "LoadJoyCaptionBeta1Model" "${LAYERSTYLE_DIR}" 2>/dev/null; then
    echo "  [OK] ComfyUI_LayerStyle_Advance already installed with JoyCaption nodes"
else
    echo "  [!!] JoyCaption nodes missing — installing chflame163/ComfyUI_LayerStyle_Advance..."
    rm -rf "${LAYERSTYLE_DIR}"
    git clone --depth 1 "https://github.com/chflame163/ComfyUI_LayerStyle_Advance.git" "${LAYERSTYLE_DIR}"
    if [ -f "${LAYERSTYLE_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${LAYERSTYLE_DIR}/requirements.txt"
    fi
    pip install -q --no-cache-dir \
        "transformers==4.44.2" accelerate sentencepiece protobuf \
        "huggingface-hub>=0.25.0" bitsandbytes peft einops
    echo "  [OK] ComfyUI_LayerStyle_Advance installed!"
fi

echo ""
echo "--- Checking 1038lab/ComfyUI-JoyCaption ---"
if [ -d "${JOYCAPTION_DIR}" ]; then
    echo "  [OK] ComfyUI-JoyCaption already installed"
else
    echo "  [!!] ComfyUI-JoyCaption missing — installing..."
    git clone --depth 1 "https://github.com/1038lab/ComfyUI-JoyCaption.git" "${JOYCAPTION_DIR}"
fi
if [ -f "${JOYCAPTION_DIR}/requirements.txt" ]; then
    pip install -q --no-cache-dir -r "${JOYCAPTION_DIR}/requirements.txt"
fi
if [ -f "${JOYCAPTION_DIR}/requirements_gguf.txt" ]; then
    pip install -q --no-cache-dir -r "${JOYCAPTION_DIR}/requirements_gguf.txt" || true
fi

# Repair JoyCaption source if a previous rollout injected problematic tokenizer patches.
JOYCAPTION_BETA_FILE="${LAYERSTYLE_DIR}/py/joycaption_beta_1.py"
echo ""
echo "--- Repairing JoyCaption tokenizer patch state ---"
if [ -f "${JOYCAPTION_BETA_FILE}" ]; then
    python3 - "${JOYCAPTION_BETA_FILE}" <<'PYEOF'
import re
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    code = f.read()

original = code

# Repair invalid syntax from earlier bad patch variants.
code = re.sub(
    r'self\.processor\s*=\s*#\s*USE_SLOW_TOKENIZER_PATCH\s*\n\s*AutoProcessor\.from_pretrained\(([^)]*)\)',
    r'self.processor = AutoProcessor.from_pretrained(\1)',
    code,
    flags=re.MULTILINE,
)

# Remove forced slow-tokenizer arg which crashes this model in current stack.
code = re.sub(
    r'AutoProcessor\.from_pretrained\(\s*checkpoint_path\s*,\s*use_fast\s*=\s*False\s*\)',
    'AutoProcessor.from_pretrained(checkpoint_path)',
    code,
)

if code != original:
    with open(path, "w", encoding="utf-8") as f:
        f.write(code)
    print("  [OK] JoyCaption source repaired (removed stale tokenizer patch)")
else:
    print("  [OK] JoyCaption source already clean")
PYEOF
else
    echo "  [!!] joycaption_beta_1.py not found; repair skipped"
fi

# -----------------------------------------------
# Download JoyCaption Beta1 LLM (required by imgtoprompt_api.json workflow)
# Model: fancyfeast/llama-joycaption-beta-one-hf-llava (~9GB)
# Stored in HF_HOME cache — skipped automatically if already present
# -----------------------------------------------
JOYCAPTION_MODEL_ID="fancyfeast/llama-joycaption-beta-one-hf-llava"
JOYCAPTION_MARKER="${HF_HOME}/hub/models--fancyfeast--llama-joycaption-beta-one-hf-llava/snapshots"

echo ""
echo "--- JoyCaption Beta1 LLM (${JOYCAPTION_MODEL_ID}, ~9GB) ---"
if [ -d "${JOYCAPTION_MARKER}" ]; then
    echo "  [OK] JoyCaption Beta1 already in HF cache — skipping download"
else
    echo "  [DL] Downloading JoyCaption Beta1 (this takes a few minutes)..."
    python3 - <<'PYEOF'
import sys, os
hf_home = os.environ.get("HF_HOME", "/root/.cache/huggingface")
os.environ["HF_HOME"] = hf_home
try:
    from huggingface_hub import snapshot_download
    path = snapshot_download("fancyfeast/llama-joycaption-beta-one-hf-llava")
    print(f"  [OK] JoyCaption Beta1 ready at: {path}")
except Exception as e:
    print(f"  [!!] JoyCaption download failed: {e}", file=sys.stderr)
    sys.exit(0)
PYEOF
fi

# Validate cached JoyCaption processor/tokenizer.
# If cache is corrupted (common after interrupted/no-space downloads), wipe and re-download.
echo "  [CHK] Validating JoyCaption processor cache..."
# Guard with || true — AutoProcessor.from_pretrained can trigger Rust panics
# inside the tokenizers library that bypass Python exception handling and
# crash the process. This must never kill the worker startup.
python3 - <<'PYEOF' || true
import os
import shutil
import sys

from huggingface_hub import snapshot_download
from transformers import AutoProcessor

model_id = "fancyfeast/llama-joycaption-beta-one-hf-llava"
hf_home = os.environ.get("HF_HOME", "/root/.cache/huggingface")
hub_dir = os.path.join(hf_home, "hub")
model_prefix = "models--fancyfeast--llama-joycaption-beta-one-hf-llava"
model_dir = os.path.join(hub_dir, model_prefix)

def validate_or_raise():
    snap = snapshot_download(repo_id=model_id)
    AutoProcessor.from_pretrained(snap)
    return snap

try:
    snap = validate_or_raise()
    print(f"  [OK] JoyCaption processor valid: {snap}")
except Exception as first_err:
    print(f"  [WARN] JoyCaption cache validation failed: {first_err}")
    print("  [FIX] Removing cached model and re-downloading...")
    shutil.rmtree(model_dir, ignore_errors=True)
    try:
        snap = validate_or_raise()
        print(f"  [OK] JoyCaption processor recovered: {snap}")
    except Exception as second_err:
        print(f"  [ERR] JoyCaption cache still invalid after re-download: {second_err}", file=sys.stderr)
        print("  [WARN] Continuing startup; JoyCaption-based describe jobs may still fail", file=sys.stderr)
PYEOF

# Pre-populate LLavacheckpoints with symlinks to HF cache so the ComfyUI plugin
# doesn't re-copy ~9GB at runtime (which caused "No space left on device").
JOYCAPTION_SNAPSHOT=$(ls -d "${JOYCAPTION_MARKER}"/*/ 2>/dev/null | head -1)
if [ -n "$JOYCAPTION_SNAPSHOT" ]; then
    if [ -d "$VOLUME_DIR" ]; then
        LLAVA_TARGET="${VOLUME_MODELS}/LLavacheckpoints/llama-joycaption-beta-one-hf-llava"
    else
        LLAVA_TARGET="${MODELS_DIR}/LLavacheckpoints/llama-joycaption-beta-one-hf-llava"
    fi
    mkdir -p "$LLAVA_TARGET"
    LINK_COUNT=0
    for f in "${JOYCAPTION_SNAPSHOT}"*; do
        [ ! -f "$f" ] && continue
        fname=$(basename "$f")
        if [ ! -e "$LLAVA_TARGET/$fname" ]; then
            ln -sf "$f" "$LLAVA_TARGET/$fname"
            LINK_COUNT=$((LINK_COUNT + 1))
        fi
    done
    echo "  [OK] Pre-linked ${LINK_COUNT} JoyCaption files into LLavacheckpoints (avoids runtime copy)"
else
    echo "  [!!] No JoyCaption snapshot found — runtime will attempt download (may fail if disk is small)"
fi

echo ""
echo ">>> Model files available:"
find ${MODELS_DIR} -name "*.safetensors" -type f -o -name "*.safetensors" -type l 2>/dev/null | while read f; do
    echo "  $(du -h "$f" 2>/dev/null | cut -f1)  $(basename $f)"
done

echo ""
echo ">>> Starting ComfyUI on port 8188..."
cd ${COMFYUI_DIR}
LISTEN_ADDR="${COMFYUI_LISTEN:-0.0.0.0}"
echo ">>> Binding ComfyUI to ${LISTEN_ADDR}:8188"

# Export HF_HOME so ComfyUI and layerstyle can find the cached JoyCaption model
export HF_HOME="${HF_HOME}"

# Disable fast image processing in transformers — the torchvision-based fast path
# doesn't support lanczos interpolation on tensors, which crashes JoyCaption.
export TRANSFORMERS_USE_FAST_IMAGE_PROCESSING=0

# Fail fast if the runtime isn't configured for the JoyCaption lanczos fix.
if [ "${TRANSFORMERS_USE_FAST_IMAGE_PROCESSING}" != "0" ]; then
    echo ">>> ERROR: TRANSFORMERS_USE_FAST_IMAGE_PROCESSING must be 0"
    exit 1
fi
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

echo ">>> Validating required node types for all workflows..."
python3 - <<'PYEOF'
import json
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
    "LayerUtility: LoadJoyCaptionBeta1Model",
    "LayerUtility: JoyCaption2ExtraOptions",
    "LayerUtility: JoyCaptionBeta1",
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
