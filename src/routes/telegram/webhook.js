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
const LEGACY_PAGE_SIZE = 8;
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

function formatDate(dateLike) {
  const value = dateLike ? new Date(dateLike) : null;
  if (!value || Number.isNaN(value.getTime())) return "n/a";
  return value.toLocaleString();
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
        { text: "Home", callback_data: "legacy:home" },
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

async function findEmailUserForLegacyLogin(email) {
  return prisma.user.findFirst({
    where: {
      email: {
        equals: String(email || "").trim(),
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      email: true,
      password: true,
      authProvider: true,
      isVerified: true,
      banLocked: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });
}

async function linkTelegramIdentity(userId, telegramUserId) {
  if (!telegramUserId || !userId) return;
  await prisma.user
    .update({
      where: { id: userId },
      data: { telegram_id: String(telegramUserId), is_telegram: true },
    })
    .catch(() => {});
}

async function verifyEmailPasswordAndBeginSession(chatId, email, password, telegramUserId) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const rawPassword = String(password || "");
  if (!normalizedEmail || !rawPassword) {
    await sendTrackedMessage(chatId, "Email and password are required.", legacyMainKeyboard());
    return false;
  }

  const user = await findEmailUserForLegacyLogin(normalizedEmail);
  const authProvider = user?.authProvider ?? "email";
  const hash = user?.password;

  if (!user) {
    await sendTrackedMessage(chatId, "No account found with this email.", legacyMainKeyboard());
    return false;
  }
  if (authProvider !== "email") {
    await sendTrackedMessage(
      chatId,
      "This account is linked to a non-password provider (Google/Telegram). Use that method, then link Telegram in account settings.",
      legacyMainKeyboard(),
    );
    return false;
  }
  if (typeof hash !== "string" || !hash.startsWith("$2")) {
    await sendTrackedMessage(chatId, "This account cannot use password login yet. Contact support.", legacyMainKeyboard());
    return false;
  }
  if (user.banLocked) {
    await sendTrackedMessage(chatId, "This account is suspended.", legacyMainKeyboard());
    return false;
  }
  if (!user.isVerified) {
    await sendTrackedMessage(chatId, "Please verify your email before logging in.", legacyMainKeyboard());
    return false;
  }

  const valid = await bcrypt.compare(rawPassword, hash);
  if (!valid) {
    await sendTrackedMessage(chatId, "Incorrect password.", legacyMainKeyboard());
    return false;
  }

  if (user.twoFactorEnabled && user.twoFactorSecret) {
    setFlow(chatId, {
      step: "await_2fa",
      userId: user.id,
      email: user.email,
      twoFactorSecret: user.twoFactorSecret,
    });
    await sendTrackedMessage(chatId, "2FA is enabled. Enter your 6-digit authenticator code:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return true;
  }

  clearFlow(chatId);
  setSession(chatId, { userId: user.id, email: user.email });
  await linkTelegramIdentity(user.id, telegramUserId);
  await sendTrackedMessage(chatId, "Login successful. Legacy session is active.", legacyMainKeyboard());
  return true;
}

async function renderLegacyHome(chatId) {
  const session = getSession(chatId);
  const statusLine = session?.userId
    ? `Logged in as: ${session.email || "user"}`
    : "Not logged in yet.";
  await sendTrackedMessage(
    chatId,
    `Legacy Home\n\n${statusLine}\nUse buttons below for full chat-based actions.`,
    legacyMainKeyboard(),
  );
}

async function renderLegacyDashboard(chatId, userId) {
  const [user, modelCount, pendingCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true,
        subscriptionStatus: true,
      },
    }),
    prisma.savedModel.count({ where: { userId } }),
    prisma.generation.count({ where: { userId, status: { in: ["pending", "processing"] } } }),
  ]);

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
      `Plan: ${user.subscriptionStatus || "trial"}\nModels: ${modelCount}\nPending jobs: ${pendingCount}`,
    legacyMainKeyboard(),
  );
}

