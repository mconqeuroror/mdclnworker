import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, sendMedia, inlineKbd, formatDate, isHttpUrl } from "./helpers.js";
import { ensureAuth } from "./auth.js";
import { apiDeleteGenerations } from "./api.js";
import { RETRYABLE_TYPES, appUrl } from "./config.js";

const PAGE_SIZE = 8;

/** Prisma filter: only generations with no SavedModel linked */
const NO_MODEL_SENTINEL = "__NO_MODEL__";

/** Image / still outputs */
const PHOTO_TYPES = [
  "prompt-image",
  "image-identity",
  "creator-studio",
  "advanced-image",
  "face-swap-image",
  "modelclone-x",
  "upscale",
  "image",
  "nsfw",
  "img2img-describe",
  "creator-studio-mask",
  "creator-studio-asset",
  "advanced-model",
  "model-poses",
];

/** Video outputs */
const VIDEO_TYPES = [
  "prompt-video",
  "creator-studio-video",
  "face-swap",
  "talking-head",
  "video",
  "nsfw-video",
  "nsfw-video-extend",
];

const TYPE_LABELS = {
  all: "All",
  __photo__: "Photos",
  __video__: "Videos",
  "prompt-video": "AI Video",
  "prompt-image": "AI Photo",
  "image-identity": "Identity",
  "creator-studio": "CS Image",
  "creator-studio-video": "CS Video",
  "advanced-image": "Advanced",
  "face-swap": "Face Swap",
  "face-swap-image": "IMG Swap",
  "talking-head": "TalkHead",
  video: "Video",
  nsfw: "NSFW",
  "modelclone-x": "MCX",
  upscale: "Upscale",
};

function mediaToTypeFilter(media) {
  if (media === "photo") return "__photo__";
  if (media === "video") return "__video__";
  return "all";
}

function buildHistoryWhere(userId, typeFilter, statusFilter, modelId) {
  const where = { userId };
  if (statusFilter && statusFilter !== "all") where.status = statusFilter;
  if (modelId === NO_MODEL_SENTINEL) {
    where.modelId = null;
  } else if (modelId) {
    where.modelId = modelId;
  }

  if (typeFilter === "__photo__") {
    where.type = { in: PHOTO_TYPES };
  } else if (typeFilter === "__video__") {
    where.type = { in: VIDEO_TYPES };
  } else if (typeFilter && typeFilter !== "all") {
    where.type = typeFilter;
  }
  return where;
}

function describeFilterLine(typeFilter, statusFilter, modelId, modelName) {
  const typeLabel = TYPE_LABELS[typeFilter] || typeFilter;
  let modelPart = "";
  if (modelId === NO_MODEL_SENTINEL) {
    modelPart = " · Model: (no model linked)";
  } else if (modelId) {
    modelPart = ` · Model: ${(modelName || modelId).slice(0, 24)}`;
  }
  return `Type: ${typeLabel}${modelPart} · Status: ${statusFilter || "all"}`;
}

function persistHistBrowseState(chatId, page, typeFilter, statusFilter, modelId, modelName) {
  const media = typeFilter === "__photo__" ? "photo" : typeFilter === "__video__" ? "video" : "all";
  setFlow(chatId, {
    step: "hist_browse",
    page,
    histFilter: {
      media,
      modelId: modelId || null,
      modelName: modelName || null,
      statusFilter: statusFilter || "all",
    },
  });
}

