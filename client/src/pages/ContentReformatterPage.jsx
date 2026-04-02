import { useMemo, useState, useEffect, useRef } from "react";
import { Upload, RefreshCw, Download, Copy, CheckCircle2, AlertCircle, FileType2, Video, History } from "lucide-react";
import toast from "react-hot-toast";
import { reformatterAPI } from "../services/api";
import { downloadFromPublicUrl } from "../utils/directDownload";

const LOCALE_STORAGE_KEY = "app_locale";

const COPY = {
  en: {
    title: "Content Reformatter",
    subtitle: "Convert unsupported uploads into compatible formats for your workflow.",
    chooseFile: "Choose file to convert",
    helpImages: "Images: HEIC/HEIF/AVIF/BMP/TIFF/... -> JPEG",
    helpVideos: "Videos: MOV and other formats -> MP4",
    selectedFileTitle: "Selected File",
    noFileSelected: "No file selected yet.",
    labelSize: "Size:",
    labelDetectedType: "Detected type:",
    detectedTypeUnknown: "unknown",
    labelTargetFormat: "Target format:",
    buttonUploading: "Uploading & starting…",
    buttonConvertTo: "Convert -> {format}",
    hintFileUploaded: "File is uploaded, then converted. Results appear in Conversion history.",
    toastLoadHistoryFailed: "Failed to load history",
    toastStartedDefault:
      "Conversion started. You can leave this page — progress appears in Conversion history.",
    toastStartFailed: "Failed to start conversion",
    toastUrlCopied: "Converted file URL copied",
    toastCopyFailed: "Could not copy URL",
    resultComplete: "Conversion Complete",
    resultOriginal: "Original",
    resultConverted: "Converted",
    buttonOpenDownload: "Open / Download",
    buttonCopyUrl: "Copy URL",
    historyTitle: "Conversion history",
    historyNote: "(saved to storage for 1 month)",
    historyLoading: "Loading...",
    historyEmpty: "No conversions yet. Convert a file to see it here.",
    historyItemDefaultName: "Converted file",
    historyAvailableUntil: "Available until {date}",
    historyStatusProcessing: "Processing…",
    historyStatusFailed: "Failed",
    historyButtonDownload: "Download",
    historyButtonLoadMore: "Load more",
    historyButtonLoadingMore: "Loading...",
    targetFormatImage: "JPEG",
    targetFormatVideo: "MP4",
    detectedTypeImage: "image",
    detectedTypeVideo: "video",
  },
  ru: {
    title: "Конвертер контента",
    subtitle: "Преобразуйте неподдерживаемые файлы в совместимые форматы для вашего рабочего процесса.",
    chooseFile: "Выбрать файл для конвертации",
    helpImages: "Изображения: HEIC/HEIF/AVIF/BMP/TIFF/... -> JPEG",
    helpVideos: "Видео: MOV и другие форматы -> MP4",
    selectedFileTitle: "Выбранный файл",
    noFileSelected: "Файл ещё не выбран.",
    labelSize: "Размер:",
    labelDetectedType: "Определённый тип:",
    detectedTypeUnknown: "неизвестно",
    labelTargetFormat: "Целевой формат:",
    buttonUploading: "Загрузка и запуск…",
    buttonConvertTo: "Конвертировать -> {format}",
    hintFileUploaded:
      "Файл загружается, затем конвертируется. Результаты отображаются в истории конвертаций.",
    toastLoadHistoryFailed: "Не удалось загрузить историю",
    toastStartedDefault:
      "Конвертация запущена. Вы можете покинуть эту страницу — прогресс отображается в истории конвертаций.",
    toastStartFailed: "Не удалось запустить конвертацию",
    toastUrlCopied: "URL конвертированного файла скопирован",
    toastCopyFailed: "Не удалось скопировать URL",
    resultComplete: "Конвертация завершена",
    resultOriginal: "Оригинал",
    resultConverted: "Конвертировано",
    buttonOpenDownload: "Открыть / Скачать",
    buttonCopyUrl: "Скопировать URL",
    historyTitle: "История конвертаций",
    historyNote: "(сохраняется в хранилище на 1 месяц)",
    historyLoading: "Загрузка...",
    historyEmpty: "Конвертаций пока нет. Конвертируйте файл, чтобы увидеть его здесь.",
    historyItemDefaultName: "Конвертированный файл",
    historyAvailableUntil: "Доступно до {date}",
    historyStatusProcessing: "Обработка…",
    historyStatusFailed: "Ошибка",
    historyButtonDownload: "Скачать",
    historyButtonLoadMore: "Загрузить ещё",
    historyButtonLoadingMore: "Загрузка...",
    targetFormatImage: "JPEG",
    targetFormatVideo: "MP4",
    detectedTypeImage: "изображение",
    detectedTypeVideo: "видео",
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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function ContentReformatterPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const [selectedFile, setSelectedFile] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const historyOpenRef = useRef(false);

  const fileKind = useMemo(() => {
    if (!selectedFile) return null;
    if (selectedFile.type?.startsWith("video/")) return "video";
    if (selectedFile.type?.startsWith("image/")) return "image";
    const name = selectedFile.name?.toLowerCase() || "";
    if (/\.(mov|mp4|m4v|avi|mkv|wmv|flv|webm|3gp|mpeg|mpg)$/.test(name)) return "video";
    return "image";
  }, [selectedFile]);

  const targetLabel = fileKind === "video" ? copy.targetFormatVideo : copy.targetFormatImage;

  const loadHistory = async (cursor) => {
    setLoadingHistory(true);
    try {
      const data = await reformatterAPI.getHistory(cursor);
      if (cursor) {
        setHistory((prev) => [...prev, ...(data.jobs || [])]);
      } else {
        setHistory(data.jobs || []);
      }
      setHistoryCursor(data.nextCursor || null);
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.message || copy.toastLoadHistoryFailed);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Load history when section is opened or on mount (so "come back" shows past conversions)
  useEffect(() => {
    if (showHistory) {
      historyOpenRef.current = true;
      loadHistory();
    } else {
      historyOpenRef.current = false;
    }
  }, [showHistory]);

  // Poll periodically when history is open so processing jobs update (faster while user watches)
  useEffect(() => {
    if (!showHistory) return;
    const t = setInterval(() => loadHistory(), 4000);
    return () => clearInterval(t);
  }, [showHistory]);

  const onFilePicked = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setResult(null);
    setError("");
    setUploadProgress(0);
  };

  const handleConvert = async () => {
    if (!selectedFile) return;
    setIsConverting(true);
    setError("");
    setResult(null);
    setUploadProgress(0);
    try {
      const data = await reformatterAPI.convertWithWorker(selectedFile, (p) => setUploadProgress(p ?? 0));
      setUploadProgress(100);
      setShowHistory(true);
      await loadHistory();
      toast.success(data?.message || copy.toastStartedDefault);
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || copy.toastStartFailed;
      setError(message);
      toast.error(message);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownload = () => {
    if (!result?.downloadUrl) return;
    const baseName = String(result.fileName || "converted")
      .replace(/\.[^/.]+$/, "")
      .trim() || "converted";
    const ext = String(result.convertedFormat || "file").toLowerCase();
    const forcedName = `${baseName}.${ext}`;
    void downloadFromPublicUrl(result.downloadUrl, forcedName);
  };

  const handleCopyUrl = async () => {
    if (!result?.outputUrl) return;
    try {
      await navigator.clipboard.writeText(result.outputUrl);
      toast.success(copy.toastUrlCopied);
    } catch {
      toast.error(copy.toastCopyFailed);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { dateStyle: "short" });
    } catch {
      return iso;
    }
  };

  const handleHistoryDownload = (job) => {
    if (!job?.outputUrl) return;
    const name = (job.originalFileName || "converted").replace(/\.[^/.]+$/, "") || "converted";
    const ext = (job.outputExt || "file").toLowerCase();
    void downloadFromPublicUrl(job.outputUrl, `${name}.${ext}`);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-white">{copy.title}</h1>
        <p className="text-slate-400 mt-2">
          {copy.subtitle}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <div className="grid md:grid-cols-2 gap-4">
          <label className="rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-6 cursor-pointer hover:bg-white/[0.05] transition">
            <input
              type="file"
              className="hidden"
              accept=".heic,.heif,.avif,.bmp,.tif,.tiff,.gif,.png,.jpg,.jpeg,.webp,.mov,.mp4,.m4v,.avi,.mkv,.wmv,.flv,.webm,.3gp,.mpeg,.mpg"
              onChange={(e) => onFilePicked(e.target.files?.[0])}
            />
            <div className="flex items-center gap-3 text-slate-200">
              <Upload className="w-5 h-5 text-cyan-300" />
              <span className="font-medium">{copy.chooseFile}</span>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              {copy.helpImages}
              <br />
              {copy.helpVideos}
            </p>
          </label>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-sm font-semibold text-white mb-3">{copy.selectedFileTitle}</h2>
            {!selectedFile ? (
              <p className="text-sm text-slate-500">{copy.noFileSelected}</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="text-slate-200 font-medium break-all">{selectedFile.name}</div>
                <div className="text-slate-400">{copy.labelSize} {formatBytes(selectedFile.size)}</div>
                <div className="text-slate-400">
                  {copy.labelDetectedType}{" "}
                  {fileKind === "image"
                    ? copy.detectedTypeImage
                    : fileKind === "video"
                      ? copy.detectedTypeVideo
                      : copy.detectedTypeUnknown}
                </div>
                <div className="text-slate-300">
                  {copy.labelTargetFormat} <span className="font-semibold text-emerald-300">{targetLabel}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={handleConvert}
            disabled={!selectedFile || isConverting}
            className="px-4 py-2.5 rounded-lg bg-white text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            data-testid="button-convert-content"
          >
            {isConverting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileType2 className="w-4 h-4" />}
            {isConverting ? copy.buttonUploading : copy.buttonConvertTo.replace("{format}", targetLabel)}
          </button>

          {isConverting && uploadProgress > 0 && (
            <span className="text-sm text-slate-400">{uploadProgress}%</span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {copy.hintFileUploaded}
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 md:p-6">
          <div className="flex items-center gap-2 text-emerald-200 font-semibold">
            <CheckCircle2 className="w-5 h-5" />
            {copy.resultComplete}
          </div>

          <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-slate-400">{copy.resultOriginal}</div>
              <div className="text-white">{String(result.originalFormat || "").toUpperCase()}</div>
              <div className="text-slate-400 mt-1">{formatBytes(result.originalSizeBytes)}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-slate-400">{copy.resultConverted}</div>
              <div className="text-white inline-flex items-center gap-2">
                {result.mediaKind === "video" ? <Video className="w-4 h-4 text-cyan-300" /> : <FileType2 className="w-4 h-4 text-cyan-300" />}
                {String(result.convertedFormat || "").toUpperCase()}
              </div>
              <div className="text-slate-400 mt-1">{formatBytes(result.convertedSizeBytes)}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={handleDownload}
              className="px-3 py-2 rounded-lg bg-white text-black font-medium inline-flex items-center gap-2"
              data-testid="button-download-converted"
            >
              <Download className="w-4 h-4" />
              {copy.buttonOpenDownload}
            </button>
            <button
              onClick={handleCopyUrl}
              className="px-3 py-2 rounded-lg border border-white/20 text-white hover:bg-white/10 inline-flex items-center gap-2"
              data-testid="button-copy-converted-url"
            >
              <Copy className="w-4 h-4" />
              {copy.buttonCopyUrl}
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="flex items-center gap-2 text-white font-medium hover:text-cyan-300 transition"
        >
          <History className="w-5 h-5" />
          {copy.historyTitle}
          <span className="text-slate-500 text-sm">{copy.historyNote}</span>
        </button>
        {showHistory && (
          <div className="mt-4">
            {loadingHistory && history.length === 0 ? (
              <p className="text-slate-400 text-sm">{copy.historyLoading}</p>
            ) : history.length === 0 ? (
              <p className="text-slate-500 text-sm">{copy.historyEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {history.map((job) => (
                  <li
                    key={job.id || `row-${job.createdAt}-${(job.outputUrl || "").slice(-20)}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="text-slate-200 font-medium truncate">{job.originalFileName || copy.historyItemDefaultName}</div>
                      <div className="text-slate-500 text-xs mt-0.5">
                        {formatDate(job.createdAt)}
                        {job.expiresAt && ` · ${copy.historyAvailableUntil.replace("{date}", formatDate(job.expiresAt))}`}
                      </div>
                    </div>
                    {job.status === "processing" && (
                      <span className="text-amber-400 text-xs shrink-0 inline-flex items-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        {copy.historyStatusProcessing}
                      </span>
                    )}
                    {job.status === "completed" && job.outputUrl && (
                      <button
                        type="button"
                        onClick={() => handleHistoryDownload(job)}
                        className="px-3 py-1.5 rounded-lg bg-white text-black font-medium inline-flex items-center gap-1.5 shrink-0"
                      >
                        <Download className="w-4 h-4" />
                        {copy.historyButtonDownload}
                      </button>
                    )}
                    {job.status === "failed" && (
                      <span className="text-red-400 text-xs">{job.errorMessage || copy.historyStatusFailed}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {showHistory && historyCursor && (
              <button
                type="button"
                onClick={() => loadHistory(historyCursor)}
                disabled={loadingHistory}
                className="mt-3 text-sm text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
              >
                {loadingHistory ? copy.historyButtonLoadingMore : copy.historyButtonLoadMore}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
