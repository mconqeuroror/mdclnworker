import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, formatDate, isHttpUrl } from "./helpers.js";
import { resolveImage } from "./media.js";
import { cancelKbd, mainKbd, modelsHomeKbd, modelPickerKbd, openAppKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import {
  apiCreateModel, apiUpdateModel, apiDeleteModel, apiAnalyzeLooks, apiNsfwRegisterTrainingImage,
  apiGenerateAiModel,
} from "./api.js";
import { LOOKS_CATEGORIES } from "./config.js";

const PAGE_SIZE = 8;

// ── Models list ───────────────────────────────────────────────
export async function renderModelsList(chatId, userId, page = 0) {
  const [models, total] = await Promise.all([
    prisma.savedModel.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: page * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, name: true, status: true, createdAt: true } }),
    prisma.savedModel.count({ where: { userId } }),
  ]);
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  const rows = models.map((m) => [{ text: `${m.name} (${m.status || "ready"})`, callback_data: `models:view:${m.id}:${page}` }]);
  const nav = [];
  if (page > 0) nav.push({ text: "⬅️ Prev", callback_data: `models:page:${page - 1}` });
  nav.push({ text: `${page + 1}/${pages}`, callback_data: "noop" });
  if ((page + 1) * PAGE_SIZE < total) nav.push({ text: "Next ➡️", callback_data: `models:page:${page + 1}` });
  if (nav.length > 1) rows.push(nav);
  rows.push([{ text: "➕ Create New Model", callback_data: "models:create" }]);
  rows.push([{ text: "⬅️ Back", callback_data: "nav:home" }]);
  await send(chatId, `🧬 Your Models (${total} total)\n\nSelect one to manage:`, inlineKbd(rows));
}

// ── Model card ────────────────────────────────────────────────
async function renderModelCard(chatId, userId, modelId, fromPage = 0) {
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: { id: true, name: true, status: true, photo1Url: true, photo2Url: true, photo3Url: true, age: true, isAIGenerated: true, nsfwOverride: true, nsfwUnlocked: true, looksUnlockedByAdmin: true, createdAt: true, savedAppearance: true },
  });
  if (!model) { await send(chatId, "Model not found.", modelsHomeKbd()); return; }
  const photos = [model.photo1Url, model.photo2Url, model.photo3Url].filter(isHttpUrl);
  const looks = model.savedAppearance && typeof model.savedAppearance === "object"
    ? Object.entries(model.savedAppearance).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).slice(0, 6).join(" · ")
    : "No looks saved";
  const text = `🧬 ${model.name}\nStatus: ${model.status || "ready"} · Age: ${model.age ?? "n/a"}\nNSFW: ${model.nsfwUnlocked ? "✅ unlocked" : "⏳ pending"}\nPhotos: ${photos.length}/3\nLooks: ${looks}`;
  const kbd = inlineKbd([
    [{ text: "🎬 Generate", callback_data: `models:gen:${modelId}:${fromPage}` }, { text: "✏️ Edit", callback_data: `models:edit:${modelId}:${fromPage}` }],
    [{ text: "🔬 Analyze Looks", callback_data: `models:analyze:${modelId}:${fromPage}` }],
    [{ text: "🗑 Delete", callback_data: `models:delete:${modelId}:${fromPage}` }],
    [{ text: "⬅️ Back to list", callback_data: `models:page:${fromPage}` }],
  ]);
  if (photos.length) {
    await sendImg(chatId, photos[0], { caption: text, replyMarkup: kbd });
  } else {
    await send(chatId, text, kbd);
  }
}

