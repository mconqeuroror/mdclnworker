/**
 * Admin disaster recovery: dual Stripe (new + legacy) + Prisma.
 * - Recreates missing users when Stripe still has userId in metadata; emails password reset code.
 * - Backfills CreditTransaction + credit pools from subs / payment intents / checkout sessions.
 * - Optional: KIE failed-generation reconcile (rows still in DB with kie-task:).
 * - optional vercelLogRows: extracts extra cs_/sub_/pi_ ids to process.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { getStripeForAccount } from "../lib/stripeClients.js";
import {
  normalizeCreditUnits,
  resolveSubscriptionBillingCycle,
} from "../utils/creditUnits.js";
import { rolloverSubPoolToPurchasedUpdate } from "./credit.service.js";
import { sendVerificationEmail, generateVerificationCode } from "./email.service.js";
import { runKieLostGenerationReconcileAll } from "./kie-lost-generation-reconcile.service.js";
import { runCatastropheUserAccountPhase } from "./catastrophe-user-restore.service.js";
import { buildVercelLogInventoryReport } from "./vercel-log-inventory.service.js";
import { restoreUserActivityFromLogsAndDatabaseHints } from "./user-activity-restore.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function tryStripeBoth(retrieve) {
  let last = null;
  for (const account of ["new", "legacy"]) {
    const client = getStripeForAccount(account);
    if (!client) continue;
    try {
      const result = await retrieve(client, account);
      return { account, client, result };
    } catch (err) {
      if (err?.code === "resource_missing" || err?.statusCode === 404) {
        last = err;
        continue;
      }
      throw err;
    }
  }
  if (last) throw last;
  throw new Error("Not found in any configured Stripe account");
}

function startOfDayUtc(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function parseDisasterSince(input) {
  if (input == null) return startOfDayUtc();
  if (input instanceof Date) return input;
  const d = new Date(String(input));
  return Number.isNaN(d.getTime()) ? startOfDayUtc() : d;
}

export function collectStripeIdsFromVercelRows(rows) {
  const re = /(cs_live_[a-zA-Z0-9]+|sub_[a-zA-Z0-9]+|pi_[a-zA-Z0-9]+)/g;
  const out = new Set();
  for (const row of rows || []) {
    const s = JSON.stringify(row);
    let m;
    const r = new RegExp(re.source, "g");
    while ((m = r.exec(s)) !== null) out.add(m[1]);
  }
  return [...out];
}

async function ensureUserFromStripeProfile(
  { userId, email, name, stripeAccount },
  o,
) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) {
    return { error: "missing_email", userId };
  }
  if (!UUID_RE.test(String(userId))) {
    return { error: "invalid_user_id", userId };
  }
  return ensureUserRecord({ id: userId, email: e, name: name || null, stripeAccount }, o);
}

/**
 * @param {{ email: string, id?: string, name: string | null, stripeAccount: "new"|"legacy" }} p
 * @param {{ dryRun: boolean, sendPasswordResetEmail: boolean }} o
 */
export async function ensureUserRecord(p, o) {
  const email = String(p.email).trim().toLowerCase();
  if (!email.includes("@")) return { error: "bad_email" };

  const byEmail = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (byEmail) {
    if (p.id && byEmail.id !== p.id) {
      return { user: byEmail, created: false, note: "email_taken_different_id" };
    }
    return { user: byEmail, created: false };
  }

  if (o.dryRun) {
    return { user: null, created: true, wouldCreate: { id: p.id, email, stripeAccount: p.stripeAccount } };
  }

  const useId = p.id && UUID_RE.test(p.id) ? p.id : undefined;
  if (p.id && !useId) {
    return { error: "invalid_user_id_for_create", id: p.id };
  }
  const pass = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  const resetCode = o.sendPasswordResetEmail ? generateVerificationCode() : null;
  const resetCodeExpiresAt = o.sendPasswordResetEmail
    ? new Date(Date.now() + 24 * 60 * 60 * 1000)
    : null;

  const user = await prisma.user.create({
    data: {
      ...(useId ? { id: useId } : {}),
      email,
      name: p.name || null,
      password: pass,
      isVerified: true,
      authProvider: "email",
      role: "user",
      subscriptionStatus: "trial",
      stripeAccount: p.stripeAccount,
      resetCode,
      resetCodeExpiresAt,
    },
  });

  if (o.sendPasswordResetEmail) {
    const r = await sendVerificationEmail(email, resetCode, p.name || "there", true);
    if (!r?.success) {
      console.error("[disaster-recovery] email send failed:", r?.error);
    }
  }

  return { user, created: true, email: user.email };
}

