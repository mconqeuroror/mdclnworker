# ============================================
# ModelClone ComfyUI Worker for RunPod Serverless
# NSFW generation only — no JoyCaption / SeedVR2
# Base image has Python, PyTorch 2.6.0, CUDA 12.8.1 pre-installed
# ============================================
FROM runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2204

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1
ENV HF_HUB_ENABLE_HF_TRANSFER=1

# -----------------------------------------------
# 1. Extra system deps not in base image
# -----------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# -----------------------------------------------
# 2. Clone ComfyUI
# -----------------------------------------------
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI

# -----------------------------------------------
# 3. ComfyUI requirements + hf_transfer
# -----------------------------------------------
RUN pip install --no-cache-dir -r /workspace/ComfyUI/requirements.txt

RUN pip install --no-cache-dir \
    "huggingface-hub>=0.25.0" \
    hf_transfer \
    sqlalchemy \
    aiosqlite

# -----------------------------------------------
# 4. Patch ComfyUI  [rarely changes → stays cached]
# -----------------------------------------------
COPY patch_comfy_sdxl_pooled.py /workspace/patch_comfy_sdxl_pooled.py
RUN python3 /workspace/patch_comfy_sdxl_pooled.py

# -----------------------------------------------
# 5. Pre-create model directories (models downloaded at runtime by start.sh)
# -----------------------------------------------
RUN mkdir -p /workspace/ComfyUI/models/checkpoints \
             /workspace/ComfyUI/models/clip \
             /workspace/ComfyUI/models/vae \
             /workspace/ComfyUI/models/loras \
             /workspace/ComfyUI/models/unet \
             /workspace/ComfyUI/models/upscale_models

# -----------------------------------------------
# 6. Custom nodes  [changes occasionally — cached independently of models above]
# -----------------------------------------------
COPY custom_nodes.list /workspace/custom_nodes.list
COPY setup_custom_nodes.sh /workspace/setup_custom_nodes.sh
RUN chmod +x /workspace/setup_custom_nodes.sh && /workspace/setup_custom_nodes.sh

# Verify required custom nodes cloned correctly
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-load-lora-from-url || \
    (echo "ERROR: bollerdominik/ComfyUI-load-lora-from-url failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-GlifNodes || \
    (echo "ERROR: glifxyz/ComfyUI-GlifNodes failed to clone (provides 'Load LoRA From URL' used by nsfw_pro workflow)" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI_Comfyroll_CustomNodes || \
    (echo "ERROR: Suzie1/ComfyUI_Comfyroll_CustomNodes failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/Derfuu_ComfyUI_ModdedNodes || \
    (echo "ERROR: Derfuu/Derfuu_ComfyUI_ModdedNodes failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-Crystools || \
    (echo "ERROR: crystian/ComfyUI-Crystools failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-Image-Saver || \
    (echo "ERROR: alexopus/ComfyUI-Image-Saver failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/rgthree-comfy || \
    (echo "ERROR: rgthree/rgthree-comfy failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/comfyui-tooling-nodes || \
    (echo "ERROR: Acly/comfyui-tooling-nodes failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/was-node-suite-comfyui || \
    (echo "ERROR: WASasquatch/was-node-suite-comfyui failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI_UltimateSDUpscale || \
    (echo "ERROR: ssitu/ComfyUI_UltimateSDUpscale failed to clone" && exit 1)

# Install pip requirements for every custom node
RUN for dir in /workspace/ComfyUI/custom_nodes/*/; do \
      if [ -f "$dir/requirements.txt" ]; then \
        echo "Installing requirements for $(basename $dir)..." && \
        pip install --no-cache-dir -r "$dir/requirements.txt" || true; \
      fi; \
      if [ -f "$dir/install.py" ]; then \
        echo "Running install.py for $(basename $dir)..." && \
        cd "$dir" && python3 install.py || true && cd /workspace; \
      fi; \
    done

# -----------------------------------------------
# 7. RunPod handler + startup  [changes frequently — always last so rebuilds are instant]
# -----------------------------------------------
RUN pip install --no-cache-dir runpod requests

COPY handler.py /workspace/handler.py
COPY start.sh /workspace/start.sh
RUN chmod +x /workspace/start.sh

# -----------------------------------------------
# 8. Start
# -----------------------------------------------
CMD ["/workspace/start.sh"]
