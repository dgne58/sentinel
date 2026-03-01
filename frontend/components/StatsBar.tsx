'use client'

import { useState, useEffect } from 'react'
import { Shield } from 'lucide-react'
import type { Stats, ThreatLevel, ViewMode } from '@/types'

// Convert 2-letter ISO country code → flag emoji
function countryFlag(code: string): string {
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('')
}

const THREAT_STYLES: Record<ThreatLevel, { dot: string; text: string; ring: string }> = {
  LOW:      { dot: 'bg-emerald-400',                    text: 'text-emerald-400', ring: 'ring-emerald-500/30' },
  MODERATE: { dot: 'bg-yellow-400',                     text: 'text-yellow-400',  ring: 'ring-yellow-500/30'  },
  HIGH:     { dot: 'bg-orange-400',                     text: 'text-orange-400',  ring: 'ring-orange-500/30'  },
  CRITICAL: { dot: 'bg-red-500 animate-pulse',          text: 'text-red-400',     ring: 'ring-red-500/40'     },
}

interface HeaderProps {
  isConnected: boolean
  stats?: Stats
  viewMode: ViewMode
  onModeChange: (m: ViewMode) => void
}

export default function Header({ isConnected, stats, viewMode, onModeChange }: HeaderProps) {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const threat = stats ? THREAT_STYLES[stats.threat_level] : null

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-950 flex items-center px-6 gap-6 shrink-0 z-50">

      {/* Brand */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center border border-emerald-500/20">
          <Shield className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h1 className="font-bold text-lg tracking-tight text-slate-100 leading-none font-mono">
            SENTINEL <span className="text-emerald-500 text-xs align-top">PRO</span>
          </h1>
          <div className="text-[10px] text-slate-500 font-mono uppercase tracking-widest leading-none mt-0.5">
            Global Threat Intelligence
          </div>
        </div>
      </div>

      <div className="h-6 w-px bg-slate-800 shrink-0" />

      {/* Live stats — center, flex-1 so it fills available space */}
      <div className="flex-1 flex items-center gap-5 min-w-0">
        {stats && threat ? (
          <>
            {/* Threat level pill */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold ring-1 bg-slate-900/80 shrink-0 ${threat.ring}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${threat.dot}`} />
              <span className={threat.text}>{stats.threat_level}</span>
            </div>

            <div className="h-4 w-px bg-slate-800 shrink-0" />

            {/* Attacks / min */}
            <div className="flex items-baseline gap-1 shrink-0">
              <span className="text-sm font-mono font-bold text-slate-200">{stats.attacks_per_min.toLocaleString()}</span>
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">/min</span>
            </div>

            <div className="h-4 w-px bg-slate-800 shrink-0" />

            {/* Top 3 attacking countries */}
            <div className="flex items-center gap-3 min-w-0 overflow-hidden">
              {stats.top_countries.slice(0, 3).map((c, i) => (
                <span key={c.country} className="flex items-center gap-1 text-xs font-mono text-slate-400 shrink-0">
                  {i > 0 && <span className="text-slate-700">·</span>}
                  <span>{countryFlag(c.country)}</span>
                  <span className="text-slate-300">{c.country}</span>
                  <span className="text-slate-600">{c.count}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <span className="text-xs font-mono text-slate-600 animate-pulse">Awaiting stream…</span>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex items-center bg-slate-900 border border-slate-800 rounded-full p-0.5 shrink-0">
        {(['live', 'history'] as ViewMode[]).map(m => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`px-3 py-1 rounded-full text-[11px] font-mono font-semibold uppercase tracking-wider transition-all ${
              viewMode === m
                ? m === 'live'
                  ? 'bg-emerald-600 text-white shadow-[0_0_8px_#10b98160]'
                  : 'bg-indigo-600 text-white shadow-[0_0_8px_#6366f160]'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {m === 'live' ? '● Live' : 'History'}
          </button>
        ))}
      </div>

      {/* Clock + connection */}
      <div className="flex items-center gap-5 shrink-0">
        <div className="text-right hidden sm:block">
          <div className="text-xs font-mono text-slate-300">{time}</div>
          <div className="text-[10px] text-slate-600 font-mono">UTC LOCAL</div>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className={isConnected ? 'text-emerald-400' : 'text-amber-400'}>
            {isConnected ? 'LIVE' : 'RECONNECTING'}
          </span>
        </div>
      </div>

    </header>
  )
}
