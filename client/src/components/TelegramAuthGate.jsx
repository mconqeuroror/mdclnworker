import { useEffect } from "react";
import { isTelegram, tg } from "../lib/telegram.js";

function applyTelegramThemeVariables() {
  if (!tg?.themeParams) return;
  const html = document.documentElement;
  for (const [key, value] of Object.entries(tg.themeParams)) {
    if (!value) continue;
    html.style.setProperty(`--tg-${key.replace(/_/g, "-")}`, String(value));
  }
}

/**
 * Telegram Mini App: apply theme CSS vars only.
 * Telegram SSO login is disabled — users sign in with email / Google like in a normal browser.
 */
export default function TelegramAuthGate({ children }) {
  useEffect(() => {
    if (isTelegram()) applyTelegramThemeVariables();
  }, []);

  return <>{children}</>;
}
