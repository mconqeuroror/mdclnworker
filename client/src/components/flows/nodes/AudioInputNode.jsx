import { useCallback, useRef, useState } from "react";
import { Upload, Link2, X, Music } from "lucide-react";
import BaseNode from "./BaseNode";
import { useFlowStore } from "../../../store/flowStore";

export default function AudioInputNode({ id, data, selected }) {
  const { updateNodeData } = useFlowStore();
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("audio/")) return;
    const reader = new FileReader();
    reader.onload = (e) => updateNodeData(id, { audioUrl: e.target.result, mode: "upload" });
    reader.readAsDataURL(file);
  }, [id, updateNodeData]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const clear = (e) => {
    e.stopPropagation();
    updateNodeData(id, { audioUrl: "", mode: "url" });
  };

  return (
    <BaseNode
      id={id}
      type="audio-input"
      data={data}
      selected={selected}
      headerColor="#60a5fa"
      label={data.label || "Audio Input"}
      inputs={[]}
      outputs={[{ id: "audio", type: "audio", label: "Audio" }]}
      creditCost={0}
    >
      <div
        className={`group relative rounded-md flex flex-col items-center justify-center cursor-pointer
          transition-all overflow-hidden ${data.audioUrl ? "p-2" : "p-4"}`}
        style={{
          minHeight: "70px",
          background: dragOver
            ? "linear-gradient(135deg, rgba(244,114,182,0.14) 0%, rgba(244,114,182,0.04) 100%)"
            : "linear-gradient(135deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0.005) 100%)",
          border: `1px dashed ${dragOver ? "rgba(244,114,182,0.55)" : "rgba(255,255,255,0.10)"}`,
        }}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileRef.current?.click()}
      >
        {data.audioUrl ? (
          <div className="w-full flex flex-col items-stretch gap-1.5 relative">
            <audio src={data.audioUrl} controls className="w-full" />
            <button
              onClick={clear}
              className="absolute top-0 right-0 w-4 h-4 rounded-full flex items-center justify-center
                bg-black/60 hover:bg-red-500/80 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
              title="Clear"
            >
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <>
            <Music size={14} className="text-white/30 group-hover:text-pink-300/70 transition-colors mb-1.5" strokeWidth={1.6} />
            <span className="text-[9px] text-white/35 group-hover:text-white/55 transition-colors">
              Click or drop audio
            </span>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      <div className="flex items-center gap-1.5 mt-2">
        <Link2 size={9} className="text-white/25 flex-shrink-0" strokeWidth={1.8} />
        <input
          type="text"
          placeholder="paste URL…"
          value={data.mode === "url" ? (data.audioUrl || "") : ""}
          onChange={(e) => updateNodeData(id, { audioUrl: e.target.value, mode: "url" })}
          className="flex-1 bg-transparent text-[10px] text-white/80 placeholder:text-white/20 outline-none min-w-0
            border-b border-white/[0.06] focus:border-pink-400/40 transition-colors py-0.5"
          style={{ fontFamily: "var(--font-mono)" }}
        />
      </div>
    </BaseNode>
  );
}
