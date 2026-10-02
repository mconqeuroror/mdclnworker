#!/usr/bin/env python3
"""Restrict the pinned DepthAnythingV3 checkout to ModelClone's two core nodes."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


EXPECTED_ORIGINAL_SHA256 = "96409df8b6c72ee5c11e46afbd5bbe81f033a15fc1adad3afa2ccf74aa6cd2c1"
PATCHED_SOURCE = '''"""
ModelClone core-only Depth Anything V3 registration.

The upstream optional 3D and streaming nodes require a separate comfy-env
workspace. ModelClone workflows use only the local model loader and inference
node, so the sealed worker registers exactly those two classes.
"""
from .load_model import DownloadAndLoadDepthAnythingV3Model
from .nodes_inference import DepthAnything_V3

NODE_CLASSES = [
    DownloadAndLoadDepthAnythingV3Model,
    DepthAnything_V3,
]
'''
PATCHED_SHA256 = hashlib.sha256(PATCHED_SOURCE.encode("utf-8")).hexdigest()


class PatchError(RuntimeError):
    pass


def patch(path: Path) -> str:
    if not path.is_file() or path.is_symlink():
        raise PatchError(f"DA3 node registry must be a regular file: {path}")
    original = path.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    if digest == PATCHED_SHA256:
        return "already-patched"
    if digest != EXPECTED_ORIGINAL_SHA256:
        raise PatchError(
            "DA3 node registry does not match the audited pinned source; "
            f"got sha256 {digest}"
        )
    path.write_text(PATCHED_SOURCE, encoding="utf-8")
    if hashlib.sha256(path.read_bytes()).hexdigest() != PATCHED_SHA256:
        raise PatchError("DA3 core registry verification failed after write")
    return "patched"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("node_registry", type=Path)
    args = parser.parse_args()
    print(f">>> DA3 core registry {patch(args.node_registry)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
