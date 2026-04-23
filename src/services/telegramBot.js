const TELEGRAM_API_BASE = "https://api.telegram.org";

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTelegramApi(method, payload = {}, _retryCount = 0) {
  const token = getBotToken();
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Handle rate limiting with exponential backoff (max 3 retries).
  if (response.status === 429 && _retryCount < 3) {
    let retryAfter = 1;
    try {
      const errBody = await response.clone().json();
      retryAfter = Number(errBody?.parameters?.retry_after) || 1;
    } catch {
      retryAfter = Math.pow(2, _retryCount + 1);
    }
    await sleep(retryAfter * 1000);
    return callTelegramApi(method, payload, _retryCount + 1);
  }

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

export function sendMessage(chatId, text, replyMarkup, extra = {}) {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...extra,
  });
}

export function sendPhoto(chatId, photoUrl, options = {}) {
  const caption = options?.caption ? String(options.caption) : undefined;
  const replyMarkup = options?.replyMarkup;
  return callTelegramApi("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    ...(caption ? { caption } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function sendVideo(chatId, videoUrl, options = {}) {
  const caption = options?.caption ? String(options.caption) : undefined;
  const replyMarkup = options?.replyMarkup;
  return callTelegramApi("sendVideo", {
    chat_id: chatId,
    video: videoUrl,
    supports_streaming: true,
    ...(caption ? { caption } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/** Sends as a downloadable file (no in-chat recompression like photos/videos). URL must be ≤ ~50MB for Telegram. */
export function sendDocument(chatId, documentUrl, options = {}) {
  const caption = options?.caption ? String(options.caption) : undefined;
  const replyMarkup = options?.replyMarkup;
  return callTelegramApi("sendDocument", {
    chat_id: chatId,
    document: documentUrl,
    ...(caption ? { caption } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function sendAnimation(chatId, gifUrl, options = {}) {
  const caption = options?.caption ? String(options.caption) : undefined;
  const replyMarkup = options?.replyMarkup;
  return callTelegramApi("sendAnimation", {
    chat_id: chatId,
    animation: gifUrl,
    ...(caption ? { caption } : {}),
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

export function answerCallbackQuery(callbackQueryId, text = "") {
  return callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export function setMyCommands(commands = []) {
  return callTelegramApi("setMyCommands", {
    commands,
  });
}

export function deleteMessage(chatId, messageId) {
  return callTelegramApi("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

/** Edit text + inline keyboard on an existing message (menu transitions). */
export function editMessageText(chatId, messageId, text, replyMarkup) {
  return callTelegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function downloadTelegramFile(fileId) {
  const file = await callTelegramApi("getFile", {
    file_id: fileId,
  });
  const token = getBotToken();
  const filePath = String(file?.file_path || "");
  if (!filePath) {
    throw new Error("Telegram getFile returned no file_path");
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`, {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram file download failed: ${response.status} ${text}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
    filePath,
  };
}
