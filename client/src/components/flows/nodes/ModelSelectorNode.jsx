import { useEffect, useState } from "react";
import { User, Loader2, Check } from "lucide-react";
import BaseNode from "./BaseNode";
import { useFlowStore } from "../../../store/flowStore";

export default function ModelSelectorNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch("/api/models", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => setModels(d.models || d || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectedModel = models.find((m) => m.id === data.modelId);

  const pickModel = (model) => {
    updateNodeData(id, { modelId: model.id, modelName: model.name, modelThumb: model.photo1Url });
    setShowPicker(false);
  };

  return (
    <BaseNode
      id={id}
      type="model-selector"
      data={data}
      selected={selected}
      headerColor="#60a5fa"
      label={data.label || "Model Selector"}
      inputs={[]}
      outputs={[{ id: "model", type: "model", label: "Model" }]}
      creditCost={0}
    >
      {/* Currently selected — large preview */}
      {!showPicker && selectedModel && (
        <button
          onClick={() => setShowPicker(true)}
          className="w-full group relative rounded-lg overflow-hidden border border-white/[0.08] hover:border-blue-400/40 transition-all"
          style={{
            background: "linear-gradient(180deg, #08080b 0%, #0c0c12 100%)",
          }}
          title="Click to change model"
        >
          {selectedModel.photo1Url ? (
            <img src={selectedModel.photo1Url} alt={selectedModel.name} className="w-full aspect-square object-cover" />
          ) : (
            <div className="w-full aspect-square flex items-center justify-center bg-white/[0.03]">
              <User size={28} className="text-white/20" strokeWidth={1.4} />
            </div>
          )}
          {/* Caption overlay */}
          <div
            className="absolute bottom-0 left-0 right-0 px-2.5 py-1.5"
            style={{
              background: "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.85) 100%)",
            }}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-semibold text-white truncate">
                {selectedModel.name}
              </span>
              <span
                className="text-[7.5px] uppercase tracking-[0.15em] text-blue-300/90 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                change
              </span>
            </div>
          </div>
        </button>
      )}

      {/* Empty state — open picker */}
      {!showPicker && !selectedModel && (
        <button
          onClick={() => setShowPicker(true)}
          className="w-full rounded-lg border border-dashed border-white/[0.12] hover:border-blue-400/40
            bg-white/[0.015] hover:bg-blue-500/[0.04] transition-all p-4 flex flex-col items-center gap-1.5 group"
        >
          <User size={16} className="text-white/30 group-hover:text-blue-300/80 transition-colors" strokeWidth={1.6} />
          <span
            className="text-[8.5px] uppercase tracking-[0.15em] text-white/40 group-hover:text-white/65 transition-colors"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            select model
          </span>
        </button>
      )}

      {/* Picker — photo grid */}
      {showPicker && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[8px] uppercase tracking-[0.18em] font-bold text-white/45"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {loading ? "loading…" : `${models.length} models`}
            </span>
            {selectedModel && (
              <button
                onClick={() => setShowPicker(false)}
                className="text-[8px] uppercase tracking-[0.15em] text-white/40 hover:text-white/70 transition-colors"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                cancel
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-6 flex items-center justify-center">
              <Loader2 size={14} className="animate-spin text-white/20" />
            </div>
          ) : models.length === 0 ? (
            <p className="text-[9px] text-white/30 text-center py-3" style={{ fontFamily: "var(--font-mono)" }}>
              no models found
            </p>
          ) : (
            <div
              className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-0.5"
              style={{ scrollbarGutter: "stable" }}
            >
              {models.map((m) => {
                const isActive = m.id === data.modelId;
                return (
                  <button
                    key={m.id}
                    onClick={() => pickModel(m)}
                    className={`relative group/item aspect-square rounded-md overflow-hidden border transition-all
                      ${isActive
                        ? "border-blue-400/60"
                        : "border-white/[0.06] hover:border-blue-400/35"}
                    `}
                    title={m.name}
                    style={{
                      background: "#08080b",
                      boxShadow: isActive ? "0 0 0 1px rgba(96,165,250,0.35), 0 0 12px -4px rgba(96,165,250,0.5)" : "none",
                    }}
                  >
                    {m.photo1Url ? (
                      <img
                        src={m.photo1Url}
                        alt={m.name}
                        className="w-full h-full object-cover transition-transform duration-200 group-hover/item:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User size={12} className="text-white/20" strokeWidth={1.6} />
                      </div>
                    )}
                    {/* Name overlay on hover */}
                    <div
                      className="absolute bottom-0 left-0 right-0 px-1 py-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity"
                      style={{
                        background: "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.9) 100%)",
                      }}
                    >
                      <span className="text-[8px] text-white/90 truncate block leading-tight">{m.name}</span>
                    </div>
                    {/* Active checkmark */}
                    {isActive && (
                      <div
                        className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                        style={{
                          background: "#60a5fa",
                          boxShadow: "0 0 6px rgba(96,165,250,0.6)",
                        }}
                      >
                        <Check size={8} className="text-white" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
}
