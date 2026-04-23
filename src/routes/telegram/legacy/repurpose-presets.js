/**
 * Safe / Aggressive filter packs — aligned with client VideoRepurposerPage presets.
 * Used by Telegram bot only; worker applies randomizeValues from these ranges.
 */

export const REPURPOSE_FILTERS_SAFE = {
  encoder_fingerprint: { enabled: true },
  keyframe_interval: { enabled: true, min: 60, max: 120 },
  video_bitrate: { enabled: true, min: 4500, max: 6500 },
  audio_bitrate: { enabled: true, min: 160, max: 256 },
  colorlevels: { enabled: true },
  hue: { enabled: true, min: -1.5, max: 1.5 },
  saturation: { enabled: true, min: 0.978, max: 1.022 },
  contrast: { enabled: true, min: 0.982, max: 1.018 },
  brightness: { enabled: true, min: -0.008, max: 0.008 },
  gamma: { enabled: true, min: 0.978, max: 1.022 },
  color_temp: { enabled: true, min: -0.018, max: 0.018 },
  zoom: { enabled: true, min: 1.004, max: 1.012 },
  pitch_shift: { enabled: true, min: 0.997, max: 1.003 },
  audio_highpass: { enabled: true, min: 70, max: 80 },
  audio_lowpass: { enabled: true, min: 18500, max: 20000 },
  audio_noise: { enabled: true, min: 0.0001, max: 0.0004 },
  volume: { enabled: true, min: 0.985, max: 1.015 },
  deband: { enabled: true },
  denoise: { enabled: true, min: 2.0, max: 4.0 },
  sharpen: { enabled: true, min: 0.4, max: 0.7 },
  speed: { enabled: true, min: 0.996, max: 1.004 },
  cut_video: { enabled: true, min: 0.05, max: 0.15 },
  cut_end_video: { enabled: true, min: 0.03, max: 0.1 },
  framerate: { enabled: false, min: 28, max: 32 },
  deflicker: { enabled: true },
  flip: { enabled: false },
  vflip: { enabled: false },
  noise: { enabled: false, min: 1, max: 3 },
  vignette: { enabled: false, min: 0, max: 0.2 },
  rotation: { enabled: false, min: -1, max: 1 },
  pixel_shift: { enabled: false, min: -2, max: 2 },
  lens_correction: { enabled: false, min: -0.1, max: 0.1 },
  blurred_border: { enabled: false },
  random_pixel_size: { enabled: false, min: 1, max: 1 },
  dimensions: { enabled: false, min_w: 1080, max_w: 1080, min_h: 1920, max_h: 1920 },
};

export const REPURPOSE_FILTERS_AGGRESSIVE = {
  encoder_fingerprint: { enabled: true },
  keyframe_interval: { enabled: true, min: 40, max: 100 },
  video_bitrate: { enabled: true, min: 3500, max: 7500 },
  audio_bitrate: { enabled: true, min: 128, max: 320 },
  colorlevels: { enabled: true },
  hue: { enabled: true, min: -3.0, max: 3.0 },
  saturation: { enabled: true, min: 0.955, max: 1.045 },
  contrast: { enabled: true, min: 0.96, max: 1.04 },
  brightness: { enabled: true, min: -0.015, max: 0.015 },
  gamma: { enabled: true, min: 0.955, max: 1.045 },
  color_temp: { enabled: true, min: -0.04, max: 0.04 },
  zoom: { enabled: true, min: 1.01, max: 1.02 },
  pitch_shift: { enabled: true, min: 0.994, max: 1.006 },
  audio_highpass: { enabled: true, min: 65, max: 90 },
  audio_lowpass: { enabled: true, min: 16000, max: 19000 },
  audio_noise: { enabled: true, min: 0.0002, max: 0.001 },
  volume: { enabled: true, min: 0.975, max: 1.025 },
  speed: { enabled: true, min: 0.992, max: 1.008 },
  cut_video: { enabled: true, min: 0.15, max: 0.35 },
  cut_end_video: { enabled: true, min: 0.1, max: 0.2 },
  framerate: { enabled: false, min: 28, max: 32 },
  deflicker: { enabled: true },
  deband: { enabled: true },
  denoise: { enabled: true, min: 3.5, max: 6.0 },
  sharpen: { enabled: true, min: 0.7, max: 1.2 },
  flip: { enabled: false },
  vflip: { enabled: false },
  noise: { enabled: false, min: 1, max: 5 },
  vignette: { enabled: false, min: 0, max: 0.2 },
  rotation: { enabled: false, min: -1, max: 1 },
  pixel_shift: { enabled: false, min: -2, max: 2 },
  lens_correction: { enabled: false, min: -0.1, max: 0.1 },
  blurred_border: { enabled: false },
  random_pixel_size: { enabled: false, min: 1, max: 1 },
  dimensions: { enabled: false, min_w: 1080, max_w: 1080, min_h: 1920, max_h: 1920 },
};

export function buildTelegramRepurposeMetadata() {
  const selected = new Date().toISOString().slice(0, 16);
  return {
    device_metadata: {
      enabled: true,
      platform: "multi",
      modelKey: "",
      uniqueDevicePerCopy: false,
      deviceMode: "single",
      modelKeys: ["", "", "", "", ""],
    },
    timestamps: { enabled: true, date_taken: selected },
    gps_location: { enabled: true, mode: "pinpoint", country: "US", lat: 39.8, lng: -98.5 },
    recording_app: { enabled: true },
    audio_device: { enabled: true },
    color_profile: { enabled: true },
  };
}

/** @param {"safe"|"aggressive"} preset */
export function buildTelegramRepurposeSettings(preset) {
  const filters = preset === "aggressive" ? REPURPOSE_FILTERS_AGGRESSIVE : REPURPOSE_FILTERS_SAFE;
  return {
    copies: 1,
    filters,
    metadata: buildTelegramRepurposeMetadata(),
    useAiOptimization: false,
  };
}
