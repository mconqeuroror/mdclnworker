# ModelClone image worker: offline cold-start image

This branch keeps the existing worker request contract (`handler.py`) and ComfyUI v0.17.2, while moving all custom-node cloning and Python installation into the Docker build. Serving startup performs filesystem validation, creates model aliases, starts ComfyUI, validates registered node types, and starts the RunPod handler. It never runs `pip`, `git`, `wget`, or a Hugging Face model download.

KIE calls and user LoRA URL loads remain job-time behavior inside ComfyUI. The worker does not set `HF_HUB_OFFLINE`, because that would break valid user LoRA URLs. Offline here means that boot/provisioning does not fetch or repair software or weights.

## Image contents

- Base: `runpod/pytorch:1.0.3-cu1281-torch260-ubuntu2204@sha256:701a9d326604252fdd7d9ae4eb898c4d8f81c888641ef01f25219816ecd21e8d`
- Serving Python: isolated Python 3.12 virtual environment
- Torch: `2.8.0+cu128`; torchvision `0.23.0+cu128`; torchaudio `2.8.0+cu128`
- ComfyUI: `v0.17.2` (unchanged)
- RunPod SDK: `1.8.2` (unchanged)
- All repositories in `custom_nodes.list`, including the five previously installed at boot:
  - `ComfyUI-Crystools`
  - `ComfyUI-DepthAnythingV3`
  - `ComfyUI-Easy-Use`
  - `was-node-suite-comfyui`
  - `ComfyUI_UltimateSDUpscale`
- Handler and strict preflight code

The build writes the resolved commit of every node repository to `/workspace/custom_nodes.lock`; archive that file with the promoted image digest. The image contains no model weights. `ComfyUI-Manager` is deliberately absent from the serving image because it has no workflow role and can fetch registries during ComfyUI startup.

## Required network-volume manifest

Before promotion, mount the destination volume at `/runpod-volume` and place these regular files under `/runpod-volume/models`. `runtime_preflight.py` checks the audited byte size before ComfyUI starts.

| Relative path | Bytes |
|---|---:|
| `vae/ae.safetensors` | 335304388 |
| `text_encoders/qwen_3_4b.safetensors` | 8044982048 |
| `diffusion_models/z_image_turbo_bf16.safetensors` | 12309866400 |
| `model_patches/Z-Image-Turbo-Fun-Controlnet-Union.safetensors` | 3101572408 |
| `unet/zImageTurboNSFW_20BF16AIO.safetensors` | 20522570546 |
| `unet/zImageTurboNSFW_62BF16.safetensors` | 12309920704 |
| `diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors` | 20522589770 |
| `depthanything3/da3_base.safetensors` | 541518028 |
| `ultralytics/bbox/face_yolov8m.pt` | 52026019 |
| `ultralytics/segm/person_yolov8m-seg.pt` | 54827683 |
| `sams/sam_vit_b_01ec64.pth` | 375042383 |
| `mediapipe/selfie_multiclass_256x256.tflite` | 16371837 |
| `opencv_dnn/gender_deploy.prototxt` | 2308 |
| `opencv_dnn/gender_net.caffemodel` | 45649168 |
| `opencv_dnn/haarcascade_frontalface_default.xml` | 930127 |
| `upscale_models/4xFaceUpDAT.pth` | 154685478 |

The audited `4xFaceUpDAT.pth` SHA-256 is `295deb264f4f8bc64970898054ca7c893428b052a4fa0fdc515f77b935b7e028`. Verify that checksum during volume provisioning. The old Acly Hugging Face URL returns 401; do not restore it as a serving-time fallback.

If the backend is intentionally deployed with `NSFW_COMFY_BYPASS_UPSCALE=1`, set the same variable on the worker to allow boot without `4xFaceUpDAT.pth`. Otherwise the upscaler is required. The Civitai `pornworksRealPorn_Illustrious_v4_04.safetensors` checkpoint is not in an active production workflow and is not a global boot requirement.

Do not copy object-storage representations of symlinks as 40–76 byte regular files. Preflight creates these aliases on the POSIX volume:

- `clip/qwen_3_4b.safetensors`
- checkpoint aliases for Z-Image Turbo and NSFW 20/43/62

