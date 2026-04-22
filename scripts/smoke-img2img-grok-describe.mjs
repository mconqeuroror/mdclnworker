#!/usr/bin/env node
/**
 * Smoke test for the new Grok-based img2img describe step.
 *
 * - Verifies that src/services/img2img.service.js loads without syntax errors
 * - Verifies that the public exports are intact and that the legacy
 *   JoyCaption/RunPod-captioner exports are gone
 * - If OPENROUTER_API_KEY + SMOKE_IMAGE_URL are set in the env, runs a real
 *   round-trip through extractPromptFromImage() against an actual image
 *
 * Run:
 *   node scripts/smoke-img2img-grok-describe.mjs
 *
 * Optional env:
 *   OPENROUTER_API_KEY=...  (required for the live call)
 *   SMOKE_IMAGE_URL=https://example.com/image.jpg
 */

import "dotenv/config";

const PASS = "\u2705";
const FAIL = "\u274c";
const INFO = "\u2139\ufe0f ";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`${PASS} ${name}${detail ? "  " + detail : ""}`);
  } else {
    console.error(`${FAIL} ${name}${detail ? "  " + detail : ""}`);
    failures += 1;
  }
}

const svc = await import("../src/services/img2img.service.js");

check("module loads", typeof svc === "object" && svc !== null);

const expectedExports = [
  "extractPromptFromImage",
  "injectModelIntoPrompt",
  "generateImg2Img",
  "runImg2ImgPipeline",
  "submitImg2ImgJob",
  "generateNsfwTxt2Img",
  "getRunpodJobStatus",
  "isRunpodJobIdValidationError",
  "parseRunpodHandlerOutput",
  "normalizeRunpodStatusResponse",
];
for (const name of expectedExports) {
  check(`export present: ${name}`, typeof svc[name] === "function");
}

const removedExports = [
  "submitDescribeJob",
  "extractCaptionFromRunpodOutput",
  "classifyRunpodDescribePhase",
];
for (const name of removedExports) {
  check(`legacy export removed: ${name}`, svc[name] === undefined);
}

check(
  "extractPromptFromImage signature",
  svc.extractPromptFromImage.length >= 1,
  `(arity=${svc.extractPromptFromImage.length})`,
);

const liveImage = process.env.SMOKE_IMAGE_URL;
const hasKey = !!process.env.OPENROUTER_API_KEY;

if (!liveImage || !hasKey) {
  console.log(
    `\n${INFO} Skipping live Grok call (set OPENROUTER_API_KEY and SMOKE_IMAGE_URL to run it).`,
  );
} else {
  console.log(`\n${INFO} Running live Grok describe against ${liveImage} ...`);
  try {
    const caption = await svc.extractPromptFromImage(liveImage, null);
    check(
      "live Grok describe returned text",
      typeof caption === "string" && caption.trim().length > 30,
      `(${caption ? caption.length : 0} chars)`,
    );
    console.log(`\n--- caption preview ---\n${(caption || "").slice(0, 500)}\n--- end ---`);
  } catch (err) {
    check("live Grok describe", false, err?.message || String(err));
  }
}

if (failures > 0) {
  console.error(`\n${FAIL} ${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
