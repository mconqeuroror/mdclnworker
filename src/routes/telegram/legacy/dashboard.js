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
    const total = Math.max(
      0,
      Number(user.credits ?? 0) +
        Number(user.subscriptionCredits ?? 0) +
        Number(user.purchasedCredits ?? 0),
    );
    const name = user.name || user.email || "there";
    const plan = user.subscriptionTier ? `(${user.subscriptionTier})` : "(free)";
    const text =
      `👋 Hey ${name}!\n\n` +
      `💰 Credits: ${total.toLocaleString("en-US")} ${plan}\n` +
      `⏳ Active jobs: ${pendingCount}\n\n` +
      `What would you like to do?\n\n` +
      `⌨️ Tap Menu on the keyboard below anytime (same as /menu) — no need for /start.`;
    await send(chatId, text, dashboardKbd());
    await send(chatId, "\u2060", mainKbd());
  } catch (e) {
    console.error("[dashboard]", e?.message);
    await send(chatId, "Welcome! Choose an action:", dashboardKbd());
    await send(chatId, "\u2060", mainKbd());
  }
}
