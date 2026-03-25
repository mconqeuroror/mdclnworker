import { isR2Configured, uploadBufferToR2 } from "../utils/r2.js";
import {
  generateImageWithNanoBananaKie,
  generateTextToImageNanoBananaKie,
  getKieCallbackUrl,
} from "./kie.service.js";
import { IDENTITY_RECREATE_MODEL_CLOTHES } from "../constants/identityRecreationPrompts.js";
import { validateSeedreamEditImages } from "../utils/fileValidation.js";

/**
 * Image APIs (Google/KIE) reject prompts that imply minors. Never emit ages under 18 in provider-facing text.
 * @returns {string} e.g. "25 years old" for adults, or "" when age should be omitted (caller adds "adult" elsewhere)
 */
function safeAgeYearsFragmentForImagePrompt(age) {
  if (age === undefined || age === null || age === "") return "";
  const n = typeof age === "number" ? age : parseInt(String(age).trim(), 10);
  if (!Number.isFinite(n) || n < 18) return "";
  return `${Math.min(120, n)} years old`;
}

/**
 * Reference portrait: natural English with correct article ("an adult …" vs "a 25 years old …").
 */
function portraitSubjectAgeGender(age, genderText) {
  const years = safeAgeYearsFragmentForImagePrompt(age);
  if (!years) {
    return { article: "an", subject: `adult ${genderText}` };
  }
  return { article: "a", subject: `${years} ${genderText}` };
}

const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_URL = "https://api.wavespeed.ai/api/v3";

if (!WAVESPEED_API_KEY) {
  console.warn("âš ï¸  WAVESPEED_API_KEY not set â€” WaveSpeed generation endpoints will not work");
}

/** WaveSpeed webhook URL: same base as KIE callback, path /api/wavespeed/callback. Set CALLBACK_BASE_URL (or KIE envs) once; both use it. */
export function getWaveSpeedCallbackUrl() {
  const explicit = process.env.WAVESPEED_CALLBACK_URL;
  if (explicit && typeof explicit === "string" && explicit.startsWith("http")) return explicit.trim();
  const kieUrl = getKieCallbackUrl();
  if (kieUrl) {
    try {
      const u = new URL(kieUrl);
      u.pathname = "/api/wavespeed/callback";
      return u.toString();
    } catch (_) {}
  }
  return null;
}

/**
 * Archive output from WaveSpeed to R2 for permanent storage
 * WaveSpeed deletes outputs after 7 days, so we need to save them ourselves
 * @param {string} sourceUrl - WaveSpeed URL to download from
 * @returns {Promise<string>} - R2 URL or original URL if archiving fails
 */
async function archiveToR2(sourceUrl) {
  if (!isR2Configured()) {
    console.log("âš ï¸ R2 not configured, using WaveSpeed URL");
    return sourceUrl;
  }

  try {
    console.log(`ðŸ“¦ Archiving to R2: ${sourceUrl}`);
    
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";
    
    let extension = "png";
    if (contentType.includes("video/mp4") || contentType.includes("video/mpeg")) {
      extension = "mp4";
    } else if (contentType.includes("video/webm")) {
      extension = "webm";
    } else if (contentType.includes("video/")) {
      extension = "mp4";
    } else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      extension = "jpg";
    } else if (contentType.includes("webp")) {
      extension = "webp";
    } else if (sourceUrl.match(/\.mp4(\?|$)/i)) {
      extension = "mp4";
    } else if (sourceUrl.match(/\.webm(\?|$)/i)) {
      extension = "webm";
    }

    if (extension === "mp4" || extension === "webm") {
      const videoContentType = extension === "mp4" ? "video/mp4" : "video/webm";
      const r2Url = await uploadBufferToR2(buffer, "generations", extension, videoContentType);
      console.log(`âœ… Archived video to R2: ${r2Url}`);
      return r2Url;
    }

    const r2Url = await uploadBufferToR2(buffer, "generations", extension, contentType);
    console.log(`âœ… Archived to R2: ${r2Url}`);
    return r2Url;
  } catch (error) {
    console.error(`âš ï¸ Failed to archive to R2: ${error.message}`);
    return sourceUrl; // Fallback to WaveSpeed URL
  }
}

/**
 * Detect if an error is related to explicit/NSFW content moderation
 * WaveSpeed may reject content that violates their content policy
 * @param {string} errorMessage - Error message to check
 * @returns {boolean} True if error is content-related
 */
function isExplicitContentError(errorMessage) {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes('nsfw') ||
    lower.includes('explicit') ||
    lower.includes('moderation') ||
    lower.includes('content policy') ||
    lower.includes('safety') ||
    lower.includes('inappropriate') ||
    lower.includes('violation') ||
    lower.includes('adult content') ||
    lower.includes('nude') ||
    lower.includes('pornograph') ||
    lower.includes('sensitive content') ||
    lower.includes('not allowed') ||
    lower.includes('blocked') ||
    lower.includes('rejected')
  );
}

/**
 * Get user-friendly error message for explicit content errors
 * @param {string} originalError - Original error message
 * @returns {string} User-friendly error message
 */
function getExplicitContentUserMessage(originalError) {
  return "Your image was flagged as too explicit. Please use a different image that shows less skin or is less suggestive. Try using a photo with more clothing or a different pose.";
}

function isRetryableFetchError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.cause?.code || error?.code || "").toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("socket") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    code.includes("econnreset") ||
    code.includes("etimedout") ||
    code.includes("enotfound") ||
    code.includes("eai_again")
  );
}

