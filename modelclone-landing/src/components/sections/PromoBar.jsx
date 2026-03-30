export function PromoBar({ data }) {
  return (
    <header id="header-promotion" className="promotion-wrap" data-dp-target-id="promo">
      <div className="container promotion-inner">
        <p className="promotion-text">{data.message}</p>
        {data.ctaText && data.ctaHref && (
          <a href={data.ctaHref} className="promotion-cta">{data.ctaText}</a>
        )}
      </div>
    </header>
  );
}
