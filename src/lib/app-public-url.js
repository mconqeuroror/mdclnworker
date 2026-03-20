/**
 * Public HTTPS URL of the app (no trailing slash).
 * Used by FFmpeg worker → app callbacks (progress). Set on Vercel if VERCEL_URL is wrong for your domain.
 */
export function getPublicAppBaseUrl() {
  const explicit = (process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const v = (process.env.VERCEL_URL || "").trim();
  if (v) return `https://${v.replace(/^https?:\/\//, "")}`;
  return "";
}
