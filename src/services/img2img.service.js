/**
 * img2img Pipeline Service
 *
 * Orchestrates a 3-step flow:
 *   Step 1 — describe: Grok 4 Fast (vision via OpenRouter) thoroughly describes the input image
 *           (person, sexual act, background, environment in precise detail).
 *   Step 2 — inject: Grok rewrites the description with the model's LoRA trigger word + look description.
 *   Step 3 — img2img: RunPod ComfyUI graph from `attached_assets/nsfw_img2img_v2promax_workflow.json`
 *           (ZIT encode + refiner ckpt). Node 250 uses only the passed girl `loraUrl` (same stack rules as txt2img with no AI additives — no pose/makeup/enhancement/cum URLs).
 *
 * Image description runs synchronously through OpenRouter so we no longer depend on a
 * dedicated RunPod captioner worker / JoyCaption queue.
 *
 * Environment variables:
 *   RUNPOD_API_KEY        — RunPod API key (img2img / main ComfyUI jobs)
 *   RUNPOD_ENDPOINT_ID    — Serverless endpoint for img2img / main ComfyUI jobs
 *   OPENROUTER_API_KEY    — OpenRouter API key (used for Grok describe + Grok inject)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isR2Configured } from "../utils/r2.js";
import { isVercelBlobConfigured, uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import {
  buildNsfwLoraStackEntries,
  applyCompactLoraStackToNode250,
  comfyUiGraphToApiPrompt,
  inlineStringLiteralRefsInApiWorkflow,
  removeRgthreeFastGroupsBypasserFromComfyUiGraph,
} from "./fal.service.js";
import { resolveRunpodWebhookUrl } from "../lib/runpodWebhookUrl.js";
import { getPromptTemplateValue } from "./prompt-template-config.service.js";
import { NSFW_ZIMAGE_UNET_BASENAME } from "../config/nsfwZImageModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dynamicPoll removed — inline polling used directly

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT = (
  process.env.RUNPOD_NSFW_ENDPOINT_ID ||
  process.env.RUNPOD_ENDPOINT_ID ||
  ""
).trim() || null;
const RUNPOD_BASE = RUNPOD_ENDPOINT ? `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT}` : null;

/** Grok 4 Fast (vision) via OpenRouter — used for the image-describe step (replaces JoyCaption). */
const GROK_VISION_MODEL = (process.env.GROK_VISION_MODEL || "x-ai/grok-4.1-fast").trim();
const GROK_DESCRIBE_TIMEOUT_MS = Number(process.env.GROK_DESCRIBE_TIMEOUT_MS) || 60_000;

if (!RUNPOD_API_KEY) {
  console.warn("⚠️  RUNPOD_API_KEY not set — img2img pipeline will not work");
}
if (RUNPOD_ENDPOINT) {
  const resolvedFrom = process.env.RUNPOD_NSFW_ENDPOINT_ID?.trim()
    ? "RUNPOD_NSFW_ENDPOINT_ID"
    : "RUNPOD_ENDPOINT_ID";
  console.log(`[img2img] gen endpoint=${RUNPOD_ENDPOINT} (from ${resolvedFrom})`);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.warn("⚠️  OPENROUTER_API_KEY not set — img2img describe (Grok vision) will not work");
}

// ── Embedded workflow templates ───────────────────────────────────────────────
// Inlined at build time so the service works in any deployment environment
// regardless of whether runpod worker workflow JSON is present on disk.

const IMG2IMG_WORKFLOW = {
  "1": {
    "class_type": "UNETLoader",
    "inputs": { "unet_name": NSFW_ZIMAGE_UNET_BASENAME, "weight_dtype": "default" }
  },
  "2": {
    "class_type": "CLIPLoader",
    "inputs": { "clip_name": "qwen_3_4b.safetensors", "type": "qwen_image", "device": "default" }
  },
  "3": {
    "class_type": "VAELoader",
    "inputs": { "vae_name": "ae.safetensors" }
  },
  "4": {
    "class_type": "LoadImage",
    "inputs": { "image": "__INPUT_IMAGE__", "upload": "image" }
  },
  "5": {
    "class_type": "LoadLoraFromUrlOrPath",
    "inputs": {
      "toggle": true,
      "mode": "simple",
      "num_loras": 1,
      "lora_1_url": "__LORA_URL__",
      "lora_1_strength": "__LORA_STRENGTH__"
    }
  },
  "11": {
    "class_type": "CR Apply LoRA Stack",
    "inputs": { "model": ["1", 0], "clip": ["2", 0], "lora_stack": ["5", 0] }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "__POSITIVE_PROMPT__", "clip": ["11", 1] }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "makeup, nail polish, tattoo, jewelry, watermark, text, logo, signature, deformed, extra limbs",
      "clip": ["11", 1]
    }
  },
  "8": {
    "class_type": "VAEEncode",
    "inputs": { "pixels": ["4", 0], "vae": ["3", 0] }
  },
  "9": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["11", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["8", 0],
      "seed": 0,
      "steps": 25,
      "cfg": 3.0,
      "sampler_name": "dpmpp_2m",
      "scheduler": "beta",
      "denoise": 0.65
    }
  },
  "10": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["9", 0], "vae": ["3", 0] }
  },
  "289": {
    "class_type": "SaveImage",
    "inputs": { "images": ["10", 0], "filename_prefix": "modelclone_img2img" }
  }
};

