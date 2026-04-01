import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { affiliateLanderAdminAPI, uploadFile } from "../services/api";
import { AFFILIATE_LANDER_DEFAULTS, AFFILIATE_BLOCK_TYPES, emptyBlock } from "../affiliateLander/defaults";
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

const AUTOSAVE_MS = 1200;
const SCHEMA_GROUPS = ["Blocks", "Brand", "SEO"];

function normPath(path) {
  return path.replace(/\[(\d+)\]/g, ".$1");
}
function getNestedByPath(obj, path) {
  return getByPath(obj, normPath(path));
}
function setNestedByPath(obj, path, value) {
  return setByPath(obj, normPath(path), value);
}

function isTypingInField(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const t = target.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return true;
  return target.isContentEditable;
}

function Icon({ d, size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
const IC = {
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
  publish: "M5 12h14 M12 5l7 7-7 7",
  undo: "M3 7v6h6 M3 13C5 7 10 3 16 3a9 9 0 0 1 0 18H9",
  redo: "M21 7v6h-6 M21 13c-2-6-7-10-13-10a9 9 0 0 0 0 18h7",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  back: "M19 12H5 M12 19l-7-7 7-7",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18 M6 6l12 12",
};

const SEO_FIELDS = [
  { key: "seo.title", type: "text", label: "Page title" },
  { key: "seo.description", type: "textarea", label: "Meta description" },
  { key: "seo.canonicalUrl", type: "url", label: "Canonical URL" },
  { key: "seo.robots", type: "text", label: "Robots" },
  { key: "seo.ogTitle", type: "text", label: "OG title" },
  { key: "seo.ogDescription", type: "textarea", label: "OG description" },
  { key: "seo.ogImageUrl", type: "url", label: "OG image" },
  { key: "seo.twitterTitle", type: "text", label: "Twitter title" },
  { key: "seo.twitterDescription", type: "textarea", label: "Twitter description" },
  { key: "seo.twitterImageUrl", type: "url", label: "Twitter image" },
];

const BRAND_FIELDS = [
  { key: "styles.buttonPrimaryBackground", type: "text", label: "Primary button background (CSS)" },
  { key: "styles.buttonPrimaryText", type: "text", label: "Primary button text" },
  { key: "styles.buttonPrimaryBorder", type: "text", label: "Primary button border" },
  { key: "styles.buttonGhostText", type: "text", label: "Ghost text" },
  { key: "styles.buttonGhostBorder", type: "text", label: "Ghost border" },
  { key: "styles.buttonGhostBackground", type: "text", label: "Ghost background" },
];

function FieldRow({ field, config, onChange, onUpload }) {
  const value = getNestedByPath(config, field.key) ?? "";

  if (field.type === "textarea") {
    return (
      <label className="block">
        <span className="text-[0.65rem] text-gray-400">{field.label}</span>
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="ale-input ale-textarea mt-0.5"
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
            onChange={(e) => onChange(field.key, e.target.value)}
            className="ale-input"
          />
          <label className="ale-upload-btn" title="Upload file">
            <Icon d={IC.upload} size={12} />
            <input type="file" style={{ display: "none" }} onChange={(e) => onUpload(field.key, e.target.files?.[0])} />
          </label>
        </div>
        {value && (
          <img src={value} alt="" className="ale-img-preview" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        )}
      </label>
    );
  }
  return (
    <label className="block">
      <span className="text-[0.65rem] text-gray-400">{field.label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="ale-input mt-0.5"
      />
    </label>
  );
}

function Inspector({ targetId, activeBreakpoint, config, onSpatialPatch, onSpatialReset, onSpatialCopyLg, onStylePatch, onStyleClear }) {
  if (!targetId) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        <p>Click any element in the preview</p>
        <p className="mt-1 text-xs text-gray-600">to select and edit layout &amp; type styles</p>
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

function blockLabel(b) {
  if (!b) return "";
  if (b.type === "heading") return `Heading — ${(b.text || "").slice(0, 28) || "…"}`;
  if (b.type === "subheading") return `Subheading — ${(b.text || "").slice(0, 28) || "…"}`;
  if (b.type === "video") return b.videoUrl ? "Video" : "Video (placeholder)";
  if (b.type === "button") return `Button — ${b.label || "…"}`;
  return b.type;
}

export default function AdminAffiliateLanderEditorPage() {
  const { suffix: suffixParam } = useParams();
  const suffix = decodeURIComponent(suffixParam || "").trim();
  const navigate = useNavigate();

  const [config, setConfig] = useState(() => ({
    ...AFFILIATE_LANDER_DEFAULTS,
    spatialOverrides: {},
    styleOverrides: {},
    blocks: [],
  }));
  const [activeBreakpoint, setActiveBreakpoint] = useState("base");
  const [activeGroup, setActiveGroup] = useState("Blocks");
  const [openBlockId, setOpenBlockId] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [previewBounds, setPreviewBounds] = useState([]);
  const [previewClient, setPreviewClient] = useState({ w: 0, h: 0 });
  const [cursorIframe, setCursorIframe] = useState(null);
  const [showInspector, setShowInspector] = useState(true);
  const [addType, setAddType] = useState("heading");

  const configRef = useRef(config);
  configRef.current = config;
  const iframeRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const autosaveRef = useRef(null);
  const [epoch, setEpoch] = useState(0);

  const isBlockId = useCallback(
    (id) => Boolean(id && configRef.current.blocks?.some((b) => b.id === id)),
    [],
  );

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    (async () => {
      if (!suffix) {
        setLoadError("Missing lander path");
        return;
      }
      try {
        const bundle = await affiliateLanderAdminAPI.getConfigBundle(suffix);
        if (!alive) return;
        setConfig(
          deepMerge(
            { ...AFFILIATE_LANDER_DEFAULTS, spatialOverrides: {}, styleOverrides: {}, blocks: [] },
            bundle?.draft || bundle?.published || {},
          ),
        );
      } catch (e) {
        if (!alive) return;
        setLoadError(e?.response?.data?.message || e?.message || "Failed to load");
      }
    })();
    return () => {
      alive = false;
    };
  }, [suffix]);

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

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "dp-select-target", targetId: selectedTargetId },
      window.location.origin,
    );
  }, [selectedTargetId]);

  useEffect(() => {
    const t = window.setTimeout(pushPreview, 80);
    return () => window.clearTimeout(t);
  }, [config, pushPreview]);

  useEffect(() => {
    const id = requestAnimationFrame(requestBounds);
    return () => cancelAnimationFrame(id);
  }, [activeBreakpoint, requestBounds]);

  useEffect(() => {
    function onMsg(e) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (d?.type === "dp-preview-ready") {
        pushPreview();
        return;
      }
      if (d?.type === "dp-element-selected") {
        const tid = d.targetId;
        setSelectedTargetId(tid);
        if (isBlockId(tid)) {
          setActiveGroup("Blocks");
          setOpenBlockId(tid);
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
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [pushPreview, isBlockId]);

  const mutate = useCallback((updater) => {
    const prev = configRef.current;
    const next = updater(prev);
    historyRef.current = [...historyRef.current.slice(-59), structuredClone(prev)];
    futureRef.current = [];
    setEpoch((x) => x + 1);
    setConfig(next);
    setIsDirty(true);
  }, []);

  const undoEdit = useCallback(() => {
    const snap = historyRef.current[historyRef.current.length - 1];
    if (!snap) return;
    futureRef.current = [structuredClone(configRef.current), ...futureRef.current].slice(0, 60);
    historyRef.current = historyRef.current.slice(0, -1);
    setEpoch((x) => x + 1);
    setConfig(snap);
    setIsDirty(true);
    setSelectedTargetId(null);
    requestAnimationFrame(requestBounds);
  }, [requestBounds]);

  const redoEdit = useCallback(() => {
    const snap = futureRef.current[0];
    if (!snap) return;
    historyRef.current = [...historyRef.current.slice(-59), structuredClone(configRef.current)];
    futureRef.current = futureRef.current.slice(1);
    setEpoch((x) => x + 1);
    setConfig(snap);
    setIsDirty(true);
    setSelectedTargetId(null);
    requestAnimationFrame(requestBounds);
  }, [requestBounds]);

  const updateField = useCallback(
    (path, value) => {
      mutate((c) => setNestedByPath(c, path, value));
    },
    [mutate],
  );

  const uploadAndSetField = useCallback(
    async (path, file) => {
      if (!file) return;
      try {
        updateField(path, await uploadFile(file));
      } catch (e) {
        console.error("Upload failed:", e);
      }
    },
    [updateField],
  );

  const updateBlock = useCallback(
    (blockId, patch) => {
      mutate((c) => ({
        ...c,
        blocks: (c.blocks || []).map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
      }));
    },
    [mutate],
  );

  const addBlock = useCallback(() => {
    const nb = emptyBlock(addType);
    mutate((c) => ({
      ...c,
      blocks: [...(c.blocks || []), nb],
    }));
    setOpenBlockId(nb.id);
    setSelectedTargetId(nb.id);
  }, [mutate, addType]);

  const removeBlock = useCallback(
    (blockId) => {
      mutate((c) => {
        const blocks = (c.blocks || []).filter((b) => b.id !== blockId);
        const so = { ...(c.spatialOverrides ?? {}) };
        delete so[blockId];
        const st = { ...(c.styleOverrides ?? {}) };
        delete st[blockId];
        return { ...c, blocks, spatialOverrides: so, styleOverrides: st };
      });
      if (selectedTargetId === blockId) setSelectedTargetId(null);
      if (openBlockId === blockId) setOpenBlockId(null);
    },
    [mutate, selectedTargetId, openBlockId],
  );

  const moveBlock = useCallback(
    (blockId, dir) => {
      mutate((c) => {
        const blocks = [...(c.blocks || [])];
        const i = blocks.findIndex((b) => b.id === blockId);
        if (i < 0) return c;
        const j = i + dir;
        if (j < 0 || j >= blocks.length) return c;
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        return { ...c, blocks };
      });
    },
    [mutate],
  );

  const applySpatialPatch = useCallback(
    (targetId, patch) => {
      mutate((c) => ({
        ...c,
        spatialOverrides: mergeSpatialPatch(c.spatialOverrides, targetId, activeBreakpoint, patch),
      }));
    },
    [mutate, activeBreakpoint],
  );

  const applySpatialReset = useCallback(() => {
    if (!selectedTargetId) return;
    mutate((c) => ({
      ...c,
      spatialOverrides: resetSpatialBreakpoint(c.spatialOverrides, selectedTargetId, activeBreakpoint),
    }));
  }, [mutate, selectedTargetId, activeBreakpoint]);

  const applySpatialCopyLg = useCallback(() => {
    if (!selectedTargetId) return;
    mutate((c) => ({
      ...c,
      spatialOverrides: copySpatialLgToSmaller(c.spatialOverrides, selectedTargetId),
    }));
  }, [mutate, selectedTargetId]);

  const applyStylePatch = useCallback(
    (patch) => {
      if (!selectedTargetId) return;
      mutate((c) => ({
        ...c,
        styleOverrides: mergeStylePatch(c.styleOverrides, selectedTargetId, activeBreakpoint, patch),
      }));
    },
    [mutate, selectedTargetId, activeBreakpoint],
  );

  const clearStyleOverride = useCallback(() => {
    if (!selectedTargetId) return;
    mutate((c) => {
      const so = { ...(c.styleOverrides ?? {}) };
      delete so[selectedTargetId];
      return { ...c, styleOverrides: so };
    });
  }, [mutate, selectedTargetId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        setSelectedTargetId(null);
        return;
      }
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
      const step = e.shiftKey ? 2 : 0.5;
      const entry = previewBounds.find((b) => b.targetId === selectedTargetId);
      const w = Math.max(entry?.rect.width ?? 200, 1);
      const h = Math.max(entry?.rect.height ?? 100, 1);
      const t = configRef.current.spatialOverrides?.[selectedTargetId]?.[activeBreakpoint];
      const eff = getEffectiveTransform(t, w, h);
      let dTx = 0;
      let dTy = 0;
      if (e.key === "ArrowLeft") dTx = -step;
      if (e.key === "ArrowRight") dTx = step;
      if (e.key === "ArrowUp") dTy = -step;
      if (e.key === "ArrowDown") dTy = step;
      mutate((c) => ({
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

  const saveDraft = useCallback(
    async (silent = false) => {
      if (!suffix) return;
      if (!silent) setIsSaving(true);
      try {
        const res = await affiliateLanderAdminAPI.saveDraft(suffix, configRef.current);
        setConfig(
          deepMerge(
            { ...AFFILIATE_LANDER_DEFAULTS, spatialOverrides: {}, styleOverrides: {}, blocks: [] },
            res?.draft || configRef.current,
          ),
        );
        setIsDirty(false);
        if (!silent) {
          setSaveFlash(true);
          setTimeout(() => setSaveFlash(false), 1800);
        }
      } finally {
        if (!silent) setIsSaving(false);
      }
    },
    [suffix],
  );

  const publish = async () => {
    if (!suffix) return;
    setIsPublishing(true);
    try {
      await saveDraft(true);
      await affiliateLanderAdminAPI.publish(suffix);
      setIsDirty(false);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2000);
    } finally {
      setIsPublishing(false);
    }
  };

  useEffect(() => {
    if (!isDirty) return undefined;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => saveDraft(true).catch(console.error), AUTOSAVE_MS);
    return () => clearTimeout(autosaveRef.current);
  }, [config, isDirty, saveDraft]);

  const previewWidth = BREAKPOINT_WIDTHS[activeBreakpoint]?.width ?? 1024;
  const publicUrl = `/aff/${encodeURIComponent(suffix)}`;

  const blocksPanel = useMemo(() => {
    const blocks = config.blocks || [];
    return (
      <div className="ale-section-list px-2 py-2 space-y-2">
        <div className="flex flex-wrap items-end gap-2 px-2 pb-2 border-b border-white/8">
          <label className="text-[0.65rem] text-gray-500">
            Add block
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              className="ale-input mt-0.5 text-xs block"
            >
              {AFFILIATE_BLOCK_TYPES.map((o) => (
                <option key={o.type} value={o.type}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addBlock}
            className="rounded-lg bg-violet-600/80 px-2.5 py-1.5 text-[0.7rem] font-medium text-white hover:bg-violet-500"
          >
            Add
          </button>
        </div>
        {blocks.map((b, idx) => (
          <div
            key={b.id}
            id={`aff-block-${b.id}`}
            className={`rounded-lg border ${openBlockId === b.id ? "border-violet-500/50 bg-white/[0.04]" : "border-white/8 bg-white/[0.02]"}`}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left"
              onClick={() => {
                setOpenBlockId((prev) => (prev === b.id ? null : b.id));
                setSelectedTargetId(b.id);
              }}
            >
              <span className="text-[0.72rem] text-gray-200 truncate">{blockLabel(b)}</span>
              <span className="text-[0.6rem] text-gray-500 shrink-0">{openBlockId === b.id ? "▲" : "▾"}</span>
            </button>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              <button
                type="button"
                className="text-[0.6rem] text-gray-500 hover:text-white px-1.5 py-0.5 rounded border border-white/10"
                onClick={() => moveBlock(b.id, -1)}
                disabled={idx === 0}
              >
                Up
              </button>
              <button
                type="button"
                className="text-[0.6rem] text-gray-500 hover:text-white px-1.5 py-0.5 rounded border border-white/10"
                onClick={() => moveBlock(b.id, 1)}
                disabled={idx === blocks.length - 1}
              >
                Down
              </button>
              <button
                type="button"
                className="text-[0.6rem] text-red-400/90 hover:text-red-300 px-1.5 py-0.5 rounded border border-red-500/20 ml-auto"
                onClick={() => removeBlock(b.id)}
              >
                Delete
              </button>
            </div>
            {openBlockId === b.id && (
              <div className="px-3 pb-3 space-y-2 border-t border-white/6 pt-2">
                {b.type === "heading" && (
                  <label className="block">
                    <span className="text-[0.65rem] text-gray-400">Heading text</span>
                    <input
                      className="ale-input mt-0.5"
                      value={b.text || ""}
                      onChange={(e) => updateBlock(b.id, { text: e.target.value })}
                    />
                  </label>
                )}
                {b.type === "subheading" && (
                  <label className="block">
                    <span className="text-[0.65rem] text-gray-400">Subheading</span>
                    <textarea
                      rows={3}
                      className="ale-input ale-textarea mt-0.5"
                      value={b.text || ""}
                      onChange={(e) => updateBlock(b.id, { text: e.target.value })}
                    />
                  </label>
                )}
                {b.type === "video" && (
                  <>
                    <label className="block">
                      <span className="text-[0.65rem] text-gray-400">Video URL</span>
                      <div className="ale-url-row mt-0.5">
                        <input
                          className="ale-input"
                          value={b.videoUrl || ""}
                          onChange={(e) => updateBlock(b.id, { videoUrl: e.target.value })}
                          placeholder="https://…mp4"
                        />
                        <label className="ale-upload-btn" title="Upload">
                          <Icon d={IC.upload} size={12} />
                          <input
                            type="file"
                            accept="video/*"
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                updateBlock(b.id, { videoUrl: await uploadFile(f) });
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </label>
                    <label className="block">
                      <span className="text-[0.65rem] text-gray-400">Poster (optional)</span>
                      <div className="ale-url-row mt-0.5">
                        <input
                          className="ale-input"
                          value={b.posterUrl || ""}
                          onChange={(e) => updateBlock(b.id, { posterUrl: e.target.value })}
                        />
                        <label className="ale-upload-btn" title="Upload">
                          <Icon d={IC.upload} size={12} />
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                updateBlock(b.id, { posterUrl: await uploadFile(f) });
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                          />
                        </label>
                      </div>
                    </label>
                  </>
                )}
                {b.type === "button" && (
                  <>
                    <label className="block">
                      <span className="text-[0.65rem] text-gray-400">Label</span>
                      <input
                        className="ale-input mt-0.5"
                        value={b.label || ""}
                        onChange={(e) => updateBlock(b.id, { label: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[0.65rem] text-gray-400">Link URL</span>
                      <input
                        className="ale-input mt-0.5"
                        value={b.href || ""}
                        onChange={(e) => updateBlock(b.id, { href: e.target.value })}
                        placeholder="/signup or https://…"
                      />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }, [config.blocks, openBlockId, addType, addBlock, moveBlock, removeBlock, updateBlock]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#07070c] text-white flex flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-red-300">{loadError}</p>
        <button type="button" className="text-xs text-violet-400 underline" onClick={() => navigate("/admin")}>
          Back to admin
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#07070c] text-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/8 bg-[#07070c] px-4 py-2 z-20" data-editor-rev={epoch}>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-400 hover:text-white"
          onClick={() => navigate("/admin")}
        >
          <Icon d={IC.back} /> Admin
        </button>
        <span className="text-xs font-semibold text-white/70 ml-1">Affiliate lander</span>
        <code className="text-[0.65rem] text-violet-300/90 rounded bg-white/5 px-1.5 py-0.5">/aff/{suffix}</code>
        {isDirty && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.65rem] text-amber-300">Unsaved</span>
        )}
        {saveFlash && !isDirty && (
          <span className="flex items-center gap-1 text-[0.65rem] text-green-400">
            <Icon d={IC.check} size={11} /> Saved
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={undoEdit}
            disabled={historyRef.current.length === 0}
            title="Undo (Ctrl+Z)"
            className="rounded p-1.5 text-gray-400 hover:text-white disabled:opacity-30"
          >
            <Icon d={IC.undo} />
          </button>
          <button
            type="button"
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
            type="button"
            onClick={() => setShowInspector((v) => !v)}
            title="Toggle inspector"
            className="rounded p-1.5 text-gray-400 hover:text-white"
          >
            <Icon d={IC.eye} />
          </button>
          <button
            type="button"
            onClick={() => saveDraft()}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
          >
            <Icon d={IC.save} size={12} />
            {isSaving ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={isPublishing}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            <Icon d={IC.publish} size={12} />
            {isPublishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      <div className="flex border-b border-white/8 px-4 py-2 md:hidden">
        <BreakpointSwitcher active={activeBreakpoint} onChange={setActiveBreakpoint} />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showInspector && (
          <aside className="flex w-80 shrink-0 flex-col border-r border-white/8 bg-[#0d0d18] overflow-hidden">
            <div className="ale-group-tabs flex-shrink-0">
              {SCHEMA_GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`ale-group-tab ${activeGroup === g ? "is-active" : ""}`}
                  onClick={() => {
                    setActiveGroup(g);
                    if (g !== "Blocks") setOpenBlockId(null);
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {activeGroup === "Blocks" && blocksPanel}
              {activeGroup === "Brand" && (
                <div className="ale-section-list p-3 space-y-3">
                  {BRAND_FIELDS.map((f) => (
                    <FieldRow key={f.key} field={f} config={config} onChange={updateField} onUpload={uploadAndSetField} />
                  ))}
                </div>
              )}
              {activeGroup === "SEO" && (
                <div className="ale-section-list p-3 space-y-3">
                  {SEO_FIELDS.map((f) => (
                    <FieldRow key={f.key} field={f} config={config} onChange={updateField} onUpload={uploadAndSetField} />
                  ))}
                </div>
              )}
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
            </div>
          </aside>
        )}

        <div className="flex flex-1 flex-col items-center overflow-auto bg-black/20 p-4">
          <div className="mb-3 flex w-full max-w-[1400px] items-center justify-between text-[0.65rem] text-gray-500">
            <span>
              {BREAKPOINT_WIDTHS[activeBreakpoint].label} — {BREAKPOINT_WIDTHS[activeBreakpoint].width}px
            </span>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              Open published ↗
            </a>
          </div>
          <div className="relative shadow-2xl" style={{ width: `${previewWidth}px`, maxWidth: "100%", minHeight: 400 }}>
            <iframe
              ref={iframeRef}
              title="Affiliate lander preview"
              src="/admin/affiliate-lander-preview-frame"
              className="block w-full bg-[#07070c]"
              style={{ height: "calc(100vh - 10rem)", border: "none" }}
              onLoad={pushPreview}
            />
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
