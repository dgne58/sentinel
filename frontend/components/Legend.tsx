// Signal key overlay — positioned top-left of the globe area
const ATTACK_TYPES = [
  { color: '#EF4444', label: 'DDoS / Volumetric' },
  { color: '#F97316', label: 'Botnet / C2' },
  { color: '#A855F7', label: 'Intrusion / SSH' },
  { color: '#F59E0B', label: 'Recon / Scan' },
  { color: '#06B6D4', label: 'Open Proxy' },
  { color: '#64748B', label: 'Other' },
]

export default function Legend() {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 backdrop-blur-sm w-44">
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
        Signal Key
      </p>

      <div className="flex flex-col gap-1.5">
        {/* Attack type arcs */}
        {ATTACK_TYPES.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className="block w-5 h-0.5 rounded-full shrink-0"
              style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
            />
            <span className="text-[11px] font-mono text-slate-300">{label}</span>
          </div>
        ))}

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
