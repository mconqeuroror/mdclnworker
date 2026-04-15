/**
 * URL for RunPod serverless `webhook` on POST /run (job completion callback).
 *
 * Priority:
 * 1. RUNPOD_WEBHOOK_URL — full URL if set (may include ?secret=...)
 * 2. Derived: {public app base}/api/runpod/callback — same base resolution as KIE callbacks
 *    If RUNPOD_WEBHOOK_SECRET is set, appends ?secret=... for verifyWebhook in runpod-callback.routes.js
 */

export function resolveRunpodWebhookUrl(extraQueryParams = null) {
  const secret = process.env.RUNPOD_WEBHOOK_SECRET?.trim();
  const explicit = process.env.RUNPOD_WEBHOOK_URL?.trim();

  let path = null;
  if (explicit) {
    path = explicit;
  } else {
    const callbackBase = process.env.CALLBACK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
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
  }

  if (!path) return null;
  if (path.startsWith("http://localhost")) {
    console.warn("[callback] RunPod resolved to localhost — falling back to poll");
    return null;
  }

  try {
    const u = new URL(path);
    if (secret) {
      u.searchParams.set("secret", secret);
    }
    if (extraQueryParams && typeof extraQueryParams === "object") {
      for (const [key, value] of Object.entries(extraQueryParams)) {
        if (value == null || value === "") continue;
        u.searchParams.set(key, String(value));
      }
    }
    return u.toString();
  } catch {
    let next = path;
    if (secret) {
      next += `${next.includes("?") ? "&" : "?"}secret=${encodeURIComponent(secret)}`;
    }
    if (extraQueryParams && typeof extraQueryParams === "object") {
      for (const [key, value] of Object.entries(extraQueryParams)) {
        if (value == null || value === "") continue;
        next += `${next.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
      }
    }
    return next;
  }
}
