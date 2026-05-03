/**
 * Built-in Sexting Scripts seed.
 *
 * Runs once per server boot. For every entry below we:
 *   - `upsert` by slug, so built-ins stay in sync with code edits
 *   - never overwrite a user's forked copy (user scripts have
 *     `isBuiltIn=false` and their own ids)
 *
 * Pic counts are one of the supported tiers (5 / 10 / 15) so pricing resolves
 * automatically. Scene descriptions are kept short, visual, and focused on
 * action — Grok expands them into full prompt templates at run time via the
 * {{TRIGGER}} / {{OUTFIT}} / {{ENVIRONMENT}} placeholder system.
 */

import prisma from "../lib/prisma.js";
import { TIER_PRICING } from "../controllers/sexting-scripts.controller.js";

/* ─────────────────────────────────────────────────────────────────────── */
/*  Built-ins                                                               */
/* ─────────────────────────────────────────────────────────────────────── */

const BUILTIN_SCRIPTS = [
  {
    slug: "bra-removal-bedroom",
    name: "Bra Removal (Bedroom)",
    description:
      "A slow, cinematic 10-shot progression — from fully dressed in the bedroom to topless on the bed. Outfit and bedroom setting stay identical across the run.",
    themeHint: "bedroom intimacy; uniform bedroom setting; uniform outfit that visibly includes a bra underneath a top",
    picCount: 10,
    sceneDescriptions: [
      "standing in front of the bedroom mirror, fully dressed with the bra only just visible through or under the top, taking a casual selfie, soft window light, playful half-smile",
      "sitting on the edge of the bed, one hand pulling the hem of the top up a few inches to tease the bra underneath, glancing at the camera",
      "top pulled off over the head, now sitting on the bed in just the bra, hair slightly messed up, confident teasing smile",
      "kneeling on the bed, both arms reached back, fingers unhooking the bra clasp, eyes locked on the camera",
      "bra straps sliding off the shoulders, one hand pressing the cups lightly against the chest to keep them in place, coy expression",
      "bra pulled down to the waist, arms crossed in front of the chest covering the breasts, smirking at the camera",
      "half-turned away from the camera, bra fully off and tossed onto the sheets, looking back over one bare shoulder",
      "lying flat on the stomach on the bed, weight on the forearms, bare back and side-profile, biting a lower lip",
      "rolled over onto the back, one hand loosely placed across the chest teasingly, eyes half closed, the other arm above the head",
      "sitting up fully topless in bed, legs tucked under, direct confident eye contact with the camera, a small smile",
    ],
  },
  {
    slug: "pussy-play",
    name: "Pussy Play",
    description:
      "A 10-shot escalation focused on solo touch. Outfit is kept minimal and identical across pics; the setting stays consistent so every frame feels like the same uninterrupted moment.",
    themeHint: "solo intimate play; uniform minimal outfit appropriate for the setting; uniform private indoor setting",
    picCount: 10,
    sceneDescriptions: [
      "lying flat on the back on a soft surface, legs together, one hand resting on the lower stomach, relaxed expression, the camera at a low angle at the foot of the bed",
      "one leg lifted and slightly bent, knee falling outward, hand sliding down from the stomach toward the inner thigh, parted lips",
      "both legs parted, fingers tracing lightly along the inner thigh, head tilted to one side, dreamy half-closed eyes",
      "two fingers pressed gently against the mound over the fabric, back arching slightly off the surface, free hand gripping the fabric near the hip",
      "fingertips sliding the fabric aside, careful and deliberate motion, lips parted, eyes on the camera with a teasing look",
      "two fingers pressed at the entrance, just starting to press in, a soft gasp visible on the face, other hand flat against the collarbone",
      "close-up over-the-shoulder angle looking down the body, fingers mid-action, knees raised, toes curling",
      "head thrown back into the pillow, eyes shut tight, fingers buried deep, free hand gripping a fistful of sheets",
      "biting the lower lip hard, drawing the fingers out slowly, a breathless smile forming, chest rising from a deep inhale",
      "post-moment, eyes opening, flushed cheeks, a satisfied exhale, one hand resting loosely across the hip, eye contact with the camera",
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────── */
/*  Seeder                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Idempotent. Safe to call on every server boot.
 * Inserts or updates each built-in script by slug.
 * Base prompts are left empty — the first time a user opens the script in
 * the editor we generate the placeholder-ed templates via Grok. This keeps
 * the seed deterministic (no API calls at boot) and lets admins regenerate
 * later if prompting strategy changes.
 */
export async function seedBuiltInSextingScripts() {
  let created = 0;
  let updated = 0;
  for (const def of BUILTIN_SCRIPTS) {
    const creditsPerPic = TIER_PRICING[def.picCount];
    if (!creditsPerPic) {
      console.warn(`[sexting-seed] Unsupported picCount ${def.picCount} for ${def.slug}`);
      continue;
    }
    try {
      const existing = await prisma.sextingScript.findUnique({ where: { slug: def.slug } });
      if (existing) {
        // Keep admin-edited basePrompts unless they're empty (so we don't
        // wipe something a human curated).
        const basePrompts = Array.isArray(existing.basePrompts) && existing.basePrompts.length === def.sceneDescriptions.length
          ? existing.basePrompts
          : [];
        await prisma.sextingScript.update({
          where: { id: existing.id },
          data: {
            name: def.name,
            description: def.description,
            themeHint: def.themeHint,
            picCount: def.picCount,
            creditsPerPic,
            sceneDescriptions: def.sceneDescriptions,
            basePrompts,
            isBuiltIn: true,
            isPublic: true,
          },
        });
        updated += 1;
      } else {
        await prisma.sextingScript.create({
          data: {
            slug: def.slug,
            userId: null,
            name: def.name,
            description: def.description,
            themeHint: def.themeHint,
            picCount: def.picCount,
            creditsPerPic,
            sceneDescriptions: def.sceneDescriptions,
            basePrompts: [],
            isBuiltIn: true,
            isPublic: true,
          },
        });
        created += 1;
      }
    } catch (err) {
      console.warn(`[sexting-seed] failed for ${def.slug}:`, err?.message || err);
    }
  }
  if (created || updated) {
    console.log(`🌶️  Sexting scripts seed: +${created} new / ~${updated} updated built-ins`);
  }
}
