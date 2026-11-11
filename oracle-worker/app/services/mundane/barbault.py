"""
BARBAULT — the cyclic index (index cyclique) and planetary-pair analysis.

André Barbault (1921–2019) is the most serious attempt anyone has made to turn mundane
astrology into something with a stated, falsifiable procedure. His proposal is unusually
clean:

    Take the five slow planets — Jupiter, Saturn, Uranus, Neptune, Pluto. Measure the
    angular separation of each of the ten pairs. Add them. That sum is the cyclic index.

A high sum means the slow planets are dispersed around the zodiac; a low sum means they
are clustered. Barbault's claim is that troughs — periods of clustering — coincide with
international crisis, and that peaks coincide with periods of relative settlement.

WHY THIS IS WORTH IMPLEMENTING EXACTLY
──────────────────────────────────────
Almost nothing in mundane astrology can be stated as a formula. This can. The index is
purely geometric, involves no interpretation whatsoever, and two correct implementations
must agree to the decimal. That makes it testable in a way that essentially no other
mundane technique is — and testable is the only property that matters for Level 2.

WHAT THE INDEX DOES NOT ESTABLISH
─────────────────────────────────
That it predicts anything.

The computation is exact; the correlation is not established. Retrospective matching of
troughs to crises is vulnerable to a fatal weakness: at any given moment some crisis is
available to match, and the twentieth century offers no shortage. Barbault's genuine
successes — most famously identifying the 1989 upheaval in the Eastern bloc from the
Saturn–Neptune conjunction, published in advance — sit beside a method that has never been
tested under pre-registered conditions with a defined crisis metric.

So this module computes the index exactly and refuses to interpret it. `troughs()` returns
minima; it does not tell you what they mean. That separation is the whole point of Level 2:
implement the theory faithfully, state its evidential status honestly, and let the pattern
engine test it if anyone wants to.
"""
from itertools import combinations
from typing import Dict, List, Optional, Sequence, Tuple

# The five slow planets. Barbault uses these and only these — the fast bodies would swamp
# the signal with monthly noise.
SLOW_PLANETS = ["jupiter", "saturn", "uranus", "neptune", "pluto"]
PAIRS = list(combinations(SLOW_PLANETS, 2))          # 10 pairs
MAX_INDEX = 180.0 * len(PAIRS)                        # 1800.0
MEAN_INDEX = 90.0 * len(PAIRS)                        # 900.0 — the expectation if random

assert len(PAIRS) == 10


def separation(a: float, b: float) -> float:
    """Angular separation of two longitudes, 0–180°."""
    d = abs(float(a) - float(b)) % 360.0
    return 360.0 - d if d > 180.0 else d


def cyclic_index(longitudes: Dict[str, float]) -> Dict:
    """The index for one moment.

    `longitudes` must contain all five slow planets, keyed by lowercase name."""
    missing = [p for p in SLOW_PLANETS if p not in (longitudes or {})]
    if missing:
        return {"error": f"missing planets: {', '.join(missing)}"}

    pairs = []
    total = 0.0
    for a, b in PAIRS:
        s = separation(longitudes[a], longitudes[b])
        total += s
        pairs.append({"pair": f"{a}-{b}", "separation": round(s, 4)})

    return {
        "index": round(total, 4),
        "of_max": round(100.0 * total / MAX_INDEX, 2),
        "vs_mean": round(total - MEAN_INDEX, 2),
        "clustering": ("clustered" if total < MEAN_INDEX * 0.75 else
                       "dispersed" if total > MEAN_INDEX * 1.25 else "middling"),
        "pairs": sorted(pairs, key=lambda p: p["separation"]),
        "max_possible": MAX_INDEX,
        "mean_expected": MEAN_INDEX,
    }


