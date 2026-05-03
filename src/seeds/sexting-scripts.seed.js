/**
 * Built-in Sexting Scripts seed.
 *
 * Runs once per server boot. For every entry below we:
 *   - `upsert` by slug, so built-ins stay in sync with code edits
 *   - never touch a user's forked copy (user scripts have `isBuiltIn=false`
 *     and their own ids)
 *
 * Pic counts are one of the supported tiers (5 / 10 / 15) so pricing resolves
 * automatically. Every scene ships with BOTH the raw scene description
 * (shown in the editor) and a pre-authored base-prompt template with
 * `{{TRIGGER}}` / `{{OUTFIT}}` / `{{ENVIRONMENT}}` placeholders — so the
 * built-ins are runnable the moment the migration is applied, no manual
 * "Generate base prompts" click needed.
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
      "A slow, cinematic 10-shot progression — from fully dressed in the bedroom to topless on the bed. Outfit and bedroom setting stay identical across the run; the scenes describe her progressively taking the top and bra off.",
    themeHint:
      "bedroom intimacy; uniform bedroom setting; uniform starting outfit that visibly includes a bra under a removable top (e.g. a lace bralette under a cropped tee)",
    picCount: 10,
    sceneDescriptions: [
      "Standing in front of the bedroom mirror fully dressed, taking a casual phone selfie, soft window light, playful half-smile.",
      "Sitting on the edge of the bed, one hand pulling the hem of her top up a few inches to tease the bra underneath, parted lips, glancing at camera.",
      "Top just pulled off over her head, now sitting on the bed in only the bra, hair slightly mussed, confident teasing smile.",
      "Kneeling on the bed, both arms reached behind her back, fingers unhooking the bra clasp, eyes locked on camera.",
      "Bra straps sliding off her shoulders, one hand pressing the bra cups loosely against her chest, coy expression.",
      "Bra pulled down to her waist, arms crossed in front of her chest covering her breasts, smirking at camera.",
      "Half-turned away from the camera, bra fully off and tossed onto the sheets, looking back over one bare shoulder with a seductive gaze.",
      "Lying flat on her stomach on the bed, weight on forearms, bare back and side profile, biting her lower lip, warm golden light.",
      "Rolled onto her back, topless, one hand loosely across her chest teasingly, eyes half closed, the other arm above her head.",
      "Sitting up fully topless in bed, legs tucked under her, direct confident eye contact with the camera, a small knowing smile.",
    ],
    basePrompts: [
      "Photorealistic medium selfie of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, standing in front of a large mirror casually snapping a selfie with her phone, soft window light on her face, playful half-smile, bra just barely visible through or under the top.",
      "Photorealistic close-up of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, sitting on the edge of the bed with one hand slowly pulling the hem of her top up a few inches to tease the bra underneath, glancing at the camera with parted lips and a mischievous teasing look, soft morning light creating a warm intimate mood.",
      "Photorealistic upper-body shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, her top just pulled off over her head and hair slightly mussed, now sitting on the bed in only the bra from her outfit, confident teasing smile at camera, soft natural lighting.",
      "Photorealistic three-quarter shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, kneeling on the bed with both arms reached behind her back, fingers working the bra clasp of her outfit, eyes locked on the camera, warm intimate lighting accentuating her curves.",
      "Photorealistic close-up of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, bra straps of her outfit sliding slowly off her shoulders, one hand pressing the bra cups loosely against her chest to keep them in place, coy over-the-shoulder expression, soft ambient bedroom glow.",
      "Photorealistic medium shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, bra pulled down to her waist, arms crossed in front of her chest covering her breasts, smirking playfully at the camera with a knowing glint in her eyes, cinematic intimate lighting.",
      "Photorealistic side-profile shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, half turned away from the camera with the bra from her outfit fully off and tossed onto the sheets beside her, looking back over one bare shoulder with a seductive gaze, smooth back lit softly.",
      "Photorealistic overhead shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, lying flat on her stomach on the bed with weight balanced on her forearms, bare back and side profile visible as the top of her outfit lies crumpled nearby, biting her lower lip, warm golden afternoon light.",
      "Photorealistic full-body shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, rolled onto her back topless, one arm stretched above her head and the other loosely placed across her chest teasingly, eyes half closed in a sultry expression, soft ambient bedroom glow.",
      "Photorealistic medium shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, sitting up topless on the bed with her legs tucked under her and the discarded pieces of her outfit visible on the sheets, direct confident eye contact with the camera, hair falling over one shoulder, small knowing smile, cinematic intimate lighting.",
    ],
  },
  {
    slug: "pussy-play",
    name: "Pussy Play",
    description:
      "A 10-shot solo-touch escalation. Outfit is kept minimal and identical across pics; the setting stays consistent so every frame feels like the same uninterrupted moment.",
    themeHint:
      "solo intimate play on a bed; uniform minimal outfit that can be slid aside or left on (e.g. just panties or a loose oversized shirt); uniform private indoor setting (bedroom, warm lighting)",
    picCount: 10,
    sceneDescriptions: [
      "Lying flat on her back on a soft surface, legs together, one hand resting on her lower stomach, relaxed expression, low-angle shot from the foot of the bed.",
      "One leg lifted and slightly bent with the knee falling outward, hand sliding from her stomach toward her inner thigh, parted lips.",
      "Both legs parted, fingers tracing lightly along her inner thigh, head tilted with dreamy half-closed eyes.",
      "Fingers pressed gently against her mound over the fabric of her outfit, back arching slightly off the surface, free hand gripping the fabric near her hip.",
      "Fingertips sliding the fabric aside with a deliberate motion, lips parted, eyes locked on camera with a teasing look.",
      "Two fingers pressed at her entrance, just starting to press in, a soft gasp visible on her face, other hand flat against her collarbone.",
      "Over-the-shoulder angle down the length of her body, fingers mid-action, knees raised, toes curling.",
      "Head thrown back into the pillow, eyes shut tight, fingers buried deep, free hand gripping a fistful of the sheets.",
      "Biting her lower lip hard, drawing her fingers out slowly, breathless smile forming, chest rising from a deep inhale.",
      "Post-moment, eyes gently opening with flushed cheeks, a satisfied exhale, one hand resting loosely across her hip, eye contact with camera.",
    ],
    basePrompts: [
      "Photorealistic low-angle shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, lying flat on her back with her legs together and one hand resting softly on her lower stomach, completely relaxed expression, camera at the foot of the bed angled up her body, soft warm lighting.",
      "Photorealistic medium shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, one leg lifted and slightly bent with the knee falling outward, her hand sliding slowly from her stomach down toward her inner thigh, lips parted in anticipation, intimate mood lighting.",
      "Photorealistic three-quarter shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, both legs parted with fingertips tracing lightly along her inner thigh, head tilted to one side, dreamy half-closed eyes, soft warm cinematic lighting.",
      "Photorealistic close-up of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, two fingers pressed gently against her mound over the fabric of her outfit, her back arching slightly off the surface, free hand gripping the fabric near her hip, mouth open in a soft exhale.",
      "Photorealistic intimate close-up of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, her fingertips carefully sliding the fabric of her outfit aside with a deliberate motion, lips parted, eyes locked on the camera with a teasing challenging look.",
      "Photorealistic medium shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, two fingers pressed at her entrance and just starting to press in, a soft gasp visible on her face, other hand resting flat against her collarbone, cinematic intimate lighting.",
      "Photorealistic over-the-shoulder shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, camera looking down the length of her body toward her fingers mid-action between her thighs, knees raised and toes curling in pleasure, shallow depth of field on the action.",
      "Photorealistic upper-body shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, head thrown back into the pillow with eyes shut tight, fingers buried deep, free hand gripping a fistful of the sheets, expression of absorbed pleasure, warm moody light.",
      "Photorealistic close-up of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, biting her lower lip hard as she draws her fingers out slowly, a breathless smile beginning to form, chest rising from a deep inhale, soft sheen on her skin.",
      "Photorealistic medium shot of {{TRIGGER}} wearing {{OUTFIT}} in {{ENVIRONMENT}}, post-moment, eyes gently opening with flushed cheeks and a satisfied exhale, one hand resting loosely across her hip, direct intimate eye contact with the camera, warm afterglow lighting.",
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────── */
/*  Seeder                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Idempotent. Safe to call on every server boot.
 * Inserts or updates each built-in script by slug. ALWAYS writes the
 * current seed's `basePrompts` so prompt improvements ship with a deploy;
 * admins who want a curated variant should fork the script (saves under
 * their user id, `isBuiltIn=false`).
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
    if (def.basePrompts.length !== def.sceneDescriptions.length || def.basePrompts.length !== def.picCount) {
      console.warn(`[sexting-seed] Mismatched array lengths for ${def.slug} — skipping`);
      continue;
    }
    try {
      const existing = await prisma.sextingScript.findUnique({ where: { slug: def.slug } });
      if (existing) {
        await prisma.sextingScript.update({
          where: { id: existing.id },
          data: {
            name: def.name,
            description: def.description,
            themeHint: def.themeHint,
            picCount: def.picCount,
            creditsPerPic,
            sceneDescriptions: def.sceneDescriptions,
            basePrompts: def.basePrompts,
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
            basePrompts: def.basePrompts,
            isBuiltIn: true,
            isPublic: true,
          },
        });
        created += 1;
      }
    } catch (err) {
      // Most common cause at this point: table doesn't exist yet because
      // the 20260503200000_add_sexting_scripts migration hasn't been run.
      console.warn(`[sexting-seed] failed for ${def.slug}:`, err?.message || err);
    }
  }
  if (created || updated) {
    console.log(`🌶️  Sexting scripts seed: +${created} new / ~${updated} updated built-ins`);
  }
}
