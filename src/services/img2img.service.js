/**
 * img2img Pipeline Service
 *
 * Orchestrates a 2-step RunPod ComfyUI flow:
 *   Step 1 — imgtoprompt: JoyCaption Beta1 describes the input image (scene, pose, activity)
 *   Step 2 — OpenAI injects the model's LoRA trigger word + look description into the prompt
 *   Step 3 — img2img: generates a swapped version using the model's LoRA on RunPod ComfyUI
 *
 * Both steps run on the same RunPod pod (same endpoint ID).
 *
 * Environment variables:
 *   RUNPOD_API_KEY           — RunPod API key
 *   RUNPOD_IMG2IMG_ENDPOINT  — RunPod serverless endpoint ID for the custom Docker
 */

import { isR2Configured, uploadBufferToR2 } from "../utils/r2.js";
import { sanitizeLoraDownloadUrl } from "../utils/loraUrl.js";

// dynamicPoll removed — inline polling used directly

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT = process.env.RUNPOD_ENDPOINT_ID || "0uskdglppin5ey";
const RUNPOD_BASE = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT}`;

if (!RUNPOD_API_KEY) {
  console.warn("⚠️  RUNPOD_API_KEY not set — img2img pipeline will not work");
}

// ── Embedded workflow templates ───────────────────────────────────────────────
// Inlined at build time so the service works in any deployment environment
// regardless of whether runpod-docker/workflows/ is present on disk.

const IMGTOPROMPT_WORKFLOW = {
  "38": {
    "class_type": "LayerUtility: LoadJoyCaptionBeta1Model",
    "inputs": {
      "model": "fancyfeast/llama-joycaption-beta-one-hf-llava",
      "quantization_mode": "bf16",
      "device": "cuda"
    }
  },
  "45": {
    "class_type": "PrimitiveString",
    "inputs": { "value": "" }
  },
  "44": {
    "class_type": "LayerUtility: JoyCaption2ExtraOptions",
    "inputs": {
      "refer_character_name": true,
      "exclude_people_info": true,
      "include_lighting": false,
      "include_camera_angle": false,
      "include_watermark": false,
      "include_JPEG_artifacts": false,
      "include_exif": false,
      "exclude_sexual": false,
      "exclude_image_resolution": false,
      "include_aesthetic_quality": false,
      "include_composition_style": false,
      "exclude_text": false,
      "specify_depth_field": false,
      "specify_lighting_sources": false,
      "do_not_use_ambiguous_language": true,
      "include_nsfw": false,
      "only_describe_most_important_elements": false,
      "character_name": ["45", 0]
    }
  },
  "52": {
    "class_type": "LoadImage",
    "inputs": { "image": "__INPUT_IMAGE__", "upload": "image" }
  },
  "48": {
    "class_type": "LayerUtility: JoyCaptionBeta1",
    "inputs": {
      "image": ["52", 0],
      "joycaption_beta1_model": ["38", 0],
      "extra_options": ["44", 0],
      "caption_type": "Descriptive",
      "caption_length": "medium-length",
      "max_new_tokens": 512,
      "top_p": 0.99,
      "top_k": 0,
      "temperature": 0.6,
      "user_prompt": "Describe the scene, setting, pose, sexual activity, and camera angle. Include: clothing, props, background, position, what is happening sexually. DO NOT describe the woman's hair color, hair length, eye color, skin tone, body type, facial features, tattoos, piercings, nail color, or expression. Use explicit anatomical terms: pussy, vagina, penis, dick, penetration, sex, anal. Do not include model names or watermarks."
    }
  },
  "53": {
    "class_type": "easy saveText",
    "inputs": {
      "text": ["48", 0],
      "output_file_path": "",
      "file_name": "",
      "file_extension": "txt",
      "overwrite": true
    }
  }
};

const IMG2IMG_WORKFLOW = {
  "1": {
    "class_type": "UNETLoader",
    "inputs": { "unet_name": "zImageTurboNSFW_43BF16AIO.safetensors", "weight_dtype": "default" }
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
  "8": { inputs: { text: "__NEGATIVE_PROMPT__", clip: ["304", 1] }, class_type: "CLIPTextEncode" },
  "21": { inputs: { pixels: ["25", 0], vae: ["304", 2] }, class_type: "VAEEncode" },
  "25": { inputs: { samples: ["276", 0], vae: ["246", 0] }, class_type: "VAEDecode" },
  "28": { inputs: { samples: ["45", 0], vae: ["304", 2] }, class_type: "VAEDecode" },
  "42": { inputs: { text: "__POSITIVE_PROMPT__", clip: ["304", 1] }, class_type: "CLIPTextEncode" },
  "45": { inputs: { seed: ["57", 0], steps: 8, cfg: 0, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 0.09, model: ["304", 0], positive: ["42", 0], negative: ["7", 0], latent_image: ["21", 0] }, class_type: "KSampler" },
  "50": { inputs: { width: 1024, height: 1024, aspect_ratio: "16:9 landscape 1344x768", swap_dimensions: "On", upscale_factor: 1, batch_size: 1 }, class_type: "CR SDXL Aspect Ratio" },
  "57": { inputs: { seed: 0 }, class_type: "Seed (rgthree)" },
  "246": { inputs: { vae_name: "ae.safetensors" }, class_type: "VAELoader" },
  "247": { inputs: { unet_name: "zImageTurboNSFW_43BF16AIO.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
  "248": { inputs: { clip_name: "qwen_3_4b.safetensors", type: "qwen_image", device: "default" }, class_type: "CLIPLoader" },
  "250": {
    inputs: {
      toggle: true, mode: "advanced", num_loras: 8,
      lora_1_url: "__LORA_URL__", lora_1_strength: "__LORA_STRENGTH__", lora_1_model_strength: "__LORA_STRENGTH__", lora_1_clip_strength: "__LORA_STRENGTH__",
      lora_2_url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Doggystyle facing the camera.safetensors", lora_2_strength: 0, lora_2_model_strength: 0, lora_2_clip_strength: 0,
      lora_3_url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Missionnary.safetensors", lora_3_strength: 0, lora_3_model_strength: 0, lora_3_clip_strength: 0,
      lora_4_url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Cowgirl.safetensors", lora_4_strength: 0, lora_4_model_strength: 0, lora_4_clip_strength: 0,
      lora_5_url: "https://huggingface.co/bigckck/ndmstr/resolve/main/tits job.safetensors", lora_5_strength: 0, lora_5_model_strength: 0, lora_5_clip_strength: 0,
      lora_6_url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_Handjob.safetensors", lora_6_strength: 0, lora_6_model_strength: 0, lora_6_clip_strength: 0,
      lora_7_url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_POV_Missionary_Anal.safetensors", lora_7_strength: 0, lora_7_model_strength: 0, lora_7_clip_strength: 0,
      lora_8_url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_Running_makeup.safetensors", lora_8_strength: 0, lora_8_model_strength: 0, lora_8_clip_strength: 0,
    },
    class_type: "LoadLoraFromUrlOrPath"
  },
  "264": { inputs: { model: ["247", 0], clip: ["248", 0], lora_stack: ["250", 0] }, class_type: "CR Apply LoRA Stack" },
  "276": { inputs: { seed: ["57", 0], steps: 50, cfg: 3, sampler_name: "dpmpp_2m", scheduler: "beta", denoise: 1, model: ["264", 0], positive: ["2", 0], negative: ["1", 0], latent_image: ["50", 4] }, class_type: "KSampler" },
  "284": { inputs: { density: 0.06, intensity: 0.1, highlights: 1, supersample_factor: 1, image: ["28", 0] }, class_type: "Image Film Grain" },
  "286": { inputs: { blur_radius: 2, sigma: 0.3, image: ["284", 0] }, class_type: "ImageBlur" },
  "289": { inputs: { filename_prefix: "modelclone", images: ["286", 0] }, class_type: "SaveImage" },
  "304": { inputs: { ckpt_name: "pornworksRealPorn_Illustrious_v4_04.safetensors" }, class_type: "CheckpointLoaderSimple" },
};

// Deep-clone so every call gets a fresh mutable copy
function cloneWorkflow(template) {
  return JSON.parse(JSON.stringify(template));
}

function loadImg2ImgWorkflow()     { return cloneWorkflow(IMG2IMG_WORKFLOW); }
function loadImgToPromptWorkflow() { return cloneWorkflow(IMGTOPROMPT_WORKFLOW); }
function loadNsfwTxt2ImgWorkflow() { return cloneWorkflow(NSFW_TXT2IMG_WORKFLOW); }

function ensureFiniteNumber(value, fieldName) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a valid number (got: ${value})`);
  }
  return n;
}

