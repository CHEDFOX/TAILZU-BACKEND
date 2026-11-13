"""
THE INDIC REMAINDER — Svara, Sāmudrika, Sarvatobhadra, Aṣṭamaṅgala, Ramala, Sinhala.

Six South Asian systems the engine names in passing and never computes. Two of them are
genuinely computable and two are frameworks rather than calculations, and the difference
is marked rather than blurred.

  SVARA ŚĀSTRA (शिवस्वरोदय)  Divination by which nostril the breath flows through. Fully
                            computable: the breath is held to alternate between iḍā (left)
                            and piṅgalā (right) roughly every hour, phased by the lunar
                            fortnight and the weekday, and the tradition prescribes which
                            acts suit which flow. Among the most practical of all Indian
                            systems and completely absent from every astrology app.

  SARVATOBHADRA CHAKRA      The omnidirectional grid — 28 nakṣatras, 12 rāśis, the vowels
                            and consonants arranged in a square. A transiting planet
                            "strikes" (vedha) cells aligned with it, and what is struck is
                            afflicted. Fully computable, and the classical tool for judging
                            a transit against a name or a nakṣatra.

  SĀMUDRIKA ŚĀSTRA          Reading the body — proportions, marks, the palm. A framework
                            with a fixed vocabulary; the reading needs observation this
                            module cannot make, so the vocabulary is given and no
                            measurement is invented.

  AṢṬAMAṄGALA PRAŚNA        Kerala's horary, distinct from generic praśna: cowries cast on
                            a board, an ārūḍha derived from the count, and the daivajña's
                            observation of omens at the moment. The COUNT is computable;
                            the omen-reading is not, and both are said.

  RAMALA and SARVATOBHADRA moved out of this module. The versions here drew figures at
                            random and computed one vedha category; both now live in
                            regional/ramala.py and regional/sarvatobhadra.py, built on the
                            real shield derivation and the full five-series grid.

  SINHALA NEKATH            Sri Lankan auspicious-timing practice. Indian in descent, with
                            its own nekath calendar governing the New Year rituals down to
                            the minute — genuinely distinct in use if not in mechanism.
"""
import hashlib
from typing import Dict

# ══════════════════════════════════════════════════════════════════════════════
# SVARA ŚĀSTRA
# ══════════════════════════════════════════════════════════════════════════════

SVARA = {
    "ida": ("इडा", "left nostril, lunar, cooling",
            "suits gentle, permanent and auspicious acts — beginning study, marriage, "
            "planting, charity, taking medicine, meeting elders, anything to endure"),
    "pingala": ("पिङ्गला", "right nostril, solar, heating",
                "suits hard, immediate and forceful acts — travel, contest, eating, "
                "physical work, buying and selling, anything to be done at once"),
    "sushumna": ("सुषुम्ना", "both nostrils, the central channel",
                 "suits nothing worldly at all. Meditation only; any undertaking begun in "
                 "sushumna is said to fail, and the tradition is unusually flat about it"),
}
# Elements cycle within each svara: earth, water, fire, air, ether, in fixed durations.
TATTVA = [("पृथ्वी Prithvi", "earth", 20, "solid, slow, successful in lasting matters"),
          ("जल Jala", "water", 16, "fluid, fertile, good for growth and for asking"),
          ("अग्नि Agni", "fire", 12, "destructive, quick, bad for beginnings"),
          ("वायु Vayu", "air", 8, "unstable, moving, good only for travel"),
          ("आकाश Akasha", "ether", 4, "void — nothing undertaken in it comes to anything")]


def svara(lunar_day: int, weekday_sunday0: int, minutes_since_sunrise: int) -> Dict:
    """Which channel the breath is flowing through, and what it suits.

    The rule: on the bright fortnight the breath opens in iḍā on Monday, Wednesday,
    Thursday and Friday and in piṅgalā on the rest; on the dark fortnight it reverses. It
    then alternates every sixty minutes (one ghaṭikā-pair), and inside each hour the five
    tattvas run in fixed durations summing to that hour."""
    bright = 1 <= int(lunar_day) <= 15
    soft_day = int(weekday_sunday0) in (1, 3, 4, 5)     # Mon, Wed, Thu, Fri
    starts_ida = soft_day if bright else not soft_day

    hours = int(minutes_since_sunrise) // 60
    now_ida = starts_ida if hours % 2 == 0 else not starts_ida
    key = "ida" if now_ida else "pingala"

    within = int(minutes_since_sunrise) % 60
    acc = 0
    tat = TATTVA[-1]
    for t in TATTVA:
        acc += t[2]
        if within < acc:
            tat = t
            break
    sa, desc, suits = SVARA[key]
    return {
        "system": "Svara Śāstra (शिवस्वरोदय)",
        "channel": key, "sanskrit": sa, "description": desc, "suits": suits,
        "fortnight": "śukla (bright)" if bright else "kṛṣṇa (dark)",
        "opened_in": "ida" if starts_ida else "pingala",
        "tattva": {"name": tat[0], "element": tat[1], "minutes": tat[2], "effect": tat[3]},
        "note": ("Practitioners verify by breathing onto a mirror or blocking one nostril "
                 "rather than trusting the calculation — the computed value is the "
                 "expectation, and the actual breath overrules it."),
    }


