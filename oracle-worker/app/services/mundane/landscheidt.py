"""
LANDSCHEIDT — solar barycentric motion and the torque cycles.

Theodor Landscheidt (1927–2004) occupies an unusual position in this registry: the thing
he computed is **uncontested Newtonian mechanics**, and only his interpretation of it is
disputed.

The mechanics. The Sun does not sit still at the centre of the solar system. It orbits the
system's barycentre, which is dragged around chiefly by Jupiter and Saturn. The excursion
is not small — the barycentre can lie more than a solar radius outside the Sun's surface,
so the Sun genuinely loops around a point in empty space. This is not a theory. It follows
from Newton and it is computed here exactly as any orbital-mechanics text would compute it.

The interpretation. Landscheidt argued that the RATE OF CHANGE of the Sun's orbital
angular momentum about the barycentre modulates solar activity — that torque extrema
correspond to solar minima and maxima, and that a Grand Minimum was due around 2030. That
claim is the "planetary hypothesis" of solar variability. It is a live minority position
in solar physics with published proponents and published rebuttals, and it is not
established. His specific forecasts have had mixed results.

WHY BOTH HALVES BELONG HERE
───────────────────────────
This module is the clearest illustration of what Level 2 is for. The computation is exact
and would be accepted by any astronomer. The interpretive claim is contested and is
labelled as contested. Separating them lets a user see precisely where the physics stops
and the hypothesis begins — which almost no popular treatment of Landscheidt does, in
either direction: proponents present the whole thing as settled physics, and dismissers
throw out the barycentric mechanics along with the hypothesis.
"""
import math
from typing import Dict, Sequence, Tuple

# Masses relative to the Sun. Earth's value includes the Moon.
MASSES = {
    "mercury": 1.66014e-7,
    "venus": 2.44784e-6,
    "earth": 3.04043e-6,
    "mars": 3.22715e-7,
    "jupiter": 9.54792e-4,
    "saturn": 2.85886e-4,
    "uranus": 4.36624e-5,
    "neptune": 5.15139e-5,
}
# Jupiter and Saturn carry ~86% of the total planetary mass and dominate the motion.
DOMINANT = ["jupiter", "saturn", "uranus", "neptune"]

SOLAR_RADIUS_AU = 0.00465047

# The ~178.7-year repetition in the giant planets' configuration, named for Paul Jose
# (1965), who identified it before Landscheidt built on it.
JOSE_CYCLE_YEARS = 178.7


def barycentre(positions: Dict[str, Dict[str, float]]) -> Dict:
    """The solar-system barycentre, and the Sun's displacement from it.

    `positions` maps a planet to {"longitude": heliocentric ecliptic longitude in degrees,
    "distance": heliocentric distance in AU}. Works in the ecliptic plane — latitude
    contributes under half a percent to the barycentric offset and is omitted, which is
    stated rather than silently assumed."""
    total_mass = 1.0          # the Sun
    mx = my = 0.0
    used = []
    for body, m in MASSES.items():
        p = (positions or {}).get(body)
        if not p:
            continue
        lon = math.radians(float(p["longitude"]))
        r = float(p["distance"])
        mx += m * r * math.cos(lon)
        my += m * r * math.sin(lon)
        total_mass += m
        used.append(body)

    if not used:
        return {"error": "no planetary positions supplied"}

    bx, by = mx / total_mass, my / total_mass       # barycentre, heliocentric frame
    # The Sun's position relative to the barycentre is the negative of that vector.
    sx, sy = -bx, -by
    dist = math.hypot(sx, sy)

    return {
        "barycentre_au": {"x": round(bx, 8), "y": round(by, 8)},
        "sun_offset_au": {"x": round(sx, 8), "y": round(sy, 8)},
        "sun_distance_au": round(dist, 8),
        "sun_distance_solar_radii": round(dist / SOLAR_RADIUS_AU, 4),
        "outside_photosphere": dist > SOLAR_RADIUS_AU,
        "sun_longitude_from_barycentre": round(
            math.degrees(math.atan2(sy, sx)) % 360.0, 4),
        "bodies_used": used,
        "note": ("Exact Newtonian mechanics — no interpretation. When "
                 "sun_distance_solar_radii exceeds 1 the barycentre lies outside the "
                 "Sun's surface, which happens routinely and is not remarkable in itself."),
    }


