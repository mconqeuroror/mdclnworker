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
import { isR2Configured, uploadBufferToR2, uploadToR2 } from "../utils/r2.js";
import { sanitizeLoraDownloadUrl } from "../utils/loraUrl.js";
import { resolveNsfwResolution } from "../utils/nsfwResolution.js";
// dynamicPoll removed — inline polling used directly

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** fal.ai key: official docs use `FAL_KEY`; this repo historically used `FAL_API_KEY` — accept both. */
const RESOLVED_FAL_KEY = (process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
const FAL_API_URL = "https://queue.fal.run";
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

  try {
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) throw new Error(`Fetch failed: ${imgResponse.status}`);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
    const b64 = imgBuffer.toString("base64");

    const { default: OpenAI } = await import("openai");
    const grok = new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const completion = await grok.chat.completions.create({
      model: "x-ai/grok-4.1-fast",
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: buildCaptionSystemPrompt(triggerWord, captionSubjectClass),
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Caption this training image following the rules exactly. Output ONLY the caption text, nothing else." },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${b64}` } },
          ],
        },
      ],
    });

    const caption = (completion.choices?.[0]?.message?.content || "").trim();
    if (!caption) return null;

    let finalCaption = caption.startsWith(triggerWord) ? caption : `${triggerWord} ${caption}`;
    if (captionSubjectClass) {
      finalCaption = enforceCaptionSubjectClass(finalCaption, triggerWord, captionSubjectClass);
    }
    console.log(`  📝 Caption ${index + 1}: ${finalCaption.substring(0, 80)}...`);
    return finalCaption;
  } catch (error) {
    console.error(`  ⚠️ Caption failed for image ${index + 1}:`, error.message);
    return null;
  }
}

/**
 * Caption all training images in parallel batches.
 * Returns array of caption strings (or null for failed captions), same length as imageUrls.
 */
async function captionAllTrainingImages(imageUrls, triggerWord, captionSubjectClass = null) {
  console.log(`\n📝 ============================================`);
  console.log(`📝 CAPTIONING ${imageUrls.length} TRAINING IMAGES`);
  console.log(`📝 Trigger word: ${triggerWord}`);
  if (captionSubjectClass) {
    console.log(`📝 Locked subject class (from model gender): ${captionSubjectClass}`);
  }
  console.log(`📝 ============================================`);

  const BATCH_SIZE = 5;
  const results = new Array(imageUrls.length).fill(null);

  for (let batch = 0; batch < imageUrls.length; batch += BATCH_SIZE) {
    const slice = imageUrls.slice(batch, batch + BATCH_SIZE);
    const batchPromises = slice.map((url, i) =>
      captionSingleImage(url, triggerWord, batch + i, captionSubjectClass)
    );
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((caption, i) => {
      results[batch + i] = caption;
    });
    console.log(`  ✅ Batch ${Math.floor(batch / BATCH_SIZE) + 1} done (${Math.min(batch + BATCH_SIZE, imageUrls.length)}/${imageUrls.length})`);
  }

  const captionedCount = results.filter(Boolean).length;
  console.log(`📝 Captioned ${captionedCount}/${imageUrls.length} images successfully`);

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
    const MAX_FETCH_ATTEMPTS = 3;
    let lastErr;
    let added = false;
    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(imageUrls[i], { signal: AbortSignal.timeout(30_000) });
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
  if (!isR2Configured()) {
    throw new Error("R2 storage not configured - required for LoRA training");
  }

  const url = await uploadBufferToR2(
    zipBuffer,
    "lora-training",
    "zip",
    "application/zip",
  );
  console.log(`✅ Training ZIP uploaded to R2: ${url}`);
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
      result: result.response_url ? null : result, // Result is in response_url when completed
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
};

// ============================================
// NSFW IMAGE GENERATION (Self-hosted ComfyUI on Runpod)
// ============================================

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || "0uskdglppin5ey";
const RUNPOD_BASE_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

