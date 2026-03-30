/**
 * Run FFmpeg via WASM in Node (for Vercel/serverless where no system binary exists).
 * Uses @ffmpeg/ffmpeg loaded from CDN; reads/writes real paths via fs.
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import fs from "fs";
import path from "path";

const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpegInstance = null;
let loadPromise = null;

async function loadFFmpegWasm() {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: `${CORE_BASE}/ffmpeg-core.js`,
      wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();
  return loadPromise;
}

/**
 * Parse spawn-style args [bin, "-y", "-i", input1, "-i", input2?, ..., outputPath]
 * into { wasmArgs, inputPaths, outputPath } for WASM (no binary name; virtual names used in wasmArgs).
 */
function parseArgsForWasm(args) {
  if (args.length < 4) throw new Error("FFmpeg args too short");
  const rest = args.slice(1);
  const inputPaths = [];
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === "-i" && i + 1 < rest.length) {
      inputPaths.push(rest[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }
  const outputPath = rest[rest.length - 1];
  const ext = path.extname(outputPath) || ".mp4";
  const virtualOutput = `out${ext}`;
  const virtualInputs = inputPaths.map((_, idx) => `in${idx}${path.extname(inputPaths[idx]) || ".mp4"}`);

  const pathToVirtual = new Map();
  inputPaths.forEach((p, idx) => pathToVirtual.set(p, virtualInputs[idx]));
  pathToVirtual.set(outputPath, virtualOutput);

  const wasmArgs = rest.map((arg) => pathToVirtual.get(arg) ?? arg);
  return { wasmArgs, inputPaths, outputPath, virtualInputs, virtualOutput };
}

/**
 * Run FFmpeg via WASM. args = full spawn-style array [bin, "-y", "-i", inputPath, ..., outputPath].
 * Reads inputs from disk, runs in WASM, writes output to disk.
 */
export async function runFfmpegWasm(args) {
  const { wasmArgs, inputPaths, outputPath, virtualInputs, virtualOutput } = parseArgsForWasm(args);
  const ffmpeg = await loadFFmpegWasm();

  for (let i = 0; i < inputPaths.length; i++) {
    const data = fs.readFileSync(inputPaths[i]);
    await ffmpeg.writeFile(virtualInputs[i], new Uint8Array(data));
  }

  await ffmpeg.exec(wasmArgs);

  const outData = await ffmpeg.readFile(virtualOutput);
  fs.writeFileSync(outputPath, Buffer.from(outData));

  for (const name of [...virtualInputs, virtualOutput]) {
    try {
      await ffmpeg.deleteFile(name);
    } catch (_) {}
  }
}

export async function isWasmAvailable() {
  try {
    await loadFFmpegWasm();
    return true;
  } catch {
    return false;
  }
}
