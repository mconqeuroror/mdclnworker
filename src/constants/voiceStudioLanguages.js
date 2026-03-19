/**
 * Optional primary language for custom voices.
 * - Design: prepended to voice_description for ElevenLabs TTV (no separate API field).
 * - Clone: sent as labels.language on voices/add.
 */
export const VOICE_STUDIO_LANGUAGE_OPTIONS = [
  { code: "", label: "Auto / not specified" },
  { code: "en", label: "English" },
  { code: "sk", label: "Slovak" },
  { code: "cs", label: "Czech" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "el", label: "Greek" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
];

const ALLOWED = new Set(
  VOICE_STUDIO_LANGUAGE_OPTIONS.map((o) => o.code).filter(Boolean),
);

export function normalizeVoiceStudioLanguageCode(raw) {
  const c = String(raw ?? "").trim().toLowerCase();
  if (!c) return "";
  return ALLOWED.has(c) ? c : "";
}

/**
 * @param {string} userDescription - user-authored part (min length validated separately)
 * @param {string} languageCode - normalized code or ""
 * @returns {string} full description for ElevenLabs
 */
export function mergeVoiceDescriptionWithLanguage(userDescription, languageCode) {
  const base = String(userDescription || "").trim();
  if (!languageCode) return base;
  const opt = VOICE_STUDIO_LANGUAGE_OPTIONS.find((o) => o.code === languageCode);
  const label = opt?.label || languageCode;
  return `Primary language for this voice: ${label} (${languageCode}). ${base}`;
}
