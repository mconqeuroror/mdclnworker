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
        offers: {
          price: "29",
          priceCurrency: "USD",
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
  sections: {
    hero: {
      title: "Direct scenes in one continuous flow.",
      subtitle:
        "Write, iterate, and lock visual identity across stills and motion without breaking context.",
      primaryCtaText: "Get Started",
      primaryCtaHref: "/signup",
      secondaryCtaText: "Explore Tools",
      secondaryCtaHref: "#top-choice",
      mediaUrl: "",
    },
    topChoice: {
      heading: "Top Choice",
      items: [
        { id: "nano-banana", title: "Nano Banana Pro", description: "Flagship 4K image generation pipeline" },
        { id: "motion-control", title: "Motion Control", description: "Expression and movement control up to 30s" },
        { id: "shots", title: "Shots", description: "Generate nine usable angles from one frame" },
      ],
    },
    partners: {
      heading: "Partners",
      logos: [
        { id: "kie", name: "KIE AI", logoUrl: "" },
        { id: "wavespeed", name: "WaveSpeed", logoUrl: "" },
        { id: "runpod", name: "RunPod", logoUrl: "" },
        { id: "stripe", name: "Stripe", logoUrl: "" },
      ],
    },
    pricing: {
      heading: "Pricing",
      billingCycleDefault: "monthly",
      tiers: [
        { id: "starter", name: "Starter", credits: 2900, monthly: 29, annual: 289, pricePerCredit: 0.01, popular: false, bonusCredits: 0 },
        { id: "pro", name: "Pro", credits: 8900, monthly: 79, annual: 787, pricePerCredit: 0.0089, popular: true, bonusCredits: 1000 },
        { id: "business", name: "Business", credits: 24900, monthly: 199, annual: 1982, pricePerCredit: 0.008, popular: false, bonusCredits: 5000 },
      ],
      payAsYouGo: {
        pricePerCredit: 0.012,
        description: "One-time credit top-ups. No subscription required.",
      },
    },
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
  styles: {
    buttonPrimaryBackground: "",
    buttonPrimaryText: "",
    buttonPrimaryBorder: "",
    buttonGhostText: "",
    buttonGhostBorder: "",
    buttonGhostBackground: "",
  },
};

