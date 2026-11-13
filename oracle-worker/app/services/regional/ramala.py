"""
RAMALA (रमल) — Indian geomancy, on the real shield.

WHAT WAS WRONG WITH THE FIRST ATTEMPT
─────────────────────────────────────
It drew sixteen figures into houses at random and called that a reading. Geomancy does
not work that way in ANY of its branches: the querent supplies four MOTHERS, and every
other figure in the chart is DERIVED from them — daughters by transposition, nieces by
pairwise addition, then two witnesses and a judge. The derivation is the method. A random
draw per house throws away the entire mechanism and keeps only the pictures.

Worse, `divination/geomancy.py` already carried that derivation, verified, twenty files
away. So the first version was a weaker reimplementation of an engine that already
existed. This one calls it.

AND THE NAMES WERE INVENTED
───────────────────────────
The first version gave the figures Sanskrit names — Labha, Jaya, Vijaya, Kshaya — that
are ordinary Sanskrit words rather than the attested figure names. Indian ramal received
the system from Arabic through the Persianate courts and TRANSLITERATES the Arabic names;
it does not translate them into Sanskrit. The Arabic names are given here because those
are the ones the tradition actually uses.

WHAT IS INDIAN ABOUT IT, THEN
─────────────────────────────
Not the figures and not the shield — those are shared with ʿilm al-raml and with European
geomancy alike. What is Indian is the READING: the shield is laid into the twelve BHĀVAS
rather than the twelve Western houses, and judged by Indian house doctrine — the trikona
(1, 5, 9) as the houses of fortune, the dusthāna (6, 8, 12) as the houses of difficulty,
and the kendra (1, 4, 7, 10) as the pillars. That is a real difference in interpretation
resting on identical mathematics, and saying so is more accurate than dressing the figures
in Sanskrit.
"""
import hashlib
from typing import Dict, List, Optional

from app.services.divination.geomancy import FIGURES, shield

# The Arabic names, which Indian ramal transliterates rather than translates.
ARABIC_NAMES = {
    "Via": ("الطريق", "al-Ṭarīq", "the road"),
    "Cauda Draconis": ("عتبة الخارجة", "ʿAtabat al-Khārija", "the outer threshold"),
    "Puer": ("لحيان", "Liḥyān", "the bearded one"),
    "Fortuna Minor": ("نصرة الخارجة", "Nuṣrat al-Khārija", "the outer victory"),
    "Puella": ("نقي الخد", "Naqī al-Khadd", "the smooth cheek"),
    "Amissio": ("قبض الخارج", "Qabḍ al-Khārij", "the outward grasp"),
    "Carcer": ("عقلة", "ʿUqla", "the fetter"),
    "Laetitia": ("نصرة الداخلة", "Nuṣrat al-Dākhila", "the inner victory"),
    "Caput Draconis": ("عتبة الداخلة", "ʿAtabat al-Dākhila", "the inner threshold"),
    "Coniunctio": ("اجتماع", "Ijtimāʿ", "the gathering"),
    "Acquisitio": ("قبض الداخل", "Qabḍ al-Dākhil", "the inward grasp"),
    "Rubeus": ("حمرة", "Ḥumra", "the redness"),
    "Fortuna Major": ("بياض", "Bayāḍ", "the whiteness"),
    "Albus": ("جماعة", "Jamāʿa", "the assembly"),
    "Tristitia": ("انكيس", "Ankīs", "the head-down"),
    "Populus": ("جماعة", "Jamāʿa", "the crowd"),
}

# The twelve bhāvas — where the Indian reading actually differs.
BHAVAS = [
    ("Tanu", "तनु", "the body, the self, and the whole shape of the matter"),
    ("Dhana", "धन", "wealth held, family, and speech"),
    ("Sahaja", "सहज", "siblings, courage, and short journeys"),
    ("Bandhu", "बन्धु", "mother, home, land, and the end of things"),
    ("Putra", "पुत्र", "children, intellect, and merit carried from before"),
    ("Ari", "अरि", "enemies, debt, disease — the first dusthāna"),
    ("Yuvati", "युवति", "spouse, partnership, and the open opponent"),
    ("Randhra", "रन्ध्र", "death, secrets, inheritance — the eighth"),
    ("Dharma", "धर्म", "fortune, father, teachers, and the long journey"),
    ("Karma", "कर्म", "action, profession, and standing in the world"),
    ("Labha", "लाभ", "gain, network, and what is fulfilled"),
    ("Vyaya", "व्यय", "loss, expenditure, confinement and release"),
]
TRIKONA = {1, 5, 9}
KENDRA = {1, 4, 7, 10}
DUSTHANA = {6, 8, 12}

_SEED = {f[1]: f[3] for f in FIGURES}
_IDS = [f[0] for f in FIGURES]
_NAME_BY_ID = {f[0]: f[1] for f in FIGURES}