const NSFW_TXT2IMG_WORKFLOW = {
  "1": { inputs: { text: "__NEGATIVE_PROMPT__", clip: ["264", 1] }, class_type: "CLIPTextEncode" },
  "2": { inputs: { text: "__POSITIVE_PROMPT__", clip: ["264", 1] }, class_type: "CLIPTextEncode" },
  "7": { inputs: { conditioning: ["8", 0] }, class_type: "ConditioningZeroOut" },
  "8": { inputs: { text: "__NEGATIVE_PROMPT__", clip: ["248", 0] }, class_type: "CLIPTextEncode" },
  "21": { inputs: { pixels: ["25", 0], vae: ["246", 0] }, class_type: "VAEEncode" },
  "25": { inputs: { samples: ["276", 0], vae: ["246", 0] }, class_type: "VAEDecode" },
  "28": { inputs: { samples: ["45", 0], vae: ["246", 0] }, class_type: "VAEDecode" },
  "42": { inputs: { text: "__POSITIVE_PROMPT__", clip: ["248", 0] }, class_type: "CLIPTextEncode" },
  "45": { inputs: { seed: ["57", 0], steps: 8, cfg: 0, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 0.09, model: ["247", 0], positive: ["42", 0], negative: ["7", 0], latent_image: ["21", 0] }, class_type: "KSampler" },
  "50": { inputs: { width: 1024, height: 1024, aspect_ratio: "16:9 landscape 1344x768", swap_dimensions: "On", upscale_factor: 1, batch_size: 1 }, class_type: "CR SDXL Aspect Ratio" },
  "57": { inputs: { seed: 0 }, class_type: "Seed (rgthree)" },
  "246": { inputs: { vae_name: "ae.safetensors" }, class_type: "VAELoader" },
  "247": { inputs: { unet_name: NSFW_ZIMAGE_UNET_BASENAME, weight_dtype: "default" }, class_type: "UNETLoader" },
  "248": { inputs: { clip_name: "qwen_3_4b.safetensors", type: "qwen_image", device: "default" }, class_type: "CLIPLoader" },
  "250": {
    inputs: {
      toggle: true,
      mode: "simple",
      num_loras: 1,
      lora_1_url: "__LORA_URL__",
      lora_1_strength: "__LORA_STRENGTH__",
      lora_1_model_strength: "__LORA_STRENGTH__",
      lora_1_clip_strength: "__LORA_STRENGTH__",
    },
    class_type: "LoadLoraFromUrlOrPath"
  },
  "264": { inputs: { model: ["247", 0], clip: ["248", 0], lora_stack: ["250", 0] }, class_type: "CR Apply LoRA Stack" },
  "276": { inputs: { seed: ["57", 0], steps: 50, cfg: 3, sampler_name: "dpmpp_2m", scheduler: "beta", denoise: 1, model: ["264", 0], positive: ["2", 0], negative: ["1", 0], latent_image: ["50", 4] }, class_type: "KSampler" },
  "284": { inputs: { density: 0.06, intensity: 0.1, highlights: 1, supersample_factor: 1, image: ["28", 0] }, class_type: "Image Film Grain" },
  "286": { inputs: { blur_radius: 2, sigma: 0.3, image: ["284", 0] }, class_type: "ImageBlur" },
  "289": { inputs: { filename_prefix: "modelclone", images: ["286", 0] }, class_type: "SaveImage" },
};

// Deep-clone so every call gets a fresh mutable copy
function cloneWorkflow(template) {
  return JSON.parse(JSON.stringify(template));
}

function loadImg2ImgWorkflow()     { return cloneWorkflow(IMG2IMG_WORKFLOW); }
function loadNsfwTxt2ImgWorkflow() { return cloneWorkflow(NSFW_TXT2IMG_WORKFLOW); }

