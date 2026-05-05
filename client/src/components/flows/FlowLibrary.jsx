/**
 * FlowLibrary — refined right-rail panel showing user flows + starter templates.
 * Cards have proper visual hierarchy, hover states, and inline metadata.
 */

import { useCallback } from "react";
import { Plus, Folder, Loader2, Trash2, Layers, GitBranch, Sparkles } from "lucide-react";
import { useFlowStore } from "../../store/flowStore";
import { FLOW_TEMPLATES } from "../../data/flow-templates";

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function FlowLibrary({ onLoadFlow, onNewFlow, onDeleteFlow, onLoadTemplate, loading }) {
  const savedFlows = useFlowStore((s) => s.savedFlows);
  const currentFlowId = useFlowStore((s) => s.currentFlowId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-white/[0.05] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[8px] uppercase tracking-[0.18em] font-bold text-white/45"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Library
          </span>
          {savedFlows.length > 0 && (
            <span
              className="text-[8px] text-white/25"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {savedFlows.length}
            </span>
          )}
        </div>
        <button
          onClick={onNewFlow}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold text-violet-200 hover:text-white
            border border-violet-400/45 hover:border-violet-400/65 bg-violet-500/[0.16] hover:bg-violet-500/[0.28]
            transition-all duration-150"
          style={{
            fontFamily: "var(--font-mono)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.08)",
          }}
        >
          <Plus size={10} strokeWidth={2.4} />
          NEW
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={14} className="animate-spin text-white/20" />
          </div>
        )}

        {/* Templates section — always shown when no flows yet */}
        {!loading && savedFlows.length === 0 && (
          <div className="py-3">
            <div className="px-3 mb-2 flex items-center gap-1.5">
              <Sparkles size={9} className="text-amber-300/60" strokeWidth={1.8} />
              <span
                className="text-[8px] uppercase tracking-[0.18em] font-bold text-white/35"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Templates
              </span>
            </div>

            <div className="px-2 space-y-1">
              {FLOW_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onLoadTemplate?.(t)}
                  className="w-full text-left group/tpl relative rounded-xl p-2.5 transition-all duration-200 overflow-hidden
                    hover:border-violet-400/45"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(167,139,250,0.10) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
                  }}
                >
                  {/* corner glow on hover */}
                  <div
                    className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-0 group-hover/tpl:opacity-100 transition-opacity duration-300"
                    style={{ background: "radial-gradient(circle, rgba(167,139,250,0.15) 0%, transparent 70%)" }}
                  />

                  <div className="relative flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-md bg-violet-500/10 border border-violet-400/15 flex items-center justify-center flex-shrink-0">
                      <Layers size={11} className="text-violet-300/80" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[10.5px] font-semibold text-white/85 group-hover/tpl:text-white truncate transition-colors">
                          {t.name}
                        </span>
                        <span
                          className="text-[8px] text-white/30 flex-shrink-0"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {t.nodes.length}n
                        </span>
                      </div>
                      <p className="text-[9px] text-white/40 leading-snug line-clamp-2">{t.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Saved flows */}
        {savedFlows.length > 0 && (
          <div className="py-2 space-y-0.5 px-1.5">
            {savedFlows.map((flow) => {
              const active = currentFlowId === flow.id;
              return (
                <div
                  key={flow.id}
                  onClick={() => onLoadFlow(flow.id)}
                  className={`
                    group/flow relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer
                    transition-all duration-150 border
                    ${active
                      ? "bg-violet-500/[0.16] border-violet-400/45 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                      : "border-transparent hover:bg-white/[0.07] hover:border-white/[0.18]"}
                  `}
                >
                  {/* active indicator strip */}
                  {active && (
                    <span
                      className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
                      style={{ background: "#a78bfa", boxShadow: "0 0 6px rgba(167,139,250,0.5)" }}
                    />
                  )}

                  {flow.thumbnail ? (
                    <img src={flow.thumbnail} alt="" className="w-9 h-7 object-cover rounded-md flex-shrink-0" />
                  ) : (
                    <div
                      className="w-9 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{
                        background: "rgba(255,255,255,0.07)",
                        border: "1px solid rgba(255,255,255,0.16)",
                        boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
                      }}
                    >
                      <GitBranch size={11} className="text-white/55" strokeWidth={1.8} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-[10.5px] font-medium text-white/85 truncate leading-tight">
                      {flow.name}
                    </div>
                    <div
                      className="flex items-center gap-1.5 mt-0.5 text-[8px] text-white/30"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      <span>{timeAgo(flow.updatedAt)}</span>
                      {flow._count?.runs > 0 && (
                        <>
                          <span className="opacity-50">·</span>
                          <span>{flow._count.runs}r</span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteFlow(flow.id); }}
                    className="opacity-0 group-hover/flow:opacity-100 p-1 rounded hover:bg-red-500/15
                      text-white/25 hover:text-red-300 transition-all flex-shrink-0"
                    title="Delete flow"
                  >
                    <Trash2 size={10} strokeWidth={1.8} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
