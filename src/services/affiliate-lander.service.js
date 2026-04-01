import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { getAppBranding } from "./branding.service.js";

const BLOCK_TYPES = new Set(["heading", "subheading", "video", "button"]);
const MAX_BLOCKS = 32;
const SUFFIX_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const RESERVED_SUFFIXES = new Set([
  "admin",
  "api",
  "aff",
  "login",
  "signup",
  "dashboard",
  "lander-new",
  "landing",
  "free-course",
  "create-ai-model",
  "r",
  "verify",
  "terms",
  "privacy",
  "cookies",
  "onboarding",
  "pro",
  "nsfw",
  "reformatter",
  "voice-test",
  "test-replicate",
  "test-face-ref",
  "designer-studio",
  "forgot-password",
  "reset-password",
  "sk",
  "static",
  "assets",
  "favicon.ico",
  "list",
]);

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

function sanitizeString(value, maxLen = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function sanitizeUrl(value) {
  const raw = sanitizeString(value, 2048);
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith("#") || raw.startsWith("mailto:")) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
    return "";
  } catch {
    return "";
  }
}

function newBlockId() {
  return `blk_${randomUUID().replace(/-/g, "")}`;
}

export function defaultAffiliateLanderConfig(suffix, baseUrl) {
  const root = `${String(baseUrl || "https://modelclone.app").replace(/\/$/, "")}/aff/${suffix}`;
  return {
    blocks: [
      { id: newBlockId(), type: "heading", text: "Your headline" },
      { id: newBlockId(), type: "subheading", text: "Supporting line goes here." },
      { id: newBlockId(), type: "video", videoUrl: "", posterUrl: "" },
      { id: newBlockId(), type: "button", label: "Get started", href: "/signup" },
    ],
    spatialOverrides: {},
    styleOverrides: {},
    styles: {
      buttonPrimaryBackground: "",
      buttonPrimaryText: "",
      buttonPrimaryBorder: "",
      buttonGhostText: "",
      buttonGhostBorder: "",
      buttonGhostBackground: "",
    },
    seo: {
      title: "Affiliate landing",
      description: "",
      canonicalUrl: root,
      robots: "index,follow",
      ogTitle: "",
      ogDescription: "",
      ogImageUrl: "",
      ogType: "website",
      ogSiteName: "ModelClone",
      twitterCard: "summary_large_image",
      twitterTitle: "",
      twitterDescription: "",
      twitterImageUrl: "",
      twitterSite: "",
      twitterCreator: "",
      jsonLd: null,
    },
  };
}

function sanitizeBlock(raw, usedIds) {
  if (!raw || typeof raw !== "object") return null;
  let id = sanitizeString(raw.id, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id) id = newBlockId();
  else if (!id.startsWith("blk_")) id = `blk_${id}`.slice(0, 80);
  while (usedIds.has(id)) id = newBlockId();
  usedIds.add(id);
  const type = sanitizeString(raw.type, 24).toLowerCase();
  if (!BLOCK_TYPES.has(type)) return null;
  if (type === "heading") {
    return { id, type, text: sanitizeString(raw.text, 600) };
  }
  if (type === "subheading") {
    return { id, type, text: sanitizeString(raw.text, 4000) };
  }
  if (type === "video") {
    return {
      id,
      type,
      videoUrl: sanitizeUrl(raw.videoUrl),
      posterUrl: sanitizeUrl(raw.posterUrl),
    };
  }
  if (type === "button") {
    return {
      id,
      type,
      label: sanitizeString(raw.label, 200),
      href: sanitizeUrl(raw.href) || "/signup",
    };
  }
  return null;
}

function sanitizeResponsiveSpatial(spatial) {
  if (!spatial || typeof spatial !== "object") return {};
  const out = {};
  for (const bp of ["base", "sm", "md", "lg", "xl"]) {
    const t = spatial[bp];
    if (!t || typeof t !== "object") continue;
    const entry = {};
    if (t.hidden === true) entry.hidden = true;
    for (const k of [
      "translateX",
      "translateY",
      "width",
      "maxWidth",
      "height",
      "marginTop",
      "marginBottom",
      "marginLeft",
      "marginRight",
    ]) {
      if (t[k] != null && typeof t[k] === "string") entry[k] = t[k].slice(0, 80);
    }
    if (Object.keys(entry).length) out[bp] = entry;
  }
  return out;
}