// ── RunPod API helpers ────────────────────────────────────────────────────────

async function runpodSubmit(payload) {
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT) {
    throw new Error("Generation service not configured");
  }

  const resp = await fetch(`${RUNPOD_BASE}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: payload }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Generation service submit failed ${resp.status}: ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  const jobId = data.id;
  if (!jobId) throw new Error(`Generation service returned no job id: ${JSON.stringify(data)}`);
  return jobId;
}

export async function getRunpodJobStatus(jobId) {
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT) {
    throw new Error("Generation service not configured");
  }

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
  loraUrl,
  loraStrength = 0.8,
  denoise = 0.65,
  seed,
}) {
  const numericLoraStrength = ensureFiniteNumber(loraStrength, "loraStrength");
  const numericDenoise = ensureFiniteNumber(denoise, "denoise");

  const imageBase64 = imageBase64Provided || await imageUrlToBase64(imageUrl);
  const workflow = loadImg2ImgWorkflow();
  const resolvedSeed = seed ?? Math.floor(Math.random() * 1_000_000_000);

  if (!workflow["5"]?.inputs || !workflow["6"]?.inputs || !workflow["9"]?.inputs) {
    throw new Error("img2img workflow template is missing expected nodes (5, 6, or 9)");
  }

  workflow["5"].inputs.lora_1_url = sanitizeLoraDownloadUrl(loraUrl);
  workflow["5"].inputs.lora_1_strength = numericLoraStrength;
  workflow["6"].inputs.text = prompt;
  workflow["9"].inputs.seed = resolvedSeed;
  workflow["9"].inputs.denoise = numericDenoise;

  const payload = {
    prompt: workflow,
    upload_images: [
      {
        node_id: "4",
        data: imageBase64,
        filename: "img2img_input.jpg",
      },
    ],
    output_type: "image",
    output_node_id: "289",
  };

  const runpodJobId = await runpodSubmit(payload);
  return { runpodJobId, resolvedSeed };
}

async function runpodPoll(jobId, timeoutMs = 300_000, intervalMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, attempt === 1 ? 3_000 : intervalMs));

    let data;
    try {
      const resp = await fetch(`${RUNPOD_BASE}/status/${jobId}`, {
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

// ── Step 1: Extract prompt via ComfyUI JoyCaption Beta1 ──────────────────────

/**
 * Sends the input image to RunPod ComfyUI using the imgtoprompt_api.json workflow.
 * JoyCaption Beta1 (LayerStyle) describes the scene; result comes from node 53 (easy saveText).
 */
export async function extractPromptFromImage(imageUrl, imageBase64Provided) {
  console.log("\n🔍 [img2img] Step 1 — extracting prompt via ComfyUI JoyCaption...");
  console.log(`   Image: ${imageBase64Provided ? "[base64 upload]" : imageUrl}`);

  let imageBase64;
  if (imageBase64Provided) {
    imageBase64 = imageBase64Provided;
  } else {
    // Validate URL before attempting to fetch — placeholder values like "upload"
    // or "base64-upload" must never be fetched.
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      throw new Error(
        `Cannot analyze image: no valid URL or base64 data provided (got: "${imageUrl}"). ` +
        `Please upload the image file directly instead of using a URL.`
      );
    }
    imageBase64 = await imageUrlToBase64(imageUrl);
  }
  const workflow = loadImgToPromptWorkflow();

  const payload = {
    prompt: workflow,
    upload_images: [
      {
        node_id: "52",
        data: imageBase64,
        filename: "joycaption_input.jpg",
      },
    ],
    output_type: "text",
    output_node_id: "53",  // "easy saveText" node — appears in ComfyUI history with {"text": ["..."]}
  };

  const jobId = await runpodSubmit(payload);
  console.log(`   RunPod job submitted: ${jobId}`);

  const output = await runpodPoll(jobId, 300_000);

  if (!output) {
    throw new Error("Image captioning job returned no output");
  }
  if (output.error) {
    throw new Error(`JoyCaption failed: ${output.error}`);
  }

  // RunPod returns { phase: "done", result: data.output }; caption can be result.text or top-level text
  const text =
    (typeof output.text === "string" && output.text.trim()) ||
    (output.result && typeof output.result.text === "string" && output.result.text.trim()) ||
    (output.result?.output_nodes?.["53"]?.text?.[0]) ||
    (Array.isArray(output.result?.text) && output.result.text[0]);
  if (!text || !String(text).trim()) {
    throw new Error(
      `JoyCaption returned no text. Output nodes: ${JSON.stringify(output.output_nodes || output.result || output)}`
    );
  }

  const caption = String(text).trim();
  console.log(`   ✅ JoyCaption description (${caption.length} chars): ${caption.slice(0, 120)}...`);
  return caption;
}

// ── Step 2: Inject model trigger word + look via OpenAI ──────────────────────

/**
 * Takes the raw JoyCaption description and rewrites it to include:
 * - The model's LoRA trigger word (so the LoRA fires correctly)
 * - Key look descriptors from the model profile (hair, skin, eyes, body)
 *
 * Returns the final ComfyUI-ready prompt string.
 */
export async function injectModelIntoPrompt(rawDescription, triggerWord, lookDescription = "") {
  console.log("\n✍️  [img2img] Step 2 — injecting model identity into prompt via Grok...");
  console.log(`   Trigger: ${triggerWord}`);
  console.log(`   Look: ${lookDescription || "(empty — will use generic)"}`);

  try {
    const { default: OpenAI } = await import("openai");
    const grok = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const systemPrompt = `You are an expert ComfyUI prompt engineer for AI image generation with LoRA models.
Your task: take a scene description and COMPLETELY REPLACE the original woman's entire physical identity with a specific LoRA model's detailed appearance profile.

CRITICAL RULES:
1. Start ALWAYS with the LoRA trigger word followed by a comma
2. Immediately after the trigger word, inject the FULL physical profile of the LoRA model — this is the most important part for consistency:
   - Ethnicity, skin tone and skin color (MUST match the model exactly)
   - Hair color, hair style and hair length
   - Eye color and eye shape
   - Face shape, nose shape, lip type
   - Body type, body proportions, height
   - Breast size and shape
   - Butt size, waist, hips
   - Any tattoos or piercings
3. REMOVE every single physical descriptor from the original scene that describes the original woman's appearance — hair, skin, eyes, body, face, breasts, butt, everything
4. KEEP ONLY: the scene, pose, sexual activity/position, camera angle, setting, lighting, background, clothing/props, and composition
5. The LoRA model's appearance MUST be described as a coherent person, not a list — weave it naturally into the prompt
6. Keep it under 250 words, single line, no newlines
7. Use explicit anatomical terms as needed
8. Output ONLY the final prompt text, nothing else

EXAMPLE STRUCTURE: "{trigger}, a {ethnicity} woman with {hair}, {skin}, {eyes}, {face}, {body with breasts/butt/waist/hips}, {tattoos if any}, {scene/pose/activity from original}"`;

    const userMessage = `LoRA trigger word: ${triggerWord}

LoRA MODEL'S COMPLETE APPEARANCE PROFILE (use ALL of these, they define this specific person):
${lookDescription || "a naturally realistic woman"}

ORIGINAL SCENE (keep ONLY the scene/pose/activity/setting, DISCARD all physical descriptions of the woman):
${rawDescription}

Write the final ComfyUI prompt. Start with the trigger word, then the LoRA model's full physical description woven naturally, then the scene details:`;

    const completion = await grok.chat.completions.create({
      model: "x-ai/grok-4.1-fast",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 400,
      temperature: 0.35,
    });

    const injected = completion.choices[0]?.message?.content?.trim();
    if (injected) {
      console.log(`   ✅ Grok injected prompt: ${injected.slice(0, 120)}...`);
      return injected;
    }
  } catch (err) {
    console.warn(`   ⚠️  Grok injection failed (${err.message}), using manual injection`);
  }

  // Fallback: manual prefix injection
  const lookPrefix = lookDescription ? `${lookDescription}, ` : "";
  const injected = `${triggerWord}, ${lookPrefix}${rawDescription}`;
  console.log(`   ✅ Manual injection: ${injected.slice(0, 120)}...`);
  return injected;
}

