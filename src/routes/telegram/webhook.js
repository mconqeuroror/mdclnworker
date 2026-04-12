import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  answerCallbackQuery,
  deleteMessage,
  downloadTelegramFile,
  sendMessage,
  sendPhoto,
  setMyCommands,
} from "../../services/telegramBot.js";
import prisma from "../../lib/prisma.js";
import { uploadBufferToR2 } from "../../utils/r2.js";

const router = Router();
const miniAppBaseUrl = (process.env.TELEGRAM_MINI_APP_URL || "https://modelclone.app").replace(/\/$/, "");
let commandsInitialized = false;
const chatModeMap = new Map();
const legacySessionMap = new Map();
const legacyFlowMap = new Map();
const lastBotMessagesMap = new Map();
// Tracks which chatIds have already been hydrated from DB this process lifetime.
// Prevents repeated DB reads while still allowing a fresh hydration on restart.
const hydratedChats = new Set();
const LEGACY_PAGE_SIZE = 8;
const MODE_MINI = "mini";
const MODE_LEGACY = "legacy";
const LEGACY_FLOW_TTL_MS = 45 * 60 * 1000;
const LEGACY_STATE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const persistStateTimers = new Map();

const COMMANDS = [
  { command: "start", description: "Open ModelClone bot menu" },
  { command: "menu", description: "Show command menu" },
  { command: "mode", description: "Switch Mini App / Legacy bot mode" },
  { command: "login", description: "Login with email/password in chat" },
  { command: "logout", description: "Logout from legacy mode" },
  { command: "models", description: "List and manage your models" },
  { command: "create", description: "Create model in chat" },
  { command: "dashboard", description: "Show account stats" },
  { command: "history", description: "Show recent generations" },
  { command: "queue", description: "Show active job queue" },
  { command: "generate", description: "Start legacy prompt flow" },
  { command: "voice", description: "Voice studio status in chat" },
  { command: "avatars", description: "Avatar status in chat" },
  { command: "settings", description: "Account settings in chat" },
  { command: "pricing", description: "Show pricing info" },
  { command: "reformatter", description: "Run media reformatter in chat" },
  { command: "upscaler", description: "Run image upscaler in chat" },
  { command: "repurposer", description: "Run video repurposer in chat" },
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

function isFlowExpired(flow) {
  if (!flow || typeof flow !== "object") return false;
  const timestamp = flow._updatedAt || flow.updatedAt || flow.flowUpdatedAt || null;
  if (!timestamp) return false;
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return false;
  return Date.now() - value > LEGACY_FLOW_TTL_MS;
}

function withFlowTimestamp(flow) {
  if (!flow || typeof flow !== "object") return flow;
  return { ...flow, _updatedAt: new Date().toISOString() };
}

function parseMessageIds(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0)
      .slice(-20);
  }
  return [];
}

function getLegacyStateSnapshot(chatId) {
  if (chatId === null || chatId === undefined) return null;
  const key = String(chatId);
  const flow = legacyFlowMap.get(key) || null;
  const session = legacySessionMap.get(key) || null;
  const mode = chatModeMap.get(key) || MODE_MINI;
  const lastBotMessageIds = (lastBotMessagesMap.get(key) || []).slice(-20);
  return {
    chatId: key,
    mode,
    sessionUserId: session?.userId ? String(session.userId) : null,
    sessionEmail: session?.email ? String(session.email).toLowerCase() : null,
    flow,
    flowUpdatedAt: flow?._updatedAt ? new Date(flow._updatedAt) : null,
    lastBotMessageIds,
    expiresAt: new Date(Date.now() + LEGACY_STATE_MAX_AGE_MS),
  };
}

async function persistLegacyStateNow(chatId) {
  const snapshot = getLegacyStateSnapshot(chatId);
  if (!snapshot) return;
  try {
    await prisma.telegramLegacyState.upsert({
      where: { chatId: snapshot.chatId },
      create: {
        chatId: snapshot.chatId,
        mode: snapshot.mode,
        sessionUserId: snapshot.sessionUserId,
        sessionEmail: snapshot.sessionEmail,
        flow: snapshot.flow || null,
        flowUpdatedAt: snapshot.flowUpdatedAt,
        lastBotMessageIds: snapshot.lastBotMessageIds,
        expiresAt: snapshot.expiresAt,
      },
      update: {
        mode: snapshot.mode,
        sessionUserId: snapshot.sessionUserId,
        sessionEmail: snapshot.sessionEmail,
        flow: snapshot.flow || null,
        flowUpdatedAt: snapshot.flowUpdatedAt,
        lastBotMessageIds: snapshot.lastBotMessageIds,
        expiresAt: snapshot.expiresAt,
      },
    });
  } catch (error) {
    console.warn("persistLegacyState warning:", error?.message || error);
  }
}

function queuePersistLegacyState(chatId) {
  if (chatId === null || chatId === undefined) return;
  const key = String(chatId);
  const existing = persistStateTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    persistStateTimers.delete(key);
    void persistLegacyStateNow(key);
  }, 25);
  persistStateTimers.set(key, timer);
}

async function hydrateLegacyState(chatId) {
  if (chatId === null || chatId === undefined) return;
  const key = String(chatId);
  // Only hydrate once per server lifetime. A Set is used rather than checking
  // individual maps so that a partial restart (e.g. only chatModeMap populated
  // but session lost) still triggers a full DB re-load.
  if (hydratedChats.has(key)) return;
  hydratedChats.add(key);
  try {
    const state = await prisma.telegramLegacyState.findUnique({
      where: { chatId: key },
      select: {
        mode: true,
        sessionUserId: true,
        sessionEmail: true,
        flow: true,
        flowUpdatedAt: true,
        lastBotMessageIds: true,
        expiresAt: true,
      },
    });
    if (!state) return;
    if (state.expiresAt && new Date(state.expiresAt).getTime() < Date.now()) {
      return;
    }
    const mode = String(state.mode || MODE_MINI) === MODE_LEGACY ? MODE_LEGACY : MODE_MINI;
    chatModeMap.set(key, mode);
    if (state.sessionUserId) {
      legacySessionMap.set(key, {
        userId: String(state.sessionUserId),
        email: state.sessionEmail ? String(state.sessionEmail) : null,
      });
    }
    if (state.flow && typeof state.flow === "object" && !Array.isArray(state.flow)) {
      const flow = {
        ...state.flow,
        _updatedAt: state.flowUpdatedAt
          ? new Date(state.flowUpdatedAt).toISOString()
          : new Date().toISOString(),
      };
      if (!isFlowExpired(flow)) {
        legacyFlowMap.set(key, flow);
      }
    }
    const ids = parseMessageIds(state.lastBotMessageIds);
    if (ids.length) {
      lastBotMessagesMap.set(key, ids);
    }
  } catch (error) {
    console.warn("hydrateLegacyState warning:", error?.message || error);
  }
}

function getChatMode(chatId) {
  return chatModeMap.get(String(chatId)) || MODE_MINI;
}

function setChatMode(chatId, mode) {
  const key = String(chatId);
  chatModeMap.set(key, mode === MODE_LEGACY ? MODE_LEGACY : MODE_MINI);
  queuePersistLegacyState(key);
}

function buildSectionUrl(sectionKey) {
  const tab = sectionTabs[sectionKey];
  if (!tab) return miniAppBaseUrl;
  return `${miniAppBaseUrl}/dashboard?tab=${encodeURIComponent(tab)}`;
}

async function sendHybridFallback(chatId, action, sectionKey = "dashboard") {
  const safeAction = String(action || "feature");
  const tabKey = sectionTabs[sectionKey] ? sectionKey : "dashboard";
  await sendTrackedMessage(
    chatId,
    `This legacy action is not fully chat-native yet: "${safeAction}".`,
    {
      inline_keyboard: [
        [{ text: `Open ${safeAction} in app`, web_app: { url: buildSectionUrl(tabKey) } }],
        [{ text: "⬅️ Back", callback_data: "legacy:home" }],
      ],
    },
  );
}

function setSession(chatId, session) {
  const key = String(chatId);
  legacySessionMap.set(key, session);
  queuePersistLegacyState(key);
}

function getSession(chatId) {
  return legacySessionMap.get(String(chatId)) || null;
}

function clearSession(chatId) {
  const key = String(chatId);
  legacySessionMap.delete(key);
  queuePersistLegacyState(key);
}

function setFlow(chatId, flow) {
  const key = String(chatId);
  legacyFlowMap.set(key, withFlowTimestamp(flow));
  queuePersistLegacyState(key);
}

function getFlow(chatId) {
  const key = String(chatId);
  const flow = legacyFlowMap.get(key) || null;
  if (flow && isFlowExpired(flow)) {
    legacyFlowMap.delete(key);
    queuePersistLegacyState(key);
    return null;
  }
  return flow;
}

function clearFlow(chatId) {
  const key = String(chatId);
  legacyFlowMap.delete(key);
  queuePersistLegacyState(key);
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
  queuePersistLegacyState(key);
}

function trackBotMessage(chatId, messageId) {
  if (!messageId) return;
  const key = String(chatId);
  const prev = lastBotMessagesMap.get(key) || [];
  lastBotMessagesMap.set(key, [...prev, messageId].slice(-20));
  queuePersistLegacyState(key);
}

async function sendTrackedMessage(chatId, text, replyMarkup) {
  // Fire-and-forget cleanup: deletions run in background so the user's reply
  // is sent immediately without waiting for Telegram delete round-trips.
  void clearTrackedBotMessages(chatId);
  const sent = await sendMessage(chatId, text, replyMarkup);
  trackBotMessage(chatId, sent?.message_id);
  return sent;
}

async function sendTrackedPhoto(chatId, photoUrl, options = {}) {
  void clearTrackedBotMessages(chatId);
  const sent = await sendPhoto(chatId, photoUrl, options);
  trackBotMessage(chatId, sent?.message_id);
  return sent;
}

async function sendTrackedMediaBundle(chatId, mediaUrls = [], finalText = "", finalReplyMarkup) {
  void clearTrackedBotMessages(chatId);
  const validUrls = mediaUrls.filter((url) => isHttpUrl(url));
  for (const url of validUrls) {
    try {
      const sentPhoto = await sendPhoto(chatId, url);
      trackBotMessage(chatId, sentPhoto?.message_id);
    } catch {
      // Keep rendering the rest of the card even when one photo URL is invalid/expired.
    }
  }
  try {
    const sentText = await sendMessage(chatId, finalText, finalReplyMarkup);
    trackBotMessage(chatId, sentText?.message_id);
    return sentText;
  } catch {
    // Last-resort fallback so callback still surfaces details.
    const fallback = await sendMessage(chatId, finalText || "Opened model details.", finalReplyMarkup);
    trackBotMessage(chatId, fallback?.message_id);
    return fallback;
  }
}

function formatDate(dateLike) {
  const value = dateLike ? new Date(dateLike) : null;
  if (!value || Number.isNaN(value.getTime())) return "n/a";
  return value.toLocaleString();
}

function getModelLimit(subscriptionTier) {
  const limits = { starter: 1, pro: 2, business: 4 };
  return limits[String(subscriptionTier || "").toLowerCase()] || 1;
}

function getApiBaseUrl() {
  const base = (process.env.TELEGRAM_MINI_APP_URL || "https://modelclone.app").replace(/\/$/, "");
  return base;
}

// Cache: userId → { token, expiresAt (ms) }
// Token TTL is 10 min; we evict 90 s before expiry to prevent stale tokens.
const legacyAuthTokenCache = new Map();

async function createLegacyAuthToken(userId) {
  const cached = legacyAuthTokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 90_000) {
    return cached.token;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) throw new Error("User not found.");
  if (!process.env.JWT_SECRET) throw new Error("JWT secret is missing on server.");
  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "10m",
  });
  legacyAuthTokenCache.set(userId, { token, expiresAt: Date.now() + 10 * 60 * 1000 });
  return token;
}

async function callLegacyApi(userId, path, method = "GET", body = undefined) {
  const token = await createLegacyAuthToken(userId);
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

async function submitLegacyPromptVideoGeneration(userId, imageUrl, prompt, duration = 5) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/generate/video-prompt",
      "POST",
      { imageUrl, prompt, duration },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize generation auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || `Generation request failed (${response.status}).`,
    };
  }
  return {
    ok: true,
    generation: data.generation || null,
    creditsUsed: data.creditsUsed ?? null,
  };
}

async function submitLegacySelectVoice(userId, modelId, voiceId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/models/${encodeURIComponent(modelId)}/voices/${encodeURIComponent(voiceId)}/select`,
      "POST",
      {},
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize voice selection auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Voice selection failed (${response.status}).`,
    };
  }
  return { ok: true, data };
}

async function submitLegacyAvatarVideoGeneration(userId, avatarId, script) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/avatars/${encodeURIComponent(avatarId)}/generate`,
      "POST",
      { script },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize avatar generation auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Avatar video generation failed (${response.status}).`,
    };
  }
  return {
    ok: true,
    video: data.video || null,
    creditsCost: data.creditsCost ?? null,
    estimatedSecs: data.estimatedSecs ?? null,
  };
}

async function submitLegacyGenerateVoiceAudio(userId, modelId, voiceId, script) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/models/${encodeURIComponent(modelId)}/voices/generate-audio`,
      "POST",
      { voiceId, script },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize voice audio generation auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Voice audio generation failed (${response.status}).`,
    };
  }
  return {
    ok: true,
    audio: data.audio || null,
    creditsUsed: data.creditsUsed ?? null,
  };
}

async function submitLegacyCloneVoiceFromMp3(userId, modelId, fileBuffer, fileName = "voice.mp3", mimeType = "audio/mpeg") {
  let response;
  let data;
  try {
    const token = await createLegacyAuthToken(userId);
    const form = new FormData();
    form.set("consent", "true");
    form.set("audio", new Blob([fileBuffer], { type: mimeType || "audio/mpeg" }), fileName || "voice.mp3");
    response = await fetch(`${getApiBaseUrl()}/api/models/${encodeURIComponent(modelId)}/voices/clone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize voice clone auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Voice clone failed (${response.status}).`,
    };
  }
  return {
    ok: true,
    voice: data.voice || null,
    creditsUsed: data.creditsUsed ?? null,
  };
}

