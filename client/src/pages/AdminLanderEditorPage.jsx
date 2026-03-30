import { useEffect, useMemo, useRef, useState } from "react";
import { landerNewAPI, uploadFile } from "../services/api";
import { LANDER_NEW_DEFAULTS } from "../landerNew/defaults";
import { BREAKPOINTS, LANDER_EDITOR_SCHEMA } from "../landerNew/schema";
import { deepMerge, getByPath, setByPath } from "../landerNew/utils";
import LanderNewRenderer, { patchLayoutAtBreakpoint } from "../components/landerNew/LanderNewRenderer";

const AUTOSAVE_MS = 900;

export default function AdminLanderEditorPage() {
  const [config, setConfig] = useState(LANDER_NEW_DEFAULTS);
  const [selectedId, setSelectedId] = useState(null);
  const [breakpoint, setBreakpoint] = useState("base");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const autosaveRef = useRef(null);

  const selectedSchema = useMemo(
    () => LANDER_EDITOR_SCHEMA.find((x) => x.id === selectedId) || null,
    [selectedId],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const bundle = await landerNewAPI.getAdminConfigBundle();
      if (!alive) return;
      setConfig(deepMerge(LANDER_NEW_DEFAULTS, bundle?.draft || bundle?.published || {}));
    })().catch((error) => console.error("Failed to load editor bundle:", error));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setRawJson(JSON.stringify(config, null, 2));
  }, [config]);

  const commit = (next) => {
    setHistory((h) => [...h.slice(-49), config]);
    setFuture([]);
    setConfig(next);
    setIsDirty(true);
  };

  const updateField = (path, value) => {
    commit(setByPath(config, path, value));
  };

  const onDragLayoutChange = (targetId, patch) => {
    commit(patchLayoutAtBreakpoint(config, targetId, breakpoint, patch));
  };

  const uploadAndSetField = async (path, file) => {
    if (!file) return;
    try {
      const url = await uploadFile(file);
      updateField(path, url);
    } catch (error) {
      console.error("Upload failed:", error);
    }
  };

  const saveDraft = async (silent = false) => {
    if (!silent) setIsSaving(true);
    try {
      const res = await landerNewAPI.saveDraft(config);
      setConfig(deepMerge(LANDER_NEW_DEFAULTS, res?.draft || config));
      setIsDirty(false);
    } finally {
      if (!silent) setIsSaving(false);
    }
  };

  const publish = async () => {
    setIsPublishing(true);
    try {
      await saveDraft(true);
      await landerNewAPI.publish();
      setIsDirty(false);
    } finally {
      setIsPublishing(false);
    }
  };

  useEffect(() => {
    if (!isDirty) return undefined;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => {
      saveDraft(true).catch((error) => console.error("Autosave failed:", error));
    }, AUTOSAVE_MS);
    return () => clearTimeout(autosaveRef.current);
  }, [config, isDirty]);

  return (
    <div className="lander-editor-shell">
      <header className="lander-editor-toolbar">
        <strong>Lander Editor</strong>
        <div className="lander-editor-toolbar-row">
          {BREAKPOINTS.map((bp) => (
            <button
              type="button"
              key={bp}
              className={`lander-editor-bp-btn ${bp === breakpoint ? "is-active" : ""}`}
              onClick={() => setBreakpoint(bp)}
            >
              {bp}
            </button>
          ))}
          <button type="button" onClick={() => {
            const prev = history[history.length - 1];
            if (!prev) return;
            setFuture((f) => [config, ...f]);
            setHistory((h) => h.slice(0, -1));
            setConfig(prev);
            setIsDirty(true);
          }}>Undo</button>
          <button type="button" onClick={() => {
            const next = future[0];
            if (!next) return;
            setHistory((h) => [...h, config]);
            setFuture((f) => f.slice(1));
            setConfig(next);
            setIsDirty(true);
          }}>Redo</button>
          <button type="button" onClick={() => saveDraft()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button type="button" onClick={publish} disabled={isPublishing}>
            {isPublishing ? "Publishing..." : "Publish"}
          </button>
        </div>
      </header>

      <div className="lander-editor-body">
        <aside className="lander-editor-inspector">
          <h3>Inspector</h3>
          <p className="text-slate-400 text-xs mb-3">
            Click any highlighted element in preview to edit.
          </p>
          {!selectedSchema ? (
            <p className="text-slate-500 text-sm">No element selected.</p>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">{selectedSchema.label}</p>
              {selectedSchema.fields.map((field) => {
                const value = getByPath(config, field.key) ?? "";
                return (
                  <label key={field.key} className="lander-editor-field">
                    <span>{field.label}</span>
                    {field.type === "textarea" ? (
                      <textarea
                        value={value}
                        onChange={(e) => updateField(field.key, e.target.value)}
                      />
                    ) : (
                      <>
                        <input
                          type={field.type === "url" ? "url" : "text"}
                          value={value}
                          onChange={(e) => updateField(field.key, e.target.value)}
                        />
                        {field.type === "url" ? (
                          <input
                            type="file"
                            onChange={(e) => uploadAndSetField(field.key, e.target.files?.[0])}
                          />
                        ) : null}
                      </>
                    )}
                  </label>
                );
              })}

              <div className="lander-editor-layout-box">
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Layout ({breakpoint})</p>
                {["x", "y", "width"].map((k) => (
                  <label key={k} className="lander-editor-field">
                    <span>{k.toUpperCase()}</span>
                    <input
                      type="number"
                      value={Number(getByPath(config, `layout.${selectedId}.${breakpoint}.${k}`) || 0)}
                      onChange={(e) => onDragLayoutChange(selectedId, { [k]: Number(e.target.value || 0) })}
                    />
                  </label>
                ))}
                <label className="lander-editor-field-inline">
                  <input
                    type="checkbox"
                    checked={Boolean(getByPath(config, `layout.${selectedId}.${breakpoint}.hidden`))}
                    onChange={(e) => onDragLayoutChange(selectedId, { hidden: e.target.checked })}
                  />
                  Hidden
                </label>
              </div>
            </>
          )}

          <div className="lander-editor-layout-box">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Advanced JSON (full config)</p>
            <textarea
              className="lander-editor-json"
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(rawJson);
                    commit(deepMerge(LANDER_NEW_DEFAULTS, parsed));
                  } catch (error) {
                    console.error("Invalid JSON:", error);
                  }
                }}
              >
                Apply JSON
              </button>
            </div>
          </div>
        </aside>

        <div className="lander-editor-preview">
          <LanderNewRenderer
            config={config}
            editMode
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDragLayoutChange={onDragLayoutChange}
            breakpoint={breakpoint}
          />
        </div>
      </div>
    </div>
  );
}

