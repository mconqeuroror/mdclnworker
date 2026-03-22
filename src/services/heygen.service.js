/**
 * HeyGen Photo Avatar IV API service
 *
 * Environment variables:
 *   HEYGEN_API_KEY  — HeyGen API key
 *
 * Flow:
 *   1. uploadAsset(buffer, filename, mimeType) → assetId
 *   2. createPhotoAvatar(imageAssetId, name)   → groupId
 *   3. pollAvatarStatus(groupId)               → { status, avatarId }
 *   4. generateVideo(avatarId, audioAssetId, opts) → videoId
 *   5. getVideoStatus(videoId)                 → { status, videoUrl, duration }
 *   6. deleteAvatar(groupId)
 */

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_BASE = "https://api.heygen.com";

if (!HEYGEN_API_KEY) {
  console.warn("⚠️  HEYGEN_API_KEY not set — Real Avatars feature will not work");
}

function heygenHeaders(extra = {}) {
  return {
    "X-Api-Key": HEYGEN_API_KEY || "",
    "Accept": "application/json",
    ...extra,
  };
}

async function heygenFetch(path, init = {}) {
  const url = `${HEYGEN_BASE}${path}`;
  const resp = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    const msg = data?.message || data?.error || text.slice(0, 300);
    throw new Error(`HeyGen ${init.method || "GET"} ${path} → ${resp.status}: ${msg}`);
  }
  return data;
}

// ── Asset upload ──────────────────────────────────────────────────────────────

/**
 * Upload a file (image or audio) to HeyGen's asset storage.
 * Returns the asset `id` (asset_key used in subsequent calls).
 */
export async function uploadAsset(buffer, filename, mimeType = "application/octet-stream") {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const data = await heygenFetch("/v1/asset", {
    method: "POST",
    headers: heygenHeaders(), // Content-Type set automatically by FormData
    body: form,
  });

  const assetId = data?.data?.id || data?.data?.asset_id;
  if (!assetId) throw new Error(`HeyGen asset upload: no ID in response: ${JSON.stringify(data)}`);
  console.log(`✅ [HeyGen] Asset uploaded: ${assetId}`);
  return assetId;
}

// ── Photo Avatar ──────────────────────────────────────────────────────────────

/**
 * Create a Photo Avatar group from an uploaded image asset.
 * Returns the `avatar_group_id` — poll getPhotoAvatarStatus() for readiness.
 */
export async function createPhotoAvatar(imageAssetId, name = "Avatar") {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");

  const data = await heygenFetch("/v2/photo_avatar", {
    method: "POST",
    headers: heygenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      image_key: imageAssetId,
      name,
      circle_background_color: "#F0F0F0",
    }),
  });

  const groupId = data?.data?.avatar_group_id || data?.data?.id;
  if (!groupId) throw new Error(`HeyGen create avatar: no group_id in response: ${JSON.stringify(data)}`);
  console.log(`✅ [HeyGen] Photo avatar submitted: group=${groupId}`);
  return groupId;
}

/**
 * Get the processing status of a Photo Avatar group.
 * @returns {{ status: string, avatarId: string|null }}
 *   status: "processing" | "completed" | "failed"
 *   avatarId: the first avatar_id from the group when completed
 */
export async function getPhotoAvatarStatus(groupId) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");

  const data = await heygenFetch(`/v2/photo_avatar/${groupId}`);
  const group = data?.data;

  if (!group) throw new Error(`HeyGen avatar status: empty response for ${groupId}`);

  const rawStatus = (group.status || "").toLowerCase();
  let status = "processing";
  if (rawStatus === "completed" || rawStatus === "active" || rawStatus === "success") status = "completed";
  else if (rawStatus === "failed" || rawStatus === "error") status = "failed";

  const avatarList = group.avatar_list || [];
  const avatarId = avatarList[0]?.avatar_id || null;

  return { status, avatarId, raw: group };
}

