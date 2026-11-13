"""
AYURVEDA — prakriti (constitution) and its relation to the birth chart.

Prakriti is the proportion of the three doshas — vata, pitta, kapha — fixed at conception
and unchanging through life. Vikriti is the current imbalance, which changes constantly.
Confusing the two is the standard error: a person of kapha prakriti with a pitta vikriti
is not "becoming pitta", they are a kapha person currently inflamed.

TWO ROUTES, AND ONLY ONE IS CLASSICAL
─────────────────────────────────────
The texts determine prakriti by EXAMINATION — build, skin, hair, digestion, sleep, pulse,
temperament — conducted by a vaidya. That is the method, and this module's questionnaire
path reflects it.

Jyotish also links doshas to planets and signs, and a chart-derived estimate is possible.
But it is an ESTIMATE from a correlated system, not the classical determination, and the
two disagree often enough that presenting a chart-derived dosha as the person's prakriti
would misrepresent both traditions. `from_chart()` says so in its own output.
"""
from typing import Dict, List

DOSHAS = {
    "vata": {
        "sanskrit": "वात",
        "elements": ("air", "ether"),
        "qualities": ("dry", "light", "cold", "rough", "subtle", "mobile", "clear"),
        "governs": "movement — breath, circulation, nerve impulse, elimination, thought",
        "balanced": "creative, quick, adaptable, enthusiastic",
        "aggravated": "anxious, scattered, insomniac, dry, constipated, cold extremities",
        "season": "late autumn and winter",
        "time_of_day": "2–6, dawn and dusk",
    },
    "pitta": {
        "sanskrit": "पित्त",
        "elements": ("fire", "water"),
        "qualities": ("hot", "sharp", "light", "oily", "liquid", "spreading"),
        "governs": "transformation — digestion, metabolism, perception, body temperature",
        "balanced": "sharp intellect, strong digestion, decisive, courageous",
        "aggravated": "irritable, inflamed, acidic, overheated, critical, impatient",
        "season": "summer",
        "time_of_day": "10–2, midday and midnight",
    },
    "kapha": {
        "sanskrit": "कफ",
        "elements": ("earth", "water"),
        "qualities": ("heavy", "slow", "cool", "oily", "smooth", "dense", "stable"),
        "governs": "structure and cohesion — tissue, lubrication, immunity, stability",
        "balanced": "steady, patient, strong, calm, loyal",
        "aggravated": "lethargic, congested, attached, heavy, resistant to change",
        "season": "late winter and spring",
        "time_of_day": "6–10, morning and evening",
    },
}

# The classical examination axes. Each is answered vata / pitta / kapha.
EXAMINATION = [
    ("build", "Frame and how easily weight is gained or lost",
     {"vata": "thin, light frame; gains with difficulty",
      "pitta": "medium, well-proportioned; weight fairly stable",
      "kapha": "solid, heavy frame; gains easily, loses slowly"}),
    ("skin", "Texture and temperature of the skin",
     {"vata": "dry, thin, cool, rough; visible veins",
      "pitta": "warm, soft, ruddy; prone to rashes and moles",
      "kapha": "thick, cool, moist, smooth, pale"}),
    ("hair", "Hair character",
     {"vata": "dry, thin, brittle, frizzy",
      "pitta": "fine, straight, early greying or thinning, oily",
      "kapha": "thick, heavy, wavy, lustrous"}),
    ("digestion", "Appetite and digestion",
     {"vata": "irregular appetite, variable digestion, gas and bloating",
      "pitta": "strong sharp appetite, cannot skip meals, acidity",
      "kapha": "steady low appetite, slow heavy digestion"}),
    ("sleep", "Sleep pattern",
     {"vata": "light, broken, difficulty falling asleep",
      "pitta": "moderate, sound, wakes alert; wakes hot",
      "kapha": "deep, long, hard to wake, grogginess"}),
    ("temperament", "Mind under pressure",
     {"vata": "worry, fear, scattering, rapid change of mind",
      "pitta": "anger, criticism, competitiveness, impatience",
      "kapha": "withdrawal, attachment, inertia, avoidance"}),
    ("speech", "How the person speaks",
     {"vata": "fast, tangential, talkative, voice may crack",
      "pitta": "precise, argumentative, penetrating, well-organised",
      "kapha": "slow, measured, melodious, few words"}),
    ("climate", "Climate least tolerated",
     {"vata": "cold, wind, dryness",
      "pitta": "heat, sun, humidity",
      "kapha": "cold damp, heaviness, spring"}),
]

# ─── Jyotish correlation ──────────────────────────────────────────────────
# The classical dosha attributions of the grahas. These are attested but the tradition
# does not use them to DETERMINE prakriti — that is examination's job.
GRAHA_DOSHA = {
    "sun": "pitta", "mars": "pitta", "ketu": "pitta",
    "moon": "kapha", "venus": "kapha", "jupiter": "kapha",
    "saturn": "vata", "rahu": "vata", "mercury": "vata",
}
# Mercury and Venus are traditionally tridoshic in some sources; the dominant single
# attribution is used here and the ambiguity recorded.
_AMBIGUOUS = {"mercury": "often given as tridoshic rather than vata",
              "venus": "kapha with a pitta component in several sources",
              "moon": "kapha, but vata when waning in some texts"}

