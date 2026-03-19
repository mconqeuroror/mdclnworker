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
// dynamicPoll removed — inline polling used directly

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FAL_API_KEY = process.env.FAL_API_KEY;
const FAL_API_URL = "https://queue.fal.run";
const FAL_STORAGE_URL = "https://rest.alpha.fal.ai/storage/upload/initiate";
/** fal.ai NSFW image generation endpoint for face reference (e.g. comfy/modelclone/...). If unset, face reference step is skipped. */
const FAL_NSFW_ENDPOINT = process.env.FAL_NSFW_ENDPOINT || "";

// Cache: R2 URL -> fal.ai storage URL (avoids re-uploading same LoRA)
const falStorageCache = new Map();

if (!FAL_API_KEY) {
  console.warn("⚠️ FAL_API_KEY not set - LoRA training will not work");
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
 * Caption a single training image using Grok vision (xAI API).
 * Follows Z-Image LoRA training captioning best practices:
 * - Starts with trigger word
 * - Describes everything EXCEPT the core subject identity
 * - Labels backgrounds, lighting, clothing, camera angles, pose
 * - Uses natural language (1-2 sentences)
 */
async function captionSingleImage(imageUrl, triggerWord, index) {
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
          content: `You are an expert image captioner for Z-Image Turbo LoRA training datasets.

RULES:
1. Start the caption with the trigger word "${triggerWord}" followed by a class word (e.g. "a woman", "a man", "a person").
2. Describe EVERYTHING visible EXCEPT the subject's permanent identity features (face shape, nose, eye shape, bone structure). These must NOT be described so the LoRA can learn them from the trigger word.
3. DO describe: pose, body position, camera angle, framing (close-up/half-body/full-body), clothing, accessories, hair style & color, background, lighting, mood, image quality, art style.
4. Use natural language — 1-2 concise sentences. No bullet points, no line breaks.
5. Be accurate — only describe what is actually visible in the image.
6. Keep it consistent in tone and structure with other captions in the dataset.

EXAMPLE OUTPUT:
${triggerWord} woman, long wavy blonde hair, smiling, wearing a blue dress, standing in a crowded blurry city street, sunny day, 35mm photography, high quality.`
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

    const finalCaption = caption.startsWith(triggerWord) ? caption : `${triggerWord} ${caption}`;
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
async function captionAllTrainingImages(imageUrls, triggerWord) {
  console.log(`\n📝 ============================================`);
  console.log(`📝 CAPTIONING ${imageUrls.length} TRAINING IMAGES`);
  console.log(`📝 Trigger word: ${triggerWord}`);
  console.log(`📝 ============================================`);

  const BATCH_SIZE = 5;
  const results = new Array(imageUrls.length).fill(null);

  for (let batch = 0; batch < imageUrls.length; batch += BATCH_SIZE) {
    const slice = imageUrls.slice(batch, batch + BATCH_SIZE);
    const batchPromises = slice.map((url, i) =>
      captionSingleImage(url, triggerWord, batch + i)
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
        if (!detectedFormat || (detectedFormat !== "jpg" && detectedFormat !== "png")) {
          throw new Error(`unsupported format: ${detectedFormat || "unknown"} — only JPEG/PNG accepted`);
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
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY not configured");
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
          Authorization: `Key ${FAL_API_KEY}`,
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
    console.log(`✅ Training submitted! Request ID: ${result.request_id}`);

    return {
      requestId: result.request_id,
      statusUrl:
        result.status_url ||
        `${FAL_API_URL}/fal-ai/z-image-turbo-trainer-v2/requests/${result.request_id}/status`,
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
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY not configured");
  }

  try {
    const response = await fetch(
      `${FAL_API_URL}/fal-ai/z-image-turbo-trainer-v2/requests/${requestId}/status`,
      {
        headers: {
          Authorization: `Key ${FAL_API_KEY}`,
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
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY not configured");
  }

  try {
    const response = await fetch(
      `${FAL_API_URL}/fal-ai/z-image-turbo-trainer-v2/requests/${requestId}`,
      {
        headers: {
          Authorization: `Key ${FAL_API_KEY}`,
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
 * @returns {Promise<{success: boolean, requestId?: string, error?: string}>}
 */
export async function startLoraTraining(imageUrls, triggerWord, options = {}) {
  try {
    console.log("\n🎓 ============================================");
    console.log("🎓 STARTING LORA TRAINING WORKFLOW");
    console.log("🎓 ============================================");
    console.log(`📸 Images: ${imageUrls.length}`);
    console.log(`🔑 Trigger Word: ${triggerWord}`);

    // Step 1: Caption all images using Grok vision
    const captions = await captionAllTrainingImages(imageUrls, triggerWord);

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
  {
    id: "titjob",
    node: "293",
    keywords: [],
    strength: 0.50,
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
    strengthRange: [0.35, 0.50],
    defaultStrength: 0.45,
  },
  masturbation: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Masturbation.safetensors",
    name: "Masturbation",
    strengthRange: [0.35, 0.50],
    defaultStrength: 0.45,
  },
  deepthroat: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/bjz.safetensors",
    name: "Deepthroat/Blowjob",
    strengthRange: [0.35, 0.50],
    defaultStrength: 0.45,
  },
  dildo: {
    url: "https://huggingface.co/bigckck/ndmstr/resolve/main/dildo.safetensors",
    name: "Dildo",
    strengthRange: [0.35, 0.50],
    defaultStrength: 0.45,
  },
};

const RUNNING_MAKEUP_NODE = "296";
const CUM_NODE = "303";
const RUNNING_MAKEUP_KEYWORDS = ["running makeup", "smeared makeup", "mascara running", "ruined makeup", "crying makeup", "makeup running", "smeared mascara"];

/** Pose slot index in LoadLoraFromUrlOrPath (250): lora_1 = girl, lora_2 = 290 doggy, lora_3 = 291 missionary, lora_4 = 292 cowgirl, lora_5 = 293 anal, lora_6 = 294 handjob, lora_7 = 295 missionary_anal, lora_8 = 296 running makeup */
const POSE_NODE_TO_SLOT = { "290": 2, "291": 3, "292": 4, "293": 5, "294": 6, "295": 7 };
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
 * Convert ComfyUI UI export (nodes + links) to API prompt format.
 * Links format: [linkId, originNodeId, originSlot, targetNodeId, targetSlot, type]
 * If extra.ue_links is present (Anything Everywhere / cg-use-everywhere), applies those
 * so CLIP/VAE/MODEL get connected to downstream nodes.
 */
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
    let widgetIdx = 0;
    const wv = node.widgets_values || [];
    for (const inp of node.inputs || []) {
      const name = inp.name;
      if (inp.link != null && linkMap[inp.link]) {
        inputs[name] = linkMap[inp.link];
      } else if (inp.widget != null && widgetIdx < wv.length) {
        inputs[name] = wv[widgetIdx++];
      }
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
];

/**
 * Remove unsupported nodes (String Literal, Primitive string, GetNode, Fast Groups Bypasser) and
 * inject their values directly into any node that referenced them.
 */
function stripUnsupportedNodesAndInjectValues(workflow, { prompt, negativePrompt, loraUrl }) {
  const safeLora = sanitizeLoraDownloadUrl(loraUrl);
  const replacements = {
    "41": negativePrompt,
    "56": prompt,
    "257": safeLora,
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
  } = typeof context === "string" ? { finalPrompt: context, sceneDescription: context } : context;

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const defaultEnhancements = {};
  for (const key of Object.keys(ENHANCEMENT_LORAS)) { defaultEnhancements[key] = 0; }
  const fallback = { pose: null, runningMakeup: false, cumEffect: false, girlStrength: 0.70, enhancementStrengths: defaultEnhancements };

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

  const girlStrengthSection = userLoraStrength
    ? `GIRL IDENTITY LORA STRENGTH: User has manually set this to ${userLoraStrength}. Use this exact value.`
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
- ONLY select a pose if the scene EXPLICITLY shows that EXACT sex position being performed
- "bent over" alone is NOT doggystyle - it must explicitly describe doggy style sex
- "from behind" alone is NOT anal - there must be explicit anal penetration
- "kneeling" is NOT any pose - it's just a body position
- "lying in bed" is NOT missionary - there must be explicit missionary sex
- If the prompt describes oral sex (blowjob, deepthroat), select "none" for pose - use the deepthroat enhancement LoRA instead
- If unsure, select "none" - it's better to have no pose LoRA than the wrong one

ENHANCEMENT LORAS (each can be independently activated with a strength from 0.35-0.50):
- "amateur_nudes": Casual girlfriend-style nude photos. Activate for: casual nude selfies, gf nudes, naked in bed/couch/mirror, relaxed nude poses, topless casual moments, sending nudes, lounging naked. Strength 0.35 for subtle gf vibe, 0.50 for stronger amateur aesthetic.
- "deepthroat": Blowjob and deepthroat oral sex. Activate for: blowjob, deepthroat, oral sex, sucking, on knees giving head, mouth around cock, licking, oral. Strength 0.35-0.50.
- "masturbation": Solo masturbation scenes. Activate for: masturbating, fingering herself, touching herself, hand between legs/thighs, playing with herself, rubbing pussy. Strength 0.35-0.50.
- "dildo": Using a dildo/vibrator/toy. Activate for: dildo, vibrator, sex toy, inserting toy, using toy on herself. Strength 0.35-0.50.

RULES FOR ENHANCEMENT LORAS:
- Multiple CAN be active simultaneously (e.g. amateur_nudes + masturbation for casual gf masturbating)
- amateur_nudes stacks well with masturbation or dildo for the casual/gf aesthetic
- deepthroat should NOT combine with masturbation or dildo (incompatible acts)
- Look at the FULL context: if chips say "on knees" + prompt mentions "mouth" or "oral" = activate deepthroat
- Look at outfit chips: if outfit is "nude"/"naked"/"topless" + casual scene = consider amateur_nudes
- Set strength 0.35 for subtle, 0.45 for moderate, 0.50 for strong effect (NEVER exceed 0.50)
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
    let girlStrength;
    if (userLoraStrength) {
      girlStrength = Math.max(0.65, userLoraStrength); // enforce minimum 0.65
    } else if (!isNaN(rawGirlStrength) && rawGirlStrength >= 0.65 && rawGirlStrength <= 0.80) {
      girlStrength = rawGirlStrength;
    } else if (!isNaN(rawGirlStrength) && rawGirlStrength >= 0.55 && rawGirlStrength < 0.65) {
      girlStrength = 0.65; // clamp up to minimum
    } else {
      girlStrength = 0.70;
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
    doggystyle_facing: "Doggystyle / from behind position - girl on all fours, bent over, or face down ass up. Covers ALL rear-view positions including doggy, prone bone, bent over, from behind, on all fours, etc.",
    missionary: "Missionary sex position - girl lying on her back with legs spread during vaginal sex",
    cowgirl: "Cowgirl / riding position - girl sitting on top, straddling, riding. Covers cowgirl, reverse cowgirl, girl-on-top positions.",
    titjob: "Titjob / titfuck / boobjob - penis between breasts, girl pressing boobs together around cock",
    handjob: "Girl giving a handjob - hand stroking/jerking a penis",
    missionary_anal: "Anal sex in missionary position - girl on her back during anal penetration",
  };
  return descriptions[poseId] || poseId;
}

/**
 * Quality enhancement suffix for prompts
 */
const QUALITY_SUFFIX =
  "one person only, solo girl, anatomically correct, natural body proportions, shot on iPhone 15 Pro main camera, smartphone photo, slight wide-angle lens distortion, natural skin texture with visible pores and imperfections and skin folds, unedited raw photo, auto-exposure, auto white balance, slight noise in shadows, jpeg compression artifacts, phone flash harsh frontal light washing out skin slightly overexposed, slight motion blur on edges, slightly out of focus background, no color grading, no retouching, no extra limbs, no distorted hands, candid amateur nude, unedited raw smartphone photo, grainy low light photo";

// Additive LoRAs (pose, makeup, effects) must never overpower identity LoRA.
const MAX_ADDITIVE_LORA_STRENGTH = 0.5;

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
 * Build the full ComfyUI workflow from the core NSFW workflow template (LoadLoraFromUrlOrPath + CR Apply LoRA Stack).
 * Overrides: positive/negative prompt (nodes 56, 41), seed (57), and node 250 LoRA URLs/strengths.
 * Falls back to legacy inline workflow if attached_assets/nsfw_core_workflow.json is missing.
 */
function buildComfyWorkflow(params) {
  const {
    prompt,
    loraUrl,
    girlLoraStrength,
    poseStrengths,
    makeupStrength,
    cumStrength,
    enhancementStrengths = {},
    postProcessing = {},
    seed,
    steps = 50,
    cfg = 3,
    sampler = "dpmpp_2m",
    scheduler = "beta",
  } = params;

  const negativePrompt = "blurry, low resolution, deformed, bad anatomy, extra limbs, mutated hands, poorly drawn face, bad proportions, watermark, text, signature, cartoon, anime, overexposed, underexposed, plastic skin, doll-like";

  const template = loadNsfwCoreWorkflowApi();
  if (template) {
    const workflow = JSON.parse(JSON.stringify(template));

    if (workflow["56"]?.inputs) workflow["56"].inputs.string = prompt;
    if (workflow["41"]?.inputs) workflow["41"].inputs.string = negativePrompt;
    if (workflow["57"]?.inputs) workflow["57"].inputs.seed = seed;

    const node250 = workflow["250"];
    if (node250?.inputs) {
      node250.inputs.lora_1_url = sanitizeLoraDownloadUrl(loraUrl);
      const girlStr = Math.min(1, Math.max(0, Number(girlLoraStrength) || 0.6));
      node250.inputs.lora_1_strength = girlStr;
      node250.inputs.lora_1_model_strength = girlStr;
      node250.inputs.lora_1_clip_strength = girlStr;

      // Additive LoRAs are AI-selected and always capped to avoid overpowering identity.
      for (const [nodeId, slot] of Object.entries(POSE_NODE_TO_SLOT)) {
        const str = poseStrengths[nodeId] || 0;
        const s = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0, Number(str)));
        const url = s > 0 ? sanitizeLoraDownloadUrl(POSE_SLOT_URLS[nodeId] || "") : "";
        node250.inputs[`lora_${slot}_url`] = url;
        node250.inputs[`lora_${slot}_strength`] = s;
        node250.inputs[`lora_${slot}_model_strength`] = s;
        node250.inputs[`lora_${slot}_clip_strength`] = s;
      }

      const makeupStr = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0, Number(makeupStrength) || 0));
      node250.inputs.lora_8_url = makeupStr > 0 ? sanitizeLoraDownloadUrl(LORA_8_RUNNING_MAKEUP_URL) : "";
      node250.inputs.lora_8_strength = makeupStr;
      node250.inputs.lora_8_model_strength = makeupStr;
      node250.inputs.lora_8_clip_strength = makeupStr;

      // Keep slots 9/10 empty in current workflow template.
      node250.inputs.lora_9_url = "";
      node250.inputs.lora_9_strength = 0;
      node250.inputs.lora_9_model_strength = 0;
      node250.inputs.lora_9_clip_strength = 0;
      node250.inputs.lora_10_url = "";
      node250.inputs.lora_10_strength = 0;
      node250.inputs.lora_10_model_strength = 0;
      node250.inputs.lora_10_clip_strength = 0;
    }

    // KSampler 276 (base) and 45 (refiner): set steps/cfg/sampler/scheduler/denoise explicitly to avoid widget-order mismatch
    const stepsNum = Math.min(10000, Math.max(1, Number(steps) || 50));
    const cfgNum = Number(cfg) || 3;
    if (workflow["276"]?.inputs) {
      workflow["276"].inputs.steps = stepsNum;
      workflow["276"].inputs.cfg = cfgNum;
      workflow["276"].inputs.sampler_name = sampler || "dpmpp_2m";
      workflow["276"].inputs.scheduler = scheduler || "beta";
      workflow["276"].inputs.denoise = 1;
    }
    if (workflow["45"]?.inputs) {
      workflow["45"].inputs.steps = 8;
      workflow["45"].inputs.cfg = 0;
      workflow["45"].inputs.sampler_name = "dpmpp_2m";
      workflow["45"].inputs.scheduler = "karras";
      workflow["45"].inputs.denoise = 0.09;
    }

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const blurEnabled = postProcessing?.blur?.enabled !== false;
    const grainEnabled = postProcessing?.grain?.enabled !== false;
    const blurStrength = clamp(Number(postProcessing?.blur?.strength) || 1, 0, 1);
    const grainStrength = clamp(Number(postProcessing?.grain?.strength) || 1, 0, 1);
    if (workflow["286"]?.inputs) {
      workflow["286"].inputs.blur_radius = blurEnabled ? Math.max(1, Math.round(2 * blurStrength)) : 0;
      const sigma = blurEnabled ? Number((0.3 * blurStrength).toFixed(3)) : 0;
      workflow["286"].inputs.sigma = Math.max(0.1, sigma); // RunPod ImageBlur requires sigma >= 0.1
    }
    if (workflow["284"]?.inputs) {
      const density = grainEnabled ? Number((0.06 * grainStrength).toFixed(4)) : 0;
      const intensity = grainEnabled ? Number((0.1 * grainStrength).toFixed(4)) : 0;
      workflow["284"].inputs.density = Math.max(0.01, density); // RunPod Image Film Grain min 0.01
      workflow["284"].inputs.intensity = Math.max(0.01, intensity);
    }

    stripUnsupportedNodesAndInjectValues(workflow, { prompt, negativePrompt, loraUrl: sanitizeLoraDownloadUrl(loraUrl) });
    return workflow;
  }

  return buildComfyWorkflowLegacy(params);
}

function buildComfyWorkflowLegacy(params) {
  const { prompt, loraUrl, girlLoraStrength, poseStrengths, makeupStrength, postProcessing = {}, seed } = params;
  const negativePrompt = "blurry, low resolution, deformed, bad anatomy, extra limbs, mutated hands, poorly drawn face, bad proportions, watermark, text, signature, cartoon, anime, overexposed, underexposed, plastic skin, doll-like";
  const poseLoraMap = {
    "290": { url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Doggystyle facing the camera.safetensors", name: "Doggystyle" },
    "291": { url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Missionnary.safetensors", name: "Missionary" },
    "292": { url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Cowgirl.safetensors", name: "Cowgirl" },
    "293": { url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw Anal Doggystyle.safetensors", name: "Anal Doggy" },
    "294": { url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_Handjob.safetensors", name: "Handjob" },
    "295": { url: "https://huggingface.co/bigckck/ndmstr/resolve/main/Nsfw_POV_Missionary_Anal.safetensors", name: "POV Missionary Anal" },
  };
  const loraEntries = [{ url: sanitizeLoraDownloadUrl(loraUrl), strength: girlLoraStrength, name: "Girl LoRA" }];
  for (const [nodeId, info] of Object.entries(poseLoraMap)) {
    const strength = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0, Number(poseStrengths?.[nodeId] || 0)));
    if (strength > 0) loraEntries.push({ url: sanitizeLoraDownloadUrl(info.url), strength, name: info.name });
  }
  const safeMakeupStrength = Math.min(MAX_ADDITIVE_LORA_STRENGTH, Math.max(0, Number(makeupStrength) || 0));
  if (safeMakeupStrength > 0) {
    loraEntries.push({ url: sanitizeLoraDownloadUrl(LORA_8_RUNNING_MAKEUP_URL), strength: safeMakeupStrength, name: "Running Makeup" });
  }
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
    "50": { inputs: { width: 1024, height: 1024, aspect_ratio: "16:9 landscape 1344x768", swap_dimensions: "On", upscale_factor: 1, batch_size: 1 }, class_type: "CR SDXL Aspect Ratio" },
    "57": { inputs: { seed }, class_type: "Seed (rgthree)" },
    "246": { inputs: { vae_name: "ae.safetensors" }, class_type: "VAELoader" },
    "247": { inputs: { unet_name: "zImageTurboNSFW_43BF16AIO.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
    "248": { inputs: { clip_name: "qwen_3_4b.safetensors", type: "qwen_image", device: "default" }, class_type: "CLIPLoader" },
    ...loraNodes,
    "276": { inputs: { seed: ["57", 0], steps: 50, cfg: 3, sampler_name: "dpmpp_2m", scheduler: "beta", denoise: 1, model: prevModelRef, positive: ["2", 0], negative: ["1", 0], latent_image: ["50", 4] }, class_type: "KSampler" },
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
 * - LoRA 5 (node 293): Titjob pose
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

  // Always anchor identity with triggerWord; without this, likeness can drift even with LoRA loaded.
  // Keep prompt concise (no attribute tag-dump) to preserve output quality.
  const basePrompt = (userPrompt && userPrompt.trim()) || "";
  if (!basePrompt) {
    return { success: false, error: "Prompt is required. Generate a prompt first (Create Prompt)." };
  }
  const hasTriggerAnchor = basePrompt.toLowerCase().includes(String(triggerWord || "").toLowerCase());
  const identityAnchoredPrompt = hasTriggerAnchor
    ? basePrompt
    : `${triggerWord}, same person, same face, same identity, ${basePrompt}`;
  const prompt =
    identityAnchoredPrompt.includes("one person only") &&
    identityAnchoredPrompt.includes("anatomically correct")
      ? identityAnchoredPrompt
      : `${identityAnchoredPrompt}, ${QUALITY_SUFFIX}`;

  // AI decides additive LoRAs from full prompt/context (pose + makeup + effects).
  const aiSelection = await detectLorasWithAI({
    finalPrompt: prompt,
    sceneDescription: sceneDescription || userPrompt,
    attributes,
    chipSelections,
    userLoraStrength: validatedOverride,
  });
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
  console.log(`🎭 Enhancement LoRAs: ${activeEnhLog || "none"} (template currently applies pose + makeup slots)`);

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

  const workflow = buildComfyWorkflow({
    prompt,
    loraUrl,
    girlLoraStrength,
    poseStrengths,
    makeupStrength,
    cumStrength,
    enhancementStrengths,
    postProcessing: normalizedPostProcessing,
    seed,
  });

  console.log("\n📋 ============================================");
  console.log("📋 FULL RUNPOD PAYLOAD:");
  console.log("📋 ============================================");
  console.log(JSON.stringify({ input: { prompt: workflow } }, null, 2));
  console.log("📋 ============================================\n");

  try {
    const response = await fetch(`${RUNPOD_BASE_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          prompt: workflow,
          output_node_id: "289",
        },
      }),
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
        steps: 50,
        cfg: 3,
        width: 1344,
        height: 768,
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
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY not configured");
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
        Authorization: `Key ${FAL_API_KEY}`,
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
      const output = result.output;
      if (output?.error) {
        console.error(`❌ RunPod job completed with error: ${output.error}`);
        return { status: "FAILED", error: output.error };
      }
      if (output?.status === "COMPLETED" && output?.images?.length > 0) {
        console.log(`✅ RunPod job completed with ${output.images.length} image(s)`);
        return { status: "COMPLETED", _runpodOutput: output };
      }
      console.warn(`⚠️ RunPod job completed but no images in output`);
      return { status: "FAILED", error: output?.error || "No images in RunPod output" };
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
 * Poll a RunPod NSFW job with dynamic polling — timeout only counts while IN_PROGRESS,
 * not while IN_QUEUE.
 * @param {string} jobId
 * @param {number} runningTimeoutMs  Max ms to wait once IN_PROGRESS (default 20 min)
 * @returns {Promise<{outputUrls: string[]}>}
 */
export async function pollNsfwJob(jobId, runningTimeoutMs = 20 * 60 * 1000) {
  const deadline = Date.now() + runningTimeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, attempt === 1 ? 3_000 : 5_000));

    let status;
    try {
      status = await checkNsfwGenerationStatus(jobId);
    } catch (err) {
      console.warn(`[NSFW poll] Fetch error for ${jobId}: ${err.message} — retrying`);
      continue;
    }

    if (status.status === "COMPLETED") return { phase: "done", result: { _runpodOutput: status._runpodOutput } };
    if (status.status === "FAILED")    return { phase: "done", error: status.error || "Generation failed on ComfyUI" };
    // IN_QUEUE or IN_PROGRESS — keep polling
  }

  throw new Error(`NSFW job ${jobId} timed out after ${Math.round(runningTimeoutMs / 60000)} minutes`);
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
      if (result.status !== "COMPLETED" || !result.output) {
        throw new Error(`Generation not completed: ${result.status}`);
      }
      output = result.output;
    }

    if (!output?.images?.length) {
      throw new Error("Generation completed but returned no images");
    }

    console.log(`📦 RunPod output: ${output.images.length} image(s) from node ${output.images[0]?.node_id}`);

    const outputUrls = [];
    for (const img of output.images) {
      const buffer = Buffer.from(img.base64, "base64");
      if (isR2Configured()) {
        const r2Url = await uploadBufferToR2(buffer, "nsfw-generations", "png", "image/png");
        outputUrls.push(r2Url);
        console.log(`✅ Image uploaded to R2: ${r2Url}`);
      } else {
        const dataUrl = `data:image/png;base64,${img.base64}`;
        outputUrls.push(dataUrl);
        console.warn(`⚠️ R2 not configured, using data URL (temporary!)`);
      }
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
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY not configured");
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
        Authorization: `Key ${FAL_API_KEY}`,
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
            Authorization: `Key ${FAL_API_KEY}`,
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
              Authorization: `Key ${FAL_API_KEY}`,
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
