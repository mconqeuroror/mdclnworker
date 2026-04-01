import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { affiliateLanderPublicAPI } from "../services/api";
import { AFFILIATE_LANDER_DEFAULTS } from "../affiliateLander/defaults";
import { deepMerge } from "../landerNew/utils";
import AffiliateLanderCanvas from "../components/affiliateLander/AffiliateLanderCanvas";

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

export default function AffiliateLanderPublicPage() {
  const { suffix: suffixParam } = useParams();
  const suffix = String(suffixParam || "").trim();
  const [config, setConfig] = useState(() => ({ ...AFFILIATE_LANDER_DEFAULTS, blocks: [] }));
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    setNotFound(false);
    setLoading(true);
    (async () => {
      if (!suffix) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      try {
        const res = await affiliateLanderPublicAPI.getPublished(suffix);
        if (!alive) return;
        if (!res?.success || !res?.config) {
          setNotFound(true);
          return;
        }
        setConfig(deepMerge({ ...AFFILIATE_LANDER_DEFAULTS, blocks: [] }, res.config));
      } catch {
        if (!alive) return;
        setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [suffix]);

  const seo = useMemo(() => config?.seo || AFFILIATE_LANDER_DEFAULTS.seo, [config]);

  useEffect(() => {
    if (notFound || loading) return;
    document.title = seo.title || "ModelClone";
    upsertMeta("meta[name='description']", {
      name: "description",
      content: seo.description || "",
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
    upsertMeta("meta[name='robots']", { name: "robots", content: seo.robots || "index,follow" });
    if (seo.canonicalUrl) {
      upsertLink("link[rel='canonical']", { rel: "canonical", href: seo.canonicalUrl });
    }
  }, [seo, notFound, loading]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-300 bg-[#07070c]">Loading…</div>;
  }
  if (notFound) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-400 bg-[#07070c] px-4 text-center">
        <div>
          <p className="text-white/90 mb-2">This page is not available.</p>
          <a href="/" className="text-violet-400 hover:underline text-sm">
            Home
          </a>
        </div>
      </div>
    );
  }

  return <AffiliateLanderCanvas config={config} editMode={false} />;
}
