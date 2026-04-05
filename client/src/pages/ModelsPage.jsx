import { useState, useEffect, memo, useCallback } from "react";
import {
  Plus,
  Trash2,
  Edit,
  X,
  Upload,
  Sparkles,
  Lock,
  Eye,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  Mic,
  Coins,
  User,
} from "lucide-react";
import {
  MagnifyingGlass,
  Sparkle,
  PencilSimple,
  Trash as TrashPh,
  FloppyDisk,
  ArrowsClockwise,
  LockSimple,
  Eye as EyePh,
  UploadSimple,
  UserCircle,
} from "@phosphor-icons/react";
import toast from "react-hot-toast";
import api, { uploadToCloudinary as uploadFile } from "../services/api";
import CreateModelModal from "../components/CreateModelModal";
import AddCreditsModal from "../components/AddCreditsModal";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { getThumbnailUrl } from "../utils/imageUtils";
import { selectorCategories } from "../data/nsfwSelectors";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { useTutorialCatalog } from "../hooks/useTutorialCatalog";
import TutorialInfoLink from "../components/TutorialInfoLink";

const LOCALE_STORAGE_KEY = "app_locale";
const PAGE_COPY = {
  en: {
    title: "My Models",
    subtitle: "Create and manage your AI face models",
    createModel: "Create Model",
    searchPlaceholder: "Search models by name...",
    photo: "Photo",
    modelAge: "Model Age",
    notSet: "Not set",
    usedInPrompts: "Used in AI generation prompts.",
    modelLooks: "Model Looks",
    saveLooks: "Save Looks",
    saving: "Saving...",
    voiceStudio: "Voice Studio",
    voiceStudioDesc: "Manage up to 3 model voices, pick the default, and generate audio in the full Voice Studio.",
    noModelVoice: "No model voice yet.",
    createVoiceInStudio: "Create voice in studio...",
    openVoiceStudio: "Open full voice studio...",
    hoverPhotoHint: "Hover any photo to preview or replace. Changes save automatically.",
    custom: "Custom",
    typeCustom: "Type custom...",
    detecting: "Detecting...",
    autoAssign: "AI Auto-Assign",
    noPhotosFound: "No photos found on this model",
    looksDetectedCost: "Looks detected! · 10 🪙 used",
    detectionFailed: "Detection failed",
    detectLooksFailed: "Failed to detect looks",
    gender: "Gender",
    loadModelsFailed: "Failed to load models",
    confirmDeleteModel: 'Delete model "{name}"?',
    modelDeleted: "Model deleted",
    deleteModelFailed: "Failed to delete model",
    photoUpdated: "Photo updated",
    updatePhotoFailed: "Failed to update photo",
    ageRangeError: "Age must be between 1 and 85 (models under 18 cannot use NSFW or LoRA)",
    ageUpdated: "Age updated",
    updateAgeFailed: "Failed to update age",
    lookSettingsSaved: "Look settings saved",
    saveLookSettingsFailed: "Failed to save look settings",
    emptyTitle: "No models yet",
    emptySubtitle: "Create your first AI model by uploading 3 photos or generating one with AI",
    emptyCta: "Create First Model",
    noMatch: 'No models match "{query}"',
    clearSearch: "Clear search",
    statusGenerating: "Generating…",
    generatingPhotos: "Generating photos…",
    viewEditPhotos: "View & edit photos",
    lockedTitle: "Photos locked (unlock via admin if user needs to change photos)",
    previewAlt: "Photo preview",
    clickAnywhereClose: "Click anywhere to close",
    viewOrUpdatePhotos: "View or update model photos",
    viewFullSize: "View full size",
    replacePhoto: "Replace photo",
    save: "Save",
    clear: "Clear",
    countSet: "{count} set",
    defaultVoiceOnFile: "Default voice on file ({type}).",
    voiceTypeClone: "clone",
    voiceTypeDesign: "design",
    infoLocked: "Photos locked — NSFW access is enabled. Hover & click the eye icon to view.",
    photosLockedNsfwEnabled: "Photos locked (NSFW enabled)",
  },
  ru: {
    title: "Мои модели",
    subtitle: "Создавайте и управляйте своими ИИ-моделями лица",
    createModel: "Создать модель",
    searchPlaceholder: "Поиск моделей по имени...",
    photo: "Фото",
    modelAge: "Возраст модели",
    notSet: "Не задано",
    usedInPrompts: "Используется в промптах генерации ИИ.",
    modelLooks: "Внешность модели",
    saveLooks: "Сохранить внешность",
    saving: "Сохранение...",
    voiceStudio: "Голосовая студия",
    voiceStudioDesc: "Управляйте до 3 голосами модели, выбирайте голос по умолчанию и генерируйте аудио в полной голосовой студии.",
    noModelVoice: "Голос модели пока не задан.",
    createVoiceInStudio: "Создать голос в студии...",
    openVoiceStudio: "Открыть полную голосовую студию...",
    hoverPhotoHint: "Наведите на фото, чтобы просмотреть или заменить. Изменения сохраняются автоматически.",
    custom: "Другое",
    typeCustom: "Введите свой вариант...",
    detecting: "Определение...",
    autoAssign: "AI Автоназначение",
    noPhotosFound: "Фотографии на этой модели не найдены",
    looksDetectedCost: "Внешность определена! · использовано 10 🪙",
    detectionFailed: "Ошибка определения",
    detectLooksFailed: "Не удалось определить внешность",
    gender: "Пол",
    loadModelsFailed: "Не удалось загрузить модели",
    confirmDeleteModel: "Удалить модель «{name}»?",
    modelDeleted: "Модель удалена",
    deleteModelFailed: "Не удалось удалить",
    photoUpdated: "Фото обновлено",
    updatePhotoFailed: "Не удалось обновить фото",
    ageRangeError: "Возраст должен быть от 1 до 85 (модели до 18 лет не могут использовать NSFW или LoRA)",
    ageUpdated: "Возраст обновлён",
    updateAgeFailed: "Не удалось обновить возраст",
    lookSettingsSaved: "Настройки внешности сохранены",
    saveLookSettingsFailed: "Не удалось сохранить настройки внешности",
    emptyTitle: "Моделей пока нет",
    emptySubtitle: "Создайте свою первую ИИ-модель, загрузив 3 фотографии или сгенерировав её с помощью ИИ",
    emptyCta: "Создать первую модель",
    noMatch: "Модели по запросу «{query}» не найдены",
    clearSearch: "Очистить поиск",
    statusGenerating: "Генерация…",
    generatingPhotos: "Создание фотографий…",
    viewEditPhotos: "Просмотр и редактирование фотографий",
    lockedTitle: "Фотографии заблокированы (разблокировка через администратора, если пользователю нужно изменить фото)",
    previewAlt: "Превью фото",
    clickAnywhereClose: "Нажмите в любом месте, чтобы закрыть",
    viewOrUpdatePhotos: "Просмотр или обновление фотографий модели",
    viewFullSize: "Просмотр в полном размере",
    replacePhoto: "Заменить фото",
    save: "Сохранить",
    clear: "Очистить",
    countSet: "Задано: {count}",
    defaultVoiceOnFile: "Голос по умолчанию сохранён ({type}).",
    voiceTypeClone: "клон",
    voiceTypeDesign: "создан",
    infoLocked: "Фотографии заблокированы — включён доступ к NSFW. Наведите курсор и нажмите на иконку глаза для просмотра.",
    photosLockedNsfwEnabled: "Фотографии заблокированы (NSFW включён)",
  },
};

