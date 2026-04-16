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
    mkdir -p "${target_dir}/LLavacheckpoints"
    mkdir -p "${target_dir}/seedvr2"

    echo ""
    echo "--- [1/6] VAE: ae.safetensors (335MB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
        "${target_dir}/vae/ae.safetensors"

    echo ""
    echo "--- [2/6] CLIP: qwen_3_4b.safetensors (8GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
        "${target_dir}/clip/qwen_3_4b.safetensors"

    echo ""
    echo "--- [3/6] UNet: zImageTurboNSFW_20BF16AIO.safetensors (HuggingFace) ---"
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

    echo ""
    echo "--- [4/6] Upscaler: 4xFaceUpDAT.pth ---"
    mkdir -p "${target_dir}/upscale_models"
    download_if_missing \
        "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
        "${target_dir}/upscale_models/4xFaceUpDAT.pth"

    echo ""
    echo "--- [5/6] SeedVR2 VAE: ema_vae_fp16.safetensors (~501MB) ---"
    download_if_missing \
        "https://huggingface.co/Osrivers/SEEDVR2/resolve/main/ema_vae_fp16.safetensors" \
        "${target_dir}/seedvr2/ema_vae_fp16.safetensors"

    echo ""
    echo "--- [6/6] SeedVR2 DiT: seedvr2_ema_7b_fp16.safetensors (~16.5GB) ---"
    if [ "${SKIP_SEEDVR2_MODELS:-0}" = "1" ]; then
        echo "  [SKIP] SKIP_SEEDVR2_MODELS=1 — skipping 16.5GB DiT model download."
        echo "         Set NSFW_COMFY_BYPASS_SEEDVR2=1 on the worker to run without SeedVR2 upscaling."
    else
        download_if_missing \
            "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_7b_fp16.safetensors" \
            "${target_dir}/seedvr2/seedvr2_ema_7b_fp16.safetensors"
    fi
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
    # Always mkdir + link each subdir. Linking only when the volume path already existed could
    # skip upscale_models on some boots; ComfyUI would then keep the empty image layer directory
    # and UpscaleModelLoader would see [] (workflow validation: 4xFaceUpDAT.pth not in list).
    for subdir in checkpoints clip loras vae unet diffusion_models LLavacheckpoints upscale_models seedvr2; do
        mkdir -p "${VOLUME_MODELS}/${subdir}"
        rm -rf "${MODELS_DIR}/${subdir}"
        ln -sfn "${VOLUME_MODELS}/${subdir}" "${MODELS_DIR}/${subdir}"
        echo "  [OK] Linked: ${MODELS_DIR}/${subdir} -> ${VOLUME_MODELS}/${subdir}"
    done
    # SeedVR2 node looks for models in SEEDVR2/ (uppercase) on Linux (case-sensitive fs).
    # Without this symlink the node downloads the 16.5GB DIT model at runtime every job.
    rm -rf "${MODELS_DIR}/SEEDVR2"
    ln -sfn "${VOLUME_MODELS}/seedvr2" "${MODELS_DIR}/SEEDVR2"
    echo "  [OK] Linked: ${MODELS_DIR}/SEEDVR2 -> ${VOLUME_MODELS}/seedvr2 (case alias)"
    # Volume may have an empty upscale_models dir (failed prior download). Re-attempt into linked path.
    if [ ! -f "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth" ]; then
        echo ">>> [RETRY] Upscale model missing after volume link — downloading 4xFaceUpDAT.pth..."
        mkdir -p "${MODELS_DIR}/upscale_models"
        download_if_missing \
            "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
            "${MODELS_DIR}/upscale_models/4xFaceUpDAT.pth"
    fi
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

echo ""
echo "--- Checking numz/ComfyUI-SeedVR2_VideoUpscaler (SeedVR2 nodes) ---"
SEEDVR2_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler"
if [ -d "${SEEDVR2_DIR}" ]; then
    echo "  [OK] ComfyUI-SeedVR2_VideoUpscaler already installed"
else
    echo "  [!!] ComfyUI-SeedVR2_VideoUpscaler missing — installing..."
    git clone --depth 1 "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git" "${SEEDVR2_DIR}"
    if [ -f "${SEEDVR2_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${SEEDVR2_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI-SeedVR2_VideoUpscaler installed!"
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
    "SeedVR2LoadVAEModel",
    "SeedVR2LoadDiTModel",
    "SeedVR2VideoUpscaler",
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

# UpscaleModelLoader only lists files ComfyUI sees under models/upscale_models/
REQUIRED_UPSCALE = "4xFaceUpDAT.pth"

def upscale_model_choices(info):
    ul = info.get("UpscaleModelLoader") or {}
    # ComfyUI 0.18+ object_info may use "inputs" instead of "input"
    inp = ul.get("input") or ul.get("inputs") or {}
    req = inp.get("required") or {}
    mn = req.get("model_name")
    if mn is None:
        return []
    if not isinstance(mn, list) or len(mn) == 0:
        return []
    # v0.18+: ["COMBO", ["a.pth", "b.pth"], {widget extras...}] — do not treat "COMBO" as a filename
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
