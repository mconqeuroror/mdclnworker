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
 * Standardized SYSTEM-prompt section that explains the JSON contract to Grok.
 * Both NSFW and ModelClone-X system prompts append this block so the LLM knows how to
 * read the structured input it will receive in the user message.
 */
export const STRUCTURED_INPUT_CONTRACT = `## STRUCTURED JSON INPUT (READ ALL FIELDS)
The user message is a JSON object describing the request. Top-level keys you may receive:

- "trigger_word"        — LoRA trigger token. If present, output MUST start with this exact token followed by ", ".
- "main_subject"        — LORA-LOCKED IDENTITY. Present ONLY when a model/LoRA is selected. When present, you MUST integrate every non-empty field (gender, age, ethnicity, skin tone, face.shape, face.eyes.color, face.lips.size, hair.color/length/texture/style, body.type/bust_size/waist/hips, distinguishing_features, tattoos, piercings, …) as the subject's identity. NEVER invent identity facts that aren't here.
- "main_subject" ABSENT — No model selected. DO NOT invent or describe identity (no hair color, no eye color, no body type, no ethnicity, no face shape). Describe action/wardrobe/composition only; let the image model freely choose the person's appearance.
- "scene"               — User's scene request + setting / lighting / pose / expression / props.
- "composition"         — Shot framing, camera angle, lens, orientation, depth of field.
- "colors"              — Color palette + atmosphere.
- "style"               — Photo category + visual tone + render style.
- "nsfw_meta"           — NSFW-only flags (mode, explicit, is_partnered, sex_act, …) when applicable.

INTEGRATION RULES:
1. Render the JSON into ONE flowing natural-language paragraph (no JSON, no bullets, no labels).
2. EVERY non-empty leaf value in main_subject must be reflected in the prose when present.
3. NEVER pull identity from "scene" or "composition" — only from main_subject.
4. The user's "scene.user_request" is the source of truth for the action/setting; preserve all of its concrete details verbatim.
5. NEVER include the literal field labels ("hair.color:", "main_subject", "scene") in the output.
6. If main_subject is missing, the subject becomes "a person" / generic noun fitting the scene; do not describe their face, hair, eyes, body type, or ethnicity at all.`;

export default buildStructuredPromptInput;
