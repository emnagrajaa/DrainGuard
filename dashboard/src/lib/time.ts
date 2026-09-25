import { useEffect, useState } from 'react'

/** Parses API timestamps. SQLite returns them without a zone; they are UTC. */
export function parseTs(s: string | null | undefined): Date | null {
  if (!s) return null
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s)
  const d = new Date(hasZone ? s : `${s}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60000

export function fmtClock(d: Date | null, withSeconds = false): string {
  if (!d) return '—'
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  })
}

export function fmtAgo(d: Date | null, now: Date): string {
  if (!d) return 'never'
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 90) return '1 min ago'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "8 min", "1 h 12 min" */
export function fmtDuration(min: number): string {
  if (min < 1) return '<1 min'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min - h * 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Re-renders the caller every `intervalMs` — for countdowns and "x min ago". */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
