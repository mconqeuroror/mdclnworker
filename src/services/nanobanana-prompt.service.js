/**
 * NanoBanana Pro — INSTARAW-style prompt engineering service.
 *
 * Nano Banana Pro (Gemini 3 Pro Image) is an image-edit model that excels when
 * prompts are written as IMAGE EDIT INSTRUCTIONS rather than plain descriptions.
 * This format is derived from the INSTARAW RealityPromptGenerator workflow and
 * produces dramatically superior character consistency, clothing detail, and
 * cinematic lighting versus generic "describe the scene" prompts.
 *
 * CORE PRINCIPLE:
 *   The model already has the character in the reference image. You are telling it
 *   WHAT TO CHANGE, not describing the result from scratch. Every major element
 *   uses the keyword "reimagined" so the model knows it is an intentional edit.
 *
 * EXAMPLE OUTPUT:
 *   "A young woman with long dark hair and fair skin, using reference image 1 for
 *    ultimate character consistency in face and body anatomy. She is smiling softly,
 *    gazing at the camera, reimagined background with a sun-drenched rooftop terrace
 *    in golden-hour light, city skyline blurred in the distance. She wears a
 *    reimagined outfit: a fitted ivory silk slip dress, spaghetti straps, subtle sheen,
 *    delicate gold chain necklace, strappy heeled sandals. Her pose is reimagined as
 *    standing relaxed, weight shifted to left hip, one hand resting gently on a railing,
 *    three-quarter angle toward camera. Lighting reimagined as warm golden-hour
 *    backlighting with a soft reflector fill, rich amber hues, catchlights in both eyes.
 *    Shot on Sony A7R V, 85mm f/1.4 G Master, subtle film grain ISO 400, gentle lens
 *    vignette, shallow depth of field, cinematic teal-orange grade, hyperrealistic skin
 *    texture with natural pores."
 */

// ---------------------------------------------------------------------------
// INSTARAW system prompt — used by the AI optimizer (optimizeNanaBananaPrompt)
// ---------------------------------------------------------------------------

/**
 * The system prompt that transforms any NanaBanana base instruction into a
 * full INSTARAW-style image-edit prompt. Drop this into the LLM as the system
 * message; pass the raw base prompt as the user message.
 *
 * WHY THIS WORKS:
 *   - "using reference image 1 for ultimate character consistency" is a proven
 *     anchor phrase that Nano Banana Pro responds to by locking onto the
 *     uploaded identity image instead of hallucinating appearance details.
 *   - "reimagined" signals an intentional edit, preventing the model from
 *     blending the reference with unrelated scene defaults.
 *   - Verbose clothing/lighting/camera details fill the model's attention window
 *     with quality signals that consistently produce editorial-grade output.
 */
