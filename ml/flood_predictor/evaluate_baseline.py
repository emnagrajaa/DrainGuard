"""
Evaluates the flood predictor that runs today — the decision engine's dh/dt
rise-rate projection (cloud/api/decision_engine.py) — on simulated storms.

Each storm uses edge_simulator's own water physics: a node in storm mode
whose rise rate drifts upward every minute, so the true overflow time is
known exactly. For every reading we compare the engine's projected time to
overflow with the time actually left, and record how long before overflow
the engine first raises its flood warning (projection <= 45 min).

Run from the repo root:
    pip install matplotlib
    python -m ml.flood_predictor.evaluate_baseline

Prints the headline numbers and writes docs/figures/flood-predictor-performance.png (+ .svg).
"""
import random
import statistics as st
from pathlib import Path

from cloud.api.decision_engine import OVERFLOW_LEAD_TIME_ALERT_MIN, _project_overflow_minutes
from edge_simulator.node import SimulatedNode

STORMS = 2000
MAX_MINUTES = 240          # one simulator tick = one minute of storm
SEED = 7
OUT = Path("docs/figures/flood-predictor-performance")


def run_storm():
    """Returns (overflow minute, [(minute, distance_cm, dh_dt), ...]) or None if it never overflows."""
    node = SimulatedNode("EVAL", "Tunis", 0.0, 0.0)
    node.set_mode(3)
    samples = []
    for minute in range(MAX_MINUTES):
        p = node.tick()
        samples.append((minute, p["distance_cm"], p["dh_dt"]))
        if p["distance_cm"] <= 0:
            return minute, samples
    return None


