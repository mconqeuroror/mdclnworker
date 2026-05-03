/**
 * AI Flows Builder — Zustand canvas store
 *
 * Manages React Flow canvas state (nodes, edges, selection) plus
 * the sidebar state and current run status / SSE stream.
 */

import { create } from "zustand";
import { applyNodeChanges, applyEdgeChanges, addEdge } from "@xyflow/react";

let historyStack = [];
let historyFuture = [];
const MAX_HISTORY = 50;

// Port types where MULTIPLE inbound connections to the same handle make
// logical sense (the engine concatenates / arrays them). Other typed inputs
// (image/video/model/audio) replace the existing connection on re-connect.
const MULTI_CONNECT_TYPES = new Set(["any", "text"]);

// ComfyUI-style wire colors per port data type.
const PORT_COLORS = {
  image: "#a78bfa",
  video: "#f59e0b",
  text:  "#22d3ee",
  model: "#34d399",
  audio: "#f472b6",
  any:   "#94a3b8",
};
const DEFAULT_WIRE = "#a78bfa";

function resolveEdgeColor(state, connection) {
  const srcNode = state.nodes.find((n) => n.id === connection.source);
  if (!srcNode) return DEFAULT_WIRE;
  const reg = state.nodeTypes.find((t) => t.type === srcNode.type);
  const port =
    reg?.outputs?.find((p) => p.id === connection.sourceHandle) ||
    reg?.outputs?.[0];
  if (port?.type && PORT_COLORS[port.type]) return PORT_COLORS[port.type];
  return DEFAULT_WIRE;
}

