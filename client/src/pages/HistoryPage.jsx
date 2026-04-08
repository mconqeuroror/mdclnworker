import { useState, useEffect, memo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Eye,
  X,
  Loader2,
  Download,
  Trash2,
  CheckSquare,
  Square,
  Grid3X3,
  List,
  Layers,
  Zap,
  Info,
  Wand2,
  RefreshCw,
} from "lucide-react";
import api from "../services/api";
import { usePageVisibility } from "../hooks/usePageVisibility";
import { useReducedMotion } from "../hooks/useReducedMotion";
import toast from "react-hot-toast";
import JSZip from "jszip";
import {
  GenerationCardSkeleton,
  Skeleton,
} from "../components/skeletons/Skeleton";
import LazyImage from "../components/LazyImage";
import LazyVideo from "../components/LazyVideo";
import { getThumbnailUrl, getMediumUrl } from "../utils/imageUtils";
import { downloadFromPublicUrl, fetchPublicAssetBlob } from "../utils/directDownload";

const gradientPurple = 'linear-gradient(135deg, #8B5CF6, #3B82F6)';
const gradientCyan = 'linear-gradient(135deg, #22D3EE, #14B8A6)';

const VIDEO_TYPES = ["video", "faceswap", "face-swap", "prompt-video", "talking-head", "recreate-video", "creator-studio-video"];
const PAGE_SIZE = 200;
const REFRESH_PAGE_SIZE = 60;
const CONTENT_TYPE_OPTIONS = ["all", "image", "prompt-based", "video", "face-swap", "talking-head", "recreate-video", "creator-studio"];
const PURPLE_CORNER_GLOW_STYLE = {
  background:
    "radial-gradient(ellipse 100% 100% at 0% 0%, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.06) 45%, transparent 70%)",
};
const SELECTED_FILTER_STYLE = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.16)",
};
const PREVIEW_BADGE_STYLE = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.18)",
  color: "#E5E7EB",
};
const LOCALE_STORAGE_KEY = "app_locale";
const PAGE_COPY = {
  en: {
    title: "History",
    subtitle: "View and manage your generated content",
    retry: "Retry",
    filterByContentType: "Filter by content type",
    filterByModel: "Filter by model",
    all: "All",
    allModels: "All Models",
    lookupPlaceholder: "Lookup model by name...",
    unnamed: "Unnamed",
    noModelsFound: "No models found for this lookup.",
    errorLoadGenerations: "Failed to load generations",
    errorLoadMore: "Failed to load more generations",
    confirmDeleteSelected: "Delete {count} generation(s)?",
    toastDeleted: "Deleted {count} generation(s)",
    toastDeleteFailed: "Failed to delete",
    toastPreparingZip: "Preparing ZIP ({count} images)...",
    toastDownloaded: "Downloaded",
    toastNoCompleted: "No completed generations to download",
    toastDownloadingProgress: "Downloading {current}/{total}...",
    toastCreatingZip: "Creating ZIP file...",
    toastDownloadedCount: "Downloaded {count} generation(s)",
    toastDownloadFailed: "Failed to download",
    viewShowing: "Showing {shown} of {total}",
    batchSelected: "{count} selected",
    cleanupDisabled:
      "Automatic history cleanup is currently disabled. Content is kept unless you delete it manually.",
    cleanupEnabled:
      "We store up to {max} generations per model. Older content is automatically removed when the limit is reached. Download anything you want to keep!",
    emptyTitle: "No generations found",
    emptySubtitle: "Try adjusting your filters or create new content",
    buttonLoading: "Loading…",
    buttonLoadMore: "Load more ({remaining} remaining)",
    statusQueued: "Queued…",
    statusProcessing: "Processing…",
    statusFailed: "Failed",
    previewTitle: "Preview",
    previewPrev: "Prev",
    previewNext: "Next",
    previewPrompt: "Prompt",
    previewNegativePrompt: "Negative Prompt",
    previewFullBuiltPrompt: "Full Built Prompt",
    filterImage: "Image",
    filterPromptBased: "Prompt Based",
    filterVideo: "Video",
    filterFaceSwap: "Face Swap",
    filterTalkingHead: "Talking Head",
    filterRecreateVideo: "Recreate Video",
    filterCreatorStudio: "Creator Studio",
    download: "Download",
    delete: "Delete",
    altGenerated: "Generated",
    genTypeImage: "Image",
    genTypeImageIdentity: "Identity",
    genTypePromptImage: "Prompt Image",
    genTypeFaceSwapImage: "Face Swap Image",
    genTypeAdvancedImage: "Advanced Image",
    genTypeNsfw: "NSFW",
    genTypeVideo: "Video",
    genTypePromptVideo: "Prompt Video",
    genTypeFaceSwap: "Face Swap",
    genTypeFaceswap: "Face Swap",
    genTypeTalkingHead: "Talking Head",
    genTypeNsfwVideo: "NSFW Video",
    genTypeNsfwVideoExtend: "NSFW Extend",
    genTypeRecreateVideo: "Recreate Video",
    genTypeCreatorStudio: "Creator Studio",
  },
  ru: {
    title: "История",
    subtitle: "Просмотр и управление сгенерированным контентом",
    retry: "Повторить",
    filterByContentType: "Фильтр по типу контента",
    filterByModel: "Фильтр по модели",
    all: "Все",
    allModels: "Все модели",
    lookupPlaceholder: "Поиск модели по имени...",
    unnamed: "Без названия",
    noModelsFound: "Для этого поиска модели не найдены.",
    errorLoadGenerations: "Не удалось загрузить генерации",
    errorLoadMore: "Не удалось загрузить дополнительные генерации",
    confirmDeleteSelected: "Удалить {count} генерацию(-ий)?",
    toastDeleted: "Удалено {count} генерацию(-ий)",
    toastDeleteFailed: "Не удалось удалить",
    toastPreparingZip: "Подготовка ZIP ({count} изображений)...",
    toastDownloaded: "Скачано",
    toastNoCompleted: "Нет завершённых генераций для скачивания",
    toastDownloadingProgress: "Скачивание {current}/{total}...",
    toastCreatingZip: "Создание ZIP-файла...",
    toastDownloadedCount: "Скачано {count} генерацию(-ий)",
    toastDownloadFailed: "Не удалось скачать",
    viewShowing: "Показано {shown} из {total}",
    batchSelected: "Выбрано: {count}",
    cleanupDisabled:
      "Автоматическая очистка истории отключена. Контент хранится до тех пор, пока вы не удалите его вручную.",
    cleanupEnabled:
      "Мы храним до {max} генераций на модель. Старый контент автоматически удаляется при достижении лимита. Скачайте всё, что хотите сохранить!",
    emptyTitle: "Генерации не найдены",
    emptySubtitle: "Попробуйте изменить фильтры или создайте новый контент",
    buttonLoading: "Загрузка…",
    buttonLoadMore: "Загрузить ещё (осталось {remaining})",
    statusQueued: "В очереди…",
    statusProcessing: "Обработка…",
    statusFailed: "Ошибка",
    previewTitle: "Просмотр",
    previewPrev: "Назад",
    previewNext: "Вперёд",
    previewPrompt: "Промпт",
    previewNegativePrompt: "Негативный промпт",
    previewFullBuiltPrompt: "Полный собранный промпт",
    filterImage: "Изображение",
    filterPromptBased: "По промпту",
    filterVideo: "Видео",
    filterFaceSwap: "Замена лица",
    filterTalkingHead: "Говорящая голова",
    filterRecreateVideo: "Пересоздание видео",
    filterCreatorStudio: "Студия автора",
    download: "Скачать",
    delete: "Удалить",
    altGenerated: "Сгенерировано",
    genTypeImage: "Изображение",
    genTypeImageIdentity: "Идентичность",
    genTypePromptImage: "Промпт-изображение",
    genTypeFaceSwapImage: "Фото со сменой лица",
    genTypeAdvancedImage: "Продвинутое изображение",
    genTypeNsfw: "NSFW",
    genTypeVideo: "Видео",
    genTypePromptVideo: "Промпт-видео",
    genTypeFaceSwap: "Замена лица",
    genTypeFaceswap: "Замена лица",
    genTypeTalkingHead: "Говорящая голова",
    genTypeNsfwVideo: "NSFW-видео",
    genTypeNsfwVideoExtend: "Продление NSFW",
    genTypeRecreateVideo: "Пересоздание видео",
    genTypeCreatorStudio: "Студия автора",
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

function contentFilterLabel(type, copy) {
  if (type === "all") return copy.all;
  const map = {
    image: copy.filterImage,
    "prompt-based": copy.filterPromptBased,
    video: copy.filterVideo,
    "face-swap": copy.filterFaceSwap,
    "talking-head": copy.filterTalkingHead,
    "recreate-video": copy.filterRecreateVideo,
    "creator-studio": copy.filterCreatorStudio,
  };
  return map[type] || type;
}

function generationTypeLabel(genType, copy) {
  const map = {
    image: copy.genTypeImage,
    "image-identity": copy.genTypeImageIdentity,
    "prompt-image": copy.genTypePromptImage,
    "face-swap-image": copy.genTypeFaceSwapImage,
    "advanced-image": copy.genTypeAdvancedImage,
    nsfw: copy.genTypeNsfw,
    video: copy.genTypeVideo,
    "prompt-video": copy.genTypePromptVideo,
    "face-swap": copy.genTypeFaceSwap,
    faceswap: copy.genTypeFaceswap,
    "talking-head": copy.genTypeTalkingHead,
    "nsfw-video": copy.genTypeNsfwVideo,
    "nsfw-video-extend": copy.genTypeNsfwVideoExtend,
    "recreate-video": copy.genTypeRecreateVideo,
    "creator-studio": copy.genTypeCreatorStudio,
    "creator-studio-video": copy.genTypeCreatorStudio,
  };
  const label = map[genType];
  if (label) return label;
  return String(genType || "").replace(/-/g, " ");
}

function useMainViewportBounds() {
  const [bounds, setBounds] = useState({ left: 0, width: null });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let ro = null;
    let mo = null;
    const update = () => {
      const mainEl = document.querySelector("main");
      if (mainEl && window.innerWidth >= 768) {
        const rect = mainEl.getBoundingClientRect();
        setBounds({ left: Math.max(0, Math.round(rect.left)), width: Math.max(320, Math.round(rect.width)) });
      } else {
        setBounds({ left: 0, width: null });
      }
    };
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener("resize", schedule);
    const mainEl = document.querySelector("main");
    if (mainEl && "ResizeObserver" in window) {
      ro = new ResizeObserver(schedule);
      ro.observe(mainEl);
    }
    if (mainEl && "MutationObserver" in window) {
      mo = new MutationObserver(schedule);
      mo.observe(mainEl, { attributes: true, attributeFilter: ["class", "style"] });
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", schedule);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
    };
  }, []);

  return bounds;
}

