import { useEffect, useMemo, useState, useRef, useSyncExternalStore } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { landerNewAPI, referralAPI } from "../services/api";
import { LANDER_NEW_DEFAULTS } from "../landerNew/defaults";
import { deepMerge } from "../landerNew/utils";
import LanderNewPublicApp from "../components/landerNew/LanderNewPublicApp";
import { generateFingerprint } from "../utils/fingerprint";
import { useAuthStore } from "../store";

function useHasHydrated() {
  return useSyncExternalStore(
    (callback) => useAuthStore.persist.onFinishHydration(callback),
    () => useAuthStore.persist.hasHydrated(),
    () => false,
  );
}

function upsertMeta(selector, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
}

function upsertLink(selector, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("link");
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
}

function upsertJsonLd(id, data) {
  let el = document.head.querySelector(`script[data-jsonld='${id}']`);
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.setAttribute("data-jsonld", id);
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export default function LanderNewPage() {
  const location = useLocation();
  const [config, setConfig] = useState(LANDER_NEW_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const hasHydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [sessionValid, setSessionValid] = useState(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await landerNewAPI.getPublicConfig();
        if (!alive) return;
        setConfig(deepMerge(LANDER_NEW_DEFAULTS, res?.config || {}));
      } catch (error) {
        console.error("Failed to load /lander-new config:", error);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref")?.trim().toLowerCase();
    if (!ref) return;
    try {
      localStorage.setItem("pendingReferralCode", ref);
    } catch {
      /* ignore */
    }
    (async () => {
      try {
        const fp = await generateFingerprint();
        await referralAPI.captureHint(
          ref,
          fp?.visitorId || "no-fingerprint-available",
          navigator.userAgent || "Unknown",
        );
      } catch {
        /* best-effort */
      }
    })();
  }, [location.search]);

  useEffect(() => {
    if (!isAuthenticated || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      try {
        const { authAPI } = await import("../services/api");
        const res = await authAPI.getProfile();
        if (res?.success) setSessionValid(true);
        else setSessionValid(false);
      } catch {
        setSessionValid(false);
        try {
          useAuthStore.setState({ user: null, isAuthenticated: false });
        } catch {
          /* ignore */
        }
      }
    })();
  }, [isAuthenticated]);

  const seo = useMemo(() => {
    const base = config?.seo || LANDER_NEW_DEFAULTS.seo;
    const path = location.pathname;
    if (path === "/create-ai-model") {
      return {
        ...base,
        canonicalUrl: "https://modelclone.app/create-ai-model",
        jsonLd: base.jsonLd
          ? {
              ...base.jsonLd,
              webPage: base.jsonLd.webPage
                ? { ...base.jsonLd.webPage, url: "https://modelclone.app/create-ai-model" }
                : base.jsonLd.webPage,
            }
          : base.jsonLd,
      };
    }
    if (path === "/") {
      return {
        ...base,
        canonicalUrl: "https://modelclone.app/",
        jsonLd: base.jsonLd
          ? {
              ...base.jsonLd,
              webPage: base.jsonLd.webPage
                ? { ...base.jsonLd.webPage, url: "https://modelclone.app/" }
                : base.jsonLd.webPage,
            }
          : base.jsonLd,
      };
    }
    return base;
  }, [config, location.pathname]);

  useEffect(() => {
    document.title = seo.title || LANDER_NEW_DEFAULTS.seo.title;
    upsertMeta("meta[name='description']", {
      name: "description",
      content: seo.description || LANDER_NEW_DEFAULTS.seo.description,
    });
    upsertMeta("meta[property='og:title']", { property: "og:title", content: seo.ogTitle || seo.title });
    upsertMeta("meta[property='og:description']", {
      property: "og:description",
      content: seo.ogDescription || seo.description,
    });
    upsertMeta("meta[property='og:type']", { property: "og:type", content: seo.ogType || "website" });
    upsertMeta("meta[property='og:site_name']", { property: "og:site_name", content: seo.ogSiteName || "ModelClone" });
    upsertMeta("meta[property='og:url']", { property: "og:url", content: seo.canonicalUrl || window.location.href });
    if (seo.ogImageUrl) {
      upsertMeta("meta[property='og:image']", { property: "og:image", content: seo.ogImageUrl });
    }
    upsertMeta("meta[name='twitter:card']", { name: "twitter:card", content: seo.twitterCard || "summary_large_image" });
    upsertMeta("meta[name='twitter:title']", { name: "twitter:title", content: seo.twitterTitle || seo.title });
    upsertMeta("meta[name='twitter:description']", {
      name: "twitter:description",
      content: seo.twitterDescription || seo.description,
    });
    if (seo.twitterImageUrl) {
      upsertMeta("meta[name='twitter:image']", { name: "twitter:image", content: seo.twitterImageUrl });
    }
    if (seo.twitterSite) {
      upsertMeta("meta[name='twitter:site']", { name: "twitter:site", content: seo.twitterSite });
    }
    if (seo.twitterCreator) {
      upsertMeta("meta[name='twitter:creator']", { name: "twitter:creator", content: seo.twitterCreator });
    }
    upsertMeta("meta[name='robots']", { name: "robots", content: seo.robots || "index,follow" });
    if (seo.canonicalUrl) {
      upsertLink("link[rel='canonical']", { rel: "canonical", href: seo.canonicalUrl });
    }

    const organization = seo?.jsonLd?.organization
      ? {
          "@context": "https://schema.org",
          "@type": "Organization",
          ...seo.jsonLd.organization,
        }
      : null;
    const webPage = seo?.jsonLd?.webPage
      ? {
          "@context": "https://schema.org",
          "@type": "WebPage",
          ...seo.jsonLd.webPage,
        }
      : null;
    const softwareApplication = seo?.jsonLd?.softwareApplication
      ? {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          ...seo.jsonLd.softwareApplication,
        }
      : null;
    if (organization) upsertJsonLd("lander-new-org", organization);
    if (webPage) upsertJsonLd("lander-new-page", webPage);
    if (softwareApplication) upsertJsonLd("lander-new-app", softwareApplication);
  }, [seo]);

  if (!hasHydrated) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-300 text-sm animate-pulse">
        Loading…
      </div>
    );
  }

  if (isAuthenticated && sessionValid === true) {
    return <Navigate to="/dashboard" replace />;
  }

  if (isAuthenticated && sessionValid === null) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-300 text-sm animate-pulse">
        Loading…
      </div>
    );
  }

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-300">Loading lander...</div>;

  return <LanderNewPublicApp config={config} />;
}

