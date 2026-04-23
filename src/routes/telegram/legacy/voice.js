import prisma from "../../../lib/prisma.js";
import { getFlow, setFlow, clearFlow } from "./state.js";
import { send, sendImg, inlineKbd, isHttpUrl, formatDate, modelListToInlineRows, chunkInlineButtons, formatModelButtonText } from "./helpers.js";
import { resolveAudio, mediaMismatchHint } from "./media.js";
import { cancelKbd } from "./keyboards.js";
import { ensureAuth } from "./auth.js";
import {
  apiVoices, apiModelVoiceList, apiGenerateVoiceAudio,
  apiCloneVoice, apiVoicePreview, apiDeleteVoice,
  apiVoiceDesignPreviews, apiVoiceDesignConfirm,
} from "./api.js";

const VOICE_DESIGN_GENDERS = ["male", "female"];
const VOICE_DESIGN_AGES = ["young", "middle_aged", "old"];
const VOICE_DESIGN_ACCENTS = ["american", "british", "australian", "irish", "indian"];
const VOICE_DESIGN_STYLES = ["narration", "conversational", "news", "training", "meditation"];

function voiceMenuKbd() {
  return inlineKbd([
    [{ text: "🔊 Generate Audio (TTS)", callback_data: "voice:tts" }],
    [{ text: "🎙 Clone a Voice", callback_data: "voice:clone" }],
    [{ text: "🎨 Design Voice (AI)", callback_data: "voice:design" }],
    [{ text: "📋 Manage Voices", callback_data: "voice:manage" }],
    [{ text: "⬅️ Back", callback_data: "nav:home" }],
  ]);
}

export async function renderVoiceStudio(chatId, userId) {
  const voices = await apiVoices(userId);
  const count = voices.voices?.length || 0;
  await send(chatId, `🎤 Voice Studio\n\n${count} voice(s) cloned across your models.`, voiceMenuKbd());
}