function parseOutputUrls(outputUrl) {
  if (!outputUrl) return [];
  if (Array.isArray(outputUrl)) return outputUrl.filter(Boolean);
  if (typeof outputUrl !== "string") return [];

  const trimmed = outputUrl.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {}

  return [trimmed];
}

function isVideoUrl(url) {
  const lower = (url || "").toLowerCase();
  return lower.includes(".mp4") || lower.includes(".webm");
}

function matchesType(genType, selectedType) {
  if (selectedType === "all") return true;

  // UI groupings
  if (selectedType === "image") {
    return ["image", "prompt-image", "face-swap-image", "nsfw"].includes(genType);
  }
  if (selectedType === "video") {
    return ["video", "prompt-video", "face-swap", "talking-head", "nsfw-video", "nsfw-video-extend", "recreate-video"].includes(genType);
  }
  if (selectedType === "prompt-based") {
    return ["prompt-image", "prompt-video"].includes(genType);
  }
  if (selectedType === "face-swap") {
    return ["face-swap", "face-swap-image", "faceswap"].includes(genType);
  }
  if (selectedType === "talking-head") {
    return genType === "talking-head";
  }
  if (selectedType === "recreate-video") {
    return genType === "recreate-video";
  }
  if (selectedType === "creator-studio") {
    return genType === "creator-studio";
  }

  // Fallback: exact match
  return genType === selectedType;
}

