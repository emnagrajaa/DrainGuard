"""
Runs a fleet of simulated DrainGuard nodes and posts their uplinks to
the cloud ingestion API, standing in for the LoRaWAN gateway.

Usage:
    # dry-day baseline, a few nodes flagged with debris
    python -m edge_simulator.fleet_simulator --scenario dry --ticks 5

    # live storm demo: ramps dry -> pre-storm -> storm across the fleet,
    # good for the pitch — run this and watch the dashboard/alerts update
    python -m edge_simulator.fleet_simulator --scenario storm --tick-seconds 2

Point --api-url at a real LoRaWAN gateway webhook later; nothing else
in the pipeline needs to change.
"""
import argparse
import time
import sys

import requests

from .node import SimulatedNode

# node_id -> (municipality, lat, lon) — sampled points across the target
# municipalities named in the brief (Tunis, Sfax, Sousse, Nabeul, Ariana)
FLEET_LAYOUT = [
    ("TUN-TUNIS-001", "Tunis", 36.8065, 10.1815),
    ("TUN-TUNIS-002", "Tunis", 36.8100, 10.1700),
    ("TUN-TUNIS-003", "Tunis", 36.7990, 10.1950),
    ("TUN-ARIANA-004", "Ariana", 36.8625, 10.1956),
    ("TUN-ARIANA-005", "Ariana", 36.8580, 10.2050),
    ("TUN-SFAX-006", "Sfax", 34.7406, 10.7603),
    ("TUN-SFAX-007", "Sfax", 34.7450, 10.7550),
    ("TUN-SOUSSE-008", "Sousse", 35.8256, 10.6084),
    ("TUN-SOUSSE-009", "Sousse", 35.8300, 10.6120),
    ("TUN-NABEUL-010", "Nabeul", 36.4561, 10.7376),
]


def build_fleet() -> list[SimulatedNode]:
    return [
        SimulatedNode(node_id=nid, municipality=muni, latitude=lat, longitude=lon)
        for nid, muni, lat, lon in FLEET_LAYOUT
    ]


def post_payload(api_url: str, payload: dict, timeout: float = 5.0) -> bool:
    try:
        resp = requests.post(f"{api_url}/api/v1/ingest", json=payload, timeout=timeout)
        resp.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"  [!] failed to post {payload['node_id']}: {e}", file=sys.stderr)
        return False


def run_dry_scenario(fleet, api_url, ticks):
    print(f"Running DRY scenario: {ticks} ticks across {len(fleet)} nodes")
    for t in range(ticks):
        for node in fleet:
            node.set_mode(1)
            payload = node.tick()
            ok = post_payload(api_url, payload)
            flag = payload["classifier_output"]["class"] if payload["classifier_output"] else "-"
            print(f"  tick {t+1}: {node.node_id:<16} class={flag:<14} {'ok' if ok else 'FAILED'}")
        time.sleep(0.3)


def run_storm_scenario(fleet, api_url, tick_seconds, pre_storm_ticks=3, storm_ticks=8):
    print(f"Running STORM scenario across {len(fleet)} nodes "
          f"({pre_storm_ticks} pre-storm ticks -> {storm_ticks} storm ticks)")

    print("\n-- Mode 1: dry baseline --")
    for node in fleet:
        node.set_mode(1)
        post_payload(api_url, node.tick())
    time.sleep(tick_seconds)

    print("-- Mode 2: pre-storm alert (rain forecast >60% within 12h) --")
    for t in range(pre_storm_ticks):
        for node in fleet:
            node.set_mode(2)
            payload = node.tick()
            ok = post_payload(api_url, payload)
            print(f"  tick {t+1}: {node.node_id:<16} mode=2 {'ok' if ok else 'FAILED'}")
        time.sleep(tick_seconds)

    print("-- Mode 3: active storm (30s sampling, water rising) --")
    for t in range(storm_ticks):
        for node in fleet:
            node.set_mode(3)
            payload = node.tick()
            ok = post_payload(api_url, payload)
            print(f"  tick {t+1}: {node.node_id:<16} dh_dt={payload['dh_dt']:<5} "
                  f"dist={payload['distance_cm']:<6} {'ok' if ok else 'FAILED'}")
        time.sleep(tick_seconds)

    print("\nStorm scenario complete — check GET /api/v1/alerts for overflow warnings.")


def main():
    parser = argparse.ArgumentParser(description="DrainGuard edge fleet simulator")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--scenario", choices=["dry", "storm"], default="dry")
    parser.add_argument("--ticks", type=int, default=5, help="number of ticks for the dry scenario")
    parser.add_argument("--tick-seconds", type=float, default=1.5, help="delay between ticks in the storm scenario")
    args = parser.parse_args()

    fleet = build_fleet()

    if args.scenario == "dry":
        run_dry_scenario(fleet, args.api_url, args.ticks)
    else:
        run_storm_scenario(fleet, args.api_url, args.tick_seconds)


if __name__ == "__main__":
    main()
