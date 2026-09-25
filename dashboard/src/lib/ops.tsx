import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDispatches, useFleet, useOpenAlerts, useSimulator, useSystem, useTeams } from '../api/queries'
import type { Dispatch, FleetNode, SimulatorState, SystemInfo, Team } from '../api/types'
import { useToast } from '../components/Toasts'
import { ACTIVE_DISPATCH, SEVERITY, deriveIncidents, inScope, type Incident, type ScopeId } from './domain'

export type View = 'operations' | 'crews' | 'sensors' | 'analysis'
export const VIEWS: { id: View; label: string }[] = [
  { id: 'operations', label: 'Operations' },
  { id: 'crews', label: 'Crews' },
  { id: 'sensors', label: 'Sensors' },
  { id: 'analysis', label: 'Analysis' },
]

interface Ops {
  view: View
  setView: (v: View) => void
  scope: ScopeId
  setScope: (s: ScopeId) => void
  selectedNodeId: string | null
  /** Opens a node on the operations map (switches view if needed). */
  openNode: (id: string | null) => void
  /** Flies the map to a node without opening its details; null frames the whole area. */
  focusNode: (id: string | null) => void
  focus: { id: string | null; seq: number } | null

  fleet: FleetNode[]
  scopedFleet: FleetNode[]
  nodeById: Map<string, FleetNode>
  incidents: Incident[]
  allIncidents: Incident[]
  incidentByNode: Map<string, Incident>
  teams: Team[]
  scopedTeams: Team[]
  teamById: Map<string, Team>
  dispatches: Dispatch[]
  activeDispatchByTeam: Map<string, Dispatch>
  system: SystemInfo | undefined
  simulator: SimulatorState | undefined
  emptyCm: number
  leadTimeMin: number
  trashThreshold: number

  online: boolean
  loading: boolean
  updatedAt: Date | null
}

const OpsContext = createContext<Ops | null>(null)

export function useOps(): Ops {
  const ctx = useContext(OpsContext)
  if (!ctx) throw new Error('useOps outside OpsProvider')
  return ctx
}

function readHash(): View {
  const v = window.location.hash.replace(/^#\/?/, '') as View
  return VIEWS.some((x) => x.id === v) ? v : 'operations'
}

export function OpsProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<View>(readHash)
  const [scope, setScope] = useState<ScopeId>('all')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ id: string | null; seq: number } | null>(null)

  useEffect(() => {
    const onHash = () => setViewState(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setView = (v: View) => {
    window.location.hash = `/${v}`
    setViewState(v)
  }

  const fleetQ = useFleet()
  const alertsQ = useOpenAlerts()
  const teamsQ = useTeams()
  const dispatchesQ = useDispatches()
  const systemQ = useSystem()
  const simQ = useSimulator()
  const toast = useToast()

  const value = useMemo<Ops>(() => {
    const fleet = fleetQ.data ?? []
    const teams = teamsQ.data ?? []
    const dispatches = dispatchesQ.data ?? []
    const allIncidents = deriveIncidents(alertsQ.data ?? [], fleet, dispatches)
    const activeDispatchByTeam = new Map<string, Dispatch>()
    for (const d of dispatches) {
      if (ACTIVE_DISPATCH.has(d.status) && !activeDispatchByTeam.has(d.team_id)) activeDispatchByTeam.set(d.team_id, d)
    }
    const system = systemQ.data
    return {
      view,
      setView,
      scope,
      setScope,
      selectedNodeId,
      openNode: (id) => {
        setSelectedNodeId(id)
        if (id && view !== 'operations') setView('operations')
      },
      focusNode: (id) => {
        setSelectedNodeId(null)
        setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 }))
        if (view !== 'operations') setView('operations')
      },
      focus,
      fleet,
      scopedFleet: fleet.filter((n) => inScope(scope, n.municipality)),
      nodeById: new Map(fleet.map((n) => [n.id, n])),
      incidents: allIncidents.filter((i) => inScope(scope, i.municipality)),
      allIncidents,
      incidentByNode: new Map(allIncidents.map((i) => [i.nodeId, i])),
      teams,
      scopedTeams: teams.filter((t) => inScope(scope, t.municipality)),
      teamById: new Map(teams.map((t) => [t.id, t])),
      dispatches,
      activeDispatchByTeam,
      system,
      simulator: simQ.data,
      emptyCm: system?.thresholds.sensor_empty_distance_cm ?? 45,
      leadTimeMin: system?.thresholds.overflow_lead_time_min ?? 45,
      trashThreshold: system?.thresholds.trash_alert_p ?? 0.5,
      online: !fleetQ.isError,
      loading: fleetQ.isPending,
      updatedAt: fleetQ.dataUpdatedAt ? new Date(fleetQ.dataUpdatedAt) : null,
    }
  }, [
    view,
    scope,
    selectedNodeId,
    focus,
    fleetQ.data,
    fleetQ.isError,
    fleetQ.isPending,
    fleetQ.dataUpdatedAt,
    alertsQ.data,
    teamsQ.data,
    dispatchesQ.data,
    systemQ.data,
    simQ.data,
  ])

  // Announce new incidents and escalations. The first load is history, not news.
  const seen = useRef<Map<string, number> | null>(null)
  useEffect(() => {
    if (!alertsQ.data || !fleetQ.data) return
    const current = new Map(value.allIncidents.map((i) => [i.nodeId, SEVERITY[i.severity].rank]))
    if (seen.current) {
      const prev = seen.current
      const news = value.allIncidents.filter((inc) => {
        const before = prev.get(inc.nodeId)
        return before === undefined || SEVERITY[inc.severity].rank < before
      })
      if (news.length > 2) {
        const critical = news.filter((i) => i.severity === 'critical').length
        toast({
          tone: critical ? 'critical' : 'serious',
          title: `${news.length} drains need attention`,
          body: critical ? `${critical} with projected overflow. The queue is sorted by urgency.` : 'Blockages flagged by the edge classifier.',
        })
      } else {
        for (const inc of news) {
          const escalated = prev.has(inc.nodeId)
          toast({
            tone: inc.severity === 'critical' ? 'critical' : 'serious',
            title: `${escalated ? 'Escalated' : 'New incident'}: ${SEVERITY[inc.severity].label.toLowerCase()} at ${inc.nodeId}`,
            body: inc.municipality,
            action: { label: 'Show on map', onClick: () => value.openNode(inc.nodeId) },
          })
        }
      }
    }
    seen.current = current
  }, [value.allIncidents])

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>
}
