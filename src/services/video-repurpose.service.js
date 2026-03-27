import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { getFfmpegPathSync, getFfprobePathSync } from "../utils/ffmpeg-path.js";
import {
  getUnifiedDeviceProfileById,
  getRandomUnifiedDeviceProfile,
  getAllDeviceModelIds,
} from "../repurposer/data/device-profiles.js";
import { writeMetadata } from "../repurposer/services/metadataWriter.js";
import { scrubEncoderSignaturesInFile } from "../repurposer/services/encoderScrubber.js";
import { runFfmpegWasm } from "../repurposer/ffmpeg-wasm-server.js";

const execFileAsync = promisify(execFile);

// Repurposing runs in browser via ffmpeg.wasm; server-side FFmpeg only when FFMPEG_PATH/bin exists (e.g. self-hosted).
export const FFMPEG_BIN = getFfmpegPathSync();
export const FFPROBE_BIN = getFfprobePathSync(FFMPEG_BIN);

const FFMPEG_CHECK_TIMEOUT_MS = 8000;

/**
 * Verifies that FFmpeg and FFprobe are available on the server (used before running repurpose jobs).
 * Repurposer runs entirely on the server; ensure FFmpeg is installed (e.g. apt install ffmpeg) or set
 * FFMPEG_PATH and FFPROBE_PATH to the full paths to the binaries.
 * @returns {Promise<void>} Resolves if both binaries run; rejects with a user-facing error message.
 */
export async function checkFfmpegAvailable() {
  try {
    await Promise.all([
      execFileAsync(FFMPEG_BIN, ["-version"], { timeout: FFMPEG_CHECK_TIMEOUT_MS }),
      execFileAsync(FFPROBE_BIN, ["-version"], { timeout: FFMPEG_CHECK_TIMEOUT_MS }),
    ]);
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes("ENOENT") || msg.includes("spawn") || msg.includes("not found")) {
      throw new Error(
        "FFmpeg is not installed or not found on the server. " +
        "Install FFmpeg (e.g. apt install ffmpeg on Linux, or download from https://ffmpeg.org) and ensure the server has ffmpeg and ffprobe in PATH, or set environment variables FFMPEG_PATH and FFPROBE_PATH to the full paths to the binaries."
      );
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      throw new Error(
        "FFmpeg/ffprobe did not respond in time. Check that the binaries at FFMPEG_PATH and FFPROBE_PATH are valid and not stuck."
      );
    }
    throw new Error(`FFmpeg check failed: ${msg}`);
  }
}

const COUNTRY_BOXES = {
  US: { lat: [25.0, 48.0], lon: [-124.0, -67.0], altRange: [0, 2500] },
  UK: { lat: [50.0, 58.5], lon: [-8.5, 1.8], altRange: [0, 300] },
  Canada: { lat: [42.0, 69.0], lon: [-141.0, -52.0], altRange: [0, 1500] },
  Australia: { lat: [-43.5, -10.0], lon: [113.0, 153.6], altRange: [0, 800] },
};

const US_CITIES = [
  { name: "New York", lat: 40.7128, lon: -74.006, alt: 10 },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437, alt: 71 },
  { name: "Chicago", lat: 41.8781, lon: -87.6298, alt: 181 },
  { name: "Miami", lat: 25.7617, lon: -80.1918, alt: 2 },
  { name: "Houston", lat: 29.7604, lon: -95.3698, alt: 15 },
  { name: "Phoenix", lat: 33.4484, lon: -112.074, alt: 331 },
  { name: "Denver", lat: 39.7392, lon: -104.9903, alt: 1609 },
  { name: "Seattle", lat: 47.6062, lon: -122.3321, alt: 54 },
  { name: "San Francisco", lat: 37.7749, lon: -122.4194, alt: 16 },
  { name: "Atlanta", lat: 33.749, lon: -84.388, alt: 320 },
  { name: "Dallas", lat: 32.7767, lon: -96.797, alt: 131 },
  { name: "Las Vegas", lat: 36.1699, lon: -115.1398, alt: 610 },
  { name: "Nashville", lat: 36.1627, lon: -86.7816, alt: 182 },
  { name: "Austin", lat: 30.2672, lon: -97.7431, alt: 149 },
  { name: "Portland", lat: 45.5152, lon: -122.6784, alt: 15 },
];

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function chooseProfile(deviceMetadata = {}) {
  const modelKey = deviceMetadata?.modelKey;
  if (modelKey) {
    const exact = getUnifiedDeviceProfileById(modelKey);
    if (exact) return exact;
  }
  return getRandomUnifiedDeviceProfile();
}

function randomGps(country) {
  if (country === "US") {
    const city = US_CITIES[randInt(0, US_CITIES.length - 1)];
    return { lat: city.lat + rand(-0.05, 0.05), lon: city.lon + rand(-0.05, 0.05), alt: city.alt + rand(-5, 5) };
  }
  const box = COUNTRY_BOXES[country] || COUNTRY_BOXES.US;
  return {
    lat: rand(box.lat[0], box.lat[1]),
    lon: rand(box.lon[0], box.lon[1]),
    alt: rand(box.altRange[0], box.altRange[1]),
  };
}

function randomTimestamp(startDate, endDate) {
  const now = Date.now();
  const start = startDate ? new Date(startDate).getTime() : now - 365 * 2 * 86400000;
  const end = endDate ? new Date(endDate).getTime() : now;
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  return new Date(s + Math.random() * (e - s));
}

