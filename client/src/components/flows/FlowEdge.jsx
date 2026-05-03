/**
 * FlowEdge — custom React Flow edge.
 *
 * Minimal, rock-solid implementation:
 *   1. Compute a bezier path from the endpoints React Flow passes in.
 *   2. Render ONE visible <path> with the canonical `react-flow__edge-path`
 *      className so React Flow's interaction handling + our CSS baseline
 *      both latch on correctly.
 *   3. Render a second wider transparent <path> to make clicking the edge
 *      forgiving (the "interaction zone").
 *
 * No BaseEdge, no glow underlay, no store subscriptions — keeping the edge
 * component as stateless & synchronous as possible means it renders on the
 * very first frame after onConnect, which is the only way the user sees the
 * line the moment they drop the connection.
 *
 * Colour, dashing, animation and width are all driven by the `data` object
 * React Flow hands us (set from flowStore when the edge is created / updated).
 * Falls back to a sensible violet dashed line when nothing is set so the edge
 * is ALWAYS visible.
 */

import { getBezierPath } from "@xyflow/react";
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

export default function FlowEdge(props) {
  const {
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
  } = props;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.32,
  });

  // Resolve port colour by looking up the source node's output port. Pulling
  // from our Zustand store (not React Flow's internal store) keeps this
  // resilient to mount-order edge cases.
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

  const stroke = isFailed ? FAILED_STROKE : portColor;
  const strokeWidth = selected ? 2.8 : isRunning ? 2.5 : 2.1;
  const strokeDasharray = isRunning ? "8 6" : isIdle ? "6 6" : undefined;
  const strokeOpacity = selected ? 1 : isIdle ? 0.92 : 0.95;

  return (
    <>
      {/* The actual visible edge — canonical `react-flow__edge-path` class
          so React Flow's CSS hooks (selection, hover) still apply. Inline
          style wins over stylesheet rules so port-colour + animation are
          guaranteed. */}
      <path
        id={id}
        d={edgePath}
        className="react-flow__edge-path"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeOpacity={strokeOpacity}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          animation: isRunning ? "flow-dash 0.7s linear infinite" : undefined,
        }}
      />
      {/* Wide transparent interaction strip so edges are easy to click / hover. */}
      <path
        d={edgePath}
        className="react-flow__edge-interaction"
        fill="none"
        stroke="transparent"
        strokeWidth={22}
      />
    </>
  );
}
