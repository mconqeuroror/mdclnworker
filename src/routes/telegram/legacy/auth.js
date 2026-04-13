import bcrypt from "bcryptjs";
import prisma from "../../../lib/prisma.js";
import { getSession, setSession, clearSession, clearFlow, setFlow, getFlow, persistNow, loadSessionFromDB } from "./state.js";
import { send, answerCb, cancelKbd as cancelHelper, inlineKbd, removeKbd } from "./helpers.js";
import { loginKbd, mainKbd, dashboardKbd } from "./keyboards.js";
import { renderDashboard } from "./dashboard.js";

// ── Ensure auth — returns session or sends login prompt ───────
// Falls back to DB on cold starts (serverless: in-memory Map may be empty)
export async function ensureAuth(chatId) {
  let session = getSession(chatId);
  if (session?.userId) return session;

  // In-memory miss — query DB directly via raw SQL (works even if Prisma client
  // hasn't been regenerated since TelegramLegacyState was added to the schema)
  const dbSession = await loadSessionFromDB(chatId);
  if (dbSession?.userId) {
    setSession(chatId, dbSession);
    return dbSession;
  }

  await sendLoginPrompt(chatId);
  return null;
}

export async function sendLoginPrompt(chatId, greeting = "") {
  const g = greeting ? `${greeting} — you` : "You";
  await send(
    chatId,
    `${g} need to log in to use ModelClone.\n\nHow would you like to log in?`,
    loginKbd(),
  );
}

// ── Handle auth callbacks ─────────────────────────────────────
export async function handleAuthCallback(chatId, data, firstName = "", callbackId = "") {
  if (data === "auth:telegram") {
    await answerCb(callbackId);
    // Don't restart if already mid-login
    const existingFlow = getFlow(chatId);
    if (existingFlow?.step?.startsWith("auth_")) return true;
    await attemptTelegramAuth(chatId);
    return true;
  }
  if (data === "auth:email") {
    await answerCb(callbackId);
    // Don't restart if already mid-login (prevents double-tap race condition)
    const existingFlow = getFlow(chatId);
    if (existingFlow?.step?.startsWith("auth_")) return true;
    setFlow(chatId, { step: "auth_email" });
    await send(chatId, "Enter your email address:", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
    return true;
  }
  if (data === "auth:logout") {
    await answerCb(callbackId);
    await handleLogout(chatId);
    return true;
  }
  return false;
}

// ── Telegram login (link Telegram user ID to ModelClone account) ─
export async function attemptTelegramAuth(chatId) {
  try {
    const telegramId = String(chatId);
    const user = await prisma.user.findFirst({
      where: { telegramId },
      select: { id: true, name: true, email: true, credits: true },
    });
    if (user) {
      setSession(chatId, { userId: user.id, email: user.email });
      clearFlow(chatId);
      await send(chatId, `✅ Logged in as ${user.name || user.email}.`, removeKbd());
      await renderDashboard(chatId, user.id);
      return;
    }
    await send(
      chatId,
      "No ModelClone account is linked to this Telegram account.\n\nLog in with Email + Password to link it, or create an account in the app.",
      loginKbd(),
    );
  } catch (e) {
    console.error("[auth:telegram]", e?.message);
    await send(chatId, "Login failed. Please try again.", loginKbd());
  }
}

// ── Handle flow message steps for email/password/2FA ─────────
export async function handleAuthMessage(chatId, text) {
  const flow = getFlow(chatId);
  if (!flow) return false;

  const t = String(text || "").trim();
  const cancel = t.toLowerCase() === "cancel";

  if (flow.step === "auth_email") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Login cancelled.", removeKbd()); await sendLoginPrompt(chatId); return true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      await send(chatId, "That doesn't look like a valid email. Try again:", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
      return true;
    }
    setFlow(chatId, { step: "auth_password", email: t.toLowerCase() });
    await send(chatId, "Enter your password:", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
    return true;
  }

  if (flow.step === "auth_password") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Login cancelled.", removeKbd()); await sendLoginPrompt(chatId); return true; }
    await verifyEmailPassword(chatId, flow.email, t);
    return true;
  }

  if (flow.step === "auth_2fa") {
    if (cancel) { clearFlow(chatId); await send(chatId, "Login cancelled.", removeKbd()); await sendLoginPrompt(chatId); return true; }
    if (!/^\d{6}$/.test(t)) {
      await send(chatId, "2FA code must be 6 digits. Try again:", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
      return true;
    }
    await verify2FA(chatId, flow.pendingUserId, t);
    return true;
  }

  return false;
}

async function verifyEmailPassword(chatId, email, password) {
  try {
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      // Field is "password" in schema, NOT "passwordHash"
      select: { id: true, name: true, email: true, password: true, authProvider: true, twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!user) {
      await send(chatId, "No account found with this email.", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
      return;
    }
    // authProvider defaults to "email"; any other value (google, firebase, etc.) = not password login
    const provider = user.authProvider ?? "email";
    if (provider !== "email" || !user.password) {
      await send(chatId, "This account uses Google / social login.\n\nUse the button below to sign in:", loginKbd());
      clearFlow(chatId);
      return;
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await send(chatId, "Incorrect password. Try again:", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
      return;
    }
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      setFlow(chatId, { step: "auth_2fa", pendingUserId: user.id });
      await send(chatId, "2FA is enabled. Enter your 6-digit authenticator code:", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
      return;
    }
    await completeLogin(chatId, user);
  } catch (e) {
    console.error("[auth:email]", e?.message);
    await send(chatId, "Login failed. Please try again.", loginKbd());
    clearFlow(chatId);
  }
}

async function verify2FA(chatId, userId, code) {
  try {
    const { authenticator } = await import("otplib");
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, twoFactorSecret: true } });
    if (!user?.twoFactorSecret) {
      await send(chatId, "2FA setup appears incomplete. Contact support.", loginKbd());
      clearFlow(chatId);
      return;
    }
    const valid = authenticator.check(code, user.twoFactorSecret);
    if (!valid) {
      await send(chatId, "Invalid 2FA code. Try again:", { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true });
      return;
    }
    await completeLogin(chatId, user);
  } catch (e) {
    console.error("[auth:2fa]", e?.message);
    await send(chatId, "2FA verification failed. Try again.", loginKbd());
    clearFlow(chatId);
  }
}

async function completeLogin(chatId, user) {
  setSession(chatId, { userId: user.id, email: user.email });
  clearFlow(chatId);
  // Persist immediately after login so cold-start instances can restore the session
  await persistNow(String(chatId)).catch(() => {});
  await send(chatId, `✅ Logged in as ${user.name || user.email}.`, removeKbd());
  await renderDashboard(chatId, user.id);
}

export async function handleLogout(chatId) {
  clearSession(chatId);
  clearFlow(chatId);
  await send(chatId, "You've been logged out.", removeKbd());
  await sendLoginPrompt(chatId);
}

// ── One-line login shortcut: "email password" ─────────────────
export function parseInlineLogin(text = "") {
  const m = text.match(/^([^\s@]+@[^\s@]+\.[^\s@]+)\s+(.+)$/i);
  if (m) return { email: m[1], password: m[2] };
  return null;
}

export async function handleInlineLogin(chatId, email, password) {
  await verifyEmailPassword(chatId, email.toLowerCase(), password);
}
