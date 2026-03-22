import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Plus, Download, Loader2, Maximize2, Wand2, Sparkles, AlertCircle,
  Trash2, Video, User, Play, Clock, Coins, ChevronDown, Mic, CheckCircle,
  PauseCircle, Info,
} from "lucide-react";
import { creatorStudioAPI, avatarAPI, modelAPI, uploadFile } from "../services/api";
import { useAuthStore } from "../store";
import { useActiveGeneration } from "../hooks/useActiveGeneration";

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

const BAR_BG = "linear-gradient(115deg, rgba(36,43,50,0.12) 27.54%, rgba(219,219,219,0.12) 85.5%), rgba(15,17,19,0.96)";

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
      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all select-none"
      style={active ? {
        background: "rgba(139,92,246,0.28)",
        color: "#e9d5ff",
        border: "1px solid rgba(139,92,246,0.55)",
        boxShadow: "0 0 8px 1px rgba(139,92,246,0.25)",
      } : {
        color: "rgba(148,163,184,1)",
        border: "1px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

function RefSlot({ url, onRemove, onAdd, uploading }) {
  const inputRef = useRef(null);
  if (url) {
    return (
      <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-white/10 flex-shrink-0 group">
        <img src={url} alt="" className="w-full h-full object-cover" />
        <button
          onClick={onRemove}
          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5 text-white" />
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center flex-shrink-0 hover:border-white/30 hover:bg-white/5 transition-all text-slate-500 hover:text-white disabled:opacity-40"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAdd(f); e.target.value = ""; }}
      />
    </>
  );
}

function ResultCard({ gen, onExpand }) {
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
          <p className="text-xs text-slate-400">Generating…</p>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <AlertCircle className="w-6 h-6 text-red-400/60" />
          <p className="text-[11px] text-red-400/70">{gen.errorMessage || "Failed"}</p>
        </div>
      )}
    </motion.div>
  );
}

function Lightbox({ gen, onClose }) {
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
          <Download className="w-3.5 h-3.5" /> Save
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
          Make Video
        </button>
      </div>
    </motion.div>
  );
}

