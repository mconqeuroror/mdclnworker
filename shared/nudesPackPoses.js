/**
 * Nudes Pack — 30 curated poses for batch NSFW generation.
 * promptFragment: merged with model looks (attributes) + LoRA trigger on the server.
 */
export const NUDES_PACK_CREDITS_PER_IMAGE = 15;
export const NUDES_PACK_MAX_POSES = 30;

/** @typedef {{ id: string, title: string, summary: string, category: string, promptFragment: string }} NudesPackPose */

/** @type {NudesPackPose[]} */
export const NUDES_PACK_POSES = [
  // Amateur / solo — natural nudes
  { id: "np-01", category: "Solo", title: "Bedroom soft light", summary: "Relaxed nude on bed, warm natural light, intimate amateur framing.", promptFragment: "nude woman lying on bed, soft natural window light, relaxed pose, intimate amateur photo, eye contact, realistic skin, one person only" },
  { id: "np-02", category: "Solo", title: "Mirror selfie", summary: "Phone mirror selfie, tasteful nude, casual bedroom.", promptFragment: "mirror selfie, holding phone, nude, bedroom mirror, tasteful framing, natural pose, amateur snapshot, one person only" },
  { id: "np-03", category: "Solo", title: "Edge of bed", summary: "Sitting on bed edge, shy intimate mood.", promptFragment: "nude sitting on edge of bed, legs together, shy smile, soft lighting, intimate amateur photo, one person only" },
  { id: "np-04", category: "Solo", title: "On stomach, look back", summary: "Lying on stomach, bare back, glance over shoulder.", promptFragment: "lying on stomach nude, bare back, looking back over shoulder, arched back, sensual pose, one person only" },
  { id: "np-05", category: "Solo", title: "Kneeling arch", summary: "Kneeling on bed, arched back, side profile.", promptFragment: "kneeling on bed nude, arched back, side profile, sensual silhouette, intimate bedroom, one person only" },
  { id: "np-06", category: "Solo", title: "Window silhouette", summary: "Standing by window, sheer curtain, soft silhouette.", promptFragment: "nude by window, sheer curtains, soft silhouette, side light, artistic nude, one person only" },
  { id: "np-07", category: "Solo", title: "Bath / wet skin", summary: "Bathroom, wet skin, relaxed sensual mood.", promptFragment: "nude in bathroom, wet skin, relaxed pose, steamy atmosphere, intimate candid, one person only" },
  { id: "np-08", category: "Solo", title: "Couch lounge", summary: "Lounging on couch, casual intimate nude.", promptFragment: "nude lounging on couch, legs relaxed, casual intimate pose, living room, amateur photo, one person only" },
  { id: "np-09", category: "Solo", title: "Floor stretch", summary: "Stretched on floor, overhead-friendly framing.", promptFragment: "nude lying on floor, body stretched, relaxed sensual pose, warm lighting, one person only" },
  { id: "np-10", category: "Solo", title: "Torso close-up", summary: "Close framing torso and thighs, soft focus background.", promptFragment: "intimate close-up torso and thighs, hands framing body, soft focus background, sensual detail shot, one person only" },
  // Explicit solo
  { id: "np-11", category: "Solo", title: "Sitting spread framing", summary: "Sitting, legs apart implied, explicit intimate framing.", promptFragment: "nude sitting, legs apart, explicit intimate framing, consensual adult, sensual expression, one person only" },
  { id: "np-12", category: "Solo", title: "All fours arch", summary: "On all fours, arched back, rear emphasis (solo).", promptFragment: "nude on all fours, arched back, presenting pose, sensual solo framing, bedroom, one person only" },
  { id: "np-13", category: "Solo", title: "Reclining leg raised", summary: "Reclining with one leg raised, explicit angle.", promptFragment: "nude reclining, one leg raised, explicit sensual angle, soft sheets, intimate solo, one person only" },
  // Partner / sex positions (consensual adult, two people when implied)
  { id: "np-14", category: "Sex", title: "Missionary POV", summary: "Missionary, POV from above, eye contact.", promptFragment: "missionary sex, pov from above, woman lying back, legs wrapped, intimate eye contact, consensual couple, explicit, two adults" },
  { id: "np-15", category: "Sex", title: "Missionary side", summary: "Side angle, bodies pressed together.", promptFragment: "missionary position side view, bodies pressed together, passionate, consensual sex, explicit, two adults" },
  { id: "np-16", category: "Sex", title: "Doggy rear", summary: "Doggy style from behind, arched back.", promptFragment: "doggy style sex from behind, arched back, explicit consensual, rear view, two adults" },
  { id: "np-17", category: "Sex", title: "Doggy low angle", summary: "Doggy from low rear angle.", promptFragment: "doggy style, low angle from behind, explicit consensual, passionate, two adults" },
  { id: "np-18", category: "Sex", title: "Cowgirl", summary: "Woman on top facing partner, hands on chest.", promptFragment: "cowgirl position, woman on top straddling, hands on partner chest, riding, explicit consensual, two adults" },
  { id: "np-19", category: "Sex", title: "Reverse cowgirl", summary: "Reverse cowgirl, arched back.", promptFragment: "reverse cowgirl, back arched, riding, explicit consensual sex, two adults" },
  { id: "np-20", category: "Sex", title: "Standing from behind", summary: "Bent over surface, standing sex from behind.", promptFragment: "standing sex from behind, bent over surface, explicit consensual, passionate, two adults" },
  { id: "np-21", category: "Sex", title: "Blowjob POV", summary: "Oral, POV, kneeling, eye contact.", promptFragment: "blowjob, pov, kneeling, eye contact, explicit oral sex, consensual, two adults" },
  { id: "np-22", category: "Sex", title: "Blowjob side", summary: "Side angle oral, depth implied.", promptFragment: "blowjob side angle, explicit oral sex, consensual adult, two adults" },
  { id: "np-23", category: "Sex", title: "Deep oral framing", summary: "Explicit oral framing.", promptFragment: "explicit oral sex act, consensual adult, passionate, two adults" },
  { id: "np-24", category: "Sex", title: "Sixty-nine", summary: "Overlapping bodies, mutual oral implied.", promptFragment: "sixty nine position, mutual oral, explicit consensual, two adults" },
  { id: "np-25", category: "Sex", title: "Prone bone", summary: "Lying flat, partner from above.", promptFragment: "prone bone sex position, lying flat, partner from above, explicit consensual, two adults" },
  { id: "np-26", category: "Sex", title: "Spooning", summary: "Side spooning sex, intimate.", promptFragment: "spooning sex side view, bodies curled together, intimate explicit, consensual, two adults" },
  { id: "np-27", category: "Sex", title: "Anal doggy", summary: "Anal sex, doggy positioning.", promptFragment: "anal sex doggy style, explicit consensual adult, rear angle, two adults" },
  { id: "np-28", category: "Sex", title: "Anal side", summary: "Anal from side angle.", promptFragment: "anal sex side view, explicit consensual, passionate, two adults" },
  { id: "np-29", category: "Sex", title: "Legs over shoulders", summary: "Intense missionary variant.", promptFragment: "missionary with legs over shoulders, deep angle, explicit consensual sex, two adults" },
  { id: "np-30", category: "Sex", title: "Standing carry", summary: "Lifted / standing carry passionate clinch.", promptFragment: "standing sex lifted carry, passionate clinch, explicit consensual, two adults" },
];

const byId = new Map(NUDES_PACK_POSES.map((p) => [p.id, p]));

export function getNudesPackPoseById(id) {
  return byId.get(id) || null;
}

export function validateNudesPackPoseIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Select at least one pose" };
  if (ids.length > NUDES_PACK_MAX_POSES) return { ok: false, error: `Maximum ${NUDES_PACK_MAX_POSES} poses per pack` };
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || !getNudesPackPoseById(id)) {
      return { ok: false, error: `Invalid pose id: ${id}` };
    }
    if (seen.has(id)) return { ok: false, error: "Duplicate pose ids" };
    seen.add(id);
  }
  return { ok: true };
}
