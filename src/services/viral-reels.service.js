/**
 * Reel Finder — scraper service.
 * Apify actor: xMc5Ga1oCONPmWJIa (instagram-reel-scraper)
 */

import { ApifyClient } from "apify-client";
import prisma from "../lib/prisma.js";
import { isR2Configured, mirrorToR2 } from "../utils/r2.js";

// ── Config ──────────────────────────────────────────────────────────────────
const APIFY_RESULTS_LIMIT = Math.max(1, Math.min(50, parseInt(process.env.REEL_SCRAPE_RESULTS_LIMIT || "27", 10)));
const SCRAPE_DELAY_MS     = Math.max(500, Math.min(15_000, parseInt(process.env.REEL_SCRAPE_DELAY_MS || "1500", 10)));
const CACHE_TTL_HOURS     = Math.max(1, Math.min(720, parseInt(process.env.REEL_CACHE_TTL_HOURS || "96", 10)));
const STALE_LOG_HOURS     = Math.max(1, Math.min(168, parseInt(process.env.REEL_STALE_RUNNING_LOG_HOURS || "6", 10)));

let pipelineRunning = false;

// ── Apify helpers ────────────────────────────────────────────────────────────

function getClient() {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");
  return new ApifyClient({ token });
}

function getActorId() {
  return process.env.APIFY_REEL_ACTOR_ID || "xMc5Ga1oCONPmWJIa";
}

