import { useState, type ReactNode } from 'react'
import { CloudLightning, Moon, Play, RotateCcw, Sun, Sunrise } from 'lucide-react'
import { useResetDemo, useRunSimulation } from '../api/queries'
import { VIEWS, useOps } from '../lib/ops'
import { setTheme, useTheme } from '../lib/theme'
import { fmtClock, useNow } from '../lib/time'
import { Dialog, Emblem, Segmented } from './ui'
import { useToast } from './Toasts'

export function Header() {
  const { view, incidents, online, simulator } = useOps()
  const now = useNow(1000)
  const theme = useTheme()
  const [simOpen, setSimOpen] = useState(false)

  return (
    <header className="hdr">
      <a className="hdr__brand" href="#/operations" aria-label="DrainGuard — operations">
        <Emblem />
        <span className="hdr__word">DrainGuard</span>
        <span className="hdr__dept">Stormwater operations</span>
      </a>

      <nav className="hdr__nav" aria-label="Views">
        {VIEWS.map((v) => (
          <a key={v.id} href={`#/${v.id}`} className="hdr__tab" aria-current={view === v.id ? 'page' : undefined}>
            {v.label}
            {v.id === 'operations' && incidents.length > 0 && (
              <span className="hdr__count" aria-label={`${incidents.length} open incidents`}>
                {incidents.length}
              </span>
            )}
          </a>
        ))}
      </nav>

      <div className="hdr__tools">
        <span className={`hdr__live ${online ? '' : 'is-off'}`} title={online ? 'Receiving data from the cloud API' : 'Cloud API unreachable'}>
          <span className="hdr__live-dot" aria-hidden />
          {online ? 'Live' : 'Offline'}
          <span className="hdr__clock mono">{fmtClock(now, true)}</span>
        </span>
        <button type="button" className={`hdr__sim ${simulator?.running ? 'is-running' : ''}`} onClick={() => setSimOpen(true)}>
          {simulator?.running ? (
            <>
              <span className="hdr__sim-pulse" aria-hidden />
              <span className="hdr__sim-label">{simulator.scenario === 'storm' ? 'Storm running' : 'Patrol running'}</span>
            </>
          ) : (
            <>
              <Play size={14} aria-hidden />
              <span className="hdr__sim-label">Simulate</span>
            </>
          )}
        </button>
        <button
          type="button"
          className="hdr__icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Switch to day theme' : 'Switch to night theme'}
          title={theme === 'dark' ? 'Day theme' : 'Night theme'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>

      <SimulationDialog open={simOpen} onClose={() => setSimOpen(false)} />
    </header>
  )
}

type Pace = 'presentation' | 'fast'
type Length = 'standard' | 'extended'

function SimulationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { simulator } = useOps()
  const run = useRunSimulation()
  const reset = useResetDemo()
  const toast = useToast()
  const [scenario, setScenario] = useState<'storm' | 'dry'>('storm')
  const [pace, setPace] = useState<Pace>('presentation')
  const [length, setLength] = useState<Length>('standard')
  const [confirmReset, setConfirmReset] = useState(false)

  const close = () => {
    setConfirmReset(false)
    run.reset()
    reset.reset()
    onClose()
  }

  const start = () =>
    run.mutate(
      {
        scenario,
        tick_seconds: pace === 'presentation' ? 2.5 : 1,
        ticks: scenario === 'dry' ? 3 : length === 'standard' ? 8 : 18,
      },
      {
        onSuccess: () => {
          toast({
            tone: 'accent',
            title: scenario === 'storm' ? 'Storm simulation started' : 'Dry-day patrol started',
            body: 'Simulated drain nodes are posting readings to the cloud API.',
          })
          close()
        },
      },
    )

  const doReset = () =>
    reset.mutate(undefined, {
      onSuccess: () => {
        toast({ tone: 'good', title: 'Demo data deleted', body: 'Every crew is back at base.' })
        close()
      },
    })

  const running = !!simulator?.running
  const error = run.error?.message ?? reset.error?.message

  if (confirmReset) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title="Delete demo data?"
        sub="Readings, alerts, dispatches and crew messages are deleted, and every crew returns to base. Sensors register again on their next reading."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
              Keep data
            </button>
            <button type="button" className="btn btn--primary" onClick={doReset} disabled={reset.isPending || running}>
              <RotateCcw size={14} aria-hidden />
              Delete demo data
            </button>
          </>
        }
      >
        {running && <p className="form-error">Wait for the running simulation to finish first.</p>}
        {error && <p className="form-error">{error}</p>}
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Run a simulation"
      sub="Drives the edge simulator's ten drain nodes (Tunis, Ariana, Sousse, Sfax, Nabeul) through the same ingest path real LoRaWAN uplinks use."
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmReset(true)}>
            <RotateCcw size={14} aria-hidden />
            Reset demo data
          </button>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={start} disabled={run.isPending || running}>
            <Play size={14} aria-hidden />
            Start simulation
          </button>
        </>
      }
    >
      <div className="scenario-grid" role="radiogroup" aria-label="Scenario">
        <ScenarioCard
          checked={scenario === 'storm'}
          onSelect={() => setScenario('storm')}
          icon={<CloudLightning size={18} aria-hidden />}
          title="Storm event"
          body="Dry baseline, then pre-storm (rain forecast above 60 %), then an active storm. Water rises and the flood predictor raises overflow warnings."
        />
        <ScenarioCard
          checked={scenario === 'dry'}
          onSelect={() => setScenario('dry')}
          icon={<Sunrise size={18} aria-hidden />}
          title="Dry-day patrol"
          body="Routine dry-weather sampling. The edge classifier flags blocked inlets and the engine opens cleaning tickets."
        />
      </div>

      <div className="field">
        <span className="field__label">Pace</span>
        <Segmented<Pace>
          label="Pace"
          value={pace}
          onChange={setPace}
          options={[
            { value: 'presentation', label: 'Presentation · 2.5 s per reading' },
            { value: 'fast', label: 'Fast · 1 s' },
          ]}
        />
      </div>

      {scenario === 'storm' && (
        <div className="field">
          <span className="field__label">Storm length</span>
          <Segmented<Length>
            label="Storm length"
            value={length}
            onChange={setLength}
            options={[
              { value: 'standard', label: 'Standard · 8 readings' },
              { value: 'extended', label: 'Extended · 18 readings' },
            ]}
          />
        </div>
      )}

      {running && <p className="muted">A simulation is already running. Wait for it to finish before starting another.</p>}
      {simulator?.error && <p className="form-error">Last run failed: {simulator.error}</p>}
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  )
}

function ScenarioCard({
  checked,
  onSelect,
  icon,
  title,
  body,
}: {
  checked: boolean
  onSelect: () => void
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="scenario" onClick={onSelect}>
      <span className="scenario__icon">{icon}</span>
      <span className="scenario__title">{title}</span>
      <span className="scenario__body">{body}</span>
    </button>
  )
}