async function renderModelsList(chatId, userId, page = 0) {
  const safePage = Math.max(0, Number(page) || 0);
  const skip = safePage * LEGACY_PAGE_SIZE;
  const [models, total] = await Promise.all([
    prisma.savedModel.findMany({
      where: { userId },
      select: { id: true, name: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: LEGACY_PAGE_SIZE,
    }),
    prisma.savedModel.count({ where: { userId } }),
  ]);
  if (!models.length) {
    await sendTrackedMessage(chatId, "No models found yet.", legacyMainKeyboard());
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / LEGACY_PAGE_SIZE));
  const rows = models.map((model) => [
    {
      text: `${model.name} (${model.status || "ready"})`,
      callback_data: `legacy:model:open:${model.id}:${safePage}`,
    },
  ]);
  const pager = [];
  if (safePage > 0) pager.push({ text: "Prev", callback_data: `legacy:models:page:${safePage - 1}` });
  if (safePage + 1 < totalPages) pager.push({ text: "Next", callback_data: `legacy:models:page:${safePage + 1}` });
  if (pager.length) rows.push(pager);
  rows.push([{ text: "Back", callback_data: "legacy:home" }]);
  await sendTrackedMessage(
    chatId,
    `Your models (page ${safePage + 1}/${totalPages}):`,
    { inline_keyboard: rows },
  );
}

async function renderModelDetails(chatId, userId, modelId, fromPage = 0) {
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: {
      id: true,
      name: true,
      status: true,
      loraStatus: true,
      nsfwUnlocked: true,
      isAIGenerated: true,
      createdAt: true,
      updatedAt: true,
      age: true,
    },
  });
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  await sendTrackedMessage(
    chatId,
    `Model: ${model.name}\nStatus: ${model.status || "ready"}\nLoRA: ${model.loraStatus || "n/a"}\n` +
      `NSFW unlocked: ${model.nsfwUnlocked ? "yes" : "no"}\nAI generated: ${model.isAIGenerated ? "yes" : "no"}\n` +
      `Age: ${model.age ?? "n/a"}\nCreated: ${formatDate(model.createdAt)}\nUpdated: ${formatDate(model.updatedAt)}`,
    {
      inline_keyboard: [
        [{ text: "Rename", callback_data: `legacy:model:rename:${model.id}:${fromPage}` }],
        [{ text: "Delete", callback_data: `legacy:model:delete:confirm:${model.id}:${fromPage}` }],
        [{ text: "Back to models", callback_data: `legacy:models:page:${fromPage}` }],
      ],
    },
  );
}

async function renderHistoryList(chatId, userId, page = 0) {
  const safePage = Math.max(0, Number(page) || 0);
  const skip = safePage * LEGACY_PAGE_SIZE;
  const [rows, total] = await Promise.all([
    prisma.generation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: LEGACY_PAGE_SIZE,
      skip,
      select: { id: true, type: true, status: true, createdAt: true },
    }),
    prisma.generation.count({ where: { userId } }),
  ]);
  if (!rows.length) {
    await sendTrackedMessage(chatId, "No generation history yet.", legacyMainKeyboard());
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / LEGACY_PAGE_SIZE));
  const keyboard = rows.map((item, index) => [
    {
      text: `${skip + index + 1}. ${item.type} • ${item.status}`,
      callback_data: `legacy:history:item:${item.id}:${safePage}`,
    },
  ]);
  const pager = [];
  if (safePage > 0) pager.push({ text: "Prev", callback_data: `legacy:history:page:${safePage - 1}` });
  if (safePage + 1 < totalPages) pager.push({ text: "Next", callback_data: `legacy:history:page:${safePage + 1}` });
  if (pager.length) keyboard.push(pager);
  keyboard.push([{ text: "Back", callback_data: "legacy:home" }]);
  await sendTrackedMessage(
    chatId,
    `Recent generations (page ${safePage + 1}/${totalPages}):`,
    { inline_keyboard: keyboard },
  );
}

async function renderHistoryItem(chatId, userId, generationId, fromPage = 0) {
  const generation = await prisma.generation.findFirst({
    where: { id: generationId, userId },
    select: {
      id: true,
      type: true,
      status: true,
      prompt: true,
      createdAt: true,
      completedAt: true,
      outputUrl: true,
      creditsCost: true,
      errorMessage: true,
    },
  });
  if (!generation) {
    await sendTrackedMessage(chatId, "Generation not found.", legacyMainKeyboard());
    return;
  }
  await sendTrackedMessage(
    chatId,
    `Generation ${generation.id}\nType: ${generation.type}\nStatus: ${generation.status}\nCredits: ${generation.creditsCost ?? 0}\n` +
      `Created: ${formatDate(generation.createdAt)}\nCompleted: ${formatDate(generation.completedAt)}\n` +
      `Output: ${generation.outputUrl || "n/a"}\n` +
      `Prompt: ${(generation.prompt || "").slice(0, 300) || "n/a"}\n` +
      `${generation.errorMessage ? `Error: ${generation.errorMessage.slice(0, 200)}` : ""}`,
    {
      inline_keyboard: [
        [{ text: "Back to history", callback_data: `legacy:history:page:${fromPage}` }],
      ],
    },
  );
}

