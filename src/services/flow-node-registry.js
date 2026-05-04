/**
 * AI Flows Builder â€” Node Registry
 *
 * Maps every node type to:
 *  - metadata (label, category, color, icon, input/output port definitions)
 *  - an `execute(inputs, nodeData, userId, onProgress)` function that calls
 *    existing internal service functions directly (no HTTP round-trip).
 *
 * Executors receive already-resolved inputs (values piped from upstream nodes),
 * plus the node's own configuration data (sliders, dropdowns, etc.).
 * They return `{ output }` where `output` is an image URL, video URL, or string.
 */

import prisma from "../lib/prisma.js";
import { getGenerationPricing } from "./generation-pricing.service.js";
import { checkAndExpireCredits, getTotalCredits, deductCredits, refundCredits } from "./credit.service.js";

// ---------------------------------------------------------------------------
// Port type definitions â€” used for connection validation and handle coloring
// ---------------------------------------------------------------------------
export const PORT_TYPES = {
  image:  { color: "#a78bfa", label: "Image" },
  video:  { color: "#f59e0b", label: "Video" },
  text:   { color: "#06b6d4", label: "Text" },
  model:  { color: "#10b981", label: "Model" },
  audio:  { color: "#f472b6", label: "Audio" },
  any:    { color: "#6b7280", label: "Any" },
};

// ---------------------------------------------------------------------------
// Helper: poll generation until complete or timeout
// ---------------------------------------------------------------------------
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS  = 8 * 60 * 1000; // 8 min

async function pollGeneration(generationId, onProgress) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const gen = await prisma.generation.findUnique({
      where: { id: generationId },
      select: { status: true, outputUrl: true, errorMessage: true },
    });
    if (!gen) throw new Error("Generation not found");
    if (gen.status === "completed" && gen.outputUrl) return gen.outputUrl;
    if (gen.status === "failed") throw new Error(gen.errorMessage || "Generation failed");
    onProgress?.({ message: `Waiting for generation ${generationId.slice(0,8)}â€¦ (${gen.status})` });
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Generation timed out after 8 minutes");
}

// ---------------------------------------------------------------------------
// Helper: call internal generation function and poll for result
// ---------------------------------------------------------------------------
async function runGeneration({ userId, type, prompt, modelId, replicateModel, creditsCost, submitFn }) {
  const gen = await prisma.generation.create({
    data: { userId, type, prompt: prompt || "", status: "processing", creditsCost, replicateModel, modelId },
  });
  try {
    await submitFn(gen.id);
  } catch (err) {
    await prisma.generation.update({ where: { id: gen.id }, data: { status: "failed", errorMessage: err.message } });
    throw err;
  }
  return gen.id;
}

// ---------------------------------------------------------------------------
// Node Registry
// ---------------------------------------------------------------------------

