// Arc guide overlay — positioned top-left of the globe area
export default function Legend() {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 backdrop-blur-sm w-44">
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
        Arc Guide
      </p>

      <div className="flex flex-col gap-1.5">
        {/* Arc thickness / dot size = weight */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1 justify-center shrink-0 w-5">
            <span className="block w-5 rounded-full bg-slate-500" style={{ height: 1 }} />
            <span className="block w-5 rounded-full bg-slate-300" style={{ height: 3 }} />
          </div>
          <span className="text-[11px] font-mono text-slate-300 leading-tight">
            Thicker = Frequency
          </span>
        </div>

        {/* Origin dot = attacker */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center shrink-0 w-5">
            <span className="block w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
          </div>
          <span className="text-[11px] font-mono text-slate-300">Origin</span>
        </div>

        <div className="border-t border-slate-800 my-0.5" />

        {/* PoP markers */}
        <div className="flex items-center gap-2">
          <span className="block w-2.5 h-2.5 rounded-full bg-[#40a8ff] shadow-[0_0_5px_#40a8ff] mx-[3px] shrink-0" />
          <span className="text-[11px] font-mono text-slate-300">Cloudflare PoP</span>
        </div>

        <div className="border-t border-slate-800 my-0.5" />

        {/* Interaction hint */}
        <p className="text-[10px] font-mono text-slate-600 leading-tight">
          Drag to rotate · Click arc to inspect
        </p>
      </div>
    </div>
  )
}
