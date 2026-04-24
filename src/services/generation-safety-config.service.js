import prisma from "../lib/prisma.js";

const SAFETY_CONFIG_ACTION = "generation_safety_config";
const SAFETY_CONFIG_TARGET = "global";
const CACHE_TTL_MS = 5000;
let cache = null;
let cacheAt = 0;

export const DEFAULT_GENERATION_SAFETY_CONFIG = Object.freeze({
  openrouterModel: "x-ai/grok-4.1-fast",
  aiSystemPrompt:
    "You are a strict content safety classifier for AI image/video generation prompts.",
  aiGeneralPolicy:
    "Block any minor sexual content. Adult NSFW is not blocked by this generic policy.",
  aiSoulxPolicy:
    "Block any minor sexual content. For ModelClone-X also block explicit sex acts/sex scenes. Allow only mild adult nudity (e.g. subtle clothing reveal, visible nipples under shirt) if clearly adult and non-explicit.",
  heuristicSexualTermsPattern:
    "\\b(sex|sexual|explicit|hardcore|porn|nsfw|nude|naked|nipples?|breasts?|boobs?|tits?|vagina|penis|cock|dick|genitals?|blowjob|handjob|anal|oral|cum|creampie|penetrat(?:e|ion)|fucking|fuck)\\b",
  heuristicChildTermsPattern:
    "\\b(child|minor|underage|preteen|teen|young girl|young boy|schoolgirl|school girl|schoolboy|school boy|loli|jailbait|barely legal)\\b",
  heuristicExplicitSexActsPattern:
    "\\b(blowjob|handjob|anal|oral sex|penetrat(?:e|ion)|creampie|cumshot|fucking|doggystyle|69|missionary|sex scene|intercourse)\\b",
  heuristicMinorAgePattern:
    "\\b([0-9]{1,2})\\s*(?:yo|y\\/o|years?\\s*old)\\b",
});

function sanitizeString(value, maxLen = 120_000) {
  if (value == null) return null;
  const v = String(value);
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function sanitizeSafetyConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_GENERATION_SAFETY_CONFIG };
  }
  const out = { ...DEFAULT_GENERATION_SAFETY_CONFIG };
  for (const key of Object.keys(DEFAULT_GENERATION_SAFETY_CONFIG)) {
    if (input[key] == null) continue;
    const cleaned = sanitizeString(input[key], 120_000);
    if (cleaned && cleaned.trim()) out[key] = cleaned;
  }
  return out;
}

async function getConfigRow() {
  return prisma.adminAuditLog.findFirst({
    where: {
      action: SAFETY_CONFIG_ACTION,
      targetType: "config",
      targetId: SAFETY_CONFIG_TARGET,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, detailsJson: true },
  });
}

export async function getGenerationSafetyConfig() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  const row = await getConfigRow();
  if (!row?.detailsJson) {
    cache = { ...DEFAULT_GENERATION_SAFETY_CONFIG };
    cacheAt = now;
    return cache;
  }
  try {
    cache = sanitizeSafetyConfig(JSON.parse(row.detailsJson));
    cacheAt = now;
    return cache;
  } catch {
    cache = { ...DEFAULT_GENERATION_SAFETY_CONFIG };
    cacheAt = now;
    return cache;
  }
}

export async function upsertGenerationSafetyConfig(nextConfig, adminMeta = {}) {
  const sanitized = sanitizeSafetyConfig(nextConfig);
  const existing = await getConfigRow();
  if (existing?.id) {
    await prisma.adminAuditLog.update({
      where: { id: existing.id },
      data: {
        detailsJson: JSON.stringify(sanitized),
        adminUserId: adminMeta.userId || null,
        adminEmail: adminMeta.email || null,
      },
    });
  } else {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: adminMeta.userId || null,
        adminEmail: adminMeta.email || null,
        action: SAFETY_CONFIG_ACTION,
        targetType: "config",
        targetId: SAFETY_CONFIG_TARGET,
        detailsJson: JSON.stringify(sanitized),
      },
    });
  }
  cache = sanitized;
  cacheAt = Date.now();
  return sanitized;
}
