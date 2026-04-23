import express from "express";
import http from "http";
import https from "https";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { adminMiddleware } from "../middleware/admin.middleware.js";
import {
  getTopReels,
  cacheReelToR2InBackground,
  runScraperPipeline,
  runScraperPipelineWithMode,
  isScraperPipelineRunning,
  isReelScraperConfigured,
  scrapeProfile,
  cleanupStaleLogs,
} from "../services/viral-reels.service.js";

const router = express.Router();

const STREAM_TOKEN_TTL    = "2m";
const THUMBNAIL_TOKEN_TTL = "30m";

// ── Subscription cache (avoids a DB hit per thumbnail request) ───────────────
const subCache = new Map();
const SUB_TTL  = 5 * 60 * 1000;

function getCached(userId) {
  const e = subCache.get(userId);
  if (!e || Date.now() - e.at > SUB_TTL) return null;
  return e;
}
function setCached(userId, allowed) {
  subCache.set(userId, { allowed, at: Date.now() });
  if (subCache.size > 500) {
    const cutoff = Date.now() - SUB_TTL;
    for (const [k, v] of subCache) if (v.at < cutoff) subCache.delete(k);
  }
}

// ── Media proxy helpers ──────────────────────────────────────────────────────
const CDN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15";

function allowedHost(h) {
  if (!h) return false;
  const host = h.toLowerCase();
  if (host === "instagram.com" || host === "www.instagram.com") return true;
  if (host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net")) return true;
  if (host.startsWith("instagram.") && host.endsWith(".fna.fbcdn.net")) return true;
  if (host.endsWith(".r2.dev")) return true;
  if (host.includes("blob.vercel-storage.com")) return true;
  try { const r2 = process.env.R2_PUBLIC_URL; if (r2 && new URL(r2).hostname.toLowerCase() === host) return true; } catch {}
  return false;
}

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!allowedHost(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

function isR2(url) {
  if (!url) return false;
  if (url.includes("r2.dev")) return true;
  const base = process.env.R2_PUBLIC_URL || "";
  return !!(base && url.startsWith(base));
}

/**
 * Pipe a remote URL to the response.
 * Returns a Promise that:
 *   - resolves 'ok'  when the stream starts (headers sent, body piping)
 *   - rejects { status, message } when upstream returns 4xx/5xx or network errors
 * This lets callers catch upstream failures and try a fallback URL.
 */
function pipeStream(url, res, onEnd, _depth = 0) {
  return new Promise((resolve, reject) => {
    if (_depth > 3) { reject({ status: 502, message: "Too many redirects" }); return; }
    const safe = safeUrl(url);
    if (!safe) { reject({ status: 400, message: "Invalid media URL" }); return; }
    const proto = safe.startsWith("https") ? https : http;
    const req = proto.get(safe, {
      headers: { "User-Agent": CDN_UA, Referer: "https://www.instagram.com/", Accept: "video/mp4,video/*,*/*" },
    }, (up) => {
      if (up.statusCode === 301 || up.statusCode === 302) {
        const next = up.headers.location ? new URL(up.headers.location, safe).toString() : null;
        up.resume();
        if (next && safeUrl(next)) {
          pipeStream(next, res, onEnd, _depth + 1).then(resolve).catch(reject);
        } else {
          reject({ status: 502, message: "Bad redirect" });
        }
        return;
      }
      if (up.statusCode >= 400) {
        up.resume(); // drain body so connection is not left hanging
        reject({ status: up.statusCode, message: `Upstream ${up.statusCode}` });
        return;
      }
      // Success — start streaming
      if (!res.headersSent) {
        res.setHeader("Content-Type", up.headers["content-type"] || "video/mp4");
        res.setHeader("Accept-Ranges", "bytes");
        if (up.headers["content-length"]) res.setHeader("Content-Length", up.headers["content-length"]);
        if (up.headers["content-range"])  res.setHeader("Content-Range",  up.headers["content-range"]);
        res.writeHead(up.statusCode === 206 ? 206 : 200);
      }
      up.pipe(res);
      resolve("ok");
      if (onEnd && !isR2(safe)) up.on("end", onEnd);
    });
    req.on("error", (err) => reject({ status: 502, message: err.message }));
    req.setTimeout(30000, () => { req.destroy(); reject({ status: 504, message: "Timeout" }); });
  });
}

// ── Middleware ───────────────────────────────────────────────────────────────

async function requireSub(req, res, next) {
  const userId = req.user?.userId ?? req.user?.id;
  if (!userId) return res.status(401).json({ error: "Authentication required" });
  const cached = getCached(userId);
  if (cached) return cached.allowed ? next() : res.status(403).json({ error: "Subscription required" });
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true, role: true, premiumFeaturesUnlocked: true },
    });
    if (!user) return res.status(403).json({ error: "User not found" });
    const allowed = user.role === "admin" || user.premiumFeaturesUnlocked === true ||
      ["active", "trialing"].includes(String(user.subscriptionStatus || "").toLowerCase());
    setCached(userId, allowed);
    return allowed ? next() : res.status(403).json({ error: "Subscription required" });
  } catch { return res.status(500).json({ error: "Could not verify subscription" }); }
}

