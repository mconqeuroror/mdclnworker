import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow, persistNow } from "./state.js";

// After setFlow at critical "user sent media, bot now shows inline buttons" transitions,
// immediately persist to DB so the flow survives a Vercel cold-start on the next request.
async function setFlowNow(chatId, data) {
  setFlow(chatId, data);
  await persistNow(String(chatId)).catch(() => {});
}

function flowExpiredKbd() {
  return inlineKbd([[{ text: "🔄 Start over", callback_data: "nav:generate" }]]);
}
import { send, sendImg, sendMedia, inlineKbd, isHttpUrl, formatDate, toJsonObj, pickUrl } from "./helpers.js";
import { resolveImage, resolveVideo } from "./media.js";
import { cancelKbd, generateMenuKbd, generationResultKbd, durationKbd5_10, modelPickerKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import {
  apiPromptVideo, apiPromptImage, apiImageIdentity, apiAdvancedImage, apiTalkingHead, apiVideoDirectly,
  apiFaceSwapVideo, apiFaceSwapImage, apiDescribeTarget, apiEnhancePrompt, apiExtractFrames,
  apiVideoMotion, apiPrepareVideo, apiCompleteVideo, apiCompleteRecreation,
  apiCreatorStudioImage, apiCreatorStudioVideo, apiDeleteGenerations, apiVoices,
  apiCsAssetsList, apiCsCreateAsset, apiCsDeleteAsset,
} from "./api.js";
import { RETRYABLE_TYPES } from "./config.js";

const PAGE_SIZE = 8;

// ── CS Image helpers ──────────────────────────────────────────
const CSIMG_ENGINES = [
  { id: "nano-banana-pro",   label: "🍌 nano-banana",     needsImg: false, note: "uses model photos" },
  { id: "flux-kontext-pro",  label: "⚡ Flux Kontext Pro", needsImg: true,  note: "edit/remix" },
  { id: "flux-kontext-max",  label: "⚡ Flux Kontext Max", needsImg: true,  note: "edit/remix hi-q" },
  { id: "wan-2-7-image",     label: "🌊 WAN 2.7 Image",    needsImg: false, note: "fast gen" },
  { id: "wan-2-7-image-pro", label: "🌊 WAN 2.7 Image Pro",needsImg: false, note: "pro quality" },
  { id: "ideogram-v3-text",  label: "💬 Ideogram v3 Text", needsImg: false, note: "text-to-image" },
  { id: "ideogram-v3-remix", label: "🔀 Ideogram v3 Remix",needsImg: true,  note: "remix with input" },
  { id: "seedream-v4-5-edit",label: "🌸 Seedream 4.5 Edit",needsImg: true,  note: "style/edit" },
];

async function renderCsimgEngineMenu(chatId) {
  const rows = [];
  for (let i = 0; i < CSIMG_ENGINES.length; i += 2) {
    const pair = [{ text: CSIMG_ENGINES[i].label, callback_data: `gen:csimg:eng:${CSIMG_ENGINES[i].id}` }];
    if (CSIMG_ENGINES[i + 1]) pair.push({ text: CSIMG_ENGINES[i + 1].label, callback_data: `gen:csimg:eng:${CSIMG_ENGINES[i + 1].id}` });
    rows.push(pair);
  }
  rows.push([{ text: "⬅️ Back", callback_data: "nav:generate" }]);
  await send(chatId, "🎨 Creator Studio — Image\n\nSelect engine:\n(ideogram-v3-edit requires mask → use Mini App)", inlineKbd(rows));
}

async function renderCsimgAspectPicker(chatId) {
  const f = getFlow(chatId);
  const ARS = [["1:1","9:16","16:9"],["3:4","4:3","4:5","5:4"]];
  const rows = ARS.map((row) => row.map((ar) => ({ text: ar, callback_data: `gen:csimg:aspect:${ar.replace(":", "_")}` })));
  rows.push([{ text: "⬅️ Back", callback_data: "gen:csimg" }]);
  await send(chatId, "Choose aspect ratio:", inlineKbd(rows));
}

async function startCsimgFlow(chatId, engineId, modelId = null) {
  const eng = CSIMG_ENGINES.find((e) => e.id === engineId) || CSIMG_ENGINES[0];
  setFlow(chatId, { step: eng.needsImg ? "gen_csimg_img" : "gen_csimg_aspect", engine: engineId, modelId });
  if (engineId.startsWith("ideogram")) {
    // Ideogram needs rendering speed first
    setFlow(chatId, { step: "gen_csimg_speed", engine: engineId, modelId });
    await send(chatId, `${eng.label}\n\nRendering speed (affects credits):`, inlineKbd([
      [{ text: "⚡ Turbo (fastest, cheapest)", callback_data: "gen:csimg:speed:turbo" }],
      [{ text: "⚖️ Balanced (default)", callback_data: "gen:csimg:speed:balanced" }],
      [{ text: "💎 Quality (best, most cr)", callback_data: "gen:csimg:speed:quality" }],
      [{ text: "⬅️ Back", callback_data: "gen:csimg" }],
    ]));
    return;
  }
  if (eng.needsImg) {
    await send(chatId, `${eng.label}\n\nSend reference / input image:`, { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true });
  } else {
    await renderCsimgAspectPicker(chatId);
  }
}

// ── CS Video helpers ──────────────────────────────────────────
const CSVID_FAMILIES = [
  { id: "wan27",     label: "🌊 WAN 2.7",    modes: ["t2v","i2v","replace","edit"],  note: "2–15s, 720p/1080p" },
  { id: "wan26",     label: "🌊 WAN 2.6",    modes: ["t2v","i2v"],                   note: "5/10/15s, 720p/1080p" },
  { id: "wan22",     label: "🌀 WAN 2.2",    modes: ["move","replace"],              note: "5s, animate video" },
  { id: "kling30",   label: "🎬 Kling 3.0",  modes: ["t2v","i2v"],                   note: "3–15s, std/pro" },
  { id: "kling26",   label: "🎬 Kling 2.6",  modes: ["t2v","i2v"],                   note: "5 or 10s" },
  { id: "seedance2", label: "🌱 Seedance 2",  modes: ["t2v","i2v","edit","multi-ref"],note: "4–15s, multimodal" },
  { id: "veo31",     label: "🔍 VEO 3.1",    modes: ["t2v","i2v","ref2v","extend"],  note: "8s, Google VEO 3" },
  { id: "sora2",     label: "🌀 Sora 2",     modes: ["t2v","i2v"],                   note: "10/15 frames" },
];

const CSVID_MODE_LABELS = { t2v:"Text→Video", i2v:"Image→Video", edit:"First+Last", "multi-ref":"Multi-Ref", move:"Animate", replace:"Replace", ref2v:"Reference→Video", extend:"Extend" };

async function renderCsvidFamilyMenu(chatId) {
  const rows = [];
  for (let i = 0; i < CSVID_FAMILIES.length; i += 2) {
    const pair = [{ text: CSVID_FAMILIES[i].label, callback_data: `gen:csvid:fam:${CSVID_FAMILIES[i].id}` }];
    if (CSVID_FAMILIES[i + 1]) pair.push({ text: CSVID_FAMILIES[i + 1].label, callback_data: `gen:csvid:fam:${CSVID_FAMILIES[i + 1].id}` });
    rows.push(pair);
  }
  rows.push([{ text: "⬅️ Back", callback_data: "nav:generate" }]);
  await send(chatId, "🎬 Creator Studio — Video\n\nSelect engine:", inlineKbd(rows));
}

async function renderCsvidModeMenu(chatId, family) {
  const fam = CSVID_FAMILIES.find((f) => f.id === family);
  if (!fam) { await renderCsvidFamilyMenu(chatId); return; }
  setFlow(chatId, { step: "gen_csvid_mode", family });
  const rows = fam.modes.map((m) => [{ text: `${CSVID_MODE_LABELS[m] || m}`, callback_data: `gen:csvid:mode:${family}:${m}` }]);
  rows.push([{ text: "⬅️ Back", callback_data: "gen:csvid" }]);
  await send(chatId, `${fam.label} (${fam.note})\n\nSelect mode:`, inlineKbd(rows));
}

async function renderCsvidArPicker(chatId, arList, title) {
  const rows = arList.map((ar) => [{ text: ar.replace("_", ":"), callback_data: `gen:csvid:ar:${ar}` }]);
  await send(chatId, title, inlineKbd(rows));
}

async function startCsvidFlow(chatId, family, mode) {
  setFlow(chatId, { step: "gen_csvid_inputs", family, mode, aspectRatio: "16:9", durationSeconds: 8, wanResolution: "720p" });
  const needsImage = ["i2v", "ref2v", "edit"].includes(mode) || (family === "wan22" && mode === "move");
  const needsVideo = ["edit"].includes(mode) || (family === "wan22") || (family === "wan27" && mode === "edit");

  if (needsVideo && family === "wan22") {
    // WAN 2.2 only supports 5s — set fixed duration upfront
    setFlow(chatId, { step: "gen_csvid_vidref", family, mode, durationSeconds: 5 });
    await send(chatId, `🌀 WAN 2.2 ${mode === "replace" ? "Replace" : "Animate"}\n\nStep 1: Upload the input video:`, cancelKbd());
  } else if (needsVideo && family === "wan27" && mode === "edit") {
    setFlow(chatId, { step: "gen_csvid_vidref", family, mode });
    await send(chatId, `🌊 WAN 2.7 Edit\n\nUpload the input video to edit:`, cancelKbd());
  } else if (mode === "edit" && family === "seedance2") {
    setFlow(chatId, { step: "gen_csvid_seedance_first", family, mode });
    await send(chatId, `🌱 Seedance First+Last\n\nStep 1: Upload FIRST frame image:`, cancelKbd());
  } else if (mode === "multi-ref" && family === "seedance2") {
    setFlow(chatId, { step: "gen_csvid_img", family, mode });
    await send(chatId, `🌱 Seedance Multi-Ref\n\nUpload reference image (or skip):`, { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true });
  } else if (needsImage) {
    setFlow(chatId, { step: "gen_csvid_img", family, mode });
    await send(chatId, `Upload the ${mode === "ref2v" ? "reference" : "start-frame"} image:`, cancelKbd());
  } else if (family === "sora2") {
    // Sora needs "portrait" or "landscape" — NOT the generic AR picker which uses ":"→"_" conversion
    setFlow(chatId, { step: "gen_csvid_sora_ar", family, mode });
    await send(chatId, "Sora: Choose aspect ratio:", inlineKbd([
      [{ text: "📱 Portrait (9:16)", callback_data: "gen:csvid:sora:ar:portrait" }],
      [{ text: "🖥 Landscape (16:9)", callback_data: "gen:csvid:sora:ar:landscape" }],
    ]));
  } else if (family === "kling30") {
    setFlow(chatId, { step: "gen_csvid_kling30_ar", family, mode });
    await renderCsvidArPicker(chatId, ["16_9", "9_16", "1_1"], "Kling 3.0: Aspect ratio:");
  } else if (family === "kling26") {
    setFlow(chatId, { step: "gen_csvid_kling26_ar", family, mode });
    await renderCsvidArPicker(chatId, ["16_9", "9_16", "1_1"], "Kling 2.6: Aspect ratio:");
  } else if (family === "veo31") {
    setFlow(chatId, { step: "gen_csvid_veo_speed", family, mode });
    await send(chatId, "VEO 3.1: Choose speed:", inlineKbd([
      [{ text: "⚡ Fast", callback_data: "gen:csvid:veo:speed:fast" }, { text: "💎 Quality", callback_data: "gen:csvid:veo:speed:quality" }, { text: "🪶 Lite", callback_data: "gen:csvid:veo:speed:lite" }],
    ]));
  } else if (family === "wan27") {
    setFlow(chatId, { step: "gen_csvid_ar", family, mode });
    await renderCsvidArPicker(chatId, ["16_9", "9_16", "1_1", "4_3", "3_4"], "WAN 2.7 aspect ratio:");
  } else if (family === "wan26") {
    setFlow(chatId, { step: "gen_csvid_res", family, mode });
    await send(chatId, "WAN 2.6: Resolution:", inlineKbd([[{ text: "720p", callback_data: "gen:csvid:res:720p" }, { text: "1080p", callback_data: "gen:csvid:res:1080p" }]]));
  } else {
    setFlow(chatId, { step: "gen_csvid_prompt", family, mode });
    await send(chatId, "Enter your prompt:", cancelKbd());
  }
}

async function continueCsvidAfterDuration(chatId, prevFlow) {
  const f = getFlow(chatId) || prevFlow;
  const family = f.family;
  // After duration, go to prompt
  setFlow(chatId, { ...f, step: "gen_csvid_prompt" });
  await send(chatId, `Duration: ${f.durationSeconds}s\n\nEnter your prompt:`, cancelKbd());
}

// Dispatch to next CS Video step after image is collected
async function dispatchCsvidNextStep(chatId, f) {
  const step = f.step;
  if (step === "gen_csvid_sora_ar") {
    await send(chatId, "Sora: Choose aspect ratio:", inlineKbd([
      [{ text: "📱 Portrait (9:16)", callback_data: "gen:csvid:sora:ar:portrait" }],
      [{ text: "🖥 Landscape (16:9)", callback_data: "gen:csvid:sora:ar:landscape" }],
    ]));
  } else if (step === "gen_csvid_sora_size") {
    await send(chatId, "Sora: Choose quality:", inlineKbd([
      [{ text: "Standard", callback_data: "gen:csvid:sorasize:standard" }, { text: "High", callback_data: "gen:csvid:sorasize:high" }],
    ]));
  } else if (step === "gen_csvid_kling30_q") {
    await send(chatId, "Kling 3.0: Quality:", inlineKbd([
      [{ text: "Standard", callback_data: "gen:csvid:kq:std" }, { text: "Pro", callback_data: "gen:csvid:kq:pro" }],
    ]));
  } else if (step === "gen_csvid_kling26_dur") {
    await send(chatId, "Kling 2.6: Duration:", inlineKbd([
      [{ text: "5s", callback_data: "gen:csvid:dur:5" }, { text: "10s", callback_data: "gen:csvid:dur:10" }],
    ]));
  } else if (step === "gen_csvid_veo_speed") {
    await send(chatId, "VEO 3.1: Speed:", inlineKbd([
      [{ text: "⚡ Fast", callback_data: "gen:csvid:veo:speed:fast" }, { text: "💎 Quality", callback_data: "gen:csvid:veo:speed:quality" }, { text: "🪶 Lite", callback_data: "gen:csvid:veo:speed:lite" }],
    ]));
  } else if (step === "gen_csvid_res") {
    await send(chatId, "WAN 2.6: Resolution:", inlineKbd([[{ text: "720p", callback_data: "gen:csvid:res:720p" }, { text: "1080p", callback_data: "gen:csvid:res:1080p" }]]));
  } else if (step === "gen_csvid_wan26_dur") {
    await send(chatId, "WAN 2.6: Duration:", inlineKbd([
      [{ text: "5s", callback_data: "gen:csvid:dur:5" }, { text: "10s", callback_data: "gen:csvid:dur:10" }, { text: "15s", callback_data: "gen:csvid:dur:15" }],
    ]));
  } else if (step === "gen_csvid_ar") {
    await renderCsvidArPicker(chatId, ["16_9", "9_16", "1_1", "4_3", "3_4"], "WAN 2.7: Aspect ratio:");
  } else if (step === "gen_csvid_sdt") {
    await send(chatId, "Seedance task type:", inlineKbd([
      [{ text: "Seedance 2", callback_data: "gen:csvid:sdt:seedance-2" }, { text: "Seedance 2 Fast", callback_data: "gen:csvid:sdt:seedance-2-fast" }],
    ]));
  } else if (step === "gen_csvid_prompt") {
    await send(chatId, "Enter your prompt:", cancelKbd());
  }
}

export async function renderGenerateMenu(chatId, preselectedModelId = null) {
  if (preselectedModelId) {
    setFlow(chatId, { modelId: preselectedModelId });
  }
  await send(chatId, "🎬 Generate — Choose type:", generateMenuKbd());
}

// ── Shared: send generation result ───────────────────────────
// When completed: sends the actual image/video. When processing: shows clean status.
export async function sendGenerationResult(chatId, genId, status, outputUrl, type, creditsUsed, fromPage = 0) {
  const kbd = generationResultKbd(genId, status, outputUrl, type, fromPage);
  const typeLabel = String(type || "Generation").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const creditNote = creditsUsed != null ? ` · ${creditsUsed} cr` : "";

  if (status === "completed" && outputUrl && isHttpUrl(outputUrl)) {
    // Send the actual media file — image or video
    const sent = await sendMedia(chatId, outputUrl, type, {
      caption: `✅ ${typeLabel}${creditNote}`,
      replyMarkup: inlineKbd([
        [{ text: "🔄 Generate again", callback_data: "nav:generate" }, { text: "🕘 History", callback_data: "nav:history" }],
      ]),
    });
    if (sent) return; // media sent successfully
    // Fallback: media send failed — show text with link button
    await send(chatId, `✅ ${typeLabel} complete!${creditNote}`, inlineKbd([
      [{ text: "📥 View output", url: outputUrl }],
      [{ text: "🔄 Generate again", callback_data: "nav:generate" }, { text: "🕘 History", callback_data: "nav:history" }],
    ]));
    return;
  }

  if (status === "failed") {
    const canRetry = RETRYABLE_TYPES.has(String(type || "").toLowerCase());
    await send(chatId, `❌ ${typeLabel} failed.`, inlineKbd([
      ...(canRetry ? [[{ text: "♻️ Retry", callback_data: `gen:retry:${genId}:${fromPage}` }]] : []),
      [{ text: "🕘 History", callback_data: "nav:history" }],
    ]));
    return;
  }

  // Processing / pending
  await send(chatId, `⏳ ${typeLabel} is generating…${creditNote}\n\nTap Refresh to check status.`, inlineKbd([
    [{ text: "🔄 Refresh", callback_data: `gen:refresh:${genId}:${fromPage}` }],
    [{ text: "🕘 History", callback_data: "nav:history" }],
  ]));
}

// ── Shared: refresh generation status ─────────────────────────
export async function refreshGeneration(chatId, userId, genId, fromPage = 0) {
  const gen = await prisma.generation.findFirst({
    where: { id: genId, userId },
    select: { id: true, type: true, status: true, outputUrl: true, creditsCost: true, errorMessage: true, createdAt: true, completedAt: true, prompt: true },
  });
  if (!gen) { await send(chatId, "Generation not found.", inlineKbd([[{ text: "🕘 History", callback_data: "nav:history" }]])); return; }
  // Delegate to sendGenerationResult which handles media sending + clean UX
  await sendGenerationResult(chatId, gen.id, gen.status, gen.outputUrl, gen.type, gen.creditsCost, fromPage);
}

// ── Shared: retry generation ──────────────────────────────────
export async function retryGeneration(chatId, userId, genId, fromPage = 0) {
  const gen = await prisma.generation.findFirst({
    where: { id: genId, userId },
    select: { id: true, type: true, modelId: true, inputImageUrl: true, inputVideoUrl: true, prompt: true, duration: true, providerFamily: true, providerMode: true, providerRequest: true, pipelinePayload: true, replicateModel: true },
  });
  if (!gen) { await send(chatId, "Generation not found."); return; }
  if (!RETRYABLE_TYPES.has(gen.type)) { await send(chatId, `Retry not available for type "${gen.type}".`, inlineKbd([[{ text: "⬅️ History", callback_data: `nav:history` }]])); return; }

  const prompt = String(gen.prompt || "").trim();
  const duration = Number(gen.duration) > 0 ? Number(gen.duration) : 5;
  const inputMeta = toJsonObj(gen.inputImageUrl);
  const reqPayload = toJsonObj(gen.providerRequest);
  let retry = { ok: false, message: "Unsupported retry." };

  await send(chatId, "⏳ Retrying...", null);

  const type = String(gen.type).toLowerCase();
  if (type === "prompt-video") {
    const img = pickUrl(gen.inputImageUrl); if (!img) { await send(chatId, "Cannot retry: original image missing."); return; }
    retry = await apiPromptVideo(userId, img, prompt, [5, 10].includes(duration) ? duration : 5);
  } else if (type === "video") {
    const img = pickUrl(gen.inputImageUrl); const vid = pickUrl(gen.inputVideoUrl);
    if (img && vid) retry = await apiVideoMotion(userId, { generatedImageUrl: img, referenceVideoUrl: vid, videoDuration: duration > 0 ? duration : 5, keepAudio: true, recreateEngine: "kling", ultraMode: false, modelId: gen.modelId || undefined });
    else if (img && prompt) retry = await apiPromptVideo(userId, img, prompt, [5, 10].includes(duration) ? duration : 5);
    else { await send(chatId, "Cannot retry: original source media missing."); return; }
  } else if (type === "prompt-image") {
    if (!gen.modelId) { await send(chatId, "Cannot retry: original model missing."); return; }
    retry = await apiPromptImage(userId, gen.modelId, prompt, { quantity: 1 });
  } else if (type === "advanced-image") {
    if (!gen.modelId) { await send(chatId, "Cannot retry: original model missing."); return; }
    const engine = String(gen.replicateModel || "").toLowerCase().includes("seedream") ? "seedream" : "nano-banana";
    retry = await apiAdvancedImage(userId, gen.modelId, prompt, engine, []);
  } else if (type === "image-identity") {
    const target = pickUrl(inputMeta?.image4SourceToEdit, inputMeta?.targetImage, inputMeta?.videoScreenshot, gen.inputImageUrl);
    if (!gen.modelId || !target) { await send(chatId, "Cannot retry: original model/target missing."); return; }
    retry = await apiImageIdentity(userId, { modelId: gen.modelId, targetImage: target, aspectRatio: "9:16", quantity: 1 });
  } else if (type === "talking-head") {
    const img = pickUrl(inputMeta?.imageUrl, gen.inputImageUrl); const voiceId = String(inputMeta?.voiceId || "");
    if (!img || !voiceId) { await send(chatId, "Cannot retry: original image/voice missing."); return; }
    retry = await apiTalkingHead(userId, img, voiceId, prompt, "");
  } else if (type === "face-swap") {
    const vid = pickUrl(inputMeta?.sourceVideoUrl, gen.inputVideoUrl); const modelId = String(inputMeta?.modelId || gen.modelId || "");
    if (!vid || !modelId) { await send(chatId, "Cannot retry: original video/model missing."); return; }
    retry = await apiFaceSwapVideo(userId, vid, modelId, Number(gen.duration) || 10);
  } else if (type === "face-swap-image") {
    const src = pickUrl(inputMeta?.sourceImageUrl); const tgt = pickUrl(inputMeta?.targetImageUrl);
    if (!src || !tgt) { await send(chatId, "Cannot retry: original images missing."); return; }
    retry = await apiFaceSwapImage(userId, src, tgt);
  } else if (type === "creator-studio") {
    const pp = toJsonObj(gen.pipelinePayload);
    if (!prompt) { await send(chatId, "Cannot retry: original prompt missing."); return; }
    retry = await apiCreatorStudioImage(userId, { prompt, generationModel: pp.generationModel || gen.providerMode || "nano-banana", aspectRatio: pp.aspectRatio || "1:1", numImages: 1, inputImageUrl: pickUrl(pp.inputImageUrl, gen.inputImageUrl) });
  } else if (type === "creator-studio-video") {
    if (!prompt) { await send(chatId, "Cannot retry: original prompt missing."); return; }
    retry = await apiCreatorStudioVideo(userId, { family: String(reqPayload.family || gen.providerFamily || "wan22"), mode: String(reqPayload.mode || gen.providerMode || "i2v"), prompt, imageUrl: pickUrl(reqPayload.imageUrl, gen.inputImageUrl), durationSeconds: Number(reqPayload.durationSeconds || gen.duration || 5) });
  }

  if (!retry.ok) { await send(chatId, `❌ Retry failed: ${retry.message}`, inlineKbd([[{ text: "⬅️ History", callback_data: "nav:history" }]])); return; }
  const newId = retry.generation?.id || retry.generationId || "unknown";
  await send(chatId, `✅ Retry started.\nNew ID: ${newId}`, inlineKbd([
    ...(newId !== "unknown" ? [[{ text: "🔄 Check status", callback_data: `gen:refresh:${newId}:${fromPage}` }]] : []),
    [{ text: "🕘 History", callback_data: "nav:history" }],
  ]));
}

// ── Message handler ───────────────────────────────────────────
export async function handleGenerateMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("gen_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await send(chatId, "Cancelled.", inlineKbd([[{ text: "🎬 Generate", callback_data: "nav:generate" }]])); return true; }

  // ── AI Photo ─────────────────────────────────────────────────
  if (flow.step === "gen_aiphoto_prompt") {
    if (t.length < 2) { await send(chatId, "Describe the scene (2+ characters):", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, prompt: t });
    await send(chatId, `Prompt: "${t.slice(0, 100)}"\n\nEnhance this prompt with AI? (1 credit)`, inlineKbd([
      [{ text: "✨ Yes, enhance", callback_data: "gen:aiphoto:enhance:yes" }, { text: "Use as-is", callback_data: "gen:aiphoto:enhance:no" }],
    ]));
    return true;
  }

  // ── AI Video ─────────────────────────────────────────────────
  if (flow.step === "gen_aivideo_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the start-frame image as a photo or image file:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_aivideo_prompt", imageUrl: url });
    await send(chatId, "✅ Image received. Now enter your prompt:", cancelKbd()); return true;
  }
  if (flow.step === "gen_aivideo_prompt") {
    if (t.length < 2) { await send(chatId, "Enter a prompt:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_aivideo_dur", prompt: t });
    await send(chatId, "Choose video duration:", durationKbd5_10("gen:aivideo:dur")); return true;
  }

  // ── Identity recreation ───────────────────────────────────────
  if (flow.step === "gen_identity_target") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the target image (the scene to recreate) as a photo or image file:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_identity_outfit", targetImageUrl: url });
    await send(chatId, "✅ Target received. Choose outfit mode:", inlineKbd([
      [{ text: "Keep Model's Outfit", callback_data: "gen:identity:outfit:model" }],
      [{ text: "Keep Source Outfit", callback_data: "gen:identity:outfit:source" }],
    ]));
    return true;
  }

  // ── Face Swap Video ───────────────────────────────────────────
  if (flow.step === "gen_faceswapvid_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, "Send the source video as a video message or video file:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_faceswapvid_dur", videoUrl: url });
    await send(chatId, "✅ Video received.\n\nHow long is the video? (face-swap cost = 10 credits/sec):", inlineKbd([
      [{ text: "5s — 50 cr", callback_data: "gen:faceswapvid:dur:5" }, { text: "10s — 100 cr", callback_data: "gen:faceswapvid:dur:10" }],
      [{ text: "30s — 300 cr", callback_data: "gen:faceswapvid:dur:30" }, { text: "60s — 600 cr", callback_data: "gen:faceswapvid:dur:60" }],
      [{ text: "Cancel", callback_data: "nav:generate" }],
    ]));
    return true;
  }

  // ── Image Face Swap ───────────────────────────────────────────
  if (flow.step === "gen_faceswapimg_source") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send your source face image (photo or file):", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_faceswapimg_target", sourceImageUrl: url });
    await send(chatId, "✅ Source face received. Now send the target image (the face will be swapped into this):", cancelKbd()); return true;
  }
  if (flow.step === "gen_faceswapimg_target") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the target image as a photo or image file:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting image face swap...", null);
    const r = await apiFaceSwapImage(userId, flow.sourceImageUrl, url);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "face-swap-image", r.creditsUsed);
    return true;
  }

  // ── Talking Head ──────────────────────────────────────────────
  if (flow.step === "gen_th_image") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send a portrait image (face clearly visible) as a photo or file:", cancelKbd()); return true; }
    const voices = await apiVoices(userId, flow.modelId);
    if (!voices.ok || !voices.voices.length) { await send(chatId, "No voices found for this model. Clone a voice first.", inlineKbd([[{ text: "🎤 Voice Studio", callback_data: "nav:voice" }]])); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_th_voice", imageUrl: url });
    const rows = voices.voices.map((v) => [{ text: v.name || v.id, callback_data: `gen:th:voice:${v.id}` }]);
    rows.push([{ text: "Cancel", callback_data: "nav:home" }]);
    await send(chatId, "✅ Image received. Select a voice:", inlineKbd(rows)); return true;
  }
  if (flow.step === "gen_th_script") {
    if (t.length < 3) { await send(chatId, "Enter the script (what the avatar will say, 3+ chars):", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating talking head video...", null);
    const r = await apiTalkingHead(userId, flow.imageUrl, flow.voiceId, t, "");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "talking-head", r.creditsUsed);
    return true;
  }

  // ── Motion Transfer ───────────────────────────────────────────
  if (flow.step === "gen_motion_image") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the identity / start-frame image as a photo or file:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_motion_video", imageUrl: url });
    await send(chatId, "✅ Image received. Now send the reference motion video:", cancelKbd()); return true;
  }
  if (flow.step === "gen_motion_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, "Send the reference motion video as a video message or file:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_motion_duration", referenceVideoUrl: url });
    await send(chatId, "Enter the clip length in whole seconds (1–120). This must match the video you uploaded:", cancelKbd()); return true;
  }
  if (flow.step === "gen_motion_duration") {
    const sec = Number.parseInt(t, 10);
    if (!Number.isFinite(sec) || sec < 1 || sec > 120) { await send(chatId, "Enter a whole number from 1 to 120:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting motion transfer...", null);
    const r = await apiVideoMotion(userId, { modelId: flow.modelId || undefined, generatedImageUrl: flow.imageUrl, referenceVideoUrl: flow.referenceVideoUrl, videoDuration: sec, keepAudio: true, recreateEngine: "kling", ultraMode: false });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "video", r.creditsUsed);
    return true;
  }

  // ── Creator Studio Image ──────────────────────────────────────
  if (flow.step === "gen_csimg_img") {
    const skip = t.toLowerCase() === "skip";
    const url = skip ? null : await resolveImage(message).catch(() => null);
    const eng = CSIMG_ENGINES.find((e) => e.id === flow.engine);
    if (!url && !skip && eng?.needsImg) {
      await send(chatId, `Send the reference image (or tap Skip):`, { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true });
      return true;
    }
    setFlow(chatId, { ...flow, inputImageUrl: url || null, step: "gen_csimg_aspect" });
    await renderCsimgAspectPicker(chatId); return true;
  }
  if (flow.step === "gen_csimg_prompt") {
    if (t.length < 2) { await send(chatId, "Enter a prompt:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting Creator Studio image...", null);
    const body = {
      prompt: t,
      generationModel: flow.engine || "nano-banana-pro",
      aspectRatio: flow.aspectRatio || "1:1",
      resolution: flow.resolution || "1K",
      numImages: flow.numImages || 1,
      ...(flow.inputImageUrl ? { inputImageUrl: flow.inputImageUrl } : {}),
      ...(flow.renderingSpeed ? { renderingSpeed: flow.renderingSpeed.toUpperCase() } : {}),
    };
    // For nano-banana, add model reference photos if a model is selected
    if (flow.engine === "nano-banana-pro" && flow.modelId) {
      const model = await prisma.savedModel.findFirst({ where: { id: flow.modelId, userId }, select: { photo1Url: true, photo2Url: true, photo3Url: true } });
      if (model) {
        const refs = [model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean);
        if (refs.length) body.referencePhotos = refs;
      }
    }
    const r = await apiCreatorStudioImage(userId, body);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const gen = Array.isArray(r.generation) ? r.generation[0] : r.generation;
    await sendGenerationResult(chatId, gen?.id || "?", gen?.status || "processing", null, "creator-studio", r.creditsUsed);
    return true;
  }

  // ── Creator Studio Video ──────────────────────────────────────
  if (flow.step === "gen_csvid_img") {
    const skip = t.toLowerCase() === "skip";
    const url = skip ? null : await resolveImage(message).catch(() => null);
    const f = flow;
    const needsImg = ["i2v", "ref2v"].includes(f.mode) || (f.family === "seedance2" && f.mode === "multi-ref");
    if (!url && !skip && needsImg) { await send(chatId, "Send the image:", cancelKbd()); return true; }
    const nextStep = f.family === "sora2" ? "gen_csvid_sora_ar"
      : f.family === "kling30" ? "gen_csvid_kling30_q"
      : f.family === "kling26" ? "gen_csvid_kling26_dur"
      : f.family === "veo31" ? "gen_csvid_veo_speed"
      : f.family === "wan26" ? "gen_csvid_res"
      : f.family === "wan27" ? "gen_csvid_ar"
      : f.family === "seedance2" ? "gen_csvid_sdt"
      : "gen_csvid_prompt";
    setFlow(chatId, { ...f, imageUrl: url || null, step: nextStep });
    await send(chatId, url ? "✅ Image received." : "Continuing without image.", null);
    await dispatchCsvidNextStep(chatId, { ...f, imageUrl: url || null, step: nextStep });
    return true;
  }
  if (flow.step === "gen_csvid_vidref") {
    const { resolveVideo: rv } = await import("./media.js");
    const url = await rv(message).catch(() => null);
    if (!url) { await send(chatId, "Send the video as a video message or file:", cancelKbd()); return true; }
    const f = flow;
    if (f.family === "wan22") {
      setFlow(chatId, { ...f, inputVideoUrl: url, step: "gen_csvid_img" });
      await send(chatId, "✅ Video received.\n\nNow send the reference image (for motion transfer):", cancelKbd());
    } else {
      setFlow(chatId, { ...f, inputVideoUrl: url, step: "gen_csvid_prompt" });
      await send(chatId, "✅ Video received.\n\nEnter your prompt:", cancelKbd());
    }
    return true;
  }
  if (flow.step === "gen_csvid_seedance_first") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the first frame image:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, imageUrl: url, step: "gen_csvid_seedance_last" });
    await send(chatId, "✅ First frame received.\n\nNow send the LAST frame image:", cancelKbd()); return true;
  }
  if (flow.step === "gen_csvid_seedance_last") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the last frame image:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, endFrameUrl: url, step: "gen_csvid_sdt" });
    await send(chatId, "✅ Last frame received.\n\nSelect Seedance task type:", inlineKbd([
      [{ text: "Seedance 2 (standard)", callback_data: "gen:csvid:sdt:seedance-2" }],
      [{ text: "Seedance 2 Fast", callback_data: "gen:csvid:sdt:seedance-2-fast" }],
    ]));
    return true;
  }
  if (flow.step === "gen_csvid_dur_input") {
    const sec = Number.parseInt(t, 10);
    const limits = {
      wan27: { min: 2, max: flow.mode === "edit" || flow.mode === "replace" ? 10 : 15 },
      wan26: { values: [5, 10, 15] },
      kling30: { min: 3, max: 15 },
      kling26: { values: [5, 10] },
      seedance2: { min: 4, max: 15 },
      veo31: { values: [8] },
      sora2: { values: [8] },
      wan22: { values: [5] },
    };
    const lim = limits[flow.family] || { min: 2, max: 30 };
    let valid = true;
    if (lim.values && !lim.values.includes(sec)) valid = false;
    if (lim.min && (sec < lim.min || sec > lim.max)) valid = false;
    if (!Number.isFinite(sec) || !valid) {
      const msg = lim.values ? `Must be one of: ${lim.values.join(", ")}s` : `Must be ${lim.min}–${lim.max}s`;
      await send(chatId, `${msg}. Enter duration:`, cancelKbd()); return true;
    }
    setFlow(chatId, { ...flow, durationSeconds: sec, step: "gen_csvid_prompt" });
    await send(chatId, `Duration: ${sec}s\n\nEnter your prompt:`, cancelKbd()); return true;
  }
  if (flow.step === "gen_csvid_prompt") {
    if (t.length < 2 && flow.family !== "wan22") { await send(chatId, "Enter a prompt:", cancelKbd()); return true; }
    const f = getFlow(chatId);
    clearFlow(chatId);
    await send(chatId, "⏳ Starting Creator Studio video...", null);
    const payload = {
      family: f.family,
      mode: f.mode,
      prompt: t || f.prompt || "",
      imageUrl: f.imageUrl || null,
      referenceImageUrl: f.referenceImageUrl || null,
      endFrameUrl: f.endFrameUrl || null,
      inputVideoUrl: f.inputVideoUrl || null,
      durationSeconds: f.durationSeconds || 8,
      wanResolution: f.wanResolution || "720p",
      aspectRatio: f.aspectRatio || "16:9",
      kling30Quality: f.kling30Quality || "std",
      nFrames: f.nFrames || "10",
      size: f.size || "standard",
      speed: f.speed || "fast",
      seedanceTaskType: f.seedanceTaskType || "seedance-2",
    };
    const r = await apiCreatorStudioVideo(userId, payload);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "creator-studio-video", r.creditsUsed);
    return true;
  }

  // ── Quick Video ───────────────────────────────────────────────
  if (flow.step === "gen_quickvid_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the image (start frame) as a photo or file:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_quickvid_prompt", imageUrl: url });
    await send(chatId, "✅ Image received. Enter a prompt (or send Skip):", { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true }); return true;
  }
  if (flow.step === "gen_quickvid_prompt") {
    const prompt = t.toLowerCase() === "skip" ? "" : t;
    setFlow(chatId, { ...flow, step: "gen_quickvid_dur", prompt });
    await send(chatId, "Choose duration:", durationKbd5_10("gen:quickvid:dur")); return true;
  }

  // ── Full Recreation ───────────────────────────────────────────
  if (flow.step === "gen_fullrec_screenshot") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send a screenshot (frame from the target video) as a photo or image file:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_fullrec_video", screenshotUrl: url });
    await send(chatId, "✅ Screenshot received. Now send the reference video:", cancelKbd()); return true;
  }
  if (flow.step === "gen_fullrec_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, "Send the reference video as a video message or video file:", cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_fullrec_prompt", videoUrl: url });
    await send(chatId, "✅ Video received. Enter a prompt (describe the output), or skip:", { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true }); return true;
  }
  if (flow.step === "gen_fullrec_prompt") {
    const prompt = t.toLowerCase() === "skip" ? "" : t;
    setFlow(chatId, { ...flow, step: "gen_fullrec_dur", prompt });
    await send(chatId, "Choose video duration:", durationKbd5_10("gen:fullrec:dur")); return true;
  }

  // ── Frame Extractor ───────────────────────────────────────────
  if (flow.step === "gen_extract_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, "Send the reference video as a video message or file:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Extracting frames (free)...", null);
    const r = await apiExtractFrames(userId, url);
    if (!r.ok) { await send(chatId, `❌ Frame extraction failed: ${r.message}`); return true; }
    const frames = Array.isArray(r.frames) ? r.frames : [];
    await send(chatId, `✅ ${frames.length} frame(s) extracted.\n\nFrame previews sent below. Re-upload any of these into Motion Transfer, Pipeline Prep, or Quick Video.`, inlineKbd([
      [{ text: "🎞 Motion Transfer", callback_data: "gen:motion" }, { text: "🎞 Pipeline Prep", callback_data: "gen:pipeline" }],
      [{ text: "🎬 Generate more", callback_data: "nav:generate" }],
    ]));
    for (const f of frames.slice(0, 3)) {
      const u = f?.url || f?.imageUrl || "";
      if (isHttpUrl(u)) await sendImg(chatId, u, {}).catch(() => {});
    }
    return true;
  }

  // ── Pipeline Prep ─────────────────────────────────────────────
  if (flow.step === "gen_pipeline_frame") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the frame image as a photo or image file:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating 3 variations with your model's face...", null);
    const r = await apiPrepareVideo(userId, { modelId: flow.modelId, frameUrl: url });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const variations = r.variations || [];
    // Store variation URLs in flow; only pass index in callback_data to stay under 64 bytes
    setFlow(chatId, { step: "gen_pipeline_picked", modelId: flow.modelId, variations });
    const rows = variations.map((v, i) => [{ text: `Variation ${i + 1}`, callback_data: `gen:pipeline:pick:${i}` }]);
    rows.push([{ text: "Cancel", callback_data: "nav:home" }]);
    await send(chatId, "✅ 3 variations generated! Pick one to continue:", inlineKbd(rows));
    for (const v of variations) { if (isHttpUrl(v.imageUrl)) await sendImg(chatId, v.imageUrl, {}).catch(() => {}); }
    return true;
  }
  if (flow.step === "gen_pipeline_refvideo") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, "Send the reference motion video:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_pipeline_dur", referenceVideoUrl: url });
    await send(chatId, "Enter reference clip duration in seconds (1–120):", cancelKbd()); return true;
  }
  if (flow.step === "gen_pipeline_dur") {
    const sec = Number.parseInt(t, 10);
    if (!Number.isFinite(sec) || sec < 1 || sec > 120) { await send(chatId, "Enter a whole number from 1 to 120:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating final video...", null);
    const r = await apiCompleteVideo(userId, { modelId: flow.modelId, selectedImageUrl: flow.selectedImageUrl, referenceVideoUrl: flow.referenceVideoUrl, videoDuration: sec, prompt: flow.prompt || "", recreateEngine: "kling", useUltra: false });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "video", r.creditsUsed);
    return true;
  }

  // ── CS Asset create ───────────────────────────────────────────
  if (flow.step === "gen_assets_create_image" || flow.step === "gen_assets_create_video") {
    const isVideo = flow.step === "gen_assets_create_video";
    let url = null;
    if (isVideo) {
      const { resolveVideo: rv } = await import("./media.js");
      url = await rv(message).catch(() => null);
    } else {
      url = await resolveImage(message).catch(() => null);
    }
    if (!url || !isHttpUrl(url)) {
      await send(chatId, `Send the ${isVideo ? "video" : "image"} as an upload:`, cancelKbd());
      return true;
    }
    clearFlow(chatId);
    await send(chatId, "⏳ Creating asset...", null);
    const r = await apiCsCreateAsset(userId, url, `Asset ${Date.now()}`, isVideo ? "Video" : "Image");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, "✅ Asset created! It will be available for Seedance multi-ref mode.", inlineKbd([[{ text: "📎 My Assets", callback_data: "gen:assets" }]]));
    return true;
  }

  // ── Describe Target ───────────────────────────────────────────
  if (flow.step === "gen_describe_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send the target image as a photo or file:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Analyzing image...", null);
    const r = await apiDescribeTarget(userId, url, "", "");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `📝 Scene description:\n\n${r.description || "(empty)"}`, inlineKbd([
      [{ text: "🎬 Use this as prompt", callback_data: "nav:generate" }],
      [{ text: "🏠 Home", callback_data: "nav:home" }],
    ]));
    return true;
  }

  // ── Enhance Prompt ────────────────────────────────────────────
  if (flow.step === "gen_enhance_input") {
    if (t.length < 3) { await send(chatId, "Enter a prompt to enhance (3+ characters):", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_enhance_mode", rawPrompt: t });
    await send(chatId, "Choose enhancement mode:", inlineKbd([
      [{ text: "Casual", callback_data: "gen:enhance:mode:casual" }, { text: "Sexy", callback_data: "gen:enhance:mode:sexy" }],
      [{ text: "NSFW", callback_data: "gen:enhance:mode:nsfw" }, { text: "Ultra-Realism", callback_data: "gen:enhance:mode:ultra-realism" }],
    ]));
    return true;
  }

  // ── Advanced AI SFW ───────────────────────────────────────────
  if (flow.step === "gen_advanced_prompt") {
    if (t.length < 2) { await send(chatId, "Enter a prompt:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating advanced AI image...", null);
    const r = await apiAdvancedImage(userId, flow.modelId, t, flow.engine || "nano-banana", []);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "advanced-image", r.creditsUsed);
    return true;
  }

  return false;
}

// ── Callback handler ──────────────────────────────────────────
export async function handleGenerateCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const flow = getFlow(chatId);

  if (data === "nav:generate") { await renderGenerateMenu(chatId, flow?.modelId); return true; }

  if (data.startsWith("gen:refresh:")) {
    const [, , genId, page] = data.split(":");
    await refreshGeneration(chatId, userId, genId, Number(page) || 0); return true;
  }
  if (data.startsWith("gen:retry:")) {
    const [, , genId, page] = data.split(":");
    await retryGeneration(chatId, userId, genId, Number(page) || 0); return true;
  }

  // ── Pick model (shared) ───────────────────────────────────────
  async function pickModelAndContinue(prefix, nextStep, promptText) {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true, status: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No models yet. Create one first.", inlineKbd([[{ text: "🧬 Create Model", callback_data: "nav:models" }]])); return; }
    if (flow?.modelId) {
      // model already preselected
      setFlow(chatId, { ...flow, step: nextStep });
      await send(chatId, promptText, cancelKbd());
      return;
    }
    const rows = models.map((m) => [{ text: m.name, callback_data: `${prefix}:model:${m.id}` }]);
    rows.push([{ text: "Cancel", callback_data: "nav:generate" }]);
    await send(chatId, "Select a model:", inlineKbd(rows));
  }

  // ── AI Photo ─────────────────────────────────────────────────
  if (data === "gen:aiphoto") {
    await pickModelAndContinue("gen:aiphoto", "gen_aiphoto_prompt", "Enter your prompt:");
    return true;
  }
  if (data.startsWith("gen:aiphoto:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_aiphoto_prompt", modelId });
    await send(chatId, "Enter your prompt:", cancelKbd()); return true;
  }
  if (data === "gen:aiphoto:enhance:yes" || data === "gen:aiphoto:enhance:no") {
    const enhance = data.endsWith(":yes");
    const currentFlow = getFlow(chatId);
    if (!currentFlow?.prompt) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    if (enhance) {
      // Lock flow step to prevent double-submit during async enhance
      setFlow(chatId, { ...currentFlow, step: "gen_aiphoto_enhancing" });
      await send(chatId, "⏳ Enhancing prompt...", null);
      const r = await apiEnhancePrompt(userId, currentFlow.prompt, "sexy");
      if (r.ok) {
        setFlow(chatId, { ...currentFlow, step: "gen_aiphoto_prompt", prompt: r.enhancedPrompt });
        await send(chatId, `✨ Enhanced prompt:\n\n"${r.enhancedPrompt.slice(0, 300)}"\n\nSubmit?`, inlineKbd([
          [{ text: "✅ Submit", callback_data: "gen:aiphoto:submit" }, { text: "Use original", callback_data: "gen:aiphoto:enhance:no" }],
        ]));
        return true;
      }
      // Enhance failed — restore original step and fall through to direct submit
      setFlow(chatId, { ...currentFlow, step: "gen_aiphoto_prompt" });
    }
    // submit directly
    await send(chatId, "⏳ Generating AI Photo...", null);
    const f = getFlow(chatId);
    clearFlow(chatId);
    const r = await apiPromptImage(userId, f.modelId, f.prompt, { quantity: 1 });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "prompt-image", r.creditsUsed);
    return true;
  }
  if (data === "gen:aiphoto:submit") {
    const f = getFlow(chatId);
    if (!f) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating AI Photo...", null);
    const r = await apiPromptImage(userId, f.modelId, f.prompt, { quantity: 1 });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "prompt-image", r.creditsUsed);
    return true;
  }

  // ── AI Video ─────────────────────────────────────────────────
  if (data === "gen:aivideo") {
    
    await pickModelAndContinue("gen:aivideo", "gen_aivideo_img", "Upload the start-frame image:");
    return true;
  }
  if (data.startsWith("gen:aivideo:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_aivideo_img", modelId });
    await send(chatId, "Send the start-frame image as a photo or image file:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:aivideo:dur:")) {
    const dur = Number(data.split(":").pop());
    const f = getFlow(chatId);
    if (!f?.prompt || !f?.imageUrl) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting AI Video...", null);
    const r = await apiPromptVideo(userId, f.imageUrl, f.prompt, [5, 10].includes(dur) ? dur : 5);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "prompt-video", r.creditsUsed);
    return true;
  }

  // ── Identity Recreation ───────────────────────────────────────
  if (data === "gen:identity") {
    
    await pickModelAndContinue("gen:identity", "gen_identity_target", "Send the target image:");
    return true;
  }
  if (data.startsWith("gen:identity:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_identity_target", modelId });
    await send(chatId, "Send the target image (the scene to recreate with your model's face):", cancelKbd()); return true;
  }
  if (data.startsWith("gen:identity:outfit:")) {
    const mode = data.endsWith(":source") ? "reference" : "";
    const f = getFlow(chatId);
    if (!f?.targetImageUrl) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting identity recreation...", null);
    const r = await apiImageIdentity(userId, { modelId: f.modelId, targetImage: f.targetImageUrl, clothesMode: mode, aspectRatio: "9:16", quantity: 1 });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const gen = Array.isArray(r.generation) ? r.generation[0] : r.generation;
    await sendGenerationResult(chatId, gen?.id || "?", gen?.status || "processing", null, "image-identity", r.creditsUsed);
    return true;
  }

  // ── Face Swap Video ───────────────────────────────────────────
  if (data === "gen:faceswapvid") {
    
    await pickModelAndContinue("gen:faceswapvid", "gen_faceswapvid_video", "Send the source video:");
    return true;
  }
  if (data.startsWith("gen:faceswapvid:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_faceswapvid_video", modelId });
    await send(chatId, "Send the source video as a video message or file:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:faceswapvid:dur:")) {
    const dur = Number(data.split(":").pop());
    const f = getFlow(chatId);
    if (!f?.videoUrl) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting face swap...", null);
    const r = await apiFaceSwapVideo(userId, f.videoUrl, f.modelId, dur);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "face-swap", r.creditsUsed);
    return true;
  }

  // ── Image Face Swap ───────────────────────────────────────────
  if (data === "gen:faceswapimg") {
    setFlow(chatId, { step: "gen_faceswapimg_source" });
    await send(chatId, "🪞 Image Face Swap\n\nStep 1: Send your source face image (the face to use):", cancelKbd()); return true;
  }

  // ── Talking Head ──────────────────────────────────────────────
  if (data === "gen:talkinghead") {
    
    await pickModelAndContinue("gen:th", "gen_th_image", "Send a portrait image:");
    return true;
  }
  if (data.startsWith("gen:th:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_th_image", modelId });
    await send(chatId, "Send a portrait image (face clearly visible) as a photo or file:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:th:voice:")) {
    const voiceId = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, step: "gen_th_script", voiceId });
    await send(chatId, "✅ Voice selected. Enter the script (what the avatar will say):", cancelKbd()); return true;
  }

  // ── Motion Transfer ───────────────────────────────────────────
  if (data === "gen:motion") {
    setFlow(chatId, { ...(flow || {}), step: "gen_motion_image" });
    await send(chatId, "🎞 Motion Transfer\n\nSend the identity / start-frame image:", cancelKbd()); return true;
  }

  // ── Creator Studio Image ──────────────────────────────────────
  if (data === "gen:csimg") {
    await renderCsimgEngineMenu(chatId); return true;
  }
  if (data.startsWith("gen:csimg:eng:")) {
    const engine = data.split(":").slice(3).join(":");
    await startCsimgFlow(chatId, engine, getFlow(chatId)?.modelId || null);
    return true;
  }
  if (data.startsWith("gen:csimg:model:")) {
    const modelId = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, modelId });
    await renderCsimgEngineMenu(chatId); return true;
  }
  if (data.startsWith("gen:csimg:aspect:")) {
    const ar = data.split(":").slice(3).join(":").replace("_", ":");
    const f = getFlow(chatId); setFlow(chatId, { ...f, aspectRatio: ar, step: "gen_csimg_numres" });
    await send(chatId, `Aspect: ${ar}\n\nImages and resolution:`, inlineKbd([
      [{ text: "1 × 1K", callback_data: "gen:csimg:numres:1:1K" }, { text: "1 × 2K", callback_data: "gen:csimg:numres:1:2K" }, { text: "1 × 4K", callback_data: "gen:csimg:numres:1:4K" }],
      [{ text: "2 × 1K", callback_data: "gen:csimg:numres:2:1K" }, { text: "2 × 2K", callback_data: "gen:csimg:numres:2:2K" }],
      [{ text: "4 × 1K", callback_data: "gen:csimg:numres:4:1K" }],
      [{ text: "⬅️ Back", callback_data: "gen:csimg" }],
    ]));
    return true;
  }
  if (data.startsWith("gen:csimg:numres:")) {
    const parts = data.split(":");
    const numImages = Number(parts[3]) || 1; const resolution = parts[4] || "1K";
    const f = getFlow(chatId); setFlow(chatId, { ...f, numImages, resolution, step: "gen_csimg_prompt" });
    await send(chatId, `${numImages} image(s) × ${resolution}\n\nEnter your prompt:`, cancelKbd());
    return true;
  }
  // Ideogram-specific speed
  if (data.startsWith("gen:csimg:speed:")) {
    const speed = data.split(":").pop();
    const f = getFlow(chatId); setFlow(chatId, { ...f, renderingSpeed: speed.toUpperCase(), step: "gen_csimg_aspect" });
    await renderCsimgAspectPicker(chatId); return true;
  }

  // ── Creator Studio Video ──────────────────────────────────────
  if (data === "gen:csvid") {
    await renderCsvidFamilyMenu(chatId); return true;
  }
  if (data.startsWith("gen:csvid:fam:")) {
    const family = data.split(":").slice(3).join(":");
    await renderCsvidModeMenu(chatId, family); return true;
  }
  if (data.startsWith("gen:csvid:mode:")) {
    const parts = data.split(":");
    const family = parts[3]; const mode = parts[4];
    // VEO extend requires an existing generation's taskId — not available from fresh flow
    if (family === "veo31" && mode === "extend") {
      await send(chatId, "⏩ VEO Extend\n\nTo extend a completed VEO video, open its detail card in History and tap the Extend button.", inlineKbd([
        [{ text: "🕘 History", callback_data: "nav:history" }],
        [{ text: "⬅️ Back", callback_data: `gen:csvid:fam:${family}` }],
      ]));
      return true;
    }
    await startCsvidFlow(chatId, family, mode); return true;
  }
  // Family-specific param callbacks
  if (data.startsWith("gen:csvid:dur:")) {
    const parts = data.split(":");
    const dur = Number(parts[3]);
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, durationSeconds: dur });
    await continueCsvidAfterDuration(chatId, f); return true;
  }
  if (data.startsWith("gen:csvid:res:")) {
    const res = data.split(":").pop();
    const f = getFlow(chatId);
    // WAN 2.6 requires duration (5/10/15s) — must ask before prompt
    if (f?.family === "wan26") {
      setFlow(chatId, { ...f, wanResolution: res, step: "gen_csvid_wan26_dur" });
      await send(chatId, `Resolution: ${res}\n\nChoose duration:`, inlineKbd([
        [{ text: "5s", callback_data: "gen:csvid:dur:5" }, { text: "10s", callback_data: "gen:csvid:dur:10" }, { text: "15s", callback_data: "gen:csvid:dur:15" }],
      ]));
      return true;
    }
    setFlow(chatId, { ...f, wanResolution: res, step: "gen_csvid_prompt" });
    await send(chatId, `Resolution: ${res}\n\nEnter your prompt:`, cancelKbd()); return true;
  }
  if (data.startsWith("gen:csvid:ar:")) {
    const ar = data.split(":").slice(3).join(":").replace("_", ":");
    const f = getFlow(chatId);
    // Kling 2.6 t2v: duration must be asked (5 or 10s); do NOT jump to prompt yet
    if (f?.family === "kling26") {
      setFlow(chatId, { ...f, aspectRatio: ar, step: "gen_csvid_kling26_dur" });
      await send(chatId, `Aspect: ${ar}\n\nChoose duration:`, inlineKbd([
        [{ text: "5s", callback_data: "gen:csvid:dur:5" }, { text: "10s", callback_data: "gen:csvid:dur:10" }],
      ]));
      return true;
    }
    setFlow(chatId, { ...f, aspectRatio: ar, step: "gen_csvid_prompt" });
    await send(chatId, `Aspect: ${ar}\n\nEnter your prompt:`, cancelKbd()); return true;
  }
  if (data.startsWith("gen:csvid:kq:")) {
    const q = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, kling30Quality: q, step: "gen_csvid_dur_input" });
    await send(chatId, `Quality: ${q}\n\nEnter duration (3–15 seconds):`, cancelKbd()); return true;
  }
  // ── Sora dedicated AR (must be "portrait" or "landscape") ────
  if (data.startsWith("gen:csvid:sora:ar:")) {
    const ar = data.split(":").pop(); // "portrait" or "landscape"
    const f = getFlow(chatId);
    setFlow(chatId, { ...(f || {}), aspectRatio: ar, step: "gen_csvid_sora_size" });
    await send(chatId, `Aspect: ${ar}\n\nChoose quality:`, inlineKbd([
      [{ text: "Standard", callback_data: "gen:csvid:sorasize:standard" }, { text: "High", callback_data: "gen:csvid:sorasize:high" }],
    ]));
    return true;
  }
  if (data.startsWith("gen:csvid:soraframes:")) {
    const nf = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, nFrames: nf, step: "gen_csvid_prompt" });
    await send(chatId, `Frames: ${nf}\n\nEnter your prompt:`, cancelKbd()); return true;
  }
  if (data.startsWith("gen:csvid:sorasize:")) {
    const sz = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, size: sz });
    await send(chatId, `Size: ${sz}\n\nChoose frames:`, inlineKbd([
      [{ text: "10 frames (~5s)", callback_data: "gen:csvid:soraframes:10" }, { text: "15 frames (~7.5s)", callback_data: "gen:csvid:soraframes:15" }],
    ]));
    return true;
  }
  if (data.startsWith("gen:csvid:veo:speed:")) {
    const speed = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, speed, step: "gen_csvid_ar" });
    await renderCsvidArPicker(chatId, ["Auto", "16_9", "9_16"], "VEO aspect ratio:"); return true;
  }
  if (data.startsWith("gen:csvid:sdt:")) {
    const sdt = data.split(":").slice(3).join(":");
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, seedanceTaskType: sdt, step: "gen_csvid_dur_input" });
    await send(chatId, `Task type: ${sdt}\n\nEnter duration (4–15 seconds):`, cancelKbd()); return true;
  }

  // ── Quick Video ───────────────────────────────────────────────
  if (data === "gen:quickvid") {
    setFlow(chatId, { step: "gen_quickvid_img" });
    await send(chatId, "⚡ Quick Video\n\nSend the start-frame image:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:quickvid:dur:")) {
    const dur = Number(data.split(":").pop());
    const f = getFlow(chatId);
    if (!f?.imageUrl) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting quick video...", null);
    const r = await apiVideoDirectly(userId, { imageUrl: f.imageUrl, prompt: f.prompt || "", duration: [5, 10].includes(dur) ? dur : 5 });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "video", r.creditsUsed);
    return true;
  }

  // ── Full Recreation ───────────────────────────────────────────
  if (data === "gen:fullrec") {
    await pickModelAndContinue("gen:fullrec", "gen_fullrec_screenshot", "Step 1: Send a screenshot (a frame from the target video):");
    return true;
  }
  if (data.startsWith("gen:fullrec:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_fullrec_screenshot", modelId });
    await send(chatId, "🔁 Full Recreation\n\nStep 1: Send a screenshot (a frame from the target video):", cancelKbd()); return true;
  }
  if (data.startsWith("gen:fullrec:dur:")) {
    const dur = Number(data.split(":").pop());
    const f = getFlow(chatId);
    if (!f?.screenshotUrl || !f?.videoUrl) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    // Load model photos for identity reference (required by complete-recreation API)
    const model = f.modelId ? await prisma.savedModel.findFirst({ where: { id: f.modelId, userId }, select: { id: true, photo1Url: true, photo2Url: true, photo3Url: true } }) : null;
    const modelPhotos = model ? [model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean) : [];
    clearFlow(chatId);
    await send(chatId, "⏳ Starting full recreation pipeline (image → video, 2 steps)...", null);
    const r = await apiCompleteRecreation(userId, {
      modelId: f.modelId || undefined,
      modelIdentityImages: modelPhotos,
      videoScreenshot: f.screenshotUrl,
      originalVideoUrl: f.videoUrl,
      videoPrompt: f.prompt || "",
      videoDuration: [5, 10].includes(dur) ? dur : 5, // server reads videoDuration, not duration
    });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const gens = r.generations || {};
    // Controller returns { generations: { image: { id }, video: { id } } }
    const imgId = gens.image?.id || gens.imageGenId || "?";
    const vidId = gens.video?.id || gens.videoGenId || "?";
    await send(chatId, `✅ Pipeline started.\nImage gen: ${imgId}\nVideo gen: ${vidId}\n\nCredits: ${r.creditsUsed ?? "n/a"}`, inlineKbd([[{ text: "🕘 History", callback_data: "nav:history" }]]));
    return true;
  }

  // ── Frame Extractor ───────────────────────────────────────────
  if (data === "gen:extract") {
    setFlow(chatId, { step: "gen_extract_video" });
    await send(chatId, "🎞 Frame Extractor (free)\n\nSend the reference video:", cancelKbd()); return true;
  }

  // ── Pipeline Prep ─────────────────────────────────────────────
  if (data === "gen:pipeline") {
    
    await pickModelAndContinue("gen:pipeline", "gen_pipeline_frame", "Send the frame image:");
    return true;
  }
  if (data.startsWith("gen:pipeline:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_pipeline_frame", modelId });
    await send(chatId, "Send the frame image as a photo or file:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:pipeline:pick:")) {
    const idx = Number(data.split(":").pop());
    const f = getFlow(chatId);
    // Retrieve stored variation URLs from flow
    const vars = f?.variations || [];
    const selected = vars[idx];
    const imageUrl = selected?.imageUrl || selected?.url || "";
    setFlow(chatId, { ...(f || {}), step: "gen_pipeline_refvideo", selectedImageUrl: isHttpUrl(imageUrl) ? imageUrl : null });
    await send(chatId, "✅ Variation selected. Now send the reference motion video:", cancelKbd()); return true;
  }

  // ── Describe Target ───────────────────────────────────────────
  if (data === "gen:describe") {
    setFlow(chatId, { step: "gen_describe_img" });
    await send(chatId, "📝 Describe Target\n\nSend the target image as a photo or file:", cancelKbd()); return true;
  }

  // ── Enhance Prompt ────────────────────────────────────────────
  if (data === "gen:enhance") {
    setFlow(chatId, { step: "gen_enhance_input" });
    await send(chatId, "✨ Enhance Prompt\n\nEnter the prompt you want to enhance:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:enhance:mode:")) {
    const mode = data.split(":").pop();
    const f = getFlow(chatId);
    if (!f?.rawPrompt) { await send(chatId, "?? Session expired � tap to restart:", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Enhancing...", null);
    const r = await apiEnhancePrompt(userId, f.rawPrompt, mode);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✨ Enhanced prompt:\n\n${r.enhancedPrompt}`, inlineKbd([
      [{ text: "🎬 Use as prompt", callback_data: "nav:generate" }],
      [{ text: "🏠 Home", callback_data: "nav:home" }],
    ]));
    return true;
  }

  // ── Advanced AI ───────────────────────────────────────────────
  // ── CS Assets ─────────────────────────────────────────────────
  if (data === "gen:assets") {
    const r = await apiCsAssetsList(userId);
    const assets = r.assets || [];
    if (!assets.length) {
      await send(chatId, "No assets saved yet.\n\nAssets are images/videos you register for use as Seedance references.", inlineKbd([
        [{ text: "➕ Create new asset", callback_data: "gen:assets:create" }],
        [{ text: "⬅️ Back", callback_data: "nav:generate" }],
      ]));
      return true;
    }
    const rows = assets.slice(0, 20).map((a) => [{
      text: `${a.status === "completed" ? "✅" : "⏳"} ${(a.name || a.id).slice(0, 30)} [${a.assetType || "img"}]`,
      callback_data: `gen:assets:view:${a.id}`,
    }]);
    rows.push([{ text: "➕ Add asset", callback_data: "gen:assets:create" }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:generate" }]);
    await send(chatId, `📎 CS Assets (${assets.length}/100)`, inlineKbd(rows));
    return true;
  }
  if (data.startsWith("gen:assets:view:")) {
    const assetId = data.split(":").pop();
    await send(chatId, `Asset ID: ${assetId}`, inlineKbd([
      [{ text: "🗑 Delete", callback_data: `gen:assets:delete:${assetId}` }],
      [{ text: "⬅️ Back", callback_data: "gen:assets" }],
    ]));
    return true;
  }
  if (data.startsWith("gen:assets:delete:")) {
    const assetId = data.split(":").pop();
    await apiCsDeleteAsset(userId, assetId);
    await send(chatId, "✅ Asset deleted.", inlineKbd([[{ text: "⬅️ Assets", callback_data: "gen:assets" }]]));
    return true;
  }
  if (data === "gen:assets:create") {
    setFlow(chatId, { step: "gen_assets_create_type" });
    await send(chatId, "Create a new CS Asset\n\nWhat type?", inlineKbd([
      [{ text: "🖼 Image asset", callback_data: "gen:assets:type:Image" }],
      [{ text: "🎬 Video asset", callback_data: "gen:assets:type:Video" }],
      [{ text: "Cancel", callback_data: "gen:assets" }],
    ]));
    return true;
  }
  if (data.startsWith("gen:assets:type:")) {
    const assetType = data.split(":").pop();
    const f = getFlow(chatId) || {};
    setFlow(chatId, { ...f, step: `gen_assets_create_${assetType.toLowerCase()}`, assetType });
    await send(chatId, `Send the ${assetType.toLowerCase()} as an upload:`, cancelKbd());
    return true;
  }
  // ── Advanced AI ───────────────────────────────────────────────
  if (data === "gen:advanced") { 
    
    await pickModelAndContinue("gen:advanced", "gen_advanced_prompt", "Enter your prompt:");
    return true;
  }
  if (data.startsWith("gen:advanced:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_advanced_engine", modelId });
    await send(chatId, "Select engine:", inlineKbd([
      [{ text: "nano-banana (standard)", callback_data: "gen:advanced:engine:nano-banana" }],
      [{ text: "seedream (spicy/uncensored)", callback_data: "gen:advanced:engine:seedream" }],
    ]));
    return true;
  }
  if (data.startsWith("gen:advanced:engine:")) {
    const engine = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, step: "gen_advanced_prompt", engine });
    await send(chatId, "Enter your prompt:", cancelKbd()); return true;
  }

  return false;
}

