/**
 * fal.ai Service - LoRA Training for NSFW Content Generation
 *
 * This service handles:
 * 1. Training LoRA models from user images
 * 2. Polling for training completion
 * 3. Downloading and storing trained LoRA files
 *
 * API Documentation: https://fal.ai/models/fal-ai/z-image-turbo-trainer-v2
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isR2Configured, uploadToR2 } from "../utils/r2.js";
import { isVercelBlobConfigured, uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";
import { falConstraints } from "../config/providerMediaConstraints.js";
import { sanitizeLoraDownloadUrl } from "../utils/loraUrl.js";
import { resolveNsfwResolution } from "../utils/nsfwResolution.js";
import { resolveRunpodWebhookUrl } from "../lib/runpodWebhookUrl.js";
import { getPromptTemplateValue } from "./prompt-template-config.service.js";
// dynamicPoll removed — inline polling used directly

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** fal.ai key: official docs use `FAL_KEY`; this repo historically used `FAL_API_KEY` — accept both. */
const RESOLVED_FAL_KEY = (process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
const FAL_API_URL = "https://queue.fal.run";

/**
 * Derive the public webhook callback URL for fal.ai webhooks.
 * Uses same env vars as getKieCallbackUrl: CALLBACK_BASE_URL > APP_URL.
 * @param {"training"|"faceswap"} path - webhook sub-path
 * @returns {string|null} Full URL or null if base URL not configured
 */
export function getFalCallbackUrl(path = "training") {
  const base = (
    process.env.CALLBACK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.APP_URL ||
    ""
  ).trim();
  if (!base) return null;
  const clean = base.replace(/\/$/, "");
  const withProtocol = /^https?:\/\//.test(clean) ? clean : `https://${clean}`;
  return `${withProtocol}/api/fal/webhook/${path}`;
}
const FAL_STORAGE_URL = "https://rest.alpha.fal.ai/storage/upload/initiate";
/** fal.ai NSFW image generation endpoint for face reference (e.g. comfy/modelclone/...). If unset, face reference step is skipped. */
const FAL_NSFW_ENDPOINT = process.env.FAL_NSFW_ENDPOINT || "";

// Cache: R2 URL -> fal.ai storage URL (avoids re-uploading same LoRA)
const falStorageCache = new Map();

/** @returns {boolean} Whether fal.ai queue calls can authenticate */
export function isFalConfigured() {
  return Boolean(RESOLVED_FAL_KEY);
}

if (!RESOLVED_FAL_KEY) {
  console.warn("⚠️ FAL_API_KEY / FAL_KEY not set - LoRA training and fal queue calls will not work");
}

/**
 * Generate a trigger word for LoRA based on model name
 * Format: lora_[modelname] (sanitized, lowercase, no spaces)
 * @param {string} modelName - Name of the model
 * @returns {string} Trigger word
 */
export function generateTriggerWord(modelName) {
  // Sanitize model name: lowercase, remove special chars, replace spaces with underscores
  const sanitized = modelName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove special characters
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .substring(0, 20); // Limit length

  return `lora_${sanitized}`;
}

/**
 * Map saved model gender (e.g. aiGenerationParams.gender) to the caption class word after the trigger.
 * @returns {"woman"|"girl"|"man"|"boy"|"person"|null} null = infer from image in captions
 */
export function normalizeCaptionSubjectClass(genderRaw) {
  const g = String(genderRaw ?? "").trim().toLowerCase();
  if (!g) return null;
  if (/\btrans\s*woman\b/.test(g)) return "woman";
  if (/\btrans\s*man\b/.test(g)) return "man";
  if (/\b(boy|young boy|teen boy)\b/.test(g) || g === "boy") return "boy";
  if (/\b(girl|young girl|teen girl)\b/.test(g) || g === "girl") return "girl";
  if (/\b(man|male|guy|masculine|he\s*\/\s*him|masc)\b/.test(g) || g === "m" || g === "men") return "man";
  if (/\b(woman|female|lady|feminine|she\s*\/\s*her|femme)\b/.test(g) || g === "f" || g === "women") return "woman";
  if (/\b(non-?binary|nonbinary|enby|\bnb\b|genderfluid|agender|neutral|other)\b/.test(g)) return "person";
  return null;
}

/** @param {string} textAfterClass - phrase after "class, " */
function captionExampleLine(triggerWord, lockedClass, fallbackClass, textAfterClass) {
  const cls = lockedClass || fallbackClass;
  return `${triggerWord} ${cls}, ${textAfterClass}`;
}

function buildCaptionSystemPrompt(triggerWord, captionSubjectClass) {
  const genderLock = captionSubjectClass
    ? `MODEL SUBJECT CLASS (required — do not override from the image): This LoRA is configured for "${captionSubjectClass}". EVERY caption MUST begin with exactly "${triggerWord} ${captionSubjectClass}" (trigger, one space, then only that class word — no adjectives between). Never use woman/girl for a male-configured model or man/boy for a female-configured model. If a photo looks ambiguous, still use "${captionSubjectClass}" for dataset consistency.\n\n`
    : "";

  const rule1 = captionSubjectClass
    ? `1. Start EVERY caption with exactly "${triggerWord} ${captionSubjectClass}" — the subject class is fixed by model settings (see MODEL SUBJECT CLASS above). Do NOT add adjectives before "${captionSubjectClass}".`
    : `1. Start EVERY caption with exactly "${triggerWord}" (the unique token) followed immediately by a simple class word like woman, girl, person, man, character, or subject — choose the most accurate neutral class for the image. Do NOT add adjectives before the class word (no "beautiful woman", "young Asian woman", etc. — identity must bind to the trigger only). Example: "${triggerWord} woman" or "${triggerWord} person".`;

  const lc = captionSubjectClass;
  const examples = [
    captionExampleLine(triggerWord, lc, "woman", "long wavy blonde hair, smiling warmly, wearing a blue summer dress, standing in a crowded city street, sunny daylight, natural candid photography, high quality."),
    captionExampleLine(triggerWord, lc, "person", "sitting on floor with knees up, casual hoodie and shorts, thoughtful expression looking at camera, messy apartment background, soft window light, realistic smartphone snapshot."),
    captionExampleLine(triggerWord, lc, "girl", "lying on bed propped on elbows, playful smirk, nude under sheet covering chest, bedroom at night with phone flash, raw amateur photo style."),
    captionExampleLine(triggerWord, lc, "woman", "sitting cross-legged on bed, wearing oversized t-shirt, playful smile, messy bedroom background, warm indoor lighting, candid photo."),
    captionExampleLine(triggerWord, lc, "person", "standing side profile, arms crossed, casual jeans and hoodie, urban street at dusk, natural light."),
    captionExampleLine(triggerWord, lc, "girl", "lying on couch, relaxed expression, blanket over legs, cozy living room."),
  ].join("\n");

  return `You are an expert image captioner for Z-Image Turbo LoRA training datasets.

${genderLock}RULES:
${rule1}
2. Describe EVERYTHING visible EXCEPT the subject's permanent identity features the LoRA must learn from the trigger word alone. Do NOT describe: overall face shape, specific nose shape/size, eye shape (e.g. almond, round), eye color if it is a core trained trait, bone structure, jawline, cheekbones, ethnicity indicators when fixed for this character (unless variability is intended). If hair color/style is identical across the dataset, describe sparingly or omit after early captions so the trigger stays strong.
3. DO describe, in order of importance: pose and body position; camera angle and framing (close-up, half-body, full-body, etc.); clothing and accessories; hair style and color when it varies across images; expression, mood, and emotion; background and environment details; lighting type and quality; overall image style or quality when visible (e.g. candid photo, smartphone snapshot, natural lighting, soft shadows, 35mm film look). Be selective with quality tags — avoid "masterpiece", "8k", "ultra detailed", "hyperrealistic" unless they clearly match the image; Turbo already handles realism.
4. Use natural language in 1–2 concise sentences OR a compact comma-separated phrase list (both work; consistency across the dataset matters more than style). Aim for 15–40 words total. No bullet points, no line breaks, no JSON.
5. Be strictly accurate — describe ONLY what is actually visible. Do not invent or assume.
6. Prioritize dataset VARIATIONS: describe changing elements (poses, outfits, angles, lighting) more than constants. Do not repeat the same fixed details in every caption.
7. Maintain consistent terminology, phrasing, and structure across ALL captions (same order when possible: pose → clothing → expression → background → style) for training stability.
8. Keep captions punchy and focused — avoid redundancy or verbosity.

EXAMPLE OUTPUTS:
${examples}`;
}

/**
 * If the model has a fixed subject class, normalize "trigger wrongClass, ..." to "trigger subjectClass, ...".
 */
function enforceCaptionSubjectClass(caption, triggerWord, subjectClass) {
  if (!subjectClass || !caption?.trim()) return caption;
  const t = triggerWord.trim();
  let s = caption.trim();
  if (!s.toLowerCase().startsWith(t.toLowerCase())) {
    s = `${t} ${s}`;
  }
  let after = s.slice(t.length).trim();
  const classRe = /^(woman|girl|man|boy|person|character|subject)\s*,?\s*/i;
  after = after.replace(classRe, "").trim();
  const out = `${t} ${subjectClass}, ${after}`.trim();
  return out.replace(/,\s*$/, "");
}

/** Last-resort caption so every training image has a .txt file (training never blocks on one bad API call). */
function buildFallbackCaption(triggerWord, captionSubjectClass, index) {
  const t = triggerWord.trim();
  const cls = captionSubjectClass || "person";
  return `${t} ${cls}, training dataset image ${index + 1}, varied pose framing clothing and background, identity bound to trigger token, natural lighting, candid photo style.`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download image bytes for captioning with aggressive retries (no single short timeout).
 */
async function fetchTrainingImageForCaption(imageUrl, index) {
  const MAX_FETCH_ATTEMPTS = 10;
  const TIMEOUT_PER_ATTEMPT_MS = 120_000;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const imgResponse = await fetch(imageUrl, {
        signal: AbortSignal.timeout(TIMEOUT_PER_ATTEMPT_MS),
      });
      if (!imgResponse.ok) {
        throw new Error(`Image fetch failed: ${imgResponse.status}`);
      }
      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
      if (!imgBuffer.length) throw new Error("empty image body");
      const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
      const b64 = imgBuffer.toString("base64");
      return { b64, contentType };
    } catch (imgErr) {
      lastErr = imgErr;
      if (attempt < MAX_FETCH_ATTEMPTS) {
        const delay = 2000 * Math.pow(2, Math.min(attempt - 1, 6));
        console.warn(
          `  ⚠️ Image fetch attempt ${attempt}/${MAX_FETCH_ATTEMPTS} failed for caption ${index + 1} (${imgErr.message}). Retrying in ${delay / 1000}s…`,
        );
        await sleep(delay);
      }
    }
  }
  throw lastErr || new Error("Image fetch failed");
}

/**
 * Caption a single training image using Grok vision (xAI API).
 * Follows Z-Image LoRA training captioning best practices:
 * - Starts with trigger word
 * - Describes everything EXCEPT the core subject identity
 * - Labels backgrounds, lighting, clothing, camera angles, pose
 * - Uses natural language (1-2 sentences)
 * @param {string|null} [captionSubjectClass] - from model gender; locks woman/man/girl/boy/person after trigger
 */
async function captionSingleImage(imageUrl, triggerWord, index, captionSubjectClass = null) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    console.warn(`⚠️ OPENROUTER_API_KEY not set — skipping caption for image ${index + 1}`);
    return null;
  }

  let b64;
  let contentType;
  try {
    ({ b64, contentType } = await fetchTrainingImageForCaption(imageUrl, index));
  } catch (imgErr) {
    console.error(
      `  ⚠️ Caption image ${index + 1}: could not fetch after retries: ${imgErr.message}`,
    );
    return null;
  }

  const { default: OpenAI } = await import("openai");
  const grok = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    maxRetries: 0,
  });

  const MAX_ATTEMPTS = 10;
  const BASE_DELAY_MS = 2_500;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const baseSystemPrompt = buildCaptionSystemPrompt(triggerWord, captionSubjectClass);
      const systemPrompt = await getPromptTemplateValue("falCaptionSystemPrompt", baseSystemPrompt);
      const completion = await grok.chat.completions.create({
        model: "x-ai/grok-4.1-fast",
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Caption this training image following the rules exactly. Output ONLY the caption text, nothing else." },
              { type: "image_url", image_url: { url: `data:${contentType};base64,${b64}` } },
            ],
          },
        ],
      }, { signal: AbortSignal.timeout(60_000) });

      const caption = (completion.choices?.[0]?.message?.content || "").trim();
      if (!caption) {
        if (attempt < MAX_ATTEMPTS) {
          const delay = BASE_DELAY_MS * Math.pow(2, Math.min(attempt - 1, 5));
          console.warn(
            `  ⚠️ Empty caption for image ${index + 1}, attempt ${attempt}/${MAX_ATTEMPTS}. Retrying in ${delay / 1000}s…`,
          );
          await sleep(delay);
          continue;
        }
        return null;
      }

      let finalCaption = caption.startsWith(triggerWord) ? caption : `${triggerWord} ${caption}`;
      if (captionSubjectClass) {
        finalCaption = enforceCaptionSubjectClass(finalCaption, triggerWord, captionSubjectClass);
      }
      console.log(`  📝 Caption ${index + 1}: ${finalCaption.substring(0, 80)}...`);
      return finalCaption;
    } catch (error) {
      const msg = error.message || "";
      const status = error.status ?? error.response?.status ?? 0;

      const isTransient =
        status === 408 ||
        status === 429 ||
        status >= 500 ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504") ||
        msg.toLowerCase().includes("provider returned error") ||
        msg.toLowerCase().includes("bad gateway") ||
        msg.toLowerCase().includes("timeout") ||
        msg.toLowerCase().includes("timed out") ||
        msg.toLowerCase().includes("econnreset") ||
        msg.toLowerCase().includes("econnrefused") ||
        msg.toLowerCase().includes("etimedout") ||
        msg.toLowerCase().includes("socket hang up") ||
        msg.toLowerCase().includes("rate limit");

      if (isTransient && attempt < MAX_ATTEMPTS) {
        const delay =
          status === 429
            ? Math.min(90_000, BASE_DELAY_MS * Math.pow(2, attempt))
            : BASE_DELAY_MS * Math.pow(2, Math.min(attempt - 1, 6));
        console.warn(
          `  ⚠️ Caption attempt ${attempt}/${MAX_ATTEMPTS} failed for image ${index + 1} (${msg.slice(0, 80)}). Retrying in ${delay / 1000}s…`,
        );
        await sleep(delay);
        continue;
      }

      console.error(
        `  ⚠️ Caption failed for image ${index + 1} after ${attempt} attempt(s): ${msg.slice(0, 120)}`,
      );
      return null;
    }
  }

  return null;
}

/**
 * Caption all training images in parallel batches, with extra rounds for misses and fallbacks.
 * Returns caption strings for every index (fallback used only if vision API never succeeds).
 */
async function captionAllTrainingImages(imageUrls, triggerWord, captionSubjectClass = null) {
  console.log(`\n📝 ============================================`);
  console.log(`📝 CAPTIONING ${imageUrls.length} TRAINING IMAGES`);
  console.log(`📝 Trigger word: ${triggerWord}`);
  if (captionSubjectClass) {
    console.log(`📝 Locked subject class (from model gender): ${captionSubjectClass}`);
  }
  console.log(`📝 ============================================`);

  const BATCH_SIZE = 4;
  const results = new Array(imageUrls.length).fill(null);

  for (let batch = 0; batch < imageUrls.length; batch += BATCH_SIZE) {
    const slice = imageUrls.slice(batch, batch + BATCH_SIZE);
    const batchPromises = slice.map((url, i) =>
      captionSingleImage(url, triggerWord, batch + i, captionSubjectClass),
    );
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((caption, i) => {
      results[batch + i] = caption;
    });
    console.log(
      `  ✅ Batch ${Math.floor(batch / BATCH_SIZE) + 1} done (${Math.min(batch + BATCH_SIZE, imageUrls.length)}/${imageUrls.length})`,
    );

    if (batch + BATCH_SIZE < imageUrls.length) {
      await sleep(1000);
    }
  }

  const MAX_EXTRA_ROUNDS = 8;
  for (let round = 0; round < MAX_EXTRA_ROUNDS; round++) {
    const missing = results
      .map((c, i) => (c == null ? i : -1))
      .filter((i) => i >= 0);
    if (missing.length === 0) break;
    console.log(
      `📝 Caption retry round ${round + 1}/${MAX_EXTRA_ROUNDS}: ${missing.length} image(s) still without caption`,
    );
    for (const idx of missing) {
      const c = await captionSingleImage(
        imageUrls[idx],
        triggerWord,
        idx,
        captionSubjectClass,
      );
      results[idx] = c;
      await sleep(500);
    }
  }

  let fallbackUsed = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i] == null) {
      results[i] = buildFallbackCaption(triggerWord, captionSubjectClass, i);
      fallbackUsed += 1;
      console.warn(`  📝 Image ${i + 1}: using fallback caption after all retries`);
    }
  }

  const captionedCount = results.filter(Boolean).length;
  console.log(
    `📝 Caption pass complete: ${captionedCount}/${imageUrls.length} images (${fallbackUsed} fallback)`,
  );

  return results;
}

