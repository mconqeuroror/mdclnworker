function ChoicePreview({ mediaType = "video", title, imageUrl }) {
  if (imageUrl) {
    return (
      <div className={`choice-preview ${mediaType} has-media`}>
        <img src={imageUrl} alt={title} className="choice-preview-media" />
        <div className="choice-preview-noise" />
      </div>
    );
  }
  return (
    <div className={`choice-preview ${mediaType}`}>
      <div className="choice-preview-glow" />
      <div className="choice-preview-noise" />
      <div className="choice-preview-title">{title}</div>
      <div className="choice-preview-ui">
        <span className="choice-dot" />
        <span className="choice-line" />
      </div>
    </div>
  );
}

export function TopChoiceSection({ data }) {
  const loopItems = [...data.items, ...data.items];
  const origLen = data.items.length;

  return (
    <section className="container top-choice-wrap" id="top-choice">
      <header className="top-choice-header" data-dp-target-id="topChoice.heading">
        <h2>{data.title}</h2>
        <p className="muted">{data.subtitle}</p>
      </header>

      <div className="top-choice-row">
        <div className="top-choice-track">
          {loopItems.map((item, idx) => (
            <article
              key={`${item.title}-${idx}`}
              className="choice-card"
              style={{ animationDelay: `${(idx % origLen) * 55}ms` }}
              {...(idx < origLen ? { "data-dp-target-id": `topChoice.item.${idx}` } : {})}
            >
              <span className="pill">Top Choice</span>
              <ChoicePreview
                mediaType={item.mediaType ?? "video"}
                title={item.title}
                imageUrl={item.imageUrl || ""}
              />
              <h3>{item.title}</h3>
              <p className="muted" style={{ fontSize: "0.82rem" }}>{item.description}</p>
              <a className="choice-link" href="#explore">Explore tool</a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