export async function renderHistory(chatId, userId, page = 0, typeFilter = "all", statusFilter = "all", modelId = null, modelName = null) {
  const where = buildHistoryWhere(userId, typeFilter, statusFilter, modelId);

  const [items, total] = await Promise.all([
    prisma.generation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, type: true, status: true, creditsCost: true, createdAt: true, outputUrl: true },
    }),
    prisma.generation.count({ where }),
  ]);

  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  const filterLine = describeFilterLine(typeFilter, statusFilter, modelId, modelName);

  persistHistBrowseState(chatId, page, typeFilter, statusFilter, modelId, modelName);

  if (!items.length) {
    await send(chatId, `No generations found.\n${filterLine}`, inlineKbd([
      [{ text: "🧬 Change model", callback_data: "hist:reentry" }],
      [{ text: "🔍 Change filter", callback_data: `hist:filter:${page}` }],
      [{ text: "🎬 Generate", callback_data: "nav:generate" }, { text: "🏠 Home", callback_data: "nav:home" }],
    ]));
    return;
  }

  const icons = { completed: "✅", failed: "❌", processing: "⏳", pending: "⏳" };
  const rows = items.map((g) => [{
    text: `${icons[g.status] || "•"} ${(TYPE_LABELS[g.type] || g.type).slice(0, 12)} · ${formatDate(g.createdAt).split(",")[0]}`,
    callback_data: `hist:item:${g.id}:${page}`,
  }]);

  const nav = [];
  if (page > 0) nav.push({ text: "⬅️ Prev", callback_data: `hist:navp:${page - 1}` });
  nav.push({ text: `${page + 1}/${pages}`, callback_data: "noop" });
  if ((page + 1) * PAGE_SIZE < total) nav.push({ text: "Next ➡️", callback_data: `hist:navp:${page + 1}` });
  if (nav.length > 1) rows.push(nav);
  rows.push([{ text: "🧬 Change model", callback_data: "hist:reentry" }]);
  rows.push([{ text: "🔍 Filter", callback_data: `hist:filter:${page}` }]);
  rows.push([{ text: "⬅️ Home", callback_data: "nav:home" }]);

  await send(chatId, `🕘 History — ${total} result(s)\n${filterLine}\nPage ${page + 1}/${pages}`, inlineKbd(rows));
}

/** First step: pick which model’s history to open (then list is filtered). */
export async function renderHistoryModelPicker(chatId, userId) {
  const models = await prisma.savedModel.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 28,
  });
  setFlow(chatId, {
    step: "hist_pick_entry",
    modelRows: models.map((m) => ({ id: m.id, name: m.name })),
  });
  const rows = [
    [{ text: "📂 All models — everything", callback_data: "hist:entry:all" }],
    [{ text: "📎 Other (no model linked)", callback_data: "hist:entry:none" }],
  ];
  models.forEach((m, i) => {
    const label = `🧬 ${(m.name || "Model").slice(0, 36)}`;
    rows.push([{ text: label, callback_data: `hist:entry:${i}` }]);
  });
  rows.push([{ text: "⬅️ Home", callback_data: "nav:home" }]);
  await send(
    chatId,
    "🕘 History\n\nWhich model do you want to open?\n(Then you’ll see only that model’s generations — or pick All / Other.)",
    inlineKbd(rows),
  );
}

async function renderHistoryItem(chatId, userId, genId, fromPage = 0) {
  const gen = await prisma.generation.findFirst({
    where: { id: genId, userId },
    select: { id: true, type: true, status: true, prompt: true, creditsCost: true, errorMessage: true, createdAt: true, completedAt: true, outputUrl: true, providerFamily: true, providerTaskId: true },
  });
  if (!gen) { await send(chatId, "Generation not found.", inlineKbd([[{ text: "🕘 History", callback_data: "nav:history" }]])); return; }
  const icon = gen.status === "completed" ? "✅" : gen.status === "failed" ? "❌" : "⏳";
  const canRetry = gen.status === "failed" && RETRYABLE_TYPES.has(gen.type);
  const isVeo = gen.providerFamily === "veo31" && gen.providerTaskId;
  const isCsVideo = gen.type === "creator-studio-video" && gen.status === "completed";
  const text = `${icon} Generation\nType: ${gen.type}\nStatus: ${gen.status}\nCredits: ${gen.creditsCost ?? 0}\nCreated: ${formatDate(gen.createdAt)}\nCompleted: ${formatDate(gen.completedAt)}\nPrompt: ${(gen.prompt || "").slice(0, 200) || "n/a"}\n${gen.errorMessage ? `Error: ${gen.errorMessage.slice(0, 200)}\n` : ""}`;
  const rows = [];
  if (gen.status === "processing" || gen.status === "pending") rows.push([{ text: "🔄 Refresh", callback_data: `hist:item:${genId}:${fromPage}` }]);
  if (gen.outputUrl && isHttpUrl(gen.outputUrl)) rows.push([{ text: "▶️ View output", url: gen.outputUrl }]);
  if (canRetry) rows.push([{ text: "♻️ Retry", callback_data: `gen:retry:${genId}:${fromPage}` }]);
  if (isCsVideo && isVeo && gen.providerTaskId) {
    rows.push([
      { text: "🔼 4K Upgrade", callback_data: `hist:veo4k:${genId}` },
      { text: "🔼 1080p Render", callback_data: `hist:veo1080p:${genId}` },
    ]);
  }
  if (isCsVideo && gen.providerFamily === "veo31") {
    rows.push([{ text: "⏩ Extend video (VEO)", callback_data: `hist:csextend:${genId}` }]);
  }
  rows.push([{ text: "🗑 Delete", callback_data: `hist:delete:${genId}:${fromPage}` }]);
  rows.push([{ text: "⬅️ Back to history", callback_data: `hist:navp:${fromPage}` }]);

  if (gen.outputUrl && isHttpUrl(gen.outputUrl) && gen.status === "completed") {
    const sent = await sendMedia(chatId, gen.outputUrl, gen.type, { caption: text, replyMarkup: inlineKbd(rows) });
    if (!sent) await send(chatId, text, inlineKbd(rows));
  } else {
    await send(chatId, text, inlineKbd(rows));
  }
}

