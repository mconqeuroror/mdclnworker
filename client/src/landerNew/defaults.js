export const LANDER_NEW_DEFAULTS = {
  seo: {
    title: "ModelClone — AI Image & Video Studio for Creators",
    description:
      "Generate professional AI images and videos with full control over style, motion, and visual identity. The creative studio built for serious content output.",
    canonicalUrl: "https://modelclone.app/lander-new",
    ogTitle: "ModelClone — AI Image & Video Studio for Creators",
    ogDescription:
      "Generate cinematic AI images and videos with precision control over shot, style, and motion. Built for creators and agencies who demand consistent output.",
    ogImageUrl: "https://modelclone.app/og-lander-new.jpg",
    ogType: "website",
    ogSiteName: "ModelClone",
    twitterCard: "summary_large_image",
    twitterTitle: "ModelClone — AI Image & Video Studio for Creators",
    twitterDescription:
      "Cinematic AI images and video. Full control over style, motion, and visual identity. Built for creators who care about output quality.",
    twitterImageUrl: "https://modelclone.app/og-lander-new.jpg",
    twitterSite: "@modelclone",
    twitterCreator: "@modelclone",
    robots: "index,follow",
    jsonLd: {
      organization: {
        name: "ModelClone",
        url: "https://modelclone.app",
        logo: "https://modelclone.app/modelclone-logo.svg",
        sameAs: [
          "https://twitter.com/modelclone",
          "https://discord.gg/modelclone",
          "https://www.instagram.com/modelclone",
        ],
      },
      webPage: {
        name: "ModelClone — AI Image & Video Studio for Creators",
        url: "https://modelclone.app/lander-new",
        description:
          "Generate professional AI images and videos with full control over style, motion, and visual identity. The creative studio built for serious content output.",
      },
      softwareApplication: {
        name: "ModelClone",
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Web",
        offers: { price: "29", priceCurrency: "USD" },
      },
    },
  },

  brand: {
    appName: "ModelClone",
    logoUrl: "",
    ctaText: "Start Creating",
    ctaHref: "/signup",
  },

  sections: {
    hero: {
      // Per-slide config — these overlay on top of the standalone landing.config defaults
      slides: [
        { eyebrow: "ModelClone Chat",    title: "Direct scenes in one continuous flow.",                            description: "Write, iterate, and lock visual identity across stills and motion without breaking context.", mediaType: "video", mediaUrl: "" },
        { eyebrow: "Cinema Studio 2.5",  title: "Precision control over shot, pace, and continuity.",               description: "Steer camera language, character framing, and look development with a true studio workflow.",  mediaType: "video", mediaUrl: "" },
        { eyebrow: "Soul Cinema",        title: "Film texture. Controlled color. Signature mood.",                  description: "Build frames that feel authored, not generated, with tuned lighting and deliberate grade.",     mediaType: "video", mediaUrl: "" },
      ],
    },

    createToday: {
      cards: [
        { title: "Create Image",   description: "Author stills with cinematic structure and material realism.",    mediaType: "image", mediaUrl: "" },
        { title: "Create Video",   description: "Translate visual intent into controlled motion sequences.",       mediaType: "video", mediaUrl: "" },
        { title: "Motion Control", description: "Shape timing, camera path, and action beats shot by shot.",       mediaType: "video", mediaUrl: "" },
      ],
    },

    topChoice: {
      heading: "Top Choice",
      subtitle: "High-utility tools used in daily production",
      items: [
        { id: "nano-banana",    title: "Nano Banana Pro",    description: "Flagship 4K image generation pipeline",        imageUrl: "" },
        { id: "motion-control", title: "Motion Control",     description: "Expression and movement control up to 30s",    imageUrl: "" },
        { id: "pro-skin",       title: "Pro Skin Enhancer",  description: "Natural skin detail with preserved texture",   imageUrl: "" },
        { id: "shots",          title: "Shots",              description: "Generate nine usable angles from one frame",   imageUrl: "" },
        { id: "pro-angles",     title: "Pro Angles 2.0",     description: "Fast viewpoint synthesis for coverage",        imageUrl: "" },
      ],
    },

    partners: {
      heading: "Partners",
      logos: [
        { id: "kie",        name: "KIE AI",      logoUrl: "" },
        { id: "wavespeed",  name: "WaveSpeed",   logoUrl: "" },
        { id: "openrouter", name: "OpenRouter",  logoUrl: "" },
        { id: "runpod",     name: "RunPod",      logoUrl: "" },
        { id: "vercel",     name: "Vercel Blob", logoUrl: "" },
        { id: "stripe",     name: "Stripe",      logoUrl: "" },
        { id: "falai",      name: "Fal AI",      logoUrl: "" },
        { id: "cf",         name: "Cloudflare",  logoUrl: "" },
      ],
    },

    pricing: {
      heading: "Pricing",
      billingCycleDefault: "monthly",
      tiers: [
        { id: "starter",  name: "Starter",  credits: 2900,  monthly: 29,  annual: 289,  pricePerCredit: 0.01,   popular: false, bonusCredits: 0    },
        { id: "pro",      name: "Pro",      credits: 8900,  monthly: 79,  annual: 787,  pricePerCredit: 0.0089, popular: true,  bonusCredits: 1000 },
        { id: "business", name: "Business", credits: 24900, monthly: 199, annual: 1982, pricePerCredit: 0.008,  popular: false, bonusCredits: 5000 },
      ],
      payAsYouGo: {
        pricePerCredit: 0.012,
        description: "One-time credit top-ups. No subscription required.",
      },
    },
  },

  layout: {},
  styles: {},
  spatialOverrides: {},
  styleOverrides: {},
};
