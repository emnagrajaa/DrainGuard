# DrainGuard

AI-powered municipal storm-drain monitoring & predictive flood system.
TecWeek Ignis 3.0 — "Observe & Act" submission.

## What's built and working right now

- **`cloud/api/`** — FastAPI ingestion service, decision engine, weather
  sync. Tested end to end: ingest → persist → decision rules → alerts.
- **`edge_simulator/`** — a mock fleet of 10 nodes across Tunis, Ariana,
  Sfax, Sousse and Nabeul that speaks the exact payload contract real
  ESP32 firmware will send over LoRaWAN. Runs a scripted dry→pre-storm→
  storm scenario for live demos.
- **`dashboard/`** — the municipal operations console (React + Leaflet):
  live map with projected impact zones, incident queue sorted by time to
  overflow, crew recommendations, dispatch and crew messaging, sensor
  table, model/weather analysis. Can start simulator runs itself. See
  `dashboard/README.md`.
- **`cloud/api/operations.py`** — the endpoints behind the dashboard's
  "Act" side: crews, dispatches, crew notifications, a fleet view, and
  demo controls (run a simulator scenario, reset demo data).

## What's still a stub (next to build)

- `ml/edge_classifier/` — real training pipeline for the debris
  classifier (simulator currently fakes its output).
- `ml/flood_predictor/` — the full spatial-temporal model; decision
  engine currently uses a simplified rise-rate projection instead.
- Real SMS / WhatsApp delivery for crew messages (records are stored and
  shown as sent; plug a gateway into `operations.py`).
- Real hardware firmware + LoRaWAN gateway integration (that's you).

## Quickstart (SQLite, zero setup)

```bash
pip install -r requirements.txt

# .env is already checked in with working defaults (SQLite, no weather key)
# terminal 1 — start the cloud API
uvicorn cloud.api.main:app --reload --port 8000

# terminal 2 — dry-day baseline (a few nodes get flagged for debris)
python -m edge_simulator.fleet_simulator --scenario dry --ticks 5

# terminal 2 — live storm demo (dry -> pre-storm -> storm, alerts fire)
python -m edge_simulator.fleet_simulator --scenario storm --tick-seconds 1.5

# terminal 3 — the dashboard (http://127.0.0.1:5173); its Simulate
# button can also start these scenarios for you
cd dashboard && npm install && npm run dev
```

## Switching to real Postgres/TimescaleDB (via Docker)

```bash
docker compose up -d        # starts Postgres+TimescaleDB on localhost:5432

# edit .env: comment out the SQLite line, uncomment the postgresql:// line

uvicorn cloud.api.main:app --reload --port 8000   # creates tables on startup
python -m cloud.db.setup_timescale                 # converts readings -> hypertable (one-time)
```

Everything else (ingest, decision engine, simulator) works identically
against either backend — only `DATABASE_URL` in `.env` changes.

## Using real weather data

Get a free OpenWeatherMap API key (One Call API 3.0) and put it in
`.env` as `OWM_API_KEY=...`. `weather_client.py` will then call the
live API instead of generating mock values — nothing else changes.
Trigger it manually with `POST /api/v1/weather/sync`, or wire it to a
scheduler (APScheduler/cron) for production.

## Real sensor data

Node *readings* are simulated by `edge_simulator/` until real firmware
exists — there's no way around that without hardware. The moment your
ESP32 firmware sends a real LoRaWAN uplink matching `IngestPayload`
(via your gateway's webhook, pointed at `POST /api/v1/ingest`), it's
indistinguishable from simulated data to everything downstream —
decision engine, alerts, dashboard all just work.

Then check:
```bash
curl http://127.0.0.1:8000/api/v1/nodes
curl http://127.0.0.1:8000/api/v1/alerts
```

Interactive API docs: http://127.0.0.1:8000/docs (FastAPI auto-generates
this — good to have open during the pitch Q&A).

## The payload contract (hardware team — read this)

`cloud/api/schemas.py:IngestPayload` is the exact JSON shape your
LoRaWAN gateway webhook should POST to `/api/v1/ingest`. `edge_simulator/node.py`
builds this same shape, so once firmware is ready you just point the
gateway's webhook at this endpoint — no other code changes needed.

## Environment variables

Set in `.env` (already checked in with working SQLite defaults;
`.env.example` documents the same variables for reference):

- `DATABASE_URL` — defaults to local SQLite (`drainguard.db`); swap to
  the Docker Postgres URL as shown above.
- `OWM_API_KEY` — OpenWeatherMap key for `weather_client.py`. If unset,
  weather sync falls back to a mock generator so the pipeline still
  runs without a key.
