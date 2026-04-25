import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  Download,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Play,
  X,
  Clock,
  Image as ImageIcon,
  Video,
  ChevronLeft,
  ChevronRight,
  Layers,
  Zap,
} from "lucide-react";
import { useGenerations } from "../hooks/useGenerations";
import { downloadFromPublicUrl } from "../utils/directDownload";

const PREVIEW_BADGE_STYLE = {
  background: "var(--bg-glass)",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-secondary)",
};

// Helper to parse outputUrl - can be single URL or JSON array
function parseOutputUrls(outputUrl) {
  if (!outputUrl) return [];
  try {
    const parsed = JSON.parse(outputUrl);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Not JSON, treat as single URL
  }
  return [outputUrl];
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

/**
 * GenerationHistory - Shows recent generations with thumbnails
 * Premium UI style matching the Generate page design system
 */
export function GenerationHistory({
  type = "image",
  title = "Recent Generations",
  limit = 6,
}) {
  const { all: generations, isLoading } = useGenerations(type);
  const [previewModal, setPreviewModal] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const viewportBounds = useMainViewportBounds();

  // Limit results to the specified limit
  const limitedGenerations = generations.slice(0, limit);

  const handlePreview = (generation) => {
    if (!generation.outputUrl) return;
    setPreviewModal(generation);
    setPreviewIndex(0);
  };

  // Get all image URLs for the preview modal
  const previewUrls = previewModal
    ? parseOutputUrls(previewModal.outputUrl)
    : [];

  const handleDownload = async (url, index = 0, generation = null) => {
    if (!url) return;

    const gen = generation || previewModal;
    const lowerUrl = url.toLowerCase();
    const genType = gen?.type || "";
    const videoTypes = [
      "video",
      "faceswap",
      "face-swap",
      "prompt-video",
      "talking-head",
      "recreate-video",
      "nsfw-video-motion",
    ];
    const isVideo = videoTypes.includes(genType) || lowerUrl.includes(".mp4") || lowerUrl.includes(".webm");
    const ext = isVideo ? (lowerUrl.includes(".webm") ? "webm" : "mp4") : "jpg";
    const filename = `generation-${gen?.id || "image"}-${index + 1}.${ext}`;

    await downloadFromPublicUrl(url, filename);
  };

  const handleDownloadAll = async () => {
    for (let i = 0; i < previewUrls.length; i++) {
      await handleDownload(previewUrls[i], i);
      // Small delay between downloads
      if (i < previewUrls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };

  if (isLoading) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "inset 0 1px 0 var(--mc-glass-inset)",
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-slate-500" />
          <h3 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">
            {title}
          </h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-white/60" />
        </div>
      </div>
    );
  }

  if (limitedGenerations.length === 0) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-slate-500" />
          <h3 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">
            {title}
          </h3>
        </div>
        <div className="text-center py-6">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{
              background: "var(--bg-glass)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <ImageIcon className="w-5 h-5 text-slate-600" />
          </div>
          <p className="text-[11px] text-slate-500">No generations yet</p>
          <p className="text-[10px] text-slate-600 mt-1">
            Start generating to see history
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "inset 0 1px 0 var(--mc-glass-inset)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-slate-500" />
        <h3 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">
          {title}
        </h3>
        <span
          className="ml-auto px-2 py-0.5 rounded-full text-[9px] font-medium"
          style={{ background: "rgba(139,92,246,0.15)", color: "#A78BFA" }}
        >
          {limitedGenerations.length}
        </span>
      </div>

      <div className="space-y-2">
        {limitedGenerations.map((gen, index) => (
          <GenerationHistoryCard
            key={gen.id}
            generation={gen}
            onPreview={handlePreview}
            onDownload={(gen) =>
              handleDownload(parseOutputUrls(gen.outputUrl)[0], 0, gen)
            }
            index={index}
          />
        ))}
      </div>

      {/* Preview Modal with Multi-Image Support */}
      {previewModal &&
        createPortal(
          <div
            className="fixed inset-y-0 right-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
            style={{ left: viewportBounds.left, width: viewportBounds.width ? `${viewportBounds.width}px` : undefined }}
            onClick={() => setPreviewModal(null)}
          >
            <div
              className="relative flex flex-col w-full max-w-[86vw] sm:max-w-[72vw] md:max-w-[56vw] lg:max-w-[42vw] max-h-[84vh] rounded-2xl overflow-hidden"
              style={{
                background: "linear-gradient(180deg, rgba(17,17,26,0.97) 0%, rgba(10,10,18,0.98) 100%)",
                border: "1px solid rgba(255,255,255,0.2)",
                boxShadow: "0 12px 42px rgba(0,0,0,0.45)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewModal(null)}
                className="absolute top-3 right-3 z-10 p-2 rounded-full transition-all"
                style={{
                  background: "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                <X className="w-5 h-5 text-white" />
              </button>

              <div className="flex-1 min-h-0 overflow-auto">
                {isVideoType(previewModal.type) ? (
                  <div className="flex items-center justify-center p-2 sm:p-3">
                    <video
                      src={previewUrls[0]}
                      controls
                      autoPlay
                      className="max-w-full max-h-[65vh] rounded-lg object-contain"
                    />
                  </div>
                ) : previewUrls.length === 1 ? (
                  <div className="flex items-center justify-center p-2 sm:p-3">
                    <img
                      src={previewUrls[0]}
                      alt={previewModal.prompt || "Generated image"}
                      className="max-w-full max-h-[65vh] object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="p-3 sm:p-4">
                    <div
                      className={`grid gap-2.5 ${previewUrls.length === 2 ? "grid-cols-2" : previewUrls.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
                    >
                      {previewUrls.map((url, idx) => (
                        <div key={idx} className="relative group">
                          <img
                            src={url}
                            alt={`Generated image ${idx + 1}`}
                            className="w-full h-auto rounded-lg object-cover aspect-square cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownload(url, idx);
                            }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(url, idx);
                            }}
                            className="absolute bottom-2 right-2 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-white/20"
                            title={`Download image ${idx + 1}`}
                          >
                            <Download className="w-4 h-4 text-black" />
                          </button>
                          <div
                            className="absolute top-2 left-2 px-2 py-1 rounded-md text-[10px] font-medium"
                            style={{
                              background: "rgba(0,0,0,0.6)",
                              color: "#fff",
                            }}
                          >
                            {idx + 1}/{previewUrls.length}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div
                className="flex-shrink-0 px-3 py-2.5 sm:px-4 sm:py-3"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  borderTop: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                {previewModal.prompt && (
                  <div className="mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Prompt</p>
                    <p className="text-[11px] text-slate-300 leading-relaxed" data-testid="text-genhistory-prompt">
                      {previewModal.prompt}
                    </p>
                  </div>
                )}
                {(() => {
                  let loraInfo = null;
                  try {
                    if (previewModal.inputImageUrl) {
                      loraInfo = JSON.parse(previewModal.inputImageUrl);
                    }
                  } catch {}
                  if (!loraInfo) return null;
                  return (
                    <>
                      <div className="flex flex-wrap gap-1.5 mb-2" data-testid="generation-payload-badges">
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
                        <details className="mb-2">
                          <summary className="text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none">
                            Negative Prompt
                          </summary>
                          <p className="text-[10px] text-slate-400 leading-relaxed mt-1" data-testid="text-negative-prompt">
                            {loraInfo.negativePrompt}
                          </p>
                        </details>
                      )}
                      {loraInfo.builtPrompt && (
                        <details className="mb-2">
                          <summary className="text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none">
                            Full Built Prompt
                          </summary>
                          <p className="text-[10px] text-slate-400 leading-relaxed mt-1" data-testid="text-built-prompt">
                            {loraInfo.builtPrompt}
                          </p>
                        </details>
                      )}
                    </>
                  );
                })()}
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-400">
                      {new Date(previewModal.createdAt).toLocaleString()}
                    </p>
                    {previewUrls.length > 1 && (
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {previewUrls.length} images generated
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {previewUrls.length > 1 && (
                      <button
                        onClick={handleDownloadAll}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 text-white"
                        style={{ background: "rgba(255,255,255,0.1)" }}
                      >
                        <Download className="w-3.5 h-3.5" />
                        All
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(previewUrls[0], 0)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 text-black bg-white border border-white/20"
                    >
                      <Download className="w-3.5 h-3.5 text-black" />
                      {previewUrls.length > 1 ? "Download First" : "Download"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function isVideoType(type) {
  return [
    "video",
    "faceswap",
    "face-swap",
    "prompt-video",
    "talking-head",
    "recreate-video",
    "nsfw-video-motion",
  ].includes(type);
}

function GenerationHistoryCard({ generation, onPreview, onDownload, index }) {
  const isProcessing =
    generation.status === "processing" || generation.status === "pending";
  const isCompleted = generation.status === "completed";
  const isFailed = generation.status === "failed";
  const isVideo = isVideoType(generation.type);

  // Get thumbnail URL
  const getThumbnailUrl = () => {
    if (isVideo) {
      try {
        const parsed = JSON.parse(generation.inputImageUrl);
        if (Array.isArray(parsed)) return parsed[0];
        if (parsed.identityImages && Array.isArray(parsed.identityImages))
          return parsed.identityImages[0];
        if (parsed.faceImageUrl) return parsed.faceImageUrl;
        if (parsed.imageUrl) return parsed.imageUrl;
        return generation.inputImageUrl;
      } catch {
        return generation.inputImageUrl;
      }
    }

    // For images (including NSFW), outputUrl can be JSON array or single URL
    if (generation.outputUrl) {
      try {
        const parsed = JSON.parse(generation.outputUrl);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed[0]; // Return first image as thumbnail
        }
      } catch {
        // Not JSON, return as-is
      }
    }
    return generation.outputUrl;
  };

  const thumbnailUrl = getThumbnailUrl();

  // Get image count for badge
  const getImageCount = () => {
    if (!generation.outputUrl) return 1;
    try {
      const parsed = JSON.parse(generation.outputUrl);
      if (Array.isArray(parsed)) return parsed.length;
    } catch {
      // Not JSON
    }
    return 1;
  };

  const imageCount = getImageCount();

  return (
    <div
      className="flex items-center gap-3 p-2 rounded-xl group cursor-pointer"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
      onClick={() =>
        isCompleted && generation.outputUrl && onPreview(generation)
      }
    >
      {/* Thumbnail */}
      <div
        className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
        style={{
          background: "var(--bg-glass)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {isCompleted && thumbnailUrl ? (
          <>
            <img
              src={thumbnailUrl}
              alt="Thumbnail"
              className="w-full h-full object-cover"
            />
            {isVideo && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <Play className="w-4 h-4 text-white" fill="white" />
              </div>
            )}
            {/* Image count badge */}
            {imageCount > 1 && (
              <div
                className="absolute bottom-0.5 right-0.5 px-1 py-0.5 rounded text-[8px] font-bold"
                style={{ background: "rgba(139,92,246,0.9)", color: "#fff" }}
              >
                {imageCount}
              </div>
            )}
          </>
        ) : isProcessing ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-white/60" />
          </div>
        ) : isFailed ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
        ) : null}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {isProcessing && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{ background: "rgba(59,130,246,0.15)", color: "#60A5FA" }}
            >
              Processing
            </span>
          )}
          {isCompleted && (
            <span
              className="px-1.5 py-0.5 rounded flex items-center gap-1 text-[9px] font-medium"
              style={{ background: "rgba(34,197,94,0.15)", color: "#4ADE80" }}
            >
              <CheckCircle className="w-2.5 h-2.5" />
              Done
            </span>
          )}
          {isFailed && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}
            >
              Failed
            </span>
          )}
          {imageCount > 1 && isCompleted && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{ background: "rgba(139,92,246,0.15)", color: "#A78BFA" }}
            >
              {imageCount} images
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400 truncate">
          {getTypeLabel(generation)}
        </p>
        <p className="text-[9px] text-slate-600">
          {formatTimeAgo(generation.createdAt)}
        </p>
      </div>

      {/* Actions */}
      {isCompleted && generation.outputUrl && (
        <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPreview(generation);
            }}
            className="p-1.5 rounded-lg transition-all"
            style={{ background: "rgba(255,255,255,0.08)" }}
            title="Preview"
            data-testid={`button-preview-${generation.id}`}
          >
            <Eye className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload(generation);
            }}
            className="p-1.5 rounded-lg transition-all"
            style={{ background: "rgba(255,255,255,0.15)" }}
            title="Download"
            data-testid={`button-download-${generation.id}`}
          >
            <Download className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}

function getTypeLabel(generation) {
  const labels = {
    image: "Identity Recreation",
    "prompt-image": "AI Image",
    "face-swap-image": "Face Swap",
    video: "Video",
    "recreate-video": "Recreate Video",
    "nsfw-video-motion": "Recreate Video",
    faceswap: "Face Swap Video",
    "face-swap": "Face Swap Video",
    "prompt-video": "Prompt Video",
    "talking-head": "Talking Head",
    nsfw: "NSFW Image",
  };
  return labels[generation.type] || generation.type;
}

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
