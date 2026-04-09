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

const LOCALE_STORAGE_KEY = "app_locale";
const DEFAULT_SOULX_PRICING = Object.freeze({
  noModel1: 10,
  withModel1: 15,
  noModel2: 15,
  withModel2: 25,
  extraStepsPer10: 5,
  trainingStandard: 750,
  trainingPro: 1500,
});
const DEFAULT_SOULX_TRAINING_PRICING = Object.freeze({
  trainingStandard: DEFAULT_SOULX_PRICING.trainingStandard,
  trainingPro: DEFAULT_SOULX_PRICING.trainingPro,
});
const DEFAULT_SOULX_LIMITS = Object.freeze({
  includedSteps: 20,
  includedStepsNoModel: 20,
  includedStepsWithModel: 50,
  maxSteps: 100,
  minCfg: 0,
  maxCfg: 6,
  defaultSteps: 20,
  defaultStepsNoModel: 20,
  defaultStepsWithModel: 50,
  defaultCfg: 2,
});
const SOULX_DEFAULT_CFG = 2;

const ASPECT_OPTIONS = [
  { id: "9:16", label: "9:16", hint: "Portrait" },
  { id: "1:1", label: "1:1", hint: "Square" },
  { id: "16:9", label: "16:9", hint: "Landscape" },
  { id: "3:4", label: "3:4", hint: "4:3 Portrait" },
  { id: "4:3", label: "4:3", hint: "Wide" },
];

function getModelPreview(model) {
  if (!model || typeof model !== "object") return "";
  return String(
    model.thumbnail
    || model.photo1Url
    || model.photoUrl
    || model.avatarUrl
    || model.coverUrl
    || "",
  ).trim();
}

