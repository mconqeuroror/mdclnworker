# ============================================
# ModelClone NSFW MOTION CONTROL Worker for RunPod Serverless
# Wan 2.2 Animate (14B) — image + driving video → animated video
#
# Independent from the existing nsfw image worker (`runpod-mdcln/`):
#   - Different ComfyUI version (needs WanAnimateToVideo native node, added late 2025)
#   - Different model set (~46GB total)
#   - Different custom node packs (WanAnimatePreprocess, KJNodes, VHS, easy-use, essentials, pysssss)
#
# Base image: PyTorch 2.6.0 on CUDA 12.4.1 / Ubuntu 22.04
# Use cu124* (not cu1281): PyTorch+CUDA 12.8.x requires a very new *host* driver.
# On RunPod serverless, older GPU stacks often fail at Comfy start with:
#   RuntimeError: The NVIDIA driver on your system is too old
# The image worker (runpod-mdcln) can keep cu1281 if that fleet is on newer drivers.
# ============================================
FROM runpod/pytorch:0.7.0-cu1241-torch260-ubuntu2204

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONFAULTHANDLER=1
ENV HF_HUB_ENABLE_HF_TRANSFER=1

# -----------------------------------------------
# 1. System deps
#    - libgl1 / libglib2.0-0 → opencv (used by VHS + WanAnimatePreprocess)
#    - ffmpeg               → VHS_LoadVideo / VHS_VideoCombine
#    - git-lfs              → in case any custom node clone wants LFS
# -----------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg git-lfs \
 && rm -rf /var/lib/apt/lists/* \
 && git lfs install --skip-repo

WORKDIR /workspace

# -----------------------------------------------
# 2. Clone ComfyUI pinned to v0.19.3 (April 2026)
#    This version has native WanAnimateToVideo / TrimVideoLatent / etc.
#    DO NOT downgrade to the v0.16.x used by `runpod-mdcln/` — those
#    versions predate Wan 2.2 Animate and the workflow will fail validation.
# -----------------------------------------------
RUN git clone --depth 1 --branch v0.19.3 https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI

# -----------------------------------------------
# 3. ComfyUI requirements + hf_transfer
#    CRITICAL: use `python3 -m pip` so packages land in the SAME Python
#    that `python3 main.py` uses. Same gotcha as the image worker.
# -----------------------------------------------
RUN python3 -m pip install --no-cache-dir -r /workspace/ComfyUI/requirements.txt

RUN python3 -m pip install --no-cache-dir \
    "huggingface-hub>=0.25.0" \
    hf_transfer \
    sqlalchemy aiosqlite \
    onnxruntime-gpu \
    "numpy<2"

# -----------------------------------------------
# 4. Pre-create model directories (models downloaded at runtime by start.sh)
# -----------------------------------------------
RUN mkdir -p /workspace/ComfyUI/models/diffusion_models \
             /workspace/ComfyUI/models/text_encoders \
             /workspace/ComfyUI/models/vae \
             /workspace/ComfyUI/models/clip_vision \
             /workspace/ComfyUI/models/loras \
             /workspace/ComfyUI/models/detection \
             /workspace/ComfyUI/input

# -----------------------------------------------
# 5. Custom nodes
# -----------------------------------------------
COPY custom_nodes.list /workspace/custom_nodes.list
COPY setup_custom_nodes.sh /workspace/setup_custom_nodes.sh
RUN chmod +x /workspace/setup_custom_nodes.sh && /workspace/setup_custom_nodes.sh

# Verify the required packs all cloned (motion-control workflow will not work without these)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-WanAnimatePreprocess || \
    (echo "ERROR: kijai/ComfyUI-WanAnimatePreprocess failed to clone (PoseAndFaceDetection / DrawViTPose / OnnxDetectionModelLoader)" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-KJNodes || \
    (echo "ERROR: kijai/ComfyUI-KJNodes failed to clone (ImageConcatMulti, ImageResizeKJv2, wanBlockSwap, TorchCompileModelWanVideoV2, PathchSageAttentionKJ, ModelPatchTorchSettings)" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite || \
    (echo "ERROR: Kosinkadink/ComfyUI-VideoHelperSuite failed to clone (VHS_LoadVideo, VHS_VideoCombine, VHS_VideoInfo)" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-Easy-Use || \
    (echo "ERROR: yolain/ComfyUI-Easy-Use failed to clone (easy int/float/boolean/ifElse/compare/positive/promptReplace/convertAnything/whileLoopStart/whileLoopEnd/lengthAnything/batchAnything)" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI_essentials || \
    (echo "ERROR: cubiq/ComfyUI_essentials failed to clone (SimpleMath+, SimpleMathDual+)" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/ComfyUI-Custom-Scripts || \
    (echo "ERROR: pythongosssss/ComfyUI-Custom-Scripts failed to clone (MathExpression|pysssss)" && exit 1)
RUN test -d /workspace/ComfyUI/custom_nodes/rgthree-comfy || \
    (echo "ERROR: rgthree/rgthree-comfy failed to clone (Seed (rgthree), Any Switch (rgthree))" && exit 1)

# Install pip requirements for every custom node
RUN for dir in /workspace/ComfyUI/custom_nodes/*/; do \
      if [ -f "$dir/requirements.txt" ]; then \
        echo "Installing requirements for $(basename $dir)..." && \
        python3 -m pip install --no-cache-dir -r "$dir/requirements.txt" || true; \
      fi; \
      if [ -f "$dir/install.py" ]; then \
        echo "Running install.py for $(basename $dir)..." && \
        cd "$dir" && python3 install.py || true && cd /workspace; \
      fi; \
    done

# Re-pin numpy<2 in case a custom node bumped it (WanAnimatePreprocess uses cv2 which dislikes numpy 2)
RUN python3 -m pip install --no-cache-dir "numpy<2"

# -----------------------------------------------
# 6. RunPod handler + startup
# -----------------------------------------------
RUN python3 -m pip install --no-cache-dir runpod requests

COPY handler.py /workspace/handler.py
COPY start.sh /workspace/start.sh
RUN chmod +x /workspace/start.sh

CMD ["/workspace/start.sh"]
