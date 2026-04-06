import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Download, Sparkles, Image as ImageIcon, X, ZoomIn, AlertCircle, Coins } from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";
import { useAuthStore } from "../store";
import { useTheme } from "../hooks/useTheme.jsx";

const CREDIT_COST = 5;
const POLL_INTERVAL_MS = 4000;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UpscalerPage() {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const [dragOver, setDragOver] = useState(false);
  const [inputFile, setInputFile] = useState(null);
  const [inputPreview, setInputPreview] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | uploading | processing | done | error
  const [progress, setProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [generationId, setGenerationId] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  const credits = (user?.credits ?? 0) + (user?.bonusCredits ?? 0);
  const hasEnough = credits >= CREDIT_COST;

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
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
    setCompareMode(false);
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
    const file = e.dataTransfer.files?.[0];
    acceptFile(file);
  }, [acceptFile]);

  const onFileChange = (e) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = "";
  };

  const pollStatus = useCallback((genId) => {
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL_MS;
      // Animate progress bar up to 90%
      setProgress((p) => Math.min(90, p + 3));
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`/api/upscale/status/${genId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const { status: st, imageUrl, error } = res.data;
        if (st === "completed" && imageUrl) {
          stopPoll();
          setProgress(100);
          setOutputUrl(imageUrl);
          setStatus("done");
          // Refresh credits
          try {
            const profileRes = await axios.get("/api/profile", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (profileRes.data?.user) {
              useAuthStore.getState().setUser(profileRes.data.user);
            }
          } catch {}
        } else if (st === "failed") {
          stopPoll();
          setStatus("error");
          setErrorMsg(error || "Upscaling failed. Your credits have been refunded.");
        }
        // If still processing, keep polling
        if (elapsed > 5 * 60 * 1000) {
          stopPoll();
          setStatus("error");
          setErrorMsg("Upscaling timed out. Please try again.");
        }
      } catch (err) {
        console.error("[Upscaler] poll error:", err.message);
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const handleUpscale = async () => {
    if (!inputFile || status === "uploading" || status === "processing") return;
    if (!hasEnough) {
      toast.error(`You need ${CREDIT_COST} credits to upscale.`);
      return;
    }

    setStatus("uploading");
    setProgress(5);
    setOutputUrl(null);
    setErrorMsg("");

    try {
      const token = localStorage.getItem("token");
      const formData = new FormData();
      formData.append("image", inputFile);

      const res = await axios.post("/api/upscale", formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (e) => {
          const pct = Math.round((e.loaded / (e.total || 1)) * 20);
          setProgress(5 + pct);
        },
      });

      if (!res.data.success) throw new Error(res.data.error || "Submission failed");

      setStatus("processing");
      setProgress(25);
      setGenerationId(res.data.generationId);
      pollStatus(res.data.generationId);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.response?.data?.error || err.message || "Submission failed.");
      setProgress(0);
    }
  };

  const downloadResult = () => {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `upscaled_${Date.now()}.png`;
    a.click();
  };

  const isRunning = status === "uploading" || status === "processing";

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: isDark
          ? "linear-gradient(135deg, #0a0a12 0%, #0f0f1c 50%, #0a0a14 100%)"
          : "linear-gradient(135deg, #f1f5f9 0%, #e8eef8 100%)",
      }}
    >
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 md:py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(139,92,246,0.3) 0%, rgba(109,40,217,0.4) 100%)",
                border: "1px solid rgba(139,92,246,0.5)",
                boxShadow: "0 0 18px rgba(139,92,246,0.35)",
              }}
            >
              <ZoomIn className="w-5 h-5 text-purple-300" />
            </div>
            <h1
              className="text-2xl md:text-3xl font-bold"
              style={{ color: isDark ? "#e2e8f0" : "#1e293b" }}
            >
              AI Upscaler
            </h1>
          </div>
          <p className="text-sm ml-13" style={{ color: isDark ? "rgba(148,163,184,0.8)" : "#64748b", marginLeft: "52px" }}>
            Enhance any photo to high resolution using SeedVR2 — {CREDIT_COST} credits per upscale
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Input */}
          <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 }}>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: isDark ? "rgba(148,163,184,0.6)" : "#94a3b8" }}>
              Original
            </div>
            <div
              className={`relative rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer overflow-hidden ${dragOver ? "scale-[1.01]" : ""}`}
              style={{
                minHeight: 340,
                borderColor: dragOver
                  ? "rgba(139,92,246,0.8)"
                  : inputPreview
                  ? "transparent"
                  : isDark ? "rgba(148,163,184,0.2)" : "rgba(100,116,139,0.3)",
                background: dragOver
                  ? "rgba(139,92,246,0.08)"
                  : inputPreview
                  ? "transparent"
                  : isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)",
                boxShadow: inputPreview
                  ? isDark
                    ? "0 4px 24px rgba(0,0,0,0.4)"
                    : "0 4px 24px rgba(0,0,0,0.1)"
                  : "none",
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => !inputPreview && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileChange}
              />

              {inputPreview ? (
                <>
                  <img
                    src={inputPreview}
                    alt="Input"
                    className="w-full h-full object-contain"
                    style={{ maxHeight: 400, display: "block" }}
                  />
                  {/* File info overlay */}
                  <div
                    className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-center justify-between"
                    style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
                  >
                    <span className="text-xs text-white/70 truncate max-w-[70%]">{inputFile?.name}</span>
                    <span className="text-xs text-white/50">{formatBytes(inputFile?.size ?? 0)}</span>
                  </div>
                  {/* Replace button */}
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
                    className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{
                      background: isDark ? "rgba(139,92,246,0.12)" : "rgba(139,92,246,0.08)",
                      border: "1px solid rgba(139,92,246,0.25)",
                    }}
                  >
                    <Upload className="w-6 h-6" style={{ color: "rgba(139,92,246,0.8)" }} />
                  </motion.div>
                  <div className="text-center">
                    <p className="font-medium mb-1" style={{ color: isDark ? "rgba(226,232,240,0.9)" : "#334155" }}>
                      Drop your image here
                    </p>
                    <p className="text-sm" style={{ color: isDark ? "rgba(148,163,184,0.55)" : "#94a3b8" }}>
                      or click to browse · JPEG, PNG, WEBP · max 20 MB
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Right: Output */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
            <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: isDark ? "rgba(148,163,184,0.6)" : "#94a3b8" }}>
              Upscaled
            </div>
            <div
              className="relative rounded-2xl overflow-hidden"
              style={{
                minHeight: 340,
                background: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)",
                border: outputUrl
                  ? "none"
                  : `1px solid ${isDark ? "rgba(148,163,184,0.1)" : "rgba(100,116,139,0.2)"}`,
                boxShadow: outputUrl
                  ? isDark
                    ? "0 4px 32px rgba(139,92,246,0.2), 0 4px 24px rgba(0,0,0,0.4)"
                    : "0 4px 24px rgba(0,0,0,0.1)"
                  : "none",
              }}
            >
              <AnimatePresence mode="wait">
                {status === "done" && outputUrl ? (
                  <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative">
                    <img
                      src={outputUrl}
                      alt="Upscaled"
                      className="w-full h-full object-contain"
                      style={{ maxHeight: 400, display: "block" }}
                    />
                    {/* Done badge */}
                    <div
                      className="absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1"
                      style={{
                        background: "rgba(34,197,94,0.2)",
                        border: "1px solid rgba(34,197,94,0.4)",
                        color: "#86efac",
                      }}
                    >
                      <Sparkles className="w-3 h-3" />
                      Upscaled
                    </div>
                    {/* Download button */}
                    <button
                      onClick={downloadResult}
                      className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                      style={{
                        background: "rgba(139,92,246,0.85)",
                        color: "white",
                        backdropFilter: "blur(8px)",
                        boxShadow: "0 4px 12px rgba(139,92,246,0.4)",
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                  </motion.div>
                ) : isRunning ? (
                  <motion.div
                    key="processing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8"
                  >
                    {/* Animated pulsing rings */}
                    <div className="relative w-20 h-20">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="absolute inset-0 rounded-full"
                          style={{ border: "1px solid rgba(139,92,246,0.4)" }}
                          animate={{ scale: [1, 1.6 + i * 0.3], opacity: [0.6, 0] }}
                          transition={{ duration: 2, delay: i * 0.5, repeat: Infinity, ease: "easeOut" }}
                        />
                      ))}
                      <div
                        className="absolute inset-0 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.5)" }}
                      >
                        <ZoomIn className="w-7 h-7 text-purple-400" />
                      </div>
                    </div>

                    <div className="text-center">
                      <p className="font-medium mb-1" style={{ color: isDark ? "#e2e8f0" : "#334155" }}>
                        {status === "uploading" ? "Uploading…" : "Upscaling your image…"}
                      </p>
                      <p className="text-sm" style={{ color: isDark ? "rgba(148,163,184,0.6)" : "#64748b" }}>
                        {status === "processing" ? "SeedVR2 is processing — usually 1–2 min" : "Sending to worker…"}
                      </p>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full max-w-xs">
                      <div
                        className="h-1.5 rounded-full overflow-hidden"
                        style={{ background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }}
                      >
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: "linear-gradient(90deg, #7c3aed, #a855f7)" }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                        />
                      </div>
                      <p className="text-xs mt-1.5 text-right" style={{ color: isDark ? "rgba(148,163,184,0.4)" : "#94a3b8" }}>
                        {progress}%
                      </p>
                    </div>
                  </motion.div>
                ) : status === "error" ? (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8"
                  >
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center"
                      style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}
                    >
                      <AlertCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-red-400 mb-1">Upscaling failed</p>
                      <p className="text-sm" style={{ color: isDark ? "rgba(148,163,184,0.6)" : "#64748b" }}>
                        {errorMsg || "Something went wrong. Credits have been refunded."}
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                  >
                    <ImageIcon className="w-10 h-10" style={{ color: isDark ? "rgba(148,163,184,0.2)" : "rgba(100,116,139,0.25)" }} />
                    <p className="text-sm" style={{ color: isDark ? "rgba(148,163,184,0.35)" : "#94a3b8" }}>
                      Result will appear here
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        {/* Action bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-6 flex flex-col sm:flex-row items-center gap-4"
        >
          {/* Credit info */}
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
            style={{
              background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
            }}
          >
            <Coins className="w-4 h-4 text-yellow-400" />
            <span style={{ color: isDark ? "rgba(226,232,240,0.7)" : "#475569" }}>
              Cost: <strong style={{ color: isDark ? "#e2e8f0" : "#1e293b" }}>{CREDIT_COST} credits</strong>
            </span>
            <span style={{ color: isDark ? "rgba(148,163,184,0.4)" : "#94a3b8" }}>·</span>
            <span style={{ color: hasEnough ? (isDark ? "#86efac" : "#16a34a") : "#f87171" }}>
              You have <strong>{credits}</strong>
            </span>
          </div>

          <div className="flex-1" />

          {/* Reset */}
          {(inputPreview || status === "done") && !isRunning && (
            <button
              onClick={reset}
              className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80"
              style={{
                background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                color: isDark ? "rgba(226,232,240,0.7)" : "#475569",
              }}
            >
              Start Over
            </button>
          )}

          {/* Upscale button */}
          <motion.button
            onClick={handleUpscale}
            disabled={!inputFile || isRunning || !hasEnough || status === "done"}
            whileHover={inputFile && !isRunning && hasEnough && status !== "done" ? { scale: 1.02 } : {}}
            whileTap={inputFile && !isRunning && hasEnough && status !== "done" ? { scale: 0.97 } : {}}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              background:
                !inputFile || isRunning || !hasEnough || status === "done"
                  ? isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"
                  : "linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)",
              color:
                !inputFile || isRunning || !hasEnough || status === "done"
                  ? isDark ? "rgba(148,163,184,0.4)" : "#94a3b8"
                  : "white",
              boxShadow:
                !inputFile || isRunning || !hasEnough || status === "done"
                  ? "none"
                  : "0 4px 20px rgba(124,58,237,0.45)",
              cursor: !inputFile || isRunning || !hasEnough || status === "done" ? "not-allowed" : "pointer",
            }}
          >
            {isRunning ? (
              <>
                <motion.div
                  className="w-4 h-4 rounded-full border-2 border-current border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                />
                {status === "uploading" ? "Uploading…" : "Upscaling…"}
              </>
            ) : status === "done" ? (
              <>
                <Sparkles className="w-4 h-4" />
                Done!
              </>
            ) : (
              <>
                <ZoomIn className="w-4 h-4" />
                Upscale for {CREDIT_COST} credits
              </>
            )}
          </motion.button>
        </motion.div>

        {/* Info cards */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          {[
            { icon: ZoomIn, title: "Up to 4× resolution", desc: "SeedVR2 DiT model reconstructs fine detail" },
            { icon: Sparkles, title: "AI-enhanced quality", desc: "Color correction and noise reduction built in" },
            { icon: Download, title: "Download instantly", desc: "Full-resolution PNG saved to your device" },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex gap-3 px-4 py-3 rounded-xl"
              style={{
                background: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.6)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`,
              }}
            >
              <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-purple-400" />
              <div>
                <p className="text-sm font-medium" style={{ color: isDark ? "#e2e8f0" : "#334155" }}>{title}</p>
                <p className="text-xs mt-0.5" style={{ color: isDark ? "rgba(148,163,184,0.55)" : "#64748b" }}>{desc}</p>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
