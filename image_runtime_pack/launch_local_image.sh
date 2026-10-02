#!/bin/bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

RUNTIME_DIR="${MDCLN_RUNTIME_DIR:?Set MDCLN_RUNTIME_DIR to a sealed runtime under /runpod-volume/mdcln-runtime}"
STATE_DIR="${MDCLN_RUNTIME_STATE_DIR:-/workspace/mdcln-state}"
ADDON_DIR="${MDCLN_LOCAL_ADDON_DIR:?Authenticated local addon directory required}"
[[ "$ADDON_DIR" =~ ^/workspace/mdcln-local-addon-v1\.[A-Za-z0-9]{8}/addon$ ]]
[ ! -L "$ADDON_DIR" ] && [ -f "$ADDON_DIR/LOCAL_READY.json" ]
if [ ! -f "${ADDON_DIR}/READY" ] || [ ! -f "${ADDON_DIR}/CPU_PREFLIGHT_READY.json" ]; then
    echo "ERROR: thin Python addon has not passed its CPU preflight" >&2
    exit 1
fi
unset PYTHONHOME PYTHONPATH VIRTUAL_ENV

if [ ! -f "${RUNTIME_DIR}/READY" ] || [ -e "${RUNTIME_DIR}/BUILDING" ]; then
    echo "ERROR: runtime is not READY: ${RUNTIME_DIR}" >&2
    exit 1
fi
for required in \
    "${ADDON_DIR}/venv/bin/python3" \
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

if [ "$(readlink -f "${ADDON_DIR}/venv/bin/python3")" != "${ADDON_DIR}/python/bin/python3.12" ]; then
    echo "ERROR: addon venv interpreter changed" >&2
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
mkdir -p /usr/share/fonts
link_workspace_path /usr/share/fonts/truetype "${ADDON_DIR}/native/rootfs/usr/share/fonts/truetype"

NATIVE_ROOT="${RUNTIME_DIR}/native/rootfs"
NATIVE_LIB_DIRS=(
    "${ADDON_DIR}/native/rootfs/usr/lib/x86_64-linux-gnu/pulseaudio"
    "${ADDON_DIR}/native/rootfs/usr/lib/x86_64-linux-gnu/blas"
    "${ADDON_DIR}/native/rootfs/usr/lib/x86_64-linux-gnu/lapack"
    "${ADDON_DIR}/native/rootfs/usr/lib/x86_64-linux-gnu"
    "${ADDON_DIR}/native/rootfs/lib/x86_64-linux-gnu"
    "${ADDON_DIR}/native/rootfs/usr/lib"
    "${ADDON_DIR}/native/rootfs/lib"
    "${NATIVE_ROOT}/usr/lib/x86_64-linux-gnu/pulseaudio"
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

export PATH="${ADDON_DIR}/venv/bin:${ADDON_DIR}/native/rootfs/usr/bin:${ADDON_DIR}/native/rootfs/bin:${NATIVE_ROOT}/usr/bin:${PATH}"
export GIT_EXEC_PATH="${ADDON_DIR}/native/rootfs/usr/lib/git-core"
export GIT_TEMPLATE_DIR="${ADDON_DIR}/native/rootfs/usr/share/git-core/templates"
if [ -n "${native_library_path}" ]; then
    export LD_LIBRARY_PATH="${ADDON_DIR}/python/lib:${native_library_path}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi
export MDCLN_RUNTIME_STATE_DIR="${STATE_DIR}"
export PYTHONDONTWRITEBYTECODE=1
export PIP_NO_INDEX=1
export PIP_DISABLE_PIP_VERSION_CHECK=1

python3 -B - <<'PY'
from importlib.metadata import version
from pathlib import Path
import os,sys,sysconfig
addon=Path(os.environ['MDCLN_LOCAL_ADDON_DIR'])
if sys.version_info[:3] != (3,12,12) or sysconfig.get_config_var('SOABI') != 'cpython-312-x86_64-linux-gnu':
    raise SystemExit('ERROR: local addon Python ABI mismatch')
if Path(sys.prefix) != addon/'venv' or Path(sys.base_prefix) != addon/'python':
    raise SystemExit('ERROR: local addon virtual environment mismatch')
for package,expected in {'torch':'2.8.0+cu128','torchvision':'0.23.0+cu128','torchaudio':'2.8.0+cu128'}.items():
    if version(package) != expected:
        raise SystemExit('ERROR: local addon package metadata mismatch')
print('>>> Local addon ABI and package metadata verified',flush=True)
PY

if [ -x "${NATIVE_ROOT}/usr/bin/ffmpeg" ]; then
    "${NATIVE_ROOT}/usr/bin/ffmpeg" -version >/dev/null
else
    echo "ERROR: sealed ffmpeg binary missing" >&2
    exit 1
fi

if [ "${1:-}" = --prepare-only ]; then
    exit 0
fi
[ "$#" -eq 0 ]
exec "${ADDON_DIR}/start-local.sh"
