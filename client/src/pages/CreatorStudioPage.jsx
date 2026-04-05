import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Plus, Download, Loader2, Maximize2, Wand2, Sparkles, AlertCircle, Zap,
  Trash2, Video, User, Play, Clock, Coins, ChevronDown, Mic, CheckCircle,
  PauseCircle, Info,
} from "lucide-react";
import { creatorStudioAPI, avatarAPI, modelAPI, pricingAPI, uploadFile } from "../services/api";
import { downloadFromPublicUrl } from "../utils/directDownload";
import { useAuthStore } from "../store";
import { useActiveGeneration } from "../hooks/useActiveGeneration";
import CreatorStudioVoiceTab from "../components/CreatorStudioVoiceTab";
import { useTutorialCatalog } from "../hooks/useTutorialCatalog";
import TutorialInfoLink from "../components/TutorialInfoLink";

const LOCALE_STORAGE_KEY = "app_locale";
const PAGE_COPY = {
  en: {
    generating: "Generating…",
    failed: "Failed",
    save: "Save",
    makeVideo: "Make Video",
    enterPrompt: "Enter a prompt",
    generationFailed: "Generation failed",
    done: "Done!",
    generationFailedRefunded: "Generation failed — credits refunded",
    promptPlaceholder: "Describe the scene you imagine",
    refs: "Refs",
    aspect: "Aspect",
    res: "Res",
    buttonGenerating: "Generating…",
    buttonGenerateCost: "Generate · {cost}",
    creditsAvailable: "{credits} credits available",
    imageGeneration: "Image Generation",
    imageGenerationSubtitle: "No model required · generate anything",
    tutorialImage: "click to view tutorial - image generation",
    tutorialVoice: "click to view tutorial - voice studio",
    tutorialAvatars: "click to view tutorial - real avatars",
    emptyState: "Your creations will appear here",
    errorEnterAvatarName: "Enter a name for the avatar",
    errorUploadPhoto: "Upload a photo",
    errorNoDefaultVoice: "This model has no default voice. Create one in Voice Studio first.",
    avatarSubmitted: "Avatar submitted! Processing started — check back in a few minutes.",
    errorCreateAvatar: "Failed to create avatar",
    avatarDeleted: "Avatar deleted",
    newAvatar: "New Avatar",
    slotsUsed: "{used}/{max} slots used",
    portraitPhoto: "Portrait Photo",
    uploadPortraitPhoto: "Upload portrait photo",
    avatarName: "Avatar Name",
    avatarNamePlaceholder: "e.g. Studio Look, Casual Outdoor…",
    voiceNoteHas: "All avatars on this model use the current default voice.",
    voiceNoteMissing: "Open Voice Studio to create and select a default voice first.",
    oneTimeCreationFee: "One-time creation fee",
    insufficientCredits: "Insufficient credits ({credits} available, {required} required)",
    submitting: "Submitting…",
    createAvatarCost: "Create Avatar · {cost} cr",
    writeScript: "Write a script",
    scriptTooLong: "Script is too long (max {minutes} min)",
    videoGenerationStarted: "Video generation started!",
    failedStartVideoGeneration: "Failed to start video generation",
    script: "Script",
    scriptLinePlaceholder: "Write what the avatar will say…",
    estimated: "~{duration} estimated",
    chargedAt: "Charged at {perSec} credits/second. Max {maxMinutes} minutes. Refunded if generation fails.",
    starting: "Starting…",
    generateVideo: "Generate Video",
    generateVideoCost: "Generate Video · {cost} cr",
    generatingVideo: "Generating video…",
    videoReady: "Video ready!",
    videoFailedRefunded: "Video generation failed — credits refunded",
    realAvatars: "Real Avatars",
    realAvatarsSub: "Photo avatar generation · up to {max} per model",
    model: "Model",
    loadingModels: "Loading models…",
    noModelsYet: "No models yet. Create a model first.",
    selectModel: "Select model",
    noVoice: "No voice",
    voiceRequired: "Voice required",
    voiceRequiredNote: "All avatars use this model's default voice. Open Voice Studio to create or select one.",
    avatars: "Avatars ({count}/{max})",
    loadingAvatars: "Loading avatars…",
    newAvatarShort: "New Avatar",
    limitReached: "Limit reached",
    deleteToAdd: "Delete an avatar to add a new one",
    recentVideos: "Recent Videos",
    billingNote: "Active avatars are billed 500 credits/month to keep them live. Suspended avatars cannot generate videos.",
    tabPhoto: "Photo",
    tabVideo: "Video",
    tabGenerate: "Generate",
    tabVoices: "Voice Studio",
    tabAvatars: "Real Avatars",
    uploadFailedPrefix: "Upload failed: ",
    unknownError: "Unknown error",
    expandGenControls: "References, aspect ratio, and resolution",
    collapseGenControls: "Collapse",
  },
  ru: {
    generating: "Генерация…",
    failed: "Ошибка",
    save: "Сохранить",
    makeVideo: "Создать видео",
    enterPrompt: "Введите промпт",
    generationFailed: "Ошибка генерации",
    done: "Готово!",
    generationFailedRefunded: "Ошибка генерации — кредиты возвращены",
    promptPlaceholder: "Опишите сцену, которую вы представляете",
    refs: "Референсы",
    aspect: "Соотношение",
    res: "Разрешение",
    buttonGenerating: "Генерация…",
    buttonGenerateCost: "Создать · {cost}",
    creditsAvailable: "Доступно {credits} кредитов",
    imageGeneration: "Генерация изображений",
    imageGenerationSubtitle: "Модель не требуется · создавайте что угодно",
    tutorialImage: "нажмите для просмотра обучения — генерация изображений",
    tutorialVoice: "нажмите для просмотра обучения — голосовая студия",
    tutorialAvatars: "нажмите для просмотра обучения — реальные аватары",
    emptyState: "Ваши работы появятся здесь",
    errorEnterAvatarName: "Введите имя для аватара",
    errorUploadPhoto: "Загрузите фотографию",
    errorNoDefaultVoice: "У этой модели нет голоса по умолчанию. Сначала создайте его в Голосовой студии.",
    avatarSubmitted: "Аватар отправлен! Обработка начата — проверьте через несколько минут.",
    errorCreateAvatar: "Не удалось создать аватар",
    avatarDeleted: "Аватар удалён",
    newAvatar: "Новый аватар",
    slotsUsed: "Использовано {used}/{max} слотов",
    portraitPhoto: "Портретное фото",
    uploadPortraitPhoto: "Загрузить портретное фото",
    avatarName: "Имя аватара",
    avatarNamePlaceholder: "например, Студийный образ, Casual на улице…",
    voiceNoteHas: "Все аватары этой модели используют текущий голос по умолчанию.",
    voiceNoteMissing: "Откройте Голосовую студию, чтобы сначала создать и выбрать голос по умолчанию.",
    oneTimeCreationFee: "Единовременная плата за создание",
    insufficientCredits: "Недостаточно кредитов (доступно {credits}, требуется {required})",
    submitting: "Отправка…",
    createAvatarCost: "Создать аватар · {cost} кр",
    writeScript: "Напишите сценарий",
    scriptTooLong: "Сценарий слишком длинный (макс. {minutes} мин)",
    videoGenerationStarted: "Генерация видео запущена!",
    failedStartVideoGeneration: "Не удалось запустить генерацию видео",
    script: "Сценарий",
    scriptLinePlaceholder: "Напишите, что скажет аватар…",
    estimated: "~{duration} ориентировочно",
    chargedAt: "Списывается {perSec} кредитов/секунду. Макс. {maxMinutes} минут. Возвращается при ошибке генерации.",
    starting: "Запуск…",
    generateVideo: "Создать видео",
    generateVideoCost: "Создать видео · {cost} кр",
    generatingVideo: "Создание видео…",
    videoReady: "Видео готово!",
    videoFailedRefunded: "Ошибка создания видео — кредиты возвращены",
    realAvatars: "Реальные аватары",
    realAvatarsSub: "Создание фотоаватаров · до {max} на модель",
    model: "Модель",
    loadingModels: "Загрузка моделей…",
    noModelsYet: "Моделей пока нет. Сначала создайте модель.",
    selectModel: "Выбрать модель",
    noVoice: "Без голоса",
    voiceRequired: "Требуется голос",
    voiceRequiredNote: "Все аватары используют голос по умолчанию этой модели. Откройте Голосовую студию, чтобы создать или выбрать его.",
    avatars: "Аватары ({count}/{max})",
    loadingAvatars: "Загрузка аватаров…",
    newAvatarShort: "Новый аватар",
    limitReached: "Лимит достигнут",
    deleteToAdd: "Удалите аватар, чтобы добавить новый",
    recentVideos: "Последние видео",
    billingNote: "За активные аватары списывается 500 кредитов/месяц для поддержания работы. Приостановленные аватары не могут создавать видео.",
    tabPhoto: "Фото",
    tabVideo: "Видео",
    tabGenerate: "Создать",
    tabVoices: "Голосовая студия",
    tabAvatars: "Реальные аватары",
    uploadFailedPrefix: "Ошибка загрузки: ",
    unknownError: "Неизвестная ошибка",
    expandGenControls: "Референсы, формат и разрешение",
    collapseGenControls: "Свернуть",
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
const MAX_AVATARS = 3;
const WORDS_PER_SECOND = 2.5;
const MAX_VIDEO_SECONDS = 600;
const IMAGE_MODELS = [
  { id: "nano-banana-pro", label: "Nano Banana" },
  { id: "flux-kontext-pro", label: "Flux Kontext Pro" },
  { id: "flux-kontext-max", label: "Flux Kontext Max" },
  { id: "ideogram-v3-text", label: "Ideogram V3" },
  { id: "ideogram-v3-edit", label: "Ideogram V3 Edit" },
  { id: "ideogram-v3-remix", label: "Ideogram V3 Remix" },
  { id: "wan-2-7-image-pro", label: "Wan 2.7 Image Pro" },
  { id: "seedream-v4-5-edit", label: "Seedream v4.5 Edit" },
];
const VIDEO_FAMILIES = [
  { id: "sora2", label: "Sora 2 Pro" },
  { id: "kling30", label: "Kling 3.0" },
  { id: "kling26", label: "Kling 2.6" },
  { id: "veo31", label: "Veo 3.1" },
  { id: "wan22", label: "WAN 2.2" },
  { id: "seedance2", label: "Seedance 2.0" },
];

const VIDEO_DEFAULT_PRICING = Object.freeze({
  sora2Standard10Frames: 300,
  sora2Standard15Frames: 540,
  sora2High10Frames: 660,
  sora2High15Frames: 1260,
  sora2WatermarkRemoverPerSec: 6.4,
  kling30StdNoSoundPerSec: 14,
  kling30StdSoundPerSec: 20,
  kling30ProNoSoundPerSec: 18,
  kling30ProSoundPerSec: 27,
  kling26NoSound5s: 55,
  kling26NoSound10s: 110,
  kling26Sound5s: 110,
  kling26Sound10s: 220,
  veo31GenerateFast1080p8s: 60,
  veo31GenerateQuality1080p8s: 250,
  veo31ExtendFast: 60,
  veo31ExtendQuality: 250,
  veo31Render1080p: 5,
  wan22AnimateMove720pPerSec: 12.5,
  wan22AnimateMove580pPerSec: 9.5,
  wan22AnimateMove480pPerSec: 6,
  wan22AnimateReplace720pPerSec: 12.5,
  wan22AnimateReplace580pPerSec: 9.5,
  wan22AnimateReplace480pPerSec: 6,
  seedance2Standard480WithVideoPerSec: 23,
  seedance2Standard480NoVideoPerSec: 38,
  seedance2Standard720WithVideoPerSec: 50,
  seedance2Standard720NoVideoPerSec: 82,
  seedance2Fast480WithVideoPerSec: 16,
  seedance2Fast480NoVideoPerSec: 31,
  seedance2Fast720WithVideoPerSec: 40,
  seedance2Fast720NoVideoPerSec: 66,
});

function toPrice(source, key) {
  const value = source?.[key];
  return Number.isFinite(value) ? value : VIDEO_DEFAULT_PRICING[key];
}

function getDurationConfig(family, mode) {
  if (family === "kling30") {
    return { min: 3, max: 15, step: 1, fixed: false };
  }
  if (family === "kling26") {
    return { min: 5, max: 10, step: 5, fixed: false };
  }
  if (family === "veo31") {
    return { min: 8, max: 8, step: 1, fixed: true };
  }
  if (family === "seedance2" && mode === "edit") {
    return { min: 8, max: 8, step: 1, fixed: true };
  }
  if (family === "seedance2") {
    return { min: 4, max: 12, step: 4, fixed: false };
  }
  if (family === "wan22") {
    return { min: 5, max: 5, step: 1, fixed: true };
  }
  return { min: 10, max: 15, step: 5, fixed: false };
}

function getVideoModesByFamily(family) {
  if (family === "veo31") return ["ref2v", "t2v", "i2v", "extend"];
  if (family === "wan22") return ["move", "replace"];
  if (family === "seedance2") return ["t2v", "i2v", "edit", "multi-ref"];
  return ["t2v", "i2v"];
}

function defaultModeByFamily(family) {
  if (family === "veo31") return "ref2v";
  if (family === "wan22") return "move";
  return "t2v";
}

function estimateSecs(script) {
  if (!script?.trim()) return 0;
  return Math.max(5, Math.round(script.trim().split(/\s+/).length / WORDS_PER_SECOND));
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------
function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="px-3 py-2.5 min-h-[44px] md:min-h-0 md:px-2.5 md:py-1.5 rounded-xl md:rounded-lg text-xs md:text-[11px] font-semibold whitespace-nowrap transition-all select-none inline-flex items-center justify-center"
      style={active ? {
        background: "rgba(139,92,246,0.28)",
        color: "#e9d5ff",
        border: "1px solid rgba(139,92,246,0.55)",
        boxShadow: "0 0 8px 1px rgba(139,92,246,0.25)",
      } : {
        color: "rgba(148,163,184,1)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}
    >
      {children}
    </button>
  );
}

function ToggleGroup({ value, onChange, options, className = "" }) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              isActive
                ? "bg-violet-600 text-white shadow-[0_0_8px_rgba(139,92,246,0.4)]"
                : "bg-white/5 border border-white/15 text-slate-300 hover:bg-white/10 hover:border-white/25"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RefSlot({ url, onRemove, onAdd, uploading }) {
  const inputRef = useRef(null);
  if (url) {
    return (
      <div className="relative w-11 h-11 md:w-10 md:h-10 rounded-xl overflow-hidden border border-white/10 flex-shrink-0 group">
        <img src={url} alt="" className="w-full h-full object-cover" />
        <button
          onClick={onRemove}
          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-4 h-4 md:w-3.5 md:h-3.5 text-white" />
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-11 h-11 md:w-10 md:h-10 rounded-xl border border-white/10 flex items-center justify-center flex-shrink-0 hover:border-white/30 hover:bg-white/5 transition-all text-slate-500 hover:text-white disabled:opacity-40"
      >
        {uploading ? <Loader2 className="w-4 h-4 md:w-3.5 md:h-3.5 animate-spin" /> : <Plus className="w-4 h-4 md:w-3.5 md:h-3.5" />}
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAdd(f); e.target.value = ""; }}
      />
    </>
  );
}

function MediaUploadField({ label, value, onUploaded, accept = "image/*", preview = "image" }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const uploadOne = useCallback(async (file) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const result = await uploadFile(file);
      const url = result?.url || result;
      if (!url) throw new Error("No URL returned");
      onUploaded(url);
    } catch (err) {
      toast.error(`Upload failed: ${err?.message || "Unknown error"}`);
    } finally {
      setIsUploading(false);
    }
  }, [onUploaded]);

  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-slate-400">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => uploadOne(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          uploadOne(e.dataTransfer?.files?.[0]);
        }}
        className={`w-full rounded-xl border border-dashed transition-all flex items-center justify-center overflow-hidden ${
          isDragging ? "border-violet-400 bg-violet-500/10" : "border-white/20 bg-black/30 hover:border-white/35 hover:bg-white/[0.04]"
        } ${value ? "h-20" : "h-[72px]"}`}
      >
        {value ? (
          <div className="flex items-center gap-3 w-full px-3">
            {preview === "video" ? (
              <div className="w-12 h-12 rounded-lg border border-white/20 bg-black/60 flex items-center justify-center flex-shrink-0">
                <Video className="w-5 h-5 text-slate-300" />
              </div>
            ) : preview === "audio" ? (
              <div className="w-12 h-12 rounded-lg border border-white/20 bg-black/60 flex items-center justify-center flex-shrink-0">
                <Mic className="w-5 h-5 text-slate-300" />
              </div>
            ) : (
              <img src={value} alt="" className="w-12 h-12 rounded-lg object-cover border border-white/20 flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1 text-left">
              <p className="text-xs text-slate-300 truncate font-medium">Uploaded</p>
              <p className="text-[10px] text-slate-500 truncate mt-0.5">{value.split("/").pop()}</p>
            </div>
            <span className="text-[11px] text-slate-400 flex-shrink-0">Replace</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 px-4">
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
            ) : (
              <div className="w-7 h-7 rounded-lg border border-white/20 bg-white/[0.06] flex items-center justify-center">
                <Plus className="w-4 h-4 text-slate-300" />
              </div>
            )}
            <span className="text-[11px] text-slate-500 text-center leading-tight">
              {isUploading ? "Uploading…" : "Click or drag to upload"}
            </span>
          </div>
        )}
      </button>
    </div>
  );
}

