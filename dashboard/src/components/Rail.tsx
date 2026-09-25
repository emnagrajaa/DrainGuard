import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Megaphone, MessageSquare, Send, Truck, Waves } from 'lucide-react'
import { useAlertLog, useNotifications } from '../api/queries'
import type { Team } from '../api/types'
import { CHANNEL_LABEL, CREW_KIND, SEVERITY, arrivalTime, inScope, type Incident } from '../lib/domain'
import { useOps } from '../lib/ops'
import { fmtAgo, fmtClock, fmtDuration, minutesBetween, parseTs, useNow } from '../lib/time'
import { NodeDetail } from './NodeDetail'
import { NotifyDialog } from './NotifyDialog'
import { CREW_ICON, CrewStatusChip, SeverityChip } from './ui'

type Tab = 'incidents' | 'crews' | 'activity'

export function Rail() {
  const { selectedNodeId, openNode, incidents, scopedTeams } = useOps()
  const [tab, setTab] = useState<Tab>('incidents')
  const ref = useRef<HTMLElement>(null)

  // Opening or closing a drain starts the panel from the top.
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [selectedNodeId, tab])

  if (selectedNodeId) {
    return (
      <aside ref={ref} className="rail" aria-label="Drain details">
        <NodeDetail key={selectedNodeId} nodeId={selectedNodeId} onBack={() => openNode(null)} />
      </aside>
    )
  }

  const available = scopedTeams.filter((t) => t.status === 'available').length
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'incidents', label: 'Incidents', count: incidents.length },
    { id: 'crews', label: 'Crews', count: available },
    { id: 'activity', label: 'Activity' },
  ]

  return (
    <aside ref={ref} className="rail" aria-label="Incidents and crews">
      <div className="rail__tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="rail__tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count != null && <span className="rail__count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="rail__body" role="tabpanel">
        {tab === 'incidents' && <IncidentList />}
        {tab === 'crews' && <CrewList />}
        {tab === 'activity' && <ActivityFeed />}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------- incidents

function IncidentList() {
  const { incidents, openNode, selectedNodeId, simulator } = useOps()
  const now = useNow(1000)

  if (!incidents.length) {
    return (
      <div className="empty">
        <p className="empty__title">No open incidents</p>
        <p>Every drain in this area is within limits. New alerts from the decision engine appear here, most urgent first.</p>
        {simulator?.running && <p className="muted">Simulation running — readings are arriving.</p>}
      </div>
    )
  }

  return (
    <>
      <p className="rail__note">Most urgent first · flood risks sorted by time to overflow</p>
      <ul className="inc-list">
        {incidents.map((inc) => (
          <li key={inc.nodeId}>
            <IncidentCard inc={inc} now={now} selected={inc.nodeId === selectedNodeId} onOpen={() => openNode(inc.nodeId)} />
          </li>
        ))}
      </ul>
    </>
  )
}

function IncidentCard({ inc, now, selected, onOpen }: { inc: Incident; now: Date; selected: boolean; onOpen: () => void }) {
  const { teamById } = useOps()
  const tone = SEVERITY[inc.severity].tone
  const eta = inc.overflowAt ? minutesBetween(now, inc.overflowAt) : null
  const team = inc.dispatch ? teamById.get(inc.dispatch.team_id) : undefined
  const arrive = inc.dispatch ? arrivalTime(inc.dispatch) : null

  return (
    <button type="button" className={`inc inc--${tone} ${selected ? 'is-selected' : ''}`} onClick={onOpen}>
      <span className="inc__top">
        <SeverityChip severity={inc.severity} />
        <span className="inc__age">opened {fmtAgo(inc.firstAt, now)}</span>
      </span>
      <span className="inc__main">
        <span className="inc__who">
          <span className="inc__id mono">{inc.nodeId}</span>
          <span className="inc__where">{inc.municipality}</span>
        </span>
        {inc.severity === 'critical' ? (
          <span className="inc__figure">
            <span className="inc__num">{eta == null ? '—' : eta <= 0 ? 'Now' : Math.ceil(eta)}</span>
            <span className="inc__unit">{eta != null && eta <= 0 ? 'overflowing' : 'min to overflow'}</span>
          </span>
        ) : (
          <span className="inc__figure">
            <span className="inc__num">{inc.pTrash != null ? `${Math.round(inc.pTrash * 100)}%` : '—'}</span>
            <span className="inc__unit">blockage probability</span>
          </span>
        )}
      </span>
      <span className="inc__facts">
        {inc.severity === 'critical' && inc.riseRate != null && <span>Rising {inc.riseRate.toFixed(2)} cm/min</span>}
        <span>
          {inc.alerts.length} alert{inc.alerts.length === 1 ? '' : 's'}
        </span>
      </span>
      {inc.dispatch ? (
        <span className="inc__resp">
          <Truck size={14} aria-hidden />
          <span>
            <span className="mono">{inc.dispatch.team_id}</span> {inc.dispatch.status === 'on_site' ? 'on site' : 'en route'}
            {inc.dispatch.status === 'en_route' && arrive && <> · arrives {fmtClock(arrive)}</>}
            {team && <span className="muted"> · {CREW_KIND[team.kind].label}</span>}
          </span>
        </span>
      ) : (
        <span className="inc__resp inc__resp--none">No crew assigned</span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- crews

const ORDER = { en_route: 0, on_site: 1, available: 2, off_duty: 3 }

function CrewList() {
  const { scopedTeams, activeDispatchByTeam, openNode } = useOps()
  const [notifyOpen, setNotifyOpen] = useState(false)
  const now = useNow(5000)
  const sorted = [...scopedTeams].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id))

  return (
    <>
      <div className="rail__bar">
        <p className="rail__note">{scopedTeams.length} crews in this area</p>
        <button type="button" className="btn btn--sm" onClick={() => setNotifyOpen(true)}>
          <Megaphone size={14} aria-hidden />
          Message crews
        </button>
      </div>
      <ul className="crew-list">
        {sorted.map((t) => (
          <CrewRow key={t.id} team={t} now={now} onOpenNode={openNode} dispatchNode={activeDispatchByTeam.get(t.id)?.node_id} />
        ))}
      </ul>
      <NotifyDialog open={notifyOpen} onClose={() => setNotifyOpen(false)} />
    </>
  )
}

function CrewRow({ team, now, onOpenNode, dispatchNode }: { team: Team; now: Date; onOpenNode: (id: string) => void; dispatchNode?: string }) {
  const { activeDispatchByTeam } = useOps()
  const Icon = CREW_ICON[team.kind]
  const d = activeDispatchByTeam.get(team.id)
  const eta = d ? arrivalTime(d) : null
  const left = eta ? minutesBetween(now, eta) : null
  return (
    <li className={`crew-row ${team.status === 'off_duty' ? 'is-off' : ''}`}>
      <span className="rec__icon">
        <Icon size={16} aria-hidden />
      </span>
      <span className="rec__body">
        <span className="rec__title">
          <span className="mono">{team.id}</span> {team.name}
        </span>
        <span className="rec__meta">
          {team.municipality} · {team.members} people · lead {team.lead}
        </span>
        {dispatchNode && (
          <button type="button" className="link-btn crew-row__job" onClick={() => onOpenNode(dispatchNode)}>
            {d?.status === 'on_site' ? 'On site at' : 'Heading to'} <span className="mono">{dispatchNode}</span>
            {d?.status === 'en_route' && left != null && <span className="muted"> · {left > 0 ? fmtDuration(left) : 'due now'}</span>}
          </button>
        )}
      </span>
      <CrewStatusChip status={team.status} />
    </li>
  )
}

// ---------------------------------------------------------------- activity

interface Event {
  at: Date
  key: string
  icon: 'alert' | 'dispatch' | 'message'
  tone?: string
  text: ReactNode
}

function ActivityFeed() {
  const { dispatches, scope, nodeById, teamById } = useOps()
  const notes = useNotifications()
  const log = useAlertLog()
  const events = useMemo(() => {
    const out: Event[] = []
    const scoped = (nodeId: string) => inScope(scope, nodeById.get(nodeId)?.municipality)

    // Incident openings: an alert of a new type, or after 30+ quiet minutes on
    // that node, starts a new run; repeats within a run are not news.
    const lastAlert = new Map<string, { at: Date; type: string }>()
    for (const a of [...(log.data ?? [])].sort((x, y) => x.id - y.id)) {
      if (!scoped(a.node_id)) continue
      const prev = lastAlert.get(a.node_id)
      const at = parseTs(a.created_at)!
      lastAlert.set(a.node_id, { at, type: a.alert_type })
      if (!prev || prev.type !== a.alert_type || minutesBetween(prev.at, at) > 30) {
        out.push({
          at,
          key: `a${a.id}`,
          icon: 'alert',
          tone: a.alert_type === 'overflow_warning' ? 'critical' : 'serious',
          text: (
            <>
              {a.alert_type === 'overflow_warning' ? 'Overflow warning' : 'Cleaning ticket'} opened for <span className="mono">{a.node_id}</span>
            </>
          ),
        })
      }
    }

    for (const d of dispatches) {
      if (!scoped(d.node_id)) continue
      out.push({
        at: parseTs(d.created_at)!,
        key: `d${d.id}`,
        icon: 'dispatch',
        text: (
          <>
            <span className="mono">{d.team_id}</span> dispatched to <span className="mono">{d.node_id}</span>
          </>
        ),
      })
      if (d.status !== 'en_route' && d.updated_at) {
        const verb = { on_site: 'arrived at', resolved: 'resolved', cancelled: 'stood down from' }[d.status as 'on_site' | 'resolved' | 'cancelled']
        out.push({
          at: parseTs(d.updated_at)!,
          key: `d${d.id}-${d.status}`,
          icon: 'dispatch',
          tone: d.status === 'resolved' ? 'good' : undefined,
          text: (
            <>
              <span className="mono">{d.team_id}</span> {verb} <span className="mono">{d.node_id}</span>
            </>
          ),
        })
      }
    }

    // Broadcasts create one record per crew; show them as one message.
    const grouped = new Map<string, { at: Date; teams: string[]; channel: string; message: string; dispatch: boolean }>()
    for (const n of notes.data ?? []) {
      const team = teamById.get(n.team_id)
      if (!inScope(scope, team?.municipality)) continue
      const k = `${n.created_at}|${n.message}`
      const g = grouped.get(k)
      if (g) g.teams.push(n.team_id)
      else grouped.set(k, { at: parseTs(n.created_at)!, teams: [n.team_id], channel: n.channel, message: n.message, dispatch: n.dispatch_id != null })
    }
    for (const [k, g] of grouped) {
      if (g.dispatch) continue // already shown as a dispatch
      out.push({
        at: g.at,
        key: `n${k}`,
        icon: 'message',
        text: (
          <>
            {CHANNEL_LABEL[g.channel as 'sms']} to {g.teams.length > 2 ? `${g.teams.length} crews` : g.teams.join(', ')}:{' '}
            <span className="muted">“{g.message}”</span>
          </>
        ),
      })
    }
    return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 60)
  }, [log.data, dispatches, notes.data, scope, nodeById, teamById])

  if (!events.length) {
    return (
      <div className="empty">
        <p className="empty__title">Nothing has happened yet</p>
        <p>Alerts, dispatches and crew messages are logged here as they happen.</p>
      </div>
    )
  }

  const ICONS = { alert: Waves, dispatch: Send, message: MessageSquare }
  return (
    <ol className="feed">
      {events.map((e) => {
        const Icon = ICONS[e.icon]
        return (
          <li key={e.key} className={`feed__item ${e.tone ? `feed__item--${e.tone}` : ''}`}>
            <span className="feed__icon">
              <Icon size={13} aria-hidden />
            </span>
            <span className="feed__text">{e.text}</span>
            <time className="feed__time mono" dateTime={e.at.toISOString()} title={e.at.toLocaleString('en-GB')}>
              {fmtClock(e.at)}
            </time>
          </li>
        )
      })}
    </ol>
  )
}
