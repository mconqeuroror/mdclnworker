#!/bin/bash
set -euo pipefail

RUNTIME_DIR="${MDCLN_RUNTIME_DIR:?Set MDCLN_RUNTIME_DIR to a sealed runtime under /runpod-volume/mdcln-runtime}"
STATE_DIR="${MDCLN_RUNTIME_STATE_DIR:-/workspace/mdcln-state}"
ADDON_DIR="/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211"
if [ ! -f "${ADDON_DIR}/READY" ] || [ ! -f "${ADDON_DIR}/CPU_PREFLIGHT_READY.json" ]; then
    echo "ERROR: thin Python addon has not passed its CPU preflight" >&2
    exit 1
fi
( cd "${ADDON_DIR}" && sha256sum --check --status ADDON_SHA256SUMS )
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

python3 - <<'PY'
from importlib.metadata import version
import sys
import sysconfig
import hashlib
import json
from pathlib import Path

addon = Path("/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211")
proof = json.loads((addon / "CPU_PREFLIGHT_READY.json").read_text())
import os
expected_links = json.loads((addon / "ADDON_SYMLINKS.json").read_text())
actual_links = []
for parent, dirs, files in os.walk(addon, followlinks=False):
    for name in dirs + files:
        item = Path(parent) / name
        if item.is_symlink():
            actual_links.append({"path": str(item.relative_to(addon)), "target": os.readlink(item)})
if sorted(actual_links, key=lambda row: row["path"]) != expected_links:
    raise SystemExit("ERROR: addon symlink closure changed")
if proof.get("addonSymlinkManifestSha256") != hashlib.sha256((addon / "ADDON_SYMLINKS.json").read_bytes()).hexdigest():
    raise SystemExit("ERROR: addon symlink manifest proof mismatch")
expected_proof = {
    "state": "READY",
    "baseImage": "ubuntu:22.04@sha256:08ea48a03a3e78ebc7cd526e6a275053223aadd88bfc09cc49b06d5281525fde",
    "runtimeId": "mdcln-v0172-torch28-v2-20261002",
    "archiveSha256": "1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c",
    "fullManifestSha256": "2d4959e2a5fef58adaddd3eee7d0dedf52be612e76e37c4b2c93fc99641ea35a",
    "criticalManifestSha256": "9dc6c09d9d32349ab7e271641c6dc636441c76390b8dbb697504b4ba58ac1e60",
    "interpreterNativeChecksPassed": True,
    "cpuNodeRegistrationPassed": True,
}
if any(proof.get(key) != value for key, value in expected_proof.items()):
    raise SystemExit("ERROR: thin addon CPU proof mismatch")
if proof.get("addonManifestSha256") != hashlib.sha256((addon / "ADDON_SHA256SUMS").read_bytes()).hexdigest():
    raise SystemExit("ERROR: thin addon manifest proof mismatch")
if sys.version_info[:3] != (3, 12, 12) or sysconfig.get_config_var("SOABI") != "cpython-312-x86_64-linux-gnu":
    raise SystemExit("ERROR: addon Python ABI mismatch")
if Path(sys.prefix) != addon / "venv" or Path(sys.base_prefix) != addon / "python":
    raise SystemExit("ERROR: addon virtual environment mismatch")

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