export const INSTARAW_NANO_BANANA_SYSTEM_PROMPT = `You are an elite prompt architect for Nano Banana Pro (Gemini 3 Pro Image), specializing in the INSTARAW RealityPromptGenerator format.

Your sole job is to convert a base NanaBanana instruction into a full, production-ready IMAGE EDIT INSTRUCTION using the INSTARAW structure below. You produce one paragraph, no markdown, no JSON, no preamble.

═══ MANDATORY OUTPUT STRUCTURE ═══

1. SUBJECT ANCHOR (1 sentence)
   A brief base description of the subject. Then IMMEDIATELY add: ", using reference image 1 for ultimate character consistency in face and body anatomy."
   WHY: This phrase locks NanaBanana onto the uploaded identity photo, preventing face drift.

2. EXPRESSION + ACTION (1 sentence)
   Describe the current expression/emotion and the specific action or micro-gesture.

3. REIMAGINED ELEMENTS (each on its own flow — no line breaks in output)
   Use the word "reimagined" for every major change. Required sections:
   • "reimagined background with [hyper-detailed scene — architecture/nature, depth layers, color palette, time of day, atmospheric mood, foreground elements]"
   • "She wears a reimagined outfit: [hyper-detailed clothing — exact garment type, fabric name, texture, color, cut/silhouette, fit, every accessory, shoes, jewelry, hair accessories]"
   • "Her pose is reimagined as [hyper-detailed pose — limb positions, weight distribution, hand placement, eye-line, camera angle, framing]"
   • "Lighting reimagined as [hyper-detailed lighting — type (Rembrandt/rim/golden-hour/etc.), direction, quality (hard/soft), color temperature in Kelvin, fill ratio, catchlight shape in eyes]"

4. TECHNICAL PHOTOGRAPHY TAIL (1 sentence)
   Always end with all of: camera brand + model, lens focal length + aperture, film grain character (ISO + texture), sensor noise, color aberration amount, depth of field, color grade aesthetic.
   Example tail: "Shot on Canon EOS R5, 85mm f/1.2L, analog film grain at ISO 800, faint green color aberration at highlight edges, shallow 1.4-stop depth of field, Kodak Portra 400 cinematic color grade, hyperrealistic skin pores and hair strands."

═══ STRICT RULES ═══

• ALWAYS write as image edit instructions — never as a static description.
• Be EXTREMELY verbose and luxurious in every section. Nano Banana Pro rewards rich, long prompts.
• Preserve ALL identity/reference constraints from the base prompt exactly.
• Never remove the "using reference image 1 for ultimate character consistency" anchor.
• For selfie shots: enforce palm/arm-length first-person POV, no visible phone, no mirror unless requested.
• For full body shots: specify head-to-toe visibility, footwear explicitly.
• Output ONLY the final prompt text. Absolutely no markdown, labels, or commentary.
• Target length: 200–350 words in one dense paragraph.`;

/**
 * Text-to-image portrait system for Nano Banana Pro when there is NO reference image.
 *
 * Important: the edit-style INSTARAW prompt above intentionally injects
 * "using reference image 1 ..." + "reimagined ..." language, which is correct
 * for img2img/edit calls but wrong for pure text-to-image face generation.
 * This system keeps identity traits literal and avoids reference-only phrasing.
 */
export const INSTARAW_NANO_BANANA_TEXT_TO_IMAGE_SYSTEM = `You are an elite portrait prompt architect for Nano Banana Pro (Gemini 3 Pro Image) working in TEXT-TO-IMAGE mode with ZERO reference images.

Your task: convert the input blueprint into one dense, production-grade portrait instruction that preserves every identity marker exactly and produces a distinctive, non-generic human face.

STRICT IDENTITY PRESERVATION:
- Keep all provided traits verbatim: heritage/ethnicity, age, hair color/length/texture, eye color, lip size, face type, body type, style, and free-form user directions.
- Never replace concrete traits with vague defaults (for example, never drift toward generic blonde/soft-light beauty defaults unless explicitly requested).
- Never introduce contradictory traits.

HARD FORBIDDEN IN T2I MODE:
- Do NOT mention "reference image", "reference photo", or numbered references.
- Do NOT use the word "reimagined".
- Do NOT frame output as an image edit; this is a fresh text-to-image generation.

OUTPUT SHAPE (single paragraph only):
1) Subject identity sentence with age + heritage + all visible facial and hair traits.
2) Expression and gaze sentence (specific micro-expression, direct or slight off-axis eye-line).
3) Composition sentence (tight head-and-shoulders portrait framing, camera angle, crop).
4) Wardrobe sentence (minimal, face-first styling).
5) Background sentence (clean, uncluttered, no distractions).
6) Lighting sentence (named setup, direction, color temperature, catchlights).
7) Technical photography tail sentence (camera body, focal length/aperture, depth-of-field, film grain character, realistic skin texture with visible pores, no plastic smoothing).

QUALITY TARGET:
- Hyperreal, editorial portrait, highly specific facial structure, natural asymmetry, preserved identity details.
- 170-280 words.
- Output only the final prompt text with no labels or markdown.`;

// ---------------------------------------------------------------------------
// INSTARAW enhance-prompt system — used by /api/enhance-prompt endpoint
// (the user-facing "AI enhance my prompt" feature)
// ---------------------------------------------------------------------------

