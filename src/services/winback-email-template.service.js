import prisma from "../lib/prisma.js";

const ACTION = "winback_email_template_config";
const TARGET = "global";
const CACHE_TTL_MS = 5000;

export const DEFAULT_WINBACK_EMAIL_TEMPLATE = {
  subject: "{{DISCOUNT_PERCENT}}% off your first membership is waiting",
  title: "{{DISCOUNT_PERCENT}}% Off Your First Membership",
  intro: "Hey {{NAME}}, thanks for signing up. We saved a private first-membership discount for you.",
  content: `<div style="background:#f7f7f5;border:1px solid #e2e2de;border-radius:4px;padding:20px 22px;margin-bottom:16px;">
  <p style="font-size:13px;color:#9b9b93;margin-bottom:8px;">Discount code</p>
  <p style="font-size:30px;line-height:1.1;font-weight:600;color:#111;font-family:'DM Mono', monospace;">{{DISCOUNT_CODE}}</p>
</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;color:#555550;margin:0 0 18px;">
  <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Discount</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;"><strong>{{DISCOUNT_PERCENT}}%</strong></td></tr>
  <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Applies to</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;">First membership checkout</td></tr>
  <tr><td style="padding:8px 0;">Expires</td><td style="padding:8px 0;text-align:right;">{{EXPIRES_AT}}</td></tr>
</table>
<p style="margin:0 0 16px;"><a href="{{DASHBOARD_URL}}" class="cta-btn">Claim membership offer</a></p>
<p class="note">Code is single-use and tied to your first membership purchase.</p>
<p class="note">If you've already joined, you can ignore this email.</p>`,
};

let cache = null;
let cacheAt = 0;

function sanitizeField(value, fallback) {
  if (typeof value !== "string") return fallback;
  const safe = value.slice(0, 100_000);
  return safe.trim() ? safe : fallback;
}

function sanitizeTemplate(template) {
  const input = template && typeof template === "object" ? template : {};
  return {
    subject: sanitizeField(input.subject, DEFAULT_WINBACK_EMAIL_TEMPLATE.subject),
    title: sanitizeField(input.title, DEFAULT_WINBACK_EMAIL_TEMPLATE.title),
    intro: sanitizeField(input.intro, DEFAULT_WINBACK_EMAIL_TEMPLATE.intro),
    content: sanitizeField(input.content, DEFAULT_WINBACK_EMAIL_TEMPLATE.content),
  };
}

async function getRow() {
  return prisma.adminAuditLog.findFirst({
    where: {
      action: ACTION,
      targetType: "config",
      targetId: TARGET,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, detailsJson: true },
  });
}

export async function getWinbackEmailTemplate() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  const row = await getRow();
  if (!row?.detailsJson) {
    cache = { ...DEFAULT_WINBACK_EMAIL_TEMPLATE };
    cacheAt = now;
    return cache;
  }
  try {
    cache = sanitizeTemplate(JSON.parse(row.detailsJson));
  } catch {
    cache = { ...DEFAULT_WINBACK_EMAIL_TEMPLATE };
  }
  cacheAt = now;
  return cache;
}

export async function upsertWinbackEmailTemplate(nextTemplate, adminMeta = {}) {
  const sanitized = sanitizeTemplate(nextTemplate);
  const existing = await getRow();

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
        action: ACTION,
        targetType: "config",
        targetId: TARGET,
        detailsJson: JSON.stringify(sanitized),
      },
    });
  }

  cache = sanitized;
  cacheAt = Date.now();
  return sanitized;
}
