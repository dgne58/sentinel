'use client'

import { AnimatePresence, motion } from 'framer-motion'
import type { AttackEvent } from '@/types'

const CATEGORY_NAMES: Record<number, string> = {
  3:  'Fraud Orders',
  4:  'DDoS Attack',
  5:  'FTP Brute-Force',
  6:  'Ping of Death',
  7:  'Phishing',
  8:  'Fraud VoIP',
  9:  'Open Proxy',
  10: 'Web Spam',
  11: 'Email Spam',
  12: 'Blog Spam',
  14: 'Port Scan',
  15: 'Hacking',
  16: 'SQL Injection',
  17: 'Spoofing',
  18: 'Brute-Force',
  19: 'Bad Web Bot',
  20: 'Exploited Host',
  21: 'Web App Attack',
  22: 'SSH',
  23: 'IoT Targeted',
}

function scoreBar(score: number) {
  const pct  = Math.round(score * 100)
  const color =
    score >= 0.95 ? '#DC2626' :
    score >= 0.80 ? '#EF4444' :
    score >= 0.65 ? '#F97316' : '#F59E0B'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono font-semibold" style={{ color }}>
        {score.toFixed(3)}
      </span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-gray-200 break-all">{value}</span>
    </div>
  )
}

interface SidebarProps {
  event: AttackEvent | null
  onClose: () => void
}

export default function Sidebar({ event, onClose }: SidebarProps) {
  const from = event?.custom.from
  const to   = event?.custom.to

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          key="sidebar"
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0,   opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          className="absolute inset-y-0 right-0 w-72 bg-slate-950 border-l border-slate-800 flex flex-col z-20 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
            <span className="text-xs font-semibold text-slate-300 font-mono uppercase tracking-widest">
              IP Detail
            </span>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-white transition-colors text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto feed-scroll p-4 flex flex-col gap-4">
            {from && (
              <>
                <div>
                  <span className="text-xs text-gray-500 uppercase tracking-wider">IP Address</span>
                  <p className="text-base font-mono font-semibold text-white mt-0.5">{from.ip}</p>
                </div>

                <div>
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Threat Score</span>
                  <div className="mt-1">{scoreBar(from.score)}</div>
                </div>

                <Row label="Location" value={`${from.city !== 'Unknown' ? from.city + ', ' : ''}${from.country}`} />
                <Row label="ISP / ASN" value={from.isp !== 'Unknown' ? from.isp : '—'} />
                <Row label="Reports" value={`${from.reports} from ${from.distinct_reporters} distinct reporters`} />
                <Row
                  label="Categories"
                  value={
                    from.categories.length > 0
                      ? from.categories.map(c => CATEGORY_NAMES[c] ?? `#${c}`).join(', ')
                      : '—'
                  }
                />
                <Row label="Last Reported" value={from.last_reported ? new Date(from.last_reported).toLocaleString() : '—'} />

                {to && (
                  <Row label="Nearest PoP" value={`${to.pop} — ${to.name}`} />
                )}

                <a
                  href={`https://www.abuseipdb.com/check/${from.ip}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-center text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                >
                  View on AbuseIPDB →
                </a>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