async function renderEditMenu(chatId, userId, modelId, fromPage = 0) {
  const model = await prisma.savedModel.findFirst({ where: { id: modelId, userId }, select: { id: true, name: true, age: true } });
  if (!model) { await send(chatId, "Model not found.", modelsHomeKbd()); return; }
  await send(
    chatId,
    `✏️ Editing: ${model.name}\nAge: ${model.age ?? "n/a"}`,
    inlineKbd([
      [{ text: "✏️ Rename", callback_data: `models:edit:name:${modelId}:${fromPage}` }],
      [{ text: "🎂 Set Age", callback_data: `models:edit:age:${modelId}:${fromPage}` }],
      [{ text: "🎨 Edit Looks", callback_data: `models:edit:looks:${modelId}:${fromPage}` }],
      [{ text: "📷 Swap Photo 1", callback_data: `models:edit:photo:1:${modelId}:${fromPage}` }],
      [{ text: "📷 Swap Photo 2", callback_data: `models:edit:photo:2:${modelId}:${fromPage}` }],
      [{ text: "📷 Swap Photo 3", callback_data: `models:edit:photo:3:${modelId}:${fromPage}` }],
      [{ text: "⬅️ Back to model", callback_data: `models:view:${modelId}:${fromPage}` }],
    ]),
  );
}

// ── Model create flow ─────────────────────────────────────────
export async function startCreateModel(chatId) {
  setFlow(chatId, { step: "model_create_name" });
  await send(chatId, "🆕 Create New Model\n\nEnter a name for your model (2–80 characters):", cancelKbd());
}

// ── Looks editor flow ─────────────────────────────────────────
async function startLooksAssignment(chatId, context = {}) {
  setFlow(chatId, { ...context, step: "looks_assign_how" });
  await send(
    chatId,
    "🎨 Assign Looks\n\nHow would you like to set the model's appearance?",
    inlineKbd([
      [{ text: "🤖 AI Auto-Assign · 10 credits", callback_data: "looks:auto" }],
      [{ text: "✏️ Manual Select", callback_data: "looks:manual" }],
      [{ text: "⬅️ Cancel", callback_data: "nav:home" }],
    ]),
  );
}

async function renderLooksCategoryPicker(chatId, flow) {
  const remaining = LOOKS_CATEGORIES.filter((c) => !flow.looks?.[c.key]);
  const done = LOOKS_CATEGORIES.filter((c) => flow.looks?.[c.key]);
  const rows = remaining.map((c) => [{ text: c.label, callback_data: `looks:cat:${c.key}` }]);
  if (done.length) rows.push([{ text: `✅ ${done.length} set — Save & Finish`, callback_data: "looks:done" }]);
  rows.push([{ text: "⬅️ Cancel", callback_data: "nav:home" }]);
  await send(chatId, `🎨 Looks Editor\n${done.length}/${LOOKS_CATEGORIES.length} categories set.\n\nPick a category:`, inlineKbd(rows));
}

async function renderCategoryOptions(chatId, catKey) {
  const cat = LOOKS_CATEGORIES.find((c) => c.key === catKey);
  if (!cat) return;
  const rows = cat.options.map((opt) => [{ text: opt, callback_data: `looks:opt:${catKey}:${encodeURIComponent(opt)}` }]);
  rows.push([{ text: "✍️ Custom (type it)", callback_data: `looks:custom:${catKey}` }]);
  rows.push([{ text: "⬅️ Back", callback_data: "looks:manual" }]);
  await send(chatId, `${cat.label}\n\nSelect an option or enter custom:`, inlineKbd(rows));
}

