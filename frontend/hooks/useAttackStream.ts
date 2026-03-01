'use client'

import { useEffect, useRef, useState } from 'react'
import type { AttackEvent, GlobeArc, Stats } from '@/types'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000/ws/attacks'
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const FEED_API = `${API_BASE}/api/feed`

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

export function useAttackStream(active: boolean = true) {
  const [arcs, setArcs] = useState<GlobeArc[]>([])
  const [feed, setFeed] = useState<AttackEvent[]>([])
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS)
  const [selectedEvent, setSelectedEvent] = useState<AttackEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])

  // No expiry cleanup — arcs are replaced wholesale each broadcast cycle,
  // so they persist until the next batch arrives (never disappear mid-cycle).

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
          // Attack batch — only update arcs/feed when live mode is active
          if (activeRef.current) {
            const now = Date.now()
            const newArcs: GlobeArc[] = []
            const newFeedEvents: AttackEvent[] = []

            for (const event of data as AttackEvent[]) {
              const [startLat, startLng] = parseLatLng(event.object.from)
              const [endLat, endLng] = parseLatLng(event.object.to)

              newArcs.push({
                id: `${event.custom.from.ip}-${now}-${Math.random()}`,
                startLat,
                startLng,
                endLat,
                endLng,
                color: event.color.line.from,
                event,
              })

              if (event.function === 'table') {
                newFeedEvents.push(event)
              }
            }

            // Replace entire arc set with the new batch — arcs persist until
            // the next broadcast, never expiring mid-cycle.
            if (newArcs.length > 0) {
              setArcs(newArcs.length > 30 ? newArcs.slice(-30) : newArcs)
            }
            if (newFeedEvents.length > 0) {
              setFeed(prev => [...newFeedEvents, ...prev].slice(0, 50))
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
