# Telegram Legacy Bot — parity checklist

This document tracks **user-facing app** coverage in the Legacy Telegram bot (`src/routes/telegram/webhook.js` and future split modules).  
**Decisions (2026):** maximize chat-native UI and outcomes; **Mini App** where Telegram cannot host the same UI (e.g. mask drawing, full Creator Studio layout). **Pro (`/pro`)** is out of scope for the bot. **Reel finder** and **Course** default to **Mini App** deep links. Code will be **split into smaller modules** as work proceeds.

## Legend

| Status | Meaning |
|--------|---------|
| done | Wired in bot with acceptable UX |
| partial | Subset or simplified vs web app |
| mini | Use Mini App link for this surface (by design) |
| out | Explicitly not in bot (e.g. admin, Pro) |
| todo | Not implemented yet |

---

## Dashboard tabs (`/dashboard?tab=…`)

| Tab | Status | Notes |
|-----|--------|-------|
| home | partial | Credits/dashboard + `/apphub` for all tabs |
| models | partial | Prisma-heavy flows; ensure REST parity where app uses `/api/models/*` |
| generate | partial | Add missing generate APIs (advanced, pipelines); mode pickers |
| creator-studio | partial + mini | Chat shortcuts + **mini** for masks / full matrix |
| voice-studio | partial | Voices, clone, TTS; previews / edge cases |
| reformatter | done | |
| frame-extractor | partial | Chat: extract-frames wizard; tab stays **mini** for full UI |
| upscaler | done | |
| modelclone-x | partial | Generate, character, train, delete, register image; rest |
| history | partial | Filters, download parity; monthly counts on dashboard |
| settings | partial | API keys, 2FA, email change, full profile |
| nsfw | partial | extend-video, plan-gen, auto-select, full training, LoRA mgmt |
| course | mini | Deep link `tab=course` (+ optional video id) |
| jobs | todo | Chat MVP vs **mini** — product call if revived |
| repurposer | done | |
| reelfinder | mini | Deep link `tab=reelfinder` |
| referral | mini | Deep link from Tools / Settings |

---

## Standalone app routes (non-admin)

| Route | Status | Notes |
|-------|--------|-------|
| `/nsfw` | partial | Same engines as tab; bot NSFW menu should converge |
| `/reformatter`, `/upscaler` | done | Duplicates of tools |
| `/pro/*` | out | Not part of bot |

---

## Generation / recreation APIs (`/api/generate/*`)

| Endpoint | Status | Notes |
|----------|--------|-------|
| video-prompt | done | |
| prompt-image | done | Expose more options (style, qty, rating) in chat |
| image-identity | done | |
| video-motion | done | Chat wizard (image → ref video → duration) |
| complete-recreation | done | Chat wizard (screenshot → video → prompt → duration) |
| describe-target | done | clothesMode picker (model vs reference) |
| enhance-prompt | done | Casual, NSFW, ultra-realism pickers |
| video-directly | done | Optional engine/ultra fields |
| face-swap, face-swap-video | done | |
| image-faceswap | done | |
| advanced (SFW) | done | Model picker + prompt → nano-banana |
| talking-head | done | |
| analyze-looks | done | |
| extract-frames | done | URL/upload → frame URLs |
| prepare-video | done | After extract: frame URL → 3 variations → pick → complete-video |
| complete-video | done | Wired in reel pipeline |
| creator-studio (image) | partial | Defaults only; full params + **mini** |
| creator-studio/video | partial | One Kling i2v path; families + **mini** |
| creator-studio/video/extend, 4k, 1080p | todo | |
| creator-studio/mask-upload | mini | |
| creator-studio/assets (+ CRUD) | todo | Short callback IDs for asset ids |

---

## NSFW APIs (`/api/nsfw/*`)

| Area | Status | Notes |
|------|--------|-------|
| generate, generate-video, generate-advanced | done | |
| nudes-pack, poses | done | |
| generate-prompt | done | |
| extend-video | done | UUID → 5s/8s → optional prompt |
| plan-generation + status | done | Model + scene → poll → useprompt buttons |
| auto-select + status | done | Model + description → poll → selections text |
| test-face-ref + status | done | LoRA models only → prompt → fal poll |
| lora create, list, train, status | partial | Wire create/init helpers; full training UX |
| register / upload / assign / regenerate / list training | todo | |
| set-active, delete lora, appearance | todo | |

---

## Account / auth / developer

| Area | Status | Notes |
|------|--------|-------|
| Profile read/update (full `PUT /auth/profile`) | partial | |
| change-email request/verify | todo | |
| 2FA status / generate / verify / disable | todo | QR may be **mini** |
| user/api-keys CRUD | todo | Secrets shown once |
| onboarding | todo | Optional chat summary + **mini** |

---

## Upload / misc

| Area | Status | Notes |
|------|--------|-------|
| upload config / presign / blob | partial | Bot uses Telegram→R2; align if app-only features |
| voices list | done | modelId query |
| voice preview GET | todo | Optional button |
| generations monthly-stats | done | On dashboard |

---

## Implementation plan (engineering)

1. **Split** legacy handler code out of monolithic `webhook.js` into `src/routes/telegram/legacy/` (or similar) by domain: `auth`, `generate`, `nsfw`, `models`, `account`, `tools`, `callbacks`.
2. **Central registry**: feature id → `{ tier: chat|mini, handlers, openapi ref }`.
3. **Tighten** Mini App URLs using `buildSectionUrl` / query params for `course`, `reelfinder`, `creator-studio`.
4. Work through **todo** rows by phase: generate pipelines → Creator depth → NSFW completeness → account → frame extractor → referral.

Update this file as rows move from **todo** → **partial** → **done**.
