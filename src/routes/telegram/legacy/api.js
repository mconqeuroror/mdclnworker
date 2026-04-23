import jwt from "jsonwebtoken";
import prisma from "../../../lib/prisma.js";
import { API_BASE } from "./config.js";

// ── Auth token (10 min, cached) ───────────────────────────────
const tokenCache = new Map(); // userId → { token, expiresAt }

async function getToken(userId) {
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 90_000) return cached.token;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw new Error("User not found.");
  if (!process.env.JWT_SECRET) throw new Error("JWT secret missing.");
  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "10m" });
  tokenCache.set(userId, { token, expiresAt: Date.now() + 10 * 60 * 1000 });
  return token;
}

async function call(userId, path, method = "GET", body) {
  const token = await getToken(userId);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { res, data };
}

function ok(res, data, field) {
  if (!res.ok || data?.success === false) return { ok: false, message: data?.message || data?.error || `API error (${res.status})` };
  return { ok: true, ...(field ? { [field]: data[field] } : data) };
}

// ── Generate ──────────────────────────────────────────────────
export async function apiPromptVideo(userId, imageUrl, prompt, duration = 5) {
  const { res, data } = await call(userId, "/api/generate/video-prompt", "POST", { imageUrl, prompt, duration });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiPromptImage(userId, modelId, prompt, opts = {}) {
  const useNsfw = Boolean(opts.useNsfw);
  const contentRating =
    opts.contentRating != null && String(opts.contentRating).trim() !== ""
      ? opts.contentRating
      : useNsfw
        ? "sexy"
        : "pg13";
  const { res, data } = await call(userId, "/api/generate/prompt-image", "POST", {
    modelId,
    prompt,
    quantity: opts.quantity ?? 1,
    style: opts.style || "amateur",
    contentRating,
    useNsfw,
    useCustomPrompt: Boolean(opts.useCustomPrompt),
  });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiImageIdentity(userId, body) {
  const { res, data } = await call(userId, "/api/generate/image-identity", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation || data.generations, creditsUsed: data.creditsUsed };
}

export async function apiAdvancedImage(userId, modelId, prompt, engine = "nano-banana", referencePhotos = []) {
  const { res, data } = await call(userId, "/api/generate/advanced", "POST", { modelId, engine, prompt, referencePhotos });
  if (!res.ok || !data?.success) return { ok: false, message: data?.error || data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiTalkingHead(userId, imageUrl, voiceId, text, prompt = "") {
  const { res, data } = await call(userId, "/api/generate/talking-head", "POST", { imageUrl, voiceId, text, prompt: prompt || undefined });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiVideoDirectly(userId, payload) {
  const { res, data } = await call(userId, "/api/generate/video-directly", "POST", payload);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiFaceSwapVideo(userId, sourceVideoUrl, modelId, videoDuration) {
  const body = { sourceVideoUrl, modelId };
  const n = Number(videoDuration);
  if (Number.isFinite(n) && n > 0) body.videoDuration = Math.ceil(n);
  const { res, data } = await call(userId, "/api/generate/face-swap", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiFaceSwapImage(userId, sourceImageUrl, targetImageUrl) {
  const { res, data } = await call(userId, "/api/generate/image-faceswap", "POST", { sourceImageUrl, targetImageUrl });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiDescribeTarget(userId, targetImageUrl, modelName = "", clothesMode = "") {
  const body = { targetImageUrl, modelName };
  if (clothesMode === "reference") body.clothesMode = "reference";
  const { res, data } = await call(userId, "/api/generate/describe-target", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, description: data.description || data.text || data.prompt || "" };
}

export async function apiEnhancePrompt(userId, prompt, mode = "casual") {
  const { res, data } = await call(userId, "/api/generate/enhance-prompt", "POST", { prompt, mode });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, enhancedPrompt: data.enhancedPrompt || data.prompt || "", creditsUsed: data.creditsUsed };
}

export async function apiExtractFrames(userId, referenceVideoUrl) {
  const { res, data } = await call(userId, "/api/generate/extract-frames", "POST", { referenceVideoUrl });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, frames: data.frames || [], videoDuration: data.videoDuration };
}

export async function apiVideoMotion(userId, payload) {
  const { res, data } = await call(userId, "/api/generate/video-motion", "POST", payload);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiPrepareVideo(userId, payload) {
  const { res, data } = await call(userId, "/api/generate/prepare-video", "POST", payload);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, variations: data.variations || [], selectedFrame: data.selectedFrame, creditsUsed: data.creditsUsed };
}

export async function apiCompleteVideo(userId, payload) {
  const { res, data } = await call(userId, "/api/generate/complete-video", "POST", payload);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiCompleteRecreation(userId, payload) {
  const { res, data } = await call(userId, "/api/generate/complete-recreation", "POST", payload);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generations: data.generations, creditsUsed: data.creditsUsed };
}

export async function apiCreatorStudioImage(userId, body) {
  const { res, data } = await call(userId, "/api/generate/creator-studio", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation || data.generations, creditsUsed: data.creditsUsed };
}

export async function apiCreatorStudioVideo(userId, body) {
  const { res, data } = await call(userId, "/api/generate/creator-studio/video", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiAnalyzeLooks(userId, imageUrls) {
  const { res, data } = await call(userId, "/api/generate/analyze-looks", "POST", { imageUrls });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, looks: data.looks || data.savedAppearance || {} };
}

export async function apiMonthlyStats(userId) {
  const { res, data } = await call(userId, "/api/generations/monthly-stats", "GET");
  if (!res.ok) return { ok: false, images: 0, videos: 0 };
  return { ok: true, images: Number(data?.images) || 0, videos: Number(data?.videos) || 0 };
}

export async function apiDeleteGenerations(userId, generationIds) {
  const { res, data } = await call(userId, "/api/generations/batch-delete", "POST", { generationIds });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, deletedCount: Number(data?.deletedCount || 0) };
}

// ── NSFW ──────────────────────────────────────────────────────
export async function apiNsfwImage(userId, modelId, prompt, numberOfImages = 1) {
  const { res, data } = await call(userId, "/api/nsfw/generate", "POST", { modelId, prompt, quantity: numberOfImages });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generations: data.generations || [], creditsUsed: data.creditsUsed };
}

export async function apiNsfwVideo(userId, modelId, imageUrl, prompt = "", duration = 5) {
  const { res, data } = await call(userId, "/api/nsfw/generate-video", "POST", { modelId, imageUrl, prompt, duration });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generationId: data.generationId, creditsUsed: data.creditsUsed };
}

export async function apiNsfwExtendVideo(userId, generationId, duration = 5, prompt = "") {
  const { res, data } = await call(userId, "/api/nsfw/extend-video", "POST", { generationId, duration: duration === 8 ? 8 : 5, prompt: prompt || undefined });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generationId: data.generationId, creditsUsed: data.creditsUsed, extendDuration: data.extendDuration };
}

export async function apiNsfwAdvanced(userId, modelId, prompt, engine = "nano-banana") {
  // Controller reads `model` not `engine`
  const { res, data } = await call(userId, "/api/nsfw/generate-advanced", "POST", { modelId, prompt, model: engine });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  const generations =
    Array.isArray(data.generations) && data.generations.length > 0
      ? data.generations
      : data.generation
        ? [data.generation]
        : [];
  return { ok: true, generations, creditsUsed: data.creditsUsed };
}

export async function apiNsfwNudesPack(userId, modelId, poses = []) {
  const { res, data } = await call(userId, "/api/nsfw/nudes-pack", "POST", { modelId, poses });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return {
    ok: true,
    generations: data.generations || [],
    creditsUsed: data.creditsUsed,
    poseCount: data.poseCount,
    creditsPerImage: data.creditsPerImage,
  };
}

export async function apiNsfwGeneratePrompt(userId, modelId) {
  const { res, data } = await call(userId, "/api/nsfw/generate-prompt", "POST", { modelId });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, prompt: data.prompt || "", creditsUsed: data.creditsUsed };
}

export async function apiNsfwPlanGeneration(userId, modelId, userRequest) {
  const { res, data } = await call(userId, "/api/nsfw/plan-generation", "POST", { modelId, userRequest });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, jobId: data.jobId || null };
}

export async function apiNsfwPlanStatus(userId, jobId) {
  const { res, data } = await call(userId, `/api/nsfw/plan-generation/status/${encodeURIComponent(jobId)}`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, status: data?.status, plan: data?.plan, prompts: data?.prompts };
}

export async function apiNsfwAutoSelect(userId, modelId, description) {
  const { res, data } = await call(userId, "/api/nsfw/auto-select", "POST", { modelId, description });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, jobId: data.jobId || null };
}

export async function apiNsfwAutoSelectStatus(userId, jobId) {
  const { res, data } = await call(userId, `/api/nsfw/auto-select/status/${encodeURIComponent(jobId)}`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, status: data?.status, selections: data?.selections };
}

export async function apiNsfwTestFaceRef(userId, modelId, prompt) {
  const { res, data } = await call(userId, "/api/nsfw/test-face-ref", "POST", { modelId, prompt });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, jobId: data.requestId || null };
}

