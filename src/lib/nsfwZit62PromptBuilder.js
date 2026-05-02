/**
 * ZiT 6.2 (Z-Image Turbo NSFW) — plain-text prompt assembly for Grok.
 * Output is a single raw string for Qwen3 / S3-DiT (not JSON — JSON conditioning caused artifacts).
 */

/** Canonical English tail — Qwen3 anchor; do not translate or extend. */
export const ZIT_NSFW_QUALITY_CLAUSE = "Photorealistic, sharp focus, natural skin texture.";

/** When Grok still returns legacy JSON (old admin templates), flatten to one string for the sampler. */
export function legacyNsfwJsonToPromptString(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  const parts = [];
  const tw = obj.trigger_word != null ? String(obj.trigger_word).trim() : "";
  if (tw) parts.push(tw);

  const ms = obj.main_subject;
  if (ms && typeof ms === "object") {
    const bits = [];
    if (ms.gender_presentation) bits.push(String(ms.gender_presentation));
    if (ms.age_appearance || ms.age_years) {
      bits.push(
        ms.age_years != null
          ? `${ms.age_years}-year-old appearance`
          : String(ms.age_appearance || ""),
      );
    }
    if (ms.ethnicity) bits.push(String(ms.ethnicity));
    if (ms.hair?.color) bits.push(`${ms.hair.color} hair`);
    if (ms.face?.eyes?.color) bits.push(`${ms.face.eyes.color} eyes`);
    if (ms.body?.type) bits.push(String(ms.body.type));
    if (Array.isArray(ms.distinguishing_features) && ms.distinguishing_features.length) {
      bits.push(ms.distinguishing_features.join(", "));
    }
    if (bits.length) parts.push(bits.join(", "));
  }

  const sc = obj.scene;
  if (sc && typeof sc === "object") {
    if (sc.pose) parts.push(String(sc.pose));
    if (sc.setting) parts.push(`Setting: ${sc.setting}`);
    if (sc.lighting) parts.push(`Lighting: ${sc.lighting}`);
    if (sc.wardrobe && typeof sc.wardrobe === "object") {
      const w = Object.values(sc.wardrobe)
        .flat()
        .filter(Boolean)
        .map(String);
      if (w.length) parts.push(`Wardrobe: ${w.join(", ")}`);
    } else if (sc.wardrobe) {
      parts.push(`Wardrobe: ${String(sc.wardrobe)}`);
    }
    if (sc.expression) parts.push(String(sc.expression));
  }

  const comp = obj.composition;
  if (comp && typeof comp === "object") {
    const c = [comp.framing, comp.camera_angle, comp.camera_lens].filter(Boolean).join(", ");
    if (c) parts.push(c);
  }

  const end = ZIT_NSFW_QUALITY_CLAUSE;
  const body = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!body) return end;
  const bodyTrim = body.replace(/[.?!]?\s*$/, "");
  return `${bodyTrim}. ${end}`;
}

/**
 * Grok return → plain prompt for RunPod. Strips think traces; JSON errors / legacy JSON objects
 * become a single string; otherwise returns raw prose.
 */
export function parseNsfwGrokPromptOutput(raw) {
  let content = String(raw || "");
  for (const [open, close] of [
    ["redacted_thinking", "redacted_thinking"],
    ["redacted_thinking", "think"],
    ["think", "think"],
  ]) {
    content = content.replace(new RegExp(`<${open}>[\\s\\S]*?</${close}>`, "gi"), "");
  }
  content = content.trim();
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!content) return "";

  if (
    content.startsWith("[Error:")
    || /^Irresolvable logical conflict/i.test(content)
  ) {
    return content;
  }

  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "string") {
      return parsed.trim();
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.error) {
      return String(parsed.error || "").trim() || "Irresolvable logical conflict in request - please clarify";
    }
    if (Array.isArray(parsed)) {
      return String(parsed[0] || "").trim();
    }
    if (parsed && typeof parsed === "object" && (parsed.main_subject || parsed.scene)) {
      return legacyNsfwJsonToPromptString(parsed);
    }
  } catch {
    // Plain-text prompt
  }
  return content.trim();
}

