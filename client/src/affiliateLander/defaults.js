/** Client merge anchor — must match keys produced by the API `defaultAffiliateLanderConfig`. */
export function newAffiliateBlockId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `blk_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const AFFILIATE_LANDER_DEFAULTS = {
  blocks: [],
  spatialOverrides: {},
  styleOverrides: {},
  styles: {
    buttonPrimaryBackground: "",
    buttonPrimaryText: "",
    buttonPrimaryBorder: "",
    buttonGhostText: "",
    buttonGhostBorder: "",
    buttonGhostBackground: "",
  },
  seo: {
    title: "Affiliate landing",
    description: "",
    canonicalUrl: "",
    robots: "index,follow",
    ogTitle: "",
    ogDescription: "",
    ogImageUrl: "",
    ogType: "website",
    ogSiteName: "ModelClone",
    twitterCard: "summary_large_image",
    twitterTitle: "",
    twitterDescription: "",
    twitterImageUrl: "",
    twitterSite: "",
    twitterCreator: "",
    jsonLd: null,
  },
};

export const AFFILIATE_BLOCK_TYPES = [
  { type: "heading", label: "Heading" },
  { type: "subheading", label: "Subheading" },
  { type: "video", label: "Video" },
  { type: "button", label: "Button" },
];

export function emptyBlock(type) {
  const id = newAffiliateBlockId();
  if (type === "heading") return { id, type, text: "New heading" };
  if (type === "subheading") return { id, type, text: "New subheading" };
  if (type === "video") return { id, type, videoUrl: "", posterUrl: "" };
  if (type === "button") return { id, type, label: "Button", href: "/signup" };
  return { id, type: "heading", text: "" };
}
