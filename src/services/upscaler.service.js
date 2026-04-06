/**
 * SeedVR2 image upscaler service.
 * Submits to a dedicated RunPod endpoint (RUNPOD_UPSCALER_ENDPOINT_ID).
 * Workflow: LoadImage → SeedVR2VideoUpscaler → SaveImage
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_UPSCALER_ENDPOINT_ID = process.env.RUNPOD_UPSCALER_ENDPOINT_ID;

if (!RUNPOD_UPSCALER_ENDPOINT_ID) {
  console.warn("⚠️  RUNPOD_UPSCALER_ENDPOINT_ID not set — upscaler will not work");
}

export const UPSCALER_CREDIT_COST = 5;
// Output node in upscaler_api.json (SaveImage)
const UPSCALER_OUTPUT_NODE = "11";

function loadUpscalerWorkflow() {
  const candidates = [
    path.join(process.cwd(), "runpod-mdcln", "workflows", "upscaler_api.json"),
    path.join(__dirname, "..", "..", "runpod-mdcln", "workflows", "upscaler_api.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch (e) {
        console.error("[Upscaler] Failed to parse workflow:", e.message);
        return null;
      }
    }
  }
  console.error("[Upscaler] upscaler_api.json not found in:", candidates);
  return null;
}

export function buildUpscalerPayload(imageBase64, filename = "upscale_input.jpg") {
  const wf = loadUpscalerWorkflow();
  if (!wf) throw new Error("Upscaler workflow not found");

  // Random seed
  if (wf["13"]) {
    wf["13"].inputs.seed = Math.floor(Math.random() * 2 ** 32);
  }

  return {
    prompt: wf,
    upload_images: [
      { node_id: "12", data: imageBase64, filename },
    ],
    output_node_id: UPSCALER_OUTPUT_NODE,
    output_type: "image",
  };
}

export async function submitUpscalerJob(imageBase64, filename = "upscale_input.jpg") {
  if (!RUNPOD_API_KEY || !RUNPOD_UPSCALER_ENDPOINT_ID) {
    throw new Error("Upscaler service not configured (missing RUNPOD_API_KEY or RUNPOD_UPSCALER_ENDPOINT_ID)");
  }

  const payload = buildUpscalerPayload(imageBase64, filename);
  const base = `https://api.runpod.ai/v2/${RUNPOD_UPSCALER_ENDPOINT_ID}`;

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
    throw new Error(`Upscaler submit failed ${resp.status}: ${text.slice(0, 400)}`);
  }

  const data = await resp.json();
  const jobId = data.id;
  if (!jobId) throw new Error(`Upscaler submit returned no job id: ${JSON.stringify(data)}`);

  console.log(`[Upscaler] Job submitted: ${jobId}`);
  return jobId;
}

export async function pollUpscalerJob(runpodJobId) {
  if (!RUNPOD_API_KEY || !RUNPOD_UPSCALER_ENDPOINT_ID) {
    throw new Error("Upscaler service not configured");
  }

  const base = `https://api.runpod.ai/v2/${RUNPOD_UPSCALER_ENDPOINT_ID}`;
  const resp = await fetch(`${base}/status/${runpodJobId}`, {
    headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upscaler poll failed ${resp.status}: ${text.slice(0, 400)}`);
  }

  return resp.json();
}

/**
 * Extract the base64-encoded output image from a completed RunPod upscaler job.
 * The handler returns { output: { images: [{data: base64, ...}] } }
 */
export function extractUpscalerImage(runpodOutput) {
  const out = runpodOutput?.output ?? runpodOutput;
  if (!out) return null;

  const images = out.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === "string") return first; // raw base64
    if (first?.data) return first.data;
    if (first?.url) return first.url;
  }

  // Flat base64 string
  if (typeof out === "string" && out.length > 100) return out;

  return null;
}
