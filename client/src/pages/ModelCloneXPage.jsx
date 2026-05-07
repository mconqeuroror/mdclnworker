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
  Check,
} from "lucide-react";
import toast from "react-hot-toast";
import api, { formatApiError } from "../services/api.js";
import { downloadFromPublicUrl } from "../utils/directDownload";
import { useAuthStore } from "../store";
import { useTheme } from "../hooks/useTheme.jsx";
import { useCachedModels } from "../hooks/useCachedModels";

// Light DB checks until backend status returns completed output URLs.
const POLL_INTERVAL_MS = 5000;

const LOCALE_STORAGE_KEY = "app_locale";
const DEFAULT_MODELCLONE_X_PRICING = Object.freeze({
  noModel1: 10,
  withModel1: 15,
  noModel2: 15,
  withModel2: 25,
  extraStepsPer10: 5,
  trainingStandard: 750,
  trainingPro: 1500,
});
const DEFAULT_MODELCLONE_X_LIMITS = Object.freeze({
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
  trainingImagesStandard: 15,
  trainingImagesPro: 30,
});
const MODELCLONE_X_DEFAULT_CFG = 2;

const ASPECT_OPTIONS = [
  { id: "9:16", label: "9:16", hint: "Portrait" },
  { id: "1:1", label: "1:1", hint: "Square" },
  { id: "16:9", label: "16:9", hint: "Landscape" },
  { id: "3:4", label: "3:4", hint: "4:3 Portrait" },
  { id: "4:3", label: "4:3", hint: "Wide" },
];

/** Rounded surface for small icon callouts (theme tokens, no heavy glow) */
const accentIconClassName = (size = "w-9 h-9") =>
  `${size} rounded-xl flex items-center justify-center border border-[var(--border-medium)] bg-[var(--accent-soft)] shrink-0`;

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
      <div
        className={`rounded-xl border border-dashed px-3 py-3 text-xs ${isDark ? "border-white/10 text-slate-500" : "border-slate-300/80 text-slate-500"}`}
      >
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
                ? isDark
                  ? "bg-[var(--accent-soft)] border-[var(--border-strong)]"
                  : "bg-[var(--accent-soft)] border-[var(--border-medium)]"
                : isDark
                  ? "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15"
                  : "border-slate-200/90 bg-white/80 hover:bg-slate-50 hover:border-slate-300"
            }`}
          >
            {preview ? (
              <img
                src={preview}
                alt=""
                className={`w-10 h-10 rounded-lg object-cover flex-shrink-0 ${isDark ? "border border-white/15" : "border border-slate-200"}`}
              />
            ) : (
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? "border border-white/12 bg-white/[0.03]" : "border border-slate-200 bg-slate-50"}`}
              >
                <ImageIcon className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>{m.name}</p>
              <p className={`text-[11px] truncate ${isDark ? "text-slate-500" : "text-slate-500"}`}>Tap to select</p>
            </div>
            {active && (
              <CheckCircle2 className={`w-4 h-4 flex-shrink-0 text-[var(--accent)]`} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function ControlChip({ active, onClick, children, className = "", isDark = true }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-xs md:text-sm font-medium border transition-all ${
        active
          ? isDark
            ? "text-[var(--text-primary)] border-[var(--border-medium)] bg-[var(--accent-soft)]"
            : "text-[var(--text-primary)] border-[var(--border-medium)] bg-[var(--accent-soft)]"
          : isDark
            ? "text-slate-300 border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:text-white"
            : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
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
    additionalPrompt: "Optional notes for Grok",
    additionalPromptHint: "Optional extra instructions for the background photo-to-prompt process.",
    buildPrompt: "Build prompt from photo",
    buildingPrompt: "Building prompt…",
    builtPromptLabel: "Your prompt (ready — edit if you want, then use Generate below)",
    buildPromptFirst: "Add a source image first.",
    buildNeedImage: "Add a photo first",
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
    title: "ModelClone-X",
    subtitle: "Photoreal image generation with optional character identity locking",
    serverPhotoPromptMissing:
      "Photo-to-prompt isn’t available on this deployment. Use a text prompt or try again later.",
    serverRunpodMissing:
      "Image generation isn’t fully available on this deployment. Please try again later or contact support.",
    tabGenerate: "Generate",
    tabCharacter: "Character",
    pricingTitle: "ModelClone-X Pricing",
    p1: "1 image — no character",
    p2: "1 image — with character",
    p3: "2 images — no character",
    p4: "2 images — with character",
    p5: "Extra steps (every +10 over included)",
    p6: "Character training — Standard",
    p7: "Character training — Pro",
    genType: "Output",
    outputTxt: "Text → image",
    outputImg: "Image → image",
    refImage: "Source image",
    refImageHint:
      "Image → image is available only in “Use Character” mode.",
    refImageHintCharImg: "Select model + character, add source image, then Generate. Prompt conversion runs automatically in the background.",
    adminRunpodImg2Img: "Admin: reference img2img (photo + prompt)",
    adminRunpodImg2ImgHint:
      "Uses the Z-Image img2img workflow with your character LoRA. Admin-only while testing.",
    adminRunpodImg2ImgNeedCharacter: "Reference img2img needs “Use Character” with a ready identity.",
    aspectNoteFromImage: "Reference img2img uses the source photo + character LoRA workflow; quantity is limited to 1 image.",
    aspectNoteImg2ImgAdmin:
      "Reference img2img uses the Z-Image workflow’s own canvas — aspect ratio below may not match text-only behavior.",
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
    additionalPrompt: "Заметки для Grok (по желанию)",
    additionalPromptHint: "Необязательные дополнительные инструкции для фонового преобразования фото в промпт.",
    buildPrompt: "Собрать промпт с фото",
    buildingPrompt: "Собираю промпт…",
    builtPromptLabel: "Промпт (готово — при необходимости отредактируйте, затем «Сгенерировать»)",
    buildPromptFirst: "Сначала добавьте исходное изображение.",
    buildNeedImage: "Сначала загрузите фото",
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
    title: "ModelClone-X",
    subtitle: "Фотореалистичная генерация с опциональной фиксацией идентичности персонажа",
    serverPhotoPromptMissing:
      "Сбор промпта по фото недоступен на этом развёртывании. Используйте текстовый промпт или попробуйте позже.",
    serverRunpodMissing:
      "Генерация изображений сейчас недоступна на этом развёртывании. Попробуйте позже или обратитесь в поддержку.",
    tabGenerate: "Генерация",
    tabCharacter: "Персонаж",
    pricingTitle: "Тарифы ModelClone-X",
    p1: "1 изображение — без персонажа",
    p2: "1 изображение — с персонажем",
    p3: "2 изображения — без персонажа",
    p4: "2 изображения — с персонажем",
    p5: "Доп. шаги (каждые +10 сверх включенных)",
    p6: "Обучение персонажа — Standard",
    p7: "Обучение персонажа — Pro",
    genType: "Вывод",
    outputTxt: "Текст → изображение",
    outputImg: "Изображение → изображение",
    refImage: "Исходное фото",
    refImageHint:
      "Режим Image → image доступен только в режиме «С персонажем».",
    refImageHintCharImg: "Выберите модель + персонажа, добавьте исходное фото и нажмите «Сгенерировать». Промпт собирается автоматически в фоне.",
    adminRunpodImg2Img: "Админ: img2img по референсу (фото + промпт)",
    adminRunpodImg2ImgHint:
      "Граф Z-Image img2img с LoRA персонажа. Видно только админам на время теста.",
    adminRunpodImg2ImgNeedCharacter: "Нужен режим «С персонажем» и готовая идентичность.",
    aspectNoteFromImage:
      "Для reference img2img используется workflow с исходным фото и LoRA персонажа; доступна только 1 картинка за запуск.",
    aspectNoteImg2ImgAdmin:
      "Референсный img2img использует свой холст Z-Image — соотношение сторон может отличаться от текстового режима.",
  },
};

function useModelCloneXPricing() {
  const [pricing, setPricing] = useState(DEFAULT_MODELCLONE_X_PRICING);
  useEffect(() => {
    const token = localStorage.getItem("token");
    api
      .get("modelclone-x/config", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.data?.success || !res.data.pricing) return;
        const p = res.data.pricing;
        setPricing({ ...DEFAULT_MODELCLONE_X_PRICING, ...p });
      })
      .catch(() => {});
  }, []);
  return pricing;
}

