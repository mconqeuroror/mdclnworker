import { useMemo, useState, useEffect, useRef } from "react";
import { Upload, RefreshCw, Download, Copy, CheckCircle2, AlertCircle, FileType2, Video, History, Shield } from "lucide-react";
import toast from "react-hot-toast";
import { reformatterAPI } from "../services/api";
import { useAuthStore } from "../store";

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
  const { user } = useAuthStore();
  const [adminUseWorkerFfmpeg, setAdminUseWorkerFfmpeg] = useState(() => {
    try {
      return localStorage.getItem("reformatter_admin_use_worker_ff") === "1";
    } catch {
      return false;
    }
  });
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

  const targetLabel = fileKind === "video" ? "MP4" : "JPEG";

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
      toast.error(e?.response?.data?.message || e?.message || "Failed to load history");
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

  // Poll periodically when history is open so processing jobs update (stable deps to avoid refresh loops)
  useEffect(() => {
    if (!showHistory) return;
    const t = setInterval(() => loadHistory(), 8000);
    return () => clearInterval(t);
  }, [showHistory]);

  useEffect(() => {
    try {
      localStorage.setItem("reformatter_admin_use_worker_ff", adminUseWorkerFfmpeg ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [adminUseWorkerFfmpeg]);

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
      const useWorker = user?.role === "admin" && adminUseWorkerFfmpeg;
      const data = useWorker
        ? await reformatterAPI.convertWithWorker(selectedFile, (p) => setUploadProgress(p ?? 0))
        : await reformatterAPI.convertInBackground(selectedFile, (p) => setUploadProgress(p ?? 0));
      setUploadProgress(100);
      loadHistory();
      setShowHistory(true);
      toast.success(
        data?.message ||
          (useWorker
            ? "Conversion completed via FFmpeg worker. See Conversion history."
            : "Conversion started. You can leave — check Conversion history."),
      );
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || "Failed to start conversion";
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
    const proxyUrl = `/api/download?url=${encodeURIComponent(result.downloadUrl)}&filename=${encodeURIComponent(forcedName)}`;

    const a = document.createElement("a");
    a.href = proxyUrl;
    a.download = forcedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleCopyUrl = async () => {
    if (!result?.outputUrl) return;
    try {
      await navigator.clipboard.writeText(result.outputUrl);
      toast.success("Converted file URL copied");
    } catch {
      toast.error("Could not copy URL");
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
    const proxyUrl = `/api/download?url=${encodeURIComponent(job.outputUrl)}&filename=${encodeURIComponent(`${name}.${ext}`)}`;
    const a = document.createElement("a");
    a.href = proxyUrl;
    a.download = `${name}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-white">Content Reformatter</h1>
        <p className="text-slate-400 mt-2">
          Convert unsupported uploads into compatible formats for your workflow.
        </p>
      </div>

      {user?.role === "admin" && (
        <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 max-w-4xl mx-auto">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={adminUseWorkerFfmpeg}
              onChange={(e) => setAdminUseWorkerFfmpeg(e.target.checked)}
              className="mt-1 rounded border-amber-500/50"
              data-testid="toggle-reformatter-admin-ff-worker"
            />
            <span className="text-xs text-amber-100/95">
              <span className="font-semibold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Admin: external FFmpeg worker (ffpmeg)
              </span>
              <span className="block text-[11px] text-amber-200/70 mt-1">
                Uses the repurposer worker pipeline after upload. Best for common video containers; exotic formats may still need
                &quot;Convert in browser&quot;. Other users always use the standard background conversion.
              </span>
            </span>
          </label>
        </div>
      )}

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
              <span className="font-medium">Choose file to convert</span>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Images: HEIC/HEIF/AVIF/BMP/TIFF/... -&gt; JPEG
              <br />
              Videos: MOV and other formats -&gt; MP4
            </p>
          </label>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Selected File</h2>
            {!selectedFile ? (
              <p className="text-sm text-slate-500">No file selected yet.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="text-slate-200 font-medium break-all">{selectedFile.name}</div>
                <div className="text-slate-400">Size: {formatBytes(selectedFile.size)}</div>
                <div className="text-slate-400">Detected type: {fileKind || "unknown"}</div>
                <div className="text-slate-300">
                  Target format: <span className="font-semibold text-emerald-300">{targetLabel}</span>
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
            {isConverting ? "Uploading & starting…" : `Convert → ${targetLabel}`}
          </button>

          {isConverting && uploadProgress > 0 && (
            <span className="text-sm text-slate-400">{uploadProgress}%</span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {user?.role === "admin" && adminUseWorkerFfmpeg
            ? "Admin worker mode: upload runs, then the external FFmpeg worker completes the conversion (usually a few seconds). Check Conversion history for the file."
            : "File is uploaded to the server and converted in the background. You can close this tab and check Conversion history later."}
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
            Conversion Complete
          </div>

          <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-slate-400">Original</div>
              <div className="text-white">{String(result.originalFormat || "").toUpperCase()}</div>
              <div className="text-slate-400 mt-1">{formatBytes(result.originalSizeBytes)}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-slate-400">Converted</div>
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
              Open / Download
            </button>
            <button
              onClick={handleCopyUrl}
              className="px-3 py-2 rounded-lg border border-white/20 text-white hover:bg-white/10 inline-flex items-center gap-2"
              data-testid="button-copy-converted-url"
            >
              <Copy className="w-4 h-4" />
              Copy URL
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
          Conversion history
          <span className="text-slate-500 text-sm">(saved to storage for 1 month)</span>
        </button>
        {showHistory && (
          <div className="mt-4">
            {loadingHistory && history.length === 0 ? (
              <p className="text-slate-400 text-sm">Loading...</p>
            ) : history.length === 0 ? (
              <p className="text-slate-500 text-sm">No conversions yet. Convert a file to see it here.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((job) => (
                  <li
                    key={job.id || `row-${job.createdAt}-${(job.outputUrl || "").slice(-20)}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="text-slate-200 font-medium truncate">{job.originalFileName || "Converted file"}</div>
                      <div className="text-slate-500 text-xs mt-0.5">
                        {formatDate(job.createdAt)}
                        {job.expiresAt && ` · Available until ${formatDate(job.expiresAt)}`}
                      </div>
                    </div>
                    {job.status === "processing" && (
                      <span className="text-amber-400 text-xs shrink-0 inline-flex items-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Processing…
                      </span>
                    )}
                    {job.status === "completed" && job.outputUrl && (
                      <button
                        type="button"
                        onClick={() => handleHistoryDownload(job)}
                        className="px-3 py-1.5 rounded-lg bg-white text-black font-medium inline-flex items-center gap-1.5 shrink-0"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    )}
                    {job.status === "failed" && (
                      <span className="text-red-400 text-xs">{job.errorMessage || "Failed"}</span>
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
                {loadingHistory ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