function parseTimestampInput(value) {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function ensureBatchDeviceModelKey(metadataSettings = {}) {
  const next = cloneJsonSafe(metadataSettings);
  const device = { ...(next.device_metadata || {}) };
  const deviceMode = device.deviceMode || (device.uniqueDevicePerCopy ? "random_unique" : "single");
  if (device.enabled !== false && !device.modelKey && deviceMode === "single") {
    const profile = getRandomUnifiedDeviceProfile();
    if (profile?.id) device.modelKey = profile.id;
  }
  next.device_metadata = device;
  return next;
}

function pickDeviceModelKeysForCopies(baseMetadataSettings = {}, copies = 1) {
  const total = Math.min(5, Math.max(1, parseInt(copies, 10) || 1));
  const device = baseMetadataSettings?.device_metadata || {};
  const enabled = device?.enabled !== false;
  const deviceMode =
    device?.deviceMode || (device?.uniqueDevicePerCopy ? "random_unique" : "single");
  const fixedModelKey = device?.modelKey || null;
  const modelKeys = Array.isArray(device?.modelKeys) ? device.modelKeys : [];
  const allIds = getAllDeviceModelIds().filter(Boolean);

  if (!enabled) {
    return Array.from({ length: total }, () => null);
  }

  const resolveKey = (k) => {
    if (k && allIds.includes(k)) return k;
    return null;
  };

  if (deviceMode === "per_copy") {
    const fallback = resolveKey(fixedModelKey) || getRandomUnifiedDeviceProfile()?.id || null;
    return Array.from({ length: total }, (_, i) => {
      const k = resolveKey(modelKeys[i]) || resolveKey(modelKeys[0]) || fallback;
      return k;
    });
  }

  if (deviceMode === "random_unique") {
    const pool = [...allIds].sort(() => Math.random() - 0.5);
    const chosen = [];
    if (fixedModelKey && allIds.includes(fixedModelKey)) chosen.push(fixedModelKey);
    for (const id of pool) {
      if (chosen.length >= total) break;
      if (!chosen.includes(id)) chosen.push(id);
    }
    while (chosen.length < total) {
      chosen.push(getRandomUnifiedDeviceProfile()?.id || fixedModelKey || null);
    }
    return chosen;
  }

  const modelKey = resolveKey(fixedModelKey) || getRandomUnifiedDeviceProfile()?.id || null;
  return Array.from({ length: total }, () => modelKey);
}

function buildMetadataSettingsForCopy(baseMetadataSettings = {}, copyIndex = 0, forcedModelKey = null) {
  const copy = cloneJsonSafe(baseMetadataSettings);
  const uniqueOffsetSeconds = 11 + copyIndex * 37 + randInt(0, 12);
  copy._repurposeUniqueOffsetSeconds = uniqueOffsetSeconds;
  if (forcedModelKey && copy?.device_metadata?.enabled !== false) {
    copy.device_metadata = {
      ...(copy.device_metadata || {}),
      modelKey: forcedModelKey,
    };
  }

  if (copy.timestamps?.enabled) {
    const original =
      parseTimestampInput(copy.timestamps?.date_taken)
      || parseTimestampInput(copy.timestamps?.start_date)
      || parseTimestampInput(copy.timestamps?.end_date)
      || new Date();
    // Ensure each output has unique capture time even when user set one fixed timestamp.
    const shifted = new Date(original.getTime() + uniqueOffsetSeconds * 1000);
    copy.timestamps.date_taken = shifted.toISOString();
  }

  if (
    copy.gps_location?.enabled &&
    copy.gps_location?.mode === "pinpoint" &&
    Number.isFinite(Number(copy.gps_location?.lat)) &&
    Number.isFinite(Number(copy.gps_location?.lng))
  ) {
    // Keep user-selected location neighborhood while ensuring metadata differs per output.
    const latBase = Number(copy.gps_location.lat);
    const lngBase = Number(copy.gps_location.lng);
    const latOffset = (copyIndex + 1) * 0.00008 + rand(-0.00003, 0.00003);
    const lngOffset = (copyIndex + 1) * 0.00008 + rand(-0.00003, 0.00003);
    copy.gps_location.lat = clamp(latBase + latOffset, -90, 90);
    copy.gps_location.lng = clamp(lngBase + lngOffset, -180, 180);
  }

  return copy;
}

export async function probeInput(filePath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v", "error",
      "-show_entries", "format=duration:stream=index,codec_type,width,height,r_frame_rate",
      "-of", "json",
      filePath,
    ]);
    const data = JSON.parse(stdout || "{}");
    const streams = data.streams || [];
    const video = streams.find((s) => s.codec_type === "video") || {};
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    let fps = 30;
    if (video.r_frame_rate && typeof video.r_frame_rate === "string" && video.r_frame_rate.includes("/")) {
      const [n, d] = video.r_frame_rate.split("/").map((x) => parseFloat(x));
      if (Number.isFinite(n) && Number.isFinite(d) && d > 0) fps = n / d;
    }
    return {
      duration: parseFloat(data.format?.duration) || 0,
      width: parseInt(video.width) || 1920,
      height: parseInt(video.height) || 1080,
      hasAudio,
      fps,
    };
  } catch (e) {
    // On serverless (e.g. Vercel) ffprobe may not be in PATH (ENOENT); use fallback and avoid noisy logs.
    if (e?.code !== "ENOENT" && e?.message !== "spawn ffprobe ENOENT") {
      console.error("ffprobe failed:", e.message);
    }
    // Conservative fallback: treat audio as unavailable so ffmpeg filtergraph never references missing `0:a`.
    return { duration: 30, width: 1080, height: 1920, hasAudio: false, fps: 30 };
  }
}

function sampleRange(cfg, def) {
  if (!cfg || !cfg.enabled) return def;
  let lo = parseFloat(cfg.min ?? def);
  let hi = parseFloat(cfg.max ?? def);
  if (lo > hi) [lo, hi] = [hi, lo];
  return rand(lo, hi);
}

function isEnabled(filters, key) {
  const v = filters[key];
  if (!v) return false;
  if (typeof v === "object") return !!v.enabled;
  return !!v;
}

const VIDEO_ONLY_FILTER_KEYS = new Set([
  "speed",
  "framerate",
  "video_bitrate",
  "audio_bitrate",
  "cut_video",
  "cut_end_video",
  "volume",
  "pitch_shift",
  "audio_highpass",
  "audio_lowpass",
  "audio_noise",
  "keyframe_interval",
  "temporal_blend",
  "deflicker",
  "encoder_fingerprint",
]);

const EF_VIDEO_HANDLERS = ["VideoHandler", "VideoHandle", "GoPro AVC", "Apple Video", "Core Media Video", "OpenH264 Video"];
const EF_AUDIO_HANDLERS = ["SoundHandler", "AudioHandler", "Apple Sound", "Core Media Audio", "Stereo Audio"];
const EF_COMMENTS = ["", "Recorded on iPhone", "Shot on iPhone", "Recorded on iPhone 16 Pro", "iPhone 15 Pro Max"];
const EF_COLOR_PRIMARIES = ["bt709", "smpte170m", "bt470bg"];
const EF_COLOR_TRC = ["bt709", "gamma22", "smpte170m"];
const EF_COLOR_SPACE = ["bt709", "smpte170m"];
const EF_TIMESCALES = [12800, 90000, 600, 1000, 25600];

function stripVideoOnlyFilters(filtersCfg) {
  const stripped = { ...filtersCfg };
  for (const key of VIDEO_ONLY_FILTER_KEYS) {
    if (stripped[key]) {
      stripped[key] = { ...stripped[key], enabled: false };
    }
  }
  return stripped;
}

const ENCODER_STRINGS = [
  "Apple iPhone",
  "Apple iPhone 16 Pro",
  "Apple iPhone 15 Pro Max",
  "Apple iPhone 14 Pro",
];

function profileEncoderString(profile) {
  const make = String(profile?.make || "").trim();
  const model = String(profile?.model || "").trim();
  if (make && model) return `${make} ${model}`.slice(0, 120);
  if (!model) return ENCODER_STRINGS[0];
  if (model.toLowerCase().startsWith("iphone")) return `Apple ${model}`;
  return model.slice(0, 120);
}

function pickMetadataComment(profile) {
  const make = String(profile?.make || "").toLowerCase();
  const marketing = String(profile?.marketingName || "").trim();
  if (make === "apple" || (profile?.model || "").toLowerCase().includes("iphone")) {
    return EF_COMMENTS[randInt(0, EF_COMMENTS.length - 1)] || "Recorded on iPhone";
  }
  if (make === "samsung") {
    const pool = [`Recorded on ${marketing || "Galaxy"}`, "Shot on Samsung", "Samsung Camera"];
    return pool[randInt(0, pool.length - 1)];
  }
  if (make === "google") {
    const pool = [`Recorded on ${marketing || "Pixel"}`, "Google Camera", "Pixel Camera"];
    return pool[randInt(0, pool.length - 1)];
  }
  if (make === "dji") {
    const pool = ["DJI", `Shot on ${marketing || "DJI"}`, "Recorded with DJI"];
    return pool[randInt(0, pool.length - 1)];
  }
  const pool = [
    marketing ? `Recorded on ${marketing}` : "Mobile video",
    "Camera",
    make ? `${make} video` : "Video",
  ];
  return pool[randInt(0, pool.length - 1)];
}

