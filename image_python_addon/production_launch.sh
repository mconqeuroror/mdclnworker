set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
export SSL_CERT_FILE='/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002/venv/lib/python3.12/site-packages/certifi/cacert.pem'
[ -f "$SSL_CERT_FILE" ] && [ ! -L "$SSL_CERT_FILE" ] || { echo "ERROR: sealed TLS CA bundle is not a regular file" >&2; exit 1; }
printf '%s  %s\n' '9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f' "$SSL_CERT_FILE" | sha256sum --check --status || { echo "ERROR: sealed TLS CA bundle checksum failed" >&2; exit 1; }
echo '>>> Sealed TLS CA bundle verified 9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f'
cd '/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211'
printf '%s  %s\n' '0094be811d2d75291e179b06242d6f3dc86b908231e0bebb702dcd5cf588a5e8' launch_image_thin.sh 'bdc51b6bc447cb9fc7444f84c6eb18c284b3d03b1f38f9ffd12f0aac0e1d40fb' ADDON_SHA256SUMS 'e9d9413fbc4dd4c2364940a5133bf933078ce15b37dcc88baf9040a2fc0ed737' ADDON_SYMLINKS.json | sha256sum --check --status
echo '>>> Thin addon build verified bdc51b6bc447cb9fc7444f84c6eb18c284b3d03b1f38f9ffd12f0aac0e1d40fb'
exec env MDCLN_RUNTIME_DIR='/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002' MDCLN_RUNTIME_STATE_DIR='/workspace/mdcln-state' NSFW_COMFY_BYPASS_UPSCALE=0 '/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211/launch_image_thin.sh'