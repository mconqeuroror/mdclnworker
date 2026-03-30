export default function SpatialFields({ targetId, activeBreakpoint, spatialOverrides, onPatch, onResetBreakpoint, onCopyLgDown }) {
  const entry = spatialOverrides?.[targetId] ?? {};
  const t     = entry[activeBreakpoint] ?? {};

  const bpCount = ["base", "sm", "md", "lg", "xl"].filter(
    bp => entry[bp] && Object.keys(entry[bp]).length > 0,
  ).length;

  function inp(label, key, placeholder) {
    return (
      <label key={key} className="block text-[0.65rem] text-gray-400">
        {label}
        <input
          type="text"
          value={t[key] ?? ""}
          placeholder={placeholder}
          onChange={e => onPatch({ [key]: e.target.value || undefined })}
          className="mt-0.5 w-full rounded border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-blue-500/60 focus:outline-none"
        />
      </label>
    );
  }

  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-white">Spatial / Layout</p>
        {bpCount > 0 && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] text-gray-400">
            {bpCount} BP{bpCount > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <p className="text-[0.65rem] text-gray-500">
        Editing: <span className="font-medium text-amber-200">{activeBreakpoint}</span>
        {activeBreakpoint === "base" && <span className="ml-1 text-white/40">(below 640 px)</span>}
        {activeBreakpoint === "lg"   && <span className="ml-1 text-white/40">(1024 px+)</span>}
      </p>

      {/* Hidden toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
        <input
          type="checkbox"
          checked={t.hidden === true}
          onChange={e => onPatch(e.target.checked ? { hidden: true } : { hidden: undefined })}
          className="h-4 w-4 rounded border-white/20 accent-blue-500"
        />
        Hide on this breakpoint
      </label>

      <div className="grid grid-cols-2 gap-2">
        {inp("translateX", "translateX", "0%")}
        {inp("translateY", "translateY", "0%")}
        {inp("width",      "width",      "auto")}
        {inp("height",     "height",     "auto")}
        <div className="col-span-2">{inp("max-width",     "maxWidth",     "none")}</div>
        <div className="col-span-2">{inp("margin-top",    "marginTop",    "e.g. 2rem")}</div>
        <div className="col-span-2">{inp("margin-bottom", "marginBottom", "e.g. 3rem")}</div>
        {inp("margin-left",  "marginLeft",  "e.g. 1rem")}
        {inp("margin-right", "marginRight", "e.g. 1rem")}
      </div>

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          onClick={onResetBreakpoint}
          className="text-xs text-amber-200/80 hover:underline"
        >
          Reset this BP
        </button>
        <button
          type="button"
          onClick={onCopyLgDown}
          className="text-xs text-blue-400 hover:underline"
        >
          Copy lg → mobile
        </button>
      </div>
    </div>
  );
}
