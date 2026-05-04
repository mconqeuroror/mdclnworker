#!/usr/bin/env bash
# Run **inside** the RunPod pod that already has the model file (local disk or any path).
# Uploads to your RunPod object-store bucket so the file appears on the network volume
# at models/<...> (same layout as ComfyUI on /runpod-volume/models).
#
# Set credentials from RunPod Storage / S3 (same as aws s3 ls to your bucket):
#   export AWS_ACCESS_KEY_ID=...
#   export AWS_SECRET_ACCESS_KEY=...
#   export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-https://s3api-eu-ro-1.runpod.io}"
#   export AWS_REGION="${AWS_REGION:-eu-ro-1}"
#
# Usage:
#   ./upload-from-pod-to-volume.sh /path/to/zImageTurboNSFW_43BF16AIO.safetensors
#   ./upload-from-pod-to-volume.sh /path/to/file.safetensors mevpt9ccol models/diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors
#
# If this pod already has the **same** network volume mounted at /runpod-volume, you
# do not need S3: use `cp` into /runpod-volume/models/diffusion_models/ and you are done.

set -euo pipefail

SRC="${1:?usage: $0 <local-file> [bucket] [s3-key]}"
BUCKET="${2:-${S3_BUCKET:-mevpt9ccol}}"
KEY="${3:-models/diffusion_models/$(basename "$SRC")}"
ENDPOINT="${AWS_ENDPOINT_URL:-https://s3api-eu-ro-1.runpod.io}"
REGION="${AWS_REGION:-eu-ro-1}"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: not a file: $SRC" >&2
  exit 1
fi
if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "ERROR: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY" >&2
  exit 1
fi

SZ=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC" 2>/dev/null || echo 0)
if [[ "$SZ" -lt 1048576 ]]; then
  echo "WARN: file is very small (${SZ} bytes) — might be a dead symlink or wrong path." >&2
fi

echo ">>> $(basename "$SRC")"
if command -v du >/dev/null 2>&1; then
  echo "    size: $(du -h "$SRC" | cut -f1)"
fi
echo "    -> s3://${BUCKET}/${KEY}"
aws s3 cp "$SRC" "s3://${BUCKET}/${KEY}" --endpoint-url "$ENDPOINT" --region "$REGION"
echo ">>> Done. Next job using that volume should see it under models/..."