function SeedanceAssetModal({ isOpen, onClose, onSelect }) {
  const [assets, setAssets] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetType, setAssetType] = useState("image");
  const [isCreating, setIsCreating] = useState(false);
  const assetAccept = assetType === "video" ? "video/*" : assetType === "audio" ? "audio/*" : "image/*";
  const assetLabel = assetType === "video" ? "Upload source video" : assetType === "audio" ? "Upload source audio" : "Upload source image";
  const refresh = useCallback(async () => {
    if (!isOpen) return;
    setIsLoading(true);
    try {
      const data = await creatorStudioAPI.listAssets();
      setAssets(data?.assets || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to load assets");
    } finally {
      setIsLoading(false);
    }
  }, [isOpen]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0c0f14] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-white">Seedance Assets</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="rounded-xl border border-white/10 p-3 bg-black/20 mb-3">
          <p className="text-xs text-slate-400 mb-2">Create asset (100 credits)</p>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <div className="md:col-span-3">
              <MediaUploadField
                label={assetLabel}
                value={sourceUrl}
                onUploaded={setSourceUrl}
                accept={assetAccept}
                preview={assetType === "video" ? "video" : assetType === "audio" ? "audio" : "image"}
              />
            </div>
            <input
              value={assetName}
              onChange={(e) => setAssetName(e.target.value.slice(0, 80))}
              placeholder="Asset name (optional)"
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none"
            />
            <select
              value={assetType}
              onChange={(e) => {
                setAssetType(e.target.value);
                setSourceUrl("");
              }}
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white outline-none"
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
            </select>
            <button
              type="button"
              disabled={isCreating || !sourceUrl.trim()}
              onClick={async () => {
                setIsCreating(true);
                try {
                  await creatorStudioAPI.createAsset({
                    url: sourceUrl.trim(),
                    assetType,
                    name: assetName.trim() || undefined,
                  });
                  setSourceUrl("");
                  setAssetName("");
                  await refresh();
                  toast.success("Asset created");
                } catch (err) {
                  toast.error(err?.response?.data?.message || err?.message || "Asset create failed");
                } finally {
                  setIsCreating(false);
                }
              }}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-40"
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
        <div className="max-h-[46vh] overflow-auto space-y-2 pr-1">
          {isLoading && <p className="text-sm text-slate-400">Loading assets...</p>}
          {!isLoading && assets.length === 0 && <p className="text-sm text-slate-500">No assets yet.</p>}
          {!isLoading && assets.map((asset) => (
            <div key={asset.id} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg border border-white/15 bg-black/50 overflow-hidden flex items-center justify-center flex-shrink-0">
                {asset.assetType === "image" && asset.sourceUrl ? (
                  <img src={asset.sourceUrl} alt={asset.name || "asset"} className="w-full h-full object-cover" />
                ) : asset.assetType === "video" && asset.sourceUrl ? (
                  <video src={asset.sourceUrl} className="w-full h-full object-cover" muted />
                ) : asset.assetType === "audio" ? (
                  <Mic className="w-4 h-4 text-slate-300" />
                ) : (
                  <Video className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-200 truncate">{asset.name || "Untitled asset"}</p>
                <p className="text-xs text-slate-300 truncate">{asset.assetUri || "asset://pending"}</p>
                <p className="text-[11px] text-slate-500 truncate">{asset.assetType || "unknown"} · {asset.status}</p>
              </div>
              <button
                type="button"
                disabled={asset.status !== "completed" || !asset.assetUri}
                onClick={() => onSelect(asset)}
                className="px-2.5 py-1.5 rounded-md text-xs bg-white/10 text-slate-200 hover:bg-white/15 disabled:opacity-40"
              >
                Use
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await creatorStudioAPI.deleteAsset(asset.id);
                    await refresh();
                  } catch (err) {
                    toast.error(err?.response?.data?.message || err?.message || "Delete failed");
                  }
                }}
                className="text-slate-500 hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MaskEditorModal({ isOpen, imageUrl, onClose, onSave }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [brushSize, setBrushSize] = useState(28);
  const [drawing, setDrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !imageUrl || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    img.src = imageUrl;
  }, [isOpen, imageUrl]);

  if (!isOpen) return null;

  const drawAt = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0c1016] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold">Mask Editor</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-2">Paint white where Ideogram should edit. Black stays unchanged.</p>
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs text-slate-400">Brush</span>
          <input type="range" min={4} max={120} step={1} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-48 accent-violet-500" />
          <span className="text-xs text-slate-300">{brushSize}px</span>
          <button
            type="button"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const ctx = canvas.getContext("2d");
              ctx.fillStyle = "black";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }}
            className="ml-auto px-3 py-1.5 rounded-lg bg-white/10 text-slate-200 text-xs hover:bg-white/15"
          >
            Clear
          </button>
        </div>
        <div className="relative rounded-xl overflow-hidden border border-white/15 bg-black/40">
          {imageUrl ? (
            <>
              <img src={imageUrl} alt="" className="w-full max-h-[60vh] object-contain pointer-events-none select-none" />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full cursor-crosshair opacity-80"
                onMouseDown={(e) => {
                  setDrawing(true);
                  drawAt(e.clientX, e.clientY);
                }}
                onMouseMove={(e) => {
                  if (!drawing) return;
                  drawAt(e.clientX, e.clientY);
                }}
                onMouseUp={() => setDrawing(false)}
                onMouseLeave={() => setDrawing(false)}
              />
            </>
          ) : (
            <div className="h-60 flex items-center justify-center text-slate-500 text-sm">Upload/select an input image first</div>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={!imageUrl || isSaving}
            onClick={async () => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              setIsSaving(true);
              try {
                const maskDataUrl = canvas.toDataURL("image/png");
                await onSave(maskDataUrl);
              } finally {
                setIsSaving(false);
              }
            }}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-40"
          >
            {isSaving ? "Uploading..." : "Use Mask"}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseOutputUrls(outputUrl) {
  if (!outputUrl) return [];
  if (Array.isArray(outputUrl)) return outputUrl.filter(Boolean);
  if (typeof outputUrl === "string" && outputUrl.startsWith("[")) {
    try {
      const parsed = JSON.parse(outputUrl);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [outputUrl];
}

function ResultCard({ gen, onExpand }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const isProcessing = gen.status === "processing" || gen.status === "pending";
  const isFailed     = gen.status === "failed";
  const outputUrls = parseOutputUrls(gen.outputUrl);
  const previewUrl = outputUrls[0] || null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="relative rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.03] group"
      style={{ aspectRatio: "1/1", minWidth: 220, maxWidth: 420, width: "100%" }}
    >
      {gen.status === "completed" && previewUrl ? (
        <>
          <img src={previewUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-3 gap-2">
            <button onClick={() => onExpand(gen)}
              className="w-8 h-8 rounded-lg bg-black/50 flex items-center justify-center text-white hover:bg-black/70 backdrop-blur-sm">
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadFromPublicUrl(previewUrl, `creator-${gen.id}.jpg`);
              }}
              className="w-8 h-8 rounded-lg bg-black/50 flex items-center justify-center text-white hover:bg-black/70 backdrop-blur-sm"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
          {gen.prompt && (
            <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
              <p className="text-[11px] text-white/70 truncate">{gen.prompt}</p>
            </div>
          )}
        </>
      ) : isProcessing ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          <p className="text-xs text-slate-400">{copy.generating}</p>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <AlertCircle className="w-6 h-6 text-red-400/60" />
          <p className="text-[11px] text-red-400/70">{gen.errorMessage || copy.failed}</p>
        </div>
      )}
    </motion.div>
  );
}

