const stripTrailingSlash = (value) => String(value || "").trim().replace(/\/$/, "");

/**
 * Where users open the Mini App / web_app (can differ from the bot API host).
 * TELEGRAM_MINI_APP_URL in env overrides; default is main production site.
 */
function resolveMiniAppBase() {
  const explicit = stripTrailingSlash(process.env.TELEGRAM_MINI_APP_URL);
  if (explicit) return explicit;
  return "https://modelclone.app";
}

/** Origin users open in the Telegram WebApp / browser (buttons, deep links). */
export const MINI_APP_BASE = resolveMiniAppBase();

/**
 * Base URL for server-side `fetch` from the Telegram webhook handler (legacy bot → REST API).
 * Must hit **this** deployment (same JWT/DB). If Mini App is on modelclone.app but the bot runs on
 * mdclntg.vercel.app, this must NOT follow MINI_APP_BASE — use VERCEL_URL or TELEGRAM_LEGACY_API_URL.
 */
function resolveLegacyInternalApiBase() {
  const explicit = stripTrailingSlash(process.env.TELEGRAM_LEGACY_API_URL);
  if (explicit) return explicit;
  if (process.env.NODE_ENV !== "production") {
    const port = process.env.SERVER_PORT || process.env.PORT || "5000";
    return `http://127.0.0.1:${port}`;
  }
  const vu = process.env.VERCEL_URL;
  if (vu) {
    const host = String(vu).replace(/^https?:\/\//i, "").split("/")[0].trim();
    if (host) return stripTrailingSlash(`https://${host}`);
  }
  return MINI_APP_BASE;
}

export const API_BASE = resolveLegacyInternalApiBase();

if (process.env.NODE_ENV !== "production") {
  console.log(
    `[telegram-legacy] Server API calls → ${API_BASE} | Mini App / WebApp links → ${MINI_APP_BASE}`,
  );
}

export const MODE_MINI = "mini";
export const MODE_LEGACY = "legacy";

export const FLOW_TTL_MS = 45 * 60 * 1000;         // 45 min flow expiry
export const STATE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const PAGE_SIZE = 8;

export const COMMANDS = [
  { command: "start",      description: "Open ModelClone bot" },
  { command: "menu",       description: "Main menu" },
  { command: "mode",       description: "Switch Mini App / Legacy mode" },
  { command: "login",      description: "Login with email + password" },
  { command: "logout",     description: "Logout" },
  { command: "dashboard",  description: "Account stats" },
  { command: "models",     description: "My models" },
  { command: "generate",   description: "Generate content" },
  { command: "history",    description: "Generation history" },
  { command: "queue",      description: "Active job queue" },
  { command: "voice",      description: "Voice studio" },
  { command: "settings",   description: "Settings" },
  { command: "pricing",    description: "Plans and credits" },
  { command: "upscaler",   description: "Upscale an image" },
  { command: "reformatter",description: "Reformat media" },
  { command: "repurposer", description: "Repurpose video" },
  { command: "help",       description: "Support links" },
  { command: "app",        description: "Open Mini App" },
  { command: "apphub",     description: "All Mini App tabs" },
  { command: "jorgeee",    description: "Jorgeee workflows" },
];

export const SECTION_TABS = {
  dashboard:  "home",
  models:     "models",
  generate:   "generate",
  creator:    "creator-studio",
  voice:      "voice-studio",
  reformatter:"reformatter",
  frame:      "frame-extractor",
  upscaler:   "upscaler",
  modelclonex:"modelclone-x",
  history:    "history",
  settings:   "settings",
  nsfw:       "nsfw",
  course:     "course",
  repurposer: "repurposer",
  reelfinder: "reelfinder",
  referral:   "referral",
};

export function appUrl(section) {
  const tab = SECTION_TABS[section];
  if (!tab) return MINI_APP_BASE;
  return `${MINI_APP_BASE}/dashboard?tab=${encodeURIComponent(tab)}`;
}

/** Mini App → Generate tab, Advanced image, chosen engine (Seedream = Uncensored+, Nano Banana = Ultra Realism). */
export function miniAppGenerateAdvancedUrl(advancedModel) {
  const m = advancedModel === "seedream" || advancedModel === "nano-banana" ? advancedModel : "nano-banana";
  const q = new URLSearchParams({
    tab: "generate",
    imageMode: "advanced",
    advancedModel: m,
  });
  return `${MINI_APP_BASE}/dashboard?${q.toString()}`;
}

export const LOOKS_CATEGORIES = [
  { key: "gender",     label: "Gender",     options: ["female","male"] },
  { key: "ethnicity",  label: "Ethnicity",  options: ["caucasian","latina","asian","east asian","south asian","middle eastern","black african","mixed race","pacific islander"] },
  { key: "hairColor",  label: "Hair Color", options: ["blonde hair","brunette hair","black hair","red hair","pink hair","platinum blonde hair","auburn hair","silver hair","white hair","strawberry blonde hair","dark brown hair","light brown hair","honey blonde hair"] },
  { key: "hairStyle",  label: "Hair Style", options: ["long straight hair","long wavy hair","long curly hair","short straight hair","short curly hair","medium length hair","ponytail","braided hair","messy bun","hair down over shoulders","pigtails","twin braids","half up half down","wet slicked back hair","bob cut","pixie cut","bangs with long hair"] },
  { key: "skinTone",   label: "Skin Tone",  options: ["pale white skin","fair skin","light skin","lightly tanned skin","tanned skin","olive skin","caramel skin","brown skin","dark brown skin","dark skin","sun-kissed skin","porcelain skin"] },
  { key: "eyeColor",   label: "Eye Color",  options: ["blue eyes","green eyes","brown eyes","hazel eyes","grey eyes","dark brown eyes","light brown eyes","amber eyes"] },
  { key: "eyeShape",   label: "Eye Shape",  options: ["almond shaped eyes","round eyes","hooded eyes","upturned eyes","monolid eyes","deep set eyes","large doe eyes"] },
  { key: "faceShape",  label: "Face Shape", options: ["oval face","round face","heart shaped face","square jaw face","diamond face","long face","soft angular face"] },
  { key: "nose",       label: "Nose",       options: ["small button nose","straight narrow nose","slightly upturned nose","wide nose","aquiline nose","flat bridge nose","petite nose"] },
  { key: "lips",       label: "Lips",       options: ["thin lips","medium lips","full lips","plump lips","bow shaped lips","wide lips"] },
  { key: "bodyType",   label: "Body Type",  options: ["slim body","athletic body","curvy body","petite body","thick body","slim sporty body","muscular body","hourglass body","pear shaped body","slim thick body"] },
  { key: "height",     label: "Height",     options: ["short stature","average height","tall stature","very tall stature"] },
  { key: "breastSize", label: "Breast Size",options: ["small perky breasts","medium sized breasts","large round breasts","huge breasts","natural teardrop breasts"] },
  { key: "butt",       label: "Butt",       options: ["small tight butt","round medium butt","large round butt","thick bubble butt","athletic toned butt"] },
  { key: "waist",      label: "Waist",      options: ["very narrow waist","slim waist","average waist","wide waist","tiny waist wide hips"] },
  { key: "hips",       label: "Hips",       options: ["narrow hips","average hips","wide hips","very wide hips","curvy wide hips"] },
  { key: "tattoos",    label: "Tattoos & Piercings", options: ["no tattoos","small tattoos","arm sleeve tattoo","multiple tattoos","full body tattoos","navel piercing","nipple piercings","nose piercing"] },
];

export const RETRYABLE_TYPES = new Set([
  "prompt-video",
  "prompt-image",
  "advanced-image",
  "image-identity",
  "talking-head",
  "face-swap",
  "face-swap-image",
  "creator-studio",
  "creator-studio-video",
  "nsfw",
  "nsfw-video",
  "nsfw-video-extend",
]);