function mediaAuth(req, res, next) {
  // Try cookie/header JWT first
  const headerToken = req.cookies?.auth_token ||
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
  if (headerToken) {
    try {
      const d = jwt.verify(headerToken, process.env.JWT_SECRET);
      if (d?.type !== "refresh" && (d.userId ?? d.id ?? d.sub)) {
        req.user = { userId: d.userId ?? d.id ?? d.sub, id: d.userId ?? d.id ?? d.sub };
        return next();
      }
    } catch {}
  }
  // Fall back to ?token query param (reel_media tokens)
  const qToken = req.query.token;
  if (!qToken) return res.status(401).json({ error: "Authentication required" });
  try {
    const d = jwt.verify(qToken, process.env.JWT_SECRET);
    if (d?.type !== "reel_media" || !d.userId) return res.status(401).json({ error: "Invalid token" });
    if (req.params.id && d.reelId && d.reelId !== req.params.id) return res.status(403).json({ error: "Token mismatch" });
    req.user = { userId: d.userId, id: d.userId };
    return next();
  } catch { return res.status(401).json({ error: "Invalid or expired token" }); }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// List top reels
router.get("/", authMiddleware, requireSub, async (_req, res) => {
  try {
    const reels = await getTopReels(100);
    return res.json(reels);
  } catch (err) {
    console.error("[ReelFinder] GET /:", err?.message);
    return res.status(500).json({ error: "Failed to load reels" });
  }
});

// Media token (thumbnails)
router.get("/media-token", authMiddleware, requireSub, (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    const token = jwt.sign({ type: "reel_media", userId }, process.env.JWT_SECRET, { expiresIn: THUMBNAIL_TOKEN_TTL });
    return res.json({ token });
  } catch { return res.status(500).json({ error: "Token error" }); }
});

// Thumbnail proxy
// Instagram CDN URLs expire — when they return 403/404, we return 404 so the
// browser <img> fires onError and shows the fallback UI (no broken-image popup).
router.get("/media", mediaAuth, requireSub, (req, res) => {
  let url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url" });
  try { url = decodeURIComponent(url); } catch { return res.status(400).json({ error: "Invalid url" }); }
  const safe = safeUrl(url);
  if (!safe) return res.status(400).json({ error: "Unsupported host" });

  function fetchThumb(targetUrl, depth = 0) {
    if (depth > 3) { if (!res.headersSent) res.status(404).end(); return; }
    const proto = targetUrl.startsWith("https") ? https : http;
    const r = proto.get(targetUrl, { headers: { "User-Agent": CDN_UA, Referer: "https://www.instagram.com/" } }, (up) => {
      if (up.statusCode === 301 || up.statusCode === 302) {
        const next = up.headers.location ? new URL(up.headers.location, targetUrl).toString() : null;
        up.resume();
        if (next && safeUrl(next)) return fetchThumb(next, depth + 1);
        return res.status(404).end();
      }
      if (up.statusCode >= 400) {
        up.resume();
        // Return 404 so browser img onError fires cleanly; avoid confusing 502
        if (!res.headersSent) res.status(404).end();
        return;
      }
      res.setHeader("Content-Type", up.headers["content-type"] || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      up.pipe(res);
    });
    r.on("error", () => { if (!res.headersSent) res.status(404).end(); });
    r.setTimeout(10000, () => { r.destroy(); if (!res.headersSent) res.status(404).end(); });
  }

  fetchThumb(safe);
});

// Stream token
router.get("/:id/stream-token", authMiddleware, requireSub, (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    const token = jwt.sign({ type: "reel_media", userId, reelId: req.params.id }, process.env.JWT_SECRET, { expiresIn: STREAM_TOKEN_TTL });
    return res.json({ token });
  } catch { return res.status(500).json({ error: "Token error" }); }
});