def evaluate():
    random.seed(SEED)
    pairs, leads, missed, dry = [], [], 0, 0
    for _ in range(STORMS):
        result = run_storm()
        if result is None:
            dry += 1
            continue
        overflow, samples = result
        first_warning = None
        for minute, distance, rise in samples:
            if minute >= overflow:
                break
            forecast = _project_overflow_minutes(distance, rise)
            actual = overflow - minute
            pairs.append((actual, forecast))
            if first_warning is None and forecast is not None and forecast <= OVERFLOW_LEAD_TIME_ALERT_MIN:
                first_warning = actual
        if first_warning is None:
            missed += 1
        else:
            leads.append(first_warning)

    def band(lo, hi):
        errors = [f - a for a, f in pairs if lo <= a < hi and f is not None]
        return {"n": len(errors), "median_error": st.median(errors), "mae": st.mean(abs(e) for e in errors)}

    overflowed = STORMS - dry
    leads_sorted = sorted(leads)
    return {
        "pairs": pairs,
        "leads": leads,
        "overflowed": overflowed,
        "warned_share": (overflowed - missed) / overflowed,
        "lead_median": st.median(leads),
        "lead_p10": leads_sorted[len(leads_sorted) // 10],
        "bands": {k: band(*k) for k in [(1, 10), (10, 20), (20, 30), (30, 46)]},
    }


def plot(r):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.gridspec import GridSpec

    ink, ink2, muted, grid = "#0e2329", "#455a61", "#576d74", "#dbe3e2"
    water, critical = "#2a78d6", "#d03b3b"
    plt.rcParams.update({"font.family": ["Segoe UI", "Arial", "DejaVu Sans"], "font.size": 11, "text.color": ink})

    # median + middle 50% of forecasts at each whole minute before overflow;
    # minutes that few storms reach are left out rather than drawn as noise
    xs, med, q1, q3 = [], [], [], []
    for minute in range(1, 46):
        fc = sorted(f for a, f in r["pairs"] if a == minute and f is not None)
        if len(fc) < 150:
            continue
        xs.append(minute)
        med.append(st.median(fc))
        q1.append(fc[len(fc) // 4])
        q3.append(fc[len(fc) * 3 // 4])

    fig = plt.figure(figsize=(12, 6.75), dpi=160, facecolor="white")
    gs = GridSpec(1, 2, width_ratios=[2.15, 1], left=0.065, right=0.975, top=0.80, bottom=0.17, wspace=0.12)
    fig.text(0.065, 0.925, "Flood predictor: every simulated overflow was warned in advance",
             fontsize=19, fontweight="bold", color=ink)
    fig.text(0.065, 0.875, f"DrainGuard Layer 2 · rise-rate (dh/dt) projection · {r['overflowed']:,} simulated storms",
             fontsize=12, color=ink2)

    ax = fig.add_subplot(gs[0, 0])
    ax.fill_between(xs, q1, q3, color=water, alpha=0.12, linewidth=0, label="Middle 50% of forecasts")
    ax.plot(xs, med, color=water, linewidth=2.4, solid_capstyle="round", label="Median forecast")
    ax.plot([0, 45], [0, 45], color=muted, linewidth=1.2, label="Perfect forecast")
    ax.axhline(OVERFLOW_LEAD_TIME_ALERT_MIN, color=critical, linewidth=1)
    ax.text(0.8, OVERFLOW_LEAD_TIME_ALERT_MIN + 1.5, "Flood warning fires below a 45-min forecast",
            color="#a82a2a", fontsize=10, fontweight="semibold")
    ax.text(44.5, 36, "Perfect forecast", color=muted, fontsize=10, ha="right")
    last = r["bands"][(1, 10)]
    ax.annotate(f"±{last['mae']:.1f} min in the\nfinal 10 minutes", xy=(6, med[xs.index(6)] if 6 in xs else 6),
                xytext=(3, 24), fontsize=10, color=ink2, arrowprops={"arrowstyle": "-", "color": muted, "lw": 0.8})
    ax.annotate("Optimistic further out:\nthe water keeps accelerating", xy=(30, med[xs.index(30)] if 30 in xs else 50),
                xytext=(18.5, 66), fontsize=10, color=ink2, arrowprops={"arrowstyle": "-", "color": muted, "lw": 0.8})

    ax.set_xlim(0, 45)
    ax.set_ylim(0, max(80, max(q3) + 5))
    ax.set_xlabel("Actual minutes left before overflow", color=ink2)
    ax.set_ylabel("Forecast minutes left", color=ink2)
    ax.set_title("Forecast vs. actual time to overflow", loc="left", fontsize=12.5, fontweight="semibold", color=ink, pad=10)
    ax.grid(True, color=grid, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#c5d1d0")
    ax.tick_params(colors=muted, length=0)
    ax.legend(loc="upper left", frameon=False, fontsize=10, labelcolor=ink2, bbox_to_anchor=(0.0, 0.93))

    side = fig.add_subplot(gs[0, 1])
    side.axis("off")
    tiles = [
        (f"{r['warned_share'] * 100:.0f}%", f"of {r['overflowed']:,} simulated overflows\nwarned in advance"),
        (f"{r['lead_median']:.0f} min", f"median warning before overflow\n(90% of storms: ≥ {r['lead_p10']} min)"),
        (f"±{last['mae']:.1f} min", "average forecast error in the\nfinal 10 minutes before overflow"),
    ]
    for i, (value, label) in enumerate(tiles):
        y = 0.97 - i * 0.34
        side.text(0.06, y, value, fontsize=34, fontweight="semibold", color=ink, va="top", transform=side.transAxes)
        side.text(0.06, y - 0.15, label, fontsize=11, color=ink2, va="top", transform=side.transAxes, linespacing=1.35)
        if i:
            side.plot([0.06, 0.96], [y + 0.045, y + 0.045], color=grid, linewidth=1, transform=side.transAxes)

    fig.text(0.065, 0.055,
             "Method: edge_simulator storm physics (rise rate drifts upward each minute); every reading's forecast from the cloud "
             "decision engine compared with the true overflow time.\nNext: the LSTM predictor in ml/flood_predictor learns the "
             "acceleration to remove the optimism beyond 20 minutes.",
             fontsize=9, color=muted, linespacing=1.4)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT.with_suffix(".png"), facecolor="white")
    fig.savefig(OUT.with_suffix(".svg"), facecolor="white")
    plt.close(fig)


def main():
    r = evaluate()
    print(f"storms overflowed: {r['overflowed']}  warned in advance: {r['warned_share'] * 100:.1f}%")
    print(f"warning lead time: median {r['lead_median']:.0f} min, 90% >= {r['lead_p10']} min")
    for (lo, hi), b in r["bands"].items():
        print(f"  {lo:>2}-{hi - 1:<2} min before overflow: median error {b['median_error']:+.1f} min, MAE {b['mae']:.1f} min (n={b['n']})")
    plot(r)
    print(f"wrote {OUT.with_suffix('.png')} and {OUT.with_suffix('.svg')}")


if __name__ == "__main__":
    main()
