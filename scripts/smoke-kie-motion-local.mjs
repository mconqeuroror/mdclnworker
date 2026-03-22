/**
 * Smoke test: upload local image + video to Vercel Blob, then POST KIE motion-control createTask.
 *
 * Usage (from repo root):
 *   set KIE_API_KEY=...
 *   set BLOB_READ_WRITE_TOKEN=...   (same as production — KIE needs public http URLs)
 *   node scripts/smoke-kie-motion-local.mjs <imagePath> <videoPath> [2.6|3.0]
 *
 * If Blob is not configured, use public URLs instead:
 *   node scripts/smoke-kie-motion-local.mjs --public <imageUrl> <videoUrl> [2.6|3.0]
 *
 * Do not commit API keys. Callback URL is only for task creation; use your real callback in prod.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { put } from "@vercel/blob";

const KIE_API_URL = "https://api.kie.ai/api/v1";

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  return "application/octet-stream";
}

async function uploadRelay(buffer, filename, contentType) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required to expose local files to KIE");
  }
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const blobPath = `kie-relay/${ts}_${rand}_${filename.replace(/[^\w.-]/g, "_")}`;
  const blob = await put(blobPath, buffer, {
    access: "public",
    contentType,
    token,
    addRandomSuffix: false,
  });
  return blob.url;
}

async function createMotionTask({ model, imageUrl, videoUrl, callBackUrl }) {
  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) throw new Error("KIE_API_KEY is not set");

  const is30 = model.includes("kling-3.0");
  const inputObj = {
    mode: "720p",
    video_urls: [videoUrl],
    character_orientation: is30 ? "image" : "video",
    prompt:
      "No distortion, no blur, background matches with the image source, the character's movements are consistent with the video.",
    input_urls: [imageUrl],
    ...(is30 ? { background_source: "input_video" } : {}),
  };

  const body = {
    model,
    callBackUrl,
    input: JSON.stringify(inputObj),
  };

  const res = await fetch(`${KIE_API_URL}/jobs/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`KIE non-JSON (${res.status}): ${text.slice(0, 400)}`);
  }

  if (json.code !== 200) {
    throw new Error(`KIE error code=${json.code} msg=${json.msg || json.message || text.slice(0, 300)}`);
  }

  const taskId = json.data?.taskId;
  if (!taskId) throw new Error(`No taskId: ${text.slice(0, 300)}`);
  return { taskId, raw: json };
}

async function main() {
  const args = process.argv.slice(2);
  let version = "2.6";
  let imageUrl;
  let videoUrl;

  if (args[0] === "--public") {
    const [, imgU, vidU, ver] = args;
    if (!imgU || !vidU || !imgU.startsWith("http") || !vidU.startsWith("http")) {
      console.error(
        "Usage: node scripts/smoke-kie-motion-local.mjs --public <imageUrl> <videoUrl> [2.6|3.0]",
      );
      process.exit(1);
    }
    imageUrl = imgU;
    videoUrl = vidU;
    if (ver) version = ver;
  } else {
    const [imgPath, vidPath, ver] = args;
    if (!imgPath || !vidPath) {
      console.error(
        "Usage: node scripts/smoke-kie-motion-local.mjs <imagePath> <videoPath> [2.6|3.0]\n" +
          "   or: node scripts/smoke-kie-motion-local.mjs --public <imageUrl> <videoUrl> [2.6|3.0]",
      );
      process.exit(1);
    }
    if (ver) version = ver;

    if (!fs.existsSync(imgPath)) {
      console.error("Image not found:", imgPath);
      process.exit(1);
    }
    if (!fs.existsSync(vidPath)) {
      console.error("Video not found:", vidPath);
      process.exit(1);
    }

    const imgBuf = fs.readFileSync(imgPath);
    const vidBuf = fs.readFileSync(vidPath);
    const imgCt = contentTypeFor(imgPath);
    const vidCt = contentTypeFor(vidPath);

    console.log("Uploading image to Blob…", imgPath, `(${imgBuf.length} bytes)`);
    imageUrl = await uploadRelay(imgBuf, path.basename(imgPath), imgCt);
    console.log("Image URL:", imageUrl.slice(0, 100));

    console.log("Uploading video to Blob…", vidPath, `(${vidBuf.length} bytes)`);
    videoUrl = await uploadRelay(vidBuf, path.basename(vidPath), vidCt);
    console.log("Video URL:", videoUrl.slice(0, 100));
  }

  const callBackUrl =
    process.env.KIE_CALLBACK_URL ||
    process.env.SMOKE_KIE_CALLBACK_URL ||
    "https://modelclone.app/api/kie/callback";

  const model =
    version === "3.0" || version === "30" || version === "ultra"
      ? "kling-3.0/motion-control"
      : "kling-2.6/motion-control";

  console.log("Creating KIE task", model, "callback:", callBackUrl);
  const { taskId, raw } = await createMotionTask({
    model,
    imageUrl,
    videoUrl,
    callBackUrl,
  });

  console.log("OK taskId:", taskId);
  console.log(JSON.stringify(raw, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(2);
});