def series(samples: Sequence[Tuple[str, Dict[str, float]]]) -> Dict:
    """The index across a sequence of (label, longitudes) samples.

    Labels are opaque to this module — pass dates, years, whatever the caller uses."""
    points = []
    for label, lons in samples:
        r = cyclic_index(lons)
        if "error" in r:
            continue
        points.append({"label": label, "index": r["index"],
                       "clustering": r["clustering"]})
    if not points:
        return {"points": [], "error": "no computable samples"}

    values = [p["index"] for p in points]
    return {
        "points": points,
        "count": len(points),
        "min": {"index": min(values),
                "label": points[values.index(min(values))]["label"]},
        "max": {"index": max(values),
                "label": points[values.index(max(values))]["label"]},
        "mean": round(sum(values) / len(values), 2),
    }


def _extrema(series_points: Sequence[Dict], window: int, minima: bool,
             threshold: Optional[float] = None) -> List[Dict]:
    """Local extrema, with flat regions handled honestly.

    The naive rule — "lowest in its neighbourhood" — marks EVERY point of a flat run as a
    trough, because each equals the minimum of a constant window. A saturated series then
    reports a decade of consecutive troughs, which is noise dressed as signal.

    Two corrections: the neighbourhood must actually VARY (a flat window contains no
    extremum), and consecutive qualifying samples are collapsed into one entry spanning
    the run."""
    pts = list(series_points)
    if len(pts) < 3:
        return []

    pick = min if minima else max
    candidates = []
    for i, p in enumerate(pts):
        # Skip the edges. A point within `window` of either end has a truncated
        # neighbourhood, so a rising tail's last sample qualifies as a "minimum" purely
        # because nothing after it was sampled. That is not a trough, it is the end of the
        # data, and reporting it as one invents an event.
        if i < window or i >= len(pts) - window:
            continue
        lo, hi = i - window, i + window + 1
        hood = [q["index"] for q in pts[lo:hi]]
        if max(hood) == min(hood):
            continue                      # flat — no extremum here
        if p["index"] != pick(hood):
            continue
        if threshold is not None:
            if minima and p["index"] > threshold:
                continue
            if not minima and p["index"] < threshold:
                continue
        candidates.append(i)

    # Collapse consecutive indices into a single run.
    out, run = [], []
    for i in candidates + [None]:
        if run and (i is None or i != run[-1] + 1):
            first, last = pts[run[0]], pts[run[-1]]
            entry = {
                "label": first["label"],
                "index": first["index"],
                "span": ([first["label"]] if len(run) == 1
                         else [first["label"], last["label"]]),
                "samples": len(run),
            }
            if minima:
                entry["depth_below_mean"] = round(MEAN_INDEX - first["index"], 2)
            else:
                entry["height_above_mean"] = round(first["index"] - MEAN_INDEX, 2)
            out.append(entry)
            run = []
        if i is not None:
            run.append(i)
    return out


def troughs(series_points: Sequence[Dict], window: int = 2,
            depth_threshold: Optional[float] = None) -> List[Dict]:
    """Local minima — the clustered periods Barbault reads as crisis.

    Returns POSITIONS ONLY. This function deliberately attaches no meaning to them; the
    interpretive claim is Barbault's, not the platform's, and it is not established."""
    return _extrema(series_points, window, minima=True, threshold=depth_threshold)


def peaks(series_points: Sequence[Dict], window: int = 2,
          height_threshold: Optional[float] = None) -> List[Dict]:
    """Local maxima — the dispersed periods Barbault reads as settlement."""
    return _extrema(series_points, window, minima=False, threshold=height_threshold)


# ═══════════════════════════════════════════════════════════════════════════
# PAIR CYCLES — the other half of Barbault's method
# ═══════════════════════════════════════════════════════════════════════════
# Barbault read individual slow-planet pairs as carrying distinct mundane themes, and the
# conjunction of a pair as opening a cycle whose phases he tracked. The theme attributions
# below are HIS, recorded as his position; they are not derived from anything and the
# platform makes no claim for them.

