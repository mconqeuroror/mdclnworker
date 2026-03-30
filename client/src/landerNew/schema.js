export const BREAKPOINTS = ["base", "sm", "md", "lg", "xl"];

export const LANDER_EDITOR_SCHEMA = [
  {
    id: "brand.logo",
    label: "Brand Logo",
    fields: [{ key: "brand.logoUrl", type: "url", label: "Logo URL" }],
  },
  {
    id: "hero.title",
    label: "Hero Title",
    fields: [{ key: "sections.hero.title", type: "text", label: "Text" }],
  },
  {
    id: "hero.subtitle",
    label: "Hero Subtitle",
    fields: [{ key: "sections.hero.subtitle", type: "textarea", label: "Text" }],
  },
  {
    id: "hero.cta.primary",
    label: "Hero Primary CTA",
    fields: [
      { key: "sections.hero.primaryCtaText", type: "text", label: "Label" },
      { key: "sections.hero.primaryCtaHref", type: "url", label: "URL" },
    ],
  },
  {
    id: "hero.cta.secondary",
    label: "Hero Secondary CTA",
    fields: [
      { key: "sections.hero.secondaryCtaText", type: "text", label: "Label" },
      { key: "sections.hero.secondaryCtaHref", type: "url", label: "URL" },
    ],
  },
  {
    id: "hero.media",
    label: "Hero Media",
    fields: [{ key: "sections.hero.mediaUrl", type: "url", label: "Media URL" }],
  },
  {
    id: "topChoice.heading",
    label: "Top Choice Heading",
    fields: [{ key: "sections.topChoice.heading", type: "text", label: "Text" }],
  },
  {
    id: "partners.heading",
    label: "Partners Heading",
    fields: [{ key: "sections.partners.heading", type: "text", label: "Text" }],
  },
  {
    id: "pricing.heading",
    label: "Pricing Heading",
    fields: [{ key: "sections.pricing.heading", type: "text", label: "Text" }],
  },
];

