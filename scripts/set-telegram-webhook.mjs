/**
 * Registers Telegram webhook from values in .env (no secrets pasted into shell).
 *
 * Uses:
 *   TELEGRAM_BOT_TOKEN        (required)
 *   TELEGRAM_MINI_APP_URL     (required) — https origin, no trailing slash; same as Mini App
 *   TELEGRAM_WEBHOOK_SECRET  (optional) — if set, sent as secret_token (must match server .env)
 *
 * Optional override for base only:
 *   TELEGRAM_WEBHOOK_BASE_URL — if set, used instead of TELEGRAM_MINI_APP_URL for webhook URL
 *
 * Usage:
 *   node scripts/set-telegram-webhook.mjs
 *   node scripts/set-telegram-webhook.mjs --info   # getWebhookInfo only
 */
import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const miniApp = process.env.TELEGRAM_MINI_APP_URL?.trim().replace(/\/$/, "");
const baseOverride = process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim().replace(/\/$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const infoOnly = process.argv.includes("--info");

const base = baseOverride || miniApp;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

if (!base && !infoOnly) {
  console.error("Missing TELEGRAM_MINI_APP_URL (or TELEGRAM_WEBHOOK_BASE_URL) in .env");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json();
    if (!j.ok) {
      throw new Error(`${method}: ${JSON.stringify(j)}`);
    }
    return j.result;
  });

if (infoOnly) {
  const result = await api("getWebhookInfo", {});
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const url = `${base}/api/telegram/webhook`;
const payload = { url };
if (secret) payload.secret_token = secret;

console.log("setWebhook →", url, secret ? "(with secret_token)" : "(no secret_token)");
const result = await api("setWebhook", payload);
console.log("OK:", JSON.stringify(result, null, 2));

const info = await api("getWebhookInfo", {});
console.log("getWebhookInfo:", JSON.stringify(info, null, 2));
