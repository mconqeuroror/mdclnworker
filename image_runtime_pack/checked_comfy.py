"""Assert the actual Comfy process's Torch build, then execute unchanged main.py."""
import builtins
import json
from pathlib import Path
import runpy
import sys


def validate_torch(torch, cpu_profile):
    if torch.__version__ != '2.8.0+cu128' or torch.version.cuda != '12.8':
        raise RuntimeError('comfy-torch-build-mismatch')
    if not cpu_profile and not torch.cuda.is_available():
        raise RuntimeError('comfy-cuda-unavailable')
    print('>>> Actual Comfy Torch build verified ' + json.dumps({
        'torch': torch.__version__, 'cuda': torch.version.cuda, 'cpuProfile': cpu_profile,
    }), flush=True)


def main():
    entry = Path(sys.argv[1]).resolve()
    if entry != Path('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002/ComfyUI/main.py'):
        raise RuntimeError('unexpected-comfy-entry-point')
    cpu_profile = '--cpu' in sys.argv[2:]
    original_import = builtins.__import__
    verified = False

    def checked_import(*args, **kwargs):
        nonlocal verified
        result = original_import(*args, **kwargs)
        torch = sys.modules.get('torch')
        if not verified and torch is not None and not getattr(torch.__spec__, '_initializing', True):
            verified = True
            builtins.__import__ = original_import
            validate_torch(torch, cpu_profile)
        return result

    sys.argv = sys.argv[1:]
    sys.path.insert(0, str(entry.parent))
    # Comfy sets CUDA allocation/device options before its first Torch import.
    # Let that ordering stand, validating once the original import has completed.
    builtins.__import__ = checked_import
    try:
        runpy.run_path(str(entry), run_name='__main__')
    finally:
        builtins.__import__ = original_import


if __name__ == '__main__':
    main()
