import { useState } from "react";
import { BookOpen, X, ArrowRight } from "lucide-react";
import { resolveLocale } from "./generateAIModelFormCopy";

const STORAGE_KEYS = {
  sfw: "course-tip-sfw-dismissed",
  nsfw: "course-tip-nsfw-dismissed",
};

const COURSE_TIP_COPY = {
  en: {
    messageSfw:
      "First time generating? Watch our course to learn how to get the best results from your AI model.",
    messageNsfw:
      "New to NSFW generation? Watch our course to learn LoRA training, image generation, and video creation.",
    watchCourse: "Watch Course",
  },
  ru: {
    messageSfw:
      "Первый раз генерируете? Посмотрите курс — как получить лучший результат от ИИ-модели.",
    messageNsfw:
      "Новичок в NSFW-генерации? В курсе — LoRA, изображения и видео.",
    watchCourse: "Смотреть курс",
  },
};

export default function CourseTipBanner({ type = "sfw", onNavigateToCourse }) {
  const locale = resolveLocale();
  const copy = COURSE_TIP_COPY[locale] || COURSE_TIP_COPY.en;
  const storageKey = STORAGE_KEYS[type] || STORAGE_KEYS.sfw;
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(storageKey) === "true";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  const handleGoToCourse = () => {
    if (onNavigateToCourse) {
      onNavigateToCourse();
    }
  };

  const message = type === "nsfw"
    ? "New to NSFW generation? Watch our course to learn LoRA training, image generation, and video creation."
    : "First time generating? Watch our course to learn how to get the best results from your AI model.";

  return (
    <div className="mb-4 sm:mb-6 p-3 sm:p-4 rounded-xl glass-panel flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 backdrop-blur-xl border border-white/20" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <BookOpen className="w-4 h-4 text-amber-700" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-300 leading-relaxed">
          {message}
        </p>
        <button
          onClick={handleGoToCourse}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          data-testid={`button-course-tip-${type}`}
        >
          {copy.watchCourse}
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <button
        onClick={handleDismiss}
        className="text-slate-400 hover:text-slate-300 transition-colors flex-shrink-0 p-1"
        data-testid={`button-dismiss-course-tip-${type}`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
