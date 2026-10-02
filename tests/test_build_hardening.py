from __future__ import annotations

import ast
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


da3 = load_module("patch_da3_core", "patch_da3_core.py")
guard = load_module("loopback_socket_guard", "loopback_socket_guard.py")


UPSTREAM_DA3_REGISTRY = '''"""
ComfyUI-DepthAnythingV3: Depth Anything V3 nodes for ComfyUI
"""
from .load_model import (
    DownloadAndLoadDepthAnythingV3Model,
    DA3_EnableTiledProcessing,
    DA3_DownloadModel,
    LoadSALADModel,
)

from .nodes_inference import DepthAnything_V3

from .nodes_3d import (
    DA3_ToPointCloud,
    DA3_SavePointCloud,
    DA3_FilterGaussians,
    DA3_ToMesh,
)

from .nodes_camera import (
    DA3_CreateCameraParams,
    DA3_ParseCameraPose,
)

from .nodes_multiview import (
    DepthAnythingV3_MultiView,
    DA3_MultiViewPointCloud,
)

from .streaming import DepthAnythingV3_Streaming

from .preview_nodes import DA3_PreviewPointCloud

NODE_CLASSES = [
    # Loaders
    DownloadAndLoadDepthAnythingV3Model,
    DA3_EnableTiledProcessing,
    DA3_DownloadModel,
    LoadSALADModel,
    # Inference
    DepthAnything_V3,
    # Multi-view
    DepthAnythingV3_MultiView,
    DA3_MultiViewPointCloud,
    # Streaming
    DepthAnythingV3_Streaming,
    # 3D
    DA3_ToPointCloud,
    DA3_SavePointCloud,
    DA3_FilterGaussians,
    DA3_ToMesh,
    # Camera
    DA3_CreateCameraParams,
    DA3_ParseCameraPose,
    # Preview
    DA3_PreviewPointCloud,
]
'''


