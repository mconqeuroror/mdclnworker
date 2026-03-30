export function PromoBar({ data }) {
  return (
    <header id="header-promotion" className="promotion-wrap">
      <div className="container promotion-inner">
        <p className="promotion-text">{data.message}</p>
      </div>
    </header>
  );
}