function randomizeValues(filters, sourceInfo, profile = null) {
  const dimCfg = filters.dimensions || {};
  let width = sourceInfo.width;
  let height = sourceInfo.height;

  if (dimCfg.enabled) {
    let minW = Math.max(16, parseInt(dimCfg.min_w) || width);
    let maxW = Math.max(16, parseInt(dimCfg.max_w) || width);
    let minH = Math.max(16, parseInt(dimCfg.min_h) || height);
    let maxH = Math.max(16, parseInt(dimCfg.max_h) || height);
    if (minW > maxW) [minW, maxW] = [maxW, minW];
    if (minH > maxH) [minH, maxH] = [maxH, minH];
    width = randInt(minW, maxW);
    height = randInt(minH, maxH);
    width = width - (width % 2);
    height = height - (height % 2);
    width = Math.max(16, width);
    height = Math.max(16, height);
  }

  const cameraShakeEnabled = isEnabled(filters, "camera_shake");

  const efOn = isEnabled(filters, "encoder_fingerprint");
  const efProfile = efOn ? ["main", "high"][randInt(0, 1)] : "high";
  const efLevelMap = { main: ["3.1", "4.0", "4.1"], high: ["4.0", "4.1", "5.0"] };
  const efLevel = efOn ? efLevelMap[efProfile][randInt(0, efLevelMap[efProfile].length - 1)] : "4.1";

  return {
    framerate: sampleRange(filters.framerate, 30),
    video_bitrate: sampleRange(filters.video_bitrate, 5000),
    audio_bitrate: sampleRange(filters.audio_bitrate, 192),
    saturation: sampleRange(filters.saturation, 1),
    contrast: sampleRange(filters.contrast, 1),
    brightness: sampleRange(filters.brightness, 0),
    vignette: sampleRange(filters.vignette, 0),
    gamma: sampleRange(filters.gamma, 1),
    speed: sampleRange(filters.speed, 1),
    zoom: sampleRange(filters.zoom, 1),
    noise: sampleRange(filters.noise, 0),
    pixel_shift: sampleRange(filters.pixel_shift, 0),
    volume: sampleRange(filters.volume, 1),
    random_pixel_size: sampleRange(filters.random_pixel_size, 1),
    cut_video: sampleRange(filters.cut_video, 0),
    cut_end_video: sampleRange(filters.cut_end_video, 0),
    rotation: sampleRange(filters.rotation, 0),
    lens_correction: sampleRange(filters.lens_correction, 0),
    color_temp: sampleRange(filters.color_temp, 0),
    pitch_shift: sampleRange(filters.pitch_shift, 1.0),
    audio_highpass: sampleRange(filters.audio_highpass, 0),
    audio_lowpass: sampleRange(filters.audio_lowpass, 0),
    audio_noise: sampleRange(filters.audio_noise, 0),
    keyframe_interval: sampleRange(filters.keyframe_interval, 0),
    flip: isEnabled(filters, "flip"),
    vflip: isEnabled(filters, "vflip"),
    blurred_border: isEnabled(filters, "blurred_border"),
    dimensions_enabled: !!dimCfg.enabled,
    width,
    height,
    encoder_string: profileEncoderString(profile),
    camera_shake_amp: cameraShakeEnabled ? sampleRange(filters.camera_shake, 0) : 0,
    camera_shake_f1: cameraShakeEnabled ? rand(1.5, 3.0) : 0,
    camera_shake_f2: cameraShakeEnabled ? rand(5.0, 9.0) : 0,
    camera_shake_g1: cameraShakeEnabled ? rand(1.0, 2.5) : 0,
    camera_shake_g2: cameraShakeEnabled ? rand(4.0, 7.0) : 0,
    sensor_noise_amt: isEnabled(filters, "sensor_noise") ? sampleRange(filters.sensor_noise, 0) : 0,
    sensor_noise_sharp: isEnabled(filters, "sensor_noise") ? rand(0.2, 0.5) : 0,
    temporal_blend_opacity: isEnabled(filters, "temporal_blend") ? sampleRange(filters.temporal_blend, 0) : 0,
    film_curves_enabled: isEnabled(filters, "film_curves"),
    hue: isEnabled(filters, "hue") ? sampleRange(filters.hue, 0) : 0,
    sharpen: isEnabled(filters, "sharpen") ? sampleRange(filters.sharpen, 0.6) : 0,
    denoise: isEnabled(filters, "denoise") ? sampleRange(filters.denoise, 1.5) : 0,
    deband_enabled: isEnabled(filters, "deband"),
    // x264 encoding params — use only fast presets to keep repurposer responsive (medium/slow are 3–10x slower)
    x264_preset: (() => {
      const fastPresets = ["veryfast", "faster", "fast"];
      if (process.env.REPURPOSER_FAST_PRESET === "1" || process.env.VERCEL) return "veryfast";
      return fastPresets[randInt(0, fastPresets.length - 1)];
    })(),
    x264_refs: (process.env.REPURPOSER_FAST_PRESET === "1" || process.env.VERCEL) ? randInt(2, 3) : randInt(2, 6),
    x264_me_range: (process.env.REPURPOSER_FAST_PRESET === "1" || process.env.VERCEL) ? 16 : [16, 24, 32][randInt(0, 2)],
    ef_enabled: efOn,
    ef_profile: efProfile,
    ef_level: efLevel,
    ef_bframes: efOn ? randInt(0, 3) : 2,
    ef_sc_threshold: efOn ? [0, 20, 40, 100][randInt(0, 3)] : 40,
    ef_color_primaries: efOn ? EF_COLOR_PRIMARIES[randInt(0, EF_COLOR_PRIMARIES.length - 1)] : "bt709",
    ef_color_trc: efOn ? EF_COLOR_TRC[randInt(0, EF_COLOR_TRC.length - 1)] : "bt709",
    ef_color_space: efOn ? EF_COLOR_SPACE[randInt(0, EF_COLOR_SPACE.length - 1)] : "bt709",
    ef_color_range: efOn ? ["tv", "pc"][randInt(0, 1)] : "tv",
    ef_sample_rate: efOn ? [44100, 48000][randInt(0, 1)] : 48000,
    ef_timescale: efOn ? EF_TIMESCALES[randInt(0, EF_TIMESCALES.length - 1)] : 90000,
    ef_handler_v: efOn ? EF_VIDEO_HANDLERS[randInt(0, EF_VIDEO_HANDLERS.length - 1)] : "VideoHandler",
    ef_handler_a: efOn ? EF_AUDIO_HANDLERS[randInt(0, EF_AUDIO_HANDLERS.length - 1)] : "SoundHandler",
    ef_comment: efOn ? EF_COMMENTS[randInt(0, EF_COMMENTS.length - 1)] : "",
    ef_creation_time: efOn ? new Date(Date.now() - randInt(1, 730) * 86400000).toISOString() : "",
    ef_maxrate_mult: efOn ? rand(1.3, 2.5) : 1.5,
    ef_bufsize_mult: efOn ? rand(2.5, 5.0) : 3.0,
    colorlevels_enabled: isEnabled(filters, "colorlevels"),
    colorlevels_r_lo: isEnabled(filters, "colorlevels") ? rand(0.005, 0.020) : 0,
    colorlevels_g_lo: isEnabled(filters, "colorlevels") ? rand(0.005, 0.020) : 0,
    colorlevels_b_lo: isEnabled(filters, "colorlevels") ? rand(0.005, 0.020) : 0,
    colorlevels_r_hi: isEnabled(filters, "colorlevels") ? rand(0.980, 0.995) : 1,
    colorlevels_g_hi: isEnabled(filters, "colorlevels") ? rand(0.980, 0.995) : 1,
    colorlevels_b_hi: isEnabled(filters, "colorlevels") ? rand(0.980, 0.995) : 1,
    deflicker_enabled: isEnabled(filters, "deflicker"),
  };
}

function atempoChain(speed) {
  const factors = [];
  let remaining = speed;
  while (remaining > 2.0) { factors.push(2.0); remaining /= 2.0; }
  while (remaining < 0.5) { factors.push(0.5); remaining *= 2.0; }
  factors.push(remaining);
  return factors;
}

