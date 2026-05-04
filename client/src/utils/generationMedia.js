/**
 * Shared helpers for generation outputUrl / resultUrl across dashboard, history, etc.
 * Motion X / Kling and some providers store JSON objects `{ url, poster }` instead of a bare URL.
 */

export const VIDEO_OUTPUT_TYPES = [
  "video",
  "prompt-video",
  "face-swap",
  "faceswap",
  "recreate-video",
  "talking-head",
  "nsfw-video",
  "nsfw-video-extend",
  "nsfw-video-motion",
  "creator-studio-video",
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isVideoMediaUrl(url) {
  const lower = (url || "").toLowerCase();
  return (
    lower.includes(".mp4") ||
    lower.includes(".webm") ||
    lower.includes(".m4v") ||
    lower.includes(".mov") ||
    lower.includes("video/mp4") ||
    lower.includes("/video/")
  );
}

/**
 * @param {unknown} outputUrl — string URL, JSON array, or JSON object (Motion X / Kling)
 * @returns {{ primaryUrl: string, posterUrl?: string, urls: string[] }}
 */
export function parseGenerationOutput(outputUrl) {
  if (outputUrl == null || outputUrl === "") {
    return { primaryUrl: "", posterUrl: undefined, urls: [] };
  }
  if (Array.isArray(outputUrl)) {
    const urls = outputUrl.filter((u) => typeof u === "string" && u.trim().startsWith("http"));
    return {
      primaryUrl: urls[0] || "",
      posterUrl: undefined,
      urls,
    };
  }
  if (typeof outputUrl !== "string") {
    return { primaryUrl: "", posterUrl: undefined, urls: [] };
  }

  const trimmed = outputUrl.trim();
  if (!trimmed) return { primaryUrl: "", posterUrl: undefined, urls: [] };

  if (trimmed.startsWith("http")) {
    return { primaryUrl: trimmed, posterUrl: undefined, urls: [trimmed] };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const urls = parsed.filter((u) => typeof u === "string" && u.trim().startsWith("http"));
      return {
        primaryUrl: urls[0] || "",
        posterUrl: undefined,
        urls,
      };
    }
    if (parsed && typeof parsed === "object") {
      const videoCand = [
        parsed.url,
        parsed.videoUrl,
        parsed.outputUrl,
        parsed.video,
        parsed.src,
      ].filter((u) => typeof u === "string" && u.trim().startsWith("http"));
      const imageCand = [
        parsed.image,
        parsed.imageUrl,
        parsed.resultUrl,
        parsed.publicUrl,
        parsed.fileUrl,
      ].filter((u) => typeof u === "string" && u.trim().startsWith("http"));
      const posterCand = [
        parsed.poster,
        parsed.posterUrl,
        parsed.thumbnailUrl,
        parsed.thumbnail,
        parsed.coverUrl,
        parsed.previewUrl,
        parsed.imageUrl,
      ].filter((u) => typeof u === "string" && u.trim().startsWith("http"));

      const primaryUrl = videoCand[0] || imageCand[0] || "";
      const posterUrl = posterCand[0];
      const urls = primaryUrl ? [primaryUrl] : [];
      return { primaryUrl, posterUrl, urls };
    }
  } catch {
    /* not JSON */
  }

  return {
    primaryUrl: trimmed.startsWith("http") ? trimmed : "",
    posterUrl: undefined,
    urls: trimmed.startsWith("http") ? [trimmed] : [],
  };
}

/**
 * Poster for <video> — provider metadata + structured inputImageUrl (Motion X JSON).
 *
 * @param {object} generation
 * @param {string} [posterFromOutput] — from parseGenerationOutput(...).posterUrl
 * @returns {string | undefined}
 */
export function resolveGenerationPoster(generation, posterFromOutput) {
  if (typeof posterFromOutput === "string" && posterFromOutput.startsWith("http")) {
    return posterFromOutput;
  }

  let pr = generation?.providerResponse;
  if (typeof pr === "string" && pr.trim().startsWith("{")) {
    try {
      pr = JSON.parse(pr);
    } catch {
      pr = null;
    }
  }
  if (pr && typeof pr === "object") {
    const fromProvider = pr.thumbnailUrl || pr.thumbnail || pr.poster || pr.posterUrl;
    if (typeof fromProvider === "string" && fromProvider.startsWith("http")) {
      return fromProvider;
    }
  }

  const raw = generation?.inputImageUrl;
  if (!raw || typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t.startsWith("http")) return t;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t);
      const candidates = [
        j.referenceImageUrl,
        j.figure2IdentityImage,
        j.imageUrl,
        j.faceImageUrl,
        Array.isArray(j.identityImages) ? j.identityImages[0] : null,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.startsWith("http")) return c;
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}