async function finishLooksAndContinue(chatId, flow) {
  const looks = flow.looks || {};
  const uid = flow.pendingUserId || flow.userId;
  if (flow.modelCreateContext) {
    const { name, photo1Url, photo2Url, photo3Url, aiGenerate } = flow.modelCreateContext;

    // AI-generated model path: no photos yet — generate them via /models/generate-ai
    if (aiGenerate) {
      const rawGender = String(looks.gender || "female").toLowerCase();
      const gender = /\b(female|woman|girl|lady|f)\b/.test(rawGender)
        ? "female"
        : /\b(male|man|boy|guy|m)\b/.test(rawGender)
          ? "male"
          : "female";
      await send(chatId, `⏳ Generating AI ${gender} model "${name}" from your looks definition…`, null);
      const result = await apiGenerateAiModel(uid, { name, gender, style: "photorealistic" });
      clearFlow(chatId);
      if (!result.ok) { await send(chatId, `❌ Failed to generate AI model: ${result.message}`, modelsHomeKbd()); return; }
      // Persist full looks onto the newly created model
      if (Object.keys(looks).length && result.model?.id) {
        await apiUpdateModel(uid, result.model.id, { savedAppearance: looks }).catch(() => {});
      }
      await send(chatId, `✅ AI Model "${name}" created!\nCredits: ${result.creditsUsed ?? "n/a"}`, inlineKbd([
        [{ text: "🎬 Generate with this model", callback_data: `models:gen:${result.model?.id}:0` }],
        [{ text: "🧬 View all models", callback_data: "nav:models" }],
        [{ text: "🏠 Home", callback_data: "nav:home" }],
      ]));
      return;
    }

    // Real-photo model path
    await send(chatId, "⏳ Creating model...", null);
    const result = await apiCreateModel(uid, name, photo1Url, photo2Url, photo3Url, looks);
    clearFlow(chatId);
    if (!result.ok) { await send(chatId, `❌ Failed to create model: ${result.message}`, modelsHomeKbd()); return; }
    await send(chatId, `✅ Model "${name}" created!\n\nWhat next?`, inlineKbd([
      [{ text: "🎬 Generate with this model", callback_data: `models:gen:${result.model?.id}:0` }],
      [{ text: "🧬 View all models", callback_data: "nav:models" }],
      [{ text: "🏠 Home", callback_data: "nav:home" }],
    ]));
    return;
  }
  if (flow.modelEditContext) {
    const { modelId, fromPage, userId } = flow.modelEditContext;
    await apiUpdateModel(userId, modelId, { savedAppearance: looks });
    clearFlow(chatId);
    await send(chatId, "✅ Looks saved!", inlineKbd([[{ text: "View model", callback_data: `models:view:${modelId}:${fromPage}` }]]));
    return;
  }
  clearFlow(chatId);
  await send(chatId, "✅ Looks saved!", modelsHomeKbd());
}

