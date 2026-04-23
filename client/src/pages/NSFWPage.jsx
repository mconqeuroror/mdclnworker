import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Flame,
  Sparkles,
  Check,
  ChevronDown,
  Loader2,
  RefreshCcw,
  Download,
  AlertTriangle,
  Lock,
  Unlock,
  Image as ImageIcon,
  Video,
  Wand2,
  Camera,
  User,
  Users,
  Zap,
  Coins,
  Eye,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Grid3X3,
  Settings,
  Info,
  Save,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Layers,
  FastForward,
  Play,
  ScanSearch,
  Edit3,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import {
  MagnifyingGlass,
  CaretUpDown,
  CheckCircle,
  Lightning,
  Sparkle,
  Warning,
  UserCircle,
  Trash,
  FloppyDisk,
  PencilSimple,
  ArrowsClockwise,
  StackSimple,
} from "@phosphor-icons/react";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { cn } from "../lib/utils";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api, { generationAPI, pricingAPI, uploadFile } from "../services/api";
import { downloadFromPublicUrl } from "../utils/directDownload";
import { useAuthStore } from "../store";
import { sound } from "../utils/sounds";
import { useCachedModels } from "../hooks/useCachedModels";
import { useDraft } from "../hooks/useDraft";
import AddCreditsModal from "../components/AddCreditsModal";
import { useGenerations } from "../hooks/useGenerations";
import { useNsfwGallery } from "../hooks/useNsfwGallery";
import AppSidebar from "../components/AppSidebar";
import LazyVideo from "../components/LazyVideo";
import CourseTipBanner from "../components/CourseTipBanner";
import NudesPackModal from "../components/NudesPackModal";
import TutorialInfoLink from "../components/TutorialInfoLink";
import { useTutorialCatalog } from "../hooks/useTutorialCatalog";
import {
  getNudesPackTotalCredits,
  NUDES_PACK_MAX_POSES,
  NUDES_PACK_CREDITS_MIN,
  NUDES_PACK_CREDITS_MAX,
  NUDES_PACK_POSES,
} from "@shared/nudesPackPoses.js";
import { selectorCategories, buildSelectionsString, buildSelectionsSummary, applyChipConstraints, getBlockedChips, SCENE_PRESETS } from "../data/nsfwSelectors";
import { NSFW_RESOLUTION_OPTIONS } from "../constants/nsfwResolutions";

const RED_CORNER_GLOW_STYLE = {
  background:
    "radial-gradient(ellipse 100% 100% at 0% 0%, rgba(244,63,94,0.24) 0%, rgba(244,63,94,0.08) 42%, transparent 68%)",
};
const PREVIEW_BADGE_STYLE = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.18)",
  color: "#E5E7EB",
};

