"""
LUNATION CYCLE (Dane Rudhyar) — the eight soli-lunar phases.

Rudhyar's *The Lunation Cycle* (1967) argues that the Moon's phase at birth is a more
fundamental datum than its sign — that the relationship between Sun and Moon describes
where a person stands in a cycle of unfolding, and therefore how they characteristically
begin, build, expose, and release.

It is here for a reason that has nothing to do with whether one accepts the interpretation:
it is EXACTLY COMPUTABLE from one subtraction, it is unambiguous, and it is the reason
terms like "balsamic moon" exist in contemporary practice at all. Almost every modern
astrologer uses Rudhyar's phase names without knowing they are his, and dated to 1967.

Rudhyar himself came to the material through Theosophy and Jungian psychology, and his
project — "humanistic astrology" — was explicitly to move astrology away from prediction
and toward a language for development. That framing is recorded because it changes what
the phase is claimed to do: it is not a forecast, and reading it as one misuses it.

THE PROGRESSED LUNATION CYCLE
─────────────────────────────
The same eight phases applied to the secondary-progressed Sun and Moon, giving a roughly
29½-year cycle through a life. Rudhyar read its New Moon as the start of a life chapter
and its Balsamic phase as the closing of one. Computable here from progressed positions.
"""
from typing import Dict, List

# (start elongation, name, keyword, Rudhyar's gloss)
PHASES = [
    (0.0, "New Moon", "emergence",
     "Acting on impulse and instinct, without the perspective of hindsight. Subjective, "
     "spontaneous, beginning something whose shape is not yet visible."),
    (45.0, "Crescent", "expansion",
     "Struggling forward against the pull of the past. The impulse meets its first "
     "resistance and must assert itself to continue."),
    (90.0, "First Quarter", "action",
     "Crisis in action. Structures must be built, and building means breaking with what "
     "came before. Decisive, often forceful."),
    (135.0, "Gibbous", "overcoming",
     "Refinement and questioning. Analysing what has been built, seeking the technique "
     "and the meaning that will make it work."),
    (180.0, "Full Moon", "fulfilment",
     "Illumination and objectivity. What was begun becomes visible and must be related to "
     "others. Awareness through relationship, and often through opposition."),
    (225.0, "Disseminating", "demonstration",
     "Distributing what has been learned. The natural teacher, communicator, propagandist "
     "of a conviction already formed."),
    (270.0, "Last Quarter", "reorientation",
     "Crisis in consciousness. The structures built are found wanting; loyalty to an idea "
     "outlasts its usefulness, and the turn away begins."),
    (315.0, "Balsamic", "release",
     "The closing of the cycle. Detachment, distillation, a sense of being a seed for "
     "something that will not flower in the present. Often prophetic in feeling."),
]

PHASE_SPAN = 45.0


def elongation(sun_longitude: float, moon_longitude: float) -> float:
    """The Moon's angular distance ahead of the Sun, 0–360.

    This is the whole computation. Everything else is a lookup."""
    return (float(moon_longitude) - float(sun_longitude)) % 360.0


def phase(sun_longitude: float, moon_longitude: float) -> Dict:
    """The soli-lunar phase at a moment."""
    e = elongation(sun_longitude, moon_longitude)
    idx = min(int(e // PHASE_SPAN), len(PHASES) - 1)
    start, name, keyword, gloss = PHASES[idx]
    into = e - start
    return {
        "elongation": round(e, 4),
        "phase": name,
        "phase_index": idx + 1,
        "of": len(PHASES),
        "keyword": keyword,
        "meaning": gloss,
        "degrees_into_phase": round(into, 4),
        "percent_through_phase": round(100.0 * into / PHASE_SPAN, 1),
        "waxing": e < 180.0,
        "illumination_percent": round(50.0 * (1 - __import__("math").cos(
            __import__("math").radians(e))), 1),
        "framing": ("Rudhyar's humanistic astrology explicitly moves away from prediction. "
                    "The phase describes a characteristic way of moving through a cycle, "
                    "not an event, and reading it as a forecast misuses it."),
    }


def progressed_phase(progressed_sun: float, progressed_moon: float) -> Dict:
    """The progressed lunation cycle — roughly 29½ years, the chapter structure of a life."""
    p = phase(progressed_sun, progressed_moon)
    p["cycle"] = "progressed"
    p["period"] = "approximately 29.5 years for a full cycle, ~3.7 years per phase"
    p["reading"] = ("Rudhyar read the progressed New Moon as the opening of a life chapter "
                    "and the Balsamic phase as its closing — the largest structural rhythm "
                    "in a life, on this account.")
    return p


def all_phases() -> List[Dict]:
    return [{"index": i + 1, "start_degrees": s, "end_degrees": s + PHASE_SPAN,
             "name": n, "keyword": k, "meaning": g}
            for i, (s, n, k, g) in enumerate(PHASES)]


def summary(p: Dict) -> str:
    if not p:
        return ""
    return "\n".join([
        f"LUNATION — {p['phase']} ({p['phase_index']}/8), "
        f"{p['elongation']:.1f}° elongation, {p['illumination_percent']:.0f}% lit",
        f"  {p['keyword']}: {p['meaning']}",
    ])


# Anchors against the definitions.
assert phase(0.0, 0.0)["phase"] == "New Moon"
assert phase(0.0, 180.0)["phase"] == "Full Moon"
assert phase(0.0, 90.0)["phase"] == "First Quarter"
assert phase(0.0, 350.0)["phase"] == "Balsamic"
assert phase(0.0, 180.0)["illumination_percent"] == 100.0
assert phase(0.0, 0.0)["illumination_percent"] == 0.0
assert len(PHASES) == 8
