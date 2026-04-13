import { sendMessage, sendPhoto, answerCallbackQuery as tgAnswer, deleteMessage as tgDelete } from "../../../services/telegramBot.js";
import { trackBotMessage, getTrackedMessages } from "./state.js";

// ── Messaging ─────────────────────────────────────────────────
export async function send(chatId, text, markup = null) {
  const msg = await sendMessage(chatId, text, buildMarkup(markup));
  if (msg?.message_id) trackBotMessage(chatId, msg.message_id);
  return msg;
}

export async function sendImg(chatId, photoUrl, opts = {}) {
  const msg = await sendPhoto(chatId, photoUrl, opts).catch(() => null);
  if (msg?.message_id) trackBotMessage(chatId, msg.message_id);
  return msg;
}

export async function answerCb(callbackId, text = "") {
  await tgAnswer(callbackId, text).catch(() => {});
}

export async function deleteLastBotMessages(chatId) {
  const ids = getTrackedMessages(chatId);
  for (const id of ids) {
    await tgDelete(chatId, id).catch(() => {});
  }
}

function buildMarkup(markup) {
  if (!markup) return undefined;
  if (markup.inline_keyboard) return markup;
  if (markup.keyboard) {
    return {
      keyboard: markup.keyboard,
      resize_keyboard: markup.resize_keyboard !== false,
      one_time_keyboard: markup.one_time_keyboard !== false,
    };
  }
  if (markup.remove_keyboard) return markup;
  return markup;
}

// ── Keyboard shortcut helpers ─────────────────────────────────
export function inlineKbd(rows) {
  return { inline_keyboard: rows };
}
export function replyKbd(rows, oneTime = true) {
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: oneTime };
}
export function removeKbd() {
  return { remove_keyboard: true };
}

export const cancelKbd = replyKbd([["Cancel"]]);
export const cancelSkipKbd = replyKbd([["Skip", "Cancel"]]);

// ── Text utilities ────────────────────────────────────────────
export function isHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const p = new URL(raw);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}

export function toCmd(text = "") {
  return String(text || "").trim().toLowerCase().split(/\s+/)[0].replace(/^\/+/, "").split("@")[0];
}

export function formatDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(d); }
}

export function safeSlice(str, len = 200) {
  return String(str || "").slice(0, len);
}

export function toJsonObj(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const p = JSON.parse(value); return (p && typeof p === "object" && !Array.isArray(p)) ? p : {}; } catch { return {}; }
  }
  return {};
}

export function pickUrl(...values) {
  for (const v of values) if (isHttpUrl(v)) return String(v).trim();
  return null;
}

export function inferImageExt(ct = "", fp = "") {
  const c = ct.toLowerCase();
  const f = fp.toLowerCase();
  if (c.includes("image/png") || f.endsWith(".png")) return "png";
  if (c.includes("image/webp") || f.endsWith(".webp")) return "webp";
  if (c.includes("image/heic") || f.endsWith(".heic")) return "heic";
  return "jpg";
}

export function inferMediaExt(ct = "", fp = "", fallback = "bin") {
  const c = ct.toLowerCase();
  const f = fp.toLowerCase();
  if (c.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(f)) return inferImageExt(ct, fp);
  if (c.includes("video/mp4") || f.endsWith(".mp4")) return "mp4";
  if (c.includes("video/webm") || f.endsWith(".webm")) return "webm";
  if (c.includes("video/quicktime") || f.endsWith(".mov")) return "mov";
  if (c.includes("video/")) return "mp4";
  if (c.includes("audio/mpeg") || f.endsWith(".mp3")) return "mp3";
  if (c.includes("audio/ogg") || f.endsWith(".ogg")) return "ogg";
  if (c.includes("audio/")) return "mp3";
  return fallback;
}

export function normalizeLegacyAction(text = "") {
  const t = String(text || "").trim().toLowerCase();
  if (["cancel", "❌ cancel", "❌cancel"].includes(t)) return "cancel";
  if (["skip", "⏩ skip"].includes(t)) return "skip";
  if (["done", "✅ done", "finish", "finished"].includes(t)) return "done";
  if (["menu", "/menu", "🏠 menu", "home", "🏠 home"].includes(t)) return "home";
  return t.replace(/^(\/|🔧|🏠|🧬|🎬|🔞|🎤|🧍|⚙️|💳|🌐|📥|🕘)\s*/u, "").trim();
}