function buildFfmpegCommand(inputVideo, outputVideo, watermarkPath, filtersCfg, values, sourceInfo, options = {}) {
  const hasAudio = sourceInfo.hasAudio && options.disableAudio !== true;
  const duration = sourceInfo.duration;

  const cmd = [FFMPEG_BIN, "-y", "-fflags", "+discardcorrupt", "-err_detect", "ignore_err", "-i", inputVideo];
  const useWatermark = isEnabled(filtersCfg, "apply_watermark") && watermarkPath;
  if (useWatermark) cmd.push("-i", watermarkPath);

  const chains = [];
  let currentV = "[0:v]";
  let currentA = hasAudio ? "[0:a]" : "";
  let vIdx = 0;
  let aIdx = 0;

  function addVideo(expr) {
    vIdx++;
    const out = `[v${vIdx}]`;
    chains.push(`${currentV}${expr}${out}`);
    currentV = out;
  }

  function addAudio(expr) {
    if (!hasAudio) return;
    aIdx++;
    const out = `[a${aIdx}]`;
    chains.push(`${currentA}${expr}${out}`);
    currentA = out;
  }

  // Mandatory anti-duplicate baseline transform stack for videos.
  // These subtle edits are always applied, independent of optional UI filters.
  const shouldBaselineFlip = Math.random() < 0.5;
  const baselineBrightness = rand(0.008, 0.012).toFixed(4);
  const baselineContrast = rand(1.008, 1.015).toFixed(4);
  const baselineSaturation = rand(1.01, 1.02).toFixed(4);
  const baselineGamma = rand(1.008, 1.015).toFixed(4);
  addVideo("scale=iw+2:ih+2,crop=iw-2:ih-2");
  if (shouldBaselineFlip) addVideo("hflip");
  addVideo(`eq=brightness=${baselineBrightness}:contrast=${baselineContrast}:saturation=${baselineSaturation}:gamma=${baselineGamma}`);
  addVideo("hue=h=1");
  addVideo("unsharp=3:3:0.3:3:3:0");
  addVideo("noise=alls=2:allf=t");
  addVideo("setpts=PTS+0.033/TB");
  addAudio("aecho=0.8:0.9:40:0.3");
  addAudio("volume=1.002");

  if (isEnabled(filtersCfg, "camera_shake") && values.camera_shake_amp > 0) {
    const a = values.camera_shake_amp.toFixed(3);
    const a3 = (values.camera_shake_amp / 3).toFixed(3);
    const ah = (values.camera_shake_amp * 0.7).toFixed(3);
    const a2 = (values.camera_shake_amp * 0.2).toFixed(3);
    const f1 = values.camera_shake_f1.toFixed(4);
    const f2 = values.camera_shake_f2.toFixed(4);
    const g1 = values.camera_shake_g1.toFixed(4);
    const g2 = values.camera_shake_g2.toFixed(4);
    addVideo(`scale=iw*1.08:ih*1.08,crop=iw/1.08:ih/1.08:x='(iw-ow)/2+sin(t*${f1})*${a}+sin(t*${f2})*${a3}':y='(ih-oh)/2+cos(t*${g1})*${ah}+cos(t*${g2})*${a2}'`);
  }

  let trimStart = Math.max(0, isEnabled(filtersCfg, "cut_video") ? values.cut_video : 0);

  let trimEnd = Math.max(0, isEnabled(filtersCfg, "cut_end_video") ? values.cut_end_video : 0);
  if (duration > 0 && (trimStart > 0 || trimEnd > 0)) {
    let endAt = Math.max(0.1, duration - trimEnd);
    if (trimStart >= endAt) trimStart = 0;
    addVideo(`trim=start=${trimStart.toFixed(3)}:end=${endAt.toFixed(3)},setpts=PTS-STARTPTS`);
    addAudio(`atrim=start=${trimStart.toFixed(3)}:end=${endAt.toFixed(3)},asetpts=PTS-STARTPTS`);
  }

  const eqTerms = [];
  if (isEnabled(filtersCfg, "saturation")) eqTerms.push(`saturation=${clamp(values.saturation, 0, 3).toFixed(4)}`);
  if (isEnabled(filtersCfg, "contrast")) eqTerms.push(`contrast=${clamp(values.contrast, 0.5, 3).toFixed(4)}`);
  if (isEnabled(filtersCfg, "brightness")) eqTerms.push(`brightness=${clamp(values.brightness, -1, 1).toFixed(4)}`);
  if (isEnabled(filtersCfg, "gamma")) eqTerms.push(`gamma=${clamp(values.gamma, 0.1, 5).toFixed(4)}`);
  if (eqTerms.length > 0) addVideo(`eq=${eqTerms.join(":")}`);

  if (isEnabled(filtersCfg, "color_temp")) {
    const v = clamp(values.color_temp, -0.5, 0.5);
    if (Math.abs(v) > 0.001) {
      addVideo(`colorbalance=rs=${v.toFixed(4)}:gs=0:bs=${(-v).toFixed(4)}:rm=0:gm=0:bm=0:rh=0:gh=0:bh=0`);
    }
  }

  if (isEnabled(filtersCfg, "hue") && Math.abs(values.hue) > 0.05) {
    addVideo(`hue=h=${values.hue.toFixed(3)}`);
  }

  if (values.colorlevels_enabled) {
    addVideo(`colorlevels=rimin=${values.colorlevels_r_lo.toFixed(4)}:rimax=${values.colorlevels_r_hi.toFixed(4)}:gimin=${values.colorlevels_g_lo.toFixed(4)}:gimax=${values.colorlevels_g_hi.toFixed(4)}:bimin=${values.colorlevels_b_lo.toFixed(4)}:bimax=${values.colorlevels_b_hi.toFixed(4)}`);
  }

  if (values.deband_enabled) {
    addVideo("deband=range=16:direction=2*PI:blur=true");
  }

  if (isEnabled(filtersCfg, "vignette")) {
    const strength = clamp(values.vignette, 0, 1);
    addVideo(`vignette=angle=${(Math.PI * strength).toFixed(4)}`);
  }

  if (isEnabled(filtersCfg, "zoom")) {
    const z = clamp(values.zoom, 1, 2.5);
    addVideo(`scale=iw*${z.toFixed(4)}:ih*${z.toFixed(4)},crop=iw/${z.toFixed(4)}:ih/${z.toFixed(4)}`);
  }

  if (isEnabled(filtersCfg, "noise")) {
    const n = clamp(values.noise, 0, 100);
    addVideo(`noise=alls=${n.toFixed(2)}:allf=t`);
  }

  if (isEnabled(filtersCfg, "pixel_shift")) {
    const ps = Math.round(clamp(values.pixel_shift, -10, 10));
    addVideo(`chromashift=cbh=${ps}:cbv=${ps}:crh=${-ps}:crv=${-ps}`);
  }

  if (isEnabled(filtersCfg, "random_pixel_size")) {
    const px = Math.round(clamp(values.random_pixel_size, 1, 18));
    if (px > 1) {
      addVideo(`scale=iw/${px}:ih/${px}:flags=neighbor,scale=iw*${px}:ih*${px}:flags=neighbor`);
    }
  }

  if (isEnabled(filtersCfg, "rotation")) {
    const a = values.rotation;
    // Scale up 12% before rotating so corners are filled without black triangles,
    // then crop back to original dimensions. 12% handles angles up to ~3°.
    addVideo(`scale=ceil(iw*1.12/2)*2:ceil(ih*1.12/2)*2,rotate=${a.toFixed(4)}*PI/180:ow=iw:oh=ih:c=black,crop=iw/1.12:ih/1.12:(iw-ow)/2:(ih-oh)/2,scale=trunc(iw/2)*2:trunc(ih/2)*2`);
  }

  // Baseline stack may already hflip (shouldBaselineFlip). One more hflip toggles parity.
  // Net mirror must match UI: ON = mirrored, OFF = not mirrored (vs input).
  const wantHflip = !!values.flip;
  if (wantHflip !== shouldBaselineFlip) addVideo("hflip");
  if (values.vflip) addVideo("vflip");

  if (isEnabled(filtersCfg, "lens_correction")) {
    const k1 = clamp(values.lens_correction, -1, 1);
    addVideo(`lenscorrection=k1=${k1.toFixed(4)}:k2=${(k1 / 2).toFixed(4)}`);
  }

  if (values.dimensions_enabled) {
    addVideo(`scale=${values.width}:${values.height}:flags=lanczos,setsar=1`);
  }

  if (values.blurred_border) {
    const auxIdx = vIdx + 1;
    const fg = `[fg${auxIdx}]`;
    const bg = `[bg${auxIdx}]`;
    const bgb = `[bgb${auxIdx}]`;
    vIdx++;
    const out = `[v${vIdx}]`;
    chains.push(`${currentV}split=2${fg}${bg}`);
    chains.push(`${bg}scale=ceil(iw*1.12/2)*2:ceil(ih*1.12/2)*2,boxblur=18:2${bgb}`);
    chains.push(`${bgb}${fg}overlay=(W-w)/2:(H-h)/2${out}`);
    currentV = out;
  }

  if (isEnabled(filtersCfg, "speed")) {
    const speed = clamp(values.speed, 0.25, 4);
    if (Math.abs(speed - 1) > 0.001) {
      addVideo(`setpts=PTS/${speed.toFixed(6)}`);
      for (const factor of atempoChain(speed)) {
        addAudio(`atempo=${factor.toFixed(6)}`);
      }
    }
  }

  if (isEnabled(filtersCfg, "volume")) {
    const vol = clamp(values.volume, 0, 3);
    addAudio(`volume=${vol.toFixed(4)}`);
  }


  if (hasAudio && isEnabled(filtersCfg, "pitch_shift")) {
    const ratio = clamp(values.pitch_shift, 0.5, 2.0);
    if (Math.abs(ratio - 1.0) > 0.0005) {
      addAudio(`asetrate=44100*${ratio.toFixed(6)},aresample=44100`);
    }
  }

  if (hasAudio && isEnabled(filtersCfg, "audio_highpass")) {
    const hz = clamp(values.audio_highpass, 20, 500);
    if (hz > 20) addAudio(`highpass=f=${hz.toFixed(1)}`);
  }

  if (hasAudio && isEnabled(filtersCfg, "audio_lowpass")) {
    const hz = clamp(values.audio_lowpass, 5000, 22000);
    if (hz < 22000) addAudio(`lowpass=f=${hz.toFixed(1)}`);
  }

  if (hasAudio && isEnabled(filtersCfg, "audio_noise")) {
    const amp = clamp(values.audio_noise, 0, 0.05);
    if (amp > 0.00005) {
      addAudio(`aeval=val(ch)+random(ch)*${amp.toFixed(6)}:c=same`);
    }
  }

  if (values.sensor_noise_amt > 0) {
    const n = clamp(values.sensor_noise_amt, 0, 16);
    addVideo(`noise=c0s=${n.toFixed(2)}:c0f=t+p`);
    if (values.sensor_noise_sharp > 0) {
      addVideo(`unsharp=3:3:${values.sensor_noise_sharp.toFixed(3)}:3:3:0`);
    }
  }

  if (values.film_curves_enabled) {
    addVideo("curves=r='0/0 0.15/0.12 0.5/0.5 0.85/0.88 1/1':b='0/0 0.15/0.19 0.5/0.5 0.85/0.81 1/1'");
  }

  if (values.temporal_blend_opacity > 0) {
    const opacity = clamp(values.temporal_blend_opacity, 0.01, 0.5).toFixed(4);
    addVideo(`tblend=all_mode=average:all_opacity=${opacity}`);
  }

  if (values.deflicker_enabled) {
    addVideo(`deflicker=size=3:mode=am`);
  }

  if (values.denoise > 0) {
    const ls = clamp(values.denoise, 0.5, 10).toFixed(2);
    const cs = (values.denoise * 0.75).toFixed(2);
    const lt = (values.denoise * 0.5).toFixed(2);
    const ct = (values.denoise * 0.5).toFixed(2);
    addVideo(`hqdn3d=luma_spatial=${ls}:chroma_spatial=${cs}:luma_tmp=${lt}:chroma_tmp=${ct}`);
  }

  if (useWatermark) {
    const wmCfg = filtersCfg.apply_watermark || {};
    const wmSize = clamp(parseFloat(wmCfg.size) || 0.25, 0.05, 2);
    const wmOpacity = clamp(parseFloat(wmCfg.opacity) || 0.5, 0.05, 1);
    const wmX = parseInt(wmCfg.x) || 24;
    const wmY = parseInt(wmCfg.y) || 24;
    chains.push(`[1:v]scale=iw*${wmSize.toFixed(4)}:ih*${wmSize.toFixed(4)},format=rgba,colorchannelmixer=aa=${wmOpacity.toFixed(4)}[wm]`);
    vIdx++;
    const out = `[v${vIdx}]`;
    chains.push(`${currentV}[wm]overlay=${wmX}:${wmY}${out}`);
    currentV = out;
  }

  // Sharpen — applied last so it also counteracts any softness from zoom/rotation
  if (values.sharpen > 0) {
    const la = clamp(values.sharpen, 0.1, 3.0).toFixed(3);
    addVideo(`unsharp=lx=5:ly=5:la=${la}:cx=3:cy=3:ca=0`);
  }

  // Ensure even dimensions required by libx264
  addVideo(`scale=trunc(iw/2)*2:trunc(ih/2)*2`);

  if (chains.length === 0) {
    chains.push("[0:v]null[v1]");
    currentV = "[v1]";
  }

  // If audio exists but no audio filter ran, currentA is still the raw stream
  // selector "[0:a]" which is invalid inside -filter_complex. Add passthrough.
  if (hasAudio && currentA === "[0:a]") {
    aIdx++;
    const aOut = `[a${aIdx}]`;
    chains.push(`[0:a]anull${aOut}`);
    currentA = aOut;
  }

  cmd.push("-filter_complex", chains.join(";"), "-map", currentV);
  if (hasAudio) cmd.push("-map", currentA);

  cmd.push("-c:v", "libx264", "-preset", values.x264_preset, "-refs", `${values.x264_refs}`, "-me_range", `${values.x264_me_range}`, "-pix_fmt", "yuv420p", "-threads", "0");
  if (hasAudio) cmd.push("-c:a", "aac");
  else cmd.push("-an");

  const baseFps = Number.isFinite(sourceInfo.fps) ? sourceInfo.fps : 30;
  const jitteredFps = clamp(baseFps + rand(-0.01, 0.01), 5, 120);
  const outputFps = isEnabled(filtersCfg, "framerate")
    ? clamp(values.framerate, 5, 120)
    : jitteredFps;
  cmd.push("-r", `${outputFps.toFixed(3)}`);
  if (isEnabled(filtersCfg, "video_bitrate")) cmd.push("-b:v", `${Math.round(clamp(values.video_bitrate, 300, 20000))}k`);
  if (hasAudio && isEnabled(filtersCfg, "audio_bitrate")) cmd.push("-b:a", `${Math.round(clamp(values.audio_bitrate, 32, 512))}k`);
  if (isEnabled(filtersCfg, "keyframe_interval")) {
    const gop = Math.round(clamp(values.keyframe_interval, 10, 300));
    cmd.push("-g", `${gop}`);
  }
  cmd.push("-metadata:s:v", `encoder=${values.encoder_string}`);
  cmd.push("-metadata:s:v", "rotate=");

  if (values.ef_enabled) {
    cmd.push("-profile:v", values.ef_profile, "-level:v", values.ef_level);
    cmd.push("-bf", `${values.ef_bframes}`, "-sc_threshold", `${values.ef_sc_threshold}`);
    cmd.push(
      "-color_primaries", values.ef_color_primaries,
      "-color_trc", values.ef_color_trc,
      "-colorspace", values.ef_color_space,
      "-color_range", values.ef_color_range,
    );
    if (hasAudio) cmd.push("-ar", `${values.ef_sample_rate}`);
    if (isEnabled(filtersCfg, "video_bitrate")) {
      const vb = Math.round(clamp(values.video_bitrate, 300, 20000));
      cmd.push("-maxrate", `${Math.round(vb * values.ef_maxrate_mult)}k`);
      cmd.push("-bufsize", `${Math.round(vb * values.ef_bufsize_mult)}k`);
    }
    cmd.push("-metadata:s:v", `handler_name=${values.ef_handler_v}`);
    if (hasAudio) cmd.push("-metadata:s:a", `handler_name=${values.ef_handler_a}`);
    if (values.ef_comment) cmd.push("-metadata", `comment=${values.ef_comment}`);
    if (values.ef_creation_time) cmd.push("-metadata", `creation_time=${values.ef_creation_time}`);
    cmd.push("-video_track_timescale", `${values.ef_timescale}`);
  }

  cmd.push("-movflags", "+faststart", outputVideo);
  return cmd;
}

