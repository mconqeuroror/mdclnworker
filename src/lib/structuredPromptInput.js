/**
 * Structured prompt input builder.
 *
 * Both NSFW and ModelClone-X (SFW) prompt generators feed their LLM (Grok via OpenRouter)
 * the SAME canonical JSON payload describing the request. The LLM then renders that JSON
 * into a natural-language prompt for Z-Image Turbo (or the matching downstream model).
 *
 * When a LoRA model is selected → `main_subject` is FILLED with every identity-lock field
 * available from saved appearance / LoRA defaults / legacy aiGenerationParams (face shape,
 * eye color, hair color/length/texture, body type, ethnicity, distinguishing features, …).
 *
 * When NO model is selected → `main_subject` is OMITTED entirely. The JSON only describes
 * the scene / composition / colors / style so the model isn't anchored to any identity.
 *
 * The downstream LLM ALWAYS receives prose-friendly JSON (not a tag list) so it can produce
 * coherent, grounded image-model prompts without inventing identity facts.
 */

function safeStr(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function safeJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function pickFirst(...values) {
  for (const value of values) {
    const v = safeStr(value);
    if (v) return v;
  }
  return "";
}

function pruneEmpty(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    const out = obj
      .map((item) => (typeof item === "object" ? pruneEmpty(item) : item))
      .filter(
        (item) =>
          item != null &&
          item !== "" &&
          !(Array.isArray(item) && item.length === 0) &&
          !(typeof item === "object" && Object.keys(item).length === 0),
      );
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v)) {
      const arr = pruneEmpty(v);
      if (arr.length) out[k] = arr;
      continue;
    }
    if (typeof v === "object") {
      const nested = pruneEmpty(v);
      if (nested && Object.keys(nested).length) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Build the `main_subject` block from a model + lora + legacy aiParams.
 *
 * Returns null when there isn't enough identity to lock — caller should then OMIT the
 * `main_subject` key entirely (e.g. ModelClone-X "no character" mode).
 */
function buildMainSubject({ model, lora, options = {} }) {
  const aiParams = safeJsonObject(model?.aiGenerationParams);
  const modelLooks = safeJsonObject(model?.savedAppearance);
  const loraLooks = safeJsonObject(lora?.defaultAppearance);
  const looks = { ...aiParams, ...modelLooks, ...loraLooks };

  const gender = pickFirst(looks.gender, aiParams.gender);
  const ageNumber = Number.parseInt(
    safeStr(model?.age) || safeStr(looks.age) || safeStr(aiParams.age),
    10,
  );
  const age = Number.isFinite(ageNumber) ? String(ageNumber) : "";

  const hasAnyIdentity = Boolean(
    gender ||
      age ||
      looks.hairColor ||
      looks.hairLength ||
      looks.eyeColor ||
      looks.bodyType ||
      looks.heritage ||
      looks.ethnicity ||
      looks.skinTone ||
      looks.faceShape ||
      looks.faceType ||
      looks.distinguishingFeatures,
  );
  if (!hasAnyIdentity && !options.allowEmptyIdentity) return null;

  const subject = {
    type: "person",
    gender_presentation: gender || undefined,
    age_appearance: age || pickFirst(looks.ageRange, looks.ageGroup) || undefined,
    age_years: age ? Number(age) : undefined,
    ethnicity: pickFirst(looks.ethnicity, looks.heritage),
    heritage: safeStr(looks.heritage),
    skin_tone: safeStr(looks.skinTone),
    skin_texture:
      pickFirst(looks.skinTexture, "natural with visible pores, no acne") || undefined,
    face: {
      shape: pickFirst(looks.faceShape, looks.faceType),
      features: safeStr(looks.faceFeatures),
      lips: {
        size: safeStr(looks.lipSize),
        shape: safeStr(looks.lipShape),
      },
      eyes: {
        color: safeStr(looks.eyeColor),
        shape: safeStr(looks.eyeShape),
      },
      eyebrows: safeStr(looks.eyebrows),
      nose: safeStr(looks.noseShape || looks.nose),
      jawline: safeStr(looks.jawline),
    },
    hair: {
      color: safeStr(looks.hairColor),
      length: safeStr(looks.hairLength),
      texture: safeStr(looks.hairTexture || looks.hairType),
      style: safeStr(looks.hairStyle),
      parting: safeStr(looks.hairParting),
    },
    body: {
      type: safeStr(looks.bodyType),
      height: safeStr(looks.height),
      bust_size: safeStr(looks.breastSize),
      waist: safeStr(looks.waist),
      hips: safeStr(looks.hips),
      butt_size: safeStr(looks.buttSize),
      legs: safeStr(looks.legs),
      posture: safeStr(looks.posture),
    },
    distinguishing_features:
      Array.isArray(looks.distinguishingFeatures)
        ? looks.distinguishingFeatures
        : safeStr(looks.distinguishingFeatures || looks.distinctiveFeatures || looks.uniqueFeatures)
            ? [safeStr(looks.distinguishingFeatures || looks.distinctiveFeatures || looks.uniqueFeatures)]
            : undefined,
    tattoos: safeStr(looks.tattoos),
    piercings: safeStr(looks.piercings),
    style_archetype: safeStr(looks.style),
  };

  return pruneEmpty(subject);
}

function buildScene({ userRequest, context = {} }) {
  const attrs = context?.attributesDetail || {};
  return pruneEmpty({
    user_request: safeStr(userRequest),
    setting: safeStr(attrs.setting || attrs.scene || context.setting),
    environment_details: Array.isArray(attrs.environmentDetails)
      ? attrs.environmentDetails
      : safeStr(attrs.environmentDetails)
        ? [safeStr(attrs.environmentDetails)]
        : undefined,
    props: Array.isArray(attrs.props)
      ? attrs.props
      : safeStr(attrs.props)
        ? [safeStr(attrs.props)]
        : undefined,
    weather: safeStr(attrs.weather),
    time_of_day: safeStr(attrs.timeOfDay),
    lighting: pickFirst(attrs.lighting, attrs.flash, "one coherent light source"),
    color_mood: safeStr(attrs.colorMood),
    pose: pickFirst(context?.pose?.title, attrs.poseStyle, attrs.bodyPose),
    pose_id: safeStr(context?.pose?.id),
    expression: safeStr(attrs.expression),
    gaze: safeStr(attrs.gaze || attrs.gazeDirection),
  });
}

function buildComposition({ context = {} }) {
  const attrs = context?.attributesDetail || {};
  return pruneEmpty({
    framing: safeStr(attrs.framing || attrs.shotType),
    camera_angle: safeStr(attrs.cameraAngle),
    camera_lens: safeStr(attrs.cameraLens),
    orientation: safeStr(attrs.orientation),
    focus: safeStr(attrs.focus),
    depth_of_field: safeStr(attrs.depthOfField),
  });
}

function buildColors({ context = {} }) {
  const attrs = context?.attributesDetail || {};
  return pruneEmpty({
    dominant_palette: Array.isArray(attrs.dominantPalette)
      ? attrs.dominantPalette
      : safeStr(attrs.dominantPalette)
        ? [safeStr(attrs.dominantPalette)]
        : undefined,
    atmosphere: safeStr(attrs.atmosphere || attrs.colorMood),
  });
}

function buildStyle({ context = {} }) {
  const attrs = context?.attributesDetail || {};
  return pruneEmpty({
    photo_category: safeStr(attrs.photoCategory),
    visual_tone: safeStr(attrs.visualTone),
    render_style: safeStr(attrs.renderStyle || "photorealistic"),
  });
}

/**
 * Build NSFW-only metadata that downstream prompts care about (sex act framing rules).
 * Only includes fields when present — never emits empty stubs.
 */
function buildNsfwMeta({ context = {}, options = {} }) {
  const attrs = context?.attributesDetail || {};
  return pruneEmpty({
    mode: safeStr(options.mode),
    explicit: options.explicit === true ? true : undefined,
    is_partnered: typeof options.isPartnered === "boolean" ? options.isPartnered : undefined,
    nudity: safeStr(attrs.nudity),
    sex_act: safeStr(attrs.sexAct || attrs.act),
    pose_intent: safeStr(attrs.poseIntent),
    nails: pruneEmpty({
      color: safeStr(attrs.nailsColor),
      finish: safeStr(attrs.nailsFinish),
    }),
  });
}

/**
 * Main entry point.
 *
 * @param {object} params
 * @param {object|null} params.model         - User's saved model (with savedAppearance, age, gender, …)
 * @param {object|null} params.lora          - Optional LoRA preset with defaultAppearance
 * @param {string}      params.userRequest   - Raw user prompt (scene description)
 * @param {object}      params.context       - Pose / lighting / mood / attributesDetail context
 * @param {object}      params.options
 * @param {boolean}     params.options.withCharacter - Include identity-lock main_subject (LoRA mode)
 * @param {string}      params.options.mode  - "nsfw" | "modelclone-x" | "nudes-pack"
 * @param {string}      params.options.triggerWord - Optional LoRA trigger token
 * @param {boolean}     params.options.explicit - True for NSFW explicit content
 * @param {boolean}     params.options.isPartnered - True if scene involves a sex partner
 *
 * @returns {{ payload: object, json: string, hasMainSubject: boolean }}
 */
export function buildStructuredPromptInput({
  model = null,
  lora = null,
  userRequest = "",
  context = {},
  options = {},
}) {
  const { withCharacter = false, mode = "modelclone-x", triggerWord = "" } = options;

  const main_subject = withCharacter
    ? buildMainSubject({ model, lora, options })
    : null;

  const payload = pruneEmpty({
    request_kind: mode,
    trigger_word: safeStr(triggerWord) || undefined,
    main_subject: main_subject || undefined,
    scene: buildScene({ userRequest, context }),
    composition: buildComposition({ context }),
    colors: buildColors({ context }),
    style: buildStyle({ context }),
    nsfw_meta:
      mode === "nsfw" || mode === "nudes-pack"
        ? buildNsfwMeta({ context, options })
        : undefined,
  });

  return {
    payload,
    json: JSON.stringify(payload, null, 2),
    hasMainSubject: Boolean(main_subject),
  };
}

/**
 * Standardized SYSTEM-prompt section that explains the JSON I/O contract to Grok.
 *
 * Both NSFW and ModelClone-X system prompts include this block so the LLM knows
 * exactly what JSON shape it receives AND must produce as output.
 *
 * IMPORTANT: The OUTPUT of the LLM is the JSON itself (pretty-printed). It is then
 * stringified and fed to the downstream image model (Z-Image Turbo etc.) as the prompt
 * — JSON formatting is preserved verbatim because the diffusion model conditions on
 * the structured tokens, and our UI / logs need it human-readable.
 */
export const STRUCTURED_INPUT_CONTRACT = `## STRUCTURED JSON I/O CONTRACT (READ CAREFULLY — INPUT *AND* OUTPUT ARE JSON)

### INPUT
The user message is a JSON object. Top-level keys you may receive:

- "trigger_word"        — LoRA trigger token. If present, the output's "trigger_word" field MUST be set to this exact token (do NOT inline it inside any other string).
- "main_subject"        — LORA-LOCKED IDENTITY. Present ONLY when a model/LoRA is selected. When present, you MUST keep every non-empty field exactly as given (gender, age, ethnicity, skin tone, face.shape, face.eyes.color, face.lips.size, hair.color/length/texture/style, body.type/bust_size/waist/hips, distinguishing_features, tattoos, piercings, …). NEVER invent identity facts that aren't here.
- "main_subject" ABSENT — No model selected. DO NOT add a "main_subject" field. DO NOT describe identity (no hair color, no eye color, no body type, no ethnicity, no face shape). Only describe action/wardrobe/composition/scene; let the image model freely choose the person's appearance.
- "scene"               — User's scene request + setting / lighting / pose / expression / props.
- "composition"         — Shot framing, camera angle, lens, orientation, depth of field.
- "colors"              — Color palette + atmosphere.
- "style"               — Photo category + visual tone + render style.
- "nsfw_meta"           — NSFW-only flags (mode, explicit, is_partnered, sex_act, …) when applicable.

### OUTPUT
You MUST return a SINGLE JSON object (pretty-printed, 2-space indent) and NOTHING ELSE — no markdown fences, no preamble, no explanation, no code block.

The output object MUST follow EXACTLY this top-level structure (omit a key entirely when not applicable; never emit empty strings or empty objects):

{
  "trigger_word": "<copied verbatim from input.trigger_word, OR omit if input had none>",
  "main_subject": { /* mirror input.main_subject EXACTLY when input had it; OMIT this key entirely when input had no main_subject */ },
  "scene": {
    "setting": "...",
    "environment_details": ["...", "..."],
    "props": ["..."],
    "weather": "...",
    "time_of_day": "...",
    "lighting": "...",
    "color_mood": "...",
    "pose": "concrete description of body position/action — derived from input.scene.user_request and input.scene.pose",
    "expression": "...",
    "gaze": "...",
    "wardrobe": { /* clothing details — describe even when main_subject is omitted, since clothing is scene, not identity */
      "top": "...",
      "bottom": "...",
      "footwear": "...",
      "accessories": ["..."]
    }
  },
  "composition": {
    "framing": "close-up | cowboy | full-body | POV from behind | etc.",
    "camera_angle": "eye-level | low | high | overhead | ...",
    "camera_lens": "35mm f/1.8 | telephoto compression | smartphone POV | ...",
    "orientation": "vertical | horizontal | square",
    "focus": "subject sharp, background soft",
    "depth_of_field": "shallow | moderate | deep"
  },
  "colors": {
    "dominant_palette": ["...", "..."],
    "atmosphere": "..."
  },
  "style": {
    "photo_category": "street fashion | studio portrait | lifestyle | ...",
    "visual_tone": "natural, crisp, modern | dramatic high-contrast | ...",
    "render_style": "photorealistic"
  },
  "nsfw_meta": { /* OMIT entirely when not NSFW. Mirror input.nsfw_meta plus any new act-specific framing notes */ }
}

### INTEGRATION RULES
1. The OUTPUT is JSON, full stop. No prose paragraphs, no preamble, no \`\`\`json fences.
2. Every non-empty field in input.main_subject MUST appear in output.main_subject; do not add identity fields that weren't in the input.
3. Pull all action/scene details from input.scene.user_request and resolve them into the concrete fields above (pose, expression, gaze, wardrobe, lighting, …).
4. NEVER pull identity from "scene" or "composition" — identity only flows through "main_subject".
5. If main_subject is missing, the OUTPUT must also OMIT main_subject. Use a generic subject implied by scene + wardrobe.
6. Keep every string concise and concrete (no mood-poetry, no filler adjectives like "stunning", "breathtaking", "ethereal").
7. Field values should be plain English phrases, not key:value strings — write "almond shaped dark brown eyes", not "eye_color: brown, eye_shape: almond".`;

export default buildStructuredPromptInput;
