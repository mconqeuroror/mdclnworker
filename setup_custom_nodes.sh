#!/bin/bash
set -euo pipefail

CUSTOM_NODES_DIR="${CUSTOM_NODES_DIR:-/workspace/ComfyUI/custom_nodes}"
CUSTOM_NODES_LIST="${CUSTOM_NODES_LIST:-/workspace/custom_nodes.list}"
CUSTOM_NODES_LOCK="${CUSTOM_NODES_LOCK:-/workspace/custom_nodes.lock}"
CUSTOM_NODES_CONSTRAINTS="${CUSTOM_NODES_CONSTRAINTS:-/workspace/python-constraints.txt}"
DA3_PATCHER="${DA3_PATCHER:-/workspace/patch_da3_core.py}"
SUBMODULE_SYNC="${SUBMODULE_SYNC:-/workspace/sync_custom_node_submodules.sh}"
CUSTOM_NODES_REUSE_CHECKOUTS="${CUSTOM_NODES_REUSE_CHECKOUTS:-0}"
mkdir -p "${CUSTOM_NODES_DIR}"

for required in "${CUSTOM_NODES_CONSTRAINTS}" "${DA3_PATCHER}" "${SUBMODULE_SYNC}"; do
    if [ ! -f "${required}" ]; then
        echo "ERROR: required build input missing: ${required}" >&2
        exit 1
    fi
done

constraints="$(mktemp)"
versions_before="$(mktemp)"
da3_requirements=""
essentials_requirements=""
cleanup() {
    rm -f "${constraints}" "${versions_before}" "${constraints}.after"
    if [ -n "${da3_requirements}" ]; then
        rm -f "${da3_requirements}"
    fi
    if [ -n "${essentials_requirements}" ]; then
        rm -f "${essentials_requirements}"
    fi
}
trap cleanup EXIT

# Custom-node requirements must not replace the CUDA-matched packages supplied
# by the RunPod base image. The exact base versions become pip constraints.
python3 - <<'PY' >"${constraints}"
from importlib.metadata import PackageNotFoundError, version

for package in ("torch", "torchvision", "torchaudio"):
    try:
        print(f"{package}=={version(package)}")
    except PackageNotFoundError:
        pass
PY
cp "${constraints}" "${versions_before}"
cat "${CUSTOM_NODES_CONSTRAINTS}" >> "${constraints}"

clone_repo() {
    local spec="$1"
    local repo="${spec%@*}"
    local ref=""
    if [ "${repo}" != "${spec}" ]; then
        ref="${spec##*@}"
    fi

    local name="${repo##*/}"
    local target="${CUSTOM_NODES_DIR}/${name}"
    rm -rf "${target}"

    for attempt in 1 2 3; do
        if [ -n "${ref}" ]; then
            rm -rf "${target}"
            mkdir -p "${target}"
            if git -C "${target}" init -q \
                && git -C "${target}" remote add origin "https://github.com/${repo}.git" \
                && git -C "${target}" fetch -q --depth 1 origin "${ref}" \
                && git -C "${target}" checkout -q --detach FETCH_HEAD; then
                return 0
            fi
        elif git clone -q --depth 1 "https://github.com/${repo}.git" "${target}"; then
            return 0
        fi
        rm -rf "${target}"
        echo "WARNING: clone failed for ${repo} (attempt ${attempt}/3)" >&2
        sleep 2
    done

    echo "ERROR: required custom node failed to clone: ${repo}" >&2
    return 1
}

