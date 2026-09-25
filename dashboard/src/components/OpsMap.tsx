import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet'
import { ChevronDown, Maximize2 } from 'lucide-react'
import type { CrewKind, CrewStatus, FleetNode, Team } from '../api/types'
import {
  CREW_KIND,
  CREW_STATUS,
  SEVERITY,
  arrivalTime,
  crewPosition,
  isReporting,
  type Incident,
  type ScopeId,
} from '../lib/domain'
import { useReducedMotion } from '../lib/motion'
import { useOps } from '../lib/ops'
import { useTheme } from '../lib/theme'
import { fmtClock, minutesBetween, useNow } from '../lib/time'

// Esri's grey canvas basemaps: quiet enough that incident colours carry the map.
// Labels come as a separate layer so they can sit above the impact zones.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'
const TILES = {
  light: { base: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
  dark: { base: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}` },
}
const ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Used until sensors have reported — the five pilot municipalities on the east coast.
const FALLBACK_BOUNDS: Record<ScopeId, L.LatLngBoundsLiteral> = {
  all: [[34.7, 10.1], [36.9, 10.8]],
  'grand-tunis': [[36.785, 10.15], [36.875, 10.225]],
  sousse: [[35.815, 10.595], [35.836, 10.62]],
  sfax: [[34.734, 10.745], [34.752, 10.77]],
  nabeul: [[36.448, 10.725], [36.464, 10.747]],
}

const FAR_ZOOM = 12

// ---------------------------------------------------------------- icons

type PinTone = 'ok' | 'offline' | 'critical' | 'serious' | 'warning'
const pinCache = new Map<string, L.DivIcon>()

function pinIcon(tone: PinTone, selected: boolean): L.DivIcon {
  const key = `${tone}:${selected}`
  let icon = pinCache.get(key)
  if (!icon) {
    icon = L.divIcon({
      className: 'pin-host',
      html: `<span class="pin pin--${tone}${selected ? ' is-selected' : ''}"><span class="pin__halo"></span><span class="pin__dot"></span></span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      tooltipAnchor: [0, -12],
    })
    pinCache.set(key, icon)
  }
  return icon
}

const CREW_SVG: Record<CrewKind, string> = {
  cleaning:
    '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  pump: '<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12v.01"/>',
  traffic:
    '<path d="M16.05 10.966a5 2.5 0 0 1-8.1 0"/><path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04"/><path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z"/><path d="M9.194 6.57a5 2.5 0 0 0 5.61 0"/>',
}
const crewCache = new Map<string, L.DivIcon>()

