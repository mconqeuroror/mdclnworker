import fs from "fs/promises";
import path from "path";
import { LANDER_NEW_DEFAULTS } from "../config/lander-new-defaults.js";
import { getAppBranding } from "./branding.service.js";

const DATA_DIR = path.join(process.cwd(), "data");
const PUBLISHED_PATH = path.join(DATA_DIR, "lander-new.published.json");
const DRAFT_PATH = path.join(DATA_DIR, "lander-new.draft.json");

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
  merged.sections.hero.mediaUrl = sanitizeUrl(merged.sections.hero.mediaUrl);
  merged.sections.hero.primaryCtaHref = sanitizeUrl(merged.sections.hero.primaryCtaHref);
  merged.sections.hero.secondaryCtaHref = sanitizeUrl(merged.sections.hero.secondaryCtaHref);
  merged.sections.partners.logos = (merged.sections.partners.logos || []).map((item) => ({
    ...item,
    name: sanitizeString(item?.name, 80),
    logoUrl: sanitizeUrl(item?.logoUrl),
  }));
  return merged;
}

export async function getPublishedLanderNewConfig() {
  const stored = await readJsonSafe(PUBLISHED_PATH);
  const normalized = sanitizeConfig(stored || LANDER_NEW_DEFAULTS);
  const branding = await getAppBranding().catch(() => null);
  if (!normalized.brand.logoUrl && branding?.logoUrl) {
    normalized.brand.logoUrl = branding.logoUrl;
  }
  return normalized;
}

export async function getAdminLanderNewConfigBundle() {
  const [publishedRaw, draftRaw] = await Promise.all([
    readJsonSafe(PUBLISHED_PATH),
    readJsonSafe(DRAFT_PATH),
  ]);
  const published = sanitizeConfig(publishedRaw || LANDER_NEW_DEFAULTS);
  const draft = sanitizeConfig(draftRaw || published);
  return { published, draft };
}

export async function saveDraftLanderNewConfig(nextDraft) {
  const prev = await readJsonSafe(DRAFT_PATH);
  const sanitized = sanitizeConfig(nextDraft);
  const withMeta = withMetadata(sanitized, prev);
  await writeJson(DRAFT_PATH, withMeta);
  return withMeta;
}

export async function publishLanderNewConfig() {
  const [draft, published] = await Promise.all([
    readJsonSafe(DRAFT_PATH),
    readJsonSafe(PUBLISHED_PATH),
  ]);
  const source = sanitizeConfig(draft || published || LANDER_NEW_DEFAULTS);
  const withMeta = withMetadata(source, published);
  await writeJson(PUBLISHED_PATH, withMeta);
  return withMeta;
}

