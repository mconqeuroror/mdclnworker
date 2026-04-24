/**
 * ModelClone-X image generation (formerly Soul-X).
 * RunPod: RUNPOD_MODELCLONE_X_ENDPOINT_ID, or legacy RUNPOD_SOULX_ENDPOINT_ID.
 * Workflows: modelclonex_*_api.json, with fallback to soulx_*_api.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
// Dedicated NSFW endpoint, falls back through the chain to the default worker.
const RUNPOD_MODELCLONE_X_ENDPOINT_ID =
  String(
    process.env.RUNPOD_NSFW_ENDPOINT_ID ||
    process.env.RUNPOD_MODELCLONE_X_ENDPOINT_ID ||
    process.env.RUNPOD_ENDPOINT_ID ||
    process.env.RUNPOD_SOULX_ENDPOINT_ID ||
    "",
  ).trim() || null;

if (!RUNPOD_MODELCLONE_X_ENDPOINT_ID) {
  console.warn("⚠️  No RunPod endpoint configured (RUNPOD_ENDPOINT_ID / RUNPOD_MODELCLONE_X_ENDPOINT_ID) — ModelClone-X will not work");
} else {
  const resolvedFrom = process.env.RUNPOD_NSFW_ENDPOINT_ID?.trim()
    ? "RUNPOD_NSFW_ENDPOINT_ID"
    : process.env.RUNPOD_MODELCLONE_X_ENDPOINT_ID?.trim()
      ? "RUNPOD_MODELCLONE_X_ENDPOINT_ID"
      : process.env.RUNPOD_ENDPOINT_ID?.trim()
        ? "RUNPOD_ENDPOINT_ID"
        : "RUNPOD_SOULX_ENDPOINT_ID";
  console.log(`[MCX/NSFW] endpoint=${RUNPOD_MODELCLONE_X_ENDPOINT_ID} (from ${resolvedFrom})`);
}

export const MODELCLONE_X_CREDITS = {
  noModel_1: 10,
  withModel_1: 15,
  noModel_2: 15,
  withModel_2: 25,
};

export const MODELCLONE_X_OUTPUT_NODE = "369";
/** ModelClone-X img2img (ZIT v2promax) saves from this SaveImage — must be scanned when txt2img node 369 is absent. */
const MODELCLONE_X_IMG2IMG_OUTPUT_NODE = "289";
const UPSCALE_NODES_TO_STRIP = ["370", "371", "372", "373"];

const ASPECT_RATIO_MAP = {
  "1:1": "1:1 square 1024x1024",
  "9:16": "9:16 portrait 768x1344",
  "16:9": "16:9 landscape 1344x768",
  "3:4": "3:4 portrait 896x1152",
  "4:3": "4:3 landscape 1152x896",
};

function loadWorkflow(variant) {
  const primary = variant === "lora" ? "modelclonex_lora_api.json" : "modelclonex_nolora_api.json";
  const legacy = variant === "lora" ? "soulx_lora_api.json" : "soulx_nolora_api.json";
  const candidates = [primary, legacy].flatMap((filename) => [
    path.join(process.cwd(), "runpod-mdcln", "workflows", filename),
    path.join(__dirname, "..", "..", "runpod-mdcln", "workflows", filename),
  ]);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch (e) {
        console.error(`[ModelCloneX] Failed to parse ${path.basename(p)}:`, e.message);
        return null;
      }
    }
  }
  console.error("[ModelCloneX] No workflow JSON found (modelclonex_* or soulx_*)");
  return null;
}

export function buildModelCloneXPayload({
  prompt,
  aspectRatio = "9:16",
  loraUrl = null,
  loraStrength = 0.8,
  triggerWord = null,
  steps = null,
  cfg = 2,
}) {
  const variant = loraUrl ? "lora" : "nolora";
  const wf = loadWorkflow(variant);
  if (!wf) throw new Error("ModelClone-X workflow not found");

  for (const nodeId of UPSCALE_NODES_TO_STRIP) {
    delete wf[nodeId];
  }

  if (wf["57"]) {
    wf["57"].inputs.seed = Math.floor(Math.random() * 2 ** 32);
  }

  let finalPrompt = (prompt || "").trim();
  if (triggerWord && finalPrompt && !finalPrompt.toLowerCase().includes(triggerWord.toLowerCase())) {
    finalPrompt = `${triggerWord}, ${finalPrompt}`;
  }

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

  const arValue = ASPECT_RATIO_MAP[aspectRatio] || ASPECT_RATIO_MAP["9:16"];
  if (wf["50"]) {
    wf["50"].inputs.aspect_ratio = arValue;
  }

  if (wf["276"]?.inputs) {
    const defaultStepsForMode = loraUrl ? 50 : 20;
    const parsedSteps = Number(steps);
    const safeSteps = Math.max(
      1,
      Math.min(100, Math.round(Number.isFinite(parsedSteps) ? parsedSteps : defaultStepsForMode)),
    );
    wf["276"].inputs.steps = safeSteps;
    if (cfg != null) {
      const parsedCfg = Number(cfg);
      const safeCfg = Math.max(0, Math.min(6, Number.isFinite(parsedCfg) ? parsedCfg : 2));
      wf["276"].inputs.cfg = safeCfg;
    }
  }

  if (variant === "lora" && wf["374"]) {
    const strength = Math.min(1, Math.max(0, Number(loraStrength) || 0.8));
    wf["374"].inputs.lora_1_url = loraUrl;
    wf["374"].inputs.lora_1_strength = strength;
    wf["374"].inputs.lora_1_model_strength = strength;
    wf["374"].inputs.lora_1_clip_strength = strength;
  }

  return {
    prompt: wf,
    output_node_id: MODELCLONE_X_OUTPUT_NODE,
    output_type: "image",
  };
}

