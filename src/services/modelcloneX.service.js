/**
 * ModelClone-X image generation (formerly Soul-X).
 * RunPod serverless ID resolution (first match wins — explicit MCX before NSFW so a bad RUNPOD_NSFW_ENDPOINT_ID cannot override RUNPOD_ENDPOINT_ID):
 *   RUNPOD_MODELCLONE_X_ENDPOINT_ID → RUNPOD_SOULX_ENDPOINT_ID → RUNPOD_ENDPOINT_ID → RUNPOD_NSFW_ENDPOINT_ID
 * Workflows: modelclonex_*_api.json, with fallback to soulx_*_api.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildModelCloneXI2IRunpodInput } from "./img2img.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

function resolveModelCloneXRunpodEndpoint() {
  const order = [
    ["RUNPOD_MODELCLONE_X_ENDPOINT_ID", process.env.RUNPOD_MODELCLONE_X_ENDPOINT_ID],
    ["RUNPOD_SOULX_ENDPOINT_ID", process.env.RUNPOD_SOULX_ENDPOINT_ID],
    ["RUNPOD_ENDPOINT_ID", process.env.RUNPOD_ENDPOINT_ID],
    ["RUNPOD_NSFW_ENDPOINT_ID", process.env.RUNPOD_NSFW_ENDPOINT_ID],
  ];
  for (const [name, val] of order) {
    const s = String(val ?? "").trim();
    if (s) return { id: s, source: name };
  }
  return { id: null, source: null };
}

const { id: RUNPOD_MODELCLONE_X_ENDPOINT_ID, source: RUNPOD_MODELCLONE_X_ENDPOINT_SOURCE } =
  resolveModelCloneXRunpodEndpoint();

if (!RUNPOD_MODELCLONE_X_ENDPOINT_ID) {
  console.warn(
    "⚠️  No RunPod endpoint configured (set RUNPOD_MODELCLONE_X_ENDPOINT_ID, RUNPOD_ENDPOINT_ID, or RUNPOD_SOULX_ENDPOINT_ID) — ModelClone-X will not work",
  );
} else {
  console.log(
    `[ModelClone-X] RunPod endpoint=${RUNPOD_MODELCLONE_X_ENDPOINT_ID} (from ${RUNPOD_MODELCLONE_X_ENDPOINT_SOURCE})`,
  );
}

/** Used by `GET /api/modelclone-x/config` — no secrets, only “can submit jobs?”. */
export function isModelCloneXRunpodReady() {
  return Boolean(RUNPOD_API_KEY && RUNPOD_MODELCLONE_X_ENDPOINT_ID);
}

export const MODELCLONE_X_CREDITS = {
  noModel_1: 10,
  withModel_1: 15,
  noModel_2: 15,
  withModel_2: 25,
};

/** MCX 5.2 nolora SaveImage node id (lora graph uses `43`; legacy soul-x txt2img used `369`). */
export const MODELCLONE_X_OUTPUT_NODE = "42";
/** Try these SaveImage node ids when parsing txt2img RunPod output (order matters). */
const MODELCLONE_X_TXT2IMG_OUTPUT_NODE_IDS = ["42", "43", "369"];
/** ModelClone-X img2img (new mcx_i2i graph) SaveImage node id. */
const MODELCLONE_X_IMG2IMG_OUTPUT_NODE = "368";
/** Legacy MCX img2img SaveImage node id from older exports. */
const MODELCLONE_X_IMG2IMG_OUTPUT_NODE_LEGACY = "289";
const UPSCALE_NODES_TO_STRIP = ["370", "371", "372", "373"];

const ASPECT_RATIO_MAP = {
  "1:1": "1:1 square 1024x1024",
  "9:16": "9:16 portrait 768x1344",
  "16:9": "16:9 landscape 1344x768",
  "3:4": "3:4 portrait 896x1152",
  "4:3": "4:3 landscape 1152x896",
};

