const PIAPI_API_KEY = process.env.PIAPI_API_KEY;

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

/**
 * PiAPI docs show "base URL" as https://api.piapi.ai but tasks are POSTed to …/api/v1/task.
 * If PIAPI_BASE_URL is set to the host only (common copy-paste), requests hit /task and return 404.
 */
function resolvePiApiBaseUrl() {
  let raw = (process.env.PIAPI_BASE_URL || "https://api.piapi.ai/api/v1").trim();
  if (!raw) raw = "https://api.piapi.ai/api/v1";
  let base = stripTrailingSlash(raw);
  // Full endpoint was pasted into the env by mistake
  if (/\/task$/i.test(base)) {
    base = stripTrailingSlash(base.replace(/\/task$/i, ""));
  }
  if (!/\/api\/v\d+(\/|$)/i.test(base)) {
    base = `${base}/api/v1`;
  }
  return stripTrailingSlash(base);
}

export function getPiApiCallbackUrl() {
  // Explicit override wins.
  const explicit = process.env.PIAPI_CALLBACK_URL;
  if (explicit && typeof explicit === "string" && explicit.startsWith("http")) {
    return explicit.trim();
  }
  // Stable custom base URL (set this in Vercel env vars so it never changes between deployments).
  const callbackBase = process.env.CALLBACK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (callbackBase) {
    const base = stripTrailingSlash(callbackBase);
    const withProtocol = base.startsWith("http") ? base : `https://${base}`;
    return `${stripTrailingSlash(withProtocol)}/api/piapi/callback`;
  }
  // VERCEL_PROJECT_PRODUCTION_URL is the stable production alias (e.g. mdcln-testing.vercel.app).
  // It does NOT change between deployments, unlike VERCEL_URL which is deployment-specific.
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) {
    return `https://${stripTrailingSlash(productionUrl)}/api/piapi/callback`;
  }
  // Last resort: deployment-specific URL (changes every push — avoid relying on this).
  const vercel = process.env.VERCEL_URL;
  if (vercel) {
    console.warn("[PiAPI] Using deployment-specific VERCEL_URL for callback. Set CALLBACK_BASE_URL to the production alias for reliability.");
    return `https://${stripTrailingSlash(vercel)}/api/piapi/callback`;
  }
  return null;
}

/**
 * PiAPI submission wrapper for all future PiAPI generations.
 * Enforces callback-only completion by always attaching callback URL.
 */
export async function submitPiApiTask(taskPayload, { endpoint = "/task" } = {}) {
  if (!PIAPI_API_KEY) {
    throw new Error("PIAPI_API_KEY is not configured");
  }

  const callbackUrl = getPiApiCallbackUrl();
  if (!callbackUrl) {
    throw new Error("PiAPI callback URL is required (set PIAPI_CALLBACK_URL or CALLBACK_BASE_URL)");
  }

  const webhookSecret = (process.env.PIAPI_WEBHOOK_SECRET || "").trim();
  const basePayload = taskPayload && typeof taskPayload === "object" ? taskPayload : {};
  const existingConfig = basePayload.config && typeof basePayload.config === "object" ? basePayload.config : {};
  const existingWebhookConfig = existingConfig.webhook_config && typeof existingConfig.webhook_config === "object"
    ? existingConfig.webhook_config
    : {};

  const payload = {
    ...basePayload,
    // Unified API schema webhook config (required for reliable callbacks).
    config: {
      ...existingConfig,
      webhook_config: {
        ...existingWebhookConfig,
        endpoint: callbackUrl,
        secret: webhookSecret || existingWebhookConfig.secret || "",
      },
    },
    // Keep both key variants too for compatibility across families.
    callbackUrl,
    callback_url: callbackUrl,
  };

  const baseUrl = resolvePiApiBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // PiAPI unified API expects X-API-Key (see piapi.ai/docs/quickstart).
      "X-API-Key": PIAPI_API_KEY,
      Authorization: `Bearer ${PIAPI_API_KEY}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text in error path below.
  }
  if (!response.ok) {
    const hint = response.status === 404
      ? ` (POST ${url} — check PIAPI_BASE_URL includes /api/v1, e.g. https://api.piapi.ai/api/v1)`
      : "";
    throw new Error(`PiAPI submit failed (${response.status}): ${(json?.message || text || "Unknown error").slice(0, 300)}${hint}`);
  }
  return {
    callbackUrl,
    data: json || { raw: text },
  };
}