/**
 * Generic RunPod serverless submit — used by MCX, NSFW, and any other ComfyUI
 * workflow that targets the shared RunPod endpoint.
 * @param {{ input: object }} payload  Pre-built RunPod request body (`{ input: { prompt, output_node_id, … } }`)
 * @param {string|null} webhookUrl     Webhook URL for RunPod to call on completion
 * @param {string} [label]            Human-readable label for logging
 * @returns {Promise<string>}          RunPod job ID
 */
export async function submitRunpodJob(payload, webhookUrl = null, label = "RunPod") {
  if (!RUNPOD_API_KEY || !RUNPOD_MODELCLONE_X_ENDPOINT_ID) {
    throw new Error(
      `${label} service not configured (missing RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID)`,
    );
  }

  const base = `https://api.runpod.ai/v2/${RUNPOD_MODELCLONE_X_ENDPOINT_ID}`;
  const body = { ...payload };
  if (webhookUrl) {
    body.webhook = webhookUrl;
  }

  console.log(`[${label}] submit endpoint=${RUNPOD_MODELCLONE_X_ENDPOINT_ID}${webhookUrl ? ` webhook=${webhookUrl.slice(0, 80)}` : ""}`);

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
    throw new Error(`${label} submit failed ${resp.status}: ${text.slice(0, 400)}`);
  }

  const data = await resp.json();
  const jobId =
    data.id ||
    data.request_id ||
    data.requestId ||
    data.task_id ||
    data.taskId;
  if (!jobId) throw new Error(`${label} submit returned no job id: ${JSON.stringify(data)}`);

  console.log(`[${label}] Job submitted: ${jobId}`);
  return jobId;
}

export async function submitModelCloneXJob(opts, webhookUrl = null) {
  const payload = buildModelCloneXPayload(opts);
  return submitRunpodJob(
    { input: payload },
    webhookUrl,
    `ModelCloneX${opts?.loraUrl ? " (lora)" : " (no-lora)"}`,
  );
}

export async function pollModelCloneXJob(runpodJobId) {
  if (!RUNPOD_API_KEY || !RUNPOD_MODELCLONE_X_ENDPOINT_ID) {
    throw new Error("ModelClone-X service not configured");
  }

  const base = `https://api.runpod.ai/v2/${RUNPOD_MODELCLONE_X_ENDPOINT_ID}`;
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
        throw new Error(`ModelClone-X poll failed ${resp.status}: ${text.slice(0, 400)}`);
      }
      return resp.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const cause = err.cause?.message || err.cause?.code || "";
      console.warn(`[ModelCloneX] poll attempt ${attempt}/3 failed: ${err.message}${cause ? ` (${cause})` : ""}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

export function extractModelCloneXImages(runpodOutput) {
  let root = runpodOutput;
  if (root == null) return [];
  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch {
      return [];
    }
  }
  if (typeof root !== "object") return [];
  // Double-wrap: e.g. { output: { output: { images: [...] } } } (some RunPod webhooks)
  let out = root?.output ?? root;
  if (out && typeof out === "object" && out.output && (out.output.images || out.output.outputs) && !out.images) {
    out = out.output;
  }
  out = out?.output ?? out;
  if (!out || typeof out !== "object") return [];

  const asImageString = (img) => {
    if (typeof img === "string") return img;
    if (img?.base64) return img.base64;
    if (img?.data) return img.data;
    if (img?.image) return img.image;
    if (img?.url) return img.url;
    return null;
  };

  const images = out.images;
  if (Array.isArray(images) && images.length > 0) {
    return images.map(asImageString).filter(Boolean);
  }

  // Compatibility fallback: some workers return ComfyUI node outputs
  // under { outputs: { "<nodeId>": { images: [...] } } }.
  const nodeOutputs = out.outputs;
  if (nodeOutputs && typeof nodeOutputs === "object") {
    const preferred = String(MODELCLONE_X_OUTPUT_NODE);
    const i2i = String(MODELCLONE_X_IMG2IMG_OUTPUT_NODE);
    const orderedNodeIds = [
      preferred,
      i2i,
      ...Object.keys(nodeOutputs).filter((k) => k !== preferred && k !== i2i),
    ];
    for (const nodeId of orderedNodeIds) {
      const nodeImages = nodeOutputs?.[nodeId]?.images;
      if (!Array.isArray(nodeImages) || nodeImages.length === 0) continue;
      const extracted = nodeImages.map(asImageString).filter(Boolean);
      if (extracted.length > 0) return extracted;
    }
  }

  if (typeof out.base64 === "string" && out.base64.length > 100) return [out.base64];
  if (typeof out.image === "string" && out.image.length > 100) return [out.image];
  if (typeof out.data === "string" && out.data.length > 100) return [out.data];

  // Legacy wrapper variants occasionally place output under result/output_nodes.
  const node289 = out?.result?.output_nodes?.["289"]?.images;
  if (Array.isArray(node289) && node289.length > 0) {
    const extracted = node289.map(asImageString).filter(Boolean);
    if (extracted.length > 0) return extracted;
  }

  if (typeof out === "string" && out.length > 100) return [out];

  return [];
}