function crewIcon(kind: CrewKind, status: CrewStatus): L.DivIcon {
  const key = `${kind}:${status}`
  let icon = crewCache.get(key)
  if (!icon) {
    icon = L.divIcon({
      className: 'pin-host',
      html: `<span class="crew-pin crew-pin--${status}"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CREW_SVG[kind]}</svg></span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      tooltipAnchor: [0, -10],
    })
    crewCache.set(key, icon)
  }
  return icon
}

// ---------------------------------------------------------------- contour bloom

/**
 * Projected impact zone around a drain with an open incident. It grows from
 * the drain when the incident opens, keeps widening as projected overflow
 * approaches, and sends slow ripples outward like water leaving a basin.
 * Radii are in metres, so the zone keeps its true size on the ground.
 */
function ContourBloom({ lat, lon, radius, tone }: { lat: number; lon: number; radius: number; tone: string }) {
  const map = useMap()
  const reduced = useReducedMotion()
  const target = useRef(radius)
  target.current = radius

  useEffect(() => {
    const opts = { interactive: false, radius: 0 }
    const zone = L.circle([lat, lon], { ...opts, className: `bloom bloom-zone bloom--${tone}`, weight: 1.5, fillOpacity: 0.09, opacity: 0.85 })
    const contours = [0.36, 0.68].map((f) =>
      L.circle([lat, lon], { ...opts, className: `bloom bloom-contour bloom--${tone}`, weight: 1, fill: false, opacity: 0.45 - f * 0.15 }),
    )
    const ripples = reduced
      ? []
      : [0, 1].map(() => L.circle([lat, lon], { ...opts, className: `bloom bloom-ripple bloom--${tone}`, weight: 1.5, fill: false, opacity: 0 }))
    const group = L.layerGroup([zone, ...contours, ...ripples]).addTo(map)

    const draw = (r: number, t: number) => {
      zone.setRadius(r)
      contours[0].setRadius(r * 0.36)
      contours[1].setRadius(r * 0.68)
      ripples.forEach((c, i) => {
        const p = ((t / 4200 + i / 2) % 1 + 1) % 1
        c.setRadius(Math.max(1, r * p))
        c.setStyle({ opacity: 0.6 * (1 - p) * Math.min(1, p * 6) })
      })
    }

    if (reduced) {
      draw(target.current, 0)
      const id = window.setInterval(() => draw(target.current, 0), 1000)
      return () => {
        window.clearInterval(id)
        group.remove()
      }
    }

    let current = 0
    let last = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const dt = Math.min(100, t - last)
      last = t
      // Exponential approach: the zone takes ~4 s to reach its first size, then eases between sizes.
      current += (target.current - current) * (1 - Math.exp(-dt / 1300))
      if (map.getZoom() >= FAR_ZOOM - 2) draw(current, t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      group.remove()
    }
  }, [map, lat, lon, tone, reduced])

  return null
}

function bloomRadius(inc: Incident, now: Date, leadTimeMin: number): number {
  if (inc.severity !== 'critical') return inc.severity === 'high' ? 200 : 130
  if (!inc.overflowAt) return 320
  const eta = minutesBetween(now, inc.overflowAt)
  const urgency = 1 - Math.min(1, Math.max(0, eta / leadTimeMin))
  return 200 + 420 * urgency
}

// ---------------------------------------------------------------- map

export function OpsMap() {
  const ops = useOps()
  const { scope, scopedFleet, scopedTeams, incidentByNode, nodeById, activeDispatchByTeam, selectedNodeId, openNode, leadTimeMin } = ops
  const theme = useTheme()
  const reduced = useReducedMotion()
  const now = useNow(1000)
  const [map, setMap] = useState<L.Map | null>(null)
  const [far, setFar] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)

  const scopeBounds = useMemo(() => {
    const pts: L.LatLngTuple[] = [
      ...scopedFleet.filter((n) => n.latitude != null && n.longitude != null).map((n) => [n.latitude!, n.longitude!] as L.LatLngTuple),
      ...scopedTeams.map((t) => [t.base_latitude, t.base_longitude] as L.LatLngTuple),
    ]
    return pts.length > 1 ? L.latLngBounds(pts).pad(0.12) : L.latLngBounds(FALLBACK_BOUNDS[scope])
  }, [scopedFleet, scopedTeams, scope])

  // Until the operator pans or zooms, keep the whole area framed (also across layout changes).
  const userMoved = useRef(false)
  const boundsRef = useRef(scopeBounds)
  boundsRef.current = scopeBounds

  // Re-frame when the area changes or the first sensors appear — not on every poll.
  const hasNodes = scopedFleet.length > 0
  useEffect(() => {
    if (!map) return
    userMoved.current = false
    map.invalidateSize({ pan: false })
    map.flyToBounds(scopeBounds, { animate: !reduced, duration: 0.9, maxZoom: 15 })
  }, [map, scope, hasNodes])

  // Fly to the selected drain.
  useEffect(() => {
    if (!map || !selectedNodeId) return
    userMoved.current = true
    const node = nodeById.get(selectedNodeId)
    if (node?.latitude == null || node.longitude == null) return
    map.flyTo([node.latitude, node.longitude], Math.max(map.getZoom(), 15), { animate: !reduced, duration: 1.1 })
  }, [map, selectedNodeId])

  useEffect(() => {
    if (!map) return
    const onZoom = () => setFar(map.getZoom() < FAR_ZOOM)
    onZoom()
    map.on('zoomend', onZoom)
    return () => {
      map.off('zoomend', onZoom)
    }
  }, [map])

  useEffect(() => {
    if (!map || !wrapRef.current) return
    const el = map.getContainer()
    const touched = () => (userMoved.current = true)
    const events = ['pointerdown', 'wheel', 'keydown'] as const
    events.forEach((e) => el.addEventListener(e, touched, { passive: true }))
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false })
      if (!userMoved.current) map.fitBounds(boundsRef.current, { animate: false, maxZoom: 15 })
    })
    ro.observe(wrapRef.current)
    return () => {
      ro.disconnect()
      events.forEach((e) => el.removeEventListener(e, touched))
    }
  }, [map])

  const placed = scopedFleet.filter((n): n is FleetNode & { latitude: number; longitude: number } => n.latitude != null && n.longitude != null)

  return (
    <div ref={wrapRef} className={`map-wrap ${far ? 'map--far' : ''}`}>
      <MapContainer
        ref={setMap}
        bounds={FALLBACK_BOUNDS.all}
        zoomControl={false}
        className="map"
        zoomSnap={0.5}
        maxZoom={19}
      >
        <TileLayer key={`base-${theme}`} url={TILES[theme].base} attribution={ATTRIBUTION} maxNativeZoom={16} maxZoom={19} />
        <Pane name="labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
          <TileLayer key={`labels-${theme}`} url={TILES[theme].labels} maxNativeZoom={16} maxZoom={19} />
        </Pane>
        <ZoomControl position="topright" />

        {placed.map((n) => {
          const inc = incidentByNode.get(n.id)
          return inc ? (
            <ContourBloom
              key={`bloom-${n.id}`}
              lat={n.latitude}
              lon={n.longitude}
              tone={SEVERITY[inc.severity].tone}
              radius={bloomRadius(inc, now, leadTimeMin)}
            />
          ) : null
        })}

        {scopedTeams.map((t) => (
          <CrewRoute key={`route-${t.id}`} team={t} />
        ))}

        {placed.map((n) => {
          const inc = incidentByNode.get(n.id)
          const tone: PinTone = inc ? (SEVERITY[inc.severity].tone as PinTone) : isReporting(n, now) ? 'ok' : 'offline'
          return (
            <Marker
              key={n.id}
              position={[n.latitude, n.longitude]}
              icon={pinIcon(tone, n.id === selectedNodeId)}
              title={n.id}
              alt={n.id}
              zIndexOffset={inc ? 1000 - SEVERITY[inc.severity].rank * 100 : 0}
              eventHandlers={{ click: () => openNode(n.id) }}
            >
              <Tooltip direction="top" className="map-tip" opacity={1}>
                <span className="map-tip__id mono">{n.id}</span>
                <span className="map-tip__sub">
                  {n.municipality} · {inc ? SEVERITY[inc.severity].label : isReporting(n, now) ? 'Normal' : 'Not reporting'}
                </span>
              </Tooltip>
            </Marker>
          )
        })}

        {scopedTeams.map((t) => {
          const d = activeDispatchByTeam.get(t.id)
          // Zoomed out, idle crews at their depots are noise; only moving crews matter.
          if (far && !d) return null
          const pos = crewPosition(t, d, d ? nodeById.get(d.node_id) : undefined, now)
          const eta = d ? arrivalTime(d) : null
          return (
            <Marker
              key={`crew-${t.id}`}
              position={[pos.lat, pos.lon]}
              icon={crewIcon(t.kind, t.status)}
              title={t.id}
              alt={`Crew ${t.id}`}
              zIndexOffset={d ? 1500 : -100}
              eventHandlers={{ click: () => d && openNode(d.node_id) }}
            >
              <Tooltip direction="top" className="map-tip" opacity={1}>
                <span className="map-tip__id mono">{t.id}</span>
                <span className="map-tip__sub">
                  {CREW_KIND[t.kind].label} · {CREW_STATUS[t.status].label}
                  {d && ` to ${d.node_id}`}
                  {d?.status === 'en_route' && eta && ` · arrives ${fmtClock(eta)}`}
                </span>
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>

      <button
        type="button"
        className="map-fit"
        onClick={() => {
          userMoved.current = false
          map?.flyToBounds(scopeBounds, { animate: !reduced, duration: 0.8, maxZoom: 15 })
        }}
      >
        <Maximize2 size={14} aria-hidden />
        Whole area
      </button>
      <MapLegend />
    </div>
  )
}

function CrewRoute({ team }: { team: Team }) {
  const { activeDispatchByTeam, nodeById } = useOps()
  const now = useNow(1000)
  const d = activeDispatchByTeam.get(team.id)
  const node = d ? nodeById.get(d.node_id) : undefined
  if (!d || d.status !== 'en_route' || node?.latitude == null || node.longitude == null) return null
  const pos = crewPosition(team, d, node, now)
  const base: L.LatLngTuple = [team.base_latitude, team.base_longitude]
  const here: L.LatLngTuple = [pos.lat, pos.lon]
  const dest: L.LatLngTuple = [node.latitude, node.longitude]
  return (
    <>
      <Polyline positions={[base, here]} pathOptions={{ className: 'route route--done', weight: 2.5, interactive: false }} />
      <Polyline positions={[here, dest]} pathOptions={{ className: 'route route--ahead', weight: 2, dashArray: '2 6', interactive: false }} />
    </>
  )
}

function MapLegend() {
  const [open, setOpen] = useState(() => window.innerWidth > 720)
  return (
    <div className={`legend ${open ? 'is-open' : ''}`}>
      <button type="button" className="legend__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Map key
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="legend__body">
          <ul className="legend__list">
            <li>
              <span className="legend-pin pin--critical" />
              Flood risk
            </li>
            <li>
              <span className="legend-pin pin--serious" />
              Urgent blockage
            </li>
            <li>
              <span className="legend-pin pin--warning" />
              Blockage
            </li>
            <li>
              <span className="legend-pin pin--ok" />
              Drain sensor, normal
            </li>
            <li>
              <span className="legend-crew" />
              Field crew
            </li>
          </ul>
          <p className="legend__note">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
              <circle cx="13" cy="13" r="11.5" className="legend-ring" />
              <circle cx="13" cy="13" r="7.5" className="legend-ring legend-ring--inner" />
              <circle cx="13" cy="13" r="3.5" className="legend-ring legend-ring--inner" />
            </svg>
            Rings mark the projected impact zone. They widen as overflow gets closer.
          </p>
        </div>
      )}
    </div>
  )
}
