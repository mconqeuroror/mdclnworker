/**
 * Shared credit scaling for Stripe metadata, checkout, webhooks, and admin tools.
 * Legacy purchases/subscriptions used ≤1000 raw units; we multiply by 10 for parity with current tiers.
 *
 * @param {string|number|null|undefined} rawCredits
 * @returns {number}
 */
export function normalizeCreditUnits(rawCredits) {
  const parsed = parseInt(String(rawCredits ?? "0"), 10) || 0;
  if (parsed > 0 && parsed <= 1000) return parsed * 10;
  return parsed;
}

/**
 * `billingCycle` is stored on subscription metadata for embedded checkout; hosted Checkout
 * historically omitted it — derive from Stripe plan interval when missing.
 *
 * @param {{ metadata?: Record<string, string>, items?: { data?: Array<{ plan?: { interval?: string } }> } }} subscription
 * @returns {"monthly"|"annual"}
 */
export function resolveSubscriptionBillingCycle(subscription) {
  const m = subscription?.metadata?.billingCycle;
  if (m === "annual" || m === "monthly") return m;
  const interval = subscription?.items?.data?.[0]?.plan?.interval;
  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return "monthly";
}
