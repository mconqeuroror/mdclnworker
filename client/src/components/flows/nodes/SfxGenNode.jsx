import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

const DURATIONS = [2, 5, 10, 15];

export default function SfxGenNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  return (
    <BaseNode
      id={id}
      type="sfx-gen"
      data={data}
      selected={selected}
      headerColor="#f472b6"
      label={data.label || "Sound Effect"}
      inputs={[{ id: "text", type: "text", label: "Prompt" }]}
      outputs={[{ id: "audio", type: "audio", label: "Audio" }]}
      creditCost={12}
    >
      <div className="space-y-2">
        <textarea
          value={data.prompt || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          placeholder="Describe the sound… e.g. 'distant thunder'"
          rows={2}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/80
            placeholder:text-white/20 outline-none focus:border-pink-400/40 resize-none leading-relaxed"
        />
        <div>
          <label className="text-[9px] text-white/40 block mb-1">Duration (sec)</label>
          <div className="flex gap-1">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => updateNodeData(id, { durationSeconds: d })}
                className={`flex-1 py-1 rounded text-[9px] font-medium transition-colors
                  ${(data.durationSeconds ?? 5) === d
                    ? "bg-pink-500/30 text-pink-200 border border-pink-500/40"
                    : "bg-white/5 text-white/40 border border-white/10 hover:border-white/20"}`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
      </div>
    </BaseNode>
  );
}
