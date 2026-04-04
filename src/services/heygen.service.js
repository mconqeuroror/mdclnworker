/**
 * HeyGen Photo Avatar IV + AV4 service.
 * Spec-aligned endpoints:
 * - POST upload.heygen.com/v1/asset
 * - POST /v2/photo_avatar/avatar_group/create
 * - POST /v2/photo_avatar/avatar_group/add
 * - POST /v2/photo_avatar/train
 * - GET  /v2/photo_avatar/generation/{generation_id}
 * - POST /v2/video/generate
 * - GET  /v2/videos/{video_id} (fallback /v1/video_status.get)
 */

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_BASE = "https://api.heygen.com";
const HEYGEN_UPLOAD_BASE = "https://upload.heygen.com";

if (!HEYGEN_API_KEY) {
  console.warn("⚠️ HEYGEN_API_KEY not set — Real Avatars feature will not work");
}

function heygenHeaders(extra = {}) {
  return {
    "X-Api-Key": HEYGEN_API_KEY || "",
    Accept: "application/json",
    ...extra,
  };
}

export function getHeygenWebhookUrl() {
  const explicit = process.env.HEYGEN_WEBHOOK_URL;
  if (explicit && String(explicit).startsWith("http")) return String(explicit).trim();
  const callbackBase = process.env.CALLBACK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || process.env.PUBLIC_URL || process.env.APP_URL;
  if (callbackBase) {
    const base = String(callbackBase).trim().replace(/\/$/, "");
    const withProtocol = base.startsWith("http") ? base : `https://${base}`;
    return `${withProtocol.replace(/\/$/, "")}/api/heygen/webhook`;
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${String(vercel).replace(/^https?:\/\//, "").replace(/\/$/, "")}/api/heygen/webhook`;
  return null;
}

async function heygenFetch(path, init = {}) {
  const url = `${HEYGEN_BASE}${path}`;
  const resp = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg = data?.message || data?.error?.message || data?.error || text.slice(0, 300);
    throw new Error(`HeyGen ${init.method || "GET"} ${path} -> ${resp.status}: ${msg}`);
  }
  if (data?.error) {
    const errMessage = typeof data.error === "string" ? data.error : (data.error?.message || JSON.stringify(data.error));
    if (errMessage) throw new Error(`HeyGen ${path} returned error: ${errMessage}`);
  }
  return data;
}

async function heygenUploadFetch(path, init = {}) {
  const url = `${HEYGEN_UPLOAD_BASE}${path}`;
  const resp = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg = data?.message || data?.error?.message || data?.error || text.slice(0, 300);
    throw new Error(`HeyGen Upload ${init.method || "GET"} ${path} -> ${resp.status}: ${msg}`);
  }
  if (data?.error) {
    const errMessage = typeof data.error === "string" ? data.error : (data.error?.message || JSON.stringify(data.error));
    if (errMessage) throw new Error(`HeyGen upload ${path} returned error: ${errMessage}`);
  }
  return data;
}

function normalizeProcessingStatus(rawStatus) {
  const s = String(rawStatus || "").toLowerCase();
  if (["completed", "success", "succeeded", "active", "finished", "ready"].includes(s)) return "completed";
  if (["failed", "fail", "error"].includes(s)) return "failed";
  return "processing";
}

export async function uploadAsset(buffer, filename, mimeType = "application/octet-stream", assetTypeOverride = null) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  // Official upload endpoint: upload.heygen.com/v1/asset with raw binary body.
  const data = await heygenUploadFetch("/v1/asset", {
    method: "POST",
    headers: {
      "X-API-KEY": HEYGEN_API_KEY || "",
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${String(filename || "upload.bin").replace(/"/g, "")}"`,
      Accept: "application/json",
    },
    body: buffer,
    signal: AbortSignal.timeout(60_000),
  });

  const uploaded = data?.data || {};
  const imageKey = uploaded.image_key || uploaded.asset_key || uploaded.key || null;
  const url = uploaded.url || null;
  const assetId = uploaded.id || uploaded.asset_id || null;
  if (!imageKey && !url && !assetId) {
    throw new Error(`HeyGen asset upload returned no usable key/url/id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { imageKey, url, assetId };
}

export async function createPhotoAvatarGroup(imageKey, name = "Avatar") {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  const data = await heygenFetch("/v2/photo_avatar/avatar_group/create", {
    method: "POST",
    headers: heygenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name,
      image_key: imageKey,
    }),
  });
  const groupId = data?.data?.group_id || data?.data?.avatar_group_id || data?.data?.id || null;
  if (!groupId) throw new Error(`HeyGen create group returned no group_id: ${JSON.stringify(data).slice(0, 300)}`);
  return groupId;
}

export async function addLookToAvatarGroup(groupId, imageKeys = []) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  if (!groupId) throw new Error("groupId is required");
  if (!Array.isArray(imageKeys) || imageKeys.length === 0) {
    throw new Error("imageKeys must include at least one uploaded image_key");
  }
  const data = await heygenFetch("/v2/photo_avatar/avatar_group/add", {
    method: "POST",
    headers: heygenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      group_id: groupId,
      image_keys: imageKeys,
    }),
  });
  const generationId = data?.data?.generation_id || data?.data?.id || null;
  return { generationId, raw: data?.data || null };
}

