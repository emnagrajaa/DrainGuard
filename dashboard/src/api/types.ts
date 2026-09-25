// Shapes returned by the DrainGuard cloud API (cloud/api/main.py + operations.py).
// Timestamps are ISO strings; SQLite drops the zone, so parse them with lib/time.parseTs.

export type Mode = 1 | 2 | 3

export interface LatestReading {
  timestamp: string
  mode: Mode
  distance_cm: number | null
  dh_dt: number | null
  moisture_switch: boolean
}

export interface ClassifierReading {
  timestamp: string
  class: string
  confidence: number | null
  p_trash: number | null
}

export interface FleetNode {
  id: string
  municipality: string | null
  latitude: number | null
  longitude: number | null
  last_seen: string | null
  battery_v: number | null
  current_mode: Mode | null
  status: string | null
  latest: LatestReading | null
  classifier: ClassifierReading | null
  projected_overflow_min: number | null
  recent: { t: string; distance_cm: number | null; dh_dt: number | null }[]
}

export interface Reading {
  id: number
  node_id: string
  timestamp: string
  mode: Mode
  battery_v: number | null
  moisture_switch: boolean
  distance_cm: number | null
  dh_dt: number | null
  classifier_class: string | null
  classifier_confidence: number | null
  p_trash: number | null
}

export type AlertType = 'overflow_warning' | 'cleaning_ticket'
export type Priority = 'critical' | 'high' | 'normal'

export interface Alert {
  id: number
  node_id: string
  created_at: string
  alert_type: AlertType
  priority: Priority
  message: string
  eta_minutes: number | null
  acknowledged: boolean
}

export type CrewKind = 'cleaning' | 'pump' | 'traffic'
export type CrewStatus = 'available' | 'en_route' | 'on_site' | 'off_duty'

export interface Team {
  id: string
  name: string
  kind: CrewKind
  municipality: string
  base_latitude: number
  base_longitude: number
  lead: string | null
  phone: string | null
  members: number
  status: CrewStatus
  updated_at: string | null
}

export type DispatchStatus = 'en_route' | 'on_site' | 'resolved' | 'cancelled'

export interface Dispatch {
  id: number
  team_id: string
  node_id: string
  alert_id: number | null
  status: DispatchStatus
  note: string | null
  travel_minutes: number | null
  created_at: string
  updated_at: string | null
  resolved_at: string | null
}

export type Channel = 'sms' | 'whatsapp' | 'radio'

export interface Notification {
  id: number
  team_id: string
  dispatch_id: number | null
  channel: Channel
  message: string
  status: string
  created_at: string
}

export interface RegionMode {
  municipality: string
  mode: Mode
  rain_probability: number | null
  rain_rate_mm_h: number | null
  updated_at: string | null
}

export interface CrewRecommendation {
  team_id: string
  status: CrewStatus
  kind: CrewKind
  distance_km: number
  travel_minutes: number
  fit: 'primary' | 'support' | 'fallback'
  available: boolean
  reachable: boolean
}

export interface Recommendations {
  node_id: string
  alert_type: AlertType
  crews: CrewRecommendation[]
}

export interface SystemInfo {
  version: string
  database: 'sqlite' | 'postgresql'
  weather_source: 'openweathermap' | 'mock'
  notification_gateway: string
  thresholds: {
    trash_alert_p: number
    overflow_lead_time_min: number
    min_rise_rate_cm_min: number
    sensor_empty_distance_cm: number
  }
  models: {
    edge_classifier: { name: string; runs_on: string; classes: string[]; source: string }
    flood_predictor: { name: string; runs_on: string; method: string; source: string }
  }
  mode_intervals_s: Record<string, number>
}

export interface SimulatorState {
  running: boolean
  scenario: 'dry' | 'storm' | null
  started_at: string | null
  finished_at: string | null
  error: string | null
}
