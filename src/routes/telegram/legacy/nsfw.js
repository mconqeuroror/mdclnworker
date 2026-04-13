import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, isHttpUrl } from "./helpers.js";
import { resolveImage } from "./media.js";
import { cancelKbd, nsfwMenuKbd, nsfwModelPickerKbd, durationNsfw5_8 } from "./keyboards.js";
import { sendGenerationResult } from "./generate.js";
import { ensureAuth } from "./auth.js";
import {
  apiNsfwImage, apiNsfwVideo, apiNsfwExtendVideo, apiNsfwAdvanced, apiNsfwNudesPack,
  apiNsfwGeneratePrompt, apiNsfwPlanGeneration, apiNsfwPlanStatus,
  apiNsfwAutoSelect, apiNsfwAutoSelectStatus,
  apiNsfwTestFaceRef, apiNsfwTestFaceRefStatus,
  apiNsfwStartTraining, apiNsfwTrainingStatus, apiNsfwRegisterTrainingImage, apiNsfwTrainLora,
  apiNsfwGetLoras, apiNsfwSetActiveLora, apiNsfwDeleteLora, apiNsfwAutoAppearance,
  apiNsfwGetAppearance, apiNsfwSaveAppearance, apiNsfwGetPoses,
} from "./api.js";

async function getNsfwModels(userId) {
  return prisma.savedModel.findMany({
    where: { userId, OR: [{ isAIGenerated: true }, { nsfwOverride: true }] },
    select: { id: true, name: true, nsfwUnlocked: true, loraUrl: true, loraStatus: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

// ── Message handler ───────────────────────────────────────────
export async function handleNsfwMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("nsfw_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await send(chatId, "Cancelled.", nsfwMenuKbd()); return true; }

  if (flow.step === "nsfw_genimg_prompt") {
    if (t.length < 2) { await send(chatId, "Describe the scene:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "nsfw_genimg_qty", prompt: t });
    await send(chatId, "How many images?", inlineKbd([
      [{ text: "1 image", callback_data: "nsfw:genimg:qty:1" }, { text: "2 images", callback_data: "nsfw:genimg:qty:2" }],
    ]));
    return true;
  }

  if (flow.step === "nsfw_genvid_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url) { await send(chatId, "Send an image for the NSFW video as a photo or file:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "nsfw_genvid_prompt", imageUrl: url });
    await send(chatId, "✅ Image received. Enter your prompt:", cancelKbd()); return true;
  }
  if (flow.step === "nsfw_genvid_prompt") {
    if (t.length < 2) { await send(chatId, "Enter a prompt:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "nsfw_genvid_dur", prompt: t });
    await send(chatId, "Choose video duration:", durationNsfw5_8("nsfw:genvid:dur")); return true;
  }

  if (flow.step === "nsfw_extend_id") {
    if (t.length < 5) { await send(chatId, "Enter a valid generation ID:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "nsfw_extend_prompt", sourceGenId: t });
    await send(chatId, "Enter a continuation prompt (optional, or send Skip):", { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true }); return true;
  }
  if (flow.step === "nsfw_extend_prompt") {
    const prompt = t.toLowerCase() === "skip" ? "" : t;
    setFlow(chatId, { ...flow, step: "nsfw_extend_dur", prompt });
    await send(chatId, "Choose duration:", durationNsfw5_8("nsfw:extend:dur")); return true;
  }

  if (flow.step === "nsfw_advanced_prompt") {
    if (t.length < 2) { await send(chatId, "Enter your prompt:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating advanced NSFW...", null);
    const r = await apiNsfwAdvanced(userId, flow.modelId, t, flow.style === "seedream" ? "seedream" : "nano-banana");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const gens = r.generations || [];
    for (const g of gens) await sendGenerationResult(chatId, g.id, g.status, g.outputUrl, "nsfw", g.creditsCost);
    return true;
  }

  if (flow.step === "nsfw_plan_desc") {
    if (t.length < 3) { await send(chatId, "Describe the scene in more detail:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ AI is building your scene plan...", null);
    const r = await apiNsfwPlanGeneration(userId, flow.modelId, t);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await pollPlanGeneration(chatId, userId, r.jobId); return true;
  }

  if (flow.step === "nsfw_autoselect_desc") {
    if (t.length < 3) { await send(chatId, "Describe the desired look:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ AI is selecting chips...", null);
    const r = await apiNsfwAutoSelect(userId, flow.modelId, t);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await pollAutoSelect(chatId, userId, r.jobId); return true;
  }

  if (flow.step === "nsfw_tface_prompt") {
    if (t.length < 2) { await send(chatId, "Enter a prompt:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating face-ref test...", null);
    const r = await apiNsfwTestFaceRef(userId, flow.modelId, t);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await pollTestFaceRef(chatId, userId, r.jobId); return true;
  }

  if (flow.step === "nsfw_training_photo") {
    if (t.toLowerCase() === "done") {
      const count = flow.count || 0;
      if (count < 15) { await send(chatId, `You need at least 15 photos. You have ${count} so far. Upload ${15 - count} more, then type "done".`, cancelKbd()); return true; }
      clearFlow(chatId);
      await send(chatId, "⏳ Starting LoRA training...", null);
      const r = await apiNsfwTrainLora(userId, flow.modelId);
      if (!r.ok) { await send(chatId, `❌ Training failed to start: ${r.message}`); return true; }
      await send(chatId, `✅ LoRA training started!\nTrigger word: ${r.triggerWord || "n/a"}\n\nCheck training status from NSFW → Training.`, nsfwMenuKbd());
      return true;
    }
    const url = await resolveImage(message).catch(() => null);
    if (!url) {
      await send(chatId, `Send a photo (${flow.count || 0} uploaded so far). Type "done" when finished (min 15).`, inlineKbd([
        [{ text: "✅ Done uploading", callback_data: `nsfw:train:done:${flow.modelId}` }],
        [{ text: "Cancel", callback_data: "nav:nsfw" }],
      ]));
      return true;
    }
    const r = await apiNsfwRegisterTrainingImage(userId, flow.modelId, flow.loraId, url);
    if (!r.ok) { await send(chatId, `❌ Photo registration failed: ${r.message}. Try again.`); return true; }
    const count = (Number(flow.count) || 0) + 1;
    setFlow(chatId, { ...flow, count });
    await send(chatId, `📸 Photo ${count} uploaded.${count < 15 ? ` Need ${15 - count} more.` : ' You have enough! Type done to start training.'}`
      , count >= 15 ? inlineKbd([[{ text: "✅ Done — start training", callback_data: `nsfw:train:done:${flow.modelId}` }]]) : null);
    return true;
  }

  return false;
}

async function pollPlanGeneration(chatId, userId, jobId, attempts = 0) {
  if (!jobId || attempts > 20) { await send(chatId, "Plan generation timed out. Try again."); return; }
  const r = await apiNsfwPlanStatus(userId, jobId);
  if (!r.ok || r.status === "pending" || r.status === "processing") {
    await new Promise((res) => setTimeout(res, 3000));
    return pollPlanGeneration(chatId, userId, jobId, attempts + 1);
  }
  const prompts = r.prompts || [];
  await send(chatId, `🧠 Scene plan ready!\n\n${prompts.slice(0, 3).join("\n\n") || "No prompts generated."}`, inlineKbd([
    [{ text: "🖼 Generate Image", callback_data: "nsfw:genimg" }],
    [{ text: "✨ Advanced", callback_data: "nsfw:advanced" }],
    [{ text: "⬅️ Back", callback_data: "nav:nsfw" }],
  ]));
}

async function pollAutoSelect(chatId, userId, jobId, attempts = 0) {
  if (!jobId || attempts > 20) { await send(chatId, "Auto-select timed out. Try again."); return; }
  const r = await apiNsfwAutoSelectStatus(userId, jobId);
  if (!r.ok || r.status === "pending" || r.status === "processing") {
    await new Promise((res) => setTimeout(res, 3000));
    return pollAutoSelect(chatId, userId, jobId, attempts + 1);
  }
  const sel = r.selections;
  const text = sel && typeof sel === "object" ? Object.entries(sel).map(([k, v]) => `${k}: ${v}`).join("\n") : String(sel || "No selections.");
  await send(chatId, `🎯 Auto-selected chips:\n\n${text}`, inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:nsfw" }]]));
}

async function pollTestFaceRef(chatId, userId, jobId, attempts = 0) {
  if (!jobId || attempts > 30) { await send(chatId, "Face-ref test timed out."); return; }
  const r = await apiNsfwTestFaceRefStatus(userId, jobId);
  if (!r.ok || r.status === "pending" || r.status === "processing") {
    await new Promise((res) => setTimeout(res, 4000));
    return pollTestFaceRef(chatId, userId, jobId, attempts + 1);
  }
  if (r.imageUrl && isHttpUrl(r.imageUrl)) {
    await sendImg(chatId, r.imageUrl, { caption: "🧪 Face-ref test result" });
  } else {
    await send(chatId, "🧪 Face-ref test completed.", inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:nsfw" }]]));
  }
}

// ── Callback handler ──────────────────────────────────────────
export async function handleNsfwCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:nsfw") { await send(chatId, "🔞 NSFW Studio — Choose action:", nsfwMenuKbd()); return true; }

  // ── LoRA Manager ─────────────────────────────────────────────
  if (data === "nsfw:lora:menu") {
    const models = await prisma.savedModel.findMany({ where: { userId, OR: [{ isAIGenerated: true }, { nsfwOverride: true }] }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No NSFW-eligible models."); return true; }
    const rows = models.map((m) => [{ text: m.name, callback_data: `nsfw:lora:model:${m.id}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:nsfw" }]);
    await send(chatId, "🗂 LoRA Manager — Select model:", inlineKbd(rows)); return true;
  }
  if (data.startsWith("nsfw:lora:model:")) {
    const modelId = data.split(":").pop();
    // Store modelId in flow so child callbacks can recover it without embedding in callback_data
    setFlow(chatId, { ...(getFlow(chatId) || {}), loraModelId: modelId });
    const r = await apiNsfwGetLoras(userId, modelId);
    const loras = r.loras || [];
    if (!loras.length) {
      await send(chatId, "No LoRAs for this model.", inlineKbd([
        [{ text: "🧬 Training", callback_data: "nsfw:training" }],
        [{ text: "⬅️ Back", callback_data: "nsfw:lora:menu" }],
      ]));
      return true;
    }
    // Only loraId in callback_data (max 36+15 = 51 bytes — safe)
    const rows = loras.map((l) => [{
      text: `${l.isActive ? "✅ " : ""}${(l.name || l.id).slice(0, 20)} [${l.status}]`,
      callback_data: `nsfw:lora:view:${l.id}`,
    }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nsfw:lora:menu" }]);
    await send(chatId, `🗂 LoRAs for this model (${loras.length}):`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("nsfw:lora:view:")) {
    const loraId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.loraModelId || "";
    await send(chatId, `LoRA: ${loraId.slice(0, 12)}…`, inlineKbd([
      [{ text: "✅ Set as active", callback_data: `nsfw:lora:setact:${loraId}` }],
      [{ text: "🤖 Auto-detect appearance", callback_data: `nsfw:lora:autoapp:${loraId}` }],
      [{ text: "🗑 Delete LoRA", callback_data: `nsfw:lora:delete:${loraId}` }],
      [{ text: "⬅️ Back", callback_data: `nsfw:lora:model:${modelId}` }],
    ]));
    return true;
  }
  if (data.startsWith("nsfw:lora:setact:")) {
    const loraId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.loraModelId || "";
    const r = await apiNsfwSetActiveLora(userId, modelId, loraId);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, "✅ Active LoRA updated.", inlineKbd([[{ text: "⬅️ Back", callback_data: `nsfw:lora:model:${modelId}` }]]));
    return true;
  }
  if (data.startsWith("nsfw:lora:autoapp:")) {
    const loraId = data.split(":").pop();
    await send(chatId, "⏳ Auto-detecting appearance...", null);
    const r = await apiNsfwAutoAppearance(userId, loraId);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const lines = Object.entries(r.appearance || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
    await send(chatId, `✅ Appearance auto-detected:\n\n${lines || "(nothing detected)"}`, inlineKbd([[{ text: "⬅️ Back", callback_data: "nsfw:lora:menu" }]]));
    return true;
  }
  // confirm MUST be before the generic delete: check
  if (data.startsWith("nsfw:lora:del:ok:")) {
    const loraId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.loraModelId || "";
    const r = await apiNsfwDeleteLora(userId, loraId);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, "✅ LoRA deleted.", inlineKbd([[{ text: "⬅️ Back", callback_data: `nsfw:lora:model:${modelId}` }]]));
    return true;
  }
  if (data.startsWith("nsfw:lora:delete:")) {
    const loraId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.loraModelId || "";
    await send(chatId, "Delete this LoRA permanently?", inlineKbd([
      [{ text: "🗑 Yes", callback_data: `nsfw:lora:del:ok:${loraId}` }],
      [{ text: "Cancel", callback_data: `nsfw:lora:model:${modelId}` }],
    ]));
    return true;
  }

  // ── NSFW Appearances ─────────────────────────────────────────
  if (data === "nsfw:appearance:menu") {
    const models = await prisma.savedModel.findMany({ where: { userId, OR: [{ isAIGenerated: true }, { nsfwOverride: true }] }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No NSFW-eligible models."); return true; }
    const rows = models.map((m) => [{ text: m.name, callback_data: `nsfw:appearance:model:${m.id}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:nsfw" }]);
    await send(chatId, "💾 NSFW Appearances — Select model:", inlineKbd(rows)); return true;
  }
  if (data.startsWith("nsfw:appearance:model:")) {
    const modelId = data.split(":").pop();
    const r = await apiNsfwGetAppearance(userId, modelId);
    const app = r.appearance;
    const text = app
      ? Object.entries(app).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") || "(empty)"
      : "No appearance saved yet.";
    await send(chatId, `💾 NSFW Appearance for this model:\n\n${text}`, inlineKbd([
      [{ text: "🧬 Auto-detect from model LoRA", callback_data: `nsfw:appearance:auto:${modelId}` }],
      [{ text: "⬅️ Back", callback_data: "nsfw:appearance:menu" }],
    ]));
    return true;
  }
  if (data.startsWith("nsfw:appearance:auto:")) {
    const modelId = data.split(":").pop();
    const loras = await apiNsfwGetLoras(userId, modelId);
    const activeLora = (loras.loras || []).find((l) => l.isActive) || loras.loras?.[0];
    if (!activeLora) { await send(chatId, "No LoRA found for this model. Train one first."); return true; }
    await send(chatId, "⏳ Auto-detecting appearance from LoRA...", null);
    const r = await apiNsfwAutoAppearance(userId, activeLora.id);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const app = r.appearance || {};
    await apiNsfwSaveAppearance(userId, modelId, app);
    const lines = Object.entries(app).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
    await send(chatId, `✅ Appearance saved:\n\n${lines || "(nothing detected)"}`, inlineKbd([[{ text: "⬅️ Back", callback_data: `nsfw:appearance:model:${modelId}` }]]));
    return true;
  }

  const nsfwModels = await getNsfwModels(userId);
  if (!nsfwModels.length && !data.startsWith("nsfw:train")) {
    await send(chatId, "⚠️ No NSFW-eligible models found. NSFW requires an AI-generated or admin-unlocked model.", inlineKbd([
      [{ text: "🧬 View models", callback_data: "nav:models" }],
      [{ text: "⬅️ Back", callback_data: "nav:nsfw" }],
    ]));
    return true;
  }

  if (data === "nsfw:genimg") {
    await send(chatId, "🖼 NSFW Image\n\nSelect model:", nsfwModelPickerKbd(nsfwModels, "nsfw:genimg:model")); return true;
  }
  if (data.startsWith("nsfw:genimg:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "nsfw_genimg_prompt", modelId });
    await send(chatId, "Enter your prompt:", cancelKbd()); return true;
  }
  if (data.startsWith("nsfw:genimg:qty:")) {
    const qty = Number(data.split(":").pop()) || 1;
    const flow = getFlow(chatId);
    if (!flow?.prompt) return true;
    clearFlow(chatId);
    await send(chatId, "⏳ Generating NSFW image...", null);
    const r = await apiNsfwImage(userId, flow.modelId, flow.prompt, qty);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    for (const g of r.generations || []) await sendGenerationResult(chatId, g.id, g.status, g.outputUrl, "nsfw", g.creditsCost);
    return true;
  }

  if (data === "nsfw:genvid") {
    await send(chatId, "🎬 NSFW Video\n\nSelect model:", nsfwModelPickerKbd(nsfwModels, "nsfw:genvid:model")); return true;
  }
  if (data.startsWith("nsfw:genvid:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "nsfw_genvid_img", modelId });
    await send(chatId, "Upload an image for the video:", cancelKbd()); return true;
  }
  if (data.startsWith("nsfw:genvid:dur:")) {
    const dur = Number(data.split(":").pop());
    const flow = getFlow(chatId);
    if (!flow?.imageUrl) return true;
    clearFlow(chatId);
    await send(chatId, "⏳ Starting NSFW video...", null);
    const r = await apiNsfwVideo(userId, flow.modelId, flow.imageUrl, flow.prompt || "", dur === 8 ? 8 : 5);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✅ NSFW video started.\nID: ${r.generationId}\nCredits: ${r.creditsUsed ?? "n/a"}`, inlineKbd([
      [{ text: "🔄 Check status", callback_data: `gen:refresh:${r.generationId}:0` }],
      [{ text: "⬅️ Back", callback_data: "nav:nsfw" }],
    ]));
    return true;
  }

  if (data === "nsfw:extend") {
    setFlow(chatId, { step: "nsfw_extend_id" });
    await send(chatId, "⏩ Extend NSFW Video\n\nPaste the completed NSFW video Generation ID (from History):", cancelKbd()); return true;
  }
  if (data.startsWith("nsfw:extend:dur:")) {
    const dur = Number(data.split(":").pop());
    const flow = getFlow(chatId);
    if (!flow?.sourceGenId) return true;
    clearFlow(chatId);
    await send(chatId, "⏳ Extending video...", null);
    const r = await apiNsfwExtendVideo(userId, flow.sourceGenId, dur === 8 ? 8 : 5, flow.prompt || "");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✅ NSFW video extended!\nID: ${r.generationId}\nDuration: ${r.extendDuration ?? dur}s`, inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:nsfw" }]]));
    return true;
  }

  if (data === "nsfw:advanced") {
    await send(chatId, "✨ Advanced NSFW\n\nSelect model:", nsfwModelPickerKbd(nsfwModels, "nsfw:advanced:model")); return true;
  }
  if (data.startsWith("nsfw:advanced:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "nsfw_advanced_style", modelId });
    await send(chatId, "Select style:", inlineKbd([
      [{ text: "🔥 Standard · 30 credits", callback_data: "nsfw:advanced:style:standard" }],
      [{ text: "✨ Seedream · 20 credits", callback_data: "nsfw:advanced:style:seedream" }],
    ]));
    return true;
  }
  if (data.startsWith("nsfw:advanced:style:")) {
    const style = data.split(":").pop();
    const flow = getFlow(chatId);
    setFlow(chatId, { ...flow, step: "nsfw_advanced_prompt", style });
    await send(chatId, "Enter your prompt:", cancelKbd()); return true;
  }

  if (data === "nsfw:nudes") {
    await send(chatId, "💄 Nudes Pack\n\nSelect model:", nsfwModelPickerKbd(nsfwModels, "nsfw:nudes:model")); return true;
  }
  if (data.startsWith("nsfw:nudes:model:")) {
    const modelId = data.split(":").pop();
    const poses = await getNsfwPoses(userId);
    if (!poses.length) { await send(chatId, "No poses available for this model."); return true; }
    // Store modelId in flow so pose callbacks only need poseId (avoids dual-UUID >64 bytes)
    setFlow(chatId, { step: "nsfw_nudes_poses", modelId, selectedPoses: [] });
    const rows = poses.map((p) => [{ text: p.label || p.id, callback_data: `nsfw:pose:${p.id}` }]);
    rows.push([{ text: "✅ Generate now", callback_data: "nsfw:nudes:go" }]);
    rows.push([{ text: "Cancel", callback_data: "nav:nsfw" }]);
    await send(chatId, "Select poses (tap multiple):", inlineKbd(rows)); return true;
  }
  if (data.startsWith("nsfw:pose:")) {
    const poseId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.modelId || "";
    const selected = [...(flow?.selectedPoses || [])];
    const idx = selected.indexOf(poseId);
    if (idx === -1) selected.push(poseId); else selected.splice(idx, 1);
    setFlow(chatId, { ...flow, selectedPoses: selected });
    await send(chatId, `${selected.length} pose(s) selected.`, inlineKbd([
      [{ text: `✅ Generate (${selected.length})`, callback_data: "nsfw:nudes:go" }],
      [{ text: "Back to poses", callback_data: `nsfw:nudes:model:${modelId}` }],
    ]));
    return true;
  }
  if (data === "nsfw:nudes:go") {
    const flow = getFlow(chatId);
    const { modelId } = flow || {};
    if (!modelId) { await send(chatId, "Session expired. Start from NSFW → Nudes Pack.", nsfwMenuKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating nudes pack...", null);
    const r = await apiNsfwNudesPack(userId, modelId, flow?.selectedPoses || []);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    for (const g of r.generations || []) await sendGenerationResult(chatId, g.id, g.status, g.outputUrl, "nsfw", g.creditsCost);
    return true;
  }

  if (data === "nsfw:prompt") {
    await send(chatId, "🤖 AI Prompt Helper\n\nSelect model:", nsfwModelPickerKbd(nsfwModels, "nsfw:prompt:model")); return true;
  }
  if (data.startsWith("nsfw:prompt:model:")) {
    const modelId = data.split(":").pop();
    await send(chatId, "⏳ Generating prompt...", null);
    const r = await apiNsfwGeneratePrompt(userId, modelId);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `🤖 Generated prompt:\n\n${r.prompt}`, inlineKbd([
      [{ text: "🖼 Use for image gen", callback_data: "nsfw:genimg" }],
      [{ text: "✨ Use for advanced", callback_data: "nsfw:advanced" }],
      [{ text: "⬅️ Back", callback_data: "nav:nsfw" }],
    ]));
    return true;
  }

  if (data === "nsfw:plan") {
    await send(chatId, "🧠 Plan Generation\n\nSelect model:", nsfwModelPickerKbd(nsfwModels, "nsfw:plan:model")); return true;
  }
  if (data.startsWith("nsfw:plan:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "nsfw_plan_desc", modelId });
    await send(chatId, "Describe the scene in plain language:", cancelKbd()); return true;
  }

  if (data === "nsfw:autoselect") {
    await send(chatId, "🎯 Auto-Select Chips\n\nSelect model:", nsfwModelPickerKbd(nsfwModels, "nsfw:autoselect:model")); return true;
  }
  if (data.startsWith("nsfw:autoselect:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "nsfw_autoselect_desc", modelId });
    await send(chatId, "Describe the desired look in plain language:", cancelKbd()); return true;
  }

  if (data === "nsfw:tface") {
    const loraModels = nsfwModels.filter((m) => m.loraUrl);
    if (!loraModels.length) {
      await send(chatId, "No LoRA-trained models found. Train a model first in NSFW Training.", inlineKbd([[{ text: "🧬 Training", callback_data: "nsfw:training" }]]));
      return true;
    }
    const rows = loraModels.map((m) => [{ text: m.name, callback_data: `nsfw:tface:model:${m.id}` }]);
    rows.push([{ text: "Cancel", callback_data: "nav:nsfw" }]);
    await send(chatId, "🧪 Test Face-Ref (LoRA)\n\nSelect a model with trained LoRA:", inlineKbd(rows)); return true;
  }
  if (data.startsWith("nsfw:tface:model:")) {
    const modelId = data.split(":").pop();
    const model = nsfwModels.find((m) => m.id === modelId);
    setFlow(chatId, { step: "nsfw_tface_prompt", modelId, loraUrl: model?.loraUrl || "" });
    await send(chatId, "Enter your prompt:", cancelKbd()); return true;
  }

  if (data === "nsfw:training") {
    const allModels = await prisma.savedModel.findMany({ where: { userId, OR: [{ isAIGenerated: true }, { nsfwOverride: true }] }, select: { id: true, name: true, loraStatus: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!allModels.length) { await send(chatId, "No AI-generated models found. NSFW training requires an AI-generated model.", inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:nsfw" }]])); return true; }
    const rows = allModels.map((m) => [{ text: `${m.name} [LoRA: ${m.loraStatus || "none"}]`, callback_data: `nsfw:train:model:${m.id}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:nsfw" }]);
    await send(chatId, "🧬 NSFW Training\n\nSelect model:", inlineKbd(rows)); return true;
  }
  if (data.startsWith("nsfw:train:model:")) {
    const modelId = data.split(":").pop();
    const status = await apiNsfwTrainingStatus(userId, modelId);
    const rows = [];
    if (!status.ok || status.status === "none" || !status.status) {
      rows.push([{ text: "🚀 Start Training Session · 750 credits", callback_data: `nsfw:train:start:${modelId}` }]);
    }
    rows.push([{ text: "🔄 Refresh status", callback_data: `nsfw:train:model:${modelId}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nsfw:training" }]);
    if (status.ok && status.status === "completed") {
      rows.unshift([{ text: "🎯 Train LoRA now", callback_data: `nsfw:train:lora:${modelId}` }]);
    }
    await send(chatId, `🧬 Training Status\nModel: ...\nStatus: ${status.status || "none"}\nLoRA: ${status.loraStatus || "none"}`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("nsfw:train:start:")) {
    const modelId = data.split(":").pop();
    await send(chatId, "⏳ Initializing training session...", null);
    // initialize-training creates a TrainedLora record and sets model.activeLoraId
    const { apiNsfwInitTraining } = await import("./api.js");
    const r = await apiNsfwInitTraining(userId, modelId);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const loraId = r.loraId || null;
    await send(chatId, `✅ Training session ready!\n\nNow upload at least 15 training photos — one per message.\nType "done" when finished.`, cancelKbd());
    setFlow(chatId, { step: "nsfw_training_photo", modelId, loraId, count: 0 }); return true;
  }
  if (data.startsWith("nsfw:train:lora:")) {
    const modelId = data.split(":").pop();
    const flow = getFlow(chatId);
    const loraId = flow?.loraId || null;
    clearFlow(chatId);
    await send(chatId, "⏳ Starting LoRA training...", null);
    const r = await apiNsfwTrainLora(userId, modelId, loraId);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✅ LoRA training started!\nTrigger word: ${r.triggerWord || "n/a"}`, inlineKbd([[{ text: "⬅️ Back to training", callback_data: "nsfw:training" }]]));
    return true;
  }
  if (data.startsWith("nsfw:train:done:")) {
    const modelId = data.split(":").pop();
    const flow = getFlow(chatId);
    const loraId = flow?.loraId || null;
    if (!flow?.count || flow.count < 15) { await send(chatId, `Need at least 15 photos. You have ${flow?.count || 0}.`); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting LoRA training...", null);
    const r = await apiNsfwTrainLora(userId, modelId, loraId);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✅ LoRA training started!\nTrigger word: ${r.triggerWord || "n/a"}`, nsfwMenuKbd());
    return true;
  }

  return false;
}

async function getNsfwPoses(userId) {
  try {
    const r = await apiNsfwGetPoses(userId);
    return Array.isArray(r?.poses) ? r.poses : [];
  } catch { return []; }
}
