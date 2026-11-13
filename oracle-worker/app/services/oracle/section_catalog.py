"""
SECTION CATALOG — telling the classifier what each section actually IS.

The classifier chooses which data sections a question needs, from a list of 181 names. It
was shown those names and nothing else:

    aspects, configurations, progressions, solar_return, lunar_return, solar_arc,
    lilith, fortune, fixed_stars, void_moon, ...

For obvious ones that works. For `hayz`, `almuten`, `mrityu_bhaga`, `pancha_pakshi`,
`xiao_yun`, `fan_fu_yin`, `pillar_overlay` or `rp_timing` it does not — some are technical
terms the model may half-know, and several are internal coinages it cannot know at all. It
was picking them by inference from the identifier, which means the wrong data reached the
Oracle whenever the guess was wrong.

Meanwhile the planner's toolbox has always been described properly:

    - big_three(none): Sun, Moon and Rising — the core identity, emotions, persona.

This module gives the section list the same treatment, from two places:

  HARVESTED  Each sections.py already carries a display title per section
             ('progressions': ('SECONDARY PROGRESSIONS', …)). Those are read at import, so
             a renamed section cannot drift out of sync with its description.

  EXPLICIT   Where the title adds nothing over the key, or the term is genuinely opaque, a
             one-line gloss below. These say what the section ANSWERS, not what it is
             called — the classifier is choosing by relevance to a question, so "the
             degrees held fatal in each sign" is useful where "MRITYU BHAGA" is not.
"""
import re
import pathlib
from typing import Dict, List

_ROOT = pathlib.Path(__file__).resolve().parents[3]

_SECTION_FILES = [
    "app/services/western/sections.py",
    "app/services/chinese/sections.py",
    "app/services/kp/sections.py",
    "app/services/mandala/sections.py",
    "app/services/oracle/sections_bphs.py",
]

# Both registration forms in use across those modules, in either quote style.
# mandala/sections.py registers with double quotes ("power_map": ("ASTRO...",)),
# so a single-quote-only pattern harvested nothing from it and all 21 of its
# titles were silently dropped.
_PATTERNS = [
    r"""['"]([a-z_0-9]+)['"]\s*:\s*\(\s*['"]([^'"]+)['"]""",
    r"""SECTION_MAP\[\s*['"]([a-z_0-9]+)['"]\s*\]\s*=\s*\(\s*['"]([^'"]+)['"]""",
]


def _harvest_titles() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for rel in _SECTION_FILES:
        p = _ROOT / rel
        if not p.exists():
            continue
        try:
            body = p.read_text()
        except Exception:
            continue
        for pat in _PATTERNS:
            for key, title in re.findall(pat, body):
                out.setdefault(key, title)
    return out


_TITLES = _harvest_titles()


# ══════════════════════════════════════════════════════════════════════════════
# EXPLICIT GLOSSES — what the section ANSWERS, phrased for choosing by relevance
# ══════════════════════════════════════════════════════════════════════════════

