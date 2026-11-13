"""
BRADLEY — the siderograph (the "planetary barometer").

Donald Bradley (1925–1974), who also published as Garth Allen, worked at Llewellyn and
proposed in 1948 a single numerical curve derived from planetary aspects, intended to
anticipate turning points in equity markets.

The siderograph matters to a research layer for one reason that has nothing to do with
markets: it is **falsifiable against a public dataset**. Almost every claim in this
platform can only be tested against outcomes that are vague, self-reported, or retro-
fitted. A curve that claims to anticipate turning points in an index has a ground truth
sitting in a price series that nobody can argue with afterwards. If it works it can be
shown to work; if it does not, that too is demonstrable.

Bradley himself was clear-eyed about it. He warned that the siderograph indicates the
TIMING of turns and not their direction, and that treating it as a buy signal was a
misuse — a caveat that essentially every subsequent commercial reseller of the method has
dropped.

CONSTRUCTION, AND WHY THE WEIGHTS ARE PARAMETERS
────────────────────────────────────────────────
The curve is a weighted sum of aspect "potentials" between planet pairs. Each pair's
contribution peaks at exact aspect and falls off with orb, and the pairs are grouped into
long-, middle- and short-term components which are then combined.

Published reconstructions of the exact weighting table DIFFER. Bradley's original
description leaves several coefficients underdetermined, and the versions circulating in
commercial software are not identical to each other. So the weights here are explicit
parameters with a documented default set rather than hidden constants — a caller with a
different reconstruction supplies it and gets that reconstruction's curve, and the output
records which was used.

Anyone testing this must fix the weights BEFORE looking at price data. A curve whose
coefficients were tuned against the series it is meant to predict has predicted nothing.
"""
import math
from itertools import combinations
from typing import Dict, List, Optional, Sequence, Tuple