function ModelGalleryPicker({
  models = [],
  value = "",
  onChange,
  emptyText = "No models found",
  isDark = true,
}) {
  if (!Array.isArray(models) || models.length === 0) {
    return (
      <div className={`rounded-xl border border-dashed px-3 py-3 text-xs ${isDark ? "border-white/10 text-slate-500" : "border-slate-200 text-slate-500"}`}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
      {models.map((m) => {
        const active = String(m.id) === String(value);
        const preview = getModelPreview(m);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange?.(m.id)}
            className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl border text-left transition-all ${
              active
                ? "bg-violet-600/20 border-violet-500/55 shadow-[0_0_10px_rgba(139,92,246,0.25)]"
                : "border-white/[0.10] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20"
            }`}
          >
            {preview ? (
              <img src={preview} alt="" className="w-10 h-10 rounded-lg object-cover border border-white/20 flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-lg border border-white/15 bg-white/[0.03] flex items-center justify-center flex-shrink-0">
                <ImageIcon className="w-4 h-4 text-slate-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>{m.name}</p>
              <p className={`text-[11px] truncate ${isDark ? "text-slate-400" : "text-slate-500"}`}>Tap to select</p>
            </div>
            {active && <CheckCircle2 className="w-4 h-4 text-violet-300 flex-shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

function ControlChip({ active, onClick, children, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-xs md:text-sm font-semibold border transition-all ${
        active
          ? "bg-violet-600/85 text-white border-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.35)]"
          : "text-slate-300 border-white/[0.10] bg-white/[0.02] hover:bg-white/[0.05] hover:text-white"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function authHeader() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getDefaultStepsForMode(mode, limits) {
  if (mode === "character") {
    return Number(limits?.defaultStepsWithModel ?? limits?.defaultSteps ?? 50);
  }
  return Number(limits?.defaultStepsNoModel ?? limits?.defaultSteps ?? 20);
}

function getIncludedStepsForMode(mode, limits) {
  if (mode === "character") {
    return Number(limits?.includedStepsWithModel ?? limits?.includedSteps ?? 50);
  }
  return Number(limits?.includedStepsNoModel ?? limits?.includedSteps ?? 20);
}

function resolveLocale() {
  try {
    const qsLang = new URLSearchParams(window.location.search).get("lang");
    const normalizedQs = String(qsLang || "").toLowerCase();
    if (normalizedQs === "ru" || normalizedQs === "en") return normalizedQs;
    const saved = String(localStorage.getItem(LOCALE_STORAGE_KEY) || "").toLowerCase();
    if (saved === "ru" || saved === "en") return saved;
    const browser = String(navigator.language || "").toLowerCase();
    return browser.startsWith("ru") ? "ru" : "en";
  } catch {
    return "en";
  }
}

const COPY = {
  en: {
    mode: "Mode",
    noCharacter: "No Character",
    useCharacter: "Use Character",
    model: "Model",
    characterIdentity: "Character Identity",
    noReadyLora: "No ready LoRA for this model. Train one in Character tab or use existing NSFW LoRA.",
    prompt: "Prompt",
    promptPlaceholder: "Describe the scene — lighting, setting, mood, clothing…",
    aspectRatio: "Aspect Ratio",
    images: "Images",
    advanced: "Advanced",
    steps: "Steps",
    cfg: "CFG",
    loraStrength: "LoRA intensity",
    generate: "Generate",
    generating: "Generating…",
    creditsMissing: "Not enough balance — you need",
    youHave: "you have",
    results: "Results",
    clear: "Clear",
    failed: "Failed",
    generatingShort: "Generating…",
    title: "Soul-X",
    subtitle: "Photoreal image generation with optional character identity locking",
    tabGenerate: "Generate",
    tabCharacter: "Character",
    pricingTitle: "Soul-X Pricing",
    p1: "1 image — no character",
    p2: "1 image — with character",
    p3: "2 images — no character",
    p4: "2 images — with character",
    p5: "Extra steps (every +10 over included)",
    p6: "Character training — Standard",
    p7: "Character training — Pro",
  },
  ru: {
    mode: "Режим",
    noCharacter: "Без персонажа",
    useCharacter: "С персонажем",
    model: "Модель",
    characterIdentity: "Идентичность персонажа",
    noReadyLora: "Для этой модели нет готовой LoRA. Обучите её во вкладке Character или используйте существующую NSFW LoRA.",
    prompt: "Промпт",
    promptPlaceholder: "Опишите сцену — свет, окружение, настроение, одежду…",
    aspectRatio: "Соотношение сторон",
    images: "Изображения",
    advanced: "Расширенные настройки",
    steps: "Шаги",
    cfg: "CFG",
    loraStrength: "Интенсивность LoRA",
    generate: "Сгенерировать",
    generating: "Генерация…",
    creditsMissing: "Недостаточно баланса — нужно",
    youHave: "у вас",
    results: "Результаты",
    clear: "Очистить",
    failed: "Ошибка",
    generatingShort: "Генерация…",
    title: "Soul-X",
    subtitle: "Фотореалистичная генерация с опциональной фиксацией идентичности персонажа",
    tabGenerate: "Генерация",
    tabCharacter: "Персонаж",
    pricingTitle: "Тарифы Soul-X",
    p1: "1 изображение — без персонажа",
    p2: "1 изображение — с персонажем",
    p3: "2 изображения — без персонажа",
    p4: "2 изображения — с персонажем",
    p5: "Доп. шаги (каждые +10 сверх включенных)",
    p6: "Обучение персонажа — Standard",
    p7: "Обучение персонажа — Pro",
  },
};

function useSoulXTrainingPricing() {
  const [trainingPricing, setTrainingPricing] = useState(DEFAULT_SOULX_TRAINING_PRICING);
  useEffect(() => {
    const token = localStorage.getItem("token");
    axios
      .get("/api/soulx/config", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.data?.success || !res.data.pricing) return;
        const p = res.data.pricing;
        const ts = Number(p.trainingStandard);
        const tp = Number(p.trainingPro);
        setTrainingPricing({
          trainingStandard:
            Number.isFinite(ts) && ts >= 0 ? ts : DEFAULT_SOULX_TRAINING_PRICING.trainingStandard,
          trainingPro: Number.isFinite(tp) && tp >= 0 ? tp : DEFAULT_SOULX_TRAINING_PRICING.trainingPro,
        });
      })
      .catch(() => {});
  }, []);
  return trainingPricing;
}

function ResultCard({ imageUrl, isDark, onDownload }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative rounded-2xl overflow-hidden border border-white/[0.10] glass-card"
    >
      <img src={imageUrl} alt="Soul-X generated" className="w-full h-auto block" />
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent flex justify-end">
        <button
          onClick={() => onDownload(imageUrl)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/35 hover:bg-black/50 text-white text-xs font-medium backdrop-blur-sm transition-colors border border-white/20"
        >
          <Download className="w-3.5 h-3.5" /> Download
        </button>
      </div>
    </motion.div>
  );
}

// ── Character Tab ─────────────────────────────────────────────────────────────

function CharacterTab({ isDark, trainingPricing }) {
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

  const allModels = Array.isArray(models) ? models : [];

  const fetchCharacter = useCallback(async (modelId) => {
    if (!modelId) { setCharacter(null); return; }
    setLoading(true);
    try {
      const res = await axios.get(`/api/soulx/characters/${modelId}`, { headers: authHeader() });
      const list = Array.isArray(res.data.characters) ? res.data.characters : [];
      // Character tab manages only dedicated Soul-X character records.
      const soulxChar = list.find((c) => c.category === "soulx") || null;
      setCharacter(soulxChar);
      if (soulxChar) {
        setUploadedImages(soulxChar.trainingImages || []);
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

  const base = "glass-card border border-white/[0.10]";
  const inputBase =
    "w-full appearance-none pl-3 pr-9 py-2.5 rounded-xl text-sm border outline-none glass-card border-white/[0.10] text-white focus:border-white/20";
  const neutralBtn = "border border-white/[0.10] text-slate-400 hover:text-white hover:border-white/20 hover:bg-white/[0.04]";

  const stdCredits = trainingPricing?.trainingStandard ?? DEFAULT_SOULX_TRAINING_PRICING.trainingStandard;
  const proCredits = trainingPricing?.trainingPro ?? DEFAULT_SOULX_TRAINING_PRICING.trainingPro;
  const createCost = trainingMode === "pro" ? proCredits : stdCredits;

  return (
    <div className="space-y-5">
      {/* Model picker */}
      <div>
        <label className={`block text-xs font-semibold mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Model
        </label>
        <ModelGalleryPicker
          models={allModels}
          value={selectedModelId}
          onChange={setSelectedModelId}
          emptyText="No models found"
          isDark={isDark}
        />
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
                  className="w-full px-3 py-2.5 rounded-xl text-sm border outline-none glass-card border-white/[0.10] text-white placeholder:text-slate-500 focus:border-white/20"
                />

                <div className="flex gap-2">
                  {["standard", "pro"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setTrainingMode(m)}
                      className={`flex-1 py-2 px-2 rounded-xl text-sm font-medium border transition-all flex flex-col items-center gap-0.5
                        ${trainingMode === m
                          ? "bg-violet-500/20 border-violet-500/50 text-violet-200 shadow-[0_0_0_1px_rgba(139,92,246,0.2)]"
                          : neutralBtn
                        }`}
                    >
                      <span>{m.charAt(0).toUpperCase() + m.slice(1)}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-300/95">
                        {m === "pro" ? proCredits : stdCredits}
                        <Coins className="w-3 h-3 opacity-90" />
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-violet-500/20"
                >
                  <span className="inline-flex items-center gap-2">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Character Identity
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/90">
                    {createCost}
                    <Coins className="w-3.5 h-3.5 opacity-90" />
                  </span>
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
                    Training Photos ({uploadedImages.length})
                  </span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || character.status === "training"}
                    className="text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 border-white/15 text-slate-300 hover:bg-white/[0.08]"
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
                      <div className="aspect-square rounded-lg flex items-center justify-center text-xs glass-card text-slate-400">
                        +{uploadedImages.length - 8}
                      </div>
                    )}
                  </div>
                )}
                {uploadedImages.length === 0 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-6 rounded-xl border-2 border-dashed text-sm transition-colors border-white/10 text-slate-500 hover:border-violet-500/40 hover:text-slate-300"
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
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-violet-500/20"
                >
                  <span className="inline-flex items-center gap-2">
                    {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {uploadedImages.length < 5
                      ? `Need ${5 - uploadedImages.length} more photos`
                      : (
                        <>
                          Start Training
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-white/95">
                            ·
                            {character.trainingMode === "pro" ? proCredits : stdCredits}
                            <Coins className="w-3.5 h-3.5" />
                          </span>
                        </>
                      )}
                  </span>
                </button>
              )}

              {character.status === "training" && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
                  <p className="text-xs text-amber-400">Training in progress — typically 10–20 minutes.</p>
                </div>
              )}

              {character.status === "ready" && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
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

function GenerateTab({ isDark, copy }) {
  const { user, refreshUserCredits } = useAuthStore();
  const { models } = useCachedModels();

  const [mode, setMode] = useState("without"); // "without" | "character"
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [characters, setCharacters] = useState([]);
  const [aspect, setAspect] = useState("9:16");
  const [qty, setQty] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(DEFAULT_SOULX_LIMITS.defaultStepsNoModel);
  const [cfg, setCfg] = useState(SOULX_DEFAULT_CFG);
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [submitInFlight, setSubmitInFlight] = useState(0);
  const [results, setResults] = useState([]); // [{generationId, imageUrl, status}]
  const [pricing, setPricing] = useState(DEFAULT_SOULX_PRICING);
  const [limits, setLimits] = useState(DEFAULT_SOULX_LIMITS);
  const pollRefs = useRef({});

  const allModels = Array.isArray(models) ? models : [];

  const credits = (user?.credits ?? 0) + (user?.bonusCredits ?? 0);
  const baseCost = qty === 2
    ? (mode === "character" ? pricing.withModel2 : pricing.noModel2)
    : (mode === "character" ? pricing.withModel1 : pricing.noModel1);
  const includedStepsForPricing = getIncludedStepsForMode(mode, limits);
  const extraBlocks = steps > includedStepsForPricing ? Math.ceil((steps - includedStepsForPricing) / 10) : 0;
  const extraCost = extraBlocks * pricing.extraStepsPer10 * qty;
  const cost = baseCost + extraCost;
  const hasEnough = credits >= cost;

  useEffect(() => {
    const token = localStorage.getItem("token");
    axios.get("/api/soulx/config", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (res.data?.success) {
          if (res.data.pricing) setPricing({ ...DEFAULT_SOULX_PRICING, ...res.data.pricing });
          if (res.data.limits) {
            const nextLimits = { ...DEFAULT_SOULX_LIMITS, ...res.data.limits };
            setLimits(nextLimits);
            const suggestedCfg = Number(res.data.limits.defaultCfg ?? SOULX_DEFAULT_CFG);
            setCfg((prev) => {
              if (prev !== SOULX_DEFAULT_CFG) return prev;
              const parsed = Number.isFinite(suggestedCfg) ? suggestedCfg : SOULX_DEFAULT_CFG;
              return Math.max(nextLimits.minCfg, Math.min(nextLimits.maxCfg, parsed));
            });
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const suggested = getDefaultStepsForMode(mode, limits);
    const safe = Math.max(1, Math.min(limits.maxSteps, Math.round(suggested) || 20));
    setSteps(safe);
  }, [mode, limits]);

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
    if (!hasEnough) { toast.error("Insufficient balance"); return; }

    setSubmitInFlight((n) => n + 1);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.post("/api/soulx/generate", {
        prompt: prompt.trim(),
        modelId: mode === "character" ? selectedModelId : null,
        characterLoraId: mode === "character" ? selectedCharacterId : null,
        aspectRatio: aspect,
        quantity: qty,
        steps,
        cfg,
        loraStrength: mode === "character" ? loraStrength : undefined,
      }, { headers: { Authorization: `Bearer ${token}` } });

      let generationIds = Array.isArray(res.data?.generationIds) ? res.data.generationIds : [];
      if (!generationIds.length) {
        // Sometimes upstream/proxy returns 200 with an empty/partial body.
        // Try to recover by finding a very recent Soul-X generation in processing.
        try {
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
          generationIds = recovered?.id ? [recovered.id] : [];
        } catch {
          generationIds = [];
        }
      }
      if (!generationIds.length) {
        toast.error(res.data?.error || "Submission unstable. Please retry once.");
        return;
      }
      const newResults = generationIds.map((id) => ({ generationId: id, status: "processing", imageUrl: null }));
      setResults((prev) => [...newResults, ...prev]);
      generationIds.forEach(startPoll);

      // Sync credit balance from backend after successful submission.
      refreshUserCredits();
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
      setSubmitInFlight((n) => Math.max(0, n - 1));
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

  const inputBase = "glass-card border border-white/[0.10] text-white placeholder-slate-400 focus:border-white/20";

  const labelBase = `block text-xs font-semibold mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`;

  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="rounded-2xl border p-3.5 md:p-4 glass-card border-white/[0.10]">
        <label className={labelBase}>{copy.mode}</label>
        <div className="flex flex-wrap gap-2">
          {[
            { id: "without", label: copy.noCharacter, icon: ImageIcon },
            { id: "character", label: copy.useCharacter, icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <ControlChip
              key={id}
              onClick={() => setMode(id)}
              active={mode === id}
              className="flex-1 inline-flex items-center justify-center gap-1.5"
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </ControlChip>
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
              <label className={labelBase}>{copy.model}</label>
              <ModelGalleryPicker
                models={allModels}
                value={selectedModelId}
                onChange={(id) => {
                  setSelectedModelId(id);
                  setSelectedCharacterId("");
                }}
                emptyText="No models found"
                isDark={isDark}
              />
            </div>

            {selectedModelId && (
              <div>
                <label className={labelBase}>{copy.characterIdentity}</label>
                {characters.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm bg-amber-500/10 border-amber-500/25 text-amber-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {copy.noReadyLora}
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
                            : "glass-card border border-white/[0.10] hover:border-white/20"}`}
                      >
                        <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5 text-violet-400" />
                        </div>
                        <span className={`text-sm font-medium flex-1 ${isDark ? "text-white" : "text-slate-900"}`}>{c.name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            c.category === "nsfw"
                              ? (isDark ? "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10" : "text-fuchsia-700 border-fuchsia-300 bg-fuchsia-50")
                              : (isDark ? "text-violet-300 border-violet-500/30 bg-violet-500/10" : "text-violet-700 border-violet-300 bg-violet-50")
                          }`}
                        >
                          {c.category === "nsfw" ? "NSFW LoRA" : "Soul-X LoRA"}
                        </span>
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
      <div className="rounded-2xl border p-3.5 md:p-4 glass-card border-white/[0.10]">
        <label className={labelBase}>{copy.prompt}</label>
        <textarea
          rows={3}
          placeholder={copy.promptPlaceholder}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className={`w-full px-3 py-2.5 rounded-xl text-sm border outline-none resize-none ${inputBase}`}
        />
      </div>

      {/* Aspect ratio */}
      <div className="rounded-2xl border p-3.5 md:p-4 glass-card border-white/[0.10]">
        <label className={labelBase}>{copy.aspectRatio}</label>
        <div className="flex flex-wrap gap-2">
          {ASPECT_OPTIONS.map((opt) => (
            <ControlChip
              key={opt.id}
              onClick={() => setAspect(opt.id)}
              active={aspect === opt.id}
            >
              {opt.label}
              <span className={`ml-1 opacity-60`}>{opt.hint}</span>
            </ControlChip>
          ))}
        </div>
      </div>

      {/* Quantity */}
      <div className="rounded-2xl border p-3.5 md:p-4 glass-card border-white/[0.10]">
        <label className={labelBase}>{copy.images}</label>
        <div className="flex gap-2">
          {[1, 2].map((n) => (
            <ControlChip
              key={n}
              onClick={() => setQty(n)}
              active={qty === n}
              className="min-w-12"
            >
              {n}
            </ControlChip>
          ))}
        </div>
      </div>

      <div className="rounded-xl border p-3 space-y-3 glass-card border-white/[0.10]">
        <p className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>{copy.advanced}</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>{copy.steps}</span>
            <input
              type="range"
              min={1}
              max={limits.maxSteps}
              step={1}
              value={steps}
              onChange={(e) =>
                setSteps(
                  Math.max(
                    1,
                    Math.min(
                      limits.maxSteps,
                      Number(e.target.value) || getDefaultStepsForMode(mode, limits),
                    ),
                  ),
                )
              }
            />
            <span className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>{steps}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>{copy.cfg}</span>
            <input
              type="range"
              min={limits.minCfg}
              max={limits.maxCfg}
              step={0.1}
              value={cfg}
              onChange={(e) => setCfg(Math.max(limits.minCfg, Math.min(limits.maxCfg, Number(e.target.value) || SOULX_DEFAULT_CFG)))}
            />
            <span className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>{cfg.toFixed(1)}</span>
          </label>
          <label className={`flex flex-col gap-1.5 ${mode !== "character" ? "opacity-50" : ""}`}>
            <span className={`text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>{copy.loraStrength}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={loraStrength}
              disabled={mode !== "character"}
              onChange={(e) => setLoraStrength(Math.max(0, Math.min(1, Number(e.target.value) || 0.8)))}
            />
            <span className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>{loraStrength.toFixed(2)}</span>
          </label>
        </div>
      </div>

      {/* Cost + Generate */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerate}
          disabled={!hasEnough}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all
            ${!hasEnough
              ? "opacity-50 cursor-not-allowed bg-violet-600 text-white"
              : "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:brightness-110 active:scale-[0.98] text-white shadow-lg shadow-violet-500/20"
            }`}
        >
          {submitInFlight > 0 ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {copy.generating}</>
          ) : (
            <><Sparkles className="w-4 h-4" /> {copy.generate}</>
          )}
        </button>
        <div className="flex items-center gap-1.5 px-3 py-3 rounded-xl border text-sm glass-card border-white/[0.10]">
          <Coins className="w-4 h-4 text-violet-400" />
          <span className={`font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{cost}</span>
          {extraCost > 0 && (
            <span className={`text-[11px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>+{extraCost} <Coins className="w-3 h-3 inline" /></span>
          )}
        </div>
      </div>

      {!hasEnough && (
        <p className="text-xs text-rose-400 -mt-2">
          {copy.creditsMissing} {cost} <Coins className="w-3 h-3 inline" /> ({copy.youHave} {credits} <Coins className="w-3 h-3 inline" />).
        </p>
      )}

      {/* Results */}
      <AnimatePresence>
        {results.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className={labelBase + " mb-0"}>{copy.results.toUpperCase()}</label>
              <button
                onClick={() => {
                  Object.keys(pollRefs.current).forEach(stopPoll);
                  setResults([]);
                }}
                className="text-xs px-2.5 py-1 rounded-lg border transition-colors border-white/10 text-slate-400 hover:bg-white/[0.06]"
              >
                {copy.clear}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {results.map((r) => (
                <div key={r.generationId}>
                  {r.status === "done" && r.imageUrl ? (
                    <ResultCard imageUrl={r.imageUrl} isDark={isDark} onDownload={handleDownload} />
                  ) : r.status === "failed" ? (
                    <div className="aspect-[9/16] rounded-2xl border flex flex-col items-center justify-center gap-2 bg-rose-500/10 border-rose-500/20">
                      <AlertCircle className="w-6 h-6 text-rose-400" />
                      <p className="text-xs text-rose-400">{copy.failed}</p>
                    </div>
                  ) : (
                    <div className="aspect-[9/16] rounded-2xl border flex flex-col items-center justify-center gap-3 glass-card border-white/[0.10]">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                          <Sparkles className="w-5 h-5 text-violet-400" />
                        </div>
                        <div className="absolute inset-0 rounded-full border-2 border-violet-500/40 border-t-transparent animate-spin" />
                      </div>
                      <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>{copy.generatingShort}</p>
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
  const locale = resolveLocale();
  const copy = COPY[locale] || COPY.en;
  const [activeTab, setActiveTab] = useState("generate");
  const trainingPricing = useSoulXTrainingPricing();

  const cardBase = "glass-card border border-white/[0.10]";

  return (
    <div className={`min-h-full p-4 md:p-6 ${isDark ? "text-white" : "text-slate-900"}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="rounded-2xl border p-5 md:p-6 flex items-start gap-4 glass-card border-white/[0.10]">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/30 to-fuchsia-600/20 border border-violet-500/25 flex items-center justify-center flex-shrink-0 shadow-[0_0_24px_rgba(139,92,246,0.25)]">
            <Sparkles className="w-5 h-5 text-violet-400" />
          </div>
          <div className="flex-1">
            <h1 className={`text-2xl md:text-3xl font-bold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
              {copy.title}
            </h1>
            <p className={`text-sm md:text-base mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {copy.subtitle}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-2xl p-1 border glass-card border-white/[0.10] max-w-md">
          {[
            { id: "generate", label: copy.tabGenerate, icon: Sparkles },
            { id: "character", label: copy.tabCharacter, icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
                ${activeTab === id
                  ? "bg-violet-600/80 text-white shadow-[0_0_10px_rgba(139,92,246,0.35)]"
                  : "text-slate-400 hover:text-white hover:bg-white/[0.04]"}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className={`rounded-2xl border p-5 md:p-6 ${cardBase}`}>
          <AnimatePresence mode="wait">
            {activeTab === "generate" ? (
              <motion.div
                key="generate"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <GenerateTab isDark={isDark} copy={copy} />
              </motion.div>
            ) : (
              <motion.div
                key="character"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <CharacterTab isDark={isDark} trainingPricing={trainingPricing} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Credit info */}
        <div className="rounded-xl border p-4 text-xs glass-card border-white/[0.10]">
          <p className={`font-semibold mb-1.5 ${isDark ? "text-slate-300" : "text-slate-700"}`}>{copy.pricingTitle}</p>
          <div className={`grid grid-cols-2 gap-x-4 gap-y-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            <span>{copy.p1}</span><span className="font-semibold text-violet-400 inline-flex items-center gap-1">10 <Coins className="w-3 h-3" /></span>
            <span>{copy.p2}</span><span className="font-semibold text-violet-400 inline-flex items-center gap-1">15 <Coins className="w-3 h-3" /></span>
            <span>{copy.p3}</span><span className="font-semibold text-violet-400 inline-flex items-center gap-1">15 <Coins className="w-3 h-3" /></span>
            <span>{copy.p4}</span><span className="font-semibold text-violet-400 inline-flex items-center gap-1">25 <Coins className="w-3 h-3" /></span>
            <span>{copy.p5}</span><span className="font-semibold text-violet-400 inline-flex items-center gap-1">5 <Coins className="w-3 h-3" /></span>
            <span>{copy.p6}</span><span className="font-semibold text-violet-400 inline-flex items-center gap-1">{trainingPricing.trainingStandard} <Coins className="w-3 h-3" /></span>
            <span>{copy.p7}</span><span className="font-semibold text-violet-400 inline-flex items-center gap-1">{trainingPricing.trainingPro} <Coins className="w-3 h-3" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}