function buildImageCommand(inputImage, outputImage, watermarkPath, filtersCfg, values, sourceInfo, overrideQuality) {
  const cmd = [FFMPEG_BIN, "-y", "-i", inputImage];
  const useWatermark = isEnabled(filtersCfg, "apply_watermark") && watermarkPath;
  if (useWatermark) cmd.push("-i", watermarkPath);

  const chains = [];
  let currentV = "[0:v]";
  let vIdx = 0;

  function addVideo(expr) {
    vIdx++;
    const out = `[v${vIdx}]`;
    chains.push(`${currentV}${expr}${out}`);
    currentV = out;
  }

  // Mandatory anti-duplicate baseline transform stack for photos.
  const baselineBrightness = rand(-0.01, 0.01).toFixed(4);
  const baselineContrast = rand(1.005, 1.02).toFixed(4);
  const baselineSaturation = rand(1.005, 1.02).toFixed(4);
  const baselineNoise = rand(1, 3).toFixed(2);
  addVideo("scale=iw+1:ih+1,crop=iw-1:ih-1");
  addVideo(`eq=brightness=${baselineBrightness}:contrast=${baselineContrast}:saturation=${baselineSaturation}`);
  addVideo(`noise=alls=${baselineNoise}:allf=t`);

  if (isEnabled(filtersCfg, "camera_shake") && values.camera_shake_amp > 0) {
    // Use expression-based crop dimensions so this remains valid even when probe dimensions are unavailable.
    const cropRatio = 0.92;
    const invCrop = (1 / cropRatio).toFixed(6);
    const maxOffsetRatio = 1 - cropRatio;
    const oxRatio = rand(0, maxOffsetRatio).toFixed(4);
    const oyRatio = rand(0, maxOffsetRatio).toFixed(4);
    addVideo(`crop=iw*${cropRatio}:ih*${cropRatio}:iw*${oxRatio}:ih*${oyRatio},scale=iw*${invCrop}:ih*${invCrop}:flags=lanczos`);
  }

  const eqTerms = [];
  if (isEnabled(filtersCfg, "saturation")) eqTerms.push(`saturation=${clamp(values.saturation, 0, 3).toFixed(4)}`);
  if (isEnabled(filtersCfg, "contrast")) eqTerms.push(`contrast=${clamp(values.contrast, 0.5, 3).toFixed(4)}`);
  if (isEnabled(filtersCfg, "brightness")) eqTerms.push(`brightness=${clamp(values.brightness, -1, 1).toFixed(4)}`);
  if (isEnabled(filtersCfg, "gamma")) eqTerms.push(`gamma=${clamp(values.gamma, 0.1, 5).toFixed(4)}`);
  if (eqTerms.length > 0) addVideo(`eq=${eqTerms.join(":")}`);

  if (isEnabled(filtersCfg, "color_temp")) {
    const v = clamp(values.color_temp, -0.5, 0.5);
    if (Math.abs(v) > 0.001) {
      addVideo(`colorbalance=rs=${v.toFixed(4)}:gs=0:bs=${(-v).toFixed(4)}:rm=0:gm=0:bm=0:rh=0:gh=0:bh=0`);
    }
  }

  if (isEnabled(filtersCfg, "hue") && Math.abs(values.hue) > 0.05) {
    addVideo(`hue=h=${values.hue.toFixed(3)}`);
  }

  if (values.colorlevels_enabled) {
    addVideo(`colorlevels=rimin=${values.colorlevels_r_lo.toFixed(4)}:rimax=${values.colorlevels_r_hi.toFixed(4)}:gimin=${values.colorlevels_g_lo.toFixed(4)}:gimax=${values.colorlevels_g_hi.toFixed(4)}:bimin=${values.colorlevels_b_lo.toFixed(4)}:bimax=${values.colorlevels_b_hi.toFixed(4)}`);
  }

  if (values.deband_enabled) {
    addVideo("deband=range=16:direction=2*PI:blur=true");
  }

  if (isEnabled(filtersCfg, "vignette")) {
    const strength = clamp(values.vignette, 0, 1);
    addVideo(`vignette=angle=${(Math.PI * strength).toFixed(4)}`);
  }

  if (isEnabled(filtersCfg, "zoom")) {
    const z = clamp(values.zoom, 1, 2.5);
    addVideo(`scale=iw*${z.toFixed(4)}:ih*${z.toFixed(4)},crop=iw/${z.toFixed(4)}:ih/${z.toFixed(4)}`);
  }

  if (isEnabled(filtersCfg, "noise")) {
    const n = clamp(values.noise, 0, 100);
    addVideo(`noise=alls=${n.toFixed(2)}:allf=a`);
  }

  if (isEnabled(filtersCfg, "pixel_shift")) {
    const ps = Math.round(clamp(values.pixel_shift, -10, 10));
    addVideo(`chromashift=cbh=${ps}:cbv=${ps}:crh=${-ps}:crv=${-ps}`);
  }

  if (isEnabled(filtersCfg, "random_pixel_size")) {
    const px = Math.round(clamp(values.random_pixel_size, 1, 18));
    if (px > 1) {
      addVideo(`scale=iw/${px}:ih/${px}:flags=neighbor,scale=iw*${px}:ih*${px}:flags=neighbor`);
    }
  }

  if (isEnabled(filtersCfg, "rotation")) {
    const a = values.rotation;
    // Scale up 12% before rotating so corners are filled without black triangles,
    // then crop back to original dimensions. 12% handles angles up to ~3°.
    addVideo(`scale=ceil(iw*1.12/2)*2:ceil(ih*1.12/2)*2,rotate=${a.toFixed(4)}*PI/180:ow=iw:oh=ih:c=black,crop=iw/1.12:ih/1.12:(iw-ow)/2:(ih-oh)/2,scale=trunc(iw/2)*2:trunc(ih/2)*2`);
  }

  if (values.flip) addVideo("hflip");
  if (values.vflip) addVideo("vflip");

  if (isEnabled(filtersCfg, "lens_correction")) {
    const k1 = clamp(values.lens_correction, -1, 1);
    addVideo(`lenscorrection=k1=${k1.toFixed(4)}:k2=${(k1 / 2).toFixed(4)}`);
  }

  if (values.dimensions_enabled) {
    addVideo(`scale=${values.width}:${values.height}:flags=lanczos,setsar=1`);
  }

  if (values.sensor_noise_amt > 0) {
    const n = clamp(values.sensor_noise_amt, 0, 16);
    addVideo(`noise=c0s=${n.toFixed(2)}:c0f=a+p`);
    if (values.sensor_noise_sharp > 0) {
      addVideo(`unsharp=3:3:${values.sensor_noise_sharp.toFixed(3)}:3:3:0`);
    }
  }

  if (values.film_curves_enabled) {
    addVideo("curves=r='0/0 0.15/0.12 0.5/0.5 0.85/0.88 1/1':b='0/0 0.15/0.19 0.5/0.5 0.85/0.81 1/1'");
  }

  if (values.blurred_border) {
    const auxIdx = vIdx + 1;
    const fg = `[fg${auxIdx}]`;
    const bg = `[bg${auxIdx}]`;
    const bgb = `[bgb${auxIdx}]`;
    vIdx++;
    const out = `[v${vIdx}]`;
    chains.push(`${currentV}split=2${fg}${bg}`);
    chains.push(`${bg}scale=ceil(iw*1.12/2)*2:ceil(ih*1.12/2)*2,boxblur=18:2${bgb}`);
    chains.push(`${bgb}${fg}overlay=(W-w)/2:(H-h)/2${out}`);
    currentV = out;
  }

  if (values.denoise > 0) {
    const ls = clamp(values.denoise, 0.5, 10).toFixed(2);
    const cs = (values.denoise * 0.75).toFixed(2);
    const lt = (values.denoise * 0.5).toFixed(2);
    const ct = (values.denoise * 0.5).toFixed(2);
    addVideo(`hqdn3d=luma_spatial=${ls}:chroma_spatial=${cs}:luma_tmp=${lt}:chroma_tmp=${ct}`);
  }

  // Sharpen — applied last to counteract softness from zoom/filter chain
  if (values.sharpen > 0) {
    const la = clamp(values.sharpen, 0.1, 3.0).toFixed(3);
    addVideo(`unsharp=lx=5:ly=5:la=${la}:cx=3:cy=3:ca=0`);
  }

  if (useWatermark) {
    const wmCfg = filtersCfg.apply_watermark || {};
    const wmSize = clamp(parseFloat(wmCfg.size) || 0.25, 0.05, 2);
    const wmOpacity = clamp(parseFloat(wmCfg.opacity) || 0.5, 0.05, 1);
    const wmX = parseInt(wmCfg.x) || 24;
    const wmY = parseInt(wmCfg.y) || 24;
    chains.push(`[1:v]scale=iw*${wmSize.toFixed(4)}:ih*${wmSize.toFixed(4)},format=rgba,colorchannelmixer=aa=${wmOpacity.toFixed(4)}[wm]`);
    vIdx++;
    const out = `[v${vIdx}]`;
    chains.push(`${currentV}[wm]overlay=${wmX}:${wmY}${out}`);
    currentV = out;
  }

  if (chains.length === 0) {
    chains.push("[0:v]null[v1]");
    currentV = "[v1]";
  }

  cmd.push("-filter_complex", chains.join(";"), "-map", currentV);
  cmd.push("-frames:v", "1", "-q:v", String(overrideQuality ?? randInt(2, 4)), outputImage);
  return cmd;
}

