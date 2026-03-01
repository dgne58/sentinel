import { memo } from 'react'
import { AlertTriangle, Shield, Activity, Globe } from 'lucide-react'
import type { Stats } from '@/types'

const THREAT_COLORS: Record<string, string> = {
  LOW:      'text-emerald-400',
  MODERATE: 'text-yellow-400',
  HIGH:     'text-orange-400',
  CRITICAL: 'text-red-400',
}

interface StatusPanelProps {
  stats: Stats
}

export default memo(function StatusPanel({ stats }: StatusPanelProps) {
  const threatColor = THREAT_COLORS[stats.threat_level] ?? 'text-slate-400'

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
      {/* Threat Level */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col justify-between backdrop-blur-sm">
        <div className="flex justify-between items-start mb-2">
          <span className="text-slate-500 text-[10px] font-mono uppercase tracking-wider">Threat Level</span>
          <AlertTriangle className={`w-4 h-4 ${threatColor}`} />
        </div>
        <div>
          <div className={`text-xl font-mono font-bold leading-tight ${threatColor}`}>
            {stats.threat_level}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 font-mono">
            {stats.total_unique_ips_10min} IPs tracked
          </div>
        </div>
      </div>

      {/* Events / Cycle */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col justify-between backdrop-blur-sm">
        <div className="flex justify-between items-start mb-2">
          <span className="text-slate-500 text-[10px] font-mono uppercase tracking-wider">Events/Cycle</span>
          <Activity className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <div className="text-xl font-mono font-bold text-slate-200 leading-tight">
            {stats.attacks_per_min}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 font-mono">90s poll interval</div>
        </div>
      </div>

      {/* Top Source */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col justify-between backdrop-blur-sm">
        <div className="flex justify-between items-start mb-2">
          <span className="text-slate-500 text-[10px] font-mono uppercase tracking-wider">Top Source</span>
          <Globe className="w-4 h-4 text-purple-400" />
        </div>
        <div>
          {stats.top_countries[0] ? (
            <>
              <div className="text-xl font-mono font-bold text-slate-200 leading-tight truncate">
                {stats.top_countries[0].country}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono">
                {stats.top_countries[0].count} events
              </div>
            </>
          ) : (
            <div className="text-xl font-mono font-bold text-slate-600">—</div>
          )}
        </div>
      </div>

      {/* Cloudflare Signal */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col justify-between backdrop-blur-sm">
        <div className="flex justify-between items-start mb-2">
          <span className="text-slate-500 text-[10px] font-mono uppercase tracking-wider">CF Signal</span>
          <Shield className={`w-4 h-4 ${stats.cloudflare_spike ? 'text-orange-400' : 'text-emerald-500'}`} />
        </div>
        <div>
          <div className={`text-xl font-mono font-bold leading-tight ${stats.cloudflare_spike ? 'text-orange-400' : 'text-emerald-400'}`}>
            {stats.cloudflare_spike ? 'SPIKE' : 'NOMINAL'}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 font-mono">Cloudflare Radar L3/L4</div>
        </div>
      </div>
    </div>
  )
})