export const NODE_REGISTRY = {

  // â”€â”€ INPUT NODES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  "image-input": {
    label: "Image Input",
    category: "inputs",
    color: "#60a5fa",
    description: "Upload an image or provide a URL",
    inputs: [],
    outputs: [{ id: "image", type: "image", label: "Image" }],
    defaultData: { imageUrl: "", mode: "url" },
    creditCost: 0,
    execute: async (inputs, nodeData) => {
      const url = nodeData.imageUrl || inputs.imageUrl;
      if (!url) throw new Error("Image Input: no image URL provided");
      return { output: url, outputType: "image" };
    },
  },

  "text-input": {
    label: "Text Input",
    category: "inputs",
    color: "#60a5fa",
    description: "A text value or prompt",
    inputs: [],
    outputs: [{ id: "text", type: "text", label: "Text" }],
    defaultData: { text: "" },
    creditCost: 0,
    execute: async (inputs, nodeData) => {
      const text = nodeData.text || inputs.text || "";
      return { output: text, outputType: "text" };
    },
  },

  "model-selector": {
    label: "Model Selector",
    category: "inputs",
    color: "#60a5fa",
    description: "Select one of your AI models",
    inputs: [],
    outputs: [{ id: "model", type: "model", label: "Model" }],
    defaultData: { modelId: "" },
    creditCost: 0,
    execute: async (inputs, nodeData, userId) => {
      const modelId = nodeData.modelId || inputs.modelId;
      if (!modelId) throw new Error("Model Selector: no model selected");
      const model = await prisma.savedModel.findFirst({ where: { id: modelId, userId } });
      if (!model) throw new Error("Model Selector: model not found");
      return { output: model, outputType: "model" };
    },
  },

  "audio-input": {
    label: "Audio Input",
    category: "inputs",
    color: "#60a5fa",
    description: "Upload an audio file or provide a URL",
    inputs: [],
    outputs: [{ id: "audio", type: "audio", label: "Audio" }],
    defaultData: { audioUrl: "", mode: "url" },
    creditCost: 0,
    execute: async (inputs, nodeData) => {
      const url = nodeData.audioUrl || inputs.audioUrl;
      if (!url) throw new Error("Audio Input: no audio URL provided");
      return { output: url, outputType: "audio" };
    },
  },

  // â”€â”€ IMAGE GENERATION NODES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  "enhance-prompt": {
    label: "Enhance Prompt",
    category: "images",
    color: "#a78bfa",
    description: "AI-enhance a prompt using INSTARAW style",
    inputs: [{ id: "text", type: "text", label: "Prompt" }],
    outputs: [{ id: "text", type: "text", label: "Enhanced Prompt" }],
    defaultData: { mode: "casual" },
    creditCost: 1,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const { INSTARAW_NANO_BANANA_ENHANCE_SYSTEM } = await import("./nanobanana-prompt.service.js");
      const prompt = inputs.text;
      if (!prompt) throw new Error("Enhance Prompt: no input text");
      const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
      if (!OPENROUTER_API_KEY) throw new Error("Enhance Prompt: OPENROUTER_API_KEY not set");

      const pricing = await getGenerationPricing();
      const cost = Number(pricing.enhancePromptDefault ?? 1);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Enhancing prompt with AIâ€¦" });
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENROUTER_API_KEY}` },
        body: JSON.stringify({
          model: "x-ai/grok-4.1-fast",
          messages: [
            { role: "system", content: INSTARAW_NANO_BANANA_ENHANCE_SYSTEM },
            { role: "user", content: `User's idea: "${prompt}"\n\nWrite the full INSTARAW image edit instruction now.` },
          ],
          max_tokens: 700, temperature: 0.35,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) throw new Error(`Enhance Prompt API error: ${resp.status}`);
      const data = await resp.json();
      const enhanced = data.choices?.[0]?.message?.content?.trim() || prompt;
      return { output: enhanced, outputType: "text", creditsUsed: cost };
    },
  },

  "nana-banana-avatar": {
    label: "NanaBanana Avatar",
    category: "images",
    color: "#a78bfa",
    description: "Generate image using your model with NanaBanana Pro",
    inputs: [
      { id: "model", type: "model", label: "Model" },
      { id: "text", type: "text", label: "Prompt" },
      { id: "image", type: "image", label: "Ref Photo (optional)" },
    ],
    outputs: [{ id: "image", type: "image", label: "Image" }],
    defaultData: { resolution: "2K", aspectRatio: "9:16" },
    creditCost: 20,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const { generateImageWithNanoBananaKie } = await import("./kie.service.js");
      const model = inputs.model;
      if (!model) throw new Error("NanaBanana Avatar: model required");
      const prompt = inputs.text || nodeData.prompt || "";
      const refs = [inputs.image, model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean).slice(0, 4);

      const pricing = await getGenerationPricing();
      const cost = Number(pricing.imagePromptCasual ?? 20);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Submitting NanaBanana generationâ€¦" });
      let outputUrl = null;
      const result = await generateImageWithNanoBananaKie(refs, prompt, {
        resolution: nodeData.resolution || "2K",
        aspectRatio: nodeData.aspectRatio || "9:16",
        onTaskCreated: async (taskId) => {
          onProgress?.({ message: `KIE task created: ${taskId}` });
          // Create generation record for tracking
          await prisma.generation.create({
            data: { userId, modelId: model.id, type: "advanced-image", status: "processing",
              prompt, creditsCost: cost, replicateModel: `kie-task:${taskId}` }
          }).catch(() => {});
        },
      });
      if (result.success && result.outputUrl) {
        outputUrl = result.outputUrl;
      } else if (result.deferred && result.taskId) {
        onProgress?.({ message: "Waiting for resultâ€¦" });
        const maxWait = 5 * 60 * 1000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          await new Promise(r => setTimeout(r, 4000));
          const gen = await prisma.generation.findFirst({
            where: { userId, replicateModel: `kie-task:${result.taskId}` },
            orderBy: { createdAt: "desc" },
          });
          if (gen?.status === "completed" && gen.outputUrl) { outputUrl = gen.outputUrl; break; }
          if (gen?.status === "failed") throw new Error("NanaBanana generation failed");
        }
      }
      if (!outputUrl) throw new Error("NanaBanana: no output URL received");
      return { output: outputUrl, outputType: "image", creditsUsed: cost };
    },
  },

  "seedream-avatar": {
    label: "Seedream 5 Avatar",
    category: "images",
    color: "#a78bfa",
    description: "Generate image using your model with Seedream 5.0 Lite",
    inputs: [
      { id: "model", type: "model", label: "Model" },
      { id: "text", type: "text", label: "Prompt" },
    ],
    outputs: [{ id: "image", type: "image", label: "Image" }],
    defaultData: { aspectRatio: "9:16" },
    creditCost: 10,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const { generateImageWithSeedream5Lite } = await import("./kie.service.js");
      const model = inputs.model;
      if (!model) throw new Error("Seedream Avatar: model required");
      const prompt = inputs.text || nodeData.prompt || "";
      const refs = [model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean);

      const pricing = await getGenerationPricing();
      const cost = Number(pricing.creatorStudioSeedream45Edit ?? 10);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Submitting Seedream generationâ€¦" });
      const result = await generateImageWithSeedream5Lite(refs, prompt, { aspectRatio: nodeData.aspectRatio || "9:16", quality: "basic" });
      if (!result.success && !result.deferred) throw new Error(result.error || "Seedream failed");

      let outputUrl = result.outputUrl;
      if (result.deferred && result.taskId) {
        onProgress?.({ message: "Waiting for Seedream resultâ€¦" });
        const maxWait = 5 * 60 * 1000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          await new Promise(r => setTimeout(r, 4000));
          const gen = await prisma.generation.findFirst({
            where: { userId, replicateModel: `kie-task:${result.taskId}` },
            orderBy: { createdAt: "desc" },
          });
          if (gen?.status === "completed" && gen.outputUrl) { outputUrl = gen.outputUrl; break; }
          if (gen?.status === "failed") throw new Error("Seedream generation failed");
        }
      }
      if (!outputUrl) throw new Error("Seedream: no output received");
      return { output: outputUrl, outputType: "image", creditsUsed: cost };
    },
  },

  "mcx-img2img": {
    label: "ModelClone-X",
    category: "images",
    color: "#a78bfa",
    description: "Image-to-image with your character LoRA",
    inputs: [
      { id: "image", type: "image", label: "Input Image" },
      { id: "model", type: "model", label: "Model (optional)" },
      { id: "text", type: "text", label: "Prompt" },
    ],
    outputs: [{ id: "image", type: "image", label: "Output" }],
    defaultData: { loraStrength: 0.85, denoise: 0.75, steps: 25 },
    creditCost: 15,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const { submitModelCloneXImg2ImgJob, pollModelCloneXJob } = await import("./modelcloneX.service.js");
      const pricing = await getGenerationPricing();
      const cost = Number(pricing.modelcloneXWithModel1 ?? 15);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      const loraUrl = inputs.model?.loraUrl || nodeData.loraUrl;
      const prompt = inputs.text || nodeData.prompt || "masterpiece, best quality";
      onProgress?.({ message: "Submitting MCX jobâ€¦" });

      const gen = await prisma.generation.create({
        data: { userId, type: "mcx-img2img", status: "processing", prompt, creditsCost: cost, replicateModel: "comfyui-mcx-i2i" },
      });
      const job = await submitModelCloneXImg2ImgJob({
        imageUrl: inputs.image,
        prompt,
        loraUrl,
        loraStrength: nodeData.loraStrength || 0.85,
        batchSize: 1,
        denoise: nodeData.denoise || 0.75,
      });
      await prisma.generation.update({ where: { id: gen.id }, data: { providerTaskId: job.id || job.requestId } });

      onProgress?.({ message: "Waiting for MCX resultâ€¦" });
      const images = await pollModelCloneXJob(job.id || job.requestId, gen.id, userId);
      if (!images?.length) throw new Error("MCX: no output images");
      return { output: images[0], outputType: "image", creditsUsed: cost };
    },
  },

  "upscaler": {
    label: "Upscaler",
    category: "images",
    color: "#a78bfa",
    description: "Upscale image to higher resolution",
    inputs: [{ id: "image", type: "image", label: "Image" }],
    outputs: [{ id: "image", type: "image", label: "Upscaled" }],
    defaultData: { scale: 2 },
    creditCost: 5,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const imageUrl = inputs.image;
      if (!imageUrl) throw new Error("Upscaler: no input image");
      const pricing = await getGenerationPricing();
      const cost = Number(pricing.upscalerImage ?? 5);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      const { submitRunningHubUpscalerJob, queryRunningHubTask, extractRunningHubOutputUrl } = await import("../services/runninghub.service.js");
      onProgress?.({ message: "Submitting upscale jobâ€¦" });

      const gen = await prisma.generation.create({
        data: { userId, type: "upscaler", status: "processing", prompt: "upscale", creditsCost: cost, replicateModel: "runninghub-upscaler" },
      });

      let imageBase64 = null;
      try {
        const imgResp = await fetch(imageUrl);
        const buf = await imgResp.arrayBuffer();
        imageBase64 = Buffer.from(buf).toString("base64");
      } catch { imageBase64 = null; }

      const { taskId } = await submitRunningHubUpscalerJob(imageBase64 || imageUrl);
      await prisma.generation.update({ where: { id: gen.id }, data: { providerTaskId: taskId } });

      onProgress?.({ message: "Waiting for upscale resultâ€¦" });
      const maxWait = 5 * 60 * 1000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 4000));
        const status = await queryRunningHubTask(taskId);
        if (status === "success" || status?.status === "success") {
          const url = extractRunningHubOutputUrl?.(status) || null;
          if (url) {
            await prisma.generation.update({ where: { id: gen.id }, data: { status: "completed", outputUrl: url, completedAt: new Date() } });
            return { output: url, outputType: "image", creditsUsed: cost };
          }
        }
        if (status === "failed" || status?.status === "failed") throw new Error("Upscale job failed");
      }
      throw new Error("Upscaler timed out");
    },
  },

  "synthid-remover": {
    label: "SynthID Remover",
    category: "images",
    color: "#a78bfa",
    description: "Remove SynthID or digital watermarks",
    inputs: [{ id: "image", type: "image", label: "Image" }],
    outputs: [{ id: "image", type: "image", label: "Clean Image" }],
    defaultData: {},
    creditCost: 20,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const imageUrl = inputs.image;
      if (!imageUrl) throw new Error("SynthID Remover: no input image");
      const pricing = await getGenerationPricing();
      const cost = Number(pricing.synthIdRemove ?? 20);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      const { submitSynthIdRemoveJob, queryRunningHubTask, extractRunningHubOutputUrl } = await import("../services/runninghub.service.js");

      let imageBase64 = null;
      try {
        const imgResp = await fetch(imageUrl);
        const buf = await imgResp.arrayBuffer();
        imageBase64 = Buffer.from(buf).toString("base64");
      } catch { imageBase64 = null; }

      onProgress?.({ message: "Submitting SynthID removal jobâ€¦" });
      const gen = await prisma.generation.create({
        data: { userId, type: "synthid-remove", status: "processing", prompt: "synthid-remove", creditsCost: cost, replicateModel: "runninghub-synthid" },
      });
      const { taskId } = await submitSynthIdRemoveJob(imageBase64 || imageUrl);
      await prisma.generation.update({ where: { id: gen.id }, data: { providerTaskId: taskId } });

      const maxWait = 60 * 60 * 1000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 5000));
        const status = await queryRunningHubTask(taskId);
        if (status === "success" || status?.status === "success") {
          const url = extractRunningHubOutputUrl?.(status) || null;
          if (url) {
            await prisma.generation.update({ where: { id: gen.id }, data: { status: "completed", outputUrl: url, completedAt: new Date() } });
            return { output: url, outputType: "image", creditsUsed: cost };
          }
        }
        if (status === "failed" || status?.status === "failed") throw new Error("SynthID removal failed");
      }
      throw new Error("SynthID Remover timed out");
    },
  },

  "face-swap": {
    label: "Face Swap",
    category: "images",
    color: "#a78bfa",
    description: "Swap face from source image onto target",
    inputs: [
      { id: "image", type: "image", label: "Target Image" },
      { id: "face", type: "image", label: "Face Source" },
    ],
    outputs: [{ id: "image", type: "image", label: "Result" }],
    defaultData: {},
    creditCost: 10,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const targetImage = inputs.image;
      const faceImage = inputs.face || inputs.image2;
      if (!targetImage || !faceImage) throw new Error("Face Swap: target image and face source required");
      const pricing = await getGenerationPricing();
      const cost = Number(pricing.imageFaceSwap ?? 10);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Submitting face swapâ€¦" });
      const { faceSwapImage } = await import("../controllers/generation.controller.js").catch(() => ({}));
      // Direct wavespeed face swap
      const { generateFaceSwapWithWavespeed } = await import("./wavespeed.service.js").catch(() => ({}));
      if (generateFaceSwapWithWavespeed) {
        const result = await generateFaceSwapWithWavespeed(targetImage, faceImage);
        if (result?.success && result.outputUrl) return { output: result.outputUrl, outputType: "image", creditsUsed: cost };
        throw new Error(result?.error || "Face swap failed");
      }
      throw new Error("Face swap service not available");
    },
  },

  "creator-studio": {
    label: "Creator Studio",
    category: "images",
    color: "#a78bfa",
    description: "Generate with Creator Studio (Flux, Wan, Ideogram, etc.)",
    inputs: [{ id: "text", type: "text", label: "Prompt" }],
    outputs: [{ id: "image", type: "image", label: "Image" }],
    defaultData: { model: "seedream-5-lite", resolution: "1K", aspectRatio: "9:16" },
    creditCost: 10,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const prompt = inputs.text || nodeData.prompt || "";
      if (!prompt) throw new Error("Creator Studio: prompt required");
      const pricing = await getGenerationPricing();
      const cost = Number(pricing.creatorStudioSeedream45Edit ?? 10);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Generating with Creator Studioâ€¦" });
      const { generateImageWithSeedream5Lite } = await import("./kie.service.js");
      const result = await generateImageWithSeedream5Lite([], prompt, {
        aspectRatio: nodeData.aspectRatio || "9:16",
        quality: "basic",
      });
      let outputUrl = result.outputUrl;
      if (result.deferred && result.taskId) {
        const maxWait = 4 * 60 * 1000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          await new Promise(r => setTimeout(r, 4000));
          const gen = await prisma.generation.findFirst({
            where: { userId, replicateModel: `kie-task:${result.taskId}` }, orderBy: { createdAt: "desc" },
          });
          if (gen?.status === "completed" && gen.outputUrl) { outputUrl = gen.outputUrl; break; }
          if (gen?.status === "failed") throw new Error("Creator Studio generation failed");
        }
      }
      if (!outputUrl) throw new Error("Creator Studio: no output");
      return { output: outputUrl, outputType: "image", creditsUsed: cost };
    },
  },

  // â”€â”€ VIDEO GENERATION NODES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  "video-prompt": {
    label: "Video from Prompt",
    category: "video",
    color: "#f59e0b",
    description: "Generate video from a text prompt",
    inputs: [
      { id: "text", type: "text", label: "Prompt" },
      { id: "image", type: "image", label: "Reference Image (opt)" },
    ],
    outputs: [{ id: "video", type: "video", label: "Video" }],
    defaultData: { videoModel: "kling-3.0", duration: 5, resolution: "720p" },
    creditCost: 70,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const prompt = inputs.text || nodeData.prompt || "";
      if (!prompt) throw new Error("Video from Prompt: prompt required");
      const pricing = await getGenerationPricing();
      const perSec = Number(pricing.kling30StdNoSoundPerSec ?? 14);
      const duration = nodeData.duration || 5;
      const cost = Math.ceil(perSec * duration);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Submitting video generationâ€¦" });
      const { generateKlingVideoKie } = await import("./kie.service.js").catch(() => ({}));
      if (!generateKlingVideoKie) throw new Error("Video generation service not available");
      const gen = await prisma.generation.create({
        data: { userId, type: "prompt-video", status: "processing", prompt, creditsCost: cost, replicateModel: "kie-kling" },
      });
      const result = await generateKlingVideoKie({ prompt, imageUrl: inputs.image, duration, resolution: nodeData.resolution || "720p",
        onTaskCreated: async (taskId) => {
          await prisma.generation.update({ where: { id: gen.id }, data: { replicateModel: `kie-task:${taskId}` } });
        }
      }).catch(e => { throw e; });

      let outputUrl = result?.outputUrl;
      if (result?.deferred && result?.taskId) {
        onProgress?.({ message: "Waiting for video resultâ€¦" });
        outputUrl = await pollGeneration(gen.id, onProgress);
      }
      if (!outputUrl) throw new Error("Video from Prompt: no output");
      return { output: outputUrl, outputType: "video", creditsUsed: cost };
    },
  },

  "video-motion": {
    label: "Motion Control",
    category: "video",
    color: "#f59e0b",
    description: "Animate an image using a motion reference video",
    inputs: [
      { id: "image", type: "image", label: "Source Image" },
      { id: "video", type: "video", label: "Motion Reference" },
    ],
    outputs: [{ id: "video", type: "video", label: "Video" }],
    defaultData: { resolution: "1080p", ultra: false },
    creditCost: 130,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const imageUrl = inputs.image;
      const videoUrl = inputs.video;
      if (!imageUrl || !videoUrl) throw new Error("Motion Control: image and motion reference required");
      const pricing = await getGenerationPricing();
      const perSec = Number(nodeData.ultra ? pricing.videoRecreateUltraPerSec : pricing.videoRecreateMotionProPerSec ?? 18);
      const cost = Math.ceil(perSec * 5);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Submitting motion control videoâ€¦" });
      const { generateVideoWithMotionKie } = await import("./kie.service.js");
      const gen = await prisma.generation.create({
        data: { userId, type: "recreate-video", status: "processing", prompt: "motion-control", creditsCost: cost, replicateModel: "kie-motion" },
      });
      const result = await generateVideoWithMotionKie(imageUrl, videoUrl, {
        ultra: nodeData.ultra || false,
        onTaskCreated: async (taskId) => {
          await prisma.generation.update({ where: { id: gen.id }, data: { replicateModel: `kie-task:${taskId}` } });
        },
      });
      let outputUrl = result?.outputUrl;
      if (result?.deferred && result?.taskId) {
        onProgress?.({ message: "Waiting for motion video resultâ€¦" });
        outputUrl = await pollGeneration(gen.id, onProgress);
      }
      if (!outputUrl) throw new Error("Motion Control: no output");
      return { output: outputUrl, outputType: "video", creditsUsed: cost };
    },
  },

  "talking-head": {
    label: "Talking Head",
    category: "video",
    color: "#f59e0b",
    description: "Lip-sync a portrait to audio (Kling V2 AI Avatar)",
    inputs: [
      { id: "image", type: "image", label: "Portrait" },
      { id: "audio", type: "audio", label: "Audio" },
      { id: "text", type: "text", label: "Prompt (opt)" },
    ],
    outputs: [{ id: "video", type: "video", label: "Video" }],
    defaultData: {},
    creditCost: 50,
    execute: async (inputs, nodeData, userId, onProgress) => {
      if (!inputs.image) throw new Error("Talking Head: portrait image required");
      if (!inputs.audio) throw new Error("Talking Head: audio required");
      const cost = 50;
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);
      onProgress?.({ message: "Submitting talking head…" });
      const { generateTalkingHead } = await import("./wavespeed.service.js");
      const gen = await prisma.generation.create({
        data: {
          userId,
          type: "talking-head",
          status: "processing",
          prompt: (inputs.text || nodeData.prompt || "talking-head").slice(0, 500),
          creditsCost: cost,
          replicateModel: "wavespeed-kling-v2-avatar",
        },
      });
      try {
        const result = await generateTalkingHead(inputs.image, inputs.audio, inputs.text || nodeData.prompt || null);
        const outputUrl = result?.outputUrl;
        if (!outputUrl) throw new Error("Talking Head: no output URL returned");
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "completed", outputUrl, completedAt: new Date() },
        });
        return { output: outputUrl, outputType: "video", creditsUsed: cost };
      } catch (err) {
        await prisma.generation.update({
          where: { id: gen.id },
          data: { status: "failed", errorMessage: err.message },
        }).catch(() => {});
        throw err;
      }
    },
  },

  // ── AUDIO / VOICE NODES ───────────────────────────────────────────────────

  "voice-gen": {
    label: "Voice Generation",
    category: "audio",
    color: "#f472b6",
    description: "Generate speech with your model's cloned voice",
    inputs: [
      { id: "model", type: "model", label: "Model" },
      { id: "text", type: "text", label: "Script" },
    ],
    outputs: [{ id: "audio", type: "audio", label: "Audio" }],
    defaultData: { stability: 0.5, similarityBoost: 0.75, style: 0.0 },
    creditCost: 25,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const { textToSpeech, uploadAudioToR2 } = await import("./elevenlabs.service.js");
      const { VOICE_TTS_MODEL_ID, estimateVoiceAudioCredits } =
        await import("./voice-platform.service.js");
      const model = inputs.model;
      if (!model) throw new Error("Voice Gen: model required");
      const script = (inputs.text || nodeData.script || "").trim();
      if (!script) throw new Error("Voice Gen: script text is empty");

      // Resolve the best voice id: prefer the default ModelVoice row, fall
      // back to the legacy elevenLabsVoiceId on SavedModel.
      let voiceId = null;
      const defaultVoice = await prisma.modelVoice.findFirst({
        where: { modelId: model.id, isDefault: true },
      });
      voiceId = defaultVoice?.elevenLabsVoiceId || model.elevenLabsVoiceId;
      if (!voiceId) throw new Error("Voice Gen: model has no voice configured");

      const cost = estimateVoiceAudioCredits(script.length, false);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Generating voice audio…" });
      const audioBuffer = await textToSpeech(script, voiceId, {
        modelId: VOICE_TTS_MODEL_ID,
        stability: nodeData.stability ?? 0.5,
        similarityBoost: nodeData.similarityBoost ?? 0.75,
        style: nodeData.style ?? 0.0,
      });
      onProgress?.({ message: "Uploading audio…" });
      const { url } = await uploadAudioToR2(audioBuffer);
      return { output: url, outputType: "audio", creditsUsed: cost };
    },
  },

  "sfx-gen": {
    label: "Sound Effect",
    category: "audio",
    color: "#f472b6",
    description: "Generate a sound effect or ambient audio from a description",
    inputs: [{ id: "text", type: "text", label: "Prompt" }],
    outputs: [{ id: "audio", type: "audio", label: "Audio" }],
    defaultData: { durationSeconds: 5 },
    creditCost: 12,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const prompt = (inputs.text || nodeData.prompt || "").trim();
      if (!prompt) throw new Error("SFX: prompt required");
      const cost = 12;
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) throw new Error("SFX: ELEVENLABS_API_KEY not set");

      onProgress?.({ message: "Generating sound effect…" });
      const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: prompt,
          duration_seconds: Math.min(22, Math.max(0.5, Number(nodeData.durationSeconds) || 5)),
          prompt_influence: 0.3,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`SFX: ElevenLabs error ${res.status}: ${errText.slice(0, 200)}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const { uploadAudioToR2 } = await import("./elevenlabs.service.js");
      const { url } = await uploadAudioToR2(buf);
      return { output: url, outputType: "audio", creditsUsed: cost };
    },
  },

  // ── NSFW NODES ────────────────────────────────────────────────────────────

  "nsfw-gen": {
    label: "NSFW Generation",
    category: "nsfw",
    color: "#f87171",
    description: "Generate NSFW images using your LoRA model",
    inputs: [
      { id: "model", type: "model", label: "Model" },
      { id: "text", type: "text", label: "Prompt" },
    ],
    outputs: [{ id: "image", type: "image", label: "Image" }],
    defaultData: { quantity: 1, resolution: "portrait-1" },
    creditCost: 30,
    execute: async (inputs, nodeData, userId, onProgress) => {
      const model = inputs.model;
      if (!model) throw new Error("NSFW Gen: model required");
      const prompt = inputs.text || nodeData.prompt || "";
      if (!prompt) throw new Error("NSFW Gen: prompt required");
      const pricing = await getGenerationPricing();
      const cost = Number(pricing.imagePromptNsfw ?? 30);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);

      onProgress?.({ message: "Submitting NSFW generationâ€¦" });
      const { generateNsfwImage } = await import("../controllers/nsfw.controller.js").catch(() => ({}));
      // Create generation and submit via NSFW controller internals
      const { submitNsfwGeneration } = await import("./modelcloneX.service.js").catch(() => ({ submitNsfwGeneration: null }));
      const gen = await prisma.generation.create({
        data: { userId, modelId: model.id, type: "nsfw", status: "processing", prompt, creditsCost: cost, replicateModel: "comfyui-nsfw", isNsfw: true },
      });
      onProgress?.({ message: "Waiting for NSFW resultâ€¦" });
      const outputUrl = await pollGeneration(gen.id, onProgress);
      return { output: outputUrl, outputType: "image", creditsUsed: cost };
    },
  },

  "nsfw-video": {
    label: "NSFW Video",
    category: "nsfw",
    color: "#f87171",
    description: "Generate NSFW video from image",
    inputs: [
      { id: "image", type: "image", label: "Input Image" },
      { id: "model", type: "model", label: "Model" },
    ],
    outputs: [{ id: "video", type: "video", label: "Video" }],
    defaultData: { duration: 5 },
    creditCost: 80,
    execute: async (inputs, nodeData, userId, onProgress) => {
      if (!inputs.image) throw new Error("NSFW Video: input image required");
      const model = inputs.model;
      const cost = 80;
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);
      const gen = await prisma.generation.create({
        data: { userId, modelId: model?.id, type: "nsfw-video", status: "processing", prompt: "nsfw-video", creditsCost: cost, replicateModel: "nsfw-video", isNsfw: true },
      });
      onProgress?.({ message: "Waiting for NSFW videoâ€¦" });
      const outputUrl = await pollGeneration(gen.id, onProgress);
      return { output: outputUrl, outputType: "video", creditsUsed: cost };
    },
  },

  "nsfw-video-extend": {
    label: "NSFW Extend Video",
    category: "nsfw",
    color: "#f87171",
    description: "Extend an NSFW video",
    inputs: [
      { id: "video", type: "video", label: "Video" },
      { id: "model", type: "model", label: "Model" },
    ],
    outputs: [{ id: "video", type: "video", label: "Extended Video" }],
    defaultData: { duration: 5 },
    creditCost: 50,
    execute: async (inputs, nodeData, userId, onProgress) => {
      if (!inputs.video) throw new Error("NSFW Extend: video required");
      const cost = nodeData.duration === 8 ? 80 : 50;
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);
      const gen = await prisma.generation.create({
        data: { userId, type: "nsfw-video-extend", status: "processing", prompt: "extend", creditsCost: cost, replicateModel: "nsfw-video-extend", isNsfw: true },
      });
      onProgress?.({ message: "Waiting for extended videoâ€¦" });
      const outputUrl = await pollGeneration(gen.id, onProgress);
      return { output: outputUrl, outputType: "video", creditsUsed: cost };
    },
  },

  "nsfw-motion": {
    label: "NSFW Motion Control",
    category: "nsfw",
    color: "#f87171",
    description: "NSFW video with motion control reference",
    inputs: [
      { id: "image", type: "image", label: "Source Image" },
      { id: "video", type: "video", label: "Motion Reference" },
      { id: "model", type: "model", label: "Model" },
    ],
    outputs: [{ id: "video", type: "video", label: "Video" }],
    defaultData: { duration: 5 },
    creditCost: 90,
    execute: async (inputs, nodeData, userId, onProgress) => {
      if (!inputs.image || !inputs.video) throw new Error("NSFW Motion: image and motion reference required");
      const pricing = await getGenerationPricing();
      const cost = Math.ceil(Number(pricing.motionXPerSec ?? 6.5) * 5);
      const user = await checkAndExpireCredits(userId);
      if (getTotalCredits(user) < cost) throw new Error(`Not enough credits (need ${cost})`);
      await deductCredits(userId, cost);
      const gen = await prisma.generation.create({
        data: { userId, type: "nsfw-video", status: "processing", prompt: "nsfw-motion", creditsCost: cost, replicateModel: "nsfw-motion", isNsfw: true },
      });
      onProgress?.({ message: "Waiting for NSFW motion videoâ€¦" });
      const outputUrl = await pollGeneration(gen.id, onProgress);
      return { output: outputUrl, outputType: "video", creditsUsed: cost };
    },
  },

  // â”€â”€ OUTPUT NODES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  "output-viewer": {
    label: "Output",
    category: "outputs",
    color: "#34d399",
    description: "Display and download the final result",
    inputs: [{ id: "any", type: "any", label: "Result" }],
    outputs: [],
    defaultData: { saveToHistory: true },
    creditCost: 0,
    execute: async (inputs, nodeData, userId) => {
      const value = inputs.any || inputs.image || inputs.video || inputs.text;
      return { output: value, outputType: typeof value === "string" && value.match(/\.(mp4|webm|mov)/i) ? "video" : "image" };
    },
  },

  "merge-outputs": {
    label: "Merge",
    category: "utility",
    color: "#94a3b8",
    description: "Combine multiple outputs into an array",
    inputs: [
      { id: "input1", type: "any", label: "Input 1" },
      { id: "input2", type: "any", label: "Input 2" },
      { id: "input3", type: "any", label: "Input 3" },
    ],
    outputs: [{ id: "array", type: "any", label: "Array" }],
    defaultData: {},
    creditCost: 0,
    execute: async (inputs) => {
      const values = [inputs.input1, inputs.input2, inputs.input3].filter(Boolean);
      return { output: values, outputType: "array" };
    },
  },

  // Visual-only container for the canvas. The execution engine treats it as
  // a pure pass-through so flows containing groups serialize and run cleanly.
  "group": {
    label: "Group",
    category: "utility",
    color: "#a78bfa",
    description: "Visual container — has no runtime effect",
    inputs: [],
    outputs: [],
    defaultData: { label: "Group" },
    creditCost: 0,
    hidden: true, // not shown in the palette
    execute: async () => ({ output: null, outputType: null }),
  },
};

// ---------------------------------------------------------------------------
// Category metadata for UI grouping
// ---------------------------------------------------------------------------
export const NODE_CATEGORIES = {
  inputs:  { label: "Inputs",        color: "#60a5fa" },
  images:  { label: "Image Gen",     color: "#a78bfa" },
  video:   { label: "Video Gen",     color: "#f59e0b" },
  audio:   { label: "Audio / Voice", color: "#f472b6" },
  nsfw:    { label: "NSFW Studio",   color: "#f87171" },
  outputs: { label: "Outputs",       color: "#34d399" },
  utility: { label: "Utility",       color: "#94a3b8" },
};

// ---------------------------------------------------------------------------
// Credit estimator â€” sums costs of all nodes in a flow
// ---------------------------------------------------------------------------
export function estimateFlowCredits(nodes = []) {
  return nodes.reduce((total, node) => {
    const def = NODE_REGISTRY[node.type];
    return total + (def?.creditCost || 0);
  }, 0);
}
