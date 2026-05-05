/**
 * BaseNode — refined glass-and-graphite shell for every Flows node.
 *
 * Design language: dark workshop. Subtle gradient header bar, monospace tech
 * label + sans display label, micro-status orb, layered shadows, hairline
 * dividers, and an inline preview pane that fades into the panel.
 *
 * Ports are rendered *inline* with their visible dot + label. That way the
 * clickable <Handle /> is always exactly where the user sees the port (no
 * absolute-pixel maths to drift out of alignment) and React Flow's internal
 * handle-position calculation always matches the DOM — which is what drives
 * edge path endpoints. This is the canonical pattern from the React Flow
 * docs and is what makes connections reliably render as visible edges.
 */

import { memo, useState, useCallback } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  Copy,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useFlowStore } from "../../../store/flowStore";

// Port handle colors by data type — saturated, glassy
const PORT_COLORS = {
  image: "#a78bfa",
  video: "#f59e0b",
  text:  "#22d3ee",
  model: "#34d399",
  audio: "#f472b6",
  any:   "#94a3b8",
};

const STATUS_DOT = {
  idle:      { bg: "rgba(255,255,255,0.18)", glow: "transparent" },
  running:   { bg: "#60a5fa", glow: "rgba(96,165,250,0.6)" },
  completed: { bg: "#34d399", glow: "rgba(52,211,153,0.5)" },
  failed:    { bg: "#f87171", glow: "rgba(248,113,113,0.55)" },
  skipped:   { bg: "#71717a", glow: "transparent" },
};

const STATUS_PILL_TEXT = {
  idle:      "—",
  running:   "RUN",
  completed: "OK",
  failed:    "ERR",
  skipped:   "SKIP",
};

const STATUS_PILL_COLOR = {
  idle:      "text-white/30 bg-white/[0.04] border-white/[0.06]",
  running:   "text-blue-300 bg-blue-500/10 border-blue-400/30",
  completed: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  failed:    "text-red-300 bg-red-500/10 border-red-400/30",
  skipped:   "text-white/40 bg-white/[0.04] border-white/[0.08]",
};

// Shared Handle base style — keep positioning inline so handle anchors still
// measure correctly even if global CSS order ever clobbers React Flow defaults.
function handleStyle(portType) {
  const color = PORT_COLORS[portType] || PORT_COLORS.any;
  return {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    background: color,
    width: 10,
    height: 10,
    border: "1.5px solid #08080b",
    boxShadow: `0 0 0 1px ${color}55, 0 0 6px ${color}55`,
    borderRadius: 999,
    zIndex: 2,
  };
}

