import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, inlineKbd, formatDate } from "./helpers.js";
import { cancelKbd, appHubKbd, openAppKbd } from "./keyboards.js";
import { ensureAuth, handleLogout } from "./auth.js";
import {
  api2FAStatus, apiApiKeySummaries, apiUpdateProfile, apiGetProfile,
  apiCreateCheckout, apiRequestEmailChange, apiVerifyEmailChange,
} from "./api.js";
import { MINI_APP_BASE } from "./config.js";

export async function renderSettings(chatId, userId) {
  const [user, fa, keys] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, authProvider: true, twoFactorEnabled: true } }),
    api2FAStatus(userId),
    apiApiKeySummaries(userId),
  ]);
  const name = user?.name || "n/a";
  const email = user?.email || "n/a";
  const provider = user?.authProvider || "email";
  const twoFALine = fa.ok ? `2FA: ${fa.enabled ? "✅ enabled" : "❌ disabled"}` : "2FA: unknown";
  const keyLine = keys.ok && keys.keys.length
    ? `API Keys: ${keys.keys.slice(0, 3).map((k) => k.prefix + "…").join(", ")}`
    : "API Keys: none";
  await send(chatId, `⚙️ Settings\n\nName: ${name}\nEmail: ${email}\nAuth: ${provider}\n${twoFALine}\n${keyLine}`, inlineKbd([
    [{ text: "✏️ Update Name", callback_data: "settings:name" }],
    [{ text: "📧 Change Email", callback_data: "settings:email" }],
    [{ text: "🔑 API Keys & 2FA (Mini App)", web_app: { url: `${MINI_APP_BASE}/dashboard?tab=settings` } }],
    [{ text: "🚪 Logout", callback_data: "auth:logout" }],
    [{ text: "⬅️ Home", callback_data: "nav:home" }],
  ]));
}

export async function renderPricing(chatId, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true, subscriptionTier: true } });
  const credits = Number(user?.credits ?? 0);
  const plan = user?.subscriptionTier || "free";
  await send(chatId, `💳 Pricing & Credits\n\nPlan: ${plan}\nCredits: ${credits}`, inlineKbd([
    [{ text: "💰 Buy Credits", callback_data: "pricing:credits" }],
    [{ text: "📋 Buy a Plan", callback_data: "pricing:plan" }],
    [{ text: "📱 Open Full Pricing", web_app: { url: `${MINI_APP_BASE}/dashboard?openCredits=true` } }],
    [{ text: "⬅️ Home", callback_data: "nav:home" }],
  ]));
}

export async function renderAppHub(chatId) {
  await send(chatId, "🌐 App Hub — Open any section in the Mini App:", appHubKbd());
}

export async function handleSettingsMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("settings_") && !flow?.step?.startsWith("pricing_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") {
    clearFlow(chatId);
    await renderSettings(chatId, userId);
    return true;
  }

  if (flow.step === "settings_name") {
    if (t.length < 2 || t.length > 80) { await send(chatId, "Name must be 2–80 characters:", cancelKbd()); return true; }
    await apiUpdateProfile(userId, { name: t });
    clearFlow(chatId);
    await send(chatId, `✅ Name updated to "${t}".`, inlineKbd([[{ text: "⚙️ Settings", callback_data: "nav:settings" }]]));
    return true;
  }

  if (flow.step === "settings_email_new") {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(t)) { await send(chatId, "Enter a valid email address:", cancelKbd()); return true; }
    await send(chatId, "⏳ Sending verification code...", null);
    const r = await apiRequestEmailChange(userId, t);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`, inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:settings" }]])); return true; }
    setFlow(chatId, { step: "settings_email_code", newEmail: t });
    await send(chatId, `✅ Verification code sent to ${t}.\n\nEnter the 6-digit code from the email:`, cancelKbd());
    return true;
  }

  if (flow.step === "settings_email_code") {
    if (!/^\d{6}$/.test(t)) { await send(chatId, "Enter the 6-digit verification code:", cancelKbd()); return true; }
    const r = await apiVerifyEmailChange(userId, t);
    if (!r.ok) { await send(chatId, `❌ Verification failed: ${r.message}`, inlineKbd([[{ text: "Retry", callback_data: "settings:email" }]])); return true; }
    clearFlow(chatId);
    await send(chatId, `✅ Email changed to ${flow.newEmail}!`, inlineKbd([[{ text: "⚙️ Settings", callback_data: "nav:settings" }]]));
    return true;
  }

  if (flow.step === "pricing_credits_amount") {
    const amount = Number.parseInt(t, 10);
    if (!Number.isFinite(amount) || amount < 2000) { await send(chatId, "Enter an amount ≥ 2000:", cancelKbd()); return true; }
    clearFlow(chatId);
    const r = await apiCreateCheckout(userId, amount);
    if (!r.ok) { await send(chatId, `❌ Failed to create checkout: ${r.message}`); return true; }
    await send(chatId, `✅ Checkout ready for ${amount} credits.`, inlineKbd([[{ text: "💳 Pay now", url: r.url }]]));
    return true;
  }

  return false;
}

export async function handleSettingsCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:settings") { await renderSettings(chatId, userId); return true; }
  if (data === "nav:pricing") { await renderPricing(chatId, userId); return true; }
  if (data === "nav:apphub") { await renderAppHub(chatId); return true; }

  if (data === "settings:name") {
    setFlow(chatId, { step: "settings_name" });
    await send(chatId, "Enter your new display name (2–80 chars):", cancelKbd()); return true;
  }

  if (data === "settings:email") {
    setFlow(chatId, { step: "settings_email_new" });
    await send(chatId, "📧 Change Email\n\n⚠️ A verification code will be sent to the new address.\n\nEnter your new email address:", cancelKbd());
    return true;
  }

  if (data === "pricing:credits") {
    setFlow(chatId, { step: "pricing_credits_amount" });
    await send(chatId, "Enter the number of credits to buy (minimum 2000):", cancelKbd()); return true;
  }
  if (data === "pricing:plan") {
    await send(chatId, "Choose plan billing period:", inlineKbd([
      [{ text: "📅 Monthly Plans", web_app: { url: `${MINI_APP_BASE}/dashboard?openCredits=true&tab=plans` } }],
      [{ text: "📆 Yearly Plans (save more)", web_app: { url: `${MINI_APP_BASE}/dashboard?openCredits=true&tab=plans&yearly=1` } }],
      [{ text: "⬅️ Back", callback_data: "nav:pricing" }],
    ]));
    return true;
  }

  return false;
}