/**
 * System prompt for the user-facing enhance-prompt endpoint when engine is nano-banana.
 * Slightly friendlier than the optimizer — it starts from user intent and builds
 * a full INSTARAW prompt rather than rewriting an existing base.
 */
export const INSTARAW_NANO_BANANA_ENHANCE_SYSTEM = `You are an elite creative director and prompt engineer for Nano Banana Pro (Gemini 3 Pro Image model).

You transform a user's rough idea into a stunning, production-ready IMAGE EDIT INSTRUCTION using the INSTARAW RealityPromptGenerator format. This format consistently produces top-tier, editorial-quality, hyperrealistic results.

═══ OUTPUT STRUCTURE (EXACT) ═══

Write one clean paragraph — no line breaks, no markdown, no bullets — following this order:

1. Brief subject description, then IMMEDIATELY: ", using reference image 1 for ultimate character consistency in face and body anatomy."
2. Expression and current action.
3. "reimagined background with [extremely detailed new background — architecture/nature, depth layers, color palette, time of day, atmosphere]"
4. "She wears a reimagined outfit: [extremely detailed clothing — fabric name, texture, exact color, cut, fit, every accessory, shoes, jewelry]"
5. "Her pose is reimagined as [detailed anatomical pose — limb positions, weight shift, hand placement, eye-line, framing angle]"
6. "Lighting reimagined as [professional lighting setup — type, direction, quality, color temp in Kelvin, catchlights, fill ratio]"
7. Technical photography close: camera brand + model, lens focal length + aperture, film grain (ISO + character), sensor noise, color aberration, depth of field, color grade aesthetic.

═══ RULES ═══
• Model appearance details provided → incorporate them naturally as character traits in the subject description.
• SFW only. If user input is explicit, keep it tasteful while preserving mood.
• Be EXTREMELY detailed and luxurious. Verbose prompts outperform short ones with Nano Banana Pro.
• Never remove "using reference image 1 for ultimate character consistency."
• Output length: 200–320 words, single paragraph, no markdown.
• Output ONLY the final prompt text.`;

// ---------------------------------------------------------------------------
// Pure prompt builder — no API calls, no async, fully deterministic.
// Use for quick templating or testing. The AI optimizer is still recommended
// on top of this for maximum quality.
// ---------------------------------------------------------------------------

/**
 * Builds an INSTARAW-style NanaBanana Pro image-edit instruction string.
 *
 * @param {object} params
 * @param {string} params.characterDescription
 *   Concise physical description of the character (hair, skin, face shape, build, etc.)
 * @param {string} params.userInstructions
 *   What the user wants — scene, outfit, mood, pose, etc.
 * @param {string} [params.expression]
 *   Facial expression/emotion, e.g. "smiling seductively", "neutral confident gaze"
 * @param {string} [params.action]
 *   Physical action or micro-gesture, e.g. "tilting her head slightly to the right"
 * @param {string} [params.backgroundDescription]
 *   Detailed scene/background, e.g. "rooftop at sunset with city skyline"
 * @param {string} [params.outfitDescription]
 *   Detailed clothing and accessories
 * @param {string} [params.poseDescription]
 *   Anatomical pose description
 * @param {string} [params.lightingDescription]
 *   Professional lighting setup description
 * @param {string} [params.cameraDetails]
 *   Technical photography tail — camera, lens, grain, grade
 * @param {string[]} [params.referenceImagesInfo]
 *   Optional extra context about additional reference images
 * @param {string} [params.styleReference]
 *   Optional extra style notes appended to the tail
 * @param {'selfie'|'portrait'|'fullbody'|'editorial'} [params.shotType]
 *   Preset shot type that auto-fills missing fields with sensible defaults
 * @returns {string} Complete INSTARAW-format prompt string
 *
 * @example
 * // Basic usage
 * const prompt = generateNanaBananaPrompt({
 *   characterDescription: "Young East Asian woman, early 20s, long straight black hair with blunt bangs, fair skin, almond eyes, slim hourglass build",
 *   userInstructions: "rooftop sunset, yellow sundress, relaxed pose",
 *   expression: "smiling softly, eyes slightly squinted in warmth",
 *   shotType: "portrait",
 * });
 */