export async function renderQueue(chatId, userId) {
  const [activeGens, activeAvatars, failedGens] = await Promise.all([
    prisma.generation.findMany({ where: { userId, status: { in: ["pending", "processing"] } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, type: true, status: true, createdAt: true } }),
    prisma.avatarVideo.findMany({ where: { userId, status: { in: ["pending", "processing"] } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, status: true, createdAt: true, avatar: { select: { name: true, modelId: true } } } }),
    prisma.generation.findMany({ where: { userId, status: "failed", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, type: true, createdAt: true } }),
  ]);
  const rows = [];
  for (const g of activeGens) rows.push([{ text: `${g.status === "pending" ? "⏳" : "⚙️"} ${g.type} #${g.id.slice(0, 8)}`, callback_data: `hist:item:${g.id}:0` }]);
  if (activeAvatars.length) {
    rows.push([
      {
        text: `🧍 Avatar video jobs (${activeAvatars.length}) — open Creator Studio`,
        web_app: { url: appUrl("creator") },
      },
    ]);
  }
  for (const f of failedGens.filter((g) => RETRYABLE_TYPES.has(g.type))) rows.push([{ text: `♻️ Retry ${(TYPE_LABELS[f.type] || f.type)} #${f.id.slice(0, 8)}`, callback_data: `gen:retry:${f.id}:0` }]);
  rows.push([{ text: "🔄 Refresh", callback_data: "nav:queue" }, { text: "🕘 History", callback_data: "nav:history" }]);
  rows.push([{ text: "⬅️ Home", callback_data: "nav:home" }]);
  const total = activeGens.length + activeAvatars.length;
  await send(chatId, `📥 Queue\nActive: ${total} (gen: ${activeGens.length}, avatar video: ${activeAvatars.length})\nFailed recently: ${failedGens.length}`, inlineKbd(rows));
}

async function sendStatusPickKeyboard(chatId, page) {
  await send(chatId, "Filter by status:", inlineKbd([
    [{ text: "All", callback_data: `hist:st:${page}:all` }],
    [{ text: "✅ Completed", callback_data: `hist:st:${page}:completed` }],
    [{ text: "❌ Failed", callback_data: `hist:st:${page}:failed` }],
    [{ text: "⏳ Processing", callback_data: `hist:st:${page}:processing` }],
    [{ text: "⬅️ Cancel", callback_data: `hist:navp:${page}` }],
  ]));
}

