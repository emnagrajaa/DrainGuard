"""
Request/response schemas.

IngestPayload is the contract: this is exactly what a LoRaWAN gateway
webhook (ChirpStack/TTN) should forward to POST /api/v1/ingest once
real hardware is sending uplinks, and it's exactly what the edge
simulator's mock generator produces. Keep the hardware and software
teams pointed at this one schema so nothing drifts.
"""
from datetime import datetime
from typing import List, Literal, Optional
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


# ---- operations (crews, dispatch, notifications, demo controls) ----

class TeamOut(BaseModel):
    id: str
    name: str
    kind: str
    municipality: str
    base_latitude: float
    base_longitude: float
    lead: Optional[str]
    phone: Optional[str]
    members: int
    status: str
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class TeamUpdate(BaseModel):
    status: Literal["available", "off_duty"]


class DispatchCreate(BaseModel):
    team_id: str
    node_id: str
    alert_id: Optional[int] = None
    note: Optional[str] = None
    channel: Literal["sms", "whatsapp", "radio"] = "sms"


class DispatchUpdate(BaseModel):
    status: Literal["on_site", "resolved", "cancelled"]


class DispatchOut(BaseModel):
    id: int
    team_id: str
    node_id: str
    alert_id: Optional[int]
    status: str
    note: Optional[str]
    travel_minutes: Optional[float]
    created_at: datetime
    updated_at: Optional[datetime]
    resolved_at: Optional[datetime]

    class Config:
        from_attributes = True


class NotificationCreate(BaseModel):
    message: str = Field(min_length=1, max_length=480)
    channel: Literal["sms", "whatsapp", "radio"] = "sms"
    # target: explicit crews, or every on-duty crew in a municipality
    # (omit both to reach every on-duty crew)
    team_ids: Optional[List[str]] = None
    municipality: Optional[str] = None


class NotificationOut(BaseModel):
    id: int
    team_id: str
    dispatch_id: Optional[int]
    channel: str
    message: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class NodeAckRequest(BaseModel):
    node_id: str


class SimulatorRun(BaseModel):
    scenario: Literal["dry", "storm"] = "storm"
    tick_seconds: float = Field(2.0, ge=0.2, le=10.0)
    ticks: int = Field(8, ge=1, le=40)       # dry: ticks; storm: storm-phase ticks
