/**
 * FlowEdge — canonical React Flow custom edge using <BaseEdge />.
 *
 * This is the documented pattern from https://reactflow.dev/api-reference/components/base-edge
 * and the same shape working ComfyUI-style React Flow projects use. <BaseEdge /> handles the
 * invisible interaction overlay and the proper className wiring (`react-flow__edge-path`),
 * which means React Flow's own CSS is happy and our custom styling layers on top via the
 * `style` prop (inline styles beat any CSS, so nothing can silently make the edge invisible).
 *
 * Visual states:
 *   - idle      → dashed violet (`5 5`), faint glow underlay
 *   - running   → animated travelling dash, brighter glow, thicker stroke
 *   - completed → solid, slightly muted
 *   - failed    → solid red
 *   - selected  → thicker, full opacity
 *
 * Port-typed colours: image=violet, video=amber, text=cyan, model=emerald, audio=pink,
 *                      any=slate. Falls back to violet if the source port type can't be resolved.
 */

import { BaseEdge, getBezierPath } from "@xyflow/react";
import { useFlowStore } from "../../store/flowStore";

const PORT_COLORS = {
  image: "#a78bfa",
  video: "#f59e0b",
  text:  "#22d3ee",
  model: "#34d399",
  audio: "#f472b6",
  any:   "#94a3b8",
};

const DEFAULT_STROKE = "#a78bfa";
const FAILED_STROKE  = "#ef4444";

export default function FlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  selected,
  markerEnd,
  markerStart,
  interactionWidth,
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

  // Resolve a concrete colour from the source port type. We pull from our Zustand store
  // directly (not React Flow's internal store) so this never depends on internal lookups
  // that might not be ready on first render.
  const nodes        = useFlowStore((s) => s.nodes);
  const nodeTypes    = useFlowStore((s) => s.nodeTypes);
  const nodeStatuses = useFlowStore((s) => s.nodeStatuses);

  let portColor = DEFAULT_STROKE;
  const srcNode = nodes.find((n) => n.id === source);
  if (srcNode) {
    const reg  = nodeTypes.find((t) => t.type === srcNode.type);
    const port = reg?.outputs?.find((p) => p.id === sourceHandleId) || reg?.outputs?.[0];
    if (port?.type && PORT_COLORS[port.type]) portColor = PORT_COLORS[port.type];
  }

  const targetStatus = nodeStatuses[target]?.status;
  const sourceStatus = nodeStatuses[source]?.status;
  const isRunning   = targetStatus === "running";
  const isCompleted = sourceStatus === "completed" || targetStatus === "completed";
  const isFailed    = targetStatus === "failed" || sourceStatus === "failed";
  const isIdle      = !isRunning && !isCompleted && !isFailed;

  const stroke      = isFailed ? FAILED_STROKE : portColor;
  const strokeWidth = selected ? 2.6 : isRunning ? 2.4 : 2.1;
  // Idle and running both use a dash; completed/failed go solid.
  const strokeDasharray = isRunning ? "8 6" : isIdle ? "6 6" : undefined;
  const strokeOpacity   = selected ? 1 : isIdle ? 0.85 : 0.95;

  // Inline style — beats any CSS rule short of !important and survives every render frame.
  const edgeStyle = {
    stroke,
    strokeWidth,
    strokeDasharray,
    strokeOpacity,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
    animation: isRunning ? "flow-dash 0.7s linear infinite" : undefined,
  };

  // Soft glow underlay — separate <path> drawn behind BaseEdge. We render it inside a wrapping
  // <g> alongside <BaseEdge /> so React Flow's internal edge group still gets the proper
  // `.react-flow__edge-path` element from BaseEdge.
  const glowStyle = {
    stroke,
    strokeWidth: selected ? 8 : isRunning ? 7 : 5,
    strokeOpacity: isRunning ? 0.32 : selected ? 0.24 : isCompleted ? 0.18 : 0.16,
    strokeLinecap: "round",
    fill: "none",
    filter: "blur(2.5px)",
    pointerEvents: "none",
  };

  return (
    <>
      {/* Glow underlay — purely decorative, no interaction. */}
      <path d={edgePath} style={glowStyle} />
      {/* Canonical React Flow edge — gets `react-flow__edge-path` className,
          interaction overlay, marker support, label slot, etc. */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth ?? 22}
      />
    </>
  );
}