PAIR_THEMES = {
    "jupiter-saturn": ("~20 years", "the social and political order — the basic rhythm of "
                                    "governments and economic cycles"),
    "jupiter-uranus": ("~14 years", "technical and scientific breakthrough; sudden expansion"),
    "jupiter-neptune": ("~13 years", "ideological enthusiasm, speculation, collective belief"),
    "jupiter-pluto": ("~13 years", "concentration of wealth and power; finance and its crises"),
    "saturn-uranus": ("~45 years", "the collision of established order with the pressure to "
                                   "break it — reform against reaction"),
    "saturn-neptune": ("~36 years", "the dissolution of structures; ideological collapse. "
                                    "Barbault read the 1989 conjunction as marking the end "
                                    "of Soviet communism, published in advance — his most "
                                    "cited result."),
    "saturn-pluto": ("~33 years", "crisis of authority, hard confrontation, war"),
    "uranus-neptune": ("~171 years", "epochal shifts in collective outlook"),
    "uranus-pluto": ("~127 years", "revolutionary rupture"),
    "neptune-pluto": ("~492 years", "the deepest civilisational cycle; too slow to observe "
                                    "more than a fraction of"),
}


def pair_cycle(planet_a: str, planet_b: str, lon_a: float, lon_b: float) -> Dict:
    """Where a slow-planet pair stands in its cycle."""
    a, b = sorted([planet_a.lower(), planet_b.lower()])
    key = f"{a}-{b}"
    if key not in PAIR_THEMES:
        # try the original order
        key = f"{planet_a.lower()}-{planet_b.lower()}"
    period, theme = PAIR_THEMES.get(key, ("unknown", ""))

    sep = separation(lon_a, lon_b)
    # signed elongation tells us whether we are before or after the opposition
    raw = (float(lon_b) - float(lon_a)) % 360.0
    if raw < 30:
        phase = "conjunction — the cycle opens"
    elif raw < 90:
        phase = "waxing — the cycle's initiative builds"
    elif raw < 150:
        phase = "first square passed — resistance meets the initiative"
    elif raw < 210:
        phase = "opposition — the cycle's full exposure, its crisis of visibility"
    elif raw < 270:
        phase = "waning — consequences work themselves out"
    elif raw < 330:
        phase = "last square — the old form breaks down"
    else:
        phase = "balsamic — the cycle closes, the next is near"

    return {
        "pair": key, "period": period, "theme": theme,
        "separation": round(sep, 4), "elongation": round(raw, 4),
        "phase": phase,
        "attribution": ("The thematic reading is Barbault's own. It is recorded as his "
                        "position and is not a claim this platform makes."),
    }


def all_pairs(longitudes: Dict[str, float]) -> List[Dict]:
    """Every slow-planet pair's cycle position."""
    out = []
    for a, b in PAIRS:
        if a in longitudes and b in longitudes:
            out.append(pair_cycle(a, b, longitudes[a], longitudes[b]))
    return out


def summary(r: Dict) -> str:
    if not r or "error" in r:
        return ""
    tight = r["pairs"][0]
    return "\n".join([
        f"BARBAULT CYCLIC INDEX — {r['index']:.1f} of {r['max_possible']:.0f} "
        f"({r['of_max']:.1f}%), {r['clustering']}",
        f"  {r['vs_mean']:+.1f} against the {r['mean_expected']:.0f} random expectation",
        f"  tightest pair: {tight['pair']} at {tight['separation']:.2f}°",
        "  MUNDANE scope only — the index is exactly computable; that it tracks anything "
        "is a separate claim and is not established.",
    ])


# Anchors: five planets stacked on one degree give the minimum, evenly spread gives more.
assert cyclic_index({p: 0.0 for p in SLOW_PLANETS})["index"] == 0.0
assert separation(0.0, 180.0) == 180.0 and separation(350.0, 10.0) == 20.0
