/**
 * Sexting Scripts — NSFW photo-sequence blueprints.
 *
 * A "script" is a reusable sequence of N scene descriptions. Each scene is
 * AI-expanded into a prompt template that contains three placeholders:
 *   {{TRIGGER}}      → the selected model's LoRA trigger word
 *   {{OUTFIT}}       → uniform outfit, (re)generated per run
 *   {{ENVIRONMENT}}  → uniform setting,  (re)generated per run
 *
 * Running a script:
 *   1. We resolve the chosen model + its active LoRA.
 *   2. Grok picks a fresh outfit + environment for the whole run.
 *   3. Placeholders are filled in; N generations are created and dispatched
 *      through the exact same `submitNsfwGeneration` pipeline regular NSFW
 *      generations use, so images flow back through the standard callback /
 *      live-preview machinery.
 *
 * Credits are charged at the script's `picCount * creditsPerPic` rate, up
 * front, with the same refund behaviour as regular NSFW gen on failure.
 */

import prisma from "../lib/prisma.js";
import {
  deductCredits,
  checkAndExpireCredits,
  getTotalCredits,
  refundCredits,
  refundGeneration,
} from "../services/credit.service.js";
import { submitNsfwGeneration } from "../services/fal.service.js";
import { resolveRunpodWebhookUrl } from "../lib/runpodWebhookUrl.js";
import { resolveNsfwResolution } from "../utils/nsfwResolution.js";

/* ─────────────────────────────────────────────────────────────────────── */
/*  Pricing tiers                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

/** Allowed pic-count → credits-per-pic mapping. Keep in sync with the
 *  frontend picker. */
export const TIER_PRICING = {
  5:  20,
  10: 15,
  15: 13,
};

export function isValidTier(picCount) {
  return Object.prototype.hasOwnProperty.call(TIER_PRICING, picCount);
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Grok helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "x-ai/grok-4.1-fast";

async function callGrokJSON({ systemPrompt, userPrompt, maxTokens = 1200, timeoutMs = 45_000 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("AI service not configured");

  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error("[sexting-scripts] Grok error:", errText);
    throw new Error("AI generation failed");
  }
  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content || "";

  // Strip any code fences just in case Grok decides to be creative.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[sexting-scripts] JSON parse failure:", err?.message, "raw:", raw.slice(0, 500));
    throw new Error("AI returned malformed output");
  }
}

/** System prompt used to expand raw user scene descriptions into reusable
 *  base-prompt templates with explicit placeholders. */
const BASE_PROMPTS_SYSTEM = `You are ModelClone's "Sexting Script" prompt engineer. You turn short user-written scene descriptions into cinematic, photo-realistic NSFW image prompts — preserving every scene's action, pose, framing and emotion — while leaving three variables to be filled at run time:

  {{TRIGGER}}      — the model's unique identity/trigger word (always cite this up front as the subject)
  {{OUTFIT}}       — what she is wearing (must remain IDENTICAL across every pic in this script run)
  {{ENVIRONMENT}}  — the setting/location (must remain IDENTICAL across every pic in this script run)

Rules:
  1. Every prompt MUST mention {{TRIGGER}} as the main subject and include {{OUTFIT}} and {{ENVIRONMENT}} placeholders exactly once each, verbatim with the double curly braces.
  2. Keep each prompt 1–3 sentences, plain English, no JSON, no bullet lists.
  3. Describe ONLY camera framing, pose, body language, facial expression, lighting mood, and the specific action of the scene. DO NOT describe the outfit itself, DO NOT describe the environment itself — leave them as the placeholders.
  4. Scenes are meant to progress naturally. Maintain continuity of expression, energy, and posture between scenes.
  5. Explicit adult content is allowed and expected — write it confidently when the scene calls for it, but never describe minors, non-consent, or violence.
  6. Return strict JSON: { "basePrompts": ["<prompt 1>", "<prompt 2>", ...] } with exactly as many entries as scenes given, in order.`;

