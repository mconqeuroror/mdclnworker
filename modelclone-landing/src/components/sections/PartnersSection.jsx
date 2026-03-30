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

  return (
    <section className="partners-wrap" id="partners">
      <div className="container partners-header">
        <h2>{data.title}</h2>
      </div>

      <div className="partners-row">
        <div className="partners-track">
          {loopItems.map((partner, idx) => (
            <PartnerChip key={`${partner.name}-${idx}`} partner={partner} />
          ))}
        </div>
      </div>
    </section>
  );
}
