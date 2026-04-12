import { useCallback, useEffect, useRef, useState } from "react";
import { authAPI } from "../services/api";
import { useAuthStore } from "../store";
import { getRawInitData, getTelegramUser, isTelegram, tg } from "../lib/telegram.js";

const TELEGRAM_BYPASS_KEY = "telegram_auth_bypass";

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
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [status, setStatus] = useState(() => {
    if (!isTelegram()) return "done";
    try {
      const bypass = localStorage.getItem(TELEGRAM_BYPASS_KEY) === "true";
      return bypass ? "done" : "loading";
    } catch {
      return "loading";
    }
  });
  const [error, setError] = useState("");
  const [linking, setLinking] = useState(false);
  const linkAttemptedRef = useRef(false);

  const runAuth = useCallback(async () => {
    if (!isTelegram()) {
      setStatus("done");
      return;
    }
    try {
      if (localStorage.getItem(TELEGRAM_BYPASS_KEY) === "true") {
        setStatus("done");
        return;
      }
    } catch {
      // Ignore localStorage access issues.
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
      try {
        localStorage.removeItem(TELEGRAM_BYPASS_KEY);
      } catch {
        // Ignore localStorage access issues.
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

  useEffect(() => {
    if (!isTelegram() || !isAuthenticated || linking || linkAttemptedRef.current) return;
    const initData = getRawInitData();
    if (!initData) return;
    linkAttemptedRef.current = true;

    let cancelled = false;
    const tryLink = async () => {
      try {
        setLinking(true);
        const response = await authAPI.linkTelegram(initData);
        if (!cancelled && response?.success) {
          setTelegramUser(getTelegramUser());
          try {
            localStorage.removeItem(TELEGRAM_BYPASS_KEY);
          } catch {
            // Ignore localStorage access issues.
          }
        }
      } catch {
        // Linking is best-effort for existing-account login path.
      } finally {
        if (!cancelled) setLinking(false);
      }
    };

    void tryLink();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, linking, setTelegramUser]);

  const continueWithExistingAccount = () => {
    try {
      localStorage.setItem(TELEGRAM_BYPASS_KEY, "true");
    } catch {
      // Ignore localStorage access issues.
    }
    setStatus("done");
  };

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
          <button
            type="button"
            onClick={continueWithExistingAccount}
            className="ml-3 px-4 py-2 rounded-lg border border-white/20 text-white font-medium hover:bg-white/10 transition-colors"
          >
            Use existing account
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
