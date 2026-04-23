import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow, persistNow, getSession } from "./state.js";

// After setFlow at critical "user sent media, bot now shows inline buttons" transitions,
// immediately persist to DB so the flow survives a Vercel cold-start on the next request.
async function setFlowNow(chatId, data) {
  setFlow(chatId, data);
  await persistNow(String(chatId)).catch(() => {});
}

function flowExpiredKbd() {
  return inlineKbd([[{ text: "🔁 Start over", callback_data: "nav:generate" }]]);
}
import {
  send,
  sendImg,
  sendMedia,
  inlineKbd,
  isHttpUrl,
  formatDate,
  toJsonObj,
  pickUrl,
  editInlineMenu,
  deleteCallbackMenuMessage,
  isGenerateFlowMenuMessage,
  modelListToInlineRows,
  removeKbd,
} from "./helpers.js";
import { resolveImage, resolveVideo, mediaMismatchHint, telegramVideoDurationSeconds } from "./media.js";
import {
  cancelKbd,
  generateRootKbd,
  generatePictureSubmenuKbd,
  generateVideoSubmenuKbd,
  generateCreatorStudioSubmenuKbd,
  generateMoreKbd,
  generationResultKbd,
  durationKbd5_10,
  modelPickerKbd,
} from "./keyboards.js";
import { renderMcxMenu } from "./mcx.js";
import { ensureAuth } from "./auth.js";
import {
  apiPromptVideo, apiPromptImage, apiImageIdentity, apiAdvancedImage, apiTalkingHead, apiVideoDirectly,
  apiFaceSwapVideo, apiFaceSwapImage, apiDescribeTarget, apiEnhancePrompt, apiExtractFrames,
  apiVideoMotion, apiPrepareVideo, apiCompleteVideo, apiCompleteRecreation,
  apiCreatorStudioImage, apiCreatorStudioVideo, apiDeleteGenerations, apiVoices,
  apiCsAssetsList, apiCsCreateAsset, apiCsDeleteAsset,
  apiNsfwImage, apiNsfwVideo, apiNsfwExtendVideo,
} from "./api.js";
import { RETRYABLE_TYPES } from "./config.js";

function needImagePrompt(message, fallback) {
  return mediaMismatchHint("image", message) || fallback;
}
function needVideoPrompt(message, fallback) {
  return mediaMismatchHint("video", message) || fallback;
}

async function estimateTalkingHeadCreditsPreview(text, voiceId) {
  try {
    const { estimateAudioDuration } = await import("../../../services/elevenlabs.service.js");
    const { getGenerationPricing } = await import("../../../services/generation-pricing.service.js");
    const estimatedDuration = estimateAudioDuration(text, voiceId);
    const pricing = await getGenerationPricing();
    const creditsNeeded = Math.max(
      pricing.talkingHeadMin,
      Math.ceil(estimatedDuration * pricing.talkingHeadPerSecondX10),
    );
    return { creditsNeeded, estimatedDuration };
  } catch {
    return { creditsNeeded: null, estimatedDuration: null };
  }
}

const PAGE_SIZE = 8;

/** One background poll per chat+generation — avoids duplicate loops. */
const activeTelegramGenPolls = new Set();

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll DB until this generation completes or fails, then send the result in-chat (no Refresh needed).
 * Fire-and-forget: works on a long-running Node process; may not finish on some serverless freezes after the webhook returns.
 */
export function scheduleTelegramGenCompletionPush(chatId, genId, fromPage = 0) {
  const userId = getSession(chatId)?.userId;
  if (!userId || !genId || genId === "?" || String(genId).length < 32) return;
  const key = `${chatId}:${genId}`;
  if (activeTelegramGenPolls.has(key)) return;
  activeTelegramGenPolls.add(key);
  (async () => {
    try {
      for (let i = 0; i < 150; i++) {
        if (i > 0) await sleepMs(4000);
        const gen = await prisma.generation.findFirst({
          where: { id: genId, userId },
          select: { id: true, status: true, outputUrl: true, type: true, creditsCost: true },
        });
        if (!gen) return;
        if (gen.status === "completed" && gen.outputUrl && isHttpUrl(gen.outputUrl)) {
          await sendGenerationResult(chatId, gen.id, gen.status, gen.outputUrl, gen.type, gen.creditsCost, fromPage, userId);
          return;
        }
        if (gen.status === "failed") {
          await sendGenerationResult(chatId, gen.id, gen.status, gen.outputUrl, gen.type, gen.creditsCost, fromPage, userId);
          return;
        }
      }
    } catch (e) {
      console.error("[telegram-gen-poll]", e?.message);
    } finally {
      activeTelegramGenPolls.delete(key);
    }
  })();
}

// — CS Image —
const CSIMG_ENGINES = [
  { id: "nano-banana-pro",   label: "🍌 nano-banana",     needsImg: false, note: "uses model photos" },
  { id: "flux-kontext-pro",  label: "🌀 Flux Kontext Pro", needsImg: true,  note: "edit/remix" },
  { id: "flux-kontext-max",  label: "🌀 Flux Kontext Max", needsImg: true,  note: "edit/remix hi-q" },
  { id: "wan-2-7-image",     label: "🖼 WAN 2.7 Image",    needsImg: false, note: "fast gen" },
  { id: "wan-2-7-image-pro", label: "🖼 WAN 2.7 Image Pro",needsImg: false, note: "pro quality" },
  { id: "ideogram-v3-text",  label: "✏️ Ideogram v3 Text", needsImg: false, note: "text-to-image" },
  { id: "ideogram-v3-remix", label: "✏️ Ideogram v3 Remix",needsImg: true,  note: "remix with input" },
  { id: "seedream-v4-5-edit", label: "🌙 Seedream 4.5 Edit", needsImg: false, note: "multi-ref + flat cr" },
];

/** Ideogram/WAN: multi-output rows. Nano/Seedream use `csimgFlatTierResKeyboardRows`. */
function csimgNumResKeyboard() {
  const row1 = [
    { text: "1 · 1K", callback_data: "gen:csimg:numres:1:1K" },
    { text: "1 · 2K", callback_data: "gen:csimg:numres:1:2K" },
    { text: "1 · 4K", callback_data: "gen:csimg:numres:1:4K" },
  ];
  return [
    row1,
    [{ text: "2 · 1K", callback_data: "gen:csimg:numres:2:1K" }, { text: "2 · 2K", callback_data: "gen:csimg:numres:2:2K" }],
    [{ text: "4 · 1K", callback_data: "gen:csimg:numres:4:1K" }],
    [{ text: "⬅️ Back", callback_data: "gen:csimg" }],
  ];
}

/** @param {"nano"|"seedream"} tier */
async function csimgFlatTierResKeyboardRows(tier) {
  const { getGenerationPricing } = await import("../../../services/generation-pricing.service.js");
  const p = await getGenerationPricing();
  const k12 = Math.ceil(
    Number(
      tier === "seedream"
        ? (p.creatorStudioSeedream45Edit1K2K ?? p.creatorStudioSeedream45Edit)
        : p.creatorStudioNanoBanana1K2K,
    ) || 16,
  );
  const k4 = Math.ceil(
    Number(
      tier === "seedream"
        ? (p.creatorStudioSeedream45Edit4K ?? p.creatorStudioSeedream45Edit)
        : p.creatorStudioNanoBanana4K,
    ) || 22,
  );
  return [
    [
      { text: `1K · ${k12} cr`, callback_data: "gen:csimg:numres:1:1K" },
      { text: `2K · ${k12} cr`, callback_data: "gen:csimg:numres:1:2K" },
      { text: `4K · ${k4} cr`, callback_data: "gen:csimg:numres:1:4K" },
    ],
    [{ text: "⬅️ Back", callback_data: "gen:csimg" }],
  ];
}