export default function HistoryPage() {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const isPageVisibility = usePageVisibility();
  const [models, setModels] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, limit: PAGE_SIZE, offset: 0 });
  const [retentionMaxPerModel, setRetentionMaxPerModel] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [viewMode, setViewMode] = useState("grid");

  const [selectedModelId, setSelectedModelId] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [modelLookup, setModelLookup] = useState("");

  const [selectedGenerations, setSelectedGenerations] = useState([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, ids: [] });
  const [milestoneBanner, setMilestoneBanner] = useState(null); // { count, milestone }

  useEffect(() => {
    loadModels();
    loadHistory({ reset: true });
  }, []);

  useEffect(() => {
    if (!isPageVisibility) return;
    // Keep gallery fresh without re-downloading everything: refresh the latest page and merge.
    const interval = setInterval(() => loadHistory({ reset: false, refreshLatest: true }), 10000);
    return () => clearInterval(interval);
  }, [isPageVisibility]);

  // Show a milestone celebration banner when total crosses a threshold (shown once per milestone)
  useEffect(() => {
    const total = pagination.total;
    if (!total || total === 0) return;
    const MILESTONES = [100, 500, 1000, 5000, 10000];
    const seenKey = "mc_seen_milestones";
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(seenKey) || "[]"); } catch {}
    for (let i = MILESTONES.length - 1; i >= 0; i--) {
      const m = MILESTONES[i];
      if (total >= m && !seen.includes(m)) {
        seen.push(m);
        try { localStorage.setItem(seenKey, JSON.stringify(seen)); } catch {}
        setMilestoneBanner({ count: total, milestone: m });
        break;
      }
    }
  }, [pagination.total]);

  const loadModels = async () => {
    try {
      const response = await api.get("/models");
      if (response.data.success) {
        setModels(response.data.models || []);
      }
    } catch (error) {
      console.error("Failed to load models:", error);
    }
  };

  const mergeGenerations = (prev, next) => {
    const map = new Map();
    (prev || []).forEach((g) => map.set(g.id, g));
    (next || []).forEach((g) => map.set(g.id, g));
    return Array.from(map.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  };

  const loadHistory = async ({ reset = false, refreshLatest = false } = {}) => {
    try {
      if (reset) setLoadError(null);
      const nextOffset = reset ? 0 : refreshLatest ? 0 : pagination.offset;
      const requestLimit = refreshLatest ? REFRESH_PAGE_SIZE : PAGE_SIZE;
      const includeTotal = reset ? "true" : "false";
      const response = await api.get(
        `/generations?limit=${requestLimit}&offset=${nextOffset}&includeTotal=${includeTotal}`,
      );
      if (response.data.success) {
        if (!refreshLatest) setLoadError(null);
        const nextGens = response.data.generations || [];
        const maxCompletedPerModel =
          response.data?.retention?.maxCompletedPerModel ?? null;
        setRetentionMaxPerModel(maxCompletedPerModel);
        const nextPagination = response.data.pagination || {
          total: 0,
          limit: requestLimit,
          offset: nextOffset,
        };

        if (reset) {
          setGenerations(nextGens);
          setPagination(nextPagination);
        } else if (refreshLatest) {
          setGenerations((prev) => mergeGenerations(prev, nextGens));
          // Keep existing offset; just update total/limit
          setPagination((prev) => ({
            ...prev,
            total: nextPagination.total ?? prev.total,
            limit: nextPagination.limit ?? prev.limit,
          }));
        } else {
          setGenerations((prev) => mergeGenerations(prev, nextGens));
          setPagination((prev) => ({
            ...prev,
            total: nextPagination.total ?? prev.total,
            limit: nextPagination.limit ?? prev.limit,
            offset: nextPagination.offset ?? prev.offset,
          }));
        }
      }
    } catch (error) {
      console.error("Error loading history:", error);
      if (!refreshLatest) {
        setLoadError(error?.response?.data?.message || error?.message || copy.errorLoadGenerations);
      }
    } finally {
      setLoading(false);
    }
  };

  const hasMore = generations.length < (pagination.total || 0);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextOffset = generations.length;
      const response = await api.get(
        `/generations?limit=${PAGE_SIZE}&offset=${nextOffset}&includeTotal=false`,
      );
      if (response.data.success) {
        const nextGens = response.data.generations || [];
        const nextPagination = response.data.pagination || {
          total: pagination.total,
          limit: PAGE_SIZE,
          offset: nextOffset,
        };
        setGenerations((prev) => mergeGenerations(prev, nextGens));
        setPagination((prev) => ({
          ...prev,
          total: nextPagination.total ?? prev.total,
          limit: nextPagination.limit ?? prev.limit,
          offset: nextPagination.offset ?? prev.offset,
        }));
      }
    } catch (e) {
      console.error("Error loading more history:", e);
      setLoadError(e?.response?.data?.message || e?.message || copy.errorLoadMore);
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredGenerations = generations.filter((gen) => {
    if (selectedStatus !== "all" && gen.status !== selectedStatus) return false;
    if (selectedModelId !== "all" && gen.modelId !== selectedModelId) return false;
    if (!matchesType(gen.type, selectedType)) return false;
    return true;
  });

  const lookupModels = models.filter((model) =>
    (model?.name || copy.unnamed).toLowerCase().includes(modelLookup.trim().toLowerCase())
  );

  const toggleSelection = (genId) => {
    setSelectedGenerations((prev) =>
      prev.includes(genId) ? prev.filter((id) => id !== genId) : [...prev, genId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedGenerations.length === filteredGenerations.length) {
      setSelectedGenerations([]);
    } else {
      setSelectedGenerations(filteredGenerations.map((g) => g.id));
    }
  };

  const requestDelete = useCallback((ids) => {
    const normalized = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (normalized.length === 0) return;
    setDeleteConfirm({ open: true, ids: normalized });
  }, []);

  const handleBatchDelete = async (idsOverride) => {
    const idsToDelete = Array.isArray(idsOverride) && idsOverride.length > 0 ? idsOverride : selectedGenerations;
    if (idsToDelete.length === 0) return;

    setBatchDeleting(true);
    try {
      const response = await api.post("/generations/batch-delete", {
        generationIds: idsToDelete,
      });
      if (response.data.success) {
        toast.success(formatCopy(copy.toastDeleted, { count: idsToDelete.length }));
        setSelectedGenerations([]);
        loadHistory();
      } else {
        toast.error(response.data.message || copy.toastDeleteFailed);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || copy.toastDeleteFailed);
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleSingleDownload = async (generation) => {
    if (!generation.outputUrl) return;

    const urls = parseOutputUrls(generation.outputUrl);
    if (urls.length === 0) return;

    const idPrefix = generation.id.slice(0, 8);
    const primaryUrl = urls[0];
    const isVideo = VIDEO_TYPES.includes(generation.type) || isVideoUrl(primaryUrl);

    // Single file: direct download via proxy
    if (urls.length === 1 || isVideo) {
      const lowerUrl = primaryUrl.toLowerCase();
      const ext = isVideo ? (lowerUrl.includes(".webm") ? "webm" : "mp4") : "jpg";
      const filename = `${generation.type}_${idPrefix}.${ext}`;
      await downloadFromPublicUrl(primaryUrl, filename);
      return;
    }

    // Multiple images: bundle into a zip so users don't miss "hidden" outputs
    toast.loading(formatCopy(copy.toastPreparingZip, { count: urls.length }), { id: "download-progress" });
    const zip = new JSZip();
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const filename = `${generation.type}_${idPrefix}_${i + 1}.jpg`;
      try {
        const blob = await fetchPublicAssetBlob(url);
        zip.file(filename, blob);
      } catch (e) {
        console.error(`Failed to download output ${i + 1}/${urls.length} for ${generation.id}:`, e);
      }
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = zipUrl;
    a.download = `${generation.type}_${idPrefix}_${urls.length}_images.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(zipUrl);
    toast.success(copy.toastDownloaded, { id: "download-progress" });
  };

  const handleBatchDownload = async () => {
    if (selectedGenerations.length === 0) return;
    setBatchDownloading(true);

    try {
      const selectedGens = generations.filter((g) => selectedGenerations.includes(g.id));
      const completedGens = selectedGens.filter((g) => g.status === "completed" && g.outputUrl);

      if (completedGens.length === 0) {
        toast.error(copy.toastNoCompleted);
        setBatchDownloading(false);
        return;
      }

      const zip = new JSZip();

      for (let i = 0; i < completedGens.length; i++) {
        const gen = completedGens[i];
        toast.loading(formatCopy(copy.toastDownloadingProgress, { current: i + 1, total: completedGens.length }), { id: "download-progress" });

        try {
          const urls = parseOutputUrls(gen.outputUrl);
          if (urls.length === 0) continue;

          const idPrefix = gen.id.slice(0, 8);
          for (let u = 0; u < urls.length; u++) {
            const url = urls[u];
            const isVideo = VIDEO_TYPES.includes(gen.type) || isVideoUrl(url);
            const lowerUrl = url.toLowerCase();
            const ext = isVideo ? (lowerUrl.includes(".webm") ? "webm" : "mp4") : "jpg";
            const filename = `${gen.type}_${idPrefix}${urls.length > 1 ? `_${u + 1}` : ""}.${ext}`;
            const blob = await fetchPublicAssetBlob(url);
            zip.file(filename, blob);
          }
        } catch (error) {
          console.error(`Failed to download ${gen.id}:`, error);
        }
      }

      toast.loading(copy.toastCreatingZip, { id: "download-progress" });
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelclone_${completedGens.length}_generations.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(formatCopy(copy.toastDownloadedCount, { count: completedGens.length }), { id: "download-progress" });
    } catch (error) {
      toast.error(copy.toastDownloadFailed, { id: "download-progress" });
    } finally {
      setBatchDownloading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{copy.title}</h1>
          <p className="text-slate-400 text-sm">{copy.subtitle}</p>
        </div>
      </div>

      {/* Milestone celebration banner */}
      <AnimatePresence>
        {milestoneBanner && (
          <motion.div
            key="milestone-banner"
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="mb-5 rounded-2xl p-4 sm:p-5 flex items-center gap-4 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(59,130,246,0.15) 100%)',
              border: '1px solid rgba(139,92,246,0.35)',
              boxShadow: '0 0 30px rgba(139,92,246,0.15)',
            }}
          >
            <div className="absolute top-0 left-0 w-40 h-40 pointer-events-none" style={{ background: 'radial-gradient(ellipse 100% 100% at 0% 0%, rgba(139,92,246,0.3) 0%, transparent 70%)' }} />
            <div className="relative text-3xl select-none">🎉</div>
            <div className="relative flex-1 min-w-0">
              <p className="text-white font-bold text-base sm:text-lg">
                {milestoneBanner.milestone.toLocaleString()} generations milestone!
              </p>
              <p className="text-slate-300 text-sm mt-0.5">
                You've created {milestoneBanner.count.toLocaleString()} pieces of content. Keep creating!
              </p>
            </div>
            <button
              onClick={() => setMilestoneBanner(null)}
              className="relative shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => (
              <GenerationCardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {loadError && (
            <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-3">
              <p className="text-sm text-amber-200">{loadError}</p>
              <button
                onClick={() => loadHistory({ reset: true })}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-amber-100 border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30"
                data-testid="history-retry-load"
              >
                {copy.retry}
              </button>
            </div>
          )}
          {/* Filters */}
          <div className="mb-5 space-y-3">
            {/* Filters */}
            <div
              className="rounded-xl p-3 sm:p-4"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                    <div className="text-xs uppercase tracking-wider text-slate-400">{copy.filterByContentType}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {CONTENT_TYPE_OPTIONS.map((type) => (
                      <button
                        key={type}
                        onClick={() => { setSelectedType(type); setSelectedGenerations([]); }}
                        className={`relative overflow-hidden px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-all border ${
                          selectedType === type
                            ? "text-white font-medium"
                            : "text-slate-400 hover:text-white border-white/10"
                        }`}
                        style={selectedType === type ? SELECTED_FILTER_STYLE : { background: "rgba(255,255,255,0.05)" }}
                        data-testid={`filter-${type}`}
                      >
                        {selectedType === type && (
                          <span className="absolute top-0 left-0 w-16 h-16 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                        )}
                        {selectedType === type && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                        )}
                        {contentFilterLabel(type, copy)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                    <div className="text-xs uppercase tracking-wider text-slate-400">{copy.filterByModel}</div>
                    <div className="flex-1" />
                    <button
                      onClick={() => { setSelectedModelId("all"); setSelectedGenerations([]); }}
                      className={`relative overflow-hidden px-3 py-1.5 rounded-lg text-xs sm:text-sm whitespace-nowrap transition-all border ${
                        selectedModelId === "all"
                          ? "text-white font-medium"
                          : "text-slate-400 hover:text-white border-white/10"
                      }`}
                      style={selectedModelId === "all" ? SELECTED_FILTER_STYLE : { background: "rgba(255,255,255,0.05)" }}
                      data-testid="tab-all-models"
                    >
                      {selectedModelId === "all" && (
                        <span className="absolute top-0 left-0 w-16 h-16 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                      )}
                      {selectedModelId === "all" && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                      )}
                      {copy.allModels}
                    </button>
                  </div>

                  <input
                    type="text"
                    value={modelLookup}
                    onChange={(e) => setModelLookup(e.target.value)}
                    placeholder={copy.lookupPlaceholder}
                    className="w-full px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:border-white/20"
                    data-testid="input-model-lookup"
                  />

                  <div className="mt-2 max-h-44 overflow-y-auto space-y-1 pr-1">
                    {lookupModels.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => { setSelectedModelId(model.id); setSelectedGenerations([]); }}
                        className={`relative overflow-hidden w-full px-2.5 py-2 rounded-lg text-sm transition-all flex items-center gap-2 border ${
                          selectedModelId === model.id
                            ? "text-white font-medium"
                            : "text-slate-400 hover:text-white border-white/10"
                        }`}
                        style={selectedModelId === model.id ? SELECTED_FILTER_STYLE : { background: "rgba(255,255,255,0.05)" }}
                        data-testid={`tab-model-${model.id}`}
                      >
                        {selectedModelId === model.id && (
                          <span className="absolute top-0 left-0 w-16 h-16 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                        )}
                        {selectedModelId === model.id && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                        )}
                        <LazyImage src={getThumbnailUrl(model.photo1Url)} alt="" className="w-5 h-5 rounded-full object-cover" />
                        <span className="truncate">{model.name || copy.unnamed}</span>
                      </button>
                    ))}
                    {lookupModels.length === 0 && (
                      <p className="text-xs text-slate-500 px-1 py-1">{copy.noModelsFound}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* View Mode */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex-1" />

              {/* View Mode Toggle */}
              <div 
                className="flex gap-0.5 rounded-md p-0.5"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                <button
                  onClick={() => { setViewMode("grid"); }}
                  className={`p-1.5 rounded transition-all ${viewMode === "grid" ? "bg-white/15 text-white" : "text-slate-500"}`}
                  data-testid="view-grid"
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setViewMode("list"); }}
                  className={`p-1.5 rounded transition-all ${viewMode === "list" ? "bg-white/15 text-white" : "text-slate-500"}`}
                  data-testid="view-list"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end mb-5">
            <div className="text-[11px] text-slate-500">
              {formatCopy(copy.viewShowing, {
                shown: filteredGenerations.length,
                total: pagination.total || generations.length,
              })}
            </div>
          </div>

          {/* Batch Actions */}
          <AnimatePresence>
            {selectedGenerations.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-lg p-3 mb-4 flex items-center gap-3 overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-xs text-slate-300 hover:text-white px-2 py-1 rounded"
                >
                  {selectedGenerations.length === filteredGenerations.length ? (
                    <CheckSquare className="w-4 h-4 text-purple-400" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  {formatCopy(copy.batchSelected, { count: selectedGenerations.length })}
                </button>

                <div className="flex-1" />

                <button
                  onClick={handleBatchDownload}
                  disabled={batchDownloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-50"
                  style={{ background: gradientCyan }}
                  data-testid="batch-download"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>

                <button
                  onClick={() => requestDelete(selectedGenerations)}
                  disabled={batchDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-md text-xs font-medium text-red-300 disabled:opacity-50"
                  data-testid="batch-delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Storage info */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.1)' }}>
            <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            {retentionMaxPerModel == null ? (
              <span>{copy.cleanupDisabled}</span>
            ) : (
              <span>{formatCopy(copy.cleanupEnabled, { max: retentionMaxPerModel })}</span>
            )}
          </div>

          {/* Generations Grid/List */}
          {filteredGenerations.length === 0 ? (
            <div 
              className="rounded-xl p-10 text-center"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.04))', border: '1px solid rgba(139,92,246,0.15)' }}
            >
              <Clock className="w-12 h-12 mx-auto mb-3 text-slate-600" />
              <h3 className="text-lg font-semibold text-white mb-1">{copy.emptyTitle}</h3>
              <p className="text-slate-500 text-sm">{copy.emptySubtitle}</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filteredGenerations.map((gen, index) => (
                <GenerationCard
                  key={gen.id}
                  generation={gen}
                  models={models}
                  isSelected={selectedGenerations.includes(gen.id)}
                  onToggleSelect={() => toggleSelection(gen.id)}
                  onPreview={() => setPreviewItem(gen)}
                  onDownload={() => handleSingleDownload(gen)}
                  onDelete={() => requestDelete([gen.id])}
                  index={index}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredGenerations.map((gen, index) => (
                <GenerationListItem
                  key={gen.id}
                  generation={gen}
                  models={models}
                  isSelected={selectedGenerations.includes(gen.id)}
                  onToggleSelect={() => toggleSelection(gen.id)}
                  onPreview={() => setPreviewItem(gen)}
                  onDownload={() => handleSingleDownload(gen)}
                  onDelete={() => requestDelete([gen.id])}
                  index={index}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2"
                style={{ background: gradientPurple, border: "1px solid rgba(139,92,246,0.35)" }}
                data-testid="history-load-more"
              >
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loadingMore ? copy.buttonLoading : formatCopy(copy.buttonLoadMore, { remaining: Math.max(0, (pagination.total || 0) - generations.length) })}
              </button>
            </div>
          )}
        </>
      )}

      {/* Preview Modal */}
      <AnimatePresence>
        {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => handleSingleDownload(previewItem)} />}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConfirm.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setDeleteConfirm({ open: false, ids: [] })}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-white/20 bg-[rgba(17,17,26,0.96)] p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-white mb-2">Confirm delete</h3>
              <p className="text-sm text-slate-300 mb-4">
                {formatCopy(copy.confirmDeleteSelected, { count: deleteConfirm.ids.length })}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm({ open: false, ids: [] })}
                  className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/10 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ids = deleteConfirm.ids;
                    setDeleteConfirm({ open: false, ids: [] });
                    await handleBatchDelete(ids);
                  }}
                  className="px-3 py-2 rounded-lg text-sm font-semibold border border-red-400/35 bg-red-500/10 text-red-200 hover:bg-red-500/20 transition"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const GenerationCard = memo(function GenerationCard({ generation, models, isSelected, onToggleSelect, onPreview, onDownload, onDelete, index }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const model = models.find((m) => m.id === generation.modelId);
  const urls = parseOutputUrls(generation.outputUrl);
  const primaryUrl = urls[0] || "";
  const isVideo = VIDEO_TYPES.includes(generation.type) || isVideoUrl(primaryUrl);
  const videoPoster = generation.providerResponse?.thumbnailUrl || generation.providerResponse?.thumbnail || generation.inputImageUrl || undefined;
  const providerModelTag = String(generation.providerModel || "").replace(/^kie-/, "").replace(/^piapi-/, "");
  const providerModeTag = String(generation.providerMode || generation.providerType || "").trim();

  return (
    <div
      className="group rounded-lg overflow-hidden relative"
      style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(59,130,246,0.05))', border: '1px solid rgba(139,92,246,0.2)' }}
      data-testid={`generation-card-${generation.id}`}
    >
      {/* Selection Checkbox */}
      <button
        onClick={onToggleSelect}
        className="absolute top-2 left-2 z-10 p-1.5 rounded-md backdrop-blur-sm"
        style={{ background: 'rgba(0,0,0,0.5)' }}
      >
        {isSelected ? (
          <CheckSquare className="w-4 h-4 text-purple-400" />
        ) : (
          <Square className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {/* Media */}
      <div className="aspect-square bg-black/30 relative overflow-hidden cursor-pointer" onClick={onPreview}>
        {generation.status === "completed" && generation.outputUrl ? (
          <>
            {isVideo ? (
              <LazyVideo src={primaryUrl} poster={videoPoster} videoClassName="object-cover" className="w-full h-full" muted loop playsInline />
            ) : (
              <LazyImage src={getMediumUrl(primaryUrl)} alt={copy.altGenerated} className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onPreview(); }}
                className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
              >
                <Eye className="w-4 h-4 text-white" />
              </button>
              {generation.prompt && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(generation.prompt).catch(() => {});
                    toast.success("Prompt copied — paste in Creator Studio", { icon: "✨", duration: 2500 });
                  }}
                  className="w-8 h-8 rounded-full bg-violet-500/40 backdrop-blur-sm flex items-center justify-center hover:bg-violet-500/60 transition-colors"
                  title="Copy prompt to recreate"
                >
                  <Wand2 className="w-4 h-4 text-white" />
                </button>
              )}
            </div>
          </>
        ) : generation.status === "processing" || generation.status === "pending" ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            <p className="text-xs text-slate-400">{generation.status === "pending" ? copy.statusQueued : copy.statusProcessing}</p>
          </div>
        ) : generation.status === "failed" ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-xs text-red-400">{copy.statusFailed || "Failed"}</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-xs text-slate-500">{generation.status}</p>
          </div>
        )}

        {/* Type badge */}
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-medium bg-black/50 backdrop-blur-sm text-white/80">
          {generationTypeLabel(generation.type, copy)}
        </div>

        {/* Multi-output badge */}
        {!isVideo && urls.length > 1 && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/50 backdrop-blur-sm text-white/80">
            +{urls.length - 1}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        {model && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <LazyImage src={getThumbnailUrl(model.photo1Url)} className="w-4 h-4 rounded-full object-cover" alt="" />
            <span className="text-xs text-slate-400 truncate">{model.name || copy.unnamed}</span>
          </div>
        )}
        <div className="text-[10px] text-slate-600">
          {new Date(generation.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
        {(providerModelTag || providerModeTag) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {providerModelTag && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/35 text-slate-200 border border-white/10">
                {providerModelTag}
              </span>
            )}
            {providerModeTag && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/35 text-slate-300 border border-white/10">
                {providerModeTag}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        {generation.status === "completed" && generation.outputUrl && (
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={onDownload}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium text-white border border-white/35"
              style={{ background: "rgba(255,255,255,0.10)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)" }}
              data-testid={`download-${generation.id}`}
            >
              <Download className="w-3 h-3" />
              Download
            </button>
            <button
              onClick={onDelete}
              className="px-2 py-1.5 rounded-md border border-red-400/40 bg-red-500/10 hover:bg-red-500/20 transition-all"
              data-testid={`delete-${generation.id}`}
            >
              <Trash2 className="w-3 h-3 text-red-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const GenerationListItem = memo(function GenerationListItem({ generation, models, isSelected, onToggleSelect, onPreview, onDownload, onDelete, index }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const model = models.find((m) => m.id === generation.modelId);
  const urls = parseOutputUrls(generation.outputUrl);
  const primaryUrl = urls[0] || "";
  const isVideo = VIDEO_TYPES.includes(generation.type) || isVideoUrl(primaryUrl);
  const videoPoster = generation.providerResponse?.thumbnailUrl || generation.providerResponse?.thumbnail || generation.inputImageUrl || undefined;
  const providerModelTag = String(generation.providerModel || "").replace(/^kie-/, "").replace(/^piapi-/, "");
  const providerModeTag = String(generation.providerMode || generation.providerType || "").trim();

  return (
    <div
      className="rounded-lg p-3 flex items-center gap-3"
      style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.04))', border: '1px solid rgba(139,92,246,0.15)' }}
      data-testid={`generation-list-${generation.id}`}
    >
      <button onClick={onToggleSelect}>
        {isSelected ? <CheckSquare className="w-4 h-4 text-purple-400" /> : <Square className="w-4 h-4 text-slate-500" />}
      </button>

      <div className="w-12 h-12 rounded-md overflow-hidden bg-black/30 cursor-pointer flex-shrink-0" onClick={onPreview}>
        {generation.status === "completed" && generation.outputUrl ? (
          isVideo ? (
            <LazyVideo src={primaryUrl} poster={videoPoster} videoClassName="object-cover" className="w-full h-full" muted />
          ) : (
            <LazyImage src={getThumbnailUrl(primaryUrl)} alt={copy.altGenerated} className="w-full h-full object-cover" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-red-400">{copy.statusFailed || "Failed"}</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-white">
            {generationTypeLabel(generation.type, copy)}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[9px] bg-green-500/20 text-green-400">
            {generation.status}
          </span>
        </div>
        {model && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <LazyImage src={getThumbnailUrl(model.photo1Url)} className="w-3.5 h-3.5 rounded-full object-cover" alt="" />
            <span>{model.name || copy.unnamed}</span>
          </div>
        )}
        <div className="text-[10px] text-slate-600 mt-0.5">
          {new Date(generation.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
        {(providerModelTag || providerModeTag) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {providerModelTag && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/35 text-slate-200 border border-white/10">
                {providerModelTag}
              </span>
            )}
            {providerModeTag && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/35 text-slate-300 border border-white/10">
                {providerModeTag}
              </span>
            )}
          </div>
        )}
      </div>

      {generation.status === "completed" && generation.outputUrl && (
        <div className="flex gap-1.5">
          <button
            onClick={onDownload}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white flex items-center gap-1 border border-white/35"
            style={{ background: "rgba(255,255,255,0.10)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)" }}
            data-testid={`download-${generation.id}`}
          >
            <Download className="w-3.5 h-3.5" />
            {copy.download}
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-1.5 rounded-md border border-red-400/40 bg-red-500/10 hover:bg-red-500/20 transition-all"
            data-testid={`delete-${generation.id}`}
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      )}
    </div>
  );
});

const PreviewModal = memo(function PreviewModal({ item, onClose, onDownload }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const urls = parseOutputUrls(item.outputUrl);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeUrl = urls[activeIndex] || "";
  const isVideo = VIDEO_TYPES.includes(item.type) || isVideoUrl(activeUrl);

  let loraInfo = null;
  try {
    if (item.inputImageUrl) {
      loraInfo = JSON.parse(item.inputImageUrl);
    }
  } catch {}
  const viewportBounds = useMainViewportBounds();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-y-0 right-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      style={{ left: viewportBounds.left, width: viewportBounds.width ? `${viewportBounds.width}px` : undefined }}
      data-testid="preview-modal"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col rounded-2xl overflow-hidden w-full max-w-[86vw] sm:max-w-[72vw] md:max-w-[56vw] lg:max-w-[42vw] max-h-[84vh]"
        style={{ background: "linear-gradient(180deg, rgba(17,17,26,0.97) 0%, rgba(10,10,18,0.98) 100%)", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 12px 42px rgba(0,0,0,0.45)" }}
      >
        <div className="flex-shrink-0 p-3 sm:p-4 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-semibold text-white">{copy.previewTitle}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-all" data-testid="close-preview">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4">
          <div className="flex items-center justify-center">
            {isVideo ? (
              <video src={activeUrl} controls autoPlay loop className="max-w-full max-h-[65vh] rounded-lg object-contain" />
            ) : (
              <div className="relative">
                <img src={activeUrl} alt={copy.altGenerated} className="max-w-full max-h-[65vh] rounded-lg object-contain" />

                {urls.length > 1 && (
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveIndex((i) => (i - 1 + urls.length) % urls.length); }}
                      className="px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-white text-xs"
                      data-testid="history-prev"
                    >
                      {copy.previewPrev}
                    </button>
                    <span className="px-2 py-1 rounded-lg bg-black/60 border border-white/10 text-white text-xs">
                      {activeIndex + 1}/{urls.length}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveIndex((i) => (i + 1) % urls.length); }}
                      className="px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-white text-xs"
                      data-testid="history-next"
                    >
                      {copy.previewNext}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {item.prompt && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{copy.previewPrompt}</p>
              <p className="text-[11px] text-slate-300 leading-relaxed" data-testid="text-history-prompt">
                {item.prompt}
              </p>
            </div>
          )}

          {loraInfo && (
            <>
              <div className="flex flex-wrap gap-1.5 mt-2" data-testid="generation-payload-badges">
                {(loraInfo.loraName || loraInfo.triggerWord) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-lora-name">
                    <Layers className="w-3 h-3" />
                    {loraInfo.loraName || loraInfo.triggerWord}
                  </span>
                )}
                {loraInfo.triggerWord && loraInfo.loraName && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-trigger-word">
                    {loraInfo.triggerWord}
                  </span>
                )}
                {(loraInfo.girlLoraStrength != null || loraInfo.loraStrength != null) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-lora-strength">
                    <Zap className="w-3 h-3" />
                    Girl {loraInfo.girlLoraStrength ?? loraInfo.loraStrength}
                  </span>
                )}
                {loraInfo.clipStrength != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-clip-strength">
                    CLIP {loraInfo.clipStrength}
                  </span>
                )}
                {loraInfo.activePose && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-pose">
                    Pose: {loraInfo.activePose.replace(/_/g, " ")} @ {loraInfo.activePoseStrength}
                  </span>
                )}
                {loraInfo.runningMakeup && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-makeup">
                    Makeup @ {loraInfo.runningMakeupStrength}
                  </span>
                )}
                {loraInfo.cumEffect && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-cum">
                    Cum FX
                  </span>
                )}
                {loraInfo.seed != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-seed">
                    Seed {loraInfo.seed}
                  </span>
                )}
                {loraInfo.steps != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-steps">
                    {loraInfo.steps} steps
                  </span>
                )}
                {loraInfo.cfg != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-cfg">
                    CFG {loraInfo.cfg}
                  </span>
                )}
                {loraInfo.width && loraInfo.height && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-resolution">
                    {loraInfo.width}x{loraInfo.height}
                  </span>
                )}
              </div>
              {loraInfo.negativePrompt && (
                <details className="mt-2">
                  <summary className="text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none">
                    {copy.previewNegativePrompt}
                  </summary>
                  <p className="text-[10px] text-slate-400 leading-relaxed mt-1" data-testid="text-negative-prompt">
                    {loraInfo.negativePrompt}
                  </p>
                </details>
              )}
              {loraInfo.builtPrompt && (
                <details className="mt-2">
                  <summary className="text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none">
                    {copy.previewFullBuiltPrompt}
                  </summary>
                  <p className="text-[10px] text-slate-400 leading-relaxed mt-1" data-testid="text-built-prompt">
                    {loraInfo.builtPrompt}
                  </p>
                </details>
              )}
            </>
          )}

          <div className="mt-3 sm:mt-4 flex gap-3">
            <button
              onClick={onDownload}
              className="flex-1 flex items-center justify-center gap-2 py-2 sm:py-2.5 rounded-md font-medium text-black"
              style={{ background: "#ffffff", border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <Download className="w-5 h-5 text-black" />
              {copy.download}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});
