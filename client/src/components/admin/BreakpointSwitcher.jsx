export const BREAKPOINT_WIDTHS = {
  base: { label: "Mobile",  width: 390  },
  sm:   { label: "SM",      width: 640  },
  md:   { label: "Tablet",  width: 768  },
  lg:   { label: "Desktop", width: 1024 },
  xl:   { label: "XL",      width: 1280 },
};

export default function BreakpointSwitcher({ active, onChange }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-white/5 p-1">
      {Object.entries(BREAKPOINT_WIDTHS).map(([bp, { label, width }]) => (
        <button
          key={bp}
          type="button"
          title={`${label} (${width}px)`}
          onClick={() => onChange(bp)}
          className={`rounded-full px-2.5 py-1 text-[0.65rem] font-medium transition-colors ${
            active === bp
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:bg-white/10 hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
