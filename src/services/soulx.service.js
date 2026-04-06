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

export const SOULX_OUTPUT_NODE = "373";

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
export function buildSoulXPayload({ prompt, aspectRatio = "9:16", loraUrl = null, loraStrength = 0.8, triggerWord = null }) {
  const variant = loraUrl ? "lora" : "nolora";
  const wf = loadWorkflow(variant);
  if (!wf) throw new Error("Soul-X workflow not found");

  // Randomise seed
  if (wf["57"]) {
    wf["57"].inputs.seed = Math.floor(Math.random() * 2 ** 32);
  }

  // Patch prompt — prepend trigger word if using character
  let finalPrompt = (prompt || "").trim();
  if (triggerWord && finalPrompt && !finalPrompt.toLowerCase().includes(triggerWord.toLowerCase())) {
    finalPrompt = `${triggerWord}, ${finalPrompt}`;
  }
  if (wf["56"]) {
    wf["56"].inputs.string = finalPrompt;
  }

  // Patch aspect ratio
  const arValue = ASPECT_RATIO_MAP[aspectRatio] || ASPECT_RATIO_MAP["9:16"];
  if (wf["50"]) {
    wf["50"].inputs.aspect_ratio = arValue;
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
export async function submitSoulXJob(opts) {
  if (!RUNPOD_API_KEY || !RUNPOD_SOULX_ENDPOINT_ID) {
    throw new Error("Soul-X service not configured (missing RUNPOD_API_KEY or RUNPOD_SOULX_ENDPOINT_ID)");
  }

  const payload = buildSoulXPayload(opts);
  const base = `https://api.runpod.ai/v2/${RUNPOD_SOULX_ENDPOINT_ID}`;

  const resp = await fetch(`${base}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: payload }),
    signal: AbortSignal.timeout(25_000),
  });

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
