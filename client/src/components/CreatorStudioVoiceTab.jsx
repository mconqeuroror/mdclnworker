import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Loader2,
  Mic,
  Music4,
  RefreshCcw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import ModelSelectorCollapsible from "./ModelSelectorCollapsible";
import { modelAPI } from "../services/api";
import { useAuthStore } from "../store";
import { hasPremiumAccess } from "../utils/premiumAccess";
import { useTutorialCatalog } from "../hooks/useTutorialCatalog";
import TutorialInfoLink from "./TutorialInfoLink";

const LOCALE_STORAGE_KEY = "app_locale";
const PAGE_COPY = {
  en: {
    genderFemale: "Female",
    genderMale: "Male",
    genderNeutral: "Neutral",
    errorLoadStudio: "Failed to load Voice Studio for this model.",
    errorLoadModels: "Failed to load your models.",
    errorDescriptionMin: "Description must be at least 20 characters.",
    successPreviewsReady: "Previews ready. Pick one and save it.",
    errorPreviewsFailed: "Failed to generate design previews",
    errorPickPreview: "Pick a preview first.",
    errorConfirmConsent: "Confirm consent first.",
    successDesignedSaved: "Designed voice saved.",
    errorSaveDesignedFailed: "Failed to save designed voice",
    errorUploadMp3First: "Upload an MP3 sample first.",
    successClonedSaved: "Cloned voice saved.",
    errorCloneFailed: "Voice clone failed",
    successDefaultUpdated: "Default model voice updated.",
    errorSelectVoiceFailed: "Failed to select voice",
    confirmDeleteVoice: 'Delete voice "{name}"?',
    successVoiceDeleted: "Voice deleted.",
    errorDeleteVoiceFailed: "Failed to delete voice",
    errorSelectVoiceFirst: "Select a voice first.",
    errorScriptEmpty: "Script is empty.",
    errorInsufficientRegenCredits: "Insufficient credits for regeneration.",
    successRegenerated: "Audio regenerated — same history entry updated.",
    errorRegenFailed: "Regeneration failed",
    errorWriteScriptFirst: "Write a script first.",
    successAudioGenerated: "Audio generated.",
    errorGenerateAudioFailed: "Failed to generate audio",
    gateTitle: "Voice Studio",
    gateSubtitle: "Available for paid subscription users only.",
    gateBody:
      "Create up to 3 saved voices per model, generate high-quality multilingual audio, and keep a per-model history of generated clips once your subscription is active. Each saved custom voice has a hosting fee of about {monthly} credits per ~30 days, charged from your credit balance.",
    title: "Voice Studio",
    subtitle:
      "Multilingual v3 audio generation, up to {max} saved voices per model. Each saved custom voice: about {monthly} credits per ~30 days from your balance.",
    voiceHostingCallout:
      "Hosting: about {monthly} credits per saved voice every ~30 days (debited from your credit balance).",
    voiceSuspendedBadge: "Hosting paused",
    voiceSuspendedHint:
      "This voice is paused until the monthly hosting fee can be charged. Add credits and open Voice Studio to refresh billing.",
    creditsAvailable: "Credits available:",
    loadingModels: "Loading models...",
    emptyModels: "Create a model first to use Voice Studio.",
    modelLabel: "Model",
    loadingStudio: "Loading voice studio...",
    selectModelToContinue: "Select a model to continue.",
    savedVoices: "Saved Voices",
    savedCount: "{count}/{max} saved",
    typeClone: "Voice clone",
    typeDesigned: "Designed voice",
    defaultBadge: "Default",
    noPreview: "No preview available.",
    useForAudio: "Use for audio",
    buttonSaving: "Saving...",
    buttonMakeDefault: "Make default",
    buttonDeleting: "Deleting...",
    buttonDelete: "Delete",
    noVoicesYet:
      "No voices yet. Create one below to unlock audio generation for this model.",
    generateAudioSection: "Generate Audio",
    finalVoiceOutput: "Final voice output",
    needSavedVoice: "Create at least one saved voice to generate audio.",
    selectedVoice: "Selected voice:",
    selectedVoiceNone: "None",
    scriptPlaceholder:
      "Write the script you want this model voice to speak...",
    charsCount: "{count}/{max} chars",
    newAudioPricing:
      "New audio: {newCost} credits / 1K chars. Regeneration (from history modal): {regenCost} credits / 1K chars.",
    buttonGenerating: "Generating...",
    buttonGenerateAudio: "Generate Audio",
    errorInsufficientCreditsRequest: "Insufficient credits for this request.",
    createVoice: "Create Voice",
    designOrClone: "Design or clone",
    modeDesign: "Design",
    modeClone: "Clone",
    languageHint: "Language hint",
    languageAuto: "Auto / not specified",
    genderOptional: "Gender (optional)",
    genderAuto: "Auto",
    descriptionLabel: "Voice description",
    descriptionPlaceholder:
      "Describe the voice style, tone, pacing, accent, emotion, and personality...",
    buttonGeneratePreviews: "Generate previews",
    previewCandidate: "Preview candidate",
    consentDesign:
      "I confirm I have permission to create and save this voice.",
    buttonSaveDesigned: "Save designed voice",
    cloneUploadHint:
      "Upload one MP3 sample to create an instant voice clone.",
    cloneChooseSample: "Choose MP3 sample",
    consentClone:
      "I confirm I own this sample or have permission to clone it.",
    buttonSaveCloned: "Save cloned voice",
    limitReached:
      "You have reached the maximum saved voices for this model. Delete one to create another.",
    historyTitle: "History",
    historyGeneratedAudio: "Generated audio",
    historyEmpty: "No generated audio yet.",
    historyItemDefaultName: "Voice audio",
    historyRegenerated: "Regenerated",
    historyOpen: "Open ->",
    modalRegeneratingTitle: "Regenerating audio…",
    modalRegeneratingBody:
      "Replacing this history entry with the new render. This can take a little while.",
    modalTitle: "Generated audio",
    modalStatusProcessing: "Processing",
    modalCloseAria: "Close",
    modalLoading: "Loading…",
    modalVoiceLabel: "Voice",
    modalScriptLabel: "Script",
    modalRegenerationCost: "Regeneration:",
    modalCredits: "credits",
    modalProcessing: "Processing…",
    modalOpenFile: "Open file",
    modalRegenerateSameRow: "Regenerate (same history row)",
    voiceTypeCloneShort: "(clone)",
    voiceTypeDesignShort: "(design)",
  },
  ru: {
    genderFemale: "Женский",
    genderMale: "Мужской",
    genderNeutral: "Нейтральный",
    errorLoadStudio: "Не удалось загрузить Голосовую студию для этой модели.",
    errorLoadModels: "Не удалось загрузить ваши модели.",
    errorDescriptionMin: "Описание должно содержать не менее 20 символов.",
    successPreviewsReady: "Превью готовы. Выберите одно и сохраните.",
    errorPreviewsFailed: "Не удалось создать превью голоса",
    errorPickPreview: "Сначала выберите превью.",
    errorConfirmConsent: "Сначала подтвердите согласие.",
    successDesignedSaved: "Созданный голос сохранён.",
    errorSaveDesignedFailed: "Не удалось сохранить созданный голос",
    errorUploadMp3First: "Сначала загрузите MP3-образец.",
    successClonedSaved: "Клонированный голос сохранён.",
    errorCloneFailed: "Ошибка клонирования голоса",
    successDefaultUpdated: "Голос модели по умолчанию обновлён.",
    errorSelectVoiceFailed: "Не удалось выбрать голос",
    confirmDeleteVoice: 'Удалить голос «{name}»?',
    successVoiceDeleted: "Голос удалён.",
    errorDeleteVoiceFailed: "Не удалось удалить голос",
    errorSelectVoiceFirst: "Сначала выберите голос.",
    errorScriptEmpty: "Сценарий пуст.",
    errorInsufficientRegenCredits:
      "Недостаточно кредитов для повторной генерации.",
    successRegenerated:
      "Аудио перегенерировано — запись в истории обновлена.",
    errorRegenFailed: "Ошибка повторной генерации",
    errorWriteScriptFirst: "Сначала напишите сценарий.",
    successAudioGenerated: "Аудио создано.",
    errorGenerateAudioFailed: "Не удалось создать аудио",
    gateTitle: "Голосовая студия",
    gateSubtitle: "Доступно только для пользователей с платной подпиской.",
    gateBody:
      "Создавайте до 3 сохранённых голосов на модель, генерируйте многоязычное аудио высокого качества и храните историю сгенерированных клипов по каждой модели после активации подписки. За хостинг каждого сохранённого кастомного голоса списывается около {monthly} кредитов за ~30 дней с вашего баланса.",
    title: "Голосовая студия",
    subtitle:
      "Многоязычная генерация аудио v3, до {max} сохранённых голосов на модель. Каждый сохранённый кастомный голос: около {monthly} кредитов за ~30 дней с вашего баланса.",
    voiceHostingCallout:
      "Хостинг: около {monthly} кредитов за сохранённый голос каждые ~30 дней (списание с баланса кредитов).",
    voiceSuspendedBadge: "Хостинг приостановлен",
    voiceSuspendedHint:
      "Голос на паузе, пока нельзя списать ежемесячный платёж за хостинг. Пополните кредиты и откройте Голосовую студию для обновления.",
    creditsAvailable: "Доступно кредитов:",
    loadingModels: "Загрузка моделей...",
    emptyModels: "Сначала создайте модель, чтобы использовать Голосовую студию.",
    modelLabel: "Модель",
    loadingStudio: "Загрузка голосовой студии...",
    selectModelToContinue: "Выберите модель, чтобы продолжить.",
    savedVoices: "Сохранённые голоса",
    savedCount: "Сохранено {count}/{max}",
    typeClone: "Клон голоса",
    typeDesigned: "Созданный голос",
    defaultBadge: "По умолчанию",
    noPreview: "Превью недоступно.",
    useForAudio: "Использовать для аудио",
    buttonSaving: "Сохранение...",
    buttonMakeDefault: "Сделать по умолчанию",
    buttonDeleting: "Удаление...",
    buttonDelete: "Удалить",
    noVoicesYet:
      "Голосов пока нет. Создайте один ниже, чтобы разблокировать генерацию аудио для этой модели.",
    generateAudioSection: "Создать аудио",
    finalVoiceOutput: "Финальный голосовой вывод",
    needSavedVoice:
      "Создайте хотя бы один сохранённый голос для генерации аудио.",
    selectedVoice: "Выбранный голос:",
    selectedVoiceNone: "Не выбран",
    scriptPlaceholder:
      "Напишите сценарий, который должен озвучить голос модели...",
    charsCount: "{count}/{max} симв.",
    newAudioPricing:
      "Новое аудио: {newCost} кредитов / 1К симв. Повторная генерация (из модального окна истории): {regenCost} кредитов / 1К симв.",
    buttonGenerating: "Генерация...",
    buttonGenerateAudio: "Создать аудио",
    errorInsufficientCreditsRequest:
      "Недостаточно кредитов для этого запроса.",
    createVoice: "Создать голос",
    designOrClone: "Создать или клонировать",
    modeDesign: "Создать",
    modeClone: "Клонировать",
    languageHint: "Подсказка языка",
    languageAuto: "Авто / не указано",
    genderOptional: "Пол (необязательно)",
    genderAuto: "Авто",
    descriptionLabel: "Описание голоса",
    descriptionPlaceholder:
      "Опишите стиль, тон, темп, акцент, эмоцию и характер голоса...",
    buttonGeneratePreviews: "Создать превью",
    previewCandidate: "Вариант превью",
    consentDesign:
      "Я подтверждаю, что имею разрешение на создание и сохранение этого голоса.",
    buttonSaveDesigned: "Сохранить созданный голос",
    cloneUploadHint:
      "Загрузите один MP3-образец для мгновенного клонирования голоса.",
    cloneChooseSample: "Выбрать MP3-образец",
    consentClone:
      "Я подтверждаю, что являюсь владельцем этого образца или имею разрешение на его клонирование.",
    buttonSaveCloned: "Сохранить клонированный голос",
    limitReached:
      "Достигнут максимум сохранённых голосов для этой модели. Удалите один, чтобы создать новый.",
    historyTitle: "История",
    historyGeneratedAudio: "Сгенерированное аудио",
    historyEmpty: "Сгенерированного аудио пока нет.",
    historyItemDefaultName: "Голосовое аудио",
    historyRegenerated: "Перегенерировано",
    historyOpen: "Открыть ->",
    modalRegeneratingTitle: "Повторная генерация аудио…",
    modalRegeneratingBody:
      "Замена этой записи в истории новым рендером. Это может занять некоторое время.",
    modalTitle: "Сгенерированное аудио",
    modalStatusProcessing: "Обработка",
    modalCloseAria: "Закрыть",
    modalLoading: "Загрузка…",
    modalVoiceLabel: "Голос",
    modalScriptLabel: "Сценарий",
    modalRegenerationCost: "Повторная генерация:",
    modalCredits: "кредитов",
    modalProcessing: "Обработка…",
    modalOpenFile: "Открыть файл",
    modalRegenerateSameRow: "Перегенерировать (та же строка истории)",
    voiceTypeCloneShort: "(клон)",
    voiceTypeDesignShort: "(создан)",
  },
};

