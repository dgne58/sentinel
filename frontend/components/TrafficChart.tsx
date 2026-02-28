'use client'

import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Stats } from '@/types'

interface DataPoint {
  time: string
  events: number
  highConf: number
}

interface TrafficChartProps {
  stats: Stats
  highConfCount: number   // count of "table" (score > 0.7) events in current window
}

export default function TrafficChart({ stats, highConfCount }: TrafficChartProps) {
  const [data, setData] = useState<DataPoint[]>([])

  // Seed with empty history on mount
  useEffect(() => {
    const seed: DataPoint[] = Array.from({ length: 20 }, () => ({
      time: '',
      events: 0,
      highConf: 0,
    }))
    setData(seed)
  }, [])

  // Append a point every time stats update with real data
  useEffect(() => {
    if (stats.attacks_per_min === 0 && highConfCount === 0) return
    const time = new Date().toLocaleTimeString([], {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    setData(prev => [
      ...prev.slice(1),
      { time, events: stats.attacks_per_min, highConf: highConfCount },
    ])
  }, [stats.attacks_per_min, highConfCount]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full w-full bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <h3 className="text-slate-400 font-mono text-sm uppercase tracking-wider">
          Attack Events
        </h3>
        <div className="flex gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-red-400">All Events</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
            <span className="text-orange-400">High Conf</span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="gradEvents" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradHighConf" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f97316" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#475569"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              fontFamily="monospace"
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#475569"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              fontFamily="monospace"
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', fontSize: 11 }}
              itemStyle={{ fontFamily: 'monospace' }}
              labelStyle={{ fontFamily: 'monospace', color: '#94a3b8' }}
            />
            <Area
              type="monotone"
              dataKey="events"
              name="All Events"
              stroke="#ef4444"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#gradEvents)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="highConf"
              name="High Conf"
              stroke="#f97316"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#gradHighConf)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