export async function handleHistoryCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:history") {
    clearFlow(chatId);
    await renderHistoryModelPicker(chatId, userId);
    return true;
  }
  if (data === "hist:reentry") {
    await renderHistoryModelPicker(chatId, userId);
    return true;
  }

  if (data.startsWith("hist:entry:")) {
    const suffix = data.slice("hist:entry:".length);
    const flow = getFlow(chatId);
    const mrows = flow?.modelRows || [];
    let modelId = null;
    let modelName = null;
    if (suffix === "all") {
      modelId = null;
      modelName = null;
    } else if (suffix === "none") {
      modelId = NO_MODEL_SENTINEL;
      modelName = "Other (no model)";
    } else {
      const idx = Number.parseInt(suffix, 10);
      if (!Number.isFinite(idx) || !mrows[idx]) {
        await send(chatId, "Pick expired — open History again.", inlineKbd([[{ text: "🕘 History", callback_data: "nav:history" }]]));
        return true;
      }
      modelId = mrows[idx].id;
      modelName = mrows[idx].name;
    }
    setFlow(chatId, {
      step: "hist_browse",
      histFilter: { media: "all", modelId, modelName, statusFilter: "all" },
    });
    await renderHistory(chatId, userId, 0, "all", "all", modelId, modelName);
    return true;
  }
  if (data === "nav:queue") { await renderQueue(chatId, userId); return true; }

  if (data.startsWith("hist:navp:")) {
    const page = Number(data.split(":").pop()) || 0;
    const flow = getFlow(chatId);
    const hf = flow?.histFilter;
    if (!hf) {
      await renderHistory(chatId, userId, page, "all", "all", null, null);
      return true;
    }
    const typeFilter = mediaToTypeFilter(hf.media);
    await renderHistory(chatId, userId, page, typeFilter, hf.statusFilter || "all", hf.modelId || null, hf.modelName || null);
    return true;
  }

  if (data.startsWith("hist:page:")) {
    const parts = data.split(":");
    const page = Number(parts[2]) || 0;
    const typeFilter = parts[3] || "all";
    const statusFilter = parts[4] || "all";
    await renderHistory(chatId, userId, page, typeFilter, statusFilter, null, null);
    return true;
  }
  if (data.startsWith("hist:item:")) {
    const [, , genId, page] = data.split(":");
    await renderHistoryItem(chatId, userId, genId, Number(page) || 0); return true;
  }

  if (data.startsWith("hist:filter:")) {
    const page = Number(data.split(":").pop()) || 0;
    await send(chatId, "What do you want to see?", inlineKbd([
      [{ text: "🖼 Photos", callback_data: `hist:fm:${page}:photo` }],
      [{ text: "🎬 Videos", callback_data: `hist:fm:${page}:video` }],
      [{ text: "📋 All types", callback_data: `hist:fm:${page}:all` }],
      [{ text: "⬅️ Back", callback_data: `hist:navp:${page}` }],
    ]));
    return true;
  }

  if (data.startsWith("hist:fm:")) {
    const parts = data.split(":");
    const page = Number(parts[2]) || 0;
    const media = parts[3] || "all";
    if (media === "all") {
      setFlow(chatId, { step: "hist_pick_status", page, histFilter: { media: "all", modelId: null, modelName: null } });
      await sendStatusPickKeyboard(chatId, page);
      return true;
    }
    const models = await prisma.savedModel.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const rows = [[{ text: "All models", callback_data: `hist:msel:${page}:${media}:all` }]];
    models.forEach((m, i) => {
      const label = (m.name || "Model").slice(0, 28);
      rows.push([{ text: label, callback_data: `hist:msel:${page}:${media}:${i}` }]);
    });
    rows.push([{ text: "⬅️ Back", callback_data: `hist:filter:${page}` }]);
    const title = media === "photo" ? "Photos — choose model:" : "Videos — choose model:";
    setFlow(chatId, { step: "hist_pick_model", page, media, modelRows: models.map((m) => ({ id: m.id, name: m.name })) });
    await send(chatId, title, inlineKbd(rows));
    return true;
  }

  if (data.startsWith("hist:msel:")) {
    const parts = data.split(":");
    const page = Number(parts[2]) || 0;
    const media = parts[3] || "photo";
    const sel = parts[4];
    const flow = getFlow(chatId);
    let modelId = null;
    let modelName = null;
    if (sel === "all") {
      modelId = null;
      modelName = null;
    } else {
      const idx = Number(sel);
      const row = flow?.modelRows?.[idx];
      if (!row) {
        await send(chatId, "Pick expired — open Filter again.", inlineKbd([[{ text: "🕘 History", callback_data: "nav:history" }]]));
        return true;
      }
      modelId = row.id;
      modelName = row.name;
    }
    setFlow(chatId, { step: "hist_pick_status", page, histFilter: { media, modelId, modelName } });
    await sendStatusPickKeyboard(chatId, page);
    return true;
  }

  if (data.startsWith("hist:st:")) {
    const parts = data.split(":");
    const page = Number(parts[2]) || 0;
    const statusFilter = parts[3] || "all";
    const flow = getFlow(chatId);
    const hf = flow?.histFilter || { media: "all", modelId: null, modelName: null };
    const merged = { ...hf, statusFilter };
    setFlow(chatId, { step: "hist_pick_status", page, histFilter: merged });
    const typeFilter = mediaToTypeFilter(merged.media);
    await renderHistory(chatId, userId, page, typeFilter, statusFilter, merged.modelId || null, merged.modelName || null);
    return true;
  }

  if (data.startsWith("hist:settype:")) {
    const page = Number(data.split(":")[2]) || 0;
    await send(chatId, "This filter menu is outdated. Use the new filter:", inlineKbd([
      [{ text: "🔍 Open filters", callback_data: `hist:filter:${page}` }],
      [{ text: "🕘 History", callback_data: "nav:history" }],
    ]));
    return true;
  }

  if (data.startsWith("hist:delete:confirm:")) {
    const [, , , genId, page] = data.split(":");
    await apiDeleteGenerations(userId, [genId]);
    await send(chatId, "✅ Deleted.", inlineKbd([[{ text: "🕘 History", callback_data: `hist:navp:${Number(page) || 0}` }]]));
    return true;
  }
  if (data.startsWith("hist:delete:")) {
    const [, , genId, page] = data.split(":");
    const fromPage = Number(page) || 0;
    await send(chatId, "Delete this generation?", inlineKbd([
      [{ text: "🗑 Yes, delete", callback_data: `hist:delete:confirm:${genId}:${fromPage}` }],
      [{ text: "Cancel", callback_data: `hist:item:${genId}:${fromPage}` }],
    ]));
    return true;
  }

  if (data.startsWith("hist:veo4k:")) {
    const genId = data.split(":").pop();
    const gen = await prisma.generation.findFirst({ where: { id: genId, userId }, select: { providerTaskId: true } });
    if (!gen?.providerTaskId) { await send(chatId, "Cannot find VEO task ID for this generation."); return true; }
    await send(chatId, "⏳ Requesting 4K upgrade...", null);
    const { apiCsVideo4K } = await import("./api.js");
    const r = await apiCsVideo4K(userId, gen.providerTaskId, 0);
    if (!r.ok) { await send(chatId, `❌ 4K upgrade failed: ${r.message}`); return true; }
    await send(chatId, "✅ 4K upgrade requested! Check back soon.", inlineKbd([[{ text: "⬅️ Back", callback_data: `hist:item:${genId}:0` }]]));
    return true;
  }
  if (data.startsWith("hist:veo1080p:")) {
    const genId = data.split(":").pop();
    const gen = await prisma.generation.findFirst({ where: { id: genId, userId }, select: { providerTaskId: true } });
    if (!gen?.providerTaskId) { await send(chatId, "Cannot find VEO task ID."); return true; }
    await send(chatId, "⏳ Requesting 1080p render...", null);
    const { apiCsVideo1080p } = await import("./api.js");
    const r = await apiCsVideo1080p(userId, gen.providerTaskId, 0);
    if (!r.ok) { await send(chatId, `❌ 1080p render failed: ${r.message}`); return true; }
    await send(chatId, "✅ 1080p render requested!", inlineKbd([[{ text: "⬅️ Back", callback_data: `hist:item:${genId}:0` }]]));
    return true;
  }
  if (data.startsWith("hist:csextend:")) {
    const genId = data.split(":").pop();
    const gen = await prisma.generation.findFirst({ where: { id: genId, userId }, select: { providerTaskId: true, prompt: true } });
    clearFlow(chatId);
    await send(chatId, "⏳ Starting VEO extension...", null);
    const { apiCsExtendVideo } = await import("./api.js");
    const r = await apiCsExtendVideo(userId, { originalTaskId: gen?.providerTaskId, prompt: gen?.prompt || "", durationSeconds: 8 });
    if (!r.ok) { await send(chatId, `❌ Extend failed: ${r.message}`); return true; }
    const newId = r.generation?.id;
    await send(chatId, `✅ Extension started!\n${newId ? `New ID: ${newId}` : ""}`, inlineKbd([
      ...(newId ? [[{ text: "🔄 Check status", callback_data: `hist:item:${newId}:0` }]] : []),
      [{ text: "⬅️ Back", callback_data: `hist:item:${genId}:0` }],
    ]));
    return true;
  }

  return false;
}
