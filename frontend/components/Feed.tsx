'use client'

import { useEffect, useRef } from 'react'
import { Activity, ShieldCheck } from 'lucide-react'
import type { AttackEvent } from '@/types'

function relativeTime(iso: string): string {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function scoreColor(score: number): string {
  if (score >= 0.95) return '#DC2626'
  if (score >= 0.80) return '#EF4444'
  if (score >= 0.65) return '#F97316'
  return '#F59E0B'
}

interface FeedProps {
  feed: AttackEvent[]
  onEventClick: (event: AttackEvent) => void
}

export default function Feed({ feed, onEventClick }: FeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll to top on new event (feed is newest-first)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [feed.length])

  return (
    <div className="h-full w-full bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-3 shrink-0">
        <h3 className="text-slate-400 font-mono text-sm uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Live Attack Feed
        </h3>
        <span className="text-xs text-slate-500 font-mono animate-pulse">LIVE</span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-12 gap-2 text-[10px] font-mono text-slate-500 mb-2 px-2 uppercase tracking-wider shrink-0">
        <div className="col-span-2">Time</div>
        <div className="col-span-3">Source IP</div>
        <div className="col-span-3">Country</div>
        <div className="col-span-2 text-center">Score</div>
        <div className="col-span-2 text-right">PoP</div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto space-y-1" ref={scrollRef}>
        {feed.length === 0 ? (
          <div className="px-2 py-4 text-xs text-slate-600 font-mono italic">
            Awaiting high-confidence events…
          </div>
        ) : (
          feed.map((event, i) => {
            const from  = event.custom.from
            const to    = event.custom.to
            const color = scoreColor(from.score)
            const isHigh = from.score > 0.85

            return (
              <button
                key={`${from.ip}-${i}`}
                onClick={() => onEventClick(event)}
                className={`w-full grid grid-cols-12 gap-2 text-xs font-mono px-2 py-1.5 rounded border transition-all duration-200 text-left cursor-pointer ${
                  isHigh
                    ? 'bg-red-500/5 border-red-500/20 text-red-200 hover:bg-red-500/10'
                    : 'bg-slate-800/30 border-slate-800 text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                <div className="col-span-2 opacity-70 truncate">
                  {relativeTime(from.last_reported)}
                </div>
                <div className="col-span-3 truncate text-slate-300" title={from.ip}>
                  {from.ip}
                </div>
                <div className="col-span-3 truncate" title={from.country}>
                  {from.country}
                </div>
                <div className="col-span-2 text-center flex items-center justify-center gap-1">
                  {isHigh ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                  ) : (
                    <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                  )}
                  <span style={{ color }}>{from.score.toFixed(2)}</span>
                </div>
                <div className="col-span-2 text-right text-slate-500 truncate">
                  {to.pop}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