export const BaseNode = memo(function BaseNode({
  id,
  type,
  data = {},
  selected,
  headerColor = "#a78bfa",
  label,
  inputs = [],
  outputs = [],
  children,
  creditCost = 0,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { nodeStatuses, deleteNode, duplicateNode } = useFlowStore();
  const status = nodeStatuses[id]?.status || "idle";
  const nodeOutput = nodeStatuses[id]?.output;
  const outputType = nodeStatuses[id]?.outputType;
  const statusMessage = nodeStatuses[id]?.message;
  const errorMessage = nodeStatuses[id]?.error;

  const dot = STATUS_DOT[status] || STATUS_DOT.idle;

  const handleDelete = useCallback(() => deleteNode(id), [id, deleteNode]);
  const handleDuplicate = useCallback(() => duplicateNode(id), [id, duplicateNode]);

  // Max rows per column — used to align the port rail evenly.
  const maxRows = Math.max(inputs.length, outputs.length);

  return (
    <div
      className="group relative select-none"
      style={{
        fontFamily: "var(--font-sans)",
        minWidth: 240,
        minHeight: 120,
      }}
    >
      {/* Outer running glow halo */}
      {status === "running" && (
        <div
          className="absolute -inset-[2px] rounded-[14px] pointer-events-none animate-pulse"
          style={{
            background: `radial-gradient(60% 60% at 50% 0%, ${dot.glow} 0%, transparent 70%)`,
            filter: "blur(8px)",
            opacity: 0.7,
          }}
        />
      )}

      {/* The node card */}
      <div
        className="relative rounded-[12px] backdrop-blur-xl transition-shadow duration-300 w-full h-full flex flex-col"
        style={{
          background:
            "linear-gradient(180deg, rgba(26,26,34,0.98) 0%, rgba(18,18,24,0.98) 100%)",
          border: `1px solid ${
            selected
              ? "rgba(167,139,250,0.45)"
              : status === "running"
              ? `${dot.bg}aa`
              : status === "completed"
              ? "rgba(52,211,153,0.30)"
              : status === "failed"
              ? "rgba(248,113,113,0.35)"
              : "rgba(255,255,255,0.16)"
          }`,
          boxShadow: selected
            ? `0 0 0 1px ${headerColor}33, 0 16px 48px -12px rgba(0,0,0,0.7), 0 4px 16px -4px ${headerColor}22`
            : "0 12px 32px -12px rgba(0,0,0,0.6), 0 1px 0 0 rgba(255,255,255,0.03) inset",
        }}
      >
        {/* ── Header bar ── */}
        <div
          className="relative flex items-center justify-between px-3 py-2 cursor-pointer rounded-t-[12px]"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: `linear-gradient(180deg, ${headerColor}22 0%, ${headerColor}08 100%)`,
            borderBottom: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          {/* category color stripe */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[2px] rounded-tl-[12px]"
            style={{ background: `linear-gradient(180deg, ${headerColor} 0%, ${headerColor}40 100%)` }}
          />

          <div className="flex items-center gap-2 min-w-0 ml-1">
            {/* status orb */}
            <div className="relative flex items-center justify-center">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: dot.bg, boxShadow: status === "running" ? `0 0 8px ${dot.glow}` : "none" }}
              />
              {status === "running" && (
                <span
                  className="absolute w-3 h-3 rounded-full animate-ping"
                  style={{ background: dot.bg, opacity: 0.4 }}
                />
              )}
            </div>

            <div className="min-w-0 flex flex-col leading-none">
              <span
                className="text-[7.5px] uppercase tracking-[0.18em] text-white/60 font-medium truncate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {type}
              </span>
              <span className="text-[11px] font-semibold text-white/95 truncate mt-0.5">
                {label || type}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* status pill */}
            <span
              className={`px-1.5 py-0.5 rounded text-[7.5px] font-bold tracking-[0.1em] border
                ${STATUS_PILL_COLOR[status] || STATUS_PILL_COLOR.idle}`}
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {STATUS_PILL_TEXT[status]}
            </span>

            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-0.5">
              <button
                className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
                onClick={(e) => { e.stopPropagation(); handleDuplicate(); }}
                title="Duplicate (Ctrl+D)"
              >
                <Copy size={10} strokeWidth={1.8} />
              </button>
              <button
                className="p-1 rounded hover:bg-red-500/20 text-white/40 hover:text-red-300 transition-colors"
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                title="Delete"
              >
                <Trash2 size={10} strokeWidth={1.8} />
              </button>
              <button
                className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
                onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
              >
                {collapsed ? <ChevronDown size={10} strokeWidth={1.8} /> : <ChevronUp size={10} strokeWidth={1.8} />}
              </button>
            </div>
          </div>
        </div>

        {/* ── Port rail ──
            Handles live inline with their visible label + dot so React Flow
            always has accurate coordinates to draw edges from/to. Each side
            is an independent column; the `maxRows` filler keeps both sides
            vertically centered when one side has fewer ports. */}
        {(inputs.length > 0 || outputs.length > 0) && (
          <div
            className="grid gap-x-3 py-2.5 px-0"
            style={{
              gridTemplateColumns: "1fr 1fr",
              borderBottom: !collapsed ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}
          >
            {/* Inputs column (left) */}
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: maxRows }).map((_, i) => {
                const p = inputs[i];
                if (!p) return <div key={`in-spacer-${i}`} style={{ height: 14 }} />;
                const color = PORT_COLORS[p.type] || PORT_COLORS.any;
                return (
                  <div
                    key={`in-${p.id}`}
                    className="relative flex items-center gap-2 pl-3 pr-1"
                    style={{ height: 14 }}
                  >
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={p.id}
                      style={{ ...handleStyle(p.type), left: -5 }}
                      title={`${p.label} · ${p.type}`}
                    />
                    <span
                      className="w-1 h-1 rounded-full flex-shrink-0"
                      style={{ background: color }}
                    />
                    <span
                      className="text-[8.5px] uppercase tracking-[0.08em] text-white/80 truncate font-medium"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {p.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Outputs column (right) */}
            <div className="flex flex-col gap-1.5 items-end">
              {Array.from({ length: maxRows }).map((_, i) => {
                const p = outputs[i];
                if (!p) return <div key={`out-spacer-${i}`} style={{ height: 14 }} />;
                const color = PORT_COLORS[p.type] || PORT_COLORS.any;
                return (
                  <div
                    key={`out-${p.id}`}
                    className="relative flex items-center gap-2 pr-3 pl-1 justify-end w-full"
                    style={{ height: 14 }}
                  >
                    <span
                      className="text-[8.5px] uppercase tracking-[0.08em] text-white/80 truncate font-medium"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {p.label}
                    </span>
                    <span
                      className="w-1 h-1 rounded-full flex-shrink-0"
                      style={{ background: color }}
                    />
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={p.id}
                      style={{ ...handleStyle(p.type), right: -5 }}
                      title={`${p.label} · ${p.type}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Body ── */}
        {!collapsed && (children || status !== "idle") && (
          <div className="px-3 py-2.5 space-y-2.5">
            {children}

            {status === "running" && statusMessage && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-blue-500/[0.06] border border-blue-400/15">
                <Loader2 size={9} className="animate-spin text-blue-300 flex-shrink-0" strokeWidth={2.2} />
                <p className="text-[9px] text-blue-200/80 truncate" style={{ fontFamily: "var(--font-mono)" }}>
                  {statusMessage}
                </p>
              </div>
            )}

            {status === "failed" && errorMessage && (
              <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-red-500/[0.06] border border-red-400/20">
                <AlertTriangle size={10} className="text-red-300 flex-shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-[9px] text-red-200/80 leading-relaxed break-words" title={errorMessage}>
                  {errorMessage}
                </p>
              </div>
            )}

            {/* Output preview */}
            {status === "completed" && nodeOutput && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={9} className="text-emerald-400" strokeWidth={2.2} />
                  <span
                    className="text-[8px] uppercase tracking-[0.12em] text-emerald-400/80 font-medium"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    Output
                  </span>
                </div>
                <div
                  className="rounded-lg overflow-hidden"
                  style={{
                    background: "linear-gradient(180deg, #08080b 0%, #0c0c12 100%)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.03)",
                  }}
                >
                  {outputType === "video" ? (
                    <video src={nodeOutput} className="w-full max-h-36 object-contain" controls muted playsInline />
                  ) : outputType === "audio" ? (
                    <audio src={nodeOutput} controls className="w-full" />
                  ) : outputType === "image" ||
                    (typeof nodeOutput === "string" && nodeOutput.match(/\.(jpg|jpeg|png|webp|gif)/i)) ? (
                    <img src={nodeOutput} alt="Output" className="w-full max-h-36 object-contain" />
                  ) : outputType === "text" || typeof nodeOutput === "string" ? (
                    <p
                      className="text-[10px] text-white/65 p-2 max-h-24 overflow-y-auto leading-relaxed"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {typeof nodeOutput === "string" ? nodeOutput : JSON.stringify(nodeOutput, null, 2)}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cost tag floats at bottom-right */}
        {creditCost > 0 && (
          <div className="absolute bottom-1 right-2 pointer-events-none">
            <span
              className="text-[7.5px] tracking-[0.1em] text-white/30 font-medium"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {creditCost}cr
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

export default BaseNode;
