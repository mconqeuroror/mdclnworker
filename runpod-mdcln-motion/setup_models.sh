#!/bin/bash
# ============================================
# Optional pre-bake of motion-control models at image build time.
# Most operators will leave this out and let start.sh download into the
# /runpod-volume mount on first boot (~46GB).
# ============================================
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

mkdir -p "${MODELS_DIR}/diffusion_models" \
         "${MODELS_DIR}/text_encoders" \
         "${MODELS_DIR}/vae" \
         "${MODELS_DIR}/clip_vision" \
         "${MODELS_DIR}/loras" \
         "${MODELS_DIR}/detection"

echo ">>> Downloading Wan 2.2 Animate motion-control models..."

echo "  [1/7] Diffusion model: wan2.2_animate_14B_bf16.safetensors (~34GB) ..."
download_hf \
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_animate_14B_bf16.safetensors" \
    "${MODELS_DIR}/diffusion_models/wan2.2_animate_14B_bf16.safetensors"

echo "  [2/7] VAE: wan_2.1_vae.safetensors (~242MB) ..."
download_hf \
    "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors" \
    "${MODELS_DIR}/vae/wan_2.1_vae.safetensors"

echo "  [3/7] Text encoder: umt5_xxl_fp8_e4m3fn_scaled.safetensors (~6.4GB) ..."
download_hf \
    "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
    "${MODELS_DIR}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"

echo "  [4/7] CLIP vision: clip_vision_h.safetensors (~1.2GB) ..."
download_hf \
    "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors" \
    "${MODELS_DIR}/clip_vision/clip_vision_h.safetensors"

echo "  [5/7] LoRA (high-noise): wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors (~1.2GB) ..."
download_hf \
    "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors" \
    "${MODELS_DIR}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors"

echo "  [6/7] LoRA (I2V distill rank256): lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors (~2.7GB) ..."
download_hf \
    "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors" \
    "${MODELS_DIR}/loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors"

echo "  [7/7] ONNX detection models: vitpose-l-wholebody.onnx + yolov10m.onnx ..."
download_hf \
    "https://huggingface.co/JunkyByte/easy_ViTPose/resolve/main/onnx/wholebody/vitpose-l-wholebody.onnx" \
    "${MODELS_DIR}/detection/vitpose-l-wholebody.onnx"
download_hf \
    "https://huggingface.co/Kalray/yolov10/resolve/main/yolov10m.onnx" \
    "${MODELS_DIR}/detection/yolov10m.onnx"

echo ""
echo ">>> All motion-control models downloaded!"
