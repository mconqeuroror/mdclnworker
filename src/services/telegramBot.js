const TELEGRAM_API_BASE = "https://api.telegram.org";

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

async function callTelegramApi(method, payload = {}) {
  const token = getBotToken();
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API ${method} failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API ${method} error: ${JSON.stringify(data)}`);
  }
  return data.result;
}

export function sendMessage(chatId, text, replyMarkup) {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function setWebhook(url) {
  return callTelegramApi("setWebhook", {
    url,
    ...(process.env.TELEGRAM_WEBHOOK_SECRET
      ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET }
      : {}),
  });
}

export function answerWebAppQuery(queryId, result) {
  return callTelegramApi("answerWebAppQuery", {
    web_app_query_id: queryId,
    result,
  });
}
