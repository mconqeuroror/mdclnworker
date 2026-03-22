# AI Models, Modes, and System Prompts

This document is the in-depth map of:

- Which AI model is used for each mode/use case.
- Which provider serves it.
- Which system prompt template is used (including dynamic placeholders).
- Where in code each prompt/model call lives.

## Quick answer

- NSFW video currently uses `wavespeed-ai/wan-2.2-spicy/image-to-video` (and `video-extend`) via WaveSpeed.

---

## 1) Model/Provider Matrix (All Major Flows)

| Flow | Mode / Feature | Model / Endpoint | Provider | Source |
|---|---|---|---|---|
| Prompt enhancement | `casual` | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/routes/api.routes.js` |
| Prompt enhancement | `ultra-realism` | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/routes/api.routes.js` |
| Prompt enhancement | `nsfw` | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/routes/api.routes.js` |
| Creator Studio image generation | NanoBanana | `nano-banana-pro`, `nano-banana-2` | KIE.AI | `src/services/kie.service.js` |
| Image edit / identity edit | Seedream | `seedream/4.5-edit` | KIE.AI | `src/services/kie.service.js` |
| Image edit / identity edit (alt path) | Seedream | `bytedance/seedream-v4.5/edit` | WaveSpeed | `src/services/wavespeed.service.js` |
| NSFW image generation | ComfyUI NSFW workflow (Illustrious checkpoint) | RunPod endpoint workflow | RunPod | `src/controllers/nsfw.controller.js`, `src/services/fal.service.js` |
| NSFW video generation | i2v | `wavespeed-ai/wan-2.2-spicy/image-to-video` | WaveSpeed | `src/services/wavespeed.service.js` |
| NSFW video extend | extend | `wavespeed-ai/wan-2.2-spicy/video-extend` | WaveSpeed | `src/services/wavespeed.service.js` |
| Motion recreate | std/ultra job type | `kling-2.6/motion-control`, `kling-3.0/motion-control` | KIE.AI | `src/services/kie.service.js` |
| Motion recreate params | quality mode | `input.mode: "pro"` | KIE.AI | `src/services/kie.service.js` |
| LoRA training | training pipeline | `fal-ai/z-image-turbo-trainer-v2` | fal.ai | `src/services/fal.service.js` |
| LoRA captioning helper | dataset captions | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/services/fal.service.js` |
| LoRA auto-assign helper | pose/additive LoRA selection | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/services/fal.service.js` |
| Looks auto-detect | model looks extraction | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/routes/api.routes.js` |
| Physical profile analysis | LoRA look profiling | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/controllers/nsfw.controller.js` |
| Scene selector auto-pick | chip auto-selection | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/controllers/nsfw.controller.js` |
| LoRA strength helper | face visibility strength | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/controllers/nsfw.controller.js` |
| Img2img prompt injection | identity swap rewrite | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/services/img2img.service.js` |
| Image scene describer | identity recreation prep | `x-ai/grok-4.1-fast` | OpenRouter/xAI | `src/controllers/generation.controller.js` |
| Talking head | image+audio -> speaking video | `kwaivgi/kling-v2-ai-avatar-standard` | WaveSpeed | `src/services/wavespeed.service.js` |
| Face swap (video) | swap | `wavespeed-ai/video-face-swap` | WaveSpeed | `src/services/wavespeed.service.js` |
| Face swap (image) | swap | `wavespeed-ai/image-face-swap` | WaveSpeed | `src/services/wavespeed.service.js` |
| Real avatars | avatar create/video | HeyGen Photo Avatar IV APIs | HeyGen | `src/services/heygen.service.js`, `src/routes/avatar.routes.js` |
| Avatar voice/TTS | voice synthesis | ElevenLabs APIs | ElevenLabs | `src/services/elevenlabs.service.js`, `src/routes/avatar.routes.js` |

---

## 2) Mode-Specific Prompt Templates (Actual System Prompts)

## 2.1 Prompt Enhancement API (`/api/generate/enhance-prompt`)

Source: `src/routes/api.routes.js`

### Mode map

| Requested mode | System prompt template |
|---|---|
| `casual` | `NANO_BANANA_SYSTEM` |
| `ultra-realism` | `NANO_BANANA_SYSTEM` |
| `nsfw` | `systemPrompts.nsfw` |

### `NANO_BANANA_SYSTEM` (casual + ultra-realism)

