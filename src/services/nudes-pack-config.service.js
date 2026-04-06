import prisma from "../lib/prisma.js";
import {
  NUDES_PACK_POSES,
  getNudesPackPoseById,
  getNudesPackAdditiveLoraHint,
  validateNudesPackPoseIds,
} from "../../shared/nudesPackPoses.js";

const NUDES_PACK_POSE_ACTION = "nudes_pack_pose_overrides";
const NUDES_PACK_POSE_TARGET = "global";

function sanitizePoseOverrideMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [poseId, raw] of Object.entries(input)) {
    const base = getNudesPackPoseById(String(poseId || "").trim());
    if (!base) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = {};
    if (typeof raw.title === "string") item.title = raw.title.slice(0, 120);
    if (typeof raw.summary === "string") item.summary = raw.summary.slice(0, 500);
    if (typeof raw.promptFragment === "string") item.promptFragment = raw.promptFragment.slice(0, 5000);
    if (typeof raw.category === "string") item.category = raw.category.slice(0, 40);
    if (typeof raw.enabled === "boolean") item.enabled = raw.enabled;
    out[base.id] = item;
  }
  return out;
}

async function getPoseOverrideRow() {
  return prisma.adminAuditLog.findFirst({
    where: {
      action: NUDES_PACK_POSE_ACTION,
      targetType: "config",
      targetId: NUDES_PACK_POSE_TARGET,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, detailsJson: true },
  });
}

export async function getNudesPackPoseOverrides() {
  const row = await getPoseOverrideRow();
  if (!row?.detailsJson) return {};
  try {
    return sanitizePoseOverrideMap(JSON.parse(row.detailsJson));
  } catch {
    return {};
  }
}

export async function getEffectiveNudesPackPoses() {
  const overrides = await getNudesPackPoseOverrides();
  return NUDES_PACK_POSES
    .map((pose) => {
      const ov = overrides[pose.id];
      if (!ov) return pose;
      if (ov.enabled === false) return null;
      return {
        ...pose,
        ...(typeof ov.title === "string" && ov.title ? { title: ov.title } : {}),
        ...(typeof ov.summary === "string" && ov.summary ? { summary: ov.summary } : {}),
        ...(typeof ov.promptFragment === "string" && ov.promptFragment ? { promptFragment: ov.promptFragment } : {}),
        ...(typeof ov.category === "string" && ov.category ? { category: ov.category } : {}),
      };
    })
    .filter(Boolean);
}

export async function getNudesPackPoseByIdEffective(id) {
  const list = await getEffectiveNudesPackPoses();
  return list.find((p) => p.id === id) || null;
}

export async function validateNudesPackPoseIdsEffective(ids) {
  const fallback = validateNudesPackPoseIds(ids);
  if (!fallback.ok) return fallback;
  const list = await getEffectiveNudesPackPoses();
  const allowedIds = new Set(list.map((p) => p.id));
  for (const id of ids) {
    if (!allowedIds.has(id)) {
      return { ok: false, error: `Pose disabled by admin: ${id}` };
    }
  }
  return { ok: true };
}

export function getNudesPackAdditiveHintForPose(poseId) {
  return getNudesPackAdditiveLoraHint(poseId);
}

export async function upsertNudesPackPoseOverrides(nextOverrides, adminMeta = {}) {
  const sanitized = sanitizePoseOverrideMap(nextOverrides);
  const existing = await getPoseOverrideRow();
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
        action: NUDES_PACK_POSE_ACTION,
        targetType: "config",
        targetId: NUDES_PACK_POSE_TARGET,
        detailsJson: JSON.stringify(sanitized),
      },
    });
  }
  return sanitized;
}
