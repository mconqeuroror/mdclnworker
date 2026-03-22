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
  if (x === "female") return "Female";
  if (x === "male") return "Male";
  if (x === "neutral") return "Neutral";
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
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const canUseVoiceStudio = hasPremiumAccess(user);

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
  const creditsAvailable = voiceStudio.creditsAvailable ?? user?.credits ?? 0;
  const voiceStudioErrorMessage = getApiErrorMessage(
    voiceStudioQuery.error,
    "Failed to load Voice Studio for this model.",
  );
  const modelsErrorMessage = getApiErrorMessage(
    modelsQuery.error,
    "Failed to load your models.",
  );
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) || voices[0] || null;
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
    if (!voices.some((voice) => voice.id === selectedVoiceId)) {
      const defaultVoice = voices.find((voice) => voice.isDefault) || voices[0];
      setSelectedVoiceId(defaultVoice.id);
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
      toast.error("Description must be at least 20 characters.");
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
      toast.success("Previews ready. Pick one and save it.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to generate design previews");
    } finally {
      setBusyAction("");
    }
  };

  const handleConfirmDesignedVoice = async () => {
    if (!selectedModelId) return;
    if (!pickedPreviewId) return toast.error("Pick a preview first.");
    if (!consent) return toast.error("Confirm consent first.");
    setBusyAction("design-confirm");
    try {
      await modelAPI.confirmDesignedVoice(selectedModelId, {
        generatedVoiceId: pickedPreviewId,
        voiceDescription: description.trim(),
        consentConfirmed: true,
        ...(language ? { language } : {}),
        ...(gender ? { gender } : {}),
      });
      toast.success("Designed voice saved.");
      setDescription("");
      setPreviews([]);
      setPickedPreviewId("");
      setConsent(false);
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save designed voice");
    } finally {
      setBusyAction("");
    }
  };

  const handleCloneVoice = async () => {
    if (!selectedModelId) return;
    if (!cloneFile) return toast.error("Upload an MP3 sample first.");
    if (!consent) return toast.error("Confirm consent first.");
    const formData = new FormData();
    formData.append("audio", cloneFile);
    formData.append("consent", "true");
    if (language) formData.append("language", language);
    if (gender) formData.append("gender", gender);
    setBusyAction("clone");
    try {
      await modelAPI.cloneVoice(selectedModelId, formData);
      toast.success("Cloned voice saved.");
      setCloneFile(null);
      setConsent(false);
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || "Voice clone failed");
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
      toast.success("Default model voice updated.");
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to select voice");
    } finally {
      setBusyAction("");
    }
  };

  const handleDeleteVoice = async (voice) => {
    if (!selectedModelId) return;
    if (!window.confirm(`Delete voice "${voice.name}"?`)) return;
    setBusyAction(`delete:${voice.id}`);
    try {
      await modelAPI.deleteVoice(selectedModelId, voice.id);
      toast.success("Voice deleted.");
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to delete voice");
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
    if (!vid) return toast.error("Select a voice first.");
    const script = modalScript.trim();
    if (!script) return toast.error("Script is empty.");
    const regenCost = Math.max(
      0,
      Math.ceil((script.length / 1000) * (pricing.audioRegenPer1kChars || 36)),
    );
    if (creditsAvailable < regenCost) {
      toast.error("Insufficient credits for regeneration.");
      return;
    }
    setBusyRegenAudioId(audioDetailId);
    try {
      await modelAPI.generateVoiceAudio(selectedModelId, {
        voiceId: vid,
        script,
        regenerateFromId: audioDetailId,
      });
      toast.success("Audio regenerated — same history entry updated.");
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || "Regeneration failed");
    } finally {
      setBusyRegenAudioId(null);
    }
  };

  const handleGenerateAudio = async () => {
    if (!selectedModelId) return;
    if (!selectedVoice?.id) return toast.error("Select a voice first.");
    if (!audioScript.trim()) return toast.error("Write a script first.");
    setBusyAction("generate-audio");
    try {
      await modelAPI.generateVoiceAudio(selectedModelId, {
        voiceId: selectedVoice.id,
        script: audioScript.trim(),
      });
      toast.success("Audio generated.");
      setAudioScript("");
      await refreshStudio();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to generate audio");
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
              <h2 className="text-xl font-bold text-white">Voice Studio</h2>
              <p className="text-sm text-slate-400">Available for paid subscription users only.</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Create up to 3 saved voices per model, generate ElevenLabs audio with Multilingual v3 pricing,
            and keep a per-model history of generated clips once your subscription is active.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Voice Studio</h1>
          <p className="text-sm text-slate-400">
            Multilingual v3 audio generation, up to {limits.maxSavedVoicesPerModel || 3} saved voices per model.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          <span className="text-slate-500">Credits available:</span>{" "}
          <span className="font-semibold text-white">{creditsAvailable}</span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          {modelsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading models...
            </div>
          ) : modelsQuery.isError ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-4 text-sm text-red-200">
              {modelsErrorMessage}
            </div>
          ) : models.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
              Create a model first to use Voice Studio.
            </div>
          ) : (
            <ModelSelectorCollapsible
              models={models}
              selectedModelId={selectedModelId}
              onSelect={setSelectedModelId}
              label="Model"
              accentColor="violet"
            />
          )}
        </div>

        <div className="space-y-6">
          {!selectedModelId ? null : voiceStudioQuery.isLoading ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-sm text-slate-400 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading voice studio...
            </div>
          ) : voiceStudioQuery.isError ? (
            <div className="rounded-3xl border border-red-400/20 bg-red-500/5 p-8 text-sm text-red-200">
              {voiceStudioErrorMessage}
            </div>
          ) : !model ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-sm text-slate-400">
              Select a model to continue.
            </div>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Saved Voices</p>
                      <h2 className="mt-1 text-lg font-semibold text-white">{model.name}</h2>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
                      {voices.length}/{limits.maxSavedVoicesPerModel || 3} saved
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {voices.map((voice) => (
                      <div
                        key={voice.id}
                        className={`rounded-2xl border p-4 transition ${
                          selectedVoiceId === voice.id
                            ? "border-violet-400/40 bg-violet-500/10"
                            : "border-white/10 bg-black/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{voice.name}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {voice.type === "clone" ? "Voice clone" : "Designed voice"}
                              {genderLabel(voice.gender) ? ` · ${genderLabel(voice.gender)}` : ""}
                              {voice.isDefault ? " · Default" : ""}
                            </p>
                          </div>
                          {voice.isDefault && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                        </div>

                        {voice.previewUrl ? (
                          <audio className="mt-3 w-full" controls src={voice.previewUrl} preload="none" />
                        ) : (
                          <p className="mt-3 text-xs text-slate-500">No preview available.</p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedVoiceId(voice.id)}
                            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white hover:border-white/20"
                          >
                            Use for audio
                          </button>
                          {!voice.isDefault && (
                            <button
                              type="button"
                              onClick={() => handleSelectDefault(voice.id)}
                              disabled={busyAction === `select:${voice.id}`}
                              className="rounded-xl border border-violet-400/30 px-3 py-2 text-xs font-medium text-violet-200 hover:border-violet-300/50 disabled:opacity-50"
                            >
                              {busyAction === `select:${voice.id}` ? "Saving..." : "Make default"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteVoice(voice)}
                            disabled={busyAction === `delete:${voice.id}`}
                            className="rounded-xl border border-red-400/20 px-3 py-2 text-xs font-medium text-red-300 hover:border-red-300/40 disabled:opacity-50"
                          >
                            {busyAction === `delete:${voice.id}` ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    ))}

                    {voices.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                        No voices yet. Create one below to unlock audio generation for this model.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center gap-2">
                    <Music4 className="h-5 w-5 text-violet-300" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Generate Audio</p>
                      <h3 className="text-lg font-semibold text-white">Final voice output</h3>
                    </div>
                  </div>

                  {voices.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-200">
                      Create at least one saved voice to generate audio.
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs text-slate-400">
                          Selected voice: <span className="font-semibold text-white">{selectedVoice?.name || "None"}</span>
                        </p>
                        <textarea
                          value={audioScript}
                          onChange={(event) => setAudioScript(event.target.value)}
                          rows={8}
                          maxLength={limits.maxChars || 5000}
                          placeholder="Write the script you want this model voice to speak..."
                          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-violet-400/30"
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                          <div className="flex items-center gap-3">
                            <span>{estimatedChars}/{limits.maxChars || 5000} chars</span>
                            <span>~{formatDuration(estimatedSecs)}</span>
                          </div>
                          <div className="flex items-center gap-1 font-semibold text-white">
                            {estimatedCost || 0} <Coins className="h-3.5 w-3.5 text-yellow-400" />
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          New audio: {pricing.audioPer1kChars || 72} credits / 1K chars. Regeneration (from history
                          modal): {pricing.audioRegenPer1kChars || 36} credits / 1K chars.
                        </p>
                        <button
                          type="button"
                          onClick={handleGenerateAudio}
                          disabled={!selectedVoice || !audioScript.trim() || busyAction === "generate-audio" || creditsAvailable < estimatedCost}
                          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyAction === "generate-audio" ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" /> Generating...
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-4 w-4" /> Generate Audio
                            </>
                          )}
                        </button>
                        {audioScript.trim() && creditsAvailable < estimatedCost && (
                          <p className="mt-3 text-xs text-red-400">
                            Insufficient credits for this request.
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
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Create Voice</p>
                      <h3 className="text-lg font-semibold text-white">Design or clone</h3>
                    </div>
                    <div className="flex rounded-2xl border border-white/10 bg-black/20 p-1">
                      <button
                        type="button"
                        onClick={() => setCreationMode("design")}
                        className={`rounded-xl px-3 py-2 text-xs font-medium ${creationMode === "design" ? "bg-violet-600 text-white" : "text-slate-400"}`}
                      >
                        <Wand2 className="mr-1 inline h-3.5 w-3.5" /> Design
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreationMode("clone")}
                        className={`rounded-xl px-3 py-2 text-xs font-medium ${creationMode === "clone" ? "bg-violet-600 text-white" : "text-slate-400"}`}
                      >
                        <Upload className="mr-1 inline h-3.5 w-3.5" /> Clone
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Language hint</span>
                      <select
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-white/15 bg-slate-800/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-violet-400/40 [&>option]:bg-slate-900 [&>option]:text-slate-100"
                      >
                        <option value="">Auto / not specified</option>
                        {(voiceStudio.languageOptions || []).map((option) => (
                          <option key={option.code || "auto"} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Gender (optional)
                      </span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[
                          { id: "", label: "Auto" },
                          { id: "female", label: "Female" },
                          { id: "male", label: "Male" },
                          { id: "neutral", label: "Neutral" },
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
                          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Voice description</span>
                          <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            rows={6}
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none"
                            placeholder="Describe the voice style, tone, pacing, accent, emotion, and personality..."
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
                          Generate previews
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
                                <p className="text-xs font-semibold text-white">Preview candidate</p>
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
                          <span>I confirm I have permission to create and save this voice.</span>
                        </label>
                        <button
                          type="button"
                          onClick={handleConfirmDesignedVoice}
                          disabled={busyAction === "design-confirm" || !pickedPreviewId || !consent || voices.length >= (limits.maxSavedVoicesPerModel || 3)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {busyAction === "design-confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                          Save designed voice
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <p className="text-sm text-slate-300">Upload one MP3 sample to create an instant voice clone.</p>
                          <button
                            type="button"
                            onClick={() => cloneInputRef.current?.click()}
                            className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium text-white hover:border-white/20"
                          >
                            <Upload className="h-4 w-4" />
                            {cloneFile ? cloneFile.name : "Choose MP3 sample"}
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
                          <span>I confirm I own this sample or have permission to clone it.</span>
                        </label>
                        <button
                          type="button"
                          onClick={handleCloneVoice}
                          disabled={busyAction === "clone" || !cloneFile || !consent || voices.length >= (limits.maxSavedVoicesPerModel || 3)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {busyAction === "clone" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          Save cloned voice
                        </button>
                      </>
                    )}

                    {voices.length >= (limits.maxSavedVoicesPerModel || 3) && (
                      <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-sm text-amber-100">
                        You have reached the maximum saved voices for this model. Delete one to create another.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">History</p>
                      <h3 className="text-lg font-semibold text-white">Generated audio</h3>
                    </div>
                  </div>

                  {history.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                      No generated audio yet.
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
                              <p className="text-sm font-semibold text-white">{item.voiceName || "Voice audio"}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                {item.voiceType === "clone" ? "Voice clone" : "Designed voice"}
                                {item.isRegeneration ? " · Regenerated" : ""}
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
                            <span className="text-violet-300">Open →</span>
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
                <p className="text-sm font-semibold text-white">Regenerating audio…</p>
                <p className="max-w-xs text-center text-xs text-slate-400">
                  Replacing this history entry with the new render. This can take a little while.
                </p>
              </div>
            )}

            <div className="flex items-start justify-between gap-3">
              <div>
                <p id="voice-audio-modal-title" className="text-lg font-semibold text-white">
                  Generated audio
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {audioModalItem ? prettyDate(audioModalItem.createdAt) : ""}
                  {audioModalItem?.status === "processing" ? " · Processing" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={closeGeneratedAudioModal}
                className="rounded-xl border border-white/10 p-2 text-slate-400 hover:border-white/20 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!audioModalItem ? (
              <p className="mt-6 text-sm text-slate-400">Loading…</p>
            ) : (
              <>
                <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Voice
                </label>
                <select
                  value={modalVoiceId || ""}
                  onChange={(e) => setModalVoiceId(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/15 bg-slate-800/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-violet-400/40 [&>option]:bg-slate-900 [&>option]:text-slate-100"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.type === "clone" ? "(clone)" : "(design)"}
                    </option>
                  ))}
                </select>

                <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Script
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
                    Regeneration:{" "}
                    {Math.max(
                      0,
                      Math.ceil((modalScript.trim().length / 1000) * (pricing.audioRegenPer1kChars || 36)),
                    )}{" "}
                    credits
                  </span>
                  <span>
                    {modalScript.trim().length}/{limits.maxChars || 5000} chars
                  </span>
                </div>

                {audioModalItem.status === "processing" && !busyRegenAudioId ? (
                  <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    Processing…
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
                      Open file
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
                    Regenerate (same history row)
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
