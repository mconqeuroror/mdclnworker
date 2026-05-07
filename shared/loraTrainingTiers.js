/**
 * LoRA training tiers — single source of truth shared by client and server.
 *
 * Anything that depends on the tier (UI labels, image counts, credit cost,
 * fal training hyper-parameters, refund amounts) MUST read from this file.
 * Hardcoding `isProMode ? 30 : 15` somewhere new will silently break Ultra.
 *
 * Tier overview:
 *   standard → 15 photos · ~1h · 750 cr · 4500 fal steps · LoRA rank 16
 *   pro      → 30 photos · ~2h · 1500 cr · 9000 fal steps · LoRA rank 32
 *   ultra    → 60 photos · ~6h · 4500 cr · 27000 fal steps · LoRA rank 64
 *
 * The fal `steps` / `loraRank` numbers preserve the existing 1× / 2× scaling
 * from standard → pro and extend it 3× into ultra so dataset size, training
 * compute, and price all roughly track each other (and the wall-clock
 * estimate the UI promises the user).
 */

export const LORA_TRAINING_TIER_IDS = Object.freeze(["standard", "pro", "ultra"]);
export const DEFAULT_LORA_TRAINING_TIER = "standard";

/** @typedef {"standard"|"pro"|"ultra"} LoraTrainingTierId */

/**
 * @type {Readonly<Record<LoraTrainingTierId, Readonly<{
 *   id: LoraTrainingTierId,
 *   label: string,
 *   shortLabel: string,
 *   requiredImages: number,
 *   maxImages: number,
 *   durationHours: number,
 *   durationLabel: string,
 *   defaultCredits: number,
 *   pricingKey: "loraTrainingStandard"|"loraTrainingPro"|"loraTrainingUltra",
 *   fal: { steps: number, loraRank: number },
 * }>>>}
 */
export const LORA_TRAINING_TIERS = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    label: "Standard",
    shortLabel: "Standard",
    requiredImages: 15,
    maxImages: 15,
    durationHours: 1,
    durationLabel: "~1h to finish",
    defaultCredits: 750,
    pricingKey: "loraTrainingStandard",
    fal: Object.freeze({ steps: 4500, loraRank: 16 }),
  }),
  pro: Object.freeze({
    id: "pro",
    label: "Pro",
    shortLabel: "Pro",
    requiredImages: 30,
    maxImages: 30,
    durationHours: 2,
    durationLabel: "~2h to finish",
    defaultCredits: 1500,
    pricingKey: "loraTrainingPro",
    fal: Object.freeze({ steps: 9000, loraRank: 32 }),
  }),
  ultra: Object.freeze({
    id: "ultra",
    label: "Ultra",
    shortLabel: "Ultra",
    requiredImages: 60,
    maxImages: 60,
    durationHours: 6,
    durationLabel: "~6h to finish",
    defaultCredits: 4500,
    pricingKey: "loraTrainingUltra",
    fal: Object.freeze({ steps: 27000, loraRank: 64 }),
  }),
});

/**
 * Coerce arbitrary input into a known tier id. Anything unrecognized falls
 * back to the safest tier (standard) so we never accidentally bill someone
 * for a tier the trainer can't fulfill.
 *
 * Accepts:
 *   - "standard" | "pro" | "ultra" (case-insensitive)
 *   - boolean (true → "pro", false → "standard") — back-compat with the
 *     legacy `isPro` flag still used by some refund/credit call sites.
 *
 * @param {string|boolean|null|undefined} mode
 * @returns {LoraTrainingTierId}
 */
export function normalizeLoraTrainingMode(mode) {
  if (typeof mode === "boolean") return mode ? "pro" : "standard";
  if (typeof mode === "string") {
    const lower = mode.trim().toLowerCase();
    if (LORA_TRAINING_TIER_IDS.includes(/** @type {any} */ (lower))) {
      return /** @type {LoraTrainingTierId} */ (lower);
    }
  }
  return DEFAULT_LORA_TRAINING_TIER;
}

/**
 * Look up the full tier config for a given mode (with normalization).
 * @param {string|boolean|null|undefined} mode
 */
export function getLoraTrainingTier(mode) {
  return LORA_TRAINING_TIERS[normalizeLoraTrainingMode(mode)];
}

/** Convenience: required photo count for a given mode. */
export function getRequiredTrainingImages(mode) {
  return getLoraTrainingTier(mode).requiredImages;
}

/** Convenience: max photo count for a given mode. */
export function getMaxTrainingImages(mode) {
  return getLoraTrainingTier(mode).maxImages;
}

/**
 * Resolve the credit cost for a given tier from a (possibly partial) pricing
 * map (typically the result of `getGenerationPricing()`).
 *
 * @param {string|boolean|null|undefined} mode
 * @param {Record<string, number|undefined> | null | undefined} pricing
 */
export function resolveLoraTrainingCreditsFromPricing(mode, pricing) {
  const tier = getLoraTrainingTier(mode);
  const raw = Number(pricing?.[tier.pricingKey]);
  const value = Number.isFinite(raw) ? raw : tier.defaultCredits;
  return Math.max(0, Math.ceil(value));
}