async function submitLegacyDeleteVoice(userId, modelId, voiceId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/models/${encodeURIComponent(modelId)}/voices/${encodeURIComponent(voiceId)}`,
      "DELETE",
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize voice delete auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Voice delete failed (${response.status}).`,
    };
  }
  return { ok: true };
}

async function submitLegacyCreateCreditsCheckout(userId, creditAmount) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/stripe/create-onetime-checkout",
      "POST",
      { creditAmount },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize credits checkout." };
  }
  if (!response.ok || !data?.url) {
    return {
      ok: false,
      message: data?.error || data?.message || `Credits checkout failed (${response.status}).`,
    };
  }
  return { ok: true, url: data.url };
}

async function submitLegacyCreateSubscriptionCheckout(userId, tierId, billingCycle = "monthly") {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/stripe/create-checkout-session",
      "POST",
      { tierId, billingCycle },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize subscription checkout." };
  }
  if (!response.ok || !data?.url) {
    return {
      ok: false,
      message: data?.error || data?.message || `Subscription checkout failed (${response.status}).`,
    };
  }
  return { ok: true, url: data.url };
}

async function submitLegacyCreateBillingPortal(userId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/stripe/create-portal-session",
      "POST",
      {},
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize billing portal." };
  }
  if (!response.ok || !data?.url) {
    return {
      ok: false,
      message: data?.error || data?.message || `Billing portal failed (${response.status}).`,
    };
  }
  return { ok: true, url: data.url };
}

async function fetchLegacySubscriptionStatus(userId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/stripe/subscription-status",
      "GET",
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to load subscription status." };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: data?.error || data?.message || `Subscription status failed (${response.status}).`,
    };
  }
  return { ok: true, data };
}

async function submitLegacyCancelSubscription(userId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/stripe/cancel-subscription",
      "POST",
      {},
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize cancel-subscription request." };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: data?.error || data?.message || `Cancel subscription failed (${response.status}).`,
    };
  }
  return { ok: true, message: data?.message || "Subscription cancellation requested." };
}

async function submitLegacyCreateAvatar(userId, modelId, name, photoUrl) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/avatars",
      "POST",
      { modelId, name, photoUrl },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize avatar creation auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.error || data?.message || `Avatar create failed (${response.status}).`,
    };
  }
  return { ok: true, avatar: data.avatar || null };
}

async function submitLegacyDeleteAvatar(userId, avatarId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/avatars/${encodeURIComponent(avatarId)}`,
      "DELETE",
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize avatar delete auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.error || data?.message || `Avatar delete failed (${response.status}).`,
    };
  }
  return { ok: true };
}

async function fetchLegacyReformatterStatus(userId, jobId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/reformatter/status/${encodeURIComponent(jobId)}`,
      "GET",
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to load reformatter status." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Reformatter status failed (${response.status}).`,
    };
  }
  return { ok: true, job: data.job || null };
}

async function fetchLegacyRepurposeStatus(userId, jobId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/video-repurpose/jobs/${encodeURIComponent(jobId)}`,
      "GET",
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to load repurposer status." };
  }
  if (!response.ok || !data?.ok) {
    return {
      ok: false,
      message: data?.error || data?.message || `Repurposer status failed (${response.status}).`,
    };
  }
  return { ok: true, job: data.job || null };
}

async function fetchLegacyUpscaleStatus(userId, generationId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      `/api/upscale/status/${encodeURIComponent(generationId)}`,
      "GET",
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to load upscaler status." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.error || data?.message || `Upscaler status failed (${response.status}).`,
    };
  }
  return { ok: true, data };
}

async function submitLegacyReformatterJob(userId, inputUrl, originalFileName = "upload") {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/reformatter/convert-with-worker",
      "POST",
      { inputUrl, originalFileName },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize reformatter job." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Reformatter start failed (${response.status}).`,
    };
  }
  return { ok: true, jobId: data.jobId || null };
}

async function submitLegacyRepurposerJob(userId, videoUrl, watermarkUrl = null) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/video-repurpose/generate-with-worker",
      "POST",
      {
        videoUrl,
        ...(watermarkUrl ? { watermarkUrl } : {}),
        settings: JSON.stringify({ copies: 1, filters: {}, metadata: {} }),
      },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize repurposer job." };
  }
  if (!response.ok || !data?.ok) {
    return {
      ok: false,
      message: data?.error || data?.message || `Repurposer start failed (${response.status}).`,
    };
  }
  return { ok: true, jobId: data.job_id || null };
}

async function submitLegacyUpscaleFromUrl(userId, imageUrl) {
  let response;
  let data;
  try {
    const token = await createLegacyAuthToken(userId);
    const sourceRes = await fetch(imageUrl, {
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    });
    if (!sourceRes.ok) {
      return { ok: false, message: `Failed to download image URL (${sourceRes.status}).` };
    }
    const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());
    const sourceType = sourceRes.headers.get("content-type") || "image/jpeg";
    const form = new FormData();
    form.set("image", new Blob([sourceBuffer], { type: sourceType }), "upscale.jpg");
    response = await fetch(`${getApiBaseUrl()}/api/upscale`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize upscaler auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.error || data?.message || `Upscaler start failed (${response.status}).`,
    };
  }
  return { ok: true, generationId: data.generationId || null };
}

async function submitLegacyDeleteGeneration(userId, generationId) {
  let response;
  let data;
  try {
    ({ response, data } = await callLegacyApi(
      userId,
      "/api/generations/batch-delete",
      "POST",
      { generationIds: [generationId] },
    ));
  } catch (error) {
    return { ok: false, message: error?.message || "Failed to initialize delete auth." };
  }
  if (!response.ok || !data?.success) {
    return {
      ok: false,
      message: data?.message || data?.error || `Delete failed (${response.status}).`,
    };
  }
  return { ok: true, deletedCount: Number(data?.deletedCount || 0) };
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
      ["🔐 Login", "🧬 Models", "📊 Dashboard"],
      ["➕ Create Model", "🖼 My Photos", "✏️ Edit Model"],
      ["🎤 Voice", "🧍 Avatars", "⚙️ Settings"],
      ["🕘 History", "📥 Queue", "💳 Pricing"],
      ["🧰 Tools", "🎞 Reformatter", "🔍 Upscaler"],
      ["♻️ Repurposer"],
      ["🎬 Generate", "🚪 Logout", "🔁 Switch Mode"],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function legacyMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🏠 Home", callback_data: "legacy:home" },
        { text: "🔐 Login", callback_data: "legacy:login" },
        { text: "🚪 Logout", callback_data: "legacy:logout" },
      ],
      [
        { text: "🧬 Models", callback_data: "legacy:models" },
        { text: "➕ Create", callback_data: "legacy:create_model" },
        { text: "🎬 Generate", callback_data: "legacy:generate" },
      ],
      [
        { text: "📊 Dashboard", callback_data: "legacy:dashboard" },
        { text: "🕘 History", callback_data: "legacy:history" },
      ],
      [{ text: "📥 Job Queue", callback_data: "legacy:queue" }],
      [{ text: "🧰 Tools", callback_data: "legacy:tools" }],
      [
        { text: "🎤 Voice", callback_data: "legacy:voice" },
        { text: "🧍 Avatars", callback_data: "legacy:avatars" },
      ],
      [
        { text: "⚙️ Settings", callback_data: "legacy:settings" },
        { text: "💳 Pricing", callback_data: "legacy:pricing" },
        { text: "🆘 Help", callback_data: "legacy:help" },
      ],
      [{ text: "🌐 Switch to Mini App mode", callback_data: "mode:set:mini" }],
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
  await hydrateLegacyState(chatId);
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
    // Do NOT store twoFactorSecret in flow — it would be persisted to the DB.
    // We look it up fresh from the DB when the code is submitted.
    setFlow(chatId, {
      step: "await_2fa",
      userId: user.id,
      email: user.email,
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
    `Legacy Home\n\n${statusLine}\nUse buttons below for full chat-based actions.\nTip: use ➕ Create Model to build a new model fully in chat.`,
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
      nsfwOverride: true,
      looksUnlockedByAdmin: true,
      isAIGenerated: true,
      createdAt: true,
      updatedAt: true,
      age: true,
      photo1Url: true,
      photo2Url: true,
      photo3Url: true,
    },
  });
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  const photosLocked =
    (model.isAIGenerated || model.nsfwOverride || model.nsfwUnlocked) &&
    !model.looksUnlockedByAdmin;
  const photoUrls = [model.photo1Url, model.photo2Url, model.photo3Url].filter((url) => isHttpUrl(url));
  const detailsText =
    `Model: ${model.name}\nStatus: ${model.status || "ready"}\nLoRA: ${model.loraStatus || "n/a"}\n` +
    `NSFW unlocked: ${model.nsfwUnlocked ? "yes" : "no"}\nAI generated: ${model.isAIGenerated ? "yes" : "no"}\n` +
    `Age: ${model.age ?? "n/a"}\nPhotos editable: ${photosLocked ? "no (locked)" : "yes"}\n` +
    `Created: ${formatDate(model.createdAt)}\nUpdated: ${formatDate(model.updatedAt)}`;
  await sendTrackedMediaBundle(
    chatId,
    photoUrls,
    detailsText,
    {
      inline_keyboard: [
        [
          { text: "🖼 Photo panel", callback_data: `lg:mpv:${model.id}:${fromPage}:1` },
          { text: "✨ Edit looks", callback_data: `legacy:model:looks:menu:${model.id}:${fromPage}` },
        ],
        [{ text: "✏️ Edit menu", callback_data: `legacy:model:edit:menu:${model.id}:${fromPage}` }],
        [{ text: "📝 Rename", callback_data: `legacy:model:rename:${model.id}:${fromPage}` }],
        [{ text: "🗑 Delete", callback_data: `lg:mdc:${model.id}:${fromPage}` }],
        [{ text: "⬅️ Back to models", callback_data: `legacy:models:page:${fromPage}` }],
      ],
    },
  );
}

async function renderModelPhotos(chatId, userId, modelId, fromPage = 0) {
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: {
      id: true,
      name: true,
      photo1Url: true,
      photo2Url: true,
      photo3Url: true,
    },
  });
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  await renderModelPhotoPanel(chatId, userId, model.id, fromPage, 1);
}

async function renderModelEditMenu(chatId, userId, modelId, fromPage = 0) {
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: {
      id: true,
      name: true,
      age: true,
      isAIGenerated: true,
      nsfwOverride: true,
      nsfwUnlocked: true,
      looksUnlockedByAdmin: true,
    },
  });
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  const photosLocked =
    (model.isAIGenerated || model.nsfwOverride || model.nsfwUnlocked) &&
    !model.looksUnlockedByAdmin;
  await sendTrackedMessage(
    chatId,
    `✏️ Edit "${model.name}"\nAge: ${model.age ?? "n/a"}\nPhoto editing: ${photosLocked ? "locked" : "available"}`,
    {
      inline_keyboard: [
        [{ text: "📝 Rename model", callback_data: `legacy:model:rename:${model.id}:${fromPage}` }],
        [{ text: "🎂 Set age", callback_data: `legacy:model:edit:age:${model.id}:${fromPage}` }],
        [{ text: "🖼 Swap photos", callback_data: `lg:mpv:${model.id}:${fromPage}:1` }],
        [{ text: "✨ Edit looks", callback_data: `legacy:model:looks:menu:${model.id}:${fromPage}` }],
        [{ text: "⬅️ Back to model", callback_data: `legacy:model:open:${model.id}:${fromPage}` }],
      ],
    },
  );
}

async function renderModelPhotoPanel(chatId, userId, modelId, fromPage = 0, slot = 1) {
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: {
      id: true,
      name: true,
      photo1Url: true,
      photo2Url: true,
      photo3Url: true,
      isAIGenerated: true,
      nsfwOverride: true,
      nsfwUnlocked: true,
      looksUnlockedByAdmin: true,
    },
  });
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  const safeSlot = [1, 2, 3].includes(Number(slot)) ? Number(slot) : 1;
  const slotKey = `photo${safeSlot}`;
  const url = model[`${slotKey}Url`];
  const photosLocked =
    (model.isAIGenerated || model.nsfwOverride || model.nsfwUnlocked) &&
    !model.looksUnlockedByAdmin;
  if (isHttpUrl(url)) {
    await sendTrackedPhoto(chatId, url, {
      caption: `📷 ${model.name} — ${slotKey}`,
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "1", callback_data: `lg:mpv:${model.id}:${fromPage}:1` },
            { text: "2", callback_data: `lg:mpv:${model.id}:${fromPage}:2` },
            { text: "3", callback_data: `lg:mpv:${model.id}:${fromPage}:3` },
          ],
          [{ text: "🔄 Swap this photo", callback_data: `lg:mps:${model.id}:${fromPage}:${slotKey}` }],
          [{ text: "✨ Edit looks", callback_data: `legacy:model:looks:menu:${model.id}:${fromPage}` }],
          [{ text: "⬅️ Back to model", callback_data: `legacy:model:open:${model.id}:${fromPage}` }],
        ],
      },
    });
  } else {
    await sendTrackedMessage(
      chatId,
      `No valid URL found for ${slotKey}.`,
      {
        inline_keyboard: [
          [{ text: "🔄 Swap this photo", callback_data: `lg:mps:${model.id}:${fromPage}:${slotKey}` }],
          [{ text: "⬅️ Back to model", callback_data: `legacy:model:open:${model.id}:${fromPage}` }],
        ],
      },
    );
  }
}

