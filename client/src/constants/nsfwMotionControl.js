/**
 * Motion X / NSFW Motion — backend: RunningHub AI app (media upload + `run/ai-app`).
 * Shared by Create (Video → Recreate) and NSFW Studio.
 *
 * UI naming (product choice):
 *   - Create / avatar video recreate: **Motion X**
 *   - NSFW Studio only: **NSFW Motion Control**
 *
 * Backend: POST /api/nsfw/generate-motion-video → submitNsfwMotionVideo (nsfw-motion.service.js).
 * Generation type: nsfw-video-motion
 */

/** Recreate engine value stored in video draft + sent with /generate/video-motion (other engines only). */
export const NSFW_MOTION_RUNPOD_ENGINE = "nsfw-motion";

/** Legacy draft/localStorage value — normalized on restore. */
export const NSFW_MOTION_RUNPOD_ENGINE_LEGACY = "motion-x";

/** Credits per second (aligned with MOTION_BASE_CREDITS_PER_SEC in nsfw.controller.js). */
export const NSFW_MOTION_CREDITS_PER_SEC = 30;

/** Create tab — Video → Recreate engine button / hints. */
export const MOTION_X_CREATE_LABEL = "Motion X";

/** NSFW Studio — gallery, info, and motion-specific actions. */
export const NSFW_MOTION_STUDIO_LABEL = "NSFW Motion Control";

export function normalizeNsfwMotionEngine(value) {
  if (value === NSFW_MOTION_RUNPOD_ENGINE_LEGACY) return NSFW_MOTION_RUNPOD_ENGINE;
  return value;
}

export function isNsfwMotionRunpodEngine(value) {
  return value === NSFW_MOTION_RUNPOD_ENGINE || value === NSFW_MOTION_RUNPOD_ENGINE_LEGACY;
}
