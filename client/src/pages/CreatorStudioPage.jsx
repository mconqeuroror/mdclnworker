import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Plus, Download, Loader2, Maximize2, Wand2, Sparkles, AlertCircle,
} from "lucide-react";
import { creatorStudioAPI, uploadFile } from "../services/api";
import { useAuthStore } from "../store";
import { useActiveGeneration } from "../hooks/useActiveGeneration";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  { value: "1:1",  label: "1:1",  hint: "Selfie" },
  { value: "4:3",  label: "4:3",  hint: null },
  { value: "2:3",  label: "2:3",  hint: null },
  { value: "3:2",  label: "3:2",  hint: null },
  { value: "9:16", label: "9:16", hint: null },
  { value: "16:9", label: "16:9", hint: null },
  { value: "5:4",  label: "5:4",  hint: null },
  { value: "4:5",  label: "4:5",  hint: null },
  { value: "21:9", label: "21:9", hint: null },
];

const RESOLUTIONS = ["1K", "2K", "4K"];
const MAX_REFS = 8;

// ---------------------------------------------------------------------------
// Styles matching the content-studio floating bar exactly
// ---------------------------------------------------------------------------
const BAR_BG = "linear-gradient(115deg, rgba(36,43,50,0.12) 27.54%, rgba(219,219,219,0.12) 85.5%), rgba(15,17,19,0.96)";

