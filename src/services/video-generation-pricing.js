function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function getRecreateCreditsPerSecond(
  pricing,
  { engine = "kling", ultra = false } = {},
) {
  void engine;

  if (ultra) {
    return asNumber(pricing?.videoRecreateUltraPerSec, 25);
  }
  return asNumber(pricing?.videoRecreateMotionProPerSec, 18);
}

export function estimateRecreateCredits(
  pricing,
  { durationSeconds, engine = "kling", ultra = false } = {},
) {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const perSec = getRecreateCreditsPerSecond(pricing, {
    engine,
    ultra,
  });
  return Math.ceil(seconds * perSec);
}
