#!/usr/bin/env python3
"""
Patch ComfyUI model_base.py so SDXL/SDXLRefiner encode_adm handle missing pooled_output.

When using CLIP loaders that don't produce SDXL-style pooled embeddings (e.g. Qwen
qwen_image), kwargs["pooled_output"] can be missing or None, causing:
  AttributeError: 'NoneType' object has no attribute 'shape'
  flat = ... repeat(clip_pooled.shape[0], 1)

We:
1. Make sdxl_pooled return None when pooled_output is missing.
2. In SDXL.encode_adm and SDXLRefiner.encode_adm, if clip_pooled is None, use
   a zeros tensor with batch size inferred from cross_attn or 1.
"""
import sys

MODEL_BASE = "/workspace/ComfyUI/comfy/model_base.py"


def main():
    with open(MODEL_BASE, "r", encoding="utf-8") as f:
        content = f.read()

    # 1) sdxl_pooled: return args.get("pooled_output") so missing key gives None
    old_sdxl = " else:\n return args[\"pooled_output\"]"
    new_sdxl = " else:\n return args.get(\"pooled_output\")"
    if old_sdxl in content:
        content = content.replace(old_sdxl, new_sdxl)
        print("[patch] sdxl_pooled: use args.get('pooled_output')")
    else:
        print("[patch] sdxl_pooled: pattern not found (maybe already patched?)")

    # 2) SDXLRefiner.encode_adm and SDXL.encode_adm: add None clip_pooled guard
    if "if clip_pooled is None:" in content and "clip_pooled = torch.zeros((batch_size, 1280)" in content:
        print("[patch] SDXLRefiner/SDXL encode_adm: already patched")
    else:
        # SDXLRefiner (ComfyUI uses 1-space indent for class body)
        old_refiner = """ def encode_adm(self, **kwargs):
 clip_pooled = sdxl_pooled(kwargs, self.noise_augmentor)
 width = kwargs.get("width", 768)
 height = kwargs.get("height", 768)
 crop_w = kwargs.get("crop_w", 0)
 crop_h = kwargs.get("crop_h", 0)

 if kwargs.get("prompt_type", "") == "negative":"""
        new_refiner = """ def encode_adm(self, **kwargs):
 clip_pooled = sdxl_pooled(kwargs, self.noise_augmentor)
 if clip_pooled is None:
  cross_attn = kwargs.get("cross_attn")
  batch_size = int(cross_attn.shape[0]) if (cross_attn is not None and hasattr(cross_attn, "shape") and len(cross_attn.shape) > 0) else 1
  device = next(self.parameters()).device
  clip_pooled = torch.zeros((batch_size, 1280), device=device, dtype=torch.float32)
 width = kwargs.get("width", 768)
 height = kwargs.get("height", 768)
 crop_w = kwargs.get("crop_w", 0)
 crop_h = kwargs.get("crop_h", 0)

 if kwargs.get("prompt_type", "") == "negative":"""
        if old_refiner in content:
            content = content.replace(old_refiner, new_refiner, 1)
            print("[patch] SDXLRefiner.encode_adm: added None clip_pooled guard")
        else:
            print("[patch] SDXLRefiner.encode_adm: pattern not found")

        # SDXL (base)
        old_sdxl_block = """ def encode_adm(self, **kwargs):
 clip_pooled = sdxl_pooled(kwargs, self.noise_augmentor)
 width = kwargs.get("width", 768)
 height = kwargs.get("height", 768)
 crop_w = kwargs.get("crop_w", 0)
 crop_h = kwargs.get("crop_h", 0)
 target_width = kwargs.get("target_width", width)
 target_height = kwargs.get("target_height", height)

 out = []"""
        new_sdxl_block = """ def encode_adm(self, **kwargs):
 clip_pooled = sdxl_pooled(kwargs, self.noise_augmentor)
 if clip_pooled is None:
  cross_attn = kwargs.get("cross_attn")
  batch_size = int(cross_attn.shape[0]) if (cross_attn is not None and hasattr(cross_attn, "shape") and len(cross_attn.shape) > 0) else 1
  device = next(self.parameters()).device
  clip_pooled = torch.zeros((batch_size, 1280), device=device, dtype=torch.float32)
 width = kwargs.get("width", 768)
 height = kwargs.get("height", 768)
 crop_w = kwargs.get("crop_w", 0)
 crop_h = kwargs.get("crop_h", 0)
 target_width = kwargs.get("target_width", width)
 target_height = kwargs.get("target_height", height)

 out = []"""
        if old_sdxl_block in content:
            content = content.replace(old_sdxl_block, new_sdxl_block, 1)
            print("[patch] SDXL.encode_adm: added None clip_pooled guard")
        else:
            print("[patch] SDXL.encode_adm: pattern not found")

    with open(MODEL_BASE, "w", encoding="utf-8") as f:
        f.write(content)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
