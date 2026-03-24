import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Check, Sparkles, ImagePlus } from "lucide-react";
import { useDropzone } from "react-dropzone";
import toast from "react-hot-toast";
import { uploadToCloudinary as uploadFile } from "../services/api";
import api from "../services/api";
import GenerateAIModelForm from "./GenerateAIModelForm";

const LOCALE_STORAGE_KEY = "app_locale";
const TABS = {
  UPLOAD: "upload",
  GENERATE: "generate",
};
const COPY = {
  en: {
    photoUploaded: "Photo uploaded!",
    uploadFailed: "Upload failed",
    fillAllFields: "Please fill all fields",
    modelCreated: 'Model "{name}" created!',
    createModelFailed: "Failed to create model",
    modelName: "Model Name",
    modelNamePlaceholder: "e.g. Sophia",
    uploadPhotos: "Upload Photos",
    generateAiModel: "Generate AI Model",
    photo1Label: "Photo 1 — Close-up Selfie",
    photo1Desc: "Clear face shot, well-lit",
    photo2Label: "Photo 2 — Face Portrait",
    photo2Desc: "Different angle, natural expression",
    photo3Label: "Photo 3 — Full Body Shot",
    photo3Desc: "Shows full figure, good lighting",
    cancel: "Cancel",
    creating: "Creating…",
    createModel: "Create Model",
    enterNameToContinue: "Please enter a model name above to continue",
    uploading: "Uploading…",
    uploaded: "Uploaded",
    dropHere: "Drop here",
    clickOrDrag: "Click or drag photo",
  },
  ru: {
    photoUploaded: "Фото загружено!",
    uploadFailed: "Ошибка загрузки",
    fillAllFields: "Пожалуйста, заполните все поля",
    modelCreated: 'Модель "{name}" создана!',
    createModelFailed: "Не удалось создать модель",
    modelName: "Имя модели",
    modelNamePlaceholder: "например, София",
    uploadPhotos: "Загрузить фото",
    generateAiModel: "Сгенерировать ИИ-модель",
    photo1Label: "Фото 1 — Крупный план (селфи)",
    photo1Desc: "Чёткое лицо, хорошее освещение",
    photo2Label: "Фото 2 — Портрет лица",
    photo2Desc: "Другой ракурс, естественное выражение",
    photo3Label: "Фото 3 — В полный рост",
    photo3Desc: "Видна фигура полностью, хорошее освещение",
    cancel: "Отмена",
    creating: "Создание…",
    createModel: "Создать модель",
    enterNameToContinue: "Сначала введите имя модели выше",
    uploading: "Загрузка…",
    uploaded: "Загружено",
    dropHere: "Отпустите файл здесь",
    clickOrDrag: "Нажмите или перетащите фото",
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

function formatCopy(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? `{${key}}` : String(vars[key]),
  );
}

export default function CreateModelModal({ isOpen, onClose, onSuccess, onNeedCredits, initialMode, sidebarCollapsed = false }) {
  const copy = COPY[resolveLocale()] || COPY.en;
  const [activeTab, setActiveTab] = useState(initialMode === "generate" ? TABS.GENERATE : TABS.UPLOAD);
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState({
    photo1: null,
    photo2: null,
    photo3: null,
  });
  const [uploading, setUploading] = useState({
    photo1: false,
    photo2: false,
    photo3: false,
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialMode === "generate" ? TABS.GENERATE : TABS.UPLOAD);
    }
  }, [isOpen, initialMode]);

  const handleUpload = async (file, photoKey) => {
    setUploading((prev) => ({ ...prev, [photoKey]: true }));
    try {
      const url = await uploadFile(file);
      setPhotos((prev) => ({ ...prev, [photoKey]: url }));
      toast.success(copy.photoUploaded);
    } catch (error) {
      toast.error(copy.uploadFailed);
    } finally {
      setUploading((prev) => ({ ...prev, [photoKey]: false }));
    }
  };

  const handleCreate = async () => {
    if (!name || !photos.photo1 || !photos.photo2 || !photos.photo3) {
      toast.error(copy.fillAllFields);
      return;
    }
    setCreating(true);
    try {
      const response = await api.post("/models", {
        name,
        photo1Url: photos.photo1,
        photo2Url: photos.photo2,
        photo3Url: photos.photo3,
      });
      if (response.data.success) {
        toast.success(formatCopy(copy.modelCreated, { name }));
        onSuccess();
        handleClose();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || copy.createModelFailed);
    } finally {
      setCreating(false);
    }
  };

  const handleAIModelSuccess = (model) => {
    onSuccess();
    handleClose();
  };

  const handleClose = () => {
    setName("");
    setPhotos({ photo1: null, photo2: null, photo3: null });
    setActiveTab(TABS.UPLOAD);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60]"
          />

          {/* Centering wrapper — sidebar-aware */}
          <div
            className={`fixed top-0 right-0 bottom-0 z-[60] overflow-y-auto p-4 left-0 ${
              sidebarCollapsed ? "md:left-[80px]" : "md:left-[260px]"
            }`}
            onClick={handleClose}
          >
            <div className="relative min-h-full flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.18 }}
              className="relative w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden flex flex-col glass-panel-strong"
              style={{ maxHeight: "calc(100dvh - 48px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleClose}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-500 hover:text-white transition-colors z-10"
                data-testid="button-close-create-modal"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="px-4 pt-4 pb-2 pr-12 shrink-0">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {copy.modelName}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={copy.modelNamePlaceholder}
                  className="w-full px-3 py-2.5 text-sm glass-card rounded-xl focus:border-white/20 transition"
                  data-testid="input-model-name"
                />
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto overscroll-contain flex-1 px-4 pb-4 space-y-4">

                {/* Tab switcher */}
                <div className="flex gap-1.5 p-1 glass-card rounded-xl">
                  <button
                    onClick={() => setActiveTab(TABS.UPLOAD)}
                    className={`relative overflow-hidden flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-all text-sm ${
                      activeTab === TABS.UPLOAD
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                    data-testid="tab-upload"
                  >
                    {activeTab === TABS.UPLOAD && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                    )}
                    <ImagePlus className="w-4 h-4" />
                    <span className="font-medium">{copy.uploadPhotos}</span>
                  </button>
                  <button
                    onClick={() => setActiveTab(TABS.GENERATE)}
                    className={`relative overflow-hidden flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg transition-all text-sm ${
                      activeTab === TABS.GENERATE
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                    data-testid="tab-generate"
                  >
                    {activeTab === TABS.GENERATE && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                    )}
                    <Sparkles className="w-4 h-4" />
                    <span className="font-medium">{copy.generateAiModel}</span>
                  </button>
                </div>

                {/* Tab content */}
                <AnimatePresence mode="wait">
                  {activeTab === TABS.UPLOAD ? (
                    <motion.div
                      key="upload"
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-3"
                    >
                      <PhotoUpload
                        label={copy.photo1Label}
                        description={copy.photo1Desc}
                        photo={photos.photo1}
                        uploading={uploading.photo1}
                        onUpload={(file) => handleUpload(file, "photo1")}
                      />
                      <PhotoUpload
                        label={copy.photo2Label}
                        description={copy.photo2Desc}
                        photo={photos.photo2}
                        uploading={uploading.photo2}
                        onUpload={(file) => handleUpload(file, "photo2")}
                      />
                      <PhotoUpload
                        label={copy.photo3Label}
                        description={copy.photo3Desc}
                        photo={photos.photo3}
                        uploading={uploading.photo3}
                        onUpload={(file) => handleUpload(file, "photo3")}
                      />

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleClose}
                          className="flex-1 py-2.5 rounded-xl glass hover:bg-white/10 transition text-sm font-medium"
                          data-testid="button-cancel-upload"
                        >
                          {copy.cancel}
                        </button>
                        <button
                          onClick={handleCreate}
                          disabled={creating || !name || !photos.photo1 || !photos.photo2 || !photos.photo3}
                          className="flex-1 py-2.5 rounded-xl btn-primary-glass transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium"
                          data-testid="button-create-model"
                        >
                          {creating ? (
                            <>
                              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                              {copy.creating}
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4" />
                              {copy.createModel}
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="generate"
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.15 }}
                    >
                      {!name ? (
                        <div className="text-center py-10">
                          <Sparkles className="w-10 h-10 text-purple-400 mx-auto mb-3 opacity-50" />
                          <p className="text-sm text-gray-400">
                            {copy.enterNameToContinue}
                          </p>
                        </div>
                      ) : (
                        <GenerateAIModelForm
                          name={name}
                          copy={copy}
                          onSuccess={handleAIModelSuccess}
                          onCancel={() => setActiveTab(TABS.UPLOAD)}
                          onNeedCredits={onNeedCredits}
                        />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
            </div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function PhotoUpload({ label, description, photo, uploading, onUpload }) {
  const copy = COPY[resolveLocale()] || COPY.en;
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => onUpload(files[0]),
    accept: { "image/jpeg": [], "image/png": [] },
    multiple: false,
  });

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span className="text-[11px] text-slate-500">{description}</span>
      </div>

      <div
        {...getRootProps()}
        className={`
          relative border border-dashed rounded-xl cursor-pointer h-16
          transition overflow-hidden flex items-center justify-center
          ${isDragActive ? "border-purple-500 bg-purple-500/10" : "border-white/15 bg-white/[0.03]"}
          ${uploading ? "pointer-events-none" : "hover:border-white/30 hover:bg-white/[0.06]"}
        `}
      >
        <input {...getInputProps()} />

        {uploading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-xs">{copy.uploading}</span>
          </div>
        ) : photo ? (
          <>
            <img src={photo} alt={label} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-1.5">
              <div className="flex items-center gap-1.5 bg-green-500/90 px-2.5 py-1 rounded-lg text-xs font-medium">
                <Check className="w-3 h-3" />
                {copy.uploaded}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-slate-500">
            <Upload className="w-4 h-4" />
            <span className="text-xs">
              {isDragActive ? copy.dropHere : copy.clickOrDrag}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
