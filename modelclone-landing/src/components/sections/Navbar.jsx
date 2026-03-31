import { useEffect, useState } from "react";

const navLinks = [
  { label: "Explore", href: "#explore" },
  { label: "Image", href: "#image" },
  { label: "Video", href: "#video" },
  { label: "Audio", href: "#audio" },
  { label: "Pricing", href: "#pricing" },
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
    <header id="header" className="navbar-wrap" data-dp-target-id="brand">
      <nav aria-label="primary navigation" className="container navbar-grid">
        <a href="#" className="brand">
          <span className="brand-mark">
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={`${brand.appName} logo`} className="brand-logo-img" />
            ) : (
              <span className="brand-logo-fallback" aria-hidden="true">
                {(brand?.appName || "MC").slice(0, 2).toUpperCase()}
              </span>
            )}
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
              {link.label}
            </a>
          ))}
        </div>

        <div className="nav-auth">
          <a href={brand?.loginHref || "/login"} id="login" className="btn btn-ghost" data-dp-target-id="brand.button.login">
            Login
          </a>
          <a href={brand?.signupHref || "/signup"} id="signup" className="btn btn-primary" data-dp-target-id="brand.button.signup">
            Sign up
          </a>
        </div>
      </nav>
    </header>
    </div>
  );
}