function ResultCard({ imageUrl, isDark, onDownload }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative rounded-2xl overflow-hidden ${
        isDark ? "border border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.35)]" : "border border-slate-200/90 shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
      }`}
      style={{ background: isDark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.95)" }}
    >
      <img src={imageUrl} alt="" className="w-full h-auto block" />
      <div className="absolute bottom-0 left-0 right-0 p-3 flex justify-end bg-gradient-to-t from-black/55 to-transparent">
        <button
          type="button"
          onClick={() => onDownload(imageUrl)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: "rgba(124,58,237,0.9)",
            boxShadow: "0 4px 12px rgba(124,58,237,0.35)",
          }}
        >
          <Download className="w-3.5 h-3.5" /> Download
        </button>
      </div>
    </motion.div>
  );
}

// ── Character Tab ─────────────────────────────────────────────────────────────

function CharacterTab({ isDark, pricing }) {
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
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolImages, setPoolImages] = useState([]);
  const [selectedPoolImages, setSelectedPoolImages] = useState([]);
  const [assigningSet, setAssigningSet] = useState(false);
  const fileInputRef = useRef(null);

  const allModels = Array.isArray(models) ? models : [];

  const fetchCharacter = useCallback(async (modelId) => {
    if (!modelId) { setCharacter(null); return; }
    setLoading(true);
    try {
      const res = await api.get(`modelclone-x/characters/${modelId}`, { headers: authHeader() });
      const list = Array.isArray(res.data.characters) ? res.data.characters : [];
      // Character tab manages only dedicated ModelClone-X character records.
      const mcxChar =
        list.find((c) => c.category === "modelclone-x" || c.category === "soulx") || null;
      setCharacter(mcxChar);
      if (mcxChar) {
        setUploadedImages(mcxChar.trainingImages || []);
        return;
      }
      setUploadedImages([]);
    } catch {
      setCharacter(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCharacter(selectedModelId);
  }, [selectedModelId, fetchCharacter]);

  const fetchTrainingPool = useCallback(async (modelId, loraId) => {
    if (!modelId || !loraId) {
      setPoolImages([]);
      setSelectedPoolImages([]);
      return;
    }
    setPoolLoading(true);
    try {
      const res = await api.get(`modelclone-x/character/training-pool/${modelId}`, {
        params: { loraId },
        headers: authHeader(),
      });
      const gallery = Array.isArray(res.data?.galleryImages) ? res.data.galleryImages : [];
      const trainingImages = Array.isArray(res.data?.trainingImages) ? res.data.trainingImages : [];

      const seen = new Set();
      const merged = [];
      for (const item of gallery) {
        const url = typeof item?.outputUrl === "string" ? item.outputUrl.trim() : "";
        if (!url || seen.has(url)) continue;
        seen.add(url);
        merged.push({
          id: item.id || `${item.generationId}-${merged.length}`,
          outputUrl: url,
          generationId: item.generationId || null,
        });
      }
      for (const item of trainingImages) {
        const url = typeof item?.imageUrl === "string" ? item.imageUrl.trim() : "";
        if (!url || seen.has(url)) continue;
        seen.add(url);
        merged.push({
          id: item.id || `training-${merged.length}`,
          outputUrl: url,
          generationId: item.generationId || null,
          customImageId: item.id || null,
          _training: true,
        });
      }
      setPoolImages(merged);

      const selected = trainingImages
        .map((item) => {
          const url = typeof item?.imageUrl === "string" ? item.imageUrl.trim() : "";
          if (!url) return null;
          const match = merged.find((m) => m.outputUrl === url);
          return match || {
            id: item.id || `training-selected-${url}`,
            outputUrl: url,
            generationId: item.generationId || null,
            customImageId: item.id || null,
            _training: true,
          };
        })
        .filter(Boolean);
      setSelectedPoolImages(selected);
    } catch {
      setPoolImages([]);
      setSelectedPoolImages([]);
    } finally {
      setPoolLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrainingPool(selectedModelId, character?.id);
  }, [selectedModelId, character?.id, fetchTrainingPool]);

  const handleCreate = async () => {
    if (!selectedModelId) { toast.error("Select a model first"); return; }
    setCreating(true);
    try {
      const res = await api.post("modelclone-x/character/create", {
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
    formData.append("replaceExistingCustom", "false");
    try {
      const res = await api.post("modelclone-x/character/upload-images", formData, {
        headers: { ...authHeader(), "Content-Type": "multipart/form-data" },
      });
      const uploadedCount = Number(res.data?.uploadedCount || 0);
      const trimmed = Number(res.data?.trimmed || 0);
      if (trimmed > 0) {
        toast(`Uploaded ${uploadedCount} photo(s). ${trimmed} skipped (tier limit reached).`, { icon: "⚠️" });
      } else {
        toast.success(`${uploadedCount} photos uploaded`);
      }
      fetchCharacter(selectedModelId);
      fetchTrainingPool(selectedModelId, character.id);
    } catch (err) {
      toast.error(err.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const togglePoolImage = (image) => {
    const required = activeRequiredTrainingImages;
    const exists = selectedPoolImages.some((item) => item.id === image.id);
    if (exists) {
      setSelectedPoolImages((prev) => prev.filter((item) => item.id !== image.id));
      return;
    }
    if (selectedPoolImages.length >= required) {
      toast.error(`Maximum ${required} images for this tier`);
      return;
    }
    setSelectedPoolImages((prev) => [...prev, image]);
  };

  const handleApplySelectedSet = async () => {
    if (!character) return;
    if (selectedPoolImages.length !== activeRequiredTrainingImages) {
      toast.error(`Select exactly ${activeRequiredTrainingImages} images`);
      return;
    }
    setAssigningSet(true);
    try {
      await api.post(
        "modelclone-x/character/assign-images",
        {
          modelId: selectedModelId,
          loraId: character.id,
          images: selectedPoolImages.map((img) => ({
            generationId: img.generationId || undefined,
            customImageId: img.customImageId || undefined,
            outputUrl: img.outputUrl,
          })),
        },
        { headers: authHeader() },
      );
      toast.success("Training set updated");
      await fetchCharacter(selectedModelId);
      await fetchTrainingPool(selectedModelId, character.id);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save selected set");
    } finally {
      setAssigningSet(false);
    }
  };

  const handleTrain = async () => {
    if (!character) return;
    setTraining(true);
    try {
      await api.post("modelclone-x/character/train", {
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
      await api.delete(`modelclone-x/character/${character.id}`, { headers: authHeader() });
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

  const base = isDark ? "glass-card border border-white/[0.08]" : "bg-white/90 border border-slate-200/90 shadow-sm";
  const inputBase = isDark
    ? "w-full px-3 py-2.5 rounded-xl text-sm border outline-none glass-card border-white/[0.10] text-white placeholder:text-slate-500 focus:border-white/25"
    : "w-full px-3 py-2.5 rounded-xl text-sm border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-soft)]";
  const neutralBtn = isDark
    ? "border border-white/[0.10] text-slate-400 hover:text-white hover:border-white/18 hover:bg-white/[0.04]"
    : "border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300";

  const stdCredits = pricing?.trainingStandard ?? DEFAULT_MODELCLONE_X_PRICING.trainingStandard;
  const proCredits = pricing?.trainingPro ?? DEFAULT_MODELCLONE_X_PRICING.trainingPro;
  const createCost = trainingMode === "pro" ? proCredits : stdCredits;
  const activeRequiredTrainingImages =
    character?.trainingMode === "pro"
      ? DEFAULT_MODELCLONE_X_LIMITS.trainingImagesPro
      : DEFAULT_MODELCLONE_X_LIMITS.trainingImagesStandard;

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
                <div className={accentIconClassName()}>
                  <User className="w-4 h-4 text-[var(--accent)]" />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                    Create Character Identity
                  </p>
                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    One character per model — used for consistent ModelClone-X generations
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Character name (optional)"
                  value={charName}
                  onChange={(e) => setCharName(e.target.value)}
                  className={inputBase}
                />

                <div className="flex gap-2">
                  {["standard", "pro"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setTrainingMode(m)}
                      className={`flex-1 py-2 px-2 rounded-xl text-sm font-medium border transition-all flex flex-col items-center gap-0.5
                        ${trainingMode === m
                          ? "bg-[var(--accent-soft)] border-[var(--border-medium)] text-[var(--text-primary)] shadow-none"
                          : neutralBtn
                        }`}
                    >
                      <span>{m.charAt(0).toUpperCase() + m.slice(1)}</span>
                      <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        {m === "pro" ? "30 photos" : "15 photos"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--accent)]">
                        {m === "pro" ? proCredits : stdCredits}
                        <Coins className="w-3 h-3 opacity-90" />
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="btn-accent w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="inline-flex items-center gap-2">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Character Identity
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-foreground)]/90">
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
                  <div className={accentIconClassName()}>
                    <User className="w-4 h-4 text-[var(--accent)]" />
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
                    Training Photos ({uploadedImages.length}/{activeRequiredTrainingImages})
                  </span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || character.status === "training"}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 ${
                      isDark
                        ? "border-white/15 text-slate-300 hover:bg-white/[0.08]"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
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
                    className={`w-full py-6 rounded-xl border-2 border-dashed text-sm transition-colors ${
                      isDark
                        ? "border-white/10 text-slate-500 hover:border-[var(--border-strong)] hover:text-slate-300"
                        : "border-slate-200 text-slate-500 hover:border-[var(--border-medium)] hover:text-slate-700"
                    }`}
                  >
                    <Upload className="w-5 h-5 mx-auto mb-1.5 opacity-50" />
                    Upload training photos
                  </button>
                )}
              </div>

              {/* NSFW-style training pool selection */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    Select Training Set ({selectedPoolImages.length}/{activeRequiredTrainingImages})
                  </span>
                  <button
                    type="button"
                    onClick={handleApplySelectedSet}
                    disabled={assigningSet || selectedPoolImages.length !== activeRequiredTrainingImages}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 ${
                      isDark
                        ? "border-white/15 text-slate-300 hover:bg-white/[0.08]"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {assigningSet ? "Saving…" : "Use selected set"}
                  </button>
                </div>
                {poolLoading ? (
                  <div className="flex items-center gap-2 py-2 text-slate-400 text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading image pool…
                  </div>
                ) : poolImages.length > 0 ? (
                  <div className="grid grid-cols-4 gap-1.5">
                    {poolImages.slice(0, 24).map((img) => {
                      const active = selectedPoolImages.some((x) => x.id === img.id);
                      return (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => togglePoolImage(img)}
                          className={`relative aspect-square rounded-lg overflow-hidden border transition-all ${
                            active
                              ? "border-emerald-400 ring-1 ring-emerald-400/60"
                              : (isDark ? "border-white/10 hover:border-white/25" : "border-slate-200 hover:border-slate-300")
                          }`}
                        >
                          <img src={img.outputUrl} alt="" className="w-full h-full object-cover" />
                          {active && (
                            <div className="absolute top-1 right-1">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                    No model images in pool yet. Upload custom photos or generate more images first.
                  </p>
                )}
              </div>

              {/* Train button */}
              {character.status !== "ready" && character.status !== "training" && (
                <button
                  type="button"
                  onClick={handleTrain}
                  disabled={training || uploadedImages.length < activeRequiredTrainingImages}
                  className="btn-accent w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="inline-flex items-center gap-2">
                    {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {uploadedImages.length < activeRequiredTrainingImages
                      ? `Need ${activeRequiredTrainingImages - uploadedImages.length} more photos`
                      : (
                        <>
                          Start Training
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--accent-foreground)]/95">
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
                  <p className="text-xs text-amber-400">
                    Training in progress — typically {character.trainingMode === "pro" ? "about 2 hours" : "about 1 hour"}.
                  </p>
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
  /** "txt" = text-to-image; "img" = i2i (Grok JSON + same MCX optimizer as txt) */
  const [genMode, setGenMode] = useState("txt");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [characters, setCharacters] = useState([]);
  const [aspect, setAspect] = useState("9:16");
  const [qty, setQty] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(DEFAULT_MODELCLONE_X_LIMITS.defaultStepsNoModel);
  const [cfg, setCfg] = useState(MODELCLONE_X_DEFAULT_CFG);
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [refImageBase64, setRefImageBase64] = useState(""); // raw base64, no data: prefix
  const [refImagePreview, setRefImagePreview] = useState("");
  const [refImageDragOver, setRefImageDragOver] = useState(false);
  const refFileInputRef = useRef(null);
  const [submitInFlight, setSubmitInFlight] = useState(0);
  const [results, setResults] = useState([]); // [{generationId, imageUrl, status}]
  const [pricing, setPricing] = useState(DEFAULT_MODELCLONE_X_PRICING);
  const [limits, setLimits] = useState(DEFAULT_MODELCLONE_X_LIMITS);
  const [mcxServerEnv, setMcxServerEnv] = useState(null);
  const pollRefs = useRef({});

  const allModels = Array.isArray(models) ? models : [];

  const credits = (user?.credits ?? 0) + (user?.bonusCredits ?? 0);
  const baseCost = genMode === "img"
    ? pricing.withModel1 * qty
    : (qty === 2
      ? (mode === "character" ? pricing.withModel2 : pricing.noModel2)
      : (mode === "character" ? pricing.withModel1 : pricing.noModel1));
  const includedStepsForPricing = genMode === "img" ? 0 : getIncludedStepsForMode(mode, limits);
  const extraBlocks = genMode === "img"
    ? 0
    : (steps > includedStepsForPricing ? Math.ceil((steps - includedStepsForPricing) / 10) : 0);
  const extraCost = genMode === "img" ? 0 : (extraBlocks * pricing.extraStepsPer10 * qty);
  const cost = baseCost + extraCost;
  const hasEnough = credits >= cost;

  useEffect(() => {
    const token = localStorage.getItem("token");
    api.get("modelclone-x/config", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (res.data?.success) {
          if (typeof res.data.fromImageEnabled === "boolean" && typeof res.data.runpodForModelCloneX === "boolean") {
            setMcxServerEnv({
              fromImageEnabled: res.data.fromImageEnabled,
              runpodForModelCloneX: res.data.runpodForModelCloneX,
            });
          } else {
            setMcxServerEnv({ fromImageEnabled: true, runpodForModelCloneX: true });
          }
          if (res.data.pricing) setPricing({ ...DEFAULT_MODELCLONE_X_PRICING, ...res.data.pricing });
          if (res.data.limits) {
            const nextLimits = { ...DEFAULT_MODELCLONE_X_LIMITS, ...res.data.limits };
            setLimits(nextLimits);
            const suggestedCfg = Number(res.data.limits.defaultCfg ?? MODELCLONE_X_DEFAULT_CFG);
            setCfg((prev) => {
              if (prev !== MODELCLONE_X_DEFAULT_CFG) return prev;
              const parsed = Number.isFinite(suggestedCfg) ? suggestedCfg : MODELCLONE_X_DEFAULT_CFG;
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

  useEffect(() => {
    if (mode !== "character" && genMode === "img") {
      setGenMode("txt");
      setRefImageBase64("");
      setRefImagePreview("");
      setQty(1);
    }
  }, [mode, genMode]);

  useEffect(() => {
    if (genMode === "txt" && qty > 2) {
      setQty(2);
    }
  }, [genMode, qty]);

  // Fetch characters when model changes
  useEffect(() => {
    if (!selectedModelId || mode !== "character") { setCharacters([]); setSelectedCharacterId(""); return; }
    const token = localStorage.getItem("token");
    api.get(`modelclone-x/characters/${selectedModelId}`, { headers: { Authorization: `Bearer ${token}` } })
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
        const res = await api.get(`modelclone-x/status/${genId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const { status, imageUrl, imageUrls, error } = res.data;
        if (status === "completed" && (imageUrl || (Array.isArray(imageUrls) && imageUrls.length))) {
          stopPoll(genId);
          const urls = Array.isArray(imageUrls) && imageUrls.length
            ? imageUrls
            : (imageUrl ? [imageUrl] : []);
          setResults((prev) => {
            const next = prev.filter((r) => r.generationId !== genId);
            const expanded = urls.map((url, idx) => ({
              generationId: idx === 0 ? genId : `${genId}:${idx}`,
              status: "done",
              imageUrl: url,
            }));
            return [...expanded, ...next];
          });
        } else if (status === "failed") {
          stopPoll(genId);
          setResults((prev) => prev.map((r) => r.generationId === genId ? { ...r, status: "failed", error } : r));
          const errText =
            typeof error === "string"
              ? error
              : error && typeof error === "object" && typeof error.message === "string"
                ? error.message
                : error != null
                  ? String(error)
                  : "Unknown error";
          toast.error(`Generation failed: ${errText}`);
        }
      } catch (_) {}
    }, POLL_INTERVAL_MS);
  };

  // Cleanup on unmount
  useEffect(() => () => {
    Object.keys(pollRefs.current).forEach(stopPoll);
  }, []);

  const handleGenerate = async () => {
    if (mode === "character" && !selectedModelId) { toast.error("Select a model"); return; }
    if (mode === "character" && !selectedCharacterId) { toast.error("Select a character identity"); return; }
    if (genMode === "txt" && !prompt.trim()) { toast.error("Enter a prompt first"); return; }
    if (genMode === "img") {
      if (mode !== "character") { toast.error(copy.adminRunpodImg2ImgNeedCharacter); return; }
      if (!refImageBase64) { toast.error(copy.buildNeedImage); return; }
      if (mcxServerEnv && !mcxServerEnv.fromImageEnabled) {
        toast.error(copy.serverPhotoPromptMissing);
        return;
      }
    }
    if (mcxServerEnv && !mcxServerEnv.runpodForModelCloneX) {
      toast.error(copy.serverRunpodMissing);
      return;
    }
    if (!hasEnough) { toast.error("Insufficient balance"); return; }

    setSubmitInFlight((n) => n + 1);
    try {
      const token = localStorage.getItem("token");
      const body = {
        prompt: genMode === "img" ? "" : prompt.trim(),
        preOptimized: false,
        modelId: mode === "character" ? selectedModelId : null,
        characterLoraId: mode === "character" ? selectedCharacterId : null,
        quantity: qty,
        loraStrength: mode === "character" ? loraStrength : undefined,
      };
      if (genMode !== "img") {
        Object.assign(body, {
          aspectRatio: aspect,
          steps,
          cfg,
        });
      }

      if (genMode === "img" && mode === "character") {
        Object.assign(body, { modelcloneXImg2Img: true });
        if (refImageBase64) Object.assign(body, { inputImageBase64: refImageBase64 });
      }

      const res = await api.post("modelclone-x/generate", body, { headers: { Authorization: `Bearer ${token}` } });

      let generationIds = Array.isArray(res.data?.generationIds) ? res.data.generationIds : [];
      if (!generationIds.length) {
        // Sometimes upstream/proxy returns 200 with an empty/partial body.
        // Try to recover by finding a very recent ModelClone-X generation in processing.
        try {
          const recent = await api.get("generations", {
            params: { type: "modelclone-x", limit: 8, offset: 0 },
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
        toast.error(
          formatApiError(
            { response: { data: res.data } },
            "Submission unstable. Please retry once.",
          ),
        );
        return;
      }
      const newResults = generationIds.map((id) => ({ generationId: id, status: "processing", imageUrl: null }));
      setResults((prev) => [...newResults, ...prev]);
      generationIds.forEach(startPoll);

      // Sync credit balance from backend after successful submission.
      refreshUserCredits();
    } catch (err) {
      if (err?.response) {
        toast.error(formatApiError(err, "Generation failed"));
        return;
      }

      // Network/parse failures can happen after backend already accepted the job.
      // Recover by looking for a very recent ModelClone-X processing generation.
      try {
        const token = localStorage.getItem("token");
        const recent = await api.get("generations", {
          params: { type: "modelclone-x", limit: 8, offset: 0 },
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
    if (url.startsWith("data:")) {
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `modelclone-x_${Date.now()}.png`;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        toast.error("Download failed");
      }
      return;
    }
    await downloadFromPublicUrl(url, `modelclone-x_${Date.now()}.png`);
  };

  const panel = isDark ? "rounded-2xl border p-3.5 md:p-4 glass-card border-white/[0.08]" : "rounded-2xl border border-slate-200/90 bg-white/90 p-3.5 md:p-4 shadow-sm";

  const inputBase = isDark
    ? "glass-card border border-white/[0.10] text-white placeholder-slate-500 focus:border-white/22"
    : "border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-soft)]";

  const labelBase = `block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-slate-500" : "text-slate-500"}`;

  return (
    <div className="space-y-5">
      {mcxServerEnv && !mcxServerEnv.runpodForModelCloneX && (
        <div
          className={`flex gap-2 items-start rounded-xl border px-3 py-2.5 text-sm ${
            isDark ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{copy.serverRunpodMissing}</span>
        </div>
      )}
      {mcxServerEnv && genMode === "img" && !mcxServerEnv.fromImageEnabled && (
        <div
          className={`flex gap-2 items-start rounded-xl border px-3 py-2.5 text-sm ${
            isDark ? "border-rose-500/35 bg-rose-500/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-950"
          }`}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{copy.serverPhotoPromptMissing}</span>
        </div>
      )}
      {/* Mode toggle */}
      <div className={panel}>
        <label className={labelBase}>{copy.mode}</label>
        <div className="flex flex-wrap gap-2">
          {[
            { id: "without", label: copy.noCharacter, icon: ImageIcon },
            { id: "character", label: copy.useCharacter, icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <ControlChip
              key={id}
              onClick={() => {
                setMode(id);
                if (id !== "character") setAdminRunpodImg2Img(false);
              }}
              active={mode === id}
              isDark={isDark}
              className="flex-1 inline-flex items-center justify-center gap-1.5"
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </ControlChip>
          ))}
        </div>
      </div>

      {/* Text-to-image vs image-to-image: Grok scene JSON + same MCX optimizer, then Z-Image img2img for "img" */}
      <div className={panel}>
        <label className={labelBase}>{copy.genType}</label>
        <div className="flex flex-wrap gap-2">
          {[
            { id: "txt", label: copy.outputTxt, icon: Sparkles },
            ...(mode === "character" ? [{ id: "img", label: copy.outputImg, icon: ImageIcon }] : []),
          ].map(({ id, label, icon: Icon }) => (
            <ControlChip
              key={id}
              onClick={() => {
                setGenMode(id);
                if (id === "txt") {
                  setRefImageBase64("");
                  setRefImagePreview("");
                } else {
                  setPrompt("");
                  setQty(1);
                }
              }}
              active={genMode === id}
              isDark={isDark}
              className="flex-1 inline-flex items-center justify-center gap-1.5"
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </ControlChip>
          ))}
        </div>
        {genMode === "img" && (
          <div className="mt-3 space-y-2">
            <p className={`text-[11px] leading-relaxed ${isDark ? "text-slate-500" : "text-slate-600"}`}>
              {mode === "character" ? copy.refImageHintCharImg : copy.refImageHint}
            </p>
            {/* Hidden file input */}
            <input
              ref={refFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target?.files?.[0];
                e.target.value = "";
                if (!f || !f.type.startsWith("image/")) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = String(reader.result || "");
                  const comma = dataUrl.indexOf(",");
                  const raw = comma >= 0 ? dataUrl.slice(comma + 1) : "";
                  if (!raw) return;
                  setRefImageBase64(raw);
                  setRefImagePreview(dataUrl);
                };
                reader.readAsDataURL(f);
              }}
            />
            {/* Drop zone */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => refFileInputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && refFileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setRefImageDragOver(true); }}
              onDragLeave={() => setRefImageDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setRefImageDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (!f || !f.type.startsWith("image/")) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = String(reader.result || "");
                  const comma = dataUrl.indexOf(",");
                  const raw = comma >= 0 ? dataUrl.slice(comma + 1) : "";
                  if (!raw) return;
                  setRefImageBase64(raw);
                  setRefImagePreview(dataUrl);
                };
                reader.readAsDataURL(f);
              }}
              className="relative cursor-pointer overflow-hidden rounded-xl transition-all duration-200 group select-none"
              style={{
                background: refImageDragOver
                  ? "var(--accent-soft)"
                  : isDark ? "rgba(20,20,30,0.5)" : "var(--bg-elevated)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
              }}
            >
              {/* Dashed border overlay */}
              <div
                className={`absolute inset-0 rounded-xl pointer-events-none transition-all duration-200 ${
                  refImageDragOver
                    ? "border-2 border-[var(--accent)]"
                    : refImagePreview
                      ? "border border-white/20"
                      : "border-2 border-dashed border-[var(--border-medium)] group-hover:border-[var(--accent)]/60"
                }`}
              />

              {refImagePreview ? (
                <>
                  <img
                    src={refImagePreview}
                    alt="Reference"
                    className="w-full h-48 object-contain bg-black/20 rounded-xl"
                  />
                  {/* Success badge */}
                  <div
                    className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-1 shadow"
                    style={{ background: "rgba(34,197,94,0.85)" }}
                  >
                    <Check className="w-3 h-3" />
                    Ready
                  </div>
                  {/* Replace on hover */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center rounded-xl gap-1">
                    <Upload className="w-5 h-5 text-white" />
                    <span className="text-xs text-white font-medium">Replace</span>
                  </div>
                  {/* Clear button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRefImageBase64("");
                      setRefImagePreview("");
                    }}
                    className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500/80"
                    aria-label="Remove image"
                  >
                    <X className="w-3.5 h-3.5 text-white" />
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 px-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-1 transition-colors"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
                  >
                    <ImageIcon className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
                  </div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    {refImageDragOver ? "Drop image here" : "Click or drag an image"}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    JPG, PNG · used as reference for generation
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
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
                  <div
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm ${
                      isDark
                        ? "bg-amber-500/10 border-amber-500/25 text-amber-200"
                        : "bg-amber-50 border-amber-200 text-amber-900"
                    }`}
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {copy.noReadyLora}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {characters.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setSelectedCharacterId(c.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all
                          ${selectedCharacterId === c.id
                            ? isDark
                              ? "bg-[var(--accent-soft)] border-[var(--border-medium)]"
                              : "bg-[var(--accent-soft)] border-[var(--border-medium)]"
                            : isDark
                              ? "glass-card border border-white/[0.08] hover:border-white/18"
                              : "bg-white border border-slate-200 hover:border-slate-300"}`}
                      >
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isDark ? "bg-[var(--accent-soft)]" : "bg-[var(--accent-soft)]"
                          }`}
                        >
                          <User className="w-3.5 h-3.5 text-[var(--accent)]" />
                        </div>
                        <span className={`text-sm font-medium flex-1 ${isDark ? "text-white" : "text-slate-900"}`}>{c.name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            c.category === "nsfw"
                              ? (isDark ? "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10" : "text-fuchsia-800 border-fuchsia-200 bg-fuchsia-50")
                              : (isDark ? "text-[var(--accent)] border-[var(--border-medium)] bg-[var(--accent-soft)]" : "text-[var(--text-secondary)] border-[var(--border-medium)] bg-[var(--bg-surface)]")
                          }`}
                        >
                          {c.category === "nsfw" ? "NSFW LoRA" : "ModelClone-X LoRA"}
                        </span>
                        {selectedCharacterId === c.id && (
                          <CheckCircle2 className={`w-4 h-4 flex-shrink-0 text-[var(--accent)]`} />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main prompt: text-to-image only (image mode uses optional field above) */}
      {genMode === "txt" && (
        <div className={panel}>
          <label className={labelBase}>{copy.prompt}</label>
          <textarea
            rows={3}
            placeholder={copy.promptPlaceholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={`w-full px-3 py-2.5 rounded-xl text-sm border outline-none resize-none ${inputBase}`}
          />
        </div>
      )}

      {/* Aspect ratio is used only in text mode (img2img workflow derives size from input). */}
      {genMode === "txt" && (
        <div className={panel}>
          <label className={labelBase}>{copy.aspectRatio}</label>
          <div className="flex flex-wrap gap-2">
            {ASPECT_OPTIONS.map((opt) => (
              <ControlChip
                key={opt.id}
                onClick={() => {
                  setAspect(opt.id);
                }}
                active={aspect === opt.id}
                isDark={isDark}
              >
                {opt.label}
                <span className="ml-1 opacity-60">{opt.hint}</span>
              </ControlChip>
            ))}
          </div>
        </div>
      )}

      {/* Quantity */}
      <div className={panel}>
        <label className={labelBase}>{copy.images}</label>
        <div className="flex gap-2">
          {Array.from({ length: genMode === "img" ? 4 : 2 }, (_, i) => i + 1).map((n) => (
            <ControlChip
              key={n}
              onClick={() => {
                setQty(n);
              }}
              active={qty === n}
              isDark={isDark}
              className="min-w-12"
            >
              {n}
            </ControlChip>
          ))}
        </div>
      </div>

      <div className={`rounded-xl border p-3 space-y-3 ${isDark ? "glass-card border-white/[0.08]" : "bg-slate-50/90 border border-slate-200/90"}`}>
        <p className={`text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
          {genMode === "img" ? copy.loraStrength : copy.advanced}
        </p>
        <div className={`grid gap-3 ${genMode === "txt" ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
          {genMode === "txt" && (
            <>
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
                  onChange={(e) => setCfg(Math.max(limits.minCfg, Math.min(limits.maxCfg, Number(e.target.value) || MODELCLONE_X_DEFAULT_CFG)))}
                />
                <span className={`text-xs ${isDark ? "text-slate-300" : "text-slate-700"}`}>{cfg.toFixed(1)}</span>
              </label>
            </>
          )}
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
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={
            !hasEnough
            || submitInFlight > 0
            || (genMode === "img" && !refImageBase64)
          }
          className="btn-accent flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.99] disabled:cursor-not-allowed"
        >
          {submitInFlight > 0 ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {copy.generating}</>
          ) : (
            <><Sparkles className="w-4 h-4" /> {copy.generate}</>
          )}
        </button>
        <div
          className={`flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border text-sm shrink-0 ${
            isDark ? "glass-card border-white/[0.08]" : "bg-white border border-slate-200"
          }`}
        >
          <Coins className="w-4 h-4 text-[var(--accent)]" />
          <span className={`font-bold tabular-nums ${isDark ? "text-white" : "text-slate-900"}`}>{cost}</span>
          {extraCost > 0 && (
            <span className={`text-[11px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>+{extraCost} <Coins className="w-3 h-3 inline" /></span>
          )}
        </div>
      </div>

      {!hasEnough && (
        <p className={`text-xs -mt-1 ${isDark ? "text-rose-400" : "text-rose-600"}`}>
          {copy.creditsMissing} {cost} <Coins className="w-3 h-3 inline" /> ({copy.youHave} {credits} <Coins className="w-3 h-3 inline" />).
        </p>
      )}

      {/* Results */}
      <AnimatePresence>
        {results.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-slate-500"}`}
              >
                {copy.results}
              </span>
              <button
                type="button"
                onClick={() => {
                  Object.keys(pollRefs.current).forEach(stopPoll);
                  setResults([]);
                }}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  isDark
                    ? "border-white/10 text-slate-400 hover:bg-white/[0.06]"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
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
                    <div
                      className={`aspect-[9/16] rounded-2xl border flex flex-col items-center justify-center gap-2 ${
                        isDark ? "bg-rose-500/10 border-rose-500/25" : "bg-rose-50 border-rose-200"
                      }`}
                    >
                      <AlertCircle className={`w-6 h-6 ${isDark ? "text-rose-400" : "text-rose-600"}`} />
                      <p className={`text-xs ${isDark ? "text-rose-400" : "text-rose-700"}`}>{copy.failed}</p>
                    </div>
                  ) : (
                    <div
                      className={`aspect-[9/16] rounded-2xl border flex flex-col items-center justify-center gap-4 ${
                        isDark ? "glass-card border-white/[0.08]" : "bg-white border border-slate-200"
                      }`}
                    >
                      <div className="relative w-12 h-12 flex items-center justify-center">
                        <div
                          className={`absolute inset-0 rounded-full border-2 border-t-transparent animate-spin ${
                            isDark ? "border-[var(--border-medium)] border-t-[var(--accent)]" : "border-[var(--border-medium)] border-t-[var(--accent)]"
                          }`}
                        />
                        <Sparkles className="relative w-5 h-5 text-[var(--accent)]" />
                      </div>
                      <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>{copy.generatingShort}</p>
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

// ── Main ModelCloneXPage ────────────────────────────────────────────────────────────

export default function ModelCloneXPage() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const locale = resolveLocale();
  const copy = COPY[locale] || COPY.en;
  const [activeTab, setActiveTab] = useState("generate");
  const pricing = useModelCloneXPricing();

  const pricingRows = [
    [copy.p1, pricing.noModel1],
    [copy.p2, pricing.withModel1],
    [copy.p3, pricing.noModel2],
    [copy.p4, pricing.withModel2],
    [copy.p5, pricing.extraStepsPer10],
    [copy.p6, pricing.trainingStandard],
    [copy.p7, pricing.trainingPro],
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 md:py-10 pb-12">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8 md:mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className={accentIconClassName("w-10 h-10")}>
              <Sparkles className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
              {copy.title}
            </h1>
          </div>
          <p className="text-sm md:text-[15px] leading-relaxed max-w-2xl text-[var(--text-muted)]" style={{ marginLeft: "52px" }}>
            {copy.subtitle}
          </p>
        </motion.div>

        {/* Tab switcher */}
        <div
          className={`flex rounded-xl p-1 max-w-md mb-6 border ${
            isDark ? "border-white/[0.08] bg-white/[0.02]" : "border-slate-200 bg-white/80"
          }`}
        >
          {[
            { id: "generate", label: copy.tabGenerate, icon: Sparkles },
            { id: "character", label: copy.tabCharacter, icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all
                ${activeTab === id
                  ? "text-[var(--accent-foreground)] bg-[var(--accent)] shadow-sm"
                  : isDark
                    ? "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
                    : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "generate" ? (
            <motion.div
              key="generate"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <GenerateTab isDark={isDark} copy={copy} />
            </motion.div>
          ) : (
            <motion.div
              key="character"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <CharacterTab isDark={isDark} pricing={pricing} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Credit reference */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="mt-8 panel rounded-xl p-4 md:p-5 text-sm"
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3 text-[var(--text-muted)]"
          >
            {copy.pricingTitle}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-2 text-xs md:text-sm">
            {pricingRows.map(([label, amount]) => (
              <div key={String(label)} className="flex justify-between gap-4 py-1">
                <span className="text-[var(--text-muted)]">{label}</span>
                <span className="font-semibold tabular-nums inline-flex items-center gap-1 shrink-0 text-[var(--text-primary)]">
                  {amount}
                  <Coins className="w-3.5 h-3.5 text-[var(--accent)]" />
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
