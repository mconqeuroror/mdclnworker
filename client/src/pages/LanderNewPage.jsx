import { useEffect, useMemo, useState } from "react";
import { landerNewAPI } from "../services/api";
import { LANDER_NEW_DEFAULTS } from "../landerNew/defaults";
import { deepMerge } from "../landerNew/utils";
import LanderNewPublicApp from "../components/landerNew/LanderNewPublicApp";

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
  const [config, setConfig] = useState(LANDER_NEW_DEFAULTS);
  const [loading, setLoading] = useState(true);

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

  const seo = useMemo(() => config?.seo || LANDER_NEW_DEFAULTS.seo, [config]);

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

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-300">Loading lander...</div>;

  return <LanderNewPublicApp config={config} />;
}

