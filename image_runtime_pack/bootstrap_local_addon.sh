#!/bin/bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
unset PYTHONHOME PYTHONPATH VIRTUAL_ENV
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
R=/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002
A=/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211
export SSL_CERT_FILE="${R}/venv/lib/python3.12/site-packages/certifi/cacert.pem"
export REQUESTS_CA_BUNDLE="${SSL_CERT_FILE}"
[ -f "$SSL_CERT_FILE" ] && [ ! -L "$SSL_CERT_FILE" ]
printf '%s  %s\n' \
    9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f "$SSL_CERT_FILE" \
    2d4959e2a5fef58adaddd3eee7d0dedf52be612e76e37c4b2c93fc99641ea35a "$R/FULL_SHA256SUMS" \
    9dc6c09d9d32349ab7e271641c6dc636441c76390b8dbb697504b4ba58ac1e60 "$R/CRITICAL_SHA256SUMS" \
    3008abbb48c1e2b0fa3072ae72334b9b352e1346ea3a20d34126a455f0c7bc66 "$A/python/bin/python3.12" \
    27d0cd20737ea22bf6c978eb4315876f6a8859dd2a0cbd344aa3a4cdfe040ef8 "$A/python/lib/libpython3.12.so.1.0" \
    | sha256sum --check --status
(cd "$R" && sha256sum --check --status CRITICAL_SHA256SUMS)
echo '>>> Sealed TLS CA bundle verified 9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f'

if [ ! -e /workspace ] && [ ! -L /workspace ]; then
    mkdir /workspace
fi
[ -d /workspace ] && [ ! -L /workspace ] || { echo 'ERROR: local workspace is not a real directory' >&2; exit 1; }
[ -f "$A.tar.gz" ] && [ ! -L "$A.tar.gz" ]
instance="$(mktemp -d /workspace/mdcln-local-addon-v1.XXXXXXXX)"
export MDCLN_LOCAL_ADDON_DIR="$instance/addon"
scratch="$(mktemp -d /workspace/.image-addon-archive.XXXXXXXX)"
trap 'rm -f -- "$scratch/addon.tar.gz"; rmdir -- "$scratch"' EXIT
echo ">>> Local addon copy start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
cp --no-dereference -- "$A.tar.gz" "$scratch/addon.tar.gz"
echo ">>> Local addon copy complete $(date -u +%Y-%m-%dT%H:%M:%SZ)"
"$A/python/bin/python3.12" -B -S "$HERE/local_addon.py" "$scratch/addon.tar.gz" "$MDCLN_LOCAL_ADDON_DIR"
echo '>>> Local addon archive verified f450987ebd185afca9218d1062ff1e9bef2fb7f86179c8089840d1eff82311de'
rm -- "$scratch/addon.tar.gz"
rmdir -- "$scratch"
trap - EXIT
if [ "${1:-}" = --prepare-only ]; then
    exec env MDCLN_RUNTIME_DIR="$R" MDCLN_RUNTIME_STATE_DIR=/workspace/mdcln-state \
        NSFW_COMFY_BYPASS_UPSCALE=0 bash "$HERE/launch_local_image.sh" --prepare-only
fi
[ "$#" -eq 0 ]
exec env MDCLN_RUNTIME_DIR="$R" MDCLN_RUNTIME_STATE_DIR=/workspace/mdcln-state \
    NSFW_COMFY_BYPASS_UPSCALE=0 bash "$HERE/launch_local_image.sh"
