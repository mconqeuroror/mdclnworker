/**
 * Reconcile User + CreditTransaction (subscription row) from Stripe for each sub_*
 * listed in a vercel-billing-extract report (or explicit --sub ids).
 *
 * Source of truth: Stripe (not Vercel). Vercel log export only *lists* which subs
 * appeared in URLs/messages; this script fetches each subscription and updates DB.
 *
 * Usage:
 *   set DATABASE_URL=...  (or .env)
 *   set STRIPE_NEW_SECRET_KEY=...  STRIPE_LEGACY_SECRET_KEY=... (at least one)
 *   node scripts/reconcile-subs-from-vercel-extract.mjs [path-to-vercel-billing-extract.json] [--apply]
 *
 * Default is dry-run (prints plans). Add --apply to write.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import {
  normalizeCreditUnits,
  resolveSubscriptionBillingCycle,
  inferSubscriptionCreditsFromAmount,
} from "../src/utils/creditUnits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();

const STRIPE_VERSION = "2024-11-20.acacia";

const prisma = new PrismaClient();

function parseArgs() {
  const rest = process.argv.slice(2).filter((a) => a !== "--apply");
  const apply = process.argv.includes("--apply");
  const reportPath =
    rest[0] ||
    path.join(process.cwd(), "tmp", "vercel-billing-extract.json");
  return { reportPath: path.resolve(reportPath), apply };
}

function makeStripe(key) {
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_VERSION, timeout: 60_000 });
}

function getClients() {
  const isProd = process.env.NODE_ENV === "production";
  const newKey = isProd
    ? process.env.STRIPE_NEW_SECRET_KEY
    : process.env.TESTING_STRIPE_NEW_SECRET_KEY || process.env.STRIPE_NEW_SECRET_KEY;
  const legacyKey =
    (isProd
      ? process.env.STRIPE_LEGACY_SECRET_KEY || process.env.STRIPE_SECRET_KEY
      : process.env.TESTING_STRIPE_LEGACY_SECRET_KEY ||
        process.env.STRIPE_LEGACY_SECRET_KEY ||
        process.env.STRIPE_SECRET_KEY) || null;
  return { newStripe: makeStripe(newKey), legacyStripe: makeStripe(legacyKey) };
}

async function retrieveSubscription(subId, { newStripe, legacyStripe }) {
  if (newStripe) {
    try {
      const sub = await newStripe.subscriptions.retrieve(subId, {
        expand: ["customer", "latest_invoice"],
      });
      return { sub, account: "new" };
    } catch (e) {
      if (e.code !== "resource_missing") throw e;
    }
  }
  if (legacyStripe) {
    const sub = await legacyStripe.subscriptions.retrieve(subId, {
      expand: ["customer", "latest_invoice"],
    });
    return { sub, account: "legacy" };
  }
  throw new Error("No Stripe secret keys configured");
}

function mapStatus(stripeStatus) {
  if (!stripeStatus) return "trial";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired")
    return "cancelled";
  if (stripeStatus === "active") return "active";
  if (stripeStatus === "trialing") return "trialing";
  if (stripeStatus === "past_due") return "past_due";
  return stripeStatus;
}

function buildCreditsExpire(sub) {
  const t = sub?.current_period_end;
  if (!t) return null;
  return new Date(t * 1000);
}

function resolveCreditsForSub(sub) {
  const meta = sub.metadata || {};
  const fromMeta = normalizeCreditUnits(meta.credits);
  if (fromMeta > 0) return fromMeta;
  const priceCents =
    sub.items?.data?.[0]?.price?.unit_amount ||
    sub.items?.data?.[0]?.plan?.amount ||
    0;
  const cycle = resolveSubscriptionBillingCycle(sub);
  return (
    inferSubscriptionCreditsFromAmount(priceCents, cycle) ||
    normalizeCreditUnits(0)
  );
}

function collectSubIdsFromReport(report) {
  const fromSummary = (report.stripeIdSummary || [])
    .map((x) => x.id)
    .filter((id) => typeof id === "string" && id.startsWith("sub_"));
  return [...new Set(fromSummary)];
}

async function main() {
  const { reportPath, apply } = parseArgs();
  if (!fs.existsSync(reportPath)) {
    console.error("Report not found:", reportPath);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const subIds = collectSubIdsFromReport(report);
  console.log(`Sub IDs to process: ${subIds.length}\n`);

  const clients = getClients();
  if (!clients.newStripe && !clients.legacyStripe) {
    console.error(
      "Set STRIPE_NEW_SECRET_KEY and/or STRIPE_SECRET_KEY (legacy) in .env",
    );
    process.exit(1);
  }

  for (const subId of subIds) {
    let retrieved;
    try {
      retrieved = await retrieveSubscription(subId, clients);
    } catch (e) {
      console.error(`❌ ${subId} retrieve failed:`, e.message);
      continue;
    }
    const { sub, account } = retrieved;
    const userId = sub.metadata?.userId;
    if (!userId) {
      console.error(`❌ ${subId} missing metadata.userId in Stripe`);
      continue;
    }
    const tierId = sub.metadata?.tierId || "pro";
    const billingCycle = resolveSubscriptionBillingCycle(sub);
    const subCredits = resolveCreditsForSub(sub);
    const status = mapStatus(sub.status);
    const idempotencyKey = subId;

    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u) {
      console.error(`❌ user ${userId} not in DB (sub ${subId})`);
      continue;
    }

    const txExists = await prisma.creditTransaction.findUnique({
      where: { paymentSessionId: idempotencyKey },
    });

    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

    const subRow = {
      subscriptionTier: tierId,
      subscriptionStatus: status,
      subscriptionBillingCycle: billingCycle,
      subscriptionCredits: subCredits,
      creditsExpireAt: buildCreditsExpire(sub),
      maxModels: 999,
    };

    console.log(
      `--- ${subId} user=${userId} account=${account} status=${sub.status} tier=${tierId} credits=${subCredits} cus=${customerId} txRow=${txExists ? "yes" : "no"}`,
    );

    if (!apply) {
      console.log("  (dry-run) would update user + create tx if missing\n");
      continue;
    }

    await prisma.$transaction(async (db) => {
      if (!txExists) {
        await db.creditTransaction.create({
          data: {
            userId,
            amount: subCredits,
            type: "purchase",
            description: `Subscription restore: ${tierId} (${subId})`,
            paymentSessionId: idempotencyKey,
            stripeAccount: account,
          },
        });
      }
      if (account === "new") {
        await db.user.update({
          where: { id: userId },
          data: {
            ...subRow,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            stripeAccount: "new",
          },
        });
      } else {
        await db.user.update({
          where: { id: userId },
          data: {
            ...subRow,
            stripeAccount: "legacy",
            legacyStripeCustomerId: customerId,
            legacyStripeSubscriptionId: subId,
          },
        });
      }
    });
    console.log("  applied\n");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
