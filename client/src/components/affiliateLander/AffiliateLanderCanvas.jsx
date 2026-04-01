import "../../../../modelclone-landing/src/index.css";

export default function AffiliateLanderCanvas({ config, editMode = false }) {
  const blocks = config?.blocks ?? [];
  const styles = config?.styles ?? {};
  const rootStyle = {
    "--dp-btn-primary-bg": styles?.buttonPrimaryBackground || undefined,
    "--dp-btn-primary-text": styles?.buttonPrimaryText || undefined,
    "--dp-btn-primary-border": styles?.buttonPrimaryBorder || undefined,
    "--dp-btn-ghost-text": styles?.buttonGhostText || undefined,
    "--dp-btn-ghost-border": styles?.buttonGhostBorder || undefined,
    "--dp-btn-ghost-bg": styles?.buttonGhostBackground || undefined,
  };

  return (
    <div className={`page aff-lander-page${editMode ? " edit-mode" : ""}`} style={rootStyle}>
      <div className="legacy-grid-bg" aria-hidden="true" />
      <main className="aff-lander-main container">
        <div className="aff-lander-stack">
          {blocks.map((block) => {
            if (block.type === "heading") {
              return (
                <div key={block.id} className="aff-lander-block" data-dp-target-id={block.id}>
                  <h1 className="aff-lander-h1">{block.text || " "}</h1>
                </div>
              );
            }
            if (block.type === "subheading") {
              return (
                <div key={block.id} className="aff-lander-block" data-dp-target-id={block.id}>
                  <p className="aff-lander-sub">{block.text || " "}</p>
                </div>
              );
            }
            if (block.type === "video") {
              return (
                <div key={block.id} className="aff-lander-block aff-lander-block-video" data-dp-target-id={block.id}>
                  {block.videoUrl ? (
                    <video
                      className="aff-lander-video"
                      src={block.videoUrl}
                      poster={block.posterUrl || undefined}
                      controls
                      playsInline
                      preload="metadata"
                    >
                      <track kind="captions" />
                    </video>
                  ) : (
                    <div className="aff-lander-video-placeholder">
                      <span>Video placeholder</span>
                      <span className="aff-lander-video-hint">Add a video URL in the editor</span>
                    </div>
                  )}
                </div>
              );
            }
            if (block.type === "button") {
              return (
                <div key={block.id} className="aff-lander-block aff-lander-block-btn" data-dp-target-id={block.id}>
                  <a className="btn btn-primary" href={block.href || "/signup"}>
                    {block.label || "Button"}
                  </a>
                </div>
              );
            }
            return null;
          })}
        </div>
      </main>
      <style>{`
        .aff-lander-page {
          min-height: 100vh;
          background: #07070c;
          color: #e8e8ef;
        }
        .aff-lander-main {
          padding: 3rem 1.25rem 4rem;
          max-width: 720px;
        }
        .aff-lander-stack {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 1.25rem;
        }
        .aff-lander-block {
          position: relative;
        }
        .aff-lander-h1 {
          font-size: clamp(1.75rem, 4vw, 2.35rem);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.15;
          margin: 0;
        }
        .aff-lander-sub {
          font-size: 1.05rem;
          line-height: 1.55;
          color: rgba(232, 232, 239, 0.72);
          margin: 0;
        }
        .aff-lander-video {
          width: 100%;
          border-radius: 12px;
          background: #111;
          display: block;
        }
        .aff-lander-video-placeholder {
          aspect-ratio: 16 / 9;
          border-radius: 12px;
          border: 1px dashed rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.04);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          color: rgba(255, 255, 255, 0.45);
          font-size: 0.9rem;
        }
        .aff-lander-video-hint {
          font-size: 0.75rem;
          opacity: 0.7;
        }
        .aff-lander-block-btn .btn {
          display: inline-flex;
        }
      `}</style>
    </div>
  );
}
