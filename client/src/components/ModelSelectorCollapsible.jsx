import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";

const PURPLE_CORNER_GLOW_STYLE = {
  background:
    "radial-gradient(ellipse 80% 80% at 0% 0%, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.06) 40%, transparent 65%)",
};

/**
 * Collapsible model picker with photo grid (matches Generate page pattern).
 */
export default function ModelSelectorCollapsible({
  models = [],
  selectedModelId,
  onSelect,
  accentColor = "violet",
  label = "Model",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedModelData = models.find((m) => m.id === selectedModelId);

  const bgGradients = {
    purple: "rgba(255,255,255,0.06)",
    cyan: "linear-gradient(135deg, rgba(34,211,238,0.15), rgba(20,184,166,0.1))",
    violet: "rgba(255,255,255,0.06)",
  };
  const accents = {
    purple: {
      border: "rgba(255,255,255,0.15)",
      borderActive: "rgba(255,255,255,0.35)",
      text: "text-white/70",
    },
    cyan: {
      border: "rgba(34,211,238,0.3)",
      borderActive: "rgba(34,211,238,0.6)",
      text: "text-cyan-300",
    },
    violet: {
      border: "rgba(255,255,255,0.15)",
      borderActive: "rgba(255,255,255,0.35)",
      text: "text-white/70",
    },
  };
  const gradients = {
    purple: "rgba(255,255,255,1)",
    cyan: "linear-gradient(135deg, #22D3EE, #14B8A6)",
    violet: "rgba(255,255,255,1)",
  };

  const handleSelect = (modelId) => {
    onSelect(modelId);
    setIsOpen(false);
  };

  const accent = accents[accentColor] || accents.violet;

  return (
    <div className="mb-1">
      <label className="mb-3 block text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
        {label}
      </label>
      <div
        className="overflow-hidden rounded-xl"
        style={{
          background: isOpen ? bgGradients[accentColor] : "rgba(22,22,30,0.55)",
          border: isOpen
            ? `1px solid ${accent.borderActive}`
            : `1px solid ${selectedModelData ? accent.border : "rgba(255,255,255,0.14)"}`,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="group relative flex w-full items-center gap-3 overflow-hidden p-3 text-white"
        >
          {(isOpen || selectedModelData) && (
            <span className="pointer-events-none absolute top-0 left-0 h-24 w-24" style={PURPLE_CORNER_GLOW_STYLE} />
          )}
          {(isOpen || selectedModelData) && (
            <span className="pointer-events-none absolute top-2 bottom-2 left-0 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
          )}
          {selectedModelData ? (
            <>
              <div
                className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg"
                style={{ border: `2px solid ${accent.border}` }}
              >
                <img
                  src={selectedModelData.photo1Url || ""}
                  alt={selectedModelData.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.style.display = "none";
                    const fb = e.target.parentElement?.querySelector?.(".model-fallback");
                    if (fb) fb.style.display = "flex";
                  }}
                />
                <div
                  className="model-fallback absolute inset-0 hidden items-center justify-center bg-slate-800 text-[8px] font-bold text-white"
                  style={{ display: "none" }}
                >
                  {selectedModelData.name?.charAt(0)}
                </div>
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className={`truncate text-sm font-medium ${accent.text}`}>{selectedModelData.name}</p>
                <p className="text-[10px] text-slate-500">{isOpen ? "Tap to close" : "Tap to change"}</p>
              </div>
            </>
          ) : models.length === 0 ? (
            <div className="flex-1 text-left">
              <p className="text-sm text-white">No models available</p>
              <p className="text-[10px] text-slate-500">Create one in Models tab</p>
            </div>
          ) : (
            <div className="flex-1 text-left">
              <p className="text-sm text-slate-400">Choose a model</p>
              <p className="text-[10px] text-slate-500">{models.length} available</p>
            </div>
          )}
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition-transform group-hover:text-slate-300 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && models.length > 0 && (
          <div className="px-3 pt-1 pb-3" style={{ borderTop: `1px solid ${accent.border}` }}>
            <div className="custom-scrollbar grid max-h-48 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 md:grid-cols-6">
              {models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelect(model.id)}
                  className="relative aspect-square overflow-hidden rounded-lg transition-all hover:scale-105"
                  style={{
                    border:
                      selectedModelId === model.id
                        ? `2px solid ${accent.borderActive}`
                        : "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <img
                    src={model.photo1Url || ""}
                    alt={model.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.style.display = "none";
                      const fb = e.target.parentElement?.querySelector?.(".model-fallback");
                      if (fb) fb.style.display = "flex";
                    }}
                  />
                  <div
                    className="model-fallback absolute inset-0 hidden items-center justify-center bg-slate-800/80 p-1 text-center text-sm font-bold text-white"
                    style={{ display: "none" }}
                  >
                    {model.name}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute right-0 bottom-0 left-0 p-1">
                    <p className="truncate text-center text-[8px] font-medium text-white">{model.name}</p>
                  </div>
                  {selectedModelId === model.id && (
                    <div className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
                  )}
                  {selectedModelId === model.id && (
                    <div className="absolute top-0.5 right-0.5">
                      <div
                        className="flex h-4 w-4 items-center justify-center rounded-full"
                        style={{ background: gradients[accentColor] }}
                      >
                        <Check className="h-2.5 w-2.5 text-slate-900" />
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
