"""
TAOIST CYCLES — the Five Phases, Yin/Yang and Wu Wei as a birth lens (beyond BaZi).

Reads the birth's Day Master element as its ruling PHASE (Wu Xing), then places it in
the living cycles: what generates it, what it generates, what controls it, and the
season/quality it belongs to — with the Taoist counsel of Wu Wei (effortless action,
moving with the grain rather than against it).
"""
from datetime import datetime

# phase → (yin/yang tendency, season, direction, generates, controls, seed)
PHASES = {
    "Wood":  ("rising yang", "spring", "east",   "Fire",  "Earth",
              "the green force — growth, vision, the sap that pushes upward and outward"),
    "Fire":  ("full yang",   "summer", "south",  "Earth", "Metal",
              "the blaze — passion, expression, the peak of light and warmth"),
    "Earth": ("balance",     "late summer", "centre", "Metal", "Water",
              "the ground — nourishment, steadiness, the still centre that holds all"),
    "Metal": ("rising yin",  "autumn", "west",   "Water", "Wood",
              "the blade — clarity, refinement, the cut that keeps only what is essential"),
    "Water": ("full yin",    "winter", "north",  "Wood",  "Fire",
              "the deep — wisdom, stillness, the flow that yields yet wears the stone"),
}
_ORDER = ["Wood", "Fire", "Earth", "Metal", "Water"]

_MONTH_SEASON = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
                 6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn", 11: "autumn"}


class TaoReading:
    def __init__(self, phase, polarity, data, season):
        self.phase = phase
        self.polarity = polarity          # Yin / Yang of the Day Master
        self.tendency, self.phase_season, self.direction, self.generates, self.controls, self.seed = data
        self.birth_season = season


def _day_master(dt):
    try:
        from app.services.chinese.bazi import BaZiChart
        dm = BaZiChart(dt).get_day_master() or {}
        el = dm.get("element", "")
        pol = dm.get("polarity") or dm.get("yin_yang") or ""
        return el, pol
    except Exception:
        return "", ""


def taoist(year, month, day, hour=12, minute=0):
    dt = datetime(int(year), int(month), int(day), int(hour), int(minute))
    el, pol = _day_master(dt)
    if el not in PHASES:
        # fall back to the birth-month season's phase
        el = {"spring": "Wood", "summer": "Fire", "late summer": "Earth",
              "autumn": "Metal", "winter": "Water"}.get(_MONTH_SEASON.get(int(month), "spring"), "Earth")
    polarity = "Yang" if str(pol).lower().startswith(("y", "+")) and "yin" not in str(pol).lower() else \
               ("Yin" if "yin" in str(pol).lower() else "")
    return TaoReading(el, polarity, PHASES[el], _MONTH_SEASON.get(int(month), "spring"))


if __name__ == "__main__":
    r = taoist(1990, 5, 15, 10, 30)
    print(f"phase {r.phase} ({r.polarity}) | tendency {r.tendency} | generates {r.generates} | controls {r.controls}")
    print(f"phase-season {r.phase_season} · born in {r.birth_season}")
    assert len(PHASES) == 5
    print("structure OK")