export const useFlowStore = create((set, get) => ({
  // ── Canvas ──────────────────────────────────────────────────────────────
  nodes: [],
  edges: [],
  selectedNodeId: null,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) => {
      const { nodeTypes } = state;
      if (!connection.source || !connection.target) return state;
      if (connection.source === connection.target) return state;

      const targetNode = state.nodes.find((n) => n.id === connection.target);
      const targetReg = nodeTypes.find((t) => t.type === targetNode?.type);
      const targetPort = targetReg?.inputs?.find((p) => p.id === connection.targetHandle);
      const allowMulti =
        !targetPort // unknown port — be permissive
        || MULTI_CONNECT_TYPES.has(targetPort.type)
        // Aggregator-style nodes (merge/output viewer) accept many.
        || /^(merge|combine|aggregator|output)/i.test(targetReg?.type || "");

      // For single-cardinality typed inputs, drop any existing edge already
      // landing on the same target handle so the new edge replaces it.
      const filtered = allowMulti
        ? state.edges
        : state.edges.filter(
            (e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle)
          );

      // Explicit edge id so React Flow never falls back to nanoid/auto-id
      // mid-render (which can cause a race where the new edge briefly has no
      // type and is skipped by the custom edgeTypes map).
      const edgeId = `e-${connection.source}_${connection.sourceHandle || "out"}-${connection.target}_${connection.targetHandle || "in"}-${Date.now()}`;

      // Bake the port-typed color straight into the edge at creation time.
      // FlowEdge just reads `style.stroke` — no per-render registry lookup,
      // no race against `nodeTypes` load order, the wire is ALWAYS visible.
      const stroke = resolveEdgeColor(state, connection);

      const newEdge = {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
        type: "default",
        animated: false,
        style: { stroke, strokeWidth: 2.5 },
      };

      return {
        edges: addEdge(newEdge, filtered),
        isDirty: true,
      };
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  clearSelection: () => set({ selectedNodeId: null }),

  addNode: (node) => {
    get()._pushHistory();
    set((state) => ({ nodes: [...state.nodes, node] }));
  },

  updateNodeData: (nodeId, data) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }));
  },

  deleteNode: (nodeId) => {
    get()._pushHistory();
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    }));
  },

  duplicateNode: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    get()._pushHistory();
    const newNode = {
      ...node,
      id: `${node.type}-${Date.now()}`,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data },
      selected: false,
    };
    set((state) => ({ nodes: [...state.nodes, newNode] }));
  },

  // ── Grouping (multi-select → group container) ────────────────────────────
  groupSelection: () => {
    const state = get();
    const selected = state.nodes.filter((n) => n.selected && n.type !== "group");
    if (selected.length < 2) return;
    get()._pushHistory();

    // Bounding box of selection
    const PADDING = 36;
    const HEADER = 30;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selected.forEach((n) => {
      const w = n.width || n.style?.width || 240;
      const h = n.height || n.style?.height || 160;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    });

    const groupId = `group-${Date.now()}`;
    const groupNode = {
      id: groupId,
      type: "group",
      position: { x: minX - PADDING, y: minY - PADDING - HEADER },
      data: { label: "Group" },
      style: {
        width: maxX - minX + PADDING * 2,
        height: maxY - minY + PADDING * 2 + HEADER,
      },
      selectable: true,
      draggable: true,
    };

    const childIds = new Set(selected.map((n) => n.id));
    const newNodes = [
      groupNode,
      ...state.nodes.map((n) => {
        if (!childIds.has(n.id)) return n;
        return {
          ...n,
          parentId: groupId,
          extent: "parent",
          position: {
            x: n.position.x - groupNode.position.x,
            y: n.position.y - groupNode.position.y,
          },
          selected: false,
        };
      }),
    ];

    set({ nodes: newNodes, isDirty: true });
  },

  ungroupSelection: () => {
    const state = get();
    const groups = state.nodes.filter((n) => n.selected && n.type === "group");
    if (groups.length === 0) return;
    get()._pushHistory();
    const groupIds = new Set(groups.map((g) => g.id));
    const newNodes = state.nodes
      .filter((n) => !groupIds.has(n.id)) // drop the group containers
      .map((n) => {
        if (!n.parentId || !groupIds.has(n.parentId)) return n;
        const parent = groups.find((g) => g.id === n.parentId);
        return {
          ...n,
          parentId: undefined,
          extent: undefined,
          position: {
            x: (parent?.position?.x || 0) + n.position.x,
            y: (parent?.position?.y || 0) + n.position.y,
          },
        };
      });
    set({ nodes: newNodes, isDirty: true });
  },

  // ── History (undo/redo) ──────────────────────────────────────────────────
  _pushHistory: () => {
    const state = get();
    historyStack = [...historyStack.slice(-MAX_HISTORY), { nodes: state.nodes, edges: state.edges }];
    historyFuture = [];
  },

  undo: () => {
    if (!historyStack.length) return;
    const state = get();
    historyFuture = [{ nodes: state.nodes, edges: state.edges }, ...historyFuture];
    const prev = historyStack[historyStack.length - 1];
    historyStack = historyStack.slice(0, -1);
    set({ nodes: prev.nodes, edges: prev.edges });
  },

  redo: () => {
    if (!historyFuture.length) return;
    const state = get();
    historyStack = [...historyStack, { nodes: state.nodes, edges: state.edges }];
    const next = historyFuture[0];
    historyFuture = historyFuture.slice(1);
    set({ nodes: next.nodes, edges: next.edges });
  },

  canUndo: () => historyStack.length > 0,
  canRedo: () => historyFuture.length > 0,

  // ── Flow metadata ────────────────────────────────────────────────────────
  currentFlowId: null,
  currentFlowName: "Untitled Flow",
  isDirty: false,

  setCurrentFlow: (flow) =>
    set((state) => {
      // Normalise loaded edges: ensure every one has a `style.stroke` so
      // the wire is visible even if the flow was saved before we started
      // baking port colours into the edge.
      const incomingNodes = flow.nodes || [];
      const rawEdges = flow.edges || [];
      const tempState = { ...state, nodes: incomingNodes };
      const normalisedEdges = rawEdges.map((e) => {
        if (e.style?.stroke) return { ...e, type: e.type || "default" };
        const stroke = resolveEdgeColor(tempState, {
          source: e.source,
          sourceHandle: e.sourceHandle,
        });
        return {
          ...e,
          type: e.type || "default",
          style: { ...(e.style || {}), stroke, strokeWidth: 2.5 },
        };
      });
      return {
        currentFlowId: flow.id,
        currentFlowName: flow.name,
        nodes: incomingNodes,
        edges: normalisedEdges,
        isDirty: false,
      };
    }),

  setFlowName: (name) => set({ currentFlowName: name, isDirty: true }),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),

  // ── Run state ────────────────────────────────────────────────────────────
  currentRunId: null,
  runStatus: null, // "pending" | "running" | "completed" | "failed" | "cancelled"
  nodeStatuses: {}, // { nodeId: { status, output, outputType, message, error } }
  runLogs: [],
  creditsUsed: 0,
  runError: null,

  setCurrentRunId: (id) => set({ currentRunId: id }),

  handleSSEEvent: (event) => {
    const { type, nodeId, status, output, outputType, message, error, creditsUsed, nodeResults } = event;

    if (type === "node") {
      set((state) => ({
        nodeStatuses: {
          ...state.nodeStatuses,
          [nodeId]: { status, output, outputType, message, error },
        },
        // Animate edges when a node starts running
        edges: status === "running"
          ? state.edges.map((e) =>
              e.target === nodeId ? { ...e, animated: true } : e
            )
          : status === "completed"
          ? state.edges.map((e) =>
              e.target === nodeId ? { ...e, animated: false } : e
            )
          : state.edges,
      }));
    } else if (type === "log") {
      set((state) => ({
        runLogs: [...state.runLogs, { ts: event.ts, nodeId, message: event.message, level: event.level }],
      }));
    } else if (type === "flow") {
      set({
        runStatus: status,
        creditsUsed: creditsUsed || 0,
        runError: error || null,
        ...(nodeResults ? { nodeStatuses: Object.fromEntries(
          Object.entries(nodeResults).map(([id, r]) => [id, { status: r.status, output: r.output, outputType: r.outputType, error: r.error }])
        ) } : {}),
      });
    }
  },

  startRun: (runId) =>
    set({ currentRunId: runId, runStatus: "pending", nodeStatuses: {}, runLogs: [], creditsUsed: 0, runError: null }),

  resetRun: () =>
    set({ currentRunId: null, runStatus: null, nodeStatuses: {}, runLogs: [], creditsUsed: 0, runError: null }),

  // ── UI state ─────────────────────────────────────────────────────────────
  paletteOpen: true,
  rightPanelOpen: true,
  rightPanelTab: "library", // "library" | "execution"

  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  // Load saved flows list
  savedFlows: [],
  setSavedFlows: (flows) => set({ savedFlows: flows }),

  // Node type registry (loaded from server)
  nodeTypes: [],
  nodeCategories: {},
  setNodeTypeRegistry: (types, categories) => set({ nodeTypes: types, nodeCategories: categories }),
}));