// ── Message handler ───────────────────────────────────────────
export async function handleVoiceMessage(chatId, message, text) {
  const flow = getFlow(chatId);
  if (!flow?.step?.startsWith("voice_")) return false;
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;
  const t = String(text || "").trim();
  if (t.toLowerCase() === "cancel") { clearFlow(chatId); await renderVoiceStudio(chatId, userId); return true; }

  // TTS: script input
  if (flow.step === "voice_tts_script") {
    if (t.length < 3) { await send(chatId, "Enter the script text (3+ characters):", cancelKbd()); return true; }
    clearFlow(chatId);
    await send(chatId, "⏳ Generating voice audio...", null);
    const r = await apiGenerateVoiceAudio(userId, flow.modelId || "", flow.voiceId, t);
    if (!r.ok) { await send(chatId, `❌ Failed: ${r.message}`, voiceMenuKbd()); return true; }
    const rows = [];
    if (r.url && isHttpUrl(r.url)) rows.push([{ text: "▶️ Play audio", url: r.url }]);
    rows.push([{ text: "🔊 Generate more", callback_data: "voice:tts" }, { text: "⬅️ Back", callback_data: "nav:voice" }]);
    await send(chatId, "✅ Audio generated!", inlineKbd(rows));
    return true;
  }

  // Clone: audio upload
  if (flow.step === "voice_clone_audio") {
    const audio = await resolveAudio(message).catch(() => null);
    if (!audio) {
      await send(chatId, mediaMismatchHint("audio", message) || "Send an audio file (mp3, wav, or voice message — 5–60s of clear speech):", cancelKbd());
      return true;
    }
    clearFlow(chatId);
    await send(chatId, "⏳ Cloning voice...", null);
    const r = await apiCloneVoice(userId, flow.modelId, audio.buffer, audio.fileName, audio.mimeType);
    if (!r.ok) { await send(chatId, `❌ Voice clone failed: ${r.message}`, voiceMenuKbd()); return true; }
    await send(chatId, "✅ Voice cloned and saved to your model!", inlineKbd([
      [{ text: "🔊 Generate audio", callback_data: "voice:tts" }],
      [{ text: "⬅️ Back", callback_data: "nav:voice" }],
    ]));
    return true;
  }

  // Design: description input
  if (flow.step === "voice_design_desc") {
    if (t.length < 5) { await send(chatId, "Describe the voice (5+ chars):", cancelKbd()); return true; }
    const model = flow.modelId;
    // Build voiceDescription from selections + typed text (server expects single voiceDescription string)
    const genderLabel = (flow.designGender || "female").replace(/_/g, " ");
    const ageLabel = (flow.designAge || "middle_aged").replace(/_/g, " ");
    const accentLabel = flow.designAccent || "american";
    const voiceDescription = `A ${ageLabel} ${genderLabel} voice with ${accentLabel} accent. ${t}`.trim();
    // Lock step to prevent double-submit
    setFlow(chatId, { ...flow, step: "voice_design_loading" });
    await send(chatId, "⏳ Generating voice design previews...", null);
    const r = await apiVoiceDesignPreviews(userId, model, voiceDescription);
    if (!r.ok) { await send(chatId, `❌ Design failed: ${r.message}`, voiceMenuKbd()); return true; }
    const previews = r.previews || [];
    if (!previews.length) { await send(chatId, "No previews returned. Try a different description.", voiceMenuKbd()); return true; }
    // Store voiceDescription in flow for the confirm step
    setFlow(chatId, { ...flow, step: "voice_design_pick", previews, voiceDescription });
    const rows = previews.map((p, i) => [{ text: `🎵 Preview ${i + 1}${p.name ? ` — ${p.name}` : ""}`, callback_data: `voice:design:pick:${i}` }]);
    if (previews.some((p) => isHttpUrl(p.previewUrl || p.url))) {
      rows.unshift([{ text: "▶️ Listen to previews below", callback_data: "noop" }]);
    }
    rows.push([{ text: "Cancel", callback_data: "nav:voice" }]);
    await send(chatId, `${previews.length} voice preview(s) generated. Pick one to save:`, inlineKbd(rows));
    for (const p of previews) {
      const previewUrl = p.previewUrl || p.url || "";
      if (isHttpUrl(previewUrl)) await send(chatId, previewUrl, null).catch(() => {});
    }
    return true;
  }

  // Settings: new display name
  if (flow.step === "voice_design_name") {
    const name = t.length >= 2 ? t : null;
    clearFlow(chatId);
    await send(chatId, "⏳ Saving voice...", null);
    const r = await apiVoiceDesignConfirm(userId, flow.modelId, flow.selectedPreviewId, flow.voiceDescription || "");
    if (!r.ok) { await send(chatId, `❌ Failed to save: ${r.message}`, voiceMenuKbd()); return true; }
    await send(chatId, `✅ Voice${name ? ` "${name}"` : ""} saved to model!`, inlineKbd([
      [{ text: "🔊 Generate audio", callback_data: "voice:tts" }],
      [{ text: "⬅️ Back", callback_data: "nav:voice" }],
    ]));
    return true;
  }

  return false;
}