/**
 * Delete a Photo Avatar group from HeyGen.
 */
export async function deletePhotoAvatar(groupId) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");

  try {
    await heygenFetch(`/v2/photo_avatar/${groupId}`, { method: "DELETE" });
    console.log(`🗑️  [HeyGen] Avatar group ${groupId} deleted`);
  } catch (err) {
    // 404 = already gone, ignore
    if (!err.message.includes("404")) throw err;
    console.warn(`[HeyGen] Avatar ${groupId} not found on delete — already removed`);
  }
}

// ── Video generation ──────────────────────────────────────────────────────────

/**
 * Generate a talking-head video using a Photo Avatar and a pre-generated audio file.
 * @param {string} avatarId     - the avatar_id from the group
 * @param {string} audioAssetId - HeyGen asset ID of the uploaded MP3/WAV
 * @param {object} opts
 * @param {number} opts.width   - video width (default 1280)
 * @param {number} opts.height  - video height (default 720)
 * @returns {string} HeyGen video_id
 */
export async function generateAvatarVideo(avatarId, audioAssetId, opts = {}) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");

  const width  = opts.width  ?? 1280;
  const height = opts.height ?? 720;

  const payload = {
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: avatarId,
          avatar_style: "normal",
        },
        voice: {
          type: "audio",
          audio_asset_id: audioAssetId,
        },
        background: opts.backgroundUrl
          ? { type: "image", url: opts.backgroundUrl }
          : { type: "color", value: "#1a1a2e" },
      },
    ],
    dimension: { width, height },
    test: false,
  };

  const data = await heygenFetch("/v2/video/generate", {
    method: "POST",
    headers: heygenHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  const videoId = data?.data?.video_id || data?.video_id;
  if (!videoId) throw new Error(`HeyGen generate video: no video_id: ${JSON.stringify(data)}`);
  console.log(`✅ [HeyGen] Video generation started: ${videoId}`);
  return videoId;
}

/**
 * Poll HeyGen for video completion status.
 * @returns {{ status: string, videoUrl: string|null, duration: number|null }}
 *   status: "processing" | "completed" | "failed"
 */
export async function getVideoStatus(videoId) {
  if (!HEYGEN_API_KEY) throw new Error("HEYGEN_API_KEY is not configured");

  const data = await heygenFetch(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
  const d = data?.data;

  const rawStatus = (d?.status || "").toLowerCase();
  let status = "processing";
  if (rawStatus === "completed" || rawStatus === "success" || rawStatus === "finished") status = "completed";
  else if (rawStatus === "failed" || rawStatus === "error") status = "failed";

  return {
    status,
    videoUrl: d?.video_url || d?.url || null,
    thumbnailUrl: d?.thumbnail_url || null,
    duration: d?.duration ?? null,
  };
}

// ── Background polling helpers ────────────────────────────────────────────────

/**
 * Poll HeyGen avatar creation until completed or failed (max ~10 min).
 * Returns { avatarId } on success.
 */
export async function pollAvatarUntilReady(groupId, maxMs = 10 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  let delay = 15_000; // start with 15s

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 60_000); // back-off up to 60s

    const { status, avatarId } = await getPhotoAvatarStatus(groupId);
    if (status === "completed" && avatarId) return { avatarId };
    if (status === "failed") throw new Error("HeyGen avatar creation failed on their end");
  }

  throw new Error("HeyGen avatar creation timed out after 10 minutes");
}

/**
 * Poll HeyGen video generation until completed or failed (max ~15 min).
 */
export async function pollVideoUntilReady(videoId, maxMs = 15 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  let delay = 10_000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 30_000);

    const result = await getVideoStatus(videoId);
    if (result.status === "completed") return result;
    if (result.status === "failed") throw new Error("HeyGen video generation failed");
  }

  throw new Error("HeyGen video generation timed out after 15 minutes");
}
