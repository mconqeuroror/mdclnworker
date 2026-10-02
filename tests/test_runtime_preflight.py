from __future__ import annotations

import importlib.util
import hashlib
import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "runtime_preflight", ROOT / "runtime_preflight.py"
)
assert SPEC and SPEC.loader
preflight = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = preflight
SPEC.loader.exec_module(preflight)


def write_sparse(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.truncate(size)


class RuntimePreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.models = self.root / "volume" / "models"
        self.comfy = self.root / "workspace" / "ComfyUI"
        self.cache = self.root / "volume" / "cache"
        for requirement in preflight.MODEL_REQUIREMENTS:
            size = requirement.expected_size or requirement.minimum_size
            write_sparse(self.models / requirement.relative_path, size)
        for name in preflight.REQUIRED_NODE_DIRECTORIES:
            node = self.comfy / "custom_nodes" / name
            node.mkdir(parents=True, exist_ok=True)
            (node / "__init__.py").write_text("", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_prepare_links_volume_models_aliases_and_caches(self) -> None:
        preflight.prepare_runtime(self.models, self.comfy, self.cache)

        self.assertTrue((self.comfy / "models" / "depthanything3").is_symlink())
        self.assertEqual(
            (self.comfy / "models" / "mediapipe").resolve(),
            (self.models / "mediapipe").resolve(),
        )
        clip_alias = self.models / "clip" / "qwen_3_4b.safetensors"
        self.assertTrue(clip_alias.is_symlink())
        self.assertEqual(
            clip_alias.resolve(),
            (self.models / "text_encoders" / "qwen_3_4b.safetensors").resolve(),
        )
        self.assertTrue((self.cache / "hub").is_dir())
        self.assertTrue((self.cache / "torch").is_dir())

    def test_missing_required_weight_fails_before_linking(self) -> None:
        missing = self.models / "unet" / "zImageTurboNSFW_20BF16AIO.safetensors"
        missing.unlink()

        with self.assertRaisesRegex(preflight.PreflightError, "zImageTurboNSFW_20"):
            preflight.prepare_runtime(self.models, self.comfy, self.cache)
        self.assertFalse((self.comfy / "models" / "unet").exists())

    def test_wrong_weight_size_fails(self) -> None:
        model = self.models / "depthanything3" / "da3_base.safetensors"
        model.write_bytes(b"partial")

        with self.assertRaisesRegex(preflight.PreflightError, "wrong size.*da3_base"):
            preflight.validate_models(self.models)

    def test_required_weight_cannot_be_a_symlink(self) -> None:
        model = self.models / "vae" / "ae.safetensors"
        target = self.root / "external-ae.safetensors"
        model.unlink()
        write_sparse(target, 335_304_388)
        model.symlink_to(target)

        with self.assertRaisesRegex(preflight.PreflightError, "regular file.*ae.safetensors"):
            preflight.validate_models(self.models)

    def test_object_storage_symlink_placeholder_is_rejected(self) -> None:
        alias = self.models / "clip" / "qwen_3_4b.safetensors"
        alias.parent.mkdir(parents=True, exist_ok=True)
        alias.write_text("../text_encoders/qwen_3_4b.safetensors", encoding="utf-8")

        with self.assertRaisesRegex(preflight.PreflightError, "alias must be a symlink"):
            preflight.prepare_runtime(self.models, self.comfy, self.cache)

    def test_upscaler_can_only_be_missing_under_explicit_bypass(self) -> None:
        upscaler = self.models / "upscale_models" / "4xFaceUpDAT.pth"
        upscaler.unlink()

        with self.assertRaisesRegex(preflight.PreflightError, "4xFaceUpDAT"):
            preflight.validate_models(self.models)
        preflight.validate_models(self.models, bypass_upscale=True)

    def test_missing_baked_node_pack_fails(self) -> None:
        missing = self.comfy / "custom_nodes" / "ComfyUI-DepthAnythingV3"
        (missing / "__init__.py").unlink()
        missing.rmdir()

        with self.assertRaisesRegex(preflight.PreflightError, "ComfyUI-DepthAnythingV3"):
            preflight.validate_custom_node_directories(self.comfy)

    def test_manager_is_rejected_from_serving_image(self) -> None:
        (self.comfy / "custom_nodes" / "ComfyUI-Manager").mkdir()

        with self.assertRaisesRegex(preflight.PreflightError, "Manager"):
            preflight.validate_custom_node_directories(self.comfy)

    def test_registered_node_validation_is_strict(self) -> None:
        object_info = {name: {} for name in preflight.REQUIRED_NODE_TYPES}
        preflight.validate_node_types(object_info)
        object_info.pop("UltimateSDUpscale")
        with self.assertRaisesRegex(preflight.PreflightError, "UltimateSDUpscale"):
            preflight.validate_node_types(object_info)

    def test_connected_mcx_and_fallback_lora_nodes_are_required(self) -> None:
        self.assertTrue(
            {
                "DownloadAndLoadDepthAnythingV3Model",
                "easy imageSize",
                "LoraLoaderFromURL",
            }.issubset(preflight.REQUIRED_NODE_TYPES)
        )

    def test_startup_contains_no_install_or_model_download_commands(self) -> None:
        startup = (ROOT / "start.sh").read_text(encoding="utf-8")
        forbidden = (
            r"\bpip(?:3)?\s+install\b",
            r"\bgit\s+clone\b",
            r"\bwget\b",
            r"\bcurl\s+https?://",
            r"\bhf_hub_download\b",
            r"\bsetup_models\b",
        )
        for pattern in forbidden:
            self.assertIsNone(re.search(pattern, startup), pattern)
        self.assertIn("KIE_API_KEY", startup)
        self.assertNotIn("HF_HUB_OFFLINE", startup)

    def test_five_former_runtime_node_packs_are_built(self) -> None:
        node_list = (ROOT / "custom_nodes.list").read_text(encoding="utf-8")
        for repo in (
            "crystian/ComfyUI-Crystools",
            "PozzettiAndrea/ComfyUI-DepthAnythingV3",
            "yolain/ComfyUI-Easy-Use",
            "WASasquatch/was-node-suite-comfyui",
            "ssitu/ComfyUI_UltimateSDUpscale",
        ):
            self.assertIn(repo, node_list)

    def test_impact_installers_skip_build_time_model_downloads(self) -> None:
        setup = (ROOT / "setup_custom_nodes.sh").read_text(encoding="utf-8")
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        marker = 'touch "${CUSTOM_NODES_DIR}/skip_download_model"'
        installer_loop = 'if [ -f "${node_dir}/install.py" ]'
        self.assertIn(marker, setup)
        self.assertLess(setup.index(marker), setup.index(installer_loop))
        skeleton_clear = 'find "${RUNTIME_DIR}/ComfyUI/models" -mindepth 1 -delete'
        custom_install = '"${RUNTIME_DIR}/setup_custom_nodes.sh"'
        self.assertLess(stage.index(skeleton_clear), stage.index(custom_install))

    def test_da3_build_skips_unrelated_comfy_env_workspace(self) -> None:
        setup = (ROOT / "setup_custom_nodes.sh").read_text(encoding="utf-8")
        self.assertIn('[ "${node_name}" = "ComfyUI-DepthAnythingV3" ]', setup)
        self.assertIn("install.py prestartup_script.py", setup)
        self.assertIn("${node_dir}/${hook}.build-disabled", setup)
        self.assertIn("grep -Ev '^[[:space:]]*comfy-env", setup)
        self.assertIn('python3 "${DA3_PATCHER}"', setup)
        self.assertIn("sealed DA3 core", setup)

    def test_registration_uses_loopback_socket_guard(self) -> None:
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        registration = 'python3 "${RUNTIME_DIR}/loopback_socket_guard.py" main.py'
        self.assertIn(registration, stage)

    def test_staged_venv_is_isolated_and_built_at_its_final_path(self) -> None:
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        self.assertIn('BUILDER_PYTHON="${BUILDER_PYTHON:-/usr/bin/python3.12}"', stage)
        self.assertIn('"${BUILDER_PYTHON}" -m venv "${RUNTIME_DIR}/venv"', stage)
        self.assertNotIn("--system-site-packages", stage)
        self.assertNotRegex(stage, r"\bmv\b[^\n]*venv")
        building_publish = 'mv "${RUNTIME_DIR}/.BUILDING.tmp" "${RUNTIME_DIR}/BUILDING"'
        ready_publish = 'mv "${RUNTIME_DIR}/.READY.tmp" "${RUNTIME_DIR}/READY"'
        self.assertLess(stage.index(building_publish), stage.rindex(ready_publish))

    def test_staging_snapshots_source_and_hashes_relative_names_and_bytes(self) -> None:
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        snapshot = stage.index('SOURCE_SNAPSHOT_TMP="$(mktemp -d')
        source_rebind = stage.index('SOURCE_DIR="${RUNTIME_DIR}/source"')
        first_source_use = stage.index('python3 "${SOURCE_DIR}/patch_comfy_sdxl_pooled.py"')
        self.assertLess(snapshot, source_rebind)
        self.assertLess(source_rebind, first_source_use)
        self.assertIn('digest.update(struct.pack(">I", len(name)))', stage)
        self.assertIn('digest.update(struct.pack(">Q", len(data)))', stage)
        self.assertNotIn('sha256sum "${SOURCE_DIR}/${relative}"', stage)

        def digest(root: Path, names: tuple[str, ...]) -> str:
            result = hashlib.sha256()
            for relative in names:
                name = relative.encode("utf-8")
                data = (root / relative).read_bytes()
                result.update(struct.pack(">I", len(name)))
                result.update(name)
                result.update(struct.pack(">Q", len(data)))
                result.update(data)
            return result.hexdigest()

        names = ("a", "nested/b")
        left = self.root / "left"
        right = self.root / "different-prefix" / "right"
        for root in (left, right):
            (root / "nested").mkdir(parents=True)
            (root / "a").write_bytes(b"same-a")
            (root / "nested" / "b").write_bytes(b"same-b")
        self.assertEqual(digest(left, names), digest(right, names))
        (right / "nested" / "b").write_bytes(b"changed")
        self.assertNotEqual(digest(left, names), digest(right, names))

    def test_staging_guards_model_tree_around_intentional_alias_creation(self) -> None:
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        initial = stage.index('snapshot_model_tree "${RUNTIME_DIR}/model-tree.initial"')
        prepare = stage.index('python3 "${RUNTIME_DIR}/runtime_preflight.py" "${preflight_args[@]}"')
        prepared = stage.index('snapshot_model_tree "${RUNTIME_DIR}/model-tree.prepared"')
        after = stage.index('snapshot_model_tree "${RUNTIME_DIR}/model-tree.after-registration"')
        self.assertLess(initial, prepare)
        self.assertLess(prepare, prepared)
        self.assertLess(prepared, after)

    def test_sealed_runtime_pins_blackwell_torch_trio(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        stage = (ROOT / "stage_mdcln_runtime.sh").read_text(encoding="utf-8")
        launcher = (ROOT / "launch_mdcln_runtime.sh").read_text(encoding="utf-8")
        for source in (dockerfile, stage, launcher):
            self.assertIn("2.8.0", source)
            self.assertIn("12.8", source)
        self.assertIn("torchvision==0.23.0", dockerfile)
        self.assertIn("torchaudio==2.8.0", dockerfile)


if __name__ == "__main__":
    unittest.main()