function resolveLocale() {
  try {
    const qsLang = new URLSearchParams(window.location.search).get("lang");
    const normalizedQs = String(qsLang || "").toLowerCase();
    if (normalizedQs === "ru" || normalizedQs === "en") {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalizedQs);
      return normalizedQs;
    }
    const saved = String(localStorage.getItem(LOCALE_STORAGE_KEY) || "").toLowerCase();
    if (saved === "ru" || saved === "en") return saved;
    const browser = String(navigator.language || "").toLowerCase();
    return browser.startsWith("ru") ? "ru" : "en";
  } catch {
    return "en";
  }
}

function formatCopy(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? `{${key}}` : String(vars[key]),
  );
}

export default function ModelsPage({ sidebarCollapsed = false, openVoiceStudioForModel }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [editAge, setEditAge] = useState("");
  const [savingAge, setSavingAge] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState(null);
  const { byKey } = useTutorialCatalog();

  // Look variable editor state
  const [editLooks, setEditLooks] = useState({});
  const [savingLooks, setSavingLooks] = useState(false);
  const [autoDetectingLooks, setAutoDetectingLooks] = useState(false);

  const handleAutoDetectModelLooks = async () => {
    if (!editingModel) return;
    const imageUrls = [editingModel.photo1Url, editingModel.photo2Url, editingModel.photo3Url].filter(Boolean);
    if (imageUrls.length === 0) {
      toast.error(copy.noPhotosFound);
      return;
    }
    setAutoDetectingLooks(true);
    try {
      const response = await api.post("/generate/analyze-looks", { imageUrls });
      if (response.data.success && response.data.looks) {
        const { age, ...chipLooks } = response.data.looks;
        setEditLooks(prev => ({ ...prev, ...chipLooks }));
        // Auto-fill age input if detected and not already set
        if (age) setEditAge(String(age));
        toast.success(copy.looksDetectedCost);
      } else {
        toast.error(response.data.message || copy.detectionFailed);
      }
    } catch (error) {
      const api = error.response?.data;
      const msg =
        (typeof api?.message === "string" && api.message) ||
        (typeof api?.error === "string" && api.error) ||
        copy.detectLooksFailed;
      toast.error(msg);
    } finally {
      setAutoDetectingLooks(false);
    }
  };

  // Single source of truth: LoRA-style appearance groups + gender (same chips used everywhere)
  const appearanceGroups = selectorCategories.find(c => c.id === "appearance")?.groups || [];
  const modelLooksGroups = [
    { key: "gender", label: copy.gender, options: ["female", "male"] },
    ...appearanceGroups,
  ];

  // Derive initial looks from savedAppearance or fall back to aiGenerationParams
  function extractLooksFromModel(model) {
    if (!model) return {};
    if (model.savedAppearance && typeof model.savedAppearance === "object") {
      return { ...model.savedAppearance };
    }
    try {
      const params = typeof model.aiGenerationParams === "string"
        ? JSON.parse(model.aiGenerationParams)
        : model.aiGenerationParams;
      if (params && typeof params === "object") {
        const keys = ["gender","hairColor","hairLength","hairTexture","eyeColor","bodyType","heritage","faceType","lipSize","style"];
        const looks = {};
        keys.forEach(k => { if (params[k]) looks[k] = params[k]; });
        if (Object.keys(looks).length > 0) return looks;
      }
    } catch {}
    return {};
  }

  const [modelLoras, setModelLoras] = useState([]);
  const [loadingLoras, setLoadingLoras] = useState(false);
  const gradientPurple = "linear-gradient(135deg, #8B5CF6, #3B82F6)";
  const gradientCyan = "linear-gradient(135deg, #22D3EE, #14B8A6)";

  useEffect(() => {
    loadModels();
  }, []);

  // Poll every 8 s while any model is still being generated
  useEffect(() => {
    const hasProcessing = models.some((m) => m.status === "processing");
    if (!hasProcessing) return;
    const timer = setInterval(loadModels, 8000);
    return () => clearInterval(timer);
  }, [models]);

  useEffect(() => {
    if (editingModel?.id) {
      loadModelLoras(editingModel.id);
    } else {
      setModelLoras([]);
    }
  }, [editingModel?.id]);

  const loadModelLoras = async (modelId) => {
    setLoadingLoras(true);
    try {
      const res = await api.get(`/nsfw/loras/${modelId}`);
      if (res.data.success) {
        setModelLoras(res.data.loras || []);
      }
    } catch {
      setModelLoras([]);
    } finally {
      setLoadingLoras(false);
    }
  };

  const readyLora = modelLoras.find(l => l.status === "ready");

  const loadModels = async () => {
    try {
      const response = await api.get("/models");
      if (response.data.success) {
        const list = response.data.models || [];
        setModels((prev) => {
          if (!editingModel?.id || list.length === 0) return list;
          const idx = list.findIndex((m) => m.id === editingModel.id);
          if (idx < 0) return list;
          const merged = {
            ...list[idx],
            savedAppearance: editingModel.savedAppearance ?? list[idx].savedAppearance,
            age: editingModel.age ?? list[idx].age,
          };
          const next = [...list];
          next[idx] = merged;
          return next;
        });
      }
    } catch (error) {
      toast.error(copy.loadModelsFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(formatCopy(copy.confirmDeleteModel, { name }))) return;

    try {
      const response = await api.delete(`/models/${id}`);
      if (response.data.success) {
        toast.success(copy.modelDeleted);
        loadModels();
      }
    } catch (error) {
      toast.error(copy.deleteModelFailed);
    }
  };

  const handlePhotoUpdate = async (modelId, photoNumber, file) => {
    setUploading(photoNumber);

    try {
      const photoUrl = await uploadFile(file);

      const response = await api.put(`/models/${modelId}`, {
        name: editingModel.name,
        photo1Url: editingModel.photo1Url,
        photo2Url: editingModel.photo2Url,
        photo3Url: editingModel.photo3Url,
        [`photo${photoNumber}Url`]: photoUrl,
      });

      if (response.data.success) {
        toast.success(copy.photoUpdated);
        loadModels();
        setEditingModel(response.data.model);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || copy.updatePhotoFailed);
    } finally {
      setUploading(null);
    }
  };

  const handleSaveAge = async () => {
    if (!editingModel) return;
    const ageVal = editAge.trim();
    if (ageVal && (parseInt(ageVal) < 1 || parseInt(ageVal) > 85)) {
      toast.error(copy.ageRangeError);
      return;
    }
    setSavingAge(true);
    try {
      const response = await api.put(`/models/${editingModel.id}`, {
        age: ageVal ? parseInt(ageVal) : null,
      });
      if (response.data.success) {
        toast.success(copy.ageUpdated);
        loadModels();
        setEditingModel({ ...editingModel, age: ageVal ? parseInt(ageVal) : null });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || copy.updateAgeFailed);
    } finally {
      setSavingAge(false);
    }
  };

  const handleSaveLooks = async () => {
    if (!editingModel) return;
    const appearance = Object.fromEntries(
      Object.entries(editLooks).filter(([, v]) => v != null && v !== "" && String(v).trim() !== "")
    );
    setSavingLooks(true);
    try {
      const response = await api.post("/nsfw/appearance/save", {
        modelId: editingModel.id,
        appearance: Object.keys(appearance).length > 0 ? appearance : {},
      });
      if (response.data.success) {
        toast.success(copy.lookSettingsSaved);
        const saved = response.data.savedAppearance || {};
        setEditingModel(prev => prev ? { ...prev, savedAppearance: saved } : null);
        setModels(prev => prev.map(m => m.id === editingModel.id ? { ...m, savedAppearance: saved } : m));
      }
    } catch (error) {
      toast.error(error.response?.data?.message || copy.saveLookSettingsFailed);
    } finally {
      setSavingLooks(false);
    }
  };

  const isPhotosLocked =
    (editingModel?.isAIGenerated === true || editingModel?.nsfwOverride === true || editingModel?.nsfwUnlocked === true) &&
    !editingModel?.looksUnlockedByAdmin;

  const closeEditModal = () => {
    if (editingModel?.id) {
      setModels((prev) =>
        prev.map((m) =>
          m.id === editingModel.id
            ? { ...m, savedAppearance: editingModel.savedAppearance ?? m.savedAppearance, age: editingModel.age ?? m.age }
            : m
        )
      );
    }
    setEditingModel(null);
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {copy.title}
            </h1>
            <p className="text-slate-400 text-sm">
              {copy.subtitle}
            </p>
            <TutorialInfoLink
              className="mt-1"
              tutorialUrl={byKey?.["models.my-models"]?.url || null}
            />
          </div>
        </div>

        <button
          onClick={() => {
            setShowCreateModal(true);
          }}
          className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02]"
          data-testid="button-create-model"
        >
          <Plus className="w-5 h-5" />
          <span>{copy.createModel}</span>
        </button>
      </div>

      {/* Search Bar */}
      {!loading && models.length > 0 && (
        <div className="relative mb-4">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" weight="bold" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            className="pl-9 h-10 bg-white/[0.03] border-white/[0.08] text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Models Grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse"
              style={{
                background:
                  "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.04))",
                border: "1px solid rgba(139,92,246,0.15)",
              }}
            >
              <div className="aspect-square bg-white/5 rounded-lg mb-4" />
              <div className="h-5 bg-white/5 rounded mb-2 w-3/4" />
              <div className="h-4 bg-white/5 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        <div
          className="rounded-2xl p-8 sm:p-12 text-center relative backdrop-blur-xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <div
            className="absolute top-0 left-0 w-40 h-40 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 100% 100% at 0% 0%, rgba(139,92,246,0.12) 0%, rgba(139,92,246,0.03) 45%, transparent 70%)",
            }}
          />
          <div className="relative">
            <h2 className="text-xl font-bold text-white mb-2">{copy.emptyTitle}</h2>
            <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
              {copy.emptySubtitle}
            </p>
            <button
              onClick={() => {
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02]"
              data-testid="button-create-first-model"
            >
              <Plus className="w-5 h-5" />
              {copy.emptyCta}
            </button>
          </div>
        </div>
      ) : (() => {
        const filteredModels = searchQuery.trim()
          ? models.filter(m => m.name?.toLowerCase().includes(searchQuery.toLowerCase()))
          : models;
        return filteredModels.length === 0 && searchQuery ? (
          <div className="py-12 text-center">
            <MagnifyingGlass className="w-8 h-8 text-slate-600 mx-auto mb-2" weight="duotone" />
            <p className="text-sm text-slate-500">{formatCopy(copy.noMatch, { query: searchQuery })}</p>
            <button onClick={() => setSearchQuery("")} className="text-xs text-purple-400 hover:text-purple-300 mt-2 transition-colors">{copy.clearSearch}</button>
          </div>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredModels.map((model, index) => (
            <div
              key={model.id}
              className="group rounded-lg p-2.5 transition-all hover:scale-[1.02] backdrop-blur-xl"
              style={{
                background: "rgba(139,92,246,0.05)",
                border: "1px solid rgba(139,92,246,0.12)",
                boxShadow: "inset 0 1px 0 var(--mc-glass-inset)",
              }}
            >
              {/* Thumbnail - square aspect ratio */}
              <div className="aspect-square rounded-2xl overflow-hidden mb-2 relative border border-white/5">
                {model.status === "processing" ? (
                  <div className="w-full h-full bg-slate-800/80 flex flex-col items-center justify-center gap-1.5">
                    <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                    <span className="text-[9px] text-slate-400 text-center leading-tight px-1">{copy.statusGenerating}</span>
                  </div>
                ) : (
                  <img
                    src={getThumbnailUrl(model.thumbnail || model.photo1Url)}
                    alt={model.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}

                {/* Hover Actions */}
                <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  {/* Edit button - opens modal where user can view/replace photos */}
                  <button
                    onClick={() => {
                      setEditingModel(model);
                      setEditAge(model.age != null ? String(model.age) : "");
                      setEditLooks(extractLooksFromModel(model));
                    }}
                    className="w-8 h-8 rounded-md flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(59,130,246,0.4), rgba(59,130,246,0.3))",
                    }}
                    data-testid={`button-edit-model-${model.id}`}
                    title={copy.viewEditPhotos}
                  >
                    <PencilSimple className="w-4 h-4 text-blue-300" weight="bold" />
                  </button>
                  {/* Show lock icon if photos are locked (LoRA trained or NSFW, unless admin unlocked) */}
                  {(model.nsfwUnlocked || model.nsfwOverride || model.isAIGenerated) && !model.looksUnlockedByAdmin && (
                    <div
                      className="w-8 h-8 rounded-md flex items-center justify-center"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(100,100,100,0.4), rgba(100,100,100,0.3))",
                      }}
                      title={copy.lockedTitle}
                    >
                      <Lock className="w-4 h-4 text-slate-400" />
                    </div>
                  )}
                  <button
                    onClick={() => {
                      handleDelete(model.id, model.name);
                    }}
                    className="w-8 h-8 rounded-md flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(239,68,68,0.4), rgba(239,68,68,0.3))",
                    }}
                    data-testid={`button-delete-model-${model.id}`}
                  >
                    <TrashPh className="w-4 h-4 text-red-300" weight="bold" />
                  </button>
                </div>
              </div>

              {/* Info - compact */}
              <h3 className="text-sm font-semibold text-white truncate">
                {model.name}
              </h3>
              <p className="text-[10px] text-slate-500">
                {new Date(model.createdAt).toLocaleDateString()}
              </p>

              {/* Photos Preview - smaller */}
              <div className="flex items-center gap-1.5 mt-1.5">
                {model.status === "processing" ? (
                  <span className="text-[9px] text-purple-400 flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> {copy.generatingPhotos}
                  </span>
                ) : (
                  <>
                    <div className="flex -space-x-1.5">
                      {[model.photo1Url, model.photo2Url, model.photo3Url].map(
                        (url, i) => (
                          <img
                            key={i}
                            src={getThumbnailUrl(url)}
                            className="w-5 h-5 rounded-full border border-slate-900 object-cover"
                            loading="lazy"
                            alt=""
                          />
                        ),
                      )}
                    </div>
                    <span className="text-[9px] text-slate-600">3</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        );
      })()}

      {/* Create Modal */}
      <CreateModelModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={loadModels}
        sidebarCollapsed={sidebarCollapsed}
        onNeedCredits={() => {
          setShowCreateModal(false);
          setShowCreditsModal(true);
        }}
      />

      {/* Credits Modal */}
      <AddCreditsModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
      />

      {/* Photo Preview Lightbox - shows when clicking on photo in edit modal */}
      {previewPhotoUrl && (
        <div
          className={`fixed top-0 right-0 bottom-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/95 backdrop-blur-sm left-0 ${sidebarCollapsed ? "md:left-[80px]" : "md:left-[260px]"}`}
          onClick={() => setPreviewPhotoUrl(null)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[88vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setPreviewPhotoUrl(null)}
              className="absolute top-0 right-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:bg-white/10 z-10"
              style={{ background: "rgba(255,255,255,0.1)" }}
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {/* Main image */}
            <img
              src={previewPhotoUrl}
              alt={copy.previewAlt}
              className="max-h-[78vh] max-w-full object-contain rounded-xl"
            />

            {/* Hint */}
            <p className="text-slate-500 text-sm mt-4">
              {copy.clickAnywhereClose}
            </p>
          </div>
        </div>
      )}

      {/* Edit Model Modal */}
      {editingModel && (
        <div
          className={`fixed top-0 right-0 bottom-0 z-[60] flex items-center justify-center p-3 sm:p-5 left-0 bg-black/80 backdrop-blur-sm ${sidebarCollapsed ? "md:left-[80px]" : "md:left-[260px]"}`}
          onClick={closeEditModal}
        >
          <div
            className="relative w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden flex flex-col glass-panel-strong"
            style={{ maxHeight: "calc(100dvh - 48px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeEditModal}
              className="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-500 hover:text-white transition-colors z-10"
              data-testid="button-close-edit"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Scrollable body */}
            <div className="overflow-y-auto overscroll-contain flex-1 p-4">
              <div className="w-full max-w-[360px] mx-auto space-y-4">
              <div className="pr-8">
                <h2 className="text-sm font-semibold text-white truncate leading-tight">
                  {editingModel.name}
                </h2>
                <p className="text-[11px] text-slate-500 leading-tight">
                  {isPhotosLocked ? copy.photosLockedNsfwEnabled : copy.viewOrUpdatePhotos}
                </p>
              </div>

              {/* Photos Grid — 3 compact square tiles */}
              <div className="grid grid-cols-3 gap-2.5">
                {[1, 2, 3].map((num) => (
                  <div key={num} className="space-y-1.5">
                    <div
                      className="aspect-square rounded-xl overflow-hidden relative group"
                      style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <img
                        src={editingModel[`photo${num}Url`]}
                        alt={`Photo ${num}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            setPreviewPhotoUrl(editingModel[`photo${num}Url`]);
                          }}
                          className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                          title={copy.viewFullSize}
                        >
                          <Eye className="w-4 h-4 text-white" />
                        </button>
                        {!isPhotosLocked && (
                          <label
                            className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors cursor-pointer"
                            title={copy.replacePhoto}
                          >
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/jpg"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handlePhotoUpdate(editingModel.id, num, file);
                              }}
                              data-testid={`input-photo-${num}`}
                            />
                            {uploading === num ? (
                              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4 text-white" />
                            )}
                          </label>
                        )}
                      </div>
                    </div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-600 text-center font-medium">
                      {copy.photo} {num}
                    </p>
                  </div>
                ))}
              </div>

              {/* Age Setting */}
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{copy.modelAge}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="number"
                    min="1"
                    max="85"
                    value={editAge}
                    onChange={(e) => setEditAge(e.target.value)}
                    placeholder={copy.notSet}
                    className="w-20 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                    data-testid="input-model-age"
                  />
                  <button
                    onClick={handleSaveAge}
                    disabled={savingAge || (editAge === (editingModel?.age != null ? String(editingModel.age) : ""))}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                    style={{
                      background: savingAge || (editAge === (editingModel?.age != null ? String(editingModel.age) : ""))
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(255,255,255,0.12)",
                      color: "white",
                    }}
                    data-testid="button-save-age"
                  >
                    {savingAge ? copy.saving : copy.save}
                  </button>
                  {editAge && (
                    <button
                      onClick={() => setEditAge("")}
                      className="px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                      data-testid="button-clear-age"
                    >
                      {copy.clear}
                    </button>
                  )}
                  <p className="text-[10px] text-slate-600 mt-0.5 w-full">{copy.usedInPrompts}</p>
                </div>
              </div>

              {/* Model Looks — single source of truth (LoRA-style chips + custom), used in all prompts */}
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
                  <p className="text-xs font-medium text-white flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-cyan-400" />
                    {copy.modelLooks}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {Object.values(editLooks).filter(Boolean).length > 0 && (
                      <span className="text-[10px] text-slate-500">
                        {formatCopy(copy.countSet, { count: Object.values(editLooks).filter(Boolean).length })}
                      </span>
                    )}
                    <button
                      onClick={handleAutoDetectModelLooks}
                      disabled={autoDetectingLooks}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/15 border border-violet-500/30 text-[10px] font-medium text-violet-300 hover:bg-violet-500/25 transition-all disabled:opacity-50"
                    >
                      {(autoDetectingLooks
                        ? <><ArrowsClockwise className="w-3 h-3 animate-spin" weight="bold" /> {copy.detecting}</>
                        : <><Sparkle className="w-3 h-3" weight="fill" /> {copy.autoAssign} · 10 <Coins className="w-3 h-3 text-yellow-400" /></>
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                  {modelLooksGroups.map((g) => {
                    const value = editLooks[g.key] || "";
                    const isCustom = value && !g.options.includes(value);
                    return (
                      <div key={g.key}>
                        <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{g.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {g.options.map((opt) => {
                            const isActive = value === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setEditLooks(prev => ({ ...prev, [g.key]: isActive ? "" : opt }))}
                                className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                                  isActive
                                    ? "bg-white/15 border border-white/30 text-white"
                                    : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => setEditLooks(prev => ({ ...prev, [g.key]: isCustom ? "" : " " }))}
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                              isCustom ? "bg-white/15 border border-white/30 text-white" : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                            }`}
                          >
                            {copy.custom}
                          </button>
                        </div>
                        {(isCustom || (value === " ")) && (
                          <input
                            type="text"
                            value={value === " " ? "" : value}
                            onChange={(e) => setEditLooks(prev => ({ ...prev, [g.key]: e.target.value }))}
                            placeholder={copy.typeCustom}
                            className="mt-1 w-full px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-[10px] placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleSaveLooks}
                  disabled={savingLooks}
                  className="mt-3 w-full py-1.5 rounded-lg bg-white/10 border border-white/15 text-white text-xs font-semibold hover:bg-white/15 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {(savingLooks
                    ? <><ArrowsClockwise className="w-3 h-3 animate-spin" weight="bold" /> {copy.saving}</>
                    : <><FloppyDisk className="w-3 h-3" weight="bold" /> {copy.saveLooks}</>
                  )}
                </button>
              </div>

              {/* Custom voice (talking head) */}
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <p className="text-xs font-medium text-white flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-violet-400" />
                  {copy.voiceStudio}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {copy.voiceStudioDesc}
                </p>
                {editingModel.elevenLabsVoiceId ? (
                  <p className="text-[11px] text-emerald-400/90 mt-2">
                    {formatCopy(copy.defaultVoiceOnFile, {
                      type: editingModel.elevenLabsVoiceType === "clone" ? copy.voiceTypeClone : copy.voiceTypeDesign,
                    })}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-2">{copy.noModelVoice}</p>
                )}
                <button
                  type="button"
                  onClick={() => openVoiceStudioForModel?.(editingModel.id)}
                  disabled={editingModel.status === "processing"}
                  className="mt-2 w-full py-2 rounded-lg text-xs font-semibold backdrop-blur-sm text-violet-200 hover:text-white disabled:opacity-40 transition-all border border-violet-500/25 hover:border-violet-400/40"
          style={{ background: "rgba(109,40,217,0.12)" }}
                >
                  {editingModel.elevenLabsVoiceId ? copy.openVoiceStudio : copy.createVoiceInStudio}
                </button>
              </div>

              {/* Info */}
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <div className="flex items-start gap-2">
                  {isPhotosLocked ? (
                    <>
                      <Lock className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {copy.infoLocked}
                      </p>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {copy.hoverPhotoHint}
                      </p>
                    </>
                  )}
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
