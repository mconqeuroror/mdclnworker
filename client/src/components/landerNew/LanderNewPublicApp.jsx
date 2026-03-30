import { useMemo } from "react";
import { PromoBar } from "../../../../modelclone-landing/src/components/sections/PromoBar";
import { Navbar } from "../../../../modelclone-landing/src/components/sections/Navbar";
import { HeroSlider } from "../../../../modelclone-landing/src/components/sections/HeroSlider";
import { CountdownBanner } from "../../../../modelclone-landing/src/components/sections/CountdownBanner";
import { CreateTodaySection } from "../../../../modelclone-landing/src/components/sections/CreateTodaySection";
import { TopChoiceSection } from "../../../../modelclone-landing/src/components/sections/TopChoiceSection";
import { PartnersSection } from "../../../../modelclone-landing/src/components/sections/PartnersSection";
import { PricingSection } from "../../../../modelclone-landing/src/components/sections/PricingSection";
import { CustomCursor } from "../../../../modelclone-landing/src/components/CustomCursor";
import "../../../../modelclone-landing/src/index.css";

const FALLBACK = {
  promotionBar: {
    enabled: true,
    message: "1 YEAR ANNIVERSARY - 65% OFF UNLIMITED NANO BANANA PRO",
    ctaText: "Get 65% OFF",
    ctaHref: "#pricing",
  },
  countdown: {
    enabled: false,
    targetISO: "2026-12-31T23:59:59Z",
    heading: "Anniversary Release Window - 65% OFF Unlimited Nano Banana Pro",
    body: "Limited access pricing for creators building with high output volume this month.",
    ctaText: "Claim Discount",
    ctaHref: "#pricing",
  },
  createToday: {
    enabled: false,
    title: "What will you create today?",
    description: "Start from a still, a motion idea, or a character direction.",
    ctaText: "Explore all tools",
    ctaHref: "#explore",
    cards: [
      { title: "Create Image", description: "Author stills with cinematic structure and material realism.", mediaType: "image" },
      { title: "Create Video", description: "Translate visual intent into controlled motion sequences.", mediaType: "video" },
      { title: "Motion Control", description: "Shape timing, camera path, and action beats shot by shot.", mediaType: "video" },
    ],
  },
  footerCta: {
    text: "Build your next viral campaign with ModelClone.",
    ctaText: "Start creating",
    ctaHref: "#signup",
  },
};

function mapToStandaloneConfig(config) {
  const hero = config?.sections?.hero || {};
  const topChoice = config?.sections?.topChoice || {};
  const partners = config?.sections?.partners || {};
  const pricing = config?.sections?.pricing || {};

  const pricingTiers = (pricing.tiers || []).map((tier) => ({
    id: tier.id,
    name: tier.name,
    credits: Number(tier.credits || 0),
    price: tier.price || {
      monthly: Number(tier.monthly || 0),
      annual: Number(tier.annual || 0),
    },
    pricePerCredit: Number(tier.pricePerCredit || 0),
    bonusCredits: Number(tier.bonusCredits || 0),
    popular: Boolean(tier.popular),
  }));

  return {
    brand: {
      appName: config?.brand?.appName || "ModelClone",
      logoText: "MC",
      logoUrl: config?.brand?.logoUrl || "/modelclone-logo.svg",
    },
    promotionBar: FALLBACK.promotionBar,
    hero: {
      enabled: true,
      slides: hero.slides?.length
        ? hero.slides
        : [
            {
              eyebrow: "ModelClone Chat",
              title: hero.title || "Direct scenes in one continuous flow.",
              description:
                hero.subtitle ||
                "Write, iterate, and lock visual identity across stills and motion without breaking context.",
              mediaType: "video",
              mediaUrl: hero.mediaUrl || "",
            },
          ],
    },
    countdown: FALLBACK.countdown,
    createToday: FALLBACK.createToday,
    topChoice: {
      enabled: true,
      title: topChoice.heading || "Top Choice",
      subtitle: topChoice.subtitle || "High-utility tools used in daily production",
      items: topChoice.items || [],
    },
    partners: {
      enabled: true,
      title: partners.heading || "Partners",
      items: (partners.logos || []).map((logo) => ({
        name: logo.name,
        logoUrl: logo.logoUrl || "",
      })),
    },
    pricing: {
      enabled: true,
      title: pricing.heading || "Pricing",
      subtitle: pricing.subtitle || "Actual ModelClone plan pricing and credits",
      billingCycleDefault: pricing.billingCycleDefault || "monthly",
      oneTime: {
        name: "Pay As You Go",
        pricePerCredit: Number(pricing?.payAsYouGo?.pricePerCredit || 0.012),
        description: pricing?.payAsYouGo?.description || "One-time credit top-ups. No subscription required.",
      },
      tiers: pricingTiers,
    },
    footerCta: FALLBACK.footerCta,
  };
}

export default function LanderNewPublicApp({ config }) {
  const data = useMemo(() => mapToStandaloneConfig(config), [config]);
  const { brand, promotionBar, hero, countdown, createToday, topChoice, partners, pricing, footerCta } = data;

  return (
    <div className="page">
      <div className="legacy-grid-bg" aria-hidden="true" />
      <CustomCursor />
      <div className="site-header-shell">
        {promotionBar.enabled && <PromoBar data={promotionBar} />}
        <Navbar brand={brand} />
      </div>

      <main id="main">
        {hero.enabled && <HeroSlider data={hero} />}
        {countdown.enabled && <CountdownBanner data={countdown} />}
        {createToday.enabled && <CreateTodaySection data={createToday} />}
        {topChoice.enabled && <TopChoiceSection data={topChoice} />}
        {partners.enabled && <PartnersSection data={partners} />}
        {pricing.enabled && <PricingSection data={pricing} />}
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <p>{footerCta.text}</p>
          <a href={footerCta.ctaHref} className="btn btn-primary">
            {footerCta.ctaText}
          </a>
        </div>
      </footer>
    </div>
  );
}