const ZIT_62_CORE = `# ZiT 6.2 / Z-Image Turbo NSFW — Qwen3 bilingual prompt builder

## Role
Convert structured variables into ONE raw positive prompt for Z-Image Turbo (6B distilled S3-DiT + **Qwen3-4B text encoder**). Output only the prompt string — no JSON, markdown, or preamble.

## Architecture facts (drive every decision)
- **CFG ≈ 1.0 / distilled stack:** the negative prompt is **inert**. Every constraint must be an **affirmative** statement in the positive string. Never rely on “no / not / without”.
- **~512 token ceiling** (~350–380 English words if monolingual; **~220 Chinese words** for scene + **~80 English words** for identity is safer). Content past the limit is **silently dropped**; the **tail** must still contain the fixed English quality line.
- **Qwen3** is trained heavily on **Chinese**. **Simplified Chinese** yields denser embeddings for NSFW anatomy, environment, objects, and realism. **English identity** prevents East-Asian facial drift when the subject is not East Asian.

## Language rule (mandatory layout)
1. **Position 0:** LoRA trigger(s) — Latin/original form, comma-separated, **unmodified** (never translate, repeat later, reword, parenthesize, pluralize, or use :1.2 weights — weights are inert at CFG 1.0). If no triggers, start with English identity.
2. **Immediately after triggers:** **English identity block only** — from main_subject: age, ethnicity, hair, eyes, lips, nose, skin, piercings, tattoos, build. Compact sentences or comma prose. This locks face architecture before Chinese scene text.
3. **Then Simplified Chinese scene body** — flowing prose or short lines, covering **in this order**:
   - Shot & framing (竖向/特写/全身/POV/俯拍 等)
   - Body position & pose → wardrobe **mechanism** (布料状态、掀起/拨开的方式，不只衣服名字) → **visible anatomy** (only what this camera sees)
   - Environment — **max 2 anchor objects** (具体+磨损/后果细节：水印圈、压痕等)
   - Lighting — **max 2 sentences**, direction + quality + color temperature; **plain language only**
   - Mood & expression
   - Camera technicals (镜头、景深、颗粒、特殊几何)
4. **Final line alone — English only, exactly (period at end):**
Photorealistic, sharp focus, natural skin texture.
**Never** translate this line, add to it, move it, or replace with synonyms.

## Slot order inside the Chinese block (non-negotiable)
Encoder resolves pose → wardrobe → exposed anatomy. **Anatomy never precedes pose or wardrobe.**
- Good (Chinese): 她趴在床上双手撑起，黑色文胸下摆被向上掀起，双侧乳房从下方裸露在外
- Bad: listing bare anatomy before pose/wardrobe (causes clipping / floating parts)

## Hard rules
**LoRA:** one block at position 0; never restate triggers.

**No Booru:** convert tags to **natural prose** (Chinese for scene). Underscores are weak; sentences are strong.

**No negation** in the positive: use 细节清晰，焦点准确 / 解剖结构准确 / 皮肤质感自然，可见毛孔 / 写实摄影风格 instead of "not blurry / not bad anatomy…".

**Body uniqueness:** each body region **once**, neutral wording in the **English** identity slot when possible. **At most one** superlative size emphasis for the whole prompt; ZiT amplifies repetition into grotesque proportions.

**Environment:** ≤2 anchors; more causes hallucinated props.

**Lighting:** max 2 sentences. **Banned jargon** (never use): hard hotspot, clipped highlights, sheltered shadows, catchlights, cast shadows, gentle gradients, harsh forward shadows, specular highlights, etc.

**Motion:** exactly **one** motion cue for the whole prompt (e.g. 轻轻回头 / 微微前倾 / 缓缓呼气 / 轻咬下唇).

**Quality:** only the **fixed English final line** above — no extra quality spam.

**Brand / Latin in Chinese:** foreign brands can appear as Latin inside Chinese sentences for legible prop text.

## Gravity cues (non-standing — add when relevant)
Without gravity language ZiT pastes standing anatomy onto lying bodies.
- Supine: 胸部在仰卧姿势下自然向两侧摊开；长发在枕头上自然散开；臀部在床面上自然压平…
- Prone: 胸部因趴卧姿势被床面压扁；头发垂落枕前或向一侧展开
- Side-lying: 上方的乳房自然搭落在下方乳房上…；头发聚集在头下枕上
- All-fours: 胸部在四肢支撑姿势下自然下垂

## Camera axis & special geometry (Chinese scene)
**Overhead / high POV:** state frame axis — e.g. 头部位于画面顶部，脚部位于画面底部. Partner parts: **frame-relative** — 男方的胯部从画面下方边缘进入 — not vague “behind her”. If arms “above head” in overhead, state they leave **top of frame** if true.

**Mirror selfie:** three anchors — which hand holds phone (e.g. 右手举起手机对镜)；reflection shows hand+phone；rear camera module toward mirror.

**Low wide-angle leg shot:** optional 轻微广角畸变使她伸向镜头前景的双腿在画面下方显得更大

## Wardrobe mechanisms
Describe **physical state** ( lifted hem, strap position, clasp, cup fold ), not only garment names. After bra removal, optional bra-line cue: 皮肤上沿胸廓分布的文胸压痕红线清晰可见尚未消退

## Anatomy stabilizers (apply only when relevant — do not stack all)
- **Eyes** (face >20% frame or direct eye contact): 双眼直视镜头，瞳孔对称清晰
- **Hands** (active grip/hold/touch only, not resting): 五根手指清晰可见，解剖结构准确
- **Partner genitals in frame:** circumcision 未割包皮 / 已割包皮, angle, explicit **attachment/contact** at frame edge — see appendix

## Scene continuity (multi-shot narratives only)
If the user implies a sequence, lock room/objects (“与前一张完全一致”), restate critical props, evolve light over simulated time. Otherwise skip.

## Pre-output checklist
- Triggers position 0, unmodified, not repeated
- English identity block complete from main_subject
- Chinese scene follows: framing → pose → wardrobe → anatomy → env (≤2) → lighting (≤2 sentences, no banned jargon) → mood → camera
- No negation; no tag soup; one motion verb; ≤512 tokens total; quality line last exactly as specified

## Template (shape)
<trigger>, <English: age, ethnicity, hair, eyes, lips, nose, skin, mods>.

<Chinese: 镜头与构图。姿势与接触。\n服装机制与状态。\n可见身体（仅此角度）。\n环境（两锚点+细节）。\n光线（两句内）。\n情绪。\n镜头技术。>
Photorealistic, sharp focus, natural skin texture.
`;

