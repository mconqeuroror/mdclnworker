import { useEffect, useRef, useState } from "react";

const FALLBACK_MS = 5000; // used when slide has no video

function CinematicStill({ type = "video", title, tag }) {
  return (
    <div className={`cinematic-still ${type}`}>
      <div className="cinematic-still-bars" />
      <div className="cinematic-still-grain" />
      <div className="cinematic-still-vignette" />
      <div className="cinematic-still-meta">
        <span>{tag || "ModelClone"}</span>
        <span>Shot 02</span>
      </div>
      <div className="cinematic-still-caption">
        <p>{title}</p>
      </div>
    </div>
  );
}

export function HeroSlider({ data }) {
  const [active, setActive]           = useState(0);
  const [chipDuration, setChipDuration] = useState(FALLBACK_MS);
  const timerRef  = useRef(null);

  const advance = () => setActive(prev => (prev + 1) % data.slides.length);

  const goTo = (idx) => {
    clearTimeout(timerRef.current);
    setActive(idx);
    setChipDuration(FALLBACK_MS); // will be overridden when video metadata loads
  };

  // For non-video slides use a fixed timer; videos drive timing via onEnded
  useEffect(() => {
    clearTimeout(timerRef.current);
    const slide = data.slides[active];
    const hasVideo = slide?.mediaUrl && slide.mediaType === "video";
    if (!hasVideo) {
      timerRef.current = setTimeout(advance, FALLBACK_MS);
    }
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, data.slides.length]);

  const slide = data.slides[active];
  const hasVideo = slide?.mediaUrl && slide.mediaType === "video";

  return (
    <section className="container hero-wrap" id="explore">
      {/* Hero panel */}
      <div className="hero-panel" id="image">
        <div className="hero-copy" data-dp-target-id="hero.copy">
          <p className="eyebrow">{slide.eyebrow}</p>
          <h1>{slide.title}</h1>
          <p className="muted">{slide.description}</p>
        </div>

        <div className="hero-media" id="video" data-dp-target-id="hero.media">
          {slide.mediaUrl ? (
            hasVideo ? (
              <video
                // key forces re-mount when slide or src changes
                key={`${active}-${slide.mediaUrl}`}
                src={slide.mediaUrl}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={e => {
                  const dur = e.target.duration;
                  if (isFinite(dur) && dur > 0) setChipDuration(dur * 1000);
                }}
                onEnded={advance}
              />
            ) : (
              <img src={slide.mediaUrl} alt={slide.title} />
            )
          ) : (
            <CinematicStill
              key={`${active}-${slide.eyebrow}`}
              type={slide.mediaType}
              title={slide.title}
              tag={slide.eyebrow}
            />
          )}
        </div>
      </div>
    </section>
  );
}
