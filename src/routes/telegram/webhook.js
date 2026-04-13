import { Router } from "express";
import { setMyCommands } from "../../services/telegramBot.js";
import { hydrateState, persistNow, getSession, getFlow, clearFlow } from "./legacy/state.js";
import { send, answerCb, toCmd, normalizeLegacyAction, inlineKbd, removeKbd } from "./legacy/helpers.js";
import { COMMANDS, MODE_LEGACY, MINI_APP_BASE } from "./legacy/config.js";
import { getMode, setMode } from "./legacy/state.js";
import { detectMediaTypes } from "./legacy/media.js";
import { mainKbd, loginKbd, dashboardKbd } from "./legacy/keyboards.js";

// ── Import section handlers ───────────────────────────────────
import { renderDashboard } from "./legacy/dashboard.js";
import { handleAuthCallback, handleAuthMessage, sendLoginPrompt, handleLogout, parseInlineLogin, handleInlineLogin, attemptTelegramAuth, ensureAuth } from "./legacy/auth.js";
import { handleModelsCallback, handleModelsMessage } from "./legacy/models.js";
import { handleGenerateCallback, handleGenerateMessage, refreshGeneration } from "./legacy/generate.js";
import { handleNsfwCallback, handleNsfwMessage } from "./legacy/nsfw.js";
import { handleToolsCallback, handleToolsMessage } from "./legacy/tools.js";
import { handleHistoryCallback, renderHistory, renderQueue } from "./legacy/history.js";
import { handleVoiceCallback, handleVoiceMessage, renderVoiceStudio } from "./legacy/voice.js";
import { handleAvatarsCallback, handleAvatarsMessage, renderAvatarMenu } from "./legacy/avatars.js";
import { handleSettingsCallback, handleSettingsMessage, renderSettings, renderPricing, renderAppHub } from "./legacy/settings.js";
import { handleMcxCallback, handleMcxMessage, renderMcxMenu } from "./legacy/mcx.js";
import { handleReferralCallback, handleReferralMessage, renderReferral } from "./legacy/referral.js";

const router = Router();
let commandsReady = false;

// ── Command handler ───────────────────────────────────────────
async function handleCommand(chatId, command, firstName = "", telegramUserId = null) {
  const session = getSession(chatId);

  if (command === "start" || command === "menu") {
    if (!session?.userId) {
      await send(chatId, `👋 Welcome${firstName ? " " + firstName : ""} to ModelClone!\n\nCreate AI model content — photos, videos, voice clones, avatars and more.\n\n📱 Full studio in the Mini App\n🤖 Chat bot for quick access`, inlineKbd([
        [{ text: "📱 Open Mini App", web_app: { url: MINI_APP_BASE } }],
        [{ text: "🔐 Log in to bot", callback_data: "auth:email" }],
        [{ text: "Telegram Login", callback_data: "auth:telegram" }],
      ]));
    } else {
      await renderDashboard(chatId, session.userId);
    }
    return;
  }

  if (command === "mode") {
    const current = getMode(chatId);
    await send(chatId, `Current mode: ${current}\n\nSwitch to:`, inlineKbd([
      [{ text: "🤖 Legacy Bot (chat UI)", callback_data: "mode:legacy" }],
      [{ text: "📱 Mini App mode", callback_data: "mode:mini" }],
    ]));
    return;
  }

  if (command === "login") {
    if (session?.userId) { await send(chatId, "You're already logged in.", inlineKbd([[{ text: "🏠 Dashboard", callback_data: "nav:home" }]])); return; }
    await sendLoginPrompt(chatId, firstName ? `Hey ${firstName}` : "");
    return;
  }

  if (command === "logout") {
    await handleLogout(chatId); return;
  }

  if (command === "app") {
    await send(chatId, "📱 Open ModelClone Mini App:", inlineKbd([[{ text: "Open App", web_app: { url: MINI_APP_BASE } }]]));
    return;
  }

  if (command === "apphub") {
    if (!session?.userId) { await sendLoginPrompt(chatId); return; }
    await renderAppHub(chatId);
    return;
  }

  if (command === "help") {
    await send(chatId, "Need help?\n\nTelegram: https://t.me/modelclonechat\nDiscord: https://discord.gg/vpwGygjEaB", inlineKbd([[{ text: "🏠 Home", callback_data: "nav:home" }]]));
    return;
  }

  // All commands below require auth
  if (!session?.userId) { await sendLoginPrompt(chatId, firstName ? `Hey ${firstName}` : ""); return; }
  const userId = session.userId;

  const navMap = {
    dashboard: () => renderDashboard(chatId, userId),
    home:      () => renderDashboard(chatId, userId),
    models:    () => handleModelsCallback(chatId, "nav:models"),
    generate:  () => handleGenerateCallback(chatId, "nav:generate"),
    history:   () => renderHistory(chatId, userId, 0),
    queue:     () => renderQueue(chatId, userId),
    voice:     () => renderVoiceStudio(chatId, userId),
    avatars:   () => renderAvatarMenu(chatId, userId),
    settings:  () => renderSettings(chatId, userId),
    pricing:   () => renderPricing(chatId, userId),
    upscaler:  () => handleToolsCallback(chatId, "tools:upscaler"),
    reformatter: () => handleToolsCallback(chatId, "tools:reformatter"),
    repurposer: () => handleToolsCallback(chatId, "tools:repurposer"),
    mcx:       () => renderMcxMenu(chatId),
    referral:  () => renderReferral(chatId, session?.userId || ""),
  };

  if (navMap[command]) { await navMap[command](); return; }
}

