"""
PROVENANCE · METHODS — dreams, ayurveda, Western technical, regional, feng shui, modern.

Sources are registered here alongside their methods so that load order stays a straight
line: this module runs inside the provenance package, before the library package exists.
Nothing here may cite a work registered in library/works.py.
"""
from app.services.provenance.sources import (
    register, CLASSICAL, MODERN,
)
from app.services.provenance.registry import (
    method, DETERMINISTIC, PARAMETRIC, INTERPRETIVE,
)

# ═══════════════════════════════════════════════════════════════════════════
# SOURCES
# ═══════════════════════════════════════════════════════════════════════════

register("artemidorus_oneirocritica", title="Oneirocritica", author="Artemidorus of Daldis",
         date="2nd c. CE", tradition="greek", language="Greek", kind=CLASSICAL,
         note="The one ancient dream-book to survive whole. Insists that a symbol has no "
              "fixed meaning and must be read against the dreamer's occupation and status "
              "— the principle every later popular dream-book drops.",
         editions=("Robert White, trans. (1975)", "Martin Hammond, trans. (Oxford, 2020)"))

register("svapna_chintamani", title="Svapna Chintamani", author="Jagaddeva",
         date="c. 12th c. CE", tradition="jyotish", language="Sanskrit", kind=CLASSICAL,
         note="Classifies dreams by cause — humoral, experiential, divine — and by the "
              "watch of the night, which determines how soon a dream is held to fulfil.")

register("ibn_sirin_tabir", title="Ta'bir al-Ru'ya", author="attrib. Muhammad Ibn Sirin",
         date="attributed to the 8th c.; the surviving compilations are later",
         tradition="islamic", language="Arabic", kind=CLASSICAL,
         note="The attribution is traditional and the surviving texts are compilations "
              "made well after Ibn Sirin's death. The tradition itself distinguishes true "
              "dreams from the soul's own chatter and holds that only the first may be "
              "interpreted.")

register("zhou_gong_jie_meng", title="Zhou Gong Jie Meng (周公解夢)",
         author="attrib. the Duke of Zhou", date="popular compilations, Ming–Qing",
         tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="A correspondence table, enormously widespread and theoretically thin. It "
              "offers no test of whether a dream is significant, which is a real "
              "difference from the Greek, Sanskrit and Arabic traditions.")

register("charaka_samhita", title="Charaka Samhita", author="Charaka (redacted by Dridhabala)",
         date="c. 2nd c. BCE–2nd c. CE; redaction c. 4th c. CE",
         tradition="ayurveda", language="Sanskrit", kind=CLASSICAL,
         note="The foundational text of internal medicine and the source of the prakriti "
              "framework. Determines constitution by examination, not by chart.",
         editions=("P. V. Sharma, trans.", "R. K. Sharma & Bhagwan Dash, trans."))

register("sushruta_samhita", title="Sushruta Samhita", author="Sushruta",
         date="core c. 6th c. BCE; extant recension c. 3rd–4th c. CE",
         tradition="ayurveda", language="Sanskrit", kind=CLASSICAL,
         note="The surgical counterpart to Charaka, with its own account of the doshas.")

register("addey_harmonics", title="Harmonics in Astrology", author="John Addey",
         date="1976", tradition="western", language="English", kind=MODERN,
         note="Argues that aspects are better understood as harmonics of the circle than "
              "as a list of discrete angles — the most substantial twentieth-century "
              "structural proposal in Western astrology.")

register("jones_sabian", title="The Sabian Symbols in Astrology",
         author="Marc Edmund Jones, with Elsie Wheeler", date="symbols received 1925; "
                                                             "published 1953",
         tradition="western", language="English", kind=MODERN,
         note="The 360 symbols were received by Wheeler in a single session in San Diego "
              "in 1925 and recorded by Jones. Dane Rudhyar's 1973 An Astrological Mandala "
              "is a reformulation with different texts — a separate work, not a variant "
              "reading of the same one.")

register("culpeper_judgement", title="Astrological Judgement of Diseases from the "
                                    "Decumbiture of the Sick",
         author="Nicholas Culpeper", date="1655", tradition="western", language="English",
         kind=CLASSICAL,
         note="The standard English statement of decumbiture. Historical medical "
              "astrology — of interest as a method, not as medicine.")

