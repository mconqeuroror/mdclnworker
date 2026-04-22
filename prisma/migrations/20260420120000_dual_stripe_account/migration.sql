-- Dual Stripe account support: legacy (old account, grandfathered subs) + new (US LLC, all new business).
-- Backfill: every user that already has a stripeCustomerId is treated as legacy until they purchase
-- something on the new account. New users default to "new".

ALTER TABLE "User"
  ADD COLUMN     "stripeAccount" TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN     "legacyStripeCustomerId" TEXT,
  ADD COLUMN     "legacyStripeSubscriptionId" TEXT;

-- Backfill: anyone with a stripeCustomerId today is on the legacy account
-- (the new US LLC account did not exist when those rows were created).
UPDATE "User"
SET "stripeAccount" = 'legacy',
    "legacyStripeCustomerId" = "stripeCustomerId",
    "legacyStripeSubscriptionId" = "stripeSubscriptionId"
WHERE "stripeCustomerId" IS NOT NULL;

-- Unique constraints (mirror the existing primary columns).
CREATE UNIQUE INDEX "User_legacyStripeCustomerId_key"
  ON "User"("legacyStripeCustomerId");
CREATE UNIQUE INDEX "User_legacyStripeSubscriptionId_key"
  ON "User"("legacyStripeSubscriptionId");

-- CreditTransaction: tag each Stripe-derived transaction with the originating account.
ALTER TABLE "CreditTransaction"
  ADD COLUMN "stripeAccount" TEXT;

CREATE INDEX "CreditTransaction_stripeAccount_idx"
  ON "CreditTransaction"("stripeAccount");