async function recoverSubscriptionPayment(subscriptionId, ctx) {
  const dryRun = ctx.dryRun;
  const sendEm = ctx.sendPasswordResetEmail !== false;
  const { result: subscription, account } = await tryStripeBoth((c) =>
    c.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.payment_intent", "customer"] }),
  );
  const { userId, tierId, credits: creditsStr } = subscription.metadata || {};
  if (!userId || !creditsStr) {
    return { skipped: true, reason: "no_metadata", subscriptionId };
  }

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const cust = subscription.customer;
    const custId = typeof cust === "string" ? cust : cust?.id;
    let email = null;
    let name = null;
    if (custId) {
      try {
        const { result: c } = await tryStripeBoth((cl) => cl.customers.retrieve(custId));
        email = c.email;
        name = c.name;
      } catch (e) {
        console.warn("[disaster-recovery] customer load failed", e?.message);
      }
    }
    if (email) {
      const r = await ensureUserFromStripeProfile(
        { userId, email, name, stripeAccount: account },
        { dryRun, sendPasswordResetEmail: !dryRun && sendEm },
      );
      if (r.wouldCreate && dryRun) {
        return { wouldCreateUser: r.wouldCreate, subscriptionId, account };
      }
      if (r.user) user = r.user;
    }
  }
  if (!user) {
    return { skipped: true, reason: "user_not_found", userId, subscriptionId };
  }

  const existingTx = await prisma.creditTransaction.findUnique({
    where: { paymentSessionId: subscriptionId },
  });
  if (existingTx) {
    return { alreadyProcessed: true, subscriptionId, userId: user.id };
  }

  const billingCycle = resolveSubscriptionBillingCycle(subscription);
  const credits = normalizeCreditUnits(creditsStr);
  if (!credits) {
    return { error: "bad_credits_metadata", subscriptionId };
  }

  const paymentIntent = subscription.latest_invoice?.payment_intent;
  const piStatus = typeof paymentIntent === "object" ? paymentIntent?.status : null;
  const subStatus = subscription.status;
  if (piStatus !== "succeeded" && !["active", "trialing", "past_due"].includes(subStatus)) {
    return { skipped: true, reason: "payment_inactive", subStatus, piStatus, subscriptionId };
  }

  if (dryRun) {
    return { wouldRecover: "subscription", subscriptionId, userId: user.id, credits, account };
  }


  const now = new Date();
  const creditsExpireAt = new Date(now);
  if (billingCycle === "annual") {
    creditsExpireAt.setFullYear(creditsExpireAt.getFullYear() + 1);
  } else {
    creditsExpireAt.setMonth(creditsExpireAt.getMonth() + 1);
  }

  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id;

  await prisma.$transaction(async (tx) => {
    await tx.creditTransaction.create({
      data: {
        userId: user.id,
        amount: credits,
        type: "subscription",
        description: `${(tierId || "sub")} subscription (${billingCycle || "monthly"}) — disaster recovery`,
        paymentSessionId: subscriptionId,
        stripeAccount: account,
      },
    });
    const prior = await tx.user.findUnique({
      where: { id: user.id },
      select: { subscriptionCredits: true },
    });
    const rollover = rolloverSubPoolToPurchasedUpdate(prior?.subscriptionCredits);
    const base = {
      ...rollover,
      stripeSubscriptionId: subscriptionId,
      subscriptionTier: tierId || "starter",
      subscriptionStatus: "active",
      subscriptionBillingCycle: billingCycle || "monthly",
      subscriptionCredits: credits,
      creditsExpireAt,
      maxModels: 999,
    };
    if (account === "new") {
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...base,
          stripeAccount: "new",
          stripeCustomerId: customerId,
        },
      });
    } else {
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...base,
          stripeAccount: "legacy",
          legacyStripeCustomerId: customerId,
          legacyStripeSubscriptionId: subscriptionId,
        },
      });
    }
  });

  return { recovered: true, subscriptionId, userId: user.id, credits, account };
}