# Bradley grouped the bodies by speed; the groups carry different weights because a slow
# pair's aspect persists for months while a Moon aspect lasts hours.
LONG_TERM = ["jupiter", "saturn", "uranus", "neptune", "pluto"]
MIDDLE_TERM = ["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]
SHORT_TERM = ["sun", "mercury", "venus", "mars"]

# Aspect harmonics and their default weights. The value of an aspect at separation θ is
# w · cos(n·θ), which peaks at exact aspect and decays smoothly — a harmonic formulation
# rather than a hard orb cutoff.
DEFAULT_HARMONICS: Dict[int, float] = {
    1: 1.00,    # conjunction / opposition axis
    2: 0.75,    # squares
    3: 0.50,    # trines
    6: 0.25,    # sextiles
}

DEFAULT_GROUP_WEIGHTS = {"long": 1.0, "middle": 0.6, "short": 0.3}

# Bradley weighted pairs involving the outer planets more heavily. Pairs not listed take
# the group default.
DEFAULT_PAIR_WEIGHTS: Dict[str, float] = {
    "jupiter-saturn": 1.5,
    "jupiter-uranus": 1.2,
    "saturn-uranus": 1.3,
    "saturn-neptune": 1.2,
    "saturn-pluto": 1.3,
    "uranus-pluto": 1.1,
}


def _sep(a: float, b: float) -> float:
    d = abs(float(a) - float(b)) % 360.0
    return 360.0 - d if d > 180.0 else d


def _pair_key(a: str, b: str) -> str:
    return "-".join(sorted([a, b]))


def aspect_potential(sep_degrees: float,
                     harmonics: Optional[Dict[int, float]] = None) -> float:
    """The harmonic potential of one separation.

    Sum of w·cos(n·θ) over the configured harmonics. Peaks at conjunction, dips at the
    hard aspects, and decays smoothly rather than switching off at an orb boundary."""
    h = harmonics or DEFAULT_HARMONICS
    rad = math.radians(float(sep_degrees))
    return sum(w * math.cos(n * rad) for n, w in h.items())


def component(longitudes: Dict[str, float], bodies: Sequence[str],
              harmonics: Optional[Dict[int, float]] = None,
              pair_weights: Optional[Dict[str, float]] = None) -> Dict:
    """One speed-group's contribution."""
    pw = pair_weights if pair_weights is not None else DEFAULT_PAIR_WEIGHTS
    present = [b for b in bodies if b in (longitudes or {})]
    terms = []
    total = 0.0
    for a, b in combinations(present, 2):
        key = _pair_key(a, b)
        sep = _sep(longitudes[a], longitudes[b])
        pot = aspect_potential(sep, harmonics)
        w = pw.get(key, 1.0)
        val = w * pot
        total += val
        terms.append({"pair": key, "separation": round(sep, 3),
                      "potential": round(pot, 5), "weight": w,
                      "contribution": round(val, 5)})
    return {"total": round(total, 5), "pairs": len(terms),
            "terms": sorted(terms, key=lambda t: -abs(t["contribution"]))}


def siderograph(longitudes: Dict[str, float],
                harmonics: Optional[Dict[int, float]] = None,
                group_weights: Optional[Dict[str, float]] = None,
                pair_weights: Optional[Dict[str, float]] = None) -> Dict:
    """The combined curve value for one moment."""
    gw = group_weights or DEFAULT_GROUP_WEIGHTS
    long_c = component(longitudes, LONG_TERM, harmonics, pair_weights)
    mid_c = component(longitudes, MIDDLE_TERM, harmonics, pair_weights)
    short_c = component(longitudes, SHORT_TERM, harmonics, pair_weights)

    combined = (gw.get("long", 1.0) * long_c["total"]
                + gw.get("middle", 0.6) * mid_c["total"]
                + gw.get("short", 0.3) * short_c["total"])

    return {
        "siderograph": round(combined, 5),
        "components": {"long": long_c, "middle": mid_c, "short": short_c},
        "weights_used": {"harmonics": harmonics or DEFAULT_HARMONICS,
                         "groups": gw,
                         "pairs": pair_weights if pair_weights is not None
                         else DEFAULT_PAIR_WEIGHTS},
        "reading": ("Bradley read TURNING POINTS in the curve, not its level, and stated "
                    "explicitly that it indicates the timing of a reversal and not its "
                    "direction. Reading it as a buy or sell signal is a misuse he warned "
                    "against."),
    }


def series(samples: Sequence[Tuple[str, Dict[str, float]]], **kw) -> Dict:
    """The curve across a sequence of (label, longitudes) samples."""
    points = []
    for label, lons in samples:
        r = siderograph(lons, **kw)
        points.append({"label": label, "value": r["siderograph"]})
    if not points:
        return {"points": [], "error": "no samples"}
    vals = [p["value"] for p in points]
    return {"points": points, "count": len(points),
            "min": min(vals), "max": max(vals),
            "mean": round(sum(vals) / len(vals), 5)}


def turning_points(series_points: Sequence[Dict], window: int = 3) -> List[Dict]:
    """Local extrema — what Bradley actually read.

    Excludes the series edges, where a truncated window makes the last sample of a trend
    look like a turn, and requires the neighbourhood to vary so a flat run yields nothing.
    Same discipline as the Barbault module, for the same reasons."""
    pts = list(series_points)
    out = []
    for i in range(window, len(pts) - window):
        hood = [q["value"] for q in pts[i - window:i + window + 1]]
        if max(hood) == min(hood):
            continue
        v = pts[i]["value"]
        if v == max(hood):
            kind = "peak"
        elif v == min(hood):
            kind = "trough"
        else:
            continue
        if out and out[-1]["label"] == pts[i - 1]["label"]:
            continue
        out.append({"label": pts[i]["label"], "value": round(v, 5), "kind": kind,
                    "note": "a turn in timing only — the curve does not give direction"})
    return out


TESTABILITY = {
    "why_it_matters": ("Uniquely among the methods in this registry, the siderograph makes "
                       "a claim checkable against a public dataset with an undisputed "
                       "ground truth. Market turning points are recorded, dated and not "
                       "open to reinterpretation after the fact."),
    "how_to_test_honestly": [
        "Fix the weights BEFORE looking at any price series. Coefficients tuned against "
        "the data they are meant to predict have predicted nothing.",
        "Pre-register what counts as a turning point in the index — a percentage "
        "reversal within a stated window — before running the comparison.",
        "Compare against a null built by shuffling the curve's dates, not against a flat "
        "expectation: the curve is autocorrelated and will match a trending series by "
        "chance more often than a naive test assumes.",
        "Report the result whichever way it falls. A negative here is a genuine finding "
        "and more informative than most positives elsewhere in this registry.",
    ],
    "status": ("Not established. Independent tests published in the finance literature "
               "have not supported the siderograph, and the commercial versions in "
               "circulation differ enough from each other that 'the' siderograph is not "
               "a single well-defined object."),
}


def summary(r: Dict) -> str:
    if not r:
        return ""
    c = r["components"]
    return "\n".join([
        f"BRADLEY SIDEROGRAPH — {r['siderograph']:+.4f}",
        f"  long {c['long']['total']:+.3f} · middle {c['middle']['total']:+.3f} · "
        f"short {c['short']['total']:+.3f}",
        f"  {r['reading']}",
    ])


# Anchors: exact conjunction maximises the potential; the harmonic sum is symmetric.
assert aspect_potential(0.0) == sum(DEFAULT_HARMONICS.values())
assert abs(aspect_potential(10.0) - aspect_potential(-10.0)) < 1e-12
assert _sep(350.0, 10.0) == 20.0