// Stream video
// Flow: try the cached videoUrl → if CDN returns 403/expired, clear the URL
// and return `video_expired`. We intentionally do NOT trigger an on-demand
// scraper refresh here — every refresh costs a paid Apify run and used to be
// drained by users clicking play on stale reels. Fresh URLs come exclusively
// from the cron pipeline / admin scrape triggers.
router.get("/:id/stream", mediaAuth, requireSub, async (req, res) => {
  const reel = await prisma.reel.findUnique({ where: { id: req.params.id } });
  if (!reel) return res.status(404).end();

  const videoUrl = reel.videoUrl;
  if (videoUrl) {
    if (isR2(videoUrl)) return res.redirect(302, videoUrl);
    try {
      await pipeStream(videoUrl, res, () => cacheReelToR2InBackground(reel.id, videoUrl));
      return; // success
    } catch (upErr) {
      console.warn(`[ReelFinder] stream upstream ${upErr?.status} for ${reel.id.slice(0, 8)} — clearing stale URL`);
      prisma.reel.update({ where: { id: reel.id }, data: { videoUrl: null } }).catch(() => {});
    }
  }

  if (!res.headersSent) {
    res.status(502).json({
      error: "video_expired",
      message: "Video URL expired. It will be refreshed by the next scheduled scrape.",
    });
  }
});

// Download
// Same cost-control rule as /stream: if the cached URL fails, return
// `video_expired` rather than triggering a paid Apify refresh.
router.get("/:id/download", mediaAuth, requireSub, async (req, res) => {
  const reel = await prisma.reel.findUnique({ where: { id: req.params.id } });
  if (!reel) return res.status(404).json({ error: "Not found" });

  const videoUrl = reel.videoUrl;
  if (videoUrl) {
    try {
      res.setHeader("Content-Disposition", `attachment; filename="reel_${reel.instagramReelId || reel.id}.mp4"`);
      await pipeStream(videoUrl, res, () => cacheReelToR2InBackground(reel.id, videoUrl));
      return;
    } catch {
      prisma.reel.update({ where: { id: reel.id }, data: { videoUrl: null } }).catch(() => {});
    }
  }

  if (!res.headersSent) {
    res.status(502).json({
      error: "video_expired",
      message: "Video URL expired. It will be refreshed by the next scheduled scrape.",
    });
  }
});

// ── Admin ────────────────────────────────────────────────────────────────────

router.get("/admin/profiles", authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const profiles = await prisma.reelFinderProfile.findMany({
      include: { _count: { select: { reels: true } } },
      orderBy: { addedAt: "desc" },
    });
    return res.json({ success: true, profiles });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed to load profiles" });
  }
});

router.post("/admin/profiles", authMiddleware, adminMiddleware, async (req, res) => {
  const username = String(req.body?.username || "").replace(/@/g, "").trim().toLowerCase();
  if (!username || !/^[a-z0-9._]{1,30}$/.test(username))
    return res.status(400).json({ success: false, error: "Invalid username" });
  try {
    const profile = await prisma.reelFinderProfile.create({ data: { username, instagramUrl: `https://instagram.com/${username}` } });
    return res.json({ success: true, profile });
  } catch { return res.status(400).json({ success: false, error: "Profile already exists" }); }
});

router.post("/admin/profiles/bulk", authMiddleware, adminMiddleware, async (req, res) => {
  const usernames = Array.isArray(req.body?.usernames) ? req.body.usernames : [];
  let added = 0;
  for (const u of usernames) {
    const username = String(u || "").replace(/@/g, "").trim().toLowerCase();
    if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) continue;
    try { await prisma.reelFinderProfile.create({ data: { username, instagramUrl: `https://instagram.com/${username}` } }); added++; } catch {}
  }
  return res.json({ success: true, added });
});

router.patch("/admin/profiles/:id", authMiddleware, adminMiddleware, async (req, res) => {
  const data = {};
  if (typeof req.body?.isActive === "boolean") data.isActive = req.body.isActive;
  if (typeof req.body?.scrapeGroup === "number") data.scrapeGroup = Math.max(0, Math.min(5, Math.floor(req.body.scrapeGroup)));
  if (!Object.keys(data).length) return res.status(400).json({ success: false, error: "Nothing to update" });
  try {
    const profile = await prisma.reelFinderProfile.update({ where: { id: req.params.id }, data });
    return res.json({ success: true, profile });
  } catch (err) { return res.status(400).json({ success: false, error: err?.message || "Update failed" }); }
});

router.delete("/admin/profiles/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await prisma.reelFinderProfile.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) { return res.status(400).json({ success: false, error: err?.message }); }
});