if (!RUNPOD_API_KEY) {
  console.warn("⚠️ RUNPOD_API_KEY not set - NSFW generation will not work");
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
  {
    id: "cowgirl",
    node: "292",
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
  deepthroat: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/bjz.safetensors",
    name: "Deepthroat/Blowjob",
    strengthRange: [0.25, 0.35],
    defaultStrength: 0.35,
  },
  dildo: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/dildo.safetensors",
    name: "Dildo",
    strengthRange: [0.25, 0.35],
    defaultStrength: 0.35,
  },
};

const RUNNING_MAKEUP_NODE = "296";
const CUM_NODE = "303";
const RUNNING_MAKEUP_KEYWORDS = ["running makeup", "smeared makeup", "mascara running", "ruined makeup", "crying makeup", "makeup running", "smeared mascara"];

/** Pose LoRA files (node ids 290–295); applied in POSE_LORAS order, compacted after identity in node 250. */
/** Literal spaces in path — avoid %20 here or encodeURI turns % into %25 → broken %2520 */
const POSE_SLOT_URLS = {
  "290": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Doggystyle facing the camera.safetensors",
  "291": "https://huggingface.co/bigckck/ndmstr/resolve/main/Missionnary.safetensors",
  "292": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Cowgirl.safetensors",
  "293": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Anal Doggystyle.safetensors",
  "294": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_Handjob.safetensors",
  "295": "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_POV_Missionary_Anal.safetensors",
};
const LORA_8_RUNNING_MAKEUP_URL = "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_Running_makeup.safetensors";

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

