import { Router } from "express";
import {
  answerCallbackQuery,
  sendMessage,
  setMyCommands,
} from "../../services/telegramBot.js";
import prisma from "../../lib/prisma.js";

const router = Router();
const miniAppBaseUrl = (process.env.TELEGRAM_MINI_APP_URL || "https://modelclone.app").replace(/\/$/, "");
let commandsInitialized = false;
const chatModeMap = new Map();
const pendingLegacyAction = new Map();
const MODE_MINI = "mini";
const MODE_LEGACY = "legacy";

const COMMANDS = [
  { command: "start", description: "Open ModelClone bot menu" },
  { command: "menu", description: "Show command menu" },
  { command: "mode", description: "Switch Mini App / Legacy bot mode" },
  { command: "app", description: "Open ModelClone studio" },
  { command: "dashboard", description: "Open dashboard" },
  { command: "models", description: "Open my avatars" },
  { command: "generate", description: "Open create with avatar" },
  { command: "creator", description: "Open Creator Studio" },
  { command: "history", description: "Open history" },
  { command: "settings", description: "Open settings" },
  { command: "pricing", description: "View pricing" },
  { command: "help", description: "Get support links" },
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
      ["Generate", "Models", "Dashboard"],
      ["History", "Settings", "Pricing"],
      ["Help", "Open Mini App", "Switch Mode"],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function legacyMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Generate", callback_data: "legacy:generate" },
        { text: "Models", callback_data: "legacy:models" },
      ],
      [
        { text: "Dashboard", callback_data: "legacy:dashboard" },
        { text: "History", callback_data: "legacy:history" },
      ],
      [
        { text: "Settings", callback_data: "legacy:settings" },
        { text: "Pricing", callback_data: "legacy:pricing" },
      ],
      [
        { text: "Help", callback_data: "legacy:help" },
        { text: "Open Mini App", web_app: { url: miniAppBaseUrl } },
      ],
      [{ text: "Switch to Mini App mode", callback_data: "mode:set:mini" }],
    ],
  };
}

