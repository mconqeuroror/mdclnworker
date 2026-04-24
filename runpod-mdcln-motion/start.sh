#!/bin/bash
# NOTE: Do NOT use 'set -e' — same reasoning as the image worker:
# native libs (onnxruntime, torch, ffmpeg) can panic during startup,
# we want the handler to come up regardless and surface errors per-job.

echo "========================================="
echo "ModelClone NSFW Motion-Control Worker Starting..."
echo "Wan 2.2 Animate (14B) — image + driving video → animated MP4"
echo "========================================="

COMFYUI_DIR="/workspace/ComfyUI"
MODELS_DIR="${COMFYUI_DIR}/models"
VOLUME_DIR="/runpod-volume"
VOLUME_MODELS="${VOLUME_DIR}/models"

export HF_HUB_ENABLE_HF_TRANSFER=1

# Make sure runtime deps land in the same Python ComfyUI runs.
echo ">>> Ensuring runtime Python dependencies..."
python3 -m pip install --no-cache-dir \
    "huggingface-hub>=0.25.0" hf_transfer \
    sqlalchemy aiosqlite \
    runpod requests \
    onnxruntime-gpu \
    opencv-python-headless \
    "numpy<2" \
    || echo "  [WARN] pip install failed — handler or custom nodes may not load"

download_if_missing() {
    local url="$1"
    local dest="$2"
    local name="$(basename $dest)"

    if [ -f "$dest" ]; then
        local sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
        if [ "$sz" -gt 10000 ]; then
            echo "  [OK] Already exists: $name ($(du -h "$dest" | cut -f1))"
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

    mkdir -p "${target_dir}/diffusion_models" \
             "${target_dir}/text_encoders" \
             "${target_dir}/vae" \
             "${target_dir}/clip_vision" \
             "${target_dir}/loras" \
             "${target_dir}/detection"

    echo ""
    echo "--- [1/7] Wan 2.2 Animate 14B (bf16, ~34GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_animate_14B_bf16.safetensors" \
        "${target_dir}/diffusion_models/wan2.2_animate_14B_bf16.safetensors"

    echo ""
    echo "--- [2/7] Wan 2.1 VAE (~242MB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors" \
        "${target_dir}/vae/wan_2.1_vae.safetensors"

    echo ""
    echo "--- [3/7] UMT5 XXL fp8 text encoder (~6.4GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
        "${target_dir}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"

    echo ""
    echo "--- [4/7] CLIP vision H (~1.2GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors" \
        "${target_dir}/clip_vision/clip_vision_h.safetensors"

    echo ""
    echo "--- [5/7] Wan 2.2 i2v lightx2v 4-step LoRA, high noise (~1.2GB) ---"
    download_if_missing \
        "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors" \
        "${target_dir}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors"

    echo ""
    echo "--- [6/7] Lightx2v I2V 14B 480p distill rank256 LoRA (~2.7GB) ---"
    download_if_missing \
        "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors" \
        "${target_dir}/loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors"

    echo ""
    echo "--- [7/7] Pose detection ONNX models (vitpose-l + yolov10m) ---"
    download_if_missing \
        "https://huggingface.co/JunkyByte/easy_ViTPose/resolve/main/onnx/wholebody/vitpose-l-wholebody.onnx" \
        "${target_dir}/detection/vitpose-l-wholebody.onnx"
    download_if_missing \
        "https://huggingface.co/Kalray/yolov10/resolve/main/yolov10m.onnx" \
        "${target_dir}/detection/yolov10m.onnx"
}

# -----------------------------------------------
# Resolve model storage location
# -----------------------------------------------
if [ -d "$VOLUME_DIR" ]; then
    export HF_HOME="${VOLUME_DIR}/hf_cache"
    mkdir -p "${HF_HOME}"
    echo ">>> Network volume found at $VOLUME_DIR"
    echo ">>> HF_HOME set to ${HF_HOME}"
    echo ">>> Downloading motion-control models to network volume (skipping existing)..."
    setup_models "${VOLUME_MODELS}"

    echo ""
    echo ">>> Symlinking network volume models into ComfyUI..."
    for subdir in diffusion_models text_encoders vae clip_vision loras detection; do
        mkdir -p "${VOLUME_MODELS}/${subdir}"
        rm -rf "${MODELS_DIR}/${subdir}"
        ln -sfn "${VOLUME_MODELS}/${subdir}" "${MODELS_DIR}/${subdir}"
        echo "  [OK] Linked: ${MODELS_DIR}/${subdir} -> ${VOLUME_MODELS}/${subdir}"
    done
