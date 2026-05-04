import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span className="text-[9px] text-white/40">{label}</span>
        <span className="text-[9px] text-white/60">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-violet-500 cursor-pointer"
      />
    </div>
  );
}

export default function MCXNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  return (
    <BaseNode
      id={id}
      type="mcx-img2img"
      data={data}
      selected={selected}
      headerColor="#a78bfa"
      label={data.label || "ModelClone-X"}
      inputs={[
        { id: "image", type: "image", label: "Input Image" },
        { id: "model", type: "model", label: "Model (opt)" },
        { id: "text", type: "text", label: "Prompt" },
      ]}
      outputs={[{ id: "image", type: "image", label: "Output" }]}
      creditCost={15}
    >
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Prompt (or connect Prompt node)</label>
        <textarea
          value={data.prompt || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          rows={3}
          className="w-full resize-none bg-white/10 border border-white/30 rounded px-2 py-1 text-[10px] text-white/90 outline-none placeholder:text-white/45"
          placeholder="Describe image-to-image changes..."
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
      <Slider label="LoRA Strength" value={data.loraStrength ?? 0.85} min={0} max={1} step={0.05}
        onChange={(v) => updateNodeData(id, { loraStrength: v })} />
      <Slider label="Denoise" value={data.denoise ?? 0.75} min={0} max={1} step={0.05}
        onChange={(v) => updateNodeData(id, { denoise: v })} />
    </BaseNode>
  );
}
