import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useBranding } from "../hooks/useBranding";
import {
  Sparkles,
  User,
  Palette,
  Eye,
  Shirt,
  MessageSquare,
  Loader2,
  Check,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Heart,
  CreditCard,
  Upload,
  ImagePlus,
  X,
  Plus,
  Camera,
  Zap,
  ChevronDown,
  ChevronUp,
  Copy,
  Coins,
  Wand2,
} from "lucide-react";
import toast from "react-hot-toast";
import { modelAPI, generationAPI, pricingAPI, uploadToCloudinary as uploadFile } from "../services/api";
import api from "../services/api";
import { useAuthStore } from "../store";
import { useDropzone } from "react-dropzone";
import { selectorCategories } from "../data/nsfwSelectors";
import {
  displayModelLooksGroupLabel,
  displayModelLooksOption,
} from "../data/modelLooksDisplayRu";
import {
  AI_MODEL_FORM_COPY,
  resolveLocale,
  formatCopy,
} from "./generateAIModelFormCopy";

const OUTFIT_TYPE_OPTIONS = [
  { value: "", label: "Default", description: "AI decides" },
  {
    value: "lingerie",
    label: "Lingerie",
    description: "Elegant intimate wear",
  },
  { value: "swimwear", label: "Swimwear", description: "Beach & pool style" },
  { value: "bodysuit", label: "Bodysuit", description: "Fitted one-piece" },
  { value: "dress", label: "Dress", description: "Form-fitting dress" },
  { value: "fitness", label: "Fitness", description: "Athletic wear" },
  { value: "glamour", label: "Glamour", description: "Glamorous outfit" },
];

const POSE_STYLE_OPTIONS = [
  {
    value: "seductive",
    label: "Seductive",
    description: "Alluring & confident",
  },
  { value: "playful", label: "Playful", description: "Fun & flirty" },
  {
    value: "elegant",
    label: "Elegant",
    description: "Graceful & sophisticated",
  },
  { value: "confident", label: "Confident", description: "Strong presence" },
  { value: "sensual", label: "Sensual", description: "Intimate mood" },
  { value: "natural", label: "Natural", description: "Relaxed & genuine" },
];

const PHOTO_CONFIGS_DEFAULT = [
  { label: "Selfie (1:1)", prompt: "", referencePhotos: [], expanded: true },
  { label: "Portrait (3:4)", prompt: "", referencePhotos: [], expanded: false },
  { label: "Full Body (9:16)", prompt: "", referencePhotos: [], expanded: false },
];

