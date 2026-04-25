/**
 * Nudes Pack — 30 curated poses for batch NSFW generation.
 * promptFragment: merged with model looks (attributes) + LoRA trigger on the server.
 * Partnered poses: one clear camera + light direction, exactly two people, penis only at his groin,
 *   avoid overhead 69 / stacked silhouettes when the model merges torsos; say "not merged" where needed.
 *
 * Pricing: total scales linearly from 30 cr (1 pose) to 450 cr (30 poses) — same endpoints as 15–30 cr/image
 * at the extremes, but total never exceeds “full pack” when you select fewer than 30 (monotonic).
 */
export const NUDES_PACK_CREDITS_MIN = 15;
export const NUDES_PACK_CREDITS_MAX = 30;
/** @deprecated use NUDES_PACK_CREDITS_MIN — kept for older imports */
export const NUDES_PACK_CREDITS_PER_IMAGE = NUDES_PACK_CREDITS_MIN;
export const NUDES_PACK_MAX_POSES = 30;

/**
 * @param {{ nudesPackCreditsMin?: number, nudesPackCreditsMax?: number } | null | undefined} pricing — from getGenerationPricing()
 */
function packCreditsFromPricing(pricing) {
  const min = Number(pricing?.nudesPackCreditsMin);
  const max = Number(pricing?.nudesPackCreditsMax);
  return {
    minC: Number.isFinite(min) && min >= 0 ? min : NUDES_PACK_CREDITS_MIN,
    maxC: Number.isFinite(max) && max >= 0 ? max : NUDES_PACK_CREDITS_MAX,
  };
}

/**
 * Total credits: linear from (n=1 → maxC) to (n=maxPoses → minC*maxPoses).
 * @param {number} selectedCount
 * @param {{ nudesPackCreditsMin?: number, nudesPackCreditsMax?: number } | null | undefined} [pricing]
 * @returns {number}
 */
export function getNudesPackTotalCredits(selectedCount, pricing) {
  const { minC, maxC } = packCreditsFromPricing(pricing);
  const maxPoses = NUDES_PACK_MAX_POSES;
  const n = Math.min(maxPoses, Math.max(1, Math.round(Number(selectedCount)) || 1));
  const fullTotal = minC * maxPoses;
  if (n >= maxPoses) return fullTotal;
  if (n <= 1) return maxC;
  return Math.round(maxC + ((fullTotal - maxC) * (n - 1)) / (maxPoses - 1));
}

/**
 * Average credits per image (rounded) for UI — actual per-image split may vary by 1 so rows sum to total.
 * @param {number} selectedCount
 * @param {{ nudesPackCreditsMin?: number, nudesPackCreditsMax?: number } | null | undefined} [pricing]
 * @returns {number}
 */
export function getNudesPackCreditsPerImage(selectedCount, pricing) {
  const n = Math.min(NUDES_PACK_MAX_POSES, Math.max(1, Math.round(Number(selectedCount)) || 1));
  const total = getNudesPackTotalCredits(n, pricing);
  return Math.max(1, Math.round(total / n));
}

/**
 * Integer credits per generation (length n), summing exactly to getNudesPackTotalCredits(n).
 * @param {number} selectedCount
 * @param {{ nudesPackCreditsMin?: number, nudesPackCreditsMax?: number } | null | undefined} [pricing]
 * @returns {number[]}
 */
