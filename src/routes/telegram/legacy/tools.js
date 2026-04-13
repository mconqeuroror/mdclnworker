import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, isHttpUrl } from "./helpers.js";
import { resolveImage, resolveVideo, downloadImageBufferFromUrl } from "./media.js";
import { cancelKbd, toolsMenuKbd, skipCancelKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import { apiSubmitUpscale, apiUpscaleStatus, apiSubmitReformatter, apiSubmitRepurposer, apiRepurposerStatus } from "./api.js";
import { inferMediaExt } from "./helpers.js";

// ── Message handler ───────────────────────────────────────────
export async function handleToolsMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("tools_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await send(chatId, "Cancelled.", toolsMenuKbd()); return true; }

  // ── Upscaler ─────────────────────────────────────────────────
  if (flow.step === "tools_upscale_img") {
    const url = await resolveImage(message).catch(() => null);
    if (!url || !isHttpUrl(url)) {
      await send(chatId, "Send the image as a photo or image file (max 20MB):", cancelKbd());
      return true;
    }
    clearFlow(chatId);
    await send(chatId, "⏳ Uploading and starting upscale...", null);
    try {
      const { buffer, mimeType, fileName } = await downloadImageBufferFromUrl(url);
      const r = await apiSubmitUpscale(userId, buffer, mimeType, fileName);
      if (!r.ok) { await send(chatId, `❌ Upscale failed: ${r.message}`); return true; }
      await send(chatId, `✅ Upscale started!\nJob ID: ${r.generationId}`, inlineKbd([
        [{ text: "🔄 Check status", callback_data: `tools:upscale:status:${r.generationId}` }],
        [{ text: "⬅️ Back to tools", callback_data: "nav:tools" }],
      ]));
    } catch (e) {
      await send(chatId, `❌ Failed: ${e.message}`);
    }
    return true;
  }

  // ── Reformatter ───────────────────────────────────────────────
  if (flow.step === "tools_reform_media") {
    // Resolve to R2 URL (same approach as repurposer) then send URL to API
    const url = await resolveImage(message).catch(() => null)
      || await resolveVideo(message).catch(() => null);
    if (!url || !isHttpUrl(url)) {
      await send(chatId, "Send media as a photo, video, or document file:", cancelKbd());
      return true;
    }
    const originalFileName = String(message?.document?.file_name || message?.video?.file_name || "upload");
    clearFlow(chatId);
    await send(chatId, "⏳ Starting reformatter...", null);
    const r = await apiSubmitReformatter(userId, url, originalFileName);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✅ Reformatter started!\nJob ID: ${r.jobId}`, inlineKbd([
      [{ text: "🔄 Check status", callback_data: `tools:reform:status:${r.jobId}` }],
      [{ text: "⬅️ Back to tools", callback_data: "nav:tools" }],
    ]));
    return true;
  }

  // ── Repurposer ────────────────────────────────────────────────
  if (flow.step === "tools_repurpose_src") {
    const url = await resolveImage(message).catch(() => null) || await resolveVideo(message).catch(() => null);
    if (!url || !isHttpUrl(url)) {
      await send(chatId, "Send source media as a photo, video, or file:", cancelKbd());
      return true;
    }
    setFlow(chatId, { step: "tools_repurpose_wm", sourceUrl: url });
    await send(chatId, "✅ Source received.\n\nSend a watermark image or tap Skip:", skipCancelKbd());
    return true;
  }
  if (flow.step === "tools_repurpose_wm") {
    const skip = t.toLowerCase() === "skip";
    let watermarkUrl = null;
    if (!skip) {
      watermarkUrl = await resolveImage(message).catch(() => null);
    }
    clearFlow(chatId);
    await send(chatId, "⏳ Starting repurposer...", null);
    const r = await apiSubmitRepurposer(userId, flow.sourceUrl, watermarkUrl);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, `✅ Repurposer started!\nJob ID: ${r.jobId}`, inlineKbd([
      [{ text: "🔄 Check status", callback_data: `tools:repurpose:status:${r.jobId}` }],
      [{ text: "⬅️ Back to tools", callback_data: "nav:tools" }],
    ]));
    return true;
  }

  return false;
}

// ── Callback handler ──────────────────────────────────────────
export async function handleToolsCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:tools") { await send(chatId, "🔧 Tools", toolsMenuKbd()); return true; }

  if (data === "tools:upscaler") {
    setFlow(chatId, { step: "tools_upscale_img" });
    await send(chatId, "🔍 Upscaler\n\nSend the image to upscale (photo or image file, max 20MB):", cancelKbd());
    return true;
  }
  if (data.startsWith("tools:upscale:status:")) {
    const genId = data.split(":").pop();
    const r = await apiUpscaleStatus(userId, genId);
    if (!r.ok) { await send(chatId, `❌ Status check failed: ${r.message}`); return true; }
    const statusText = `🔍 Upscaler Job\nID: ${genId}\nStatus: ${r.status}\nOutput: ${r.imageUrl || "pending"}\n${r.error ? `Error: ${r.error}` : ""}`;
    const rows = [];
    if (r.status === "processing" || r.status === "pending") rows.push([{ text: "🔄 Refresh", callback_data: `tools:upscale:status:${genId}` }]);
    if (r.imageUrl && isHttpUrl(r.imageUrl)) rows.push([{ text: "🖼 View output", url: r.imageUrl }]);
    rows.push([{ text: "⬅️ Back to tools", callback_data: "nav:tools" }]);
    if (r.status === "completed" && r.imageUrl && isHttpUrl(r.imageUrl)) {
      await sendImg(chatId, r.imageUrl, { caption: "✅ Upscale complete!", replyMarkup: inlineKbd(rows) });
    } else {
      await send(chatId, statusText, inlineKbd(rows));
    }
    return true;
  }

  if (data === "tools:reformatter") {
    setFlow(chatId, { step: "tools_reform_media" });
    await send(chatId, "🎞 Reformatter\n\nSend media as a photo, video, or document file:", cancelKbd());
    return true;
  }
  if (data.startsWith("tools:reform:status:")) {
    const jobId = data.split(":").pop();
    const r = await apiRepurposerStatus(userId, jobId);
    const text = r.ok
      ? `🎞 Reformatter Job\nID: ${jobId}\nStatus: ${r.status || "processing"}\n${Array.isArray(r.outputs) && r.outputs.length ? `Outputs: ${r.outputs.length}` : ""}`
      : `Reformatter Job\nID: ${jobId}\n(Status unavailable)`;
    const rows = [[{ text: "🔄 Refresh", callback_data: `tools:reform:status:${jobId}` }], [{ text: "⬅️ Back", callback_data: "nav:tools" }]];
    await send(chatId, text, inlineKbd(rows)); return true;
  }

  if (data === "tools:repurposer") {
    setFlow(chatId, { step: "tools_repurpose_src" });
    await send(chatId, "♻️ Repurposer\n\nSend source media (video or image):", cancelKbd());
    return true;
  }
  if (data.startsWith("tools:repurpose:status:")) {
    const jobId = data.split(":").pop();
    const r = await apiRepurposerStatus(userId, jobId);
    const text = r.ok
      ? `♻️ Repurposer Job\nID: ${jobId}\nStatus: ${r.status || "processing"}\n${Array.isArray(r.outputs) ? `Outputs: ${r.outputs.length}` : ""}`
      : `Status check: ${r.message}`;
    const rows = [[{ text: "🔄 Refresh", callback_data: `tools:repurpose:status:${jobId}` }], [{ text: "⬅️ Back", callback_data: "nav:tools" }]];
    await send(chatId, text, inlineKbd(rows)); return true;
  }

  return false;
}