GLOSS: Dict[str, str] = {
    # ── Jyotish ────────────────────────────────────────────────────────────
    "dashas_full": "the full planetary period sequence — what governs which years",
    "alt_dashas": "period systems other than Vimshottari (Ashtottari, Kalachakra, Chara)",
    "pratyantar": "the finest period subdivisions — timing within weeks",
    "dasha_sandhi": "the junctions between periods, where conditions change sharply",
    "dasha_psychology": "the inner tenor of the running period, not its events",
    "yoga_timing": "when a chart's combinations actually activate",
    "argala": "intervention — which houses assist or obstruct another",
    "arudha_padas": "how a matter APPEARS to others, as against how it is",
    "upapada": "the marriage indicator in the arudha scheme",
    "bhrigu_bindu": "the Rahu-Moon midpoint, read as a point of destiny",
    "mrityu_bhaga": "the degrees held fatal or critical in each sign",
    # Named by what it ANSWERS, not by what it is called: nobody asks about
    # Gulika, they ask why something is taking so long or why it keeps ending
    # the same way. The Sanskrit is in there too so a question that does name it
    # still lands.
    "upagrahas": ("the sub-planets — Gulika/Maandi, Mrityu, Kaala, Ardhaprahara, "
                  "Yamaghantaka and the Sun's shadow points; read for where a life "
                  "drags, delays and hardens, for abrupt endings, obstruction, "
                  "and matters that go astray"),
    "pancha_pakshi": "the five-bird Tamil timing system — daily activity windows",
    "pada_archetypes": "the archetype of each nakshatra quarter",
    "d60_past_life": "the shashtiamsa chart, read for karmic inheritance",
    "remaining_vargas": "the divisional charts not covered by the main ones",
    "graha_shanti": "propitiation remedies for afflicted planets",
    "sudarshana": "the three-wheel view — from Sun, Moon and Ascendant together",
    "shodhya_pinda": "the reduced ashtakavarga total used for finer judgement",
    "av_sodhana": "the reduction steps applied to ashtakavarga bindus",
    "prastara_av": "the expanded ashtakavarga table, planet by planet",
    "av_transits": "transits read against the ashtakavarga bindu counts",
    "ishta_kashta": "the benefic and malefic potential each planet carries",
    "rashi_drishti": "sign-to-sign aspects, as distinct from planetary aspects",
    "bhava_chalit": "the house chart as against the sign chart — where planets really sit",
    "bhava_strengths": "which houses are strong and which are undermined",
    "special_lagnas": "alternative ascendants (Bhava, Hora, Ghati) for specific matters",
    "chart_promise": "whether the chart promises a matter at all, before timing it",
    "maraka": "the planets that mark endings and closures",
    "longevity": "the classical lifespan-range judgement",
    "female_horoscopy": "the classical chapters addressed specifically to women's charts",
    # Worded as the OTHER HALF of the wealth verdict, not as a poverty topic. Read
    # as "poverty", it never matched a question phrased "will I be rich" — so the
    # one section saying wealth is DENIED went unpicked on exactly the questions
    # it settles, and dhana_yogas answered alone.
    "daridra_yogas": "the poverty combinations — the counterweight to the wealth yogas; "
                     "belongs with any money question, since this is what says wealth is DENIED",
    "period_query": "what a specific named period holds",
    "timing_windows": "the openings ahead when action is favoured",
    "hora": "the planetary hour — the ruler of this part of the day",
    "house_detail": "one house in depth — its lord, occupants, aspects and strength",

    # ── KP ─────────────────────────────────────────────────────────────────
    "cuspal_interlinks": "how the house cusps' sub-lords chain into each other",
    "stellar_theory": "the star-lord logic that drives KP judgement",
    "untenanted": "houses with no planet in them, and what stands for them instead",
    "fruitfulness": "the childbirth indicators in KP terms",
    "rp_timing": "timing by the ruling planets of the moment",
    "ruling_now": "the ruling planets active right now",
    "four_level": "the four-level lord chain — sign, star, sub, sub-sub",
    "sensitive_points": "the degrees where a matter is decided",
    "kp_profession": "the KP reading of career and livelihood",
    "lost_object": "the KP method for locating something missing",
    "event_promise": "whether the chart promises the event, before any timing",
    "dba_timing": "dasha-bhukti-antara timing to the level of days",

    # ── Western ────────────────────────────────────────────────────────────
    "almuten": "the planet with most dignity at a point — the chart's overall ruler",
    "hayz": "a planet in its own sect, gender and place — a traditional strength",
    "sect": "whether the chart is of the day or the night, which reverses much judgement",
    "planetary_joys": "the houses each planet traditionally rejoices in",
    "planetary_nodes": "where each planet crosses the ecliptic, not just the Moon's nodes",
    "decennials": "a Hellenistic time-lord system of ten years and nine months per planet",
    "converse": "directions run BACKWARD in time, read for what was already set",
    "tertiary": "progressions at one lunar month per year of life",
    "prenatal": "the eclipse or lunation immediately before birth",
    "prog_lunation": "the progressed Sun-Moon phase — the ~29-year chapter of a life",
    "void_moon": "whether the Moon perfects no further aspect — nothing comes of it",
    "fortune": "the Lot of Fortune — the body, livelihood and material circumstance",
    "mutual_receptions": "planets sitting in each other's dignity, able to help each other",
    "full_dignities": "the complete essential dignity scoring, all five classes",
    "configurations": "aspect patterns — t-squares, grand trines, yods",
    "electional": "choosing a moment to begin something",
    "western_horary": "answering a question from the chart of the moment it was asked",

    # ── Chinese ────────────────────────────────────────────────────────────
    "na_yin": "the sixty sound-element attributions of the pillar pairs",
    "xiao_yun": "the annual minor luck pillar, inside the ten-year one",
    "dayun_onset": "the age at which the luck pillars begin, and why",
    "fan_fu_yin": "reversed and repeated pillar patterns, read as disruption",
    "empty_branches": "the void branches — present on paper but unable to act",
    "life_stages": "the twelve-stage life cycle of each stem",
    "yong_shen": "the Useful God — the element that restores balance",
    "gods_matrix": "how the Ten Gods interact with each other, not just with the self",
    "hidden_strength": "the hidden stems inside each branch, weighted",
    "pillar_overlay": "the current pillars laid over the natal ones",
    "extended_stars": "the symbolic stars beyond the core set",
    "zi_wei": ("Zi Wei Dou Shu — the twelve palaces with their stars and brightness, the "
               "Five Elements Bureau, and the four transformations. A separate system, "
               "not a BaZi variant: it answers by LIFE AREA (marriage, wealth, career, "
               "parents, children, property, health) where BaZi answers by element "
               "balance, so any question aimed at one domain of life belongs here"),
    "zi_wei_timing": ("the Zi Wei ten-year limits (大限) and the current annual palace — "
                      "which palace is running now and until what age; belongs with any "
                      "question about WHEN, or about what this period of life is for"),
    "chinese_medical": "the constitutional reading in Chinese medical terms",
    "date_selection": "choosing an auspicious date, Chinese method",
    "feng_shui": "the directional and spatial reading",

    # ── Mandala (astrocartography) ─────────────────────────────────────────
    "power_map": "where on earth each planet's lines fall strongest",
    "best_cities": "which places suit which purposes for this person",
    "here_now": "what the current location is doing to the chart",
    "compass": "which direction to face or move for a given aim",
    "local_space": "the directional lines radiating from where they stand",
    "geodetic_zodiac": "the zodiac mapped onto longitude on the earth itself",
    "parans": "bodies crossing the angles simultaneously at a latitude (Brady)",
    "sacred_sites": "significant places relative to this chart",
    "eclipse_geography": "where eclipses fall on the map, for this person",
    "migration_roadmap": "a sequence of places over time rather than one",
    "time_place_score": "how a specific place scores at a specific time",
    "danger_zones": ("PLACES — named cities and regions the chart flags as difficult. "
                     "This is astrocartography and answers WHERE, not which way: a "
                     "question about compass DIRECTIONS to travel or move belongs to "
                     "Nine Star Ki directionology, not here"),
    "relationship_geography": "where partnership is favoured",
    "active_direction": "which direction is live for them now",
    "location_weather": "the current transit climate at a given place",
    "country_year": "the year ahead for a country rather than a person",
    "personal_mundane": "where a person's chart meets world events",
    "coordinate_mundane": "the mundane reading for a set of coordinates",
    "globe_scan": "a sweep of the whole map for the strongest points",
    "travel_windows": "when travel is favoured, and where to",
    "relocation": "the chart recast for a different birthplace",

    # ── the engines added in this series ───────────────────────────────────
    "type": "Human Design type — Generator, Projector, Manifestor, Reflector",
    "strategy": "how this type is meant to engage — respond, wait, inform",
    "authority": "where their reliable decision signal actually comes from",
    "profile": "the two-line profile — how they learn and how they are met",
    "defined_centres": "which energy centres are fixed rather than open",
    "channels": "the defined channels between centres",
    "gene_keys": "the four Gene Keys spheres — Shadow, Gift and Siddhi levels",
    "moon_mansion": "which of the 28 Arabic lunar mansions the Moon occupies",
    "sun_mansion": "which lunar mansion the Sun occupies",
    "pluto_intention": "what the soul is working on across lifetimes, on this school's account",
    "polarity_point": "the degree opposite Pluto — the direction of intended growth",
    "south_node": "the entrenched pattern, over-relied on under pressure",
    "north_node": "the unfamiliar direction where growth lies",
    "ju": "the Qi Men configuration for this moment — yin or yang dun, and which number",
    "duty_chief": "the governing star of the moment, and where it lands",
    "duty_envoy": "the governing door, and where it moves to",
    "doors": "the Eight Doors — rest, life, injury, block, view, death, fright, open",
    "stars": "the Nine Stars across the palaces",
    "spirits": "the Eight Spirits — chief, snake, moon, harmony, tiger, warrior, earth, heaven",
    "four_lessons": "the four paired branches read from the day's stem and branch",
    "three_transmissions": "how the matter begins, develops and ends",
    "twelve_generals": "the twelve heavenly generals seated around the plate",
    "ti_yong": "the querent trigram against the matter trigram — the whole verdict",
    "changed": "the hexagram the situation is transforming into",
    "cyclic_index": "how clustered the slow planets are — Barbault's world measure",
    "clustering": "whether the outer planets are gathered or dispersed right now",
    "pair_cycles": "where each slow-planet pair stands in its own cycle",
    "siderograph": "Bradley's market curve — turning points only, never direction",
    "turning_points": "where the curve reverses",
    "barycentre_offset": "how far the Sun sits from the solar system's centre of mass",
    "angular_momentum": "the Sun's orbital momentum about that centre",
    "hypothesis": "the contested claim built on the barycentric mechanics",
    "taiyi_palace": "which of the eight palaces Tai Yi occupies this era",
    "host": "the established party — defender, incumbent",
    "guest": "the arriving party — challenger, attacker",
    "favoured": "which of the two the configuration favours",
    "gua": "the personal trigram number, from birth year and sex",
    "group": "East or West group — which directions suit them",
    "favourable_directions": "the four directions that support them",
    "unfavourable_directions": "the four to avoid",
    "wuku": "which of the 30 Balinese weeks the day falls in",
    "ten_concurrent_weeks": "all ten Pawukon weeks running at once",
    "urip": "the numeric values that generate the derived weeks",
    "weton": "the day-and-pasaran pair a person is born under",
    "neptu": "the number a weton carries, used for matching and timing",
    "favoured_days": "days that sum favourably with their neptu",
    "mewa": "the numbered square — one of nine, with a colour and a character",
    "parkha": "the trigram, running opposite directions by sex",
    "five_forces": "life-force, body, power, windhorse and soul",
    "day_lord": "which of the eight Thai day-lords governs them",
    "deva": "the presiding deity of that day",
    "birthday_buddha": "the Buddha image associated with the birth day",

    # ── The plain-looking names ────────────────────────────────────────────
    # These read as self-explanatory, so nobody wrote a gloss and the harvested
    # title only restated the key ('DHANA YOGAS' for dhana_yogas). The classifier
    # was choosing them from the identifier alone — which is how a wealth question
    # picked chart_promise and dhana_yogas but missed daridra_yogas, the one
    # section that actually said wealth was DENIED. A name is not a description.

    # Jyotish
    "yogas": "the classical planetary combinations present, and what each promises or denies",
    "raja_yogas": "the combinations for power, rank and rise — whether this chart carries them at all",
    "dhana_yogas": "the wealth-giving combinations — whether money is promised, and through what channel",
    "jaimini": "the Jaimini reading — kāraka planets and sign-based logic, a second opinion on the same life",
    "jaimini_complete": "the full Jaimini treatment at once — chara daśās, arūḍhas and kārakas together",
    "afflictions": "what in the chart is damaged or under strain — gaṇḍānta, sade sati, doṣas and their weight",
    "remedies": "what to actually DO about a weak or afflicted planet — gem, mantra, day, charity",
    "classical_rules": "the verbatim BPHS rules that fire on this chart, with the verse each comes from",
    "bphs_advanced": "the rarer BPHS techniques, past the standard reading",
    "personality": "the inner nature and the outer manner — temperament, and how they meet people",
    "nakshatra_profile": "the birth star — its deity, symbol and gaṇa, and what it makes of the mind",
    "compatibility": "how two charts meet — the match score and where it holds or strains (needs partner birth data)",
    "synastry": "chart laid against chart — where two people bind, clash and pull (needs partner birth data)",
    "composite": "the relationship read as a chart in its own right, with its own nature (needs partner birth data)",
    "prashna": "answering from the moment the question was asked, when birth data cannot settle it",
    "ashtakavarga": "the bindu scores — which houses and signs are fed and which are starved",
    "divisional_charts": "the vargas (D2–D60) — the dedicated chart for money, marriage, career or parents",
    "career_aptitude": "which work this chart is actually built for — the fields, aptitudes and shape of the profession",
    "dasha_interpretation": "what the running period means for THIS person, rather than the generic reading of it",
    "life_timeline": "the whole life laid out as chapters, year by year",
    "future_transits": "where the planets will stand later, and which houses they will light or press",
    "transit_aspects": "how the moving planets are touching the natal ones right now",
    "planetary_returns": "when a planet comes back to its birth position, and what each return opens",
    "weekly_forecast": "the coming week, day by day",
    "daily_snapshot": "today in brief — the mood, the opening, the thing to leave alone",
    "panchanga": "the five limbs of a day — tithi, nakṣatra, yoga, karaṇa, weekday",
    "muhurta_rules": "choosing an auspicious moment to begin something",
    "tithi_pravesh": "the lunar-day return chart governing the year ahead",
    "numerology": "the birth and destiny numbers, and the arc they say the life bends toward",
    "name_numerology": "what a particular name totals to, and whether it supports the chart or fights it",
    "baby_names": "auspicious starting syllables drawn from the birth nakṣatra",
    "vastu": "the directions and layout of a dwelling — where to sleep, sit and work",

    # KP
    "significators": "which planets actually deliver each house, ranked strongest first — the core of KP",
    "ruling_planets": "the planets ruling this very moment, used to confirm or deny an event",
    "transit_triggers": "the transits that fire a promised event into actually happening",
    "fortuna": "the Part of Fortune — where ease, luck and material good land",

    # Western
    "aspects": "the angles between planets — which tensions and which gifts, and how exact",
    "element_balance": "how much fire, earth, air and water — what this chart is rich in and starved of",
    "retrogrades": "which planets were moving backwards at birth, and what that turns inward",
    "solar_return": "the birthday chart for the year ahead, and the theme it sets",
    "lunar_return": "the monthly chart — the emotional weather of the coming month",
    "zodiacal_releasing": "the Hellenistic timing technique — peak chapters and the turning points between them",
    "arabic_parts": "the calculated lots — fortune, spirit, marriage and the rest",
    "fixed_stars": "the named stars touching the chart, and the reputations they carry",
    "antiscia": "mirrored degrees — hidden links between planets sharing a solstice axis",
    "asteroids": "Ceres, Pallas, Juno, Vesta and Chiron — nurture, craft, partnership, devotion, the wound",

    # Chinese (BaZi)
    "four_pillars": "the BaZi chart itself — year, month, day and hour as stems and branches",
    "day_master": "the element that IS this person, and whether it stands strong or weak",
    "ten_gods": "the ten relations to the day master — wealth, authority, output, resource, peers",
    "branch_interactions": "how the earthly branches combine, clash, punish or harm each other",
    "stem_interactions": "how the heavenly stems bond or fight across the pillars",
    "symbolic_stars": "the BaZi stars — nobleman, peach blossom, travelling horse and the rest",
    "annual_luck": "this year's stem and branch against the chart — the fortune of the year itself",

    # Chinese, previously orphaned — computed and registered, but in no catalog,
    # so no question could ever reach them.
    "bagua": "the eight trigrams — which one governs them, and what it asks of a space or a choice",
    "loshu_grid": "the 3x3 magic square of their birth numbers — which cells are full and which stand empty",
    "lunar_calendar": "the Chinese lunar date, month and year animal behind a Western date",
    "stems_branches": "the heavenly stems and earthly branches themselves, and what each pairing carries",
    "yin_yang": "the balance of yin and yang across the chart — where it tips, and what that costs",

    # ── The titles that only restated the term ─────────────────────────────
    # 'NAVAMSA (D9)', 'KP MEDICAL', 'CURRENT TRANSITS': the harvested title named the
    # technique, not what it answers. A model that knows Jyotish can bridge that; a
    # search by meaning (oracle/subsystems.py) cannot, and "when will I marry" never
    # landed near "navamsa (d9)". Each now says what it is FOR, in the words people ask in.

    # Jyotish
    "transits": "where the planets stand now and which houses they light or press — the weather of this year and month",
    "navamsa": "the D9 marriage chart — the spouse, the marriage and its quality, and the inner strength behind the birth chart",
    "dasamsa": "the D10 career chart — profession, status, promotion and recognition in work",
    "medical": "health and the body — the vulnerable organs, the periods of illness, recovery and vitality",
    "nadi": "the Bhrigu Nandi Nadi reading — what each life area holds, from the planets joined together",
    "annual": "the year ahead (varshaphal) — what this year of life brings, month by month",
    "shadbala": "the six-fold strength of each planet — which planets can deliver their promise and which are too weak to",
    "transit_deep": "the heavy transits in depth — Saturn's sade sati, retrogrades, and the coming months scored",
    "chakra": "the seven chakras by their ruling planets — which energy centres are open, weak or blocked",
    "muhurta": "the auspicious time to begin something — a wedding, a move, a business, a purchase",
    "past_events": "a past event read against the chart — why it happened then, to confirm the reading",
    "lucky": "lucky numbers, colours, days and mantras for this chart",
    "spiritual": "the spiritual path — renunciation yogas and the soul's purpose (karakamsa)",
    "manglik": "Mangal dosha — whether Mars troubles marriage, how strongly, and whether it is cancelled",
    "gemstones": "which gemstones to wear for which planet, and which to avoid",
    "location": "how the place they live works for them — whether it supports the chart or drains it",
    "daily_guidance": "today — the day's ruling planet, the Moon's phase and the hour, and what to do with the day",
    "numerology_today": "today in numbers — the personal day and its lucky number",

    # KP
    "cusps": "the house cusps' sub-lords — KP's verdict on what each house can and cannot give",
    "horary": "answering one question from a number (1–249) or the moment it is asked — will it happen, yes or no",

    # Western
    "progressions": "the progressed chart — how the person has grown inwardly, and the life chapter they are in now",
    "solar_arc": "solar arc directions — the major life events and turning points the coming years are timed to",
    "lilith": "Black Moon Lilith — desire, the refused or shamed part, and where they will not be tamed",
    "profections": "annual profections — which house and which planet rule this year of their life",
    "midpoints": "midpoints — the sensitive points between two planets where events are triggered",
    "harmonics": "harmonic charts — hidden talents and patterns of creativity, attraction and effort",

    # Chinese
    "elements": "the five elements (wood, fire, earth, metal, water) — which are strong, which are missing, what balances them",
    "luck_periods": "the ten-year luck pillars (da yun) — the decade a life is in, and what each decade brings",

    # ── The wider council ──────────────────────────────────────────────────
    # The 34 signature systems in MINOR_SYSTEMS are shown to the cross-system
    # router in exactly the same way the big five are, so an undescribed name
    # costs precision the same way. Several keys are shared between systems
    # (day_sign by Mayan and Aztec, element by Nine Star Ki, Mahabote and
    # Tibetan, value and letters by isopsephy and abjad), and GLOSS is flat —
    # so these are worded to hold for each.

    # ── The world catalogue: the fifty systems added to close the index ──────
    # Many of these are FRAMEWORKS rather than computations — they read a hand, a
    # face, a cup or a cast, and are not derived from a birth date. Their glosses
    # say so, so the router does not reach for them expecting a natal answer.

    # The last six — the systems that closed the index.
    "guolao_houses": "Guo Lao Xing Zong — China's HOROSCOPIC astrology before BaZi "
                     "displaced it: twelve houses and eleven bodies, sidereal, and "
                     "recognisably kin to Hellenistic and Indian practice",
    "four_invisible": "the four unseen bodies of Guo Lao — Rahu and Ketu (the lunar "
                      "nodes), Yuebei (the lunar apogee, a real point) and Ziqi, which is "
                      "hypothetical and flagged as such",
    "condition_number": "Tie Ban Shen Shu — the Iron Plate condition numbers derived from "
                        "the four pillars; famous for naming a querent's family, and its "
                        "twelve-thousand-verse book is lineage-held and not public",
    "sanhe_frame": "San He — which of the four trinities a site's sitting direction "
                   "belongs to; the form-and-water school of feng shui",
    "water_exit": "where water leaves a site, judged on the twelve stages — the central "
                  "San He operation, and the one Flying Star does not address at all",
    "celestial_animals": "the four landform guardians — azure dragon, white tiger, "
                         "vermilion bird, black tortoise — and the faults when they are "
                         "wrongly proportioned",
    "thap_than": "the ten gods in Vietnamese Tứ Trụ, computed in the Vietnamese calendar "
                 "and clock; the Vietnamese zodiac keeps the CAT where China keeps the rabbit",
    "dung_than": "dụng thần — the element a Vietnamese Tứ Trụ chart most needs",
    "sibilla_cards": "the Italian Sibilla — fifty-two cards that name situations and "
                     "people outright, read narratively rather than combined",
    "seasonal_calendar": "an Aboriginal Australian seasonal calendar for a NAMED nation — "
                         "D'harawal or Yolŋu. A calendar of land and sky, never of persons; "
                         "there is no Aboriginal astrology and any 'star sign' is invented",
    "emu_constellation": "the Emu in the Sky — the dark-cloud constellation in the Milky "
                         "Way, read for emu breeding season by its posture",

    # Chinese popular practice.
    "bone_weight": "Cheng Gu — the four pillars weighed in 兩 and 錢; a total between 2.1 "
                   "and 7.2 that indexes a life-verse. Widely used in China",
    "weight_band": "which band the bone weight falls in — from 極輕 (everything earned) to "
                   "極重 (exceptional fortune and its burden)",
    "flying_star": "Xuan Kong Fei Xing — the Flying Star feng shui chart of a building, "
                   "from its period and facing direction; the most consulted feng shui "
                   "method in living practice",
    "mountain_star": "the Flying Star governing health and relationships in a palace",
    "water_star": "the Flying Star governing wealth in a palace",
    "annual_star": "this year's star overlaid on a Flying Star chart",
    "xiao_position": "Xiao Liu Ren — the small six ren, counted on the finger joints; a "
                     "rapid yes/no-shaped answer for a moment, not a birth",
    "lot_stick": "the numbered stick that fell from the Kau Chim cylinder, of 100",
    "lot_grade": "the temple grade printed beside a Kau Chim poem — 上上籤 through 下下籤",
    "ling_figure": "Ling Qi Jing — one of 125 figures from twelve cast counters in three ranks",

    # Korean and Japanese.
    "geot_gunghap": "겉궁합 — the OUTER Korean compatibility match, from the two birth-year "
                    "animals; the public layer",
    "sok_gunghap": "속궁합 — the INNER Korean compatibility match, from the two day masters; "
                   "the layer a practitioner actually weights, and it can disagree with the outer",
    "kakusu": "the stroke counts of a written Japanese name — the raw material of Seimei "
              "Handan; NOT derivable from a birth date",
    "jinkaku": "人格 — the core field of a Japanese name reading, from the last surname "
               "character plus the first given character",
    "soukaku": "総格 — the whole-name field of a Japanese name reading; the life taken together",
    "judai_shusei": "十大主星 — the ten major stars of Sanmei-gaku, its own lattice over the pillars",
    "juni_daijusei": "十二大従星 — the twelve attendant stars of Sanmei-gaku, each carrying an "
                     "energy value 1-12; their sum is the constitution",

    # Runes, cards and lots.
    "younger_runes": "the sixteen-stave Younger Futhark — the Viking-age row, a different "
                     "instrument from the Elder twenty-four rather than a subset",
    "futhorc_runes": "the twenty-nine-stave Anglo-Saxon Futhorc, read against the Old "
                     "English Rune Poem",
    "kipper_layout": "a Kipper spread — read by DISTANCE and DIRECTION from the two "
                     "significator cards, not by combination as Lenormand is",
    "playing_cards": "a cartomancy draw from the fifty-two — suit and rank only, no trumps; "
                     "the tradition that predates Tarot's divinatory use",
    "omikuji_grade": "the Japanese shrine fortune slip, from 大吉 to 大凶",
    "lot_cast": "cleromancy — the fall of dice, knucklebones or marked stones; the oldest "
                "divination mechanism, and deliberately free of interpretation",
    "book_passage": "bibliomancy — the passage a book falls open at; which book is opened "
                    "is the whole of the practice",

    # Western medical.
    "humour": "the humoural temperament — sanguine, choleric, phlegmatic or melancholic — "
              "weighted from the Ascendant and its lord, the Moon and the season",
    "melothesia": "the zodiacal man — which region of the body each sign governs, and "
                  "which regions the malefics press on",
    "critical_days": "decumbiture — when an illness turns, from the Moon's motion since it "
                     "began; the classical 3½, 7, 10½ and 14 day crises",

    # Islamic letter sciences.
    "zairja_extraction": "the Zāʾirja letter extraction — Ibn Khaldūn's mechanical device "
                         "for turning a question and a moment into a letter sequence",
    "jafr_value": "the Jafr value of a name or question, and its reduction",
    "letter_element": "which of the four elemental classes each Arabic letter belongs to, "
                      "and which of the 28 lunar mansions it answers to",
    "ghazal_draw": "Fāl-e Ḥāfeẓ — the ghazal of the Dīvān the book falls open at",
    "istikhara_form": "which form of istikhāra — the PRAYER, which yields no drawn answer "
                      "at all, or the Qurʾānic opening, which does",
    "planetary_hour": "the ruling planet of an hour, and what it suits — the backbone of "
                      "Islamic and medieval electional practice",
    "mansion_verdict": "whether the Moon's mansion favours an undertaking now",

    # Indic remainder.
    "svara_channel": "Svara Śāstra — which nostril the breath is flowing through (iḍā, "
                     "piṅgalā or suṣumnā) and what acts that suits RIGHT NOW",
    "tattva": "which of the five elements is running inside the current breath-hour",
    "vedha": "Sarvatobhadra Chakra — whether a transiting malefic strikes the natal "
             "nakṣatra across the grid; the classical transit-affliction test, and the "
             "objection muḥūrta raises against beginning anything",
    "sbc_grid": "the Sarvatobhadra grid itself — 28 nakṣatras on the perimeter with the "
                "rāśis, tithis, vāras and vowels inside, all struck by the same transit",
    "name_placement": "where a PERSON sits on the chakra, from the opening syllable of "
                      "their name against the 108-pada table — how muḥūrta is judged for a "
                      "named individual rather than for a date",
    "tithi_vedha": "which lunar day or weekday a transit condemns for undertakings",
    "arudha_count": "Aṣṭamaṅgala Praśna — the cowrie count and the ārūḍha rāśi it gives; "
                    "Kerala's own horary, distinct from generic praśna",
    "ramala_shield": "the Ramala shield — four mothers the querent supplies, then "
                     "daughters, nieces and two witnesses DERIVED from them; the "
                     "derivation is the method, not a draw per house",
    "ramala_judge": "the Ramala judge — the figure that answers the question, with the "
                    "two witnesses saying how it arrives",
    "ramala_bhavas": "the Ramala shield read into the twelve bhāvas by Indian house "
                     "doctrine; the mathematics is shared with Arabic and European "
                     "geomancy, the reading is what is Indian",
    "body_marks": "Sāmudrika Śāstra — the vocabulary of body marks, proportions and lines. "
                  "Read from an OBSERVED body, never from a birth date",
    "nekath_observances": "Sinhala nekath — the Sri Lankan auspicious moments, set annually "
                          "by committee and observed nationally rather than derived per person",

    # Regional calendars.
    "tithi_status": "Tibetan Kar-tsi — whether a lunar day is SKIPPED (chad) or REPEATED "
                    "(lhag); the behaviour that makes the Tibetan calendar unmappable by "
                    "simple arithmetic",
    "rabjung": "the Tibetan 60-year cycle and the year's position in it",
    "zurhai_sign": "the Mongolian year sign — element and animal in Mongolian",
    "menge": "the Mongolian numbered square, cognate with the Tibetan mewa",
    "khmer_sak": "the Cambodian TEN-year sak cycle paired with the twelve animals — a "
                 "60-year period reckoned differently from the Chinese sexagenary",
    "lao_animal": "the Lao year animal; the dragon is a NAGA here, not a Chinese dragon",
    "oaxacan_daysign": "the 260-day count as kept in Oaxaca — the Zapotec piyè or the "
                       "Mixtec count, with their own day-sign names",
    "tahitian_night": "the Tahitian night of the moon, cognate with the Hawaiian list",
    "kra_din": "the Akan soul-name given by day of birth — Kwame, Ama, Kofi; universal "
               "across Ghana and carried into the diaspora",

    # African.
    "cowrie_odu": "Mérìndínlógún — the sixteen-cowrie odù; cast by òrìṣà priests and read "
                  "from its own corpus, NOT a short form of Ifá",
    "sikidy_tableau": "Sikidy — the Malagasy seed tableau, generated by strict parity rules "
                      "and self-checking; a tableau that fails the test is recast",
    "held_traditions": "Ngombo, Bamana sand divination and Southern African bone throwing — "
                       "named because they exist, NOT computed because their corpora are "
                       "held by initiated practitioners rather than published",

    # European folk.
    "slavic_customs": "attested Slavic folk divination — Svyatki, wax pouring, mirror "
                      "gazing. Note that any 'Slavic zodiac' of twelve signs is a modern "
                      "invention, not a survival",
    "baltic_customs": "Baltic and Finnic folk divination — tin pouring read by its shadow, "
                      "and the Kalevala charm tradition",

    # Body and omen.
    "palm_lines": "the lines of the hand in Western chiromancy — and the life line reads "
                  "vitality, NOT lifespan, which is the commonest error in the whole art",
    "palm_mounts": "the seven planetary mounts of the palm",
    "hand_shape": "the elemental hand shape — earth, air, water or fire — from palm and "
                  "finger proportion",
    "face_age_map": "Mian Xiang — the 百歲流年 hundred-year map assigning every age to a "
                    "position on the face. Fixed, and the one computable part of face reading",
    "face_palaces": "the twelve palaces of the face in Chinese physiognomy",
    "eight_palm_palaces": "Shou Xiang — the Chinese palm read against the eight trigrams "
                          "rather than the seven planets",
    "physiognomy_note": "European physiognomy — catalogued because it existed, and flagged: "
                        "it fed into phrenology and scientific racism and has no empirical support",
    "cup_sectors": "tasseography — where in the cup a shape sits, which fixes its timing "
                   "and whose affairs it concerns",
    "cup_shapes": "the shapes read in tea leaves or coffee grounds; perceived, not computed",
    "scrying_media": "the media of scrying — black mirror, crystal, water, flame, ink",
    "pendulum_convention": "dowsing — the yes/no swing convention, which must be "
                           "re-established by the operator before any question is asked",
    "mole_positions": "moleosophy — the fixed map of what a mole means by where it sits",

    # Final numerology.
    "psychic_number": "the Tamil psychic number from the birth day alone — how you see yourself",
    "name_support": "whether a name NUMBER supports the psychic and destiny numbers — the "
                    "Tamil test, and the reason name spellings are changed in Tamil Nadu",
    "goral_draw": "Goralot — Jewish lot-casting; either the plain biblical lot, which "
                  "carries no interpretation at all, or the Goral ha-Gra counting rule",
    "mazal": "the Hebrew month's sign, tribe and ruling planet — the Talmudic astrological "
             "layer, distinct from Kabbalah",
    "hebrew_planetary_hour": "the ruling planet of an hour in the Talmudic sequence",

    # Gematria beyond the single default method.
    "gematria_methods": "a Hebrew word or name across ALL the gematria methods — "
                        "Hechrachi, Gadol, Katan, Siduri, Ne'elam, Musafi, Kolel, "
                        "Bone'eh and Meshulash — rather than the one absolute value",
    "atbash": "the Hebrew reversal cipher — aleph for tav, bet for shin; the method "
              "Jeremiah used to write Sheshach for Babylon",
    "gematria_equivalence": "whether two Hebrew words are equal, and in HOW MANY methods "
                            "— agreement across several is a strong reading, one alone is weak",

    # The East Asian pillar and star traditions, counted as their own systems.
    "gyeokguk": "the Korean Saju STRUCTURE (격국) — which of the ten gods the month "
                "branch's principal qi makes, and the frame the whole chart hangs on",
    "yongsin": "the element a Korean Saju chart most needs (용신) — what to strengthen, "
               "given whether the day master is strong or weak",
    "sipseong": "the ten gods in Korean Saju (십성) — 비견, 겁재, 식신, 상관, 편재, 정재, "
                "편관, 정관, 편인, 정인 across the four pillars",
    "daeun": "the Korean ten-year luck pillars (대운) and which one is running",
    "sibiunseong": "the twelve life stages (십이운성) — where each pillar sits on the "
                   "cycle from birth to nurture",
    "gwae": "the Tojeong Bigyeol number — one of 144, from Korean age, lunar month "
            "length and lunar day; the Korean New Year annual almanac",
    "sanggwae": "the upper of the three Tojeong numbers — the year's overall weather",
    "junggwae": "the middle Tojeong number — the shape of the year's affairs",
    "hagwae": "the lower Tojeong number — whether the year is favourable, even or guarded",
    "cung": "the twelve palaces of a Vietnamese Tử Vi chart — Mệnh, Phu Thê, Tài Bạch "
            "and the rest",
    "chinh_tinh": "the fourteen major stars of Tử Vi (chính tinh) in their Vietnamese names",
    "cuc": "the Tử Vi bureau (cục) — Thủy nhị, Mộc tam, Kim tứ, Thổ ngũ, Hỏa lục",
    "tu_hoa": "the four transformations in Vietnamese Tử Vi (tứ hóa) — Lộc, Quyền, Khoa, Kỵ",
    "zokan": "the governing hidden stem of the month branch in Japanese Suimei (蔵干), "
             "read by how many days into the solar month the birth falls — the "
             "distinguishing move of the Japanese tradition",
    "tsuhensei": "the ten gods in Japanese Suimei (通変星) across the four pillars",
    "juniun": "the twelve fortunes in Japanese Suimei (十二運)",
    "setsu_days": "days elapsed since the sectional solar term (節入り) that opened the "
                  "month — the number the zōkan table is read against",

    # Mahabote — the Burmese seven-house chart, not merely the day-lord.
    "mahabote_houses": "the Burmese seven-house chart — which planet falls in each of "
                       "Binga, Ahtun, Yaza, Adipati, Marana, Thike and Puti",
    "adipati": "the Burmese house of leadership and prosperity — the strongest of the "
               "seven, and where a life is carried from",
    "marana": "the Burmese house of death and endings — where the danger sits and what "
              "has to be let go of",
    "thike": "the Burmese house of buried treasure — hidden or inherited wealth, what is "
             "found rather than earned",

    # Onmyōdō — the Japanese almanac. Day-quality, never a natal claim.
    "rokuyo": "the six-day Japanese almanac cycle — whether a day is Taian (auspicious) "
              "or Butsumetsu (inauspicious), and what it forbids; about DAYS, not character",
    "junichoku": "the twelve day-officers — what a given day is fit for: beginning, "
                 "closing, healing, burying, contracting",
    "nijuhasshuku": "the twenty-eight lunar mansions of the Japanese almanac",
    "nayin": "the na-yin element of a day or pillar — the sound-element pairing of stem "
             "and branch",

    # Firdaria — Persian time-lords. The Western sibling of the daśā systems.
    "current_lord": "which planet rules the current stretch of life in the Persian "
                    "firdaria, and until what age — a TIMING answer, the Western "
                    "counterpart of a daśā",
    "sub_lord": "the sub-period inside the current firdaria lord — the finer timing within "
                "the ruling planet's term",
    "period_sequence": "the whole 75-year firdaria sequence of nine lords, and where the "
                       "person stands in it",

    # Polynesian moon nights.
    "night": "which of the thirty Hawaiian moon nights (pō) a date falls on, and what that "
             "night is for — planting, fishing, resting, or nothing at all",
    "anahulu": "which ten-night phase of the Hawaiian month — waxing (hoʻonui), full "
               "(poepoe) or waning (emi)",
    "moon_age": "days elapsed since the true new moon",
    "maori_parallel": "the corresponding Māori maramataka night, where one is published — "
                      "offered as a parallel, since iwi differ",

    # Andean / Inca. Season and cosmology; explicitly no natal doctrine.
    "month": "which of the twelve Inca months a date falls in, with its festival and "
             "agricultural work",
    "festival": "the Inca festival belonging to that month — Inti Raymi, Qhapaq Raymi, "
                "Quya Raymi and the rest",
    "solar_anchor": "where a date stands relative to the solstices and equinoxes the Inca "
                    "tracked from Cusco",
    "three_worlds": "the Andean cosmology — Hanan Pacha above, Kay Pacha here, Uku Pacha "
                    "within, and their condor, puma and serpent",

    # Isopsephy and abjad — NAME systems. Both share `value` and `letters`.
    "value": "what a name totals in its own alphabet — Greek isopsephy or Arabic abjad; "
             "needs the name written in that script, and is silent without it",
    "letters": "the letter-by-letter breakdown behind a name's numeric value",
    "digital_root": "the value reduced to a single digit, and what that number carries",
    "maghribi_value": "the same Arabic name in the Maghribi (western) order, which "
                      "genuinely differs from the Mashriqi — both are legitimate",

    "driver_number": "the birth-date number — the temperament they lead with",
    "destiny_number": "the number the whole life bends toward, taken from the full date",
    "name_number": "what the letters of a name total, and whether it supports the birth numbers",
    "personal_year": "which numbered year they are living in now, and what it asks of them",

    "galactic_signature": "the Tzolkin day-sign and tone together — the myth being lived",
    "day_sign": "the sacred day-sign the birth falls on, and the nature it confers",
    "galactic_tone": "the tone, 1 to 13 — the beat that nature moves on",
    "haab": "the solar-calendar station of the birth",
    "long_count": "where the birth sits in the great cycle",

    "tree_sign": "the tree ruling the birth, and the character it lends",
    "ogham": "the ogham letter of the birth and the counsel it carries",
    "seed": "the seed or plant paired with the birth",
    "sacred_number": "the sacred number accompanying the day-sign, and its force",

    "principal_star": "which of the nine stars they are born under",
    "element": "which element governs them in this system",
    "direction": "the compass direction that supports them",
    "trigram": "the trigram governing them",
    "totem": "the birth totem animal and its temperament",
    "clan": "the elemental clan that totem belongs to",

    "planet": "the planet governing the birth in this system",
    "animal": "the animal sign the birth falls under",

    "decan": "the ten-degree decan of the birth and what it rules",
    "ruler": "the planet ruling that division",

    "ruling_solid": "which Platonic solid the birth answers to",
    "pattern": "the underlying geometric pattern it belongs to",

    "base_metal": "the prima materia of this life — the metal to be worked",
    "operation": "the alchemical operation now in play",
    "phase": "the stage of the work they have reached",

    "governing_law": "which of the seven hermetic laws governs them",
    "axiom": "the axiom that law turns on",

    "ruling_phase": "which of the five phases rules them",
    "polarity": "whether yin or yang leads in them",
    "generating_cycle": "where they stand in the generating and controlling cycles",

    "sephirah": "the sphere on the Tree of Life they answer to",
    "world": "which of the four worlds the birth belongs to",
    "path_letter": "the Hebrew letter of their path",

    "colour": "the colour of their day-lord, worn for fortune",
    "nature": "the temperament of the lunar mansion — its character and its use",
    "hexagram": "the hexagram cast for this moment",
    "verdict": "whether the cast favours the asker or drains them",
    "components": "the parts the index is built from",
}


