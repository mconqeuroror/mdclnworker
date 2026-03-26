/**
 * Multi-reference Seedream-style prompts. Input order is always:
 *   images 1–3 = identity references (same person, model photos)
 *   image 4   = target / composition reference (pose, scene, and optionally outfit)
 *
 * Tuned for stronger likeness adherence and less identity bleed from image 4.
 */

/** Full identity swap — outfit from image 3; pose/scene from image 4. */
export const IDENTITY_RECREATE_MODEL_CLOTHES = [
  "IMAGE ROLES: Images 1, 2, 3 are identity references of the same person. Image 4 defines pose, scene, composition, and lighting only — it is not an identity source under any condition.",

  "IDENTITY LOCK (images 1-3 only): Preserve exactly — face geometry (shape, eyes, eyebrows, nose, lips, jawline, cheekbones, ears), skin tone, hairline, hair color, hair texture, body type, and limb proportions. These traits must not be influenced, blended, or replaced by anything from image 4.",

  "POSE AND SCENE (image 4 only): Replicate precisely — body pose, limb placement, hand positions, head angle, gaze direction, camera angle, framing, crop, lens perspective, depth of field, background, environment, and props. These must match image 4 exactly.",

  "EXPRESSION: Apply the facial expression from image 4 onto the face from images 1-3. Adapt the expression only — do not transfer any facial features.",

  "LIGHTING: Match lighting direction, intensity, and quality from image 4. Adapt highlights, shadows, and skin shading naturally to the skin tone of images 1-3.",

  "WARDROBE: Reproduce clothing, footwear, jewelry, and all accessories exactly from image 3. Do not use or reference any garments or accessories from image 4.",

  "STRICT RULES: Single subject. One face from images 1-3 only. No identity blending or morphing. No duplicated faces. No extra or missing limbs. Anatomically correct hands. Natural skin texture throughout.",

  "FINAL OUTPUT: One person — face and body from images 1-3 — wearing the outfit from image 3 — placed exactly into the scene and pose of image 4.",
].join(" ");

/** Identity from 1-3; outfit from image 4. Optional user text appended by the caller. */
export const IDENTITY_RECREATE_REFERENCE_CLOTHES = [
  "IMAGE ROLES: Images 1, 2, 3 are identity references of the same person. Image 4 defines pose, scene, composition, lighting, and wardrobe only — it is not an identity source under any condition.",

  "IDENTITY LOCK (images 1-3 only): Preserve exactly — face geometry (shape, eyes, eyebrows, nose, lips, jawline, cheekbones, ears), skin tone, hairline, hair color, hair texture, body type, and limb proportions. These traits must not be influenced, blended, or replaced by anything from image 4.",

  "POSE AND SCENE (image 4 only): Replicate precisely — body pose, limb placement, hand positions, head angle, gaze direction, camera angle, framing, crop, lens perspective, depth of field, background, environment, and props. These must match image 4 exactly.",

  "EXPRESSION: Apply the facial expression from image 4 onto the face from images 1-3. Adapt the expression only — do not transfer any facial features.",

  "LIGHTING: Match lighting direction, intensity, and quality from image 4. Adapt highlights, shadows, and skin shading naturally to the skin tone of images 1-3.",

  "WARDROBE: Reproduce clothing, footwear, jewelry, and all accessories exactly from image 4. Do not use or reference any garments or accessories from images 1-3.",

  "STRICT RULES: Single subject. One face from images 1-3 only. No identity blending or morphing. No duplicated faces. No extra or missing limbs. Anatomically correct hands. Natural skin texture throughout.",

  "FINAL OUTPUT: One person — face and body from images 1-3 — wearing the exact outfit and accessories from image 4 — placed precisely into the scene and pose of image 4.",
].join(" ");
