# Telegram Mini App Setup

## 1) Create and configure the bot in BotFather

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Run `/newbot`.
3. Set bot name: `ModelClone`.
4. Set bot username: `modelclone_bot` (or another available username).
5. Run `/setmenubutton`, choose your bot, and set URL: `https://modelclone.app`.
6. Run `/newapp`, choose your bot, set app name: `ModelClone Studio`, and URL: `https://modelclone.app`.
7. Run `/setdomain` and set: `modelclone.app`.

## 2) Configure webhook

Use your real bot token and webhook secret:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://modelclone.app/api/telegram/webhook\",\"secret_token\":\"<TELEGRAM_WEBHOOK_SECRET>\"}"
```

## 3) Environment variables

Set these in production:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_MINI_APP_URL=https://modelclone.app`

## 4) Deployment checklist

- [ ] `TELEGRAM_BOT_TOKEN` is set in production
- [ ] `TELEGRAM_WEBHOOK_SECRET` is set in production
- [ ] `TELEGRAM_MINI_APP_URL=https://modelclone.app` is set
- [ ] Prisma migration for Telegram fields is applied
- [ ] Telegram webhook is registered after deploy

## 5) Legacy commands (classic bot buttons + commands)

The webhook supports a command-driven menu so users can navigate the full app from chat:

- `/start` or `/menu` — main menu
- `/app` — open Mini App home
- `/dashboard`, `/models`, `/generate`, `/creator`, `/history`, `/settings`
- `/pricing` — open plans/credits
- `/help` — support links

The command menu uses classic inline callbacks and deep-links each action into the Mini App.

Users can switch anytime between:

- **Mini App mode**: full SPA in Telegram WebApp
- **Legacy Bot mode**: classic bot keyboard/buttons + chat responses

Use `/mode` to toggle.

---

## 6) Test on your phone (production or staging)

1. Set **`TELEGRAM_BOT_TOKEN`** (and **`TELEGRAM_WEBHOOK_SECRET`** if you use webhook verification) on the **same server** that runs the API (`DATABASE_URL` must work there too).
2. Point the webhook at **HTTPS** (Telegram does not call `http://localhost`):
   - Production: `https://your-domain.com/api/telegram/webhook`
3. In BotFather: **Mini App URL** and **`/setdomain`** must match the **exact host** users open (e.g. `modelclone.app`).
4. Open the bot in Telegram, send **`/start`**, try **Open Mini App** / menu button.

**If something fails, send back:**

- What you did (command, button, Mini App open, etc.).
- Any message the bot shows in chat.
- For the **Mini App**: screenshot or text of the in-app error (e.g. “Telegram auth is not configured”, “Invalid Telegram authorization payload”).
- From the **server logs** (same time window): lines containing `[webhook]`, `telegram`, or `401` / `500`.

---

## 7) Local development (optional)

Telegram **requires HTTPS** for webhooks and Mini App domains. To hit your laptop:

1. Run the app locally (`npm run dev`).
2. Expose it with a tunnel, e.g. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) or [ngrok](https://ngrok.com/): `https://abc123.ngrok-free.app` → `http://localhost:5000`.
3. Set in `.env`:
   - `TELEGRAM_BOT_TOKEN=...`
   - `TELEGRAM_WEBHOOK_SECRET=...` (optional; if set, use the same in `setWebhook`)
   - `TELEGRAM_MINI_APP_URL=https://abc123.ngrok-free.app`
   - `CALLBACK_BASE_URL`, `FRONTEND_URL`, `CLIENT_URL`, `VITE_API_URL` to that same **https** origin if you use that tunnel as the public app URL.
4. Register webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://abc123.ngrok-free.app/api/telegram/webhook\",\"secret_token\":\"<TELEGRAM_WEBHOOK_SECRET>\"}"
```

5. In BotFather: set Mini App URL and **`/setdomain`** to your tunnel host (Telegram may restrict some free tunnel domains — if BotFather rejects it, use a stable staging domain).

**Check webhook status:**

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Look for `url`, `last_error_message`, and `last_error_date`.

---

## 8) Common errors

| Symptom | Likely cause |
|--------|----------------|
| Bot never replies in chat | Webhook not set, wrong URL, or server not reachable from the internet. Check `getWebhookInfo`. |
| HTTP 401 on `/api/telegram/webhook` | `TELEGRAM_WEBHOOK_SECRET` set in `.env` but `secret_token` in `setWebhook` missing or different. |
| Mini App: “Telegram auth is not configured” | `TELEGRAM_BOT_TOKEN` missing on the API server. |
| Mini App: “Invalid Telegram authorization payload” | Wrong bot token (not the bot that opened the Mini App), or initData corrupted. |
| Mini App: payload expired | Clock skew rare; reopen the Mini App to refresh initData. |
