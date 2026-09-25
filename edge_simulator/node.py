"""
Simulates one physical DrainGuard node: generates ultrasonic distance
readings, a moisture-switch state, and a mock Layer-1 classifier
output, then packages it exactly as the real ESP32 firmware's
LoRaWAN uplink would (see cloud/api/schemas.py: IngestPayload).

This is what stands in for real hardware until the hardware team's
firmware is ready — point fleet_simulator.py at the real gateway
webhook URL and nothing downstream changes.
"""
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone


CLASSES = ["empty", "solid_trash", "organic_silt", "false_positive"]

# Mode -> (sampling interval seconds) per the brief's System Mode table.
# fleet_simulator uses this to decide how often to tick a node.
MODE_INTERVAL_SECONDS = {
    1: 6 * 3600,    # dry: every 6h (compressed for the demo, see fleet_simulator)
    2: 15 * 60,     # pre-storm: every 15 min
    3: 30,          # active storm: every 30s
}


@dataclass
class SimulatedNode:
    node_id: str
    municipality: str
    latitude: float
    longitude: float
    mode: int = 1
    battery_v: float = 3.60
    basin_full_at_cm: float = 5.0          # distance reading when basin is at overflow
    _distance_cm: float = 45.0              # current distance-to-water/floor
    _blockage_bias: float = field(default_factory=lambda: random.choice([0.05, 0.15, 0.65]))
    _dh_dt: float = 0.0                     # cm/min, positive = water rising

    def set_mode(self, mode: int):
        self.mode = mode
        if mode == 3 and self._dh_dt <= 0:
            # storm just started — water begins rising
            self._dh_dt = round(random.uniform(0.3, 1.8), 2)

    def _simulate_classifier(self) -> dict:
        """Mode 1/2: dry-weather debris classification."""
        p_trash = min(1.0, max(0.0, random.gauss(self._blockage_bias, 0.08)))
        if p_trash > 0.5:
            cls = "solid_trash"
        elif p_trash > 0.3:
            cls = "organic_silt"
        else:
            cls = random.choice(["empty", "false_positive"])
        confidence = round(random.uniform(0.75, 0.97), 2)
        return {"class": cls, "confidence": confidence, "p_trash": round(p_trash, 2)}

    def _simulate_storm_step(self):
        """Mode 3: water level rises according to dh_dt, with some noise."""
        self._dh_dt = max(0.0, self._dh_dt + random.uniform(-0.1, 0.2))
        self._distance_cm = max(0.0, self._distance_cm - self._dh_dt)

    def tick(self) -> dict:
        """Advance the node one sample and return the uplink payload dict."""
        self.battery_v = round(max(3.0, self.battery_v - random.uniform(0.0001, 0.0008)), 3)

        payload = {
            "node_id": self.node_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "mode": self.mode,
            "battery_v": self.battery_v,
            "moisture_switch": self.mode == 3,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "municipality": self.municipality,
        }

        if self.mode in (1, 2):
            payload["distance_cm"] = self._distance_cm
            payload["dh_dt"] = None
            payload["classifier_output"] = self._simulate_classifier()
        else:  # mode 3 — storm
            self._simulate_storm_step()
            payload["distance_cm"] = round(self._distance_cm, 2)
            payload["dh_dt"] = round(self._dh_dt, 2)
            payload["classifier_output"] = None

        return payload

    def reset_storm(self):
        """Call between demo runs so the basin doesn't stay 'flooded'."""
        self._distance_cm = 45.0
        self._dh_dt = 0.0
