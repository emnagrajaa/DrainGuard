"""
Decision engine — this is the "Understand -> Alert -> Act" step of the
Detect/Understand/Alert/Act workflow.

evaluate_reading() is called once per incoming reading (from ingest.py)
after it's been persisted. It looks at the reading, the node's recent
history, and the node's current mode, and decides whether to raise a
cleaning ticket or a flood-overflow warning.

The flood-lead-time estimate here is a deliberately simple stand-in for
the full spatial-temporal GNN described in the architecture doc: a
rolling dh/dt threshold projected forward. It's honest about being an
MVP, and it's what actually gets demoed before ml/flood_predictor is
trained on real data.
"""
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import desc

from . import models

# ---- tunable thresholds (pull from your brief / calibrate later) ----
TRASH_ALERT_THRESHOLD = 0.50        # p_trash above this in Mode 1 -> cleaning ticket
OVERFLOW_LEAD_TIME_ALERT_MIN = 45.0  # only alert if predicted overflow is within this window
BASIN_DEPTH_CM = 60.0                # distance-to-floor when basin is "full" (calibrate per node)
MIN_DH_DT_FOR_PROJECTION = 0.05      # cm/min — ignore noise-level rises


def _project_overflow_minutes(distance_cm: float, dh_dt: float) -> float | None:
    """
    Very simple physical projection: distance_cm is how far the water
    surface is from the basin floor sensor mount; as water rises,
    distance_cm decreases. dh_dt here is reported as rate of *rise*
    (cm/min, positive = rising). Time to overflow = remaining headroom
    / rate of rise.
    """
    if dh_dt is None or dh_dt < MIN_DH_DT_FOR_PROJECTION or distance_cm is None:
        return None
    headroom_cm = distance_cm - (100 - BASIN_DEPTH_CM)  # placeholder calibration
    headroom_cm = max(distance_cm, 0)
    return headroom_cm / dh_dt


def evaluate_reading(db: Session, node: models.Node, reading: models.Reading) -> list[models.Alert]:
    """Runs the decision rules for one reading. Returns any new Alert rows created."""
    new_alerts: list[models.Alert] = []

    # --- Mode 1 (dry): debris/blockage classifier drives cleaning dispatch ---
    if reading.mode == 1 and reading.p_trash is not None and reading.p_trash > TRASH_ALERT_THRESHOLD:
        alert = models.Alert(
            node_id=node.id,
            alert_type="cleaning_ticket",
            priority="normal",
            message=(
                f"Node {node.id} ({node.municipality}) flagged "
                f"{reading.classifier_class or 'blockage'} at "
                f"p_trash={reading.p_trash:.2f}. Route-optimized cleaning "
                f"ticket generated ahead of forecasted rain."
            ),
            meta={"p_trash": reading.p_trash, "class": reading.classifier_class},
        )
        db.add(alert)
        new_alerts.append(alert)
        node.status = "trash_flagged"

    # --- Mode 2 (pre-storm): escalate any still-unresolved trash flags to high priority ---
    elif reading.mode == 2 and reading.p_trash is not None and reading.p_trash > TRASH_ALERT_THRESHOLD:
        alert = models.Alert(
            node_id=node.id,
            alert_type="cleaning_ticket",
            priority="high",
            message=(
                f"URGENT: Node {node.id} still shows blockage "
                f"(p_trash={reading.p_trash:.2f}) with rain forecast <12h. "
                f"Dispatch before storm arrival."
            ),
            meta={"p_trash": reading.p_trash},
        )
        db.add(alert)
        new_alerts.append(alert)
        node.status = "trash_flagged"

    # --- Mode 3 (active storm): project overflow from rate of water rise ---
    if reading.mode == 3:
        eta = _project_overflow_minutes(reading.distance_cm, reading.dh_dt)
        if eta is not None and eta <= OVERFLOW_LEAD_TIME_ALERT_MIN:
            alert = models.Alert(
                node_id=node.id,
                alert_type="overflow_warning",
                priority="critical",
                message=(
                    f"FLOOD RISK: Node {node.id} ({node.municipality}) projected "
                    f"to overflow in ~{eta:.0f} min at current rise rate "
                    f"({reading.dh_dt:.2f} cm/min). Pump activation + traffic "
                    f"diversion recommended."
                ),
                eta_minutes=eta,
                meta={"dh_dt": reading.dh_dt, "distance_cm": reading.distance_cm},
            )
            db.add(alert)
            new_alerts.append(alert)
            node.status = "overflow_risk"

    if not new_alerts and node.status not in ("normal",):
        # reading came back clean — don't silently keep stale flags forever
        if reading.mode in (1, 2) and (reading.p_trash or 0) <= TRASH_ALERT_THRESHOLD:
            node.status = "normal"

    db.commit()
    for a in new_alerts:
        db.refresh(a)
    return new_alerts
