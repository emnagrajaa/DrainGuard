import { Cloud, CloudLightning, Sun } from 'lucide-react'
import type { Mode } from '../api/types'
import { MODES, SCOPES, isReporting, type ScopeId } from '../lib/domain'
import { useOps } from '../lib/ops'
import { fmtClock, useNow } from '../lib/time'
import { Segmented } from './ui'

const MODE_ICON = { 1: Sun, 2: Cloud, 3: CloudLightning }

export function ContextBar() {
  const { scope, setScope, scopedFleet, updatedAt, online } = useOps()
  const now = useNow(5000)

  const reporting = scopedFleet.filter((n) => isReporting(n, now))
  const mode = (reporting.reduce<number>((m, n) => Math.max(m, n.current_mode ?? 1), 0) || null) as Mode | null
  const Icon = mode ? MODE_ICON[mode] : Sun

  return (
    <div className="ctx">
      <div className="ctx__scope">
        <span className="eyebrow ctx__label">Area</span>
        <Segmented<ScopeId>
          label="Area"
          value={scope}
          onChange={setScope}
          options={SCOPES.map((s) => ({ value: s.id, label: s.label }))}
        />
      </div>
      <div className="ctx__status">
        {mode && (
          <span className={`ctx__mode ctx__mode--${mode}`}>
            <Icon size={15} aria-hidden />
            <span>
              <strong>{MODES[mode].label} mode</strong>
              <span className="muted"> · sensors sampling {MODES[mode].sampling}</span>
            </span>
          </span>
        )}
        <span className="ctx__updated muted">
          {online ? `Updated ${fmtClock(updatedAt, true)}` : 'Waiting for the cloud API'}
        </span>
      </div>
    </div>
  )
}
