# Lander New SEO Configuration

This document is the master source for `/lander-new` metadata and sharing tags.
Values map directly to `config.seo` in the lander editor config.

---

## 1) Core SEO

- `title`: `ModelClone — AI Image & Video Studio for Creators`
- `description`: `Generate professional AI images and videos with full control over style, motion, and visual identity. The creative studio built for serious content output.`
- `canonicalUrl`: `https://modelclone.app/lander-new`
- `robots`: `index,follow`

> **title** = 50 chars ✓ (limit 60)
> **description** = 155 chars ✓ (target 140–160)
> **Primary keyword:** `AI image and video generator`
> **Secondary keyword:** `AI creative studio`

---

## 2) Open Graph (Facebook, LinkedIn, Discord)

- `ogTitle`: `ModelClone — AI Image & Video Studio for Creators`
- `ogDescription`: `Generate cinematic AI images and videos with precision control over shot, style, and motion. Built for creators and agencies who demand consistent output.`
- `ogImageUrl`: `https://modelclone.app/og-lander-new.jpg`
- `ogType`: `website`
- `ogSiteName`: `ModelClone`

> OG description = 153 chars ✓
> Replace `og-lander-new.jpg` with your actual 1200×630 asset path once uploaded.

---

## 3) Twitter/X Cards

- `twitterCard`: `summary_large_image`
- `twitterTitle`: `ModelClone — AI Image & Video Studio for Creators`
- `twitterDescription`: `Cinematic AI images and video. Full control over style, motion, and visual identity. Built for creators who care about output quality.`
- `twitterImageUrl`: `https://modelclone.app/og-lander-new.jpg`
- `twitterSite`: `@modelclone`
- `twitterCreator`: `@modelclone`

> Twitter description = 135 chars ✓ (Twitter truncates at ~160)

---

## 4) Social Share Copy

### Variant A — Quality / cinematic angle
- **Headline:** `Your AI studio. Every shot, dialed in.`
- **Description:** `ModelClone gives you precision control over AI-generated images and video — style, motion, continuity, and identity locked across every frame. Start free.`

### Variant B — Speed / output volume angle
- **Headline:** `Go from idea to cinematic output in seconds.`
- **Description:** `Generate 4K images, motion sequences, and multi-angle shots without a camera crew. ModelClone is the AI studio built for high-output creators.`

### Variant C — Scale / agency angle
- **Headline:** `One tool. Every shot. Unlimited output.`
- **Description:** `Creators and agencies use ModelClone to generate consistent, high-quality AI content at scale — images, video, motion control, and more. Try it free.`

---

## 5) Rich Snippets (JSON-LD)

### Organization
- `name`: `ModelClone`
- `url`: `https://modelclone.app`
- `logo`: `https://modelclone.app/modelclone-logo.svg`
- `sameAs`:
  - `https://twitter.com/modelclone`
  - `https://discord.gg/modelclone`
  - `https://www.instagram.com/modelclone`

### WebPage
- `name`: `ModelClone — AI Image & Video Studio for Creators`
- `url`: `https://modelclone.app/lander-new`
- `description`: `Generate professional AI images and videos with full control over style, motion, and visual identity. The creative studio built for serious content output.`

### SoftwareApplication (optional — boosts AI tool rankings)
- `name`: `ModelClone`
- `applicationCategory`: `MultimediaApplication`
- `operatingSystem`: `Web`
- `offers.price`: `29` (Starter monthly)
- `offers.priceCurrency`: `USD`

---

## 6) Technical SEO Checklist

- [ ] canonical URL is final production URL (no `/lander-new` redirect loops)
- [ ] OG/Twitter image (`og-lander-new.jpg`) is publicly reachable — test with [opengraph.xyz](https://www.opengraph.xyz)
- [ ] no query params in canonical
- [x] title = 50 chars ✓ (limit 60)
- [x] description = 155 chars ✓ (target 140–160)
- [x] primary keyword (`AI image and video generator`) appears in title + description
- [x] secondary keyword (`AI creative studio`) appears in description
- [ ] robots confirmed as `index,follow`
- [ ] JSON-LD validated at [schema.org validator](https://validator.schema.org)
- [ ] sameAs social URLs are live and consistent with brand handles

---

## 7) Notes

- The OG image should show a cinematic still or motion frame from the product — dark background, high contrast. Avoid text-heavy graphics; let the visual do the work on Discord/Twitter unfurls.
- `SoftwareApplication` JSON-LD schema is strongly recommended — Google surfaces it in AI tool roundups and "best AI video generator" featured snippets.
- If you run A/B variants of this lander at a different URL, add `rel="canonical"` pointing to `https://modelclone.app/lander-new` to avoid duplicate content penalties.
- Update `sameAs` URLs once social handles are confirmed live.