function ensureFiniteNumber(value, fieldName) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a valid number (got: ${value})`);
  }
  return n;
}

const NSFW_IMG2IMG_V2_GRAPH_PATHS = [
  path.join(process.cwd(), "attached_assets", "nsfw_img2img_v2promax_workflow.json"),
  path.join(__dirname, "..", "..", "attached_assets", "nsfw_img2img_v2promax_workflow.json"),
];

/** Expand Comfy 1.12+ embedded subgraph instances (UUID `type`) to a real CheckpointLoaderSimple for API. */
function expandEmbeddedCheckpointSubgraphs(workflowData) {
  const subgraphs = workflowData.definitions?.subgraphs;
  const nodes = workflowData.nodes;
  if (!Array.isArray(subgraphs) || !Array.isArray(nodes)) return;
  const byId = Object.fromEntries(subgraphs.map((sg) => [sg.id, sg]));
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const sg = byId[n.type];
    if (!sg?.nodes?.length) continue;
    const inner = sg.nodes.find((x) => x.type === "CheckpointLoaderSimple");
    if (!inner) continue;
    const merged = JSON.parse(JSON.stringify(inner));
    merged.id = n.id;
    if (n.pos) merged.pos = n.pos;
    if (n.size) merged.size = n.size;
    nodes[i] = merged;
  }
}

let nsfwImg2ImgV2GraphCache = null;

function loadNsfwImg2ImgV2GraphPrepared() {
  if (nsfwImg2ImgV2GraphCache) return JSON.parse(JSON.stringify(nsfwImg2ImgV2GraphCache));
  let raw = null;
  for (const p of NSFW_IMG2IMG_V2_GRAPH_PATHS) {
    try {
      if (fs.existsSync(p)) {
        raw = fs.readFileSync(p, "utf8");
        break;
      }
    } catch {
      /* try next path */
    }
  }
  if (!raw) {
    throw new Error(
      "NSFW img2img workflow missing: add attached_assets/nsfw_img2img_v2promax_workflow.json",
    );
  }
  const data = JSON.parse(raw);
  expandEmbeddedCheckpointSubgraphs(data);
  nsfwImg2ImgV2GraphCache = data;
  return JSON.parse(JSON.stringify(data));
}

/** Replace inputs wired as [sourceNodeId, slot] with a string, then remove the source node. */
function inlineStringOutputNodeAsValue(api, sourceNodeId, value) {
  const sid = String(sourceNodeId);
  for (const node of Object.values(api)) {
    if (!node?.inputs) continue;
    for (const k of Object.keys(node.inputs)) {
      const v = node.inputs[k];
      if (Array.isArray(v) && v.length >= 2 && String(v[0]) === sid) {
        node.inputs[k] = value;
      }
    }
  }
  delete api[sid];
}

/**
 * NSFW v2promax desktop graph ships with a "person mask preview" branch
 * (PersonMaskUltra V2 → MaskToImage → PreviewImage, plus ETN_ApplyMaskToImage
 * → PreviewImage) and a SmolVLM image-describe node. None of them feed the
 * final SaveImage chain (28 → 284 → 286 → 289), they're pure UI decoration in
 * the Comfy desktop client. The RunPod worker doesn't ship the LayerStyle
 * suite, so it rejects the prompt with:
 *   "Unknown node types: 'LayerMask: PersonMaskUltra V2', 'LayerUtility: SmolVLM'"
 * Drop the whole dead branch from the API prompt before submitting.
 */
const NSFW_IMG2IMG_DEAD_PREVIEW_NODE_IDS = ["312", "313", "314", "320", "321", "333"];

function pruneDeadPreviewBranchFromApiPrompt(api) {
  const dead = new Set(NSFW_IMG2IMG_DEAD_PREVIEW_NODE_IDS);
  for (const id of dead) delete api[id];
  for (const node of Object.values(api)) {
    if (!node?.inputs) continue;
    for (const k of Object.keys(node.inputs)) {
      const v = node.inputs[k];
      if (Array.isArray(v) && v.length >= 1 && dead.has(String(v[0]))) {
        delete node.inputs[k];
      }
    }
  }
}

/**
 * RunPod API prompt from `attached_assets/nsfw_img2img_v2promax_workflow.json` (ZIT → refiner uses same UNET/CLIP/VAE as stage 1).
 * SaveImage is pointed at VAEDecode 28 so the handler output skips grain/blur; all other nodes from the JSON remain in the prompt (same worker serves multiple workflows).
 *
 * LoadLoraFromUrlOrPath (250): identity LoRA when `loraUrl` is set. When omitted (e.g. ModelClone-X
 * no-character img2img), `num_loras` is set to 0 and the stack is cleared.
 */
/**
 * Refiner (legacy CheckpointLoaderSimple or embedded-subgraph → ckpt) must use the same UNet+CLIP+VAE
 * on the volume as txt2img (no separate `models/checkpoints` bundle).
 */
function rewireCheckpointLoadersToUnetClipVae(api) {
  const findFirst = (classType) => {
    for (const [id, node] of Object.entries(api)) {
      if (node?.class_type === classType) return id;
    }
    return null;
  };
  const unetId =
    api["247"]?.class_type === "UNETLoader" ? "247" : findFirst("UNETLoader");
  const clipId =
    api["248"]?.class_type === "CLIPLoader" ? "248" : findFirst("CLIPLoader");
  const vaeId =
    api["246"]?.class_type === "VAELoader" ? "246" : findFirst("VAELoader");
  if (!unetId || !clipId || !vaeId) {
    console.warn(
      "[img2img] rewireCheckpointLoadersToUnetClipVae: missing UNETLoader / CLIPLoader / VAELoader; skipping rewire",
    );
    return;
  }
  const bySlot = {
    0: [unetId, 0],
    1: [clipId, 0],
    2: [vaeId, 0],
  };
  const ckptIds = Object.entries(api)
    .filter(([, n]) => n?.class_type === "CheckpointLoaderSimple")
    .map(([id]) => id);
  for (const cid of ckptIds) {
    for (const node of Object.values(api)) {
      if (!node?.inputs) continue;
      for (const k of Object.keys(node.inputs)) {
        const v = node.inputs[k];
        if (!Array.isArray(v) || v.length < 2) continue;
        if (String(v[0]) !== String(cid)) continue;
        const slot = Number(v[1]);
        const rep = bySlot[slot];
        if (rep) node.inputs[k] = rep;
      }
    }
    delete api[cid];
  }
}

function buildNsfwImg2ImgV2ApiPrompt({
  positivePrompt,
  loraUrl = null,
  loraStrength,
  seed,
  stage1Denoise,
  steps = null,
  cfg = null,
}) {
  const graph = loadNsfwImg2ImgV2GraphPrepared();
  const negNode = graph.nodes?.find((n) => String(n.id) === "41" && n.type === "String Literal");
  const negativeText =
    negNode?.widgets_values != null && negNode.widgets_values[0] != null
      ? String(negNode.widgets_values[0])
      : "blurry, low resolution, deformed, bad anatomy, extra limbs, mutated hands, poorly drawn face, bad proportions, watermark, text, signature, cartoon, anime, overexposed, underexposed, plastic skin, doll-like";

  removeRgthreeFastGroupsBypasserFromComfyUiGraph(graph.nodes, graph.links);
  const api = comfyUiGraphToApiPrompt(graph.nodes, graph.links, graph.extra);

  pruneDeadPreviewBranchFromApiPrompt(api);

  inlineStringLiteralRefsInApiWorkflow(api, { "41": negativeText });
  delete api["41"];

  inlineStringOutputNodeAsValue(api, "311", positivePrompt);

  if (api["305"]?.inputs) {
    api["305"].inputs.image = "__INPUT_IMAGE__";
    api["305"].inputs.upload = "image";
  }

  const ls = ensureFiniteNumber(loraStrength, "loraStrength");
  if (api["250"]?.inputs) {
    if (String(loraUrl ?? "").trim()) {
      const stack = buildNsfwLoraStackEntries({
        loraUrl,
        girlLoraStrength: ls,
        poseStrengths: {},
        makeupStrength: 0,
        cumStrength: 0,
        enhancementStrengths: {},
      });
      applyCompactLoraStackToNode250(api["250"], stack);
    } else {
      applyCompactLoraStackToNode250(api["250"], []);
    }
  }

  if (api["57"]?.inputs) {
    api["57"].inputs.seed = seed;
  }

  if (api["276"]?.inputs) {
    api["276"].inputs.denoise = ensureFiniteNumber(stage1Denoise, "denoise");
    if (steps != null && steps !== "") {
      const s = Math.max(1, Math.min(100, Math.round(Number(steps))));
      if (Number.isFinite(s)) api["276"].inputs.steps = s;
    }
    if (cfg != null && cfg !== "") {
      const c = Math.max(0, Math.min(8, Number(cfg)));
      if (Number.isFinite(c)) api["276"].inputs.cfg = c;
    }
  }

  if (api["289"]?.inputs) {
    api["289"].inputs.images = ["28", 0];
    api["289"].inputs.filename_prefix = "modelclone_img2img";
  }

  rewireCheckpointLoadersToUnetClipVae(api);

  for (const node of Object.values(api)) {
    if (!node?.inputs) continue;
    if (node.class_type === "UNETLoader") {
      node.inputs.unet_name = NSFW_ZIMAGE_UNET_BASENAME;
    }
  }

  return api;
}

// ── RunPod API helpers ────────────────────────────────────────────────────────

function runpodBaseForEndpoint(endpointId) {
  return `https://api.runpod.ai/v2/${endpointId}`;
}

