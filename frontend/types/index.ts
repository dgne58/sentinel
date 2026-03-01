export interface AttackEventFrom {
  ip: string
  score: number
  attack_type?: string
  source?: string
  country: string
  city: string
  isp: string
  reports: number
  distinct_reporters: number
  categories: number[]
  last_reported: string
}

export interface AttackEventTo {
  pop: string
  name: string
}

export interface AttackEvent {
  function: 'table' | 'marker'
  object: { from: string; to: string }
  color: { line: { from: string; to: string } }
  timeout: number
  options: string[]
  custom: { from: AttackEventFrom; to: AttackEventTo }
}

export interface GlobeArc {
  id: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  color: string
  event: AttackEvent
}

export interface TopCountry {
  country: string
  country_code: string
  count: number
}

export type ThreatLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'

export interface Stats {
  type: 'stats'
  threat_level: ThreatLevel
  cloudflare_spike: boolean
  attacks_per_min: number
  top_countries: TopCountry[]
  total_unique_ips_10min: number
}

// ── Historical mode ────────────────────────────────────────────────────────────

export type ViewMode    = 'live' | 'history'
export type HistoryRange = '24h' | '7d'

export interface TimeseriesPoint {
  timestamp: string
  value: number
}

export interface Anomaly {
  timestamp: string
  value: number
  baseline_mean: number
  z_score: number
  pct_above_baseline: number
}

export interface HistoricalArc {
  origin: { country_code: string; lat: number; lng: number }
  target: { country_code: string; lat: number; lng: number }
  weight: number
}

export interface TopLocation {
  country_code: string
  country_name: string
  share: number
}

export interface PersistentIP {
  ip: string
  appearances: number
  country_code: string | null
  isp: string
  avg_score: number
  last_seen: string
  persistence_score: number
  _breakdown: {
    frequency: number
    consistency: number
    spike_cooccur: number
    asn_cluster: number
  }
}

export interface Correlation {
  spike_timestamp: string
  country: string
  unique_ips_in_window: number
  cloudflare_z_score: number
}

export interface HistoryData {
  range: string
  timeseries: TimeseriesPoint[]
  anomalies: Anomaly[]
  top_origins: TopLocation[]
  top_targets: TopLocation[]
  protocol: Record<string, number>
  vector: Record<string, number>
  bitrate: Record<string, number>
  persistent_ips: PersistentIP[]
  correlations: Correlation[]
  vector_shift: Record<string, number> | null
  insights: string[]
  arcs: HistoricalArc[]
}
