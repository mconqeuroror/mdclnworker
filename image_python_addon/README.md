# Portable Python addon for the sealed image worker

This additive runtime lets the existing `mdcln-v0172-torch28-v2-20261002` seal run on pinned Ubuntu 22.04 without pulling the 13 GiB PyTorch image. It does not change the original interpreter symlink, installed Python packages, Comfy code, or model files. Actual GPU compatibility is gated by the separate depth-and-LoRA canary on each placement.

Pins:

- Ubuntu: `ubuntu:22.04@sha256:08ea48a03a3e78ebc7cd526e6a275053223aadd88bfc09cc49b06d5281525fde`.
- Python: Astral python-build-standalone release `20260211`, CPython `3.12.12`, `x86_64-unknown-linux-gnu-install_only_stripped`.
- Python archive: SHA-256 `1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c`, 33,887,801 bytes.
- Addon path: `/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211`.
- Native package versions and archive checksums: `native-packages.lock.json`. The closure is resolved against an empty dpkg status so installed CPU-Pod bootstrap packages cannot conceal missing serving-image dependencies. The Ubuntu base supplies glibc; the addon does not replace its loader or libc.

Run provisioning only on an owned Ubuntu 22.04 CPU staging Pod after independently verifying its source volume is `mevpt9ccol` in `EU-RO-1`. Never run these provisioning commands in a serving worker's startup path. The source runtime must already have its complete full and critical seals verified. Python staging requires a new addon path, or an exact owned partial Python-only staging marker; it refuses an established addon.

With this directory copied onto that Pod:

```bash
set -euo pipefail
curl --fail --location 'https://github.com/astral-sh/python-build-standalone/releases/download/20260211/cpython-3.12.12%2B20260211-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz' \
  -o /tmp/image-thin-python.tar.gz
printf '%s  %s\n' 1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c /tmp/image-thin-python.tar.gz | sha256sum --check --status
for file in probe_cpu.py run_cpu_preflight.py launch_image_thin_candidate.sh addon-plan.json; do
  install -m 0644 "$file" "/tmp/$file"
done
SOURCE_VOLUME_ID=mevpt9ccol python3 -B stage_python_addon.py
NATIVE_PACKAGE_LOCK="$PWD/native-packages.lock.json" bash stage_native_closure.sh
python3 -B /runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211/run_cpu_preflight.py
python3 -B seal_addon.py
```

If a pinned package is no longer available, provisioning fails rather than accepting a replacement. Retain the package download cache or mirror those exact archives for future rebuilds. The package lock verifies the downloaded bytes before READY can be produced.

The CPU preflight requires Ubuntu 22.04/glibc 2.35, the exact Python ABI and sealed package location, 27 interpreter/native checks, a small Torch CPU operation, and registration of every required Comfy node with outbound Python sockets denied. It records model metadata before and after and rechecks the 12 critical runtime files; it does not rehash the 115 GB model tree. Its private logs live under `/tmp/image-thin-*`. It never imports the RunPod job handler.

The separate launcher verifies all addon regular-file hashes and exact symlink targets, the critical base seal, Python/Torch versions, and the offline CPU proof. The overlay venv's only external package link points to the original sealed site-packages. Native loader paths include PulseAudio and BLAS/LAPACK package-private directories. Font lookup is mapped to six already-staged DejaVu fonts. Startup runs the original sealed `start.sh`; it does not run apt, pip, git clone, or model downloads.

After READY, create the archive without following symbolic links and without archive hardlinks:

```bash
set -euo pipefail
addon_parent=/runpod-volume/mdcln-runtime-addons
addon_name=cpython-3.12.12-20260211
tar --format=posix --hard-dereference -C "$addon_parent" -cf - "$addon_name" | gzip -1 > "$addon_parent/$addon_name.tar.gz"
sha256sum "$addon_parent/$addon_name.tar.gz"
```

Copy only this addon to the same absolute path on the target volume, verifying its archive, regular-file and symlink checksums. Existing destinations must pass full addon verification before reuse. Preserve the original sealed runtime and models. Run the same Ubuntu CPU preflight on the destination and bind its separate proof to `d4ki71blpr` / `US-IL-1` before a serving canary is created.

For the GPU canary use a plain `bash -lc` launch string, not JSON entrypoint/cmd text. Bootstrap and loopback fixture helpers must use the addon Python, because bare Ubuntu does not have `/usr/bin/python3.12`. Keep the production GPU selection/exclusions, set only the temporary canary to min0/max1, run fixture 03, and retain exact build markers and all four offline boot markers while the worker is alive. Report provider queue delay separately from execution and endpoint-creation lead time. Provider preallocation means min0 alone does not prove a zero-worker cold start.