export async function apiNsfwTestFaceRefStatus(userId, requestId) {
  const { res, data } = await call(userId, `/api/nsfw/test-face-ref-status/${encodeURIComponent(requestId)}`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return {
    ok: true,
    status: String(data?.status || "").toLowerCase(),
    imageUrl: data?.outputUrl || data?.imageUrl || null,
  };
}

export async function apiNsfwStartTraining(userId, modelId) {
  const { res, data } = await call(userId, "/api/nsfw/start-training-session", "POST", { modelId });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, creditsUsed: data.creditsUsed, message: data.message };
}

export async function apiNsfwInitTraining(userId, modelId) {
  const { res, data } = await call(userId, "/api/nsfw/initialize-training", "POST", { modelId });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, loraId: data.loraId };
}

export async function apiNsfwTrainingStatus(userId, modelId) {
  const { res, data } = await call(userId, `/api/nsfw/training-status/${encodeURIComponent(modelId)}`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, status: data?.status, loraStatus: data?.loraStatus, loraUrl: data?.loraUrl };
}

export async function apiNsfwRegisterTrainingImage(userId, modelId, loraId, imageUrl) {
  const { res, data } = await call(userId, "/api/nsfw/register-training-images", "POST", { modelId, loraId, imageUrls: [imageUrl] });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

export async function apiNsfwTrainLora(userId, modelId, loraId = null) {
  const body = { modelId };
  if (loraId) body.loraId = loraId;
  const { res, data } = await call(userId, "/api/nsfw/train-lora", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, creditsUsed: data.creditsUsed, triggerWord: data.triggerWord };
}

// ── Tools ─────────────────────────────────────────────────────
export async function apiUpscaleStatus(userId, generationId) {
  const { res, data } = await call(userId, `/api/upscale/status/${encodeURIComponent(generationId)}`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, status: data?.status, imageUrl: data?.imageUrl, error: data?.error };
}

export async function apiSubmitUpscale(userId, imageBuffer, mimeType, fileName) {
  const token = await getToken(userId);
  const form = new FormData();
  form.set("image", new Blob([imageBuffer], { type: mimeType }), fileName);
  const res = await fetch(`${API_BASE}/api/upscale`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.success) {
    const msg = data?.error || data?.message || `Failed (${res.status})`;
    return { ok: false, message: msg };
  }
  return { ok: true, generationId: data.generationId, creditsUsed: data.creditsUsed };
}

export async function apiSubmitReformatter(userId, inputUrl, originalFileName = "upload") {
  const { res, data } = await call(userId, "/api/reformatter/convert-with-worker", "POST", {
    inputUrl,
    originalFileName,
  });
  if (!res.ok || !data?.success) {
    return { ok: false, message: data?.message || data?.error || `Failed (${res.status})` };
  }
  return { ok: true, jobId: data.jobId };
}

export async function apiReformatterStatus(userId, jobId) {
  const { res, data } = await call(userId, `/api/reformatter/status/${encodeURIComponent(jobId)}`, "GET");
  if (!res.ok || !data?.success) {
    return { ok: false, message: data?.message || `Failed (${res.status})` };
  }
  const job = data.job || {};
  return {
    ok: true,
    status: job.status,
    outputUrl: job.outputUrl,
    error: job.errorMessage,
  };
}

export async function apiSubmitRepurposer(userId, videoUrl, watermarkUrl = null, settings = null) {
  const body = {
    videoUrl,
    ...(watermarkUrl ? { watermarkUrl } : {}),
    ...(settings && typeof settings === "object" ? { settings } : {}),
  };
  const { res, data } = await call(userId, "/api/video-repurpose/generate-with-worker", "POST", body);
  if (!res.ok || !data?.ok) {
    return { ok: false, message: data?.error || `Failed (${res.status})` };
  }
  return { ok: true, jobId: data.job_id, outputs: Array.isArray(data.outputs) ? data.outputs : [] };
}

export async function apiRepurposerStatus(userId, jobId) {
  const { res, data } = await call(userId, `/api/video-repurpose/jobs/${encodeURIComponent(jobId)}`, "GET");
  if (!res.ok) return { ok: false, message: data?.error || `Failed (${res.status})` };
  const job = data?.job;
  return {
    ok: true,
    status: job?.status,
    outputs: job?.outputs,
    message: job?.message,
    error: job?.error,
  };
}

// ── Voices ────────────────────────────────────────────────────
export async function apiVoices(userId, modelId = "") {
  const q = modelId ? `?modelId=${encodeURIComponent(String(modelId))}` : "";
  const { res, data } = await call(userId, `/api/voices${q}`, "GET");
  if (!res.ok) return { ok: false, voices: [] };
  return { ok: true, voices: Array.isArray(data?.voices) ? data.voices : Array.isArray(data) ? data : [] };
}

export async function apiGenerateVoiceAudio(userId, modelId, voiceId, script) {
  const { res, data } = await call(userId, `/api/models/${encodeURIComponent(modelId)}/voices/generate-audio`, "POST", { voiceId, script });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, url: data.url };
}

