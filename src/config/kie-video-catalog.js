export const RECREATE_ENGINE = Object.freeze({
  KLING: "kling",
  WAN: "wan",
});

export const WAN_RECREATE_RESOLUTIONS = Object.freeze(["480p", "580p", "720p"]);

export const KIE_VIDEO_MODEL_CATALOG = Object.freeze({
  recreate: {
    kling26MotionControl: {
      provider: "kie",
      model: "kling-2.6/motion-control",
      endpoint: "/api/v1/jobs/createTask",
    },
    kling30MotionControl: {
      provider: "kie",
      model: "kling-3.0/motion-control",
      endpoint: "/api/v1/jobs/createTask",
    },
    wan22AnimateMove: {
      provider: "kie",
      model: "wan/2-2-animate-move",
      endpoint: "/api/v1/jobs/createTask",
      inputSchema: {
        required: ["video_url", "image_url"],
        resolutionEnum: WAN_RECREATE_RESOLUTIONS,
      },
    },
    wan22AnimateReplace: {
      provider: "kie",
      model: "wan/2-2-animate-replace",
      endpoint: "/api/v1/jobs/createTask",
      inputSchema: {
        required: ["video_url", "image_url"],
        resolutionEnum: WAN_RECREATE_RESOLUTIONS,
      },
    },
  },
  veo31: {
    generate: { endpoint: "/api/v1/veo/generate", models: ["veo3_fast", "veo3"] },
    extend: { endpoint: "/api/v1/veo/extend", models: ["fast", "quality"] },
  },
  sora2Pro: {
    family: "sora2",
    modes: ["i2v", "t2v"],
    imageToVideoModel: "sora-2-pro-image-to-video",
    textToVideoModel: "sora-2-pro-text-to-video",
    storyboardModel: "sora-2-pro-storyboard",
  },
  klingVideo: {
    family: "kling",
    modes: ["i2v", "t2v"],
    kling30VideoModel: "kling-3.0/video",
    kling26ImageToVideoModel: "kling-2.6/image-to-video",
    kling26TextToVideoModel: "kling-2.6/text-to-video",
  },
  piapi: {
    baseUrl: "https://api.piapi.ai/api/v1",
    callbackRequired: true,
    seedanceModels: [
      "seedance-2-preview",
      "seedance-2-fast-preview",
    ],
  },
});

export function isCreatorStudioVideoExtendEligible(family, mode) {
  const fam = String(family || "").toLowerCase();
  const m = String(mode || "").toLowerCase();
  return fam === "veo31" && m !== "extend";
}

export function normalizeRecreateEngine(value) {
  return String(value || "").toLowerCase() === RECREATE_ENGINE.WAN
    ? RECREATE_ENGINE.WAN
    : RECREATE_ENGINE.KLING;
}

export function normalizeWanResolution(value) {
  const normalized = String(value || "").toLowerCase();
  const match = WAN_RECREATE_RESOLUTIONS.find(
    (resolution) => resolution.toLowerCase() === normalized,
  );
  return match || "580p";
}

export function getRecreateReplicateModel({ engine, ultra = false, wanResolution = "580p" }) {
  const normalizedEngine = normalizeRecreateEngine(engine);
  if (normalizedEngine === RECREATE_ENGINE.WAN) {
    return `kie-wan-2-2-animate-move-${normalizeWanResolution(wanResolution)}`;
  }
  return ultra ? "kie-kling-3.0-motion-control" : "kie-kling-2.6-motion-control";
}