function Lightbox({ gen, onClose }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  if (!gen) return null;
  const outputUrls = parseOutputUrls(gen.outputUrl);
  const previewUrl = outputUrls[0] || "";
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
        className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={previewUrl} alt="" className="max-w-full max-h-[90vh] rounded-2xl object-contain" />
        <button onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80">
          <X className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
          onClick={(e) => {
            e.stopPropagation();
            downloadFromPublicUrl(previewUrl, `creator-${gen.id}.jpg`);
          }}
        >
          <Download className="w-3.5 h-3.5" /> {copy.save}
        </button>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Real Avatars sub-components
// ---------------------------------------------------------------------------
function StatusBadge({ status }) {
  const map = {
    processing: { label: "Processing", cls: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
    ready:      { label: "Ready",      cls: "text-green-400 bg-green-400/10 border-green-400/20" },
    failed:     { label: "Failed",     cls: "text-red-400 bg-red-400/10 border-red-400/20" },
    suspended:  { label: "Suspended",  cls: "text-slate-400 bg-slate-400/10 border-slate-400/20" },
  };
  const s = map[status] || map.failed;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s.cls}`}>
      {status === "processing" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status === "ready"      && <CheckCircle className="w-2.5 h-2.5" />}
      {status === "suspended"  && <PauseCircle className="w-2.5 h-2.5" />}
      {s.label}
    </span>
  );
}

function AvatarCard({ avatar, onDelete, onMakeVideo, deleting }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="relative flex flex-col rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03] group"
    >
      {/* Photo */}
      <div className="relative" style={{ aspectRatio: "3/4" }}>
        <img src={avatar.photoUrl} alt={avatar.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute top-2 left-2">
          <StatusBadge status={avatar.status} />
        </div>
        <button
          onClick={() => onDelete(avatar)}
          disabled={deleting === avatar.id}
          className="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-black/50 text-slate-400 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-40"
        >
          {deleting === avatar.id
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Trash2 className="w-3.5 h-3.5" />}
        </button>
        {avatar.status === "failed" && avatar.errorMessage && (
          <div className="absolute bottom-10 left-2 right-2">
            <p className="text-[10px] text-red-400/80 line-clamp-2">{avatar.errorMessage}</p>
          </div>
        )}
        <div className="absolute bottom-2 left-3 right-3">
          <p className="text-sm font-semibold text-white truncate">{avatar.name}</p>
        </div>
      </div>
      {/* Action */}
      <div className="p-3">
        <button
          onClick={() => onMakeVideo(avatar)}
          disabled={avatar.status !== "ready"}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={avatar.status === "ready" ? {
            background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(79,70,229,0.3))",
            border: "1px solid rgba(139,92,246,0.4)",
            color: "#e9d5ff",
          } : {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(148,163,184,0.5)",
          }}
        >
          <Video className="w-3.5 h-3.5" />
          {copy.makeVideo}
        </button>
      </div>
    </motion.div>
  );
}

function CreateAvatarModal({ isOpen, onClose, model, avatarCount, onCreated }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const user = useAuthStore(s => s.user);
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);
  const COST = 1000;

  const reset = () => { setName(""); setPhoto(null); setPhotoPreview(null); };

  const handlePhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    setPhotoPreview(URL.createObjectURL(f));
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (!name.trim())  return toast.error(copy.errorEnterAvatarName);
    if (!photo)        return toast.error(copy.errorUploadPhoto);
    if (!model?.elevenLabsVoiceId) return toast.error(copy.errorNoDefaultVoice);

    setSubmitting(true);
    try {
      const photoUrl = await uploadFile(photo);
      const data = await avatarAPI.create({
        modelId: model.id,
        name: name.trim(),
        photoUrl,
      });
      toast.success(copy.avatarSubmitted);
      reset();
      onCreated(data.avatar);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || copy.errorCreateAvatar);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  const hasVoice = Boolean(model?.elevenLabsVoiceId);
  const credits = user?.credits ?? 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) { reset(); onClose(); } }}>
      <motion.div initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }}
        className="w-full max-w-sm rounded-2xl border border-white/10 overflow-hidden"
        style={{ background: "linear-gradient(135deg, rgba(20,15,30,0.98) 0%, rgba(15,10,25,0.98) 100%)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}>
              <User className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{copy.newAvatar}</h3>
              <p className="text-[11px] text-slate-500">{formatCopy(copy.slotsUsed, { used: avatarCount, max: MAX_AVATARS })}</p>
            </div>
          </div>
          <button onClick={() => { reset(); onClose(); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Photo upload */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
              {copy.portraitPhoto}
            </label>
            {photoPreview ? (
              <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: "3/4", maxHeight: 180 }}>
                <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                <button onClick={() => { setPhoto(null); setPhotoPreview(null); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-8 rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center gap-2 text-slate-500 hover:border-purple-500/40 hover:text-purple-400 transition-colors">
                <Plus className="w-6 h-6" />
                <span className="text-xs">{copy.uploadPortraitPhoto}</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhoto} />
          </div>

          {/* Name */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
              {copy.avatarName}
            </label>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder={copy.avatarNamePlaceholder}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50"
            />
          </div>

          {/* Voice status */}
          <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl ${
            hasVoice ? "bg-green-400/5 border border-green-400/15" : "bg-amber-400/5 border border-amber-400/15"}`}>
            <Mic className={`w-4 h-4 mt-0.5 flex-shrink-0 ${hasVoice ? "text-green-400" : "text-amber-400"}`} />
            <div>
              <p className={`text-xs font-semibold ${hasVoice ? "text-green-300" : "text-amber-300"}`}>
                {hasVoice ? `Default voice: ${model.elevenLabsVoiceName || model.elevenLabsVoiceType || "Saved voice"}` : "No default voice configured"}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {hasVoice
                  ? copy.voiceNoteHas
                  : copy.voiceNoteMissing}
              </p>
            </div>
          </div>

          {/* Cost */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <span className="text-xs text-slate-400">{copy.oneTimeCreationFee}</span>
            <span className="flex items-center gap-1 text-sm font-bold text-white">
              {COST} <Coins className="w-3.5 h-3.5 text-yellow-400" />
            </span>
          </div>
          {credits < COST && (
            <p className="text-xs text-red-400 text-center">
              {formatCopy(copy.insufficientCredits, { credits, required: COST })}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={handleSubmit}
            disabled={submitting || !hasVoice || credits < COST || !name.trim() || !photo}
            className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            style={{
              background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #4f46e5 100%)",
              boxShadow: "0 0 0 1px rgba(139,92,246,0.4), 0 0 18px rgba(109,40,217,0.3)",
              color: "white",
            }}
          >
            {submitting
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{copy.submitting}</span>
              : formatCopy(copy.createAvatarCost, { cost: COST })}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function GenerateVideoModal({ isOpen, avatar, model, onClose, onGenerated }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const user = useAuthStore(s => s.user);
  const [script, setScript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const PER_SEC = 5;

  const secs = estimateSecs(script);
  const cost = secs * PER_SEC;
  const tooLong = secs > MAX_VIDEO_SECONDS;
  const credits = user?.credits ?? 0;

  const handleSubmit = async () => {
    if (!script.trim()) return toast.error(copy.writeScript);
    if (tooLong) return toast.error(formatCopy(copy.scriptTooLong, { minutes: MAX_VIDEO_SECONDS / 60 }));

    setSubmitting(true);
    try {
      const data = await avatarAPI.generateVideo(avatar.id, { script: script.trim() });
      toast.success(copy.videoGenerationStarted);
      setScript("");
      onGenerated(data.video);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || copy.failedStartVideoGeneration);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !avatar) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) { setScript(""); onClose(); } }}>
      <motion.div initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border border-white/10 overflow-hidden"
        style={{ background: "linear-gradient(135deg, rgba(20,15,30,0.98) 0%, rgba(15,10,25,0.98) 100%)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <img src={avatar.photoUrl} alt="" className="w-9 h-9 rounded-xl object-cover" />
            <div>
              <h3 className="text-sm font-bold text-white">{avatar.name}</h3>
              <p className="text-[11px] text-slate-500">
                Voice: {model?.elevenLabsVoiceName || "Custom"}
              </p>
            </div>
          </div>
          <button onClick={() => { setScript(""); onClose(); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Script input */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
              {copy.script}
            </label>
            <textarea
              value={script} onChange={(e) => setScript(e.target.value)}
              placeholder={copy.scriptLinePlaceholder}
              rows={5}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50 resize-none"
            />
          </div>

          {/* Duration + cost estimate */}
          {script.trim() && (
            <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${
              tooLong ? "bg-red-400/5 border-red-400/20" : "bg-white/[0.03] border-white/[0.06]"}`}>
              <div className="flex items-center gap-1.5">
                <Clock className={`w-3.5 h-3.5 ${tooLong ? "text-red-400" : "text-slate-500"}`} />
                <span className={`text-xs ${tooLong ? "text-red-400" : "text-slate-400"}`}>
                  {formatCopy(copy.estimated, { duration: secs < 60 ? `${secs}s` : `${(secs / 60).toFixed(1)}m` })}
                  {tooLong && ` (max ${MAX_VIDEO_SECONDS / 60}m)`}
                </span>
              </div>
              <span className="flex items-center gap-1 text-sm font-bold text-white">
                {cost} <Coins className="w-3.5 h-3.5 text-yellow-400" />
              </span>
            </div>
          )}

          {/* Info pill */}
          <div className="flex items-start gap-2 text-[11px] text-slate-500">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{formatCopy(copy.chargedAt, { perSec: PER_SEC, maxMinutes: MAX_VIDEO_SECONDS / 60 })}</span>
          </div>

          {credits < cost && script.trim() && (
            <p className="text-xs text-red-400 text-center">
              {formatCopy(copy.insufficientCredits, { credits, required: `~${cost}` })}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={handleSubmit}
            disabled={submitting || !script.trim() || tooLong || (script.trim() && credits < cost)}
            className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            style={{
              background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #4f46e5 100%)",
              boxShadow: "0 0 0 1px rgba(139,92,246,0.4), 0 0 18px rgba(109,40,217,0.3)",
              color: "white",
            }}
          >
            {submitting
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{copy.starting}</span>
              : (script.trim() ? formatCopy(copy.generateVideoCost, { cost }) : copy.generateVideo)}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function VideoCard({ video }) {
  const isProcessing = video.status === "processing";
  const isFailed     = video.status === "failed";
  const isCompleted  = video.status === "completed";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.07] bg-white/[0.03] overflow-hidden"
    >
      {isCompleted && video.outputUrl ? (
        <div className="relative">
          <video
            src={video.outputUrl} controls className="w-full rounded-t-2xl"
            style={{ maxHeight: 280 }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center bg-white/[0.02] rounded-t-2xl" style={{ height: 140 }}>
          {isProcessing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-7 h-7 animate-spin text-purple-400" />
              <p className="text-xs text-slate-500">{copy.generatingVideo}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="w-6 h-6 text-red-400/60" />
              <p className="text-xs text-red-400/70">{video.errorMessage || "Failed"}</p>
            </div>
          )}
        </div>
      )}
      <div className="px-3 py-2.5 flex items-start justify-between gap-2">
        <p className="text-xs text-slate-400 line-clamp-2 flex-1">{video.script}</p>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <StatusBadge status={video.status} />
          {video.duration && (
            <span className="text-[10px] text-slate-600 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />{Math.round(video.duration)}s
            </span>
          )}
          <span className="text-[10px] text-slate-600 flex items-center gap-1">
            {video.creditsCost} <Coins className="w-2.5 h-2.5 text-yellow-500/60" />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Real Avatars tab content
// ---------------------------------------------------------------------------
function RealAvatarsTab({ sidebarCollapsed }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const queryClient = useQueryClient();
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [makeVideoFor, setMakeVideoFor] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [videos, setVideos] = useState([]);
  const [modelDropOpen, setModelDropOpen] = useState(false);
  const { byKey } = useTutorialCatalog();

  // Load user models
  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: () => modelAPI.getAll(),
    staleTime: 60_000,
  });

  const models = modelsData?.models ?? modelsData ?? [];

  // Auto-select first model
  useEffect(() => {
    if (!selectedModelId && models.length > 0) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  const selectedModel = models.find(m => m.id === selectedModelId);

  // Load avatars for selected model
  const {
    data: avatarData,
    isLoading: avatarsLoading,
    refetch: refetchAvatars,
  } = useQuery({
    queryKey: ["avatars", selectedModelId],
    queryFn: () => avatarAPI.list(selectedModelId),
    enabled: Boolean(selectedModelId),
    staleTime: 10_000,
    refetchInterval: (data) => {
      const hasProcessing = data?.avatars?.some(a => a.status === "processing");
      return hasProcessing ? 8_000 : false;
    },
  });

  const avatars = avatarData?.avatars ?? [];
  const modelForDisplay = avatarData?.model ?? selectedModel;

  // Poll processing videos
  useEffect(() => {
    const processingVideos = videos.filter(v => v.status === "processing");
    if (!processingVideos.length) return;

    const interval = setInterval(async () => {
      for (const vid of processingVideos) {
        try {
          const data = await avatarAPI.getVideoStatus(vid.id);
          const updated = data.video;
          if (updated.status !== vid.status) {
            setVideos(prev => prev.map(v => v.id === updated.id ? updated : v));
            if (updated.status === "completed") {
              toast.success(copy.videoReady);
            } else if (updated.status === "failed") {
              toast.error(copy.videoFailedRefunded);
            }
          }
        } catch { /* ignore */ }
      }
    }, 6_000);

    return () => clearInterval(interval);
  }, [videos]);

  const handleDelete = async (avatar) => {
    if (!confirm(`Delete avatar "${avatar.name}"? This cannot be undone.`)) return;
    setDeletingId(avatar.id);
    try {
      await avatarAPI.delete(avatar.id);
      toast.success(copy.avatarDeleted);
      queryClient.invalidateQueries({ queryKey: ["avatars", selectedModelId] });
    } catch (err) {
      toast.error(err.response?.data?.error || "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreated = (newAvatar) => {
    queryClient.invalidateQueries({ queryKey: ["avatars", selectedModelId] });
  };

  const handleVideoGenerated = (newVideo) => {
    setVideos(prev => [newVideo, ...prev]);
    // Also populate from avatar's existing videos on next open
    queryClient.invalidateQueries({ queryKey: ["avatars", selectedModelId] });
  };

  // Merge avatar videos into the feed on load
  useEffect(() => {
    if (!avatars.length) return;
    const allVideos = avatars.flatMap(a => a.videos ?? []);
    setVideos(prev => {
      const existingIds = new Set(prev.map(v => v.id));
      const newVideos = allVideos.filter(v => !existingIds.has(v.id));
      if (!newVideos.length) return prev;
      return [...newVideos, ...prev].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    });
  }, [avatars]);

  const canCreate = avatars.length < MAX_AVATARS;

  return (
    <div className="flex flex-col min-h-full px-6 pt-6 pb-8">

      {/* Section header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)" }}>
          <User className="w-4 h-4 text-white" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">{copy.realAvatars}</h2>
          <p className="text-[11px] text-slate-500">{formatCopy(copy.realAvatarsSub, { max: MAX_AVATARS })}</p>
          <TutorialInfoLink
            className="mt-1"
            tutorialUrl={byKey?.["creator.real-avatars"]?.url || null}
          />
        </div>
      </div>

      {/* Model picker */}
      <div className="mb-6">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{copy.model}</p>
        {modelsLoading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> {copy.loadingModels}
          </div>
        ) : models.length === 0 ? (
          <p className="text-sm text-slate-500">{copy.noModelsYet}</p>
        ) : (
          <div className="relative w-64">
            <button
              onClick={() => setModelDropOpen(o => !o)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-sm text-white hover:border-white/20 transition-colors"
            >
              <span className="flex items-center gap-2">
                {selectedModel?.thumbnail && (
                  <img src={selectedModel.thumbnail} alt="" className="w-6 h-6 rounded-lg object-cover" />
                )}
                <span className="truncate">{selectedModel?.name || copy.selectModel}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${modelDropOpen ? "rotate-180" : ""}`} />
            </button>
            {modelDropOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-white/10 overflow-hidden z-30"
                style={{ background: "rgba(15,10,25,0.97)" }}>
                {models.map(m => (
                  <button key={m.id}
                    onClick={() => { setSelectedModelId(m.id); setModelDropOpen(false); setVideos([]); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-white/5 transition-colors"
                  >
                    {m.thumbnail && <img src={m.thumbnail} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />}
                    <div>
                      <p className="text-white font-medium truncate">{m.name}</p>
                      <p className="text-[10px] text-slate-500">{m.elevenLabsVoiceId ? `Voice: ${m.elevenLabsVoiceName || "Custom"}` : copy.noVoice}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Voice warning */}
      {selectedModel && !selectedModel.elevenLabsVoiceId && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl mb-6 bg-amber-400/5 border border-amber-400/20">
          <Mic className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-300">{copy.voiceRequired}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {copy.voiceRequiredNote}
            </p>
          </div>
        </div>
      )}

      {/* Avatars grid */}
      {selectedModelId && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            {formatCopy(copy.avatars, { count: avatars.length, max: MAX_AVATARS })}
          </p>

          {avatarsLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-6">
              <Loader2 className="w-4 h-4 animate-spin" /> {copy.loadingAvatars}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-6" style={{ maxWidth: 680 }}>
              <AnimatePresence>
                {avatars.map(av => (
                  <AvatarCard
                    key={av.id}
                    avatar={av}
                    onDelete={handleDelete}
                    onMakeVideo={av => setMakeVideoFor(av)}
                    deleting={deletingId}
                  />
                ))}
              </AnimatePresence>

              {/* New avatar slot */}
              {canCreate && (
                <motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  onClick={() => setShowCreate(true)}
                  disabled={!selectedModel?.elevenLabsVoiceId}
                  className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/10 hover:border-purple-500/40 hover:bg-purple-500/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed group"
                  style={{ aspectRatio: "3/4" }}
                >
                  <Plus className="w-6 h-6 text-slate-600 group-hover:text-purple-400 transition-colors mb-1" />
                  <span className="text-[11px] text-slate-600 group-hover:text-purple-400 transition-colors font-medium">
                    {copy.newAvatarShort}
                  </span>
                  <span className="text-[10px] text-slate-700 mt-0.5 flex items-center gap-1">
                    1000 <Coins className="w-2.5 h-2.5 text-yellow-500/60" />
                  </span>
                </motion.button>
              )}

              {!canCreate && avatars.length >= MAX_AVATARS && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-center"
                  style={{ aspectRatio: "3/4" }}>
                  <span className="text-[11px] text-slate-600">{copy.limitReached}</span>
                  <span className="text-[10px] text-slate-700 mt-1">{copy.deleteToAdd}</span>
                </div>
              )}
            </div>
          )}

          {/* Monthly billing info */}
          {avatars.filter(a => a.status !== "failed").length > 0 && (
            <div className="flex items-start gap-2 mb-6 text-[11px] text-slate-600">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-700" />
              <span>{copy.billingNote}</span>
            </div>
          )}
        </div>
      )}

      {/* Videos feed */}
      {videos.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            {copy.recentVideos}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" style={{ maxWidth: 900 }}>
            <AnimatePresence>
              {videos.map(v => <VideoCard key={v.id} video={v} />)}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showCreate && (
          <CreateAvatarModal
            isOpen={showCreate}
            onClose={() => setShowCreate(false)}
            model={modelForDisplay || selectedModel}
            avatarCount={avatars.length}
            onCreated={handleCreated}
          />
        )}
        {makeVideoFor && (
          <GenerateVideoModal
            isOpen={Boolean(makeVideoFor)}
            avatar={makeVideoFor}
            model={modelForDisplay || selectedModel}
            onClose={() => setMakeVideoFor(null)}
            onGenerated={handleVideoGenerated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — tab switcher wrapping both sections
// ---------------------------------------------------------------------------
const TABS = [
  { id: "generate",    label: "Photo",        icon: Sparkles, desc: "Advanced image generation · no model required" },
  { id: "video",       label: "Video",        icon: Video, desc: "Model-family video generation sheet" },
  { id: "voices",      label: "Voice Studio", icon: Mic,  desc: "Custom voice audio" },
  { id: "avatars",     label: "Real Avatars",  icon: User, desc: "Photo avatar videos" },
];

export default function CreatorStudioPage({ sidebarCollapsed = false, initialTab = "generate", initialModelId = null }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const [activeTab, setActiveTab] = useState(initialTab);
  const user        = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const { byKey } = useTutorialCatalog();
  const visibleTabs = TABS;

  // NanoBanana state
  const [prompt, setPrompt]             = useState("");
  const [imageModel, setImageModel]     = useState("nano-banana-pro");
  const [imageInputUrl, setImageInputUrl] = useState("");
  const [imageMaskUrl, setImageMaskUrl] = useState("");
  const [imageNumOutputs, setImageNumOutputs] = useState(1);
  const [ideogramRenderingSpeed, setIdeogramRenderingSpeed] = useState("BALANCED");
  const [fluxPromptUpsampling, setFluxPromptUpsampling] = useState(false);
  const [fluxSafetyTolerance, setFluxSafetyTolerance] = useState(2);
  const [wanThinkingMode, setWanThinkingMode] = useState(false);
  const [wanColorPaletteText, setWanColorPaletteText] = useState("");
  const [wanBboxListText, setWanBboxListText] = useState("");
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [refs, setRefs]                 = useState(Array(MAX_REFS).fill(null));
  const [uploadingIdx, setUploadingIdx] = useState(null);
  const [aspectRatio, setAspectRatio]   = useState("1:1");
  const [resolution, setResolution]     = useState("1K");
  const { activeGeneration, isGenerating, startGeneration, pollForCompletion, reset } = useActiveGeneration();
  const [history, setHistory]           = useState([]);
  const [videoHistory, setVideoHistory] = useState([]);
  const [lightboxGen, setLightboxGen]   = useState(null);
  const [mobileGenBarExpanded, setMobileGenBarExpanded] = useState(false);
  const [videoFamily, setVideoFamily] = useState("kling30");
  const [videoMode, setVideoMode] = useState("t2v");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoImageUrl, setVideoImageUrl] = useState("");
  const [videoRefImageUrl, setVideoRefImageUrl] = useState("");
  const [videoEndFrameUrl, setVideoEndFrameUrl] = useState("");
  const [videoThirdImageUrl, setVideoThirdImageUrl] = useState("");
  const [videoInputVideoUrl, setVideoInputVideoUrl] = useState("");
  const [videoDuration, setVideoDuration] = useState(8);
  const [videoNFrames, setVideoNFrames] = useState("10");
  const [videoSize, setVideoSize] = useState("standard");
  const [soraQuality, setSoraQuality] = useState("standard");
  const [soraRemoveWatermark, setSoraRemoveWatermark] = useState(false);
  const [videoSpeed, setVideoSpeed] = useState("fast");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [veoSeed, setVeoSeed] = useState("");
  const [veoEnableTranslation, setVeoEnableTranslation] = useState(true);
  const [veoWatermark, setVeoWatermark] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundPrompt, setSoundPrompt] = useState("");
  const [kling30Quality, setKling30Quality] = useState("std");
  const [kling30MultiShot, setKling30MultiShot] = useState(false);
  const [kling30Shots, setKling30Shots] = useState([{ prompt: "", duration: 5 }]);
  const [klingElements, setKlingElements] = useState([]);
  const [klingElementName, setKlingElementName] = useState("");
  const [klingElementDescription, setKlingElementDescription] = useState("");
  const [klingElementMediaUrls, setKlingElementMediaUrls] = useState(["", "", "", ""]);
  const [seedanceTaskType, setSeedanceTaskType] = useState("seedance-2-preview");
  const [seedanceResolution, setSeedanceResolution] = useState("720p");
  const [seedanceGenerateAudio, setSeedanceGenerateAudio] = useState(false);
  const [seedanceAssetModalOpen, setSeedanceAssetModalOpen] = useState(false);
  const [selectedSeedanceAssets, setSelectedSeedanceAssets] = useState({
    image: null,
    video: null,
    audio: null,
  });
  const [wanResolution, setWanResolution] = useState("580p");
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [extendSourceId, setExtendSourceId] = useState("");
  const [mobileVideoBarExpanded, setMobileVideoBarExpanded] = useState(false);
  const [kling30AdvancedOpen, setKling30AdvancedOpen] = useState(false);
  const isFluxImageModel = imageModel.startsWith("flux-kontext");
  const isIdeogramImageModel = imageModel.startsWith("ideogram-v3");
  const isWanImageModel = imageModel === "wan-2-7-image-pro";
  const isSeedreamImageModel = imageModel === "seedream-v4-5-edit";
  const showSingleInputUploader =
    isFluxImageModel
    || imageModel === "ideogram-v3-edit"
    || imageModel === "ideogram-v3-remix"
    || isSeedreamImageModel;
  const supportsReferenceSlots =
    imageModel === "nano-banana-pro"
    || isWanImageModel
    || isSeedreamImageModel;
  const singleInputRequired =
    isFluxImageModel
    || imageModel === "ideogram-v3-edit"
    || imageModel === "ideogram-v3-remix";

  const { isLoading: histLoading } = useQuery({
    queryKey: ["creator-studio-history"],
    queryFn: async () => {
      const data = await creatorStudioAPI.getHistory({ limit: 20 });
      setHistory(data.generations ?? []);
      return data;
    },
    staleTime: 30_000,
  });

  const { isLoading: videoHistLoading } = useQuery({
    queryKey: ["creator-studio-video-history"],
    queryFn: async () => {
      const data = await creatorStudioAPI.getVideoHistory({ limit: 20 });
      setVideoHistory(data.generations ?? []);
      return data;
    },
    staleTime: 30_000,
  });
  const { data: generationPricingData } = useQuery({
    queryKey: ["generation-pricing-creator-studio-video"],
    queryFn: () => pricingAPI.getGeneration(),
    staleTime: 60_000,
  });
  const generationPricing = generationPricingData?.pricing || {};

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (activeTab !== "generate") setMobileGenBarExpanded(false);
    if (activeTab !== "video") setMobileVideoBarExpanded(false);
  }, [activeTab]);

  const handleAddRef = useCallback(async (file, slotIdx) => {
    setUploadingIdx(slotIdx);
    try {
      const result = await uploadFile(file);
      const url = result?.url || result;
      if (!url) throw new Error("No URL returned");
      setRefs((prev) => { const next = [...prev]; next[slotIdx] = url; return next; });
    } catch (err) {
      toast.error(copy.uploadFailedPrefix + (err.message || copy.unknownError));
    } finally {
      setUploadingIdx(null);
    }
  }, []);

  const removeRef = (idx) =>
    setRefs((prev) => { const next = [...prev]; next[idx] = null; return next; });

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error(copy.enterPrompt); return; }
    const filledRefs = refs.filter(Boolean);
    const primaryInputImage = imageInputUrl.trim() || (supportsReferenceSlots ? (filledRefs[0] || "") : "");
    if (singleInputRequired && !primaryInputImage) {
      toast.error("This model requires an input image.");
      return;
    }
    if (imageModel === "ideogram-v3-edit" && (!imageInputUrl.trim() || !imageMaskUrl.trim())) {
      toast.error("Ideogram Edit requires input image and mask.");
      return;
    }
    if (imageModel === "ideogram-v3-remix" && !imageInputUrl.trim()) {
      toast.error("Ideogram Remix requires input image.");
      return;
    }
    if (isSeedreamImageModel && !primaryInputImage && filledRefs.length === 0) {
      toast.error("Seedream v4.5 Edit needs at least one input image.");
      return;
    }
    let parsedColorPalette = [];
    if (wanColorPaletteText.trim()) {
      try {
        if (wanColorPaletteText.trim().startsWith("[")) {
          const parsed = JSON.parse(wanColorPaletteText);
          if (Array.isArray(parsed)) {
            if (parsed.every((x) => typeof x === "string")) {
              const hexes = parsed
                .map((x) => String(x).trim())
                .filter((x) => /^#[0-9a-fA-F]{6}$/.test(x))
                .slice(0, 10);
              if (hexes.length) {
                const share = `${(100 / hexes.length).toFixed(2)}%`;
                parsedColorPalette = hexes.map((hex) => ({ hex, ratio: share }));
              }
            } else {
              parsedColorPalette = parsed.slice(0, 10).map((entry) => ({
                hex: String(entry.hex || entry.color || "").trim(),
                ratio: String(entry.ratio || entry.proportion || "").trim(),
              }));
            }
          }
        } else {
          const hexes = wanColorPaletteText
            .split(",")
            .map((x) => x.trim())
            .filter((x) => /^#[0-9a-fA-F]{6}$/.test(x))
            .slice(0, 10);
          if (hexes.length) {
            const share = `${(100 / hexes.length).toFixed(2)}%`;
            parsedColorPalette = hexes.map((hex) => ({ hex, ratio: share }));
          }
        }
      } catch {
        toast.error("color_palette must be valid JSON array or comma-separated HEX colors.");
        return;
      }
    }
    let parsedBboxList = [];
    if (wanBboxListText.trim()) {
      try {
        const parsed = JSON.parse(wanBboxListText);
        if (Array.isArray(parsed)) {
          // Accept [[x1,y1,x2,y2], ...] and wrap for a single input image, or already wrapped [[[...]]].
          if (parsed.every((row) => Array.isArray(row) && row.length === 4 && row.every((n) => Number.isFinite(Number(n))))) {
            parsedBboxList = [parsed.map((row) => row.map((n) => Number(n)))];
          } else if (
            parsed.every(
              (row) =>
                Array.isArray(row)
                && row.every((box) => Array.isArray(box) && box.length === 4 && box.every((n) => Number.isFinite(Number(n)))),
            )
          ) {
            parsedBboxList = parsed.map((row) => row.map((box) => box.map((n) => Number(n))));
          } else if (parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
            const converted = parsed
              .map((row) => [Number(row.x1), Number(row.y1), Number(row.x2), Number(row.y2)])
              .filter((box) => box.every((n) => Number.isFinite(n)));
            if (converted.length) parsedBboxList = [converted];
          }
        }
      } catch {
        toast.error("bbox_list must be valid JSON array.");
        return;
      }
    }
    startGeneration({ status: "processing", type: "creator-studio", prompt: prompt.trim() });
    try {
      const data = await creatorStudioAPI.generate({
        prompt: prompt.trim(),
        generationModel: imageModel,
        referencePhotos: supportsReferenceSlots ? filledRefs : [],
        inputImageUrl: primaryInputImage || undefined,
        maskUrl: imageMaskUrl.trim() || (imageModel === "ideogram-v3-edit" ? (filledRefs[1] || undefined) : undefined),
        numImages: (isIdeogramImageModel || isWanImageModel || isFluxImageModel) ? imageNumOutputs : 1,
        renderingSpeed: isIdeogramImageModel ? ideogramRenderingSpeed : undefined,
        promptUpsampling: isFluxImageModel ? fluxPromptUpsampling : undefined,
        safetyTolerance: isFluxImageModel ? fluxSafetyTolerance : undefined,
        thinkingMode: isWanImageModel ? wanThinkingMode : undefined,
        colorPalette: isWanImageModel ? parsedColorPalette : undefined,
        bboxList: isWanImageModel ? parsedBboxList : undefined,
        aspectRatio,
        resolution,
      });
      if (!data.success) throw new Error(data.message || copy.generationFailed);
      startGeneration({ ...data.generation, prompt: prompt.trim() });
      pollForCompletion(data.generation.id, {
        onSuccess: (gen) => {
          toast.success(copy.done);
          refreshUser?.();
          setHistory((prev) => [{ ...gen, prompt: prompt.trim() }, ...prev.filter((g) => g.id !== gen.id)]);
        },
        onFailure: (gen) => toast.error(gen.errorMessage || copy.generationFailedRefunded),
      });
    } catch (err) {
      reset();
      toast.error(err.response?.data?.message || err.message || copy.generationFailed);
    }
  };

  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim()) {
      toast.error(copy.enterPrompt);
      return;
    }
    if ((videoFamily === "sora2" || videoFamily === "kling26" || videoFamily === "kling30" || videoFamily === "seedance2") && videoMode === "i2v" && !videoImageUrl.trim()) {
      toast.error("An image upload is required for image-to-video.");
      return;
    }
    if (videoFamily === "kling30" && videoMode === "i2v" && !videoImageUrl.trim()) {
      toast.error("Start frame is required for Kling 3.0 image-to-video.");
      return;
    }
    if (videoFamily === "veo31" && videoMode === "ref2v" && !videoImageUrl.trim()) {
      toast.error("At least one reference image is required for Veo 3.1 reference mode.");
      return;
    }
    if (videoFamily === "veo31" && videoMode === "extend" && !extendSourceId.trim()) {
      toast.error("Select a Veo video from your gallery to extend.");
      return;
    }
    if (videoFamily === "wan22" && (!videoInputVideoUrl.trim() || !videoImageUrl.trim())) {
      toast.error("WAN requires both input video and input image uploads.");
      return;
    }
    if (videoFamily === "seedance2" && videoMode === "edit" && (!videoImageUrl.trim() || !videoEndFrameUrl.trim())) {
      toast.error("Upload both first and last frame images.");
      return;
    }
    if (videoFamily === "seedance2" && videoMode === "multi-ref" && !videoImageUrl.trim() && !videoInputVideoUrl.trim()) {
      toast.error("Seedance multimodal mode needs at least one image or video reference.");
      return;
    }
    setIsVideoGenerating(true);
    try {
      const normalizedKlingElements = klingElements
        .filter((entry) => entry?.name && entry?.description)
        .map((entry) => ({
          name: entry.name,
          description: entry.description,
          element_input_urls: Array.isArray(entry.element_input_urls)
            ? entry.element_input_urls.filter(Boolean).slice(0, 4)
            : [],
        }))
        .filter((entry) => entry.element_input_urls.length >= 2);
      const payload = {
        family: videoFamily,
        mode: videoMode,
        prompt: videoPrompt.trim(),
        imageUrl: videoImageUrl.trim() || undefined,
        referenceImageUrl: videoRefImageUrl.trim() || undefined,
        endFrameUrl: videoEndFrameUrl.trim() || undefined,
        thirdImageUrl: videoThirdImageUrl.trim() || undefined,
        inputVideoUrl: videoInputVideoUrl.trim() || undefined,
        durationSeconds: Number(videoDuration) || 8,
        nFrames: videoNFrames,
        size: videoSize,
        soraQuality,
        removeWatermark: videoFamily === "sora2" ? soraRemoveWatermark : false,
        speed: videoSpeed,
        soundEnabled,
        soundPrompt: soundPrompt.trim(),
        kling30Quality,
        kling30MultiShot,
        kling30Shots: kling30MultiShot
          ? kling30Shots.filter((s) => s.prompt.trim()).map((s) => ({ prompt: s.prompt.trim(), duration: s.duration }))
          : undefined,
        klingElements: normalizedKlingElements,
        aspectRatio: videoAspectRatio,
        seedanceTaskType,
        seedanceResolution,
        seedanceGenerateAudio,
        seedanceReferenceAudioUrls: selectedSeedanceAssets.audio?.assetUri
          ? [selectedSeedanceAssets.audio.assetUri]
          : undefined,
        wanResolution,
        veoSeeds: veoSeed ? Number(veoSeed) : undefined,
        veoEnableTranslation,
        veoWatermark: veoWatermark.trim() || undefined,
        originalTaskId: extendSourceId.trim() || undefined,
      };
      const data = videoFamily === "veo31" && videoMode === "extend"
        ? await creatorStudioAPI.extendVideo(payload)
        : await creatorStudioAPI.generateVideo(payload);
      if (!data?.success || !data?.generation?.id) {
        throw new Error(data?.message || copy.generationFailed);
      }
      toast.success(copy.videoGenerationStarted);
      pollForCompletion(data.generation.id, {
        onSuccess: (gen) => {
          toast.success(copy.videoReady);
          refreshUser?.();
          setVideoHistory((prev) => [{ ...gen, prompt: videoPrompt.trim() }, ...prev.filter((g) => g.id !== gen.id)]);
        },
        onFailure: (gen) => toast.error(gen.errorMessage || copy.videoFailedRefunded),
      });
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || copy.failedStartVideoGeneration);
    } finally {
      setIsVideoGenerating(false);
    }
  };

  const COST = useMemo(() => {
    const qty = Math.min(4, Math.max(1, Number(imageNumOutputs) || 1));
    if (imageModel === "flux-kontext-pro") return Math.ceil((generationPricing?.creatorStudioFluxKontextPro || 10) * qty);
    if (imageModel === "flux-kontext-max") return Math.ceil((generationPricing?.creatorStudioFluxKontextMax || 20) * qty);
    if (imageModel === "wan-2-7-image-pro") return Math.ceil((generationPricing?.creatorStudioWan27ImagePro || 24) * qty);
    if (imageModel === "seedream-v4-5-edit") return Math.ceil(generationPricing?.creatorStudioSeedream45Edit || 10);
    if (imageModel === "ideogram-v3-text" || imageModel === "ideogram-v3-edit" || imageModel === "ideogram-v3-remix") {
      const speed = String(ideogramRenderingSpeed || "BALANCED").toUpperCase();
      const rate = speed === "TURBO"
        ? (generationPricing?.creatorStudioIdeogramTurbo || 7)
        : speed === "QUALITY"
        ? (generationPricing?.creatorStudioIdeogramQuality || 20)
        : (generationPricing?.creatorStudioIdeogramBalanced || 14);
      return Math.ceil(rate * qty);
    }
    return Math.ceil(resolution === "4K" ? (generationPricing?.creatorStudio4K || 25) : (generationPricing?.creatorStudio1K2K || 20));
  }, [generationPricing, ideogramRenderingSpeed, imageModel, imageNumOutputs, resolution]);
  const hasAnyReferenceSlot = refs.some(Boolean);
  const imageGenerateDisabled =
    isGenerating
    || !prompt.trim()
    || (singleInputRequired && !imageInputUrl.trim())
    || (isSeedreamImageModel && !imageInputUrl.trim() && !hasAnyReferenceSlot)
    || (imageModel === "ideogram-v3-edit" && !imageMaskUrl.trim());
  const creditsLeft = user?.credits ?? 0;
  const selectedAspect = ASPECT_RATIOS.find((ar) => ar.value === aspectRatio);
  const aspectSummary = selectedAspect?.hint ?? selectedAspect?.label ?? aspectRatio;
  const displayGens = [
    ...(activeGeneration ? [activeGeneration] : []),
    ...history.filter((g) => g.id !== activeGeneration?.id),
  ];
  const videoModes = getVideoModesByFamily(videoFamily);
  const soundAvailable = videoFamily === "kling26" || videoFamily === "kling30";
  const selectedVideoFamily = VIDEO_FAMILIES.find((f) => f.id === videoFamily);
  const durationConfig = useMemo(
    () => getDurationConfig(videoFamily, videoMode),
    [videoFamily, videoMode],
  );

  useEffect(() => {
    setVideoDuration((prev) => {
      const numeric = Number(prev) || durationConfig.min;
      const clamped = Math.min(durationConfig.max, Math.max(durationConfig.min, numeric));
      const snapped = durationConfig.step > 1
        ? Math.round(clamped / durationConfig.step) * durationConfig.step
        : clamped;
      return snapped;
    });
  }, [durationConfig.max, durationConfig.min, durationConfig.step]);

  useEffect(() => {
    if (videoFamily === "sora2") {
      setVideoAspectRatio((prev) => (prev === "portrait" || prev === "landscape" ? prev : "landscape"));
    } else if (videoFamily === "veo31") {
      setVideoAspectRatio((prev) => (["Auto", "16:9", "9:16"].includes(prev) ? prev : "Auto"));
    } else if (videoFamily === "kling26" || videoFamily === "kling30" || videoFamily === "seedance2") {
      setVideoAspectRatio((prev) => (["1:1", "16:9", "9:16", "4:3", "3:4"].includes(prev) ? prev : "16:9"));
    }
  }, [videoFamily]);

  const videoPricingInfo = useMemo(() => {
    const duration = Number(videoDuration) || durationConfig.min;
    if (videoFamily === "sora2") {
      const base =
        videoSize === "high"
          ? (videoNFrames === "15" ? toPrice(generationPricing, "sora2High15Frames") : toPrice(generationPricing, "sora2High10Frames"))
          : (videoNFrames === "15" ? toPrice(generationPricing, "sora2Standard15Frames") : toPrice(generationPricing, "sora2Standard10Frames"));
      if (soraRemoveWatermark) {
        const wmSec = videoNFrames === "15" ? 15 : 10;
        const wmPerSec = toPrice(generationPricing, "sora2WatermarkRemoverPerSec");
        const wmCost = Math.ceil(wmSec * wmPerSec);
        return {
          cost: base + wmCost,
          details: `Sora ${videoNFrames}s · ${videoSize} + watermark remover ${wmPerSec}/s × ${wmSec}s`,
        };
      }
      return { cost: base, details: `Per generation (${videoNFrames}s · ${videoSize})` };
    }
    if (videoFamily === "kling26") {
      const bucket = duration >= 10 ? "10s" : "5s";
      const cost = soundEnabled
        ? (bucket === "10s" ? toPrice(generationPricing, "kling26Sound10s") : toPrice(generationPricing, "kling26Sound5s"))
        : (bucket === "10s" ? toPrice(generationPricing, "kling26NoSound10s") : toPrice(generationPricing, "kling26NoSound5s"));
      const perSec = Math.round((cost / (bucket === "10s" ? 10 : 5)) * 10) / 10;
      return { cost, details: `~${perSec}/sec (${bucket} billing bucket)` };
    }
    if (videoFamily === "kling30") {
      const perSec = kling30Quality === "pro"
        ? (soundEnabled ? toPrice(generationPricing, "kling30ProSoundPerSec") : toPrice(generationPricing, "kling30ProNoSoundPerSec"))
        : (soundEnabled ? toPrice(generationPricing, "kling30StdSoundPerSec") : toPrice(generationPricing, "kling30StdNoSoundPerSec"));
      return { cost: Math.ceil(perSec * duration), details: `${perSec}/sec (${kling30Quality.toUpperCase()}${soundEnabled ? " + sound" : ""})` };
    }
    if (videoFamily === "veo31") {
      if (videoMode === "extend") {
        const cost = videoSpeed === "quality"
          ? toPrice(generationPricing, "veo31ExtendQuality")
          : toPrice(generationPricing, "veo31ExtendFast");
        const perSec = Math.round((cost / 8) * 10) / 10;
        return { cost, details: `Per extension (~${perSec}/sec @8s)` };
      }
      const cost = videoSpeed === "quality"
        ? toPrice(generationPricing, "veo31GenerateQuality1080p8s")
        : toPrice(generationPricing, "veo31GenerateFast1080p8s");
      const renderCost = toPrice(generationPricing, "veo31Render1080p");
      const perSec = Math.round((cost / 8) * 10) / 10;
      return { cost, details: `Per generation (~${perSec}/sec @8s) · 1080p render ${renderCost}` };
    }
    if (videoFamily === "wan22") {
      const perSec = videoMode === "replace"
        ? toPrice(generationPricing, `wan22AnimateReplace${wanResolution}PerSec`)
        : toPrice(generationPricing, `wan22AnimateMove${wanResolution}PerSec`);
      return { cost: Math.ceil(perSec * duration), details: `${perSec}/sec (${wanResolution})` };
    }
    if (videoFamily === "seedance2") {
      const fast = seedanceTaskType === "seedance-2-fast-preview";
      const hasVideoInput = Boolean(videoInputVideoUrl.trim());
      const is480 = String(seedanceResolution || "720p").toLowerCase() === "480p";
      const key = fast
        ? (is480
            ? (hasVideoInput ? "seedance2Fast480WithVideoPerSec" : "seedance2Fast480NoVideoPerSec")
            : (hasVideoInput ? "seedance2Fast720WithVideoPerSec" : "seedance2Fast720NoVideoPerSec"))
        : (is480
            ? (hasVideoInput ? "seedance2Standard480WithVideoPerSec" : "seedance2Standard480NoVideoPerSec")
            : (hasVideoInput ? "seedance2Standard720WithVideoPerSec" : "seedance2Standard720NoVideoPerSec"));
      const perSec = toPrice(generationPricing, key);
      const baseCost = Math.ceil(perSec * duration);
      return { cost: baseCost, details: `${perSec}/sec (${fast ? "Fast" : "Quality"} · ${seedanceResolution})` };
    }
    return { cost: 0, details: "Pricing unavailable" };
  }, [durationConfig.min, generationPricing, kling30Quality, seedanceGenerateAudio, seedanceResolution, soraRemoveWatermark, seedanceTaskType, soundEnabled, videoDuration, videoFamily, videoInputVideoUrl, videoMode, videoNFrames, videoSize, videoSpeed, wanResolution]);

  return (
    <div
      className={`relative flex flex-col min-h-full bg-[#0a0a0c]${
        activeTab === "generate"
          ? mobileGenBarExpanded
            ? " max-md:pb-[calc(22rem+env(safe-area-inset-bottom))]"
            : " max-md:pb-[calc(10.5rem+env(safe-area-inset-bottom))]"
          : ""
      }`}
    >

      {/* ── Tab switcher ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-1 z-10 relative">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all relative"
              style={active ? {
                background: "rgba(139,92,246,0.10)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                color: "#e9d5ff",
                border: "1px solid rgba(139,92,246,0.18)",
                boxShadow: "0 4px 18px -4px rgba(139,92,246,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
              } : {
                color: "rgba(100,116,139,1)",
                border: "1px solid transparent",
              }}
            >
              {active && (
                <span
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-[2px] rounded-full pointer-events-none"
                  style={{ background: "linear-gradient(90deg, transparent, rgba(167,139,250,0.9), transparent)" }}
                />
              )}
              <Icon className="w-4 h-4" />
              {tab.id === "generate"
                ? (copy.tabPhoto || copy.tabGenerate)
                : tab.id === "video"
                  ? (copy.tabVideo || "Video")
                  : tab.id === "voices"
                    ? copy.tabVoices
                    : copy.tabAvatars}
            </button>
          );
        })}
      </div>

      <style>{`
        @keyframes bar-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── NanoBanana Generate tab ───────────────────────────────────────── */}
      {activeTab === "generate" && (
        <>
          {/* Canvas — results area */}
          <div className="flex-1 px-6 pt-4 pb-64 min-h-screen">
            <div className="flex items-center gap-3 mb-8">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">{copy.imageGeneration}</h1>
                <p className="text-sm text-slate-400 mt-0.5">{copy.imageGenerationSubtitle}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <TutorialInfoLink
                    tutorialUrl={byKey?.["creator.nanobanana-pro"]?.url || null}
                    label={copy.tutorialImage}
                  />
                  <TutorialInfoLink
                    tutorialUrl={byKey?.["creator.voice-studio"]?.url || null}
                    label={copy.tutorialVoice}
                  />
                  <TutorialInfoLink
                    tutorialUrl={byKey?.["creator.real-avatars"]?.url || null}
                    label={copy.tutorialAvatars}
                  />
                </div>
              </div>
            </div>

            {displayGens.length === 0 && !histLoading && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}>
                  <Sparkles className="w-8 h-8 text-purple-400/60" />
                </div>
                <p className="text-slate-500 text-sm">{copy.emptyState}</p>
              </div>
            )}

            {displayGens.length > 0 && (
              <div className="flex flex-wrap gap-4 justify-start">
                <AnimatePresence mode="popLayout">
                  {displayGens.map((gen) => (
                    <ResultCard key={gen.id} gen={gen} onExpand={setLightboxGen} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Floating bottom bar — desktop */}
          <div
            className="hidden md:flex justify-center fixed bottom-4 right-6 z-20 pointer-events-none transition-all duration-300"
            style={{ left: sidebarCollapsed ? "72px" : "260px" }}
          >
            {/*
              Spinning-border technique:
              Outer wrapper clips the rotating gradient with overflow:hidden.
              Inner card has solid opaque background + 2px margin to expose exactly the border strip.
            */}
            <div
              className="pointer-events-auto w-full max-w-4xl relative"
              style={{ borderRadius: "1rem", overflow: "hidden", padding: 0 }}
            >
              {/* Rotating gradient — behind inner content via z-index 0 */}
              <div style={{
                position: "absolute",
                zIndex: 0,
                inset: "-200%",
                background: "conic-gradient(from 0deg, transparent 300deg, rgba(255,255,255,0.06) 335deg, rgba(255,255,255,0.5) 357deg, rgba(255,255,255,0.06) 360deg)",
                animation: "bar-spin 4s linear infinite",
                pointerEvents: "none",
              }} />
              {/* Inner card — solid opaque, 1.5px inset from edge to reveal border strip */}
            <div
              className="relative flex flex-col items-stretch justify-center p-3"
              style={{
                zIndex: 1,
                margin: "1.5px",
                borderRadius: "calc(1rem - 1.5px)",
                background: "#0d0f11",
              }}
            >
              <textarea
                value={prompt} onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
                placeholder={copy.promptPlaceholder}
                rows={2}
                className="w-full bg-transparent text-sm text-white placeholder-slate-500 resize-none outline-none px-1 py-1 leading-relaxed"
              />
              <div className="flex flex-col gap-3 mt-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Model</span>
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {IMAGE_MODELS.map((model) => (
                      <Chip key={model.id} active={imageModel === model.id} onClick={() => setImageModel(model.id)}>
                        {model.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                {(isIdeogramImageModel || isWanImageModel || isFluxImageModel) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Outputs</span>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4].map((n) => (
                        <Chip key={n} active={imageNumOutputs === n} onClick={() => setImageNumOutputs(n)}>
                          {n}
                        </Chip>
                      ))}
                    </div>
                    {isIdeogramImageModel && (
                      <>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0 ml-1">Speed</span>
                        <div className="flex items-center gap-1.5">
                          {["TURBO", "BALANCED", "QUALITY"].map((mode) => (
                            <Chip key={mode} active={ideogramRenderingSpeed === mode} onClick={() => setIdeogramRenderingSpeed(mode)}>
                              {mode}
                            </Chip>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {showSingleInputUploader && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <MediaUploadField
                      label={singleInputRequired ? "Input image (required)" : "Input image (optional)"}
                      value={imageInputUrl}
                      onUploaded={setImageInputUrl}
                    />
                    {imageModel === "ideogram-v3-edit" && (
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <p className="text-xs text-slate-300 mb-2">Inpainting mask</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!imageInputUrl}
                            onClick={() => setMaskEditorOpen(true)}
                            className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-slate-200 hover:bg-white/15 disabled:opacity-40"
                          >
                            Draw mask
                          </button>
                          <span className="text-[11px] text-slate-500 truncate">
                            {imageMaskUrl ? "Mask ready" : "No mask uploaded"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {isFluxImageModel && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFluxPromptUpsampling((v) => !v)}
                      className={`px-3 py-1.5 rounded-lg text-xs ${fluxPromptUpsampling ? "bg-violet-600 text-white" : "bg-white/10 text-slate-300"}`}
                    >
                      Prompt upsampling: {fluxPromptUpsampling ? "On" : "Off"}
                    </button>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest ml-2">Safety</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={fluxSafetyTolerance === 2} onClick={() => setFluxSafetyTolerance(2)}>SFW</Chip>
                      <Chip active={fluxSafetyTolerance === 6} onClick={() => setFluxSafetyTolerance(6)}>NSFW</Chip>
                    </div>
                  </div>
                )}
                {isWanImageModel && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setWanThinkingMode((v) => !v)}
                      className={`px-3 py-2 rounded-lg text-xs ${wanThinkingMode ? "bg-violet-600 text-white" : "bg-white/10 text-slate-300"}`}
                    >
                      Thinking mode: {wanThinkingMode ? "On" : "Off"}
                    </button>
                    <input
                      value={wanColorPaletteText}
                      onChange={(e) => setWanColorPaletteText(e.target.value)}
                      placeholder='color_palette JSON or HEX list, e.g. [{"hex":"#FF0000","ratio":"50.00%"}] or #FF0000,#00FF00'
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white outline-none"
                    />
                    <input
                      value={wanBboxListText}
                      onChange={(e) => setWanBboxListText(e.target.value)}
                      placeholder='bbox_list JSON, e.g. [[10,10,120,120]] or [[[10,10,120,120]]]'
                      className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>
                )}
                {supportsReferenceSlots && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">{copy.refs}</span>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      {refs.map((url, i) => (
                        <RefSlot key={i} url={url} uploading={uploadingIdx === i}
                          onRemove={() => removeRef(i)} onAdd={(file) => handleAddRef(file, i)} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">{copy.aspect}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {ASPECT_RATIOS.map((ar) => (
                        <Chip key={ar.value} active={aspectRatio === ar.value} onClick={() => setAspectRatio(ar.value)}>
                          {ar.hint ?? ar.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-0.5">{copy.res}</span>
                      {RESOLUTIONS.map((r) => (
                        <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>{r}</Chip>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={imageGenerateDisabled}
                      className="relative flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold tracking-wide overflow-hidden transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 min-w-[10.5rem] whitespace-nowrap"
                      style={{
                        background: "rgba(109,40,217,0.35)",
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        border: "1px solid rgba(139,92,246,0.5)",
                        boxShadow: "0 0 18px rgba(109,40,217,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
                        color: "#ffffff",
                      }}
                    >
                      <span className="absolute inset-0 pointer-events-none rounded-xl" style={{
                        background: "linear-gradient(160deg, rgba(255,255,255,0.07) 0%, transparent 60%)",
                      }} />
                      {isGenerating
                        ? <Loader2 className="w-4 h-4 animate-spin relative z-10" />
                        : <Zap className="w-4 h-4 relative z-10 shrink-0" />}
                      <span className="relative z-10 flex items-center gap-1.5">
                        {isGenerating ? copy.buttonGenerating : (
                          <>{formatCopy(copy.buttonGenerateCost, { cost: COST })} <Coins className="w-3.5 h-3.5 text-yellow-400 shrink-0" /></>
                        )}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5 text-right pr-1">{formatCopy(copy.creditsAvailable, { credits: creditsLeft })}</p>
            </div>{/* /inner card */}
            </div>{/* /spinning-border outer */}
          </div>{/* /fixed positioner */}

          {/* Mobile bar — collapsible: compact prompt + generate; expand for refs / aspect / res */}
          <div
            className={`md:hidden fixed left-1/2 z-[35] w-[min(calc(100vw-1.25rem),26rem)] -translate-x-1/2 overflow-x-hidden rounded-2xl border border-white/[0.18] bg-[#0e0e12]/95 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.9)] backdrop-blur-xl p-3 [scrollbar-width:thin] ${
              mobileGenBarExpanded ? "max-h-[min(52vh,420px)] overflow-y-auto" : ""
            }`}
            style={{
              bottom:
                "max(0.75rem, calc(var(--dashboard-mobile-tab-stack, calc(3.5rem + env(safe-area-inset-bottom))) + 0.625rem))",
            }}
          >
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => setMobileGenBarExpanded((e) => !e)}
                aria-expanded={mobileGenBarExpanded}
                aria-label={mobileGenBarExpanded ? copy.collapseGenControls : copy.expandGenControls}
                className="flex-shrink-0 w-11 min-h-[44px] rounded-xl border border-white/20 bg-black/50 flex items-center justify-center text-slate-300 hover:bg-black/70 transition-colors"
              >
                {mobileGenBarExpanded ? (
                  <ChevronDown className="w-5 h-5 rotate-180" aria-hidden />
                ) : (
                  <ChevronDown className="w-5 h-5" aria-hidden />
                )}
              </button>
              {!mobileGenBarExpanded && (
                <>
                  <div className="flex-1 min-w-0 rounded-xl border border-white/20 bg-black/65 px-2.5 py-2 flex items-center">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={copy.promptPlaceholder}
                      rows={1}
                      className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 resize-none outline-none leading-snug min-h-[2.5rem] max-h-[2.5rem] overflow-y-auto [scrollbar-width:thin]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={imageGenerateDisabled}
                    className="flex-shrink-0 min-w-[7rem] min-h-[44px] px-3 rounded-xl text-xs font-semibold disabled:opacity-40 flex flex-col items-center justify-center gap-0.5 leading-tight"
                    style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white" }}
                  >
                    {isGenerating ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 shrink-0" />
                          <span className="whitespace-nowrap">{COST}</span>
                          <Coins className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                        </span>
                        <span className="text-[10px] font-medium opacity-90">{copy.tabGenerate}</span>
                      </>
                    )}
                  </button>
                </>
              )}
              {mobileGenBarExpanded && (
                <div className="flex-1 min-w-0 flex items-center min-h-[44px] px-1">
                  <p className="text-[11px] text-slate-400 truncate w-full">
                    <span className="text-slate-500">{aspectSummary}</span>
                    <span className="mx-1 text-slate-600">·</span>
                    <span>{resolution}</span>
                    <span className="mx-1 text-slate-600">·</span>
                    <span>{COST} cr</span>
                  </p>
                </div>
              )}
            </div>
            {!mobileGenBarExpanded && (
              <p className="text-[10px] text-slate-500 mt-2 text-center leading-snug px-0.5">
                {formatCopy(copy.creditsAvailable, { credits: creditsLeft })}
              </p>
            )}

            {mobileGenBarExpanded && (
              <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                <div className="rounded-xl border border-white/20 bg-black/65 px-3 py-2">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={copy.promptPlaceholder}
                    rows={2}
                    className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 resize-none outline-none min-h-[2.75rem]"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">{copy.refs}</span>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 snap-x snap-mandatory [scrollbar-width:thin]">
                    {refs.map((url, i) => (
                      <RefSlot key={i} url={url} uploading={uploadingIdx === i}
                        onRemove={() => removeRef(i)} onAdd={(file) => handleAddRef(file, i)} />
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">{copy.aspect}</span>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 snap-x [scrollbar-width:thin]">
                    <div className="flex items-center gap-2 shrink-0 pr-2">
                      {ASPECT_RATIOS.map((ar) => (
                        <Chip key={ar.value} active={aspectRatio === ar.value} onClick={() => setAspectRatio(ar.value)}>{ar.hint ?? ar.label}</Chip>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <span className="text-[11px] text-slate-400 uppercase tracking-widest font-medium">{copy.res}</span>
                    <div className="flex gap-2 overflow-x-auto mt-2 pb-0.5 -mx-0.5 px-0.5 [scrollbar-width:thin]">
                      <div className="flex items-center gap-2 shrink-0">
                        {RESOLUTIONS.map((r) => (
                          <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>{r}</Chip>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button type="button" onClick={handleGenerate} disabled={imageGenerateDisabled}
                    className="w-full min-h-[48px] shrink-0 px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
                    style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white" }}>
                    {isGenerating
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <span className="flex items-center gap-1.5 whitespace-nowrap">{formatCopy(copy.buttonGenerateCost, { cost: COST })} <Coins className="w-4 h-4 text-yellow-400" /></span>
                    }
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 text-center leading-snug">{formatCopy(copy.creditsAvailable, { credits: creditsLeft })}</p>
              </div>
            )}
          </div>

          <AnimatePresence>
            {lightboxGen && <Lightbox gen={lightboxGen} onClose={() => setLightboxGen(null)} />}
          </AnimatePresence>
        </>
      )}

      {activeTab === "video" && (
        <>
          {/* Canvas — video results area */}
          <div className="flex-1 px-6 pt-4 pb-64 min-h-screen">
            <div className="flex items-center gap-3 mb-8">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Video Generation</h1>
                <p className="text-sm text-slate-400 mt-0.5">{selectedVideoFamily?.label || "Video"} · {videoMode.toUpperCase()}</p>
              </div>
            </div>
            {videoHistory.length === 0 && !videoHistLoading && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}>
                  <Video className="w-8 h-8 text-purple-400/60" />
                </div>
                <p className="text-slate-500 text-sm">No video generations yet</p>
              </div>
            )}
            {videoHistory.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {videoHistory.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-[#0d1016] overflow-hidden">
                    {item.outputUrl ? (
                      <video src={item.outputUrl} controls className="w-full h-48 object-cover bg-black" />
                    ) : (
                      <div className="w-full h-48 bg-black/50 flex items-center justify-center text-slate-400 text-xs">
                        {item.status}
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-xs text-slate-400">{item.providerFamily || "video"} · {item.providerMode || "mode"}</p>
                      <p className="text-sm text-white mt-1 line-clamp-2">{item.prompt || "—"}</p>
                      {item.extendEligible && item.providerTaskId && (
                        <button
                          type="button"
                          onClick={() => {
                            const family = item.providerFamily === "seedance2" ? "seedance2" : "veo31";
                            setVideoFamily(family);
                            setVideoMode(family === "seedance2" ? "multi-ref" : "extend");
                            if (family !== "seedance2") setExtendSourceId(item.providerTaskId);
                            if (family === "seedance2" && item.outputUrl) setVideoInputVideoUrl(item.outputUrl);
                          }}
                          className="mt-2 text-xs px-2.5 py-1.5 rounded-lg bg-white/10 text-slate-200 hover:bg-white/15"
                        >
                          {item.providerFamily === "seedance2" ? "Use as reference" : "Extend this video"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Floating bottom bar — desktop (spinning border) */}
          <div
            className="hidden md:flex justify-center fixed bottom-4 right-6 z-20 pointer-events-none transition-all duration-300"
            style={{ left: sidebarCollapsed ? "72px" : "260px" }}
          >
            <div
              className="pointer-events-auto w-full max-w-4xl relative"
              style={{ borderRadius: "1rem", overflow: "hidden", padding: 0 }}
            >
              <div style={{
                position: "absolute",
                zIndex: 0,
                inset: "-200%",
                background: "conic-gradient(from 0deg, transparent 300deg, rgba(255,255,255,0.06) 335deg, rgba(255,255,255,0.5) 357deg, rgba(255,255,255,0.06) 360deg)",
                animation: "bar-spin 4s linear infinite",
                pointerEvents: "none",
              }} />
            <div
              className="relative flex flex-col items-stretch justify-center p-3"
              style={{
                zIndex: 1,
                margin: "1.5px",
                borderRadius: "calc(1rem - 1.5px)",
                background: "#0d0f11",
              }}
            >
              <textarea
                value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerateVideo(); } }}
                placeholder="Describe motion, camera, timing, and atmosphere…"
                rows={2}
                className="w-full bg-transparent text-sm text-white placeholder-slate-500 resize-none outline-none px-1 py-1 leading-relaxed"
              />
              <div className="h-px bg-white/[0.06] mt-2 mb-1" />
              <div className="flex flex-col gap-2.5 min-w-0">
                {/* ── Model ────────────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Model</span>
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {VIDEO_FAMILIES.map((family) => (
                      <Chip key={family.id} active={videoFamily === family.id} onClick={() => { setVideoFamily(family.id); setVideoMode(defaultModeByFamily(family.id)); }}>
                        {family.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                {/* ── Mode ─────────────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Mode</span>
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {videoModes.map((m) => (
                      <Chip key={m} active={videoMode === m} onClick={() => setVideoMode(m)}>
                        {m === "t2v" ? "Text → Video" : m === "i2v" ? "Image → Video" : m === "multi-ref" ? "Multi-Ref" : m === "ref2v" ? "Ref → Video" : m === "move" ? "Animate" : m === "replace" ? "Replace" : m === "edit" ? "First + Last" : "Extend"}
                      </Chip>
                    ))}
                  </div>
                  <span className="text-[10px] text-violet-300/80 ml-auto flex items-center gap-1 shrink-0">
                    <Coins className="w-3 h-3 text-yellow-400/70" /> {videoPricingInfo.details}
                  </span>
                </div>
                {/* ── Uploads ──────────────────────────────────────── */}
                {((videoFamily === "sora2" || videoFamily === "kling26") && videoMode === "i2v") && (
                  <div className="flex flex-wrap items-start gap-2">
                    <MediaUploadField label="Input Image" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                  </div>
                )}
                {(videoFamily === "kling30" || videoFamily === "veo31") && videoMode === "i2v" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <MediaUploadField label="Start Frame" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                    <MediaUploadField label="End Frame (opt)" value={videoEndFrameUrl} onUploaded={setVideoEndFrameUrl} />
                  </div>
                )}
                {videoFamily === "veo31" && videoMode === "ref2v" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <MediaUploadField label="Ref 1" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                    <MediaUploadField label="Ref 2 (opt)" value={videoRefImageUrl} onUploaded={setVideoRefImageUrl} />
                    <MediaUploadField label="Ref 3 (opt)" value={videoThirdImageUrl} onUploaded={setVideoThirdImageUrl} />
                  </div>
                )}
                {videoFamily === "wan22" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <MediaUploadField label="Input Video" value={videoInputVideoUrl} onUploaded={setVideoInputVideoUrl} accept="video/*" preview="video" />
                    <MediaUploadField label="Input Image" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                  </div>
                )}
                {videoFamily === "seedance2" && videoMode === "edit" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <MediaUploadField label="First Frame" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                    <MediaUploadField label="Last Frame" value={videoEndFrameUrl} onUploaded={setVideoEndFrameUrl} />
                  </div>
                )}
                {videoFamily === "seedance2" && videoMode === "i2v" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <MediaUploadField label="First Frame" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                  </div>
                )}
                {videoFamily === "seedance2" && videoMode === "multi-ref" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <MediaUploadField label="Ref 1 (opt)" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                    <MediaUploadField label="Ref 2 (opt)" value={videoRefImageUrl} onUploaded={setVideoRefImageUrl} />
                    <MediaUploadField label="Ref 3 (opt)" value={videoThirdImageUrl} onUploaded={setVideoThirdImageUrl} />
                    <MediaUploadField label="Ref Video (opt)" value={videoInputVideoUrl} onUploaded={setVideoInputVideoUrl} accept="video/*" preview="video" />
                  </div>
                )}
                {videoFamily === "veo31" && videoMode === "extend" && (
                  <select value={extendSourceId} onChange={(e) => setExtendSourceId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white outline-none">
                    <option value="">Select Veo video to extend…</option>
                    {videoHistory
                      .filter((item) => item?.providerFamily === "veo31" && item?.providerTaskId && item?.status === "completed")
                      .map((item) => (
                        <option key={item.id} value={item.providerTaskId}>
                          {item.prompt?.slice(0, 56) || "Veo generation"} ({item.providerTaskId})
                        </option>
                      ))}
                  </select>
                )}
                {/* ── Settings row (family-specific) ───────────────── */}
                {videoFamily !== "sora2" && videoFamily !== "kling26" && videoFamily !== "veo31" && videoFamily !== "kling30" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Duration</span>
                    <span className="text-[10px] text-white font-medium shrink-0">{videoDuration}s</span>
                    <input type="range" min={durationConfig.min} max={durationConfig.max} step={durationConfig.step} disabled={durationConfig.fixed} value={videoDuration} onChange={(e) => setVideoDuration(Number(e.target.value))} className="w-24 accent-violet-500 disabled:opacity-50" />
                  </div>
                )}
                {videoFamily === "sora2" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Duration</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={videoNFrames === "10"} onClick={() => setVideoNFrames("10")}>10s</Chip>
                      <Chip active={videoNFrames === "15"} onClick={() => setVideoNFrames("15")}>15s</Chip>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Quality</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={videoSize === "standard"} onClick={() => setVideoSize("standard")}>Standard</Chip>
                      <Chip active={videoSize === "high"} onClick={() => setVideoSize("high")}>High</Chip>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aspect</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={videoAspectRatio === "portrait"} onClick={() => setVideoAspectRatio("portrait")}>Portrait</Chip>
                      <Chip active={videoAspectRatio === "landscape"} onClick={() => setVideoAspectRatio("landscape")}>Landscape</Chip>
                    </div>
                    <button type="button" onClick={() => setSoraRemoveWatermark((v) => !v)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${soraRemoveWatermark ? "bg-violet-600 text-white border border-violet-500" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                      Watermark {soraRemoveWatermark ? "Off" : "On"}
                    </button>
                  </div>
                )}
                {videoFamily === "kling30" && (
                  <>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Quality</span>
                      <div className="flex items-center gap-1.5">
                        <Chip active={kling30Quality === "std"} onClick={() => setKling30Quality("std")}>Standard</Chip>
                        <Chip active={kling30Quality === "pro"} onClick={() => setKling30Quality("pro")}>Pro</Chip>
                      </div>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aspect</span>
                      <div className="flex items-center gap-1.5">
                        <Chip active={videoAspectRatio === "16:9"} onClick={() => setVideoAspectRatio("16:9")}>16:9</Chip>
                        <Chip active={videoAspectRatio === "9:16"} onClick={() => setVideoAspectRatio("9:16")}>9:16</Chip>
                        <Chip active={videoAspectRatio === "1:1"} onClick={() => setVideoAspectRatio("1:1")}>1:1</Chip>
                      </div>
                      {!kling30MultiShot && (
                        <>
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Duration</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-white font-medium">{videoDuration}s</span>
                            <input type="range" min={3} max={15} step={1} value={videoDuration} onChange={(e) => setVideoDuration(Number(e.target.value))} className="w-20 accent-violet-500" />
                          </div>
                        </>
                      )}
                      <button type="button" onClick={() => setKling30MultiShot((v) => !v)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${kling30MultiShot ? "bg-violet-600 text-white border border-violet-500" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                        Multi-shot
                      </button>
                      <button type="button" onClick={() => setKling30AdvancedOpen((v) => !v)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${kling30AdvancedOpen ? "bg-white/10 text-slate-200 border border-white/15" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                        {klingElements.length > 0 ? `Elements (${klingElements.length})` : "Elements"}
                      </button>
                    </div>
                    {kling30MultiShot && (
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-1.5 max-h-[24vh] overflow-y-auto [scrollbar-width:thin]">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-slate-500">
                            {kling30Shots.length} shot{kling30Shots.length !== 1 ? "s" : ""} · {kling30Shots.reduce((sum, s) => sum + s.duration, 0)}s / 15s
                          </p>
                          {kling30Shots.length < 5 && (
                            <button type="button" onClick={() => setKling30Shots((prev) => [...prev, { prompt: "", duration: 3 }])}
                              className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
                              <Plus className="w-3 h-3" /> Shot
                            </button>
                          )}
                        </div>
                        {kling30Shots.map((shot, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 shrink-0 w-4">{idx + 1}</span>
                            <input value={shot.prompt} onChange={(e) => setKling30Shots((prev) => prev.map((s, i) => i === idx ? { ...s, prompt: e.target.value } : s))}
                              placeholder={`Shot ${idx + 1} — motion, camera…`}
                              className="flex-1 min-w-0 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-slate-600" />
                            <input type="range" min={3} max={Math.min(10, 15 - kling30Shots.filter((_, i) => i !== idx).reduce((s, sh) => s + sh.duration, 0))} step={1} value={shot.duration}
                              onChange={(e) => setKling30Shots((prev) => prev.map((s, i) => i === idx ? { ...s, duration: Number(e.target.value) } : s))} className="w-16 accent-violet-500" />
                            <span className="text-[10px] text-white w-5 text-right">{shot.duration}s</span>
                            {kling30Shots.length > 1 && (
                              <button type="button" onClick={() => setKling30Shots((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-600 hover:text-red-400 transition-colors">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {kling30AdvancedOpen && (
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <input value={klingElementName} onChange={(e) => setKlingElementName(e.target.value)} placeholder="@name" className="flex-1 min-w-[5rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-slate-600" />
                          <input value={klingElementDescription} onChange={(e) => setKlingElementDescription(e.target.value)} placeholder="Description" className="flex-1 min-w-[5rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-slate-600" />
                          <button type="button" onClick={() => {
                            const media = klingElementMediaUrls.filter(Boolean);
                            if (!klingElementName.trim() || !klingElementDescription.trim() || media.length < 2) { toast.error("Need name, description, and 2+ images."); return; }
                            setKlingElements((prev) => [...prev.slice(0, 2), { name: klingElementName.trim(), description: klingElementDescription.trim(), element_input_urls: media.slice(0, 4) }]);
                            setKlingElementName(""); setKlingElementDescription(""); setKlingElementMediaUrls(["", "", "", ""]);
                          }} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors shrink-0">
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {klingElementMediaUrls.map((url, idx) => (
                            <MediaUploadField key={idx} label={`Img ${idx + 1}${idx < 2 ? "*" : ""}`} value={url} onUploaded={(newUrl) => setKlingElementMediaUrls((prev) => prev.map((v, i) => (i === idx ? newUrl : v)))} />
                          ))}
                        </div>
                        {klingElements.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {klingElements.map((element, idx) => (
                              <span key={`${element.name}-${idx}`} className="inline-flex items-center gap-1 text-[10px] text-slate-300 rounded-md bg-black/40 px-1.5 py-0.5">
                                @{element.name} · {element.element_input_urls.length}
                                <button type="button" className="text-slate-600 hover:text-red-400" onClick={() => setKlingElements((prev) => prev.filter((_, i) => i !== idx))}><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                {videoFamily === "kling26" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {videoMode === "t2v" && (
                      <>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aspect</span>
                        <div className="flex items-center gap-1.5">
                          <Chip active={videoAspectRatio === "1:1"} onClick={() => setVideoAspectRatio("1:1")}>1:1</Chip>
                          <Chip active={videoAspectRatio === "16:9"} onClick={() => setVideoAspectRatio("16:9")}>16:9</Chip>
                          <Chip active={videoAspectRatio === "9:16"} onClick={() => setVideoAspectRatio("9:16")}>9:16</Chip>
                        </div>
                      </>
                    )}
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Duration</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={videoDuration === 5} onClick={() => setVideoDuration(5)}>5s</Chip>
                      <Chip active={videoDuration === 10} onClick={() => setVideoDuration(10)}>10s</Chip>
                    </div>
                  </div>
                )}
                {videoFamily === "veo31" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Speed</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={videoSpeed === "fast"} onClick={() => setVideoSpeed("fast")}>Fast</Chip>
                      <Chip active={videoSpeed === "quality"} onClick={() => setVideoSpeed("quality")}>Quality</Chip>
                    </div>
                    {(videoMode === "ref2v" || videoMode === "i2v") && (
                      <>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aspect</span>
                        <div className="flex items-center gap-1.5">
                          <Chip active={videoAspectRatio === "Auto"} onClick={() => setVideoAspectRatio("Auto")}>Auto</Chip>
                          <Chip active={videoAspectRatio === "16:9"} onClick={() => setVideoAspectRatio("16:9")}>16:9</Chip>
                          <Chip active={videoAspectRatio === "9:16"} onClick={() => setVideoAspectRatio("9:16")}>9:16</Chip>
                        </div>
                      </>
                    )}
                    <button type="button" onClick={() => setVeoEnableTranslation((v) => !v)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${veoEnableTranslation ? "bg-violet-600 text-white border border-violet-500" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                      Translate
                    </button>
                    <span className="text-[10px] text-slate-500">8s fixed</span>
                    <input type="number" min={10000} max={99999} value={veoSeed} onChange={(e) => setVeoSeed(e.target.value)} placeholder="Seed"
                      className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-slate-600" />
                    <input value={veoWatermark} onChange={(e) => setVeoWatermark(e.target.value)} placeholder="Watermark"
                      className="w-24 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-slate-600" />
                  </div>
                )}
                {videoFamily === "wan22" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Resolution</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={wanResolution === "480p"} onClick={() => setWanResolution("480p")}>480p</Chip>
                      <Chip active={wanResolution === "580p"} onClick={() => setWanResolution("580p")}>580p</Chip>
                      <Chip active={wanResolution === "720p"} onClick={() => setWanResolution("720p")}>720p</Chip>
                    </div>
                  </div>
                )}
                {videoFamily === "seedance2" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Variant</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={seedanceTaskType === "seedance-2-preview"} onClick={() => setSeedanceTaskType("seedance-2-preview")}>Quality</Chip>
                      <Chip active={seedanceTaskType === "seedance-2-fast-preview"} onClick={() => setSeedanceTaskType("seedance-2-fast-preview")}>Fast</Chip>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Res</span>
                    <div className="flex items-center gap-1.5">
                      <Chip active={seedanceResolution === "480p"} onClick={() => setSeedanceResolution("480p")}>480p</Chip>
                      <Chip active={seedanceResolution === "720p"} onClick={() => setSeedanceResolution("720p")}>720p</Chip>
                    </div>
                    {(videoMode === "t2v" || videoMode === "i2v" || videoMode === "edit" || videoMode === "multi-ref") && (
                      <>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aspect</span>
                        <div className="flex items-center gap-1">
                          {["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"].map((ar) => (
                            <Chip key={ar} active={videoAspectRatio === ar} onClick={() => setVideoAspectRatio(ar)}>{ar}</Chip>
                          ))}
                        </div>
                      </>
                    )}
                    <button type="button" onClick={() => setSeedanceGenerateAudio((v) => !v)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${seedanceGenerateAudio ? "bg-violet-600 text-white border border-violet-500" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                      Audio {seedanceGenerateAudio ? "On" : "Off"}
                    </button>
                    <button type="button" onClick={() => setSeedanceAssetModalOpen(true)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all border ${(selectedSeedanceAssets.image || selectedSeedanceAssets.video || selectedSeedanceAssets.audio) ? "bg-white/10 text-slate-200 border-white/15" : "bg-white/5 text-slate-400 border-white/10"} hover:bg-white/10`}>
                      Assets{(selectedSeedanceAssets.image || selectedSeedanceAssets.video || selectedSeedanceAssets.audio) ? " ✓" : ""}
                    </button>
                  </div>
                )}
                {/* ── Generate row ──────────────────────────────────── */}
                <div className="flex items-center gap-2 pt-0.5">
                  {soundAvailable && (
                    <>
                      <button type="button" onClick={() => setSoundEnabled((v) => !v)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0 ${soundEnabled ? "bg-violet-600 text-white border border-violet-500" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                        Sound {soundEnabled ? "On" : "Off"}
                      </button>
                      {soundEnabled && (
                        <input value={soundPrompt} onChange={(e) => setSoundPrompt(e.target.value)} placeholder="Sound prompt (speech, ambience, SFX…)"
                          className="flex-1 min-w-[8rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none placeholder:text-slate-600" />
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={handleGenerateVideo}
                    disabled={isVideoGenerating}
                    className="relative flex items-center justify-center gap-2 ml-auto px-5 py-2 rounded-xl text-sm font-bold tracking-wide overflow-hidden transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                    style={{
                      background: "rgba(109,40,217,0.35)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      border: "1px solid rgba(139,92,246,0.5)",
                      boxShadow: "0 0 18px rgba(109,40,217,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
                      color: "#ffffff",
                    }}
                  >
                    <span className="absolute inset-0 pointer-events-none rounded-xl" style={{
                      background: "linear-gradient(160deg, rgba(255,255,255,0.07) 0%, transparent 60%)",
                    }} />
                    {isVideoGenerating
                      ? <Loader2 className="w-4 h-4 animate-spin relative z-10" />
                      : <Video className="w-4 h-4 relative z-10 shrink-0" />}
                    <span className="relative z-10 flex items-center gap-1.5">
                      {isVideoGenerating ? copy.generatingVideo : (
                        <>{copy.generateVideo} {videoPricingInfo.cost} <Coins className="w-3.5 h-3.5 text-yellow-400 shrink-0" /></>
                      )}
                    </span>
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5 text-right pr-1">{formatCopy(copy.creditsAvailable, { credits: creditsLeft })}</p>
            </div>{/* /inner card */}
            </div>{/* /spinning-border outer */}
          </div>{/* /fixed positioner */}

          {/* Mobile bar — collapsible video controls */}
          <div
            className={`md:hidden fixed left-1/2 z-[35] w-[min(calc(100vw-1.25rem),26rem)] -translate-x-1/2 overflow-x-hidden rounded-2xl border border-white/[0.18] bg-[#0e0e12]/95 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.9)] backdrop-blur-xl p-3 [scrollbar-width:thin] ${
              mobileVideoBarExpanded ? "max-h-[min(60vh,480px)] overflow-y-auto" : ""
            }`}
            style={{
              bottom: "max(0.75rem, calc(var(--dashboard-mobile-tab-stack, calc(3.5rem + env(safe-area-inset-bottom))) + 0.625rem))",
            }}
          >
            <div className="flex items-stretch gap-2">
              <button type="button" onClick={() => setMobileVideoBarExpanded((e) => !e)}
                aria-expanded={mobileVideoBarExpanded}
                className="flex-shrink-0 w-11 min-h-[44px] rounded-xl border border-white/20 bg-black/50 flex items-center justify-center text-slate-300 hover:bg-black/70 transition-colors">
                {mobileVideoBarExpanded ? <ChevronDown className="w-5 h-5 rotate-180" aria-hidden /> : <ChevronDown className="w-5 h-5" aria-hidden />}
              </button>
              {!mobileVideoBarExpanded && (
                <>
                  <div className="flex-1 min-w-0 rounded-xl border border-white/20 bg-black/65 px-2.5 py-2 flex items-center">
                    <textarea value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)}
                      placeholder="Video prompt…" rows={1}
                      className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 resize-none outline-none leading-snug min-h-[2.5rem] max-h-[2.5rem] overflow-y-auto [scrollbar-width:thin]" />
                  </div>
                  <button type="button" onClick={handleGenerateVideo} disabled={isVideoGenerating}
                    className="flex-shrink-0 min-w-[7rem] min-h-[44px] px-3 rounded-xl text-xs font-semibold disabled:opacity-40 flex flex-col items-center justify-center gap-0.5 leading-tight"
                    style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white" }}>
                    {isVideoGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                      <>
                        <span className="flex items-center gap-1">
                          <Video className="w-3.5 h-3.5 shrink-0" />
                          <span className="whitespace-nowrap">{videoPricingInfo.cost}</span>
                          <Coins className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                        </span>
                        <span className="text-[10px] font-medium opacity-90">Video</span>
                      </>
                    )}
                  </button>
                </>
              )}
              {mobileVideoBarExpanded && (
                <div className="flex-1 min-w-0 flex items-center min-h-[44px] px-1">
                  <p className="text-[11px] text-slate-400 truncate w-full">
                    <span className="text-slate-500">{selectedVideoFamily?.label}</span>
                    <span className="mx-1 text-slate-600">·</span>
                    <span>{videoMode}</span>
                    <span className="mx-1 text-slate-600">·</span>
                    <span>{videoPricingInfo.cost} cr</span>
                  </p>
                </div>
              )}
            </div>
            {!mobileVideoBarExpanded && (
              <p className="text-[10px] text-slate-500 mt-2 text-center leading-snug px-0.5">
                {formatCopy(copy.creditsAvailable, { credits: creditsLeft })}
              </p>
            )}
            {mobileVideoBarExpanded && (
              <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                <div className="rounded-xl border border-white/20 bg-black/65 px-3 py-2">
                  <textarea value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)}
                    placeholder="Describe motion, camera, timing…" rows={2}
                    className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 resize-none outline-none min-h-[2.75rem]" />
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">Model</span>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 snap-x [scrollbar-width:thin]">
                    {VIDEO_FAMILIES.map((family) => (
                      <Chip key={family.id} active={videoFamily === family.id} onClick={() => { setVideoFamily(family.id); setVideoMode(defaultModeByFamily(family.id)); }}>
                        {family.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 uppercase tracking-widest block mb-2 font-medium">Mode</span>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 snap-x [scrollbar-width:thin]">
                    {videoModes.map((m) => (
                      <Chip key={m} active={videoMode === m} onClick={() => setVideoMode(m)}>
                        {m === "t2v" ? "Text → Video" : m === "i2v" ? "Image → Video" : m === "multi-ref" ? "Multi-Ref" : m === "ref2v" ? "Ref → Video" : m === "move" ? "Animate" : m === "replace" ? "Replace" : m === "edit" ? "First + Last" : "Extend"}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <button type="button" onClick={handleGenerateVideo} disabled={isVideoGenerating}
                    className="w-full min-h-[48px] shrink-0 px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
                    style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white" }}>
                    {isVideoGenerating
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <span className="flex items-center gap-1.5 whitespace-nowrap">{copy.generateVideo} {videoPricingInfo.cost} <Coins className="w-4 h-4 text-yellow-400" /></span>
                    }
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 text-center leading-snug">{formatCopy(copy.creditsAvailable, { credits: creditsLeft })}</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Real Avatars tab ──────────────────────────────────────────────── */}
      {activeTab === "avatars" && (
        <RealAvatarsTab sidebarCollapsed={sidebarCollapsed} />
      )}

      {activeTab === "voices" && <CreatorStudioVoiceTab initialModelId={initialModelId} />}

      <SeedanceAssetModal
        isOpen={seedanceAssetModalOpen}
        onClose={() => setSeedanceAssetModalOpen(false)}
        onSelect={(asset) => {
          const uri = asset?.assetUri;
          if (!uri) return;
          const type = String(asset?.assetType || "").toLowerCase();
          const normalized = {
            id: asset?.id,
            name: asset?.name || null,
            sourceUrl: asset?.sourceUrl || null,
            assetUri: uri,
            assetType: type,
          };
          if (type === "video") {
            setVideoInputVideoUrl(uri);
            setSelectedSeedanceAssets((prev) => ({ ...prev, video: normalized }));
          } else if (type === "audio") {
            setSelectedSeedanceAssets((prev) => ({ ...prev, audio: normalized }));
          } else {
            setVideoImageUrl(uri);
            setSelectedSeedanceAssets((prev) => ({ ...prev, image: normalized }));
          }
          setSeedanceAssetModalOpen(false);
        }}
      />
      <MaskEditorModal
        isOpen={maskEditorOpen}
        imageUrl={imageInputUrl}
        onClose={() => setMaskEditorOpen(false)}
        onSave={async (maskDataUrl) => {
          try {
            const data = await creatorStudioAPI.uploadMask({ maskDataUrl });
            if (!data?.success || !data?.maskUrl) throw new Error(data?.message || "Mask upload failed");
            setImageMaskUrl(data.maskUrl);
            setMaskEditorOpen(false);
            toast.success("Mask uploaded");
          } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || "Mask upload failed");
          }
        }}
      />
    </div>
  );
}