async function recoverPaymentIntent(paymentIntentId, ctx) {
  const dryRun = ctx.dryRun;
  const sendEm = ctx.sendPasswordResetEmail !== false;
  const { result: paymentIntent, account } = await tryStripeBoth((c) =>
    c.paymentIntents.retrieve(paymentIntentId),
  );
  if (paymentIntent.status !== "succeeded") {
    return { skipped: true, reason: "pi_not_succeeded", status: paymentIntent.status };
  }
  const { userId, credits: creditsStr, type } = paymentIntent.metadata || {};
  if (!userId || !creditsStr) {
    return { skipped: true, reason: "no_metadata", paymentIntentId };
  }

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user && paymentIntent.customer) {
    try {
      const { result: c } = await tryStripeBoth((cl) => cl.customers.retrieve(String(paymentIntent.customer)));
      if (c.email) {
        const r = await ensureUserFromStripeProfile(
          { userId, email: c.email, name: c.name, stripeAccount: account },
          { dryRun, sendPasswordResetEmail: !dryRun && sendEm },
        );
        if (r.wouldCreate && dryRun) {
          return { wouldCreateUser: r.wouldCreate, paymentIntentId, account };
        }
        if (r.user) user = r.user;
      }
    } catch (e) {
      console.warn("[disaster-recovery] PI customer load", e?.message);
    }
  }
  if (!user) {
    return { skipped: true, reason: "user_not_found", userId, paymentIntentId };
  }

  const existingTx = await prisma.creditTransaction.findUnique({
    where: { paymentSessionId: paymentIntentId },
  });
  if (existingTx) {
    return { alreadyProcessed: true, paymentIntentId, userId: user.id };
  }
  const credits = normalizeCreditUnits(creditsStr);
  if (dryRun) {
    return { wouldRecover: "pi", paymentIntentId, userId: user.id, credits, account };
  }
  await prisma.$transaction(async (tx) => {
    await tx.creditTransaction.create({
      data: {
        userId: user.id,
        amount: credits,
        type: "purchase",
        description: `${type || "one-time"} — disaster recovery`,
        paymentSessionId: paymentIntentId,
        stripeAccount: account,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { purchasedCredits: { increment: credits } },
    });
  });
  return { recovered: true, paymentIntentId, userId: user.id, credits, account };
}

async function recoverCheckoutSession(sessionId, ctx) {
  const { result: session } = await tryStripeBoth((c) =>
    c.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "payment_intent", "line_items", "customer"],
    }),
  );
  if (session.status !== "complete") {
    return { skipped: true, reason: "session_not_complete", status: session.status, sessionId };
  }
  if (session.mode === "subscription" && session.subscription) {
    return recoverSubscriptionPayment(String(session.subscription), ctx);
  }
  if (session.mode === "payment" && session.payment_intent) {
    return recoverPaymentIntent(String(session.payment_intent), ctx);
  }
  return { skipped: true, reason: "session_mode", mode: session.mode, sessionId };
}

async function processOneStripeId(id, ctx) {
  if (id.startsWith("sub_")) return { id, out: await recoverSubscriptionPayment(id, ctx) };
  if (id.startsWith("pi_")) return { id, out: await recoverPaymentIntent(id, ctx) };
  if (id.startsWith("cs_")) return { id, out: await recoverCheckoutSession(id, ctx) };
  return { id, out: { skipped: true, reason: "unknown_id_prefix" } };
}

