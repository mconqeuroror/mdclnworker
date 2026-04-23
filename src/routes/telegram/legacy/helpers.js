import {
  sendMessage,
  sendPhoto,
  sendVideo,
  sendDocument,
  sendAnimation,
  answerCallbackQuery as tgAnswer,
  deleteMessage as tgDelete,
  editMessageText as tgEditMessageText,
} from "../../../services/telegramBot.js";
import { trackBotMessage, getTrackedMessages } from "./state.js";

// ── Video generation types — send as video, not photo ─────────
const VIDEO_TYPES = new Set([
  "prompt-video", "video", "face-swap", "talking-head",
  "creator-studio-video", "nsfw-video", "nsfw-video-extend",
]);
function looksLikeVideo(url = "") {
  const u = url.toLowerCase().split("?")[0];
  return u.endsWith(".mp4") || u.endsWith(".mov") || u.endsWith(".webm") || u.endsWith(".mkv");
}

// ── Messaging ─────────────────────────────────────────────────
export async function send(chatId, text, markup = null) {
  const msg = await sendMessage(chatId, text, buildMarkup(markup));
  if (msg?.message_id) trackBotMessage(chatId, msg.message_id);
  return msg;
}

/** Escape text for Telegram HTML (<pre>, etc.). */
export function escapeTelegramHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendHtml(chatId, html, markup = null) {
  const msg = await sendMessage(chatId, html, buildMarkup(markup), { parse_mode: "HTML" });
  if (msg?.message_id) trackBotMessage(chatId, msg.message_id);
  return msg;
}

/** True if this callback sits on a Generate flow menu (safe to edit in place). */
export function isGenerateFlowMenuMessage(message) {
  const t = String(message?.text || "");
  return (
    t === "Choose" ||
    t.startsWith("Choose a picture") ||
    t.startsWith("Choose a video") ||
    t.startsWith("Creator Studio —") ||
    t.includes("Creator Studio") ||
    t.startsWith("🎨 ModelClone-X\n") ||
    t.startsWith("More tools")
  );
}

/** Replace inline menu text+keyboard, or send if no messageId / edit fails. */
export async function editInlineMenu(chatId, messageId, text, markup = null) {
  const rm = buildMarkup(markup);
  if (messageId != null && messageId > 0) {
    try {
      await tgEditMessageText(chatId, messageId, text, rm);
      return { message_id: messageId };
    } catch {
      /* message too old or not text — fall through */
    }
  }
  return send(chatId, text, markup);
}

export async function deleteCallbackMenuMessage(message) {
  const id = message?.message_id;
  if (id != null && id > 0) await tgDelete(message.chat.id, id).catch(() => {});
}

export async function sendImg(chatId, photoUrl, opts = {}) {
  const doc = await sendDocument(chatId, photoUrl, opts).catch(() => null);
  if (doc?.message_id) {
    trackBotMessage(chatId, doc.message_id);
    return doc;
  }
  const msg = await sendPhoto(chatId, photoUrl, opts).catch(() => null);
  if (msg?.message_id) trackBotMessage(chatId, msg.message_id);
  return msg;
}

// ── sendMedia: prefer document (full-quality download); fallback to in-chat photo/video ─
// type = generation type string (e.g. "prompt-video", "nsfw")
// Falls back to text + URL button if Telegram can't handle the file
export async function sendMedia(chatId, url, type = "", opts = {}) {
  if (!url) return null;
  const doc = await sendDocument(chatId, url, opts).catch(() => null);
  if (doc?.message_id) {
    trackBotMessage(chatId, doc.message_id);
    return doc;
  }
  const isVideo = VIDEO_TYPES.has(String(type).toLowerCase()) || looksLikeVideo(url);
  if (isVideo) {
    const msg = await sendVideo(chatId, url, opts).catch(() => null);
    if (msg?.message_id) {
      trackBotMessage(chatId, msg.message_id);
      return msg;
    }
  }
  const msg = await sendPhoto(chatId, url, opts).catch(() => null);
  if (msg?.message_id) {
    trackBotMessage(chatId, msg.message_id);
    return msg;
  }
  return null;
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
    const kb = {
      keyboard: markup.keyboard,
      resize_keyboard: markup.resize_keyboard !== false,
      one_time_keyboard: markup.one_time_keyboard !== false,
    };
    if (markup.is_persistent === true) kb.is_persistent = true;
    return kb;
  }
  if (markup.remove_keyboard) return markup;
  return markup;
}

// ── Keyboard shortcut helpers ─────────────────────────────────
export function inlineKbd(rows) {
  return { inline_keyboard: rows };
}

/** Inline model name: trim, single spaces, truncate for 2-column mobile layout. */
export const TG_MODEL_BTN_TEXT_MAX = 28;

export function formatModelButtonText(name, maxLen = TG_MODEL_BTN_TEXT_MAX) {
  const s = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Unnamed";
  if (s.length <= maxLen) return s;
  if (maxLen < 2) return "…";
  return `${s.slice(0, maxLen - 1)}…`;
}

/** Split flat inline buttons into rows (Telegram allows up to 8 buttons per row). */
export function chunkInlineButtons(buttons, perRow = 2) {
  if (!Array.isArray(buttons) || !buttons.length) return [];
  const n = Math.max(1, Math.min(8, Number(perRow) || 2));
  const rows = [];
  for (let i = 0; i < buttons.length; i += n) {
    rows.push(buttons.slice(i, i + n));
  }
  return rows;
}

/**
 * Grid rows for saved-model pickers. callback_data must stay ≤ 64 bytes.
 * Optional labelFor(m) for custom button text (e.g. NSFW status suffix).
 */
export function modelListToInlineRows(models, buildCallbackData, opts = {}) {
  const perRow = opts.perRow ?? 2;
  const maxLen = opts.maxLabelLen ?? TG_MODEL_BTN_TEXT_MAX;
  const { labelFor } = opts;
  const buttons = models.map((m) => ({
    text: typeof labelFor === "function" ? labelFor(m) : formatModelButtonText(m.name, maxLen),
    callback_data: buildCallbackData(m),
  }));
  return chunkInlineButtons(buttons, perRow);
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
  if (["menu", "/menu", "🏠 menu", "🏠menu", "home", "🏠 home", "🏠home"].includes(t)) return "home";
  return t.replace(/^(\/|🔧|🏠|🧬|🎬|🔞|🎤|🧍|⚙️|💳|🌐|📥|🕘|❓)\s*/u, "").trim();
}
