'use client'

import { useEffect, useRef, useState } from 'react'
import type { AttackEvent, GlobeArc, Stats, ThreatLevel } from '@/types'

const WS_URL = 'ws://localhost:8001/ws/attacks'
const FEED_API = 'http://localhost:8000/api/feed'

const DEFAULT_STATS: Stats = {
  type: 'stats',
  threat_level: 'LOW',
  cloudflare_spike: false,
  attacks_per_min: 0,
  top_countries: [],
  total_unique_ips_10min: 0,
}

function parseLatLng(s: string): [number, number] {
  const [lat, lng] = s.split(',').map(Number)
  return [lat, lng]
}

export function useAttackStream() {
  const [arcs, setArcs] = useState<GlobeArc[]>([])
  const [feed, setFeed] = useState<AttackEvent[]>([])
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS)
  const [selectedEvent, setSelectedEvent] = useState<AttackEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  // Arc expiry cleanup — always active, never gated (§8.3)
  useEffect(() => {
    const interval = setInterval(() => {
      setArcs(prev => prev.filter(arc => Date.now() < arc.expiry))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket lifecycle
  useEffect(() => {
    let ws: WebSocket | null = null
    let destroyed = false
    let reconnectDelay = 1000
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        setIsConnected(true)
        reconnectDelay = 1000

        // Pre-populate feed from live server; silently skip if unavailable
        fetch(FEED_API)
          .then(r => r.json())
          .then((events: AttackEvent[]) => {
            setFeed(events.slice(0, 50))
          })
          .catch(() => {})
      }

      ws.onmessage = e => {
        let data: unknown
        try {
          data = JSON.parse(e.data as string)
        } catch {
          return
        }

        if (Array.isArray(data)) {
          // Attack batch
          for (const event of data as AttackEvent[]) {
            const [startLat, startLng] = parseLatLng(event.object.from)
            const [endLat, endLng] = parseLatLng(event.object.to)

            const arc: GlobeArc = {
              id: `${event.custom.from.ip}-${Date.now()}-${Math.random()}`,
              startLat,
              startLng,
              endLat,
              endLng,
              color: event.color.line.from,
              expiry: Date.now() + event.timeout,
              event,
            }

            // Add arc, cap at 30, shift oldest
            setArcs(prev => {
              const next = [...prev, arc]
              return next.length > 30 ? next.slice(next.length - 30) : next
            })

            // Feed gets "table" events only, newest first, cap at 50
            if (event.function === 'table') {
              setFeed(prev => [event, ...prev].slice(0, 50))
            }
          }
        } else if (
          data !== null &&
          typeof data === 'object' &&
          (data as Record<string, unknown>).type === 'stats'
        ) {
          setStats(data as Stats)
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        if (!destroyed) {
          reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30000)
            connect()
          }, reconnectDelay)
        }
      }

      ws.onerror = () => ws?.close()
    }

    connect()

    return () => {
      destroyed = true
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])

  return { arcs, feed, stats, selectedEvent, setSelectedEvent, isConnected }
}
