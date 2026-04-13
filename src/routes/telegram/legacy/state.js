import prisma from "../../../lib/prisma.js";
import { MODE_MINI, MODE_LEGACY, FLOW_TTL_MS, STATE_MAX_AGE_MS } from "./config.js";

const sessionMap  = new Map();  // chatId → { userId, email }
const flowMap     = new Map();  // chatId → { step, ...data, _ts }
const modeMap     = new Map();  // chatId → "mini" | "legacy"
const msgTrack    = new Map();  // chatId → number[] (last bot message IDs)
const hydrated    = new Set();  // chatIds hydrated this process lifetime
const persistTimers = new Map();

// ── Mode ──────────────────────────────────────────────────────
export function getMode(chatId) {
  return modeMap.get(String(chatId)) || MODE_MINI;
}
export function setMode(chatId, mode) {
  modeMap.set(String(chatId), mode === MODE_LEGACY ? MODE_LEGACY : MODE_MINI);
  schedulePersist(chatId);
}

// ── Session ───────────────────────────────────────────────────
export function getSession(chatId) {
  return sessionMap.get(String(chatId)) || null;
}
export function setSession(chatId, session) {
  sessionMap.set(String(chatId), session);
  schedulePersist(chatId);
}
export function clearSession(chatId) {
  sessionMap.delete(String(chatId));
  schedulePersist(chatId);
}

// ── Flow ──────────────────────────────────────────────────────
export function getFlow(chatId) {
  const flow = flowMap.get(String(chatId));
  if (!flow) return null;
  const ts = flow._ts ? new Date(flow._ts).getTime() : 0;
  if (ts && Date.now() - ts > FLOW_TTL_MS) {
    flowMap.delete(String(chatId));
    return null;
  }
  return flow;
}
export function setFlow(chatId, data) {
  flowMap.set(String(chatId), { ...data, _ts: new Date().toISOString() });
  schedulePersist(chatId);
}
export function clearFlow(chatId) {
  flowMap.delete(String(chatId));
  schedulePersist(chatId);
}

// ── Message tracking ──────────────────────────────────────────
export function trackBotMessage(chatId, msgId) {
  const key = String(chatId);
  const ids = (msgTrack.get(key) || []).concat(Number(msgId)).slice(-20);
  msgTrack.set(key, ids);
  schedulePersist(chatId);
}
export function getTrackedMessages(chatId) {
  return msgTrack.get(String(chatId)) || [];
}

// ── DB persistence ────────────────────────────────────────────
function schedulePersist(chatId) {
  const key = String(chatId);
  const existing = persistTimers.get(key);
  if (existing) clearTimeout(existing);
  persistTimers.set(key, setTimeout(() => {
    persistTimers.delete(key);
    persistNow(key).catch(() => {});
  }, 25));
}

export async function persistNow(chatId) {
  const key = String(chatId);
  if (!prisma.telegramLegacyState) return;
  const session = sessionMap.get(key) || null;
  const flow = flowMap.get(key) || null;
  const mode = modeMap.get(key) || MODE_MINI;
  const lastBotMessageIds = msgTrack.get(key) || [];
  const snapshot = {
    chatId: key,
    mode,
    sessionUserId: session?.userId ? String(session.userId) : null,
    sessionEmail: session?.email ? String(session.email).toLowerCase() : null,
    flow: flow || null,
    flowUpdatedAt: flow?._ts ? new Date(flow._ts) : null,
    lastBotMessageIds,
    expiresAt: new Date(Date.now() + STATE_MAX_AGE_MS),
  };
  try {
    await prisma.telegramLegacyState.upsert({
      where: { chatId: key },
      create: snapshot,
      update: snapshot,
    });
  } catch (e) {
    console.warn("[state] persist warning:", e?.message);
  }
}

export async function hydrateState(chatId) {
  const key = String(chatId);
  if (hydrated.has(key)) return;
  hydrated.add(key);
  if (!prisma.telegramLegacyState) return;
  try {
    const row = await prisma.telegramLegacyState.findUnique({ where: { chatId: key } });
    if (!row) return;
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return;
    const mode = row.mode === MODE_LEGACY ? MODE_LEGACY : MODE_MINI;
    modeMap.set(key, mode);
    if (row.sessionUserId) {
      sessionMap.set(key, { userId: row.sessionUserId, email: row.sessionEmail || null });
    }
    if (row.flow && typeof row.flow === "object" && !Array.isArray(row.flow)) {
      const ts = row.flowUpdatedAt ? new Date(row.flowUpdatedAt).toISOString() : new Date().toISOString();
      const flow = { ...row.flow, _ts: ts };
      const age = Date.now() - new Date(ts).getTime();
      if (age < FLOW_TTL_MS) flowMap.set(key, flow);
    }
    const ids = Array.isArray(row.lastBotMessageIds)
      ? row.lastBotMessageIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(-20)
      : [];
    if (ids.length) msgTrack.set(key, ids);
  } catch (e) {
    console.warn("[state] hydrate warning:", e?.message);
  }
}
