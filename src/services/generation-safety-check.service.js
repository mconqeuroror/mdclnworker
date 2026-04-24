import {
  DEFAULT_GENERATION_SAFETY_CONFIG,
  getGenerationSafetyConfig,
} from "./generation-safety-config.service.js";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectStringFields(input, out = []) {
  if (typeof input === "string") {
    const v = normalizeText(input);
    if (v) out.push(v);
    return out;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectStringFields(item, out);
    return out;
  }
  if (input && typeof input === "object") {
    for (const v of Object.values(input)) collectStringFields(v, out);
  }
  return out;
}

function buildCombinedPromptText(body) {
  const fields = collectStringFields(body, []);
  return normalizeText(fields.join("\n")).slice(0, 5000);
}

function toRegex(pattern, fallbackPattern) {
  try {
    return new RegExp(String(pattern || fallbackPattern), "i");
  } catch {
    return new RegExp(String(fallbackPattern), "i");
  }
}

function heuristicCheck({ routePath, text, config }) {
  const lower = text.toLowerCase();
  const isSoulX = /\/(modelclone-x|soulx)\/generate$/.test(routePath);
  const sexualTerms = toRegex(
    config.heuristicSexualTermsPattern,
    DEFAULT_GENERATION_SAFETY_CONFIG.heuristicSexualTermsPattern,
  );
  const childTerms = toRegex(
    config.heuristicChildTermsPattern,
    DEFAULT_GENERATION_SAFETY_CONFIG.heuristicChildTermsPattern,
  );
  const explicitSexActs = toRegex(
    config.heuristicExplicitSexActsPattern,
    DEFAULT_GENERATION_SAFETY_CONFIG.heuristicExplicitSexActsPattern,
  );
  const minorAgePattern = toRegex(
    config.heuristicMinorAgePattern,
    DEFAULT_GENERATION_SAFETY_CONFIG.heuristicMinorAgePattern,
  );

  const ageMatch = lower.match(minorAgePattern);
  const age = ageMatch ? Number(ageMatch[1]) : null;

  const childSexual =
    (childTerms.test(lower) && sexualTerms.test(lower)) ||
    (Number.isFinite(age) && age < 18 && sexualTerms.test(lower));

  if (childSexual) {
    return {
      blocked: true,
      code: "safety_child_sexual_content",
      reason: "Generation blocked: sexual content involving minors is strictly prohibited.",
      source: "heuristic",
    };
  }

  if (isSoulX && explicitSexActs.test(lower)) {
    return {
      blocked: true,
      code: "safety_soulx_explicit_nsfw_blocked",
      reason: "ModelClone-X blocks explicit NSFW sex scenes. Mild adult nudity is allowed.",
      source: "heuristic",
    };
  }

  return { blocked: false, code: "ok", reason: "Allowed", source: "heuristic" };
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function aiCheck({ routePath, text, config }) {
  if (!OPENROUTER_API_KEY) return null;

  const isSoulX = /\/(modelclone-x|soulx)\/generate$/.test(routePath);
  const policy = isSoulX
    ? config.aiSoulxPolicy
    : config.aiGeneralPolicy;

  const systemPrompt = [
    config.aiSystemPrompt,
    "Return ONLY valid JSON with this schema:",
    '{"blocked":boolean,"code":"ok|safety_child_sexual_content|safety_soulx_explicit_nsfw_blocked","reason":string,"childSexual":boolean,"explicitSexScene":boolean,"adultMildNudityOnly":boolean}',
    "Rules:",
    "- Mark childSexual=true for any sexualized minor implication, underage age mention, or school-age sexual context.",
    "- explicitSexScene=true for explicit intercourse/sex act requests.",
    "- adultMildNudityOnly=true only when adult and non-explicit mild nudity.",
    `- Policy for this route: ${policy}`,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: String(config.openrouterModel || DEFAULT_GENERATION_SAFETY_CONFIG.openrouterModel),
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Route: ${routePath}\nPrompt:\n${text}` },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    return extractJson(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runGenerationSafetyCheck({ routePath, body }) {
  const config = await getGenerationSafetyConfig();
  const text = buildCombinedPromptText(body);
  if (!text) return { blocked: false, code: "ok", reason: "No text prompt", source: "empty" };

  const heuristic = heuristicCheck({ routePath, text, config });
  if (heuristic.blocked) return heuristic;

  const ai = await aiCheck({ routePath, text, config });
  if (!ai || typeof ai.blocked !== "boolean") return heuristic;

  if (ai.childSexual) {
    return {
      blocked: true,
      code: "safety_child_sexual_content",
      reason: "Generation blocked: sexual content involving minors is strictly prohibited.",
      source: "ai",
    };
  }

  const isSoulX = /\/(modelclone-x|soulx)\/generate$/.test(routePath);
  if (isSoulX && ai.explicitSexScene) {
    return {
      blocked: true,
      code: "safety_soulx_explicit_nsfw_blocked",
      reason: "ModelClone-X blocks explicit NSFW sex scenes. Mild adult nudity is allowed.",
      source: "ai",
    };
  }

  return { blocked: false, code: "ok", reason: "Allowed", source: "ai" };
}
