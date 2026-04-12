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