async function renderCsimgEngineMenu(chatId, editMessageId = null) {
  const rows = [];
  for (let i = 0; i < CSIMG_ENGINES.length; i += 2) {
    const pair = [{ text: CSIMG_ENGINES[i].label, callback_data: `gen:csimg:eng:${CSIMG_ENGINES[i].id}` }];
    if (CSIMG_ENGINES[i + 1]) pair.push({ text: CSIMG_ENGINES[i + 1].label, callback_data: `gen:csimg:eng:${CSIMG_ENGINES[i + 1].id}` });
    rows.push(pair);
  }
  rows.push([{ text: "⬅️ Back", callback_data: "nav:generate" }]);
  await editInlineMenu(
    chatId,
    editMessageId,
    "Creator Studio — Image\n\nSelect engine:\n(Ideogram edit + mask → use Mini App)",
    inlineKbd(rows),
  );
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
  if (engineId === "nano-banana-pro") {
    setFlow(chatId, { step: "gen_csimg_refs", engine: engineId, modelId, referencePhotos: [] });
    await send(
      chatId,
      "🍌 Nano Banana\n\nOptional reference photos — send as many as you want (up to 8, API limit), one photo per message. **Done** → aspect & resolution. **Skip** → no refs.\n\nFlat price: **1K/2K = 16 cr**, **4K = 22 cr** (same whether you use 0 or 8 refs).",
      { keyboard: [["Done", "Skip"], ["Cancel"]], resize_keyboard: true, one_time_keyboard: false },
    );
    return;
  }
  if (engineId === "seedream-v4-5-edit") {
    setFlow(chatId, { step: "gen_csimg_refs", engine: engineId, modelId, referencePhotos: [] });
    await send(
      chatId,
      "🌙 Seedream 4.5 Edit\n\nSend **at least one** reference image (up to 10). Add as many as you want, one photo per message. **Done** → aspect & resolution. **Skip** is only OK if you already sent photos.\n\nFlat price: **1K/2K = 16 cr**, **4K = 22 cr** — extra refs don’t increase cost.",
      { keyboard: [["Done", "Skip"], ["Cancel"]], resize_keyboard: true, one_time_keyboard: false },
    );
    return;
  }
  setFlow(chatId, { step: eng.needsImg ? "gen_csimg_img" : "gen_csimg_aspect", engine: engineId, modelId });
  if (engineId.startsWith("ideogram")) {
    // Ideogram needs rendering speed first
    setFlow(chatId, { step: "gen_csimg_speed", engine: engineId, modelId });
    await send(chatId, `${eng.label}\n\nRendering speed (affects credits):`, inlineKbd([
      [{ text: "⚡ Turbo (fastest, cheapest)", callback_data: "gen:csimg:speed:turbo" }],
      [{ text: "⚖️ Balanced (default)", callback_data: "gen:csimg:speed:balanced" }],
      [{ text: "✨ Quality (best, most cr)", callback_data: "gen:csimg:speed:quality" }],
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

// — CS Video —
const CSVID_FAMILIES = [
  { id: "wan27",     label: "▶️ WAN 2.7",    modes: ["t2v","i2v","replace","edit"],  note: "2–15s, 720p/1080p" },
  { id: "wan26",     label: "▶️ WAN 2.6",    modes: ["t2v","i2v"],                   note: "5/10/15s, 720p/1080p" },
  { id: "wan22",     label: "▶️ WAN 2.2",    modes: ["move","replace"],              note: "5s, animate video" },
  { id: "kling30",   label: "▶️ Kling 3.0",  modes: ["t2v","i2v"],                   note: "3–15s, std/pro" },
  { id: "kling26",   label: "▶️ Kling 2.6",  modes: ["t2v","i2v"],                   note: "5 or 10s" },
  { id: "seedance2", label: "▶️ Seedance 2",  modes: ["t2v","i2v","edit","multi-ref"],note: "4–15s, multimodal" },
  { id: "veo31",     label: "▶️ VEO 3.1",    modes: ["t2v","i2v","ref2v","extend"],  note: "8s, Google VEO 3" },
  { id: "sora2",     label: "▶️ Sora 2",     modes: ["t2v","i2v"],                   note: "10/15 frames" },
];

const CSVID_MODE_LABELS = { t2v:"Text?Video", i2v:"Image?Video", edit:"First+Last", "multi-ref":"Multi-Ref", move:"Animate", replace:"Replace", ref2v:"Reference?Video", extend:"Extend" };

async function renderCsvidFamilyMenu(chatId, editMessageId = null) {
  const rows = [];
  for (let i = 0; i < CSVID_FAMILIES.length; i += 2) {
    const pair = [{ text: CSVID_FAMILIES[i].label, callback_data: `gen:csvid:fam:${CSVID_FAMILIES[i].id}` }];
    if (CSVID_FAMILIES[i + 1]) pair.push({ text: CSVID_FAMILIES[i + 1].label, callback_data: `gen:csvid:fam:${CSVID_FAMILIES[i + 1].id}` });
    rows.push(pair);
  }
  rows.push([{ text: "⬅️ Back", callback_data: "nav:generate" }]);
  await editInlineMenu(chatId, editMessageId, "Creator Studio — Video\n\nSelect engine:", inlineKbd(rows));
}

async function renderCsvidModeMenu(chatId, family) {
  const fam = CSVID_FAMILIES.find((f) => f.id === family);
  if (!fam) { await renderCsvidFamilyMenu(chatId, null); return; }
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
    // WAN 2.2 only supports 5s ? set fixed duration upfront
    setFlow(chatId, { step: "gen_csvid_vidref", family, mode, durationSeconds: 5 });
    await send(chatId, `🎬 WAN 2.2 ${mode === "replace" ? "Replace" : "Animate"}\n\nStep 1: Upload the input video:`, cancelKbd());
  } else if (needsVideo && family === "wan27" && mode === "edit") {
    setFlow(chatId, { step: "gen_csvid_vidref", family, mode });
    await send(chatId, `🎬 WAN 2.7 Edit\n\nUpload the input video to edit:`, cancelKbd());
  } else if (mode === "edit" && family === "seedance2") {
    setFlow(chatId, { step: "gen_csvid_seedance_first", family, mode });
    await send(chatId, `🎬 Seedance First+Last\n\nStep 1: Upload FIRST frame image:`, cancelKbd());
  } else if (mode === "multi-ref" && family === "seedance2") {
    setFlow(chatId, { step: "gen_csvid_img", family, mode });
    await send(chatId, `🎬 Seedance Multi-Ref\n\nUpload reference image (or skip):`, { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true });
  } else if (needsImage) {
    setFlow(chatId, { step: "gen_csvid_img", family, mode });
    await send(chatId, `Upload the ${mode === "ref2v" ? "reference" : "start-frame"} image:`, cancelKbd());
  } else if (family === "sora2") {
    // Sora needs "portrait" or "landscape" ? NOT the generic AR picker which uses ":"?"_" conversion
    setFlow(chatId, { step: "gen_csvid_sora_ar", family, mode });
    await send(chatId, "Sora: Choose aspect ratio:", inlineKbd([
      [{ text: "📱 Portrait (9:16)", callback_data: "gen:csvid:sora:ar:portrait" }],
      [{ text: "🖼 Landscape (16:9)", callback_data: "gen:csvid:sora:ar:landscape" }],
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
      [{ text: "⚡ Fast", callback_data: "gen:csvid:veo:speed:fast" }, { text: "✨ Quality", callback_data: "gen:csvid:veo:speed:quality" }, { text: "🪶 Lite", callback_data: "gen:csvid:veo:speed:lite" }],
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

/** AI Photo (prompt-image): Casual vs Sexy — same split as Generate → Prompt photo on the web. */
async function sendAiphotoModePicker(chatId) {
  await send(
    chatId,
    "📝 AI photo — choose mode (same as in the app)\n\n" +
      "😎 Casual — IG-style, stricter safety\n\n" +
      "🔥 Sexy / Spicy — more freedom",
    inlineKbd([
      [
        { text: "😎 Casual", callback_data: "gen:aiphoto:mode:casual" },
        { text: "🔥 Sexy / Spicy", callback_data: "gen:aiphoto:mode:sexy" },
      ],
      [{ text: "❌ Cancel", callback_data: "nav:generate" }],
    ]),
  );
}

/** Map flow to POST /api/generate/prompt-image body. `promptImageMode` missing = spicy (legacy TG sessions). */
function apiPromptImageOptsFromFlow(flow) {
  const casual = flow?.promptImageMode === "casual";
  const sexy = !casual;
  return {
    quantity: 1,
    style: "amateur",
    contentRating: sexy ? "sexy" : "pg13",
    useNsfw: sexy,
    useCustomPrompt: false,
  };
}

// Dispatch to next CS Video step after image is collected
async function dispatchCsvidNextStep(chatId, f) {
  const step = f.step;
  if (step === "gen_csvid_sora_ar") {
    await send(chatId, "Sora: Choose aspect ratio:", inlineKbd([
      [{ text: "📱 Portrait (9:16)", callback_data: "gen:csvid:sora:ar:portrait" }],
      [{ text: "🖼 Landscape (16:9)", callback_data: "gen:csvid:sora:ar:landscape" }],
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
      [{ text: "⚡ Fast", callback_data: "gen:csvid:veo:speed:fast" }, { text: "✨ Quality", callback_data: "gen:csvid:veo:speed:quality" }, { text: "🪶 Lite", callback_data: "gen:csvid:veo:speed:lite" }],
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

export async function renderGenerateMenu(chatId, preselectedModelId = null, editMessageId = null) {
  if (preselectedModelId) {
    setFlow(chatId, { modelId: preselectedModelId });
  }
  await editInlineMenu(chatId, editMessageId, "Choose", generateRootKbd());
}

/** Current spendable total (legacy + subscription + purchased) for Telegram copy. */
async function formatCreditBalanceSuffix(userId) {
  if (!userId) return "";
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true, subscriptionCredits: true, purchasedCredits: true },
    });
    if (!u) return "";
    const legacy = Number(u.credits ?? 0) || 0;
    const sub = Number(u.subscriptionCredits ?? 0) || 0;
    const purchased = Number(u.purchasedCredits ?? 0) || 0;
    const total = Math.max(0, legacy + sub + purchased);
    return `\n💰 Credits left: ${total.toLocaleString("en-US")}`;
  } catch {
    return "";
  }
}

// — Shared: send generation result —
// When completed: sends the actual image/video. When processing: shows clean status.
export async function sendGenerationResult(chatId, genId, status, outputUrl, type, creditsUsed, fromPage = 0, userId = null) {
  const uid = userId ?? getSession(chatId)?.userId ?? null;
  const balanceLine = uid ? await formatCreditBalanceSuffix(uid) : "";
  const kbd = generationResultKbd(genId, status, outputUrl, type, fromPage);
  const typeLabel = String(type || "Generation").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const creditNote = creditsUsed != null ? ` · ${creditsUsed} cr` : "";

  if (status === "completed" && outputUrl && isHttpUrl(outputUrl)) {
    // Send the actual media file ? image or video
    const sent = await sendMedia(chatId, outputUrl, type, {
      caption: `✅ ${typeLabel}${creditNote}${balanceLine}`,
      replyMarkup: inlineKbd([
        [{ text: "🎬 Again", callback_data: "nav:generate" }, { text: "🕘 History", callback_data: "nav:history" }],
      ]),
    });
    if (sent) return; // media sent successfully
    // Fallback: media send failed ? show text with link button
    await send(chatId, `✅ ${typeLabel} complete!${creditNote}${balanceLine}`, inlineKbd([
      [{ text: "🔗 Open result", url: outputUrl }],
      [{ text: "🎬 Again", callback_data: "nav:generate" }, { text: "🕘 History", callback_data: "nav:history" }],
    ]));
    return;
  }

  if (status === "failed") {
    const canRetry = RETRYABLE_TYPES.has(String(type || "").toLowerCase());
    await send(chatId, `❌ ${typeLabel} failed.${balanceLine}`, inlineKbd([
      ...(canRetry ? [[{ text: "🔄 Retry", callback_data: `gen:retry:${genId}:${fromPage}` }]] : []),
      [{ text: "🕘 History", callback_data: "nav:history" }],
    ]));
    return;
  }

  // Processing / pending
  await send(chatId, `⏳ ${typeLabel} in progress${creditNote}${balanceLine}\n\nYou'll get the result here when it's ready — or tap Refresh.`, inlineKbd([
    [{ text: "🔄 Refresh", callback_data: `gen:refresh:${genId}:${fromPage}` }],
    [{ text: "🕘 History", callback_data: "nav:history" }],
  ]));
  scheduleTelegramGenCompletionPush(chatId, genId, fromPage);
}

// — Shared: refresh generation status —
export async function refreshGeneration(chatId, userId, genId, fromPage = 0) {
  const gen = await prisma.generation.findFirst({
    where: { id: genId, userId },
    select: { id: true, type: true, status: true, outputUrl: true, creditsCost: true, errorMessage: true, createdAt: true, completedAt: true, prompt: true },
  });
  if (!gen) { await send(chatId, "Generation not found.", inlineKbd([[{ text: "🕘 History", callback_data: "nav:history" }]])); return; }
  // Delegate to sendGenerationResult which handles media sending + clean UX
  await sendGenerationResult(chatId, gen.id, gen.status, gen.outputUrl, gen.type, gen.creditsCost, fromPage, userId);
}

async function submitIdentityRecreateFromTelegram(chatId, userId, flow, promptExtra) {
  const modelId = flow.modelId;
  const targetImageUrl = flow.targetImageUrl;
  const identityClothesMode = flow.identityClothesMode;
  if (!modelId || !targetImageUrl) {
    clearFlow(chatId);
    await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd());
    return;
  }
  const clothesMode = identityClothesMode === "reference" ? "reference" : "";
  clearFlow(chatId);
  await send(chatId, "⏳ Starting identity recreation...", removeKbd());
  const body = {
    modelId,
    targetImage: targetImageUrl,
    clothesMode,
    aspectRatio: "9:16",
    quantity: 1,
  };
  const trimmed = String(promptExtra || "").trim();
  if (trimmed) body.prompt = trimmed;
  const r = await apiImageIdentity(userId, body);
  if (!r.ok) {
    await send(chatId, `❌ Failed: ${r.message}`);
    return;
  }
  const gen = Array.isArray(r.generation) ? r.generation[0] : r.generation;
  await sendGenerationResult(chatId, gen?.id || "?", gen?.status || "processing", null, "image-identity", r.creditsUsed);
}

async function submitMotionRecreateFromTelegram(chatId, userId, flow, extraPrompt) {
  const { imageUrl, referenceVideoUrl, motionEngine, keepAudio } = flow;
  if (!imageUrl || !referenceVideoUrl || !motionEngine) {
    clearFlow(chatId);
    await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd());
    return;
  }
  const prompt = String(extraPrompt || "").trim();
  clearFlow(chatId);
  await send(chatId, "⏳ Starting video recreate…", removeKbd());
  const body = {
    modelId: flow.modelId || undefined,
    generatedImageUrl: imageUrl,
    referenceVideoUrl,
    keepAudio: keepAudio !== false,
    ...(prompt ? { prompt } : {}),
  };
  if (motionEngine === "wan") {
    body.recreateEngine = "wan";
    body.wanResolution = "580p";
  } else {
    body.recreateEngine = "kling";
    body.ultraMode = motionEngine === "pro";
  }
  const r = await apiVideoMotion(userId, body);
  if (!r.ok) {
    await send(chatId, `❌ Failed: ${r.message}`);
    return;
  }
  await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "video", r.creditsUsed);
}

// — Shared: retry generation —
export async function retryGeneration(chatId, userId, genId, fromPage = 0) {
  const gen = await prisma.generation.findFirst({
    where: { id: genId, userId },
    select: { id: true, type: true, modelId: true, inputImageUrl: true, inputVideoUrl: true, prompt: true, duration: true, providerFamily: true, providerMode: true, providerRequest: true, pipelinePayload: true, replicateModel: true },
  });
  if (!gen) { await send(chatId, "Generation not found."); return; }
  if (!RETRYABLE_TYPES.has(gen.type)) { await send(chatId, `Retry not available for type "${gen.type}".`, inlineKbd([[{ text: "🕘 History", callback_data: `nav:history` }]])); return; }

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
    const vid = pickUrl(gen.inputVideoUrl);
    const metaV = toJsonObj(gen.inputImageUrl);
    const img = pickUrl(metaV?.figure2IdentityImage, metaV?.generatedImageUrl, gen.inputImageUrl);
    if (img && vid) {
      const rm = String(gen.replicateModel || "").toLowerCase();
      const isWan = rm.includes("wan");
      const isPro = rm.includes("3.0") || rm.includes("ultra");
      const motionBody = {
        generatedImageUrl: img,
        referenceVideoUrl: vid,
        keepAudio: true,
        modelId: gen.modelId || undefined,
        ...(duration > 0 ? { videoDuration: duration } : {}),
        ...(prompt && !prompt.startsWith("Video recreate") ? { prompt } : {}),
      };
      if (isWan) {
        motionBody.recreateEngine = "wan";
        motionBody.wanResolution = "580p";
      } else {
        motionBody.recreateEngine = "kling";
        motionBody.ultraMode = isPro;
      }
      retry = await apiVideoMotion(userId, motionBody);
    }
    else if (img && prompt) retry = await apiPromptVideo(userId, img, prompt, [5, 10].includes(duration) ? duration : 5);
    else { await send(chatId, "Cannot retry: original source media missing."); return; }
  } else if (type === "prompt-image") {
    if (!gen.modelId) { await send(chatId, "Cannot retry: original model missing."); return; }
    const useSexy = String(gen.replicateModel || "").toLowerCase().includes("seedream");
    retry = await apiPromptImage(userId, gen.modelId, prompt, {
      quantity: 1,
      contentRating: useSexy ? "sexy" : "pg13",
      useNsfw: useSexy,
    });
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
    retry = await apiFaceSwapVideo(userId, vid, modelId, Number(gen.duration) > 0 ? Number(gen.duration) : undefined);
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
  } else if (type === "nsfw") {
    if (!gen.modelId || !prompt) { await send(chatId, "Cannot retry: model/prompt missing."); return; }
    retry = await apiNsfwImage(userId, gen.modelId, prompt, 1);
  } else if (type === "nsfw-video") {
    const meta = toJsonObj(gen.inputImageUrl);
    const img = meta?.sourceImage || pickUrl(gen.inputImageUrl);
    if (!gen.modelId || !img) { await send(chatId, "Cannot retry: model/source image missing."); return; }
    const vidDur = meta?.duration === 8 ? 8 : 5;
    retry = await apiNsfwVideo(userId, gen.modelId, img, prompt, vidDur);
  } else if (type === "nsfw-video-extend") {
    const meta = toJsonObj(gen.inputImageUrl);
    const sourceGenId = meta?.sourceGenerationId;
    const extendDur = meta?.extendDuration === 8 ? 8 : 5;
    if (!sourceGenId) { await send(chatId, "Cannot retry: source generation missing."); return; }
    const userPrompt = String(prompt || "").split(". Natural pose energy")[0]?.trim() || prompt;
    retry = await apiNsfwExtendVideo(userId, sourceGenId, extendDur, userPrompt);
  }

  if (!retry.ok) { await send(chatId, `❌ Retry failed: ${retry.message}`, inlineKbd([[{ text: "🕘 History", callback_data: "nav:history" }]])); return; }
  const newId =
    retry.generation?.id ||
    retry.generationId ||
    (Array.isArray(retry.generations) && retry.generations[0]?.id) ||
    "unknown";
  await send(chatId, `✅ Retry started.\nNew ID: ${newId}`, inlineKbd([
    ...(newId !== "unknown" ? [[{ text: "🔄 Status", callback_data: `gen:refresh:${newId}:${fromPage}` }]] : []),
    [{ text: "🕘 History", callback_data: "nav:history" }],
  ]));
  if (newId !== "unknown") scheduleTelegramGenCompletionPush(chatId, newId, fromPage);
}

// — Message handler —
export async function handleGenerateMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("gen_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await send(chatId, "Cancelled.", inlineKbd([[{ text: "🎬 Generate", callback_data: "nav:generate" }]])); return true; }

  // — AI Photo — mode picker (inline buttons only) —
  if (flow.step === "gen_aiphoto_mode") {
    await send(chatId, "Use the buttons above: 😎 Casual or 🔥 Sexy / Spicy.", inlineKbd([[{ text: "❌ Cancel", callback_data: "nav:generate" }]]));
    return true;
  }
  if (flow.step === "gen_aiphoto_enhancing") {
    await send(chatId, "Hang on — still enhancing your prompt.", null);
    return true;
  }

  // — AI Photo —
  if (flow.step === "gen_aiphoto_prompt") {
    if (t.length < 2) { await send(chatId, "Describe the scene (2+ characters):", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, prompt: t });
    const modeHint = flow.promptImageMode === "casual" ? "Casual" : "Sexy / Spicy";
    await send(chatId, `Prompt: "${t.slice(0, 100)}"\n\nEnhance with AI? (${modeHint} mode · uses credits like the app)`, inlineKbd([
      [{ text: "✨ Yes, enhance", callback_data: "gen:aiphoto:enhance:yes" }, { text: "Use as-is", callback_data: "gen:aiphoto:enhance:no" }],
    ]));
    return true;
  }

  // — AI Video —
  if (flow.step === "gen_aivideo_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the start-frame image as a photo or image file:"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_aivideo_prompt", imageUrl: url });
    await send(chatId, "✅ Image received. Now enter your prompt:", cancelKbd()); return true;
  }
  if (flow.step === "gen_aivideo_prompt") {
    if (t.length < 2) { await send(chatId, "Enter a prompt:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_aivideo_dur", prompt: t });
    await send(chatId, "Choose video duration:", durationKbd5_10("gen:aivideo:dur")); return true;
  }

  // — Identity recreation —
  if (flow.step === "gen_identity_target") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the target image (the scene to recreate) as a photo or image file:"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_identity_outfit", targetImageUrl: url });
    await send(chatId, "✅ Target received. Choose outfit mode:", inlineKbd([
      [{ text: "Keep Model's Outfit", callback_data: "gen:identity:outfit:model" }],
      [{ text: "Keep Source Outfit", callback_data: "gen:identity:outfit:source" }],
    ]));
    return true;
  }

  if (flow.step === "gen_identity_prompt") {
    const trimmed = t.trim();
    const low = trimmed.toLowerCase();
    const extra = !trimmed || low === "skip" || low === "none" ? "" : trimmed;
    await submitIdentityRecreateFromTelegram(chatId, userId, flow, extra);
    return true;
  }

  // — Face Swap Video (duration from Telegram video message or server probe for files) —
  if (flow.step === "gen_faceswapvid_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, needVideoPrompt(message, "Send the source video as a video message or video file:"), cancelKbd()); return true; }
    const tgDur = telegramVideoDurationSeconds(message);
    let statusLine =
      tgDur == null
        ? "✅ Video received (length will be detected from the file).\n\n⏳ Starting face swap…"
        : "✅ Video received.\n\n⏳ Starting face swap…";
    if (tgDur != null) {
      try {
        const { getGenerationPricing } = await import("../../../services/generation-pricing.service.js");
        const pricing = await getGenerationPricing();
        const per = pricing?.videoFaceSwapPerSec;
        if (typeof per === "number" && per > 0) {
          const cr = Math.ceil(tgDur * per);
          statusLine = `✅ Video ~${tgDur}s → ~${cr} credits (${per}/s).\n\n⏳ Starting face swap…`;
        }
      } catch { /* keep default statusLine */ }
    }
    clearFlow(chatId);
    await send(chatId, statusLine, null);
    const r = await apiFaceSwapVideo(userId, url, flow.modelId, tgDur ?? undefined);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "face-swap", r.creditsUsed);
    return true;
  }

  // — Image Face Swap —
  if (flow.step === "gen_faceswapimg_source") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send your source face image (photo or file):"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_faceswapimg_target", sourceImageUrl: url });
    await send(chatId, "✅ Source face received. Now send the target image (the face will be swapped into this):", cancelKbd()); return true;
  }
  if (flow.step === "gen_faceswapimg_target") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the target image as a photo or image file:"), cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting image face swap...", null);
    const r = await apiFaceSwapImage(userId, flow.sourceImageUrl, url);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "face-swap-image", r.creditsUsed);
    return true;
  }

  // — Talking Head —
  if (flow.step === "gen_th_image") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send a portrait image (face clearly visible) as a photo or file:"), cancelKbd()); return true; }
    const voices = await apiVoices(userId, flow.modelId);
    if (!voices.ok || !voices.voices.length) { await send(chatId, "No voices found for this model. Clone a voice first.", inlineKbd([[{ text: "🎤 Voice studio", callback_data: "nav:voice" }]])); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_th_voice", imageUrl: url });
    const rows = voices.voices.map((v) => [{ text: v.name || v.id, callback_data: `gen:th:voice:${v.id}` }]);
    rows.push([{ text: "Cancel", callback_data: "nav:home" }]);
    await send(chatId, "✅ Image received. Select a voice:", inlineKbd(rows)); return true;
  }
  if (flow.step === "gen_th_script") {
    if (t.length < 5) { await send(chatId, "Enter the script (what the avatar will say, 5+ characters):", cancelKbd()); return true; }
    const { creditsNeeded, estimatedDuration } = await estimateTalkingHeadCreditsPreview(t, flow.voiceId);
    const crLabel = creditsNeeded != null ? `~${creditsNeeded} cr` : "~? cr";
    const durLabel = estimatedDuration != null ? `~${estimatedDuration.toFixed(1)}s audio` : "~?s audio";
    await setFlowNow(chatId, { ...flow, step: "gen_th_confirm", scriptText: t });
    await send(
      chatId,
      `Script OK (${durLabel}, ${crLabel}). Tap Generate to start.`,
      inlineKbd([
        [{ text: `▶️ Generate (${crLabel})`, callback_data: "gen:th:run" }],
        [{ text: "❌ Cancel", callback_data: "nav:generate" }],
      ]),
    );
    return true;
  }
  if (flow.step === "gen_th_confirm") {
    if (t.length < 5) {
      await send(chatId, "Send a new script (5+ characters) or tap Generate / Cancel.", cancelKbd());
      return true;
    }
    const { creditsNeeded, estimatedDuration } = await estimateTalkingHeadCreditsPreview(t, flow.voiceId);
    const crLabel = creditsNeeded != null ? `~${creditsNeeded} cr` : "~? cr";
    const durLabel = estimatedDuration != null ? `~${estimatedDuration.toFixed(1)}s audio` : "~?s audio";
    await setFlowNow(chatId, { ...flow, step: "gen_th_confirm", scriptText: t });
    await send(
      chatId,
      `Updated (${durLabel}, ${crLabel}). Tap Generate when ready.`,
      inlineKbd([
        [{ text: `▶️ Generate (${crLabel})`, callback_data: "gen:th:run" }],
        [{ text: "❌ Cancel", callback_data: "nav:generate" }],
      ]),
    );
    return true;
  }

  // — Video recreate (motion transfer) —
  if (flow.step === "gen_motion_image") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the image to animate (identity / first frame) as a photo or file:"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_motion_video", imageUrl: url });
    await send(chatId, "✅ Image received. Now send the reference video to recreate (motion source):", cancelKbd()); return true;
  }
  if (flow.step === "gen_motion_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, needVideoPrompt(message, "Send the reference video as a video message or file:"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_motion_audio", referenceVideoUrl: url });
    await send(
      chatId,
      "Use audio from the reference video?",
      inlineKbd([
        [{ text: "🔊 Sound on", callback_data: "gen:motion:audio:on" }, { text: "🔇 Sound off", callback_data: "gen:motion:audio:off" }],
        [{ text: "❌ Cancel", callback_data: "nav:generate" }],
      ]),
    );
    return true;
  }
  if (flow.step === "gen_motion_prompt") {
    const trimmed = t.trim();
    const low = trimmed.toLowerCase();
    const extra = !trimmed || low === "skip" || low === "none" ? "" : trimmed;
    await submitMotionRecreateFromTelegram(chatId, userId, flow, extra);
    return true;
  }

  // — Creator Studio Image — Nano: optional multi-ref (flat credit price)
  if (flow.step === "gen_csimg_refs") {
    const low = t.trim().toLowerCase();
    const maxR = flow.engine === "seedream-v4-5-edit" ? 10 : 8;
    const needRefs = flow.engine === "seedream-v4-5-edit";
    if (low === "skip") {
      if (needRefs && !(flow.referencePhotos || []).length) {
        await send(chatId, "Seedream needs at least one reference image. Send a photo first, or Cancel.", cancelKbd());
        return true;
      }
      setFlow(chatId, { ...flow, referencePhotos: flow.referencePhotos || [], step: "gen_csimg_aspect" });
      await renderCsimgAspectPicker(chatId);
      return true;
    }
    if (low === "done") {
      if (needRefs && !(flow.referencePhotos || []).length) {
        await send(chatId, "Seedream needs at least one reference image. Send a photo, then tap Done.", cancelKbd());
        return true;
      }
      setFlow(chatId, { ...flow, step: "gen_csimg_aspect" });
      await renderCsimgAspectPicker(chatId);
      return true;
    }
    const url = await resolveImage(message).catch(() => null);
    if (!url) {
      await send(chatId, needImagePrompt(message, "Send a photo, or tap Done / Skip."), cancelKbd());
      return true;
    }
    const nextRefs = [...(flow.referencePhotos || []), url].slice(0, maxR);
    setFlow(chatId, { ...flow, referencePhotos: nextRefs });
    await send(
      chatId,
      `Saved ${nextRefs.length}/${maxR} reference(s). Send more, **Done**, or **Skip**.`,
      { keyboard: [["Done", "Skip"], ["Cancel"]], resize_keyboard: true, one_time_keyboard: false },
    );
    return true;
  }
  if (flow.step === "gen_csimg_img") {
    const skip = t.toLowerCase() === "skip";
    const url = skip ? null : await resolveImage(message).catch(() => null);
    const eng = CSIMG_ENGINES.find((e) => e.id === flow.engine);
    if (!url && !skip && eng?.needsImg) {
      await send(chatId, needImagePrompt(message, "Send the reference image (or tap Skip):"), { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true });
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
    let refList = [...(flow.referencePhotos || [])].filter(Boolean);
    if ((flow.engine === "nano-banana-pro" || flow.engine === "seedream-v4-5-edit") && flow.modelId) {
      const model = await prisma.savedModel.findFirst({ where: { id: flow.modelId, userId }, select: { photo1Url: true, photo2Url: true, photo3Url: true } });
      if (model) {
        const mrefs = [model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean);
        const cap = flow.engine === "seedream-v4-5-edit" ? 10 : 8;
        refList = [...refList, ...mrefs].filter(Boolean).slice(0, cap);
      }
    }
    if (refList.length) body.referencePhotos = refList;
    const r = await apiCreatorStudioImage(userId, body);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const gen = Array.isArray(r.generation) ? r.generation[0] : r.generation;
    await sendGenerationResult(chatId, gen?.id || "?", gen?.status || "processing", null, "creator-studio", r.creditsUsed);
    return true;
  }

  // — Creator Studio Video —
  if (flow.step === "gen_csvid_img") {
    const skip = t.toLowerCase() === "skip";
    const url = skip ? null : await resolveImage(message).catch(() => null);
    const f = flow;
    const needsImg = ["i2v", "ref2v"].includes(f.mode) || (f.family === "seedance2" && f.mode === "multi-ref");
    if (!url && !skip && needsImg) { await send(chatId, needImagePrompt(message, "Send the image:"), cancelKbd()); return true; }
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
    if (!url) { await send(chatId, needVideoPrompt(message, "Send the video as a video message or file:"), cancelKbd()); return true; }
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
    if (!url) { await send(chatId, needImagePrompt(message, "Send the first frame image:"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, imageUrl: url, step: "gen_csvid_seedance_last" });
    await send(chatId, "✅ First frame received.\n\nNow send the LAST frame image:", cancelKbd()); return true;
  }
  if (flow.step === "gen_csvid_seedance_last") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the last frame image:"), cancelKbd()); return true; }
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

  // — Quick Video —
  if (flow.step === "gen_quickvid_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the image (start frame) as a photo or file:"), cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_quickvid_prompt", imageUrl: url });
    await send(chatId, "✅ Image received. Enter a prompt (or send Skip):", { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true }); return true;
  }
  if (flow.step === "gen_quickvid_prompt") {
    const prompt = t.toLowerCase() === "skip" ? "" : t;
    setFlow(chatId, { ...flow, step: "gen_quickvid_dur", prompt });
    await send(chatId, "Choose duration:", durationKbd5_10("gen:quickvid:dur")); return true;
  }

  // — Full Recreation —
  if (flow.step === "gen_fullrec_screenshot") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send a screenshot (frame from the target video) as a photo or image file:"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_fullrec_video", screenshotUrl: url });
    await send(chatId, "✅ Screenshot received. Now send the reference video:", cancelKbd()); return true;
  }
  if (flow.step === "gen_fullrec_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, needVideoPrompt(message, "Send the reference video as a video message or video file:"), cancelKbd()); return true; }
    await setFlowNow(chatId, { ...flow, step: "gen_fullrec_prompt", videoUrl: url });
    await send(chatId, "✅ Video received. Enter a prompt (describe the output), or skip:", { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true }); return true;
  }
  if (flow.step === "gen_fullrec_prompt") {
    const prompt = t.toLowerCase() === "skip" ? "" : t;
    setFlow(chatId, { ...flow, step: "gen_fullrec_dur", prompt });
    await send(chatId, "Choose video duration:", durationKbd5_10("gen:fullrec:dur")); return true;
  }

  // — Frame Extractor —
  if (flow.step === "gen_extract_video") {
    const url = await resolveVideo(message).catch(() => null);
    if (!url) { await send(chatId, needVideoPrompt(message, "Send the reference video as a video message or file:"), cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Extracting frames (free)...", null);
    const r = await apiExtractFrames(userId, url);
    if (!r.ok) { await send(chatId, `❌ Frame extraction failed: ${r.message}`); return true; }
    const frames = Array.isArray(r.frames) ? r.frames : [];
    await send(chatId, `✅ ${frames.length} frame(s) extracted.\n\nFrame previews sent below. Re-upload any of these into Motion Transfer, Pipeline Prep, or Quick Video.`, inlineKbd([
      [{ text: "🎬 Motion transfer", callback_data: "gen:motion" }, { text: "🎞 Pipeline prep", callback_data: "gen:pipeline" }],
      [{ text: "🎬 More", callback_data: "nav:generate" }],
    ]));
    for (const f of frames.slice(0, 3)) {
      const u = f?.url || f?.imageUrl || "";
      if (isHttpUrl(u)) await sendImg(chatId, u, {}).catch(() => {});
    }
    return true;
  }

  // — Pipeline Prep —
  if (flow.step === "gen_pipeline_frame") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the frame image as a photo or image file:"), cancelKbd()); return true; }
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
    if (!url) { await send(chatId, needVideoPrompt(message, "Send the reference motion video:"), cancelKbd()); return true; }
    const tgDur = telegramVideoDurationSeconds(message);
    clearFlow(chatId);
    await send(chatId, "⏳ Generating final video (length from your clip)...", null);
    const r = await apiCompleteVideo(userId, {
      modelId: flow.modelId,
      selectedImageUrl: flow.selectedImageUrl,
      referenceVideoUrl: url,
      ...(tgDur != null ? { videoDuration: tgDur } : {}),
      prompt: flow.prompt || "",
      recreateEngine: "kling",
      useUltra: false,
    });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "video", r.creditsUsed);
    return true;
  }

  // — CS Asset create —
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
      const fb = isVideo
        ? needVideoPrompt(message, "Send a video file (video message or document).")
        : needImagePrompt(message, "Send an image (photo or image file).");
      await send(chatId, fb, cancelKbd());
      return true;
    }
    clearFlow(chatId);
    await send(chatId, "⏳ Creating asset...", null);
    const r = await apiCsCreateAsset(userId, url, `Asset ${Date.now()}`, isVideo ? "Video" : "Image");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, "✅ Asset saved! It will be available for Seedance multi-ref mode.", inlineKbd([[{ text: "📎 My assets", callback_data: "gen:assets" }]]));
    return true;
  }

  // — Describe Target —
  if (flow.step === "gen_describe_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, needImagePrompt(message, "Send the target image as a photo or file:"), cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Analyzing image...", null);
    const r = await apiDescribeTarget(userId, url, "", "");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `📝 Scene description:\n\n${r.description || "(empty)"}`, inlineKbd([
      [{ text: "✨ Use as prompt", callback_data: "nav:generate" }],
      [{ text: "🏠 Home", callback_data: "nav:home" }],
    ]));
    return true;
  }

  // — Enhance Prompt —
  if (flow.step === "gen_enhance_input") {
    if (t.length < 3) { await send(chatId, "Enter a prompt to enhance (3+ characters):", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "gen_enhance_mode", rawPrompt: t });
    await send(chatId, "Choose enhancement mode:", inlineKbd([
      [{ text: "Casual", callback_data: "gen:enhance:mode:casual" }, { text: "Sexy", callback_data: "gen:enhance:mode:sexy" }],
      [{ text: "NSFW", callback_data: "gen:enhance:mode:nsfw" }, { text: "Ultra-Realism", callback_data: "gen:enhance:mode:ultra-realism" }],
    ]));
    return true;
  }

  // — Advanced AI SFW —
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

