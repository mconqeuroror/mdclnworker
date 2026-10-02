#!/usr/bin/env python3
"""Fail-closed, network-free runtime validation for the ModelClone image worker."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping


@dataclass(frozen=True)
class ModelRequirement:
    relative_path: str
    expected_size: int | None = None
    minimum_size: int = 1
    optional_if_bypass_upscale: bool = False


MODEL_REQUIREMENTS = (
    ModelRequirement("vae/ae.safetensors", 335_304_388),
    ModelRequirement("text_encoders/qwen_3_4b.safetensors", 8_044_982_048),
    ModelRequirement("diffusion_models/z_image_turbo_bf16.safetensors", 12_309_866_400),
    ModelRequirement("model_patches/Z-Image-Turbo-Fun-Controlnet-Union.safetensors", 3_101_572_408),
    ModelRequirement("unet/zImageTurboNSFW_20BF16AIO.safetensors", 20_522_570_546),
    ModelRequirement("unet/zImageTurboNSFW_62BF16.safetensors", 12_309_920_704),
    ModelRequirement("diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors", 20_522_589_770),
    ModelRequirement("depthanything3/da3_base.safetensors", 541_518_028),
    ModelRequirement("ultralytics/bbox/face_yolov8m.pt", 52_026_019),
    ModelRequirement("ultralytics/segm/person_yolov8m-seg.pt", 54_827_683),
    ModelRequirement("sams/sam_vit_b_01ec64.pth", 375_042_383),
    ModelRequirement("mediapipe/selfie_multiclass_256x256.tflite", 16_371_837),
    ModelRequirement("opencv_dnn/gender_deploy.prototxt", 2_308),
    ModelRequirement("opencv_dnn/gender_net.caffemodel", 45_649_168),
    ModelRequirement("opencv_dnn/haarcascade_frontalface_default.xml", 930_127),
    # The source volume did not contain this at audit time. Production must
    # preload a valid file or explicitly opt into the existing bypass path.
    ModelRequirement(
        "upscale_models/4xFaceUpDAT.pth",
        expected_size=154_685_478,
        optional_if_bypass_upscale=True,
    ),
)

MODEL_ALIASES: Mapping[str, str] = {
    "clip/qwen_3_4b.safetensors": "../text_encoders/qwen_3_4b.safetensors",
    "checkpoints/z_image_turbo_bf16.safetensors": "../diffusion_models/z_image_turbo_bf16.safetensors",
    "checkpoints/zImageTurboNSFW_20BF16AIO.safetensors": "../unet/zImageTurboNSFW_20BF16AIO.safetensors",
    "checkpoints/zImageTurboNSFW_43BF16AIO.safetensors": "../diffusion_models/zImageTurboNSFW_43BF16AIO.safetensors",
    "checkpoints/zImageTurboNSFW_62BF16.safetensors": "../unet/zImageTurboNSFW_62BF16.safetensors",
}

MODEL_DIRECTORIES = (
    "checkpoints",
    "clip",
    "text_encoders",
    "vae",
    "loras",
    "unet",
    "diffusion_models",
    "model_patches",
    "depthanything3",
    "upscale_models",
    "ultralytics",
    "sams",
    "mediapipe",
    "opencv_dnn",
)

REQUIRED_NODE_DIRECTORIES = (
    "comfyui-tooling-nodes",
    "ComfyUI-Impact-Pack",
    "ComfyUI-Impact-Subpack",
    "ComfyUI_essentials",
    "comfyui-every-person-seg-coii",
    "ComfyUI-Kie-API",
    "Derfuu_ComfyUI_ModdedNodes",
    "civitai_comfy_nodes",
    "ComfyUI-KJNodes",
    "ComfyUI-GlifNodes",
    "ComfyUI_Comfyroll_CustomNodes",
    "cg-use-everywhere",
    "ComfyUI-Image-Saver",
    "comfy-image-saver",
    "rgthree-comfy",
    "ComfyUI-load-lora-from-url",
    "ComfyUI_LoRA_from_URL",
    "ComfyUI-Crystools",
    "ComfyUI-DepthAnythingV3",
    "ComfyUI-Easy-Use",
    "was-node-suite-comfyui",
    "ComfyUI_UltimateSDUpscale",
)

REQUIRED_NODE_TYPES = frozenset(
    {
        "LoadLoraFromUrlOrPath",
        "LoraLoaderFromURL",
        "CR Apply LoRA Stack",
        "CR SDXL Aspect Ratio",
        "UltimateSDUpscale",
        "UpscaleModelLoader",
        "Seed (rgthree)",
        "Image Film Grain",
        "UNETLoader",
        "CLIPLoader",
        "VAELoader",
        "ETN_ApplyMaskToImage",
        "String Literal",
        "FaceDetailer",
        "SAMLoader",
        "UltralyticsDetectorProvider",
        "ImpactImageInfo",
        "MaskPreview+",
        "EveryPersonSegDetail",
        "KIE_NanoBananaPro_Image",
        "QwenImageDiffsynthControlnet",
        "ModelPatchLoader",
        "ImageScaleToTotalPixels",
        "ResizeImageMaskNode",
        "DepthAnything_V3",
        "DownloadAndLoadDepthAnythingV3Model",
        "easy imageSize",
        "easy loraStackApply",
    }
)


class PreflightError(RuntimeError):
    pass


def _require_directory(path: Path, label: str) -> None:
    if not path.is_dir():
        raise PreflightError(f"missing {label}: {path}")


def validate_models(models_root: Path, bypass_upscale: bool = False) -> None:
    _require_directory(models_root, "model volume")
    errors: list[str] = []
    for requirement in MODEL_REQUIREMENTS:
        if requirement.optional_if_bypass_upscale and bypass_upscale:
            continue
        path = models_root / requirement.relative_path
        if not path.is_file():
            errors.append(f"missing model: {requirement.relative_path}")
            continue
        if path.is_symlink():
            errors.append(f"required model must be a regular file: {requirement.relative_path}")
            continue
        size = path.stat().st_size
        if requirement.expected_size is not None and size != requirement.expected_size:
            errors.append(
                f"wrong size: {requirement.relative_path} "
                f"({size}, expected {requirement.expected_size})"
            )
        elif size < requirement.minimum_size:
            errors.append(
                f"too small: {requirement.relative_path} "
                f"({size}, minimum {requirement.minimum_size})"
            )
    if errors:
        raise PreflightError("model preflight failed:\n  " + "\n  ".join(errors))


def validate_custom_node_directories(comfy_root: Path) -> None:
    custom_nodes = comfy_root / "custom_nodes"
    errors = [
        name
        for name in REQUIRED_NODE_DIRECTORIES
        if not (custom_nodes / name).is_dir()
    ]
    if errors:
        raise PreflightError(
            "required custom-node directories missing from image: " + ", ".join(errors)
        )
    if (custom_nodes / "ComfyUI-Manager").exists():
        raise PreflightError("ComfyUI-Manager is not allowed in the serving image")


def _ensure_alias(models_root: Path, alias_name: str, target: str) -> None:
    alias = models_root / alias_name
    alias.parent.mkdir(parents=True, exist_ok=True)
    expected = (alias.parent / target).resolve(strict=True)

    if alias.is_symlink():
        if alias.resolve(strict=False) == expected:
            return
        alias.unlink()
    elif alias.exists():
        raise PreflightError(f"model alias must be a symlink: {alias_name}")

    alias.symlink_to(target)
    if alias.resolve(strict=True) != expected:
        raise PreflightError(f"failed to create model alias: {alias_name}")


def _link_model_directory(volume_models: Path, comfy_models: Path, name: str) -> None:
    source = volume_models / name
    source.mkdir(parents=True, exist_ok=True)
    destination = comfy_models / name

    if destination.is_symlink():
        if destination.resolve(strict=False) == source.resolve():
            return
        destination.unlink()
    elif destination.exists():
        if destination.is_dir() and not any(destination.iterdir()):
            destination.rmdir()
        else:
            raise PreflightError(f"refusing to replace nonempty Comfy model path: {destination}")

    destination.symlink_to(source, target_is_directory=True)


def prepare_runtime(
    volume_models: Path,
    comfy_root: Path,
    cache_root: Path,
    bypass_upscale: bool = False,
) -> None:
    validate_models(volume_models, bypass_upscale=bypass_upscale)
    validate_custom_node_directories(comfy_root)

    # Rebuild aliases rather than copying tiny S3 representations of POSIX
    # symlinks as regular files.
    for alias, target in MODEL_ALIASES.items():
        _ensure_alias(volume_models, alias, target)

    comfy_models = comfy_root / "models"
    comfy_models.mkdir(parents=True, exist_ok=True)
    for directory in MODEL_DIRECTORIES:
        _link_model_directory(volume_models, comfy_models, directory)

    cache_root.mkdir(parents=True, exist_ok=True)
    for directory in ("hub", "torch"):
        (cache_root / directory).mkdir(parents=True, exist_ok=True)


def validate_node_types(object_info: Mapping[str, object]) -> None:
    missing = sorted(REQUIRED_NODE_TYPES.difference(object_info))
    if missing:
        raise PreflightError("ComfyUI did not register required nodes: " + ", ".join(missing))


def fetch_object_info(url: str) -> Mapping[str, object]:
    with urllib.request.urlopen(url, timeout=30) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise PreflightError("ComfyUI object_info response was not an object")
    return data


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, default=Path("/runpod-volume/models"))
    parser.add_argument("--comfy-root", type=Path, default=Path("/workspace/ComfyUI"))
    parser.add_argument("--cache-root", type=Path, default=Path("/runpod-volume/hf_cache"))
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--object-info-url")
    parser.add_argument("--bypass-upscale", action="store_true")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.prepare:
            prepare_runtime(
                args.models,
                args.comfy_root,
                args.cache_root,
                bypass_upscale=args.bypass_upscale,
            )
            print(">>> Offline model and custom-node preflight passed")
        if args.object_info_url:
            validate_node_types(fetch_object_info(args.object_info_url))
            print(">>> Required ComfyUI node types registered")
        if not args.prepare and not args.object_info_url:
            raise PreflightError("select --prepare and/or --object-info-url")
    except (OSError, ValueError, PreflightError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
