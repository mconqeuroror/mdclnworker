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

# Civitai download with token-from-env. civitai.red 404s — use civitai.com.
# Token comes from CIVITAI_API_TOKEN (RunPod env). Without it, this skips
# silently so the worker still boots without these optional NSFW assets.
download_civitai() {
    local url="$1"        # full civitai.com /api/download/models/<id>?... URL (no token)
    local dest="$2"
    local name="$(basename "$dest")"

    if [ -f "$dest" ]; then
        local sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
        if [ "$sz" -gt 1000000 ]; then
            echo "  [OK] Already exists: $name ($(du -h "$dest" | cut -f1))"
            return 0
        fi
        echo "  [FIX] Replacing corrupt/empty $name (${sz} bytes)..."
        rm -f "$dest"
    fi

    if [ -z "${CIVITAI_API_TOKEN:-}" ]; then
        echo "  [SKIP] $name — CIVITAI_API_TOKEN not set in worker env."
        return 0
    fi

    echo "  [DL] Civitai: $name ..."
    mkdir -p "$(dirname "$dest")"
    # -c          — resume partial downloads on retry
    # --max-redirect=50 — civitai redirects to a presigned R2/B2 URL
    # --tries=3   — transient 502s from civitai are common
    # Authorization header is preferred over inline ?token= so the secret
    # never lands in process listings or proxy logs.
    if wget -q --show-progress \
        -c \
        --max-redirect=50 \
        --tries=3 \
        --user-agent="ModelClone-Worker/1.0" \
        --header="Authorization: Bearer ${CIVITAI_API_TOKEN}" \
        -O "${dest}.tmp" \
        "$url" 2>&1; then
        mv "${dest}.tmp" "$dest"
        echo "  [OK] Downloaded: $name ($(du -h "$dest" | cut -f1))"
    else
        echo "  [!!] FAILED Civitai download: $name (will retry next boot)"
        rm -f "${dest}.tmp"
    fi
}