router.post("/admin/profiles/:id/scrape", authMiddleware, adminMiddleware, async (req, res) => {
  if (!isReelScraperConfigured()) {
    return res.status(503).json({
      success: false,
      error: "Reel scraper disabled (REEL_SCRAPER_DISABLED). Remove it to run scrapes.",
    });
  }
  try {
    const found = await scrapeProfile(req.params.id);
    return res.json({ success: true, found, message: `Saved ${found} reels` });
  } catch (err) {
    if (err?.message === "Profile not found") return res.status(404).json({ success: false, error: "Profile not found" });
    return res.status(500).json({ success: false, error: err?.message || "Scrape failed" });
  }
});

/** Delete all scraped Reel rows (DB cache). Optionally start full rescrape. Profiles are kept. */
router.post("/admin/clear-reels", authMiddleware, adminMiddleware, async (req, res) => {
  const rescrape = req.body?.rescrape !== false;
  try {
    const del = await prisma.reel.deleteMany({});
    if (!rescrape) {
      return res.json({
        success: true,
        deletedCount: del.count,
        rescrapeStarted: false,
        message: `Deleted ${del.count} cached reel(s). Rescrape skipped.`,
      });
    }
    if (!isReelScraperConfigured()) {
      return res.json({
        success: true,
        deletedCount: del.count,
        rescrapeStarted: false,
        message: `Deleted ${del.count} cached reel(s). Reel scraper disabled — rescrape skipped.`,
      });
    }
    if (isScraperPipelineRunning()) {
      return res.json({
        success: true,
        deletedCount: del.count,
        rescrapeStarted: false,
        message: `Deleted ${del.count} cached reel(s). Scrape pipeline already running — start rescrape manually if needed.`,
      });
    }
    res.json({
      success: true,
      deletedCount: del.count,
      rescrapeStarted: true,
      message: `Deleted ${del.count} cached reel(s). Full scrape started.`,
    });
    runScraperPipeline().catch((e) => console.error("[ReelFinder] pipeline:", e?.message));
  } catch (err) {
    console.error("[ReelFinder] clear-reels:", err?.message);
    return res.status(500).json({ success: false, error: err?.message || "Failed to clear reels" });
  }
});

router.post("/admin/trigger-scrape", authMiddleware, adminMiddleware, (req, res) => {
  if (!isReelScraperConfigured()) {
    return res.status(503).json({ success: false, error: "Reel scraper disabled (REEL_SCRAPER_DISABLED)" });
  }
  if (isScraperPipelineRunning()) return res.json({ started: false, message: "Already running" });
  res.json({ started: true, message: "Full scrape started" });
  runScraperPipeline().catch((e) => console.error("[ReelFinder] pipeline:", e?.message));
});

router.post("/admin/trigger-hot", authMiddleware, adminMiddleware, (req, res) => {
  if (!isReelScraperConfigured()) {
    return res.status(503).json({ success: false, error: "Reel scraper disabled (REEL_SCRAPER_DISABLED)" });
  }
  if (isScraperPipelineRunning()) return res.json({ started: false, message: "Already running" });
  res.json({ started: true, message: "Hot scrape started" });
  runScraperPipelineWithMode("hot").catch((e) => console.error("[ReelFinder] hot:", e?.message));
});

router.post("/admin/trigger-warm", authMiddleware, adminMiddleware, (req, res) => {
  if (!isReelScraperConfigured()) {
    return res.status(503).json({ success: false, error: "Reel scraper disabled (REEL_SCRAPER_DISABLED)" });
  }
  if (isScraperPipelineRunning()) return res.json({ started: false, message: "Already running" });
  res.json({ started: true, message: "Warm scrape started" });
  runScraperPipelineWithMode("warm").catch((e) => console.error("[ReelFinder] warm:", e?.message));
});

router.get("/admin/logs", authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    await cleanupStaleLogs();
    const logs = await prisma.scrapeLog.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
    return res.json({ success: true, logs });
  } catch (err) { return res.status(500).json({ success: false, error: "Failed" }); }
});

router.get("/cron-scrape", (req, res) => {
  const secret = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query?.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  if (!isReelScraperConfigured()) {
    return res.status(503).json({ error: "Reel scraper disabled (REEL_SCRAPER_DISABLED)" });
  }
  if (isScraperPipelineRunning()) return res.json({ started: false });
  res.json({ started: true });
  runScraperPipeline().catch((e) => console.error("[ReelFinder] cron:", e?.message));
});

router.post("/admin/assign-groups", authMiddleware, adminMiddleware, (_req, res) => res.json({ success: true }));
router.post("/admin/recalculate",   authMiddleware, adminMiddleware, (_req, res) => res.json({ success: true }));

export default router;
