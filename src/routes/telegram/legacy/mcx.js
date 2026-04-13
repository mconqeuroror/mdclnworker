/**
 * ModelClone-X (MCX) — full chat flow
 * Two modes:
 *   - Free style: just prompt + params (no model LoRA)
 *   - With character: model → character LoRA → prompt + params
 * Character management: list, create, upload training images, train, status
 */
import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, isHttpUrl, formatDate } from "./helpers.js";
import { resolveImage } from "./media.js";
import { cancelKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import {
  apiMcxGenerate, apiMcxStatus, apiMcxConfig,
  apiMcxGetCharacters, apiMcxCreateCharacter,
  apiMcxRegisterTrainingImage, apiMcxStartTraining, apiMcxTrainingStatus, apiMcxDeleteCharacter,
} from "./api.js";
import { uploadBufferToR2 } from "../../../utils/r2.js";

const MCX_ASPECT_RATIOS = ["1:1", "9:16", "16:9", "4:5", "5:4", "3:4", "4:3"];

function mcxMenuKbd() {
  return inlineKbd([
    [{ text: "🎨 Free Style (no model)", callback_data: "mcx:start:free" }],
    [{ text: "🧬 With Character (LoRA)", callback_data: "mcx:start:model" }],
    [{ text: "🗂 Manage Characters", callback_data: "mcx:characters:menu" }],
    [{ text: "⬅️ Back", callback_data: "nav:home" }],
  ]);
}

export async function renderMcxMenu(chatId) {
  await send(chatId, "🎨 ModelClone-X\n\nGenerate high-quality images with ComfyUI + optional trained character LoRA.", mcxMenuKbd());
}

// ── Poll MCX generation status ────────────────────────────────
export async function pollMcxGeneration(chatId, userId, generationId, attempts = 0) {
  if (attempts > 40) {
    await send(chatId, `⏱ MCX is taking a long time.\nGeneration ID: ${generationId}\n\nCheck History for the result.`, inlineKbd([
      [{ text: "🕘 History", callback_data: "nav:history" }],
    ]));
    return;
  }
  const r = await apiMcxStatus(userId, generationId);
  if (!r.ok) {
    await send(chatId, `❌ MCX status error: ${r.message}`);
    return;
  }
  if (r.status === "processing" || r.status === "pending") {
    await new Promise((res) => setTimeout(res, 4000));
    return pollMcxGeneration(chatId, userId, generationId, attempts + 1);
  }
  if (r.status === "failed") {
    await send(chatId, `❌ MCX generation failed: ${r.error || "unknown error"}`, inlineKbd([
      [{ text: "♻️ Try again", callback_data: "nav:mcx" }],
      [{ text: "⬅️ Back", callback_data: "nav:home" }],
    ]));
    return;
  }
  if (r.imageUrl && isHttpUrl(r.imageUrl)) {
    await sendImg(chatId, r.imageUrl, {
      caption: "✅ MCX Generation complete!",
      replyMarkup: inlineKbd([
        [{ text: "🎨 Generate more", callback_data: "nav:mcx" }],
        [{ text: "🕘 History", callback_data: "nav:history" }],
      ]),
    });
  } else {
    await send(chatId, "✅ MCX Generation complete!", inlineKbd([
      [{ text: "🎨 Generate more", callback_data: "nav:mcx" }],
      [{ text: "🕘 History", callback_data: "nav:history" }],
    ]));
  }
}

async function submitMcxAndPoll(chatId, userId, payload) {
  await send(chatId, "⏳ Submitting to ModelClone-X...", null);
  const r = await apiMcxGenerate(userId, payload);
  if (!r.ok) {
    await send(chatId, `❌ MCX failed to start: ${r.message}`, inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:mcx" }]]));
    return;
  }
  const ids = r.generationIds || [];
  if (!ids.length) {
    await send(chatId, "❌ No generation IDs returned.", inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:mcx" }]]));
    return;
  }
  await send(chatId, `✅ ${ids.length} job(s) submitted!\n${ids.map((id, i) => `#${i + 1}: ${id}`).join("\n")}\n\nPolling for results...`, null);
  for (const id of ids) {
    await pollMcxGeneration(chatId, userId, id);
  }
}

// ── Build the final generate + review step ────────────────────
async function renderMcxReview(chatId, flow) {
  const withModel = Boolean(flow.modelId && flow.characterLoraId);
  const text =
    `🎨 ModelClone-X — Ready to Generate\n\n` +
    `Mode: ${withModel ? "With character LoRA" : "Free style"}\n` +
    `Aspect: ${flow.aspectRatio || "1:1"}\n` +
    `Qty: ${flow.qty || 1} image(s)\n` +
    `Steps: ${flow.steps || (withModel ? 50 : 20)}\n` +
    `CFG: ${flow.cfg || 2}\n` +
    `Prompt: "${(flow.prompt || "").slice(0, 200)}"`;
  await send(chatId, text, inlineKbd([
    [{ text: "✅ Generate!", callback_data: "mcx:submit" }],
    [{ text: "✏️ Change prompt", callback_data: "mcx:edit:prompt" }],
    [{ text: "📐 Change aspect", callback_data: "mcx:edit:aspect" }],
    [{ text: "🔢 Change qty/steps", callback_data: "mcx:edit:advanced" }],
    [{ text: "Cancel", callback_data: "nav:mcx" }],
  ]));
}

// ── Message handler ───────────────────────────────────────────
export async function handleMcxMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("mcx_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await renderMcxMenu(chatId); return true; }

  if (flow.step === "mcx_prompt") {
    if (t.length < 3) { await send(chatId, "Enter a prompt (3+ characters):", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "mcx_review", prompt: t });
    await renderMcxReview(chatId, { ...flow, prompt: t });
    return true;
  }

  if (flow.step === "mcx_edit_prompt") {
    if (t.length < 3) { await send(chatId, "Enter new prompt:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "mcx_review", prompt: t });
    await renderMcxReview(chatId, { ...flow, prompt: t });
    return true;
  }

  if (flow.step === "mcx_steps_cfg") {
    const parts = t.split(/\s+/);
    const steps = Number.parseInt(parts[0], 10);
    const cfg = parts[1] ? Number.parseFloat(parts[1]) : flow.cfg || 2;
    if (!Number.isFinite(steps) || steps < 1 || steps > 100) {
      await send(chatId, "Enter steps (1–100) optionally followed by CFG (0–6), e.g. '30 3':", cancelKbd());
      return true;
    }
    const safeCfg = Math.max(0, Math.min(6, Number.isFinite(cfg) ? cfg : 2));
    setFlow(chatId, { ...flow, step: "mcx_review", steps, cfg: safeCfg });
    await renderMcxReview(chatId, { ...flow, steps, cfg: safeCfg });
    return true;
  }

  if (flow.step === "mcx_char_name") {
    if (t.length < 2 || t.length > 60) { await send(chatId, "Name must be 2–60 characters:", cancelKbd()); return true; }
    const { modelId: charModelId, trainingMode } = flow;
    // Lock to prevent double-create on rapid re-send
    setFlow(chatId, { ...flow, step: "mcx_char_creating" });
    await send(chatId, "⏳ Creating character identity...", null);
    const r = await apiMcxCreateCharacter(userId, charModelId, t, trainingMode || "standard");
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`, inlineKbd([[{ text: "⬅️ Back", callback_data: "mcx:characters:menu" }]])); return true; }
    setFlow(chatId, { step: "mcx_train_upload", modelId: charModelId, loraId: r.lora.id, loraName: t, count: 0 });
    await send(chatId, `✅ Character "${t}" created!\n\nNow upload training photos (minimum 15) — one per message.\n\nType "done" when finished.`, cancelKbd());
    return true;
  }

  if (flow.step === "mcx_train_upload") {
    if (t.toLowerCase() === "done") {
      if ((flow.count || 0) < 15) {
        await send(chatId, `Need at least 15 photos. You have ${flow.count || 0}. Keep uploading:`, cancelKbd());
        return true;
      }
      clearFlow(chatId);
      await send(chatId, "⏳ Starting LoRA training...", null);
      const r = await apiMcxStartTraining(userId, flow.loraId, flow.modelId, flow.trainingMode || "standard");
      if (!r.ok) { await send(chatId, `❌ Training failed to start: ${r.message}`); return true; }
      await send(chatId, `✅ Training started!\nTrigger word: ${r.triggerWord || "n/a"}\nCredits: ${r.creditsUsed ?? "n/a"}\n\nCheck training status from Manage Characters.`, mcxMenuKbd());
      return true;
    }
    const url = await resolveImage(message).catch(() => null);
    if (!url) {
      await send(chatId, `Send a photo (${flow.count || 0} uploaded). Type "done" when you have 15+.`, inlineKbd([
        [{ text: "✅ Done uploading", callback_data: `mcx:train:done:${flow.loraId}` }],
        [{ text: "Cancel", callback_data: "nav:mcx" }],
      ]));
      return true;
    }
    const r = await apiMcxRegisterTrainingImage(userId, flow.modelId, flow.loraId, url);
    if (!r.ok) { await send(chatId, `❌ Photo failed: ${r.message}. Try again.`); return true; }
    const count = (Number(flow.count) || 0) + 1;
    setFlow(chatId, { ...flow, count });
    await send(chatId, `📸 Photo ${count} uploaded.${count < 15 ? ` Need ${15 - count} more.` : " You have enough! Type done to start training."}`,
      count >= 15 ? inlineKbd([[{ text: "✅ Done — start training", callback_data: `mcx:train:done:${flow.loraId}` }]]) : null);
    return true;
  }

  return false;
}

// ── Callback handler ──────────────────────────────────────────
export async function handleMcxCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:mcx") { await renderMcxMenu(chatId); return true; }

  // ── Start free style ─────────────────────────────────────────
  if (data === "mcx:start:free") {
    setFlow(chatId, { step: "mcx_aspect", modelId: null, characterLoraId: null, qty: 1, cfg: 2 });
    await send(chatId, "🎨 Free Style\n\nStep 1: Choose aspect ratio:", inlineKbd([
      ...MCX_ASPECT_RATIOS.map((ar) => [{ text: ar, callback_data: `mcx:aspect:${ar.replace(":", "_")}` }]),
      [{ text: "Cancel", callback_data: "nav:mcx" }],
    ]));
    return true;
  }

  // ── Start with model ─────────────────────────────────────────
  if (data === "mcx:start:model") {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No models yet. Create one first.", inlineKbd([[{ text: "🧬 Models", callback_data: "nav:models" }]])); return true; }
    const rows = models.map((m) => [{ text: m.name, callback_data: `mcx:model:${m.id}` }]);
    rows.push([{ text: "Cancel", callback_data: "nav:mcx" }]);
    await send(chatId, "🧬 Select model:", inlineKbd(rows)); return true;
  }
  if (data.startsWith("mcx:model:")) {
    const modelId = data.split(":").pop();
    // Store modelId in flow so child callbacks don't need dual IDs
    setFlow(chatId, { ...(getFlow(chatId) || {}), mcxModelId: modelId });
    const chars = await apiMcxGetCharacters(userId, modelId);
    const ready = (chars.characters || []).filter((c) => c.status === "ready" || c.status === "completed");
    const training = (chars.characters || []).filter((c) => ["training", "awaiting_images", "queued"].includes(c.status));
    // "mcx:char:use:" = 13 + 36 = 49 bytes — safe
    const rows = ready.map((c) => [{ text: `✅ ${c.name} (${c.triggerWord || c.id.slice(0, 8)})`, callback_data: `mcx:char:use:${c.id}` }]);
    training.forEach((c) => rows.push([{ text: `⏳ ${c.name} (training)`, callback_data: `mcx:char:status:${c.id}` }]));
    rows.push([{ text: "➕ Create new character", callback_data: `mcx:char:create:${modelId}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: "mcx:start:model" }]);
    await send(chatId, `🧬 Characters for this model (${ready.length} ready, ${training.length} training):`, inlineKbd(rows));
    return true;
  }
  if (data.startsWith("mcx:char:use:")) {
    // "mcx:char:use:" = 13 + 36 = 49 bytes — safe
    const loraId = data.split(":").pop();
    const f = getFlow(chatId);
    const modelId = f?.mcxModelId || "";
    setFlow(chatId, { step: "mcx_aspect", modelId, characterLoraId: loraId, qty: 1, cfg: 2 });
    await send(chatId, "✅ Character selected.\n\nChoose aspect ratio:", inlineKbd([
      ...MCX_ASPECT_RATIOS.map((ar) => [{ text: ar, callback_data: `mcx:aspect:${ar.replace(":", "_")}` }]),
      [{ text: "Cancel", callback_data: "nav:mcx" }],
    ]));
    return true;
  }
  if (data.startsWith("mcx:char:status:")) {
    const loraId = data.split(":").pop();
    const r = await apiMcxTrainingStatus(userId, loraId);
    if (!r.ok) { await send(chatId, `Status error: ${r.message}`); return true; }
    const lora = r.lora;
    const imgCount = lora?.trainingImages?.length || 0;
    await send(chatId, `🎨 Character: ${lora?.name || loraId}\nStatus: ${lora?.status || "unknown"}\nTraining images: ${imgCount}\nTrigger: ${lora?.triggerWord || "n/a"}`, inlineKbd([
      [{ text: "🔄 Refresh status", callback_data: `mcx:char:status:${loraId}` }],
      [{ text: "⬅️ Back", callback_data: "nav:mcx" }],
    ]));
    return true;
  }

  // ── Aspect ratio ─────────────────────────────────────────────
  if (data.startsWith("mcx:aspect:")) {
    const ar = data.split(":").pop().replace("_", ":");
    const flow = getFlow(chatId);
    setFlow(chatId, { ...flow, step: "mcx_qty", aspectRatio: ar });
    await send(chatId, `Aspect: ${ar}\n\nHow many images?`, inlineKbd([
      [{ text: "1 image", callback_data: "mcx:qty:1" }, { text: "2 images", callback_data: "mcx:qty:2" }],
    ]));
    return true;
  }

  // ── Quantity ─────────────────────────────────────────────────
  if (data.startsWith("mcx:qty:")) {
    const qty = Number(data.split(":").pop()) === 2 ? 2 : 1;
    const flow = getFlow(chatId);
    const withModel = Boolean(flow?.modelId && flow?.characterLoraId);
    const defaultSteps = withModel ? 50 : 20;
    setFlow(chatId, { ...flow, step: "mcx_prompt", qty, steps: defaultSteps });
    await send(chatId, `Qty: ${qty}\n\nEnter your prompt:`, cancelKbd());
    return true;
  }

  // ── Review / edit ─────────────────────────────────────────────
  if (data === "mcx:edit:prompt") {
    const flow = getFlow(chatId);
    setFlow(chatId, { ...flow, step: "mcx_edit_prompt" });
    await send(chatId, "Enter new prompt:", cancelKbd()); return true;
  }
  if (data === "mcx:edit:aspect") {
    const flow = getFlow(chatId);
    setFlow(chatId, { ...flow, step: "mcx_aspect" });
    await send(chatId, "Choose aspect ratio:", inlineKbd([
      ...MCX_ASPECT_RATIOS.map((ar) => [{ text: ar, callback_data: `mcx:aspect:${ar.replace(":", "_")}` }]),
      [{ text: "Cancel", callback_data: "nav:mcx" }],
    ]));
    return true;
  }
  if (data === "mcx:edit:advanced") {
    const flow = getFlow(chatId);
    const defaultSteps = (flow?.modelId && flow?.characterLoraId) ? 50 : 20;
    setFlow(chatId, { ...flow, step: "mcx_steps_cfg" });
    await send(chatId, `Current: steps=${flow?.steps || defaultSteps}, cfg=${flow?.cfg || 2}\n\nEnter steps (1–100) and optionally CFG (0–6), e.g. "30 2.5":\n(More steps = better quality but slower)`, cancelKbd());
    return true;
  }

  // ── Submit ────────────────────────────────────────────────────
  if (data === "mcx:submit") {
    const flow = getFlow(chatId);
    if (!flow?.prompt) { await renderMcxMenu(chatId); return true; }
    const withModel = Boolean(flow.modelId && flow.characterLoraId);
    const defaultSteps = withModel ? 50 : 20;
    const payload = {
      prompt: flow.prompt,
      aspectRatio: flow.aspectRatio || "1:1",
      quantity: flow.qty || 1,
      steps: flow.steps || defaultSteps,
      cfg: flow.cfg || 2,
      ...(withModel ? { modelId: flow.modelId, characterLoraId: flow.characterLoraId, loraStrength: 0.8 } : {}),
    };
    clearFlow(chatId);
    await submitMcxAndPoll(chatId, userId, payload);
    return true;
  }

  // ── Character management ─────────────────────────────────────
  if (data === "mcx:characters:menu") {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No models yet."); return true; }
    const rows = models.map((m) => [{ text: m.name, callback_data: `mcx:chars:model:${m.id}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:mcx" }]);
    await send(chatId, "🗂 Select model to manage characters:", inlineKbd(rows)); return true;
  }
  if (data.startsWith("mcx:chars:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { ...(getFlow(chatId) || {}), mcxModelId: modelId });
    const chars = await apiMcxGetCharacters(userId, modelId);
    const all = chars.characters || [];
    const rows = all.map((c) => [{
      text: `${c.status === "ready" ? "✅" : c.status === "training" ? "⏳" : "🔧"} ${c.name} [${c.status}]`,
      callback_data: `mcx:char:status:${c.id}`,
    }]);
    rows.push([{ text: "➕ New character", callback_data: `mcx:char:create:${modelId}` }]);
    rows.push([{ text: "⬅️ Back", callback_data: "mcx:characters:menu" }]);
    await send(chatId, `🗂 Characters (${all.length})`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("mcx:char:create:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "mcx_char_name", modelId });
    await send(chatId, "Enter a name for this character identity:", cancelKbd()); return true;
  }
  if (data.startsWith("mcx:train:done:")) {
    // "mcx:train:done:" = 15 + 36 loraId = 51 bytes — safe. Use flow for modelId.
    const loraId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.mcxModelId || flow?.modelId || "";
    if (!flow?.count || flow.count < 15) {
      await send(chatId, `Need at least 15 photos. You have ${flow?.count || 0}.`); return true;
    }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting LoRA training...", null);
    const r = await apiMcxStartTraining(userId, loraId, modelId);
    if (!r.ok) { await send(chatId, `❌ Training failed: ${r.message}`); return true; }
    await send(chatId, `✅ Training started!\nTrigger word: ${r.triggerWord || "n/a"}\nCredits: ${r.creditsUsed ?? "n/a"}`, mcxMenuKbd());
    return true;
  }
  if (data.startsWith("mcx:char:delete:")) {
    const loraId = data.split(":").pop();
    await apiMcxDeleteCharacter(userId, loraId);
    await send(chatId, "✅ Character deleted.", inlineKbd([[{ text: "⬅️ Back", callback_data: "mcx:characters:menu" }]]));
    return true;
  }

  return false;
}
