/**
 * Multi-reference Seedream-style prompts. Input order is always:
 *   images 1–3 = identity references (same person, model photos)
 *   image 4   = target / composition reference (pose, scene, and optionally outfit)
 *
 * Tuned for stronger likeness adherence and less identity bleed from image 4.
 */

/**
 * Full identity swap — outfit from image 3; pose/scene from image 4.
 * Extra emphasis vs reference mode: models often “snap” to image 3’s pose/room when copying clothes;
 * we explicitly forbid importing any spatial or background cues from 1–3 and lock geometry to image 4.
 */
export const IDENTITY_RECREATE_MODEL_CLOTHES = [
  "IMAGE ROLES: Images 1, 2, and 3 are the same person — use them only for who they look like. Image 3 additionally shows which clothes to wear. Image 4 is the only source for where the body is in space, how the camera sees the scene, and what the world looks like. Image 4 is never an identity source.",

  "COMPOSITION AND GEOMETRY LOCK (image 4 only — non-negotiable): Match image 4 exactly for — full-body or partial framing as shown; subject scale and placement in the frame; camera angle, distance, crop, and aspect; horizon, perspective, and depth of field; every background pixel, environment, floor, wall, sky, furniture, and props. The output must look like image 4 with a different person and different clothes, not a new scene.",

  "IGNORE SPATIAL CUES FROM IMAGES 1-3: Do not copy or blend pose, body position, lean, stance, arm/leg angles, head tilt, gaze direction, framing, lighting setup, studio, room, or backdrop from images 1, 2, or 3. Those photos are irrelevant for layout; only image 4 defines spatial structure.",

  "IDENTITY (images 1-3): Preserve face geometry (eyes, eyebrows, nose, lips, jaw, cheeks, ears), skin tone, hairline, hair color and texture, and recognizable body build — but joint angles, limb positions, silhouette outline, and contact with the environment must follow image 4 exactly, not the reference photos.",

  "POSE: Replicate precisely from image 4 — limb placement, hand poses, torso and hip orientation, head angle, and gaze. The skeleton pose is dictated solely by image 4.",

  "EXPRESSION: Apply the facial expression from image 4 onto the face from images 1-3. Transfer expression only, not facial structure from image 4.",

  "LIGHTING: Match lighting direction, intensity, and quality from image 4. Adapt highlights and shadows onto skin from images 1-3 naturally.",

  "WARDROBE (image 3 only — appearance, not layout): Copy garment types, colors, patterns, layers, footwear, and jewelry as worn in image 3. Treat clothes as textures applied to the body posed like image 4. Do not pull any clothing from image 4. Do not recreate image 3’s pose, room, or background — only the clothes.",

  "STRICT RULES: One subject. One consistent identity from images 1-3. No identity morphing with image 4. No duplicated faces. No extra or missing limbs. Anatomically plausible hands. Natural skin texture.",

  "FINAL OUTPUT: The exact scene, pose, and camera of image 4 — same background and composition — with the person from images 1-3 and the outfit from image 3.",
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
