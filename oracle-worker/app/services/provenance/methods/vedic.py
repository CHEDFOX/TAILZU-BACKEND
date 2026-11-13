"""
PROVENANCE · METHODS — Jyotish (BPHS, Jaimini, Tajika, KP, Prashna, Muhurta).

Each declaration names the work a technique comes from, the code that computes it, and
what it does NOT claim. `verified=False` throughout means: the work is certain, the exact
chapter has not yet been checked against a printed edition (see registry.render_citation).
"""
from app.services.provenance.registry import (
    method, DETERMINISTIC, PARAMETRIC, INTERPRETIVE,
)

# ═══════════════════════════════════════════════════════════════════════════
# LEVEL 1 — the natal substrate
# ═══════════════════════════════════════════════════════════════════════════

method(
    id="rashi_chart",
    name="Rashi (D-1) chart",
    system="bphs", level=1, determinacy=PARAMETRIC,
    sources=("bphs", "brihat_jataka", "surya_siddhanta"),
    inputs=("birth_datetime_utc", "latitude", "longitude", "ayanamsha", "house_system"),
    outputs=("planet_longitudes_sidereal", "house_cusps", "ascendant", "rashi_placements"),
    scope="personal",
    steps=("Swiss Ephemeris tropical longitudes at the birth instant",
           "subtract the chosen ayanamsha to obtain sidereal longitudes",
           "assign each 30° sidereal arc to its rashi",
           "compute the ascendant and house cusps for the geographic position"),
    assumptions=("A specific ayanamsha has been chosen — Lahiri is this platform's default. "
                 "The choice shifts every placement and is a genuine, unresolved dispute "
                 "within the tradition, not a settled fact.",
                 "Birth time is accurate to the minute; the ascendant moves roughly 1° "
                 "every 4 minutes."),
    limitations=("Ayanamsha disagreement between schools (Lahiri, Raman, KP, Fagan-Bradley) "
                 "reaches ~2° in the present era, which can move a planet across a rashi "
                 "boundary and change the entire reading.",),
    related=("navamsa", "ashtakavarga"),
    implemented_in="app.services.core.ephemeris",
    also_known_as=("birth chart", "natal chart", "d1", "janma kundali"),
)

method(
    id="navamsa",
    name="Navamsa (D-9) and the varga scheme",
    system="bphs", level=1, determinacy=DETERMINISTIC,
    sources=("bphs", "brihat_jataka", "phaladeepika"),
    inputs=("planet_longitudes_sidereal",),
    outputs=("d9_placements", "divisional_placements"),
    scope="personal",
    steps=("divide each 30° rashi into nine 3°20′ parts",
           "map each part to a rashi by the classical starting rule for the sign's element",
           "repeat with the divisor for other vargas (D-2 … D-60)"),
    assumptions=("The BPHS varga-mapping rule is used. Alternative schemes exist for the "
                 "higher vargas and do not always agree.",),
    limitations=("Above roughly D-30 the divisions are finer than realistic birth-time "
                 "precision — a D-60 placement is only as trustworthy as a birth time "
                 "recorded to the second, which almost none are.",),
    deps=("rashi_chart",),
    implemented_in="app.services.charts",
    also_known_as=("d9", "varga", "divisional charts", "amsa"),
)

method(
    id="shadbala",
    name="Shadbala (sixfold planetary strength)",
    system="bphs", level=1, determinacy=PARAMETRIC,
    sources=("bphs", "saravali"),
    inputs=("rashi_chart", "birth_datetime_utc", "latitude"),
    outputs=("sthana_bala", "dig_bala", "kala_bala", "cheshta_bala", "naisargika_bala",
             "drik_bala", "total_rupas"),
    scope="personal",
    steps=("compute each of the six strength components in virupas",
           "sum per planet and convert to rupas (60 virupas = 1 rupa)",
           "compare against the classical minimum threshold for each planet"),
    assumptions=("BPHS component formulae and thresholds. Editions differ on several "
                 "sub-computations, notably cheshta bala.",),
    limitations=("Implementations across the market genuinely disagree — two correct-looking "
                 "shadbala engines can differ by 15%+ on the same chart because the source "
                 "text is ambiguous about intermediate rounding and about how cheshta bala "
                 "treats retrograde motion.",),
    deps=("rashi_chart",),
    implemented_in="app.services.parashara.shadbala_complete",
    also_known_as=("planetary strength", "shad bala", "six strengths"),
)

