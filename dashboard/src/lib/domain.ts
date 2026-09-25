import type { Alert, CrewKind, CrewStatus, Dispatch, FleetNode, Mode, Team } from '../api/types'
import { minutesBetween, parseTs } from './time'

// ---------------------------------------------------------------- scope

export type ScopeId = 'all' | 'grand-tunis' | 'sousse' | 'sfax' | 'nabeul'

export const SCOPES: { id: ScopeId; label: string; municipalities: string[] | null }[] = [
  { id: 'all', label: 'All municipalities', municipalities: null },
  { id: 'grand-tunis', label: 'Grand Tunis', municipalities: ['Tunis', 'Ariana'] },
  { id: 'sousse', label: 'Sousse', municipalities: ['Sousse'] },
  { id: 'sfax', label: 'Sfax', municipalities: ['Sfax'] },
  { id: 'nabeul', label: 'Nabeul', municipalities: ['Nabeul'] },
]

export function inScope(scope: ScopeId, municipality: string | null | undefined): boolean {
  const s = SCOPES.find((x) => x.id === scope)
  if (!s?.municipalities) return true
  return !!municipality && s.municipalities.includes(municipality)
}

// ---------------------------------------------------------------- vocab

export type Tone = 'critical' | 'serious' | 'warning' | 'good' | 'neutral' | 'accent'

export const MODES: Record<Mode, { label: string; sampling: string }> = {
  1: { label: 'Dry', sampling: 'every 6 h' },
  2: { label: 'Pre-storm', sampling: 'every 15 min' },
  3: { label: 'Storm', sampling: 'every 30 s' },
}

export type Severity = 'critical' | 'high' | 'normal'

export const SEVERITY: Record<Severity, { label: string; tone: Tone; rank: number }> = {
  critical: { label: 'Flood risk', tone: 'critical', rank: 0 },
  high: { label: 'Urgent blockage', tone: 'serious', rank: 1 },
  normal: { label: 'Blockage', tone: 'warning', rank: 2 },
}

export const CREW_KIND: Record<CrewKind, { label: string; role: string }> = {
  cleaning: { label: 'Hydro-cleaning', role: 'Clears blocked inlets and silt' },
  pump: { label: 'Pump unit', role: 'Drains basins close to overflow' },
  traffic: { label: 'Traffic diversion', role: 'Closes and diverts flooded roads' },
}

export const CREW_STATUS: Record<CrewStatus, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'good' },
  en_route: { label: 'En route', tone: 'accent' },
  on_site: { label: 'On site', tone: 'accent' },
  off_duty: { label: 'Off duty', tone: 'neutral' },
}

export const CLASSIFIER_LABEL: Record<string, string> = {
  empty: 'Empty',
  solid_trash: 'Solid trash',
  organic_silt: 'Organic silt',
  false_positive: 'False positive',
}

export const CHANNEL_LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', radio: 'Radio' } as const

// ---------------------------------------------------------------- water level

/** Distance-to-water → level above an empty basin. Overflow is at `emptyCm`. */
export function waterLevel(distanceCm: number | null | undefined, emptyCm: number) {
  if (distanceCm == null) return null
  const level = Math.min(emptyCm, Math.max(0, emptyCm - distanceCm))
  return { levelCm: level, pct: level / emptyCm, headroomCm: Math.max(0, distanceCm) }
}

/** When the flood predictor expects this drain to overflow, from its latest storm reading. */
export function projectedOverflowAt(node: FleetNode): Date | null {
  const at = parseTs(node.latest?.timestamp)
  if (!at || node.latest?.mode !== 3 || node.projected_overflow_min == null) return null
  return new Date(at.getTime() + node.projected_overflow_min * 60000)
}

// ---------------------------------------------------------------- incidents

export interface Incident {
  nodeId: string
  node: FleetNode | undefined
  municipality: string
  severity: Severity
  alerts: Alert[]
  firstAt: Date
  lastAt: Date
  /** Projected overflow time from the flood predictor (critical incidents only). */
  overflowAt: Date | null
  riseRate: number | null
  pTrash: number | null
  dispatch: Dispatch | undefined
}

