import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1] / 'image_runtime_pack'
spec = importlib.util.spec_from_file_location('local_addon', ROOT / 'local_addon.py')
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)


class LocalAddonTests(unittest.TestCase):
    def archive(self, root, entries):
        archive = root / 'addon.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            for name, kind, value in entries:
                row = tarfile.TarInfo(addon.ADDON.name + '/' + name)
                row.mode = 0o755 if kind == 'directory' else 0o644
                if kind == 'symlink':
                    row.type = tarfile.SYMTYPE; row.linkname = value
                elif kind == 'directory':
                    row.type = tarfile.DIRTYPE
                elif kind == 'hardlink':
                    row.type = tarfile.LNKTYPE; row.linkname = value
                else:
                    row.size = len(value)
                bundle.addfile(row, io.BytesIO(value) if kind == 'file' else None)
        return archive

    def extract(self, archive, destination):
        return addon.extract_authenticated(archive, destination,
            expected_sha=hashlib.sha256(archive.read_bytes()).hexdigest(),
            expected_bytes=archive.stat().st_size)

    def test_extracts_internal_alias_and_only_fixed_external_packages(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.archive(root, [('python/data', 'file', b'trusted'),
                ('python/alias', 'symlink', 'data'),
                ('venv/lib/python3.12/site-packages', 'symlink', str(addon.RUNTIME / 'venv/lib/python3.12/site-packages'))])
            self.extract(archive, root / 'local')
            self.assertEqual((root / 'local/python/alias').read_bytes(), b'trusted')
            self.assertTrue((root / 'local/venv/lib/python3.12/site-packages').is_symlink())

    def test_checksum_failure_creates_no_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = self.archive(root, [('data', 'file', b'trusted')])
            with self.assertRaisesRegex(ValueError, 'checksum-mismatch'):
                addon.extract_authenticated(archive, root / 'local', expected_sha='0' * 64,
                    expected_bytes=archive.stat().st_size)
            self.assertFalse((root / 'local').exists())

    def test_escape_duplicate_and_alias_parent_are_refused_before_extract(self):
        cases = [
            [('../outside', 'file', b'no')],
            [('link', 'symlink', '../outside')],
            [('link', 'symlink', '/tmp/outside')],
            [('data', 'file', b'a'), ('data', 'file', b'b')],
            [('link', 'symlink', 'data'), ('link/file', 'file', b'no')],
            [('hard', 'hardlink', 'data')],
            [('venv/lib/python3.12/site-packages', 'symlink', '/tmp/packages')],
        ]
        for entries in cases:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); archive = self.archive(root, entries)
                with self.assertRaises(ValueError):
                    self.extract(archive, root / 'local')
                self.assertFalse((root / 'local').exists())

    def test_existing_destination_and_archive_symlink_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = self.archive(root, [('data', 'file', b'new')])
            target = root / 'local'; target.mkdir(); (target / 'data').write_bytes(b'original')
            with self.assertRaisesRegex(ValueError, 'already-exists'):
                self.extract(archive, target)
            self.assertEqual((target / 'data').read_bytes(), b'original')
            alias = root / 'alias'; alias.symlink_to(archive)
            with self.assertRaises(OSError):
                self.extract(alias, root / 'other')

    def test_start_change_keeps_arguments_and_handler_and_rejects_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            start = Path(temporary) / 'start.sh'
            original = 'python3 preflight.py\npython3 main.py \\\n --port 8188 &\npython3 handler.py\n'
            start.write_text(original)
            result = addon.adapt_start(start, '/trusted/checked_comfy.py')
            self.assertEqual(result, 'python3 -B preflight.py\npython3 -B /trusted/checked_comfy.py main.py \\\n --port 8188 &\npython3 -B handler.py\n')
            self.assertEqual(start.read_text(), original)
            start.write_text('python3 changed.py\n')
            with self.assertRaisesRegex(ValueError, 'anchor-mismatch'):
                addon.adapt_start(start, '/trusted/checked_comfy.py')

    def test_actual_torch_validation_requires_cuda_outside_cpu_profile(self):
        spec = importlib.util.spec_from_file_location('checked_comfy', ROOT / 'checked_comfy.py')
        checked = importlib.util.module_from_spec(spec); spec.loader.exec_module(checked)
        torch = SimpleNamespace(__version__='2.8.0+cu128',
            version=SimpleNamespace(cuda='12.8'), cuda=SimpleNamespace(is_available=lambda: False))
        checked.validate_torch(torch, True)
        with self.assertRaisesRegex(RuntimeError, 'cuda-unavailable'):
            checked.validate_torch(torch, False)
        torch.cuda.is_available = lambda: True
        checked.validate_torch(torch, False)
        torch.__version__ = '2.9.0+cu128'
        with self.assertRaisesRegex(RuntimeError, 'build-mismatch'):
            checked.validate_torch(torch, False)


if __name__ == '__main__':
    unittest.main()
