/**
 * Reel scraper runner — Apify-backed.
 *
 * Uses the official `apify/instagram-reel-scraper` actor (override via
 * APIFY_REEL_ACTOR_ID). All scraping is run through the cron pipeline / admin
 * triggers — there is intentionally NO on-demand refresh path exposed here, to
 * prevent per-stream Apify spend.
 *
 * Public surface (kept stable for viral-reels.service.js):
 *   - scrapeProfileReels(username, limit) -> Promise<NormalizedReel[]>
 *   - scrapeSingleReelByUrl(reelUrl)      -> Promise<NormalizedReel[]>  (0 or 1)
 *   - isReelScraperConfigured()           -> boolean
 *
 * NormalizedReel shape (consumed by viral-reels.service.js#mapItem):
 *   { id, shortcode, url, reelUrl, postUrl,
 *     videoUrl, displayUrl, thumbnailUrl,
 *     videoViewCount, likesCount, commentsCount, sharesCount,
 *     caption, musicInfo: { songName } | null,
 *     timestamp }                                                         */

import { ApifyClient } from "apify-client";

const DEFAULT_ACTOR_ID = "apify/instagram-reel-scraper";
const APIFY_WAIT_SECS = Math.max(30, Math.min(600, parseInt(process.env.APIFY_REEL_WAIT_SECS || "180", 10)));

function actorId() {
  return (process.env.APIFY_REEL_ACTOR_ID || DEFAULT_ACTOR_ID).trim();
}

function getClient() {
  const token = (process.env.APIFY_API_TOKEN || "").trim();
  if (!token) throw new Error("APIFY_API_TOKEN not set");
  return new ApifyClient({ token });
}

export function isReelScraperConfigured() {
  const d = String(process.env.REEL_SCRAPER_DISABLED || "").toLowerCase();
  if (d === "1" || d === "true" || d === "yes") return false;
  return Boolean((process.env.APIFY_API_TOKEN || "").trim());
}

// ── Apify call (single attempt; cost-conscious — no fallback actors / variants)
async function runApify(input) {
  const client = getClient();
  const id = actorId();
  const run = await client.actor(id).call(input, { waitSecs: APIFY_WAIT_SECS });
  if (!run?.defaultDatasetId) {
    console.warn(`[ReelScraper] actor ${id} returned no dataset id (status=${run?.status})`);
    return [];
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
  if (!Array.isArray(items)) return [];
  console.log(`[ReelScraper] actor ${id} returned ${items.length} item(s)`);
  return items;
}

// ── Normalizers ──────────────────────────────────────────────────────────────

function pickStringUrl(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") {
      const t = c.trim();
      if (/^https?:\/\//i.test(t)) return t;
    } else if (Array.isArray(c)) {
      for (const e of c) {
        const u = pickStringUrl(e);
        if (u) return u;
      }
    } else if (typeof c === "object") {
      const u = pickStringUrl(
        c.url, c.src, c.display_url, c.displayUrl,
        c.image_url, c.imageUrl, c.video_url, c.videoUrl,
      );
      if (u) return u;
    }
  }
  return null;
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function shortcodeFromString(input) {
  if (!input || typeof input !== "string") return null;
  const m = input.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return m ? m[1] : null;
}

function timestampMs(item) {
  const raw = item?.timestamp ?? item?.takenAt ?? item?.taken_at ?? item?.postedAt ?? item?.createdAt;
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  const d = new Date(raw);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

/** Convert an Apify dataset item to NormalizedReel (or null if not a reel). */
export function normalizeApifyItem(item) {
  if (!item || typeof item !== "object") return null;

  const shortcode =
    item.shortCode || item.shortcode || item.code ||
    shortcodeFromString(item.url) ||
    shortcodeFromString(item.reelUrl) ||
    shortcodeFromString(item.postUrl) || null;

  if (!shortcode) return null;

  // Apify actor labels reels with type === "Video" (or productType === "clips").
  const type = String(item.type || "").toLowerCase();
  const productType = String(item.productType || item.product_type || "").toLowerCase();
  const looksLikeReel =
    type === "video" || type === "reel" ||
    productType === "clips" ||
    Boolean(item.videoUrl || item.videoUrlNoWatermark || item.videoPlayUrl);
  if (!looksLikeReel) return null;

  const permalink = `https://www.instagram.com/reel/${shortcode}/`;
  const audioName =
    item?.musicInfo?.song_name ||
    item?.musicInfo?.songName ||
    item?.musicInfo?.title ||
    item?.audioTitle || item?.musicTitle || item?.audioName || null;

  return {
    id: String(item.id || shortcode),
    shortcode,
    url: pickStringUrl(item.url, item.reelUrl, item.postUrl, item.permalink) || permalink,
    reelUrl: pickStringUrl(item.reelUrl, item.url, item.postUrl) || permalink,
    postUrl: pickStringUrl(item.postUrl, item.url) || permalink,
    videoUrl: pickStringUrl(item.videoUrl, item.videoUrlNoWatermark, item.videoPlayUrl, item.video_url),
    displayUrl: pickStringUrl(item.displayUrl, item.thumbnailUrl, item.imageUrl, item.display_url, item.thumbnail_url, item.images),
    thumbnailUrl: pickStringUrl(item.thumbnailUrl, item.displayUrl, item.imageUrl, item.display_url, item.thumbnail_url, item.images),
    videoViewCount: toInt(item.videoViewCount ?? item.videoPlayCount ?? item.playCount ?? item.viewCount ?? item.viewsCount),
    likesCount: toInt(item.likesCount ?? item.likes),
    commentsCount: toInt(item.commentsCount ?? item.comments),
    sharesCount: toInt(item.sharesCount ?? item.reshareCount ?? item.shareCount),
    caption: item.caption ? String(item.caption).trim().slice(0, 4000) : null,
    musicInfo: audioName ? { songName: String(audioName).trim().slice(0, 200) } : null,
    timestamp: timestampMs(item),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape the most recent reels for a single Instagram username.
 * Backed by Apify `apify/instagram-reel-scraper` — counts as one actor run.
 */
export async function scrapeProfileReels(username, limit) {
  const u = String(username || "").trim().replace(/^@/, "").toLowerCase();
  if (!u) throw new Error("reelscraper: empty username");
  const lim = Math.max(1, Math.min(80, Math.floor(Number(limit) || 27)));

  const items = await runApify({
    username: [u],
    resultsLimit: lim,
    skipPinnedPosts: false,
    includeSharesCount: true,
    includeTranscript: false,
    includeDownloadedVideo: false,
  });

  const normalized = items
    .map(normalizeApifyItem)
    .filter(Boolean);

  // newest first
  normalized.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  return normalized.slice(0, lim);
}

/**
 * Scrape a single reel by its public URL.
 *
 * NOTE: This is intentionally NOT used for on-demand video URL refresh anymore
 * (that drained Apify spend on every play of an expired CDN URL). It remains
 * exported for future admin-only flows; callers should treat each invocation
 * as one paid Apify run and gate accordingly.
 */
export async function scrapeSingleReelByUrl(reelPageUrl) {
  const url = String(reelPageUrl || "").trim();
  if (!url) throw new Error("reelscraper: empty reel URL");
  const items = await runApify({
    directUrls: [url],
    resultsLimit: 1,
    skipPinnedPosts: false,
    includeSharesCount: true,
    includeTranscript: false,
    includeDownloadedVideo: false,
  });
  const norm = items.map(normalizeApifyItem).filter(Boolean);
  return norm.slice(0, 1);
}

export const __test__ = { normalizeApifyItem };