async function runpodSubmitWithEndpoint(endpointId, payload, webhookUrl = null) {
  if (!RUNPOD_API_KEY || !endpointId) {
    throw new Error("Generation service not configured");
  }

  const base = runpodBaseForEndpoint(endpointId);
  const body = { input: payload };
  if (webhookUrl) {
    body.webhook = webhookUrl;
  } else {
    console.warn(
      `[RunPod] /run to endpoint=${endpointId} submitted WITHOUT webhook ` +
      `— job result will only land via active polling. Set CALLBACK_BASE_URL or RUNPOD_WEBHOOK_URL.`,
    );
  }

  const resp = await fetch(`${base}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Generation service submit failed ${resp.status}: ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  const jobId =
    data.id ||
    data.request_id ||
    data.requestId ||
    data.task_id ||
    data.taskId;
  if (!jobId) throw new Error(`Generation service returned no job id: ${JSON.stringify(data)}`);
  return jobId;
}

async function runpodSubmit(payload, webhookUrl = null) {
  return runpodSubmitWithEndpoint(RUNPOD_ENDPOINT, payload, webhookUrl);
}

/**
 * Normalize handler `output` from RunPod `/status` — sometimes JSON-stringified or wrapped in `{ output: { ... } }`.
 */
export function parseRunpodHandlerOutput(raw) {
  if (raw == null) return null;
  let o = raw;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (typeof o !== "object" || o === null) return null;

  const inner = o.output;
  if (inner && typeof inner === "object") {
    const outerImages = Array.isArray(o.images) && o.images.length > 0;
    const outerText = typeof o.text === "string" && o.text.trim();
    const innerImages = Array.isArray(inner.images) && inner.images.length > 0;
    const innerText = typeof inner.text === "string" && inner.text.trim();
    if (!outerImages && !outerText && (innerImages || innerText)) {
      return inner;
    }
  }
  return o;
}

/** RunPod status values that mean success (casing / synonyms differ by API version). */
const RUNPOD_DONE_STATUSES = new Set(["COMPLETED", "SUCCESS", "SUCCEEDED", "COMPLETE", "DONE"]);
/** RunPod status values that mean terminal failure. */
const RUNPOD_FAILED_STATUSES = new Set(["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT", "ERROR"]);

/**
 * Normalize `/status` JSON from RunPod serverless (status vs state, mixed case, nested execution).
 */
export function normalizeRunpodStatusResponse(body) {
  if (!body || typeof body !== "object") {
    return { status: null, output: null, raw: body };
  }
  let status = body.status ?? body.state;
  if (status == null && body.execution && typeof body.execution === "object") {
    status = body.execution.status ?? body.execution.state;
  }
  if (typeof status === "string") {
    status = status.trim().toUpperCase();
    if (status === "SUCCEEDED" || status === "SUCCESS" || status === "COMPLETE" || status === "DONE") {
      status = "COMPLETED";
    }
    if (status === "CANCELED") status = "CANCELLED";
  } else {
    status = null;
  }
  const output = body.output !== undefined && body.output !== null ? body.output : body.result;
  return { status, output, raw: body };
}

/** Map a normalized RunPod response to done | failed | processing for describe / polling. */
export function classifyRunpodPhase(normalized) {
  const { status } = normalized;
  if (status && RUNPOD_DONE_STATUSES.has(status)) return "done";
  if (status && RUNPOD_FAILED_STATUSES.has(status)) return "failed";
  return "processing";
}

/** RunPod rejects malformed ids with 400; avoid noisy polls on placeholder/partial ids. */
function assertRunpodJobId(jobId) {
  const s = typeof jobId === "string" ? jobId.trim() : "";
  if (s.length < 10 || s.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(s)) {
    throw new Error("Invalid RunPod job id format");
  }
}

export function isRunpodJobIdValidationError(err) {
  const m = err && typeof err.message === "string" ? err.message : "";
  return m.includes("Invalid RunPod job id format");
}

/**
 * @param {string} jobId
 */
export async function getRunpodJobStatus(jobId) {
  if (!RUNPOD_API_KEY) {
    throw new Error("Generation service not configured");
  }

  assertRunpodJobId(jobId);

  const resp = await fetch(`${RUNPOD_BASE}/status/${jobId}`, {
    headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Generation status check failed ${resp.status}: ${text.slice(0, 300)}`);
  }

  return await resp.json();
}

export async function submitImg2ImgJob({
  imageUrl,
  imageBase64Provided,
  prompt,
  loraUrl = null,
  loraStrength = 0.8,
  denoise = 0.6,
  seed,
  steps = null,
  cfg = null,
  /** When set, used instead of a bare `resolveRunpodWebhookUrl()` (e.g. ModelClone-X + generationId). */
  webhookUrl: explicitWebhook = null,
}) {
  const numericLoraStrength = ensureFiniteNumber(loraStrength, "loraStrength");
  const numericDenoise = ensureFiniteNumber(denoise, "denoise");

  const imageBase64 = imageBase64Provided || await imageUrlToBase64(imageUrl);
  const resolvedSeed = seed ?? Math.floor(Math.random() * 1_000_000_000);

  const workflow = buildNsfwImg2ImgV2ApiPrompt({
    positivePrompt: prompt,
    loraUrl: String(loraUrl ?? "").trim() ? loraUrl : null,
    loraStrength: numericLoraStrength,
    seed: resolvedSeed,
    stage1Denoise: numericDenoise,
    steps,
    cfg,
  });

  if (!workflow["250"]?.inputs || !workflow["276"]?.inputs || !workflow["305"]?.inputs) {
    throw new Error("NSFW img2img workflow is missing expected nodes (250, 276, or 305)");
  }

  const payload = {
    prompt: workflow,
    upload_images: [
      {
        node_id: "305",
        data: imageBase64,
        filename: "img2img_input.jpg",
      },
    ],
    output_type: "image",
    output_node_id: "289",
  };

  const webhookUrl = explicitWebhook != null ? explicitWebhook : resolveRunpodWebhookUrl();
  if (webhookUrl) {
    console.log(
      `📣 [img2img] RunPod webhook: ${webhookUrl.slice(0, 88)}${webhookUrl.length > 88 ? "…" : ""}`,
    );
  }
  const runpodJobId = await runpodSubmit(payload, webhookUrl);
  return { runpodJobId, resolvedSeed };
}

async function runpodPoll(jobId, timeoutMs = 300_000, intervalMs = 5_000, statusBaseUrl = RUNPOD_BASE) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, attempt === 1 ? 3_000 : intervalMs));

    let data;
    try {
      const resp = await fetch(`${statusBaseUrl}/status/${jobId}`, {
        headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        console.warn(`[RunPod] Poll HTTP ${resp.status} for ${jobId} — retrying`);
        continue;
      }
      data = await resp.json();
    } catch (err) {
      console.warn(`[RunPod] Poll fetch error for ${jobId}: ${err.message} — retrying`);
      continue;
    }

    const status = data.status;
    if (status === "COMPLETED") return { phase: "done", result: data.output };
    if (status === "FAILED")    return { phase: "done", error: `Generation failed: ${JSON.stringify(data.error || data.output)}` };
    if (status === "CANCELLED") return { phase: "done", error: "Generation was cancelled" };
    // IN_QUEUE or IN_PROGRESS — keep polling
  }

  throw new Error(`RunPod job ${jobId} timed out after ${Math.round(timeoutMs / 60000)} minutes`);
}

