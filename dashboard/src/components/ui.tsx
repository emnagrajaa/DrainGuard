import { useEffect, useRef, type ReactNode } from 'react'
import { CircleAlert, Droplets, Fan, TrafficCone, TriangleAlert, Waves, X, type LucideIcon } from 'lucide-react'
import type { CrewKind, CrewStatus } from '../api/types'
import { CREW_KIND, CREW_STATUS, SEVERITY, type Severity, type Tone } from '../lib/domain'

export const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  critical: Waves,
  high: TriangleAlert,
  normal: CircleAlert,
}

export const CREW_ICON: Record<CrewKind, LucideIcon> = {
  cleaning: Droplets,
  pump: Fan,
  traffic: TrafficCone,
}

export function Chip({ tone, icon: Icon, children }: { tone: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`chip chip--${tone}`}>
      {Icon ? <Icon size={13} strokeWidth={2.4} aria-hidden /> : <span className={`dot dot--${tone}`} aria-hidden />}
      {children}
    </span>
  )
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity]
  return (
    <Chip tone={s.tone} icon={SEVERITY_ICON[severity]}>
      {s.label}
    </Chip>
  )
}

export function CrewStatusChip({ status }: { status: CrewStatus }) {
  const s = CREW_STATUS[status]
  return <Chip tone={s.tone}>{s.label}</Chip>
}

export function CrewKindLabel({ kind }: { kind: CrewKind }) {
  const Icon = CREW_ICON[kind]
  return (
    <span className="crew-kind">
      <Icon size={14} strokeWidth={2} aria-hidden />
      {CREW_KIND[kind].label}
    </span>
  )
}

export function Emblem({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="emblem">
      <rect width="32" height="32" rx="7" fill="var(--header-2)" />
      <circle cx="16" cy="16" r="10" fill="none" stroke="var(--header-accent)" strokeWidth="2" />
      <path
        d="M11 12.4h10M9.2 16h13.6M11 19.6h10"
        stroke="var(--header-ink)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Native <dialog>: focus trapping, Escape and inert background come for free. */
export function Dialog({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  sub?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dlg"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <>
          <div className="dlg__head">
            <div>
              <h2 className="dlg__title">{title}</h2>
              {sub && <p className="dlg__sub">{sub}</p>}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="dlg__body">{children}</div>
          {footer && <div className="dlg__foot">{footer}</div>}
        </>
      )}
    </dialog>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg__btn"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
