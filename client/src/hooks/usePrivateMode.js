import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Private Mode — global on/off toggle that heavily blurs all user-facing media
 * (generated photos/videos, uploaded inputs, history thumbnails) via a CSS body
 * class. Persists in localStorage so it survives page reloads, and syncs across
 * tabs via the `storage` event.
 *
 * The actual blur is applied by the `.mc-private-mode` body class + CSS rules
 * in client/src/index.css that target <img>/<video> everywhere EXCEPT the
 * sidebar, top navigation, logos, and user avatar chrome. No changes to
 * individual image components are required.
 */

const STORAGE_KEY = "mc-private-mode";
const BODY_CLASS = "mc-private-mode";
const EVENT = "mc-private-mode-change";

function safeRead() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function applyBodyClass(on) {
  if (typeof document === "undefined") return;
  const body = document.body;
  if (!body) return;
  if (on) body.classList.add(BODY_CLASS);
  else body.classList.remove(BODY_CLASS);
}

function writeAndBroadcast(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Storage errors are non-fatal — the in-memory state + body class still work.
  }
  applyBodyClass(next);
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { enabled: next } }));
  } catch {
    // CustomEvent may fail in exotic environments; ignore.
  }
}

function subscribe(callback) {
  const onStorage = (event) => {
    if (event && event.key && event.key !== STORAGE_KEY) return;
    callback();
  };
  const onCustom = () => callback();
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onCustom);
  };
}

function getSnapshot() {
  return safeRead();
}

function getServerSnapshot() {
  return false;
}

/**
 * Apply the saved Private Mode body class as early as possible (call once from
 * client entry point, next to theme bootstrap). Safe to call multiple times.
 */
export function bootstrapPrivateMode() {
  if (typeof document === "undefined") return;
  applyBodyClass(safeRead());
}

/**
 * @returns {[boolean, (next?: boolean) => void]} — `[enabled, setEnabled]`.
 * Call `setEnabled()` with no argument to toggle.
 */
export function usePrivateMode() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Keep the body class in sync with the latest store snapshot on mount and
  // whenever `enabled` flips (covers the initial client render and HMR).
  useEffect(() => {
    applyBodyClass(enabled);
  }, [enabled]);

  const setEnabled = useCallback((next) => {
    const resolved = typeof next === "boolean" ? next : !safeRead();
    writeAndBroadcast(resolved);
  }, []);

  return [enabled, setEnabled];
}
