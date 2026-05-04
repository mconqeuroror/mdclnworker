import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

export default function NSFWVideoExtendNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  return (
    <BaseNode
      id={id}
      type="nsfw-video-extend"
      data={data}
      selected={selected}
      headerColor="#f87171"
      label={data.label || "NSFW Extend Video"}
      inputs={[
        { id: "video", type: "video", label: "Video" },
        { id: "text", type: "text", label: "Prompt (opt)" },
      ]}
      outputs={[{ id: "video", type: "video", label: "Extended Video" }]}
      creditCost={50}
    >
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Prompt (optional)</label>
        <textarea
          value={data.prompt || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          rows={3}
          className="w-full resize-none bg-white/10 border border-white/30 rounded px-2 py-1 text-[10px] text-white/90 outline-none placeholder:text-white/45"
          placeholder="How should the extension continue?"
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
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Extend By</label>
        <div className="grid grid-cols-2 gap-1">
          {[5, 8].map((d) => (
            <button
              key={d}
              onClick={() => updateNodeData(id, { duration: d })}
              className={`rounded px-1.5 py-1 text-[9px] font-semibold border transition-colors
                ${Number(data.duration || 5) === d
                  ? "bg-rose-500/30 border-rose-300/70 text-rose-100"
                  : "bg-white/10 border-white/25 text-white/70 hover:border-white/45 hover:text-white"}`}
            >
              +{d}s
            </button>
          ))}
        </div>
      </div>
    </BaseNode>
  );
}
