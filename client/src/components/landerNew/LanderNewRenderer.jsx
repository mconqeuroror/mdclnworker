import { useMemo, useRef, useState } from "react";
import { resolveLayout, setByPath } from "../../landerNew/utils";

function Editable({
  id,
  editMode,
  selectedId,
  onSelect,
  onDragLayoutChange,
  layout,
  children,
}) {
  const dragRef = useRef(null);
  const selected = selectedId === id;

  const style = useMemo(() => {
    if (!editMode) return undefined;
    const x = Number(layout?.x || 0);
    const y = Number(layout?.y || 0);
    const hidden = Boolean(layout?.hidden);
    const width = layout?.width ? `${layout.width}px` : undefined;
    return {
      transform: `translate(${x}px, ${y}px)`,
      width,
      opacity: hidden ? 0.28 : 1,
    };
  }, [editMode, layout]);

  const startDrag = (event) => {
    if (!editMode) return;
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLayout = { x: Number(layout?.x || 0), y: Number(layout?.y || 0) };

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      onDragLayoutChange(id, {
        x: Math.round(startLayout.x + dx),
        y: Math.round(startLayout.y + dy),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={dragRef}
      className={`lander-editable ${selected ? "is-selected" : ""}`}
      style={style}
      onClick={(e) => {
        if (!editMode) return;
        e.stopPropagation();
        onSelect(id);
      }}
      data-edit-id={id}
    >
      {editMode && selected ? (
        <button
          className="lander-drag-handle"
          type="button"
          onPointerDown={startDrag}
          aria-label={`Drag ${id}`}
        >
          Drag
        </button>
      ) : null}
      {children}
    </div>
  );
}

export default function LanderNewRenderer({
  config,
  editMode = false,
  selectedId = null,
  onSelect = () => {},
  onDragLayoutChange = () => {},
  breakpoint = "base",
}) {
  const hero = config.sections?.hero || {};
  const topChoice = config.sections?.topChoice || {};
  const partners = config.sections?.partners || {};
  const pricing = config.sections?.pricing || {};
  const [billingCycle, setBillingCycle] = useState(pricing.billingCycleDefault || "monthly");

  const fallbackTopChoice = [
    { id: "nano-banana", title: "Nano Banana Pro", description: "Flagship 4K image generation pipeline" },
    { id: "motion-control", title: "Motion Control", description: "Expression and movement control up to 30s" },
    { id: "shots", title: "Shots", description: "Generate nine usable angles from one frame" },
  ];
  const fallbackPartners = [
    { id: "kie", name: "KIE AI", logoUrl: "" },
    { id: "wavespeed", name: "WaveSpeed", logoUrl: "" },
    { id: "runpod", name: "RunPod", logoUrl: "" },
    { id: "stripe", name: "Stripe", logoUrl: "/partners/stripe.svg" },
  ];
  const fallbackPricing = [
    { id: "starter", name: "Starter", credits: 2900, monthly: 29, annual: 289, pricePerCredit: 0.01, popular: false, bonusCredits: 0 },
    { id: "pro", name: "Pro", credits: 8900, monthly: 79, annual: 787, pricePerCredit: 0.0089, popular: true, bonusCredits: 1000 },
    { id: "business", name: "Business", credits: 24900, monthly: 199, annual: 1982, pricePerCredit: 0.008, popular: false, bonusCredits: 5000 },
  ];

  const topChoiceItems = topChoice.items?.length ? topChoice.items : fallbackTopChoice;
  const partnerItems = partners.logos?.length ? partners.logos : fallbackPartners;
  const pricingTiers = pricing.tiers?.length ? pricing.tiers : fallbackPricing;
  const payAsYouGo = pricing.payAsYouGo || {
    pricePerCredit: 0.012,
    description: "One-time credit top-ups. No subscription required.",
  };

  const loopTopChoice = [...topChoiceItems, ...topChoiceItems];
  const loopPartners = [...partnerItems, ...partnerItems];
  const formatPerCredit = (value) => Number(value || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const getTierPrice = (tier) => {
    if (tier?.price && typeof tier.price === "object") {
      return billingCycle === "annual" ? tier.price.annual : tier.price.monthly;
    }
    return billingCycle === "annual" ? tier.annual : tier.monthly;
  };

  return (
    <div className="lander-new-shell lander-premium-root" onClick={() => editMode && onSelect(null)}>
      <div className="lander-premium-grid-bg" aria-hidden="true" />
      <header className="lander-premium-nav">
        <Editable
          id="brand.logo"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "brand.logo", breakpoint)}
        >
          <div className="lander-premium-brand">
            {config.brand.logoUrl ? (
              <img src={config.brand.logoUrl} alt={config.brand.appName} />
            ) : (
              <span className="lander-premium-brand-mark">MC</span>
            )}
            <strong>{config.brand.appName || "ModelClone"}</strong>
          </div>
        </Editable>
        <a className="btn btn-primary" href={config.brand.ctaHref || "/signup"}>
          {config.brand.ctaText || "Start Creating"}
        </a>
      </header>

      <section className="lander-premium-hero" id="explore">
        <Editable
          id="hero.title"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "hero.title", breakpoint)}
        >
          <h1>{hero.title || "Direct scenes in one continuous flow."}</h1>
        </Editable>

        <Editable
          id="hero.subtitle"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "hero.subtitle", breakpoint)}
        >
          <p>{hero.subtitle || "Write, iterate, and lock visual identity across stills and motion without breaking context."}</p>
        </Editable>

        <div className="lander-premium-hero-cta-row">
          <Editable
            id="hero.cta.primary"
            editMode={editMode}
            selectedId={selectedId}
            onSelect={onSelect}
            onDragLayoutChange={onDragLayoutChange}
            layout={resolveLayout(config, "hero.cta.primary", breakpoint)}
          >
            <a className="btn btn-primary" href={hero.primaryCtaHref || "/signup"}>
              {hero.primaryCtaText || "Get Started"}
            </a>
          </Editable>
          <Editable
            id="hero.cta.secondary"
            editMode={editMode}
            selectedId={selectedId}
            onSelect={onSelect}
            onDragLayoutChange={onDragLayoutChange}
            layout={resolveLayout(config, "hero.cta.secondary", breakpoint)}
          >
            <a className="btn btn-ghost" href={hero.secondaryCtaHref || "#top-choice"}>
              {hero.secondaryCtaText || "Explore Tools"}
            </a>
          </Editable>
        </div>
        <Editable
          id="hero.media"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "hero.media", breakpoint)}
        >
          {hero.mediaUrl ? (
            <div className="lander-premium-hero-media">
              <img src={hero.mediaUrl} alt={hero.title || "Hero media"} />
            </div>
          ) : null}
        </Editable>
      </section>

      <section className="lander-premium-block" id="top-choice">
        <Editable
          id="topChoice.heading"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "topChoice.heading", breakpoint)}
        >
          <h2>{topChoice.heading || "Top Choice"}</h2>
        </Editable>
        <div className="top-choice-row">
          <div className="top-choice-track">
            {loopTopChoice.map((item, idx) => (
              <article key={`${item.id || item.title}-${idx}`} className="choice-card">
                <span className="pill">Top Choice</span>
                <div className="choice-preview video">
                  <div className="choice-preview-bars" />
                  <div className="choice-preview-glow" />
                  <div className="choice-preview-noise" />
                  <div className="choice-preview-title">{item.title}</div>
                </div>
                <h3>{item.title}</h3>
                <p className="muted">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lander-premium-block" id="partners">
        <Editable
          id="partners.heading"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "partners.heading", breakpoint)}
        >
          <h2>{partners.heading || "Partners"}</h2>
        </Editable>
        <div className="partners-row">
          <div className="partners-track">
            {loopPartners.map((logo, idx) => (
              <div key={`${logo.id || logo.name}-${idx}`} className="partner-chip">
                {logo.logoUrl ? (
                  <img src={logo.logoUrl} alt={logo.name} className="partner-chip-logo" />
                ) : (
                  <span className="partner-chip-empty" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lander-premium-block" id="pricing">
        <Editable
          id="pricing.heading"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "pricing.heading", breakpoint)}
        >
          <h2>{pricing.heading || "Pricing"}</h2>
        </Editable>

        <div className="pricing-cycle-toggle" role="tablist" aria-label="Billing cycle">
          {["monthly", "annual"].map((cycle) => (
            <button
              key={cycle}
              type="button"
              className={`pricing-cycle-btn${billingCycle === cycle ? " is-active" : ""}`}
              onClick={() => setBillingCycle(cycle)}
            >
              {cycle === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>

        <div className="pricing-cards pricing-tiers-row">
          {pricingTiers.map((tier) => (
            <article key={tier.id} className={`pricing-card-glass${tier.popular ? " is-popular" : ""}`}>
              <div className="pricing-card-pill-row">
                <span className="pricing-card-pill">{tier.name}</span>
                {tier.popular ? <span className="pricing-card-crown-badge">Popular</span> : null}
              </div>
              <p className="pricing-card-credits-value">{Number(tier.credits || 0).toLocaleString()}</p>
              <p className="pricing-card-credits-label">credits / month</p>
              <div className="pricing-card-price-area">
                <span className="pricing-card-price">${getTierPrice(tier)}</span>
                <span className="pricing-card-per">/{billingCycle === "annual" ? "yr" : "mo"}</span>
              </div>
              <p className="pricing-card-desc">${formatPerCredit(tier.pricePerCredit)}/credit</p>
              {tier.bonusCredits ? <p className="pricing-card-bonus">+{Number(tier.bonusCredits).toLocaleString()} bonus</p> : null}
            </article>
          ))}
        </div>

        <div className="pricing-payg-row">
          <article className="pricing-card-glass pricing-card-payg">
            <div className="pricing-payg-inner">
              <div>
                <span className="pricing-card-pill">Flexible</span>
                <p className="pricing-payg-title">Pay As You Go</p>
                <p className="pricing-card-desc">{payAsYouGo.description}</p>
              </div>
              <div className="pricing-card-price-area">
                <span className="pricing-card-price">${formatPerCredit(payAsYouGo.pricePerCredit)}</span>
                <span className="pricing-card-per">/credit</span>
              </div>
            </div>
          </article>
        </div>

        <div className="pricing-section-perks">
          <span className="pricing-perk-chip">Credits reset monthly</span>
          <span className="pricing-perk-chip">Bonus credits never expire</span>
          <span className="pricing-perk-chip">Full commercial rights</span>
        </div>
      </section>
    </div>
  );
}

export function patchLayoutAtBreakpoint(config, targetId, breakpoint, patch) {
  const path = `layout.${targetId}.${breakpoint}`;
  const current = resolveLayout(config, targetId, breakpoint);
  return setByPath(config, path, { ...current, ...patch });
}