async function renderLooksEditor(chatId, userId, modelId, fromPage = 0) {
  const model = await prisma.savedModel.findFirst({
    where: { id: modelId, userId },
    select: { id: true, name: true, savedAppearance: true },
  });
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  const ap = (model.savedAppearance && typeof model.savedAppearance === "object" && !Array.isArray(model.savedAppearance))
    ? model.savedAppearance
    : {};
  const summary =
    `✨ Looks for "${model.name}"\n` +
    `Gender: ${ap.gender || "n/a"}\nHair color: ${ap.hairColor || "n/a"}\nEye color: ${ap.eyeColor || "n/a"}\n` +
    `Style: ${ap.style || "n/a"}\nBody type: ${ap.bodyType || "n/a"}\nHeritage: ${ap.heritage || "n/a"}`;
  await sendTrackedMessage(chatId, summary, {
    inline_keyboard: [
      [
        { text: "Gender", callback_data: `lg:mlf:${model.id}:${fromPage}:gender` },
        { text: "Hair", callback_data: `lg:mlf:${model.id}:${fromPage}:hairColor` },
      ],
      [
        { text: "Eyes", callback_data: `lg:mlf:${model.id}:${fromPage}:eyeColor` },
        { text: "Style", callback_data: `lg:mlf:${model.id}:${fromPage}:style` },
      ],
      [
        { text: "Body", callback_data: `lg:mlf:${model.id}:${fromPage}:bodyType` },
        { text: "Heritage", callback_data: `lg:mlf:${model.id}:${fromPage}:heritage` },
      ],
      [{ text: "⬅️ Back to model", callback_data: `legacy:model:open:${model.id}:${fromPage}` }],
    ],
  });
}

function isHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function inferImageExtension(contentType = "", filePath = "") {
  const ct = String(contentType || "").toLowerCase();
  const fp = String(filePath || "").toLowerCase();
  if (ct.includes("image/jpeg") || ct.includes("image/jpg") || fp.endsWith(".jpg") || fp.endsWith(".jpeg")) return "jpg";
  if (ct.includes("image/png") || fp.endsWith(".png")) return "png";
  if (ct.includes("image/webp") || fp.endsWith(".webp")) return "webp";
  if (ct.includes("image/heic") || fp.endsWith(".heic")) return "heic";
  return "jpg";
}

function inferMediaExtension(contentType = "", filePath = "", fallback = "bin") {
  const ct = String(contentType || "").toLowerCase();
  const fp = String(filePath || "").toLowerCase();
  if (ct.includes("image/") || /\.(jpg|jpeg|png|webp|heic)$/i.test(fp)) {
    return inferImageExtension(contentType, filePath);
  }
  if (ct.includes("video/mp4") || fp.endsWith(".mp4")) return "mp4";
  if (ct.includes("video/webm") || fp.endsWith(".webm")) return "webm";
  if (ct.includes("video/quicktime") || fp.endsWith(".mov")) return "mov";
  if (ct.includes("video/")) return "mp4";
  if (ct.includes("audio/mpeg") || fp.endsWith(".mp3")) return "mp3";
  if (ct.includes("audio/wav") || fp.endsWith(".wav")) return "wav";
  if (ct.includes("audio/")) return "mp3";
  return String(fallback || "bin").toLowerCase();
}

function isTelegramMp3Message(message) {
  const audio = message?.audio;
  if (audio?.file_id) {
    const mime = String(audio.mime_type || "").toLowerCase();
    const name = String(audio.file_name || "").toLowerCase();
    return mime === "audio/mpeg" || mime === "audio/mp3" || name.endsWith(".mp3");
  }
  const doc = message?.document;
  if (doc?.file_id) {
    const mime = String(doc.mime_type || "").toLowerCase();
    const name = String(doc.file_name || "").toLowerCase();
    return mime === "audio/mpeg" || mime === "audio/mp3" || name.endsWith(".mp3");
  }
  return false;
}

async function resolveLegacyMp3Input(message) {
  const audio = message?.audio;
  if (audio?.file_id) {
    const downloaded = await downloadTelegramFile(audio.file_id);
    return {
      buffer: downloaded.buffer,
      fileName: String(audio.file_name || "voice.mp3"),
      mimeType: String(downloaded.contentType || audio.mime_type || "audio/mpeg"),
    };
  }
  const doc = message?.document;
  if (doc?.file_id) {
    const downloaded = await downloadTelegramFile(doc.file_id);
    return {
      buffer: downloaded.buffer,
      fileName: String(doc.file_name || "voice.mp3"),
      mimeType: String(downloaded.contentType || doc.mime_type || "audio/mpeg"),
    };
  }
  return null;
}

async function resolveLegacyMediaInputUrl(message, text, options = {}) {
  if (isHttpUrl(text)) {
    return String(text || "").trim();
  }
  const allowImages = options?.allowImages !== false;
  const allowVideos = options?.allowVideos === true;
  const allowDocuments = options?.allowDocuments !== false;
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  if (allowImages && photos.length) {
    const selected = photos[photos.length - 1];
    const downloaded = await downloadTelegramFile(selected.file_id);
    const ext = inferMediaExtension(downloaded.contentType, downloaded.filePath, "jpg");
    const safeContentType = String(downloaded.contentType || "").toLowerCase().startsWith("image/")
      ? downloaded.contentType
      : "image/jpeg";
    return uploadBufferToR2(downloaded.buffer, "telegram-legacy-inputs", ext, safeContentType);
  }

  const video = message?.video;
  if (allowVideos && video?.file_id) {
    const downloaded = await downloadTelegramFile(video.file_id);
    const contentType = String(downloaded.contentType || video.mime_type || "video/mp4");
    const ext = inferMediaExtension(contentType, downloaded.filePath || video.file_name, "mp4");
    return uploadBufferToR2(downloaded.buffer, "telegram-legacy-inputs", ext, contentType);
  }

  const doc = message?.document;
  if (allowDocuments && doc?.file_id) {
    const mime = String(doc?.mime_type || "").toLowerCase();
    const isImage = mime.startsWith("image/");
    const isVideo = mime.startsWith("video/");
    if ((allowImages && isImage) || (allowVideos && isVideo)) {
      const downloaded = await downloadTelegramFile(doc.file_id);
      const contentType = String(downloaded.contentType || doc.mime_type || (isImage ? "image/jpeg" : "video/mp4"));
      const ext = inferMediaExtension(contentType, downloaded.filePath || doc.file_name, isImage ? "jpg" : "mp4");
      return uploadBufferToR2(downloaded.buffer, "telegram-legacy-inputs", ext, contentType);
    }
  }

  return null;
}

async function resolveLegacyImageInputUrl(message, text) {
  const url = await resolveLegacyMediaInputUrl(message, text, {
    allowImages: true,
    allowVideos: false,
    allowDocuments: true,
  });
  if (!url || !isHttpUrl(url)) {
    return null;
  }
  return url;
}

async function createModelFromLegacyFlow(chatId, userId, payload) {
  const name = String(payload?.name || "").trim();
  const photo1Url = String(payload?.photo1Url || "").trim();
  const photo2Url = String(payload?.photo2Url || "").trim();
  const photo3Url = String(payload?.photo3Url || "").trim();
  if (!name || !photo1Url || !photo2Url || !photo3Url) {
    await sendTrackedMessage(chatId, "Missing model data. Please start again.", legacyMainKeyboard());
    return false;
  }
  const [user, currentModelCount, existingByName] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { maxModels: true, subscriptionTier: true, role: true },
    }),
    prisma.savedModel.count({ where: { userId } }),
    prisma.savedModel.findFirst({ where: { userId, name } }),
  ]);
  const modelLimit = user?.maxModels ?? getModelLimit(user?.subscriptionTier);
  if (user?.role !== "admin" && currentModelCount >= modelLimit) {
    await sendTrackedMessage(
      chatId,
      `Model limit reached (${currentModelCount}/${modelLimit}). Delete one model or upgrade plan.`,
      legacyMainKeyboard(),
    );
    return false;
  }
  if (existingByName) {
    await sendTrackedMessage(chatId, `Model "${name}" already exists. Use a different name.`, legacyMainKeyboard());
    return false;
  }
  const created = await prisma.savedModel.create({
    data: {
      userId,
      name,
      photo1Url,
      photo2Url,
      photo3Url,
      thumbnail: photo1Url,
      isAIGenerated: false,
      status: "ready",
    },
    select: { id: true, name: true },
  });
  await sendTrackedMessage(
    chatId,
    `✅ Model "${created.name}" created successfully in legacy mode.`,
    {
      inline_keyboard: [
        [{ text: "🧬 Open model", callback_data: `legacy:model:open:${created.id}:0` }],
        [{ text: "➕ Create another", callback_data: "legacy:create_model" }],
      ],
    },
  );
  return true;
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

