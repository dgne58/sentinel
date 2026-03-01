'use client'

import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, Brain, Clock, Globe, Shield, TrendingUp } from 'lucide-react'
import type { HistoryData, HistoryRange } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐'
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('')
}

function fmtTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ts
  }
}

function fmtDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ts
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{label}</span>
    </div>
  )
}

function HBar({ label, value, max, color = '#6366f1' }: {
  label: string
  value: number
  max: number
  color?: string
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="w-24 text-slate-400 truncate shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 4px ${color}60` }}
        />
      </div>
      <span className="text-slate-500 w-10 text-right">{value.toFixed(1)}%</span>
    </div>
  )
}

function LocationRow({ code, name, share, rank }: {
  code: string; name: string; share: number; rank: number
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="text-slate-600 w-3 shrink-0">{rank}</span>
      <span className="text-base leading-none">{countryFlag(code)}</span>
      <span className="text-slate-300 flex-1 truncate">{name || code}</span>
      <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden shrink-0">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
      <span className="text-slate-500 w-8 text-right">{Math.round(share * 100)}%</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface HistoryPanelProps {
  data: HistoryData
  range: HistoryRange
  onRangeChange: (r: HistoryRange) => void
}

export default function HistoryPanel({ data, range, onRangeChange }: HistoryPanelProps) {
  const anomalySet = new Set(data.anomalies.map(a => a.timestamp))

  // Volume chart tooltip
  const VolumeTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const isAnomaly = anomalySet.has(label)
    const anomaly   = data.anomalies.find(a => a.timestamp === label)
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono">
        <div className="text-slate-400 mb-1">{fmtTimestamp(label)}</div>
        <div className="text-indigo-400">Volume: {payload[0]?.value?.toFixed(3)}</div>
        {isAnomaly && anomaly && (
          <div className="text-amber-400 mt-1">
            ⚡ {anomaly.pct_above_baseline}% above baseline (z={anomaly.z_score})
          </div>
        )}
      </div>
    )
  }

  // Protocol/vector max for bar scaling
  const protoMax  = Math.max(...Object.values(data.protocol),  1)
  const vectorMax = Math.max(...Object.values(data.vector),    1)

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto feed-scroll p-4">

      {/* Range toggle */}
      <div className="flex items-center gap-2 shrink-0">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mr-1">
          Window
        </span>
        {(['24h', '7d'] as HistoryRange[]).map(r => (
          <button
            key={r}
            onClick={() => onRangeChange(r)}
            className={`px-3 py-1 rounded-full text-xs font-mono font-semibold transition-all ${
              range === r
                ? 'bg-indigo-600 text-white shadow-[0_0_8px_#6366f160]'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Analyst Notes */}
      {data.insights.length > 0 && (
        <div className="bg-slate-900/60 border border-indigo-900/50 rounded-xl p-3 shrink-0">
          <SectionHeader icon={Brain} label="Analyst Notes" />
          <ul className="space-y-1.5">
            {data.insights.map((insight, i) => (
              <li key={i} className="flex gap-2 text-xs font-mono text-slate-300 leading-snug">
                <span className="text-indigo-400 shrink-0 mt-px">›</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Volume chart */}
      {data.timeseries.length > 0 && (
        <div className="shrink-0">
          <SectionHeader icon={TrendingUp} label="Attack Volume" />
          <div className="h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.timeseries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={fmtTimestamp}
                  tick={{ fontSize: 9, fill: '#475569', fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#475569', fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip content={<VolumeTooltip />} />
                {/* Anomaly reference lines */}
                {data.anomalies.map(a => (
                  <ReferenceLine
                    key={a.timestamp}
                    x={a.timestamp}
                    stroke="#f59e0b"
                    strokeDasharray="3 3"
                    strokeOpacity={0.6}
                  />
                ))}
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  fill="url(#volGrad)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#818cf8' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {data.anomalies.length > 0 && (
            <p className="text-[10px] font-mono text-amber-500/70 mt-1">
              ─ ─ Anomaly threshold (z &gt; 2.0)
            </p>
          )}
        </div>
      )}

      {/* Protocol breakdown */}
      {Object.keys(data.protocol).length > 0 && (
        <div className="shrink-0">
          <SectionHeader icon={Shield} label="Protocol Split" />
          <div className="space-y-2">
            {Object.entries(data.protocol).map(([k, v]) => (
              <HBar key={k} label={k} value={v} max={protoMax} color="#6366f1" />
            ))}
          </div>
        </div>
      )}

      {/* Vector breakdown + shift banner */}
      {Object.keys(data.vector).length > 0 && (
        <div className="shrink-0">
          <SectionHeader icon={AlertTriangle} label="Attack Vectors" />
          {data.vector_shift && (
            <div className="mb-2 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] font-mono text-amber-400">
              Campaign shift detected:{' '}
              {Object.entries(data.vector_shift)
                .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}%`)
                .join(', ')}
            </div>
          )}
          <div className="space-y-2">
            {Object.entries(data.vector).map(([k, v]) => {
              const shift = data.vector_shift?.[k]
              return (
                <div key={k}>
                  <HBar label={k} value={v} max={vectorMax} color="#a855f7" />
                  {shift !== undefined && (
                    <div className={`text-[10px] font-mono ml-26 ${shift > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {shift > 0 ? '▲' : '▼'} {Math.abs(shift)}% vs prior window
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top countries — origins + targets side by side */}
      {(data.top_origins.length > 0 || data.top_targets.length > 0) && (
        <div className="shrink-0">
          <SectionHeader icon={Globe} label="Top Countries" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wider mb-1.5">
                Origins
              </p>
              <div className="space-y-2">
                {data.top_origins.slice(0, 5).map((loc, i) => (
                  <LocationRow
                    key={loc.country_code}
                    code={loc.country_code}
                    name={loc.country_name}
                    share={loc.share}
                    rank={i + 1}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wider mb-1.5">
                Targets
              </p>
              <div className="space-y-2">
                {data.top_targets.slice(0, 5).map((loc, i) => (
                  <LocationRow
                    key={loc.country_code}
                    code={loc.country_code}
                    name={loc.country_name}
                    share={loc.share}
                    rank={i + 1}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Persistent threats */}
      {data.persistent_ips.length > 0 && (
        <div className="shrink-0">
          <SectionHeader icon={AlertTriangle} label="Persistent Threats" />
          <div className="space-y-1.5">
            {data.persistent_ips.slice(0, 10).map(ip => {
              const b = ip._breakdown
              return (
                <div
                  key={ip.ip}
                  className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-xs font-mono"
                >
                  {/* IP + score */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-200">{ip.ip}</span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                      style={{
                        color: ip.persistence_score > 0.6 ? '#ef4444' : '#f59e0b',
                        backgroundColor: ip.persistence_score > 0.6 ? '#ef444415' : '#f59e0b15',
                      }}
                    >
                      {ip.persistence_score.toFixed(2)}
                    </span>
                  </div>
                  {/* Metadata row */}
                  <div className="text-slate-500 text-[10px] mb-2">
                    {countryFlag(ip.country_code ?? '')} {ip.country_code} ·{' '}
                    {ip.isp !== 'Unknown' ? ip.isp : '—'} · {ip.appearances}× seen
                  </div>
                  {/* Breakdown bar */}
                  <div className="flex h-1 rounded-full overflow-hidden gap-px">
                    <div
                      title={`Frequency: ${(b.frequency * 100).toFixed(0)}%`}
                      className="bg-indigo-500"
                      style={{ width: `${b.frequency * 35}%` }}
                    />
                    <div
                      title={`Consistency: ${(b.consistency * 100).toFixed(0)}%`}
                      className="bg-violet-500"
                      style={{ width: `${b.consistency * 25}%` }}
                    />
                    <div
                      title={`Spike co-occurrence: ${(b.spike_cooccur * 100).toFixed(0)}%`}
                      className="bg-amber-500"
                      style={{ width: `${b.spike_cooccur * 25}%` }}
                    />
                    <div
                      title={`ASN cluster: ${b.asn_cluster > 0 ? 'yes' : 'no'}`}
                      className="bg-rose-500"
                      style={{ width: `${b.asn_cluster * 15}%` }}
                    />
                  </div>
                  <div className="flex text-[9px] text-slate-700 justify-between mt-0.5 font-mono">
                    <span>freq</span><span>consist</span><span>spike</span><span>asn</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state — DB not seeded yet */}
      {data.persistent_ips.length === 0 && data.timeseries.length > 0 && (
        <div className="text-xs font-mono text-slate-600 italic px-1">
          Persistent threat analysis requires ≥3 poll cycles per IP. Run the server for a few hours to populate.
        </div>
      )}
    </div>
  )
}
