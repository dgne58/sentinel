'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import Feed from '@/components/Feed'
import Header from '@/components/StatsBar'
import Legend from '@/components/Legend'
import Sidebar from '@/components/Sidebar'
import StatusPanel from '@/components/StatusPanel'
import ThreatLevelBadge from '@/components/ThreatLevel'
import { useAttackStream } from '@/hooks/useAttackStream'
import { useHistory } from '@/hooks/useHistory'
import type { HistoryRange, ViewMode } from '@/types'

// Both Globe and TrafficChart require browser APIs — client-only
const Globe        = dynamic(() => import('@/components/Globe'),        { ssr: false })
const TrafficChart = dynamic(() => import('@/components/TrafficChart'), { ssr: false })
const HistoryPanel = dynamic(() => import('@/components/HistoryPanel'), { ssr: false })

export default function Page() {
  const [viewMode, setViewMode]       = useState<ViewMode>('live')
  const [historyRange, setHistoryRange] = useState<HistoryRange>('7d')

  const {
    arcs,
    feed,
    stats,
    selectedEvent,
    setSelectedEvent,
    isConnected,
  } = useAttackStream(viewMode === 'live')

  const { historyData, historyLoading, historyError } = useHistory(viewMode, historyRange)

  const highConfCount = feed.filter(e => e.function === 'table').length
  const isHistory = viewMode === 'history'

  return (
    <div className="h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden flex flex-col">
      <Header
        isConnected={isConnected}
        stats={stats}
        viewMode={viewMode}
        onModeChange={setViewMode}
      />

      <div className="flex-1 flex min-h-0">
        {/* Left — Globe with HUD overlays */}
        <div className="flex-1 relative">
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Globe
              arcs={arcs}
              onArcClick={event => setSelectedEvent(event)}
              viewMode={viewMode}
              historicalArcs={historyData?.arcs ?? []}
            />
          </div>

          {/* Legend — top-left of globe area */}
          <div className="absolute top-5 left-5 z-10">
            <Legend />
          </div>

          {/* StatusPanel HUD — only in live mode */}
          {!isHistory && (
            <div className="absolute bottom-5 left-5 right-5 z-10">
              <StatusPanel stats={stats} />
            </div>
          )}

          {/* Historical loading / error overlay */}
          {isHistory && historyLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="bg-slate-900/80 border border-slate-700 rounded-2xl px-8 py-5 text-center backdrop-blur-sm">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs font-mono text-slate-400">Loading historical data…</p>
              </div>
            </div>
          )}

          {isHistory && historyError && (
            <div className="absolute bottom-5 left-5 z-10">
              <div className="bg-red-950/80 border border-red-800 rounded-xl px-4 py-2 text-xs font-mono text-red-400">
                History fetch failed: {historyError}
              </div>
            </div>
          )}
        </div>

        {/* Right panel — fluid width: 30% of viewport, clamped between 280px and 520px */}
        <div className="w-[clamp(280px,30vw,520px)] border-l border-slate-800 bg-slate-900/30 flex flex-col shrink-0 backdrop-blur-sm relative">
          {isHistory ? (
            /* Historical mode — HistoryPanel fills the right panel */
            historyData ? (
              <HistoryPanel
                data={historyData}
                range={historyRange}
                onRangeChange={setHistoryRange}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                {historyLoading ? (
                  <div className="text-xs font-mono text-slate-500 animate-pulse">Fetching…</div>
                ) : (
                  <div className="text-xs font-mono text-slate-600">No data yet</div>
                )}
              </div>
            )
          ) : (
            /* Live mode — threat level + chart + feed */
            <>
              <ThreatLevelBadge level={stats.threat_level} />

              <div className="flex-1 p-4 flex flex-col gap-4 min-h-0 overflow-y-auto">
                <div className="h-[clamp(140px,18vh,220px)] shrink-0">
                  <TrafficChart stats={stats} highConfCount={highConfCount} />
                </div>
                <div className="flex-1 min-h-[200px]">
                  <Feed
                    feed={feed}
                    onEventClick={event => setSelectedEvent(event)}
                  />
                </div>
              </div>

              <Sidebar
                event={selectedEvent}
                onClose={() => setSelectedEvent(null)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
