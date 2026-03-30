import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { landerNewAPI, uploadFile } from "../services/api";
import { LANDER_NEW_DEFAULTS } from "../landerNew/defaults";
import { SCHEMA_GROUPS, LANDER_EDITOR_SCHEMA } from "../landerNew/schema";
import { deepMerge, getByPath, setByPath } from "../landerNew/utils";
import {
  mergeSpatialPatch,
  resetSpatialBreakpoint,
  copySpatialLgToSmaller,
  mergeStylePatch,
  getEffectiveTransform,
  formatTranslatePercent,
} from "../landerNew/spatialMerge";
import BreakpointSwitcher, { BREAKPOINT_WIDTHS } from "../components/admin/BreakpointSwitcher";
import DragOverlay from "../components/admin/DragOverlay";
import SpatialFields from "../components/admin/SpatialFields";
import StyleOverrideFields from "../components/admin/StyleOverrideFields";

// Schema lookup by dp-target-id (same values as schema IDs)
const SCHEMA_BY_ID = Object.fromEntries(LANDER_EDITOR_SCHEMA.map(s => [s.id, s]));

const AUTOSAVE_MS = 1200;

// ─── helpers ──────────────────────────────────────────────────────────────────
function normPath(path) { return path.replace(/\[(\d+)\]/g, ".$1"); }
function getNestedByPath(obj, path) { return getByPath(obj, normPath(path)); }
function setNestedByPath(obj, path, value) { return setByPath(obj, normPath(path), value); }

function isTypingInField(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const t = target.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return true;
  return target.isContentEditable;
}

