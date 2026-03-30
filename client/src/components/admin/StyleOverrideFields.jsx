export default function StyleOverrideFields({ targetId, activeBreakpoint, styleOverrides, onPatch, onClear }) {
  const entry = styleOverrides?.[targetId] ?? {};
  const o     = entry[activeBreakpoint] ?? {};

  const hexVal = (v) => (v && v.startsWith("#") && v.length >= 4 ? v.slice(0, 7) : "#ffffff");

  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <p className="text-xs font-medium text-white">
        Style Overrides
        <span className="ml-1.5 text-[0.65rem] font-normal text-amber-200/80">· {activeBreakpoint}</span>
      </p>

      {/* Text color + Background */}
      <div className="grid grid-cols-2 gap-2">
        {[["color", "Text color"], ["backgroundColor", "Background"]].map(([key, label]) => (
          <label key={key} className="block text-[0.65rem] text-gray-400">
            {label}
            <div className="mt-1 flex gap-1.5">
              <input
                type="color"
                value={hexVal(o[key])}
                onChange={e => onPatch({ [key]: e.target.value })}
                className="h-9 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
              />
              <input
                type="text"
                value={o[key] ?? ""}
                onChange={e => onPatch({ [key]: e.target.value || undefined })}
                placeholder="#fff"
                className="flex-1 rounded border border-white/15 bg-black/40 px-2 text-xs text-white focus:border-blue-500/60 focus:outline-none"
              />
            </div>
          </label>
        ))}
      </div>

      {/* Font size */}
      <label className="block text-[0.65rem] text-gray-400">
        Font size (rem)
        <input
          type="text"
          value={o.fontSize?.replace("rem", "") ?? ""}
          onChange={e => {
            const v = e.target.value.trim();
            onPatch({ fontSize: v ? `${v}rem` : undefined });
          }}
          placeholder="1.25"
          className="mt-1 w-full rounded border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-blue-500/60 focus:outline-none"
        />
      </label>

      {/* Font weight */}
      <label className="block text-[0.65rem] text-gray-400">
        Font weight
        <select
          value={o.fontWeight ?? ""}
          onChange={e => onPatch({ fontWeight: e.target.value || undefined })}
          className="mt-1 w-full rounded border border-white/15 bg-[#0d0d18] px-2 py-1.5 text-xs text-white focus:border-blue-500/60 focus:outline-none"
        >
          <option value="">Default</option>
          {["400", "500", "600", "700", "800"].map(w => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </label>

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={() => onPatch({ color: undefined, backgroundColor: undefined, fontSize: undefined, fontWeight: undefined })}
          className="text-xs text-blue-400 hover:underline"
        >
          Reset BP
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-gray-500 hover:text-white hover:underline"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