SIGN_DOSHA = {
    "aries": "pitta", "leo": "pitta", "sagittarius": "pitta",
    "taurus": "kapha", "virgo": "vata", "capricorn": "vata",
    "gemini": "vata", "libra": "vata", "aquarius": "vata",
    "cancer": "kapha", "scorpio": "kapha", "pisces": "kapha",
}


def from_examination(answers: Dict[str, str]) -> Dict:
    """The classical route: score the examination axes.

    `answers` maps each axis id to 'vata' | 'pitta' | 'kapha'."""
    valid = {a[0] for a in EXAMINATION}
    counts = {"vata": 0, "pitta": 0, "kapha": 0}
    answered = 0
    for axis, val in (answers or {}).items():
        if axis in valid and val in counts:
            counts[val] += 1
            answered += 1
    if not answered:
        return {}
    total = sum(counts.values())
    pct = {k: round(100.0 * v / total, 1) for k, v in counts.items()}
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])

    top, second = ranked[0], ranked[1]
    if top[1] == second[1] == ranked[2][1]:
        ctype, label = "tridoshic", "sama prakriti — the three in balance, uncommon"
    elif top[1] - second[1] <= 1:
        ctype = f"{top[0]}-{second[0]}"
        label = f"dual constitution, {top[0]} leading"
    else:
        ctype, label = top[0], f"single-dosha {top[0]} constitution"

    return {
        "method": "examination (classical)",
        "counts": counts, "percentages": pct,
        "constitution": ctype, "label": label,
        "dominant": top[0],
        "axes_answered": answered, "axes_total": len(EXAMINATION),
        "detail": {k: DOSHAS[k] for k, v in counts.items() if v},
        "confidence": ("adequate" if answered >= 6 else
                       "partial — fewer than six axes answered"),
        "note": ("This estimates PRAKRITI, the constitution fixed at conception. It does "
                 "not describe current imbalance (vikriti), which changes with season, "
                 "diet and stress and is what a person usually notices."),
    }


def from_chart(graha_signs: Dict[str, str], ascendant_sign: str = "",
               moon_sign: str = "") -> Dict:
    """Chart-derived ESTIMATE. Explicitly not the classical determination.

    `graha_signs` maps a graha name to its sign. Weighting follows the tradition's own
    emphasis: the ascendant governs the body, the Moon the humoral temperament."""
    counts = {"vata": 0, "pitta": 0, "kapha": 0}
    contributions = []

    for graha, sign in (graha_signs or {}).items():
        g = graha.lower()
        d = GRAHA_DOSHA.get(g)
        if d:
            counts[d] += 1
            contributions.append({"source": f"graha {g}", "dosha": d, "weight": 1,
                                  "ambiguity": _AMBIGUOUS.get(g, "")})

    if ascendant_sign:
        d = SIGN_DOSHA.get(ascendant_sign.lower())
        if d:
            counts[d] += 3
            contributions.append({"source": "ascendant (governs the body)", "dosha": d,
                                  "weight": 3, "ambiguity": ""})
    if moon_sign:
        d = SIGN_DOSHA.get(moon_sign.lower())
        if d:
            counts[d] += 2
            contributions.append({"source": "Moon (governs temperament)", "dosha": d,
                                  "weight": 2, "ambiguity": ""})

    total = sum(counts.values())
    if not total:
        return {}
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return {
        "method": "chart-derived estimate (NOT the classical determination)",
        "counts": counts,
        "percentages": {k: round(100.0 * v / total, 1) for k, v in counts.items()},
        "estimated_dominant": ranked[0][0],
        "contributions": contributions,
        "caveat": ("Ayurveda determines prakriti by EXAMINATION — build, skin, digestion, "
                   "sleep, pulse — not from a chart. This is an estimate from a correlated "
                   "system and the two disagree often enough that it must not be presented "
                   "as the person's constitution. Offer it as what the chart suggests, and "
                   "the examination as what would settle it."),
        "ambiguities": [c["ambiguity"] for c in contributions if c["ambiguity"]],
    }


def questionnaire() -> List[Dict]:
    """The examination axes as a user-answerable form."""
    return [{"id": a, "question": q, "options": opts} for a, q, opts in EXAMINATION]


def dosha(name: str) -> Dict:
    return DOSHAS.get((name or "").lower(), {})


def summary(r: Dict) -> str:
    if not r:
        return ""
    if r.get("method", "").startswith("chart"):
        return "\n".join([
            f"AYURVEDA (chart estimate) — leaning {r['estimated_dominant']}",
            "  " + " · ".join(f"{k} {v}%" for k, v in r["percentages"].items()),
            f"  {r['caveat']}",
        ])
    return "\n".join([
        f"AYURVEDA — {r['label']}",
        "  " + " · ".join(f"{k} {v}%" for k, v in r["percentages"].items()),
        f"  {r['axes_answered']}/{r['axes_total']} axes answered ({r['confidence']})",
        f"  {r['note']}",
    ])
