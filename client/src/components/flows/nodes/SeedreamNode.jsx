import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

const RATIOS = ["1:1", "9:16", "16:9", "4:5", "3:4"];

export default function SeedreamNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  return (
    <BaseNode
      id={id}
      type="seedream-avatar"
      data={data}
      selected={selected}
      headerColor="#a78bfa"
      label={data.label || "Avatar Generator HD"}
      inputs={[
        { id: "model", type: "model", label: "Model" },
        { id: "text", type: "text", label: "Prompt" },
      ]}
      outputs={[{ id: "image", type: "image", label: "Image" }]}
      creditCost={10}
    >
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Prompt (or connect Prompt node)</label>
        <textarea
          value={data.prompt || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          rows={3}
          className="w-full resize-none bg-white/10 border border-white/30 rounded px-2 py-1 text-[10px] text-white/90 outline-none placeholder:text-white/45"
          placeholder="Describe your generation..."
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
    </BaseNode>
  );
}
