"""Stage only the pinned Python addon beside the immutable image runtime."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import posixpath
import copy
import shutil
import stat
import subprocess
import tarfile

RUNTIME = Path('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002')
ADDON = Path('/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211')
SHA = '1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c'
MARKER = 'modelclone-image-python-addon-20261002-v1'


def safe_filter(member, destination):
    if not member.issym():
        return tarfile.data_filter(member, destination)
    # Ubuntu 22's backported filter resolves symbolic links against the archive
    # root. Validate their real member-relative target as a root-relative link.
    assert not posixpath.isabs(member.linkname)
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
    assert resolved.startswith('python/') and '..' not in resolved.split('/')
    probe = copy.copy(member)
    probe.type = tarfile.LNKTYPE
    probe.linkname = resolved
    filtered = tarfile.data_filter(probe, destination)
    filtered.type = tarfile.SYMTYPE
    filtered.linkname = member.linkname
    return filtered


def main():
    assert os.environ.get('SOURCE_VOLUME_ID') == 'mevpt9ccol'
    assert hashlib.sha256((RUNTIME / 'CRITICAL_SHA256SUMS').read_bytes()).hexdigest() == '9dc6c09d9d32349ab7e271641c6dc636441c76390b8dbb697504b4ba58ac1e60'
    archive = Path('/tmp/image-thin-python.tar.gz')
    assert archive.is_file() and archive.stat().st_size == 33887801
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == SHA
    ADDON.parent.mkdir(mode=0o755, exist_ok=True)
    assert stat.S_ISDIR(ADDON.parent.lstat().st_mode)
    lock = os.open(ADDON.parent / '.cpython-3.12.12-20260211.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if ADDON.exists():
            assert stat.S_ISDIR(ADDON.lstat().st_mode)
            assert (ADDON / 'BUILDING').read_text() == MARKER + '\n'
            assert set(p.name for p in ADDON.iterdir()) <= {'BUILDING', 'python'}
            shutil.rmtree(ADDON)
        ADDON.mkdir(mode=0o755)
        (ADDON / 'BUILDING').write_text(MARKER + '\n')
        assert hasattr(tarfile, 'data_filter'), 'safe-tar-filter-unavailable'
        with tarfile.open(archive) as bundle:
            for member in bundle.getmembers():
                pieces = Path(member.name).parts
                assert pieces and pieces[0] == 'python' and '..' not in pieces and not member.name.startswith('/')
                assert member.isfile() or member.isdir() or member.issym() or member.islnk()
            bundle.extractall(ADDON, filter=safe_filter)
        env = {k: v for k, v in os.environ.items() if k not in ('PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV')}
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        subprocess.run([str(ADDON / 'python/bin/python3.12'), '-I', '-B', '-m', 'venv', '--without-pip', str(ADDON / 'venv')], env=env, capture_output=True, check=True)
        site = ADDON / 'venv/lib/python3.12/site-packages'
        site.rmdir()
        site.symlink_to(RUNTIME / 'venv/lib/python3.12/site-packages', target_is_directory=True)
        for name in ['probe_cpu.py', 'run_cpu_preflight.py', 'launch_image_thin_candidate.sh', 'addon-plan.json']:
            target = ADDON / ('launch_image_thin.sh' if name == 'launch_image_thin_candidate.sh' else name)
            target.write_bytes((Path('/tmp') / name).read_bytes())
            target.chmod(0o755 if target.suffix == '.sh' else 0o644)
        print(json.dumps({'event': 'python-addon-staged', 'archiveSha256': SHA, 'runtimeUnmodified': True, 'state': 'BUILDING'}), flush=True)
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'event': 'python-addon-stage-failed', 'reason': type(error).__name__}), flush=True)
        raise SystemExit(1)
