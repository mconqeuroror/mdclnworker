/**
 * NSFW Studio — Sexting Scripts tab.
 *
 * A self-contained 3-view controller:
 *   library  → Grid of built-in + user-saved scripts
 *   editor   → Create / fork / edit a script (scenes → AI base prompts → save)
 *   run      → Executing a script (gallery view with per-pic status)
 *
 * Generations are pushed into the page-level NSFW live-preview strip via the
 * `onImageReady(generation)` callback the parent hands us — so finished pics
 * from a script run show up in the same place as any other NSFW generation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Play,
  Save,
  Trash2,
  Edit3,
  RefreshCw,
  Loader2,
  Sparkles,
  Coins,
  X,
  ChevronLeft,
  Check,
  AlertCircle,
  Image as ImageIcon,
  Wand2,
  BookOpen,
  FilePenLine,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../../services/api";

const TIER_CHOICES = [
  { picCount: 5,  creditsPerPic: 20 },
  { picCount: 10, creditsPerPic: 15 },
  { picCount: 15, creditsPerPic: 13 },
];

function totalCredits(tier) {
  return tier.picCount * tier.creditsPerPic;
}

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Entry                                                                   */
/* ═══════════════════════════════════════════════════════════════════════ */

export default function SextingScriptsTab({
  selectedModel,
  isLoraReady,
  onImageReady,
  onOpenCreditsModal,
}) {
  const [view, setView] = useState("library"); // library | editor | run
  const [activeScript, setActiveScript] = useState(null);
  const [activeRun, setActiveRun] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadScripts = useCallback(async () => {
    setIsLoading(true);
    try {
      const resp = await api.get("/nsfw/sexting-scripts");
      setScripts(resp.data?.scripts || []);
    } catch (err) {
      console.error("[sexting] list error:", err);
      toast.error(err?.response?.data?.message || "Could not load scripts");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScripts();
  }, [loadScripts]);

  const openEditor = (script) => {
    setActiveScript(script);
    setView("editor");
  };
  const openRun = (run) => {
    setActiveRun(run);
    setView("run");
  };
  const backToLibrary = () => {
    setActiveScript(null);
    setActiveRun(null);
    setView("library");
    loadScripts();
  };

  if (view === "editor") {
    return (
      <ScriptEditor
        initial={activeScript}
        onClose={backToLibrary}
        onSaved={() => { backToLibrary(); }}
      />
    );
  }

  if (view === "run") {
    return (
      <ScriptRunView
        run={activeRun}
        onClose={backToLibrary}
        onImageReady={onImageReady}
      />
    );
  }

  return (
    <ScriptLibrary
      scripts={scripts}
      isLoading={isLoading}
      isLoraReady={isLoraReady}
      selectedModel={selectedModel}
      onNew={() => openEditor(null)}
      onEdit={openEditor}
      onRun={openRun}
      onDeleted={loadScripts}
      onOpenCreditsModal={onOpenCreditsModal}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Library                                                                 */
/* ═══════════════════════════════════════════════════════════════════════ */

function ScriptLibrary({
  scripts,
  isLoading,
  isLoraReady,
  selectedModel,
  onNew,
  onEdit,
  onRun,
  onDeleted,
  onOpenCreditsModal,
}) {
  const builtIn = scripts.filter((s) => s.isBuiltIn);
  const userOwned = scripts.filter((s) => s.isOwner);

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-rose-400" />
            Sexting Scripts
          </h2>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Pre-built and custom photo sequences. Each run generates a fresh uniform outfit + environment — every pic in the run matches, but each run is a new look.
          </p>
        </div>
        <button
          onClick={onNew}
          className="group relative inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-br from-rose-500 to-rose-700 hover:from-rose-400 hover:to-rose-600 shadow-lg shadow-rose-900/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          New custom script
        </button>
      </header>

      {!isLoraReady && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            You need a trained LoRA to actually run a script. You can still browse and author scripts now — select a trained model at the top of the page before hitting <b>Run</b>.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading scripts…
        </div>
      ) : (
        <>
          {builtIn.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 text-[12px] uppercase tracking-[0.14em] text-slate-500 mb-3">
                <BookOpen className="w-3.5 h-3.5" />
                Library
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                {builtIn.map((s) => (
                  <ScriptCard
                    key={s.id}
                    script={s}
                    onEdit={() => onEdit(s)}
                    onRun={() => {
                      if (!isLoraReady || !selectedModel) {
                        toast.error("Select a trained LoRA model first");
                        return;
                      }
                      onRunScript(s, selectedModel, onRun, onOpenCreditsModal);
                    }}
                    onDeleted={onDeleted}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="flex items-center gap-2 text-[12px] uppercase tracking-[0.14em] text-slate-500 mb-3">
              <FilePenLine className="w-3.5 h-3.5" />
              Your scripts
            </h3>
            {userOwned.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-white/[0.015] p-8 text-center text-sm text-slate-400">
                No custom scripts yet. Hit <b className="text-white">New custom script</b> to build one.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                {userOwned.map((s) => (
                  <ScriptCard
                    key={s.id}
                    script={s}
                    onEdit={() => onEdit(s)}
                    onRun={() => {
                      if (!isLoraReady || !selectedModel) {
                        toast.error("Select a trained LoRA model first");
                        return;
                      }
                      onRunScript(s, selectedModel, onRun, onOpenCreditsModal);
                    }}
                    onDeleted={onDeleted}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

async function onRunScript(script, selectedModel, onRun, onOpenCreditsModal) {
  // Built-ins ship with empty base prompts by design; the editor generates
  // them once and saves them via the regenerate-pic flow (which persists).
  const needsPrompts =
    !Array.isArray(script.basePrompts) ||
    script.basePrompts.filter(Boolean).length !== script.picCount;
  if (needsPrompts) {
    toast("First time running this script — open the editor and hit Generate base prompts.", { icon: "ℹ️" });
    return;
  }

  const toastId = toast.loading(`Starting run (${script.picCount} pics)…`);
  try {
    const resp = await api.post(`/nsfw/sexting-scripts/${script.id}/run`, {
      modelId: selectedModel,
    });
    toast.dismiss(toastId);
    if (!resp.data?.success) {
      throw new Error(resp.data?.message || "Run failed");
    }
    const run = resp.data.run;
    toast.success(`Run started! ${script.picCount} pics queued.`);
    onRun({ ...run, script });
  } catch (err) {
    toast.dismiss(toastId);
    const msg = err?.response?.data?.message || err.message || "Run failed";
    if (/need \d+ credits/i.test(msg)) {
      onOpenCreditsModal?.();
    }
    toast.error(msg);
  }
}

function ScriptCard({ script, onEdit, onRun, onDeleted }) {
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${script.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/nsfw/sexting-scripts/${script.id}`);
      toast.success("Script deleted");
      onDeleted?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group relative rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.035] to-white/[0.01] p-4 sm:p-5 overflow-hidden hover:border-white/10 transition-colors">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h4 className="font-semibold text-white text-[15px] truncate">{script.name}</h4>
          <div className="flex items-center gap-2 mt-0.5">
            {script.isBuiltIn && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-rose-300/90 bg-rose-500/10 border border-rose-400/20 px-1.5 py-0.5 rounded">Library</span>
            )}
            <span className="text-[11px] text-slate-400">
              {script.picCount} pics · {script.creditsPerPic}cr each
            </span>
          </div>
        </div>
      </div>

      {script.description && (
        <p className="relative text-[13px] text-slate-400 leading-snug mb-4 line-clamp-3">
          {script.description}
        </p>
      )}

      <div className="relative flex items-center gap-2 mt-auto">
        <button
          onClick={onRun}
          disabled={busy}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-medium text-sm text-white bg-gradient-to-br from-rose-500 to-rose-700 hover:from-rose-400 hover:to-rose-600 disabled:opacity-50 transition-all"
          title={`Run · ${script.creditsTotal}cr`}
        >
          <Play className="w-3.5 h-3.5" />
          Run · {script.creditsTotal}cr
        </button>
        <button
          onClick={onEdit}
          disabled={busy}
          className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 border border-white/5 transition-colors"
          title={script.isBuiltIn ? "View & fork" : "Edit"}
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        {!script.isBuiltIn && script.isOwner && (
          <button
            onClick={handleDelete}
            disabled={busy}
            className="p-2 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 border border-white/5 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Editor                                                                  */
/* ═══════════════════════════════════════════════════════════════════════ */

function ScriptEditor({ initial, onClose, onSaved }) {
  // For a built-in we "fork" — we show its scenes pre-filled, user saves a
  // copy under their account. For a user-owned script we edit in place.
  const isFork = initial?.isBuiltIn;

  const [tier, setTier] = useState(() => {
    if (initial?.picCount) {
      const found = TIER_CHOICES.find((t) => t.picCount === initial.picCount);
      if (found) return found;
    }
    return TIER_CHOICES[0];
  });
  const [name, setName] = useState(initial ? (isFork ? `${initial.name} (copy)` : initial.name) : "");
  const [description, setDescription] = useState(initial?.description || "");
  const [themeHint, setThemeHint] = useState(initial?.themeHint || "");

  const [scenes, setScenes] = useState(() => {
    const arr = Array.isArray(initial?.sceneDescriptions) ? initial.sceneDescriptions : [];
    const padded = [...arr];
    while (padded.length < tier.picCount) padded.push("");
    return padded.slice(0, tier.picCount);
  });
  const [basePrompts, setBasePrompts] = useState(() => {
    const arr = Array.isArray(initial?.basePrompts) ? initial.basePrompts : [];
    const padded = [...arr];
    while (padded.length < tier.picCount) padded.push("");
    return padded.slice(0, tier.picCount);
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [regenIdx, setRegenIdx] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);

  // When tier changes, resize the arrays (preserve what we have, pad/trim).
  useEffect(() => {
    setScenes((prev) => {
      const next = [...prev];
      while (next.length < tier.picCount) next.push("");
      return next.slice(0, tier.picCount);
    });
    setBasePrompts((prev) => {
      const next = [...prev];
      while (next.length < tier.picCount) next.push("");
      return next.slice(0, tier.picCount);
    });
  }, [tier.picCount]);

  const canGeneratePrompts = scenes.every((s) => s && s.trim().length > 0);
  const canSave = name.trim().length >= 2 && basePrompts.every((p) => p && p.trim().length > 0);

  const handleGenerateBasePrompts = async () => {
    if (!canGeneratePrompts) {
      toast.error("Fill in every scene description first");
      return;
    }
    setIsGenerating(true);
    try {
      const resp = await api.post("/nsfw/sexting-scripts/generate-base-prompts", {
        sceneDescriptions: scenes,
      });
      if (!resp.data?.success) throw new Error(resp.data?.message || "AI failed");
      setBasePrompts(resp.data.basePrompts);
      toast.success("Base prompts generated — review and save.");
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || "AI failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateOne = async (idx) => {
    if (!scenes[idx] || !scenes[idx].trim()) {
      toast.error("Scene description is empty");
      return;
    }
    // If the script is already saved AND owned, regenerate on the server (it
    // persists). Otherwise we call the one-scene generator locally.
    setRegenIdx(idx);
    try {
      if (initial?.id && !initial.isBuiltIn && initial.isOwner) {
        const resp = await api.post(
          `/nsfw/sexting-scripts/${initial.id}/regenerate-pic-prompt`,
          { picIndex: idx }
        );
        if (!resp.data?.success) throw new Error(resp.data?.message || "Failed");
        setBasePrompts((prev) => {
          const n = [...prev];
          n[idx] = resp.data.basePrompt;
          return n;
        });
        toast.success(`Pic ${idx + 1} regenerated`);
      } else {
        // Editor is still in-memory: call the bulk endpoint with just one scene.
        const resp = await api.post("/nsfw/sexting-scripts/generate-base-prompts", {
          sceneDescriptions: [scenes[idx]],
        });
        if (!resp.data?.success) throw new Error(resp.data?.message || "Failed");
        setBasePrompts((prev) => {
          const n = [...prev];
          n[idx] = resp.data.basePrompts[0];
          return n;
        });
        toast.success(`Pic ${idx + 1} regenerated`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || "Regen failed");
    } finally {
      setRegenIdx(-1);
    }
  };

  const handleSave = async () => {
    if (!canSave) {
      toast.error("Name + all base prompts are required before saving");
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        name,
        description,
        themeHint,
        picCount: tier.picCount,
        sceneDescriptions: scenes,
        basePrompts,
      };
      if (initial?.id && !isFork && initial.isOwner) {
        await api.patch(`/nsfw/sexting-scripts/${initial.id}`, body);
        toast.success("Script updated");
      } else {
        await api.post("/nsfw/sexting-scripts", body);
        toast.success("Script saved");
      }
      onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to library
        </button>
        <div className="text-[12px] uppercase tracking-[0.14em] text-slate-500">
          {initial ? (isFork ? "Forking built-in" : "Editing script") : "New script"}
        </div>
      </header>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 sm:p-6 space-y-5">
        {/* Meta */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-1.5">Script name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Morning Tease in Lingerie"
              maxLength={120}
              className="w-full bg-black/30 border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-400/50"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-1.5">Pic count · pricing</label>
            <div className="flex gap-2">
              {TIER_CHOICES.map((t) => (
                <button
                  key={t.picCount}
                  onClick={() => setTier(t)}
                  className={classNames(
                    "flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
                    tier.picCount === t.picCount
                      ? "border-rose-400/60 bg-rose-500/10 text-white"
                      : "border-white/5 bg-black/20 text-slate-300 hover:text-white hover:border-white/10"
                  )}
                >
                  <div className="text-[15px] font-semibold">{t.picCount}</div>
                  <div className="text-[10px] text-slate-400">{t.creditsPerPic}cr/pic · {totalCredits(t)}cr total</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-1.5">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note for yourself"
              maxLength={500}
              className="w-full bg-black/30 border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-400/50"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-1.5">Theme hint (optional, steers outfit + env)</label>
            <input
              type="text"
              value={themeHint}
              onChange={(e) => setThemeHint(e.target.value)}
              placeholder="e.g. bedroom intimacy with visible lingerie"
              maxLength={200}
              className="w-full bg-black/30 border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-400/50"
            />
          </div>
        </div>

        {/* Scene list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[12px] uppercase tracking-[0.14em] text-slate-400 flex items-center gap-2">
              <Wand2 className="w-3.5 h-3.5" />
              Scenes — describe each pic in 1 sentence
            </h4>
            <button
              onClick={handleGenerateBasePrompts}
              disabled={!canGeneratePrompts || isGenerating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-br from-violet-600 to-fuchsia-700 hover:from-violet-500 hover:to-fuchsia-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="w-3 h-3" /> Generate base prompts</>
              )}
            </button>
          </div>

          <div className="space-y-3">
            {scenes.map((scene, i) => (
              <SceneRow
                key={i}
                index={i}
                scene={scene}
                basePrompt={basePrompts[i]}
                onChangeScene={(v) => setScenes((prev) => { const n = [...prev]; n[i] = v; return n; })}
                onChangePrompt={(v) => setBasePrompts((prev) => { const n = [...prev]; n[i] = v; return n; })}
                onRegenerate={() => handleRegenerateOne(i)}
                isRegenerating={regenIdx === i}
                disabled={isGenerating}
              />
            ))}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-white/5">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <Coins className="w-3.5 h-3.5 text-amber-300" />
            <span>Each run costs <b className="text-white">{tier.picCount * tier.creditsPerPic}cr</b>. Outfit + environment are regenerated every run.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-sm text-slate-300 hover:text-white bg-white/[0.03] hover:bg-white/5 border border-white/5"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-rose-500 to-rose-700 hover:from-rose-400 hover:to-rose-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-rose-900/30"
            >
              {isSaving ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
              ) : (
                <><Save className="w-3.5 h-3.5" /> Save script</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneRow({
  index,
  scene,
  basePrompt,
  onChangeScene,
  onChangePrompt,
  onRegenerate,
  isRegenerating,
  disabled,
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3 sm:p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.14em] text-rose-300/80 font-semibold">
          Pic {index + 1}
        </div>
        <button
          onClick={onRegenerate}
          disabled={disabled || isRegenerating || !scene?.trim()}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          title="Regenerate this pic's base prompt"
        >
          {isRegenerating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Regen
        </button>
      </div>
      <textarea
        value={scene}
        onChange={(e) => onChangeScene(e.target.value)}
        placeholder="Describe this pic's scene — pose, framing, expression, action…"
        rows={2}
        disabled={disabled}
        className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-400/50 resize-y"
      />
      {basePrompt ? (
        <div className="relative">
          <label className="block text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1">
            Generated base prompt
          </label>
          <textarea
            value={basePrompt}
            onChange={(e) => onChangePrompt(e.target.value)}
            rows={2}
            className="w-full bg-black/50 border border-white/[0.04] rounded-lg px-3 py-2 text-[12px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-400/40 resize-y font-mono leading-relaxed"
          />
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 italic pl-1">
          Hit <b className="text-slate-300">Generate base prompts</b> above to have AI expand this into a reusable template.
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Run view                                                                */
/* ═══════════════════════════════════════════════════════════════════════ */

function ScriptRunView({ run: initialRun, onClose, onImageReady }) {
  const [run, setRun] = useState(initialRun);
  const notifiedRef = useRef(new Set());

  const poll = useCallback(async () => {
    try {
      const resp = await api.get(`/nsfw/sexting-scripts/runs/${initialRun.id}`);
      if (!resp.data?.success) return;
      const next = resp.data.run;
      setRun((prev) => ({ ...prev, ...next }));

      // Forward newly-completed generations to the parent's live-preview.
      for (const g of next.generations || []) {
        if (g.status === "completed" && g.outputUrl && !notifiedRef.current.has(g.id)) {
          notifiedRef.current.add(g.id);
          try { onImageReady?.(g); } catch { /**/ }
        }
      }
    } catch (err) {
      console.error("[sexting] run poll error:", err);
    }
  }, [initialRun?.id, onImageReady]);

  useEffect(() => {
    if (!initialRun?.id) return;
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [initialRun?.id, poll]);

  const generations = run?.generations || [];
  const done = generations.filter((g) => g.status === "completed").length;
  const failed = generations.filter((g) => g.status === "failed").length;
  const total = run?.picCount || generations.length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white self-start"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to library
        </button>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
            {run?.scriptName || initialRun?.script?.name || "Script run"}
          </div>
          <div className="text-sm text-slate-300">
            {done} / {total} ready{failed > 0 ? ` · ${failed} failed` : ""}
          </div>
        </div>
      </header>

      {/* Uniform outfit + env banner */}
      <div className="rounded-xl border border-white/5 bg-gradient-to-br from-rose-500/[0.03] to-violet-500/[0.02] p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1">This run's outfit</div>
            <div className="text-sm text-white">{run?.outfit || initialRun?.outfit || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1">This run's environment</div>
            <div className="text-sm text-white">{run?.environment || initialRun?.environment || "—"}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: Math.max(total, generations.length) }).map((_, i) => {
          const gen = generations[i];
          return <RunTile key={gen?.id || i} index={i} gen={gen} />;
        })}
      </div>
    </div>
  );
}

function RunTile({ index, gen }) {
  const status = gen?.status || "pending";
  const label = status === "completed" ? "Ready" : status === "failed" ? "Failed" : status === "processing" ? "Generating…" : "Queued";

  return (
    <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-white/5 bg-black/40 group">
      {status === "completed" && gen?.outputUrl ? (
        <img
          src={gen.outputUrl}
          alt={`Pic ${index + 1}`}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : status === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-rose-300 px-3 text-center gap-1">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[11px]">Pic {index + 1} failed</div>
          {gen?.errorMessage && (
            <div className="text-[10px] text-rose-400/70 line-clamp-3">{gen.errorMessage}</div>
          )}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-rose-500/5 to-violet-500/5" />
          <div className="relative flex flex-col items-center gap-1.5 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <div className="text-[11px]">{label}</div>
          </div>
        </div>
      )}
      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] text-white/80 uppercase tracking-[0.12em]">
        Pic {index + 1}
      </div>
      {status === "completed" && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500/90 flex items-center justify-center">
          <Check className="w-3 h-3 text-black" />
        </div>
      )}
    </div>
  );
}
