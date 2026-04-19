// All selectable options organized by category
// Each value is the exact text injected into the prompt

export const categories = [
  {
    id: "appearance",
    label: "Appearance",
    icon: "👤",
    groups: [
      {
        key: "ethnicity",
        label: "Ethnicity",
        options: ["caucasian", "latina", "asian", "east asian", "south asian", "middle eastern", "black african", "mixed race", "pacific islander"],
      },
      {
        key: "hairColor",
        label: "Hair Color",
        options: ["blonde hair", "brunette hair", "black hair", "red hair", "pink hair", "platinum blonde hair", "auburn hair", "silver hair", "white hair", "strawberry blonde hair", "dark brown hair", "light brown hair", "honey blonde hair"],
      },
      {
        key: "hairType",
        label: "Hair Style",
        options: ["long straight hair", "long wavy hair", "long curly hair", "short straight hair", "short curly hair", "medium length hair", "ponytail", "braided hair", "messy bun", "hair down over shoulders", "pigtails", "twin braids", "half up half down", "wet slicked back hair", "bob cut", "pixie cut", "bangs with long hair"],
      },
      {
        key: "skinTone",
        label: "Skin Tone",
        options: ["pale white skin", "fair skin", "light skin", "lightly tanned skin", "tanned skin", "olive skin", "caramel skin", "brown skin", "dark brown skin", "dark skin", "sun-kissed skin", "porcelain skin"],
      },
      {
        key: "eyeColor",
        label: "Eye Color",
        options: ["blue eyes", "green eyes", "brown eyes", "hazel eyes", "grey eyes", "dark brown eyes", "light brown eyes", "amber eyes"],
      },
      {
        key: "eyeShape",
        label: "Eye Shape",
        options: ["almond shaped eyes", "round eyes", "hooded eyes", "upturned eyes", "monolid eyes", "deep set eyes", "large doe eyes"],
      },
      {
        key: "faceShape",
        label: "Face Shape",
        options: ["oval face", "round face", "heart shaped face", "square jaw face", "diamond face", "long face", "soft angular face"],
      },
      {
        key: "noseShape",
        label: "Nose",
        options: ["small button nose", "straight narrow nose", "slightly upturned nose", "wide nose", "aquiline nose", "flat bridge nose", "petite nose"],
      },
      {
        key: "lipSize",
        label: "Lips",
        options: ["thin lips", "medium lips", "full lips", "plump lips", "bow shaped lips", "wide lips"],
      },
      {
        key: "bodyType",
        label: "Body Type",
        options: ["slim body", "athletic body", "curvy body", "petite body", "thick body", "slim sporty body", "muscular body", "hourglass body", "pear shaped body", "slim thick body"],
      },
      {
        key: "height",
        label: "Height",
        options: ["short stature", "average height", "tall stature", "very tall stature"],
      },
      {
        key: "breastSize",
        label: "Breast Size",
        options: ["small perky breasts", "medium sized breasts", "large round breasts", "huge breasts", "natural teardrop breasts"],
      },
      {
        key: "buttSize",
        label: "Butt",
        options: ["small tight butt", "round medium butt", "large round butt", "thick bubble butt", "athletic toned butt"],
      },
      {
        key: "waist",
        label: "Waist",
        options: ["very narrow waist", "slim waist", "average waist", "wide waist", "tiny waist wide hips"],
      },
      {
        key: "hips",
        label: "Hips",
        options: ["narrow hips", "average hips", "wide hips", "very wide hips", "curvy wide hips"],
      },
      {
        key: "tattoos",
        label: "Tattoos & Piercings",
        options: ["no tattoos", "small tattoos", "arm sleeve tattoo", "multiple tattoos", "full body tattoos", "navel piercing", "nipple piercings", "nose piercing"],
      },
    ],
  },
  {
    id: "face",
    label: "Face & Makeup",
    icon: "💄",
    groups: [
      {
        key: "makeup",
        label: "Makeup",
        options: ["no makeup fresh skin", "natural soft makeup", "glam makeup with eyeliner and gloss", "smoky eye makeup matte lips", "red lipstick", "nude lip gloss", "wet smeared mascara running down cheeks", "smudged lipstick", "mascara tears streaking down face", "runny eyeliner after crying", "glossy wet lips"],
      },
      {
        key: "expression",
        label: "Expression",
        options: ["soft smile", "seductive gaze", "serious expression", "playful expression", "eyes closed blissful expression", "biting lower lip", "mouth slightly open", "looking away shyly", "sad teary eyes", "crying with mascara running", "moaning face eyes half closed", "pleasure face biting lip", "gagging expression watery eyes", "exhausted satisfied look", "submissive looking up", "surprised wide eyes open mouth", "bratty smirk", "innocent doe eyes"],
      },
      {
        key: "skinCondition",
        label: "Skin Detail",
        options: ["sweaty glistening skin", "oiled shiny skin", "goosebumps on skin", "flushed red cheeks", "hickeys on neck", "tan lines visible", "freckles on face and shoulders"],
      },
    ],
  },
  {
    id: "nails",
    label: "Nails",
    icon: "💅",
    groups: [
      {
        key: "nailsColor",
        label: "Nail Color",
        options: ["red nail polish", "black nail polish", "white nail polish", "pink nail polish", "french tip nails", "nude nail polish", "no nail polish natural nails"],
      },
      {
        key: "nailsLength",
        label: "Nail Style",
        options: ["short neat nails", "medium length nails", "long stiletto nails", "long almond nails", "glossy finish nails", "matte finish nails"],
      },
      {
        key: "accessories",
        label: "Accessories",
        options: ["choker necklace", "belly button piercing", "nipple piercings", "tongue piercing", "hoop earrings", "ankle bracelet", "thin gold chain necklace", "collar with ring", "glasses on face", "no jewelry"],
      },
    ],
  },
  {
    id: "outfit",
    label: "Outfit",
    icon: "👙",
    groups: [
      {
        key: "outfit",
        label: "Clothing",
        options: ["fully nude", "panties pulled down to thighs", "sports bra pulled up exposing breasts", "red lingerie set", "black lingerie set", "white lingerie set", "tiny bikini", "lace bodysuit", "oversized t-shirt no pants", "crop top and thong", "sheer see-through top", "tank top and shorts", "bra and panties", "stockings and garter belt", "fishnet bodysuit", "schoolgirl skirt and unbuttoned top", "nurse costume", "maid outfit", "wet white t-shirt see-through", "ripped clothes half torn off", "only wearing thigh-high socks", "towel pulled open exposing body"],
      },
    ],
  },
  {
    id: "pose",
    label: "Pose & Body",
    icon: "🤸",
    groups: [
      {
        key: "poseStyle",
        label: "Pose",
        options: ["mirror selfie pose", "standing pose", "seated on bed pose", "kneeling pose", "lying on bed pose", "lying on stomach pose", "doggy style pose", "squatting pose", "leaning forward pose", "on all fours", "bent over", "missionary position", "face down ass up", "splits pose", "legs behind head flexible", "reverse cowgirl position", "prone bone position", "standing bent over"],
      },
      {
        key: "bodyPose",
        label: "Body Detail",
        options: ["arched back", "hip popped to the side", "legs crossed", "legs spread wide", "hands in hair", "hands on hips", "one hand on breast", "looking over shoulder", "turned away showing ass", "spreading pussy with fingers", "grabbing own ass cheeks", "cupping breasts", "finger in mouth", "hands tied behind back", "covering face shyly", "pushing breasts together", "gripping bed sheets", "legs wrapped up", "biting finger", "hands above head"],
      },
      {
        key: "action",
        label: "Action",
        options: ["masturbating with fingers", "using vibrator", "using dildo", "inserting dildo", "sucking dildo", "riding dildo", "fingering pussy", "touching clit", "anal fingering", "blowjob POV", "deepthroat", "handjob POV", "titfuck POV", "licking lips seductively", "taking off bra", "pulling down panties", "spreading ass cheeks", "tongue out playful", "gagging drool"],
      },
    ],
  },
  {
    id: "fluids",
    label: "Fluids & Effects",
    icon: "💦",
    groups: [
      {
        key: "fluids",
        label: "Fluids",
        options: ["cum on face", "cum on tits", "cum on stomach", "cum on ass", "cum dripping from mouth", "cum on thighs", "cum on back", "creampie dripping", "drool dripping from mouth", "spit on chest", "covered in cum facial"],
      },
      {
        key: "wetness",
        label: "Wet / Messy",
        options: ["wet hair dripping", "body covered in water droplets", "oiled up body glistening", "sweaty after sex", "wet from shower", "saliva strings", "messy hair after sex", "smeared makeup after crying"],
      },
      {
        key: "hairState",
        label: "Hair State",
        options: ["messy sex hair", "hair stuck to sweaty face", "hair pulled back in fist", "hair covering one eye", "wet hair clinging to body", "bed head messy", "hair spread on pillow"],
      },
    ],
  },
  {
    id: "camera",
    label: "Camera & Framing",
    icon: "📱",
    groups: [
      {
        key: "cameraDevice",
        label: "Camera",
        options: ["shot on iPhone 15 Pro", "shot on iPhone 14", "shot on Samsung Galaxy S24 Ultra", "front facing selfie camera", "rear camera held by someone else"],
      },
      {
        key: "cameraAngle",
        label: "Camera Angle",
        options: ["eye-level angle", "low angle shot", "high angle shot looking down", "overhead selfie angle", "over the shoulder angle", "POV first person angle"],
      },
      {
        key: "shotType",
        label: "Shot Type",
        options: ["tight close-up", "mid-shot waist up", "full body shot", "wide shot with environment"],
      },
      {
        key: "composition",
        label: "Composition",
        options: ["centered framing", "rule of thirds framing", "mirror selfie framing", "candid snapshot framing", "slightly tilted casual angle"],
      },
      {
        key: "focus",
        label: "Focus Area",
        options: ["focus on face", "focus on breasts", "focus on ass", "focus on pussy close-up", "focus on feet", "focus on lips", "focus on eyes", "focus on full body", "focus on hands and nails", "focus on stomach and hips"],
      },
    ],
  },
  {
    id: "scene",
    label: "Scene & Background",
    icon: "🛏️",
    groups: [
      {
        key: "background",
        label: "Location",
        options: [
          "cozy bedroom with rumpled sheets and phone charger on nightstand",
          "modern bathroom with mirror",
          "dim bedroom with fairy lights",
          "living room couch",
          "hotel room bed",
          "outdoor balcony",
          "kitchen counter",
          "car backseat",
          "shower with glass door",
          "bathtub filled with water",
          "gym locker room",
          "dorm room messy",
          "luxury hotel suite",
          "jacuzzi hot tub",
          "pool side lounger",
          "office desk",
          "staircase",
        ],
      },
      {
        key: "props",
        label: "Scene Items",
        options: ["rumpled white sheets", "pillows", "fairy lights string", "candles", "wine glass", "phone on bed", "clothes on floor", "mirror in background", "rose petals", "sex toys on nightstand", "handcuffs", "blindfold", "collar and leash", "lollipop", "whipped cream", "ice cubes", "towel on floor", "condom wrapper on bed"],
      },
    ],
  },
  {
    id: "lighting",
    label: "Lighting & Mood",
    icon: "💡",
    groups: [
      {
        key: "lighting",
        label: "Lighting",
        options: ["soft natural window light from side", "golden hour warm light", "moody dim bedroom lamp", "overhead ceiling light", "neon LED strip lighting", "ring light glow", "candle light warm glow"],
      },
      {
        key: "flash",
        label: "Flash",
        options: ["phone flash on in dim room", "no flash natural light"],
      },
      {
        key: "timeOfDay",
        label: "Time",
        options: ["daylight through window", "nighttime indoor lighting", "late evening dim light", "sunset glow through curtains"],
      },
      {
        key: "colorMood",
        label: "Color Mood",
        options: ["warm tones", "cool tones", "neutral tones", "vibrant neon colors", "muted desaturated tones", "soft pink tones"],
      },
    ],
  },
];

