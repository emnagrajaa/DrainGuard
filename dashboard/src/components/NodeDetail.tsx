import { useState } from 'react'
import {
  ArrowLeft,
  BatteryLow,
  BatteryMedium,
  Check,
  CircleCheck,
  MapPin,
  MessageSquare,
  Send,
  TriangleAlert,
} from 'lucide-react'
import { useAckNode, useCreateDispatch, useNodeHistory, useRecommendations, useUpdateDispatch } from '../api/queries'
import type { Channel, CrewRecommendation, Dispatch, FleetNode } from '../api/types'
import {
  CHANNEL_LABEL,
  CLASSIFIER_LABEL,
  CREW_KIND,
  MODES,
  SEVERITY,
  arrivalTime,
  waterLevel,
  type Incident,
} from '../lib/domain'
import { useOps } from '../lib/ops'
import { fmtAgo, fmtClock, fmtDuration, minutesBetween, parseTs, useNow } from '../lib/time'
import { LevelChart, StaffGauge } from './charts'
import { NotifyDialog } from './NotifyDialog'
import { useToast } from './Toasts'
import { CREW_ICON, CrewStatusChip, Dialog, Segmented, SeverityChip } from './ui'

export function NodeDetail({ nodeId, onBack }: { nodeId: string; onBack: () => void }) {
  const { nodeById, incidentByNode, emptyCm, system } = useOps()
  const now = useNow(1000)
  const node = nodeById.get(nodeId)
  const incident = incidentByNode.get(nodeId)
  const history = useNodeHistory(nodeId)

  if (!node) {
    return (
      <div className="detail">
        <button type="button" className="link-btn detail__back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden /> All incidents
        </button>
        <div className="empty">
          <p className="empty__title">{nodeId} hasn't reported</p>
          <p>The sensor may have been removed or the demo data was reset.</p>
        </div>
      </div>
    )
  }

  const level = waterLevel(node.latest?.distance_cm, emptyCm)
  const seen = parseTs(node.last_seen)
  const latestAt = parseTs(node.latest?.timestamp)
  const lowBattery = (node.battery_v ?? 4) < 3.3
  const cls = node.classifier

  return (
    <div className="detail">
      <button type="button" className="link-btn detail__back" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden /> All incidents
      </button>

      <header className="detail__head">
        {incident ? <SeverityChip severity={incident.severity} /> : <span className="chip chip--good"><CircleCheck size={13} aria-hidden /> No open incident</span>}
        <h2 className="detail__id mono">{node.id}</h2>
        <p className="detail__where">
          <MapPin size={13} aria-hidden />
          {node.municipality}
          <span className="mono muted">
            {node.latitude?.toFixed(4)}, {node.longitude?.toFixed(4)}
          </span>
        </p>
      </header>

      {incident && <Headline incident={incident} now={now} />}

      <section className="detail__section" aria-labelledby="sensor-h">
        <div className="detail__section-head">
          <h3 id="sensor-h" className="eyebrow">Drain sensor</h3>
          <span className="muted small">Last report {fmtAgo(seen, now)}</span>
        </div>
        <div className="sensor">
          <StaffGauge levelCm={level?.levelCm ?? null} emptyCm={emptyCm} />
          <dl className="facts">
            <div>
              <dt>Headroom</dt>
              <dd>{level ? `${level.headroomCm.toFixed(1)} cm` : '—'}</dd>
            </div>
            <div>
              <dt>Rise rate</dt>
              <dd>{node.latest?.dh_dt != null ? `${node.latest.dh_dt.toFixed(2)} cm/min` : 'Not rising'}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{node.current_mode ? `${MODES[node.current_mode].label} · ${MODES[node.current_mode].sampling}` : '—'}</dd>
            </div>
            <div>
              <dt>Battery</dt>
              <dd className={lowBattery ? 'is-warn' : ''}>
                {lowBattery ? <BatteryLow size={14} aria-hidden /> : <BatteryMedium size={14} aria-hidden />}
                {node.battery_v?.toFixed(2) ?? '—'} V
              </dd>
            </div>
            <div>
              <dt>Moisture switch</dt>
              <dd>{node.latest?.moisture_switch ? 'Wet' : 'Dry'}</dd>
            </div>
          </dl>
        </div>
        <LevelChart readings={history.data ?? []} emptyCm={emptyCm} />
      </section>

      <section className="detail__section" aria-labelledby="models-h">
        <h3 id="models-h" className="eyebrow">What the models see</h3>
        <div className="models">
          <div className="model">
            <span className="model__layer">Layer 1 · on the drain</span>
            <span className="model__name">{system?.models.edge_classifier.name ?? 'Edge debris classifier'}</span>
            {cls ? (
              <>
                <span className="model__value">{CLASSIFIER_LABEL[cls.class] ?? cls.class}</span>
                <span className="model__meta">
                  Blockage probability {Math.round((cls.p_trash ?? 0) * 100)}% · confidence {Math.round((cls.confidence ?? 0) * 100)}%
                </span>
              </>
            ) : (
              <span className="model__meta">No classification yet</span>
            )}
          </div>
          <div className="model">
            <span className="model__layer">Layer 2 · in the cloud</span>
            <span className="model__name">{system?.models.flood_predictor.name ?? 'Flood predictor'}</span>
            {node.projected_overflow_min != null && latestAt ? (
              <>
                <span className="model__value">Overflow around {fmtClock(new Date(latestAt.getTime() + node.projected_overflow_min * 60000))}</span>
                <span className="model__meta">
                  Projected from the {fmtClock(latestAt)} reading · {system?.models.flood_predictor.method ?? 'dh/dt projection'}
                </span>
              </>
            ) : (
              <>
                <span className="model__value">No overflow projected</span>
                <span className="model__meta">Projects only while water is rising in storm mode</span>
              </>
            )}
          </div>
        </div>
      </section>

      {incident && <Response incident={incident} node={node} />}

      {incident && (
        <section className="detail__section" aria-labelledby="alerts-h">
          <h3 id="alerts-h" className="eyebrow">
            Decision engine alerts · {incident.alerts.length} open
          </h3>
          <AlertLog incident={incident} />
        </section>
      )}
    </div>
  )
}

