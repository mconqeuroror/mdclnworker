import fs from "fs/promises";
import path from "path";
import { LANDER_NEW_DEFAULTS } from "../config/lander-new-defaults.js";
import { getAppBranding } from "./branding.service.js";
import prisma from "../lib/prisma.js";

const DATA_DIR = path.join(process.cwd(), "data");
const PUBLISHED_PATH = path.join(DATA_DIR, "lander-new.published.json");
const DRAFT_PATH = path.join(DATA_DIR, "lander-new.draft.json");
const LANDER_NEW_CONFIG_ID = "global";

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (base && typeof base === "object") {
    const out = { ...base };
    const source = override && typeof override === "object" ? override : {};
    for (const key of Object.keys(source)) {
      out[key] = deepMerge(base[key], source[key]);
    }
    return out;
  }
  return override === undefined ? base : override;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function withMetadata(config, prev = null) {
  return {
    ...config,
    _meta: {
      version: Number(prev?._meta?.version || 0) + 1,
      updatedAt: new Date().toISOString(),
    },
  };
}

function sanitizeString(value, maxLen = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function sanitizeUrl(value) {
  const raw = sanitizeString(value, 2048);
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith("#")) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
    return "";
  } catch {
    return "";
  }
}

function sanitizeNonNegativeNumber(value, max = 10000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

function sanitizeConfig(input) {
  const merged = deepMerge(LANDER_NEW_DEFAULTS, input || {});
  merged.seo.title = sanitizeString(merged.seo.title, 140);
  merged.seo.description = sanitizeString(merged.seo.description, 320);
  merged.seo.canonicalUrl = sanitizeUrl(merged.seo.canonicalUrl);
  merged.seo.ogTitle = sanitizeString(merged.seo.ogTitle, 140);
  merged.seo.ogDescription = sanitizeString(merged.seo.ogDescription, 320);
  merged.seo.ogImageUrl = sanitizeUrl(merged.seo.ogImageUrl);
  merged.seo.ogType = sanitizeString(merged.seo.ogType, 40);
  merged.seo.ogSiteName = sanitizeString(merged.seo.ogSiteName, 120);
  merged.seo.twitterTitle = sanitizeString(merged.seo.twitterTitle, 140);
  merged.seo.twitterDescription = sanitizeString(merged.seo.twitterDescription, 320);
  merged.seo.twitterImageUrl = sanitizeUrl(merged.seo.twitterImageUrl);
  merged.seo.twitterSite = sanitizeString(merged.seo.twitterSite, 40);
  merged.seo.twitterCreator = sanitizeString(merged.seo.twitterCreator, 40);
  merged.seo.robots = sanitizeString(merged.seo.robots, 80);
  if (!merged.seo.jsonLd || typeof merged.seo.jsonLd !== "object") {
    merged.seo.jsonLd = LANDER_NEW_DEFAULTS.seo.jsonLd;
  }
  const org = merged.seo.jsonLd.organization || {};
  org.name = sanitizeString(org.name, 120);
  org.url = sanitizeUrl(org.url);
  org.logo = sanitizeUrl(org.logo);
  org.sameAs = Array.isArray(org.sameAs) ? org.sameAs.map((x) => sanitizeUrl(x)).filter(Boolean) : [];
  merged.seo.jsonLd.organization = org;

  const page = merged.seo.jsonLd.webPage || {};
  page.name = sanitizeString(page.name, 140);
  page.url = sanitizeUrl(page.url);
  page.description = sanitizeString(page.description, 320);
  merged.seo.jsonLd.webPage = page;

  const app = merged.seo.jsonLd.softwareApplication || {};
  app.name = sanitizeString(app.name, 120);
  app.applicationCategory = sanitizeString(app.applicationCategory, 80);
  app.operatingSystem = sanitizeString(app.operatingSystem, 80);
  const offers = app.offers || {};
  offers.price = sanitizeString(offers.price, 24);
  offers.priceCurrency = sanitizeString(offers.priceCurrency, 8);
  app.offers = offers;
  merged.seo.jsonLd.softwareApplication = app;
  merged.brand.logoUrl = sanitizeUrl(merged.brand.logoUrl);
  merged.brand.ctaHref = sanitizeUrl(merged.brand.ctaHref);
  if (merged.promotionBar && typeof merged.promotionBar === "object") {
    merged.promotionBar.enabled = Boolean(merged.promotionBar.enabled);
    merged.promotionBar.message = sanitizeString(merged.promotionBar.message, 240);
    merged.promotionBar.ctaText = sanitizeString(merged.promotionBar.ctaText, 64);
    merged.promotionBar.ctaHref = sanitizeUrl(merged.promotionBar.ctaHref);
  }
  if (merged.countdown && typeof merged.countdown === "object") {
    merged.countdown.enabled = Boolean(merged.countdown.enabled);
    merged.countdown.eyebrow = sanitizeString(merged.countdown.eyebrow, 80);
    merged.countdown.heading = sanitizeString(merged.countdown.heading, 180);
    merged.countdown.body = sanitizeString(merged.countdown.body, 500);
    merged.countdown.ctaText = sanitizeString(merged.countdown.ctaText, 64);
    merged.countdown.ctaHref = sanitizeUrl(merged.countdown.ctaHref);
    merged.countdown.targetISO = sanitizeString(merged.countdown.targetISO, 64);
    merged.countdown.finishedText = sanitizeString(merged.countdown.finishedText, 120);
  }
  merged.sections.hero.mediaUrl = sanitizeUrl(merged.sections.hero.mediaUrl);
  merged.sections.hero.primaryCtaHref = sanitizeUrl(merged.sections.hero.primaryCtaHref);
  merged.sections.hero.secondaryCtaHref = sanitizeUrl(merged.sections.hero.secondaryCtaHref);
  merged.sections.partners.logos = (merged.sections.partners.logos || []).map((item) => ({
    ...item,
    name: sanitizeString(item?.name, 80),
    logoUrl: sanitizeUrl(item?.logoUrl),
  }));
  merged.sections.topChoice.items = (merged.sections.topChoice.items || []).map((item) => ({
    ...item,
    title: sanitizeString(item?.title, 120),
    description: sanitizeString(item?.description, 240),
    mediaType: String(item?.mediaType || "").toLowerCase() === "image" ? "image" : "video",
    imageUrl: sanitizeUrl(item?.imageUrl || item?.mediaUrl || ""),
    videoUrl: sanitizeUrl(item?.videoUrl || item?.mediaUrl || ""),
    mediaUrl: sanitizeUrl(item?.mediaUrl || item?.videoUrl || item?.imageUrl),
  }));
  const spacers = merged?.layout?.spacers || {};
  merged.layout = {
    ...(merged.layout || {}),
    spacers: {
      beforeHeader: sanitizeNonNegativeNumber(spacers.beforeHeader, 600),
      beforeHero: sanitizeNonNegativeNumber(spacers.beforeHero, 600),
      beforeCountdown: sanitizeNonNegativeNumber(spacers.beforeCountdown, 600),
      beforeCreateToday: sanitizeNonNegativeNumber(spacers.beforeCreateToday, 600),
      beforeTopChoice: sanitizeNonNegativeNumber(spacers.beforeTopChoice, 600),
      beforePartners: sanitizeNonNegativeNumber(spacers.beforePartners, 600),
      beforePricing: sanitizeNonNegativeNumber(spacers.beforePricing, 600),
      beforeFooter: sanitizeNonNegativeNumber(spacers.beforeFooter, 600),
    },
  };
  merged.styles = {
    ...(merged.styles || {}),
    buttonPrimaryBackground: sanitizeString(merged?.styles?.buttonPrimaryBackground, 120),
    buttonPrimaryText: sanitizeString(merged?.styles?.buttonPrimaryText, 120),
    buttonPrimaryBorder: sanitizeString(merged?.styles?.buttonPrimaryBorder, 120),
    buttonGhostText: sanitizeString(merged?.styles?.buttonGhostText, 120),
    buttonGhostBorder: sanitizeString(merged?.styles?.buttonGhostBorder, 120),
    buttonGhostBackground: sanitizeString(merged?.styles?.buttonGhostBackground, 120),
  };
  return merged;
}

function isMissingLanderConfigSchemaError(err) {
  if (!err) return false;
  if (err.code === "P2021" || err.code === "P2022") return true;
  const msg = String(err.message || "").toLowerCase();
  return msg.includes("landernewconfig") && (msg.includes("does not exist") || msg.includes("unknown"));
}

async function readDbConfigRow() {
  try {
    return await prisma.landerNewConfig.findUnique({
      where: { id: LANDER_NEW_CONFIG_ID },
      select: { published: true, draft: true },
    });
  } catch (err) {
    if (isMissingLanderConfigSchemaError(err)) {
      return null;
    }
    throw err;
  }
}

async function writeDbConfigRow({ published, draft }) {
  return prisma.landerNewConfig.upsert({
    where: { id: LANDER_NEW_CONFIG_ID },
    create: {
      id: LANDER_NEW_CONFIG_ID,
      published,
      draft,
    },
    update: {
      published,
      draft,
    },
    select: { published: true, draft: true },
  });
}

export async function getPublishedLanderNewConfig() {
  const dbRow = await readDbConfigRow();
  const stored = dbRow?.published ?? await readJsonSafe(PUBLISHED_PATH);
  const normalized = sanitizeConfig(stored || LANDER_NEW_DEFAULTS);
  const branding = await getAppBranding().catch(() => null);
  if (!normalized.brand.logoUrl && branding?.logoUrl) {
    normalized.brand.logoUrl = branding.logoUrl;
  }
  return normalized;
}

export async function getAdminLanderNewConfigBundle() {
  const dbRow = await readDbConfigRow();
  const [publishedRaw, draftRaw] = dbRow
    ? [dbRow.published, dbRow.draft]
    : await Promise.all([readJsonSafe(PUBLISHED_PATH), readJsonSafe(DRAFT_PATH)]);
  const published = sanitizeConfig(publishedRaw || LANDER_NEW_DEFAULTS);
  const draft = sanitizeConfig(draftRaw || published);
  return { published, draft };
}

export async function saveDraftLanderNewConfig(nextDraft) {
  const sanitized = sanitizeConfig(nextDraft);
  const dbRow = await readDbConfigRow();
  const prev = dbRow?.draft ?? await readJsonSafe(DRAFT_PATH);
  const withMeta = withMetadata(sanitized, prev);
  try {
    const publishedCurrent = sanitizeConfig(
      dbRow?.published || await readJsonSafe(PUBLISHED_PATH) || LANDER_NEW_DEFAULTS,
    );
    await writeDbConfigRow({
      published: dbRow?.published || publishedCurrent,
      draft: withMeta,
    });
  } catch (err) {
    if (!isMissingLanderConfigSchemaError(err)) throw err;
    await writeJson(DRAFT_PATH, withMeta);
  }
  return withMeta;
}

export async function publishLanderNewConfig() {
  const dbRow = await readDbConfigRow();
  const [draft, published] = dbRow
    ? [dbRow.draft, dbRow.published]
    : await Promise.all([readJsonSafe(DRAFT_PATH), readJsonSafe(PUBLISHED_PATH)]);
  const source = sanitizeConfig(draft || published || LANDER_NEW_DEFAULTS);
  const withMeta = withMetadata(source, published);
  try {
    await writeDbConfigRow({
      published: withMeta,
      draft: withMeta,
    });
  } catch (err) {
    if (!isMissingLanderConfigSchemaError(err)) throw err;
    await writeJson(PUBLISHED_PATH, withMeta);
  }
  return withMeta;
}

