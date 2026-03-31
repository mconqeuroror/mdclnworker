import { useEffect, useState } from "react";

function ToolCard({ item, isFeatured, slot }) {
  const hasMedia = Boolean(item.mediaUrl);

  return (
    <article
      className={`tool-card ${isFeatured ? "is-featured" : "is-side"} tool-card--${slot}`}
    >
      <div className={`cinematic-thumb ${item.mediaType}`}>
        {hasMedia ? (
          item.mediaType === "video" ? (
            <video
              key={item.mediaUrl}
              src={item.mediaUrl}
              autoPlay
              muted
              loop
              playsInline
              className="cinematic-thumb-media"
            />
          ) : (
            <img
              src={item.mediaUrl}
              alt={item.title}
              className="cinematic-thumb-media"
            />
          )
        ) : (
          <>
            <div className="cinematic-thumb-noise" />
          </>
        )}
      </div>
      <h3>{item.title}</h3>
      <p className="muted">{item.description}</p>
    </article>
  );
}

export function CreateTodaySection({ data }) {
  const [featured, setFeatured] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFeatured(prev => (prev + 1) % data.cards.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [data.cards.length]);

  return (
    <section className="container create-wrap">
      <header className="create-header">
        <div>
          <p className="eyebrow" style={{ marginBottom: "0.6rem" }}>Create</p>
          <h2>{data.title}</h2>
        </div>
        <p className="muted">{data.description}</p>
        <a className="btn btn-primary" href={data.ctaHref} style={{ alignSelf: "flex-start" }}>
          {data.ctaText}
        </a>
      </header>

      <div className="create-grid">
        {data.cards
          .map((card, idx) => {
            const len = data.cards.length;
            const delta = (idx - featured + len) % len;
            const isCenter = delta === 0;
            const isRight  = delta === 1;
            const isLeft   = delta === len - 1;
            return {
              card, idx, isCenter,
              slot: isCenter ? "center" : isRight ? "right" : isLeft ? "left" : "hidden",
              order: isCenter ? 2 : isRight ? 3 : isLeft ? 1 : 99,
            };
          })
          .filter(e => e.slot !== "hidden")
          .sort((a, b) => a.order - b.order)
          .map(entry => (
            <ToolCard
              key={`${entry.card.title}-${entry.idx}`}
              item={entry.card}
              slot={entry.slot}
              isFeatured={entry.isCenter}
            />
          ))}
      </div>
    </section>
  );
}
