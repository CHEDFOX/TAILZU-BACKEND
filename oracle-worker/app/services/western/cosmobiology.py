"""
COSMOBIOLOGY (Reinhold Ebertin) — the 90° dial and midpoint trees.

Ebertin's project, from the 1920s onward, was to strip astrology down to what could be
stated precisely and tested. He threw out the houses, the sign rulerships, the minor
aspects and most of the symbolic apparatus, and kept two things: MIDPOINTS, and the hard
aspects. What remained he published in 1940 as *Kombination der Gestirneinflüsse* — a
dictionary of some 800 midpoint combinations, each given a terse behavioural reading.

That austerity is why cosmobiology matters to a platform with a research layer. Ebertin
reduced the interpretive surface deliberately, so that what was left could be checked. He
also collaborated on statistical work and was one of the few practitioners of his era who
took disconfirmation seriously.

THE 90° DIAL
────────────
The distinctive instrument. Every longitude is reduced modulo 90, which collapses the
conjunction, square and opposition into a single position. Two planets 90° apart in the
zodiac land on the same point of the dial. The claim is that the hard aspects are one
phenomenon at different scales, so they should be read as one — and the dial makes that
visible at a glance instead of requiring an aspect grid.

MIDPOINT TREES
──────────────
For any point, the list of midpoints it sits on. Written `Sun = Mars/Saturn`, meaning the
Sun occupies the halfway point between Mars and Saturn and therefore expresses both.

Orbs are TIGHT — Ebertin worked to about 1°30' on the 90° dial, which is a real constraint
rather than a stylistic one. Loosen it and every planet sits on a dozen midpoints, the
tree becomes noise, and the method's whole claim to precision evaporates. That is the most
common way cosmobiology is misapplied, and this module keeps the default tight.
"""
from itertools import combinations
from typing import Dict, List, Tuple

DIAL = 90.0
DEFAULT_ORB = 1.5      # degrees on the 90° dial — Ebertin's working tolerance


def _norm(d: float) -> float:
    return float(d) % 360.0


def to_dial(longitude: float, dial: float = DIAL) -> float:
    """Reduce a longitude onto the dial. On the 90° dial, conjunction, square and
    opposition all land on the same point."""
    return _norm(longitude) % dial


def dial_positions(longitudes: Dict[str, float], dial: float = DIAL) -> Dict:
    """Every body's place on the dial, and which of them cluster."""
    pos = {k: round(to_dial(v, dial), 4) for k, v in (longitudes or {}).items()}
    clusters = []
    items = sorted(pos.items(), key=lambda kv: kv[1])
    for i, (a, pa) in enumerate(items):
        for b, pb in items[i + 1:]:
            sep = abs(pa - pb)
            sep = min(sep, dial - sep)
            if sep <= DEFAULT_ORB:
                clusters.append({"bodies": [a, b], "separation_on_dial": round(sep, 4),
                                 "note": "conjunct on the dial — a hard aspect in the "
                                         "zodiac, of whichever order"})
    return {"dial": dial, "positions": pos, "contacts": clusters,
            "reading": ("Bodies together on the dial are in hard aspect — conjunction, "
                        "square or opposition. Cosmobiology reads these as one family "
                        "rather than three.")}


def midpoint(a: float, b: float) -> Tuple[float, float]:
    """The near and far midpoints of two longitudes.

    Two points exist, 180° apart. On the 90° dial they coincide, which is one of the
    reasons Ebertin preferred the dial."""
    a, b = _norm(a), _norm(b)
    d = (b - a) % 360.0
    near = _norm(a + d / 2.0)
    return near, _norm(near + 180.0)


def midpoint_tree(longitudes: Dict[str, float], orb: float = DEFAULT_ORB,
                  dial: float = DIAL) -> Dict:
    """For each body, the midpoints it occupies — its tree.

    Read as `body = A/B`: the body sits where A and B meet, and expresses both."""
    lons = dict(longitudes or {})
    names = list(lons)
    trees: Dict[str, List[Dict]] = {n: [] for n in names}

    for a, b in combinations(names, 2):
        near, _far = midpoint(lons[a], lons[b])
        mp_dial = to_dial(near, dial)
        for c in names:
            if c in (a, b):
                continue
            sep = abs(to_dial(lons[c], dial) - mp_dial)
            sep = min(sep, dial - sep)
            if sep <= orb:
                trees[c].append({
                    "pair": f"{a}/{b}", "a": a, "b": b,
                    "orb": round(sep, 4),
                    "notation": f"{c} = {a}/{b}",
                    "meaning": combination_meaning(a, b, c),
                })

    for n in trees:
        trees[n].sort(key=lambda x: x["orb"])

    return {
        "orb_used": orb, "dial": dial,
        "trees": {k: v for k, v in trees.items() if v},
        "empty": [k for k, v in trees.items() if not v],
        "caution": ("Orbs are tight by design. Ebertin worked to about 1°30' on the 90° "
                    "dial. Loosening it makes every body sit on a dozen midpoints, the "
                    "trees become noise, and the method's claim to precision is lost — "
                    "which is the usual way cosmobiology is misapplied."),
    }