setup_models() {
    local target_dir="$1"

    # RunPod S3-backed network volumes can persist symlink INODEs as tiny placeholder objects.
    # Those land in checkpoints/ with the same basename as real UNETs and Comfy may load them
    # → safetensors shape errors. Set SKIP_CHECKPOINT_WEIGHT_SYMLINKS=1 on those endpoints.
    link_ckpt_weight() {
        if [ "${SKIP_CHECKPOINT_WEIGHT_SYMLINKS:-0}" = "1" ]; then
            echo "  [SKIP] checkpoints/ symlink (SKIP_CHECKPOINT_WEIGHT_SYMLINKS=1): $2"
            return 0
        fi
        ln -sfn "$1" "$2"
    }

    mkdir -p "${target_dir}/checkpoints"
    mkdir -p "${target_dir}/clip"
    mkdir -p "${target_dir}/text_encoders"
    mkdir -p "${target_dir}/vae"
    mkdir -p "${target_dir}/loras"
    mkdir -p "${target_dir}/diffusion_models"
    mkdir -p "${target_dir}/model_patches"
    mkdir -p "${target_dir}/depthanything"
    mkdir -p "${target_dir}/unet"
    mkdir -p "${target_dir}/ultralytics/bbox"
    mkdir -p "${target_dir}/sams"

    echo ""
    echo "--- [1/9] VAE: ae.safetensors (335MB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
        "${target_dir}/vae/ae.safetensors"

    echo ""
    echo "--- [2/9] Text encoder: qwen_3_4b.safetensors (8GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors" \
        "${target_dir}/text_encoders/qwen_3_4b.safetensors"
    # Backward compatibility for CLIPLoader-based workflows expecting models/clip.
    ln -sfn "${target_dir}/text_encoders/qwen_3_4b.safetensors" \
            "${target_dir}/clip/qwen_3_4b.safetensors"

    echo ""
    echo "--- [3/9] Diffusion model: z_image_turbo_bf16.safetensors (~12.3GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors" \
        "${target_dir}/diffusion_models/z_image_turbo_bf16.safetensors"
    # Also expose as a classic checkpoint for CheckpointLoaderSimple workflows.
    link_ckpt_weight "${target_dir}/diffusion_models/z_image_turbo_bf16.safetensors" \
        "${target_dir}/checkpoints/z_image_turbo_bf16.safetensors"

    echo ""
    echo "--- [4/9] ControlNet patch: Z-Image-Turbo-Fun-Controlnet-Union (~3.1GB) ---"
    download_if_missing \
        "https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union/resolve/main/Z-Image-Turbo-Fun-Controlnet-Union.safetensors" \
        "${target_dir}/model_patches/Z-Image-Turbo-Fun-Controlnet-Union.safetensors"

    echo ""
    echo "--- [5/9] UNet: zImageTurboNSFW_62BF16.safetensors (network volume / S3) ---"
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
        link_ckpt_weight "${target_dir}/unet/zImageTurboNSFW_62BF16.safetensors" \
            "${target_dir}/checkpoints/zImageTurboNSFW_62BF16.safetensors"
        echo "  [OK] Symlinked UNet into checkpoints/"
    fi

    echo ""
    echo "--- [6/9] Upscaler: 4xFaceUpDAT.pth ---"
    mkdir -p "${target_dir}/upscale_models"
    download_if_missing \
        "https://huggingface.co/Acly/Upscaler/resolve/main/4xFaceUpDAT.pth" \
        "${target_dir}/upscale_models/4xFaceUpDAT.pth"

    echo ""
    echo "--- [7/9] DepthAnythingV3 cache: da3_base.safetensors (~1.1GB) ---"
    if [ ! -f "${target_dir}/depthanything/da3_base.safetensors" ]; then
        TARGET_DEPTH_DIR="${target_dir}/depthanything" python3 - <<'PYEOF'
import os
try:
    from huggingface_hub import hf_hub_download
except Exception:
    raise SystemExit(1)

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
        if [ $? -eq 0 ]; then
            echo "  [OK] DepthAnythingV3 cached: da3_base.safetensors"
        else
            echo "  [WARN] DepthAnythingV3 pre-cache failed; node will auto-download on first use."
        fi
    else
        echo "  [OK] Already exists: da3_base.safetensors"
    fi

    echo ""
    echo "--- [8/9] zImageTurboNSFW_43BF16AIO.safetensors (diffusion_models, ~6GB) ---"
    # Prefer a direct HTTPS mirror when set — no Civitai token.
    # Use only if this URL is the same artifact as Civitai model 2682644 (e.g. your mirror or presigned copy).
    #   ZIT_43BF16_MIRROR_URL="https://..."
    # Otherwise Civitai model 2682644 (requires CIVITAI_API_TOKEN on the worker).
    Z43="${target_dir}/diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors"
    if [ -n "${ZIT_43BF16_MIRROR_URL:-}" ]; then
        echo "  [INFO] ZIT_43BF16_MIRROR_URL set — downloading without Civitai."
        download_if_missing "${ZIT_43BF16_MIRROR_URL}" "${Z43}"
    else
        download_civitai \
            "https://civitai.com/api/download/models/2682644?type=Model&format=SafeTensor&size=pruned&fp=fp16" \
            "${Z43}"
    fi
    # Mirror into checkpoints/ so CheckpointLoaderSimple workflows resolve it.
    if [ -f "${Z43}" ]; then
        link_ckpt_weight "${Z43}" \
            "${target_dir}/checkpoints/zImageTurboNSFW_43BF16AIO.safetensors"
    fi

    echo ""
    echo "--- [9/9] Civitai: pornworksRealPorn_Illustrious_v4_04.safetensors (checkpoints, ~6GB) ---"
    # Civitai model 2114370, Illustrious base, full FP16 build.
    download_civitai \
        "https://civitai.com/api/download/models/2114370?type=Model&format=SafeTensor&size=full&fp=fp16" \
        "${target_dir}/checkpoints/pornworksRealPorn_Illustrious_v4_04.safetensors"

    echo ""
    echo "--- [Extra] Impact FaceDetailer: face_yolov8m.pt (ultralytics bbox) ---"
    download_if_missing \
        "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt" \
        "${target_dir}/ultralytics/bbox/face_yolov8m.pt"

    echo ""
    echo "--- [Extra] Impact SAMLoader: sam_vit_b_01ec64.pth (~375MB) ---"
    download_if_missing \
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth" \
        "${target_dir}/sams/sam_vit_b_01ec64.pth"

    # Object-backed volumes sometimes persist symlinks as tiny stub files in checkpoints/
    # with the same basename as real UNETs → Comfy loads garbage and safetensors crashes.
    for stub in \
        zImageTurboNSFW_62BF16.safetensors \
        z_image_turbo_bf16.safetensors \
        zImageTurboNSFW_43BF16AIO.safetensors \
        zImageTurboNSFW_20BF16AIO.safetensors; do
        p="${target_dir}/checkpoints/${stub}"
        if [ -f "$p" ]; then
            sz=$(stat -c%s "$p" 2>/dev/null || echo 0)
            if [ "$sz" -lt 1048576 ]; then
                echo "  [FIX] Removing checkpoints stub ${stub} (${sz} bytes; real weights live in unet/ or diffusion_models/)"
                rm -f "$p"
            fi
        fi
    done
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
    for subdir in checkpoints clip loras vae unet diffusion_models text_encoders model_patches depthanything upscale_models ultralytics sams; do
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

echo ""
echo "--- Checking PozzettiAndrea/ComfyUI-DepthAnythingV3 ---"
DEPTHANYTHING_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-DepthAnythingV3"
if [ -d "${DEPTHANYTHING_DIR}" ]; then
    echo "  [OK] ComfyUI-DepthAnythingV3 already installed"
else
    echo "  [!!] ComfyUI-DepthAnythingV3 missing — installing..."
    git clone --depth 1 "https://github.com/PozzettiAndrea/ComfyUI-DepthAnythingV3.git" "${DEPTHANYTHING_DIR}"
    if [ -f "${DEPTHANYTHING_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${DEPTHANYTHING_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI-DepthAnythingV3 installed!"
fi

echo ""
echo "--- Checking a-und-b/ComfyUI_LoRA_from_URL ---"
LORA_URL_V2_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI_LoRA_from_URL"
if [ -d "${LORA_URL_V2_DIR}" ]; then
    echo "  [OK] ComfyUI_LoRA_from_URL already installed"
else
    echo "  [!!] ComfyUI_LoRA_from_URL missing — installing..."
    git clone --depth 1 "https://github.com/a-und-b/ComfyUI_LoRA_from_URL.git" "${LORA_URL_V2_DIR}"
    if [ -f "${LORA_URL_V2_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${LORA_URL_V2_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI_LoRA_from_URL installed!"
fi

echo ""
echo "--- Checking yolain/ComfyUI-Easy-Use ---"
EASY_USE_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-Easy-Use"
if [ -d "${EASY_USE_DIR}" ]; then
    echo "  [OK] ComfyUI-Easy-Use already installed"
else
    echo "  [!!] ComfyUI-Easy-Use missing — installing..."
    git clone --depth 1 "https://github.com/yolain/ComfyUI-Easy-Use.git" "${EASY_USE_DIR}"
    if [ -f "${EASY_USE_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${EASY_USE_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI-Easy-Use installed!"
fi

echo ""
echo "--- Checking giriss/comfy-image-saver ---"
COMFY_IMAGE_SAVER_DIR="${COMFYUI_DIR}/custom_nodes/comfy-image-saver"
if [ -d "${COMFY_IMAGE_SAVER_DIR}" ]; then
    echo "  [OK] comfy-image-saver already installed"
else
    echo "  [!!] comfy-image-saver missing — installing..."
    git clone --depth 1 "https://github.com/giriss/comfy-image-saver.git" "${COMFY_IMAGE_SAVER_DIR}"
    if [ -f "${COMFY_IMAGE_SAVER_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${COMFY_IMAGE_SAVER_DIR}/requirements.txt" || true
    fi
    echo "  [OK] comfy-image-saver installed!"
fi

echo ""
echo "--- Checking crystian/ComfyUI-Crystools ---"
CRYSTOOLS_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-Crystools"
if [ -d "${CRYSTOOLS_DIR}" ]; then
    echo "  [OK] ComfyUI-Crystools already installed"
else
    echo "  [!!] ComfyUI-Crystools missing — installing..."
    git clone --depth 1 "https://github.com/crystian/ComfyUI-Crystools.git" "${CRYSTOOLS_DIR}"
    if [ -f "${CRYSTOOLS_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${CRYSTOOLS_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI-Crystools installed!"
fi

echo ""
echo "--- Checking WASasquatch/was-node-suite-comfyui ---"
WAS_SUITE_DIR="${COMFYUI_DIR}/custom_nodes/was-node-suite-comfyui"
if [ -d "${WAS_SUITE_DIR}" ]; then
    echo "  [OK] was-node-suite-comfyui already installed"
else
    echo "  [!!] was-node-suite-comfyui missing — installing..."
    git clone --depth 1 "https://github.com/WASasquatch/was-node-suite-comfyui.git" "${WAS_SUITE_DIR}"
    if [ -f "${WAS_SUITE_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${WAS_SUITE_DIR}/requirements.txt" || true
    fi
    echo "  [OK] was-node-suite-comfyui installed!"
fi

# Remove old node packages if they exist (superseded)
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
echo "--- Checking ltdrdata/ComfyUI-Impact-Pack ---"
IMPACT_PACK_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-Impact-Pack"
if [ -d "${IMPACT_PACK_DIR}" ]; then
    echo "  [OK] ComfyUI-Impact-Pack already installed"
else
    echo "  [!!] ComfyUI-Impact-Pack missing — installing..."
    git clone --depth 1 "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git" "${IMPACT_PACK_DIR}"
    if [ -f "${IMPACT_PACK_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${IMPACT_PACK_DIR}/requirements.txt" || true
    fi
    if [ -f "${IMPACT_PACK_DIR}/install.py" ]; then
        ( cd "${IMPACT_PACK_DIR}" && python3 install.py ) || true
    fi
    echo "  [OK] ComfyUI-Impact-Pack installed!"
fi

echo ""
echo "--- Checking ltdrdata/ComfyUI-Impact-Subpack ---"
IMPACT_SUB_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-Impact-Subpack"
if [ -d "${IMPACT_SUB_DIR}" ]; then
    echo "  [OK] ComfyUI-Impact-Subpack already installed"
else
    echo "  [!!] ComfyUI-Impact-Subpack missing — installing..."
    git clone --depth 1 "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git" "${IMPACT_SUB_DIR}"
    if [ -f "${IMPACT_SUB_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${IMPACT_SUB_DIR}/requirements.txt" || true
    fi
    if [ -f "${IMPACT_SUB_DIR}/install.py" ]; then
        ( cd "${IMPACT_SUB_DIR}" && python3 install.py ) || true
    fi
    echo "  [OK] ComfyUI-Impact-Subpack installed!"
fi

echo ""
echo "--- Checking cubiq/ComfyUI_essentials ---"
ESSENTIALS_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI_essentials"
if [ -d "${ESSENTIALS_DIR}" ]; then
    echo "  [OK] ComfyUI_essentials already installed"
else
    echo "  [!!] ComfyUI_essentials missing — installing..."
    git clone --depth 1 "https://github.com/cubiq/ComfyUI_essentials.git" "${ESSENTIALS_DIR}"
    if [ -f "${ESSENTIALS_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${ESSENTIALS_DIR}/requirements.txt" || true
    fi
    echo "  [OK] ComfyUI_essentials installed!"
fi

echo ""
echo "--- Checking CoiiChan/comfyui-every-person-seg-coii ---"
EVERY_PERSON_DIR="${COMFYUI_DIR}/custom_nodes/comfyui-every-person-seg-coii"
if [ -d "${EVERY_PERSON_DIR}" ]; then
    echo "  [OK] comfyui-every-person-seg-coii already installed"
else
    echo "  [!!] comfyui-every-person-seg-coii missing — installing..."
    git clone --depth 1 "https://github.com/CoiiChan/comfyui-every-person-seg-coii.git" "${EVERY_PERSON_DIR}"
    if [ -f "${EVERY_PERSON_DIR}/requirements.txt" ]; then
        pip install -q --no-cache-dir -r "${EVERY_PERSON_DIR}/requirements.txt" || true
    fi
    echo "  [OK] comfyui-every-person-seg-coii installed!"
fi

echo ""
echo "--- Checking gateway/ComfyUI-Kie-API ---"
KIE_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-Kie-API"
if [ -d "${KIE_DIR}" ]; then
    echo "  [OK] ComfyUI-Kie-API already installed"
else
    echo "  [!!] ComfyUI-Kie-API missing — installing..."
    git clone --depth 1 "https://github.com/gateway/ComfyUI-Kie-API.git" "${KIE_DIR}"
    echo "  [OK] ComfyUI-Kie-API installed!"
fi

# Kie.ai API key for KIE_NanoBananaPro_Image (optional; omit if workflows skip KIE nodes)
if [ -n "${KIE_API_KEY:-}" ] && [ -d "${KIE_DIR}" ]; then
    mkdir -p "${KIE_DIR}/config"
    printf '%s' "${KIE_API_KEY}" > "${KIE_DIR}/config/kie_key.txt"
    chmod 600 "${KIE_DIR}/config/kie_key.txt" 2>/dev/null || true
    echo ""
    echo ">>> Wrote KIE API key to ComfyUI-Kie-API/config/kie_key.txt (from env KIE_API_KEY)"
elif [ -n "${KIE_API_KEY:-}" ]; then
    echo ""
    echo ">>> [WARN] KIE_API_KEY set but ${KIE_DIR} is missing — install ComfyUI-Kie-API first"
else
    echo ""
    echo ">>> [INFO] KIE_API_KEY unset — Kie.ai nodes require kie_key.txt for API calls"
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
MAX_WAIT=540
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

mcx_extended = {
    "FaceDetailer",
    "SAMLoader",
    "UltralyticsDetectorProvider",
    "ImpactImageInfo",
    "MaskPreview+",
    "EveryPersonSegDetail",
    "KIE_NanoBananaPro_Image",
    "QwenImageDiffsynthControlnet",
    "ModelPatchLoader",
    "ImageScaleToTotalPixels",
    "ResizeImageMaskNode",
    "DepthAnything_V3",
}
mx_missing = sorted([n for n in mcx_extended if n not in data])
if mx_missing:
    print(">>> WARN: MCX / FaceDetailer / KIE workflow nodes missing:")
    for n in mx_missing:
        print(f"    - {n}")
else:
    print(">>> Extended MCX / Impact / KIE / DA3 node types OK")

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