async function listCheckoutSessionsSince(client, sinceSec, maxItems) {
  const rows = [];
  let startingAfter = null;
  for (;;) {
    const params = {
      limit: 100,
      created: { gte: sinceSec },
    };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await client.checkout.sessions.list(params);
    for (const s of page.data) {
      rows.push(s);
      if (rows.length >= maxItems) return rows;
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return rows;
}

/**
 * @param {object} options
 * @param {boolean} [options.dryRun=true]
 * @param {string|Date} [options.since] — ISO or Date; default UTC start of today
 * @param {boolean} [options.sendPasswordResetEmail=true]
 * @param {number} [options.maxCheckoutSessions=400]
 * @param {boolean} [options.scanCheckoutsFromStripe=true]
 * @param {any[]} [options.vercelLogRows] — Vercel JSON log rows; strip ids
 * @param {boolean} [options.recoverKieGenerations=true]
 * @param {number} [options.kieReconcileLimit=500]
 * @param {boolean} [options.dryRunKie=true] — if dryRun, KIE is dry-run too
 * @param {boolean} [options.resyncTodaysUsers] — run subscription sync for users created/updated since `since`
 * @param {boolean} [options.catastropheUserRestore] — discover emails (Vercel string scan + Stripe customers since `since`); create missing users + send temp password email; defer if email already in DB
 * @param {number} [options.maxStripeCustomers=2000] — per Stripe account cap for customer list (catastrophe phase)
 * @param {string} [options.temporaryPasswordStyle] — "create_only" skips catastrophe account email (password still set)
 */
export async function runDisasterRecovery(options = {}) {
  const dryRun = options.dryRun !== false;
  const since = parseDisasterSince(options.since);
  const sinceSec = Math.floor(since.getTime() / 1000);
  const maxCheckout = Math.max(1, Math.min(5000, parseInt(options.maxCheckoutSessions, 10) || 400));
  const vercelLogRows = Array.isArray(options.vercelLogRows) ? options.vercelLogRows : [];
  const fromLogs = collectStripeIdsFromVercelRows(vercelLogRows);
  const sendPasswordResetEmail = options.sendPasswordResetEmail !== false;
  const ctx = { dryRun, sendPasswordResetEmail };

  const summary = {
    since: since.toISOString(),
    dryRun,
    vercelLogStripeIds: fromLogs.length,
    checkoutScanned: 0,
    idResults: [],
    kie: null,
    todaysUsersResync: null,
    vercelLogInventory: null,
    logCorrelationRestore: null,
    catastrophe: null,
  };

  if (options.catastropheUserRestore === true) {
    try {
      summary.catastrophe = await runCatastropheUserAccountPhase({
        vercelLogRows,
        since,
        dryRun,
        sendCatastropheAccountEmail: options.sendCatastropheAccountEmail !== false,
        maxStripeCustomers: parseInt(String(options.maxStripeCustomers || 2000), 10) || 2000,
        temporaryPasswordStyle: options.temporaryPasswordStyle,
      });
    } catch (e) {
      summary.catastrophe = { error: e?.message || String(e) };
    }
  }

  const seen = new Set();
  const toProcess = [];

  for (const id of fromLogs) {
    if (!seen.has(id)) {
      seen.add(id);
      toProcess.push({ source: "vercel", id });
    }
  }

  if (options.scanCheckoutsFromStripe !== false) {
    let budget = maxCheckout;
    for (const acc of ["new", "legacy"]) {
      if (budget <= 0) break;
      const client = getStripeForAccount(acc);
      if (!client) continue;
      const sessions = await listCheckoutSessionsSince(client, sinceSec, budget);
      summary.checkoutScanned += sessions.length;
      budget -= sessions.length;
      for (const s of sessions) {
        if (s.status !== "complete" || s.payment_status !== "paid") continue;
        if (s.mode === "subscription" && s.subscription) {
          const id = String(s.subscription);
          if (!seen.has(id)) {
            seen.add(id);
            toProcess.push({ source: "checkout", id });
          }
        } else if (s.mode === "payment" && s.payment_intent) {
          const id = String(s.payment_intent);
          if (!seen.has(id)) {
            seen.add(id);
            toProcess.push({ source: "checkout", id });
          }
        }
      }
    }
  }

  for (const item of toProcess) {
    const r = await processOneStripeId(item.id, ctx);
    summary.idResults.push({ source: item.source, ...r });
  }

  if (options.resyncTodaysUsers) {
    const urows = await prisma.user.findMany({
      where: {
        OR: [
          { createdAt: { gte: since } },
          { updatedAt: { gte: since } },
        ],
        AND: {
          OR: [
            { stripeCustomerId: { not: null } },
            { stripeSubscriptionId: { not: null } },
            { legacyStripeCustomerId: { not: null } },
            { legacyStripeSubscriptionId: { not: null } },
          ],
        },
      },
      take: 2000,
      select: { id: true, email: true, stripeCustomerId: true, stripeSubscriptionId: true },
    });
    const extraIds = [];
    for (const u of urows) {
      if (u.stripeSubscriptionId && !seen.has(u.stripeSubscriptionId)) {
        seen.add(u.stripeSubscriptionId);
        extraIds.push(u.stripeSubscriptionId);
      }
    }
    for (const subId of extraIds) {
      const r = await processOneStripeId(subId, ctx);
      if (!summary.todaysUsersResync) summary.todaysUsersResync = [];
      summary.todaysUsersResync.push(r);
    }
  }

  if (vercelLogRows.length > 0) {
    try {
      summary.vercelLogInventory = buildVercelLogInventoryReport(vercelLogRows);
    } catch (e) {
      summary.vercelLogInventory = { error: e?.message || String(e) };
    }
  }

  if (options.rebuildMissingGenerationsFromLogCorrelation === true && vercelLogRows.length > 0) {
    summary.logCorrelationRestore = await restoreUserActivityFromLogsAndDatabaseHints({
      vercelLogRows,
      since,
      dryRun,
    });
  }

  if (options.recoverKieGenerations !== false) {
    const kieDry = options.dryRunKie !== false;
    summary.kie = await runKieLostGenerationReconcileAll({
      dryRun: dryRun && kieDry,
      limit: options.kieReconcileLimit || 500,
    });
  }

  return summary;
}
