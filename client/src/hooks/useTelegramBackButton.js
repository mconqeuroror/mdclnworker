import { useEffect } from "react";
import { isTelegram, tg } from "../lib/telegram.js";

export function useTelegramBackButton({ isVisible, onClick }) {
  useEffect(() => {
    const backButton = tg?.BackButton;
    if (!isTelegram() || !backButton) return;

    if (isVisible) backButton.show();
    else backButton.hide();

    backButton.onClick(onClick);

    return () => {
      backButton.offClick(onClick);
      backButton.hide();
    };
  }, [isVisible, onClick]);
}
