/**
 * URL for RunPod serverless `webhook` on POST /run (job completion callback).
 *
 * Priority:
 * 1. RUNPOD_WEBHOOK_URL — full URL if set (may include ?secret=...)
 * 2. Derived: {public app base}/api/runpod/callback — same base resolution as KIE callbacks
 *    If RUNPOD_WEBHOOK_SECRET is set, appends ?secret=... for verifyWebhook in runpod-callback.routes.js
 */

export function resolveRunpodWebhookUrl() {
  const explicit = process.env.RUNPOD_WEBHOOK_URL?.trim();
  if (explicit) return explicit;

  const secret = process.env.RUNPOD_WEBHOOK_SECRET?.trim();

  const callbackBase = process.env.CALLBACK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  let path = null;
  if (callbackBase) {
    const base = callbackBase.replace(/\/$/, "").trim();
    const withProtocol = base.startsWith("http") ? base : `https://${base}`;
    path = `${withProtocol.replace(/\/$/, "")}/api/runpod/callback`;
  } else {
    const baseUrl = process.env.APP_PUBLIC_URL || process.env.PUBLIC_URL || process.env.APP_URL;
    if (baseUrl) {
      const host = baseUrl.replace(/\/$/, "").replace(/^https?:\/\//, "").split("/")[0];
      const protocol = baseUrl.trim().toLowerCase().startsWith("http:") ? "http" : "https";
      path = `${protocol}://${host}/api/runpod/callback`;
    } else {
      const vercel = process.env.VERCEL_URL;
      if (vercel) {
        path = `https://${vercel.replace(/^https?:\/\//, "").split("/")[0]}/api/runpod/callback`;
      }
    }
  }

  if (!path) return null;
  if (!secret) return path;
  try {
    const u = new URL(path);
    u.searchParams.set("secret", secret);
    return u.toString();
  } catch {
    return `${path}${path.includes("?") ? "&" : "?"}secret=${encodeURIComponent(secret)}`;
  }
}