export async function apiCloneVoice(userId, modelId, audioBuffer, fileName, mimeType) {
  const token = await getToken(userId);
  const form = new FormData();
  form.set("audio", new Blob([audioBuffer], { type: mimeType || "audio/mpeg" }), fileName || "voice.mp3");
  const res = await fetch(`${API_BASE}/api/models/${encodeURIComponent(modelId)}/voices/clone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, voiceId: data.voiceId, url: data.url };
}

// ── Models ────────────────────────────────────────────────────
export async function apiCreateModel(userId, name, photo1Url, photo2Url, photo3Url, savedAppearance = null) {
  const body = { name, photo1Url, photo2Url, photo3Url };
  if (savedAppearance) body.savedAppearance = savedAppearance;
  const { res, data } = await call(userId, "/api/models", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, model: data.model };
}

export async function apiUpdateModel(userId, modelId, updates) {
  const { res, data } = await call(userId, `/api/models/${encodeURIComponent(modelId)}`, "PUT", updates);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, model: data.model };
}

export async function apiDeleteModel(userId, modelId) {
  const { res, data } = await call(userId, `/api/models/${encodeURIComponent(modelId)}`, "DELETE");
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

// ── Account / auth ────────────────────────────────────────────
export async function api2FAStatus(userId) {
  const { res, data } = await call(userId, "/api/auth/2fa/status", "GET");
  if (!res.ok) return { ok: false, enabled: false };
  return { ok: true, enabled: Boolean(data?.enabled) };
}

export async function apiApiKeySummaries(userId) {
  const { res, data } = await call(userId, "/api/user/api-keys", "GET");
  if (!res.ok) return { ok: false, keys: [] };
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  return { ok: true, keys: keys.map((k) => ({ id: k.id, prefix: k.prefix || String(k.id).slice(0, 8), createdAt: k.createdAt })) };
}

export async function apiUpdateProfile(userId, updates) {
  const { res, data } = await call(userId, "/api/auth/profile", "PUT", updates);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

export async function apiCreateCheckout(userId, creditAmount) {
  const { res, data } = await call(userId, "/api/stripe/create-checkout", "POST", { creditAmount });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || data?.error || `Failed (${res.status})` };
  return { ok: true, url: data.url };
}

// ── MCX ───────────────────────────────────────────────────────
export async function apiMcxGenerate(userId, payload) {
  const { res, data } = await call(userId, "/api/modelclone-x/generate", "POST", payload);
  if (!res.ok || !data?.success) return { ok: false, message: data?.error || data?.message || `Failed (${res.status})` };
  return { ok: true, generationIds: data.generationIds || [], creditsUsed: data.creditsUsed };
}

export async function apiMcxStatus(userId, generationId) {
  const { res, data } = await call(userId, `/api/modelclone-x/status/${generationId}`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, status: data?.status, imageUrl: data?.imageUrl, error: data?.error };
}

export async function apiMcxConfig(userId) {
  const { res, data } = await call(userId, "/api/modelclone-x/config", "GET");
  if (!res.ok) return { ok: false, pricing: {}, limits: {} };
  return { ok: true, pricing: data.pricing || {}, limits: data.limits || {} };
}

export async function apiMcxGetCharacters(userId, modelId) {
  const { res, data } = await call(userId, `/api/modelclone-x/characters/${encodeURIComponent(modelId)}`, "GET");
  if (!res.ok) return { ok: false, characters: [] };
  return { ok: true, characters: data.characters || [] };
}

export async function apiMcxCreateCharacter(userId, modelId, name, trainingMode = "standard") {
  const { res, data } = await call(userId, "/api/modelclone-x/character/create", "POST", { modelId, name, trainingMode });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, lora: data.lora };
}

export async function apiMcxRegisterTrainingImage(userId, modelId, loraId, imageUrl) {
  const { res, data } = await call(userId, "/api/nsfw/register-training-images", "POST", { modelId, loraId, imageUrls: [imageUrl] });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

export async function apiMcxStartTraining(userId, loraId, modelId, trainingMode = "standard") {
  const { res, data } = await call(userId, "/api/modelclone-x/character/train", "POST", { loraId, modelId, trainingMode });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, creditsUsed: data.creditsUsed, triggerWord: data.triggerWord };
}

export async function apiMcxTrainingStatus(userId, loraId) {
  const { res, data } = await call(userId, `/api/modelclone-x/character/training-status/${encodeURIComponent(loraId)}`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, lora: data.lora };
}

export async function apiMcxDeleteCharacter(userId, loraId) {
  const { res, data } = await call(userId, `/api/modelclone-x/character/${encodeURIComponent(loraId)}`, "DELETE");
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

// ── NSFW LoRA management ──────────────────────────────────────
export async function apiNsfwGetLoras(userId, modelId) {
  const { res, data } = await call(userId, `/api/nsfw/loras/${encodeURIComponent(modelId)}`, "GET");
  if (!res.ok) return { ok: false, loras: [] };
  return { ok: true, loras: Array.isArray(data?.loras) ? data.loras : [] };
}

export async function apiNsfwSetActiveLora(userId, modelId, loraId) {
  const { res, data } = await call(userId, "/api/nsfw/lora/set-active", "POST", { modelId, loraId });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

export async function apiNsfwDeleteLora(userId, loraId) {
  const { res, data } = await call(userId, `/api/nsfw/lora/${encodeURIComponent(loraId)}`, "DELETE");
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

export async function apiNsfwAutoAppearance(userId, loraId) {
  const { res, data } = await call(userId, `/api/nsfw/lora/${encodeURIComponent(loraId)}/auto-appearance`, "POST");
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, appearance: data.appearance || {} };
}

export async function apiNsfwGetAppearance(userId, modelId) {
  const { res, data } = await call(userId, `/api/nsfw/appearance/${encodeURIComponent(modelId)}`, "GET");
  if (!res.ok) return { ok: false, appearance: null };
  return { ok: true, appearance: data?.appearance || data?.savedAppearance || null };
}

export async function apiNsfwSaveAppearance(userId, modelId, appearance) {
  const { res, data } = await call(userId, "/api/nsfw/appearance/save", "POST", { modelId, appearance });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

// ── Voice management ──────────────────────────────────────────
export async function apiVoicePreview(userId, voiceId) {
  const { res, data } = await call(userId, `/api/voices/${encodeURIComponent(voiceId)}/preview`, "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, url: data?.url || data?.previewUrl || null };
}

export async function apiDeleteVoice(userId, modelId, voiceId) {
  const { res, data } = await call(userId, `/api/models/${encodeURIComponent(modelId)}/voices/${encodeURIComponent(voiceId)}`, "DELETE");
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

export async function apiVoiceDesignPreviews(userId, modelId, voiceDescription) {
  // Server expects: { voiceDescription } — the text description of the voice character
  const { res, data } = await call(userId, `/api/models/${encodeURIComponent(modelId)}/voices/design-previews`, "POST", { voiceDescription });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, previews: data.previews || [], creditsUsed: data.creditsUsed };
}

export async function apiVoiceDesignConfirm(userId, modelId, generatedVoiceId, voiceDescription) {
  // Server expects: { generatedVoiceId, voiceDescription, consentConfirmed }
  const { res, data } = await call(userId, `/api/models/${encodeURIComponent(modelId)}/voices/design-confirm`, "POST", {
    generatedVoiceId,
    voiceDescription,
    consentConfirmed: true,
  });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, voice: data.voice };
}

export async function apiModelVoiceList(userId, modelId) {
  const { res, data } = await call(userId, `/api/models/${encodeURIComponent(modelId)}/voices`, "GET");
  if (!res.ok) return { ok: false, voices: [] };
  const raw = data?.voices || data?.modelVoices || data;
  return { ok: true, voices: Array.isArray(raw) ? raw : [] };
}

// ── Creator Studio upgrades ───────────────────────────────────
export async function apiCsExtendVideo(userId, body) {
  const { res, data } = await call(userId, "/api/generate/creator-studio/video/extend", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, generation: data.generation, creditsUsed: data.creditsUsed };
}

export async function apiCsVideo4K(userId, taskId, index = 0) {
  const { res, data } = await call(userId, "/api/generate/creator-studio/video/4k", "POST", { taskId, index });
  if (!res.ok || !data?.success) return { ok: false, message: data?.msg || data?.message || `Failed (${res.status})` };
  return { ok: true, data: data.data };
}

export async function apiCsVideo1080p(userId, taskId, index = 0) {
  const { res, data } = await call(userId, `/api/generate/creator-studio/video/1080p?taskId=${encodeURIComponent(taskId)}&index=${index}`, "GET");
  if (!res.ok || !data?.success) return { ok: false, message: data?.msg || data?.message || `Failed (${res.status})` };
  return { ok: true, data: data.data };
}

// ── Creator Studio Assets ─────────────────────────────────────
export async function apiCsAssetsList(userId) {
  const { res, data } = await call(userId, "/api/generate/creator-studio/assets", "GET");
  if (!res.ok) return { ok: false, assets: [] };
  return { ok: true, assets: data?.assets || [] };
}

export async function apiCsCreateAsset(userId, url, name, assetType = "Image") {
  const { res, data } = await call(userId, "/api/generate/creator-studio/assets", "POST", { url, name, assetType });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, asset: data.asset };
}

export async function apiCsDeleteAsset(userId, assetId) {
  const { res, data } = await call(userId, `/api/generate/creator-studio/assets/${encodeURIComponent(assetId)}`, "DELETE");
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

// ── Models: Generate AI ───────────────────────────────────────
export async function apiGenerateAiModel(userId, body) {
  const { res, data } = await call(userId, "/api/models/generate-ai", "POST", body);
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, model: data.model, creditsUsed: data.creditsUsed };
}

// ── Account: profile + email change ──────────────────────────
export async function apiGetProfile(userId) {
  const { res, data } = await call(userId, "/api/auth/profile", "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, profile: data?.user || data };
}

export async function apiRequestEmailChange(userId, newEmail) {
  const { res, data } = await call(userId, "/api/auth/change-email/request", "POST", { newEmail });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

export async function apiVerifyEmailChange(userId, code) {
  const { res, data } = await call(userId, "/api/auth/change-email/verify", "POST", { code });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

// ── Referral ──────────────────────────────────────────────────
export async function apiReferralOverview(userId) {
  const { res, data } = await call(userId, "/api/referrals/me/overview", "GET");
  if (!res.ok) return { ok: false, message: `Failed (${res.status})` };
  return { ok: true, overview: data };
}

export async function apiReferralSetCode(userId, code) {
  const { res, data } = await call(userId, "/api/referrals/me/code", "POST", { code });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true, code: data.code };
}

export async function apiReferralRequestPayout(userId, amount) {
  const { res, data } = await call(userId, "/api/referrals/me/request-payout", "POST", { amount });
  if (!res.ok || !data?.success) return { ok: false, message: data?.message || `Failed (${res.status})` };
  return { ok: true };
}

// ── NSFW poses list (for nudes pack) ─────────────────────────
export async function apiNsfwGetPoses(userId) {
  const { res, data } = await call(userId, "/api/nsfw/nudes-pack-poses", "GET");
  if (!res.ok) return { ok: false, poses: [] };
  return { ok: true, poses: data?.poses || [] };
}
