import Stripe from "stripe";

/**
 * Dual-Stripe-account routing.
 *
 * "legacy" = old Stripe account (pre-USLLC). Continues to handle rebills, cancels,
 *           refunds, portal sessions for users created before the cutover.
 * "new"    = US LLC Stripe account. All new credit packs, all new subscriptions,
 *           all upgrades/downgrades, all special-offer purchases.
 *
 * Env mapping (all optional fallbacks so existing single-account deployments keep working):
 *
 *   Legacy (old account — must already exist for rebills):
 *     STRIPE_LEGACY_SECRET_KEY            (falls back to STRIPE_SECRET_KEY)
 *     STRIPE_LEGACY_WEBHOOK_SECRET        (falls back to STRIPE_WEBHOOK_SECRET)
 *     TESTING_STRIPE_LEGACY_SECRET_KEY    (falls back to TESTING_STRIPE_SECRET_KEY)
 *
 *   New (US LLC):
 *     STRIPE_NEW_SECRET_KEY
 *     STRIPE_NEW_WEBHOOK_SECRET
 *     TESTING_STRIPE_NEW_SECRET_KEY
 *
 *   Feature flag:
 *     STRIPE_NEW_ACCOUNT_ENABLED=true   (when false, every user/operation is forced to legacy)
 */

const STRIPE_API_VERSION = "2024-11-20.acacia";

const isProd = process.env.NODE_ENV === "production";

function pickKey(prodKey, testKey) {
  return isProd ? process.env[prodKey] : process.env[testKey];
}

function resolveLegacySecret() {
  return (
    pickKey("STRIPE_LEGACY_SECRET_KEY", "TESTING_STRIPE_LEGACY_SECRET_KEY") ||
    // Backwards-compat: existing deployments only have STRIPE_SECRET_KEY set,
    // and that key currently belongs to the legacy account.
    pickKey("STRIPE_SECRET_KEY", "TESTING_STRIPE_SECRET_KEY") ||
    null
  );
}

function resolveNewSecret() {
  return pickKey("STRIPE_NEW_SECRET_KEY", "TESTING_STRIPE_NEW_SECRET_KEY") || null;
}

function newAccountEnabled() {
  const raw = String(process.env.STRIPE_NEW_ACCOUNT_ENABLED ?? "true").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

const cache = {
  legacy: null,
  new: null,
};

function buildStripe(secretKey) {
  if (!secretKey) return null;
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 30_000,
    maxNetworkRetries: 1,
  });
}

/**
 * Returns a configured Stripe SDK instance for the given account, or null if the account
 * is not configured. Callers that REQUIRE a client should throw if the result is null.
 */
export function getStripeForAccount(account) {
  const normalized = normalizeAccount(account);
  if (cache[normalized]) return cache[normalized];

  if (normalized === "legacy") {
    cache.legacy = buildStripe(resolveLegacySecret());
    return cache.legacy;
  }

  if (!newAccountEnabled()) {
    // Feature flag forces all "new" lookups back to legacy so we can roll out / roll back safely.
    return getStripeForAccount("legacy");
  }

  cache.new = buildStripe(resolveNewSecret());
  return cache.new;
}

/**
 * Returns the account a given user record currently belongs to.
 * Defaults to "new" if missing (forward-compat for fresh signups).
 */
export function accountForUser(user) {
  if (!user) return "new";
  const raw = String(user.stripeAccount || "").toLowerCase();
  if (raw === "legacy" || raw === "new") return raw;
  // Anyone with legacy IDs but unset marker is treated as legacy until proven otherwise.
  if (user.legacyStripeCustomerId || user.legacyStripeSubscriptionId) return "legacy";
  if (user.stripeCustomerId && !newAccountEnabled()) return "legacy";
  return "new";
}

export function getStripeForUser(user) {
  return getStripeForAccount(accountForUser(user));
}

/**
 * Returns the account that owns the given Stripe entity for this user.
 * Used by routes like /cancel-subscription where we route by the *subscription's* account,
 * not necessarily the user's primary marker.
 */
export function accountForUserSubscription(user, subscriptionId) {
  if (!user || !subscriptionId) return accountForUser(user);
  if (user.legacyStripeSubscriptionId === subscriptionId) return "legacy";
  if (user.stripeSubscriptionId === subscriptionId) return accountForUser(user);
  return accountForUser(user);
}

export function accountForUserCustomer(user, customerId) {
  if (!user || !customerId) return accountForUser(user);
  if (user.legacyStripeCustomerId === customerId) return "legacy";
  return accountForUser(user);
}

/**
 * Webhook secret for the named account (for signature verification).
 */
export function getWebhookSecretForAccount(account) {
  const normalized = normalizeAccount(account);
  if (normalized === "legacy") {
    return (
      process.env.STRIPE_LEGACY_WEBHOOK_SECRET ||
      // Backwards-compat — existing deployments may only have STRIPE_WEBHOOK_SECRET set
      // and that secret currently belongs to the legacy account.
      process.env.STRIPE_WEBHOOK_SECRET ||
      null
    );
  }
  return process.env.STRIPE_NEW_WEBHOOK_SECRET || null;
}

export function isAccount(value) {
  return value === "legacy" || value === "new";
}

export function normalizeAccount(value) {
  const raw = String(value || "").toLowerCase();
  return isAccount(raw) ? raw : "new";
}

/**
 * Diagnostic helper for /admin & startup logs.
 */
export function describeStripeAccountConfig() {
  return {
    legacy: {
      configured: Boolean(resolveLegacySecret()),
      webhookSecretConfigured: Boolean(getWebhookSecretForAccount("legacy")),
    },
    new: {
      configured: Boolean(resolveNewSecret()),
      webhookSecretConfigured: Boolean(getWebhookSecretForAccount("new")),
      enabled: newAccountEnabled(),
    },
  };
}