method(
    id="ashtakavarga",
    name="Ashtakavarga (bindu scoring)",
    system="bphs", level=1, determinacy=DETERMINISTIC,
    sources=("bphs", "phaladeepika", "prashna_marga"),
    inputs=("rashi_chart",),
    outputs=("bhinnashtakavarga", "sarvashtakavarga", "sodhya_pinda"),
    scope="personal",
    steps=("for each planet, award a bindu to houses counted from each contributor "
           "per the classical tables",
           "sum per sign for the individual (bhinna) charts",
           "add across planets for the sarva total",
           "apply trikona and ekadhipatya reduction for sodhya pinda"),
    assumptions=("The BPHS contribution tables are used verbatim.",),
    limitations=("The reduction steps (sodhana) are described tersely and implementations "
                 "differ in their order of operations.",),
    deps=("rashi_chart",),
    implemented_in="app.services.parashara.ashtakavarga",
    related=("shadbala",),
    also_known_as=("ashtaka varga", "bindus", "sav", "bav"),
)

method(
    id="yogas",
    name="Yogas (planetary combinations)",
    system="bphs", level=1, determinacy=INTERPRETIVE,
    sources=("bphs", "saravali", "phaladeepika", "jataka_parijata"),
    inputs=("rashi_chart", "navamsa"),
    outputs=("yoga_list", "yoga_strength"),
    scope="personal",
    steps=("test each catalogued combination's geometric condition against the chart",
           "record which conditions fired and which source defines each"),
    assumptions=("A yoga is present when its stated geometric condition holds. The classical "
                 "texts rarely specify cancellation rules completely.",),
    limitations=("The corpus contains thousands of named yogas with overlapping and "
                 "occasionally contradictory definitions; several fire on a majority of "
                 "charts, which makes their presence far less informative than the "
                 "literature's tone implies. Sources disagree on cancellation (bhanga).",),
    deps=("rashi_chart", "navamsa"),
    implemented_in="app.services.parashara.yogas",
    also_known_as=("raja yoga", "dhana yoga", "combinations"),
)

# ═══════════════════════════════════════════════════════════════════════════
# LEVEL 4 — timing
# ═══════════════════════════════════════════════════════════════════════════

method(
    id="vimshottari_dasha",
    name="Vimshottari Dasha",
    system="bphs", level=4, determinacy=DETERMINISTIC,
    sources=("bphs", "laghu_parashari"),
    inputs=("moon_longitude_sidereal", "birth_datetime_utc"),
    outputs=("mahadasha_sequence", "antardasha_sequence", "period_boundaries"),
    scope="personal",
    steps=("locate the Moon's nakshatra and the elapsed fraction of it",
           "the nakshatra lord opens the sequence; the balance of its period equals the "
           "unelapsed fraction × that lord's years",
           "the remaining eight lords follow in the fixed Vimshottari order",
           "subdivide each period by the same proportions for antardasha and below"),
    assumptions=("A 120-year total cycle and the fixed lord ordering.",
                 "Proportional subdivision continues at every level."),
    limitations=("Entirely dependent on the ayanamsha, since it is keyed to the Moon's "
                 "sidereal position — a 2° ayanamsha difference can shift period "
                 "boundaries by years.",
                 "Other dasha systems (Ashtottari, Kalachakra, Chara) apply to the same "
                 "chart and produce different periods; the tradition offers rules for "
                 "choosing between them, but they are not decisive."),
    deps=("rashi_chart",),
    related=("ashtottari_dasha", "chara_dasha", "annual_profection"),
    implemented_in="app.services.dashas.vimshottari",
    also_known_as=("vimsottari", "dasha", "mahadasha", "planetary periods"),
)