## Retained source CPU evidence

`source-cpu-proof.json` records the completed October 2, 2026 source test on the pinned Ubuntu 22.04 CPU Pod: all 27 core checks, all required nodes registered with outbound Python sockets denied, 489 model metadata entries unchanged, and the 12 critical original runtime files reverified. Registration took 237.5 seconds. This evidence does not claim GPU rendering or a destination test.

The sealed additive file manifest is `bdc51b6bc447cb9fc7444f84c6eb18c284b3d03b1f38f9ffd12f0aac0e1d40fb`; the launcher is `0094be811d2d75291e179b06242d6f3dc86b908231e0bebb702dcd5cf588a5e8`. The source archive is 386,050,882 bytes with SHA-256 `f450987ebd185afca9218d1062ff1e9bef2fb7f86179c8089840d1eff82311de`. Its S3 HEAD size matched on the source bucket. The proof's `addonRegularBytes` counts the tree before its generated symlink-manifest file; the archive size above is exact for transfer accounting.

The first source thin endpoint creation returned a provider error and no endpoint ID. A read-only inventory confirmed that the requested unique endpoint name did not exist. This is not GPU boot or render evidence; its original create-intent journal is retained, and any later attempt uses a fresh run ID.

A separate read-only loader audit (`source-native-loader-audit.json`) resolved 205 FFmpeg dependencies and six portable-Python dependencies with no unexpected host fallback. The only allowed host libraries were the pinned Ubuntu glibc family; other dependencies resolved inside the additive or sealed native roots.

### Canary bootstrap bytecode guard

The fixture wrapper must export `PYTHONDONTWRITEBYTECODE=1` before its first interpreter invocation and pass `-B` to each helper. The sealed launcher already sets the environment before Python. Starting a helper earlier without this guard changes the portable interpreter encoding bytecode and correctly fails its integrity check. Source incident 95d393bc was restored to the exact original addon seal; the immutable archive was unaffected. The regression executes a real loopback fixture server and verifies no writable bytecode-cache changes.

Production has no `NSFW_COMFY_BYPASS_UPSCALE` override, so thin GPU canaries now use default 0 and require `4xFaceUpDAT.pth` at boot. That file is present at 154,685,478 bytes. This variable controls only a required-file check, not the submitted inference graph. Original sealed/addon hashes remain unchanged. Both source and replica representative depth-and-LoRA GPU proofs are still required before promotion.

### Required TLS guard for the bare Ubuntu image

Embed `sealed_tls_guard.sh` at the start of the provider's plain-bash command, before any Python helper or launcher. Its body is also shared by the source/replica canary and production command builders. Do not install the guard into the immutable addon or change its archive: the guard selects the existing certificate file from the original full runtime seal.

The guard verifies the regular certificate bundle at `mdcln-v0172-torch28-v2-20261002/venv/lib/python3.12/site-packages/certifi/cacert.pem`, SHA256 `9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f`, then exports its absolute path as `SSL_CERT_FILE`. It also disables Python bytecode writes. Keep explicit `-B` on fixture helpers. A missing, symlinked or changed bundle stops startup before Python. TLS verification remains enabled; no certificates are downloaded.

The pinned Ubuntu OCI layer has no certificate store. A controlled probe of the installed SDK's async HTTP session reproduced certificate verification failure with the empty trust store and verified TLS successfully with this sealed certifi bundle. The SDK's synchronous and asynchronous clients have different default trust behavior, so a successful import or synchronous request does not prove job-polling TLS works. The retired GPU worker's final exception was unavailable; this probe proves the trust-store defect, not that it was the only startup problem.

The local TLS regression starts a localhost TLS server, proves an untrusted request fails, and proves the guard supplies validated trust to a child process. It also verifies that missing/corrupted bundle bytes prevent the child from running. Retain sanitized exception lines, node-import timings and system stop/start events during every live canary; readiness markers alone cannot establish a render or explain a later handler failure. GPU proofs now bind the CA digest and require its successful boot marker.

`production_launch.sh` contains the exact reviewed default production command body, including the outer TLS guard and pinned addon gates, with no fixture helper. Generate the provider's plain-bash argument locally from the repository root:

```bash
printf "bash -lc 'printf %%s %s | base64 -d | bash'\n" "$(base64 -w0 image_python_addon/production_launch.sh)"
```

This only formats the command; it does not deploy. Use it with the pinned Ubuntu image after both placement GPU proofs qualify, preserving the current production environment and endpoint settings. The promotion regression requires byte-for-byte equality between this file and the reviewed command builder. The default required-model policy remains 0. Do not copy this outer script into the immutable addon archive.
