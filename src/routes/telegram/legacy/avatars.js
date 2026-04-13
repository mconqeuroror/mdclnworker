import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, formatDate, isHttpUrl } from "./helpers.js";
import { resolveImage } from "./media.js";
import { cancelKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import { apiCreateAvatar, apiGenerateAvatarVideo, apiDeleteAvatar } from "./api.js";

export async function renderAvatarMenu(chatId, userId) {
  const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!models.length) {
    await send(chatId, "No models yet. Create a model first, then create an avatar from it.", inlineKbd([[{ text: "🧬 Create Model", callback_data: "nav:models" }]]));
    return;
  }
  const rows = models.map((m) => [{ text: m.name, callback_data: `avatars:model:${m.id}` }]);
  rows.push([{ text: "➕ Create New Avatar", callback_data: "avatars:create" }]);
  rows.push([{ text: "⬅️ Back", callback_data: "nav:home" }]);
  await send(chatId, "🧍 Avatars\n\nSelect a model to see its avatars:", inlineKbd(rows));
}

async function renderModelAvatars(chatId, userId, modelId) {
  const model = await prisma.savedModel.findFirst({ where: { id: modelId, userId }, select: { id: true, name: true } });
  if (!model) { await send(chatId, "Model not found.", inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:avatars" }]])); return; }
  const avatars = await prisma.avatar.findMany({ where: { userId, modelId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, status: true, createdAt: true } });
  if (!avatars.length) {
    await send(chatId, `No avatars for "${model.name}" yet.`, inlineKbd([
      [{ text: "➕ Create Avatar", callback_data: `avatars:create:model:${modelId}` }],
      [{ text: "⬅️ Back", callback_data: "nav:avatars" }],
    ]));
    return;
  }
  const rows = avatars.map((a) => [{ text: `${a.name} (${a.status || "ready"})`, callback_data: `avatars:view:${a.id}` }]);
  rows.push([{ text: "➕ Create new avatar", callback_data: `avatars:create:model:${modelId}` }]);
  rows.push([{ text: "⬅️ Back", callback_data: "nav:avatars" }]);
  await send(chatId, `🧍 Avatars for "${model.name}"`, inlineKbd(rows));
}

async function renderAvatarCard(chatId, userId, avatarId) {
  const avatar = await prisma.avatar.findFirst({ where: { id: avatarId, userId }, select: { id: true, name: true, status: true, modelId: true } });
  if (!avatar) { await send(chatId, "Avatar not found.", inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:avatars" }]])); return; }
  const videos = await prisma.avatarVideo.findMany({ where: { avatarId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, outputUrl: true, createdAt: true } });
  const videoList = videos.length
    ? videos.map((v, i) => `${i + 1}. ${v.status} · ${formatDate(v.createdAt).split(",")[0]}`).join("\n")
    : "No videos yet.";
  const rows = videos.map((v) => [{ text: `${v.status === "completed" ? "▶️" : v.status === "failed" ? "❌" : "⏳"} Video ${formatDate(v.createdAt).split(",")[0]}`, callback_data: `avatars:vid:${v.id}` }]);
  rows.push([{ text: "🎬 Generate new video", callback_data: `avatars:genvid:${avatarId}` }]);
  rows.push([{ text: "🗑 Delete Avatar", callback_data: `avatars:delete:${avatarId}` }]);
  rows.push([{ text: "⬅️ Back", callback_data: `avatars:model:${avatar.modelId}` }]);
  await send(chatId, `🧍 ${avatar.name} (${avatar.status || "ready"})\n\nVideos:\n${videoList}`, inlineKbd(rows));
}

async function renderAvatarVideoCard(chatId, userId, videoId) {
  const video = await prisma.avatarVideo.findFirst({
    where: { id: videoId, userId },
    select: { id: true, status: true, outputUrl: true, creditsCost: true, createdAt: true, completedAt: true, errorMessage: true, avatarId: true, avatar: { select: { name: true, modelId: true } } },
  });
  if (!video) { await send(chatId, "Video not found.", inlineKbd([[{ text: "⬅️ Avatars", callback_data: "nav:avatars" }]])); return; }
  const text = `🧍 Avatar Video\nAvatar: ${video.avatar?.name || "n/a"}\nStatus: ${video.status}\nCredits: ${video.creditsCost ?? 0}\nCreated: ${formatDate(video.createdAt)}\nCompleted: ${formatDate(video.completedAt)}\n${video.errorMessage ? `Error: ${video.errorMessage.slice(0, 200)}\n` : ""}`;
  const rows = [];
  if (video.status === "processing" || video.status === "pending") rows.push([{ text: "🔄 Refresh", callback_data: `avatars:vid:${videoId}` }]);
  if (video.outputUrl && isHttpUrl(video.outputUrl)) rows.push([{ text: "▶️ View video", url: video.outputUrl }]);
  if (video.status === "failed") rows.push([{ text: "♻️ Retry", callback_data: `avatars:retry:${videoId}` }]);
  rows.push([{ text: "⬅️ Back to avatar", callback_data: `avatars:view:${video.avatarId}` }]);
  await send(chatId, text, inlineKbd(rows));
}

// ── Message handler ───────────────────────────────────────────
export async function handleAvatarsMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("avatars_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await renderAvatarMenu(chatId, userId); return true; }

  if (flow.step === "avatars_create_name") {
    if (t.length < 2 || t.length > 80) { await send(chatId, "Name must be 2–80 characters:", cancelKbd()); return true; }
    setFlow(chatId, { ...flow, step: "avatars_create_photo", name: t });
    await send(chatId, `Name: "${t}"\n\nNow send a portrait photo (face clearly visible):`, cancelKbd()); return true;
  }

  if (flow.step === "avatars_create_photo") {
    const url = await resolveImage(message).catch(() => null);
    if (!url || !isHttpUrl(url)) { await send(chatId, "Send a portrait photo as a photo or image file:", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Creating avatar...", null);
    const r = await apiCreateAvatar(userId, flow.modelId, flow.name, url);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const avatarId = r.avatar?.id;
    await send(chatId, `✅ Avatar "${flow.name}" created!`, inlineKbd([
      ...(avatarId ? [[{ text: "🎬 Generate first video", callback_data: `avatars:genvid:${avatarId}` }]] : []),
      [{ text: "🧍 View avatars", callback_data: "nav:avatars" }],
    ]));
    return true;
  }

  if (flow.step === "avatars_gen_video_script") {
    if (t.length < 4) { await send(chatId, "Enter the script (what the avatar will say, 4+ chars):", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating avatar video...", null);
    const r = await apiGenerateAvatarVideo(userId, flow.avatarId, t);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const videoId = r.video?.id;
    await send(chatId, `✅ Avatar video started!\n${r.estimatedSecs ? `Estimated: ${r.estimatedSecs}s\n` : ""}Credits: ${r.creditsCost ?? "n/a"}`, inlineKbd([
      ...(videoId ? [[{ text: "🔄 Check status", callback_data: `avatars:vid:${videoId}` }]] : []),
      [{ text: "⬅️ Avatars", callback_data: "nav:avatars" }],
    ]));
    return true;
  }

  return false;
}

// ── Callback handler ──────────────────────────────────────────
export async function handleAvatarsCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:avatars") { await renderAvatarMenu(chatId, userId); return true; }
  if (data.startsWith("avatars:delete:confirm:")) {
    const avatarId = data.split(":").pop();
    const r = await apiDeleteAvatar(userId, avatarId);
    if (!r.ok) { await send(chatId, `❌ Delete failed: ${r.message}`); return true; }
    await send(chatId, "✅ Avatar deleted.", inlineKbd([[{ text: "🧍 Avatars", callback_data: "nav:avatars" }]]));
    return true;
  }
  if (data.startsWith("avatars:delete:")) {
    const avatarId = data.split(":").pop();
    const av = await prisma.avatar.findFirst({ where: { id: avatarId, userId }, select: { name: true } });
    await send(chatId, `Delete avatar "${av?.name || avatarId}"?`, inlineKbd([
      [{ text: "🗑 Yes, delete", callback_data: `avatars:delete:confirm:${avatarId}` }],
      [{ text: "Cancel", callback_data: `avatars:view:${avatarId}` }],
    ]));
    return true;
  }
  if (data.startsWith("avatars:model:")) {
    const modelId = data.split(":").pop();
    await renderModelAvatars(chatId, userId, modelId); return true;
  }
  if (data.startsWith("avatars:view:")) {
    const avatarId = data.split(":").pop();
    await renderAvatarCard(chatId, userId, avatarId); return true;
  }
  if (data.startsWith("avatars:vid:")) {
    const videoId = data.split(":").pop();
    await renderAvatarVideoCard(chatId, userId, videoId); return true;
  }
  if (data === "avatars:create" || data.startsWith("avatars:create:model:")) {
    const modelId = data.startsWith("avatars:create:model:") ? data.split(":").pop() : null;
    if (!modelId) {
      const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
      if (!models.length) { await send(chatId, "Create a model first."); return true; }
      const rows = models.map((m) => [{ text: m.name, callback_data: `avatars:create:model:${m.id}` }]);
      rows.push([{ text: "Cancel", callback_data: "nav:avatars" }]);
      await send(chatId, "Select model for this avatar:", inlineKbd(rows)); return true;
    }
    setFlow(chatId, { step: "avatars_create_name", modelId });
    await send(chatId, "Enter avatar name (2–80 chars):", cancelKbd()); return true;
  }
  if (data.startsWith("avatars:genvid:")) {
    const avatarId = data.split(":").pop();
    setFlow(chatId, { step: "avatars_gen_video_script", avatarId });
    await send(chatId, "Enter the script (what the avatar will say):", cancelKbd()); return true;
  }
  if (data.startsWith("avatars:retry:")) {
    const videoId = data.split(":").pop();
    const video = await prisma.avatarVideo.findFirst({ where: { id: videoId, userId }, select: { script: true, avatarId: true, avatar: { select: { status: true, name: true } } } });
    if (!video || String(video.avatar?.status || "").toLowerCase() !== "ready") { await send(chatId, "Avatar not ready for retry."); return true; }
    const script = String(video.script || "").trim();
    if (script.length < 4) { await send(chatId, "Original script missing — cannot retry."); return true; }
    await send(chatId, "⏳ Retrying avatar video...", null);
    const r = await apiGenerateAvatarVideo(userId, video.avatarId, script);
    if (!r.ok) { await send(chatId, `❌ Retry failed: ${r.message}`); return true; }
    const newId = r.video?.id;
    await send(chatId, `✅ Retry started!`, inlineKbd([
      ...(newId ? [[{ text: "🔄 Check status", callback_data: `avatars:vid:${newId}` }]] : []),
      [{ text: "⬅️ Avatars", callback_data: "nav:avatars" }],
    ]));
    return true;
  }

  return false;
}
