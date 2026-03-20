#!/usr/bin/env python3
"""
Patch ComfyUI model_base.py so SDXL / SDXLRefiner encode_adm handle missing pooled_output.

When using CLIP loaders that don't produce SDXL-style pooled embeddings (e.g. Qwen
qwen_image), kwargs["pooled_output"] can be missing or None, causing:
  AttributeError: 'NoneType' object has no attribute 'shape'
  flat = ... repeat(clip_pooled.shape[0], 1)

Upstream ComfyUI uses 4-space indentation in model_base.py — older versions of this
script used 1-space patterns and silently failed to match, so the Docker image never
got patched.

We:
1. sdxl_pooled: use args.get("pooled_output") instead of args["pooled_output"].
2. After each `clip_pooled = sdxl_pooled(...)` (SDXLRefiner + SDXL), insert a guard
   that replaces None with a zero tensor sized to the conditioning batch.
"""
import sys

# Default: Docker worker. For local tests: python patch_comfy_sdxl_pooled.py ./model_base.py
MODEL_BASE = sys.argv[1] if len(sys.argv) > 1 else "/workspace/ComfyUI/comfy/model_base.py"

# Must match indentation in comfyanonymous/ComfyUI comfy/model_base.py (4 spaces).
SDXL_POOLED_LINE = "        clip_pooled = sdxl_pooled(kwargs, self.noise_augmentor)\n"

CLIP_POOLED_NONE_GUARD = """        clip_pooled = sdxl_pooled(kwargs, self.noise_augmentor)
        if clip_pooled is None:
            cross_attn = kwargs.get("cross_attn")
            batch_size = int(cross_attn.shape[0]) if (cross_attn is not None and hasattr(cross_attn, "shape") and len(cross_attn.shape) > 0) else 1
            device = next(self.parameters()).device
            clip_pooled = torch.zeros((batch_size, 1280), device=device, dtype=torch.float32)
"""


def main():
    with open(MODEL_BASE, "r", encoding="utf-8") as f:
        content = f.read()

    ok = True

    # 1) sdxl_pooled else branch — avoid KeyError; .get can still return None
    old_ret = '        return args["pooled_output"]'
    new_ret = '        return args.get("pooled_output")'
    if old_ret in content:
        content = content.replace(old_ret, new_ret, 1)
        print("[patch] sdxl_pooled: return args.get('pooled_output')")
    elif new_ret in content:
        print("[patch] sdxl_pooled: already uses args.get (skip)")
    else:
        print("[patch] ERROR: sdxl_pooled return pattern not found", file=sys.stderr)
        ok = False

    # 2) Insert None-guard after clip_pooled = sdxl_pooled (exactly 2 in stock ComfyUI)
    n_before = content.count(SDXL_POOLED_LINE)
    if n_before != 2:
        print(f"[patch] WARNING: expected 2x clip_pooled = sdxl_pooled lines, found {n_before}", file=sys.stderr)

    if CLIP_POOLED_NONE_GUARD not in content:
        if SDXL_POOLED_LINE in content:
            # Replace each occurrence of the single line with line + guard block
            content = content.replace(SDXL_POOLED_LINE, CLIP_POOLED_NONE_GUARD + "\n")
            print("[patch] SDXLRefiner + SDXL encode_adm: inserted clip_pooled is None guard (2x)")
        else:
            print("[patch] ERROR: clip_pooled = sdxl_pooled line not found", file=sys.stderr)
            ok = False
    else:
        print("[patch] encode_adm: None guard already present (skip)")

    # Verify
    if content.count("if clip_pooled is None:") < 2:
        print("[patch] ERROR: expected at least 2 'if clip_pooled is None:' after patch", file=sys.stderr)
        ok = False

    with open(MODEL_BASE, "w", encoding="utf-8") as f:
        f.write(content)

    if ok:
        print("[patch] Done: model_base.py updated OK.")
        return 0
    print("[patch] FAILED — fix patch_comfy_sdxl_pooled.py for this ComfyUI revision.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
