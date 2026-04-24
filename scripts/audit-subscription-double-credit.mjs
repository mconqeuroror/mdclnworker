/**
 * Detect possible first-cycle double credits: invoice webhook used paymentSessionId=in_*
 * while checkout/confirm used sub_*, so two rows could exist for one first payment.
 *
 * Heuristic: same userId, same positive amount, created within --window-minutes,
 * one paymentSessionId starts with "in_", one with "sub_".
 *
 * Usage (from repo root, DB in .env):
 *   node scripts/audit-subscription-double-credit.mjs
 *   node scripts/audit-subscription-double-credit.mjs --window-minutes 30 --since 2024-01-01
 *
 * Does not modify data. Safe to run against a read replica.
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = { windowMinutes: 15, since: null };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--window-minutes") args.windowMinutes = parseFloat(argv[i + 1]) || 15;
    if (t === "--since") args.since = argv[i + 1] ? new Date(argv[i + 1]) : null;
  }
  return args;
}

function isInvoiceId(id) {
  return typeof id === "string" && id.startsWith("in_");
}
function isSubscriptionId(id) {
  return typeof id === "string" && id.startsWith("sub_");
}

function msBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime());
}

async function main() {
  const { windowMinutes, since } = parseArgs(process.argv.slice(2));
  const windowMs = windowMinutes * 60 * 1000;

  const where = {
    amount: { gt: 0 },
    paymentSessionId: { not: null },
    OR: [{ paymentSessionId: { startsWith: "in_" } }, { paymentSessionId: { startsWith: "sub_" } }],
  };
  if (since && !Number.isNaN(since.getTime())) {
    where.createdAt = { gte: since };
  }

  const txs = await prisma.creditTransaction.findMany({
    where,
    select: {
      id: true,
      userId: true,
      amount: true,
      type: true,
      description: true,
      paymentSessionId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  /** @type {Map<string, typeof txs>} */
  const byUser = new Map();
  for (const row of txs) {
    const k = row.userId;
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push(row);
  }

  const pairs = [];
  for (const [userId, list] of byUser) {
    const inv = list.filter((t) => isInvoiceId(t.paymentSessionId));
    const subs = list.filter((t) => isSubscriptionId(t.paymentSessionId));
    for (const a of inv) {
      for (const b of subs) {
        if (a.amount !== b.amount) continue;
        if (msBetween(a.createdAt, b.createdAt) > windowMs) continue;
        pairs.push({ userId, invoiceRow: a, subRow: b, deltaMs: msBetween(a.createdAt, b.createdAt) });
      }
    }
  }

  // Dedupe: same pair of paymentSessionIds only once
  const seen = new Set();
  const unique = [];
  for (const p of pairs) {
    const key = [p.invoiceRow.paymentSessionId, p.subRow.paymentSessionId].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  console.log(
    JSON.stringify(
      {
        meta: {
          windowMinutes,
          since: since?.toISOString() ?? null,
          totalTxScanned: txs.length,
          usersWithInvOrSubIds: byUser.size,
          suspectPairCount: unique.length,
          note:
            "Suspect = in_* and sub_* same amount within window. Review manually; some may be false positives (e.g. renewal + unrelated).",
        },
        suspects: unique.map((p) => ({
          userId: p.userId,
          deltaMs: p.deltaMs,
          amount: p.invoiceRow.amount,
          invoice: {
            id: p.invoiceRow.id,
            paymentSessionId: p.invoiceRow.paymentSessionId,
            description: p.invoiceRow.description,
            type: p.invoiceRow.type,
            createdAt: p.invoiceRow.createdAt.toISOString(),
          },
          subscription: {
            id: p.subRow.id,
            paymentSessionId: p.subRow.paymentSessionId,
            description: p.subRow.description,
            type: p.subRow.type,
            createdAt: p.subRow.createdAt.toISOString(),
          },
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
