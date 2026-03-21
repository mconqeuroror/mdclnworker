# Stripe webhook (rebill / subscription callback)

Stripe calls our **callback URL** whenever events occur (e.g. payment succeeded, subscription renewed). We use it to match the user and assign **plan renewal + credits**.

## Callback URL

Configure this exact URL in **Stripe Dashboard → Developers → Webhooks → Add endpoint**:

```
https://YOUR_API_DOMAIN/api/stripe/webhook
```

Examples:

- Production: `https://api.modelclone.app/api/stripe/webhook` (or whatever your API base URL is)
- Test/local: use Stripe CLI or ngrok and point to your local URL, e.g. `https://xxxx.ngrok.io/api/stripe/webhook`

**Method:** `POST`  
**Content-Type:** `application/json`

Stripe sends a signed payload. We verify it with `STRIPE_WEBHOOK_SECRET` and then process the event.

## Events we use (subscribe these)

| Event | Purpose |
|-------|--------|
| **invoice.payment_succeeded** | **Rebills:** When Stripe charges for the next billing period, we add renewal credits and extend `creditsExpireAt`. |
| checkout.session.completed | First-time checkout (one-time or subscription). |
| payment_intent.succeeded | One-time payments, special offers, embedded-checkout safety nets. |
| customer.subscription.deleted | Cancel subscription → clear subscription state and credits. |
| customer.subscription.updated | If status is canceled/unpaid → clear subscription state. |
| charge.refunded | Refund → deduct credits and handle referral clawback. |

For **subscription renewals**, the critical event is **`invoice.payment_succeeded`**.

## Billing frequency vs credits (monthly vs annual)

- **Monthly plan** (`Stripe` recurring interval `month`): Stripe invoices **monthly**. Each paid invoice (`billing_reason` usually `subscription_cycle`) grants **`subscription.metadata.credits`** and **increments** `subscriptionCredits`.
- **Annual plan** (`Stripe` recurring interval `year`): Stripe invoices **once per year**. Each paid renewal grants the **same `metadata.credits` value** as the monthly tier (e.g. 2900 for Starter) **once per invoice** — i.e. **one grant per year**, not twelve. Product copy that describes “per month” refers to the **credit bundle size** matching the monthly tier, not to twelve separate Stripe invoices per year.

**Credit scaling:** `src/utils/creditUnits.js` — `normalizeCreditUnits()` maps legacy metadata (≤1000) to the current scale. All Stripe paths (checkout, webhook, `/confirm-subscription`, admin recovery) use this helper.

**Subscription metadata (hosted + embedded):** `userId`, `tierId`, `credits`, and **`billingCycle`** (`monthly` \| `annual`) on the subscription object. Older subs may omit `billingCycle`; code falls back to `subscription.items[0].plan.interval` (`month` → monthly, `year` → annual).

## What we do on rebill (`invoice.payment_succeeded`)

1. **Stripe sends:** `invoice` with:
   - `invoice.subscription` (subscription ID, or expanded object)
   - `invoice.id` (unique per charge — we use this for idempotency)
   - `invoice.billing_reason` (e.g. `subscription_create` first time, `subscription_cycle` for renewals)
   - `invoice.amount_paid`, etc.

2. **We:**
   - Resolve **subscription ID** (string or expanded object).
   - Find **user** by `stripeSubscriptionId`, or via `subscription.metadata.userId` if the DB row was never linked (safety net).
   - **Credits:** `normalizeCreditUnits(subscription.metadata.credits)`, or if missing, the **first positive `CreditTransaction`** for `paymentSessionId = subscriptionId`.
   - **Skip duplicate first payment:** if `billing_reason === subscription_create` and a transaction already exists with `paymentSessionId = subscriptionId`, skip (avoids double credit with `checkout.session.completed` / `/confirm-subscription`).
   - **Idempotency per invoice:** if a `CreditTransaction` exists with `paymentSessionId = invoice.id`, skip.
   - Insert a renewal transaction and **`increment`** `subscriptionCredits`; set **`creditsExpireAt`** from the Stripe plan interval (+1 month or +1 year).

## Env var

- **STRIPE_WEBHOOK_SECRET**  
  Signing secret for the webhook endpoint (from Stripe Dashboard → Webhooks → Select endpoint → Signing secret).  
  Required in production; without it we reject webhook requests.

## Quick check

- **GET** `https://YOUR_API_DOMAIN/api/stripe/webhook`  
  Returns a short JSON description of the callback URL and which events we use (for ops/support).
