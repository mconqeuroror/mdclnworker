#!/bin/bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
export SSL_CERT_FILE='/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002/venv/lib/python3.12/site-packages/certifi/cacert.pem'
[ -f "$SSL_CERT_FILE" ] && [ ! -L "$SSL_CERT_FILE" ] || { echo "ERROR: sealed TLS CA bundle is not a regular file" >&2; exit 1; }
printf '%s  %s\n' '9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f' "$SSL_CERT_FILE" | sha256sum --check --status || { echo "ERROR: sealed TLS CA bundle checksum failed" >&2; exit 1; }
echo '>>> Sealed TLS CA bundle verified 9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f'
