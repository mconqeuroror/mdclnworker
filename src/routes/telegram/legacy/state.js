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

// ── Raw SQL helpers (bypass Prisma client generation requirement) ─
// Using $queryRaw / $executeRaw so the table works even if
// `prisma generate` hasn't been re-run after schema changes.

async function dbUpsertState(key, sessionUserId, sessionEmail, mode, flow, flowUpdatedAt, lastBotMessageIds, expiresAt) {
  const flowJson = flow ? JSON.stringify(flow) : null;
  const idsJson = JSON.stringify(lastBotMessageIds || []);
  await prisma.$executeRaw`
    INSERT INTO "TelegramLegacyState"
      ("id", "chatId", "mode", "sessionUserId", "sessionEmail", "flow",
       "flowUpdatedAt", "lastBotMessageIds", "createdAt", "updatedAt", "expiresAt")
    VALUES
      (gen_random_uuid(), ${key}, ${mode}, ${sessionUserId}, ${sessionEmail},
       ${flowJson}::jsonb, ${flowUpdatedAt}, ${idsJson}::jsonb,
       NOW(), NOW(), ${expiresAt})
    ON CONFLICT ("chatId") DO UPDATE SET
      "mode"              = EXCLUDED."mode",
      "sessionUserId"     = EXCLUDED."sessionUserId",
      "sessionEmail"      = EXCLUDED."sessionEmail",
      "flow"              = EXCLUDED."flow",
      "flowUpdatedAt"     = EXCLUDED."flowUpdatedAt",
      "lastBotMessageIds" = EXCLUDED."lastBotMessageIds",
      "updatedAt"         = NOW(),
      "expiresAt"         = EXCLUDED."expiresAt"
  `;
}

async function dbLoadState(key) {
  const rows = await prisma.$queryRaw`
    SELECT "mode", "sessionUserId", "sessionEmail", "flow",
           "flowUpdatedAt", "lastBotMessageIds", "expiresAt"
    FROM   "TelegramLegacyState"
    WHERE  "chatId" = ${key}
    LIMIT  1
  `;
  return rows[0] || null;
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
  const session = sessionMap.get(key) || null;
  const flow    = flowMap.get(key) || null;
  const mode    = modeMap.get(key) || MODE_MINI;
  const ids     = msgTrack.get(key) || [];

  try {
    await dbUpsertState(
      key,
      session?.userId ? String(session.userId) : null,
      session?.email  ? String(session.email).toLowerCase() : null,
      mode,
      flow,
      flow?._ts ? new Date(flow._ts) : null,
      ids,
      new Date(Date.now() + STATE_MAX_AGE_MS),
    );
  } catch (e) {
    console.warn("[state] persist warning:", e?.message);
  }
}

export async function hydrateState(chatId) {
  const key = String(chatId);
  if (hydrated.has(key)) return;
  hydrated.add(key);
  try {
    const row = await dbLoadState(key);
    if (!row) return;
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return;
    const mode = row.mode === MODE_LEGACY ? MODE_LEGACY : MODE_MINI;
    modeMap.set(key, mode);
    if (row.sessionUserId) {
      sessionMap.set(key, { userId: String(row.sessionUserId), email: row.sessionEmail || null });
    }
    // flow may come back as object (Prisma JSONB) or string (raw driver)
    const rawFlow = typeof row.flow === "string" ? JSON.parse(row.flow) : row.flow;
    if (rawFlow && typeof rawFlow === "object" && !Array.isArray(rawFlow)) {
      const ts = row.flowUpdatedAt ? new Date(row.flowUpdatedAt).toISOString() : new Date().toISOString();
      const flowObj = { ...rawFlow, _ts: ts };
      if (Date.now() - new Date(ts).getTime() < FLOW_TTL_MS) {
        flowMap.set(key, flowObj);
      }
    }
    const rawIds = typeof row.lastBotMessageIds === "string"
      ? JSON.parse(row.lastBotMessageIds)
      : (row.lastBotMessageIds || []);
    const ids = Array.isArray(rawIds)
      ? rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(-20)
      : [];
    if (ids.length) msgTrack.set(key, ids);
  } catch (e) {
    console.warn("[state] hydrate warning:", e?.message);
  }
}

// ── Direct session load (used by ensureAuth cold-start fallback) ─
export async function loadSessionFromDB(chatId) {
  try {
    const row = await dbLoadState(String(chatId));
    if (!row?.sessionUserId) return null;
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return null;
    return { userId: String(row.sessionUserId), email: row.sessionEmail || null };
  } catch {
    return null;
  }
}