async function safeDeleteModel(chatId, userId, modelId, fromPage = 0) {
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: { id: true, name: true },
  });
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  const inProgress = await prisma.generation.count({
    where: { modelId, status: { in: ["pending", "processing"] } },
  });
  if (inProgress > 0) {
    await sendTrackedMessage(
      chatId,
      `Cannot delete "${model.name}" while ${inProgress} generation(s) are still in progress.`,
      {
        inline_keyboard: [[{ text: "Back to model", callback_data: `legacy:model:open:${modelId}:${fromPage}` }]],
      },
    );
    return;
  }
  await prisma.generation.deleteMany({ where: { modelId } });
  await prisma.savedModel.deleteMany({ where: { id: modelId, userId } });
  await sendTrackedMessage(chatId, `Model "${model.name}" deleted.`, {
    inline_keyboard: [[{ text: "Back to models", callback_data: `legacy:models:page:${fromPage}` }]],
  });
}
async function handleLegacyAction(chatId, action, telegramUserId) {
  if (action === "home") {
    await renderLegacyHome(chatId);
    return;
  }
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
      "Send your generation prompt now. I will guide model selection next.",
      legacyMainKeyboard(),
    );
    return;
  }

  if (action === "models") {
    await renderModelsList(chatId, session.userId, 0);
    return;
  }

  if (action === "dashboard") {
    await renderLegacyDashboard(chatId, session.userId);
    return;
  }

  if (action === "history") {
    await renderHistoryList(chatId, session.userId, 0);
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

  if (mode === MODE_LEGACY && ["home", "menu", "login", "logout", "help", "pricing", "models", "dashboard", "generate", "history"].includes(command)) {
    if (command === "menu") {
      await sendLegacyMenu(chatId, firstName);
      return;
    }
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
  if (text === "home") return "home";
  if (text === "menu") return "home";
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

  // Recovery path for stateless/restarted workers:
  // allow one-line login command: "login email password" or "email password".
  if (!getFlow(chatId)) {
    const standaloneEmailMatch = text.match(/^([^\s@]+@[^\s@]+\.[^\s@]+)$/i);
    if (standaloneEmailMatch) {
      const [, email] = standaloneEmailMatch;
      setFlow(chatId, { step: "await_password", email: email.toLowerCase() });
      await sendTrackedMessage(chatId, "Enter your password:", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const loginCommandMatch = text.match(/^login\s+([^\s@]+@[^\s@]+\.[^\s@]+)\s+(.+)$/i);
    if (loginCommandMatch) {
      const [, email, password] = loginCommandMatch;
      await verifyEmailPasswordAndBeginSession(chatId, email, password, telegramUserId);
      return true;
    }
    const compactCredentialMatch = text.match(/^([^\s@]+@[^\s@]+\.[^\s@]+)\s+(.+)$/i);
    if (compactCredentialMatch) {
      const [, email, password] = compactCredentialMatch;
      await verifyEmailPasswordAndBeginSession(chatId, email, password, telegramUserId);
      return true;
    }
  }

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
    const ok = await verifyEmailPasswordAndBeginSession(
      chatId,
      String(flow.email || "").toLowerCase(),
      text,
      telegramUserId,
    );
    if (!ok && getFlow(chatId)?.step === "await_password") {
      await sendTrackedMessage(chatId, "Incorrect password. Try again or press Cancel.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
    }
    return true;
  }

  if (flow?.step === "await_2fa") {
    const code = text.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      await sendTrackedMessage(chatId, "2FA code must be 6 digits. Try again or tap Cancel.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const { authenticator } = await import("otplib");
    const isValid = authenticator.verify({
      token: code,
      secret: flow.twoFactorSecret,
    });
    if (!isValid) {
      await sendTrackedMessage(chatId, "Invalid 2FA code. Try again or tap Cancel.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    clearFlow(chatId);
    setSession(chatId, { userId: flow.userId, email: flow.email });
    await linkTelegramIdentity(flow.userId, telegramUserId);
    await sendTrackedMessage(chatId, "Login successful with 2FA. Legacy session is active.", legacyMainKeyboard());
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
    const result = await prisma.savedModel.updateMany({
      where: { id: flow.modelId, userId: session.userId },
      data: { name: newName },
    });
    if (!result.count) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Model not found for rename.", legacyMainKeyboard());
      return true;
    }
    clearFlow(chatId);
    await sendTrackedMessage(chatId, `Model renamed to "${newName}".`, {
      inline_keyboard: [[{ text: "Back to models", callback_data: `legacy:models:page:${flow.page || 0}` }]],
    });
    return true;
  }

  if (flow?.step === "await_generate_prompt") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    setFlow(chatId, { step: "await_generate_model", prompt: text });
    const models = await prisma.savedModel.findMany({
      where: { userId: session.userId },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    if (!models.length) {
      clearFlow(chatId);
      await sendTrackedMessage(
        chatId,
        `Prompt saved:\n"${text}"\n\nNo models found. Create one first, then run /generate again.`,
        legacyMainKeyboard(),
      );
      return true;
    }
    const rows = models.map((m) => [
      { text: `${m.name} (${m.status || "ready"})`, callback_data: `legacy:generate:model:${m.id}` },
    ]);
    rows.push([{ text: "Cancel", callback_data: "legacy:home" }]);
    await sendTrackedMessage(
      chatId,
      `Prompt received:\n"${text}"\n\nChoose a model to continue generation flow:`,
      { inline_keyboard: rows },
    );
    return true;
  }

  const action = normalizeLegacyTextAction(text);
  if (!action) {
    // Helpful recovery for expired login flow / worker restart.
    if (text.length >= 6 && !text.includes(" ") && !text.includes("@")) {
      await sendTrackedMessage(
        chatId,
        "Login step seems expired. Use:\n`login your@email.com yourPassword`\nor tap Login again.",
        legacyMainKeyboard(),
      );
      return true;
    }
    return false;
  }
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
    const [, , , modelId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderModelDetails(chatId, session.userId, modelId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:model:rename:")) {
    const [, , , modelId, page = "0"] = data.split(":");
    setFlow(chatId, { step: "await_model_rename", modelId, page: Number(page) || 0 });
    await sendTrackedMessage(chatId, "Enter the new model name:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("legacy:model:delete:confirm:")) {
    const [, , , , modelId, page = "0"] = data.split(":");
    await sendTrackedMessage(chatId, "Confirm model deletion:", {
      inline_keyboard: [
        [{ text: "Yes, delete", callback_data: `legacy:model:delete:run:${modelId}:${page}` }],
        [{ text: "Cancel", callback_data: `legacy:model:open:${modelId}:${page}` }],
      ],
    });
    return;
  }

  if (data.startsWith("legacy:model:delete:run:")) {
    const [, , , , modelId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await safeDeleteModel(chatId, session.userId, modelId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:models:page:")) {
    const page = Number(data.split(":").pop() || 0) || 0;
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderModelsList(chatId, session.userId, page);
    return;
  }

  if (data.startsWith("legacy:history:page:")) {
    const page = Number(data.split(":").pop() || 0) || 0;
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderHistoryList(chatId, session.userId, page);
    return;
  }

  if (data.startsWith("legacy:history:item:")) {
    const [, , , generationId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderHistoryItem(chatId, session.userId, generationId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:generate:model:")) {
    const modelId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const flow = getFlow(chatId);
    if (!flow || flow.step !== "await_generate_model") {
      await sendTrackedMessage(chatId, "No active generation prompt found. Use /generate first.", legacyMainKeyboard());
      return;
    }
    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId: session.userId },
      select: { id: true, name: true, photo1Url: true },
    });
    if (!model) {
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return;
    }
    clearFlow(chatId);
    await sendTrackedMessage(
      chatId,
      `Generation draft prepared.\nModel: ${model.name}\nPrompt: "${String(flow.prompt || "").slice(0, 400)}"\n\n` +
        "Next: send a source image URL (https) and I can run the first chat-native generation endpoint.",
      legacyMainKeyboard(),
    );
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
      const hasLegacyFlow = Boolean(getFlow(message.chat.id));
      const hasLegacySession = Boolean(getSession(message.chat.id));
      const isPlainText = !message.text.trim().startsWith("/");
      if (isPlainText) {
        const handledLegacyMessage = await handleLegacyPlainMessage(message);
        if (handledLegacyMessage) {
          return res.json({ ok: true });
        }
        if (currentMode === MODE_LEGACY || hasLegacyFlow || hasLegacySession) {
          await sendTrackedMessage(
            message.chat.id,
            "Legacy mode: use the buttons, or type /menu for full options.",
            legacyMainKeyboard(),
          );
        } else {
          await sendTrackedMessage(
            message.chat.id,
            "Use /menu to open navigation or /mode to switch interaction mode.",
            { inline_keyboard: [[{ text: "Open Menu", callback_data: "menu:main" }]] },
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