// Helper to wait for task completion
async function waitForResult(requestId, maxAttempts = 60) {
  const pollUrl = `${WAVESPEED_API_URL}/predictions/${requestId}/result`;

  console.log(`ðŸ” Polling URL: ${pollUrl}`);
  let consecutiveHttpErrors = 0;
  let consecutiveNetworkErrors = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Don't wait before first poll!
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 seconds between polls
    }

    let response;
    try {
      response = await fetch(pollUrl, {
        headers: {
          Authorization: `Bearer ${WAVESPEED_API_KEY}`,
        },
        signal: AbortSignal.timeout(20_000),
      });
      consecutiveNetworkErrors = 0;
    } catch (error) {
      if (isRetryableFetchError(error) && consecutiveNetworkErrors < 8) {
        consecutiveNetworkErrors += 1;
        if (consecutiveNetworkErrors === 1 || consecutiveNetworkErrors % 3 === 0) {
          console.warn(
            `âš ï¸ Transient poll network error for request ${requestId} ` +
            `(attempt ${attempt + 1}/${maxAttempts}, transient ${consecutiveNetworkErrors}/8): ${error.message}`,
          );
        }
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const lowered = String(errorText || "").toLowerCase();
      const status = response.status;

      // WaveSpeed can briefly return not-ready style errors right after submission.
      const isRetryablePollHttp =
        status === 429 ||
        status === 404 ||
        status === 409 ||
        status === 425 ||
        status >= 500 ||
        lowered.includes("not found") ||
        lowered.includes("not ready") ||
        lowered.includes("processing") ||
        lowered.includes("queued") ||
        lowered.includes("rate limit") ||
        lowered.includes("too many requests") ||
        lowered.includes("timeout") ||
        lowered.includes("temporar") ||
        lowered.includes("internal") ||
        lowered.includes("unavailable");

      if (isRetryablePollHttp) {
        consecutiveHttpErrors += 1;
        if (consecutiveHttpErrors <= 8) {
          if (consecutiveHttpErrors === 1 || consecutiveHttpErrors % 3 === 0) {
            console.warn(
              `âš ï¸ Transient poll HTTP ${status} for request ${requestId} ` +
              `(attempt ${attempt + 1}/${maxAttempts}, transient ${consecutiveHttpErrors}/8): ${errorText}`,
            );
          }
          continue;
        }
      }

      console.error(`âŒ Polling failed: ${response.status} - ${errorText}`);
      throw new Error(`Generation service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    consecutiveHttpErrors = 0;

    // Log first poll and every 10th poll to debug
    if (attempt === 0 || attempt % 10 === 0) {
      console.log(
        `\nðŸ” Poll ${attempt + 1} - Full response:`,
        JSON.stringify(result, null, 2),
      );
    }

    // CRITICAL: WaveSpeed wraps EVERYTHING in { code, message, data }
    const actualData = result.data || result;
    const status = actualData.status;
    const outputs = actualData.outputs || [];

    console.log(
      `  Poll ${attempt + 1}/${maxAttempts} - Status: ${status || "no status"} - Outputs: ${outputs.length}`,
    );

    // SUCCESS: Check if outputs array has data
    if (outputs && outputs.length > 0) {
      console.log(`âœ… Output ready! URL: ${outputs[0]}`);
      // Archive to R2 for permanent storage (WaveSpeed deletes after 7 days)
      const archivedUrl = await archiveToR2(outputs[0]);
      return {
        outputUrl: archivedUrl,
        thumbnailUrl: actualData.thumbnail || actualData.cover || null,
      };
    }

    // Check status field
    if (
      status === "succeeded" ||
      status === "completed" ||
      status === "success" ||
      status === "finished"
    ) {
      // Maybe output is in a different field
      const output =
        actualData.output || actualData.result || actualData.url || outputs[0];
      if (output) {
        console.log(`âœ… Generation complete! URL: ${output}`);
        // Archive to R2 for permanent storage (WaveSpeed deletes after 7 days)
        const archivedUrl = await archiveToR2(output);
        return {
          outputUrl: archivedUrl,
          thumbnailUrl: actualData.thumbnail || actualData.cover || null,
        };
      }
    }

    // Check if failed
    if (status === "failed" || status === "error") {
      const errorMsg =
        actualData.error || result.error || result.message || "Unknown error";
      throw new Error(`Generation failed: ${errorMsg}`);
    }

    // Still processing (created, processing, queued, etc.)
    if (attempt === 0) {
      console.log(`â³ Generation started, waiting for completion...`);
    }
  }

  throw new Error(`Task timed out after ${maxAttempts * 3} seconds`);
}

/**
 * Generate image with Nano Banana Pro Edit (Gemini 3.0 Pro)
 * Used for Create AI Model workflow - better character consistency
 * Nano Banana Pro Edit accepts multiple images for reference
 * @param {string[]} images - Array of image URLs (reference images)
 * @param {string} prompt - Edit prompt
 * @param {object} options - Options like resolution, aspect_ratio
 */
async function generateImageWithNanoBanana(images, prompt, options = {}) {
  try {
    console.log("[Nano Banana] Routing edit through KIE nano-banana-pro");
    return await generateImageWithNanoBananaKie(images, prompt, {
      aspectRatio: options.aspectRatio || "9:16",
      resolution: options.resolution || "2K",
      outputFormat: options.outputFormat || "png",
      onTaskCreated: options.onTaskCreated,
      forcePolling: options.forcePolling,
    });
  } catch (error) {
    console.error("âŒ ERROR in Nano Banana Pro Edit:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate image with Seedream V4.5 Edit (for NSFW content)
 * Used for prompt-based image generation when NSFW mode is enabled
 * Seedream V4.5 has fewer content restrictions than Nano Banana
 * @param {string[]} images - Array of image URLs (identity reference images)
 * @param {string} prompt - Edit prompt describing what to create
 * @param {object} options - Options like size
 * @returns {Promise<{success: boolean, outputUrl?: string, error?: string}>}
 */
async function generateImageWithSeedream(images, prompt, options = {}) {
  try {
    if (!WAVESPEED_API_KEY) {
      throw new Error("WAVESPEED_API_KEY is not configured -- Seedream edit unavailable");
    }
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error("Seedream edit requires at least one reference image");
    }
    if (!prompt || !String(prompt).trim()) {
      throw new Error("Seedream edit requires a prompt");
    }

    const validation = await validateSeedreamEditImages(images);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const requestBody = {
      images: images.slice(0, 10),
      prompt: String(prompt).trim(),
      enable_sync_mode: false,
      enable_base64_output: false,
      ...(typeof options.size === "string" && options.size.trim()
        ? { size: options.size.trim() }
        : {}),
    };

    const callbackUrl =
      options.forcePolling === true ? null : getWaveSpeedCallbackUrl();
    const baseSubmitUrl = `${WAVESPEED_API_URL}/bytedance/seedream-v4.5/edit`;
    const attempts = callbackUrl
      ? [
          {
            url: `${baseSubmitUrl}?webhook=${encodeURIComponent(callbackUrl)}`,
            label: "query:webhook",
          },
          {
            url: baseSubmitUrl,
            label: "plain-body",
          },
        ]
      : [{ url: baseSubmitUrl, label: "plain-body" }];

    console.log("[Seedream] Submitting image edit to WaveSpeed bytedance/seedream-v4.5/edit");
    if (callbackUrl) {
      console.log(`[Seedream] WaveSpeed webhook: ${callbackUrl}`);
    }

    let submitResponse = null;
    let responseText = "";
    for (const attempt of attempts) {
      submitResponse = await fetch(attempt.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WAVESPEED_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      });
      responseText = await submitResponse.text();
      if (submitResponse.ok) {
        break;
      }
      if (attempts.length > 1) {
        console.warn(
          `[Seedream] Submit failed (${attempt.label}) HTTP ${submitResponse.status}; trying next variant`,
        );
      }
    }

    if (!submitResponse?.ok) {
      console.error(`❌ Seedream API Error ${submitResponse?.status}:`, responseText);
      throw new Error(
        `Failed to submit Seedream edit: ${submitResponse?.status || "unknown"} - ${responseText}`,
      );
    }

    let submitData;
    try {
      submitData = JSON.parse(responseText);
    } catch {
      throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }

    const requestId =
      submitData.data?.id ||
      submitData.request_id ||
      submitData.id ||
      submitData.requestId ||
      submitData.task_id ||
      submitData.taskId ||
      submitData.prediction_id;

    if (!requestId) {
      throw new Error("No request ID in Seedream response");
    }

    if (typeof options.onTaskCreated === "function") {
      await options.onTaskCreated(requestId);
    }

    if (callbackUrl) {
      return {
        success: true,
        deferred: true,
        taskId: requestId,
      };
    }

    const result = await waitForResult(requestId, 60);
    return {
      success: true,
      outputUrl: result.outputUrl,
      thumbnailUrl: result.thumbnailUrl,
      requestId,
    };
  } catch (error) {
    console.error("ERROR in Seedream 4.5 Edit:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Backward-compatible alias for the WaveSpeed Seedream 4.5 Edit endpoint.
 */
export async function generateImageWithSeedreamWaveSpeed(images, prompt, options = {}) {
  return await generateImageWithSeedream(images, prompt, options);
}

/**
 * Identity recreation via WaveSpeed Seedream 4.5 Edit.
 */
export async function generateImageWithIdentityWaveSpeed(identityImages, targetImage, options = {}) {
  const allImages = [...(identityImages || []), targetImage].filter(Boolean);
  return await generateImageWithSeedream(allImages, options.customImagePrompt || IDENTITY_RECREATE_MODEL_CLOTHES, {
    size: options.size,
    forcePolling: options.forcePolling,
    onTaskCreated: options.onTaskCreated,
  });
}

async function faceSwapVideo(videoUrl, faceImageUrl, options = {}) {
  try {
    console.log("\nðŸŽ­ ============================================");
    console.log("ðŸŽ­ VIDEO FACE SWAP (WaveSpeed)");
    console.log("ðŸŽ­ ============================================");
    console.log(`ðŸ“¹ Source video: ${videoUrl}`);
    console.log(`ðŸ‘¤ Face image: ${faceImageUrl}`);
    console.log(`âš™ï¸  Options:`, options);
    console.log("â³ Submitting to WaveSpeed...\n");

    const requestBody = {
      video: videoUrl,
      face_image: faceImageUrl,
      target_index: Number.isInteger(options.targetIndex)
        ? Math.max(0, Math.min(10, options.targetIndex))
        : 0,
    };

    const faceSwapEndpoint = `${WAVESPEED_API_URL}/wavespeed-ai/video-face-swap`;
    console.log(`🌐 Face swap endpoint: ${faceSwapEndpoint}`);

    // Submit task
    const submitResponse = await fetch(
      faceSwapEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WAVESPEED_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!WAVESPEED_API_KEY) {
      throw new Error("WAVESPEED_API_KEY is not configured -- face swap unavailable");
    }

    const responseText = await submitResponse.text();

    if (!submitResponse.ok) {
      console.error(`âŒ API Error ${submitResponse.status}:`, responseText);
      throw new Error(
        `Failed to submit face swap task: ${submitResponse.status} - ${responseText}`,
      );
    }

    let submitData;
    try {
      submitData = JSON.parse(responseText);
    } catch (e) {
      console.error("âŒ Failed to parse response:", responseText);
      throw new Error(
        `Invalid JSON response: ${responseText.substring(0, 200)}`,
      );
    }

    // Extract request ID
    const requestId =
      submitData.data?.id ||
      submitData.request_id ||
      submitData.id ||
      submitData.requestId ||
      submitData.task_id ||
      submitData.taskId ||
      submitData.prediction_id;

    if (!requestId) {
      console.error("âŒ No request ID found in response");
      console.error("Full response:", JSON.stringify(submitData, null, 2));
      throw new Error(
        `No request ID in response. Keys: ${Object.keys(submitData).join(", ")}`,
      );
    }

    console.log(`âœ… Face swap task submitted! Request ID: ${requestId}`);
    console.log(
      "â³ Waiting for result (may take 30-120 seconds depending on video length)...\n",
    );

    // Wait for result (longer timeout for videos)
    const result = await waitForResult(requestId, 120); // 120 polls = 6 minutes max

    console.log("âœ… Face swap complete!");
    console.log(`ðŸŽ¥ Output URL: ${result.outputUrl}\n`);
    if (result.thumbnailUrl) {
      console.log(`ðŸ–¼ï¸  Thumbnail URL: ${result.thumbnailUrl}\n`);
    }

    return {
      success: true,
      outputUrl: result.outputUrl,
      thumbnailUrl: result.thumbnailUrl,
      requestId,
    };
  } catch (error) {
    console.error("âŒ ERROR in face swap:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// v42a: Face swap in image
async function faceSwapImage(targetImageUrl, sourceImageUrl) {
  try {
    console.log("\nðŸ”„ ============================================");
    console.log("ðŸ”„ STARTING IMAGE FACE SWAP");
    console.log("ðŸ”„ ============================================");
    console.log("ðŸŽ¯ Target Image:", targetImageUrl);
    console.log("ðŸ‘¤ Source Face:", sourceImageUrl);

    const response = await fetch(
      `${WAVESPEED_API_URL}/wavespeed-ai/image-face-swap`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WAVESPEED_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: targetImageUrl,
          face_image: sourceImageUrl,
          target_index: 0,
          output_format: "jpeg",
          enable_base64_output: false,
          enable_sync_mode: false,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("âŒ WaveSpeed API error:", errorText);
      throw new Error(`Generation service error: ${response.status}`);
    }

    const result = await response.json();
    const requestId =
      result.data?.id ||
      result.request_id ||
      result.id ||
      result.requestId ||
      result.task_id ||
      result.taskId ||
      result.prediction_id;

    if (!requestId) {
      throw new Error("No request ID in response");
    }

    console.log("âœ… Task submitted:", requestId);

    const finalResult = await waitForResult(requestId, 30);
    const outputUrl = finalResult.outputUrl;

    if (!outputUrl) {
      throw new Error("No output URL in result");
    }

    console.log("\nðŸŽ‰ ============================================");
    console.log("ðŸŽ‰ IMAGE FACE SWAP COMPLETE!");
    console.log("ðŸŽ‰ ============================================");
    console.log(`ðŸ–¼ï¸  Result URL: ${outputUrl}\n`);

    return {
      success: true,
      outputUrl: outputUrl,
      requestId: requestId,
    };
  } catch (error) {
    console.error("âŒ ERROR in image face swap:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate image from text prompt (for AI model generation)
 * Uses Seedream V4.5 for high-quality portrait generation
 *
 * @param {string} prompt - Text description of the person to generate
 * @param {object} options - Generation options
 * @param {string} options.aspectRatio - Aspect ratio (default: "1:1" for portraits)
 * @param {string} options.size - Image size in pixels (default: "1024")
 * @returns {Promise<{success: boolean, outputUrl?: string, error?: string}>}
 */
async function generateTextToImage(prompt, options = {}) {
  return await generateTextToImageNanoBananaKie(prompt, {
    aspectRatio: options.aspectRatio || "1:1",
    resolution: options.resolution || "2K",
    outputFormat: options.outputFormat || "png",
    forcePolling: options.forcePolling,
  });
}

/**
 * Generate reference image for AI model from parameters
 * This is Step 1 of the 2-phase AI model generation process
 * NOTE: Reference image MUST be non-explicit (Nano Banana requirement)
 *
 * @param {object} params - Generation parameters
 * @param {string} params.referencePrompt - Optional custom prompt for reference (must be non-explicit)
 * @param {string} params.gender - 'male' or 'female'
 * @param {number} params.age - e.g., 25
 * @param {object} params.savedAppearance - Optional full appearance object from selector chips
 * @param {string} params.hairColor - e.g., 'blonde', 'brown', 'black'
 * @param {string} params.eyeColor - e.g., 'blue', 'brown', 'green'
 * @param {string} params.style - e.g., 'glamour', 'fitness', 'elegant'
 * @param {string} params.bodyType - e.g., 'slim', 'athletic', 'curvy'
 * @param {string} params.heritage - e.g., 'european', 'african', 'latino', 'asian'
 * @param {string} params.hairLength - e.g., 'long', 'medium', 'short'
 * @param {string} params.hairTexture - e.g., 'straight', 'wavy', 'curly'
 * @param {string} params.lipSize - e.g., 'small', 'medium', 'big'
 * @param {string} params.faceType - e.g., 'cute', 'model', 'natural'
 * @returns {Promise<{success: boolean, referenceUrl?: string, error?: string}>}
 */
async function generateReferenceImage(params) {
  try {
    console.log("\nðŸ¤– ============================================");
    console.log("ðŸ¤– AI MODEL - PHASE 1: REFERENCE IMAGE");
    console.log("ðŸ¤– ============================================");
    console.log("ðŸ“‹ Parameters:", params);

    const {
      referencePrompt,
      gender,
      age,
      savedAppearance,
      hairColor,
      hairLength,
      hairTexture,
      lipSize,
      faceType,
      eyeColor,
      style,
      bodyType,
      heritage,
    } = params;

    // Build comprehensive prompt for reference image (NON-EXPLICIT)
    const genderText = gender === "male" ? "man" : "woman";
    const { article, subject } = portraitSubjectAgeGender(age, genderText);
    const savedAppearanceText =
      savedAppearance && typeof savedAppearance === "object"
        ? Object.values(savedAppearance)
            .filter((value) => typeof value === "string" && value.trim())
            .join(", ")
        : "";

    // Style mappings for reference (kept tasteful/non-explicit)
    const stylePrompts = {
      natural: "natural beauty, minimal makeup, soft natural lighting, fresh face",
      "strong-makeup": "glamorous makeup, bold lipstick, defined eyes, dramatic makeup, studio lighting",
      glamour: "glamorous appearance, elegant makeup, sophisticated look, studio lighting",
      professional: "professional appearance, polished look, clean makeup, business-ready style",
      fitness: "athletic healthy look, natural glow, sporty appearance",
      editorial: "editorial fashion look, high-fashion makeup, striking features",
      bohemian: "bohemian natural style, earthy tones, relaxed beauty",
    };

    // Heritage/ethnicity mappings
    const heritagePrompts = {
      european: "european features, caucasian",
      african: "african features, dark skin, afrocentric beauty",
      latino: "latin features, hispanic heritage, warm skin tone",
      asian: "asian features, east asian heritage",
      "middle-eastern": "middle eastern features, mediterranean complexion",
      mixed: "mixed ethnicity, unique blend of features",
    };

    // Safe fallbacks for all parameters
    const bodyTypeText = bodyType ? `${bodyType} body type` : "";
    const styleText = stylePrompts[style] || stylePrompts["natural"] || "natural beauty, soft natural lighting";
    const heritageText = heritagePrompts[heritage] || "";
    
    // Build hair description: combine length, texture, and color
    const hairParts = [hairLength, hairTexture, hairColor].filter(Boolean);
    const hairText = hairParts.length > 0 ? `with ${hairParts.join(" ")} hair` : "";
    
    // Lip size description
    const lipText = lipSize ? `${lipSize} lips` : "";
    
    // Face type descriptions (with safe fallback)
    const faceTypePrompts = {
      cute: "soft feminine features, youthful cute face, delicate features",
      model: "striking features, high cheekbones, defined jawline, photogenic face",
      natural: "natural balanced features",
    };
    const faceTypeText = faceTypePrompts[faceType] || faceTypePrompts["natural"] || "";

    // Realistic skin texture - visible pores but no acne
    const skinTexture = "natural skin texture with visible pores, clear skin without acne, healthy glowing skin";
    
    const basePrompt = [
      `beautiful portrait photo of ${article} ${subject}`,
      heritageText,
      faceTypeText,
      hairText,
      eyeColor ? `and ${eyeColor} eyes` : "",
      lipText,
      bodyTypeText,
      styleText,
      savedAppearanceText,
      referencePrompt ? referencePrompt : "",
      "high quality, detailed face, clear features, photorealistic, attractive",
      skinTexture,
    ]
      .filter(Boolean)
      .join(", ");

    console.log(`\nðŸ“ Generated base prompt: ${basePrompt}`);

    // Generate reference image
    console.log("\nðŸ“ Generating reference image...");
    const finalPrompt = `${basePrompt}, face portrait, looking at camera, neutral background`;

    // Use polling so we return referenceUrl in this request (no callback/DB needed for create-model flow)
    const referenceResult = await generateTextToImage(finalPrompt, {
      aspectRatio: "1:1",
      forcePolling: true,
    });

    if (!referenceResult.success) {
      throw new Error(
        `Failed to generate reference image: ${referenceResult.error}`,
      );
    }

    const referenceImageUrl = referenceResult.outputUrl;
    console.log(`âœ… Reference image generated: ${referenceImageUrl}`);

    return {
      success: true,
      referenceUrl: referenceImageUrl,
    };
  } catch (error) {
    console.error("âŒ ERROR in reference image generation:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate 3 model poses from a reference image
 * This is Step 2 of the 2-phase AI model generation process
 * Uses Nano Banana Pro Edit (Gemini 3.0 Pro) for better character consistency
 *
 * @param {string} referenceImageUrl - URL of the reference image to use
 * @param {object} options - Additional options for pose generation
 * @param {string} options.posesPrompt - Custom prompt to apply to all poses (can be explicit)
 * @param {string} options.outfitType - Type of outfit for the poses
 * @param {string} options.poseStyle - Style of poses to generate
 * @returns {Promise<{success: boolean, photos?: {photo1Url, photo2Url, photo3Url}, error?: string}>}
 */
async function generateModelPosesFromReference(
  referenceImageUrl,
  options = {},
) {
  try {
    console.log("\nðŸŒ ============================================");
    console.log("ðŸŒ AI MODEL - PHASE 2: GENERATING 3 POSES (Nano Banana Pro)");
    console.log("ðŸŒ ============================================");
    console.log(`ðŸ“¸ Reference Image: ${referenceImageUrl}`);
    console.log(`ðŸ“‹ Options:`, options);

    const {
      posesPrompt,
      outfitType,
      poseStyle,
      gender,
      age,
      bodyType,
      heritage,
      hairColor,
      hairLength,
      hairTexture,
      eyeColor,
      lipSize,
      faceType,
      style,
    } = options;

    // Outfit type mappings
    const outfitPrompts = {
      lingerie: "wearing elegant lingerie",
      swimwear: "wearing stylish swimwear",
      bodysuit: "wearing fitted bodysuit",
      dress: "wearing elegant form-fitting dress",
      casual: "wearing casual attractive outfit",
      fitness: "wearing athletic fitness wear",
      glamour: "wearing glamorous outfit",
      nude_artistic: "artistic nude, tasteful positioning",
    };

    // Pose style mappings
    const poseStylePrompts = {
      seductive: "seductive pose, alluring expression, confident",
      playful: "playful flirty pose, fun expression",
      elegant: "elegant sophisticated pose, graceful",
      confident: "confident powerful pose, strong presence",
      natural: "natural relaxed pose, genuine expression",
      sensual: "sensual pose, intimate mood, soft lighting",
    };

    const outfitText = outfitPrompts[outfitType] || "wearing stylish outfit";
    const poseStyleText =
      poseStylePrompts[poseStyle] || poseStylePrompts["seductive"];
    const customPrompt = posesPrompt || "";

    // Build base enhancement for all poses
    const baseEnhancement = [outfitText, poseStyleText, customPrompt]
      .filter(Boolean)
      .join(", ");

    const profileDescriptors = [
      gender ? `${gender} adult` : "",
      safeAgeYearsFragmentForImagePrompt(age),
      heritage ? `${heritage} heritage` : "",
      faceType ? `${faceType} face shape and facial features` : "",
      hairLength || hairTexture || hairColor
        ? `${[hairLength, hairTexture, hairColor].filter(Boolean).join(" ")} hair`
        : "",
      eyeColor ? `${eyeColor} eyes` : "",
      lipSize ? `${lipSize} lips` : "",
      style ? `${style} makeup/style` : "",
    ]
      .filter(Boolean)
      .join(", ");

    const bodyDescriptorMap = {
      slim: "slim proportions, lean physique",
      athletic: "athletic proportions, toned physique",
      curvy: "curvy proportions, fuller bust and hips",
      petite: "petite frame, compact proportions",
      hourglass: "hourglass proportions, defined waist with fuller bust and hips",
      muscular: "muscular proportions, strong physique",
    };
    const bodyDescriptor =
      bodyDescriptorMap[bodyType] || "balanced realistic body proportions";

    const characterDescriptor = [profileDescriptors, poseStyleText]
      .filter(Boolean)
      .join(", ");

    // STEP 1: Generate close-up selfie using kie.ai Nano Banana Pro
    // Pass reference image for identity guidance
    console.log("\nðŸ“ STEP 1/3: Generating close-up selfie (kie.ai Nano Banana Pro)...");
    const selfiePrompt = `Using image 1 as identity reference, create a close-up selfie of this exact same person. ${profileDescriptors ? `Person description: ${profileDescriptors}.` : ""} Keep the exact same face, facial features, hair color, eye color. Front facing camera, attractive selfie pose, alluring expression, no phone or hands visible. ${baseEnhancement}. High quality, photorealistic, natural skin texture with visible pores, clear skin without acne.`;

    const selfieResult = await generateImageWithNanoBananaKie(
      [referenceImageUrl],
      selfiePrompt,
      { model: "nano-banana-pro", resolution: "2K", aspectRatio: "1:1", forcePolling: true },
    );

    if (!selfieResult.success) {
      throw new Error(
        `Failed to generate close-up selfie: ${selfieResult.error}`,
      );
    }

    const photo1Url = selfieResult.outputUrl;
    console.log(`âœ… Close-up selfie generated: ${photo1Url}`);


    // STEPS 2 + 3 in parallel: both use [referenceImage, selfie] as identity anchors.
    // Generating concurrently halves elapsed time vs sequential.
    console.log("[poses] Steps 2+3: portrait and full body in parallel (nano-banana-pro)...");

    const portraitPrompt = `Using images 1 and 2 as identity reference, create a 3/4 angle portrait of this exact same person. ${profileDescriptors ? `Person description: ${profileDescriptors}.` : ""} Keep the exact same face, facial features, hair color, eye color from the reference images. Captivating look, studio lighting. ${baseEnhancement}. High quality, photorealistic, natural skin texture with visible pores, clear skin without acne.`;

    const fullBodyPrompt = [
      "Using images 1 and 2 as identity references, create a full body photo of the same person.",
      "Preserve exact identity: face structure, skin tone, hairline, eye shape and key facial details from references.",
      `Outfit/clothing: ${outfitText}.`,
      `Body proportions: ${bodyDescriptor}.`,
      `Character/profile traits: ${characterDescriptor}.`,
      "Pose/composition: full figure visible from head to toe, natural realistic anatomy, professional lighting.",
      customPrompt ? `Extra direction: ${customPrompt}.` : "",
      "Photorealistic, high quality details, natural skin texture.",
    ]
      .filter(Boolean)
      .join(" ");

    const [portraitResult, fullBodyResult] = await Promise.all([
      generateImageWithNanoBananaKie(
        [referenceImageUrl, photo1Url],
        portraitPrompt,
        { model: "nano-banana-pro", resolution: "2K", aspectRatio: "3:4", forcePolling: true },
      ),
      generateImageWithNanoBananaKie(
        [referenceImageUrl, photo1Url],
        fullBodyPrompt,
        { model: "nano-banana-pro", resolution: "2K", aspectRatio: "9:16", forcePolling: true },
      ),
    ]);

    if (!portraitResult.success) {
      throw new Error(`Failed to generate portrait: ${portraitResult.error}`);
    }
    if (!fullBodyResult.success) {
      throw new Error(`Failed to generate full body shot: ${fullBodyResult.error}`);
    }

    const photo2Url = portraitResult.outputUrl;
    const photo3Url = fullBodyResult.outputUrl;
    console.log(`[poses] Steps 2+3 done - portrait: ${photo2Url}`);
    console.log(`[poses] Steps 2+3 done - fullbody: ${photo3Url}`);
    console.log(`âœ… Full body shot generated: ${photo3Url}`);

    console.log("\nðŸŽ‰ ============================================");
    console.log("ðŸŽ‰ AI MODEL POSES GENERATION COMPLETE!");
    console.log("ðŸŽ‰ ============================================");
    console.log(`ðŸ“¸ Photo 1 (Close-up Selfie): ${photo1Url}`);
    console.log(`ðŸ“¸ Photo 2 (Portrait): ${photo2Url}`);
    console.log(`ðŸ“¸ Photo 3 (Full Body): ${photo3Url}`);

    // Mirror all photos to R2 for permanent storage
    console.log("\nðŸ“¦ Mirroring photos to R2 for permanent storage...");
    const { mirrorToR2 } = await import("../utils/r2.js");
    const [r2Photo1, r2Photo2, r2Photo3] = await Promise.all([
      mirrorToR2(photo1Url, "models"),
      mirrorToR2(photo2Url, "models"),
      mirrorToR2(photo3Url, "models"),
    ]);
    console.log("âœ… All photos mirrored to R2\n");

    return {
      success: true,
      photos: {
        photo1Url: r2Photo1,
        photo2Url: r2Photo2,
        photo3Url: r2Photo3,
      },
    };
  } catch (error) {
    console.error("âŒ ERROR in poses generation:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate AI model with consistent identity across 3 poses (legacy function)
 * Combines both phases into one call for backward compatibility
 *
 * @param {object} params - Generation parameters
 * @returns {Promise<{success: boolean, photos?: {photo1Url, photo2Url, photo3Url}, error?: string}>}
 */
async function generateAIModelPhotos(params) {
  try {
    // Phase 1: Generate reference image
    const refResult = await generateReferenceImage(params);
    if (!refResult.success) {
      return refResult;
    }

    // Phase 2: Generate 3 poses from reference — pass all appearance params for consistent identity
    const posesResult = await generateModelPosesFromReference(
      refResult.referenceUrl,
      {
        gender: params.gender,
        age: params.age,
        hairColor: params.hairColor,
        hairLength: params.hairLength,
        hairTexture: params.hairTexture,
        eyeColor: params.eyeColor,
        lipSize: params.lipSize,
        faceType: params.faceType,
        bodyType: params.bodyType,
        heritage: params.heritage,
        style: params.style,
        referencePrompt: params.prompt || params.referencePrompt || "",
      }
    );
    return posesResult;
  } catch (error) {
    console.error("âŒ ERROR in AI model generation:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate talking head video using Kling V2 AI Avatar Standard
 * High-quality lip-sync with expressive facial animation and head motion
 * Image + Audio â†’ Lip-synced video (up to 5 min)
 * Features: Accurate lip sync, expressive face & head motion, identity preservation, prompt control
 * Pricing: $0.056/s ($0.28 per 5s minimum)
 * @param {string} imageUrl - Portrait image URL
 * @param {string} audioUrl - Audio file URL (MP3)
 * @returns {Promise<{outputUrl: string}>}
 */
async function generateTalkingHead(imageUrl, audioUrl, prompt = null) {
  try {
    console.log("\nðŸŽ¬ ============================================");
    console.log("ðŸŽ¬ KLING V2 AI AVATAR STANDARD - TALKING HEAD");
    console.log("ðŸŽ¬ ============================================");
    console.log(`ðŸ“¸ Image: ${imageUrl}`);
    console.log(`ðŸŽµ Audio: ${audioUrl}`);
    if (prompt) console.log(`ðŸ’¬ Prompt: ${prompt}`);
    console.log("â³ Submitting to Kling V2 Avatar...\n");

    if (!WAVESPEED_API_KEY) {
      throw new Error("WAVESPEED_API_KEY is not configured");
    }

    const requestBody = {
      image: imageUrl,
      audio: audioUrl,
    };
    
    if (prompt && prompt.trim()) {
      requestBody.prompt = prompt.trim();
    }

    const submitUrl = `${WAVESPEED_API_URL}/kwaivgi/kling-v2-ai-avatar-standard`;
    const submitMaxAttempts = 3;
    let response = null;
    let lastSubmitError = null;

    for (let attempt = 1; attempt <= submitMaxAttempts; attempt++) {
      if (attempt > 1) {
        const backoffMs = attempt * 3000;
        console.warn(`âš ï¸ Kling V2 Avatar submit retry ${attempt}/${submitMaxAttempts} in ${Math.round(backoffMs / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      try {
        response = await fetch(submitUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WAVESPEED_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        lastSubmitError = error;
        if (isRetryableFetchError(error) && attempt < submitMaxAttempts) {
          continue;
        }
        throw error;
      }

      if (response.ok) break;

      const status = response.status;
      if ((status === 429 || status >= 500) && attempt < submitMaxAttempts) {
        continue;
      }
      break;
    }

    if (!response && lastSubmitError) {
      throw lastSubmitError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`âŒ Kling V2 Avatar error: ${response.status} - ${errorText}`);
      throw new Error(`Generation service error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("âœ… Kling V2 Avatar task submitted!");
    
    const requestId = data.data?.id || data.id || data.request_id;
    if (!requestId) {
      throw new Error("No request ID in response");
    }

    console.log(`ðŸ“‹ Request ID: ${requestId}`);
    
    // Kling V2 can handle up to 5 min videos
    const result = await waitForResult(requestId, 150);
    
    console.log("\nðŸŽ¬ ============================================");
    console.log(`ðŸŽ¬ KLING V2 AVATAR COMPLETE!`);
    console.log(`ðŸŽ¬ Output URL: ${result.outputUrl}`);
    console.log("ðŸŽ¬ ============================================\n");

    return result;
  } catch (error) {
    console.error("âŒ Kling V2 Avatar error:", error.message);
    throw error;
  }
}

/**
 * Generate only 2 additional poses from a reference image
 * Optimized for special offer - reference becomes photo1, only generates photo2 + photo3
 * 
 * @param {string} referenceImageUrl - URL of the reference image (will be used as photo1)
 * @param {object} options - Additional options for pose generation
 * @returns {Promise<{success: boolean, photos?: {photo1Url, photo2Url, photo3Url}, error?: string}>}
 */
async function generateTwoPosesFromReference(
  referenceImageUrl,
  options = {},
) {
  try {
    console.log("\nðŸŒ ============================================");
    console.log("ðŸŒ AI MODEL - GENERATING 2 ADDITIONAL POSES (Optimized)");
    console.log("ðŸŒ ============================================");
    console.log(`ðŸ“¸ Reference Image (will be photo1): ${referenceImageUrl}`);
    console.log(`ðŸ“‹ Options:`, options);

    const { outfitType, poseStyle, gender, age, bodyType, heritage, hairColor, hairLength, hairTexture, eyeColor, lipSize, faceType, style } = options;

    // Build profile descriptor for identity consistency (same as generateModelPosesFromReference)
    const profileDescriptors = [
      gender ? `${gender} adult` : "",
      safeAgeYearsFragmentForImagePrompt(age),
      heritage ? `${heritage} heritage` : "",
      faceType ? `${faceType} face shape and facial features` : "",
      hairLength || hairTexture || hairColor
        ? `${[hairLength, hairTexture, hairColor].filter(Boolean).join(" ")} hair`
        : "",
      eyeColor ? `${eyeColor} eyes` : "",
      lipSize ? `${lipSize} lips` : "",
      style ? `${style} makeup/style` : "",
    ].filter(Boolean).join(", ");

    const bodyDescriptorMap = {
      slim: "slim proportions, lean physique",
      athletic: "athletic proportions, toned physique",
      curvy: "curvy proportions, fuller bust and hips",
      petite: "petite frame, compact proportions",
      hourglass: "hourglass proportions, defined waist with fuller bust and hips",
      muscular: "muscular proportions, strong physique",
    };
    const bodyDescriptor = bodyDescriptorMap[bodyType] || "balanced realistic body proportions";

    // Outfit type mappings
    const outfitPrompts = {
      lingerie: "wearing elegant lingerie",
      swimwear: "wearing stylish swimwear",
      bodysuit: "wearing fitted bodysuit",
      dress: "wearing elegant form-fitting dress",
      casual: "wearing casual attractive outfit",
      fitness: "wearing athletic fitness wear",
      glamour: "wearing glamorous outfit",
    };

    // Pose style mappings
    const poseStylePrompts = {
      seductive: "seductive pose, alluring expression, confident",
      playful: "playful flirty pose, fun expression",
      elegant: "elegant sophisticated pose, graceful",
      confident: "confident powerful pose, strong presence",
      natural: "natural relaxed pose, genuine expression",
      sensual: "sensual pose, intimate mood, soft lighting",
    };

    const outfitText = outfitPrompts[outfitType] || outfitPrompts["casual"];
    const poseStyleText = poseStylePrompts[poseStyle] || poseStylePrompts["natural"];

    // Build base enhancement for poses
    const baseEnhancement = [outfitText, poseStyleText].filter(Boolean).join(", ");

    // STEP 1: Generate portrait (3/4 angle) - this will be photo2
    console.log("\nðŸ“ STEP 1/2: Generating portrait pose (kie.ai Nano Banana Pro)...");
    const portraitPrompt = `Using image 1 as identity reference, create a 3/4 angle portrait of this exact same person. Keep the exact same face, facial features, hair color, eye color. Captivating look, studio lighting. ${baseEnhancement}. High quality, photorealistic, natural skin texture with visible pores, clear skin without acne.`;

    const portraitResult = await generateImageWithNanoBananaKie(
      [referenceImageUrl],
      portraitPrompt,
      { model: "nano-banana-pro", resolution: "2K", aspectRatio: "3:4", forcePolling: true },
    );

    if (!portraitResult.success) {
      throw new Error(`Failed to generate portrait: ${portraitResult.error}`);
    }

    const photo2Url = portraitResult.outputUrl;
    console.log(`âœ… Portrait generated: ${photo2Url}`);

    // STEP 2: Generate full body shot using Seedream (better for full-body anatomy)
    console.log("\n📸 STEP 2/2: Generating full body shot (WaveSpeed Seedream V4.5 Edit)...");
    const fullBodyPromptParts = [
      "Using images 1 and 2 as identity reference, create a full body photo of the same person.",
      "Preserve exact identity: face structure, skin tone, hairline, eye shape and key facial details from references.",
      profileDescriptors ? `Person description: ${profileDescriptors}.` : "",
      `Body proportions: ${bodyDescriptor}.`,
      baseEnhancement ? `Style: ${baseEnhancement}.` : "",
      "Pose: full figure visible from head to toe, natural realistic anatomy, professional lighting.",
      "Photorealistic, high quality details, natural skin texture.",
    ];
    const fullBodyPrompt = fullBodyPromptParts.filter(Boolean).join(" ");

    const fullBodyResult = await generateImageWithSeedream(
      [referenceImageUrl, photo2Url],
      fullBodyPrompt,
      // This flow must return outputUrl in-process (Stripe / special-offer) — no DB row to pair a webhook to.
      { aspectRatio: "9:16", size: "2k", forcePolling: true },
    );

    if (!fullBodyResult.success) {
      throw new Error(`Failed to generate full body shot: ${fullBodyResult.error}`);
    }

    const photo3Url = fullBodyResult.outputUrl;
    console.log(`âœ… Full body shot generated: ${photo3Url}`);

    console.log("\nðŸŽ‰ ============================================");
    console.log("ðŸŽ‰ 2 ADDITIONAL POSES GENERATED!");
    console.log("ðŸŽ‰ ============================================");
    console.log(`ðŸ“¸ Photo 1 (Reference): ${referenceImageUrl}`);
    console.log(`ðŸ“¸ Photo 2 (Portrait): ${photo2Url}`);
    console.log(`ðŸ“¸ Photo 3 (Full Body): ${photo3Url}\n`);

    return {
      success: true,
      photos: {
        photo1Url: referenceImageUrl, // Use original reference
        photo2Url: photo2Url,
        photo3Url: photo3Url,
      },
    };
  } catch (error) {
    console.error("âŒ ERROR in 2-pose generation:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Submit a job to WaveSpeed without waiting for result.
 * Returns the request ID so it can be saved and tracked by the background poller.
 */
async function submitToWaveSpeed(endpoint, requestBody) {
  const submitResponse = await fetch(`${WAVESPEED_API_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WAVESPEED_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
    // Prevent long-hanging submissions that can exceed Vercel request time.
    signal: AbortSignal.timeout(30_000),
  });

  const responseText = await submitResponse.text();

  if (!submitResponse.ok) {
    console.error(`âŒ API Error ${submitResponse.status}:`, responseText);
    throw new Error(`Failed to submit task: ${submitResponse.status} - ${responseText}`);
  }

  let submitData;
  try {
    submitData = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
  }

  const requestId =
    submitData.data?.id ||
    submitData.request_id ||
    submitData.id ||
    submitData.requestId ||
    submitData.task_id ||
    submitData.taskId ||
    submitData.prediction_id;

  if (!requestId) {
    throw new Error("No request ID in generation response");
  }

  return requestId;
}

async function submitNsfwVideo(imageUrl, prompt, options = {}) {
  try {
    const duration = options.duration === 8 ? 8 : 5;
    const resolution = "720p";

    console.log("\nðŸŽ¬ ============================================");
    console.log("ðŸŽ¬ NSFW VIDEO (WAN 2.2 Spicy Image-to-Video)");
    console.log("ðŸŽ¬ ============================================");
    console.log(`ðŸ“¸ Source image: ${imageUrl}`);
    console.log(`ðŸ“ Prompt: ${prompt}`);
    console.log(`â±ï¸ Duration: ${duration}s | Resolution: ${resolution}`);
    console.log("â³ Submitting to WaveSpeed...\n");

    const seed = options.seed || Math.floor(Math.random() * 2147483647);

    console.log(`ðŸŒ± Seed: ${seed}`);

    const requestBody = {
      image: imageUrl,
      prompt: prompt,
      resolution: resolution,
      duration: duration,
      seed: seed,
    };

    const callbackUrl = getWaveSpeedCallbackUrl();
    if (!callbackUrl) {
      throw new Error("WaveSpeed callback URL is required (set WAVESPEED_CALLBACK_URL or CALLBACK_BASE_URL)");
    }
    console.log(`🔔 WaveSpeed NSFW video webhook: ${callbackUrl}`);
    const baseSubmitUrl = `${WAVESPEED_API_URL}/wavespeed-ai/wan-2.2-spicy/image-to-video`;

    // Provider variants: keep callback semantics, try multiple accepted callback shapes.
    const attempts = [
      {
        url: `${baseSubmitUrl}?webhook=${encodeURIComponent(callbackUrl)}`,
        body: requestBody,
        label: "query:webhook",
      },
      {
        url: baseSubmitUrl,
        body: requestBody,
        label: "plain-body",
      },
    ];

    let submitResponse = null;
    let responseText = "";
    for (const attempt of attempts) {
      submitResponse = await fetch(attempt.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WAVESPEED_API_KEY}`,
        },
        body: JSON.stringify(attempt.body),
        signal: AbortSignal.timeout(30_000),
      });
      responseText = await submitResponse.text();
      if (submitResponse.ok) {
        break;
      }
      console.warn(`⚠️ WaveSpeed NSFW submit failed (${attempt.label}) HTTP ${submitResponse.status}; trying next callback variant`);
    }

    if (!WAVESPEED_API_KEY) {
      throw new Error("WAVESPEED_API_KEY is not configured -- face swap unavailable");
    }

    if (!submitResponse.ok) {
      console.error(`âŒ API Error ${submitResponse.status}:`, responseText);
      throw new Error(`Failed to submit: ${submitResponse.status} - ${responseText}`);
    }

    let submitData;
    try {
      submitData = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }

    const requestId =
      submitData.data?.id ||
      submitData.request_id ||
      submitData.id ||
      submitData.requestId;

    if (!requestId) {
      console.error("âŒ Full response:", JSON.stringify(submitData, null, 2));
      throw new Error(`No request ID in response`);
    }

    console.log(`âœ… Task submitted! Request ID: ${requestId} | Seed: ${seed}`);
    return { success: true, requestId, seed };
  } catch (error) {
    console.error("âŒ ERROR in NSFW video submit:", error.message);
    return { success: false, error: error.message };
  }
}

async function pollNsfwVideo(requestId) {
  try {
    const result = await waitForResult(requestId, 180);
    const archivedUrl = await archiveToR2(result.outputUrl);
    return { success: true, outputUrl: archivedUrl };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function submitNsfwVideoExtend(videoUrl, prompt, options = {}) {
  try {
    const duration = options.duration === 8 ? 8 : 5;
    const resolution = "720p";

    console.log("\nðŸŽ¬ ============================================");
    console.log("ðŸŽ¬ NSFW VIDEO EXTEND (WAN 2.2 Spicy Video-Extend)");
    console.log("ðŸŽ¬ ============================================");
    console.log(`ðŸŽ¥ Source video: ${videoUrl}`);
    console.log(`ðŸ“ Prompt: ${prompt}`);
    console.log(`â±ï¸ Extend by: ${duration}s | Resolution: ${resolution}`);
    console.log("â³ Submitting to WaveSpeed...\n");

    const seed = options.seed || -1;

    console.log(`ðŸŒ± Seed: ${seed}`);

    const requestBody = {
      video: videoUrl,
      prompt: prompt,
      resolution: resolution,
      duration: duration,
      seed: seed,
    };

    const callbackUrl = getWaveSpeedCallbackUrl();
    if (!callbackUrl) {
      throw new Error("WaveSpeed callback URL is required (set WAVESPEED_CALLBACK_URL or CALLBACK_BASE_URL)");
    }
    console.log(`🔔 WaveSpeed NSFW video-extend webhook: ${callbackUrl}`);
    const baseSubmitUrl = `${WAVESPEED_API_URL}/wavespeed-ai/wan-2.2-spicy/video-extend`;

    const attempts = [
      {
        url: `${baseSubmitUrl}?webhook=${encodeURIComponent(callbackUrl)}`,
        body: requestBody,
        label: "query:webhook",
      },
      {
        url: baseSubmitUrl,
        body: requestBody,
        label: "plain-body",
      },
    ];

    let submitResponse = null;
    let responseText = "";
    for (const attempt of attempts) {
      submitResponse = await fetch(attempt.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WAVESPEED_API_KEY}`,
        },
        body: JSON.stringify(attempt.body),
        signal: AbortSignal.timeout(30_000),
      });
      responseText = await submitResponse.text();
      if (submitResponse.ok) {
        break;
      }
      console.warn(`⚠️ WaveSpeed NSFW-extend submit failed (${attempt.label}) HTTP ${submitResponse.status}; trying next callback variant`);
    }

    if (!WAVESPEED_API_KEY) {
      throw new Error("WAVESPEED_API_KEY is not configured -- face swap unavailable");
    }

    if (!submitResponse.ok) {
      console.error(`âŒ API Error ${submitResponse.status}:`, responseText);
      throw new Error(`Failed to submit: ${submitResponse.status} - ${responseText}`);
    }

    let submitData;
    try {
      submitData = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }

    const requestId =
      submitData.data?.id ||
      submitData.request_id ||
      submitData.id ||
      submitData.requestId;

    if (!requestId) {
      console.error("âŒ Full response:", JSON.stringify(submitData, null, 2));
      throw new Error(`No request ID in response`);
    }

    console.log(`âœ… Video extend submitted! Request ID: ${requestId}`);
    return { success: true, requestId };
  } catch (error) {
    console.error("âŒ ERROR in NSFW video extend submit:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Build all prompt strings and image arrays for a 3-pose model generation.
 * Returns pre-computed prompts so they can be stored and reused across callback hops.
 * Does NOT call any AI APIs — just pure prompt construction.
 */
export function buildModelPosesPrompts(referenceImageUrl, options = {}) {
  const {
    posesPrompt,
    outfitType,
    poseStyle,
    gender,
    age,
    bodyType,
    heritage,
    hairColor,
    hairLength,
    hairTexture,
    eyeColor,
    lipSize,
    faceType,
    style,
  } = options;

  const outfitPrompts = {
    lingerie: "wearing elegant lingerie",
    swimwear: "wearing stylish swimwear",
    bodysuit: "wearing fitted bodysuit",
    dress: "wearing elegant form-fitting dress",
    casual: "wearing casual attractive outfit",
    fitness: "wearing athletic fitness wear",
    glamour: "wearing glamorous outfit",
    nude_artistic: "artistic nude, tasteful positioning",
  };
  const poseStylePrompts = {
    seductive: "seductive pose, alluring expression, confident",
    playful: "playful flirty pose, fun expression",
    elegant: "elegant sophisticated pose, graceful",
    confident: "confident powerful pose, strong presence",
    natural: "natural relaxed pose, genuine expression",
    sensual: "sensual pose, intimate mood, soft lighting",
  };
  const bodyDescriptorMap = {
    slim: "slim proportions, lean physique",
    athletic: "athletic proportions, toned physique",
    curvy: "curvy proportions, fuller bust and hips",
    petite: "petite frame, compact proportions",
    hourglass: "hourglass proportions, defined waist with fuller bust and hips",
    muscular: "muscular proportions, strong physique",
  };

  const outfitText = outfitPrompts[outfitType] || "wearing stylish outfit";
  const poseStyleText = poseStylePrompts[poseStyle] || poseStylePrompts["seductive"];
  const customPrompt = posesPrompt || "";
  const baseEnhancement = [outfitText, poseStyleText, customPrompt].filter(Boolean).join(", ");
  const bodyDescriptor = bodyDescriptorMap[bodyType] || "balanced realistic body proportions";

  const profileDescriptors = [
    gender ? `${gender} adult` : "",
    safeAgeYearsFragmentForImagePrompt(age),
    heritage ? `${heritage} heritage` : "",
    faceType ? `${faceType} face shape and facial features` : "",
    hairLength || hairTexture || hairColor
      ? `${[hairLength, hairTexture, hairColor].filter(Boolean).join(" ")} hair`
      : "",
    eyeColor ? `${eyeColor} eyes` : "",
    lipSize ? `${lipSize} lips` : "",
    style ? `${style} makeup/style` : "",
  ].filter(Boolean).join(", ");

  const characterDescriptor = [profileDescriptors, poseStyleText].filter(Boolean).join(", ");

  const selfiePrompt = `Using image 1 as identity reference, create a close-up selfie of this exact same person. ${profileDescriptors ? `Person description: ${profileDescriptors}.` : ""} Keep the exact same face, facial features, hair color, eye color. Front facing camera, attractive selfie pose, alluring expression, no phone or hands visible. ${baseEnhancement}. High quality, photorealistic, natural skin texture with visible pores, clear skin without acne.`;

  const portraitPrompt = `Using images 1 and 2 as identity reference, create a 3/4 angle portrait of this exact same person. ${profileDescriptors ? `Person description: ${profileDescriptors}.` : ""} Keep the exact same face, facial features, hair color, eye color from the reference images. Captivating look, studio lighting. ${baseEnhancement}. High quality, photorealistic, natural skin texture with visible pores, clear skin without acne.`;

  const fullBodyPrompt = [
    "Using images 1 and 2 as identity references, create a full body photo of the same person.",
    "Preserve exact identity: face structure, skin tone, hairline, eye shape and key facial details from references.",
    `Outfit/clothing: ${outfitText}.`,
    `Body proportions: ${bodyDescriptor}.`,
    `Character/profile traits: ${characterDescriptor}.`,
    "Pose/composition: full figure visible from head to toe, natural realistic anatomy, professional lighting.",
    customPrompt ? `Extra direction: ${customPrompt}.` : "",
    "Photorealistic, high quality details, natural skin texture.",
  ].filter(Boolean).join(" ");

  return {
    referenceImageUrl,
    selfiePrompt,
    portraitPrompt,
    fullBodyPrompt,
  };
}

export {
  submitToWaveSpeed,
  generateImageWithNanoBanana,
  generateImageWithSeedream,
  faceSwapVideo,
  faceSwapImage,
  generateAIModelPhotos,
  generateReferenceImage,
  generateModelPosesFromReference,
  generateTwoPosesFromReference,
  generateTalkingHead,
  isExplicitContentError,
  getExplicitContentUserMessage,
  submitNsfwVideo,
  pollNsfwVideo,
  submitNsfwVideoExtend,
};