// ── Callback handler ──────────────────────────────────────────
export async function handleVoiceCallback(chatId, data, callbackId = "") {
  const session = await ensureAuth(chatId);
  if (!session) return true;
  const { userId } = session;

  if (data === "nav:voice") { await renderVoiceStudio(chatId, userId); return true; }

  // ── TTS ───────────────────────────────────────────────────────
  if (data === "voice:tts") {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No models yet."); return true; }
    const rows = modelListToInlineRows(models, (m) => `voice:tts:model:${m.id}`);
    rows.push([{ text: "Cancel", callback_data: "nav:voice" }]);
    await send(chatId, `🔊 TTS — pick model (${models.length}):`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("voice:tts:model:")) {
    const modelId = data.split(":").pop();
    const voices = await apiModelVoiceList(userId, modelId);
    if (!voices.ok || !voices.voices.length) {
      await send(chatId, "No voices for this model. Clone or design one first.", inlineKbd([
        [{ text: "🎙 Clone Voice", callback_data: "voice:clone" }],
        [{ text: "🎨 Design Voice", callback_data: "voice:design" }],
        [{ text: "⬅️ Back", callback_data: "nav:voice" }],
      ]));
      return true;
    }
    // Store modelId in flow so voice script step can pass it to generate-audio endpoint
    setFlow(chatId, { ...(getFlow(chatId) || {}), ttsModelId: modelId });
    const vBtns = voices.voices.map((v) => ({
      text: formatModelButtonText(`${v.name || v.id} · ${v.status || "ready"}`, 26),
      callback_data: `voice:tts:voice:${v.id}`,
    }));
    const rows = chunkInlineButtons(vBtns, 2);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:voice" }]);
    await send(chatId, "Select voice:", inlineKbd(rows)); return true;
  }
  if (data.startsWith("voice:tts:voice:")) {
    const voiceId = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { step: "voice_tts_script", voiceId, modelId: f?.ttsModelId || "" });
    await send(chatId, "Enter the script (what will be spoken):", cancelKbd()); return true;
  }

  // ── Clone ─────────────────────────────────────────────────────
  if (data === "voice:clone") {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "Create a model first."); return true; }
    const rows = modelListToInlineRows(models, (m) => `voice:clone:model:${m.id}`);
    rows.push([{ text: "Cancel", callback_data: "nav:voice" }]);
    await send(chatId, `🎙 Clone voice — pick model (${models.length}):`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("voice:clone:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "voice_clone_audio", modelId });
    await send(chatId, "Send an audio file (mp3, wav, voice message — 5–60s of clear speech):", cancelKbd()); return true;
  }

  // ── Design (AI generate voice from description) ───────────────
  if (data === "voice:design") {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "Create a model first."); return true; }
    const rows = modelListToInlineRows(models, (m) => `voice:design:model:${m.id}`);
    rows.push([{ text: "Cancel", callback_data: "nav:voice" }]);
    await send(chatId, `🎨 Design voice — attach to model (${models.length}):`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("voice:design:model:")) {
    const modelId = data.split(":").pop();
    setFlow(chatId, { step: "voice_design_gender", modelId });
    await send(chatId, "Select gender:", inlineKbd([
      [{ text: "Female", callback_data: `voice:design:gender:female` }, { text: "Male", callback_data: `voice:design:gender:male` }],
    ]));
    return true;
  }
  if (data.startsWith("voice:design:gender:")) {
    const gender = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, step: "voice_design_age", designGender: gender });
    await send(chatId, "Select age:", inlineKbd([
      [{ text: "Young", callback_data: "voice:design:age:young" }, { text: "Middle-aged", callback_data: "voice:design:age:middle_aged" }, { text: "Old", callback_data: "voice:design:age:old" }],
    ]));
    return true;
  }
  if (data.startsWith("voice:design:age:")) {
    const age = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, step: "voice_design_accent", designAge: age });
    await send(chatId, "Select accent:", inlineKbd([
      [{ text: "American", callback_data: "voice:design:accent:american" }, { text: "British", callback_data: "voice:design:accent:british" }],
      [{ text: "Australian", callback_data: "voice:design:accent:australian" }, { text: "Irish", callback_data: "voice:design:accent:irish" }],
      [{ text: "Indian", callback_data: "voice:design:accent:indian" }],
    ]));
    return true;
  }
  if (data.startsWith("voice:design:accent:")) {
    const accent = data.split(":").pop();
    const f = getFlow(chatId);
    setFlow(chatId, { ...f, step: "voice_design_desc", designAccent: accent });
    await send(chatId, "Describe the voice you want (e.g. 'warm and friendly narrator with a calm tone'):", cancelKbd());
    return true;
  }
  if (data.startsWith("voice:design:pick:")) {
    const idx = Number(data.split(":").pop());
    const f = getFlow(chatId);
    const preview = f?.previews?.[idx];
    if (!preview) { await renderVoiceStudio(chatId, userId); return true; }
    // Carry voiceDescription forward so confirm step has it
    setFlow(chatId, { ...f, step: "voice_design_name", selectedPreviewId: preview.id || preview.previewId || String(idx), voiceDescription: f?.voiceDescription || "" });
    await send(chatId, `✅ Preview ${idx + 1} selected.\n\nSave it (type a name or just press Skip):`, { keyboard: [["Skip", "Cancel"]], resize_keyboard: true, one_time_keyboard: true });
    return true;
  }

  // ── Manage voices ─────────────────────────────────────────────
  if (data === "voice:manage") {
    const models = await prisma.savedModel.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 });
    if (!models.length) { await send(chatId, "No models yet."); return true; }
    const rows = modelListToInlineRows(models, (m) => `voice:manage:model:${m.id}`);
    rows.push([{ text: "⬅️ Back", callback_data: "nav:voice" }]);
    await send(chatId, `📋 Manage voices — pick model (${models.length}):`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("voice:manage:model:")) {
    const modelId = data.split(":").pop();
    // Store modelId in flow so child callbacks (view/delete) don't need dual IDs
    setFlow(chatId, { ...(getFlow(chatId) || {}), voiceModelId: modelId });
    const voices = await apiModelVoiceList(userId, modelId);
    const list = voices.voices || [];
    if (!list.length) {
      await send(chatId, "No voices for this model.", inlineKbd([
        [{ text: "🎙 Clone", callback_data: `voice:clone:model:${modelId}` }, { text: "🎨 Design", callback_data: `voice:design:model:${modelId}` }],
        [{ text: "⬅️ Back", callback_data: "voice:manage" }],
      ]));
      return true;
    }
    // Only voiceId in callback_data ("voice:manage:view:" = 18 + 36 = 54 bytes — safe)
    const rows = list.map((v) => [
      { text: `${v.name || v.id.slice(0, 20)}`, callback_data: `voice:view:${v.id}` },
    ]);
    rows.push([{ text: "⬅️ Back", callback_data: "voice:manage" }]);
    await send(chatId, `🎤 Voices for this model (${list.length}):`, inlineKbd(rows)); return true;
  }
  if (data.startsWith("voice:view:")) {
    const voiceId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.voiceModelId || "";
    await send(chatId, `Voice: ${voiceId.slice(0, 12)}…`, inlineKbd([
      [{ text: "▶️ Preview", callback_data: `voice:preview:${voiceId}` }],
      [{ text: "🗑 Delete", callback_data: `voice:del:${voiceId}` }],
      [{ text: "⬅️ Back", callback_data: `voice:manage:model:${modelId}` }],
    ]));
    return true;
  }
  if (data.startsWith("voice:preview:")) {
    const voiceId = data.split(":").pop();
    await send(chatId, "⏳ Loading preview...", null);
    const r = await apiVoicePreview(userId, voiceId);
    if (!r.ok || !r.url) { await send(chatId, "No preview available for this voice."); return true; }
    await send(chatId, "▶️ Voice preview:", inlineKbd([[{ text: "🔊 Play", url: r.url }]]));
    return true;
  }
  if (data.startsWith("voice:del:ok:")) {
    const voiceId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.voiceModelId || "";
    const r = await apiDeleteVoice(userId, modelId, voiceId);
    if (!r.ok) { await send(chatId, `❌ Delete failed: ${r.message}`); return true; }
    await send(chatId, "✅ Voice deleted.", inlineKbd([[{ text: "⬅️ Back", callback_data: `voice:manage:model:${modelId}` }]]));
    return true;
  }
  if (data.startsWith("voice:del:")) {
    const voiceId = data.split(":").pop();
    const flow = getFlow(chatId);
    const modelId = flow?.voiceModelId || "";
    await send(chatId, "Delete this voice?", inlineKbd([
      [{ text: "🗑 Yes, delete", callback_data: `voice:del:ok:${voiceId}` }],
      [{ text: "Cancel", callback_data: `voice:manage:model:${modelId}` }],
    ]));
    return true;
  }

  return false;
}