def angular_momentum(offset_now: Dict[str, float], offset_prev: Dict[str, float],
                     dt_days: float) -> Dict:
    """The Sun's orbital angular momentum about the barycentre, from two samples.

    Velocity comes from a finite difference, so accuracy depends on the sampling interval.
    Landscheidt worked with the RATE OF CHANGE of this quantity — the torque — so two
    successive calls give the derivative he actually read."""
    if not dt_days:
        return {"error": "dt_days must be non-zero"}
    x1, y1 = float(offset_prev["x"]), float(offset_prev["y"])
    x2, y2 = float(offset_now["x"]), float(offset_now["y"])
    vx, vy = (x2 - x1) / dt_days, (y2 - y1) / dt_days

    # L per unit solar mass: the z-component of r × v.
    lz = x2 * vy - y2 * vx
    return {
        "angular_momentum": round(lz, 12),
        "specific": True,
        "velocity_au_per_day": {"x": round(vx, 12), "y": round(vy, 12)},
        "dt_days": dt_days,
        "unit": "AU²/day per unit solar mass",
        "note": ("Specific angular momentum — per unit solar mass. Landscheidt's torque "
                 "is the derivative of this, so compute it across successive intervals."),
    }


def torque_series(samples: Sequence[Tuple[str, Dict[str, Dict[str, float]]]],
                  dt_days: float) -> Dict:
    """Barycentric distance and angular momentum across a sequence of samples.

    Returns the series plus its torque (dL/dt) by finite difference. `samples` is
    [(label, positions)] at a uniform interval of `dt_days`."""
    pts = []
    prev_offset = None
    prev_L = None
    for label, pos in samples:
        b = barycentre(pos)
        if "error" in b:
            continue
        entry = {"label": label,
                 "distance_solar_radii": b["sun_distance_solar_radii"],
                 "longitude": b["sun_longitude_from_barycentre"]}
        if prev_offset is not None:
            am = angular_momentum(b["sun_offset_au"], prev_offset, dt_days)
            entry["angular_momentum"] = am["angular_momentum"]
            if prev_L is not None:
                entry["torque"] = round((am["angular_momentum"] - prev_L) / dt_days, 14)
            prev_L = am["angular_momentum"]
        prev_offset = b["sun_offset_au"]
        pts.append(entry)

    return {
        "points": pts,
        "count": len(pts),
        "cycle_reference": {"jose_cycle_years": JOSE_CYCLE_YEARS,
                            "identified_by": "Paul Jose, 1965 — before Landscheidt built "
                                             "on it"},
        "hypothesis": HYPOTHESIS,
    }


HYPOTHESIS = {
    "claim": ("Landscheidt argued that extrema in the rate of change of the Sun's orbital "
              "angular momentum about the barycentre correspond to turning points in "
              "solar activity, and forecast a Grand Minimum around 2030."),
    "status": "contested — a live minority position in solar physics, not established",
    "for": ("The barycentric motion is real and its periodicities are exact. Several "
            "published analyses report correlations between giant-planet configurations "
            "and the solar cycle, and the ~178.7-year Jose period does appear in some "
            "proxy records of solar activity."),
    "against": ("No accepted physical mechanism couples the Sun's barycentric orbit to its "
                "internal dynamo. The Sun is in free fall about the barycentre, so there "
                "is no tidal or inertial force on its interior from that motion — this is "
                "the central objection and it is a serious one. Several claimed "
                "correlations weaken or vanish on extended datasets."),
    "honest_summary": ("The computation in this module is exact physics. The hypothesis "
                       "built on it is not established, and the free-fall objection has "
                       "not been satisfactorily answered by its proponents."),
}


def summary(b: Dict) -> str:
    if not b or "error" in b:
        return ""
    return "\n".join([
        f"LANDSCHEIDT — Sun at {b['sun_distance_solar_radii']:.3f} solar radii from the "
        f"barycentre, longitude {b['sun_longitude_from_barycentre']:.1f}°",
        f"  barycentre {'OUTSIDE' if b['outside_photosphere'] else 'inside'} the photosphere",
        "  Exact mechanics. The solar-activity hypothesis built on it is contested and "
        "has no accepted coupling mechanism.",
    ])


# Anchor: Jupiter alone at 5.2 AU should put the barycentre near the solar surface.
_j = barycentre({"jupiter": {"longitude": 0.0, "distance": 5.2}})
assert 0.9 < _j["sun_distance_solar_radii"] < 1.2, _j["sun_distance_solar_radii"]
# Two opposed giants should largely cancel.
_c = barycentre({"jupiter": {"longitude": 0.0, "distance": 5.2},
                 "saturn": {"longitude": 180.0, "distance": 9.5}})
assert _c["sun_distance_solar_radii"] < _j["sun_distance_solar_radii"]
