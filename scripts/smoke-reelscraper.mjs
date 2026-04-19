#!/usr/bin/env node
/**
 * Smoke test for the JS-only Instagram scraper. Runs both entrypoints
 * against well-known public Instagram content and prints a compact summary.
 *
 *   node scripts/smoke-reelscraper.mjs
 *   node scripts/smoke-reelscraper.mjs <username> <reel-url>
 *
 * No DB / no env required. Prints normalized records to stdout.
 */

import {
  scrapeProfileReels,
  scrapeSingleReelByUrl,
  isReelScraperConfigured,
  shortcodeFromUrl,
} from "../src/lib/reelscraper-runner.js";

const USERNAME = process.argv[2] || "instagram";
const REEL_URL = process.argv[3] || "https://www.instagram.com/reel/CtjoC2BNsB2/";

function summarize(rec) {
  if (!rec) return null;
  return {
    shortcode: rec.shortcode,
    url: rec.url,
    videoUrl: rec.videoUrl ? `${rec.videoUrl.slice(0, 80)}…` : null,
    thumbnailUrl: rec.thumbnailUrl ? `${rec.thumbnailUrl.slice(0, 80)}…` : null,
    videoViewCount: rec.videoViewCount,
    likesCount: rec.likesCount,
    commentsCount: rec.commentsCount,
    caption: rec.caption ? `${rec.caption.slice(0, 60)}…` : null,
    musicInfo: rec.musicInfo,
    timestamp: rec.timestamp,
  };
}

async function main() {
  console.log(`isReelScraperConfigured() => ${isReelScraperConfigured()}`);
  console.log(`shortcodeFromUrl('${REEL_URL}') => ${shortcodeFromUrl(REEL_URL)}`);
  console.log("");

  console.log(`──── scrapeSingleReelByUrl('${REEL_URL}') ────`);
  try {
    const items = await scrapeSingleReelByUrl(REEL_URL);
    console.log(`returned ${items.length} item(s)`);
    for (const it of items) console.log(JSON.stringify(summarize(it), null, 2));
  } catch (err) {
    console.error("[single] FAILED:", err.message);
  }
  console.log("");

  console.log(`──── scrapeProfileReels('${USERNAME}', 5) ────`);
  try {
    const items = await scrapeProfileReels(USERNAME, 5);
    console.log(`returned ${items.length} item(s)`);
    for (const it of items) console.log(JSON.stringify(summarize(it), null, 2));
  } catch (err) {
    console.error("[profile] FAILED:", err.message);
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
