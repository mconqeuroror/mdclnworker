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
 * Total credits: linear from (n=1 → 30) to (n=30 → 450).
 * @param {number} selectedCount
 * @returns {number}
 */
export function getNudesPackTotalCredits(selectedCount) {
  const n = Math.min(NUDES_PACK_MAX_POSES, Math.max(1, Math.round(Number(selectedCount)) || 1));
  if (n >= NUDES_PACK_MAX_POSES) return NUDES_PACK_CREDITS_MIN * NUDES_PACK_MAX_POSES;
  if (n <= 1) return NUDES_PACK_CREDITS_MAX;
  return Math.round(30 + (420 * (n - 1)) / (NUDES_PACK_MAX_POSES - 1));
}

/**
 * Average credits per image (rounded) for UI — actual per-image split may vary by 1 so rows sum to total.
 * @param {number} selectedCount
 * @returns {number}
 */
export function getNudesPackCreditsPerImage(selectedCount) {
  const n = Math.min(NUDES_PACK_MAX_POSES, Math.max(1, Math.round(Number(selectedCount)) || 1));
  const total = getNudesPackTotalCredits(n);
  return Math.max(1, Math.round(total / n));
}

/**
 * Integer credits per generation (length n), summing exactly to getNudesPackTotalCredits(n).
 * @param {number} selectedCount
 * @returns {number[]}
 */
export function getNudesPackCreditsSplit(selectedCount) {
  const n = Math.min(NUDES_PACK_MAX_POSES, Math.max(1, Math.round(Number(selectedCount)) || 1));
  const total = getNudesPackTotalCredits(n);
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
  { id: "np-14", category: "Sex", title: "Missionary POV", summary: "Missionary, POV from above, eye contact.", promptFragment: "woman lying on her back on rumpled sheets in a dim bedroom at night, harsh frontal phone flash, missionary position with his average erect cock deep inside her from a POV angle from above, her legs wrapped around his waist, she makes direct eye contact with the camera, biting her lip, one hand gripping his forearm" },
  { id: "np-15", category: "Sex", title: "Missionary side", summary: "Side angle, bodies pressed together.", promptFragment: "missionary sex from a side angle, bodies pressed close on a bed, her leg hooked over his hip, his average erect cock visibly inside her from the side view, her labia gripping the shaft, she squeezes her breast with one free hand, messy hair on the pillow, frontal phone flash casting sharp shadows" },
  { id: "np-16", category: "Sex", title: "Doggy rear", summary: "Doggy style from behind, arched back.", promptFragment: "doggy style from directly behind, back arched low, hands flat on the mattress, his average erect cock penetrating her from behind, her labia visibly spread around the shaft, ass raised toward camera, dim bedroom, harsh phone flash from behind illuminating the scene" },
  { id: "np-17", category: "Sex", title: "Doggy low angle", summary: "Doggy from low rear angle.", promptFragment: "doggy style from a low rear angle, camera close to the mattress looking up, his cock deep inside her from behind, her inner thighs and pussy visible, back arched, hands braced on the bed, moaning expression, dim room, phone flash from low behind" },
  { id: "np-18", category: "Sex", title: "Cowgirl", summary: "Woman on top facing partner, hands on his chest.", promptFragment: "cowgirl position, she's on top straddling him and facing the camera, his average erect cock fully inside her, her hands pressed flat on his chest for balance, hips slightly raised mid-ride, flushed cheeks, biting lower lip, frontal phone flash, rumpled sheets" },
  { id: "np-19", category: "Sex", title: "Reverse cowgirl", summary: "Reverse cowgirl, arched back.", promptFragment: "reverse cowgirl, she's straddling him with her back to him and facing the camera, back arched, his cock visible between her legs as she rides, both hands on his thighs for balance, head tilted back, dim bedroom, harsh phone flash from the front" },
  { id: "np-20", category: "Sex", title: "Standing from behind", summary: "Bent over surface, standing sex from behind.", promptFragment: "standing sex from behind, she's bent over a low dresser with both hands flat on the surface, his cock penetrating her from behind while standing, side-angled framing showing depth, her head down and hair falling forward, dim bedroom light, phone flash" },
  { id: "np-21", category: "Sex", title: "Blowjob POV", summary: "Oral, POV, kneeling, eye contact.", promptFragment: "kneeling on a bedroom floor looking up at the camera, mouth on his average erect cock, one hand wrapped around the shaft, other hand on her thigh, direct eye contact with slightly parted eyes, messy hair, frontal phone flash from above" },
  { id: "np-22", category: "Sex", title: "Blowjob side", summary: "Side angle oral, depth implied.", promptFragment: "blowjob from a side angle, kneeling beside the bed, her mouth around his cock with lips visibly stretched around the shaft, one hand at the base, side framing showing depth, focused expression with eyes half-closed, dim room, phone flash from the side" },
  { id: "np-23", category: "Sex", title: "Deep oral framing", summary: "Explicit oral, deep framing.", promptFragment: "close-up oral sex, face-on framing, his cock filling her mouth, lips stretched around the shaft, both hands on his hips or thighs, watery eyes from depth, mascara slightly smeared, harsh frontal phone flash" },
  { id: "np-24", category: "Sex", title: "Sixty-nine", summary: "Overlapping bodies, mutual oral.", promptFragment: "sixty-nine position on a bed, she's on top facing down, his cock in her mouth and her pussy over his face, both engaged in mutual oral, overhead angle showing their intertwined bodies, messy sheets, dim room with a lamp nearby" },
  { id: "np-25", category: "Sex", title: "Prone bone", summary: "Lying flat, partner penetrating from above.", promptFragment: "prone bone position, she's lying completely flat on her stomach, his body on top, his cock penetrating her from behind, her arms stretched above her head gripping the sheets, head turned sideways with a strained expression, dim bedroom, phone flash from behind" },
  { id: "np-26", category: "Sex", title: "Spooning", summary: "Side spooning sex, intimate.", promptFragment: "spooning sex from a side angle, both lying on their sides facing the same direction, his cock inside her from behind, her top leg raised slightly, her arm draped over his forearm, intimate close framing, dim bedroom, soft lamp light behind them" },
  { id: "np-27", category: "Sex", title: "Anal doggy", summary: "Anal sex, doggy positioning.", promptFragment: "anal sex doggy style from directly behind, back arched low, his cock in her ass, both hands flat on the bed, head down with hair falling forward, explicit rear framing showing penetration, harsh phone flash from behind" },
  { id: "np-28", category: "Sex", title: "Anal side", summary: "Anal from side angle.", promptFragment: "anal sex from a side angle, she's lying on her side with one leg raised, his cock penetrating her ass from behind, her hand resting on her hip, side framing showing depth clearly, dim room, soft lamp behind them" },
  { id: "np-29", category: "Sex", title: "Legs over shoulders", summary: "Intense missionary variant, legs over shoulders.", promptFragment: "missionary with her legs draped over his shoulders, hips raised high, his cock deep inside her at a steep angle, explicit close framing showing penetration, her hands gripping the sheets above her head, strained expression, harsh frontal phone flash" },
  { id: "np-30", category: "Sex", title: "Standing carry", summary: "Lifted standing carry, passionate.", promptFragment: "standing sex, she's lifted with her legs wrapped around his waist, his cock inside her, her arms around his neck, he's supporting her from below, both upright against a bedroom wall or door, passionate expression, phone flash from the front" },
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
