export const BREAKPOINTS = ["base", "sm", "md", "lg", "xl"];

export const LANDER_EDITOR_SCHEMA = [

  // ── Brand ────────────────────────────────────────────────────────────────
  {
    id: "brand",
    label: "Brand",
    group: "Brand",
    fields: [
      { key: "brand.appName", type: "text", label: "App Name" },
      { key: "brand.logoUrl", type: "url",  label: "Logo URL" },
      { key: "brand.ctaText", type: "text", label: "CTA Label" },
      { key: "brand.ctaHref", type: "url",  label: "CTA URL"   },
    ],
  },

  {
    id: "buttons.palette",
    label: "Buttons – Colors",
    group: "Brand",
    fields: [
      { key: "styles.buttonPrimaryBackground", type: "text", label: "Primary background (CSS color)" },
      { key: "styles.buttonPrimaryText",       type: "text", label: "Primary text (CSS color)" },
      { key: "styles.buttonPrimaryBorder",     type: "text", label: "Primary border (CSS color)" },
      { key: "styles.buttonGhostText",         type: "text", label: "Ghost text (CSS color)" },
      { key: "styles.buttonGhostBorder",       type: "text", label: "Ghost border (CSS color)" },
      { key: "styles.buttonGhostBackground",   type: "text", label: "Ghost background (CSS color)" },
    ],
  },

  // ── Announcement Bar ─────────────────────────────────────────────────────
  {
    id: "promo",
    label: "Announcement Bar",
    group: "Brand",
    fields: [
      { key: "promotionBar.enabled", type: "checkbox", label: "Visible" },
      { key: "promotionBar.message", type: "text", label: "Message" },
      { key: "promotionBar.ctaText", type: "text", label: "CTA Label (optional)" },
      { key: "promotionBar.ctaHref", type: "url",  label: "CTA URL (optional)" },
    ],
  },

  // ── Countdown Banner ─────────────────────────────────────────────────────
  {
    id: "countdown",
    label: "Countdown Banner",
    group: "Brand",
    fields: [
      { key: "countdown.enabled",   type: "checkbox", label: "Visible" },
      { key: "countdown.eyebrow",   type: "text",     label: "Eyebrow"              },
      { key: "countdown.heading",   type: "text",     label: "Heading"              },
      { key: "countdown.body",      type: "textarea", label: "Body text"            },
      { key: "countdown.ctaText",   type: "text",     label: "CTA Label"            },
      { key: "countdown.ctaHref",   type: "url",      label: "CTA URL"              },
      { key: "countdown.targetISO", type: "text",     label: "Target date (ISO 8601, e.g. 2026-05-01T23:59:59Z)" },
      { key: "countdown.finishedText", type: "text",  label: "Text when countdown finishes" },
    ],
  },

  // ── Hero slides ──────────────────────────────────────────────────────────
  // Each slide has copy + a media upload (video or image)
  ...[0, 1, 2].map((i) => ({
    id: `hero.slide.${i}`,
    label: `Hero – Slide ${i + 1}`,
    group: "Hero",
    fields: [
      { key: `sections.hero.slides[${i}].eyebrow`,     type: "text",     label: "Tab label (eyebrow)" },
      { key: `sections.hero.slides[${i}].title`,        type: "text",     label: "Headline" },
      { key: `sections.hero.slides[${i}].description`,  type: "textarea", label: "Subtitle" },
      { key: `sections.hero.slides[${i}].mediaUrl`,     type: "url",      label: "Video / Image URL" },
      { key: `sections.hero.slides[${i}].mediaType`,    type: "text",     label: "Media type (video | image)" },
    ],
  })),

  // ── Create Today ─────────────────────────────────────────────────────────
  ...[0, 1, 2].map((i) => ({
    id: `createToday.card.${i}`,
    label: `Create Today – Mode ${i + 1}`,
    group: "Create Today",
    fields: [
      { key: `sections.createToday.cards[${i}].title`,       type: "text",     label: "Title" },
      { key: `sections.createToday.cards[${i}].description`, type: "textarea", label: "Description" },
      { key: `sections.createToday.cards[${i}].mediaUrl`,    type: "url",      label: "Video / Image URL" },
      { key: `sections.createToday.cards[${i}].mediaType`,   type: "text",     label: "Media type (video | image)" },
    ],
  })),

  // ── Top Choice ───────────────────────────────────────────────────────────
  {
    id: "topChoice.heading",
    label: "Top Choice – Header",
    group: "Top Choice",
    fields: [
      { key: "sections.topChoice.heading",  type: "text", label: "Heading"  },
      { key: "sections.topChoice.subtitle", type: "text", label: "Subtitle" },
    ],
  },
  ...[0, 1, 2, 3, 4].map((i) => ({
    id: `topChoice.item.${i}`,
    label: `Top Choice – Card ${i + 1}`,
    group: "Top Choice",
    fields: [
      { key: `sections.topChoice.items[${i}].title`,       type: "text",     label: "Title"       },
      { key: `sections.topChoice.items[${i}].description`, type: "textarea", label: "Description" },
      { key: `sections.topChoice.items[${i}].mediaUrl`,    type: "url",      label: "Preview media URL (image or video)" },
      { key: `sections.topChoice.items[${i}].mediaType`,   type: "text",     label: "Preview media type (video | image)" },
    ],
  })),

  // ── Partners ─────────────────────────────────────────────────────────────
  {
    id: "partners.heading",
    label: "Partners – Header",
    group: "Partners",
    fields: [
      { key: "sections.partners.heading", type: "text", label: "Heading" },
    ],
  },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    id: `partners.logo.${i}`,
    label: `Partner ${i + 1}`,
    group: "Partners",
    fields: [
      { key: `sections.partners.logos[${i}].name`,    type: "text", label: "Name"     },
      { key: `sections.partners.logos[${i}].logoUrl`, type: "url",  label: "Logo URL — SVG preferred; PNG: 280×80 px @ 2x, transparent bg, light/white version" },
    ],
  })),

  // ── Pricing ──────────────────────────────────────────────────────────────
  {
    id: "pricing.heading",
    label: "Pricing – Header",
    group: "Pricing",
    fields: [
      { key: "sections.pricing.heading", type: "text", label: "Heading" },
    ],
  },
  ...[0, 1, 2].map((i) => ({
    id: `pricing.tier.${i}`,
    label: `Pricing – Tier ${i + 1}`,
    group: "Pricing",
    fields: [
      { key: `sections.pricing.tiers[${i}].name`,         type: "text",   label: "Name"           },
      { key: `sections.pricing.tiers[${i}].credits`,      type: "number", label: "Credits / mo"   },
      { key: `sections.pricing.tiers[${i}].monthly`,      type: "number", label: "Monthly ($)"    },
      { key: `sections.pricing.tiers[${i}].annual`,       type: "number", label: "Annual ($)"     },
      { key: `sections.pricing.tiers[${i}].bonusCredits`, type: "number", label: "Bonus credits"  },
    ],
  })),
  {
    id: "pricing.payg",
    label: "Pricing – Pay As You Go",
    group: "Pricing",
    fields: [
      { key: "sections.pricing.payAsYouGo.pricePerCredit", type: "number",   label: "Price per credit ($)" },
      { key: "sections.pricing.payAsYouGo.description",    type: "textarea", label: "Description"           },
    ],
  },

  {
    id: "layout.spacers",
    label: "Layout – Spacers",
    group: "Layout",
    fields: [
      { key: "layout.spacers.beforeHeader",     type: "number", label: "Space between Announcement and Header (px)" },
      { key: "layout.spacers.beforeHero",       type: "number", label: "Space before Hero (px)" },
      { key: "layout.spacers.beforeCountdown",  type: "number", label: "Space before Countdown (px)" },
      { key: "layout.spacers.beforeCreateToday",type: "number", label: "Space before Create Today (px)" },
      { key: "layout.spacers.beforeTopChoice",  type: "number", label: "Space before Top Choice (px)" },
      { key: "layout.spacers.beforePartners",   type: "number", label: "Space before Partners (px)" },
      { key: "layout.spacers.beforePricing",    type: "number", label: "Space before Pricing (px)" },
      { key: "layout.spacers.beforeFooter",     type: "number", label: "Space before Footer (px)" },
    ],
  },

  // ── SEO ──────────────────────────────────────────────────────────────────
  {
    id: "seo.basic",
    label: "SEO – Core",
    group: "SEO",
    fields: [
      { key: "seo.title",        type: "text",     label: "Page Title"       },
      { key: "seo.description",  type: "textarea", label: "Meta Description" },
      { key: "seo.canonicalUrl", type: "url",      label: "Canonical URL"    },
      { key: "seo.robots",       type: "text",     label: "Robots"           },
    ],
  },
  {
    id: "seo.og",
    label: "SEO – Open Graph",
    group: "SEO",
    fields: [
      { key: "seo.ogTitle",       type: "text",     label: "OG Title"       },
      { key: "seo.ogDescription", type: "textarea", label: "OG Description" },
      { key: "seo.ogImageUrl",    type: "url",      label: "OG Image"       },
    ],
  },
  {
    id: "seo.twitter",
    label: "SEO – Twitter Card",
    group: "SEO",
    fields: [
      { key: "seo.twitterTitle",       type: "text",     label: "Twitter Title"       },
      { key: "seo.twitterDescription", type: "textarea", label: "Twitter Description" },
      { key: "seo.twitterImageUrl",    type: "url",      label: "Twitter Image"       },
    ],
  },
];

export const SCHEMA_GROUPS = [...new Set(LANDER_EDITOR_SCHEMA.map(s => s.group))];