export function getNudesPackCreditsSplit(selectedCount, pricing) {
  const n = Math.min(NUDES_PACK_MAX_POSES, Math.max(1, Math.round(Number(selectedCount)) || 1));
  const total = getNudesPackTotalCredits(n, pricing);
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/** @typedef {{ id: string, title: string, summary: string, category: string, promptFragment: string }} NudesPackPose */

/** @type {NudesPackPose[]} */
export const NUDES_PACK_POSES = [
  // Amateur / solo — natural nudes
  { id: "np-01", category: "Solo", title: "Bedroom soft light", summary: "Relaxed nude on bed, warm natural light, intimate amateur framing.", promptFragment: "one woman, nude, lying on a rumpled bed, soft flat daylight from a nearby window, relaxed pose, looking toward camera, calm expression, sheets around her, phone charger on the nightstand, hoodie on the floor" },
  { id: "np-02", category: "Solo", title: "Mirror selfie", summary: "Phone mirror selfie, tasteful nude, casual bedroom.", promptFragment: "one woman, nude mirror selfie, casual bedroom, iPhone visible in the mirror, one hand at chest height, off-center framing, shelves and a lamp in the background" },
  { id: "np-03", category: "Solo", title: "Edge of bed", summary: "Sitting on bed edge, shy intimate mood.", promptFragment: "one woman, nude on the edge of the bed, legs together, elbows on knees, looking up, shy half-smile, on-camera phone flash, crumpled sheet behind her" },
  { id: "np-04", category: "Solo", title: "On stomach, look back", summary: "Lying on stomach, bare back, glance over shoulder.", promptFragment: "one woman, nude, face-down on a bed, bare back, glance over one shoulder, relaxed, pillow under chin, side window light, water bottle on the floor" },
  { id: "np-05", category: "Solo", title: "Kneeling arch", summary: "Kneeling on bed, arched back, side profile.", promptFragment: "one woman, nude, kneeling on the bed, back arched, head back, full side profile silhouette, dim room, one back lamp, sheets under her knees" },
  { id: "np-06", category: "Solo", title: "Window silhouette", summary: "Standing by window, sheer curtain, soft silhouette.", promptFragment: "one woman, nude, beside a large window, sheer curtain, soft morning light, one hand on the frame, minimal room, wooden floor" },
  { id: "np-07", category: "Solo", title: "Bath / wet skin", summary: "Bathroom, wet skin, relaxed sensual mood.", promptFragment: "one woman, nude, small bathroom, just out of the shower, wet skin and hair, leaning on tile, overhead bath light, towel on the floor" },
  { id: "np-08", category: "Solo", title: "Couch lounge", summary: "Lounging on couch, casual intimate nude.", promptFragment: "one woman, nude, sideways on a couch, leg over the arm, arm on the back, relaxed, remote and phone in frame, afternoon window light" },
  { id: "np-09", category: "Solo", title: "Floor stretch", summary: "Stretched on floor, overhead-friendly framing.", promptFragment: "one woman, fully nude, no bra, no panties, no clothing, top-down overhead shot, lying flat on hardwood, arms straight above her head, legs long, calm expression, scattered clothes and a bra beside her, one warm side lamp" },
  { id: "np-10", category: "Solo", title: "Torso close-up", summary: "Close framing torso and thighs, soft focus background.", promptFragment: "one woman, nude, intimate close-up waist to mid-thigh, hands at her sides, shallow focus, bedroom blurred behind her, on-camera front flash" },
  // Explicit solo
  { id: "np-11", category: "Solo", title: "Sitting spread framing", summary: "Sitting with legs apart, explicit intimate framing.", promptFragment: "one woman, fully nude, on the bed edge, legs apart, leaning back on both arms, confident expression, explicit framing, inner thighs, harsh on-camera flash, crumpled sheets" },
  { id: "np-12", category: "Solo", title: "All fours arch", summary: "On all fours, arched back, rear emphasis (solo).", promptFragment: "one woman, nude, on all fours on the bed, arched back, hips up, camera from behind her, ass and pussy toward the lens, head glancing back, bunched sheet under hands, dim room, one harsh on-camera flash from the same direction as the camera" },
  { id: "np-13", category: "Solo", title: "Reclining leg raised", summary: "Reclining with one leg raised, explicit angle.", promptFragment: "one woman, nude, reclining on a bed, one leg raised, low explicit angle, other leg on the mattress, hand on stomach, flushed, white sheets, on-camera flash" },
  // Partner / sex positions
  { id: "np-14", category: "Sex", title: "Missionary POV", summary: "Missionary, POV from above, eye contact.", promptFragment: "the man's first-person view looking down, dim bedroom, only two people, woman on her back on rumpled white sheets, man on top between camera and her, one continuous body from his hips, penis in pussy, her legs over his lower back, biting her lip, one hand on his forearm, eye contact, one harsh on-camera phone flash" },
  { id: "np-15", category: "Sex", title: "Missionary side", summary: "Side angle, bodies pressed together.", promptFragment: "side profile, only two people, missionary, not merged, he on top, his penis in her pussy, she on back, one leg over his hip, she squeezes her own breast, messy hair on pillow, dim bedroom, on-camera flash, sharp side shadows" },
  { id: "np-16", category: "Sex", title: "Doggy rear", summary: "Doggy style from behind, arched back.", promptFragment: "camera from behind the couple, hip height, one man and one woman only, he kneels behind, penis in pussy from behind, clear separation of two bodies, her on all fours on the mattress, arched back, ass toward camera, hands on sheets, dim bedroom, harsh on-camera flash" },
  { id: "np-17", category: "Sex", title: "Doggy low angle", summary: "Doggy from low rear angle.", promptFragment: "low camera at mattress height, only two people, he kneels behind, his penis in her pussy from behind, not merged, her on all fours, arched, hands on bed, moaning, dim room, on-camera fill flash" },
  { id: "np-18", category: "Sex", title: "Cowgirl", summary: "Woman on top facing partner, hands on his chest.", promptFragment: "from below, one man and one woman, not merged, she straddles facing camera, his pelvis in lower frame, his penis in her pussy, hands on his chest, mid-ride, flushed, biting lip, sheets, on-camera flash" },
  { id: "np-19", category: "Sex", title: "Reverse cowgirl", summary: "Reverse cowgirl, arched back.", promptFragment: "reverse cowgirl, man lying on his back, one woman straddling facing his feet, camera low at his shins looking up, his pelvis and penis in pussy fully visible, her back to camera, hands on his thighs, head back, not merged, dim bedroom, single lamp, no disembodied genitals" },
  { id: "np-20", category: "Sex", title: "Standing from behind", summary: "Bent over surface, standing sex from behind.", promptFragment: "standing behind her, 3-4 quarter rear view, man behind woman bent over a low dresser, hands flat on the wood, penis in pussy at groin, two separate bodies, not fused, his hands on her hips, dim bedroom, phone flash" },
  { id: "np-21", category: "Sex", title: "Blowjob POV", summary: "Oral, POV, kneeling, eye contact.", promptFragment: "first person POV, only two people, man standing or sitting edge of frame, his penis in her mouth attached at the groin, she kneels on the floor, one hand on the shaft, direct eye contact, messy hair, on-camera flash from above, no extra hands or feet, no disembodied penis" },
  { id: "np-22", category: "Sex", title: "Blowjob side", summary: "Side angle oral, depth implied.", promptFragment: "side profile, one couple only, she kneels beside the bed, his lower body at frame edge, penis in her mouth from his groin only, one hand on the shaft, eyes half closed, dim room, on-camera side flash" },
  { id: "np-23", category: "Sex", title: "Deep oral framing", summary: "Explicit oral, deep framing.", promptFragment: "extreme close first-person POV, only one couple, penis in her mouth from the man's groin only, his lower abs and thighs at the frame edge, her hands on his hips, parted mouth, watery smeared mascara, harsh on-camera fill flash, no extra limbs" },
  { id: "np-24", category: "Sex", title: "Sixty-nine", summary: "Overlapping bodies, mutual oral.", promptFragment: "side view from the bed, sixty-nine, man on his back, woman in plank on top, her mouth at his groin, his face at her crotch, torsos not merged, clear gap between abdomens, two distinct bodies, messy sheets, one bedside lamp, no penis on face" },
  { id: "np-25", category: "Sex", title: "Prone bone", summary: "Lying flat, partner penetrating from above.", promptFragment: "from behind and slightly above, one man and one woman, not merged, she flat on her stomach, prone bone, his penis in her pussy from behind, arms above head on sheets, head turned, strained, dim bedroom, on-camera flash" },
  { id: "np-26", category: "Sex", title: "Spooning", summary: "Side spooning sex, intimate.", promptFragment: "side profile, only two people, both on sides, he behind, not merged, his penis in her pussy from behind, his arm around her, her top leg raised, soft lamp behind the bed" },
  { id: "np-27", category: "Sex", title: "Anal doggy", summary: "Anal sex, doggy positioning.", promptFragment: "camera from behind, hip height, one man and one woman, not merged, his penis in her ass, she on all fours, arched, hands on bed, head down, on-camera flash" },
  { id: "np-28", category: "Sex", title: "Anal side", summary: "Anal from side angle.", promptFragment: "side profile, full-body on bed, spooning, man behind, anal, penis from his groin only, her on side with top leg forward, not merged, her hand on hip, dim room, soft back rim light" },
  { id: "np-29", category: "Sex", title: "Legs over shoulders", summary: "Intense missionary variant, legs over shoulders.", promptFragment: "the man's first-person view looking down, only two people, not merged, she on back, legs on his shoulders, steep angle, his penis in her pussy, her hands on sheets above her head, strained, on-camera flash" },
  { id: "np-30", category: "Sex", title: "Standing carry", summary: "Lifted standing carry, passionate.", promptFragment: "standing against a wall, he lifts her, her legs around his waist, his arms under her thighs, face to face, one penis at groin, two complete bodies, no extra limbs, passionate expression, on-camera front flash" },
];

const byId = new Map(NUDES_PACK_POSES.map((p) => [p.id, p]));

/**
 * Maps each pack pose to additive RunPod LoRAs (pose slot + amateur_nudes / deepthroat / …).
 * Batch prompts are often rewritten by Grok into vague prose, so the AI LoRA picker misses keywords —
 * these hints align pack rows with classic NSFW (explicit terms + chips).
 *
 * poseId must match `POSE_LORAS[].id` in server `fal.service.js`.
 *
 * @typedef {{ poseId?: string, amateurNudes?: number, deepthroat?: number, masturbation?: number, dildo?: number, oralScene?: boolean }} NudesPackAdditiveLoraHint
 */

/** @type {Record<string, NudesPackAdditiveLoraHint>} */
export const NUDES_PACK_ADDITIVE_LORA_HINTS = {
  // Solo — girlfriend / amateur aesthetic (additive LoRAs capped at 0.35 server-side)
  "np-01": { amateurNudes: 0.35 },
  "np-02": { amateurNudes: 0.35 },
  "np-03": { amateurNudes: 0.35 },
  "np-04": { amateurNudes: 0.35 },
  "np-05": { amateurNudes: 0.35 },
  "np-06": { amateurNudes: 0.32 },
  "np-07": { amateurNudes: 0.35 },
  "np-08": { amateurNudes: 0.35 },
  "np-09": { amateurNudes: 0.35 },
  "np-10": { amateurNudes: 0.32 },
  "np-11": { amateurNudes: 0.35 },
  "np-12": { amateurNudes: 0.35 },
  "np-13": { amateurNudes: 0.35 },
  // Sex — pose LoRAs (match workflow slots)
  "np-14": { poseId: "missionary" },
  "np-15": { poseId: "missionary" },
  "np-16": { poseId: "doggystyle_facing" },
  "np-17": { poseId: "doggystyle_facing" },
  "np-18": { poseId: "cowgirl" },
  "np-19": { poseId: "cowgirl" },
  "np-20": { poseId: "doggystyle_facing" },
  // Oral — pose none + deepthroat enhancement (same policy as classic)
  "np-21": { oralScene: true, deepthroat: 0.35 },
  "np-22": { oralScene: true, deepthroat: 0.35 },
  "np-23": { oralScene: true, deepthroat: 0.35 },
  "np-24": { oralScene: true, deepthroat: 0.35 },
  "np-25": { poseId: "missionary" },
  "np-26": { amateurNudes: 0.38 },
  "np-27": { poseId: "anal_doggystyle" },
  "np-28": { poseId: "missionary_anal" },
  "np-29": { poseId: "missionary" },
  "np-30": { poseId: "missionary" },
};

/**
 * @param {string} poseId
 * @returns {NudesPackAdditiveLoraHint | null}
 */
export function getNudesPackAdditiveLoraHint(poseId) {
  if (!poseId || typeof poseId !== "string") return null;
  return NUDES_PACK_ADDITIVE_LORA_HINTS[poseId] || null;
}

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
