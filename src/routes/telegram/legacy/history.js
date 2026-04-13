import prisma from "../../../lib/prisma.js";
import { send, sendImg, inlineKbd, formatDate, isHttpUrl } from "./helpers.js";
import { refreshGeneration, retryGeneration } from "./generate.js";
import { ensureAuth } from "./auth.js";
import { apiDeleteGenerations } from "./api.js";
import { RETRYABLE_TYPES } from "./config.js";

const PAGE_SIZE = 8;

const HISTORY_TYPES = [
  "all", "prompt-video", "prompt-image", "image-identity",
  "creator-studio", "creator-studio-video", "advanced-image",
  "face-swap", "face-swap-image", "talking-head",
  "video", "nsfw", "modelclone-x", "upscale",
];

const TYPE_LABELS = {
  all: "All",
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

export async function renderHistory(chatId, userId, page = 0, typeFilter = "all", statusFilter = "all") {
  const where = { userId };
  if (typeFilter !== "all") where.type = typeFilter;
  if (statusFilter !== "all") where.status = statusFilter;

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
  const filterLine = `Type: ${TYPE_LABELS[typeFilter] || typeFilter} · Status: ${statusFilter}`;

  if (!items.length) {
    await send(chatId, `No generations found.\n${filterLine}`, inlineKbd([
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
  if (page > 0) nav.push({ text: "⬅️ Prev", callback_data: `hist:page:${page - 1}:${typeFilter}:${statusFilter}` });
  nav.push({ text: `${page + 1}/${pages}`, callback_data: "noop" });
  if ((page + 1) * PAGE_SIZE < total) nav.push({ text: "Next ➡️", callback_data: `hist:page:${page + 1}:${typeFilter}:${statusFilter}` });
  if (nav.length > 1) rows.push(nav);
  rows.push([{ text: "🔍 Filter", callback_data: `hist:filter:${page}` }]);
  rows.push([{ text: "⬅️ Home", callback_data: "nav:home" }]);

  await send(chatId, `🕘 History — ${total} result(s)\n${filterLine}\nPage ${page + 1}/${pages}`, inlineKbd(rows));
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
  // CS Video upgrade options
  if (isCsVideo && isVeo && gen.providerTaskId) {
    rows.push([
      { text: "🔼 4K Upgrade", callback_data: `hist:veo4k:${genId}` },
      { text: "🔼 1080p Render", callback_data: `hist:veo1080p:${genId}` },
    ]);
  }
  // CS Video extend (VEO only)
  if (isCsVideo && gen.providerFamily === "veo31") {
    rows.push([{ text: "⏩ Extend video (VEO)", callback_data: `hist:csextend:${genId}` }]);
  }
  rows.push([{ text: "🗑 Delete", callback_data: `hist:delete:${genId}:${fromPage}` }]);
  rows.push([{ text: "⬅️ Back to history", callback_data: `hist:page:${fromPage}:all:all` }]);

  if (gen.outputUrl && isHttpUrl(gen.outputUrl) && gen.status === "completed") {
    await sendImg(chatId, gen.outputUrl, { caption: text, replyMarkup: inlineKbd(rows) }).catch(() => send(chatId, text, inlineKbd(rows)));
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
  for (const v of activeAvatars) rows.push([{ text: `${v.status === "pending" ? "⏳" : "⚙️"} Avatar ${v.avatar?.name || "#" + v.id.slice(0, 8)}`, callback_data: `avatars:vid:${v.id}` }]);
  for (const f of failedGens.filter((g) => RETRYABLE_TYPES.has(g.type))) rows.push([{ text: `♻️ Retry ${(TYPE_LABELS[f.type] || f.type)} #${f.id.slice(0, 8)}`, callback_data: `gen:retry:${f.id}:0` }]);
  rows.push([{ text: "🔄 Refresh", callback_data: "nav:queue" }, { text: "🕘 History", callback_data: "nav:history" }]);
  rows.push([{ text: "⬅️ Home", callback_data: "nav:home" }]);
  const total = activeGens.length + activeAvatars.length;
  await send(chatId, `📥 Queue\nActive: ${total} (gen: ${activeGens.length}, avatar: ${activeAvatars.length})\nFailed recently: ${failedGens.length}`, inlineKbd(rows));
}

export async function handleHistoryCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:history") { await renderHistory(chatId, userId, 0); return true; }
  if (data === "nav:queue") { await renderQueue(chatId, userId); return true; }

  if (data.startsWith("hist:page:")) {
    const parts = data.split(":");
    const page = Number(parts[2]) || 0;
    const typeFilter = parts[3] || "all";
    const statusFilter = parts[4] || "all";
    await renderHistory(chatId, userId, page, typeFilter, statusFilter); return true;
  }
  if (data.startsWith("hist:item:")) {
    const [, , genId, page] = data.split(":");
    await renderHistoryItem(chatId, userId, genId, Number(page) || 0); return true;
  }
  if (data.startsWith("hist:filter:")) {
    const page = Number(data.split(":").pop()) || 0;
    await send(chatId, "Filter by type:", inlineKbd([
      ...Object.entries(TYPE_LABELS).map(([k, v]) => [{ text: v, callback_data: `hist:settype:${page}:${k}` }]),
    ]));
    return true;
  }
  if (data.startsWith("hist:settype:")) {
    const parts = data.split(":");
    const page = Number(parts[2]) || 0;
    const type = parts[3] || "all";
    await send(chatId, "Filter by status:", inlineKbd([
      [{ text: "All", callback_data: `hist:page:${page}:${type}:all` }],
      [{ text: "✅ Completed", callback_data: `hist:page:${page}:${type}:completed` }],
      [{ text: "❌ Failed", callback_data: `hist:page:${page}:${type}:failed` }],
      [{ text: "⏳ Processing", callback_data: `hist:page:${page}:${type}:processing` }],
    ]));
    return true;
  }
  // confirm MUST be checked before the generic delete: prefix
  if (data.startsWith("hist:delete:confirm:")) {
    const [, , , genId, page] = data.split(":");
    await apiDeleteGenerations(userId, [genId]);
    await send(chatId, "✅ Deleted.", inlineKbd([[{ text: "🕘 History", callback_data: `hist:page:${Number(page) || 0}:all:all` }]]));
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

  // VEO 4K upgrade
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
  // VEO 1080p render
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
  // CS Video extend
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