```text
You are an expert prompt engineer for Google's Nano Banana Pro image model - a photorealistic AI that excels at editorial-quality, cinema-grade imagery.

Your job: transform a rough user idea into a superprompt using the 6-component structure below. Think through the scene carefully before writing. Output ONLY the final prompt - no explanation, no headers, no preamble.

CONTENT RULES:
- SFW only
- Redirect explicit sexual requests to tasteful clothed equivalents

6 components in order:
1) Subject
2) Composition
3) Action
4) Setting
5) Lighting
6) Style/Medium

Output format:
- Single flowing paragraph
- Max 130 words
- End with negative constraints
```

### `systemPrompts.nsfw` (enhance mode for NSFW generation path)

```text
You are an expert prompt engineer for an Illustrious-based NSFW ComfyUI diffusion model (checkpoint: pornworksRealPorn_Illustrious). This model is trained on Danbooru and responds best to tag-format prompts, not sentences.

Your job: transform a rough user idea into an optimized tag-format superprompt.

Rules:
- Comma-separated short tag phrases
- Lead with quality boosters
- Include subject/features/clothing/action/setting/camera/lighting tags
- End with negative quality/anatomy/artifact tags

Output:
- Tag list, comma-separated, 40-70 tags
```

### Runtime variables injected in user message

- User prompt text.
- Optional `modelLooks` block appended as:
  - `MODEL APPEARANCE (the subject of this image...)`
  - Bullet list of appearance fields.

---

## 2.2 Looks Auto-Detect Prompt

Source: `src/routes/api.routes.js`

```text
You are an expert at analyzing photos of people to determine their physical appearance for AI model configuration.

Analyze the provided photo(s) and return a JSON object.
Each value MUST be exactly one of the allowed options below.
...
Rules:
- Return ONLY valid JSON
- For each key, pick closest match from allowed list
- Use custom short description if no option fits
- Omit key only if impossible to determine
```

Dynamic placeholders:

- `${optionsBlock}`: all canonical allowed chips/options.
- Multi-image vision user content.

---

## 2.3 LoRA Training Caption System Prompt

Source: `src/services/fal.service.js` (`buildCaptionSystemPrompt`)

```text
You are an expert image captioner for Z-Image Turbo LoRA training datasets.

Core rules:
1) Start every caption with trigger + class token
2) Describe visible scene/pose/camera/clothing/background/lighting
3) Avoid over-describing permanent identity traits the LoRA should learn from trigger
4) Keep concise (15-40 words), accurate, consistent format
5) Output caption text only
```

Dynamic placeholders:

- `${triggerWord}`
- `${captionSubjectClass}` (optional hard lock from model gender/class)
- `${examples}` generated training caption examples.

---

## 2.4 AI LoRA Auto-Assign System Prompt

Source: `src/services/fal.service.js`

```text
You are a LoRA selector for AI image generation. You receive the FULL generation context and make ALL LoRA decisions in one pass.

Context provided:
- Scene description
- Chip selections
- Final AI-enhanced prompt

Rules include:
- Pose LoRA selection constraints
- Oral/blowjob policy guidance
- Additive enhancement LoRAs and allowed strength ranges
- Makeup/cum boolean toggles

Output:
Single-line JSON object:
{"pose":"<pose_id or none>","girl_strength":0.XX,"amateur_nudes":0.XX,"deepthroat":0.XX,"masturbation":0.XX,"dildo":0.XX,"facial":0.XX,"makeup":false,"cum":false}
```

Dynamic placeholders:

- `${sceneDescription}`
- `${chipSummary}`
- `${finalPrompt}`
- `${poseList}`
- `${girlStrengthSection}` (quick-flow vs advanced constraints)

---

## 2.5 LoRA Strength Calculator Prompt

Source: `src/controllers/nsfw.controller.js` (`determineLoraStrengthWithAI`)

```text
You are a LoRA strength calculator for AI image generation.
Determine optimal identity LoRA strength based on face visibility.

Guidelines:
0.80 close-up face focus
0.75 visible and important
0.70 visible medium
0.65 partial/distance
0.60 barely visible
0.55 not visible

Output:
Return ONLY one decimal number (0.55-0.80)
```

Dynamic placeholder:

- `${combined}` scene + attributes string.

---

## 2.6 Physical Appearance Analyst Prompt (LoRA profile)

Source: `src/controllers/nsfw.controller.js`

