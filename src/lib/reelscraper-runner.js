/**
 * Pure-JS Instagram reel scraper.
 *
 * No browser, no Playwright, no Apify, no Python — direct HTTPS to Instagram's
 * public GraphQL + private-API endpoints.
 *
 *   • Single-reel (scrapeSingleReelByUrl)
 *       POST https://www.instagram.com/api/graphql  (xdt_shortcode_media doc_id)
 *       Cookie-free — works anywhere, every time. This is the primary use case.
 *
 *   • Profile-reels (scrapeProfileReels)
 *       GET  https://www.instagram.com/api/v1/users/web_profile_info/?username=…
 *       POST https://www.instagram.com/api/v1/clips/user/
 *       These endpoints are heavily rate-limited for anonymous data-center IPs.
 *       For reliable profile fetching set INSTAGRAM_SESSIONID (any logged-in IG
 *       session cookie works); without it expect periodic 429s on hot accounts.
 *       A public profile-page HTML fallback is attempted when the API 429s,
 *       though Instagram has progressively stripped media data from anonymous
 *       HTML so it covers fewer profiles than it used to.
 *
 * Public surface preserved (do NOT change without updating viral-reels.service.js):
 *   - scrapeProfileReels(username, limit) -> Promise<NormalizedReel[]>
 *   - scrapeSingleReelByUrl(reelPageUrl)  -> Promise<NormalizedReel[]>  (0 or 1 items)
 *   - isReelScraperConfigured()           -> boolean
 *
 * Each NormalizedReel matches the shape the previous Playwright/Python scraper produced:
 *   {
 *     id, shortcode, url, reelUrl, postUrl,
 *     videoUrl, displayUrl, thumbnailUrl,
 *     videoViewCount, likesCount, commentsCount, sharesCount,
 *     caption, musicInfo: {songName} | null,
 *     timestamp,
 *   }
 */

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 Instagram 350.0.0.34.107";

// Public Instagram-Web app id used by every browser session — not a secret.
const DEFAULT_X_IG_APP_ID = "936619743392459";

// xdt_shortcode_media GraphQL doc id — IG occasionally rotates this; override via env.
const DEFAULT_SHORTCODE_DOC_ID = "10015901848480474";

const SHORTCODE_RE =
  /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reels?|stories|tv)\/([A-Za-z0-9_-]+)/i;

function userAgent() {
  return (process.env.INSTAGRAM_USER_AGENT || DEFAULT_USER_AGENT).trim();
}

function xIgAppId() {
  return (process.env.INSTAGRAM_X_IG_APP_ID || DEFAULT_X_IG_APP_ID).trim();
}

function shortcodeDocId() {
  return (process.env.INSTAGRAM_SHORTCODE_DOC_ID || DEFAULT_SHORTCODE_DOC_ID).trim();
}

function timeoutMs() {
  const n = parseInt(process.env.REEL_SCRAPER_TIMEOUT_MS || "30000", 10);
  return Math.max(5_000, Math.min(120_000, Number.isFinite(n) ? n : 30_000));
}

function sessionCookieHeader() {
  const sid = (process.env.INSTAGRAM_SESSIONID || process.env.IG_SESSIONID || "").trim();
  return sid ? `sessionid=${sid}` : "";
}

/**
 * When false, admin scrape routes respond with a clear configuration error instead
 * of attempting a fetch. The GraphQL scraper has no required external dependency,
 * so unless explicitly disabled it is always considered configured.
 */