// ── Message handler ───────────────────────────────────────────
export async function handleModelsMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const t = String(text || "").trim();
  const cancel = t.toLowerCase() === "cancel";

  if (flow.step === "model_create_name") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Cancelled.", modelsHomeKbd()); return true; }
    if (t.length < 2 || t.length > 80) { await send(chatId, "Name must be 2–80 characters. Try again:", cancelKbd()); return true; }
    setFlow(chatId, { step: "model_create_type", name: t });
    await send(chatId, `Name: "${t}"\n\nNow choose the model type:`, inlineKbd([
      [{ text: "📷 Upload Real Photos", callback_data: "models:create:real" }],
      [{ text: "🤖 Create with AI", callback_data: "models:create:ai" }],
      [{ text: "Cancel", callback_data: "nav:home" }],
    ]));
    return true;
  }

  if (flow.step === "model_create_photo1" || flow.step === "model_create_photo2" || flow.step === "model_create_photo3") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Cancelled.", modelsHomeKbd()); return true; }
    const url = await resolveImage(message).catch(() => null);
    if (!url || !isHttpUrl(url)) {
      const num = flow.step.slice(-1);
      const labels = { "1": "Close-up Selfie", "2": "Face Portrait", "3": "Full Body Shot" };
      await send(chatId, `Please send Photo ${num} (${labels[num] || "photo"}) as a photo or image file:`, cancelKbd());
      return true;
    }
    if (flow.step === "model_create_photo1") {
      setFlow(chatId, { ...flow, step: "model_create_photo2", photo1Url: url });
      await send(chatId, "✅ Photo 1 received.\n\nNow send Photo 2 — Face Portrait (head and shoulders):", cancelKbd());
    } else if (flow.step === "model_create_photo2") {
      setFlow(chatId, { ...flow, step: "model_create_photo3", photo2Url: url });
      await send(chatId, "✅ Photo 2 received.\n\nNow send Photo 3 — Full Body Shot:", cancelKbd());
    } else {
      setFlow(chatId, { ...flow, photo3Url: url, step: "looks_assign_how", modelCreateContext: { name: flow.name, photo1Url: flow.photo1Url, photo2Url: flow.photo2Url, photo3Url: url }, pendingUserId: session.userId, looks: {} });
      await send(chatId, "✅ All 3 photos received!\n\nNow assign the model's looks:", inlineKbd([
        [{ text: "🤖 AI Auto-Assign · 10 credits", callback_data: "looks:auto" }],
        [{ text: "✏️ Manual Select", callback_data: "looks:manual" }],
        [{ text: "⬅️ Cancel", callback_data: "nav:home" }],
      ]));
    }
    return true;
  }

  if (flow.step === "looks_custom_input") {
    if (cancel) {
      setFlow(chatId, { ...flow, step: "looks_manual" });
      await renderLooksCategoryPicker(chatId, flow);
      return true;
    }
    if (t.length < 1) { await send(chatId, "Enter your custom value (or Cancel):", cancelKbd()); return true; }
    const { catKey } = flow;
    const looks = { ...(flow.looks || {}), [catKey]: t };
    setFlow(chatId, { ...flow, looks, step: "looks_manual" });
    await renderLooksCategoryPicker(chatId, { ...flow, looks });
    return true;
  }

  if (flow.step === "model_rename") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Cancelled.", modelsHomeKbd()); return true; }
    if (t.length < 2 || t.length > 80) { await send(chatId, "Name must be 2–80 characters. Try again:", cancelKbd()); return true; }
    await apiUpdateModel(session.userId, flow.modelId, { name: t });
    clearFlow(chatId);
    await send(chatId, `✅ Renamed to "${t}".`, inlineKbd([[{ text: "View model", callback_data: `models:view:${flow.modelId}:${flow.fromPage || 0}` }]]));
    return true;
  }

  if (flow.step === "model_set_age") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Cancelled.", modelsHomeKbd()); return true; }
    const age = Number.parseInt(t, 10);
    if (!Number.isFinite(age) || age < 1 || age > 85) { await send(chatId, "Enter a number between 1 and 85:", cancelKbd()); return true; }
    await apiUpdateModel(session.userId, flow.modelId, { age });
    clearFlow(chatId);
    await send(chatId, `✅ Age set to ${age}.`, inlineKbd([[{ text: "View model", callback_data: `models:view:${flow.modelId}:${flow.fromPage || 0}` }]]));
    return true;
  }

  if (flow.step === "model_swap_photo") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Cancelled.", modelsHomeKbd()); return true; }
    const url = await resolveImage(message).catch(() => null);
    if (!url || !isHttpUrl(url)) { await send(chatId, "Send the new photo as a photo or image file:", cancelKbd()); return true; }
    const slot = flow.slot;
    await apiUpdateModel(session.userId, flow.modelId, { [`photo${slot}Url`]: url });
    clearFlow(chatId);
    await send(chatId, `✅ Photo ${slot} updated.`, inlineKbd([[{ text: "View model", callback_data: `models:view:${flow.modelId}:${flow.fromPage || 0}` }]]));
    return true;
  }

  if (flow.step === "model_analyze_upload") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Cancelled.", modelsHomeKbd()); return true; }
    const url = await resolveImage(message).catch(() => null);
    if (!url || !isHttpUrl(url)) {
      await send(chatId, `Send a photo for analysis (${flow.collectedUrls?.length || 0}/3 uploaded).\nTap "Analyze now" when ready.`, inlineKbd([
        [{ text: "🔍 Analyze now", callback_data: `models:analyze:run:${flow.modelId}:${flow.fromPage || 0}` }],
        [{ text: "Cancel", callback_data: "nav:home" }],
      ]));
      return true;
    }
    const urls = [...(flow.collectedUrls || []), url];
    if (urls.length >= 3) {
      await runAnalyzeLooks(chatId, session.userId, flow.modelId, urls, flow.fromPage || 0);
    } else {
      setFlow(chatId, { ...flow, collectedUrls: urls });
      await send(chatId, `✅ Photo ${urls.length}/3 received. Send another or tap "Analyze now".`, inlineKbd([
        [{ text: "🔍 Analyze now", callback_data: `models:analyze:run:${flow.modelId}:${flow.fromPage || 0}` }],
        [{ text: "Cancel", callback_data: "nav:home" }],
      ]));
    }
    return true;
  }

  return false;
}

