# ModelClone image worker. Models remain on /runpod-volume; the image contains
# the exact ComfyUI release, custom nodes, dependencies, and request handler.
FROM runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2204@sha256:701a9d326604252fdd7d9ae4eb898c4d8f81c888641ef01f25219816ecd21e8d

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RUNPOD_MIN_DISK_PERCENT=1 \
    RUNPOD_GPU_TEST_TIMEOUT=120

ENV VIRTUAL_ENV=/workspace/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY python-constraints.txt /workspace/python-constraints.txt

# The tagged base's serving interpreter is /usr/bin/python3.12. Its
# bundled Torch 2.6 CUDA 12.6 predates Blackwell support, so keep it out of the
# serving environment and install the approved CUDA 12.8 trio in an isolated
# venv. Do not use /usr/bin/python3 (the apt-managed Python 3.10 interpreter).
RUN /usr/bin/python3.12 -m venv "${VIRTUAL_ENV}" \
    && python3 -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cu128 \
      "torch==2.8.0" "torchvision==0.23.0" "torchaudio==2.8.0" \
    && test "$(python3 -c 'import torch; print(torch.__version__.split("+")[0])')" = "2.8.0" \
    && test "$(python3 -c 'import torch; print(torch.version.cuda)')" = "12.8"

# Keep the serving ComfyUI line unchanged. v0.17.2 supplies the core Qwen and
# model-patch nodes used by the shipped workflows.
RUN git clone --quiet --depth 1 --branch v0.17.2 \
      https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI \
    && find /workspace/ComfyUI/models -mindepth 1 -delete \
    && printf '%s\n' \
      'torch==2.8.0+cu128' \
      'torchvision==0.23.0+cu128' \
      'torchaudio==2.8.0+cu128' > /workspace/torch-constraints.txt \
    && python3 -m pip install --no-cache-dir \
      -c /workspace/torch-constraints.txt \
      -c /workspace/python-constraints.txt \
      -r /workspace/ComfyUI/requirements.txt \
    && test "$(python3 -c 'import torch; print(torch.__version__.split("+")[0])')" = "2.8.0"

RUN python3 -m pip install --no-cache-dir \
      -c /workspace/torch-constraints.txt \
      -c /workspace/python-constraints.txt \
      "huggingface-hub==1.33.0" "transformers==5.18.0" \
      hf_transfer sqlalchemy aiosqlite

COPY patch_comfy_sdxl_pooled.py /workspace/patch_comfy_sdxl_pooled.py
RUN python3 /workspace/patch_comfy_sdxl_pooled.py

# Clone all workflow node packs and install their Python dependencies during
# the image build. start.sh contains no git/pip/model-download fallback.
COPY custom_nodes.list setup_custom_nodes.sh patch_da3_core.py \
  sync_custom_node_submodules.sh /workspace/
RUN chmod +x /workspace/setup_custom_nodes.sh /workspace/patch_da3_core.py \
      /workspace/sync_custom_node_submodules.sh \
    && HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 /workspace/setup_custom_nodes.sh \
    && find /workspace/ComfyUI/custom_nodes -type d -name .git -prune -exec rm -rf '{}' + \
    && test -z "$(find /workspace/ComfyUI/models -type f -print -quit)"

# Install the worker SDK after custom-node dependencies so its tested version
# cannot be replaced by a transitive requirement.
RUN python3 -m pip install --no-cache-dir \
      -c /workspace/torch-constraints.txt \
      -c /workspace/python-constraints.txt \
      "runpod==1.8.2" requests \
    && python3 -m pip check \
    && test "$(python3 -c 'import torch; print(torch.__version__.split("+")[0])')" = "2.8.0" \
    && test "$(python3 -c 'import torch; print(torch.version.cuda)')" = "12.8"

COPY handler.py runtime_preflight.py start.sh /workspace/
RUN chmod +x /workspace/start.sh /workspace/runtime_preflight.py \
    && python3 -m py_compile /workspace/handler.py /workspace/runtime_preflight.py \
    && test ! -d /workspace/ComfyUI/custom_nodes/ComfyUI-Manager

# Model directories are link targets created by runtime_preflight.py. No model
# weights or Hugging Face caches are copied into the image.
RUN mkdir -p /workspace/ComfyUI/models /workspace/ComfyUI/input \
      /workspace/ComfyUI/output /workspace/ComfyUI/temp /workspace/ComfyUI/user

CMD ["/workspace/start.sh"]
