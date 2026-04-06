import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  User,
  ImageIcon,
  Download,
  Loader2,
  RefreshCcw,
  Plus,
  Coins,
  ChevronDown,
  CheckCircle2,
  Clock,
  Zap,
  Upload,
  X,
  Trash2,
  AlertCircle,
} from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";
import { useAuthStore } from "../store";
import { useTheme } from "../hooks/useTheme.jsx";
import { useCachedModels } from "../hooks/useCachedModels";

// Light DB checks until webhook fills outputUrl (server no longer polls RunPod when webhook is set)
const POLL_INTERVAL_MS = 5000;

const SOULX_CREDITS = {
  noModel_1: 10,
  withModel_1: 15,
  noModel_2: 15,
  withModel_2: 25,
};

const ASPECT_OPTIONS = [
  { id: "9:16", label: "9:16", hint: "Portrait" },
  { id: "1:1", label: "1:1", hint: "Square" },
  { id: "16:9", label: "16:9", hint: "Landscape" },
  { id: "3:4", label: "3:4", hint: "4:3 Portrait" },
  { id: "4:3", label: "4:3", hint: "Wide" },
];

function authHeader() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function CreditBadge({ cost, isDark }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold
      ${isDark ? "bg-violet-500/15 text-violet-300 border border-violet-500/25" : "bg-violet-100 text-violet-700 border border-violet-200"}`}>
      <Coins className="w-3 h-3" /> {cost} cr
    </span>
  );
}

function ResultCard({ imageUrl, isDark, onDownload }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative rounded-2xl overflow-hidden border
        ${isDark ? "border-white/10 bg-white/[0.03]" : "border-black/8 bg-black/[0.02]"}`}
    >
      <img src={imageUrl} alt="Soul-X generated" className="w-full h-auto block" />
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent flex justify-end">
        <button
          onClick={() => onDownload(imageUrl)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium backdrop-blur-sm transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> Download
        </button>
      </div>
    </motion.div>
  );
}

// ── Character Tab ─────────────────────────────────────────────────────────────