/** System prompt for picking a single fresh outfit + environment for a run. */
const RUN_LOOK_SYSTEM = `You pick a single outfit and a single environment for a ModelClone NSFW sexting-script run.
Rules:
  - Return strict JSON: { "outfit": "<one short sentence>", "environment": "<one short sentence>" }.
  - Outfit and environment each a single tight sentence, 4–14 words, visual and specific.
  - They must match the script's theme / vibe, and must be CONSISTENT with the scenes (e.g. if scenes are set on a bed, pick a bedroom-like environment; if scenes involve bra removal, pick an outfit that has a bra).
  - Vary from prior runs — be creative but realistic.
  - No brand names, no minors, no disallowed content.`;

async function generateBasePromptsFromScenes(sceneDescriptions) {
  const list = sceneDescriptions.map((s, i) => `${i + 1}. ${s.trim()}`).join("\n");
  const userPrompt = `Expand the following ${sceneDescriptions.length} scene descriptions into ${sceneDescriptions.length} reusable base-prompt templates, following all rules above.\n\nScenes:\n${list}`;
  const out = await callGrokJSON({ systemPrompt: BASE_PROMPTS_SYSTEM, userPrompt, maxTokens: 1800 });
  const arr = Array.isArray(out?.basePrompts) ? out.basePrompts : null;
  if (!arr || arr.length !== sceneDescriptions.length) {
    throw new Error(`AI returned ${arr?.length ?? "no"} prompts; expected ${sceneDescriptions.length}`);
  }
  return arr.map((p) => String(p || "").trim()).filter(Boolean);
}

async function generateSingleBasePrompt(sceneDescription, siblingPrompts = []) {
  const sibContext = siblingPrompts.length
    ? `\nFor continuity, here are the other prompts already in the script (DO NOT copy their action, pose, or framing — just match tone):\n${siblingPrompts.slice(0, 8).map((p, i) => `  (${i + 1}) ${p}`).join("\n")}`
    : "";
  const userPrompt = `Expand the following ONE scene description into a single base-prompt template, following all rules.${sibContext}\n\nScene: ${sceneDescription.trim()}\n\nReturn JSON: { "basePrompts": ["<your single prompt>"] }`;
  const out = await callGrokJSON({ systemPrompt: BASE_PROMPTS_SYSTEM, userPrompt, maxTokens: 500 });
  const p = Array.isArray(out?.basePrompts) ? out.basePrompts[0] : null;
  if (!p) throw new Error("AI returned no prompt");
  return String(p).trim();
}