// ---------------------------------------------------------------------------
// Tiny helper — pill chip button
// ---------------------------------------------------------------------------
function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all select-none ${
        active
          ? "bg-white text-black"
          : "text-slate-400 hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Single reference slot
// ---------------------------------------------------------------------------
function RefSlot({ url, onRemove, onAdd, uploading }) {
  const inputRef = useRef(null);

  if (url) {
    return (
      <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-white/10 flex-shrink-0 group">
        <img src={url} alt="" className="w-full h-full object-cover" />
        <button
          onClick={onRemove}
          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5 text-white" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center flex-shrink-0 hover:border-white/30 hover:bg-white/5 transition-all text-slate-500 hover:text-white disabled:opacity-40"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAdd(file);
          e.target.value = "";
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Result card in the canvas area
// ---------------------------------------------------------------------------
function ResultCard({ gen, onExpand }) {
  const isProcessing = gen.status === "processing" || gen.status === "pending";
  const isCompleted  = gen.status === "completed";
  const isFailed     = gen.status === "failed";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="relative rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.03] group"
      style={{ aspectRatio: "1/1", minWidth: 220, maxWidth: 420, width: "100%" }}
    >
      {isCompleted && gen.outputUrl ? (
        <>
          <img src={gen.outputUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-3 gap-2">
            <button
              onClick={() => onExpand(gen)}
              className="w-8 h-8 rounded-lg bg-black/50 flex items-center justify-center text-white hover:bg-black/70 backdrop-blur-sm"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <a
              href={`/api/download?url=${encodeURIComponent(gen.outputUrl)}&filename=creator-${gen.id}.jpg`}
              download
              onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 rounded-lg bg-black/50 flex items-center justify-center text-white hover:bg-black/70 backdrop-blur-sm"
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
          {gen.prompt && (
            <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
              <p className="text-[11px] text-white/70 truncate">{gen.prompt}</p>
            </div>
          )}
        </>
      ) : isProcessing ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <div className="relative">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          </div>
          <p className="text-xs text-slate-400">Generating…</p>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <AlertCircle className="w-6 h-6 text-red-400/60" />
          <p className="text-[11px] text-red-400/70">{gen.errorMessage || "Failed"}</p>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------
function Lightbox({ gen, onClose }) {
  if (!gen) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.92 }}
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={gen.outputUrl} alt="" className="max-w-full max-h-[90vh] rounded-2xl object-contain" />
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
        >
          <X className="w-4 h-4" />
        </button>
        <a
          href={`/api/download?url=${encodeURIComponent(gen.outputUrl)}&filename=creator-${gen.id}.jpg`}
          download
          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="w-3.5 h-3.5" />
          Save
        </a>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CreatorStudioPage() {
  const user          = useAuthStore((s) => s.user);
  const refreshUser   = useAuthStore((s) => s.refreshUser);

  // form
  const [prompt, setPrompt]           = useState("");
  const [refs, setRefs]               = useState(Array(MAX_REFS).fill(null)); // null = empty slot
  const [uploadingIdx, setUploadingIdx] = useState(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution]   = useState("1K");

  // results
  const { activeGeneration, isGenerating, startGeneration, pollForCompletion, reset } = useActiveGeneration();
  const [history, setHistory]         = useState([]);
  const [lightboxGen, setLightboxGen] = useState(null);

  // load history once
  const { isLoading: histLoading } = useQuery({
    queryKey: ["creator-studio-history"],
    queryFn: async () => {
      const data = await creatorStudioAPI.getHistory({ limit: 20 });
      setHistory(data.generations ?? []);
      return data;
    },
    staleTime: 30_000,
  });

  // upload a single reference file → get back a public URL via the blob upload endpoint
  const handleAddRef = useCallback(async (file, slotIdx) => {
    setUploadingIdx(slotIdx);
    try {
      const result = await uploadFile(file);
      const url = result?.url || result;
      if (!url) throw new Error("No URL returned");
      setRefs((prev) => {
        const next = [...prev];
        next[slotIdx] = url;
        return next;
      });
    } catch (err) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploadingIdx(null);
    }
  }, []);

  const removeRef = (idx) => {
    setRefs((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
  };

  // generate
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Enter a prompt");
      return;
    }
    const filledRefs = refs.filter(Boolean);

    startGeneration({ status: "processing", type: "creator-studio", prompt: prompt.trim() });

    try {
      const data = await creatorStudioAPI.generate({
        prompt: prompt.trim(),
        referencePhotos: filledRefs,
        aspectRatio,
        resolution,
      });

      if (!data.success) throw new Error(data.message || "Generation failed");

      startGeneration({ ...data.generation, prompt: prompt.trim() });

      pollForCompletion(data.generation.id, {
        onSuccess: (gen) => {
          toast.success("Done!");
          refreshUser?.();
          // Prepend completed gen to history
          setHistory((prev) => [{ ...gen, prompt: prompt.trim() }, ...prev.filter((g) => g.id !== gen.id)]);
        },
        onFailure: (gen) => {
          toast.error(gen.errorMessage || "Generation failed — credits refunded");
        },
      });
    } catch (err) {
      reset();
      toast.error(err.response?.data?.message || err.message || "Generation failed");
    }
  };

  const COST = resolution === "4K" ? 25 : 20;
  const creditsLeft = user?.credits ?? 0;

  // All generations to show (active first, then history, deduped)
  const displayGens = [
    ...(activeGeneration ? [activeGeneration] : []),
    ...history.filter((g) => g.id !== activeGeneration?.id),
  ];

  return (
    <div className="relative flex flex-col min-h-full bg-[#0a0a0c]">

      {/* ── Canvas — results area ─────────────────────────────────────────── */}
      <div className="flex-1 px-6 pt-6 pb-64 min-h-screen">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}>
            <Wand2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Creator Studio</h1>
            <p className="text-[11px] text-slate-500">NanoBanana Pro · no model required</p>
          </div>
        </div>

        {/* Empty state */}
        {displayGens.length === 0 && !histLoading && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
              style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}>
              <Sparkles className="w-8 h-8 text-purple-400/60" />
            </div>
            <p className="text-slate-500 text-sm">Your creations will appear here</p>
          </div>
        )}

        {/* Generation grid */}
        {displayGens.length > 0 && (
          <div className="flex flex-wrap gap-4 justify-start">
            <AnimatePresence mode="popLayout">
              {displayGens.map((gen) => (
                <ResultCard
                  key={gen.id}
                  gen={gen}
                  onExpand={setLightboxGen}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Floating bottom bar ───────────────────────────────────────────── */}
      <div className="hidden md:flex justify-center fixed bottom-4 left-56 right-6 z-20 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-2xl flex flex-col items-stretch justify-center p-3 rounded-2xl"
          style={{ background: BAR_BG }}
        >
          {/* Prompt row */}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
            placeholder="Describe the scene you imagine"
            rows={2}
            className="w-full bg-transparent text-sm text-white placeholder-slate-500 resize-none outline-none px-1 py-1 leading-relaxed"
          />

          {/* Controls row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">

            {/* REFS label + 8 slots */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-0.5">Refs</span>
              {refs.map((url, i) => (
                <RefSlot
                  key={i}
                  url={url}
                  uploading={uploadingIdx === i}
                  onRemove={() => removeRef(i)}
                  onAdd={(file) => handleAddRef(file, i)}
                />
              ))}
            </div>

            <div className="w-px h-6 bg-white/[0.08] flex-shrink-0" />

            {/* ASPECT */}
            <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-0.5">Aspect</span>
              {ASPECT_RATIOS.map((ar) => (
                <Chip key={ar.value} active={aspectRatio === ar.value} onClick={() => setAspectRatio(ar.value)}>
                  {ar.hint ?? ar.label}
                </Chip>
              ))}
            </div>

            <div className="w-px h-6 bg-white/[0.08] flex-shrink-0" />

            {/* RES */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-0.5">Res</span>
              {RESOLUTIONS.map((r) => (
                <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>
                  {r}
                </Chip>
              ))}
            </div>

            {/* Generate button — pushed to the right */}
            <div className="flex-1 flex justify-end">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isGenerating
                    ? "rgba(124,58,237,0.35)"
                    : "linear-gradient(135deg,#7c3aed,#4f46e5)",
                  boxShadow: isGenerating ? "none" : "0 0 18px rgba(124,58,237,0.45)",
                  color: "white",
                }}
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                {isGenerating ? "Generating…" : `Generate · ${COST} cr`}
              </button>
            </div>
          </div>

          {/* Credits hint */}
          <p className="text-[10px] text-slate-600 mt-1.5 text-right pr-1">
            {creditsLeft} credits available
          </p>
        </div>
      </div>

      {/* ── Mobile fallback bar ──────────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-20 p-3" style={{ background: BAR_BG }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the scene you imagine"
          rows={2}
          className="w-full bg-transparent text-sm text-white placeholder-slate-500 resize-none outline-none px-1 mb-2"
        />
        <div className="flex gap-2 flex-wrap mb-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest self-center">Aspect</span>
          {ASPECT_RATIOS.map((ar) => (
            <Chip key={ar.value} active={aspectRatio === ar.value} onClick={() => setAspectRatio(ar.value)}>
              {ar.hint ?? ar.label}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2 items-center mb-3">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest">Res</span>
          {RESOLUTIONS.map((r) => (
            <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>{r}</Chip>
          ))}
          <div className="flex-1" />
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white" }}
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : `Generate · ${COST} cr`}
          </button>
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxGen && (
          <Lightbox gen={lightboxGen} onClose={() => setLightboxGen(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