# ══════════════════════════════════════════════════════════════════════════════
# SARVATOBHADRA CHAKRA
# ══════════════════════════════════════════════════════════════════════════════

NAKSHATRAS = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
              "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
              "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha",
              "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Abhijit",
              "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada",
              "Uttara Bhadrapada", "Revati"]

# Vedha — which nakṣatra each one strikes when a malefic transits it. The classical
# pairing, which is what makes the chakra predictive rather than decorative.
_VEDHA = {0: 18, 18: 0, 1: 17, 17: 1, 2: 16, 16: 2, 3: 15, 15: 3, 4: 14, 14: 4,
          5: 13, 13: 5, 6: 12, 12: 6, 7: 11, 11: 7, 8: 10, 10: 8,
          19: 27, 27: 19, 20: 26, 26: 20, 22: 25, 25: 22, 23: 24, 24: 23}


def sarvatobhadra(transiting_nakshatra: int, natal_nakshatra: int) -> Dict:
    """Whether a transit strikes a natal position on the chakra.

    Vedha is the mechanism: a planet in one nakṣatra strikes its paired opposite, and a
    strike on the natal star is the affliction the chakra exists to catch."""
    t = int(transiting_nakshatra) % 28
    n = int(natal_nakshatra) % 28
    struck = _VEDHA.get(t)
    hits = struck == n
    same = t == n
    return {
        "system": "Sarvatobhadra Chakra (सर्वतोभद्र चक्र)",
        "transiting": NAKSHATRAS[t], "natal": NAKSHATRAS[n],
        "strikes": NAKSHATRAS[struck] if struck is not None else None,
        "vedha_hit": hits, "conjunct": same,
        "reading": ("VEDHA — the transit strikes the natal star directly; the classical "
                    "signal for obstruction in whatever the star governs" if hits else
                    "the transit sits on the natal star — intensification rather than "
                    "affliction" if same else
                    "no vedha on the natal star from this position"),
        "note": ("Abhijit is included, making 28 rather than 27 — the chakra is one of the "
                 "few places classical practice keeps it."),
    }


# ══════════════════════════════════════════════════════════════════════════════
# AṢṬAMAṄGALA PRAŚNA
# ══════════════════════════════════════════════════════════════════════════════

def ashtamangala(cowrie_count: int, seed=None) -> Dict:
    """The Kerala horary count.

    Cowries are poured and counted; the remainder on division by twelve gives the ārūḍha
    rāśi, which is where the question is read from. The count is arithmetic and is computed
    here. What is NOT computed is the daivajña's reading of omens at the moment of the
    cast — who spoke, what was carried past, which bird called — and in Kerala practice
    that observation outweighs the board."""
    if cowrie_count is None:
        h = hashlib.sha256(f"ashtamangala:{seed}".encode()).digest()
        cowrie_count = int.from_bytes(h[:8], "big") % 108 + 1
    c = int(cowrie_count)
    arudha = (c % 12) or 12
    signs = ["Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya", "Tula",
             "Vrischika", "Dhanu", "Makara", "Kumbha", "Meena"]
    return {
        "system": "Aṣṭamaṅgala Praśna (അഷ്ടമംഗല പ്രശ്നം)",
        "cowries": c, "arudha_rasi": arudha, "arudha_name": signs[arudha - 1],
        "remainder_of": 12,
        "limit": ("The count is computed. The nimitta — the omens observed at the moment "
                  "of the cast — are the larger half of Kerala practice and cannot be "
                  "computed at all; a reading built on the board alone is not an "
                  "Aṣṭamaṅgala reading."),
    }


# ══════════════════════════════════════════════════════════════════════════════
# RAMALA
# ══════════════════════════════════════════════════════════════════════════════