function GeneratingOverlay({ phase, progress, copy }) {
  const isPhase1 = phase === 1;
  const branding = useBranding();
  const isActive = !!progress?.message || !!progress?.step;
  const poseSteps = [
    { step: 1, label: copy.poseStep1 },
    { step: 2, label: copy.poseStep2 },
    { step: 3, label: copy.poseStep3 },
  ];

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center"
      style={{ zIndex: 99999 }}
    >
      <div className="relative flex items-center justify-center">
        {/* Spin ring — only animates when actively generating */}
        <div className={`w-24 h-24 border-4 border-white/10 border-t-white/60 rounded-full ${isActive ? "animate-spin" : ""}`} />
        {/* Logo centred inside the ring */}
        <div className="absolute inset-0 flex items-center justify-center">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.appName}
              className="w-12 h-12 rounded-xl object-contain"
            />
          ) : (
            <span className="text-2xl font-black text-white">M</span>
          )}
        </div>
      </div>

      <h2 className="mt-6 sm:mt-8 text-xl sm:text-2xl font-bold text-white">
        {isPhase1 ? copy.overlayTitleRef : copy.overlayTitlePhotos}
      </h2>
      <p className="mt-2 sm:mt-3 text-sm sm:text-lg text-gray-300 px-4">
        {progress.message ||
          (isPhase1 ? copy.overlaySubRef : copy.overlaySubPhotos)}
      </p>

      {!isPhase1 && (
        <div className="mt-6 sm:mt-10 flex items-center gap-1 sm:gap-2 px-2 sm:px-4">
          {poseSteps.map((item, index) => (
            <div key={item.step} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-9 h-9 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-500 ${
                    progress.step > item.step
                      ? "bg-green-500 text-white"
                      : progress.step === item.step
                        ? "bg-purple-500 text-white"
                        : "bg-gray-700 text-gray-400"
                  }`}
                >
                  {progress.step > item.step ? (
                    <Check className="w-4 h-4 sm:w-6 sm:h-6" />
                  ) : progress.step === item.step ? (
                    <Loader2 className="w-4 h-4 sm:w-6 sm:h-6 animate-spin" />
                  ) : (
                    <span className="text-xs sm:text-sm font-bold">{item.step}</span>
                  )}
                </div>
                <span
                  className={`mt-1 sm:mt-2 text-[10px] sm:text-xs font-medium text-center max-w-[60px] sm:max-w-[80px] ${
                    progress.step >= item.step
                      ? "text-white"
                      : "text-gray-500"
                  }`}
                >
                  {item.label}
                </span>
              </div>
              {index < poseSteps.length - 1 && (
                <div
                  className={`w-4 sm:w-8 h-1 mx-0.5 sm:mx-1 rounded transition-all duration-500 ${
                    progress.step > item.step ? "bg-green-500" : "bg-gray-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-10 text-sm text-gray-500">
        {isPhase1
          ? copy.overlayFooterRef
          : formatCopy(copy.overlayFooterStep, {
              step: progress.step || 0,
              label: poseSteps[progress.step - 1]?.label || copy.overlayStepProcessing,
            })}
      </p>
    </motion.div>,
    document.body,
  );
}

function PhotoConfigUploader({ index, config, onUpdate, disabled, copy }) {
  const [uploading, setUploading] = useState(false);
  const [describing, setDescribing] = useState(false);

  const handleAutoDescribe = async () => {
    if (!config.referencePhotos.length) {
      toast.error(copy.toastUploadRefFirst);
      return;
    }
    setDescribing(true);
    try {
      const result = await generationAPI.describeTarget({
        targetImageUrl: config.referencePhotos[0],
        modelName: "the subject",
        clothesMode: "keep",
      });
      if (result.success && result.description) {
        let desc = result.description;
        desc = desc.replace(/\bthe subject\b/gi, "").replace(/\s{2,}/g, " ").trim();
        onUpdate(index, { ...config, prompt: desc });
        toast.success(copy.toastPromptFromPhoto);
      } else {
        toast.error(result.message || copy.toastAnalyzeFail);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || copy.toastAnalyzeFail);
    } finally {
      setDescribing(false);
    }
  };

  const handleDrop = async (files) => {
    if (config.referencePhotos.length + files.length > 5) {
      toast.error(copy.toastMaxPhotos);
      return;
    }
    setUploading(true);
    try {
      const urls = [];
      for (const file of files) {
        const url = await uploadFile(file);
        urls.push(url);
      }
      onUpdate(index, {
        ...config,
        referencePhotos: [...config.referencePhotos, ...urls],
      });
      toast.success(formatCopy(copy.toastUploadOk, { count: urls.length }));
    } catch (error) {
      toast.error(copy.toastUploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (photoIndex) => {
    onUpdate(index, {
      ...config,
      referencePhotos: config.referencePhotos.filter((_, i) => i !== photoIndex),
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: { "image/jpeg": [], "image/png": [] },
    multiple: true,
    maxFiles: 5,
    disabled: uploading || config.referencePhotos.length >= 5 || disabled,
  });

  return (
    <div className="space-y-2">
      {config.referencePhotos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {config.referencePhotos.map((url, i) => (
            <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/10">
              <img src={url} alt={`${copy.refAlt} ${i + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => removePhoto(i)}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500/80 flex items-center justify-center hover:bg-red-500 transition"
                data-testid={`button-remove-photo-${index}-${i}`}
              >
                <X className="w-2.5 h-2.5 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {config.referencePhotos.length < 5 && (
        <div
          {...getRootProps()}
          className={`border border-dashed rounded-lg cursor-pointer transition p-3 text-center text-xs ${
            isDragActive
              ? "border-purple-500 bg-purple-500/10"
              : "border-white/20 bg-white/5 hover:border-purple-500/50"
          } ${uploading || disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
              <span className="text-gray-300">{copy.uploading}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1.5 text-gray-400">
              <Plus className="w-3 h-3" />
              <span>
                {config.referencePhotos.length === 0
                  ? copy.addRefPhotos
                  : formatCopy(copy.addMorePhotos, { n: config.referencePhotos.length })}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <textarea
          value={config.prompt}
          onChange={(e) => onUpdate(index, { ...config, prompt: e.target.value })}
          placeholder={
            index === 0
              ? copy.photoPromptPh0
              : index === 1
                ? copy.photoPromptPh1
                : copy.photoPromptPh2
          }
          rows={2}
          className="w-full px-3 py-2 pr-24 bg-white/5 border border-white/10 rounded-lg focus:border-purple-500 transition resize-none text-xs"
          disabled={disabled || describing}
          data-testid={`input-photo-prompt-${index}`}
        />
        {config.referencePhotos.length > 0 && (
          <button
            type="button"
            onClick={handleAutoDescribe}
            disabled={disabled || describing}
            className="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-1 rounded-md bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/30 transition text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid={`button-auto-describe-${index}`}
          >
            {describing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Wand2 className="w-3 h-3" />
            )}
            {describing ? copy.analyzing : copy.autoFill}
          </button>
        )}
      </div>
    </div>
  );
}

// Same model looks groups as ModelsPage (single source of truth)
const appearanceGroups = selectorCategories.find((c) => c.id === "appearance")?.groups || [];
const modelLooksGroups = [
  { key: "gender", label: "Gender", options: ["female", "male"] },
  ...appearanceGroups,
];
const allLookKeys = modelLooksGroups.map((g) => g.key);

/** Fallback if pricing fetch fails — keep aligned with `DEFAULT_GENERATION_PRICING` server-side. */
const GEN_PRICING_FALLBACK = {
  modelStep1Reference: 150,
  modelStep2Poses: 750,
  modelCreateAi: 900,
  modelFromPhotosAdvanced: 900,
};

function buildInitialFormData() {
  return {
    age: "",
    referencePrompt: "",
    ...Object.fromEntries(allLookKeys.map((k) => [k, ""])),
  };
}

export default function GenerateAIModelForm({ name, onSuccess, onCancel, onNeedCredits }) {
  const locale = resolveLocale();
  const copy = AI_MODEL_FORM_COPY[locale] || AI_MODEL_FORM_COPY.en;

  const [mode, setMode] = useState("scratch");

  const [formData, setFormData] = useState(buildInitialFormData);

  const [posesData, setPosesData] = useState({
    outfitType: "glamour",
    poseStyle: "elegant",
    posesPrompt: "",
  });

  const [phase, setPhase] = useState("params");
  const [referenceUrl, setReferenceUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generatingPhase, setGeneratingPhase] = useState(0);
  const [progress, setProgress] = useState({ step: 0, message: "" });

  const [photoConfigs, setPhotoConfigs] = useState(
    PHOTO_CONFIGS_DEFAULT.map((c) => ({ ...c, referencePhotos: [] }))
  );
  const [fromPhotosAge, setFromPhotosAge] = useState("");
  const [fromPhotosGender, setFromPhotosGender] = useState("");
  const [fromPhotosLooks, setFromPhotosLooks] = useState(null);
  const [fromPhotosDetecting, setFromPhotosDetecting] = useState(false);

  const user = useAuthStore((state) => state.user);
  const refreshUserCredits = useAuthStore((state) => state.refreshUserCredits);

  const [genPricing, setGenPricing] = useState(GEN_PRICING_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await pricingAPI.getGeneration();
        if (cancelled || !r?.success || !r.pricing || typeof r.pricing !== "object") return;
        setGenPricing((prev) => ({ ...prev, ...r.pricing }));
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const step1Credits = genPricing.modelStep1Reference ?? GEN_PRICING_FALLBACK.modelStep1Reference;
  const step2Credits = genPricing.modelStep2Poses ?? GEN_PRICING_FALLBACK.modelStep2Poses;
  const scratchTotalCredits =
    (Number.isFinite(step1Credits) ? step1Credits : 0) + (Number.isFinite(step2Credits) ? step2Credits : 0);
  const fromPhotosCredits =
    genPricing.modelFromPhotosAdvanced ?? GEN_PRICING_FALLBACK.modelFromPhotosAdvanced;

  const resetPhotoConfigs = () => {
    setPhotoConfigs(
      PHOTO_CONFIGS_DEFAULT.map((c) => ({ ...c, referencePhotos: [] }))
    );
  };

  const handleModeSwitch = (newMode) => {
    setMode(newMode);
    if (newMode === "photos") {
      resetPhotoConfigs();
    }
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePosesChange = (field, value) => {
    setPosesData((prev) => ({ ...prev, [field]: value }));
  };

  const updatePhotoConfig = (index, newConfig) => {
    setPhotoConfigs((prev) => prev.map((c, i) => (i === index ? newConfig : c)));
  };

  const toggleExpanded = (index) => {
    setPhotoConfigs((prev) =>
      prev.map((c, i) => (i === index ? { ...c, expanded: !c.expanded } : c))
    );
  };

  const copyToAll = (sourceIndex) => {
    const source = photoConfigs[sourceIndex];
    setPhotoConfigs((prev) =>
      prev.map((c, i) =>
        i === sourceIndex
          ? c
          : { ...c, prompt: source.prompt, referencePhotos: [...source.referencePhotos] }
      )
    );
    toast.success(copy.toastCopiedAll);
  };

  const handleAutoDetectLooks = async () => {
    const firstRefs = photoConfigs[0]?.referencePhotos;
    if (!firstRefs?.length) {
      toast.error(copy.toastUploadSelfieFirst);
      return;
    }
    setFromPhotosDetecting(true);
    try {
      const { data } = await api.post("/generate/analyze-looks", { imageUrls: firstRefs.slice(0, 3) });
      if (data?.looks && typeof data.looks === "object") {
        setFromPhotosLooks(data.looks);
        if (data.looks.age != null) setFromPhotosAge(String(data.looks.age));
        if (data.looks.gender) setFromPhotosGender(data.looks.gender);
        toast.success(copy.toastLooksDetected);
      } else {
        toast.error(copy.toastDetectFail);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || copy.toastDetectError);
    } finally {
      setFromPhotosDetecting(false);
    }
  };

  const handleGenerateReference = async () => {
    if (!formData.gender) {
      toast.error(copy.toastSelectGender);
      return;
    }
    setGenerating(true);
    setGeneratingPhase(1);
    setProgress({ step: 0, message: copy.progressGenRef });
    try {
      const result = await modelAPI.generateReference(formData);
      if (result.success) {
        setReferenceUrl(result.referenceUrl);
        setPhase("preview");
        toast.success(copy.toastRefOk);
        await refreshUserCredits();
      } else {
        const msg = result.message || copy.toastRefFail;
        toast.error(msg, result.solution ? { description: result.solution, duration: 8000 } : undefined);
      }
    } catch (error) {
      console.error("Generate reference error:", error);
      const msg = error.response?.data?.message || copy.toastRefFail;
      toast.error(msg, error.response?.data?.solution ? { description: error.response.data.solution, duration: 8000 } : undefined);
    } finally {
      setGenerating(false);
      setGeneratingPhase(0);
    }
  };

  const handleRegenerateReference = async () => {
    setGenerating(true);
    setGeneratingPhase(1);
    setProgress({ step: 0, message: copy.progressRegenRef });
    try {
      const result = await modelAPI.generateReference({ ...formData, regenerate: true });
      if (result.success) {
        setReferenceUrl(result.referenceUrl);
        toast.success(copy.toastRefRegenOk);
        await refreshUserCredits();
      } else {
        const msg = result.message || copy.toastRefRegenFail;
        toast.error(msg, result.solution ? { description: result.solution, duration: 8000 } : undefined);
      }
    } catch (error) {
      console.error("Regenerate reference error:", error);
      const msg = error.response?.data?.message || copy.toastRefRegenFail;
      toast.error(msg, error.response?.data?.solution ? { description: error.response.data.solution, duration: 8000 } : undefined);
    } finally {
      setGenerating(false);
      setGeneratingPhase(0);
    }
  };

  const handleConfirmAndGenerate = async () => {
    if (!referenceUrl) {
      toast.error(copy.toastNoRef);
      return;
    }
    setGenerating(true);
    setGeneratingPhase(2);
    setProgress({ step: 1, message: copy.progressCloseSelfie });
    try {
      const result = await modelAPI.generatePoses({
        name,
        referenceUrl,
        ...posesData,
        // Pass selected profile attributes so backend can build body prompt correctly
        ...formData,
      });

      // Backend now responds immediately with status="generating" so we poll
      if ((result.modelStatus === "generating" || result.modelStatus === "processing") && result.model?.id) {
        const modelId = result.model.id;
        const POLL_INTERVAL = 5000;   // 5 s between polls
        const MAX_WAIT_MS  = 10 * 60 * 1000; // give up after 10 min
        const started = Date.now();

        setProgress({ step: 1, message: copy.progressHoldTight });

        await new Promise((resolve) => {
          const tick = async () => {
            const elapsedMin = Math.floor((Date.now() - started) / 60000);
            const elapsedSec = Math.floor(((Date.now() - started) % 60000) / 1000);
            const elapsed = elapsedMin > 0 ? `${elapsedMin}m ${elapsedSec}s` : `${elapsedSec}s`;

            try {
              const resp = await api.get(`/models/status/${modelId}`);
              const { status, model: updatedModel } = resp.data;

              // Advance step indicator as each photo URL arrives from KIE callbacks
              const p1 = updatedModel?.photo1Url?.startsWith("http");
              const p2 = updatedModel?.photo2Url?.startsWith("http");
              const p3 = updatedModel?.photo3Url?.startsWith("http");
              const doneCount = [p1, p2, p3].filter(Boolean).length;
              const stepMessages = [
                formatCopy(copy.progressPoll0, { t: elapsed }),
                formatCopy(copy.progressPoll1, { t: elapsed }),
                formatCopy(copy.progressPoll2, { t: elapsed }),
              ];
              setProgress({
                step: doneCount + 1,
                message:
                  stepMessages[doneCount] ?? formatCopy(copy.progressFinal, { t: elapsed }),
              });

              if (status === "ready") {
                await refreshUserCredits();
                toast.success(formatCopy(copy.toastModelCreated, { name }));
                onSuccess(updatedModel || result.model);
                resolve();
                return;
              }

              if (status === "failed") {
                toast.error(copy.toastGenFailed);
                resolve();
                return;
              }
            } catch (_) {
              // ignore transient poll errors
            }

            if (Date.now() - started > MAX_WAIT_MS) {
              toast(copy.toastStillGen, { icon: "⏳" });
              resolve();
              return;
            }

            setTimeout(tick, POLL_INTERVAL);
          };
          setTimeout(tick, POLL_INTERVAL);
        });

      } else if (result.success) {
        // Legacy path: backend returned a ready model synchronously
        toast.success(formatCopy(copy.toastModelCreated, { name }));
        await refreshUserCredits();
        onSuccess(result.model);
      } else {
        const msg = result.message || copy.toastPosesFail;
        toast.error(msg, result.solution ? { description: result.solution, duration: 8000 } : undefined);
      }
    } catch (error) {
      console.error("Generate poses error:", error);
      const msg = error.response?.data?.message || copy.toastPosesFail;
      toast.error(msg, error.response?.data?.solution ? { description: error.response.data.solution, duration: 8000 } : undefined);
    } finally {
      setGenerating(false);
      setGeneratingPhase(0);
      setProgress({ step: 0, message: "" });
    }
  };

  const handleFromPhotosGenerate = async () => {
    const hasAllPhotos = photoConfigs.every((c) => c.referencePhotos.length > 0);
    const hasAllPrompts = photoConfigs.every((c) => c.prompt.trim().length > 0);

    if (!hasAllPhotos) {
      toast.error(copy.toastEachPhoto);
      return;
    }
    if (!hasAllPrompts) {
      toast.error(copy.toastEachPrompt);
      return;
    }

    const ageNum = fromPhotosAge.trim() ? parseInt(fromPhotosAge, 10) : null;
    if (fromPhotosAge.trim() && (isNaN(ageNum) || ageNum < 1 || ageNum > 120)) {
      toast.error(copy.toastAgeRange);
      return;
    }

    setGenerating(true);
    setGeneratingPhase(2);
    setProgress({ step: 1, message: copy.progressCloseSelfie });

    try {
      const result = await modelAPI.generateAdvanced({
        name,
        age: ageNum ?? undefined,
        gender: fromPhotosGender || undefined,
        savedAppearance: fromPhotosLooks && Object.keys(fromPhotosLooks).length > 0 ? fromPhotosLooks : undefined,
        photoConfigs: photoConfigs.map((c) => ({
          prompt: c.prompt.trim(),
          referencePhotos: c.referencePhotos,
        })),
      });

      // Backend returns 202 immediately with status="generating" — poll until ready
      if ((result.modelStatus === "generating" || result.modelStatus === "processing") && result.model?.id) {
        const modelId = result.model.id;
        const POLL_INTERVAL = 5000;
        const MAX_WAIT_MS = 10 * 60 * 1000;
        const started = Date.now();

        setProgress({ step: 1, message: copy.progressHoldTight });

        await new Promise((resolve) => {
          const tick = async () => {
            const elapsedMin = Math.floor((Date.now() - started) / 60000);
            const elapsedSec = Math.floor(((Date.now() - started) % 60000) / 1000);
            const elapsed = elapsedMin > 0 ? `${elapsedMin}m ${elapsedSec}s` : `${elapsedSec}s`;

            try {
              const resp = await api.get(`/models/status/${modelId}`);
              const { status, model: updatedModel } = resp.data;

              // Advance step indicator as each photo URL arrives from KIE callbacks
              const p1 = updatedModel?.photo1Url?.startsWith("http");
              const p2 = updatedModel?.photo2Url?.startsWith("http");
              const p3 = updatedModel?.photo3Url?.startsWith("http");
              const doneCount = [p1, p2, p3].filter(Boolean).length;
              const stepMessages = [
                formatCopy(copy.progressPhoto1, { t: elapsed }),
                formatCopy(copy.progressPhoto23, { t: elapsed }),
                formatCopy(copy.progressAlmost, { t: elapsed }),
              ];
              setProgress({
                step: doneCount + 1,
                message: stepMessages[doneCount] ?? formatCopy(copy.progressFinal, { t: elapsed }),
              });

              if (status === "ready") {
                await refreshUserCredits();
                toast.success(formatCopy(copy.toastModelCreated, { name }));
                onSuccess(updatedModel || result.model);
                resolve();
                return;
              }
              if (status === "failed") {
                toast.error(copy.toastGenFailed);
                resolve();
                return;
              }
            } catch (_) {
              // ignore transient poll errors
            }

            if (Date.now() - started > MAX_WAIT_MS) {
              toast(copy.toastStillGen, { icon: "⏳" });
              resolve();
              return;
            }

            setTimeout(tick, POLL_INTERVAL);
          };
          setTimeout(tick, POLL_INTERVAL);
        });

      } else if (result.success) {
        // Legacy: backend returned a ready model synchronously
        toast.success(formatCopy(copy.toastModelCreated, { name }));
        await refreshUserCredits();
        onSuccess(result.model);
      } else {
        const msg = result.message || copy.failedGenModel;
        toast.error(msg, result.solution ? { description: result.solution, duration: 8000 } : undefined);
      }
    } catch (error) {
      console.error("From photos generation error:", error);
      const msg = error.response?.data?.message || copy.failedGenModel;
      const solution = error.response?.data?.solution;
      toast.error(msg, solution ? { description: solution, duration: 8000 } : undefined);
    } finally {
      setGenerating(false);
      setGeneratingPhase(0);
      setProgress({ step: 0, message: "" });
    }
  };

  const handleBackToParams = () => {
    setPhase("params");
  };

  const isFormValid = formData.gender;
  const isFromPhotosValid = photoConfigs.every(
    (c) => c.referencePhotos.length > 0 && c.prompt.trim().length > 0
  );
  const photoStepTitles = [
    copy.photoSelfieLabel,
    copy.photoPortraitLabel,
    copy.photoFullBodyLabel,
  ];

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {generating && (
          <GeneratingOverlay phase={generatingPhase} progress={progress} copy={copy} />
        )}
      </AnimatePresence>

      {phase === "params" && (
        <div className="flex gap-1.5 p-1 bg-white/5 rounded-xl mb-2">
          <button
            onClick={() => handleModeSwitch("scratch")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-all text-sm ${
              mode === "scratch"
                ? "bg-white/10 text-white border border-white/20"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
            data-testid="mode-from-scratch"
          >
            <Sparkles className="w-4 h-4" />
            {copy.modeFromScratch}
          </button>
          <button
            onClick={() => handleModeSwitch("photos")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-all text-sm ${
              mode === "photos"
                ? "bg-white/10 text-white border border-white/20"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
            data-testid="mode-from-photos"
          >
            <Camera className="w-4 h-4" />
            {copy.modeFromPhotos}
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {mode === "photos" && phase === "params" ? (
          <motion.div
            key="from-photos"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
              <p className="text-xs text-purple-300">
                {copy.fromPhotosBlurb}{" "}
                <span className="inline-flex items-center gap-0.5">
                  {fromPhotosCredits} <Coins className="w-3 h-3 text-yellow-400" />
                </span>
              </p>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08] space-y-3">
              <p className="text-xs font-medium text-white">{copy.ageGenderCaption}</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-slate-500 uppercase">{copy.ageLabel}</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={fromPhotosAge}
                    onChange={(e) => setFromPhotosAge(e.target.value)}
                    placeholder={copy.agePlaceholder}
                    className="w-16 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-slate-500 uppercase">{copy.genderLabel}</label>
                  <div className="flex gap-1">
                    {["female", "male"].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setFromPhotosGender(fromPhotosGender === g ? "" : g)}
                        className={`px-2 py-1 rounded-lg text-xs font-medium transition ${
                          fromPhotosGender === g ? "bg-purple-500/30 border border-purple-500/50 text-white" : "bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10"
                        }`}
                      >
                        {displayModelLooksOption(g, locale)}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAutoDetectLooks}
                  disabled={fromPhotosDetecting || !photoConfigs[0]?.referencePhotos?.length}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 disabled:opacity-50"
                >
                  {fromPhotosDetecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  {copy.autoDetectLooks}
                </button>
              </div>
              {fromPhotosLooks && Object.keys(fromPhotosLooks).filter((k) => k !== "age" && fromPhotosLooks[k]).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {Object.entries(fromPhotosLooks)
                    .filter(([k, v]) => k !== "age" && v != null && v !== "" && String(v).trim())
                    .map(([key, val]) => (
                      <span key={key} className="px-1.5 py-0.5 rounded-full bg-white/10 text-[10px] text-slate-300 border border-white/10">
                        {String(val)}
                      </span>
                    ))}
                </div>
              )}
            </div>

            {photoConfigs.map((config, index) => (
              <div
                key={index}
                className="rounded-xl border border-white/10 bg-white/5 overflow-hidden"
              >
                <button
                  onClick={() => toggleExpanded(index)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition"
                  data-testid={`toggle-photo-config-${index}`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      config.referencePhotos.length > 0 && config.prompt.trim()
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : "bg-white/10 text-gray-400 border border-white/10"
                    }`}>
                      {config.referencePhotos.length > 0 && config.prompt.trim() ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        index + 1
                      )}
                    </div>
                    <span className="text-sm font-medium">{photoStepTitles[index] ?? config.label}</span>
                    {config.referencePhotos.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {formatCopy(copy.photoCount, { count: config.referencePhotos.length })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {index === 0 && config.referencePhotos.length > 0 && config.prompt.trim() && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToAll(0);
                        }}
                        className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 px-2 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition"
                        data-testid="button-copy-to-all"
                      >
                        <Copy className="w-3 h-3" />
                        {copy.copyToAll}
                      </button>
                    )}
                    {config.expanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                </button>

                <AnimatePresence>
                  {config.expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4">
                        <PhotoConfigUploader
                          index={index}
                          config={config}
                          onUpdate={updatePhotoConfig}
                          disabled={generating}
                          copy={copy}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}

            <div className="flex gap-3 pt-2">
              <button
                onClick={onCancel}
                disabled={generating}
                className="flex-1 py-3 rounded-xl glass hover:bg-white/10 transition disabled:opacity-50"
                data-testid="button-cancel-from-photos"
              >
                {copy.back}
              </button>
              {user?.credits < fromPhotosCredits ? (
                <button
                  onClick={() => onNeedCredits?.()}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:scale-105 transition flex items-center justify-center gap-2"
                  data-testid="button-get-credits-from-photos"
                >
                  <CreditCard className="w-5 h-5" />
                  {copy.getCredits}{" "}
                  <span className="inline-flex items-center gap-0.5 text-yellow-400">
                    ({fromPhotosCredits} <Coins className="w-3.5 h-3.5" />)
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleFromPhotosGenerate}
                  disabled={generating || !isFromPhotosValid}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 hover:scale-105 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 font-semibold"
                  data-testid="button-generate-from-photos"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {copy.generating}
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      {copy.generateFromPhotos}{" "}
                      <span className="inline-flex items-center gap-0.5 text-yellow-400">
                        {fromPhotosCredits} <Coins className="w-3.5 h-3.5" />
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        ) : phase === "params" ? (
          <motion.div
            key="params"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-3"
          >
            {/* Model Looks — same chips + custom as edit model (single source of truth) */}
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
              <p className="text-xs font-medium text-white flex items-center gap-1.5 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                {copy.modelLooksTitle}
              </p>
              <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
                {modelLooksGroups.map((g) => {
                  const value = formData[g.key] || "";
                  const isCustom = value && !g.options.includes(value);
                  return (
                    <div key={g.key}>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                        {displayModelLooksGroupLabel(g.label, locale)}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {g.options.map((opt) => {
                          const isActive = value === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleChange(g.key, isActive ? "" : opt)}
                              className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                                isActive
                                  ? "bg-white/15 border border-white/30 text-white"
                                  : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                              }`}
                            >
                              {displayModelLooksOption(opt, locale)}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => handleChange(g.key, isCustom ? "" : " ")}
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                            isCustom ? "bg-white/15 border border-white/30 text-white" : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                          }`}
                        >
                          {copy.customChip}
                        </button>
                      </div>
                      {(isCustom || value === " ") && (
                        <input
                          type="text"
                          value={value === " " ? "" : value}
                          onChange={(e) => handleChange(g.key, e.target.value)}
                          placeholder={copy.typeCustomPlaceholder}
                          className="mt-1 w-full px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-[10px] placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
                <User className="w-3.5 h-3.5 text-purple-400" />
                {copy.ageLabel}
              </label>
              <input
                type="number"
                min="1"
                max="90"
                value={formData.age || ""}
                onChange={(e) => handleChange("age", e.target.value)}
                placeholder={copy.agePlaceholder}
                className="w-24 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                {copy.referencePromptLabel}{" "}
                <span className="text-slate-500">{copy.optional}</span>
              </label>
              <div className="flex items-center gap-1.5 text-xs text-amber-400 mb-1.5">
                <AlertTriangle className="w-3 h-3" />
                <span>{copy.referencePromptHint}</span>
              </div>
              <textarea
                value={formData.referencePrompt || ""}
                onChange={(e) => handleChange("referencePrompt", e.target.value)}
                placeholder={copy.referencePromptPlaceholder}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl focus:border-white/20 transition resize-none h-14 text-xs"
              />
            </div>

            <div className="rounded-xl p-3 border border-white/[0.08] bg-white/[0.03]">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-medium text-white">{copy.pricingTitle}</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{copy.pricingStep1}</span>
                  <span className="text-xs font-semibold text-slate-300 inline-flex items-center gap-0.5">
                    {step1Credits} <Coins className="w-3 h-3 text-yellow-400" />
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{copy.pricingStep2}</span>
                  <span className="text-xs font-semibold text-slate-300 inline-flex items-center gap-0.5">
                    +{step2Credits} <Coins className="w-3 h-3 text-yellow-400" />
                  </span>
                </div>
                <div className="border-t border-white/10 pt-1.5 mt-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-300">{copy.pricingTotal}</span>
                  <span className="text-sm font-bold text-white inline-flex items-center gap-0.5">
                    {scratchTotalCredits} <Coins className="w-3.5 h-3.5 text-yellow-400" />
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={onCancel}
                disabled={generating}
                className="flex-1 py-2.5 rounded-xl glass hover:bg-white/10 transition disabled:opacity-50 text-sm"
              >
                {copy.back}
              </button>
              {user?.credits < step1Credits ? (
                <button
                  onClick={() => onNeedCredits?.()}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:scale-105 transition flex items-center justify-center gap-2 text-sm"
                  data-testid="button-get-credits-reference"
                >
                  <CreditCard className="w-4 h-4" />
                  {copy.getCredits}{" "}
                  <span className="inline-flex items-center gap-0.5 text-yellow-400">
                    ({step1Credits} <Coins className="w-3.5 h-3.5" />)
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleGenerateReference}
                  disabled={generating || !isFormValid}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 hover:scale-105 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 text-sm"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {copy.generating}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {copy.generateReference}
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        ) : null}

        {phase === "preview" && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-5"
          >
            <div className="flex flex-col items-center text-center">
              <h3 className="text-lg font-semibold mb-1">{copy.previewTitle}</h3>
              <p className="text-xs text-slate-400 mb-4">
                {copy.previewSubtitle}
              </p>

              <img
                src={referenceUrl}
                alt={copy.refAltLarge}
                className="w-48 h-48 object-cover rounded-2xl border border-white/[0.12] mx-auto"
              />

              {/* Regenerate button — centred below image, white with purple glow */}
              <button
                onClick={handleRegenerateReference}
                disabled={generating}
                className="relative mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-black bg-white hover:bg-slate-100 transition-all disabled:opacity-50 overflow-hidden"
                style={{ boxShadow: "0 0 18px 4px rgba(139,92,246,0.35), inset 0 1px 0 rgba(255,255,255,0.5)" }}
              >
                {/* subtle purple glow chip in top-left corner */}
                <span className="pointer-events-none absolute top-0 left-0 w-12 h-12 rounded-full bg-purple-400/40 blur-xl -translate-x-4 -translate-y-4" />
                <RefreshCw className={`w-4 h-4 relative z-10 text-black ${generating ? "animate-spin" : ""}`} />
                <span className="relative z-10">{copy.regenerateFace}</span>
                <span className="relative z-10 inline-flex items-center gap-1 bg-black/10 px-1.5 py-0.5 rounded-full text-xs text-black">
                  <Coins className="w-3 h-3 text-yellow-400" />
                  {step1Credits}
                </span>
              </button>
            </div>

            <div className="border-t border-white/10 pt-4">
              <h4 className="text-sm font-semibold text-white mb-4">
                {copy.customizePoses}
              </h4>
            </div>

            <div className="hidden">
              <label className="flex items-center gap-2 text-sm font-medium mb-3">
                <Shirt className="w-4 h-4 text-pink-400" />
                Outfit Type
              </label>
              <div className="grid grid-cols-4 gap-2">
                {OUTFIT_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() =>
                      handlePosesChange("outfitType", option.value)
                    }
                    className={`py-2 px-2 rounded-lg border transition-all text-center ${
                      posesData.outfitType === option.value
                        ? "border-pink-500 bg-pink-500/20"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <span
                      className={`block text-xs font-medium ${
                        posesData.outfitType === option.value
                          ? "text-white"
                          : "text-gray-300"
                      }`}
                    >
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden">
              <label className="flex items-center gap-2 text-sm font-medium mb-3">
                <Heart className="w-4 h-4 text-pink-400" />
                Pose Style
              </label>
              <div className="grid grid-cols-3 gap-2">
                {POSE_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handlePosesChange("poseStyle", option.value)}
                    className={`py-2 px-2 rounded-lg border transition-all text-center ${
                      posesData.poseStyle === option.value
                        ? "border-pink-500 bg-pink-500/20"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <span
                      className={`block text-xs font-medium ${
                        posesData.poseStyle === option.value
                          ? "text-white"
                          : "text-gray-300"
                      }`}
                    >
                      {option.label}
                    </span>
                    <span className="block text-[10px] text-gray-500 mt-0.5">
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden">
              <label className="flex items-center gap-2 text-sm font-medium mb-2">
                <MessageSquare className="w-4 h-4 text-pink-400" />
                Poses Prompt (Optional)
              </label>
              <div className="flex items-center gap-2 text-xs text-green-400 mb-2">
                <Check className="w-3 h-3" />
                <span>Can include explicit/suggestive content</span>
              </div>
              <textarea
                value={posesData.posesPrompt}
                onChange={(e) =>
                  handlePosesChange("posesPrompt", e.target.value)
                }
                placeholder="Customize your model poses... e.g., 'bedroom setting, soft lighting, sensual mood'"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-pink-500 transition resize-none h-16 text-sm"
              />
            </div>

            {/* "Finish Your AI Model" card — white border, 5% white bg, purple top-left glow */}
            <div
              className="relative rounded-xl p-4 overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              {/* purple top-left corner glow */}
              <span className="pointer-events-none absolute top-0 left-0 w-24 h-24 rounded-full bg-purple-500/30 blur-2xl -translate-x-6 -translate-y-6" />
              <div className="relative flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">{copy.finishCardTitle}</span>
                <span className="text-xs font-semibold text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  {copy.finishCardBadge}
                </span>
              </div>
              <p className="relative text-xs text-slate-500">
                {copy.finishCardBody}
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleBackToParams}
                disabled={generating}
                className="py-3 px-4 rounded-xl glass hover:bg-white/10 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                {copy.edit}
              </button>
              {user?.credits < step2Credits ? (
                <button
                  type="button"
                  onClick={() => onNeedCredits?.()}
                  disabled={generating}
                  className="relative flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:scale-[1.02] transition disabled:opacity-50 flex items-center justify-center gap-2 font-semibold"
                >
                  <CreditCard className="w-5 h-5 relative z-10" />
                  <span className="relative z-10 inline-flex items-center gap-1">
                    {copy.getCredits} ({step2Credits}
                    <Coins className="w-4 h-4 text-yellow-200" />)
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleConfirmAndGenerate}
                  disabled={generating}
                  className="relative flex-1 py-3 rounded-xl border border-white/20 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/35 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold overflow-hidden"
                  style={{ boxShadow: "0 0 20px 4px rgba(139,92,246,0.25), inset 0 1px 0 rgba(255,255,255,0.07)" }}
                >
                  <span className="pointer-events-none absolute top-0 left-0 w-28 h-28 rounded-full bg-purple-500/25 blur-2xl -translate-x-8 -translate-y-8" />
                  {generating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin relative z-10" />
                      <span className="relative z-10">{copy.generating}</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-5 h-5 relative z-10" />
                      <span className="relative z-10">{copy.generateModel}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

