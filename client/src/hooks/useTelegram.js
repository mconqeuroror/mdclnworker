import { useEffect, useMemo, useState } from "react";
import { getTelegramUser, isTelegram, tg } from "../lib/telegram.js";
import { useTheme } from "./useTheme.jsx";

export function useTelegram() {
  const { theme, toggleTheme } = useTheme();
  const [colorScheme, setColorScheme] = useState(
    tg?.colorScheme === "light" ? "light" : "dark",
  );

  useEffect(() => {
    if (!isTelegram() || !tg) return;
    const nextMode = tg.colorScheme === "light" ? "light" : "dark";
    setColorScheme(nextMode);
  }, []);

  useEffect(() => {
    if (!isTelegram()) return;
    if (colorScheme !== theme) {
      toggleTheme();
    }
  }, [colorScheme, theme, toggleTheme]);

  return useMemo(
    () => ({
      isTelegram: isTelegram(),
      user: getTelegramUser(),
      tg,
      colorScheme,
      themeParams: tg?.themeParams ?? {},
    }),
    [colorScheme],
  );
}