// ── Image → base64 ────────────────────────────────────────────────────────────

async function imageUrlToBase64(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": new URL(url).origin + "/",
    },
  });
  if (!resp.ok) {
    throw new Error(
      `Cannot download image (${resp.status}) from: ${url}\n` +
      `If you're using an external URL, upload the image file directly instead.`
    );
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  return buffer.toString("base64");
}

// ── Step 1: Extract prompt via Grok 4 Fast (vision via OpenRouter) ───────────

/** System prompt for the Grok image-describe call (replaces JoyCaption). */
const GROK_DESCRIBE_SYSTEM_PROMPT = `You are an expert visual analyst describing photographs for a downstream NSFW img2img generation pipeline.

You will receive a single image. Your only job is to write ONE thorough, precise prose description of the photograph. The description must capture, in clear order:

1. THE PERSON / PEOPLE — for each visible person: pose, body position, where their hands are, where they are looking, facial expression, what they are wearing or not wearing, and any visible accessories (jewelry, glasses, etc). Use direct anatomical and explicit terms when relevant (e.g. "topless", "nude", "spread legs", "erect penis", "vagina", "anal", "penetration") — do NOT use euphemisms.
2. THE SEXUAL ACT (if any) — describe exactly what is happening sexually with anatomical precision: the position, who is on top / behind / under, what body parts are touching or penetrating which, the angle of the act, hand placement, and any clearly visible sexual fluids or props.
3. THE BACKGROUND AND ENVIRONMENT — describe the location (bedroom, bathroom, outdoors, hotel, kitchen, etc.), key furniture/props (bed, sheet color, couch, chair, surface, mirror, plants, windows, walls), the floor / ground, the lighting (natural / warm / cold / harsh / soft / candle / neon / window light), the time of day if inferable, and the overall mood/atmosphere.
4. CAMERA / FRAMING — type of shot (close-up, medium shot, wide shot, POV from behind, POV from above, side profile, etc.), camera angle (low / high / eye-level), and framing (full body, half body, headshot).

Output rules:
- Output ONLY the description as flowing prose. No headings, no bullet points, no markdown, no labels, no preamble.
- Be specific and concrete. Avoid vague words like "intimate" or "seductive" — describe what you SEE.
- Do NOT include personal identity claims (no celebrity names, no real names).
- Do NOT include watermarks, logos, signatures, or photographer tags in the description.
- Keep the description thorough but a single paragraph (up to ~250 words).`;

/**
 * Describes the input image thoroughly using Grok 4 Fast (vision) via OpenRouter.
 * Returns the description string used as the raw caption for the prompt-injection step.
 *
 * Accepts either an http(s) image URL or a raw base64 image payload (the caller already
 * has whichever is convenient). When base64 is provided we wrap it in a data: URL so the
 * model can fetch it inline without the upstream needing to host the image.
 */
export async function extractPromptFromImage(imageUrl, imageBase64Provided) {
  console.log("\n🔍 [img2img] Step 1 — describing image via Grok vision (OpenRouter)...");
  console.log(`   Image: ${imageBase64Provided ? "[base64 upload]" : imageUrl}`);

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured — cannot run Grok image describe step");
  }

  let imageBlockUrl;
  if (imageBase64Provided) {
    const cleaned = String(imageBase64Provided).trim().replace(/^data:[^,]+,/, "");
    imageBlockUrl = `data:image/jpeg;base64,${cleaned}`;
  } else if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    imageBlockUrl = imageUrl;
  } else {
    throw new Error(
      `Cannot analyze image: no valid URL or base64 data provided (got: "${imageUrl}"). ` +
      `Please upload the image file directly instead of using a URL.`,
    );
  }

  const requestBody = {
    model: GROK_VISION_MODEL,
    messages: [
      { role: "system", content: GROK_DESCRIBE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBlockUrl } },
          {
            type: "text",
            text: "Describe this photograph thoroughly per the rules above. Capture the person(s), the act, the background and the environment in precise detail. Output the description as a single prose paragraph, nothing else.",
          },
        ],
      },
    ],
    max_tokens: 800,
    temperature: 0.3,
  };

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(GROK_DESCRIBE_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Grok describe failed (${resp.status}): ${errText.slice(0, 400)}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  const caption = (typeof raw === "string" ? raw : "").trim();
  if (!caption) {
    throw new Error(`Grok describe returned no text. Raw response: ${JSON.stringify(data).slice(0, 400)}`);
  }

  console.log(`   ✅ Grok description (${caption.length} chars): ${caption.slice(0, 120)}...`);
  return caption;
}

// ── Step 2: Inject model trigger word + look via OpenAI ──────────────────────

/**
 * App sends TARGET_CHARACTER_LOOKS as "label: value, label: value" — strip labels for fallback prompts.
 */
function looksLabelsToProseFragment(lookDescription) {
  const s = String(lookDescription || "").trim();
  if (!s) return "";
  return s
    .split(",")
    .map((chunk) => {
      const t = chunk.trim();
      const m = t.match(/^[^:]+:\s*(.+)$/s);
      return m ? m[1].trim() : t;
    })
    .filter(Boolean)
    .join(", ");
}

function sanitizeGrokPromptOutput(text) {
  let s = String(text || "").trim();
  s = s.replace(/^```[\w]*\s*/i, "").replace(/\s*```$/i, "").trim();
  s = s.replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return s;
}

