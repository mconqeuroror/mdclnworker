import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  answerCallbackQuery,
  deleteMessage,
  sendMessage,
  setMyCommands,
} from "../../services/telegramBot.js";
import prisma from "../../lib/prisma.js";

const router = Router();
const miniAppBaseUrl = (process.env.TELEGRAM_MINI_APP_URL || "https://modelclone.app").replace(/\/$/, "");
let commandsInitialized = false;
const chatModeMap = new Map();
const legacySessionMap = new Map();
const legacyFlowMap = new Map();
const lastBotMessagesMap = new Map();
const MODE_MINI = "mini";
const MODE_LEGACY = "legacy";

const COMMANDS = [
  { command: "start", description: "Open ModelClone bot menu" },
  { command: "menu", description: "Show command menu" },
  { command: "mode", description: "Switch Mini App / Legacy bot mode" },
  { command: "login", description: "Login with email/password in chat" },
  { command: "logout", description: "Logout from legacy mode" },
  { command: "models", description: "List and manage your models" },
  { command: "dashboard", description: "Show account stats" },
  { command: "history", description: "Show recent generations" },
  { command: "generate", description: "Start legacy prompt flow" },
  { command: "pricing", description: "Show pricing info" },
  { command: "help", description: "Get support links" },
  { command: "app", description: "Open ModelClone Mini App" },
];

const sectionTabs = {
  dashboard: "home",
  models: "models",
  generate: "generate",
  creator: "creator-studio",
  voice: "voice-studio",
  reformatter: "reformatter",
  frame: "frame-extractor",
  upscaler: "upscaler",
  modelclonex: "modelclone-x",
  history: "history",
  settings: "settings",
  nsfw: "nsfw",
  course: "course",
  repurposer: "repurposer",
  reelfinder: "reelfinder",
  referral: "referral",
};

function toCommand(text = "") {
  return String(text || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/^\/+/, "")
    .split("@")[0];
}

function getChatMode(chatId) {
  return chatModeMap.get(String(chatId)) || MODE_MINI;
}

function setChatMode(chatId, mode) {
  chatModeMap.set(String(chatId), mode === MODE_LEGACY ? MODE_LEGACY : MODE_MINI);
}

function buildSectionUrl(sectionKey) {
  const tab = sectionTabs[sectionKey];
  if (!tab) return miniAppBaseUrl;
  return `${miniAppBaseUrl}/dashboard?tab=${encodeURIComponent(tab)}`;
}

function setSession(chatId, session) {
  legacySessionMap.set(String(chatId), session);
}

function getSession(chatId) {
  return legacySessionMap.get(String(chatId)) || null;
}

function clearSession(chatId) {
  legacySessionMap.delete(String(chatId));
}

function setFlow(chatId, flow) {
  legacyFlowMap.set(String(chatId), flow);
}

function getFlow(chatId) {
  return legacyFlowMap.get(String(chatId)) || null;
}

function clearFlow(chatId) {
  legacyFlowMap.delete(String(chatId));
}

async function clearTrackedBotMessages(chatId) {
  const key = String(chatId);
  const tracked = lastBotMessagesMap.get(key) || [];
  for (const messageId of tracked) {
    try {
      await deleteMessage(chatId, messageId);
    } catch {
      // Ignore cleanup errors; some messages can no longer be deleted.
    }
  }
  lastBotMessagesMap.set(key, []);
}

async function sendTrackedMessage(chatId, text, replyMarkup) {
  await clearTrackedBotMessages(chatId);
  const sent = await sendMessage(chatId, text, replyMarkup);
  if (sent?.message_id) {
    lastBotMessagesMap.set(String(chatId), [sent.message_id]);
  }
  return sent;
}

function modeChooserKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Mini App mode", callback_data: "mode:set:mini" },
        { text: "Legacy Bot mode", callback_data: "mode:set:legacy" },
      ],
      [{ text: "Open Studio", web_app: { url: miniAppBaseUrl } }],
    ],
  };
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Open Studio", web_app: { url: miniAppBaseUrl } }],
      [
        { text: "Create", callback_data: "menu:create" },
        { text: "Account", callback_data: "menu:account" },
      ],
      [
        { text: "Tools", callback_data: "menu:tools" },
        { text: "Monetize", callback_data: "menu:monetize" },
      ],
      [
        { text: "Pricing", callback_data: "menu:pricing" },
        { text: "Help", callback_data: "menu:help" },
      ],
    ],
  };
}

