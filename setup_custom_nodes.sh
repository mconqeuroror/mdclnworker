#!/bin/bash
set -e

CUSTOM_NODES_DIR="/workspace/ComfyUI/custom_nodes"
mkdir -p "${CUSTOM_NODES_DIR}"

# Required node packs for our workflows. If these fail, image build must fail.
REQUIRED_REPOS=(
  "bollerdominik/ComfyUI-load-lora-from-url"
  "Suzie1/ComfyUI_Comfyroll_CustomNodes"
  "chflame163/ComfyUI_LayerStyle_Advance"
  "1038lab/ComfyUI-JoyCaption"
  "Derfuu/Derfuu_ComfyUI_ModdedNodes"
  "crystian/ComfyUI-Crystools"
  "alexopus/ComfyUI-Image-Saver"
  "rgthree/rgthree-comfy"
  "WASasquatch/was-node-suite-comfyui"
  "ssitu/ComfyUI_UltimateSDUpscale"
)

echo ">>> Installing custom nodes..."
while IFS= read -r node || [ -n "$node" ]; do
    node=$(echo "$node" | xargs)
    [ -z "$node" ] && continue
    [ "${node:0:1}" = "#" ] && continue
    
    name=$(basename "$node")
    target="${CUSTOM_NODES_DIR}/$name"
    echo "  Cloning: $node -> $name"
    rm -rf "$target"

    cloned=0
    for attempt in 1 2 3; do
        if git clone --depth 1 "https://github.com/$node" "$target"; then
            cloned=1
            break
        fi
        echo "  WARNING: clone failed for $node (attempt $attempt/3)"
        sleep 2
    done

    if [ "$cloned" -ne 1 ]; then
        is_required=0
        for req in "${REQUIRED_REPOS[@]}"; do
            if [ "$node" = "$req" ]; then
                is_required=1
                break
            fi
        done

        if [ "$is_required" -eq 1 ]; then
            echo "  ERROR: required custom node repo failed to clone: $node"
            exit 1
        fi

        echo "  WARNING: optional repo failed to clone, continuing: $node"
        continue
    fi
done < /workspace/custom_nodes.list

echo ">>> Custom nodes installed!"
