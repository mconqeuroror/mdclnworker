import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, AlertTriangle, Clock, CheckCircle, X, Maximize2, Info } from 'lucide-react';
import { resolveLocale } from './generateAIModelFormCopy';
import { downloadFromPublicUrl } from '../utils/directDownload';

const LIVE_PREVIEW_COPY = {
  en: {
    title: 'Live Preview',
    processing: 'Processing',
    done: 'Done',
    failed: 'Failed',
    emptyHint: 'Your result will appear here',
    generating: 'Generating...',
    usuallyVideo: 'Usually 2-3 minutes',
    usuallyImage: 'Usually 10-30 seconds',
    fullscreen: 'Fullscreen',
    download: 'Download',
    genFailed: 'Generation failed',
    refundHint: 'If this generation charged credits, a refund is applied automatically.',
    altGenerated: 'Generated',
  },
  ru: {
    title: 'Превью',
    processing: 'Обработка',
    done: 'Готово',
    failed: 'Ошибка',
    emptyHint: 'Результат появится здесь',
    generating: 'Генерация...',
    usuallyVideo: 'Обычно 2–3 минуты',
    usuallyImage: 'Обычно 10–30 секунд',
    fullscreen: 'На весь экран',
    download: 'Скачать',
    genFailed: 'Ошибка генерации',
    refundHint: 'Если списали кредиты, возврат начисляется автоматически.',
    altGenerated: 'Результат',
  },
};

export default function LivePreviewPanel({ 
  type = 'image',
  latestGeneration = null,
  onDownload
}) {
  const locale = resolveLocale();
  const t = LIVE_PREVIEW_COPY[locale] || LIVE_PREVIEW_COPY.en;
  const [previewOpen, setPreviewOpen] = useState(false);
  
  const isProcessing = latestGeneration?.status === 'processing' || latestGeneration?.status === 'pending';
  const isCompleted = latestGeneration?.status === 'completed';
  const isFailed = latestGeneration?.status === 'failed';
  const isVideo = type === 'video' || type === 'faceswap-video' || type === 'recreate-video' || type === 'face-swap' || type === 'prompt-video' || type === 'talking-head';
  const parsedProgress = Number(latestGeneration?.progressPercent);
  const hasLiveProgress = Number.isFinite(parsedProgress) && parsedProgress >= 0;
  const liveProgress = hasLiveProgress ? Math.max(0, Math.min(100, Math.round(parsedProgress))) : null;
  const liveStage = latestGeneration?.progressStage || null;
  
  const handleDownload = () => {
    if (!latestGeneration?.outputUrl) return;
    const outputUrl = latestGeneration.outputUrl;
    const lowerUrl = outputUrl.toLowerCase();
    const isOutputVideo = isVideo || lowerUrl.includes(".mp4") || lowerUrl.includes(".webm");
    const ext = isOutputVideo ? (lowerUrl.includes(".webm") ? "webm" : "mp4") : "jpg";
    const filename = `generation-${latestGeneration.id}.${ext}`;
    void downloadFromPublicUrl(outputUrl, filename);
  };

  return (
    <>
      <div 
        className="rounded-2xl p-4 flex-shrink-0"
        style={{
          background: 'linear-gradient(180deg, rgba(22,22,30,0.72) 0%, rgba(14,14,22,0.78) 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center"
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(148, 163, 184, 0.5)",
                boxShadow: isProcessing
                  ? "0 0 10px rgba(74, 222, 128, 0.55)"
                  : "none",
              }}
            >
              <Info className={`w-3 h-3 ${isProcessing ? "text-green-400" : "text-slate-300"}`} />
            </div>
            <h3 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{t.title}</h3>
          </div>
          {latestGeneration && (
            <div className="flex items-center gap-2">
              {isProcessing && (
                <span className="px-2 py-0.5 rounded-full flex items-center gap-1.5 text-[10px] font-medium" style={{ background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t.processing}
                </span>
              )}
              {isCompleted && (
                <span className="px-2 py-0.5 rounded-full flex items-center gap-1.5 text-[10px] font-medium" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }}>
                  <CheckCircle className="w-3 h-3" />
                  {t.done}
                </span>
              )}
              {isFailed && (
                <span className="px-2 py-0.5 rounded-full flex items-center gap-1.5 text-[10px] font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#F87171' }}>
                  <AlertTriangle className="w-3 h-3" />
                  {t.failed}
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Preview Area - NO ANIMATIONS */}
        <div 
          className="relative aspect-[3/4] rounded-xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(59,130,246,0.04) 100%)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
          }}
        >
          {!latestGeneration ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <Clock className="w-6 h-6 text-slate-600" />
              </div>
              <p className="text-[11px] text-slate-500">{t.emptyHint}</p>
            </div>
          ) : isProcessing ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="relative mb-4">
                <div className="w-14 h-14 rounded-full" style={{ border: '3px solid rgba(255,255,255,0.1)' }} />
                <div className="absolute inset-0 w-14 h-14 rounded-full animate-spin" style={{ border: '3px solid transparent', borderTopColor: 'rgba(255,255,255,0.7)' }} />
              </div>
              <p className="text-sm font-medium text-slate-300">{t.generating}</p>
              {hasLiveProgress ? (
                <div className="mt-2 w-[180px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>{liveStage || t.processing}</span>
                    <span>{liveProgress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-white/70 transition-all duration-500"
                      style={{ width: `${liveProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 mt-1">
                  {isVideo ? t.usuallyVideo : t.usuallyImage}
                </p>
              )}
            </div>
          ) : isCompleted && latestGeneration.outputUrl ? (
            <div className="absolute inset-0">
              {isVideo ? (
                <video
                  src={latestGeneration.outputUrl}
                  className="w-full h-full object-contain bg-black"
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={latestGeneration.outputUrl}
                  alt={t.altGenerated}
                  className="w-full h-full object-contain"
                />
              )}
              
              {/* Action Buttons Overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                <div className="flex gap-2">
                  <button
                    onClick={() => setPreviewOpen(true)}
                    className="flex-1 py-2 px-3 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5"
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.1)' }}
                    data-testid="button-preview-fullscreen"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    {t.fullscreen}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex-1 py-2 px-3 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 shadow-lg bg-white text-black"
                    data-testid="button-download-result"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t.download}
                  </button>
                </div>
              </div>
            </div>
          ) : isFailed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm font-medium text-red-400 text-center">
                {latestGeneration?.errorMessage || t.genFailed}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">{t.refundHint}</p>
            </div>
          ) : null}
        </div>
        
      </div>
      
      {/* Fullscreen Modal - portaled to body to escape sticky/overflow parents */}
      {previewOpen && latestGeneration?.outputUrl && createPortal(
        <div 
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <button
            onClick={() => setPreviewOpen(false)}
            className="absolute top-4 right-4 p-2.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <X className="w-5 h-5 text-white" />
          </button>
          {isVideo ? (
            <video
              src={latestGeneration.outputUrl}
              className="max-w-full max-h-full object-contain rounded-lg"
              controls
              autoPlay
              loop
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={latestGeneration.outputUrl}
              alt={t.altGenerated}
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>,
        document.body
      )}
    </>
  );
}
