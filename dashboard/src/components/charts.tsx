import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Reading } from '../api/types'
import { MODES } from '../lib/domain'
import { fmtClock, parseTs } from '../lib/time'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

// ---------------------------------------------------------------- staff gauge

/**
 * A graduated staff gauge like the ones bolted to river walls: the water
 * column rises against centimetre marks, overflow at the top.
 */
export function StaffGauge({ levelCm, emptyCm }: { levelCm: number | null; emptyCm: number }) {
  const H = 176
  const top = 16
  const bottom = 8
  const plot = H - top - bottom
  const y = (cm: number) => top + plot * (1 - cm / emptyCm)
  const ticks: number[] = []
  for (let cm = 0; cm <= emptyCm + 0.01; cm += 2.5) ticks.push(cm)
  const pct = levelCm == null ? null : levelCm / emptyCm

  return (
    <svg className="gauge" width="84" height={H} viewBox={`0 0 84 ${H}`} role="img" aria-label={levelCm == null ? 'No level reading' : `Water level ${levelCm.toFixed(1)} of ${emptyCm} centimetres`}>
      <rect x="30" y={top} width="22" height={plot} rx="3" className="gauge__track" />
      {levelCm != null && (
        <>
          <rect x="30" y={y(levelCm)} width="22" height={Math.max(0, y(0) - y(levelCm))} className="gauge__water" />
          <line x1="30" x2="52" y1={y(levelCm)} y2={y(levelCm)} className="gauge__surface" />
        </>
      )}
      {ticks.map((cm) => {
        const major = cm % 10 === 0
        const mid = cm % 5 === 0
        return (
          <g key={cm}>
            <line x1={major ? 18 : mid ? 22 : 25} x2="30" y1={y(cm)} y2={y(cm)} className="gauge__tick" />
            {major && (
              <text x="15" y={y(cm) + 3.5} className="gauge__label" textAnchor="end">
                {cm}
              </text>
            )}
          </g>
        )
      })}
      <line x1="16" x2="56" y1={y(emptyCm)} y2={y(emptyCm)} className="gauge__overflow" />
      <text x="56" y={y(emptyCm) - 5} className="gauge__overflow-label" textAnchor="end">
        OVERFLOW
      </text>
      {levelCm != null && pct != null && (
        <text x="57" y={Math.min(H - 4, Math.max(top + 18, y(levelCm) + 4))} className="gauge__value">
          {Math.round(pct * 100)}%
        </text>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- level history

interface Point {
  t: Date
  level: number
  rise: number | null
  mode: number
}

export function LevelChart({ readings, emptyCm }: { readings: Reading[]; emptyCm: number }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const points = useMemo<Point[]>(
    () =>
      [...readings]
        .sort((a, b) => a.id - b.id)
        .filter((r) => r.distance_cm != null)
        .map((r) => ({
          t: parseTs(r.timestamp)!,
          level: Math.min(emptyCm, Math.max(0, emptyCm - r.distance_cm!)),
          rise: r.dh_dt,
          mode: r.mode,
        })),
    [readings, emptyCm],
  )

  const H = 164
  const m = { l: 34, r: 14, t: 18, b: 24 }
  const w = Math.max(0, width - m.l - m.r)
  const h = H - m.t - m.b
  const n = points.length
  const x = (i: number) => m.l + (n <= 1 ? w : (w * i) / (n - 1))
  const y = (v: number) => m.t + h * (1 - v / emptyCm)
  const grid = [0, emptyCm / 3, (emptyCm * 2) / 3].map((v) => Math.round(v))

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.level).toFixed(1)}`).join('')
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : ''

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (!n) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - m.l
    setHover(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (px / w) * (n - 1)))))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!n) return
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n - 1) - 1))
    else if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1))
    else return
    e.preventDefault()
  }

  const hp = hover != null ? points[hover] : null
  const last = points[n - 1]

  return (
    <div ref={wrapRef} className="chart">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={last ? `Water level over the last ${n} readings, now ${last.level.toFixed(1)} centimetres` : 'No level readings yet'}
          tabIndex={n ? 0 : -1}
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          {grid.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={m.l + w} y1={y(v)} y2={y(v)} className="chart__grid" />
              <text x={m.l - 8} y={y(v) + 3.5} textAnchor="end" className="chart__tick">
                {v}
              </text>
            </g>
          ))}
          <line x1={m.l} x2={m.l + w} y1={y(emptyCm)} y2={y(emptyCm)} className="chart__limit" />
          <text x={m.l + w} y={y(emptyCm) - 6} textAnchor="end" className="chart__limit-label">
            Overflow · {emptyCm} cm
          </text>
          <text x={m.l - 8} y={y(emptyCm) + 3.5} textAnchor="end" className="chart__tick">
            {emptyCm}
          </text>

          {n > 0 && (
            <>
              <path d={area} className="chart__area" />
              <path d={line} className="chart__line" />
              <circle cx={x(n - 1)} cy={y(last.level)} r="4" className="chart__end" />
              <text x={m.l} y={H - 6} className="chart__tick">
                {fmtClock(points[0].t, true)}
              </text>
              <text x={m.l + w} y={H - 6} textAnchor="end" className="chart__tick">
                {fmtClock(last.t, true)}
              </text>
            </>
          )}

          {hp && hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + h} className="chart__cross" />
              <circle cx={x(hover)} cy={y(hp.level)} r="4.5" className="chart__end" />
            </g>
          )}
        </svg>
      )}
      {hp && hover != null && (
        <div className="chart__tip" style={{ left: Math.min(Math.max(x(hover), 70), width - 70), top: 0 }}>
          <strong>{hp.level.toFixed(1)} cm</strong>
          <span>{fmtClock(hp.t, true)} · {MODES[hp.mode as 1 | 2 | 3]?.label ?? '—'} mode</span>
          {hp.rise != null && <span>Rising {hp.rise.toFixed(2)} cm/min</span>}
        </div>
      )}
      {n === 0 && <p className="chart__empty">No water-level readings yet.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- sparkline

export function Sparkline({ values, max, width = 96, height = 26 }: { values: number[]; max: number; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted">—</span>
  const x = (i: number) => 1 + ((width - 6) * i) / (values.length - 1)
  const y = (v: number) => 2 + (height - 4) * (1 - Math.min(1, Math.max(0, v / max)))
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const lastV = values[values.length - 1]
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <line x1="1" x2={width - 5} y1={y(max)} y2={y(max)} className="spark__limit" />
      <path d={d} className="spark__line" />
      <circle cx={x(values.length - 1)} cy={y(lastV)} r="2.5" className="spark__end" />
    </svg>
  )
}
