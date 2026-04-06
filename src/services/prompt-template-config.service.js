import prisma from "../lib/prisma.js";

const PROMPT_TEMPLATE_ACTION = "prompt_template_config";
const PROMPT_TEMPLATE_TARGET = "global";
const CACHE_TTL_MS = 5000;
let cache = null;
let cacheAt = 0;

function sanitizeTemplateMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const k = String(key || "").trim();
    if (!k) continue;
    if (value == null) continue;
    const v = String(value);
    // Keep payload bounded; system prompts can be long, but avoid runaway values.
    if (v.length > 80_000) continue;
    out[k] = v;
  }
  return out;
}

async function getConfigRow() {
  return prisma.adminAuditLog.findFirst({
    where: {
      action: PROMPT_TEMPLATE_ACTION,
      targetType: "config",
      targetId: PROMPT_TEMPLATE_TARGET,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, detailsJson: true },
  });
}

export async function getPromptTemplateOverrides() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  const row = await getConfigRow();
  if (!row?.detailsJson) {
    cache = {};
    cacheAt = now;
    return cache;
  }
  try {
    cache = sanitizeTemplateMap(JSON.parse(row.detailsJson));
    cacheAt = now;
    return cache;
  } catch {
    cache = {};
    cacheAt = now;
    return cache;
  }
}

export async function getPromptTemplateValue(key, fallback = "") {
  const map = await getPromptTemplateOverrides();
  const k = String(key || "").trim();
  if (!k) return fallback;
  const value = map[k];
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

export async function upsertPromptTemplateOverrides(nextMap, adminMeta = {}) {
  const sanitized = sanitizeTemplateMap(nextMap);
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
        action: PROMPT_TEMPLATE_ACTION,
        targetType: "config",
        targetId: PROMPT_TEMPLATE_TARGET,
        detailsJson: JSON.stringify(sanitized),
      },
    });
  }
  cache = sanitized;
  cacheAt = Date.now();
  return sanitized;
}
