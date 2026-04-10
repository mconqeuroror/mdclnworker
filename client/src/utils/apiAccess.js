/** Business tier + paid subscription — required for self-serve HTTP API keys. */
export function hasBusinessApiAccess(user) {
  if (!user) return false;
  const tier = String(user.subscriptionTier || '').toLowerCase();
  const status = String(user.subscriptionStatus || '').toLowerCase();
  const subscriptionActive = ['active', 'trialing'].includes(status);
  return tier === 'business' && subscriptionActive;
}
