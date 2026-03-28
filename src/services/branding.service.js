import prisma from "../lib/prisma.js";
import { BRAND } from "../utils/brand.js";

const BRANDING_ID = "global";

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

/** null clears stored markdown; undefined = omit from PATCH (caller must merge for partial updates). */
function normalizeMarkdownField(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value);
  if (!s.trim()) return null;
  return s;
}

const DEFAULT_TUTORIAL_VIDEO_URL = "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/static/dashboard_video.mp4";
const DEFAULT_LANDER_DEMO_VIDEO_URL =
  "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/AI_model_main_video.mp4";

function mapBrandingRecord(record) {
  return {
    appName: record?.appName || BRAND.name,
    logoUrl: record?.logoUrl || null,
    faviconUrl: record?.faviconUrl || record?.logoUrl || null,
    baseUrl: record?.baseUrl || BRAND.defaultBaseUrl,
    tutorialVideoUrl: record?.tutorialVideoUrl || DEFAULT_TUTORIAL_VIDEO_URL,
    landerDemoVideoUrl: record?.landerDemoVideoUrl || DEFAULT_LANDER_DEMO_VIDEO_URL,
    termsMarkdown: record?.termsMarkdown ?? null,
    privacyMarkdown: record?.privacyMarkdown ?? null,
    cookiesMarkdown: record?.cookiesMarkdown ?? null,
  };
}

export async function getAppBranding() {
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
        termsMarkdown: true,
        privacyMarkdown: true,
        cookiesMarkdown: true,
      },
    });
    return mapBrandingRecord(record);
  } catch (err) {
    if (err?.code === "P2022") {
      console.warn(
        "[branding] Branding column missing in DB. Run pending Prisma migrations for AppBranding.",
      );
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
          ...mapBrandingRecord(record),
          termsMarkdown: null,
          privacyMarkdown: null,
          cookiesMarkdown: null,
        };
      } catch (err2) {
        if (err2?.code === "P2022") {
          const record = await prisma.appBranding.findUnique({
            where: { id: BRANDING_ID },
            select: { appName: true, logoUrl: true, faviconUrl: true, baseUrl: true },
          });
          return {
            ...mapBrandingRecord(record),
            tutorialVideoUrl: DEFAULT_TUTORIAL_VIDEO_URL,
            landerDemoVideoUrl: DEFAULT_LANDER_DEMO_VIDEO_URL,
            termsMarkdown: null,
            privacyMarkdown: null,
            cookiesMarkdown: null,
          };
        }
        throw err2;
      }
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

  const termsMarkdown = normalizeMarkdownField(input.termsMarkdown);
  const privacyMarkdown = normalizeMarkdownField(input.privacyMarkdown);
  const cookiesMarkdown = normalizeMarkdownField(input.cookiesMarkdown);

  const dataCreate = {
    id: BRANDING_ID,
    appName,
    logoUrl,
    faviconUrl,
    baseUrl,
    tutorialVideoUrl,
    landerDemoVideoUrl,
  };
  const dataUpdate = {
    appName,
    logoUrl,
    faviconUrl,
    baseUrl,
    tutorialVideoUrl,
    landerDemoVideoUrl,
  };
  if (termsMarkdown !== undefined) {
    dataCreate.termsMarkdown = termsMarkdown;
    dataUpdate.termsMarkdown = termsMarkdown;
  }
  if (privacyMarkdown !== undefined) {
    dataCreate.privacyMarkdown = privacyMarkdown;
    dataUpdate.privacyMarkdown = privacyMarkdown;
  }
  if (cookiesMarkdown !== undefined) {
    dataCreate.cookiesMarkdown = cookiesMarkdown;
    dataUpdate.cookiesMarkdown = cookiesMarkdown;
  }

  const selectFull = {
    appName: true,
    logoUrl: true,
    faviconUrl: true,
    baseUrl: true,
    tutorialVideoUrl: true,
    landerDemoVideoUrl: true,
    termsMarkdown: true,
    privacyMarkdown: true,
    cookiesMarkdown: true,
  };

  try {
    const updated = await prisma.appBranding.upsert({
      where: { id: BRANDING_ID },
      create: dataCreate,
      update: dataUpdate,
      select: selectFull,
    });
    return mapBrandingRecord(updated);
  } catch (err) {
    if (err?.code === "P2022") {
      console.warn("[branding] Some branding columns missing, saving reduced field set.");
      const { termsMarkdown: _t, privacyMarkdown: _p, cookiesMarkdown: _c, ...createReduced } = dataCreate;
      const { termsMarkdown: __t, privacyMarkdown: __p, cookiesMarkdown: __c, ...updateReduced } = dataUpdate;
      const updated = await prisma.appBranding.upsert({
        where: { id: BRANDING_ID },
        create: createReduced,
        update: updateReduced,
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
        ...mapBrandingRecord(updated),
        termsMarkdown: null,
        privacyMarkdown: null,
        cookiesMarkdown: null,
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
