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
  seedance2PreviewCreditsPerSec: 60,
  seedance2FastPreviewCreditsPerSec: 32,
  seedance2PreviewEditCreditsPerSec: 100,
  seedance2FastPreviewEditCreditsPerSec: 52,
  seedanceRemoveWatermarkPerSec: 3.2,
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
    return { min: 5, max: 5, step: 1, fixed: true };
  }
  if (family === "seedance2") {
    return { min: 5, max: 15, step: 5, fixed: false };
  }
  if (family === "wan22") {
    return { min: 5, max: 5, step: 1, fixed: true };
  }
  return { min: 10, max: 15, step: 5, fixed: false };
}

function getVideoModesByFamily(family) {
  if (family === "veo31") return ["ref2v", "t2v", "i2v", "extend"];
  if (family === "wan22") return ["move", "replace"];
  if (family === "seedance2") return ["t2v", "i2v", "edit", "extend"];
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

function ResultCard({ gen, onExpand }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const isProcessing = gen.status === "processing" || gen.status === "pending";
  const isFailed     = gen.status === "failed";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="relative rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.03] group"
      style={{ aspectRatio: "1/1", minWidth: 220, maxWidth: 420, width: "100%" }}
    >
      {gen.status === "completed" && gen.outputUrl ? (
        <>
          <img src={gen.outputUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-3 gap-2">
            <button onClick={() => onExpand(gen)}
              className="w-8 h-8 rounded-lg bg-black/50 flex items-center justify-center text-white hover:bg-black/70 backdrop-blur-sm">
              <Maximize2 className="w-4 h-4" />
            </button>
            <a href={`/api/download?url=${encodeURIComponent(gen.outputUrl)}&filename=creator-${gen.id}.jpg`}
              download onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 rounded-lg bg-black/50 flex items-center justify-center text-white hover:bg-black/70 backdrop-blur-sm">
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
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
        className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={gen.outputUrl} alt="" className="max-w-full max-h-[90vh] rounded-2xl object-contain" />
        <button onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80">
          <X className="w-4 h-4" />
        </button>
        <a href={`/api/download?url=${encodeURIComponent(gen.outputUrl)}&filename=creator-${gen.id}.jpg`}
          download className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}>
          <Download className="w-3.5 h-3.5" /> {copy.save}
        </a>
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
      const fd = new FormData();
      fd.append("modelId", model.id);
      fd.append("name", name.trim());
      fd.append("photo", photo);
      const data = await avatarAPI.create(fd);
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
  const isAdminUser = user?.role === "admin";
  const visibleTabs = isAdminUser ? TABS : TABS.filter((t) => t.id !== "avatars");

  // NanoBanana state
  const [prompt, setPrompt]             = useState("");
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
  const [wanResolution, setWanResolution] = useState("580p");
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [extendSourceId, setExtendSourceId] = useState("");

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
    if (!isAdminUser && activeTab === "avatars") {
      setActiveTab("generate");
    }
  }, [isAdminUser, activeTab]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (activeTab !== "generate") setMobileGenBarExpanded(false);
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
    startGeneration({ status: "processing", type: "creator-studio", prompt: prompt.trim() });
    try {
      const data = await creatorStudioAPI.generate({ prompt: prompt.trim(), referencePhotos: filledRefs, aspectRatio, resolution });
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
    if (videoFamily === "seedance2" && videoMode === "edit" && !videoInputVideoUrl.trim()) {
      toast.error("Seedance video edit requires a source video.");
      return;
    }
    if (videoFamily === "seedance2" && videoMode === "extend" && !extendSourceId.trim()) {
      toast.error("Select a previous Seedance generation to extend.");
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
        removeWatermark: soraRemoveWatermark,
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

  const handleSeedanceRemoveWatermark = async (item) => {
    if (!item?.id) return;
    const baseDuration = Math.max(5, Number(item.duration) || 5);
    const estimatedCost = Math.ceil(toPrice(generationPricing, "seedanceRemoveWatermarkPerSec") * baseDuration);
    setIsVideoGenerating(true);
    try {
      const data = await creatorStudioAPI.removeWatermarkVideo({ sourceGenerationId: item.id });
      if (!data?.success || !data?.generation?.id) {
        throw new Error(data?.message || "Failed to start watermark removal");
      }
      toast.success(`Watermark removal started (${estimatedCost} credits).`);
      pollForCompletion(data.generation.id, {
        onSuccess: (gen) => {
          toast.success("Watermark removed.");
          refreshUser?.();
          setVideoHistory((prev) => [{ ...gen }, ...prev.filter((g) => g.id !== gen.id)]);
        },
        onFailure: (gen) => toast.error(gen.errorMessage || "Watermark removal failed — credits refunded"),
      });
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Failed to start watermark removal");
    } finally {
      setIsVideoGenerating(false);
    }
  };

  const COST = resolution === "4K" ? 25 : 20;
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
      const cost = videoSize === "high"
        ? (videoNFrames === "15" ? toPrice(generationPricing, "sora2High15Frames") : toPrice(generationPricing, "sora2High10Frames"))
        : (videoNFrames === "15" ? toPrice(generationPricing, "sora2Standard15Frames") : toPrice(generationPricing, "sora2Standard10Frames"));
      return { cost, details: `Per generation (${videoNFrames}s · ${videoSize})` };
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
      const key = videoMode === "edit"
        ? (fast ? "seedance2FastPreviewEditCreditsPerSec" : "seedance2PreviewEditCreditsPerSec")
        : (fast ? "seedance2FastPreviewCreditsPerSec" : "seedance2PreviewCreditsPerSec");
      const perSec = toPrice(generationPricing, key);
      return { cost: Math.ceil(perSec * duration), details: `${perSec}/sec (${fast ? "Fast" : "Quality"})` };
    }
    return { cost: 0, details: "Pricing unavailable" };
  }, [durationConfig.min, generationPricing, kling30Quality, seedanceTaskType, soundEnabled, videoDuration, videoFamily, videoMode, videoNFrames, videoSize, videoSpeed, wanResolution]);

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
          <style>{`
            @keyframes bar-spin {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
          `}</style>
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
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">{copy.refs}</span>
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {refs.map((url, i) => (
                      <RefSlot key={i} url={url} uploading={uploadingIdx === i}
                        onRemove={() => removeRef(i)} onAdd={(file) => handleAddRef(file, i)} />
                    ))}
                  </div>
                </div>
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
                      disabled={isGenerating || !prompt.trim()}
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
                    disabled={isGenerating || !prompt.trim()}
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
                  <button type="button" onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}
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
        <div className="px-4 md:px-6 pb-6 pt-4 min-h-screen">
          <div className="w-full rounded-3xl border border-white/20 bg-white/10 p-4 md:p-6 shadow-[0_16px_64px_-24px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-2xl font-bold text-white">Video Generation</h2>
              </div>
              <div className="text-xs text-slate-400 rounded-xl border border-white/10 px-3 py-2">
                {selectedVideoFamily?.label || "Video"} · {videoMode.toUpperCase()}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-2">Family</p>
                <div className="flex flex-wrap gap-2">
                  {VIDEO_FAMILIES.map((family) => (
                    <Chip
                      key={family.id}
                      active={videoFamily === family.id}
                      onClick={() => {
                        setVideoFamily(family.id);
                        setVideoMode(defaultModeByFamily(family.id));
                      }}
                    >
                      {family.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-2">Mode</p>
                <div className="flex flex-wrap gap-2">
                  {videoModes.map((m) => (
                    <Chip key={m} active={videoMode === m} onClick={() => setVideoMode(m)}>
                      {m === "t2v"
                        ? "Text to Video"
                        : m === "i2v"
                          ? "Image to Video"
                          : m === "ref2v"
                            ? "Reference to Video"
                            : m === "move"
                              ? "Animate Move"
                              : m === "replace"
                                ? "Animate Replace"
                                : m === "edit"
                                  ? "Video Edit"
                                  : "Extend"}
                    </Chip>
                  ))}
                </div>
                <p className="text-xs text-violet-200/90 mt-2 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-yellow-400" />
                  {videoPricingInfo.details}
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                  <label className="block text-xs text-slate-400 mb-2">Prompt</label>
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    placeholder="Describe motion, camera, timing, and atmosphere"
                    rows={5}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white resize-none outline-none"
                  />
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-3 space-y-3">
                  {(videoFamily === "sora2" || videoFamily === "kling26") && videoMode === "i2v" && (
                    <MediaUploadField label="Input Image" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                  )}
                  {videoFamily === "kling30" && videoMode === "i2v" && (
                    <>
                      <MediaUploadField label="Start Frame" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                      <MediaUploadField label="End Frame (optional)" value={videoEndFrameUrl} onUploaded={setVideoEndFrameUrl} />
                    </>
                  )}
                  {videoFamily === "veo31" && videoMode === "i2v" && (
                    <>
                      <MediaUploadField label="Start Frame" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                      <MediaUploadField label="End Frame (optional)" value={videoEndFrameUrl} onUploaded={setVideoEndFrameUrl} />
                    </>
                  )}
                  {videoFamily === "veo31" && videoMode === "ref2v" && (
                    <>
                      <MediaUploadField label="Reference Image 1" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                      <MediaUploadField label="Reference Image 2 (optional)" value={videoRefImageUrl} onUploaded={setVideoRefImageUrl} />
                      <MediaUploadField label="Reference Image 3 (optional)" value={videoThirdImageUrl} onUploaded={setVideoThirdImageUrl} />
                    </>
                  )}
                  {videoFamily === "wan22" && (
                    <>
                      <MediaUploadField label="Input Video" value={videoInputVideoUrl} onUploaded={setVideoInputVideoUrl} accept="video/*" preview="video" />
                      <MediaUploadField label="Input Image" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                    </>
                  )}
                  {videoFamily === "seedance2" && (videoMode === "i2v" || videoMode === "edit") && (
                    <>
                      {videoMode === "edit" && (
                        <MediaUploadField label="Input Video" value={videoInputVideoUrl} onUploaded={setVideoInputVideoUrl} accept="video/*" preview="video" />
                      )}
                      <MediaUploadField label="Reference Image (optional)" value={videoImageUrl} onUploaded={setVideoImageUrl} />
                    </>
                  )}
                  {(videoFamily === "veo31" && videoMode === "extend") && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Select Veo video to extend</label>
                      <select value={extendSourceId} onChange={(e) => setExtendSourceId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none">
                        <option value="">Choose from gallery</option>
                        {videoHistory
                          .filter((item) => item?.providerFamily === "veo31" && item?.providerTaskId && item?.status === "completed")
                          .map((item) => (
                            <option key={item.id} value={item.providerTaskId}>
                              {item.prompt?.slice(0, 56) || "Veo generation"} ({item.providerTaskId})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  {(videoFamily === "seedance2" && videoMode === "extend") && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Select Seedance video to extend</label>
                      <select value={extendSourceId} onChange={(e) => setExtendSourceId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none">
                        <option value="">Choose from gallery</option>
                        {videoHistory
                          .filter((item) => item?.providerFamily === "seedance2" && item?.providerTaskId && item?.status === "completed")
                          .map((item) => (
                            <option key={item.id} value={item.providerTaskId}>
                              {item.prompt?.slice(0, 56) || "Seedance generation"} ({item.providerTaskId})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {videoFamily !== "sora2" && videoFamily !== "kling26" && videoFamily !== "veo31" && videoFamily !== "kling30" && (
                  <div className="rounded-xl border border-white/10 p-3 col-span-2 md:col-span-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs text-slate-400">Duration</label>
                      <span className="text-xs text-slate-300">{videoDuration}s</span>
                    </div>
                    <input
                      type="range"
                      min={durationConfig.min}
                      max={durationConfig.max}
                      step={durationConfig.step}
                      disabled={durationConfig.fixed}
                      value={videoDuration}
                      onChange={(e) => setVideoDuration(Number(e.target.value))}
                      className="w-full accent-violet-500 disabled:opacity-50"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                      <span>{durationConfig.min}s</span>
                      <span>{durationConfig.max}s</span>
                    </div>
                  </div>
                )}
                {videoFamily === "sora2" && (
                  <>
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Duration</label>
                      <ToggleGroup value={videoNFrames} onChange={setVideoNFrames} options={[{ value: "10", label: "10s" }, { value: "15", label: "15s" }]} />
                    </div>
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Quality</label>
                      <ToggleGroup value={soraQuality} onChange={setSoraQuality} options={[{ value: "standard", label: "Standard" }, { value: "high", label: "High" }]} />
                    </div>
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Size</label>
                      <ToggleGroup value={videoSize} onChange={setVideoSize} options={[{ value: "standard", label: "Standard" }, { value: "high", label: "High" }]} />
                    </div>
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Aspect Ratio</label>
                      <ToggleGroup value={videoAspectRatio} onChange={setVideoAspectRatio} options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
                    </div>
                    <div className="rounded-xl border border-white/10 p-3 col-span-2 md:col-span-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-300">Remove watermark</span>
                        <button
                          type="button"
                          onClick={() => setSoraRemoveWatermark((v) => !v)}
                          className={`px-3 py-1.5 rounded-lg text-xs ${soraRemoveWatermark ? "bg-violet-600 text-white" : "bg-white/10 text-slate-300"}`}
                        >
                          {soraRemoveWatermark ? "On" : "Off"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {videoFamily === "kling30" && (
                  <>
                    {/* 1. Quality mode */}
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Quality</label>
                      <ToggleGroup value={kling30Quality} onChange={setKling30Quality} options={[{ value: "std", label: "Standard" }, { value: "pro", label: "Pro" }]} />
                    </div>

                    {/* 2. Aspect Ratio */}
                    <div className="rounded-xl border border-white/10 p-3 col-span-1 md:col-span-2">
                      <label className="block text-xs text-slate-400 mb-2">Aspect Ratio</label>
                      <ToggleGroup value={videoAspectRatio} onChange={setVideoAspectRatio} options={[{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }]} />
                    </div>

                    {/* 3. Duration — single slider (only shown in single-shot mode) */}
                    {!kling30MultiShot && (
                      <div className="rounded-xl border border-white/10 p-3 col-span-2 md:col-span-4">
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-xs text-slate-400">Duration</label>
                          <span className="text-xs font-medium text-white">{videoDuration}s</span>
                        </div>
                        <input type="range" min={3} max={15} step={1} value={videoDuration} onChange={(e) => setVideoDuration(Number(e.target.value))} className="w-full accent-violet-500" />
                        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                          <span>3s</span>
                          <span>15s</span>
                        </div>
                      </div>
                    )}

                    {/* 4. Multi-shot toggle + shot editor */}
                    <div className="rounded-xl border border-white/10 p-3 col-span-2 md:col-span-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-300 flex items-center gap-1.5 font-medium">
                          Multi-shot
                          <span title="Generate multiple sequential shots in one request. Up to 5 shots; total duration ≤ 15s.">
                            <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setKling30MultiShot((v) => !v)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${kling30MultiShot ? "bg-violet-600 text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"}`}
                        >
                          {kling30MultiShot ? "On" : "Off"}
                        </button>
                      </div>

                      {kling30MultiShot && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-slate-500">
                              {kling30Shots.length} shot{kling30Shots.length !== 1 ? "s" : ""} ·{" "}
                              {kling30Shots.reduce((sum, s) => sum + s.duration, 0)}s total (max 15s)
                            </p>
                            {kling30Shots.length < 5 && (
                              <button
                                type="button"
                                onClick={() => setKling30Shots((prev) => [...prev, { prompt: "", duration: 3 }])}
                                className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add shot
                              </button>
                            )}
                          </div>
                          {kling30Shots.map((shot, idx) => (
                            <div key={idx} className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-slate-300">Shot {idx + 1}</span>
                                {kling30Shots.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setKling30Shots((prev) => prev.filter((_, i) => i !== idx))}
                                    className="text-slate-500 hover:text-red-400 transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              <textarea
                                value={shot.prompt}
                                onChange={(e) => setKling30Shots((prev) => prev.map((s, i) => i === idx ? { ...s, prompt: e.target.value } : s))}
                                placeholder={`Describe shot ${idx + 1} — motion, camera, scene changes…`}
                                rows={2}
                                className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white resize-none outline-none placeholder:text-slate-600"
                              />
                              <div className="flex items-center gap-3">
                                <label className="text-[11px] text-slate-500 whitespace-nowrap">Duration</label>
                                <input
                                  type="range"
                                  min={3}
                                  max={Math.min(10, 15 - kling30Shots.filter((_, i) => i !== idx).reduce((s, sh) => s + sh.duration, 0))}
                                  step={1}
                                  value={shot.duration}
                                  onChange={(e) => setKling30Shots((prev) => prev.map((s, i) => i === idx ? { ...s, duration: Number(e.target.value) } : s))}
                                  className="flex-1 accent-violet-500"
                                />
                                <span className="text-xs text-white font-medium w-6 text-right">{shot.duration}s</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 5. Elements (reference subjects) */}
                    <div className="rounded-xl border border-white/10 p-3 col-span-2 md:col-span-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-300 font-medium">Elements</span>
                        <span className="text-[11px] text-slate-500">Up to 3 elements · 2–4 images each</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input value={klingElementName} onChange={(e) => setKlingElementName(e.target.value)} placeholder="Element name (referenced as @name in prompt)" className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-slate-600" />
                        <input value={klingElementDescription} onChange={(e) => setKlingElementDescription(e.target.value)} placeholder="Description of this element" className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-slate-600" />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {klingElementMediaUrls.map((url, idx) => (
                          <MediaUploadField key={idx} label={`Image ${idx + 1}${idx < 2 ? " *" : " (opt)"}`} value={url} onUploaded={(newUrl) => setKlingElementMediaUrls((prev) => prev.map((v, i) => (i === idx ? newUrl : v)))} />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const media = klingElementMediaUrls.filter(Boolean);
                          if (!klingElementName.trim() || !klingElementDescription.trim() || media.length < 2) {
                            toast.error("Element needs a name, description, and at least 2 images.");
                            return;
                          }
                          setKlingElements((prev) => [
                            ...prev.slice(0, 2),
                            { name: klingElementName.trim(), description: klingElementDescription.trim(), element_input_urls: media.slice(0, 4) },
                          ]);
                          setKlingElementName("");
                          setKlingElementDescription("");
                          setKlingElementMediaUrls(["", "", "", ""]);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add element
                      </button>
                      {klingElements.length > 0 && (
                        <div className="space-y-1">
                          {klingElements.map((element, idx) => (
                            <div key={`${element.name}-${idx}`} className="text-xs text-slate-300 flex items-center justify-between rounded-lg bg-black/40 px-2.5 py-2">
                              <span className="truncate mr-3">@{element.name} · {element.description} · {element.element_input_urls.length} images</span>
                              <button type="button" className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0" onClick={() => setKlingElements((prev) => prev.filter((_, i) => i !== idx))}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {videoFamily === "kling26" && (
                  <>
                    {videoMode === "t2v" && (
                      <div className="rounded-xl border border-white/10 p-3 col-span-2">
                        <label className="block text-xs text-slate-400 mb-2">Aspect Ratio</label>
                        <ToggleGroup value={videoAspectRatio} onChange={setVideoAspectRatio} options={[{ value: "1:1", label: "1:1" }, { value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }]} />
                      </div>
                    )}
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Duration</label>
                      <ToggleGroup value={String(videoDuration)} onChange={(v) => setVideoDuration(Number(v))} options={[{ value: "5", label: "5s" }, { value: "10", label: "10s" }]} />
                    </div>
                  </>
                )}
                {videoFamily === "veo31" && (
                  <div className="col-span-2 md:col-span-4 rounded-xl border border-white/10 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Mode</label>
                        <ToggleGroup value={videoSpeed} onChange={setVideoSpeed} options={[{ value: "fast", label: "Fast" }, { value: "quality", label: "Quality" }]} />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Seed (10000-99999)</label>
                        <input
                          type="number"
                          min={10000}
                          max={99999}
                          value={veoSeed}
                          onChange={(e) => setVeoSeed(e.target.value)}
                          placeholder="optional"
                          className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Watermark (optional)</label>
                        <input
                          value={veoWatermark}
                          onChange={(e) => setVeoWatermark(e.target.value)}
                          placeholder="MyBrand"
                          className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => setVeoEnableTranslation((v) => !v)}
                          className={`w-full px-3 py-2 rounded-lg text-xs ${veoEnableTranslation ? "bg-violet-600 text-white" : "bg-white/10 text-slate-300"}`}
                        >
                          Translation: {veoEnableTranslation ? "On" : "Off"}
                        </button>
                      </div>
                    </div>
                    {(videoMode === "ref2v" || videoMode === "i2v") && (
                      <div className="mt-3">
                        <label className="block text-xs text-slate-400 mb-2">Aspect Ratio</label>
                        <ToggleGroup value={videoAspectRatio} onChange={setVideoAspectRatio} options={[{ value: "Auto", label: "Auto" }, { value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }]} />
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-3">Duration: 8s (fixed)</p>
                  </div>
                )}
                {videoFamily === "wan22" && (
                  <>
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Resolution</label>
                      <ToggleGroup value={wanResolution} onChange={setWanResolution} options={[{ value: "480p", label: "480p" }, { value: "580p", label: "580p" }, { value: "720p", label: "720p" }]} />
                    </div>
                  </>
                )}
                {videoFamily === "seedance2" && (
                  <>
                    <div className="rounded-xl border border-white/10 p-3">
                      <label className="block text-xs text-slate-400 mb-2">Model Variant</label>
                      <ToggleGroup value={seedanceTaskType} onChange={setSeedanceTaskType} options={[{ value: "seedance-2-preview", label: "Quality" }, { value: "seedance-2-fast-preview", label: "Fast" }]} />
                    </div>
                    {(videoMode === "t2v" || videoMode === "i2v") && (
                      <div className="rounded-xl border border-white/10 p-3 col-span-2">
                        <label className="block text-xs text-slate-400 mb-2">Aspect Ratio</label>
                        <ToggleGroup value={videoAspectRatio} onChange={setVideoAspectRatio} options={[{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "4:3", label: "4:3" }, { value: "3:4", label: "3:4" }]} />
                      </div>
                    )}
                  </>
                )}
              </div>

              {soundAvailable && (
                <div className="rounded-2xl border border-white/10 p-3 bg-black/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white">Sound generation</span>
                    <button
                      type="button"
                      onClick={() => setSoundEnabled((v) => !v)}
                      className={`px-3 py-1.5 rounded-lg text-xs ${soundEnabled ? "bg-violet-600 text-white" : "bg-white/10 text-slate-300"}`}
                    >
                      {soundEnabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                  {soundEnabled && (
                    <textarea
                      value={soundPrompt}
                      onChange={(e) => setSoundPrompt(e.target.value)}
                      rows={2}
                      placeholder="Speech, ambience, SFX (injected as: prompt, sound prompt: ...)"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white resize-none outline-none"
                    />
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-xs text-slate-400">{formatCopy(copy.creditsAvailable, { credits: creditsLeft })}</p>
                <button
                  type="button"
                  onClick={handleGenerateVideo}
                  disabled={isVideoGenerating}
                  className="w-full sm:w-auto min-h-[46px] px-5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 disabled:opacity-40 text-white flex items-center justify-center gap-2"
                >
                  {isVideoGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                  <span className="inline-flex items-center gap-1.5">
                    {isVideoGenerating ? copy.generatingVideo : copy.generateVideo}
                    <span className="inline-flex items-center gap-1">
                      {videoPricingInfo.cost}
                      <Coins className="w-3.5 h-3.5 text-yellow-300" />
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Recent Video Jobs</p>
            {videoHistory.length === 0 && !videoHistLoading && (
              <p className="text-sm text-slate-500">No video jobs yet.</p>
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
                            setVideoMode("extend");
                            setExtendSourceId(item.providerTaskId);
                          }}
                          className="mt-2 text-xs px-2.5 py-1.5 rounded-lg bg-white/10 text-slate-200 hover:bg-white/15"
                        >
                          Extend this video
                        </button>
                      )}
                      {item.providerFamily === "seedance2" && item.status === "completed" && item.outputUrl && (
                        <button
                          type="button"
                          onClick={() => handleSeedanceRemoveWatermark(item)}
                          className="mt-2 ml-2 text-xs px-2.5 py-1.5 rounded-lg bg-violet-600/70 text-white hover:bg-violet-600"
                        >
                          Remove watermark
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Real Avatars tab ──────────────────────────────────────────────── */}
      {activeTab === "avatars" && (
        <RealAvatarsTab sidebarCollapsed={sidebarCollapsed} />
      )}

      {activeTab === "voices" && <CreatorStudioVoiceTab initialModelId={initialModelId} />}
    </div>
  );
}
