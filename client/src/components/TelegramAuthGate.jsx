import { useCallback, useEffect, useState } from "react";
import { authAPI } from "../services/api";
import { useAuthStore } from "../store";
import { getRawInitData, getTelegramUser, isTelegram, tg } from "../lib/telegram.js";

function applyTelegramThemeVariables() {
  if (!tg?.themeParams) return;
  const html = document.documentElement;
  const entries = Object.entries(tg.themeParams);
  for (const [key, value] of entries) {
    if (!value) continue;
    html.style.setProperty(`--tg-${key.replace(/_/g, "-")}`, String(value));
  }
}

export default function TelegramAuthGate({ children }) {
  const setAuth = useAuthStore((state) => state.setAuth);
  const setTelegramUser = useAuthStore((state) => state.setTelegramUser);
  const [status, setStatus] = useState(isTelegram() ? "loading" : "done");
  const [error, setError] = useState("");

  const runAuth = useCallback(async () => {
    if (!isTelegram()) {
      setStatus("done");
      return;
    }

    setStatus("loading");
    setError("");
    applyTelegramThemeVariables();

    const initData = getRawInitData();
    if (!initData) {
      setError("Missing Telegram initialization payload.");
      setStatus("error");
      return;
    }

    try {
      const response = await authAPI.telegramAuth(initData);
      if (!response?.success || !response?.user || !response?.token) {
        throw new Error(response?.message || "Telegram authentication failed.");
      }
      setAuth(response.user, response.token);
      setTelegramUser(getTelegramUser());
      setStatus("done");
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : "Telegram authentication failed.";
      setError(message);
      setStatus("error");
    }
  }, [setAuth, setTelegramUser]);

  useEffect(() => {
    void runAuth();
  }, [runAuth]);

  if (status === "loading") {
    return (
      <div className="min-h-screen w-full bg-[#07070a] text-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <p className="text-sm text-slate-300">Authorizing with Telegram...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen w-full bg-[#07070a] text-white flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <h2 className="text-lg font-semibold mb-2">Telegram sign-in failed</h2>
          <p className="text-sm text-red-100/90 mb-4">{error}</p>
          <button
            type="button"
            onClick={() => void runAuth()}
            className="px-4 py-2 rounded-lg bg-white text-black font-medium hover:bg-slate-100 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
