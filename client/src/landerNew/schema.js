export const BREAKPOINTS = ["base", "sm", "md", "lg", "xl"];

// ─── All keys must match the actual LANDER_NEW_DEFAULTS shape:
//   brand.*, seo.*, sections.hero.*, sections.topChoice.*,
//   sections.partners.*, sections.pricing.*
// Bracket notation [n] is supported via utils.setByPath / getByPath

export const LANDER_EDITOR_SCHEMA = [

  // ── Brand ─────────────────────────────────────────────────────────────
  {
    id: "brand",
    label: "Brand",
    group: "Brand",
    fields: [
      { key: "brand.appName",  type: "text", label: "App Name" },
      { key: "brand.logoUrl",  type: "url",  label: "Logo URL" },
      { key: "brand.ctaText",  type: "text", label: "CTA Label" },
      { key: "brand.ctaHref",  type: "url",  label: "CTA URL" },
    ],
  },

  // ── Hero ──────────────────────────────────────────────────────────────
  {
    id: "hero.copy",
    label: "Hero – Copy",
    group: "Hero",
    fields: [
      { key: "sections.hero.title",              type: "text",     label: "Headline" },
      { key: "sections.hero.subtitle",           type: "textarea", label: "Subtitle" },
      { key: "sections.hero.primaryCtaText",     type: "text",     label: "Primary CTA Label" },
      { key: "sections.hero.primaryCtaHref",     type: "url",      label: "Primary CTA URL" },
      { key: "sections.hero.secondaryCtaText",   type: "text",     label: "Secondary CTA Label" },
      { key: "sections.hero.secondaryCtaHref",   type: "url",      label: "Secondary CTA URL" },
    ],
  },
  {
    id: "hero.media",
    label: "Hero – Media",
    group: "Hero",
    fields: [
      { key: "sections.hero.mediaUrl", type: "url", label: "Media URL (image or video)" },
    ],
  },

  // ── Top Choice ───────────────────────────────────────────────────────
  {
    id: "topChoice.heading",
    label: "Top Choice – Header",
    group: "Top Choice",
    fields: [
      { key: "sections.topChoice.heading",  type: "text", label: "Heading" },
      { key: "sections.topChoice.subtitle", type: "text", label: "Subtitle" },
    ],
  },
  ...[0, 1, 2, 3, 4].map((i) => ({
    id: `topChoice.item.${i}`,
    label: `Top Choice – Card ${i + 1}`,
    group: "Top Choice",
    fields: [
      { key: `sections.topChoice.items[${i}].title`,       type: "text",     label: "Title" },
      { key: `sections.topChoice.items[${i}].description`, type: "textarea", label: "Description" },
    ],
  })),

  // ── Partners ──────────────────────────────────────────────────────────
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
      { key: `sections.partners.logos[${i}].name`,    type: "text", label: "Name" },
      { key: `sections.partners.logos[${i}].logoUrl`, type: "url",  label: "Logo URL" },
    ],
  })),

  // ── Pricing ───────────────────────────────────────────────────────────
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
      { key: `sections.pricing.tiers[${i}].name`,         type: "text",   label: "Name" },
      { key: `sections.pricing.tiers[${i}].credits`,      type: "number", label: "Credits / mo" },
      { key: `sections.pricing.tiers[${i}].monthly`,      type: "number", label: "Monthly price ($)" },
      { key: `sections.pricing.tiers[${i}].annual`,       type: "number", label: "Annual price ($)" },
      { key: `sections.pricing.tiers[${i}].bonusCredits`, type: "number", label: "Bonus credits" },
    ],
  })),
  {
    id: "pricing.payg",
    label: "Pricing – Pay As You Go",
    group: "Pricing",
    fields: [
      { key: "sections.pricing.payAsYouGo.pricePerCredit", type: "number",   label: "Price per credit ($)" },
      { key: "sections.pricing.payAsYouGo.description",    type: "textarea", label: "Description" },
    ],
  },

  // ── SEO ───────────────────────────────────────────────────────────────
  {
    id: "seo.basic",
    label: "SEO – Core",
    group: "SEO",
    fields: [
      { key: "seo.title",        type: "text",     label: "Page Title" },
      { key: "seo.description",  type: "textarea", label: "Meta Description" },
      { key: "seo.canonicalUrl", type: "url",      label: "Canonical URL" },
      { key: "seo.robots",       type: "text",     label: "Robots" },
    ],
  },
  {
    id: "seo.og",
    label: "SEO – Open Graph",
    group: "SEO",
    fields: [
      { key: "seo.ogTitle",       type: "text",     label: "OG Title" },
      { key: "seo.ogDescription", type: "textarea", label: "OG Description" },
      { key: "seo.ogImageUrl",    type: "url",      label: "OG Image" },
    ],
  },
  {
    id: "seo.twitter",
    label: "SEO – Twitter Card",
    group: "SEO",
    fields: [
      { key: "seo.twitterTitle",       type: "text",     label: "Twitter Title" },
      { key: "seo.twitterDescription", type: "textarea", label: "Twitter Description" },
      { key: "seo.twitterImageUrl",    type: "url",      label: "Twitter Image" },
    ],
  },
];

export const SCHEMA_GROUPS = [...new Set(LANDER_EDITOR_SCHEMA.map((s) => s.group))];
