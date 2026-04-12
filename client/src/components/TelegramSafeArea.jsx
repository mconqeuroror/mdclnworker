import { useMemo } from "react";
import { isTelegram, tg } from "../lib/telegram.js";

export default function TelegramSafeArea({ children }) {
  const style = useMemo(() => {
    if (!isTelegram() || !tg) return undefined;
    const stableHeight = Number(tg.viewportStableHeight || 0);
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const telegramChromeInset =
      stableHeight > 0 ? Math.max(0, viewportHeight - stableHeight) : 0;
    const topPadding =
      telegramChromeInset > 0
        ? `${Math.min(telegramChromeInset, 56)}px`
        : "env(safe-area-inset-top, 0px)";
    const mainButtonPadding = tg.MainButton?.isVisible ? "72px" : "0px";
    return {
      paddingTop: topPadding,
      paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${mainButtonPadding})`,
    };
  }, []);

  return <div style={style}>{children}</div>;
}
