import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Download, Sparkles, Image as ImageIcon, X, ShieldOff, AlertCircle, Coins } from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";
import { useAuthStore } from "../store";
import { pricingAPI, uploadFile } from "../services/api";
import { downloadFromPublicUrl } from "../utils/directDownload";

function toErrMsg(v, fallback = "Something went wrong.") {
  if (v == null) return fallback;
  if (typeof v === "string") return v.trim() || fallback;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (typeof v.message === "string" && v.message.trim()) return v.message;
    if (typeof v.error === "string" && v.error.trim()) return v.error;
    try { return JSON.stringify(v); } catch { return fallback; }
  }
  return fallback;
}

const DEFAULT_COST = 10;
const POLL_INTERVAL_MS = 4000;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SynthIDRemoverPage() {
  const { user } = useAuthStore();

  const [dragOver, setDragOver] = useState(false);
  const [inputFile, setInputFile] = useState(null);
  const [inputPreview, setInputPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [generationId, setGenerationId] = useState(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  const { data: pricingPayload } = useQuery({
    queryKey: ["generation-pricing-synthid"],
    queryFn: () => pricingAPI.getGeneration(),
    staleTime: 60_000,
  });
  const creditCost = (() => {
    const n = Number(pricingPayload?.pricing?.synthIdRemove);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COST;
  })();

  const credits = (user?.credits ?? 0) + (user?.bonusCredits ?? 0);
  const hasEnough = credits >= creditCost;

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const reset = () => {
    stopPoll();
    setInputFile(null);
    setInputPreview(null);
    setStatus("idle");
    setProgress(0);
    setOutputUrl(null);
    setErrorMsg("");
    setGenerationId(null);
  };

  const acceptFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) {
      toast.error("Please drop an image file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image must be under 20 MB.");
      return;
    }
    setInputFile(file);
    setOutputUrl(null);
    setStatus("idle");
    setErrorMsg("");
    const reader = new FileReader();
    reader.onload = (e) => setInputPreview(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }, [acceptFile]);

  const onFileChange = (e) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = "";
  };

  const pollStatus = useCallback((genId) => {
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL_MS;
      setProgress((p) => Math.min(90, p + 3));
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`/api/synthid-remove/status/${genId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const { status: st, imageUrl, error } = res.data;
        if (st === "completed" && imageUrl) {
          stopPoll();
          setProgress(100);
          setOutputUrl(imageUrl);
          setStatus("done");
          try {
            const profileRes = await axios.get("/api/profile", { headers: { Authorization: `Bearer ${token}` } });
            if (profileRes.data?.user) useAuthStore.getState().setUser(profileRes.data.user);
          } catch {}
        } else if (st === "failed") {
          stopPoll();
          setStatus("error");
          setErrorMsg(toErrMsg(error, "Watermark removal failed. Your credits have been refunded."));
        }
        if (elapsed > 5 * 60 * 1000) {
          stopPoll();
          setStatus("error");
          setErrorMsg("Timed out. Please try again.");
        }
      } catch (err) {
        console.error("[SynthIDRemover] poll error:", err.message);
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const handleRemove = async () => {
    if (!inputFile || status === "uploading" || status === "processing") return;
    if (!hasEnough) { toast.error(`You need ${creditCost} credits.`); return; }

    setStatus("uploading");
    setProgress(5);
    setOutputUrl(null);
    setErrorMsg("");

    try {
      const token = localStorage.getItem("token");
      const inputImageUrl = await uploadFile(inputFile, (pct) => {
        setProgress(5 + Math.round((pct / 100) * 20));
      });
      const res = await axios.post(
        "/api/synthid-remove",
        { inputImageUrl },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
      );
      if (!res.data?.success) throw new Error(toErrMsg(res.data?.error, "Submission failed"));
      setStatus("processing");
      setProgress(25);
      setGenerationId(res.data.generationId);
      pollStatus(res.data.generationId);
    } catch (err) {
      setStatus("error");
      setErrorMsg(toErrMsg(err.response?.data?.error || err, "Submission failed."));
      setProgress(0);
    }
  };

  const downloadResult = () => {
    if (!outputUrl) return;
    void downloadFromPublicUrl(outputUrl, `watermark_removed_${Date.now()}.png`);
  };

  const isRunning = status === "uploading" || status === "processing";
  const canProcess = !!inputFile && !isRunning && hasEnough && status !== "done";

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-page)]">
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 md:py-12">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-soft)] border border-[var(--border-medium)]">
              <ShieldOff className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)]">
              Watermark Remover
            </h1>
          </div>
          <p className="text-sm text-[var(--text-muted)] ml-[52px]">
            Remove SynthID, Nano Banana, and other invisible digital watermarks — {creditCost} <Coins className="w-3 h-3 inline align-text-bottom" /> per image
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input */}
          <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 }}>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3 text-[var(--text-muted)]">Original</div>
            <div
              className={`relative rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer overflow-hidden ${dragOver ? "scale-[1.01]" : ""}`}
              style={{
                minHeight: 340,
                borderColor: dragOver ? "var(--accent)" : inputPreview ? "transparent" : "var(--border-medium)",
                background: dragOver ? "var(--accent-soft)" : inputPreview ? "transparent" : "var(--bg-surface)",
                boxShadow: inputPreview ? "0 4px 24px var(--shadow-ambient)" : "none",
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => !inputPreview && fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              {inputPreview ? (
                <>
                  <img src={inputPreview} alt="Input" className="w-full h-full object-contain" style={{ maxHeight: 400, display: "block" }} />
                  <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-center justify-between" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}>
                    <span className="text-xs text-white/70 truncate max-w-[70%]">{inputFile?.name}</span>
                    <span className="text-xs text-white/50">{formatBytes(inputFile?.size ?? 0)}</span>
                  </div>
                  {!isRunning && status !== "done" && (
                    <button
                      className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-opacity hover:opacity-100 opacity-70"
                      style={{ background: "rgba(0,0,0,0.6)" }}
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      <X className="w-3.5 h-3.5 text-white" />
                    </button>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
                  <motion.div
                    animate={dragOver ? { scale: 1.15, rotate: 5 } : { scale: 1, rotate: 0 }}
                    className="w-14 h-14 rounded-2xl flex items-center justify-center bg-[var(--accent-soft)] border border-[var(--border-medium)]"
                  >
                    <Upload className="w-6 h-6 text-[var(--accent)]" />
                  </motion.div>
                  <div className="text-center">
                    <p className="font-medium mb-1 text-[var(--text-primary)]">Drop your image here</p>
                    <p className="text-sm text-[var(--text-muted)]">or click to browse · JPEG, PNG, WEBP · max 20 MB</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Right: Output */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3 text-[var(--text-muted)]">Cleaned</div>
            <div
              className="relative rounded-2xl overflow-hidden"
              style={{
                minHeight: 340,
                background: "var(--bg-surface)",
                border: outputUrl ? "none" : "1px solid var(--border-subtle)",
                boxShadow: outputUrl ? "0 4px 32px var(--shadow-ambient)" : "none",
              }}
            >
              <AnimatePresence mode="wait">
                {status === "done" && outputUrl ? (
                  <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative">
                    <img src={outputUrl} alt="Cleaned" className="w-full h-full object-contain" style={{ maxHeight: 400, display: "block" }} />
                    <div
                      className="absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1"
                      style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac" }}
                    >
                      <Sparkles className="w-3 h-3" />
                      Watermark Removed
                    </div>
                    <button
                      onClick={downloadResult}
                      className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95 btn-accent"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                  </motion.div>
                ) : isRunning ? (
                  <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8">
                    <div className="relative w-20 h-20">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="absolute inset-0 rounded-full border border-[var(--border-medium)]"
                          animate={{ scale: [1, 1.6 + i * 0.3], opacity: [0.5, 0] }}
                          transition={{ duration: 2, delay: i * 0.5, repeat: Infinity, ease: "easeOut" }}
                        />
                      ))}
                      <div className="absolute inset-0 rounded-full flex items-center justify-center bg-[var(--accent-soft)] border border-[var(--border-medium)]">
                        <ShieldOff className="w-7 h-7 text-[var(--accent)]" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="font-medium mb-1 text-[var(--text-primary)]">
                        {status === "uploading" ? "Uploading…" : "Removing watermark…"}
                      </p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {status === "processing" ? "AI is cleaning the image — usually 30–90 s" : "Sending to worker…"}
                      </p>
                    </div>
                    <div className="w-full max-w-xs">
                      <div className="h-1.5 rounded-full overflow-hidden bg-[var(--bg-elevated)]">
                        <motion.div className="h-full rounded-full bg-[var(--accent)]" animate={{ width: `${progress}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
                      </div>
                      <p className="text-xs mt-1.5 text-right text-[var(--text-muted)]">{progress}%</p>
                    </div>
                  </motion.div>
                ) : status === "error" ? (
                  <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-[var(--danger)]/10 border border-[var(--danger)]/25">
                      <AlertCircle className="w-6 h-6 text-[var(--danger)]" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-[var(--danger)] mb-1">Processing failed</p>
                      <p className="text-sm text-[var(--text-muted)]">{errorMsg || "Something went wrong. Credits have been refunded."}</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="empty" className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <ImageIcon className="w-10 h-10 text-[var(--text-muted)] opacity-30" />
                    <p className="text-sm text-[var(--text-muted)]">Result will appear here</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        {/* Action bar */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-6 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm panel">
            <Coins className="w-4 h-4 text-yellow-400" />
            <span className="text-[var(--text-secondary)]">
              Cost: <strong className="text-[var(--text-primary)]">{creditCost} <Coins className="w-3 h-3 inline align-text-bottom" /></strong>
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className={hasEnough ? "text-[var(--success)]" : "text-[var(--danger)]"}>
              You have <strong>{credits} <Coins className="w-3 h-3 inline align-text-bottom" /></strong>
            </span>
          </div>
          <div className="flex-1" />
          {(inputPreview || status === "done") && !isRunning && (
            <button onClick={reset} className="btn-ghost px-4 py-2.5 rounded-xl text-sm">Start Over</button>
          )}
          <motion.button
            onClick={handleRemove}
            disabled={!canProcess}
            whileHover={canProcess ? { scale: 1.02 } : {}}
            whileTap={canProcess ? { scale: 0.97 } : {}}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              canProcess ? "btn-accent cursor-pointer" : "bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed"
            }`}
          >
            {isRunning ? (
              <>
                <motion.div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
                {status === "uploading" ? "Uploading…" : "Removing…"}
              </>
            ) : status === "done" ? (
              <><Sparkles className="w-4 h-4" />Done!</>
            ) : (
              <><ShieldOff className="w-4 h-4" />Remove Watermark — {creditCost} <Coins className="w-3 h-3" /></>
            )}
          </motion.button>
        </motion.div>

        {/* Info cards */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: ShieldOff, title: "SynthID removal", desc: "Strips Google DeepMind invisible watermarks from AI images" },
            { icon: Sparkles, title: "Any digital watermark", desc: "Works on Nano Banana and other provider-embedded watermarks" },
            { icon: Download, title: "Download instantly", desc: "Clean PNG ready to save immediately after processing" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-3 px-4 py-3 rounded-xl panel">
              <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--accent)]" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
                <p className="text-xs mt-0.5 text-[var(--text-muted)]">{desc}</p>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