register("primbon", title="Primbon (Javanese divinatory manuals)",
         author="anonymous compilations", date="manuscript tradition; printed from the "
                                               "19th c.",
         tradition="javanese", language="Javanese", kind=CLASSICAL,
         note="A genre rather than a book. Different Primbon disagree on the divisor used "
              "for weton compatibility — mod 7, 8 and 9 all appear with different result "
              "sets, which is why a reading must say which it used.")

register("balinese_lontar", title="Balinese lontar (palm-leaf) calendrical manuscripts",
         author="anonymous; transmitted by pedanda and balian",
         date="manuscript tradition", tradition="balinese", language="Balinese/Kawi",
         kind=CLASSICAL,
         note="The Pawukon has no single authoritative text and no astronomical anchor — "
              "it is a pure count, fixed only by continuous observance, so its position "
              "can be established from a known reference date and no other way.")

register("vaidurya_karpo", title="Vaidurya Karpo (White Beryl)",
         author="Desi Sangye Gyatso", date="1685", tradition="tibetan",
         language="Tibetan", kind=CLASSICAL,
         note="The standard Tibetan astrological treatise, covering both the elemental "
              "(nag-rtsis) and the Indian-derived calendrical (kar-rtsis) systems.")

register("bazhai_mingjing", title="Ba Zhai Ming Jing (八宅明鏡)", author="attrib. Ruo Guan Daoren",
         date="Qing dynasty", tradition="chinese", language="Classical Chinese",
         kind=CLASSICAL,
         note="The standard Eight Mansions text — the personal gua and its four favourable "
              "and four unfavourable directions.")

register("shen_shi_xuankong", title="Shen Shi Xuan Kong Xue (沈氏玄空學)",
         author="Shen Zhureng", date="1911", tradition="chinese",
         language="Classical Chinese", kind=CLASSICAL,
         note="Published the Flying Star method, which had been transmitted secretly. Most "
              "modern Xuan Kong practice descends from this book.")

register("ra_uru_hu", title="The Human Design System", author="Ra Uru Hu "
                                                             "(Alan Krishna Robert Kraków)",
         date="1987 onward", tradition="modern", language="English", kind=MODERN,
         note="Originates in a mystical experience reported on Ibiza in January 1987. The "
              "system borrows from the Yijing, tropical astrology, the chakra scheme and "
              "Kabbalah but does not descend from them — presentations implying ancient "
              "lineage are inaccurate, and the founder did not claim one.")

register("rudd_gene_keys", title="The Gene Keys", author="Richard Rudd", date="2009",
         tradition="modern", language="English", kind=MODERN,
         note="Derives directly from Human Design; Rudd was a Human Design student. Uses "
              "the same 64 gates and the same two charts, adding the Shadow/Gift/Siddhi "
              "reading. Not independent of it.")

register("ichazo_naranjo", title="The Enneagram of Personality",
         author="Oscar Ichazo; transmitted and psychologised by Claudio Naranjo",
         date="c. 1970", tradition="modern", language="Spanish/English", kind=MODERN,
         note="The FIGURE is Gurdjieff's, taught from c. 1916 as cosmology with no "
              "typology attached. The nine-type personality system is Ichazo's, c. 1970. "
              "Claims of ancient Sufi, desert-father or Pythagorean origin are not "
              "supported by evidence.")

register("green_forrest_ea", title="Evolutionary astrology",
         author="Jeff Green and Steven Forrest", date="1980s; the schools split in the 1990s",
         tradition="western", language="English", kind=MODERN,
         note="Two related schools rather than one. They read the nodal axis differently "
              "and Forrest treats past-life language as metaphor where Green does not.")

# ═══════════════════════════════════════════════════════════════════════════
# METHODS
# ═══════════════════════════════════════════════════════════════════════════

