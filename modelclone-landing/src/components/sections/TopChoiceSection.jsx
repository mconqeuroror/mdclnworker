function inferPreviewType(mediaType, mediaUrl) {
  const explicit = String(mediaType || "").toLowerCase().trim();
  const lowerUrl = String(mediaUrl || "").toLowerCase();
  const looksLikeImage = /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/.test(lowerUrl);
  const looksLikeVideo = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/.test(lowerUrl);

  // Backward compatibility: older configs often kept mediaType as "video"
  // while providing only image URLs through imageUrl/mediaUrl.
  if (looksLikeImage) return "image";
  if (looksLikeVideo) return "video";
  if (explicit === "image" || explicit === "video") return explicit;
  return "video";
}

function resolvePreviewUrl(item) {
  return item.mediaUrl || item.videoUrl || item.imageUrl || "";
}

function ChoicePreview({ item }) {
  const previewUrl = resolvePreviewUrl(item);
  const resolvedType = inferPreviewType(item.mediaType, previewUrl);
  if (previewUrl) {
    return (
      <div className={`choice-preview ${resolvedType} has-media`}>
        {resolvedType === "video" ? (
          <video
            src={previewUrl}
            className="choice-preview-media"
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <img src={previewUrl} alt={item.title} className="choice-preview-media" />
        )}
        <div className="choice-preview-noise" />
      </div>
    );
  }
  return (
    <div className={`choice-preview ${resolvedType}`}>
      <div className="choice-preview-glow" />
      <div className="choice-preview-noise" />
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
              <ChoicePreview item={item} />
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