/** Call Apify with multiple input formats; return first non-empty dataset. */
async function callApify(input) {
  const client = getClient();
  const actorIds = Array.from(new Set([
    getActorId(),
    "xMc5Ga1oCONPmWJIa",
    "apify/instagram-reel-scraper",
  ]));

  // Build input variants for a single username
  const variants = [input];
  if (Array.isArray(input?.username) && input.username.length === 1) {
    const u = String(input.username[0]).replace(/^@/, "").trim();
    if (u) {
      variants.push({ ...input, username: u });
      variants.push({ ...input, directUrls: [`https://www.instagram.com/${u}/`, `https://www.instagram.com/${u}/reels/`] });
    }
  }

  let lastErr = null;
  for (const actorId of actorIds) {
    for (const payload of variants) {
      try {
        const run = await client.actor(actorId).call(payload, { waitSecs: 120 });
        if (!run?.defaultDatasetId) continue;
        const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
        if (Array.isArray(items) && items.length > 0) {
          console.log(`[ReelFinder] actor ${actorId} returned ${items.length} items`);
          return items;
        }
      } catch (err) {
        lastErr = err;
        console.warn(`[ReelFinder] actor ${actorId} failed:`, err?.message);
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

// ── Field mapping ────────────────────────────────────────────────────────────

function toInt(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fb;
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

function pickUrl(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") { const u = normalizeUrl(c); if (u) return u; }
    if (Array.isArray(c)) { for (const e of c) { const u = pickUrl(e); if (u) return u; } }
    if (c && typeof c === "object") {
      const u = pickUrl(c.url, c.src, c.display_url, c.displayUrl, c.image_url, c.imageUrl);
      if (u) return u;
    }
  }
  return null;
}

function shortCodeFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function parseDate(v) {
  if (v == null) return null;
  if (typeof v === "number") {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function mapItem(item, profileId) {
  const id = String(
    item?.id || item?.shortCode || item?.shortcode || item?.code ||
    shortCodeFromUrl(item?.url) || shortCodeFromUrl(item?.reelUrl) || shortCodeFromUrl(item?.postUrl) || ""
  ).trim();
  if (!id) return null;

  return {
    profileId,
    instagramReelId: id,
    reelUrl:      pickUrl(item?.url, item?.reelUrl, item?.postUrl, item?.permalink),
    videoUrl:     pickUrl(item?.videoUrl, item?.videoUrlNoWatermark, item?.videoPlayUrl, item?.video_url, item?.video_versions),
    thumbnailUrl: pickUrl(item?.displayUrl, item?.thumbnailUrl, item?.imageUrl, item?.display_url, item?.thumbnail_url, item?.images),
    views:    toInt(item?.videoViewCount ?? item?.videoPlayCount ?? item?.playCount ?? item?.viewCount ?? item?.viewsCount),
    likes:    toInt(item?.likesCount ?? item?.likes),
    comments: toInt(item?.commentsCount ?? item?.comments),
    shares:   toInt(item?.sharesCount ?? item?.reshareCount ?? item?.shareCount),
    caption:  item?.caption ? String(item.caption).trim().slice(0, 4000) : null,
    audioName: (() => {
      const r = item?.musicInfo?.songName || item?.audioTitle || item?.musicTitle || item?.audioName;
      return r ? String(r).trim().slice(0, 200) : null;
    })(),
    postedAt: parseDate(item?.timestamp || item?.takenAt || item?.taken_at || item?.postedAt || item?.createdAt),
  };
}

// ── Viral scoring ────────────────────────────────────────────────────────────

function score(reel, avgViews, prev) {
  const avg = Math.max(1, avgViews || 1);
  const ratio = reel.views / avg;
  const eng = (reel.likes + reel.comments * 1.3 + reel.shares * 2.6) / Math.max(1, reel.views);
  const hrs = reel.postedAt ? Math.max(1, (Date.now() - new Date(reel.postedAt).getTime()) / 3.6e6) : 72;
  const vph = reel.views / hrs;
  const recency = Math.max(0.75, Math.min(1.35, 1.35 - hrs / 240));
  const shareBonus = Math.min(reel.shares / Math.max(1, reel.views) * 160, 8);
  const audioBonus = reel.audioName ? 2 : 0;

  let momentum = 1.0;
  if (prev?.views != null && prev?.lastScrapedAt && reel.views >= prev.views) {
    const dv = reel.views - prev.views;
    const dh = Math.max(1 / 6, (Date.now() - new Date(prev.lastScrapedAt).getTime()) / 3.6e6);
    const vNow = dv / dh;
    if (prev.viewsPerHour > 0) momentum = Math.max(0.75, Math.min(1.5, vNow / prev.viewsPerHour));
  }

  const raw = (Math.min(ratio * 24, 62) + Math.min(eng * 520, 28) + Math.min(vph / 900, 16) + shareBonus + audioBonus) * recency * momentum;

  return {
    viralScore:        Number(raw.toFixed(2)),
    viewsToAvgRatio:   Number(ratio.toFixed(4)),
    viewsPerHour:      Number(vph.toFixed(4)),
    momentumMultiplier:Number(momentum.toFixed(4)),
    shareBonus:        Number(shareBonus.toFixed(4)),
    audioTrendBonus:   Number(audioBonus.toFixed(4)),
    scrapeTier:        raw >= 70 ? 1 : raw >= 45 ? 2 : raw >= 20 ? 3 : 4,
  };
}

// ── R2 helpers ───────────────────────────────────────────────────────────────

function isR2Url(url) {
  if (!url) return false;
  if (url.includes("r2.dev")) return true;
  const base = process.env.R2_PUBLIC_URL || "";
  return !!(base && url.startsWith(base));
}

function isCacheStale(ts) {
  if (!ts) return true;
  return (Date.now() - new Date(ts).getTime()) / 3.6e6 > CACHE_TTL_HOURS;
}

async function mirrorMedia(rowId, type, url) {
  if (!url || isR2Url(url) || !isR2Configured()) return;
  const folder = type === "video" ? "reels/videos" : "reels/thumbs";
  const field  = type === "video" ? "videoUrl" : "thumbnailUrl";
  try {
    const mirrored = await mirrorToR2(url, folder);
    if (mirrored && mirrored !== url) {
      await prisma.reel.update({ where: { id: rowId }, data: { [field]: mirrored } });
    }
  } catch (err) {
    console.warn(`[ReelFinder] mirror ${type} failed:`, err?.message);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getTopReels(limit = 100) {
  // Show reels scraped in the last 30 days so stale/expired content
  // doesn't permanently outrank fresh results from a new scrape.
  const lookback = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const reels = await prisma.reel.findMany({
    where: {
      OR: [
        { lastScrapedAt: { gte: lookback } },
        { lastScrapedAt: null, createdAt: { gte: lookback } },
      ],
    },
    include: { profile: { select: { username: true, followerCount: true, avgViews: true } } },
    orderBy: [{ viralScore: "desc" }, { lastScrapedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.min(500, Number(limit) || 100)),
  });
  return reels.map((r) => ({
    id: r.id,
    instagram_reel_id: r.instagramReelId,
    reel_url:          r.reelUrl,
    video_url:         r.videoUrl,
    thumbnail_url:     r.thumbnailUrl,
    views:             r.views,
    likes:             r.likes,
    comments:          r.comments,
    shares:            r.shares,
    caption:           r.caption,
    audio_name:        r.audioName,
    posted_at:         r.postedAt,
    viral_score:       r.viralScore,
    views_to_avg_ratio:r.viewsToAvgRatio ?? 0,
    views_per_hour:    r.viewsPerHour ?? 0,
    scrape_tier:       r.scrapeTier,
    created_at:        r.createdAt,
    last_scraped_at:   r.lastScrapedAt,
    profiles: r.profile ? {
      username:       r.profile.username,
      follower_count: r.profile.followerCount,
      avg_views:      r.profile.avgViews,
    } : null,
  }));
}

export async function fetchFreshVideoUrl(reelPageUrl) {
  if (!reelPageUrl) return null;
  try {
    const items = await callApify({ directUrls: [reelPageUrl], resultsLimit: 1 });
    const mapped = mapItem(items[0] || {}, "tmp");
    return mapped?.videoUrl || null;
  } catch {
    return null;
  }
}

export async function cacheReelToR2InBackground(reelId, cdnUrl) {
  if (!reelId || !cdnUrl) return;
  mirrorMedia(String(reelId), "video", cdnUrl).catch(() => {});
}

export async function cleanupStaleLogs() {
  const cutoff = new Date(Date.now() - STALE_LOG_HOURS * 3.6e6);
  return prisma.scrapeLog.updateMany({
    where: { status: "running", startedAt: { lte: cutoff } },
    data: { status: "error", finishedAt: new Date() },
  }).catch(() => {});
}

// ── Single-profile scrape (admin button) ─────────────────────────────────────

export async function scrapeProfile(profileId) {
  const profile = await prisma.reelFinderProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new Error("Profile not found");
  const username = String(profile.username || "").replace(/^@/, "").trim().toLowerCase();
  if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) {
    throw new Error("Profile has an invalid Instagram username");
  }

  const items = await callApify({
    username: [username],
    resultsLimit: APIFY_RESULTS_LIMIT,
    skipPinnedPosts: false,
    includeSharesCount: true,
    includeTranscript: false,
    includeDownloadedVideo: false,
  });

  const mapped = items.map((i) => mapItem(i, profile.id)).filter(Boolean);
  const now = new Date();

  // Compute avgViews
  const views = mapped.map((r) => r.views).filter((v) => v > 0).sort((a, b) => a - b);
  const trim  = views.slice(0, Math.max(1, Math.ceil(views.length * 0.85)));
  const avgViews = trim.length > 0 ? Math.round(trim.reduce((s, n) => s + n, 0) / trim.length) : (profile.avgViews || 5000);

  // Fetch existing rows in one query
  const ids = mapped.map((r) => r.instagramReelId);
  const existing = ids.length > 0
    ? await prisma.reel.findMany({
        where: { instagramReelId: { in: ids } },
        select: { id: true, instagramReelId: true, views: true, viewsPerHour: true, lastScrapedAt: true, videoUrl: true, thumbnailUrl: true },
      })
    : [];
  const existMap = new Map(existing.map((r) => [r.instagramReelId, r]));

  // Upsert in small chunks to avoid connection pool exhaustion
  const mirrorQueue = [];
  let saved = 0;
  const CHUNK = 8;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const chunk = mapped.slice(i, i + CHUNK);
    try {
      const rows = await prisma.$transaction(
        chunk.map((reel) => {
          const prev = existMap.get(reel.instagramReelId) || null;
          const m = score(reel, avgViews, prev);
          const data = {
            reelUrl:           reel.reelUrl,
            // Prefer fresh CDN URL from new scrape; fall back to R2-cached URL
            // only if the new scrape returned nothing (keeps R2 URLs permanent).
            videoUrl:     reel.videoUrl || (isR2Url(prev?.videoUrl) ? prev.videoUrl : null),
            thumbnailUrl: reel.thumbnailUrl || (isR2Url(prev?.thumbnailUrl) ? prev.thumbnailUrl : null),
            views: reel.views, likes: reel.likes, comments: reel.comments, shares: reel.shares,
            caption: reel.caption, audioName: reel.audioName, postedAt: reel.postedAt,
            viralScore: m.viralScore, viewsToAvgRatio: m.viewsToAvgRatio,
            viewsPerHour: m.viewsPerHour, viewsPerHourPrev: prev?.viewsPerHour || null,
            prevViews: prev?.views ?? null, prevViewsAt: prev?.lastScrapedAt || null,
            momentumMultiplier: m.momentumMultiplier, shareBonus: m.shareBonus,
            audioTrendBonus: m.audioTrendBonus, scrapeTier: m.scrapeTier,
            lastScrapedAt: now, lastScoreUpdate: now, contentCategory: "reel",
          };
          return prisma.reel.upsert({
            where: { instagramReelId: reel.instagramReelId },
            update: { ...data, profileId: reel.profileId },
            create: { profileId: reel.profileId, instagramReelId: reel.instagramReelId, ...data },
            select: { id: true, videoUrl: true, thumbnailUrl: true },
          });
        }),
        { timeout: 25_000 },
      );
      rows.forEach((row, idx) => {
        saved++;
        const prev = existMap.get(chunk[idx].instagramReelId);
        const stale = isCacheStale(prev?.lastScrapedAt);
        if ((stale || !isR2Url(row.videoUrl)) && row.videoUrl)    mirrorQueue.push(() => mirrorMedia(row.id, "video", row.videoUrl));
        if ((stale || !isR2Url(row.thumbnailUrl)) && row.thumbnailUrl) mirrorQueue.push(() => mirrorMedia(row.id, "thumbnail", row.thumbnailUrl));
      });
    } catch (chunkErr) {
      console.error("[ReelFinder] chunk failed:", chunkErr?.message);
      // Fallback: save individually
      for (const reel of chunk) {
        try {
          const prev = existMap.get(reel.instagramReelId) || null;
          const m = score(reel, avgViews, prev);
          const data = {
            reelUrl: reel.reelUrl,
            videoUrl:     reel.videoUrl || (isR2Url(prev?.videoUrl) ? prev.videoUrl : null),
            thumbnailUrl: reel.thumbnailUrl || (isR2Url(prev?.thumbnailUrl) ? prev.thumbnailUrl : null),
            views: reel.views, likes: reel.likes, comments: reel.comments, shares: reel.shares,
            caption: reel.caption, audioName: reel.audioName, postedAt: reel.postedAt,
            viralScore: m.viralScore, viewsToAvgRatio: m.viewsToAvgRatio, viewsPerHour: m.viewsPerHour,
            viewsPerHourPrev: prev?.viewsPerHour || null, prevViews: prev?.views ?? null,
            prevViewsAt: prev?.lastScrapedAt || null, momentumMultiplier: m.momentumMultiplier,
            shareBonus: m.shareBonus, audioTrendBonus: m.audioTrendBonus, scrapeTier: m.scrapeTier,
            lastScrapedAt: now, lastScoreUpdate: now, contentCategory: "reel",
          };
          await prisma.reel.upsert({
            where: { instagramReelId: reel.instagramReelId },
            update: { ...data, profileId: reel.profileId },
            create: { profileId: reel.profileId, instagramReelId: reel.instagramReelId, ...data },
          });
          saved++;
        } catch (e) {
          console.error("[ReelFinder] individual upsert failed:", reel.instagramReelId, e?.message);
        }
      }
    }
  }

  // Update profile stats
  await prisma.reelFinderProfile.update({
    where: { id: profile.id },
    data: { avgViews, avgViewsUpdatedAt: now, lastScrapedAt: now, scrapeCount: { increment: 1 } },
  }).catch((e) => console.warn("[ReelFinder] profile update failed:", e?.message));

  // Delete old reels for this profile that were NOT in this scrape.
  // This ensures expired CDN content is cleaned out after every successful scrape.
  if (mapped.length > 0) {
    const freshIds = mapped.map((r) => r.instagramReelId);
    const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.reel.deleteMany({
      where: {
        profileId: profile.id,
        instagramReelId: { notIn: freshIds },
        // Only delete reels that haven't been refreshed in 30 days — keeps
        // recently scraped reels from other pipeline runs safe.
        OR: [
          { lastScrapedAt: { lt: staleCutoff } },
          { lastScrapedAt: null, createdAt: { lt: staleCutoff } },
        ],
      },
    }).catch((e) => console.warn("[ReelFinder] stale reel cleanup failed:", e?.message));
  }

  // Mirror to R2 in background, max 3 concurrent
  if (mirrorQueue.length > 0) {
    (async () => {
      let i = 0;
      const worker = async () => { while (i < mirrorQueue.length) { const idx = i++; await mirrorQueue[idx]().catch(() => {}); } };
      await Promise.all(Array.from({ length: Math.min(3, mirrorQueue.length) }, worker));
    })().catch(() => {});
  }

  console.log(`[ReelFinder] @${profile.username}: scraped ${items.length} items, saved ${saved}`);
  return saved;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export function isScraperPipelineRunning() { return pipelineRunning; }
export async function runScraperPipeline() { return runScraperPipelineWithMode("full"); }

async function getProfilesForMode(mode) {
  const staleHot  = new Date(Date.now() - 6 * 3.6e6);
  const staleWarm = new Date(Date.now() - 24 * 3.6e6);
  if (mode === "hot") {
    return prisma.reelFinderProfile.findMany({
      where: { isActive: true, OR: [{ scrapeGroup: { in: [0, 1, 2] } }, { lastScrapedAt: null }, { lastScrapedAt: { lte: staleHot } }] },
      orderBy: [{ lastScrapedAt: "asc" }, { scrapeGroup: "asc" }],
    });
  }
  if (mode === "warm") {
    return prisma.reelFinderProfile.findMany({
      where: { isActive: true, OR: [{ scrapeGroup: { in: [3, 4, 5] } }, { lastScrapedAt: null }, { lastScrapedAt: { lte: staleWarm } }] },
      orderBy: [{ lastScrapedAt: "asc" }, { scrapeGroup: "asc" }],
    });
  }
  return prisma.reelFinderProfile.findMany({ where: { isActive: true }, orderBy: [{ scrapeGroup: "asc" }, { addedAt: "asc" }] });
}

export async function runScraperPipelineWithMode(mode = "full") {
  if (pipelineRunning) return { started: false, message: "Already running" };
  pipelineRunning = true;

  // Mark old stuck logs
  await cleanupStaleLogs();

  const log = await prisma.scrapeLog.create({ data: { status: "running" } }).catch(() => null);
  let profilesScraped = 0, reelsFound = 0, profileErrors = 0;

  try {
    const profiles = await getProfilesForMode(mode);
    if (profiles.length === 0) {
      if (log) await prisma.scrapeLog.update({ where: { id: log.id }, data: { status: "success", profilesScraped: 0, reelsFound: 0, finishedAt: new Date() } }).catch(() => {});
      return { status: "success", profilesScraped: 0, reelsFound: 0 };
    }

    for (const profile of profiles) {
      try {
        const found = await scrapeProfile(profile.id);
        profilesScraped++;
        reelsFound += found;
      } catch (err) {
        profileErrors++;
        console.error("[ReelFinder] pipeline: profile failed:", profile.username, err?.message);
      }
      await new Promise((r) => setTimeout(r, SCRAPE_DELAY_MS));
    }

    const status = profileErrors >= profiles.length ? "error" : "success";
    if (log) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await prisma.scrapeLog.update({ where: { id: log.id }, data: { status, profilesScraped, reelsFound, finishedAt: new Date() } });
          break;
        } catch { await new Promise((r) => setTimeout(r, 2000)); }
      }
    }
    return { status, profilesScraped, reelsFound, profileErrors };
  } catch (err) {
    if (log) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await prisma.scrapeLog.update({ where: { id: log.id }, data: { status: "error", finishedAt: new Date() } }); break; }
        catch { await new Promise((r) => setTimeout(r, 2000)); }
      }
    }
    throw err;
  } finally {
    pipelineRunning = false;
  }
}