method(
    id="oneiromancy", name="Dream interpretation (cross-tradition)",
    system="dreams", level=1, determinacy=INTERPRETIVE,
    sources=("artemidorus_oneirocritica", "svapna_chintamani", "ibn_sirin_tabir",
             "zhou_gong_jie_meng"),
    inputs=("dream_report", "dreamer_circumstances", "watch_of_night"),
    outputs=("motifs", "per_tradition_readings", "admissibility"),
    scope="personal",
    steps=("apply the tradition's admissibility test — is this dream interpretable at all",
           "identify motifs present in the report",
           "give each tradition's recorded reading of each motif, unmerged"),
    assumptions=("Artemidorus and the ta'bir tradition require the dreamer's circumstances "
                 "before any symbol can be read.",),
    limitations=("The traditions contradict each other and must not be averaged. A dream "
                 "of teeth falling is not the same object in Artemidorus and Zhou Gong.",
                 "Artemidorus was translated into Arabic by Hunayn ibn Ishaq in the 9th "
                 "century and is a direct source for ta'bir — where those two agree it is "
                 "one line, not two.",
                 "Reads nothing astronomical, which makes it independent testimony of the "
                 "birth chart."),
    implemented_in="app.services.dreams",
    also_known_as=("dreams", "dream", "oneiromancy", "dream interpretation", "svapna",
                   "tabir", "zhou gong"),
)

method(
    id="prakriti", name="Ayurvedic prakriti (constitution)",
    system="ayurveda", level=1, determinacy=INTERPRETIVE,
    sources=("charaka_samhita", "sushruta_samhita"),
    inputs=("examination_answers", "or_chart_placements"),
    outputs=("dosha_proportions", "constitution_type"),
    scope="personal",
    steps=("assess build, skin, hair, digestion, sleep, temperament, speech and climate "
           "tolerance",
           "score each toward vata, pitta or kapha",
           "the dominant, or dominant pair, is the constitution"),
    assumptions=("Prakriti is fixed at conception and does not change. Vikriti — current "
                 "imbalance — does, and is a different question.",),
    limitations=("The classical determination is by EXAMINATION, including pulse, "
                 "conducted by a vaidya. The chart-derived route this module also offers "
                 "is an estimate from a correlated system and the two disagree often "
                 "enough that it must never be presented as the person's constitution.",
                 "Not medical advice, diagnosis, or a basis for treatment decisions."),
    implemented_in="app.services.ayurveda",
    also_known_as=("prakriti", "dosha", "ayurveda", "vata", "pitta", "kapha",
                   "constitution", "body type"),
)

