import { useEffect, useState } from "react";

const navLinks = [
  { label: "Explore", href: "#explore" },
  { label: "Image", href: "#image" },
  { label: "Video", href: "#video" },
  { label: "Audio", href: "#audio" },
  { label: "Pricing", href: "#pricing", bolt: true },
];

export function Navbar({ brand }) {
  const [activeHref, setActiveHref] = useState("#explore");

  useEffect(() => {
    const sections = navLinks
      .map((link) => document.querySelector(link.href))
      .filter(Boolean);

    if (!sections.length) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]?.target?.id) {
          setActiveHref(`#${visible[0].target.id}`);
        }
      },
      {
        threshold: [0.2, 0.45, 0.7],
        rootMargin: "-25% 0px -55% 0px",
      },
    );

    sections.forEach((section) => observer.observe(section));

    const handleHashChange = () => {
      if (window.location.hash) {
        setActiveHref(window.location.hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  return (
    <div className="navbar-rounded-shell">
    <header id="header" className="navbar-wrap">
      <nav aria-label="primary navigation" className="container navbar-grid">
        <a href="#" className="brand">
          <span className="brand-mark">
            <svg
              className="brand-logo-svg"
              viewBox="0 0 100 100"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label={`${brand.appName} logo`}
            >
              <defs>
                <linearGradient id="mcLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a855f7" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" rx="20" fill="url(#mcLogoGrad)" />
              <path
                d="M50 25 L65 45 L75 35 L75 75 L25 75 L25 35 L35 45 Z"
                fill="white"
                opacity="0.9"
              />
              <circle cx="40" cy="50" r="3" fill="white" />
              <circle cx="60" cy="50" r="3" fill="white" />
            </svg>
          </span>
          <span>{brand.appName}</span>
        </a>

        <div className="nav-links">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`nav-link ${activeHref === link.href ? "is-active" : ""}`}
              onClick={() => setActiveHref(link.href)}
            >
              {link.bolt ? <span className="bolt">⚡</span> : null}
              {link.label}
            </a>
          ))}
        </div>

        <div className="nav-auth">
          <a href="#login" id="login" className="btn btn-ghost">
            Login
          </a>
          <a href="#signup" id="signup" className="btn btn-primary">
            Sign up
          </a>
        </div>
      </nav>
    </header>
    </div>
  );
}