class BuildHardeningTests(unittest.TestCase):
    def test_da3_patch_is_exact_idempotent_and_core_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "__init__.py"
            registry.write_text(UPSTREAM_DA3_REGISTRY, encoding="utf-8")
            self.assertEqual(da3.patch(registry), "patched")
            self.assertEqual(da3.patch(registry), "already-patched")
            tree = ast.parse(registry.read_text(encoding="utf-8"))
            imports = {
                node.module
                for node in tree.body
                if isinstance(node, ast.ImportFrom)
            }
            self.assertEqual(imports, {"load_model", "nodes_inference"})
            assignment = next(
                node for node in tree.body
                if isinstance(node, ast.Assign)
                and any(
                    isinstance(target, ast.Name) and target.id == "NODE_CLASSES"
                    for target in node.targets
                )
            )
            names = [item.id for item in assignment.value.elts]
            self.assertEqual(
                names,
                ["DownloadAndLoadDepthAnythingV3Model", "DepthAnything_V3"],
            )

    def test_da3_patch_refuses_unreviewed_upstream_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "__init__.py"
            registry.write_text(UPSTREAM_DA3_REGISTRY + "# changed\n", encoding="utf-8")
            with self.assertRaisesRegex(da3.PatchError, "audited pinned source"):
                da3.patch(registry)

    def test_loopback_guard_accepts_local_and_refuses_external_addresses(self) -> None:
        for address in (("127.0.0.1", 8188), ("::1", 8188, 0, 0)):
            family = socket.AF_INET6 if len(address) == 4 else socket.AF_INET
            guard.validate_address(family, address)
        guard.validate_address(socket.AF_UNIX, "/tmp/local.sock")
        with self.assertRaises(guard.NetworkDenied):
            guard.validate_address(socket.AF_INET, ("198.51.100.1", 443))
        with self.assertRaises(guard.NetworkDenied):
            guard.validate_address(socket.AF_INET, ("example.com", 443))

    def test_guarded_runner_blocks_before_external_connect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            probe = Path(directory) / "probe.py"
            probe.write_text(
                "import socket\nsocket.socket().connect(('198.51.100.1', 443))\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, str(ROOT / "loopback_socket_guard.py"), str(probe)],
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("non-loopback", result.stderr)

    def test_guarded_runner_allows_loopback_connect(self) -> None:
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        try:
            with tempfile.TemporaryDirectory() as directory:
                probe = Path(directory) / "probe.py"
                probe.write_text(
                    "import socket, sys\n"
                    "with socket.create_connection(('127.0.0.1', int(sys.argv[1])), 2): pass\n",
                    encoding="utf-8",
                )
                result = subprocess.run(
                    [
                        sys.executable,
                        str(ROOT / "loopback_socket_guard.py"),
                        str(probe),
                        str(listener.getsockname()[1]),
                    ],
                    text=True,
                    capture_output=True,
                    timeout=10,
                    check=False,
                )
            connection, _ = listener.accept()
            connection.close()
        finally:
            listener.close()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_guarded_runner_imports_modules_beside_target_script(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "app"
            app.mkdir()
            (app / "sibling.py").write_text("VALUE = 'loaded'\n", encoding="utf-8")
            target = app / "main.py"
            target.write_text(
                "from sibling import VALUE\n"
                "assert VALUE == 'loaded'\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, str(ROOT / "loopback_socket_guard.py"), str(target)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_stage_and_docker_share_exact_python_constraints(self) -> None:
        constraints = {
            line.strip()
            for line in (ROOT / "python-constraints.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        self.assertEqual(
            constraints,
            {"huggingface-hub==1.33.0", "transformers==5.18.0"},
        )
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        docker = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        setup = (ROOT / "setup_custom_nodes.sh").read_text(encoding="utf-8")
        for source in (stage, docker, setup):
            self.assertIn("python-constraints.txt", source)
        self.assertNotIn('"huggingface-hub>=0.25.0,<1"', docker)

    def test_failed_runtime_resume_is_explicit_and_keeps_final_gates(self) -> None:
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        self.assertIn('RESUME_FAILED_RUNTIME="${RESUME_FAILED_RUNTIME:-0}"', stage)
        self.assertIn("failed-runtime resume requires an explicit RUNTIME_ID", stage)
        self.assertIn("resume target is not a failed, unsealed", stage)
        self.assertIn("model-tree.prepared", stage)
        self.assertIn('resume_phase="dependencies"', stage)
        self.assertIn('resume_phase="registration"', stage)
        self.assertIn("partial registration state and cannot be resumed", stage)
        self.assertIn("CUSTOM_NODES_REUSE_CHECKOUTS=1", stage)
        self.assertIn("custom_nodes.lock", stage)
        self.assertIn('python3 -m pip check', stage)
        self.assertIn('snapshot_model_tree "${RUNTIME_DIR}/model-tree.after-registration"', stage)
        self.assertIn('> FULL_SHA256SUMS', stage)
        self.assertIn('mv "${RUNTIME_DIR}/.READY.tmp" "${RUNTIME_DIR}/READY"', stage)

    def test_node_setup_filters_only_known_optional_pixeloe_and_verifies_reuse(self) -> None:
        setup = (ROOT / "setup_custom_nodes.sh").read_text(encoding="utf-8")
        self.assertIn(
            'CUSTOM_NODES_REUSE_CHECKOUTS="${CUSTOM_NODES_REUSE_CHECKOUTS:-0}"',
            setup,
        )
        self.assertIn("reusable custom-node checkout changed", setup)
        self.assertIn('git -C "${target}" reset --hard -q "${locked_commit}"', setup)
        self.assertIn('git -C "${target}" clean -ffdq', setup)
        self.assertIn("custom-node lock contains unexpected or missing entries", setup)
        self.assertIn("length($2) == 40", setup)
        self.assertNotIn("$2 ~ /^[0-9a-f]{40}$/", setup)
        self.assertIn("audited ComfyUI_essentials pixeloe requirement changed", setup)
        self.assertIn("skipped optional PixelOEPixelize dependency", setup)
        self.assertNotIn("platform_release=", setup)

    def test_reuse_mode_restores_locked_checkout_without_cloning(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nodes = root / "nodes"
            checkout = nodes / "test-node"
            checkout.mkdir(parents=True)
            for command in (
                ["git", "init", "-q"],
                ["git", "config", "user.email", "fixture@example.invalid"],
                ["git", "config", "user.name", "Fixture"],
            ):
                subprocess.run(command, cwd=checkout, check=True)
            tracked = checkout / "node.py"
            tracked.write_text("original\n", encoding="utf-8")
            subprocess.run(["git", "add", "node.py"], cwd=checkout, check=True)
            subprocess.run(["git", "commit", "-qm", "fixture"], cwd=checkout, check=True)
            commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=checkout,
                text=True,
                capture_output=True,
                check=True,
            ).stdout.strip()
            tracked.write_text("changed\n", encoding="utf-8")
            untracked = checkout / "generated.py"
            untracked.write_text("generated\n", encoding="utf-8")

            node_list = root / "custom_nodes.list"
            node_list.write_text("fixture/test-node\n", encoding="utf-8")
            lock = root / "custom_nodes.lock"
            lock.write_text(f"fixture/test-node@{commit}\n", encoding="utf-8")
            constraints = root / "constraints.txt"
            constraints.write_text("", encoding="utf-8")
            patcher = root / "patch.py"
            patcher.write_text("raise SystemExit('not called')\n", encoding="utf-8")
            env = {
                **os.environ,
                "CUSTOM_NODES_DIR": str(nodes),
                "CUSTOM_NODES_LIST": str(node_list),
                "CUSTOM_NODES_LOCK": str(lock),
                "CUSTOM_NODES_CONSTRAINTS": str(constraints),
                "CUSTOM_NODES_REUSE_CHECKOUTS": "1",
                "DA3_PATCHER": str(patcher),
                "SUBMODULE_SYNC": str(ROOT / "sync_custom_node_submodules.sh"),
            }
            result = subprocess.run(
                ["bash", str(ROOT / "setup_custom_nodes.sh")],
                env=env,
                text=True,
                capture_output=True,
                timeout=20,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(tracked.read_text(encoding="utf-8"), "original\n")
            self.assertFalse(untracked.exists())

    def test_submodule_sync_populates_recorded_gitlink_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "child"
            child.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=child, check=True)
            subprocess.run(
                ["git", "config", "user.email", "fixture@example.invalid"],
                cwd=child,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Fixture"], cwd=child, check=True
            )
            (child / "module.py").write_text("VALUE = 1\n", encoding="utf-8")
            subprocess.run(["git", "add", "module.py"], cwd=child, check=True)
            subprocess.run(["git", "commit", "-qm", "child"], cwd=child, check=True)
            child_commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=child,
                text=True,
                capture_output=True,
                check=True,
            ).stdout.strip()

            parent = root / "parent"
            parent.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=parent, check=True)
            subprocess.run(
                ["git", "config", "user.email", "fixture@example.invalid"],
                cwd=parent,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Fixture"], cwd=parent, check=True
            )
            subprocess.run(
                [
                    "git",
                    "-c",
                    "protocol.file.allow=always",
                    "submodule",
                    "add",
                    "-q",
                    str(child),
                    "modules/child",
                ],
                cwd=parent,
                check=True,
            )
            subprocess.run(["git", "commit", "-qam", "parent"], cwd=parent, check=True)

            checkout = root / "checkout"
            subprocess.run(
                ["git", "clone", "-q", "--no-recurse-submodules", str(parent), str(checkout)],
                check=True,
            )
            before = subprocess.run(
                ["git", "submodule", "status"],
                cwd=checkout,
                text=True,
                capture_output=True,
                check=True,
            ).stdout
            self.assertTrue(before.startswith("-"))
            result = subprocess.run(
                [str(ROOT / "sync_custom_node_submodules.sh"), str(checkout)],
                env={**os.environ, "GIT_ALLOW_PROTOCOL": "file"},
                text=True,
                capture_output=True,
                timeout=20,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            initialized = checkout / "modules" / "child"
            actual = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=initialized,
                text=True,
                capture_output=True,
                check=True,
            ).stdout.strip()
            self.assertEqual(actual, child_commit)

    def test_submodule_sync_ignores_stale_metadata_without_gitlink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory) / "checkout"
            checkout.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=checkout, check=True)
            subprocess.run(
                ["git", "config", "user.email", "fixture@example.invalid"],
                cwd=checkout,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Fixture"], cwd=checkout, check=True
            )
            (checkout / ".gitmodules").write_text(
                '[submodule "removed"]\n'
                "\tpath = removed\n"
                "\turl = https://example.invalid/removed.git\n",
                encoding="utf-8",
            )
            subprocess.run(["git", "add", ".gitmodules"], cwd=checkout, check=True)
            subprocess.run(["git", "commit", "-qm", "stale metadata"], cwd=checkout, check=True)
            result = subprocess.run(
                [str(ROOT / "sync_custom_node_submodules.sh"), str(checkout)],
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
