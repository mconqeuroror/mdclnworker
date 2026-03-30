const PIAPI_BASE_URL = process.env.PIAPI_BASE_URL || "https://api.piapi.ai/api/v1";
const PIAPI_API_KEY = process.env.PIAPI_API_KEY;

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function getPiApiCallbackUrl() {
  const explicit = process.env.PIAPI_CALLBACK_URL;
  if (explicit && typeof explicit === "string" && explicit.startsWith("http")) {
    return explicit.trim();
  }
  const callbackBase = process.env.CALLBACK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (callbackBase) {
    const base = stripTrailingSlash(callbackBase);
    const withProtocol = base.startsWith("http") ? base : `https://${base}`;
    return `${stripTrailingSlash(withProtocol)}/api/piapi/callback`;
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel) {
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

  const response = await fetch(`${stripTrailingSlash(PIAPI_BASE_URL)}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
    throw new Error(`PiAPI submit failed (${response.status}): ${(json?.message || text || "Unknown error").slice(0, 300)}`);
  }
  return {
    callbackUrl,
    data: json || { raw: text },
  };
}
