'use client'

import { motion } from 'framer-motion'
import type { ThreatLevel } from '@/types'

const CONFIG: Record<ThreatLevel, { label: string; color: string; ring: string; text: string }> = {
  LOW:      { label: 'LOW',      color: 'bg-emerald-500', ring: 'ring-emerald-500/30', text: 'text-emerald-400' },
  MODERATE: { label: 'MODERATE', color: 'bg-yellow-500',  ring: 'ring-yellow-500/30',  text: 'text-yellow-400'  },
  HIGH:     { label: 'HIGH',     color: 'bg-orange-500',  ring: 'ring-orange-500/30',  text: 'text-orange-400'  },
  CRITICAL: { label: 'CRITICAL', color: 'bg-red-500',     ring: 'ring-red-500/40',     text: 'text-red-400'     },
}

interface ThreatLevelProps {
  level: ThreatLevel
}

export default function ThreatLevelBadge({ level }: ThreatLevelProps) {
  const cfg = CONFIG[level]
  const isCritical = level === 'CRITICAL'

  return (
    <div className="flex flex-col items-center justify-center gap-2 p-4 border-b border-gray-800">
      <span className="text-xs text-gray-500 uppercase tracking-widest">Threat Level</span>

      <motion.div
        className={`relative flex items-center gap-2 px-4 py-2 rounded-full ring-2 ${cfg.ring} bg-gray-900`}
        animate={isCritical ? { scale: [1, 1.04, 1] } : { scale: 1 }}
        transition={isCritical ? { repeat: Infinity, duration: 1.5 } : {}}
      >
        <span className={`w-2 h-2 rounded-full ${cfg.color} ${isCritical ? 'animate-pulse' : ''}`} />
        <span className={`text-sm font-bold tracking-wider ${cfg.text}`}>
          {cfg.label}
        </span>
      </motion.div>
    </div>
  )
}
