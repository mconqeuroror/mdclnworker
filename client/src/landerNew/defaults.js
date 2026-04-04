export const LANDER_NEW_DEFAULTS = {
  seo: {
    title: "ModelClone — Cinematic AI Video & Image Studio",
    description:
      "Create cinematic AI images and videos with unmatched visual quality. Recreate any identity, style, and motion with precision. The AI studio built for creators, agencies, and brands who refuse to compromise.",
    canonicalUrl: "https://modelclone.app/",
    ogTitle: "ModelClone — Cinematic AI Video & Image Studio",
    ogDescription:
      "The AI studio that produces the most cinematic images and videos on the market. Full creative control over identity, style, and motion. Built for creators and agencies who demand elite output.",
    ogImageUrl: "https://modelclone.app/og-lander-new.jpg",
    ogType: "website",
    ogSiteName: "ModelClone",
    twitterCard: "summary_large_image",
    twitterTitle: "ModelClone — Cinematic AI Video & Image Studio",
    twitterDescription:
      "The highest visual quality AI video on the market. Recreate any identity, style, and motion with cinematic precision. Built for creators and agencies.",
    twitterImageUrl: "https://modelclone.app/og-lander-new.jpg",
    twitterSite: "@modelclone",
    twitterCreator: "@modelclone",
    robots: "index, follow",
    jsonLd: {
      organization: {
        name: "ModelClone",
        url: "https://modelclone.app",
        logo: {
          "@type": "ImageObject",
          url: "https://modelclone.app/modelclone-logo.svg",
          width: 200,
          height: 60,
        },
        sameAs: [
          "https://twitter.com/modelclone",
          "https://discord.gg/modelclone",
          "https://instagram.com/modelclone",
        ],
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          url: "https://modelclone.app",
        },
      },
      webPage: {
        name: "ModelClone — Cinematic AI Video & Image Studio",
        url: "https://modelclone.app/",
        description:
          "Create cinematic AI images and videos with unmatched visual quality. Recreate any identity, style, and motion with precision.",
        isPartOf: {
          "@type": "WebSite",
          name: "ModelClone",
          url: "https://modelclone.app",
        },
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Home",
              item: "https://modelclone.app/",
            },
          ],
        },
      },
      softwareApplication: {
        name: "ModelClone",
        url: "https://modelclone.app",
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Web",
        description:
          "AI-powered studio for generating cinematic images and videos with full control over identity, style, and motion. The highest visual quality AI video tool built for creators, agencies, and brands.",
        screenshot: "https://modelclone.app/og-lander-new.jpg",
        featureList: [
          "AI identity recreation",
          "Cinematic AI video generation",
          "AI image generation",
          "Motion transfer",
          "Style control",
          "Agency-grade output consistency",
        ],
        offers: {
          price: "29.00",
          priceCurrency: "USD",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "29.00",
            priceCurrency: "USD",
            unitText: "MONTH",
          },
          availability: "https://schema.org/InStock",
          url: "https://modelclone.app",
        },
        publisher: {
          "@type": "Organization",
          name: "ModelClone",
          url: "https://modelclone.app",
        },
      },
    },
  },

  brand: {
    appName: "ModelClone",
    logoUrl: "",
    ctaText: "Start Creating",
    ctaHref: "/signup",
  },

  promotionBar: {
    enabled: true,
    message: "1 YEAR ANNIVERSARY — 65% OFF UNLIMITED NANO BANANA PRO",
    ctaText: "Get 65% OFF",
    ctaHref: "#pricing",
  },

  countdown: {
    enabled: true,
    eyebrow: "Anniversary Sale",
    targetISO: "2026-05-01T23:59:59Z",
    heading: "Anniversary Release Window — 65% OFF Unlimited Nano Banana Pro",
    body: "Limited access pricing for creators building with high output volume this month.",
    ctaText: "Claim Discount",
    ctaHref: "#pricing",
    finishedText: "Offer ended",
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
        { id: "nano-banana",    title: "Nano Banana Pro",    description: "Flagship 4K image generation pipeline",        mediaType: "video", mediaUrl: "" },
        { id: "motion-control", title: "Motion Control",     description: "Expression and movement control up to 30s",    mediaType: "video", mediaUrl: "" },
        { id: "pro-skin",       title: "Pro Skin Enhancer",  description: "Natural skin detail with preserved texture",   mediaType: "video", mediaUrl: "" },
        { id: "shots",          title: "Shots",              description: "Generate nine usable angles from one frame",   mediaType: "video", mediaUrl: "" },
        { id: "pro-angles",     title: "Pro Angles 2.0",     description: "Fast viewpoint synthesis for coverage",        mediaType: "video", mediaUrl: "" },
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
        { id: "stripe",     name: "Stripe",      logoUrl: "/partners/stripe.svg" },
        { id: "falai",      name: "Fal AI",      logoUrl: "/partners/fal.svg" },
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

  styles: {
    buttonPrimaryBackground: "",
    buttonPrimaryText: "",
    buttonPrimaryBorder: "",
    buttonGhostText: "",
    buttonGhostBorder: "",
    buttonGhostBackground: "",
  },
  layout: {
    spacers: {
      beforeHeader: 0,
      beforeHero: 0,
      beforeCountdown: 0,
      beforeCreateToday: 0,
      beforeTopChoice: 0,
      beforePartners: 0,
      beforePricing: 0,
      beforeFooter: 0,
    },
  },
  spatialOverrides: {},
  styleOverrides: {},
};
