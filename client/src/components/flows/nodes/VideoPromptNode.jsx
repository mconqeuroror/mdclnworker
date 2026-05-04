import { useFlowStore } from "../../../store/flowStore";
import BaseNode from "./BaseNode";

const DURATIONS = [5, 8, 10];
const MODELS = [
  { id: "kling-3.0", label: "Kling 3.0" },
  { id: "kling-2.6", label: "Kling 2.6" },
  { id: "wan-2.7", label: "Wan 2.7" },
  { id: "wan-2.6", label: "Wan 2.6" },
];
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const RESOLUTIONS = ["720p", "1080p"];

export default function VideoPromptNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  const mode = data.mode === "i2v" ? "i2v" : "t2v";
  return (
    <BaseNode
      id={id}
      type="video-prompt"
      data={data}
      selected={selected}
      headerColor="#f59e0b"
      label={data.label || "Video from Prompt"}
      inputs={[
        { id: "text", type: "text", label: "Prompt" },
        { id: "image", type: "image", label: "Ref (opt)" },
      ]}
      outputs={[{ id: "video", type: "video", label: "Video" }]}
      creditCost={70}
    >
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Video Model</label>
        <select
          value={data.videoModel || "kling-3.0"}
          onChange={(e) => updateNodeData(id, { videoModel: e.target.value })}
          className="w-full bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Mode</label>
        <div className="grid grid-cols-2 gap-1">
          {[
            { id: "t2v", label: "T2V" },
            { id: "i2v", label: "I2V" },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => updateNodeData(id, { mode: m.id })}
              className={`rounded px-1.5 py-1 text-[9px] font-semibold border transition-colors
                ${mode === m.id
                  ? "bg-amber-500/30 border-amber-300/70 text-amber-100"
                  : "bg-white/10 border-white/25 text-white/70 hover:border-white/45 hover:text-white"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[9px] text-white/70 block mb-1">Prompt (or connect Prompt node)</label>
        <textarea
          value={data.prompt || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          rows={3}
          className="w-full resize-none bg-white/10 border border-white/30 rounded px-2 py-1 text-[10px] text-white/90 outline-none placeholder:text-white/45"
          placeholder="Describe your video scene..."
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
        <label className="text-[9px] text-white/70 block mb-1">Duration (sec)</label>
        <div className="flex gap-1">
          {DURATIONS.map((d) => (
            <button
              key={d}
              onClick={() => updateNodeData(id, { duration: d })}
              className={`flex-1 py-1 rounded text-[9px] font-medium transition-colors
                ${data.duration === d ? "bg-amber-500/30 text-amber-400 border border-amber-500/40" : "bg-white/5 text-white/40 border border-white/10 hover:border-white/20"}`}
            >
              {d}s
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="text-[9px] text-white/70 block mb-1">Resolution</label>
          <select
            value={data.resolution || "720p"}
            onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
            className="w-full bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
          >
            {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-white/70 block mb-1">Aspect</label>
          <select
            value={data.aspectRatio || "9:16"}
            onChange={(e) => updateNodeData(id, { aspectRatio: e.target.value })}
            className="w-full bg-white/10 border border-white/30 rounded px-1.5 py-1 text-[10px] text-white/90 outline-none"
          >
            {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
    </BaseNode>
  );
}
