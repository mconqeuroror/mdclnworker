import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

const RATIOS = ["1:1", "9:16", "16:9", "4:5", "3:4", "21:9", "auto"];
const MODELS = [
  { id: "nano-banana-pro", label: "Nano Banana" },
  { id: "flux-kontext-pro", label: "Flux Kontext Pro" },
  { id: "flux-kontext-max", label: "Flux Kontext Max" },
  { id: "ideogram-v3-text", label: "Ideogram V3 Text" },
  { id: "ideogram-v3-edit", label: "Ideogram V3 Edit" },
  { id: "ideogram-v3-remix", label: "Ideogram V3 Remix" },
  { id: "wan-2-7-image", label: "Wan 2.7 Image" },
  { id: "wan-2-7-image-pro", label: "Wan 2.7 Image Pro" },
  { id: "seedream-v4-5-edit", label: "Seedream 5.0 Lite" },
  { id: "gpt-image-2", label: "GPT Image 2" },
];

function ModeToggle({ value, onChange }) {
  return (
    <div>
      <label className="text-[9px] text-white/70 block mb-1">Generation Mode</label>
      <div className="grid grid-cols-2 gap-1">
        {[
          { id: "t2i", label: "T2I" },
          { id: "i2i", label: "I2I" },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={`rounded px-1.5 py-1 text-[9px] font-semibold border transition-colors
              ${value === m.id
                ? "bg-violet-500/30 border-violet-300/70 text-violet-100"
                : "bg-white/10 border-white/25 text-white/70 hover:border-white/45 hover:text-white"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CreatorStudioNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  const mode = data.mode === "i2i" ? "i2i" : "t2i";
  const model = data.generationModel || data.model || "nano-banana-pro";
  return (
    <BaseNode
      id={id}
      type="creator-studio"
      data={data}
      selected={selected}
      headerColor="#a78bfa"
      label={data.label || "Creator Studio"}
      inputs={[
        { id: "text", type: "text", label: "Prompt" },
        { id: "image", type: "image", label: "Input Image (opt)" },
      ]}
      outputs={[{ id: "image", type: "image", label: "Image" }]}
      creditCost={10}
    >
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Model</label>
        <select
          value={model}
          onChange={(e) => updateNodeData(id, { generationModel: e.target.value })}
          className="w-full bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      <ModeToggle value={mode} onChange={(next) => updateNodeData(id, { mode: next })} />

      <div>
        <label className="text-[9px] text-white/70 block mb-1">
          Prompt (or connect a Prompt node)
        </label>
        <textarea
          value={data.prompt || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          rows={3}
          className="w-full resize-none bg-white/10 border border-white/30 rounded px-2 py-1 text-[10px] text-white/90 outline-none placeholder:text-white/45"
          placeholder="Describe your image..."
        />
      </div>

      <label className="flex items-center justify-between px-2 py-1 rounded border border-white/25 bg-white/10">
        <span className="text-[9px] text-white/80 font-medium">AI Enhance Prompt</span>
        <input
          type="checkbox"
          checked={data.aiEnhancePrompt === true}
          onChange={(e) => updateNodeData(id, { aiEnhancePrompt: e.target.checked })}
          className="accent-violet-400 w-3.5 h-3.5"
        />
      </label>

      <div>
        <label className="text-[9px] text-white/70 block mb-1">Aspect Ratio</label>
        <select
          value={data.aspectRatio || "9:16"}
          onChange={(e) => updateNodeData(id, { aspectRatio: e.target.value })}
          className="w-full bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
        >
          {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="flex gap-1 items-center">
        <label className="text-[9px] text-white/70">Qty</label>
        <select
          value={data.numImages || 1}
          onChange={(e) => updateNodeData(id, { numImages: Number(e.target.value) })}
          className="flex-1 bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
        >
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
    </BaseNode>
  );
}
