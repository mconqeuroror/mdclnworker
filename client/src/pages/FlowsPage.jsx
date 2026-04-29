/**
 * AI Flows Builder — main canvas page.
 *
 * Aesthetic direction: "AI Lab Workshop" — refined dark glass, Syne for the
 * brand mark, JetBrains Mono for technical labels, Inter for UI body, with
 * a subtle aurora gradient mesh on the canvas background.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  Save,
  Undo2,
  Redo2,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Loader2,
  Coins,
  Play,
  ArrowLeft,
  Workflow,
  Library,
  Terminal,
  Group as GroupIcon,
  Ungroup,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import { useFlowStore } from "../store/flowStore";
import { useAuthStore } from "../store";
import { NodePalette } from "../components/flows/NodePalette";
import { FlowLibrary } from "../components/flows/FlowLibrary";
import { ExecutionPanel } from "../components/flows/ExecutionPanel";
import FlowEdge from "../components/flows/FlowEdge";

// Node types
import ImageInputNode from "../components/flows/nodes/ImageInputNode";
import TextInputNode from "../components/flows/nodes/TextInputNode";
import ModelSelectorNode from "../components/flows/nodes/ModelSelectorNode";
import EnhancePromptNode from "../components/flows/nodes/EnhancePromptNode";
import NanaBananaNode from "../components/flows/nodes/NanaBananaNode";
import SeedreamNode from "../components/flows/nodes/SeedreamNode";
import MCXNode from "../components/flows/nodes/MCXNode";
import CreatorStudioNode from "../components/flows/nodes/CreatorStudioNode";
import UpscalerNode from "../components/flows/nodes/UpscalerNode";
import SynthIDNode from "../components/flows/nodes/SynthIDNode";
import FaceSwapNode from "../components/flows/nodes/FaceSwapNode";
import VideoPromptNode from "../components/flows/nodes/VideoPromptNode";
import VideoMotionNode from "../components/flows/nodes/VideoMotionNode";
import TalkingHeadNode from "../components/flows/nodes/TalkingHeadNode";
import NSFWGenNode from "../components/flows/nodes/NSFWGenNode";
import NSFWVideoNode from "../components/flows/nodes/NSFWVideoNode";
import NSFWMotionNode from "../components/flows/nodes/NSFWMotionNode";
import OutputViewerNode from "../components/flows/nodes/OutputViewerNode";
import GroupNode from "../components/flows/nodes/GroupNode";

const NODE_TYPE_MAP = {
  group:                GroupNode,
  "image-input":        ImageInputNode,
  "text-input":         TextInputNode,
  "model-selector":     ModelSelectorNode,
  "enhance-prompt":     EnhancePromptNode,
  "nana-banana-avatar": NanaBananaNode,
  "seedream-avatar":    SeedreamNode,
  "mcx-img2img":        MCXNode,
  "creator-studio":     CreatorStudioNode,
  "upscaler":           UpscalerNode,
  "synthid-remover":    SynthIDNode,
  "face-swap":          FaceSwapNode,
  "video-prompt":       VideoPromptNode,
  "video-motion":       VideoMotionNode,
  "talking-head":       TalkingHeadNode,
  "nsfw-gen":           NSFWGenNode,
  "nsfw-video":         NSFWVideoNode,
  "nsfw-motion":        NSFWMotionNode,
  "output-viewer":      OutputViewerNode,
};

const EDGE_TYPES = { default: FlowEdge, smoothstep: FlowEdge, bezier: FlowEdge };

function authHeader() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Inner canvas (inside ReactFlowProvider) ───────────────────────────────

function FlowCanvas({ flowId, embedded = false }) {
  const { screenToFlowPosition } = useReactFlow();
  const navigate = useNavigate();
  const store = useFlowStore();
  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    addNode, setCurrentFlow, markDirty,
    paletteOpen, togglePalette,
    rightPanelOpen, toggleRightPanel,
    rightPanelTab, setRightPanelTab,
    currentFlowId, currentFlowName, isDirty,
    setFlowName, markClean, setSavedFlows,
    setNodeTypeRegistry, nodeTypes,
    startRun, resetRun, handleSSEEvent,
    undo, redo, groupSelection, ungroupSelection,
    runStatus, currentRunId,
  } = store;

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedNonGroupCount = selectedNodes.filter((n) => n.type !== "group").length;
  const selectedGroupCount = selectedNodes.filter((n) => n.type === "group").length;

  const [libLoading, setLibLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const sseRef = useRef(null);
  const creditEstimate = nodeTypes.reduce((sum, t) => {
    const matches = nodes.filter((n) => n.type === t.type).length;
    return sum + matches * (t.creditCost || 0);
  }, 0);

  // Load node type registry once
  useEffect(() => {
    if (nodeTypes.length > 0) return;
    fetch("/api/flows/node-types", { headers: authHeader() })
      .then((r) => r.json())
      .then(({ types, categories }) => setNodeTypeRegistry(types, categories))
      .catch(() => {});
  }, []);

  const loadFlowList = useCallback(async () => {
    setLibLoading(true);
    try {
      const res = await fetch("/api/flows", { headers: authHeader() });
      const data = await res.json();
      setSavedFlows(data.flows || []);
    } catch { /* ignore */ }
    finally { setLibLoading(false); }
  }, [setSavedFlows]);

  useEffect(() => { loadFlowList(); }, []);

  // Load flow by id
  useEffect(() => {
    if (!flowId || flowId === currentFlowId) return;
    fetch(`/api/flows/${flowId}`, { headers: authHeader() })
      .then((r) => r.json())
      .then(({ flow }) => { if (flow) setCurrentFlow(flow); })
      .catch(() => {});
  }, [flowId]);

  // SSE
  useEffect(() => {
    if (!currentRunId || (runStatus !== "pending" && runStatus !== "running")) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    const token = useAuthStore.getState().token;
    const url = `/api/flows/runs/${currentRunId}/stream`;
    const es = new EventSource(`${url}?token=${encodeURIComponent(token || "")}`);
    es.onmessage = (e) => {
      try { handleSSEEvent(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    es.onerror = () => es.close();
    sseRef.current = es;
    return () => { es.close(); sseRef.current = null; };
  }, [currentRunId, runStatus]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/flow-node-type");
    if (!type) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const registry = useFlowStore.getState().nodeTypes;
    const def = registry.find((t) => t.type === type);
    const newNode = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      data: { ...(def?.defaultData || {}), label: def?.label || type },
    };
    addNode(newNode);
    markDirty();
  }, [screenToFlowPosition, addNode, markDirty]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "g" && !e.shiftKey) { e.preventDefault(); groupSelection(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "g" && e.shiftKey)  { e.preventDefault(); ungroupSelection(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentFlowId, currentFlowName, nodes, edges, groupSelection, ungroupSelection]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body = { name: currentFlowName, nodes, edges };
      let res;
      if (currentFlowId) {
        res = await fetch(`/api/flows/${currentFlowId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/flows", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.flow) setCurrentFlow(data.flow);
      }
      markClean();
      loadFlowList();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [currentFlowId, currentFlowName, nodes, edges]);

  const handleNew = useCallback(() => {
    setCurrentFlow({ id: null, name: "Untitled Flow", nodes: [], edges: [] });
    resetRun();
    markClean();
  }, []);

  const handleLoadFlow = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/flows/${id}`, { headers: authHeader() });
      const { flow } = await res.json();
      if (flow) { setCurrentFlow(flow); resetRun(); }
      setRightPanelTab("execution");
    } catch { /* ignore */ }
  }, []);

  const handleDeleteFlow = useCallback(async (id) => {
    if (!window.confirm("Delete this flow?")) return;
    await fetch(`/api/flows/${id}`, { method: "DELETE", headers: authHeader() });
    if (currentFlowId === id) handleNew();
    loadFlowList();
  }, [currentFlowId]);

  const handleLoadTemplate = useCallback((template) => {
    setCurrentFlow({ id: null, name: template.name, nodes: template.nodes, edges: template.edges });
    resetRun();
    markDirty();
  }, [setCurrentFlow, resetRun]);

  const handleRun = useCallback(async () => {
    if (!currentFlowId) {
      await handleSave();
      await new Promise(r => setTimeout(r, 300));
    }
    const fid = useFlowStore.getState().currentFlowId;
    if (!fid) return;
    const res = await fetch(`/api/flows/${fid}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
    });
    const data = await res.json();
    if (data.runId) {
      startRun(data.runId);
      setRightPanelTab("execution");
    }
  }, [currentFlowId, nodes]);

  const handleCancel = useCallback(async () => {
    if (!currentRunId) return;
    await fetch(`/api/flows/runs/${currentRunId}`, { method: "DELETE", headers: authHeader() });
    resetRun();
  }, [currentRunId]);

  const isValidConnection = useCallback((connection) => {
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return true;
    const sourceReg = nodeTypes.find((t) => t.type === sourceNode.type);
    const targetReg = nodeTypes.find((t) => t.type === targetNode.type);
    const sourcePort = sourceReg?.outputs?.find((p) => p.id === connection.sourceHandle);
    const targetPort = targetReg?.inputs?.find((p) => p.id === connection.targetHandle);
    if (!sourcePort || !targetPort) return true;
    if (targetPort.type === "any" || sourcePort.type === "any") return true;
    return sourcePort.type === targetPort.type;
  }, [nodes, nodeTypes]);

  const isRunning = runStatus === "running" || runStatus === "pending";

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: "#08080b", color: "#f4f4f5" }}>
      {/* ── Left palette ── */}
      <div
        className={`flex-shrink-0 flex flex-col transition-[width] duration-200 ease-out
          ${paletteOpen ? "w-[210px]" : "w-0 overflow-hidden"}`}
        style={{
          background: "linear-gradient(180deg, #0c0c10 0%, #08080b 100%)",
          borderRight: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(124,58,237,0.08) 100%)", border: "1px solid rgba(167,139,250,0.2)" }}
            >
              <Workflow size={11} className="text-violet-300" strokeWidth={2} />
            </div>
            <span
              className="text-[8px] uppercase tracking-[0.2em] font-bold text-white/55"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Nodes
            </span>
          </div>
        </div>
        <NodePalette />
      </div>

      {/* ── Canvas area ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* ── Toolbar ── */}
        <div
          className="flex items-center gap-2 px-3 py-2 flex-shrink-0 z-20 relative"
          style={{
            background: "rgba(10,10,14,0.85)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {!embedded && (
            <button
              onClick={() => navigate("/dashboard")}
              className="p-1.5 rounded-md hover:bg-white/[0.05] text-white/35 hover:text-white/75 transition-colors flex-shrink-0"
              title="Back"
            >
              <ArrowLeft size={13} strokeWidth={1.8} />
            </button>
          )}

          <button
            onClick={togglePalette}
            className="p-1.5 rounded-md hover:bg-white/[0.05] text-white/35 hover:text-white/75 transition-colors flex-shrink-0"
            title="Toggle palette"
          >
            {paletteOpen
              ? <ChevronLeft size={13} strokeWidth={1.8} />
              : <ChevronRight size={13} strokeWidth={1.8} />}
          </button>

          {/* Brand mark */}
          <div className="hidden md:flex items-center gap-2 ml-1 mr-2 pr-2 border-r border-white/[0.05]">
            <span
              className="text-[16px] font-bold tracking-[-0.03em] leading-none"
              style={{
                fontFamily: "var(--font-syne)",
                background: "linear-gradient(135deg, #fff 0%, #a78bfa 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Flows
            </span>
          </div>

          {/* Flow name */}
          {editingName ? (
            <input
              autoFocus
              value={currentFlowName}
              onChange={(e) => setFlowName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditingName(false)}
              className="bg-white/[0.04] border border-violet-400/40 rounded-md px-2.5 py-1.5 text-[12px]
                text-white/95 outline-none min-w-0 max-w-xs font-medium"
              style={{ fontFamily: "var(--font-sans)" }}
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="flex items-center gap-2 hover:bg-white/[0.03] rounded-md px-2 py-1.5 group max-w-xs"
              title="Click to rename"
            >
              <span className="text-[12px] font-medium text-white/85 truncate">{currentFlowName}</span>
              {isDirty && (
                <span
                  className="w-1 h-1 rounded-full flex-shrink-0"
                  style={{ background: "#f59e0b", boxShadow: "0 0 4px rgba(245,158,11,0.6)" }}
                  title="Unsaved changes"
                />
              )}
            </button>
          )}

          <div className="flex-1" />

          {/* Tech metrics */}
          <div className="hidden sm:flex items-center gap-3 px-3 py-1 rounded-md bg-white/[0.025] border border-white/[0.05]">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[8px] uppercase tracking-[0.15em] text-white/30"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                N
              </span>
              <span
                className="text-[10px] text-white/65 tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {String(nodes.length).padStart(2, "0")}
              </span>
            </div>
            <div className="w-px h-3 bg-white/[0.08]" />
            <div className="flex items-center gap-1.5">
              <span
                className="text-[8px] uppercase tracking-[0.15em] text-white/30"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                E
              </span>
              <span
                className="text-[10px] text-white/65 tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {String(edges.length).padStart(2, "0")}
              </span>
            </div>
            <div className="w-px h-3 bg-white/[0.08]" />
            <div className="flex items-center gap-1.5">
              <Coins size={9} className="text-amber-300/70" strokeWidth={2} />
              <span
                className="text-[10px] text-white/65 tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                ~{creditEstimate}
              </span>
            </div>
          </div>

          {/* Undo/Redo */}
          <div className="flex items-center bg-white/[0.025] border border-white/[0.05] rounded-md overflow-hidden">
            <button
              onClick={undo}
              title="Undo (Ctrl+Z)"
              className="p-1.5 hover:bg-white/[0.04] text-white/35 hover:text-white/75 transition-colors"
            >
              <Undo2 size={12} strokeWidth={1.8} />
            </button>
            <div className="w-px h-3 bg-white/[0.05]" />
            <button
              onClick={redo}
              title="Redo (Ctrl+Y)"
              className="p-1.5 hover:bg-white/[0.04] text-white/35 hover:text-white/75 transition-colors"
            >
              <Redo2 size={12} strokeWidth={1.8} />
            </button>
          </div>

          {/* Group / Ungroup — visible only when relevant selection exists */}
          {(selectedNonGroupCount >= 2 || selectedGroupCount > 0) && (
            <div className="flex items-center bg-white/[0.025] border border-white/[0.05] rounded-md overflow-hidden">
              {selectedNonGroupCount >= 2 && (
                <button
                  onClick={groupSelection}
                  title="Group selection (Ctrl+G)"
                  className="p-1.5 hover:bg-violet-500/10 text-white/45 hover:text-violet-200 transition-colors"
                >
                  <GroupIcon size={12} strokeWidth={1.8} />
                </button>
              )}
              {selectedGroupCount > 0 && (
                <>
                  {selectedNonGroupCount >= 2 && <div className="w-px h-3 bg-white/[0.05]" />}
                  <button
                    onClick={ungroupSelection}
                    title="Ungroup (Ctrl+Shift+G)"
                    className="p-1.5 hover:bg-violet-500/10 text-white/45 hover:text-violet-200 transition-colors"
                  >
                    <Ungroup size={12} strokeWidth={1.8} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.06]
              border border-white/[0.06] text-[10px] font-semibold text-white/65 hover:text-white/90
              disabled:opacity-30 disabled:cursor-not-allowed transition-all tracking-[0.05em]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {saving ? <Loader2 size={11} className="animate-spin" strokeWidth={2} /> : <Save size={11} strokeWidth={1.8} />}
            SAVE
          </button>

          {/* Run */}
          <button
            onClick={handleRun}
            disabled={nodes.length === 0 || isRunning}
            className="relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[10px] font-bold tracking-[0.08em]
              transition-all disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden"
            style={{
              fontFamily: "var(--font-mono)",
              color: "#fff",
              background: isRunning
                ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
                : "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
              boxShadow: isRunning
                ? "0 0 18px rgba(96,165,250,0.45), inset 0 1px 0 0 rgba(255,255,255,0.15)"
                : "0 4px 14px -4px rgba(124,58,237,0.55), inset 0 1px 0 0 rgba(255,255,255,0.15)",
            }}
          >
            {isRunning
              ? <><Loader2 size={11} className="animate-spin" strokeWidth={2.4} /> RUNNING</>
              : <><Play size={10} fill="currentColor" strokeWidth={0} /> EXECUTE</>}
          </button>

          <button
            onClick={toggleRightPanel}
            className="p-1.5 rounded-md hover:bg-white/[0.05] text-white/35 hover:text-white/75 transition-colors flex-shrink-0"
            title="Toggle panel"
          >
            {rightPanelOpen
              ? <ChevronRight size={13} strokeWidth={1.8} />
              : <ChevronLeft size={13} strokeWidth={1.8} />}
          </button>
        </div>

        {/* ── ReactFlow canvas ── */}
        <div
          className="flex-1 relative"
          style={{ background: "#08080b" }}
        >
          {/* Aurora background mesh */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `
                radial-gradient(40% 35% at 25% 35%, rgba(124, 58, 237, 0.10) 0%, transparent 60%),
                radial-gradient(35% 30% at 80% 70%, rgba(245, 158, 11, 0.06) 0%, transparent 60%),
                radial-gradient(45% 40% at 60% 20%, rgba(34, 211, 238, 0.04) 0%, transparent 70%)
              `,
            }}
          />
          {/* Grain texture overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.018] mix-blend-overlay"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' /%3E%3C/svg%3E")`,
            }}
          />

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={NODE_TYPE_MAP}
            edgeTypes={EDGE_TYPES}
            isValidConnection={isValidConnection}
            fitView
            fitViewOptions={{ padding: 0.4, maxZoom: 1.2 }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={["Delete", "Backspace"]}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            selectionKeyCode={null}
            selectionOnDrag
            panOnDrag={[1, 2]}
            selectNodesOnDrag={false}
            selectionMode="partial"
            connectionLineStyle={{ stroke: "#a78bfa", strokeWidth: 2, strokeDasharray: "5 5", strokeLinecap: "round" }}
            defaultEdgeOptions={{ type: "default", animated: false }}
            minZoom={0.25}
            maxZoom={2}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="rgba(255,255,255,0.045)"
            />

            <Controls
              position="bottom-left"
              className="flow-controls"
              showInteractive={false}
            />

            <MiniMap
              position="bottom-right"
              className="flow-minimap"
              maskColor="rgba(0,0,0,0.7)"
              maskStrokeColor="rgba(167,139,250,0.3)"
              maskStrokeWidth={1}
              nodeColor={(n) => {
                const reg = nodeTypes.find((t) => t.type === n.type);
                return reg?.color || "#a78bfa";
              }}
              nodeBorderRadius={4}
              nodeStrokeWidth={2}
              nodeStrokeColor="#08080b"
              style={{
                background: "linear-gradient(135deg, rgba(12,12,16,0.95) 0%, rgba(8,8,12,0.95) 100%)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            />

            {/* Empty state */}
            {nodes.length === 0 && (
              <Panel position="top-center" className="pointer-events-none">
                <div className="mt-32 flex flex-col items-center gap-4 text-center">
                  <div
                    className="w-20 h-20 rounded-2xl flex items-center justify-center relative"
                    style={{
                      background: "linear-gradient(135deg, rgba(167,139,250,0.08) 0%, rgba(124,58,237,0.02) 100%)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      boxShadow: "0 12px 32px -16px rgba(124,58,237,0.4)",
                    }}
                  >
                    <GitBranch size={28} className="text-white/20" strokeWidth={1.4} />
                    <div
                      className="absolute -inset-2 rounded-3xl opacity-40 -z-10"
                      style={{ background: "radial-gradient(circle, rgba(167,139,250,0.15) 0%, transparent 70%)" }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <h2
                      className="text-[24px] font-bold tracking-[-0.02em]"
                      style={{
                        fontFamily: "var(--font-syne)",
                        background: "linear-gradient(135deg, #fff 0%, rgba(167,139,250,0.7) 100%)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      }}
                    >
                      Compose your pipeline
                    </h2>
                    <p
                      className="text-[11px] text-white/35 tracking-[0.05em]"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      drag nodes from the palette · or pick a template ↗
                    </p>
                  </div>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div
        className={`flex-shrink-0 flex flex-col transition-[width] duration-200 ease-out
          ${rightPanelOpen ? "w-[240px]" : "w-0 overflow-hidden"}`}
        style={{
          background: "linear-gradient(180deg, #0c0c10 0%, #08080b 100%)",
          borderLeft: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {/* Tabs */}
        <div className="flex border-b border-white/[0.04] flex-shrink-0">
          <button
            onClick={() => setRightPanelTab("library")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[8px] font-bold uppercase tracking-[0.18em]
              transition-colors relative
              ${rightPanelTab === "library" ? "text-white/85" : "text-white/30 hover:text-white/55"}`}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <Library size={10} strokeWidth={2} />
            Library
            {rightPanelTab === "library" && (
              <span
                className="absolute bottom-0 left-2 right-2 h-px rounded-full"
                style={{ background: "linear-gradient(90deg, transparent, #a78bfa, transparent)" }}
              />
            )}
          </button>
          <button
            onClick={() => setRightPanelTab("execution")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[8px] font-bold uppercase tracking-[0.18em]
              transition-colors relative
              ${rightPanelTab === "execution" ? "text-white/85" : "text-white/30 hover:text-white/55"}`}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <Terminal size={10} strokeWidth={2} />
            Run
            {isRunning && (
              <span
                className="w-1.5 h-1.5 rounded-full ml-0.5"
                style={{ background: "#60a5fa", boxShadow: "0 0 6px rgba(96,165,250,0.7)" }}
              />
            )}
            {rightPanelTab === "execution" && (
              <span
                className="absolute bottom-0 left-2 right-2 h-px rounded-full"
                style={{ background: "linear-gradient(90deg, transparent, #a78bfa, transparent)" }}
              />
            )}
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {rightPanelTab === "library" ? (
            <FlowLibrary
              onLoadFlow={handleLoadFlow}
              onNewFlow={handleNew}
              onDeleteFlow={handleDeleteFlow}
              onLoadTemplate={handleLoadTemplate}
              loading={libLoading}
            />
          ) : (
            <ExecutionPanel onRun={handleRun} onCancel={handleCancel} creditEstimate={creditEstimate} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page wrapper (provides ReactFlow context) ──────────────────────────────

export default function FlowsPage({ embedded = false }) {
  const flowId = !embedded
    ? (window.location.pathname.split("/flows/")[1] || null)
    : null;

  return (
    <div
      className={embedded
        ? "relative w-full overflow-hidden"
        : "fixed inset-0 overflow-hidden"
      }
      style={embedded
        ? { height: "calc(100vh - 4.5rem)", background: "#08080b", zIndex: 1 }
        : { top: 0, left: 0, right: 0, bottom: 0, background: "#08080b", zIndex: 1 }
      }
    >
      <ReactFlowProvider>
        <FlowCanvas flowId={flowId} embedded={embedded} />
      </ReactFlowProvider>

      <style>{`
        .react-flow__attribution { display: none !important; }

        /* Edge dash flow animation */
        @keyframes flow-dash {
          to { stroke-dashoffset: -12; }
        }

        /* Custom controls */
        .flow-controls {
          background: linear-gradient(135deg, rgba(12,12,16,0.95) 0%, rgba(8,8,12,0.95) 100%) !important;
          border: 1px solid rgba(255,255,255,0.06) !important;
          border-radius: 8px !important;
          overflow: hidden;
          box-shadow: 0 8px 24px -8px rgba(0,0,0,0.6) !important;
        }
        .flow-controls button {
          background: transparent !important;
          border: none !important;
          border-bottom: 1px solid rgba(255,255,255,0.04) !important;
          color: rgba(255,255,255,0.4) !important;
          width: 28px !important;
          height: 28px !important;
          padding: 0 !important;
          transition: all 0.15s ease;
        }
        .flow-controls button:last-child { border-bottom: none !important; }
        .flow-controls button:hover {
          background: rgba(167,139,250,0.08) !important;
          color: rgba(167,139,250,0.9) !important;
        }
        .flow-controls button svg { fill: currentColor; max-width: 12px; max-height: 12px; }

        /* Custom minimap */
        .flow-minimap { margin: 12px !important; }

        /* Edge */
        .react-flow__edge-path { stroke-linecap: round; }
        .react-flow__edge:hover .react-flow__edge-path { stroke-width: 2.5px; }

        /* Handle hover */
        .react-flow__handle {
          transition: all 0.15s ease;
          cursor: crosshair !important;
        }
        .react-flow__handle:hover {
          transform: scale(1.6);
        }
        .react-flow__handle-connecting { background: #fbbf24 !important; }
        .react-flow__handle-valid { background: #34d399 !important; }

        /* Custom scrollbar */
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.06);
          border-radius: 999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(167,139,250,0.25);
        }

        /* Selection box */
        .react-flow__nodesselection-rect,
        .react-flow__selection {
          background: rgba(167,139,250,0.08) !important;
          border: 1px dashed rgba(167,139,250,0.4) !important;
        }

        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
