import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { landerNewAPI, uploadFile } from "../services/api";
import { LANDER_NEW_DEFAULTS } from "../landerNew/defaults";
import { SCHEMA_GROUPS, LANDER_EDITOR_SCHEMA } from "../landerNew/schema";
import { deepMerge, getByPath, setByPath } from "../landerNew/utils";
import LanderNewPublicApp from "../components/landerNew/LanderNewPublicApp";

const AUTOSAVE_MS = 1200;

// ─── utility ──────────────────────────────────────────────────────────────────
function setNestedByPath(obj, path, value) {
  // supports bracket notation: foo[0].bar
  const normalised = path.replace(/\[(\d+)\]/g, ".$1");
  return setByPath(obj, normalised, value);
}
function getNestedByPath(obj, path) {
  const normalised = path.replace(/\[(\d+)\]/g, ".$1");
  return getByPath(obj, normalised);
}

// ─── mini icon components (no external dep) ───────────────────────────────────
const Icon = ({ d, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  save:    "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
  publish: "M5 12h14 M12 5l7 7-7 7",
  undo:    "M3 7v6h6 M3 13C5 7 10 3 16 3a9 9 0 0 1 0 18H9",
  redo:    "M21 7v6h-6 M21 13c-2-6-7-10-13-10a9 9 0 0 0 0 18h7",
  preview: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  back:    "M19 12H5 M12 19l-7-7 7-7",
  upload:  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  check:   "M20 6L9 17l-5-5",
};

// ─── sub-components ───────────────────────────────────────────────────────────
function FieldRow({ field, config, onChange, onUpload }) {
  const value = getNestedByPath(config, field.key) ?? "";

  if (field.type === "textarea") {
    return (
      <label className="ale-field">
        <span className="ale-field-label">{field.label}</span>
        <textarea
          className="ale-input ale-textarea"
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label className="ale-field">
        <span className="ale-field-label">{field.label}</span>
        <input
          className="ale-input"
          type="number"
          value={value === "" ? "" : Number(value)}
          onChange={(e) => onChange(field.key, e.target.value === "" ? "" : Number(e.target.value))}
        />
      </label>
    );
  }

  if (field.type === "url") {
    return (
      <label className="ale-field">
        <span className="ale-field-label">{field.label}</span>
        <div className="ale-url-row">
          <input
            className="ale-input"
            type="url"
            value={value}
            placeholder="https://..."
            onChange={(e) => onChange(field.key, e.target.value)}
          />
          <label className="ale-upload-btn" title="Upload file">
            <Icon d={ICONS.upload} size={12} />
            <input
              type="file"
              style={{ display: "none" }}
              onChange={(e) => onUpload(field.key, e.target.files?.[0])}
            />
          </label>
        </div>
        {value && (
          <img
            src={value}
            alt=""
            className="ale-img-preview"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
      </label>
    );
  }

  return (
    <label className="ale-field">
      <span className="ale-field-label">{field.label}</span>
      <input
        className="ale-input"
        type="text"
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    </label>
  );
}

function SchemaSection({ schema, config, onChange, onUpload, activeId, onActivate }) {
  const isOpen = activeId === schema.id;
  return (
    <div className={`ale-schema-item ${isOpen ? "is-open" : ""}`}>
      <button
        type="button"
        className="ale-schema-header"
        onClick={() => onActivate(isOpen ? null : schema.id)}
      >
        <span className="ale-schema-label">{schema.label}</span>
        <span className="ale-schema-chevron">{isOpen ? "▲" : "▾"}</span>
      </button>
      {isOpen && (
        <div className="ale-schema-body">
          {schema.fields.map((f) => (
            <FieldRow
              key={f.key}
              field={f}
              config={config}
              onChange={onChange}
              onUpload={onUpload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────
export default function AdminLanderEditorPage() {
  const navigate = useNavigate();
  const [config, setConfig]           = useState(LANDER_NEW_DEFAULTS);
  const [activeGroup, setActiveGroup] = useState(SCHEMA_GROUPS[0]);
  const [activeId, setActiveId]       = useState(null);
  const [isDirty, setIsDirty]         = useState(false);
  const [isSaving, setIsSaving]       = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [saveFlash, setSaveFlash]     = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [history, setHistory]         = useState([]);
  const [future, setFuture]           = useState([]);
  const autosaveRef = useRef(null);

  // load draft on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bundle = await landerNewAPI.getAdminConfigBundle();
        if (!alive) return;
        setConfig(deepMerge(LANDER_NEW_DEFAULTS, bundle?.draft || bundle?.published || {}));
      } catch (e) {
        console.error("Failed to load editor bundle:", e);
      }
    })();
    return () => { alive = false; };
  }, []);

  const commit = useCallback((next) => {
    setHistory((h) => [...h.slice(-49), config]);
    setFuture([]);
    setConfig(next);
    setIsDirty(true);
  }, [config]);

  const updateField = useCallback((path, value) => {
    commit(setNestedByPath(config, path, value));
  }, [config, commit]);

  const uploadAndSetField = useCallback(async (path, file) => {
    if (!file) return;
    try {
      const url = await uploadFile(file);
      updateField(path, url);
    } catch (e) {
      console.error("Upload failed:", e);
    }
  }, [updateField]);

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setFuture((f) => [config, ...f]);
    setHistory((h) => h.slice(0, -1));
    setConfig(prev);
    setIsDirty(true);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((h) => [...h, config]);
    setFuture((f) => f.slice(1));
    setConfig(next);
    setIsDirty(true);
  };

  const saveDraft = useCallback(async (silent = false) => {
    if (!silent) setIsSaving(true);
    try {
      const res = await landerNewAPI.saveDraft(config);
      setConfig(deepMerge(LANDER_NEW_DEFAULTS, res?.draft || config));
      setIsDirty(false);
      if (!silent) { setSaveFlash(true); setTimeout(() => setSaveFlash(false), 1600); }
    } finally {
      if (!silent) setIsSaving(false);
    }
  }, [config]);

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

  // autosave
  useEffect(() => {
    if (!isDirty) return undefined;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => {
      saveDraft(true).catch((e) => console.error("Autosave failed:", e));
    }, AUTOSAVE_MS);
    return () => clearTimeout(autosaveRef.current);
  }, [config, isDirty, saveDraft]);

  const groupedSchema = useMemo(() =>
    LANDER_EDITOR_SCHEMA.filter((s) => s.group === activeGroup),
  [activeGroup]);

  return (
    <div className="ale-shell">

      {/* ── Top Bar ─────────────────────────────────────────────────── */}
      <header className="ale-topbar">
        <div className="ale-topbar-left">
          <button className="ale-icon-btn" onClick={() => navigate("/admin")} title="Back to admin">
            <Icon d={ICONS.back} />
          </button>
          <span className="ale-title">Lander Editor</span>
          {isDirty && <span className="ale-dirty-badge">Unsaved</span>}
          {saveFlash && !isDirty && <span className="ale-saved-badge"><Icon d={ICONS.check} size={11} /> Saved</span>}
        </div>
        <div className="ale-topbar-right">
          <button className="ale-icon-btn" onClick={undo} disabled={!history.length} title="Undo">
            <Icon d={ICONS.undo} />
          </button>
          <button className="ale-icon-btn" onClick={redo} disabled={!future.length} title="Redo">
            <Icon d={ICONS.redo} />
          </button>
          <button
            className="ale-icon-btn"
            onClick={() => setShowPreview((v) => !v)}
            title="Toggle preview"
          >
            <Icon d={ICONS.preview} />
            <span className="ale-icon-btn-label">{showPreview ? "Hide" : "Preview"}</span>
          </button>
          <button
            className={`ale-btn ale-btn-ghost ${isSaving ? "is-loading" : ""}`}
            onClick={() => saveDraft()}
            disabled={isSaving}
          >
            <Icon d={ICONS.save} size={13} />
            {isSaving ? "Saving…" : "Save Draft"}
          </button>
          <button
            className={`ale-btn ale-btn-primary ${isPublishing ? "is-loading" : ""}`}
            onClick={publish}
            disabled={isPublishing}
          >
            <Icon d={ICONS.publish} size={13} />
            {isPublishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className={`ale-body ${showPreview ? "with-preview" : "full-sidebar"}`}>

        {/* ── Sidebar ─────────────────────────────────────── */}
        <aside className="ale-sidebar">

          {/* Group tabs */}
          <div className="ale-group-tabs">
            {SCHEMA_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                className={`ale-group-tab ${activeGroup === g ? "is-active" : ""}`}
                onClick={() => { setActiveGroup(g); setActiveId(null); }}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Section list */}
          <div className="ale-section-list">
            {groupedSchema.map((schema) => (
              <SchemaSection
                key={schema.id}
                schema={schema}
                config={config}
                onChange={updateField}
                onUpload={uploadAndSetField}
                activeId={activeId}
                onActivate={setActiveId}
              />
            ))}
          </div>
        </aside>

        {/* ── Preview ─────────────────────────────────────── */}
        {showPreview && (
          <div className="ale-preview-pane">
            <div className="ale-preview-label">
              Live Preview — <a href="/lander-new" target="_blank" rel="noopener" className="ale-preview-link">open in new tab ↗</a>
            </div>
            <div className="ale-preview-scroll">
              <LanderNewPublicApp config={config} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
