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

### Pitch shortcut: press `P`

**P** toggles a staged flood warning at El Khadra, Tunis (`TUN-KHADRA-011`).

- **First press:** the backend (`POST /api/v1/demo/khadra`) pushes a short
  history through the normal ingest path. The edge classifier sees solid
  trash before the rain, then the storm fills the basin, and the decision
  engine opens the alerts itself. The map flies to El Khadra and the impact
  zone grows around the drain. There are about 18 minutes to overflow, so
  there's time to dispatch a crew live.
- **Next press:** `DELETE /api/v1/demo/khadra` removes the drain, its
  alerts and any dispatch to it (the crew goes back to available). The map
  returns to the empty whole-area view, ready to go again.

The key is ignored while typing or in a dialog, and Ctrl+P still prints.