/** Empty latent size for MCX 5.2 AuraFlow merge graph — 2× the former 1× base (1:1 = 2048²). */
const MCX_T2I_RESOLUTION = {
  "1:1": { width: 2048, height: 2048 },
  "9:16": { width: 1536, height: 2688 },
  "16:9": { width: 2688, height: 1536 },
  "3:4": { width: 1792, height: 2304 },
  "4:3": { width: 2304, height: 1792 },
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
}) {
  const variant = loraUrl ? "lora" : "nolora";
  const wf = loadWorkflow(variant);
  if (!wf) throw new Error("ModelClone-X workflow not found");

  for (const nodeId of UPSCALE_NODES_TO_STRIP) {
    delete wf[nodeId];
  }

  let finalPrompt = (prompt || "").trim();
  if (triggerWord && finalPrompt && !finalPrompt.toLowerCase().includes(triggerWord.toLowerCase())) {
    finalPrompt = `${triggerWord}, ${finalPrompt}`;
  }

  const isLegacySoulXT2I = Boolean(wf["276"]);

  if (isLegacySoulXT2I) {
    if (wf["57"]) {
      wf["57"].inputs.seed = Math.floor(Math.random() * 2 ** 32);
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

    if (variant === "lora" && wf["374"]) {
      const strength = Math.min(1, Math.max(0, Number(loraStrength) || 0.8));
      wf["374"].inputs.lora_1_url = loraUrl;
      wf["374"].inputs.lora_1_strength = strength;
      wf["374"].inputs.lora_1_model_strength = strength;
      wf["374"].inputs.lora_1_clip_strength = strength;
    }

    return {
      prompt: wf,
      output_node_id: "369",
      output_type: "image",
    };
  }

  // MCX 5.2 T2I: dual UNET merge + AuraFlow + two KSamplerAdvanced + final KSampler (optional easy loraStackApply).
  const emptyLatentId = variant === "lora" ? "30" : "23";
  const mainEncodeId = variant === "lora" ? "33" : "25";
  const ksamplerFinalId = variant === "lora" ? "45" : "34";
  const adv1Id = variant === "lora" ? "34" : "26";
  const adv2Id = variant === "lora" ? "41" : "32";
  const outputNodeId = variant === "lora" ? "43" : "42";

  const res = MCX_T2I_RESOLUTION[aspectRatio] || MCX_T2I_RESOLUTION["9:16"];
  if (wf[emptyLatentId]?.inputs) {
    wf[emptyLatentId].inputs.width = res.width;
    wf[emptyLatentId].inputs.height = res.height;
    wf[emptyLatentId].inputs.batch_size = wf[emptyLatentId].inputs.batch_size ?? 1;
  }

  if (wf[mainEncodeId]?.inputs) {
    wf[mainEncodeId].inputs.text = finalPrompt;
  }

  const baseSeed = Math.floor(Math.random() * 2 ** 32);
  if (wf[adv1Id]?.inputs) wf[adv1Id].inputs.noise_seed = baseSeed;
  if (wf[adv2Id]?.inputs) wf[adv2Id].inputs.noise_seed = baseSeed;
  if (wf[ksamplerFinalId]?.inputs) {
    wf[ksamplerFinalId].inputs.seed = baseSeed;
  }

  if (variant === "lora" && wf["5"]?.inputs && loraUrl) {
    const strength = Math.min(1, Math.max(0, Number(loraStrength) || 0.8));
    wf["5"].inputs.mode = "simple";
    wf["5"].inputs.num_loras = 1;
    wf["5"].inputs.lora_1_url = loraUrl;
    wf["5"].inputs.lora_1_strength = strength;
    wf["5"].inputs.lora_1_model_strength = strength;
    wf["5"].inputs.lora_1_clip_strength = strength;
  }

  return {
    prompt: wf,
    output_node_id: outputNodeId,
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
    if (resp.status === 404) {
      const suffix = String(RUNPOD_MODELCLONE_X_ENDPOINT_ID || "").slice(-10);
      throw new Error(
        `${label} submit failed 404: ${text.slice(0, 240)} — RunPod: serverless endpoint not found. ` +
          `Active env: ${RUNPOD_MODELCLONE_X_ENDPOINT_SOURCE} (id …${suffix}). ` +
          `In RunPod use Serverless → Endpoints (not a Pod id). Set RUNPOD_MODELCLONE_X_ENDPOINT_ID or RUNPOD_ENDPOINT_ID to a valid endpoint id.`,
      );
    }
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

/**
 * ModelClone-X **Image → image** after Grok scene JSON + `optimizeModelCloneXPrompt`.
 * Same Z-Image Turbo + LoRA stack as MCX “prompt” txt2img: positive text in CLIP, LoRA, KSampler, reference encode.
 * (Comfy file `nsfw_img2img_v2promax_workflow.json` is a shared v2 promax graph on the same RunPod worker, not a separate “NSFW tool” Comfy run.)
 */
export async function submitModelCloneXImg2ImgJob({
  imageUrl,
  imageBase64Provided,
  prompt,
  loraUrl = null,
  loraStrength = 0.8,
  batchSize = 1,
  denoise = 0.6,
  seed,
  steps = null,
  cfg = null,
  webhookUrl: explicitWebhook = null,
} = {}) {
  const { runpodInput, resolvedSeed } = await buildModelCloneXI2IRunpodInput({
    imageUrl,
    imageBase64Provided,
    prompt,
    loraUrl,
    loraStrength,
    batchSize,
    seed,
  });
  const runpodJobId = await submitRunpodJob(
    { input: runpodInput },
    explicitWebhook,
    "ModelClone-X img2img",
  );
  return { runpodJobId, resolvedSeed };
}

function buildRunpodJobIdCandidates(runpodJobId) {
  const raw = String(runpodJobId || "").trim();
  if (!raw) return [];
  const stripped = raw.replace(/-u\d+$/i, "");
  return stripped && stripped !== raw ? [raw, stripped] : [raw];
}

export async function pollModelCloneXJob(runpodJobId) {
  if (!RUNPOD_API_KEY || !RUNPOD_MODELCLONE_X_ENDPOINT_ID) {
    throw new Error("ModelClone-X service not configured");
  }

  const base = `https://api.runpod.ai/v2/${RUNPOD_MODELCLONE_X_ENDPOINT_ID}`;
  const jobIdCandidates = buildRunpodJobIdCandidates(runpodJobId);
  if (!jobIdCandidates.length) {
    throw new Error("ModelClone-X poll failed: missing RunPod job id");
  }

  let lastErr;
  for (let idIndex = 0; idIndex < jobIdCandidates.length; idIndex++) {
    const candidateId = jobIdCandidates[idIndex];
    const hasFallbackCandidate = idIndex < jobIdCandidates.length - 1;
    const url = `${base}/status/${candidateId}`;
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
          if (resp.status === 404 && hasFallbackCandidate) {
            lastErr = new Error(`ModelClone-X poll 404 for ${candidateId}: ${text.slice(0, 200)}`);
            console.warn(`[ModelCloneX] poll 404 for ${candidateId}; trying fallback id`);
            break;
          }
          throw new Error(`ModelClone-X poll failed ${resp.status}: ${text.slice(0, 400)}`);
        }
        return resp.json();
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        const cause = err.cause?.message || err.cause?.code || "";
        console.warn(
          `[ModelCloneX] poll attempt ${attempt}/3 failed for ${candidateId}: ${err.message}${cause ? ` (${cause})` : ""}`,
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastErr;
}

export function extractModelCloneXImages(runpodOutput) {
  const parseJsonMaybe = (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  };

  const normalizeImageValue = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("data:image/")) {
      const comma = trimmed.indexOf(",");
      if (comma > -1) {
        const b64 = trimmed.slice(comma + 1).trim();
        return b64 || null;
      }
    }
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.length > 100) {
      const compact = trimmed.replace(/\s+/g, "");
      if (/^[A-Za-z0-9+/=]+$/.test(compact)) return compact;
    }
    return null;
  };

  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

  const asImageString = (img) => {
    const parsed = parseJsonMaybe(img);
    if (typeof parsed === "string") {
      return normalizeImageValue(parsed);
    }
    if (!parsed || typeof parsed !== "object") return null;

    const directKeys = [
      "base64",
      "data",
      "image",
      "url",
      "imageUrl",
      "image_url",
      "outputUrl",
      "output_url",
      "src",
      "uri",
    ];
    for (const key of directKeys) {
      const raw = parsed?.[key];
      if (typeof raw === "string") {
        const normalized = normalizeImageValue(raw);
        if (normalized) return normalized;
      }
    }

    // Some payloads wrap the URL/base64 one level deeper.
    for (const key of ["image", "data", "output"]) {
      const nested = parsed?.[key];
      if (nested && typeof nested === "object") {
        for (const nestedKey of ["url", "imageUrl", "base64", "data", "src"]) {
          const raw = nested?.[nestedKey];
          if (typeof raw === "string") {
            const normalized = normalizeImageValue(raw);
            if (normalized) return normalized;
          }
        }
      }
    }

    return null;
  };

  const collectDeepImageStrings = (input, maxDepth = 10) => {
    const collected = [];
    const seen = new Set();
    const push = (value) => {
      const normalized = normalizeImageValue(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      collected.push(normalized);
    };

    const walk = (node, depth = 0) => {
      if (depth > maxDepth || node == null) return;
      const parsed = parseJsonMaybe(node);
      if (typeof parsed === "string") {
        push(parsed);
        return;
      }
      if (Array.isArray(parsed)) {
        for (const item of parsed) walk(item, depth + 1);
        return;
      }
      if (typeof parsed !== "object") return;

      const direct = asImageString(parsed);
      if (direct) push(direct);

      for (const value of Object.values(parsed)) {
        walk(value, depth + 1);
      }
    };

    walk(input, 0);
    return collected;
  };

  let root = runpodOutput;
  if (root == null) return [];
  root = parseJsonMaybe(root);
  if (typeof root !== "object") return [];
  // Double-wrap: e.g. { output: { output: { images: [...] } } } (some RunPod webhooks)
  let out = parseJsonMaybe(root?.output ?? root);
  if (Array.isArray(out) && out.length > 0) {
    const extractedArray = uniq(out.map(asImageString));
    if (extractedArray.length > 0) return extractedArray;
  }
  if (out && typeof out === "object" && out.output && !out.images) {
    out = parseJsonMaybe(out.output);
  }
  if (out && typeof out === "object" && out.output && !out.images) {
    out = parseJsonMaybe(out.output);
  }
  if (!out || typeof out !== "object") return [];

  const images = out.images;
  if (Array.isArray(images) && images.length > 0) {
    const extracted = uniq(images.map(asImageString));
    if (extracted.length > 0) return extracted;
  }

  // Compatibility fallback: some workers return ComfyUI node outputs
  // under { outputs: { "<nodeId>": { images: [...] } } }.
  const nodeOutputs = out.outputs;
  if (nodeOutputs && typeof nodeOutputs === "object") {
    const txt2imgPreferred = MODELCLONE_X_TXT2IMG_OUTPUT_NODE_IDS.map(String);
    const i2i = String(MODELCLONE_X_IMG2IMG_OUTPUT_NODE);
    const i2iLegacy = String(MODELCLONE_X_IMG2IMG_OUTPUT_NODE_LEGACY);
    const preferredSet = new Set([...txt2imgPreferred, i2i, i2iLegacy]);
    const orderedNodeIds = [
      ...txt2imgPreferred,
      i2i,
      i2iLegacy,
      ...Object.keys(nodeOutputs).filter((k) => !preferredSet.has(k)),
    ];
    for (const nodeId of orderedNodeIds) {
      const nodeImages = nodeOutputs?.[nodeId]?.images;
      if (!Array.isArray(nodeImages) || nodeImages.length === 0) continue;
      const extracted = uniq(nodeImages.map(asImageString));
      if (extracted.length > 0) return extracted;
    }
  }

  {
    const direct = asImageString(out);
    if (direct) return [direct];
  }

  // Legacy wrapper variants occasionally place output under result/output_nodes.
  const node289 = out?.result?.output_nodes?.["289"]?.images;
  if (Array.isArray(node289) && node289.length > 0) {
    const extracted = uniq(node289.map(asImageString));
    if (extracted.length > 0) return extracted;
  }

  const deepOut = collectDeepImageStrings(out);
  if (deepOut.length > 0) return deepOut;

  const deepRoot = collectDeepImageStrings(root);
  if (deepRoot.length > 0) return deepRoot;

  return [];
}
