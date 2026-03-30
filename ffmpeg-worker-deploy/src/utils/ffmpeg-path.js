/**
 * Resolve FFmpeg binary path. Repurposing uses ffmpeg.wasm in the browser; server-side
 * FFmpeg is only used for frame extraction, media reformat, etc. when env/bin or system ffmpeg exists.
 * No @ffmpeg-installer dependency — avoids ERR_MODULE_NOT_FOUND on Vercel where the package is excluded.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export function getFfmpegPathSync() {
  const envPath = process.env.FFMPEG_PATH;
  if (envPath) {
    if (path.isAbsolute(envPath) && fs.existsSync(envPath)) return envPath;
    const fromCwd = path.resolve(process.cwd(), envPath);
    if (fs.existsSync(fromCwd)) return fromCwd;
    const fromRoot = path.resolve(PROJECT_ROOT, envPath);
    if (fs.existsSync(fromRoot)) return fromRoot;
  }
  const binCwd = path.join(process.cwd(), "bin", "ffmpeg");
  if (fs.existsSync(binCwd)) return binCwd;
  const binRoot = path.join(PROJECT_ROOT, "bin", "ffmpeg");
  if (fs.existsSync(binRoot)) return binRoot;
  return "ffmpeg";
}

export function getFfprobePathSync(ffmpegPath) {
  const envPath = process.env.FFPROBE_PATH;
  if (envPath) {
    if (path.isAbsolute(envPath) && fs.existsSync(envPath)) return envPath;
    const fromCwd = path.resolve(process.cwd(), envPath);
    if (fs.existsSync(fromCwd)) return fromCwd;
    const fromRoot = path.resolve(PROJECT_ROOT, envPath);
    if (fs.existsSync(fromRoot)) return fromRoot;
  }
  const binCwd = path.join(process.cwd(), "bin", "ffprobe");
  if (fs.existsSync(binCwd)) return binCwd;
  const binRoot = path.join(PROJECT_ROOT, "bin", "ffprobe");
  if (fs.existsSync(binRoot)) return binRoot;
  if (ffmpegPath && ffmpegPath !== "ffmpeg") {
    const dir = path.dirname(ffmpegPath);
    const candidates = process.platform === "win32"
      ? [path.join(dir, "ffprobe.exe"), path.join(dir, "ffprobe")]
      : [path.join(dir, "ffprobe")];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return "ffprobe";
}