function Headline({ incident, now }: { incident: Incident; now: Date }) {
  if (incident.severity === 'critical') {
    const eta = incident.overflowAt ? minutesBetween(now, incident.overflowAt) : null
    return (
      <div className="headline headline--critical">
        <span className="headline__label">{eta != null && eta <= 0 ? 'Projected overflow reached' : 'Projected overflow in'}</span>
        <span className="headline__value">
          {eta == null ? '—' : eta <= 0 ? 'Now' : fmtDuration(eta)}
        </span>
        <span className="headline__meta">
          {incident.overflowAt && `Around ${fmtClock(incident.overflowAt)}`}
          {incident.riseRate != null && ` · water rising ${incident.riseRate.toFixed(2)} cm/min`}
        </span>
      </div>
    )
  }
  const p = incident.pTrash
  return (
    <div className={`headline headline--${SEVERITY[incident.severity].tone}`}>
      <span className="headline__label">Blockage probability</span>
      <span className="headline__value">{p != null ? `${Math.round(p * 100)}%` : '—'}</span>
      <span className="headline__meta">
        {incident.severity === 'high' ? 'Rain is forecast — clear the inlet before the storm arrives.' : 'Schedule cleaning on the next route.'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- response

function Response({ incident, node }: { incident: Incident; node: FleetNode }) {
  return (
    <section className="detail__section" aria-labelledby="resp-h">
      <h3 id="resp-h" className="eyebrow">Response</h3>
      {incident.dispatch ? (
        <ActiveDispatch dispatch={incident.dispatch} incident={incident} />
      ) : (
        <Recommendations incident={incident} node={node} />
      )}
    </section>
  )
}

function Recommendations({ incident, node }: { incident: Incident; node: FleetNode }) {
  const { teamById } = useOps()
  const recs = useRecommendations(node.id)
  const ack = useAckNode()
  const toast = useToast()
  const now = useNow(5000)
  const [showAll, setShowAll] = useState(false)
  const [choice, setChoice] = useState<CrewRecommendation | null>(null)

  const crews = recs.data?.crews ?? []
  const ready = crews.filter((c) => c.available && c.reachable)
  const shown = showAll ? crews : ready.slice(0, 4)
  const overflowIn = incident.overflowAt ? minutesBetween(now, incident.overflowAt) : null

  return (
    <div className="recs">
      <p className="recs__intro">
        Recommended crews, ranked by fit for {incident.severity === 'critical' ? 'a flood risk' : 'a blockage'} and drive time.
      </p>
      {recs.isPending && <p className="muted small">Ranking crews…</p>}
      {recs.isSuccess && ready.length === 0 && !showAll && (
        <p className="recs__none">
          <TriangleAlert size={14} aria-hidden /> No available crew can reach this drain within an hour.
        </p>
      )}
      <ul className="recs__list">
        {shown.map((c) => {
          const team = teamById.get(c.team_id)
          const Icon = CREW_ICON[c.kind]
          const margin = overflowIn != null ? overflowIn - c.travel_minutes : null
          return (
            <li key={c.team_id} className="rec">
              <span className="rec__icon">
                <Icon size={16} aria-hidden />
              </span>
              <span className="rec__body">
                <span className="rec__title">
                  <span className="mono">{c.team_id}</span> {team?.name}
                </span>
                <span className="rec__meta">
                  {CREW_KIND[c.kind].label}
                  {c.fit === 'primary' ? ' · best fit' : c.fit === 'support' ? ' · support' : ''} · {c.distance_km.toFixed(1)} km ·{' '}
                  {fmtDuration(c.travel_minutes)} away
                </span>
                {margin != null && c.available && (
                  <span className={`rec__margin ${margin >= 0 ? 'is-ok' : 'is-late'}`}>
                    {margin >= 0 ? <Check size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
                    {margin >= 0 ? `Arrives ~${fmtDuration(margin)} before overflow` : `Arrives ~${fmtDuration(-margin)} after overflow`}
                  </span>
                )}
              </span>
              {c.available ? (
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setChoice(c)}>
                  Dispatch
                </button>
              ) : (
                <CrewStatusChip status={c.status} />
              )}
            </li>
          )
        })}
      </ul>
      <div className="recs__foot">
        {crews.length > ready.length && (
          <button type="button" className="link-btn" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show recommended crews only' : `Show all ${crews.length} crews`}
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm"
          disabled={ack.isPending}
          onClick={() =>
            ack.mutate(node.id, {
              onSuccess: (r) => toast({ tone: 'accent', title: `Acknowledged ${node.id}`, body: `${r.acknowledged} alerts closed without a dispatch.` }),
            })
          }
        >
          <Check size={14} aria-hidden />
          Acknowledge without dispatch
        </button>
      </div>

      <DispatchDialog rec={choice} incident={incident} onClose={() => setChoice(null)} />
    </div>
  )
}

function DispatchDialog({ rec, incident, onClose }: { rec: CrewRecommendation | null; incident: Incident; onClose: () => void }) {
  const { teamById } = useOps()
  const create = useCreateDispatch()
  const toast = useToast()
  const [channel, setChannel] = useState<Channel>('sms')
  const [note, setNote] = useState('')
  const team = rec ? teamById.get(rec.team_id) : undefined
  const node = incident.node

  const close = () => {
    setNote('')
    create.reset()
    onClose()
  }

  const preview = [
    `DrainGuard dispatch: proceed to drain ${incident.nodeId} (${incident.municipality}), ${node?.latitude?.toFixed(4)}, ${node?.longitude?.toFixed(4)}.`,
    incident.severity === 'critical' ? 'Overflow projected soon. Deploy pumps, divert traffic.' : 'Blockage detected by the drain sensor. Clear the inlet.',
    note.trim(),
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Dialog
      open={!!rec}
      onClose={close}
      title={`Dispatch ${rec?.team_id ?? ''} to ${incident.nodeId}`}
      sub={team ? `${team.name} · lead ${team.lead ?? '—'} · ${team.phone ?? ''} · about ${fmtDuration(rec!.travel_minutes)} away` : undefined}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={create.isPending}
            onClick={() =>
              rec &&
              create.mutate(
                { team_id: rec.team_id, node_id: incident.nodeId, channel, note: note.trim() || undefined },
                {
                  onSuccess: (d) => {
                    toast({
                      tone: 'good',
                      title: `${d.team_id} dispatched to ${d.node_id}`,
                      body: `${CHANNEL_LABEL[channel]} sent to the crew lead. Arrival in about ${fmtDuration(d.travel_minutes ?? 0)}.`,
                    })
                    close()
                  },
                },
              )
            }
          >
            <Send size={14} aria-hidden />
            Dispatch and notify
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Notify the crew by</span>
        <Segmented<Channel>
          label="Channel"
          value={channel}
          onChange={setChannel}
          options={(['sms', 'whatsapp', 'radio'] as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
      </div>
      <label className="field">
        <span className="field__label">Note for the crew (optional)</span>
        <input className="input" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Access from Rue de Marseille; bring the 6-inch pump" />
      </label>
      <div className="field">
        <span className="field__label">Message preview</span>
        <p className="preview">{preview}</p>
      </div>
      {create.error && <p className="form-error">{create.error.message}</p>}
    </Dialog>
  )
}

function ActiveDispatch({ dispatch, incident }: { dispatch: Dispatch; incident: Incident }) {
  const { teamById } = useOps()
  const update = useUpdateDispatch()
  const toast = useToast()
  const now = useNow(1000)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const team = teamById.get(dispatch.team_id)
  const created = parseTs(dispatch.created_at)
  const eta = arrivalTime(dispatch)
  const remaining = eta ? minutesBetween(now, eta) : null
  const progress = created && dispatch.travel_minutes ? Math.min(1, minutesBetween(created, now) / dispatch.travel_minutes) : 0
  const onSite = dispatch.status === 'on_site'
  const Icon = team ? CREW_ICON[team.kind] : Send

  const set = (status: 'on_site' | 'resolved' | 'cancelled', done: string) =>
    update.mutate({ id: dispatch.id, status }, { onSuccess: () => toast({ tone: status === 'resolved' ? 'good' : 'accent', title: done }) })

  return (
    <div className="dispatch">
      <div className="dispatch__crew">
        <span className="rec__icon">
          <Icon size={16} aria-hidden />
        </span>
        <span className="rec__body">
          <span className="rec__title">
            <span className="mono">{dispatch.team_id}</span> {team?.name}
          </span>
          <span className="rec__meta">
            Lead {team?.lead ?? '—'} · {team?.phone}
          </span>
        </span>
        <button type="button" className="icon-btn" onClick={() => setNotifyOpen(true)} aria-label={`Message ${dispatch.team_id}`} title="Message crew">
          <MessageSquare size={16} />
        </button>
      </div>

      <ol className="steps">
        <li className="steps__item is-done">
          <span className="steps__mark" aria-hidden />
          <span>
            Dispatched <span className="muted">{fmtClock(created)}</span>
          </span>
        </li>
        <li className={`steps__item ${onSite ? 'is-done' : 'is-current'}`}>
          <span className="steps__mark" aria-hidden />
          <span>
            {onSite ? 'Arrived' : 'En route'}
            {!onSite && eta && (
              <span className="muted">
                {' '}
                · {remaining != null && remaining > 0 ? `arrives in ${fmtDuration(remaining)} (${fmtClock(eta)})` : 'due now'}
              </span>
            )}
            {!onSite && (
              <span className="steps__bar" aria-hidden>
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
            )}
          </span>
        </li>
        <li className={`steps__item ${onSite ? 'is-current' : ''}`}>
          <span className="steps__mark" aria-hidden />
          <span>On site</span>
        </li>
        <li className="steps__item">
          <span className="steps__mark" aria-hidden />
          <span>Resolved</span>
        </li>
      </ol>

      <div className="dispatch__actions">
        {!onSite && (
          <button type="button" className="btn btn--sm" disabled={update.isPending} onClick={() => set('on_site', `${dispatch.team_id} is on site at ${dispatch.node_id}`)}>
            Mark on site
          </button>
        )}
        <button type="button" className="btn btn--primary btn--sm" disabled={update.isPending} onClick={() => set('resolved', `${dispatch.node_id} resolved`)}>
          <CircleCheck size={14} aria-hidden />
          Mark resolved
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={update.isPending} onClick={() => set('cancelled', `${dispatch.team_id} stood down`)}>
          Stand down
        </button>
      </div>
      {incident.severity === 'critical' && eta && incident.overflowAt && eta > incident.overflowAt && !onSite && (
        <p className="recs__none">
          <TriangleAlert size={14} aria-hidden /> The crew arrives after projected overflow. Consider sending traffic diversion too.
        </p>
      )}
      {update.error && <p className="form-error">{update.error.message}</p>}

      <NotifyDialog open={notifyOpen} onClose={() => setNotifyOpen(false)} teamIds={[dispatch.team_id]} />
    </div>
  )
}

function AlertLog({ incident }: { incident: Incident }) {
  const [all, setAll] = useState(false)
  const list = all ? incident.alerts : incident.alerts.slice(0, 3)
  return (
    <>
      <ul className="alertlog">
        {list.map((a) => (
          <li key={a.id}>
            <span className="mono muted">{fmtClock(parseTs(a.created_at), true)}</span>
            <span>{a.message}</span>
          </li>
        ))}
      </ul>
      {incident.alerts.length > 3 && (
        <button type="button" className="link-btn" onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${incident.alerts.length} alerts`}
        </button>
      )}
    </>
  )
}
