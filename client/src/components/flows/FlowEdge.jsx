/**
 * FlowEdge — custom edge with gradient stroke (source-handle color → target-handle color),
 * thicker hit area, and animated traveling pulse when the connected target is running.
 */

import { BaseEdge, getBezierPath, useStore } from "@xyflow/react";
import { useMemo } from "react";
import { useFlowStore } from "../../store/flowStore";

const PORT_COLORS = {
  image: "#a78bfa",
  video: "#f59e0b",
  text:  "#22d3ee",
  model: "#34d399",
  audio: "#f472b6",
  any:   "#94a3b8",
};

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

  const nodeStatuses = useFlowStore((s) => s.nodeStatuses);
  const nodeTypes = useFlowStore((s) => s.nodeTypes);
  const sourceNode = useStore((s) => s.nodeLookup.get(source));
  const targetNode = useStore((s) => s.nodeLookup.get(target));

  // Resolve source / target port colors
  const { sourceColor, targetColor } = useMemo(() => {
    const sReg = nodeTypes.find((t) => t.type === sourceNode?.type);
    const tReg = nodeTypes.find((t) => t.type === targetNode?.type);
    const sPort = sReg?.outputs?.find((p) => p.id === sourceHandleId) || sReg?.outputs?.[0];
    const tPort = tReg?.inputs?.find((p) => p.id === targetHandleId) || tReg?.inputs?.[0];
    return {
      sourceColor: PORT_COLORS[sPort?.type] || PORT_COLORS.any,
      targetColor: PORT_COLORS[tPort?.type] || PORT_COLORS.any,
    };
  }, [sourceNode, targetNode, sourceHandleId, targetHandleId, nodeTypes]);

  const targetStatus = nodeStatuses[target]?.status;
  const sourceStatus = nodeStatuses[source]?.status;
  const isRunning = targetStatus === "running";
  const isCompleted = sourceStatus === "completed" || targetStatus === "completed";
  const isFailed = targetStatus === "failed" || sourceStatus === "failed";

  // Strokes — connected edges are clearly visible by default.
  const strokeOpacity = selected || isRunning ? 1 : isCompleted ? 0.95 : 0.85;
  const strokeWidth = selected ? 2.5 : isRunning ? 2.25 : 2;

  return (
    <>
      <defs>
        <linearGradient id={`edge-gradient-${id}`} gradientUnits="userSpaceOnUse"
          x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={sourceColor} stopOpacity={strokeOpacity} />
          <stop offset="100%" stopColor={targetColor} stopOpacity={strokeOpacity} />
        </linearGradient>
        {isRunning && (
          <linearGradient id={`edge-pulse-${id}`} gradientUnits="userSpaceOnUse"
            x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
            <stop offset="0%" stopColor={sourceColor} stopOpacity="0" />
            <stop offset="50%" stopColor={sourceColor} stopOpacity="1" />
            <stop offset="100%" stopColor={targetColor} stopOpacity="0" />
          </linearGradient>
        )}
      </defs>

      {/* Soft glow underlay — always present on connected edges */}
      <path
        d={edgePath}
        fill="none"
        stroke={isRunning ? sourceColor : isCompleted ? sourceColor : targetColor}
        strokeWidth={isRunning || selected ? 7 : 5}
        strokeOpacity={isRunning ? 0.25 : selected ? 0.18 : isCompleted ? 0.14 : 0.10}
        style={{ filter: "blur(3px)" }}
      />

      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isFailed ? "#ef4444aa" : `url(#edge-gradient-${id})`,
          strokeWidth,
          fill: "none",
          strokeDasharray: isRunning ? "6 6" : "none",
          animation: isRunning ? "flow-dash 0.8s linear infinite" : "none",
        }}
      />
    </>
  );
}