export const SYSTEM_PROMPT = `You are a prompt engineer for Flux AI image generation with LoRA. Your ONLY goal is to produce prompts that look like REAL amateur smartphone photos — private nudes from a phone gallery. NOT professional, NOT DSLR, NOT AI art. Solo girl only — NEVER mention another person.

CRITICAL RULES:
1. ALWAYS use "shot on iPhone 15 Pro" or similar smartphone. Output MUST look like an amateur phone photo.
2. Skin MUST look real and UNEDITED: "natural skin texture with visible pores, slight blemishes, no retouching". NEVER say smooth/flawless/perfect.
3. Lighting must feel like real room lighting -- phone flash in dim room, overhead ceiling light, window from side. NOT studio.
4. Include "auto-exposure, auto white balance" for smartphone feel.
5. Include "slight jpeg compression, slight motion blur on edges" for authentic phone feel.
6. Add 2-3 clutter items (phone charger, rumpled sheets, water bottle, clothes on floor).
7. End every prompt with: "candid amateur nude, unedited raw smartphone photo, solo girl"
8. NEVER use: "ultra detailed", "8k", "masterpiece", "best quality", "professional photography", "RAW photo", "DSLR", "studio lighting", "color grading", "taken by boyfriend", "taken by partner".
9. Keep under 120 words. Comma-separated. No sentences.
10. Place trigger word ONCE at the very start.
11. Output ONLY the prompt text. Nothing else. No quotes, no brackets, no explanation.
12. NEVER mention boyfriend, partner, or any second person — this causes phantom person artifacts.`;