function comfyUiGraphToApiPrompt(nodes, links, extra) {
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
 * We strip: Crystools (257), GetNode (288), String Literal (41,56), Fast Groups Bypasser (61), PrimitiveFloat (298,290-296).
 */
const UNSUPPORTED_NODE_IDS = [
  "257", "288", "41", "56", "61",
  "298", "290", "291", "292", "293", "294", "295", "296",
  // Primitive wrappers (PrimitiveFloat / Crystools integer) inlined by comfyUiGraphToApiPrompt;
  // listed here as a safety net for the NSFW_COMFY_STRIP_UNSUPPORTED path.
  "305", "306", "311",
  // DF_Integer aspect helpers (derfuu_comfyui_moddednodes) — inlined by converter
  "302", "303",
];

/**
 * Remove unsupported nodes (String Literal, Primitive string, GetNode, Fast Groups Bypasser, Crystools, PrimitiveFloat) and
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
  if (nsfwCoreWorkflowCache) return nsfwCoreWorkflowCache;
  const candidates = [
    path.join(process.cwd(), "attached_assets", "nsfw_core_workflow.json"),
    path.join(__dirname, "..", "..", "attached_assets", "nsfw_core_workflow.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        const data = JSON.parse(raw);
        nsfwCoreWorkflowCache = comfyUiGraphToApiPrompt(data.nodes, data.links, data.extra);
        return nsfwCoreWorkflowCache;
      }
    } catch (e) {
      console.warn("NSFW core workflow load failed:", p, e?.message);
    }
  }
  return null;
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

  const systemPrompt = `You are a LoRA selector for AI image generation. You receive the FULL generation context and make ALL LoRA decisions in one pass.

CONTEXT PROVIDED:
- Scene Description (user's original idea): "${sceneDescription}"
- Chip Selections (UI toggles the user picked): ${chipSummary || "none"}
- Final Prompt (AI-enhanced text that will be sent to the model): "${finalPrompt}"

Your job: Analyze ALL of the above together to determine the best LoRA configuration.

AVAILABLE POSE LORAS (pick EXACTLY ONE or "none"):
${poseList}

RULES FOR POSE SELECTION:
- CRITICAL: If the prompt contains "missionary sex" OR ("missionary" AND ("penis" OR "penetrating" OR "pussy" OR "labia" OR "shaft" OR "intercourse")) you MUST set pose to "missionary" (vaginal missionary), NOT "none".
- If the prompt describes anal sex in doggy / rear entry (anal + doggy / from behind), use pose "anal_doggystyle" (NOT "titjob" — that id was removed).
- ONLY select a pose if the scene EXPLICITLY shows that EXACT sex position being performed
- "bent over" alone is NOT doggystyle - it must explicitly describe doggy style sex
- "from behind" alone is NOT anal - there must be explicit anal penetration
- "kneeling" is NOT any pose - it's just a body position (kneeling + blowjob = pose "none", deepthroat enhancement ON)
- "lying in bed" is NOT missionary - there must be explicit missionary sex OR missionary + penetration words
- If the prompt describes oral sex (blowjob, deepthroat, mouth on penis, penis in mouth), select "none" for pose ALWAYS — even if it says one hand on shaft (normal for POV blowjob). NEVER select "handjob" for those scenes — handjob pose + oral text causes duplicate penis mutations.
- Mirror selfie / casual girlfriend nude (no partnered sex act): set amateur_nudes to 0.25-0.35 even if pose is "none".
- If unsure, select "none" - it's better to have no pose LoRA than the wrong one

ENHANCEMENT LORAS (each can be independently activated; strengths 0.25-0.35 only, NEVER above 0.35):
- "amateur_nudes": Casual girlfriend-style nude photos. Activate for: casual nude selfies, gf nudes, naked in bed/couch/mirror, relaxed nude poses, topless casual moments, sending nudes, lounging naked. Use 0.25-0.35 max.
- "deepthroat": Blowjob and deepthroat oral sex. Activate for: blowjob, deepthroat, oral sex, sucking, on knees giving head, mouth around cock, licking, oral. Strength 0.25-0.35 max.
- "masturbation": Solo masturbation scenes. Activate for: masturbating, fingering herself, touching herself, hand between legs/thighs, playing with herself, rubbing pussy. Strength 0.25-0.35 max.
- "dildo": Using a dildo/vibrator/toy. Activate for: dildo, vibrator, sex toy, inserting toy, using toy on herself. Strength 0.25-0.35 max.

RULES FOR ENHANCEMENT LORAS:
- Multiple CAN be active simultaneously (e.g. amateur_nudes + masturbation for casual gf masturbating)
- amateur_nudes stacks well with masturbation or dildo for the casual/gf aesthetic
- For ANY blowjob/oral/deepthroat scene: set deepthroat to 0.30-0.35 and pose to "none"
- deepthroat should NOT combine with masturbation or dildo (incompatible acts)
- Look at the FULL context: if chips say "on knees" + prompt mentions "mouth" or "oral" = activate deepthroat
- Look at outfit chips: if outfit is "nude"/"naked"/"topless" + casual scene = consider amateur_nudes
- Set strength 0.25-0.35 only (NEVER exceed 0.35)
- If the scene doesn't match any enhancement, set its strength to 0

${girlStrengthSection}

RUNNING MAKEUP:
- Set to true ONLY if the prompt explicitly mentions smeared/running/ruined/crying makeup or mascara

CUM EFFECT:
- Set to true ONLY if the prompt explicitly mentions cum/cumshot/creampie/facial cum/cum on body

OUTPUT: Return ONLY valid JSON on one line, no explanation:
{"pose":"<pose_id or none>","girl_strength":0.XX,"amateur_nudes":0.XX,"deepthroat":0.XX,"masturbation":0.XX,"dildo":0.XX,"makeup":false,"cum":false}`;

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
        messages: [{ role: "user", content: systemPrompt }],
      }),
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
      if (!isNaN(raw) && raw >= 0.35 && raw <= MAX_ADDITIVE_LORA_STRENGTH) {
        enhancementStrengths[key] = raw;
      } else if (!isNaN(raw) && raw > 0) {
        enhancementStrengths[key] = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0.35, raw));
      } else {
        enhancementStrengths[key] = 0;
      }
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
    cowgirl: "Cowgirl / riding position - girl sitting on top, straddling, riding. Covers cowgirl, reverse cowgirl, girl-on-top positions.",
    anal_doggystyle:
      "Anal sex in doggy / rear-entry position — girl on all fours or bent over with rear anal penetration visible. Matches workflow LoRA slot (not titfuck).",
    handjob:
      "Handjob ONLY — stroking/jerking penis with hand(s) as the main act, no mouth on penis. If the mouth is on the penis (blowjob), this is WRONG — use pose 'none' + deepthroat enhancement instead.",
    missionary_anal: "Anal sex in missionary position - girl on her back during anal penetration",
  };
  return descriptions[poseId] || poseId;
}

/**
 * Blowjob/oral prompts often mention a hand on shaft — the AI wrongly picks handjob pose LoRA,
 * which stacks a second phallus/handjob prior with oral. Oral scenes must use pose none + deepthroat LoRA only.
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

/**
 * Server-side guard after Grok: never stack pose LoRAs on oral; ensure deepthroat enhancement is on; strip incompatible enhancers.
 */
function applyOralBlowjobLoraPolicy(aiSelection, fullPromptText) {
  if (!isOralBlowjobScenePrompt(fullPromptText)) return;

  if (aiSelection.pose) {
    console.warn(
      `🛡️ Oral/blowjob scene — cleared pose LoRA "${aiSelection.pose.id}" (prevents handjob/doggy + oral double-penis artifacts; use deepthroat slot only).`
    );
    aiSelection.pose = null;
  }

  aiSelection.enhancementStrengths = { ...(aiSelection.enhancementStrengths || {}) };
  const cur = Number(aiSelection.enhancementStrengths.deepthroat) || 0;
  if (cur < 0.35) {
    aiSelection.enhancementStrengths.deepthroat = 0.45;
    console.log("🛡️ Oral scene: enabling deepthroat enhancement LoRA (min 0.45).");
  }
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
    /\b(cowgirl|reverse cowgirl|riding)\b.*\b(penis|sex|straddl)\b/,
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
 * After Grok: force pose / amateur_nudes when keywords are unambiguous (reduces "no LoRA" failures).
 */
function applyExplicitPoseHeuristic(aiSelection, fullPromptText) {
  const t = String(fullPromptText || "").toLowerCase();
  const enh = { ...(aiSelection.enhancementStrengths || {}) };

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
  } else if (/\bcowgirl\b/.test(t) && /\b(straddl|riding|on top)\b/.test(t)) {
    setPose("cowgirl");
  }

  if (
    (/\bmirror selfie\b/.test(t) || (/\bmirror\b/.test(t) && /\biphone\b/.test(t))) &&
    (!enh.amateur_nudes || Number(enh.amateur_nudes) < 0.35)
  ) {
    enh.amateur_nudes = MAX_ADDITIVE_LORA_STRENGTH;
    aiSelection.enhancementStrengths = enh;
    console.log(`🎯 Heuristic: amateur_nudes ${MAX_ADDITIVE_LORA_STRENGTH} (mirror selfie)`);
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
    const dt = Number(hint.deepthroat);
    enh.deepthroat = Number.isFinite(dt) && dt >= 0.25
      ? Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(Number(enh.deepthroat) || 0, dt))
      : Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(Number(enh.deepthroat) || 0, 0.35));
    enh.masturbation = 0;
    enh.dildo = 0;
    for (const k of Object.keys(enh)) {
      const v = Number(enh[k]);
      if (Number.isFinite(v) && v > MAX_ADDITIVE_LORA_STRENGTH) enh[k] = MAX_ADDITIVE_LORA_STRENGTH;
    }
    aiSelection.enhancementStrengths = enh;
    console.log(`📦 Pack additive hint: oral — deepthroat=${enh.deepthroat}`);
    return;
  }

  // Solo / girlfriend rows: only amateur_nudes in hint — drop spurious pose LoRA from softened Grok text.
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

  if (hint.amateurNudes != null) {
    const a = Number(hint.amateurNudes);
    if (Number.isFinite(a)) {
      enh.amateur_nudes = Math.min(
        MAX_ADDITIVE_LORA_STRENGTH,
        Math.max(Number(enh.amateur_nudes) || 0, a),
      );
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
    const v = Number(enh[k]);
    if (Number.isFinite(v) && v > MAX_ADDITIVE_LORA_STRENGTH) enh[k] = MAX_ADDITIVE_LORA_STRENGTH;
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
 * Build ordered LoRA stack entries (identity → optional pose → optional makeup → up to 2 enhancements).
 * Only includes weights that are actually used — no placeholder URLs at strength 0.
 */
export function buildNsfwLoraStackEntries({
  loraUrl,
  girlLoraStrength,
  poseStrengths = {},
  makeupStrength = 0,
  enhancementStrengths = {},
}) {
  const entries = [];
  const gUrl = loraUrl ? String(loraUrl).trim() : "";
  const gStr = Math.min(1, Math.max(0, Number(girlLoraStrength) || 0.6));
  if (gUrl) {
    entries.push({ url: sanitizeLoraDownloadUrl(gUrl), strength: gStr });
  }

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

  const enhOrder = ["deepthroat", "amateur_nudes", "masturbation", "dildo"];
  let enhAdded = 0;
  for (const key of enhOrder) {
    if (entries.length >= 10 || enhAdded >= MAX_SIMULTANEOUS_ENHANCEMENT_LORAS) break;
    const raw = Number(enhancementStrengths[key]) || 0;
    if (raw <= 0) continue;
    const meta = ENHANCEMENT_LORAS[key];
    if (!meta?.url) continue;
    const s = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0.35, raw));
    entries.push({ url: sanitizeLoraDownloadUrl(meta.url), strength: s });
    enhAdded += 1;
  }

  return entries.slice(0, 10);
}

