/**
 * Optional shared mirror cache + cross-instance lock.
 * Vercel Marketplace Redis injects REDIS_URL; Upstash may use UPSTASH_REDIS_URL or split REDIS_* vars.
 * When no URL resolves, kieUpload falls back to in-memory maps only.
 */
import crypto from "crypto";
import Redis from "ioredis";

const PREFIX = "mdcln:mirror:v1:";
const LOCK_TTL_SEC = 420;
const DEFAULT_WAIT_MS = 380_000;
const DEFAULT_POLL_MS = 300;

function hashKey(purpose, sourceUrl) {
  return crypto.createHash("sha256").update(`${purpose}\0${sourceUrl}`, "utf8").digest("hex");
}

function dataKey(purpose, sourceUrl) {
  return `${PREFIX}d:${hashKey(purpose, sourceUrl)}`;
}

function lockKey(purpose, sourceUrl) {
  return `${PREFIX}l:${hashKey(purpose, sourceUrl)}`;
}

/**
 * Resolve connection string for Vercel Redis / Upstash / self-hosted.
 * @returns {string|null}
 */
export function resolveMirrorRedisUrl() {
  const tryTrim = (v) => (typeof v === "string" ? v.trim() : "");
  const direct = tryTrim(process.env.REDIS_URL);
  if (direct) return direct;
  const upstashTcp = tryTrim(process.env.UPSTASH_REDIS_URL);
  if (upstashTcp) return upstashTcp;
  const kv = tryTrim(process.env.KV_URL);
  if (kv) return kv;

  const host = tryTrim(process.env.REDIS_HOST);
  const port = tryTrim(process.env.REDIS_PORT) || "6379";
  const user = tryTrim(process.env.REDIS_USER) || "default";
  const pass = tryTrim(process.env.REDIS_PASSWORD);
  if (host && pass) {
    const enc = encodeURIComponent(pass);
    const tlsOff = tryTrim(process.env.REDIS_TLS) === "0";
    const scheme = tlsOff ? "redis" : "rediss";
    return `${scheme}://${user}:${enc}@${host}:${port}`;
  }
  return null;
}

let client = null;
let warnedMissing = false;
let cachedUrl = null;

export function isMirrorRedisConfigured() {
  return Boolean(resolveMirrorRedisUrl());
}

function getClient() {
  const url = resolveMirrorRedisUrl();
  if (!url) return null;
  if (client && cachedUrl === url) return client;
  if (client) {
    try {
      client.disconnect();
    } catch (_) {}
    client = null;
  }
  cachedUrl = url;
  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 12_000,
      lazyConnect: true,
      enableReadyCheck: true,
    });
    client.on("error", (err) => {
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn("[mirrorRedis] connection error (further errors suppressed in logs):", err?.message);
      }
    });
  } catch (e) {
    console.warn("[mirrorRedis] failed to create client:", e?.message);
    return null;
  }
  return client;
}

async function ensureConnected(r) {
  if (r.status === "wait" || r.status === "end") {
    await r.connect().catch(() => {});
  }
}

/**
 * @param {string} purpose
 * @param {string} sourceUrl
 * @returns {Promise<string|null>}
 */
export async function mirrorRedisGet(purpose, sourceUrl) {
  const r = getClient();
  if (!r) return null;
  try {
    await ensureConnected(r);
    const v = await r.get(dataKey(purpose, sourceUrl));
    return v && typeof v === "string" ? v : null;
  } catch (e) {
    console.warn("[mirrorRedis] GET failed:", e?.message);
    return null;
  }
}

/**
 * @param {string} purpose
 * @param {string} sourceUrl
 * @param {string} blobUrl
 * @param {number} ttlSec
 */
export async function mirrorRedisSet(purpose, sourceUrl, blobUrl, ttlSec) {
  const r = getClient();
  if (!r || !blobUrl) return;
  try {
    await ensureConnected(r);
    const sec = Math.max(1, Math.min(Math.ceil(ttlSec), 86400 * 7));
    await r.set(dataKey(purpose, sourceUrl), blobUrl, "EX", sec);
  } catch (e) {
    console.warn("[mirrorRedis] SET failed:", e?.message);
  }
}

/**
 * @param {string} purpose
 * @param {string} sourceUrl
 */
export async function mirrorRedisForget(purpose, sourceUrl) {
  const r = getClient();
  if (!r) return;
  try {
    await ensureConnected(r);
    await r.del(dataKey(purpose, sourceUrl));
  } catch (_) {}
}

/**
 * Try to own the mirror lock, or wait until another instance populates the cache.
 * @returns {Promise<{ fromCache: boolean, url?: string, acquired: boolean }>}
 */
export async function mirrorRedisAcquireOrWait(purpose, sourceUrl, options = {}) {
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  const r = getClient();
  if (!r) {
    return { fromCache: false, acquired: true };
  }

  try {
    await ensureConnected(r);
    const dk = dataKey(purpose, sourceUrl);
    const lk = lockKey(purpose, sourceUrl);

    let v = await r.get(dk);
    if (v) return { fromCache: true, url: v, acquired: false };

    const ok = await r.set(lk, "1", "EX", LOCK_TTL_SEC, "NX");
    if (ok === "OK") {
      return { fromCache: false, acquired: true };
    }

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, pollMs));
      v = await r.get(dk);
      if (v) return { fromCache: true, url: v, acquired: false };
      const ok2 = await r.set(lk, "1", "EX", LOCK_TTL_SEC, "NX");
      if (ok2 === "OK") {
        return { fromCache: false, acquired: true };
      }
    }

    return { fromCache: false, acquired: false };
  } catch (e) {
    console.warn("[mirrorRedis] lock/wait failed:", e?.message);
    return { fromCache: false, acquired: true };
  }
}

/**
 * @param {string} purpose
 * @param {string} sourceUrl
 */
export async function mirrorRedisReleaseLock(purpose, sourceUrl) {
  const r = getClient();
  if (!r) return;
  try {
    await ensureConnected(r);
    await r.del(lockKey(purpose, sourceUrl));
  } catch (_) {}
}
