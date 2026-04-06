/**
 * Soul-X image generation service.
 * Submits to a dedicated RunPod endpoint (RUNPOD_SOULX_ENDPOINT_ID).
 * Two workflow variants:
 *   - soulx_nolora_api.json  → no character identity
 *   - soulx_lora_api.json    → with character LoRA
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_SOULX_ENDPOINT_ID = process.env.RUNPOD_SOULX_ENDPOINT_ID;
const RUNPOD_NSFW_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const RUNPOD_UPSCALER_ENDPOINT_ID = process.env.RUNPOD_UPSCALER_ENDPOINT_ID;
const SOULX_ALLOW_SHARED_ENDPOINT = String(process.env.SOULX_ALLOW_SHARED_ENDPOINT || "").trim() === "1";

if (!RUNPOD_SOULX_ENDPOINT_ID) {
  console.warn("⚠️  RUNPOD_SOULX_ENDPOINT_ID not set — Soul-X will not work");
}

// Credit costs
export const SOULX_CREDITS = {
  noModel_1: 10,
  withModel_1: 15,
  noModel_2: 15,
  withModel_2: 25,
};

// Use node 369 (post-generation SaveImage, before SeedVR2 upscale).
// The SeedVR2 nodes (370-373) are stripped at build time to avoid OOM on the worker.
export const SOULX_OUTPUT_NODE = "369";
// SeedVR2 upscaler nodes to remove from workflow to reduce VRAM usage
const SOULX_UPSCALE_NODES = ["370", "371", "372", "373"];

// Aspect ratio presets matching CR SDXL Aspect Ratio node values
const ASPECT_RATIO_MAP = {
  "1:1":  "1:1 square 1024x1024",
  "9:16": "9:16 portrait 768x1344",
  "16:9": "16:9 landscape 1344x768",
  "3:4":  "3:4 portrait 896x1152",
  "4:3":  "4:3 landscape 1152x896",
};

function loadWorkflow(variant) {
  const filename = variant === "lora" ? "soulx_lora_api.json" : "soulx_nolora_api.json";
  const candidates = [
    path.join(process.cwd(), "runpod-mdcln", "workflows", filename),
    path.join(__dirname, "..", "..", "runpod-mdcln", "workflows", filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch (e) {
        console.error(`[SoulX] Failed to parse ${filename}:`, e.message);
        return null;
      }
    }
  }
  console.error(`[SoulX] ${filename} not found in:`, candidates);
  return null;
}

/**
 * Build the ComfyUI payload for a Soul-X generation.
 * @param {object} opts
 * @param {string} opts.prompt - User prompt
 * @param {string} [opts.aspectRatio] - "1:1" | "9:16" | "16:9" | "3:4" | "4:3"
 * @param {string|null} [opts.loraUrl] - Character LoRA URL (null = no-lora variant)
 * @param {number} [opts.loraStrength] - LoRA strength 0-1
 * @param {string} [opts.triggerWord] - Character trigger word to prepend to prompt
 */
export function buildSoulXPayload({
  prompt,
  aspectRatio = "9:16",
  loraUrl = null,
  loraStrength = 0.8,
  triggerWord = null,
  steps = 50,
  cfg = 2,
}) {
  const variant = loraUrl ? "lora" : "nolora";
  const wf = loadWorkflow(variant);
  if (!wf) throw new Error("Soul-X workflow not found");

  // Strip SeedVR2 upscaler nodes to avoid OOM — output comes from node 369 directly
  for (const nodeId of SOULX_UPSCALE_NODES) {
    delete wf[nodeId];
  }

  // Randomise seed
  if (wf["57"]) {
    wf["57"].inputs.seed = Math.floor(Math.random() * 2 ** 32);
  }

  // Patch prompt — prepend trigger word if using character
  let finalPrompt = (prompt || "").trim();
  if (triggerWord && finalPrompt && !finalPrompt.toLowerCase().includes(triggerWord.toLowerCase())) {
    finalPrompt = `${triggerWord}, ${finalPrompt}`;
  }

  // Some workers do not have the custom "String Literal" node.
  // Inline text directly into CLIPTextEncode nodes to avoid workflow validation failures.
  const negativeFromNode41 =
    typeof wf["41"]?.inputs?.string === "string"
      ? wf["41"].inputs.string
      : "";
  if (wf["2"]?.inputs) {
    wf["2"].inputs.text = finalPrompt;
  }
  if (wf["1"]?.inputs && typeof wf["1"].inputs.text !== "string") {
    wf["1"].inputs.text = negativeFromNode41;
  }
  delete wf["41"];
  delete wf["56"];

  // Patch aspect ratio
  const arValue = ASPECT_RATIO_MAP[aspectRatio] || ASPECT_RATIO_MAP["9:16"];
  if (wf["50"]) {
    wf["50"].inputs.aspect_ratio = arValue;
  }

  // Default quality tuning for Soul-X
  if (wf["276"]?.inputs) {
    const safeSteps = Math.max(1, Math.min(100, Math.round(Number(steps) || 50)));
    wf["276"].inputs.steps = safeSteps;
    if (cfg != null) {
      const parsedCfg = Number(cfg);
      const safeCfg = Math.max(0, Math.min(6, Number.isFinite(parsedCfg) ? parsedCfg : 2));
      wf["276"].inputs.cfg = safeCfg;
    }
  }

  // Patch LoRA if applicable
  if (variant === "lora" && wf["374"]) {
    const strength = Math.min(1, Math.max(0, Number(loraStrength) || 0.8));
    wf["374"].inputs.lora_1_url = loraUrl;
    wf["374"].inputs.lora_1_strength = strength;
    wf["374"].inputs.lora_1_model_strength = strength;
    wf["374"].inputs.lora_1_clip_strength = strength;
  }

  return {
    prompt: wf,
    output_node_id: SOULX_OUTPUT_NODE,
    output_type: "image",
  };
}