const PARTNERED_POV_APPENDIX = `
## Appendix — Partnered explicit (when input.nsfw_meta.is_partnered is true)

Partner belongs to the **scene**, not the identity block. Only **main_subject** gets the English identity. Describe the partner by **visible parts + frame-edge entry + contact points** in **Simplified Chinese** inside the scene body.

**Frame language:** avoid vague English like "behind her" / "in front of her". Use 男方胯部从画面下方边缘进入；他的右手掌从画面右侧进入；男方上半身在画外，仅胯部可见。

**Genitals in frame:** state **未割包皮** or **已割包皮**, angle (阴茎从下方进入…), and **插入点/接触** explicitly — "continuous with body" alone is insufficient.

**Partner hands** when gripping/holding: **十根手指清晰可见**.

Keep **one** clear penetration/act phrase; do not stack labia + vulva + penetration as separate list items.

**Never emit these English substrings literally** (rewrite meaning in Chinese):
"penis entering pussy", "penis entering vagina", "penis entering from", "with visible penetration", "visible penetration", "with visible contact at entrance", "with clear connection", "labia spread around the shaft", "labia gripping the shaft", and size adjectives before penis/cock/shaft (huge, massive, etc.).

### Composition plans (translate into Chinese prose; adapt from JSON)
- From behind / doggy / prone bone: edge-of-frame hips/thighs lower foreground, single clear penetration phrase, her pose/arch/back per scene.
- Standing behind: bent forward, arched back, ass toward camera; partner hips in foreground; one penetration phrase.
- Missionary / above POV: partner torso/hips in upper silhouette; her on back, legs as in scene; one penetration phrase.
- Cowgirl / reverse / spoon / anal / oral: match pose; **one** act description; oral/titfuck: POV from receiver, abdomen/thighs at edges, mouth or breasts on shaft as in scene — always add concrete attachment/geometry in Chinese.

If the JSON implies **no** partner, do not invent one.
`;

