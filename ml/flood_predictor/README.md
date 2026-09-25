# Layer 2 — Cloud Hydro-Spatial Flood Predictor (not yet built)

Planned: LSTM per-node water-level forecast + adjacency-based risk
propagation (simplified stand-in for a full spatial-temporal GNN,
which needs historical flood event data this project doesn't have
yet).

Planned files:
- graph_topology.py — drain adjacency / DEM-lite
- model.py            — LSTM + graph aggregation
- train.py

Until this exists, cloud/api/decision_engine.py uses a simple dh/dt
rise-rate projection to estimate time-to-overflow, which is what's
currently demoed.
