#!/usr/bin/env bash
# Windows: run from Git Bash or WSL (needs curl + aws CLI).
#
# Presets:
#   civit-43     — same file as worker start.sh (needs CIVITAI_API_TOKEN), key .../zImageTurboNSFW_43BF16AIO.safetensors
#   hf-tewea-v1 / hf-tewea-v2 — public Hugging Face NSFW turbo (~12GB); different filename, no Civitai
#
# Needs: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# Civitai preset also needs: CIVITAI_API_TOKEN
# Optional: HF_TOKEN if you use a gated Hugging Face file
#
# Examples:
#   export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
#   ./mirror-to-runpod-volume.sh hf-tewea-v2 mevpt9ccol
#   export CIVITAI_API_TOKEN=...
#   ./mirror-to-runpod-volume.sh civit-43 mevpt9ccol
#
# Env overrides:
#   S3_BUCKET, AWS_ENDPOINT_URL, AWS_REGION, S3_KEY (destination key inside bucket)

set -euo pipefail

PRESET="${1:-hf-tewea-v2}"
BUCKET="${2:-${S3_BUCKET:-mevpt9ccol}}"
ENDPOINT="${AWS_ENDPOINT_URL:-https://s3api-eu-ro-1.runpod.io}"
REGION="${AWS_REGION:-eu-ro-1}"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "ERROR: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY" >&2
  exit 1
fi

run_stream() {
  local url="$1"
  local s3key="$2"
  shift 2
  echo ">>> Streaming → s3://${BUCKET}/${s3key}"
  echo "    From: $url"
  # shellcheck disable=SC2086
  curl -fSL --retry 20 --retry-delay 10 --connect-timeout 30 \
    --max-redirs 50 \
    -A "ModelClone-mirror/1.0" \
    "$@" \
    "$url" | aws s3 cp - "s3://${BUCKET}/${s3key}" --endpoint-url "$ENDPOINT" --region "$REGION"
  echo ">>> Done."
}

case "$PRESET" in
  civit-43|43|civit)
    if [[ -z "${CIVITAI_API_TOKEN:-}" ]]; then
      echo "ERROR: civit preset needs CIVITAI_API_TOKEN" >&2
      exit 1
    fi
    URL="https://civitai.com/api/download/models/2682644?type=Model&format=SafeTensor&size=pruned&fp=fp16"
    KEY="${S3_KEY:-models/diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors}"
    run_stream "$URL" "$KEY" -H "Authorization: Bearer ${CIVITAI_API_TOKEN}"
    ;;
  hf-tewea-v1|tewea-v1)
    URL="https://huggingface.co/tewea/z_image_turbo_bf16_nsfw/resolve/main/z_image_turbo_bf16_nsfw.safetensors"
    KEY="${S3_KEY:-models/diffusion_models/z_image_turbo_bf16_nsfw.safetensors}"
    EXTRA=()
    [[ -n "${HF_TOKEN:-}" ]] && EXTRA=(-H "Authorization: Bearer ${HF_TOKEN}")
    run_stream "$URL" "$KEY" "${EXTRA[@]}"
    ;;
  hf-tewea-v2|tewea-v2)
    URL="https://huggingface.co/tewea/z_image_turbo_bf16_nsfw/resolve/main/z_image_turbo_bf16_nsfw_v2.safetensors"
    KEY="${S3_KEY:-models/diffusion_models/z_image_turbo_bf16_nsfw_v2.safetensors}"
    EXTRA=()
    [[ -n "${HF_TOKEN:-}" ]] && EXTRA=(-H "Authorization: Bearer ${HF_TOKEN}")
    run_stream "$URL" "$KEY" "${EXTRA[@]}"
    ;;
  custom)
    URL="${MIRROR_URL:-}"
    KEY="${S3_KEY:-}"
    if [[ -z "$URL" || -z "$KEY" ]]; then
      echo "ERROR: custom preset needs MIRROR_URL and S3_KEY" >&2
      exit 1
    fi
    EXTRA=()
    [[ -n "${HF_TOKEN:-}" ]] && EXTRA=(-H "Authorization: Bearer ${HF_TOKEN}")
    [[ -n "${HTTP_AUTH_HEADER:-}" ]] && EXTRA+=(-H "${HTTP_AUTH_HEADER}")
    run_stream "$URL" "$KEY" "${EXTRA[@]}"
    ;;
  *)
    echo "Unknown preset: $PRESET (use: civit-43 | hf-tewea-v1 | hf-tewea-v2 | custom)" >&2
    exit 1
    ;;
esac