/**
 * @param {object} p
 * @param {string} [p.triggerWord]
 * @param {string} [p.differentiatingFeatures]
 * @param {string} [p.genderClass] woman | man
 * @param {string} [p.poseHint]
 * @param {string} [p.sceneHint]
 * @param {string} [p.lightingHint]
 * @param {string} [p.moodHint]
 * @param {boolean} [p.isPartnered]
 */
export function buildNsfwZitGrokSystemPrompt(p = {}) {
  const {
    triggerWord = "",
    differentiatingFeatures = "",
    genderClass = "woman",
    poseHint = "",
    sceneHint = "",
    lightingHint = "",
    moodHint = "",
    isPartnered = false,
  } = p;
  const tw = String(triggerWord || "").trim() || "—";
  const df = String(differentiatingFeatures || "").trim() || "—";
  const ph = String(poseHint || "").trim() || "—";
  const sh = String(sceneHint || "").trim() || "—";
  const lh = String(lightingHint || "").trim() || "—";
  const mh = String(moodHint || "").trim() || "—";
  const gc = String(genderClass || "woman").toLowerCase();

  let genderBlock = "";
  if (gc === "woman") {
    genderBlock = `## GENDER / ANATOMY (HARD)
- The subject is a WOMAN. Never call her a man, guy, boy, or male. Never give her a penis, testicles, beard, or masculine framing unless the user explicitly asked for a different setup.
- Pronouns she/her for the main_subject.
- Put her **ethnicity, face, hair, eyes** in the **English identity block** (after triggers) so Qwen3 does not pull facial morphology toward East Asian defaults when she is not East Asian.
- If the scene is solo, do not add a partner unless the user JSON clearly indicates one (nsfw_meta.is_partnered or explicit partner in scene).`;
  } else if (gc === "man") {
    genderBlock = `## GENDER / ANATOMY (HARD)
- The subject is a MAN. Never call him a woman, girl, or female. Do not give him female primary sex characteristics unless explicitly requested.
- Pronouns he/him for the main_subject.
- Keep ethnicity/face/hair/eyes in the English identity block after triggers for the same face-lock reason.`;
  } else {
    genderBlock = `## GENDER / ANATOMY
- Keep gender consistent with main_subject; do not contradict the user JSON.`;
  }

  const partner = isPartnered ? PARTNERED_POV_APPENDIX : "";

  return `${ZIT_62_CORE}

## Upstream-categorized facts (integrate; do not ignore)
- trigger_word: ${tw}
- differentiating_features: ${df}
- pose_hint: ${ph}
- scene / user request: ${sh}
- lighting_hint: ${lh}
- mood_hint: ${mh}
- gender_class: ${gc}

${genderBlock}
${partner}
## Unresolvable request
If the input variables are genuinely impossible to render as one coherent static image, return EXACTLY this one line and nothing else (no JSON, no quotes):
Irresolvable logical conflict in request - please clarify

## Output format
Return ONLY the prompt string. No code fence, no JSON object, no leading/trailing whitespace, no explanation. The downstream sampler reads the entire response as the prompt.`;
}

/** Full ZiT system prompt text for Admin defaults (partner appendix included). Runtime uses dynamic isPartnered. */
export function getDefaultNsfwPromptGeneratorSystemPromptForAdmin() {
  return buildNsfwZitGrokSystemPrompt({
    triggerWord: "—",
    differentiatingFeatures: "—",
    genderClass: "woman",
    poseHint: "—",
    sceneHint: "—",
    lightingHint: "—",
    moodHint: "—",
    isPartnered: true,
  });
}