def describe(section: str) -> str:
    """One line saying what this section answers. Empty when nothing is known."""
    key = (section or "").split(":")[0].strip()
    if key in GLOSS:
        return GLOSS[key]
    title = _TITLES.get(key)
    if title:
        # A title only helps when it says more than the key already does.
        flat = title.lower().replace(" ", "_").replace("(", "").replace(")", "").replace("%", "")
        if flat != key:
            return title.lower()
    return ""


def describe_list(sections: List[str], indent: str = "  ") -> str:
    """A described menu, one section per line, for a classifier prompt."""
    out = []
    for s in sections:
        d = describe(s)
        out.append(f"{indent}{s} — {d}" if d else f"{indent}{s}")
    return "\n".join(out)


def coverage() -> Dict:
    """How much of the section list carries a description — the work queue.

    Parses the catalogs out of classifier.py rather than importing it, so this diagnostic
    runs anywhere, including where the module's own dependencies are unavailable."""
    src_path = _ROOT / "app/services/oracle/classifier.py"
    catalogs: Dict[str, str] = {}
    try:
        src = src_path.read_text()
        for const in ("BPHS_SECTIONS", "KP_SECTIONS", "WESTERN_SECTIONS",
                      "CHINESE_SECTIONS", "MANDALA_SECTIONS"):
            m = re.search(const + r'\s*=\s*"""(.*?)"""', src, re.S)
            if m:
                catalogs[const] = m.group(1)
    except Exception:
        return {"total": 0, "described": 0, "pct": 0.0, "by_system": {}}

    total, described = 0, 0
    per: Dict[str, Dict] = {}
    for name, sections in catalogs.items():
        names = [x.strip() for x in str(sections).replace("\n", " ").split(",") if x.strip()]
        d = sum(1 for n in names if describe(n))
        per[name] = {"total": len(names), "described": d,
                     "undescribed": [n for n in names if not describe(n)]}
        total += len(names)
        described += d
    return {"total": total, "described": described,
            "pct": round(100.0 * described / total, 1) if total else 0.0,
            "by_system": per}
