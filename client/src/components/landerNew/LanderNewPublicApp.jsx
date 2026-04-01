import { useEffect, useMemo } from "react";
import { LOCAL_BRANDING } from "../../config/branding";
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

function mergeSlides(adminSlides, standaloneSlides) {
  // For each standalone slide, overlay admin config on top
  return standaloneSlides.map((standSlide, idx) => {
    const admin = adminSlides?.[idx] || {};
    return {
      ...standSlide,
      eyebrow:     admin.eyebrow     || standSlide.eyebrow,
      title:       admin.title       || standSlide.title,
      description: admin.description || standSlide.description,
      mediaType:   admin.mediaType   || standSlide.mediaType,
      mediaUrl:    admin.mediaUrl    || standSlide.mediaUrl || "",
    };
  });
}

function mergeCards(adminCards, standaloneCards) {
  return standaloneCards.map((standCard, idx) => {
    const admin = adminCards?.[idx] || {};
    return {
      ...standCard,
      title:       admin.title       || standCard.title,
      description: admin.description || standCard.description,
      mediaType:   admin.mediaType   || standCard.mediaType,
      mediaUrl:    admin.mediaUrl    || standCard.mediaUrl || "",
    };
  });
}

function mapToStandaloneConfig(config) {
  const hero        = config?.sections?.hero        || {};
  const createToday = config?.sections?.createToday || {};
  const topChoice   = config?.sections?.topChoice   || {};
  const partners    = config?.sections?.partners    || {};
  const pricing     = config?.sections?.pricing     || {};

  const pricingTiers = (pricing.tiers || []).map((tier) => ({
    id: tier.id,
    name: tier.name,
    credits: Number(tier.credits || 0),
    price: tier.price || {
      monthly: Number(tier.monthly || 0),
      annual:  Number(tier.annual  || 0),
    },
    pricePerCredit: Number(tier.pricePerCredit || 0),
    bonusCredits:   Number(tier.bonusCredits   || 0),
    popular: Boolean(tier.popular),
  }));

  return {
    brand: {
      appName:    config?.brand?.appName || LOCAL_BRANDING.appName || "ModelClone",
      logoText:   "MC",
      // Always fall back to LOCAL_BRANDING so the logo never disappears
      logoUrl:    config?.brand?.logoUrl || LOCAL_BRANDING.logoUrl || "/logo-512.png",
      loginHref:  "/login",
      signupHref: config?.brand?.ctaHref || "/signup",
    },

    promotionBar: {
      ...STANDALONE_LANDING_CONFIG.promotionBar,
      enabled: config?.promotionBar?.enabled ?? STANDALONE_LANDING_CONFIG.promotionBar.enabled,
      message: config?.promotionBar?.message ?? STANDALONE_LANDING_CONFIG.promotionBar.message,
      ctaText: config?.promotionBar?.ctaText ?? STANDALONE_LANDING_CONFIG.promotionBar.ctaText,
      ctaHref: config?.promotionBar?.ctaHref ?? STANDALONE_LANDING_CONFIG.promotionBar.ctaHref,
    },

    hero: {
      enabled: true,
      slides: mergeSlides(hero.slides, STANDALONE_LANDING_CONFIG.hero.slides),
    },

    countdown: {
      ...STANDALONE_LANDING_CONFIG.countdown,
      enabled: config?.countdown?.enabled ?? STANDALONE_LANDING_CONFIG.countdown.enabled,
      eyebrow: config?.countdown?.eyebrow ?? STANDALONE_LANDING_CONFIG.countdown.eyebrow,
      finishedText: config?.countdown?.finishedText ?? STANDALONE_LANDING_CONFIG.countdown.finishedText,
      heading:   config?.countdown?.heading   ?? STANDALONE_LANDING_CONFIG.countdown.heading,
      body:      config?.countdown?.body      ?? STANDALONE_LANDING_CONFIG.countdown.body,
      ctaText:   config?.countdown?.ctaText   ?? STANDALONE_LANDING_CONFIG.countdown.ctaText,
      ctaHref:   config?.countdown?.ctaHref   ?? STANDALONE_LANDING_CONFIG.countdown.ctaHref,
      targetISO: config?.countdown?.targetISO ?? STANDALONE_LANDING_CONFIG.countdown.targetISO,
    },

    createToday: {
      ...STANDALONE_LANDING_CONFIG.createToday,
      cards: mergeCards(createToday.cards, STANDALONE_LANDING_CONFIG.createToday.cards),
    },

    topChoice: {
      enabled:  true,
      title:    topChoice.heading  || STANDALONE_LANDING_CONFIG.topChoice.title,
      subtitle: topChoice.subtitle || STANDALONE_LANDING_CONFIG.topChoice.subtitle,
      items: (topChoice.items?.length ? topChoice.items : STANDALONE_LANDING_CONFIG.topChoice.items)
        .map((item, idx) => ({
          ...item,
          mediaType: item.mediaType || STANDALONE_LANDING_CONFIG.topChoice.items?.[idx]?.mediaType || "video",
          // Preserve legacy imageUrl support while using the new mediaUrl field.
          mediaUrl: item.mediaUrl || item.imageUrl || STANDALONE_LANDING_CONFIG.topChoice.items?.[idx]?.mediaUrl || "",
          imageUrl: item.imageUrl || "",
        })),
    },

    partners: {
      enabled: true,
      title:   partners.heading || "Partners",
      items: partners.logos?.length
        ? partners.logos.map((logo) => ({ name: logo.name, logoUrl: logo.logoUrl || "" }))
        : STANDALONE_LANDING_CONFIG.partners.items,
    },

    pricing: {
      enabled: true,
      title:                pricing.heading              || "Pricing",
      subtitle:             pricing.subtitle             || STANDALONE_LANDING_CONFIG.pricing.subtitle,
      billingCycleDefault:  pricing.billingCycleDefault  || "monthly",
      signupHref:           config?.brand?.ctaHref       || "/signup",
      oneTime: {
        name: "Pay As You Go",
        pricePerCredit: Number(pricing?.payAsYouGo?.pricePerCredit || STANDALONE_LANDING_CONFIG.pricing.oneTime.pricePerCredit),
        description:    pricing?.payAsYouGo?.description            || STANDALONE_LANDING_CONFIG.pricing.oneTime.description,
      },
      tiers: pricingTiers.length ? pricingTiers : STANDALONE_LANDING_CONFIG.pricing.tiers,
    },

    footerCta: {
      ...STANDALONE_LANDING_CONFIG.footerCta,
      ctaHref: config?.brand?.ctaHref || "/signup",
    },
    styles: {
      buttonPrimaryBackground: config?.styles?.buttonPrimaryBackground || "",
      buttonPrimaryText: config?.styles?.buttonPrimaryText || "",
      buttonPrimaryBorder: config?.styles?.buttonPrimaryBorder || "",
      buttonGhostText: config?.styles?.buttonGhostText || "",
      buttonGhostBorder: config?.styles?.buttonGhostBorder || "",
      buttonGhostBackground: config?.styles?.buttonGhostBackground || "",
    },
    layout: {
      spacers: {
        beforeHeader: Number(config?.layout?.spacers?.beforeHeader ?? 0) || 0,
        beforeHero: Number(config?.layout?.spacers?.beforeHero ?? 0) || 0,
        beforeCountdown: Number(config?.layout?.spacers?.beforeCountdown ?? 0) || 0,
        beforeCreateToday: Number(config?.layout?.spacers?.beforeCreateToday ?? 0) || 0,
        beforeTopChoice: Number(config?.layout?.spacers?.beforeTopChoice ?? 0) || 0,
        beforePartners: Number(config?.layout?.spacers?.beforePartners ?? 0) || 0,
        beforePricing: Number(config?.layout?.spacers?.beforePricing ?? 0) || 0,
        beforeFooter: Number(config?.layout?.spacers?.beforeFooter ?? 0) || 0,
      },
    },
  };
}