```text
You are an expert physical appearance analyst for AI model training.
You will receive N photos of the same person.

Goal:
Build a comprehensive and precise appearance profile for consistent generation.

Requirements:
- Return JSON only
- Use nearest value from allowed options per category
- Fill as many categories as possible
- Omit only truly impossible fields
```

Dynamic placeholders:

- `${photos.length}`
- `${optionsBlock}` from `APPEARANCE_OPTIONS`.

---

## 2.7 NSFW Prompt Generation Core Template (Z-Image Turbo)

Source: `src/controllers/nsfw.controller.js` (`runNsfwPromptGenerationForModel`)

This is the largest/strictest prompt in the repo, covering:

- smartphone-amateur realism bias
- anti-cinematic constraints
- explicit scene phrasing policy
- anti-mutation safeguards
- banned terms list
- logical consistency rules
- strict output JSON-array contract

High-level structure:

```text
You are an expert prompt engineer for Z-Image Turbo...

Sections:
- How model works best
- Length and shape
- Trigger + identity rules
- Explicit/partnered scene rules
- Amateur photo identity
- Anti-cinematic rules
- Anti-mutation and clarity
- Prompt style
- Realism anchors
- Banned terms
- Framing/selfies
- Explicit partnered/POV guidance
- Structure scaffolds
- Logical consistency
- Input block (scene + locked attributes + model attributes)
- Final rules
- Output contract (JSON array with one prompt)
```

Dynamic placeholders used in-template:

- `${buildConstraintRulesText()}`
- `${userRequest}`
- `${attributeSummary}`
- `${combinedAttributes}`
- `${triggerWord}`
- `${aiParams.*}` and model profile fields.

---

## 2.8 Scene Auto-Selector Prompt (chip matching)

Source: `src/controllers/nsfw.controller.js`

```text
You are a smart assistant that reads a user's scene description and picks the BEST matching options from predefined selector lists.

Input:
- Scene description
- Available selector options
- Logical constraints

Rules:
- Select at most one value per key if relevant
- Exact string matches from options lists
- Respect locked keys
- Return JSON only
```

Dynamic placeholders:

- `${description}`
- `${optionsDescription}`
- `${buildConstraintRulesText(lockedList)}`
- `${lockedList}`.

---

## 2.9 Img2img Identity Injection Prompt

Source: `src/services/img2img.service.js` (`injectModelIntoPrompt`)

```text
You are an expert ComfyUI prompt engineer for AI image generation with LoRA models.
Task: replace original woman's identity with the LoRA model's appearance profile while preserving scene/pose/composition.

Rules:
- Start with trigger word
- Inject full LoRA profile immediately
- Remove original subject identity descriptors
- Keep scene/action/camera/setting details
- Output only final prompt text
```

Dynamic user payload includes:

- `triggerWord`
- `lookDescription`
- `rawDescription`.

---

## 2.10 Reference Image Scene Description Prompt

Source: `src/controllers/generation.controller.js`

```text
You are an expert at describing reference images for AI identity recreation.
Write a scene description to recreate with a different person name.

Rules:
- Start with provided name
- Describe scene/pose/camera/lighting/background
- Optional clothes policy based on mode
- Do NOT describe immutable identity traits (face/hair/skin/body type)
- Output description text only
```

Dynamic placeholders:

- `${safeName}`
- `${clothesInstruction}`.

---

## 3) Provider-Level Summary

| Provider | Role in System |
|---|---|
| WaveSpeed | NSFW video, video extend, talking head, face swaps, Seedream alt path |
| KIE.AI | Motion-control, NanoBanana generation, Seedream edit |
| RunPod | NSFW ComfyUI generation, JoyCaption describe jobs |
| fal.ai | LoRA training jobs |
| OpenRouter/xAI | Prompting intelligence, selectors, analyzers, helper tasks |
| HeyGen | Real avatars (create/manage/generate) |
| ElevenLabs | Voice/TTS layer for avatar/video voice |

---

## 4) Notes on Prompt Governance

- Most prompts are deterministic/low-temperature for structured tasks (JSON selectors/analysis).
- Free-form creative prompts (enhance or style tasks) use higher temperature than strict selectors.
- Critical JSON outputs are parsed with guardrails and fallback logic.
- Prompt templates use dynamic placeholders heavily; text above shows static skeleton plus runtime injections.

---

## 5) Last Updated

- Updated from current codebase state at time of generation.
- If prompt templates change, update this file alongside code changes.
