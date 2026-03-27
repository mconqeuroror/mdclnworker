/**
 * Stripe metadata values are capped at 500 characters each.
 * Long reference URLs and stringified aiConfig must be split across keys and reassembled on read.
 */

export const STRIPE_METADATA_VALUE_MAX = 500;

/**
 * @param {Record<string, string>} meta - Stripe metadata object (mutated)
 * @param {string} key - base key, e.g. "referenceUrl" or "aiConfig"
 * @param {string} value
 */
export function setChunkedString(meta, key, value) {
  const s = value == null ? "" : String(value);
  delete meta[key];
  delete meta[`${key}_n`];
  for (let i = 0; i < 64; i++) delete meta[`${key}_${i}`];

  if (s.length <= STRIPE_METADATA_VALUE_MAX) {
    meta[key] = s;
    return;
  }
  const n = Math.ceil(s.length / STRIPE_METADATA_VALUE_MAX);
  meta[`${key}_n`] = String(n);
  for (let i = 0; i < n; i++) {
    meta[`${key}_${i}`] = s.slice(
      i * STRIPE_METADATA_VALUE_MAX,
      (i + 1) * STRIPE_METADATA_VALUE_MAX,
    );
  }
}

/**
 * @param {Record<string, string | undefined> | null | undefined} metadata
 * @param {string} key
 * @returns {string}
 */
export function getChunkedString(metadata, key) {
  const raw = metadata || {};
  const n = raw[`${key}_n`];
  if (n != null && n !== "") {
    const num = parseInt(String(n), 10);
    if (Number.isFinite(num) && num > 0 && num <= 64) {
      let s = "";
      for (let i = 0; i < num; i++) s += raw[`${key}_${i}`] ?? "";
      return s;
    }
  }
  const v = raw[key];
  return v != null ? String(v) : "";
}

/**
 * @param {Record<string, string | undefined> | null | undefined} metadata
 */
export function parseSpecialOfferAiConfigFromMetadata(metadata) {
  const raw = getChunkedString(metadata, "aiConfig");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
