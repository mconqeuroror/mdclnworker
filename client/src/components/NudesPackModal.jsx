import { useState, useEffect, useMemo } from "react";
import { X, Loader2, CheckSquare, Square, Layers, Coins } from "lucide-react";
import {
  NUDES_PACK_POSES,
  NUDES_PACK_CREDITS_MIN,
  NUDES_PACK_CREDITS_MAX,
  getNudesPackCreditsPerImage,
  getNudesPackTotalCredits,
} from "@shared/nudesPackPoses.js";

const ALL_IDS = NUDES_PACK_POSES.map((p) => p.id);

/**
 * Review & approve nudes pack poses before batch generation.
 */
export default function NudesPackModal({
  isOpen,
  onClose,
  onApprove,
  submitting = false,
  sidebarCollapsed = false,
}) {
  const [selected, setSelected] = useState(() => new Set(ALL_IDS));

  useEffect(() => {
    if (isOpen) setSelected(new Set(ALL_IDS));
  }, [isOpen]);

  const grouped = useMemo(() => {
    const g = { Solo: [], Sex: [] };
    for (const p of NUDES_PACK_POSES) {
      if (g[p.category]) g[p.category].push(p);
      else g.Solo.push(p);
    }
    return g;
  }, []);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(ALL_IDS));
  const selectNone = () => setSelected(new Set());

  const count = selected.size;
  const perImage = getNudesPackCreditsPerImage(count);
  const totalCredits = getNudesPackTotalCredits(count);
  const canSubmit = count > 0 && !submitting;

  const handleApprove = () => {
    if (!canSubmit) return;
    onApprove(Array.from(selected));
  };

  const leftOffset = sidebarCollapsed ? "md:left-[80px]" : "md:left-[260px]";

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm ${leftOffset}`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92dvh] rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-white font-semibold text-lg">
              <Layers className="w-5 h-5 text-rose-400" />
              Nudes pack — approve poses
            </div>
            <p className="text-[11px] text-slate-500 mt-1 max-w-xl">
              30 curated shots: amateur-style nudes and explicit couple poses. Each image uses your model trigger and
              current looks.               Toggle off any pose you don&apos;t want — about{" "}
              {perImage} credits per image on average ({count} selected = {totalCredits}{" "}
              <Coins className="w-3 h-3 inline text-yellow-400 align-text-bottom" />
              ).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 px-4 sm:px-5 pt-3 pb-2 border-b border-white/[0.06] shrink-0">
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={selectNone}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
          >
            Clear all
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6 custom-scrollbar">
          {["Solo", "Sex"].map((cat) => (
            <div key={cat}>
              <h3 className="text-[11px] uppercase tracking-wider text-rose-400/90 font-semibold mb-2">{cat}</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {grouped[cat]?.map((pose) => {
                  const on = selected.has(pose.id);
                  return (
                    <button
                      key={pose.id}
                      type="button"
                      onClick={() => toggle(pose.id)}
                      className={`text-left rounded-xl border p-2.5 flex gap-2 transition-colors ${
                        on
                          ? "border-rose-500/40 bg-rose-500/10"
                          : "border-white/10 bg-white/[0.02] opacity-70 hover:opacity-100"
                      }`}
                    >
                      {on ? (
                        <CheckSquare className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white leading-snug">{pose.title}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{pose.summary}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 sm:p-5 border-t border-white/10 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between shrink-0 bg-black/20">
          <div className="text-[11px] text-slate-400">
            <span className="text-slate-300 font-medium">{count}</span> poses ·{" "}
            <span className="inline-flex items-center gap-0.5 text-slate-300">
              {perImage} <Coins className="w-3 h-3 text-yellow-400" />
            </span>
            <span className="text-slate-500"> each · total </span>
            <span className="inline-flex items-center gap-0.5 text-yellow-400 font-semibold">
              {totalCredits} <Coins className="w-3.5 h-3.5" />
            </span>
            {count === NUDES_PACK_POSES.length && (
              <span className="text-slate-500 ml-2">
                (best rate — {NUDES_PACK_CREDITS_MIN} × {NUDES_PACK_POSES.length} ={" "}
                {getNudesPackTotalCredits(NUDES_PACK_POSES.length)})
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none py-2.5 px-4 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleApprove}
              className="flex-1 sm:flex-none py-2.5 px-5 rounded-xl text-sm font-semibold bg-gradient-to-r from-rose-600 to-pink-600 text-white disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Queuing…
                </>
              ) : (
                <>
                  Approve &amp; generate
                  <span className="inline-flex items-center gap-0.5 opacity-95">
                    {totalCredits} <Coins className="w-3.5 h-3.5 text-yellow-200" />
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
