export const tg =
  typeof window !== "undefined" ? window.Telegram?.WebApp ?? null : null;

if (tg) {
  try {
    tg.ready();
    tg.expand();
  } catch (error) {
    console.warn("Telegram WebApp init failed:", error);
  }
}

export function isTelegram() {
  return Boolean(tg?.initData && tg.initData.trim().length > 0);
}

export function getRawInitData() {
  return tg?.initData ?? "";
}

export function getTelegramUser() {
  const user = tg?.initDataUnsafe?.user;
  if (!user || typeof user.id !== "number") return null;
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    photo_url: user.photo_url,
    language_code: user.language_code,
  };
}
