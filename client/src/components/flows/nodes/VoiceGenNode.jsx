import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

export default function VoiceGenNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  return (
    <BaseNode
      id={id}
      type="voice-gen"
      data={data}
      selected={selected}
      headerColor="#f472b6"
      label={data.label || "Voice Generation"}
      inputs={[
        { id: "model", type: "model", label: "Model" },
        { id: "text", type: "text", label: "Script" },
      ]}
      outputs={[{ id: "audio", type: "audio", label: "Audio" }]}
      creditCost={25}
    >
      <div className="space-y-2">
        <textarea
          value={data.script || ""}
          onChange={(e) => updateNodeData(id, { script: e.target.value })}
          placeholder="Script (used when no input connected)…"
          rows={2}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80
            placeholder:text-white/20 outline-none focus:border-pink-400/40 resize-none leading-relaxed"
        />
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className="text-[8px] text-white/40 block mb-0.5">Stability</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={data.stability ?? 0.5}
              onChange={(e) => updateNodeData(id, { stability: parseFloat(e.target.value) })}
              className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white/80 outline-none"
            />
          </div>
          <div>
            <label className="text-[8px] text-white/40 block mb-0.5">Similarity</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={data.similarityBoost ?? 0.75}
              onChange={(e) => updateNodeData(id, { similarityBoost: parseFloat(e.target.value) })}
              className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white/80 outline-none"
            />
          </div>
          <div>
            <label className="text-[8px] text-white/40 block mb-0.5">Style</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={data.style ?? 0.0}
              onChange={(e) => updateNodeData(id, { style: parseFloat(e.target.value) })}
              className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white/80 outline-none"
            />
          </div>
        </div>
      </div>
    </BaseNode>
  );
}
