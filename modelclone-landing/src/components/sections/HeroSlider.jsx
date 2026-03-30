import { useEffect, useRef, useState } from "react";

const ADVANCE_MS = 5000;

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
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  const goTo = (idx) => {
    setActive(idx);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(advance, ADVANCE_MS);
  };

  const advance = () => {
    setActive((prev) => (prev + 1) % data.slides.length);
  };

  useEffect(() => {
    timerRef.current = setInterval(advance, ADVANCE_MS);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.slides.length]);

  const slide = data.slides[active];

  return (
    <section className="container hero-wrap" id="explore">
      {/* Tab chips with auto-advance progress */}
      <div className="hero-track">
        {data.slides.map((s, idx) => (
          <button
            key={`${s.eyebrow}-${idx}`}
            type="button"
            onClick={() => goTo(idx)}
            className={`hero-chip ${active === idx ? "is-active" : ""}`}
            style={active === idx ? { "--chip-duration": `${ADVANCE_MS}ms` } : {}}
          >
            {s.eyebrow}
          </button>
        ))}
      </div>

      {/* Hero panel */}
      <div className="hero-panel" id="image">
        <div className="hero-copy">
          <p className="eyebrow">{slide.eyebrow}</p>
          <h1>{slide.title}</h1>
          <p className="muted">{slide.description}</p>
        </div>

        <div className="hero-media" id="video">
          {slide.mediaUrl ? (
            slide.mediaType === "video" ? (
              <video src={slide.mediaUrl} autoPlay muted loop playsInline />
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
