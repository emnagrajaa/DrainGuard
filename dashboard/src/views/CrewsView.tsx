import { useMemo, useState } from 'react'
import { Megaphone, MessageSquare, Send } from 'lucide-react'
import { useCreateDispatch, useNotifications, useSetCrewDuty } from '../api/queries'
import type { Channel, Team } from '../api/types'
import { NotifyDialog } from '../components/NotifyDialog'
import { useToast } from '../components/Toasts'
import { CrewKindLabel, CrewStatusChip, Dialog, Segmented, SeverityChip } from '../components/ui'
import { CHANNEL_LABEL, CREW_KIND, arrivalTime, inScope } from '../lib/domain'
import { useOps } from '../lib/ops'
import { fmtClock, fmtDuration, minutesBetween, parseTs, useNow } from '../lib/time'

export function CrewsView() {
  const { scopedTeams, activeDispatchByTeam, openNode, scope, teamById } = useOps()
  const notes = useNotifications()
  const duty = useSetCrewDuty()
  const toast = useToast()
  const now = useNow(5000)
  const [notify, setNotify] = useState<{ open: boolean; teamIds?: string[] }>({ open: false })
  const [dispatchTeam, setDispatchTeam] = useState<Team | null>(null)

  const available = scopedTeams.filter((t) => t.status === 'available').length
  const deployed = scopedTeams.filter((t) => t.status === 'en_route' || t.status === 'on_site').length

  const messages = useMemo(() => {
    const grouped = new Map<string, { at: Date | null; teams: string[]; channel: Channel; message: string }>()
    for (const n of notes.data ?? []) {
      if (!inScope(scope, teamById.get(n.team_id)?.municipality)) continue
      const k = `${n.created_at}|${n.message}`
      const g = grouped.get(k)
      if (g) g.teams.push(n.team_id)
      else grouped.set(k, { at: parseTs(n.created_at), teams: [n.team_id], channel: n.channel, message: n.message })
    }
    return [...grouped.values()].slice(0, 30)
  }, [notes.data, scope, teamById])

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Field crews</h1>
          <p className="page__sub">
            {scopedTeams.length} crews · {available} available · {deployed} deployed
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setNotify({ open: true })}>
          <Megaphone size={15} aria-hidden />
          Message crews
        </button>
      </div>

      <div className="crews-layout">
        <section className="card card--flush" aria-label="Crew roster">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Crew</th>
                  <th scope="col">Municipality</th>
                  <th scope="col">Type</th>
                  <th scope="col">Lead</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assignment</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scopedTeams.map((t) => {
                  const d = activeDispatchByTeam.get(t.id)
                  const eta = d ? arrivalTime(d) : null
                  const left = eta ? minutesBetween(now, eta) : null
                  return (
                    <tr key={t.id} className={t.status === 'off_duty' ? 'is-off' : ''}>
                      <td className="nowrap">
                        <span className="cell-main mono">{t.id}</span>
                        <span className="cell-sub">{t.name}</span>
                      </td>
                      <td>{t.municipality}</td>
                      <td title={CREW_KIND[t.kind].role}>
                        <CrewKindLabel kind={t.kind} />
                      </td>
                      <td className="nowrap">
                        <span className="cell-main">{t.lead}</span>
                        <span className="cell-sub mono">{t.phone}</span>
                      </td>
                      <td>
                        <CrewStatusChip status={t.status} />
                      </td>
                      <td>
                        {d ? (
                          <button type="button" className="link-btn" onClick={() => openNode(d.node_id)}>
                            <span className="mono">{d.node_id}</span>
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {d?.status === 'en_route' && left != null && (
                          <span className="cell-sub">{left > 0 ? `Arrives in ${fmtDuration(left)}` : 'Due now'}</span>
                        )}
                        {d?.status === 'on_site' && <span className="cell-sub">On site</span>}
                      </td>
                      <td className="table__actions">
                        <button type="button" className="icon-btn" onClick={() => setNotify({ open: true, teamIds: [t.id] })} aria-label={`Message ${t.id}`} title="Message">
                          <MessageSquare size={16} />
                        </button>
                        {t.status === 'available' && (
                          <button type="button" className="btn btn--sm" onClick={() => setDispatchTeam(t)}>
                            Dispatch
                          </button>
                        )}
                        {(t.status === 'available' || t.status === 'off_duty') && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={duty.isPending}
                            onClick={() =>
                              duty.mutate(
                                { id: t.id, status: t.status === 'off_duty' ? 'available' : 'off_duty' },
                                { onSuccess: (r) => toast({ tone: 'accent', title: `${r.id} is ${r.status === 'off_duty' ? 'off duty' : 'on duty'}` }) },
                              )
                            }
                          >
                            {t.status === 'off_duty' ? 'Put on duty' : 'Stand off'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="msg-h">
          <h2 id="msg-h" className="section-title">
            Messages sent
          </h2>
          <p className="card__sub">Dispatch orders and broadcasts, newest first.</p>
          {messages.length ? (
            <ul className="msgs">
              {messages.map((m, i) => (
                <li key={i} className="msg">
                  <span className="msg__head">
                    <span className="msg__to">
                      {m.teams.length > 3 ? `${m.teams.length} crews` : m.teams.join(', ')}
                    </span>
                    <span className="muted">
                      {CHANNEL_LABEL[m.channel]} · {fmtClock(m.at)}
                    </span>
                  </span>
                  <span className="msg__body">{m.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <p className="empty__title">No messages yet</p>
              <p>Dispatch orders and advisories you send to crews are listed here.</p>
            </div>
          )}
        </section>
      </div>

      <NotifyDialog open={notify.open} teamIds={notify.teamIds} onClose={() => setNotify({ open: false })} />
      <AssignDialog team={dispatchTeam} onClose={() => setDispatchTeam(null)} />
    </div>
  )
}

/** Sends one crew to an open incident chosen from the queue. */
function AssignDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { incidents } = useOps()
  const create = useCreateDispatch()
  const toast = useToast()
  const now = useNow(5000)
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [channel, setChannel] = useState<Channel>('sms')
  const open = incidents.filter((i) => !i.dispatch)

  const close = () => {
    setNodeId(null)
    create.reset()
    onClose()
  }

  return (
    <Dialog
      open={!!team}
      onClose={close}
      title={`Dispatch ${team?.id ?? ''}`}
      sub={team ? `${team.name} · ${CREW_KIND[team.kind].label} · ${team.municipality}` : undefined}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!nodeId || create.isPending}
            onClick={() =>
              team &&
              nodeId &&
              create.mutate(
                { team_id: team.id, node_id: nodeId, channel },
                {
                  onSuccess: (d) => {
                    toast({ tone: 'good', title: `${d.team_id} dispatched to ${d.node_id}`, body: `${CHANNEL_LABEL[channel]} sent to the crew lead.` })
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
      {open.length ? (
        <div className="pick" role="radiogroup" aria-label="Incident">
          {open.map((i) => {
            const eta = i.overflowAt ? minutesBetween(now, i.overflowAt) : null
            return (
              <button key={i.nodeId} type="button" role="radio" aria-checked={nodeId === i.nodeId} className="pick__row" onClick={() => setNodeId(i.nodeId)}>
                <SeverityChip severity={i.severity} />
                <span className="mono">{i.nodeId}</span>
                <span className="muted">{i.municipality}</span>
                <span className="pick__eta">{eta != null ? (eta > 0 ? `${Math.ceil(eta)} min to overflow` : 'Overflowing') : ''}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="muted">Every open incident in this area already has a crew.</p>
      )}
      <div className="field">
        <span className="field__label">Notify the crew by</span>
        <Segmented<Channel>
          label="Channel"
          value={channel}
          onChange={setChannel}
          options={(['sms', 'whatsapp', 'radio'] as Channel[]).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
      </div>
      {create.error && <p className="form-error">{create.error.message}</p>}
    </Dialog>
  )
}
