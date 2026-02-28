// Signal key overlay — positioned top-left of the globe area
export default function Legend() {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 backdrop-blur-sm w-44">
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
        Signal Key
      </p>

      <div className="flex flex-col gap-1.5">
        {/* Arc severity */}
        <div className="flex items-center gap-2">
          <span className="block w-5 h-0.5 rounded-full bg-[#DC2626] shadow-[0_0_4px_#DC2626]" />
          <span className="text-[11px] font-mono text-slate-300">Critical &gt;0.85</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="block w-5 h-0.5 rounded-full bg-[#EF4444] shadow-[0_0_4px_#EF4444]" />
          <span className="text-[11px] font-mono text-slate-300">High 0.70–0.85</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="block w-5 h-0.5 rounded-full bg-[#F97316] shadow-[0_0_4px_#F97316]" />
          <span className="text-[11px] font-mono text-slate-300">Moderate 0.50–0.70</span>
        </div>

        <div className="border-t border-slate-800 my-0.5" />

        {/* PoP markers */}
        <div className="flex items-center gap-2">
          <span className="block w-2.5 h-2.5 rounded-full bg-[#40a8ff] shadow-[0_0_5px_#40a8ff] mx-[3px]" />
          <span className="text-[11px] font-mono text-slate-300">Cloudflare PoP</span>
        </div>

        {/* Arc dot */}
        <div className="flex items-center gap-2">
          <span className="block w-2 h-2 rounded-full bg-[#EF4444] shadow-[0_0_5px_#EF4444] mx-[4px]" />
          <span className="text-[11px] font-mono text-slate-300">Attack origin</span>
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
