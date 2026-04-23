/**
 * ModelClone-X (MCX) — full chat flow
 * Two modes:
 *   - Free style: just prompt + params (no model LoRA)
 *   - With character: model → ready trained character LoRA only (create/train in Mini App)
 * Character management in chat: list + status + delete only
 */
import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, isHttpUrl, formatDate, editInlineMenu, modelListToInlineRows } from "./helpers.js";
import { cancelKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import { MINI_APP_BASE } from "./config.js";
import {
  apiMcxGenerate, apiMcxStatus,
  apiMcxGetCharacters, apiMcxTrainingStatus, apiMcxDeleteCharacter,
} from "./api.js";

const MCX_ASPECT_RATIOS = ["1:1", "9:16", "16:9", "4:5", "5:4", "3:4", "4:3"];

function mcxAspectRatioKbd(callbackPrefix) {
  return MCX_ASPECT_RATIOS.map((ar) => [
    { text: ar, callback_data: `${callbackPrefix}:${ar.replace(":", "_")}` },
  ]);
}

function defaultMcxSteps(flow) {
  const withModel = Boolean(flow?.modelId && flow?.characterLoraId);
  return withModel ? 50 : 20;
}

/** Mini App deep link: ModelClone-X → Character tab */
function mcxMiniAppCharacterUrl() {
  const base = String(MINI_APP_BASE || "").replace(/\/$/, "");
  return `${base}/dashboard?tab=${encodeURIComponent("modelclone-x")}&modelcloneXTab=character`;
}

function mcxOpenCharacterInMiniAppKbd(backCallbackData) {
  return inlineKbd([
    [{ text: "📱 Open ModelClone-X → Character", web_app: { url: mcxMiniAppCharacterUrl() } }],
    [{ text: "⬅️ Back", callback_data: backCallbackData }],
  ]);
}

function mcxMenuKbd() {
  return inlineKbd([
    [{ text: "🎨 Free Style (no model)", callback_data: "mcx:start:free" }],
    [{ text: "🧬 With Character (LoRA)", callback_data: "mcx:start:model" }],
    [{ text: "🗂 Manage Characters", callback_data: "mcx:characters:menu" }],
    [{ text: "⬅️ Back", callback_data: "nav:home" }],
  ]);
}

export async function renderMcxMenu(chatId, editMessageId = null) {
  await editInlineMenu(
    chatId,
    editMessageId,
    "🎨 ModelClone-X\n\nGenerate high-quality images with ComfyUI + optional trained character LoRA.",
    mcxMenuKbd(),
  );
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
    `Steps: ${flow.steps || defaultMcxSteps(flow)}\n` +
    `CFG: ${flow.cfg || 2}\n` +
    `Prompt: "${(flow.prompt || "").slice(0, 200)}"`;
  await send(chatId, text, inlineKbd([
    [{ text: "✅ Generate!", callback_data: "mcx:submit" }],
    [{ text: "✏️ Change prompt", callback_data: "mcx:edit:prompt" }],
    [{ text: "📐 Change aspect", callback_data: "mcx:edit:aspect" }],
    [{ text: "🔢 Change quantity", callback_data: "mcx:edit:qty" }],
    [{ text: "⚙️ Change steps, CFG & aspect", callback_data: "mcx:edit:advanced" }],
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

  if (flow.step === "mcx_edit_steps") {
    const steps = Number.parseInt(t, 10);
    if (!Number.isFinite(steps) || steps < 1 || steps > 100) {
      await send(chatId, `Enter a whole number from 1 to 100 for steps (current: ${flow.steps || defaultMcxSteps(flow)}):`, cancelKbd());
      return true;
    }
    const next = { ...flow, step: "mcx_edit_cfg", steps };
    setFlow(chatId, next);
    await send(
      chatId,
      `Step 2 of 3 — CFG scale\n\nEnter CFG (0–6, can use decimals e.g. 2.5). Current: ${flow.cfg ?? 2}:`,
      cancelKbd(),
    );
    return true;
  }

  if (flow.step === "mcx_edit_cfg") {
    const cfg = Number.parseFloat(t.replace(",", "."));
    if (!Number.isFinite(cfg) || cfg < 0 || cfg > 6) {
      await send(chatId, `Enter CFG between 0 and 6 (current: ${flow.cfg ?? 2}):`, cancelKbd());
      return true;
    }
    const safeCfg = Math.round(cfg * 100) / 100;
    const next = { ...flow, step: "mcx_pick_aspect_wiz", cfg: safeCfg };
    setFlow(chatId, next);
    await send(
      chatId,
      `Step 3 of 3 — Aspect ratio\n\nSteps: ${next.steps ?? defaultMcxSteps(next)} · CFG: ${safeCfg}\nPick aspect:`,
      inlineKbd([...mcxAspectRatioKbd("mcx:raspect"), [{ text: "Cancel", callback_data: "nav:mcx" }]]),
    );
    return true;
  }

  if (flow.step === "mcx_pick_aspect_wiz") {
    await send(
      chatId,
      "Tap one of the aspect ratio buttons above (or run ⚙️ Change steps, CFG & aspect again).",
      inlineKbd([...mcxAspectRatioKbd("mcx:raspect"), [{ text: "Cancel", callback_data: "nav:mcx" }]]),
    );
    return true;
  }

  if (flow.step === "mcx_char_name" || flow.step === "mcx_train_upload" || flow.step === "mcx_char_creating") {
    clearFlow(chatId);
    await send(
      chatId,
      "Character creation and training are only done in the Mini App now.\n\nOpen: ModelClone-X → Character.",
      mcxOpenCharacterInMiniAppKbd("nav:mcx"),
    );
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
      ...mcxAspectRatioKbd("mcx:aspect"),
      [{ text: "Cancel", callback_data: "nav:mcx" }],
    ]));
    return true;
  }

  // ── Start with model ─────────────────────────────────────────
  if (data === "mcx:start:model") {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No models yet. Create one first.", inlineKbd([[{ text: "🧬 Models", callback_data: "nav:models" }]])); return true; }
    const rows = modelListToInlineRows(models, (m) => `mcx:model:${m.id}`);
    rows.push([{ text: "Cancel", callback_data: "nav:mcx" }]);
    await send(chatId, `🧬 Select model\n${models.length} saved — pick one:`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("mcx:model:")) {
    const modelId = data.split(":").pop();
    // Store modelId in flow so child callbacks don't need dual IDs
    setFlow(chatId, { ...(getFlow(chatId) || {}), mcxModelId: modelId });
    const chars = await apiMcxGetCharacters(userId, modelId);
    const ready = (chars.characters || []).filter((c) => c.status === "ready" || c.status === "completed");
    const training = (chars.characters || []).filter((c) => ["training", "awaiting_images", "queued"].includes(c.status));
    if (!ready.length) {
      const lines = [
        "No trained ModelClone-X character for this model yet.",
        "",
        "Create and train one in the Mini App:",
        "Dashboard → ModelClone-X → Character tab.",
      ];
      if (training.length) {
        lines.push("", `In progress: ${training.length} character(s) — tap below for status.`);
      }
      const rows = training.map((c) => [
        { text: `⏳ ${c.name} (status)`, callback_data: `mcx:char:status:${c.id}` },
      ]);
      rows.push([{ text: "📱 Open Character in Mini App", web_app: { url: mcxMiniAppCharacterUrl() } }]);
      rows.push([{ text: "⬅️ Back", callback_data: "mcx:start:model" }]);
      await send(chatId, lines.join("\n"), inlineKbd(rows));
      return true;
    }
    const rows = ready.map((c) => [
      { text: `✅ ${c.name} (${c.triggerWord || c.id.slice(0, 8)})`, callback_data: `mcx:char:use:${c.id}` },
    ]);
    training.forEach((c) => rows.push([{ text: `⏳ ${c.name} (training)`, callback_data: `mcx:char:status:${c.id}` }]));
    rows.push([{ text: "📱 New character → Mini App", web_app: { url: mcxMiniAppCharacterUrl() } }]);
    rows.push([{ text: "⬅️ Back", callback_data: "mcx:start:model" }]);
    await send(chatId, `🧬 Pick a trained character (${ready.length} ready${training.length ? `, ${training.length} still training` : ""}):`, inlineKbd(rows));
    return true;
  }
  if (data.startsWith("mcx:char:use:")) {
    // "mcx:char:use:" = 13 + 36 = 49 bytes — safe
    const loraId = data.split(":").pop();
    const f = getFlow(chatId);
    const modelId = f?.mcxModelId || "";
    setFlow(chatId, { step: "mcx_aspect", modelId, characterLoraId: loraId, qty: 1, cfg: 2 });
    await send(chatId, "✅ Character selected.\n\nChoose aspect ratio:", inlineKbd([
      ...mcxAspectRatioKbd("mcx:aspect"),
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
      [{ text: "📱 Open Character in Mini App", web_app: { url: mcxMiniAppCharacterUrl() } }],
      [{ text: "⬅️ Back", callback_data: "nav:mcx" }],
    ]));
    return true;
  }

  // ── Aspect ratio (initial flow → quantity) ───────────────────
  if (data.startsWith("mcx:aspect:")) {
    const ar = data.split(":").pop().replace("_", ":");
    const flow = getFlow(chatId);
    setFlow(chatId, { ...flow, step: "mcx_qty", aspectRatio: ar });
    await send(chatId, `Aspect: ${ar}\n\nHow many images?`, inlineKbd([
      [{ text: "1 image", callback_data: "mcx:qty:1" }, { text: "2 images", callback_data: "mcx:qty:2" }],
    ]));
    return true;
  }

  // ── Aspect ratio from review / settings wizard (back to review)
  if (data.startsWith("mcx:raspect:")) {
    const ar = data.split(":").pop().replace("_", ":");
    const flow = getFlow(chatId);
    const next = { ...flow, step: "mcx_review", aspectRatio: ar };
    setFlow(chatId, next);
    await renderMcxReview(chatId, next);
    return true;
  }

  // ── Quantity ─────────────────────────────────────────────────
  if (data.startsWith("mcx:qty:")) {
    const qty = Number(data.split(":").pop()) === 2 ? 2 : 1;
    const flow = getFlow(chatId);
    const defaultSteps = defaultMcxSteps(flow);
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
    setFlow(chatId, { ...flow, step: "mcx_review" });
    await send(chatId, "Choose aspect ratio:", inlineKbd([
      ...mcxAspectRatioKbd("mcx:raspect"),
      [{ text: "Cancel", callback_data: "nav:mcx" }],
    ]));
    return true;
  }
  if (data === "mcx:edit:qty") {
    await send(chatId, "How many images?", inlineKbd([
      [{ text: "1 image", callback_data: "mcx:rqty:1" }, { text: "2 images", callback_data: "mcx:rqty:2" }],
      [{ text: "Cancel", callback_data: "nav:mcx" }],
    ]));
    return true;
  }
  if (data.startsWith("mcx:rqty:")) {
    const qty = Number(data.split(":").pop()) === 2 ? 2 : 1;
    const flow = getFlow(chatId);
    const next = { ...flow, step: "mcx_review", qty };
    setFlow(chatId, next);
    await renderMcxReview(chatId, next);
    return true;
  }
  if (data === "mcx:edit:advanced") {
    const flow = getFlow(chatId);
    const curSteps = flow?.steps ?? defaultMcxSteps(flow);
    setFlow(chatId, { ...flow, step: "mcx_edit_steps" });
    await send(
      chatId,
      `Step 1 of 3 — Sampling steps\n\nCurrent: ${curSteps}\nEnter steps (1–100). More steps usually mean better quality but slower:`,
      cancelKbd(),
    );
    return true;
  }

  // ── Submit ────────────────────────────────────────────────────
  if (data === "mcx:submit") {
    const flow = getFlow(chatId);
    if (!flow?.prompt) { await renderMcxMenu(chatId); return true; }
    const withModel = Boolean(flow.modelId && flow.characterLoraId);
    const payload = {
      prompt: flow.prompt,
      aspectRatio: flow.aspectRatio || "1:1",
      quantity: flow.qty || 1,
      steps: flow.steps || defaultMcxSteps(flow),
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
    const rows = modelListToInlineRows(models, (m) => `mcx:chars:model:${m.id}`);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:mcx" }]);
    await send(chatId, `🗂 Manage characters\n${models.length} models — choose one:`, inlineKbd(rows)); return true;
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
    rows.push([{ text: "📱 New character → Mini App", web_app: { url: mcxMiniAppCharacterUrl() } }]);
    rows.push([{ text: "⬅️ Back", callback_data: "mcx:characters:menu" }]);
    await send(chatId, `🗂 Characters (${all.length}) — create/train new ones in the Mini App.`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("mcx:char:create:")) {
    await send(
      chatId,
      "New ModelClone-X characters are created in the Mini App only.\n\nDashboard → ModelClone-X → Character.",
      mcxOpenCharacterInMiniAppKbd("mcx:start:model"),
    );
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
