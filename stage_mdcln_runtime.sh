#!/bin/bash
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
VOLUME_ROOT="${VOLUME_ROOT:-/runpod-volume}"
RUNTIME_ROOT="${RUNTIME_ROOT:-${VOLUME_ROOT}/mdcln-runtime}"
BASE_IMAGE_REF="${BASE_IMAGE_REF:-runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2204}"
BASE_IMAGE_DIGEST="${BASE_IMAGE_DIGEST:-sha256:701a9d326604252fdd7d9ae4eb898c4d8f81c888641ef01f25219816ecd21e8d}"
BUILDER_PYTHON="${BUILDER_PYTHON:-/usr/bin/python3.12}"
COMFY_REF="${COMFY_REF:-v0.17.2}"
REGISTRATION_PORT="${REGISTRATION_PORT:-18188}"
STATE_DIR="${MDCLN_RUNTIME_STATE_DIR:-/workspace/mdcln-state}"
RESUME_FAILED_RUNTIME="${RESUME_FAILED_RUNTIME:-0}"
REQUESTED_RUNTIME_ID="${RUNTIME_ID:-}"

SOURCE_FILES=(
    handler.py
    patch_comfy_sdxl_pooled.py
    patch_da3_core.py
    loopback_socket_guard.py
    sync_custom_node_submodules.sh
    python-constraints.txt
    custom_nodes.list
    setup_custom_nodes.sh
    runtime_preflight.py
    start.sh
    launch_mdcln_runtime.sh
    stage_mdcln_runtime.sh
)
for relative in "${SOURCE_FILES[@]}"; do
    if [ ! -f "${SOURCE_DIR}/${relative}" ]; then
        echo "ERROR: source file missing: ${SOURCE_DIR}/${relative}" >&2
        exit 1
    fi
done
for command in apt-get dpkg-deb flock git sha256sum; do
    command -v "${command}" >/dev/null || {
        echo "ERROR: required builder command missing: ${command}" >&2
        exit 1
    }
done
if [ ! -x "${BUILDER_PYTHON}" ]; then
    echo "ERROR: same-base Python 3.12 interpreter missing: ${BUILDER_PYTHON}" >&2
    exit 1
fi
if [ ! -d "${VOLUME_ROOT}" ]; then
    echo "ERROR: network volume is not mounted: ${VOLUME_ROOT}" >&2
    exit 1
fi

mkdir -p "${RUNTIME_ROOT}"
exec 9>"${RUNTIME_ROOT}/.stage.lock"
flock -n 9 || {
    echo "ERROR: another mdcln runtime staging process holds ${RUNTIME_ROOT}/.stage.lock" >&2
    exit 1
}

# Freeze the small uploaded source bundle before deriving its identity. The
# digest includes relative names and file bytes, never the caller's absolute
# SOURCE_DIR, and every later source read uses this immutable snapshot.
SOURCE_SNAPSHOT_TMP="$(mktemp -d "${RUNTIME_ROOT}/.source-snapshot.XXXXXX")"
cleanup_source_snapshot() {
    if [ -n "${SOURCE_SNAPSHOT_TMP:-}" ] && [ -d "${SOURCE_SNAPSHOT_TMP}" ]; then
        rm -rf -- "${SOURCE_SNAPSHOT_TMP}"
    fi
}
trap cleanup_source_snapshot EXIT INT TERM
for relative in "${SOURCE_FILES[@]}"; do
    mkdir -p "${SOURCE_SNAPSHOT_TMP}/$(dirname "${relative}")"
    cp -- "${SOURCE_DIR}/${relative}" "${SOURCE_SNAPSHOT_TMP}/${relative}"
done
chmod -R a-w "${SOURCE_SNAPSHOT_TMP}"
source_tree_sha="$("${BUILDER_PYTHON}" - "${SOURCE_SNAPSHOT_TMP}" "${SOURCE_FILES[@]}" <<'PY'
import hashlib
from pathlib import Path
import struct
import sys

root = Path(sys.argv[1])
digest = hashlib.sha256()
for relative in sys.argv[2:]:
    name = relative.encode("utf-8")
    data = (root / relative).read_bytes()
    digest.update(struct.pack(">I", len(name)))
    digest.update(name)
    digest.update(struct.pack(">Q", len(data)))
    digest.update(data)