const LOCALE_STORAGE_KEY = "app_locale";
const NSFW_SIDEBAR_PINNED_KEY = "nsfw_sidebar_pinned";
const NSFW_COPY = {
  en: {
    galleryEmptyModel: "No images in gallery for this model",
    galleryPaginationPrev: "Previous",
    galleryPaginationNext: "Next",
    galleryLoading: "Loading...",
    galleryEmpty: "No generations yet",
    previewClose: "Close preview",
    previewDownload: "Download",
    previewDownloadAll: "Download all",
    previewDownloadSingle: "Download",
    generationPromptLabel: "Prompt",
    generationNegativePromptLabel: "Negative prompt",
    generationBuiltPromptLabel: "Built prompt",
    badgeLoraName: "LoRA",
    badgeTriggerWord: "Trigger",
    badgeLoraStrength: "LoRA strength",
    badgeClipStrength: "CLIP strength",
    badgePose: "Pose",
    badgeMakeup: "Makeup",
    badgeCum: "Cum",
    badgeSeed: "Seed",
    badgeSteps: "Steps",
    badgeCfg: "CFG",
    badgeResolution: "Resolution",
    title: "NSFW Studio",
    subtitle: "Create adult content with your AI models",
    tabImages: "Images",
    tabVideos: "Videos",
    tabFaceswap: "Face Swap",
    tabLora: "LoRA Training",
    sectionSelectModel: "Select Model",
    sectionMode: "Mode",
    sectionPrompt: "Prompt",
    sectionNegativePrompt: "Negative Prompt",
    sectionResolution: "Resolution",
    sectionQuantity: "Quantity",
    modeQuality: "Quality",
    modeSpeed: "Speed",
    modeCustom: "Custom",
    promptPlaceholder: "Describe what you want to generate...",
    negativePromptPlaceholder: "What to avoid...",
    buttonGenerate: "Generate",
    buttonGenerating: "Generating...",
    toastSelectModel: "Please select a model",
    toastEnterPrompt: "Please enter a prompt",
    toastNotEnoughCredits: "Not enough credits",
    toastGenerationFailed: "Generation failed",
    toastGenerationStarted: "Generation started!",
    videoSectionSourceImage: "Source Image",
    videoSectionPrompt: "Motion Prompt",
    videoSectionDuration: "Duration",
    videoButtonGenerate: "Generate Video",
    videoButtonGenerating: "Generating...",
    videoToastSelectModel: "Please select a model",
    videoToastUploadSource: "Please upload a source image",
    videoToastEnterPrompt: "Please enter a motion prompt",
    videoToastNotEnoughCredits: "Not enough credits",
    videoToastFailed: "Failed to generate video",
    faceswapSectionTarget: "Target Image",
    faceswapSectionSource: "Source Face",
    faceswapButtonGenerate: "Swap Face",
    faceswapButtonGenerating: "Swapping...",
    faceswapToastMissingImages: "Please upload both target and source images",
    faceswapToastFailed: "Face swap failed",
    faceswapToastStarted: "Face swap started!",
    loraSectionTitle: "Train LoRA",
    loraSectionModelName: "Model Name",
    loraSectionImages: "Training Images",
    loraSectionTriggerWord: "Trigger Word",
    loraSectionSteps: "Steps",
    loraSectionCaptioning: "Auto Captioning",
    loraPlaceholderModelName: "Enter LoRA model name",
    loraPlaceholderTriggerWord: "e.g. mymodel",
    loraButtonTrain: "Start Training",
    loraButtonTraining: "Training...",
    loraToastMissingFields: "Please fill required fields",
    loraToastNeedImages: "Please upload training images",
    loraToastFailed: "LoRA training failed",
    loraToastStarted: "LoRA training started!",
    historyTitle: "Generation History",
    historyEmpty: "No history yet",
    historyLoading: "Loading...",
    historyRetry: "Retry",
    historyRefresh: "Refresh",
    filterAll: "All",
    filterImages: "Images",
    filterVideos: "Videos",
    filterFaceswap: "Face Swap",
    filterLora: "LoRA",
    buttonGetCredits: "Get Credits",
    labelCredits: "Credits",
    labelCost: "Cost",
    labelEstimatedTime: "Estimated time",
    needAccess: "Need Access?",
    phaseTrainModel: "Train Model",
    phaseCreateLora: "Create LoRA",
    phaseGenerate: "Generate",
    phaseNsfwReady: "NSFW Ready",
    phaseTrainFirst: "Train first",
    phaseVideo: "Video",
    phaseImageToVideo: "Image to Video",
    phaseImg2img: "Img2Img",
    phasePhotoSwap: "Photo swap",
    manageLoras: "Manage LoRAs",
    modelSelectorCount: "models",
    loadingModelsTitle: "Loading your models...",
    loadingModelsWait: "Please wait",
    loadModelsFailedTitle: "Couldn't load your models",
    loadModelsFailedBody: "This can happen if the connection dropped. Please try again.",
    loadModelsRetry: "Retry loading models",
    noVerifiedModelsTitle: "No Verified Models Available",
    noVerifiedModelsBody: "Create an AI model or verify a real person model to use NSFW features",
    noVerifiedModelsCta: "Learn about verification options ->",
    creditsPanelTitle: "Credit Costs",
    creditsPanelLoraTraining: "LoRA Training",
    creditsPanelNsfwImage: "NSFW Image",
    creditsPanelFaceSwap: "+ Face Swap",
    creditsPanelNsfwVideo: "NSFW Video",
    creditsPanelRetryFailed: "Retry Failed",
    yourVideos: "Your Videos",
    loraCreateAction: "Create LoRA",
    loraEmptyTitle: "No LoRAs yet",
    loraEmptyBody: "Create a new LoRA to start training",
    trainingStatusChecking: "Checking training status...",
    trainingHintCreateLora: "Click \"New LoRA\" above to start training",
    trainingHintAwaitingImages: "Or click an existing LoRA in \"Awaiting Images\" status to add images",
    faceSwapGalleryHint: "Generate images first, then select one for face swap",
    faceSwapSelectSource: "Select source image for face swap:",
    galleryGenerateFirstAbove: "Generate your first image above",
    videoAnimateHint: "Choose an NSFW image to animate",
    trainingInProgressTitle: "Training in Progress",
    trainingCompleteTitle: "LoRA Training Complete!",
    trainingCompleteBody: "Switch to Generate tab to create NSFW content",
    trainingFailedTitle: "Training Failed",
    trainingFailedBody: "Please try again or contact support",
    i2iSourcePhoto: "Source Photo",
    sourceGallery: "Gallery",
    sourceUpload: "Upload",
    i2iPickPhoto: "Click to pick a photo",
    i2iImageLoaded: "Image loaded",
    i2iGalleryLoading: "Loading gallery...",
    i2iNoGeneratedYet: "No generated images yet - generate some on the Generate tab first.",
    i2iSelectedFromGallery: "Selected from gallery",
    i2iAnalyzePhoto: "Analyze Photo",
    i2iReanalyze: "Re-analyze",
    i2iAnalyzing: "Analyzing...",
    i2iEditPrompt: "Edit Prompt",
    i2iModifyHint: "modify before generation",
    i2iInjectedPromptPlaceholder: "Injected prompt will appear here...",
    i2iEditFreelyHint: "Edit freely - trigger word, pose, scene, attire, anatomy.",
    i2iProcessingQueue: "Processing Queue",
    i2iView: "View",
    i2iResult: "Result",
    i2iProcessing: "Processing...",
    loraLoading: "Loading LoRAs...",
    loraListTitle: "Your LoRAs",
    loraNew: "New LoRA",
    loraNamePlaceholder: "LoRA name (e.g., v2-lingerie)",
    loraTrainingMode: "Training Mode",
    loraStandard: "Standard",
    loraTime1h: "~1h to finish",
    loraTime2h: "~2h to finish",
    loraDefaultAppearance: "Default Appearance",
    loraAppearanceHint: "Pre-filled from model looks. Edit or add Custom per category.",
    custom: "Custom",
    customTypePlaceholder: "Type custom...",
    loraStatusActive: "Active",
    loraStatusSettingUp: "Setting Up",
    loraLegacyHint: "Old model - please train a new one",
    loraTrainedOn: "Trained",
    loraSetActive: "Set Active",
    loraEditLook: "Edit Look",
    loraSetLook: "Set Look",
    loraDetecting: "Detecting...",
    loraAutoDetect: "Auto-detect",
    loraAppearanceSaved: "LoRA appearance saved",
    loraSaveFailedPrefix: "Failed to save:",
    loraDetectCouldNot: "Could not detect appearance",
    loraDetectFailedPrefix: "Auto-detect failed:",
    trainingNeedNewLora: "Please create a New LoRA first before training.",
    trainingRetry: "Retry Training",
    trainingProModeTitle: "Pro Training Mode - 30 Curated Images",
    trainingProDurationHint: "Pro LoRA training takes about 2 hours to finish.",
    trainingBasicDurationHint: "Basic LoRA training takes about 1 hour to finish.",
    toastNoActiveLoraTrigger: "No active LoRA with a trigger word found.",
    toastImageAnalysisTimedOut: "Image analysis timed out",
    toastAnalysisFailedPrefix: "Analysis failed:",
    toastActiveLoraNoFile: "Active LoRA has no file URL.",
    toastGenerationQueued: "Generation queued - you can generate again while it processes.",
    toastSubmitFailedPrefix: "Submit failed:",
    toastSelectOrCreateLora: "Select or create a LoRA first",
    toastMaxImagesSelected: "Maximum images already selected",
    toastEnterLoraName: "Enter a name for your LoRA",
    toastAppearanceSaved: "Appearance saved",
    toastFailedSaveAppearance: "Failed to save appearance",
    toastSettingsSaved: "Settings saved!",
    toastFailedSaveSettings: "Failed to save settings",
    toastSettingsReset: "Settings reset to defaults",
    toastActiveLoraUpdated: "Active LoRA updated!",
    toastLoraDeleted: "LoRA deleted",
    toastImagesAssignedTraining: "Images assigned! Starting LoRA training...",
    toastNoLoraSelectedTraining: "No LoRA selected for training",
    toastDescribeSceneFirst: "Describe what you want or pick a preset first",
    toastSceneReady: "Scene ready - choose resolution and generate",
    toastPromptGenerated: "Prompt generated!",
    toastTypeSceneFirst: "Type a scene description first",
    toastCompleteLoraTrainingFirst: "Please complete LoRA training first",
    toastSelectModelAndPose: "Select a model and at least one pose",
    labelGenerate: "Generate",
    labelFree: "FREE",
    labelLoraStrength: "LoRA Strength",
    labelDenoise: "Denoise",
    labelTrainingImages: "Training Images",
    labelQuantity: "Quantity:",
  },
  ru: {
    galleryEmptyModel: "Нет изображений в галерее для этой модели",
    galleryPaginationPrev: "Назад",
    galleryPaginationNext: "Вперёд",
    galleryLoading: "Загрузка...",
    galleryEmpty: "Генераций пока нет",
    previewClose: "Закрыть просмотр",
    previewDownload: "Скачать",
    previewDownloadAll: "Скачать все",
    previewDownloadSingle: "Скачать",
    generationPromptLabel: "Промпт",
    generationNegativePromptLabel: "Негативный промпт",
    generationBuiltPromptLabel: "Собранный промпт",
    badgeLoraName: "LoRA",
    badgeTriggerWord: "Триггер",
    badgeLoraStrength: "Сила LoRA",
    badgeClipStrength: "Сила CLIP",
    badgePose: "Поза",
    badgeMakeup: "Макияж",
    badgeCum: "Сперма",
    badgeSeed: "Сид",
    badgeSteps: "Шаги",
    badgeCfg: "CFG",
    badgeResolution: "Разрешение",
    title: "NSFW-студия",
    subtitle: "Создавайте контент для взрослых с вашими ИИ-моделями",
    tabImages: "Изображения",
    tabVideos: "Видео",
    tabFaceswap: "Замена лица",
    tabLora: "Обучение LoRA",
    sectionSelectModel: "Выбор модели",
    sectionMode: "Режим",
    sectionPrompt: "Промпт",
    sectionNegativePrompt: "Негативный промпт",
    sectionResolution: "Разрешение",
    sectionQuantity: "Количество",
    modeQuality: "Качество",
    modeSpeed: "Скорость",
    modeCustom: "Пользовательский",
    promptPlaceholder: "Опишите, что хотите создать...",
    negativePromptPlaceholder: "Что исключить...",
    buttonGenerate: "Создать",
    buttonGenerating: "Генерация...",
    toastSelectModel: "Пожалуйста, выберите модель",
    toastEnterPrompt: "Пожалуйста, введите промпт",
    toastNotEnoughCredits: "Недостаточно кредитов",
    toastGenerationFailed: "Ошибка генерации",
    toastGenerationStarted: "Генерация запущена!",
    videoSectionSourceImage: "Исходное изображение",
    videoSectionPrompt: "Промпт движения",
    videoSectionDuration: "Длительность",
    videoButtonGenerate: "Создать видео",
    videoButtonGenerating: "Генерация...",
    videoToastSelectModel: "Пожалуйста, выберите модель",
    videoToastUploadSource: "Пожалуйста, загрузите исходное изображение",
    videoToastEnterPrompt: "Пожалуйста, введите промпт движения",
    videoToastNotEnoughCredits: "Недостаточно кредитов",
    videoToastFailed: "Не удалось создать видео",
    faceswapSectionTarget: "Целевое изображение",
    faceswapSectionSource: "Исходное лицо",
    faceswapButtonGenerate: "Заменить лицо",
    faceswapButtonGenerating: "Замена...",
    faceswapToastMissingImages: "Пожалуйста, загрузите целевое и исходное изображения",
    faceswapToastFailed: "Ошибка замены лица",
    faceswapToastStarted: "Замена лица запущена!",
    loraSectionTitle: "Обучить LoRA",
    loraSectionModelName: "Название модели",
    loraSectionImages: "Обучающие изображения",
    loraSectionTriggerWord: "Триггерное слово",
    loraSectionSteps: "Шаги",
    loraSectionCaptioning: "Автоматические подписи",
    loraPlaceholderModelName: "Введите название LoRA-модели",
    loraPlaceholderTriggerWord: "например, mymodel",
    loraButtonTrain: "Начать обучение",
    loraButtonTraining: "Обучение...",
    loraToastMissingFields: "Пожалуйста, заполните обязательные поля",
    loraToastNeedImages: "Пожалуйста, загрузите обучающие изображения",
    loraToastFailed: "Ошибка обучения LoRA",
    loraToastStarted: "Обучение LoRA запущено!",
    historyTitle: "История генераций",
    historyEmpty: "История пока пуста",
    historyLoading: "Загрузка...",
    historyRetry: "Повторить",
    historyRefresh: "Обновить",
    filterAll: "Все",
    filterImages: "Изображения",
    filterVideos: "Видео",
    filterFaceswap: "Замена лица",
    filterLora: "LoRA",
    buttonGetCredits: "Получить кредиты",
    labelCredits: "Кредиты",
    labelCost: "Стоимость",
    labelEstimatedTime: "Примерное время",
    needAccess: "Нужен доступ?",
    phaseTrainModel: "Обучение модели",
    phaseCreateLora: "Создать LoRA",
    phaseGenerate: "Генерация",
    phaseNsfwReady: "NSFW готово",
    phaseTrainFirst: "Сначала обучите",
    phaseVideo: "Видео",
    phaseImageToVideo: "Изображение в видео",
    phaseImg2img: "Img2Img",
    phasePhotoSwap: "Замена по фото",
    manageLoras: "Управление LoRA",
    modelSelectorCount: "моделей",
    loadingModelsTitle: "Загружаем ваши модели...",
    loadingModelsWait: "Пожалуйста, подождите",
    loadModelsFailedTitle: "Не удалось загрузить ваши модели",
    loadModelsFailedBody: "Такое бывает при обрыве соединения. Попробуйте снова.",
    loadModelsRetry: "Повторить загрузку моделей",
    noVerifiedModelsTitle: "Нет верифицированных моделей",
    noVerifiedModelsBody: "Создайте ИИ-модель или верифицируйте реальную модель, чтобы использовать NSFW-функции",
    noVerifiedModelsCta: "Подробнее о вариантах верификации ->",
    creditsPanelTitle: "Стоимость в кредитах",
    creditsPanelLoraTraining: "Обучение LoRA",
    creditsPanelNsfwImage: "NSFW изображение",
    creditsPanelFaceSwap: "+ Замена лица",
    creditsPanelNsfwVideo: "NSFW видео",
    creditsPanelRetryFailed: "Повтор ошибки",
    yourVideos: "Ваши видео",
    loraCreateAction: "Создать LoRA",
    loraEmptyTitle: "Пока нет LoRA",
    loraEmptyBody: "Создайте новую LoRA, чтобы начать обучение",
    trainingStatusChecking: "Проверяем статус обучения...",
    trainingHintCreateLora: "Нажмите \"New LoRA\" выше, чтобы начать обучение",
    trainingHintAwaitingImages: "Или выберите существующую LoRA в статусе \"Awaiting Images\", чтобы добавить изображения",
    faceSwapGalleryHint: "Сначала сгенерируйте изображения, затем выберите одно для замены лица",
    faceSwapSelectSource: "Выберите исходное изображение для замены лица:",
    galleryGenerateFirstAbove: "Сначала сгенерируйте первое изображение выше",
    videoAnimateHint: "Выберите NSFW-изображение для анимации",
    trainingInProgressTitle: "Обучение в процессе",
    trainingCompleteTitle: "Обучение LoRA завершено!",
    trainingCompleteBody: "Переключитесь на вкладку генерации, чтобы создавать NSFW-контент",
    trainingFailedTitle: "Обучение не удалось",
    trainingFailedBody: "Пожалуйста, попробуйте снова или обратитесь в поддержку",
    i2iSourcePhoto: "Исходное фото",
    sourceGallery: "Галерея",
    sourceUpload: "Загрузить",
    i2iPickPhoto: "Нажмите, чтобы выбрать фото",
    i2iImageLoaded: "Изображение загружено",
    i2iGalleryLoading: "Загрузка галереи...",
    i2iNoGeneratedYet: "Пока нет сгенерированных изображений - сначала создайте их во вкладке генерации.",
    i2iSelectedFromGallery: "Выбрано из галереи",
    i2iAnalyzePhoto: "Анализ фото",
    i2iReanalyze: "Повторный анализ",
    i2iAnalyzing: "Анализ...",
    i2iEditPrompt: "Редактировать промпт",
    i2iModifyHint: "измените перед генерацией",
    i2iInjectedPromptPlaceholder: "Здесь появится встроенный промпт...",
    i2iEditFreelyHint: "Редактируйте свободно - триггер, поза, сцена, одежда, анатомия.",
    i2iProcessingQueue: "Очередь обработки",
    i2iView: "Открыть",
    i2iResult: "Результат",
    i2iProcessing: "Обработка...",
    loraLoading: "Загрузка LoRA...",
    loraListTitle: "Ваши LoRA",
    loraNew: "Новая LoRA",
    loraNamePlaceholder: "Название LoRA (напр., v2-lingerie)",
    loraTrainingMode: "Режим обучения",
    loraStandard: "Стандарт",
    loraTime1h: "~1ч до готовности",
    loraTime2h: "~2ч до готовности",
    loraDefaultAppearance: "Базовая внешность",
    loraAppearanceHint: "Предзаполнено из внешности модели. Измените или добавьте \"Другое\" по категориям.",
    custom: "Другое",
    customTypePlaceholder: "Введите свой вариант...",
    loraStatusActive: "Активна",
    loraStatusSettingUp: "Настройка",
    loraLegacyHint: "Старая модель - пожалуйста, обучите новую",
    loraTrainedOn: "Обучена",
    loraSetActive: "Сделать активной",
    loraEditLook: "Изменить внешность",
    loraSetLook: "Задать внешность",
    loraDetecting: "Определение...",
    loraAutoDetect: "Автоопределение",
    loraAppearanceSaved: "Внешность LoRA сохранена",
    loraSaveFailedPrefix: "Не удалось сохранить:",
    loraDetectCouldNot: "Не удалось определить внешность",
    loraDetectFailedPrefix: "Ошибка автоопределения:",
    trainingNeedNewLora: "Пожалуйста, сначала создайте новую LoRA перед обучением.",
    trainingRetry: "Повторить обучение",
    trainingProModeTitle: "Режим Pro - 30 отобранных изображений",
    trainingProDurationHint: "Обучение Pro LoRA занимает около 2 часов.",
    trainingBasicDurationHint: "Обучение базовой LoRA занимает около 1 часа.",
    toastNoActiveLoraTrigger: "Не найдена активная LoRA с триггерным словом.",
    toastImageAnalysisTimedOut: "Время анализа изображения истекло",
    toastAnalysisFailedPrefix: "Ошибка анализа:",
    toastActiveLoraNoFile: "У активной LoRA нет URL файла.",
    toastGenerationQueued: "Генерация поставлена в очередь - можно запускать следующую.",
    toastSubmitFailedPrefix: "Ошибка отправки:",
    toastSelectOrCreateLora: "Выберите или создайте LoRA",
    toastMaxImagesSelected: "Достигнут максимум выбранных изображений",
    toastEnterLoraName: "Введите название LoRA",
    toastAppearanceSaved: "Внешность сохранена",
    toastFailedSaveAppearance: "Не удалось сохранить внешность",
    toastSettingsSaved: "Настройки сохранены!",
    toastFailedSaveSettings: "Не удалось сохранить настройки",
    toastSettingsReset: "Настройки сброшены к значениям по умолчанию",
    toastActiveLoraUpdated: "Активная LoRA обновлена!",
    toastLoraDeleted: "LoRA удалена",
    toastImagesAssignedTraining: "Изображения назначены! Запускаем обучение LoRA...",
    toastNoLoraSelectedTraining: "Для обучения не выбрана LoRA",
    toastDescribeSceneFirst: "Опишите сцену или выберите пресет",
    toastSceneReady: "Сцена готова - выберите разрешение и запустите генерацию",
    toastPromptGenerated: "Промпт сгенерирован!",
    toastTypeSceneFirst: "Сначала опишите сцену",
    toastCompleteLoraTrainingFirst: "Сначала завершите обучение LoRA",
    toastSelectModelAndPose: "Выберите модель и хотя бы одну позу",
    labelGenerate: "Создать",
    labelFree: "БЕСПЛАТНО",
    labelLoraStrength: "Сила LoRA",
    labelDenoise: "Шумоподавление",
    labelTrainingImages: "Обучающие изображения",
    labelQuantity: "Количество:",
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

// Fallback to prevent runtime crashes if any nested scope
// references `copy` without a local declaration.
const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;

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


// ============================================
// Gallery Picker for NSFW Face Swap
// SECURITY: Only shows images generated for the selected model
// ============================================
function NsfwFaceSwapGalleryPicker({ modelId, selectedImage, onSelect }) {
  const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;
  const { all: allGenerations } = useGenerations("all");
  
  const modelImages = allGenerations.filter(g => 
    g.modelId === modelId && 
    g.status === 'completed' && 
    g.outputUrl &&
    ['prompt-image', 'image', 'image-identity', 'face-swap-image', 'nsfw'].includes(g.type)
  );

  if (modelImages.length === 0) {
    return (
      <div className="mt-3 p-4 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)' }}>
        <ImageIcon className="w-6 h-6 text-slate-600 mx-auto mb-2" />
        <p className="text-xs text-slate-500">{copy.galleryEmptyModel}</p>
        <p className="text-[10px] text-slate-600 mt-1">{copy.faceSwapGalleryHint}</p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-[10px] text-slate-500 mb-2">{copy.faceSwapSelectSource}</p>
      <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
        {modelImages.slice(0, 18).map((gen) => (
          <button
            key={gen.id}
            onClick={() => {
             
              onSelect(selectedImage?.id === gen.id ? null : { id: gen.id, url: gen.outputUrl });
            }}
            className="relative rounded-lg overflow-hidden transition-all aspect-square hover:scale-105"
            style={{
              border: selectedImage?.id === gen.id ? '2px solid rgba(34,211,238,0.8)' : '1px solid rgba(255,255,255,0.1)',
              boxShadow: selectedImage?.id === gen.id ? '0 0 10px rgba(34,211,238,0.3)' : 'none',
            }}
            data-testid={`nsfw-faceswap-image-${gen.id}`}
          >
            <img src={gen.outputUrl} alt="Gallery" className="w-full h-full object-cover" />
            {selectedImage?.id === gen.id && (
              <div className="absolute inset-0 bg-cyan-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>
      {selectedImage && (
        <p className="text-[10px] text-cyan-400 mt-2 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          Face swap source selected
        </p>
      )}
      {!selectedImage && (
        <p className="text-[10px] text-amber-400 mt-2">
          No image selected - will use auto-generated face reference
        </p>
      )}
    </div>
  );
}

// ============================================
// NSFW Gallery - Full image gallery with grid, preview, download, pagination
// ============================================
function NsfwGallery({ modelId }) {
  const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;
  const [page, setPage] = useState(1);
  const pageSize = 24;
  const { data, isLoading, processingCount } = useNsfwGallery(modelId, page, pageSize);
  const [previewGen, setPreviewGen] = useState(null);
  const viewportBounds = useMainViewportBounds();

  const generations = data?.generations || [];
  const total = data?.pagination?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const completedGens = generations.filter(g => g.outputUrl);

  const parseUrls = (outputUrl) => {
    if (!outputUrl) return [];
    try {
      const parsed = JSON.parse(outputUrl);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [outputUrl];
  };

  const handleDownload = async (url, genId, index = 0) => {
    const lowerUrl = url.toLowerCase();
    const ext = lowerUrl.includes(".mp4") ? "mp4" : lowerUrl.includes(".webm") ? "webm" : "jpg";
    const filename = `nsfw-${genId ? genId.substring(0, 8) : "image"}-${index + 1}.${ext}`;
    await downloadFromPublicUrl(url, filename);
  };

  return (
    <div
      className="rounded-2xl p-4 sm:p-5"
      style={{
        background: "linear-gradient(180deg, rgba(15,15,23,0.9) 0%, rgba(10,10,18,0.95) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-white" />
          <h3 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">
            Gallery
          </h3>
          {total > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-medium"
              style={{ background: "rgba(255,255,255,0.9)", color: "#111827" }}
            >
              {total} total
            </span>
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg text-slate-400 disabled:opacity-30 transition-colors"
              style={{ background: "rgba(255,255,255,0.05)" }}
              data-testid="button-gallery-prev"
              aria-label={copy.galleryPaginationPrev}
              title={copy.galleryPaginationPrev}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-slate-500">
              {page}/{totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg text-slate-400 disabled:opacity-30 transition-colors"
              style={{ background: "rgba(255,255,255,0.05)" }}
              data-testid="button-gallery-next"
              aria-label={copy.galleryPaginationNext}
              title={copy.galleryPaginationNext}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Processing indicator */}
      {processingCount > 0 && (
        <div
          className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}
        >
          <Loader2 className="w-4 h-4 animate-spin text-red-400" />
          <span className="text-[11px] text-red-300">
            {processingCount} image{processingCount > 1 ? "s" : ""} generating...
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-white" />
        </div>
      ) : completedGens.length === 0 && processingCount === 0 ? (
        <div className="text-center py-10">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <ImageIcon className="w-6 h-6 text-slate-600" />
          </div>
          <p className="text-[12px] text-slate-500">{copy.galleryEmpty}</p>
          <p className="text-[10px] text-slate-600 mt-1">{copy.galleryGenerateFirstAbove}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          {completedGens.map((gen) => {
            const urls = parseUrls(gen.outputUrl);
            const thumbnailUrl = urls[0];
            return (
              <div
                key={gen.id}
                className="relative aspect-[3/4] rounded-xl overflow-hidden cursor-pointer group"
                style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                onClick={() => setPreviewGen(gen)}
                data-testid={`gallery-image-${gen.id}`}
              >
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between">
                  <span className="text-[9px] text-white/70">
                    {new Date(gen.createdAt).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1">
                    {urls.length > 1 && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[8px] font-bold"
                        style={{ background: "rgba(139,92,246,0.9)", color: "#fff" }}
                      >
                        {urls.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(thumbnailUrl, gen.id, 0);
                      }}
                      className="p-1 rounded-md"
                      style={{ background: "rgba(0,0,0,0.5)" }}
                      data-testid={`button-download-${gen.id}`}
                    >
                      <Download className="w-3 h-3 text-white" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal - Responsive, fits screen */}
      {previewGen && createPortal(
        <div
          className="fixed inset-y-0 right-0 bg-black/95 backdrop-blur-sm z-[9999] flex items-center justify-center"
          style={{ left: viewportBounds.left, width: viewportBounds.width ? `${viewportBounds.width}px` : undefined }}
          onClick={() => setPreviewGen(null)}
        >
          <div
            className="relative flex flex-col w-full max-w-[86vw] sm:max-w-[72vw] md:max-w-[56vw] lg:max-w-[42vw] max-h-[84vh] rounded-2xl overflow-hidden"
            style={{ background: "linear-gradient(180deg, rgba(17,17,26,0.97) 0%, rgba(10,10,18,0.98) 100%)", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 12px 42px rgba(0,0,0,0.45)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewGen(null)}
              className="absolute top-3 right-3 z-10 p-2 rounded-full transition-all"
              style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.2)" }}
              data-testid="button-close-preview"
              aria-label={copy.previewClose}
              title={copy.previewClose}
            >
              <X className="w-5 h-5 text-white" />
            </button>

            <div className="flex-1 min-h-0 overflow-auto">
              {(() => {
                const urls = parseUrls(previewGen.outputUrl);
                if (urls.length === 1) {
                  return (
                    <div className="flex items-center justify-center p-2 sm:p-3">
                      <img
                        src={urls[0]}
                        alt=""
                        className="max-w-full max-h-[70vh] object-contain rounded-lg"
                      />
                    </div>
                  );
                }
                return (
                  <div className="p-3 sm:p-4">
                    <div className={`grid gap-2.5 ${urls.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
                      {urls.map((url, idx) => (
                        <div key={idx} className="relative group/img">
                          <img
                            src={url}
                            alt=""
                            className="w-full h-auto rounded-lg object-cover aspect-[3/4] cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(url, previewGen.id, idx); }}
                            className="absolute bottom-2 right-2 p-2 rounded-lg opacity-0 group-hover/img:opacity-100 transition-opacity bg-white border border-white/20"
                          >
                            <Download className="w-4 h-4 text-black" />
                          </button>
                          <div
                            className="absolute top-2 left-2 px-2 py-1 rounded-md text-[10px] font-medium"
                            style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                          >
                            {idx + 1}/{urls.length}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div
              className="flex-shrink-0 px-3 py-2.5 sm:px-4 sm:py-3"
              style={{ background: "rgba(0,0,0,0.3)", borderTop: "1px solid rgba(255,255,255,0.2)" }}
            >
              {(() => {
                let loraInfo = null;
                try {
                  if (previewGen.inputImageUrl) {
                    loraInfo = JSON.parse(previewGen.inputImageUrl);
                  }
                } catch {}
                return (
                  <>
                    {previewGen.prompt && (
                      <div className="mb-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{copy.generationPromptLabel}</p>
                        <p className="text-[11px] text-slate-300 leading-relaxed" data-testid="text-preview-prompt">
                          {previewGen.prompt}
                        </p>
                      </div>
                    )}
                    {loraInfo && (
                      <>
                        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="generation-payload-badges">
                          {(loraInfo.loraName || loraInfo.triggerWord) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-lora-name">
                              <Layers className="w-3 h-3" />
                              {copy.badgeLoraName}:
                              {loraInfo.loraName || loraInfo.triggerWord}
                            </span>
                          )}
                          {loraInfo.triggerWord && loraInfo.loraName && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-trigger-word">
                              {copy.badgeTriggerWord}: {loraInfo.triggerWord}
                            </span>
                          )}
                          {(loraInfo.girlLoraStrength != null || loraInfo.loraStrength != null) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-lora-strength">
                              <Zap className="w-3 h-3" />
                              {copy.badgeLoraStrength} {loraInfo.girlLoraStrength ?? loraInfo.loraStrength}
                            </span>
                          )}
                          {loraInfo.clipStrength != null && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-clip-strength">
                              {copy.badgeClipStrength} {loraInfo.clipStrength}
                            </span>
                          )}
                          {loraInfo.activePose && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-pose">
                              {copy.badgePose}: {loraInfo.activePose.replace(/_/g, " ")} @ {loraInfo.activePoseStrength}
                            </span>
                          )}
                          {loraInfo.runningMakeup && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-makeup">
                              {copy.badgeMakeup} @ {loraInfo.runningMakeupStrength}
                            </span>
                          )}
                          {loraInfo.cumEffect && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-cum">
                              {copy.badgeCum}
                            </span>
                          )}
                          {loraInfo.seed != null && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-seed">
                              {copy.badgeSeed} {loraInfo.seed}
                            </span>
                          )}
                          {loraInfo.steps != null && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-steps">
                              {loraInfo.steps} {copy.badgeSteps}
                            </span>
                          )}
                          {loraInfo.cfg != null && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-cfg">
                              CFG {loraInfo.cfg}
                            </span>
                          )}
                          {loraInfo.width && loraInfo.height && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium" style={PREVIEW_BADGE_STYLE} data-testid="badge-resolution">
                              {copy.badgeResolution} {loraInfo.width}x{loraInfo.height}
                            </span>
                          )}
                        </div>
                        {loraInfo.negativePrompt && (
                          <details className="mb-2">
                            <summary className="text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none">
                              {copy.generationNegativePromptLabel}
                            </summary>
                            <p className="text-[10px] text-slate-400 leading-relaxed mt-1" data-testid="text-negative-prompt">
                              {loraInfo.negativePrompt}
                            </p>
                          </details>
                        )}
                        {loraInfo.builtPrompt && (
                          <details className="mb-2">
                            <summary className="text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none">
                              {copy.generationBuiltPromptLabel}
                            </summary>
                            <p className="text-[10px] text-slate-400 leading-relaxed mt-1" data-testid="text-built-prompt">
                              {loraInfo.builtPrompt}
                            </p>
                          </details>
                        )}
                      </>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] text-slate-500">
                        {new Date(previewGen.createdAt).toLocaleString()}
                      </p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {parseUrls(previewGen.outputUrl).length > 1 && (
                          <button
                            onClick={() => {
                              parseUrls(previewGen.outputUrl).forEach((url, i) => {
                                setTimeout(() => handleDownload(url, previewGen.id, i), i * 500);
                              });
                            }}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 text-white"
                            style={{ background: "rgba(255,255,255,0.1)" }}
                            data-testid="button-download-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {copy.previewDownloadAll}
                          </button>
                        )}
                        <button
                          onClick={() => handleDownload(parseUrls(previewGen.outputUrl)[0], previewGen.id, 0)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 text-black bg-white border border-white/20"
                          data-testid="button-download-single"
                        >
                          <Download className="w-3.5 h-3.5 text-black" />
                          {copy.previewDownloadSingle}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * RunPod / API sometimes return `error` as `{ code, message }`. Passing that into JSX crashes React (#31).
 */
function formatImg2imgUserMessage(value, fallback = "") {
  if (value == null || value === "") return fallback || "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (value.message != null && String(value.message).trim()) return String(value.message);
    if (typeof value.error === "string" && value.error.trim()) return value.error;
    const code = value.code;
    if (code != null && code !== "") {
      const m = value.message != null ? String(value.message) : "";
      return m ? `${code}: ${m}` : String(code);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback || "Something went wrong";
    }
  }
  return String(value);
}

// ============================================
// NSFW Img2Img Tab — Photo-to-Photo with LoRA
// ============================================
function NsfwImg2ImgTab({ modelId, activeLoraObj, chipSelections = {}, nsfwImageCost = 30 }) {
  const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;
  const { refreshUserCredits } = useAuthStore();
  const { draft: i2iDraft, isLoading: i2iDraftLoading, saveDraft: saveI2iDraft, clearDraft: clearI2iDraft } = useDraft("nsfw-img2img");
  const i2iDraftRestoredRef = useRef(false);
  const i2iInitialLoadDoneRef = useRef(false);

  // Source image selection — "gallery" or "upload"
  const [sourceMode, setSourceMode] = useState("gallery");
  const [galleryPage, setGalleryPage] = useState(1);
  const [sourceImageUrl, setSourceImageUrl] = useState(null);
  // uploadedUrl is the public URL returned by Vercel Blob (direct browser → Blob, bypasses the
  // Vercel function 4.5 MB body limit that used to 413 when the image was sent as base64 JSON).
  const [uploadedUrl, setUploadedUrl] = useState(null);
  const [uploadedPreview, setUploadedPreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // Describe step
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [rawDescription, setRawDescription] = useState("");
  const [editablePrompt, setEditablePrompt] = useState("");

  // Generate step
  const [loraStrength, setLoraStrength] = useState(0.80);
  const [denoise, setDenoise] = useState(0.6);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [outputUrl, setOutputUrl] = useState(null);
  const [genError, setGenError] = useState(null);
  const [bgJobs, setBgJobs] = useState([]); // [{jobId, status, outputUrl, error, prompt}]
  const pollRef = useRef(null);
  const bgPollRefs = useRef({});

  useEffect(() => {
    if (i2iDraftLoading || i2iDraftRestoredRef.current) {
      if (!i2iDraftLoading) {
        i2iDraftRestoredRef.current = true;
        setTimeout(() => { i2iInitialLoadDoneRef.current = true; }, 0);
      }
      return;
    }
    i2iDraftRestoredRef.current = true;
    if (!i2iDraft?.data) {
      setTimeout(() => { i2iInitialLoadDoneRef.current = true; }, 0);
      return;
    }
    const d = i2iDraft.data;
    if (d.sourceMode) setSourceMode(d.sourceMode);
    if (d.sourceImageUrl) setSourceImageUrl(d.sourceImageUrl);
    if (d.rawDescription) setRawDescription(d.rawDescription);
    if (d.editablePrompt) setEditablePrompt(d.editablePrompt);
    if (d.loraStrength !== undefined) setLoraStrength(Math.max(0.65, d.loraStrength));
    if (d.denoise !== undefined) setDenoise(d.denoise);
    if (d.outputUrl) setOutputUrl(d.outputUrl);
    setTimeout(() => { i2iInitialLoadDoneRef.current = true; }, 0);
  }, [i2iDraftLoading, i2iDraft]);

  useEffect(() => {
    if (!i2iInitialLoadDoneRef.current) return;
    const data = {
      sourceMode,
      sourceImageUrl,
      rawDescription,
      editablePrompt,
      loraStrength,
      denoise,
      outputUrl,
    };
    const imageUrls = [sourceImageUrl, outputUrl].filter(Boolean);
    saveI2iDraft(data, imageUrls);
  }, [sourceMode, sourceImageUrl, rawDescription, editablePrompt, loraStrength, denoise, outputUrl]);

  const pageSize = 12;
  const { data: imageData, isLoading: imagesLoading } = useQuery({
    queryKey: ["nsfw-i2i-source-images", modelId, galleryPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        type: "nsfw",
        status: "completed",
        limit: String(pageSize),
        offset: String((galleryPage - 1) * pageSize),
      });
      if (modelId) params.set("modelId", modelId);
      const response = await api.get(`/generations?${params}`);
      return {
        generations: response.data.generations || [],
        pagination: response.data.pagination || { total: 0 },
      };
    },
    enabled: !!modelId,
    staleTime: 15000,
  });

  const sourceImages = imageData?.generations || [];
  const totalImages = imageData?.pagination?.total || 0;
  const totalPages = Math.ceil(totalImages / pageSize);

  // Whether we have a source ready — in upload mode we need the Blob URL, not just the preview.
  const hasSource = sourceMode === "gallery" ? !!sourceImageUrl : !!uploadedUrl;
  // Preview URL for the source image
  const sourcePreviewUrl = sourceMode === "gallery" ? sourceImageUrl : uploadedPreview;

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset analysis when new file is chosen
    setRawDescription("");
    setEditablePrompt("");
    setAnalyzeError(null);
    setOutputUrl(null);
    setGenError(null);
    setUploadError(null);
    setUploadedUrl(null);
    // Instant local preview
    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
    setUploadedPreview(URL.createObjectURL(file));
    // Direct browser → Vercel Blob. Avoids the 4.5 MB Vercel function body limit
    // we'd hit if we base64-encoded the file and sent it via JSON.
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const url = await uploadFile(file, (p) => setUploadProgress(p));
      setUploadedUrl(url);
    } catch (err) {
      console.error("[nsfw img2img] upload failed:", err);
      const msg = err?.message || "Upload failed";
      setUploadError(msg);
      toast.error(msg);
      if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
      setUploadedPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!hasSource) return;
    if (!activeLoraObj?.triggerWord && !activeLoraObj?.loraTriggerWord) {
      toast.error(copy.toastNoActiveLoraTrigger);
      return;
    }
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setRawDescription("");
    setEditablePrompt("");
    setOutputUrl(null);
    setGenError(null);
    setJobId(null);
    setJobStatus(null);
    try {
      const triggerWord = activeLoraObj.loraTriggerWord || activeLoraObj.triggerWord;
      const loraAppearance = (() => {
        const raw = activeLoraObj.defaultAppearance;
        if (!raw) return {};
        if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
        return raw;
      })();
      const appearanceKeys = [
        "ethnicity", "hairColor", "hairType", "skinTone", "eyeColor", "eyeShape",
        "faceShape", "noseShape", "lipSize", "bodyType", "height",
        "breastSize", "buttSize", "waist", "hips", "tattoos",
      ];
      const merged = {};
      for (const k of appearanceKeys) {
        merged[k] = loraAppearance[k] || chipSelections[k] || "";
      }
      const labelMap = {
        ethnicity: "ethnicity", hairColor: "hair color", hairType: "hair style",
        skinTone: "skin tone", eyeColor: "eye color", eyeShape: "eye shape",
        faceShape: "face shape", noseShape: "nose", lipSize: "lips",
        bodyType: "body type", height: "height", breastSize: "breast size",
        buttSize: "butt", waist: "waist", hips: "hips", tattoos: "tattoos/piercings",
      };
      const labeledParts = appearanceKeys
        .filter(k => merged[k])
        .map(k => `${labelMap[k]}: ${merged[k]}`)
        .join(", ");

      const payload = {
        triggerWord,
        lookDescription: labeledParts,
        inputImageUrl: sourceMode === "upload" ? uploadedUrl : sourceImageUrl,
      };
      const response = await api.post("/img2img/describe", payload);
      const data = response.data;

      // Async path — server submitted RunPod job and returned a describeJobId
      if (data.describeJobId) {
        const describeJobId = data.describeJobId;
        const maxPolls = 100; // 100 × 3s = 5 min (analysis queue can be slow)
        let attempts = 0;
        // isAnalyzing stays true; poll loop clears it when done
        const pollDescribe = async () => {
          attempts++;
          if (attempts > maxPolls) {
            setIsAnalyzing(false);
            setAnalyzeError("Analysis timed out. Please try again.");
            toast.error(copy.toastImageAnalysisTimedOut);
            return;
          }
          try {
            const sr = await api.get(`/img2img/describe-status/${describeJobId}`, {
              params: { _t: Date.now() },
              headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
            });
            const data = sr.data || {};
            const { status, prompt: p, error } = data;
            const hasBody = data && Object.keys(data).length > 0;
            if (!status && error) {
              setIsAnalyzing(false);
              const errText = formatImg2imgUserMessage(error, "Analysis failed");
              setAnalyzeError(errText);
              toast.error(`${copy.toastAnalysisFailedPrefix} ${errText}`);
              return;
            }
            if (status === "completed") {
              setEditablePrompt(p || "");
              setIsAnalyzing(false);
            } else if (status === "failed") {
              setIsAnalyzing(false);
              const errText = formatImg2imgUserMessage(error, "Analysis failed");
              setAnalyzeError(errText);
              toast.error(`${copy.toastAnalysisFailedPrefix} ${errText}`);
            } else if (status === "processing" || !hasBody) {
              // Empty body (e.g. HTTP 304 Not Modified) — keep polling, not a failure.
              setTimeout(pollDescribe, 3000);
            } else {
              console.warn("[img2img describe-status] unexpected payload:", sr.data);
              setTimeout(pollDescribe, 3000);
            }
          } catch (pollErr) {
            console.warn("describe-status poll error:", pollErr.message);
            if (attempts < maxPolls) setTimeout(pollDescribe, 4000);
            else { setIsAnalyzing(false); setAnalyzeError("Analysis timed out"); }
          }
        };
        setTimeout(pollDescribe, 3000);
        return; // ← finally does NOT run when we return inside try (in this JS pattern, finally WILL run, so we skip setIsAnalyzing below)
      }

      // Synchronous path (legacy / direct result)
      setEditablePrompt(data.prompt || "");
      setIsAnalyzing(false);
    } catch (err) {
      const errData = err.response?.data;
      const msg = errData?.errors?.length
        ? errData.errors
            .map((e) =>
              e.field
                ? `${e.field}: ${formatImg2imgUserMessage(e.message, "invalid")}`
                : formatImg2imgUserMessage(e.message, "Error"),
            )
            .join("; ")
        : formatImg2imgUserMessage(errData?.error ?? errData?.message ?? err.message, err.message || "Request failed");
      setAnalyzeError(msg);
      toast.error(`${copy.toastAnalysisFailedPrefix} ${msg}`);
      setIsAnalyzing(false);
    }
  };

  const startBgPolling = (jid, promptLabel) => {
    setBgJobs(prev => [...prev, { jobId: jid, status: 'pending', outputUrl: null, error: null, prompt: promptLabel }]);
    let failCount = 0;
    const maxFails = 5;
    const intervalMs = 1000;
    const maxPolls = Math.ceil((4.5 * 60 * 1000) / intervalMs);
    let pollCount = 0;
    const tick = async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(bgPollRefs.current[jid]);
        delete bgPollRefs.current[jid];
        setBgJobs(prev => prev.map(j => j.jobId === jid ? { ...j, status: 'failed', error: 'Timed out' } : j));
        refreshUserCredits();
        return;
      }
      try {
        const res = await api.get(`/img2img/status/${jid}`);
        failCount = 0;
        const { status, outputUrl: url, error } = res.data;
        const errStr = error != null ? formatImg2imgUserMessage(error, "Generation failed") : null;
        setBgJobs(prev => prev.map(j => j.jobId === jid ? { ...j, status, outputUrl: url || null, error: errStr } : j));
        if (status === 'completed' || status === 'failed') {
          clearInterval(bgPollRefs.current[jid]);
          delete bgPollRefs.current[jid];
          refreshUserCredits();
          if (status === 'failed') toast.error(errStr || "Generation failed — credits refunded");
          else toast.success('img2img generation ready!');
        }
      } catch (err) {
        failCount++;
        if (failCount >= maxFails) {
          clearInterval(bgPollRefs.current[jid]);
          delete bgPollRefs.current[jid];
          setBgJobs(prev => prev.map(j => j.jobId === jid ? { ...j, status: 'failed', error: 'Connection lost' } : j));
        }
      }
    };
    tick();
    bgPollRefs.current[jid] = setInterval(tick, intervalMs);
  };

  const startPolling = (jid) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let failCount = 0;
    const maxFails = 5;
    const pollIntervalMs = 1000; // RunPod is fast — poll more frequently
    const maxPolls = Math.ceil((4.5 * 60 * 1000) / pollIntervalMs); // ~4.5 min timeout
    let pollCount = 0;
    const pollOnce = async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(pollRef.current);
        setGenError("Generation timed out — check your history for the result.");
        setIsGenerating(false);
        return;
      }
      try {
        const res = await api.get(`/img2img/status/${jid}`);
        failCount = 0;
        const { status, outputUrl: url, error } = res.data;
        setJobStatus(status);
        if (status === "completed") {
          clearInterval(pollRef.current);
          if (url) {
            setOutputUrl(url);
            clearI2iDraft();
          } else {
            setGenError("Generation completed but no image was returned.");
          }
          setIsGenerating(false);
          refreshUserCredits();
        } else if (status === "failed") {
          clearInterval(pollRef.current);
          setGenError(formatImg2imgUserMessage(error, copy.toastGenerationFailed));
          setIsGenerating(false);
        }
      } catch (err) {
        failCount++;
        console.warn(`img2img poll error (${failCount}/${maxFails}):`, err.message);
        if (failCount >= maxFails) {
          clearInterval(pollRef.current);
          setGenError("Lost connection to server — check your history for the result.");
          setIsGenerating(false);
        }
      }
    };

    // Immediate check, then poll at interval
    pollOnce();
    pollRef.current = setInterval(pollOnce, pollIntervalMs);
  };

  const handleGenerate = async () => {
    if (!hasSource || !editablePrompt.trim()) return;
    if (!activeLoraObj?.loraUrl) {
      toast.error(copy.toastActiveLoraNoFile);
      return;
    }
    setIsGenerating(true);
    setGenError(null);
    setJobStatus("pending");
    try {
      const triggerWord = activeLoraObj.loraTriggerWord || activeLoraObj.triggerWord;
      const payload = {
        loraUrl: activeLoraObj.loraUrl,
        triggerWord,
        prompt: editablePrompt,
        loraStrength,
        denoise,
        modelId,
        inputImageUrl: sourceMode === "upload" ? uploadedUrl : sourceImageUrl,
      };
      const response = await api.post("/img2img/generate", payload);
      const jid = response.data.jobId;
      setJobId(jid);
      // Hand off to background queue and immediately unblock the form
      startBgPolling(jid, editablePrompt.slice(0, 60));
      setOutputUrl(null);
      setJobStatus(null);
      setIsGenerating(false);
      toast.success(copy.toastGenerationQueued);
    } catch (err) {
      const errData = err.response?.data;
      const msg = errData?.errors?.length
        ? errData.errors
            .map((e) =>
              e.field
                ? `${e.field}: ${formatImg2imgUserMessage(e.message, "invalid")}`
                : formatImg2imgUserMessage(e.message, "Error"),
            )
            .join("; ")
        : formatImg2imgUserMessage(errData?.error ?? errData?.message ?? err.message, err.message || "Request failed");
      setGenError(msg);
      setIsGenerating(false);
      setJobStatus(null);
      toast.error(`${copy.toastSubmitFailedPrefix} ${msg}`);
    }
  };

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Clean up all background job poll intervals on unmount
    Object.values(bgPollRefs.current).forEach(clearInterval);
    bgPollRefs.current = {};
  }, []);

  const promptReady = !!editablePrompt.trim();

  const statusLabel = {
    pending: "Queued…",
    processing: "Generating…",
    completed: "Done",
    failed: "Failed",
  }[jobStatus] || "";

  const parseUrls = (maybeJson) => {
    if (!maybeJson) return [];
    try {
      const parsed = JSON.parse(maybeJson);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return [maybeJson];
  };

  return (
    <div className="space-y-5 mt-4">

      {/* ── Source Photo ───────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        {/* Mode tabs */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">{copy.i2iSourcePhoto}</span>
          <div className="flex gap-1 bg-white/[0.04] rounded-lg p-0.5">
            <button
              onClick={() => {
                setSourceMode("gallery");
                setUploadedUrl(null);
                if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
                setUploadedPreview(null);
                setUploadError(null);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${sourceMode === "gallery" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {copy.sourceGallery}
            </button>
            <button
              onClick={() => { setSourceMode("upload"); setSourceImageUrl(null); }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${sourceMode === "upload" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {copy.sourceUpload}
            </button>
          </div>
        </div>

        {sourceMode === "upload" ? (
          <div className="space-y-2">
            <input
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              data-testid="input-i2i-file-upload"
            />
            {uploadedPreview ? (
              <div className="relative">
                <img src={uploadedPreview} alt="uploaded" className="w-full max-h-56 object-contain rounded-xl border border-white/10" />
                {isUploading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 rounded-xl">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                    <span className="text-xs text-white/80">Uploading… {Math.round(uploadProgress || 0)}%</span>
                  </div>
                )}
                <button
                  onClick={() => {
                    setUploadedUrl(null);
                    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
                    setUploadedPreview(null);
                    setUploadError(null);
                    setRawDescription("");
                    setEditablePrompt("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full border-2 border-dashed border-white/10 rounded-xl py-8 flex flex-col items-center gap-2 text-slate-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-i2i-pick-file"
              >
                <ImageIcon className="w-8 h-8" />
                <span className="text-sm">{copy.i2iPickPhoto}</span>
                <span className="text-xs text-slate-500">JPG · PNG · WebP</span>
              </button>
            )}
            {uploadError && (
              <p className="text-xs text-rose-400">{uploadError}</p>
            )}
            {uploadedUrl && !isUploading && (
              <p className="text-xs text-emerald-400">{copy.i2iImageLoaded}</p>
            )}
          </div>
        ) : (
          <>
            {imagesLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{copy.i2iGalleryLoading}</span>
              </div>
            ) : sourceImages.length === 0 ? (
              <p className="text-slate-500 text-sm py-2">{copy.i2iNoGeneratedYet}</p>
            ) : (
              <>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {sourceImages.map(g => {
                    const url = Array.isArray(g.outputUrl)
                      ? g.outputUrl[0]
                      : (() => { try { const p = JSON.parse(g.outputUrl); return Array.isArray(p) ? p[0] : g.outputUrl; } catch { return g.outputUrl; } })();
                    const selected = sourceImageUrl === url;
                    return (
                      <button
                        key={g.id}
                        onClick={() => { setSourceImageUrl(selected ? null : url); setRawDescription(""); setEditablePrompt(""); }}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${selected ? "border-white/80" : "border-transparent"}`}
                        data-testid={`button-i2i-source-${g.id}`}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        {selected && (
                          <div className="absolute inset-0 bg-white/90 flex items-center justify-center">
                            <Check className="w-4 h-4 text-black" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button onClick={() => setGalleryPage(p => Math.max(1, p - 1))} disabled={galleryPage === 1} className="p-1 rounded text-slate-400 disabled:opacity-30 hover:text-white">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-slate-400">{galleryPage}/{totalPages}</span>
                    <button onClick={() => setGalleryPage(p => Math.min(totalPages, p + 1))} disabled={galleryPage === totalPages} className="p-1 rounded text-slate-400 disabled:opacity-30 hover:text-white">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
            {/* Preview strip for selected gallery image */}
            {sourceImageUrl && (
              <div className="flex items-center gap-3 pt-1">
                <img src={sourceImageUrl} alt="source" className="w-14 h-14 object-cover rounded-lg flex-shrink-0 border border-white/10" />
                <div className="text-xs text-slate-400 min-w-0">
                  <p className="text-slate-300 font-medium">{copy.i2iSelectedFromGallery}</p>
                  <p className="truncate">{sourceImageUrl.split("/").pop()}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Step 1: Analyze ─────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-5 h-5 rounded-full bg-white/90 flex items-center justify-center flex-shrink-0">
            <span className="text-black text-[10px] font-bold">1</span>
          </div>
          <span className="text-sm font-medium text-white">{copy.i2iAnalyzePhoto}</span>
          <span className="text-xs text-slate-400 ml-1">{copy.labelFree}</span>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={!hasSource || isAnalyzing || isGenerating}
          data-testid="button-i2i-analyze"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: hasSource && !isAnalyzing
              ? "linear-gradient(135deg, rgba(168,85,247,0.3) 0%, rgba(236,72,153,0.2) 100%)"
              : "rgba(255,255,255,0.05)",
            border: "1px solid rgba(168,85,247,0.3)",
          }}
        >
          {isAnalyzing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /><span>{copy.i2iAnalyzing}</span></>
          ) : (
            <><ScanSearch className="w-4 h-4" /><span>{editablePrompt ? copy.i2iReanalyze : copy.i2iAnalyzePhoto}</span></>
          )}
        </button>

        {analyzeError && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{analyzeError}</p>
        )}

      </div>

      {/* ── Step 2: Edit Prompt ──────────────────────────── */}
      {editablePrompt !== "" && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-emerald-400 text-[10px] font-bold">2</span>
            </div>
            <span className="text-sm font-medium text-white">{copy.i2iEditPrompt}</span>
            <span className="text-xs text-slate-500 ml-1">- {copy.i2iModifyHint}</span>
          </div>

          <textarea
            value={editablePrompt}
            onChange={e => setEditablePrompt(e.target.value)}
            rows={6}
            data-testid="textarea-i2i-prompt"
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40 resize-y leading-relaxed"
            placeholder={copy.i2iInjectedPromptPlaceholder}
          />

          <div className="flex items-center gap-2">
            <Edit3 className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <p className="text-xs text-slate-500">{copy.i2iEditFreelyHint}</p>
          </div>
        </div>
      )}

      {/* ── Step 3: Settings + Generate ─────────────────── */}
      {promptReady && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-red-400 text-[10px] font-bold">3</span>
            </div>
            <span className="text-sm font-medium text-white">{copy.labelGenerate}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{copy.labelLoraStrength}</span>
                <span className="text-xs text-white font-mono">{loraStrength.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0.65} max={1.0} step={0.05}
                value={loraStrength}
                onChange={e => setLoraStrength(Math.max(0.65, parseFloat(e.target.value)))}
                data-testid="slider-i2i-lora-strength"
                className="w-full accent-white"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{copy.labelDenoise}</span>
                <span className="text-xs text-white font-mono">{denoise.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0.3} max={0.9} step={0.05}
                value={denoise}
                onChange={e => setDenoise(parseFloat(e.target.value))}
                data-testid="slider-i2i-denoise"
                className="w-full accent-white"
              />
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setDenoise(0.4)}
                  data-testid="preset-i2i-denoise-0-4"
                  className={`w-full px-3 py-2 rounded-lg text-[11px] font-medium border transition-colors ${
                    Math.abs(denoise - 0.4) < 0.001
                      ? "bg-white/10 border-white/30 text-white/80"
                      : "bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.06]"
                  }`}
                >
                  Complex poses preset — denoise 0.40
                </button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">Higher denoise = more creative, lower = closer to source.</p>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || isAnalyzing}
            data-testid="button-i2i-generate"
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              background: !isGenerating
                ? "rgba(0,0,0,0.10)"
                : "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.5)",
            }}
          >
            {isGenerating ? (
              <><Loader2 className="w-4 h-4 animate-spin" /><span>{statusLabel || copy.i2iProcessing}</span></>
            ) : (
              <><Flame className="w-4 h-4 text-white" /><span>{copy.labelGenerate}</span><span className="inline-flex items-center gap-0.5 text-yellow-400">{nsfwImageCost} <Coins className="w-3.5 h-3.5" /></span></>
            )}
          </button>

          {genError && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{genError}</p>
          )}

          {/* Background generation queue */}
          {bgJobs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{copy.i2iProcessingQueue}</p>
              {bgJobs.map((job) => (
                <div key={job.jobId} className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs ${
                  job.status === 'completed' ? 'border-emerald-500/20 bg-emerald-500/[0.06]'
                  : job.status === 'failed'   ? 'border-red-500/20 bg-red-500/[0.06]'
                  : 'border-white/[0.07] bg-white/[0.03]'
                }`}>
                  {job.status === 'completed' ? (
                    <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                  ) : job.status === 'failed' ? (
                    <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin text-purple-400 flex-shrink-0" />
                  )}
                  <span className="flex-1 text-slate-400 truncate">{job.prompt || job.jobId}</span>
                  {job.status === 'completed' && job.outputUrl && (
                    <a
                      href={parseUrls(job.outputUrl)[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:text-emerald-300 font-medium flex-shrink-0"
                    >{copy.i2iView}</a>
                  )}
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <button
                      onClick={() => setBgJobs(prev => prev.filter(j => j.jobId !== job.jobId))}
                      className="text-slate-600 hover:text-slate-400 flex-shrink-0 ml-1"
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Result preview (full-width) */}
          {outputUrl && (
            <div className="pt-4 border-t border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{copy.i2iResult}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownload(parseUrls(outputUrl)[0], jobId || "img2img", 0)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 transition-colors text-slate-300"
                    type="button"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                  <button
                    onClick={() => { setOutputUrl(null); setJobId(null); setJobStatus(null); setGenError(null); }}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-slate-400"
                    data-testid="button-i2i-clear-result"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {parseUrls(outputUrl).length === 1 ? (
                <img
                  src={parseUrls(outputUrl)[0]}
                  alt="img2img result"
                  className="w-full h-auto rounded-xl object-contain border border-white/[0.06]"
                  data-testid="img-i2i-result"
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="grid-i2i-results">
                  {parseUrls(outputUrl).map((url, idx) => (
                    <img
                      key={`${url}-${idx}`}
                      src={url}
                      alt={`img2img result ${idx + 1}`}
                      className="w-full h-auto rounded-xl object-contain border border-white/[0.06]"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// NSFW Video Tab - Image-to-Video generation
// ============================================
function NsfwVideoTab({ modelId, videoSelectedImage, setVideoSelectedImage, videoPrompt, setVideoPrompt, videoDuration, setVideoDuration, isSubmittingVideo, setIsSubmittingVideo }) {
  const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;
  const { user, refreshUserCredits } = useAuthStore();
  const [videoGalleryPage, setVideoGalleryPage] = useState(1);
  const [extendingVideoId, setExtendingVideoId] = useState(null);
  const [extendDuration, setExtendDuration] = useState(5);
  const [extendPrompt, setExtendPrompt] = useState("");
  const [isSubmittingExtend, setIsSubmittingExtend] = useState(false);
  const [videoGenMode, setVideoGenMode] = useState("standard"); // "standard" | "motion"
  const [sourceImageMode, setSourceImageMode] = useState("gallery"); // "gallery" | "upload"
  const [uploadedSourceImageUrl, setUploadedSourceImageUrl] = useState("");
  const [uploadedSourceImageName, setUploadedSourceImageName] = useState("");
  const [isUploadingSourceImage, setIsUploadingSourceImage] = useState(false);
  const [drivingVideoUrl, setDrivingVideoUrl] = useState("");
  const [drivingVideoName, setDrivingVideoName] = useState("");
  const [isUploadingDrivingVideo, setIsUploadingDrivingVideo] = useState(false);
  const [isSubmittingMotionVideo, setIsSubmittingMotionVideo] = useState(false);
  const [motionSkipSeconds, setMotionSkipSeconds] = useState(0);
  const [motionDerivedDuration, setMotionDerivedDuration] = useState(null); // seconds, derived from uploaded video (max 30)
  const [videoModal, setVideoModal] = useState(null); // { url, title, chain }
  const [viewingSegment, setViewingSegment] = useState({}); // { [chainRootId]: 'original' | 'extended' }
  const pageSize = 12;

  const { data: imageData, isLoading: imagesLoading } = useQuery({
    queryKey: ["nsfw-video-source-images", modelId, videoGalleryPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        type: "nsfw",
        status: "completed",
        limit: String(pageSize),
        offset: String((videoGalleryPage - 1) * pageSize),
      });
      if (modelId) params.set("modelId", modelId);
      const response = await api.get(`/generations?${params}`);
      return {
        generations: response.data.generations || [],
        pagination: response.data.pagination || { total: 0 },
      };
    },
    enabled: !!modelId,
    staleTime: 10000,
  });

  const { data: videoData, isLoading: videosLoading } = useQuery({
    queryKey: ["nsfw-videos", modelId],
    queryFn: async () => {
      const params = new URLSearchParams({
        type: "nsfw-video",
        limit: "50",
      });
      if (modelId) params.set("modelId", modelId);
      const response = await api.get(`/generations?${params}`);
      const nsfwVideos = response.data.generations || [];

      const extendParams = new URLSearchParams({
        type: "nsfw-video-extend",
        limit: "50",
      });
      if (modelId) extendParams.set("modelId", modelId);
      const extendResponse = await api.get(`/generations?${extendParams}`);
      const extendVideos = extendResponse.data.generations || [];

      const motionParams = new URLSearchParams({
        type: "nsfw-video-motion",
        limit: "50",
      });
      if (modelId) motionParams.set("modelId", modelId);
      const motionResponse = await api.get(`/generations?${motionParams}`);
      const motionVideos = motionResponse.data.generations || [];

      return [...nsfwVideos, ...extendVideos, ...motionVideos].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    enabled: !!modelId,
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const sourceImages = imageData?.generations || [];
  const totalImages = imageData?.pagination?.total || 0;
  const totalImagePages = Math.ceil(totalImages / pageSize);
  const videos = videoData || [];
  const processingVideos = videos.filter(v => v.status === "processing" || v.status === "pending");

  const originals = videos.filter(v => v.type === "nsfw-video");
  const extendsList = videos.filter(v => v.type === "nsfw-video-extend");
  const motionVideos = videos.filter(v => v.type === "nsfw-video-motion");

  const extendsBySource = {};
  extendsList.forEach(v => {
    try {
      const data = JSON.parse(v.inputImageUrl || "{}");
      const srcId = data.sourceGenerationId;
      if (srcId) {
        if (!extendsBySource[srcId]) extendsBySource[srcId] = [];
        extendsBySource[srcId].push(v);
      }
    } catch {}
  });
  Object.keys(extendsBySource).forEach(k => {
    extendsBySource[k].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  });

  const buildChain = (gen) => {
    const chain = [gen];
    let current = gen;
    const visited = new Set([gen.id]);
    while (true) {
      const nextList = extendsBySource[current.id];
      if (!nextList || nextList.length === 0) break;
      const next = nextList[0];
      if (visited.has(next.id)) break;
      visited.add(next.id);
      chain.push(next);
      current = next;
    }
    return chain;
  };

  const videoChains = originals
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(buildChain);

  const getSegmentDuration = (v) => {
    try {
      const data = JSON.parse(v.inputImageUrl || "{}");
      return data.duration || data.extendDuration || 5;
    } catch { return 5; }
  };

  const parseUrls = (outputUrl) => {
    if (!outputUrl) return [];
    try { const p = JSON.parse(outputUrl); if (Array.isArray(p)) return p; } catch {}
    return [outputUrl];
  };

  const standardCreditsNeeded = videoDuration === 8 ? 80 : 50;
  const effectiveMotionDuration = Math.max(1, Math.min(30, Math.round(Number(motionDerivedDuration) || 5)));
  const motionCreditsNeeded = Math.max(60, Math.round(effectiveMotionDuration * 30));
  const effectiveSelectedImage = sourceImageMode === "upload" ? uploadedSourceImageUrl : videoSelectedImage;

  const handleSubmitVideo = async () => {
    if (!effectiveSelectedImage || isSubmittingVideo) return;
    setIsSubmittingVideo(true);
    try {
      const response = await api.post("/nsfw/generate-video", {
        modelId,
        imageUrl: effectiveSelectedImage,
        prompt: videoPrompt || undefined,
        duration: videoDuration,
      });
      if (response.data.success) {
        toast.success(`Video generating! ${response.data.creditsUsed} 🪙 used`);
        sound.playSuccess();
        await refreshUserCredits();
      } else {
        toast.error(response.data.message || copy.videoToastFailed);
      }
    } catch (err) {
      const errData = err.response?.data;
      const msg = errData?.errors?.length
        ? errData.errors.map(e => e.field ? `${e.field}: ${e.message}` : e.message).join('; ')
        : (errData?.message || copy.videoToastFailed);
      toast.error(msg);
    } finally {
      setIsSubmittingVideo(false);
    }
  };

  const readVideoDuration = (file) =>
    new Promise((resolve) => {
      if (!file || !file.type?.startsWith("video/")) {
        resolve(5);
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement("video");
      const cleanup = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {}
      };
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const d = Number(video.duration);
        cleanup();
        if (!Number.isFinite(d) || d <= 0) {
          resolve(5);
          return;
        }
        resolve(Math.max(1, Math.min(30, Math.round(d))));
      };
      video.onerror = () => {
        cleanup();
        resolve(5);
      };
      video.src = objectUrl;
    });

  const handleDrivingVideoUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    setIsUploadingDrivingVideo(true);
    try {
      const derivedDuration = await readVideoDuration(file);
      const uploadedUrl = await uploadFile(file);
      setDrivingVideoUrl(uploadedUrl);
      setDrivingVideoName(file.name || "driving-video.mp4");
      setMotionDerivedDuration(derivedDuration);
      toast.success(`Driving video uploaded (${derivedDuration}s, max 30s)`);
    } catch (err) {
      const msg = err?.message || "Failed to upload driving video";
      toast.error(msg);
    } finally {
      setIsUploadingDrivingVideo(false);
      event.target.value = "";
    }
  };

  const handleSourceImageUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    setIsUploadingSourceImage(true);
    try {
      const uploadedUrl = await uploadFile(file);
      setUploadedSourceImageUrl(uploadedUrl);
      setUploadedSourceImageName(file.name || "source-image.jpg");
      setSourceImageMode("upload");
      toast.success("Custom source image uploaded");
    } catch (err) {
      const msg = err?.message || "Failed to upload source image";
      toast.error(msg);
    } finally {
      setIsUploadingSourceImage(false);
      event.target.value = "";
    }
  };

  const handleSubmitMotionVideo = async () => {
    if (!effectiveSelectedImage || !drivingVideoUrl || isSubmittingMotionVideo) return;
    setIsSubmittingMotionVideo(true);
    try {
      const response = await generationAPI.nsfwGenerateMotionVideo({
        modelId,
        imageUrl: effectiveSelectedImage,
        videoUrl: drivingVideoUrl,
        prompt: videoPrompt || undefined,
        duration: effectiveMotionDuration,
        skipSeconds: Math.max(0, Math.min(60, Number(motionSkipSeconds) || 0)),
      });
      if (response?.success) {
        toast.success(`Motion video generating! ${response.creditsUsed} 🪙 used`);
        sound.playSuccess();
        await refreshUserCredits();
      } else {
        toast.error(response?.message || "Motion video generation failed");
      }
    } catch (err) {
      const errData = err.response?.data;
      const msg = errData?.errors?.length
        ? errData.errors.map(e => e.field ? `${e.field}: ${e.message}` : e.message).join("; ")
        : (errData?.message || "Motion video generation failed");
      toast.error(msg);
    } finally {
      setIsSubmittingMotionVideo(false);
    }
  };

  const handleDownload = async (url, genId) => {
    const filename = `nsfw-video-${genId ? genId.substring(0, 8) : "vid"}.mp4`;
    await downloadFromPublicUrl(url, filename);
  };

  const handleExtendVideo = async (genId) => {
    if (isSubmittingExtend) return;
    setIsSubmittingExtend(true);
    try {
      const payload = {
        generationId: genId,
        duration: extendDuration,
      };
      if (extendPrompt.trim()) {
        payload.prompt = extendPrompt.trim();
      }
      const response = await api.post("/nsfw/extend-video", payload);
      if (response.data.success) {
        toast.success(`Extending video by ${extendDuration}s! ${response.data.creditsUsed} 🪙 used`);
        sound.playSuccess();
        setExtendingVideoId(null);
        setExtendPrompt("");
        await refreshUserCredits();
      } else {
        toast.error(response.data.message || "Failed to extend video");
      }
    } catch (err) {
      const errData = err.response?.data;
      const msg = errData?.errors?.length
        ? errData.errors.map(e => e.field ? `${e.field}: ${e.message}` : e.message).join('; ')
        : (errData?.message || "Video extension failed");
      toast.error(msg);
    } finally {
      setIsSubmittingExtend(false);
    }
  };

  return (
    <div className="mt-6 space-y-5">
      {/* Primary Mode Selector (large / first visible) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          onClick={() => setVideoGenMode("motion")}
          className={`relative text-left rounded-2xl border p-4 transition-all overflow-hidden ${
            videoGenMode === "motion"
              ? "border-fuchsia-400/60 bg-fuchsia-500/10"
              : "border-white/10 bg-white/[0.02] hover:border-white/25"
          }`}
          data-testid="button-video-mode-motion"
        >
          {videoGenMode === "motion" && (
            <>
              <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={RED_CORNER_GLOW_STYLE} />
              <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-gradient-to-b from-fuchsia-200 to-fuchsia-500" />
            </>
          )}
          <div className="flex items-start gap-3 relative">
            <div className="w-10 h-10 rounded-xl bg-fuchsia-500/20 border border-fuchsia-400/40 flex items-center justify-center">
              <Video className="w-5 h-5 text-fuchsia-300" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Motion Control</p>
              <p className="text-[11px] text-slate-300 mt-1">
                Upload first frame + driving video. Best for controllable, reference-driven animation.
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setVideoGenMode("standard")}
          className={`relative text-left rounded-2xl border p-4 transition-all overflow-hidden ${
            videoGenMode === "standard"
              ? "border-blue-400/60 bg-blue-500/10"
              : "border-white/10 bg-white/[0.02] hover:border-white/25"
          }`}
          data-testid="button-video-mode-standard"
        >
          {videoGenMode === "standard" && (
            <>
              <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={RED_CORNER_GLOW_STYLE} />
              <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-gradient-to-b from-blue-100 to-blue-500" />
            </>
          )}
          <div className="flex items-start gap-3 relative">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-blue-300" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Standard Image-to-Video</p>
              <p className="text-[11px] text-slate-300 mt-1">
                Animate a single source image quickly. Choose duration and generate.
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Step 1: Select Source Image */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-rose-500">
            <span className="text-[10px] font-bold text-white">1</span>
          </div>
          <span className="text-sm font-medium text-white">{copy.videoSectionSourceImage}</span>
          <span className="text-[10px] text-slate-500">{copy.videoAnimateHint}</span>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setSourceImageMode("gallery")}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              sourceImageMode === "gallery"
                ? "bg-white/[0.1] border-white/25 text-white"
                : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
            }`}
            data-testid="button-video-source-mode-gallery"
          >
            <Grid3X3 className="w-3 h-3 inline mr-1" />
            Gallery
          </button>
          <button
            onClick={() => setSourceImageMode("upload")}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              sourceImageMode === "upload"
                ? "bg-white/[0.1] border-white/25 text-white"
                : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
            }`}
            data-testid="button-video-source-mode-upload"
          >
            <Upload className="w-3 h-3 inline mr-1" />
            Upload custom
          </button>
        </div>

        <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          {sourceImageMode === "upload" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-slate-300 font-medium">Custom first frame</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {uploadedSourceImageUrl ? (uploadedSourceImageName || "Uploaded image ready") : "Upload JPG/PNG/WebP"}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer text-xs text-white">
                  {isUploadingSourceImage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {isUploadingSourceImage ? "Uploading..." : "Upload image"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleSourceImageUpload}
                    disabled={isUploadingSourceImage}
                  />
                </label>
              </div>
              {uploadedSourceImageUrl && (
                <img
                  src={uploadedSourceImageUrl}
                  alt="Custom source frame"
                  className="w-full max-h-56 object-contain rounded-lg border border-white/10 bg-black/20"
                />
              )}
            </div>
          ) : imagesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : sourceImages.length === 0 ? (
            <p className="text-center text-slate-500 py-8 text-sm">
              No NSFW images yet. Generate some images first in the Generate tab.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {sourceImages.map((gen) => {
                  const urls = parseUrls(gen.outputUrl);
                  return urls.map((url, idx) => {
                    const isSelected = videoSelectedImage === url;
                    return (
                      <button
                        key={`${gen.id}-${idx}`}
                        onClick={() => setVideoSelectedImage(isSelected ? null : url)}
                        className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all ${
                          isSelected
                            ? "border-red-500 ring-2 ring-red-500/30 scale-[1.02]"
                            : "border-transparent hover:border-white/20"
                        }`}
                        data-testid={`button-select-video-source-${gen.id}-${idx}`}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        {isSelected && (
                          <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                            <CheckCircle2 className="w-6 h-6 text-red-400" />
                          </div>
                        )}
                      </button>
                    );
                  });
                })}
              </div>
              {totalImagePages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button
                    onClick={() => setVideoGalleryPage(p => Math.max(1, p - 1))}
                    disabled={videoGalleryPage <= 1}
                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-400">{videoGalleryPage} / {totalImagePages}</span>
                  <button
                    onClick={() => setVideoGalleryPage(p => Math.min(totalImagePages, p + 1))}
                    disabled={videoGalleryPage >= totalImagePages}
                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Selected Inputs Preview */}
      {effectiveSelectedImage && (
        <div className="flex items-start gap-4 p-3 rounded-xl border border-red-500/20 bg-red-500/5">
          <img src={effectiveSelectedImage} alt="" className="w-20 h-28 object-cover rounded-lg flex-shrink-0 border border-white/10" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-400 font-medium mb-2">
              {copy.videoSectionSourceImage} {sourceImageMode === "upload" ? "(custom upload)" : "(gallery)"}
            </p>
            <textarea
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              placeholder={copy.videoSectionPrompt}
              className="w-full h-16 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-red-500/50 resize-none text-sm"
              data-testid="input-video-prompt"
            />
            {videoGenMode === "motion" && drivingVideoUrl && (
              <div className="mt-3">
                <p className="text-[11px] text-fuchsia-300 mb-1">Driving video preview</p>
                <video
                  src={drivingVideoUrl}
                  className="w-full max-h-40 rounded-lg border border-white/10 bg-black/30"
                  controls
                  playsInline
                />
                <p className="text-[10px] text-slate-500 mt-1 truncate">{drivingVideoName || "driving-video.mp4"}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Duration & Generate */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-rose-500">
            <span className="text-[10px] font-bold text-white">2</span>
          </div>
          <span className="text-sm font-medium text-white">{copy.videoSectionDuration}</span>
        </div>
        {videoGenMode !== "motion" ? (
          <div className="flex items-center gap-3 mb-4">
            {[5, 8].map((dur) => (
              <button
                key={dur}
                onClick={() => setVideoDuration(dur)}
                className={`relative px-4 py-2.5 rounded-xl text-sm font-medium transition-all border group ${
                  videoDuration === dur
                    ? "bg-white/[0.08] border-white/20 text-white"
                    : "bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06] hover:text-white"
                }`}
                data-testid={`button-duration-${dur}`}
              >
                {videoDuration === dur && (
                  <>
                    <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none" style={RED_CORNER_GLOW_STYLE} />
                    <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
                  </>
                )}
                {dur}s
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-4 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <div className="text-xs text-amber-200">
              Duration is automatically derived from the uploaded driving video and capped at 30s.
            </div>
            <div className="text-[11px] text-amber-300 mt-1">
              Current derived duration: <span className="font-semibold">{effectiveMotionDuration}s</span>
            </div>
            <div className="text-[11px] text-amber-400/90 mt-1">
              Need higher length limits? Contact administrator.
            </div>
          </div>
        )}

        {videoGenMode === "motion" && (
          <div className="mb-4 p-3 rounded-xl border border-white/[0.08] bg-white/[0.02] space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-300 font-medium">Driving video</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {drivingVideoUrl ? (drivingVideoName || "Uploaded video ready") : "Upload an MP4/MOV/WebM file"}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer text-xs text-white">
                {isUploadingDrivingVideo ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {isUploadingDrivingVideo ? "Uploading..." : "Upload video"}
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={handleDrivingVideoUpload}
                  disabled={isUploadingDrivingVideo}
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 whitespace-nowrap">Skip first seconds</span>
              <input
                type="number"
                min={0}
                max={60}
                value={motionSkipSeconds}
                onChange={(e) => setMotionSkipSeconds(e.target.value)}
                className="w-24 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs focus:outline-none focus:border-white/25"
                data-testid="input-motion-skip-seconds"
              />
              <span className="text-[11px] text-slate-500">0–60</span>
            </div>
          </div>
        )}

        <button
          onClick={videoGenMode === "motion" ? handleSubmitMotionVideo : handleSubmitVideo}
          disabled={
            videoGenMode === "motion"
              ? (!effectiveSelectedImage || !drivingVideoUrl || isSubmittingMotionVideo || isUploadingDrivingVideo)
              : (!effectiveSelectedImage || isSubmittingVideo)
          }
          className="w-full py-3.5 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background:
              videoGenMode === "motion"
                ? (effectiveSelectedImage && drivingVideoUrl && !isSubmittingMotionVideo && !isUploadingDrivingVideo
                  ? "linear-gradient(135deg, #ef4444 0%, #9333ea 100%)"
                  : "rgba(255,255,255,0.1)")
                : (effectiveSelectedImage && !isSubmittingVideo
              ? "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)"
              : "rgba(255,255,255,0.1)"),
          }}
          data-testid={videoGenMode === "motion" ? "button-generate-motion-video" : "button-generate-video"}
        >
          {(videoGenMode === "motion" ? isSubmittingMotionVideo : isSubmittingVideo) ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {videoGenMode === "motion" ? "Generating motion video..." : copy.videoButtonGenerating}
            </>
          ) : (
            <>
              <Video className="w-5 h-5" />
              {videoGenMode === "motion" ? "Generate Motion Video" : copy.videoButtonGenerate} {videoGenMode === "motion" ? effectiveMotionDuration : videoDuration}s
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs inline-flex items-center gap-1.5">
                <Coins className="w-3 h-3 text-yellow-400" />
                <span>{videoGenMode === "motion" ? motionCreditsNeeded : standardCreditsNeeded}</span>
              </span>
            </>
          )}
        </button>
      </div>

      {/* Processing Videos Banner */}
      {processingVideos.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
            <span className="text-xs text-red-400 font-medium">
              {processingVideos.length} generating...
            </span>
          </div>
        </div>
      )}

      {/* Motion Control Videos Gallery */}
      {motionVideos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-fuchsia-400" />
            <h3 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">Motion Control Videos</h3>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-medium" style={{ background: "rgba(217,70,239,0.15)", color: "#E879F9" }}>
              {motionVideos.length}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {motionVideos.map((motion) => (
              <div key={motion.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <div
                  className="relative w-full bg-black overflow-hidden cursor-pointer group"
                  style={{ height: "9rem" }}
                  onClick={() => {
                    if (motion.outputUrl) {
                      setVideoModal({ url: motion.outputUrl, title: motion.prompt, chain: [motion], totalDuration: 0 });
                    }
                  }}
                  data-testid={`motion-video-thumbnail-${motion.id}`}
                >
                  {motion.outputUrl ? (
                    <LazyVideo
                      src={motion.outputUrl}
                      muted
                      loop
                      playsInline
                      videoClassName="object-contain"
                      className="w-full h-full"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-fuchsia-400" />
                    </div>
                  )}
                </div>
                <div className="p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{new Date(motion.createdAt).toLocaleDateString()}</span>
                    <span className="text-fuchsia-300">{motion.status}</span>
                  </div>
                  {motion.outputUrl && (
                    <button
                      onClick={() => handleDownload(motion.outputUrl, motion.id)}
                      className="w-full py-1.5 rounded-lg text-[11px] bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-white"
                      data-testid={`button-download-motion-${motion.id}`}
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Video Chains Gallery */}
      {videoChains.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-red-400" />
            <h3 className="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.yourVideos}</h3>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-medium" style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}>
              {videoChains.length}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {videoChains.map((chain) => {
              const lastSegment = chain[chain.length - 1];
              const lastCompleted = [...chain].reverse().find(v => v.status === "completed" && v.outputUrl);
              const isLastProcessing = lastSegment.status === "processing" || lastSegment.status === "pending";
              const totalDuration = chain.reduce((sum, v) => sum + getSegmentDuration(v), 0);
              const isExtendOpen = extendingVideoId === lastSegment.id;
              const hasExtensions = chain.length > 1 && lastCompleted;
              const selectedSeg = viewingSegment[chain[0].id] || "original";
              const displayUrl = (hasExtensions && selectedSeg === "extended")
                ? lastCompleted.outputUrl
                : chain[0].outputUrl;
              const displayDuration = selectedSeg === "extended" ? totalDuration : getSegmentDuration(chain[0]);

              return (
                <div
                  key={chain[0].id}
                  className={`rounded-xl border border-white/[0.06] bg-white/[0.02] flex flex-col${isExtendOpen ? " col-span-2" : ""}`}
                >
                  {/* Segment toggle tabs — only shown when extensions exist */}
                  {hasExtensions && (
                    <div className="flex border-b border-white/[0.06]">
                      <button
                        onClick={() => setViewingSegment(s => ({ ...s, [chain[0].id]: "original" }))}
                        className={`flex-1 py-1.5 text-[10px] font-medium transition-colors rounded-tl-xl ${
                          selectedSeg === "original"
                            ? "bg-white/[0.08] text-white border-b-2 border-white/40"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                        data-testid={`button-seg-original-${chain[0].id}`}
                      >
                        Original · {getSegmentDuration(chain[0])}s
                      </button>
                      <button
                        onClick={() => setViewingSegment(s => ({ ...s, [chain[0].id]: "extended" }))}
                        className={`flex-1 py-1.5 text-[10px] font-medium transition-colors rounded-tr-xl flex items-center justify-center gap-1 ${
                          selectedSeg === "extended"
                            ? "bg-white/[0.08] text-white border-b-2 border-white/40"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                        data-testid={`button-seg-extended-${chain[0].id}`}
                      >
                        Extended · {totalDuration}s
                        {isLastProcessing && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      </button>
                    </div>
                  )}

                  {/* Thumbnail — click to open modal */}
                  <div
                    className="relative w-full bg-black overflow-hidden cursor-pointer group"
                    style={{ height: "9rem", borderRadius: hasExtensions ? "0" : "0.75rem 0.75rem 0 0" }}
                    onClick={() => {
                      if (displayUrl) {
                        setVideoModal({ url: displayUrl, title: chain[0].prompt, chain, totalDuration });
                      }
                    }}
                    data-testid={`video-thumbnail-${chain[0].id}`}
                  >
                    {displayUrl ? (
                      <LazyVideo
                        key={displayUrl}
                        src={displayUrl}
                        muted
                        loop
                        playsInline
                        videoClassName="object-contain"
                        className="w-full h-full"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="w-5 h-5 animate-spin text-red-400" />
                          <span className="text-[10px] text-slate-500">Generating...</span>
                        </div>
                      </div>
                    )}
                    {displayUrl && (
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                          <Play className="w-4 h-4 text-white ml-0.5" />
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-1.5 right-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/70 text-white backdrop-blur-sm">
                        {displayDuration}s
                      </span>
                    </div>
                  </div>

                  {/* Card footer */}
                  <div className="p-2.5 space-y-2 flex-1 flex flex-col">
                    <p className="text-[10px] text-slate-400 truncate leading-tight">{chain[0].prompt || "No prompt"}</p>

                    {/* Chain timeline */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {chain.map((seg, i) => {
                        const dur = getSegmentDuration(seg);
                        const isProcessing = seg.status === "processing" || seg.status === "pending";
                        return (
                          <span key={seg.id} className="flex items-center gap-0.5">
                            {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-slate-700 flex-shrink-0" />}
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border bg-white/[0.06] border-white/[0.12] text-slate-300`}>
                              {i > 0 ? "+" : ""}{dur}s
                              {isProcessing && <Loader2 className="w-2 h-2 animate-spin" />}
                            </span>
                          </span>
                        );
                      })}
                      {chain.length > 1 && (
                        <span className="text-[9px] text-slate-600">= {totalDuration}s</span>
                      )}
                    </div>

                    {/* Actions row */}
                    <div className="flex items-center gap-1.5 mt-auto">
                      {!isLastProcessing && (
                        <button
                          onClick={() => {
                            setExtendingVideoId(isExtendOpen ? null : lastSegment.id);
                            setExtendDuration(5);
                            setExtendPrompt("");
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all border flex-1 justify-center ${
                            isExtendOpen
                              ? "bg-white/[0.08] border-white/20 text-white"
                              : "bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.06] hover:text-white"
                          }`}
                          data-testid={`button-extend-video-${chain[0].id}`}
                        >
                          <FastForward className="w-3 h-3" />
                          Extend
                        </button>
                      )}
                      {displayUrl && (
                        <button
                          onClick={() => handleDownload(displayUrl, chain[0].id)}
                          className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex-shrink-0"
                          data-testid={`button-download-video-${chain[0].id}`}
                        >
                          <Download className="w-3 h-3 text-white" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Extend Video panel — sits below card footer, spans full col-span-2 width */}
                  {isExtendOpen && (
                    <div className="border-t border-white/[0.10] rounded-b-xl bg-white/[0.03] p-4 space-y-4">
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FastForward className="w-4 h-4 text-white" />
                          <span className="text-sm font-semibold text-white">Extend Video</span>
                          <span className="text-[10px] text-slate-500">— add more seconds to the end</span>
                        </div>
                        <button
                          onClick={() => setExtendingVideoId(null)}
                          className="p-1 rounded-md hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                          data-testid="button-cancel-extend"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex gap-5 items-start">
                        {/* Left column: duration preview + picker */}
                        <div className="flex-1 space-y-3">
                          {/* Duration preview */}
                          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.12]">
                            <div className="text-center">
                              <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Current</p>
                              <p className="text-xl font-bold text-white leading-none">{totalDuration}s</p>
                            </div>
                            <div className="flex-1 flex items-center justify-center gap-1">
                              <div className="flex-1 h-px bg-white/15" />
                              <FastForward className="w-3.5 h-3.5 text-white flex-shrink-0" />
                              <div className="flex-1 h-px bg-white/15" />
                            </div>
                            <div className="text-center">
                              <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">After extend</p>
                              <p className="text-xl font-bold text-white leading-none">{totalDuration + extendDuration}s</p>
                            </div>
                          </div>

                          {/* Duration picker */}
                          <div>
                            <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-2">Add how many seconds?</p>
                            <div className="flex gap-2">
                              {[5, 8].map((dur) => (
                                <button
                                  key={dur}
                                  onClick={() => setExtendDuration(dur)}
                                  className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all border flex flex-col items-center gap-1 ${
                                    extendDuration === dur
                                      ? "bg-white/[0.08] border-white/20 text-white"
                                      : "bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.06] hover:text-slate-300"
                                  }`}
                                  data-testid={`button-extend-duration-${dur}`}
                                >
                                  <span className="text-base font-bold">+{dur}s</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Right column: optional prompt + confirm */}
                        <div className="flex-1 space-y-3">
                          <div>
                            <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-2">Custom prompt (optional)</p>
                            <input
                              type="text"
                              value={extendPrompt}
                              onChange={(e) => setExtendPrompt(e.target.value)}
                              placeholder="Leave blank to continue with original prompt"
                              className="w-full px-3 py-2 rounded-xl text-xs bg-white/5 border border-white/10 text-white placeholder-slate-600 focus:outline-none focus:border-white/30"
                              data-testid={`input-extend-prompt-${chain[0].id}`}
                            />
                          </div>

                          <button
                            onClick={() => handleExtendVideo(lastSegment.id)}
                            disabled={isSubmittingExtend}
                            className="w-full py-3 rounded-xl font-semibold text-white text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                            style={{
                              background: isSubmittingExtend
                                ? "rgba(255,255,255,0.08)"
                                : "linear-gradient(135deg, #f43f5e 0%, #be123c 100%)",
                            }}
                            data-testid={`button-confirm-extend-${chain[0].id}`}
                          >
                            {isSubmittingExtend ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Submitting...
                              </>
                            ) : (
                              <>
                                <FastForward className="w-4 h-4" />
                                Extend +{extendDuration}s
                                <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs inline-flex items-center gap-1.5">
                                  <Coins className="w-3 h-3 text-yellow-400" />
                                  <span>{extendDuration}</span>
                                </span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Video Modal — plays the latest extended video with full controls */}
      {videoModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center p-4"
          onClick={() => setVideoModal(null)}
        >
          <div
            className="relative w-full max-w-xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setVideoModal(null)}
              className="absolute -top-10 right-0 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              data-testid="button-close-video-modal"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Player */}
            <video
              src={videoModal.url}
              controls
              autoPlay
              className="w-full rounded-xl bg-black"
              style={{ maxHeight: "70vh" }}
            />

            {/* Info row */}
            <div className="flex items-start justify-between gap-3 px-1">
              <div className="flex-1 min-w-0">
                {videoModal.title && (
                  <p className="text-sm text-white font-medium truncate mb-1.5">{videoModal.title}</p>
                )}
                {/* Chain timeline */}
                <div className="flex items-center gap-1 flex-wrap">
                  {videoModal.chain.map((seg, i) => {
                    const dur = getSegmentDuration(seg);
                    return (
                      <span key={seg.id} className="flex items-center gap-0.5">
                        {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-slate-600 flex-shrink-0" />}
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                          i === 0
                            ? "bg-red-500/10 border-red-500/20 text-red-400"
                            : "bg-white/5 border-white/10 text-white/60"
                        }`}>
                          {i > 0 ? "+" : ""}{dur}s
                        </span>
                      </span>
                    );
                  })}
                  {videoModal.chain.length > 1 && (
                    <span className="text-[9px] text-slate-500 ml-0.5">= {videoModal.totalDuration}s total</span>
                  )}
                </div>
              </div>
              {/* Download latest */}
              <button
                onClick={() => handleDownload(videoModal.url, videoModal.chain[0].id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-[11px] font-medium transition-colors flex-shrink-0"
                data-testid="button-download-modal-video"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ============================================
// LocalStorage helpers for training state persistence
// ============================================
const TRAINING_STATE_KEY = "nsfw_training_state";

function saveTrainingState(modelId, status) {
  try {
    const state = JSON.parse(localStorage.getItem(TRAINING_STATE_KEY) || "{}");
    state[modelId] = { status, timestamp: Date.now() };
    localStorage.setItem(TRAINING_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save training state:", e);
  }
}

function getTrainingState(modelId) {
  try {
    const state = JSON.parse(localStorage.getItem(TRAINING_STATE_KEY) || "{}");
    const modelState = state[modelId];
    if (!modelState) return null;
    return modelState.status;
  } catch (e) {
    console.error("Failed to get training state:", e);
    return null;
  }
}

function clearTrainingState(modelId) {
  try {
    const state = JSON.parse(localStorage.getItem(TRAINING_STATE_KEY) || "{}");
    delete state[modelId];
    localStorage.setItem(TRAINING_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to clear training state:", e);
  }
}

// ============================================
// NSFW Unlock Request Modal
// Shows when user needs to unlock NSFW access
// ============================================
function NsfwUnlockModal({ isOpen, onClose, sidebarCollapsed = false }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className={`fixed top-0 right-0 bottom-0 z-[60] overflow-y-auto p-4 left-0 ${
        sidebarCollapsed ? "md:left-[80px]" : "md:left-[260px]"
      }`}>
      <div className="relative min-h-full flex items-center justify-center">
      <div 
        className="relative w-full max-w-md rounded-2xl glass-panel-strong p-5 max-h-[calc(100dvh-48px)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-500 hover:text-white transition-colors z-10"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center mb-6">
          <h3 className="text-xl font-bold text-white mb-2">
            NSFW Access Required
          </h3>
          <p className="text-sm text-slate-400">
            To protect everyone, NSFW features require verification
          </p>
        </div>

        <div className="space-y-4 mb-6">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10">
            <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Two Ways to Get Access
            </h4>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-xs font-medium text-emerald-300 mb-1">Option 1: AI-Generated Models</p>
                <p className="text-[11px] text-slate-400">
                  Create your model using AI-generated photos. Automatic approval.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <p className="text-xs font-medium text-white/70 mb-1">Option 2: Real Person (KYC Required)</p>
                <p className="text-[11px] text-slate-400">
                  Use your own photos or photos of someone who gave consent. We'll do a quick KYC verification to confirm identity and rights.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-amber-200">
              <strong className="text-amber-100">Why verification?</strong> We protect both you and the people in photos. KYC ensures only authorized content is generated.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <a
            href="https://discord.gg/vpwGygjEaB"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            Contact on Discord
          </a>
          <a
            href="https://t.me/modelclonechat"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 rounded-xl bg-[#0088cc] hover:bg-[#006699] text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            Contact on Telegram
          </a>
        </div>

        <p className="text-[10px] text-slate-500 text-center mt-4">
          Usually verified within 24 hours
        </p>
      </div>
      </div>
      </div>
    </div>
  );
}

// ============================================
// NSFW Model Selector - Searchable with shadcn/Phosphor
// ============================================
function NSFWModelSelector({ models, selectedModel, onSelect, onShowUnlockModal, modelsLoadError, onRetry, isLoading: modelsLoading = false }) {
  const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  // Verified = AI-generated, admin override, or has trained LoRA (nsfwUnlocked)
  // Exclude models still generating (no usable photos yet)
  const aiModels = models.filter((m) => m.status !== "processing" && (m.isAIGenerated === true || m.nsfwOverride === true || m.nsfwUnlocked === true));
  const selectedModelData = aiModels.find((m) => m.id === selectedModel);

  const filteredModels = search.trim()
    ? aiModels.filter((m) => m.name?.toLowerCase().includes(search.toLowerCase()))
    : aiModels;

  const handleSelect = (modelId) => {
   
    onSelect(modelId);
    setIsOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (isOpen && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-rose-500">
          <span className="text-[10px] font-bold text-white">1</span>
        </div>
        <span className="text-sm font-medium text-white tracking-wide">{copy.sectionSelectModel}</span>
        {aiModels.length > 0 && (
          <Badge variant="secondary" className="ml-auto">{aiModels.length} {copy.modelSelectorCount}</Badge>
        )}
      </div>

      {modelsLoading ? (
        <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin shrink-0" weight="duotone" />
            <div>
              <p className="text-sm font-medium text-slate-200">{copy.loadingModelsTitle}</p>
              <p className="text-xs text-slate-500">{copy.loadingModelsWait}</p>
            </div>
          </div>
        </div>
      ) : modelsLoadError ? (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/[0.06]">
          <div className="flex items-center gap-3">
            <Warning className="w-5 h-5 text-red-400 shrink-0" weight="duotone" />
            <div>
              <p className="text-sm font-medium text-red-200">{copy.loadModelsFailedTitle}</p>
              <p className="text-xs text-red-300/70 mb-2">{copy.loadModelsFailedBody}</p>
              {typeof onRetry === "function" && (
                <button
                  type="button"
                  onClick={() => onRetry()}
                  className="text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg border border-white/20 transition-colors"
                >
                  {copy.loadModelsRetry}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : aiModels.length === 0 ? (
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06]">
          <div className="flex items-center gap-3">
            <Warning className="w-5 h-5 text-amber-400" weight="duotone" />
            <div>
              <p className="text-sm font-medium text-amber-200">{copy.noVerifiedModelsTitle}</p>
              <p className="text-xs text-amber-300/60 mb-2">{copy.noVerifiedModelsBody}</p>
              <button onClick={onShowUnlockModal} className="text-xs text-white hover:text-white/70 transition-colors">
                {copy.noVerifiedModelsCta}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => { setIsOpen(!isOpen); }}
            className={cn(
              "w-full p-3 rounded-xl border bg-white/[0.03] flex items-center justify-between transition-all duration-200",
              isOpen
                ? "border-white/25 ring-1 ring-white/15 bg-white/[0.06]"
                : "border-white/[0.08] hover:border-white/15 hover:bg-white/[0.05]"
            )}
          >
            <div className="flex items-center gap-3">
              {selectedModelData ? (
                <>
                  <img
                    src={selectedModelData.photo1Url}
                    alt={selectedModelData.name}
                    className="w-10 h-10 rounded-lg object-cover ring-1 ring-white/10"
                  />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-white">{selectedModelData.name}</p>
                    <p className="text-[11px] flex items-center gap-1">
                      {selectedModelData.nsfwUnlocked ? (
                        <><CheckCircle className="w-3.5 h-3.5 text-emerald-400" weight="fill" /><span className="text-emerald-400">LoRA Ready</span></>
                      ) : (
                        <><Lightning className="w-3.5 h-3.5 text-amber-400" weight="fill" /><span className="text-amber-400">Needs Training</span></>
                      )}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <UserCircle className="w-5 h-5 text-slate-500" weight="duotone" />
                  <span className="text-sm text-slate-500">Select a model...</span>
                </div>
              )}
            </div>
            <CaretUpDown className={cn("w-4 h-4 text-slate-500 transition-transform", isOpen && "text-white")} weight="bold" />
          </button>

          {isOpen && (
            <div
              className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/[0.14] bg-[#0d0d14]/80 backdrop-blur-2xl shadow-2xl shadow-black/60 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
              style={{ boxShadow: "0 18px 44px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)" }}
            >
              <div className="p-2 border-b border-white/[0.06]">
                <div className="relative">
                  <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" weight="bold" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search models..."
                    className="flex w-full rounded-lg border px-3 py-1 text-white transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:border-white/30 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50 pl-8 h-8 text-xs bg-white/[0.08] border-white/[0.12]"
                  />
                </div>
              </div>

              <ScrollArea maxHeight="240px">
                <div className="p-1.5">
                  {filteredModels.length === 0 ? (
                    <div className="py-6 text-center">
                      <MagnifyingGlass className="w-6 h-6 text-slate-600 mx-auto mb-1.5" weight="duotone" />
                      <p className="text-xs text-slate-500">No models match "{search}"</p>
                    </div>
                  ) : (
                    filteredModels.map((model) => {
                      const isSelected = selectedModel === model.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => handleSelect(model.id)}
                          className={cn(
                            "relative overflow-hidden w-full p-2 rounded-lg flex items-center gap-3 transition-all duration-150 group",
                            isSelected
                              ? "bg-white/[0.08] ring-1 ring-white/20"
                              : "hover:bg-white/[0.10]"
                          )}
                        >
                          {isSelected && (
                            <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
                          )}
                          <img
                            src={model.photo1Url}
                            alt={model.name}
                            className={cn(
                              "w-9 h-9 rounded-lg object-cover transition-all",
                              isSelected ? "ring-2 ring-white/30" : "ring-1 ring-white/[0.06] group-hover:ring-white/15"
                            )}
                          />
                          <div className="text-left flex-1 min-w-0">
                            <p className={cn("text-sm font-medium truncate", isSelected ? "text-white" : "text-white")}>
                              {model.name}
                            </p>
                            <p className="text-[11px] flex items-center gap-1 text-slate-500">
                              {model.nsfwUnlocked ? (
                                <><CheckCircle className="w-3 h-3 text-emerald-500" weight="fill" /><span className="text-emerald-500/80">LoRA Ready</span></>
                              ) : (
                                <><Lightning className="w-3 h-3 text-amber-500" weight="fill" /><span className="text-amber-500/80">Needs Training</span></>
                              )}
                            </p>
                          </div>
                          {isSelected && (
                            <CheckCircle className="w-4 h-4 text-white flex-shrink-0" weight="fill" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Training Image Pool - Single flat pool of images
// ============================================
function TrainingImagePool({ modelId, loraId, selectedImages, onToggle, onPreview, maxImages = 15, minImages = 15, allowCustomUpload = false }) {
  const [isUploading, setIsUploading] = useState(false);
  const [customImages, setCustomImages] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryPage, setGalleryPage] = useState(1);
  const galleryPageSize = 60;
  const { data: poolData } = useQuery({
    queryKey: ["/api/nsfw/training-images", "training-pool", modelId, loraId || "none"],
    queryFn: async () => {
      if (!modelId) return { generations: [], trainingImages: [] };
      const trainingUrl = loraId
        ? `/api/nsfw/training-images/${modelId}?loraId=${loraId}`
        : `/api/nsfw/training-images/${modelId}`;

      const trainingRes = await fetch(trainingUrl, { credentials: "include" });
      const trainingData = trainingRes.ok ? await trainingRes.json() : { trainingImages: [], linkedGenerations: [] };

      return {
        generations: trainingData?.linkedGenerations || [],
        trainingImages: trainingData?.trainingImages || [],
      };
    },
    enabled: !!modelId,
    staleTime: 30000,
  });

  const parseOutputUrls = (outputUrl) => {
    if (!outputUrl) return [];
    if (Array.isArray(outputUrl)) return outputUrl.filter(Boolean);
    if (typeof outputUrl !== "string") return [];
    const trimmed = outputUrl.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      // Single URL string
    }
    return [trimmed];
  };

  const isLikelyVideoUrl = (url = "") =>
    typeof url === "string" && /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(url);

  const mapGenerationsToItems = (generations = []) =>
    generations
      .filter((g) => g?.outputUrl)
      .flatMap((g) =>
        parseOutputUrls(g.outputUrl)
          .filter((url) => url && !isLikelyVideoUrl(url))
          .map((url, index) => ({
            id: `${g.id}-${index}`,
            generationId: g.id,
            outputUrl: url,
          }))
      );

  const generationPool = mapGenerationsToItems(poolData?.generations || []);
  const trainingPool = (poolData?.trainingImages || [])
    .filter((img) => img?.status === "completed" && img?.imageUrl)
    .map((img) => ({
      id: `training-${img.id}`,
      customImageId: img.id,
      outputUrl: img.imageUrl,
      _training: true,
    }));
  const seenUrls = new Set();
  const modelImages = [...generationPool, ...trainingPool].filter((item) => {
    if (!item?.outputUrl || seenUrls.has(item.outputUrl)) return false;
    seenUrls.add(item.outputUrl);
    return true;
  });

  const galleryGenerations = mapGenerationsToItems(poolData?.generations || []);
  const galleryTrainingPool = (poolData?.trainingImages || [])
    .filter((img) => img?.status === "completed" && img?.imageUrl)
    .map((img) => ({
      id: `training-${img.id}`,
      customImageId: img.id,
      outputUrl: img.imageUrl,
      _training: true,
    }));
  const gallerySeen = new Set();
  const galleryItems = [...galleryGenerations, ...galleryTrainingPool].filter((item) => {
    if (!item?.outputUrl || gallerySeen.has(item.outputUrl)) return false;
    gallerySeen.add(item.outputUrl);
    return true;
  });
  const galleryTotal = galleryItems.length;
  const galleryTotalPages = Math.max(1, Math.ceil(galleryTotal / galleryPageSize));
  const galleryOffset = (galleryPage - 1) * galleryPageSize;
  const pagedGalleryItems = galleryItems.slice(galleryOffset, galleryOffset + galleryPageSize);
  const isGalleryLoading = false;

  const selected = selectedImages || [];
  const count = selected.length;
  const available = modelImages.filter(g => !selected.some(s => s.id === g.id));

  const handleCustomUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !modelId) return;
    const targetLoraId = loraId;
    if (!targetLoraId) {
      toast.error(copy.toastSelectOrCreateLora);
      return;
    }
    const remaining = maxImages - count;
    if (remaining <= 0) {
      toast.error(copy.toastMaxImagesSelected);
      return;
    }
    const toUpload = files.slice(0, remaining);
    setIsUploading(true);
    try {
      const urls = await Promise.all(toUpload.map((file) => uploadFile(file)));
      const { data } = await api.post(
        "/nsfw/register-training-images",
        { modelId, loraId: targetLoraId, imageUrls: urls },
        { timeout: 120000 },
      );
      if (!data.success || !data.images) {
        toast.error(data.message || "Upload failed");
        return;
      }
      const uploaded = data.images.map((img) => ({ id: img.id, outputUrl: img.imageUrl, _custom: true }));
      const trimmed = data.trimmed || 0;

      if (uploaded.length > 0) {
        setCustomImages((prev) => [...prev, ...uploaded]);
        uploaded.forEach((img) => onToggle(img));
        if (trimmed > 0) {
          toast(`Only ${uploaded.length} of ${toUpload.length} images uploaded (slot limit reached).`, { icon: "⚠️", duration: 6000 });
        } else {
          toast.success(`Uploaded ${uploaded.length} custom image${uploaded.length > 1 ? "s" : ""}`);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Upload failed");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${count >= minImages ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
            <ImageIcon className="w-4 h-4" />
          </div>
          <div>
            <span className="text-sm font-medium text-white">{copy.labelTrainingImages}</span>
            <span className="text-[10px] text-slate-500 ml-2">Different angles, poses & expressions</span>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          count >= minImages 
            ? "bg-emerald-500/15 text-emerald-400" 
            : count > 0 
              ? "bg-amber-500/15 text-amber-400" 
              : "bg-white/5 text-slate-500"
        }`}>
          {count}/{minImages}
        </span>
      </div>

      {selected.length > 0 && (
        <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-1.5 sm:gap-2 mb-3">
          {selected.map((gen, idx) => (
            <div key={gen.id} className="relative aspect-square rounded-xl overflow-hidden ring-2 ring-emerald-500/60 group cursor-pointer">
              <img src={gen.outputUrl} alt={`Training ${idx + 1}`} className="w-full h-full object-cover" />
              <div className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5">
                <Check className="w-2.5 h-2.5 text-white" />
              </div>
              {gen._custom && (
                <div className="absolute top-1 left-1 px-1 py-0.5 rounded bg-white/70 text-[8px] text-white font-medium">
                  Custom
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all flex items-center justify-center gap-2">
                <button
                  onClick={() => onPreview(gen.outputUrl)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-white/20 hover:bg-white/30"
                  data-testid={`preview-training-${idx}`}
                >
                  <Eye className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={() => onToggle(gen)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-red-500/80 hover:bg-red-500"
                  data-testid={`remove-training-${idx}`}
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {allowCustomUpload && count < maxImages && (
        <div className="mb-3 p-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Upload className="w-3.5 h-3.5 text-white/60" />
              <span className="text-xs font-medium text-white/70">Upload Custom Photos</span>
            </div>
            <span className="text-[10px] text-slate-500">{maxImages - count} slots left</span>
          </div>
          <label
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-white/10 text-xs text-slate-300 transition-colors cursor-pointer ${
              isUploading ? "opacity-50 pointer-events-none" : "hover:bg-white/[0.04] hover:text-white"
            }`}
            data-testid="button-upload-custom-training"
          >
            {isUploading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading...</>
            ) : (
              <><Plus className="w-3.5 h-3.5" /> Choose images</>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              multiple
              onChange={handleCustomUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
          <p className="text-[10px] text-slate-500 mt-1.5">Your own photos for higher quality LoRA training</p>
        </div>
      )}

      {modelImages.length === 0 && !allowCustomUpload ? (
        <div className="p-5 rounded-xl text-center bg-white/[0.02] border border-dashed border-white/10">
          <ImageIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">{(NSFW_COPY[resolveLocale()] || NSFW_COPY.en).galleryEmptyModel}</p>
          <p className="text-[10px] text-slate-500 mt-1">Generate images first using the Generate tab</p>
        </div>
      ) : available.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-slate-500">
              {count >= maxImages
                ? `${maxImages} images selected (max reached — deselect one to swap)`
                : `Tap to select (${count < minImages ? `${minImages - count} more needed` : `${maxImages - count} more available`}):`}
            </p>
            <button
              type="button"
              onClick={() => {
                setGalleryPage(1);
                setShowGallery(true);
              }}
              className="text-[10px] text-purple-300 hover:text-purple-200 px-2 py-1 rounded-md border border-purple-500/30 bg-purple-500/10"
              data-testid="button-open-training-gallery"
            >
              Open full gallery
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-1.5 sm:gap-2">
            {available.map((gen) => (
              <button
                key={gen.id}
                onClick={() => {
                  if (count < maxImages) {
                   
                    onToggle(gen);
                  }
                }}
                disabled={count >= maxImages}
                className="relative rounded-xl overflow-hidden transition-all aspect-square hover:ring-2 hover:ring-white/30 disabled:opacity-30 disabled:cursor-not-allowed border border-white/10 hover:border-transparent"
                data-testid={`select-training-pool-${gen.id}`}
              >
                <img src={gen.outputUrl} alt="Gallery" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
      {count >= minImages && count <= maxImages && (
        <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-2">
          <CheckCircle2 className="w-3 h-3" /> {count} images selected - ready to train
        </p>
      )}

      {showGallery && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <p className="text-sm font-semibold text-white">Training Gallery</p>
                <p className="text-[11px] text-slate-400">
                  Select images from your full generation history
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGallery(false)}
                className="p-1.5 rounded-lg hover:bg-white/5 text-slate-300"
                data-testid="button-close-training-gallery"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-3">
              {isGalleryLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {copy.i2iGalleryLoading}
                </div>
              ) : galleryItems.length === 0 ? (
                <p className="text-xs text-slate-400">No gallery images found yet.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {pagedGalleryItems.map((item) => {
                    const isSelected = selected.some((s) => s.id === item.id);
                    const isDisabled = !isSelected && count >= maxImages;
                    return (
                      <button
                        key={`gallery-${item.id}`}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => onToggle(item)}
                        className={`relative aspect-square rounded-lg overflow-hidden border transition-all ${
                          isSelected
                            ? "border-emerald-400 ring-2 ring-emerald-500/60"
                            : "border-white/10 hover:border-white/40"
                        } ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
                        data-testid={`gallery-select-${item.id}`}
                      >
                        <img src={item.outputUrl} alt="Gallery" className="w-full h-full object-cover" />
                        {isSelected && (
                          <span className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5">
                            <Check className="w-2.5 h-2.5 text-white" />
                          </span>
                        )}
                        {item._training && (
                          <span className="absolute bottom-1 left-1 bg-white/70 text-[8px] text-white px-1 rounded">
                            Custom
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
              <span className="text-[11px] text-slate-500">
                {count}/{maxImages} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGalleryPage((p) => Math.max(1, p - 1))}
                  disabled={galleryPage === 1}
                  className="px-2 py-1 text-[10px] rounded border border-white/10 text-slate-300 disabled:opacity-40"
                  data-testid="button-training-gallery-prev"
                >
                  Prev
                </button>
                <span className="text-[10px] text-slate-400">
                  {galleryPage}/{galleryTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setGalleryPage((p) => Math.min(galleryTotalPages, p + 1))}
                  disabled={galleryPage >= galleryTotalPages}
                  className="px-2 py-1 text-[10px] rounded border border-white/10 text-slate-300 disabled:opacity-40"
                  data-testid="button-training-gallery-next"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// LoRA Manager - Create, switch, delete LoRAs
// ============================================
function LoRAManager({
  modelId,
  loras,
  activeLora,
  onCreateLora,
  onSetActive,
  onDeleteLora,
  onSelectLora,
  currentLoraId,
  isLoading,
  onRefreshLoras,
  modelSavedAppearance,
  loraStandardCost = 750,
  loraProCost = 1500,
}) {
  const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newLoraName, setNewLoraName] = useState("");
  const [newLoraAppearance, setNewLoraAppearance] = useState({});
  const [newLoraMode, setNewLoraMode] = useState("standard");
  const [showAppearancePanel, setShowAppearancePanel] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingLoraId, setEditingLoraId] = useState(null);
  const [editAppearance, setEditAppearance] = useState({});
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);

  const appearanceGroups = selectorCategories.find(c => c.id === "appearance")?.groups || [];
  const prevShowCreateInput = useRef(false);

  // Auto-load model's saved looks when user opens "New LoRA" (once per open)
  useEffect(() => {
    const justOpened = showCreateInput && !prevShowCreateInput.current;
    prevShowCreateInput.current = showCreateInput;
    if (!justOpened || !modelSavedAppearance) return;
    let appearance = modelSavedAppearance;
    if (typeof appearance === "string") {
      try {
        appearance = JSON.parse(appearance);
      } catch {
        appearance = {};
      }
    }
    if (appearance && typeof appearance === "object" && Object.keys(appearance).length > 0) {
      setNewLoraAppearance({ ...appearance });
    }
  }, [showCreateInput, modelSavedAppearance]);

  const statusColors = {
    ready: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    training: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    awaiting_images: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    images_ready: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    legacy_flux: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  };

  const statusLabels = {
    ready: "Ready",
    training: "Training...",
    failed: "Failed",
    awaiting_images: "Awaiting Images",
    images_ready: "Images Ready",
    legacy_flux: "Outdated",
  };

  const handleCreate = async () => {
    if (!newLoraName.trim()) {
      toast.error(copy.toastEnterLoraName);
      return;
    }
    setIsCreating(true);
    try {
      const hasAppearance = Object.values(newLoraAppearance).some(Boolean);
      await onCreateLora(newLoraName.trim(), hasAppearance ? newLoraAppearance : null, newLoraMode);
      setNewLoraName("");
      setNewLoraAppearance({});
      setNewLoraMode("standard");
      setShowCreateInput(false);
      setShowAppearancePanel(false);
    } finally {
      setIsCreating(false);
    }
  };

  const toggleAppearanceChip = (key, value) => {
    setNewLoraAppearance(prev =>
      prev[key] === value ? { ...prev, [key]: "" } : { ...prev, [key]: value }
    );
  };

  const toggleEditChip = (key, value) => {
    setEditAppearance(prev =>
      prev[key] === value ? { ...prev, [key]: "" } : { ...prev, [key]: value }
    );
  };

  const handleSaveAppearance = async (loraId) => {
    setIsSavingAppearance(true);
    try {
      const hasAny = Object.values(editAppearance).some(Boolean);
      await api.put(`/nsfw/lora/${loraId}/appearance`, { appearance: hasAny ? editAppearance : null });
      toast.success(copy.loraAppearanceSaved);
      setEditingLoraId(null);
      if (onRefreshLoras) onRefreshLoras();
    } catch (err) {
      toast.error(`${copy.loraSaveFailedPrefix} ${err.response?.data?.message || err.message}`);
    } finally {
      setIsSavingAppearance(false);
    }
  };

  const startEditAppearance = (lora) => {
    if (editingLoraId === lora.id) {
      setEditingLoraId(null);
      return;
    }
    const raw = lora.defaultAppearance;
    let appearance = raw || {};
    if (typeof appearance === 'string') { try { appearance = JSON.parse(appearance); } catch { appearance = {}; } }
    setEditAppearance(appearance);
    setEditingLoraId(lora.id);
  };

  const handleAutoDetect = async (loraId) => {
    setIsAutoDetecting(true);
    try {
      const res = await api.post(`/nsfw/lora/${loraId}/auto-appearance`);
      if (res.data.success && res.data.defaultAppearance) {
        setEditAppearance(res.data.defaultAppearance);
        toast.success(`Detected ${Object.keys(res.data.defaultAppearance).length} features`);
        if (onRefreshLoras) onRefreshLoras();
      } else {
        toast.error(res.data.message || copy.loraDetectCouldNot);
      }
    } catch (err) {
      toast.error(`${copy.loraDetectFailedPrefix} ${err.response?.data?.message || err.message}`);
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const appearanceCount = Object.values(newLoraAppearance).filter(Boolean).length;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
        <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
        <span className="text-xs text-slate-400">{copy.loraLoading}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StackSimple className="w-4 h-4 text-rose-400" weight="duotone" />
          <span className="text-sm font-medium text-white tracking-wide">{copy.loraListTitle}</span>
          <Badge variant="secondary">{loras.length}</Badge>
        </div>
        <button
          onClick={() => setShowCreateInput(!showCreateInput)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.15] text-white text-xs font-medium hover:bg-white/[0.10] transition-colors"
          data-testid="button-create-lora"
        >
          <Plus className="w-3 h-3" />
          {copy.loraNew}
        </button>
      </div>

      {showCreateInput && (
        <div className="mb-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-3">
          <input
            type="text"
            value={newLoraName}
            onChange={(e) => setNewLoraName(e.target.value)}
            placeholder={copy.loraNamePlaceholder}
            className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-white/30"
            data-testid="input-lora-name"
          />

          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">{copy.loraTrainingMode}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewLoraMode("standard")}
                className={`p-2.5 rounded-lg text-left transition-all ${
                  newLoraMode === "standard"
                    ? "bg-white/[0.08] border border-white/25 ring-1 ring-white/15"
                    : "bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.05]"
                }`}
                data-testid="button-mode-standard"
              >
                <div className="flex flex-col gap-0.5 leading-tight">
                  <span className="text-xs font-medium text-white">{copy.loraStandard}</span>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span>15 images, {loraStandardCost}</span>
                    <Coins className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                  </p>
                  <p className="text-[10px] text-slate-500">{copy.loraTime1h}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setNewLoraMode("pro")}
                className={`p-2.5 rounded-lg text-left transition-all relative overflow-visible ${
                  newLoraMode === "pro"
                    ? "bg-rose-500/10 border border-rose-400/30 ring-1 ring-rose-400/20"
                    : "bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.05]"
                }`}
                data-testid="button-mode-pro"
              >
                <div className="flex flex-col gap-0.5 leading-tight">
                  <span className="text-xs font-medium text-rose-300 flex items-center gap-1">
                    <Flame className="w-3 h-3" />
                    Pro
                  </span>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span>30 curated images, {loraProCost}</span>
                    <Coins className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                  </p>
                  <p className="text-[10px] text-slate-500">{copy.loraTime2h}</p>
                </div>
              </button>
            </div>
          </div>

          <div>
            <button
              onClick={() => setShowAppearancePanel(!showAppearancePanel)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.06] transition-colors"
              data-testid="button-toggle-appearance"
            >
              <span className="flex items-center gap-2 text-xs text-slate-300">
                <User className="w-3.5 h-3.5" />
                {copy.loraDefaultAppearance}
                {appearanceCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-white/[0.08] border border-white/[0.15] text-white text-[10px]">{appearanceCount}</span>
                )}
              </span>
              <ChevronRight className={`w-3.5 h-3.5 text-slate-500 transition-transform ${showAppearancePanel ? "rotate-90" : ""}`} />
            </button>

            {showAppearancePanel && (
              <div className="mt-2 space-y-2.5 pl-1 max-h-[40vh] overflow-y-auto">
                <p className="text-[10px] text-slate-500">{copy.loraAppearanceHint}</p>
                {appearanceGroups.map(g => {
                  const value = newLoraAppearance[g.key] || "";
                  const isCustom = value && !g.options.includes(value);
                  return (
                    <div key={g.key}>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">{g.label}</p>
                      <div className="flex flex-wrap gap-1">
                        {g.options.map(opt => {
                          const isActive = value === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setNewLoraAppearance(prev => ({ ...prev, [g.key]: isActive ? "" : opt }))}
                              className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                                isActive
                                  ? "bg-white border border-white/35 text-black"
                                  : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                              }`}
                              data-testid={`chip-appearance-${g.key}-${opt.replace(/\s+/g, '-')}`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setNewLoraAppearance(prev => ({ ...prev, [g.key]: isCustom ? "" : " " }))}
                          className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                            isCustom ? "bg-white border border-white/35 text-black" : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                          }`}
                        >
                          {copy.custom}
                        </button>
                      </div>
                      {(isCustom || value === " ") && (
                        <input
                          type="text"
                          value={value === " " ? "" : value}
                          onChange={(e) => setNewLoraAppearance(prev => ({ ...prev, [g.key]: e.target.value }))}
                          placeholder={copy.customTypePlaceholder}
                          className="mt-1 w-full px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-[10px] placeholder-slate-500 focus:outline-none focus:border-rose-500/50"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={handleCreate}
            disabled={isCreating || !newLoraName.trim()}
            className="w-full py-2 rounded-lg bg-white/[0.08] border border-white/[0.15] text-white text-xs font-medium hover:bg-white/[0.12] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            data-testid="button-confirm-create-lora"
          >
            {isCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            {copy.loraCreateAction}
          </button>
        </div>
      )}

      {loras.length === 0 ? (
        <div className="p-4 rounded-xl text-center bg-white/[0.02] border border-dashed border-white/10">
          <Layers className="w-6 h-6 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">{copy.loraEmptyTitle}</p>
          <p className="text-[10px] text-slate-500 mt-1">{copy.loraEmptyBody}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {loras.map((lora) => {
            const isLegacy = lora.status === "legacy_flux";
            const isActive = !isLegacy && activeLora === lora.id;
            const isSelected = !isLegacy && currentLoraId === lora.id;
            const canSelect = !isLegacy && ['awaiting_images', 'images_ready'].includes(lora.status);
            const isReady = lora.status === 'ready';
            const isClickable = !isLegacy && (canSelect || isReady);
            const statusColor = statusColors[lora.status] || statusColors.awaiting_images;
            const statusLabel = statusLabels[lora.status] || lora.status;

            return (
              <div
                key={lora.id}
                onClick={() => {
                  if (canSelect) onSelectLora?.(lora.id);
                  else if (isReady) startEditAppearance(lora);
                }}
                className={`p-3 rounded-xl border transition-all ${
                  isLegacy
                    ? "border-orange-500/20 bg-orange-500/5 opacity-60"
                    : editingLoraId === lora.id
                    ? "border-white/35 bg-white/10 ring-1 ring-white/25"
                    : isSelected
                    ? "border-white/25 bg-white/[0.06] ring-1 ring-white/15"
                    : isActive
                    ? "border-emerald-500/40 bg-emerald-500/5 ring-1 ring-emerald-500/20"
                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
                } ${isClickable ? "cursor-pointer" : ""}`}
                data-testid={`lora-card-${lora.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium truncate ${isLegacy ? "text-slate-400 line-through" : "text-white"}`}>{lora.name || `LoRA ${lora.id.slice(0, 6)}`}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${statusColor}`}>
                          {statusLabel}
                        </span>
                        {lora.trainingMode === "pro" && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-rose-400/30 bg-rose-500/15 text-rose-300 gap-0.5">
                            <Flame className="w-2.5 h-2.5" />Pro
                          </span>
                        )}
                        {isActive && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">{copy.loraStatusActive}</span>
                        )}
                        {isSelected && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border border-white/20 bg-white/[0.08] text-white">{copy.loraStatusSettingUp}</span>
                        )}
                      </div>
                      {isLegacy && (
                        <span className="text-[10px] text-orange-400/80 mt-0.5">
                          {copy.loraLegacyHint}
                        </span>
                      )}
                      {!isLegacy && lora.trainedAt && (
                        <span className="text-[10px] text-slate-500 mt-0.5">
                          {copy.loraTrainedOn} {new Date(lora.trainedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {lora.status === "ready" && !isActive && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onSetActive(lora.id); }}
                        className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/25 transition-colors"
                        data-testid={`button-set-active-${lora.id}`}
                      >
                        {copy.loraSetActive}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditAppearance(lora); }}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all",
                        editingLoraId === lora.id
                          ? "bg-white text-black border border-white/35"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <PencilSimple className="w-3 h-3" weight="bold" />
                      {lora.defaultAppearance ? copy.loraEditLook : copy.loraSetLook}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteLora(lora.id); }}
                      disabled={lora.status === "training"}
                      title={lora.status === "training" ? "Cannot delete while training is in progress" : "Delete LoRA"}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-slate-500 disabled:hover:bg-transparent"
                      data-testid={`button-delete-lora-${lora.id}`}
                    >
                      <Trash className="w-3.5 h-3.5" weight="bold" />
                    </button>
                  </div>
                </div>

                {editingLoraId === lora.id && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-slate-500">Set this LoRA's base appearance — used for img2img prompt injection</p>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAutoDetect(lora.id); }}
                        disabled={isAutoDetecting}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-white/35 text-[10px] font-medium text-black hover:bg-white/90 transition-all disabled:opacity-50"
                      >
                        {isAutoDetecting ? <ArrowsClockwise className="w-3 h-3 animate-spin" weight="bold" /> : <Sparkle className="w-3 h-3" weight="fill" />}
                        {isAutoDetecting ? copy.loraDetecting : copy.loraAutoDetect}
                      </button>
                    </div>
                    {appearanceGroups.map(g => (
                      <div key={g.key}>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">{g.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {g.options.map(opt => {
                            const isActive = editAppearance[g.key] === opt;
                            return (
                              <button
                                key={opt}
                                onClick={(e) => { e.stopPropagation(); toggleEditChip(g.key, opt); }}
                                className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
                                  isActive
                                    ? "bg-white border border-white/35 text-black"
                                    : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSaveAppearance(lora.id); }}
                      disabled={isSavingAppearance}
                      className="w-full py-1.5 rounded-lg bg-white border border-white/35 text-black text-xs font-medium hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {isSavingAppearance ? <ArrowsClockwise className="w-3 h-3 animate-spin" weight="bold" /> : <FloppyDisk className="w-3 h-3" weight="bold" />}
                      Save Appearance
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// Main NSFW Page Component
// ============================================
export default function NSFWPage({ embedded = false, sidebarCollapsed = false, setDashboardTab }) {
  const copy = NSFW_COPY[resolveLocale()] || NSFW_COPY.en;
  const navigate = useNavigate();
  const { user, refreshUserCredits, logout } = useAuthStore();
  const {
    models,
    isLoading: modelsLoading,
    isError: modelsLoadError,
    refetch: refetchModels,
  } = useCachedModels();
  
  const { draft: nsfwDraft, isLoading: nsfwDraftLoading, saveDraft: saveNsfwDraft, clearDraft: clearNsfwDraft } = useDraft("nsfw");
  const nsfwDraftRestoredRef = useRef(false);
  const nsfwInitialLoadDoneRef = useRef(false);
  const presetSelectionInProgressRef = useRef(false);
  const modelLooksLockedRef = useRef({});

  // Sidebar state
  const [showAddCredits, setShowAddCredits] = useState(false);
  const [showEarnModal, setShowEarnModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [standaloneSidebarCollapsed, setStandaloneSidebarCollapsed] = useState(true);
  const [standaloneSidebarPinned, setStandaloneSidebarPinned] = useState(() => {
    try {
      return localStorage.getItem(NSFW_SIDEBAR_PINNED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [standaloneSidebarHovered, setStandaloneSidebarHovered] = useState(false);
  const standaloneNarrow = standaloneSidebarCollapsed && !standaloneSidebarHovered;
  const layoutSidebarNarrow = embedded ? sidebarCollapsed : standaloneNarrow;

  useEffect(() => {
    if (embedded) return;
    try {
      localStorage.setItem(NSFW_SIDEBAR_PINNED_KEY, String(standaloneSidebarPinned));
    } catch {
      // Ignore storage failures.
    }
    if (standaloneSidebarPinned) {
      setStandaloneSidebarCollapsed(false);
      setStandaloneSidebarHovered(false);
    }
  }, [embedded, standaloneSidebarPinned]);
  
  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  // State
  const [selectedModel, setSelectedModel] = useState(null);
  const { byKey } = useTutorialCatalog();
  const [activePhase, setActivePhase] = useState("training"); // "training", "generate", or "video"
  const hasAutoSwitchedPhaseRef = useRef(false);
  const [videoSelectedImage, setVideoSelectedImage] = useState(null);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoDuration, setVideoDuration] = useState(5);
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false);
  const [trainingImages, setTrainingImages] = useState([]);
  const [trainingSelections, setTrainingSelections] = useState([]);
  const [modelLoras, setModelLoras] = useState([]);
  const [activeLora, setActiveLora] = useState(null);
  const [currentLoraId, setCurrentLoraId] = useState(null);
  const [isLoadingLoras, setIsLoadingLoras] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isAssigningImages, setIsAssigningImages] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  // NSFW Generation state
  const [sceneDescription, setSceneDescription] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [isGeneratingNsfw, setIsGeneratingNsfw] = useState(false);
  const [nudesPackModalOpen, setNudesPackModalOpen] = useState(false);
  const [isSubmittingNudesPack, setIsSubmittingNudesPack] = useState(false);
  const [nudesPackPoses, setNudesPackPoses] = useState(NUDES_PACK_POSES);
  const [nudesPackPricing, setNudesPackPricing] = useState(null);
  const [generatedNsfwImages, setGeneratedNsfwImages] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [imageQuantity, setImageQuantity] = useState(1);
  const { data: generationPricingData } = useQuery({
    queryKey: ["generation-pricing-nsfw-page"],
    queryFn: () => pricingAPI.getGeneration(),
    staleTime: 60_000,
  });
  const generationPricing = generationPricingData?.pricing || {};
  const nsfwImageBaseCost = Number.isFinite(Number(generationPricing.imagePromptNsfw))
    ? Number(generationPricing.imagePromptNsfw)
    : 30;
  const faceSwapExtraCost = Number.isFinite(Number(generationPricing.imageFaceSwap))
    ? Number(generationPricing.imageFaceSwap)
    : 10;
  const nsfwFaceSwapCost = nsfwImageBaseCost + faceSwapExtraCost;
  const loraStandardCost = Number.isFinite(Number(generationPricing.loraTrainingStandard))
    ? Number(generationPricing.loraTrainingStandard)
    : 750;
  const loraProCost = Number.isFinite(Number(generationPricing.loraTrainingPro))
    ? Number(generationPricing.loraTrainingPro)
    : 1500;
  const nsfwVideoMinCost = Number.isFinite(Number(generationPricing.videoPrompt5s))
    ? Number(generationPricing.videoPrompt5s)
    : 50;
  const nsfwVideoMaxCost = Number.isFinite(Number(generationPricing.videoPrompt10s))
    ? Number(generationPricing.videoPrompt10s)
    : 80;

  // AI Prompt generation state
  const [isGeneratingAiPrompt, setIsGeneratingAiPrompt] = useState(false);

  useEffect(() => {
    api.get("/nsfw/nudes-pack-poses")
      .then((r) => {
        const poses = Array.isArray(r.data?.poses) ? r.data.poses : [];
        if (poses.length > 0) setNudesPackPoses(poses);
        const min = r.data?.nudesPackCreditsMin;
        const max = r.data?.nudesPackCreditsMax;
        if (min != null || max != null) {
          setNudesPackPricing({
            nudesPackCreditsMin: Number(min),
            nudesPackCreditsMax: Number(max),
          });
        }
      })
      .catch(() => {});
  }, []);

  // Aspect Ratio state (Quick flow defaults to selfie 1024x1024)
  const [selectedAspectRatio, setSelectedAspectRatio] = useState("1024x1024");
  /** simple = preset/text → one-shot plan → resolution + generate; advanced = full chip + prompt flow; custom = user prompt only */
  const [nsfwGenerateMode, setNsfwGenerateMode] = useState("simple");
  const [customPrompt, setCustomPrompt] = useState("");
  const [simplePlanReady, setSimplePlanReady] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);

  // Chip selector state
  const [chipSelections, setChipSelections] = useState({});
  const [openCategory, setOpenCategory] = useState("appearance");
  const [hasSavedAppearance, setHasSavedAppearance] = useState(false);
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);

  const activeLoraObj = modelLoras.find(l => l.id === activeLora);
  const lockedAppearance = (() => {
    const raw = activeLoraObj?.defaultAppearance;
    if (!raw) return {};
    if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
    return raw;
  })();

  // Seed looks chips from model's savedAppearance when we have it (instant load from list/detail)
  const appearanceGroupKeys = (selectorCategories.find(c => c.id === "appearance")?.groups || []).map(g => g.key);
  useEffect(() => {
    if (!selectedModel || !models.length) return;
    if (presetSelectionInProgressRef.current) return;
    const modelData = models.find(m => m.id === selectedModel);
    const saved = modelData?.savedAppearance;
    if (!saved || typeof saved !== "object") return;
    let normalized = saved;
    if (typeof saved === "string") {
      try { normalized = JSON.parse(saved); } catch { return; }
    }
    modelLooksLockedRef.current = { ...normalized };
    setChipSelections(prev => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(normalized)) {
        if (v != null && String(v).trim() !== "") next[k] = v;
      }
      return next;
    });
  }, [selectedModel, models]);

  useEffect(() => {
    if (selectedModel) {
      api.get(`/nsfw/appearance/${selectedModel}`)
        .then(res => {
          if (presetSelectionInProgressRef.current) return;
          if (res.data?.success && res.data.savedAppearance) {
            setHasSavedAppearance(true);
            const saved = res.data.savedAppearance;
            modelLooksLockedRef.current = typeof saved === "object" && saved !== null ? { ...saved } : {};
            setChipSelections(prev => {
              const updated = { ...prev };
              for (const [key, value] of Object.entries(saved)) {
                if (value) updated[key] = value;
              }
              return updated;
            });
          } else {
            setHasSavedAppearance(false);
            modelLooksLockedRef.current = {};
          }
        })
        .catch(() => {
          setHasSavedAppearance(false);
          modelLooksLockedRef.current = {};
        });
    }
  }, [selectedModel]);

  useEffect(() => {
    if (presetSelectionInProgressRef.current) return;
    if (lockedAppearance && Object.keys(lockedAppearance).length > 0) {
      setChipSelections(prev => {
        const updated = { ...prev };
        for (const [key, value] of Object.entries(lockedAppearance)) {
          if (value) updated[key] = value;
        }
        return updated;
      });
    }
  }, [activeLora, modelLoras.length]);

  const handleSaveAppearance = async () => {
    if (!selectedModel) return;
    // Save all appearance keys from chip groups (single source of truth, same as Models page)
    const appearance = {};
    for (const key of appearanceGroupKeys) {
      const v = chipSelections[key];
      if (v != null && String(v).trim() !== "") appearance[key] = v;
    }
    setIsSavingAppearance(true);
    try {
      const res = await api.post("/nsfw/appearance/save", { modelId: selectedModel, appearance });
      if (res.data?.success) {
        setHasSavedAppearance(Object.keys(appearance).length > 0);
        toast.success(copy.toastAppearanceSaved);
      }
    } catch (err) {
      toast.error(copy.toastFailedSaveAppearance);
    }
    setIsSavingAppearance(false);
  };

  const toggleChip = (key, value) => {
    setChipSelections((prev) => {
      const next = prev[key] === value ? { ...prev, [key]: "" } : { ...prev, [key]: value };
      return applyChipConstraints(next, lockedAppearance);
    });
    setGeneratedPrompt("");
  };

  const blockedChips = getBlockedChips(chipSelections);
  const chipCount = Object.values(chipSelections).filter(Boolean).length;

  // Legacy compat
  const nsfwAttributes = chipSelections;

  // Skip face swap toggle (generate raw LoRA output without face swap)
  const [skipFaceSwap, setSkipFaceSwap] = useState(true);
  
  // Selected face swap image from gallery (SECURITY: only gallery images allowed)
  const [faceSwapImage, setFaceSwapImage] = useState(null);

  const GENERATION_CONFIG_KEY = "nsfw_generation_config";
  const DEFAULT_CONFIG = {
    loraStrength: 0.65,
    blurEnabled: true,
    blurStrength: 0.3,
    grainEnabled: true,
    grainStrength: 0.06,
  };

  const loadSavedConfig = () => {
    try {
      const saved = localStorage.getItem(GENERATION_CONFIG_KEY);
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_CONFIG;
  };

  const [genConfig, setGenConfig] = useState(loadSavedConfig);
  /** Admin-only: test RunPod base KSampler steps/CFG (honored server-side only for role admin) */
  const [adminSamplerTest, setAdminSamplerTest] = useState({
    enabled: false,
    steps: 50,
    cfg: 3,
  });
  const [showGenSettings, setShowGenSettings] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const POST_PROCESSING_PRESETS = [
    { id: "balanced", label: "Balanced", blurEnabled: true, blurStrength: 0.3, grainEnabled: true, grainStrength: 0.06 },
    { id: "soft", label: "Soft Blur", blurEnabled: true, blurStrength: 0.55, grainEnabled: false, grainStrength: 0.06 },
    { id: "film", label: "Film Grain", blurEnabled: false, blurStrength: 0.3, grainEnabled: true, grainStrength: 0.45 },
    { id: "off", label: "Raw", blurEnabled: false, blurStrength: 0.3, grainEnabled: false, grainStrength: 0.06 },
  ];

  const getActivePostPreset = () => {
    const bOn = genConfig.blurEnabled !== false;
    const gOn = genConfig.grainEnabled !== false;
    const b = Number(genConfig.blurStrength ?? 0.3);
    const g = Number(genConfig.grainStrength ?? 0.06);
    return (
      POST_PROCESSING_PRESETS.find((p) =>
        p.blurEnabled === bOn &&
        p.grainEnabled === gOn &&
        Math.abs(p.blurStrength - b) < 0.001 &&
        Math.abs(p.grainStrength - g) < 0.001
      )?.id || null
    );
  };

  const applyPostPreset = (preset) => {
    setGenConfig((prev) => ({
      ...prev,
      blurEnabled: preset.blurEnabled,
      blurStrength: preset.blurStrength,
      grainEnabled: preset.grainEnabled,
      grainStrength: preset.grainStrength,
    }));
  };

  const handleSaveConfig = () => {
    try {
      localStorage.setItem(GENERATION_CONFIG_KEY, JSON.stringify(genConfig));
      setConfigSaved(true);
      toast.success(copy.toastSettingsSaved);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (e) {
      toast.error(copy.toastFailedSaveSettings);
    }
  };

  const handleResetConfig = () => {
    setGenConfig(DEFAULT_CONFIG);
    localStorage.removeItem(GENERATION_CONFIG_KEY);
    toast.success(copy.toastSettingsReset);
  };

  useEffect(() => {
    if (nsfwDraftLoading || nsfwDraftRestoredRef.current || presetSelectionInProgressRef.current) {
      if (!nsfwDraftLoading) {
        nsfwDraftRestoredRef.current = true;
        setTimeout(() => { nsfwInitialLoadDoneRef.current = true; }, 0);
      }
      return;
    }
    nsfwDraftRestoredRef.current = true;
    if (!nsfwDraft?.data) {
      setTimeout(() => { nsfwInitialLoadDoneRef.current = true; }, 0);
      return;
    }
    const d = nsfwDraft.data;
    if (d.selectedModel) setSelectedModel(d.selectedModel);
    if (d.sceneDescription) setSceneDescription(d.sceneDescription);
    if (d.chipSelections && typeof d.chipSelections === "object") setChipSelections(d.chipSelections);
    if (d.selectedPreset) setSelectedPreset(d.selectedPreset);
    if (d.selectedAspectRatio) setSelectedAspectRatio(d.selectedAspectRatio);
    if (d.nsfwGenerateMode === "simple" || d.nsfwGenerateMode === "advanced" || d.nsfwGenerateMode === "custom") {
      setNsfwGenerateMode(d.nsfwGenerateMode);
    }
    if (d.simplePlanReady !== undefined) setSimplePlanReady(!!d.simplePlanReady);
    if (d.generatedPrompt !== undefined) setGeneratedPrompt(d.generatedPrompt);
    if (d.customPrompt !== undefined && typeof d.customPrompt === "string") setCustomPrompt(d.customPrompt);
    if (d.skipFaceSwap !== undefined) setSkipFaceSwap(d.skipFaceSwap);
    if (d.faceSwapImage) setFaceSwapImage(d.faceSwapImage);
    if (d.genConfig && typeof d.genConfig === "object") setGenConfig(prev => ({ ...prev, ...d.genConfig }));
    if (d.adminSamplerTest && typeof d.adminSamplerTest === "object") {
      setAdminSamplerTest((prev) => ({ ...prev, ...d.adminSamplerTest }));
    }
    if (d.activePhase) setActivePhase(d.activePhase);
    if (d.currentLoraId) setCurrentLoraId(d.currentLoraId);
    if (Array.isArray(d.trainingSelections) && d.trainingSelections.length > 0) {
      setTrainingSelections(d.trainingSelections);
    }
    setTimeout(() => { nsfwInitialLoadDoneRef.current = true; }, 0);
  }, [nsfwDraftLoading, nsfwDraft]);

  useEffect(() => {
    if (!nsfwInitialLoadDoneRef.current) return;
    const data = {
      selectedModel,
      sceneDescription,
      chipSelections,
      selectedPreset,
      selectedAspectRatio,
      nsfwGenerateMode,
      simplePlanReady,
      generatedPrompt,
      customPrompt,
      skipFaceSwap,
      faceSwapImage,
      genConfig,
      adminSamplerTest,
      activePhase,
      currentLoraId,
      trainingSelections: trainingSelections.map(s => ({ id: s.id, outputUrl: s.outputUrl, _custom: s._custom || false })),
    };
    const imageUrls = [faceSwapImage?.url].filter(Boolean);
    saveNsfwDraft(data, imageUrls);
  }, [selectedModel, sceneDescription, chipSelections, selectedPreset, selectedAspectRatio, nsfwGenerateMode, simplePlanReady, generatedPrompt, customPrompt, skipFaceSwap, faceSwapImage, genConfig, adminSamplerTest, activePhase, currentLoraId, trainingSelections]);

  // Ref to track if component is mounted
  const isMountedRef = useRef(true);
  const lastTrainingStatusRef = useRef({});
  const checkTrainingStatusRef = useRef(null);

  const showTrainingCompletedToast = () => {
    toast.custom(
      () => (
        <div
          className="rounded-xl px-4 py-3 text-white"
          style={{
            background:
              "linear-gradient(180deg, rgba(22,22,30,0.9) 0%, rgba(14,14,22,0.92) 100%)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow:
              "0 16px 38px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5 text-rose-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">LoRA training completed</p>
              <p className="text-[11px] text-slate-300">Your model is ready for NSFW generation.</p>
            </div>
          </div>
        </div>
      ),
      { duration: 4200, position: "top-right" },
    );
  };

  // Get selected model data
  const selectedModelData = models.find((m) => m.id === selectedModel);
  const nsfwSlotByPhase = {
    training: "nsfw.training",
    generate: "nsfw.generate",
    video: "nsfw.video",
    img2img: "nsfw.img2img",
  };
  const activeNsfwTutorialUrl = byKey?.[nsfwSlotByPhase[activePhase]]?.url || null;
  const hasNsfwAccess = models.some((m) => m.isAIGenerated === true || m.nsfwOverride === true || m.nsfwUnlocked === true);
  const isLoraReady = selectedModelData?.nsfwUnlocked === true || 
    modelLoras.some(l => l.status === 'ready');

  // Auto-select first verified model (AI-generated or nsfwOverride approved)
  useEffect(() => {
    const aiModels = models.filter((m) => m.status !== "processing" && (m.isAIGenerated === true || m.nsfwOverride === true || m.nsfwUnlocked === true));
    if (aiModels.length > 0 && !selectedModel) {
      setSelectedModel(aiModels[0].id);
    }
  }, [models, selectedModel]);

  const prevSelectedModelRef = useRef(null);

  useEffect(() => {
    if (!selectedModel) {
      setIsLoadingStatus(false);
      return;
    }
    loadModelLoras();
    loadTrainingImages();

    const cachedStatus = getTrainingState(selectedModel);
    if (cachedStatus === "training") {
      setTrainingStatus("training");
      setIsLoadingStatus(false);
    }

    checkTrainingStatus();
    
    const isModelSwitch = prevSelectedModelRef.current !== null && prevSelectedModelRef.current !== selectedModel;
    if (isModelSwitch) {
      setTrainingSelections([]);
      setCurrentLoraId(null);
    }
    prevSelectedModelRef.current = selectedModel;
  }, [selectedModel, models]);

  // Poll training status while in progress (no hard timeout)
  useEffect(() => {
    let interval;

    if (trainingStatus === "training" && selectedModel) {
      // Save to localStorage so state persists across page refresh
      saveTrainingState(selectedModel, "training");

      interval = setInterval(() => {
        checkTrainingStatusRef.current?.();
      }, 60000); // Check every 60 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [trainingStatus, selectedModel]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load LoRAs for the selected model
  const loadModelLoras = async () => {
    if (!selectedModel) return;
    setIsLoadingLoras(true);
    try {
      const response = await api.get(`/nsfw/loras/${selectedModel}`);
      if (response.data.success) {
        setModelLoras(response.data.loras || []);
        setActiveLora(response.data.activeLoraId || null);
        const pendingLora = (response.data.loras || []).find(l => 
          ['awaiting_images', 'images_ready', 'training'].includes(l.status)
        );
        if (pendingLora) {
          setCurrentLoraId(pendingLora.id);
        }
      }
    } catch (error) {
      console.error("Failed to load loras:", error);
    } finally {
      setIsLoadingLoras(false);
    }
  };

  // Auto-switch to "generate" tab once the active LoRA for the selected model is ready
  useEffect(() => {
    if (hasAutoSwitchedPhaseRef.current) return;
    if (!activeLora || !modelLoras.length) return;
    const loraObj = modelLoras.find(l => l.id === activeLora);
    if (loraObj?.status === 'ready') {
      hasAutoSwitchedPhaseRef.current = true;
      setActivePhase('generate');
    }
  }, [activeLora, modelLoras]);

  // Create a new LoRA
  const handleCreateLora = async (name, defaultAppearance, trainingMode) => {
    try {
      const response = await api.post("/nsfw/lora/create", { modelId: selectedModel, name, defaultAppearance, trainingMode });
      if (response.data.success) {
        toast.success(`LoRA "${response.data.lora.name}" created!`);
        setCurrentLoraId(response.data.lora.id);
        await loadModelLoras();
        return response.data.lora;
      }
      toast.error(response.data.message || "Failed to create LoRA");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to create LoRA");
    }
  };

  // Set active LoRA
  const handleSetActiveLora = async (loraId) => {
    try {
      const response = await api.post("/nsfw/lora/set-active", { modelId: selectedModel, loraId });
      if (response.data.success) {
        toast.success(copy.toastActiveLoraUpdated);
        setActiveLora(loraId);
        await loadModelLoras();
        refetchModels();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to set active LoRA");
    }
  };

  // Delete a LoRA
  const handleDeleteLora = async (loraId) => {
    if (!confirm("Are you sure you want to delete this LoRA? This cannot be undone.")) return;
    try {
      const response = await api.delete(`/nsfw/lora/${loraId}`);
      if (response.data.success) {
        toast.success(copy.toastLoraDeleted);
        await loadModelLoras();
        refetchModels();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to delete LoRA");
    }
  };

  // Load training images from API
  const loadTrainingImages = async () => {
    if (!selectedModel) return;
    try {
      const loraId = currentLoraId;
      const url = loraId 
        ? `/nsfw/training-images/${selectedModel}?loraId=${loraId}`
        : `/nsfw/training-images/${selectedModel}`;
      const response = await api.get(url);
      if (response.data.success && isMountedRef.current) {
        setTrainingImages(response.data.trainingImages || []);
      }
    } catch (error) {
      console.error("Failed to load training images:", error);
    }
  };

  // Check training status
  const checkTrainingStatus = async () => {
    if (!selectedModel) return;

    try {
      const loraId = currentLoraId;
      const url = loraId
        ? `/nsfw/training-status/${selectedModel}?loraId=${loraId}`
        : `/nsfw/training-status/${selectedModel}`;
      const response = await api.get(url);
      if (response.data.success && isMountedRef.current) {
        const newStatus = response.data.status;
        const previousStatus = lastTrainingStatusRef.current[selectedModel];
        const hadTrainingState =
          previousStatus === "training" ||
          getTrainingState(selectedModel) === "training";
        lastTrainingStatusRef.current[selectedModel] = newStatus;
        setTrainingStatus(newStatus);
        setIsLoadingStatus(false);

        if (newStatus === "training") {
          saveTrainingState(selectedModel, "training");
        } else if (
          newStatus === "ready" ||
          newStatus === "failed" ||
          newStatus === "partial_failure" ||
          newStatus === "images_ready"
        ) {
          clearTrainingState(selectedModel);

          if (newStatus === "ready") {
            refetchModels();
            await loadModelLoras();
            if (hadTrainingState) {
              showTrainingCompletedToast();
            }
          } else if (newStatus === "images_ready") {
            refetchModels();
          }
        }
      }
    } catch (error) {
      console.error("Failed to check training status:", error);
      if (isMountedRef.current) {
        setIsLoadingStatus(false);
      }
    }
  };
  // Keep the ref up-to-date so the polling interval always calls the latest version
  checkTrainingStatusRef.current = checkTrainingStatus;

  // Toggle image selection for training
  const selectedLoraForTraining = currentLoraId ? modelLoras.find(l => l.id === currentLoraId) : null;
  const isProTraining = selectedLoraForTraining?.trainingMode === "pro";
  const requiredTrainingImages = isProTraining ? 30 : 15;
  const maxTrainingImages = isProTraining ? 30 : 15;
  const trainingCreditCost = isProTraining ? loraProCost : loraStandardCost;

  const handleToggleTrainingImage = (gen) => {
    setTrainingSelections(prev => {
      const exists = prev.some(s => s.id === gen.id);
      if (exists) {
        return prev.filter(s => s.id !== gen.id);
      }
      if (prev.length >= maxTrainingImages) return prev;
      return [...prev, gen];
    });
  };

  // Assign selected images and start LoRA training
  const handleAssignAndTrain = async () => {
    if (!selectedModel) return;
    
    const totalSelected = trainingSelections.length;
    if (totalSelected < requiredTrainingImages) {
      toast.error(`Select at least ${requiredTrainingImages} images. Currently have ${totalSelected}.`);
      return;
    }
    if (totalSelected > maxTrainingImages) {
      toast.error(`Maximum ${maxTrainingImages} images allowed. Currently have ${totalSelected}.`);
      return;
    }

    const loraId = currentLoraId;
    if (!loraId) {
      toast.error(copy.trainingNeedNewLora);
      return;
    }

    setIsAssigningImages(true);
    try {
      const images = trainingSelections.map((gen) => {
        if (gen._custom || gen._training || gen.customImageId) {
          return {
            customImageId: gen.customImageId || gen.id,
            imageUrl: gen.outputUrl,
          };
        }
        return {
          generationId: gen.generationId || gen.id,
        };
      });

      const assignResponse = await api.post("/nsfw/assign-training-images", {
        modelId: selectedModel,
        loraId,
        images,
      });

      if (!assignResponse.data.success) {
        toast.error(assignResponse.data.message || "Failed to assign images");
        setIsAssigningImages(false);
        return;
      }

      toast.success(copy.toastImagesAssignedTraining);

      // Lock UI immediately before long-running preprocessing on backend
      // (captioning + ZIP creation) to prevent accidental resubmits.
      setTrainingStatus("training");
      saveTrainingState(selectedModel, "training");

      const trainResponse = await api.post("/nsfw/train-lora", {
        modelId: selectedModel,
        loraId,
      });

      if (trainResponse.data.success) {
        const lora = modelLoras.find((l) => l.id === loraId);
        const isPro = lora?.trainingMode === "pro";
        toast.success(isPro ? "LoRA training started! Pro LoRA takes about 2 hours to finish." : "LoRA training started! Basic LoRA takes about 1 hour to finish.");
        setTrainingStatus("training");
        setTrainingSelections([]);
        saveTrainingState(selectedModel, "training");
        refreshUserCredits();
        refetchModels();
        await loadModelLoras();
      } else {
        // Backend failed before job start — unlock UI and clear optimistic lock.
        clearTrainingState(selectedModel);
        await checkTrainingStatus();
        toast.error(trainResponse.data.message || copy.loraToastFailed);
      }
    } catch (error) {
      clearTrainingState(selectedModel);
      await checkTrainingStatus();
      console.error("Assign and train error:", error);
      toast.error(error.response?.data?.message || copy.loraToastFailed);
    } finally {
      setIsAssigningImages(false);
    }
  };

  // Start LoRA training
  const handleStartTraining = async () => {
    if (!selectedModel) return;
    let loraId = currentLoraId;
    if (!loraId) {
      toast.error(copy.toastNoLoraSelectedTraining);
      return;
    }

    setIsTraining(true);
    // Immediate optimistic lock for long preprocessing stage on backend.
    setTrainingStatus("training");
    saveTrainingState(selectedModel, "training");

    try {
      const response = await api.post("/nsfw/train-lora", {
        modelId: selectedModel,
        loraId,
      });

      if (response.data.success) {
        const lora = modelLoras.find((l) => l.id === loraId);
        const isPro = lora?.trainingMode === "pro";
        toast.success(isPro ? "LoRA training started! Pro LoRA takes about 2 hours to finish." : "LoRA training started! Basic LoRA takes about 1 hour to finish.");
        setTrainingStatus("training");
        // Save to localStorage immediately
        saveTrainingState(selectedModel, "training");
        refreshUserCredits();
      } else {
        clearTrainingState(selectedModel);
        await checkTrainingStatus();
        toast.error(response.data.message || copy.loraToastFailed);
      }
    } catch (error) {
      clearTrainingState(selectedModel);
      await checkTrainingStatus();
      console.error("Start training error:", error);
      toast.error(error.response?.data?.message || copy.loraToastFailed);
    } finally {
      setIsTraining(false);
    }
  };

  /** Simple flow: one API call → AI chips + prompt, then user picks resolution only */
  const handleConfirmSimplePlan = async () => {
    const desc = sceneDescription.trim();
    if (!desc) {
      toast.error(copy.toastDescribeSceneFirst);
      return;
    }
    if (!selectedModel) {
      toast.error(copy.toastSelectModel);
      return;
    }
    setIsPlanning(true);
    const POLL_MS = 2500;
    const MAX_POLLS = 100;
    try {
      const response = await api.post("/nsfw/plan-generation", {
        modelId: selectedModel,
        userRequest: desc,
      });

      const applyPlanResult = (apiData) => {
        if (apiData?.status === "completed" && apiData?.prompt) {
          setChipSelections(applyChipConstraints(apiData.selections || {}, lockedAppearance));
          setGeneratedPrompt(apiData.prompt);
          setSimplePlanReady(true);
          toast.success(copy.toastSceneReady);
          return true;
        }
        if (apiData?.status === "failed") {
          if (apiData.selections && typeof apiData.selections === "object") {
            setChipSelections(applyChipConstraints(apiData.selections, lockedAppearance));
          }
          toast.error(apiData?.message || "Plan failed");
          return true;
        }
        return false;
      };

      if (response.status === 202 && response.data?.jobId) {
        const { jobId } = response.data;
        for (let i = 0; i < MAX_POLLS; i += 1) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const st = await api.get(`/nsfw/plan-generation/status/${jobId}`);
          if (applyPlanResult(st.data)) return;
        }
        toast.error("Plan timed out. Please try again.");
      } else if (response.data?.success && response.data?.prompt) {
        setChipSelections(applyChipConstraints(response.data.selections || {}, lockedAppearance));
        setGeneratedPrompt(response.data.prompt);
        setSimplePlanReady(true);
        toast.success(copy.toastSceneReady);
      } else {
        toast.error(response.data.message || "Plan failed");
      }
    } catch (error) {
      console.error("Plan generation error:", error);
      toast.error(error.response?.data?.message || "Plan failed");
    } finally {
      setIsPlanning(false);
    }
  };

  // Generate prompt with AI (Grok) from selections + scene description
  const handleGeneratePrompt = async () => {
    if (!selectedModel) return;
    const sceneText = sceneDescription.trim() || "intimate bedroom scene";

    setIsGeneratingAiPrompt(true);

    try {
      const attributesString = buildSelectionsString(chipSelections);
      const response = await api.post("/nsfw/generate-prompt", {
        modelId: selectedModel,
        userRequest: sceneText,
        attributes: attributesString,
        attributesDetail: chipSelections,
      });

      if (response.data.success && response.data.prompt) {
        setGeneratedPrompt(response.data.prompt);
        const keep = { ...modelLooksLockedRef.current };
        for (const [k, v] of Object.entries(lockedAppearance || {})) {
          if (v) keep[k] = v;
        }
        setChipSelections(applyChipConstraints(keep, lockedAppearance));
        toast.success(copy.toastPromptGenerated);
      } else {
        toast.error(response.data.message || "Failed to generate prompt");
      }
    } catch (error) {
      console.error("Generate prompt error:", error);
      toast.error(error.response?.data?.message || "Failed to generate prompt");
    } finally {
      setIsGeneratingAiPrompt(false);
    }
  };

  // Auto-select chips based on scene description using AI
  const [isAutoSelecting, setIsAutoSelecting] = useState(false);
  const handleAutoSelect = async () => {
    const desc = sceneDescription.trim();
    if (!desc) {
      toast.error(copy.toastTypeSceneFirst);
      return;
    }
    if (!selectedModel) {
      toast.error(copy.toastSelectModel);
      return;
    }
    setIsAutoSelecting(true);
    const POLL_MS = 2500;
    const MAX_POLLS = 100;

    const applySelections = (selections) => {
      if (!selections || typeof selections !== "object") return;
      setChipSelections((prev) => {
        const updated = { ...prev };
        for (const [key, value] of Object.entries(selections)) {
          if (!lockedAppearance[key]) {
            updated[key] = value;
          }
        }
        return applyChipConstraints(updated, lockedAppearance);
      });
      setGeneratedPrompt("");
      const count = Object.keys(selections).length;
      toast.success(`AI selected ${count} matching options`);
    };

    try {
      const response = await api.post("/nsfw/auto-select", {
        description: desc,
        modelId: selectedModel,
      });

      let selections = null;

      if (response.status === 202 && response.data?.jobId) {
        const { jobId } = response.data;
        for (let i = 0; i < MAX_POLLS; i += 1) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const st = await api.get(`/nsfw/auto-select/status/${jobId}`);
          const apiData = st.data;
          if (apiData?.status === "completed" && apiData?.selections) {
            selections = apiData.selections;
            break;
          }
          if (apiData?.status === "failed") {
            toast.error(apiData?.message || "Auto-select failed");
            return;
          }
        }
        if (!selections) {
          toast.error("Auto-select timed out. Please try again.");
          return;
        }
        applySelections(selections);
      } else if (response.data?.success && response.data?.selections) {
        applySelections(response.data.selections);
      } else {
        toast.error(response.data?.message || "Auto-select failed");
      }
    } catch (error) {
      console.error("Auto-select error:", error);
      const api = error.response?.data;
      const msg =
        (typeof api?.message === "string" && api.message) ||
        (typeof api?.error === "string" && api.error) ||
        "Auto-select failed";
      toast.error(msg);
    } finally {
      setIsAutoSelecting(false);
    }
  };

  const handlePresetSelect = (preset) => {
    if (!selectedModel) {
      toast.error(copy.toastSelectModel);
      return;
    }
    setSelectedPreset(preset.id);
    if (nsfwGenerateMode === "custom") {
      setCustomPrompt(preset.description);
      return;
    }
    setSceneDescription(preset.description);
    setGeneratedPrompt("");
    setSimplePlanReady(false);
    const baseSelections = { ...modelLooksLockedRef.current };
    for (const [key, value] of Object.entries(lockedAppearance || {})) {
      if (value) baseSelections[key] = value;
    }
    setChipSelections(applyChipConstraints(baseSelections, lockedAppearance));
  };

  // Generate NSFW image
  const handleGenerateNsfw = async () => {
    const promptToUse =
      nsfwGenerateMode === "custom" ? customPrompt.trim() : generatedPrompt.trim();
    if (!selectedModel || !promptToUse) {
      toast.error(
        nsfwGenerateMode === "custom"
          ? "Enter your custom prompt below"
          : "Generate a prompt first",
      );
      return;
    }

    if (!isLoraReady) {
      toast.error(copy.toastCompleteLoraTrainingFirst);
      setActivePhase("training");
      return;
    }

    setIsGeneratingNsfw(true);

    try {
      const attributesString = buildSelectionsString(chipSelections);

      const response = await api.post("/nsfw/generate", {
        modelId: selectedModel,
        prompt: promptToUse,
        quantity: imageQuantity,
        resolution: nsfwGenerateMode === "simple" ? "1024x1024" : selectedAspectRatio,
        attributes: attributesString,
        attributesDetail: chipSelections,
        sceneDescription:
          nsfwGenerateMode === "custom"
            ? promptToUse.slice(0, 2000)
            : sceneDescription.trim(),
        skipFaceSwap,
        faceSwapImageUrl: faceSwapImage?.url || null,
        options: {
          quickFlow: nsfwGenerateMode === "simple",
          loraStrength: genConfig.loraStrength || null,
          postProcessing: {
            blur: {
              enabled: genConfig.blurEnabled !== false,
              strength: Number(genConfig.blurStrength ?? 0.3),
            },
            grain: {
              enabled: genConfig.grainEnabled !== false,
              strength: Number(genConfig.grainStrength ?? 0.06),
            },
          },
          ...(user?.role === "admin" && adminSamplerTest.enabled
            ? {
                adminNsfwOverrides: {
                  steps: Math.min(150, Math.max(1, Math.round(Number(adminSamplerTest.steps)) || 50)),
                  cfg: Math.min(8, Math.max(1, Number(adminSamplerTest.cfg) || 3)),
                },
              }
            : {}),
        },
      });

      if (response.data.success) {
        const qty = response.data.imageQuantity || 1;
        toast(qty === 2 
          ? "2 images generating! Check Live Preview." 
          : "Generation submitted! You can create more while it processes.", 
          { icon: "🔥" }
        );
        refreshUserCredits();
        clearNsfwDraft();

        setGeneratedPrompt("");
        setCustomPrompt("");
        setSceneDescription("");
        const keep = { ...modelLooksLockedRef.current };
        for (const [k, v] of Object.entries(lockedAppearance || {})) {
          if (v) keep[k] = v;
        }
        setChipSelections(applyChipConstraints(keep, lockedAppearance));
        setSimplePlanReady(false);

        const generations = response.data.generations || [];
        if (generations.length > 0) {
          generations.forEach(g => pollNsfwGeneration(g.id).catch(() => {}));
        } else {
          const generationId = response.data.generation?.id;
          if (generationId) {
            pollNsfwGeneration(generationId).catch(() => {});
          }
        }
      } else {
        toast.error(response.data.message || copy.toastGenerationFailed);
      }
    } catch (error) {
      console.error("Generate NSFW error:", error);
      const errData = error.response?.data;
      const msg = errData?.errors?.length
        ? errData.errors.map(e => e.field ? `${e.field}: ${e.message}` : e.message).join('; ')
        : (errData?.message || copy.toastGenerationFailed);
      toast.error(msg);
    } finally {
      setIsGeneratingNsfw(false);
    }
  };

  const handleNudesPackApprove = async (poseIds) => {
    if (!selectedModel || !poseIds?.length) {
      toast.error(copy.toastSelectModelAndPose);
      return;
    }
    if (!isLoraReady) {
      toast.error(copy.toastCompleteLoraTrainingFirst);
      setActivePhase("training");
      return;
    }

    setIsSubmittingNudesPack(true);
    try {
      const attributesString = buildSelectionsString(chipSelections);
      const response = await api.post(
        "/nsfw/nudes-pack",
        {
          modelId: selectedModel,
          poseIds,
          attributes: attributesString,
          attributesDetail: chipSelections,
          sceneDescription: sceneDescription.trim() || undefined,
          skipFaceSwap,
          faceSwapImageUrl: faceSwapImage?.url || null,
          resolution: nsfwGenerateMode === "simple" ? "1024x1024" : selectedAspectRatio,
          options: {
            quickFlow: nsfwGenerateMode === "simple",
            loraStrength: genConfig.loraStrength || null,
            postProcessing: {
              blur: {
                enabled: genConfig.blurEnabled !== false,
                strength: Number(genConfig.blurStrength ?? 0.3),
              },
              grain: {
                enabled: genConfig.grainEnabled !== false,
                strength: Number(genConfig.grainStrength ?? 0.06),
              },
            },
            ...(user?.role === "admin" && adminSamplerTest.enabled
              ? {
                  adminNsfwOverrides: {
                    steps: Math.min(150, Math.max(1, Math.round(Number(adminSamplerTest.steps)) || 50)),
                    cfg: Math.min(8, Math.max(1, Number(adminSamplerTest.cfg) || 3)),
                  },
                }
              : {}),
          },
        },
        { suppressGlobalError: true, timeout: 120_000 },
      );

      if (response.data?.success) {
        toast.success(
          response.data.message ||
            "Nudes pack queued — you can leave this page. Images will appear in your gallery when ready.",
          { duration: 6000 },
        );
        refreshUserCredits();
        setNudesPackModalOpen(false);
        const gens = response.data.generations || [];
        gens.forEach((g) => {
          if (g?.id) pollNsfwGeneration(g.id).catch(() => {});
        });
        if (response.data.failures?.length) {
          toast.error(`${response.data.failures.length} pose(s) could not be queued — credits refunded for those.`);
        }
      } else {
        toast.error(response.data?.message || "Failed to start nudes pack");
      }
    } catch (error) {
      console.error("Nudes pack error:", error);
      const errData = error.response?.data;
      const msg = errData?.errors?.length
        ? errData.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join("; ")
        : errData?.message || "Failed to start nudes pack";
      toast.error(msg);
    } finally {
      setIsSubmittingNudesPack(false);
    }
  };

  // Poll for NSFW generation completion (keep in sync with server RunPod wall ~90m; server completes in background anyway)
  const pollNsfwGeneration = async (generationId) => {
    const pollInterval = 5000;
    const maxAttempts = Math.ceil((55 * 60 * 1000) / pollInterval); // ~55 min — then user can refresh History

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await api.get(`/generations/${generationId}`);
        const generation = response.data.generation;

        if (generation?.status === "completed" && generation?.outputUrl) {
          // Parse outputUrl - can be single URL or JSON array of URLs
          let imageUrls = [];
          try {
            // Try to parse as JSON array
            const parsed = JSON.parse(generation.outputUrl);
            if (Array.isArray(parsed)) {
              imageUrls = parsed;
            } else {
              imageUrls = [generation.outputUrl];
            }
          } catch {
            // Not JSON, treat as single URL
            imageUrls = [generation.outputUrl];
          }

          const imageCount = imageUrls.length;
          toast.success(
            `${imageCount} NSFW image${imageCount > 1 ? "s" : ""} generated!`,
          );

          // Add all images to the generated list
          const newImages = imageUrls.map((url, index) => ({
            id: `${generation.id}-${index}`,
            url: url,
            prompt: generation.prompt,
            createdAt: generation.createdAt,
          }));

          setGeneratedNsfwImages((prev) => [...newImages, ...prev]);
          return;
        }

        if (generation?.status === "failed") {
          toast.error(generation.errorMessage || copy.toastGenerationFailed);
          return;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.error("Poll error:", error);
      }
    }

    toast.error(
      "No update yet from this tab — long NSFW runs can take 30–60+ min. Open History or refresh; your job may still finish in the background.",
      { duration: 8000 },
    );
  };

  // Calculate completed training images (from backend)
  const completedTrainingImages = Array.isArray(trainingImages)
    ? trainingImages.filter(i => i.status === 'completed').length
    : 0;

  // Calculate selected training images (from gallery picker)
  const totalSelectedTrainingImages = trainingSelections.length;

  const nudesPackPoseCount = Array.isArray(nudesPackPoses) && nudesPackPoses.length > 0
    ? nudesPackPoses.length
    : NUDES_PACK_MAX_POSES;

  const contentBlock = (
    <div className={embedded ? "" : "min-h-screen relative"}>
      {!embedded && (
        <>
          {/* Static gradient background */}
          <div
            className="fixed inset-0 bg-gradient-to-b from-black/5 to-black pointer-events-none"
            style={{ zIndex: 0 }}
          />
          
          {/* Desktop Sidebar - hidden on mobile */}
          <div className="hidden md:block">
            <AppSidebar
              activeTab="nsfw"
              setActiveTab={(tab) => {
                if (tab === "nsfw") return;
                navigate(`/dashboard?tab=${tab}`);
              }}
              user={user}
              onLogout={handleLogout}
              onOpenCredits={() => setShowCreditsModal(true)}
              onOpenEarn={() => setShowEarnModal(true)}
              onOpenReferral={() => setShowReferralModal(true)}
              onOpenAdmin={() => navigate("/admin")}
              collapsed={standaloneSidebarCollapsed}
              setCollapsed={setStandaloneSidebarCollapsed}
              sidebarPinned={standaloneSidebarPinned}
              setSidebarPinned={setStandaloneSidebarPinned}
              onDesktopHoverChange={setStandaloneSidebarHovered}
            />
          </div>
        </>
      )}

      {/* Main Content - with left margin for sidebar on desktop (only when standalone) */}
      <div
        className={
          embedded
            ? "flex justify-center"
            : `relative z-10 flex justify-center px-3 py-4 sm:p-6 lg:p-8 transition-[margin] duration-300 ease-out ${layoutSidebarNarrow ? "md:ml-[80px]" : "md:ml-[260px]"}`
        }
      >
        <div className="w-full max-w-5xl">
        {/* NSFW Unlock Modal */}
        <NsfwUnlockModal 
          isOpen={showUnlockModal} 
          onClose={() => setShowUnlockModal(false)}
          sidebarCollapsed={layoutSidebarNarrow}
        />

        {/* NudesPackModal — disabled */}

        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <div className="p-1.5 sm:p-2 rounded-xl border border-white/20 bg-white/[0.08] backdrop-blur-xl">
              <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-rose-400" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{copy.title}</h1>
            <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.15] text-rose-400 text-[10px] sm:text-xs font-medium">
              Verified Models
            </span>
            {!hasNsfwAccess && (
              <button
                onClick={() => setShowUnlockModal(true)}
                className="ml-auto px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] sm:text-xs font-medium hover:bg-amber-500/20 transition-colors flex items-center gap-1.5"
                data-testid="button-nsfw-unlock-info"
              >
                <Lock className="w-3 h-3" />
                {copy.needAccess}
              </button>
            )}
        </div>
        <p className="text-xs sm:text-sm text-slate-400">{copy.subtitle}</p>
        <TutorialInfoLink className="mt-2" tutorialUrl={activeNsfwTutorialUrl} />
      </div>

      <CourseTipBanner type="nsfw" onNavigateToCourse={() => setDashboardTab?.("course", "generate-nsfw")} />

      {/* Phase Tabs */}
      <div
        className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6 p-1.5 rounded-2xl glass-card"
      >
        {[
          { key: "training", label: copy.phaseTrainModel, sub: copy.phaseCreateLora, Icon: Wand2, locked: false },
          { key: "generate", label: copy.phaseGenerate, sub: isLoraReady ? copy.phaseNsfwReady : copy.phaseTrainFirst, Icon: Flame, locked: !isLoraReady },
          { key: "video", label: copy.phaseVideo, sub: isLoraReady ? copy.phaseImageToVideo : copy.phaseTrainFirst, Icon: Video, locked: !isLoraReady, testId: "button-video-tab" },
          { key: "img2img", label: copy.phaseImg2img, sub: isLoraReady ? copy.phasePhotoSwap : copy.phaseTrainFirst, Icon: ScanSearch, locked: !isLoraReady, testId: "button-img2img-tab" },
        ].map(({ key, label, sub, Icon, locked, testId }) => {
          const active = activePhase === key;
          return (
            <button
              key={key}
              onClick={() => { if (!locked) { setActivePhase(key); } }}
              disabled={locked}
              className={`relative w-full py-2.5 px-2.5 sm:py-3 sm:px-3 md:px-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 sm:gap-2 min-h-[52px] sm:min-h-[60px] group overflow-hidden ${
                active
                  ? "text-white bg-white/[0.08] border border-white/20"
                  : "text-slate-400 hover:text-white bg-white/[0.03] border border-transparent hover:border-white/10"
              } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
              data-testid={testId}
            >
              {active && <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />}
              {active && <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none" style={RED_CORNER_GLOW_STYLE} />}
              <div className="relative flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div className={`p-1.5 sm:p-2 rounded-lg ${active ? "bg-white/10 border border-white/20" : "bg-white/5"}`}>
                  <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${active ? "text-rose-400" : ""}`} />
                </div>
                <div className="text-left min-w-0">
                  <span className="font-semibold text-[12px] sm:text-sm md:text-base block leading-tight">{label}</span>
                  <span className="text-[10px] text-slate-500 hidden xl:block leading-tight">{sub}</span>
                </div>
                {locked && <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 ml-1 sm:ml-2" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="space-y-6">
        {/* Model Selector & Main Content */}
        <div
          className="rounded-2xl p-3 sm:p-5 md:p-6 glass-card"
        >
            <NSFWModelSelector
              models={models}
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
              onShowUnlockModal={() => setShowUnlockModal(true)}
              modelsLoadError={modelsLoadError}
              onRetry={refetchModels}
              isLoading={modelsLoading}
            />

            {activePhase === "training" && selectedModel && (
              <>
                {/* LoRA Manager */}
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center bg-rose-500">
                      <span className="text-[10px] font-bold text-white">2</span>
                    </div>
                    <span className="text-sm font-medium text-white">
                      {copy.manageLoras}
                    </span>
                  </div>
                  <div className="p-2.5 sm:p-4 rounded-xl border border-white/[0.10] bg-white/[0.03]">
                    <LoRAManager
                      modelId={selectedModel}
                      loras={modelLoras}
                      activeLora={activeLora}
                      loraStandardCost={loraStandardCost}
                      loraProCost={loraProCost}
                      currentLoraId={currentLoraId}
                      onCreateLora={handleCreateLora}
                      onSetActive={handleSetActiveLora}
                      onDeleteLora={handleDeleteLora}
                      onSelectLora={(loraId) => setCurrentLoraId(loraId)}
                      isLoading={isLoadingLoras}
                      onRefreshLoras={loadModelLoras}
                      modelSavedAppearance={(() => {
                        const s = selectedModelData?.savedAppearance;
                        if (!s) return {};
                        if (typeof s === "object") return s;
                        try { return JSON.parse(s); } catch { return {}; }
                      })()}
                    />
                  </div>
                </div>

                {/* Training Images + Train Button - only show when a LoRA is selected */}
                {(() => {
                  const selectedLora = currentLoraId ? modelLoras.find(l => l.id === currentLoraId) : null;
                  const loraStatus = selectedLora?.status;
                  const effectiveStatus = trainingStatus === "training" ? "training" : loraStatus;
                  const showImagePicker = selectedLora && ['awaiting_images', 'images_ready'].includes(effectiveStatus);
                  const showTrainingStatus = selectedLora && ['training', 'ready', 'failed'].includes(effectiveStatus);

                  if (!currentLoraId) {
                    return (
                      <div className="mt-6 p-4 rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-center">
                        <Layers className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                        <p className="text-sm text-slate-400">{copy.trainingHintCreateLora}</p>
                        <p className="text-[11px] text-slate-500 mt-1">{copy.trainingHintAwaitingImages}</p>
                      </div>
                    );
                  }

                  if (isLoadingStatus) {
                    return (
                      <div className="mt-6">
                        <div className="p-4 rounded-xl border border-slate-500/30 bg-slate-500/10">
                          <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                            <div>
                              <p className="text-sm font-medium text-slate-200">{copy.trainingStatusChecking}</p>
                              <p className="text-xs text-slate-400">{copy.loadingModelsWait}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (showTrainingStatus) {
                    return (
                      <div className="mt-6">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-rose-500">
                            <span className="text-[10px] font-bold text-white">3</span>
                          </div>
                          <span className="text-sm font-medium text-white">
                            TRAINING STATUS — {selectedLora?.name || "LoRA"}
                          </span>
                        </div>
                        {effectiveStatus === "training" ? (
                          <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
                            <div className="flex items-center gap-3">
                              <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                              <div>
                                <p className="text-sm font-medium text-amber-200">{copy.trainingInProgressTitle}</p>
                                <p className="text-xs text-amber-300/70">
                                  {selectedLora?.trainingMode === "pro"
                                    ? "This may take about 2 hours. You can leave this page and come back later."
                                    : "This may take about 1 hour. You can leave this page and come back later."}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : effectiveStatus === "ready" ? (
                          <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                            <div className="flex items-center gap-3">
                              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                              <div>
                                <p className="text-sm font-medium text-emerald-200">{copy.trainingCompleteTitle}</p>
                                <p className="text-xs text-emerald-300/70">{copy.trainingCompleteBody}</p>
                              </div>
                            </div>
                          </div>
                        ) : effectiveStatus === "failed" ? (
                          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10">
                            <div className="flex items-center gap-3">
                              <XCircle className="w-5 h-5 text-red-400" />
                              <div>
                                <p className="text-sm font-medium text-red-200">{copy.trainingFailedTitle}</p>
                                <p className="text-xs text-red-300/70">{copy.trainingFailedBody}</p>
                              </div>
                            </div>
                            <button
                              onClick={handleStartTraining}
                              disabled={completedTrainingImages < requiredTrainingImages || isTraining}
                              className="mt-3 w-full py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                              data-testid="button-retry-training"
                            >
                              <RefreshCcw className="w-4 h-4" />
                              {copy.trainingRetry}
                              <span className="text-xs opacity-70 inline-flex items-center gap-0.5">({trainingCreditCost} <Coins className="w-3 h-3" />)</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  if (showImagePicker) {
                    const isProMode = selectedLora?.trainingMode === "pro";
                    const proCategories = [
                      { label: "Face Portraits", count: 10, desc: "Different angles showing your face clearly", slots: ["Front facing", "Left 3/4 angle", "Right 3/4 angle", "Left profile", "Right profile", "Looking up", "Looking down", "Slight tilt left", "Slight tilt right", "Neutral expression"] },
                      { label: "Full Body", count: 5, desc: "Head-to-toe shots in different poses", slots: ["Standing front", "Standing back", "Walking pose", "Seated full view", "Leaning pose"] },
                      { label: "Half Body", count: 5, desc: "Waist-up shots with varied framing", slots: ["Centered front", "Turned left", "Turned right", "Arms visible", "Over shoulder"] },
                      { label: "Selfies", count: 5, desc: "Casual self-shot angles", slots: ["High angle", "Eye level", "Low angle", "Mirror selfie", "Outdoor light"] },
                      { label: "Nude Poses", count: 5, desc: "Unclothed reference shots for NSFW training", slots: ["Front standing", "Side pose", "Seated", "Reclining", "Back view"] },
                    ];

                    return (
                      <>
                        <div className="mt-6">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center bg-rose-500">
                              <span className="text-[10px] font-bold text-white">3</span>
                            </div>
                            <span className="text-sm font-medium text-white flex items-center gap-1.5">
                              ADD IMAGES — {selectedLora?.name || "LoRA"}
                              {isProMode && <Flame className="w-3.5 h-3.5 text-rose-400" />}
                            </span>
                            <span className={`text-xs ml-auto ${totalSelectedTrainingImages >= requiredTrainingImages ? "text-emerald-400" : "text-slate-500"}`}>
                              {totalSelectedTrainingImages}/{requiredTrainingImages} selected
                            </span>
                          </div>

                          {isProMode ? (
                            <div className="mb-3 sm:mb-4 p-3 sm:p-4 rounded-xl border border-rose-400/20 bg-rose-500/[0.04]">
                              <div className="flex items-start gap-2 mb-3">
                                <Flame className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-xs text-rose-200 font-medium mb-1">{copy.trainingProModeTitle}</p>
                                  <p className="text-[11px] text-slate-400">
                                    For best results, follow the category guide below. Select images that match each category to train a higher-quality model with better likeness and pose accuracy.
                                  </p>
                                  <p className="text-[11px] text-slate-500 mt-1.5">{copy.trainingProDurationHint}</p>
                                </div>
                              </div>
                              <div className="space-y-2">
                                {proCategories.map((cat) => {
                                  const startIdx = proCategories.slice(0, proCategories.indexOf(cat)).reduce((sum, c) => sum + c.count, 0);
                                  const catSelected = Math.min(cat.count, Math.max(0, totalSelectedTrainingImages - startIdx));
                                  return (
                                    <div key={cat.label} className="flex items-center gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[11px] font-medium text-white">{cat.label}</span>
                                          <span className="text-[10px] text-slate-500">{cat.count} images</span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 truncate">{cat.desc}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                                <p className="text-[10px] text-slate-500">
                                  <span className="text-slate-400 font-medium">Slot guide per category:</span>
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {proCategories.map(cat => (
                                    <span key={cat.label} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[9px] text-slate-400">
                                      {cat.label}: {cat.slots.slice(0, 3).join(", ")}...
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="mb-3 sm:mb-4 p-3 sm:p-4 rounded-xl border border-white/[0.10] bg-white/[0.03]">
                              <p className="text-xs text-slate-300 mb-1">
                                Select exactly 15 images showing different angles, poses, and expressions. Include face close-ups, half-body, and full-body shots for best results.
                              </p>
                              <p className="text-[11px] text-slate-500 mt-1.5">{copy.trainingBasicDurationHint}</p>
                            </div>
                          )}

                          <div className="p-2.5 sm:p-4 rounded-xl border border-white/[0.10] bg-white/[0.03]">
                            <TrainingImagePool
                              modelId={selectedModel}
                              loraId={currentLoraId}
                              selectedImages={trainingSelections}
                              onToggle={handleToggleTrainingImage}
                              onPreview={setPreviewImage}
                              allowCustomUpload={!!user?.allowCustomLoraTrainingPhotos}
                              maxImages={maxTrainingImages}
                              minImages={requiredTrainingImages}
                            />
                          </div>
                        </div>

                        <div className="mt-6">
                          <button
                            onClick={handleAssignAndTrain}
                            disabled={totalSelectedTrainingImages < requiredTrainingImages || isAssigningImages || isTraining}
                            className="w-full py-4 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            style={{
                              background:
                                totalSelectedTrainingImages >= requiredTrainingImages
                                  ? isProMode
                                    ? "linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)"
                                    : "linear-gradient(135deg, #f43f5e 0%, #f97316 100%)"
                                  : "rgba(255,255,255,0.1)",
                            }}
                            data-testid="button-train-lora"
                          >
                            {isAssigningImages || isTraining ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                {isAssigningImages ? "Assigning Images..." : "Starting Training..."}
                              </>
                            ) : (
                              <>
                                <Zap className="w-5 h-5" />
                                {isProMode ? "Train Pro LoRA" : "Generate LoRA"}
                                <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs inline-flex items-center gap-1">
                                  <Coins className="w-3 h-3 text-yellow-400" />{trainingCreditCost}
                                </span>
                              </>
                            )}
                          </button>
                        </div>
                      </>
                    );
                  }

                  return null;
                })()}
              </>
            )}

            {activePhase === "generate" && selectedModel && (selectedModelData?.isAIGenerated || selectedModelData?.nsfwOverride) && (
              <div className="mt-6 space-y-4">
                {/* LoRA Switcher */}
                {(() => {
                  const readyLoras = modelLoras.filter(l => l.status === "ready");
                  if (readyLoras.length <= 1) return null;
                  const activeLoraData = readyLoras.find(l => l.id === activeLora);
                  return (
                    <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Layers className="w-4 h-4 text-rose-400 flex-shrink-0" />
                          <span className="text-xs font-medium text-slate-400">Active LoRA:</span>
                          <span className="text-sm font-medium text-white truncate">
                            {activeLoraData?.name || "None"}
                          </span>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
                          {readyLoras.map((lora) => (
                            <button
                              key={lora.id}
                              onClick={() => handleSetActiveLora(lora.id)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                activeLora === lora.id
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-white"
                              }`}
                              data-testid={`button-switch-lora-${lora.id}`}
                            >
                              {lora.name || `LoRA ${lora.id.slice(0, 6)}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-1 rounded-xl border border-white/[0.1] bg-white/[0.03] mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 px-2 shrink-0">Flow</span>
                  <div className="flex rounded-lg overflow-hidden border border-white/10 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        setNsfwGenerateMode("simple");
                        setSelectedAspectRatio("1024x1024"); // Quick flow: auto selfie resolution
                        setCustomPrompt("");
                      }}
                      className={`flex-1 px-2 sm:px-3 py-2 text-xs font-semibold transition-colors ${
                        nsfwGenerateMode === "simple"
                          ? "bg-white text-black"
                          : "bg-transparent text-slate-400 hover:text-white"
                      }`}
                      data-testid="button-nsfw-flow-simple"
                    >
                      Quick
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNsfwGenerateMode("advanced");
                        setCustomPrompt("");
                      }}
                      className={`flex-1 px-2 sm:px-3 py-2 text-xs font-semibold transition-colors border-l border-white/10 ${
                        nsfwGenerateMode === "advanced"
                          ? "bg-white text-black"
                          : "bg-transparent text-slate-400 hover:text-white"
                      }`}
                      data-testid="button-nsfw-flow-advanced"
                    >
                      Advanced
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNsfwGenerateMode("custom");
                        setSimplePlanReady(false);
                        setGeneratedPrompt("");
                      }}
                      className={`flex-1 px-2 sm:px-3 py-2 text-xs font-semibold transition-colors border-l border-white/10 ${
                        nsfwGenerateMode === "custom"
                          ? "bg-white text-black"
                          : "bg-transparent text-slate-400 hover:text-white"
                      }`}
                      data-testid="button-nsfw-flow-custom"
                    >
                      Custom prompt
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mb-4">
                  {nsfwGenerateMode === "simple"
                    ? "Describe or pick a preset, then confirm — AI picks detail chips and writes the prompt. You only choose resolution and hit generate."
                    : nsfwGenerateMode === "advanced"
                    ? "Full control: auto-select chips, edit selectors, write or regenerate the prompt yourself, then generate."
                    : "Paste or type the full prompt yourself (Danbooru-style tags work best). Your LoRA trigger is added automatically if missing. Same resolution & quality settings as Advanced."}
                </p>

                {/* Nudes Pack — temporarily disabled */}

                {nsfwGenerateMode === "simple" && !simplePlanReady && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">What do you want?</label>
                      <textarea
                        value={sceneDescription}
                        onChange={(e) => {
                          setSceneDescription(e.target.value);
                          setGeneratedPrompt("");
                          setSelectedPreset(null);
                          setSimplePlanReady(false);
                        }}
                        placeholder="Describe the scene, or pick a preset below…"
                        className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-white/40 resize-none"
                        data-testid="textarea-nsfw-simple-scene"
                      />
                    </div>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-white mb-2">Or pick a preset</label>
                      <div className="flex flex-wrap gap-2">
                        {SCENE_PRESETS.map((preset) => {
                          const isActive = selectedPreset === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handlePresetSelect(preset)}
                              data-testid={`button-preset-${preset.id}`}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                isActive
                                  ? "bg-rose-500/15 border border-rose-400/40 text-rose-100"
                                  : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirmSimplePlan}
                      disabled={isPlanning || !sceneDescription.trim() || !selectedModel}
                      className="w-full mt-5 py-3.5 rounded-xl font-semibold text-black transition-all flex items-center justify-center gap-2 bg-white border border-white/35 hover:bg-white/90 disabled:opacity-45 disabled:cursor-not-allowed"
                      data-testid="button-nsfw-confirm-plan"
                    >
                      {isPlanning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Planning scene…
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Confirm — auto-pick chips &amp; prompt
                        </>
                      )}
                    </button>
                  </>
                )}

                {nsfwGenerateMode === "simple" && simplePlanReady && (
                  <div className="mb-4 p-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] space-y-3">
                    <div className="flex items-center gap-2 text-emerald-200 text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      Ready to generate
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{sceneDescription}</p>
                    {generatedPrompt && (
                      <p className="text-[10px] text-slate-500 font-mono max-h-20 overflow-y-auto leading-relaxed">
                        {generatedPrompt.slice(0, 400)}
                        {generatedPrompt.length > 400 ? "…" : ""}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSimplePlanReady(false);
                        setGeneratedPrompt("");
                      }}
                      className="text-xs text-rose-300 hover:text-rose-200 underline-offset-2 hover:underline"
                    >
                      Change scene (re-plan)
                    </button>
                  </div>
                )}

                {nsfwGenerateMode === "advanced" && (
                <>
                {/* Scene Description */}
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Describe the Scene
                  </label>
                  <textarea
                    value={sceneDescription}
                    onChange={(e) => { setSceneDescription(e.target.value); setGeneratedPrompt(""); setSelectedPreset(null); }}
                    placeholder="Describe what's happening... e.g., 'laying on bed taking a selfie', 'bent over kitchen counter'"
                    className="w-full h-20 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-white/40 resize-none"
                  />
                  {sceneDescription.trim() && (
                    <button
                      onClick={handleAutoSelect}
                      disabled={isAutoSelecting}
                      className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                      style={{
                        background: isAutoSelecting
                          ? "rgba(255,255,255,0.75)"
                          : "rgba(255,255,255,0.95)",
                        border: "1px solid rgba(255,255,255,0.35)",
                        color: "#111827",
                      }}
                      data-testid="button-auto-select"
                    >
                      {isAutoSelecting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          AI is picking options...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4" />
                          Auto-select matching options
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Quick Preset Poses */}
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Quick Presets
                  </label>
                  <p className="text-xs text-slate-500 mb-3">
                    Pick a pose — AI fills in the scene, selects chips, and creates your prompt
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SCENE_PRESETS.map((preset) => {
                      const isActive = selectedPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => handlePresetSelect(preset)}
                          data-testid={`button-preset-${preset.id}`}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                            isActive
                              ? "bg-rose-500/15 border border-rose-400/40 text-rose-100 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
                              : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Click-to-Select Chip Panels */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-white">
                      Select Details
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveAppearance}
                        disabled={isSavingAppearance}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all bg-white border border-white/35 text-black hover:bg-white/90"
                        data-testid="button-save-appearance"
                      >
                        {isSavingAppearance ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        {hasSavedAppearance ? "Update" : "Save"}
                      </button>
                      {chipCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-400/30 text-rose-200 text-xs">
                          {chipCount} selected
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/[0.08] overflow-hidden">
                    {selectorCategories.map((cat) => {
                      const isOpen = openCategory === cat.id;
                      const catCount = cat.groups.reduce(
                        (n, g) => n + (chipSelections[g.key] ? 1 : 0), 0,
                      );

                      return (
                        <div key={cat.id} className="border-b border-white/[0.06] last:border-b-0">
                          <button
                            onClick={() => setOpenCategory(isOpen ? null : cat.id)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                          >
                            <span className="flex items-center gap-2 text-sm text-white">
                              <span>{cat.icon}</span>
                              {cat.label}
                              {catCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-400/30 text-rose-200 text-[10px]">
                                  {catCount}
                                </span>
                              )}
                            </span>
                            <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                          </button>

                          {isOpen && (
                            <div className="px-4 pb-4 space-y-3">
                              {cat.groups.map((g) => {
                                const value = chipSelections[g.key] || "";
                                const isCustom = value && value !== " " && !g.options.includes(value);
                                const isEmptyCustom = value === " ";
                                const showCustomInput = isCustom || isEmptyCustom;
                                return (
                                  <div key={g.key}>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{g.label}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {g.options.map((opt) => {
                                        const isActive = value === opt;
                                        const isLocked = lockedAppearance[g.key] === opt;
                                        const isBlocked = !isActive && blockedChips[g.key]?.includes(opt);
                                        return (
                                          <button
                                            key={opt}
                                            type="button"
                                            onClick={() => !isBlocked && toggleChip(g.key, opt)}
                                            disabled={isBlocked}
                                            title={isBlocked ? "Blocked by current selections" : (isLocked ? "From model looks" : "")}
                                            className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                                              isLocked
                                                ? "bg-white/[0.06] border border-white/20 text-white/70"
                                                : isBlocked
                                                ? "bg-white/[0.02] border border-red-500/20 text-slate-600 cursor-not-allowed line-through opacity-40"
                                                : isActive
                                                ? "bg-rose-500/15 border border-rose-400/40 text-rose-100 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
                                                : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                                            }`}
                                          >
                                            {isLocked && <Lock className="w-2.5 h-2.5 inline mr-1" />}
                                            {opt}
                                          </button>
                                        );
                                      })}
                                      {(
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setGeneratedPrompt("");
                                            setChipSelections(prev => {
                                              const current = prev[g.key];
                                              const isCustomVal = current && current !== " " && !g.options.includes(current);
                                              const isEmptyCustomVal = current === " ";
                                              const next = { ...prev };
                                              next[g.key] = (isCustomVal || isEmptyCustomVal) ? "" : " ";
                                              return applyChipConstraints(next, lockedAppearance);
                                            });
                                          }}
                                          className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                                            isCustom || isEmptyCustom
                                              ? "bg-rose-500/15 border border-rose-400/40 text-rose-100"
                                              : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                                          }`}
                                        >
                                          {copy.custom}
                                        </button>
                                      )}
                                    </div>
                                    {showCustomInput && !lockedAppearance[g.key] && (
                                      <input
                                        type="text"
                                        value={value === " " ? "" : value}
                                        onChange={(e) => {
                                          setGeneratedPrompt("");
                                          setChipSelections(prev => applyChipConstraints({ ...prev, [g.key]: e.target.value }, lockedAppearance));
                                        }}
                                        placeholder={copy.customTypePlaceholder}
                                        className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-rose-500/50"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step 1: Generate Prompt */}
                <div>
                  <button
                    onClick={handleGeneratePrompt}
                    disabled={isGeneratingAiPrompt}
                    className="w-full py-3 rounded-xl font-semibold text-black transition-all flex items-center justify-center gap-2 bg-white border border-white/35 hover:bg-white/90"
                  >
                    {isGeneratingAiPrompt ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Generating prompt...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Generate Prompt with AI</>
                    )}
                  </button>
                </div>

                {/* Generated Prompt Preview */}
                {generatedPrompt && (
                  <div className="p-3 rounded-xl bg-white/[0.06] border border-white/[0.18]">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                      <span className="text-xs font-medium text-white">AI Generated Prompt</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed font-mono">{generatedPrompt}</p>
                  </div>
                )}
                </>
                )}

                {nsfwGenerateMode === "custom" && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">Your prompt</label>
                      <p className="text-[11px] text-slate-500 mb-2">
                        Write tags or a full prompt. Include your LoRA trigger word for best likeness, or we prepend it if absent.
                      </p>
                      <textarea
                        value={customPrompt}
                        onChange={(e) => {
                          setCustomPrompt(e.target.value);
                          setSelectedPreset(null);
                        }}
                        placeholder="e.g. your_trigger, 1girl, solo, nude, bedroom, soft lighting, masterpiece, best quality…"
                        className="w-full min-h-[140px] px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-white/40 resize-y font-mono text-sm"
                        data-testid="textarea-nsfw-custom-prompt"
                      />
                    </div>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-white mb-2">Quick presets (fill prompt)</label>
                      <div className="flex flex-wrap gap-2">
                        {SCENE_PRESETS.map((preset) => {
                          const isActive = selectedPreset === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handlePresetSelect(preset)}
                              data-testid={`button-custom-preset-${preset.id}`}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                isActive
                                  ? "bg-rose-500/15 border border-rose-400/40 text-rose-100"
                                  : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white"
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {((nsfwGenerateMode === "simple" && simplePlanReady) || nsfwGenerateMode === "advanced" || nsfwGenerateMode === "custom") && (
                <>
                {/* Aspect Ratio Selector — passed to ComfyUI / RunPod */}
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Image Resolution
                  </label>
                  <p className="text-[10px] text-slate-500 mb-2">
                    This size is sent to the generation workflow (empty latent / aspect node).
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {NSFW_RESOLUTION_OPTIONS.map((ratio) => (
                      <button
                        key={ratio.id}
                        type="button"
                        onClick={() => setSelectedAspectRatio(ratio.id)}
                        data-testid={`button-resolution-${ratio.id}`}
                        className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors flex flex-col items-center gap-0.5 ${
                          selectedAspectRatio === ratio.id
                            ? "bg-white text-black border border-white/35"
                            : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <span>{ratio.label}</span>
                        <span className="text-[10px] opacity-70">{ratio.size}</span>
                        {ratio.hint && (
                          <span className="text-[9px] text-slate-600 leading-tight text-center">{ratio.hint}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Advanced Generation Settings */}
                <div className="rounded-xl border border-white/[0.08] overflow-visible">
                  <button
                    onClick={() => setShowGenSettings(!showGenSettings)}
                    className="w-full flex items-center justify-between p-4 text-left"
                    data-testid="button-toggle-gen-settings"
                  >
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-white" />
                      <span className="text-sm font-medium text-white">Advanced Settings</span>
                      {(JSON.stringify(genConfig) !== JSON.stringify(DEFAULT_CONFIG) ||
                        (user?.role === "admin" && adminSamplerTest.enabled)) && (
                        <span className="px-1.5 py-0.5 rounded-full bg-white/90 text-black text-[10px]">Modified</span>
                      )}
                    </div>
                    <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showGenSettings ? "rotate-90" : ""}`} />
                  </button>

                  {showGenSettings && (
                    <div className="px-4 pb-4 space-y-5">
                      {/* Post-processing presets */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-medium text-slate-300">Blur + Grain Presets</label>
                          <span className="text-[10px] text-slate-500">One tap setup</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {POST_PROCESSING_PRESETS.map((preset) => {
                            const activePreset = getActivePostPreset();
                            const isActive = activePreset === preset.id;
                            return (
                              <button
                                key={preset.id}
                                onClick={() => applyPostPreset(preset)}
                                className={`px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors ${
                                  isActive
                                    ? "bg-white text-black border border-white/40"
                                    : "bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 hover:text-white"
                                }`}
                                data-testid={`preset-post-processing-${preset.id}`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* LoRA Strength */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <label className="text-xs font-medium text-slate-300">LoRA Strength</label>
                            <div className="group relative">
                              <Info className="w-3 h-3 text-slate-500 cursor-help" />
                              <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-300 leading-relaxed z-50 shadow-xl">
                                Controls how strongly your face model is applied. Lower values (0.1–0.5) give softer identity with less risk of distortion. Higher values (0.7–0.9) make the face more prominent.
                                <div className="text-[10px] text-slate-500 mt-1">Default: 0.65 | Range: 0.10 – 0.90</div>
                              </div>
                            </div>
                          </div>
                          <span className="text-xs font-mono text-white">{genConfig.loraStrength.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0.10"
                          max="0.90"
                          step="0.05"
                          value={genConfig.loraStrength}
                          onChange={(e) => setGenConfig(prev => ({ ...prev, loraStrength: parseFloat(e.target.value) }))}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-700 accent-white"
                          data-testid="slider-lora-strength"
                        />
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] text-slate-600">0.10</span>
                          <span className="text-[10px] text-slate-600">0.90</span>
                        </div>
                      </div>

                      {/* Blur Controls */}
                      <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-medium text-slate-300">Post Blur</label>
                          <button
                            onClick={() => setGenConfig(prev => ({ ...prev, blurEnabled: !(prev.blurEnabled !== false) }))}
                            className={`relative w-10 h-5 rounded-full transition-colors ${genConfig.blurEnabled !== false ? "bg-white" : "bg-slate-600"}`}
                            data-testid="toggle-post-blur"
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${genConfig.blurEnabled !== false ? "bg-black translate-x-5" : "bg-white translate-x-0.5"}`}
                            />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] text-slate-500">Strength</span>
                          <span className="text-xs font-mono text-white">{Number(genConfig.blurStrength ?? 0.3).toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={Number(genConfig.blurStrength ?? 0.3)}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                            setGenConfig(prev => ({ ...prev, blurStrength: val }));
                          }}
                          disabled={genConfig.blurEnabled === false}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-700 accent-white disabled:opacity-40 disabled:cursor-not-allowed"
                          data-testid="slider-post-blur-strength"
                        />
                      </div>

                      {/* Grain Controls */}
                      <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-medium text-slate-300">Film Grain</label>
                          <button
                            onClick={() => setGenConfig(prev => ({ ...prev, grainEnabled: !(prev.grainEnabled !== false) }))}
                            className={`relative w-10 h-5 rounded-full transition-colors ${genConfig.grainEnabled !== false ? "bg-white" : "bg-slate-600"}`}
                            data-testid="toggle-post-grain"
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${genConfig.grainEnabled !== false ? "bg-black translate-x-5" : "bg-white translate-x-0.5"}`}
                            />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] text-slate-500">Strength</span>
                          <span className="text-xs font-mono text-white">{Number(genConfig.grainStrength ?? 0.06).toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.02"
                          value={Number(genConfig.grainStrength ?? 0.06)}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                            setGenConfig(prev => ({ ...prev, grainStrength: val }));
                          }}
                          disabled={genConfig.grainEnabled === false}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-700 accent-white disabled:opacity-40 disabled:cursor-not-allowed"
                          data-testid="slider-post-grain-strength"
                        />
                      </div>

                      {user?.role === "admin" && (
                        <div className="rounded-lg border border-amber-500/35 p-3 bg-amber-500/[0.06]">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <label className="text-xs font-medium text-amber-100">Admin — sampler test</label>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                Base KSampler steps / CFG (server ignores unless you are admin)
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setAdminSamplerTest((prev) => ({ ...prev, enabled: !prev.enabled }))
                              }
                              className={`relative w-10 h-5 shrink-0 rounded-full transition-colors ${
                                adminSamplerTest.enabled ? "bg-amber-500" : "bg-slate-600"
                              }`}
                              data-testid="toggle-admin-sampler-test"
                            >
                              <span
                                className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
                                  adminSamplerTest.enabled
                                    ? "bg-white translate-x-5"
                                    : "bg-white translate-x-0.5"
                                }`}
                              />
                            </button>
                          </div>
                          {adminSamplerTest.enabled && (
                            <div className="grid grid-cols-2 gap-3 pt-1">
                              <div>
                                <label className="text-[11px] text-slate-400 block mb-1">Steps (1–150)</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={150}
                                  value={adminSamplerTest.steps}
                                  onChange={(e) => {
                                    const n = parseInt(e.target.value, 10);
                                    setAdminSamplerTest((prev) => ({
                                      ...prev,
                                      steps: Number.isFinite(n)
                                        ? Math.min(150, Math.max(1, n))
                                        : prev.steps,
                                    }));
                                  }}
                                  className="w-full px-2 py-1.5 rounded-lg bg-black/40 border border-white/15 text-white text-xs font-mono"
                                  data-testid="input-admin-nsfw-steps"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-slate-400 block mb-1">CFG (1–8)</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={8}
                                  step={0.1}
                                  value={adminSamplerTest.cfg}
                                  onChange={(e) => {
                                    const n = parseFloat(e.target.value);
                                    setAdminSamplerTest((prev) => ({
                                      ...prev,
                                      cfg: Number.isFinite(n)
                                        ? Math.min(8, Math.max(1, n))
                                        : prev.cfg,
                                    }));
                                  }}
                                  className="w-full px-2 py-1.5 rounded-lg bg-black/40 border border-white/15 text-white text-xs font-mono"
                                  data-testid="input-admin-nsfw-cfg"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Save / Reset Buttons */}
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={handleSaveConfig}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white border border-white/35 text-black text-xs font-medium transition-colors hover:bg-white/90"
                          data-testid="button-save-config"
                        >
                          {configSaved ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Saved!
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              Save Config
                            </>
                          )}
                        </button>
                        <button
                          onClick={handleResetConfig}
                          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-500/10 text-slate-400 text-xs font-medium transition-colors hover:bg-slate-500/20"
                          data-testid="button-reset-config"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Face Swap Toggle */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 to-white/10 border border-cyan-500/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-white" />
                      <span className="text-sm font-medium text-white">Face Swap</span>
                    </div>
                    <button
                      onClick={() => {
                        setSkipFaceSwap(!skipFaceSwap);
                        if (!skipFaceSwap) setFaceSwapImage(null); // Clear selection when disabling
                      }}
                      className={`relative w-12 h-6 rounded-full transition-colors flex items-center ${
                        !skipFaceSwap ? "bg-cyan-500" : "bg-slate-600"
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          !skipFaceSwap ? "translate-x-[28px]" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    {skipFaceSwap 
                      ? "Face swap disabled - generating raw LoRA output only"
                      : "Face swap enabled - select source image from your gallery"
                    }
                  </p>
                  
                  {/* Gallery Picker for Face Swap - SECURITY: Only gallery images for this model */}
                  {!skipFaceSwap && (
                    <NsfwFaceSwapGalleryPicker
                      modelId={selectedModel}
                      selectedImage={faceSwapImage}
                      onSelect={setFaceSwapImage}
                    />
                  )}
                </div>

                {/* Image Quantity Selector */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-sm text-slate-300">{copy.labelQuantity}</span>
                  <div className="flex gap-2">
                    <button
                      data-testid="button-quantity-1"
                      onClick={() => setImageQuantity(1)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        imageQuantity === 1
                          ? "bg-white border border-white/35 text-black"
                          : "bg-slate-700/50 border border-slate-600/30 text-slate-400 hover:bg-slate-600/50"
                      }`}
                    >
                      1 Image
                    </button>
                    <button
                      data-testid="button-quantity-2"
                      onClick={() => setImageQuantity(2)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        imageQuantity === 2
                          ? "bg-white border border-white/35 text-black"
                          : "bg-slate-700/50 border border-slate-600/30 text-slate-400 hover:bg-slate-600/50"
                      }`}
                    >
                      2 Images
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px] font-bold">
                        SAVE
                      </span>
                    </button>
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  data-testid="button-generate-nsfw"
                  onClick={handleGenerateNsfw}
                  disabled={
                    (nsfwGenerateMode === "custom"
                      ? !customPrompt.trim()
                      : !generatedPrompt.trim()) || isGeneratingNsfw
                  }
                  className="w-full py-4 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{
                    background:
                      (nsfwGenerateMode === "custom" ? customPrompt.trim() : generatedPrompt.trim())
                        ? "linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)"
                        : "rgba(255,255,255,0.1)",
                    border: (nsfwGenerateMode === "custom" ? customPrompt.trim() : generatedPrompt.trim())
                      ? "1px solid rgba(244,63,94,0.4)"
                      : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: (nsfwGenerateMode === "custom" ? customPrompt.trim() : generatedPrompt.trim())
                      ? "0 0 20px rgba(244,63,94,0.15)"
                      : "none",
                  }}
                >
                  {isGeneratingNsfw ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Generating {imageQuantity === 2 ? "2 images" : ""}...
                    </>
                  ) : (
                    <>
                      <Flame className="w-5 h-5 text-rose-300" />
                      Generate {imageQuantity === 2 ? "2 Images" : "Image"}
                      <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs inline-flex items-center gap-1.5">
                        <Coins className="w-3 h-3 text-yellow-400" />
                        <span>
                          {imageQuantity === 2
                            ? (skipFaceSwap ? "50" : "70")
                            : (skipFaceSwap ? "30" : "40")}
                        </span>
                      </span>
                    </>
                  )}
                </button>
                </>
                )}

                {/* Full NSFW Gallery - All Generated Images */}
                <div className="mt-6">
                  <NsfwGallery modelId={selectedModel} />
                </div>
              </div>
            )}

            {/* ===== VIDEO TAB ===== */}
            {activePhase === "video" && selectedModel && (selectedModelData?.isAIGenerated || selectedModelData?.nsfwOverride) && (
              <NsfwVideoTab
                modelId={selectedModel}
                videoSelectedImage={videoSelectedImage}
                setVideoSelectedImage={setVideoSelectedImage}
                videoPrompt={videoPrompt}
                setVideoPrompt={setVideoPrompt}
                videoDuration={videoDuration}
                setVideoDuration={setVideoDuration}
                isSubmittingVideo={isSubmittingVideo}
                setIsSubmittingVideo={setIsSubmittingVideo}
              />
            )}

            {/* ===== IMG2IMG TAB ===== */}
            {activePhase === "img2img" && selectedModel && isLoraReady && (
              <NsfwImg2ImgTab
                modelId={selectedModel}
                activeLoraObj={activeLoraObj}
                chipSelections={chipSelections}
                nsfwImageCost={nsfwImageBaseCost}
              />
            )}
          </div>

        {/* Credit Costs - Compact Inline */}
        <div
          className="rounded-2xl p-3 sm:p-4 md:p-5 border border-white/[0.16]"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)",
          }}
        >
          <h3 className="text-sm font-medium text-yellow-400 mb-3 inline-flex items-center gap-1.5">
            {copy.creditsPanelTitle}
            <Coins className="w-4 h-4 text-yellow-400" />
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.16] backdrop-blur-xl text-center">
              <span className="text-yellow-400 font-bold text-lg flex items-center justify-center gap-1">{loraStandardCost}/{loraProCost} <Coins className="w-4 h-4" /></span>
              <span className="text-slate-400">{copy.creditsPanelLoraTraining}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.16] backdrop-blur-xl text-center">
              <span className="text-yellow-400 font-bold text-lg flex items-center justify-center gap-1">{nsfwImageBaseCost} <Coins className="w-4 h-4" /></span>
              <span className="text-slate-400">{copy.creditsPanelNsfwImage}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.16] backdrop-blur-xl text-center">
              <span className="text-yellow-400 font-bold text-lg flex items-center justify-center gap-1">{nsfwFaceSwapCost} <Coins className="w-4 h-4" /></span>
              <span className="text-slate-400">{copy.creditsPanelFaceSwap}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.16] backdrop-blur-xl text-center">
              <span className="text-yellow-400 font-bold text-lg flex items-center justify-center gap-1">{nsfwVideoMinCost}-{nsfwVideoMaxCost} <Coins className="w-4 h-4" /></span>
              <span className="text-slate-400">{copy.creditsPanelNsfwVideo}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.16] backdrop-blur-xl text-center">
              <span className="text-yellow-400 font-bold text-lg flex items-center justify-center gap-1">0 <Coins className="w-4 h-4" /></span>
              <span className="text-slate-400">{copy.creditsPanelRetryFailed}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Credits Modal */}
      <AddCreditsModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
      />

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={previewImage}
            alt="Preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      </div>
      </div>
    </div>
  );

  return contentBlock;
}
