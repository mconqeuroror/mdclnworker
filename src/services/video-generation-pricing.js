import {
  RECREATE_ENGINE,
  normalizeRecreateEngine,
  normalizeWanResolution,
} from "../config/kie-video-catalog.js";

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function getRecreateCreditsPerSecond(
  pricing,
  { engine = RECREATE_ENGINE.KLING, ultra = false, wanResolution = "580p" } = {},
) {
  const normalizedEngine = normalizeRecreateEngine(engine);
  if (normalizedEngine === RECREATE_ENGINE.WAN) {
    const normalizedResolution = normalizeWanResolution(wanResolution);
    if (normalizedResolution === "720p") {
      return asNumber(pricing?.wan22AnimateMove720pPerSec, 12.5);
    }
    if (normalizedResolution === "480p") {
      return asNumber(pricing?.wan22AnimateMove480pPerSec, 6);
    }
    return asNumber(pricing?.wan22AnimateMove580pPerSec, 9.5);
  }

  if (ultra) {
    return asNumber(pricing?.videoRecreateUltraPerSec, 25);
  }
  return asNumber(pricing?.videoRecreateMotionProPerSec, 18);
}

export function estimateRecreateCredits(
  pricing,
  { durationSeconds, engine = RECREATE_ENGINE.KLING, ultra = false, wanResolution = "580p" } = {},
) {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const perSec = getRecreateCreditsPerSecond(pricing, {
    engine,
    ultra,
    wanResolution,
  });
  return Math.ceil(seconds * perSec);
}
