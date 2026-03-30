import { useMemo, useRef } from "react";
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
  const hero = config.sections.hero;
  const topChoice = config.sections.topChoice;
  const partners = config.sections.partners;
  const pricing = config.sections.pricing;

  return (
    <div className="lander-new-shell" onClick={() => editMode && onSelect(null)}>
      <section className="lander-new-hero">
        <Editable
          id="brand.logo"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "brand.logo", breakpoint)}
        >
          <div className="lander-new-brand">
            {config.brand.logoUrl ? <img src={config.brand.logoUrl} alt={config.brand.appName} /> : <span>MC</span>}
            <strong>{config.brand.appName}</strong>
          </div>
        </Editable>

        <Editable
          id="hero.title"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "hero.title", breakpoint)}
        >
          <h1>{hero.title}</h1>
        </Editable>

        <Editable
          id="hero.subtitle"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "hero.subtitle", breakpoint)}
        >
          <p>{hero.subtitle}</p>
        </Editable>

        <div className="lander-new-hero-cta-row">
          <Editable
            id="hero.cta.primary"
            editMode={editMode}
            selectedId={selectedId}
            onSelect={onSelect}
            onDragLayoutChange={onDragLayoutChange}
            layout={resolveLayout(config, "hero.cta.primary", breakpoint)}
          >
            <a className="btn btn-primary" href={hero.primaryCtaHref}>{hero.primaryCtaText}</a>
          </Editable>
          <Editable
            id="hero.cta.secondary"
            editMode={editMode}
            selectedId={selectedId}
            onSelect={onSelect}
            onDragLayoutChange={onDragLayoutChange}
            layout={resolveLayout(config, "hero.cta.secondary", breakpoint)}
          >
            <a className="btn btn-ghost" href={hero.secondaryCtaHref}>{hero.secondaryCtaText}</a>
          </Editable>
        </div>
      </section>

      <section className="lander-new-block">
        <Editable
          id="topChoice.heading"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "topChoice.heading", breakpoint)}
        >
          <h2>{topChoice.heading}</h2>
        </Editable>
        <div className="lander-new-grid3">
          {(topChoice.items || []).map((item) => (
            <article key={item.id} className="lander-card">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lander-new-block">
        <Editable
          id="partners.heading"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "partners.heading", breakpoint)}
        >
          <h2>{partners.heading}</h2>
        </Editable>
        <div className="lander-new-partners">
          {(partners.logos || []).map((logo) => (
            <div key={logo.id} className="partner-chip">
              {logo.logoUrl ? (
                <img src={logo.logoUrl} alt={logo.name} className="partner-chip-logo" />
              ) : (
                <span className="partner-chip-empty" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="lander-new-block">
        <Editable
          id="pricing.heading"
          editMode={editMode}
          selectedId={selectedId}
          onSelect={onSelect}
          onDragLayoutChange={onDragLayoutChange}
          layout={resolveLayout(config, "pricing.heading", breakpoint)}
        >
          <h2>{pricing.heading}</h2>
        </Editable>
        <div className="lander-new-grid3">
          {(pricing.tiers || []).map((tier) => (
            <article key={tier.id} className={`pricing-card-glass${tier.popular ? " is-popular" : ""}`}>
              <span className="pricing-card-pill">{tier.name}</span>
              <p className="pricing-card-credits-value">{Number(tier.credits || 0).toLocaleString()}</p>
              <p className="pricing-card-credits-label">credits / month</p>
              <div className="pricing-card-price-area">
                <span className="pricing-card-price">
                  ${pricing.billingCycleDefault === "annual" ? tier.annual : tier.monthly}
                </span>
                <span className="pricing-card-per">/{pricing.billingCycleDefault === "annual" ? "yr" : "mo"}</span>
              </div>
            </article>
          ))}
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

