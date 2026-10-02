#!/bin/bash
set -euo pipefail

RUNTIME_DIR="${MDCLN_RUNTIME_DIR:?Set MDCLN_RUNTIME_DIR to a sealed runtime under /runpod-volume/mdcln-runtime}"
STATE_DIR="${MDCLN_RUNTIME_STATE_DIR:-/workspace/mdcln-state}"

if [ ! -f "${RUNTIME_DIR}/READY" ] || [ -e "${RUNTIME_DIR}/BUILDING" ]; then
    echo "ERROR: runtime is not READY: ${RUNTIME_DIR}" >&2
    exit 1
fi
for required in \
    "${RUNTIME_DIR}/venv/bin/python3" \
    "${RUNTIME_DIR}/venv/pyvenv.cfg" \
    "${RUNTIME_DIR}/ComfyUI/main.py" \
    "${RUNTIME_DIR}/handler.py" \
    "${RUNTIME_DIR}/runtime_preflight.py" \
    "${RUNTIME_DIR}/start.sh" \
    "${RUNTIME_DIR}/CRITICAL_SHA256SUMS"; do
    if [ ! -e "${required}" ]; then
        echo "ERROR: sealed runtime file missing: ${required}" >&2
        exit 1
    fi
done

if [ "$(readlink -f "${RUNTIME_DIR}/venv/bin/python3")" != "/usr/bin/python3.12" ]; then
    echo "ERROR: sealed runtime venv does not target /usr/bin/python3.12" >&2
    exit 1
fi
if ! grep -Eq '^include-system-site-packages = false$' \
    "${RUNTIME_DIR}/venv/pyvenv.cfg"; then
    echo "ERROR: sealed runtime venv unexpectedly inherits system packages" >&2
    exit 1
fi

(
    cd "${RUNTIME_DIR}"
    sha256sum --check --status CRITICAL_SHA256SUMS
) || {
    echo "ERROR: sealed runtime critical-file checksum failed" >&2
    exit 1
}

mkdir -p "${STATE_DIR}/input" "${STATE_DIR}/output" "${STATE_DIR}/temp" \
    "${STATE_DIR}/user" "${STATE_DIR}/kie-config" "${STATE_DIR}/glif-cache"

link_workspace_path() {
    local destination="$1"
    local source="$2"
    if [ -L "${destination}" ]; then
        if [ "$(readlink "${destination}")" = "${source}" ]; then
            return 0
        fi
        unlink "${destination}"
    elif [ -e "${destination}" ]; then
        echo "ERROR: refusing to replace non-symlink workspace path: ${destination}" >&2
        exit 1
    fi
    ln -s "${source}" "${destination}"
}

link_workspace_path /workspace/ComfyUI "${RUNTIME_DIR}/ComfyUI"
link_workspace_path /workspace/handler.py "${RUNTIME_DIR}/handler.py"
link_workspace_path /workspace/runtime_preflight.py "${RUNTIME_DIR}/runtime_preflight.py"

NATIVE_ROOT="${RUNTIME_DIR}/native/rootfs"
NATIVE_LIB_DIRS=(
    "${NATIVE_ROOT}/usr/lib/x86_64-linux-gnu"
    "${NATIVE_ROOT}/lib/x86_64-linux-gnu"
    "${NATIVE_ROOT}/usr/lib"
    "${NATIVE_ROOT}/lib"
)
native_library_path=""
for directory in "${NATIVE_LIB_DIRS[@]}"; do
    if [ -d "${directory}" ]; then
        native_library_path="${native_library_path:+${native_library_path}:}${directory}"
    fi
done

export PATH="${RUNTIME_DIR}/venv/bin:${NATIVE_ROOT}/usr/bin:${PATH}"
if [ -n "${native_library_path}" ]; then
    export LD_LIBRARY_PATH="${native_library_path}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi
export MDCLN_RUNTIME_STATE_DIR="${STATE_DIR}"
export PYTHONDONTWRITEBYTECODE=1
export PIP_NO_INDEX=1
export PIP_DISABLE_PIP_VERSION_CHECK=1

python3 - <<'PY'
from importlib.metadata import version
import sys

if sys.prefix == sys.base_prefix:
    raise SystemExit("ERROR: sealed runtime virtual environment is not active")
expected = {"torch": "2.8.0", "torchvision": "0.23.0", "torchaudio": "2.8.0"}
for package, wanted in expected.items():
    installed = version(package)
    if installed.split("+")[0] != wanted:
        raise SystemExit(f"ERROR: expected {package} {wanted}, got {installed}")
import torch
if torch.version.cuda != "12.8":
    raise SystemExit(f"ERROR: expected CUDA 12.8 Torch wheel, got {torch.version.cuda}")
PY

if [ -x "${NATIVE_ROOT}/usr/bin/ffmpeg" ]; then
    "${NATIVE_ROOT}/usr/bin/ffmpeg" -version >/dev/null
else
    echo "ERROR: sealed ffmpeg binary missing" >&2
    exit 1
fi

exec "${RUNTIME_DIR}/start.sh"
