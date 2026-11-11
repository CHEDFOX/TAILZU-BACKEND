"""
PROVENANCE · METHODS — Western (Hellenistic, medieval, modern).

Note the transmission history recorded here: several techniques now presented as "ancient"
reached modern practice through the 1990s Project Hindsight translations after centuries
of disuse. That gap is part of the honest answer to "where does this come from".
"""
from app.services.provenance.registry import (
    method, DETERMINISTIC, PARAMETRIC,
)

method(
    id="tropical_chart",
    name="Tropical natal chart",
    system="western", level=1, determinacy=PARAMETRIC,
    sources=("tetrabiblos", "valens_anthology"),
    inputs=("birth_datetime_utc", "latitude", "longitude", "house_system"),
    outputs=("planet_longitudes_tropical", "house_cusps", "ascendant", "midheaven"),
    scope="personal",
    steps=("compute tropical longitudes at the birth instant",
           "derive the ascendant and midheaven for the geographic position",
           "divide the houses by the selected system"),
    assumptions=("The tropical zodiac measures from the vernal equinox, so signs are "
                 "seasonal positions, not constellations. This is the substantive "
                 "disagreement with sidereal practice, not a technicality.",),
    limitations=("House systems disagree sharply at high latitudes; Placidus is undefined "
                 "beyond the polar circles, where quadrant systems break down entirely.",),
    implemented_in="app.services.western.chart_builder",
    also_known_as=("natal chart", "birth chart", "western chart"),
)

