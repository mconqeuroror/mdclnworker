import prisma from "../../../lib/prisma.js";
import { send } from "./helpers.js";
import { dashboardKbd, mainKbd } from "./keyboards.js";

export async function renderDashboard(chatId, userId) {
  try {
    const [user, pendingCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, credits: true, subscriptionCredits: true, purchasedCredits: true, subscriptionTier: true },
      }),
      prisma.generation.count({ where: { userId, status: { in: ["pending", "processing"] } } }),
    ]);
    if (!user) return;
    const credits = Number(user.credits ?? 0);
    const sub = Number(user.subscriptionCredits ?? 0);
    const purchased = Number(user.purchasedCredits ?? 0);
    const name = user.name || user.email || "there";
    const plan = user.subscriptionTier ? `(${user.subscriptionTier})` : "(free)";
    const text =
      `👋 Hey ${name}!\n\n` +
      `💰 Credits: ${credits} ${plan}\n` +
      `   ↳ Subscription: ${sub} · Purchased: ${purchased}\n` +
      `⏳ Active jobs: ${pendingCount}\n\n` +
      `What would you like to do?`;
    await send(chatId, text, dashboardKbd());
  } catch (e) {
    console.error("[dashboard]", e?.message);
    await send(chatId, "Welcome! Choose an action:", dashboardKbd());
  }
}
