#!/bin/bash
set -euo pipefail

COMFYUI_DIR="/workspace/ComfyUI"
VOLUME_DIR="/runpod-volume"
VOLUME_MODELS="${VOLUME_DIR}/models"
CACHE_ROOT="${VOLUME_DIR}/hf_cache"
export HF_HOME="${CACHE_ROOT}"
export TORCH_HOME="${CACHE_ROOT}/torch"
export HF_HUB_DISABLE_TELEMETRY=1
export PYTHONDONTWRITEBYTECODE=1
export PIP_NO_INDEX=1
export PIP_DISABLE_PIP_VERSION_CHECK=1

if [ ! -d "${VOLUME_DIR}" ]; then
    echo "ERROR: /runpod-volume is required; serving workers never download models" >&2
    exit 1
fi

preflight_args=(
    --prepare
    --models "${VOLUME_MODELS}"
    --comfy-root "${COMFYUI_DIR}"
    --cache-root "${CACHE_ROOT}"
)
if [ "${NSFW_COMFY_BYPASS_UPSCALE:-0}" = "1" ]; then
    preflight_args+=(--bypass-upscale)
fi
python3 /workspace/runtime_preflight.py "${preflight_args[@]}"

# KIE remains a per-job external API. Only its credential file is materialized
# at boot; no KIE request is made until a workflow invokes a KIE node.
KIE_DIR="${COMFYUI_DIR}/custom_nodes/ComfyUI-Kie-API"
if [ -n "${KIE_API_KEY:-}" ]; then
    mkdir -p "${KIE_DIR}/config"
    printf '%s' "${KIE_API_KEY}" > "${KIE_DIR}/config/kie_key.txt"
    chmod 600 "${KIE_DIR}/config/kie_key.txt"
fi

mkdir -p "${COMFYUI_DIR}/input" "${COMFYUI_DIR}/output" \
    "${COMFYUI_DIR}/temp" "${COMFYUI_DIR}/user"

cd "${COMFYUI_DIR}"
COMFYUI_LOG="/tmp/comfyui_output.log"
: > "${COMFYUI_LOG}"
python3 main.py \
    --listen "${COMFYUI_LISTEN:-0.0.0.0}" \
    --port 8188 \
    --input-directory "${COMFYUI_DIR}/input" \
    --output-directory "${COMFYUI_DIR}/output" \
    --temp-directory "${COMFYUI_DIR}/temp" \
    --user-directory "${COMFYUI_DIR}/user" \
    --disable-auto-launch \
    --disable-metadata > >(tee -a "${COMFYUI_LOG}") 2>&1 &
COMFYUI_PID=$!
trap 'kill "${COMFYUI_PID}" 2>/dev/null || true' EXIT

COMFYUI_PID="${COMFYUI_PID}" python3 - <<'PY'
import os
import time
import urllib.request

pid = int(os.environ["COMFYUI_PID"])
deadline = time.monotonic() + 600
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2):
            break
    except Exception:
        try:
            os.kill(pid, 0)
        except OSError as error:
            raise SystemExit(f"ERROR: ComfyUI exited during startup: {error}")
        time.sleep(1)
else:
    raise SystemExit("ERROR: ComfyUI startup timed out")
PY

echo ">>> ComfyUI ready; validating registered workflow nodes"
python3 /workspace/runtime_preflight.py \
    --object-info-url http://127.0.0.1:8188/object_info

echo ">>> Starting RunPod serverless handler"
cd /workspace
python3 handler.py