async function generateRunLook({ scriptName, themeHint, sceneDescriptions }) {
  const theme = themeHint ? `Theme: ${themeHint}\n` : "";
  const sceneList = (sceneDescriptions || []).slice(0, 20).map((s, i) => `${i + 1}. ${s}`).join("\n");
  const userPrompt = `Script name: ${scriptName}\n${theme}Scenes:\n${sceneList}\n\nPick a single outfit and environment for this run (JSON as specified).`;
  const out = await callGrokJSON({ systemPrompt: RUN_LOOK_SYSTEM, userPrompt, maxTokens: 180, timeoutMs: 20_000 });
  const outfit      = String(out?.outfit      || "").trim();
  const environment = String(out?.environment || "").trim();
  if (!outfit || !environment) throw new Error("AI did not return outfit/environment");
  return { outfit, environment };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Validators / serializers                                                */
/* ─────────────────────────────────────────────────────────────────────── */

function serializeScript(script) {
  return {
    id: script.id,
    slug: script.slug,
    name: script.name,
    description: script.description,
    isBuiltIn: script.isBuiltIn,
    isOwner: script.userId !== null && script.userId !== undefined,
    picCount: script.picCount,
    creditsPerPic: script.creditsPerPic,
    creditsTotal: script.picCount * script.creditsPerPic,
    sceneDescriptions: script.sceneDescriptions || [],
    basePrompts: script.basePrompts || [],
    themeHint: script.themeHint,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  };
}

function validateTier(picCount, creditsPerPic) {
  if (!isValidTier(picCount)) {
    return `Invalid pic count ${picCount}. Allowed: ${Object.keys(TIER_PRICING).join(", ")}.`;
  }
  const expected = TIER_PRICING[picCount];
  if (creditsPerPic !== expected) {
    return `Wrong credits-per-pic for ${picCount} pics. Expected ${expected}, got ${creditsPerPic}.`;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  CRUD                                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

/** GET /api/nsfw/sexting-scripts — list built-ins + user's saved scripts. */
export async function listSextingScripts(req, res) {
  try {
    const userId = req.user.userId;
    const scripts = await prisma.sextingScript.findMany({
      where: {
        OR: [
          { isBuiltIn: true },
          { userId },
        ],
      },
      orderBy: [
        { isBuiltIn: "desc" },
        { createdAt: "desc" },
      ],
    });
    const serialized = scripts.map((s) => ({
      ...serializeScript(s),
      isOwner: s.userId === userId,
    }));
    return res.json({ success: true, scripts: serialized });
  } catch (err) {
    console.error("[sexting-scripts] list error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** GET /api/nsfw/sexting-scripts/:id */
export async function getSextingScript(req, res) {
  try {
    const userId = req.user.userId;
    const script = await prisma.sextingScript.findUnique({ where: { id: req.params.id } });
    if (!script) return res.status(404).json({ success: false, message: "Script not found" });
    if (!script.isBuiltIn && script.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    return res.json({
      success: true,
      script: { ...serializeScript(script), isOwner: script.userId === userId },
    });
  } catch (err) {
    console.error("[sexting-scripts] get error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/nsfw/sexting-scripts/generate-base-prompts
 * Body: { sceneDescriptions: string[] }
 * Returns: { basePrompts: string[] }
 *
 * Does NOT persist — it's a helper the editor calls before the user hits "Save".
 */
export async function generateScriptBasePrompts(req, res) {
  try {
    const scenes = Array.isArray(req.body?.sceneDescriptions) ? req.body.sceneDescriptions : [];
    const clean = scenes.map((s) => String(s || "").trim()).filter(Boolean);
    if (clean.length === 0) {
      return res.status(400).json({ success: false, message: "Provide at least one scene description" });
    }
    if (clean.length > 20) {
      return res.status(400).json({ success: false, message: "Too many scenes" });
    }
    const basePrompts = await generateBasePromptsFromScenes(clean);
    return res.json({ success: true, basePrompts });
  } catch (err) {
    console.error("[sexting-scripts] generate-base-prompts error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** POST /api/nsfw/sexting-scripts  — create a user-owned script. */
export async function createSextingScript(req, res) {
  try {
    const userId = req.user.userId;
    const {
      name,
      description = "",
      themeHint = "",
      picCount,
      sceneDescriptions,
      basePrompts,
    } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ success: false, message: "Script name is required" });
    }
    const count = Number(picCount);
    if (!isValidTier(count)) {
      return res.status(400).json({ success: false, message: "Invalid pic count" });
    }
    const scenes = Array.isArray(sceneDescriptions)
      ? sceneDescriptions.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    if (scenes.length !== count) {
      return res.status(400).json({
        success: false,
        message: `Provide exactly ${count} scene descriptions`,
      });
    }
    const prompts = Array.isArray(basePrompts)
      ? basePrompts.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    if (prompts.length !== count) {
      return res.status(400).json({
        success: false,
        message: `Provide exactly ${count} base prompts`,
      });
    }

    const creditsPerPic = TIER_PRICING[count];

    const script = await prisma.sextingScript.create({
      data: {
        userId,
        name: name.trim().slice(0, 120),
        description: description ? String(description).slice(0, 500) : null,
        themeHint: themeHint ? String(themeHint).slice(0, 200) : null,
        picCount: count,
        creditsPerPic,
        sceneDescriptions: scenes,
        basePrompts: prompts,
        isBuiltIn: false,
        isPublic: false,
      },
    });
    return res.json({
      success: true,
      script: { ...serializeScript(script), isOwner: true },
    });
  } catch (err) {
    console.error("[sexting-scripts] create error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** PATCH /api/nsfw/sexting-scripts/:id  — edit a user-owned script. */
export async function updateSextingScript(req, res) {
  try {
    const userId = req.user.userId;
    const existing = await prisma.sextingScript.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: "Script not found" });
    if (existing.isBuiltIn || existing.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const data = {};
    if (typeof req.body?.name === "string") data.name = req.body.name.trim().slice(0, 120);
    if (typeof req.body?.description === "string") data.description = req.body.description.slice(0, 500);
    if (typeof req.body?.themeHint === "string") data.themeHint = req.body.themeHint.slice(0, 200);
    if (Array.isArray(req.body?.sceneDescriptions)) {
      data.sceneDescriptions = req.body.sceneDescriptions.map((s) => String(s || "").trim());
    }
    if (Array.isArray(req.body?.basePrompts)) {
      data.basePrompts = req.body.basePrompts.map((s) => String(s || "").trim());
    }
    // If the user edited pic counts we enforce the tier mapping.
    if (req.body?.picCount !== undefined) {
      const count = Number(req.body.picCount);
      const err = validateTier(count, TIER_PRICING[count] || 0);
      if (err) return res.status(400).json({ success: false, message: err });
      data.picCount = count;
      data.creditsPerPic = TIER_PRICING[count];
    }

    const updated = await prisma.sextingScript.update({
      where: { id: existing.id },
      data,
    });
    return res.json({
      success: true,
      script: { ...serializeScript(updated), isOwner: true },
    });
  } catch (err) {
    console.error("[sexting-scripts] update error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/nsfw/sexting-scripts/:id/regenerate-pic-prompt
 * Body: { picIndex: number }
 * Returns: { basePrompt: string }
 *
 * Re-generates a single pic's base prompt from its scene description, e.g.
 * when the user didn't like the expansion for just that one frame.
 */
export async function regenerateScriptPicPrompt(req, res) {
  try {
    const userId = req.user.userId;
    const { picIndex } = req.body || {};
    const script = await prisma.sextingScript.findUnique({ where: { id: req.params.id } });
    if (!script) return res.status(404).json({ success: false, message: "Script not found" });
    if (!script.isBuiltIn && script.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const idx = Number.parseInt(picIndex, 10);
    const scenes = Array.isArray(script.sceneDescriptions) ? script.sceneDescriptions : [];
    const prompts = Array.isArray(script.basePrompts) ? script.basePrompts : [];
    if (Number.isNaN(idx) || idx < 0 || idx >= scenes.length) {
      return res.status(400).json({ success: false, message: "Invalid pic index" });
    }

    const sibling = prompts.filter((_, i) => i !== idx);
    const fresh = await generateSingleBasePrompt(scenes[idx], sibling);

    // Only persist for user-owned scripts; built-ins stay untouched (user
    // sees the regenerated prompt in the UI and can save it as a fork).
    if (!script.isBuiltIn && script.userId === userId) {
      const next = [...prompts];
      next[idx] = fresh;
      await prisma.sextingScript.update({
        where: { id: script.id },
        data: { basePrompts: next },
      });
    }

    return res.json({ success: true, basePrompt: fresh, picIndex: idx });
  } catch (err) {
    console.error("[sexting-scripts] regenerate-pic-prompt error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** DELETE /api/nsfw/sexting-scripts/:id — owner-only; built-ins protected. */
export async function deleteSextingScript(req, res) {
  try {
    const userId = req.user.userId;
    const existing = await prisma.sextingScript.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: "Script not found" });
    if (existing.isBuiltIn || existing.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    await prisma.sextingScript.delete({ where: { id: existing.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[sexting-scripts] delete error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Run (the money endpoint)                                               */
/* ─────────────────────────────────────────────────────────────────────── */

function fillPlaceholders(template, { trigger, outfit, environment }) {
  return String(template || "")
    .replaceAll("{{TRIGGER}}", trigger || "")
    .replaceAll("{{OUTFIT}}", outfit || "")
    .replaceAll("{{ENVIRONMENT}}", environment || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * POST /api/nsfw/sexting-scripts/:id/run
 * Body: { modelId: string }
 *
 * Charges `picCount * creditsPerPic`, generates a single uniform outfit +
 * environment for this run, fans out N generations, returns run + generation
 * ids so the client can poll each image via the standard /generations/:id.
 */
export async function runSextingScript(req, res) {
  let userId = null;
  let creditsDeducted = 0;
  const generationIds = [];

  try {
    userId = req.user.userId;
    const scriptId = req.params.id;
    const { modelId } = req.body || {};

    if (!modelId) {
      return res.status(400).json({ success: false, message: "modelId is required" });
    }

    // 1. Load script (built-in or owned).
    const script = await prisma.sextingScript.findUnique({ where: { id: scriptId } });
    if (!script) return res.status(404).json({ success: false, message: "Script not found" });
    if (!script.isBuiltIn && script.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const scenes  = Array.isArray(script.sceneDescriptions) ? script.sceneDescriptions : [];
    const prompts = Array.isArray(script.basePrompts) ? script.basePrompts : [];
    if (prompts.length !== script.picCount) {
      return res.status(400).json({
        success: false,
        message: "Script is incomplete — missing base prompts. Open the editor and (re)generate them.",
      });
    }

    // 2. Resolve model + LoRA (same pattern as generateNsfwImage).
    const model = await prisma.savedModel.findUnique({ where: { id: modelId } });
    if (!model) return res.status(404).json({ success: false, message: "Model not found" });
    if (model.userId !== userId) return res.status(403).json({ success: false, message: "Not authorized for this model" });
    if (!model.isAIGenerated && !model.nsfwOverride) {
      return res.status(403).json({ success: false, message: "NSFW generation is only available for AI-generated models." });
    }
    if (!model.nsfwUnlocked) {
      return res.status(403).json({ success: false, message: "Train a LoRA first to unlock NSFW generation." });
    }
    let loraUrl = model.loraUrl;
    let triggerWord = model.loraTriggerWord;
    if (model.activeLoraId) {
      const activeLora = await prisma.trainedLora.findUnique({ where: { id: model.activeLoraId } });
      if (activeLora && activeLora.status === "ready") {
        loraUrl = activeLora.loraUrl;
        triggerWord = activeLora.triggerWord;
      }
    }
    if (!loraUrl || !triggerWord) {
      return res.status(400).json({ success: false, message: "LoRA not properly configured for this model." });
    }

    // 3. Credits.
    const creditsNeeded = script.picCount * script.creditsPerPic;
    const user = await checkAndExpireCredits(userId);
    if (getTotalCredits(user) < creditsNeeded) {
      return res.status(403).json({
        success: false,
        message: `Need ${creditsNeeded} credits (${script.picCount} pics × ${script.creditsPerPic}). You have ${getTotalCredits(user)}.`,
      });
    }
    await deductCredits(userId, creditsNeeded);
    creditsDeducted = creditsNeeded;

    // 4. Pick outfit + environment for the whole run.
    let look;
    try {
      look = await generateRunLook({
        scriptName: script.name,
        themeHint: script.themeHint,
        sceneDescriptions: scenes,
      });
    } catch (err) {
      await refundCredits(userId, creditsDeducted);
      return res.status(502).json({ success: false, message: `Could not generate run look: ${err.message}` });
    }

    // 5. Pre-create the run row (so generations can reference it).
    const run = await prisma.sextingScriptRun.create({
      data: {
        scriptId: script.id,
        userId,
        modelId: model.id,
        outfit: look.outfit,
        environment: look.environment,
        status: "running",
        creditsSpent: creditsDeducted,
      },
    });

    // 6. Fan out N generations. Sequential to keep things simple + rate-safe;
    //    the RunPod pipeline itself handles concurrency downstream.
    const resSpec = resolveNsfwResolution("1024x1024");
    const postProcessing = {
      blur:  { enabled: true, strength: 0.3  },
      grain: { enabled: true, strength: 0.06 },
    };

    for (let i = 0; i < script.picCount; i++) {
      const finalPrompt = fillPlaceholders(prompts[i], {
        trigger: triggerWord,
        outfit: look.outfit,
        environment: look.environment,
      });

      const generation = await prisma.generation.create({
        data: {
          userId,
          modelId: model.id,
          type: "nsfw",
          prompt: finalPrompt,
          status: "processing",
          creditsCost: script.creditsPerPic,
          replicateModel: "comfyui-nsfw",
          isNsfw: true,
          pipelinePayload: {
            source: "sexting-script",
            scriptId: script.id,
            runId: run.id,
            picIndex: i,
          },
        },
      });
      generationIds.push(generation.id);

      // Resolve the RunPod callback URL with this generation's id embedded in
      // the query string — RunPod will hit `/api/runpod/callback?generationId=...&kind=nsfw`
      // when the job finishes, and the callback handler uses that query param
      // to find the right Generation row and mark it completed. Exact same
      // mechanism as regular `/nsfw/generate`; the poller is a safety net.
      const webhookUrl = resolveRunpodWebhookUrl({ generationId: generation.id, kind: "nsfw" });
      console.log(
        `[sexting-scripts] run=${run.id} pic=${i + 1}/${script.picCount} ` +
        `genId=${generation.id} webhook=${webhookUrl ? webhookUrl.slice(0, 80) + "…" : "(MISSING)"} ` +
        `loraStrength=default mode=full(quickFlow=false)`,
      );
      if (!webhookUrl) {
        console.warn(
          "[sexting-scripts] RunPod webhook URL could not be resolved — set CALLBACK_BASE_URL " +
          "or RUNPOD_WEBHOOK_URL in env. Falling back to the 30-minute poller.",
        );
      }

      try {
        const submission = await submitNsfwGeneration(
          {
            loraUrl,
            triggerWord,
            userPrompt: finalPrompt,
            attributes: "",
            sceneDescription: scenes[i] || finalPrompt,
            chipSelections: {},
            options: {
              quickFlow: false,        // Full-quality flow (Z-Image Turbo + Refiner), same as main NSFW gen
              loraStrength: null,      // Default 0.65 identity strength
              postProcessing,          // Blur + grain defaults
              resolution: resSpec.presetId,
            },
          },
          webhookUrl,
          generation.id,
        );

        // Fail-fast: `submitNsfwGeneration` can RETURN { success: false }
        // rather than throw (missing RUNPOD_API_KEY / RUNPOD_BASE_URL, empty
        // prompt, etc.). Without this check, the generation sits in
        // "processing" forever because no job was ever submitted.
        if (!submission || submission.success === false || !submission.requestId) {
          const reason = submission?.error || "RunPod submission returned no job id";
          console.error(`[sexting-scripts] submit returned failure for ${generation.id}: ${reason}`);
          await prisma.generation.update({
            where: { id: generation.id },
            data: {
              status: "failed",
              errorMessage: reason,
              completedAt: new Date(),
            },
          });
          try { await refundGeneration(generation.id); } catch { /**/ }
          continue;
        }

        console.log(`[sexting-scripts] submitted genId=${generation.id} runpodJobId=${submission.requestId}`);
        await prisma.generation.update({
          where: { id: generation.id },
          data: {
            providerTaskId: submission.requestId,
            inputImageUrl: JSON.stringify({
              runpodJobId: submission.requestId,
              provider: "runpod-nsfw",
            }),
          },
        });
      } catch (submitErr) {
        console.error(`[sexting-scripts] submit threw for ${generation.id}:`, submitErr);
        await prisma.generation.update({
          where: { id: generation.id },
          data: {
            status: "failed",
            errorMessage: submitErr.message,
            completedAt: new Date(),
          },
        });
        try { await refundGeneration(generation.id); } catch { /**/ }
      }
    }

    await prisma.sextingScriptRun.update({
      where: { id: run.id },
      data: { generationIds },
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: userId } });
    return res.json({
      success: true,
      run: {
        id: run.id,
        scriptId: script.id,
        modelId: model.id,
        outfit: run.outfit,
        environment: run.environment,
        status: run.status,
        creditsSpent: run.creditsSpent,
        generationIds,
      },
      creditsUsed: creditsDeducted,
      creditsRemaining: getTotalCredits(updatedUser),
    });
  } catch (err) {
    console.error("[sexting-scripts] run error:", err);
    // Refund any generations we already created + any leftover credits.
    for (const gId of generationIds) {
      try {
        await prisma.generation.update({
          where: { id: gId },
          data: { status: "failed", errorMessage: err.message, completedAt: new Date() },
        });
      } catch { /**/ }
      try { await refundGeneration(gId); } catch { /**/ }
    }
    if (creditsDeducted > 0 && userId) {
      try { await refundCredits(userId, creditsDeducted); } catch { /**/ }
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** GET /api/nsfw/sexting-scripts/runs/:runId — owner-only. */
export async function getSextingScriptRun(req, res) {
  try {
    const userId = req.user.userId;
    const run = await prisma.sextingScriptRun.findUnique({
      where: { id: req.params.runId },
      include: { script: true },
    });
    if (!run) return res.status(404).json({ success: false, message: "Run not found" });
    if (run.userId !== userId) return res.status(403).json({ success: false, message: "Not authorized" });

    const gIds = Array.isArray(run.generationIds) ? run.generationIds : [];
    const gens = gIds.length
      ? await prisma.generation.findMany({ where: { id: { in: gIds } } })
      : [];
    // Sort by pic index if embedded in pipelinePayload.
    gens.sort((a, b) => {
      const ai = a?.pipelinePayload?.picIndex ?? 0;
      const bi = b?.pipelinePayload?.picIndex ?? 0;
      return ai - bi;
    });

    return res.json({
      success: true,
      run: {
        id: run.id,
        scriptId: run.scriptId,
        scriptName: run.script?.name,
        modelId: run.modelId,
        outfit: run.outfit,
        environment: run.environment,
        status: run.status,
        creditsSpent: run.creditsSpent,
        errorMessage: run.errorMessage,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        generations: gens.map((g) => ({
          id: g.id,
          status: g.status,
          prompt: g.prompt,
          outputUrl: g.outputUrl,
          errorMessage: g.errorMessage,
          createdAt: g.createdAt,
          completedAt: g.completedAt,
          picIndex: g.pipelinePayload?.picIndex ?? null,
        })),
      },
    });
  } catch (err) {
    console.error("[sexting-scripts] get run error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** GET /api/nsfw/sexting-scripts/runs  — list user's recent runs. */
export async function listSextingScriptRuns(req, res) {
  try {
    const userId = req.user.userId;
    const runs = await prisma.sextingScriptRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { script: { select: { name: true, picCount: true } } },
    });
    return res.json({
      success: true,
      runs: runs.map((r) => ({
        id: r.id,
        scriptId: r.scriptId,
        scriptName: r.script?.name || "",
        picCount: r.script?.picCount || (Array.isArray(r.generationIds) ? r.generationIds.length : 0),
        modelId: r.modelId,
        outfit: r.outfit,
        environment: r.environment,
        status: r.status,
        creditsSpent: r.creditsSpent,
        createdAt: r.createdAt,
        generationIds: r.generationIds,
      })),
    });
  } catch (err) {
    console.error("[sexting-scripts] list runs error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