function legacyReplyKeyboard() {
  return {
    keyboard: [
      ["Login", "Models", "Dashboard"],
      ["History", "Pricing", "Help"],
      ["Generate", "Logout", "Switch Mode"],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function legacyMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Login", callback_data: "legacy:login" },
        { text: "Logout", callback_data: "legacy:logout" },
      ],
      [
        { text: "Models", callback_data: "legacy:models" },
        { text: "Generate", callback_data: "legacy:generate" },
      ],
      [
        { text: "Dashboard", callback_data: "legacy:dashboard" },
        { text: "History", callback_data: "legacy:history" },
      ],
      [
        { text: "Pricing", callback_data: "legacy:pricing" },
        { text: "Help", callback_data: "legacy:help" },
      ],
      [{ text: "Switch to Mini App mode", callback_data: "mode:set:mini" }],
    ],
  };
}

function submenuKeyboard(type) {
  if (type === "create") {
    return {
      inline_keyboard: [
        [{ text: "Start Prompt Flow", callback_data: "legacy:generate" }],
        [{ text: "List Models", callback_data: "legacy:models" }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  if (type === "account") {
    return {
      inline_keyboard: [
        [{ text: "Dashboard", callback_data: "legacy:dashboard" }],
        [{ text: "History", callback_data: "legacy:history" }],
        [{ text: "Login", callback_data: "legacy:login" }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  if (type === "tools") {
    return {
      inline_keyboard: [
        [{ text: "Models", callback_data: "legacy:models" }],
        [{ text: "Pricing", callback_data: "legacy:pricing" }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  if (type === "monetize") {
    return {
      inline_keyboard: [
        [{ text: "Pricing", callback_data: "legacy:pricing" }],
        [{ text: "Help", callback_data: "legacy:help" }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  return mainMenuKeyboard();
}

async function sendMainMenu(chatId, firstName = "") {
  const greeting = firstName ? `Hi ${firstName}!` : "Hi!";
  const text =
    `${greeting} Use commands or buttons to navigate ModelClone.\n\n` +
    "You can access every app section directly from this bot menu.";
  await sendTrackedMessage(chatId, text, mainMenuKeyboard());
}

async function sendLegacyMenu(chatId, firstName = "") {
  const greeting = firstName ? `Hi ${firstName}!` : "Hi!";
  const text =
    `${greeting} Legacy Bot mode is active.\n\n` +
    "This mode is fully chat-based (no Mini App links).";
  await sendTrackedMessage(chatId, text, legacyReplyKeyboard());
  await sendTrackedMessage(chatId, "Legacy actions:", legacyMainKeyboard());
}

async function ensureLegacyAuth(chatId) {
  const session = getSession(chatId);
  if (session?.userId) return session;
  await sendTrackedMessage(
    chatId,
    "Legacy mode requires chat login. Press Login to continue.",
    legacyMainKeyboard(),
  );
  return null;
}

async function sendModelsList(chatId, userId) {
  const models = await prisma.savedModel.findMany({
    where: { userId },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (!models.length) {
    await sendTrackedMessage(chatId, "No models found yet.", legacyMainKeyboard());
    return;
  }
  const rows = models.map((model) => [
    {
      text: `${model.name} (${model.status || "ready"})`,
      callback_data: `legacy:model:open:${model.id}`,
    },
  ]);
  rows.push([{ text: "Back", callback_data: "menu:main" }]);
  await sendTrackedMessage(chatId, "Your models:", { inline_keyboard: rows });
}

async function handleLegacyAction(chatId, action, telegramUserId) {
  if (action === "login") {
    setFlow(chatId, { step: "await_email" });
    await sendTrackedMessage(chatId, "Enter your email:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (action === "logout") {
    clearSession(chatId);
    clearFlow(chatId);
    await sendTrackedMessage(chatId, "Logged out from legacy chat mode.", legacyMainKeyboard());
    return;
  }

  if (action === "help") {
    await sendTrackedMessage(
      chatId,
      "Support:\n- Telegram: https://t.me/modelclonechat\n- Discord: https://discord.gg/vpwGygjEaB",
      legacyMainKeyboard(),
    );
    return;
  }

  if (action === "pricing") {
    await sendTrackedMessage(
      chatId,
      "Pricing overview:\n- Free trial available\n- Credit packs for one-time usage\n- Subscription plans for recurring credits",
      legacyMainKeyboard(),
    );
    return;
  }

  const session = await ensureLegacyAuth(chatId);
  if (!session) return;

  if (action === "generate") {
    setFlow(chatId, { step: "await_generate_prompt" });
    await sendTrackedMessage(
      chatId,
      "Send your generation prompt now.",
      legacyMainKeyboard(),
    );
    return;
  }

  if (action === "models") {
    await sendModelsList(chatId, session.userId);
    return;
  }

  if (action === "dashboard") {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        name: true,
        email: true,
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true,
        subscriptionStatus: true,
      },
    });
    if (!user) {
      clearSession(chatId);
      await sendTrackedMessage(chatId, "Session expired. Please login again.", legacyMainKeyboard());
      return;
    }
    const totalCredits = Number(user.credits ?? 0) || 0;
    const subCredits = Number(user.subscriptionCredits ?? 0) || 0;
    const purchased = Number(user.purchasedCredits ?? 0) || 0;
    await sendTrackedMessage(
      chatId,
      `Account: ${user.name || user.email || "User"}\n` +
        `Credits: ${totalCredits}\nSubscription credits: ${subCredits}\nPurchased credits: ${purchased}\n` +
        `Plan: ${user.subscriptionStatus || "trial"}`,
      legacyMainKeyboard(),
    );
    return;
  }

  if (action === "history") {
    const rows = await prisma.generation.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { type: true, status: true, createdAt: true },
    });
    if (!rows.length) {
      await sendTrackedMessage(chatId, "No generation history yet.", legacyMainKeyboard());
      return;
    }
    const lines = rows.map(
      (item, index) =>
        `${index + 1}. ${item.type} • ${item.status} • ${new Date(item.createdAt).toLocaleString()}`,
    );
    await sendTrackedMessage(chatId, `Recent generations:\n${lines.join("\n")}`, legacyMainKeyboard());
    return;
  }

  await sendTrackedMessage(
    chatId,
    `Action "${action}" is not available yet in pure legacy mode.`,
    legacyMainKeyboard(),
  );

  if (telegramUserId) {
    await prisma.user
      .update({
        where: { id: session.userId },
        data: { telegram_id: String(telegramUserId), is_telegram: true },
      })
      .catch(() => {});
  }
}

async function handleCommand(chatId, command, firstName = "", telegramUserId = null) {
  if (command === "start") {
    await sendTrackedMessage(chatId, "Choose how you want to use ModelClone:", modeChooserKeyboard());
    return;
  }

  if (command === "mode") {
    await sendTrackedMessage(chatId, "Choose your preferred interaction mode:", modeChooserKeyboard());
    return;
  }

  const mode = getChatMode(chatId);

  if (mode === MODE_LEGACY && command === "menu") {
    await sendLegacyMenu(chatId, firstName);
    return;
  }

  if (mode === MODE_LEGACY && ["login", "logout", "help", "pricing", "models", "dashboard", "generate", "history"].includes(command)) {
    await handleLegacyAction(chatId, command, telegramUserId);
    return;
  }

  if (mode === MODE_LEGACY && command === "app") {
    await sendTrackedMessage(chatId, "Legacy mode is chat-only. Use /mode to switch to Mini App mode.");
    return;
  }

  if (command === "menu") {
    await sendMainMenu(chatId, firstName);
    return;
  }

  if (command === "help") {
    await sendTrackedMessage(
      chatId,
      "Support:\n- Telegram: https://t.me/modelclonechat\n- Discord: https://discord.gg/vpwGygjEaB",
      { inline_keyboard: [[{ text: "Open Menu", callback_data: "menu:main" }]] },
    );
    return;
  }

  if (command === "pricing") {
    await sendTrackedMessage(
      chatId,
      "Pricing and plans are available inside the app. Tap below to open plans instantly.",
      {
        inline_keyboard: [[{ text: "Open Pricing", web_app: { url: `${miniAppBaseUrl}/dashboard?openCredits=true` } }]],
      },
    );
    return;
  }

  if (command === "app") {
    await sendTrackedMessage(chatId, "Open ModelClone Studio:", {
      inline_keyboard: [[{ text: "Open Studio", web_app: { url: miniAppBaseUrl } }]],
    });
    return;
  }

  if (sectionTabs[command]) {
    await sendTrackedMessage(chatId, `Open ${command} in ModelClone:`, {
      inline_keyboard: [[{ text: `Open ${command}`, web_app: { url: buildSectionUrl(command) } }]],
    });
    return;
  }

  await sendTrackedMessage(
    chatId,
    "Unknown command. Use /menu to open navigation.",
    { inline_keyboard: [[{ text: "Open Menu", callback_data: "menu:main" }]] },
  );
}

function normalizeLegacyTextAction(rawText = "") {
  const text = String(rawText || "").trim().toLowerCase();
  if (text === "cancel") return "cancel";
  if (text === "login") return "login";
  if (text === "logout") return "logout";
  if (text === "generate") return "generate";
  if (text === "models") return "models";
  if (text === "dashboard") return "dashboard";
  if (text === "history") return "history";
  if (text === "pricing") return "pricing";
  if (text === "help") return "help";
  if (text === "switch mode") return "switch_mode";
  return null;
}

async function handleLegacyPlainMessage(message) {
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();
  const telegramUserId = message?.from?.id;
  if (!chatId || !text) return false;

  const flow = getFlow(chatId);
  if (flow?.step === "await_email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      await sendTrackedMessage(chatId, "Invalid email format. Enter a valid email:", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    setFlow(chatId, { step: "await_password", email: text.toLowerCase() });
    await sendTrackedMessage(chatId, "Enter your password:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return true;
  }

  if (flow?.step === "await_password") {
    const user = await prisma.user.findUnique({
      where: { email: String(flow.email || "").toLowerCase() },
      select: {
        id: true,
        email: true,
        password: true,
        authProvider: true,
        isVerified: true,
        banLocked: true,
      },
    });
    if (!user || user.authProvider !== "email" || !user.password) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "No email/password account found for this email.", legacyMainKeyboard());
      return true;
    }
    if (user.banLocked) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "This account is suspended.", legacyMainKeyboard());
      return true;
    }
    if (!user.isVerified) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Please verify your email before logging in.", legacyMainKeyboard());
      return true;
    }
    const valid = await bcrypt.compare(text, user.password);
    if (!valid) {
      await sendTrackedMessage(chatId, "Incorrect password. Try again or press Cancel.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    clearFlow(chatId);
    setSession(chatId, { userId: user.id, email: user.email });
    if (telegramUserId) {
      await prisma.user
        .update({
          where: { id: user.id },
          data: { telegram_id: String(telegramUserId), is_telegram: true },
        })
        .catch(() => {});
    }
    await sendTrackedMessage(chatId, "Login successful. Legacy session is active.", legacyMainKeyboard());
    return true;
  }

  if (flow?.step === "await_model_rename") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const newName = text.trim();
    if (newName.length < 2 || newName.length > 80) {
      await sendTrackedMessage(chatId, "Name must be 2-80 chars. Enter a new model name:", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    await prisma.savedModel.updateMany({
      where: { id: flow.modelId, userId: session.userId },
      data: { name: newName },
    });
    clearFlow(chatId);
    await sendTrackedMessage(chatId, `Model renamed to "${newName}".`, legacyMainKeyboard());
    return true;
  }

  if (flow?.step === "await_generate_prompt") {
    clearFlow(chatId);
    await sendTrackedMessage(
      chatId,
      `Prompt received:\n"${text}"\n\nPure chat generation execution can now be wired to your generator endpoints.`,
      legacyMainKeyboard(),
    );
    return true;
  }

  const action = normalizeLegacyTextAction(text);
  if (!action) return false;
  if (action === "cancel") {
    clearFlow(chatId);
    await sendTrackedMessage(chatId, "Cancelled.", legacyMainKeyboard());
    return true;
  }
  if (action === "switch_mode") {
    clearFlow(chatId);
    await sendTrackedMessage(chatId, "Choose interaction mode:", modeChooserKeyboard());
    return true;
  }
  await handleLegacyAction(chatId, action, telegramUserId);
  return true;
}

async function handleCallback(callbackQuery) {
  const data = String(callbackQuery?.data || "");
  const chatId = callbackQuery?.message?.chat?.id;
  const callbackId = callbackQuery?.id;
  const telegramUserId = callbackQuery?.from?.id;
  if (!chatId || !callbackId) return;

  if (callbackQuery?.message?.message_id) {
    await deleteMessage(chatId, callbackQuery.message.message_id).catch(() => {});
  }

  if (data.startsWith("mode:set:")) {
    const mode = data.endsWith(":legacy") ? MODE_LEGACY : MODE_MINI;
    setChatMode(chatId, mode);
    clearFlow(chatId);
    await answerCallbackQuery(callbackId, mode === MODE_LEGACY ? "Legacy mode enabled" : "Mini App mode enabled");
    if (mode === MODE_LEGACY) {
      await sendLegacyMenu(chatId, callbackQuery?.from?.first_name || "");
      return;
    }
    await sendMainMenu(chatId, callbackQuery?.from?.first_name || "");
    return;
  }

  await answerCallbackQuery(callbackId, "");

  if (data.startsWith("legacy:model:open:")) {
    const modelId = data.replace("legacy:model:open:", "");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId: session.userId },
      select: {
        id: true,
        name: true,
        status: true,
        loraStatus: true,
        createdAt: true,
      },
    });
    if (!model) {
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return;
    }
    await sendTrackedMessage(
      chatId,
      `Model: ${model.name}\nStatus: ${model.status || "ready"}\nLoRA: ${model.loraStatus || "n/a"}\nCreated: ${new Date(model.createdAt).toLocaleString()}`,
      {
        inline_keyboard: [
          [{ text: "Rename", callback_data: `legacy:model:rename:${model.id}` }],
          [{ text: "Back to models", callback_data: "legacy:models" }],
        ],
      },
    );
    return;
  }

  if (data.startsWith("legacy:model:rename:")) {
    const modelId = data.replace("legacy:model:rename:", "");
    setFlow(chatId, { step: "await_model_rename", modelId });
    await sendTrackedMessage(chatId, "Enter the new model name:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("legacy:")) {
    const action = data.replace("legacy:", "");
    await handleLegacyAction(chatId, action, telegramUserId);
    return;
  }

  if (data === "menu:main") {
    const mode = getChatMode(chatId);
    if (mode === MODE_LEGACY) {
      await sendLegacyMenu(chatId, callbackQuery?.from?.first_name || "");
    } else {
      await sendTrackedMessage(chatId, "Main menu:", mainMenuKeyboard());
    }
    return;
  }
  if (data === "menu:create") {
    await sendTrackedMessage(chatId, "Create menu:", submenuKeyboard("create"));
    return;
  }
  if (data === "menu:account") {
    await sendTrackedMessage(chatId, "Account menu:", submenuKeyboard("account"));
    return;
  }
  if (data === "menu:tools") {
    await sendTrackedMessage(chatId, "Tools menu:", submenuKeyboard("tools"));
    return;
  }
  if (data === "menu:monetize") {
    await sendTrackedMessage(chatId, "Monetize menu:", submenuKeyboard("monetize"));
    return;
  }
  if (data === "menu:pricing") {
    await sendTrackedMessage(
      chatId,
      "Open the app to view pricing and buy credits.",
      {
        inline_keyboard: [
          [{ text: "Open Pricing", web_app: { url: `${miniAppBaseUrl}/dashboard?openCredits=true` } }],
          [{ text: "Back", callback_data: "menu:main" }],
        ],
      },
    );
    return;
  }
  if (data === "menu:help") {
    await sendTrackedMessage(
      chatId,
      "Need help? Reach us here:\nTelegram: https://t.me/modelclonechat\nDiscord: https://discord.gg/vpwGygjEaB",
      {
        inline_keyboard: [[{ text: "Back", callback_data: "menu:main" }]],
      },
    );
  }
}

router.post("/webhook", async (req, res) => {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = req.get("X-Telegram-Bot-Api-Secret-Token") || "";

  if (configuredSecret && incomingSecret !== configuredSecret) {
    return res.status(401).json({ success: false, message: "Invalid webhook secret." });
  }

  const update = req.body || {};
  const message = update.message;
  const callbackQuery = update.callback_query;

  try {
    if (!commandsInitialized) {
      try {
        await setMyCommands(COMMANDS);
        commandsInitialized = true;
      } catch (error) {
        console.warn("Telegram setMyCommands warning:", error?.message || error);
      }
    }

    if (message?.text && message?.chat?.id) {
      const command = toCommand(message.text);
      const currentMode = getChatMode(message.chat.id);
      if (!message.text.trim().startsWith("/") && currentMode === MODE_LEGACY) {
        const handledLegacyMessage = await handleLegacyPlainMessage(message);
        if (!handledLegacyMessage) {
          await sendTrackedMessage(
            message.chat.id,
            "Legacy mode: use the buttons, or type /menu for full options.",
            legacyMainKeyboard(),
          );
        }
      } else {
        await handleCommand(
          message.chat.id,
          command,
          message?.from?.first_name || "",
          message?.from?.id || null,
        );
      }
    }

    if (callbackQuery) {
      await handleCallback(callbackQuery);
    }

    if (message?.web_app_data?.data) {
      console.log("Telegram web_app_data:", {
        chatId: message.chat?.id,
        fromId: message.from?.id,
        payload: message.web_app_data.data,
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook processing error:", error);
    return res.status(500).json({ success: false, message: "Webhook processing failed." });
  }
});

export default router;
