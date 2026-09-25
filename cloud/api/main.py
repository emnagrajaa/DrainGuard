"""
DrainGuard cloud ingestion API.

Run:
    uvicorn cloud.api.main:app --reload --port 8000

This is the target for the LoRaWAN gateway's webhook (ChirpStack/TTN)
once real hardware is live, and it's exactly what edge_simulator posts
to today.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc

from . import models, schemas, decision_engine, weather_client, operations
from .database import Base, engine, get_db

Base.metadata.create_all(bind=engine)
operations.seed_teams()

app = FastAPI(title="DrainGuard Cloud API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten before this touches anything real
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(operations.router)   # crews, dispatch, fleet view, demo controls


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc)}


@app.post("/api/v1/ingest")
def ingest(payload: schemas.IngestPayload, db: Session = Depends(get_db)):
    """
    Receives one uplink payload (real or simulated) per the shared
    IngestPayload contract, persists it, updates the node's live
    status, and runs it through the decision engine.
    """
    node = db.get(models.Node, payload.node_id)
    if node is None:
        # first time we've heard from this node — register it
        node = models.Node(
            id=payload.node_id,
            municipality=payload.municipality or "Unknown",
            latitude=payload.latitude,
            longitude=payload.longitude,
        )
        db.add(node)

    node.last_seen = payload.timestamp
    node.battery_v = payload.battery_v
    node.current_mode = payload.mode
    if payload.latitude is not None:
        node.latitude = payload.latitude
    if payload.longitude is not None:
        node.longitude = payload.longitude
    if payload.municipality:
        node.municipality = payload.municipality

    reading = models.Reading(
        node_id=payload.node_id,
        timestamp=payload.timestamp,
        mode=payload.mode,
        battery_v=payload.battery_v,
        moisture_switch=payload.moisture_switch,
        distance_cm=payload.distance_cm,
        dh_dt=payload.dh_dt,
        classifier_class=payload.classifier_output.class_ if payload.classifier_output else None,
        classifier_confidence=payload.classifier_output.confidence if payload.classifier_output else None,
        p_trash=payload.classifier_output.p_trash if payload.classifier_output else None,
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)

    new_alerts = decision_engine.evaluate_reading(db, node, reading)

    return {
        "received": True,
        "node_id": node.id,
        "reading_id": reading.id,
        "alerts_triggered": [a.id for a in new_alerts],
    }


@app.get("/api/v1/nodes", response_model=List[schemas.NodeStatus])
def list_nodes(db: Session = Depends(get_db)):
    return db.query(models.Node).all()


@app.get("/api/v1/nodes/{node_id}/history")
def node_history(node_id: str, limit: int = 100, db: Session = Depends(get_db)):
    node = db.get(models.Node, node_id)
    if node is None:
        raise HTTPException(404, "unknown node_id")
    readings = (
        db.query(models.Reading)
        .filter(models.Reading.node_id == node_id)
        .order_by(desc(models.Reading.timestamp))
        .limit(limit)
        .all()
    )
    return readings


@app.get("/api/v1/alerts", response_model=List[schemas.AlertOut])
def list_alerts(unacknowledged_only: bool = False, limit: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(models.Alert).order_by(desc(models.Alert.created_at))
    if unacknowledged_only:
        q = q.filter(models.Alert.acknowledged == False)  # noqa: E712
    if limit:
        q = q.limit(limit)
    return q.all()


@app.post("/api/v1/alerts/ack")
def ack_alert(req: schemas.AckRequest, db: Session = Depends(get_db)):
    alert = db.get(models.Alert, req.alert_id)
    if alert is None:
        raise HTTPException(404, "unknown alert_id")
    alert.acknowledged = True
    alert.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    return {"acknowledged": True, "alert_id": alert.id}


@app.post("/api/v1/weather/sync")
def sync_weather(db: Session = Depends(get_db)):
    """Manually trigger a weather sync across all municipalities (normally scheduled)."""
    regions = weather_client.sync_all_regions(db)
    return [
        {
            "municipality": r.municipality,
            "mode": r.mode,
            "rain_probability": r.rain_probability,
            "rain_rate_mm_h": r.rain_rate_mm_h,
        }
        for r in regions
    ]