function sanitizeStyleOverrides(so, allowedIds) {
  if (!so || typeof so !== "object") return {};
  const out = {};
  for (const [id, responsive] of Object.entries(so)) {
    if (!allowedIds.has(id)) continue;
    if (!responsive || typeof responsive !== "object") continue;
    const ro = {};
    for (const [bp, o] of Object.entries(responsive)) {
      if (!o || typeof o !== "object") continue;
      const e = {};
      if (typeof o.color === "string") e.color = o.color.slice(0, 80);
      if (typeof o.backgroundColor === "string") e.backgroundColor = o.backgroundColor.slice(0, 80);
      if (typeof o.fontSize === "string") e.fontSize = o.fontSize.slice(0, 40);
      if (typeof o.fontWeight === "string") e.fontWeight = o.fontWeight.slice(0, 20);
      if (Object.keys(e).length) ro[bp] = e;
    }
    if (Object.keys(ro).length) out[id] = ro;
  }
  return out;
}

export function sanitizeAffiliateConfig(input, _suffix) {
  const blocksIn = Array.isArray(input?.blocks) ? input.blocks : [];
  const blocks = [];
  const usedIds = new Set();
  for (const b of blocksIn) {
    if (blocks.length >= MAX_BLOCKS) break;
    const sb = sanitizeBlock(b, usedIds);
    if (sb) blocks.push(sb);
  }
  const allowedIds = new Set(blocks.map((b) => b.id));

  const stylesIn = input?.styles && typeof input.styles === "object" ? input.styles : {};
  const styles = {
    buttonPrimaryBackground: sanitizeString(stylesIn.buttonPrimaryBackground, 120),
    buttonPrimaryText: sanitizeString(stylesIn.buttonPrimaryText, 120),
    buttonPrimaryBorder: sanitizeString(stylesIn.buttonPrimaryBorder, 120),
    buttonGhostText: sanitizeString(stylesIn.buttonGhostText, 120),
    buttonGhostBorder: sanitizeString(stylesIn.buttonGhostBorder, 120),
    buttonGhostBackground: sanitizeString(stylesIn.buttonGhostBackground, 120),
  };

  const seoIn = input?.seo && typeof input.seo === "object" ? input.seo : {};
  const seo = {
    title: sanitizeString(seoIn.title, 140) || "Affiliate landing",
    description: sanitizeString(seoIn.description, 320),
    canonicalUrl: sanitizeUrl(seoIn.canonicalUrl),
    robots: sanitizeString(seoIn.robots, 80) || "index,follow",
    ogTitle: sanitizeString(seoIn.ogTitle, 140),
    ogDescription: sanitizeString(seoIn.ogDescription, 320),
    ogImageUrl: sanitizeUrl(seoIn.ogImageUrl),
    ogType: sanitizeString(seoIn.ogType, 40) || "website",
    ogSiteName: sanitizeString(seoIn.ogSiteName, 120) || "ModelClone",
    twitterCard: sanitizeString(seoIn.twitterCard, 40) || "summary_large_image",
    twitterTitle: sanitizeString(seoIn.twitterTitle, 140),
    twitterDescription: sanitizeString(seoIn.twitterDescription, 320),
    twitterImageUrl: sanitizeUrl(seoIn.twitterImageUrl),
    twitterSite: sanitizeString(seoIn.twitterSite, 40),
    twitterCreator: sanitizeString(seoIn.twitterCreator, 40),
    jsonLd: null,
  };

  const spatialIn = input?.spatialOverrides && typeof input.spatialOverrides === "object" ? input.spatialOverrides : {};
  const spatialOverrides = {};
  for (const [id, responsive] of Object.entries(spatialIn)) {
    if (!allowedIds.has(id)) continue;
    const sr = sanitizeResponsiveSpatial(responsive);
    if (Object.keys(sr).length) spatialOverrides[id] = sr;
  }

  const styleOverrides = sanitizeStyleOverrides(input?.styleOverrides, allowedIds);

  return { blocks, styles, seo, spatialOverrides, styleOverrides };
}

export function normalizeSuffix(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s;
}

export function assertValidSuffix(suffix) {
  const s = normalizeSuffix(suffix);
  if (!s || s.length < 2) throw new Error("Suffix must be at least 2 characters");
  if (s.length > 64) throw new Error("Suffix is too long");
  if (!SUFFIX_RE.test(s)) throw new Error("Use lowercase letters, numbers, and hyphens only");
  if (RESERVED_SUFFIXES.has(s)) throw new Error("This path is reserved");
  return s;
}

