/** ModelClone-X (formerly Soul-X) — category strings and legacy compatibility. */

export const MODELCLONE_X_CATEGORY = "modelclone-x";
/** Legacy DB value — still matched in queries */
export const LEGACY_SOULX_CATEGORY = "soulx";

export const TRAINED_LORA_CATEGORIES_MODELCLONE_X = [MODELCLONE_X_CATEGORY, LEGACY_SOULX_CATEGORY];

export const GENERATION_TYPES_MODELCLONE_X = ["modelclone-x", LEGACY_SOULX_CATEGORY];

export function isModelCloneXTrainedLoraCategory(category) {
  return category === MODELCLONE_X_CATEGORY || category === LEGACY_SOULX_CATEGORY;
}
