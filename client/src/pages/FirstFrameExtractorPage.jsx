import { useMemo, useState } from "react";
import { Upload, Image as ImageIcon, RefreshCw, Download, Copy, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { reformatterAPI } from "../services/api";
import { downloadFromPublicUrl } from "../utils/directDownload";

const LOCALE_STORAGE_KEY = "app_locale";

const COPY = {
  en: {
    title: "First Frame Extractor",
    subtitle: "Free tool: upload a video and extract frame #1 as a JPEG image.",
    chooseVideo: "Choose video",
    selectedVideo: "Selected video",
    noVideo: "No video selected.",
    size: "Size:",
    buttonExtract: "Extract first frame",
    buttonExtracting: "Uploading & extracting…",
    success: "First frame extracted.",
    failed: "Failed to extract first frame",
    copyUrl: "Copy URL",
    copied: "URL copied",
    copyFailed: "Could not copy URL",
    download: "Download JPEG",
    unsupported: "Please select a video file.",
  },
  ru: {
    title: "Извлечение первого кадра",
    subtitle: "Бесплатный инструмент: загрузите видео и получите первый кадр в формате JPEG.",
    chooseVideo: "Выбрать видео",
    selectedVideo: "Выбранное видео",
    noVideo: "Видео не выбрано.",
    size: "Размер:",
    buttonExtract: "Извлечь первый кадр",
    buttonExtracting: "Загрузка и извлечение…",
    success: "Первый кадр извлечён.",
    failed: "Не удалось извлечь первый кадр",
    copyUrl: "Скопировать URL",
    copied: "URL скопирован",
    copyFailed: "Не удалось скопировать URL",
    download: "Скачать JPEG",
    unsupported: "Выберите видеофайл.",
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

export default function FirstFrameExtractorPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const [selectedFile, setSelectedFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");

  const isVideo = useMemo(() => {
    if (!selectedFile) return false;
    if (selectedFile.type?.startsWith("video/")) return true;
    const name = selectedFile.name?.toLowerCase() || "";
    return /\.(mov|mp4|m4v|avi|mkv|wmv|flv|webm|3gp|mpeg|mpg)$/.test(name);
  }, [selectedFile]);

  const onPick = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setResultUrl("");
    setError("");
    setProgress(0);
  };

  const onExtract = async () => {
    if (!selectedFile) return;
    if (!isVideo) {
      setError(copy.unsupported);
      toast.error(copy.unsupported);
      return;
    }
    setExtracting(true);
    setError("");
    setResultUrl("");
    setProgress(0);
    try {
      const data = await reformatterAPI.extractFirstFrame(selectedFile, (p) => setProgress(p ?? 0));
      if (!data?.success || !data?.outputUrl) {
        throw new Error(data?.message || copy.failed);
      }
      setProgress(100);
      setResultUrl(data.outputUrl);
      toast.success(data.message || copy.success);
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || copy.failed;
      setError(msg);
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-white">{copy.title}</h1>
        <p className="text-slate-400 mt-2">{copy.subtitle}</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <div className="grid md:grid-cols-2 gap-4">
          <label className="rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-6 cursor-pointer hover:bg-white/[0.05] transition">
            <input
              type="file"
              className="hidden"
              accept="video/*,.mov,.mp4,.m4v,.avi,.mkv,.wmv,.flv,.webm,.3gp,.mpeg,.mpg"
              onChange={(e) => onPick(e.target.files?.[0])}
            />
            <div className="flex items-center gap-3 text-slate-200">
              <Upload className="w-5 h-5 text-[color:var(--text-primary)]" />
              <span className="font-medium">{copy.chooseVideo}</span>
            </div>
          </label>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-sm font-semibold text-white mb-3">{copy.selectedVideo}</h2>
            {!selectedFile ? (
              <p className="text-sm text-slate-500">{copy.noVideo}</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="text-slate-200 font-medium break-all">{selectedFile.name}</div>
                <div className="text-slate-400">{copy.size} {formatBytes(selectedFile.size)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={onExtract}
            disabled={!selectedFile || extracting}
            className="px-4 py-2.5 rounded-lg bg-white text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {extracting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            {extracting ? copy.buttonExtracting : copy.buttonExtract}
          </button>
          {extracting && progress > 0 && <span className="text-sm text-slate-400">{progress}%</span>}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {resultUrl && (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 md:p-6">
          <img src={resultUrl} alt="Extracted first frame" className="w-full rounded-xl border border-white/10 bg-black/20 mb-4" />
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => void downloadFromPublicUrl(resultUrl, "first-frame.jpg")}
              className="px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {copy.download}
            </button>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resultUrl);
                  toast.success(copy.copied);
                } catch {
                  toast.error(copy.copyFailed);
                }
              }}
              className="px-4 py-2 rounded-lg border border-white/20 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              {copy.copyUrl}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
