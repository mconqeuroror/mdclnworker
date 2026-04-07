import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";
import { getRegionFromIp } from "../utils/geo.js";

function resolveClientIp(req) {
  const xff = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const realIp = String(req?.headers?.["x-real-ip"] || "").trim();
  const fallback = String(req?.ip || "").trim();
  return xff || realIp || fallback || null;
}

function deriveGenerationMode(routePath) {
  const path = String(routePath || "").toLowerCase();
  if (path.includes("/soulx/")) return "soulx";
  if (path.includes("/nsfw/")) return "nsfw";
  if (path.includes("/upscale")) return "upscale";
  if (path.includes("/img2img/")) return "img2img";
  if (path.includes("/generate/video")) return "video";
  if (path.includes("/generate/")) return "generate";
  return "unknown";
}

function sanitizePromptPreview(body) {
  const raw = String(
    body?.prompt ||
    body?.userPrompt ||
    body?.description ||
    body?.textPrompt ||
    "",
  );
  return raw.replace(/\s+/g, " ").trim().slice(0, 1000) || null;
}

function resolveAuthToken(req) {
  const cookieToken = req?.cookies?.auth_token;
  if (cookieToken) return String(cookieToken);
  const authHeader = String(req?.headers?.authorization || "");
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return null;
}

function resolveUserIdFromToken(req) {
  const token = resolveAuthToken(req);
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.type === "refresh") return null;
    return decoded?.userId ?? decoded?.id ?? decoded?.sub ?? null;
  } catch {
    return null;
  }
}

export async function recordChildSafetyIncident({ req, routePath, classifierCode }) {
  const userId = req?.user?.userId || resolveUserIdFromToken(req) || null;
  const fallbackEmail = req?.user?.email ? String(req.user.email).trim() : null;
  const ipAddress = resolveClientIp(req);

  let usernameSnapshot = null;
  let emailSnapshot = fallbackEmail;
  let region = null;

  if (userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, region: true },
      });
      if (user) {
        usernameSnapshot = user.name || null;
        emailSnapshot = user.email || emailSnapshot;
        region = user.region || null;
      }
    } catch {
      // Keep fallback snapshots if lookup fails.
    }
  }

  if (!region && ipAddress) {
    region = await getRegionFromIp(ipAddress);
  }

  await prisma.childSafetyIncident.create({
    data: {
      userIdSnapshot: userId,
      usernameSnapshot,
      emailSnapshot,
      ipAddress,
      region,
      routePath: routePath || null,
      generationMode: deriveGenerationMode(routePath),
      classifierCode: classifierCode || "safety_child_sexual_content",
      promptPreview: sanitizePromptPreview(req?.body),
    },
  });
}
