# ============================================
# ModelClone ComfyUI Worker for RunPod Serverless
# ============================================
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

# Build-time secret for CivitAI model download (docker build --build-arg CIVITAI_API_KEY=...)
ARG CIVITAI_API_KEY=""

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1
ENV TRANSFORMERS_USE_FAST_IMAGE_PROCESSING=0
# Expose key to setup_models.sh during build
ENV CIVITAI_API_KEY=${CIVITAI_API_KEY}

# -----------------------------------------------
# 1. System dependencies  [rarely changes → stays cached]
# -----------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    software-properties-common \
 && add-apt-repository ppa:deadsnakes/ppa \
 && apt-get update && apt-get install -y --no-install-recommends \
    python3.12 python3.12-venv python3.12-dev \
    python3-pip git wget curl build-essential \
    libgl1 libglib2.0-0 libegl1-mesa libgles2-mesa ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 \
 && python3 -m ensurepip --upgrade \
 && pip3 install --upgrade pip setuptools wheel

WORKDIR /workspace

# -----------------------------------------------
# 2. Clone ComfyUI  [rarely changes → stays cached]
# -----------------------------------------------
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI

# -----------------------------------------------
# 3. PyTorch + ComfyUI requirements  [rarely changes → stays cached]
# -----------------------------------------------
RUN pip install --no-cache-dir \
    torch==2.6.0+cu124 \
    torchvision==0.21.0+cu124 \
    torchaudio==2.6.0+cu124 \
    --index-url https://download.pytorch.org/whl/cu124

RUN pip install --no-cache-dir -r /workspace/ComfyUI/requirements.txt

# ML deps required by ComfyUI_LayerStyle_Advance (JoyCaption Beta1)
RUN pip install --no-cache-dir \
    "transformers==4.56.1" \
    "tokenizers>=0.20.3" \
    accelerate \
    sentencepiece \
    protobuf \
    "huggingface-hub>=0.25.0" \
    bitsandbytes

# -----------------------------------------------
# 4. Patch ComfyUI  [rarely changes → stays cached]
# -----------------------------------------------
COPY patch_comfy_sdxl_pooled.py /workspace/patch_comfy_sdxl_pooled.py
RUN python3 /workspace/patch_comfy_sdxl_pooled.py

# -----------------------------------------------
# 5. Pre-create model directories
# -----------------------------------------------
RUN mkdir -p /workspace/ComfyUI/models/checkpoints \
             /workspace/ComfyUI/models/clip \
             /workspace/ComfyUI/models/vae \
             /workspace/ComfyUI/models/loras \
             /workspace/ComfyUI/models/unet \
             /workspace/ComfyUI/models/upscale_models \
             /workspace/ComfyUI/models/seedvr2

# Bake all models into image at build time — eliminates 30-min cold start download.
# Pass CIVITAI_API_KEY as a build arg to include the NSFW UNet.
# All models baked: VAE + CLIP + UNet + upscaler + SeedVR2 VAE + SeedVR2 DiT + JoyCaption
COPY setup_models.sh /workspace/setup_models.sh
RUN chmod +x /workspace/setup_models.sh
RUN /workspace/setup_models.sh

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
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI_LayerStyle_Advance || \
    (echo "ERROR: chflame163/ComfyUI_LayerStyle_Advance failed to clone" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-JoyCaption || \
    (echo "ERROR: 1038lab/ComfyUI-JoyCaption failed to clone" && exit 1)
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
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler || \
    (echo "ERROR: numz/ComfyUI-SeedVR2_VideoUpscaler failed to clone" && exit 1)

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

# Belt-and-suspenders: re-pin JoyCaption + SeedVR2 deps after node installs
RUN pip install --no-cache-dir \
    "transformers==4.56.1" \
    "tokenizers>=0.20.3" \
    accelerate \
    sentencepiece \
    protobuf \
    "huggingface-hub>=0.25.0" \
    bitsandbytes \
    peft \
    einops

RUN pip install --no-cache-dir \
    "omegaconf>=2.3.0" \
    "diffusers>=0.33.1" \
    "peft>=0.17.0" \
    "rotary_embedding_torch>=0.5.3" \
    opencv-python \
    gguf \
    matplotlib \
    psutil

RUN if [ -f /workspace/ComfyUI/custom_nodes/ComfyUI-JoyCaption/requirements_gguf.txt ]; then \
      pip install --no-cache-dir -r /workspace/ComfyUI/custom_nodes/ComfyUI-JoyCaption/requirements_gguf.txt; \
    fi

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