// ── Step 3: Generate img2img output ──────────────────────────────────────────

/**
 * Runs the img2img ComfyUI workflow on RunPod.
 * Returns base64-encoded image data.
 */
export async function generateImg2Img({ imageUrl, imageBase64Provided, prompt, loraUrl, loraStrength = 0.8, denoise = 0.65, seed }) {
  const numericLoraStrength = ensureFiniteNumber(loraStrength, "loraStrength");
  const numericDenoise = ensureFiniteNumber(denoise, "denoise");

  console.log("\n🎨 [img2img] Step 3 — running img2img generation...");
  console.log(`   LoRA: ${loraUrl}`);
  console.log(`   Prompt: ${prompt.slice(0, 100)}...`);
  console.log(`   Denoise: ${numericDenoise}  LoRA strength: ${numericLoraStrength}`);

  const imageBase64 = imageBase64Provided || await imageUrlToBase64(imageUrl);
  const workflow = loadImg2ImgWorkflow();

  const resolvedSeed = seed ?? Math.floor(Math.random() * 1_000_000_000);

  if (!workflow["5"]?.inputs || !workflow["6"]?.inputs || !workflow["9"]?.inputs) {
    throw new Error("img2img workflow template is missing expected nodes (5, 6, or 9)");
  }

  workflow["5"].inputs.lora_1_url = sanitizeLoraDownloadUrl(loraUrl);
  workflow["5"].inputs.lora_1_strength = numericLoraStrength;
  workflow["6"].inputs.text = prompt;
  workflow["9"].inputs.seed = resolvedSeed;
  workflow["9"].inputs.denoise = numericDenoise;

  const payload = {
    prompt: workflow,
    upload_images: [
      {
        node_id: "4",
        data: imageBase64,
        filename: "img2img_input.jpg",
      },
    ],
    output_type: "image",
    output_node_id: "289",
  };

  const jobId = await runpodSubmit(payload);
  console.log(`   RunPod job submitted: ${jobId}`);

  const output = await runpodPoll(jobId, 300_000);

  if (!output || output.error) {
    throw new Error(`img2img step failed: ${output?.error || "no output"}`);
  }

  const images = output.images;
  if (!images || images.length === 0) {
    throw new Error(`img2img returned no images. Output: ${JSON.stringify(output)}`);
  }

  console.log(`   ✅ Got ${images.length} image(s) from node ${images[0].node_id}`);
  return images[0]; // { filename, node_id, base64 }
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

/**
 * Runs the complete img2img pipeline:
 * 1. JoyCaption extracts scene description from input image
 * 2. OpenAI injects trigger word + model look
 * 3. img2img generates the swapped result
 * 4. Result is uploaded to R2 for permanent storage
 *
 * @param {object} params
 * @param {string} params.inputImageUrl   - Source image URL (the image to swap)
 * @param {string} params.loraUrl         - R2 URL to the user's LoRA .safetensors
 * @param {string} params.triggerWord     - LoRA trigger word (e.g. "lora_keo")
 * @param {string} params.lookDescription - Model appearance for prompt injection (optional)
 * @param {number} params.loraStrength    - LoRA model + clip strength (default 0.8)
 * @param {number} params.denoise         - img2img denoise strength (default 0.65)
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
    denoise = 0.65,
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

  // Step 4: Upload to R2
  let outputUrl;
  if (isR2Configured()) {
    const buffer = Buffer.from(imageResult.base64, "base64");
    outputUrl = await uploadBufferToR2(buffer, "nsfw-generations", "png", "image/png");
    console.log(`\n✅ Pipeline complete — R2: ${outputUrl}`);
  } else {
    // Return as data URL fallback (not ideal for production)
    outputUrl = `data:image/png;base64,${imageResult.base64}`;
    console.log(`\n✅ Pipeline complete — R2 not configured, returning data URL`);
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
 *   Refiner CheckpointLoaderSimple 304 → KSampler 45 (8 steps, cfg 0, karras, denoise 0.09) →
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

  workflow["250"].inputs.lora_1_url = sanitizeLoraDownloadUrl(loraUrl);
  workflow["250"].inputs.lora_1_strength = numericLoraStrength;
  workflow["250"].inputs.lora_1_model_strength = numericLoraStrength;
  workflow["250"].inputs.lora_1_clip_strength = numericLoraStrength;

  const poseSlotMap = {
    "290": 2, "291": 3, "292": 4, "293": 5, "294": 6, "295": 7,
  };
  for (const [nodeId, slot] of Object.entries(poseSlotMap)) {
    const str = poseStrengths[nodeId] || 0;
    workflow["250"].inputs[`lora_${slot}_strength`] = str;
    workflow["250"].inputs[`lora_${slot}_model_strength`] = str;
    workflow["250"].inputs[`lora_${slot}_clip_strength`] = str;
  }

  workflow["250"].inputs.lora_8_strength = makeupStrength;
  workflow["250"].inputs.lora_8_model_strength = makeupStrength;
  workflow["250"].inputs.lora_8_clip_strength = makeupStrength;

  const payload = {
    prompt: workflow,
    output_node_id: "289",
  };

  const jobId = await runpodSubmit(payload);
  console.log(`   RunPod job submitted: ${jobId}`);

  const output = await runpodPoll(jobId, 300_000);

  if (!output || output.error) {
    throw new Error(`NSFW txt2img failed: ${output?.error || "no output"}`);
  }

  const images = output.images;
  if (!images || images.length === 0) {
    throw new Error(`NSFW txt2img returned no images. Output: ${JSON.stringify(output)}`);
  }

  console.log(`   ✅ Got ${images.length} image(s)`);
  const imageResult = images[0];

  let outputUrl;
  if (isR2Configured()) {
    const buffer = Buffer.from(imageResult.base64, "base64");
    outputUrl = await uploadBufferToR2(buffer, "nsfw-generations", "png", "image/png");
    console.log(`   R2: ${outputUrl}`);
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
