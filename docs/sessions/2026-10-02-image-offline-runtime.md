# Image worker session — 2026-10-02 UTC

## User request

Remove serving-time dependency/model installation, preserve the existing image workflow behavior, prepare verified regional replicas, and improve cold startup without warm workers. Finish the current regional tests and push the reviewed worker code; production deployment remains gated by its own worker and render proof.

## What changed

The Docker build and node setup now pin the base image, Python/Torch dependency constraints and custom-node commits. The five nodes formerly installed at boot are built in advance. Submodule setup and the DepthAnything core patch are reproducible; ComfyUI-Manager startup downloads are excluded. `start.sh` validates model sizes, directories and registered workflow nodes before starting the unchanged handler contract. Job-time KIE and user LoRA requests remain supported.

The sealed-runtime staging and launch scripts create an isolated final-path Python 3.12 runtime, native-library closure, node lock and immutable READY/checksum manifests. An explicitly owned failed, unsealed staging attempt can resume through the same checks. Model aliases, loopback-only CPU registration and strict preflight are covered by focused tests. The complete source-to-US-IL-1 model/runtime replica was verified, including the full sealed runtime closure.

`image_python_addon/` adds pinned CPython 3.12.12 and its native closure for the pinned Ubuntu 22.04 base, avoiding the earlier large PyTorch container pull. Provisioning is separate from serving. The existing sealed certifi bundle is SHA-bound and selected before any Python invocation; TLS verification remains enabled. Bytecode writes are disabled before bootstrap and helper execution.

`image_runtime_pack/` authenticates and safely extracts the existing 386,050,882-byte addon archive into a unique local directory per boot. Models, ComfyUI and site-packages remain on the unchanged sealed volume. Only the local venv paths are relocated. A one-shot import hook validates the actual Comfy process's completed Torch import and CUDA availability, removing a redundant standalone import. Required coverage remains 28 node types, 22 custom-node directories and 16 model files with production upscale policy 0. Candidate build: `551648aadcafe98f91d9c039848f93273b43995d90b602aeaccc01e5d7e95139`.

Source EU-RO-1 fixture03 passed on an RTX 4090: provider queue/start delay 279.180 s, execution 98.550 s, valid inspected 512×512 PNG. Exact archive, TLS, launcher and actual-Comfy-Torch boot proof passed; the source canary is parked at min/max 0. Replica US-IL-1 run `dbdb03d2-09ca-4c55-ba4f-d050d70408a6` remained queued for more than seven minutes and was cancelled at 22:06:04 UTC as the user requested finalization. Its original RTX 4090 worker eventually passed all startup checks at 22:06:01 (457.778 seconds after submission), but the cancelled job produced no replica render. This is incomplete render evidence, not an observed model execution failure.

Source and replica CPU registration passed all required types with the exact candidate. Root ran the complete 41-test worker-repository suite successfully, including build/preflight, portable-addon and six local-addon regression tests. Separately, 24 canary/operator tests passed. Benchmark-only profiling scripts, raw live results, private config and bytecode are outside this commit; `.gitignore` excludes bytecode.

## Why

Build-time provisioning and sealed volumes make missing or changed dependencies fail before serving rather than trigger boot downloads. The portable addon makes the base container smaller. Local interpreter/native files and avoiding a second Torch import reduce repeated reads from network storage while retaining the same required workflow nodes and shared weights. Safe extraction, exact fingerprints and retained runtime proofs make the candidate reviewable and reproducible.

## Gotchas

Production endpoint, template and routes have not been changed. Regional canaries do not replace the required production worker/template/command proof and owned production render. Promotion tooling remains an unfinished operator-workspace draft and is excluded from this worker-code change.

The source delay is within the requested approximately five-minute tolerance and about 63 s below the earlier thin source sample, but it is one observation with provider/storage variance, not a latency guarantee. The replica candidate did not meet the intended startup wait and has no completed render; production promotion remains blocked. No warm workers were introduced. Original full-base source fixtures01/03/04 and earlier thin regional fixture03 results are historical evidence; they do not prove every external KIE/LoRA case or B200 kernel compatibility.

Keep the existing runtime, addon and seals immutable. Do not rename a staged shared venv, use an unverified partial extraction, disable TLS, restore boot-time package downloads, or equate a missing provider command field with a command proof. The current source remains the production fallback. All temporary staging CPUs were deleted after proof.