export async function listAffiliateLanders() {
  const rows = await prisma.affiliateLanderPage.findMany({
    orderBy: { updatedAt: "desc" },
    select: { suffix: true, updatedAt: true, createdAt: true },
  });
  return rows;
}

export async function createAffiliateLander(suffixRaw) {
  const suffix = assertValidSuffix(suffixRaw);
  const branding = await getAppBranding();
  const baseUrl = branding?.baseUrl || process.env.PUBLIC_APP_URL || "https://modelclone.app";
  const fresh = defaultAffiliateLanderConfig(suffix, baseUrl);
  try {
    const row = await prisma.affiliateLanderPage.create({
      data: {
        suffix,
        draft: fresh,
        published: fresh,
      },
    });
    return row;
  } catch (e) {
    if (e?.code === "P2002") throw new Error("That path is already in use");
    throw e;
  }
}

export async function getAffiliateLanderRow(suffixRaw) {
  const suffix = normalizeSuffix(suffixRaw);
  return prisma.affiliateLanderPage.findUnique({ where: { suffix } });
}

export async function getAdminAffiliateLanderBundle(suffixRaw) {
  const row = await getAffiliateLanderRow(suffixRaw);
  if (!row) return null;
  const branding = await getAppBranding();
  const baseUrl = branding?.baseUrl || process.env.PUBLIC_APP_URL || "https://modelclone.app";
  const defaults = defaultAffiliateLanderConfig(row.suffix, baseUrl);
  return {
    suffix: row.suffix,
    draft: deepMerge(defaults, row.draft || {}),
    published: deepMerge(defaults, row.published || {}),
  };
}

export async function saveDraftAffiliateLander(suffixRaw, config) {
  const row = await getAffiliateLanderRow(suffixRaw);
  if (!row) throw new Error("Affiliate lander not found");
  const sanitized = sanitizeAffiliateConfig(config, row.suffix);
  const branding = await getAppBranding();
  const baseUrl = branding?.baseUrl || process.env.PUBLIC_APP_URL || "https://modelclone.app";
  const defaults = defaultAffiliateLanderConfig(row.suffix, baseUrl);
  const merged = deepMerge(defaults, sanitized);
  if (!merged.seo.canonicalUrl) {
    merged.seo.canonicalUrl = `${String(baseUrl).replace(/\/$/, "")}/aff/${row.suffix}`;
  }
  await prisma.affiliateLanderPage.update({
    where: { suffix: row.suffix },
    data: { draft: merged },
  });
  return merged;
}

export async function publishAffiliateLander(suffixRaw) {
  const row = await getAffiliateLanderRow(suffixRaw);
  if (!row) throw new Error("Affiliate lander not found");
  const draft = row.draft && typeof row.draft === "object" ? row.draft : {};
  const sanitized = sanitizeAffiliateConfig(draft, row.suffix);
  const branding = await getAppBranding();
  const baseUrl = branding?.baseUrl || process.env.PUBLIC_APP_URL || "https://modelclone.app";
  const defaults = defaultAffiliateLanderConfig(row.suffix, baseUrl);
  const merged = deepMerge(defaults, sanitized);
  if (!merged.seo.canonicalUrl) {
    merged.seo.canonicalUrl = `${String(baseUrl).replace(/\/$/, "")}/aff/${row.suffix}`;
  }
  await prisma.affiliateLanderPage.update({
    where: { suffix: row.suffix },
    data: { published: merged, draft: merged },
  });
  return merged;
}

export async function deleteAffiliateLander(suffixRaw) {
  const suffix = normalizeSuffix(suffixRaw);
  await prisma.affiliateLanderPage.deleteMany({ where: { suffix } });
}

export async function getPublishedAffiliateLanderConfig(suffixRaw) {
  const row = await getAffiliateLanderRow(suffixRaw);
  if (!row?.published) return null;
  const branding = await getAppBranding();
  const baseUrl = branding?.baseUrl || process.env.PUBLIC_APP_URL || "https://modelclone.app";
  const defaults = defaultAffiliateLanderConfig(row.suffix, baseUrl);
  return deepMerge(defaults, sanitizeAffiliateConfig(row.published, row.suffix));
}

export { newBlockId, BLOCK_TYPES };
