import { Router } from "express";
import { sendMessage } from "../../services/telegramBot.js";

const router = Router();

router.post("/webhook", async (req, res) => {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = req.get("X-Telegram-Bot-Api-Secret-Token") || "";

  if (configuredSecret && incomingSecret !== configuredSecret) {
    return res.status(401).json({ success: false, message: "Invalid webhook secret." });
  }

  const update = req.body || {};
  const message = update.message;

  try {
    if (message?.text === "/start") {
      const miniAppUrl = process.env.TELEGRAM_MINI_APP_URL || "https://modelclone.app";
      await sendMessage(
        message.chat.id,
        "Open ModelClone Studio in Telegram:",
        {
          inline_keyboard: [
            [
              {
                text: "Open ModelClone Mini App",
                web_app: { url: miniAppUrl },
              },
            ],
          ],
        },
      );
    }

    if (message?.web_app_data?.data) {
      console.log("Telegram web_app_data:", {
        chatId: message.chat?.id,
        fromId: message.from?.id,
        payload: message.web_app_data.data,
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook processing error:", error);
    return res.status(500).json({ success: false, message: "Webhook processing failed." });
  }
});

export default router;
