import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Upload,
  Download,
  Loader2,
  Play,
  X,
  Settings,
  Sliders,
  MapPin,
  Smartphone,
  Clock,
  Film,
  Shuffle,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Image as ImageIcon,
  Volume2,
  Maximize,
  RotateCcw,
  Sun,
  Contrast,
  Droplets,
  Eye,
  Zap,
  Move,
  Grid3X3,
  FlipHorizontal,
  FlipVertical,
  Square,
  Scissors,
  Gauge,
  GitCompare,
  FileVideo,
  Hash,
  Info,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  FolderOpen,
  Search,
  History,
  Trash2,
  ExternalLink,
  Music,
  Radio,
  Thermometer,
  Cpu,
  Sparkles,
  Layers,
  ScanSearch,
  ChevronDown,
  Coins,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../services/api";
import { useAuthStore } from "../store";
import { REPURPOSE_DEVICE_OPTIONS } from "../data/repurposeDeviceOptions";
import { hasPremiumAccess } from "../utils/premiumAccess";
import { useDraft } from "../hooks/useDraft";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

if (L?.Icon?.Default?.prototype) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

const FILTER_DEFS = [
  { key: "saturation", label: "Saturation", icon: Droplets, min: 0.5, max: 1.5, step: 0.01, defMin: 0.85, defMax: 1.15, unit: "x" },
  { key: "contrast", label: "Contrast", icon: Contrast, min: 0.5, max: 2.0, step: 0.01, defMin: 0.9, defMax: 1.1, unit: "x" },
  { key: "brightness", label: "Brightness", icon: Sun, min: -0.3, max: 0.3, step: 0.01, defMin: -0.05, defMax: 0.05, unit: "" },
  { key: "gamma", label: "Gamma", icon: Eye, min: 0.5, max: 2.0, step: 0.01, defMin: 0.9, defMax: 1.1, unit: "" },
  { key: "vignette", label: "Vignette", icon: Square, min: 0, max: 1, step: 0.01, defMin: 0, defMax: 0.3, unit: "" },
  { key: "speed", label: "Speed", icon: Gauge, min: 0.5, max: 2.0, step: 0.01, defMin: 0.95, defMax: 1.05, unit: "x" },
  { key: "zoom", label: "Zoom", icon: Maximize, min: 1, max: 1.5, step: 0.01, defMin: 1.0, defMax: 1.05, unit: "x" },
  { key: "noise", label: "Noise", icon: Zap, min: 0, max: 30, step: 1, defMin: 0, defMax: 5, unit: "" },
  { key: "volume", label: "Volume", icon: Volume2, min: 0.5, max: 1.5, step: 0.01, defMin: 0.9, defMax: 1.1, unit: "x" },
  { key: "pixel_shift", label: "Pixel Shift", icon: Move, min: -5, max: 5, step: 1, defMin: -1, defMax: 1, unit: "px" },
  { key: "rotation", label: "Rotation", icon: RotateCcw, min: -5, max: 5, step: 0.1, defMin: -1, defMax: 1, unit: "deg" },
  { key: "lens_correction", label: "Lens Correction", icon: Eye, min: -0.5, max: 0.5, step: 0.01, defMin: -0.1, defMax: 0.1, unit: "" },
  { key: "framerate", label: "Frame Rate", icon: Film, min: 20, max: 60, step: 1, defMin: 28, defMax: 32, unit: "fps" },
  { key: "video_bitrate", label: "Video Bitrate", icon: Zap, min: 2000, max: 10000, step: 100, defMin: 4000, defMax: 6000, unit: "kbps" },
  { key: "audio_bitrate", label: "Audio Bitrate", icon: Volume2, min: 96, max: 320, step: 16, defMin: 160, defMax: 256, unit: "kbps" },
  { key: "cut_video", label: "Trim Start", icon: Scissors, min: 0, max: 5, step: 0.1, defMin: 0, defMax: 0.5, unit: "s" },
  { key: "cut_end_video", label: "Trim End", icon: Scissors, min: 0, max: 5, step: 0.1, defMin: 0, defMax: 0.5, unit: "s" },
  { key: "random_pixel_size", label: "Pixelate", icon: Grid3X3, min: 1, max: 6, step: 1, defMin: 1, defMax: 1, unit: "px" },
  { key: "pitch_shift", label: "Pitch Shift", icon: Music, min: 0.96, max: 1.04, step: 0.001, defMin: 0.98, defMax: 1.02, unit: "x" },
  { key: "audio_highpass", label: "Audio Highpass", icon: Radio, min: 40, max: 300, step: 5, defMin: 60, defMax: 100, unit: "Hz" },
  { key: "audio_lowpass", label: "Audio Lowpass", icon: Radio, min: 8000, max: 20000, step: 500, defMin: 14000, defMax: 18000, unit: "Hz" },
  { key: "audio_noise", label: "Audio Noise Floor", icon: Radio, min: 0.0001, max: 0.005, step: 0.0001, defMin: 0.001, defMax: 0.003, unit: "" },
  { key: "color_temp", label: "Color Temperature", icon: Thermometer, min: -0.15, max: 0.15, step: 0.01, defMin: -0.06, defMax: 0.06, unit: "" },
  { key: "keyframe_interval", label: "Keyframe Interval", icon: Cpu, min: 20, max: 200, step: 10, defMin: 40, defMax: 120, unit: "" },
  { key: "hue", label: "Hue Shift", icon: Droplets, min: -4, max: 4, step: 0.1, defMin: -2, defMax: 2, unit: "°" },
  { key: "sharpen", label: "Sharpen", icon: ScanSearch, min: 0.2, max: 2.0, step: 0.1, defMin: 0.5, defMax: 1.0, unit: "x" },
  { key: "denoise", label: "Denoise (hqdn3d)", icon: Sparkles, min: 0.5, max: 8.0, step: 0.5, defMin: 1.0, defMax: 3.0, unit: "" },
];

const TOGGLE_DEFS = [
  { key: "flip", label: "Horizontal Flip", icon: FlipHorizontal },
  { key: "vflip", label: "Vertical Flip", icon: FlipVertical },
  { key: "blurred_border", label: "Blurred Border", icon: Square },
  { key: "colorlevels", label: "Color Levels", icon: Sliders },
  { key: "deband", label: "Deband", icon: Layers },
  { key: "deflicker", label: "Deflicker", icon: Zap },
  { key: "encoder_fingerprint", label: "Encoder Fingerprint", icon: Cpu },
];


const VIDEO_ONLY_FILTER_KEYS = new Set([
  "speed", "framerate", "video_bitrate", "audio_bitrate",
  "cut_video", "cut_end_video",
  "pitch_shift", "audio_highpass", "audio_lowpass", "audio_noise",
  "temporal_blend", "deflicker", "encoder_fingerprint",
]);

const AUDIO_ONLY_FILTER_KEYS = new Set([
  "volume", "pitch_shift",
  "audio_highpass", "audio_lowpass", "audio_noise", "audio_bitrate",
]);

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function initFilterState() {
  const state = {};
  for (const f of FILTER_DEFS) {
    state[f.key] = { enabled: false, min: f.defMin, max: f.defMax };
  }
  for (const t of TOGGLE_DEFS) {
    state[t.key] = { enabled: false };
  }
  state.dimensions = { enabled: false, min_w: 1080, max_w: 1080, min_h: 1920, max_h: 1920 };
  return state;
}

