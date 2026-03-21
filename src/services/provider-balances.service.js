/**
 * Read-only balance / account probes for external AI providers.
 * Uses env API keys server-side only — never expose keys to clients.
 */

const TIMEOUT_MS = 18_000;

function notConfigured(id, name) {
  return {
    id,
    name,
    configured: false,
    status: "not_configured",
    headline: "—",
    lines: [],
    error: null,
  };
}

function okRow(id, name, headline, lines = []) {
  return {
    id,
    name,
    configured: true,
    status: "ok",
    headline,
    lines,
    error: null,
  };
}

function errRow(id, name, configured, message, httpStatus) {
  return {
    id,
    name,
    configured,
    status: "error",
    headline: "—",
    lines: [],
    error: message || "Request failed",
    httpStatus: httpStatus ?? null,
  };
}

async function safeJson(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchKieBalance() {
  const id = "kie";
  const name = "KIE (kie.ai)";
  const key = process.env.KIE_API_KEY;
  if (!key?.trim()) return notConfigured(id, name);
  try {
    const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
      method: "GET",
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await safeJson(res);
    if (json?.code === 200 && typeof json.data === "number") {
      return okRow(id, name, `${json.data.toLocaleString()} credits`, [
        { label: "API", value: "Remaining account credits (KIE)" },
      ]);
    }
    const msg = json?.msg || json?.message || res.statusText || "Unknown error";
    return errRow(id, name, true, `${msg} (HTTP ${res.status})`, res.status);
  } catch (e) {
    return errRow(id, name, true, e?.message || "Network error", null);
  }
}

export async function fetchOpenRouterBalance() {
  const id = "openrouter";
  const name = "OpenRouter";
  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) return notConfigured(id, name);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      method: "GET",
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await safeJson(res);
    if (res.ok && json?.data && typeof json.data === "object") {
      const { total_credits: purchased, total_usage: used } = json.data;
      const remaining =
        typeof purchased === "number" && typeof used === "number"
          ? Math.max(0, purchased - used)
          : null;
      const lines = [];
      if (typeof purchased === "number") lines.push({ label: "Purchased", value: String(purchased) });
      if (typeof used === "number") lines.push({ label: "Used", value: String(used) });
      const headline =
        remaining != null
          ? `~${remaining.toFixed(2)} remaining (credits)`
          : "Credits loaded (see breakdown)";
      return okRow(id, name, headline, lines);
    }
    const errMsg = json?.error?.message || json?.message || res.statusText;
    if (res.status === 403) {
      return errRow(
        id,
        name,
        true,
        `${errMsg || "Forbidden"} — OpenRouter may require a management API key for /credits.`,
        res.status,
      );
    }
    return errRow(id, name, true, `${errMsg || "Bad response"} (HTTP ${res.status})`, res.status);
  } catch (e) {
    return errRow(id, name, true, e?.message || "Network error", null);
  }
}

export async function fetchFalBalance() {
  const id = "fal";
  const name = "fal.ai";
  const key = (process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
  if (!key) return notConfigured(id, name);
  try {
    const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      method: "GET",
      headers: { Authorization: `Key ${key.trim()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await safeJson(res);
    if (res.ok && json?.username) {
      const bal = json.credits?.current_balance;
      const cur = json.credits?.currency || "USD";
      const headline =
        typeof bal === "number" ? `${bal} ${cur}` : "Connected (no credit expand)";
      const lines = [{ label: "Account", value: String(json.username) }];
      if (typeof bal === "number") lines.push({ label: "Balance", value: `${bal} ${cur}` });
      return okRow(id, name, headline, lines);
    }
    const msg = json?.error?.message || json?.message || res.statusText;
    return errRow(id, name, true, `${msg || "Unauthorized"} (HTTP ${res.status})`, res.status);
  } catch (e) {
    return errRow(id, name, true, e?.message || "Network error", null);
  }
}

export async function fetchWaveSpeedBalance() {
  const id = "wavespeed";
  const name = "WaveSpeed AI";
  const key = process.env.WAVESPEED_API_KEY;
  if (!key?.trim()) return notConfigured(id, name);
  try {
    const res = await fetch("https://api.wavespeed.ai/api/v3/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await safeJson(res);
    if (json?.code === 200 && json.data && typeof json.data.balance === "number") {
      return okRow(id, name, `$${Number(json.data.balance).toFixed(2)} USD`, [
        { label: "Balance", value: `USD ${json.data.balance}` },
      ]);
    }
    const msg = json?.message || json?.msg || res.statusText;
    return errRow(id, name, true, `${msg || "Bad response"} (HTTP ${res.status})`, res.status);
  } catch (e) {
    return errRow(id, name, true, e?.message || "Network error", null);
  }
}

export async function fetchApifyAccount() {
  const id = "apify";
  const name = "Apify";
  const key = process.env.APIFY_API_TOKEN;
  if (!key?.trim()) return notConfigured(id, name);
  try {
    const res = await fetch("https://api.apify.com/v2/users/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await safeJson(res);
    const user = json?.data || json;
    if (res.ok && user && (user.username || user.id)) {
      const lines = [
        { label: "Username", value: String(user.username || user.id) },
      ];
      if (user.email) lines.push({ label: "Email", value: String(user.email) });
      if (user.plan?.id) lines.push({ label: "Plan", value: String(user.plan.id) });
      return okRow(id, name, user.username ? `@${user.username}` : "Account OK", lines);
    }
    const msg = json?.error?.message || res.statusText;
    return errRow(id, name, true, `${msg || "Bad response"} (HTTP ${res.status})`, res.status);
  } catch (e) {
    return errRow(id, name, true, e?.message || "Network error", null);
  }
}

export async function fetchElevenLabsUser() {
  const id = "elevenlabs";
  const name = "ElevenLabs";
  const key = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY || "").trim();
  if (!key) return notConfigured(id, name);
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      method: "GET",
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await safeJson(res);
    if (res.ok && json) {
      const sub = json.subscription || {};
      const chars = json.character_count != null ? String(json.character_count) : null;
      const limit = json.character_limit != null ? String(json.character_limit) : null;
      const lines = [];
      if (chars != null && limit != null) {
        lines.push({ label: "Characters", value: `${chars} / ${limit}` });
      } else if (chars != null) lines.push({ label: "Characters used", value: chars });
      if (sub.tier) lines.push({ label: "Subscription", value: String(sub.tier) });
      const headline = sub.tier ? String(sub.tier) : "Connected";
      return okRow(id, name, headline, lines);
    }
    const msg = json?.detail?.message || json?.message || res.statusText;
    return errRow(id, name, true, `${msg || "Bad response"} (HTTP ${res.status})`, res.status);
  } catch (e) {
    return errRow(id, name, true, e?.message || "Network error", null);
  }
}

/**
 * @returns {{ success: true, checkedAt: string, providers: object[] }}
 */
export async function fetchAllProviderBalances() {
  const checkedAt = new Date().toISOString();
  const [kie, openrouter, fal, wavespeed, apify, elevenlabs] = await Promise.all([
    fetchKieBalance(),
    fetchOpenRouterBalance(),
    fetchFalBalance(),
    fetchWaveSpeedBalance(),
    fetchApifyAccount(),
    fetchElevenLabsUser(),
  ]);
  return {
    success: true,
    checkedAt,
    providers: [kie, openrouter, fal, wavespeed, apify, elevenlabs],
  };
}