export default function LanderNewPublicApp({ config, noCursor = false, editMode = false }) {
  const data = useMemo(() => mapToStandaloneConfig(config), [config]);
  const { brand, promotionBar, hero, countdown, createToday, topChoice, partners, pricing, footerCta, styles, layout } = data;
  const spacers = layout?.spacers || {};
  const clampSpacer = (value) => Math.max(0, Math.min(600, Number(value) || 0));
  const renderSpacer = (value, targetId) => {
    const px = clampSpacer(value);
    if (px <= 0) return null;
    return <div data-dp-target-id={targetId} style={{ height: `${px}px` }} aria-hidden="true" />;
  };
  const rootStyle = {
    "--dp-btn-primary-bg": styles?.buttonPrimaryBackground || undefined,
    "--dp-btn-primary-text": styles?.buttonPrimaryText || undefined,
    "--dp-btn-primary-border": styles?.buttonPrimaryBorder || undefined,
    "--dp-btn-ghost-text": styles?.buttonGhostText || undefined,
    "--dp-btn-ghost-border": styles?.buttonGhostBorder || undefined,
    "--dp-btn-ghost-bg": styles?.buttonGhostBackground || undefined,
  };
  useEffect(() => {
    if (noCursor) return undefined;
    document.body.classList.add("lander-cursor-enabled");
    return () => {
      document.body.classList.remove("lander-cursor-enabled");
    };
  }, [noCursor]);

  return (
    <div className={`page${editMode ? " edit-mode" : ""}`} style={rootStyle}>
      <div className="legacy-grid-bg" aria-hidden="true" />
      {!noCursor && <CustomCursor />}
      {promotionBar.enabled && <PromoBar data={promotionBar} />}
      {promotionBar.enabled && renderSpacer(spacers.beforeHeader, "layout.spacer.beforeHeader")}
      <div className="site-header-shell">
        <Navbar brand={brand} />
      </div>

      <main id="main">
        {renderSpacer(spacers.beforeHero, "layout.spacer.beforeHero")}
        {hero.enabled && <HeroSlider data={hero} />}
        {renderSpacer(spacers.beforeCountdown, "layout.spacer.beforeCountdown")}
        {countdown.enabled && <CountdownBanner data={countdown} />}
        {renderSpacer(spacers.beforeCreateToday, "layout.spacer.beforeCreateToday")}
        {createToday.enabled && <CreateTodaySection data={createToday} />}
        {renderSpacer(spacers.beforeTopChoice, "layout.spacer.beforeTopChoice")}
        {topChoice.enabled && <TopChoiceSection data={topChoice} />}
        {renderSpacer(spacers.beforePartners, "layout.spacer.beforePartners")}
        {partners.enabled && <PartnersSection data={partners} />}
        {renderSpacer(spacers.beforePricing, "layout.spacer.beforePricing")}
        {pricing.enabled && <PricingSection data={pricing} />}
      </main>

      {renderSpacer(spacers.beforeFooter, "layout.spacer.beforeFooter")}
      <footer className="site-footer">
        <div className="container footer-inner">
          <p>{footerCta.text}</p>
          <a href={footerCta.ctaHref} className="btn btn-primary" data-dp-target-id="footer.cta">
            {footerCta.ctaText}
          </a>
        </div>
      </footer>
    </div>
  );
}
