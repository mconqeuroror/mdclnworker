import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, inlineKbd, formatDate } from "./helpers.js";
import { cancelKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import { apiReferralOverview, apiReferralSetCode, apiReferralRequestPayout } from "./api.js";
import { MINI_APP_BASE } from "./config.js";

export async function renderReferral(chatId, userId) {
  await send(chatId, "⏳ Loading referral info...", null);
  const r = await apiReferralOverview(userId);
  if (!r.ok) {
    await send(chatId, "🎁 Referral Program\n\nCould not load your referral data. Try again later.", inlineKbd([
      [{ text: "🔄 Retry", callback_data: "nav:referral" }],
      [{ text: "⬅️ Home", callback_data: "nav:home" }],
    ]));
    return;
  }
  const o = r.overview || {};
  const code = o.code || o.referralCode || "none";
  const earnings = o.totalEarnings || o.earnings || 0;
  const pending = o.pendingEarnings || 0;
  const referrals = o.totalReferrals || o.referralCount || 0;
  const paid = o.totalPaid || 0;
  const text =
    `🎁 Referral Program\n\n` +
    `Your code: ${code}\n` +
    `Total referrals: ${referrals}\n` +
    `Total earnings: $${Number(earnings).toFixed(2)}\n` +
    `Pending: $${Number(pending).toFixed(2)}\n` +
    `Paid out: $${Number(paid).toFixed(2)}`;
  await send(chatId, text, inlineKbd([
    [{ text: "✏️ Set/Change Code", callback_data: "referral:setcode" }],
    ...(Number(pending) >= 20 ? [[{ text: "💸 Request Payout", callback_data: "referral:payout" }]] : []),
    [{ text: "📱 Full Referral Dashboard", web_app: { url: `${MINI_APP_BASE}/dashboard?tab=referral` } }],
    [{ text: "⬅️ Home", callback_data: "nav:home" }],
  ]));
}

export async function handleReferralMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("referral_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await renderReferral(chatId, userId); return true; }

  if (flow.step === "referral_setcode") {
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(t)) {
      await send(chatId, "Code must be 3–20 chars, letters/numbers/- only:", cancelKbd());
      return true;
    }
    await send(chatId, "⏳ Setting code...", null);
    const r = await apiReferralSetCode(userId, t);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`, inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:referral" }]])); return true; }
    clearFlow(chatId);
    await send(chatId, `✅ Referral code set to "${r.code || t}"!`, inlineKbd([[{ text: "🎁 Referral", callback_data: "nav:referral" }]]));
    return true;
  }

  if (flow.step === "referral_payout_amount") {
    const amount = Number.parseFloat(t);
    if (!Number.isFinite(amount) || amount < 20) {
      await send(chatId, "Minimum payout is $20. Enter amount:", cancelKbd());
      return true;
    }
    await send(chatId, "⏳ Submitting payout request...", null);
    const r = await apiReferralRequestPayout(userId, amount);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`, inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:referral" }]])); return true; }
    clearFlow(chatId);
    await send(chatId, `✅ Payout of $${amount.toFixed(2)} requested! We'll process it shortly.`, inlineKbd([[{ text: "🎁 Referral", callback_data: "nav:referral" }]]));
    return true;
  }

  return false;
}

export async function handleReferralCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:referral") { await renderReferral(chatId, userId); return true; }

  if (data === "referral:setcode") {
    setFlow(chatId, { step: "referral_setcode" });
    await send(chatId, "Enter your referral code (3–20 chars, letters/numbers/- only):", cancelKbd());
    return true;
  }

  if (data === "referral:payout") {
    const r = await apiReferralOverview(userId);
    const pending = Number(r.overview?.pendingEarnings || 0);
    if (pending < 20) { await send(chatId, `Minimum payout is $20. You have $${pending.toFixed(2)} pending.`); return true; }
    setFlow(chatId, { step: "referral_payout_amount", available: pending });
    await send(chatId, `You have $${pending.toFixed(2)} available.\n\nEnter payout amount (min $20):`, cancelKbd());
    return true;
  }

  return false;
}