async function renderLegacyQueue(chatId, userId) {
  const [activeGenerations, activeAvatarVideos, recentFailedGenerations, recentFailedAvatarVideos] = await Promise.all([
    prisma.generation.findMany({
      where: { userId, status: { in: ["pending", "processing"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.avatarVideo.findMany({
      where: { userId, status: { in: ["pending", "processing"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        status: true,
        createdAt: true,
        avatar: { select: { name: true, modelId: true } },
      },
    }),
    prisma.generation.findMany({
      where: { userId, status: "failed" },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, type: true, createdAt: true },
    }),
    prisma.avatarVideo.findMany({
      where: { userId, status: "failed" },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: {
        id: true,
        createdAt: true,
        avatar: { select: { name: true, modelId: true } },
      },
    }),
  ]);

  const generationPending = activeGenerations.filter((item) => String(item.status || "").toLowerCase() === "pending");
  const generationProcessing = activeGenerations.filter((item) => String(item.status || "").toLowerCase() === "processing");
  const avatarPending = activeAvatarVideos.filter((item) => String(item.status || "").toLowerCase() === "pending");
  const avatarProcessing = activeAvatarVideos.filter((item) => String(item.status || "").toLowerCase() === "processing");

  const toCompactGenerationLine = (g, i) =>
    `${i + 1}. ${g.type} • ${formatDate(g.createdAt)} • #${String(g.id || "").slice(0, 8)}`;
  const toCompactAvatarLine = (v, i) =>
    `${i + 1}. ${v.avatar?.name || "Avatar"} • ${formatDate(v.createdAt)} • #${String(v.id || "").slice(0, 8)}`;

  const generationPendingLines = generationPending.length
    ? generationPending.map(toCompactGenerationLine).join("\n")
    : "None";
  const generationProcessingLines = generationProcessing.length
    ? generationProcessing.map(toCompactGenerationLine).join("\n")
    : "None";
  const avatarPendingLines = avatarPending.length ? avatarPending.map(toCompactAvatarLine).join("\n") : "None";
  const avatarProcessingLines = avatarProcessing.length ? avatarProcessing.map(toCompactAvatarLine).join("\n") : "None";

  const failedGenerationLines = recentFailedGenerations.length
    ? recentFailedGenerations
        .map((f, i) => `${i + 1}. ${f.type} • ${formatDate(f.createdAt)} • #${String(f.id || "").slice(0, 8)}`)
        .join("\n")
    : "None";
  const failedAvatarLines = recentFailedAvatarVideos.length
    ? recentFailedAvatarVideos
        .map((f, i) => `${i + 1}. ${f.avatar?.name || "Avatar"} • ${formatDate(f.createdAt)} • #${String(f.id || "").slice(0, 8)}`)
        .join("\n")
    : "None";

  const keyboard = [];
  for (const g of activeGenerations.slice(0, 6)) {
    const icon = String(g.status || "").toLowerCase() === "pending" ? "⏳" : "⚙️";
    keyboard.push([{ text: `${icon} Gen ${g.type} #${g.id.slice(0, 8)}`, callback_data: `lg:gr:${g.id}:0` }]);
  }
  for (const v of activeAvatarVideos.slice(0, 4)) {
    const icon = String(v.status || "").toLowerCase() === "pending" ? "⏳" : "⚙️";
    keyboard.push([{ text: `${icon} Avatar #${v.id.slice(0, 8)}`, callback_data: `lg:avvr:${v.id}` }]);
  }
  for (const failed of recentFailedGenerations.slice(0, 3)) {
    keyboard.push([{ text: `♻️ Retry gen #${failed.id.slice(0, 8)}`, callback_data: `legacy:generation:retry:${failed.id}:0` }]);
  }
  for (const failed of recentFailedAvatarVideos.slice(0, 3)) {
    keyboard.push([
      {
        text: `♻️ Retry avatar #${failed.id.slice(0, 8)}`,
        callback_data: `lg:avvry:${failed.id}`,
      },
    ]);
  }
  keyboard.push([{ text: "🔄 Refresh all queue", callback_data: "legacy:queue:refresh" }]);
  keyboard.push([{ text: "🕘 Open history", callback_data: "legacy:history" }]);
  keyboard.push([{ text: "⬅️ Back", callback_data: "legacy:home" }]);

  await sendTrackedMessage(
    chatId,
    `📥 Job Queue\n` +
      `Active now: ${activeGenerations.length + activeAvatarVideos.length} ` +
      `(gen ${activeGenerations.length}, avatar ${activeAvatarVideos.length})\n` +
      `Failed recently: ${recentFailedGenerations.length + recentFailedAvatarVideos.length}\n\n` +
      `🎬 Generations — Pending (${generationPending.length}):\n${generationPendingLines}\n\n` +
      `🎬 Generations — Processing (${generationProcessing.length}):\n${generationProcessingLines}\n\n` +
      `🧍 Avatar videos — Pending (${avatarPending.length}):\n${avatarPendingLines}\n\n` +
      `🧍 Avatar videos — Processing (${avatarProcessing.length}):\n${avatarProcessingLines}\n\n` +
      `❌ Failed generations:\n${failedGenerationLines}\n\n` +
      `❌ Failed avatar videos:\n${failedAvatarLines}`,
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
        ...(String(generation.status || "").toLowerCase() === "processing" ||
        String(generation.status || "").toLowerCase() === "pending"
          ? [[{ text: "🔄 Refresh status", callback_data: `lg:gr:${generation.id}:${fromPage}` }]]
          : []),
        ...(generation.outputUrl ? [[{ text: "▶️ Open output", url: generation.outputUrl }]] : []),
        ...(String(generation.status || "").toLowerCase() !== "processing" &&
        String(generation.status || "").toLowerCase() !== "pending"
          ? [[{ text: "🗑 Delete generation", callback_data: `lg:gdc:${generation.id}:${fromPage}` }]]
          : []),
        [{ text: "Back to history", callback_data: `legacy:history:page:${fromPage}` }],
      ],
    },
  );
}

async function renderGenerationStatusCard(chatId, userId, generationId, fromPage = 0) {
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
  const status = String(generation.status || "").toLowerCase();
  const statusHint =
    status === "failed"
      ? "You can retry this generation using the same inputs."
      : status === "processing" || status === "pending"
        ? "Still running. Tap refresh to poll latest status."
        : "Completed.";
  await sendTrackedMessage(
    chatId,
    `🧾 Generation Status\nID: ${generation.id}\nType: ${generation.type}\nStatus: ${generation.status}\n` +
      `Credits: ${generation.creditsCost ?? 0}\nCreated: ${formatDate(generation.createdAt)}\n` +
      `Completed: ${formatDate(generation.completedAt)}\nOutput: ${generation.outputUrl || "pending"}\n` +
      `Prompt: ${(generation.prompt || "").slice(0, 220) || "n/a"}\n` +
      `Hint: ${statusHint}\n` +
      `${generation.errorMessage ? `Error: ${generation.errorMessage.slice(0, 200)}` : ""}`,
    {
      inline_keyboard: [
        ...(status === "processing" || status === "pending"
          ? [[{ text: "🔄 Refresh", callback_data: `lg:gr:${generation.id}:${fromPage}` }]]
          : []),
        ...(status === "failed"
          ? [[{ text: "♻️ Retry generation", callback_data: `legacy:generation:retry:${generation.id}:${fromPage}` }]]
          : []),
        ...(generation.outputUrl ? [[{ text: "▶️ Open output", url: generation.outputUrl }]] : []),
        ...(status !== "processing" && status !== "pending"
          ? [[{ text: "🗑 Delete generation", callback_data: `lg:gdc:${generation.id}:${fromPage}` }]]
          : []),
        [{ text: "⬅️ Back to history", callback_data: `legacy:history:page:${fromPage}` }],
      ],
    },
  );
}

async function renderAvatarVideoStatusCard(chatId, userId, videoId, modelId = "") {
  const video = await prisma.avatarVideo.findFirst({
    where: { id: videoId, userId },
    select: {
      id: true,
      status: true,
      outputUrl: true,
      creditsCost: true,
      duration: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
      avatar: { select: { id: true, name: true, modelId: true } },
    },
  });
  if (!video) {
    await sendTrackedMessage(chatId, "Avatar video not found.", legacyMainKeyboard());
    return;
  }
  const status = String(video.status || "").toLowerCase();
  const targetModelId = modelId || video.avatar?.modelId || "";
  const statusHint =
    status === "failed"
      ? "You can retry this avatar video with the same script."
      : status === "processing" || status === "pending"
        ? "Still running. Tap refresh to poll latest status."
        : "Completed.";
  await sendTrackedMessage(
    chatId,
    `🧍 Avatar Video Status\nVideo ID: ${video.id}\nAvatar: ${video.avatar?.name || "n/a"}\n` +
      `Status: ${video.status}\nCredits: ${video.creditsCost ?? 0}\nDuration: ${video.duration ?? "n/a"}\n` +
      `Created: ${formatDate(video.createdAt)}\nCompleted: ${formatDate(video.completedAt)}\n` +
      `Output: ${video.outputUrl || "pending"}\n` +
      `Hint: ${statusHint}\n` +
      `${video.errorMessage ? `Error: ${video.errorMessage.slice(0, 200)}` : ""}`,
    {
      inline_keyboard: [
        ...(status === "processing" || status === "pending"
          ? [[{ text: "🔄 Refresh", callback_data: `lg:avvr:${video.id}` }]]
          : []),
        ...(status === "failed"
          ? [[{ text: "♻️ Retry avatar video", callback_data: `lg:avvry:${video.id}` }]]
          : []),
        ...(video.outputUrl ? [[{ text: "▶️ Open video", url: video.outputUrl }]] : []),
        ...(targetModelId ? [[{ text: "⬅️ Back to avatars", callback_data: `legacy:avatars:model:${targetModelId}` }]] : [[{ text: "⬅️ Back", callback_data: "legacy:avatars" }]]),
      ],
    },
  );
}

async function retryLegacyPromptGeneration(chatId, userId, generationId, fromPage = 0) {
  const original = await prisma.generation.findFirst({
    where: { id: generationId, userId },
    select: {
      id: true,
      type: true,
      inputImageUrl: true,
      prompt: true,
      duration: true,
      status: true,
    },
  });
  if (!original) {
    await sendTrackedMessage(chatId, "Generation not found for retry.", legacyMainKeyboard());
    return;
  }
  if (!isHttpUrl(original.inputImageUrl) || !String(original.prompt || "").trim()) {
    await sendTrackedMessage(chatId, "Cannot retry: original prompt/image inputs are missing for this generation type.", {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:history:item:${generationId}:${fromPage}` }]],
    });
    return;
  }
  const duration = [5, 10].includes(Number(original.duration)) ? Number(original.duration) : 5;
  const retry = await submitLegacyPromptVideoGeneration(
    userId,
    original.inputImageUrl,
    String(original.prompt).trim(),
    duration,
  );
  if (!retry.ok) {
    await sendTrackedMessage(chatId, `❌ Retry failed to start: ${retry.message}`, {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:history:item:${generationId}:${fromPage}` }]],
    });
    return;
  }
  const newId = retry.generation?.id || "unknown";
  await sendTrackedMessage(
    chatId,
    `✅ Retry started.\nOld ID: ${generationId}\nNew ID: ${newId}\nDuration: ${duration}s\nCredits used: ${retry.creditsUsed ?? "n/a"}`,
    {
      inline_keyboard: [
        ...(newId !== "unknown" ? [[{ text: "🔄 Refresh new generation", callback_data: `lg:gr:${newId}:${fromPage}` }]] : []),
        [{ text: "🕘 Back to history", callback_data: `legacy:history:page:${fromPage}` }],
      ],
    },
  );
}

async function retryLegacyAvatarVideo(chatId, userId, videoId, modelId = "") {
  const original = await prisma.avatarVideo.findFirst({
    where: { id: videoId, userId },
    select: {
      id: true,
      script: true,
      avatarId: true,
      status: true,
      avatar: { select: { id: true, name: true, status: true, modelId: true } },
    },
  });
  if (!original || !original.avatar) {
    await sendTrackedMessage(chatId, "Avatar video not found for retry.", legacyMainKeyboard());
    return;
  }
  if (String(original.avatar.status || "").toLowerCase() !== "ready") {
    await sendTrackedMessage(chatId, `Avatar "${original.avatar.name}" is ${original.avatar.status}. It must be ready to retry.`, {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:avatars:model:${modelId || original.avatar.modelId}` }]],
    });
    return;
  }
  const script = String(original.script || "").trim();
  if (script.length < 4) {
    await sendTrackedMessage(chatId, "Cannot retry: original script is missing.", {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:avatars:model:${modelId || original.avatar.modelId}` }]],
    });
    return;
  }
  const retry = await submitLegacyAvatarVideoGeneration(userId, original.avatarId, script);
  if (!retry.ok) {
    await sendTrackedMessage(chatId, `❌ Retry failed to start: ${retry.message}`, {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:avatars:model:${modelId || original.avatar.modelId}` }]],
    });
    return;
  }
  const newId = retry.video?.id || "n/a";
  await sendTrackedMessage(
    chatId,
    `✅ Avatar retry started.\nOld video: ${videoId}\nNew video: ${newId}\nEstimated: ${retry.estimatedSecs ?? "n/a"}s\nCredits: ${retry.creditsCost ?? "n/a"}`,
    {
      inline_keyboard: [
        ...(newId !== "n/a" ? [[{ text: "🔄 Refresh new video", callback_data: `lg:avvr:${newId}` }]] : []),
        [{ text: "⬅️ Back to avatars", callback_data: `legacy:avatars:model:${modelId || original.avatar.modelId}` }],
      ],
    },
  );
}

async function renderModelPickerForAction(chatId, userId, actionPrefix, title) {
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
  const rows = models.map((m) => [
    {
      text: `${m.name} (${m.status || "ready"})`,
      callback_data: `${actionPrefix}:${m.id}`,
    },
  ]);
  rows.push([{ text: "⬅️ Back", callback_data: "legacy:home" }]);
  await sendTrackedMessage(chatId, title, { inline_keyboard: rows });
}

async function renderVoiceStatus(chatId, userId, modelId) {
  const [model, voices] = await Promise.all([
    prisma.savedModel.findFirst({
      where: { id: modelId, userId },
      select: {
        id: true,
        name: true,
        elevenLabsVoiceId: true,
        elevenLabsVoiceType: true,
        elevenLabsVoiceName: true,
        modelVoicePreviewUrl: true,
      },
    }),
    prisma.modelVoice.findMany({
      where: { userId, modelId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        name: true,
        type: true,
        isDefault: true,
        voiceBillingStatus: true,
        previewUrl: true,
      },
    }),
  ]);
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  const defaultVoiceLine = model.elevenLabsVoiceId
    ? `Default voice: ${model.elevenLabsVoiceName || model.elevenLabsVoiceId} (${model.elevenLabsVoiceType || "n/a"})`
    : "Default voice: not set";
  const voiceLines = voices.length
    ? voices.map((v, idx) => `${idx + 1}. ${v.name} [${v.type}] ${v.isDefault ? "⭐ default" : ""} (${v.voiceBillingStatus})`).join("\n")
    : "No voice rows found for this model.";
  const voiceButtons = voices.slice(0, 6).map((v, idx) => [
    {
      text: `${v.isDefault ? "⭐" : "🎛"} Set ${idx + 1} default`,
      callback_data: `legacy:voice:select:${v.id}`,
    },
  ]);
  const audioButtons = voices.slice(0, 4).map((v, idx) => [
    {
      text: `🔊 Generate audio ${idx + 1}`,
      callback_data: `legacy:voice:audio:start:${v.id}`,
    },
  ]);
  const deleteButtons = voices
    .filter((v) => !v.isDefault)
    .slice(0, 3)
    .map((v, idx) => [
      {
        text: `🗑 Delete voice ${idx + 1}`,
        callback_data: `lg:vdc:${v.id}`,
      },
    ]);
  await sendTrackedMessage(
    chatId,
    `🎤 Voice Studio\nModel: ${model.name}\n${defaultVoiceLine}\n\nVoices:\n${voiceLines}`,
    {
      inline_keyboard: [
        ...voiceButtons,
        ...audioButtons,
        ...deleteButtons,
        [{ text: "🧬 Clone voice from MP3", callback_data: `legacy:voice:clone:start:${model.id}` }],
        ...(model.modelVoicePreviewUrl ? [[{ text: "▶️ Open default preview", url: model.modelVoicePreviewUrl }]] : []),
        [{ text: "⬅️ Back", callback_data: "legacy:voice" }],
      ],
    },
  );
}

async function renderLegacyPricing(chatId, userId) {
  const [user, sub] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true,
        subscriptionTier: true,
        subscriptionStatus: true,
      },
    }),
    fetchLegacySubscriptionStatus(userId),
  ]);
  const totalCredits =
    Number(user?.credits ?? 0) +
    Number(user?.subscriptionCredits ?? 0) +
    Number(user?.purchasedCredits ?? 0);
  const subLine = sub.ok
    ? `${sub.data?.status || "none"} (${sub.data?.tier || user?.subscriptionTier || "none"})`
    : `${user?.subscriptionStatus || "trial"} (${user?.subscriptionTier || "none"})`;
  await sendTrackedMessage(
    chatId,
    `💳 Billing & Credits\nTotal credits: ${totalCredits}\nSubscription: ${subLine}\n\nChoose an action:`,
    {
      inline_keyboard: [
        [
          { text: "🪙 250 credits", callback_data: "legacy:billing:buy:250" },
          { text: "🪙 500 credits", callback_data: "legacy:billing:buy:500" },
        ],
        [{ text: "🪙 1000 credits", callback_data: "legacy:billing:buy:1000" }],
        [
          { text: "📈 Starter monthly", callback_data: "legacy:billing:sub:starter:monthly" },
          { text: "🚀 Pro monthly", callback_data: "legacy:billing:sub:pro:monthly" },
        ],
        [
          { text: "📈 Starter annual", callback_data: "legacy:billing:sub:starter:annual" },
          { text: "🚀 Pro annual", callback_data: "legacy:billing:sub:pro:annual" },
        ],
        [{ text: "🏢 Business monthly", callback_data: "legacy:billing:sub:business:monthly" }],
        [{ text: "🏢 Business annual", callback_data: "legacy:billing:sub:business:annual" }],
        [{ text: "🧾 Manage billing", callback_data: "legacy:billing:portal" }],
        [{ text: "🛑 Cancel subscription", callback_data: "legacy:billing:cancel:confirm" }],
        [{ text: "🔄 Refresh", callback_data: "legacy:pricing" }],
        [{ text: "⬅️ Back", callback_data: "legacy:home" }],
      ],
    },
  );
}

async function renderLegacyToolsMenu(chatId) {
  await sendTrackedMessage(chatId, "🧰 Tools Bundle", {
    inline_keyboard: [
      [{ text: "🎞 Reformatter", callback_data: "legacy:tools:reformatter:start" }],
      [{ text: "🔍 Upscaler", callback_data: "legacy:tools:upscaler:start" }],
      [{ text: "♻️ Repurposer", callback_data: "legacy:tools:repurposer:start" }],
      [{ text: "⬅️ Back", callback_data: "legacy:home" }],
    ],
  });
}

async function renderLegacyReformatterStatusCard(chatId, userId, jobId) {
  const status = await fetchLegacyReformatterStatus(userId, jobId);
  if (!status.ok || !status.job) {
    await sendTrackedMessage(chatId, `❌ Reformatter status error: ${status.message}`, {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: "legacy:tools:reformatter:start" }]],
    });
    return;
  }
  const job = status.job;
  await sendTrackedMessage(
    chatId,
    `🎞 Reformatter Job\nID: ${job.id}\nStatus: ${job.status}\nOutput: ${job.outputUrl || "pending"}\n` +
      `${job.errorMessage ? `Error: ${job.errorMessage}` : ""}`,
    {
      inline_keyboard: [
        ...(job.status === "processing" ? [[{ text: "🔄 Refresh", callback_data: `legacy:reformatter:status:${job.id}` }]] : []),
        ...(job.outputUrl ? [[{ text: "▶️ Open output", url: job.outputUrl }]] : []),
        [{ text: "⬅️ Back", callback_data: "legacy:tools:reformatter:start" }],
      ],
    },
  );
}

async function renderLegacyUpscaleStatusCard(chatId, userId, generationId) {
  const status = await fetchLegacyUpscaleStatus(userId, generationId);
  if (!status.ok || !status.data) {
    await sendTrackedMessage(chatId, `❌ Upscaler status error: ${status.message}`, {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: "legacy:tools:upscaler:start" }]],
    });
    return;
  }
  const info = status.data;
  await sendTrackedMessage(
    chatId,
    `🖼 Upscaler Job\nID: ${generationId}\nStatus: ${info.status}\nOutput: ${info.imageUrl || "pending"}\n` +
      `${info.error ? `Error: ${info.error}` : ""}`,
    {
      inline_keyboard: [
        ...(info.status === "processing" ? [[{ text: "🔄 Refresh", callback_data: `legacy:upscale:status:${generationId}` }]] : []),
        ...(info.imageUrl ? [[{ text: "▶️ Open output", url: info.imageUrl }]] : []),
        [{ text: "⬅️ Back", callback_data: "legacy:tools:upscaler:start" }],
      ],
    },
  );
}

async function renderLegacyRepurposerStatusCard(chatId, userId, jobId) {
  const status = await fetchLegacyRepurposeStatus(userId, jobId);
  if (!status.ok || !status.job) {
    await sendTrackedMessage(chatId, `❌ Repurposer status error: ${status.message}`, {
      inline_keyboard: [[{ text: "⬅️ Back", callback_data: "legacy:tools:repurposer:start" }]],
    });
    return;
  }
  const job = status.job;
  const outputs = Array.isArray(job.outputs) ? job.outputs : [];
  const lines = outputs.length
    ? outputs.map((o, i) => `${i + 1}. ${o.file_name || o.fileName || "output"} • ${o.download_url || o.fileUrl || "n/a"}`).join("\n")
    : "No outputs yet.";
  await sendTrackedMessage(
    chatId,
    `♻️ Repurposer Job\nID: ${job.id}\nStatus: ${job.status}\nProgress: ${job.progress ?? 0}%\nMessage: ${job.message || "n/a"}\n` +
      `${job.error ? `Error: ${job.error}\n` : ""}` +
      `Outputs:\n${lines}`,
    {
      inline_keyboard: [
        ...(job.status === "queued" || job.status === "running" || job.status === "processing"
          ? [[{ text: "🔄 Refresh", callback_data: `legacy:repurposer:status:${job.id}` }]]
          : []),
        ...outputs.slice(0, 3).map((o, idx) => [{ text: `▶️ Output ${idx + 1}`, url: o.download_url || o.fileUrl }]),
        [{ text: "⬅️ Back", callback_data: "legacy:tools:repurposer:start" }],
      ],
    },
  );
}

async function renderAvatarStatus(chatId, userId, modelId) {
  const [model, avatars, videos] = await Promise.all([
    prisma.savedModel.findFirst({
      where: { id: modelId, userId },
      select: { id: true, name: true },
    }),
    prisma.avatar.findMany({
      where: { userId, modelId },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        name: true,
        status: true,
        heygenGroupId: true,
        heygenAvatarId: true,
        lastBilledAt: true,
      },
    }),
    prisma.avatarVideo.findMany({
      where: { userId, avatar: { modelId } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, status: true, outputUrl: true, createdAt: true },
    }),
  ]);
  if (!model) {
    await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
    return;
  }
  const avatarLines = avatars.length
    ? avatars
        .map(
          (a, i) =>
            `${i + 1}. ${a.name} • ${a.status} • billed ${formatDate(a.lastBilledAt)} • group ${a.heygenGroupId || "n/a"}`,
        )
        .join("\n")
    : "No avatars for this model yet.";
  const videoLines = videos.length
    ? videos.map((v, i) => `${i + 1}. ${v.status} • ${formatDate(v.createdAt)} • ${v.outputUrl || "pending"}`).join("\n")
    : "No avatar videos yet.";
  const generateButtons = avatars
    .filter((a) => String(a.status || "").toLowerCase() === "ready")
    .slice(0, 6)
    .map((a, idx) => [{ text: `🎬 Gen with ${idx + 1}`, callback_data: `legacy:avatar:gen:start:${a.id}` }]);
  const refreshButtons = videos
    .slice(0, 4)
    .map((v, idx) => [{ text: `🔄 Video ${idx + 1} status`, callback_data: `lg:avvr:${v.id}` }]);
  const deleteButtons = avatars
    .slice(0, 3)
    .map((a, idx) => [{ text: `🗑 Delete avatar ${idx + 1}`, callback_data: `lg:avdc:${a.id}` }]);
  await sendTrackedMessage(
    chatId,
    `🧍 Avatar Studio\nModel: ${model.name}\n\nAvatars:\n${avatarLines}\n\nRecent avatar videos:\n${videoLines}`,
    {
      inline_keyboard: [
        [{ text: "➕ Create avatar", callback_data: `legacy:avatar:create:start:${model.id}` }],
        ...generateButtons,
        ...refreshButtons,
        ...deleteButtons,
        [{ text: "⬅️ Back", callback_data: "legacy:avatars" }],
      ],
    },
  );
}

async function renderSettingsSummary(chatId, userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      isVerified: true,
      twoFactorEnabled: true,
      authProvider: true,
      subscriptionStatus: true,
      region: true,
      marketingLanguage: true,
      updatedAt: true,
    },
  });
  if (!user) {
    await sendTrackedMessage(chatId, "Account not found.", legacyMainKeyboard());
    return;
  }
  await sendTrackedMessage(
    chatId,
    `⚙️ Settings\nName: ${user.name || "n/a"}\nEmail: ${user.email}\nVerified: ${user.isVerified ? "yes" : "no"}\n` +
      `Auth provider: ${user.authProvider || "email"}\n2FA: ${user.twoFactorEnabled ? "enabled" : "disabled"}\n` +
      `Subscription: ${user.subscriptionStatus || "trial"}\nRegion: ${user.region || "n/a"}\nLanguage: ${user.marketingLanguage || "n/a"}\n` +
      `Updated: ${formatDate(user.updatedAt)}`,
    {
      inline_keyboard: [
        [{ text: "✏️ Change display name", callback_data: "legacy:settings:name" }],
        [{ text: "💳 Billing & credits", callback_data: "legacy:pricing" }],
        [{ text: "🔄 Refresh", callback_data: "legacy:settings" }],
        [{ text: "⬅️ Back", callback_data: "legacy:home" }],
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
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderLegacyPricing(chatId, session.userId);
    return;
  }

  const session = await ensureLegacyAuth(chatId);
  if (!session) return;

  if (action === "voice") {
    await renderModelPickerForAction(chatId, session.userId, "legacy:voice:model", "Select model for 🎤 Voice Studio:");
    return;
  }

  if (action === "avatars") {
    await renderModelPickerForAction(chatId, session.userId, "legacy:avatars:model", "Select model for 🧍 Avatar Studio:");
    return;
  }

  if (action === "settings") {
    await renderSettingsSummary(chatId, session.userId);
    return;
  }

  if (action === "create_model") {
    setFlow(chatId, { step: "await_create_model_name" });
    await sendTrackedMessage(chatId, "Send the model name:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

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

  if (action === "queue") {
    await renderLegacyQueue(chatId, session.userId);
    return;
  }

  if (action === "tools") {
    await renderLegacyToolsMenu(chatId);
    return;
  }

  if (action === "reformatter") {
    setFlow(chatId, { step: "await_reformatter_input" });
    await sendTrackedMessage(chatId, "Send media URL or upload media file for reformatter:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (action === "upscaler") {
    setFlow(chatId, { step: "await_upscale_input" });
    await sendTrackedMessage(chatId, "Send image URL or upload image for upscaling:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (action === "repurposer") {
    setFlow(chatId, { step: "await_repurposer_source" });
    await sendTrackedMessage(chatId, "Send source video/image URL or upload source media for repurposer:", {
      keyboard: [["Skip", "Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  await sendHybridFallback(chatId, action);

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

  if (mode === MODE_LEGACY && ["home", "menu", "login", "logout", "help", "pricing", "models", "dashboard", "generate", "history", "queue", "voice", "avatars", "settings", "create", "reformatter", "upscaler", "repurposer", "tools"].includes(command)) {
    if (command === "menu") {
      await sendLegacyMenu(chatId, firstName);
      return;
    }
    await handleLegacyAction(chatId, command === "create" ? "create_model" : command, telegramUserId);
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
  if (text === "home" || text === "🏠 home") return "home";
  if (text === "menu") return "home";
  if (text === "create model" || text === "➕ create model") return "create_model";
  if (text === "my photos" || text === "🖼 my photos") return "models";
  if (text === "edit model" || text === "✏️ edit model") return "models";
  if (text === "voice" || text === "🎤 voice") return "voice";
  if (text === "avatars" || text === "🧍 avatars") return "avatars";
  if (text === "settings" || text === "⚙️ settings") return "settings";
  if (text === "tools" || text === "🧰 tools") return "tools";
  if (text === "reformatter" || text === "🎞 reformatter") return "reformatter";
  if (text === "upscaler" || text === "🖼 upscaler" || text === "🔍 upscaler") return "upscaler";
  if (text === "repurposer" || text === "♻️ repurposer") return "repurposer";
  if (text === "cancel") return "cancel";
  if (text === "login" || text === "🔐 login") return "login";
  if (text === "logout" || text === "🚪 logout") return "logout";
  if (text === "generate" || text === "🎬 generate") return "generate";
  if (text === "models" || text === "🧬 models") return "models";
  if (text === "dashboard" || text === "📊 dashboard") return "dashboard";
  if (text === "history" || text === "🕘 history") return "history";
  if (text === "queue" || text === "📥 queue" || text === "job queue" || text === "📥 job queue") return "queue";
  if (text === "pricing" || text === "💳 pricing") return "pricing";
  if (text === "help" || text === "🆘 help") return "help";
  if (text === "switch mode" || text === "🔁 switch mode") return "switch_mode";
  return null;
}

async function handleLegacyPlainMessage(message) {
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();
  const telegramUserId = message?.from?.id;
  if (!chatId) return false;

  // Detect flow expiry: if there was a flow in the map but getFlow() cleared it,
  // tell the user their session step timed out instead of silently ignoring input.
  const rawFlow = legacyFlowMap.get(String(chatId)) || null;
  const activeFlow = getFlow(chatId); // This evicts expired flows
  if (rawFlow && !activeFlow) {
    // Flow was expired and cleared — inform user
    await sendTrackedMessage(
      chatId,
      "Your previous step has expired (45 min timeout). Use the buttons or a command to start over.",
      legacyMainKeyboard(),
    );
    return true;
  }

  const hasImageInput =
    (Array.isArray(message?.photo) && message.photo.length > 0) ||
    Boolean(message?.document?.file_id && String(message?.document?.mime_type || "").toLowerCase().startsWith("image/"));
  const hasVideoInput =
    Boolean(message?.video?.file_id) ||
    Boolean(message?.document?.file_id && String(message?.document?.mime_type || "").toLowerCase().startsWith("video/"));
  const hasAudioInput = isTelegramMp3Message(message);
  if (!text && !hasImageInput && !hasVideoInput && !hasAudioInput) return false;

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
    // Look up the secret fresh from DB — never stored in flow for security reasons.
    const twoFaUser = await prisma.user.findUnique({
      where: { id: flow.userId },
      select: { twoFactorSecret: true },
    });
    if (!twoFaUser?.twoFactorSecret) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "2FA setup appears incomplete. Please contact support.", legacyMainKeyboard());
      return true;
    }
    const { authenticator } = await import("otplib");
    const isValid = authenticator.verify({
      token: code,
      secret: twoFaUser.twoFactorSecret,
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

  if (flow?.step === "await_model_photo_swap_url") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    let pendingUrl = null;
    try {
      pendingUrl = await resolveLegacyImageInputUrl(message, text);
    } catch {
      pendingUrl = null;
    }
    if (!pendingUrl || !isHttpUrl(pendingUrl)) {
      await sendTrackedMessage(chatId, "Please send a valid photo URL or upload an image.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const model = await prisma.savedModel.findFirst({
      where: { id: flow.modelId, userId: session.userId },
      select: {
        id: true,
        isAIGenerated: true,
        nsfwOverride: true,
        nsfwUnlocked: true,
        looksUnlockedByAdmin: true,
      },
    });
    if (!model) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return true;
    }
    const photosLocked =
      (model.isAIGenerated || model.nsfwOverride || model.nsfwUnlocked) &&
      !model.looksUnlockedByAdmin;
    if (photosLocked) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Photos are locked for this model and cannot be edited here.", legacyMainKeyboard());
      return true;
    }
    const slot = flow.photoSlot;
    if (!["photo1", "photo2", "photo3"].includes(slot)) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Invalid photo slot.", legacyMainKeyboard());
      return true;
    }
    setFlow(chatId, {
      step: "await_model_photo_swap_confirm",
      modelId: flow.modelId,
      photoSlot: slot,
      page: flow.page || 0,
      pendingUrl,
    });
    await sendTrackedPhoto(chatId, pendingUrl, {
      caption: `Preview for ${slot}. Save this photo?`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "✅ Save photo", callback_data: "legacy:model:photo:swap:save" }],
          [{ text: "❌ Cancel", callback_data: "legacy:model:photo:swap:cancel" }],
        ],
      },
    });
    return true;
  }

  if (flow?.step === "await_model_look_value") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const model = await prisma.savedModel.findFirst({
      where: { id: flow.modelId, userId: session.userId },
      select: { id: true, savedAppearance: true },
    });
    if (!model) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return true;
    }
    const allowedFields = new Set(["gender", "hairColor", "eyeColor", "style", "bodyType", "heritage"]);
    const field = String(flow.lookField || "");
    if (!allowedFields.has(field)) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Invalid looks field.", legacyMainKeyboard());
      return true;
    }
    const value = text.trim();
    if (!value) {
      await sendTrackedMessage(chatId, "Value cannot be empty. Send a value or tap Cancel.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const current = (model.savedAppearance && typeof model.savedAppearance === "object" && !Array.isArray(model.savedAppearance))
      ? { ...model.savedAppearance }
      : {};
    current[field] = value;
    delete current.age;
    await prisma.savedModel.update({
      where: { id: model.id },
      data: { savedAppearance: current },
    });
    clearFlow(chatId);
    await sendTrackedMessage(chatId, `✅ Updated look "${field}" to "${value}".`, {
      inline_keyboard: [[{ text: "⬅️ Back to looks", callback_data: `legacy:model:looks:menu:${flow.modelId}:${flow.page || 0}` }]],
    });
    return true;
  }

  if (flow?.step === "await_model_age") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const age = Number.parseInt(text, 10);
    if (Number.isNaN(age) || age < 1 || age > 85) {
      await sendTrackedMessage(chatId, "Age must be a number between 1 and 85. Try again or tap Cancel.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    await prisma.savedModel.updateMany({
      where: { id: flow.modelId, userId: session.userId },
      data: { age },
    });
    clearFlow(chatId);
    await sendTrackedMessage(chatId, `Updated model age to ${age}.`, {
      inline_keyboard: [[{ text: "⬅️ Back to model", callback_data: `legacy:model:open:${flow.modelId}:${flow.page || 0}` }]],
    });
    return true;
  }

  if (flow?.step === "await_create_model_name") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const name = text.trim();
    if (name.length < 2 || name.length > 80) {
      await sendTrackedMessage(chatId, "Model name must be 2-80 characters. Try again:", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    setFlow(chatId, { step: "await_create_model_photo1", name });
    await sendTrackedMessage(chatId, `Great. Send photo 1 URL or upload photo 1 for "${name}":`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return true;
  }

  if (flow?.step === "await_create_model_photo1") {
    let photo1Url = null;
    try {
      photo1Url = await resolveLegacyImageInputUrl(message, text);
    } catch {
      photo1Url = null;
    }
    if (!photo1Url || !isHttpUrl(photo1Url)) {
      await sendTrackedMessage(chatId, "Send a valid URL or upload image for photo 1.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    setFlow(chatId, {
      step: "await_create_model_photo2",
      name: flow.name,
      photo1Url,
    });
    await sendTrackedMessage(chatId, "Now send photo 2 URL or upload photo 2:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return true;
  }

  if (flow?.step === "await_create_model_photo2") {
    let photo2Url = null;
    try {
      photo2Url = await resolveLegacyImageInputUrl(message, text);
    } catch {
      photo2Url = null;
    }
    if (!photo2Url || !isHttpUrl(photo2Url)) {
      await sendTrackedMessage(chatId, "Send a valid URL or upload image for photo 2.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    setFlow(chatId, {
      step: "await_create_model_photo3",
      name: flow.name,
      photo1Url: flow.photo1Url,
      photo2Url,
    });
    await sendTrackedMessage(chatId, "Now send photo 3 URL or upload photo 3:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return true;
  }

  if (flow?.step === "await_create_model_photo3") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    let photo3Url = null;
    try {
      photo3Url = await resolveLegacyImageInputUrl(message, text);
    } catch {
      photo3Url = null;
    }
    if (!photo3Url || !isHttpUrl(photo3Url)) {
      await sendTrackedMessage(chatId, "Send a valid URL or upload image for photo 3.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    await createModelFromLegacyFlow(chatId, session.userId, {
      name: flow.name,
      photo1Url: flow.photo1Url,
      photo2Url: flow.photo2Url,
      photo3Url,
    });
    clearFlow(chatId);
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

  if (flow?.step === "await_settings_name") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const newName = text.trim();
    if (newName.length < 2 || newName.length > 80) {
      await sendTrackedMessage(chatId, "Display name must be 2-80 characters. Try again:", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    await prisma.user.update({
      where: { id: session.userId },
      data: { name: newName },
    });
    clearFlow(chatId);
    await sendTrackedMessage(chatId, `✅ Display name updated to "${newName}".`, {
      inline_keyboard: [[{ text: "⬅️ Back to settings", callback_data: "legacy:settings" }]],
    });
    return true;
  }

  if (flow?.step === "await_avatar_script") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const script = text.trim();
    if (script.length < 4) {
      await sendTrackedMessage(chatId, "Script is too short. Send at least a few words.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const result = await submitLegacyAvatarVideoGeneration(session.userId, flow.avatarId, script);
    clearFlow(chatId);
    if (!result.ok) {
      await sendTrackedMessage(chatId, `❌ Avatar generation failed to start: ${result.message}`, legacyMainKeyboard());
      return true;
    }
    await sendTrackedMessage(
      chatId,
      `✅ Avatar video started.\nVideo ID: ${result.video?.id || "n/a"}\nEstimated: ${result.estimatedSecs ?? "n/a"}s\nCredits: ${result.creditsCost ?? "n/a"}`,
      {
        inline_keyboard: [
          ...(result.video?.id ? [[{ text: "🔄 Refresh video status", callback_data: `legacy:avatar:video:refresh:${result.video.id}:${flow.modelId}` }]] : []),
          [{ text: "🧍 Back to avatars", callback_data: `legacy:avatars:model:${flow.modelId}` }],
          [{ text: "🕘 View history", callback_data: "legacy:history" }],
        ],
      },
    );
    return true;
  }

  if (flow?.step === "await_voice_audio_script") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const script = String(text || "").trim();
    if (script.length < 4) {
      await sendTrackedMessage(chatId, "Script is too short. Send at least a few words.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const voice = await prisma.modelVoice.findFirst({
      where: { id: flow.voiceId, userId: session.userId },
      select: { id: true, modelId: true, name: true },
    });
    if (!voice) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Voice not found.", legacyMainKeyboard());
      return true;
    }
    const generated = await submitLegacyGenerateVoiceAudio(session.userId, voice.modelId, voice.id, script);
    clearFlow(chatId);
    if (!generated.ok) {
      await sendTrackedMessage(chatId, `❌ Voice audio failed: ${generated.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:voice:model:${voice.modelId}` }]],
      });
      return true;
    }
    await sendTrackedMessage(
      chatId,
      `✅ Voice audio generated.\nVoice: ${voice.name}\nAudio ID: ${generated.audio?.id || "n/a"}\nCredits: ${generated.creditsUsed ?? "n/a"}\n` +
        `Output: ${generated.audio?.audioUrl || "pending"}`,
      {
        inline_keyboard: [
          ...(generated.audio?.audioUrl ? [[{ text: "▶️ Open audio", url: generated.audio.audioUrl }]] : []),
          [{ text: "⬅️ Back to voice studio", callback_data: `legacy:voice:model:${voice.modelId}` }],
        ],
      },
    );
    return true;
  }

  if (flow?.step === "await_voice_clone_audio") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const model = await prisma.savedModel.findFirst({
      where: { id: flow.modelId, userId: session.userId },
      select: { id: true, name: true },
    });
    if (!model) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return true;
    }
    if (!isTelegramMp3Message(message)) {
      await sendTrackedMessage(chatId, "Please upload an MP3 file (Telegram audio or document).", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    let mp3Input = null;
    try {
      mp3Input = await resolveLegacyMp3Input(message);
    } catch {
      mp3Input = null;
    }
    if (!mp3Input?.buffer?.length) {
      await sendTrackedMessage(chatId, "Failed to read MP3 file. Please try another file.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const cloned = await submitLegacyCloneVoiceFromMp3(
      session.userId,
      model.id,
      mp3Input.buffer,
      mp3Input.fileName,
      mp3Input.mimeType,
    );
    clearFlow(chatId);
    if (!cloned.ok) {
      await sendTrackedMessage(chatId, `❌ Voice clone failed: ${cloned.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:voice:model:${model.id}` }]],
      });
      return true;
    }
    await sendTrackedMessage(
      chatId,
      `✅ Voice clone created for model "${model.name}".\nVoice ID: ${cloned.voice?.id || "n/a"}\nCredits: ${cloned.creditsUsed ?? "n/a"}`,
      {
        inline_keyboard: [[{ text: "⬅️ Back to voice studio", callback_data: `legacy:voice:model:${model.id}` }]],
      },
    );
    return true;
  }

  if (flow?.step === "await_avatar_create_name") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const name = String(text || "").trim();
    if (name.length < 2 || name.length > 80) {
      await sendTrackedMessage(chatId, "Avatar name must be 2-80 characters.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    setFlow(chatId, { step: "await_avatar_create_photo", modelId: flow.modelId, avatarName: name });
    await sendTrackedMessage(chatId, `Send photo URL or upload photo for avatar "${name}":`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return true;
  }

  if (flow?.step === "await_avatar_create_photo") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const photoUrl = await resolveLegacyImageInputUrl(message, text);
    if (!photoUrl || !isHttpUrl(photoUrl)) {
      await sendTrackedMessage(chatId, "Send a valid image URL or upload an image for avatar photo.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const created = await submitLegacyCreateAvatar(session.userId, flow.modelId, flow.avatarName, photoUrl);
    clearFlow(chatId);
    if (!created.ok) {
      await sendTrackedMessage(chatId, `❌ Avatar create failed: ${created.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:avatars:model:${flow.modelId}` }]],
      });
      return true;
    }
    await sendTrackedMessage(chatId, `✅ Avatar "${flow.avatarName}" creation started.\nAvatar ID: ${created.avatar?.id || "n/a"}`, {
      inline_keyboard: [[{ text: "🔄 Refresh avatars", callback_data: `legacy:avatars:model:${flow.modelId}` }]],
    });
    return true;
  }

  if (flow?.step === "await_reformatter_input") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const inputUrl = await resolveLegacyMediaInputUrl(message, text, {
      allowImages: true,
      allowVideos: true,
      allowDocuments: true,
    });
    if (!inputUrl || !isHttpUrl(inputUrl)) {
      await sendTrackedMessage(chatId, "Send a valid media URL or upload media file.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const originalFileName = String(message?.document?.file_name || message?.video?.file_name || "telegram_upload");
    const job = await submitLegacyReformatterJob(session.userId, inputUrl, originalFileName);
    clearFlow(chatId);
    if (!job.ok || !job.jobId) {
      await sendTrackedMessage(chatId, `❌ Reformatter failed to start: ${job.message}`, legacyMainKeyboard());
      return true;
    }
    await sendTrackedMessage(chatId, `✅ Reformatter started.\nJob ID: ${job.jobId}`, {
      inline_keyboard: [
        [{ text: "🔄 Refresh status", callback_data: `legacy:reformatter:status:${job.jobId}` }],
        [{ text: "🧰 Back to tools", callback_data: "legacy:tools" }],
      ],
    });
    return true;
  }

  if (flow?.step === "await_upscale_input") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const inputUrl = await resolveLegacyImageInputUrl(message, text);
    if (!inputUrl || !isHttpUrl(inputUrl)) {
      await sendTrackedMessage(chatId, "Send a valid image URL or upload image for upscaling.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const started = await submitLegacyUpscaleFromUrl(session.userId, inputUrl);
    clearFlow(chatId);
    if (!started.ok || !started.generationId) {
      await sendTrackedMessage(chatId, `❌ Upscaler failed to start: ${started.message}`, legacyMainKeyboard());
      return true;
    }
    await sendTrackedMessage(chatId, `✅ Upscaler started.\nGeneration ID: ${started.generationId}`, {
      inline_keyboard: [
        [{ text: "🔄 Refresh status", callback_data: `legacy:upscale:status:${started.generationId}` }],
        [{ text: "🧰 Back to tools", callback_data: "legacy:tools" }],
      ],
    });
    return true;
  }

  if (flow?.step === "await_repurposer_source") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const sourceUrl = await resolveLegacyMediaInputUrl(message, text, {
      allowImages: true,
      allowVideos: true,
      allowDocuments: true,
    });
    if (!sourceUrl || !isHttpUrl(sourceUrl)) {
      await sendTrackedMessage(chatId, "Send a valid media URL or upload source media.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    setFlow(chatId, { step: "await_repurposer_watermark", sourceUrl });
    await sendTrackedMessage(chatId, "Send watermark URL/upload, or tap Skip to run without watermark.", {
      keyboard: [["Skip", "Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return true;
  }

  if (flow?.step === "await_repurposer_watermark") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    const skip = String(text || "").trim().toLowerCase() === "skip";
    let watermarkUrl = null;
    if (!skip) {
      watermarkUrl = await resolveLegacyMediaInputUrl(message, text, {
        allowImages: true,
        allowVideos: false,
        allowDocuments: true,
      });
      if (!watermarkUrl || !isHttpUrl(watermarkUrl)) {
        await sendTrackedMessage(chatId, "Send a valid watermark URL/upload image, or tap Skip.", {
          keyboard: [["Skip", "Cancel"]],
          resize_keyboard: true,
          one_time_keyboard: true,
        });
        return true;
      }
    }
    const started = await submitLegacyRepurposerJob(session.userId, flow.sourceUrl, watermarkUrl);
    clearFlow(chatId);
    if (!started.ok || !started.jobId) {
      await sendTrackedMessage(chatId, `❌ Repurposer failed to start: ${started.message}`, legacyMainKeyboard());
      return true;
    }
    await sendTrackedMessage(chatId, `✅ Repurposer started.\nJob ID: ${started.jobId}`, {
      inline_keyboard: [
        [{ text: "🔄 Refresh status", callback_data: `legacy:repurposer:status:${started.jobId}` }],
        [{ text: "🧰 Back to tools", callback_data: "legacy:tools" }],
      ],
    });
    return true;
  }

  if (flow?.step === "await_generate_source_image") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return true;
    let inputImageUrl = null;
    try {
      inputImageUrl = await resolveLegacyImageInputUrl(message, text);
    } catch {
      inputImageUrl = null;
    }
    if (!inputImageUrl || !isHttpUrl(inputImageUrl)) {
      await sendTrackedMessage(chatId, "Send a valid image URL or upload an image to start generation.", {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      });
      return true;
    }
    const duration = [5, 10].includes(Number(flow.duration)) ? Number(flow.duration) : 5;
    const submit = await submitLegacyPromptVideoGeneration(
      session.userId,
      inputImageUrl,
      String(flow.prompt || "").trim(),
      duration,
    );
    clearFlow(chatId);
    if (!submit.ok) {
      await sendTrackedMessage(
        chatId,
        `❌ Generation failed to start: ${submit.message}`,
        legacyMainKeyboard(),
      );
      return true;
    }
    const generationId = submit.generation?.id || "unknown";
    await sendTrackedMessage(
      chatId,
      `✅ Generation started.\nID: ${generationId}\nDuration: ${duration}s\nCredits used: ${submit.creditsUsed ?? "n/a"}`,
      {
        inline_keyboard: [
          ...(generationId !== "unknown" ? [[{ text: "🔄 Refresh generation", callback_data: `legacy:generation:refresh:${generationId}:0` }]] : []),
          [{ text: "🕘 View history", callback_data: "legacy:history" }],
          [{ text: "🎬 Start another", callback_data: "legacy:generate" }],
        ],
      },
    );
    return true;
  }

  if (flow?.step === "await_generate_duration") {
    const parsed = Number.parseInt(text, 10);
    if (![5, 10].includes(parsed)) {
      await sendTrackedMessage(chatId, "Choose duration by replying 5 or 10, or tap the duration buttons.", {
        inline_keyboard: [
          [
            { text: "5s", callback_data: "legacy:generate:duration:5" },
            { text: "10s", callback_data: "legacy:generate:duration:10" },
          ],
          [{ text: "Cancel", callback_data: "legacy:home" }],
        ],
      });
      return true;
    }
    setFlow(chatId, {
      step: "await_generate_source_image",
      modelId: flow.modelId,
      modelName: flow.modelName,
      prompt: flow.prompt,
      duration: parsed,
    });
    await sendTrackedMessage(chatId, `Duration set to ${parsed}s. Send source image URL or upload an image:`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
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

  // NOTE: We do NOT eagerly delete the message here.
  // sendTrackedMessage → clearTrackedBotMessages removes all tracked bot messages
  // (including the one with buttons) before each new reply, so there is no orphaned
  // button panel. Deleting before auth would leave users with a blank chat on failure.

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

  if (data.startsWith("legacy:voice:model:")) {
    const modelId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderVoiceStatus(chatId, session.userId, modelId);
    return;
  }

  if (data.startsWith("legacy:voice:select:")) {
    const voiceId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const voice = await prisma.modelVoice.findFirst({
      where: { id: voiceId, userId: session.userId },
      select: { id: true, modelId: true, name: true },
    });
    if (!voice) {
      await sendTrackedMessage(chatId, "Voice not found.", legacyMainKeyboard());
      return;
    }
    const selected = await submitLegacySelectVoice(session.userId, voice.modelId, voice.id);
    if (!selected.ok) {
      await sendTrackedMessage(chatId, `❌ Failed to set default voice: ${selected.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:voice:model:${voice.modelId}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, `✅ Default voice set to "${voice.name}".`, {
      inline_keyboard: [[{ text: "⬅️ Back to voice studio", callback_data: `legacy:voice:model:${voice.modelId}` }]],
    });
    return;
  }

  if (data.startsWith("legacy:voice:audio:start:")) {
    const voiceId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const voice = await prisma.modelVoice.findFirst({
      where: { id: voiceId, userId: session.userId },
      select: { id: true, modelId: true, name: true },
    });
    if (!voice) {
      await sendTrackedMessage(chatId, "Voice not found.", legacyMainKeyboard());
      return;
    }
    setFlow(chatId, { step: "await_voice_audio_script", voiceId: voice.id, modelId: voice.modelId });
    await sendTrackedMessage(chatId, `Send script text for voice "${voice.name}":`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("legacy:voice:clone:start:")) {
    const modelId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId: session.userId },
      select: { id: true, name: true },
    });
    if (!model) {
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return;
    }
    setFlow(chatId, { step: "await_voice_clone_audio", modelId: model.id });
    await sendTrackedMessage(chatId, `Upload an MP3 to clone voice for "${model.name}".`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("legacy:voice:delete:confirm:")) {
    const voiceId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const voice = await prisma.modelVoice.findFirst({
      where: { id: voiceId, userId: session.userId },
      select: { id: true, name: true, modelId: true, isDefault: true },
    });
    if (!voice) {
      await sendTrackedMessage(chatId, "Voice not found.", legacyMainKeyboard());
      return;
    }
    if (voice.isDefault) {
      await sendTrackedMessage(chatId, "Default voice cannot be deleted here. Set another default first.", {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:voice:model:${voice.modelId}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, `Delete voice "${voice.name}"?`, {
      inline_keyboard: [
        [{ text: "🗑 Yes, delete", callback_data: `legacy:voice:delete:run:${voice.id}` }],
        [{ text: "Cancel", callback_data: `legacy:voice:model:${voice.modelId}` }],
      ],
    });
    return;
  }

  if (data.startsWith("legacy:voice:delete:run:")) {
    const voiceId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const voice = await prisma.modelVoice.findFirst({
      where: { id: voiceId, userId: session.userId },
      select: { id: true, name: true, modelId: true },
    });
    if (!voice) {
      await sendTrackedMessage(chatId, "Voice not found.", legacyMainKeyboard());
      return;
    }
    const removed = await submitLegacyDeleteVoice(session.userId, voice.modelId, voice.id);
    if (!removed.ok) {
      await sendTrackedMessage(chatId, `❌ Delete voice failed: ${removed.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:voice:model:${voice.modelId}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, `✅ Voice "${voice.name}" deleted.`, {
      inline_keyboard: [[{ text: "⬅️ Back to voice studio", callback_data: `legacy:voice:model:${voice.modelId}` }]],
    });
    return;
  }

  if (data.startsWith("legacy:billing:buy:")) {
    const amount = Number.parseInt(data.split(":").pop() || "0", 10);
    const allowed = new Set([250, 500, 1000]);
    if (!allowed.has(amount)) {
      await sendTrackedMessage(chatId, "Invalid credit pack.", legacyMainKeyboard());
      return;
    }
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const checkout = await submitLegacyCreateCreditsCheckout(session.userId, amount);
    if (!checkout.ok) {
      await sendTrackedMessage(chatId, `❌ Checkout failed: ${checkout.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "legacy:pricing" }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, `✅ Credit checkout ready for ${amount} credits.`, {
      inline_keyboard: [
        [{ text: "💳 Open checkout", url: checkout.url }],
        [{ text: "⬅️ Back to billing", callback_data: "legacy:pricing" }],
      ],
    });
    return;
  }

  if (data.startsWith("legacy:billing:sub:")) {
    const [, , , tier, cycle = "monthly"] = data.split(":");
    const tierId = String(tier || "").toLowerCase();
    const billingCycle = String(cycle || "monthly").toLowerCase();
    const validTier = new Set(["starter", "pro", "business"]);
    const validCycle = new Set(["monthly", "annual"]);
    if (!validTier.has(tierId) || !validCycle.has(billingCycle)) {
      await sendTrackedMessage(chatId, "Invalid subscription option.", legacyMainKeyboard());
      return;
    }
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const checkout = await submitLegacyCreateSubscriptionCheckout(session.userId, tierId, billingCycle);
    if (!checkout.ok) {
      await sendTrackedMessage(chatId, `❌ Subscription checkout failed: ${checkout.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "legacy:pricing" }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, `✅ ${tierId} (${billingCycle}) checkout ready.`, {
      inline_keyboard: [
        [{ text: "💳 Open subscription checkout", url: checkout.url }],
        [{ text: "⬅️ Back to billing", callback_data: "legacy:pricing" }],
      ],
    });
    return;
  }

  if (data === "legacy:billing:portal") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const portal = await submitLegacyCreateBillingPortal(session.userId);
    if (!portal.ok) {
      await sendTrackedMessage(chatId, `❌ Billing portal failed: ${portal.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "legacy:pricing" }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, "🧾 Billing portal ready.", {
      inline_keyboard: [
        [{ text: "Open billing portal", url: portal.url }],
        [{ text: "⬅️ Back to billing", callback_data: "legacy:pricing" }],
      ],
    });
    return;
  }

  if (data === "legacy:billing:cancel:confirm") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await sendTrackedMessage(chatId, "Cancel your active subscription at period end?", {
      inline_keyboard: [
        [{ text: "🛑 Yes, cancel subscription", callback_data: "legacy:billing:cancel:run" }],
        [{ text: "⬅️ Back", callback_data: "legacy:pricing" }],
      ],
    });
    return;
  }

  if (data === "legacy:billing:cancel:run") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const cancelled = await submitLegacyCancelSubscription(session.userId);
    if (!cancelled.ok) {
      await sendTrackedMessage(chatId, `❌ Cancel failed: ${cancelled.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "legacy:pricing" }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, `✅ ${cancelled.message}`, {
      inline_keyboard: [[{ text: "⬅️ Back to billing", callback_data: "legacy:pricing" }]],
    });
    return;
  }

  if (data.startsWith("legacy:avatars:model:")) {
    const modelId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderAvatarStatus(chatId, session.userId, modelId);
    return;
  }

  if (data.startsWith("legacy:avatar:create:start:")) {
    const modelId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const model = await prisma.savedModel.findFirst({
      where: { id: modelId, userId: session.userId },
      select: { id: true, name: true },
    });
    if (!model) {
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return;
    }
    setFlow(chatId, { step: "await_avatar_create_name", modelId: model.id });
    await sendTrackedMessage(chatId, `Send new avatar name for model "${model.name}":`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("legacy:avatar:delete:confirm:")) {
    const [, , , , avatarId, modelId = ""] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const avatar = await prisma.avatar.findFirst({
      where: { id: avatarId, userId: session.userId },
      select: { id: true, name: true, modelId: true, status: true },
    });
    if (!avatar) {
      await sendTrackedMessage(chatId, "Avatar not found.", legacyMainKeyboard());
      return;
    }
    await sendTrackedMessage(chatId, `Delete avatar "${avatar.name}" (${avatar.status})?`, {
      inline_keyboard: [
        [{ text: "🗑 Yes, delete", callback_data: `lg:avdr:${avatar.id}` }],
        [{ text: "Cancel", callback_data: `legacy:avatars:model:${modelId || avatar.modelId}` }],
      ],
    });
    return;
  }

  if (data.startsWith("legacy:avatar:delete:run:")) {
    const [, , , , avatarId, modelId = ""] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const deleted = await submitLegacyDeleteAvatar(session.userId, avatarId);
    if (!deleted.ok) {
      await sendTrackedMessage(chatId, `❌ Avatar delete failed: ${deleted.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:avatars:model:${modelId}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, "✅ Avatar deleted.", {
      inline_keyboard: [[{ text: "⬅️ Back to avatars", callback_data: `legacy:avatars:model:${modelId}` }]],
    });
    return;
  }

  if (data.startsWith("legacy:avatar:gen:start:")) {
    const avatarId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const avatar = await prisma.avatar.findFirst({
      where: { id: avatarId, userId: session.userId },
      select: { id: true, name: true, status: true, modelId: true },
    });
    if (!avatar) {
      await sendTrackedMessage(chatId, "Avatar not found.", legacyMainKeyboard());
      return;
    }
    if (String(avatar.status || "").toLowerCase() !== "ready") {
      await sendTrackedMessage(chatId, `Avatar "${avatar.name}" is ${avatar.status}. Wait until ready.`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:avatars:model:${avatar.modelId}` }]],
      });
      return;
    }
    setFlow(chatId, {
      step: "await_avatar_script",
      avatarId: avatar.id,
      modelId: avatar.modelId,
    });
    await sendTrackedMessage(chatId, `Send script text for avatar "${avatar.name}":`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data === "legacy:settings") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderSettingsSummary(chatId, session.userId);
    return;
  }

  if (data === "legacy:settings:name") {
    setFlow(chatId, { step: "await_settings_name" });
    await sendTrackedMessage(chatId, "Send your new display name:", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data === "legacy:queue" || data === "legacy:queue:refresh") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderLegacyQueue(chatId, session.userId);
    return;
  }

  if (data === "legacy:tools") {
    await renderLegacyToolsMenu(chatId);
    return;
  }

  if (data === "legacy:tools:reformatter:start") {
    await handleLegacyAction(chatId, "reformatter");
    return;
  }

  if (data === "legacy:tools:upscaler:start") {
    await handleLegacyAction(chatId, "upscaler");
    return;
  }

  if (data === "legacy:tools:repurposer:start") {
    await handleLegacyAction(chatId, "repurposer");
    return;
  }

  if (data.startsWith("legacy:reformatter:status:")) {
    const jobId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderLegacyReformatterStatusCard(chatId, session.userId, jobId);
    return;
  }

  if (data.startsWith("legacy:upscale:status:")) {
    const generationId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderLegacyUpscaleStatusCard(chatId, session.userId, generationId);
    return;
  }

  if (data.startsWith("legacy:repurposer:status:")) {
    const jobId = data.split(":").pop();
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderLegacyRepurposerStatusCard(chatId, session.userId, jobId);
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

  if (data.startsWith("legacy:model:photos:")) {
    const [, , , modelId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderModelPhotos(chatId, session.userId, modelId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:model:photo:view:")) {
    const [, , , , modelId, page = "0", slot = "1"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderModelPhotoPanel(chatId, session.userId, modelId, Number(page) || 0, Number(slot) || 1);
    return;
  }

  if (data.startsWith("legacy:model:edit:menu:")) {
    const [, , , , modelId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderModelEditMenu(chatId, session.userId, modelId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:model:photo:swap:start:")) {
    const [, , , , , modelId, page = "0", slot = "photo1"] = data.split(":");
    setFlow(chatId, {
      step: "await_model_photo_swap_url",
      modelId,
      photoSlot: slot,
      page: Number(page) || 0,
    });
    await sendTrackedMessage(chatId, `Send the new URL for ${slot} or upload a new photo (then you'll confirm save):`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data === "legacy:model:photo:swap:save") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const flow = getFlow(chatId);
    if (!flow || flow.step !== "await_model_photo_swap_confirm") {
      await sendTrackedMessage(chatId, "No pending photo swap found.", legacyMainKeyboard());
      return;
    }
    const model = await prisma.savedModel.findFirst({
      where: { id: flow.modelId, userId: session.userId },
      select: {
        id: true,
        isAIGenerated: true,
        nsfwOverride: true,
        nsfwUnlocked: true,
        looksUnlockedByAdmin: true,
      },
    });
    if (!model) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Model not found.", legacyMainKeyboard());
      return;
    }
    const photosLocked =
      (model.isAIGenerated || model.nsfwOverride || model.nsfwUnlocked) &&
      !model.looksUnlockedByAdmin;
    if (photosLocked) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Photos are locked for this model and cannot be edited here.", legacyMainKeyboard());
      return;
    }
    const slot = flow.photoSlot;
    if (!["photo1", "photo2", "photo3"].includes(slot) || !isHttpUrl(flow.pendingUrl)) {
      clearFlow(chatId);
      await sendTrackedMessage(chatId, "Invalid pending photo update.", legacyMainKeyboard());
      return;
    }
    const data = { [`${slot}Url`]: flow.pendingUrl };
    if (slot === "photo1") data.thumbnail = flow.pendingUrl;
    await prisma.savedModel.updateMany({
      where: { id: flow.modelId, userId: session.userId },
      data,
    });
    const page = Number(flow.page) || 0;
    const modelId = flow.modelId;
    clearFlow(chatId);
    await sendTrackedMessage(chatId, `✅ Updated ${slot} successfully.`, {
      inline_keyboard: [[{ text: "⬅️ Back to photo panel", callback_data: `lg:mpv:${modelId}:${page}:1` }]],
    });
    return;
  }

  if (data === "legacy:model:photo:swap:cancel") {
    const flow = getFlow(chatId);
    const modelId = flow?.modelId;
    const page = Number(flow?.page) || 0;
    clearFlow(chatId);
    if (modelId) {
      await sendTrackedMessage(chatId, "Photo swap cancelled.", {
        inline_keyboard: [[{ text: "⬅️ Back to photo panel", callback_data: `lg:mpv:${modelId}:${page}:1` }]],
      });
    } else {
      await sendTrackedMessage(chatId, "Cancelled.", legacyMainKeyboard());
    }
    return;
  }

  if (data.startsWith("legacy:model:edit:age:")) {
    const [, , , , modelId, page = "0"] = data.split(":");
    setFlow(chatId, {
      step: "await_model_age",
      modelId,
      page: Number(page) || 0,
    });
    await sendTrackedMessage(chatId, "Send the new age (1-85):", {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("legacy:model:looks:menu:")) {
    const [, , , , modelId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderLooksEditor(chatId, session.userId, modelId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:model:looks:field:")) {
    const [, , , , modelId, page = "0", field = "style"] = data.split(":");
    setFlow(chatId, {
      step: "await_model_look_value",
      modelId,
      page: Number(page) || 0,
      lookField: field,
    });
    await sendTrackedMessage(chatId, `Send new value for "${field}":`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data === "legacy:create_model") {
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    setFlow(chatId, { step: "await_create_model_name" });
    await sendTrackedMessage(chatId, "Send the model name:", {
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

  if (data.startsWith("legacy:generation:refresh:")) {
    const [, , , generationId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderGenerationStatusCard(chatId, session.userId, generationId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:generation:retry:")) {
    const [, , , generationId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await retryLegacyPromptGeneration(chatId, session.userId, generationId, Number(page) || 0);
    return;
  }

  if (data.startsWith("legacy:generation:delete:confirm:")) {
    const [, , , , generationId, page = "0"] = data.split(":");
    await sendTrackedMessage(chatId, "Delete this generation from history?", {
      inline_keyboard: [
        [{ text: "🗑 Yes, delete", callback_data: `lg:gdr:${generationId}:${page}` }],
        [{ text: "Cancel", callback_data: `legacy:history:item:${generationId}:${page}` }],
      ],
    });
    return;
  }

  if (data.startsWith("legacy:generation:delete:run:")) {
    const [, , , , generationId, page = "0"] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const deleted = await submitLegacyDeleteGeneration(session.userId, generationId);
    if (!deleted.ok) {
      await sendTrackedMessage(chatId, `❌ Delete failed: ${deleted.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:history:item:${generationId}:${page}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, "✅ Generation deleted.", {
      inline_keyboard: [[{ text: "🕘 Back to history", callback_data: `legacy:history:page:${Number(page) || 0}` }]],
    });
    return;
  }

  if (data.startsWith("legacy:avatar:video:refresh:")) {
    const [, , , , videoId, modelId = ""] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderAvatarVideoStatusCard(chatId, session.userId, videoId, modelId);
    return;
  }

  if (data.startsWith("legacy:avatar:video:retry:")) {
    const [, , , , videoId, modelId = ""] = data.split(":");
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await retryLegacyAvatarVideo(chatId, session.userId, videoId, modelId);
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
    setFlow(chatId, {
      step: "await_generate_duration",
      modelId: model.id,
      modelName: model.name,
      prompt: String(flow.prompt || "").slice(0, 2000),
    });
    await sendTrackedMessage(chatId, `Choose video duration for model "${model.name}":`, {
      inline_keyboard: [
        [
          { text: "5s", callback_data: "legacy:generate:duration:5" },
          { text: "10s", callback_data: "legacy:generate:duration:10" },
        ],
        [{ text: "Cancel", callback_data: "legacy:home" }],
      ],
    });
    return;
  }

  if (data.startsWith("legacy:generate:duration:")) {
    const duration = Number(data.split(":").pop());
    const flow = getFlow(chatId);
    if (!flow || flow.step !== "await_generate_duration") {
      await sendTrackedMessage(chatId, "No pending generation draft found. Use /generate first.", legacyMainKeyboard());
      return;
    }
    if (![5, 10].includes(duration)) {
      await sendTrackedMessage(chatId, "Invalid duration.", legacyMainKeyboard());
      return;
    }
    setFlow(chatId, {
      step: "await_generate_source_image",
      modelId: flow.modelId,
      modelName: flow.modelName,
      prompt: flow.prompt,
      duration,
    });
    await sendTrackedMessage(
      chatId,
      `Duration set to ${duration}s.\nNow send source image URL or upload image for prompt:\n"${String(flow.prompt || "").slice(0, 220)}"`,
      {
        keyboard: [["Cancel"]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    );
    return;
  }

  // ── Short-form callback handlers (64-byte limit compliance) ──────────────

  if (data.startsWith("lg:mpv:")) {
    // lg:mpv:${modelId}:${page}:${slot}
    const parts = data.split(":");
    const modelId = parts[2];
    const page = Number(parts[3]) || 0;
    const slot = Number(parts[4]) || 1;
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderModelPhotoPanel(chatId, session.userId, modelId, page, slot);
    return;
  }

  if (data.startsWith("lg:mps:")) {
    // lg:mps:${modelId}:${page}:${slotKey}  e.g. lg:mps:{id}:0:photo1
    const parts = data.split(":");
    const modelId = parts[2];
    const page = Number(parts[3]) || 0;
    const slotKey = parts[4] || "photo1";
    setFlow(chatId, {
      step: "await_model_photo_swap_url",
      modelId,
      photoSlot: slotKey,
      page,
    });
    await sendTrackedMessage(chatId, `Send the new URL for ${slotKey} or upload a new photo (then you'll confirm save):`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("lg:mdc:")) {
    // lg:mdc:${modelId}:${page}
    const parts = data.split(":");
    const modelId = parts[2];
    const page = parts[3] || "0";
    await sendTrackedMessage(chatId, "Confirm model deletion:", {
      inline_keyboard: [
        [{ text: "Yes, delete", callback_data: `legacy:model:delete:run:${modelId}:${page}` }],
        [{ text: "Cancel", callback_data: `legacy:model:open:${modelId}:${page}` }],
      ],
    });
    return;
  }

  if (data.startsWith("lg:mlf:")) {
    // lg:mlf:${modelId}:${page}:${field}
    const parts = data.split(":");
    const modelId = parts[2];
    const page = Number(parts[3]) || 0;
    const field = parts[4] || "style";
    setFlow(chatId, {
      step: "await_model_look_value",
      modelId,
      page,
      lookField: field,
    });
    await sendTrackedMessage(chatId, `Send new value for "${field}":`, {
      keyboard: [["Cancel"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    return;
  }

  if (data.startsWith("lg:avdc:")) {
    // lg:avdc:${avatarId}  (modelId looked up from DB)
    const avatarId = data.split(":")[2];
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const avatar = await prisma.avatar.findFirst({
      where: { id: avatarId, userId: session.userId },
      select: { id: true, name: true, modelId: true, status: true },
    });
    if (!avatar) {
      await sendTrackedMessage(chatId, "Avatar not found.", legacyMainKeyboard());
      return;
    }
    await sendTrackedMessage(chatId, `Delete avatar "${avatar.name}" (${avatar.status})?`, {
      inline_keyboard: [
        [{ text: "🗑 Yes, delete", callback_data: `lg:avdr:${avatar.id}` }],
        [{ text: "Cancel", callback_data: `legacy:avatars:model:${avatar.modelId}` }],
      ],
    });
    return;
  }

  if (data.startsWith("lg:avdr:")) {
    // lg:avdr:${avatarId}
    const avatarId = data.split(":")[2];
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const avatar = await prisma.avatar.findFirst({
      where: { id: avatarId, userId: session.userId },
      select: { id: true, name: true, modelId: true },
    });
    if (!avatar) {
      await sendTrackedMessage(chatId, "Avatar not found.", legacyMainKeyboard());
      return;
    }
    const deleted = await submitLegacyDeleteAvatar(session.userId, avatarId);
    if (!deleted.ok) {
      await sendTrackedMessage(chatId, `❌ Avatar delete failed: ${deleted.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:avatars:model:${avatar.modelId}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, "✅ Avatar deleted.", {
      inline_keyboard: [[{ text: "⬅️ Back to avatars", callback_data: `legacy:avatars:model:${avatar.modelId}` }]],
    });
    return;
  }

  if (data.startsWith("lg:avvr:")) {
    // lg:avvr:${videoId}  (modelId looked up from DB)
    const videoId = data.split(":")[2];
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderAvatarVideoStatusCard(chatId, session.userId, videoId, "");
    return;
  }

  if (data.startsWith("lg:avvry:")) {
    // lg:avvry:${videoId}
    const videoId = data.split(":")[2];
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await retryLegacyAvatarVideo(chatId, session.userId, videoId, "");
    return;
  }

  if (data.startsWith("lg:gr:")) {
    // lg:gr:${genId}:${page}
    const parts = data.split(":");
    const genId = parts[2];
    const page = Number(parts[3]) || 0;
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    await renderGenerationStatusCard(chatId, session.userId, genId, page);
    return;
  }

  if (data.startsWith("lg:gdc:")) {
    // lg:gdc:${genId}:${page}
    const parts = data.split(":");
    const genId = parts[2];
    const page = parts[3] || "0";
    await sendTrackedMessage(chatId, "Delete this generation from history?", {
      inline_keyboard: [
        [{ text: "🗑 Yes, delete", callback_data: `lg:gdr:${genId}:${page}` }],
        [{ text: "Cancel", callback_data: `legacy:history:item:${genId}:${page}` }],
      ],
    });
    return;
  }

  if (data.startsWith("lg:gdr:")) {
    // lg:gdr:${genId}:${page}
    const parts = data.split(":");
    const genId = parts[2];
    const page = Number(parts[3]) || 0;
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const deleted = await submitLegacyDeleteGeneration(session.userId, genId);
    if (!deleted.ok) {
      await sendTrackedMessage(chatId, `❌ Delete failed: ${deleted.message}`, {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:history:item:${genId}:${page}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, "✅ Generation deleted.", {
      inline_keyboard: [[{ text: "🕘 Back to history", callback_data: `legacy:history:page:${page}` }]],
    });
    return;
  }

  if (data.startsWith("lg:vdc:")) {
    // lg:vdc:${voiceId}
    const voiceId = data.split(":")[2];
    const session = await ensureLegacyAuth(chatId);
    if (!session) return;
    const voice = await prisma.modelVoice.findFirst({
      where: { id: voiceId, userId: session.userId },
      select: { id: true, name: true, modelId: true, isDefault: true },
    });
    if (!voice) {
      await sendTrackedMessage(chatId, "Voice not found.", legacyMainKeyboard());
      return;
    }
    if (voice.isDefault) {
      await sendTrackedMessage(chatId, "Default voice cannot be deleted here. Set another default first.", {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: `legacy:voice:model:${voice.modelId}` }]],
      });
      return;
    }
    await sendTrackedMessage(chatId, `Delete voice "${voice.name}"?`, {
      inline_keyboard: [
        [{ text: "🗑 Yes, delete", callback_data: `legacy:voice:delete:run:${voice.id}` }],
        [{ text: "Cancel", callback_data: `legacy:voice:model:${voice.modelId}` }],
      ],
    });
    return;
  }

  // ── End short-form handlers ───────────────────────────────────────────────

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
    if (getChatMode(chatId) === MODE_LEGACY) {
      await handleLegacyAction(chatId, "pricing", telegramUserId);
      return;
    }
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

    if (message?.chat?.id) {
      await hydrateLegacyState(message.chat.id);
      const text = String(message?.text || "");
      const hasText = Boolean(text.trim());
      const command = hasText ? toCommand(text) : "";
      const currentMode = getChatMode(message.chat.id);
      const hasLegacyFlow = Boolean(getFlow(message.chat.id));
      const hasLegacySession = Boolean(getSession(message.chat.id));
      const isPlainText = hasText ? !text.trim().startsWith("/") : true;
      if (isPlainText) {
        const handledLegacyMessage = await handleLegacyPlainMessage(message);
        if (handledLegacyMessage) {
          return res.json({ ok: true });
        }
        if (hasText) {
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
        }
      } else if (hasText) {
        await handleCommand(
          message.chat.id,
          command,
          message?.from?.first_name || "",
          message?.from?.id || null,
        );
      }
    }

    if (callbackQuery) {
      await hydrateLegacyState(callbackQuery?.message?.chat?.id);
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
