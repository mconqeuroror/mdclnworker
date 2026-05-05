/**
 * GroupNode — lightweight container that visually groups child nodes.
 *
 * Resizable via NodeResizer (children are extent-clamped). Renders a dashed
 * border, a small header strip, and an editable label. Click-through is
 * preserved on the body so child nodes stay interactive.
 */

import { memo, useState, useCallback } from "react";
import { useFlowStore } from "../../../store/flowStore";

const GroupNode = memo(function GroupNode({ id, data, selected }) {
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const label = data?.label || "Group";

  const onLabelChange = useCallback(
    (e) => updateNodeData(id, { label: e.target.value }),
    [id, updateNodeData]
  );

  return (
    <div
      className="relative w-full h-full"
      style={{
        background:
          "linear-gradient(180deg, rgba(167,139,250,0.04) 0%, rgba(124,58,237,0.02) 100%)",
        border: `1.5px dashed ${selected ? "rgba(167,139,250,0.7)" : "rgba(167,139,250,0.32)"}`,
        borderRadius: 14,
        boxShadow: selected
          ? "0 0 0 1px rgba(167,139,250,0.25), 0 12px 36px -16px rgba(124,58,237,0.4)"
          : "0 6px 24px -12px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header strip — the only draggable surface; body click-through to children */}
      <div
        className="absolute top-0 left-0 right-0 px-3 py-1.5 cursor-move flex items-center gap-2"
        style={{
          background: "linear-gradient(180deg, rgba(167,139,250,0.14) 0%, rgba(124,58,237,0.04) 100%)",
          borderBottom: "1px dashed rgba(167,139,250,0.22)",
          borderTopLeftRadius: 13,
          borderTopRightRadius: 13,
        }}
        onDoubleClick={() => setEditing(true)}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: "#a78bfa", boxShadow: "0 0 6px rgba(167,139,250,0.55)" }}
        />
        {editing ? (
          <input
            autoFocus
            value={label}
            onChange={onLabelChange}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
            className="bg-white/[0.06] border border-violet-400/40 rounded px-1.5 py-0.5 text-[10px]
              text-white/95 outline-none flex-1 min-w-0"
            style={{ fontFamily: "var(--font-mono)" }}
          />
        ) : (
          <span
            className="text-[9px] uppercase tracking-[0.18em] font-semibold text-violet-200/85 truncate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {label}
          </span>
        )}
      </div>

      {/* Body — transparent so children paint through */}
    </div>
  );
});

export default GroupNode;