/** If Grok still pasted app-style labels, strip known keys (TARGET_CHARACTER_LOOKS must never appear verbatim). */
function stripKnownLookLabelsFromPrompt(s) {
  const t = String(s || "");
  if (!/\b(ethnicity|hair color|hair style|skin tone|eye color)\s*:/i.test(t)) return t;
  return t
    .replace(
      /(?:^|,\s*)(?:ethnicity|hair color|hair style|skin tone|eye color|eye shape|face shape|nose|lips|body type|height|breast size|butt|waist|hips|tattoos\/piercings)\s*:\s*/gi,
      ", ",
    )
    .replace(/,(\s*,)+/g, ", ")
    .replace(/^\s*,+\s*/, "")
    .trim();
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Takes the raw Grok image description and rewrites it to include:
 * - The model's LoRA trigger word (so the LoRA fires correctly)
 * - Key look descriptors from the model profile (hair, skin, eyes, body)
 *
 * Returns the final ComfyUI-ready prompt string.
 */
export async function injectModelIntoPrompt(rawDescription, triggerWord, lookDescription = "") {
  console.log("\n✍️  [img2img] Step 2 — injecting model identity into prompt via Grok...");
  console.log(`   Trigger: ${triggerWord}`);
  console.log(`   Look: ${lookDescription || "(empty — will use generic)"}`);

  const trigger = String(triggerWord || "").trim() || "woman";

  try {
    const { default: OpenAI } = await import("openai");
    const grok = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    let systemPrompt = `You are an expert prompt engineer specialized in ComfyUI ZIT (Z Image Turbo) img2img workflows for adult NSFW content.

You will receive labeled sections in every user message:
- TRIGGER_WORD — the LoRA trigger token. Your output MUST start with exactly: TRIGGER_WORD followed by a comma and a space (example: "${trigger}, ").
- TARGET_CHARACTER_LOOKS — every physical attribute of the replacement character. It may arrive as comma-separated "label: value" pairs from the app (e.g. "hair color: blonde hair"). You MUST use every non-empty fact but rewrite them into fluent natural English. NEVER paste "ethnicity:", "hair color:", "skin tone:", or any other field labels into the output.
- ORIGINAL_IMAGE_PROMPT — raw image-to-prompt text (Grok visual description). It describes the scene, pose, action, camera angle, lighting, background, composition, and the source person's looks.

YOUR JOB: Output ONLY a single clean, highly ZIT-optimized img2img prompt (nothing else — no explanations, no quotes, no markdown, no extra text).

Rules for the output prompt (ZIT-specific):
- First: TRIGGER_WORD, then immediately integrate the full target character as flowing prose (all TARGET_CHARACTER_LOOKS facts, no key:value syntax).
- Never paste or concatenate the TARGET_CHARACTER_LOOKS block verbatim — it is input data only; your output must be rewritten prose.
- Perfectly swap ONLY the character's identity and physical appearance. Keep the scene, pose, action, facial expression, body position, camera angle, lighting, background, composition, and any explicit/sexual elements from ORIGINAL_IMAGE_PROMPT — but remove redundant or conflicting descriptions of the source person's hair, skin, eyes, face, and body (replace them mentally with the target; do not repeat wrong hair color etc.).
- Do not invent details not present in the inputs.
- Never write narrative/caption style ("The photograph shows...", "The image depicts...", "This is a photo of..."). Output only direct prompt text for the positive conditioning node.
- Structure for adherence: subject (trigger + target looks) → pose/action/expression → camera angle + framing → lighting + atmosphere → background + environment → optional short quality tail at the very end: masterpiece, best quality, highly detailed, sharp focus, ultra realistic
- Be concise yet precise. You may lightly weight critical target features with (feature:1.1) or (feature:1.2) for ZIT where it helps.
- Prefer one line; stay under ~350 words.

==============================================================
EXPLICIT SEX-ACT POSE REWRITE RULES (CRITICAL — read carefully)
==============================================================

When ORIGINAL_IMAGE_PROMPT contains an explicit sex act between two people (doggystyle, missionary, cowgirl, reverse cowgirl, mating press, prone bone, spooning / sideways, standing-from-behind, piledriver, amazon, etc.), you MUST rewrite the act using PROPER PHOTOGRAPHIC COMPOSITION instead of any clinical "penis entering pussy" narrative. Anatomical narration like "average-sized erect penis entering pussy from behind with visible penetration, anus and pussy visible" causes severe anatomical mutations in img2img; composition-first phrasing does not.

HARD BANS (never appear in your output, even if present in ORIGINAL_IMAGE_PROMPT):
- "penis entering pussy", "penis entering vagina", "penis entering her", "penis entering from behind/above/below"
- "visible penetration", "with visible penetration"
- stacked anatomy lists like "anus and pussy visible", "vulva and asshole visible"
- "average-sized" / "small" / "huge" penis size descriptors
- "slightly damp skin" or any other moisture/sweat gloss adjectives
- duplicated anatomy mentions — pick ONE short anatomical phrase max

Instead, for each pose, use the following composition-first templates. The female LoRA character is ALWAYS the dominant subject; the male partner appears only as framing elements (his hips, thighs, hands, abs, erect cock) entering the shot at the appropriate edge of the frame. The partner's face/identity is NEVER described.

POSE → CAMERA POV + COMPOSITION (use the pattern, adapt the wording):

• Doggystyle / prone bone (woman on all fours, man behind):
  → "POV from behind, partner's hips and thighs in lower foreground framing the shot, his erect cock penetrating her from behind, woman on all fours with arched back, her ass facing the camera, looking back over her shoulder at the viewer, [scene-specific hand placement from original]"

• Standing from behind (both standing, man behind):
  → "POV from behind standing, partner's hips and abs in lower foreground, his erect cock penetrating her from behind, woman bent forward / standing with arched back, her ass pushed back toward the camera, [grip / surface from original]"

• Missionary (woman on back, man on top):
  → "POV from above looking down, partner's torso and hips in upper foreground silhouette, penetrating her from above, woman lying on her back with legs spread and knees bent, her hands on her thighs / partner's arms, eye contact with the camera"

• Mating press (woman on back, legs folded back, man pressing down):
  → "POV from above with deep angle, woman lying on her back with her legs folded back over her shoulders / pinned beside her head, partner's hips pressed down between her thighs, his hands on the backs of her thighs, deep penetration angle, [her expression from original]"

• Cowgirl (woman riding on top, facing partner):
  → "POV from below looking up at her, partner's hips and thighs in lower foreground, woman straddling and riding on top, her body upright or slightly arched, her hands on his chest / her own breasts / her hair, eye contact"

• Reverse cowgirl (woman riding on top, facing away):
  → "POV from below looking up at her back, partner's hips and lower torso in foreground, woman straddling facing away, her back arched, her ass and back facing the camera, [hand placement from original]"

• Spooning / sideways (both lying on side, man behind):
  → "side profile shot, both lying on their sides, partner behind her, his hips against her ass and his cock penetrating her from behind, his arm wrapped around her, [her expression / hand placement from original]"

• Piledriver / amazon / less common pose: follow the same pattern — pick the camera POV that matches the dominant body orientation in the original, place the partner's framing body parts at the correct edge of the frame, and describe penetration as a SINGLE short composition phrase (e.g. "his erect cock penetrating her from above"), never as a clinical anatomical event.

Additional act-rewrite rules:
- Use "his erect cock" or "his erect penis" — pick ONE, never both. Never include size descriptors.
- Penetration is described in ONE short phrase; do not repeat it.
- Preserve every NON-act detail from ORIGINAL_IMAGE_PROMPT verbatim: surface (bed/couch/floor), sheet color, lighting, time of day, props, the woman's expression, where her hands are, whether she's looking at the camera, jewelry, makeup, hair state (messy/tied/wet), etc.
- Preserve the original framing word ("medium shot", "close-up", "wide shot") if present; otherwise default to "medium shot".
- If ORIGINAL_IMAGE_PROMPT mentions the act but does NOT mention the male partner at all (solo scene with just the woman in the pose), do NOT add a partner — keep it solo and describe only the woman's body position.

Output format: exactly one block of clean prompt text. Nothing more.`;
    systemPrompt = await getPromptTemplateValue("img2imgInjectSystemPrompt", systemPrompt);

    const userMessage = `TRIGGER_WORD (start your output with this exact token, then comma and space):
${trigger}

TARGET_CHARACTER_LOOKS (use every fact; convert to natural English — no "label:" prefixes in output):
${lookDescription || "naturally realistic adult woman, use sensible defaults consistent with the scene"}

ORIGINAL_IMAGE_PROMPT (keep scene/pose/camera/lighting/background; drop source identity):
${rawDescription}`;

    const completion = await grok.chat.completions.create({
      model: "x-ai/grok-4.1-fast",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 700,
      temperature: 0.25,
    });

    let injected = stripKnownLookLabelsFromPrompt(
      sanitizeGrokPromptOutput(completion.choices[0]?.message?.content),
    );
    if (injected) {
      const triggerRe = new RegExp(`^\\s*${escapeRegExp(trigger)}\\s*,`, "i");
      if (!triggerRe.test(injected)) {
        injected = `${trigger}, ${injected}`;
      }
      console.log(`   ✅ Grok injected prompt: ${injected.slice(0, 120)}...`);
      return injected;
    }
  } catch (err) {
    console.warn(`   ⚠️  Grok injection failed (${err.message}), using manual injection`);
  }

  // Fallback: trigger + de-labeled looks + raw caption (still messy; Grok path preferred)
  const lookProse = looksLabelsToProseFragment(lookDescription);
  const injected = lookProse
    ? `${trigger}, ${lookProse}, ${rawDescription}`
    : `${trigger}, ${rawDescription}`;
  console.log(`   ✅ Manual injection: ${injected.slice(0, 120)}...`);
  return injected;
}

// ── Step 3: Generate img2img output ──────────────────────────────────────────

/**
 * Runs the img2img ComfyUI workflow on RunPod.
 * Returns base64-encoded image data.
 */
export async function generateImg2Img({ imageUrl, imageBase64Provided, prompt, loraUrl, loraStrength = 0.8, denoise = 0.6, seed }) {
  const numericLoraStrength = ensureFiniteNumber(loraStrength, "loraStrength");
  const numericDenoise = ensureFiniteNumber(denoise, "denoise");

  console.log("\n🎨 [img2img] Step 3 — running NSFW v2 img2img (encode → ZIT → refiner, save from node 28)...");
  console.log(`   LoRA: ${loraUrl}`);
  console.log(`   Prompt: ${prompt.slice(0, 100)}...`);
  console.log(`   Stage-1 denoise: ${numericDenoise}  LoRA strength: ${numericLoraStrength}`);

  const imageBase64 = imageBase64Provided || await imageUrlToBase64(imageUrl);

  const resolvedSeed = seed ?? Math.floor(Math.random() * 1_000_000_000);

  const workflow = buildNsfwImg2ImgV2ApiPrompt({
    positivePrompt: prompt,
    loraUrl,
    loraStrength: numericLoraStrength,
    seed: resolvedSeed,
    stage1Denoise: numericDenoise,
  });

  if (!workflow["250"]?.inputs || !workflow["276"]?.inputs || !workflow["305"]?.inputs) {
    throw new Error("NSFW img2img workflow is missing expected nodes (250, 276, or 305)");
  }

  const payload = {
    prompt: workflow,
    upload_images: [
      {
        node_id: "305",
        data: imageBase64,
        filename: "img2img_input.jpg",
      },
    ],
    output_type: "image",
    output_node_id: "289",
  };

  const webhookUrl = resolveRunpodWebhookUrl();
  const jobId = await runpodSubmit(payload, webhookUrl);
  console.log(`   RunPod job submitted: ${jobId}`);

  const poll = await runpodPoll(jobId, 300_000);

  if (!poll || poll.error) {
    throw new Error(`img2img step failed: ${poll?.error || "no output"}`);
  }

  const handlerOut = parseRunpodHandlerOutput(poll.result) ?? poll.result;
  const images = handlerOut?.images;
  if (!images || images.length === 0) {
    throw new Error(`img2img returned no images. Output: ${JSON.stringify(handlerOut)}`);
  }

  console.log(`   ✅ Got ${images.length} image(s) from node ${images[0].node_id}`);
  return images[0]; // { filename, node_id, base64 }
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

/**
 * Runs the complete img2img pipeline:
 * 1. Grok 4 Fast (vision) extracts a thorough scene description from the input image
 * 2. Grok injects trigger word + model look
 * 3. img2img generates the swapped result
 * 4. Result is uploaded to R2 for permanent storage
 *
 * @param {object} params
 * @param {string} params.inputImageUrl   - Source image URL (the image to swap)
 * @param {string} params.loraUrl         - R2 URL to the user's LoRA .safetensors
 * @param {string} params.triggerWord     - LoRA trigger word (e.g. "lora_keo")
 * @param {string} params.lookDescription - Model appearance for prompt injection (optional)
 * @param {number} params.loraStrength    - LoRA model + clip strength (default 0.8)
 * @param {number} params.denoise         - stage-1 KSampler 276 denoise (default 0.6, matches workflow JSON)
 * @param {number} params.seed            - Random seed (optional)
 * @returns {Promise<{outputUrl: string, prompt: string, rawDescription: string}>}
 */
export async function runImg2ImgPipeline(params) {
  const {
    inputImageUrl,
    inputImageBase64 = null,
    loraUrl,
    triggerWord,
    lookDescription = "",
    loraStrength = 0.8,
    denoise = 0.6,
    seed,
  } = params;

  console.log("\n🚀 =============================================");
  console.log("🚀  IMG2IMG PIPELINE — START");
  console.log("🚀 =============================================");
  console.log(`   Input: ${inputImageBase64 ? "[base64 upload]" : inputImageUrl}`);
  console.log(`   Trigger: ${triggerWord}  LoRA: ${loraUrl}`);

  // Step 1: Extract scene description (reuse base64 if already fetched)
  const rawDescription = await extractPromptFromImage(inputImageUrl, inputImageBase64);

  // Step 2: Build final prompt
  const finalPrompt = await injectModelIntoPrompt(rawDescription, triggerWord, lookDescription);

  // Step 3: Generate img2img (reuse base64 — avoids re-downloading)
  const imageResult = await generateImg2Img({
    imageUrl: inputImageUrl,
    imageBase64Provided: inputImageBase64,
    prompt: finalPrompt,
    loraUrl,
    loraStrength,
    denoise,
    seed,
  });

  // Step 4: Upload to Blob or R2
  let outputUrl;
  if (isVercelBlobConfigured() || isR2Configured()) {
    const buffer = Buffer.from(imageResult.base64, "base64");
    outputUrl = await uploadBufferToBlobOrR2(buffer, "nsfw-generations", "png", "image/png");
    console.log(`\n✅ Pipeline complete — stored: ${outputUrl}`);
  } else {
    // Return as data URL fallback (not ideal for production)
    outputUrl = `data:image/png;base64,${imageResult.base64}`;
    console.log(`\n✅ Pipeline complete — no Blob/R2, returning data URL`);
  }

  return {
    outputUrl,
    prompt: finalPrompt,
    rawDescription,
    filename: imageResult.filename,
  };
}

// ── NSFW txt2img via RunPod ───────────────────────────────────────────────────

const DEFAULT_NEGATIVE_PROMPT =
  "blurry, low resolution, deformed, bad anatomy, extra limbs, mutated hands, " +
  "poorly drawn face, bad proportions, watermark, text, signature, cartoon, anime, " +
  "overexposed, underexposed, plastic skin, doll-like";

/**
 * Runs the full NSFW txt2img workflow on RunPod ComfyUI.
 * Uses the same node chain as the main NSFW pipeline:
 *   UNETLoader 247 → CLIPLoader 248 → VAELoader 246 →
 *   LoadLoraFromUrlOrPath 250 → CR Apply LoRA Stack 264 →
 *   CR SDXL Aspect Ratio 50 (empty latent) →
 *   Base KSampler 276 (50 steps, cfg 3, beta, denoise 1.0) →
 *   VAEDecode 25 → VAEEncode 21 →
 *   Refiner KSampler 45 (same 247/248/246, 8 steps, cfg 0, karras, denoise 0.09) →
 *   VAEDecode 28 → Image Film Grain 284 → ImageBlur 286 → SaveImage 289
 *
 * @param {object} params
 * @param {string} params.prompt          - Full positive prompt (trigger word included)
 * @param {string} params.loraUrl         - R2 URL to .safetensors LoRA
 * @param {number} params.loraStrength    - LoRA model+clip strength (default 0.6)
 * @param {string} params.negativePrompt  - Negative prompt (optional)
 * @param {object} params.poseStrengths   - Map of pose LoRA slot to strength (default all 0)
 * @param {number} params.makeupStrength  - Running makeup LoRA strength (default 0)
 * @param {number} params.seed            - Random seed (optional)
 * @returns {Promise<{outputUrl: string, filename: string}>}
 */
export async function generateNsfwTxt2Img({
  prompt,
  loraUrl,
  loraStrength = 0.6,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  poseStrengths = {},
  makeupStrength = 0,
  seed,
}) {
  const numericLoraStrength = ensureFiniteNumber(loraStrength, "loraStrength");

  console.log("\n🔥 [RunPod] NSFW txt2img generation (full workflow)...");
  console.log(`   LoRA: ${loraUrl}`);
  console.log(`   Prompt: ${prompt.slice(0, 100)}...`);
  console.log(`   Girl LoRA strength: ${numericLoraStrength}`);

  const workflow = loadNsfwTxt2ImgWorkflow();
  const resolvedSeed = seed ?? Math.floor(Math.random() * 2_147_483_647);

  workflow["2"].inputs.text = prompt;
  workflow["42"].inputs.text = prompt;
  workflow["1"].inputs.text = negativePrompt;
  workflow["8"].inputs.text = negativePrompt;
  workflow["57"].inputs.seed = resolvedSeed;

  const stack = buildNsfwLoraStackEntries({
    loraUrl,
    girlLoraStrength: numericLoraStrength,
    poseStrengths,
    makeupStrength,
    enhancementStrengths: {},
  });
  applyCompactLoraStackToNode250(workflow["250"], stack);
  console.log(`   LoRA stack: ${stack.length} weight(s) (num_loras=${workflow["250"].inputs.num_loras})`);

  const payload = {
    prompt: workflow,
    output_node_id: "289",
  };

  const webhookUrl = resolveRunpodWebhookUrl();
  const jobId = await runpodSubmit(payload, webhookUrl);
  console.log(`   RunPod job submitted: ${jobId}`);

  const poll = await runpodPoll(jobId, 300_000);

  if (!poll || poll.error) {
    throw new Error(`NSFW txt2img failed: ${poll?.error || "no output"}`);
  }

  const handlerOut = parseRunpodHandlerOutput(poll.result) ?? poll.result;
  const images = handlerOut?.images;
  if (!images || images.length === 0) {
    throw new Error(`NSFW txt2img returned no images. Output: ${JSON.stringify(handlerOut)}`);
  }

  console.log(`   ✅ Got ${images.length} image(s)`);
  const imageResult = images[0];

  let outputUrl;
  if (isVercelBlobConfigured() || isR2Configured()) {
    const buffer = Buffer.from(imageResult.base64, "base64");
    outputUrl = await uploadBufferToBlobOrR2(buffer, "nsfw-generations", "png", "image/png");
    console.log(`   stored: ${outputUrl}`);
  } else {
    outputUrl = `data:image/png;base64,${imageResult.base64}`;
  }

  return { outputUrl, filename: imageResult.filename };
}

export default {
  extractPromptFromImage,
  injectModelIntoPrompt,
  generateImg2Img,
  generateNsfwTxt2Img,
  runImg2ImgPipeline,
};
