export const landingConfig = {
  brand: {
    appName: "ModelClone",
    logoText: "MC",
    logoUrl: "/modelclone-logo.svg",
  },
  promotionBar: {
    enabled: true,
    message:
      "1 YEAR ANNIVERSARY - 65% OFF UNLIMITED NANO BANANA PRO",
    ctaText: "Get 65% OFF",
    ctaHref: "#pricing",
  },
  hero: {
    enabled: true,
    slides: [
      {
        eyebrow: "ModelClone Chat",
        title: "Direct scenes in one continuous flow.",
        description:
          "Write, iterate, and lock visual identity across stills and motion without breaking context.",
        mediaType: "video",
        mediaUrl: "",
      },
      {
        eyebrow: "Cinema Studio 2.5",
        title: "Precision control over shot, pace, and continuity.",
        description:
          "Steer camera language, character framing, and look development with a true studio workflow.",
        mediaType: "image",
        mediaUrl: "",
      },
      {
        eyebrow: "Soul Cinema",
        title: "Film texture. Controlled color. Signature mood.",
        description:
          "Build frames that feel authored, not generated, with tuned lighting and deliberate grade.",
        mediaType: "video",
        mediaUrl: "",
      },
    ],
  },
  countdown: {
    enabled: true,
    targetISO: "2026-05-01T23:59:59Z",
    heading: "Anniversary Release Window - 65% OFF Unlimited Nano Banana Pro",
    body: "Limited access pricing for creators building with high output volume this month.",
    ctaText: "Claim Discount",
    ctaHref: "#pricing",
  },
  createToday: {
    enabled: true,
    title: "What will you create today?",
    description:
      "Start from a still, a motion idea, or a character direction.",
    ctaText: "Explore all tools",
    ctaHref: "#explore",
    cards: [
      {
        title: "Create Image",
        description: "Author stills with cinematic structure and material realism.",
        mediaType: "image",
      },
      {
        title: "Create Video",
        description: "Translate visual intent into controlled motion sequences.",
        mediaType: "video",
      },
      {
        title: "Motion Control",
        description: "Shape timing, camera path, and action beats shot by shot.",
        mediaType: "video",
      },
    ],
  },
  topChoice: {
    enabled: true,
    title: "Top Choice",
    subtitle: "High-utility tools used in daily production",
    items: [
      {
        title: "Nano Banana Pro",
        description: "Flagship 4K image generation pipeline",
        mediaType: "video",
        mediaUrl: "",
      },
      {
        title: "Motion Control",
        description: "Expression and movement control up to 30s",
        mediaType: "video",
        mediaUrl: "",
      },
      {
        title: "Pro Skin Enhancer",
        description: "Natural skin detail with preserved texture",
        mediaType: "video",
        mediaUrl: "",
      },
      {
        title: "Shots",
        description: "Generate nine usable angles from one frame",
        mediaType: "video",
        mediaUrl: "",
      },
      {
        title: "Pro Angles 2.0",
        description: "Fast viewpoint synthesis for coverage",
        mediaType: "video",
        mediaUrl: "",
      },
    ],
  },
  partners: {
    enabled: true,
    title: "Partners",
    // Each item: { name, logoUrl }
    // logoUrl can be an absolute URL, a /public path, or a data URI.
    // Leave logoUrl as "" to show a styled name-only placeholder.
    items: [
      { name: "KIE AI",       logoUrl: "" },
      { name: "WaveSpeed",    logoUrl: "" },
      { name: "OpenRouter",   logoUrl: "" },
      { name: "RunPod",       logoUrl: "" },
      { name: "Vercel Blob",  logoUrl: "" },
      { name: "Stripe",       logoUrl: "" },
      { name: "Fal AI",       logoUrl: "" },
      { name: "Cloudflare",   logoUrl: "" },
    ],
  },
  pricing: {
    enabled: true,
    title: "Pricing",
    subtitle: "Actual ModelClone plan pricing and credits",
    billingCycleDefault: "monthly",
    oneTime: {
      name: "Pay As You Go",
      pricePerCredit: 0.012,
      description: "One-time credit top-ups. No subscription required.",
    },
    tiers: [
      {
        id: "starter",
        name: "Starter",
        credits: 2900,
        price: { monthly: 29, annual: 289 },
        pricePerCredit: 0.01,
        bonusCredits: 0,
        popular: false,
      },
      {
        id: "pro",
        name: "Pro",
        credits: 8900,
        price: { monthly: 79, annual: 787 },
        pricePerCredit: 0.0089,
        bonusCredits: 1000,
        popular: true,
      },
      {
        id: "business",
        name: "Business",
        credits: 24900,
        price: { monthly: 199, annual: 1982 },
        pricePerCredit: 0.008,
        bonusCredits: 5000,
        popular: false,
      },
    ],
  },
  footerCta: {
    text: "Build your next viral campaign with ModelClone.",
    ctaText: "Start creating",
    ctaHref: "#signup",
  },
};
