/**
 * ModelClone-X image → scene JSON (Grok vision via OpenRouter)
 *
 * Same downstream path as a typed text prompt: the returned string is passed to
 * optimizeModelCloneXPrompt(). Uses the same OpenRouter stack as NSFW /img2img/describe
 * (avoids Google moderation flags on some reference images).
 *
 * Env: OPENROUTER_API_KEY, optional MCX_SCENE_GROK_MODEL (defaults to GROK_VISION_MODEL or x-ai/grok-4.1-fast).
 */

const MCX_SCENE_GROK_MODEL = String(
  process.env.MCX_SCENE_GROK_MODEL || process.env.GROK_VISION_MODEL || "x-ai/grok-4.1-fast",
).trim();

const MCX_JSON_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.MCX_SCENE_GROK_TIMEOUT_MS) || Number(process.env.GROK_DESCRIBE_TIMEOUT_MS) || 90_000,
);

const MCX_JSON_SYSTEM = `You are a vision-to-JSON assistant for a SFW photoreal portrait/lifestyle pipeline.
The user will send an image and rules. You must output only one JSON object — no markdown code fences, no preamble, no text after the closing brace.`;

/** Example output shape (values in real runs must match the image, not this sample). */
const EXAMPLE_JSON_SHAPE = `{
  "main_subject": {
    "type": "person",
    "gender_presentation": "female",
    "age_appearance": "young adult",
    "skin_tone": "light",
    "skin_texture": "natural with visible pores",
    "face": {
      "shape": "oval",
      "features": "soft and symmetrical",
      "lips": { "size": "medium", "shape": "natural curved" },
      "eyes": { "color": "brown", "shape": "almond", "size": "medium" },
      "eyebrows": "natural, straight with a slight arch",
      "nose": "straight",
      "jawline": "soft"
    },
    "hair": {
      "color": "black",
      "length": "long",
      "texture": "straight",
      "style": "loose",
      "parting": "center"
    },
    "body": {
      "type": "curvy",
      "height_perception": "average",
      "bust_size": "full",
      "waist": "narrow",
      "hips": "natural",
      "legs": "not fully visible",
      "posture": "upright"
    },
    "distinguishing_features": ["no visible tattoos"],
    "expression": "neutral, slight smile",
    "gaze_direction": "toward camera",
    "pose": "selfie-style pose with one arm raised slightly",
    "accessories": [],
    "nails": { "color": "neutral", "finish": "natural", "length": "short" },
    "clothing": {
      "top": "yellow tank top",
      "bottom": "not fully visible",
      "footwear": "not visible",
      "outfit_style": "casual"
    }
  },
  "scene": {
    "setting": "bedroom or personal gaming room",
    "architecture": "modern interior",
    "environment_details": ["gaming PC with RGB lighting", "gaming chair", "decorative wall art", "large window with natural light", "bed partially visible"],
    "weather": "not applicable (indoor)",
    "time_of_day": "daytime",
    "lighting": "mix of natural window light and LED lighting",
    "color_mood": "warm and cool contrast"
  },
  "composition": {
    "framing": "close-up portrait",
    "camera_angle": "slightly elevated",
    "camera_lens": "wide-angle (selfie perspective)",
    "orientation": "vertical",
    "focus": "subject sharp, background slightly blurred",
    "depth_of_field": "moderate"
  },
  "colors": {
    "dominant_palette": ["yellow", "black", "blue", "purple", "white"],
    "atmosphere": "warm foreground with cool tech-lit background"
  },
  "style": {
    "photo_category": "self-portrait / lifestyle",
    "visual_tone": "natural and casual",
    "render_style": "photorealistic"
  }
}`;

/**
 * @param {string} text
 * @returns {string} Pretty-printed JSON or trimmed text
 */
function extractJsonObjectString(text) {
  const t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = fence ? fence[1].trim() : t;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return inner;
  }
  const slice = inner.slice(start, end + 1);
  try {
    return JSON.stringify(JSON.parse(slice), null, 2);
  } catch {
    return slice;
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.imageUrl]
 * @param {string} [opts.imageBase64]
 * @param {string} [opts.loraIdentityHint]
 * @returns {Promise<string>} Scene as pretty-printed JSON (ModelClone-X “user prompt”)
 */
export async function getMcxSceneJsonFromImageGrok({ imageUrl = "", imageBase64 = "", loraIdentityHint = "" }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured — ModelClone-X image-to-image needs Grok (OpenRouter) for scene JSON.");
  }

  let imageBlockUrl;
  if (String(imageBase64).trim()) {
    const cleaned = String(imageBase64).trim().replace(/^data:[^,]+,/, "");
    const buf = Buffer.from(cleaned, "base64");
    const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50;
    const mime = isPng ? "image/png" : "image/jpeg";
    imageBlockUrl = `data:${mime};base64,${cleaned}`;
  } else if (imageUrl && /^https?:\/\//i.test(String(imageUrl).trim())) {
    imageBlockUrl = String(imageUrl).trim();
  } else {
    throw new Error("getMcxSceneJsonFromImageGrok: provide imageBase64 or an https imageUrl.");
  }

  const identityBlock = String(loraIdentityHint || "").trim()
    ? `LoRA / character target (align main_subject with this identity; the photo may show a different person before swap — describe visible pixels faithfully, and let downstream replace identity):\n${String(loraIdentityHint).trim()}\n\n`
    : "";

  const userText = `give me the json version of every media i send. Do not include captions in the media or any watermarks. Make sure the character is described as in the lora. No tattoos.

${identityBlock}Use this key structure and depth (example values are illustrative only — you must fill from the actual image you see):

${EXAMPLE_JSON_SHAPE}

Output rules:
- Return ONE JSON object only. No markdown code fences, no explanation text before or after.
- SFW only; no explicit sexual content.
- Ignore on-image text, logos, watermarks, and UI overlays when describing the scene; do not transcribe them into text fields.`;

  const requestBody = {
    model: MCX_SCENE_GROK_MODEL,
    messages: [
      { role: "system", content: MCX_JSON_SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBlockUrl } },
          { type: "text", text: userText },
        ],
      },
    ],
    max_tokens: 8192,
    temperature: 0.25,
  };

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(MCX_JSON_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const hint =
      resp.status === 401 || resp.status === 403
        ? " Check OPENROUTER_API_KEY on the server."
        : resp.status === 413
          ? " Image payload too large for the model — use a smaller photo (the app will try to resize automatically)."
          : "";
    throw new Error(`Grok / OpenRouter vision failed (HTTP ${resp.status}): ${errText.slice(0, 400)}${hint}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  const out = (typeof raw === "string" ? raw : "").trim();
  if (!out) {
    throw new Error(`Grok returned no text. Raw: ${JSON.stringify(data).slice(0, 400)}`);
  }

  const jsonStr = extractJsonObjectString(out);
  if (jsonStr.length < 20) {
    throw new Error("Grok output was too short to be a valid scene JSON.");
  }
  console.log(`[MCX/Grok] scene JSON for optimizer (${jsonStr.length} chars, model=${MCX_SCENE_GROK_MODEL})`);
  return jsonStr;
}

export default { getMcxSceneJsonFromImageGrok };
