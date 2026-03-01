'use client'

import { useEffect, useState } from 'react'
import type { HistoryData, HistoryRange, ViewMode } from '@/types'

const HISTORY_API = 'http://localhost:8000/api/history'

export function useHistory(viewMode: ViewMode, historyRange: HistoryRange) {
  const [historyData, setHistoryData]     = useState<HistoryData | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError]   = useState<string | null>(null)

  useEffect(() => {
    if (viewMode !== 'history') return

    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)

    fetch(`${HISTORY_API}?range=${historyRange}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<HistoryData>
      })
      .then(data => {
        if (!cancelled) {
          setHistoryData(data)
          setHistoryLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setHistoryError((err as Error).message)
          setHistoryLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [viewMode, historyRange])

  return { historyData, historyLoading, historyError }
}
