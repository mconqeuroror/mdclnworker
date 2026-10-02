# Validation record — 2026-10-02 UTC

Candidate `551648aadcafe98f91d9c039848f93273b43995d90b602aeaccc01e5d7e95139` preserves the sealed v2 runtime, models and existing addon archive. Source EU-RO-1 and replica US-IL-1 CPU registration passed the same 28 node types, 22 custom-node directories and 16 model checks. Temporary staging CPUs were removed.

Source local-addon GPU fixture03 completed on an RTX 4090. Run `dc8094c6-522f-49a6-a536-2b4d1f3f3549`, job `9e284812-f908-433b-8b10-930d909880bb-e2`: queue 279.180 s, execution 98.550 s. The 512×512 PNG was inspected and its SHA-256 is `8810d5389fc36bdb251d5f13ae1b0ad1819c909563fefd4f79de89a9961dc8b7`. Exact boot/archive/TLS/actual-Comfy-Torch evidence passed; the canary was parked with min/max 0. This queue time is within the requested approximately five-minute startup tolerance. It is one sample, about 63 s shorter than the earlier thin source sample, not a guaranteed latency bound.

Replica local-addon run `dbdb03d2-09ca-4c55-ba4f-d050d70408a6`, job `9d995656-c566-4bd2-80fd-a4aaf4003770-e2`, was cancelled while still queued at 22:06:04 UTC after the user requested finalization. The original RTX 4090 worker authenticated the archive and passed all startup checks; its handler reached readiness after 457.778 seconds, but the job produced no render. Its live GraphQL `pod` record returned the exact reviewed `dockerArgs` fingerprint; no missing-command hash was treated as proof.

Production endpoint/template/routing are unchanged. The regional runtime checks do not replace the still-required production worker/template/command and owned production-render proof before deployment. No warm workers or further optimization experiment was introduced. The source remains the production fallback.

The complete 41-test worker-repository suite passed, including six focused Python archive/relocation/Torch tests. The operator workspace separately retains CPU logs, canonical canary proofs, representative PNGs and promotion draft tooling. Benchmark scripts, raw result blobs, private configuration and bytecode are excluded from this serving-code change.
