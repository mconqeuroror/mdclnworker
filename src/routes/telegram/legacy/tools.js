import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, isHttpUrl } from "./helpers.js";
import {
  resolveImage,
  resolveVideo,
  downloadImageBufferFromUrl,
  mediaMismatchHint,
  mediaMismatchHintImageOrVideo,
} from "./media.js";
import { cancelKbd, toolsMenuKbd, skipCancelKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import {
  apiSubmitUpscale,
  apiUpscaleStatus,
  apiSubmitReformatter,
  apiReformatterStatus,
  apiSubmitRepurposer,
  apiRepurposerStatus,
} from "./api.js";
import { appUrl } from "./config.js";
import { buildTelegramRepurposeSettings } from "./repurpose-presets.js";

async function getUpscalerCreditCost() {
  try {
    const { getGenerationPricing } = await import("../../../services/generation-pricing.service.js");
    const p = await getGenerationPricing();
    return Math.max(1, Number(p.upscalerImage ?? 5));
  } catch {
    return 5;
  }
}

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
      const cost = await getUpscalerCreditCost();
      await send(
        chatId,
        mediaMismatchHint("image", message) || `Send the image as a photo or image file (max 20MB). Cost: ${cost} credits when submitted.`,
        cancelKbd(),
      );
      return true;
    }
    clearFlow(chatId);
    await send(chatId, "⏳ Uploading and starting upscale…", null);
    try {
      const { buffer, mimeType, fileName } = await downloadImageBufferFromUrl(url);
      const r = await apiSubmitUpscale(userId, buffer, mimeType, fileName);
      if (!r.ok) { await send(chatId, `❌ Upscale failed: ${r.message}`); return true; }
      const cr = r.creditsUsed != null ? `\n💳 Credits charged: ${r.creditsUsed}` : "";
      await send(chatId, `✅ Upscale started!${cr}\nJob ID: ${r.generationId}`, inlineKbd([
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
      const fb =
        mediaMismatchHintImageOrVideo(message)
        || "Send media as a photo, video, or document file (no credits charged).";
      await send(chatId, fb, cancelKbd());
      return true;
    }
    const originalFileName = String(message?.document?.file_name || message?.video?.file_name || "upload");
    clearFlow(chatId);
    await send(chatId, "⏳ Starting reformatter…", null);
    const r = await apiSubmitReformatter(userId, url, originalFileName);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    await send(chatId, "✅ Reformatter started (no credits).\nJob ID: " + r.jobId, inlineKbd([
      [{ text: "🔄 Check status", callback_data: `tools:reform:status:${r.jobId}` }],
      [{ text: "⬅️ Back to tools", callback_data: "nav:tools" }],
    ]));
    return true;
  }

  // ── Repurposer ────────────────────────────────────────────────
  if (flow.step === "tools_repurpose_src") {
    const url = await resolveImage(message).catch(() => null) || await resolveVideo(message).catch(() => null);
    if (!url || !isHttpUrl(url)) {
      const preset = flow.repurposePreset === "aggressive" ? "Aggressive" : "Safe";
      const fb =
        mediaMismatchHintImageOrVideo(message)
        || `Send source media (${preset} preset). Photo, video, or file:`;
      await send(chatId, fb, cancelKbd());
      return true;
    }
    setFlow(chatId, { ...flow, step: "tools_repurpose_wm", sourceUrl: url });
    await send(chatId, "✅ Source received.\n\nSend a watermark image or tap Skip:", skipCancelKbd());
    return true;
  }
  if (flow.step === "tools_repurpose_wm") {
    const skip = t.toLowerCase() === "skip";
    let watermarkUrl = null;
    if (!skip) {
      watermarkUrl = await resolveImage(message).catch(() => null);
      if (!watermarkUrl) {
        await send(chatId, mediaMismatchHint("image", message) || "Send a watermark image or tap Skip:", skipCancelKbd());
        return true;
      }
    }
    const preset = flow.repurposePreset === "aggressive" ? "aggressive" : "safe";
    const settings = buildTelegramRepurposeSettings(preset);
    clearFlow(chatId);
    await send(chatId, "⏳ Running repurposer (worker)…", null);
    const r = await apiSubmitRepurposer(userId, flow.sourceUrl, watermarkUrl, settings);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`); return true; }
    const outUrl = r.outputs?.[0]?.fileUrl || r.outputs?.[0]?.file_url;
    const sub =
      "\n💳 Chat presets: no extra credits (Smart optimization off). Mini App adds +10 cr if you enable AI optimization.";
    if (outUrl && isHttpUrl(outUrl)) {
      await send(chatId, `✅ Repurposer finished!${sub}`, inlineKbd([
        [{ text: "▶️ Open output", url: outUrl }],
        [{ text: "🔄 Job status", callback_data: `tools:repurpose:status:${r.jobId}` }],
        [{ text: "⬅️ Back to tools", callback_data: "nav:tools" }],
      ]));
      return true;
    }
    await send(chatId, `✅ Repurposer done.\nJob ID: ${r.jobId}${sub}`, inlineKbd([
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
    const cost = await getUpscalerCreditCost();
    await send(
      chatId,
      `🔍 Upscaler\n\n💳 Cost: ${cost} credits per image (deducted when the job is submitted).\n\nSend the image to upscale (photo or image file, max 20MB):`,
      cancelKbd(),
    );
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
    await send(
      chatId,
      "🎞 Reformatter\n\n💳 Cost: free (no credits).\nConverts media to MP4 or JPEG via the cloud worker.\n\nSend a photo, video, or document file:",
      cancelKbd(),
    );
    return true;
  }
  if (data.startsWith("tools:reform:status:")) {
    const jobId = data.split(":").pop();
    const r = await apiReformatterStatus(userId, jobId);
    const text = r.ok
      ? `🎞 Reformatter\nID: ${jobId}\nStatus: ${r.status || "?"}\n${r.outputUrl ? `Output: ${r.outputUrl}` : ""}\n${r.error ? `Error: ${r.error}` : ""}`
      : `Reformatter status: ${r.message}`;
    const rows = [];
    if (r.ok && (r.status === "processing" || r.status === "pending")) {
      rows.push([{ text: "🔄 Refresh", callback_data: `tools:reform:status:${jobId}` }]);
    }
    if (r.ok && r.outputUrl && isHttpUrl(r.outputUrl)) {
      rows.push([{ text: "▶️ View output", url: r.outputUrl }]);
    }
    rows.push([{ text: "⬅️ Back", callback_data: "nav:tools" }]);
    await send(chatId, text, inlineKbd(rows));
    return true;
  }

  if (data === "tools:repurposer") {
    await send(
      chatId,
      "♻️ Repurposer\n\nPick a preset (same idea as the Mini App). Requires an active subscription.\n\n"
        + "• Safe — lighter fingerprint changes\n"
        + "• Aggressive — stronger uniqueness\n\n"
        + "For custom metadata, device lists, copies, and AI optimization (+10 credits), open the Mini App.",
      inlineKbd([
        [{ text: "🛡 Safe", callback_data: "tools:repurpose:pref:safe" }, { text: "⚡ Aggressive", callback_data: "tools:repurpose:pref:aggressive" }],
        [{ text: "🎛 Advanced (Mini App)", web_app: { url: appUrl("repurposer") } }],
        [{ text: "⬅️ Back", callback_data: "nav:tools" }],
      ]),
    );
    return true;
  }
  if (data === "tools:repurpose:pref:safe" || data === "tools:repurpose:pref:aggressive") {
    const aggressive = data.endsWith("aggressive");
    setFlow(chatId, { step: "tools_repurpose_src", repurposePreset: aggressive ? "aggressive" : "safe" });
    await send(
      chatId,
      `${aggressive ? "⚡ Aggressive" : "🛡 Safe"} preset.\n\n💳 No extra credits in chat (Smart optimization off).\n\nSend source video or image:`,
      cancelKbd(),
    );
    return true;
  }
  if (data.startsWith("tools:repurpose:status:")) {
    const jobId = data.split(":").pop();
    const r = await apiRepurposerStatus(userId, jobId);
    const out0 = Array.isArray(r.outputs) && r.outputs[0] ? r.outputs[0] : null;
    const outUrl = out0?.fileUrl && isHttpUrl(out0.fileUrl) ? out0.fileUrl : null;
    const text = r.ok
      ? `♻️ Repurposer\nID: ${jobId}\nStatus: ${r.status || "?"}\n${r.message ? `${r.message}\n` : ""}${r.error ? `Error: ${r.error}` : ""}`
      : `Status: ${r.message}`;
    const rows = [];
    if (r.ok && r.status !== "completed" && r.status !== "failed") {
      rows.push([{ text: "🔄 Refresh", callback_data: `tools:repurpose:status:${jobId}` }]);
    }
    if (outUrl) rows.push([{ text: "▶️ Open output", url: outUrl }]);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:tools" }]);
    await send(chatId, text, inlineKbd(rows));
    return true;
  }

  return false;
}