if [ "${CUSTOM_NODES_REUSE_CHECKOUTS}" = "1" ]; then
    if [ ! -f "${CUSTOM_NODES_LOCK}" ]; then
        echo "ERROR: checkout reuse requires an existing custom-node lock" >&2
        exit 1
    fi
    expected_count=0
    while IFS= read -r line || [ -n "${line}" ]; do
        spec="${line%%#*}"
        spec="$(printf '%s' "${spec}" | xargs)"
        [ -z "${spec}" ] && continue
        repo="${spec%@*}"
        name="${repo##*/}"
        target="${CUSTOM_NODES_DIR}/${name}"
        expected_count=$((expected_count + 1))
        lock_matches="$(awk -F@ -v repo="${repo}" \
            '$1 == repo && length($2) == 40 && $2 ~ /^[0-9a-f]+$/ { count++ } \
             END { print count + 0 }' \
            "${CUSTOM_NODES_LOCK}")"
        if [ "${lock_matches}" -ne 1 ] || [ ! -d "${target}/.git" ]; then
            echo "ERROR: reusable custom-node checkout or unique lock entry missing: ${repo}" >&2
            exit 1
        fi
        locked_commit="$(awk -F@ -v repo="${repo}" \
            '$1 == repo { print $2 }' "${CUSTOM_NODES_LOCK}")"
        actual_commit="$(git -C "${target}" rev-parse HEAD)"
        if [ "${actual_commit}" != "${locked_commit}" ]; then
            echo "ERROR: reusable custom-node checkout changed: ${repo}" >&2
            exit 1
        fi
        ref=""
        if [ "${repo}" != "${spec}" ]; then
            ref="${spec##*@}"
        fi
        if [[ "${ref}" =~ ^[0-9a-f]{40}$ ]] && [ "${locked_commit}" != "${ref}" ]; then
            echo "ERROR: reusable custom-node lock does not match its pinned ref: ${repo}" >&2
            exit 1
        fi
        # The failed dependency pass may have moved hooks or generated source
        # files. Restore the locked tree before repeating audited installers.
        git -C "${target}" reset --hard -q "${locked_commit}"
        git -C "${target}" clean -ffdq
        "${SUBMODULE_SYNC}" "${target}"
    done < "${CUSTOM_NODES_LIST}"
    lock_count="$(awk -F@ \
        '$1 !~ /^[#[:space:]]/ && length($2) == 40 && $2 ~ /^[0-9a-f]+$/ { count++ } \
         END { print count + 0 }' \
        "${CUSTOM_NODES_LOCK}")"
    if [ "${lock_count}" -ne "${expected_count}" ]; then
        echo "ERROR: custom-node lock contains unexpected or missing entries" >&2
        exit 1
    fi
    echo ">>> Reusing commit-verified custom-node checkouts..."
