"""
Weather sync service.

Polls OpenWeatherMap (or falls back to a mock generator if no API key
is set, so the demo never depends on network access) and writes the
resulting sampling mode into RegionMode. The LoRaWAN downlink job
(not built yet — hardware side) reads RegionMode to know what mode
config to push to nodes in that municipality.

Run this on a schedule in production (APScheduler / cron). For a demo,
call sync_all_regions() directly or hit POST /api/v1/weather/sync.
"""
import random
from datetime import datetime, timezone

import requests
from sqlalchemy.orm import Session

from . import models
from .config import OWM_API_KEY

OWM_URL = "https://api.openweathermap.org/data/3.0/onecall"

# municipality -> (lat, lon), from the target-market list in the brief
MUNICIPALITIES = {
    "Tunis": (36.8065, 10.1815),
    "Sfax": (34.7406, 10.7603),
    "Sousse": (35.8256, 10.6084),
    "Nabeul": (36.4561, 10.7376),
    "Ariana": (36.8625, 10.1956),
}

# Mode thresholds, from the brief's System Mode table
PRE_STORM_RAIN_PROB = 0.60
STORM_RAIN_RATE_MM_H = 2.0


def _fetch_live(lat: float, lon: float) -> dict:
    resp = requests.get(
        OWM_URL,
        params={"lat": lat, "lon": lon, "appid": OWM_API_KEY, "exclude": "minutely,daily,alerts"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    hourly = data.get("hourly", [{}])[0]
    return {
        "rain_probability": hourly.get("pop", 0.0),
        "rain_rate_mm_h": hourly.get("rain", {}).get("1h", 0.0),
    }


def _fetch_mock(lat: float, lon: float) -> dict:
    """No API key set — generate plausible values so the pipeline still runs end to end."""
    return {
        "rain_probability": round(random.uniform(0.0, 1.0), 2),
        "rain_rate_mm_h": round(random.uniform(0.0, 4.0), 2) if random.random() > 0.6 else 0.0,
    }


def determine_mode(rain_probability: float, rain_rate_mm_h: float, moisture_switch_active: bool = False) -> int:
    if moisture_switch_active or rain_rate_mm_h > STORM_RAIN_RATE_MM_H:
        return 3
    if rain_probability > PRE_STORM_RAIN_PROB:
        return 2
    return 1


def sync_region(db: Session, municipality: str, lat: float, lon: float) -> models.RegionMode:
    weather = _fetch_live(lat, lon) if OWM_API_KEY else _fetch_mock(lat, lon)
    mode = determine_mode(weather["rain_probability"], weather["rain_rate_mm_h"])

    region = db.get(models.RegionMode, municipality)
    if region is None:
        region = models.RegionMode(municipality=municipality)
        db.add(region)

    region.mode = mode
    region.rain_probability = weather["rain_probability"]
    region.rain_rate_mm_h = weather["rain_rate_mm_h"]
    region.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(region)
    return region


def sync_all_regions(db: Session) -> list[models.RegionMode]:
    return [sync_region(db, name, lat, lon) for name, (lat, lon) in MUNICIPALITIES.items()]
