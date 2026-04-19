/**
 * Nudes Pack — 30 curated poses for batch NSFW generation.
 * promptFragment: merged with model looks (attributes) + LoRA trigger on the server.
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
  { id: "np-01", category: "Solo", title: "Bedroom soft light", summary: "Relaxed nude on bed, warm natural light, intimate amateur framing.", promptFragment: "nude lying on a rumpled bed, soft flat daylight from a nearby window, relaxed pose, looking toward camera with a calm expression, rumpled sheets around her, phone charger on the nightstand, hoodie dropped on the floor" },
  { id: "np-02", category: "Solo", title: "Mirror selfie", summary: "Phone mirror selfie, tasteful nude, casual bedroom.", promptFragment: "nude mirror selfie in a casual bedroom, iPhone visible in the reflection, one hand holding the phone at chest height, slightly off-center framing, messy shelves and a lamp visible behind her" },
  { id: "np-03", category: "Solo", title: "Edge of bed", summary: "Sitting on bed edge, shy intimate mood.", promptFragment: "nude sitting on the edge of a bed, legs pressed together, elbows on knees, looking up at the camera with a shy half-smile, harsh frontal phone flash washing out her skin slightly, crumpled sheet behind her" },
  { id: "np-04", category: "Solo", title: "On stomach, look back", summary: "Lying on stomach, bare back, glance over shoulder.", promptFragment: "nude lying face-down on a bed, bare back and lower body, glancing back over one shoulder with a relaxed expression, pillow under her chin, soft window light from the side, water bottle on the floor nearby" },
  { id: "np-05", category: "Solo", title: "Kneeling arch", summary: "Kneeling on bed, arched back, side profile.", promptFragment: "nude kneeling upright on a bed, back arched, head tilted back, side-profile framing showing her full silhouette, dim room with a single lamp behind her creating a soft rim, crumpled bedsheets under her knees" },
  { id: "np-06", category: "Solo", title: "Window silhouette", summary: "Standing by window, sheer curtain, soft silhouette.", promptFragment: "nude standing beside a large window, sheer white curtain diffusing flat morning light, soft side-lit silhouette, one hand resting on the window frame, clean minimal room, bare wooden floor" },
  { id: "np-07", category: "Solo", title: "Bath / wet skin", summary: "Bathroom, wet skin, relaxed sensual mood.", promptFragment: "nude in a small bathroom, just stepped out of the shower, wet skin and damp hair clinging to her neck, leaning against the tiled wall, soft overhead bathroom light, towel dropped on the floor, toiletries on the sink edge" },
  { id: "np-08", category: "Solo", title: "Couch lounge", summary: "Lounging on couch, casual intimate nude.", promptFragment: "nude lounging sideways on a lived-in couch, one leg over the armrest, arm resting on the back cushion, casual relaxed expression, TV remote on the cushion beside her, phone on the coffee table, afternoon window light" },
  { id: "np-09", category: "Solo", title: "Floor stretch", summary: "Stretched on floor, overhead-friendly framing.", promptFragment: "nude lying flat on a hardwood floor, body fully stretched, arms above her head, overhead framing looking straight down, expression calm and open, scattered clothes and a discarded bra near her head, dim lamp glow from the side" },
  { id: "np-10", category: "Solo", title: "Torso close-up", summary: "Close framing torso and thighs, soft focus background.", promptFragment: "intimate close-up shot from waist to mid-thigh, hands resting loosely at her sides, slight natural curve of her body, shallow focus with a blurred bedroom background behind her, frontal phone flash" },
  // Explicit solo
  { id: "np-11", category: "Solo", title: "Sitting spread framing", summary: "Sitting with legs apart, explicit intimate framing.", promptFragment: "nude sitting on the edge of a bed with legs apart, leaning back on both arms, looking directly at the camera with a confident expression, explicit close framing showing inner thighs and pussy, harsh frontal phone flash, crumpled sheets beneath her" },
  { id: "np-12", category: "Solo", title: "All fours arch", summary: "On all fours, arched back, rear emphasis (solo).", promptFragment: "nude on all fours on the bed, back arched and hips raised, rear-facing framing showing her ass and pussy from behind, head turned slightly to glance back, mattress sheet bunched under her hands, dim bedroom, frontal phone flash from behind" },
  { id: "np-13", category: "Solo", title: "Reclining leg raised", summary: "Reclining with one leg raised, explicit angle.", promptFragment: "nude reclining on a bed, one leg raised and held at the calf, explicit low angle showing pussy, other leg flat on the mattress, free hand resting on her stomach, flushed expression, rumpled white sheets, harsh phone flash" },
  // Partner / sex positions
  { id: "np-14", category: "Sex", title: "Missionary POV", summary: "Missionary, POV from above, eye contact.", promptFragment: "POV from above looking down, partner's torso and hips in upper foreground silhouette, his erect cock penetrating her from above, woman lying on her back on rumpled sheets with her legs wrapped around his waist, biting her lip, one hand gripping his forearm, eye contact with the camera, dim bedroom at night, harsh frontal phone flash" },
  { id: "np-15", category: "Sex", title: "Missionary side", summary: "Side angle, bodies pressed together.", promptFragment: "side profile shot of missionary sex, partner on top with his hips between her thighs, his erect cock penetrating her, woman on her back with her leg hooked over his hip, one free hand squeezing her own breast, messy hair on the pillow, dim bedroom, frontal phone flash casting sharp shadows" },
  { id: "np-16", category: "Sex", title: "Doggy rear", summary: "Doggy style from behind, arched back.", promptFragment: "POV from behind, partner's hips and thighs in lower foreground framing the shot, his erect cock penetrating her from behind, woman on all fours with back arched low, hands flat on the mattress, ass raised toward the camera, dim bedroom, harsh phone flash from behind" },
  { id: "np-17", category: "Sex", title: "Doggy low angle", summary: "Doggy from low rear angle.", promptFragment: "POV from a low rear angle close to the mattress looking up, partner's hips and thighs framing the upper edge of the shot, his erect cock penetrating her from behind, woman on all fours with back arched, hands braced on the bed, moaning expression, dim room, phone flash from low behind" },
  { id: "np-18", category: "Sex", title: "Cowgirl", summary: "Woman on top facing partner, hands on his chest.", promptFragment: "POV from below looking up at her, partner's hips and thighs in lower foreground, woman straddling and riding on top facing the camera, her hands pressed flat on his chest for balance, hips slightly raised mid-ride, flushed cheeks, biting her lower lip, rumpled sheets, frontal phone flash" },
  { id: "np-19", category: "Sex", title: "Reverse cowgirl", summary: "Reverse cowgirl, arched back.", promptFragment: "POV from below looking up at her back, partner's hips and lower torso in foreground, woman straddling facing away in reverse cowgirl, her back arched, both hands on his thighs for balance, head tilted back, dim bedroom, harsh phone flash from the front" },
  { id: "np-20", category: "Sex", title: "Standing from behind", summary: "Bent over surface, standing sex from behind.", promptFragment: "POV from behind standing, partner's hips and abs in lower foreground, his erect cock penetrating her from behind, woman bent forward over a low dresser with both hands flat on the surface, head down, hair falling forward, side-angled framing, dim bedroom light, phone flash" },
  { id: "np-21", category: "Sex", title: "Blowjob POV", summary: "Oral, POV, kneeling, eye contact.", promptFragment: "first person POV from the man receiving oral, his lower abdomen and upper thighs visible at the edges of the frame, his erect cock continuous with his body, kneeling woman on a bedroom floor with her mouth wrapped around it, one hand on the base of the shaft, other hand on her thigh, direct eye contact with the camera, messy hair, frontal phone flash from above" },
  { id: "np-22", category: "Sex", title: "Blowjob side", summary: "Side angle oral, depth implied.", promptFragment: "side profile shot of a woman kneeling beside the bed giving oral, partner's lower abdomen and thigh visible at the right edge of the frame, his erect cock continuous with his body in her mouth, her lips stretched around it, one hand at the base, focused expression with eyes half-closed, dim room, phone flash from the side" },
  { id: "np-23", category: "Sex", title: "Deep oral framing", summary: "Explicit oral, deep framing.", promptFragment: "close-up first person POV from the man receiving oral, his lower abdomen and upper thighs visible at the edges of the frame, his erect cock continuous with his body filling her mouth, her lips stretched around it, both hands on his hips, watery eyes, mascara slightly smeared, harsh frontal phone flash" },
  { id: "np-24", category: "Sex", title: "Sixty-nine", summary: "Overlapping bodies, mutual oral.", promptFragment: "overhead angle of a sixty-nine position on a bed, woman on top facing down, his erect cock in her mouth, her pussy over his face, intertwined bodies, messy sheets, dim room with a lamp nearby" },
  { id: "np-25", category: "Sex", title: "Prone bone", summary: "Lying flat, partner penetrating from above.", promptFragment: "POV from behind and slightly above, partner's hips in upper foreground, his erect cock penetrating her from behind, woman lying completely flat on her stomach in prone bone position, arms stretched above her head gripping the sheets, head turned sideways with a strained expression, dim bedroom, phone flash from behind" },
  { id: "np-26", category: "Sex", title: "Spooning", summary: "Side spooning sex, intimate.", promptFragment: "side profile shot, both lying on their sides facing the same direction, partner behind her with his hips against her ass, his erect cock penetrating her from behind, his arm wrapped around her, her top leg raised slightly, intimate close framing, dim bedroom, soft lamp light behind them" },
  { id: "np-27", category: "Sex", title: "Anal doggy", summary: "Anal sex, doggy positioning.", promptFragment: "POV from directly behind, partner's hips and thighs in lower foreground, his erect cock penetrating her ass from behind, woman on all fours with back arched low, both hands flat on the bed, head down with hair falling forward, harsh phone flash from behind" },
  { id: "np-28", category: "Sex", title: "Anal side", summary: "Anal from side angle.", promptFragment: "side profile shot, woman lying on her side with one leg raised, partner behind her with his hips against her ass, his erect cock penetrating her ass from behind, her hand resting on her hip, dim room, soft lamp behind them" },
  { id: "np-29", category: "Sex", title: "Legs over shoulders", summary: "Intense missionary variant, legs over shoulders.", promptFragment: "POV from above with deep angle, partner's torso and hips in upper foreground silhouette, his erect cock penetrating her from above at a steep angle, woman on her back with her legs draped over his shoulders, hips raised high, her hands gripping the sheets above her head, strained expression, harsh frontal phone flash" },
  { id: "np-30", category: "Sex", title: "Standing carry", summary: "Lifted standing carry, passionate.", promptFragment: "POV from the front, partner's torso and arms supporting her from below, his erect cock penetrating her from below, woman lifted with her legs wrapped around his waist, her arms around his neck, both upright against a bedroom wall or door, passionate expression, phone flash from the front" },
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
  "np-30": { poseId: "cowgirl" },
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