// ── Callback dispatcher ───────────────────────────────────────
async function handleCallback(callbackQuery) {
  const chatId = callbackQuery?.message?.chat?.id;
  const data = String(callbackQuery?.data || "").trim();
  const callbackId = callbackQuery?.id || "";
  if (!chatId || !data) return;

  await answerCb(callbackId).catch(() => {});

  if (data === "noop") return;

  if (data === "nav:home") {
    const s = getSession(chatId);
    if (s?.userId) await renderDashboard(chatId, s.userId);
    else await sendLoginPrompt(chatId);
    return;
  }

  if (data === "mode:legacy" || data === "mode:mini") {
    const mode = data === "mode:legacy" ? MODE_LEGACY : "mini";
    setMode(chatId, mode);
    const label = mode === MODE_LEGACY ? "Legacy Bot mode" : "Mini App mode";
    await send(chatId, `✅ Switched to ${label}.`, mode === MODE_LEGACY ? mainKbd() : inlineKbd([[{ text: "📱 Open App", web_app: { url: MINI_APP_BASE } }]]));
    return;
  }

  // Route to section handlers in priority order
  const handlers = [
    handleAuthCallback,
    handleModelsCallback,
    handleGenerateCallback,
    handleNsfwCallback,
    handleToolsCallback,
    handleHistoryCallback,
    handleVoiceCallback,
    handleAvatarsCallback,
    handleSettingsCallback,
    handleMcxCallback,
    handleReferralCallback,
  ];

  for (const handler of handlers) {
    try {
      const handled = await handler(chatId, data, callbackId);
      if (handled) return;
    } catch (e) {
      console.error(`[callback:handler] ${e?.message}`);
    }
  }

  console.warn("[callback] unhandled:", data);
}

// ── Plain message dispatcher ──────────────────────────────────
async function handlePlainMessage(message) {
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();
  if (!chatId) return false;

  const flow = getFlow(chatId);
  const { hasImage, hasVideo, hasAudio } = detectMediaTypes(message);
  const hasContent = text.length > 0 || hasImage || hasVideo || hasAudio;
  if (!hasContent) return false;

  const session = getSession(chatId);

  // Inline login shortcut: "email password"
  if (!flow && !session?.userId && text) {
    const creds = parseInlineLogin(text);
    if (creds) { await handleInlineLogin(chatId, creds.email, creds.password); return true; }
  }

  // Auth flow steps take priority
  if (flow?.step?.startsWith("auth_")) {
    return handleAuthMessage(chatId, text);
  }

  // Cancel / home shortcuts
  const action = normalizeLegacyAction(text);
  if (action === "cancel" && flow) {
    clearFlow(chatId);
    await send(chatId, "Cancelled.", removeKbd());
    if (session?.userId) await renderDashboard(chatId, session.userId);
    else await sendLoginPrompt(chatId);
    return true;
  }
  if ((action === "home" || action === "menu") && session?.userId) {
    clearFlow(chatId);
    await renderDashboard(chatId, session.userId);
    return true;
  }

  // Route message to section flow handlers
  const msgHandlers = [
    handleModelsMessage,
    handleGenerateMessage,
    handleNsfwMessage,
    handleToolsMessage,
    handleVoiceMessage,
    handleAvatarsMessage,
    handleSettingsMessage,
    handleMcxMessage,
    handleReferralMessage,
  ];

  for (const handler of msgHandlers) {
    try {
      const handled = await handler(chatId, message, text);
      if (handled) return true;
    } catch (e) {
      console.error(`[message:handler] ${e?.message}`);
    }
  }

  // No flow matched — nudge user
  if (session?.userId) {
    await send(chatId, "Use the buttons or type /menu for navigation.", inlineKbd([[{ text: "🏠 Home", callback_data: "nav:home" }]]));
  } else {
    await sendLoginPrompt(chatId);
  }
  return true;
}

// ── Main webhook POST ─────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incoming = req.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (secret && incoming !== secret) return res.status(401).json({ ok: false });

  res.json({ ok: true }); // Ack immediately

  const update = req.body || {};
  const message = update.message;
  const callbackQuery = update.callback_query;
  const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;

  if (!chatId) return;

  // Hydrate state from DB (once per process per chatId)
  await hydrateState(chatId).catch(() => {});

  // Init bot commands once
  if (!commandsReady) {
    try { await setMyCommands(COMMANDS); commandsReady = true; } catch {}
  }

  try {
    if (message) {
      const text = String(message?.text || "").trim();
      const isCommand = text.startsWith("/");
      if (isCommand) {
        const command = toCmd(text);
        await handleCommand(chatId, command, message?.from?.first_name || "", message?.from?.id || null);
      } else {
        await handlePlainMessage(message);
      }
    }
    if (callbackQuery) {
      await handleCallback(callbackQuery);
    }
  } catch (e) {
    console.error("[webhook] error:", e?.message, e?.stack);
  } finally {
    await persistNow(String(chatId)).catch(() => {});
  }
});

export default router;
