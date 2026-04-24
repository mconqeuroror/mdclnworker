# ModelClone NSFW Motion-Control Worker — Build & Deploy

Wan 2.2 Animate (14B) RunPod Serverless worker. Takes a reference image
+ a driving video and produces an MP4 of the reference subject performing
the motion of the driving video.

This worker is **independent** from the existing image worker
(`runpod-mdcln/`). They use different ComfyUI versions, different model sets,
and different custom node packs. Build/push/deploy them as two separate
endpoints.

## Architecture

- **Docker image**: ComfyUI v0.19.3 + custom nodes + Python deps + `handler.py`
- **NSFW motion control only** — driving-video → reference-image animation
- **Network volume** at `/runpod-volume` *(strongly recommended)* — ~46GB of
  models download here on first boot via `start.sh`. Without a volume the cold
  start downloads them every spin-up.
- **API**: backend POSTs a Comfy API graph (`input.prompt`) plus a base64
  image (reference) and a base64 video (driving). The handler waits for
  `VHS_VideoCombine` node `226` (or whatever `output_node_id` you pass) and
  returns the resulting MP4 base64-encoded under `videos[]`.

## Models (~46GB total)

| File | Source | Size | Used by node |
|------|--------|------|--------------|
| `diffusion_models/wan2.2_animate_14B_bf16.safetensors` | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` | ~34GB | `UNETLoader` (356) |
| `vae/wan_2.1_vae.safetensors` | `Comfy-Org/Wan_2.1_ComfyUI_repackaged` | ~242MB | `VAELoader` (329) |
| `text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `Comfy-Org/Wan_2.1_ComfyUI_repackaged` | ~6.4GB | `CLIPLoader` (333) |
| `clip_vision/clip_vision_h.safetensors` | `Comfy-Org/Wan_2.1_ComfyUI_repackaged` | ~1.2GB | `CLIPVisionLoader` (348) |
| `loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` | ~1.2GB | `LoraLoaderModelOnly` (327) |
| `loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors` | `Kijai/WanVideo_comfy/Lightx2v` | ~2.7GB | `LoraLoaderModelOnly` (355) |
| `detection/vitpose-l-wholebody.onnx` | `JunkyByte/easy_ViTPose/onnx/wholebody` | ~1.2GB | `OnnxDetectionModelLoader` (354) |
| `detection/yolov10m.onnx` | `Kalray/yolov10` | ~62MB | `OnnxDetectionModelLoader` (354) |

> ⚠ **Workflow filename patches** — three node filenames in the original
> `fixdmotioncontrol (1).json` graph were swapped to match what's actually
> downloaded:
>
> - Node 327 lora: `t2v_lightx2v_high_noise_model.safetensors` →
>   `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`
> - Node 355 lora: `lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors` →
>   `lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors`
> - Node 354 vitpose: `vitpose_h_wholebody_model.onnx` →
>   `vitpose-l-wholebody.onnx`
>
> The patched graph is shipped as `workflow_api.json`. The backend payload
> builder must use the same filenames or change the model URLs in
> `start.sh` to match.

## Custom nodes

| Need (workflow `class_type`) | Package (in `custom_nodes.list`) |
|------------------------------|----------------------------------|
| `PoseAndFaceDetection`, `DrawViTPose`, `OnnxDetectionModelLoader` | `kijai/ComfyUI-WanAnimatePreprocess` |
| `ImageConcatMulti`, `ImageResizeKJv2`, `GetImageRangeFromBatch`, `GetImageSize`, `wanBlockSwap`, `TorchCompileModelWanVideoV2`, `PathchSageAttentionKJ`, `ModelPatchTorchSettings` | `kijai/ComfyUI-KJNodes` |
| `VHS_LoadVideo`, `VHS_VideoCombine`, `VHS_VideoInfo` | `Kosinkadink/ComfyUI-VideoHelperSuite` |
| `Seed (rgthree)`, `Any Switch (rgthree)` | `rgthree/rgthree-comfy` |
| `easy int/float/boolean/ifElse/compare/positive/promptReplace/convertAnything/whileLoopStart/whileLoopEnd/lengthAnything/batchAnything` | `yolain/ComfyUI-Easy-Use` |
| `SimpleMath+`, `SimpleMathDual+` | `cubiq/ComfyUI_essentials` |
| `MathExpression\|pysssss` | `pythongosssss/ComfyUI-Custom-Scripts` |
| `WanAnimateToVideo`, `TrimVideoLatent`, samplers, loaders | ComfyUI core (v0.19.3) |

