"""
Operations API — the "Act" half of Detect -> Understand -> Alert -> Act.

Everything the municipal dashboard needs on top of raw ingest:

- a fleet view that joins each node with its latest reading, its latest
  edge-classifier output (Layer 1) and its projected time-to-overflow
  (Layer 2, via decision_engine)
- field crews, crew recommendations, dispatches and crew notifications
  (SMS / WhatsApp / radio — delivery is simulated until a gateway such as
  Twilio is wired in; the records are real)
- demo controls: run edge_simulator scenarios from the dashboard and
  reset the demo data between pitch rehearsals

Mounted by main.py; nothing here changes the ingest contract.
"""
import math
import threading
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc
from sqlalchemy.orm import Session

from . import models, schemas, decision_engine
from .config import DATABASE_URL, OWM_API_KEY
from .database import SessionLocal, get_db

router = APIRouter(prefix="/api/v1")

# Distance reading of an empty basin — matches edge_simulator's dry-day
# calibration. The dashboard uses it to turn distance_cm into a fill level.
SENSOR_EMPTY_DISTANCE_CM = 45.0

# Crew travel estimate: straight-line distance x road factor at urban speed,
# plus a fixed mobilisation time to get the crew rolling.
CREW_SPEED_KMH = 35.0
ROAD_FACTOR = 1.3
MOBILISATION_MIN = 4.0

REACHABLE_WITHIN_MIN = 60.0   # crews further out are listed last, whatever their type

ACTIVE_DISPATCH_STATUSES = ("en_route", "on_site")
RECENT_READINGS_PER_NODE = 24

# Which crew types can handle which alert, best first.
CREW_FIT = {
    "overflow_warning": ["pump", "traffic", "cleaning"],
    "cleaning_ticket": ["cleaning", "pump", "traffic"],
}