It then links each model category, including `mediapipe` and `opencv_dnn`, into `/workspace/ComfyUI/models`. The existing Hugging Face cache path stays on the volume at `/runpod-volume/hf_cache`.

## Build and promotion

### Stage an offline runtime on the network volume

The staging path is an interim way to test the same sealed software on the
current public base before publishing a replacement image. Run the script from
a CPU pod whose container image is exactly
the pinned base digest above and whose production volume is mounted at
`/runpod-volume`. The tag's `/usr/bin/python3` is an apt-managed Python 3.10
without Torch; staging deliberately uses `/usr/bin/python3.12` and creates
an isolated final-path virtual environment:

```bash
cd /path/to/mdclnworker
RUNTIME_ID=mdcln-v0172-CANDIDATE ./stage_mdcln_runtime.sh
```

The script creates its virtual environment directly at the final unique path
`/runpod-volume/mdcln-runtime/$RUNTIME_ID`; it never renames or relocates the
environment. A failed build leaves `FAILED`. A successful build creates `READY`
atomically after dependency, model-manifest, native-library, offline CPU import,
and registered-node checks pass. It prints the final runtime path on success.
Do not reuse a runtime ID for a normal build.

An interrupted or failed, unsealed runtime can be repaired in place without
recreating its Torch venv or native rootfs. This mode requires the exact failed
runtime ID and refuses a runtime with `READY`, `BUILDING`, checksum seals, a
partial registration state, changed model-volume metadata, or mismatched node
commits:

```bash
RUNTIME_ID=mdcln-v0172-CANDIDATE RESUME_FAILED_RUNTIME=1 \
  ./stage_mdcln_runtime.sh
```

For a dependency-phase repair, the script resets every custom-node checkout to
the commit recorded in `custom_nodes.lock`, repeats requirements and installers,
then runs the same dependency, preflight, offline registration, node, model-tree,
and checksum gates as a new build. A registration-phase repair starts at the
later audited boundary. Both paths replace the source snapshot and record its
new digest before they can create `READY`.

To canary the result on a GPU pod running the same base image, set the runtime
path as the container command environment and invoke the launcher:

```bash
MDCLN_RUNTIME_DIR=/runpod-volume/mdcln-runtime/mdcln-v0172-CANDIDATE \
  /runpod-volume/mdcln-runtime/mdcln-v0172-CANDIDATE/launch_mdcln_runtime.sh
```

The launcher verifies the readiness marker, critical checksums, Torch 2.8 CUDA
12.8 trio, and staged ffmpeg before handing control to `start.sh`. The runtime
still uses the production model volume and may make job-time KIE or user LoRA
requests; staging and cold boot do not fetch software or weights.

```bash
docker build --pull -t REGISTRY/modelclone-worker:offline-cold-start .
docker push REGISTRY/modelclone-worker:offline-cold-start
```

Promote by immutable image digest, after all of the following pass on the target GPU family and the fully provisioned volume:

1. Container reaches the RunPod handler without any outbound setup/download traffic.
2. Preflight reports all model sizes and required node directories valid.
3. `/object_info` contains every required node type.
4. One smoke job for each active workflow family succeeds: direct NSFW 20, ModelClone/Soul 62, MCX/Depth/EveryPerson, upscale (unless explicitly bypassed), KIE, and a user LoRA URL.
5. Warm recycle reaches handler readiness without modifying model files beyond the documented symlink aliases/cache directories.

The pinned base tag contains Torch 2.6 CUDA 12.6 under its system interpreter,
which predates Blackwell support. The serving environment instead installs the
official Torch 2.8 CUDA 12.8 wheel trio in an isolated Python 3.12 venv. B200
compatibility still requires an actual image build and GPU workflow smoke test
before promotion; the version selection alone is not proof of kernel coverage.

## Local checks

These checks do not build the image or contact providers:

```bash
bash -n start.sh setup_custom_nodes.sh stage_mdcln_runtime.sh launch_mdcln_runtime.sh
python3 -m unittest -v tests/test_runtime_preflight.py
python3 -m py_compile runtime_preflight.py
```
