/**
 * Backfill `User.stripeAccount` and `legacy*` Stripe id columns after running the
 * `20260420120000_dual_stripe_account` migration.
 *
 * The migration's UPDATE statement already covers the common case (anyone with a
 * stripeCustomerId is marked legacy and ids copied across). This script is a safety
 * net you can re-run if rows were inserted between migration apply and deploy, or if
 * you want to inspect/repair a subset.
 *
 * Usage:
 *   node scripts/backfill-stripe-account.js              # dry run
 *   node scripts/backfill-stripe-account.js --apply      # write changes
 *   node scripts/backfill-stripe-account.js --apply --user=USER_ID
 *
 * Idempotent: only touches rows where the legacy* columns are still empty.
 */
import prisma from "../src/lib/prisma.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const userArg = args.find((a) => a.startsWith("--user="));
const FILTER_USER_ID = userArg ? userArg.slice("--user=".length) : null;

async function main() {
  const where = FILTER_USER_ID ? { id: FILTER_USER_ID } : {};

  // Candidates: anyone with primary Stripe ids set but legacy* fields empty.
  // These are the rows the migration UPDATE already targeted; we re-process to be safe.
  const candidates = await prisma.user.findMany({
    where: {
      ...where,
      OR: [
        { stripeCustomerId: { not: null } },
        { stripeSubscriptionId: { not: null } },
      ],
      AND: [
        { legacyStripeCustomerId: null },
        { legacyStripeSubscriptionId: null },
      ],
    },
    select: {
      id: true,
      email: true,
      stripeAccount: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      legacyStripeCustomerId: true,
      legacyStripeSubscriptionId: true,
    },
  });

  console.log(`Found ${candidates.length} user(s) to backfill ${APPLY ? "(apply)" : "(dry-run)"}`);

  let updated = 0;
  let skipped = 0;

  for (const user of candidates) {
    const next = {
      stripeAccount: "legacy",
      legacyStripeCustomerId: user.stripeCustomerId,
      legacyStripeSubscriptionId: user.stripeSubscriptionId,
    };

    const isNoop =
      user.stripeAccount === next.stripeAccount &&
      user.legacyStripeCustomerId === next.legacyStripeCustomerId &&
      user.legacyStripeSubscriptionId === next.legacyStripeSubscriptionId;

    if (isNoop) {
      skipped += 1;
      continue;
    }

    console.log(
      `→ ${user.email} (${user.id}): account=${user.stripeAccount} → ${next.stripeAccount}, customer=${user.stripeCustomerId}, sub=${user.stripeSubscriptionId}`,
    );

    if (APPLY) {
      await prisma.user.update({
        where: { id: user.id },
        data: next,
      });
      updated += 1;
    }
  }

  console.log("");
  console.log(`Done. Updated: ${updated}, skipped (already correct): ${skipped}, total scanned: ${candidates.length}`);

  // Sanity report — distribution after backfill
  const counts = await prisma.user.groupBy({
    by: ["stripeAccount"],
    _count: { id: true },
  });
  console.log("Stripe account distribution:");
  for (const row of counts) {
    console.log(`  ${row.stripeAccount}: ${row._count.id}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
