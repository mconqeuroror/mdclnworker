"""Read-only interpreter/native probe; success still requires CPU node registration."""
import ctypes
import hashlib
import importlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import sysconfig

ADDON = Path('/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211')
RUNTIME = Path('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002')
PINS = {'FULL_SHA256SUMS': '2d4959e2a5fef58adaddd3eee7d0dedf52be612e76e37c4b2c93fc99641ea35a',
        'CRITICAL_SHA256SUMS': '9dc6c09d9d32349ab7e271641c6dc636441c76390b8dbb697504b4ba58ac1e60'}
failures = []
results = {}


def check(label, function):
    try:
        results[label] = function()
        print(json.dumps({'event': 'cpu-check-passed', 'check': label}), flush=True)
    except Exception as error:
        failures.append({'check': label, 'exceptionClass': type(error).__name__,
                         'sharedObjects': sorted(set(re.findall(r'\b(lib[A-Za-z0-9_+.-]+\.so(?:\.[0-9]+)*)\b', str(error))))})
        print(json.dumps({'event': 'cpu-check-failed', **failures[-1]}), flush=True)


def identity():
    info = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    assert info['ID'].strip('"') == 'ubuntu' and info['VERSION_ID'].strip('"') == '22.04'
    assert platform.machine() == 'x86_64' and platform.libc_ver() == ('glibc', '2.35')
    assert sys.version_info[:3] == (3, 12, 12)
    assert sysconfig.get_config_var('SOABI') == 'cpython-312-x86_64-linux-gnu'
    assert Path(sys.prefix) == ADDON / 'venv' and Path(sys.base_prefix) == ADDON / 'python'
    assert (ADDON / 'venv/lib/python3.12/site-packages').resolve() == RUNTIME / 'venv/lib/python3.12/site-packages'
    assert sys.dont_write_bytecode and os.environ.get('HF_HUB_OFFLINE') == '1'
    return {'os': 'ubuntu22.04', 'glibc': '2.35', 'python': platform.python_version(), 'soabi': sysconfig.get_config_var('SOABI')}


def seal():
    assert (RUNTIME / 'READY').is_file() and not (RUNTIME / 'BUILDING').exists()
    for name, digest in PINS.items():
        assert hashlib.sha256((RUNTIME / name).read_bytes()).hexdigest() == digest
    subprocess.run(['sha256sum', '--check', '--status', 'CRITICAL_SHA256SUMS'], cwd=RUNTIME, capture_output=True, check=True, timeout=60)
    return {'criticalFilesVerified': True, 'fullManifestIdentityVerified': True, 'fullTreeRehashed': False}


def import_package(name):
    module = importlib.import_module(name)
    module_path = getattr(module, '__file__', None)
    if module_path:
        assert Path(module_path).resolve().is_relative_to(RUNTIME / 'venv/lib/python3.12/site-packages')
    return {'imported': True}


check('identity', identity)
check('sealed-runtime-critical-and-manifest-identity', seal)
if failures:
    print(json.dumps({'state': 'FAILED', 'phase': 'identity', 'failures': failures}))
    raise SystemExit(1)

for name in ['ssl', 'sqlite3', 'ctypes', 'bz2', 'lzma', 'zlib', 'multiprocessing']:
    check('stdlib:' + name, lambda name=name: bool(importlib.import_module(name)))
for name in ['libstdc++.so.6', 'libgcc_s.so.1', 'libgomp.so.1', 'libGL.so.1', 'libglib-2.0.so.0']:
    check('native:' + name, lambda name=name: bool(ctypes.CDLL(name)))
for name in ['numpy', 'PIL.Image', 'cv2', 'torch', 'torchvision', 'torchaudio', 'safetensors', 'tokenizers', 'transformers', 'runpod']:
    check('package:' + name, lambda name=name: import_package(name))


def torch_cpu():
    import torch
    expected = {'torch': '2.8.0+cu128', 'torchvision': '0.23.0+cu128', 'torchaudio': '2.8.0+cu128'}
    assert all(version(name) == wanted for name, wanted in expected.items())
    assert torch.version.cuda == '12.8'
    assert torch.ones((2, 2)).matmul(torch.ones((2, 2))).sum().item() == 8
    return {'versions': expected, 'cudaWheel': torch.version.cuda, 'cpuTensorOperationPassed': True, 'gpuTested': False}


check('torch-cpu-operation', torch_cpu)
check('sealed-ffmpeg', lambda: subprocess.run([str(RUNTIME / 'native/rootfs/usr/bin/ffmpeg'), '-version'], capture_output=True, check=True, timeout=30).returncode == 0)
check('git-command', lambda: subprocess.run(['git', '--version'], capture_output=True, check=True, timeout=10).returncode == 0)
print(json.dumps({'state': 'FAILED' if failures else 'CORE_PASS_PENDING_REGISTRATION',
                  'phase': 'interpreter-and-native-dependencies', 'runtimeId': RUNTIME.name,
                  'addonId': ADDON.name, 'results': results, 'failures': failures,
                  'cpuNodeRegistrationPassed': False, 'gpuRenderPassed': False}, sort_keys=True))
raise SystemExit(bool(failures))