SEED_TEAMS = [
    # id, name, kind, municipality, lat, lon, lead, phone, members, status
    ("TN-HC-01", "Hydro-cleaning crew 1", "cleaning", "Tunis", 36.8008, 10.1800, "Karim Belhadj", "+216 71 000 101", 5, "available"),
    ("TN-HC-02", "Hydro-cleaning crew 2", "cleaning", "Tunis", 36.8152, 10.1640, "Salma Trabelsi", "+216 71 000 102", 4, "available"),
    ("TN-PU-01", "Mobile pump unit", "pump", "Tunis", 36.7948, 10.2012, "Hichem Jaziri", "+216 71 000 103", 3, "available"),
    ("AR-HC-01", "Ariana cleaning crew", "cleaning", "Ariana", 36.8662, 10.1898, "Mehdi Gharbi", "+216 71 000 201", 4, "available"),
    ("AR-TD-01", "Traffic diversion unit", "traffic", "Ariana", 36.8551, 10.2108, "Ines Mansouri", "+216 71 000 202", 3, "available"),
    ("SO-HC-01", "Sousse cleaning crew", "cleaning", "Sousse", 35.8291, 10.6002, "Anis Hammami", "+216 73 000 301", 4, "available"),
    ("SO-PU-01", "Sousse pump unit", "pump", "Sousse", 35.8203, 10.6151, "Rim Chaabane", "+216 73 000 302", 3, "off_duty"),
    ("SF-HC-01", "Sfax cleaning crew", "cleaning", "Sfax", 34.7381, 10.7502, "Walid Kammoun", "+216 74 000 401", 5, "available"),
    ("SF-PU-01", "Sfax pump unit", "pump", "Sfax", 34.7482, 10.7651, "Nour Ellouze", "+216 74 000 402", 3, "available"),
    ("NB-HC-01", "Nabeul cleaning crew", "cleaning", "Nabeul", 36.4519, 10.7298, "Sami Ben Amor", "+216 72 000 501", 4, "available"),
    ("NB-TD-01", "Nabeul civil protection", "traffic", "Nabeul", 36.4602, 10.7421, "Leila Baccouche", "+216 72 000 502", 6, "available"),
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def seed_teams() -> None:
    """Registers the default crew roster the first time the API starts."""
    with SessionLocal() as db:
        if db.query(models.Team).count():
            return
        for tid, name, kind, muni, lat, lon, lead, phone, members, status in SEED_TEAMS:
            db.add(models.Team(
                id=tid, name=name, kind=kind, municipality=muni,
                base_latitude=lat, base_longitude=lon, lead=lead, phone=phone,
                members=members, status=status,
            ))
        db.commit()


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _travel_minutes(distance_km: float) -> float:
    return MOBILISATION_MIN + distance_km * ROAD_FACTOR / CREW_SPEED_KMH * 60.0


# ---------------------------------------------------------------- system

@router.get("/system")
def system_info():
    """What the dashboard is connected to, and the thresholds the engine uses."""
    return {
        "version": "0.2.0",
        "database": "sqlite" if DATABASE_URL.startswith("sqlite") else "postgresql",
        "weather_source": "openweathermap" if OWM_API_KEY else "mock",
        "notification_gateway": "simulated",
        "thresholds": {
            "trash_alert_p": decision_engine.TRASH_ALERT_THRESHOLD,
            "overflow_lead_time_min": decision_engine.OVERFLOW_LEAD_TIME_ALERT_MIN,
            "min_rise_rate_cm_min": decision_engine.MIN_DH_DT_FOR_PROJECTION,
            "sensor_empty_distance_cm": SENSOR_EMPTY_DISTANCE_CM,
        },
        "models": {
            "edge_classifier": {
                "name": "Edge debris classifier",
                "runs_on": "ESP32-S3 (TFLite Micro)",
                "classes": ["empty", "solid_trash", "organic_silt", "false_positive"],
                "source": "edge_simulator",   # flips to "firmware" once ml/edge_classifier ships
            },
            "flood_predictor": {
                "name": "Flood predictor",
                "runs_on": "Cloud decision engine",
                "method": "dh/dt rise-rate projection",
                "source": "decision_engine",   # ml/flood_predictor LSTM replaces this
            },
        },
        "mode_intervals_s": {"1": 6 * 3600, "2": 15 * 60, "3": 30},
    }


# ---------------------------------------------------------------- fleet

@router.get("/fleet")
def fleet(db: Session = Depends(get_db)):
    """Every node with its latest reading, latest classifier output and overflow projection."""
    out = []
    for node in db.query(models.Node).order_by(models.Node.id).all():
        recent = (
            db.query(models.Reading)
            .filter(models.Reading.node_id == node.id)
            .order_by(desc(models.Reading.timestamp))
            .limit(RECENT_READINGS_PER_NODE)
            .all()
        )
        latest = recent[0] if recent else None
        classified = (
            db.query(models.Reading)
            .filter(models.Reading.node_id == node.id, models.Reading.classifier_class.isnot(None))
            .order_by(desc(models.Reading.timestamp))
            .first()
        )
        projected = (
            decision_engine._project_overflow_minutes(latest.distance_cm, latest.dh_dt)
            if latest is not None and latest.mode == 3 else None
        )
        out.append({
            "id": node.id,
            "municipality": node.municipality,
            "latitude": node.latitude,
            "longitude": node.longitude,
            "last_seen": node.last_seen,
            "battery_v": node.battery_v,
            "current_mode": node.current_mode,
            "status": node.status,
            "latest": None if latest is None else {
                "timestamp": latest.timestamp,
                "mode": latest.mode,
                "distance_cm": latest.distance_cm,
                "dh_dt": latest.dh_dt,
                "moisture_switch": latest.moisture_switch,
            },
            "classifier": None if classified is None else {
                "timestamp": classified.timestamp,
                "class": classified.classifier_class,
                "confidence": classified.classifier_confidence,
                "p_trash": classified.p_trash,
            },
            "projected_overflow_min": projected,
            "recent": [
                {"t": r.timestamp, "distance_cm": r.distance_cm, "dh_dt": r.dh_dt}
                for r in reversed(recent)
            ],
        })
    return out


@router.get("/regions")
def regions(db: Session = Depends(get_db)):
    """Latest weather-sync result per municipality (see weather_client)."""
    return [
        {
            "municipality": r.municipality,
            "mode": r.mode,
            "rain_probability": r.rain_probability,
            "rain_rate_mm_h": r.rain_rate_mm_h,
            "updated_at": r.updated_at,
        }
        for r in db.query(models.RegionMode).order_by(models.RegionMode.municipality).all()
    ]


@router.post("/alerts/ack-node")
def ack_node_alerts(req: schemas.NodeAckRequest, db: Session = Depends(get_db)):
    """Acknowledges every open alert on a node (the dashboard groups them as one incident)."""
    now = _utcnow()
    alerts = (
        db.query(models.Alert)
        .filter(models.Alert.node_id == req.node_id, models.Alert.acknowledged == False)  # noqa: E712
        .all()
    )
    for a in alerts:
        a.acknowledged = True
        a.acknowledged_at = now
    db.commit()
    return {"acknowledged": len(alerts), "node_id": req.node_id}


# ---------------------------------------------------------------- crews

def _team_position(db: Session, team: models.Team) -> tuple[float, float]:
    """Where a crew is now: at its base, or at the node it was sent to."""
    active = (
        db.query(models.Dispatch)
        .filter(models.Dispatch.team_id == team.id, models.Dispatch.status.in_(ACTIVE_DISPATCH_STATUSES))
        .first()
    )
    if active is not None:
        node = db.get(models.Node, active.node_id)
        if node is not None and node.latitude is not None:
            return node.latitude, node.longitude
    return team.base_latitude, team.base_longitude


@router.get("/teams", response_model=List[schemas.TeamOut])
def list_teams(db: Session = Depends(get_db)):
    return db.query(models.Team).order_by(models.Team.municipality, models.Team.id).all()


@router.patch("/teams/{team_id}", response_model=schemas.TeamOut)
def update_team(team_id: str, req: schemas.TeamUpdate, db: Session = Depends(get_db)):
    """Puts a crew on or off duty. Crews on an active dispatch can't go off duty."""
    team = db.get(models.Team, team_id)
    if team is None:
        raise HTTPException(404, "unknown team_id")
    if team.status in ACTIVE_DISPATCH_STATUSES:
        raise HTTPException(409, f"{team.id} is on an active dispatch")
    team.status = req.status
    team.updated_at = _utcnow()
    db.commit()
    db.refresh(team)
    return team


@router.get("/nodes/{node_id}/recommendations")
def recommend_crews(node_id: str, db: Session = Depends(get_db)):
    """
    Ranks crews for a node's open incident: available crews first, then
    crews that can arrive within the hour, then by how well the crew type
    fits the alert, then by travel time.
    """
    node = db.get(models.Node, node_id)
    if node is None:
        raise HTTPException(404, "unknown node_id")

    open_alert = (
        db.query(models.Alert)
        .filter(models.Alert.node_id == node_id, models.Alert.acknowledged == False)  # noqa: E712
        .order_by(desc(models.Alert.created_at))
        .first()
    )
    alert_type = open_alert.alert_type if open_alert else "cleaning_ticket"
    fit_order = CREW_FIT.get(alert_type, CREW_FIT["cleaning_ticket"])

    ranked = []
    for team in db.query(models.Team).all():
        lat, lon = _team_position(db, team)
        dist = _haversine_km(lat, lon, node.latitude, node.longitude)
        fit_rank = fit_order.index(team.kind) if team.kind in fit_order else len(fit_order)
        ranked.append({
            "team_id": team.id,
            "status": team.status,
            "kind": team.kind,
            "distance_km": round(dist, 2),
            "travel_minutes": round(_travel_minutes(dist), 1),
            "fit": ["primary", "support", "fallback"][min(fit_rank, 2)],
            "available": team.status == "available",
            "reachable": _travel_minutes(dist) <= REACHABLE_WITHIN_MIN,
        })
    ranked.sort(key=lambda r: (
        not r["available"],
        not r["reachable"],
        ["primary", "support", "fallback"].index(r["fit"]),
        r["travel_minutes"],
    ))
    return {"node_id": node_id, "alert_type": alert_type, "crews": ranked}


# ---------------------------------------------------------------- dispatch

def _dispatch_message(dispatch: models.Dispatch, node: models.Node, alert: Optional[models.Alert]) -> str:
    parts = [f"DrainGuard dispatch #{dispatch.id}: proceed to drain {node.id} ({node.municipality}), "
             f"{node.latitude:.4f}, {node.longitude:.4f}."]
    if alert is not None and alert.alert_type == "overflow_warning" and alert.eta_minutes is not None:
        parts.append(f"Overflow projected in ~{alert.eta_minutes:.0f} min. Deploy pumps, divert traffic.")
    elif alert is not None:
        parts.append("Blockage detected by the drain sensor. Clear the inlet.")
    if dispatch.note:
        parts.append(dispatch.note)
    return " ".join(parts)


@router.get("/dispatches", response_model=List[schemas.DispatchOut])
def list_dispatches(active_only: bool = False, limit: int = 200, db: Session = Depends(get_db)):
    q = db.query(models.Dispatch).order_by(desc(models.Dispatch.created_at))
    if active_only:
        q = q.filter(models.Dispatch.status.in_(ACTIVE_DISPATCH_STATUSES))
    return q.limit(limit).all()


@router.post("/dispatches", response_model=schemas.DispatchOut)
def create_dispatch(req: schemas.DispatchCreate, db: Session = Depends(get_db)):
    team = db.get(models.Team, req.team_id)
    node = db.get(models.Node, req.node_id)
    if team is None:
        raise HTTPException(404, "unknown team_id")
    if node is None:
        raise HTTPException(404, "unknown node_id")
    if team.status != "available":
        raise HTTPException(409, f"{team.id} is {team.status.replace('_', ' ')}")

    alert = db.get(models.Alert, req.alert_id) if req.alert_id else (
        db.query(models.Alert)
        .filter(models.Alert.node_id == node.id, models.Alert.acknowledged == False)  # noqa: E712
        .order_by(desc(models.Alert.created_at))
        .first()
    )
    dist = _haversine_km(team.base_latitude, team.base_longitude, node.latitude, node.longitude)
    now = _utcnow()
    dispatch = models.Dispatch(
        team_id=team.id,
        node_id=node.id,
        alert_id=alert.id if alert else None,
        note=req.note,
        status="en_route",
        travel_minutes=round(_travel_minutes(dist), 1),
        created_at=now,
        updated_at=now,
    )
    db.add(dispatch)
    team.status = "en_route"
    team.updated_at = now
    db.flush()  # assigns dispatch.id for the message

    db.add(models.Notification(
        team_id=team.id,
        dispatch_id=dispatch.id,
        channel=req.channel,
        message=_dispatch_message(dispatch, node, alert),
        created_at=now,
    ))
    db.commit()
    db.refresh(dispatch)
    return dispatch


@router.patch("/dispatches/{dispatch_id}", response_model=schemas.DispatchOut)
def update_dispatch(dispatch_id: int, req: schemas.DispatchUpdate, db: Session = Depends(get_db)):
    """
    on_site   — crew has arrived
    resolved  — crew closed the incident: the node's alerts are acknowledged,
                the node returns to normal and the crew is available again
    cancelled — crew is stood down without resolving
    """
    dispatch = db.get(models.Dispatch, dispatch_id)
    if dispatch is None:
        raise HTTPException(404, "unknown dispatch_id")
    if dispatch.status not in ACTIVE_DISPATCH_STATUSES:
        raise HTTPException(409, f"dispatch #{dispatch.id} is already {dispatch.status}")

    now = _utcnow()
    team = db.get(models.Team, dispatch.team_id)
    dispatch.status = req.status
    dispatch.updated_at = now

    if req.status == "on_site":
        team.status = "on_site"
    else:
        team.status = "available"
        if req.status == "resolved":
            dispatch.resolved_at = now
            for a in db.query(models.Alert).filter(
                models.Alert.node_id == dispatch.node_id,
                models.Alert.acknowledged == False,  # noqa: E712
            ):
                a.acknowledged = True
                a.acknowledged_at = now
            node = db.get(models.Node, dispatch.node_id)
            if node is not None:
                node.status = "normal"
    team.updated_at = now
    db.commit()
    db.refresh(dispatch)
    return dispatch


# ---------------------------------------------------------------- notifications

@router.get("/notifications", response_model=List[schemas.NotificationOut])
def list_notifications(limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Notification).order_by(desc(models.Notification.created_at)).limit(limit).all()


@router.post("/notifications", response_model=List[schemas.NotificationOut])
def notify_crews(req: schemas.NotificationCreate, db: Session = Depends(get_db)):
    """Sends one message to specific crews, a municipality's crews, or every on-duty crew."""
    q = db.query(models.Team)
    if req.team_ids:
        teams = q.filter(models.Team.id.in_(req.team_ids)).all()
    else:
        q = q.filter(models.Team.status != "off_duty")
        if req.municipality:
            q = q.filter(models.Team.municipality == req.municipality)
        teams = q.all()
    if not teams:
        raise HTTPException(404, "no crews match that target")

    now = _utcnow()
    sent = [
        models.Notification(team_id=t.id, channel=req.channel, message=req.message, created_at=now)
        for t in teams
    ]
    db.add_all(sent)
    db.commit()
    for n in sent:
        db.refresh(n)
    return sent


# ---------------------------------------------------------------- demo controls

_sim_lock = threading.Lock()
_sim_state = {"running": False, "scenario": None, "started_at": None, "finished_at": None, "error": None}


def _run_simulation(scenario: str, api_url: str, tick_seconds: float, ticks: int) -> None:
    try:
        from edge_simulator import fleet_simulator  # repo-root package; imported lazily

        fleet_nodes = fleet_simulator.build_fleet()
        if scenario == "dry":
            fleet_simulator.run_dry_scenario(fleet_nodes, api_url, ticks)
        else:
            fleet_simulator.run_storm_scenario(fleet_nodes, api_url, tick_seconds, storm_ticks=ticks)
    except Exception as e:  # surface failures on the dashboard instead of dying silently
        _sim_state["error"] = str(e)
    finally:
        with _sim_lock:
            _sim_state["running"] = False
            _sim_state["finished_at"] = _utcnow()


@router.get("/simulator")
def simulator_status():
    return _sim_state


@router.post("/simulator/run")
def simulator_run(req: schemas.SimulatorRun, request: Request):
    """Runs an edge_simulator scenario in the background, posting to this API's own /ingest."""
    with _sim_lock:
        if _sim_state["running"]:
            raise HTTPException(409, "a simulation is already running")
        host, port = request.scope.get("server") or ("127.0.0.1", 8000)
        if host in ("0.0.0.0", "::"):
            host = "127.0.0.1"
        api_url = f"http://{host}:{port}"
        _sim_state.update(running=True, scenario=req.scenario, started_at=_utcnow(), finished_at=None, error=None)
    threading.Thread(
        target=_run_simulation,
        args=(req.scenario, api_url, req.tick_seconds, req.ticks),
        daemon=True,
    ).start()
    return _sim_state


@router.post("/demo/reset")
def demo_reset(db: Session = Depends(get_db)):
    """Clears readings, alerts, dispatches and messages, and stands every crew back to base."""
    if _sim_state["running"]:
        raise HTTPException(409, "wait for the running simulation to finish")
    for model in (models.Notification, models.Dispatch, models.Alert, models.Reading, models.Node, models.RegionMode):
        db.query(model).delete()
    seeded_status = {t[0]: t[9] for t in SEED_TEAMS}
    for team in db.query(models.Team).all():
        team.status = seeded_status.get(team.id, "available")
        team.updated_at = _utcnow()
    db.commit()
    return {"reset": True}


# The staged pitch incident: a drain in El Khadra (Tunis) that the edge
# classifier flagged as blocked before the rain, now filling fast.
KHADRA_NODE = {"node_id": "TUN-KHADRA-011", "municipality": "Tunis", "latitude": 36.8298, "longitude": 10.1966}


def _khadra_history(now: datetime) -> list[dict]:
    """Dry check, two pre-storm checks that see solid trash, then ten storm samples 30 s apart."""
    base = {**KHADRA_NODE, "battery_v": 3.58}
    history = [
        {**base, "timestamp": now - timedelta(hours=6), "mode": 1, "moisture_switch": False, "distance_cm": 45.0,
         "classifier_output": {"class": "organic_silt", "confidence": 0.81, "p_trash": 0.38}},
        {**base, "timestamp": now - timedelta(minutes=35), "mode": 2, "moisture_switch": False, "distance_cm": 45.0,
         "classifier_output": {"class": "solid_trash", "confidence": 0.9, "p_trash": 0.68}},
        {**base, "timestamp": now - timedelta(minutes=20), "mode": 2, "moisture_switch": False, "distance_cm": 45.0,
         "classifier_output": {"class": "solid_trash", "confidence": 0.93, "p_trash": 0.74}},
    ]
    samples = 10
    for i in range(samples):
        history.append({
            **base,
            "timestamp": now - timedelta(seconds=30 * (samples - 1 - i)),
            "mode": 3,
            "moisture_switch": True,
            "distance_cm": round(44.0 - 2.0 * i, 2),   # water surface climbing towards the sensor
            "dh_dt": round(0.9 + 0.06 * i, 2),          # and rising faster each sample
        })
    return history


@router.post("/demo/khadra")
def demo_khadra(db: Session = Depends(get_db)):
    """
    Pitch demo: raises a flood warning at El Khadra by pushing a short storm
    history through the normal ingest path, so the decision engine opens the
    alerts itself. A second call while that incident is still open does nothing.
    """
    from .main import ingest  # imported here: main imports this module

    node_id = KHADRA_NODE["node_id"]
    open_alerts = (
        db.query(models.Alert)
        .filter(models.Alert.node_id == node_id, models.Alert.acknowledged == False)  # noqa: E712
        .count()
    )
    if open_alerts:
        return {"node_id": node_id, "triggered": False, "open_alerts": open_alerts}

    for payload in _khadra_history(_utcnow()):
        ingest(schemas.IngestPayload(**payload), db)
    return {"node_id": node_id, "triggered": True}


@router.delete("/demo/khadra")
def demo_khadra_clear(db: Session = Depends(get_db)):
    """
    Removes the staged El Khadra drain and everything it produced (readings,
    alerts, dispatches and their crew messages), standing any crew sent there
    back to available, so the map is empty again for the next rehearsal.
    """
    node_id = KHADRA_NODE["node_id"]
    dispatches = db.query(models.Dispatch).filter(models.Dispatch.node_id == node_id).all()
    for d in dispatches:
        team = db.get(models.Team, d.team_id)
        if team is not None and d.status in ACTIVE_DISPATCH_STATUSES:
            team.status = "available"
            team.updated_at = _utcnow()
    if dispatches:
        db.query(models.Notification).filter(
            models.Notification.dispatch_id.in_([d.id for d in dispatches])
        ).delete(synchronize_session=False)
    for model in (models.Dispatch, models.Alert, models.Reading):
        db.query(model).filter(model.node_id == node_id).delete(synchronize_session=False)
    db.query(models.Node).filter(models.Node.id == node_id).delete(synchronize_session=False)
    db.commit()
    return {"node_id": node_id, "cleared": True}
