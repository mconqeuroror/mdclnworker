/**
 * Adapter for `rate-limit-redis` + ioredis (Upstash / Vercel Redis TCP URL, same as mirror cache).
 * REST-only KV (KV_REST_*) is not used here: when no TCP URL exists, return null and limits stay in-process.
 */
import { getSharedIoredis } from "./mirrorRedisCache.js";

/**
 * @returns {import("ioredis").default | null}
 */
export function getSharedUpstashRedis() {
  return getSharedIoredis();
}

/**
 * @param {import("ioredis").default | null} redis
 * @returns {(...args: (string|Buffer)[]) => Promise<unknown>}
 */
export function createUpstashRateLimitSendCommand(redis) {
  return function sendCommand(...args) {
    if (!redis) {
      return Promise.reject(new Error("Redis client is not configured"));
    }
    if (args.length === 0) {
      return Promise.reject(new Error("empty Redis command"));
    }
    const command = String(args[0]);
    const rest = args.slice(1).map((a) => (Buffer.isBuffer(a) ? a : String(a)));
    return redis.call(command, ...rest);
  };
}
