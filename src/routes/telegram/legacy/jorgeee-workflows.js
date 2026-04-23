import { send, sendHtml, escapeTelegramHtml, inlineKbd } from "./helpers.js";
import { ensureAuth, sendLoginPrompt } from "./auth.js";
import { jorgeeeWorkflowsRootKbd, jorgeeeCreateModelKbd } from "./keyboards.js";
import { miniAppGenerateAdvancedUrl } from "./config.js";
import { getJorgeeeQuickPrompt, getJorgeeeQuickPromptTitle } from "./jorgeee-prompts.js";

export async function renderJorgeeeWorkflowsMenu(chatId) {
  const session = await ensureAuth(chatId);
  if (!session) {
    await sendLoginPrompt(chatId);
    return;
  }
  await send(
    chatId,
    "🎨 Jorgeee workflows\n\nShortcuts to the Mini App (Generate → Advanced Image).",
    jorgeeeWorkflowsRootKbd(),
  );
}

export async function handleJorgeeeCallback(chatId, data) {
  if (data.startsWith("jorgeee:qp:")) {
    const session = await ensureAuth(chatId);
    if (!session) {
      await sendLoginPrompt(chatId);
      return true;
    }
    const m = data.match(/^jorgeee:qp:([a-z]):(\d+)$/);
    if (!m) return true;
    const engineKey = m[1];
    const idx = parseInt(m[2], 10);
    const prompt = getJorgeeeQuickPrompt(engineKey, idx);
    if (!prompt) return true;
    const title = getJorgeeeQuickPromptTitle(engineKey, idx);
    const html =
      `<b>${escapeTelegramHtml(title)}</b>\n` +
      "<i>Copy:</i> long-press the grey box → <b>Copy</b>. Then Mini App → Generate → Advanced → paste into prompt.\n\n" +
      `<pre>${escapeTelegramHtml(prompt)}</pre>`;
    await sendHtml(
      chatId,
      html,
      inlineKbd([
        [
          { text: "🌐 Seedream", web_app: { url: miniAppGenerateAdvancedUrl("seedream") } },
          { text: "🌐 Nano Banana", web_app: { url: miniAppGenerateAdvancedUrl("nano-banana") } },
        ],
        [{ text: "↩️ Quick prompts menu", callback_data: "jorgeee:create" }],
        [{ text: "⬅️ Jorgeee home", callback_data: "nav:jorgeee" }],
      ]),
    );
    return true;
  }

  if (data !== "nav:jorgeee" && data !== "jorgeee:create") return false;

  if (data === "nav:jorgeee") {
    await renderJorgeeeWorkflowsMenu(chatId);
    return true;
  }

  const session = await ensureAuth(chatId);
  if (!session) {
    await sendLoginPrompt(chatId);
    return true;
  }

  if (data === "jorgeee:create") {
    await send(
      chatId,
      "🧩 Create AI model\n\n📎 Quick prompts (1 / 2 / 3 photos) — tap 📋, copy the text, paste in Mini App → Generate → Advanced. Then open an engine (Seedream or Nano Banana).\n\nEngines:",
      jorgeeeCreateModelKbd(),
    );
    return true;
  }

  return false;
}

/** Reply keyboard: "🎨 Jorgeee workflows" */
export async function handleJorgeeeMessage(chatId, message, text) {
  const t = String(text || "").trim();
  if (!t.includes("Jorgeee") || !t.toLowerCase().includes("workflow")) return false;

  const session = await ensureAuth(chatId);
  if (!session) {
    await sendLoginPrompt(chatId);
    return true;
  }

  await renderJorgeeeWorkflowsMenu(chatId);
  return true;
}