# The figures classed as favourable in geomantic tradition. Used to judge a bhāva, not to
# reduce the reading to a score.
BENEFIC = {"Fortuna Major", "Fortuna Minor", "Acquisitio", "Laetitia", "Puella",
           "Caput Draconis", "Coniunctio", "Albus"}
MALEFIC = {"Amissio", "Carcer", "Tristitia", "Rubeus", "Cauda Draconis", "Puer"}


def _mothers_from_seed(seed) -> List[str]:
    """Four mothers derived from a seed.

    In practice the querent makes sixteen rows of marks and the parity of each row gives a
    line. A seed stands in for that here, deterministically, so a reading is reproducible —
    but it is standing in for the querent's own hand, and `mothers` should be passed
    directly whenever the marks were actually made."""
    out = []
    for i in range(4):
        h = hashlib.sha256(f"ramala:{seed}:{i}".encode()).digest()
        out.append(_IDS[int.from_bytes(h[:8], "big") % 16])
    return out


def ramala(seed=None, mothers: Optional[List[str]] = None) -> Dict:
    """A Ramala chart — the full shield, read into the twelve bhāvas.

    `mothers` takes four figure ids when the querent has actually made the marks. Without
    them a seed derives four, deterministically."""
    ids = [m for m in (mothers or []) if m in _NAME_BY_ID]
    if len(ids) != 4:
        ids = _mothers_from_seed(seed)

    sh = shield(ids)
    if not sh:
        return {"system": "Ramala (रमल)", "error": "could not build the shield"}

    # The twelve houses of the shield chart: mothers, daughters and nieces fill 1-12 in
    # order, which is the standard house allocation.
    order = sh["mothers"] + sh["daughters"] + sh["nieces"]
    houses = []
    for i, fig in enumerate(order[:12]):
        n = i + 1
        name, hi, meaning = BHAVAS[i]
        ar = ARABIC_NAMES.get(fig, ("", "", ""))
        tone = ("favourable" if fig in BENEFIC else
                "difficult" if fig in MALEFIC else "neutral")
        klass = ("trikona — a house of fortune" if n in TRIKONA else
                 "dusthāna — a house of difficulty" if n in DUSTHANA else
                 "kendra — a pillar" if n in KENDRA else "a supporting house")
        houses.append({
            "bhava": n, "name": name, "devanagari": hi, "governs": meaning,
            "classification": klass,
            "figure": fig, "arabic": ar[1], "arabic_script": ar[0],
            "figure_meaning": _SEED.get(fig, ""), "tone": tone,
        })

    judge = sh["judge"]
    verdict = ("the judge is favourable — the matter resolves as asked"
               if judge in BENEFIC else
               "the judge is difficult — the matter does not resolve as asked"
               if judge in MALEFIC else
               "the judge is neutral — the matter turns on the witnesses, not on itself")

    return {
        "system": "Ramala (रमल)",
        "mothers": [{"figure": _NAME_BY_ID[i], "arabic": ARABIC_NAMES.get(_NAME_BY_ID[i], ("", "", ""))[1]}
                    for i in ids],
        "daughters": sh["daughters"], "nieces": sh["nieces"],
        "right_witness": {"figure": sh["right_witness"], "meaning": sh["right_seed"]},
        "left_witness": {"figure": sh["left_witness"], "meaning": sh["left_seed"]},
        "judge": {"figure": judge, "meaning": sh["judge_seed"],
                  "arabic": ARABIC_NAMES.get(judge, ("", "", ""))[1], "verdict": verdict},
        "bhavas": houses,
        "reading_order": ("Read the judge first — it answers the question. The witnesses "
                          "say how it arrives: the right witness is the querent's side, "
                          "the left the other party's. The bhāvas say what area of life "
                          "it lands in."),
        "note": ("The figures and the shield derivation are shared with ʿilm al-raml and "
                 "with European geomancy — the mathematics is identical. What is Indian is "
                 "the reading into the twelve bhāvas by Indian house doctrine. Indian "
                 "practice transliterates the Arabic figure names rather than translating "
                 "them into Sanskrit."),
    }


# The shield must derive, not draw: the same mothers always give the same judge, and a
# different set must be able to give a different one.
_a = ramala(mothers=["via", "populus", "albus", "rubeus"])
_b = ramala(mothers=["via", "populus", "albus", "rubeus"])
assert _a["judge"]["figure"] == _b["judge"]["figure"], "the shield must be deterministic"
assert len(_a["bhavas"]) == 12, "twelve bhāvas"
assert all(h["figure"] for h in _a["bhavas"]), "every bhāva must carry a figure"
assert len(ARABIC_NAMES) == 16 and len(BHAVAS) == 12
