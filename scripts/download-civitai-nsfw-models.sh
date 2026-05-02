#!/usr/bin/env bash
# Download NSFW Civitai weights into a local ComfyUI tree.
#
# Why your wget failed:
#   • civitai.red is NOT the official API host — it often 404s. Use civitai.com.
#   • Typos break the query string: use size=full (not "si# ze=full").
#   • Civitai returns 302 → S3 presigned URLs — wget must follow redirects (default).
#
# Setup:
#   export CIVITAI_API_TOKEN="..."   # https://civitai.com/user/account → API Keys
#   Optional: export COMFY_MODELS_DIR="/workspace/ComfyUI/models"
#
# If you still get 404:
#   Open the model on civitai.com → “Versions” → file you want → copy the numeric
#   modelVersionId from the URL (?modelVersionId=…) and replace ZIT_VERSION / PW_VERSION below.

set -euo pipefail

CIVITAI_API_TOKEN="${CIVITAI_API_TOKEN:-${CIVITAI_TOKEN:-}}"
if [[ -z "${CIVITAI_API_TOKEN}" ]]; then
  echo "ERROR: Set CIVITAI_API_TOKEN (Civitai account → API Keys)." >&2
  exit 1
fi

COMFY="${COMFY_MODELS_DIR:-./ComfyUI/models}"
mkdir -p "${COMFY}/diffusion_models" "${COMFY}/checkpoints"

# Confirm these on the model page if download fails (creators re-publish versions).
ZIT_VERSION="${ZIT_VERSION:-2682644}"
PW_VERSION="${PW_VERSION:-2114370}"

UA="Mozilla/5.0 (compatible; ModelClone-ComfyUI/1.0)"
AUTH="Authorization: Bearer ${CIVITAI_API_TOKEN}"

dl() {
  local out="$1"
  local url="$2"
  echo ">>> Downloading → ${out}"
  wget \
    --continue \
    --max-redirect=50 \
    --user-agent="${UA}" \
    --header="${AUTH}" \
    -O "${out}.partial" \
    "${url}"
  mv -f "${out}.partial" "${out}"
  echo "    OK: $(du -h "${out}" | cut -f1)"
}

# Z-Image Turbo NSFW (BF16 AIO) — UNET / diffusion_models slot (your layout)
dl "${COMFY}/diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors" \
  "https://civitai.com/api/download/models/${ZIT_VERSION}?type=Model&format=SafeTensor&size=full&fp=bf16"

# Pornworks Real Porn Illustrious — checkpoint
dl "${COMFY}/checkpoints/pornworksRealPorn_Illustrious_v4_04.safetensors" \
  "https://civitai.com/api/download/models/${PW_VERSION}?type=Model&format=SafeTensor&size=full&fp=fp16"

echo "All downloads finished."