/**
 * Pack stack into LoadLoraFromUrlOrPath node: lora_1..lora_N contiguous, rest empty, num_loras = N.
 * Avoids loading unused Hugging Face weights (URLs cleared, not left at strength 0).
 */
export function applyCompactLoraStackToNode250(node250, entries) {
  if (!node250?.inputs) return;
  const n = entries.length;
  for (let i = 0; i < 10; i++) {
    const idx = i + 1;
    const e = entries[i];
    const p = `lora_${idx}_`;
    if (e?.url) {
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
 * Patched: positive (56), LoRA stack (250/298/305/306/311), aspect (302/303), seed (57 when passed).
 * Negative (41): only replaced when `negativePrompt` is explicitly non-empty.
 * Grain/blur (284/286): only when `useWorkflowPostProcessing` / `NSFW_COMFY_USE_WORKFLOW_POST` / `overrideGrainBlur`.
 * Base KSampler (276) steps/cfg: only when `steps`/`cfg` are passed (e.g. admin sampler override).
 * Refiner negative rewiring (45: 1→8): **on by default** (RunPod needs SDXL pooled neg). Set `NSFW_COMFY_REFINER_FIX_SDXL=0` for strict desktop parity (may crash encode_adm).
 * String Literal nodes 41/56 are stripped for API; text is inlined into 1,8 / 2,42.
 * Falls back to legacy inline workflow if the JSON is missing.
 */
function buildComfyWorkflow(params) {
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
    
    // Additive LoRAs (pose / makeup / cum / enhancement) — disabled until further notice.
    // Only the girl identity LoRA (slot 1) is loaded; num_loras is always 1.
    const additives = [];

    // Compact slot assignment — no gaps.
    const additive1Url      = additives[0]?.url      ?? "";
    const additive1Strength = additives[0]?.strength ?? 0;
    const additive2Url      = additives[1]?.url      ?? "";
    const additive2Strength = additives[1]?.strength ?? 0;

    // num_loras: how many LoRAs LoadLoraFromUrlOrPath should actually load.
    const activeLorasCount = 1 + additives.length;

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
    
    // Node 302 / 303: DF_Integer "aspect_width" / "aspect_height" — these are the connected inputs to
    // CR SDXL Aspect Ratio (node 50).  The workflow has swap_dimensions="On" which swaps them, so:
    //   final_width  = node303 value (height input, after swap becomes width)
    //   final_height = node302 value (width input, after swap becomes height)
    // We apply 2× scale (matching the v8 workflow's native resolution e.g. 1536×2688 for 9:16).
    // Do NOT touch node50 aspect_ratio/swap_dimensions — they are locked in the workflow file.
    const node302 = findNode(302); // provides "width input" → after swap = final HEIGHT
    if (node302 && node302.widgets_values && node302.widgets_values.length > 0) {
      node302.widgets_values[0] = (Number(height) || 768) * 2;
    }

    const node303 = findNode(303); // provides "height input" → after swap = final WIDTH
    if (node303 && node303.widgets_values && node303.widgets_values.length > 0) {
      node303.widgets_values[0] = (Number(width) || 1344) * 2;
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
    
    // Node 250: LoadLoraFromUrlOrPath — patch URLs in widgets_values BEFORE conversion.
    // URLs are at indices 3, 7, 11, 15, ... (every 4th index starting from 3, accounting for linked strength inputs).
    const node250 = findNode(250);
    if (node250 && node250.widgets_values && node250.widgets_values.length >= 11) {
      const safeLora = loraUrl ? sanitizeLoraDownloadUrl(String(loraUrl).trim()) : "";
      // additive URLs are already sanitized when pushed into the additives[] array above.
      const safeAdd1 = additive1Url;
      const safeAdd2 = additive2Url;
      node250.widgets_values[3] = safeLora;   // lora_1_url
      node250.widgets_values[7] = safeAdd1;  // lora_2_url
      node250.widgets_values[11] = safeAdd2; // lora_3_url
    }
    
    // Node 57: Seed (rgthree) — patch seed in widgets_values BEFORE conversion.
    if (seed != null) {
      const node57 = findNode(57);
      if (node57 && node57.widgets_values && node57.widgets_values.length > 0) {
        node57.widgets_values[0] = seed;
      }
    }

    const negativeTextForInline = findNode(41)?.widgets_values?.[0] ?? "";

    // Convert graph to API format
    const apiWorkflow = comfyUiGraphToApiPrompt(workflowGraph.nodes, workflowGraph.links, workflowGraph.extra);

    // ALWAYS strip String Literal nodes (41, 56) — comfy-image-saver is not on RunPod.
    // Inline text directly into the CLIPTextEncode nodes that reference them.
    if (apiWorkflow["41"] || apiWorkflow["56"]) {
      // Node 41 (negative) → node 1; node 56 (positive) → node 2.
      // Check by reference so this stays correct if the workflow is rewired later.
      for (const id of Object.keys(apiWorkflow)) {
        const n = apiWorkflow[id];
        if (!n?.inputs) continue;
        if (Array.isArray(n.inputs.text)) {
          if (String(n.inputs.text[0]) === "41") n.inputs.text = negativeTextForInline;
          if (String(n.inputs.text[0]) === "56") n.inputs.text = prompt || "";
        }
      }
      delete apiWorkflow["41"];
      delete apiWorkflow["56"];
    }

    // UltimateSDUpscale bypass: if the worker image doesn't have ssitu/ComfyUI_UltimateSDUpscale yet,
    // remove node 323 (UltimateSDUpscale) and node 329 (UpscaleModelLoader) and rewire any downstream
    // nodes that took input from node 323 to take from node 25 (VAEDecode) instead.
    // Default: ON (bypass) until the new worker image with UltimateSDUpscale is deployed.
    // Set NSFW_COMFY_UPSCALE=1 to pass UltimateSDUpscale through once the worker is rebuilt.
    if (process.env.NSFW_COMFY_UPSCALE !== "1" && apiWorkflow["323"]) {
      const upscaleInput = apiWorkflow["323"]?.inputs?.image;
      const fallbackImageRef = Array.isArray(upscaleInput) ? upscaleInput : ["25", 0];
      for (const n of Object.values(apiWorkflow)) {
        if (!n?.inputs) continue;
        for (const [k, v] of Object.entries(n.inputs)) {
          if (Array.isArray(v) && String(v[0]) === "323") {
            n.inputs[k] = fallbackImageRef;
          }
        }
      }
      delete apiWorkflow["323"];
      delete apiWorkflow["329"];
    }

    // Optional: strip other custom nodes RunPod doesn't ship (Crystools, PrimitiveFloat) and inline values.
    // Default: off — pass the workflow through so ComfyUI on the worker matches your desktop export.
    if (process.env.NSFW_COMFY_STRIP_UNSUPPORTED === "1") {
      stripUnsupportedNodesAndInjectValues(apiWorkflow, {
        prompt: prompt || "",
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
        swap_dimensions: (aspectRatio || "").toLowerCase().includes("landscape") ? "Off" : "On",
        upscale_factor: 1,
        batch_size: 1,
      },
      class_type: "CR SDXL Aspect Ratio",
    },
    "57": { inputs: { seed }, class_type: "Seed (rgthree)" },
    "246": { inputs: { vae_name: "ae.safetensors" }, class_type: "VAELoader" },
    "247": { inputs: { unet_name: "zImageTurboNSFW_43BF16AIO.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
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
export async function submitNsfwGeneration(params) {
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

  const validatedOverride = loraStrength && loraStrength >= 0.65 && loraStrength <= 0.80
    ? loraStrength : null;

  // Build prompt: anchor identity with triggerWord, then the AI-generated scene prose — nothing else.
  // Z-Image Turbo is degraded by quality tag dumps ("anatomically correct", "solo girl", etc.).
  // The AI system prompt already produces correctly styled, complete descriptions.
  const basePrompt = (userPrompt && userPrompt.trim()) || "";
  if (!basePrompt) {
    return { success: false, error: "Prompt is required. Generate a prompt first (Create Prompt)." };
  }
  const hasTriggerAnchor = basePrompt.toLowerCase().includes(String(triggerWord || "").toLowerCase());
  const prompt = hasTriggerAnchor ? basePrompt : `${triggerWord}, ${basePrompt}`;

  // AI decides additive LoRAs from full prompt/context (pose + makeup + effects). Quick flow: girl max 0.65; additive max 0.35.
  const aiSelection = await detectLorasWithAI({
    finalPrompt: prompt,
    sceneDescription: sceneDescription || userPrompt,
    attributes,
    chipSelections,
    userLoraStrength: validatedOverride,
    quickFlow,
  });
  applyOralBlowjobLoraPolicy(aiSelection, prompt);
  applyExplicitPoseHeuristic(aiSelection, prompt);
  applyNudesPackAdditiveLoraHint(aiSelection, packAdditiveLoraHint);

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
  console.log(`💪 Girl LoRA Strength: ${girlLoraStrength}${loraStrength ? " (user override)" : " (AI-determined)"}`);
  console.log(`🎯 Detected Pose: ${detectedPose ? detectedPose.id + " (node " + detectedPose.node + ")" : "none"}`);
  console.log(`💄 Running Makeup: ${hasRunningMakeup ? "YES" : "no"}`);
  console.log(`💦 Cum Effect: ${hasCumEffect ? "YES" : "no"}`);
  const activeEnhLog = Object.entries(enhancementStrengths)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log(`🎭 Enhancement LoRAs: ${activeEnhLog || "none"} → wired to node 250 lora_9/lora_10 when template loads`);

  const poseStrengths = {};
  POSE_LORAS.forEach(p => { poseStrengths[p.node] = 0; });
  if (detectedPose) {
    const poseStr = Math.min(MAX_ADDITIVE_LORA_STRENGTH, detectedPose.strength ?? MAX_ADDITIVE_LORA_STRENGTH);
    poseStrengths[detectedPose.node] = poseStr;
    console.log(`✅ Activated pose LoRA: ${detectedPose.id} (node ${detectedPose.node}) at strength=${poseStr}`);
  }

  const seed = Math.floor(Math.random() * 2147483647);
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

  const runpodWebhook = process.env.RUNPOD_WEBHOOK_URL?.trim();
  const runPayload = {
    input: {
      prompt: workflow,
      output_node_id: "289",
    },
  };
  if (runpodWebhook) {
    runPayload.webhook = runpodWebhook;
    console.log(`📣 RunPod webhook: ${runpodWebhook.slice(0, 80)}${runpodWebhook.length > 80 ? "…" : ""}`);
  }

  try {
    const response = await fetch(`${RUNPOD_BASE_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify(runPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ RunPod submission failed: ${response.status}`, errorText);
      throw new Error(`Generation service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const runpodJobId = result.id;

    if (!runpodJobId) {
      throw new Error("No job ID returned from generation service");
    }

    console.log(`✅ NSFW generation submitted to RunPod! Job ID: ${runpodJobId}`);
    console.log(`   Status: ${result.status}`);

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
  } catch (error) {
    console.error("❌ RunPod NSFW submission error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
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
  if (!Array.isArray(o.images) || o.images.length === 0) {
    const inner = o.output;
    if (inner && typeof inner === "object" && Array.isArray(inner.images) && inner.images.length > 0) {
      o = inner;
    }
  }
  return o;
}

/**
 * Check status of NSFW generation on RunPod serverless
 * @param {string} jobId - RunPod job ID from submission
 * @returns {Promise<{status: string, error?: string, _runpodOutput?: object}>}
 */
export async function checkNsfwGenerationStatus(jobId) {
  try {
    const response = await fetch(`${RUNPOD_BASE_URL}/status/${jobId}`, {
      headers: {
        "Authorization": `Bearer ${RUNPOD_API_KEY}`,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`⚠️ RunPod job ${jobId} not found (404) - job may have expired or been purged`);
        return { status: "FAILED", error: "Generation job not found - may have expired" };
      }
      const errorText = await response.text();
      throw new Error(`Generation status check failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const runpodStatus = result.status;

    if (result.error && !runpodStatus) {
      console.warn(`⚠️ RunPod job ${jobId} error response: ${result.error}`);
      return { status: "FAILED", error: `RunPod: ${result.error}` };
    }

    if (runpodStatus === "COMPLETED") {
      const output = normalizeRunpodNsfwOutput(result.output);
      if (!output) {
        console.warn(`⚠️ RunPod job COMPLETED but output missing or unparsable`, String(result.output)?.slice(0, 200));
        return { status: "FAILED", error: "No valid output from RunPod" };
      }
      if (output.error) {
        console.error(`❌ RunPod job completed with error: ${output.error}`);
        return { status: "FAILED", error: String(output.error) };
      }
      // Accept whenever we have images; inner `status` is optional (handler always sets it, API may strip it).
      if (output.images?.length > 0) {
        console.log(`✅ RunPod job completed with ${output.images.length} image(s)`);
        return { status: "COMPLETED", _runpodOutput: output };
      }
      console.warn(`⚠️ RunPod job completed but no images in output`, JSON.stringify(output)?.slice(0, 400));
      return { status: "FAILED", error: output.error || "No images in RunPod output" };
    }

    if (runpodStatus === "FAILED") {
      const errorMsg = result.output?.error || result.error || "Generation failed";
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
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return { status: "IN_PROGRESS" };
    }
    console.error("❌ RunPod status check error:", error.message);
    throw error;
  }
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
      console.warn(`[NSFW poll] Fetch error for ${jobId}: ${err.message} — retrying`);
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
      const response = await fetch(`${RUNPOD_BASE_URL}/status/${jobId}`, {
        headers: {
          "Authorization": `Bearer ${RUNPOD_API_KEY}`,
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
      output = normalizeRunpodNsfwOutput(result.output);
    } else {
      output = normalizeRunpodNsfwOutput(output);
    }

    if (!output?.images?.length) {
      throw new Error("Generation completed but returned no images");
    }

    console.log(`📦 RunPod output: ${output.images.length} image(s) from node ${output.images[0]?.node_id}`);

    const outputUrls = [];
    for (const img of output.images) {
      const b64 = img.base64 ?? img.data ?? img.image;
      if (!b64 || typeof b64 !== "string") {
        console.warn(`⚠️ RunPod image entry missing base64`, Object.keys(img || {}));
        continue;
      }
      const buffer = Buffer.from(b64, "base64");
      if (isR2Configured()) {
        const r2Url = await uploadBufferToR2(buffer, "nsfw-generations", "png", "image/png");
        outputUrls.push(r2Url);
        console.log(`✅ Image uploaded to R2: ${r2Url}`);
      } else {
        const dataUrl = `data:image/png;base64,${b64}`;
        outputUrls.push(dataUrl);
        console.warn(`⚠️ R2 not configured, using data URL (temporary!)`);
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
  if (!isR2Configured()) {
    console.warn("⚠️ R2 not configured, returning source URL (temporary!)");
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

    const r2Url = await uploadBufferToR2(
      buffer,
      "nsfw-generations",
      extension,
      contentType,
    );
    console.log(`✅ NSFW image archived to R2: ${r2Url}`);

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