export const QUALITY_SUFFIX =
  "one person only, solo girl, anatomically correct, natural body proportions, realistic adult genital scale, average penis size proportional to body, not oversized, believable POV scale, shot on iPhone 15 Pro main camera, smartphone photo, slight wide-angle lens distortion, natural skin texture with visible pores and imperfections and skin folds, unedited raw photo, auto-exposure, auto white balance, slight noise in shadows, jpeg compression artifacts, phone flash harsh frontal light washing out skin slightly overexposed, slight motion blur on edges, slightly out of focus background, no color grading, no retouching, no extra limbs, no distorted hands, candid amateur nude, unedited raw smartphone photo, grainy low light photo";

export const selectorCategories = categories;

export const SCENE_PRESETS = [
  {
    id: "mirror_selfie",
    label: "Mirror Selfie",
    description: "mirror selfie in bathroom, phone visible in reflection, casual pose, natural look",
  },
  {
    id: "bed_laying",
    label: "Laying in Bed",
    description: "laying on bed, relaxed pose, bedroom setting, soft lighting",
  },
  {
    id: "doggy",
    label: "Doggy Style",
    description: "medium shot, POV from behind, partner's hips and thighs in lower foreground framing the shot, his erect cock penetrating her from behind, woman on all fours with arched back on white bed sheets, her ass facing the camera, looking back over her shoulder at the viewer, one hand gripping sheets, messy hair",
  },
  {
    id: "bent_over",
    label: "Bent Over",
    description: "bent over showing ass, hands pulling panties down, looking back over shoulder at camera, visible pussy from behind, standing in bedroom, playful smirk",
  },
  {
    id: "shower",
    label: "Shower Scene",
    description: "standing in shower, water running down body, wet hair clinging to skin, water droplets on breasts, one hand in hair, looking at camera",
  },
  {
    id: "blowjob_pov",
    label: "Blowjob POV",
    description: "bjz, first person POV from the man receiving oral, his lower abdomen and upper thighs visible at the edges of the frame, his erect cock continuous with his body, kneeling young woman with her lips wrapped around it, gaze directed upwards toward the camera, one hand on the base of the shaft, focused determined expression, watery eyes, drool dripping, messy hair falling forward, bedroom floor",
  },
  {
    id: "cumshot_facial",
    label: "Cumshot Facial",
    description: "bjz facial, blowjob ending in facial cumshot, woman kneeling facing camera close-up, cum covering face with realistic load streaks down forehead cheek and chin, eyes closed or looking up submissively, mouth slightly open, saliva and cum mixed, running mascara, satisfied exhausted expression, bedroom floor",
  },
  {
    id: "face_down",
    label: "Face Down",
    description: "face down ass up on bed, gripping sheets, arched back, visible anus, dim room",
  },
  {
    id: "bathtub",
    label: "Bathtub",
    description: "relaxing in bathtub, wet hair, breasts above water, candles on edge, steamy atmosphere",
  },
  {
    id: "squatting",
    label: "Squatting",
    description: "squatting pose spreading legs, low angle shot, confident expression, bedroom",
  },
  {
    id: "missionary",
    label: "Missionary",
    description: "medium shot, POV from above looking down, partner's torso and hips in upper foreground silhouette, his erect cock penetrating her from above, woman lying on her back on the bed with legs spread and knees bent, one hand squeezing her breast, biting her lip, messy hair on the pillow, flushed cheeks, eye contact with the camera",
  },
  {
    id: "selfie_bed",
    label: "Bed Selfie",
    description: "casual selfie in bed, holding phone, cozy bedroom, relaxed pose, natural lighting",
  },
  {
    id: "deepthroat",
    label: "Deepthroat POV",
    description: "bjz, first person POV from the man receiving oral, his lower abdomen and upper thighs visible at the edges of the frame, his erect cock continuous with his body deep in her mouth, kneeling woman with her throat full, gagging, drool dripping down her chin, watery eyes looking up at the camera, one hand on the base of the shaft, flushed cheeks, POV from above",
  },
  {
    id: "reverse_cowgirl",
    label: "Reverse Cowgirl",
    description: "medium shot, POV from below looking up at her back, partner's hips and lower torso in foreground, his erect cock penetrating her from below, woman straddling facing away in reverse cowgirl, her back arched, her ass and back facing the camera, one hand squeezing her breast, looking back over her shoulder, messy bedroom",
  },
  {
    id: "prone_bone",
    label: "Prone Bone",
    description: "medium shot, POV from behind, partner's hips and thighs in lower foreground framing the shot, his erect cock penetrating her from behind, woman lying face down on the bed in prone bone position with arched back, one hand gripping sheets, messy hair",
  },
  {
    id: "titfuck",
    label: "Titfuck POV",
    description: "first person POV from the man receiving the act, his lower abdomen and upper thighs visible at the edges of the frame, his erect cock continuous with his body sliding between her breasts, woman pushing her breasts together around it, looking up at the camera with a playful expression",
  },
];