PAGE_COPY.sk = {
  ...PAGE_COPY.en,
  title: "Voice Studio",
  subtitle:
    "Viacjazyčná generácia audia v3, až {max} uložených hlasov na model. Každý uložený vlastný hlas: približne {monthly} kreditov za ~30 dní z vášho zostatku.",
  voiceHostingCallout:
    "Prevádzka hlasu: približne {monthly} kreditov na každý uložený hlas každých ~30 dní (odpočítava sa z kreditového zostatku).",
  voiceSuspendedBadge: "Hosting pozastavený",
  voiceSuspendedHint:
    "Hlas je pozastavený, kým sa nedá strhnúť mesačný poplatok za hosting. Doplňte kredity a znova otvorte Voice Studio.",
  gateTitle: "Voice Studio",
  gateSubtitle: "Len pre používateľov s plateným predplatným.",
  gateBody:
    "Po aktivácii predplatného môžete mať až 3 uložené hlasy na model, generovať kvalitné viacjazyčné audio a históriu klipov. Každý uložený vlastný hlas má aj približne {monthly} kreditov každých ~30 dní za hosting (zo zostatku).",
  creditsAvailable: "Dostupné kredity:",
  savedVoices: "Uložené hlasy",
  savedCount: "{count}/{max} uložených",
  createVoice: "Vytvoriť hlas",
  designOrClone: "Navrhnúť alebo naklonovať",
  modeDesign: "Návrh",
  modeClone: "Klon",
  generateAudioSection: "Generovať audio",
  needSavedVoice: "Najprv vytvorte aspoň jeden uložený hlas.",
};

