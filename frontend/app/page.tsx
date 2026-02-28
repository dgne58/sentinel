'use client'

import dynamic from 'next/dynamic'
import Feed from '@/components/Feed'
import Header from '@/components/StatsBar'
import Sidebar from '@/components/Sidebar'
import StatusPanel from '@/components/StatusPanel'
import { useAttackStream } from '@/hooks/useAttackStream'

// Both Globe and TrafficChart require browser APIs — client-only
const Globe        = dynamic(() => import('@/components/Globe'),        { ssr: false })
const TrafficChart = dynamic(() => import('@/components/TrafficChart'), { ssr: false })

export default function Page() {
  const {
    arcs,
    feed,
    stats,
    selectedEvent,
    setSelectedEvent,
    isConnected,
  } = useAttackStream()

  // High-confidence count for TrafficChart — "table" events currently in feed
  const highConfCount = feed.filter(e => e.function === 'table').length

  return (
    <div className="h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden flex flex-col">
      <Header isConnected={isConnected} />

      <div className="flex-1 flex min-h-0">
        {/* Left — Globe with HUD overlay */}
        <div className="flex-1 relative">
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Globe
              arcs={arcs}
              onArcClick={event => setSelectedEvent(event)}
            />
          </div>

          {/* StatusPanel HUD — floats at bottom of globe area */}
          <div className="absolute bottom-5 left-5 right-5 z-10">
            <StatusPanel stats={stats} />
          </div>
        </div>

        {/* Right sidebar — chart + feed */}
        <div className="w-[440px] border-l border-slate-800 bg-slate-900/30 flex flex-col shrink-0 backdrop-blur-sm relative">
          <div className="flex-1 p-4 flex flex-col gap-4 min-h-0 overflow-y-auto">
            <div className="h-[260px] shrink-0">
              <TrafficChart stats={stats} highConfCount={highConfCount} />
            </div>
            <div className="flex-1 min-h-[260px]">
              <Feed
                feed={feed}
                onEventClick={event => setSelectedEvent(event)}
              />
            </div>
          </div>

          {/* Sidebar slides in over the right panel */}
          <Sidebar
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        </div>
      </div>
    </div>
  )
}
