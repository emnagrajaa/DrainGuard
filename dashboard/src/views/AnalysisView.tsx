import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAlertLog, useRegions, useSyncWeather } from '../api/queries'
import { API_TARGET_LABEL } from '../api/client'
import type { Alert, Dispatch } from '../api/types'
import { useToast } from '../components/Toasts'
import { CLASSIFIER_LABEL, MODES, inScope, isReporting, projectedOverflowAt } from '../lib/domain'
import { useOps } from '../lib/ops'
import { fmtAgo, fmtDuration, minutesBetween, parseTs, useNow } from '../lib/time'

export function AnalysisView() {
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Analysis</h1>
          <p className="page__sub">What the models are reading, the weather that sets sampling modes, and the outcomes the network delivers.</p>
        </div>
      </div>
      <div className="analysis">
        <ClassifierPanel />
        <PredictorPanel />
        <WeatherPanel />
        <ImpactPanel />
        <SystemPanel />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- bar list

interface Bar {
  id: string
  label: string
  value: number | null
  display: string
  emphasis: boolean
}

/** Ranked horizontal bars with a threshold rule. Emphasis marks the bars past it. */
function BarList({ rows, max, threshold, thresholdLabel, tone, empty }: { rows: Bar[]; max: number; threshold: number; thresholdLabel: string; tone: 'critical' | 'serious'; empty: string }) {
  const { openNode } = useOps()
  if (!rows.length) return <p className="muted small">{empty}</p>
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`
  return (
    <div className="bars">
      <div className="bars__rule" style={{ left: `calc(var(--bars-label) + (100% - var(--bars-label) - var(--bars-value)) * ${threshold / max})` }}>
        <span>{thresholdLabel}</span>
      </div>
      {rows.map((r) => (
        <button type="button" key={r.id} className="bars__row" onClick={() => openNode(r.id)} title={`${r.label}: ${r.display}`}>
          <span className="bars__label mono">{r.label}</span>
          <span className="bars__track">
            {r.value != null && <span className={`bars__bar ${r.emphasis ? `bars__bar--${tone}` : ''}`} style={{ width: pct(r.value) }} />}
          </span>
          <span className="bars__value tabular">{r.display}</span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- layer 1

function ClassifierPanel() {
  const { scopedFleet, trashThreshold, system } = useOps()
  const rows: Bar[] = scopedFleet
    .filter((n) => n.classifier?.p_trash != null)
    .sort((a, b) => b.classifier!.p_trash! - a.classifier!.p_trash!)
    .map((n) => ({
      id: n.id,
      label: n.id,
      value: n.classifier!.p_trash!,
      display: `${Math.round(n.classifier!.p_trash! * 100)}% · ${CLASSIFIER_LABEL[n.classifier!.class] ?? n.classifier!.class}`,
      emphasis: n.classifier!.p_trash! > trashThreshold,
    }))
  const counts = new Map<string, number>()
  for (const n of scopedFleet) if (n.classifier) counts.set(n.classifier.class, (counts.get(n.classifier.class) ?? 0) + 1)
  const src = system?.models.edge_classifier.source

  return (
    <section className="card" aria-labelledby="l1-h">
      <div className="card__head">
        <div>
          <span className="eyebrow">Layer 1 · {system?.models.edge_classifier.runs_on ?? 'on the drain'}</span>
          <h2 id="l1-h" className="section-title">
            Edge debris classifier
          </h2>
          <p className="card__sub">
            Latest blockage probability per drain. Above {Math.round(trashThreshold * 100)}% the decision engine opens a cleaning ticket.
          </p>
        </div>
        <ul className="class-counts" aria-label="Latest class per drain">
          {(system?.models.edge_classifier.classes ?? Object.keys(CLASSIFIER_LABEL)).map((c) => (
            <li key={c}>
              <span className="class-counts__n">{counts.get(c) ?? 0}</span>
              <span className="class-counts__l">{CLASSIFIER_LABEL[c] ?? c}</span>
            </li>
          ))}
        </ul>
      </div>
      <BarList rows={rows} max={1} threshold={trashThreshold} thresholdLabel={`Ticket at ${Math.round(trashThreshold * 100)}%`} tone="serious" empty="No classifier outputs yet — drains classify debris in dry and pre-storm modes." />
      {src && <p className="source">Outputs arrive with each uplink · source: {src === 'edge_simulator' ? 'edge simulator (firmware model pending)' : src}</p>}
    </section>
  )
}

// ---------------------------------------------------------------- layer 2

function PredictorPanel() {
  const { scopedFleet, leadTimeMin, system } = useOps()
  const now = useNow(1000)
  const max = leadTimeMin * 2
  const rows: Bar[] = scopedFleet
    .filter((n) => n.latest?.mode === 3)
    .map((n) => {
      const at = projectedOverflowAt(n)
      return { n, left: at ? Math.max(0, minutesBetween(now, at)) : null }
    })
    .sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity))
    .map(({ n, left }) => ({
      id: n.id,
      label: n.id,
      value: left == null ? null : Math.min(max, left),
      display: left == null ? 'Not rising' : left <= 0 ? 'Overflow reached' : fmtDuration(left),
      emphasis: left != null && left <= leadTimeMin,
    }))

  return (
    <section className="card" aria-labelledby="l2-h">
      <div className="card__head">
        <div>
          <span className="eyebrow">Layer 2 · {system?.models.flood_predictor.runs_on ?? 'in the cloud'}</span>
          <h2 id="l2-h" className="section-title">
            Flood predictor
          </h2>
          <p className="card__sub">
            Time left before each storm-mode drain overflows at its current rise rate. Inside {leadTimeMin} min the engine raises a flood warning — shorter bars are more urgent.
          </p>
        </div>
      </div>
      <BarList
        rows={rows}
        max={max}
        threshold={leadTimeMin}
        thresholdLabel={`Warning at ${leadTimeMin} min`}
        tone="critical"
        empty="No drains in storm mode. Projections start when the moisture switch trips and water begins to rise."
      />
      {system && <p className="source">Method: {system.models.flood_predictor.method} · scale capped at {max} min</p>}
    </section>
  )
}

// ---------------------------------------------------------------- weather

function WeatherPanel() {
  const { fleet, system } = useOps()
  const regions = useRegions()
  const sync = useSyncWeather()
  const toast = useToast()
  const now = useNow(10000)
  const byMuni = new Map((regions.data ?? []).map((r) => [r.municipality, r]))
  const munis = ['Tunis', 'Ariana', 'Sousse', 'Sfax', 'Nabeul']

  return (
    <section className="card analysis__full" aria-labelledby="wx-h">
      <div className="card__head">
        <div>
          <span className="eyebrow">Weather sync</span>
          <h2 id="wx-h" className="section-title">
            Forecast and sampling modes
          </h2>
          <p className="card__sub">
            Rain above 60% switches a municipality to pre-storm (15-minute sampling); rain above 2 mm/h switches it to storm (30 seconds).
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={sync.isPending}
          onClick={() => sync.mutate(undefined, { onSuccess: () => toast({ tone: 'accent', title: 'Forecast synced for 5 municipalities' }) })}
        >
          <RefreshCw size={14} aria-hidden className={sync.isPending ? 'spin' : ''} />
          Sync forecast now
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Municipality</th>
              <th scope="col" className="num">Rain probability</th>
              <th scope="col" className="num">Rain rate</th>
              <th scope="col">Forecast mode</th>
              <th scope="col">Sensors running</th>
              <th scope="col">Synced</th>
            </tr>
          </thead>
          <tbody>
            {munis.map((m) => {
              const r = byMuni.get(m)
              const nodes = fleet.filter((n) => n.municipality === m && isReporting(n, now))
              const running = nodes.reduce<number>((acc, n) => Math.max(acc, n.current_mode ?? 0), 0) as 0 | 1 | 2 | 3
              return (
                <tr key={m}>
                  <td className="cell-main">{m}</td>
                  <td className="num tabular">{r?.rain_probability != null ? `${Math.round(r.rain_probability * 100)}%` : '—'}</td>
                  <td className="num tabular">{r?.rain_rate_mm_h != null ? `${r.rain_rate_mm_h.toFixed(1)} mm/h` : '—'}</td>
                  <td>{r ? MODES[r.mode].label : <span className="muted">Not synced</span>}</td>
                  <td>{running ? `${MODES[running].label} · ${nodes.length} node${nodes.length === 1 ? '' : 's'}` : <span className="muted">No reports</span>}</td>
                  <td className="muted nowrap">{r ? fmtAgo(parseTs(r.updated_at), now) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {system && (
        <p className="source">
          Source: {system.weather_source === 'openweathermap' ? 'OpenWeatherMap One Call 3.0' : 'mock generator (set OWM_API_KEY on the API for live forecasts)'}
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- impact

interface Run {
  nodeId: string
  type: string
  priority: string
  first: Alert
}

function alertRuns(alerts: Alert[]): Run[] {
  const runs: Run[] = []
  const last = new Map<string, { at: Date; type: string }>()
  for (const a of [...alerts].sort((x, y) => x.id - y.id)) {
    const at = parseTs(a.created_at)!
    const prev = last.get(a.node_id)
    if (!prev || prev.type !== a.alert_type || minutesBetween(prev.at, at) > 30) {
      runs.push({ nodeId: a.node_id, type: a.alert_type, priority: a.priority, first: a })
    }
    last.set(a.node_id, { at, type: a.alert_type })
  }
  return runs
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function dispatchDelay(d: Dispatch, alerts: Alert[]): number | null {
  const at = parseTs(d.created_at)!
  const before = alerts
    .filter((a) => a.node_id === d.node_id)
    .map((a) => parseTs(a.created_at)!)
    .filter((t) => t <= at && minutesBetween(t, at) < 120)
  if (!before.length) return null
  return minutesBetween(new Date(Math.min(...before.map((t) => t.getTime()))), at)
}

function ImpactPanel() {
  const { dispatches, scope, nodeById } = useOps()
  const log = useAlertLog()

  const stats = useMemo(() => {
    const alerts = (log.data ?? []).filter((a) => inScope(scope, nodeById.get(a.node_id)?.municipality))
    const ds = dispatches.filter((d) => inScope(scope, nodeById.get(d.node_id)?.municipality))
    const runs = alertRuns(alerts)
    const floods = runs.filter((r) => r.type === 'overflow_warning')
    const dryTickets = runs.filter((r) => r.type === 'cleaning_ticket' && r.priority === 'normal')
    const preStormTickets = runs.filter((r) => r.type === 'cleaning_ticket' && r.priority === 'high')
    return {
      floods: floods.length,
      leadTime: median(floods.map((r) => r.first.eta_minutes ?? 0).filter((x) => x > 0)),
      tickets: dryTickets.length + preStormTickets.length,
      beforeRain: dryTickets.length,
      dispatched: ds.length,
      toDispatch: median(ds.map((d) => dispatchDelay(d, alerts)).filter((x): x is number => x != null)),
      resolved: ds.filter((d) => d.status === 'resolved').length,
    }
  }, [log.data, dispatches, scope, nodeById])

  const tiles = [
    { label: 'Flood warnings issued', value: String(stats.floods), note: 'Overflow projected within the lead-time window' },
    { label: 'Median warning lead time', value: stats.leadTime != null ? fmtDuration(stats.leadTime) : '—', note: 'Time between a warning and projected overflow' },
    { label: 'Blockages flagged', value: String(stats.tickets), note: `${stats.beforeRain} caught in dry weather, before any rain` },
    { label: 'Crews dispatched', value: String(stats.dispatched), note: `${stats.resolved} incidents resolved on site` },
    { label: 'Median time to dispatch', value: stats.toDispatch != null ? fmtDuration(stats.toDispatch) : '—', note: 'From first alert to crew on the move' },
  ]

  return (
    <section className="card analysis__full" aria-labelledby="impact-h">
      <div className="card__head">
        <div>
          <span className="eyebrow">Impact indicators · SDG 11.5 · SDG 13.1</span>
          <h2 id="impact-h" className="section-title">
            Outcomes
          </h2>
          <p className="card__sub">Reducing losses from water-related disasters and building resilience to climate hazards, measured from this network's records.</p>
        </div>
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className="tile">
            <span className="tile__label">{t.label}</span>
            <span className="tile__value">{t.value}</span>
            <span className="tile__note">{t.note}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- system

function SystemPanel() {
  const { system, online, simulator, fleet } = useOps()
  const rows: [string, string][] = [
    ['Cloud API', online ? `Connected · v${system?.version ?? '—'} · ${API_TARGET_LABEL}` : 'Unreachable — start it with: uvicorn cloud.api.main:app --port 8000'],
    ['Database', system ? (system.database === 'sqlite' ? 'SQLite (local demo)' : 'PostgreSQL + TimescaleDB') : '—'],
    ['Edge fleet', `${fleet.length} nodes registered · LoRaWAN payload contract (IngestPayload)`],
    ['Edge simulator', simulator?.running ? `Running ${simulator.scenario} scenario` : 'Idle — start a run from Simulate'],
    ['Crew notifications', system ? `SMS, WhatsApp, radio · delivery ${system.notification_gateway}` : '—'],
    [
      'Decision thresholds',
      system
        ? `Cleaning ticket above p(trash) ${system.thresholds.trash_alert_p} · flood warning within ${system.thresholds.overflow_lead_time_min} min · rise noise floor ${system.thresholds.min_rise_rate_cm_min} cm/min`
        : '—',
    ],
  ]
  return (
    <section className="card analysis__full" aria-labelledby="sys-h">
      <span className="eyebrow">Connections</span>
      <h2 id="sys-h" className="section-title">
        System
      </h2>
      <dl className="sys">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
