/**
 * Reel Finder — rebuilt from scratch.
 * Works with thumbnail-only reels (video fetched on demand via Apify).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { SiInstagram } from "react-icons/si";
import {
  TrendingUp, RefreshCw, Play, X, Volume2, VolumeX,
  Download, ExternalLink, Heart, MessageCircle, Send,
  Eye, Clock, Lock, Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";
import { useAuthStore } from "../store";
import { hasPremiumAccess } from "../utils/premiumAccess";

// Resolve API base once
const API_BASE = (() => {
  const u = (import.meta.env.VITE_API_URL || "").replace(/\/api\/?$/, "");
  return u ? `${u}/api` : "/api";
})();

// ── URL builders ─────────────────────────────────────────────────────────────

function thumbSrc(reel, token) {
  const url = reel?.thumbnail_url;
  if (!url) return null;
  // R2 public URLs — serve directly
  if (url.includes("r2.dev") || (import.meta.env.VITE_R2_PUBLIC_URL && url.startsWith(import.meta.env.VITE_R2_PUBLIC_URL))) {
    return url;
  }
  const base = `${API_BASE}/viral-reels/media?url=${encodeURIComponent(url)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

function streamSrc(reelId) {
  return reelId ? `${API_BASE}/viral-reels/${reelId}/stream` : null;
}

async function getStreamWithToken(reelId) {
  if (!reelId) return null;
  try {
    const { data } = await api.get(`/viral-reels/${reelId}/stream-token`);
    const token = data?.token;
    return token ? `${streamSrc(reelId)}?token=${encodeURIComponent(token)}` : streamSrc(reelId);
  } catch {
    return streamSrc(reelId);
  }
}

async function getDownloadWithToken(reelId) {
  if (!reelId) return null;
  const base = `${API_BASE}/viral-reels/${reelId}/download`;
  try {
    const { data } = await api.get(`/viral-reels/${reelId}/stream-token`);
    const token = data?.token;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  } catch {
    return base;
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function fmt(n) {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ago(date) {
  if (!date) return "—";
  const h = Math.floor((Date.now() - new Date(date).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function engRate(reel) {
  const v = reel.views || 0;
  if (!v) return null;
  const e = (reel.likes || 0) + (reel.comments || 0) + (reel.shares || 0) * 3;
  return ((e / v) * 100).toFixed(1);
}

// ── Sub gate ─────────────────────────────────────────────────────────────────

function SubscriptionGate({ onUpgrade }) {
  return (
    <div className="max-w-xl mx-auto rounded-2xl border border-white/[0.12] bg-white/[0.02] backdrop-blur-xl p-10 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl border border-white/[0.16] bg-white/[0.04] flex items-center justify-center mb-5">
        <Lock className="w-7 h-7 text-white" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">Reel Finder</h2>
      <p className="text-slate-400 mb-6 text-sm">
        Discover top-performing Instagram reels ranked by viral score and engagement.
      </p>
      <button
        onClick={onUpgrade}
        className="px-6 py-2.5 rounded-lg bg-white text-black font-semibold hover:bg-slate-100 transition text-sm"
      >
        View Plans
      </button>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function ReelModal({ reel, onClose, token }) {
  const [muted, setMuted] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const videoRef = useRef(null);
  const thumb = thumbSrc(reel, token);

  // Always attempt streaming — the server handles expired CDN URLs by trying
  // an Apify refresh. Only skip if we know there's no reel_url to fall back on.
  useEffect(() => {
    if (!reel?.id) return;
    let cancelled = false;
    setVideoLoading(true);
    setVideoFailed(false);
    setVideoUrl(null);

    getStreamWithToken(reel.id)
      .then((url) => { if (!cancelled) setVideoUrl(url); })
      .catch(() => { if (!cancelled) setVideoFailed(true); })
      .finally(() => { if (!cancelled) setVideoLoading(false); });

    return () => { cancelled = true; };
  }, [reel?.id]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await getDownloadWithToken(reel.id);
      if (!url) throw new Error("Missing download URL");
      const a = document.createElement("a");
      a.href = url;
      a.download = `reel_${reel.instagram_reel_id || reel.id}.mp4`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("Download started");
    } catch (err) {
      const data = err?.response?.data;
      const message = typeof data === "object" && data?.message ? data.message : (err?.message || "Download failed");
      toast.error(message);
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <div
      className="reelfinder-reel-modal-overlay fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="reelfinder-reel-modal-card w-full max-w-[360px] rounded-xl border border-white/[0.16] bg-[#0a0a12] flex flex-col overflow-hidden"
        style={{ maxHeight: "calc(100dvh - 48px)", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/[0.08] shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 via-rose-500 to-orange-400 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-white">
              {(reel.profiles?.username || "?")[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-white truncate">@{reel.profiles?.username || "unknown"}</p>
            <p className="text-[10px] text-slate-500">{ago(reel.posted_at)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/[0.08] transition">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Video / thumbnail area */}
        <div className="relative bg-black flex-shrink-0 overflow-hidden" style={{ maxHeight: "55vh" }}>
          {videoUrl && !videoFailed ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                autoPlay
                loop
                muted={muted}
                controls
                playsInline
                className="w-full"
                style={{ maxHeight: "55vh", objectFit: "contain" }}
                poster={thumb || undefined}
                onError={() => setVideoFailed(true)}
              />
              <button
                onClick={() => setMuted((v) => !v)}
                className="absolute bottom-3 right-3 p-1.5 rounded-full bg-black/70 border border-white/[0.15]"
              >
                {muted ? <VolumeX className="w-3.5 h-3.5 text-white" /> : <Volume2 className="w-3.5 h-3.5 text-white" />}
              </button>
            </>
          ) : (
            <div className="relative flex items-center justify-center" style={{ minHeight: "40vh" }}>
              {/* Always show thumbnail as background */}
              {thumb && (
                <img
                  src={thumb}
                  alt=""
                  className="w-full object-contain"
                  style={{ maxHeight: "55vh" }}
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              )}

              {/* Loading spinner */}
              {videoLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                </div>
              )}

              {/* No video — clean fallback, no error toast */}
              {!videoLoading && (videoFailed || !videoUrl) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
                  {!thumb && <Play className="w-12 h-12 text-white/20" />}
                  <p className="text-sm text-white/70 font-medium px-4 text-center">
                    Video not cached yet
                  </p>
                  {reel.reel_url && (
                    <a
                      href={reel.reel_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 hover:bg-white/20 transition text-sm text-white inline-flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Watch on Instagram
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="px-3.5 pt-2.5 pb-1 flex items-center gap-4 shrink-0">
          <span className="inline-flex items-center gap-1 text-white text-sm">
            <Heart className="w-4 h-4 text-rose-400" />{fmt(reel.likes || 0)}
          </span>
          <span className="inline-flex items-center gap-1 text-white text-sm">
            <MessageCircle className="w-4 h-4 text-sky-400" />{fmt(reel.comments || 0)}
          </span>
          <span className="inline-flex items-center gap-1 text-white text-sm">
            <Send className="w-4 h-4 text-emerald-400 -rotate-12" />{fmt(reel.shares || 0)}
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400 text-sm ml-auto">
            <Eye className="w-4 h-4" />{fmt(reel.views || 0)}
          </span>
        </div>

        {reel.caption && (
          <p className="px-3.5 pb-2 text-[12px] text-slate-300 line-clamp-3 shrink-0">
            <span className="font-semibold text-white mr-1">@{reel.profiles?.username}</span>
            {reel.caption}
          </p>
        )}

        {/* Actions */}
        <div className="px-3.5 pb-3.5 flex gap-2 shrink-0 mt-auto">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 py-2 rounded-lg bg-white text-black font-semibold text-[13px] hover:bg-slate-100 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            {downloading ? "Saving…" : "Download"}
          </button>
          {reel.reel_url && (
            <a
              href={reel.reel_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg border border-white/[0.15] bg-white/[0.04] hover:bg-white/[0.08] inline-flex items-center justify-center"
            >
              <ExternalLink className="w-4 h-4 text-white" />
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function ReelCard({ reel, rank, onOpen, token }) {
  const [imgErr, setImgErr] = useState(false);
  const thumb = thumbSrc(reel, token);
  const rate = engRate(reel);

  return (
    <button
      type="button"
      onClick={() => onOpen(reel)}
      className="text-left rounded-xl overflow-hidden border border-white/[0.1] bg-white/[0.02] hover:border-white/[0.28] transition-all hover:scale-[1.01] group backdrop-blur-xl"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[9/16] bg-neutral-900 overflow-hidden">
        {thumb && !imgErr ? (
          <img
            src={thumb}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            onError={() => setImgErr(true)}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <TrendingUp className="w-7 h-7 text-neutral-700" />
          </div>
        )}

        {/* Hover play overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-black/40 flex items-center justify-center">
          <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-xl">
            <Play className="w-5 h-5 text-black fill-black ml-0.5" />
          </div>
        </div>

        {/* Rank badge */}
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/80 text-[10px] font-bold text-white">
          #{rank}
        </div>

        {/* Viral score badge */}
        {reel.viral_score > 0 && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/80 text-[10px] font-bold text-emerald-300 inline-flex items-center gap-0.5">
            <Zap className="w-2.5 h-2.5" />{reel.viral_score.toFixed(0)}
          </div>
        )}

        {/* Bottom gradient */}
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 to-transparent">
          <p className="text-[10px] text-white font-medium">@{reel.profiles?.username || "unknown"}</p>
          <p className="text-[10px] text-white/65">{ago(reel.posted_at || reel.last_scraped_at)}</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="p-2.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[13px] font-semibold text-white">{fmt(reel.views || 0)} <span className="text-slate-500 text-[11px] font-normal">views</span></p>
        </div>
        <div className="flex items-center gap-2.5 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-0.5">
            <Heart className="w-3 h-3 text-rose-400" />{fmt(reel.likes || 0)}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <MessageCircle className="w-3 h-3 text-sky-400" />{fmt(reel.comments || 0)}
          </span>
          {rate && <span className="text-emerald-400/80 ml-auto">{rate}%</span>}
        </div>
      </div>
    </button>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden animate-pulse">
      <div className="aspect-[9/16] bg-white/[0.04]" />
      <div className="p-2.5 space-y-2">
        <div className="h-3 bg-white/[0.06] rounded w-2/3" />
        <div className="h-3 bg-white/[0.06] rounded w-full" />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ViralReelFinderPage({ embedded = false, onUpgrade }) {
  const { user, refreshUserCredits } = useAuthStore();
  const [selectedReel, setSelectedReel] = useState(null);
  const [token, setToken] = useState(null);
  const [didBackfill, setDidBackfill] = useState(false);

  // Backfill user data if missing
  useEffect(() => {
    if (didBackfill || !user?.id) return;
    if (user.subscriptionStatus != null || user.premiumFeaturesUnlocked || user.role === "admin") return;
    setDidBackfill(true);
    refreshUserCredits();
  }, [user?.id, user?.subscriptionStatus, user?.premiumFeaturesUnlocked, user?.role]);

  const canAccess = hasPremiumAccess(user);

  // Fetch media token once we know the user can access
  useEffect(() => {
    if (!canAccess) { setToken(null); return; }
    let cancelled = false;
    api.get("/viral-reels/media-token")
      .then(({ data }) => { if (!cancelled) setToken(data?.token || null); })
      .catch(() => { if (!cancelled) setToken(null); });
    return () => { cancelled = true; };
  }, [canAccess]);

  const { data: reels = [], isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["viral-reels"],
    queryFn: async () => {
      const { data } = await api.get("/viral-reels");
      return Array.isArray(data) ? data : [];
    },
    enabled: canAccess,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const ranked = useMemo(
    () => [...reels].sort((a, b) => (b.viral_score || 0) - (a.viral_score || 0)),
    [reels]
  );

  const stats = useMemo(() => {
    if (!ranked.length) return null;
    const profiles = new Set(ranked.map((r) => r.profiles?.username).filter(Boolean)).size;
    const last = ranked.reduce((best, r) => {
      const t = r.last_scraped_at ? new Date(r.last_scraped_at).getTime() : 0;
      return t > best ? t : best;
    }, 0);
    return { total: ranked.length, profiles, last };
  }, [ranked]);

  if (!canAccess) {
    return (
      <div className={embedded ? "" : "min-h-screen bg-black text-white p-4 md:p-6"}>
        <SubscriptionGate onUpgrade={onUpgrade || (() => (window.location.href = "/dashboard?tab=settings"))} />
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-5" : "min-h-screen bg-black text-white p-4 md:p-6 space-y-5"}>
      {/* Header */}
      <div className="rounded-2xl p-4 sm:p-5 border border-white/[0.12] bg-white/[0.02] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl border border-white/[0.16] bg-white/[0.05] flex items-center justify-center shrink-0">
              <SiInstagram className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Reel Finder</h1>
              <p className="text-xs text-slate-400">Top reels ranked by viral score</p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-3.5 py-2 rounded-lg bg-white/[0.06] border border-white/[0.16] hover:bg-white/[0.1] text-sm text-white inline-flex items-center gap-2 disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {stats && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2.5 py-1 rounded-full border border-white/[0.15] bg-white/[0.05] text-slate-300 text-xs">
              {stats.total} reels
            </span>
            <span className="px-2.5 py-1 rounded-full border border-white/[0.15] bg-white/[0.05] text-slate-300 text-xs">
              {stats.profiles} profiles
            </span>
            {stats.last > 0 && (
              <span className="px-2.5 py-1 rounded-full border border-white/[0.15] bg-white/[0.05] text-slate-300 text-xs inline-flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Updated {ago(new Date(stats.last))}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-rose-200">Failed to load reels.</p>
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-sm text-white hover:bg-white/15 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Grid */}
      {!isLoading && ranked.length === 0 && !isError ? (
        <div className="rounded-2xl p-10 border border-white/[0.1] bg-white/[0.02] text-center">
          <SiInstagram className="w-9 h-9 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white mb-1">No reels yet</h3>
          <p className="text-sm text-slate-400">Ask an admin to add profiles and trigger a scrape.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {isLoading
            ? Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} />)
            : ranked.map((reel, idx) => (
                <ReelCard key={reel.id} reel={reel} rank={idx + 1} onOpen={setSelectedReel} token={token} />
              ))}
        </div>
      )}

      {/* Modal */}
      {selectedReel && (
        <ReelModal reel={selectedReel} onClose={() => setSelectedReel(null)} token={token} />
      )}
    </div>
  );
}