export async function trainPhotoAvatarGroup(groupId) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  if (!groupId) throw new Error("groupId is required");
  return heygenFetch("/v2/photo_avatar/train", {
    method: "POST",
    headers: heygenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ group_id: groupId }),
  });
}

export async function getPhotoAvatarStatus(id) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  let row = null;
  try {
    const data = await heygenFetch(`/v2/photo_avatar/generation/${encodeURIComponent(id)}`);
    row = data?.data || {};
  } catch (error) {
    const fallback = await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(id)}`);
    row = fallback?.data || {};
  }
  const status = normalizeProcessingStatus(row.status || row.state);
  const avatarId =
    row.avatar_id
    || row.avatarId
    || row?.result?.avatar_id
    || row?.result?.avatarId
    || row?.avatar?.id
    || null;
  return { status, avatarId, raw: row };
}

export async function deletePhotoAvatar(avatarId) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  if (!avatarId) return;
  await heygenFetch(`/v2/photo_avatar/${encodeURIComponent(avatarId)}`, { method: "DELETE" });
}

export async function deletePhotoAvatarGroup(groupId) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  if (!groupId) return;
  await heygenFetch(`/v2/photo_avatar/avatar_group/${encodeURIComponent(groupId)}`, { method: "DELETE" });
}

export async function generateAvatarVideo({
  avatarId,
  inputText,
  heygenVoiceId,
  width = 1920,
  height = 1080,
  aspectRatio = "16:9",
  title = "Modelclone Avatar Video",
  test = false,
  callbackId = null,
}) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  if (!avatarId) throw new Error("avatarId is required");
  if (!inputText?.trim()) throw new Error("inputText is required");
  if (!heygenVoiceId?.trim()) throw new Error("HeyGen voice_id is required");

  const payload = {
    title,
    callback_id: callbackId ? String(callbackId) : undefined,
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: avatarId,
        },
        voice: {
          type: "text",
          voice_id: String(heygenVoiceId).trim(),
          input_text: String(inputText).trim(),
          elevenlabs_settings: {
            model: "eleven_v3",
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        },
        background: { type: "color", value: "#FFFFFF" },
      },
    ],
    dimension: { width, height },
    caption: false,
    test: !!test,
  };
  if (aspectRatio === "9:16" || aspectRatio === "16:9") {
    payload.aspect_ratio = aspectRatio;
  }
  const callbackUrl = getHeygenWebhookUrl();
  if (callbackUrl) payload.callback_url = callbackUrl;
  const data = await heygenFetch("/v2/video/generate", {
    method: "POST",
    headers: heygenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const videoId = data?.data?.video_id || data?.data?.id || data?.video_id || null;
  if (!videoId) throw new Error(`HeyGen AV4 generate returned no video_id: ${JSON.stringify(data).slice(0, 300)}`);
  return videoId;
}

export async function getVideoStatus(videoId) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");
  try {
    const data = await heygenFetch(`/v2/videos/${encodeURIComponent(videoId)}`);
    const row = data?.data || {};
    const status = normalizeProcessingStatus(row.status || row.state);
    return {
      status,
      videoUrl: row.video_url || row.url || null,
      thumbnailUrl: row.thumbnail_url || null,
      duration: Number(row.duration || 0) || null,
    };
  } catch (error) {
    const fallback = await heygenFetch(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
    const row = fallback?.data || {};
    const status = normalizeProcessingStatus(row.status || row.state);
    return {
      status,
      videoUrl: row.video_url || row.url || null,
      thumbnailUrl: row.thumbnail_url || null,
      duration: Number(row.duration || 0) || null,
    };
  }
}

export async function pollAvatarUntilReady(id, maxMs = 12 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  let delay = 6_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.floor(delay * 1.35), 30_000);
    const row = await getPhotoAvatarStatus(id);
    if (row.status === "completed" && row.avatarId) return { avatarId: row.avatarId };
    if (row.status === "failed") throw new Error("HeyGen photo avatar processing failed");
  }
  throw new Error("HeyGen photo avatar processing timed out");
}

export async function pollVideoUntilReady(videoId, maxMs = 20 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  let delay = 5_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.floor(delay * 1.25), 20_000);
    const row = await getVideoStatus(videoId);
    if (row.status === "completed") return row;
    if (row.status === "failed") throw new Error("HeyGen video generation failed");
  }
  throw new Error("HeyGen video generation timed out");
}
