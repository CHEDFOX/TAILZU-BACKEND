"""
TRADITIONAL MEDICAL ASTROLOGY and DECUMBITURE.

The last substantial gap in the Western stack, and historically the largest part of the
practice — for most of the tradition's life, astrology WAS medicine. English physicians
were legally required to know it into the seventeenth century, and Culpeper's herbal is
organised by planetary rulership rather than by symptom.

  THE HUMOURS       Four temperaments from the elemental balance of the chart, judged the
                    way the tradition judges them: the Ascendant and its lord, the Moon,
                    and the season of birth — not a simple count of planets in elements.

  MELOTHESIA        The zodiacal man: each sign rules a region of the body from Aries at
                    the head to Pisces at the feet, and each planet rules organs, humours
                    and processes. Afflictions to a sign or its ruler point at its region.

  DECUMBITURE       The chart of the moment of falling ill — a horary, not a natal.
                    Judged from the Moon, which is the significator of the disease's
                    course, and its aspects over the following weeks.

  CRITICAL DAYS     The tradition's real predictive claim: the illness turns when the Moon
                    reaches successive 45° multiples from its decumbiture position, giving
                    crises at roughly 3½, 7, 10½ and 14 days. Computed here from actual
                    lunar motion rather than counted off a calendar, because the Moon's
                    speed varies by about 20% and the difference across two weeks is most
                    of a day.

STATED PLAINLY, ONCE: this is a historical system, reconstructed and computed faithfully.
It is not medical advice, it does not diagnose, and nothing in it should delay seeing a
doctor. That belongs in the module rather than only in a disclaimer elsewhere, because a
medical-sounding output is the one place in this codebase where a reader could come to
actual harm by taking the tradition at its word.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional

SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
         "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]

# Melothesia — the zodiacal man, head to foot.
MELOTHESIA = {
    "Aries": "head, face, brain, upper jaw — headaches, fevers, injuries above the neck",
    "Taurus": "neck, throat, thyroid, lower jaw — sore throats, hoarseness, glandular trouble",
    "Gemini": "shoulders, arms, hands, lungs, nervous system — breath, and the wiring",
    "Cancer": "chest, breasts, stomach, digestion — what is taken in and how it is held",
    "Leo": "heart, spine, upper back — circulation and the structural column",
    "Virgo": "abdomen, intestines, spleen — assimilation, and its fussiness",
    "Libra": "kidneys, lumbar region, skin — balance of fluids, and what shows on the surface",
    "Scorpio": "bladder, genitals, colon, reproductive organs — elimination and generation",
    "Sagittarius": "hips, thighs, liver, sciatic nerve — locomotion and the great filter",
    "Capricorn": "knees, bones, joints, teeth, skin — the structure and its wear",
    "Aquarius": "ankles, calves, circulation of the blood — the erratic and the electrical",
    "Pisces": "feet, lymphatic system, immunity — the boundary between inside and out",
}

PLANET_RULERSHIP = {
    "Sun": ("heart, vitality, the right eye in men", "vital spirit — the body's heat and animation"),
    "Moon": ("stomach, breasts, bodily fluids, the left eye in men", "phlegm, and the tides of the body"),
    "Mercury": ("nervous system, speech, hands, lungs", "the animal spirit — messages and motion"),
    "Venus": ("kidneys, throat, venous blood, the reproductive system", "moisture, sweetness, repose"),
    "Mars": ("bile, muscles, the head, inflammation, wounds", "choler — heat, fever, cutting and burning"),
    "Jupiter": ("liver, arterial blood, growth, the lungs", "sanguine moisture — expansion, sometimes excess"),
    "Saturn": ("bones, teeth, spleen, skin, the ageing process", "black bile — cold, dry, obstructing and chronic"),
}

HUMOURS = {
    "sanguine": ("hot and moist", "air", "blood", "Jupiter",
                 "cheerful, ruddy, quick to warm and quick to forget; illnesses of excess and fullness"),
    "choleric": ("hot and dry", "fire", "yellow bile", "Mars",
                 "sharp, driven, easily angered; acute fevers, inflammation, sudden crisis"),
    "phlegmatic": ("cold and moist", "water", "phlegm", "Moon",
                   "calm, slow, retentive; congestion, swelling, the illnesses of damp"),
    "melancholic": ("cold and dry", "earth", "black bile", "Saturn",
                    "thoughtful, fixed, enduring; chronic, wasting and obstructive conditions"),
}
_SIGN_HUMOUR = {"Aries": "choleric", "Leo": "choleric", "Sagittarius": "choleric",
                "Taurus": "melancholic", "Virgo": "melancholic", "Capricorn": "melancholic",
                "Gemini": "sanguine", "Libra": "sanguine", "Aquarius": "sanguine",
                "Cancer": "phlegmatic", "Scorpio": "phlegmatic", "Pisces": "phlegmatic"}
_SIGN_RULER = {"Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury", "Cancer": "Moon",
               "Leo": "Sun", "Virgo": "Mercury", "Libra": "Venus", "Scorpio": "Mars",
               "Sagittarius": "Jupiter", "Capricorn": "Saturn", "Aquarius": "Saturn",
               "Pisces": "Jupiter"}

DISCLAIMER = ("Traditional medical astrology is a historical system, computed here as the "
              "tradition states it. It is not a diagnosis, not medical advice, and must "
              "never delay seeing a doctor.")


def _sign_of(longitude: float) -> str:
    return SIGNS[int((float(longitude) % 360.0) // 30)]


@dataclass
class Temperament:
    primary: str
    secondary: str
    scores: Dict[str, float]
    reasons: List[str]

    def as_dict(self) -> Dict:
        p, s = HUMOURS[self.primary], HUMOURS[self.secondary]
        return {"primary": self.primary, "primary_quality": p[0], "primary_element": p[1],
                "primary_humour": p[2], "primary_ruler": p[3], "primary_meaning": p[4],
                "secondary": self.secondary, "secondary_meaning": s[4],
                "scores": self.scores, "reasoning": self.reasons,
                "disclaimer": DISCLAIMER}


def temperament(ascendant: float, moon: float, sun: float,
                asc_ruler_longitude: Optional[float] = None,
                birth_month: Optional[int] = None) -> Temperament:
    """The humoural temperament, weighted the way the tradition weights it.

    Not a count of planets by element. The Ascendant and its lord carry the most weight
    (they signify the body itself), then the Moon (which governs the fluids), then the
    season. Counting planets equally is a modern shortcut that produces a different answer
    from the one Lilly or Culpeper would have reached."""
    scores = {k: 0.0 for k in HUMOURS}
    reasons = []

    a_sign = _sign_of(ascendant)
    scores[_SIGN_HUMOUR[a_sign]] += 4.0
    reasons.append(f"Ascendant in {a_sign} — the body itself; {_SIGN_HUMOUR[a_sign]} (weight 4)")

    if asc_ruler_longitude is not None:
        r_sign = _sign_of(asc_ruler_longitude)
        scores[_SIGN_HUMOUR[r_sign]] += 3.0
        reasons.append(f"Lord of the Ascendant in {r_sign} — {_SIGN_HUMOUR[r_sign]} (weight 3)")

    m_sign = _sign_of(moon)
    scores[_SIGN_HUMOUR[m_sign]] += 2.5
    reasons.append(f"Moon in {m_sign} — the fluids; {_SIGN_HUMOUR[m_sign]} (weight 2.5)")

    s_sign = _sign_of(sun)
    scores[_SIGN_HUMOUR[s_sign]] += 1.5
    reasons.append(f"Sun in {s_sign} — the vital heat; {_SIGN_HUMOUR[s_sign]} (weight 1.5)")

    if birth_month:
        season = {12: "melancholic", 1: "phlegmatic", 2: "phlegmatic", 3: "sanguine",
                  4: "sanguine", 5: "sanguine", 6: "choleric", 7: "choleric",
                  8: "choleric", 9: "melancholic", 10: "melancholic", 11: "melancholic"}
        h = season.get(int(birth_month))
        if h:
            scores[h] += 1.0
            reasons.append(f"Season of birth — {h} (weight 1)")

    order = sorted(scores.items(), key=lambda kv: -kv[1])
    return Temperament(primary=order[0][0], secondary=order[1][0],
                       scores={k: round(v, 2) for k, v in scores.items()}, reasons=reasons)


def afflicted_regions(planets: Dict[str, float],
                      malefics=("Mars", "Saturn")) -> List[Dict]:
    """Which regions of the zodiacal man the malefics fall in.

    This is the whole of natal medical astrology's predictive claim: the sign a malefic
    occupies marks the region of the body it presses on."""
    out = []
    for name in malefics:
        lon = planets.get(name)
        if lon is None:
            continue
        sign = _sign_of(lon)
        rul = PLANET_RULERSHIP.get(name, ("", ""))
        out.append({"planet": name, "sign": sign, "region": MELOTHESIA[sign],
                    "planet_rules": rul[0], "humour_effect": rul[1],
                    "reading": f"{name} in {sign} presses on the {sign} region — "
                               f"{MELOTHESIA[sign].split('—')[0].strip()}"})
    return out


# ══════════════════════════════════════════════════════════════════════════════
# DECUMBITURE
# ══════════════════════════════════════════════════════════════════════════════

CRITICAL_ANGLES = [(45.0, "the first crisis — the disease declares itself"),
                   (90.0, "the first true crisis — the turning point Hippocrates names"),
                   (135.0, "the second crisis — recovery or relapse becomes visible"),
                   (180.0, "the great crisis — the disease is broken or it is chronic"),
                   (225.0, "the fourth — convalescence, or the settling in of a long illness"),
                   (270.0, "the third quarter — the last acute turn"),
                   (315.0, "the final crisis before the lunar return"),
                   (360.0, "the Moon returns — the acute phase is over either way")]


def critical_days(decumbiture_jd: float, moon_longitude_at: callable,
                  max_days: float = 30.0) -> List[Dict]:
    """The dates the Moon reaches each critical angle from where it stood when the illness
    began.

    `moon_longitude_at(jd)` supplies the Moon's longitude. Computed from real motion rather
    than counted off a calendar: the Moon runs between about 11.8° and 15.4° a day, so the
    fourteen-day crisis can fall most of a day either side of where arithmetic puts it, and
    the tradition cares about the day."""
    start = float(moon_longitude_at(decumbiture_jd))
    out = []
    for angle, meaning in CRITICAL_ANGLES:
        lo, hi = 0.0, float(max_days)
        # The Moon's elongation from its start is monotonic over a month, so bisect.
        def elong(jd):
            days = jd - decumbiture_jd
            travelled = (float(moon_longitude_at(jd)) - start) % 360.0
            # Unwrap: add a full turn once the Moon has been going long enough.
            return travelled + 360.0 * int(days / 27.0)
        if elong(decumbiture_jd + hi) < angle:
            continue
        for _ in range(60):
            mid = (lo + hi) / 2.0
            if elong(decumbiture_jd + mid) < angle:
                lo = mid
            else:
                hi = mid
        out.append({"angle": angle, "days": round((lo + hi) / 2.0, 2),
                    "jd": round(decumbiture_jd + (lo + hi) / 2.0, 4), "meaning": meaning})
    return out


def decumbiture(moon_longitude: float, ascendant: float,
                sixth_house_cusp: Optional[float] = None) -> Dict:
    """The judgement of a decumbiture chart — the moment the patient took to bed.

    The Moon signifies the course of the disease and the Ascendant the patient. The sixth
    house and its lord signify the illness itself."""
    m_sign = _sign_of(moon_longitude)
    a_sign = _sign_of(ascendant)
    out = {
        "system": "Decumbiture",
        "moon": {"sign": m_sign, "region": MELOTHESIA[m_sign],
                 "signifies": "the course of the disease — its motion, and its turns"},
        "ascendant": {"sign": a_sign, "region": MELOTHESIA[a_sign],
                      "signifies": "the patient's own body and vitality"},
        "moon_humour": _SIGN_HUMOUR[m_sign],
        "reading": (f"The Moon in {m_sign} takes the disease into the {m_sign} region and "
                    f"gives it a {_SIGN_HUMOUR[m_sign]} character — "
                    f"{HUMOURS[_SIGN_HUMOUR[m_sign]][4].split(';')[-1].strip()}."),
        "disclaimer": DISCLAIMER,
    }
    if sixth_house_cusp is not None:
        s = _sign_of(sixth_house_cusp)
        out["sixth_house"] = {"sign": s, "ruler": _SIGN_RULER[s], "region": MELOTHESIA[s],
                              "signifies": "the disease itself, as distinct from its course"}
    return out


assert len(MELOTHESIA) == 12 and set(MELOTHESIA) == set(SIGNS)
assert len(_SIGN_HUMOUR) == 12 and set(_SIGN_HUMOUR.values()) == set(HUMOURS)
assert all(list(_SIGN_HUMOUR.values()).count(h) == 3 for h in HUMOURS), \
    "each humour must claim exactly three signs — one per triplicity"
assert len(PLANET_RULERSHIP) == 7, "the seven traditional planets"
