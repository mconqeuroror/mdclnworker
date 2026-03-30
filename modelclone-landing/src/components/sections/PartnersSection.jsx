function PartnerChip({ partner }) {
  return (
    <div className="partner-chip">
      {partner.logoUrl ? (
        <img
          src={partner.logoUrl}
          alt={partner.name}
          className="partner-chip-logo"
          loading="lazy"
          draggable="false"
        />
      ) : (
        <span className="partner-chip-empty" aria-hidden="true" />
      )}
    </div>
  );
}

export function PartnersSection({ data }) {
  const loopItems = [...data.items, ...data.items];
  const origLen = data.items.length;

  return (
    <section className="partners-wrap" id="partners">
      <div className="container partners-header" data-ale-id="partners.heading">
        <h2>{data.title}</h2>
      </div>

      <div className="partners-row">
        <div className="partners-track">
          {loopItems.map((partner, idx) => (
            <div
              key={`${partner.name}-${idx}`}
              {...(idx < origLen ? { "data-ale-id": `partners.logo.${idx}` } : {})}
            >
              <PartnerChip partner={partner} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
