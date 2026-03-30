export const BREAKPOINTS = ["base", "sm", "md", "lg", "xl"];

export const LANDER_EDITOR_SCHEMA = [
  // ── Brand ─────────────────────────────────────────────────────────────
  {
    id: "brand",
    label: "Brand",
    group: "Brand",
    fields: [
      { key: "brand.logoUrl",  type: "url",  label: "Logo URL" },
      { key: "brand.appName",  type: "text", label: "App Name" },
    ],
  },

  // ── Promo Bar ─────────────────────────────────────────────────────────
  {
    id: "promo",
    label: "Promo Bar",
    group: "Promo Bar",
    fields: [
      { key: "sections.promotionBar.message",  type: "text", label: "Message" },
      { key: "sections.promotionBar.ctaText",  type: "text", label: "CTA Text" },
      { key: "sections.promotionBar.ctaHref",  type: "url",  label: "CTA URL" },
    ],
  },

  // ── Hero ──────────────────────────────────────────────────────────────
  {
    id: "hero.slide.0",
    label: "Hero – Slide 1",
    group: "Hero",
    fields: [
      { key: "sections.hero.slides[0].eyebrow",     type: "text",     label: "Eyebrow" },
      { key: "sections.hero.slides[0].title",       type: "text",     label: "Title" },
      { key: "sections.hero.slides[0].description", type: "textarea", label: "Description" },
      { key: "sections.hero.slides[0].mediaUrl",    type: "url",      label: "Media URL" },
    ],
  },
  {
    id: "hero.slide.1",
    label: "Hero – Slide 2",
    group: "Hero",
    fields: [
      { key: "sections.hero.slides[1].eyebrow",     type: "text",     label: "Eyebrow" },
      { key: "sections.hero.slides[1].title",       type: "text",     label: "Title" },
      { key: "sections.hero.slides[1].description", type: "textarea", label: "Description" },
      { key: "sections.hero.slides[1].mediaUrl",    type: "url",      label: "Media URL" },
    ],
  },
  {
    id: "hero.slide.2",
    label: "Hero – Slide 3",
    group: "Hero",
    fields: [
      { key: "sections.hero.slides[2].eyebrow",     type: "text",     label: "Eyebrow" },
      { key: "sections.hero.slides[2].title",       type: "text",     label: "Title" },
      { key: "sections.hero.slides[2].description", type: "textarea", label: "Description" },
      { key: "sections.hero.slides[2].mediaUrl",    type: "url",      label: "Media URL" },
    ],
  },

  // ── Countdown ────────────────────────────────────────────────────────
  {
    id: "countdown",
    label: "Countdown Banner",
    group: "Countdown",
    fields: [
      { key: "sections.countdown.heading",   type: "text", label: "Heading" },
      { key: "sections.countdown.body",      type: "textarea", label: "Body text" },
      { key: "sections.countdown.ctaText",   type: "text", label: "CTA Text" },
      { key: "sections.countdown.ctaHref",   type: "url",  label: "CTA URL" },
      { key: "sections.countdown.targetISO", type: "text", label: "End date (ISO)" },
    ],
  },

  // ── Top Choice ───────────────────────────────────────────────────────
  {
    id: "topChoice.heading",
    label: "Top Choice – Heading",
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
    label: "Partners – Heading",
    group: "Partners",
    fields: [
      { key: "sections.partners.heading", type: "text", label: "Heading" },
    ],
  },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    id: `partners.logo.${i}`,
    label: `Partner Logo ${i + 1}`,
    group: "Partners",
    fields: [
      { key: `sections.partners.logos[${i}].name`,    type: "text", label: "Name" },
      { key: `sections.partners.logos[${i}].logoUrl`, type: "url",  label: "Logo URL" },
    ],
  })),

  // ── Pricing ───────────────────────────────────────────────────────────
  {
    id: "pricing.heading",
    label: "Pricing – Heading",
    group: "Pricing",
    fields: [
      { key: "sections.pricing.heading", type: "text", label: "Heading" },
    ],
  },
  ...[0, 1, 2].map((i) => ({
    id: `pricing.tier.${i}`,
    label: `Pricing Tier ${i + 1}`,
    group: "Pricing",
    fields: [
      { key: `sections.pricing.tiers[${i}].name`,                 type: "text",   label: "Name" },
      { key: `sections.pricing.tiers[${i}].credits`,              type: "number", label: "Credits / mo" },
      { key: `sections.pricing.tiers[${i}].price.monthly`,        type: "number", label: "Monthly price ($)" },
      { key: `sections.pricing.tiers[${i}].price.annual`,         type: "number", label: "Annual price ($)" },
      { key: `sections.pricing.tiers[${i}].bonusCredits`,         type: "number", label: "Bonus credits" },
    ],
  })),
  {
    id: "pricing.payg",
    label: "Pay As You Go",
    group: "Pricing",
    fields: [
      { key: "sections.pricing.oneTime.pricePerCredit", type: "number",   label: "Price per credit ($)" },
      { key: "sections.pricing.oneTime.description",    type: "textarea", label: "Description" },
    ],
  },

  // ── Footer ────────────────────────────────────────────────────────────
  {
    id: "footer",
    label: "Footer CTA",
    group: "Footer",
    fields: [
      { key: "sections.footerCta.text",    type: "text", label: "Text" },
      { key: "sections.footerCta.ctaText", type: "text", label: "CTA Label" },
      { key: "sections.footerCta.ctaHref", type: "url",  label: "CTA URL" },
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
      { key: "seo.ogImageUrl",    type: "url",      label: "OG Image URL" },
    ],
  },
  {
    id: "seo.twitter",
    label: "SEO – Twitter Card",
    group: "SEO",
    fields: [
      { key: "seo.twitterTitle",       type: "text",     label: "Twitter Title" },
      { key: "seo.twitterDescription", type: "textarea", label: "Twitter Description" },
      { key: "seo.twitterImageUrl",    type: "url",      label: "Twitter Image URL" },
    ],
  },
];

export const SCHEMA_GROUPS = [...new Set(LANDER_EDITOR_SCHEMA.map((s) => s.group))];