# A small set of Ebertin's readings, kept deliberately terse in his own register. These
# are HIS attributions, recorded as such; the platform asserts nothing about them.
_COMBINATIONS = {
    frozenset(["sun", "moon"]): "the union of the conscious and instinctive natures; a bond",
    frozenset(["sun", "saturn"]): "restraint, endurance, separation; effort against resistance",
    frozenset(["sun", "mars"]): "applied force, decisiveness, the will to act",
    frozenset(["mars", "saturn"]): "the death axis in Ebertin's terms — obstructed force, "
                                   "hard endurance, destructive discipline",
    frozenset(["venus", "mars"]): "attraction and its expression; the erotic axis",
    frozenset(["venus", "saturn"]): "restraint in affection; loyalty, or its denial",
    frozenset(["jupiter", "saturn"]): "the balance of expansion against limit; slow building",
    frozenset(["mercury", "uranus"]): "sudden insight, quick invention, nervous excitability",
    frozenset(["moon", "neptune"]): "sensitivity, receptivity, susceptibility to impression",
    frozenset(["sun", "uranus"]): "abrupt change of direction; the reformer's temperament",
    frozenset(["mars", "uranus"]): "sudden decisive action; accident-prone under stress",
    frozenset(["saturn", "pluto"]): "hard transformation, endurance under extreme pressure",
    frozenset(["jupiter", "uranus"]): "fortunate breakthrough, the sudden opening",
    frozenset(["moon", "saturn"]): "emotional restraint, loneliness, the disciplined feeling",
}


def combination_meaning(a: str, b: str, activator: str = "") -> str:
    m = _COMBINATIONS.get(frozenset([a.lower(), b.lower()]))
    if not m:
        return ""
    if activator:
        return f"{activator} expressed through: {m}"
    return m


def sensitive_points(longitudes: Dict[str, float], target: float,
                     orb: float = DEFAULT_ORB, dial: float = DIAL) -> List[Dict]:
    """Which midpoints a given degree activates — used for transits and directions.

    A transiting body crossing a natal midpoint is the event cosmobiology reads; the
    midpoint tree is the map, this is the trigger."""
    lons = dict(longitudes or {})
    t = to_dial(target, dial)
    out = []
    for a, b in combinations(list(lons), 2):
        near, _ = midpoint(lons[a], lons[b])
        sep = abs(to_dial(near, dial) - t)
        sep = min(sep, dial - sep)
        if sep <= orb:
            out.append({"pair": f"{a}/{b}", "orb": round(sep, 4),
                        "meaning": combination_meaning(a, b)})
    return sorted(out, key=lambda x: x["orb"])


def summary(tree: Dict, body: str = "sun") -> str:
    t = (tree.get("trees") or {}).get(body)
    if not t:
        return f"COSMOBIOLOGY — no midpoints on {body} within {tree.get('orb_used')}°"
    lines = [f"COSMOBIOLOGY — {body} midpoint tree "
             f"(90° dial, orb {tree.get('orb_used')}°)"]
    for e in t[:8]:
        m = f" — {e['meaning']}" if e["meaning"] else ""
        lines.append(f"  {e['notation']}  (orb {e['orb']:.2f}°){m}")
    return "\n".join(lines)


# Anchors: 0° and 90° and 180° and 270° all collapse to the same dial position.
assert to_dial(0.0) == to_dial(90.0) == to_dial(180.0) == to_dial(270.0) == 0.0
# The midpoint of 0° and 90° is 45°.
assert abs(midpoint(0.0, 90.0)[0] - 45.0) < 1e-9
# The two midpoints are always 180° apart.
_n, _f = midpoint(10.0, 200.0)
assert abs(((_f - _n) % 360.0) - 180.0) < 1e-9