async function applyMetadata(filePath, metadataSettings) {
  const result = { applied: false, warnings: [] };
  if (!fs.existsSync(filePath)) {
    result.warnings.push("Output file missing; metadata step skipped.");
    return result;
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const isVideo = [".mp4", ".mov", ".webm", ".mkv"].includes(ext);
    const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
    if (!isVideo && !isImage) {
      result.warnings.push("Unsupported file extension for metadata injection.");
      return result;
    }

    const profile = chooseProfile(metadataSettings.device_metadata || {});
    let ts = new Date();
    if (metadataSettings.timestamps?.enabled) {
      // Prefer explicit user-selected timestamp (new UI behavior).
      ts = parseTimestampInput(metadataSettings.timestamps?.date_taken)
        // Backward compatibility for older saved presets.
        || parseTimestampInput(metadataSettings.timestamps?.start_date)
        || parseTimestampInput(metadataSettings.timestamps?.end_date)
        || new Date();
    }
    if (Number.isFinite(Number(metadataSettings._repurposeUniqueOffsetSeconds))) {
      ts = new Date(ts.getTime() + Number(metadataSettings._repurposeUniqueOffsetSeconds) * 1000);
    }

    const gpsSettings = metadataSettings.gps_location;
    const gpsEnabled = gpsSettings?.enabled !== false;
    let gps = null;
    if (gpsEnabled) {
      gps = randomGps(gpsSettings?.country || "US");
      if (
        gpsSettings?.mode === "pinpoint" &&
        Number.isFinite(Number(gpsSettings?.lat)) &&
        Number.isFinite(Number(gpsSettings?.lng))
      ) {
        const lat = Number(gpsSettings.lat);
        const lng = Number(gpsSettings.lng);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          gps = { lat, lon: lng, alt: rand(profile.gpsAltitudeRange[0], profile.gpsAltitudeRange[1]) };
        } else {
          result.warnings.push("Pinpoint GPS out of range; falling back to randomized location.");
        }
      }
    }

    const randomizeCameraData = metadataSettings.device_metadata?.randomizeCameraData
      ?? metadataSettings.device_metadata?.randomize_camera_data
      ?? true;

    await writeMetadata({
      filePath,
      profile,
      dateTaken: ts,
      gpsLat: gps?.lat ?? null,
      gpsLng: gps?.lon ?? null,
      gpsAlt: gps?.alt ?? null,
      randomizeISO: !!randomizeCameraData,
      randomizeShutter: !!randomizeCameraData,
    });

    result.applied = true;
  } catch (e) {
    if (e.code === "ENOENT") {
      // On Vercel/serverless, exiftool is typically not available; skip noisy warning.
      if (!process.env.VERCEL) {
        result.warnings.push("Metadata spoofing skipped: exiftool not installed. Install exiftool or set EXIFTOOL_PATH to enable.");
      }
    } else {
      result.warnings.push(`metadata write failed: ${(e.stderr || e.message || "").slice(0, 300)}`);
    }
  }

  return result;
}

