/**
 * FlowEdge — bezier edge with a guaranteed-visible stroke.
 *
 * Renders a solid coloured underlay first (so the edge is visible even if the
 * gradient <defs> hasn't mounted on the very first render frame), then layers
 * a gradient stroke on top. Idle edges are dashed; running ones get an
 * animated travelling pulse with a soft glow halo.
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

const FALLBACK_STROKE = "#a78bfa";

function resolvePortColor(node, registry, handleId, side) {
  if (!node || !registry) return null;
  const reg = registry.find((t) => t.type === node.type);
  if (!reg) return null;
  const ports = side === "source" ? reg.outputs : reg.inputs;
  const port = ports?.find((p) => p.id === handleId) || ports?.[0];
  return port ? PORT_COLORS[port.type] || null : null;
}

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
  targetHandleId,
  selected,
  markerEnd,
}) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.35,
  });

  // Pull state from our own store — reliable, no React Flow internals.
  const nodeStatuses = useFlowStore((s) => s.nodeStatuses);
  const nodeTypes    = useFlowStore((s) => s.nodeTypes);
  const nodes        = useFlowStore((s) => s.nodes);

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);

  const sourceColor =
    resolvePortColor(sourceNode, nodeTypes, sourceHandleId, "source") || FALLBACK_STROKE;
  const targetColor =
    resolvePortColor(targetNode, nodeTypes, targetHandleId, "target") || FALLBACK_STROKE;

  const targetStatus = nodeStatuses[target]?.status;
  const sourceStatus = nodeStatuses[source]?.status;
  const isRunning   = targetStatus === "running";
  const isCompleted = sourceStatus === "completed" || targetStatus === "completed";
  const isFailed    = targetStatus === "failed" || sourceStatus === "failed";

  const isIdle      = !isRunning && !isCompleted && !isFailed && !selected;
  const dashArray   = isRunning ? "6 6" : isIdle ? "5 5" : "none";
  const strokeWidth = selected ? 2.5 : isRunning ? 2.25 : 2;

  // Pick a single concrete colour for the underlay so edges are always
  // visible regardless of gradient/defs timing.
  const fallbackStroke = isFailed
    ? "#ef4444"
    : isRunning
    ? sourceColor
    : isCompleted
    ? sourceColor
    : sourceColor;

  return (
    <>
      <defs>
        <linearGradient
          id={`edge-gradient-${id}`}
          gradientUnits="userSpaceOnUse"
          x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}
        >
          <stop offset="0%"   stopColor={sourceColor} />
          <stop offset="100%" stopColor={targetColor} />
        </linearGradient>
      </defs>

      {/* Soft glow underlay */}
      <path
        d={edgePath}
        fill="none"
        stroke={fallbackStroke}
        strokeWidth={isRunning || selected ? 7 : 5}
        strokeOpacity={isRunning ? 0.28 : selected ? 0.20 : isCompleted ? 0.16 : 0.12}
        style={{ filter: "blur(3px)", pointerEvents: "none" }}
      />

      {/* Solid colour stroke (always visible) */}
      <path
        d={edgePath}
        fill="none"
        stroke={fallbackStroke}
        strokeWidth={strokeWidth}
        strokeOpacity={isIdle ? 0.85 : 1}
        strokeDasharray={dashArray}
        strokeLinecap="round"
        style={{
          animation: isRunning ? "flow-dash 0.8s linear infinite" : "none",
          pointerEvents: "none",
        }}
      />

      {/* Gradient stroke layered on top — adds the source→target colour fade */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isFailed ? "#ef4444" : `url(#edge-gradient-${id})`,
          strokeWidth,
          fill: "none",
          strokeDasharray: dashArray,
          strokeLinecap: "round",
          animation: isRunning ? "flow-dash 0.8s linear infinite" : "none",
        }}
      />
    </>
  );
}