function CreateAvatarModal({ isOpen, onClose, model, avatarCount, onCreated }) {
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
    if (!name.trim())  return toast.error("Enter a name for the avatar");
    if (!photo)        return toast.error("Upload a photo");
    if (!model?.elevenLabsVoiceId) return toast.error("This model has no voice. Create a voice in Model Settings first.");

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("modelId", model.id);
      fd.append("name", name.trim());
      fd.append("photo", photo);
      const data = await avatarAPI.create(fd);
      toast.success("Avatar submitted! HeyGen is processing it — check back in a few minutes.");
      reset();
      onCreated(data.avatar);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || "Failed to create avatar");
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
              <h3 className="text-sm font-bold text-white">New Avatar</h3>
              <p className="text-[11px] text-slate-500">{avatarCount}/{MAX_AVATARS} slots used</p>
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
              Portrait Photo
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
                <span className="text-xs">Upload portrait photo</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhoto} />
          </div>

          {/* Name */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
              Avatar Name
            </label>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Studio Look, Casual Outdoor…"
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50"
            />
          </div>

          {/* Voice status */}
          <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl ${
            hasVoice ? "bg-green-400/5 border border-green-400/15" : "bg-amber-400/5 border border-amber-400/15"}`}>
            <Mic className={`w-4 h-4 mt-0.5 flex-shrink-0 ${hasVoice ? "text-green-400" : "text-amber-400"}`} />
            <div>
              <p className={`text-xs font-semibold ${hasVoice ? "text-green-300" : "text-amber-300"}`}>
                {hasVoice ? `Voice: ${model.elevenLabsVoiceName || model.elevenLabsVoiceType || "Custom"}` : "No voice configured"}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {hasVoice
                  ? "All avatars on this model share this voice."
                  : "Go to Model Settings → Voice Studio to create a voice first."}
              </p>
            </div>
          </div>

          {/* Cost */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <span className="text-xs text-slate-400">One-time creation fee</span>
            <span className="flex items-center gap-1 text-sm font-bold text-white">
              {COST} <Coins className="w-3.5 h-3.5 text-yellow-400" />
            </span>
          </div>
          {credits < COST && (
            <p className="text-xs text-red-400 text-center">
              Insufficient credits ({credits} available, {COST} required)
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
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Submitting…</span>
              : `Create Avatar · ${COST} cr`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function GenerateVideoModal({ isOpen, avatar, model, onClose, onGenerated }) {
  const user = useAuthStore(s => s.user);
  const [script, setScript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const PER_SEC = 5;

  const secs = estimateSecs(script);
  const cost = secs * PER_SEC;
  const tooLong = secs > MAX_VIDEO_SECONDS;
  const credits = user?.credits ?? 0;

  const handleSubmit = async () => {
    if (!script.trim()) return toast.error("Write a script");
    if (tooLong) return toast.error(`Script is too long (max ${MAX_VIDEO_SECONDS / 60} min)`);

    setSubmitting(true);
    try {
      const data = await avatarAPI.generateVideo(avatar.id, { script: script.trim() });
      toast.success("Video generation started!");
      setScript("");
      onGenerated(data.video);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || "Failed to start video generation");
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
              Script
            </label>
            <textarea
              value={script} onChange={(e) => setScript(e.target.value)}
              placeholder="Write what the avatar will say…"
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
                  ~{secs < 60 ? `${secs}s` : `${(secs / 60).toFixed(1)}m`} estimated
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
            <span>Charged at {PER_SEC} credits/second. Max {MAX_VIDEO_SECONDS / 60} minutes. Refunded if generation fails.</span>
          </div>

          {credits < cost && script.trim() && (
            <p className="text-xs text-red-400 text-center">
              Insufficient credits ({credits} available, ~{cost} required)
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
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Starting…</span>
              : `Generate Video${script.trim() ? ` · ${cost} cr` : ""}`}
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
              <p className="text-xs text-slate-500">Generating video…</p>
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
  const queryClient = useQueryClient();
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [makeVideoFor, setMakeVideoFor] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [videos, setVideos] = useState([]);
  const [modelDropOpen, setModelDropOpen] = useState(false);

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
              toast.success("Video ready!");
            } else if (updated.status === "failed") {
              toast.error("Video generation failed — credits refunded");
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
      toast.success("Avatar deleted");
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
          <h2 className="text-sm font-bold text-white">Real Avatars</h2>
          <p className="text-[11px] text-slate-500">HeyGen Photo Avatar IV · up to {MAX_AVATARS} per model</p>
        </div>
      </div>

      {/* Model picker */}
      <div className="mb-6">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Model</p>
        {modelsLoading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading models…
          </div>
        ) : models.length === 0 ? (
          <p className="text-sm text-slate-500">No models yet. Create a model first.</p>
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
                <span className="truncate">{selectedModel?.name || "Select model"}</span>
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
                      <p className="text-[10px] text-slate-500">{m.elevenLabsVoiceId ? `Voice: ${m.elevenLabsVoiceName || "Custom"}` : "No voice"}</p>
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
            <p className="text-xs font-semibold text-amber-300">Voice required</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              All avatars share the model's voice. Go to <strong className="text-slate-400">Models → Voice Studio</strong> to create one.
            </p>
          </div>
        </div>
      )}

      {/* Avatars grid */}
      {selectedModelId && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Avatars ({avatars.length}/{MAX_AVATARS})
          </p>

          {avatarsLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-6">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading avatars…
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
                    New Avatar
                  </span>
                  <span className="text-[10px] text-slate-700 mt-0.5 flex items-center gap-1">
                    1000 <Coins className="w-2.5 h-2.5 text-yellow-500/60" />
                  </span>
                </motion.button>
              )}

              {!canCreate && avatars.length >= MAX_AVATARS && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-center"
                  style={{ aspectRatio: "3/4" }}>
                  <span className="text-[11px] text-slate-600">Limit reached</span>
                  <span className="text-[10px] text-slate-700 mt-1">Delete an avatar to add a new one</span>
                </div>
              )}
            </div>
          )}

          {/* Monthly billing info */}
          {avatars.filter(a => a.status !== "failed").length > 0 && (
            <div className="flex items-start gap-2 mb-6 text-[11px] text-slate-600">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-700" />
              <span>Active avatars are billed 500 credits/month to keep them live. Suspended avatars cannot generate videos.</span>
            </div>
          )}
        </div>
      )}

      {/* Videos feed */}
      {videos.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Recent Videos
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
  { id: "generate",    label: "Generate",     icon: Sparkles, desc: "NanoBanana Pro · no model required" },
  { id: "avatars",     label: "Real Avatars",  icon: User,     desc: "HeyGen Photo Avatar IV" },
];

export default function CreatorStudioPage({ sidebarCollapsed = false }) {
  const [activeTab, setActiveTab] = useState("generate");
  const user        = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  // NanoBanana state
  const [prompt, setPrompt]             = useState("");
  const [refs, setRefs]                 = useState(Array(MAX_REFS).fill(null));
  const [uploadingIdx, setUploadingIdx] = useState(null);
  const [aspectRatio, setAspectRatio]   = useState("1:1");
  const [resolution, setResolution]     = useState("1K");
  const { activeGeneration, isGenerating, startGeneration, pollForCompletion, reset } = useActiveGeneration();
  const [history, setHistory]           = useState([]);
  const [lightboxGen, setLightboxGen]   = useState(null);

  const { isLoading: histLoading } = useQuery({
    queryKey: ["creator-studio-history"],
    queryFn: async () => {
      const data = await creatorStudioAPI.getHistory({ limit: 20 });
      setHistory(data.generations ?? []);
      return data;
    },
    staleTime: 30_000,
  });

  const handleAddRef = useCallback(async (file, slotIdx) => {
    setUploadingIdx(slotIdx);
    try {
      const result = await uploadFile(file);
      const url = result?.url || result;
      if (!url) throw new Error("No URL returned");
      setRefs((prev) => { const next = [...prev]; next[slotIdx] = url; return next; });
    } catch (err) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploadingIdx(null);
    }
  }, []);

  const removeRef = (idx) =>
    setRefs((prev) => { const next = [...prev]; next[idx] = null; return next; });

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt"); return; }
    const filledRefs = refs.filter(Boolean);
    startGeneration({ status: "processing", type: "creator-studio", prompt: prompt.trim() });
    try {
      const data = await creatorStudioAPI.generate({ prompt: prompt.trim(), referencePhotos: filledRefs, aspectRatio, resolution });
      if (!data.success) throw new Error(data.message || "Generation failed");
      startGeneration({ ...data.generation, prompt: prompt.trim() });
      pollForCompletion(data.generation.id, {
        onSuccess: (gen) => {
          toast.success("Done!");
          refreshUser?.();
          setHistory((prev) => [{ ...gen, prompt: prompt.trim() }, ...prev.filter((g) => g.id !== gen.id)]);
        },
        onFailure: (gen) => toast.error(gen.errorMessage || "Generation failed — credits refunded"),
      });
    } catch (err) {
      reset();
      toast.error(err.response?.data?.message || err.message || "Generation failed");
    }
  };

  const COST = resolution === "4K" ? 25 : 20;
  const creditsLeft = user?.credits ?? 0;
  const displayGens = [
    ...(activeGeneration ? [activeGeneration] : []),
    ...history.filter((g) => g.id !== activeGeneration?.id),
  ];

  return (
    <div className="relative flex flex-col min-h-full bg-[#0a0a0c]">

      {/* ── Tab switcher ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-1 z-10 relative">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={active ? {
                background: "rgba(139,92,246,0.18)",
                color: "#e9d5ff",
                border: "1px solid rgba(139,92,246,0.35)",
              } : {
                color: "rgba(100,116,139,1)",
                border: "1px solid transparent",
              }}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── NanoBanana Generate tab ───────────────────────────────────────── */}
      {activeTab === "generate" && (
        <>
          {/* Canvas — results area */}
          <div className="flex-1 px-6 pt-4 pb-64 min-h-screen">
            <div className="flex items-center gap-4 mb-8">
              <div className="relative flex-shrink-0">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)",
                    boxShadow: "0 0 0 1px rgba(139,92,246,0.4), 0 0 24px rgba(109,40,217,0.45)",
                  }}>
                  <Wand2 className="w-6 h-6 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">NanoBanana Pro</h1>
                <p className="text-sm text-slate-400 mt-0.5">No model required · generate anything</p>
              </div>
            </div>

            {displayGens.length === 0 && !histLoading && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}>
                  <Sparkles className="w-8 h-8 text-purple-400/60" />
                </div>
                <p className="text-slate-500 text-sm">Your creations will appear here</p>
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
            {/* Spinning-border wrapper */}
            <div className="pointer-events-auto w-full max-w-2xl relative rounded-2xl overflow-hidden p-px">
              {/* Rotating conic-gradient that forms the animated border */}
              <div style={{
                position: "absolute",
                inset: "-150%",
                background: "conic-gradient(from 0deg, transparent 320deg, rgba(255,255,255,0.08) 345deg, rgba(255,255,255,0.55) 358deg, rgba(255,255,255,0.08) 360deg, transparent 360deg)",
                animation: "bar-spin 4s linear infinite",
                pointerEvents: "none",
              }} />
            <div
              className="relative w-full flex flex-col items-stretch justify-center p-3 rounded-2xl"
              style={{ background: BAR_BG }}
            >
              <textarea
                value={prompt} onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
                placeholder="Describe the scene you imagine"
                rows={2}
                className="w-full bg-transparent text-sm text-white placeholder-slate-500 resize-none outline-none px-1 py-1 leading-relaxed"
              />
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-0.5">Refs</span>
                  {refs.map((url, i) => (
                    <RefSlot key={i} url={url} uploading={uploadingIdx === i}
                      onRemove={() => removeRef(i)} onAdd={(file) => handleAddRef(file, i)} />
                  ))}
                </div>
                <div className="w-px h-6 bg-white/[0.08] flex-shrink-0" />
                <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-0.5">Aspect</span>
                  {ASPECT_RATIOS.map((ar) => (
                    <Chip key={ar.value} active={aspectRatio === ar.value} onClick={() => setAspectRatio(ar.value)}>
                      {ar.hint ?? ar.label}
                    </Chip>
                  ))}
                </div>
                <div className="w-px h-6 bg-white/[0.08] flex-shrink-0" />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-0.5">Res</span>
                  {RESOLUTIONS.map((r) => (
                    <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>{r}</Chip>
                  ))}
                </div>
                <div className="flex-1 flex justify-end">
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt.trim()}
                    className="relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold tracking-wide overflow-hidden transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: isGenerating
                        ? "rgba(109,40,217,0.4)"
                        : "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 50%, #4f46e5 100%)",
                      boxShadow: isGenerating
                        ? "none"
                        : "0 0 0 1px rgba(139,92,246,0.6), 0 0 20px rgba(109,40,217,0.5), 0 2px 8px rgba(0,0,0,0.4)",
                      color: "white",
                    }}
                  >
                    {!isGenerating && (
                      <span className="absolute inset-0 pointer-events-none" style={{
                        background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.12) 50%, transparent 65%)",
                      }} />
                    )}
                    {isGenerating
                      ? <Loader2 className="w-4 h-4 animate-spin relative z-10" />
                      : <Sparkles className="w-4 h-4 relative z-10" />}
                    <span className="relative z-10">
                      {isGenerating ? "Generating…" : `Generate · ${COST} cr`}
                    </span>
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5 text-right pr-1">{creditsLeft} credits available</p>
            </div>
            </div>{/* /spinning-border wrapper */}
          </div>

          {/* Mobile bar */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-20 p-3" style={{ background: BAR_BG }}>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the scene you imagine" rows={2}
              className="w-full bg-transparent text-sm text-white placeholder-slate-500 resize-none outline-none px-1 mb-2"
            />
            <div className="flex gap-2 flex-wrap mb-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest self-center">Aspect</span>
              {ASPECT_RATIOS.map((ar) => (
                <Chip key={ar.value} active={aspectRatio === ar.value} onClick={() => setAspectRatio(ar.value)}>{ar.hint ?? ar.label}</Chip>
              ))}
            </div>
            <div className="flex gap-2 items-center mb-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">Res</span>
              {RESOLUTIONS.map((r) => (
                <Chip key={r} active={resolution === r} onClick={() => setResolution(r)}>{r}</Chip>
              ))}
              <div className="flex-1" />
              <button onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white" }}>
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : `Generate · ${COST} cr`}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {lightboxGen && <Lightbox gen={lightboxGen} onClose={() => setLightboxGen(null)} />}
          </AnimatePresence>
        </>
      )}

      {/* ── Real Avatars tab ──────────────────────────────────────────────── */}
      {activeTab === "avatars" && (
        <RealAvatarsTab sidebarCollapsed={sidebarCollapsed} />
      )}
    </div>
  );
}
