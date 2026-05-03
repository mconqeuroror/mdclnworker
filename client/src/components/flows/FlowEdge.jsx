/**
 * FlowEdge — ComfyUI-style connection wire.
 *
 * Minimal implementation:
 *   1. Compute a bezier path.
 *   2. Render a visible <path> with the `react-flow__edge-path` class
 *      (so React Flow's interaction hooks latch on).
 *   3. Render a wide transparent hit-target so edges are easy to click.
 *
 * All visual properties (stroke, strokeWidth) are set via the `style`
 * prop — inline styles beat any CSS rule (including `!important`), so
 * port-typed colours are always honoured and the wire is guaranteed
 * visible from the first render frame after onConnect.
 *
 * Colour is baked into `edge.style.stroke` at creation time in
 * `flowStore.onConnect` based on the source port's data type. No store
 * lookup from inside the edge component — that keeps rendering a pure
 * function of the props React Flow hands us.
 */

import { getBezierPath } from "@xyflow/react";

export default function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
  markerEnd,
  markerStart,
}) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.32,
  });

  const stroke = style?.stroke || "#a78bfa";
  const baseWidth = Number(style?.strokeWidth) || 2.5;
  const strokeWidth = selected ? baseWidth + 0.8 : baseWidth;

  const pathStyle = {
    stroke,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  };

  const glowStyle = {
    stroke,
    strokeWidth: strokeWidth + 4,
    strokeOpacity: 0.2,
    strokeLinecap: "round",
    fill: "none",
    filter: "blur(2.5px)",
    pointerEvents: "none",
  };

  return (
    <>
      {/* Soft glow underlay for a polished ComfyUI feel. */}
      <path d={edgePath} style={glowStyle} />
      {/* The visible wire. Inline `style` beats any CSS rule, so the
          port-typed colour always wins. */}
      <path
        id={id}
        d={edgePath}
        className="react-flow__edge-path"
        style={pathStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />
      {/* Wide transparent hit strip for forgiving click / hover. */}
      <path
        d={edgePath}
        className="react-flow__edge-interaction"
        style={{ fill: "none", stroke: "transparent", strokeWidth: 22 }}
      />
    </>
  );
}