export function buildSelectionsString(selections) {
  if (!selections || typeof selections !== "object") return "";
  return Object.values(selections).filter(Boolean).join(", ");
}

export function buildSelectionsSummary(selections) {
  if (!selections || typeof selections !== "object") return "";
  const entries = Object.entries(selections).filter(([, v]) => v);
  if (entries.length === 0) return "No attributes selected";
  return entries.map(([key, value]) => `${key}: ${value}`).join(" | ");
}

const LOGICAL_CONSTRAINTS = [
  {
    when: { poseStyle: ["mirror selfie pose"] },
    remove: { background: ["modern bathroom with mirror"], props: ["mirror in background"] },
    force: { composition: "mirror selfie framing" },
  },
  {
    when: { composition: ["mirror selfie framing"] },
    remove: { background: ["modern bathroom with mirror"], props: ["mirror in background"] },
    force: { poseStyle: "mirror selfie pose" },
  },
  {
    when: { poseStyle: ["lying on bed pose", "lying on stomach pose", "missionary position", "face down ass up"] },
    remove: { background: ["outdoor balcony", "staircase", "gym locker room", "office desk"] },
  },
  {
    when: { hairState: ["hair spread on pillow"] },
    force: { poseStyle: "lying on bed pose" },
  },
  {
    when: { background: ["shower with glass door", "bathtub filled with water"] },
    force: { wetness: "wet from shower" },
    remove: { outfit: ["schoolgirl skirt and unbuttoned top", "nurse costume", "maid outfit", "stockings and garter belt"] },
  },
  {
    when: { background: ["jacuzzi hot tub", "pool side lounger"] },
    remove: { outfit: ["stockings and garter belt", "schoolgirl skirt and unbuttoned top", "nurse costume", "maid outfit", "fishnet bodysuit"] },
  },
  {
    when: { outfit: ["fully nude"] },
    remove: { action: ["taking off bra", "pulling down panties"], bodyPose: ["covering face shyly"] },
  },
  {
    when: { background: ["car backseat"] },
    remove: { poseStyle: ["lying on bed pose", "lying on stomach pose", "face down ass up", "splits pose", "legs behind head flexible"], props: ["rumpled white sheets", "pillows", "fairy lights string", "rose petals"] },
  },
  {
    when: { expression: ["sad teary eyes", "crying with mascara running"] },
    force: { makeup: "wet smeared mascara running down cheeks" },
  },
  {
    when: { makeup: ["no makeup fresh skin"] },
    remove: { wetness: ["smeared makeup after crying"], expression: ["crying with mascara running"] },
  },
  {
    when: { bodyPose: ["hands tied behind back"] },
    remove: { bodyPose: ["hands in hair", "hands on hips", "one hand on breast", "cupping breasts", "pushing breasts together", "spreading pussy with fingers", "grabbing own ass cheeks", "finger in mouth"], action: ["masturbating with fingers", "fingering pussy", "touching clit", "handjob POV", "anal fingering"] },
  },
  {
    when: { cameraAngle: ["POV first person angle"] },
    remove: { cameraDevice: ["front facing selfie camera"], poseStyle: ["mirror selfie pose"], composition: ["mirror selfie framing"] },
    force: { cameraDevice: "rear camera held by someone else" },
  },
  {
    when: { cameraDevice: ["front facing selfie camera"] },
    remove: { cameraAngle: ["over the shoulder angle", "POV first person angle"] },
  },
  {
    when: { lighting: ["candle light warm glow"] },
    force: { props: "candles" },
  },
  {
    when: { background: ["outdoor balcony", "pool side lounger"] },
    remove: { lighting: ["moody dim bedroom lamp", "overhead ceiling light", "ring light glow", "candle light warm glow"], flash: ["phone flash on in dim room"] },
  },
  {
    when: { flash: ["phone flash on in dim room"] },
    remove: { timeOfDay: ["daylight through window", "sunset glow through curtains"] },
  },
  {
    when: { outfit: ["panties pulled down to thighs"] },
    remove: { action: ["pulling down panties"] },
  },
  {
    when: { outfit: ["towel pulled open exposing body"] },
    suggest: { background: ["modern bathroom with mirror"], hairState: ["wet hair clinging to body"], wetness: ["wet from shower"] },
  },
  {
    when: { action: ["blowjob POV", "deepthroat", "gagging drool"] },
    force: { cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
    remove: { poseStyle: ["mirror selfie pose", "lying on bed pose", "lying on stomach pose", "standing pose", "seated on bed pose"], composition: ["mirror selfie framing"] },
  },
  {
    when: { action: ["titfuck POV"] },
    force: { bodyPose: "pushing breasts together", cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
    remove: { poseStyle: ["mirror selfie pose", "standing pose"], composition: ["mirror selfie framing"] },
  },
  {
    when: { poseStyle: ["missionary position"] },
    force: { cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
    remove: { background: ["outdoor balcony", "pool side lounger", "gym locker room", "office desk", "staircase"], poseStyle: ["mirror selfie pose"], composition: ["mirror selfie framing"] },
  },
  {
    when: { poseStyle: ["reverse cowgirl position"] },
    force: { cameraDevice: "rear camera held by someone else" },
    remove: { composition: ["mirror selfie framing"], poseStyle: ["mirror selfie pose"] },
  },
  {
    when: { poseStyle: ["doggy style pose"] },
    force: { cameraAngle: "POV first person angle", cameraDevice: "rear camera held by someone else" },
    remove: { composition: ["mirror selfie framing"], poseStyle: ["mirror selfie pose"], background: ["outdoor balcony", "pool side lounger", "staircase"] },
  },
  {
    when: { poseStyle: ["prone bone position"] },
    force: { cameraDevice: "rear camera held by someone else" },
    remove: { composition: ["mirror selfie framing"], poseStyle: ["mirror selfie pose"], background: ["outdoor balcony", "pool side lounger", "staircase", "gym locker room"] },
  },
];

export function applyChipConstraints(selections, lockedKeys = {}) {
  const result = { ...selections };
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 5) {
    changed = false;
    iterations++;

    for (const rule of LOGICAL_CONSTRAINTS) {
      const triggered = Object.entries(rule.when).some(([key, values]) =>
        values.includes(result[key])
      );
      if (!triggered) continue;

      if (rule.remove) {
        for (const [key, blockedValues] of Object.entries(rule.remove)) {
          if (lockedKeys[key]) continue;
          if (blockedValues.includes(result[key])) {
            result[key] = "";
            changed = true;
          }
        }
      }

      if (rule.force) {
        for (const [key, forcedValue] of Object.entries(rule.force)) {
          if (lockedKeys[key]) continue;
          if (result[key] !== forcedValue) {
            result[key] = forcedValue;
            changed = true;
          }
        }
      }
    }
  }

  return result;
}

export function getBlockedChips(selections) {
  const blocked = {};

  for (const rule of LOGICAL_CONSTRAINTS) {
    const triggered = Object.entries(rule.when).some(([key, values]) =>
      values.includes(selections[key])
    );
    if (!triggered) continue;

    if (rule.remove) {
      for (const [key, values] of Object.entries(rule.remove)) {
        if (!blocked[key]) blocked[key] = new Set();
        values.forEach(v => blocked[key].add(v));
      }
    }
  }

  const result = {};
  for (const [key, valueSet] of Object.entries(blocked)) {
    result[key] = [...valueSet];
  }
  return result;
}