export function generateNanaBananaPrompt(params) {
  const {
    characterDescription,
    userInstructions,
    expression = "neutral, confident gaze toward camera",
    action = "standing still, slight weight shift to one side",
    backgroundDescription,
    outfitDescription,
    poseDescription,
    lightingDescription,
    cameraDetails,
    referenceImagesInfo = [],
    styleReference = "",
    shotType = "portrait",
  } = params;

  // Resolve defaults per shot type when not explicitly provided
  const defaults = SHOT_TYPE_DEFAULTS[shotType] || SHOT_TYPE_DEFAULTS.portrait;
  const bg = backgroundDescription || defaults.background;
  const outfit = outfitDescription || defaults.outfit;
  const pose = poseDescription || defaults.pose;
  const lighting = lightingDescription || defaults.lighting;
  const camera = cameraDetails || defaults.camera;

  // Inject user instructions into the background when no explicit background provided
  const resolvedBg = backgroundDescription
    ? backgroundDescription
    : userInstructions
      ? `${defaults.background}, ${userInstructions}`
      : defaults.background;

  // Build extra reference context
  const refContext = referenceImagesInfo.length > 0
    ? ` (additional references: ${referenceImagesInfo.join("; ")})`
    : "";

  const parts = [
    // 1. Subject anchor — the INSTARAW identity lock phrase
    `${characterDescription.trim()}, using reference image 1 for ultimate character consistency in face and body anatomy${refContext}.`,

    // 2. Expression + action
    `She is ${expression}, ${action}.`,

    // 3. Reimagined elements
    `reimagined background with ${resolvedBg}.`,
    `She wears a reimagined outfit: ${outfit}.`,
    `Her pose is reimagined as ${pose}.`,
    `Lighting reimagined as ${lighting}.`,

    // 4. Technical tail
    `${camera}${styleReference ? `, ${styleReference}` : ""}.`,
  ];

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Shot-type presets — sensible defaults that produce editorial-grade results
// ---------------------------------------------------------------------------

const SHOT_TYPE_DEFAULTS = {
  /**
   * True first-person selfie. Arm extended, front-facing camera.
   * WHY: Palm-length POV with specific phone-camera optics produces authentic
   *      selfie distortion that reads as genuinely candid to viewers.
   */
  selfie: {
    background: "softly blurred warm interior with bokeh lifestyle atmosphere, ambient golden light from a nearby window, shallow depth of field on the background",
    outfit: "stylish casual contemporary outfit — fitted top in a saturated color, high-waist jeans or skirt, minimal jewelry, natural makeup look",
    pose: "true self-captured arm-extended palm-length first-person selfie POV, front-facing camera angle, slight chin-down for jawline definition, no visible phone or device in hand, no mirror reflection",
    lighting: "diffused soft frontal fill light mimicking a phone flash with natural ambient warmth, color temperature 5500K, soft catchlights in both eyes, gentle luminosity on skin without harsh shadows",
    camera: "Shot on iPhone 15 Pro Max, 12mm ultrawide front camera, authentic selfie lens barrel distortion, warm skin tone bias, subtle digital grain, slight vignette at corners, photorealistic skin pores and fine hair strands",
  },

  /**
   * 3/4 angle close-up portrait. Head and shoulders.
   * WHY: 3/4 angle is universally flattering and gives the model room to
   *      render character without full-body anatomy challenges.
   */
  portrait: {
    background: "clean professional studio backdrop in deep charcoal grey, subtle gradient from dark to slightly lighter behind subject, no distracting elements, shallow depth of field",
    outfit: "elegant form-fitting ensemble — tailored blazer in a rich neutral tone over a soft silk blouse, minimal statement jewelry, hair styled to frame the face",
    pose: "three-quarter angle to camera, chin slightly down and turned left, shoulders relaxed, direct eye-line at lens, natural hand placement off-frame or at collarbone, 3/4 crop framing head to upper chest",
    lighting: "Rembrandt three-point lighting: key light at 45° camera-left, warm 5600K softbox, fill reflector at 30% ratio on camera-right, subtle rim separation light behind at 200°, crisp catchlights in both eyes",
    camera: "Shot on Sony A7R V, 85mm f/1.4 G Master, ISO 400 analog grain, subtle lens vignette, razor-thin depth of field, Kodak Portra 400 color science, hyperrealistic skin texture with individual pores and fine hair detail",
  },

  /**
   * Head-to-toe full body shot. All anatomy visible.
   * WHY: Full body requires explicit clothing from head to toe plus clear
   *      foot/shoe description to prevent the model cutting off at ankles.
   */
  fullbody: {
    background: "bright contemporary urban environment — clean minimal architecture, smooth concrete ground, soft ambient city light, slight environmental bokeh preserving sense of place without competing with subject",
    outfit: "full head-to-toe look — fitted crop top in a complementary color, high-waist tailored trousers or midi skirt, strappy heeled sandals or sleek ankle boots, shoulder bag or clutch, layered delicate necklaces and ear jewelry",
    pose: "full figure visible from crown of head to tips of shoes, natural contrapposto stance — weight on left leg, right hip slightly forward, one hand resting on hip and the other relaxed at side, three-quarter angle, eye-line at camera, confident elegant expression",
    lighting: "clean editorial fashion lighting: overhead large softbox as key, two hair lights for rim separation, ground-level bounce fill, even exposure head to toe with soft gradient, color temperature 5800K, no harsh shadows on floor",
    camera: "Shot on Canon EOS R5, 35mm f/2L, slight film grain ISO 200, faint chromatic aberration at highlights, clean flat fashion-editorial color grade, sharp focus across full body, hyperrealistic fabric texture and skin detail",
  },

  /**
   * High-fashion editorial — moody, cinematic.
   */
  editorial: {
    background: "dramatic cinematic environment with strong environmental storytelling — weathered industrial architecture, period-specific details, heavy atmospheric haze, deep shadow regions contrasting against a single warm practical light source, golden-hour gradient above the horizon",
    outfit: "high-fashion editorial look — avant-garde silhouette with architectural volume, premium textured fabric (leather, silk charmeuse, or technical mesh), fashion-forward accessories, statement footwear, intentional asymmetry in styling",
    pose: "powerful editorial pose — diagonal body line through frame, strong geometric negative space, unexpected hand gesture or body lean, model breaking the 4th wall with intense direct gaze, dynamic implied movement",
    lighting: "dramatic cinematic three-quarter rim-only lighting: single 2700K practical warm source raking across subject from behind at 160°, deep moody shadows front-facing, slight blue ambient fill at 10% ratio for shadow detail, specular highlights on fabric and skin",
    camera: "Shot on Hasselblad X2D 100C, 80mm f/1.9 XCD, pushed Kodak Tri-X 400 grain simulation, heavy lens vignette, teal-orange cinematic LUT, 1.33x anamorphic lens flare characteristic, ultra-sharp fabric texture and skin detail at 100MP resolution",
  },
};

// ---------------------------------------------------------------------------
// Preset builders for model creation pipeline (selfie / portrait / fullbody)
// These produce the base prompt text that then goes through the AI optimizer.
// ---------------------------------------------------------------------------

/**
 * Builds a base selfie prompt for initial AI model creation.
 * Called before passing through `optimizeNanaBananaPrompt`.
 *
 * @param {object} characterTraits - parsed looks object from model profile
 * @param {string} [customDirection] - extra user-provided pose/scene direction
 */
export function buildModelSelfiePrompt(characterTraits = {}, customDirection = "") {
  const desc = buildCharacterDescription(characterTraits);
  return generateNanaBananaPrompt({
    characterDescription: desc || "a person",
    userInstructions: customDirection,
    expression: "natural, relaxed, genuinely confident expression — slight smile, eyes alive with warmth",
    action: "capturing a true first-person selfie at palm length, front-facing camera angle",
    shotType: "selfie",
  });
}

/**
 * Builds a base portrait prompt for initial AI model creation.
 *
 * @param {object} characterTraits - parsed looks object from model profile
 * @param {string} [customDirection]
 */
export function buildModelPortraitPrompt(characterTraits = {}, customDirection = "") {
  const desc = buildCharacterDescription(characterTraits);
  return generateNanaBananaPrompt({
    characterDescription: desc || "a person",
    userInstructions: customDirection,
    expression: "captivating, alluring gaze — subtle confidence, soft parted lips",
    action: "facing slightly left of camera, chin down at a flattering angle",
    shotType: "portrait",
  });
}

/**
 * Builds a base full-body prompt for initial AI model creation.
 *
 * @param {object} characterTraits - parsed looks object from model profile
 * @param {string} [customDirection]
 * @param {string} [outfitOverride] - explicit outfit description from user selection
 */
export function buildModelFullBodyPrompt(characterTraits = {}, customDirection = "", outfitOverride = "") {
  const desc = buildCharacterDescription(characterTraits);
  return generateNanaBananaPrompt({
    characterDescription: desc || "a person",
    userInstructions: customDirection,
    expression: "confident, natural smile with direct eye contact",
    action: "standing in a relaxed contrapposto position, full height visible",
    outfitDescription: outfitOverride || undefined,
    shotType: "fullbody",
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a model's looks object into a concise character description string
 * suitable for the subject anchor section of the INSTARAW prompt.
 *
 * @param {object} traits
 * @param {string} [traits.gender]
 * @param {string} [traits.heritage]
 * @param {string} [traits.age]
 * @param {string} [traits.bodyType]
 * @param {string} [traits.hairColor]
 * @param {string} [traits.hairLength]
 * @param {string} [traits.hairTexture]
 * @param {string} [traits.eyeColor]
 * @param {string} [traits.lipSize]
 * @param {string} [traits.faceType]
 * @param {string} [traits.style]
 * @returns {string}
 */
export function buildCharacterDescription(traits = {}) {
  const {
    gender,
    heritage,
    age,
    bodyType,
    hairColor,
    hairLength,
    hairTexture,
    eyeColor,
    lipSize,
    faceType,
    style,
  } = traits;

  const parts = [
    gender ? `${gender}` : "person",
    age ? `in ${age}` : "",
    heritage ? `of ${heritage} heritage` : "",
    faceType ? `with ${faceType} facial features` : "",
    [hairLength, hairTexture, hairColor].filter(Boolean).join(" ") ? `${[hairLength, hairTexture, hairColor].filter(Boolean).join(" ")} hair` : "",
    eyeColor ? `${eyeColor} eyes` : "",
    lipSize ? `${lipSize} lips` : "",
    bodyType ? `${bodyType} build` : "",
    style ? `${style} aesthetic` : "",
  ].filter(Boolean);

  return parts.join(", ");
}

/**
 * Generates the negative prompt companion — standard exclusion list tuned for
 * NanaBanana Pro. Append to any generation call that accepts a negative prompt.
 *
 * @returns {string}
 */
export function getNanaBananaNegativePrompt() {
  return [
    "unrealistic anatomy",
    "extra limbs",
    "missing limbs",
    "deformed hands",
    "six fingers",
    "blurry face",
    "face morphing",
    "low quality",
    "watermark",
    "text overlay",
    "cartoon",
    "anime",
    "illustration",
    "painting",
    "sketch",
    "CGI render",
    "plastic skin",
    "overexposed",
    "underexposed",
    "low-light noise",
    "JPEG artifacts",
    "oversaturated",
    "overprocessed HDR",
    "AI glitch",
    "asymmetric eyes",
    "double chin exaggeration",
    "distorted background",
    "out-of-focus subject",
  ].join(", ");
}