/**
 * Create a ZIP file from image URLs for LoRA training
 * fal.ai requires images in a ZIP file
 * Now includes .txt caption files alongside each image when captions are provided
 * @param {string[]} imageUrls - Array of image URLs
 * @param {(string|null)[]} [captions] - Optional array of captions (same length as imageUrls)
 * @returns {Promise<Buffer>} ZIP file buffer
 */
function detectImageFormat(buffer) {
  const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer);
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  if (bytes.length >= 12) {
    const heicSignatures = [0x66, 0x74, 0x79, 0x70];
    if (bytes[4] === heicSignatures[0] && bytes[5] === heicSignatures[1] &&
        bytes[6] === heicSignatures[2] && bytes[7] === heicSignatures[3]) return "heic";
  }
  return null;
}

async function createTrainingZip(imageUrls, captions = []) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const hasCaptions = captions.length > 0 && captions.some(Boolean);
  console.log(`📦 Creating training ZIP with ${imageUrls.length} images${hasCaptions ? " + captions" : ""}...`);

  for (let i = 0; i < imageUrls.length; i++) {
    const MAX_FETCH_ATTEMPTS = 8;
    let lastErr;
    let added = false;
    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(imageUrls[i], { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) throw new Error(`empty response (0 bytes)`);

        const detectedFormat = detectImageFormat(buffer);
        const allowed = ["jpg", "png", "webp"];
        if (!detectedFormat || !allowed.includes(detectedFormat)) {
          throw new Error(
            `unsupported format: ${detectedFormat || "unknown"} — use JPEG, PNG, or WebP`,
          );
        }

        const baseName = `image_${String(i + 1).padStart(2, "0")}`;
        zip.file(`${baseName}.${detectedFormat}`, buffer);
        if (captions[i]) zip.file(`${baseName}.txt`, captions[i]);

        console.log(`  ✓ Added image ${i + 1}/${imageUrls.length} (${detectedFormat}, ${(buffer.byteLength / 1024).toFixed(0)}KB)${captions[i] ? " + caption" : ""}`);
        added = true;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_FETCH_ATTEMPTS) {
          console.warn(`  ⚠️ Image ${i + 1} attempt ${attempt} failed (${err.message}), retrying…`);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
    }
    if (!added) {
      console.error(`  ✗ Failed to add image ${i + 1}:`, lastErr?.message);
      throw lastErr;
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  console.log(
    `✅ ZIP created: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`,
  );

  return zipBuffer;
}

/**
 * Upload ZIP to a temporary URL for fal.ai
 * Uses R2 for storage
 * @param {Buffer} zipBuffer - ZIP file buffer
 * @returns {Promise<string>} Public URL to the ZIP file
 */
async function uploadZipForTraining(zipBuffer) {
  if (!isVercelBlobConfigured() && !isR2Configured()) {
    throw new Error("Blob or R2 storage required for LoRA training");
  }

  const url = await uploadBufferToBlobOrR2(
    zipBuffer,
    "lora-training",
    "zip",
    "application/zip",
  );
  console.log(`✅ Training ZIP uploaded: ${url}`);
  return url;
}

/**
 * Submit LoRA training job to fal.ai
 * @param {string} imagesZipUrl - URL to ZIP file with training images
 * @param {string} triggerWord - Trigger word for the LoRA
 * @param {object} options - Training options
 * @returns {Promise<{requestId: string}>} Request ID for polling
 */
export async function submitLoraTraining(
  imagesZipUrl,
  triggerWord,
  options = {},
) {
  if (!RESOLVED_FAL_KEY) {
    throw new Error("FAL_API_KEY or FAL_KEY not configured");
  }

  console.log("\n🎓 ============================================");
  console.log("🎓 FAL.AI LORA TRAINING - SUBMIT");
  console.log("🎓 ============================================");
  console.log(`📦 Images ZIP: ${imagesZipUrl}`);
  console.log(`🔑 Trigger Word: ${triggerWord}`);
  console.log(`⚙️ Options:`, options);

  const requestBody = {
    image_data_url: imagesZipUrl,
    steps: options.steps || 6000,
    default_caption: triggerWord,
    learning_rate: options.learningRate || 0.0005,
  };
  if (options.webhookUrl) {
    requestBody.webhook_url = options.webhookUrl;
    console.log(`🔔 Training webhook URL: ${options.webhookUrl}`);
  }

  try {
    const response = await fetch(
      `${FAL_API_URL}/fal-ai/z-image-turbo-trainer-v2`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${RESOLVED_FAL_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `❌ fal.ai submission failed: ${response.status}`,
        errorText,
      );
      throw new Error(`Generation service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const requestId = result.request_id ?? result.requestId;
    if (!requestId) {
      console.error("❌ fal queue submit: unexpected response (no request_id):", JSON.stringify(result));
      throw new Error(
        "fal.ai queue did not return request_id — check FAL_KEY/FAL_API_KEY and https://queue.fal.run/fal-ai/z-image-turbo-trainer-v2",
      );
    }
    console.log(`✅ Training submitted! Request ID: ${requestId}`);

    return {
      requestId,
      statusUrl:
        result.status_url ||
        `${FAL_API_URL}/fal-ai/z-image-turbo-trainer-v2/requests/${requestId}/status`,
    };
  } catch (error) {
    console.error("❌ fal.ai submission error:", error.message);
    throw error;
  }
}

/**
 * Check status of LoRA training job
 * @param {string} requestId - Request ID from submission
 * @returns {Promise<{status: string, result?: object, error?: string}>}
 */
export async function checkTrainingStatus(requestId) {
  if (!RESOLVED_FAL_KEY) {
    throw new Error("FAL_API_KEY or FAL_KEY not configured");
  }

  try {
    const response = await fetch(
      `${FAL_API_URL}/fal-ai/z-image-turbo-trainer-v2/requests/${requestId}/status`,
      {
        headers: {
          Authorization: `Key ${RESOLVED_FAL_KEY}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Status check failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    return {
      status: result.status, // "IN_QUEUE", "IN_PROGRESS", "COMPLETED", "FAILED"
      logs: result.logs || [],
    };
  } catch (error) {
    console.error("❌ Status check error:", error.message);
    throw error;
  }
}

/**
 * Get completed training result
 * @param {string} requestId - Request ID from submission
 * @returns {Promise<{loraUrl: string, configUrl?: string}>}
 */
export async function getTrainingResult(requestId) {
  if (!RESOLVED_FAL_KEY) {
    throw new Error("FAL_API_KEY or FAL_KEY not configured");
  }

  try {
    const response = await fetch(
      `${FAL_API_URL}/fal-ai/z-image-turbo-trainer-v2/requests/${requestId}`,
      {
        headers: {
          Authorization: `Key ${RESOLVED_FAL_KEY}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Result fetch failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Extract LoRA file URL from result
    const loraUrl = result.diffusers_lora_file?.url || result.lora_file?.url;
    const configUrl = result.config_file?.url;

    if (!loraUrl) {
      console.error(
        "❌ No LoRA URL in result:",
        JSON.stringify(result, null, 2),
      );
      throw new Error("No LoRA file URL in training result");
    }

    console.log(`✅ Training completed!`);
    console.log(`📦 LoRA URL: ${loraUrl}`);
    if (configUrl) console.log(`⚙️ Config URL: ${configUrl}`);

    return {
      loraUrl,
      configUrl,
      rawResult: result,
    };
  } catch (error) {
    console.error("❌ Result fetch error:", error.message);
    throw error;
  }
}

/**
 * Download LoRA file and upload to R2 for permanent storage
 * fal.ai files are temporary, so we need to store them ourselves
 * @param {string} falLoraUrl - Temporary fal.ai URL
 * @param {string} modelName - Name of the model (for readable filename)
 * @param {number} [downloadTimeoutMs] - Max ms for download (default 90s); use to avoid Vercel 300s limit
 * @returns {Promise<string>} Permanent R2 URL or fal URL on failure
 */
export async function archiveLoraToR2(falLoraUrl, modelName = null, downloadTimeoutMs = 90_000) {
  if (!isR2Configured()) {
    console.warn("⚠️ R2 not configured, returning fal.ai URL (temporary!)");
    return falLoraUrl;
  }

  try {
    console.log(`📥 Downloading LoRA from fal.ai...`);

    const response = await fetch(falLoraUrl, { signal: AbortSignal.timeout(downloadTimeoutMs) });
    if (!response.ok) {
      throw new Error(`Failed to download LoRA: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`📦 LoRA size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Create readable filename: modelname_timestamp.safetensors
    const timestamp = Date.now();
    let filename;
    if (modelName) {
      // Sanitize model name for filename
      const sanitizedName = modelName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_") // Replace non-alphanumeric with underscore
        .replace(/_+/g, "_") // Replace multiple underscores with single
        .replace(/^_|_$/g, "") // Remove leading/trailing underscores
        .substring(0, 30); // Limit length
      filename = `loras/${sanitizedName}_${timestamp}.safetensors`;
    } else {
      // Fallback to random ID if no model name
      const randomId = Math.random().toString(36).substring(2, 10);
      filename = `loras/${timestamp}_${randomId}.safetensors`;
    }

    const r2Url = await uploadToR2(
      buffer,
      filename,
      "application/octet-stream",
    );
    console.log(`✅ LoRA archived to R2: ${r2Url}`);

    return r2Url;
  } catch (error) {
    console.error(`⚠️ Failed to archive LoRA to R2: ${error.message}`);
    return falLoraUrl; // Fallback to temporary URL
  }
}

/**
 * Poll for training completion (no timeout).
 * @param {string} requestId - Request ID from submission
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<{success: boolean, loraUrl?: string, error?: string}>}
 */
export async function waitForTrainingCompletion(
  requestId,
  onProgress = null,
) {
  const pollInterval = 30000; // 30 seconds

  console.log("\n⏳ Waiting for training completion (no timeout)...");

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const status = await checkTrainingStatus(requestId);

      console.log(`  Poll ${attempt} - Status: ${status.status}`);

      if (onProgress) {
        onProgress({
          attempt,
          maxAttempts: null,
          status: status.status,
          logs: status.logs,
        });
      }

      if (status.status === "COMPLETED") {
        const result = await getTrainingResult(requestId);

        // Use fal.ai URL directly - R2 returns 403 for .safetensors files
        console.log(`📦 Using fal.ai LoRA URL directly: ${result.loraUrl}`);

        return {
          success: true,
          loraUrl: result.loraUrl,
          configUrl: result.configUrl,
        };
      }

      if (status.status === "FAILED") {
        return {
          success: false,
          error: "Training failed on fal.ai",
        };
      }

      // Still in progress, wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      console.error(`  Poll ${attempt} error:`, error.message);
      // Continue polling despite errors
    }
  }
}

/**
 * Complete LoRA training workflow
 * 1. Create ZIP from images
 * 2. Upload ZIP to R2
 * 3. Submit training to fal.ai
 * 4. Return request ID for async polling
 *
 * @param {string[]} imageUrls - Array of training image URLs (15 images recommended)
 * @param {string} triggerWord - Trigger word for the LoRA
 * @param {object} options - Training options
 * @param {string|null} [options.captionSubjectClass] - woman | man | girl | boy | person — from model gender; locks caption class after trigger
 * @returns {Promise<{success: boolean, requestId?: string, error?: string}>}
 */
export async function startLoraTraining(imageUrls, triggerWord, options = {}) {
  try {
    const { captionSubjectClass = null } = options;

    console.log("\n🎓 ============================================");
    console.log("🎓 STARTING LORA TRAINING WORKFLOW");
    console.log("🎓 ============================================");
    console.log(`📸 Images: ${imageUrls.length}`);
    console.log(`🔑 Trigger Word: ${triggerWord}`);
    if (captionSubjectClass) {
      console.log(`👤 Caption subject class: ${captionSubjectClass}`);
    }

    // Step 1: Caption all images using Grok vision
    const captions = await captionAllTrainingImages(imageUrls, triggerWord, captionSubjectClass);

    // Step 2: Create ZIP from images + captions
    const zipBuffer = await createTrainingZip(imageUrls, captions);
    const zipMax = falConstraints.zImageTurboTrainerV2.zipMaxBytes;
    if (zipBuffer.length > zipMax) {
      throw new Error(
        `Training ZIP is ${(zipBuffer.length / (1024 * 1024)).toFixed(1)} MB; maximum is ${(zipMax / (1024 * 1024)).toFixed(0)} MB (set PROVIDER_LIMIT_FAL_Z_IMAGE_TRAINER_ZIP_MAX_BYTES to adjust).`,
      );
    }
    const minRec = falConstraints.zImageTurboTrainerV2.minRecommendedImages;
    if (imageUrls.length < minRec) {
      console.warn(
        `⚠️ fal recommends at least ${minRec} training images; got ${imageUrls.length}.`,
      );
    }

    // Step 3: Upload ZIP to R2
    const zipUrl = await uploadZipForTraining(zipBuffer);

    // Step 4: Submit training to fal.ai
    const submission = await submitLoraTraining(zipUrl, triggerWord, options);

    console.log("\n✅ Training submitted successfully!");
    console.log(`📋 Request ID: ${submission.requestId}`);
    console.log("⏳ Training can take a while (no hard timeout).");

    return {
      success: true,
      requestId: submission.requestId,
      statusUrl: submission.statusUrl,
    };
  } catch (error) {
    console.error("❌ LoRA training workflow failed:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

export default {
  generateTriggerWord,
  startLoraTraining,
  submitLoraTraining,
  checkTrainingStatus,
  getTrainingResult,
  archiveLoraToR2,
  waitForTrainingCompletion,
  getFalCallbackUrl,
  submitFaceSwapJob,
};

// ============================================
// NSFW IMAGE GENERATION (Self-hosted ComfyUI on Runpod)
// ============================================

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
// Resolve NSFW endpoint exactly like ModelClone-X:
// RUNPOD_MODELCLONE_X_ENDPOINT_ID -> RUNPOD_ENDPOINT_ID -> RUNPOD_SOULX_ENDPOINT_ID.
// This keeps NSFW and ModelClone-X on the same backend path.
const RUNPOD_ENDPOINT_ID =
  String(
    process.env.RUNPOD_MODELCLONE_X_ENDPOINT_ID ||
    process.env.RUNPOD_ENDPOINT_ID ||
    process.env.RUNPOD_SOULX_ENDPOINT_ID ||
    "",
  ).trim() || null;
const RUNPOD_BASE_URL = RUNPOD_ENDPOINT_ID
  ? `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`
  : null;

if (!RUNPOD_API_KEY) {
  console.warn("⚠️ RUNPOD_API_KEY not set - NSFW generation will not work");
}
if (!RUNPOD_ENDPOINT_ID) {
  console.warn(
    "⚠️ No RunPod NSFW endpoint configured (RUNPOD_ENDPOINT_ID / RUNPOD_MODELCLONE_X_ENDPOINT_ID / RUNPOD_SOULX_ENDPOINT_ID) — NSFW generation will not work",
  );
}

/** Pose / makeup / cum / enhancement additive slots — never exceed this (girl LoRA identity is separate). */
const MAX_ADDITIVE_LORA_STRENGTH = 0.35;

const POSE_LORAS = [
  {
    id: "doggystyle_facing",
    node: "290",
    keywords: [],
  },
  {
    id: "missionary",
    node: "291",
    keywords: [],
  },
  /** Matches workflow slot 293 + HF file "Nsfw Anal Doggystyle" (rear anal / doggy anal — NOT titfuck). */
  {
    id: "anal_doggystyle",
    node: "293",
    keywords: [],
    strength: 0.35,
  },
  {
    id: "handjob",
    node: "294",
    keywords: [],
  },
  {
    id: "missionary_anal",
    node: "295",
    keywords: [],
  },
];

const ENHANCEMENT_LORAS = {
  amateur_nudes: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Amateur_Nudes_2.5_Z-Image-Turbo.safetensors",
    name: "Amateur Nudes",
    strengthRange: [0.25, 0.35],
    defaultStrength: 0.35,
  },
  masturbation: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Masturbation.safetensors",
    name: "Masturbation",
    strengthRange: [0.25, 0.35],
    defaultStrength: 0.35,
  },
  /** bjz LoRA covers all blowjob/oral varieties. Trigger word "bjz" must be in prompt when active. */
  deepthroat: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/bjz.safetensors",
    name: "Deepthroat/Blowjob",
    strengthRange: [0.35, 0.45],
    defaultStrength: 0.45,
    triggerWord: "bjz",
  },
  dildo: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/dildo.safetensors",
    name: "Dildo",
    strengthRange: [0.25, 0.35],
    defaultStrength: 0.35,
  },
  /**
   * Facial / cumshot-on-face LoRA. Trigger word "facial". Optimised for kneeling/lying-down poses
   * where the female subject faces the camera close-up. Produces realistic loads along the face
   * rather than dribbles. Pairs with deepthroat for blowjob-ending-in-cumshot scenes.
   */
  facial: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/ZIMAGE_facials_000003000.safetensors",
    name: "Facial/Cumshot",
    strengthRange: [0.35, 0.45],
    defaultStrength: 0.45,
    triggerWord: "facial",
  },
};

/**
 * Pose / makeup / enhancement / cum HF LoRAs on node 250. Default off — only the trained identity LoRA loads.
 * Set `NSFW_ENABLE_ADDITIVE_LORAS=1` to restore OpenRouter selection + additive stack.
 */
const NSFW_ADDITIVE_LORAS_ENABLED = process.env.NSFW_ENABLE_ADDITIVE_LORAS === "1";

/** When additives are on: keep these enhancement slots at 0 (Amateur Nudes + bjz). */
const DISABLED_ENHANCEMENT_LORA_KEYS = new Set(["amateur_nudes", "deepthroat"]);

function zeroDisabledEnhancementStrengths(strengths) {
  const o = strengths && typeof strengths === "object" ? { ...strengths } : {};
  for (const k of DISABLED_ENHANCEMENT_LORA_KEYS) {
    o[k] = 0;
  }
  return o;
}

/**
 * Identity LoRA only — no additive LoRAs, no AI call.
 * Default strength 0.65; users can override within 0.1–0.9.
 */
function buildGirlOnlyLoraSelection(userLoraStrength) {
  const defaultEnhancements = {};
  for (const key of Object.keys(ENHANCEMENT_LORAS)) defaultEnhancements[key] = 0;
  let girlStrength = 0.65;
  if (userLoraStrength != null && Number.isFinite(Number(userLoraStrength))) {
    const u = Number(userLoraStrength);
    if (u >= 0.1 && u <= 0.9) girlStrength = u;
  }
  return {
    pose: null,
    runningMakeup: false,
    cumEffect: false,
    girlStrength,
    enhancementStrengths: defaultEnhancements,
  };
}

const RUNNING_MAKEUP_NODE = "296";
const CUM_NODE = "303";
const RUNNING_MAKEUP_KEYWORDS = ["running makeup", "smeared makeup", "mascara running", "ruined makeup", "crying makeup", "makeup running", "smeared mascara"];

/** Pose LoRA files (node ids 290–295); applied in POSE_LORAS order, compacted after identity in node 250. */
/** Literal spaces in path — avoid %20 here or encodeURI turns % into %25 → broken %2520 */
const POSE_SLOT_URLS = {
  "290": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Doggystyle facing the camera.safetensors",
  "291": "https://huggingface.co/bigckck/ndmstr/resolve/main/Missionnary.safetensors",
  "293": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Anal Doggystyle.safetensors",
  "294": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_Handjob.safetensors",
  "295": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_POV_Missionary_Anal.safetensors",
};
const LORA_8_RUNNING_MAKEUP_URL = "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_Running_makeup.safetensors";
/** Body / scene cum effect (AI `cum: true`); not the same as `facial` enhancement LoRA. */
const CUM_LORA_URL = "https://huggingface.co/bigckck/ndmstr/resolve/main/cum.safetensors";

/**
 * KSampler exports still list [seed, seed_mode, steps, cfg, ...] in widgets_values even when
 * `seed` is linked (e.g. from rgthree Seed). Without skipping those first two slots, `steps`
 * incorrectly receives the seed int and `cfg` receives "randomize" → destroyed image quality.
 */
function getKsamplerWidgetValuesStartIndex(node, linkMap) {
  if (node.type !== "KSampler" || !Array.isArray(node.inputs)) return 0;
  const seedInp = node.inputs.find((i) => i.name === "seed");
  if (!seedInp || seedInp.link == null || !linkMap[seedInp.link]) return 0;
  const wv = node.widgets_values || [];
  // Standard layout when seed is external: [number, "randomize"|string, steps, cfg, sampler, scheduler, denoise]
  if (wv.length >= 7) return 2;
  if (wv.length >= 5) return 2;
  return 0;
}

/** Second widgets_values slot after numeric seed (Comfy / UltimateSDUpscale UI export). */
const COMFY_SEED_CONTROL_MODES = new Set(["randomize", "fixed", "increment", "decrement"]);

const RGTHREE_FAST_GROUPS_BYPASSER = "Fast Groups Bypasser (rgthree)";

/**
 * Remove rgthree Fast Groups Bypasser nodes from a Comfy UI export and reconnect links.
 * The bypasser passes each input slot through to the same output slot; RunPod images often omit
 * this class in object_info (or use a different display name), which breaks handler validation.
 */
export function removeRgthreeFastGroupsBypasserFromComfyUiGraph(nodes, links) {
  if (!Array.isArray(nodes) || !Array.isArray(links)) return;
  let guard = 0;
  while (guard++ < 256) {
    const idx = nodes.findIndex((n) => n.type === RGTHREE_FAST_GROUPS_BYPASSER);
    if (idx === -1) break;
    const bid = nodes[idx].id;

    const incomingByTargetSlot = new Map();
    for (const link of links) {
      const [, o, os, t, ts] = link;
      if (t === bid) incomingByTargetSlot.set(Number(ts), [o, os]);
    }

    const newLinks = [];
    for (const link of links) {
      const [lid, o, os, t, ts] = link;
      if (o === bid) {
        const src = incomingByTargetSlot.get(Number(os));
        if (src) {
          const row = [lid, src[0], src[1], t, ts];
          if (link.length > 5) row.push(link[5]);
          newLinks.push(row);
        }
      } else if (t === bid) {
        continue;
      } else {
        newLinks.push(link);
      }
    }
    links.splice(0, links.length, ...newLinks);
    nodes.splice(idx, 1);
  }
}

/**
 * Convert ComfyUI UI export (nodes + links) to API prompt format.
 * Links format: [linkId, originNodeId, originSlot, targetNodeId, targetSlot, type]
 * If extra.ue_links is present (Anything Everywhere / cg-use-everywhere), applies those
 * so CLIP/VAE/MODEL get connected to downstream nodes.
 */
/**
 * Node class_types that are UI-only primitives with no Python backend on RunPod.
 * Their single output value must be inlined into consuming nodes.
 */
const PRIMITIVE_CLASS_TYPES = new Set([
  "PrimitiveFloat",
  "PrimitiveInt",
  "Primitive integer [Crystools]",
  "Primitive int [Crystools]",
  // DF_Integer from derfuu_comfyui_moddednodes — may not be installed on RunPod
  "DF_Integer",
]);

export function comfyUiGraphToApiPrompt(nodes, links, extra) {
  const linkMap = {};
  if (Array.isArray(links)) {
    for (const link of links) {
      const [linkId, origNode, origSlot] = link;
      linkMap[linkId] = [String(origNode), Number(origSlot)];
    }
  }
  const nodesById = {};
  for (const node of nodes || []) {
    nodesById[String(node.id)] = node;
  }
  const prompt = {};
  for (const node of nodes || []) {
    const id = String(node.id);
    const inputs = {};
    let widgetIdx = getKsamplerWidgetValuesStartIndex(node, linkMap);
    const wv = node.widgets_values || [];
    for (const inp of node.inputs || []) {
      const name = inp.name;
      if (inp.link != null && linkMap[inp.link]) {
        inputs[name] = linkMap[inp.link];
        // Skip widget slot(s) for this linked input so next widget lines up.
        // KSampler seed: we already skipped indices 0,1 via getKsamplerWidgetValuesStartIndex, so do NOT advance.
        if (inp.widget != null && widgetIdx < wv.length && !(node.type === "KSampler" && inp.name === "seed")) {
          widgetIdx++;
        }
      } else if (inp.widget != null) {
        if (widgetIdx < wv.length) {
          inputs[name] = wv[widgetIdx++];
          // UltimateSDUpscale exports [seed, "randomize"|…, steps, …] like KSampler; only one `seed` API input.
          if (
            node.type === "UltimateSDUpscale" &&
            name === "seed" &&
            widgetIdx < wv.length &&
            typeof wv[widgetIdx] === "string" &&
            COMFY_SEED_CONTROL_MODES.has(wv[widgetIdx])
          ) {
            widgetIdx++;
          }
        }
      }
    }
    // rgthree Seed often exports with inputs: [] — widgets_values still holds the seed (and mode fields).
    if (node.type === "Seed (rgthree)" && (node.inputs || []).length === 0 && Array.isArray(node.widgets_values) && node.widgets_values.length >= 1) {
      inputs.seed = node.widgets_values[0];
    }
    prompt[id] = { class_type: node.type, inputs };
  }
  // Apply ue_links (Anything Everywhere): connect checkpoint 282 MODEL/CLIP/VAE to nodes 8, 21, 28, 42, 45
  const ueLinks = extra?.ue_links;
  if (Array.isArray(ueLinks)) {
    for (const ue of ueLinks) {
      const downstreamId = String(ue.downstream);
      const slot = Number(ue.downstream_slot);
      const upstream = String(ue.upstream);
      const upstreamSlot = Number(ue.upstream_slot);
      const n = nodesById[downstreamId];
      if (n?.inputs && n.inputs[slot]) {
        const inputName = n.inputs[slot].name;
        if (prompt[downstreamId]?.inputs) {
          prompt[downstreamId].inputs[inputName] = [upstream, upstreamSlot];
        }
      }
    }
  }

  // ── Inline primitive nodes ────────────────────────────────────────────────
  // PrimitiveFloat, Crystools integer, DF_Integer, etc. are UI-only graph
  // helpers with no Python class on RunPod.  Their single output value must
  // be inlined directly into every input that references them; then the nodes
  // are deleted from the API prompt.
  const primitiveValues = {};
  for (const [nodeId, node] of Object.entries(prompt)) {
    if (!PRIMITIVE_CLASS_TYPES.has(node.class_type)) continue;
    // Value is the first (and only) widget input — name varies by type.
    const val = Object.values(node.inputs || {})[0];
    if (val !== undefined && val !== null && !Array.isArray(val)) {
      primitiveValues[nodeId] = val;
    }
  }
  if (Object.keys(primitiveValues).length > 0) {
    for (const node of Object.values(prompt)) {
      if (!node.inputs || PRIMITIVE_CLASS_TYPES.has(node.class_type)) continue;
      for (const [key, val] of Object.entries(node.inputs)) {
        if (Array.isArray(val) && val.length >= 2 && primitiveValues[String(val[0])] !== undefined) {
          node.inputs[key] = primitiveValues[String(val[0])];
        }
      }
    }
    for (const nodeId of Object.keys(primitiveValues)) {
      delete prompt[nodeId];
    }
  }

  // ── Remove distributor-only nodes (no outputs → no contribution to graph) ─
  // "Anything Everywhere" (cg-use-everywhere) has already been applied via
  // ue_links above; the node itself is not a real ComfyUI execution node.
  for (const [nodeId, node] of Object.entries(prompt)) {
    if (node.class_type === "Anything Everywhere") {
      delete prompt[nodeId];
    }
  }

  return prompt;
}

let nsfwCoreWorkflowCache = null;

/** Node types not available on RunPod ComfyUI — remove them and inject values into consumers.
 * Allowed on RunPod: civitai_comfy_nodes, ComfyUI-KJNodes, ComfyUI-Manager, ComfyUI-GlifNodes,
 * ComfyUI_Comfyroll_CustomNodes, cg-use-everywhere, ComfyUI-Image-Saver (alexopus), rgthree-comfy,
 * was-node-suite-comfyui, ComfyUI-load-lora-from-url, ComfyUI_LayerStyle_Advance, ComfyUI-JoyCaption, ComfyUI-Easy-Use.
 * We strip: Crystools (257), String Literal (41,56), Fast Groups Bypasser (61), PrimitiveFloat (298,290-296).
 */
const UNSUPPORTED_NODE_IDS = [
  "257", "41", "56", "61",
  "298", "290", "291", "292", "293", "294", "295", "296",
  // Primitive wrappers (PrimitiveFloat / Crystools integer) inlined by comfyUiGraphToApiPrompt;
  // listed here as a safety net for the NSFW_COMFY_STRIP_UNSUPPORTED path.
  "305", "306", "311",
  // DF_Integer aspect helpers (derfuu_comfyui_moddednodes) — inlined by converter
  "302", "303",
];

/**
 * Replace every API input wired as [stringLiteralNodeId, slot] with the resolved string.
 * Comfy UI exports String Literal nodes (e.g. 41, 56) as separate nodes; RunPod must not execute them.
 * Inlining only `inputs.text` misses other rare links to the same literals.
 */
export function inlineStringLiteralRefsInApiWorkflow(apiWorkflow, resolvedByNodeId) {
  const replaceRef = (v) => {
    if (!Array.isArray(v) || v.length < 2) return v;
    const srcId = String(v[0]);
    if (Object.prototype.hasOwnProperty.call(resolvedByNodeId, srcId)) {
      return resolvedByNodeId[srcId];
    }
    return v;
  };
  for (const node of Object.values(apiWorkflow)) {
    if (!node?.inputs) continue;
    for (const key of Object.keys(node.inputs)) {
      node.inputs[key] = replaceRef(node.inputs[key]);
    }
  }
}

/**
 * Remove unsupported nodes (String Literal, Primitive string, Fast Groups Bypasser, Crystools, PrimitiveFloat) and
 * inject their values directly into any node that referenced them.
 */
function stripUnsupportedNodesAndInjectValues(workflow, { prompt, negativePrompt, loraUrl, activeLorasCount = 1, loraGirlStrength = 0.6, loraAdditive1Strength = 0, loraAdditive2Strength = 0 }) {
  const safeLora = sanitizeLoraDownloadUrl(loraUrl);
  const replacements = {
    "41": negativePrompt,
    "56": prompt,
    "257": safeLora,
    "311": activeLorasCount,
    "298": loraGirlStrength,
    "305": loraAdditive1Strength,
    "306": loraAdditive2Strength,
  };
  for (const nodeId of UNSUPPORTED_NODE_IDS) {
    delete workflow[nodeId];
  }
  for (const node of Object.values(workflow)) {
    if (!node.inputs) continue;
    for (const key of Object.keys(node.inputs)) {
      const v = node.inputs[key];
      if (Array.isArray(v) && v.length >= 2 && replacements[String(v[0])] !== undefined) {
        node.inputs[key] = replacements[String(v[0])];
      }
    }
  }
  return workflow;
}

function loadNsfwCoreWorkflowApi() {
  const candidates = [
    path.join(process.cwd(), "attached_assets", "nsfw_core_workflow.json"),
    path.join(__dirname, "..", "..", "attached_assets", "nsfw_core_workflow.json"),
  ];
  if (!nsfwCoreWorkflowCache) {
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, "utf8");
          const data = JSON.parse(raw);
          removeRgthreeFastGroupsBypasserFromComfyUiGraph(data.nodes, data.links);
          nsfwCoreWorkflowCache = comfyUiGraphToApiPrompt(data.nodes, data.links, data.extra);
          break;
        }
      } catch (e) {
        console.warn("NSFW core workflow load failed:", p, e?.message);
      }
    }
  }
  if (!nsfwCoreWorkflowCache) return null;
  return JSON.parse(JSON.stringify(nsfwCoreWorkflowCache));
}

/**
 * Load raw workflow graph (nodes + links + extra) without conversion
 */
function loadNsfwCoreWorkflowGraph() {
  const candidates = [
    path.join(process.cwd(), "attached_assets", "nsfw_core_workflow.json"),
    path.join(__dirname, "..", "..", "attached_assets", "nsfw_core_workflow.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn("NSFW core workflow load failed:", p, e?.message);
    }
  }
  return null;
}

// ─── Pro workflow (SeedVR2 upscaler + film grain) ────────────────────────────

let _nsfwProApiCache = null; // Reset whenever nsfw_pro_api.json is updated on disk.
function loadNsfwProWorkflow() {
  if (_nsfwProApiCache) return JSON.parse(JSON.stringify(_nsfwProApiCache));
  const candidates = [
    path.join(process.cwd(), "runpod-mdcln", "workflows", "nsfw_pro_api.json"),
    path.join(__dirname, "..", "..", "runpod-mdcln", "workflows", "nsfw_pro_api.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        _nsfwProApiCache = JSON.parse(fs.readFileSync(p, "utf8"));
        console.log("[Pro workflow] Loaded nsfw_pro_api.json from:", p);
        return JSON.parse(JSON.stringify(_nsfwProApiCache));
      }
    } catch (e) {
      console.warn("[Pro workflow] Load failed:", p, e?.message);
    }
  }
  return null;
}

/**
 * Build a ComfyUI API workflow using the new Pro pipeline:
 *   UNet → LoRA chain → KSampler (20 steps, beta scheduler) → VAEDecode
 *   → Film Grain → Blur → SaveImage (node 289)
 *
 * NOTE: NSFW now always bypasses SeedVR2 upscaling so generations return
 * directly from the base decode + post-processing chain.
 */
function buildComfyWorkflowPro(params) {
  const {
    prompt,
    loraUrl,
    girlLoraStrength,
    postProcessing = {},
    seed,
    width = 1344,
    height = 768,
    aspectRatio = "16:9 landscape 1344x768",
    steps,
    cfg,
    negativePrompt: explicitNegativePrompt,
    useWorkflowPostProcessing = false,
  } = params;

  const wf = loadNsfwProWorkflow();
  if (!wf) {
    console.warn("[Pro workflow] nsfw_pro_api.json not found — falling back to core workflow");
    return null;
  }

  // ── LoRA (node 363 = LoadLoraFromUrlOrPath, node 364 = CR Apply LoRA Stack) ─
  // Single slot: girl identity LoRA URL fed through the URL stack into KSampler.
  if (wf["363"]) {
    const strength = Math.min(1, Math.max(0, Number(girlLoraStrength) || 0.6));
    wf["363"].inputs.num_loras = 1;
    wf["363"].inputs.lora_1_url = loraUrl ?? "";
    wf["363"].inputs.lora_1_strength = strength;
  }

  // ── Aspect ratio (node 50) ──────────────────────────────────────────────────
  if (wf["50"]) {
    wf["50"].inputs.width = Number(width) || 1344;
    wf["50"].inputs.height = Number(height) || 768;
    wf["50"].inputs.aspect_ratio = aspectRatio;
    wf["50"].inputs.swap_dimensions = "Off";
  }

  // ── Sampler (node 276) ──────────────────────────────────────────────────────
  if (wf["276"]) {
    if (steps != null && Number.isFinite(Number(steps))) {
      wf["276"].inputs.steps = Math.min(150, Math.max(1, Math.round(Number(steps))));
    }
    if (cfg != null && Number.isFinite(Number(cfg))) {
      wf["276"].inputs.cfg = Number(cfg);
    }
  }

  // ── Seed (node 57) ─────────────────────────────────────────────────────────
  if (seed != null && wf["57"]) {
    wf["57"].inputs.seed = seed;
  }

  // ── Prompts ─────────────────────────────────────────────────────────────────
  let negText = wf["41"]?.inputs?.string ?? DEFAULT_NSFW_NEGATIVE_PROMPT;
  if (explicitNegativePrompt != null && String(explicitNegativePrompt).trim() !== "") {
    negText = String(explicitNegativePrompt).trim();
  }
  if (isOralBlowjobScenePrompt(prompt) && !/\bdisembodied penis\b/i.test(negText)) {
    negText = `${negText}, ${NSFW_NEG_ORAL_DISCONNECTED_PHALLUS}`;
  }
  const posText = prompt || "";

  // Inline String Literal refs then remove those nodes
  inlineStringLiteralRefsInApiWorkflow(wf, { 41: negText, 56: posText });
  delete wf["41"];
  delete wf["56"];

  // ── Post-processing (blur / grain) ──────────────────────────────────────────
  if (useWorkflowPostProcessing) {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const blurEnabled  = postProcessing?.blur?.enabled  !== false;
    const grainEnabled = postProcessing?.grain?.enabled !== false;
    const blurStrength  = clamp(Number(postProcessing?.blur?.strength)  ?? 1.0, 0, 1);
    const grainStrength = clamp(Number(postProcessing?.grain?.strength) ?? 1.0, 0, 1);
    if (wf["284"]) {
      wf["284"].inputs.density   = grainEnabled ? Math.max(0.01, +(0.06 * grainStrength).toFixed(4)) : 0.01;
      wf["284"].inputs.intensity = grainEnabled ? Math.max(0.01, +(0.1  * grainStrength).toFixed(4)) : 0.01;
    }
    if (wf["286"]) {
      wf["286"].inputs.blur_radius = blurEnabled ? Math.max(1, Math.round(2 * blurStrength)) : 1;
      wf["286"].inputs.sigma       = blurEnabled ? Math.max(0.1, +(0.3 * blurStrength).toFixed(3)) : 0.1;
    }
  }

  // Guarantee SeedVR2 is not present (guard for stale cache).
  if (wf["284"]) wf["284"].inputs.image = ["25", 0];
  delete wf["359"];
  delete wf["360"];
  delete wf["361"];
  delete wf["362"];
  delete wf["369"];
  // LoadLoraFromUrlOrPath (363) + CR Apply LoRA Stack (364) are the correct nodes.
  // Node 364 must stay — KSampler model wires through it.

  return wf;
}

const CUM_KEYWORDS = ["cum on", "cum dripping", "cum facial", "covered in cum", "cum shot", "cumshot", "creampie", "cum on face", "cum on tits", "cum on stomach", "cum on ass", "cum on thighs", "cum on back", "cum on breasts", "cum on chest", "facial cum", "messy cum", "dripping cum", "cum load"];

/**
 * Detect if cum effect LoRA should be activated
 */
function detectCumEffect(promptText) {
  const lower = promptText.toLowerCase();
  return CUM_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Unified AI-powered LoRA selector using Grok 3 Mini.
 * Receives the FULL generation context: chips selected, final prompt, attributes, composition.
 * Makes ALL LoRA decisions in one pass: girl strength, pose, enhancements, effects.
 *
 * @param {Object} context - Full generation context
 * @param {string} context.finalPrompt - The AI-generated/enhanced prompt text
 * @param {string} context.sceneDescription - Original user scene description
 * @param {string} context.attributes - Comma-separated attribute string from chips
 * @param {Object} context.chipSelections - Structured chip selections (outfit, bodyPose, expression, etc.)
 * @param {number|null} context.userLoraStrength - User-overridden LoRA strength (null if not overridden)
 */
async function detectLorasWithAI(context) {
  const {
    finalPrompt = "",
    sceneDescription = "",
    attributes = "",
    chipSelections = {},
    userLoraStrength = null,
    quickFlow = false,
  } = typeof context === "string" ? { finalPrompt: context, sceneDescription: context } : context;

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const defaultEnhancements = {};
  for (const key of Object.keys(ENHANCEMENT_LORAS)) { defaultEnhancements[key] = 0; }
  const defaultGirlStrength = quickFlow ? 0.65 : 0.70;
  const fallback = { pose: null, runningMakeup: false, cumEffect: false, girlStrength: defaultGirlStrength, enhancementStrengths: defaultEnhancements };

  const combinedText = `${finalPrompt} ${sceneDescription} ${attributes}`.trim();
  if (!OPENROUTER_API_KEY || !combinedText) {
    console.log("⚠️ No OPENROUTER_API_KEY or empty context, skipping AI LoRA selection");
    return fallback;
  }

  const chipSummary = Object.entries(chipSelections)
    .filter(([, v]) => v && typeof v === "string" && v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const poseList = POSE_LORAS.map(p => `- "${p.id}": ${getPoseDescription(p.id)}`).join("\n");

  const maxGirl = quickFlow ? 0.65 : 0.80;
  const girlStrengthSection = userLoraStrength
    ? `GIRL IDENTITY LORA STRENGTH: User has manually set this to ${userLoraStrength}. Use this exact value.`
    : quickFlow
      ? `GIRL IDENTITY LORA STRENGTH (0.55 to 0.65, MAX 0.65):
This is the Quick flow: use a value between 0.55 and 0.65. Lower values prevent face mutations.
- 0.65: Face clearly visible (selfies, POV, mirror selfies, close-up) — maximum allowed in Quick flow
- 0.60: Face visible (medium shots, casual poses)
- 0.55: Face partially visible or at distance
IMPORTANT: NEVER exceed 0.65 in this flow. When in doubt, use 0.60 or 0.65.`
      : `GIRL IDENTITY LORA STRENGTH (0.65 to 0.80):
This controls how strongly the girl's trained face/body features are applied. Lower values prevent face mutations.
- 0.80: Face is the main focus (selfies, portraits, close-up face shots, headshots)
- 0.75: Face clearly visible and important (POV shots, looking at camera, mirror selfies)
- 0.70: Face visible but not the main focus (medium shots, casual poses, standing, sitting)
- 0.65: Face partially visible or at distance (full body shots, from behind but looking back, lying down, face barely visible)
IMPORTANT: When in doubt, use 0.70. Too high causes face distortion/mutations. MINIMUM is 0.65.`;

  let systemPrompt = `You are a LoRA selector for AI image generation. You receive the FULL generation context and make ALL LoRA decisions in one pass.

CONTEXT PROVIDED:
- Scene Description (user's original idea): "${sceneDescription}"
- Chip Selections (UI toggles the user picked): ${chipSummary || "none"}
- Final Prompt (AI-enhanced text that will be sent to the model): "${finalPrompt}"

Your job: Analyze ALL of the above together to determine the best LoRA configuration.

AVAILABLE POSE LORAS (pick EXACTLY ONE or "none"):
${poseList}

RULES FOR POSE SELECTION:
- CRITICAL: If the prompt contains "missionary sex" OR ("missionary" AND ("penis" OR "penetrating" OR "pussy" OR "labia" OR "shaft" OR "intercourse")) you MUST set pose to "missionary" (vaginal missionary), NOT "none".
- If the prompt describes anal sex in doggy / rear entry (anal + doggy / from behind), use pose "anal_doggystyle".
- ONLY select a pose if the scene EXPLICITLY shows that EXACT sex position being performed
- "bent over" alone is NOT doggystyle - it must explicitly describe doggy style sex
- "from behind" alone is NOT anal - there must be explicit anal penetration
- "kneeling" is NOT any pose - it's just a body position (kneeling + blowjob = pose "none")
- "lying in bed" is NOT missionary - there must be explicit missionary sex OR missionary + penetration words
- If the prompt describes oral sex (blowjob, deepthroat, mouth on penis, penis in mouth), select "none" for pose ALWAYS — even if it says one hand on shaft (normal for POV blowjob). NEVER select "handjob" for those scenes — handjob pose + oral text causes duplicate penis mutations.
- If unsure, select "none" - it's better to have no pose LoRA than the wrong one

ENHANCEMENT LORAS (each can be independently activated):
- "amateur_nudes" and "deepthroat": ALWAYS 0 — permanently disabled on the server (keep both keys in JSON at 0).
- "masturbation": Solo masturbation scenes. Activate for: masturbating, fingering herself, touching herself, hand between legs/thighs, playing with herself, rubbing pussy. Strength 0.25-0.35.
- "dildo": Using a dildo/vibrator/toy. Activate for: dildo, vibrator, sex toy, inserting toy, using toy on herself. Strength 0.25-0.35.
- "facial": Cumshot-on-face / facial scenes (trigger word "facial"). Activate for: cum on face, facial, cumshot on face, jizz on face, shooting load on face, covered in cum facial, cum dripping on face. Strength 0.35-0.45 (use 0.45). Works best with kneeling/lying-down poses facing camera.

RULES FOR ENHANCEMENT LORAS:
- Multiple CAN be active simultaneously (e.g. masturbation + dildo when both acts apply)
- For blowjob/oral scenes: pose "none"; leave deepthroat at 0 (disabled). You may still set facial for cumshot-on-face endings.
- If the scene doesn't match any enhancement, set its strength to 0

${girlStrengthSection}

RUNNING MAKEUP:
- Set to true ONLY if the prompt explicitly mentions smeared/running/ruined/crying makeup or mascara

CUM EFFECT:
- Set to true ONLY if the prompt explicitly mentions cum/cumshot/creampie/facial cum/cum on body

OUTPUT: Return ONLY valid JSON on one line, no explanation:
{"pose":"<pose_id or none>","girl_strength":0.XX,"amateur_nudes":0.XX,"deepthroat":0.XX,"masturbation":0.XX,"dildo":0.XX,"facial":0.XX,"makeup":false,"cum":false}`;
  systemPrompt = await getPromptTemplateValue("falLoraSelectorSystemPrompt", systemPrompt);

  console.log(`🤖 AI LoRA selector input: scene="${sceneDescription.substring(0, 80)}", chips=[${chipSummary.substring(0, 100)}], prompt="${finalPrompt.substring(0, 80)}..."`);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "x-ai/grok-4.1-fast",
        max_tokens: 128,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: systemPrompt }],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      console.error("⚠️ Grok LoRA selector API error, using fallback");
      return fallback;
    }

    const result = await response.json();
    let rawContent = result.choices?.[0]?.message?.content || "";
    rawContent = rawContent.includes("<think>")
      ? rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
      : rawContent.trim();

    const jsonMatch = rawContent.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      console.log(`⚠️ AI LoRA selector returned non-JSON: "${rawContent}", using fallback`);
      return fallback;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validPoseIds = POSE_LORAS.map(p => p.id);
    const selectedPose = parsed.pose && parsed.pose !== "none" && validPoseIds.includes(parsed.pose)
      ? POSE_LORAS.find(p => p.id === parsed.pose)
      : null;

    const rawGirlStrength = parseFloat(parsed.girl_strength);
    const capGirl = quickFlow ? 0.65 : 0.80;
    const defaultGirl = quickFlow ? 0.65 : 0.70;
    let girlStrength;
    if (userLoraStrength) {
      girlStrength = quickFlow ? Math.min(0.65, Math.max(0.55, userLoraStrength)) : Math.max(0.65, userLoraStrength);
    } else if (!isNaN(rawGirlStrength) && rawGirlStrength >= 0.55 && rawGirlStrength <= capGirl) {
      girlStrength = rawGirlStrength;
    } else if (!isNaN(rawGirlStrength) && rawGirlStrength > capGirl) {
      girlStrength = capGirl; // Quick flow max 0.65, advanced max 0.80
    } else if (!isNaN(rawGirlStrength) && rawGirlStrength >= 0.35 && rawGirlStrength < 0.55) {
      girlStrength = quickFlow ? 0.55 : 0.65;
    } else {
      girlStrength = defaultGirl;
    }

    const enhancementStrengths = {};
    for (const key of Object.keys(ENHANCEMENT_LORAS)) {
      const raw = parseFloat(parsed[key]);
      const meta = ENHANCEMENT_LORAS[key];
      const loraMin = meta?.strengthRange?.[0] ?? 0.25;
      const loraMax = meta?.strengthRange?.[1] ?? MAX_ADDITIVE_LORA_STRENGTH;
      if (!isNaN(raw) && raw >= loraMin && raw <= loraMax) {
        enhancementStrengths[key] = raw;
      } else if (!isNaN(raw) && raw > 0) {
        enhancementStrengths[key] = Math.min(loraMax, Math.max(loraMin, raw));
      } else {
        enhancementStrengths[key] = 0;
      }
    }
    for (const k of DISABLED_ENHANCEMENT_LORA_KEYS) {
      enhancementStrengths[k] = 0;
    }

    const aiResult = {
      pose: selectedPose,
      runningMakeup: parsed.makeup === true,
      cumEffect: parsed.cum === true,
      girlStrength,
      enhancementStrengths,
    };

    const activeEnhancements = Object.entries(enhancementStrengths).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`🤖 AI LoRA decision: pose=${selectedPose ? selectedPose.id : "none"}, girlStrength=${girlStrength}${userLoraStrength ? " (user override)" : " (AI)"}, makeup=${aiResult.runningMakeup}, cum=${aiResult.cumEffect}, enhancements=[${activeEnhancements || "none"}]`);
    return aiResult;
  } catch (error) {
    console.error("⚠️ AI LoRA selector failed:", error.message);
    return fallback;
  }
}

function getPoseDescription(poseId) {
  const descriptions = {
    doggystyle_facing:
      "Penetrative doggystyle / from-behind intercourse only: girl on all fours or bent over with visible rear-entry penetration. NOT kneeling blowjob, NOT standing solo, NOT 'kneeling on floor' without rear sex — those are NOT this LoRA.",
    missionary: "Missionary sex position - girl lying on her back with legs spread during vaginal sex",
    anal_doggystyle:
      "Anal sex in doggy / rear-entry position — girl on all fours or bent over with rear anal penetration visible. Matches workflow LoRA slot (not titfuck).",
    handjob:
      "Handjob ONLY — stroking/jerking penis with hand(s) as the main act, no mouth on penis. If the mouth is on the penis (blowjob), this is WRONG — use pose 'none' (do not use handjob pose with oral).",
    missionary_anal: "Anal sex in missionary position - girl on her back during anal penetration",
  };
  return descriptions[poseId] || poseId;
}

/**
 * Blowjob/oral prompts often mention a hand on shaft — the AI wrongly picks handjob pose LoRA,
 * which stacks a second phallus/handjob prior with oral. Oral scenes must use pose none (bjz/deepthroat LoRA disabled).
 */
function isOralBlowjobScenePrompt(promptText) {
  const t = (promptText || "").toLowerCase();
  if (
    /\b(blowjob|deepthroat|oral sex)\b/.test(t) ||
    /mouth wrapped around|mouth on penis|penis in (her )?mouth|cock in mouth|sucking (cock|penis|dick)|giving head/.test(t)
  ) {
    return true;
  }
  // POV oral: mouth + penis in same description (even if "hands gripping shaft" is also present)
  if (/erect penis/.test(t) && /\b(mouth|lips|sucking|wrapped around)\b/.test(t)) return true;
  if (/\bgripping shaft\b/.test(t) && /\b(mouth wrapped|mouth on|penis in|sucking)\b/.test(t)) return true;
  return false;
}

/** Oral framed as receiver POV — model otherwise often draws a disembodied shaft + hand. */
function isPovReceivingOralPrompt(promptText) {
  if (!isOralBlowjobScenePrompt(promptText)) return false;
  const t = String(promptText || "").toLowerCase();
  return (
    /\b(pov|p\.o\.v\.|first[- ]person|first person|point of view)\b/.test(t) ||
    /\b(from above|from his perspective|from the man'?s perspective|viewer'?s|his (thigh|thighs|lap|lower body|torso|abdomen))\b/.test(t) ||
    /\b(man receiving|receiving oral|getting (a )?blowjob|getting (his )?dick sucked)\b/.test(t) ||
    (/\b(looking up|gaze|eyes).*\b(camera|viewer|lens)\b/.test(t) && /\b(penis|cock|shaft|oral|sucking|mouth)\b/.test(t))
  );
}

/** Short positive tail: anchors genitals to a body for first-person BJ shots (Z-Image drifts to "floating cock" easily). */
const NSFW_POS_POV_ORAL_BODY_ANCHOR =
  "first person POV from the man receiving oral, his penis attached to his body, lower abdomen and upper thighs visible at the edges of the frame, continuous anatomy";

/** All oral-with-penis scenes: push CLIP away from disconnected phallus props. */
const NSFW_NEG_ORAL_DISCONNECTED_PHALLUS =
  "disembodied penis, floating penis, detached cock, penis with no male body, disconnected genitals, male torso completely missing, penis prop";

/**
 * Server-side guard after Grok: never stack pose LoRAs on oral; keep bjz/deepthroat off; strip incompatible enhancers.
 */
function applyOralBlowjobLoraPolicy(aiSelection, fullPromptText) {
  if (!isOralBlowjobScenePrompt(fullPromptText)) return;

  if (aiSelection.pose) {
    console.warn(
      `🛡️ Oral/blowjob scene — cleared pose LoRA "${aiSelection.pose.id}" (prevents handjob/doggy + oral double-penis artifacts).`
    );
    aiSelection.pose = null;
  }

  aiSelection.enhancementStrengths = { ...(aiSelection.enhancementStrengths || {}) };
  aiSelection.enhancementStrengths.deepthroat = 0;
  // facial CAN combine with blowjob/oral for cumshot-ending scenes — do not zero it out
  aiSelection.enhancementStrengths.masturbation = 0;
  aiSelection.enhancementStrengths.dildo = 0;
}

/**
 * True when the prompt describes partnered explicit sex / POV genitals / penetration.
 * Appending "solo girl" in that case fights the model and yields wrong poses/layouts.
 */
function isPartneredExplicitPrompt(text) {
  const t = String(text || "").toLowerCase();
  const explicitPartner = [
    /\bpenis\b/,
    /\berect\b.*\b(penis|cock|dick|shaft)\b/,
    /\bpenetrating\b/,
    /\b(pussy|vulva|labia)\b.*\b(shaft|penis|cock)\b/,
    /\b(blowjob|deepthroat|oral sex)\b/,
    /\bmissionary sex\b/,
    /\bmissionary position\b.*\b(penis|penetrating|sex)\b/,
    /\b(doggy style|doggy style sex)\b/,
    /\b(riding|straddling)\b.*\b(penis|sex|cock)\b/,
    /\b(prone bone|anal sex)\b/,
    /\b(two adults|consensual couple)\b/,
    /\bcreampie\b/,
    /\bcum on\b/,
    /\bintercourse\b/,
    /\bstraddl/,
  ].some((re) => re.test(t));
  if (!explicitPartner) return false;
  const clearlySolo = /\b(only one woman|solo masturbat|fingering herself|no partner|dildo only)\b/i.test(t);
  return !clearlySolo;
}

/**
 * After Grok: force pose LoRA when keywords are unambiguous (reduces "no LoRA" failures).
 */
function applyExplicitPoseHeuristic(aiSelection, fullPromptText) {
  const t = String(fullPromptText || "").toLowerCase();

  if (isOralBlowjobScenePrompt(fullPromptText)) {
    return;
  }

  const setPose = (id) => {
    const p = POSE_LORAS.find((x) => x.id === id);
    if (p) {
      aiSelection.pose = p;
      console.log(`🎯 Heuristic: pose LoRA "${id}" (keyword match)`);
    }
  };

  if (
    /\bmissionary\b/.test(t) &&
    /\b(penis|penetrating|pussy|vaginal|labia|shaft|intercourse)\b/.test(t) &&
    !/\b(anal sex|anal penetration)\b/.test(t)
  ) {
    setPose("missionary");
  } else if (/\b(missionary anal|anal sex in missionary)\b/.test(t)) {
    setPose("missionary_anal");
  } else if (/\b(anal sex|anal penetration)\b/.test(t) && /\b(doggy|from behind|rear)\b/.test(t)) {
    setPose("anal_doggystyle");
  } else if (
    /\b(doggy style|from behind)\b/.test(t) &&
    /\b(penis|penetrating|shaft)\b/.test(t) &&
    !/\b(anal sex|anal penetration)\b/.test(t)
  ) {
    setPose("doggystyle_facing");
  }
}

/**
 * Nudes pack: Grok often rewrites per-pose prompts into vague prose, so `detectLorasWithAI` + heuristics
 * miss pose / amateur_nudes / deepthroat. Classic NSFW keeps explicit user wording + chips.
 * Apply after AI + `applyOralBlowjobLoraPolicy` + `applyExplicitPoseHeuristic` so pack rows match classic additive stack.
 *
 * @param {import('../../shared/nudesPackPoses.js').NudesPackAdditiveLoraHint | null | undefined} hint
 */
function applyNudesPackAdditiveLoraHint(aiSelection, hint) {
  if (!hint || typeof hint !== "object") return;

  const enh = { ...(aiSelection.enhancementStrengths || {}) };

  if (hint.oralScene === true || (hint.deepthroat != null && Number(hint.deepthroat) >= 0.35)) {
    if (aiSelection.pose) {
      console.warn(
        `📦 Pack additive hint: cleared pose LoRA "${aiSelection.pose.id}" (oral / deepthroat pack row).`,
      );
    }
    aiSelection.pose = null;
    enh.deepthroat = 0;
    enh.masturbation = 0;
    enh.dildo = 0;
    // facial can coexist with oral for cumshot-ending pack rows
    for (const k of Object.keys(enh)) {
      const loraMax = ENHANCEMENT_LORAS[k]?.strengthRange?.[1] ?? MAX_ADDITIVE_LORA_STRENGTH;
      const v = Number(enh[k]);
      if (Number.isFinite(v) && v > loraMax) enh[k] = loraMax;
    }
    aiSelection.enhancementStrengths = enh;
    console.log(`📦 Pack additive hint: oral — deepthroat/bjz LoRA disabled`);
    return;
  }

  // Solo / girlfriend rows: pack may only suggest amateur aesthetic — drop spurious pose LoRA from softened Grok text.
  if (hint.amateurNudes != null && !hint.poseId && hint.oralScene !== true) {
    if (aiSelection.pose) {
      console.log(`📦 Pack additive hint: cleared pose (solo / amateur-only pack row)`);
    }
    aiSelection.pose = null;
  }

  if (hint.poseId) {
    const p = POSE_LORAS.find((x) => x.id === hint.poseId);
    if (p) {
      aiSelection.pose = p;
      console.log(`📦 Pack additive hint: pose "${hint.poseId}"`);
    } else {
      console.warn(`📦 Pack additive hint: unknown poseId "${hint.poseId}"`);
    }
  }

  if (hint.masturbation != null) {
    const m = Number(hint.masturbation);
    if (Number.isFinite(m)) {
      enh.masturbation = Math.min(
        MAX_ADDITIVE_LORA_STRENGTH,
        Math.max(Number(enh.masturbation) || 0, m),
      );
    }
  }
  if (hint.dildo != null) {
    const d = Number(hint.dildo);
    if (Number.isFinite(d)) {
      enh.dildo = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(Number(enh.dildo) || 0, d));
    }
  }

  for (const k of Object.keys(enh)) {
    const loraMax = ENHANCEMENT_LORAS[k]?.strengthRange?.[1] ?? MAX_ADDITIVE_LORA_STRENGTH;
    const v = Number(enh[k]);
    if (Number.isFinite(v) && v > loraMax) enh[k] = loraMax;
  }

  aiSelection.enhancementStrengths = enh;
}

/**
 * Short camera/skin tail appended after Grok scene text. Keep compact — Z-Image Turbo is diluted by long
 * comma-separated quality dumps; the main prompt should carry scene/lighting in flowing prose.
 */
const QUALITY_TECHNICAL_TAIL =
  "smartphone candid photo, natural skin with visible pores, slight wide-angle distortion, unedited raw capture, auto-exposure, grain in shadows, candid amateur nude";

/** Solo nudes only — NEVER append this when the scene describes partnered sex / visible penis / penetration (conflicts with model). */
const QUALITY_SUFFIX_SOLO =
  "one person only, solo girl, anatomically correct, natural body proportions, " + QUALITY_TECHNICAL_TAIL;

/**
 * Explicit partnered / POV sex — no "solo girl" (that caused wrong layouts and ignored penetration).
 */
const QUALITY_SUFFIX_PARTNERED =
  "female subject in frame, male anatomy only as described in prompt, anatomically correct, natural proportions, average adult scale, " +
  QUALITY_TECHNICAL_TAIL;

/** @deprecated use QUALITY_SUFFIX_SOLO — kept for callers that only need solo */
const QUALITY_SUFFIX = QUALITY_SUFFIX_SOLO;

/** Nudes pack: short tail only — looks come from LoRA + chipSelections for the AI selector, not pasted into CLIP. */
const NUDES_PACK_TAIL_SOLO =
  "anatomically correct, realistic skin, solo, candid amateur photo";
const NUDES_PACK_TAIL_COUPLE =
  "anatomically correct, realistic skin, consensual adult, two adults";

/** Max enhancement LoRAs (deepthroat/amateur/etc.) applied at once — matches AI selector design. */
const MAX_SIMULTANEOUS_ENHANCEMENT_LORAS = 2;

/**
 * Build ordered LoRA stack entries (identity → optional pose → optional makeup → up to 2 enhancements → optional cum).
 * The identity URL is always `loraUrl` from the saved model / active trained LoRA (DB) — never from client maps.
 * Additive URLs come only from server maps (`POSE_SLOT_URLS`, `ENHANCEMENT_LORAS`, fixed makeup/cum URLs) when strength > 0.
 */
export function buildNsfwLoraStackEntries({
  loraUrl,
  girlLoraStrength,
  poseStrengths = {},
  makeupStrength = 0,
  cumStrength = 0,
  enhancementStrengths = {},
}) {
  const entries = [];
  const gUrl = loraUrl ? String(loraUrl).trim() : "";
  const gStr = Math.min(1, Math.max(0, Number(girlLoraStrength) || 0.6));
  if (gUrl) {
    entries.push({ url: sanitizeLoraDownloadUrl(gUrl), strength: gStr });
  }

  if (!NSFW_ADDITIVE_LORAS_ENABLED) {
    return entries.slice(0, 10);
  }

  const enhSafe = zeroDisabledEnhancementStrengths(enhancementStrengths);

  for (const p of POSE_LORAS) {
    const str = poseStrengths[p.node] || 0;
    const s = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0, Number(str)));
    if (s > 0 && POSE_SLOT_URLS[p.node]) {
      entries.push({ url: sanitizeLoraDownloadUrl(POSE_SLOT_URLS[p.node]), strength: s });
      break;
    }
  }

  const mk = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0, Number(makeupStrength) || 0));
  if (mk > 0) {
    entries.push({ url: sanitizeLoraDownloadUrl(LORA_8_RUNNING_MAKEUP_URL), strength: mk });
  }

  // facial supports up to 0.45; others cap at MAX_ADDITIVE_LORA_STRENGTH (amateur_nudes/deepthroat zeroed in enhSafe)
  const enhOrder = ["deepthroat", "facial", "amateur_nudes", "masturbation", "dildo"];
  let enhAdded = 0;
  for (const key of enhOrder) {
    if (entries.length >= 10 || enhAdded >= MAX_SIMULTANEOUS_ENHANCEMENT_LORAS) break;
    const raw = Number(enhSafe[key]) || 0;
    if (raw <= 0) continue;
    const meta = ENHANCEMENT_LORAS[key];
    if (!meta?.url) continue;
    const loraMin = meta?.strengthRange?.[0] ?? 0.25;
    const loraMax = meta?.strengthRange?.[1] ?? MAX_ADDITIVE_LORA_STRENGTH;
    const s = Math.min(loraMax, Math.max(loraMin, raw));
    entries.push({ url: sanitizeLoraDownloadUrl(meta.url), strength: s });
    enhAdded += 1;
  }

  const cumS = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0, Number(cumStrength) || 0));
  if (cumS > 0 && entries.length < 10) {
    entries.push({ url: sanitizeLoraDownloadUrl(CUM_LORA_URL), strength: cumS });
  }

  return entries.slice(0, 10);
}

/**
 * Pack stack into LoadLoraFromUrlOrPath node: lora_1..lora_N contiguous, rest empty, num_loras = N.
 *
 * Only entries with a non-empty URL are applied (AI/buildNsfwLoraStackEntries must not add unused additives).
 * Slots lora_2..lora_10 are always cleared when unused so template/desktop HF URLs never leak into RunPod.
 */
export function applyCompactLoraStackToNode250(node250, entries) {
  if (!node250?.inputs) return;
  const compact = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && String(e.url ?? "").trim())
    .slice(0, 10)
    .map((e) => ({
      url: sanitizeLoraDownloadUrl(String(e.url).trim()),
      strength: Math.min(1, Math.max(0, Number(e.strength) || 0)),
    }));
  const n = compact.length;
  for (let i = 0; i < 10; i++) {
    const idx = i + 1;
    const e = compact[i];
    const p = `lora_${idx}_`;
    if (e) {
      node250.inputs[p + "url"] = e.url;
      node250.inputs[p + "strength"] = e.strength;
      node250.inputs[p + "model_strength"] = e.strength;
      node250.inputs[p + "clip_strength"] = e.strength;
    } else {
      node250.inputs[p + "url"] = "";
      node250.inputs[p + "strength"] = 0;
      node250.inputs[p + "model_strength"] = 0;
      node250.inputs[p + "clip_strength"] = 0;
    }
  }
  node250.inputs.num_loras = Math.min(10, Math.max(0, n));
  if ("mode" in node250.inputs) {
    node250.inputs.mode = n <= 1 ? "simple" : "advanced";
  }
}

/**
 * Build a professional NSFW prompt
 */
export function buildNsfwPrompt(triggerWord, userPrompt, attributes = "") {
  let prompt = triggerWord;

  if (attributes && attributes.trim()) {
    prompt += ", " + attributes.trim();
  }

  if (userPrompt && userPrompt.trim()) {
    prompt += ", " + userPrompt.trim();
  }

  prompt += ", " + QUALITY_SUFFIX;

  return prompt;
}

/**
 * Build the full ComfyUI workflow from the core NSFW workflow template.
 * 1:1 with `attached_assets/nsfw_core_workflow.json` by default: same KSampler steps/cfg, grain/blur,
 * and negative string as the template unless the caller opts in to overrides.
 * Patched: positive (56), LoRA stack (250/298/305/306/311), aspect node 50 + DF_Integer 302/303, seed (57 when passed).
 * Negative (41): only replaced when `negativePrompt` is explicitly non-empty.
 * Grain/blur (284/286): only when `useWorkflowPostProcessing` / `NSFW_COMFY_USE_WORKFLOW_POST` / `overrideGrainBlur`.
 * Base KSampler (276) steps/cfg: only when `steps`/`cfg` are passed (e.g. admin sampler override).
 * String Literal nodes 41/56 are stripped for API; all `[41|56, slot]` input refs are inlined with template text (not only CLIPTextEncode `text`).
 * Falls back to legacy inline workflow if the JSON is missing.
 */

/** Newer ComfyUI_UltimateSDUpscale builds expect `batch_size`; desktop exports may omit it. */
function patchUltimateSdUpscaleApiNodes(apiWorkflow) {
  if (!apiWorkflow || typeof apiWorkflow !== "object") return;
  for (const node of Object.values(apiWorkflow)) {
    if (node?.class_type !== "UltimateSDUpscale" || !node.inputs) continue;
    if (node.inputs.batch_size === undefined) {
      node.inputs.batch_size = 1;
    }
  }
}

/**
 * Skip UltimateSDUpscale + UpscaleModelLoader when the worker has no upscale_models
 * (set NSFW_COMFY_BYPASS_UPSCALE=1). Feeds VAEDecode (25) directly into Image Film Grain (284).
 */
function bypassUpscaleChainInNsfwCoreApi(apiWorkflow) {
  if (!apiWorkflow || typeof apiWorkflow !== "object") return;
  const grain = apiWorkflow["284"];
  if (grain?.class_type === "Image Film Grain" && grain.inputs) {
    grain.inputs.image = ["25", 0];
  }
  delete apiWorkflow["323"];
  delete apiWorkflow["329"];
  delete apiWorkflow["327"];
}

function buildComfyWorkflow(params) {
  // Route to Pro workflow unless NSFW_WORKFLOW_VERSION=core is explicitly set
  if (process.env.NSFW_WORKFLOW_VERSION !== "core") {
    const proResult = buildComfyWorkflowPro(params);
    if (proResult) return proResult;
    console.warn("[buildComfyWorkflow] Pro workflow failed — falling back to core workflow");
  }

  const {
    prompt,
    loraUrl,
    girlLoraStrength,
    poseStrengths = {},
    makeupStrength = 0,
    cumStrength = 0,
    enhancementStrengths = {},
    postProcessing = {},
    seed,
    width = 1344,
    height = 768,
    /** Aspect-ratio preset string fed to CR SDXL Aspect Ratio node (e.g. "16:9 landscape 1344x768"). */
    aspectRatio = "16:9 landscape 1344x768",
    /** Only applied when set (e.g. admin override) — otherwise template KSampler 276 steps/cfg stay 1:1 with JSON */
    steps,
    cfg,
    /** If set, replaces String Literal 41; otherwise template negative from nsfw_core_workflow.json is used */
    negativePrompt: explicitNegativePrompt,
    /**
     * When true, applies blur/grain formulas to nodes 284/286 from postProcessing.
     * Default false = keep template grain/blur (matches desktop export).
     */
    useWorkflowPostProcessing = false,
  } = params;

  const graph = loadNsfwCoreWorkflowGraph();
  if (graph && graph.nodes) {
    // Create a deep copy of the graph
    const workflowGraph = JSON.parse(JSON.stringify(graph));
    
    // Find nodes by ID
    const findNode = (id) => workflowGraph.nodes.find(n => n.id === id);
    
    // Build AI-selected additive LoRA stack (pose + makeup + enhancement LoRAs).
    // buildNsfwLoraStackEntries returns [girl, ...additives]; node 250 slots 2+3 take the additives.
    const allLoraEntries = buildNsfwLoraStackEntries({
      loraUrl,
      girlLoraStrength,
      poseStrengths,
      makeupStrength,
      cumStrength,
      enhancementStrengths,
    });
    // Entry 0 is the girl LoRA; entries 1+ are pose/makeup/enhancement (see buildNsfwLoraStackEntries).
    const additives = allLoraEntries.slice(1, 3);

    // Compact slot assignment — no gaps.
    const additive1Url      = additives[0]?.url      ?? "";
    const additive1Strength = additives[0]?.strength ?? 0;
    const additive2Url      = additives[1]?.url      ?? "";
    const additive2Strength = additives[1]?.strength ?? 0;

    // Compact stack length (pose/makeup/enhancement may add 0–N slots after the girl LoRA).
    const activeLorasCount = allLoraEntries.length;

    console.log(`[NSFW LoRA] girl=${loraUrl ? "✓" : "✗"} | additives=${additives.length}` +
      (additives[0] ? ` [1]=${additives[0].url.split("/").pop()} @${additives[0].strength}` : "") +
      (additives[1] ? ` [2]=${additives[1].url.split("/").pop()} @${additives[1].strength}` : ""));

    // Negative: only override template when caller passes a non-empty string (1:1 with JSON otherwise)
    if (explicitNegativePrompt != null && String(explicitNegativePrompt).trim() !== "") {
      const node41 = findNode(41);
      if (node41 && node41.widgets_values && node41.widgets_values.length > 0) {
        node41.widgets_values[0] = String(explicitNegativePrompt).trim();
      }
    }

    // Oral + penis: models often output a hand gripping a floating shaft; extra negatives help without touching solo scenes.
    const node41ForOral = findNode(41);
    if (
      node41ForOral &&
      node41ForOral.widgets_values &&
      node41ForOral.widgets_values.length > 0 &&
      isOralBlowjobScenePrompt(prompt)
    ) {
      const curNeg = String(node41ForOral.widgets_values[0] || "");
      if (!/\bdisembodied penis\b/i.test(curNeg)) {
        node41ForOral.widgets_values[0] = `${curNeg}, ${NSFW_NEG_ORAL_DISCONNECTED_PHALLUS}`;
      }
    }

    const node56 = findNode(56); // Positive Prompt
    if (node56 && node56.widgets_values && node56.widgets_values.length > 0) {
      node56.widgets_values[0] = prompt || "";
    }

    // Base KSampler 276: only patch steps/cfg when explicitly provided (admin); else keep template (e.g. 50, 2.5)
    const node276 = findNode(276);
    if (node276 && node276.widgets_values && node276.widgets_values.length > 3) {
      if (steps != null && Number.isFinite(Number(steps))) {
        node276.widgets_values[2] = Math.min(150, Math.max(1, Math.round(Number(steps))));
      }
      if (cfg != null && Number.isFinite(Number(cfg))) {
        node276.widgets_values[3] = Number(cfg);
      }
    }
    
    const node311 = findNode(311); // active_loras
    if (node311 && node311.widgets_values && node311.widgets_values.length > 0) {
      node311.widgets_values[0] = activeLorasCount;
    }
    
    const node298 = findNode(298); // lora_girl
    if (node298 && node298.widgets_values && node298.widgets_values.length > 0) {
      node298.widgets_values[0] = Math.min(1, Math.max(0, Number(girlLoraStrength) || 0.6));
    }

    const node305 = findNode(305); // lora_additive1
    if (node305 && node305.widgets_values && node305.widgets_values.length > 0) {
      node305.widgets_values[0] = additive1Strength;
    }

    const node306 = findNode(306); // lora_additive2
    if (node306 && node306.widgets_values && node306.widgets_values.length > 0) {
      node306.widgets_values[0] = additive2Strength;
    }

    // Node 50 (CR SDXL Aspect Ratio): template hard-codes aspect_ratio to 16:9 — must patch or every gen stays 16:9.
    // widgets_values[2] is aspect_ratio (width/height slots 0–1 are linked to 302/303 for conversion).
    const node50 = findNode(50);
    if (node50 && node50.widgets_values && node50.widgets_values.length >= 3) {
      node50.widgets_values[2] = aspectRatio;
      // Prevent portrait/landscape inversion when selecting explicit ratios in UI.
      if (node50.widgets_values.length >= 4) {
        node50.widgets_values[3] = "Off";
      }
    }

    // Node 302 / 303: DF_Integer → node 50 width/height inputs (links 1344/1345). Template uses 2× base resolution.
    // 302 feeds "width" input, 303 feeds "height" input — match template defaults (2688=1344×2, 1536=768×2).
    const node302 = findNode(302);
    if (node302 && node302.widgets_values && node302.widgets_values.length > 0) {
      node302.widgets_values[0] = (Number(width) || 1344) * 2;
    }
    const node303 = findNode(303);
    if (node303 && node303.widgets_values && node303.widgets_values.length > 0) {
      node303.widgets_values[0] = (Number(height) || 768) * 2;
    }
    
    // Blur/grain: optional — default keeps template nodes 284/286 (1:1 with desktop export)
    const usePostFormulas =
      useWorkflowPostProcessing === true || process.env.NSFW_COMFY_USE_WORKFLOW_POST === "1";
    if (usePostFormulas) {
      const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
      const blurEnabled = postProcessing?.blur?.enabled !== false;
      const grainEnabled = postProcessing?.grain?.enabled !== false;
      const blurStrength = clamp(Number(postProcessing?.blur?.strength) ?? 1.0, 0, 1);
      const grainStrength = clamp(Number(postProcessing?.grain?.strength) ?? 1.0, 0, 1);

      const node284 = findNode(284);
      if (node284 && node284.widgets_values && node284.widgets_values.length >= 4) {
        const density = grainEnabled ? Number((0.06 * grainStrength).toFixed(4)) : 0;
        const intensity = grainEnabled ? Number((0.1 * grainStrength).toFixed(4)) : 0;
        node284.widgets_values[0] = Math.max(0.01, density);
        node284.widgets_values[1] = Math.max(0.01, intensity);
      }

      const node286 = findNode(286);
      if (node286 && node286.widgets_values && node286.widgets_values.length >= 2) {
        node286.widgets_values[0] = blurEnabled ? Math.max(1, Math.round(2 * blurStrength)) : 1;
        const sigma = blurEnabled ? Number((0.3 * blurStrength).toFixed(3)) : 0;
        node286.widgets_values[1] = Math.max(0.1, sigma);
      }
    }
    
    // Node 250: graph `widgets_values` layout is NOT stable (header slots 0–6, then 4 widgets per LoRA).
    // Patching [3]/[7]/[11] was wrong and corrupted the stack. Apply the compact stack on the API node instead (below).

    // Node 57: Seed (rgthree) — patch seed in widgets_values BEFORE conversion.
    if (seed != null) {
      const node57 = findNode(57);
      if (node57 && node57.widgets_values && node57.widgets_values.length > 0) {
        node57.widgets_values[0] = seed;
      }
    }

    // Final string values after graph patches (single source of truth for API inlining)
    const negativeTextForInline = String(findNode(41)?.widgets_values?.[0] ?? "");
    const positiveTextForInline = String(findNode(56)?.widgets_values?.[0] ?? "");

    removeRgthreeFastGroupsBypasserFromComfyUiGraph(workflowGraph.nodes, workflowGraph.links);

    // Convert graph to API format, then deep-clone so we never mutate a shared/cached object.
    const apiWorkflow = JSON.parse(
      JSON.stringify(
        comfyUiGraphToApiPrompt(workflowGraph.nodes, workflowGraph.links, workflowGraph.extra),
      ),
    );

    patchUltimateSdUpscaleApiNodes(apiWorkflow);
    // Always bypass UltimateSDUpscale for NSFW output path.
    bypassUpscaleChainInNsfwCoreApi(apiWorkflow);

    // LoadLoraFromUrlOrPath (250): set lora_1..N + num_loras on the API object (matches img2img path).
    if (apiWorkflow["250"]?.inputs) {
      applyCompactLoraStackToNode250(apiWorkflow["250"], allLoraEntries);
    }

    // CR SDXL Aspect Ratio (50): when the graph has no DF_Integer width/height nodes, patch API directly.
    const api50 = apiWorkflow["50"];
    if (api50?.class_type === "CR SDXL Aspect Ratio" && api50.inputs) {
      const w = Number(width) || 1344;
      const h = Number(height) || 768;
      if (!Array.isArray(api50.inputs.width)) {
        api50.inputs.width = w;
      }
      if (!Array.isArray(api50.inputs.height)) {
        api50.inputs.height = h;
      }
      if (typeof api50.inputs.aspect_ratio === "string" || api50.inputs.aspect_ratio == null) {
        api50.inputs.aspect_ratio = aspectRatio;
      }
      if (typeof api50.inputs.swap_dimensions === "string" || api50.inputs.swap_dimensions == null) {
        api50.inputs.swap_dimensions = "Off";
      }
    }

    // Strip String Literal nodes 41/56 (comfy-image-saver — not on RunPod): inline every wire to them.
    if (apiWorkflow["41"] || apiWorkflow["56"]) {
      inlineStringLiteralRefsInApiWorkflow(apiWorkflow, {
        41: negativeTextForInline,
        56: positiveTextForInline,
      });
      delete apiWorkflow["41"];
      delete apiWorkflow["56"];
    }


    // Optional: strip other custom nodes RunPod doesn't ship (Crystools, PrimitiveFloat) and inline values.
    // Default: off — pass the workflow through so ComfyUI on the worker matches your desktop export.
    if (process.env.NSFW_COMFY_STRIP_UNSUPPORTED === "1") {
      stripUnsupportedNodesAndInjectValues(apiWorkflow, {
        prompt: positiveTextForInline,
        negativePrompt: negativeTextForInline,
        loraUrl: params.loraUrl,
        activeLorasCount,
        loraGirlStrength: Math.min(1, Math.max(0, Number(girlLoraStrength) || 0.6)),
        loraAdditive1Strength: additive1Strength,
        loraAdditive2Strength: additive2Strength,
      });
    }

    return apiWorkflow;
  }

  return buildComfyWorkflowLegacy(params);
}

/** Extra negative terms for POV doggy/rear shots — avoid disembodied hand holding penis in frame */
const NSFW_NEGATIVE_POV_NO_HAND =
  ", hand holding penis, hand gripping penis, hand on shaft, disembodied hand, hand in frame holding cock";

/** Default negative prompt when stripping unsupported nodes (41/56/61) so RunPod never sees String Literal / Fast Groups Bypasser */
const DEFAULT_NSFW_NEGATIVE_PROMPT =
  "blurry, low resolution, deformed, bad anatomy, extra limbs, mutated hands, poorly drawn face, bad proportions, gigantic penis, huge penis, oversized penis, unrealistically large penis, hyperbolic genitals, watermark, text, signature, cartoon, anime, overexposed, underexposed, plastic skin, doll-like" +
  NSFW_NEGATIVE_POV_NO_HAND;

function buildComfyWorkflowLegacy(params) {
  const {
    prompt,
    loraUrl,
    girlLoraStrength,
    poseStrengths,
    makeupStrength,
    cumStrength = 0,
    enhancementStrengths = {},
    postProcessing = {},
    seed,
    steps = 50,
    cfg = 2.5,
    width = 1344,
    height = 768,
    aspectRatio = "16:9 landscape 1344x768",
  } = params;
  const negativePrompt =
    "blurry, low resolution, deformed, bad anatomy, extra limbs, mutated hands, poorly drawn face, bad proportions, gigantic penis, huge penis, oversized penis, unrealistically large penis, hyperbolic genitals, watermark, text, signature, cartoon, anime, overexposed, underexposed, plastic skin, doll-like" +
    NSFW_NEGATIVE_POV_NO_HAND;
  const loraEntries = buildNsfwLoraStackEntries({
    loraUrl,
    girlLoraStrength,
    poseStrengths,
    makeupStrength,
    cumStrength,
    enhancementStrengths,
  });
  let loraNodeId = 250;
  const loraNodes = {};
  let prevModelRef = ["247", 0];
  let prevClipRef = ["248", 0];
  for (let i = 0; i < loraEntries.length; i++) {
    const entry = loraEntries[i];
    const nodeId = String(loraNodeId + i);
    loraNodes[nodeId] = {
      inputs: { url: entry.url, strength_model: entry.strength, strength_clip: entry.strength, model: prevModelRef, clip: prevClipRef },
      class_type: "LoraLoaderFromURL",
    };
    prevModelRef = [nodeId, 0];
    prevClipRef = [nodeId, 1];
  }
  const workflow = {
    "1": { inputs: { text: negativePrompt, clip: prevClipRef }, class_type: "CLIPTextEncode" },
    "2": { inputs: { text: prompt, clip: prevClipRef }, class_type: "CLIPTextEncode" },
    "7": { inputs: { conditioning: ["8", 0] }, class_type: "ConditioningZeroOut" },
    "8": { inputs: { text: negativePrompt, clip: ["304", 1] }, class_type: "CLIPTextEncode" },
    "21": { inputs: { pixels: ["25", 0], vae: ["304", 2] }, class_type: "VAEEncode" },
    "25": { inputs: { samples: ["276", 0], vae: ["246", 0] }, class_type: "VAEDecode" },
    "28": { inputs: { samples: ["45", 0], vae: ["304", 2] }, class_type: "VAEDecode" },
    "36": { inputs: { images: ["286", 0] }, class_type: "PreviewImage" },
    "42": { inputs: { text: prompt, clip: ["304", 1] }, class_type: "CLIPTextEncode" },
    "45": { inputs: { seed: ["57", 0], steps: 8, cfg: 0, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 0.09, model: ["304", 0], positive: ["42", 0], negative: ["7", 0], latent_image: ["21", 0] }, class_type: "KSampler" },
    "50": {
      inputs: {
        width,
        height,
        aspect_ratio: aspectRatio,
        swap_dimensions: "Off",
        upscale_factor: 1,
        batch_size: 1,
      },
      class_type: "CR SDXL Aspect Ratio",
    },
    "57": { inputs: { seed }, class_type: "Seed (rgthree)" },
    "246": { inputs: { vae_name: "ae.safetensors" }, class_type: "VAELoader" },
    "247": { inputs: { unet_name: "zImageTurboNSFW_20BF16AIO.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
    "248": { inputs: { clip_name: "qwen_3_4b.safetensors", type: "qwen_image", device: "default" }, class_type: "CLIPLoader" },
    ...loraNodes,
    "276": {
      inputs: {
        seed: ["57", 0],
        steps: Math.min(10000, Math.max(1, Number(steps) || 50)),
        cfg: Number(cfg) || 2.5,
        sampler_name: "dpmpp_2m",
        scheduler: "beta",
        denoise: 1,
        model: prevModelRef,
        positive: ["2", 0],
        negative: ["1", 0],
        latent_image: ["50", 4],
      },
      class_type: "KSampler",
    },
    "284": { inputs: { density: 0.06, intensity: 0.1, highlights: 1, supersample_factor: 1, image: ["28", 0] }, class_type: "Image Film Grain" },
    "286": { inputs: { blur_radius: 2, sigma: 0.3, image: ["284", 0] }, class_type: "ImageBlur" },
    "289": { inputs: { filename_prefix: "modelclone", images: ["286", 0] }, class_type: "SaveImage" },
    "304": { inputs: { ckpt_name: "pornworksRealPorn_Illustrious_v4_04.safetensors" }, class_type: "CheckpointLoaderSimple" },
  };
  return workflow;
}

/**
 * Submit NSFW image generation via RunPod serverless (ComfyUI handler)
 * Uses ComfyUI workflow with multi-LoRA system:
 * - LoRA 1 (node 298): User's girl LoRA (dynamic strength 0.65-0.90)
 * - LoRA 2 (node 290): Doggystyle facing pose
 * - LoRA 3 (node 291): Missionary pose
 * - LoRA 5 (node 293): Anal doggy / rear anal (HF: Nsfw Anal Doggystyle)
 * - LoRA 6 (node 294): Handjob pose
 * - LoRA 7 (node 295): Missionary anal pose
 * - LoRA 8 (node 296): Running makeup effect
 * - LoRA 10 (node 303): Cum effect
 * LoRA 4 and 9 are empty/unused slots
 */
export async function submitNsfwGeneration(params, webhookUrl = null, generationId = null) {
  const {
    loraUrl,
    triggerWord,
    userPrompt,
    attributes = "",
    sceneDescription = "",
    chipSelections = {},
    options = {},
  } = params;

  if (!RUNPOD_API_KEY) {
    return { success: false, error: "RUNPOD_API_KEY not configured" };
  }
  if (!RUNPOD_BASE_URL) {
    return { success: false, error: "NSFW RunPod endpoint not configured (set RUNPOD_ENDPOINT_ID or RUNPOD_MODELCLONE_X_ENDPOINT_ID)" };
  }

  const {
    loraStrength = null,
    postProcessing = {},
    adminBaseSamplerSteps = null,
    adminBaseSamplerCfg = null,
    quickFlow = false,
    nudesPack = false,
    /** @type {import('../../shared/nudesPackPoses.js').NudesPackAdditiveLoraHint | null | undefined} */
    packAdditiveLoraHint = null,
  } = options;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const normalizeStrength = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) ? clamp(num, 0, 1) : fallback;
  };
  const normalizedPostProcessing = {
    blur: {
      enabled: postProcessing?.blur?.enabled !== false,
      strength: normalizeStrength(postProcessing?.blur?.strength, 1.0),
    },
    grain: {
      enabled: postProcessing?.grain?.enabled !== false,
      strength: normalizeStrength(postProcessing?.grain?.strength, 1.0),
    },
  };

  // Accept any user-specified strength in 0.1–0.9; fall back to default 0.65.
  const rawStrength = Number(loraStrength);
  const validatedOverride = Number.isFinite(rawStrength) && rawStrength >= 0.1 && rawStrength <= 0.9
    ? rawStrength : null;

  // Build prompt: anchor identity with triggerWord, then the AI-generated scene prose — nothing else.
  // Z-Image Turbo is degraded by quality tag dumps ("anatomically correct", "solo girl", etc.).
  // The AI system prompt already produces correctly styled, complete descriptions.
  const basePrompt = (userPrompt && userPrompt.trim()) || "";
  if (!basePrompt) {
    return { success: false, error: "Prompt is required. Generate a prompt first (Create Prompt)." };
  }
  const hasTriggerAnchor = basePrompt.toLowerCase().includes(String(triggerWord || "").toLowerCase());
  let prompt = hasTriggerAnchor ? basePrompt : `${triggerWord}, ${basePrompt}`;

  // Identity LoRA only — no additive LoRAs, no AI Grok call for LoRA selection.
  const aiSelection = buildGirlOnlyLoraSelection(validatedOverride);

  // Inject trigger words for active enhancement LoRAs (e.g. facial) that require them in-prompt.
  for (const [key, strength] of Object.entries(aiSelection.enhancementStrengths || {})) {
    const tw = ENHANCEMENT_LORAS[key]?.triggerWord;
    if (tw && Number(strength) > 0 && !prompt.toLowerCase().includes(tw.toLowerCase())) {
      // Insert right after the girl's trigger word (first token before first comma)
      prompt = prompt.replace(/^([^,]+,\s*)/, `$1${tw}, `);
      console.log(`🔑 Injected enhancement trigger word "${tw}" for ${key} LoRA`);
    }
  }

  if (isPovReceivingOralPrompt(prompt) && !/first person pov from the man receiving oral/i.test(prompt)) {
    prompt = `${prompt}, ${NSFW_POS_POV_ORAL_BODY_ANCHOR}`;
    console.log("🎯 POV receiving oral: appended body-anchor tail (reduces floating / disconnected penis).");
  }

  const detectedPose = aiSelection.pose;
  const hasRunningMakeup = aiSelection.runningMakeup;
  const hasCumEffect = aiSelection.cumEffect;
  const enhancementStrengths = aiSelection.enhancementStrengths || {};
  const girlLoraStrength = aiSelection.girlStrength;

  console.log("\n🔥 ============================================");
  console.log("🔥 COMFYUI NSFW GENERATION - SUBMIT");
  console.log("🔥 ============================================");
  console.log(`📦 Girl LoRA URL: ${loraUrl}`);
  console.log(`🔑 Trigger Word: ${triggerWord}`);
  console.log(`📝 Prompt: ${prompt.substring(0, 120)}...`);
  console.log(`💪 Girl LoRA Strength: ${girlLoraStrength}${validatedOverride ? " (user override)" : " (default 0.65)"}`);
  console.log(`🎯 Additive LoRAs: disabled (identity only)`);
  console.log(`💄 Running Makeup: disabled`);
  console.log(`💦 Cum Effect: disabled`);
  const activeEnhLog = Object.entries(enhancementStrengths)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log(
    NSFW_ADDITIVE_LORAS_ENABLED
      ? `🎭 Enhancement LoRAs: ${activeEnhLog || "none"} → only these (plus pose/makeup if any) get URLs on node 250; unused slots cleared`
      : "🎭 Additive LoRAs: off — node 250 is identity LoRA only (NSFW_ENABLE_ADDITIVE_LORAS=1 to re-enable)",
  );

  const poseStrengths = {};
  POSE_LORAS.forEach(p => { poseStrengths[p.node] = 0; });
  if (detectedPose) {
    const poseStr = Math.min(MAX_ADDITIVE_LORA_STRENGTH, detectedPose.strength ?? MAX_ADDITIVE_LORA_STRENGTH);
    poseStrengths[detectedPose.node] = poseStr;
    console.log(`✅ Activated pose LoRA: ${detectedPose.id} (node ${detectedPose.node}) at strength=${poseStr}`);
  }

  const seedFromOpts = options?.seed;
  const seed =
    seedFromOpts != null && Number.isFinite(Number(seedFromOpts))
      ? Math.trunc(Number(seedFromOpts))
      : Math.floor(Math.random() * 2147483647);
  const makeupStrength = hasRunningMakeup ? MAX_ADDITIVE_LORA_STRENGTH : 0;
  const cumStrength = hasCumEffect ? MAX_ADDITIVE_LORA_STRENGTH : 0;

  const resSpec = resolveNsfwResolution(options.resolution);

  const baseSteps =
    adminBaseSamplerSteps != null && Number.isFinite(Number(adminBaseSamplerSteps))
      ? Math.min(150, Math.max(1, Math.round(Number(adminBaseSamplerSteps))))
      : 50;
  const baseCfg =
    adminBaseSamplerCfg != null && Number.isFinite(Number(adminBaseSamplerCfg))
      ? Math.min(8, Math.max(1, Number(adminBaseSamplerCfg)))
      : 2.5;
  if (adminBaseSamplerSteps != null || adminBaseSamplerCfg != null) {
    console.log(`🧪 Admin NSFW sampler override: steps=${baseSteps}, cfg=${baseCfg}`);
  }

  const workflow = buildComfyWorkflow({
    prompt,
    loraUrl,
    girlLoraStrength,
    poseStrengths,
    makeupStrength,
    cumStrength,
    enhancementStrengths,
    postProcessing: normalizedPostProcessing,
    useWorkflowPostProcessing:
      options.useWorkflowPostProcessing === true ||
      options.postProcessing?.overrideGrainBlur === true ||
      process.env.NSFW_COMFY_USE_WORKFLOW_POST === "1",
    seed,
    steps: adminBaseSamplerSteps != null ? baseSteps : undefined,
    cfg: adminBaseSamplerCfg != null ? baseCfg : undefined,
    width: resSpec.width,
    height: resSpec.height,
    aspectRatio: resSpec.aspect_ratio,
    negativePrompt: options.negativePrompt,
  });

  console.log("\n📋 ============================================");
  console.log("📋 FULL RUNPOD PAYLOAD:");
  console.log("📋 ============================================");
  console.log(JSON.stringify({ input: { prompt: workflow } }, null, 2));
  console.log("📋 ============================================\n");

  // Submit via the same generic RunPod function MCX uses — identical endpoint,
  // identical error handling, just a different ComfyUI workflow payload.
  const { submitRunpodJob } = await import("./modelcloneX.service.js");

  const runpodWebhook =
    webhookUrl ||
    (generationId
      ? resolveRunpodWebhookUrl({ generationId: String(generationId), kind: "nsfw" })
      : resolveRunpodWebhookUrl());

  const runpodJobId = await submitRunpodJob(
    {
      input: {
        prompt: workflow,
        output_node_id: "289",
        meta: generationId ? { generationId: String(generationId), kind: "nsfw" } : { kind: "nsfw" },
      },
    },
    runpodWebhook,
    "NSFW",
  );

  return {
    success: true,
    requestId: runpodJobId,
    resolvedParams: {
      girlLoraStrength,
      activePose: detectedPose ? detectedPose.id : null,
      activePoseStrength: detectedPose
        ? Math.min(MAX_ADDITIVE_LORA_STRENGTH, detectedPose.strength ?? MAX_ADDITIVE_LORA_STRENGTH)
        : 0,
      runningMakeup: hasRunningMakeup,
      runningMakeupStrength: makeupStrength,
      cumEffect: hasCumEffect,
      cumStrength: cumStrength,
      seed: seed,
      steps: baseSteps,
      cfg: baseCfg,
      width: resSpec.width,
      height: resSpec.height,
      resolutionPreset: resSpec.presetId,
      sampler: "dpmpp_2m",
      scheduler: "beta",
      refinerSteps: 8,
      refinerDenoise: 0.09,
      prompt: prompt,
      postProcessing: {
        blur: {
          enabled: normalizedPostProcessing.blur.enabled,
          strength: normalizedPostProcessing.blur.strength,
        },
        grain: {
          enabled: normalizedPostProcessing.grain.enabled,
          strength: normalizedPostProcessing.grain.strength,
        },
      },
    },
  };
}


/**
 * Generate a face reference image for face swap
 * Uses the LoRA to generate a clear frontal face photo with natural skin
 * This is the 16th training image used for automatic face swap
 * 
 * @param {string} loraUrl - URL to LoRA file
 * @param {string} triggerWord - LoRA trigger word
 * @returns {Promise<{success: boolean, requestId?: string, error?: string}>}
 */
export async function submitFaceReferenceGeneration(loraUrl, triggerWord) {
  if (!RESOLVED_FAL_KEY) {
    throw new Error("FAL_API_KEY or FAL_KEY not configured");
  }
  if (!FAL_NSFW_ENDPOINT || !FAL_NSFW_ENDPOINT.trim()) {
    console.warn("⚠️ FAL_NSFW_ENDPOINT not set — skipping face reference generation. Set it in env to enable auto face reference.");
    return { success: false, error: "FAL_NSFW_ENDPOINT is not configured" };
  }

  // Prompt optimized for face swap - frontal face, natural skin, slight grain
  const faceRefPrompt = `${triggerWord}, frontal face portrait photo, looking directly at camera, natural skin texture with slight grain, not plastic or airbrushed, neutral expression, soft natural lighting, clean background, high resolution face detail, professional portrait photography`;

  console.log("\n📸 ============================================");
  console.log("📸 FAL.AI FACE REFERENCE GENERATION (Z-Image)");
  console.log("📸 ============================================");
  console.log(`🔑 Trigger Word: ${triggerWord}`);
  console.log(`📝 Prompt: ${faceRefPrompt.substring(0, 100)}...`);

  const requestBody = {
    prompt: faceRefPrompt,
    loraurl: sanitizeLoraDownloadUrl(loraUrl),
    lorastrenght: 0.8,
    steps: 30,
    anal_doggy_scale: 0.1,
  };

  try {
    const response = await fetch(`${FAL_API_URL}/${FAL_NSFW_ENDPOINT}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${RESOLVED_FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Face reference submission failed: ${response.status}`, errorText);
      throw new Error(`Generation service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const requestId = result.request_id;

    console.log(`✅ Face reference generation submitted! Request ID: ${requestId}`);

    return {
      success: true,
      requestId: requestId,
    };
  } catch (error) {
    console.error("❌ Face reference submission error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Normalize handler output from RunPod `/status` — may be stringified JSON, nested under `output`,
 * or omit inner `status` while still including `images` (top-level job is already COMPLETED).
 */
export function normalizeRunpodNsfwOutput(raw) {
  if (raw == null) return null;
  let o = raw;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (typeof o !== "object" || o === null) return null;

  const asImageString = (img) => {
    if (typeof img === "string") return img;
    if (img?.base64) return img.base64;
    if (img?.data) return img.data;
    if (img?.image) return img.image;
    if (img?.url) return img.url;
    return null;
  };
  const hasImages = (v) => Array.isArray(v?.images) && v.images.length > 0;

  if (hasImages(o)) {
    return { ...o, images: o.images.map(asImageString).filter(Boolean) };
  }

  // Common RunPod wrapper shape: { output: { ... } }
  const inner = o.output;
  if (inner && typeof inner === "object") {
    if (hasImages(inner)) {
      return { ...inner, images: inner.images.map(asImageString).filter(Boolean) };
    }
    o = inner;
  }

  // Worker/Comfy shape: { outputs: { "<nodeId>": { images: [...] } } }
  // Prefer node 289 (SaveImage in NSFW workflow), then any node with images.
  const outputs = o?.outputs;
  if (outputs && typeof outputs === "object") {
    const preferredNodeIds = ["289", ...Object.keys(outputs).filter((k) => k !== "289")];
    for (const nodeId of preferredNodeIds) {
      const nodeOut = outputs[nodeId];
      if (!hasImages(nodeOut)) continue;
      const images = nodeOut.images.map(asImageString).filter(Boolean);
      if (images.length > 0) {
        return { ...o, images, node_id: nodeId };
      }
    }
  }

  // Legacy variant: { result: { output_nodes: { "<nodeId>": { images: [...] } } } }
  const outputNodes = o?.result?.output_nodes;
  if (outputNodes && typeof outputNodes === "object") {
    const preferredNodeIds = ["289", ...Object.keys(outputNodes).filter((k) => k !== "289")];
    for (const nodeId of preferredNodeIds) {
      const nodeOut = outputNodes[nodeId];
      if (!hasImages(nodeOut)) continue;
      const images = nodeOut.images.map(asImageString).filter(Boolean);
      if (images.length > 0) {
        return { ...o, images, node_id: nodeId };
      }
    }
  }

  // Single-image shortcuts.
  if (typeof o.base64 === "string" && o.base64.length > 100) return { ...o, images: [o.base64] };
  if (typeof o.image === "string" && o.image.length > 100) return { ...o, images: [o.image] };
  if (typeof o.data === "string" && o.data.length > 100) return { ...o, images: [o.data] };

  return o;
}

/**
 * Check status of NSFW generation on RunPod serverless
 * @param {string} jobId - RunPod job ID from submission
 * @returns {Promise<{status: string, error?: string, _runpodOutput?: object}>}
 */
export async function checkNsfwGenerationStatus(jobId) {
  if (!RUNPOD_BASE_URL) {
    return { status: "FAILED", error: "NSFW RunPod endpoint not configured" };
  }

  // Mirror the 3-attempt retry logic used by pollModelCloneXJob so both services
  // behave identically on transient network errors (same worker endpoint).
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let response;
    try {
      response = await fetch(`${RUNPOD_BASE_URL}/status/${jobId}`, {
        headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (fetchErr) {
      clearTimeout(timer);
      lastErr = fetchErr;
      if (fetchErr.name === "TimeoutError" || fetchErr.name === "AbortError") {
        return { status: "IN_PROGRESS" };
      }
      const cause = fetchErr.cause?.message || fetchErr.cause?.code || "";
      console.warn(
        `[NSFW poll] attempt ${attempt}/3 fetch error for ${jobId}: ${fetchErr.message}${cause ? ` (${cause})` : ""}`,
      );
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }

    if (!response.ok) {
      if (response.status === 404) {
        // RunPod can return transient 404 shortly after /run submit before the job
        // becomes visible on /status. Treat it as still queued/in-progress so we
        // do not fail generations prematurely.
        console.warn(
          `⚠️ RunPod job ${jobId} not found yet (404) on endpoint ${RUNPOD_ENDPOINT_ID} — treating as IN_QUEUE`,
        );
        return { status: "IN_QUEUE" };
      }
      const errorText = await response.text();
      throw new Error(`Generation status check failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const runpodStatus = result.status;

    if (result.error && !runpodStatus) {
      const errStr = String(result.error || "");
      // RunPod returns this when the job ID doesn't exist yet or data was cleaned up —
      // same as a 404: treat as still queued so we don't prematurely fail the generation.
      if (/not found|may have expired|job.*expired|expired/i.test(errStr)) {
        console.warn(`⚠️ RunPod job ${jobId} not found / expired (error body) — treating as IN_QUEUE`);
        return { status: "IN_QUEUE" };
      }
      console.warn(`⚠️ RunPod job ${jobId} error response: ${result.error}`);
      return { status: "FAILED", error: `RunPod: ${result.error}` };
    }

    if (runpodStatus === "COMPLETED") {
      const output = normalizeRunpodNsfwOutput(result.output ?? result);
      if (!output) {
        console.warn(`⚠️ RunPod job COMPLETED but output missing or unparsable`, String(result.output)?.slice(0, 200));
        return { status: "FAILED", error: "No valid output from RunPod" };
      }
      if (output.error) {
        console.error(`❌ RunPod job completed with error: ${output.error}`);
        return { status: "FAILED", error: String(output.error) };
      }
      if (output.images?.length > 0) {
        console.log(`✅ RunPod job ${jobId} completed with ${output.images.length} image(s)`);
        return { status: "COMPLETED", _runpodOutput: output };
      }
      console.warn(`⚠️ RunPod job completed but no images in output`, JSON.stringify(output)?.slice(0, 400));
      return { status: "FAILED", error: output.error || "No images in RunPod output" };
    }

    if (runpodStatus === "FAILED") {
      const errorMsg = result.output?.error || result.error || "Generation failed";
      // RunPod returns FAILED with "not found / may have expired" when job data is cleaned up.
      // This is not a real generation failure — the job may have completed via webhook already.
      // Treat the same as a 404: return IN_QUEUE so the watchdog doesn't kill the generation.
      if (/not found|may have expired|job.*expired|expired/i.test(String(errorMsg))) {
        console.warn(`⚠️ RunPod job ${jobId} not found / expired (FAILED status) — treating as IN_QUEUE`);
        return { status: "IN_QUEUE" };
      }
      console.error(`❌ RunPod job ${jobId} FAILED: ${errorMsg}`);
      return { status: "FAILED", error: errorMsg };
    }

    if (runpodStatus === "CANCELLED") {
      return { status: "FAILED", error: "Generation was cancelled" };
    }

    if (runpodStatus === "IN_QUEUE") {
      return { status: "IN_QUEUE" };
    }

    return { status: "IN_PROGRESS" };
  }

  // All 3 attempts exhausted due to network errors
  console.error(`❌ RunPod status check failed after 3 attempts for ${jobId}:`, lastErr?.message);
  throw lastErr || new Error(`NSFW status check failed after 3 attempts`);
}

/**
 * Poll a RunPod NSFW job — **queue time does not count** toward running timeout (RunPod can sit IN_QUEUE a long time).
 * @param {string} jobId
 * @param {number} runningTimeoutMs  Max ms in IN_PROGRESS / running (default 90 min)
 * @param {number} maxWallMs  Absolute max since poll start, including queue (default 180 min)
 * @returns {Promise<{ phase: string, result?: object, error?: string }>}
 */
export async function pollNsfwJob(
  jobId,
  runningTimeoutMs = 90 * 60 * 1000,
  maxWallMs = 180 * 60 * 1000,
) {
  const wallStart = Date.now();
  let runningStart = null;
  let attempt = 0;

  while (Date.now() - wallStart < maxWallMs) {
    attempt++;
    await new Promise((r) => setTimeout(r, attempt === 1 ? 3_000 : 5_000));

    let status;
    try {
      status = await checkNsfwGenerationStatus(jobId);
    } catch (err) {
      const cause = err.cause?.message || err.cause?.code || "";
      console.warn(`[NSFW poll] Fetch error for ${jobId}: ${err.message}${cause ? ` (${cause})` : ""} — retrying`);
      continue;
    }

    if (status.status === "COMPLETED") {
      return { phase: "done", result: { _runpodOutput: status._runpodOutput } };
    }
    if (status.status === "FAILED") {
      return { phase: "done", error: status.error || "Generation failed on ComfyUI" };
    }

    if (status.status === "IN_QUEUE") {
      runningStart = null;
      continue;
    }

    // IN_PROGRESS (or unknown treat as running)
    if (runningStart === null) runningStart = Date.now();
    if (Date.now() - runningStart > runningTimeoutMs) {
      throw new Error(
        `NSFW job ${jobId} timed out after ${Math.round(runningTimeoutMs / 60000)} min in progress`,
      );
    }
  }

  throw new Error(
    `NSFW job ${jobId} exceeded wall time (${Math.round(maxWallMs / 60000)} min) — still queued or running`,
  );
}

/**
 * Get NSFW generation result from RunPod serverless
 * RunPod handler returns base64 images - we decode and upload to R2
 * @param {string} jobId - RunPod job ID
 * @param {object} cachedOutput - Optional cached output from status check
 * @returns {Promise<{outputUrl: string, outputUrls: string[], basicImageUrls: string[], rawResult: object}>}
 */
export async function getNsfwGenerationResult(jobId, cachedOutput = null) {
  try {
    let output = cachedOutput;

    if (!output) {
      if (!RUNPOD_BASE_URL) {
        throw new Error("NSFW RunPod endpoint not configured");
      }
      const response = await fetch(`${RUNPOD_BASE_URL}/status/${jobId}`, {
        headers: {
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Generation result fetch failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      if (result.status !== "COMPLETED" || result.output == null) {
        throw new Error(`Generation not completed: ${result.status}`);
      }
      output = normalizeRunpodNsfwOutput(result.output ?? result);
    } else {
      output = normalizeRunpodNsfwOutput(output);
    }

    if (!output?.images?.length) {
      throw new Error("Generation completed but returned no images");
    }

    console.log(`📦 RunPod output: ${output.images.length} image(s) from node ${output.images[0]?.node_id || "unknown"}`);

    const outputUrls = [];
    for (const img of output.images) {
      const b64 =
        typeof img === "string"
          ? img
          : (img?.base64 ?? img?.data ?? img?.image ?? null);
      if (!b64 || typeof b64 !== "string") {
        const keys = img && typeof img === "object" ? Object.keys(img) : [];
        console.warn(`⚠️ RunPod image entry missing base64`, keys);
        continue;
      }
      const buffer = Buffer.from(b64, "base64");
      if (isVercelBlobConfigured() || isR2Configured()) {
        const r2Url = await uploadBufferToBlobOrR2(buffer, "nsfw-generations", "png", "image/png");
        outputUrls.push(r2Url);
        console.log(`✅ Image uploaded: ${r2Url}`);
      } else {
        const dataUrl = `data:image/png;base64,${b64}`;
        outputUrls.push(dataUrl);
        console.warn(`⚠️ No durable storage configured, using data URL (temporary!)`);
      }
    }

    if (outputUrls.length === 0) {
      throw new Error("Generation returned image entries but none had valid base64 data");
    }

    console.log(`✅ NSFW generation completed! ${outputUrls.length} image(s) stored`);

    return {
      outputUrl: outputUrls[0],
      outputUrls,
      basicImageUrls: outputUrls,
      upscaledImageUrls: [],
      rawResult: output,
    };
  } catch (error) {
    console.error("❌ RunPod result fetch error:", error.message);
    throw error;
  }
}

/**
 * Archive generated NSFW image to R2
 * @param {string} imageUrl - ComfyUI /view URL or any temporary image URL
 * @returns {Promise<string>} Permanent R2 URL
 */
export async function archiveNsfwImageToR2(imageUrl) {
  if (!isVercelBlobConfigured() && !isR2Configured()) {
    console.warn("⚠️ No durable storage configured, returning source URL (temporary!)");
    return imageUrl;
  }

  try {
    console.log(`📥 Downloading NSFW image from ComfyUI...`);

    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";

    let extension = "png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      extension = "jpg";
    } else if (contentType.includes("webp")) {
      extension = "webp";
    }

    const r2Url = await uploadBufferToBlobOrR2(
      buffer,
      "nsfw-generations",
      extension,
      contentType,
    );
    console.log(`✅ NSFW image archived: ${r2Url}`);

    return r2Url;
  } catch (error) {
    console.error(`⚠️ Failed to archive NSFW image to R2: ${error.message}`);
    return imageUrl;
  }
}

// ============================================
// FACE SWAP (for NSFW post-processing)
// ============================================

/**
 * Submit a faceswap job to fal.ai without polling — returns the requestId immediately.
 * Use this for webhook-driven flows; pair with POST /api/fal/webhook/faceswap callback.
 * @param {string} generatedImageUrl - Image to swap faces into
 * @param {string} faceReferenceUrl - Reference face to swap in
 * @param {string|null} webhookUrl - Webhook URL for completion notification
 * @returns {Promise<string>} requestId
 */
export async function submitFaceSwapJob(generatedImageUrl, faceReferenceUrl, webhookUrl = null) {
  if (!RESOLVED_FAL_KEY) throw new Error("FAL_API_KEY or FAL_KEY not configured");

  const requestBody = { naSwap: generatedImageUrl, ksicht: faceReferenceUrl };
  if (webhookUrl) requestBody.webhook_url = webhookUrl;

  const response = await fetch(`${FAL_API_URL}/comfy/modelclone/faceswap`, {
    method: "POST",
    headers: {
      Authorization: `Key ${RESOLVED_FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`faceswap submission failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const requestId = result.request_id ?? result.requestId;
  if (!requestId) throw new Error("faceswap submission: no request_id in response");
  return requestId;
}

/**
 * Face swap using FAL.ai ComfyUI workflow
 * Endpoint: comfy/modelclone/faceswap
 * @param {string} generatedImageUrl - The generated image that needs face swapping (naSwap)
 * @param {string} faceReferenceUrl - The reference face image to swap in (ksicht)
 * @returns {Promise<{success: boolean, outputUrl?: string, error?: string}>}
 */
export async function faceSwapWithFal(generatedImageUrl, faceReferenceUrl) {
  if (!RESOLVED_FAL_KEY) {
    throw new Error("FAL_API_KEY or FAL_KEY not configured");
  }

  console.log("\n🔄 ============================================");
  console.log("🔄 FAL.AI FACE SWAP - SUBMIT");
  console.log("🔄 ============================================");
  console.log(`📸 Generated Image: ${generatedImageUrl.substring(0, 80)}...`);
  console.log(`👤 Face Reference: ${faceReferenceUrl.substring(0, 80)}...`);

  const requestBody = {
    naSwap: generatedImageUrl,
    ksicht: faceReferenceUrl,
  };

  try {
    // Submit faceswap request
    const response = await fetch(`${FAL_API_URL}/comfy/modelclone/faceswap`, {
      method: "POST",
      headers: {
        Authorization: `Key ${RESOLVED_FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ fal.ai faceswap submission failed: ${response.status}`, errorText);
      throw new Error(`Generation service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const requestId = result.request_id;

    console.log(`✅ Faceswap submitted! Request ID: ${requestId}`);

    // Poll for result
    const outputUrl = await pollFaceSwapResult(requestId);

    // Archive to R2
    const archivedUrl = await archiveNsfwImageToR2(outputUrl);

    console.log("🔄 ============================================");
    console.log("🔄 FAL.AI FACE SWAP COMPLETE!");
    console.log(`🔄 Output URL: ${archivedUrl}`);
    console.log("🔄 ============================================");

    return {
      success: true,
      outputUrl: archivedUrl,
    };
  } catch (error) {
    console.error("❌ fal.ai faceswap error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Poll for face swap completion
 * @param {string} requestId - Request ID from submission
 * @param {number} maxAttempts - Maximum polling attempts (default 60 = 3 minutes)
 * @returns {Promise<string>} Output image URL
 */
async function pollFaceSwapResult(requestId, maxAttempts = 60) {
  console.log(`⏳ Polling faceswap result...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay

    try {
      const response = await fetch(
        `${FAL_API_URL}/comfy/modelclone/faceswap/requests/${requestId}/status`,
        {
          headers: {
            Authorization: `Key ${RESOLVED_FAL_KEY}`,
          },
        }
      );

      if (!response.ok) {
        console.warn(`⚠️ Faceswap poll ${attempt + 1} failed: ${response.status}`);
        continue;
      }

      const result = await response.json();
      const status = result.status;

      console.log(`  Poll ${attempt + 1}/${maxAttempts} - Status: ${status}`);

      if (status === "COMPLETED") {
        // Get the result
        const resultResponse = await fetch(
          `${FAL_API_URL}/comfy/modelclone/faceswap/requests/${requestId}`,
          {
            headers: {
              Authorization: `Key ${RESOLVED_FAL_KEY}`,
            },
          }
        );

        if (!resultResponse.ok) {
          throw new Error(`Failed to fetch faceswap result: ${resultResponse.status}`);
        }

        const finalResult = await resultResponse.json();
        
        // Extract output URL from ComfyUI workflow result
        // Structure: { outputs: { "249": { images: [{ url: "..." }] } } }
        const outputs = finalResult.outputs || {};
        
        // Try to find images in any output node (ComfyUI uses numeric keys like "249")
        for (const nodeId of Object.keys(outputs)) {
          const nodeOutput = outputs[nodeId];
          if (nodeOutput?.images && nodeOutput.images.length > 0) {
            const imageUrl = nodeOutput.images[0].url;
            if (imageUrl) {
              console.log(`✅ Found faceswap output in node ${nodeId}: ${imageUrl.substring(0, 60)}...`);
              return imageUrl;
            }
          }
        }
        
        // Fallback: check for direct images array
        const images = finalResult.images || finalResult.data?.images || [];
        if (images.length > 0) {
          return images[0].url || images[0];
        }

        console.log("📦 Faceswap result structure:", JSON.stringify(finalResult, null, 2));
        throw new Error("No output URL found in faceswap result");
      }

      if (status === "FAILED") {
        throw new Error(`Faceswap failed: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      if (error.message.includes("Faceswap failed")) {
        throw error;
      }
      console.warn(`⚠️ Faceswap poll error: ${error.message}`);
    }
  }

  throw new Error(`Faceswap timed out after ${maxAttempts * 3} seconds`);
}