// ─── icon components ──────────────────────────────────────────────────────────
function Icon({ d, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const IC = {
  save:    "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
  publish: "M5 12h14 M12 5l7 7-7 7",
  undo:    "M3 7v6h6 M3 13C5 7 10 3 16 3a9 9 0 0 1 0 18H9",
  redo:    "M21 7v6h-6 M21 13c-2-6-7-10-13-10a9 9 0 0 0 0 18h7",
  eye:     "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  back:    "M19 12H5 M12 19l-7-7 7-7",
  upload:  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  check:   "M20 6L9 17l-5-5",
  x:       "M18 6L6 18 M6 6l12 12",
};

// ─── FieldRow ─────────────────────────────────────────────────────────────────
function FieldRow({ field, config, onChange, onUpload }) {
  const value = getNestedByPath(config, field.key) ?? "";

  if (field.type === "checkbox") {
    return (
      <label className="ale-checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={e => onChange(field.key, e.target.checked)}
          className="ale-checkbox"
        />
        <span className="text-[0.7rem] text-gray-300">{field.label}</span>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="block">
        <span className="text-[0.65rem] text-gray-400">{field.label}</span>
        <textarea
          rows={3}
          value={value}
          onChange={e => onChange(field.key, e.target.value)}
          className="ale-input ale-textarea mt-0.5"
        />
      </label>
    );
  }
  if (field.type === "number") {
    return (
      <label className="block">
        <span className="text-[0.65rem] text-gray-400">{field.label}</span>
        <input
          type="number"
          value={value === "" ? "" : Number(value)}
          onChange={e => onChange(field.key, e.target.value === "" ? "" : Number(e.target.value))}
          className="ale-input mt-0.5"
        />
      </label>
    );
  }
  if (field.type === "url") {
    return (
      <label className="block">
        <span className="text-[0.65rem] text-gray-400">{field.label}</span>
        <div className="ale-url-row mt-0.5">
          <input
            type="url"
            value={value}
            placeholder="https://…"
            onChange={e => onChange(field.key, e.target.value)}
            className="ale-input"
          />
          <label className="ale-upload-btn" title="Upload file">
            <Icon d={IC.upload} size={12} />
            <input type="file" style={{ display: "none" }} onChange={e => onUpload(field.key, e.target.files?.[0])} />
          </label>
        </div>
        {value && <img src={value} alt="" className="ale-img-preview" onError={e => { e.currentTarget.style.display = "none"; }} />}
      </label>
    );
  }
  return (
    <label className="block">
      <span className="text-[0.65rem] text-gray-400">{field.label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(field.key, e.target.value)}
        className="ale-input mt-0.5"
      />
    </label>
  );
}

// ─── SchemaSection ────────────────────────────────────────────────────────────
function SchemaSection({ schema, config, onChange, onUpload, isOpen, onToggle }) {
  return (
    <div id={`ale-sec-${schema.id}`} className={`ale-schema-item ${isOpen ? "is-open" : ""}`}>
      <button type="button" className="ale-schema-header" onClick={onToggle}>
        <span className="ale-schema-label">{schema.label}</span>
        <span className="ale-schema-chevron">{isOpen ? "▲" : "▾"}</span>
      </button>
      {isOpen && (
        <div className="ale-schema-body">
          {schema.fields.map(f => (
            <FieldRow key={f.key} field={f} config={config} onChange={onChange} onUpload={onUpload} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inspector Panels ─────────────────────────────────────────────────────────
function Inspector({ targetId, activeBreakpoint, config, onSpatialPatch, onSpatialReset, onSpatialCopyLg, onStylePatch, onStyleClear }) {
  if (!targetId) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        <p>Click any element in the preview</p>
        <p className="mt-1 text-xs text-gray-600">to select and edit it</p>
      </div>
    );
  }
  return (
    <div className="space-y-0 p-4">
      <p className="truncate rounded bg-white/5 px-2 py-1 text-[0.6rem] font-mono text-white/40 mb-3">{targetId}</p>

      <StyleOverrideFields
        targetId={targetId}
        activeBreakpoint={activeBreakpoint}
        styleOverrides={config.styleOverrides ?? {}}
        onPatch={onStylePatch}
        onClear={onStyleClear}
      />

      <SpatialFields
        targetId={targetId}
        activeBreakpoint={activeBreakpoint}
        spatialOverrides={config.spatialOverrides ?? {}}
        onPatch={onSpatialPatch}
        onResetBreakpoint={onSpatialReset}
        onCopyLgDown={onSpatialCopyLg}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminLanderEditorPage() {
  const navigate = useNavigate();

  // ── State ─────────────────────────────────────────────────────────────────
  const [config, setConfig]               = useState(() => ({ ...LANDER_NEW_DEFAULTS, spatialOverrides: {}, styleOverrides: {} }));
  const [activeBreakpoint, setActiveBreakpoint] = useState("base");
  const [activeGroup, setActiveGroup]     = useState(SCHEMA_GROUPS[0]);
  const [activeId, setActiveId]           = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [isDirty, setIsDirty]             = useState(false);
  const [isSaving, setIsSaving]           = useState(false);
  const [isPublishing, setIsPublishing]   = useState(false);
  const [saveFlash, setSaveFlash]         = useState(false);
  const [previewBounds, setPreviewBounds] = useState([]);
  const [previewClient, setPreviewClient] = useState({ w: 0, h: 0 });
  const [cursorIframe, setCursorIframe]   = useState(null);
  const [showInspector, setShowInspector] = useState(true);

  const configRef    = useRef(config);    configRef.current    = config;
  const iframeRef    = useRef(null);
  const historyRef   = useRef([]);
  const futureRef    = useRef([]);
  const autosaveRef  = useRef(null);
  const [epoch, setEpoch] = useState(0); // force re-render for undo/redo button states

  // ── Load draft on mount ───────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bundle = await landerNewAPI.getAdminConfigBundle();
        if (!alive) return;
        setConfig(deepMerge(
          { ...LANDER_NEW_DEFAULTS, spatialOverrides: {}, styleOverrides: {} },
          bundle?.draft || bundle?.published || {},
        ));
      } catch (e) {
        console.error("Failed to load editor bundle:", e);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ── Push config to preview iframe ────────────────────────────────────────
  const pushPreview = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      { type: "dp-preview-payload", config: configRef.current, editMode: true, selectedTargetId },
      window.location.origin,
    );
    requestAnimationFrame(() => {
      win.postMessage({ type: "dp-request-bounds" }, window.location.origin);
    });
  }, [selectedTargetId]);

  const requestBounds = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "dp-request-bounds" }, window.location.origin);
  }, []);

  // Sync selection highlight into frame
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "dp-select-target", targetId: selectedTargetId },
      window.location.origin,
    );
  }, [selectedTargetId]);

  // Re-push whenever config changes
  useEffect(() => {
    const t = window.setTimeout(pushPreview, 80);
    return () => window.clearTimeout(t);
  }, [config, pushPreview]);

  // Re-request bounds when breakpoint switches (iframe width changes)
  useEffect(() => {
    const id = requestAnimationFrame(requestBounds);
    return () => cancelAnimationFrame(id);
  }, [activeBreakpoint, requestBounds]);

  // ── Listen to preview messages ────────────────────────────────────────────
  useEffect(() => {
    function onMsg(e) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (d?.type === "dp-preview-ready") { pushPreview(); return; }
      if (d?.type === "dp-element-selected") {
        const tid = d.targetId;
        setSelectedTargetId(tid);
        // Navigate sidebar to matching schema section
        const entry = SCHEMA_BY_ID[tid];
        if (entry) {
          setActiveGroup(entry.group);
          setActiveId(entry.id);
          requestAnimationFrame(() => {
            document.getElementById(`ale-sec-${entry.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        }
        return;
      }
      if (d?.type === "dp-bounds-response") {
        setPreviewBounds(d.bounds ?? []);
        setPreviewClient({ w: Number(d.clientWidth) || 0, h: Number(d.clientHeight) || 0 });
        return;
      }
      if (d?.type === "dp-preview-pointer") {
        setCursorIframe({ x: Number(d.x) || 0, y: Number(d.y) || 0 });
        return;
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [pushPreview]);

  // ── Mutation (with undo) ──────────────────────────────────────────────────
  const mutate = useCallback((updater) => {
    const prev = configRef.current;
    const next = updater(prev);
    historyRef.current = [...historyRef.current.slice(-59), structuredClone(prev)];
    futureRef.current  = [];
    setEpoch(x => x + 1);
    setConfig(next);
    setIsDirty(true);
  }, []);

  const undoEdit = useCallback(() => {
    const snap = historyRef.current[historyRef.current.length - 1];
    if (!snap) return;
    futureRef.current  = [structuredClone(configRef.current), ...futureRef.current].slice(0, 60);
    historyRef.current = historyRef.current.slice(0, -1);
    setEpoch(x => x + 1);
    setConfig(snap);
    setIsDirty(true);
    setSelectedTargetId(null);
    requestAnimationFrame(requestBounds);
  }, [requestBounds]);

  const redoEdit = useCallback(() => {
    const snap = futureRef.current[0];
    if (!snap) return;
    historyRef.current = [...historyRef.current.slice(-59), structuredClone(configRef.current)];
    futureRef.current  = futureRef.current.slice(1);
    setEpoch(x => x + 1);
    setConfig(snap);
    setIsDirty(true);
    setSelectedTargetId(null);
    requestAnimationFrame(requestBounds);
  }, [requestBounds]);

  // ── Content field updates ─────────────────────────────────────────────────
  const updateField = useCallback((path, value) => {
    mutate(c => setNestedByPath(c, path, value));
  }, [mutate]);

  const uploadAndSetField = useCallback(async (path, file) => {
    if (!file) return;
    try { updateField(path, await uploadFile(file)); }
    catch (e) { console.error("Upload failed:", e); }
  }, [updateField]);

  // ── Spatial patch from DragOverlay or SpatialFields ──────────────────────
  const applySpatialPatch = useCallback((targetId, patch) => {
    mutate(c => ({
      ...c,
      spatialOverrides: mergeSpatialPatch(c.spatialOverrides, targetId, activeBreakpoint, patch),
    }));
  }, [mutate, activeBreakpoint]);

  const applySpatialReset = useCallback(() => {
    if (!selectedTargetId) return;
    mutate(c => ({
      ...c,
      spatialOverrides: resetSpatialBreakpoint(c.spatialOverrides, selectedTargetId, activeBreakpoint),
    }));
  }, [mutate, selectedTargetId, activeBreakpoint]);

  const applySpatialCopyLg = useCallback(() => {
    if (!selectedTargetId) return;
    mutate(c => ({
      ...c,
      spatialOverrides: copySpatialLgToSmaller(c.spatialOverrides, selectedTargetId),
    }));
  }, [mutate, selectedTargetId]);

  // ── Style override ────────────────────────────────────────────────────────
  const applyStylePatch = useCallback((patch) => {
    if (!selectedTargetId) return;
    mutate(c => ({
      ...c,
      styleOverrides: mergeStylePatch(c.styleOverrides, selectedTargetId, activeBreakpoint, patch),
    }));
  }, [mutate, selectedTargetId, activeBreakpoint]);

  const clearStyleOverride = useCallback(() => {
    if (!selectedTargetId) return;
    mutate(c => {
      const so = { ...(c.styleOverrides ?? {}) };
      delete so[selectedTargetId];
      return { ...c, styleOverrides: so };
    });
  }, [mutate, selectedTargetId]);

  // ── Arrow-key nudge ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") { setSelectedTargetId(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (isTypingInField(e.target)) return;
        e.preventDefault();
        e.shiftKey ? redoEdit() : undoEdit();
        return;
      }
      if (isTypingInField(e.target)) return;
      if (!selectedTargetId) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const step  = e.shiftKey ? 2 : 0.5;
      const entry = previewBounds.find(b => b.targetId === selectedTargetId);
      const w     = Math.max(entry?.rect.width  ?? 200, 1);
      const h     = Math.max(entry?.rect.height ?? 100, 1);
      const t     = configRef.current.spatialOverrides?.[selectedTargetId]?.[activeBreakpoint];
      const eff   = getEffectiveTransform(t, w, h);
      let dTx = 0, dTy = 0;
      if (e.key === "ArrowLeft")  dTx = -step;
      if (e.key === "ArrowRight") dTx =  step;
      if (e.key === "ArrowUp")    dTy = -step;
      if (e.key === "ArrowDown")  dTy =  step;
      mutate(c => ({
        ...c,
        spatialOverrides: mergeSpatialPatch(c.spatialOverrides, selectedTargetId, activeBreakpoint, {
          translateX: formatTranslatePercent(eff.txPct + dTx),
          translateY: formatTranslatePercent(eff.tyPct + dTy),
        }),
      }));
      requestAnimationFrame(requestBounds);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTargetId, activeBreakpoint, mutate, requestBounds, previewBounds, undoEdit, redoEdit]);

  // ── Save / Publish ────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (silent = false) => {
    if (!silent) setIsSaving(true);
    try {
      const res = await landerNewAPI.saveDraft(configRef.current);
      setConfig(deepMerge({ ...LANDER_NEW_DEFAULTS, spatialOverrides: {}, styleOverrides: {} }, res?.draft || configRef.current));
      setIsDirty(false);
      if (!silent) { setSaveFlash(true); setTimeout(() => setSaveFlash(false), 1800); }
    } finally {
      if (!silent) setIsSaving(false);
    }
  }, []);

  const publish = async () => {
    setIsPublishing(true);
    try {
      await saveDraft(true);
      await landerNewAPI.publish();
      setIsDirty(false);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2000);
    } finally {
      setIsPublishing(false);
    }
  };

  // ── Autosave ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDirty) return undefined;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => saveDraft(true).catch(console.error), AUTOSAVE_MS);
    return () => clearTimeout(autosaveRef.current);
  }, [config, isDirty, saveDraft]);

  // ── Sidebar: filtered schema ──────────────────────────────────────────────
  const groupedSchema = useMemo(() =>
    LANDER_EDITOR_SCHEMA.filter(s => s.group === activeGroup),
  [activeGroup]);

  const previewWidth = BREAKPOINT_WIDTHS[activeBreakpoint]?.width ?? 1024;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-[#07070c] text-white">

      {/* ══ Top Bar ══════════════════════════════════════════════════════════ */}
      <header className="flex flex-wrap items-center gap-2 border-b border-white/8 bg-[#07070c] px-4 py-2 z-20">
        <button className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-400 hover:text-white" onClick={() => navigate("/admin")}>
          <Icon d={IC.back} /> Admin
        </button>

        <span className="text-xs font-semibold text-white/70 ml-1">Lander Editor</span>

        {isDirty && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.65rem] text-amber-300">Unsaved</span>}
        {saveFlash && !isDirty && <span className="flex items-center gap-1 text-[0.65rem] text-green-400"><Icon d={IC.check} size={11} /> Saved</span>}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={undoEdit}
            disabled={historyRef.current.length === 0}
            title="Undo (Ctrl+Z)"
            className="rounded p-1.5 text-gray-400 hover:text-white disabled:opacity-30"
          >
            <Icon d={IC.undo} />
          </button>
          <button
            onClick={redoEdit}
            disabled={futureRef.current.length === 0}
            title="Redo (Ctrl+Shift+Z)"
            className="rounded p-1.5 text-gray-400 hover:text-white disabled:opacity-30"
          >
            <Icon d={IC.redo} />
          </button>

          <div className="mx-2 hidden md:block">
            <BreakpointSwitcher active={activeBreakpoint} onChange={setActiveBreakpoint} />
          </div>

          <button
            onClick={() => setShowInspector(v => !v)}
            title="Toggle inspector"
            className="rounded p-1.5 text-gray-400 hover:text-white"
          >
            <Icon d={IC.eye} />
          </button>

          <button
            onClick={() => saveDraft()}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
          >
            <Icon d={IC.save} size={12} />
            {isSaving ? "Saving…" : "Save Draft"}
          </button>
          <button
            onClick={publish}
            disabled={isPublishing}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            <Icon d={IC.publish} size={12} />
            {isPublishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      {/* Mobile breakpoint switcher */}
      <div className="flex border-b border-white/8 px-4 py-2 md:hidden">
        <BreakpointSwitcher active={activeBreakpoint} onChange={setActiveBreakpoint} />
      </div>

      {/* ══ Body ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        {showInspector && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-white/8 bg-[#0d0d18] overflow-hidden">

            {/* Group tabs */}
            <div className="ale-group-tabs flex-shrink-0">
              {SCHEMA_GROUPS.map(g => (
                <button
                  key={g}
                  type="button"
                  className={`ale-group-tab ${activeGroup === g ? "is-active" : ""}`}
                  onClick={() => { setActiveGroup(g); setActiveId(null); setSelectedTargetId(null); }}
                >
                  {g}
                </button>
              ))}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* Schema sections (content fields) */}
              <div className="ale-section-list">
                {groupedSchema.map(schema => (
                  <SchemaSection
                    key={schema.id}
                    schema={schema}
                    config={config}
                    onChange={updateField}
                    onUpload={uploadAndSetField}
                    isOpen={activeId === schema.id}
                    onToggle={() => setActiveId(prev => prev === schema.id ? null : schema.id)}
                  />
                ))}
              </div>

              {/* Divider + Inspector (style/spatial) */}
              {selectedTargetId && (
                <>
                  <div className="mx-4 my-2 border-t border-white/8" />
                  <Inspector
                    targetId={selectedTargetId}
                    activeBreakpoint={activeBreakpoint}
                    config={config}
                    onSpatialPatch={(patch) => applySpatialPatch(selectedTargetId, patch)}
                    onSpatialReset={applySpatialReset}
                    onSpatialCopyLg={applySpatialCopyLg}
                    onStylePatch={applyStylePatch}
                    onStyleClear={clearStyleOverride}
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedTargetId(null)}
                    className="flex w-full items-center gap-1.5 px-4 py-3 text-[0.65rem] text-gray-500 hover:text-white transition-colors"
                  >
                    <Icon d={IC.x} size={10} /> Deselect
                  </button>
                </>
              )}
              {!selectedTargetId && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-gray-500">Click any element in the preview to select and edit it.</p>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* ── Preview pane ─────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col items-center overflow-auto bg-black/20 p-4">
          {/* Preview label */}
          <div className="mb-3 flex w-full max-w-[1400px] items-center justify-between text-[0.65rem] text-gray-500">
            <span>{BREAKPOINT_WIDTHS[activeBreakpoint].label} — {BREAKPOINT_WIDTHS[activeBreakpoint].width}px</span>
            <a href="/lander-new" target="_blank" rel="noopener" className="text-blue-400 hover:underline">
              open in new tab ↗
            </a>
          </div>

          {/* iframe container — DragOverlay is positioned absolute on top */}
          <div
            className="relative shadow-2xl"
            style={{ width: `${previewWidth}px`, maxWidth: "100%", minHeight: 400 }}
          >
            <iframe
              ref={iframeRef}
              title="Lander preview"
              src="/admin/lander-preview-frame"
              className="block w-full bg-[#07070c]"
              style={{ height: "calc(100vh - 10rem)", border: "none" }}
              onLoad={pushPreview}
            />

            {/* Drag overlay — sits exactly on top of the iframe */}
            {selectedTargetId && previewClient.w > 0 && (
              <DragOverlay
                bounds={previewBounds}
                clientWidth={previewClient.w}
                clientHeight={previewClient.h}
                selectedTargetId={selectedTargetId}
                activeBreakpoint={activeBreakpoint}
                spatialOverrides={config.spatialOverrides ?? {}}
                onSpatialPatch={applySpatialPatch}
                onRequestBounds={requestBounds}
                cursorIframe={cursorIframe}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile bottom sheet inspector ─────────────────────────────────── */}
      {selectedTargetId && (
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[55vh] overflow-y-auto border-t border-white/15 bg-[#0a0a12] lg:hidden">
          <div className="flex justify-center pt-2">
            <div className="h-1 w-10 rounded-full bg-white/25" />
          </div>
          <Inspector
            targetId={selectedTargetId}
            activeBreakpoint={activeBreakpoint}
            config={config}
            onSpatialPatch={(patch) => applySpatialPatch(selectedTargetId, patch)}
            onSpatialReset={applySpatialReset}
            onSpatialCopyLg={applySpatialCopyLg}
            onStylePatch={applyStylePatch}
            onStyleClear={clearStyleOverride}
          />
        </div>
      )}
    </div>
  );
}