else
    echo ">>> Cloning required custom nodes at image build time..."
    : > "${CUSTOM_NODES_LOCK}"
    while IFS= read -r line || [ -n "${line}" ]; do
        spec="${line%%#*}"
        spec="$(printf '%s' "${spec}" | xargs)"
        [ -z "${spec}" ] && continue
        clone_repo "${spec}"
        repo="${spec%@*}"
        "${SUBMODULE_SYNC}" "${CUSTOM_NODES_DIR}/${repo##*/}"
        printf '%s@%s\n' "${repo}" "$(git -C "${CUSTOM_NODES_DIR}/${repo##*/}" rev-parse HEAD)" \
            >> "${CUSTOM_NODES_LOCK}"
    done < "${CUSTOM_NODES_LIST}"
fi

# Impact Pack and Impact Subpack otherwise download SAM/YOLO weights from
# their install.py scripts. Models are provisioned on the network volume.
touch "${CUSTOM_NODES_DIR}/skip_download_model"

echo ">>> Installing custom-node Python dependencies at image build time..."
for node_dir in "${CUSTOM_NODES_DIR}"/*/; do
    [ -d "${node_dir}" ] || continue
    node_name="$(basename "${node_dir}")"
    requirements_file="${node_dir}/requirements.txt"

    if [ "${node_name}" = "ComfyUI-DepthAnythingV3" ]; then
        # This pinned DA3 commit's installer asks comfy-env to clone unrelated
        # 3D packs and solve a nested pixi environment. The serving graph only
        # needs DA3's own nodes and Python requirements. Its prestartup hook
        # invokes the same environment manager on every ComfyUI start, so seal
        # both hooks out of the offline runtime while retaining them for audit.
        for hook in install.py prestartup_script.py; do
            if [ -f "${node_dir}/${hook}" ]; then
                mv "${node_dir}/${hook}" "${node_dir}/${hook}.build-disabled"
            fi
        done
        da3_requirements="$(mktemp)"
        grep -Ev '^[[:space:]]*comfy-env([<>=!~].*)?$' \
            "${node_dir}/requirements.txt" > "${da3_requirements}"
        if grep -Eqi '^[[:space:]]*comfy-env' "${da3_requirements}"; then
            echo "ERROR: failed to remove DA3 comfy-env build dependency" >&2
            exit 1
        fi
        requirements_file="${da3_requirements}"
        python3 "${DA3_PATCHER}" "${node_dir}/nodes/__init__.py"
        echo "  sealed DA3 core: skipped comfy-env installer and prestartup hook"
    fi

    if [ "${node_name}" = "ComfyUI_essentials" ]; then
        # pixeloe 1.0.0 publishes a malformed platform_release marker which
        # makes pip parse Linux kernel strings such as 6.8.0-101-generic as a
        # PEP 440 version. PixelOEPixelize imports it lazily; ModelClone's
        # required MaskPreview+ node does not use it.
        pixeloe_count="$(grep -Eic '^[[:space:]]*pixeloe([<>=!~].*)?([[:space:]]*(#.*)?)?$' \
            "${node_dir}/requirements.txt")"
        if [ "${pixeloe_count}" -ne 1 ]; then
            echo "ERROR: audited ComfyUI_essentials pixeloe requirement changed" >&2
            exit 1
        fi
        essentials_requirements="$(mktemp)"
        grep -Eiv '^[[:space:]]*pixeloe([<>=!~].*)?([[:space:]]*(#.*)?)?$' \
            "${node_dir}/requirements.txt" > "${essentials_requirements}"
        if grep -Eqi '^[[:space:]]*pixeloe' "${essentials_requirements}"; then
            echo "ERROR: failed to remove optional malformed pixeloe requirement" >&2
            exit 1
        fi
        requirements_file="${essentials_requirements}"
        echo "  essentials core: skipped optional PixelOEPixelize dependency"
    fi

    if [ -f "${requirements_file}" ]; then
        echo "  requirements: ${node_name}"
        python3 -m pip install --no-cache-dir -c "${constraints}" -r "${requirements_file}"
    fi
    if [ -f "${node_dir}/install.py" ]; then
        echo "  installer: $(basename "${node_dir}")"
        (cd "${node_dir}" && python3 install.py)
    fi
done

# install.py is outside pip's constraint mechanism. Refuse an image whose
# custom-node installers changed the CUDA-matched Torch family.
python3 - <<'PY' >"${constraints}.after"
from importlib.metadata import PackageNotFoundError, version

for package in ("torch", "torchvision", "torchaudio"):
    try:
        print(f"{package}=={version(package)}")
    except PackageNotFoundError:
        pass
PY
if ! cmp -s "${versions_before}" "${constraints}.after"; then
    echo "ERROR: custom-node installation changed a Torch package from the base image" >&2
    diff -u "${versions_before}" "${constraints}.after" >&2 || true
    exit 1
fi
python3 - "${CUSTOM_NODES_CONSTRAINTS}" <<'PY'
from importlib.metadata import version
from pathlib import Path
import sys

for raw in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = raw.split("#", 1)[0].strip()
    if not line:
        continue
    if line.count("==") != 1:
        raise SystemExit(f"ERROR: build constraint must use an exact version: {line}")
    package, expected = line.split("==", 1)
    installed = version(package)
    if installed != expected:
        raise SystemExit(
            f"ERROR: custom-node installation changed {package} from "
            f"{expected} to {installed}"
        )
PY

echo ">>> Custom nodes and dependencies are baked into the image."