method(
    id="essential_dignity",
    name="Essential dignities",
    system="western", level=1, determinacy=PARAMETRIC,
    sources=("tetrabiblos", "dorotheus", "lilly_ca"),
    inputs=("planet_longitudes_tropical",),
    outputs=("dignity_scores", "rulership", "exaltation", "triplicity", "term", "face"),
    scope="personal",
    steps=("test each planet against the five dignity classes",
           "score by the table in use and total per planet"),
    assumptions=("Lilly's tables are used, with Egyptian terms. Ptolemy's terms differ, "
                 "and triplicity rulers differ between Dorotheus and Ptolemy — this is a "
                 "genuine fork, not a rounding difference.",),
    limitations=("Modern rulerships (Uranus/Neptune/Pluto) are incompatible with the "
                 "traditional scheme and cannot be mixed into it coherently; the platform "
                 "computes the traditional set.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.chart",
    also_known_as=("dignities", "rulership", "exaltation", "almuten"),
)

method(
    id="lots",
    name="Lots (Arabic Parts)",
    system="western", level=1, determinacy=DETERMINISTIC,
    sources=("paulus", "valens_anthology", "bonatti"),
    inputs=("tropical_chart", "sect"),
    outputs=("lot_of_fortune", "lot_of_spirit", "additional_lots"),
    scope="personal",
    steps=("determine sect from whether the Sun is above or below the horizon",
           "apply the sect-appropriate formula (the day and night formulae are reversed)",
           "project the arc from the ascendant"),
    assumptions=("Sect reversal is applied. Ptolemy does NOT reverse the Lot of Fortune by "
                 "sect; Valens and Paulus do. This platform follows Valens.",),
    limitations=("Whether to reverse by sect is a real disagreement among the primary "
                 "sources — the resulting positions differ substantially for night charts.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.arabic_parts",
    also_known_as=("arabic parts", "part of fortune", "lot of fortune", "pars fortunae"),
)

method(
    id="annual_profection",
    name="Annual profections",
    system="western", level=4, determinacy=DETERMINISTIC,
    sources=("valens_anthology", "paulus", "brennan_hellenistic"),
    inputs=("tropical_chart", "target_date"),
    outputs=("profected_house", "year_lord"),
    scope="personal",
    steps=("advance one whole sign per completed year from the ascendant",
           "the ruler of the arrived-at sign becomes the lord of the year"),
    assumptions=("Whole-sign houses and a birthday-to-birthday year.",),
    limitations=("Trivially simple to compute, which makes it easy to over-read — it "
                 "assigns a theme to a year but carries no information beyond age and "
                 "natal chart.",),
    deps=("tropical_chart",),
    related=("zodiacal_releasing", "varshaphal", "solar_return"),
    implemented_in="app.services.western.timing",
    also_known_as=("profections", "profection", "lord of the year"),
)

method(
    id="zodiacal_releasing",
    name="Zodiacal Releasing",
    system="western", level=4, determinacy=DETERMINISTIC,
    sources=("valens_anthology", "brennan_hellenistic"),
    inputs=("lot_of_spirit", "lot_of_fortune", "tropical_chart"),
    outputs=("l1_periods", "l2_periods", "peak_periods", "loosing_of_the_bond"),
    scope="personal",
    steps=("begin from the sign of the Lot of Spirit (or Fortune for bodily matters)",
           "assign each sign its planetary period years in zodiacal order",
           "subdivide for lower levels and mark the loosing of the bond"),
    assumptions=("Valens's period lengths, and Spirit as the starting lot for career and "
                 "action.",),
    limitations=("Recovered from Valens in the 1990s Project Hindsight translations after "
                 "centuries of disuse — it is genuinely ancient in origin but has almost "
                 "no continuous tradition of practice behind it, so there is little "
                 "accumulated craft knowledge about its failure modes.",),
    deps=("lots", "tropical_chart"),
    related=("annual_profection",),
    implemented_in="app.services.western.hellenistic",
    also_known_as=("zr", "zodiacal releasing from spirit", "releasing"),
)

method(
    id="secondary_progression",
    name="Secondary progressions",
    system="western", level=4, determinacy=DETERMINISTIC,
    sources=("tetrabiblos", "placidus_primum"),
    inputs=("tropical_chart", "target_date"),
    outputs=("progressed_positions", "progressed_angles"),
    scope="personal",
    steps=("one day after birth corresponds to one year of life",
           "compute positions for birth + N days, N = age in years",
           "derive progressed angles by the chosen key"),
    assumptions=("The day-for-a-year key, traced to Ptolemy's directional measure.",),
    limitations=("The day-for-a-year rate is a symbolic convention, not a derived "
                 "quantity — no mechanism is proposed and none of the primary sources "
                 "argues for one.",),
    deps=("tropical_chart",),
    related=("solar_arc", "solar_return"),
    implemented_in="app.services.western.timing",
    also_known_as=("progressions", "secondary progressions", "day for a year"),
)

method(
    id="solar_arc",
    name="Solar arc directions",
    system="western", level=4, determinacy=DETERMINISTIC,
    sources=("placidus_primum",),
    inputs=("tropical_chart", "target_date"),
    outputs=("directed_positions",),
    scope="personal",
    steps=("compute the Sun's secondary-progressed arc from natal",
           "add that arc to every natal body and angle"),
    assumptions=("A uniform arc applied to all points.",),
    limitations=("Because everything moves by the same amount, solar arc preserves all "
                 "natal aspect patterns and can only form NEW aspects to angles and to "
                 "other charts — it cannot reveal internal structure the natal lacks.",),
    deps=("secondary_progression",),
    implemented_in="app.services.western.timing",
    also_known_as=("solar arc", "sa directions"),
)

method(
    id="solar_return",
    name="Solar return chart",
    system="western", level=4, determinacy=PARAMETRIC,
    sources=("valens_anthology", "bonatti"),
    inputs=("tropical_chart", "return_year", "location"),
    outputs=("return_chart",),
    scope="personal",
    steps=("find the instant the Sun returns to its exact natal tropical longitude",
           "erect a chart for that instant at the chosen location"),
    assumptions=("Location choice — birthplace or current residence — materially changes "
                 "the houses. The tradition does not settle this and practitioners split.",),
    limitations=("The relocation question has no classical answer, so two competent "
                 "astrologers produce different return charts for the same person and year.",),
    deps=("tropical_chart",),
    related=("varshaphal", "annual_profection"),
    implemented_in="app.services.predictions.planetary_returns",
    also_known_as=("solar return", "sr", "birthday chart"),
)

method(
    id="primary_directions",
    name="Primary directions",
    system="western", level=4, determinacy=PARAMETRIC,
    sources=("tetrabiblos", "placidus_primum", "bonatti"),
    inputs=("tropical_chart", "target_date"),
    outputs=("directed_arcs", "direction_hits"),
    scope="personal",
    steps=("direct significators to promissors by diurnal rotation",
           "convert the resulting arc to time by the chosen key"),
    assumptions=("A time key (Ptolemy, Naibod, Placidus) must be chosen and the results "
                 "differ measurably between them.",),
    limitations=("The most birth-time-sensitive technique in Western practice — roughly "
                 "4 minutes of clock error moves a direction by about a year. Also the "
                 "least standardised: Placidian, Regiomontanan and Ptolemaic frameworks "
                 "give different hits.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.timing",
    also_known_as=("primary directions", "directions", "pd"),
)
