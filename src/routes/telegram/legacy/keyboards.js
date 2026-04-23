import { appUrl, MINI_APP_BASE, miniAppGenerateAdvancedUrl } from "./config.js";
import { inlineKbd, modelListToInlineRows, formatModelButtonText } from "./helpers.js";
import { jorgeeeQuickPromptButtonRows } from "./jorgeee-prompts.js";

// ── Main navigation keyboard (reply keyboard) ─────────────────
export function mainKbd() {
  return {
    keyboard: [
      ["🏠 Menu"],
      ["🧬 Models", "🎬 Generate"],
      ["🔞 NSFW Studio", "🔧 Tools"],
      ["🕘 History", "📥 Queue"],
      ["🎤 Voice"],
      ["⚙️ Settings", "💳 Pricing"],
      ["🎨 Jorgeee workflows"],
      ["🌐 App Hub", "❓ Help"],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    is_persistent: true,
  };
}

export function cancelKbd() {
  return { keyboard: [["Cancel"]], resize_keyboard: true, one_time_keyboard: true };
}

export function skipCancelKbd() {
  return { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true };
}

export function doneCancelKbd() {
  return { keyboard: [["Done", "Cancel"]], resize_keyboard: true, one_time_keyboard: true };
}

export function removeKbd() {
  return { remove_keyboard: true };
}

// ── Dashboard ─────────────────────────────────────────────────
export function dashboardKbd() {
  return inlineKbd([
    [{ text: "🧬 Models", callback_data: "nav:models" }, { text: "🎬 Generate", callback_data: "nav:generate" }],
    [{ text: "🔞 NSFW Studio", callback_data: "nav:nsfw" }, { text: "🔧 Tools", callback_data: "nav:tools" }],
    [{ text: "🕘 History", callback_data: "nav:history" }, { text: "📥 Queue", callback_data: "nav:queue" }],
    [{ text: "🎤 Voice", callback_data: "nav:voice" }],
    [{ text: "⚙️ Settings", callback_data: "nav:settings" }, { text: "💳 Pricing", callback_data: "nav:pricing" }],
    [{ text: "🎁 Referral", callback_data: "nav:referral" }, { text: "🌐 App Hub", callback_data: "nav:apphub" }],
    [{ text: "🎨 Jorgeee workflows", callback_data: "nav:jorgeee" }],
  ]);
}

// ── Jorgeee workflows (Mini App deep links) ────────────────────
export function jorgeeeWorkflowsRootKbd() {
  return inlineKbd([
    [{ text: "🧩 Create AI model", callback_data: "jorgeee:create" }],
    [{ text: "⬅️ Home", callback_data: "nav:home" }],
  ]);
}

export function jorgeeeCreateModelKbd() {
  return inlineKbd([
    ...jorgeeeQuickPromptButtonRows(),
    [{ text: "Seedream v4.5 · Uncensored+", web_app: { url: miniAppGenerateAdvancedUrl("seedream") } }],
    [{ text: "Nano Banana Pro · Ultra Realism", web_app: { url: miniAppGenerateAdvancedUrl("nano-banana") } }],
    [{ text: "⬅️ Back", callback_data: "nav:jorgeee" }],
  ]);
}

// ── Home / back ───────────────────────────────────────────────
export function homeKbd() {
  return inlineKbd([[{ text: "🏠 Home", callback_data: "nav:home" }]]);
}

export function backHomeKbd() {
  return inlineKbd([[{ text: "⬅️ Back", callback_data: "nav:home" }]]);
}

export function modelsHomeKbd() {
  return inlineKbd([
    [{ text: "🧬 Models", callback_data: "nav:models" }],
    [{ text: "🏠 Home", callback_data: "nav:home" }],
  ]);
}

// ── Generation result card ────────────────────────────────────
export function generationResultKbd(genId, status, outputUrl, type, fromPage = 0) {
  const rows = [];
  if (status === "processing" || status === "pending") {
    rows.push([{ text: "🔄 Refresh status", callback_data: `gen:refresh:${genId}:${fromPage}` }]);
  }
  if (status === "completed" && outputUrl) {
    rows.push([{ text: "▶️ View output", url: outputUrl }]);
  }
  if (status === "failed") {
    const RETRYABLE = new Set(["prompt-video","prompt-image","advanced-image","image-identity","talking-head","face-swap","face-swap-image","creator-studio","creator-studio-video"]);
    if (RETRYABLE.has(String(type || "").toLowerCase())) {
      rows.push([{ text: "♻️ Retry", callback_data: `gen:retry:${genId}:${fromPage}` }]);
    }
  }
  rows.push([{ text: "🎬 Generate more", callback_data: "nav:generate" }, { text: "🕘 History", callback_data: "nav:history" }]);
  return inlineKbd(rows);
}

// ── Duration pickers ──────────────────────────────────────────
export function durationKbd5_10(prefix) {
  return inlineKbd([
    [{ text: "5s — 150 cr", callback_data: `${prefix}:5` }, { text: "10s — 250 cr", callback_data: `${prefix}:10` }],
    [{ text: "Cancel", callback_data: "nav:home" }],
  ]);
}

export function durationNsfw5_8(prefix) {
  return inlineKbd([
    [{ text: "5s — 50 cr", callback_data: `${prefix}:5` }, { text: "8s — 80 cr", callback_data: `${prefix}:8` }],
    [{ text: "Cancel", callback_data: "nav:home" }],
  ]);
}

// ── Model picker ──────────────────────────────────────────────
export function modelPickerKbd(models, callbackPrefix, backCb = "nav:home") {
  const rows = modelListToInlineRows(models, (m) => `${callbackPrefix}:${m.id}`);
  rows.push([{ text: "⬅️ Back", callback_data: backCb }]);
  return inlineKbd(rows);
}

export function nsfwModelPickerKbd(models, callbackPrefix, backCb = "nav:nsfw") {
  const rows = modelListToInlineRows(models, (m) => `${callbackPrefix}:${m.id}`, {
    maxLabelLen: 20,
    labelFor: (m) => {
      const base = formatModelButtonText(m.name, 20);
      return `${base}${m.nsfwUnlocked ? " ✓" : " ⏳"}`;
    },
  });
  rows.push([{ text: "⬅️ Back", callback_data: backCb }]);
  return inlineKbd(rows);
}

// ── Generate: step 1 — four pillars (matches web nav) ────────
export function generateRootKbd() {
  return inlineKbd([
    [{ text: "🖼 Picture", callback_data: "gen:root:picture" }, { text: "🎬 Video", callback_data: "gen:root:video" }],
    [{ text: "🧬 ModelClone-X", callback_data: "gen:root:mcx" }, { text: "🎛 Creator Studio", callback_data: "gen:root:cstudio" }],
    [{ text: "⬅️ Back", callback_data: "nav:home" }],
  ]);
}

// ── Generate: picture — same pillars as web Generate → Image ─
export function generatePictureSubmenuKbd() {
  return inlineKbd([
    [{ text: "📝 Prompt photo", callback_data: "gen:aiphoto" }, { text: "🪪 Identity recreate", callback_data: "gen:identity" }],
    [{ text: "🪞 Face swap (image)", callback_data: "gen:faceswapimg" }],
    [{ text: "⬅️ Back", callback_data: "nav:generate" }],
  ]);
}

// ── Generate: video — matches web Generate → Video methods ──
export function generateVideoSubmenuKbd() {
  return inlineKbd([
    [{ text: "🎬 Recreate video", callback_data: "gen:motion" }, { text: "📝 Prompt video", callback_data: "gen:aivideo" }],
    [{ text: "🗣 Talking head", callback_data: "gen:talkinghead" }, { text: "🎭 Face swap (video)", callback_data: "gen:faceswapvid" }],
    [{ text: "⬅️ Back", callback_data: "nav:generate" }],
  ]);
}

// ── Generate: Creator Studio bucket (image / video / advanced) ─
export function generateCreatorStudioSubmenuKbd() {
  return inlineKbd([
    [{ text: "🎨 Image engines", callback_data: "gen:csimg" }, { text: "🎬 Video engines", callback_data: "gen:csvid" }],
    [{ text: "🌟 Advanced AI", callback_data: "gen:advanced" }],
    [{ text: "📎 CS assets", callback_data: "gen:assets" }],
    [{ text: "⬅️ Back", callback_data: "nav:generate" }],
  ]);
}

/** @deprecated Use generateRootKbd + submenus */
export function generateMenuKbd() {
  return generateRootKbd();
}

// ── Generate "More" submenu — advanced / niche tools ─────────
export function generateMoreKbd() {
  return inlineKbd([
    [{ text: "⚡ Quick Video", callback_data: "gen:quickvid" }, { text: "🎞 Motion Transfer", callback_data: "gen:motion" }],
    [{ text: "🔁 Full Recreation", callback_data: "gen:fullrec" }, { text: "🎞 Pipeline Prep", callback_data: "gen:pipeline" }],
    [{ text: "🎞 Frame Extractor", callback_data: "gen:extract" }],
    [{ text: "✨ Enhance Prompt", callback_data: "gen:enhance" }, { text: "📝 Describe Scene", callback_data: "gen:describe" }],
    [{ text: "📎 CS Assets", callback_data: "gen:assets" }],
    [{ text: "⬅️ Back", callback_data: "nav:generate" }],
  ]);
}

// ── NSFW: hub (bot-first; full chips = Mini App) ───────────────
export function nsfwHubMenuKbd() {
  return inlineKbd([
    [
      { text: "🖼 Quick image", callback_data: "nsfw:genimg" },
      { text: "🎬 Quick video", callback_data: "nsfw:genvid" },
    ],
    [
      { text: "🧠 AI scene plan", callback_data: "nsfw:plan" },
      { text: "🎯 Auto chips", callback_data: "nsfw:autoselect" },
    ],
    [
      { text: "✨ Advanced", callback_data: "nsfw:advanced" },
      { text: "💄 Nudes pack", callback_data: "nsfw:nudes" },
    ],
    [
      { text: "📍 Scene presets", callback_data: "nsfw:pre" },
      { text: "🤖 AI prompt", callback_data: "nsfw:prompt" },
    ],
    [
      { text: "🧬 Training", callback_data: "nsfw:training" },
      { text: "🗂 LoRA", callback_data: "nsfw:lora:menu" },
    ],
    [
      { text: "💾 Looks", callback_data: "nsfw:appearance:menu" },
      { text: "🧪 Face-ref test", callback_data: "nsfw:tface" },
    ],
    [
      { text: "⏩ Extend video", callback_data: "nsfw:extend" },
      { text: "🔞 Full studio (web)", web_app: { url: appUrl("nsfw") } },
    ],
    [{ text: "⬅️ Home", callback_data: "nav:home" }],
  ]);
}

// ── NSFW Studio → Mini App (primary entry) ────────────────────
export function nsfwStudioMiniAppKbd() {
  return inlineKbd([
    [{ text: "🔞 Open NSFW Studio", web_app: { url: appUrl("nsfw") } }],
    [{ text: "⬅️ Home", callback_data: "nav:home" }],
  ]);
}

// ── Tools menu ────────────────────────────────────────────────
export function toolsMenuKbd() {
  return inlineKbd([
    [{ text: "🔍 Upscaler", callback_data: "tools:upscaler" }],
    [{ text: "🎞 Reformatter", callback_data: "tools:reformatter" }],
    [{ text: "♻️ Repurposer", callback_data: "tools:repurposer" }],
    [{ text: "⬅️ Back", callback_data: "nav:home" }],
  ]);
}

// ── App Hub ───────────────────────────────────────────────────
export function appHubKbd() {
  return inlineKbd([
    [{ text: "🏠 Home", web_app: { url: appUrl("dashboard") } }, { text: "🧬 Models", web_app: { url: appUrl("models") } }],
    [{ text: "🎬 Generate", web_app: { url: appUrl("generate") } }, { text: "🎛 Creator Studio", web_app: { url: appUrl("creator") } }],
    [{ text: "🎤 Voice Studio", web_app: { url: appUrl("voice") } }, { text: "🎞 Frame Extractor", web_app: { url: appUrl("frame") } }],
    [{ text: "🎨 ModelClone-X", web_app: { url: appUrl("modelclonex") } }, { text: "🕘 History", web_app: { url: appUrl("history") } }],
    [{ text: "⚙️ Settings", web_app: { url: appUrl("settings") } }, { text: "🔞 NSFW", web_app: { url: appUrl("nsfw") } }],
    [{ text: "📚 Course", web_app: { url: appUrl("course") } }, { text: "🔎 Reel Finder", web_app: { url: appUrl("reelfinder") } }],
    [{ text: "🎁 Referral", web_app: { url: appUrl("referral") } }, { text: "🎞 Reformatter", web_app: { url: appUrl("reformatter") } }],
    [{ text: "🔍 Upscaler", web_app: { url: appUrl("upscaler") } }, { text: "♻️ Repurposer", web_app: { url: appUrl("repurposer") } }],
    [{ text: "⬅️ Back", callback_data: "nav:home" }],
  ]);
}

// ── Open Mini App ─────────────────────────────────────────────
export function openAppKbd(label = "📱 Open Mini App", section = null) {
  return inlineKbd([[{ text: label, web_app: { url: section ? appUrl(section) : MINI_APP_BASE } }]]);
}

// ── Login ─────────────────────────────────────────────────────
export function loginKbd() {
  return inlineKbd([
    [{ text: "Email + Password", callback_data: "auth:email" }],
    [{ text: "🔵 Google Login", web_app: { url: `${MINI_APP_BASE}/login?method=google` } }],
    [{ text: "📱 Open Mini App", web_app: { url: MINI_APP_BASE } }],
  ]);
}