function CharacterTab({ isDark }) {
  const { models } = useCachedModels();
  const [selectedModelId, setSelectedModelId] = useState("");
  const [character, setCharacter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [charName, setCharName] = useState("");
  const [trainingMode, setTrainingMode] = useState("standard");
  const [uploadedImages, setUploadedImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [training, setTraining] = useState(false);
  const fileInputRef = useRef(null);

  const aiModels = (models || []).filter((m) => m.isAIGenerated);

  const fetchCharacter = useCallback(async (modelId) => {
    if (!modelId) { setCharacter(null); return; }
    setLoading(true);
    try {
      const res = await axios.get(`/api/soulx/characters/${modelId}`, { headers: authHeader() });
      setCharacter(res.data.characters?.[0] || null);
      if (res.data.characters?.[0]) {
        setUploadedImages(res.data.characters[0].trainingImages || []);
      }
    } catch {
      setCharacter(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCharacter(selectedModelId);
  }, [selectedModelId, fetchCharacter]);

  const handleCreate = async () => {
    if (!selectedModelId) { toast.error("Select a model first"); return; }
    setCreating(true);
    try {
      const res = await axios.post("/api/soulx/character/create", {
        modelId: selectedModelId,
        name: charName.trim() || undefined,
        trainingMode,
      }, { headers: authHeader() });
      setCharacter(res.data.lora);
      toast.success("Character identity created!");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create character");
    } finally {
      setCreating(false);
    }
  };

  const handleUpload = async (files) => {
    if (!character) return;
    setUploading(true);
    const formData = new FormData();
    for (const f of files) formData.append("photos", f);
    formData.append("loraId", character.id);
    formData.append("modelId", character.modelId);
    try {
      const res = await axios.post("/api/soulx/character/upload-images", formData, {
        headers: { ...authHeader(), "Content-Type": "multipart/form-data" },
      });
      toast.success(`${res.data.uploadedUrls?.length || 0} photos uploaded`);
      fetchCharacter(selectedModelId);
    } catch (err) {
      toast.error(err.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleTrain = async () => {
    if (!character) return;
    setTraining(true);
    try {
      await axios.post("/api/soulx/character/train", {
        modelId: selectedModelId,
        loraId: character.id,
      }, { headers: authHeader() });
      toast.success("Training started! This may take 10-20 minutes.");
      fetchCharacter(selectedModelId);
    } catch (err) {
      toast.error(err.response?.data?.message || "Training failed");
    } finally {
      setTraining(false);
    }
  };

  const handleDeleteCharacter = async () => {
    if (!character || !window.confirm("Delete this character identity?")) return;
    try {
      await axios.delete(`/api/soulx/character/${character.id}`, { headers: authHeader() });
      setCharacter(null);
      setUploadedImages([]);
      toast.success("Character deleted");
    } catch (err) {
      toast.error(err.response?.data?.message || "Delete failed");
    }
  };

  const statusColor = {
    ready: "text-emerald-400",
    training: "text-amber-400",
    awaiting_images: "text-sky-400",
    failed: "text-rose-400",
  };

  const statusLabel = {
    ready: "Ready",
    training: "Training…",
    awaiting_images: "Awaiting photos",
    failed: "Failed",
  };

  const base = isDark
    ? "bg-white/[0.04] border-white/[0.08]"
    : "bg-black/[0.02] border-black/[0.08]";

  return (
    <div className="space-y-5">
      {/* Model picker */}
      <div>
        <label className={`block text-xs font-semibold mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          SELECT MODEL
        </label>
        <div className="relative">
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className={`w-full appearance-none pl-3 pr-9 py-2.5 rounded-xl text-sm border outline-none
              ${isDark ? "bg-white/[0.05] border-white/10 text-white" : "bg-white border-black/10 text-slate-900"}`}
          >
            <option value="">— Choose a model —</option>
            {aiModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none
            ${isDark ? "text-slate-400" : "text-slate-400"}`} />
        </div>
      </div>

      {selectedModelId && (
        <>
          {loading && (
            <div className="flex items-center gap-2 py-4 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading character info…
            </div>
          )}

          {!loading && !character && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl border p-5 ${base}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-violet-500/20 flex items-center justify-center">
                  <User className="w-4.5 h-4.5 text-violet-400" />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                    Create Character Identity
                  </p>
                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    One character per model — used for consistent Soul-X generations
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Character name (optional)"
                  value={charName}
                  onChange={(e) => setCharName(e.target.value)}
                  className={`w-full px-3 py-2.5 rounded-xl text-sm border outline-none
                    ${isDark ? "bg-white/[0.05] border-white/10 text-white placeholder-slate-500" : "bg-white border-black/10 text-slate-900 placeholder-slate-400"}`}
                />

                <div className="flex gap-2">
                  {["standard", "pro"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setTrainingMode(m)}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all
                        ${trainingMode === m
                          ? "bg-violet-500/20 border-violet-500/50 text-violet-300"
                          : isDark ? "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:border-white/20" : "bg-white border-black/10 text-slate-500 hover:border-black/20"
                        }`}
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create Character Identity
                </button>
              </div>
            </motion.div>
          )}

          {!loading && character && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl border p-5 ${base}`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>{character.name}</p>
                    <p className={`text-xs font-medium ${statusColor[character.status] || "text-slate-400"}`}>
                      {statusLabel[character.status] || character.status}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleDeleteCharacter}
                  className={`p-1.5 rounded-lg transition-colors ${isDark ? "text-slate-500 hover:text-rose-400 hover:bg-rose-500/10" : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Photos */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    TRAINING PHOTOS ({uploadedImages.length})
                  </span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || character.status === "training"}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40
                      ${isDark ? "border-white/15 text-slate-300 hover:bg-white/[0.08]" : "border-black/15 text-slate-600 hover:bg-black/[0.04]"}`}
                  >
                    {uploading ? "Uploading…" : "+ Add Photos"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length) handleUpload(files);
                      e.target.value = "";
                    }}
                  />
                </div>
                {uploadedImages.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {uploadedImages.slice(0, 8).map((img) => (
                      <div key={img.id} className="aspect-square rounded-lg overflow-hidden bg-white/[0.04]">
                        <img src={img.imageUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    ))}
                    {uploadedImages.length > 8 && (
                      <div className={`aspect-square rounded-lg flex items-center justify-center text-xs ${isDark ? "bg-white/[0.04] text-slate-400" : "bg-black/[0.03] text-slate-500"}`}>
                        +{uploadedImages.length - 8}
                      </div>
                    )}
                  </div>
                )}
                {uploadedImages.length === 0 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`w-full py-6 rounded-xl border-2 border-dashed text-sm transition-colors
                      ${isDark ? "border-white/10 text-slate-500 hover:border-violet-500/40 hover:text-slate-400" : "border-black/10 text-slate-400 hover:border-violet-400/50"}`}
                  >
                    <Upload className="w-5 h-5 mx-auto mb-1.5 opacity-50" />
                    Upload training photos
                  </button>
                )}
              </div>

              {/* Train button */}
              {character.status !== "ready" && character.status !== "training" && (
                <button
                  onClick={handleTrain}
                  disabled={training || uploadedImages.length < 5}
                  className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {uploadedImages.length < 5 ? `Need ${5 - uploadedImages.length} more photos` : "Start Training"}
                </button>
              )}

              {character.status === "training" && (
                <div className={`flex items-center gap-2.5 p-3 rounded-xl ${isDark ? "bg-amber-500/10 border border-amber-500/25" : "bg-amber-50 border border-amber-200"}`}>
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
                  <p className="text-xs text-amber-400">Training in progress — typically 10–20 minutes.</p>
                </div>
              )}

              {character.status === "ready" && (
                <div className={`flex items-center gap-2.5 p-3 rounded-xl ${isDark ? "bg-emerald-500/10 border border-emerald-500/25" : "bg-emerald-50 border border-emerald-200"}`}>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <p className="text-xs text-emerald-400">Character identity is ready for generation.</p>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

// ── Generate Tab ──────────────────────────────────────────────────────────────

function GenerateTab({ isDark }) {
  const { user, setUser } = useAuthStore();
  const { models } = useCachedModels();

  const [mode, setMode] = useState("without"); // "without" | "character"
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [characters, setCharacters] = useState([]);
  const [aspect, setAspect] = useState("9:16");
  const [qty, setQty] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState([]); // [{generationId, imageUrl, status}]
  const pollRefs = useRef({});

  const aiModels = (models || []).filter((m) => m.isAIGenerated);

  const credits = (user?.credits ?? 0) + (user?.bonusCredits ?? 0);
  const cost = qty === 2
    ? (mode === "character" ? SOULX_CREDITS.withModel_2 : SOULX_CREDITS.noModel_2)
    : (mode === "character" ? SOULX_CREDITS.withModel_1 : SOULX_CREDITS.noModel_1);
  const hasEnough = credits >= cost;

  // Fetch characters when model changes
  useEffect(() => {
    if (!selectedModelId || mode !== "character") { setCharacters([]); setSelectedCharacterId(""); return; }
    const token = localStorage.getItem("token");
    axios.get(`/api/soulx/characters/${selectedModelId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const ready = (res.data.characters || []).filter((c) => c.status === "ready");
        setCharacters(ready);
        if (ready.length === 1) setSelectedCharacterId(ready[0].id);
        else setSelectedCharacterId("");
      })
      .catch(() => setCharacters([]));
  }, [selectedModelId, mode]);

  const stopPoll = (genId) => {
    if (pollRefs.current[genId]) {
      clearInterval(pollRefs.current[genId]);
      delete pollRefs.current[genId];
    }
  };

  const startPoll = (genId) => {
    pollRefs.current[genId] = setInterval(async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`/api/soulx/status/${genId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const { status, imageUrl, error } = res.data;
        if (status === "completed" && imageUrl) {
          stopPoll(genId);
          setResults((prev) => prev.map((r) => r.generationId === genId ? { ...r, status: "done", imageUrl } : r));
        } else if (status === "failed") {
          stopPoll(genId);
          setResults((prev) => prev.map((r) => r.generationId === genId ? { ...r, status: "failed", error } : r));
          toast.error(`Generation failed: ${error || "Unknown error"}`);
        }
      } catch (_) {}
    }, POLL_INTERVAL_MS);
  };

  // Cleanup on unmount
  useEffect(() => () => {
    Object.keys(pollRefs.current).forEach(stopPoll);
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt first"); return; }
    if (mode === "character" && !selectedModelId) { toast.error("Select a model"); return; }
    if (mode === "character" && !selectedCharacterId) { toast.error("Select a character identity"); return; }
    if (!hasEnough) { toast.error("Insufficient credits"); return; }

    setGenerating(true);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.post("/api/soulx/generate", {
        prompt: prompt.trim(),
        modelId: mode === "character" ? selectedModelId : null,
        characterLoraId: mode === "character" ? selectedCharacterId : null,
        aspectRatio: aspect,
        quantity: qty,
      }, { headers: { Authorization: `Bearer ${token}` } });

      const generationIds = Array.isArray(res.data?.generationIds) ? res.data.generationIds : [];
      if (!generationIds.length) {
        toast.error(res.data?.error || "Server did not return a generation id");
        return;
      }
      const newResults = generationIds.map((id) => ({ generationId: id, status: "processing", imageUrl: null }));
      setResults((prev) => [...newResults, ...prev]);
      generationIds.forEach(startPoll);

      // Deduct credits from local state
      if (user) {
        const deducted = cost;
        const remaining = Math.max(0, (user.credits || 0) - deducted);
        setUser({ ...user, credits: remaining });
      }
    } catch (err) {
      const apiError = err?.response?.data?.error;
      if (apiError) {
        toast.error(apiError);
        return;
      }

      // Network/parse failures can happen after backend already accepted the job.
      // Recover by looking for a very recent Soul-X processing generation.
      try {
        const token = localStorage.getItem("token");
        const recent = await axios.get("/api/generations", {
          params: { type: "soulx", limit: 8, offset: 0 },
          headers: { Authorization: `Bearer ${token}` },
        });
        const rows = Array.isArray(recent.data?.generations) ? recent.data.generations : [];
        const now = Date.now();
        const recovered = rows.find((g) => {
          const st = String(g?.status || "").toLowerCase();
          const ts = g?.createdAt ? new Date(g.createdAt).getTime() : 0;
          return g?.id && (st === "processing" || st === "pending") && ts > 0 && (now - ts) < 2 * 60 * 1000;
        });
        if (recovered?.id) {
          setResults((prev) =>
            prev.some((r) => r.generationId === recovered.id)
              ? prev
              : [{ generationId: recovered.id, status: "processing", imageUrl: null }, ...prev]
          );
          startPoll(recovered.id);
          toast.success("Submission received. Tracking your generation...");
          return;
        }
      } catch {
        // swallow recovery failures and show a single fallback toast below
      }

      toast.error("Generation submission failed. Please retry.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (url) => {
    try {
      const a = document.createElement("a");
      if (url.startsWith("data:")) {
        a.href = url;
      } else {
        const resp = await fetch(url);
        const blob = await resp.blob();
        a.href = URL.createObjectURL(blob);
      }
      a.download = `soulx_${Date.now()}.png`;
      a.click();
    } catch {
      window.open(url, "_blank");
    }
  };

  const inputBase = isDark
    ? "bg-white/[0.05] border-white/[0.08] text-white placeholder-slate-500"
    : "bg-white border-black/10 text-slate-900 placeholder-slate-400";

  const labelBase = `block text-xs font-semibold mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`;

  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div>
        <label className={labelBase}>MODE</label>
        <div className={`flex rounded-xl p-1 border ${isDark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.07]"}`}>
          {[
            { id: "without", label: "No Character", icon: ImageIcon },
            { id: "character", label: "Use Character", icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all
                ${mode === id
                  ? "bg-violet-600 text-white shadow-sm"
                  : isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Model + character selector */}
      <AnimatePresence>
        {mode === "character" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 overflow-hidden"
          >
            <div>
              <label className={labelBase}>MODEL</label>
              <div className="relative">
                <select
                  value={selectedModelId}
                  onChange={(e) => { setSelectedModelId(e.target.value); setSelectedCharacterId(""); }}
                  className={`w-full appearance-none pl-3 pr-9 py-2.5 rounded-xl text-sm border outline-none ${inputBase}`}
                >
                  <option value="">— Choose a model —</option>
                  {aiModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${isDark ? "text-slate-400" : "text-slate-400"}`} />
              </div>
            </div>

            {selectedModelId && (
              <div>
                <label className={labelBase}>CHARACTER IDENTITY</label>
                {characters.length === 0 ? (
                  <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm ${isDark ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-600"}`}>
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    No ready character for this model. Train one in the Character tab.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {characters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCharacterId(c.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all
                          ${selectedCharacterId === c.id
                            ? "bg-violet-500/20 border-violet-500/50"
                            : isDark ? "bg-white/[0.03] border-white/[0.08] hover:border-white/20" : "bg-white border-black/10 hover:border-black/20"}`}
                      >
                        <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5 text-violet-400" />
                        </div>
                        <span className={`text-sm font-medium flex-1 ${isDark ? "text-white" : "text-slate-900"}`}>{c.name}</span>
                        {selectedCharacterId === c.id && <CheckCircle2 className="w-4 h-4 text-violet-400 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Prompt */}
      <div>
        <label className={labelBase}>PROMPT</label>
        <textarea
          rows={3}
          placeholder="Describe the scene — lighting, setting, mood, clothing…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className={`w-full px-3 py-2.5 rounded-xl text-sm border outline-none resize-none ${inputBase}`}
        />
      </div>

      {/* Aspect ratio */}
      <div>
        <label className={labelBase}>ASPECT RATIO</label>
        <div className="flex flex-wrap gap-2">
          {ASPECT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setAspect(opt.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                ${aspect === opt.id
                  ? "bg-violet-600 border-violet-500 text-white"
                  : isDark ? "bg-white/[0.04] border-white/[0.08] text-slate-400 hover:border-white/20 hover:text-slate-300" : "bg-white border-black/10 text-slate-500 hover:border-black/20"}`}
            >
              {opt.label}
              <span className={`ml-1 opacity-60`}>{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quantity */}
      <div>
        <label className={labelBase}>IMAGES</label>
        <div className={`flex rounded-xl p-1 border w-fit ${isDark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.07]"}`}>
          {[1, 2].map((n) => (
            <button
              key={n}
              onClick={() => setQty(n)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all
                ${qty === n
                  ? "bg-violet-600 text-white shadow-sm"
                  : isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Cost + Generate */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerate}
          disabled={generating || !hasEnough}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all
            ${!hasEnough
              ? "opacity-50 cursor-not-allowed bg-violet-600 text-white"
              : "bg-violet-600 hover:bg-violet-500 active:scale-[0.98] text-white shadow-lg shadow-violet-500/20"
            }`}
        >
          {generating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Generate</>
          )}
        </button>
        <div className={`flex items-center gap-1.5 px-3 py-3 rounded-xl border text-sm
          ${isDark ? "bg-white/[0.04] border-white/[0.08]" : "bg-white border-black/10"}`}>
          <Coins className="w-4 h-4 text-violet-400" />
          <span className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{cost}</span>
          <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>cr</span>
        </div>
      </div>

      {!hasEnough && (
        <p className="text-xs text-rose-400 -mt-2">
          Not enough credits — you need {cost} cr (you have {credits}).
        </p>
      )}

      {/* Results */}
      <AnimatePresence>
        {results.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className={labelBase + " mb-0"}>RESULTS</label>
              <button
                onClick={() => {
                  Object.keys(pollRefs.current).forEach(stopPoll);
                  setResults([]);
                }}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors
                  ${isDark ? "border-white/10 text-slate-400 hover:bg-white/[0.06]" : "border-black/10 text-slate-500 hover:bg-black/[0.04]"}`}
              >
                Clear
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {results.map((r) => (
                <div key={r.generationId}>
                  {r.status === "done" && r.imageUrl ? (
                    <ResultCard imageUrl={r.imageUrl} isDark={isDark} onDownload={handleDownload} />
                  ) : r.status === "failed" ? (
                    <div className={`aspect-[9/16] rounded-2xl border flex flex-col items-center justify-center gap-2
                      ${isDark ? "bg-rose-500/10 border-rose-500/20" : "bg-rose-50 border-rose-200"}`}>
                      <AlertCircle className="w-6 h-6 text-rose-400" />
                      <p className="text-xs text-rose-400">Failed</p>
                    </div>
                  ) : (
                    <div className={`aspect-[9/16] rounded-2xl border flex flex-col items-center justify-center gap-3
                      ${isDark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.06]"}`}>
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                          <Sparkles className="w-5 h-5 text-violet-400" />
                        </div>
                        <div className="absolute inset-0 rounded-full border-2 border-violet-500/40 border-t-transparent animate-spin" />
                      </div>
                      <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>Generating…</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main SoulXPage ────────────────────────────────────────────────────────────

export default function SoulXPage() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [activeTab, setActiveTab] = useState("generate");

  const cardBase = isDark
    ? "bg-[rgba(255,255,255,0.03)] border border-white/[0.07]"
    : "bg-white/60 border border-black/[0.06]";

  return (
    <div className={`min-h-full p-4 md:p-6 ${isDark ? "text-white" : "text-slate-900"}`}>
      <div className="max-w-xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/30 to-purple-600/20 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className={`text-xl font-bold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
              Soul-X
            </h1>
            <p className={`text-sm mt-0.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              High-realism image generation with optional character identity
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className={`flex rounded-2xl p-1 border ${isDark ? "bg-white/[0.03] border-white/[0.07]" : "bg-black/[0.02] border-black/[0.06]"}`}>
          {[
            { id: "generate", label: "Generate", icon: Sparkles },
            { id: "character", label: "Character", icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
                ${activeTab === id
                  ? isDark ? "bg-white/[0.09] text-white" : "bg-white text-slate-900 shadow-sm"
                  : isDark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className={`rounded-2xl border p-5 ${cardBase}`}>
          <AnimatePresence mode="wait">
            {activeTab === "generate" ? (
              <motion.div
                key="generate"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <GenerateTab isDark={isDark} />
              </motion.div>
            ) : (
              <motion.div
                key="character"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <CharacterTab isDark={isDark} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Credit info */}
        <div className={`rounded-xl border p-3 text-xs ${isDark ? "border-white/[0.07] bg-white/[0.02]" : "border-black/[0.06] bg-black/[0.02]"}`}>
          <p className={`font-semibold mb-1.5 ${isDark ? "text-slate-300" : "text-slate-700"}`}>Soul-X Pricing</p>
          <div className={`grid grid-cols-2 gap-x-4 gap-y-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <span>1 image — no character</span><span className="font-semibold text-violet-400">10 cr</span>
            <span>1 image — with character</span><span className="font-semibold text-violet-400">15 cr</span>
            <span>2 images — no character</span><span className="font-semibold text-violet-400">15 cr</span>
            <span>2 images — with character</span><span className="font-semibold text-violet-400">25 cr</span>
          </div>
        </div>
      </div>
    </div>
  );
}
