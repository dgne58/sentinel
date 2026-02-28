export interface AttackEventFrom {
  ip: string
  score: number
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
  expiry: number
  event: AttackEvent
}

export interface TopCountry {
  country: string
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
