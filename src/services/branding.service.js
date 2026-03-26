import prisma from "../lib/prisma.js";
import { BRAND } from "../utils/brand.js";

const BRANDING_ID = "global";

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

const DEFAULT_TUTORIAL_VIDEO_URL = "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/static/dashboard_video.mp4";
const DEFAULT_LANDER_DEMO_VIDEO_URL =
  "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/AI_model_main_video.mp4";

export async function getAppBranding() {
  // Try with video URL columns; fall back if a column hasn't been migrated yet (P2022)
  try {
    const record = await prisma.appBranding.findUnique({
      where: { id: BRANDING_ID },
      select: {
        appName: true,
        logoUrl: true,
        faviconUrl: true,
        baseUrl: true,
        tutorialVideoUrl: true,
        landerDemoVideoUrl: true,
      },
    });
    return {
      appName: record?.appName || BRAND.name,
      logoUrl: record?.logoUrl || null,
      faviconUrl: record?.faviconUrl || record?.logoUrl || null,
      baseUrl: record?.baseUrl || BRAND.defaultBaseUrl,
      tutorialVideoUrl: record?.tutorialVideoUrl || DEFAULT_TUTORIAL_VIDEO_URL,
      landerDemoVideoUrl: record?.landerDemoVideoUrl || DEFAULT_LANDER_DEMO_VIDEO_URL,
    };
  } catch (err) {
    if (err?.code === "P2022") {
      console.warn(
        "[branding] Branding column missing in DB. Run pending Prisma migrations for AppBranding (tutorialVideoUrl / landerDemoVideoUrl).",
      );
      const record = await prisma.appBranding.findUnique({
        where: { id: BRANDING_ID },
        select: { appName: true, logoUrl: true, faviconUrl: true, baseUrl: true },
      });
      return {
        appName: record?.appName || BRAND.name,
        logoUrl: record?.logoUrl || null,
        faviconUrl: record?.faviconUrl || record?.logoUrl || null,
        baseUrl: record?.baseUrl || BRAND.defaultBaseUrl,
        tutorialVideoUrl: DEFAULT_TUTORIAL_VIDEO_URL,
        landerDemoVideoUrl: DEFAULT_LANDER_DEMO_VIDEO_URL,
      };
    }
    throw err;
  }
}

export async function updateAppBranding(input = {}) {
  const appName = String(input.appName || "").trim();
  if (!appName) {
    throw new Error("App name is required");
  }

  const logoUrl = normalizeUrl(input.logoUrl);
  const faviconUrl = normalizeUrl(input.faviconUrl);
  const baseUrl = normalizeUrl(input.baseUrl);
  const tutorialVideoUrl = normalizeUrl(input.tutorialVideoUrl);
  const landerDemoVideoUrl = normalizeUrl(input.landerDemoVideoUrl);

  try {
    const updated = await prisma.appBranding.upsert({
      where: { id: BRANDING_ID },
      create: { id: BRANDING_ID, appName, logoUrl, faviconUrl, baseUrl, tutorialVideoUrl, landerDemoVideoUrl },
      update: { appName, logoUrl, faviconUrl, baseUrl, tutorialVideoUrl, landerDemoVideoUrl },
      select: {
        appName: true,
        logoUrl: true,
        faviconUrl: true,
        baseUrl: true,
        tutorialVideoUrl: true,
        landerDemoVideoUrl: true,
      },
    });
    return {
      appName: updated.appName,
      logoUrl: updated.logoUrl || null,
      faviconUrl: updated.faviconUrl || updated.logoUrl || null,
      baseUrl: updated.baseUrl || BRAND.defaultBaseUrl,
      tutorialVideoUrl: updated.tutorialVideoUrl || DEFAULT_TUTORIAL_VIDEO_URL,
      landerDemoVideoUrl: updated.landerDemoVideoUrl || DEFAULT_LANDER_DEMO_VIDEO_URL,
    };
  } catch (err) {
    if (err?.code === "P2022") {
      console.warn("[branding] Video URL column missing, saving without it.");
      const updated = await prisma.appBranding.upsert({
        where: { id: BRANDING_ID },
        create: { id: BRANDING_ID, appName, logoUrl, faviconUrl, baseUrl },
        update: { appName, logoUrl, faviconUrl, baseUrl },
        select: { appName: true, logoUrl: true, faviconUrl: true, baseUrl: true },
      });
      return {
        appName: updated.appName,
        logoUrl: updated.logoUrl || null,
        faviconUrl: updated.faviconUrl || updated.logoUrl || null,
        baseUrl: updated.baseUrl || BRAND.defaultBaseUrl,
        tutorialVideoUrl: DEFAULT_TUTORIAL_VIDEO_URL,
        landerDemoVideoUrl: DEFAULT_LANDER_DEMO_VIDEO_URL,
      };
    }
    throw err;
  }
}

export async function clearTutorialVideo() {
  try {
    await prisma.appBranding.upsert({
      where: { id: BRANDING_ID },
      create: { id: BRANDING_ID, appName: BRAND.name, tutorialVideoUrl: null },
      update: { tutorialVideoUrl: null },
    });
  } catch (err) {
    if (err?.code === "P2022") {
      console.warn("[branding] tutorialVideoUrl column missing — skipping clearTutorialVideo.");
      return;
    }
    throw err;
  }
}

export async function clearLanderDemoVideo() {
  try {
    await prisma.appBranding.upsert({
      where: { id: BRANDING_ID },
      create: { id: BRANDING_ID, appName: BRAND.name, landerDemoVideoUrl: null },
      update: { landerDemoVideoUrl: null },
    });
  } catch (err) {
    if (err?.code === "P2022") {
      console.warn("[branding] landerDemoVideoUrl column missing — skipping clearLanderDemoVideo.");
      return;
    }
    throw err;
  }
}
