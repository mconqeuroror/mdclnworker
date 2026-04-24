import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import {
  createUpstashRateLimitSendCommand,
  getSharedUpstashRedis,
} from "../lib/upstashRateLimitBridge.js";

const isDev = process.env.NODE_ENV === "development";

const userOrIpKey = (req) => {
  return req.user?.userId ? `user:${req.user.userId}` : req.ip;
};

/**
 * When UPSTASH_REDIS_REST_URL + TOKEN (or Vercel KV_REST_*) are set, per-user and
 * global limits are shared across all API instances.
 */
function makeRedisStore(prefix) {
  const redis = getSharedUpstashRedis();
  if (!redis) return undefined;
  return new RedisStore({
    sendCommand: createUpstashRateLimitSendCommand(redis),
    prefix,
  });
}

const storeGen = makeRedisStore("mcl:rl:gen:");
const storeModels = makeRedisStore("mcl:rl:models:");
const storeGenerationsList = makeRedisStore("mcl:rl:gens:");
const storeVoicePrev = makeRedisStore("mcl:rl:voicepv:");
const storeDownload = makeRedisStore("mcl:rl:dl:");
const storeApi = makeRedisStore("mcl:rl:api:");

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 5,
  message: {
    success: false,
    message:
      "Too many authentication attempts. Please try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 120,
  message: {
    success: false,
    message: "Too many session refresh attempts. Please wait a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 5,
  message: {
    success: false,
    message: "Too many accounts created. Please try again in 1 hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 3,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again in 1 hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const generationLimitMax = Math.max(10, parseInt(process.env.GENERATION_RATE_LIMIT_MAX || "60", 10));
export const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : generationLimitMax,
  message: {
    success: false,
    message: "Too many generation requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
  store: storeGen,
  passOnStoreError: Boolean(storeGen),
});

export const modelsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    message: "Too many model requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
  store: storeModels,
  passOnStoreError: Boolean(storeModels),
});

export const voiceDesignPreviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 1000 : 20,
  message: {
    success: false,
    message: "Too many voice preview requests. Try again in an hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
  store: storeVoicePrev,
  passOnStoreError: Boolean(storeVoicePrev),
});

export const generationsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: "Too many generation history requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
  store: storeGenerationsList,
  passOnStoreError: Boolean(storeGenerationsList),
});

/** Global /api bucket (runs before route auth → keyed by client IP). */
const API_WINDOW_MS = Math.max(
  60_000,
  parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
);
const API_MAX = Math.max(100, parseInt(process.env.API_RATE_LIMIT_MAX || "2000", 10));

export const apiLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: isDev ? 100_000 : API_MAX,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "0.0.0.0"),
  validate: { xForwardedForHeader: false },
  store: storeApi,
  passOnStoreError: Boolean(storeApi),
});

export const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 300 : 60,
  message: {
    success: false,
    error: "Too many download requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: userOrIpKey,
  store: storeDownload,
  passOnStoreError: Boolean(storeDownload),
});
