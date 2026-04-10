/**
 * Hosts where generated/user assets are expected to live (direct browser fetch / URL allowlists).
 * Keep in sync with GET /api/download proxy allowlist.
 */
export function isAllowedPublicAssetHost(hostname) {
  const allowedDomains = [
    "r2.dev",
    "cloudfront.net",
    "wavespeed.ai",
    "replicate.delivery",
    "vercel-storage.com",
    /** Vercel Blob alternate host */
    "blob.vercel.app",
    /** User / gallery assets */
    "cloudinary.com",
  ];
  const lower = String(hostname || "").toLowerCase();
  return allowedDomains.some(
    (domain) => lower === domain || lower.endsWith(`.${domain}`),
  );
}

/** @returns {string} normalized href */
export function assertHttpsAllowedAssetUrl(urlString, label = "URL") {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  const isDev = process.env.NODE_ENV !== "production";
  const isLocal =
    u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (
    u.protocol !== "https:" &&
    !(isDev && isLocal && u.protocol === "http:")
  ) {
    throw new Error(`${label} must use https`);
  }
  if (isDev && isLocal) return u.href;
  if (!isAllowedPublicAssetHost(u.hostname)) {
    throw new Error(`${label} host is not allowed`);
  }
  return u.href;
}