else
    export HF_HOME="/root/.cache/huggingface"
    mkdir -p "${HF_HOME}"
    echo ">>> No network volume — downloading models directly into ComfyUI..."
    setup_models "${MODELS_DIR}"
fi

# -----------------------------------------------
# Self-heal: ensure required custom nodes are installed even on stale images.
# -----------------------------------------------
ensure_node() {
    local repo="$1"          # eg. kijai/ComfyUI-WanAnimatePreprocess
    local name=$(basename "$repo")
    local dir="${COMFYUI_DIR}/custom_nodes/${name}"
    if [ -d "$dir" ]; then
        echo "  [OK] ${name} present"
    else
        echo "  [!!] ${name} missing — cloning..."
        git clone --depth 1 "https://github.com/${repo}.git" "$dir" || { echo "  [!!] clone failed for ${repo}"; return 1; }
        if [ -f "${dir}/requirements.txt" ]; then
            python3 -m pip install -q --no-cache-dir -r "${dir}/requirements.txt" || true
        fi
        echo "  [OK] ${name} installed"
    fi
}

echo ""
echo "--- Self-healing required custom nodes ---"
ensure_node "kijai/ComfyUI-WanAnimatePreprocess"
ensure_node "kijai/ComfyUI-KJNodes"
ensure_node "Kosinkadink/ComfyUI-VideoHelperSuite"
ensure_node "rgthree/rgthree-comfy"
ensure_node "yolain/ComfyUI-Easy-Use"
ensure_node "cubiq/ComfyUI_essentials"
ensure_node "pythongosssss/ComfyUI-Custom-Scripts"

echo ""
echo ">>> Model files available in ${MODELS_DIR}:"
find ${MODELS_DIR} \( -name "*.safetensors" -o -name "*.onnx" -o -name "*.bin" \) -type f 2>/dev/null | while read f; do
    echo "  $(du -h "$f" 2>/dev/null | cut -f1)  ${f#${MODELS_DIR}/}"
done
find ${MODELS_DIR} \( -name "*.safetensors" -o -name "*.onnx" -o -name "*.bin" \) -type l 2>/dev/null | while read f; do
    echo "  (link) $(du -h --dereference "$f" 2>/dev/null | cut -f1)  ${f#${MODELS_DIR}/}"
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
MAX_WAIT=600
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s http://127.0.0.1:8188/system_stats > /dev/null 2>&1; then
        echo ">>> ComfyUI is READY! (took ${WAITED}s)"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 30)) -eq 0 ]; then
        echo "  Still waiting... (${WAITED}s)"
    fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo ">>> ERROR: ComfyUI failed to start within ${MAX_WAIT}s"
    exit 1
fi

echo ">>> Validating required node types for the motion-control workflow..."
python3 - <<'PYEOF'
import json
import urllib.request

required = {
    # core (require recent ComfyUI for WanAnimateToVideo)
    "WanAnimateToVideo", "TrimVideoLatent", "KSampler", "VAELoader", "VAEDecode",
    "CLIPLoader", "CLIPTextEncode", "CLIPVisionLoader", "CLIPVisionEncode",
    "UNETLoader", "LoraLoaderModelOnly", "ModelSamplingSD3", "LoadImage",
    # KJNodes
    "ImageConcatMulti", "ImageResizeKJv2", "GetImageRangeFromBatch", "GetImageSize",
    "wanBlockSwap", "TorchCompileModelWanVideoV2", "PathchSageAttentionKJ",
    "ModelPatchTorchSettings",
    # WanAnimatePreprocess
    "PoseAndFaceDetection", "DrawViTPose", "OnnxDetectionModelLoader",
    # VHS
    "VHS_LoadVideo", "VHS_VideoCombine", "VHS_VideoInfo",
    # rgthree
    "Seed (rgthree)", "Any Switch (rgthree)",
    # easy-use
    "easy int", "easy float", "easy boolean", "easy ifElse", "easy compare",
    "easy positive", "easy promptReplace", "easy convertAnything",
    "easy whileLoopStart", "easy whileLoopEnd", "easy lengthAnything", "easy batchAnything",
    # essentials
    "SimpleMath+", "SimpleMathDual+",
    # pysssss
    "MathExpression|pysssss",
}

try:
    with urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
except Exception as e:
    print(f">>> WARN: failed to query ComfyUI object_info: {e}")
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