RAMALA_FIGURES = [
    ("लाभ", "Labha", "gain — the greater fortune"),
    ("जय", "Jaya", "victory — the lesser fortune"),
    ("विजय", "Vijaya", "conquest — success through effort"),
    ("क्षय", "Kshaya", "loss — the greater misfortune"),
    ("हानि", "Hani", "diminution — the lesser misfortune"),
    ("वृद्धि", "Vriddhi", "increase — growth and expansion"),
    ("बन्धन", "Bandhana", "binding — imprisonment, obligation"),
    ("मोक्ष", "Moksha", "release — freedom, the loosening"),
    ("शत्रु", "Shatru", "the enemy — opposition named"),
    ("मित्र", "Mitra", "the friend — help identified"),
    ("आगमन", "Agamana", "arrival — what is coming"),
    ("गमन", "Gamana", "departure — what is leaving"),
    ("स्थिर", "Sthira", "the fixed — nothing moves"),
    ("चल", "Chala", "the moving — everything shifts"),
    ("शुभ", "Shubha", "the auspicious — plain good"),
    ("अशुभ", "Ashubha", "the inauspicious — plain ill"),
]


def ramala(seed, houses: int = 4) -> Dict:
    """Indian geomancy — sixteen figures cast into houses.

    The mechanism is Arabic ʿilm al-raml, received into Sanskrit with its own figure names
    and read into the twelve bhāvas rather than the twelve Western houses."""
    out = []
    for i in range(max(1, int(houses))):
        h = hashlib.sha256(f"ramala:{seed}:{i}".encode()).digest()
        idx = int.from_bytes(h[:8], "big") % 16
        sa, rom, meaning = RAMALA_FIGURES[idx]
        out.append({"house": i + 1, "sanskrit": sa, "figure": rom, "meaning": meaning})
    return {"system": "Ramala (रमल)", "of": 16, "figures": out,
            "note": ("The Indian reception of Arabic sand geomancy. The sixteen figures "
                     "are the same sixteen; the names and the house scheme are Sanskritic.")}


# ══════════════════════════════════════════════════════════════════════════════
# SĀMUDRIKA and SINHALA NEKATH — frameworks, stated as such
# ══════════════════════════════════════════════════════════════════════════════

SAMUDRIKA_MARKS = {
    "padma": "the lotus — on the palm, a mark of wealth and of religious merit",
    "chakra": "the discus — authority; on the sole, one who travels and rules",
    "shankha": "the conch — fame and long life",
    "matsya": "the fish — prosperity, and the favour of water",
    "dhwaja": "the flag — high position won publicly",
    "ankusha": "the goad — control over others, and over oneself",
    "kamala": "the lotus-seat — refinement, learning, and grace",
    "swastika": "the auspicious cross — protection and continuity",
}
SAMUDRIKA_LINES = {
    "ayu": "the life line — vitality and constitution, not lifespan",
    "matri": "the head line — reasoning and its style",
    "pitri": "the heart line — feeling, and how it is given",
    "dhana": "the fate line — livelihood and its steadiness",
}


def samudrika_framework() -> Dict:
    """The Sāmudrika vocabulary. Deliberately not a reading.

    Sāmudrika Śāstra reads proportion, marks and lines from an observed body. This module
    cannot observe one, and generating a reading from a birth date would be inventing a
    system that does not work that way. The vocabulary is given so a reading can be
    entered against it."""
    return {"system": "Sāmudrika Śāstra (सामुद्रिक शास्त्र)",
            "marks": SAMUDRIKA_MARKS, "lines": SAMUDRIKA_LINES,
            "computed": False,
            "limit": ("Sāmudrika reads an observed body — proportions, marks and lines. It "
                      "is not derived from a birth date, and producing one from a birth "
                      "date would be a different system wearing its name.")}


SINHALA_NEKATH = {
    "punya_kalaya": "the neutral hour between the old year and the new, when no work is "
                    "done and only religious observance is proper",
    "aluth_avurudu": "the moment the Sun enters Meṣa — the New Year proper, timed to the "
                     "minute by the nekath committee",
    "ganu_denu": "the auspicious minute for the first transaction of the year",
    "hisa_thel_gama": "the anointing of oil, timed and directional",
    "vada": "the moment for resuming work, with a prescribed direction to face",
}


def sinhala_nekath() -> Dict:
    """Sri Lankan auspicious-timing practice.

    Indian in mechanism and distinct in use: the nekath are published annually to the
    minute by a state-appointed committee, and the whole country observes them
    simultaneously — which is not how muhūrta works anywhere else."""
    return {"system": "Sinhala Nekath (නැකත්)", "observances": SINHALA_NEKATH,
            "computed": False,
            "note": ("The times are set annually by a committee and published, rather than "
                     "derived per person. Reproducing them requires that year's almanac; "
                     "the observances and their order are given here.")}


assert len(NAKSHATRAS) == 28, "the chakra keeps Abhijit, making 28"
assert len(RAMALA_FIGURES) == 16
assert sum(t[2] for t in TATTVA) == 60, "the five tattvas must fill the hour"
assert all(_VEDHA[_VEDHA[k]] == k for k in _VEDHA), "vedha must be mutual"
assert len(SVARA) == 3
