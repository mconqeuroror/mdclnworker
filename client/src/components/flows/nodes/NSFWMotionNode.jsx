import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

export default function NSFWMotionNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  return (
    <BaseNode
      id={id}
      type="nsfw-motion"
      data={data}
      selected={selected}
      headerColor="#f87171"
      label={data.label || "NSFW Motion"}
      inputs={[
        { id: "image", type: "image", label: "Image" },
        { id: "video", type: "video", label: "Motion" },
        { id: "model", type: "model", label: "Model" },
        { id: "text", type: "text", label: "Prompt (opt)" },
      ]}
      outputs={[{ id: "video", type: "video", label: "Video" }]}
      creditCost={90}
    >
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Prompt (optional)</label>
        <textarea
          value={data.prompt || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          rows={3}
          className="w-full resize-none bg-white/10 border border-white/30 rounded px-2 py-1 text-[10px] text-white/90 outline-none placeholder:text-white/45"
          placeholder="Optional style direction..."
        />
      </div>
      <label className="flex items-center justify-between px-2 py-1 rounded border border-white/25 bg-white/10">
        <span className="text-[9px] text-white/80 font-medium">AI Enhance Prompt</span>
        <input
          type="checkbox"
          checked={data.aiEnhancePrompt === true}
          onChange={(e) => updateNodeData(id, { aiEnhancePrompt: e.target.checked })}
          className="accent-rose-400 w-3.5 h-3.5"
        />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="text-[9px] text-white/70 block mb-1">Duration</label>
          <input
            type="number"
            min={1}
            max={30}
            value={Number(data.duration || 5)}
            onChange={(e) => updateNodeData(id, { duration: Number(e.target.value) })}
            className="w-full bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
          />
        </div>
        <div>
          <label className="text-[9px] text-white/70 block mb-1">Skip Sec</label>
          <input
            type="number"
            min={0}
            max={60}
            value={Number(data.skipSeconds || 0)}
            onChange={(e) => updateNodeData(id, { skipSeconds: Number(e.target.value) })}
            className="w-full bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
          />
        </div>
      </div>
    </BaseNode>
  );
}
