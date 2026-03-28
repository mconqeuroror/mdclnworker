import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Image as ImageIcon,
  Video,
  Sparkles,
  Download,
  AlertTriangle,
  Check,
  CheckCircle2,
  RefreshCcw,
  RotateCcw,
  Zap,
  Camera,
  Upload,
  X,
  Loader2,
  Play,
  BookOpen,
  Pause,
  User,
  Users,
  Shield,
  Mic,
  Heart,
  Volume2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Grid3X3,
  Info,
  Shirt,
  Coins,
} from "lucide-react";

/** Video recreate per-second defaults (align with server `generation-pricing.service`) */
const VIDEO_RECREATE_CLASSIC_PER_SEC = 10; // kling-2.6 motion-control 1080p
const VIDEO_RECREATE_ULTRA_PER_SEC = 20; // kling-3.0 motion-control 1080p

const LOCALE_STORAGE_KEY = "app_locale";
const GENERATE_COPY = {
  en: {
    title: "Generate Content",
    subtitle: "Create stunning AI-powered images and videos",
    tabImage: "Image",
    tabImageSub: "AI Photos",
    tabVideo: "Video",
    tabVideoSub: "AI Videos",
    retry: "Retry",
    errorContentLoad:
      "Couldn't load your content. You can still generate; history may be missing until refreshed.",
    modelSelectorNoModels: "No models available",
    modelSelectorChooseModel: "Choose a model",
    modelSelectorLabel: "Select Model",
    boundaryTitle: "Generator couldn't load",
    boundaryMessageDefault: "An error occurred. Try refreshing the page.",
    refresh: "Refresh",
    identityReferenceImage: "Reference Image",
    identityReferenceImageHint: "Upload the scene/pose you want to recreate",
    identityClothingStyle: "Clothing Style",
    identityClothingModel: "Model",
    identityClothingSource: "Source",
    identityExtraDirections: "Extra directions (optional)",
    identityExtraDirectionsHint:
      "Added after the built-in identity rules. Use for tweaks: colors, jewelry, makeup, small props — likeness still comes from your model photos.",
    identityExtraDirectionsPlaceholder: "e.g. gold hoop earrings, deeper red lipstick",
    getCredits: "Get Credits",
    generating: "Generating...",
    generateImage: "Generate Image",
    faceswapTargetImage: "Target Image",
    faceswapTargetImageHint: "The image where you want to replace the face",
    faceswapSourceFace: "Source Face",
    faceswapSourceFaceHint: "The face you want to swap in (your AI model or any face)",
    faceswapSwapping: "Swapping Face...",
    faceswapAction: "Swap Face",
    videoRecreateStartingImage: "Starting Image",
    videoRecreateReferenceVideo: "Reference Video",
    videoRecreateUltraBadge: "ULTRA",
    videoRecreateClassicBadge: "CLASSIC",
    videoRecreateUltraDesc: "Motion Control Pro+ · 1080p",
    videoRecreateClassicDesc: "Motion Control 2.6 · 1080p",
    videoRecreateClassicInfoPrefix: "Classic (default):",
    videoRecreateClassicInfoValue: "Motion Control 2.6 · 1080p",
    videoRecreateUltraToggleTitle: "Ultra — Motion Control Pro+",
    videoRecreateUltraToggleDesc: "1080p",
    videoRecreatePromptLabel: "Prompt",
    optional: "(Optional)",
    videoRecreatePromptPlaceholder: "e.g., dancing energetically, smiling at camera...",
    videoKeepAudio: "Keep audio",
    on: "(ON)",
    off: "(OFF)",
    generateVideo: "Generate Video",
    promptVideoStartFrame: "Start Frame",
    promptVideoMotionPrompt: "Motion Prompt",
    promptVideoMotionPromptPlaceholder: "Example: Camera slowly zooms in, person smiles and waves...",
    promptVideoDuration: "Duration",
    promptVideoDuration5: "5 seconds",
    promptVideoDuration10: "10 seconds",
    promptVideoAction: "Generate",
    modeIdentityTitle: "Model + Reference Image",
    modePromptTitle: "Model + Text Prompt",
    modeFaceswapTitle: "Swap Face in Image",
    sourceUpload: "Upload",
    sourceGallery: "Gallery",
    galleryEmpty: "No generated images yet for this model.",
    modelHintTapToClose: "Tap to close",
    modelHintTapToChange: "Tap to change",
    modelHintCreateInModels: "Create one in Models tab",
    modelHintAvailableCount: "{count} available",
    advancedReferenceImages: "Reference Images",
    advancedReferenceImagesHint: "Add one or more references (optional but recommended)",
    advancedAddReference: "Add reference",
    advancedMaxReferences: "Up to {count} images",
    advancedPrompt: "Prompt",
    advancedPromptPlaceholderNano:
      "Describe the scene (AI will turn this into an NSFW Danbooru tag prompt)…",
    advancedPromptPlaceholderSeedream:
      "Describe the scene (AI will build a cinema-grade SFW superprompt)…",
    advancedEnhancePrompt: "Enhance Prompt",
    advancedEnhancingPrompt: "Enhancing...",
    advancedGenerate: "Generate",
    advancedNeedPromptFirst: "Please enter a prompt first",
    advancedToastNeedModel: "Please select a model",
    advancedToastNeedPrompt: "Please enter a prompt",
    advancedToastEnhanceFailed: "Failed to enhance prompt",
    advancedToastUploadFailed: "Failed to upload reference image",
    advancedToastGenerateFailed: "Generation failed",
    promptModePromptPlaceholder: "Describe the image you want to generate...",
    promptModeAdvancedOptions: "Advanced options",
    promptModeNegativePrompt: "Negative Prompt",
    promptModeNegativePromptPlaceholder: "What to avoid...",
    promptModeSeed: "Seed (optional)",
    promptModeSeedPlaceholder: "Random by default",
    promptModeStyle: "Style",
    promptModeStyleRealistic: "Realistic",
    promptModeStyleAnime: "Anime",
    promptModeStyleCinematic: "Cinematic",
    promptModeStyleFantasy: "Fantasy",
    promptModeToastNeedModel: "Please select a model",
    promptModeToastNeedPrompt: "Please enter a prompt",
    promptModeToastGenerateFailed: "Failed to generate image",
    videoTitle: "Generate Video",
    videoSubtitle: "Create AI videos from images and prompts",
    videoMethodRecreate: "Recreate Video",
    videoMethodPrompt: "Prompt Video",
    videoMethodFaceswap: "Face Swap Video",
    videoMethodTalking: "Talking Head",
    videoMethodRecreateDesc: "Recreate motion from a reference video",
    videoMethodPromptDesc: "Animate from a start frame and prompt",
    videoMethodFaceswapDesc: "Swap face in an existing video",
    videoMethodTalkingDesc: "Make a portrait talk with text/voice",
    faceswapVideoSourceVideo: "Source Video",
    faceswapVideoTargetGender: "Target Gender",
    faceswapVideoGenderFemale: "Female",
    faceswapVideoGenderMale: "Male",
    faceswapVideoAction: "Face Swap",
    talkingHeadPortraitImage: "Portrait Image",
    talkingHeadVoice: "Voice",
    talkingHeadVoiceLoading: "Loading voices...",
    talkingHeadVoiceEmpty: "No voices found",
    talkingHeadVoiceRetry: "Retry",
    talkingHeadInputModeText: "Text to Speech",
    talkingHeadInputModeAudio: "Audio Upload",
    talkingHeadTextLabel: "Speech Text",
    talkingHeadTextPlaceholder: "Type what the avatar should say...",
    talkingHeadAudioLabel: "Audio File",
    talkingHeadAudioHint: "Upload WAV or MP3 (max {seconds}s)",
    talkingHeadLanguageFilter: "Language",
    talkingHeadLanguageAll: "All",
    talkingHeadEmotion: "Emotion",
    identityToastSelectModelAndTarget: "Please select model and upload target image",
    identityToastLoginRequired: "Please log in to generate.",
    identityToastQueued: "Queued! You can generate again while it processes.",
    faceswapImageToastNeedBothImages: "Please upload both target image and source face",
    faceswapImageToastStarted: "Face swap started! Check Live Preview.",
    faceswapImageToastFailed: "Failed to swap face. Please try again.",
    modeSelectLabel: "Select Mode",
    modeAdvancedToggle: "Advanced",
    modeIdentity: "Identity Recreation",
    modePromptToImage: "Prompt to Image",
    modeFaceSwap: "Face Swap",
    advancedEngineLabel: "AI Engine",
    advancedEngineUltraRealism: "Ultra Realism",
    advancedEngineUncensoredPlus: "Uncensored+",
    advancedToastNeedModelFirst: "Please select a model first",
    advancedToastCreateModelFirst: "Create a model first!",
    historyIdentityRecreations: "Identity Recreations",
    historyAdvancedGenerations: "Advanced Generations",
    historyFaceSwaps: "Face Swaps",
    videoToastPromptRequired: "Please enter a prompt",
    videoFaceswapToastStarted: "Face swap started! Check Live Preview",
    videoMethodFaceSwapShort: "Face Swap",
    videoNoticeAdvancedMotionTitle: "Advanced Motion Control AI:",
    videoNoticeAdvancedMotionBody:
      "Ideal for copying dances, movements, and poses into video. May take 15-20 minutes to complete.",
    videoHistoryFaceSwapVideos: "Face Swap Videos",
    talkingHeadOpenVoiceStudio: "Open Voice Studio…",
    talkingHeadDefaultVoiceReady: "Default model voice ready",
    talkingHeadLanguageSk: "Slovak",
    talkingHeadLanguageCs: "Czech",
    talkingHeadEnhanceWithAi: "Enhance with AI",
    talkingHeadTutorialFaceswapVideo: "Face Swap Video Tutorial",
  },
  ru: {
    title: "Создание контента",
    subtitle: "Создавайте впечатляющие изображения и видео с помощью ИИ",
    tabImage: "Изображение",
    tabImageSub: "ИИ-фото",
    tabVideo: "Видео",
    tabVideoSub: "ИИ-видео",
    retry: "Повторить",
    errorContentLoad:
      "Не удалось загрузить ваш контент. Вы всё равно можете генерировать; история может быть недоступна до обновления страницы.",
    modelSelectorNoModels: "Нет доступных моделей",
    modelSelectorChooseModel: "Выберите модель",
    modelSelectorLabel: "Выбор модели",
    boundaryTitle: "Генератор не загрузился",
    boundaryMessageDefault: "Произошла ошибка. Попробуйте обновить страницу.",
    refresh: "Обновить",
    identityReferenceImage: "Референсное изображение",
    identityReferenceImageHint: "Загрузите сцену или позу, которую хотите воспроизвести",
    identityClothingStyle: "Стиль одежды",
    identityClothingModel: "Модель",
    identityClothingSource: "Источник",
    identityExtraDirections: "Дополнительные указания (необязательно)",
    identityExtraDirectionsHint:
      "Добавляются после встроенных правил идентификации. Используйте для уточнений: цвета, украшения, макияж, мелкие аксессуары — сходство по-прежнему определяется фотографиями вашей модели.",
    identityExtraDirectionsPlaceholder: "например, золотые серьги-кольца, насыщенная красная помада",
    getCredits: "Получить кредиты",
    generating: "Генерация...",
    generateImage: "Создать изображение",
    faceswapTargetImage: "Целевое изображение",
    faceswapTargetImageHint: "Изображение, на котором нужно заменить лицо",
    faceswapSourceFace: "Исходное лицо",
    faceswapSourceFaceHint: "Лицо, которое нужно подставить (ваша ИИ-модель или любое другое лицо)",
    faceswapSwapping: "Замена лица...",
    faceswapAction: "Заменить лицо",
    videoRecreateStartingImage: "Начальный кадр",
    videoRecreateReferenceVideo: "Референсное видео",
    videoRecreateUltraBadge: "ULTRA",
    videoRecreateClassicBadge: "CLASSIC",
    videoRecreateUltraDesc: "Motion Control Pro+ · 1080p",
    videoRecreateClassicDesc: "Motion Control 2.6 · 1080p",
    videoRecreateClassicInfoPrefix: "Classic (по умолчанию):",
    videoRecreateClassicInfoValue: "Motion Control 2.6 · 1080p",
    videoRecreateUltraToggleTitle: "Ultra — Motion Control Pro+",
    videoRecreateUltraToggleDesc: "1080p",
    videoRecreatePromptLabel: "Промпт",
    optional: "(Необязательно)",
    videoRecreatePromptPlaceholder: "например, энергично танцует, улыбается в камеру...",
    videoKeepAudio: "Сохранить звук",
    on: "(ВКЛ)",
    off: "(ВЫКЛ)",
    generateVideo: "Создать видео",
    promptVideoStartFrame: "Начальный кадр",
    promptVideoMotionPrompt: "Промпт движения",
    promptVideoMotionPromptPlaceholder:
      "Пример: Камера медленно приближается, человек улыбается и машет рукой...",
    promptVideoDuration: "Длительность",
    promptVideoDuration5: "5 секунд",
    promptVideoDuration10: "10 секунд",
    promptVideoAction: "Создать",
    modeIdentityTitle: "Модель + Референсное изображение",
    modePromptTitle: "Модель + Текстовый промпт",
    modeFaceswapTitle: "Замена лица на изображении",
    sourceUpload: "Загрузить",
    sourceGallery: "Галерея",
    galleryEmpty: "Нет сгенерированных изображений для этой модели.",
    modelHintTapToClose: "Нажмите, чтобы закрыть",
    modelHintTapToChange: "Нажмите, чтобы изменить",
    modelHintCreateInModels: "Создайте во вкладке «Модели»",
    modelHintAvailableCount: "Доступно: {count}",
    advancedReferenceImages: "Референсные изображения",
    advancedReferenceImagesHint: "Добавьте один или несколько референсов (необязательно, но рекомендуется)",
    advancedAddReference: "Добавить референс",
    advancedMaxReferences: "До {count} изображений",
    advancedPrompt: "Промпт",
    advancedPromptPlaceholderNano:
      "Опишите сцену (ИИ преобразует это в NSFW-промпт в формате Danbooru)…",
    advancedPromptPlaceholderSeedream:
      "Опишите сцену (ИИ создаст профессиональный SFW-промпт кинематографического уровня)…",
    advancedEnhancePrompt: "Улучшить промпт",
    advancedEnhancingPrompt: "Улучшение...",
    advancedGenerate: "Создать",
    advancedNeedPromptFirst: "Пожалуйста, введите промпт",
    advancedToastNeedModel: "Пожалуйста, выберите модель",
    advancedToastNeedPrompt: "Пожалуйста, введите промпт",
    advancedToastEnhanceFailed: "Не удалось улучшить промпт",
    advancedToastUploadFailed: "Не удалось загрузить референсное изображение",
    advancedToastGenerateFailed: "Ошибка генерации",
    promptModePromptPlaceholder: "Опишите изображение, которое хотите создать...",
    promptModeAdvancedOptions: "Расширенные настройки",
    promptModeNegativePrompt: "Негативный промпт",
    promptModeNegativePromptPlaceholder: "Что исключить...",
    promptModeSeed: "Сид (необязательно)",
    promptModeSeedPlaceholder: "По умолчанию случайный",
    promptModeStyle: "Стиль",
    promptModeStyleRealistic: "Реалистичный",
    promptModeStyleAnime: "Аниме",
    promptModeStyleCinematic: "Кинематографический",
    promptModeStyleFantasy: "Фэнтези",
    promptModeToastNeedModel: "Пожалуйста, выберите модель",
    promptModeToastNeedPrompt: "Пожалуйста, введите промпт",
    promptModeToastGenerateFailed: "Не удалось создать изображение",
    videoTitle: "Создание видео",
    videoSubtitle: "Создавайте ИИ-видео из изображений и промптов",
    videoMethodRecreate: "Воссоздать видео",
    videoMethodPrompt: "Видео по промпту",
    videoMethodFaceswap: "Замена лица в видео",
    videoMethodTalking: "Говорящий персонаж",
    videoMethodRecreateDesc: "Воссоздайте движение из референсного видео",
    videoMethodPromptDesc: "Анимируйте из начального кадра и промпта",
    videoMethodFaceswapDesc: "Замените лицо в существующем видео",
    videoMethodTalkingDesc: "Заставьте портрет говорить с помощью текста или голоса",
    faceswapVideoSourceVideo: "Исходное видео",
    faceswapVideoTargetGender: "Пол персонажа",
    faceswapVideoGenderFemale: "Женский",
    faceswapVideoGenderMale: "Мужской",
    faceswapVideoAction: "Заменить лицо",
    talkingHeadPortraitImage: "Портретное изображение",
    talkingHeadVoice: "Голос",
    talkingHeadVoiceLoading: "Загрузка голосов...",
    talkingHeadVoiceEmpty: "Голоса не найдены",
    talkingHeadVoiceRetry: "Повторить",
    talkingHeadInputModeText: "Синтез речи из текста",
    talkingHeadInputModeAudio: "Загрузка аудио",
    talkingHeadTextLabel: "Текст речи",
    talkingHeadTextPlaceholder: "Введите, что должен сказать аватар...",
    talkingHeadAudioLabel: "Аудиофайл",
    talkingHeadAudioHint: "Загрузите WAV или MP3 (макс. {seconds} сек.)",
    talkingHeadLanguageFilter: "Язык",
    talkingHeadLanguageAll: "Все",
    talkingHeadEmotion: "Эмоция",
    identityToastSelectModelAndTarget: "Пожалуйста, выберите модель и загрузите целевое изображение",
    identityToastLoginRequired: "Пожалуйста, войдите в систему для генерации.",
    identityToastQueued: "В очереди! Вы можете продолжать генерировать, пока идёт обработка.",
    faceswapImageToastNeedBothImages: "Пожалуйста, загрузите целевое изображение и исходное лицо",
    faceswapImageToastStarted: "Замена лица запущена! Проверьте раздел «Живой просмотр».",
    faceswapImageToastFailed: "Не удалось заменить лицо. Пожалуйста, попробуйте ещё раз.",
    modeSelectLabel: "Выбор режима",
    modeAdvancedToggle: "Расширенный",
    modeIdentity: "Воссоздание личности",
    modePromptToImage: "Изображение по промпту",
    modeFaceSwap: "Замена лица",
    advancedEngineLabel: "ИИ-движок",
    advancedEngineUltraRealism: "Ultra Realism",
    advancedEngineUncensoredPlus: "Uncensored+",
    advancedToastNeedModelFirst: "Пожалуйста, сначала выберите модель",
    advancedToastCreateModelFirst: "Сначала создайте модель!",
    historyIdentityRecreations: "Воссоздания личности",
    historyAdvancedGenerations: "Расширенные генерации",
    historyFaceSwaps: "Замены лица",
    videoToastPromptRequired: "Пожалуйста, введите промпт",
    videoFaceswapToastStarted: "Замена лица запущена! Проверьте раздел «Живой просмотр»",
    videoMethodFaceSwapShort: "Замена лица",
    videoNoticeAdvancedMotionTitle: "Продвинутый ИИ контроля движения:",
    videoNoticeAdvancedMotionBody:
      "Идеально подходит для копирования танцев, движений и поз в видео. Обработка может занять 15–20 минут.",
    videoHistoryFaceSwapVideos: "Видео с заменой лица",
    talkingHeadOpenVoiceStudio: "Открыть голосовую студию…",
    talkingHeadDefaultVoiceReady: "Голос модели по умолчанию готов",
    talkingHeadLanguageSk: "Словацкий",
    talkingHeadLanguageCs: "Чешский",
    talkingHeadEnhanceWithAi: "Улучшить с помощью ИИ",
    talkingHeadTutorialFaceswapVideo: "Обучение: замена лица в видео",
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

function getGenerateCopy() {
  const locale = resolveLocale();
  return GENERATE_COPY[locale] || GENERATE_COPY.en;
}

// Gallery Image Picker - lets user pick from previously generated images
function GalleryImagePicker({ modelId, selectedImage, onSelect, accentColor = "purple" }) {
  const [page, setPage] = useState(1);
  const pageSize = 8;

  useEffect(() => { setPage(1); }, [modelId]);

  const { data, isLoading } = useQuery({
    queryKey: ["gallery-picker-images", modelId],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: "completed",
        limit: "200",
        offset: "0",
      });
      if (modelId) params.set("modelId", modelId);
      const response = await api.get(`/generations?${params}`);
      const allGens = (response.data.generations || []).filter(
        g => g.outputUrl && !g.outputUrl.endsWith(".mp4") && !g.outputUrl.endsWith(".webm")
      );
      const allUrls = [];
      for (const gen of allGens) {
        let urls = [];
        try { const p = JSON.parse(gen.outputUrl); if (Array.isArray(p)) urls = p.filter(u => !u.endsWith(".mp4") && !u.endsWith(".webm")); } catch {}
        if (urls.length === 0 && gen.outputUrl && !gen.outputUrl.endsWith(".mp4") && !gen.outputUrl.endsWith(".webm")) urls = [gen.outputUrl];
        for (const url of urls) allUrls.push({ id: gen.id, url });
      }
      return allUrls;
    },
    enabled: !!modelId,
    staleTime: 30000,
  });

  const allImages = data || [];
  const totalPages = Math.ceil(allImages.length / pageSize);
  const pageImages = allImages.slice((page - 1) * pageSize, page * pageSize);

  const accentColors = {
    purple: { ring: "ring-white/20", border: "border-white/30", bg: "bg-white/10", icon: "text-white/70" },
    cyan: { ring: "ring-cyan-500/30", border: "border-cyan-500", bg: "bg-cyan-500/20", icon: "text-cyan-400" },
    orange: { ring: "ring-orange-500/30", border: "border-orange-500", bg: "bg-orange-500/20", icon: "text-orange-400" },
    pink: { ring: "ring-pink-500/30", border: "border-pink-500", bg: "bg-pink-500/20", icon: "text-pink-400" },
  };
  const colors = accentColors[accentColor] || accentColors.purple;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (allImages.length === 0) {
    return (
      <p className="text-center text-slate-500 py-6 text-xs">
        {getGenerateCopy().galleryEmpty}
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {pageImages.map((img) => {
          const isSelected = selectedImage === img.url;
          return (
            <button
              key={`${img.id}-${img.url}`}
              onClick={() => onSelect(isSelected ? null : img.url)}
              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                isSelected
                  ? `${colors.border} ring-2 ${colors.ring} scale-[1.03]`
                  : "border-transparent hover:border-white/20"
              }`}
              data-testid={`button-gallery-pick-${img.id}`}
            >
              <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
              {isSelected && (
                <div className={`absolute inset-0 ${colors.bg} flex items-center justify-center`}>
                  <CheckCircle2 className={`w-5 h-5 ${colors.icon}`} />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 rounded-lg glass-card disabled:opacity-30">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-slate-400">{page}/{totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 rounded-lg glass-card disabled:opacity-30">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

const SELECTED_GLASS_STYLE = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
};

const UNSELECTED_GLASS_STYLE = {
  background: "rgba(20,20,30,0.45)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const PURPLE_CORNER_GLOW_STYLE = {
  background:
    "radial-gradient(ellipse 80% 80% at 0% 0%, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.06) 40%, transparent 65%)",
};

function getApiErrorMessage(error, fallback = "Generation failed") {
  const data = error?.response?.data;
  if (data?.errors?.length) {
    const details = data.errors.map(e => e.field ? `${e.field}: ${e.message}` : e.message).join('; ');
    return details || data.message || fallback;
  }
  return (
    data?.message ||
    data?.error ||
    error?.message ||
    fallback
  );
}

// Upload/Gallery toggle with content
function ImageSourceSelector({ modelId, onUpload, onGallerySelect, preview, selectedGalleryImage, accentColor = "purple", type = "image" }) {
  const [mode, setMode] = useState("upload"); // "upload" or "gallery"

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <button
          onClick={() => setMode("upload")}
          className={`relative overflow-hidden px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
            mode === "upload"
              ? "text-white"
              : "bg-transparent border-white/10 text-slate-400 hover:text-white hover:border-white/20"
          }`}
          style={mode === "upload" ? SELECTED_GLASS_STYLE : undefined}
          data-testid="button-source-upload"
        >
          {mode === "upload" && (
            <span className="absolute top-0 left-0 w-16 h-16 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
          )}
          {mode === "upload" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
          )}
          <Upload className="w-3 h-3 inline mr-1" />
          {getGenerateCopy().sourceUpload}
        </button>
        <button
          onClick={() => setMode("gallery")}
          className={`relative overflow-hidden px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
            mode === "gallery"
              ? "text-white"
              : "bg-transparent border-white/10 text-slate-400 hover:text-white hover:border-white/20"
          }`}
          style={mode === "gallery" ? SELECTED_GLASS_STYLE : undefined}
          data-testid="button-source-gallery"
        >
          {mode === "gallery" && (
            <span className="absolute top-0 left-0 w-16 h-16 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
          )}
          {mode === "gallery" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
          )}
          <Grid3X3 className="w-3 h-3 inline mr-1" />
          {getGenerateCopy().sourceGallery}
        </button>
      </div>

      {mode === "upload" ? (
        <FileUpload type={type} onUpload={onUpload} preview={preview} />
      ) : (
        <div className="rounded-xl p-2.5 glass-card">
          {selectedGalleryImage ? (
            <div className="relative">
              <img src={selectedGalleryImage} alt="Selected" className="w-full max-h-40 object-contain rounded-lg" />
              <button
                onClick={() => onGallerySelect(null)}
                className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
                data-testid="button-clear-gallery-selection"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ) : (
            <GalleryImagePicker
              modelId={modelId}
              selectedImage={selectedGalleryImage}
              onSelect={onGallerySelect}
              accentColor={accentColor}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Collapsible Model Selector Component - expands below the button
function ModelSelector({ models, selectedModel, onSelect, accentColor = "purple", stepNumber, label = "Select Model" }) {
  const copy = getGenerateCopy();
  const [isOpen, setIsOpen] = useState(false);
  const selectedModelData = models.find(m => m.id === selectedModel);
  
  const gradients = {
    purple: 'rgba(255,255,255,1)',
    cyan: 'linear-gradient(135deg, #22D3EE, #14B8A6)',
    violet: 'rgba(255,255,255,1)',
  };
  const bgGradients = {
    purple: 'rgba(255,255,255,0.06)',
    cyan: 'linear-gradient(135deg, rgba(34,211,238,0.15), rgba(20,184,166,0.1))',
    violet: 'rgba(255,255,255,0.06)',
  };
  const accents = {
    purple: { border: 'rgba(255,255,255,0.15)', borderActive: 'rgba(255,255,255,0.35)', text: 'text-white/70', glow: 'rgba(255,255,255,0.08)' },
    cyan: { border: 'rgba(34,211,238,0.3)', borderActive: 'rgba(34,211,238,0.6)', text: 'text-cyan-300', glow: 'rgba(34,211,238,0.2)' },
    violet: { border: 'rgba(255,255,255,0.15)', borderActive: 'rgba(255,255,255,0.35)', text: 'text-white/70', glow: 'rgba(255,255,255,0.08)' },
  };

  const handleSelect = (modelId) => {
   
    onSelect(modelId);
    setIsOpen(false);
  };
  
  return (
    <div className="mb-5">
      {stepNumber && (
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: "rgba(203, 213, 225, 0.9)", color: "#0f172a", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            {stepNumber}
          </div>
          <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{label === "Select Model" ? copy.modelSelectorLabel : label}</label>
        </div>
      )}
      {!stepNumber && (
        <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-3">{label === "Select Model" ? copy.modelSelectorLabel : label}</label>
      )}
      
      {/* Main container with connected styling */}
      <div 
        className="rounded-xl overflow-hidden"
        style={{ 
          background: isOpen ? bgGradients[accentColor] : 'rgba(22,22,30,0.55)',
          border: isOpen ? `1px solid ${accents[accentColor].borderActive}` : `1px solid ${selectedModelData ? accents[accentColor].border : 'rgba(255,255,255,0.14)'}`,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {/* Toggle Button */}
        <button
          onClick={() => { setIsOpen(!isOpen); }}
          data-testid="button-select-model"
          className="relative overflow-hidden w-full flex items-center gap-3 p-3 group text-white"
        >
          {(isOpen || selectedModelData) && (
            <span className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
          )}
          {(isOpen || selectedModelData) && (
            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
          )}
          {selectedModelData ? (
            <>
              <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative" style={{ border: `2px solid ${accents[accentColor].border}` }}>
                <img src={selectedModelData.photo1Url || ''} alt={selectedModelData.name} className="w-full h-full object-cover" onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; e.target.parentElement.querySelector('.model-fallback').style.display = 'flex'; }} />
                <div className="model-fallback w-full h-full items-center justify-center bg-slate-800 text-white text-[8px] font-bold absolute inset-0" style={{ display: 'none' }}>{selectedModelData.name?.charAt(0)}</div>
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className={`text-sm font-medium ${accents[accentColor].text} truncate`}>{selectedModelData.name}</p>
                <p className="text-[10px] text-slate-500">{isOpen ? copy.modelHintTapToClose : copy.modelHintTapToChange}</p>
              </div>
            </>
          ) : models.length === 0 ? (
            <div className="flex-1 text-left">
              <p className="text-sm text-white">{copy.modelSelectorNoModels}</p>
              <p className="text-[10px] text-slate-500">{copy.modelHintCreateInModels}</p>
            </div>
          ) : (
            <div className="flex-1 text-left">
              <p className="text-sm text-slate-400">{copy.modelSelectorChooseModel}</p>
              <p className="text-[10px] text-slate-500">{copy.modelHintAvailableCount.replace("{count}", String(models.length))}</p>
            </div>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {/* Expandable Grid - slides down */}
        {isOpen && models.length > 0 && (
          <div 
            className="px-3 pb-3 pt-1"
            style={{ borderTop: `1px solid ${accents[accentColor].border}` }}
          >
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
              {models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => handleSelect(model.id)}
                  data-testid={`model-option-${model.id}`}
                  className="relative rounded-lg overflow-hidden transition-all aspect-square hover:scale-105"
                  style={{
                    border: selectedModel === model.id ? `2px solid ${accents[accentColor].borderActive}` : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <img 
                    src={model.photo1Url || ''} 
                    alt={model.name} 
                    className="w-full h-full object-cover" 
                    onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; e.target.parentElement.querySelector('.model-fallback').style.display = 'flex'; }}
                  />
                  <div className="model-fallback w-full h-full items-center justify-center bg-slate-800/80 text-white text-sm font-bold text-center p-1 absolute inset-0" style={{ display: 'none' }}>
                    {model.name}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-1">
                    <p className="text-[8px] font-medium text-white truncate text-center">{model.name}</p>
                  </div>
                  {selectedModel === model.id && (
                    <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
                  )}
                  {selectedModel === model.id && (
                    <div className="absolute top-0.5 right-0.5">
                      <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: gradients[accentColor] }}>
                        <Check className="w-2.5 h-2.5 text-white" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import toast from "react-hot-toast";
import api, { generationAPI, uploadFile } from "../services/api";
import FileUpload from "../components/FileUpload";
import { useAuthStore } from "../store";
import { sound } from "../utils/sounds";

// Catches render errors inside Generate tab so the app doesn't show full-page "Something went wrong"
class GenerateTabBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("[GenerateTabBoundary]", error?.message, errorInfo?.componentStack);
  }
  render() {
    const copy = getGenerateCopy();
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">{copy.boundaryTitle}</h2>
          <p className="text-slate-400 text-sm mb-4">
            {this.state.error?.message || copy.boundaryMessageDefault}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-6 py-2.5 rounded-xl bg-white/10 border border-white/20 hover:bg-white/15 font-medium text-white inline-flex items-center gap-2"
          >
            <RefreshCcw className="w-4 h-4" />
            {copy.refresh}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { usePageVisibility } from "../hooks/usePageVisibility";
import { useGenerations } from "../hooks/useGenerations";
import { useActiveGeneration } from "../hooks/useActiveGeneration";
import { useCachedModels } from "../hooks/useCachedModels";
import GenerationResults from "../components/GenerationResults";
import { GenerationHistory } from "../components/GenerationHistory";
import TutorialButton from "../components/TutorialButton";
import { TUTORIALS } from "../utils/tutorials";
import { useTutorialCatalog } from "../hooks/useTutorialCatalog";
import AddCreditsModal from "../components/AddCreditsModal";
import { CreditCard } from "lucide-react";
import LivePreviewPanel from "../components/LivePreviewPanel";
import CourseTipBanner from "../components/CourseTipBanner";
import { useDraft } from "../hooks/useDraft";

export default function GeneratePage({ setActiveTab: setDashboardTab, openVoiceStudioForModel }) {
  const copy = getGenerateCopy();
  const [activeTab, setActiveTab] = useState("image");
  const [isTabDrawerOpen, setIsTabDrawerOpen] = useState(false);
  const [hasSelectedTopTab, setHasSelectedTopTab] = useState(false);

  useEffect(() => {
    const handleBack = () => {
      setHasSelectedTopTab(false);
      setIsTabDrawerOpen(false);
    };

    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, []);

  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* Premium Header */}
      <div className="mb-6 sm:mb-10">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2 text-white">
          {copy.title}
        </h1>
        <p className="text-sm text-slate-400">{copy.subtitle}</p>
      </div>

      <CourseTipBanner type="sfw" onNavigateToCourse={() => setDashboardTab?.("course")} />

      {/* Premium Tabs - collapsible */}
      <div className="mb-6 sm:mb-8">
        {hasSelectedTopTab && (
        <button
          onClick={() => {
           
            setHasSelectedTopTab(false);
            setIsTabDrawerOpen(false);
          }}
          data-testid={activeTab === "image" ? "tab-image" : "tab-video"}
          className="w-full relative overflow-hidden py-3 px-3 sm:py-4 sm:px-6 rounded-xl flex items-center justify-between gap-3 min-h-[48px] sm:min-h-[56px] group text-white"
          style={SELECTED_GLASS_STYLE}
        >
          <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
          <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
          <div className="relative flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 rounded-lg bg-white/10 border border-white/20">
              {activeTab === "image" ? <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" /> : <Video className="w-4 h-4 sm:w-5 sm:h-5 text-white" />}
            </div>
            <div className="text-left">
              <span className="font-semibold text-sm sm:text-base block">{activeTab === "image" ? copy.tabImage : copy.tabVideo}</span>
              <span className="text-[10px] text-slate-400 hidden sm:block">{activeTab === "image" ? copy.tabImageSub : copy.tabVideoSub}</span>
            </div>
          </div>
          <ChevronDown className={`relative w-4 h-4 text-slate-300 transition-transform ${isTabDrawerOpen ? "rotate-180" : ""}`} />
        </button>
        )}

        {(isTabDrawerOpen || !hasSelectedTopTab) && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            {(!hasSelectedTopTab || activeTab !== "image") && (
              <button
                onClick={() => {
                 
                  setActiveTab("image");
                  setHasSelectedTopTab(true);
                  setIsTabDrawerOpen(false);
                }}
                data-testid="tab-image"
                className="relative py-3 px-3 sm:py-4 sm:px-6 rounded-xl flex items-center justify-center gap-2 sm:gap-3 min-h-[48px] sm:min-h-[56px] group text-white"
                style={UNSELECTED_GLASS_STYLE}
              >
                <div className="relative flex items-center gap-2 sm:gap-3">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-white/10 border border-white/20">
                    <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                  </div>
                  <div className="text-left">
                    <span className="font-semibold text-sm sm:text-base block">{copy.tabImage}</span>
                    <span className="text-[10px] text-slate-400 hidden sm:block">{copy.tabImageSub}</span>
                  </div>
                </div>
              </button>
            )}
            {(!hasSelectedTopTab || activeTab !== "video") && (
              <button
                onClick={() => {
                 
                  setActiveTab("video");
                  setHasSelectedTopTab(true);
                  setIsTabDrawerOpen(false);
                }}
                data-testid="tab-video"
                className="relative py-3 px-3 sm:py-4 sm:px-6 rounded-xl flex items-center justify-center gap-2 sm:gap-3 min-h-[48px] sm:min-h-[56px] group text-white"
                style={UNSELECTED_GLASS_STYLE}
              >
                <div className="relative flex items-center gap-2 sm:gap-3">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-white/10 border border-white/20">
                    <Video className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                  </div>
                  <div className="text-left">
                    <span className="font-semibold text-sm sm:text-base block">{copy.tabVideo}</span>
                    <span className="text-[10px] text-slate-400 hidden sm:block">{copy.tabVideoSub}</span>
                  </div>
                </div>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content - inner boundary catches errors so full app doesn't crash */}
      <GenerateTabBoundary key={activeTab}>
        {activeTab === "image" && <ImageGeneration />}
        {activeTab === "video" && <VideoGeneration />}
      </GenerateTabBoundary>
    </div>
  );
}

function ImageGeneration() {
  const copy = getGenerateCopy();
  const { user, updateCredits, refreshUserCredits } = useAuthStore();
  const credits = user?.credits ?? 0;

  // HYBRID: useGenerations for history, local state for LivePreviewPanel
  // Use "all-images" to get all image types for finding latest across all modes
  const {
    all: allImageGenerationsRaw,
    isGenerating: historyIsGenerating,
    isError: generationsLoadError,
    triggerRefresh,
    addOptimisticGeneration,
  } = useGenerations("all-images");
  const allImageGenerations = Array.isArray(allImageGenerationsRaw) ? allImageGenerationsRaw : [];

  const latestIdentityGeneration = allImageGenerations.find(g => g.type === 'image' || g.type === 'image-identity') || null;
  const latestFaceSwapGeneration = allImageGenerations.find(g => g.type === 'face-swap-image') || null;
  const latestAdvancedGeneration = allImageGenerations.find(g => g.type === 'advanced-image') || null;
  const latestPromptGeneration = allImageGenerations.find(g => g.type === 'prompt-image') || null;

  // Only show a failed generation in LivePreviewPanel if it failed recently (last 5 min)
  // Old failed jobs should not show errors when the page is opened
  const RECENT_FAILURE_MS = 5 * 60 * 1000;
  const isRecentEnoughForPanel = (gen) => {
    if (!gen || gen.status !== 'failed') return true;
    const completedAt = gen.completedAt ? new Date(gen.completedAt).getTime() : new Date(gen.createdAt).getTime();
    return Date.now() - completedAt < RECENT_FAILURE_MS;
  };

  // Image mode selector (4 modes) — must be declared before any hook that references imageMode
  const [imageMode, setImageMode] = useState("identity"); // identity | prompt | faceswap | advanced
  const [isImageModeDrawerOpen, setIsImageModeDrawerOpen] = useState(false);
  const [hasSelectedImageMode, setHasSelectedImageMode] = useState(false);

  // Toast when an advanced or casual (prompt-image) generation fails (e.g. content policy / Nano Banana)
  // Only show for recent failures — not old failed jobs loaded from history
  const generationFailureToastedRef = useRef(new Set());
  useEffect(() => {
    const typesToShow = imageMode === "advanced" ? ["advanced-image"] : imageMode === "prompt" ? ["prompt-image"] : [];
    if (typesToShow.length === 0) return;
    const gens = allImageGenerations.filter((g) => typesToShow.includes(g.type));
    for (const gen of gens) {
      if (gen.status === "failed" && gen.errorMessage && !generationFailureToastedRef.current.has(gen.id)) {
        generationFailureToastedRef.current.add(gen.id);
        // Only toast for failures that happened in the last 5 minutes
        const failedAt = gen.completedAt ? new Date(gen.completedAt).getTime() : new Date(gen.createdAt).getTime();
        if (Date.now() - failedAt < RECENT_FAILURE_MS) {
          toast.error(gen.errorMessage, { duration: 8000 });
        }
      }
    }
  }, [imageMode, allImageGenerations]);
  
  const [activePromptGeneration, setActivePromptGeneration] = useState(null);
  const effectivePromptGeneration = activePromptGeneration || latestPromptGeneration;

  // Credit modal state
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  // Cooldown state (500ms between clicks)
  const [lastGenerateTime, setLastGenerateTime] = useState(0);
  const [isCooldown, setIsCooldown] = useState(false);

  useEffect(() => {
    const handleBack = () => {
      setHasSelectedImageMode(false);
      setIsImageModeDrawerOpen(false);
    };

    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, []);

  // Advanced Mode state
  const [advancedModel, setAdvancedModel] = useState("nano-banana"); // "nano-banana" or "seedream"
  const [advancedReferencePhotos, setAdvancedReferencePhotos] = useState([]);
  const [advancedPrompt, setAdvancedPrompt] = useState("");
  const [advancedGenerating, setAdvancedGenerating] = useState(false);
  const [advancedEnhancing, setAdvancedEnhancing] = useState(false);

  // Face Swap Image state
  const [faceSwapTargetImage, setFaceSwapTargetImage] = useState(null);
  const [faceSwapSourceImage, setFaceSwapSourceImage] = useState(null);
  const [faceSwapImageGenerating, setFaceSwapImageGenerating] = useState(false);

  // Identity generation local state (separate from other modes)
  const [identityGenerating, setIdentityGenerating] = useState(false);
  const [identityPromptEdit, setIdentityPromptEdit] = useState("");

  // CACHED: Models from React Query (instant on subsequent visits)
  const { models: modelsRaw, isLoading: modelsLoading } = useCachedModels();
  // Exclude models still being generated — they have no usable photos yet
  const models = (Array.isArray(modelsRaw) ? modelsRaw : []).filter(
    (m) => m.status !== "processing"
  );
  const [selectedModel, setSelectedModel] = useState("");
  const [targetImage, setTargetImage] = useState(null);
  const [clothesMode, setClothesMode] = useState("model");
  // Auto-select first model when models load
  useEffect(() => {
    if (models.length > 0 && (!selectedModel || !models.find(m => m.id === selectedModel))) {
      setSelectedModel(models[0]?.id || "");
    }
  }, [models, selectedModel]);

  const { draft, isLoading: draftLoading, saveDraft, clearDraft } = useDraft("generate-image");
  const draftRestoredRef = useRef(false);
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    if (draftRestoredRef.current || draftLoading || !draft?.data) {
      if (!draftLoading) {
        draftRestoredRef.current = true;
        setTimeout(() => { initialLoadDoneRef.current = true; }, 0);
      }
      return;
    }
    draftRestoredRef.current = true;
    const d = draft.data;
    if (d.imageMode !== undefined) setImageMode(d.imageMode);
    if (d.selectedModel !== undefined) setSelectedModel(d.selectedModel);
    if (d.advancedModel !== undefined) setAdvancedModel(d.advancedModel);
    if (d.advancedPrompt !== undefined) setAdvancedPrompt(d.advancedPrompt);
    if (d.identityPromptEdit !== undefined) setIdentityPromptEdit(d.identityPromptEdit);
    else if (d.identityDescription !== undefined) setIdentityPromptEdit(d.identityDescription);
    if (d.clothesMode !== undefined) setClothesMode(d.clothesMode);
    if (d.targetImage) setTargetImage({ url: d.targetImage });
    if (d.faceSwapTargetImage) setFaceSwapTargetImage({ url: d.faceSwapTargetImage });
    if (d.faceSwapSourceImage) setFaceSwapSourceImage({ url: d.faceSwapSourceImage });
    if (Array.isArray(d.advancedReferencePhotos) && d.advancedReferencePhotos.length > 0) {
      setAdvancedReferencePhotos(d.advancedReferencePhotos.map(url => ({ preview: url })));
    }
    setTimeout(() => { initialLoadDoneRef.current = true; }, 0);
  }, [draft, draftLoading]);

  useEffect(() => {
    if (!initialLoadDoneRef.current) return;
    const refPhotoUrls = advancedReferencePhotos.map(p => p?.preview).filter(Boolean);
    const data = {
      imageMode,
      selectedModel,
      advancedModel,
      advancedPrompt,
      identityPromptEdit,
      clothesMode,
      targetImage: targetImage?.url || null,
      faceSwapTargetImage: faceSwapTargetImage?.url || null,
      faceSwapSourceImage: faceSwapSourceImage?.url || null,
      advancedReferencePhotos: refPhotoUrls,
    };
    const imageUrls = [
      targetImage?.url,
      faceSwapTargetImage?.url,
      faceSwapSourceImage?.url,
      ...refPhotoUrls,
    ].filter(Boolean);
    saveDraft(data, imageUrls);
  }, [imageMode, selectedModel, advancedModel, advancedPrompt, targetImage, faceSwapTargetImage, faceSwapSourceImage, identityPromptEdit, clothesMode, advancedReferencePhotos]);

  // AI-powered prompt enhancement for Advanced mode
  // nano-banana → SFW ultra-realism Nano Banana Pro 6-component superprompt
  // seedream → NSFW Danbooru tag-format superprompt
  const enhanceAdvancedPrompt = async () => {
    const input = advancedPrompt.trim();
    if (!input) {
      toast.error(copy.advancedNeedPromptFirst);
      return;
    }

    setAdvancedEnhancing(true);

    const mode = advancedModel === "seedream" ? "nsfw" : "ultra-realism";

    const currentModel = models?.find(m => m.id === selectedModel);
    let chipLooks = currentModel?.savedAppearance || null;
    if (!chipLooks && currentModel?.aiGenerationParams) {
      try {
        const p = typeof currentModel.aiGenerationParams === "string"
          ? JSON.parse(currentModel.aiGenerationParams)
          : currentModel.aiGenerationParams;
        const keys = ["gender","hairColor","hairLength","hairTexture","eyeColor","bodyType","heritage","faceType","lipSize","style"];
        const l = {};
        keys.forEach(k => { if (p?.[k]) l[k] = p[k]; });
        if (Object.keys(l).length > 0) chipLooks = l;
      } catch { /* ignore */ }
    }

    const modelAge = currentModel?.age ?? null;
    const modelLooks = (chipLooks || modelAge)
      ? {
          ...(chipLooks ? Object.fromEntries(Object.entries(chipLooks).filter(([k]) => k !== "age" && k !== "ageRange")) : {}),
          ...(modelAge ? { age: modelAge } : {}),
        }
      : null;

    try {
      const response = await api.post("/generate/enhance-prompt", {
        prompt: input,
        mode,
        ...(modelLooks && { modelLooks }),
      });

      if (response.data.success) {
        const enhanced = response.data.enhancedPrompt;
        setAdvancedPrompt(enhanced);
        const modeLabel = advancedModel === "seedream" ? "Uncensored+" : "Ultra Realism";
        const enhanceCost = advancedModel === "seedream" ? 0 : 10;
        toast.success(
          enhanceCost > 0
            ? `Prompt enhanced! ${modeLabel} · ${enhanceCost} 🪙 used`
            : `Prompt enhanced! ${modeLabel} · free`,
        );
        await refreshUserCredits?.();
      } else {
        toast.error(response.data.message || "Enhancement failed");
      }
    } catch (error) {
      console.error("Advanced enhancement error:", error);
      const msg = error.response?.data?.message || copy.advancedToastEnhanceFailed;
      toast.error(msg);
    } finally {
      setAdvancedEnhancing(false);
    }
  };

  const handleGenerate = async () => {
    try { sound?.playPop?.(); } catch (_) { /* ignore */ }

    // v46 FIX: Cooldown check (500ms)
    const now = Date.now();
    if (now - lastGenerateTime < 500) {
      return; // Silently block during cooldown
    }
    setLastGenerateTime(now);
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 500);

    if (!selectedModel || !targetImage) {
      toast.error(copy.identityToastSelectModelAndTarget);
      return;
    }

    const model = models.find((m) => m.id === selectedModel);
    const creditsNeeded = 10; // 10 credits per image

    if (!user || credits < creditsNeeded) {
      toast.error(!user ? copy.identityToastLoginRequired : `Need ${creditsNeeded} 🪙. You have ${credits} 🪙.`);
      return;
    }

    setIdentityGenerating(true);

    try {
      const response = await generationAPI.imageIdentity({
        modelId: model.id,
        identityImages: [model.photo1Url, model.photo2Url, model.photo3Url],
        targetImage: targetImage.url,
        prompt: clothesMode === "reference" ? (identityPromptEdit.trim() || undefined) : undefined,
        quantity: 1,
        size: "2K",
        clothesMode,
      });

      // Backend now responds immediately — reset form right away
      setIdentityGenerating(false);
      await refreshUserCredits();

      if (response.success) {
        // Add the in-progress record so history/LivePreview pick it up
        if (response.generation) {
          addOptimisticGeneration({ ...response.generation, modelId: model.id });
        }
        toast.success(copy.identityToastQueued);
        clearDraft();
      } else {
        toast.error(response.message || "Generation failed");
        await refreshUserCredits();
      }
    } catch (error) {
      setIdentityGenerating(false);
      toast.error(getApiErrorMessage(error, "Generation failed"));
    }
  };

  // v42a: Face Swap Image handler
  const handleFaceSwapImage = async () => {
    // v46 FIX: Cooldown check (500ms)
    const now = Date.now();
    if (now - lastGenerateTime < 500) {
      return; // Silently block during cooldown
    }
    setLastGenerateTime(now);
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 500);

    if (!faceSwapTargetImage || !faceSwapSourceImage) {
      toast.error(copy.faceswapImageToastNeedBothImages);
      return;
    }

    if (credits < 10) {
      toast.error(`Need 10 🪙. You have ${credits} 🪙.`);
      return;
    }

    setFaceSwapImageGenerating(true);

    try {
      const response = await api.post("/generate/image-faceswap", {
        targetImageUrl: faceSwapTargetImage.url,
        sourceImageUrl: faceSwapSourceImage.url,
      });

      await refreshUserCredits();

      if (response.data.success) {
        // Optimistic update - add to cache immediately for instant UI feedback
        if (response.data.generation) {
          addOptimisticGeneration(response.data.generation);
        }
        toast.success(copy.faceswapImageToastStarted);
        setFaceSwapTargetImage(null);
        setFaceSwapSourceImage(null);
        clearDraft();
      }
    } catch (error) {
      console.error("❌ Face swap error:", error);
      await refreshUserCredits();
      toast.error(getApiErrorMessage(error, copy.faceswapImageToastFailed));
    } finally {
      setFaceSwapImageGenerating(false);
    }
  };

  return (
    <div
      className="relative z-20 isolate p-0"
    >
      {/* Premium Mode Selector */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500 font-medium">{copy.modeSelectLabel}</p>
          {/* Advanced Mode Toggle */}
          <button
            onClick={() => {
             
              setImageMode(imageMode === "advanced" ? "identity" : "advanced");
              setIsImageModeDrawerOpen(false);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              imageMode === "advanced"
                ? "bg-white/10 border border-white/20 text-white"
                : "glass-card text-slate-400 hover:brightness-125 hover:text-white"
            }`}
            data-testid="button-toggle-advanced"
          >
            <Zap className="w-3.5 h-3.5" />
            {copy.modeAdvancedToggle}
            <div className={`w-8 h-4 rounded-full transition-all flex items-center ${imageMode === "advanced" ? "bg-amber-500" : "bg-slate-600"}`}>
              <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${imageMode === "advanced" ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </div>
          </button>
        </div>
        
        {/* Normal modes - hidden when advanced is active */}
        {imageMode !== "advanced" && (
        <>
        {hasSelectedImageMode && (
        <button
          onClick={() => {
           
            setHasSelectedImageMode(false);
            setIsImageModeDrawerOpen(false);
          }}
          className="w-full mb-3 relative overflow-hidden p-3 rounded-xl group text-white bg-white/[0.08] border border-white/20 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] flex items-center justify-between"
          data-testid={`button-mode-${imageMode}`}
        >
          <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
          <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
          <div className="flex items-center gap-3 text-left">
            <div className="p-2 rounded-lg bg-white/10 border border-white/20">
              {imageMode === "identity" && <User className="w-4 h-4 text-white" />}
              {imageMode === "prompt" && <Sparkles className="w-4 h-4 text-white" />}
              {imageMode === "faceswap" && <Users className="w-4 h-4 text-white" />}
            </div>
            <div>
              <p className="font-semibold text-sm">
                {imageMode === "identity" ? copy.modeIdentity : imageMode === "prompt" ? copy.modePromptToImage : copy.modeFaceSwap}
              </p>
              <p className="text-[11px] text-slate-400">
                {imageMode === "identity" ? copy.modeIdentityTitle : imageMode === "prompt" ? copy.modePromptTitle : copy.modeFaceswapTitle}
              </p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isImageModeDrawerOpen ? "rotate-180" : ""}`} />
        </button>
        )}

        {(isImageModeDrawerOpen || !hasSelectedImageMode) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Identity Recreation */}
          <button
            onClick={() => {
             
              setImageMode("identity");
              setHasSelectedImageMode(true);
              setIsImageModeDrawerOpen(false);
            }}
            className={`relative overflow-hidden p-4 rounded-xl group ${
              imageMode === "identity" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            style={{
              ...(imageMode === "identity" ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE),
            }}
            data-testid="button-mode-identity"
          >
            {imageMode === "identity" && (
              <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
            )}
            {imageMode === "identity" && (
              <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
            )}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className={`p-2 rounded-lg ${imageMode === "identity" ? "bg-white/10 border border-white/20" : "glass-card"}`}>
                  <User className={`w-4 h-4 ${imageMode === "identity" ? "text-white" : ""}`} />
                </div>
                <span className="font-semibold text-sm">{copy.modeIdentity}</span>
                <TutorialButton tutorial={TUTORIALS.image.identity} />
              </div>
              <p className="text-[11px] text-slate-400">{copy.modeIdentityTitle}</p>
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                  <span className="text-[10px] font-medium text-yellow-400 inline-flex items-center gap-0.5">10 <Coins className="w-2.5 h-2.5" /></span>
                </div>
                <div className="inline-flex items-center px-1.5 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(22,163,74,0.15))', border: '1px solid rgba(34,197,94,0.4)' }}>
                  <span className="text-[8px] font-bold tracking-wide" style={{ color: '#4ade80' }}>50% OFF</span>
                </div>
              </div>
            </div>
          </button>

          {/* Prompt To Image */}
          <button
            onClick={() => {
             
              setImageMode("prompt");
              setHasSelectedImageMode(true);
              setIsImageModeDrawerOpen(false);
            }}
            className={`relative overflow-hidden p-4 rounded-xl group ${
              imageMode === "prompt" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            style={{
              ...(imageMode === "prompt" ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE),
            }}
            data-testid="button-mode-prompt"
          >
            {imageMode === "prompt" && (
              <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
            )}
            {imageMode === "prompt" && (
              <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
            )}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className={`p-2 rounded-lg ${imageMode === "prompt" ? "bg-white/10 border border-white/20" : "glass-card"}`}>
                  <Sparkles className={`w-4 h-4 ${imageMode === "prompt" ? "text-white" : ""}`} />
                </div>
                <span className="font-semibold text-sm">{copy.modePromptToImage}</span>
                <TutorialButton tutorial={TUTORIALS.image.prompt} />
              </div>
              <p className="text-[11px] text-slate-400">{copy.modePromptTitle}</p>
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                  <span className="text-[10px] font-medium text-yellow-400 inline-flex items-center gap-0.5">10-20 <Coins className="w-2.5 h-2.5" /></span>
                </div>
                <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(22,163,74,0.15))', border: '1px solid rgba(34,197,94,0.4)' }}>
                  <span className="text-[8px] font-bold tracking-wide" style={{ color: '#4ade80' }}>50% OFF</span>
                </div>
              </div>
            </div>
          </button>

          {/* Face Swap */}
          <button
            onClick={() => {
             
              setImageMode("faceswap");
              setHasSelectedImageMode(true);
              setIsImageModeDrawerOpen(false);
            }}
            className={`relative overflow-hidden p-4 rounded-xl group ${
              imageMode === "faceswap" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            style={{
              ...(imageMode === "faceswap" ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE),
            }}
            data-testid="button-mode-faceswap"
          >
            {imageMode === "faceswap" && (
              <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
            )}
            {imageMode === "faceswap" && (
              <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
            )}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className={`p-2 rounded-lg ${imageMode === "faceswap" ? "bg-white/10 border border-white/20" : "glass-card"}`}>
                  <Users className={`w-4 h-4 ${imageMode === "faceswap" ? "text-white" : ""}`} />
                </div>
                <span className="font-semibold text-sm">{copy.faceswapAction}</span>
                <TutorialButton tutorial={TUTORIALS.image.faceswap} />
              </div>
              <p className="text-[11px] text-slate-400">{copy.modeFaceswapTitle}</p>
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                  <span className="text-[10px] font-medium text-yellow-400 inline-flex items-center gap-0.5">10 <Coins className="w-2.5 h-2.5" /></span>
                </div>
              </div>
            </div>
          </button>
        </div>
        )}
        </>
        )}
      </div>

      {generationsLoadError && (
        <div className="mb-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-200">{copy.errorContentLoad}</p>
          <button type="button" onClick={() => triggerRefresh()} className="shrink-0 px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 text-amber-100 font-medium text-sm">
            {copy.retry}
          </button>
        </div>
      )}

      {/* Split-screen layout: Controls left, Preview right */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left side - Controls */}
        <div className="relative z-10 flex-1 lg:max-w-[55%] bg-black">

      {/* v41: Identity Recreation Mode */}
      {imageMode === "identity" && (
        <>
          {/* Model Selection - Collapsible */}
          <ModelSelector
            models={models}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
            accentColor="purple"
          />

          {/* Target Image */}
          <div className="mb-6">
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-2">
              Reference Image
            </label>
            <p className="text-[11px] text-slate-500 mb-3">
              {copy.identityReferenceImageHint}
            </p>
            <FileUpload
              type="image"
              onUpload={(img) => { setTargetImage(img); setIdentityPromptEdit(""); }}
              preview={targetImage}
            />
          </div>

          {/* Clothes Mode Selector */}
          <div className="mb-6">
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-3">
              {copy.identityClothingStyle}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setClothesMode("model")}
                className={`relative overflow-hidden flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors duration-200 shadow-none ${
                  clothesMode === "model"
                    ? "bg-white/10 text-white/95 border border-white/30 backdrop-blur-xl"
                    : "bg-white/[0.04] border border-white/15 text-slate-300 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/20 backdrop-blur-xl"
                }`}
                data-testid="button-clothes-model"
              >
                {clothesMode === "model" && (
                  <span className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                )}
                {clothesMode === "model" && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                )}
                <User className="w-4 h-4" />
                {copy.identityClothingModel}
              </button>
              <button
                type="button"
                onClick={() => setClothesMode("reference")}
                className={`relative overflow-hidden flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors duration-200 shadow-none ${
                  clothesMode === "reference"
                    ? "bg-white/10 text-white/95 border border-white/30 backdrop-blur-xl"
                    : "bg-white/[0.04] border border-white/15 text-slate-300 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/20 backdrop-blur-xl"
                }`}
                data-testid="button-clothes-reference"
              >
                {clothesMode === "reference" && (
                  <span className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                )}
                {clothesMode === "reference" && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                )}
                <Shirt className="w-4 h-4" />
                {copy.identityClothingSource}
              </button>
            </div>
          </div>

          {/* Optional prompt for "New" (reference) mode only */}
          {clothesMode === "reference" && (
            <div className="mb-6">
              <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-2">
                {copy.identityExtraDirections}
              </label>
              <p className="text-[11px] text-slate-500 mb-2">
                {copy.identityExtraDirectionsHint}
              </p>
              <textarea
                value={identityPromptEdit}
                onChange={(e) => setIdentityPromptEdit(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/15 text-sm text-slate-200 placeholder-slate-500 focus:border-white/30 focus:outline-none transition resize-none"
                placeholder={copy.identityExtraDirectionsPlaceholder}
                data-testid="textarea-identity-prompt-edit"
              />
            </div>
          )}

          {/* Premium Generate Button */}
          {credits < 10 ? (
            <button
              onClick={() => setShowCreditsModal(true)}
              className="w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-3 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] bg-white text-black hover:bg-white/90"
              data-testid="button-get-credits-image"
            >
              <CreditCard className="w-5 h-5" />
              {copy.getCredits} <span className="inline-flex items-center gap-0.5 text-red-500">(10 <Coins className="w-3.5 h-3.5" />)</span>
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={
                identityGenerating || !selectedModel || !targetImage || isCooldown
              }
              className="w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-3 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] btn-primary-glass disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                backgroundColor: 'rgb(65, 63, 65)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
                color: 'white',
              }}
              data-testid="button-generate-image"
            >
              {identityGenerating ? (
                <>
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <span>{copy.generating}</span>
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <span className="inline-flex items-center gap-1.5">{copy.generateImage} <span className="inline-flex items-center gap-0.5 text-yellow-400">10 <Coins className="w-3.5 h-3.5" /></span></span>
                </>
              )}
            </button>
          )}

        </>
      )}

      {/* v41: Prompt Image Mode */}
      {imageMode === "prompt" && (
        <PromptImageContent 
          onGenerationUpdate={setActivePromptGeneration}
          models={models}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          clearDraft={clearDraft}
        />
      )}

      {/* v42a: Face Swap Image Mode */}
      {imageMode === "faceswap" && (
        <>
          {/* Target Image */}
          <div className="mb-6">
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-2">
              {copy.faceswapTargetImage}
            </label>
            <p className="text-[11px] text-slate-500 mb-3">
              {copy.faceswapTargetImageHint}
            </p>
            <FileUpload
              type="image"
              onUpload={setFaceSwapTargetImage}
              preview={faceSwapTargetImage}
              accept="image/*"
            />
          </div>

          {/* Source Face */}
          <div className="mb-6">
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-2">
              {copy.faceswapSourceFace}
            </label>
            <p className="text-[11px] text-slate-500 mb-3">
              {copy.faceswapSourceFaceHint}
            </p>
            <FileUpload
              type="image"
              onUpload={setFaceSwapSourceImage}
              preview={faceSwapSourceImage}
              accept="image/*"
            />
          </div>

          {/* Generate Button */}
          {credits < 10 ? (
            <button
              onClick={() => setShowCreditsModal(true)}
              className="w-full py-3.5 px-6 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 bg-white text-black hover:bg-white/90"
              data-testid="button-get-credits-faceswap"
            >
              <CreditCard className="w-5 h-5" />
              {copy.getCredits} <span className="inline-flex items-center gap-0.5 text-red-500">(10 <Coins className="w-3.5 h-3.5" />)</span>
            </button>
          ) : (
            <button
              onClick={handleFaceSwapImage}
              disabled={
                !faceSwapTargetImage ||
                !faceSwapSourceImage ||
                faceSwapImageGenerating ||
                isCooldown
              }
              className="w-full py-3.5 px-6 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:cursor-not-allowed"
              style={{
                background: (!faceSwapTargetImage || !faceSwapSourceImage || faceSwapImageGenerating)
                  ? 'rgba(255,255,255,0.05)'
                  : 'linear-gradient(135deg, #22d3ee 0%, #14b8a6 100%)',
              }}
              data-testid="button-generate-faceswap-image"
            >
              {faceSwapImageGenerating ? (
                <>
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <span>{copy.faceswapSwapping}</span>
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 text-white" />
                  <span className="inline-flex items-center gap-1.5">{copy.faceswapAction} <span className="inline-flex items-center gap-0.5 text-yellow-400">10 <Coins className="w-3.5 h-3.5" /></span></span>
                </>
              )}
            </button>
          )}
        </>
      )}

      {/* Advanced Mode */}
      {imageMode === "advanced" && (
        <>
          <ModelSelector
            models={models}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
            accentColor="purple"
            stepNumber={1}
            label={copy.advancedStepSelectModel}
          />
          {/* AI Engine Selector */}
          <div className="mb-6">
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-3">
              {copy.advancedEngineLabel}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                 
                  setAdvancedModel("nano-banana");
                }}
                className={`relative overflow-hidden p-4 rounded-xl text-sm font-medium transition-colors ${
                  advancedModel === "nano-banana"
                    ? "bg-white/10 border border-white/20 text-white"
                    : "glass-card text-slate-400 hover:brightness-125"
                }`}
                data-testid="button-engine-nano-banana"
              >
                {advancedModel === "nano-banana" && (
                  <span className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                )}
                {advancedModel === "nano-banana" && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                )}
                <div className="font-semibold">{copy.advancedEngineUltraRealism}</div>
                <div className="mt-2 inline-flex items-center px-1.5 py-[1px] rounded-full" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.20), rgba(22,163,74,0.10))', border: '1px solid rgba(34,197,94,0.28)' }}>
                  <span className="text-[7px] font-semibold tracking-wide" style={{ color: '#4ade80' }}>33% OFF</span>
                </div>
              </button>
              <button
                onClick={() => {
                 
                  setAdvancedModel("seedream");
                }}
                className={`relative overflow-hidden p-4 rounded-xl text-sm font-medium transition-colors ${
                  advancedModel === "seedream"
                    ? "bg-white/10 border border-white/20 text-white"
                    : "glass-card text-slate-400 hover:brightness-125"
                }`}
                data-testid="button-engine-seedream"
              >
                {advancedModel === "seedream" && (
                  <span className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                )}
                {advancedModel === "seedream" && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
                )}
                <div className="font-semibold">{copy.advancedEngineUncensoredPlus}</div>
                <div className="mt-2 inline-flex items-center px-1.5 py-[1px] rounded-full" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.20), rgba(22,163,74,0.10))', border: '1px solid rgba(34,197,94,0.28)' }}>
                  <span className="text-[7px] font-semibold tracking-wide" style={{ color: '#4ade80' }}>50% OFF</span>
                </div>
              </button>
            </div>
          </div>

          {/* Reference Photos Upload */}
          <div className="mb-6">
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium mb-2">
              {copy.advancedReferenceImages} <span className="text-slate-600">{copy.optional}, {copy.advancedMaxReferences.replace("{count}", "10")}</span>
            </label>
            <p className="text-[11px] text-slate-500 mb-3">
              {copy.advancedReferenceImagesHint}
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Show uploaded photos */}
              {advancedReferencePhotos.map((photo, index) => (
                <div key={index} className="relative w-16 h-16">
                  <div className="relative w-full h-full rounded-xl overflow-hidden glass-card">
                    <img
                      src={photo.preview}
                      alt={`Reference ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => {
                        const newPhotos = [...advancedReferencePhotos];
                        newPhotos.splice(index, 1);
                        setAdvancedReferencePhotos(newPhotos);
                      }}
                      className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors"
                    >
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                </div>
              ))}
              {/* Add more button - only show if less than 10 photos */}
              {advancedReferencePhotos.length < 10 && (
                <label className="w-16 h-16 rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-white/30 hover:bg-white/5 transition-colors">
                  <Upload className="w-4 h-4 text-slate-500 mb-0.5" />
                  <span className="text-[8px] text-slate-500">
                    {advancedReferencePhotos.length === 0 ? copy.advancedAddReference : `${advancedReferencePhotos.length}/10`}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && advancedReferencePhotos.length < 10) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          setAdvancedReferencePhotos(prev => [...prev, {
                            file,
                            preview: reader.result,
                          }]);
                        };
                        reader.readAsDataURL(file);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Prompt Input */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">
                {copy.advancedPrompt}
              </label>
              <button
                onClick={enhanceAdvancedPrompt}
                disabled={advancedEnhancing || !advancedPrompt.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(109,40,217,0.15))", border: "1px solid rgba(139,92,246,0.35)", color: "#c4b5fd" }}
                data-testid="button-enhance-advanced-prompt"
              >
                {advancedEnhancing
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Sparkles className="w-3 h-3" />}
                {advancedEnhancing ? copy.advancedEnhancingPrompt : copy.advancedEnhancePrompt}
              </button>
            </div>
            <textarea
              value={advancedPrompt}
              onChange={(e) => setAdvancedPrompt(e.target.value)}
              placeholder={advancedModel === "seedream" ? copy.advancedPromptPlaceholderNano : copy.advancedPromptPlaceholderSeedream}
              className="w-full h-32 glass-card rounded-xl p-4 text-white placeholder:text-slate-400 focus:outline-none focus:border-white/20 resize-none"
              data-testid="input-advanced-prompt"
            />
          </div>

          {/* Generate Button */}
          {(() => {
            const advCredits = advancedModel === "nano-banana" ? 20 : 10;
            return credits < advCredits ? (
              <button
                onClick={() => setShowCreditsModal(true)}
                className="w-full py-3.5 px-6 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 bg-white text-black hover:bg-white/90"
                data-testid="button-get-credits-advanced"
              >
                <CreditCard className="w-5 h-5" />
                {copy.getCredits} <span className="inline-flex items-center gap-0.5 text-red-500">({advCredits} <Coins className="w-3.5 h-3.5" />)</span>
              </button>
            ) : (
              <button
                onClick={async () => {
                  try { sound?.playPop?.(); } catch (_) { /* ignore */ }
                  
                  const now = Date.now();
                  if (now - lastGenerateTime < 500) return;
                  setLastGenerateTime(now);
                  setIsCooldown(true);
                  setTimeout(() => setIsCooldown(false), 500);

                  if (!models || models.length === 0) {
                    window.alert(copy.advancedToastCreateModelFirst);
                    return;
                  }

                  if (!selectedModel) {
                    toast.error(copy.advancedToastNeedModel);
                    return;
                  }
                  if (!advancedPrompt.trim()) {
                    toast.error(copy.advancedToastNeedPrompt);
                    return;
                  }

                  setAdvancedGenerating(true);

                  try {
                    const photoUrls = [];
                    for (const photo of advancedReferencePhotos) {
                      if (photo?.file) {
                        const url = await uploadFile(photo.file);
                        photoUrls.push(url);
                      } else if (photo?.preview && !photo.preview.startsWith("blob:")) {
                        photoUrls.push(photo.preview);
                      }
                    }

                    const response = await api.post("/generate/advanced", {
                      modelId: selectedModel,
                      engine: advancedModel,
                      prompt: advancedPrompt,
                      referencePhotos: photoUrls,
                    });

                    await refreshUserCredits();
                    triggerRefresh();

                    if (response.data.success) {
                      toast.success("Generation started! Check Live Preview.");
                      setAdvancedPrompt("");
                      setAdvancedReferencePhotos([]);
                      clearDraft();
                    } else {
                      toast.error(response.data.error || "Generation failed");
                    }
                  } catch (error) {
                    toast.error(getApiErrorMessage(error, "Generation failed"));
                  } finally {
                    setAdvancedGenerating(false);
                  }
                }}
                disabled={!advancedPrompt.trim() || advancedGenerating || isCooldown}
                className="w-full py-3.5 px-6 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: (!advancedPrompt.trim() || advancedGenerating)
                    ? 'rgba(255,255,255,0.05)'
                    : 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                }}
                data-testid="button-generate-advanced"
              >
                {advancedGenerating ? (
                  <>
                    <Zap className="w-5 h-5 text-yellow-400" />
                    <span>{copy.generating}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 text-white" />
                    <span className="inline-flex items-center gap-1.5">Generate <span className="inline-flex items-center gap-0.5 text-yellow-400">{advCredits} <Coins className="w-3.5 h-3.5" /></span></span>
                  </>
                )}
              </button>
            );
          })()}
        </>
      )}

        </div>
        {/* End Left side */}

        {/* Right side - Live Preview (changes based on current mode) */}
        <div className="w-full mt-6 lg:mt-0 lg:w-[45%] lg:sticky lg:top-4 lg:self-start">
          <LivePreviewPanel 
            type={imageMode === 'identity' ? 'image-identity' : imageMode === 'prompt' ? 'prompt-image' : imageMode === 'advanced' ? 'advanced-image' : 'face-swap-image'}
            latestGeneration={
              (() => {
                const gen = imageMode === 'identity' ? latestIdentityGeneration :
                  imageMode === 'prompt' ? effectivePromptGeneration :
                  imageMode === 'advanced' ? latestAdvancedGeneration :
                  latestFaceSwapGeneration;
                return isRecentEnoughForPanel(gen) ? gen : (gen?.status === 'completed' ? gen : null);
              })()
            }
          />
          
          {/* Generation History under preview - filtered by current mode */}
          <div className="mt-4">
            <GenerationHistory 
              type={imageMode === 'identity' ? 'image-identity' : imageMode === 'prompt' ? 'prompt-image' : imageMode === 'advanced' ? 'advanced-image' : 'face-swap-image'}
              title={
                imageMode === 'identity' ? copy.historyIdentityRecreations :
                imageMode === 'prompt' ? 'Prompt Images' :
                imageMode === 'advanced' ? copy.historyAdvancedGenerations :
                copy.historyFaceSwaps
              }
              limit={6}
            />
          </div>
        </div>
      </div>
      {/* End Split-screen layout */}

      {/* Credits Modal */}
      <AddCreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
    </div>
  );
}

function VideoGeneration() {
  const copy = getGenerateCopy();
  const { user, updateCredits, refreshUserCredits } = useAuthStore();
  const { getTutorial } = useTutorialCatalog();
  const videoTutorialRecreate = getTutorial("generate.video.recreate", "Recreate Video Tutorial");
  const videoTutorialPrompt = getTutorial("generate.video.prompt", "Prompt Video Tutorial");
  const videoTutorialFaceSwap = getTutorial("generate.video.faceswap", copy.talkingHeadTutorialFaceswapVideo);
  const videoTutorialTalking = getTutorial("generate.video.talking", "Talking Video Tutorial");
  const credits = user?.credits ?? 0;

  // Only show failed generations in LivePreviewPanel if they failed recently (last 5 min)
  const RECENT_FAILURE_MS = 5 * 60 * 1000;
  const isRecentEnoughForPanel = (gen) => {
    if (!gen || gen.status !== 'failed') return true;
    const completedAt = gen.completedAt ? new Date(gen.completedAt).getTime() : new Date(gen.createdAt).getTime();
    return Date.now() - completedAt < RECENT_FAILURE_MS;
  };

  // UNIFIED: Single source of truth for all video generations with optimistic updates
  const { all: allVideoGenerationsRaw, isGenerating, isError: generationsLoadError, triggerRefresh, addOptimisticGeneration } = useGenerations("all-videos");
  const allVideoGenerations = Array.isArray(allVideoGenerationsRaw) ? allVideoGenerationsRaw : [];

  const { all: talkingHeadGenerationsRaw, triggerRefresh: triggerTalkingHeadRefresh, addOptimisticGeneration: addOptimisticTalkingHead } = useGenerations("talking-head");
  const talkingHeadGenerations = Array.isArray(talkingHeadGenerationsRaw) ? talkingHeadGenerationsRaw : [];

  // Derive latest for each method from unified data
  const latestRecreateGeneration = allVideoGenerations.find(g => g.type === 'recreate-video' || g.type === 'video') || null;
  const latestPromptVideoGeneration = allVideoGenerations.find(g => g.type === 'prompt-video') || null;
  const latestFaceSwapVideoGeneration = allVideoGenerations.find(g => g.type === 'face-swap') || null;
  const latestTalkingHeadGeneration = talkingHeadGenerations[0] || null;

  // When the latest generation transitions to failed, a server-side refund has already happened.
  // Refresh the credit balance so the user sees the updated count without reloading.
  const prevLatestIdRef = useRef(null);
  const prevLatestStatusRef = useRef(null);
  useEffect(() => {
    const latest = latestRecreateGeneration || latestPromptVideoGeneration || latestFaceSwapVideoGeneration || latestTalkingHeadGeneration;
    if (!latest) return;
    const idChanged = prevLatestIdRef.current !== latest.id;
    const nowFailed = latest.status === 'failed' && prevLatestStatusRef.current !== 'failed';
    if ((idChanged || nowFailed) && latest.status === 'failed') {
      refreshUserCredits();
    }
    prevLatestIdRef.current = latest.id;
    prevLatestStatusRef.current = latest.status;
  }, [latestRecreateGeneration?.status, latestPromptVideoGeneration?.status, latestFaceSwapVideoGeneration?.status, latestTalkingHeadGeneration?.status]);

  // Credit modal state
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  // Cooldown state (500ms between clicks)
  const [lastGenerateTime, setLastGenerateTime] = useState(0);
  const [isCooldown, setIsCooldown] = useState(false);

  // CACHED: Models from React Query (instant on subsequent visits)
  const { models: modelsRaw, isLoading: modelsLoading, invalidateModels } = useCachedModels();
  const models = (Array.isArray(modelsRaw) ? modelsRaw : []).filter(
    (m) => m.status !== "processing"
  );
  const [selectedModel, setSelectedModel] = useState("");
  // Method selection
  const [method, setMethod] = useState("2-step"); // 'quick' or '2-step'

  // Prompt Video state
  const [promptVideoImage, setPromptVideoImage] = useState(null);
  const [promptVideoPrompt, setPromptVideoPrompt] = useState("");
  const [promptVideoDuration, setPromptVideoDuration] = useState(5);
  const [promptVideoGenerating, setPromptVideoGenerating] = useState(false);

  // Face Swap state
  const [sourceVideo, setSourceVideo] = useState(null);
  const [faceImage, setFaceImage] = useState(null);
  const [videoDuration, setVideoDuration] = useState(null);
  const [targetGender, setTargetGender] = useState("female");
  const [faceSwapGenerating, setFaceSwapGenerating] = useState(false);

  // Talking Head state
  const [talkingHeadImage, setTalkingHeadImage] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [languageFilter, setLanguageFilter] = useState("en"); // "en", "sk", "cs"
  const [talkingHeadPrompt, setTalkingHeadPrompt] = useState(""); // Optional mood/behavior
  const [favoriteVoices, setFavoriteVoices] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("favoriteVoices") || "[]");
    } catch {
      return [];
    }
  });
  const [playingPreview, setPlayingPreview] = useState(null);
  const audioRef = useRef(null);
  const [talkingHeadText, setTalkingHeadText] = useState("");
  const [talkingHeadGenerating, setTalkingHeadGenerating] = useState(false);
  const [voices, setVoices] = useState([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  // Recreate Video local generating state (separate from other methods)
  const [recreateVideoGenerating, setRecreateVideoGenerating] = useState(false);

  // Reference video state
  const [referenceVideo, setReferenceVideo] = useState(null);
  const [referenceVideoDuration, setReferenceVideoDuration] = useState(0); // Duration for credit calculation
  const [videoStartingImage, setVideoStartingImage] = useState(null); // Uploaded image to animate
  const [galleryRecreateImage, setGalleryRecreateImage] = useState(null); // Gallery-selected image for recreate
  const [galleryPromptImage, setGalleryPromptImage] = useState(null); // Gallery-selected image for prompt video
  const [galleryTalkingImage, setGalleryTalkingImage] = useState(null); // Gallery-selected image for talking head
  const [keepAudioFromVideo, setKeepAudioFromVideo] = useState(true); // Keep original audio
  const [recreateUltraMode, setRecreateUltraMode] = useState(false); // Kling 3.0 motion-control 1080p (vs default 2.6)

  // Auto-select first model when models load
  useEffect(() => {
    if (models.length > 0 && (!selectedModel || !models.find(m => m.id === selectedModel))) {
      setSelectedModel(models[0]?.id || "");
    }
  }, [models, selectedModel]);

  const { draft: videoDraft, isLoading: videoDraftLoading, saveDraft: saveVideoDraft, clearDraft: clearVideoDraft } = useDraft("generate-video");
  const videoDraftRestoredRef = useRef(false);
  const videoInitialLoadDoneRef = useRef(false);

  useEffect(() => {
    if (videoDraftRestoredRef.current || videoDraftLoading || !videoDraft?.data) {
      if (!videoDraftLoading) {
        videoDraftRestoredRef.current = true;
        setTimeout(() => { videoInitialLoadDoneRef.current = true; }, 0);
      }
      return;
    }
    videoDraftRestoredRef.current = true;
    const d = videoDraft.data;
    if (d.method !== undefined) setMethod(d.method);
    if (d.selectedModel !== undefined) setSelectedModel(d.selectedModel);
    if (d.promptVideoPrompt !== undefined) setPromptVideoPrompt(d.promptVideoPrompt);
    if (d.promptVideoDuration !== undefined) setPromptVideoDuration(d.promptVideoDuration);
    if (d.selectedVoice !== undefined) setSelectedVoice(d.selectedVoice);
    if (d.talkingHeadText !== undefined) setTalkingHeadText(d.talkingHeadText);
    if (d.talkingHeadPrompt !== undefined) setTalkingHeadPrompt(d.talkingHeadPrompt);
    if (d.targetGender !== undefined) setTargetGender(d.targetGender);
    if (d.keepAudioFromVideo !== undefined) setKeepAudioFromVideo(d.keepAudioFromVideo);
    if (d.recreateUltraMode !== undefined) setRecreateUltraMode(d.recreateUltraMode);
    if (d.languageFilter !== undefined) setLanguageFilter(d.languageFilter);
    if (d.promptVideoImage) setPromptVideoImage(d.promptVideoImage);
    if (d.faceImage) setFaceImage(d.faceImage);
    if (d.talkingHeadImage) setTalkingHeadImage(d.talkingHeadImage);
    if (d.videoStartingImage) setVideoStartingImage({ url: d.videoStartingImage });
    if (d.sourceVideo) setSourceVideo({ url: d.sourceVideo });
    if (d.referenceVideo) setReferenceVideo({ url: d.referenceVideo });
    setTimeout(() => { videoInitialLoadDoneRef.current = true; }, 0);
  }, [videoDraft, videoDraftLoading]);

  useEffect(() => {
    if (!videoInitialLoadDoneRef.current) return;
    const data = {
      method,
      selectedModel,
      promptVideoPrompt,
      promptVideoDuration,
      selectedVoice,
      talkingHeadText,
      talkingHeadPrompt,
      targetGender,
      keepAudioFromVideo,
      recreateUltraMode,
      languageFilter,
      promptVideoImage: promptVideoImage || null,
      faceImage: faceImage || null,
      talkingHeadImage: talkingHeadImage || null,
      videoStartingImage: videoStartingImage?.url || null,
      sourceVideo: sourceVideo?.url || null,
      referenceVideo: referenceVideo?.url || null,
    };
    const imageUrls = [
      promptVideoImage,
      faceImage,
      talkingHeadImage,
      videoStartingImage?.url,
      sourceVideo?.url,
      referenceVideo?.url,
    ].filter(Boolean);
    saveVideoDraft(data, imageUrls);
  }, [method, selectedModel, promptVideoPrompt, promptVideoDuration, selectedVoice, talkingHeadText, talkingHeadPrompt, targetGender, keepAudioFromVideo, recreateUltraMode, languageFilter, promptVideoImage, faceImage, talkingHeadImage, videoStartingImage, sourceVideo, referenceVideo]);

  const loadVoices = useCallback(async (forModelId) => {
    try {
      setLoadingVoices(true);
      const response = await api.get("/voices", {
        params: forModelId ? { modelId: forModelId } : {},
      });
      if (response.data.success && response.data.voices) {
        setVoices(response.data.voices);
      }
    } catch (error) {
      console.error("Failed to load voices:", error);
      toast.error("Failed to load voices. Please try again.");
    } finally {
      setLoadingVoices(false);
    }
  }, []);

  useEffect(() => {
    if (method !== "talking-head") return;
    loadVoices(selectedModel || undefined);
  }, [method, selectedModel, loadVoices]);

  const filteredVoices = voices.filter((voice) => {
    // Filter for female voices only (custom model voices included)
    const gender = (voice.labels?.gender || "").toLowerCase();
    if (voice.isModelCustom) return true;
    if (!gender.includes("female")) return false;
    
    // All voices support all languages (en, sk, cs) so no language filtering needed
    // Language filter only affects which preview audio plays
    return true;
  });

  // Sort: saved model voices first, then favorites, then A-Z
  const sortedVoices = [...filteredVoices].sort((a, b) => {
    if (a.isModelCustom && !b.isModelCustom) return -1;
    if (!a.isModelCustom && b.isModelCustom) return 1;
    const aFav = favoriteVoices.includes(a.id);
    const bFav = favoriteVoices.includes(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.name.localeCompare(b.name);
  });

  // Auto-select first voice when filters change and current selection not in list
  useEffect(() => {
    if (sortedVoices.length > 0 && !sortedVoices.find(v => v.id === selectedVoice)) {
      setSelectedVoice(sortedVoices[0].id);
    }
  }, [languageFilter, voices]);

  const toggleFavorite = (voiceId) => {
    const newFavorites = favoriteVoices.includes(voiceId)
      ? favoriteVoices.filter((id) => id !== voiceId)
      : [...favoriteVoices, voiceId];
    setFavoriteVoices(newFavorites);
    localStorage.setItem("favoriteVoices", JSON.stringify(newFavorites));
  };

  const playPreview = async (voice) => {
    // Stop current audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // If clicking same voice, stop
    if (playingPreview === voice.id) {
      setPlayingPreview(null);
      return;
    }

    setPlayingPreview(voice.id);

    try {
      // Use cached Cloudinary URL for selected language
      const audioUrl = voice.previewUrls?.[languageFilter] || voice.previewUrls?.en;
      
      if (!audioUrl) {
        throw new Error("No preview available");
      }
      
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.play().catch((err) => {
        console.error("Failed to play preview:", err);
        toast.error("Failed to play preview");
        setPlayingPreview(null);
      });

      audio.onended = () => {
        setPlayingPreview(null);
        audioRef.current = null;
      };
    } catch (err) {
      console.error("Failed to generate preview:", err);
      toast.error("Failed to play preview");
      setPlayingPreview(null);
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Prompt Video handlers
  const handlePromptVideoImageUpload = (uploadedFile) => {
    setPromptVideoImage(uploadedFile.url);
    setGalleryPromptImage(null);
  };

  const handleGalleryPromptSelect = (url) => {
    setGalleryPromptImage(url);
    setPromptVideoImage(url);
  };

  const handlePromptVideoGenerate = async () => {
    if (!promptVideoImage) {
      toast.error("Please upload an image");
      return;
    }

    if (!promptVideoPrompt.trim()) {
      toast.error(copy.videoToastPromptRequired);
      return;
    }

    try {
      setPromptVideoGenerating(true);

      const payload = {
        imageUrl: promptVideoImage,
        prompt: promptVideoPrompt.trim(),
        duration: promptVideoDuration,
      };
      const response = await api.post("/generate/video-prompt", payload);

      await refreshUserCredits();

      if (response.data.success) {
        // Optimistic update - add to cache immediately for instant UI feedback
        if (response.data.generation) {
          addOptimisticGeneration(response.data.generation);
        }
        toast.success("Video started! Check Live Preview.");
        setPromptVideoImage(null);
        setPromptVideoPrompt("");
        setPromptVideoDuration(5);
        clearVideoDraft();
      } else {
        throw new Error(response.data.message || "Generation failed");
      }
    } catch (error) {
      console.error("Prompt video generation failed:", error);
      toast.error(getApiErrorMessage(error, "Failed to start generation"));
    } finally {
      setPromptVideoGenerating(false);
    }
  };

  // Reference Video upload handler (for Quick & 2-Step)
  const handleVideoStartingImageUpload = (uploadedFile) => {
    setVideoStartingImage(uploadedFile);
    setGalleryRecreateImage(null);
  };

  const handleGalleryRecreateSelect = (url) => {
    setGalleryRecreateImage(url);
    if (url) setVideoStartingImage({ url });
    else setVideoStartingImage(null);
  };

  const handleReferenceVideoUpload = (file) => {
    setReferenceVideo(file);

    // Get video duration for credit calculation
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      const duration = Math.ceil(video.duration);
      setReferenceVideoDuration(duration);
      console.log("✅ Reference video duration:", duration, "seconds");
    };

    video.onerror = (error) => {
      console.error("❌ Failed to load video metadata:", error);
      toast.error("Failed to read video duration. Please try re-uploading.");
      setReferenceVideoDuration(0);
    };

    // Create object URL from uploaded file
    if (file && file.file) {
      video.src = URL.createObjectURL(file.file);
      console.log("📹 Loading video metadata...");
    } else if (file && file.url) {
      // v48 FIX: Handle already uploaded files (from server)
      video.src = file.url;
      console.log("📹 Loading video metadata from URL...");
    } else {
      console.error("❌ Invalid file object:", file);
      toast.error("Invalid video file. Please try re-uploading.");
      setReferenceVideoDuration(0);
    }
  };

  // Face Swap handlers
  const handleVideoUpload = (file) => {
    setSourceVideo(file);

    // Get video duration for credit calculation
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      const duration = Math.ceil(video.duration);
      setVideoDuration(duration);
      console.log("Video duration:", duration, "seconds");
    };

    // Create object URL from uploaded file
    if (file && file.file) {
      video.src = URL.createObjectURL(file.file);
    }
  };

  const handleFaceSwapGenerate = async () => {
    try { sound?.playPop?.(); } catch (_) { /* ignore */ }

    // v46 FIX: Cooldown check (500ms)
    const now = Date.now();
    if (now - lastGenerateTime < 500) {
      return; // Silently block during cooldown
    }
    setLastGenerateTime(now);
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 500);

    if (!selectedModel) {
      toast.error(copy.advancedToastNeedModelFirst);
      return;
    }

    if (!sourceVideo) {
      toast.error("Please upload a video");
      return;
    }

    if (videoDuration <= 0) {
      toast.error("Failed to read video duration. Please try re-uploading.");
      return;
    }

    // Calculate credits based on video duration (10 credits per second)
    const creditsNeeded = Math.ceil(videoDuration * 10);

    if (credits < creditsNeeded) {
      toast.error(
        `Need ${creditsNeeded} 🪙 for ${videoDuration}s video. You have ${credits} 🪙.`,
      );
      return;
    }

    try {
      setFaceSwapGenerating(true);

      const response = await generationAPI.faceSwapVideo(
        sourceVideo.url,
        selectedModel,
        videoDuration,
        targetGender,
      );

      await refreshUserCredits();

      if (response.data.success) {
        // Optimistic update - add to cache immediately for instant UI feedback
        if (response.data.generation) {
          addOptimisticGeneration(response.data.generation);
        }
        toast.success(copy.videoFaceswapToastStarted);
        setSelectedModel("");
        setSourceVideo(null);
        setVideoDuration(0);
        clearVideoDraft();
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Face swap failed"));
    } finally {
      setFaceSwapGenerating(false);
    }
  };

  // Talking Head handlers
  const handleTalkingHeadImageUpload = (uploadedFile) => {
    setTalkingHeadImage(uploadedFile.url);
    setGalleryTalkingImage(null);
  };

  const handleGalleryTalkingSelect = (url) => {
    setGalleryTalkingImage(url);
    setTalkingHeadImage(url);
  };

  const handleTalkingHeadGenerate = async () => {
    const now = Date.now();
    if (now - lastGenerateTime < 500) {
      return;
    }
    setLastGenerateTime(now);
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 500);

    if (!talkingHeadImage) {
      toast.error("Please upload an image");
      return;
    }

    if (!selectedVoice) {
      toast.error("Please select a voice");
      return;
    }

    if (!talkingHeadText.trim() || talkingHeadText.trim().length < 5) {
      toast.error("Please enter at least 5 characters of text");
      return;
    }

    if (talkingHeadText.length > 2000) {
      toast.error("Text must be 2000 characters or less");
      return;
    }

    const estimatedDuration = Math.ceil(talkingHeadText.length / 12.5);
    const creditsNeeded = Math.max(70, Math.ceil(estimatedDuration * 13));

    if (credits < creditsNeeded) {
      toast.error(`Need ~${creditsNeeded} 🪙. You have ${credits} 🪙.`);
      setShowCreditsModal(true);
      return;
    }

    try {
      setTalkingHeadGenerating(true);

      const response = await api.post("/generate/talking-head", {
        imageUrl: talkingHeadImage,
        voiceId: selectedVoice,
        text: talkingHeadText.trim(),
        prompt: talkingHeadPrompt.trim() || undefined,
      });

      await refreshUserCredits();

      if (response.data.success) {
        // Optimistic update - add to cache immediately for instant UI feedback
        if (response.data.generation) {
          addOptimisticTalkingHead(response.data.generation);
        }
        toast.success("Talking head started! Check Live Preview (1-2 min).");
        setTalkingHeadImage(null);
        setTalkingHeadText("");
        setTalkingHeadPrompt("");
        clearVideoDraft();
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to generate talking head video"));
    } finally {
      setTalkingHeadGenerating(false);
    }
  };

  // Generate video using user-provided image + reference video
  const handleGenerateVideo = async () => {
    // Cooldown check (500ms)
    const now = Date.now();
    if (now - lastGenerateTime < 500) {
      return;
    }
    setLastGenerateTime(now);
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 500);

    if (!selectedModel) {
      toast.error("Please select a model");
      return;
    }

    // Guard against missing model photos — backend fetches them and would fail mid-generation consuming credits
    const selectedModelData = models.find(m => m.id === selectedModel);
    if (selectedModelData) {
      const missingPhotos = [selectedModelData.photo1Url, selectedModelData.photo2Url, selectedModelData.photo3Url]
        .filter(url => !url || !url.startsWith('http'));
      if (missingPhotos.length > 0) {
        toast.error(`Your model is missing ${missingPhotos.length} photo(s). Please update your model photos before generating a video.`);
        return;
      }
    }

    if (!videoStartingImage?.url) {
      toast.error("Please upload the starting image you want to animate");
      return;
    }

    if (!referenceVideo) {
      toast.error("Please upload a reference video");
      return;
    }

    if (referenceVideoDuration <= 0) {
      toast.error("Failed to read video duration. Please try re-uploading.");
      return;
    }

    const perSec = recreateUltraMode ? VIDEO_RECREATE_ULTRA_PER_SEC : VIDEO_RECREATE_CLASSIC_PER_SEC;
    const creditsNeeded = Math.ceil(referenceVideoDuration * perSec);
    if (credits < creditsNeeded) {
      toast.error(
        `Need ${creditsNeeded} 🪙 for ${referenceVideoDuration}s video. You have ${credits} 🪙.`,
      );
      return;
    }

    setRecreateVideoGenerating(true);

    try {
      const response = await api.post("/generate/video-motion", {
        modelId: selectedModel,
        generatedImageUrl: videoStartingImage.url,
        referenceVideoUrl: referenceVideo.url,
        videoDuration: referenceVideoDuration,
        keepAudio: keepAudioFromVideo,
        ultraMode: recreateUltraMode,
      });

      await refreshUserCredits();

      if (response.data.success) {
        // Optimistic update - add to cache immediately for instant UI feedback
        if (response.data.generation) {
          addOptimisticGeneration(response.data.generation);
        }
        toast.success("Video started! Check Live Preview (2-3 min).");
        setReferenceVideo(null);
        setReferenceVideoDuration(0);
        setVideoStartingImage(null);
        setKeepAudioFromVideo(true);
        setRecreateUltraMode(false);
        clearVideoDraft();
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Video generation failed"));
      console.error(error);
    } finally {
      setRecreateVideoGenerating(false);
    }
  };

  const recreateCreditsPerSec = recreateUltraMode ? VIDEO_RECREATE_ULTRA_PER_SEC : VIDEO_RECREATE_CLASSIC_PER_SEC;

  return (
    <div
      className="p-0"
    >
      {generationsLoadError && (
        <div className="mb-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-200">Couldn&apos;t load your content. You can still generate; history may be missing until refreshed.</p>
          <button type="button" onClick={() => triggerRefresh()} className="shrink-0 px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 text-amber-100 font-medium text-sm">
            {copy.retry}
          </button>
        </div>
      )}
      {/* Premium Method Selection - ABOVE split layout */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500 font-medium mb-4">Select Method</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Recreate Video */}
          <button
            onClick={() => {
              setMethod("2-step");
              setReferenceVideo(null);
              setReferenceVideoDuration(0);
            }}
            className={`relative p-3 rounded-xl group ${
              method === "2-step" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            style={{
              ...(method === "2-step" ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE),
            }}
            data-testid="button-method-recreate"
          >
            {method === "2-step" && (
              <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
            )}
            {method === "2-step" && (
              <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
            )}
            {method === "2-step" && <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(139,92,246,0.16), transparent 50%)' }} />}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className="font-semibold text-xs">Recreate</span>
                <TutorialButton tutorial={videoTutorialRecreate} showWhenMissing />
              </div>
              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                <span className="text-[9px] font-medium text-yellow-400 inline-flex items-center gap-0.5">Classic 2.6 · 1080p · {VIDEO_RECREATE_CLASSIC_PER_SEC} <Coins className="w-2.5 h-2.5" />/sec</span>
              </div>
              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20">
                <span className="text-[9px] font-medium text-fuchsia-300 inline-flex items-center gap-0.5">Ultra 3.0 · 1080p · {VIDEO_RECREATE_ULTRA_PER_SEC} <Coins className="w-2.5 h-2.5" />/sec</span>
              </div>
              <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(22,163,74,0.15))', border: '1px solid rgba(34,197,94,0.4)' }}>
                <span className="text-[8px] font-bold tracking-wide" style={{ color: '#4ade80' }}>50% OFF</span>
              </div>
            </div>
          </button>

          {/* Prompt Video */}
          <button
            onClick={() => {
              setMethod("prompt");
              setReferenceVideo(null);
              setReferenceVideoDuration(0);
            }}
            className={`relative p-3 rounded-xl group ${
              method === "prompt" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            style={{
              ...(method === "prompt" ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE),
            }}
            data-testid="button-method-prompt"
          >
            {method === "prompt" && (
              <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
            )}
            {method === "prompt" && (
              <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
            )}
            {method === "prompt" && <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(139,92,246,0.16), transparent 50%)' }} />}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className="font-semibold text-xs">Prompt</span>
                <TutorialButton tutorial={videoTutorialPrompt} showWhenMissing />
              </div>
              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                <span className="text-[9px] font-medium text-yellow-400 inline-flex items-center gap-0.5">10-12 <Coins className="w-2.5 h-2.5" />/sec</span>
              </div>
            </div>
          </button>

          {/* Face Swap */}
          <button
            onClick={() => {
              setMethod("face-swap");
              setReferenceVideo(null);
              setReferenceVideoDuration(0);
              setPromptVideoImage(null);
            }}
            className={`relative p-3 rounded-xl group ${
              method === "face-swap" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            style={{
              ...(method === "face-swap" ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE),
            }}
            data-testid="button-method-faceswap"
          >
            {method === "face-swap" && (
              <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
            )}
            {method === "face-swap" && (
              <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
            )}
            {method === "face-swap" && <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(139,92,246,0.16), transparent 50%)' }} />}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className="font-semibold text-xs">{copy.videoMethodFaceSwapShort}</span>
                <TutorialButton tutorial={videoTutorialFaceSwap} showWhenMissing />
              </div>
              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                <span className="text-[9px] font-medium text-yellow-400 inline-flex items-center gap-0.5">10 <Coins className="w-2.5 h-2.5" />/sec</span>
              </div>
            </div>
          </button>

          {/* Talking Head */}
          <button
            onClick={() => {
              setMethod("talking-head");
              setReferenceVideo(null);
              setReferenceVideoDuration(0);
              setPromptVideoImage(null);
            }}
            className={`relative p-3 rounded-xl group ${
              method === "talking-head" ? "text-white" : "text-slate-400 hover:text-white"
            }`}
            style={{
              ...(method === "talking-head" ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE),
            }}
            data-testid="button-method-talking-head"
          >
            {method === "talking-head" && (
              <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
            )}
            {method === "talking-head" && (
              <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
            )}
            {method === "talking-head" && <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(139,92,246,0.16), transparent 50%)' }} />}
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className="font-semibold text-xs">Talking</span>
                <TutorialButton tutorial={videoTutorialTalking} showWhenMissing />
              </div>
              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20">
                <span className="text-[9px] font-medium text-yellow-400 inline-flex items-center gap-0.5">~13 <Coins className="w-2.5 h-2.5" />/sec</span>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Split-screen layout: Controls left, Preview right */}
      <div className="flex flex-col lg:flex-row lg:gap-8">
        {/* Left side - Controls */}
        <div className="lg:w-[55%] bg-black">

      {/* Recreate Video Method UI */}
      {method === "2-step" && (
        <div>
          {/* Pro Tip - Compact */}
          <div className="mb-3 flex items-start gap-2.5 p-3 rounded-xl" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)' }}>
            <Info className="w-4 h-4 text-white flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <span className="text-white font-bold">Pro Tip:</span> Generate an image first with matching pose/clothing, then upload it here.
            </p>
          </div>

          {/* Advanced Model Notice */}
          <div className="mb-5 p-3 rounded-xl" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <span className="text-white font-bold">{copy.videoNoticeAdvancedMotionTitle}</span> {copy.videoNoticeAdvancedMotionBody}
            </p>
          </div>

          {/* Model Selection - Collapsible */}
          <ModelSelector
            models={models}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
            accentColor="purple"
            stepNumber="1"
          />

          {/* Starting Image Upload */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>2</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.videoRecreateStartingImage}</label>
            </div>
            <ImageSourceSelector
              modelId={selectedModel}
              onUpload={handleVideoStartingImageUpload}
              onGallerySelect={handleGalleryRecreateSelect}
              preview={videoStartingImage}
              selectedGalleryImage={galleryRecreateImage}
              accentColor="purple"
            />
          </div>

          {/* Video Upload */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>3</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.videoRecreateReferenceVideo}</label>
            </div>
            <FileUpload type="video" acceptOnlyMp4 onUpload={(file) => handleReferenceVideoUpload(file)} preview={referenceVideo} large />
            {referenceVideoDuration > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
                  <span className="inline-flex items-center gap-0.5">
                    {referenceVideoDuration}s = {Math.ceil(referenceVideoDuration * recreateCreditsPerSec)} <Coins className="w-2.5 h-2.5" />
                  </span>
                </span>
                <span className="px-1.5 py-0.5 text-[8px] font-bold rounded-full tracking-wide" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(22,163,74,0.15))', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80' }}>
                  {recreateUltraMode ? copy.videoRecreateUltraBadge : copy.videoRecreateClassicBadge}
                </span>
                <span className="text-[9px] text-slate-500">
                  {recreateUltraMode
                    ? copy.videoRecreateUltraDesc
                    : copy.videoRecreateClassicDesc}
                </span>
              </div>
            )}
          </div>

          <div className="mb-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              <span className="text-slate-200 font-medium">{copy.videoRecreateClassicInfoPrefix}</span> {copy.videoRecreateClassicInfoValue} · ~{VIDEO_RECREATE_CLASSIC_PER_SEC}{" "}
              <Coins className="w-2.5 h-2.5 inline" />
              /sec
            </p>
          </div>

          {/* Ultra: Motion Control Pro+ @ 1080p */}
          <div className="mb-5 flex items-start gap-3">
            <button
              type="button"
              onClick={() => setRecreateUltraMode(!recreateUltraMode)}
              className={`relative mt-0.5 w-10 h-5 shrink-0 rounded-full transition-all flex items-center ${recreateUltraMode ? "bg-fuchsia-500" : "bg-slate-600"}`}
              data-testid="toggle-recreate-ultra-mode"
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${recreateUltraMode ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </button>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-300 font-medium">{copy.videoRecreateUltraToggleTitle}</p>
              <p className="text-[10px] text-slate-500 leading-snug">
                {copy.videoRecreateUltraToggleDesc} · ~{VIDEO_RECREATE_ULTRA_PER_SEC} <Coins className="w-2.5 h-2.5 inline" />/sec
              </p>
            </div>
          </div>

          {/* Audio Toggle */}
          <div className="mb-5 flex items-center gap-3">
            <button
              onClick={() => setKeepAudioFromVideo(!keepAudioFromVideo)}
              className={`relative w-10 h-5 rounded-full transition-all flex items-center ${keepAudioFromVideo ? 'bg-emerald-500' : 'bg-red-500'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${keepAudioFromVideo ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-[11px] text-slate-400">{copy.videoKeepAudio} {keepAudioFromVideo ? <span className="text-green-400 font-bold">{copy.on}</span> : <span className="text-slate-500 font-bold">{copy.off}</span>}</span>
          </div>

          {/* Generate Button */}
          {referenceVideoDuration > 0 && credits < Math.ceil(referenceVideoDuration * recreateCreditsPerSec) ? (
            <button
              onClick={() => setShowCreditsModal(true)}
              className="w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-white text-black hover:bg-white/90"
              data-testid="button-get-credits-recreate-video"
            >
              <CreditCard className="w-4 h-4" />
              {copy.getCredits} <span className="inline-flex items-center gap-0.5 text-red-500">({Math.ceil(referenceVideoDuration * recreateCreditsPerSec)} <Coins className="w-3.5 h-3.5" />)</span>
            </button>
          ) : (
            <button
              onClick={handleGenerateVideo}
              disabled={recreateVideoGenerating || !selectedModel || !videoStartingImage?.url || !referenceVideo || referenceVideoDuration <= 0 || isCooldown}
              className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:cursor-not-allowed ${(recreateVideoGenerating || !selectedModel || !videoStartingImage?.url || !referenceVideo || referenceVideoDuration <= 0 || isCooldown) ? 'bg-white/10 text-white/40' : 'bg-white text-black hover:bg-white/90'}`}
              data-testid="button-generate-video"
            >
              {recreateVideoGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  {copy.generating}
                </>
              ) : (
                <>
                  <Video className="w-5 h-5" />
                  {copy.generateVideo} <span className="inline-flex items-center gap-0.5 text-yellow-400">{referenceVideoDuration > 0
                    ? <>{Math.ceil(referenceVideoDuration * recreateCreditsPerSec)} <Coins className="w-3.5 h-3.5" /></>
                    : <>~ <Coins className="w-3.5 h-3.5" /></>}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Prompt Video Method */}
      {method === "prompt" && (
        <div>
          {/* Image Upload - Start Frame */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>1</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.promptVideoStartFrame}</label>
            </div>
            <ImageSourceSelector
              modelId={selectedModel}
              onUpload={handlePromptVideoImageUpload}
              onGallerySelect={handleGalleryPromptSelect}
              preview={promptVideoImage ? { url: promptVideoImage } : null}
              selectedGalleryImage={galleryPromptImage}
              accentColor="pink"
            />
          </div>

          {/* Prompt Input */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>2</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.promptVideoMotionPrompt}</label>
            </div>
            <textarea
              value={promptVideoPrompt}
              onChange={(e) => setPromptVideoPrompt(e.target.value)}
              placeholder={copy.promptVideoMotionPromptPlaceholder}
              className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              rows={3}
              maxLength={500}
              data-testid="input-video-prompt"
            />
            <div className="flex justify-end mt-1.5">
              <span className="text-[10px] text-slate-600">{promptVideoPrompt.length}/500</span>
            </div>
          </div>

          {/* Duration Selection */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>3</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.promptVideoDuration}</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPromptVideoDuration(5)}
                className="relative p-3 rounded-xl text-left group"
                style={promptVideoDuration === 5 ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE}
                data-testid="button-duration-5"
              >
                {promptVideoDuration === 5 && <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />}
                {promptVideoDuration === 5 && <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />}
                <div className="relative flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm text-slate-200">{copy.promptVideoDuration5}</span>
                  </div>
                  {promptVideoDuration === 5 && (
                    <div className="w-4 h-4 rounded-full flex items-center justify-center bg-white">
                      <Check className="w-2.5 h-2.5 text-black" />
                    </div>
                  )}
                </div>
              </button>
              <button
                onClick={() => setPromptVideoDuration(10)}
                className="relative p-3 rounded-xl text-left group"
                style={promptVideoDuration === 10 ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE}
                data-testid="button-duration-10"
              >
                {promptVideoDuration === 10 && <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />}
                {promptVideoDuration === 10 && <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />}
                <div className="relative flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm text-slate-200">{copy.promptVideoDuration10}</span>
                  </div>
                  {promptVideoDuration === 10 && (
                    <div className="w-4 h-4 rounded-full flex items-center justify-center bg-white">
                      <Check className="w-2.5 h-2.5 text-black" />
                    </div>
                  )}
                </div>
              </button>
            </div>
          </div>

          {/* Generate Button */}
          {credits < (promptVideoDuration === 5 ? 60 : 100) ? (
            <button
              onClick={() => setShowCreditsModal(true)}
              className="w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-white text-black hover:bg-white/90"
              data-testid="button-get-credits-prompt-video"
            >
              <CreditCard className="w-4 h-4" />
              {copy.getCredits} <span className="inline-flex items-center gap-0.5 text-red-500">({promptVideoDuration === 5 ? 60 : 100} <Coins className="w-3.5 h-3.5" />)</span>
            </button>
          ) : (
            <button
              onClick={handlePromptVideoGenerate}
              disabled={!promptVideoImage || !promptVideoPrompt.trim() || promptVideoGenerating || isCooldown}
              className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:cursor-not-allowed ${(!promptVideoImage || !promptVideoPrompt.trim() || promptVideoGenerating || isCooldown) ? 'bg-white/10 text-white/40' : 'bg-white text-black hover:bg-white/90'}`}
              data-testid="button-generate-prompt-video"
            >
              {promptVideoGenerating ? (
                <>
                  <Zap className="w-4 h-4 text-yellow-400" />
                  {copy.generating}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-white" />
                  {copy.promptVideoAction} <span className="inline-flex items-center gap-0.5 text-yellow-400">{promptVideoDuration === 5 ? 60 : 100} <Coins className="w-3.5 h-3.5" /></span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Face Swap Method */}
      {method === "face-swap" && (
        <div>
          {/* Model Selection - Collapsible */}
          <ModelSelector
            models={models}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
            accentColor="cyan"
            stepNumber="1"
          />

          {/* Source Video Upload */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>2</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.faceswapVideoSourceVideo}</label>
            </div>
            <FileUpload type="video" onUpload={handleVideoUpload} preview={sourceVideo} large />
            {videoDuration > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full" style={{ background: 'rgba(34,211,238,0.15)', color: '#22D3EE' }}>
                  <span className="inline-flex items-center gap-0.5">{videoDuration}s = {Math.ceil(videoDuration * 10)} <Coins className="w-2.5 h-2.5" /></span>
                </span>
              </div>
            )}
          </div>

          {/* Target Gender Filter */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>3</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.faceswapVideoTargetGender}</label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["all", "male", "female"].map((gender) => (
                <button
                  key={gender}
                  onClick={() => { setTargetGender(gender); }}
                  data-testid={`gender-${gender}`}
                  className="relative p-2.5 rounded-xl text-center group"
                  style={targetGender === gender ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE}
                >
                  {targetGender === gender && <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />}
                  {targetGender === gender && <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />}
                  <span className={`relative text-xs font-medium ${targetGender === gender ? 'text-white' : 'text-slate-400'}`}>
                    {gender === "female" ? copy.faceswapVideoGenderFemale : gender === "male" ? copy.faceswapVideoGenderMale : copy.talkingHeadLanguageAll}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          {videoDuration > 0 && credits < Math.ceil(videoDuration * 10) ? (
            <button
              onClick={() => setShowCreditsModal(true)}
              className="w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-white text-black hover:bg-white/90"
              data-testid="button-get-credits-faceswap-video"
            >
              <CreditCard className="w-4 h-4" />
              {copy.getCredits} <span className="inline-flex items-center gap-0.5 text-red-500">({Math.ceil(videoDuration * 10)} <Coins className="w-3.5 h-3.5" />)</span>
            </button>
          ) : (
            <button
              onClick={handleFaceSwapGenerate}
              disabled={faceSwapGenerating || !selectedModel || !sourceVideo || videoDuration <= 0 || isCooldown}
              data-testid="button-generate-faceswap"
              className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:cursor-not-allowed ${(faceSwapGenerating || !selectedModel || !sourceVideo || videoDuration <= 0 || isCooldown) ? 'bg-white/10 text-white/40' : 'bg-white text-black hover:bg-white/90'}`}
            >
              {faceSwapGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  {copy.generating}
                </>
              ) : (
                <>
                  <RefreshCcw className="w-4 h-4" />
                  {copy.faceswapVideoAction || copy.faceswapAction} <span className="inline-flex items-center gap-0.5 text-yellow-400">{videoDuration > 0 ? <>{Math.ceil(videoDuration * 10)} <Coins className="w-3.5 h-3.5" /></> : <>~ <Coins className="w-3.5 h-3.5" /></>}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Talking Head Method UI */}
      {method === "talking-head" && (
        <div>
          {/* Image Upload */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>1</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.talkingHeadPortraitImage}</label>
            </div>
            <ImageSourceSelector
              modelId={selectedModel}
              onUpload={handleTalkingHeadImageUpload}
              onGallerySelect={handleGalleryTalkingSelect}
              preview={talkingHeadImage ? { url: talkingHeadImage } : null}
              selectedGalleryImage={galleryTalkingImage}
              accentColor="orange"
            />
          </div>

          {/* Voice Selection */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>2</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.talkingHeadVoice}</label>
            </div>

            {selectedModel ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openVoiceStudioForModel?.(selectedModel)}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-200 hover:bg-violet-600/30 transition-colors"
                >
                  {copy.talkingHeadOpenVoiceStudio}
                </button>
                {models.find((m) => m.id === selectedModel)?.elevenLabsVoiceId ? (
                  <span className="text-[10px] text-emerald-400/90">{copy.talkingHeadDefaultVoiceReady}</span>
                ) : null}
              </div>
            ) : null}
            
            {/* Language Filter */}
            <div className="mb-3 grid grid-cols-3 gap-2">
              {[
                { id: "en", label: "English" },
                { id: "sk", label: copy.talkingHeadLanguageSk },
                { id: "cs", label: copy.talkingHeadLanguageCs },
              ].map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => { setLanguageFilter(lang.id); setSelectedVoice(""); }}
                  data-testid={`filter-lang-${lang.id}`}
                  className="relative p-2 rounded-xl text-center group"
                  style={languageFilter === lang.id ? SELECTED_GLASS_STYLE : UNSELECTED_GLASS_STYLE}
                >
                  {languageFilter === lang.id && <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />}
                  {languageFilter === lang.id && <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />}
                  <span className={`relative text-xs font-medium ${languageFilter === lang.id ? 'text-white' : 'text-slate-400'}`}>{lang.label}</span>
                </button>
              ))}
            </div>

            {loadingVoices ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-4 h-4 border-2 border-white/20 border-t-orange-400 rounded-full animate-spin" />
                <span className="ml-2 text-[11px] text-slate-400">{copy.talkingHeadVoiceLoading}</span>
              </div>
            ) : sortedVoices.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-[11px] text-slate-400">{voices.length === 0 ? copy.talkingHeadVoiceEmpty : copy.talkingHeadVoiceEmpty}</p>
                {voices.length === 0 && <button onClick={loadVoices} className="mt-2 text-[10px] text-orange-400 hover:underline">{copy.retry}</button>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                {sortedVoices.map((voice, index) => (
                  <button
                    key={voice.id}
                    onClick={() => { setSelectedVoice(voice.id); }}
                    data-testid={`voice-card-${voice.id}`}
                    className={`relative p-2 rounded-lg text-left group ${
                      selectedVoice === voice.id 
                        ? '' 
                        : 'bg-white/[0.02] hover:bg-white/[0.04]'
                    } ${sortedVoices.length % 2 === 1 && index === sortedVoices.length - 1 ? 'col-span-2' : ''}`}
                    style={selectedVoice === voice.id ? SELECTED_GLASS_STYLE : undefined}
                  >
                    {selectedVoice === voice.id && (
                      <>
                        <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
                      </>
                    )}
                    <div className="flex items-center gap-2">
                      <div
                        onClick={(e) => { e.stopPropagation(); playPreview(voice); }}
                        data-testid={`preview-voice-${voice.id}`}
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 cursor-pointer ${
                          playingPreview === voice.id ? "text-white" : "text-slate-500 hover:text-white"
                        }`}
                        style={{ background: playingPreview === voice.id ? 'linear-gradient(135deg, #F97316, #EC4899)' : 'rgba(255,255,255,0.05)' }}
                      >
                        {playingPreview === voice.id ? <Pause className="w-2.5 h-2.5" /> : <Volume2 className="w-2.5 h-2.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] font-medium truncate ${selectedVoice === voice.id ? 'text-white' : 'text-slate-300'}`}>
                          {voice.isModelCustom ? (voice.modelName || voice.name) : voice.name}
                        </p>
                        <p className="text-[9px] text-slate-500 truncate">
                          {voice.isModelCustom
                            ? (voice.voiceType === "clone" ? "Voice clone" : "Designed voice")
                            : (voice.labels?.accent || "AI")}
                        </p>
                      </div>
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(voice.id); }}
                        data-testid={`favorite-voice-${voice.id}`}
                        className={`w-5 h-5 flex items-center justify-center shrink-0 cursor-pointer ${favoriteVoices.includes(voice.id) ? "text-pink-500" : "text-slate-600 hover:text-pink-400"}`}
                      >
                        <Heart className={`w-2.5 h-2.5 ${favoriteVoices.includes(voice.id) ? "fill-current" : ""}`} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Text Input */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>3</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">Script</label>
            </div>
            <textarea
              value={talkingHeadText}
              onChange={(e) => setTalkingHeadText(e.target.value)}
              placeholder="Enter the text you want them to speak..."
              className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              rows={4}
              maxLength={2000}
              data-testid="input-talking-head-text"
            />
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1.5">
              <span className="text-amber-400">Tip:</span> Write grammatically correct text for best results
            </p>
            <div className="flex items-center justify-between mt-1.5">
              {talkingHeadText.length >= 5 && (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>
                  <span className="inline-flex items-center gap-0.5">~{Math.max(70, Math.ceil(Math.ceil(talkingHeadText.length / 12.5) * 13))} <Coins className="w-2.5 h-2.5" /></span>
                </span>
              )}
              <span className="text-[10px] text-slate-600 ml-auto">{talkingHeadText.length}/2000</span>
            </div>
          </div>

          {/* Optional Prompt */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(203, 213, 225, 0.9)', color: '#0f172a', border: '1px solid rgba(255,255,255,0.2)' }}>4</div>
              <label className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">Mood <span className="text-slate-600">(Optional)</span></label>
            </div>
            <input
              type="text"
              value={talkingHeadPrompt}
              onChange={(e) => setTalkingHeadPrompt(e.target.value)}
              placeholder="e.g. friendly presenter, natural smile..."
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              maxLength={200}
              data-testid="input-talking-head-prompt"
            />
          </div>

          {/* Generate Button */}
          {talkingHeadText.length >= 5 && credits < Math.max(70, Math.ceil(Math.ceil(talkingHeadText.length / 12.5) * 13)) ? (
            <button
              onClick={() => setShowCreditsModal(true)}
              className="w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-white text-black hover:bg-white/90"
              data-testid="button-get-credits-talking-head"
            >
              <CreditCard className="w-4 h-4" />
              Get Credits <span className="inline-flex items-center gap-0.5 text-red-500">({Math.max(70, Math.ceil(Math.ceil(talkingHeadText.length / 12.5) * 13))} <Coins className="w-3.5 h-3.5" />)</span>
            </button>
          ) : (
            <button
              onClick={handleTalkingHeadGenerate}
              disabled={talkingHeadGenerating || !talkingHeadImage || !selectedVoice || talkingHeadText.length < 5 || isCooldown}
              data-testid="button-generate-talking-head"
              className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:cursor-not-allowed ${(talkingHeadGenerating || !talkingHeadImage || !selectedVoice || talkingHeadText.length < 5 || isCooldown) ? 'bg-white/10 text-white/40' : 'bg-white text-black hover:bg-white/90'}`}
            >
              {talkingHeadGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  Generate <span className="inline-flex items-center gap-0.5 text-yellow-400">{talkingHeadText.length >= 5 ? <>{Math.max(70, Math.ceil(Math.ceil(talkingHeadText.length / 12.5) * 13))} <Coins className="w-3.5 h-3.5" /></> : <>70+ <Coins className="w-3.5 h-3.5" /></>}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

        </div>
        {/* End Left side */}

        {/* Right side - Live Preview (changes based on current method) */}
        <div className="w-full mt-6 lg:mt-0 lg:w-[45%] lg:sticky lg:top-4 lg:self-start">
          <LivePreviewPanel 
            type={method === '2-step' ? 'video' : method === 'prompt' ? 'prompt-video' : method === 'talking-head' ? 'talking-head' : 'face-swap'}
            latestGeneration={
              (() => {
                const gen = method === '2-step' ? latestRecreateGeneration :
                  method === 'prompt' ? latestPromptVideoGeneration :
                  method === 'talking-head' ? latestTalkingHeadGeneration :
                  latestFaceSwapVideoGeneration;
                return isRecentEnoughForPanel(gen) ? gen : (gen?.status === 'completed' ? gen : null);
              })()
            }
          />
          
          {/* Generation History under preview - filtered by current method */}
          <div className="mt-4">
            <GenerationHistory 
              type={method === '2-step' ? 'video' : method === 'prompt' ? 'prompt-video' : method === 'talking-head' ? 'talking-head' : 'face-swap'}
              title={
                method === '2-step' ? 'Recreate Videos' :
                method === 'prompt' ? 'Prompt Videos' :
                method === 'talking-head' ? 'Talking Head Videos' :
                copy.videoHistoryFaceSwapVideos
              }
              limit={6}
            />
          </div>
        </div>
      </div>
      {/* End Split-screen layout */}

      {/* Credits Modal */}
      <AddCreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />

    </div>
  );
}

function PromptImageContent({ onGenerationUpdate, models, selectedModel, setSelectedModel, clearDraft }) {
  const copy = getGenerateCopy();
  const { user, refreshUserCredits } = useAuthStore();
  const credits = user?.credits ?? 0;

  // SIMPLE: Local state for active generation - no complex cache sync
  const { activeGeneration, isGenerating, startGeneration, pollForCompletion, setFailed } = useActiveGeneration();

  // Notify parent when activeGeneration changes (for LivePreviewPanel)
  useEffect(() => {
    onGenerationUpdate?.(activeGeneration);
  }, [activeGeneration, onGenerationUpdate]);

  // Credit modal state
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  // Cooldown state (500ms between clicks)
  const [lastGenerateTime, setLastGenerateTime] = useState(0);
  const [isCooldown, setIsCooldown] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("amateur"); // Fixed to amateur for AI enhancer
  const [contentRating, setContentRating] = useState("sexy"); // Fixed to sexy for AI enhancer
  const [enhancing, setEnhancing] = useState(false);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false); // Toggle for custom vs AI-enhanced
  const [useNsfw, setUseNsfw] = useState(false); // SFW (Nano Banana) vs NSFW (Seedream v4.5)

  // Draft: persist prompt text, nsfw toggle, custom prompt toggle across navigation
  const { draft: promptDraft, isLoading: promptDraftLoading, saveDraft: savePromptDraft, saveDraftNow: savePromptDraftNow, clearDraft: clearPromptDraft } = useDraft("prompt-image");
  const promptDraftRestoredRef = useRef(false);
  const promptDraftReadyRef = useRef(false);

  // Restore draft on mount — also re-trigger enhancement if it was in-flight when user left
  useEffect(() => {
    if (promptDraftRestoredRef.current || promptDraftLoading) return;
    promptDraftRestoredRef.current = true;
    if (promptDraft?.data) {
      const d = promptDraft.data;
      if (d.prompt !== undefined) setPrompt(d.prompt);
      if (d.useNsfw !== undefined) setUseNsfw(d.useNsfw);
      if (d.useCustomPrompt !== undefined) setUseCustomPrompt(d.useCustomPrompt);
    }
    setTimeout(() => { promptDraftReadyRef.current = true; }, 0);
  }, [promptDraft, promptDraftLoading]);

  // Auto-save draft whenever prompt/toggles change (debounced via useDraft)
  useEffect(() => {
    if (!promptDraftReadyRef.current) return;
    savePromptDraft({ prompt, useNsfw, useCustomPrompt }, []);
  }, [prompt, useNsfw, useCustomPrompt]);

  // Prompt Video handlers
  const handlePromptVideoImageUpload = (uploadedFile) => {
    setPromptVideoImage(uploadedFile.url);
  };

  const handlePromptVideoGenerate = async () => {
    // v46 FIX: Cooldown check (500ms)
    const now = Date.now();
    if (now - lastGenerateTime < 500) {
      return; // Silently block during cooldown
    }
    setLastGenerateTime(now);
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 500);

    if (!promptVideoImage) {
      toast.error("Please upload an image");
      return;
    }

    if (!promptVideoPrompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    try {
      setPromptVideoGenerating(true);

      const response = await api.post("/generate/video-prompt", {
        imageUrl: promptVideoImage,
        prompt: promptVideoPrompt.trim(),
        duration: promptVideoDuration,
      });

      await refreshUserCredits();
      triggerRefresh();

      if (response.data.success) {
        toast.success("Video started! Check Live Preview.");
        setPromptVideoImage(null);
        setPromptVideoPrompt("");
        setPromptVideoDuration(5);
      } else {
        throw new Error(response.data.message || "Generation failed");
      }
    } catch (error) {
      console.error("Prompt video generation failed:", error);
      toast.error(getApiErrorMessage(error, "Failed to start generation"));
    } finally {
      setPromptVideoGenerating(false);
    }
  };

  // AI-powered prompt enhancement — costs 10 credits, mode-aware Grok superprompt
  // casual → Seedream/NanoBanana natural language
  // nsfw → Illustrious Danbooru tag format
  // ultra-realism → NanoBanana Pro 6-component reasoning superprompt
  const enhancePrompt = async () => {
    const input = prompt.trim();

    if (!input) {
      toast.error("Please enter a prompt first");
      return;
    }

    setEnhancing(true);

    // Map current UI state to backend mode
    const mode = useNsfw ? "nsfw" : "casual";

    // Pass model look variables so Grok knows what the subject looks like
    const currentModel = models?.find(m => m.id === selectedModel);

    // Build looks from savedAppearance chips (gender, hairColor, etc.)
    let chipLooks = currentModel?.savedAppearance || null;
    if (!chipLooks && currentModel?.aiGenerationParams) {
      try {
        const p = typeof currentModel.aiGenerationParams === "string"
          ? JSON.parse(currentModel.aiGenerationParams)
          : currentModel.aiGenerationParams;
        const keys = ["gender","hairColor","hairLength","hairTexture","eyeColor","bodyType","heritage","faceType","lipSize","style"];
        const l = {};
        keys.forEach(k => { if (p?.[k]) l[k] = p[k]; });
        if (Object.keys(l).length > 0) chipLooks = l;
      } catch { /* ignore */ }
    }

    // Always use model.age (the authoritative integer) — never stale savedAppearance.age/ageRange
    const modelAge = currentModel?.age ?? null;
    const modelLooks = (chipLooks || modelAge)
      ? {
          ...(chipLooks ? Object.fromEntries(Object.entries(chipLooks).filter(([k]) => k !== "age" && k !== "ageRange")) : {}),
          ...(modelAge ? { age: modelAge } : {}),
        }
      : null;

    try {
      const response = await api.post("/generate/enhance-prompt", {
        prompt: input,
        mode,
        ...(modelLooks && { modelLooks }),
      });

      if (response.data.success) {
        const enhanced = response.data.enhancedPrompt;
        // Persist to draft immediately (no debounce) so navigating away doesn't lose it
        await savePromptDraftNow({ prompt: enhanced, useNsfw, useCustomPrompt }, []);
        setPrompt(enhanced);
        const modeLabel = useNsfw ? "Spicy" : "Casual";
        const enhanceCost = 10;
        toast.success(`Prompt enhanced! ${modeLabel} mode · ${enhanceCost} 🪙 used`);
        // Refresh credits so balance updates immediately
        await refreshUserCredits?.();
      } else {
        toast.error(response.data.message || "Enhancement failed");
      }
    } catch (error) {
      console.error("Enhancement error:", error);
      const msg = error.response?.data?.message || "Failed to enhance prompt";
      toast.error(msg);
    } finally {
      setEnhancing(false);
    }
  };

  const handleGenerate = async () => {
    // Cooldown check (500ms)
    const now = Date.now();
    if (now - lastGenerateTime < 500) {
      return;
    }
    setLastGenerateTime(now);
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 500);

    if (!selectedModel) {
      toast.error("Please select a model first");
      return;
    }

    if (!prompt.trim()) {
      toast.error("Please enter a creative prompt");
      return;
    }

    // STEP 1: Create placeholder and show generating state immediately
    const tempId = `temp-${Date.now()}`;
    startGeneration({
      id: tempId,
      type: 'prompt-image',
      status: 'processing',
      prompt: prompt.trim(),
      outputUrl: null,
      createdAt: new Date().toISOString(),
    });

    // Derive settings from NSFW toggle
    // SFW → pg13 + amateur, NSFW → sexy + amateur
    const effectiveRating = useNsfw ? "sexy" : "pg13";
    const effectiveStyle = "amateur";

    try {
      const response = await api.post("/generate/prompt-image", {
        modelId: selectedModel,
        prompt: prompt.trim(),
        quantity: 1,
        style: effectiveStyle,
        contentRating: effectiveRating,
        useNsfw, // true = Seedream v4.5, false = Nano Banana
        useCustomPrompt, // true = raw prompt without AI enhancement/prefixes
      });

      await refreshUserCredits();

      if (response.data.success && response.data.generation) {
        pollForCompletion(response.data.generation.id, {
          onFailure: () => refreshUserCredits(), // Refund happened server-side — sync the balance
        });
       
        toast.success("Generating! Watch Live Preview.");
        clearDraft?.();
        clearPromptDraft?.();
      } else {
        setFailed(response.data.message || "Generation failed");
        toast.error(response.data.message || "Generation failed");
      }
    } catch (error) {
      console.error("Generation failed:", error);
      const errMsg = getApiErrorMessage(error, "Failed to generate images");
      setFailed(errMsg);
      toast.error(errMsg);
    }
  };

  // Preview handler - opens image in new tab
  const handlePreview = (generation) => {
    if (generation.imageUrl) {
      window.open(generation.imageUrl, "_blank");
    }
  };

  // Download handler
  const handleDownload = async (generation) => {
    const url = generation.outputUrl || generation.imageUrl;
    if (!url) return;

    try {
      const lowerUrl = url.toLowerCase();
      const isVideo = ["video", "faceswap", "face-swap", "prompt-video", "talking-head", "recreate-video"].includes(generation.type) || lowerUrl.includes('.mp4') || lowerUrl.includes('.webm');
      const extension = isVideo ? (lowerUrl.includes('.webm') ? 'webm' : 'mp4') : "jpg";
      const filename = `modelclone_${generation.type || 'prompt'}_${generation.id.slice(0, 8)}.${extension}`;
      
      // Use backend proxy to avoid CORS issues
      const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Download started!");
    } catch (error) {
      console.error("Download failed:", error);
      toast.error("Failed to download");
    }
  };

  return (
    <>
      <div className="mb-6">
        {/* SFW/NSFW Toggle */}
        <div className="mb-6">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
               
                setUseNsfw(false);
              }}
              data-testid="button-mode-sfw"
              className="relative p-3 rounded-xl text-left group"
              style={{
                background: !useNsfw 
                  ? 'rgba(139, 92, 246, 0.14)'
                  : 'rgba(20,20,30,0.45)',
                border: !useNsfw
                  ? '1px solid rgba(255, 255, 255, 0.16)'
                  : '1px solid rgba(255,255,255,0.1)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
              }}
            >
              {!useNsfw && (
                <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
              )}
              {!useNsfw && (
                <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
              )}
              <div className="relative flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center transition-all ${
                  !useNsfw 
                    ? 'bg-white' 
                    : 'border-2 border-white/20'
                }`}>
                  {!useNsfw && <Check className="w-2.5 h-2.5 text-black" />}
                </div>
                <span className="font-medium text-sm text-slate-200">Casual</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 ml-6">For casual IG style pics</p>
              <div className="mt-1.5 ml-6 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-medium bg-yellow-500/10 border border-yellow-500/20 text-yellow-400" data-testid="text-price-casual">20 <Coins className="w-2.5 h-2.5" /></span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold tracking-wide" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(22,163,74,0.15))', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80' }}>33% OFF</span>
              </div>
            </button>

            <button
              onClick={() => {
               
                setUseNsfw(true);
              }}
              data-testid="button-mode-nsfw"
              className="relative p-3 rounded-xl text-left group"
              style={{
                background: useNsfw 
                  ? 'rgba(139, 92, 246, 0.14)'
                  : 'rgba(20,20,30,0.45)',
                border: useNsfw
                  ? '1px solid rgba(255, 255, 255, 0.16)'
                  : '1px solid rgba(255,255,255,0.1)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
              }}
            >
              {useNsfw && (
                <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
              )}
              {useNsfw && (
                <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
              )}
              <div className="relative flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center transition-all ${
                  useNsfw 
                    ? 'bg-white' 
                    : 'border-2 border-white/20'
                }`}>
                  {useNsfw && <Check className="w-2.5 h-2.5 text-black" />}
                </div>
                <span className="font-medium text-sm text-slate-200">Sexy</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 ml-6">Designed for sexy content</p>
              <div className="mt-1.5 ml-6 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-medium bg-yellow-500/10 border border-yellow-500/20 text-yellow-400" data-testid="text-price-sexy">10 <Coins className="w-2.5 h-2.5" /></span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold tracking-wide" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(22,163,74,0.15))', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80' }} data-testid="text-discount-badge">50% OFF</span>
              </div>
            </button>
          </div>
        </div>

        {/* Model Selection - Collapsible */}
        <ModelSelector
          models={models}
          selectedModel={selectedModel}
          onSelect={setSelectedModel}
          accentColor="purple"
          label="Select Your Model"
        />

        {/* Prompt Input with Enhance or Custom option */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-white text-black">
              1
            </div>
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">
              Create Prompt
            </label>
          </div>

          {/* Toggle between AI Enhanced and Custom Prompt */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => {
               
                setUseCustomPrompt(false);
              }}
              className={`relative overflow-hidden flex-1 p-2.5 rounded-xl text-sm font-medium transition-colors duration-200 shadow-none ${
                !useCustomPrompt
                  ? "bg-white/10 text-white/95 border border-white/30 backdrop-blur-xl"
                  : "bg-white/[0.04] border border-white/15 text-slate-300 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/20 backdrop-blur-xl"
              }`}
              data-testid="button-use-ai-enhance"
            >
              {!useCustomPrompt && (
                <span className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
              )}
              {!useCustomPrompt && (
                <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
              )}
              AI Enhanced
            </button>
            <button
              onClick={() => {
               
                setUseCustomPrompt(true);
              }}
              className={`relative overflow-hidden flex-1 p-2.5 rounded-xl text-sm font-medium transition-colors duration-200 shadow-none ${
                useCustomPrompt
                  ? "bg-white/10 text-white/95 border border-white/30 backdrop-blur-xl"
                  : "bg-white/[0.04] border border-white/15 text-slate-300 hover:bg-white/[0.06] hover:text-white/80 hover:border-white/20 backdrop-blur-xl"
              }`}
              data-testid="button-use-custom"
            >
              {useCustomPrompt && (
                <span className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={PURPLE_CORNER_GLOW_STYLE} />
              )}
              {useCustomPrompt && (
                <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45 pointer-events-none" />
              )}
              Custom Prompt
            </button>
          </div>

          {!useCustomPrompt ? (
            // AI Enhancement Mode
            <div>
              <div className="mb-3">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Scene keyword (beach, bedroom, office...)"
                  className="w-full px-4 py-3 rounded-xl text-sm border focus:outline-none transition-colors"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.08)',
                  }}
                  data-testid="input-prompt-keyword"
                />
              </div>
              <button
                onClick={enhancePrompt}
                disabled={enhancing || !prompt.trim()}
                className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:cursor-not-allowed ${(enhancing || !prompt.trim()) ? 'bg-white/10 text-white/40' : 'bg-white text-black hover:bg-white/90'}`}
                data-testid="button-enhance-prompt"
              >
                {enhancing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Enhancing with AI…</>
                  : <><Zap className="w-4 h-4" /> {copy.talkingHeadEnhanceWithAi} · <span>10</span> <Coins className="w-3.5 h-3.5" /></>
                }
              </button>
            </div>
          ) : (
            // Custom Prompt Mode
            <div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Write your detailed prompt..."
                className="w-full px-4 py-3 rounded-xl text-sm border focus:outline-none resize-none transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
                rows={4}
                data-testid="input-custom-prompt"
              />
              <p className="text-xs text-gray-400 mt-2">
                Your custom prompt will be used as-is (no AI enhancement)
              </p>
            </div>
          )}
        </div>

        {!useCustomPrompt && (
          <div className="mb-6 glass-panel rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-white/80" />
              <span className="text-sm font-semibold text-white">
                Current Settings
              </span>
            </div>
            <div className="text-xs text-gray-400">
              {useNsfw ? (
                <p>
                  <span className="text-pink-400 font-medium">Sexy Mode</span> — Designed for sexy and sensual content. More freedom with revealing poses and outfits.
                </p>
              ) : (
                <p>
                  <span className="text-blue-400 font-medium">Casual Mode</span> — For casual IG style pics. Better quality but stricter limits on nudity.
                </p>
              )}
            </div>
          </div>
        )}

        {credits < (useNsfw ? 10 : 20) ? (
          <button
            onClick={() => setShowCreditsModal(true)}
            className="w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-white text-black hover:bg-white/90"
            data-testid="button-get-credits-prompt"
          >
            <CreditCard className="w-4 h-4" />
            Get Credits <span className="inline-flex items-center gap-0.5 text-red-500">({useNsfw ? 10 : 20} <Coins className="w-3.5 h-3.5" />)</span>
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !selectedModel || !prompt.trim() || isCooldown}
            className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-100 disabled:cursor-not-allowed ${(isGenerating || !selectedModel || !prompt.trim() || isCooldown) ? 'bg-white/10 text-white/40' : 'bg-white text-black hover:bg-white/90'}`}
            data-testid="button-generate-prompt"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 text-white" />
                Generate <span className="inline-flex items-center gap-0.5 text-yellow-400">{useNsfw ? 10 : 20} <Coins className="w-3.5 h-3.5" /></span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Credits Modal */}
      <AddCreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
    </>
  );
}
