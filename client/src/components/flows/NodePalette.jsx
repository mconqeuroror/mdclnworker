/**
 * NodePalette — refined left rail. Categorized, searchable, drag-source.
 * Each entry uses a real lucide icon (no emojis) tinted by its category.
 */

import { useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Type,
  User,
  Sparkles,
  Banana,
  Sprout,
  Repeat2,
  Brush,
  ArrowUpFromLine,
  ShieldOff,
  ScanFace,
  Film,
  Wind,
  Mic,
  Flame,
  Video,
  Rewind,
  Activity,
  Download,
  Shuffle,
  Layers,
} from "lucide-react";
import { useFlowStore } from "../../store/flowStore";

const CATEGORY_LABELS = {
  inputs:  { label: "Inputs",      color: "#60a5fa" },
  images:  { label: "Image",       color: "#a78bfa" },
  video:   { label: "Video",       color: "#f59e0b" },
  nsfw:    { label: "NSFW",        color: "#f87171" },
  outputs: { label: "Output",      color: "#34d399" },
  utility: { label: "Utility",     color: "#94a3b8" },
};

const NODE_ICONS = {
  "image-input":        ImageIcon,
  "text-input":         Type,
  "model-selector":     User,
  "enhance-prompt":     Sparkles,
  "nana-banana-avatar": Banana,
  "seedream-avatar":    Sprout,
  "mcx-img2img":        Repeat2,
  "creator-studio":     Brush,
  "upscaler":           ArrowUpFromLine,
  "synthid-remover":    ShieldOff,
  "face-swap":          ScanFace,
  "video-prompt":       Film,
  "video-motion":       Wind,
  "talking-head":       Mic,
  "nsfw-gen":           Flame,
  "nsfw-video":         Video,
  "nsfw-video-extend":  Rewind,
  "nsfw-motion":        Activity,
  "output-viewer":      Download,
  "merge-outputs":      Shuffle,
};

export function NodePalette() {
  const nodeTypes = useFlowStore((s) => s.nodeTypes);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState({});

  const filtered = nodeTypes.filter(
    (t) =>
      !t.hidden &&
      (!search ||
        t.label.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped = {};
  for (const t of filtered) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  const onDragStart = (e, type) => {
    e.dataTransfer.setData("application/flow-node-type", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  const toggleCategory = (cat) =>
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search */}
      <div className="px-3 py-3 border-b border-white/[0.05]">
        <div
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors focus-within:border-violet-400/40"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <Search size={11} className="text-white/30 flex-shrink-0" strokeWidth={1.8} />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-[11px] text-white/85 placeholder:text-white/25 outline-none min-w-0 font-medium"
            style={{ fontFamily: "var(--font-sans)" }}
          />
          {search && (
            <span
              className="text-[8px] text-white/25 flex-shrink-0"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {filtered.length}
            </span>
          )}
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        {Object.entries(CATEGORY_LABELS).map(([cat, meta]) => {
          const items = grouped[cat];
          if (!items?.length) return null;
          const isCollapsed = collapsed[cat];

          return (
            <div key={cat} className="mb-1">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.02] transition-colors group/cat"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-[3px] h-2.5 rounded-sm"
                    style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}66` }}
                  />
                  <span
                    className="text-[8px] font-bold tracking-[0.18em] uppercase text-white/45 group-hover/cat:text-white/70 transition-colors"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {meta.label}
                  </span>
                  <span
                    className="text-[8px] text-white/20 ml-auto"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {items.length}
                  </span>
                </div>
                {isCollapsed ? (
                  <ChevronRight size={10} className="text-white/20 group-hover/cat:text-white/40 transition-colors" strokeWidth={2} />
                ) : (
                  <ChevronDown size={10} className="text-white/20 group-hover/cat:text-white/40 transition-colors" strokeWidth={2} />
                )}
              </button>

              {/* Nodes */}
              {!isCollapsed && (
                <div className="px-1.5 space-y-[2px]">
                  {items.map((node) => {
                    const Icon = NODE_ICONS[node.type] || Layers;
                    return (
                      <div
                        key={node.type}
                        draggable
                        onDragStart={(e) => onDragStart(e, node.type)}
                        className="group/node relative flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing
                          hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]
                          transition-all duration-150"
                        title={node.description}
                      >
                        {/* Icon tile */}
                        <div
                          className="relative w-6 h-6 rounded flex items-center justify-center flex-shrink-0 transition-all"
                          style={{
                            background: `linear-gradient(135deg, ${meta.color}18 0%, ${meta.color}06 100%)`,
                            border: `1px solid ${meta.color}25`,
                          }}
                        >
                          <Icon size={11} className="transition-colors" style={{ color: meta.color }} strokeWidth={1.8} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-[10.5px] font-medium text-white/80 group-hover/node:text-white truncate transition-colors leading-tight">
                            {node.label}
                          </div>
                          {node.creditCost > 0 && (
                            <div
                              className="text-[8px] text-white/30 group-hover/node:text-white/45 transition-colors mt-0.5"
                              style={{ fontFamily: "var(--font-mono)" }}
                            >
                              {node.creditCost}cr
                            </div>
                          )}
                        </div>

                        {/* Drag indicator dots */}
                        <div className="opacity-0 group-hover/node:opacity-50 transition-opacity flex flex-col gap-0.5">
                          <span className="w-0.5 h-0.5 rounded-full bg-white/40" />
                          <span className="w-0.5 h-0.5 rounded-full bg-white/40" />
                          <span className="w-0.5 h-0.5 rounded-full bg-white/40" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && search && (
          <div className="px-4 py-8 text-center">
            <p className="text-[10px] text-white/25" style={{ fontFamily: "var(--font-mono)" }}>
              no results for "{search}"
            </p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2.5 border-t border-white/[0.05] flex items-center gap-1.5">
        <kbd
          className="px-1.5 py-0.5 rounded text-[8px] text-white/40 border border-white/10 bg-white/[0.03]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          drag
        </kbd>
        <span className="text-[9px] text-white/25" style={{ fontFamily: "var(--font-mono)" }}>
          to canvas
        </span>
      </div>
    </div>
  );
}
