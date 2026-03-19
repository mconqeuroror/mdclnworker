import { useState, useEffect, useCallback } from "react";
import { X, Loader2, Mic, Wand2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";

/**
 * Create or replace one custom ElevenLabs voice per model (design or MP3 clone).
 */
export default function ModelVoiceStudioModal({
  isOpen,
  onClose,
  model,
  onSuccess,
  sidebarCollapsed = false,
}) {
  const [tab, setTab] = useState("design");
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [description, setDescription] = useState("");
  const [previews, setPreviews] = useState([]);
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [pickedId, setPickedId] = useState("");

  const [cloneFile, setCloneFile] = useState(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** ISO-style code from API languageOptions, or "" for auto */
  const [language, setLanguage] = useState("");

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const r = await api.get("/models/voice-platform/status");
      if (r.data?.success) setStatus(r.data);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadStatus();
    setPreviews([]);
    setPickedId("");
    setDescription("");
    setCloneFile(null);
    setConsent(false);
    setLanguage("");
    setTab("design");
  }, [isOpen, model?.id, loadStatus]);

  if (!isOpen || !model) return null;

  const isProcessing = model.status === "processing";
  const hasVoice = Boolean(model.elevenLabsVoiceId);
  const p = status?.pricing || {};
  const designCost = hasVoice ? p.designRecreate ?? 500 : p.designInitial ?? 1000;
  const cloneCost = hasVoice ? p.cloneRecreate ?? 1000 : p.cloneInitial ?? 2000;
  const atCap =
    status &&
    !hasVoice &&
    status.usedCustomVoices >= status.maxCustomVoices;

  const languageOptions =
    Array.isArray(status?.languageOptions) && status.languageOptions.length > 0
      ? status.languageOptions
      : [{ code: "", label: "Auto / not specified" }];

  const handleDesignPreviews = async () => {
    const d = description.trim();
    if (d.length < 20) {
      toast.error("Description must be at least 20 characters.");
      return;
    }
    setLoadingPreviews(true);
    setPreviews([]);
    setPickedId("");
    try {
      const r = await api.post(`/models/${model.id}/voice/design-previews`, {
        voiceDescription: d,
        ...(language ? { language } : {}),
      });
      if (r.data?.success && Array.isArray(r.data.previews)) {
        setPreviews(r.data.previews);
        if (r.data.previews[0]?.generatedVoiceId) {
          setPickedId(r.data.previews[0].generatedVoiceId);
        }
        toast.success("Pick a preview, then confirm below.");
      } else {
        toast.error(r.data?.message || "No previews returned");
      }
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to generate previews");
    } finally {
      setLoadingPreviews(false);
    }
  };

  const handleDesignConfirm = async () => {
    if (!consent) {
      toast.error("Please confirm consent.");
      return;
    }
    if (!pickedId) {
      toast.error("Select a voice preview first.");
      return;
    }
    const d = description.trim();
    if (d.length < 20) {
      toast.error("Keep your description (20+ characters).");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post(`/models/${model.id}/voice/design-confirm`, {
        generatedVoiceId: pickedId,
        voiceDescription: d,
        consentConfirmed: true,
        ...(language ? { language } : {}),
      });
      if (r.data?.success) {
        toast.success(`Custom voice saved · ${r.data.creditsUsed ?? designCost} credits`);
        onSuccess?.(r.data.model);
        onClose?.();
      } else {
        toast.error(r.data?.message || "Failed");
      }
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to create voice");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClone = async () => {
    if (!consent) {
      toast.error("Please confirm consent.");
      return;
    }
    if (!cloneFile) {
      toast.error("Upload one MP3 file.");
      return;
    }
    const fd = new FormData();
    fd.append("audio", cloneFile);
    fd.append("consent", "true");
    if (language) fd.append("language", language);
    setSubmitting(true);
    try {
      const r = await api.post(`/models/${model.id}/voice/clone`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (r.data?.success) {
        toast.success(`Voice cloned · ${r.data.creditsUsed ?? cloneCost} credits`);
        onSuccess?.(r.data.model);
        onClose?.();
      } else {
        toast.error(r.data?.message || "Failed");
      }
    } catch (e) {
      toast.error(e.response?.data?.message || "Clone failed");
    } finally {
      setSubmitting(false);
    }
  };

  const leftOffset = sidebarCollapsed ? "md:left-[80px]" : "md:left-[260px]";
  return (
    <div
      className={`fixed top-0 right-0 bottom-0 left-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm ${leftOffset}`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl max-h-[90dvh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-5 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white pr-10 flex items-center gap-2">
            <Mic className="w-5 h-5 text-violet-400" />
            Custom voice · {model.name}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            One voice per model for talking-head. Replacing an existing voice deletes the old one on our provider first.
          </p>
          {loadingStatus ? (
            <p className="text-[11px] text-slate-600 mt-2 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading limits…
            </p>
          ) : status ? (
            <p className="text-[11px] text-slate-500 mt-2">
              Platform voices:{" "}
              <span className="text-slate-300">
                {status.usedCustomVoices} / {status.maxCustomVoices}
              </span>
              {atCap && (
                <span className="text-amber-400 ml-2">Cap reached — recreate an existing model voice or wait for admin.</span>
              )}
            </p>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isProcessing && (
            <div className="text-amber-200 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              This model is still generating. Open this again when it&apos;s ready.
            </div>
          )}

          <div className="flex rounded-xl p-0.5 bg-white/5 border border-white/10">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setTab("design")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                tab === "design" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Design ({designCost} cr)
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setTab("clone")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                tab === "clone" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Clone MP3 ({cloneCost} cr)
            </button>
          </div>

          {hasVoice && (
            <p className="text-[11px] text-slate-400">
              You already have a custom voice ({model.elevenLabsVoiceType || "custom"}). Creating a new one replaces it
              and costs the recreate rate.
            </p>
          )}

          <label className="block">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider">
              Primary language (optional)
            </span>
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                setPreviews([]);
                setPickedId("");
              }}
              disabled={isProcessing}
              className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 text-sm text-white px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            >
              {languageOptions.map((o) => (
                <option key={o.code || "auto"} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-600 mt-1 leading-snug">
              <strong className="text-slate-500">Design:</strong> we add a language hint to your description (ElevenLabs has no separate language field).{" "}
              <strong className="text-slate-500">Clone:</strong> sent as voice metadata (<code className="text-slate-500">labels.language</code>) to ElevenLabs.
              Change language? Regenerate previews before confirming (design).
            </p>
          </label>

          {tab === "design" && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Voice description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isProcessing}
                  rows={4}
                  placeholder="e.g. Young woman, warm and conversational, slight European accent, medium pitch…"
                  className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-600 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
                <span className="text-[10px] text-slate-600">{description.trim().length} / 20–2000</span>
              </label>
              <button
                type="button"
                disabled={isProcessing || loadingPreviews}
                onClick={handleDesignPreviews}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15 text-white border border-white/10 disabled:opacity-40"
              >
                {loadingPreviews ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Generating previews…
                  </span>
                ) : (
                  "Generate previews (free)"
                )}
              </button>

              {previews.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">Select a preview</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {previews.map((pr, i) => (
                      <label
                        key={pr.generatedVoiceId || i}
                        className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer ${
                          pickedId === pr.generatedVoiceId
                            ? "border-violet-500/50 bg-violet-500/10"
                            : "border-white/10 bg-white/[0.02]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="pv"
                          checked={pickedId === pr.generatedVoiceId}
                          onChange={() => setPickedId(pr.generatedVoiceId)}
                          className="accent-violet-500"
                        />
                        <audio
                          controls
                          className="flex-1 h-8"
                          src={
                            pr.audioBase64
                              ? `data:audio/mpeg;base64,${pr.audioBase64}`
                              : undefined
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "clone" && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">One MP3 sample</span>
                <input
                  type="file"
                  accept=".mp3,audio/mpeg,audio/mp3"
                  disabled={isProcessing}
                  onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
                  className="mt-1 block w-full text-xs text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-white/10 file:text-white"
                />
              </label>
              <p className="text-[10px] text-slate-600">Max 25 MB. Spoken sample works best.</p>
            </div>
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={isProcessing}
              className="mt-0.5 accent-violet-500"
            />
            <span className="text-[11px] text-slate-400 leading-snug">
              I confirm I have the rights to use this voice / recording and I will not use it for impersonation,
              fraud, or illegal content. I understand custom voices are subject to platform and provider policies.
            </span>
          </label>
        </div>

        <div className="p-5 border-t border-white/10 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5"
          >
            Cancel
          </button>
          {tab === "design" ? (
            <button
              type="button"
              disabled={isProcessing || submitting || atCap || !previews.length}
              onClick={handleDesignConfirm}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : `Create voice · ${designCost} cr`}
            </button>
          ) : (
            <button
              type="button"
              disabled={isProcessing || submitting || atCap}
              onClick={handleClone}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : `Clone voice · ${cloneCost} cr`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