/**
 * Submit a Soul-X generation job to RunPod.
 * Returns the RunPod job ID.
 */
export async function submitSoulXJob(opts, webhookUrl = null) {
  if (!RUNPOD_API_KEY || !RUNPOD_SOULX_ENDPOINT_ID) {
    throw new Error("Soul-X service not configured (missing RUNPOD_API_KEY or RUNPOD_SOULX_ENDPOINT_ID)");
  }
  const overlapsNsfw = RUNPOD_NSFW_ENDPOINT_ID && RUNPOD_SOULX_ENDPOINT_ID === RUNPOD_NSFW_ENDPOINT_ID;
  const overlapsUpscaler =
    RUNPOD_UPSCALER_ENDPOINT_ID && RUNPOD_SOULX_ENDPOINT_ID === RUNPOD_UPSCALER_ENDPOINT_ID;
  if (overlapsNsfw || overlapsUpscaler) {
    if (!SOULX_ALLOW_SHARED_ENDPOINT) {
      throw new Error(
        "Soul-X endpoint misconfigured: RUNPOD_SOULX_ENDPOINT_ID overlaps another endpoint. " +
          "Set a dedicated endpoint, or set SOULX_ALLOW_SHARED_ENDPOINT=1 to override.",
      );
    }
    console.warn(
      "[SoulX] WARNING: shared endpoint override enabled (SOULX_ALLOW_SHARED_ENDPOINT=1). " +
        "Soul-X jobs may compete with NSFW/upscaler capacity.",
    );
  }

  const payload = buildSoulXPayload(opts);
  const base = `https://api.runpod.ai/v2/${RUNPOD_SOULX_ENDPOINT_ID}`;
  console.log(
    `[SoulX] submit endpoint=${RUNPOD_SOULX_ENDPOINT_ID} output_node=${payload.output_node_id} has_lora=${!!opts?.loraUrl}`,
  );

  const body = { input: payload };
  if (webhookUrl) {
    body.webhook = webhookUrl;
    console.log(`[SoulX] webhook: ${webhookUrl.slice(0, 80)}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const resp = await fetch(`${base}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Soul-X submit failed ${resp.status}: ${text.slice(0, 400)}`);
  }

  const data = await resp.json();
  const jobId = data.id;
  if (!jobId) throw new Error(`Soul-X submit returned no job id: ${JSON.stringify(data)}`);

  console.log(`[SoulX] Job submitted: ${jobId}`);
  return jobId;
}

/**
 * Poll a Soul-X RunPod job for status.
 */
export async function pollSoulXJob(runpodJobId) {
  if (!RUNPOD_API_KEY || !RUNPOD_SOULX_ENDPOINT_ID) {
    throw new Error("Soul-X service not configured");
  }

  const base = `https://api.runpod.ai/v2/${RUNPOD_SOULX_ENDPOINT_ID}`;
  const url = `${base}/status/${runpodJobId}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Soul-X poll failed ${resp.status}: ${text.slice(0, 400)}`);
      }
      return resp.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const cause = err.cause?.message || err.cause?.code || "";
      console.warn(`[SoulX] poll attempt ${attempt}/3 failed: ${err.message}${cause ? ` (${cause})` : ""}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

/**
 * Extract base64 image data from a completed RunPod Soul-X job.
 * Returns array of base64 strings (one per generated image).
 */
export function extractSoulXImages(runpodOutput) {
  const out = runpodOutput?.output ?? runpodOutput;
  if (!out) return [];

  // handler.py encodes images as { filename, node_id, base64 }
  const images = out.images;
  if (Array.isArray(images) && images.length > 0) {
    return images.map((img) => {
      if (typeof img === "string") return img;
      if (img?.base64) return img.base64;
      if (img?.data) return img.data;
      if (img?.url) return img.url;
      return null;
    }).filter(Boolean);
  }

  // Flat base64
  if (typeof out === "string" && out.length > 100) return [out];

  return [];
}
