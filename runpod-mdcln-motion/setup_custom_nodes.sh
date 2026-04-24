#!/bin/bash
set -e

CUSTOM_NODES_DIR="/workspace/ComfyUI/custom_nodes"
mkdir -p "${CUSTOM_NODES_DIR}"

# Required for the Wan 2.2 Animate motion-control workflow.
REQUIRED_REPOS=(
  "kijai/ComfyUI-WanAnimatePreprocess"
  "kijai/ComfyUI-KJNodes"
  "Kosinkadink/ComfyUI-VideoHelperSuite"
  "rgthree/rgthree-comfy"
  "yolain/ComfyUI-Easy-Use"
  "cubiq/ComfyUI_essentials"
  "pythongosssss/ComfyUI-Custom-Scripts"
)

echo ">>> Installing custom nodes for motion-control worker..."
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
