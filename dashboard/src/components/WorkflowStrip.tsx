import { isReporting } from '../lib/domain'
import { useOps } from '../lib/ops'
import { fmtDuration, minutesBetween, useNow } from '../lib/time'

/**
 * The four stages of the Observe & Act loop, each backed by live numbers from
 * the part of the system that performs it.
 */
export function WorkflowStrip() {
  const { scopedFleet, incidents, scopedTeams, trashThreshold, system, openNode } = useOps()
  const now = useNow(1000)
  const minRise = system?.thresholds.min_rise_rate_cm_min ?? 0.05

  const reporting = scopedFleet.filter((n) => isReporting(n, now))
  const storm = reporting.filter((n) => n.current_mode === 3).length
  const preStorm = reporting.filter((n) => n.current_mode === 2).length
  const rising = scopedFleet.filter((n) => n.latest?.mode === 3 && (n.latest.dh_dt ?? 0) >= minRise).length
  const blockages = scopedFleet.filter((n) => (n.classifier?.p_trash ?? 0) > trashThreshold).length
  const critical = incidents.filter((i) => i.severity === 'critical')
  const next = critical.find((i) => i.overflowAt)
  const nextEta = next?.overflowAt ? minutesBetween(now, next.overflowAt) : null
  const deployed = scopedTeams.filter((t) => t.status === 'en_route' || t.status === 'on_site').length
  const available = scopedTeams.filter((t) => t.status === 'available').length
  const offDuty = scopedTeams.filter((t) => t.status === 'off_duty').length
  const unassigned = incidents.filter((i) => !i.dispatch).length

  return (
    <ol className="wf" aria-label="Detect, understand, alert, act">
      <li className="wf__stage">
        <span className="wf__head">
          <span className="wf__step">Detect</span>
          <span className="wf__by">Drain sensors</span>
        </span>
        <span className="wf__value">
          <span className="wf__num">{reporting.length}</span>
          <span className="wf__of">/ {scopedFleet.length}</span>
        </span>
        <span className="wf__label">sensors reporting</span>
        <span className="wf__sub">
          {storm ? `${storm} in storm mode` : preStorm ? `${preStorm} in pre-storm mode` : reporting.length ? 'All in dry mode' : 'Waiting for first readings'}
        </span>
      </li>

      <li className="wf__stage">
        <span className="wf__head">
          <span className="wf__step">Understand</span>
          <span className="wf__by">Edge + cloud models</span>
        </span>
        <span className="wf__value">
          <span className="wf__num">{rising}</span>
        </span>
        <span className="wf__label">basins rising</span>
        <span className="wf__sub">
          {blockages} blockage{blockages === 1 ? '' : 's'} flagged by the edge classifier
        </span>
      </li>

      <li className={`wf__stage ${critical.length ? 'wf__stage--critical' : ''}`}>
        <span className="wf__head">
          <span className="wf__step">Alert</span>
          <span className="wf__by">Decision engine</span>
        </span>
        <span className="wf__value">
          <span className="wf__num">{incidents.length}</span>
        </span>
        <span className="wf__label">open incidents{critical.length ? `, ${critical.length} flood risk` : ''}</span>
        <span className="wf__sub">
          {next && nextEta != null ? (
            <button type="button" className="wf__link" onClick={() => openNode(next.nodeId)}>
              {nextEta <= 0 ? 'Overflow reached' : `Next overflow in ${fmtDuration(nextEta)}`} · <span className="mono">{next.nodeId}</span>
            </button>
          ) : (
            'No overflow projected'
          )}
        </span>
      </li>

      <li className={`wf__stage ${unassigned ? 'wf__stage--pending' : ''}`}>
        <span className="wf__head">
          <span className="wf__step">Act</span>
          <span className="wf__by">Field crews</span>
        </span>
        <span className="wf__value">
          <span className="wf__num">{deployed}</span>
        </span>
        <span className="wf__label">crews deployed</span>
        <span className="wf__sub">
          {unassigned ? `${unassigned} without a crew · ` : ''}
          {available} available{!unassigned && offDuty ? ` · ${offDuty} off duty` : ''}
        </span>
      </li>
    </ol>
  )
}
