/**
 * One-off / repeatable: replace corrupted ?? / ? prefixes in Telegram legacy user strings.
 * Run: node scripts/fix-telegram-emoji-placeholders.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const genPath = path.join(root, "src/routes/telegram/legacy/generate.js");

let s = fs.readFileSync(genPath, "utf8");

const pairs = [
  ['{ text: "?? Generate again",', '{ text: "🎬 Again",'],
  ['{ text: "?? View output",', '{ text: "🔗 Open result",'],
  ['{ text: "?? Check status",', '{ text: "🔄 Status",'],
  ['{ text: "?? Motion Transfer",', '{ text: "🎬 Motion transfer",'],
  ['{ text: "?? Pipeline Prep",', '{ text: "🎞 Pipeline prep",'],
  ['{ text: "?? Generate more",', '{ text: "🎬 More",'],
  ['{ text: "?? My Assets",', '{ text: "📎 My assets",'],
  ['{ text: "?? Use this as prompt",', '{ text: "✨ Use as prompt",'],
  ['{ text: "?? Use as prompt",', '{ text: "✨ Use as prompt",'],
  ['{ text: "?? Voice Studio",', '{ text: "🎤 Voice studio",'],
  ['{ text: "?? Create Model",', '{ text: "🧬 Create model",'],
  ['{ text: "?? Quality (best, most cr)",', '{ text: "✨ Quality (best, most cr)",'],
  ['{ text: "?? Balanced (default)",', '{ text: "⚖️ Balanced (default)",'],
  ['{ text: "? Turbo (fastest, cheapest)",', '{ text: "⚡ Turbo (fastest, cheapest)",'],
  ['{ text: "?? Portrait (9:16)",', '{ text: "📱 Portrait (9:16)",'],
  ['{ text: "?? Landscape (16:9)",', '{ text: "🖼 Landscape (16:9)",'],
  ['{ text: "?? Quality",', '{ text: "✨ Quality",'],
  ['{ text: "?? Lite",', '{ text: "🪶 Lite",'],
  ['{ text: "? Fast",', '{ text: "⚡ Fast",'],
  ['{ text: "?? History",', '{ text: "🕘 History",'],
  ['{ text: "?? Back",', '{ text: "⬅️ Back",'],
  ['{ text: "?? Retry",', '{ text: "🔄 Retry",'],
  ['{ text: "?? Refresh",', '{ text: "🔄 Refresh",'],
  ['{ text: "?? Generate",', '{ text: "🎬 Generate",'],
  ['{ text: "?? Home",', '{ text: "🏠 Home",'],
  ['{ text: "?? Delete",', '{ text: "🗑 Delete",'],
  ['{ text: "?? Assets",', '{ text: "📎 Assets",'],
  ['{ text: "?? Image asset",', '{ text: "🖼 Image upload",'],
  ['{ text: "?? Video asset",', '{ text: "🎬 Video upload",'],
  ['{ text: "?? Start over",', '{ text: "🔁 Start over",'],
  ['{ text: "? Submit",', '{ text: "✅ Submit",'],
  ['"?? Session expired ? tap to restart:"', '"⏱ Session ended — tap below to restart."'],
  ['"?? nano-banana"', '"🍌 nano-banana"'],
  ['"?? WAN 2.7 Image"', '"🖼 WAN 2.7 Image"'],
  ['"?? WAN 2.7 Image Pro"', '"🖼 WAN 2.7 Image Pro"'],
  ['"?? Ideogram v3 Text"', '"✏️ Ideogram v3 Text"'],
  ['"?? Ideogram v3 Remix"', '"✏️ Ideogram v3 Remix"'],
  ['"?? Seedream 4.5 Edit"', '"🌙 Seedream 4.5 Edit"'],
  ['"? Flux Kontext Pro"', '"🌀 Flux Kontext Pro"'],
  ['"? Flux Kontext Max"', '"🌀 Flux Kontext Max"'],
  ['"?? WAN 2.7"', '"▶️ WAN 2.7"'],
  ['"?? WAN 2.6"', '"▶️ WAN 2.6"'],
  ['"?? WAN 2.2"', '"▶️ WAN 2.2"'],
  ['"?? Kling 3.0"', '"▶️ Kling 3.0"'],
  ['"?? Kling 2.6"', '"▶️ Kling 2.6"'],
  ['"?? Seedance 2"', '"▶️ Seedance 2"'],
  ['"?? VEO 3.1"', '"▶️ VEO 3.1"'],
  ['"?? Sora 2"', '"▶️ Sora 2"'],
  ['note: "2?15s,', 'note: "2–15s,'],
  ['note: "3?15s,', 'note: "3–15s,'],
  ['note: "4?15s,', 'note: "4–15s,'],
  ["`?? WAN 2.2", "`🎬 WAN 2.2"],
  ["`?? WAN 2.7 Edit", "`🎬 WAN 2.7 Edit"],
  ["`?? Seedance First+Last", "`🎬 Seedance First+Last"],
  ["`?? Seedance Multi-Ref", "`🎬 Seedance Multi-Ref"],
  ["`?? Scene description:", "`📝 Scene description:"],
  ["`?? CS Assets (", "`📎 Creator assets ("],
  ['"?? Image Face Swap', '"🪪 Image face swap'],
  ['"?? Motion Transfer\\n\\nSend', '"🎬 Motion transfer\\n\\nSend'],
  ['"?? Full Recreation', '"🎬 Full recreation'],
  ['"?? Frame Extractor', '"🎞 Frame extractor'],
  ['"?? Describe Target', '"🎯 Describe target'],
  ["caption: `? ${", "caption: `✅ ${"],
  ["`? ${typeLabel} complete!", "`✅ ${typeLabel} complete!"],
  ["`? ${typeLabel} failed.", "`❌ ${typeLabel} failed."],
  [
    "`? ${typeLabel} is generating?${creditNote}\n\nTap Refresh to check status.`",
    "`⏳ ${typeLabel} in progress${creditNote}\n\nTap Refresh for status.`",
  ],
  ["`? Retry failed:", "`❌ Retry failed:"],
  ["`? Retry started.", "`✅ Retry started."],
  ["`? Pipeline started.", "`✅ Pipeline started."],
  ["`? ${frames.length}", "`✅ ${frames.length}"],
  ["`? Enhanced prompt:", "`✨ Enhanced prompt:"],
  ["`? Failed:", "`❌ Failed:"],
  ["`? Frame extraction failed:", "`❌ Frame extraction failed:"],
  ['await send(chatId, "? Retrying...', 'await send(chatId, "⏳ Retrying...'],
  ['await send(chatId, "? Starting', 'await send(chatId, "⏳ Starting'],
  ['await send(chatId, "? Generating', 'await send(chatId, "⏳ Generating'],
  ['await send(chatId, "? Creating', 'await send(chatId, "⏳ Creating'],
  ['await send(chatId, "? Extracting', 'await send(chatId, "⏳ Extracting'],
  ['await send(chatId, "? Analyzing', 'await send(chatId, "⏳ Analyzing'],
  ['await send(chatId, "? Image received.', 'await send(chatId, "✅ Image received.'],
  ['await send(chatId, "? Target received.', 'await send(chatId, "✅ Target received.'],
  ['await send(chatId, "? Video received.', 'await send(chatId, "✅ Video received.'],
  ['await send(chatId, "? Source face received.', 'await send(chatId, "✅ Source face received.'],
  ['await send(chatId, "? Screenshot received.', 'await send(chatId, "✅ Screenshot received.'],
  ['await send(chatId, "? First frame received.', 'await send(chatId, "✅ First frame received.'],
  ['await send(chatId, "? Last frame received.', 'await send(chatId, "✅ Last frame received.'],
  ['await send(chatId, url ? "? Image received.', 'await send(chatId, url ? "✅ Image received.'],
  ['"? Asset created!', '"✅ Asset saved!'],
  ['"? Asset deleted.', '"🗑 Asset removed.'],
  ['await send(chatId, "? Enhancing prompt...', 'await send(chatId, "⏳ Enhancing prompt...'],
  ['"? 3 variations generated!', '"✅ 3 variations generated!'],
  ["(image ? video, 2 steps)", "(image + video, 2 steps)"],
  ["`? Enhanced prompt:\\n\\n${r.enhancedPrompt}", "`✨ Enhanced prompt:\\n\\n${r.enhancedPrompt}"],
  ['\\n\\nSubmit?', "\\n\\nSubmit now?"],
];

for (const [a, b] of pairs) {
  const n = s.split(a).length - 1;
  if (n === 0) console.warn("MISS:", a.slice(0, 70));
  s = s.split(a).join(b);
}

// Clean section comments: // ?? Foo ...  ->  // — Foo —
s = s.replace(/\/\/ \?\? ([^\n]+)/g, (_, rest) => {
  const trimmed = rest.replace(/\?+$/, "").trim();
  return `// — ${trimmed} —`;
});

// creditNote line had ` ? ` — fix to middle dot
s = s.replace(
  /const creditNote = creditsUsed != null \? ` \? \$\{creditsUsed\} cr` : "";/,
  'const creditNote = creditsUsed != null ? ` · ${creditsUsed} cr` : "";',
);

fs.writeFileSync(genPath, s);
console.log("Updated", genPath);
