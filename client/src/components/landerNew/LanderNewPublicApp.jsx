import { useEffect, useMemo } from "react";
import { PromoBar } from "../../../../modelclone-landing/src/components/sections/PromoBar";
import { Navbar } from "../../../../modelclone-landing/src/components/sections/Navbar";
import { HeroSlider } from "../../../../modelclone-landing/src/components/sections/HeroSlider";
import { CountdownBanner } from "../../../../modelclone-landing/src/components/sections/CountdownBanner";
import { CreateTodaySection } from "../../../../modelclone-landing/src/components/sections/CreateTodaySection";
import { TopChoiceSection } from "../../../../modelclone-landing/src/components/sections/TopChoiceSection";
import { PartnersSection } from "../../../../modelclone-landing/src/components/sections/PartnersSection";
import { PricingSection } from "../../../../modelclone-landing/src/components/sections/PricingSection";
import { CustomCursor } from "../../../../modelclone-landing/src/components/CustomCursor";
import { landingConfig as STANDALONE_LANDING_CONFIG } from "../../../../modelclone-landing/src/config/landing.config";
import "../../../../modelclone-landing/src/index.css";

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
      appName: config?.brand?.appName || STANDALONE_LANDING_CONFIG.brand.appName || "ModelClone",
      logoText: "MC",
      logoUrl: config?.brand?.logoUrl || "/modelclone-logo.svg",
      loginHref: "/login",
      signupHref: config?.brand?.ctaHref || "/signup",
    },
    promotionBar: STANDALONE_LANDING_CONFIG.promotionBar,
    hero: {
      enabled: true,
      slides: hero.slides?.length
        ? hero.slides
        : STANDALONE_LANDING_CONFIG.hero.slides.map((slide, idx) =>
            idx === 0
              ? {
                  ...slide,
                  title: hero.title || slide.title,
                  description: hero.subtitle || slide.description,
                  mediaUrl: hero.mediaUrl || slide.mediaUrl || "",
                }
              : slide,
          ),
    },
    countdown: STANDALONE_LANDING_CONFIG.countdown,
    createToday: STANDALONE_LANDING_CONFIG.createToday,
    topChoice: {
      enabled: true,
      title: topChoice.heading || "Top Choice",
      subtitle: topChoice.subtitle || STANDALONE_LANDING_CONFIG.topChoice.subtitle,
      items: topChoice.items?.length ? topChoice.items : STANDALONE_LANDING_CONFIG.topChoice.items,
    },
    partners: {
      enabled: true,
      title: partners.heading || "Partners",
      items:
        partners.logos?.length
          ? partners.logos.map((logo) => ({
              name: logo.name,
              logoUrl: logo.logoUrl || "",
            }))
          : STANDALONE_LANDING_CONFIG.partners.items,
    },
    pricing: {
      enabled: true,
      title: pricing.heading || "Pricing",
      subtitle: pricing.subtitle || STANDALONE_LANDING_CONFIG.pricing.subtitle,
      billingCycleDefault: pricing.billingCycleDefault || "monthly",
      signupHref: config?.brand?.ctaHref || "/signup",
      oneTime: {
        name: "Pay As You Go",
        pricePerCredit: Number(
          pricing?.payAsYouGo?.pricePerCredit || STANDALONE_LANDING_CONFIG.pricing.oneTime.pricePerCredit,
        ),
        description:
          pricing?.payAsYouGo?.description || STANDALONE_LANDING_CONFIG.pricing.oneTime.description,
      },
      tiers: pricingTiers.length ? pricingTiers : STANDALONE_LANDING_CONFIG.pricing.tiers,
    },
    footerCta: {
      ...STANDALONE_LANDING_CONFIG.footerCta,
      ctaHref: config?.brand?.ctaHref || "/signup",
    },
  };
}

export default function LanderNewPublicApp({ config }) {
  const data = useMemo(() => mapToStandaloneConfig(config), [config]);
  const { brand, promotionBar, hero, countdown, createToday, topChoice, partners, pricing, footerCta } = data;
  useEffect(() => {
    document.body.classList.add("lander-cursor-enabled");
    return () => {
      document.body.classList.remove("lander-cursor-enabled");
    };
  }, []);

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