method(
    id="draconic_chart", name="Draconic chart",
    system="western", level=1, determinacy=DETERMINISTIC,
    sources=("addey_harmonics",),
    inputs=("tropical_longitudes", "north_node"),
    outputs=("draconic_longitudes",),
    scope="personal",
    steps=("subtract the North Node's longitude from every body, placing the node at 0° Aries",),
    assumptions=(),
    limitations=("The rotation is rigid, so every inter-planetary aspect is IDENTICAL to "
                 "the tropical chart. Draconic changes sign and house symbolism only and "
                 "must never be counted as independent confirmation of anything the "
                 "tropical chart already showed.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.technical",
    also_known_as=("draconic", "draconic chart", "nodal chart"),
)

method(
    id="harmonics", name="Harmonic charts",
    system="western", level=1, determinacy=DETERMINISTIC,
    sources=("addey_harmonics",),
    inputs=("tropical_longitudes", "harmonic_number"),
    outputs=("harmonic_longitudes",),
    scope="personal",
    steps=("multiply every longitude by N and reduce modulo 360",),
    assumptions=("Aspects are treated as harmonics of the circle rather than as discrete "
                 "angles — Addey's central claim.",),
    limitations=("Every harmonic of a chart is derivable from the radix, so no harmonic "
                 "adds information; it re-presents existing geometry. Several harmonics "
                 "of the same chart agreeing is arithmetic, not corroboration.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.technical",
    also_known_as=("harmonic", "harmonics", "5th harmonic", "9th harmonic", "addey"),
)

method(
    id="antiscia", name="Antiscia and contra-antiscia",
    system="western", level=1, determinacy=DETERMINISTIC,
    sources=("lilly_ca", "bonatti"),
    inputs=("tropical_longitudes", "orb"),
    outputs=("antiscion_contacts",),
    scope="personal",
    steps=("reflect each longitude across the solstice axis for the antiscion",
           "reflect across the equinoctial axis for the contra-antiscion",
           "report bodies standing within a tight orb of another's reflection"),
    assumptions=("A 1° orb, per traditional practice — the contact is by declination "
                 "equivalence rather than by visible angle.",),
    limitations=("Invisible in an ordinary aspect grid, which is the point, but also means "
                 "it is easy to over-read: with enough bodies, some contact almost always "
                 "exists.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.technical",
    also_known_as=("antiscia", "antiscion", "contra-antiscion", "solstice points"),
)

method(
    id="sabian_index", name="Sabian degree index",
    system="western", level=1, determinacy=DETERMINISTIC,
    sources=("jones_sabian",),
    inputs=("tropical_longitude",),
    outputs=("sign", "degree_ordinal"),
    scope="personal",
    steps=("locate the ceiling degree — 0°00'–0°59' is the first degree of the sign",),
    assumptions=(),
    limitations=("INDEX ONLY. The 360 symbol texts are not stored. Generating text for a "
                 "degree would mean inventing a Sabian symbol, which is precisely what a "
                 "lookup must never do. Jones's 1925 texts and Rudhyar's 1973 "
                 "reformulation are different works and give different symbols.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.technical",
    also_known_as=("sabian", "sabian symbol", "sabian symbols", "degree symbol"),
)

method(
    id="western_horary", name="Western horary judgement",
    system="western", level=1, determinacy=INTERPRETIVE,
    sources=("lilly_ca", "bonatti"),
    inputs=("question_moment", "latitude", "longitude", "question_topic"),
    outputs=("considerations_verdict", "significators", "perfection"),
    scope="horary",
    steps=("run the considerations before judgement",
           "assign querent and quesited by house rulership",
           "test whether the significators perfect by applying aspect, translation or "
           "collection of light"),
    assumptions=("Traditional rulerships and Placidus quadrant houses. Moieties for orbs.",),
    limitations=("A chart failing the considerations is NOT a chart with a poor answer — "
                 "it is one Lilly holds should not be read. Modern horary routinely drops "
                 "this step, which changes the method into something else.",
                 "Distinct from prashna: different houses, different orbs, different "
                 "preconditions. They are not interchangeable and should not be merged."),
    deps=("tropical_chart", "essential_dignity"),
    related=("prashna",),
    implemented_in="app.services.western.horary",
    also_known_as=("horary", "horary astrology", "lilly", "considerations before judgement"),
)

method(
    id="decumbiture", name="Decumbiture (medical astrology)",
    system="western", level=4, determinacy=DETERMINISTIC,
    sources=("culpeper_judgement",),
    inputs=("moon_at_onset", "moon_now"),
    outputs=("critical_days",),
    scope="horary",
    steps=("measure the Moon's travel since the illness began",
           "mark the 45° stations; 90°, 180° and 270° are the major crises"),
    assumptions=(),
    limitations=("HISTORICAL medical astrology. Not medical advice, not a diagnosis, and "
                 "not a basis for any decision about treatment. It describes what "
                 "Culpeper's method computes, nothing more.",),
    deps=("tropical_chart",),
    implemented_in="app.services.western.horary",
    also_known_as=("decumbiture", "medical astrology", "critical days", "culpeper"),
)

method(
    id="western_election", name="Western electional astrology",
    system="western", level=1, determinacy=INTERPRETIVE,
    sources=("bonatti", "lilly_ca"),
    inputs=("candidate_moment", "purpose_house"),
    outputs=("fitness", "problems"),
    scope="electional",
    steps=("check the Moon is not void and not in the Via Combusta",
           "check the ascendant and its ruler are sound",
           "check no malefic sits on the ascendant or afflicts the house of the matter"),
    assumptions=("Traditional rulerships only.",),
    limitations=("Distinct from muhurta: different criteria, different day reckoning. The "
                 "two will disagree and neither corrects the other.",),
    deps=("tropical_chart",),
    related=("muhurta",),
    implemented_in="app.services.western.horary",
    also_known_as=("electional", "election", "choosing a date", "western muhurta"),
)

method(
    id="pawukon", name="Pawukon (Balinese 210-day calendar)",
    system="balinese", level=1, determinacy=PARAMETRIC,
    sources=("balinese_lontar",),
    inputs=("day_count", "epoch_offset"),
    outputs=("wuku", "ten_concurrent_weeks", "urip"),
    scope="calendrical",
    steps=("locate the day in the 210-day cycle",
           "read all ten concurrent weeks, which advance together",
           "derive dasawara and dwiwara from the urip sums"),
    assumptions=("The cycle has NO astronomical anchor. Its position can only be fixed "
                 "from a known reference date, which the caller supplies.",),
    limitations=("The four-, eight- and nine-day weeks cannot divide 210 and their opening "
                 "days are held fixed at the start of each cycle. Sources differ on "
                 "exactly which days repeat, so those three carry more uncertainty than "
                 "the rest.",),
    implemented_in="app.services.regional.pawukon",
    also_known_as=("pawukon", "wuku", "balinese calendar", "kajeng kliwon"),
)

method(
    id="weton", name="Weton and neptu (Javanese)",
    system="javanese", level=1, determinacy=PARAMETRIC,
    sources=("primbon",),
    inputs=("day_of_week", "pasaran", "partner_neptu"),
    outputs=("weton", "neptu", "compatibility"),
    scope="personal",
    steps=("pair the seven-day week with the five-day pasaran",
           "sum the neptu values",
           "for a match, add both neptu and take the remainder"),
    assumptions=("Both the mod-7 and mod-8 readings are computed and labelled. Primbon "
                 "manuscripts also use mod 9 with a further result set.",),
    limitations=("The divisors give different answers and Primbon sources disagree about "
                 "which is correct. Presenting one as the reading would be a choice "
                 "disguised as a fact.",
                 "Reads nothing astronomical — pure arithmetic on two calendar cycles, "
                 "which makes it independent testimony."),
    implemented_in="app.services.regional.weton",
    also_known_as=("weton", "neptu", "pasaran", "javanese", "primbon", "jodoh"),
)

method(
    id="lunar_mansions", name="Manazil al-Qamar (28 lunar mansions)",
    system="islamic", level=1, determinacy=PARAMETRIC,
    sources=("dorotheus", "bonatti"),
    inputs=("longitude", "frame"),
    outputs=("mansion", "nature"),
    scope="personal",
    steps=("divide the ecliptic into 28 arcs of 12°51'26\"",),
    assumptions=("Tropical frame, per normal Islamic astrological usage. Some Indo-Persian "
                 "work applies them sidereally, which shifts every boundary.",),
    limitations=("NOT the same system as the 27 nakshatras — different count, different "
                 "spans, normally a different frame. Whether one borrowed from the other "
                 "or both from a Babylonian ancestor is unsettled. Treating them as "
                 "equivalent would collapse two separate witnesses into one.",),
    deps=("planetary_positions",),
    related=("nakshatra_division",),
    implemented_in="app.services.regional.mansions",
    also_known_as=("lunar mansions", "manazil", "arabic mansions", "28 mansions"),
)

method(
    id="tibetan_elemental", name="Tibetan elemental astrology (nag-rtsis)",
    system="tibetan", level=1, determinacy=PARAMETRIC,
    sources=("vaidurya_karpo",),
    inputs=("birth_year", "gender", "mewa_anchor", "parkha_anchor"),
    outputs=("animal", "element", "mewa", "parkha", "five_forces"),
    scope="personal",
    steps=("animal and element from the 60-year cycle",
           "mewa from the nine-year cycle against a stated anchor",
           "parkha from the eight-fold cycle, running in opposite directions by gender"),
    assumptions=("Mewa and parkha anchors are explicit parameters — published tables "
                 "disagree on the anchoring, and the parkha additionally reverses by "
                 "gender.",),
    limitations=("Elemental (nag-rtsis) layer only. The Indian-derived kar-rtsis "
                 "calendrical system is separate and is not computed.",
                 "Shares the animal and element cycle with BaZi and is NOT independent of "
                 "it on those two factors; the mewa and parkha layers are its own."),
    implemented_in="app.services.regional.tibetan_thai",
    related=("four_pillars",),
    also_known_as=("tibetan", "nag rtsis", "jungtsi", "mewa", "parkha", "windhorse",
                   "lungta"),
)

method(
    id="thai_horasat", name="Thai Horasat day-lords",
    system="thai", level=1, determinacy=DETERMINISTIC,
    sources=("brihat_jataka",),
    inputs=("day_of_week", "born_at_night"),
    outputs=("day_lord", "deva", "colour", "birthday_buddha"),
    scope="personal",
    steps=("assign the day-lord, splitting Wednesday into day and night halves",),
    assumptions=("Thai practice gives EIGHT day-lords, with Rahu governing Wednesday "
                 "night. This is native to Thai astrology and has no Indian counterpart.",),
    limitations=("Only the day-lord layer is implemented. Full Thai Horasat uses a "
                 "sidereal chart with its own house scheme, which is not computed here.",),
    implemented_in="app.services.regional.tibetan_thai",
    also_known_as=("thai", "horasat", "thai astrology", "birthday buddha", "day colour"),
)

method(
    id="ba_zhai", name="Ba Zhai (Eight Mansions feng shui)",
    system="chinese", level=1, determinacy=PARAMETRIC,
    sources=("bazhai_mingjing",),
    inputs=("chinese_solar_year", "gender"),
    outputs=("gua_number", "group", "four_favourable", "four_unfavourable"),
    scope="personal",
    steps=("reduce the solar year to a single digit",
           "apply the gender formula to obtain the gua",
           "read the four favourable and four unfavourable directions from the gua"),
    assumptions=("The CHINESE SOLAR year beginning at Li Chun (~4 Feb). Using the "
                 "Gregorian year is the most common error in gua calculation and moves "
                 "every January birth to the wrong gua.",),
    limitations=("A form-school method: it never changes with time. It will disagree with "
                 "Flying Star, which is time-bound, and neither corrects the other — they "
                 "measure different things.",
                 "Distinct from Indian vastu, which works from the Vastu Purusha mandala "
                 "and fixed directional deities."),
    implemented_in="app.services.chinese.fengshui",
    related=("flying_star",),
    also_known_as=("ba zhai", "eight mansions", "gua number", "kua number", "feng shui"),
)

method(
    id="flying_star", name="Xuan Kong Flying Star (玄空飛星)",
    system="chinese", level=4, determinacy=PARAMETRIC,
    sources=("shen_shi_xuankong",),
    inputs=("construction_year", "facing_degrees", "current_year"),
    outputs=("period", "base_stars", "facing_palace", "annual_star"),
    scope="mundane",
    steps=("determine the 20-year construction period",
           "fly the period star through the nine palaces",
           "locate the facing and sitting palaces from the facing degrees",
           "overlay the annual star"),
    assumptions=("Period 9 runs 2024–2043.",),
    limitations=("Mountain (山星) and water (向星) stars are NOT computed. Their derivation "
                 "depends on which of the three sub-divisions the facing falls in and on "
                 "replacement-star rules that differ between lineages; picking one "
                 "silently would produce a confident chart that half of practitioners "
                 "would call wrong.",
                 "A compass-school method, time-bound, and will disagree with Ba Zhai."),
    implemented_in="app.services.chinese.fengshui",
    related=("ba_zhai",),
    also_known_as=("flying star", "xuan kong", "feng shui period", "annual star"),
)

method(
    id="human_design", name="Human Design bodygraph",
    system="modern", level=1, determinacy=PARAMETRIC,
    sources=("ra_uru_hu",),
    inputs=("birth_longitudes", "design_longitudes_88_degrees_prior"),
    outputs=("gates", "channels", "defined_centers", "type", "strategy", "authority",
             "profile"),
    scope="personal",
    steps=("map each longitude to one of 64 gates of 5.625°, subdivided into 6 lines",
           "compute the design chart at 88° of solar arc before birth",
           "a channel is defined when both its gates are active",
           "a centre is defined when a channel reaches it",
           "type follows from which centres are defined and whether a motor reaches the "
           "throat"),
    assumptions=("The gate wheel is asserted to be a permutation of 1–64 and the "
                 "gate→centre map to cover all 64, but the wheel ORDER has not been "
                 "verified against an official source.",
                 "Design is 88° of solar ARC, not 88 days."),
    limitations=("A 1987 synthesis originating in a reported mystical experience, NOT an "
                 "ancient system. It borrows from the Yijing, tropical astrology, the "
                 "chakras and Kabbalah without descending from any of them.",
                 "Because it is built FROM the tropical chart, it is not independent "
                 "testimony of it — agreement between a Human Design reading and an "
                 "astrological one is partly structural."),
    deps=("tropical_chart",),
    related=("yijing_consultation",),
    implemented_in="app.services.modern.human_design",
    also_known_as=("human design", "bodygraph", "generator", "projector", "manifestor",
                   "reflector", "authority", "hd"),
)

method(
    id="gene_keys", name="Gene Keys",
    system="modern", level=1, determinacy=INTERPRETIVE,
    sources=("rudd_gene_keys", "ra_uru_hu"),
    inputs=("human_design_gates",),
    outputs=("activation_sequence_spheres",),
    scope="personal",
    steps=("take the four primary spheres from the Personality and Design Sun and Earth",
           "read each key at the Shadow, Gift and Siddhi levels"),
    assumptions=(),
    limitations=("Derives directly from Human Design and uses the same gates and charts. "
                 "It is NOT a second system agreeing with Human Design and must never be "
                 "counted as independent corroboration of it.",),
    deps=("human_design",),
    implemented_in="app.services.modern.human_design",
    also_known_as=("gene keys", "genekeys", "shadow gift siddhi", "activation sequence"),
)

method(
    id="enneagram", name="Enneagram of Personality",
    system="modern", level=1, determinacy=INTERPRETIVE,
    sources=("ichazo_naranjo",),
    inputs=("self_identified_type",),
    outputs=("type", "centre", "wings", "stress_and_growth_movements"),
    scope="psychological",
    steps=("identify the type by its core motivation, not its behaviour",
           "read the centre, the wings, and the stress and growth movements"),
    assumptions=("Type is established by self-identification, not computed from anything.",),
    limitations=("NOT a divinatory system and nothing is derived from a birth moment. It "
                 "belongs beside the others as a different kind of object.",
                 "The FIGURE is Gurdjieff's, c. 1916, taught as cosmology with no "
                 "typology. The nine-type system is Ichazo's, c. 1970. Claims of ancient "
                 "Sufi, desert-father or Pythagorean origin are not supported."),
    implemented_in="app.services.modern.enneagram",
    also_known_as=("enneagram", "type 4", "wing", "ennea"),
)

method(
    id="evolutionary_astrology", name="Evolutionary astrology",
    system="western", level=1, determinacy=INTERPRETIVE,
    sources=("green_forrest_ea",),
    inputs=("pluto_position", "nodal_axis", "ruler_positions"),
    outputs=("evolutionary_intention", "entrenched_pattern", "direction_of_growth"),
    scope="psychological",
    steps=("read Pluto's house and sign as the evolutionary intention",
           "read the South Node and its ruler as the entrenched pattern",
           "read the North Node and Pluto's polarity point as the direction out"),
    assumptions=("Two related schools, split in the 1990s. Green systematises through "
                 "Pluto's polarity; Forrest reads the nodal axis more independently and "
                 "treats past-life language as metaphor.",),
    limitations=("DECLINES PREDICTION ON PRINCIPLE. It describes intention and pattern, "
                 "not events, and must not be admitted as testimony about what will "
                 "happen.",
                 "Uses ordinary tropical placements, so it shares its substrate with every "
                 "other Western method and is not independent of them.",
                 "The past-life framing is the school's language. This platform records "
                 "what the school holds and makes no claim about anyone's history."),
    deps=("tropical_chart",),
    implemented_in="app.services.modern.evolutionary",
    also_known_as=("evolutionary astrology", "jeff green", "steven forrest", "south node",
                   "soul astrology", "pluto polarity"),
)