async function runAnalyzeLooks(chatId, userId, modelId, urls, fromPage) {
  clearFlow(chatId);
  await send(chatId, `⏳ Analyzing looks from ${urls.length} photo(s)...`, null);
  const result = await apiAnalyzeLooks(userId, urls);
  if (!result.ok) { await send(chatId, `❌ Analyze failed: ${result.message}`, modelsHomeKbd()); return; }
  const looks = result.looks || {};
  const lines = Object.entries(looks).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (Object.keys(looks).length) {
    await apiUpdateModel(userId, modelId, { savedAppearance: looks });
  }
  await send(chatId, `🔬 Analysis complete!\n\n${lines.join("\n") || "No data detected."}`, inlineKbd([
    [{ text: "✏️ Edit looks", callback_data: `models:edit:looks:${modelId}:${fromPage}` }],
    [{ text: "View model", callback_data: `models:view:${modelId}:${fromPage}` }],
  ]));
}

// ── Callback handler ──────────────────────────────────────────
export async function handleModelsCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:models" || data === "models:list") {
    await renderModelsList(chatId, userId, 0); return true;
  }
  if (data.startsWith("models:page:")) {
    const page = Number(data.split(":").pop()) || 0;
    await renderModelsList(chatId, userId, page); return true;
  }
  if (data === "models:create") {
    await startCreateModel(chatId); return true;
  }
  if (data === "models:create:real") {
    const flow = getFlow(chatId);
    if (!flow || !flow.name) { await startCreateModel(chatId); return true; }
    setFlow(chatId, { ...flow, step: "model_create_photo1" });
    await send(chatId, "📷 Send Photo 1 — Close-up Selfie (face fills the frame):", cancelKbd()); return true;
  }
  if (data === "models:create:ai") {
    const flow = getFlow(chatId);
    if (!flow || !flow.name) { await startCreateModel(chatId); return true; }
    // Offer two AI creation paths
    await send(chatId, "🤖 AI Model Creation\n\nHow should the model look?", inlineKbd([
      [{ text: "🎨 Manual look picker", callback_data: "models:create:ai:manual" }],
      [{ text: "🤖 Quick AI generate (auto looks)", callback_data: "models:create:ai:auto" }],
      [{ text: "Cancel", callback_data: "nav:home" }],
    ]));
    return true;
  }
  if (data === "models:create:ai:manual") {
    const flow = getFlow(chatId);
    if (!flow || !flow.name) { await startCreateModel(chatId); return true; }
    setFlow(chatId, { ...flow, step: "looks_assign_how", modelCreateContext: { name: flow.name, aiGenerate: true }, pendingUserId: userId, looks: {} });
    await send(chatId, "🎨 Assign Looks\n\nDefine the appearance and AI will generate 3 photos:", inlineKbd([
      [{ text: "🤖 AI Auto-Assign · 10 credits", callback_data: "looks:auto" }],
      [{ text: "✏️ Manual Select", callback_data: "looks:manual" }],
      [{ text: "Cancel", callback_data: "nav:home" }],
    ]));
    return true;
  }
  if (data === "models:create:ai:auto") {
    const flow = getFlow(chatId);
    if (!flow || !flow.name) { await startCreateModel(chatId); return true; }
    // Ask gender, then generate immediately
    setFlow(chatId, { ...flow, step: "model_aigen_gender" });
    await send(chatId, "Quick AI generate.\n\nGender:", inlineKbd([
      [{ text: "Female", callback_data: "models:aigen:g:female" }, { text: "Male", callback_data: "models:aigen:g:male" }],
    ]));
    return true;
  }
  if (data.startsWith("models:aigen:g:")) {
    const gender = data.split(":").pop();
    const flow = getFlow(chatId);
    clearFlow(chatId);
    await send(chatId, `⏳ Generating AI ${gender} model "${flow.name}"...`, null);
    const r = await apiGenerateAiModel(userId, {
      name: flow.name,
      gender,
      style: "photorealistic",
    });
    if (!r.ok) { await send(chatId, `❌ AI model generation failed: ${r.message}`); return true; }
    await send(chatId, `✅ AI model "${flow.name}" created!\nCredits: ${r.creditsUsed ?? "n/a"}`, inlineKbd([
      [{ text: "🎬 Generate with model", callback_data: `models:gen:${r.model?.id}:0` }],
      [{ text: "🧬 View models", callback_data: "nav:models" }],
    ]));
    return true;
  }
  if (data.startsWith("models:view:")) {
    const [, , modelId, page] = data.split(":");
    await renderModelCard(chatId, userId, modelId, Number(page) || 0); return true;
  }
  if (data.startsWith("models:edit:name:")) {
    const parts = data.split(":");
    const modelId = parts[3]; const fromPage = Number(parts[4]) || 0;
    setFlow(chatId, { step: "model_rename", modelId, fromPage });
    await send(chatId, "Enter the new name:", cancelKbd()); return true;
  }
  if (data.startsWith("models:edit:age:")) {
    const parts = data.split(":");
    const modelId = parts[3]; const fromPage = Number(parts[4]) || 0;
    setFlow(chatId, { step: "model_set_age", modelId, fromPage });
    await send(chatId, "Enter age (1–85):", cancelKbd()); return true;
  }
  if (data.startsWith("models:edit:photo:")) {
    const parts = data.split(":");
    const slot = Number(parts[3]); const modelId = parts[4]; const fromPage = Number(parts[5]) || 0;
    setFlow(chatId, { step: "model_swap_photo", slot, modelId, fromPage });
    await send(chatId, `Send the new Photo ${slot} as a photo or image file:`, cancelKbd()); return true;
  }
  if (data.startsWith("models:edit:looks:")) {
    const parts = data.split(":");
    const modelId = parts[3]; const fromPage = Number(parts[4]) || 0;
    const model = await prisma.savedModel.findFirst({ where: { id: modelId, userId }, select: { savedAppearance: true } });
    const existingLooks = (model?.savedAppearance && typeof model.savedAppearance === "object") ? model.savedAppearance : {};
    setFlow(chatId, { step: "looks_manual", modelEditContext: { modelId, fromPage, userId }, pendingUserId: userId, looks: existingLooks });
    await renderLooksCategoryPicker(chatId, { looks: existingLooks }); return true;
  }
  if (data.startsWith("models:edit:")) {
    const parts = data.split(":");
    const modelId = parts[2]; const fromPage = Number(parts[3]) || 0;
    await renderEditMenu(chatId, userId, modelId, fromPage); return true;
  }
  if (data.startsWith("models:analyze:run:")) {
    const parts = data.split(":");
    const modelId = parts[3]; const fromPage = Number(parts[4]) || 0;
    const flow = getFlow(chatId);
    const urls = flow?.collectedUrls || [];
    if (!urls.length) { await send(chatId, "No photos uploaded yet. Send at least one photo.", cancelKbd()); return true; }
    await runAnalyzeLooks(chatId, userId, modelId, urls, fromPage); return true;
  }
  if (data.startsWith("models:analyze:")) {
    const parts = data.split(":");
    const modelId = parts[2]; const fromPage = Number(parts[3]) || 0;
    setFlow(chatId, { step: "model_analyze_upload", modelId, fromPage, collectedUrls: [] });
    await send(chatId, "🔬 Analyze Looks\n\nSend up to 3 photos of the model as uploads. Analysis runs automatically after the 3rd, or tap 'Analyze now' anytime.", inlineKbd([
      [{ text: "🔍 Analyze now", callback_data: `models:analyze:run:${modelId}:${fromPage}` }],
      [{ text: "Cancel", callback_data: "nav:home" }],
    ]));
    return true;
  }
  // confirm MUST be before generic delete: check
  if (data.startsWith("models:delete:confirm:")) {
    const parts = data.split(":");
    const modelId = parts[3]; const fromPage = Number(parts[4]) || 0;
    await apiDeleteModel(userId, modelId);
    await send(chatId, "✅ Model deleted.", inlineKbd([[{ text: "🧬 Models", callback_data: "nav:models" }]]));
    return true;
  }
  if (data.startsWith("models:delete:")) {
    const parts = data.split(":");
    const modelId = parts[2]; const fromPage = Number(parts[3]) || 0;
    const model = await prisma.savedModel.findFirst({ where: { id: modelId, userId }, select: { name: true } });
    if (!model) { await send(chatId, "Model not found.", modelsHomeKbd()); return true; }
    await send(chatId, `Are you sure you want to delete "${model.name}"? This cannot be undone.`, inlineKbd([
      [{ text: "🗑 Yes, delete", callback_data: `models:delete:confirm:${modelId}:${fromPage}` }],
      [{ text: "Cancel", callback_data: `models:view:${modelId}:${fromPage}` }],
    ]));
    return true;
  }
  if (data.startsWith("models:gen:")) {
    const modelId = data.split(":")[2];
    const { renderGenerateMenu } = await import("./generate.js");
    await renderGenerateMenu(chatId, modelId);
    return true;
  }

  // ── Looks callbacks ──────────────────────────────────────────
  if (data === "looks:auto") {
    const flow = getFlow(chatId);
    if (!flow) return true;
    await send(chatId, "⏳ AI is analyzing your photos and assigning looks... (10 credits)", null);
    const urls = [flow.modelCreateContext?.photo1Url, flow.modelCreateContext?.photo2Url, flow.modelCreateContext?.photo3Url].filter(isHttpUrl);
    let looks = {};
    if (urls.length) {
      const result = await apiAnalyzeLooks(userId, urls);
      if (result.ok) looks = result.looks || {};
    }
    setFlow(chatId, { ...flow, looks, step: "looks_manual" });
    await send(chatId, `✅ AI assigned ${Object.keys(looks).length} look attributes. Review and edit if needed:`, inlineKbd([
      [{ text: "✅ Save & Continue", callback_data: "looks:done" }],
      [{ text: "✏️ Edit categories", callback_data: "looks:manual" }],
    ]));
    return true;
  }
  if (data === "looks:manual") {
    const flow = getFlow(chatId);
    if (!flow) return true;
    setFlow(chatId, { ...flow, step: "looks_manual" });
    await renderLooksCategoryPicker(chatId, flow);
    return true;
  }
  if (data.startsWith("looks:cat:")) {
    const catKey = data.split(":").pop();
    const flow = getFlow(chatId);
    if (!flow) return true;
    setFlow(chatId, { ...flow, step: "looks_cat_options", catKey });
    await renderCategoryOptions(chatId, catKey);
    return true;
  }
  if (data.startsWith("looks:opt:")) {
    const parts = data.split(":");
    const catKey = parts[2];
    const value = decodeURIComponent(parts.slice(3).join(":"));
    const flow = getFlow(chatId);
    if (!flow) return true;
    const looks = { ...(flow.looks || {}), [catKey]: value };
    setFlow(chatId, { ...flow, looks, step: "looks_manual" });
    await renderLooksCategoryPicker(chatId, { ...flow, looks });
    return true;
  }
  if (data.startsWith("looks:custom:")) {
    const catKey = data.split(":").pop();
    const flow = getFlow(chatId);
    if (!flow) return true;
    setFlow(chatId, { ...flow, step: "looks_custom_input", catKey });
    await send(chatId, `Enter custom value for ${catKey}:`, cancelKbd());
    return true;
  }
  if (data === "looks:done") {
    const flow = getFlow(chatId);
    if (!flow) return true;
    await finishLooksAndContinue(chatId, flow);
    return true;
  }

  return false;
}