print(digest.hexdigest())
PY
)"
if [ "${RESUME_FAILED_RUNTIME}" = "1" ] && [ -z "${REQUESTED_RUNTIME_ID}" ]; then
    echo "ERROR: failed-runtime resume requires an explicit RUNTIME_ID" >&2
    exit 1
fi
if [ -z "${RUNTIME_ID:-}" ]; then
    RUNTIME_ID="mdcln-v0172-${source_tree_sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
fi
if [[ ! "${RUNTIME_ID}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "ERROR: RUNTIME_ID may contain only letters, digits, dot, underscore, and dash" >&2
    exit 1
fi

RUNTIME_DIR="${RUNTIME_ROOT}/${RUNTIME_ID}"
resume_mode=0
resume_phase=""
if [ -e "${RUNTIME_DIR}" ]; then
    if [ "${RESUME_FAILED_RUNTIME}" != "1" ]; then
        echo "ERROR: runtime path already exists; choose a new RUNTIME_ID: ${RUNTIME_DIR}" >&2
        exit 1
    fi
    if [ -L "${RUNTIME_DIR}" ] || [ ! -d "${RUNTIME_DIR}" ] \
        || [ ! -f "${RUNTIME_DIR}/FAILED" ] || [ -L "${RUNTIME_DIR}/FAILED" ] \
        || [ -e "${RUNTIME_DIR}/READY" ] \
        || [ -e "${RUNTIME_DIR}/BUILDING" ] \
        || [ -e "${RUNTIME_DIR}/CRITICAL_SHA256SUMS" ] \
        || [ -e "${RUNTIME_DIR}/FULL_SHA256SUMS" ]; then
        echo "ERROR: resume target is not a failed, unsealed regular runtime directory" >&2
        exit 1
    fi
    resume_required=(
        venv/bin/python3
        venv/pyvenv.cfg
        ComfyUI/main.py
        ComfyUI/custom_nodes/ComfyUI-DepthAnythingV3/nodes/__init__.py
        custom_nodes.lock
        comfy.commit
        torch-constraints.txt
        native/rootfs/usr/bin/ffmpeg
        model-tree.initial
    )
    for relative in "${resume_required[@]}"; do
        if [ ! -e "${RUNTIME_DIR}/${relative}" ]; then
            echo "ERROR: failed runtime is not repairable; missing ${relative}" >&2
            exit 1
        fi
    done
    if [ ! -d "${RUNTIME_DIR}/source" ] || [ -L "${RUNTIME_DIR}/source" ]; then
        echo "ERROR: failed runtime source snapshot is missing or unsafe" >&2
        exit 1
    fi
    failed_runtime_id="$(sed -n 's/^runtime_id=//p' "${RUNTIME_DIR}/FAILED")"
    if [ -n "${failed_runtime_id}" ] && [ "${failed_runtime_id}" != "${RUNTIME_ID}" ]; then
        echo "ERROR: FAILED marker runtime identity does not match RUNTIME_ID" >&2
        exit 1
    fi
    if [ "$(readlink -f "${RUNTIME_DIR}/venv/bin/python3")" != "/usr/bin/python3.12" ] \
        || ! grep -Eq '^include-system-site-packages = false$' \
            "${RUNTIME_DIR}/venv/pyvenv.cfg"; then
        echo "ERROR: failed runtime venv does not match the sealed Python 3.12 contract" >&2
        exit 1
    fi
    if [ "$(git -C "${RUNTIME_DIR}/ComfyUI" rev-parse HEAD)" \
        != "$(cat "${RUNTIME_DIR}/comfy.commit")" ]; then
        echo "ERROR: failed runtime ComfyUI checkout identity changed" >&2
        exit 1
    fi
    if ! grep -Fxq \
        'PozzettiAndrea/ComfyUI-DepthAnythingV3@1933032d921fd19af0e16b39f94c9346f90205fe' \
        "${RUNTIME_DIR}/custom_nodes.lock"; then
        echo "ERROR: failed runtime does not contain the audited DA3 checkout" >&2
        exit 1
    fi
    registration_artifacts=(
        handler.py
        runtime_preflight.py
        start.sh
        launch_mdcln_runtime.sh
        model-tree.prepared
        registration.log
    )
    registration_artifact_count=0
    for relative in "${registration_artifacts[@]}"; do
        if [ -e "${RUNTIME_DIR}/${relative}" ]; then
            registration_artifact_count=$((registration_artifact_count + 1))
        fi
    done
    if [ "${registration_artifact_count}" -eq 0 ]; then
        resume_phase="dependencies"
    elif [ "${registration_artifact_count}" -eq "${#registration_artifacts[@]}" ]; then
        resume_phase="registration"
    else
        echo "ERROR: failed runtime has a partial registration state and cannot be resumed" >&2
        exit 1
    fi
    if [ -e "${RUNTIME_DIR}/.source.previous" ]; then
        echo "ERROR: previous resume did not finish replacing its source snapshot" >&2
        exit 1
    fi
    mv "${RUNTIME_DIR}/source" "${RUNTIME_DIR}/.source.previous"
    mv "${SOURCE_SNAPSHOT_TMP}" "${RUNTIME_DIR}/source"
    SOURCE_SNAPSHOT_TMP=""
    rm -rf -- "${RUNTIME_DIR}/.source.previous"
    SOURCE_DIR="${RUNTIME_DIR}/source"
    printf '%s\n' "runtime_id=${RUNTIME_ID}" "source_tree_sha256=${source_tree_sha}" \
        "base_image=${BASE_IMAGE_REF}@${BASE_IMAGE_DIGEST}" \
        "resume=failed-runtime:${resume_phase}" \
        > "${RUNTIME_DIR}/.BUILDING.tmp"
    mv "${RUNTIME_DIR}/.BUILDING.tmp" "${RUNTIME_DIR}/BUILDING"
    unlink "${RUNTIME_DIR}/FAILED"
    resume_mode=1
else
    if [ "${RESUME_FAILED_RUNTIME}" = "1" ]; then
        echo "ERROR: resume target does not exist: ${RUNTIME_DIR}" >&2
        exit 1
    fi
    mkdir -p "${RUNTIME_DIR}"
    mv "${SOURCE_SNAPSHOT_TMP}" "${RUNTIME_DIR}/source"
    SOURCE_SNAPSHOT_TMP=""
    SOURCE_DIR="${RUNTIME_DIR}/source"
    printf '%s\n' "runtime_id=${RUNTIME_ID}" "source_tree_sha256=${source_tree_sha}" \
        "base_image=${BASE_IMAGE_REF}@${BASE_IMAGE_DIGEST}" > "${RUNTIME_DIR}/.BUILDING.tmp"
    mv "${RUNTIME_DIR}/.BUILDING.tmp" "${RUNTIME_DIR}/BUILDING"
fi
trap - EXIT INT TERM

COMFYUI_PID=""
mark_failed() {
    local status="$1"
    trap - EXIT INT TERM
    if [ -n "${COMFYUI_PID}" ]; then
        kill "${COMFYUI_PID}" 2>/dev/null || true
        wait "${COMFYUI_PID}" 2>/dev/null || true
    fi
    if [ "${status}" -ne 0 ] && [ -f "${RUNTIME_DIR}/BUILDING" ]; then
        printf 'failed_at=%s\nexit_code=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${status}" \
            > "${RUNTIME_DIR}/.FAILED.tmp"
        cat "${RUNTIME_DIR}/BUILDING" >> "${RUNTIME_DIR}/.FAILED.tmp"
        mv "${RUNTIME_DIR}/.FAILED.tmp" "${RUNTIME_DIR}/FAILED"
        unlink "${RUNTIME_DIR}/BUILDING"
    fi
    exit "${status}"
}
trap 'mark_failed $?' EXIT
trap 'mark_failed 130' INT
trap 'mark_failed 143' TERM

snapshot_model_tree() {
    local output="$1"
    VOLUME_MODELS="${VOLUME_ROOT}/models" "${BUILDER_PYTHON}" - > "${output}" <<'PY'
import os
from pathlib import Path

root = Path(os.environ["VOLUME_MODELS"])
if not root.is_dir():
    raise SystemExit(f"ERROR: model volume missing: {root}")
for path in sorted(root.rglob("*")):
    relative = path.relative_to(root)
    stat = path.lstat()
    if path.is_symlink():
        print(f"L\t{relative}\t{os.readlink(path)}\t{stat.st_mtime_ns}\t{stat.st_mode:o}")
    elif path.is_file():
        print(f"F\t{relative}\t{stat.st_size}\t{stat.st_mtime_ns}\t{stat.st_mode:o}")
    elif path.is_dir():
        print(f"D\t{relative}\t{stat.st_mtime_ns}\t{stat.st_mode:o}")
PY
}

# Dependency staging must not touch any existing model-volume entry. A repaired
# runtime starts from the corresponding immutable baseline for its failure phase.
if [ "${resume_mode}" -eq 1 ]; then
    snapshot_model_tree "${RUNTIME_DIR}/model-tree.resume-start"
    resume_model_baseline="${RUNTIME_DIR}/model-tree.initial"
    if [ "${resume_phase}" = "registration" ]; then
        resume_model_baseline="${RUNTIME_DIR}/model-tree.prepared"
    fi
    if ! cmp -s "${resume_model_baseline}" \
        "${RUNTIME_DIR}/model-tree.resume-start"; then
        echo "ERROR: model tree changed after the failed ${resume_phase} attempt" >&2
        exit 1
    fi
else
    snapshot_model_tree "${RUNTIME_DIR}/model-tree.initial"
fi

"${BUILDER_PYTHON}" - <<'PY'
from importlib.metadata import version
import json
import platform
import sys
import torch

if sys.version_info[:2] != (3, 12):
    raise SystemExit(f"ERROR: builder must use Python 3.12, got {sys.version}")
if version("torch") != "2.6.0+cu126" or torch.version.cuda != "12.6":
    raise SystemExit(
        "ERROR: builder does not match the pinned base fingerprint: "
        f"torch={version('torch')} cuda={torch.version.cuda}"
    )
print(
    json.dumps(
        {
            "python": sys.version,
            "platform": platform.platform(),
            "baseTorch": version("torch"),
            "baseTorchCuda": torch.version.cuda,
        },
        sort_keys=True,
    )
)
PY

# Build directly at the final path. A venv contains absolute shebangs and must
# never be renamed after creation. Resume only reuses that same final-path venv.
if [ "${resume_mode}" -eq 0 ]; then
    "${BUILDER_PYTHON}" -m venv "${RUNTIME_DIR}/venv"
fi
export PATH="${RUNTIME_DIR}/venv/bin:${PATH}"
export PYTHONDONTWRITEBYTECODE=1

if [ "${resume_mode}" -eq 0 ]; then
    python3 -m pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cu128 \
        "torch==2.8.0" "torchvision==0.23.0" "torchaudio==2.8.0"
    python3 - <<'PY' > "${RUNTIME_DIR}/torch-constraints.txt"
from importlib.metadata import version

expected = {
    "torch": "2.8.0",
    "torchvision": "0.23.0",
    "torchaudio": "2.8.0",
}
for package, wanted in expected.items():
    installed = version(package)
    if installed.split("+")[0] != wanted:
        raise SystemExit(f"ERROR: expected {package} {wanted}, got {installed}")
    print(f"{package}=={installed}")
import torch
if torch.version.cuda != "12.8":
    raise SystemExit(f"ERROR: expected CUDA 12.8 Torch wheel, got {torch.version.cuda}")
PY

    cp "${SOURCE_DIR}/python-constraints.txt" "${RUNTIME_DIR}/python-constraints.txt"

    # Carry the Dockerfile's native additions as an extracted, volume-local rootfs.
    # The same public base supplies all already-installed dependencies; apt downloads
    # the requested packages and any dependency missing from that base.
    APT_CACHE="${RUNTIME_DIR}/native/apt-cache"
    NATIVE_ROOT="${RUNTIME_DIR}/native/rootfs"
    mkdir -p "${APT_CACHE}/partial" "${NATIVE_ROOT}"
    if [ "${SKIP_APT_UPDATE:-0}" != "1" ]; then
        apt-get update
    fi
    apt-get \
        -o "Dir::Cache::archives=${APT_CACHE}" \
        -o APT::Keep-Downloaded-Packages=true \
        --download-only --reinstall install -y --no-install-recommends \
        ffmpeg libgl1 libglib2.0-0
    shopt -s nullglob
    native_debs=("${APT_CACHE}"/*.deb)
    if [ "${#native_debs[@]}" -eq 0 ]; then
        echo "ERROR: native dependency download produced no packages" >&2
        exit 1
    fi
    for package in "${native_debs[@]}"; do
        dpkg-deb -x "${package}" "${NATIVE_ROOT}"
    done
    shopt -u nullglob
    find "${APT_CACHE}" -type f -delete
else
    cp "${SOURCE_DIR}/python-constraints.txt" "${RUNTIME_DIR}/python-constraints.txt"
fi

NATIVE_ROOT="${RUNTIME_DIR}/native/rootfs"
NATIVE_LIB_PATH="${NATIVE_ROOT}/usr/lib/x86_64-linux-gnu:${NATIVE_ROOT}/lib/x86_64-linux-gnu:${NATIVE_ROOT}/usr/lib:${NATIVE_ROOT}/lib"
export LD_LIBRARY_PATH="${NATIVE_LIB_PATH}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
"${NATIVE_ROOT}/usr/bin/ffmpeg" -version >/dev/null

if [ "${resume_mode}" -eq 0 ]; then
    # Clone and patch the exact ComfyUI line into the sealed runtime.
    git clone --quiet --depth 1 --branch "${COMFY_REF}" \
        https://github.com/comfyanonymous/ComfyUI.git "${RUNTIME_DIR}/ComfyUI"
    git -C "${RUNTIME_DIR}/ComfyUI" rev-parse HEAD > "${RUNTIME_DIR}/comfy.commit"
    # ComfyUI tracks put_*_here placeholders under models. Remove the known clone
    # skeleton before node installers run so the later any-file check is strict.
    find "${RUNTIME_DIR}/ComfyUI/models" -mindepth 1 -delete
    python3 -m pip install --no-cache-dir \
        -c "${RUNTIME_DIR}/torch-constraints.txt" \
        -c "${RUNTIME_DIR}/python-constraints.txt" \
        -r "${RUNTIME_DIR}/ComfyUI/requirements.txt"
    python3 "${SOURCE_DIR}/patch_comfy_sdxl_pooled.py" \
        "${RUNTIME_DIR}/ComfyUI/comfy/model_base.py"

    cp "${SOURCE_DIR}/custom_nodes.list" "${RUNTIME_DIR}/custom_nodes.list"
    cp "${SOURCE_DIR}/setup_custom_nodes.sh" "${RUNTIME_DIR}/setup_custom_nodes.sh"
    export HF_HUB_OFFLINE=1
    export TRANSFORMERS_OFFLINE=1
    CUSTOM_NODES_DIR="${RUNTIME_DIR}/ComfyUI/custom_nodes" \
    CUSTOM_NODES_LIST="${RUNTIME_DIR}/custom_nodes.list" \
    CUSTOM_NODES_LOCK="${RUNTIME_DIR}/custom_nodes.lock" \
    CUSTOM_NODES_CONSTRAINTS="${RUNTIME_DIR}/python-constraints.txt" \
    SUBMODULE_SYNC="${SOURCE_DIR}/sync_custom_node_submodules.sh" \
    DA3_PATCHER="${SOURCE_DIR}/patch_da3_core.py" \
        "${RUNTIME_DIR}/setup_custom_nodes.sh"
    unset HF_HUB_OFFLINE TRANSFORMERS_OFFLINE

    # Install the tested handler SDK after node dependencies.
    python3 -m pip install --no-cache-dir \
        -c "${RUNTIME_DIR}/torch-constraints.txt" \
        -c "${RUNTIME_DIR}/python-constraints.txt" \
        "runpod==1.8.2" requests
elif [ "${resume_phase}" = "dependencies" ]; then
    # Reuse only checkouts whose current commits exactly match the saved lock.
    # Requirements and installers are repeated, then all common final gates run.
    cp "${SOURCE_DIR}/custom_nodes.list" "${RUNTIME_DIR}/custom_nodes.list"
    cp "${SOURCE_DIR}/setup_custom_nodes.sh" "${RUNTIME_DIR}/setup_custom_nodes.sh"
    export HF_HUB_OFFLINE=1
    export TRANSFORMERS_OFFLINE=1
    CUSTOM_NODES_DIR="${RUNTIME_DIR}/ComfyUI/custom_nodes" \
    CUSTOM_NODES_LIST="${RUNTIME_DIR}/custom_nodes.list" \
    CUSTOM_NODES_LOCK="${RUNTIME_DIR}/custom_nodes.lock" \
    CUSTOM_NODES_CONSTRAINTS="${RUNTIME_DIR}/python-constraints.txt" \
    CUSTOM_NODES_REUSE_CHECKOUTS=1 \
    SUBMODULE_SYNC="${SOURCE_DIR}/sync_custom_node_submodules.sh" \
    DA3_PATCHER="${SOURCE_DIR}/patch_da3_core.py" \
        "${RUNTIME_DIR}/setup_custom_nodes.sh"
    unset HF_HUB_OFFLINE TRANSFORMERS_OFFLINE
    python3 -m pip install --no-cache-dir \
        -c "${RUNTIME_DIR}/torch-constraints.txt" \
        -c "${RUNTIME_DIR}/python-constraints.txt" \
        "runpod==1.8.2" requests
else
    # Populate gitlink-pinned custom-node submodules missed by an earlier
    # shallow clone, then repair the audited DA3 registry and shared pins.
    while IFS= read -r line || [ -n "${line}" ]; do
        spec="${line%%#*}"
        spec="$(printf '%s' "${spec}" | xargs)"
        [ -z "${spec}" ] && continue
        repo="${spec%@*}"
        "${SOURCE_DIR}/sync_custom_node_submodules.sh" \
            "${RUNTIME_DIR}/ComfyUI/custom_nodes/${repo##*/}"
    done < "${RUNTIME_DIR}/custom_nodes.list"
    python3 "${SOURCE_DIR}/patch_da3_core.py" \
        "${RUNTIME_DIR}/ComfyUI/custom_nodes/ComfyUI-DepthAnythingV3/nodes/__init__.py"
    python3 -m pip install --no-cache-dir \
        -c "${RUNTIME_DIR}/torch-constraints.txt" \
        -c "${RUNTIME_DIR}/python-constraints.txt" \
        "huggingface-hub==1.33.0" "transformers==5.18.0"
fi

# Every path, including resume, must pass the complete dependency/version gate.
python3 -m pip check
python3 - <<'PY'
from importlib.metadata import version
expected = {
    "torch": "2.8.0",
    "torchvision": "0.23.0",
    "torchaudio": "2.8.0",
    "huggingface-hub": "1.33.0",
    "transformers": "5.18.0",
    "runpod": "1.8.2",
}
for package, wanted in expected.items():
    installed = version(package)
    print(f"{package}=={installed}")
    if installed.split("+")[0] != wanted:
        raise SystemExit(f"ERROR: dependency install changed {package} to {installed}")
import torch
if torch.version.cuda != "12.8":
    raise SystemExit(f"ERROR: dependency install changed Torch CUDA to {torch.version.cuda}")
PY

cp "${SOURCE_DIR}/handler.py" "${RUNTIME_DIR}/handler.py"
cp "${SOURCE_DIR}/runtime_preflight.py" "${RUNTIME_DIR}/runtime_preflight.py"
cp "${SOURCE_DIR}/start.sh" "${RUNTIME_DIR}/start.sh"
cp "${SOURCE_DIR}/launch_mdcln_runtime.sh" "${RUNTIME_DIR}/launch_mdcln_runtime.sh"
cp "${SOURCE_DIR}/patch_da3_core.py" "${RUNTIME_DIR}/patch_da3_core.py"
cp "${SOURCE_DIR}/loopback_socket_guard.py" "${RUNTIME_DIR}/loopback_socket_guard.py"
cp "${SOURCE_DIR}/sync_custom_node_submodules.sh" \
    "${RUNTIME_DIR}/sync_custom_node_submodules.sh"
chmod +x "${RUNTIME_DIR}/start.sh" "${RUNTIME_DIR}/runtime_preflight.py" \
    "${RUNTIME_DIR}/launch_mdcln_runtime.sh" "${RUNTIME_DIR}/patch_da3_core.py" \
    "${RUNTIME_DIR}/loopback_socket_guard.py" \
    "${RUNTIME_DIR}/sync_custom_node_submodules.sh"
python3 -m py_compile "${RUNTIME_DIR}/handler.py" "${RUNTIME_DIR}/runtime_preflight.py" \
    "${RUNTIME_DIR}/patch_da3_core.py" "${RUNTIME_DIR}/loopback_socket_guard.py"

# No model payload may be embedded by a node installer.
if find "${RUNTIME_DIR}/ComfyUI/models" -type f -print -quit | grep -q .; then
    echo "ERROR: node installation placed model files inside the sealed runtime" >&2
    find "${RUNTIME_DIR}/ComfyUI/models" -type f -printf '  %P\n' >&2
    exit 1
fi

snapshot_model_tree "${RUNTIME_DIR}/model-tree.before-prepare"
expected_model_tree="${RUNTIME_DIR}/model-tree.initial"
if [ "${resume_mode}" -eq 1 ]; then
    expected_model_tree="${RUNTIME_DIR}/model-tree.resume-start"
fi
if ! cmp -s "${expected_model_tree}" "${RUNTIME_DIR}/model-tree.before-prepare"; then
    echo "ERROR: dependency staging changed the network-volume model tree" >&2
    diff -u "${expected_model_tree}" \
        "${RUNTIME_DIR}/model-tree.before-prepare" >&2 || true
    exit 1
fi

preflight_args=(
    --prepare
    --models "${VOLUME_ROOT}/models"
    --comfy-root "${RUNTIME_DIR}/ComfyUI"
    --cache-root "${VOLUME_ROOT}/hf_cache"
)
if [ "${NSFW_COMFY_BYPASS_UPSCALE:-0}" = "1" ]; then
    preflight_args+=(--bypass-upscale)
fi
python3 "${RUNTIME_DIR}/runtime_preflight.py" "${preflight_args[@]}"

# Redirect all known mutable code-tree paths outside the sealed runtime.
mkdir -p "${STATE_DIR}/input" "${STATE_DIR}/output" "${STATE_DIR}/temp" \
    "${STATE_DIR}/user" "${STATE_DIR}/kie-config" "${STATE_DIR}/glif-cache"
RUNTIME_DIR="${RUNTIME_DIR}" STATE_DIR="${STATE_DIR}" python3 - <<'PY'
import os
from pathlib import Path
import shutil

runtime = Path(os.environ["RUNTIME_DIR"])
state = Path(os.environ["STATE_DIR"])
links = {
    runtime / "ComfyUI" / "input": state / "input",
    runtime / "ComfyUI" / "output": state / "output",
    runtime / "ComfyUI" / "temp": state / "temp",
    runtime / "ComfyUI" / "user": state / "user",
    runtime / "ComfyUI" / "huggingface_cache": state / "glif-cache",
    runtime / "ComfyUI" / "custom_nodes" / "ComfyUI-Kie-API" / "config": state / "kie-config",
}
for destination, target in links.items():
    target.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        destination.unlink()
    elif destination.is_dir():
        shutil.rmtree(destination)
    elif destination.exists():
        destination.unlink()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.symlink_to(target, target_is_directory=True)
PY

# Alias preparation above is intentional. From this point through registration,
# imports must not alter files, links, or directories in the model tree.
snapshot_model_tree "${RUNTIME_DIR}/model-tree.prepared"

# CPU-only, offline registration proves imports and required node classes work.
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export PIP_NO_INDEX=1
export PIP_DISABLE_PIP_VERSION_CHECK=1
cd "${RUNTIME_DIR}/ComfyUI"
python3 "${RUNTIME_DIR}/loopback_socket_guard.py" main.py \
    --cpu --listen 127.0.0.1 --port "${REGISTRATION_PORT}" \
    --input-directory "${STATE_DIR}/input" \
    --output-directory "${STATE_DIR}/output" \
    --temp-directory "${STATE_DIR}/temp" \
    --user-directory "${STATE_DIR}/user" \
    --disable-auto-launch --disable-metadata \
    > "${RUNTIME_DIR}/registration.log" 2>&1 &
COMFYUI_PID=$!

REGISTRATION_PORT="${REGISTRATION_PORT}" COMFYUI_PID="${COMFYUI_PID}" python3 - <<'PY'
import os
import time
import urllib.request

pid = int(os.environ["COMFYUI_PID"])
url = f"http://127.0.0.1:{os.environ['REGISTRATION_PORT']}/system_stats"
deadline = time.monotonic() + 600
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=2):
            raise SystemExit(0)
    except Exception:
        try:
            os.kill(pid, 0)
        except OSError as error:
            raise SystemExit(f"ERROR: ComfyUI exited during CPU registration: {error}")
        time.sleep(1)
raise SystemExit("ERROR: CPU registration timed out")
PY
python3 "${RUNTIME_DIR}/runtime_preflight.py" \
    --object-info-url "http://127.0.0.1:${REGISTRATION_PORT}/object_info"
kill "${COMFYUI_PID}"
wait "${COMFYUI_PID}" 2>/dev/null || true
COMFYUI_PID=""

snapshot_model_tree "${RUNTIME_DIR}/model-tree.after-registration"
if ! cmp -s "${RUNTIME_DIR}/model-tree.prepared" \
    "${RUNTIME_DIR}/model-tree.after-registration"; then
    echo "ERROR: CPU registration changed the network-volume model tree" >&2
    diff -u "${RUNTIME_DIR}/model-tree.prepared" \
        "${RUNTIME_DIR}/model-tree.after-registration" >&2 || true
    exit 1
fi

unset HF_HUB_OFFLINE TRANSFORMERS_OFFLINE
python3 -m pip freeze --all | LC_ALL=C sort > "${RUNTIME_DIR}/python-packages.lock"
(
    cd "${RUNTIME_DIR}"
    sha256sum handler.py runtime_preflight.py start.sh launch_mdcln_runtime.sh \
        patch_da3_core.py loopback_socket_guard.py sync_custom_node_submodules.sh \
        python-constraints.txt \
        custom_nodes.lock comfy.commit python-packages.lock torch-constraints.txt \
        > CRITICAL_SHA256SUMS
    find . -xdev -type f \
        ! -name BUILDING ! -name READY ! -name FAILED ! -name FULL_SHA256SUMS \
        -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > FULL_SHA256SUMS
)

RUNTIME_DIR="${RUNTIME_DIR}" RUNTIME_ID="${RUNTIME_ID}" SOURCE_TREE_SHA="${source_tree_sha}" \
BASE_IMAGE_REF="${BASE_IMAGE_REF}" BASE_IMAGE_DIGEST="${BASE_IMAGE_DIGEST}" python3 - <<'PY'
import json
import os
from importlib.metadata import version
from pathlib import Path
import sys

runtime = Path(os.environ["RUNTIME_DIR"])
manifest = {
    "runtimeId": os.environ["RUNTIME_ID"],
    "sourceTreeSha256": os.environ["SOURCE_TREE_SHA"],
    "baseImage": f'{os.environ["BASE_IMAGE_REF"]}@{os.environ["BASE_IMAGE_DIGEST"]}',
    "python": sys.version,
    "torch": version("torch"),
    "torchvision": version("torchvision"),
    "torchaudio": version("torchaudio"),
    "comfyCommit": (runtime / "comfy.commit").read_text().strip(),
}
(runtime / ".READY.tmp").write_text(json.dumps(manifest, sort_keys=True) + "\n")
PY
mv "${RUNTIME_DIR}/.READY.tmp" "${RUNTIME_DIR}/READY"
unlink "${RUNTIME_DIR}/BUILDING"
trap - EXIT INT TERM
printf 'READY %s\n' "${RUNTIME_DIR}"