/**
 * Build metadata instruction for n8n (no file I/O). Same logic as applyMetadata but returns
 * a serializable object so n8n can apply it via ffmpeg -metadata or exiftool.
 * @param {object} metadataSettings - settings.metadata from the app (device_metadata, timestamps, gps_location)
 * @returns {{ creationTime: string, comment: string, encoder: string, gps: { lat: number, lng: number, alt: number } | null } | null}
 */
export function buildMetadataInstruction(metadataSettings) {
  if (!metadataSettings || typeof metadataSettings !== "object") return null;
  try {
    const profile = chooseProfile(metadataSettings.device_metadata || {});
    let ts = new Date();
    if (metadataSettings.timestamps?.enabled) {
      const parsed =
        parseTimestampInput(metadataSettings.timestamps?.date_taken)
        || parseTimestampInput(metadataSettings.timestamps?.start_date)
        || parseTimestampInput(metadataSettings.timestamps?.end_date);
      if (parsed) ts = parsed;
    }
    if (Number.isFinite(Number(metadataSettings._repurposeUniqueOffsetSeconds))) {
      ts = new Date(ts.getTime() + Number(metadataSettings._repurposeUniqueOffsetSeconds) * 1000);
    }
    const gpsSettings = metadataSettings.gps_location;
    const gpsEnabled = gpsSettings?.enabled !== false;
    let gps = null;
    if (gpsEnabled) {
      gps = randomGps(gpsSettings?.country || "US");
      if (
        gpsSettings?.mode === "pinpoint" &&
        Number.isFinite(Number(gpsSettings?.lat)) &&
        Number.isFinite(Number(gpsSettings?.lng))
      ) {
        const lat = Number(gpsSettings.lat);
        const lng = Number(gpsSettings.lng);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          gps = { lat, lng, alt: rand(profile.gpsAltitudeRange[0], profile.gpsAltitudeRange[1]) };
        }
      }
      if (gps) gps = { lat: gps.lat, lng: gps.lon ?? gps.lng, alt: gps.alt ?? 0 };
    }
    const creationTime = ts.toISOString().replace(/\.\d{3}Z$/, "Z");
    const comment = pickMetadataComment(profile);
    const encoder = profileEncoderString(profile);
    return { creationTime, comment, encoder, gps };
  } catch {
    return null;
  }
}

export function buildMetadataInstructionsForCopies(metadataSettings, copies = 1) {
  const total = Math.min(5, Math.max(1, parseInt(copies, 10) || 1));
  const base = ensureBatchDeviceModelKey(metadataSettings || {});
  const deviceKeys = pickDeviceModelKeysForCopies(base, total);
  const instructions = [];
  for (let i = 0; i < total; i++) {
    const perCopy = buildMetadataSettingsForCopy(base, i, deviceKeys[i] || null);
    instructions.push(buildMetadataInstruction(perCopy));
  }
  return instructions;
}

/**
 * Build FFmpeg arguments for n8n (placeholders {input} and {output}).
 * Args only — no "ffmpeg" prefix; nodes like n8n-nodes-ffmpeg invoke the binary themselves (e.g. ffmpegCustomArgs).
 */
