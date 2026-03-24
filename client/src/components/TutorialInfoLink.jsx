import { Info } from "lucide-react";
import toast from "react-hot-toast";

const LOCALE_STORAGE_KEY = "app_locale";
const COPY = {
  en: {
    label: "click to view tutorial",
    comingSoon: "Coming soon",
    openTutorial: "Open tutorial",
  },
  ru: {
    label: "нажмите для просмотра обучения",
    comingSoon: "Скоро",
    openTutorial: "Открыть обучение",
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

export default function TutorialInfoLink({ tutorialUrl, label, className = "" }) {
  const copy = COPY[resolveLocale()] || COPY.en;
  const resolvedLabel = label || copy.label;
  const handleOpen = () => {
    if (!tutorialUrl) {
      toast(copy.comingSoon);
      return;
    }
    window.open(tutorialUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      className={`inline-flex items-center gap-1.5 text-white hover:text-white/90 transition ${className}`}
      aria-label={copy.openTutorial}
      title={copy.openTutorial}
    >
      <Info className="w-4 h-4 text-white" />
      <span className="text-xs font-bold text-white">{resolvedLabel}</span>
    </button>
  );
}
