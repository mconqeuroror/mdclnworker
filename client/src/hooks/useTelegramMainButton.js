import { useEffect } from "react";
import { isTelegram, tg } from "../lib/telegram.js";

export function useTelegramMainButton({
  text,
  onClick,
  isVisible,
  isActive,
  color,
}) {
  useEffect(() => {
    const mainButton = tg?.MainButton;
    if (!isTelegram() || !mainButton) return;

    mainButton.setText(text);
    mainButton.setParams({
      color,
      is_active: isActive,
      is_visible: isVisible,
    });

    if (isVisible) mainButton.show();
    else mainButton.hide();

    if (isActive) mainButton.enable();
    else mainButton.disable();

    mainButton.onClick(onClick);

    return () => {
      mainButton.offClick(onClick);
      mainButton.hide();
    };
  }, [color, isActive, isVisible, onClick, text]);
}