export function severityOf(a: Alert): Severity {
  if (a.alert_type === 'overflow_warning' || a.priority === 'critical') return 'critical'
  return a.priority === 'high' ? 'high' : 'normal'
}

export const ACTIVE_DISPATCH = new Set(['en_route', 'on_site'])

/**
 * The decision engine raises a fresh alert on every reading that breaches a
 * threshold, so one flooding drain produces many alerts. An incident is all of
 * a node's open alerts taken together.
 */
export function deriveIncidents(
  openAlerts: Alert[],
  fleet: FleetNode[],
  dispatches: Dispatch[],
): Incident[] {
  const nodes = new Map(fleet.map((n) => [n.id, n]))
  const activeDispatch = new Map<string, Dispatch>()
  for (const d of dispatches) {
    if (ACTIVE_DISPATCH.has(d.status) && !activeDispatch.has(d.node_id)) activeDispatch.set(d.node_id, d)
  }

  const byNode = new Map<string, Alert[]>()
  for (const a of openAlerts) {
    const list = byNode.get(a.node_id) ?? []
    list.push(a)
    byNode.set(a.node_id, list)
  }

  const incidents: Incident[] = []
  for (const [nodeId, alerts] of byNode) {
    alerts.sort((a, b) => b.id - a.id)
    const node = nodes.get(nodeId)
    const severity = alerts.map(severityOf).sort((a, b) => SEVERITY[a].rank - SEVERITY[b].rank)[0]
    const times = alerts.map((a) => parseTs(a.created_at)!.getTime())

    let overflowAt: Date | null = null
    if (severity === 'critical') {
      overflowAt = node ? projectedOverflowAt(node) : null
      if (!overflowAt) {
        const warn = alerts.find((a) => a.alert_type === 'overflow_warning' && a.eta_minutes != null)
        const at = parseTs(warn?.created_at)
        if (warn && at) overflowAt = new Date(at.getTime() + warn.eta_minutes! * 60000)
      }
    }

    incidents.push({
      nodeId,
      node,
      municipality: node?.municipality ?? 'Unknown',
      severity,
      alerts,
      firstAt: new Date(Math.min(...times)),
      lastAt: new Date(Math.max(...times)),
      overflowAt,
      riseRate: node?.latest?.dh_dt ?? null,
      pTrash: node?.classifier?.p_trash ?? null,
      dispatch: activeDispatch.get(nodeId),
    })
  }

  return incidents.sort(
    (a, b) =>
      SEVERITY[a.severity].rank - SEVERITY[b.severity].rank ||
      (a.overflowAt?.getTime() ?? Infinity) - (b.overflowAt?.getTime() ?? Infinity) ||
      b.lastAt.getTime() - a.lastAt.getTime(),
  )
}

// ---------------------------------------------------------------- crews

export interface CrewPosition {
  lat: number
  lon: number
  /** 0..1 along the route while en route */
  progress: number | null
}

/** Where to draw a crew: at base, interpolated along its route, or at the node. */
export function crewPosition(
  team: Team,
  dispatch: Dispatch | undefined,
  node: FleetNode | undefined,
  now: Date,
): CrewPosition {
  const base = { lat: team.base_latitude, lon: team.base_longitude, progress: null }
  if (!dispatch || node?.latitude == null || node.longitude == null) return base
  if (dispatch.status === 'on_site') return { lat: node.latitude, lon: node.longitude, progress: 1 }
  const created = parseTs(dispatch.created_at)
  if (!created || !dispatch.travel_minutes) return base
  const p = Math.min(1, Math.max(0, minutesBetween(created, now) / dispatch.travel_minutes))
  return {
    lat: base.lat + (node.latitude - base.lat) * p,
    lon: base.lon + (node.longitude - base.lon) * p,
    progress: p,
  }
}

export function arrivalTime(dispatch: Dispatch): Date | null {
  const created = parseTs(dispatch.created_at)
  if (!created || dispatch.travel_minutes == null) return null
  return new Date(created.getTime() + dispatch.travel_minutes * 60000)
}

/** A node is reporting if it has been heard from within its slowest sampling interval (+ margin). */
export function isReporting(node: FleetNode, now: Date): boolean {
  const seen = parseTs(node.last_seen)
  return !!seen && minutesBetween(seen, now) < 6.5 * 60
}
