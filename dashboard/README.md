# DrainGuard — Municipal Dashboard

The stormwater operations console for municipal technical services: see
which drains are about to fail, understand why, and get the right crew
there before the water does. React + TypeScript + Vite, Leaflet map,
TanStack Query polling the cloud API every 2 s.

## Run it

```bash
# terminal 1 — repository root: the cloud API
pip install -r requirements.txt
uvicorn cloud.api.main:app --port 8000

# terminal 2 — this folder: the dashboard
npm install
npm run dev            # http://127.0.0.1:5173
```

Vite proxies `/api` to the API, so there is no CORS setup. To point at an
API somewhere else, set `VITE_API_TARGET` (see `.env.example`). For a
static build served without the proxy, set `VITE_API_URL` and run
`npm run build`.

## Demo in one minute

1. Header → **Simulate** → *Storm event* → **Start simulation**. The edge
   simulator's ten nodes post readings through the real `/ingest` path:
   dry baseline → pre-storm → storm.
2. Incidents stream into the queue, sorted by time to overflow. Rings
   grow on the map around each drain — the projected impact zone widens
   as overflow approaches.
3. Open an incident: the staff gauge and water-level history, the edge
   classifier's reading (Layer 1), the flood predictor's projection
   (Layer 2), and crews ranked by fit and drive time, each marked with
   whether it arrives before the projected overflow.
4. **Dispatch** → pick SMS / WhatsApp / radio → the crew is notified and
   drives toward the drain on the map. Mark it on site, then resolved.
5. **Simulate → Reset demo data** between rehearsals.

## Views

| View | What it is for |
|---|---|
| Operations | The Detect → Understand → Alert → Act strip, the live map and the incident queue / crew list / activity log. Opening a drain shows its full picture and the dispatch controls. |
| Crews | The roster with status and assignments; message one crew, a municipality or everyone (pre-storm standby, all-clear…); dispatch an idle crew to an open incident. |
| Sensors | Every drain node: condition, mode, water level, rise rate, time to overflow, classifier output, battery, last report. |
| Analysis | Per-drain classifier and predictor outputs against their thresholds, the weather sync that sets sampling modes, SDG 11.5 / 13.1 impact indicators, and what the dashboard is connected to. |

The **Area** control (all municipalities, Grand Tunis, Sousse, Sfax,
Nabeul) scopes every view at once.

## How it connects

| Part of the system | Where it shows up | API |
|---|---|---|
| Drain nodes / edge simulator | Map, Sensors, water-level charts | `GET /fleet`, `GET /nodes/{id}/history` |
| Layer 1 · edge debris classifier | Blockage probability, class, confidence | `classifier` in `/fleet` (from each uplink) |
| Layer 2 · flood predictor | Time to overflow, bloom size, queue order | `projected_overflow_min` in `/fleet`, `eta_minutes` on alerts |
| Decision engine | Incidents (a node's open alerts grouped together) | `GET /alerts`, `POST /alerts/ack-node` |
| Weather sync | Forecast and sampling modes | `GET /regions`, `POST /weather/sync` |
| Crews and dispatch | Recommendations, dispatch, notifications | `/teams`, `/nodes/{id}/recommendations`, `/dispatches`, `/notifications` |
| Demo controls | Simulate dialog | `POST /simulator/run`, `GET /simulator`, `POST /demo/reset` |

The classifier and predictor outputs come from whatever produces them
today (edge simulator, `dh/dt` projection in the decision engine). When
`ml/edge_classifier` and `ml/flood_predictor` ship, the same fields fill
with their outputs and the dashboard needs no changes.

Crew messages are stored and shown as sent. Real delivery needs an SMS /
WhatsApp gateway (for example Twilio) wired into
`cloud/api/operations.py:notify_crews` and `create_dispatch`.

## Notes

- **Basemap:** Esri World Light / Dark Gray Canvas (no key needed for a
  prototype, attribution shown on the map). For production use, get an
  ArcGIS key or swap the URLs in `src/components/OpsMap.tsx`.
- **Timestamps:** SQLite returns them without a zone; `lib/time.parseTs`
  treats them as UTC.
- **Themes:** day and night themes follow the OS setting; the header
  toggle overrides it.

## Code map

```
src/
  api/          client, response types, React Query hooks
  lib/          domain rules (incidents, crew positions, water level), ops context, time
  components/   header, workflow strip, map (contour bloom), rail, drain detail, charts, dialogs
  views/        Operations, Crews, Sensors, Analysis
  styles/       tokens (light/dark), base, layout, operations, pages
```
