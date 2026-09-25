"""
Request/response schemas.

IngestPayload is the contract: this is exactly what a LoRaWAN gateway
webhook (ChirpStack/TTN) should forward to POST /api/v1/ingest once
real hardware is sending uplinks, and it's exactly what the edge
simulator's mock generator produces. Keep the hardware and software
teams pointed at this one schema so nothing drifts.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ClassifierOutput(BaseModel):
    class_: str = Field(alias="class")
    confidence: float
    p_trash: float

    class Config:
        populate_by_name = True


class IngestPayload(BaseModel):
    node_id: str
    timestamp: datetime
    mode: int                                  # 1 = dry, 2 = pre-storm, 3 = storm
    battery_v: float
    moisture_switch: bool
    classifier_output: Optional[ClassifierOutput] = None
    distance_cm: Optional[float] = None
    dh_dt: Optional[float] = None               # only populated in mode 3

    # optional — present when a simulated/real node registers itself
    # for the first time so the dashboard has a map position for it
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    municipality: Optional[str] = None


class NodeStatus(BaseModel):
    id: str
    municipality: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    last_seen: Optional[datetime]
    battery_v: Optional[float]
    current_mode: Optional[int]
    status: Optional[str]

    class Config:
        from_attributes = True


class AlertOut(BaseModel):
    id: int
    node_id: str
    created_at: datetime
    alert_type: str
    priority: str
    message: str
    eta_minutes: Optional[float]
    acknowledged: bool

    class Config:
        from_attributes = True


class AckRequest(BaseModel):
    alert_id: int