function resolveLocale() {
  try {
    const qsLang = new URLSearchParams(window.location.search).get("lang");
    const normalizedQs = String(qsLang || "").toLowerCase();
    if (normalizedQs === "ru" || normalizedQs === "en" || normalizedQs === "sk") {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalizedQs);
      return normalizedQs;
    }
    const saved = String(localStorage.getItem(LOCALE_STORAGE_KEY) || "").toLowerCase();
    if (saved === "ru" || saved === "en" || saved === "sk") return saved;
    const browser = String(navigator.language || "").toLowerCase();
    if (browser.startsWith("ru")) return "ru";
    if (browser.startsWith("sk")) return "sk";
    return "en";
  } catch {
    return "en";
  }
}

function formatCopy(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? `{${key}}` : String(vars[key]),
  );
}

function estimateSecsFromChars(chars) {
  if (!chars) return 0;
  return Math.max(5, Math.ceil(chars / 15));
}

function formatDuration(seconds) {
  if (!seconds) return "0s";
  if (seconds < 60) return `${seconds}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function prettyDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function genderLabel(g) {
  if (!g) return null;
  const x = String(g).toLowerCase();
  if (x === "female") return "female";
  if (x === "male") return "male";
  if (x === "neutral") return "neutral";
  return g;
}

function getApiErrorMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  );
}

export default function CreatorStudioVoiceTab({ initialModelId = null }) {
  const copy = PAGE_COPY[resolveLocale()] || PAGE_COPY.en;
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const canUseVoiceStudio = hasPremiumAccess(user);
  const { byKey } = useTutorialCatalog();

  const [selectedModelId, setSelectedModelId] = useState(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [creationMode, setCreationMode] = useState("design");
  const [language, setLanguage] = useState("");
  const [gender, setGender] = useState("");
  const [description, setDescription] = useState("");
  const [previews, setPreviews] = useState([]);
  const [pickedPreviewId, setPickedPreviewId] = useState("");
  const [cloneFile, setCloneFile] = useState(null);
  const [consent, setConsent] = useState(false);
  const [audioScript, setAudioScript] = useState("");
  const [audioDetailId, setAudioDetailId] = useState(null);
  const [modalScript, setModalScript] = useState("");
  const [modalVoiceId, setModalVoiceId] = useState("");
  const [busyRegenAudioId, setBusyRegenAudioId] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const cloneInputRef = useRef(null);

  const modelsQuery = useQuery({
    queryKey: ["voice-studio-models"],
    queryFn: () => modelAPI.getAll(),
    staleTime: 60_000,
  });

  const models = modelsQuery.data?.models ?? modelsQuery.data ?? [];

  useEffect(() => {
    if (!selectedModelId && models.length > 0) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    if (initialModelId) {
      setSelectedModelId(initialModelId);
    }
  }, [initialModelId]);

  const voiceStudioQuery = useQuery({
    queryKey: ["voice-studio", selectedModelId],
    queryFn: () => modelAPI.getVoiceStudio(selectedModelId),
    enabled: Boolean(selectedModelId) && canUseVoiceStudio,
    staleTime: 10_000,
  });

  const voiceStudio = voiceStudioQuery.data || {};
  const model = voiceStudio.model || null;
  const voices = voiceStudio.voices || [];
  const history = voiceStudio.history || [];
  const pricing = voiceStudio.pricing || {};
  const limits = voiceStudio.limits || {};
  const voiceMonthlyCredits = pricing.voiceMonthly ?? 1000;
  const creditsAvailable = voiceStudio.creditsAvailable ?? user?.credits ?? 0;
  const voiceStudioErrorMessage = getApiErrorMessage(
    voiceStudioQuery.error,
    copy.errorLoadStudio,
  );
  const modelsErrorMessage = getApiErrorMessage(
    modelsQuery.error,
    copy.errorLoadModels,
  );
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) || voices[0] || null;
  const selectedVoiceSuspended = selectedVoice?.voiceBillingStatus === "suspended";
  const estimatedChars = audioScript.trim().length;
  const estimatedSecs = estimateSecsFromChars(estimatedChars);
  const estimatedCost = Math.max(
    0,
    Math.ceil((estimatedChars / 1000) * (pricing.audioPer1kChars || 72)),
  );

  const audioModalItem = audioDetailId ? history.find((h) => h.id === audioDetailId) : null;

  useEffect(() => {
    if (!voices.length) {
      setSelectedVoiceId("");
      return;
    }
    const current = voices.find((voice) => voice.id === selectedVoiceId);
    const missingOrSuspended =
      !current || current.voiceBillingStatus === "suspended";
    if (missingOrSuspended) {
      const next =
        voices.find((voice) => voice.isDefault && voice.voiceBillingStatus !== "suspended") ||
        voices.find((voice) => voice.voiceBillingStatus !== "suspended") ||
        voices.find((voice) => voice.isDefault) ||
        voices[0];
      if (next && next.id !== selectedVoiceId) {
        setSelectedVoiceId(next.id);
      }
    }
  }, [voices, selectedVoiceId]);

  useEffect(() => {
    setPreviews([]);
    setPickedPreviewId("");
    setCloneFile(null);
    setConsent(false);
    setAudioScript("");
    setAudioDetailId(null);
    setModalScript("");
    setModalVoiceId("");
    setBusyRegenAudioId(null);
    setDescription("");
    setLanguage("");
    setGender("");
    setCreationMode("design");
  }, [selectedModelId]);

  const refreshStudio = async () => {
    await voiceStudioQuery.refetch();
    await refreshUser?.();
  };

  const handleGeneratePreviews = async () => {
    if (!selectedModelId) return;
    const trimmed = description.trim();
    if (trimmed.length < 20) {
      toast.error(copy.errorDescriptionMin);
      return;
    }
    setBusyAction("design-previews");
    setPreviews([]);
    setPickedPreviewId("");
    try {
      const data = await modelAPI.generateVoiceDesignPreviews(selectedModelId, {
        voiceDescription: trimmed,
        ...(language ? { language } : {}),
        ...(gender ? { gender } : {}),
      });
      setPreviews(data.previews || []);
      if (data.previews?.[0]?.generatedVoiceId) {
        setPickedPreviewId(data.previews[0].generatedVoiceId);
      }
      toast.success(copy.successPreviewsReady);
    } catch (error) {
      toast.error(error.response?.data?.message || copy.errorPreviewsFailed);
    } finally {
      setBusyAction("");
    }
  };

  const handleConfirmDesignedVoice = async () => {
    if (!selectedModelId) return;
    if (!pickedPreviewId) return toast.error(copy.errorPickPreview);
    if (!consent) return toast.error(copy.errorConfirmConsent);
    setBusyAction("design-confirm");
    try {
      await modelAPI.confirmDesignedVoice(selectedModelId, {
        generatedVoiceId: pickedPreviewId,
        voiceDescription: description.trim(),
        consentConfirmed: true,
        ...(language ? { language } : {}),
        ...(gender ? { gender } : {}),
      });
      toast.success(copy.successDesignedSaved);
      setDescription("");
      setPreviews([]);
      setPickedPreviewId("");
      setConsent(false);
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || copy.errorSaveDesignedFailed);
    } finally {
      setBusyAction("");
    }
  };

  const handleCloneVoice = async () => {
    if (!selectedModelId) return;
    if (!cloneFile) return toast.error(copy.errorUploadMp3First);
    if (!consent) return toast.error(copy.errorConfirmConsent);
    const formData = new FormData();
    formData.append("audio", cloneFile);
    formData.append("consent", "true");
    if (language) formData.append("language", language);
    if (gender) formData.append("gender", gender);
    setBusyAction("clone");
    try {
      await modelAPI.cloneVoice(selectedModelId, formData);
      toast.success(copy.successClonedSaved);
      setCloneFile(null);
      setConsent(false);
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || copy.errorCloneFailed);
    } finally {
      setBusyAction("");
    }
  };

  const handleSelectDefault = async (voiceId) => {
    if (!selectedModelId) return;
    setBusyAction(`select:${voiceId}`);
    try {
      await modelAPI.selectVoice(selectedModelId, voiceId);
      setSelectedVoiceId(voiceId);
      toast.success(copy.successDefaultUpdated);
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || copy.errorSelectVoiceFailed);
    } finally {
      setBusyAction("");
    }
  };

  const handleDeleteVoice = async (voice) => {
    if (!selectedModelId) return;
    if (!window.confirm(formatCopy(copy.confirmDeleteVoice, { name: voice.name }))) return;
    setBusyAction(`delete:${voice.id}`);
    try {
      await modelAPI.deleteVoice(selectedModelId, voice.id);
      toast.success(copy.successVoiceDeleted);
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || copy.errorDeleteVoiceFailed);
    } finally {
      setBusyAction("");
    }
  };

  const openGeneratedAudioModal = (item) => {
    if (!item?.id) return;
    setAudioDetailId(item.id);
    setModalScript(item.script || "");
    setModalVoiceId(item.voiceId || selectedVoiceId || "");
  };

  const closeGeneratedAudioModal = () => {
    setAudioDetailId(null);
    setModalScript("");
    setModalVoiceId("");
    setBusyRegenAudioId(null);
  };

  useEffect(() => {
    if (!audioDetailId || !voiceStudioQuery.isSuccess || voiceStudioQuery.isFetching) return;
    if (!history.some((h) => h.id === audioDetailId)) {
      setAudioDetailId(null);
      setModalScript("");
      setModalVoiceId("");
      setBusyRegenAudioId(null);
    }
  }, [audioDetailId, history, voiceStudioQuery.isSuccess, voiceStudioQuery.isFetching]);

  useEffect(() => {
    if (!audioDetailId || !voices.length) return;
    if (!voices.some((v) => v.id === modalVoiceId)) {
      const def = voices.find((v) => v.isDefault) || voices[0];
      if (def) setModalVoiceId(def.id);
    }
  }, [audioDetailId, voices, modalVoiceId]);

  const handleRegenerateInModal = async () => {
    if (!selectedModelId || !audioDetailId) return;
    const vid = modalVoiceId || selectedVoice?.id;
    if (!vid) return toast.error(copy.errorSelectVoiceFirst);
    const script = modalScript.trim();
    if (!script) return toast.error(copy.errorScriptEmpty);
    const regenCost = Math.max(
      0,
      Math.ceil((script.length / 1000) * (pricing.audioRegenPer1kChars || 36)),
    );
    if (creditsAvailable < regenCost) {
      toast.error(copy.errorInsufficientRegenCredits);
      return;
    }
    setBusyRegenAudioId(audioDetailId);
    try {
      await modelAPI.generateVoiceAudio(selectedModelId, {
        voiceId: vid,
        script,
        regenerateFromId: audioDetailId,
      });
      toast.success(copy.successRegenerated);
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || copy.errorRegenFailed);
    } finally {
      setBusyRegenAudioId(null);
    }
  };

  const handleGenerateAudio = async () => {
    if (!selectedModelId) return;
    if (!selectedVoice?.id) return toast.error(copy.errorSelectVoiceFirst);
    if (!audioScript.trim()) return toast.error(copy.errorWriteScriptFirst);
    setBusyAction("generate-audio");
    try {
      await modelAPI.generateVoiceAudio(selectedModelId, {
        voiceId: selectedVoice.id,
        script: audioScript.trim(),
      });
      toast.success(copy.successAudioGenerated);
      setAudioScript("");
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || copy.errorGenerateAudioFailed);
    } finally {
      setBusyAction("");
    }
  };

  if (!canUseVoiceStudio) {
    return (
      <div className="px-6 py-8">
        <div className="max-w-2xl rounded-3xl border border-violet-500/20 bg-violet-500/5 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15">
              <Mic className="h-6 w-6 text-violet-300" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{copy.gateTitle}</h2>
              <p className="text-sm text-slate-400">{copy.gateSubtitle}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            {formatCopy(copy.gateBody, { monthly: 1000 })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{copy.title}</h1>
          <p className="text-sm text-slate-400">
            {formatCopy(copy.subtitle, {
              max: limits.maxSavedVoicesPerModel || 3,
              monthly: voiceMonthlyCredits,
            })}
          </p>
          <TutorialInfoLink
            className="mt-2"
            tutorialUrl={byKey?.["creator.voice-studio"]?.url || null}
          />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          <span className="text-slate-500">{copy.creditsAvailable}</span>{" "}
          <span className="font-semibold text-white">{creditsAvailable}</span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          {modelsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> {copy.loadingModels}
            </div>
          ) : modelsQuery.isError ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-4 text-sm text-red-200">
              {modelsErrorMessage}
            </div>
          ) : models.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
              {copy.emptyModels}
            </div>
          ) : (
            <ModelSelectorCollapsible
              models={models}
              selectedModelId={selectedModelId}
              onSelect={setSelectedModelId}
              label={copy.modelLabel}
              accentColor="violet"
            />
          )}
        </div>

        <div className="space-y-6">
          {!selectedModelId ? null : voiceStudioQuery.isLoading ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-sm text-slate-400 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> {copy.loadingStudio}
            </div>
          ) : voiceStudioQuery.isError ? (
            <div className="rounded-3xl border border-red-400/20 bg-red-500/5 p-8 text-sm text-red-200">
              {voiceStudioErrorMessage}
            </div>
          ) : !model ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-sm text-slate-400">
              {copy.selectModelToContinue}
            </div>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{copy.savedVoices}</p>
                      <h2 className="mt-1 text-lg font-semibold text-white">{model.name}</h2>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
                      {formatCopy(copy.savedCount, {
                        count: voices.length,
                        max: limits.maxSavedVoicesPerModel || 3,
                      })}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {voices.map((voice) => {
                      const suspended = voice.voiceBillingStatus === "suspended";
                      return (
                      <div
                        key={voice.id}
                        className={`rounded-2xl border p-4 transition ${
                          selectedVoiceId === voice.id
                            ? "border-violet-400/40 bg-violet-500/10"
                            : suspended
                              ? "border-amber-400/25 bg-amber-500/5"
                              : "border-white/10 bg-black/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{voice.name}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {voice.type === "clone" ? copy.typeClone : copy.typeDesigned}
                              {genderLabel(voice.gender) ? ` · ${copy[`gender${genderLabel(voice.gender).charAt(0).toUpperCase()}${genderLabel(voice.gender).slice(1)}`] || genderLabel(voice.gender)}` : ""}
                              {voice.isDefault ? ` · ${copy.defaultBadge}` : ""}
                            </p>
                            {suspended && (
                              <p className="mt-2 text-xs font-medium text-amber-200">{copy.voiceSuspendedBadge}</p>
                            )}
                          </div>
                          {voice.isDefault && !suspended && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                        </div>

                        {voice.previewUrl ? (
                          <audio className="mt-3 w-full" controls src={voice.previewUrl} preload="none" />
                        ) : (
                          <p className="mt-3 text-xs text-slate-500">{copy.noPreview}</p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedVoiceId(voice.id)}
                            disabled={suspended}
                            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {copy.useForAudio}
                          </button>
                          {!voice.isDefault && (
                            <button
                              type="button"
                              onClick={() => handleSelectDefault(voice.id)}
                              disabled={busyAction === `select:${voice.id}` || suspended}
                              className="rounded-xl border border-violet-400/30 px-3 py-2 text-xs font-medium text-violet-200 hover:border-violet-300/50 disabled:opacity-50"
                            >
                              {busyAction === `select:${voice.id}` ? copy.buttonSaving : copy.buttonMakeDefault}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteVoice(voice)}
                            disabled={busyAction === `delete:${voice.id}`}
                            className="rounded-xl border border-red-400/20 px-3 py-2 text-xs font-medium text-red-300 hover:border-red-300/40 disabled:opacity-50"
                          >
                            {busyAction === `delete:${voice.id}` ? copy.buttonDeleting : copy.buttonDelete}
                          </button>
                        </div>
                      </div>
                    );
                    })}

                    {voices.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                        {copy.noVoicesYet}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center gap-2">
                    <Music4 className="h-5 w-5 text-violet-300" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{copy.generateAudioSection}</p>
                      <h3 className="text-lg font-semibold text-white">{copy.finalVoiceOutput}</h3>
                    </div>
                  </div>

                  {voices.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-200">
                      {copy.needSavedVoice}
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs text-slate-400">
                          {copy.selectedVoice} <span className="font-semibold text-white">{selectedVoice?.name || copy.selectedVoiceNone}</span>
                        </p>
                        <textarea
                          value={audioScript}
                          onChange={(event) => setAudioScript(event.target.value)}
                          rows={8}
                          maxLength={limits.maxChars || 5000}
                          placeholder={copy.scriptPlaceholder}
                          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-400/30"
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                          <div className="flex items-center gap-3">
                            <span>{formatCopy(copy.charsCount, { count: estimatedChars, max: limits.maxChars || 5000 })}</span>
                            <span>~{formatDuration(estimatedSecs)}</span>
                          </div>
                          <div className="flex items-center gap-1 font-semibold text-white">
                            {estimatedCost || 0} <Coins className="h-3.5 w-3.5 text-yellow-400" />
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          {formatCopy(copy.newAudioPricing, {
                            newCost: pricing.audioPer1kChars || 72,
                            regenCost: pricing.audioRegenPer1kChars || 36,
                          })}
                        </p>
                        <button
                          type="button"
                          onClick={handleGenerateAudio}
                          disabled={
                            !selectedVoice ||
                            selectedVoiceSuspended ||
                            !audioScript.trim() ||
                            busyAction === "generate-audio" ||
                            creditsAvailable < estimatedCost
                          }
                          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyAction === "generate-audio" ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" /> {copy.buttonGenerating}
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-4 w-4" /> {copy.buttonGenerateAudio}
                            </>
                          )}
                        </button>
                        {selectedVoiceSuspended && (
                          <p className="mt-3 text-xs text-amber-200">{copy.voiceSuspendedHint}</p>
                        )}
                        {audioScript.trim() && creditsAvailable < estimatedCost && (
                          <p className="mt-3 text-xs text-red-400">
                            {copy.errorInsufficientCreditsRequest}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{copy.createVoice}</p>
                      <h3 className="text-lg font-semibold text-white">{copy.designOrClone}</h3>
                    </div>
                    <div className="flex rounded-2xl border border-white/10 bg-black/20 p-1">
                      <button
                        type="button"
                        onClick={() => setCreationMode("design")}
                        className={`relative overflow-hidden rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                          creationMode === "design"
                            ? "border border-violet-400/35 bg-white/[0.06] text-white"
                            : "border border-transparent text-slate-400 hover:border-white/15"
                        }`}
                      >
                        {creationMode === "design" && (
                          <span className="absolute top-0 left-0 w-16 h-16 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 80% at 0% 0%, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.06) 45%, transparent 70%)" }} />
                        )}
                        <Wand2 className="mr-1 inline h-3.5 w-3.5 relative z-[1]" /> <span className="relative z-[1]">{copy.modeDesign}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreationMode("clone")}
                        className={`relative overflow-hidden rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                          creationMode === "clone"
                            ? "border border-violet-400/35 bg-white/[0.06] text-white"
                            : "border border-transparent text-slate-400 hover:border-white/15"
                        }`}
                      >
                        {creationMode === "clone" && (
                          <span className="absolute top-0 left-0 w-16 h-16 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 80% at 0% 0%, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.06) 45%, transparent 70%)" }} />
                        )}
                        <Upload className="mr-1 inline h-3.5 w-3.5 relative z-[1]" /> <span className="relative z-[1]">{copy.modeClone}</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.08] px-4 py-3 text-xs leading-relaxed text-violet-100">
                    <div className="flex gap-2">
                      <Coins className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                      <p>{formatCopy(copy.voiceHostingCallout, { monthly: voiceMonthlyCredits })}</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{copy.languageHint}</span>
                      <select
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/15 bg-slate-800/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-violet-400/40 [&>option]:bg-slate-900 [&>option]:text-slate-100"
                      >
                        <option value="">{copy.languageAuto}</option>
                        {(voiceStudio.languageOptions || []).map((option) => (
                          <option key={option.code || "auto"} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {copy.genderOptional}
                      </span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[
                          { id: "", label: copy.genderAuto },
                          { id: "female", label: copy.genderFemale },
                          { id: "male", label: copy.genderMale },
                          { id: "neutral", label: copy.genderNeutral },
                        ].map((opt) => (
                          <button
                            key={opt.id || "auto"}
                            type="button"
                            onClick={() => setGender(opt.id)}
                            className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                              gender === opt.id
                                ? "border-violet-400/50 bg-violet-500/20 text-white"
                                : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {creationMode === "design" ? (
                      <>
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{copy.descriptionLabel}</span>
                          <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            rows={6}
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none"
                            placeholder={copy.descriptionPlaceholder}
                          />
                        </label>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>{description.trim().length}/2000 chars</span>
                          <span>{voices.length > 0 ? pricing.designRecreate || 250 : pricing.designInitial || 500} credits</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleGeneratePreviews}
                          disabled={busyAction === "design-previews" || !description.trim() || voices.length >= (limits.maxSavedVoicesPerModel || 3)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-violet-400/30 px-4 py-3 text-sm font-semibold text-violet-200 disabled:opacity-50"
                        >
                          {busyAction === "design-previews" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          {copy.buttonGeneratePreviews}
                        </button>
                        {previews.length > 0 && (
                          <div className="grid gap-3">
                            {previews.map((preview) => (
                              <button
                                key={preview.generatedVoiceId}
                                type="button"
                                onClick={() => setPickedPreviewId(preview.generatedVoiceId)}
                                className={`rounded-2xl border p-3 text-left ${
                                  pickedPreviewId === preview.generatedVoiceId
                                    ? "border-violet-400/40 bg-violet-500/10"
                                    : "border-white/10 bg-black/20"
                                }`}
                              >
                                <p className="text-xs font-semibold text-white">{copy.previewCandidate}</p>
                                <audio
                                  className="mt-3 w-full"
                                  controls
                                  preload="none"
                                  src={`data:audio/mpeg;base64,${preview.audioBase64}`}
                                />
                              </button>
                            ))}
                          </div>
                        )}
                        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
                          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
                          <span>{copy.consentDesign}</span>
                        </label>
                        <button
                          type="button"
                          onClick={handleConfirmDesignedVoice}
                          disabled={busyAction === "design-confirm" || !pickedPreviewId || !consent || voices.length >= (limits.maxSavedVoicesPerModel || 3)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-violet-400/45 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_14px_rgba(139,92,246,0.22)] disabled:opacity-50"
                        >
                          {busyAction === "design-confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                          {copy.buttonSaveDesigned}
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <p className="text-sm text-slate-300">{copy.cloneUploadHint}</p>
                          <button
                            type="button"
                            onClick={() => cloneInputRef.current?.click()}
                            className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium text-white hover:border-white/20"
                          >
                            <Upload className="h-4 w-4" />
                            {cloneFile ? cloneFile.name : copy.cloneChooseSample}
                          </button>
                          <input
                            ref={cloneInputRef}
                            type="file"
                            accept=".mp3,audio/mpeg"
                            className="hidden"
                            onChange={(event) => setCloneFile(event.target.files?.[0] || null)}
                          />
                          <p className="mt-2 text-xs text-slate-500">
                            {voices.length > 0 ? pricing.cloneRecreate || 500 : pricing.cloneInitial || 1000} credits
                          </p>
                        </div>
                        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
                          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
                          <span>{copy.consentClone}</span>
                        </label>
                        <button
                          type="button"
                          onClick={handleCloneVoice}
                          disabled={busyAction === "clone" || !cloneFile || !consent || voices.length >= (limits.maxSavedVoicesPerModel || 3)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {busyAction === "clone" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          {copy.buttonSaveCloned}
                        </button>
                      </>
                    )}

                    {voices.length >= (limits.maxSavedVoicesPerModel || 3) && (
                      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-sm text-amber-100">
                        {copy.limitReached}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{copy.historyTitle}</p>
                      <h3 className="text-lg font-semibold text-white">{copy.historyGeneratedAudio}</h3>
                    </div>
                  </div>

                  {history.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                      {copy.historyEmpty}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {history.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openGeneratedAudioModal(item)}
                          className="w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-violet-400/25 hover:bg-white/[0.04]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{item.voiceName || copy.historyItemDefaultName}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                {item.voiceType === "clone" ? copy.typeClone : copy.typeDesigned}
                                {item.isRegeneration ? ` · ${copy.historyRegenerated}` : ""}
                                {" · "}
                                {prettyDate(item.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 text-xs font-semibold text-white">
                              {item.creditsCost} <Coins className="h-3.5 w-3.5 text-yellow-400" />
                            </div>
                          </div>
                          <p className="mt-3 line-clamp-2 text-sm text-slate-300">{item.script}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span>{item.characterCount} chars</span>
                            <span>{formatDuration(Math.round(item.actualDurationSec || item.estimatedDurationSec || 0))}</span>
                            <span
                              className={
                                item.status === "failed"
                                  ? "text-red-400"
                                  : item.status === "completed"
                                    ? "text-emerald-400"
                                    : "text-amber-300"
                              }
                            >
                              {item.status}
                            </span>
                            <span className="text-violet-300">{copy.historyOpen}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {audioDetailId && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-audio-modal-title"
        >
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#12121a] p-6 shadow-2xl">
            {busyRegenAudioId && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl bg-black/60">
                <Loader2 className="h-10 w-10 animate-spin text-violet-300" />
                <p className="text-sm font-semibold text-white">{copy.modalRegeneratingTitle}</p>
                <p className="max-w-xs text-center text-xs text-slate-400">
                  {copy.modalRegeneratingBody}
                </p>
              </div>
            )}

            <div className="flex items-start justify-between gap-3">
              <div>
                <p id="voice-audio-modal-title" className="text-lg font-semibold text-white">
                  {copy.modalTitle}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {audioModalItem ? prettyDate(audioModalItem.createdAt) : ""}
                  {audioModalItem?.status === "processing" ? ` · ${copy.modalStatusProcessing}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={closeGeneratedAudioModal}
                className="rounded-xl border border-white/10 p-2 text-slate-400 hover:border-white/20 hover:text-white"
                aria-label={copy.modalCloseAria}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!audioModalItem ? (
              <p className="mt-6 text-sm text-slate-400">{copy.modalLoading}</p>
            ) : (
              <>
                <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {copy.modalVoiceLabel}
                </label>
                <select
                  value={modalVoiceId || ""}
                  onChange={(e) => setModalVoiceId(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/15 bg-slate-800/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-violet-400/40 [&>option]:bg-slate-900 [&>option]:text-slate-100"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.type === "clone" ? copy.voiceTypeCloneShort : copy.voiceTypeDesignShort}
                    </option>
                  ))}
                </select>

                <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {copy.modalScriptLabel}
                </label>
                <textarea
                  value={modalScript}
                  onChange={(e) => setModalScript(e.target.value)}
                  rows={8}
                  maxLength={limits.maxChars || 5000}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-400/30"
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>
                    {copy.modalRegenerationCost}{" "}
                    {Math.max(
                      0,
                      Math.ceil((modalScript.trim().length / 1000) * (pricing.audioRegenPer1kChars || 36)),
                    )}{" "}
                    {copy.modalCredits}
                  </span>
                  <span>
                    {modalScript.trim().length}/{limits.maxChars || 5000} chars
                  </span>
                </div>

                {audioModalItem.status === "processing" && !busyRegenAudioId ? (
                  <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    {copy.modalProcessing}
                  </div>
                ) : null}

                {audioModalItem.audioUrl ? (
                  <audio
                    key={`${audioModalItem.audioUrl}-${audioModalItem.completedAt || audioModalItem.updatedAt || ""}`}
                    className="mt-4 w-full"
                    controls
                    src={audioModalItem.audioUrl}
                    preload="none"
                  />
                ) : audioModalItem.errorMessage ? (
                  <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-xs text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{audioModalItem.errorMessage}</span>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-2">
                  {audioModalItem.audioUrl ? (
                    <a
                      href={audioModalItem.audioUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-white hover:border-white/20"
                    >
                      {copy.modalOpenFile}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleRegenerateInModal}
                    disabled={
                      !modalScript.trim() ||
                      Boolean(busyRegenAudioId) ||
                      !modalVoiceId ||
                      voices.length === 0
                    }
                    className="inline-flex items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-600/20 px-4 py-2 text-xs font-semibold text-violet-100 hover:border-violet-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {copy.modalRegenerateSameRow}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
