import { useCallback, useEffect, useRef, useState } from "react";
import { buildElementGuides, buildPageGuides, snapBoxToGuides } from "../../landerNew/spatialSnap";
import { formatTranslatePercent, getEffectiveTransform } from "../../landerNew/spatialMerge";

const HANDLE = 10;

export default function DragOverlay({
  bounds,
  clientWidth,
  clientHeight,
  selectedTargetId,
  activeBreakpoint,
  spatialOverrides,
  onSpatialPatch,
  onRequestBounds,
  cursorIframe,
}) {
  const [dragMode, setDragMode]     = useState(null); // "move" | "resize-e" | "resize-s" | "resize-se" | null
  const [activeGuides, setActiveGuides] = useState([]);

  const dragRef   = useRef(null);
  const patchRef  = useRef(onSpatialPatch);  patchRef.current  = onSpatialPatch;
  const reqRef    = useRef(onRequestBounds); reqRef.current    = onRequestBounds;
  const boundsRef = useRef(bounds);          boundsRef.current = bounds;
  const soRef     = useRef(spatialOverrides); soRef.current    = spatialOverrides;

  const getTransform = useCallback(
    (id) => spatialOverrides?.[id]?.[activeBreakpoint],
    [spatialOverrides, activeBreakpoint],
  );

  // ── Guides ───────────────────────────────────────────────────────────────
  const pageGuides = buildPageGuides(clientWidth, clientHeight);
  const allGuides  = selectedTargetId && dragMode
    ? [...pageGuides, ...buildElementGuides(bounds, selectedTargetId)]
    : pageGuides;
  const guidesRef  = useRef(allGuides); guidesRef.current = allGuides;

  // ── Pointer events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dragMode) { setActiveGuides([]); return undefined; }

    function onMove(e) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;

      if (d.mode === "move") {
        const propLeft = d.startRect.left + dx;
        const propTop  = d.startRect.top  + dy;
        const snapped  = snapBoxToGuides(propLeft, propTop, d.startRect.width, d.startRect.height, guidesRef.current);
        const dTx = ((snapped.left - d.startRect.left) / d.elW) * 100;
        const dTy = ((snapped.top  - d.startRect.top)  / d.elH) * 100;
        setActiveGuides(snapped.active);
        patchRef.current(d.targetId, {
          translateX: formatTranslatePercent(d.startTx + dTx),
          translateY: formatTranslatePercent(d.startTy + dTy),
        });
      } else if (d.mode === "resize-e") {
        patchRef.current(d.targetId, { width: `${((Math.max(40, d.elW + dx)) / 16).toFixed(3)}rem` });
      } else if (d.mode === "resize-s") {
        patchRef.current(d.targetId, { height: `${((Math.max(20, d.elH + dy)) / 16).toFixed(3)}rem` });
      } else if (d.mode === "resize-se") {
        patchRef.current(d.targetId, {
          width:  `${((Math.max(40, d.elW + dx)) / 16).toFixed(3)}rem`,
          height: `${((Math.max(20, d.elH + dy)) / 16).toFixed(3)}rem`,
        });
      }
    }

    function onUp() {
      dragRef.current = null;
      setDragMode(null);
      setActiveGuides([]);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
      window.removeEventListener("pointercancel", onUp);
      reqRef.current();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragMode]);

  function startDrag(e, mode, targetId, rect) {
    e.preventDefault();
    e.stopPropagation();
    const t   = getTransform(targetId);
    const eff = getEffectiveTransform(t, rect.width, rect.height);
    dragRef.current = {
      mode, startX: e.clientX, startY: e.clientY,
      startTx: eff.txPct, startTy: eff.tyPct,
      startRect: { ...rect }, elW: rect.width, elH: rect.height, targetId,
    };
    setDragMode(mode);
    e.target.setPointerCapture?.(e.pointerId);
  }

  if (!selectedTargetId || clientWidth <= 0) return null;

  const selectedEntry = bounds.find(b => b.targetId === selectedTargetId);
  if (!selectedEntry) return null;
  const r = selectedEntry.rect;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 10, width: clientWidth, height: clientHeight }}
    >
      {/* ── Snap guide SVG ──────────────────────────────────────────── */}
      <svg
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 100 }}
        width={clientWidth}
        height={clientHeight}
        aria-hidden="true"
      >
        {/* Permanent page guides (subtle) */}
        {pageGuides.map((g, i) =>
          g.orientation === "vertical"
            ? <line key={`pg-${i}`} x1={g.position} y1={0} x2={g.position} y2={clientHeight} stroke="rgba(245,158,11,0.18)" strokeWidth={1} strokeDasharray="4 3" />
            : <line key={`pg-${i}`} x1={0} y1={g.position} x2={clientWidth} y2={g.position} stroke="rgba(245,158,11,0.18)" strokeWidth={1} strokeDasharray="4 3" />,
        )}
        {/* Active snap guides (bright) */}
        {activeGuides.map((g, i) => {
          const stroke = g.kind === "page-center" ? "rgba(245,158,11,0.95)" : "rgba(99,102,241,0.9)";
          return g.orientation === "vertical"
            ? <line key={`ag-${i}`} x1={g.position} y1={0} x2={g.position} y2={clientHeight} stroke={stroke} strokeWidth={1.5} />
            : <line key={`ag-${i}`} x1={0} y1={g.position} x2={clientWidth} y2={g.position} stroke={stroke} strokeWidth={1.5} />;
        })}
        {/* Crosshair following cursor inside iframe */}
        {cursorIframe && cursorIframe.x >= 0 && cursorIframe.y >= 0 && <>
          <line x1={cursorIframe.x} y1={0} x2={cursorIframe.x} y2={clientHeight} stroke="rgba(239,68,68,0.4)" strokeWidth={1} />
          <line x1={0} y1={cursorIframe.y} x2={clientWidth} y2={cursorIframe.y} stroke="rgba(239,68,68,0.4)" strokeWidth={1} />
        </>}
      </svg>

      {/* ── Element highlight borders ────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 101, width: clientWidth, height: clientHeight }}
      >
        {bounds.map(b => (
          <div
            key={b.targetId}
            className="absolute"
            style={{
              left: b.rect.left, top: b.rect.top,
              width: b.rect.width, height: b.rect.height,
              border: b.targetId === selectedTargetId
                ? "1.5px solid rgba(251,191,36,0.85)"
                : "1px solid rgba(99,102,241,0.22)",
            }}
          />
        ))}
      </div>

      {/* ── Move bar + resize handles ───────────────────────────────────── */}
      <div
        className="pointer-events-none absolute"
        style={{ zIndex: 102, left: r.left, top: r.top, width: r.width, height: r.height }}
      >
        {/* Move drag bar */}
        <button
          type="button"
          className="pointer-events-auto absolute flex items-center justify-center rounded text-[10px] font-semibold"
          style={{
            top: -26, left: 0, right: 0, height: 22,
            background: "rgba(251,191,36,0.2)",
            border: "1px solid rgba(251,191,36,0.5)",
            color: "rgba(251,191,36,0.9)",
            cursor: dragMode === "move" ? "grabbing" : "grab",
          }}
          onPointerDown={e => startDrag(e, "move", selectedTargetId, r)}
        >
          ⠿ Move
        </button>

        {/* E handle (resize width) */}
        <button
          type="button"
          aria-label="Resize width"
          className="pointer-events-auto absolute rounded-sm"
          style={{
            right: -HANDLE / 2 - 1, top: "50%", transform: "translateY(-50%)",
            width: HANDLE, height: HANDLE,
            background: "rgba(251,191,36,0.85)",
            cursor: "ew-resize",
          }}
          onPointerDown={e => startDrag(e, "resize-e", selectedTargetId, r)}
        />

        {/* S handle (resize height) */}
        <button
          type="button"
          aria-label="Resize height"
          className="pointer-events-auto absolute rounded-sm"
          style={{
            bottom: -HANDLE / 2 - 1, left: "50%", transform: "translateX(-50%)",
            width: HANDLE, height: HANDLE,
            background: "rgba(251,191,36,0.85)",
            cursor: "ns-resize",
          }}
          onPointerDown={e => startDrag(e, "resize-s", selectedTargetId, r)}
        />

        {/* SE handle (resize both) */}
        <button
          type="button"
          aria-label="Resize corner"
          className="pointer-events-auto absolute rounded-sm"
          style={{
            bottom: -HANDLE / 2 - 1, right: -HANDLE / 2 - 1,
            width: HANDLE, height: HANDLE,
            background: "rgba(251,191,36,0.85)",
            cursor: "nwse-resize",
          }}
          onPointerDown={e => startDrag(e, "resize-se", selectedTargetId, r)}
        />

        {/* Target ID label */}
        <div
          className="pointer-events-none absolute"
          style={{
            bottom: -20, left: 0,
            fontSize: 10, color: "rgba(251,191,36,0.75)",
            whiteSpace: "nowrap", fontFamily: "monospace",
          }}
        >
          {selectedTargetId}
        </div>
      </div>
    </div>
  );
}