function submenuKeyboard(type) {
  if (type === "create") {
    return {
      inline_keyboard: [
        [{ text: "Create with Avatar", web_app: { url: buildSectionUrl("generate") } }],
        [{ text: "Creator Studio", web_app: { url: buildSectionUrl("creator") } }],
        [{ text: "My Avatars", web_app: { url: buildSectionUrl("models") } }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  if (type === "account") {
    return {
      inline_keyboard: [
        [{ text: "Dashboard", web_app: { url: buildSectionUrl("dashboard") } }],
        [{ text: "History", web_app: { url: buildSectionUrl("history") } }],
        [{ text: "Settings", web_app: { url: buildSectionUrl("settings") } }],
        [{ text: "Referral Program", web_app: { url: buildSectionUrl("referral") } }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  if (type === "tools") {
    return {
      inline_keyboard: [
        [{ text: "Reformatter", web_app: { url: buildSectionUrl("reformatter") } }],
        [{ text: "First Frame Extractor", web_app: { url: buildSectionUrl("frame") } }],
        [{ text: "Upscaler", web_app: { url: buildSectionUrl("upscaler") } }],
        [{ text: "ModelClone-X", web_app: { url: buildSectionUrl("modelclonex") } }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  if (type === "monetize") {
    return {
      inline_keyboard: [
        [{ text: "Repurposer", web_app: { url: buildSectionUrl("repurposer") } }],
        [{ text: "Reel Finder", web_app: { url: buildSectionUrl("reelfinder") } }],
        [{ text: "NSFW Studio", web_app: { url: buildSectionUrl("nsfw") } }],
        [{ text: "Back", callback_data: "menu:main" }],
      ],
    };
  }
  return mainMenuKeyboard();
}

async function getTelegramUserSnapshot(telegramUserId) {
  const telegramId = String(telegramUserId || "");
  if (!telegramId) return null;
  return prisma.user.findFirst({
    where: { telegram_id: telegramId },
    select: {
      id: true,
      email: true,
      name: true,
      credits: true,
      subscriptionCredits: true,
      purchasedCredits: true,
      subscriptionStatus: true,
      createdAt: true,
    },
  });
}

async function sendMainMenu(chatId, firstName = "") {
  const greeting = firstName ? `Hi ${firstName}!` : "Hi!";
  const text =
    `${greeting} Use commands or buttons to navigate ModelClone.\n\n` +
    "You can access every app section directly from this bot menu.";
  await sendMessage(chatId, text, mainMenuKeyboard());
}

async function sendLegacyMenu(chatId, firstName = "") {
  const greeting = firstName ? `Hi ${firstName}!` : "Hi!";
  const text =
    `${greeting} Legacy Bot mode is active.\n\n` +
    "Use the classic keyboard or tap buttons below to use ModelClone directly in chat.";
  await sendMessage(chatId, text, legacyReplyKeyboard());
  await sendMessage(chatId, "Legacy actions:", legacyMainKeyboard());
}

async function handleLegacyAction(chatId, action, telegramUserId) {
  if (action === "generate") {
    pendingLegacyAction.set(String(chatId), "await_generate_prompt");
    await sendMessage(
      chatId,
      "Send me your generation prompt now. I will prepare it and route it into your generation flow.",
      legacyMainKeyboard(),
    );
    return;
  }
  if (action === "models") {
    await sendMessage(
      chatId,
      "Manage avatars from chat:\n- Use /models to open the avatar list\n- Use /generate after selecting your avatar",
      {
        inline_keyboard: [[{ text: "Open My Avatars", web_app: { url: buildSectionUrl("models") } }]],
      },
    );
    return;
  }
  if (action === "dashboard") {
    const user = await getTelegramUserSnapshot(telegramUserId);
    if (!user) {
      await sendMessage(
        chatId,
        "Your Telegram account is not linked yet. Open Mini App once and sign in to sync account data.",
        {
          inline_keyboard: [[{ text: "Open Studio", web_app: { url: miniAppBaseUrl } }]],
        },
      );
      return;
    }
    const totalCredits = Number(user.credits ?? 0) || 0;
    const subCredits = Number(user.subscriptionCredits ?? 0) || 0;
    const purchased = Number(user.purchasedCredits ?? 0) || 0;
    await sendMessage(
      chatId,
      `Account: ${user.name || user.email || "User"}\n` +
        `Credits: ${totalCredits}\nSubscription credits: ${subCredits}\nPurchased credits: ${purchased}\n` +
        `Plan: ${user.subscriptionStatus || "trial"}`,
      legacyMainKeyboard(),
    );
    return;
  }
  if (action === "history") {
    await sendMessage(
      chatId,
      "History is available in app view. Tap below to open directly.",
      {
        inline_keyboard: [[{ text: "Open History", web_app: { url: buildSectionUrl("history") } }]],
      },
    );
    return;
  }
  if (action === "settings") {
    await sendMessage(
      chatId,
      "Settings and account security controls are available in app settings.",
      {
        inline_keyboard: [[{ text: "Open Settings", web_app: { url: buildSectionUrl("settings") } }]],
      },
    );
    return;
  }
  if (action === "pricing") {
    await sendMessage(
      chatId,
      "Pricing and plans are available in the credits screen.",
      {
        inline_keyboard: [[{ text: "Open Pricing", web_app: { url: `${miniAppBaseUrl}/dashboard?openCredits=true` } }]],
      },
    );
    return;
  }
  if (action === "help") {
    await sendMessage(
      chatId,
      "Support:\n- Telegram: https://t.me/modelclonechat\n- Discord: https://discord.gg/vpwGygjEaB",
      legacyMainKeyboard(),
    );
    return;
  }

  // Fallback: route any remaining section action to app deep-link.
  await sendMessage(
    chatId,
    `Open ${action} in the app:`,
    {
      inline_keyboard: [[{ text: `Open ${action}`, web_app: { url: buildSectionUrl(action) } }]],
    },
  );
}

async function handleCommand(chatId, command, firstName = "", telegramUserId = null) {
  if (command === "start") {
    await sendMessage(
      chatId,
      "Choose how you want to use ModelClone:",
      modeChooserKeyboard(),
    );
    return;
  }

  if (command === "mode") {
    await sendMessage(chatId, "Choose your preferred interaction mode:", modeChooserKeyboard());
    return;
  }

  const mode = getChatMode(chatId);

  if (mode === MODE_LEGACY && command === "menu") {
    await sendLegacyMenu(chatId, firstName);
    return;
  }

  if (mode === MODE_LEGACY && command === "help") {
    await handleLegacyAction(chatId, "help", telegramUserId);
    return;
  }

  if (mode === MODE_LEGACY && command === "pricing") {
    await handleLegacyAction(chatId, "pricing", telegramUserId);
    return;
  }

  if (mode === MODE_LEGACY && sectionTabs[command]) {
    await handleLegacyAction(chatId, command, telegramUserId);
    return;
  }

  if (command === "menu") {
    await sendMainMenu(chatId, firstName);
    return;
  }

  if (command === "help") {
    await sendMessage(
      chatId,
      "Support:\n- Telegram: https://t.me/modelclonechat\n- Discord: https://discord.gg/vpwGygjEaB",
      {
        inline_keyboard: [[{ text: "Open Menu", callback_data: "menu:main" }]],
      },
    );
    return;
  }

  if (command === "pricing") {
    await sendMessage(
      chatId,
      "Pricing and plans are available inside the app. Tap below to open plans instantly.",
      {
        inline_keyboard: [[{ text: "Open Pricing", web_app: { url: `${miniAppBaseUrl}/dashboard?openCredits=true` } }]],
      },
    );
    return;
  }

  if (command === "app") {
    await sendMessage(chatId, "Open ModelClone Studio:", {
      inline_keyboard: [[{ text: "Open Studio", web_app: { url: miniAppBaseUrl } }]],
    });
    return;
  }

  if (sectionTabs[command]) {
    await sendMessage(chatId, `Open ${command} in ModelClone:`, {
      inline_keyboard: [[{ text: `Open ${command}`, web_app: { url: buildSectionUrl(command) } }]],
    });
    return;
  }

  await sendMessage(
    chatId,
    "Unknown command. Use /menu to open navigation.",
    { inline_keyboard: [[{ text: "Open Menu", callback_data: "menu:main" }]] },
  );
}

function normalizeLegacyTextAction(rawText = "") {
  const text = String(rawText || "").trim().toLowerCase();
  if (text === "generate") return "generate";
  if (text === "models") return "models";
  if (text === "dashboard") return "dashboard";
  if (text === "history") return "history";
  if (text === "settings") return "settings";
  if (text === "pricing") return "pricing";
  if (text === "help") return "help";
  if (text === "open mini app") return "open_mini_app";
  if (text === "switch mode") return "switch_mode";
  return null;
}

async function handleLegacyPlainMessage(message) {
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();
  const telegramUserId = message?.from?.id;
  if (!chatId || !text) return false;
  const pending = pendingLegacyAction.get(String(chatId));
  if (pending === "await_generate_prompt") {
    pendingLegacyAction.delete(String(chatId));
    await sendMessage(
      chatId,
      `Prompt received:\n"${text}"\n\n` +
        "Generation execution is routed through the app engine. Tap below to generate with this prompt.",
      {
        inline_keyboard: [
          [{ text: "Open Generate", web_app: { url: `${buildSectionUrl("generate")}&prefillPrompt=${encodeURIComponent(text)}` } }],
          [{ text: "Generate another prompt", callback_data: "legacy:generate" }],
        ],
      },
    );
    return true;
  }

  const action = normalizeLegacyTextAction(text);
  if (!action) return false;
  if (action === "open_mini_app") {
    await sendMessage(chatId, "Open ModelClone Mini App:", {
      inline_keyboard: [[{ text: "Open Studio", web_app: { url: miniAppBaseUrl } }]],
    });
    return true;
  }
  if (action === "switch_mode") {
    await sendMessage(chatId, "Choose interaction mode:", modeChooserKeyboard());
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

  if (data.startsWith("mode:set:")) {
    const mode = data.endsWith(":legacy") ? MODE_LEGACY : MODE_MINI;
    setChatMode(chatId, mode);
    pendingLegacyAction.delete(String(chatId));
    await answerCallbackQuery(callbackId, mode === MODE_LEGACY ? "Legacy mode enabled" : "Mini App mode enabled");
    if (mode === MODE_LEGACY) {
      await sendLegacyMenu(chatId, callbackQuery?.from?.first_name || "");
      return;
    }
    await sendMainMenu(chatId, callbackQuery?.from?.first_name || "");
    return;
  }

  await answerCallbackQuery(callbackId, "");

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
      await sendMessage(chatId, "Main menu:", mainMenuKeyboard());
    }
    return;
  }
  if (data === "menu:create") {
    await sendMessage(chatId, "Create menu:", submenuKeyboard("create"));
    return;
  }
  if (data === "menu:account") {
    await sendMessage(chatId, "Account menu:", submenuKeyboard("account"));
    return;
  }
  if (data === "menu:tools") {
    await sendMessage(chatId, "Tools menu:", submenuKeyboard("tools"));
    return;
  }
  if (data === "menu:monetize") {
    await sendMessage(chatId, "Monetize menu:", submenuKeyboard("monetize"));
    return;
  }
  if (data === "menu:pricing") {
    await sendMessage(
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
    await sendMessage(
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
          await sendMessage(
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
