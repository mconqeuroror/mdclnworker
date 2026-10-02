"""Authenticate and unpack the existing Image Python addon onto worker-local disk."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import sys
import tarfile
import time

RUNTIME = Path('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002')
ADDON = Path('/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211')
ARCHIVE_SHA256 = 'f450987ebd185afca9218d1062ff1e9bef2fb7f86179c8089840d1eff82311de'
ARCHIVE_BYTES = 386050882
PINS = {
    'ADDON_SHA256SUMS': 'bdc51b6bc447cb9fc7444f84c6eb18c284b3d03b1f38f9ffd12f0aac0e1d40fb',
    'ADDON_SYMLINKS.json': 'e9d9413fbc4dd4c2364940a5133bf933078ce15b37dcc88baf9040a2fc0ed737',
    'launch_image_thin.sh': '0094be811d2d75291e179b06242d6f3dc86b908231e0bebb702dcd5cf588a5e8',
}


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as source:
        while chunk := source.read(4 * 1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def archive_members(bundle, prefix=ADDON.name):
    rows, seen, aliases = [], set(), set()
    for member in bundle.getmembers():
        path = PurePosixPath(member.name)
        if (path.is_absolute() or '..' in path.parts or not path.parts or
                path.parts[0] != prefix or '\\' in member.name or '\0' in member.name):
            raise ValueError('archive-path-refused')
        relative = PurePosixPath(*path.parts[1:])
        if relative in seen:
            raise ValueError('archive-duplicate-refused')
        seen.add(relative)
        if not (member.isdir() or member.isfile() or member.issym()) or member.mode & 0o7000:
            raise ValueError('archive-type-or-mode-refused')
        if not relative.parts and not member.isdir():
            raise ValueError('archive-root-refused')
        if member.issym():
            target = member.linkname
            if str(relative) == 'venv/lib/python3.12/site-packages':
                if target != str(RUNTIME / 'venv/lib/python3.12/site-packages'):
                    raise ValueError('package-alias-refused')
            else:
                resolved = PurePosixPath(posixpath.normpath(str(relative.parent / target)))
                if (not target or target.startswith('/') or '..' in resolved.parts or
                        '\0' in target or '\\' in target):
                    raise ValueError('archive-alias-refused')
            aliases.add(relative)
        rows.append((member, relative))
    for _, relative in rows:
        if any(parent in aliases for parent in relative.parents):
            raise ValueError('archive-parent-alias-refused')
    return rows


def extract_authenticated(archive, target, *, expected_sha=ARCHIVE_SHA256,
                          expected_bytes=ARCHIVE_BYTES):
    """One open descriptor binds authentication and extraction to identical bytes."""
    target = Path(target)
    if os.path.lexists(target):
        raise ValueError('local-target-already-exists')
    fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected_bytes:
            raise ValueError('archive-size-or-type-mismatch')
        checksum = hashlib.sha256()
        while block := source.read(4 * 1024 * 1024):
            checksum.update(block)
        if checksum.hexdigest() != expected_sha:
            raise ValueError('archive-checksum-mismatch')
        source.seek(0)
        with tarfile.open(fileobj=source, mode='r:gz') as bundle:
            rows = archive_members(bundle)
            target.mkdir(mode=0o700)
            directories = []
            for member, relative in rows:
                destination = target.joinpath(*relative.parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                    directories.append((member, destination))
                elif member.isfile():
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(member) as content, destination.open('xb') as output:
                        shutil.copyfileobj(content, output, 4 * 1024 * 1024)
                    if destination.stat().st_size != member.size:
                        raise ValueError('extracted-size-mismatch')
                    os.chmod(destination, member.mode & 0o777)
                    os.utime(destination, (member.mtime, member.mtime))
            # All file writes finish before any symlink is created.
            for member, relative in rows:
                if member.issym():
                    destination = target.joinpath(*relative.parts)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.symlink_to(member.linkname)
            for member, destination in reversed(directories):
                os.chmod(destination, member.mode & 0o777)
                os.utime(destination, (member.mtime, member.mtime))
        after = os.fstat(source.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if identity(before) != identity(after):
            raise ValueError('local-archive-changed')


def relocate(root):
    root = Path(root)
    for name, checksum in PINS.items():
        if digest(root / name) != checksum:
            raise ValueError('addon-pin-mismatch')
    proof = json.loads((root / 'CPU_PREFLIGHT_READY.json').read_text())
    if (proof.get('state') != 'READY' or not proof.get('cpuNodeRegistrationPassed') or
            not proof.get('interpreterNativeChecksPassed') or
            proof.get('addonManifestSha256') != PINS['ADDON_SHA256SUMS']):
        raise ValueError('addon-source-proof-mismatch')
    aliases = []
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            entry = Path(parent) / name
            if entry.is_symlink():
                aliases.append({'path': str(entry.relative_to(root)), 'target': os.readlink(entry)})
    if sorted(aliases, key=lambda row: row['path']) != json.loads((root / 'ADDON_SYMLINKS.json').read_text()):
        raise ValueError('addon-alias-inventory-mismatch')
    changed = []
    for path in [root / 'venv/pyvenv.cfg', *sorted((root / 'venv/bin').iterdir())]:
        if path.is_symlink() or not path.is_file():
            continue
        original = path.read_bytes()
        if str(ADDON).encode() in original:
            if path.name != 'pyvenv.cfg' and not original.startswith((b'#!', b'# ')):
                raise ValueError('unexpected-relocation-file')
            path.write_bytes(original.replace(str(ADDON).encode(), str(root).encode()))
            changed.append(str(path.relative_to(root)))
    return changed


def adapt_start(original, wrapper):
    text = Path(original).read_text()
    anchor = 'python3 main.py \\\n'
    if text.count(anchor) != 1:
        raise ValueError('comfy-start-anchor-mismatch')
    # Add -B to each existing invocation as defense in depth; no application logic changes.
    text = text.replace('python3 ', 'python3 -B ')
    return text.replace('python3 -B main.py \\\n', f'python3 -B {wrapper} main.py \\\n')


def main():
    if len(sys.argv) != 3:
        raise ValueError('expected-local-archive-and-owned-instance')
    local = Path(sys.argv[2])
    if (local.name != 'addon' or local.parent.parent != Path('/workspace') or
            not re.fullmatch(r'mdcln-local-addon-v1\.[A-Za-z0-9]{8}', local.parent.name) or
            not stat.S_ISDIR(local.parent.lstat().st_mode)):
        raise ValueError('local-instance-path-refused')
    started = time.monotonic()
    extract_authenticated(Path(sys.argv[1]), local)
    extracted = time.monotonic()
    changed = relocate(local)
    wrapper = Path(__file__).resolve().parent / 'checked_comfy.py'
    start = local / 'start-local.sh'
    start.write_text(adapt_start(RUNTIME / 'start.sh', wrapper))
    start.chmod(0o755)
    receipt = {
        'state': 'LOCAL_ADDON_READY', 'archiveSha256': ARCHIVE_SHA256,
        'archiveBytes': ARCHIVE_BYTES, 'localAddon': str(local),
        'authenticateExtractSeconds': round(extracted - started, 3),
        'relocateSeconds': round(time.monotonic() - extracted, 3),
        'relocatedFiles': changed, 'fullRuntimeRemainsShared': True,
        'requiredNodeCoverageChanged': False, 'gpuRenderPassed': False,
    }
    (local / 'LOCAL_READY.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'event': 'local-addon-failed', 'class': type(error).__name__,
                          'reason': str(error) if isinstance(error, ValueError) else 'details-withheld'}), flush=True)
        raise SystemExit(1)