method(
    id="chara_dasha",
    name="Chara Dasha (Jaimini)",
    system="jaimini", level=4, determinacy=INTERPRETIVE,
    sources=("jaimini_sutras",),
    inputs=("rashi_chart",),
    outputs=("sign_period_sequence",),
    scope="personal",
    steps=("determine the direction of counting from the ascendant's sign",
           "assign each sign a period length by the count to its lord",
           "order the signs by the directional rule"),
    assumptions=("One reading of the Jaimini sutras. This platform follows the "
                 "Raghunatha/Sanjay Rath line of interpretation.",),
    limitations=("The sutras are aphoristic and the major commentaries genuinely disagree "
                 "on both period length and direction — two competent Jaimini astrologers "
                 "can produce different Chara Dashas from the same chart and both be "
                 "defensible.",),
    deps=("rashi_chart",),
    related=("vimshottari_dasha", "jaimini_karakas"),
    implemented_in="app.services.dashas.chara_dasha",
)

method(
    id="gochara",
    name="Gochara (transits over the natal chart)",
    system="bphs", level=4, determinacy=DETERMINISTIC,
    sources=("bphs", "phaladeepika"),
    inputs=("rashi_chart", "target_datetime"),
    outputs=("transit_positions", "moon_relative_houses", "vedha_status"),
    scope="personal",
    steps=("compute sidereal positions for the target moment",
           "count each transiting planet's position from the natal Moon",
           "apply the classical benefic/malefic house results and the vedha obstruction rules"),
    assumptions=("Transits are counted from the Moon (Chandra lagna), the BPHS convention, "
                 "rather than from the ascendant as in Western practice.",),
    limitations=("Classical gochara is stated without reference to the dasha running "
                 "concurrently; the texts do not specify how to weigh the two when they "
                 "conflict, which is left to the practitioner.",),
    deps=("rashi_chart",),
    implemented_in="app.services.transits",
    also_known_as=("transits", "gochar", "vedic transits"),
)

method(
    id="varshaphal",
    name="Varshaphal (Tajika annual chart)",
    system="tajika", level=4, determinacy=PARAMETRIC,
    sources=("tajika_neelakanthi",),
    inputs=("rashi_chart", "solar_return_instant"),
    outputs=("annual_chart", "muntha", "year_lord", "sahams"),
    scope="personal",
    steps=("find the instant the Sun returns to its natal sidereal longitude",
           "erect a chart for that instant",
           "advance the muntha one sign per completed year",
           "select the year lord (varshesha) by the Tajika weighting rules"),
    assumptions=("Tajika aspect orbs and sahams are Perso-Arabic in origin and follow "
                 "different rules from Parashari drishti.",),
    limitations=("Tajika technique should NOT be blended with Parashari rules — its "
                 "aspects, orbs and lots come from a different lineage and the two systems "
                 "will contradict each other when mixed.",),
    deps=("rashi_chart",),
    related=("solar_return", "annual_profection"),
    implemented_in="app.services.tajika.varshaphal",
    also_known_as=("varshphal", "annual chart", "tajika", "solar return vedic"),
)

# ═══════════════════════════════════════════════════════════════════════════
# KP — a modern system, labelled as such
# ═══════════════════════════════════════════════════════════════════════════

