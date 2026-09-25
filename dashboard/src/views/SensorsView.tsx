import { BatteryLow } from 'lucide-react'
import { Sparkline } from '../components/charts'
import { SeverityChip } from '../components/ui'
import { CLASSIFIER_LABEL, MODES, isReporting, projectedOverflowAt, waterLevel } from '../lib/domain'
import { useOps } from '../lib/ops'
import { fmtAgo, fmtClock, fmtDuration, minutesBetween, parseTs, useNow } from '../lib/time'

export function SensorsView() {
  const { scopedFleet, incidentByNode, emptyCm, openNode, trashThreshold } = useOps()
  const now = useNow(1000)
  const reporting = scopedFleet.filter((n) => isReporting(n, now)).length
  const lowBattery = scopedFleet.filter((n) => (n.battery_v ?? 4) < 3.3).length

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Sensor network</h1>
          <p className="page__sub">
            {scopedFleet.length} drain nodes · {reporting} reporting
            {lowBattery ? ` · ${lowBattery} low battery` : ''} · select a row to open it on the map
          </p>
        </div>
      </div>

      <section className="card card--flush">
        {scopedFleet.length ? (
          <div className="table-wrap">
            <table className="table table--rows">
              <thead>
                <tr>
                  <th scope="col">Sensor</th>
                  <th scope="col">Condition</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Water level</th>
                  <th scope="col" className="num">Rise rate</th>
                  <th scope="col">Overflow projection</th>
                  <th scope="col">Debris classifier</th>
                  <th scope="col" className="num">Battery</th>
                  <th scope="col">Last report</th>
                  <th scope="col">Recent level</th>
                </tr>
              </thead>
              <tbody>
                {scopedFleet.map((n) => {
                  const inc = incidentByNode.get(n.id)
                  const level = waterLevel(n.latest?.distance_cm, emptyCm)
                  const cls = n.classifier
                  const flagged = (cls?.p_trash ?? 0) > trashThreshold
                  const low = (n.battery_v ?? 4) < 3.3
                  const levels = n.recent.filter((r) => r.distance_cm != null).map((r) => Math.max(0, emptyCm - r.distance_cm!))
                  const overflowAt = projectedOverflowAt(n)
                  const left = overflowAt ? minutesBetween(now, overflowAt) : null
                  return (
                    <tr key={n.id} tabIndex={0} onClick={() => openNode(n.id)} onKeyDown={(e) => e.key === 'Enter' && openNode(n.id)}>
                      <td>
                        <span className="cell-main mono">{n.id}</span>
                        <span className="cell-sub">{n.municipality}</span>
                      </td>
                      <td>{inc ? <SeverityChip severity={inc.severity} /> : <span className={isReporting(n, now) ? '' : 'muted'}>{isReporting(n, now) ? 'Normal' : 'Not reporting'}</span>}</td>
                      <td>{n.current_mode ? MODES[n.current_mode].label : '—'}</td>
                      <td>
                        {level ? (
                          <span className="meter" title={`${level.levelCm.toFixed(1)} of ${emptyCm} cm`}>
                            <span className="meter__track">
                              <span className={`meter__fill ${level.pct > 0.75 ? 'is-high' : ''}`} style={{ width: `${Math.round(level.pct * 100)}%` }} />
                            </span>
                            <span className="tabular">{Math.round(level.pct * 100)}%</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num tabular">{n.latest?.dh_dt != null ? `${n.latest.dh_dt.toFixed(2)} cm/min` : '—'}</td>
                      <td>
                        {left == null ? (
                          <span className="muted">Not rising</span>
                        ) : left > 0 ? (
                          <>
                            <span className="cell-main">In {fmtDuration(left)}</span>
                            <span className="cell-sub">around {fmtClock(overflowAt)}</span>
                          </>
                        ) : (
                          <span className="cell-main is-crit">Overflow reached</span>
                        )}
                      </td>
                      <td>
                        {cls ? (
                          <>
                            <span className={`cell-main ${flagged ? 'is-flag' : ''}`}>{CLASSIFIER_LABEL[cls.class] ?? cls.class}</span>
                            <span className="cell-sub tabular">p(trash) {cls.p_trash?.toFixed(2)}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`num tabular ${low ? 'is-warn' : ''}`}>
                        {low && <BatteryLow size={14} aria-label="Low battery" />} {n.battery_v?.toFixed(2)} V
                      </td>
                      <td className="nowrap">{fmtAgo(parseTs(n.last_seen), now)}</td>
                      <td>
                        <Sparkline values={levels} max={emptyCm} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <p className="empty__title">No sensors in this area yet</p>
            <p>Nodes register themselves with their first reading. Run a simulation from the header, or point a LoRaWAN gateway at POST /api/v1/ingest.</p>
          </div>
        )}
      </section>
    </div>
  )
}
