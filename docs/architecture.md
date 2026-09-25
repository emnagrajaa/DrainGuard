# DrainGuard — Architecture

```
[Edge Node: ESP32-S3 + JSN-SR04T + moisture switch]
        |  LoRaWAN uplink (see IngestPayload contract)
        v
[LoRaWAN Gateway] --> [Network Server: ChirpStack/TTN]
        |  Webhook
        v
[Cloud Ingestion API  (cloud/api/main.py)]  --> [SQLite/Postgres+Timescale]
        |
        |--> [Weather Sync  (weather_client.py)] <-- OpenWeatherMap
        |--> [Decision Engine  (decision_engine.py)]
        v
[Alerts]  --> Dashboard (dashboard/)  --> crews via SMS / WhatsApp / radio
                 |
                 +--> [Operations API (operations.py)]: crews, dispatch,
                      notifications, fleet view, simulator controls
```

## Status vs. brief

| Layer | Brief describes | Currently implemented as |
|---|---|---|
| Edge debris classifier | On-device TFLite Micro CNN, 94% accuracy | Simulated in `edge_simulator/node.py`; real training pipeline is the next build step (`ml/edge_classifier/`) |
| Cloud flood predictor | Spatial-temporal GNN over DEM + pipe topology | Simplified rise-rate (`dh/dt`) projection in `decision_engine.py`; honest MVP scoped to be replaced once historical flood data exists |
| Weather sync | OpenWeatherMap/INM polling, mode switching | Implemented — real API call with a mock fallback when no key is set |
| LoRaWAN transport | ESP32 + RFM95W uplink/downlink | Simulated by `edge_simulator/`; payload contract is hardware-ready |
| Dashboard | Municipal GIS map | Implemented in `dashboard/` — live map with projected impact zones, incident queue, crew recommendations and dispatch, sensor table, model and weather analysis |
| Crew notifications | SMS / WhatsApp alerts | Messages and dispatch orders are stored and shown as sent; real delivery needs a gateway |

## Ingest payload contract

See `cloud/api/schemas.py:IngestPayload`. This is the single source of
truth both the simulator and (eventually) real firmware target.

## Decision rules

See `cloud/api/decision_engine.py` for the exact thresholds. Summary:

- **Mode 1 (dry):** `p_trash > 0.5` → cleaning ticket (normal priority)
- **Mode 2 (pre-storm):** same threshold, escalated to high priority
- **Mode 3 (storm):** projected overflow within 45 min → critical alert
  with ETA, triggers simulated pump/traffic-diversion action