## Quick deploy

### 1. Build & push image

```bash
cd runpod-mdcln-motion
docker build -t yourdockerhub/modelclone-motion-worker:latest .
docker push yourdockerhub/modelclone-motion-worker:latest
```

### 2. RunPod serverless endpoint

- Image: your pushed image
- Network volume mounted at `/runpod-volume` (recommended — first boot will
  download ~46GB into it; subsequent boots reuse the volume)
- GPU: 4090 / A100 / H100 class (~24GB+ VRAM)
- No API keys needed — all models are public on HuggingFace

### 3. Sample request

```jsonc
{
  "input": {
    "prompt": { /* contents of workflow_api.json */ },
    "upload_images": [
      { "node_id": "167", "filename": "ref.jpg",   "data": "<base64 jpg>" }
    ],
    "upload_videos": [
      { "node_id": "52",  "filename": "drive.mp4", "data": "<base64 mp4>" }
    ],
    "output_node_id": "226",
    "timeout": 1800
  }
}
```

Response on success:

```jsonc
{
  "status": "COMPLETED",
  "prompt_id": "abc...",
  "videos": [
    {
      "filename": "KIARA_AnimateX_00001.mp4",
      "node_id": "226",
      "format": "video/h264-mp4",
      "subfolder": "",
      "type": "output",
      "base64": "AAAA..."
    }
  ]
}
```

## File overview

| File | Purpose |
|------|---------|
| `Dockerfile` | ComfyUI v0.19.3 + nodes + deps |
| `start.sh` | Models, symlinks, ComfyUI, handler |
| `handler.py` | RunPod handler (`prompt`, optional `upload_images` + `upload_videos`) |
| `custom_nodes.list` | GitHub repos for custom nodes |
| `setup_custom_nodes.sh` | Clone list during image build |
| `setup_models.sh` | Optional pre-bake at build time (most operators skip this) |
| `workflow_api.json` | Reference Wan 2.2 Animate graph with patched filenames |

## Troubleshooting

1. **`RuntimeError: The NVIDIA driver on your system is too old`**
   (from `torch._C._cuda_init` / `comfy.model_management`) — the *host* GPU
   driver is older than the CUDA user-mode build bundled with the PyTorch in
   the image. The Dockerfile uses `runpod/pytorch:0.7.0-cu1241-torch260-ubuntu2204`
   (PyTorch 2.6 + CUDA 12.4.1) for the widest RunPod serverless compatibility.
   If you changed the base to a `cu128` / `cu129` / `cu130` tag and see this
   again, either revert to `cu1241` or run on a template / GPU with a newer
   NVIDIA driver. Updating PyTorch *inside* the image without changing the
   NVIDIA driver on the host does not fix a driver/CUDA capability mismatch.
2. **`Unknown node types: WanAnimateToVideo`** — your image is built on the
   wrong ComfyUI tag. The Dockerfile pins `v0.19.3`; do not downgrade.
3. **`OnnxDetectionModelLoader` errors / can't find vitpose** — make sure
   `models/detection/vitpose-l-wholebody.onnx` and `models/detection/yolov10m.onnx`
   both exist and are >10KB. The self-heal block in `start.sh` will redownload
   on next boot if a previous attempt left a 0-byte file.
4. **Black / static output** — known SageAttention + torch-compile interaction
   on RTX 30xx. Set the `296` (`TORCH COMPILE`) node to `false` in the request
   payload to disable torch.compile.
5. **`ModuleNotFoundError: No module named 'sageattention'`** — the graph
   `PathchSageAttentionKJ` (node `322`) must not use `sage_attention: "auto"` on
   workers without the optional `sageattention` wheel. The API and shipped
   `workflow_api.json` set `sage_attention` to `disabled` (normal PyTorch
   attention). If you send a raw Comfy `prompt` with `auto`, add the package
   to the image or change the node to `disabled`.
6. **`ImportError: numpy._core.multiarray`** — a custom node bumped numpy to
   2.x. The Dockerfile re-pins `numpy<2` after node install, but a stale image
   may still have it. Rebuild from scratch.
7. **OOM during VAE decode** — bump `BLOCK SWAP` (node `276`) from 0 up to
   20–30 to offload more transformer blocks to CPU. Trades speed for VRAM.
8. **Debug missing nodes** — call the handler with
   `{"input": {"debug_nodes": true}}` and compare the returned list to the
   workflow `class_type` values.