// — Callback handler —
export async function handleGenerateCallback(chatId, data, callbackId = "", callbackMessage = null) {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const flow = getFlow(chatId);
  const menuEditId = callbackMessage && isGenerateFlowMenuMessage(callbackMessage) ? callbackMessage.message_id : null;

  if (data === "nav:generate") {
    await renderGenerateMenu(chatId, flow?.modelId, menuEditId);
    return true;
  }
  if (data === "gen:root:picture") {
    await editInlineMenu(chatId, menuEditId, "Choose a picture option:", generatePictureSubmenuKbd());
    return true;
  }
  if (data === "gen:root:video") {
    await editInlineMenu(chatId, menuEditId, "Choose a video option:", generateVideoSubmenuKbd());
    return true;
  }
  if (data === "gen:root:mcx") {
    await renderMcxMenu(chatId, menuEditId);
    return true;
  }
  if (data === "gen:root:cstudio") {
    await editInlineMenu(chatId, menuEditId, "Creator Studio — choose:", generateCreatorStudioSubmenuKbd());
    return true;
  }
  if (data === "gen:more") {
    await deleteCallbackMenuMessage(callbackMessage);
    await send(chatId, "More tools:", generateMoreKbd());
    return true;
  }

  if (data.startsWith("gen:refresh:")) {
    const [, , genId, page] = data.split(":");
    await refreshGeneration(chatId, userId, genId, Number(page) || 0); return true;
  }
  if (data.startsWith("gen:retry:")) {
    const [, , genId, page] = data.split(":");
    await retryGeneration(chatId, userId, genId, Number(page) || 0); return true;
  }

  // — Pick model (shared) —
  async function pickModelAndContinue(prefix, nextStep, promptText, hooks = {}) {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true, status: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No models yet. Create one first.", inlineKbd([[{ text: "🧬 Create model", callback_data: "nav:models" }]])); return; }
    if (flow?.modelId) {
      setFlow(chatId, { ...flow, step: nextStep });
      if (typeof hooks.afterPreselected === "function") {
        await hooks.afterPreselected();
        return;
      }
      await send(chatId, promptText, cancelKbd());
      return;
    }
    const rows = modelListToInlineRows(models, (m) => `${prefix}:model:${m.id}`);
    rows.push([{ text: "❌ Cancel", callback_data: "nav:generate" }]);
    await send(
      chatId,
      `🧬 Choose a model\n${models.length} saved — tap a name below.`,
      inlineKbd(rows),
    );
  }

  // — AI Photo —
  if (data === "gen:aiphoto") {
    await deleteCallbackMenuMessage(callbackMessage);
    await pickModelAndContinue("gen:aiphoto", "gen_aiphoto_mode", "", {
      afterPreselected: () => sendAiphotoModePicker(chatId),
    });
    return true;
  }
  if (data.startsWith("gen:aiphoto:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_aiphoto_mode", modelId });
    await sendAiphotoModePicker(chatId);
    return true;
  }
  if (data === "gen:aiphoto:mode:casual" || data === "gen:aiphoto:mode:sexy") {
    const f = getFlow(chatId);
    if (!f?.modelId || f.step !== "gen_aiphoto_mode") {
      await send(chatId, "Session expired — open Generate → Prompt photo again.", flowExpiredKbd());
      return true;
    }
    const casual = data.endsWith(":casual");
    setFlow(chatId, {
      ...f,
      step: "gen_aiphoto_prompt",
      promptImageMode: casual ? "casual" : "sexy",
    });
    await send(
      chatId,
      casual
        ? "Describe the shot (Casual mode)."
        : "Describe the shot (Sexy / Spicy mode).",
      cancelKbd(),
    );
    return true;
  }
  if (data === "gen:aiphoto:enhance:yes" || data === "gen:aiphoto:enhance:no") {
    const enhance = data.endsWith(":yes");
    const currentFlow = getFlow(chatId);
    if (!currentFlow?.prompt) { await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd()); return true; }
    if (enhance) {
      // Lock flow step to prevent double-submit during async enhance
      setFlow(chatId, { ...currentFlow, step: "gen_aiphoto_enhancing" });
      await send(chatId, "⏳ Enhancing prompt...", null);
      const enhanceMode = currentFlow.promptImageMode === "casual" ? "casual" : "nsfw";
      const r = await apiEnhancePrompt(userId, currentFlow.prompt, enhanceMode);
      if (r.ok) {
        setFlow(chatId, { ...currentFlow, step: "gen_aiphoto_prompt", prompt: r.enhancedPrompt });
        await send(chatId, `✨ Enhanced prompt:\n\n"${r.enhancedPrompt.slice(0, 300)}"\n\nSubmit now?`, inlineKbd([
          [{ text: "✅ Submit", callback_data: "gen:aiphoto:submit" }, { text: "Use original", callback_data: "gen:aiphoto:enhance:no" }],
        ]));
        return true;
      }
      // Enhance failed ? restore original step and fall through to direct submit
      setFlow(chatId, { ...currentFlow, step: "gen_aiphoto_prompt" });
    }
    // submit directly
    await send(chatId, "⏳ Generating AI Photo...", null);
    const f = getFlow(chatId);
    clearFlow(chatId);
    const r = await apiPromptImage(userId, f.modelId, f.prompt, apiPromptImageOptsFromFlow(f));
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "prompt-image", r.creditsUsed);
    return true;
  }
  if (data === "gen:aiphoto:submit") {
    const f = getFlow(chatId);
    if (!f) { await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating AI Photo...", null);
    const r = await apiPromptImage(userId, f.modelId, f.prompt, apiPromptImageOptsFromFlow(f));
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "prompt-image", r.creditsUsed);
    return true;
  }

  // — AI Video —
  if (data === "gen:aivideo") {
    await deleteCallbackMenuMessage(callbackMessage);
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
    if (!f?.prompt || !f?.imageUrl) { await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting AI Video...", null);
    const r = await apiPromptVideo(userId, f.imageUrl, f.prompt, [5, 10].includes(dur) ? dur : 5);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "prompt-video", r.creditsUsed);
    return true;
  }

  // — Identity Recreation —
  if (data === "gen:identity") {
    await deleteCallbackMenuMessage(callbackMessage);
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
    if (!f?.targetImageUrl) { await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd()); return true; }
    await setFlowNow(chatId, {
      ...f,
      step: "gen_identity_prompt",
      identityClothesMode: mode,
    });
    await send(
      chatId,
      "Optional — extra direction for this recreate (lighting, small tweaks, mood, etc.). Same as the app.\n\nSend a text message, or tap No extra prompt to use defaults only.",
      inlineKbd([
        [{ text: "⏭️ No extra prompt", callback_data: "gen:identity:prompt:skip" }],
        [{ text: "❌ Cancel", callback_data: "nav:generate" }],
      ]),
    );
    return true;
  }
  if (data === "gen:identity:prompt:skip") {
    const f = getFlow(chatId);
    if (f?.step !== "gen_identity_prompt" || !f?.targetImageUrl) {
      await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd());
      return true;
    }
    await submitIdentityRecreateFromTelegram(chatId, userId, f, "");
    return true;
  }

  // — Face Swap Video —
  if (data === "gen:faceswapvid") {
    await deleteCallbackMenuMessage(callbackMessage);
    
    await pickModelAndContinue("gen:faceswapvid", "gen_faceswapvid_video", "Send the source video:");
    return true;
  }
  if (data.startsWith("gen:faceswapvid:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_faceswapvid_video", modelId });
    await send(chatId, "Send the source video as a video message or file:", cancelKbd()); return true;
  }
  if (data === "gen:th:run") {
    const f = getFlow(chatId);
    if (f?.step !== "gen_th_confirm" || !f.imageUrl || !f.voiceId || !String(f.scriptText || "").trim()) {
      await send(chatId, "⏱ Session ended — tap Talking head to restart.", flowExpiredKbd());
      return true;
    }
    const script = String(f.scriptText || "").trim();
    clearFlow(chatId);
    await send(chatId, "⏳ Generating talking head video...", null);
    const r = await apiTalkingHead(userId, f.imageUrl, f.voiceId, script, "");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "talking-head", r.creditsUsed);
    return true;
  }

  // — Image Face Swap —
  if (data === "gen:faceswapimg") {
    await deleteCallbackMenuMessage(callbackMessage);
    setFlow(chatId, { step: "gen_faceswapimg_source" });
    await send(chatId, "🪪 Image face swap\n\nStep 1: Send your source face image (the face to use):", cancelKbd()); return true;
  }

  // — Talking Head —
  if (data === "gen:talkinghead") {
    await deleteCallbackMenuMessage(callbackMessage);
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

  // — Video recreate (motion transfer) —
  if (data === "gen:motion") {
    await deleteCallbackMenuMessage(callbackMessage);
    setFlow(chatId, { ...(flow || {}), step: "gen_motion_mode" });
    await send(
      chatId,
      "🎬 Video recreate\n\nChoose engine (same as the app):\n· Normal — Kling 2.6\n· Pro — Kling 3.0\n· WAN — WAN 2.2 Animate Move",
      inlineKbd([
        [{ text: "Normal · Kling 2.6", callback_data: "gen:motion:eng:normal" }, { text: "Pro · Kling 3.0", callback_data: "gen:motion:eng:pro" }],
        [{ text: "WAN · Animate move", callback_data: "gen:motion:eng:wan" }],
        [{ text: "❌ Cancel", callback_data: "nav:generate" }],
      ]),
    );
    return true;
  }
  if (data.startsWith("gen:motion:eng:")) {
    const eng = data.split(":").pop();
    const motionEngine = eng === "pro" ? "pro" : eng === "wan" ? "wan" : "normal";
    setFlow(chatId, { ...(getFlow(chatId) || {}), step: "gen_motion_image", motionEngine });
    await send(chatId, "Send the image to animate (identity / first frame):", cancelKbd());
    return true;
  }
  if (data === "gen:motion:audio:on" || data === "gen:motion:audio:off") {
    const f = getFlow(chatId);
    if (f?.step !== "gen_motion_audio" || !f.referenceVideoUrl || !f.imageUrl) {
      await send(chatId, "⏱ Session ended — tap Video → Recreate to restart.", flowExpiredKbd());
      return true;
    }
    const keepAudio = data.endsWith(":on");
    await setFlowNow(chatId, { ...f, step: "gen_motion_prompt", keepAudio });
    await send(
      chatId,
      "Optional — extra direction for this recreate.\n\nSend text, or tap No extra prompt.",
      inlineKbd([
        [{ text: "⏭️ No extra prompt", callback_data: "gen:motion:prompt:skip" }],
        [{ text: "❌ Cancel", callback_data: "nav:generate" }],
      ]),
    );
    return true;
  }
  if (data === "gen:motion:prompt:skip") {
    const f = getFlow(chatId);
    if (f?.step !== "gen_motion_prompt") {
      await send(chatId, "⏱ Session ended — tap Video → Recreate to restart.", flowExpiredKbd());
      return true;
    }
    await submitMotionRecreateFromTelegram(chatId, userId, f, "");
    return true;
  }

  // — Creator Studio Image —
  if (data === "gen:csimg") {
    await renderCsimgEngineMenu(chatId, menuEditId); return true;
  }
  if (data.startsWith("gen:csimg:eng:")) {
    await deleteCallbackMenuMessage(callbackMessage);
    const engine = data.split(":").slice(3).join(":");
    await startCsimgFlow(chatId, engine, getFlow(chatId)?.modelId || null);
    return true;
  }
  if (data.startsWith("gen:csimg:model:")) {
    const modelId = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, modelId });
    await renderCsimgEngineMenu(chatId, null); return true;
  }
  if (data.startsWith("gen:csimg:aspect:")) {
    const ar = data.split(":").slice(3).join(":").replace("_", ":");
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, aspectRatio: ar, step: "gen_csimg_numres" });
    if (f.engine === "nano-banana-pro" || f.engine === "seedream-v4-5-edit") {
      const rows = await csimgFlatTierResKeyboardRows(f.engine === "seedream-v4-5-edit" ? "seedream" : "nano");
      await send(chatId, `Aspect: ${ar}\n\nResolution (flat price — extra refs don’t add cost):`, inlineKbd(rows));
    } else {
      await send(chatId, `Aspect: ${ar}\n\nImages and resolution:`, inlineKbd(csimgNumResKeyboard()));
    }
    return true;
  }
  if (data.startsWith("gen:csimg:numres:")) {
    const parts = data.split(":");
    const numImages = Number(parts[3]) || 1;
    const resolution = parts[4] || "1K";
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, numImages, resolution, step: "gen_csimg_prompt" });
    let header = `${numImages} image(s) · ${resolution}`;
    if (f.engine === "nano-banana-pro" || f.engine === "seedream-v4-5-edit") {
      const { getGenerationPricing } = await import("../../../services/generation-pricing.service.js");
      const p = await getGenerationPricing();
      const cr = resolution === "4K"
        ? Math.ceil(
            Number(
              f.engine === "seedream-v4-5-edit"
                ? (p.creatorStudioSeedream45Edit4K ?? p.creatorStudioSeedream45Edit)
                : p.creatorStudioNanoBanana4K,
            ) || 22,
          )
        : Math.ceil(
            Number(
              f.engine === "seedream-v4-5-edit"
                ? (p.creatorStudioSeedream45Edit1K2K ?? p.creatorStudioSeedream45Edit)
                : p.creatorStudioNanoBanana1K2K,
            ) || 16,
          );
      header = `${resolution} · ${cr} cr (flat)`;
    }
    await send(chatId, `${header}\n\nEnter your prompt:`, cancelKbd());
    return true;
  }
  // Ideogram-specific speed
  if (data.startsWith("gen:csimg:speed:")) {
    const speed = data.split(":").pop();
    const f = getFlow(chatId); setFlow(chatId, { ...f, renderingSpeed: speed.toUpperCase(), step: "gen_csimg_aspect" });
    await renderCsimgAspectPicker(chatId); return true;
  }

  // — Creator Studio Video —
  if (data === "gen:csvid") {
    await renderCsvidFamilyMenu(chatId, menuEditId); return true;
  }
  if (data.startsWith("gen:csvid:fam:")) {
    const family = data.split(":").slice(3).join(":");
    await renderCsvidModeMenu(chatId, family); return true;
  }
  if (data.startsWith("gen:csvid:mode:")) {
    const parts = data.split(":");
    const family = parts[3]; const mode = parts[4];
    // VEO extend requires an existing generation's taskId ? not available from fresh flow
    if (family === "veo31" && mode === "extend") {
      await send(chatId, "🎬 VEO Extend\n\nTo extend a completed VEO video, open its detail card in History and tap Extend.", inlineKbd([
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
    // WAN 2.6 requires duration (5/10/15s) ? must ask before prompt
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
    await send(chatId, `Quality: ${q}\n\nEnter duration (3?15 seconds):`, cancelKbd()); return true;
  }
  // — Sora dedicated AR (must be "portrait" or "landscape") —
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
    await send(chatId, `Task type: ${sdt}\n\nEnter duration (4?15 seconds):`, cancelKbd()); return true;
  }

  // — Quick Video —
  if (data === "gen:quickvid") {
    await deleteCallbackMenuMessage(callbackMessage);
    setFlow(chatId, { step: "gen_quickvid_img" });
    await send(chatId, "⚡ Quick Video\n\nSend the start-frame image:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:quickvid:dur:")) {
    const dur = Number(data.split(":").pop());
    const f = getFlow(chatId);
    if (!f?.imageUrl) { await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting quick video...", null);
    const r = await apiVideoDirectly(userId, { imageUrl: f.imageUrl, prompt: f.prompt || "", duration: [5, 10].includes(dur) ? dur : 5 });
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await sendGenerationResult(chatId, r.generation?.id || "?", r.generation?.status || "processing", null, "video", r.creditsUsed);
    return true;
  }

  // — Full Recreation —
  if (data === "gen:fullrec") {
    await deleteCallbackMenuMessage(callbackMessage);
    await pickModelAndContinue("gen:fullrec", "gen_fullrec_screenshot", "Step 1: Send a screenshot (a frame from the target video):");
    return true;
  }
  if (data.startsWith("gen:fullrec:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "gen_fullrec_screenshot", modelId });
    await send(chatId, "🎬 Full recreation\n\nStep 1: Send a screenshot (a frame from the target video):", cancelKbd()); return true;
  }
  if (data.startsWith("gen:fullrec:dur:")) {
    const dur = Number(data.split(":").pop());
    const f = getFlow(chatId);
    if (!f?.screenshotUrl || !f?.videoUrl) { await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd()); return true; }
    // Load model photos for identity reference (required by complete-recreation API)
    const model = f.modelId ? await prisma.savedModel.findFirst({ where: { id: f.modelId, userId }, select: { id: true, photo1Url: true, photo2Url: true, photo3Url: true } }) : null;
    const modelPhotos = model ? [model.photo1Url, model.photo2Url, model.photo3Url].filter(Boolean) : [];
    clearFlow(chatId);
    await send(chatId, "⏳ Starting full recreation pipeline (image + video, 2 steps)...", null);
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

  // — Frame Extractor —
  if (data === "gen:extract") {
    await deleteCallbackMenuMessage(callbackMessage);
    setFlow(chatId, { step: "gen_extract_video" });
    await send(chatId, "🎞 Frame extractor (free)\n\nSend the reference video:", cancelKbd()); return true;
  }

  // — Pipeline Prep —
  if (data === "gen:pipeline") {
    await deleteCallbackMenuMessage(callbackMessage);
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

  // — Describe Target —
  if (data === "gen:describe") {
    await deleteCallbackMenuMessage(callbackMessage);
    setFlow(chatId, { step: "gen_describe_img" });
    await send(chatId, "🎯 Describe target\n\nSend the target image as a photo or file:", cancelKbd()); return true;
  }

  // — Enhance Prompt —
  if (data === "gen:enhance") {
    await deleteCallbackMenuMessage(callbackMessage);
    setFlow(chatId, { step: "gen_enhance_input" });
    await send(chatId, "✨ Enhance prompt\n\nEnter the text to enhance:", cancelKbd()); return true;
  }
  if (data.startsWith("gen:enhance:mode:")) {
    const mode = data.split(":").pop();
    const f = getFlow(chatId);
    if (!f?.rawPrompt) { await send(chatId, "⏱ Session ended — tap below to restart.", flowExpiredKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Enhancing…", null);
    const r = await apiEnhancePrompt(userId, f.rawPrompt, mode);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✨ Enhanced prompt:\n\n${r.enhancedPrompt}`, inlineKbd([
      [{ text: "✨ Use as prompt", callback_data: "nav:generate" }],
      [{ text: "🏠 Home", callback_data: "nav:home" }],
    ]));
    return true;
  }

  // — Advanced AI —
  // — CS Assets —
  if (data === "gen:assets") {
    await deleteCallbackMenuMessage(callbackMessage);
    const r = await apiCsAssetsList(userId);
    const assets = r.assets || [];
    if (!assets.length) {
      await send(chatId, "No assets saved yet.\n\nAssets are images/videos you register for use as Seedance references.", inlineKbd([
        [{ text: "➕ New asset", callback_data: "gen:assets:create" }],
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
    await send(chatId, `📎 Creator assets (${assets.length}/100)`, inlineKbd(rows));
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
    await send(chatId, "🗑 Asset removed.", inlineKbd([[{ text: "📎 Assets", callback_data: "gen:assets" }]]));
    return true;
  }
  if (data === "gen:assets:create") {
    setFlow(chatId, { step: "gen_assets_create_type" });
    await send(chatId, "Create a new CS Asset\n\nWhat type?", inlineKbd([
      [{ text: "🖼 Image upload", callback_data: "gen:assets:type:Image" }],
      [{ text: "🎬 Video upload", callback_data: "gen:assets:type:Video" }],
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
  // — Advanced AI —
  if (data === "gen:advanced") {
    await deleteCallbackMenuMessage(callbackMessage);
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

