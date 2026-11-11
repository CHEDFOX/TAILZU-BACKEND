"""
PROVENANCE · METHODS — Chinese (BaZi / Ziping, Zi Wei Dou Shu).

BaZi is not astrology in the positional sense — it reads a calendrical encoding of the
birth moment, not planetary positions. Nothing here depends on an ephemeris beyond
solar-term boundaries, which is why its results are independent evidence in the Level 6
consensus rather than a restatement of the same sky.
"""
from app.services.provenance.registry import (
    method, DETERMINISTIC, PARAMETRIC, INTERPRETIVE,
)

method(
    id="four_pillars",
    name="Four Pillars (BaZi chart)",
    system="chinese", level=1, determinacy=PARAMETRIC,
    sources=("yuan_hai_zi_ping", "san_ming_tong_hui"),
    inputs=("birth_datetime_local", "longitude", "solar_term_boundaries"),
    outputs=("year_pillar", "month_pillar", "day_pillar", "hour_pillar", "day_master"),
    scope="personal",
    steps=("determine the year pillar by the solar year, which begins at Li Chun "
           "(~4 February) and NOT at Chinese New Year",
           "determine the month pillar by the solar term (jie qi) containing the birth",
           "determine the day pillar from the continuous sexagenary day count",
           "determine the hour pillar from the two-hour branch and the day stem",
           "the day stem is the day master — the self reference"),
    assumptions=("Solar-term boundaries, not lunar-calendar dates, define year and month. "
                 "Using Chinese New Year for the year pillar is a common and consequential "
                 "error for births in January and early February.",
                 "Whether to apply true solar time correction for longitude is disputed; "
                 "it can shift the hour pillar near a boundary."),
    limitations=("Births within minutes of a solar term boundary need the exact term "
                 "instant, which requires ephemeris precision the classical almanacs "
                 "did not have.",
                 "The day master's relative strength — the pivot of the whole reading — "
                 "is assessed by rules the sources state qualitatively."),
    implemented_in="app.services.chinese.bazi",
    also_known_as=("bazi", "ba zi", "four pillars", "eight characters", "8 characters"),
)

method(
    id="ten_gods",
    name="Ten Gods (shi shen)",
    system="chinese", level=1, determinacy=DETERMINISTIC,
    sources=("yuan_hai_zi_ping", "san_ming_tong_hui"),
    inputs=("four_pillars",),
    outputs=("ten_god_labels", "relational_map"),
    scope="personal",
    steps=("for each stem, compare its element and polarity to the day master",
           "assign the relational label from the ten-fold scheme"),
    assumptions=("Relations are read strictly relative to the day master.",),
    limitations=("The labels describe structural relationships, not fixed life outcomes; "
                 "the classical texts assign meanings that vary with the day master's "
                 "strength, so a label alone is not a reading.",),
    deps=("four_pillars",),
    implemented_in="app.services.chinese.bazi",
    also_known_as=("ten gods", "shi shen", "10 gods"),
)

method(
    id="hidden_stems",
    name="Hidden stems (cang gan)",
    system="chinese", level=1, determinacy=DETERMINISTIC,
    sources=("yuan_hai_zi_ping", "san_ming_tong_hui"),
    inputs=("four_pillars",),
    outputs=("branch_hidden_stems", "weighted_element_totals"),
    scope="personal",
    steps=("expand each earthly branch into its constituent hidden stems",
           "weight the principal, middle and residual qi per the classical tables"),
    assumptions=("The standard hidden-stem table is used; the weighting proportions differ "
                 "between lineages.",),
    limitations=("Element totals depend on the weighting scheme chosen, so two "
                 "implementations can disagree about whether a day master is strong.",),
    deps=("four_pillars",),
    implemented_in="app.services.chinese.bazi",
    also_known_as=("hidden stems", "cang gan", "canggan"),
)

method(
    id="luck_pillars",
    name="Luck pillars (da yun)",
    system="chinese", level=4, determinacy=DETERMINISTIC,
    sources=("yuan_hai_zi_ping", "san_ming_tong_hui"),
    inputs=("four_pillars", "sex", "year_stem_polarity"),
    outputs=("decade_pillars", "start_age"),
    scope="personal",
    steps=("direction of travel is set by the year stem's polarity together with sex",
           "count days to the adjacent solar term and divide by three to get the start age",
           "step the month pillar forward or backward one sexagenary place per decade"),
    assumptions=("The three-days-to-one-year conversion for the starting age.",),
    limitations=("Ten-year granularity is coarse; annual and monthly pillars are needed "
                 "for anything finer, and the sources give no rule for weighing a luck "
                 "pillar against a contrary annual pillar.",),
    deps=("four_pillars",),
    related=("vimshottari_dasha", "zodiacal_releasing"),
    implemented_in="app.services.chinese.bazi",
    also_known_as=("luck pillars", "da yun", "dayun", "luck cycles", "decade luck"),
)

method(
    id="useful_god",
    name="Useful God (yong shen)",
    system="chinese", level=1, determinacy=INTERPRETIVE,
    sources=("di_tian_sui", "qiong_tong_bao_jian"),
    inputs=("four_pillars", "hidden_stems", "birth_month"),
    outputs=("favourable_elements", "unfavourable_elements", "strength_verdict"),
    scope="personal",
    steps=("assess the day master's strength from season, support and drain",
           "identify the element that restores balance",
           "cross-check against the seasonal adjustment table"),
    assumptions=("The balancing model of Di Tian Sui. Competing frameworks exist — "
                 "notably special-structure charts (cong ge) where the ordinary balance "
                 "logic is deliberately inverted.",),
    limitations=("The single most contested judgement in BaZi. Experienced practitioners "
                 "routinely disagree on the useful god for the same chart, and the "
                 "special-structure exceptions have no algorithmic boundary.",),
    deps=("four_pillars", "hidden_stems"),
    implemented_in="app.services.chinese.advanced",
    also_known_as=("useful god", "yong shen", "favourable element", "helpful element"),
)

method(
    id="ziwei_doushu",
    name="Zi Wei Dou Shu (Purple Star)",
    system="chinese", level=1, determinacy=PARAMETRIC,
    sources=("ziwei_doushu",),
    inputs=("birth_datetime_lunar", "sex"),
    outputs=("palace_layout", "star_placements", "major_limits"),
    scope="personal",
    steps=("convert the birth date to the lunar calendar",
           "place the twelve palaces from the birth hour",
           "position Zi Wei and the star series from the lunar day and the Five Elements class"),
    assumptions=("Uses the LUNAR calendar, unlike BaZi which uses solar terms. The two "
                 "systems disagree by design and must not be merged.",),
    limitations=("A separate system from BaZi with its own logic — results should be "
                 "presented as independent testimony, never blended into a BaZi reading.",
                 "Lunar conversion requires an accurate historical Chinese calendar; "
                 "pre-modern dates carry conversion ambiguity."),
    implemented_in="app.services.chinese.ziwei",
    also_known_as=("zi wei", "ziwei", "purple star", "zwds", "dou shu"),
)