export function isReelScraperConfigured() {
  const d = String(process.env.REEL_SCRAPER_DISABLED || "").toLowerCase();
  if (d === "1" || d === "true" || d === "yes") return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function igHeaders(extra = {}) {
  const headers = {
    "User-Agent": userAgent(),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-IG-App-ID": xIgAppId(),
    "X-ASBD-ID": "129477",
    "X-IG-WWW-Claim": "0",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    ...extra,
  };
  const cookie = sessionCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function fetchJson(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? timeoutMs());
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Instagram HTTP ${res.status} for ${url}: ${text.slice(0, 400)}`
      );
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Instagram returned non-JSON (${err.message}) for ${url}: ${text.slice(0, 200)}`
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer — port of reelscraper/media.py (kept identical so downstream code
// that consumes these records does not need to change).
// ─────────────────────────────────────────────────────────────────────────────

function bestVideoUrl(media) {
  const versions = media?.video_versions;
  if (Array.isArray(versions) && versions.length) {
    const sorted = [...versions]
      .filter((v) => v && typeof v.url === "string")
      .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
    if (sorted[0]?.url) return String(sorted[0].url);
    for (const v of versions) {
      if (v?.url) return String(v.url);
    }
  }
  for (const k of ["video_url", "videoUrl", "playback_url"]) {
    const u = media?.[k];
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  return null;
}

function bestThumbnail(media) {
  const iv2 = media?.image_versions2 || media?.image_versions;
  const cands = iv2?.candidates;
  if (Array.isArray(cands) && cands.length) {
    const sorted = [...cands]
      .filter((c) => c && typeof c.url === "string")
      .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
    if (sorted[0]?.url) return String(sorted[0].url);
    for (const c of cands) {
      if (c?.url) return String(c.url);
    }
  }
  for (const k of ["display_url", "displayUrl", "thumbnail_url", "thumbnailUrl", "thumbnail_src"]) {
    const u = media?.[k];
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  return null;
}

function captionText(media) {
  const cap = media?.caption;
  if (typeof cap === "string" && cap.trim()) return cap.trim().slice(0, 4000);
  if (cap && typeof cap === "object" && typeof cap.text === "string" && cap.text.trim()) {
    return cap.text.trim().slice(0, 4000);
  }
  const edges = media?.edge_media_to_caption?.edges;
  if (Array.isArray(edges) && edges.length) {
    const t = edges[0]?.node?.text;
    if (typeof t === "string" && t.trim()) return t.trim().slice(0, 4000);
  }
  return null;
}

function audioName(media) {
  const mi =
    media?.music_info || media?.musicInfo || media?.clips_music_attribution_info;
  if (mi && typeof mi === "object") {
    for (const k of ["song_name", "songName", "title", "display_artist"]) {
      const v = mi[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
    }
  }
  const ma = media?.music_asset_info || media?.musicAssetInfo;
  if (ma && typeof ma === "object" && typeof ma.title === "string" && ma.title.trim()) {
    return ma.title.trim().slice(0, 200);
  }
  for (const k of ["audioTitle", "audioName", "musicTitle"]) {
    const v = media?.[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
  }
  return null;
}

function intMetric(media, ...keys) {
  for (const k of keys) {
    const v = media?.[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

function likeCount(media) {
  for (const edgeKey of ["edge_liked_by", "edge_media_preview_like"]) {
    const e = media?.[edgeKey];
    if (e && typeof e === "object") {
      const c = intMetric(e, "count");
      if (c) return c;
    }
  }
  return intMetric(media, "like_count", "likesCount");
}

function commentCount(media) {
  const e = media?.edge_media_to_comment;
  if (e && typeof e === "object") {
    const c = intMetric(e, "count");
    if (c) return c;
  }
  return intMetric(media, "comment_count", "commentsCount");
}

function postedTimestampMs(media) {
  for (const k of [
    "taken_at",
    "takenAt",
    "taken_at_timestamp",
    "device_timestamp",
    "created_time",
    "timestamp",
  ]) {
    const v = media?.[k];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    return n > 1e12 ? n : n * 1000;
  }
  return null;
}

function isReelish(media) {
  const pt = String(media?.product_type || "").toLowerCase();
  if (pt === "clips") return true;
  if (pt === "story" || pt === "igtv") return true;
  const hasVideoBlob =
    (Array.isArray(media?.video_versions) && media.video_versions.length > 0) ||
    !!media?.video_url ||
    !!media?.videoUrl;
  if (media?.media_type === 2 && hasVideoBlob) return true;
  if (media?.is_video && hasVideoBlob) return true;
  return !!(hasVideoBlob && (media?.code || media?.shortcode));
}

/**
 * Map any Instagram media object (private API "media", GraphQL xdt_shortcode_media,
 * or web_profile_info edge node) to the flat NormalizedReel shape.
 * Returns null when the object is not a usable reel/video clip.
 */
export function normalizeInstagramMedia(media) {
  if (!media || typeof media !== "object") return null;
  const shortcodeRaw = media.code || media.shortcode;
  if (!shortcodeRaw || typeof shortcodeRaw !== "string") return null;
  const shortcode = shortcodeRaw.trim();
  if (shortcode.length < 5) return null;
  if (!isReelish(media)) return null;

  const pk = media.id || media.pk || media.media_id;
  const reelId = pk != null ? String(pk).trim() : shortcode;
  const permalink = `https://www.instagram.com/reel/${shortcode}/`;
  const audio = audioName(media);

  return {
    id: reelId,
    shortcode,
    url: permalink,
    reelUrl: permalink,
    postUrl: permalink,
    videoUrl: bestVideoUrl(media),
    displayUrl: bestThumbnail(media),
    thumbnailUrl: bestThumbnail(media),
    videoViewCount: intMetric(
      media,
      "play_count",
      "ig_play_count",
      "video_view_count",
      "videoViewCount",
      "view_count",
      "viewCount",
      "video_play_count",
    ),
    likesCount: likeCount(media),
    commentsCount: commentCount(media),
    sharesCount: intMetric(media, "reshare_count", "sharesCount", "share_count"),
    caption: captionText(media),
    musicInfo: audio ? { songName: audio } : null,
    timestamp: postedTimestampMs(media),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL: single shortcode
// ─────────────────────────────────────────────────────────────────────────────

export function shortcodeFromUrl(input) {
  if (!input) return null;
  const m = String(input).match(SHORTCODE_RE);
  return m && m[1] ? m[1] : null;
}

async function fetchSinglePostGraphql(shortcode) {
  const lsd = "AVqbxe3J_YA"; // Static LSD token used by the public GraphQL endpoint
  const url = new URL("https://www.instagram.com/api/graphql");
  url.searchParams.set("variables", JSON.stringify({ shortcode }));
  url.searchParams.set("doc_id", shortcodeDocId());
  url.searchParams.set("lsd", lsd);
  const data = await fetchJson(url.toString(), {
    method: "POST",
    headers: igHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
      "X-FB-LSD": lsd,
      Origin: "https://www.instagram.com",
      Referer: `https://www.instagram.com/reel/${shortcode}/`,
    }),
  });
  return data?.data?.xdt_shortcode_media || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile reels: web_profile_info → optional clips/user pagination
// ─────────────────────────────────────────────────────────────────────────────

async function fetchUserProfileViaApi(username) {
  // Try the www host first — significantly more permissive rate limit for
  // anonymous traffic than i.instagram.com. Fall back to i.instagram.com.
  const candidates = [
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  ];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const data = await fetchJson(url, {
        method: "GET",
        headers: igHeaders({
          Referer: `https://www.instagram.com/${username}/`,
        }),
      });
      const user = data?.data?.user;
      if (user && user.id) return user;
      lastErr = new Error(`Instagram: profile response shape unexpected from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Instagram: API profile fetch failed for "${username}"`);
}

/**
 * Fallback: GET the public profile HTML page and extract the embedded user JSON.
 * IG's web frontend ships the entire user object + the first ~12 timeline media
 * inside `<script type="application/json" data-sjs>` payloads, so the same data
 * the API would have returned is sitting in plain HTML, with a much more
 * permissive rate limit than the JSON endpoints.
 */
async function fetchUserProfileViaHtml(username) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs());
  let html;
  try {
    const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      method: "GET",
      headers: igHeaders({
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Instagram HTML profile HTTP ${res.status}`);
    }
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  // Walk every embedded data-sjs JSON blob and collect any node that looks
  // like the polaris user object for this username. The exact shape changes
  // every few months, so we look at multiple candidate paths.
  const matches = [
    ...html.matchAll(/<script type="application\/json"[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g),
  ];
  const lowerUser = username.toLowerCase();
  let foundUser = null;
  const visit = (node) => {
    if (foundUser || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) visit(v);
      return;
    }
    const candidate =
      (node.username && String(node.username).toLowerCase() === lowerUser
        && (node.id || node.pk)
        && (node.edge_owner_to_timeline_media || node.edge_felix_video_timeline))
        ? node
        : null;
    if (candidate) {
      foundUser = candidate;
      return;
    }
    for (const v of Object.values(node)) visit(v);
  };
  for (const m of matches) {
    if (foundUser) break;
    try {
      const blob = JSON.parse(m[1]);
      visit(blob);
    } catch {
      /* embedded blob isn't always parseable JSON; ignore and continue */
    }
  }
  if (!foundUser) {
    throw new Error(
      `Instagram: profile "${username}" HTML did not contain a parseable user payload (account may be private or removed).`,
    );
  }
  return foundUser;
}

async function fetchUserProfile(username) {
  const u = String(username || "").trim().replace(/^@/, "");
  if (!u) throw new Error("Instagram scraper: empty username");
  try {
    return await fetchUserProfileViaApi(u);
  } catch (apiErr) {
    try {
      return await fetchUserProfileViaHtml(u);
    } catch (htmlErr) {
      const apiMsg = String(apiErr?.message || apiErr);
      const cookieHint = sessionCookieHeader()
        ? ""
        : " Set INSTAGRAM_SESSIONID with any logged-in IG session cookie to bypass anonymous rate limits.";
      throw new Error(
        `Instagram profile fetch failed for "${u}". ${apiMsg.slice(0, 200)}.${cookieHint}`,
      );
    }
  }
}

async function fetchUserClipsPage(userId, maxId) {
  const body = new URLSearchParams();
  body.set("target_user_id", String(userId));
  body.set("page_size", "12");
  if (maxId) body.set("max_id", String(maxId));
  const data = await fetchJson("https://www.instagram.com/api/v1/clips/user/", {
    method: "POST",
    headers: igHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://www.instagram.com",
      Referer: "https://www.instagram.com/",
    }),
    body: body.toString(),
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  const medias = items
    .map((it) => it?.media || it)
    .filter((m) => m && typeof m === "object");
  const paging = data?.paging_info || {};
  return {
    medias,
    nextMaxId: paging.more_available ? String(paging.max_id || "") : "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entrypoints (kept identical to previous Python-spawn implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} username
 * @param {number} limit
 * @returns {Promise<object[]>} normalized reel records, newest first, capped to `limit`
 */
export async function scrapeProfileReels(username, limit) {
  const u = String(username || "").replace(/^@/, "").trim();
  if (!u) throw new Error("reelscraper: empty username");
  const lim = Math.max(1, Math.min(80, Math.floor(Number(limit) || 27)));

  const user = await fetchUserProfile(u);

  const sink = new Map();

  // First page: pluck clip-typed items from the public timeline edges so we get
  // engagement counts that the private clips/user endpoint sometimes omits.
  const timelineEdges =
    user?.edge_owner_to_timeline_media?.edges
    || user?.edge_felix_video_timeline?.edges
    || [];
  for (const edge of timelineEdges) {
    const node = edge?.node;
    if (!node) continue;
    const norm = normalizeInstagramMedia(node);
    if (norm) sink.set(norm.shortcode, norm);
    if (sink.size >= lim) break;
  }

  // Top-up via the private clips endpoint (no cookies needed thanks to X-IG-App-ID).
  let cursor = "";
  let safety = 0;
  while (sink.size < lim && safety < 8) {
    safety += 1;
    let page;
    try {
      page = await fetchUserClipsPage(user.id, cursor);
    } catch (err) {
      // Clips endpoint occasionally rate-limits or 401s anonymous traffic; the
      // first-page timeline data is enough to keep the feature working.
      if (sink.size > 0) break;
      throw err;
    }
    for (const m of page.medias) {
      const norm = normalizeInstagramMedia(m);
      if (norm) sink.set(norm.shortcode, norm);
      if (sink.size >= lim) break;
    }
    if (!page.nextMaxId) break;
    cursor = page.nextMaxId;
  }

  const items = Array.from(sink.values());
  items.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  return items.slice(0, lim);
}

/**
 * @param {string} reelPageUrl
 * @returns {Promise<object[]>} 0 or 1 normalized records
 */
export async function scrapeSingleReelByUrl(reelPageUrl) {
  const url = String(reelPageUrl || "").trim();
  if (!url) throw new Error("reelscraper: empty reel URL");
  const sc = shortcodeFromUrl(url);
  if (!sc) throw new Error(`reelscraper: cannot parse shortcode from "${url}"`);
  const media = await fetchSinglePostGraphql(sc);
  if (!media) return [];
  const norm = normalizeInstagramMedia(media);
  return norm ? [norm] : [];
}