method(
    id="kp_sublord",
    name="KP sub-lord division",
    system="kp", level=1, determinacy=PARAMETRIC,
    sources=("krishnamurti_readers",),
    inputs=("planet_longitudes_sidereal", "house_cusps_placidus"),
    outputs=("star_lord", "sub_lord", "sub_sub_lord", "cuspal_sublords"),
    scope="personal",
    steps=("divide each nakshatra in Vimshottari proportions to obtain the sub-lord",
           "recurse for the sub-sub division",
           "read each house cusp's sub-lord as the significator of that house's matters"),
    assumptions=("The KP (Krishnamurti) ayanamsha and PLACIDUS house cusps — both "
                 "deliberate departures from Parashari practice.",),
    limitations=("KP dates from the 1960s. It is internally consistent but is not a "
                 "classical method, and its results should not be presented as the "
                 "verdict of the ancient tradition.",
                 "Requires birth-time accuracy to the minute or better; the cuspal "
                 "sub-lord changes far faster than the ascendant sign."),
    deps=("rashi_chart", "vimshottari_dasha"),
    implemented_in="app.services.kp.sublords",
    also_known_as=("kp", "krishnamurti paddhati", "sub lord", "cuspal sublord"),
)

# ═══════════════════════════════════════════════════════════════════════════
# Branch systems
# ═══════════════════════════════════════════════════════════════════════════

method(
    id="jaimini_karakas",
    name="Chara Karakas (Jaimini significators)",
    system="jaimini", level=1, determinacy=INTERPRETIVE,
    sources=("jaimini_sutras",),
    inputs=("planet_longitudes_sidereal",),
    outputs=("atmakaraka", "karaka_ranking"),
    scope="personal",
    steps=("rank the planets by degrees traversed within their sign, highest first",
           "assign the karaka roles in that order"),
    assumptions=("The seven-karaka scheme is used. Whether Rahu is included — giving eight "
                 "— is disputed between schools and changes every assignment below the "
                 "one it displaces.",),
    limitations=("The seven- vs eight-karaka dispute is unresolved in the sutras themselves.",),
    deps=("rashi_chart",),
    implemented_in="app.services.jaimini.karakas",
    also_known_as=("atmakaraka", "chara karaka", "karakas"),
)

method(
    id="prashna",
    name="Prashna (horary judgement)",
    system="prashna", level=1, determinacy=INTERPRETIVE,
    sources=("prashna_marga", "shatpanchasika"),
    inputs=("question_datetime", "latitude", "longitude"),
    outputs=("prashna_chart", "arudha", "verdict_indicators"),
    scope="horary",
    steps=("erect a chart for the moment the question is asked and understood",
           "read the ascendant and its lord as the querent, the relevant house as the matter",
           "apply the classical omens and arudha rules"),
    assumptions=("The chart is cast for the moment of ASKING, and the question must be "
                 "sincere and not previously asked — a condition the texts state and no "
                 "software can verify.",),
    limitations=("Prashna's validity conditions are behavioural, not computational. The "
                 "engine can compute the chart but cannot establish that the question met "
                 "the classical preconditions.",),
    implemented_in="app.services.prashna.prashna_refined",
    also_known_as=("horary", "prasna", "question chart"),
)

method(
    id="muhurta",
    name="Muhurta (electional timing)",
    system="muhurta", level=1, determinacy=DETERMINISTIC,
    sources=("muhurta_chintamani", "kalaprakasika", "prashna_marga"),
    inputs=("date_range", "latitude", "longitude", "activity_type"),
    outputs=("panchanga_factors", "ranked_windows", "dosha_flags"),
    scope="electional",
    steps=("compute the five panchanga limbs for each candidate moment",
           "apply the activity-specific rules and exclusions",
           "rank the surviving windows"),
    assumptions=("Sunrise-based day reckoning at the given location.",),
    limitations=("The classical rules were written for a specific latitude band; the "
                 "day-division logic degrades at high latitudes where sunrise/sunset "
                 "intervals become extreme or undefined.",),
    deps=("rashi_chart",),
    implemented_in="app.services.muhurta.muhurta_complete",
    also_known_as=("electional", "auspicious time", "mahurat", "muhurat"),
)