export function buildFfmpegMetadataCommand(metadataInstruction) {
  let out;
  if (!metadataInstruction || typeof metadataInstruction !== "object") {
    out = "-i {input} -c copy {output}";
  } else {
    const creationTime = metadataInstruction.creationTime != null ? String(metadataInstruction.creationTime).trim() : "";
    const commentRaw = metadataInstruction.comment != null ? String(metadataInstruction.comment).trim() : "";
    const comment = commentRaw.includes(" ") || commentRaw.includes('"')
      ? `"${commentRaw.replace(/"/g, '\\"')}"`
      : commentRaw;
    const encoder = metadataInstruction.encoder != null ? String(metadataInstruction.encoder).trim() : "";
    const parts = ["-i", "{input}", "-c", "copy"];
    if (creationTime) parts.push("-metadata", `creation_time=${creationTime}`);
    if (commentRaw) parts.push("-metadata", `comment=${comment}`);
    if (encoder) parts.push("-metadata:s:v", `encoder=${encoder}`);
    parts.push("{output}");
    out = parts.join(" ");
  }
  return out.trim();
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(args[0], args.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg exit code ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", reject);
  });
}

function isLikelyCorruptAudioFailure(msg) {
  const text = String(msg || "").toLowerCase();
  return (
    text.includes("sample rate index configured by the container") ||
    text.includes("prediction is not allowed in aac-lc") ||
    text.includes("reserved bit set") ||
    text.includes("more samples than frame size") ||
    text.includes("error submitting audio frame to the encoder") ||
    text.includes("error while decoding stream #0:1") ||
    (text.includes("aac") && text.includes("invalid data found when processing input"))
  );
}

function runNightshade(inputPath, outputPath, strength = 8.0) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../scripts/nightshade_perturb.py"
    );
    const proc = spawn("python3", [scriptPath, inputPath, outputPath, String(strength)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Nightshade exit ${code}: ${stderr.slice(-300)}`));
    });
    proc.on("error", reject);
  });
}

function shouldAttemptMuteRetry(sourceInfo, errorMessage) {
  const text = String(errorMessage || "").toLowerCase();
  if (sourceInfo?.hasAudio) return true;
  return (
    isLikelyCorruptAudioFailure(text) ||
    text.includes("stream #0:1") ||
    text.includes("audio frame")
  );
}

export async function processVideoBatch(inputVideo, watermarkPath, outputDir, settings, progressCb, options = {}) {
  const useWasm = options.useWasm === true || process.env.VERCEL === "1";
  const sourceInfo = await probeInput(inputVideo);
  const filtersCfg = settings.filters || {};
  const metadataCfg = ensureBatchDeviceModelKey(settings.metadata || {});
  const copies = Math.max(1, parseInt(settings.copies) || 1);
  const deviceKeys = pickDeviceModelKeysForCopies(metadataCfg, copies);

  fs.mkdirSync(outputDir, { recursive: true });
  const stem = path.basename(inputVideo, path.extname(inputVideo));
  const outputs = [];

  for (let i = 0; i < copies; i++) {
    progressCb(Math.round(((i + 0.05) / copies) * 100), `Generating copy ${i + 1}/${copies}...`);

    const metadataCfgForCopy = buildMetadataSettingsForCopy(metadataCfg, i, deviceKeys[i] || null);
    const profileForCopy = chooseProfile(metadataCfgForCopy.device_metadata || {});
    const values = randomizeValues(filtersCfg, sourceInfo, profileForCopy);
    const outputName = `${stem}_repurpose_${String(i + 1).padStart(3, "0")}.mp4`;
    const outputPath = path.join(outputDir, outputName);

    const ffmpegCmd = buildFfmpegCommand(inputVideo, outputPath, watermarkPath, filtersCfg, values, sourceInfo);
    let retriedWithoutAudio = false;

    try {
      if (useWasm) await runFfmpegWasm(ffmpegCmd);
      else await runFfmpeg(ffmpegCmd);
    } catch (e) {
      // Always attempt one muted retry after a primary failure.
      // This recovers jobs where ffprobe/diagnostics miss corrupt AAC details.
      retriedWithoutAudio = true;
      const muteCmd = buildFfmpegCommand(inputVideo, outputPath, watermarkPath, filtersCfg, values, sourceInfo, { disableAudio: true });
      try {
        if (useWasm) await runFfmpegWasm(muteCmd);
        else await runFfmpeg(muteCmd);
      } catch (e2) {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        throw new Error(
          `FFmpeg failed for copy #${i + 1}: primary=${e?.message || "unknown"}; audio-disabled retry=${e2?.message || "unknown"}`
        );
      }
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      throw new Error(`FFmpeg produced empty or corrupt output for copy #${i + 1}`);
    }

    progressCb(Math.round(((i + 0.65) / copies) * 100), `Spoofing metadata for copy ${i + 1}/${copies}...`);

    const metaResult = await applyMetadata(outputPath, metadataCfgForCopy);
    if (retriedWithoutAudio) {
      if (!Array.isArray(metaResult.warnings)) metaResult.warnings = [];
      metaResult.warnings.push("Primary ffmpeg pass failed; output generated using audio-disabled retry.");
    }

    try {
      scrubEncoderSignaturesInFile(outputPath);
    } catch (e) {
      if (metaResult.warnings) metaResult.warnings.push(`Encoder scrub: ${(e?.message || "").slice(0, 80)}`);
    }

    outputs.push({
      fileName: outputName,
      absolutePath: outputPath,
      metadata: metaResult,
    });

    progressCb(Math.round(((i + 1) / copies) * 100), `Completed copy ${i + 1}/${copies}.`);
  }

  progressCb(100, "All copies generated.");
  return outputs;
}


export async function processImageBatch(inputImage, watermarkPath, outputDir, settings, progressCb, options = {}) {
  const useWasm = options.useWasm === true || process.env.VERCEL === "1";
  const sourceInfo = await probeInput(inputImage);
  const filtersCfg = stripVideoOnlyFilters(settings.filters || {});
  const metadataCfg = ensureBatchDeviceModelKey(settings.metadata || {});
  const copies = Math.max(1, parseInt(settings.copies) || 1);
  const deviceKeys = pickDeviceModelKeysForCopies(metadataCfg, copies);

  fs.mkdirSync(outputDir, { recursive: true });
  const stem = path.basename(inputImage, path.extname(inputImage));
  const outputs = [];

  for (let i = 0; i < copies; i++) {
    progressCb(Math.round(((i + 0.05) / copies) * 100), `Generating copy ${i + 1}/${copies}...`);

    const values = randomizeValues(filtersCfg, sourceInfo);
    const outputName = `${stem}_repurpose_${String(i + 1).padStart(3, "0")}.jpg`;
    const outputPath = path.join(outputDir, outputName);

    // JPEG quality target ~92-95 for natural camera-like outputs.
    const jpegQ = randInt(2, 4);
    const ffmpegCmd = buildImageCommand(inputImage, outputPath, watermarkPath, filtersCfg, values, sourceInfo, jpegQ);
    try {
      if (useWasm) await runFfmpegWasm(ffmpegCmd);
      else await runFfmpeg(ffmpegCmd);
    } catch (e) {
      throw new Error(`FFmpeg failed for copy #${i + 1}: ${e.message}`);
    }

    progressCb(Math.round(((i + 0.65) / copies) * 100), `Spoofing metadata for copy ${i + 1}/${copies}...`);

    const metadataCfgForCopy = buildMetadataSettingsForCopy(metadataCfg, i, deviceKeys[i] || null);
    const metaResult = await applyMetadata(outputPath, metadataCfgForCopy);

    try {
      scrubEncoderSignaturesInFile(outputPath);
    } catch (e) {
      if (metaResult.warnings) metaResult.warnings.push(`Encoder scrub: ${(e?.message || "").slice(0, 80)}`);
    }

    outputs.push({
      fileName: outputName,
      absolutePath: outputPath,
      metadata: metaResult,
    });

    progressCb(Math.round(((i + 1) / copies) * 100), `Completed copy ${i + 1}/${copies}.`);
  }

  progressCb(100, "All copies generated.");
  return outputs;
}
