"""Emit the immutable launcher identity used by the deployment operator."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
files = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in
         ['bootstrap_local_addon.sh', 'local_addon.py', 'checked_comfy.py', 'launch_local_image.sh']}
build = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
print(json.dumps({
    'buildSha256': build,
    'directory': '/runpod-volume/mdcln-runtime-launchers/local-addon-' + build[:16],
    'files': files,
    'archivePath': '/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211.tar.gz',
    'archiveSha256': 'f450987ebd185afca9218d1062ff1e9bef2fb7f86179c8089840d1eff82311de',
    'archiveBytes': 386050882,
}, indent=2))
