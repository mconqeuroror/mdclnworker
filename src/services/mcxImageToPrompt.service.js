import { getPromptTemplateValue } from "./prompt-template-config.service.js";

const MCX_I2P_MODEL = String(
  process.env.MODELCLONE_X_IMG2IMG_PROMPT_MODEL ||
    process.env.MCX_SCENE_GROK_MODEL ||
    process.env.GROK_VISION_MODEL ||
    "x-ai/grok-4.1-fast",
).trim();

const MCX_I2P_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.MODELCLONE_X_IMG2IMG_PROMPT_TIMEOUT_MS) ||
    Number(process.env.MCX_SCENE_GROK_TIMEOUT_MS) ||
    Number(process.env.GROK_DESCRIBE_TIMEOUT_MS) ||
    90_000,
);

export const DEFAULT_MCX_IMG2IMG_SYSTEM_PROMPT = `You are an image-to-prompt converter for the modelclone.app image-to-image pipeline on Z-Image Turbo NSFW (ZiT 6.2, Qwen3 text encoder).

You receive:
1) SOURCE IMAGE (scene/composition/pose/lighting to reproduce)
2) CHARACTER_PROFILE JSON:
   - lora_triggers: array of trigger tokens
   - identity: replacement identity fields (age_appearance, ethnicity, skin_tone, skin_texture, hair, face, body_modifications)
3) ADDITIONAL_INSTRUCTIONS text (optional)

Return exactly ONE final Z-Image prompt string, no JSON, no markdown, no preamble.

Architecture: CFG ~1 — negatives are inert; use affirmative wording only. ~512 token ceiling; keep the fixed English quality line at the very end so it is not truncated.

Language layout (mandatory):
1. lora_triggers first, comma-separated, Latin, unchanged, never repeated later.
2. English identity block from CHARACTER_PROFILE.identity only (locks face vs full-Chinese drift).
3. Simplified Chinese scene body describing the image: shot/framing → pose → wardrobe mechanism → visible anatomy → environment (max 2 concrete anchor objects) → lighting (max 2 plain sentences, no jargon: catchlights, specular highlights, clipped highlights, etc.) → mood/expression → camera technicals.
4. Final line exactly: Photorealistic, sharp focus, natural skin texture.

Core preservation:
- Mirror geometry, overhead axis, partner frame-edge attachment, and gravity cues from the source when relevant — express them in Chinese in the scene body.
- Exactly one motion verb in the whole prompt.
- No Booru/underscored tags; no negation ("no/not/without/free of").
- One size superlative max across body regions; each region described once.
- Target ~80 English words identity + ~140 Chinese words scene; stay under ~512 tokens total.

If source is ambiguous, make minimal photographic guess and continue.
If source is non-photographic, translate to photorealistic equivalents.

Output only the prompt string.`;

function sanitizePromptOutput(text) {
  let out = String(text || "").trim();
  out = out.replace(/^```[\w]*\s*/i, "").replace(/\s*```$/i, "").trim();
  out = out.replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return out;
}

function toVisionImageBlock(imageUrl, imageBase64) {
  if (String(imageBase64 || "").trim()) {
    const cleaned = String(imageBase64).trim().replace(/^data:[^,]+,/, "");
    return `data:image/jpeg;base64,${cleaned}`;
  }
  if (String(imageUrl || "").trim() && /^https?:\/\//i.test(String(imageUrl).trim())) {
    return String(imageUrl).trim();
  }
  throw new Error("MCX image-to-prompt requires inputImageUrl or inputImageBase64");
}

export async function buildMcxImg2ImgPromptFromImage({
  imageUrl = "",
  imageBase64 = "",
  characterProfile = {},
  additionalInstructions = "",
}) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured — ModelClone-X image-to-image prompt conversion is unavailable.",
    );
  }

  const imageBlockUrl = toVisionImageBlock(imageUrl, imageBase64);
  const systemPrompt = (
    await getPromptTemplateValue(
      "modelcloneXImg2ImgSystemPrompt",
      DEFAULT_MCX_IMG2IMG_SYSTEM_PROMPT,
    )
  ).trim() || DEFAULT_MCX_IMG2IMG_SYSTEM_PROMPT;

  const userText = [
    "CHARACTER_PROFILE JSON:",
    JSON.stringify(characterProfile || {}, null, 2),
    "",
    "ADDITIONAL_INSTRUCTIONS:",
    String(additionalInstructions || "").trim() || "(none)",
    "",
    "Generate the final prompt now.",
  ].join("\n");

  const requestBody = {
    model: MCX_I2P_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageBlockUrl } },
          { type: "text", text: userText },
        ],
      },
    ],
    max_tokens: 900,
    temperature: 0.2,
  };

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(MCX_I2P_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`ModelClone-X image-to-prompt failed (${resp.status}): ${errText.slice(0, 500)}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  const prompt = sanitizePromptOutput(raw);
  if (!prompt) {
    throw new Error("ModelClone-X image-to-prompt returned empty prompt text.");
  }
  return prompt;
}

export default {
  buildMcxImg2ImgPromptFromImage,
};