function defaultDateTimeLocal() {
  const now = new Date();
  now.setSeconds(0, 0);
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function initMetaState() {
  const selected = defaultDateTimeLocal();
  return {
    device_metadata: {
      enabled: true,
      platform: "multi",
      modelKey: "",
      uniqueDevicePerCopy: false,
      deviceMode: "single",
      modelKeys: ["", "", "", "", ""],
    },
    timestamps: { enabled: true, date_taken: selected },
    gps_location: { enabled: true, mode: "pinpoint", country: "US", lat: 39.8, lng: -98.5 },
    recording_app: { enabled: true },
    audio_device: { enabled: true },
    color_profile: { enabled: true },
  };
}

function GalleryPicker({ open, onClose, onSelect }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api.get("/generations?status=completed&limit=100")
      .then(({ data }) => {
        if (cancelled) return;
        const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
        const vids = (data.generations || data || []).filter(
          (g) => (g.type === "video" || g.type === "prompt-video" || g.type === "face-swap") &&
            g.outputUrl && g.status === "completed" &&
            videoExts.some((ext) => g.outputUrl.toLowerCase().includes(ext))
        );
        setVideos(vids);
      })
      .catch(() => { if (!cancelled) toast.error("Failed to load gallery"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const filtered = searchTerm
    ? videos.filter((v) => (v.prompt || "").toLowerCase().includes(searchTerm.toLowerCase()))
    : videos;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="gallery-picker-modal">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl overflow-hidden flex flex-col" style={{ background: "rgb(20,20,30)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-white" />
            Select from Gallery
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors" data-testid="button-close-gallery">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by prompt..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-white/40"
              data-testid="input-gallery-search"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <FileVideo className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-500">{videos.length === 0 ? "No video generations found" : "No matching videos"}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filtered.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { onSelect(v); onClose(); }}
                  className="group relative rounded-lg overflow-hidden bg-black/30 border border-white/5 hover:border-white/40 transition-all duration-200"
                  data-testid={`gallery-item-${v.id}`}
                >
                  <video
                    src={v.outputUrl}
                    className="w-full h-28 object-cover"
                    muted
                    preload="metadata"
                    onMouseEnter={(e) => e.target.play().catch(() => {})}
                    onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[10px] text-white/80 line-clamp-2">{v.prompt || "Untitled"}</p>
                  </div>
                  <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-slate-300">
                    {v.type}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function fetchVideoAsFile(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch video (${response.status})`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("Downloaded file is empty");
  const type = blob.type || "video/mp4";
  return new File([blob], filename || "gallery-video.mp4", { type });
}

function FilterCard({ def, state, onChange }) {
  const { enabled, min, max } = state || { enabled: false, min: def.defMin, max: def.defMax };
  return (
    <div
      className={`rounded-lg p-3 transition-all duration-200 ${
        enabled
          ? "bg-white/10 border border-white/35"
          : "bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1]"
      }`}
      data-testid={`filter-card-${def.key}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <def.icon className={`w-3.5 h-3.5 ${enabled ? "text-white" : "text-slate-500"}`} />
          <span className={`text-xs font-medium ${enabled ? "text-white" : "text-slate-400"}`}>{def.label}</span>
        </div>
        <button
          onClick={() => onChange({ ...state, enabled: !enabled })}
          className={`w-8 h-[18px] p-0 rounded-full transition-all duration-200 flex items-center ${
            enabled ? "bg-white/90" : "bg-white/15"
          }`}
          data-testid={`toggle-${def.key}`}
        >
          <div
            className={`w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${
              enabled ? "bg-black" : "bg-white"
            } ${
              enabled ? "translate-x-[16px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {enabled && (
        <div className="space-y-1.5 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-7">Min</span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={min}
              onChange={(e) => onChange({ ...state, min: parseFloat(e.target.value) })}
              className="flex-1 h-1 accent-white"
              data-testid={`range-min-${def.key}`}
            />
            <span className="text-[10px] text-white/80 w-14 text-right font-mono">
              {Number(min).toFixed(def.step < 1 ? 2 : 0)}
              {def.unit}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-7">Max</span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={max}
              onChange={(e) => onChange({ ...state, max: parseFloat(e.target.value) })}
              className="flex-1 h-1 accent-white"
              data-testid={`range-max-${def.key}`}
            />
            <span className="text-[10px] text-white/80 w-14 text-right font-mono">
              {Number(max).toFixed(def.step < 1 ? 2 : 0)}
              {def.unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleCard({ def, state, onChange }) {
  const { enabled } = state || { enabled: false };
  return (
    <div
      className={`rounded-lg p-3 flex items-center justify-between transition-all duration-200 ${
        enabled
          ? "bg-white/10 border border-white/35"
          : "bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.1]"
      }`}
      data-testid={`toggle-card-${def.key}`}
    >
      <div className="flex items-center gap-2">
        <def.icon className={`w-3.5 h-3.5 ${enabled ? "text-white" : "text-slate-500"}`} />
        <span className={`text-xs font-medium ${enabled ? "text-white" : "text-slate-400"}`}>{def.label}</span>
      </div>
      <button
        onClick={() => onChange({ ...state, enabled: !enabled })}
        className={`w-8 h-[18px] p-0 rounded-full transition-all duration-200 flex items-center ${
          enabled ? "bg-white/90" : "bg-white/15"
        }`}
        data-testid={`toggle-${def.key}`}
      >
        <div
          className={`w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${
            enabled ? "bg-black" : "bg-white"
          } ${
            enabled ? "translate-x-[16px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}


function VerdictBadge({ verdict }) {
  const config = {
    IDENTICAL: { color: "text-red-400 bg-red-500/10 border-red-500/30", label: "Identical", icon: ShieldAlert },
    VISUALLY_IDENTICAL: { color: "text-red-400 bg-red-500/10 border-red-500/30", label: "Visually Identical", icon: ShieldAlert },
    VERY_SIMILAR: { color: "text-orange-400 bg-orange-500/10 border-orange-500/30", label: "Very Similar", icon: AlertTriangle },
    SIMILAR: { color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30", label: "Similar", icon: AlertTriangle },
    SOMEWHAT_SIMILAR: { color: "text-blue-400 bg-blue-500/10 border-blue-500/30", label: "Somewhat Similar", icon: Info },
    DIFFERENT: { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", label: "Different", icon: ShieldCheck },
  };
  const c = config[verdict] || config.DIFFERENT;
  const Icon = c.icon;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold ${c.color}`} data-testid="badge-verdict">
      <Icon className="w-4 h-4" />
      {c.label}
    </div>
  );
}

function CompareRow({ label, valueA, valueB, highlight }) {
  const diff = valueA !== valueB;
  return (
    <div className={`grid grid-cols-3 gap-2 py-1.5 px-2 rounded text-xs ${diff && highlight ? "bg-emerald-500/5" : ""}`}>
      <span className="text-slate-400 font-medium">{label}</span>
      <span className="text-slate-200 font-mono truncate" title={String(valueA)}>{String(valueA ?? "-")}</span>
      <span className={`font-mono truncate ${diff ? "text-cyan-300" : "text-slate-200"}`} title={String(valueB)}>{String(valueB ?? "-")}</span>
    </div>
  );
}

function normalizeComparisonResult(raw) {
  const toNum = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  if (!raw || typeof raw !== "object") return null;
  const fileA = raw.file?.videoA || {};
  const fileB = raw.file?.videoB || {};
  const videoA = raw.video?.videoA || {};
  const videoB = raw.video?.videoB || {};
  const audioA = raw.audio?.videoA || {};
  const audioB = raw.audio?.videoB || {};
  const scores = raw.scores || {};
  return {
    verdict: typeof raw.verdict === "string" ? raw.verdict : "DIFFERENT",
    exact_match: !!raw.exact_match,
    is_image_comparison: !!raw.is_image_comparison,
    overall_similarity: Math.max(0, Math.min(1, toNum(raw.overall_similarity, 0))),
    ssim: raw.ssim == null ? null : toNum(raw.ssim, 0),
    psnr: raw.psnr === "inf" ? "inf" : (raw.psnr == null ? null : toNum(raw.psnr, 0)),
    file: {
      videoA: { ...fileA, hash: fileA.hash == null ? null : String(fileA.hash), size: toNum(fileA.size, 0) },
      videoB: { ...fileB, hash: fileB.hash == null ? null : String(fileB.hash), size: toNum(fileB.size, 0) },
      size_diff_percent: toNum(raw.file?.size_diff_percent, 0),
    },
    video: { videoA: { ...videoA, duration: toNum(videoA.duration, 0), bitrate: toNum(videoA.bitrate, 0) }, videoB: { ...videoB, duration: toNum(videoB.duration, 0), bitrate: toNum(videoB.bitrate, 0) } },
    audio: { videoA: { ...audioA }, videoB: { ...audioB } },
    scores: {
      ssim: toNum(scores.ssim, 0),
      psnr: toNum(scores.psnr, 0),
      duration: toNum(scores.duration, 0),
      filesize: toNum(scores.filesize, 0),
      stream: toNum(scores.stream, 0),
      metadata: toNum(scores.metadata, 0),
      phash: scores.phash == null ? null : toNum(scores.phash, 0),
    },
    metadata_diffs: Array.isArray(raw.metadata_diffs) ? raw.metadata_diffs : [],
  };
}

function getSafeErrorText(input, fallback = "Comparison failed") {
  if (!input) return fallback;
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (typeof input === "object") {
    if (typeof input.message === "string" && input.message.trim()) return input.message;
    if (typeof input.error === "string" && input.error.trim()) return input.error;
    if (input.code && input.message) return `${String(input.code)}: ${String(input.message)}`;
  }
  return fallback;
}

class CompareTabBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error("[CompareTabBoundary]", error?.message, info?.componentStack);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4">
        <p className="text-sm text-red-200">Compare panel crashed on this result. Try again with smaller files.</p>
      </div>
    );
  }
}

function VideoComparer() {
  const [videoA, setVideoA] = useState(null);
  const [videoB, setVideoB] = useState(null);
  const [previewA, setPreviewA] = useState(null);
  const [previewB, setPreviewB] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState(null);
  const [gallerySlot, setGallerySlot] = useState(null);
  const [loadingGallery, setLoadingGallery] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const refA = useRef(null);
  const refB = useRef(null);

  useEffect(() => {
    return () => {
      if (previewA) URL.revokeObjectURL(previewA);
      if (previewB) URL.revokeObjectURL(previewB);
    };
  }, []);

  const [isImageA, setIsImageA] = useState(false);
  const [isImageB, setIsImageB] = useState(false);
  const [thumbA, setThumbA] = useState(null);
  const [thumbB, setThumbB] = useState(null);
  const [playingSlot, setPlayingSlot] = useState(null);
  const videoRefA = useRef(null);
  const videoRefB = useRef(null);

  const isMediaFile = (file) => {
    if (file.type && (file.type.startsWith("video/") || file.type.startsWith("image/"))) return true;
    const ext = file.name?.toLowerCase()?.split(".").pop();
    return ["mp4", "mov", "webm", "avi", "mkv", "jpg", "jpeg", "png", "webp"].includes(ext);
  };

  const isImageType = (file) => {
    if (file.type?.startsWith("image/")) return true;
    const ext = file.name?.toLowerCase()?.split(".").pop();
    return ["jpg", "jpeg", "png", "webp"].includes(ext);
  };

  const handleFile = useCallback((file, slot) => {
    if (!file || !isMediaFile(file)) {
      toast.error("Please select a video or image file (MP4, MOV, JPG, PNG, WebP)");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("File too large (max 500MB)");
      return;
    }
    const isImg = isImageType(file);
    const url = URL.createObjectURL(file);
    if (slot === "A") {
      if (previewA) URL.revokeObjectURL(previewA);
      setVideoA(file);
      setPreviewA(url);
      setIsImageA(isImg);
      setThumbA(null);
    } else {
      if (previewB) URL.revokeObjectURL(previewB);
      setVideoB(file);
      setPreviewB(url);
      setIsImageB(isImg);
      setThumbB(null);
    }
    setResult(null);
    setPlayingSlot(null);
  }, [previewA, previewB]);

  const handleGallerySelect = useCallback(async (gen, slot) => {
    setLoadingGallery(slot);
    try {
      const file = await fetchVideoAsFile(gen.outputUrl, `gallery-${gen.id}.mp4`);
      handleFile(file, slot);
    } catch {
      toast.error("Failed to load video from gallery");
    } finally {
      setLoadingGallery(null);
    }
  }, [handleFile]);

  const handleDrop = useCallback((e, slot) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file, slot);
  }, [handleFile]);

  const handleDragOver = useCallback((e, slot) => {
    e.preventDefault();
    setDragOver(slot);
  }, []);

  const handleCompare = useCallback(async () => {
    if (!videoA || !videoB) {
      toast.error("Upload both files to compare");
      return;
    }
    setComparing(true);
    setResult(null);
    const formData = new FormData();
    formData.append("videoA", videoA);
    formData.append("videoB", videoB);

    const uploadForCompare = async (file) => {
      const contentType = file?.type || "application/octet-stream";
      const prep = await api.post("/upload/presign", { contentType, folder: "uploads" });
      const uploadUrl = prep?.data?.uploadUrl;
      const publicUrl = prep?.data?.publicUrl;
      if (!uploadUrl || !publicUrl) throw new Error("Could not get upload URL for compare.");
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      return publicUrl;
    };

    try {
      const { data } = await api.post("/video-repurpose/compare", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      const comp = data?.comparison;
      if (data?.ok && comp && typeof comp === "object" && comp.file && comp.scores && comp.video && comp.audio) {
        setResult(normalizeComparisonResult(comp));
      } else {
        toast.error(getSafeErrorText(data?.error, "Comparison failed"));
      }
    } catch (err) {
      const apiError = err?.response?.data?.error ?? err?.response?.data ?? err?.message;
      const tooLarge = err?.response?.status === 413 || String(getSafeErrorText(apiError, "")).toUpperCase().includes("FUNCTION_PAYLOAD_TOO_LARGE");
      if (tooLarge) {
        try {
          const [fileAUrl, fileBUrl] = await Promise.all([
            uploadForCompare(videoA),
            uploadForCompare(videoB),
          ]);
          const { data } = await api.post("/video-repurpose/compare-url", {
            fileAUrl,
            fileBUrl,
            fileAName: videoA?.name || "fileA.mp4",
            fileBName: videoB?.name || "fileB.mp4",
            mimeA: videoA?.type || "",
            mimeB: videoB?.type || "",
          }, { timeout: 180000 });
          const comp = data?.comparison;
          if (data?.ok && comp && typeof comp === "object" && comp.file && comp.scores && comp.video && comp.audio) {
            setResult(normalizeComparisonResult(comp));
          } else {
            toast.error(getSafeErrorText(data?.error, "Comparison failed"));
          }
        } catch (fallbackErr) {
          const fbError = fallbackErr?.response?.data?.error ?? fallbackErr?.response?.data ?? fallbackErr?.message;
          toast.error(getSafeErrorText(fbError, "Comparison failed"));
        }
      } else {
        toast.error(getSafeErrorText(apiError, "Comparison failed"));
      }
    } finally {
      setComparing(false);
    }
  }, [videoA, videoB]);

  const handleClear = useCallback(() => {
    if (previewA) URL.revokeObjectURL(previewA);
    if (previewB) URL.revokeObjectURL(previewB);
    setVideoA(null);
    setVideoB(null);
    setPreviewA(null);
    setPreviewB(null);
    setIsImageA(false);
    setIsImageB(false);
    setThumbA(null);
    setThumbB(null);
    setPlayingSlot(null);
    setResult(null);
  }, [previewA, previewB]);

  const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const ssimPercent = (ssim) => ssim !== null ? `${(ssim * 100).toFixed(2)}%` : "N/A";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {["A", "B"].map((slot) => {
          const file = slot === "A" ? videoA : videoB;
          const preview = slot === "A" ? previewA : previewB;
          const isImg = slot === "A" ? isImageA : isImageB;
          const thumb = slot === "A" ? thumbA : thumbB;
          const inputRef = slot === "A" ? refA : refB;
          const vidRef = slot === "A" ? videoRefA : videoRefB;
          const isLoading = loadingGallery === slot;
          const isDraggedOver = dragOver === slot;
          const isPlaying = playingSlot === slot;
          return (
            <div key={slot} className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">File {slot}</span>
              {isLoading ? (
                <div className="w-full aspect-square border border-dashed border-white/20 rounded-md flex flex-col items-center justify-center gap-1.5 bg-white/[0.02]">
                  <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
                  <span className="text-[10px] text-white/50">Loading...</span>
                </div>
              ) : !file ? (
                <div className="space-y-1.5">
                  <div
                    onDrop={(e) => handleDrop(e, slot)}
                    onDragOver={(e) => handleDragOver(e, slot)}
                    onDragLeave={() => setDragOver(null)}
                    onClick={() => inputRef.current?.click()}
                    className={`w-full aspect-square border border-dashed rounded-md flex flex-col items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer ${
                      isDraggedOver
                        ? "border-white/40 bg-white/[0.06]"
                        : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
                    }`}
                    data-testid={`button-compare-upload-${slot.toLowerCase()}`}
                  >
                    <Upload className="w-5 h-5 text-slate-500" />
                    <span className="text-[10px] text-slate-400">Drop file here</span>
                    <span className="text-[9px] text-slate-600">MP4 · MOV · JPG · PNG</span>
                  </div>
                  <button
                    onClick={() => setGallerySlot(slot)}
                    className="w-full py-1.5 rounded-md border border-white/8 text-[10px] text-slate-500 hover:text-slate-300 hover:border-white/15 transition-colors flex items-center justify-center gap-1.5"
                    data-testid={`button-compare-gallery-${slot.toLowerCase()}`}
                  >
                    <FolderOpen className="w-3 h-3" />
                    Gallery
                  </button>
                </div>
              ) : (
                <div className="relative group">
                  <div className="w-full aspect-square rounded-md bg-black flex items-center justify-center overflow-hidden">
                    {isImg
                      ? <img src={preview} className="max-w-full max-h-full object-contain" alt={file.name} />
                      : <video src={preview} className="max-w-full max-h-full object-contain" controls playsInline />
                    }
                  </div>
                  <button
                    onClick={() => {
                      if (slot === "A") { if (previewA) URL.revokeObjectURL(previewA); setVideoA(null); setPreviewA(null); setIsImageA(false); }
                      else { if (previewB) URL.revokeObjectURL(previewB); setVideoB(null); setPreviewB(null); setIsImageB(false); }
                      setResult(null);
                    }}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/70 text-white/60 hover:text-white z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                    data-testid={`button-remove-compare-${slot.toLowerCase()}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <p className="mt-1 text-[9px] text-slate-500 truncate">{file.name}</p>
                </div>
              )}
              <input ref={inputRef} type="file" accept="video/*,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleFile(e.target.files?.[0], slot)} />
            </div>
          );
        })}
      </div>

      {gallerySlot !== null && (
        <GalleryPicker
          open={true}
          onClose={() => setGallerySlot(null)}
          onSelect={(gen) => { const s = gallerySlot; setGallerySlot(null); handleGallerySelect(gen, s); }}
        />
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleCompare}
          disabled={!videoA || !videoB || comparing}
          className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 active:scale-[0.98] shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
          data-testid="button-compare"
        >
          {comparing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <GitCompare className="w-4 h-4" />
              Compare
            </>
          )}
        </button>
        {(videoA || videoB || result) && (
          <button
            onClick={handleClear}
            className="px-4 py-3 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
            data-testid="button-clear-compare"
          >
            Clear
          </button>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-cyan-400" />
                Comparison Result
              </h3>
              <VerdictBadge verdict={result.verdict ?? "UNKNOWN"} />
            </div>

            {/* Overall similarity — primary metric */}
            <div className="rounded-lg p-4 mb-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Overall Similarity Score</p>
              <div className="flex items-end gap-3 mb-2">
                <span
                  className="text-4xl font-bold"
                  style={{ color: (result.overall_similarity ?? 0) >= 0.85 ? "#ef4444" : (result.overall_similarity ?? 0) >= 0.70 ? "#f59e0b" : (result.overall_similarity ?? 0) >= 0.50 ? "#3b82f6" : "#10b981" }}
                  data-testid="text-overall-similarity"
                >
                  {((result.overall_similarity ?? 0) * 100).toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500 mb-1">weighted across all layers — lower is better</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${(result.overall_similarity ?? 0) * 100}%`,
                    background: (result.overall_similarity ?? 0) >= 0.85 ? "#ef4444" : (result.overall_similarity ?? 0) >= 0.70 ? "#f59e0b" : (result.overall_similarity ?? 0) >= 0.50 ? "#3b82f6" : "#10b981",
                  }}
                />
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5">
                {result.is_image_comparison
                  ? "SSIM 30% · PSNR 10% · pHash 30% · File Size 5% · Metadata 25%"
                  : "SSIM 30% · PSNR 10% · Duration 5% · File Size 5% · Encoder Params 30% · Metadata 20%"}
              </p>
            </div>

            {/* Component breakdown */}
            {result.scores && (
              <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Score Breakdown</p>
                <div className="space-y-2">
                  {(result.is_image_comparison ? [
                    { label: "Visual (SSIM)", val: result.scores.ssim ?? 0.5, weight: "30%", raw: result.ssim != null ? `${(result.ssim * 100).toFixed(2)}%` : "N/A" },
                    { label: "Signal (PSNR)", val: result.scores.psnr ?? 0.5, weight: "10%", raw: result.psnr === "inf" ? "∞ dB" : result.psnr != null ? `${result.psnr} dB` : "N/A" },
                    { label: "Perceptual Hash", val: result.scores.phash ?? 0.5, weight: "30%", raw: result.scores.phash != null ? `${((result.scores.phash ?? 0) * 100).toFixed(0)}% match` : "N/A" },
                    { label: "File size diff", val: result.scores.filesize ?? 0.5, weight: "5%", raw: `${result.file?.size_diff_percent ?? 0}% off` },
                    { label: "Metadata", val: result.scores.metadata ?? 0.5, weight: "25%", raw: `${((result.scores.metadata ?? 0) * 100).toFixed(0)}% match` },
                  ] : [
                    { label: "Visual (SSIM)", val: result.scores.ssim ?? 0.5, weight: "30%", raw: result.ssim != null ? `${(result.ssim * 100).toFixed(2)}%` : "N/A" },
                    { label: "Signal (PSNR)", val: result.scores.psnr ?? 0.5, weight: "10%", raw: result.psnr === "inf" ? "∞ dB" : result.psnr != null ? `${result.psnr} dB` : "N/A" },
                    { label: "Duration diff", val: result.scores.duration ?? 0.5, weight: "5%", raw: `${((1 - (result.scores.duration ?? 0)) * 100).toFixed(1)}% off` },
                    { label: "File size diff", val: result.scores.filesize ?? 0.5, weight: "5%", raw: `${result.file?.size_diff_percent ?? 0}% off` },
                    { label: "Encoder params", val: result.scores.stream ?? 0.5, weight: "30%", raw: `${((result.scores.stream ?? 0) * 100).toFixed(0)}% match` },
                    { label: "Metadata", val: result.scores.metadata ?? 0.5, weight: "20%", raw: `${((result.scores.metadata ?? 0) * 100).toFixed(0)}% match` },
                  ]).map(({ label, val, weight, raw }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 w-28 shrink-0">{label}</span>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${val * 100}%`,
                            background: val >= 0.85 ? "#ef4444" : val >= 0.65 ? "#f59e0b" : "#10b981",
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 w-20 text-right shrink-0">{raw}</span>
                      <span className="text-[10px] text-slate-600 w-6 shrink-0">{weight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="grid grid-cols-3 gap-2 pb-1.5 mb-1.5 border-b border-white/5">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Property</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">File A</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">File B</span>
              </div>
              <CompareRow label="File Hash (MD5)" valueA={result.file?.videoA?.hash ? String(result.file.videoA.hash).slice(0, 12) + "…" : "—"} valueB={result.file?.videoB?.hash ? String(result.file.videoB.hash).slice(0, 12) + "…" : "—"} highlight />
              <CompareRow label="File Size" valueA={formatSize(result.file?.videoA?.size ?? 0)} valueB={formatSize(result.file?.videoB?.size ?? 0)} highlight />
              <CompareRow label="Duration" valueA={(result.video?.videoA?.duration ?? 0) > 0.01 ? `${(result.video.videoA.duration ?? 0).toFixed(2)}s` : "N/A"} valueB={(result.video?.videoB?.duration ?? 0) > 0.01 ? `${(result.video.videoB.duration ?? 0).toFixed(2)}s` : "N/A"} highlight />
              <CompareRow label="Resolution" valueA={result.video?.videoA?.resolution ?? "?"} valueB={result.video?.videoB?.resolution ?? "?"} highlight />
              <CompareRow label="Profile / Level" valueA={`${result.video?.videoA?.profile ?? "?"} / ${result.video?.videoA?.level ?? "?"}`} valueB={`${result.video?.videoB?.profile ?? "?"} / ${result.video?.videoB?.level ?? "?"}`} highlight />
              <CompareRow label="Frame Rate" valueA={result.video?.videoA?.framerate ?? "?"} valueB={result.video?.videoB?.framerate ?? "?"} highlight />
              <CompareRow label="Bitrate" valueA={result.video?.videoA?.bitrate ? `${Math.round(result.video.videoA.bitrate / 1000)} kbps` : "?"} valueB={result.video?.videoB?.bitrate ? `${Math.round(result.video.videoB.bitrate / 1000)} kbps` : "?"} highlight />
              <CompareRow label="Color Primaries" valueA={result.video?.videoA?.color_primaries ?? "?"} valueB={result.video?.videoB?.color_primaries ?? "?"} highlight />
              <CompareRow label="Color Range" valueA={result.video?.videoA?.color_range ?? "?"} valueB={result.video?.videoB?.color_range ?? "?"} highlight />
              <CompareRow label="Video Handler" valueA={result.video?.videoA?.handler ?? "?"} valueB={result.video?.videoB?.handler ?? "?"} highlight />
              <CompareRow label="Audio Sample Rate" valueA={result.audio?.videoA?.sample_rate ?? "?"} valueB={result.audio?.videoB?.sample_rate ?? "?"} highlight />
              <CompareRow label="Audio Handler" valueA={result.audio?.videoA?.handler ?? "?"} valueB={result.audio?.videoB?.handler ?? "?"} highlight />
            </div>
          </div>

          {Array.isArray(result.metadata_diffs) && result.metadata_diffs.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Hash className="w-4 h-4 text-white" />
                Metadata Differences ({result.metadata_diffs.length})
              </h3>
              <div className="space-y-0.5">
                <div className="grid grid-cols-3 gap-2 pb-1.5 mb-1.5 border-b border-white/5 px-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Field</span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Video A</span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Video B</span>
                </div>
                {result.metadata_diffs.map((d) => (
                  <CompareRow key={d.field} label={d.field} valueA={d.videoA} valueB={d.videoB} highlight />
                ))}
              </div>
            </div>
          )}

          {(!Array.isArray(result.metadata_diffs) || result.metadata_diffs.length === 0) && !result.exact_match && (
            <div className="rounded-xl p-3 bg-amber-500/5 border border-amber-500/10">
              <p className="text-xs text-amber-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                No metadata differences detected. Consider enabling metadata spoofing for better uniqueness.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VideoRepurposerPage({ embedded }) {
  const { user, refreshUserCredits } = useAuthStore();
  const hasSubscription = hasPremiumAccess(user);
  const [activeTab, setActiveTab] = useState("repurpose");
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [inputIsImage, setInputIsImage] = useState(false);
  const [inputHasAudio, setInputHasAudio] = useState(true);
  const [watermarkFile, setWatermarkFile] = useState(null);
  const [copies, setCopies] = useState(1);
  const [filters, setFilters] = useState(initFilterState);
  const [metadata, setMetadata] = useState(initMetaState);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [outputs, setOutputs] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [queuePosition, setQueuePosition] = useState(0);
  const [showMetadata, setShowMetadata] = useState(false);
  /** When false, server applies smart filter pack (+10 credits). When true, manual filters (no AI credit). */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [locationResults, setLocationResults] = useState([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [customPresets, setCustomPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("repurposer_custom_presets") || "[]"); } catch { return []; }
  });
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState("");
  const [loadingFromGallery, setLoadingFromGallery] = useState(false);
  const [historyJobs, setHistoryJobs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [deletingJobId, setDeletingJobId] = useState(null);
  const fileInputRef = useRef(null);
  const wmInputRef = useRef(null);
  const pollRef = useRef(null);
  const draftRestoredRef = useRef(false);
  const initialLoadDoneRef = useRef(false);
  const { draft, isLoading: draftLoading, saveDraft, clearDraft } = useDraft("repurposer");

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get("/video-repurpose/history");
      setHistoryJobs(res.data.jobs || []);
      if (res.data.limit) setHistoryLimit(res.data.limit);
    } catch {
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "history") fetchHistory();
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    };
  }, []);

  useEffect(() => {
    if (draftRestoredRef.current || draftLoading || !draft?.data) {
      if (!draftLoading) {
        draftRestoredRef.current = true;
        initialLoadDoneRef.current = true;
      }
      return;
    }
    draftRestoredRef.current = true;
    const d = draft.data;
    if (d.filters) setFilters(d.filters);
    if (d.metadata) {
      const m = { ...d.metadata };
      const dm = { ...initMetaState().device_metadata, ...(m.device_metadata || {}) };
      if (!dm.deviceMode) dm.deviceMode = dm.uniqueDevicePerCopy ? "random_unique" : "single";
      if (!Array.isArray(dm.modelKeys)) dm.modelKeys = ["", "", "", "", ""];
      else dm.modelKeys = [...dm.modelKeys, "", "", "", "", ""].slice(0, 5);
      m.device_metadata = dm;
      setMetadata(m);
    }
    if (typeof d.copies === "number") setCopies(Math.max(1, Math.min(5, d.copies)));
    if (typeof d.advancedOpen === "boolean") setAdvancedOpen(d.advancedOpen);
    setTimeout(() => { initialLoadDoneRef.current = true; }, 0);
  }, [draft, draftLoading]);

  useEffect(() => {
    if (!initialLoadDoneRef.current) return;
    saveDraft({ filters, metadata, copies, advancedOpen });
  }, [filters, metadata, copies, advancedOpen, saveDraft]);

  const filteredDeviceOptions = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    if (!q) return REPURPOSE_DEVICE_OPTIONS;
    return REPURPOSE_DEVICE_OPTIONS.filter((o) => o.searchText.includes(q) || o.label.toLowerCase().includes(q));
  }, [deviceSearch]);

  const MAX_VIDEO_DURATION = 60;

  const detectVideoMeta = useCallback((blobUrl, file) => {
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.src = blobUrl;
    vid.onloadedmetadata = () => {
      if (vid.audioTracks) {
        setInputHasAudio(vid.audioTracks.length > 0);
      } else {
        setInputHasAudio(true);
      }
      if (vid.duration > MAX_VIDEO_DURATION) {
        URL.revokeObjectURL(blobUrl);
        setVideoFile(null);
        setVideoPreview(null);
        setInputHasAudio(true);
        if (fileInputRef.current) fileInputRef.current.value = "";
        toast.error(`Video is too long. Maximum is ${MAX_VIDEO_DURATION}s. Your video is ${Math.round(vid.duration)}s.`);
      }
      vid.src = "";
    };
    vid.onerror = () => setInputHasAudio(true);
  }, []);

  const handleVideoSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVid = file.type.startsWith("video/");
    const isImg = file.type.startsWith("image/");
    if (!isVid && !isImg) {
      toast.error("Please select a video or image file");
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      toast.error("File must be under 200MB");
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setInputIsImage(isImg);
    setInputHasAudio(true);
    setVideoPreview(blobUrl);
    setOutputs([]);
    setJobId(null);
    setJobStatus(null);
    if (isVid) detectVideoMeta(blobUrl, file);
  }, [detectVideoMeta]);

  const handleGallerySelectRepurpose = useCallback(async (gen) => {
    setLoadingFromGallery(true);
    try {
      const file = await fetchVideoAsFile(gen.outputUrl, `gallery-${gen.id}.mp4`);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setVideoFile(file);
      setVideoPreview(URL.createObjectURL(file));
      setOutputs([]);
      setJobId(null);
      setJobStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      toast.error("Failed to load video from gallery");
    } finally {
      setLoadingFromGallery(false);
    }
  }, [videoPreview]);

  const handleWatermarkSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) setWatermarkFile(file);
  }, []);

  const removeVideo = useCallback(() => {
    setVideoFile(null);
    setInputIsImage(false);
    setInputHasAudio(true);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoPreview(null);
    setOutputs([]);
    setJobId(null);
    setJobStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [videoPreview]);

  const updateFilter = useCallback((key, val) => {
    setFilters((prev) => ({ ...prev, [key]: val }));
  }, []);

  const updateMeta = useCallback((key, val) => {
    setMetadata((prev) => ({ ...prev, [key]: val }));
  }, []);

  const enableAllFilters = useCallback(() => {
    setFilters((prev) => {
      const next = { ...prev };
      for (const f of FILTER_DEFS) next[f.key] = { ...next[f.key], enabled: true };
      for (const t of TOGGLE_DEFS) next[t.key] = { ...next[t.key], enabled: true };
      return next;
    });
  }, []);

  const disableAllFilters = useCallback(() => {
    setFilters(initFilterState());
  }, []);

  const saveCustomPreset = useCallback(() => {
    const name = presetNameInput.trim() || `Custom ${customPresets.length + 1}`;
    const newPreset = { name, filters, metadata };
    const updated = customPresets.length >= 2
      ? [...customPresets.slice(1), newPreset]
      : [...customPresets, newPreset];
    setCustomPresets(updated);
    localStorage.setItem("repurposer_custom_presets", JSON.stringify(updated));
    setSavingPreset(false);
    setPresetNameInput("");
    toast.success(`Preset "${name}" saved`);
  }, [customPresets, filters, metadata, presetNameInput]);

  const deleteCustomPreset = useCallback((idx) => {
    const updated = customPresets.filter((_, i) => i !== idx);
    setCustomPresets(updated);
    localStorage.setItem("repurposer_custom_presets", JSON.stringify(updated));
    toast.success("Preset deleted");
  }, [customPresets]);

  const loadCustomPreset = useCallback((preset) => {
    setFilters(preset.filters);
    setMetadata(preset.metadata);
    toast.success(`Loaded preset "${preset.name}"`);
  }, []);

  const applyInputContext = useCallback((filterObj) => {
    const result = { ...filterObj };
    if (inputIsImage) {
      result.temporal_blend = { ...result.temporal_blend, enabled: false };
      result.speed = { ...result.speed, enabled: false };
      result.framerate = { ...result.framerate, enabled: false };
      result.cut_video = { ...result.cut_video, enabled: false };
      result.cut_end_video = { ...result.cut_end_video, enabled: false };
      result.pitch_shift = { ...result.pitch_shift, enabled: false };
      result.audio_highpass = { ...result.audio_highpass, enabled: false };
      result.audio_lowpass = { ...result.audio_lowpass, enabled: false };
      result.audio_noise = { ...result.audio_noise, enabled: false };
      result.audio_bitrate = { ...result.audio_bitrate, enabled: false };
      result.volume = { ...result.volume, enabled: false };
    }
    if (!inputHasAudio) {
      result.volume = { ...result.volume, enabled: false };
      result.pitch_shift = { ...result.pitch_shift, enabled: false };
      result.audio_highpass = { ...result.audio_highpass, enabled: false };
      result.audio_lowpass = { ...result.audio_lowpass, enabled: false };
      result.audio_noise = { ...result.audio_noise, enabled: false };
      result.audio_bitrate = { ...result.audio_bitrate, enabled: false };
    }
    return result;
  }, [inputIsImage, inputHasAudio]);

  const randomAllSafe = useCallback(() => {
    const safe = {
      // ── ENCODER LEVEL (100% invisible, max file-fingerprint impact) ──
      encoder_fingerprint: { enabled: true },
      keyframe_interval: { enabled: true, min: 60, max: 120 },
      video_bitrate: { enabled: true, min: 4500, max: 6500 },
      audio_bitrate: { enabled: true, min: 160, max: 256 },
      // ── PIXEL LEVEL (barely perceptible — each shift changes every pixel value) ──
      colorlevels: { enabled: true },
      hue: { enabled: true, min: -1.5, max: 1.5 },
      saturation: { enabled: true, min: 0.978, max: 1.022 },
      contrast: { enabled: true, min: 0.982, max: 1.018 },
      brightness: { enabled: true, min: -0.008, max: 0.008 },
      gamma: { enabled: true, min: 0.978, max: 1.022 },
      color_temp: { enabled: true, min: -0.018, max: 0.018 },
      zoom: { enabled: true, min: 1.004, max: 1.012 },
      // ── AUDIO FINGERPRINT (completely inaudible) ──
      pitch_shift: { enabled: true, min: 0.997, max: 1.003 },
      audio_highpass: { enabled: true, min: 70, max: 80 },
      audio_lowpass: { enabled: true, min: 18500, max: 20000 },
      audio_noise: { enabled: true, min: 0.0001, max: 0.0004 },
      volume: { enabled: true, min: 0.985, max: 1.015 },
      // ── QUALITY + SSIM impact (denoise/sharpen changes per-pixel values) ──
      deband: { enabled: true },
      denoise: { enabled: true, min: 2.0, max: 4.0 },
      sharpen: { enabled: true, min: 0.4, max: 0.7 },
      // ── TEMPORAL DESYNC (biggest SSIM mover — even 100ms offset misaligns all frames) ──
      speed: { enabled: true, min: 0.996, max: 1.004 },
      cut_video: { enabled: true, min: 0.05, max: 0.15 },
      cut_end_video: { enabled: true, min: 0.03, max: 0.10 },
      framerate: { enabled: false, min: 28, max: 32 },
      deflicker: { enabled: true },
      // ── VISIBLE EFFECTS (all off) ──
      flip: { enabled: false }, vflip: { enabled: false },
      noise: { enabled: false, min: 1, max: 3 },
      vignette: { enabled: false, min: 0, max: 0.2 },
      rotation: { enabled: false, min: -1, max: 1 },
      pixel_shift: { enabled: false, min: -2, max: 2 },
      lens_correction: { enabled: false, min: -0.1, max: 0.1 },
      blurred_border: { enabled: false },
      random_pixel_size: { enabled: false, min: 1, max: 1 },
      dimensions: { enabled: false, min_w: 1080, max_w: 1080, min_h: 1920, max_h: 1920 },
    };
    setFilters(applyInputContext(safe));
    setMetadata(initMetaState());
    toast.success("Safe preset loaded");
  }, [applyInputContext]);

  const randomAllAggressive = useCallback(() => {
    const aggressive = {
      // ── ENCODER LEVEL ──
      encoder_fingerprint: { enabled: true },
      keyframe_interval: { enabled: true, min: 40, max: 100 },
      video_bitrate: { enabled: true, min: 3500, max: 7500 },
      audio_bitrate: { enabled: true, min: 128, max: 320 },
      // ── PIXEL LEVEL (stronger — targets 60-70% SSIM while still looking identical) ──
      colorlevels: { enabled: true },
      hue: { enabled: true, min: -3.0, max: 3.0 },
      saturation: { enabled: true, min: 0.955, max: 1.045 },
      contrast: { enabled: true, min: 0.960, max: 1.040 },
      brightness: { enabled: true, min: -0.015, max: 0.015 },
      gamma: { enabled: true, min: 0.955, max: 1.045 },
      color_temp: { enabled: true, min: -0.040, max: 0.040 },
      zoom: { enabled: true, min: 1.010, max: 1.020 },
      // ── AUDIO FINGERPRINT ──
      pitch_shift: { enabled: true, min: 0.994, max: 1.006 },
      audio_highpass: { enabled: true, min: 65, max: 90 },
      audio_lowpass: { enabled: true, min: 16000, max: 19000 },
      audio_noise: { enabled: true, min: 0.0002, max: 0.0010 },
      volume: { enabled: true, min: 0.975, max: 1.025 },
      // ── TEMPORAL DESYNC (dominant SSIM killer — 150-350ms offset misaligns all frames) ──
      speed: { enabled: true, min: 0.992, max: 1.008 },
      cut_video: { enabled: true, min: 0.15, max: 0.35 },
      cut_end_video: { enabled: true, min: 0.10, max: 0.20 },
      framerate: { enabled: false, min: 28, max: 32 },
      deflicker: { enabled: true },
      // ── QUALITY (stronger processing = lower SSIM) ──
      deband: { enabled: true },
      denoise: { enabled: true, min: 3.5, max: 6.0 },
      sharpen: { enabled: true, min: 0.7, max: 1.2 },
      // ── VISIBLE EFFECTS (all off) ──
      flip: { enabled: false }, vflip: { enabled: false },
      noise: { enabled: false, min: 1, max: 5 },
      vignette: { enabled: false, min: 0, max: 0.2 },
      rotation: { enabled: false, min: -1, max: 1 },
      pixel_shift: { enabled: false, min: -2, max: 2 },
      lens_correction: { enabled: false, min: -0.1, max: 0.1 },
      blurred_border: { enabled: false },
      random_pixel_size: { enabled: false, min: 1, max: 1 },
      dimensions: { enabled: false, min_w: 1080, max_w: 1080, min_h: 1920, max_h: 1920 },
    };
    setFilters(applyInputContext(aggressive));
    setMetadata(initMetaState());
    toast.success("Aggressive preset loaded");
  }, [applyInputContext]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (id) => {
      try {
        const { data } = await api.get(`/video-repurpose/jobs/${id}`);
        if (!data.ok) return;
        const job = data.job;
        setProgress(typeof job.progress === "number" ? job.progress : 0);
        setStatusMsg(job.message || "");
        setJobStatus(job.status);
        setQueuePosition(job.queue_position || 0);

        if (job.status === "completed") {
          stopPolling();
          setOutputs(job.outputs || []);
          setProgress(100);
          setStatusMsg(job.message || "Done.");
          setJobStatus("completed");
          // Keep isGenerating true until POST /generate-with-worker returns (button state).
        } else if (job.status === "failed") {
          stopPolling();
          setIsGenerating(false);
          setProgress(0);
          toast.error(getSafeErrorText(job.error, "Processing failed"));
        }
      } catch {
        // keep polling
      }
    },
    [stopPolling],
  );

  const handleGenerate = useCallback(async () => {
    if (!videoFile) {
      toast.error("Upload a video or image first");
      return;
    }

    setIsGenerating(true);
    setOutputs([]);
    setProgress(0);
    setStatusMsg("Preparing...");
    setJobStatus("uploading");

    try {
      const useAiOptimization = !advancedOpen;
      const dm = metadata.device_metadata || {};
      const syncedMeta = {
        ...metadata,
        device_metadata: {
          ...dm,
          uniqueDevicePerCopy: dm.deviceMode === "random_unique",
        },
      };
      const settings = { copies, filters, metadata: syncedMeta, useAiOptimization };

      const jobId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const form = new FormData();
      form.append("jobId", jobId);
      form.append("video", videoFile);
      if (watermarkFile) form.append("watermark", watermarkFile);
      form.append("settings", JSON.stringify(settings));

      setJobId(jobId);
      setJobStatus("processing");
      setProgress(8);
      setStatusMsg("Uploading…");
      stopPolling();
      pollRef.current = setInterval(() => {
        void pollJob(jobId);
      }, 650);
      void pollJob(jobId);

      const workerRes = await api.post("/video-repurpose/generate-with-worker", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      stopPolling();
      const data = workerRes.data;
      if (!data?.ok) {
        toast.error(getSafeErrorText(data?.error, "Worker failed"));
        setIsGenerating(false);
        return;
      }
      setJobId(data.job_id || jobId);
      setJobStatus("completed");
      setProgress(100);
      setStatusMsg("Done.");
      setOutputs(data.outputs || []);
      try {
        await refreshUserCredits?.();
      } catch {
        /* ignore */
      }
      clearDraft();
      toast.success(`Generated ${(data.outputs || []).length} unique copies`);
      setIsGenerating(false);
      fetchHistory();
    } catch (err) {
      stopPolling();
      const rawErr = err.response?.data?.error ?? err.response?.data ?? err?.message;
      const msg = getSafeErrorText(rawErr, "Processing failed");
      toast.error(msg);
      setIsGenerating(false);
      setJobStatus(null);
      setStatusMsg("");
      setProgress(0);
    }
  }, [
    videoFile,
    watermarkFile,
    copies,
    filters,
    metadata,
    advancedOpen,
    stopPolling,
    fetchHistory,
    clearDraft,
    refreshUserCredits,
    pollJob,
  ]);

  const handleDownload = useCallback(async (url, fileName) => {
    try {
      const response = await api.get(url, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Download failed");
    }
  }, []);

  const handleProxyDownload = useCallback((sourceUrl, fileName) => {
    if (!sourceUrl) return;
    const downloadUrl = `/api/download?url=${encodeURIComponent(sourceUrl)}&filename=${encodeURIComponent(fileName || "download")}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = fileName || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const handleDownloadAll = useCallback(() => {
    for (const o of outputs) {
      if (o.fileUrl?.startsWith("http")) {
        handleProxyDownload(o.fileUrl, o.file_name);
      } else {
        handleDownload(o.download_url, o.file_name);
      }
    }
  }, [outputs, handleDownload, handleProxyDownload]);

  return (
    <div className={`min-h-screen ${embedded ? "" : "pt-16"}`} data-testid="video-repurposer-page">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
              <Shuffle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white" data-testid="text-page-title">
                Photo / Video Repurposer
              </h1>
              <p className="text-xs text-slate-400">
                Create unique variations of your photos and videos with randomized filters and metadata.
                Results are not guaranteed — use the Compare tab to measure changes.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 mt-3" data-testid="tab-switcher">
            <button
              onClick={() => setActiveTab("repurpose")}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "repurpose"
                  ? "bg-white text-black border border-white/35"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
              data-testid="tab-repurpose"
            >
              <Shuffle className="w-3.5 h-3.5" />
              Repurpose
            </button>
            <button
              onClick={() => setActiveTab("compare")}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "compare"
                  ? "bg-white text-black border border-white/35"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
              data-testid="tab-compare"
            >
              <GitCompare className="w-3.5 h-3.5" />
              Compare
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "history"
                  ? "bg-white text-black border border-white/35"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
              data-testid="tab-history"
            >
              <History className="w-3.5 h-3.5" />
              History
            </button>
          </div>
        </div>

        {!hasSubscription && activeTab === "repurpose" && (
          <div className="mb-5 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20" data-testid="subscription-required-banner">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-300">Active subscription required</p>
                <p className="text-xs text-amber-500/80 mt-0.5">Upgrade your plan to access the Photo / Video Repurposer feature.</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "compare" && (
          <div className="space-y-4">
            <div className="rounded-xl p-4 bg-white/[0.04] border border-white/[0.12]" data-testid="compare-disclaimer">
              <div className="flex gap-3">
                <Info className="w-4 h-4 text-white flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-white font-medium mb-1">About the Similarity Score</p>
                  <p className="text-[11px] text-slate-300/80 leading-relaxed">
                    The similarity checker helps you understand how much the video has been altered after applying changes. Generally, anything under 80% is a good result — but there is no magic number that guarantees a pass. Videos at 90% similarity can go undetected, while videos at 60% might still get flagged. Many factors beyond visual similarity affect detection. Use this tool to measure how much you're changing the video, not as a guarantee of whether it will pass.
                  </p>
                </div>
              </div>
            </div>
            <CompareTabBoundary>
              <VideoComparer />
            </CompareTabBoundary>
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-5">
            <div className="rounded-xl p-4 bg-white/[0.04] border border-white/[0.12]" data-testid="history-info">
              <div className="flex gap-3">
                <Info className="w-4 h-4 text-white flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-white font-medium mb-1">Repurpose History</p>
                  <p className="text-[11px] text-slate-300/80 leading-relaxed">
                    Your last {historyLimit} repurposed files are saved here. Older files are automatically deleted when you exceed this limit. Download files you want to keep permanently.
                  </p>
                </div>
              </div>
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
                <span className="ml-3 text-sm text-slate-400">Loading history...</span>
              </div>
            ) : historyJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
                  <History className="w-7 h-7 text-slate-600" />
                </div>
                <p className="text-sm text-slate-400 font-medium">No repurposed files yet</p>
                <p className="text-xs text-slate-500 mt-1.5 max-w-xs">Completed repurpose jobs (videos and images) will automatically appear here so you can download them later.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {historyJobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-xl overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    data-testid={`history-job-${job.id}`}
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-400" />
                          <span className="text-xs font-medium text-slate-200">
                            {new Date(job.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {new Date(job.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 bg-white/[0.04] px-2.5 py-1 rounded-full">
                          {job.copies} {job.copies === 1 ? "file" : "files"}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          if (deletingJobId) return;
                          setDeletingJobId(job.id);
                          try {
                            await api.delete(`/video-repurpose/history/${job.id}`);
                            setHistoryJobs((prev) => prev.filter((j) => j.id !== job.id));
                            toast.success("Deleted from history");
                          } catch {
                            toast.error("Failed to delete");
                          } finally {
                            setDeletingJobId(null);
                          }
                        }}
                        disabled={deletingJobId === job.id}
                        className="text-slate-500 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-white/[0.04]"
                        data-testid={`delete-history-${job.id}`}
                      >
                        {deletingJobId === job.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <div className="p-3">
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                        {job.outputs?.map((output, idx) => (
                          <div
                            key={output.id}
                            className="group rounded-lg overflow-hidden"
                            style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.05)" }}
                          >
                            <div className="relative">
                              {/\.(jpg|jpeg|png|webp)$/i.test(output.fileName) ? (
                                <img
                                  src={output.fileUrl}
                                  className="w-full aspect-[9/14] object-cover bg-black"
                                  alt={output.fileName}
                                  loading="lazy"
                                />
                              ) : (
                                <video
                                  src={output.fileUrl}
                                  className="w-full aspect-[9/14] object-cover bg-black"
                                  preload="metadata"
                                  muted
                                  playsInline
                                  onMouseEnter={(e) => { try { e.target.play(); } catch {} }}
                                  onMouseLeave={(e) => { try { e.target.pause(); e.target.currentTime = 0; } catch {} }}
                                />
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                              <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-[9px] text-white/80 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded">
                                  #{idx + 1}
                                </span>
                              </div>
                            </div>
                            <div className="px-2 py-1.5 flex items-center justify-between gap-1">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-slate-500 truncate">{output.fileName}</p>
                              </div>
                              <button
                                onClick={() => handleProxyDownload(output.fileUrl, output.fileName)}
                                className="text-emerald-400 hover:text-emerald-300 transition-colors p-1 rounded hover:bg-emerald-500/10 flex-shrink-0"
                                data-testid={`download-history-${output.id}`}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                <div className="text-center py-3">
                  <p className="text-[11px] text-slate-600">
                    Showing {historyJobs.length} of {historyLimit} max saved jobs
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "repurpose" && <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left Column - Upload + Settings */}
          <div className="lg:col-span-1 space-y-4">
            {/* Upload Section */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Upload className="w-4 h-4 text-white" />
                Source Media
              </h3>

              {loadingFromGallery ? (
                <div className="w-full h-36 border-2 border-dashed border-white/30 rounded-lg flex flex-col items-center justify-center gap-2 bg-white/5">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                  <span className="text-xs text-white/80">Loading from gallery...</span>
                </div>
              ) : !videoFile ? (
                <div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-28 border-2 border-dashed border-white/10 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-white/30 hover:bg-white/5 transition-all duration-200"
                    data-testid="button-upload-video"
                  >
                    <Upload className="w-6 h-6 text-slate-500" />
                    <span className="text-xs text-slate-400">Click to upload video or image</span>
                    <span className="text-[10px] text-slate-600">MP4 · MOV · WebM · JPG · PNG · WebP · up to 200MB</span>
                  </button>
                  <button
                    onClick={() => setShowGallery(true)}
                    className="w-full mt-2 py-2 rounded-lg border border-white/10 text-xs text-slate-400 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all duration-200 flex items-center justify-center gap-2"
                    data-testid="button-gallery-repurpose"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Select from Gallery
                  </button>
                </div>
              ) : (
                <div className="relative rounded-lg overflow-hidden bg-black/30">
                  {inputIsImage ? (
                    <img
                      src={videoPreview}
                      className="w-full h-36 object-contain"
                      alt="preview"
                      data-testid="image-preview"
                    />
                  ) : (
                    <video
                      src={videoPreview}
                      className="w-full h-36 object-contain"
                      controls
                      data-testid="video-preview"
                    />
                  )}
                  <button
                    onClick={removeVideo}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-red-500/80 transition-colors"
                    data-testid="button-remove-video"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                  <div className="p-2">
                    <p className="text-[10px] text-slate-400 truncate">{videoFile.name}</p>
                    <p className="text-[10px] text-slate-600">{(videoFile.size / (1024 * 1024)).toFixed(1)}MB</p>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/jpeg,image/png,image/webp"
                onChange={handleVideoSelect}
                className="hidden"
                data-testid="input-video-file"
              />
            </div>

            {/* Location */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                Location
              </h3>
              {/* Address search */}
              <div className="relative mb-2">
                <input
                  type="text"
                  value={locationSearch}
                  onChange={(e) => {
                    setLocationSearch(e.target.value);
                    setLocationResults([]);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && locationSearch.trim()) {
                      setLocationSearching(true);
                      try {
                        const res = await fetch(
                          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationSearch.trim())}&format=json&limit=5`,
                          { headers: { "Accept-Language": "en" } }
                        );
                        const data = await res.json();
                        setLocationResults(data);
                      } catch {}
                      setLocationSearching(false);
                    }
                  }}
                  placeholder="Search address… (press Enter)"
                  className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/40"
                />
                {locationSearching && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-slate-400" />}
                {locationResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-white/10 overflow-hidden" style={{ background: "#0d0f11" }}>
                    {locationResults.map((r) => (
                      <button
                        key={r.place_id}
                        type="button"
                        className="w-full text-left px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/10 transition-colors"
                        onClick={() => {
                          const lat = parseFloat(r.lat);
                          const lng = parseFloat(r.lon);
                          updateMeta("gps_location", { ...metadata.gps_location, enabled: true, mode: "pinpoint", lat, lng });
                          setLocationSearch(r.display_name);
                          setLocationResults([]);
                        }}
                      >
                        {r.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mb-2">Or click the map to pin a location.</p>
              <div className="rounded-lg overflow-hidden border border-white/10" style={{ height: 200 }}>
                <MapContainer
                  center={[metadata.gps_location.lat ?? 39.8, metadata.gps_location.lng ?? -98.5]}
                  zoom={metadata.gps_location.lat != null ? 10 : 3}
                  style={{ height: "100%", width: "100%" }}
                  attributionControl={false}
                >
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  />
                  {metadata.gps_location.lat != null && (
                    <Marker position={[metadata.gps_location.lat, metadata.gps_location.lng]} />
                  )}
                  <MapClickHandler
                    onPick={(lat, lng) =>
                      updateMeta("gps_location", { ...metadata.gps_location, enabled: true, mode: "pinpoint", lat, lng })
                    }
                  />
                </MapContainer>
              </div>
              {metadata.gps_location.lat != null ? (
                <p className="text-[10px] text-slate-400 text-center mt-2">
                  {Math.abs(metadata.gps_location.lat).toFixed(4)}°{metadata.gps_location.lat >= 0 ? "N" : "S"},{" "}
                  {Math.abs(metadata.gps_location.lng).toFixed(4)}°{metadata.gps_location.lng >= 0 ? "E" : "W"}
                </p>
              ) : (
                <p className="text-[10px] text-slate-500 text-center mt-2">Click the map to place a pin</p>
              )}
            </div>

            {/* Device */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-violet-400" />
                Device fingerprint
              </h3>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {[
                  { mode: "single", label: "Same device" },
                  { mode: "per_copy", label: "Per copy" },
                  { mode: "random_unique", label: "Random unique" },
                ].map(({ mode, label }) => {
                  const isActive = (metadata.device_metadata.deviceMode || "single") === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() =>
                        updateMeta("device_metadata", {
                          ...metadata.device_metadata,
                          deviceMode: mode,
                          uniqueDevicePerCopy: mode === "random_unique",
                        })
                      }
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border ${
                        isActive
                          ? "bg-violet-500/20 border-violet-500/40 text-violet-200"
                          : "bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {(metadata.device_metadata.deviceMode || "single") !== "per_copy" && (metadata.device_metadata.deviceMode || "single") !== "random_unique" && (
                <>
                  <input
                    type="text"
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    placeholder="Search devices…"
                    className="w-full mb-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-white/40"
                    data-testid="input-device-search"
                  />
                  <label className="text-[10px] text-slate-500 block mb-1">Device</label>
                  <select
                    value={metadata.device_metadata.modelKey || ""}
                    onChange={(e) =>
                      updateMeta("device_metadata", {
                        ...metadata.device_metadata,
                        modelKey: e.target.value,
                      })
                    }
                    className="w-full text-[11px] bg-white/5 border border-white/10 rounded-md px-2 py-2 text-slate-200 focus:outline-none focus:border-white/40 max-h-40"
                    data-testid="select-device-model"
                  >
                    <option value="" className="bg-gray-900">Auto (random device)</option>
                    {filteredDeviceOptions.map((o) => (
                      <option key={o.id} value={o.id} className="bg-gray-900">
                        {o.label} · {o.category}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {(metadata.device_metadata.deviceMode || "single") === "per_copy" && (
                <div className="space-y-2 mt-1">
                  {Array.from({ length: copies }, (_, i) => (
                    <div key={i}>
                      <label className="text-[10px] text-slate-500 block mb-0.5">Copy {i + 1}</label>
                      <select
                        value={metadata.device_metadata.modelKeys?.[i] || ""}
                        onChange={(e) => {
                          const next = [...(metadata.device_metadata.modelKeys || ["", "", "", "", ""])];
                          next[i] = e.target.value;
                          updateMeta("device_metadata", { ...metadata.device_metadata, modelKeys: next });
                        }}
                        className="w-full text-[11px] bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-slate-200"
                      >
                        <option value="" className="bg-gray-900">Auto</option>
                        {REPURPOSE_DEVICE_OPTIONS.map((o) => (
                          <option key={`${i}-${o.id}`} value={o.id} className="bg-gray-900">
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generate */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Shuffle className="w-4 h-4 text-white" />
                Generate
              </h3>
              <div className="mb-3">
                <label className="text-[11px] text-slate-400 uppercase tracking-wide mb-1.5 block">
                  Unique Copies (1-5): {copies}
                </label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={copies}
                  onChange={(e) => {
                    const next = Number.parseInt(e.target.value, 10);
                    if (!Number.isFinite(next)) return;
                    setCopies(Math.max(1, Math.min(5, next)));
                  }}
                  className="w-full accent-white cursor-pointer"
                  data-testid="input-copies"
                />
              </div>
              <p className="text-xs text-slate-500 mb-2">
                {!advancedOpen
                  ? "Smart optimization applies invisible fingerprint tweaks automatically (+10 credits per run). Open Advanced for full manual control at no extra credit cost."
                  : "Advanced mode: your filter sliders are used as-is (no smart optimization charge)."}
              </p>
              {!advancedOpen && (
                <p className="text-[11px] text-amber-200/90 mb-2 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 shrink-0" />
                  <span>Includes +10 credit smart optimization</span>
                </p>
              )}

              <button
                onClick={handleGenerate}
                disabled={!videoFile || isGenerating || !hasSubscription}
                className="w-full mt-4 py-3 rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-white text-black hover:bg-slate-100 active:scale-[0.98]"
                data-testid="button-generate"
              >
                {isGenerating ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Shuffle className="w-4 h-4" />
                    Generate
                  </span>
                )}
              </button>

              {/* Progress */}
              {isGenerating && (
                <div className="mt-3">
                  {jobStatus === "queued" && queuePosition > 0 ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/15">
                      <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                      <span className="text-[11px] text-amber-300 font-medium">Queue position: #{queuePosition}</span>
                      <span className="text-[10px] text-amber-500/70 ml-auto">Waiting for slot...</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-slate-400">{statusMsg}</span>
                        <span className="text-[10px] text-white font-mono">{progress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-white to-white/70 rounded-full transition-all duration-500"
                          style={{ width: `${progress}%` }}
                          data-testid="progress-bar"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Outputs */}
            {outputs.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    Results ({outputs.length})
                  </h3>
                  <button
                    onClick={handleDownloadAll}
                    className="text-[10px] text-white hover:text-slate-200 transition-colors flex items-center gap-1"
                    data-testid="button-download-all"
                  >
                    <Download className="w-3 h-3" />
                    Download All
                  </button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {outputs.map((o, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                      data-testid={`output-item-${i}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Play className="w-3 h-3 text-white flex-shrink-0" />
                        <span className="text-[11px] text-slate-300 truncate">{o.file_name}</span>
                      </div>
                      <button
                        onClick={() => (o.fileUrl?.startsWith("http") ? handleProxyDownload(o.fileUrl, o.file_name) : handleDownload(o.download_url, o.file_name))}
                        className="flex-shrink-0 ml-2 w-7 h-7 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 transition-colors"
                        data-testid={`button-download-${i}`}
                      >
                        <Download className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
                {outputs.some((o) => o.metadata_warnings?.length > 0) && (
                  <div className="mt-2 p-2 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
                    <div className="flex items-center gap-1 mb-1">
                      <AlertTriangle className="w-3 h-3 text-yellow-400" />
                      <span className="text-[10px] text-yellow-400 font-medium">Metadata Warnings</span>
                    </div>
                    {outputs
                      .flatMap((o) => o.metadata_warnings || [])
                      .map((w, j) => (
                        <p key={j} className="text-[9px] text-yellow-500/70">{w}</p>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column - Filters + Metadata */}
          <div className="lg:col-span-2 space-y-4">
            {!advancedOpen && (
              <div
                className="rounded-xl p-4 bg-gradient-to-br from-cyan-500/10 to-violet-500/10 border border-white/10"
                data-testid="simple-mode-banner"
              >
                <p className="text-sm text-white font-medium mb-1">Simple mode</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Set <strong className="text-slate-300">location</strong> and <strong className="text-slate-300">device</strong> in the left column.
                  Smart optimization picks invisible filter tweaks for best results (+10 credits when you generate). Open Advanced below to use your own sliders at no extra credit cost.
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between rounded-xl px-4 py-3 bg-white/[0.06] border border-white/10 hover:bg-white/[0.09] transition-colors text-left"
              data-testid="toggle-advanced-repurposer"
            >
              <span className="text-sm font-semibold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-cyan-400" />
                Advanced filters &amp; metadata
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
            {advancedOpen && (
            <>
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-white" />
                Watermark (Optional)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => wmInputRef.current?.click()}
                  className="flex-1 text-xs text-slate-400 py-2 rounded-lg border border-white/10 hover:border-white/30 transition-colors text-center"
                  data-testid="button-upload-watermark"
                >
                  {watermarkFile ? watermarkFile.name : "Select image..."}
                </button>
                {watermarkFile && (
                  <button
                    type="button"
                    onClick={() => { setWatermarkFile(null); if (wmInputRef.current) wmInputRef.current.value = ""; }}
                    className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                    data-testid="button-remove-watermark"
                  >
                    <X className="w-3 h-3 text-slate-400" />
                  </button>
                )}
              </div>
              <input
                ref={wmInputRef}
                type="file"
                accept="image/*"
                onChange={handleWatermarkSelect}
                className="hidden"
                data-testid="input-watermark-file"
              />
            </div>
            {/* Filter Controls Header */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  Randomization Filters
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={enableAllFilters}
                    className="text-[10px] text-white/80 hover:text-white transition-colors px-2 py-1 rounded-md hover:bg-white/10"
                    data-testid="button-enable-all"
                  >
                    All On
                  </button>
                  <button
                    onClick={disableAllFilters}
                    className="text-[10px] text-slate-500 hover:text-slate-400 transition-colors px-2 py-1 rounded-md hover:bg-white/5"
                    data-testid="button-disable-all"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Preset Row */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] text-slate-500 font-medium mr-1">Presets:</span>
                <button
                  onClick={randomAllSafe}
                  data-testid="button-random-all"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition-colors text-xs font-semibold"
                >
                  <ShieldCheck className="w-3 h-3" />
                  Safe
                </button>
                <button
                  onClick={randomAllAggressive}
                  data-testid="button-aggressive"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/25 transition-colors text-xs font-semibold"
                >
                  <Zap className="w-3 h-3" />
                  Aggressive
                </button>

                {/* Custom presets */}
                {customPresets.map((preset, idx) => (
                  <div key={idx} className="flex items-center gap-0.5">
                    <button
                      onClick={() => loadCustomPreset(preset)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 transition-colors text-xs font-semibold"
                    >
                      <FolderOpen className="w-3 h-3" />
                      {preset.name}
                    </button>
                    <button
                      onClick={() => deleteCustomPreset(idx)}
                      className="px-1.5 py-1.5 rounded-r-lg bg-violet-500/15 border border-violet-500/30 border-l-0 text-violet-500 hover:text-rose-400 hover:bg-rose-500/15 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {/* Save preset button / inline form */}
                {!savingPreset ? (
                  customPresets.length < 2 && (
                    <button
                      onClick={() => setSavingPreset(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-white/15 text-slate-500 hover:text-slate-300 hover:border-white/30 transition-colors text-xs"
                    >
                      + Save preset
                    </button>
                  )
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={presetNameInput}
                      onChange={(e) => setPresetNameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCustomPreset(); if (e.key === "Escape") { setSavingPreset(false); setPresetNameInput(""); } }}
                      placeholder="Preset name…"
                      className="text-xs bg-white/5 border border-white/15 rounded-md px-2 py-1 text-white placeholder:text-slate-600 outline-none focus:border-violet-500/50 w-28"
                    />
                    <button
                      onClick={saveCustomPreset}
                      className="text-xs px-2.5 py-1 rounded-md bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 transition-colors font-semibold"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setSavingPreset(false); setPresetNameInput(""); }}
                      className="text-xs px-2 py-1 rounded-md text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Filter Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {FILTER_DEFS.map((def) => {
                const isVideoOnly = inputIsImage && VIDEO_ONLY_FILTER_KEYS.has(def.key);
                const isNoAudio = !inputIsImage && !inputHasAudio && AUDIO_ONLY_FILTER_KEYS.has(def.key);
                const isDisabled = isVideoOnly || isNoAudio;
                return (
                  <div key={def.key} className={isDisabled ? "relative" : ""}>
                    <FilterCard
                      def={def}
                      state={filters[def.key]}
                      onChange={(val) => !isDisabled && updateFilter(def.key, val)}
                    />
                    {isVideoOnly && (
                      <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center cursor-not-allowed">
                        <span className="text-[9px] text-slate-400 bg-black/70 px-2 py-0.5 rounded-full select-none">Video only</span>
                      </div>
                    )}
                    {isNoAudio && (
                      <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center cursor-not-allowed">
                        <span className="text-[9px] text-slate-400 bg-black/70 px-2 py-0.5 rounded-full select-none">No audio track</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {TOGGLE_DEFS.map((def) => {
                const isVideoOnly = inputIsImage && VIDEO_ONLY_FILTER_KEYS.has(def.key);
                return (
                  <div key={def.key} className={isVideoOnly ? "relative" : ""}>
                    <ToggleCard
                      def={def}
                      state={filters[def.key]}
                      onChange={(val) => !isVideoOnly && updateFilter(def.key, val)}
                    />
                    {isVideoOnly && (
                      <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center cursor-not-allowed">
                        <span className="text-[9px] text-slate-400 bg-black/70 px-2 py-0.5 rounded-full select-none">Video only</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>


            {/* Dimensions */}
            <div
              className={`rounded-xl p-4 transition-all duration-200 ${
                filters.dimensions.enabled
                  ? "bg-white/10 border border-white/35"
                  : "bg-white/[0.03] border border-white/[0.06]"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Maximize className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-white">Custom Dimensions</span>
                </div>
                <button
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      dimensions: { ...prev.dimensions, enabled: !prev.dimensions.enabled },
                    }))
                  }
                  className={`w-8 h-[18px] p-0 rounded-full transition-all duration-200 flex items-center ${
                    filters.dimensions.enabled ? "bg-white/90" : "bg-white/15"
                  }`}
                  data-testid="toggle-dimensions"
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${
                      filters.dimensions.enabled ? "bg-black" : "bg-white"
                    } ${
                      filters.dimensions.enabled ? "translate-x-[16px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              {filters.dimensions.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Min Width", key: "min_w" },
                    { label: "Max Width", key: "max_w" },
                    { label: "Min Height", key: "min_h" },
                    { label: "Max Height", key: "max_h" },
                  ].map((d) => (
                    <div key={d.key}>
                      <label className="text-[10px] text-slate-500 block mb-1">{d.label}</label>
                      <input
                        type="number"
                        value={filters.dimensions[d.key]}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            dimensions: { ...prev.dimensions, [d.key]: parseInt(e.target.value) || 0 },
                          }))
                        }
                        className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:border-white/40 focus:outline-none"
                        data-testid={`input-dim-${d.key}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Metadata Section */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <button
                onClick={() => setShowMetadata(!showMetadata)}
                className="w-full flex items-center justify-between"
                data-testid="button-toggle-metadata"
              >
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Settings className="w-4 h-4 text-cyan-400" />
                  Metadata Spoofing
                </h3>
                <span className="text-xs text-slate-500">{showMetadata ? "Hide" : "Show"}</span>
              </button>

              {showMetadata && (
                <div className="mt-4 space-y-3">
                  <p className="text-[11px] text-slate-500 px-1">
                    Device and GPS are configured in the left column. Here you can toggle extra metadata fields.
                  </p>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="flex items-center gap-2">
                      <Smartphone className={`w-3.5 h-3.5 ${metadata.device_metadata.enabled ? "text-white" : "text-slate-500"}`} />
                      <span className="text-xs text-slate-300">Device metadata</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateMeta("device_metadata", { ...metadata.device_metadata, enabled: !metadata.device_metadata.enabled })}
                      className={`w-8 h-[18px] p-0 rounded-full transition-all duration-200 flex items-center ${
                        metadata.device_metadata.enabled ? "bg-white/90" : "bg-white/15"
                      }`}
                      data-testid="toggle-device-metadata"
                    >
                      <div className={`w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${
                        metadata.device_metadata.enabled ? "bg-black" : "bg-white"
                      } ${
                        metadata.device_metadata.enabled ? "translate-x-[16px]" : "translate-x-0.5"
                      }`} />
                    </button>
                  </div>

                  {/* Timestamps */}
                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Clock className={`w-3.5 h-3.5 ${metadata.timestamps.enabled ? "text-white" : "text-slate-500"}`} />
                        <span className="text-xs text-slate-300">Capture Date & Time</span>
                      </div>
                      <button
                        onClick={() => updateMeta("timestamps", { ...metadata.timestamps, enabled: !metadata.timestamps.enabled })}
                        className={`w-8 h-[18px] p-0 rounded-full transition-all duration-200 flex items-center ${
                          metadata.timestamps.enabled ? "bg-white/90" : "bg-white/15"
                        }`}
                        data-testid="toggle-timestamps"
                      >
                        <div className={`w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${
                          metadata.timestamps.enabled ? "bg-black" : "bg-white"
                        } ${
                          metadata.timestamps.enabled ? "translate-x-[16px]" : "translate-x-0.5"
                        }`} />
                      </button>
                    </div>
                    {metadata.timestamps.enabled && (
                      <div className="grid grid-cols-1 gap-2 mt-2">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">Date & Time</label>
                          <input
                            type="datetime-local"
                            value={metadata.timestamps.date_taken || ""}
                            onChange={(e) => updateMeta("timestamps", { ...metadata.timestamps, date_taken: e.target.value })}
                            className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-300 focus:outline-none focus:border-white/40"
                            data-testid="input-date-taken"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Recording App + Audio Device + Color Profile toggles */}
                  {[
                    { key: "recording_app", label: "Recording App", icon: Film },
                    { key: "audio_device", label: "Audio Device", icon: Volume2 },
                    { key: "color_profile", label: "Color Profile", icon: Droplets },
                  ].map(({ key, label, icon: Icon }) => (
                    <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-3.5 h-3.5 ${metadata[key].enabled ? "text-white" : "text-slate-500"}`} />
                        <span className="text-xs text-slate-300">{label}</span>
                      </div>
                      <button
                        onClick={() => updateMeta(key, { ...metadata[key], enabled: !metadata[key].enabled })}
                        className={`w-8 h-[18px] p-0 rounded-full transition-all duration-200 flex items-center ${
                          metadata[key].enabled ? "bg-white/90" : "bg-white/15"
                        }`}
                        data-testid={`toggle-${key}`}
                      >
                        <div className={`w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${
                          metadata[key].enabled ? "bg-black" : "bg-white"
                        } ${
                          metadata[key].enabled ? "translate-x-[16px]" : "translate-x-0.5"
                        }`} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </div>}

        <GalleryPicker
          open={showGallery}
          onClose={() => setShowGallery(false)}
          onSelect={handleGallerySelectRepurpose}
        />
      </div>
    </div>
  );
}
