# Dual-Stripe Account Setup (Legacy + US LLC)

This deployment talks to **two Stripe accounts** at the same time:

| Account     | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| **LEGACY**  | Old Stripe account. Continues to rebill grandfathered subscriptions.    |
| **NEW**     | New US LLC Stripe account. Handles all new credit purchases, all new subscriptions, upgrades, downgrades, and special-offer purchases. |

A user record's `User.stripeAccount` column tells the code which account currently owns that user's primary customer + subscription. New signups default to `new`. Existing paying users were marked `legacy` by the migration; their old IDs were copied into `legacyStripeCustomerId` / `legacyStripeSubscriptionId`.

Once a legacy user upgrades or makes any new purchase, they are migrated:
- `stripeAccount` is flipped to `new`
- their old IDs are preserved in `legacy*` columns
- the old subscription is cancelled on the **legacy** account after the new payment succeeds

---

## 1. Environment variables

Add these to your production env (Vercel / Easypanel / etc.).

### LEGACY account (must already be set; keeps rebills alive)

```
STRIPE_LEGACY_SECRET_KEY=sk_live_...                       # was STRIPE_SECRET_KEY
STRIPE_LEGACY_WEBHOOK_SECRET=whsec_...                     # was STRIPE_WEBHOOK_SECRET
TESTING_STRIPE_LEGACY_SECRET_KEY=sk_test_...               # was TESTING_STRIPE_SECRET_KEY
```

> **Backwards-compat:** if you don't rename, the code falls back to the original `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `TESTING_STRIPE_SECRET_KEY` and treats them as LEGACY. You can rename later.

### NEW (US LLC) account

```
STRIPE_NEW_SECRET_KEY=sk_live_...
STRIPE_NEW_WEBHOOK_SECRET=whsec_...
TESTING_STRIPE_NEW_SECRET_KEY=sk_test_...
```

### Feature flag (optional)

```
STRIPE_NEW_ACCOUNT_ENABLED=true        # default true
```

Set this to `false` to instantly route every new operation back to LEGACY — rollback switch in case something is wrong with the new account on launch day.

---

## 2. Stripe Dashboard setup — webhook endpoints to enable

Both accounts must point at this app. Add them in **Stripe Dashboard → Developers → Webhooks → Add endpoint**.

### LEGACY account webhook

- **Endpoint URL:** `https://<your-domain>/api/stripe/webhook/legacy`
- **API version:** match the rest of your account
- **Events to send (these are the ones we react to):**
  - `invoice.payment_succeeded`         ← rebills (the most important one!)
  - `checkout.session.completed`
  - `payment_intent.succeeded`
  - `customer.subscription.deleted`
  - `customer.subscription.updated`
  - `charge.refunded`
- Copy the resulting **Signing secret** → set as `STRIPE_LEGACY_WEBHOOK_SECRET`

### NEW (US LLC) account webhook

- **Endpoint URL:** `https://<your-domain>/api/stripe/webhook`
- **Events to send (identical list):**
  - `invoice.payment_succeeded`
  - `checkout.session.completed`
  - `payment_intent.succeeded`
  - `customer.subscription.deleted`
  - `customer.subscription.updated`
  - `charge.refunded`
- Copy the resulting **Signing secret** → set as `STRIPE_NEW_WEBHOOK_SECRET`

> ✅ Both webhooks listen for the **same six events** — the only difference is which account they originate from.

### Customer Portal — enable on NEW account

In the NEW account: **Settings → Billing → Customer Portal**, enable:

- View / download invoices
- Update payment method
- Cancel subscriptions (recommended: cancel at period end)
- Switch plans (optional; not required since we drive plan changes from our UI)

LEGACY portal is already configured (no change needed). Users on legacy still get the legacy portal automatically based on `User.stripeAccount`.

---

## 3. Code surface

| Concern                              | Routes / files                                                          |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Stripe client factory                | `src/lib/stripeClients.js`                                              |
| Always-NEW endpoints (create-*)      | `src/routes/stripe.routes.js` — uses `stripeNew()` and `ensureNewAccountCustomer()` |
| Account-aware endpoints              | `cancel-subscription`, `create-portal-session`, `subscription-status`, `sync-subscription` route by `accountForUser(user)` |
| Webhook NEW                          | `POST /api/stripe/webhook` → `buildWebhookHandler("new")`              |
| Webhook LEGACY                       | `POST /api/stripe/webhook/legacy` → `buildWebhookHandler("legacy")`    |
| Account-aware user lookups in webhook| `userWhereForSubscription` / `userWhereForCustomer`                     |
| Refund routing                       | `src/controllers/admin.controller.js` → `refundByPaymentSessionId` resolves account from `creditTransactions.stripeAccount` and falls back across accounts |
| Schema additions                     | `User.stripeAccount`, `User.legacyStripeCustomerId`, `User.legacyStripeSubscriptionId`, `CreditTransaction.stripeAccount` |
| Migration                            | `prisma/migrations/20260420120000_dual_stripe_account/migration.sql`    |
| Backfill safety net                  | `node scripts/backfill-stripe-account.js --apply`                       |

---

## 4. Deployment order

1. Deploy this code (env vars can stay legacy-only; behavior is unchanged).
2. Apply the Prisma migration.
3. (Optional) Run `node scripts/backfill-stripe-account.js --apply` to verify backfill.
4. In Stripe Dashboard, create both webhook endpoints (legacy + new) and copy their signing secrets.
5. Add `STRIPE_NEW_SECRET_KEY` and `STRIPE_NEW_WEBHOOK_SECRET` to production env. Optionally rename `STRIPE_SECRET_KEY` → `STRIPE_LEGACY_SECRET_KEY` (and the matching test/webhook vars).
6. Redeploy. From this point forward, all new charges land on the NEW account; legacy keeps rebilling.

---

## 5. What to watch on launch day

- `📨 Received webhook event [legacy]: invoice.payment_succeeded` — confirms LEGACY rebills still flow.
- `📨 Received webhook event [new]: payment_intent.succeeded` — confirms NEW account is collecting first new charge.
- For a legacy user that upgrades: log line `🚀 UPGRADE detected ... old subscription will be cancelled after successful payment` should be followed by `✅ Cancelled old subscription sub_xxx after successful upgrade` from the legacy SDK.
- `User.stripeAccount` should slowly shift from `legacy` → `new` over weeks as legacy customers rebill, upgrade, or churn.
