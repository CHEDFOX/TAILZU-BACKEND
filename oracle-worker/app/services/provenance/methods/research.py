"""
PROVENANCE · METHODS — Level 2, the research modules.

The rule for this layer: a module belongs here only if it can be stated as computational
logic AND its evidential status can be stated honestly. That second condition is why the
negative results (Carlson 1985, Dean & Kelly 2003) are registered as first-class sources
rather than omitted — a research layer that cites only what flatters it is not a research
layer.

Note the `determinacy=STATISTICAL` marker. It tells the Level 6 consensus engine that
these modules describe population-level tendencies and must NEVER be weighted as evidence
about an individual chart. A statistical finding about eminent athletes says nothing about
the person asking.
"""
from app.services.provenance.registry import method, DETERMINISTIC, STATISTICAL

method(
    id="barbault_cyclic_index",
    name="Barbault cyclic index",
    system="research", level=2, determinacy=DETERMINISTIC,
    sources=("barbault_1967",),
    inputs=("date_range",),
    outputs=("index_series", "troughs", "peaks"),
    scope="mundane",
    steps=("for each of the ten pairs among the five outer planets, take the angular "
           "separation in degrees",
           "sum the separations across all pairs for each date",
           "a low sum indicates clustering (conjunction-heavy), a high sum dispersion",
           "plot the series to locate troughs"),
    assumptions=("The index is purely geometric — it is fully determined by planetary "
                 "positions and involves no interpretation whatsoever.",),
    limitations=("Barbault proposed troughs as indicators of international crisis. The "
                 "index itself is exactly computable and we compute it exactly; whether it "
                 "tracks historical events is a separate empirical claim that has not been "
                 "established under pre-registered conditions. Retrospective matching of "
                 "troughs to crises is vulnerable to the fact that some crisis is always "
                 "available to match.",
                 "MUNDANE scope only. It says nothing about an individual."),
    implemented_in="app.services.mundane.barbault",
    also_known_as=("cyclic index", "barbault index", "planetary cyclic index",
                   "andre barbault", "barbault"),
)

method(
    id="gauquelin_sectors",
    name="Gauquelin diurnal sector analysis",
    system="research", level=2, determinacy=STATISTICAL,
    sources=("gauquelin_1955", "ertel_1988", "carlson_1985"),
    inputs=("birth_datetime_utc", "latitude", "longitude", "cohort"),
    outputs=("diurnal_sector", "sector_frequency", "cohort_comparison"),
    scope="statistical",
    steps=("divide the diurnal circle into 12 (or 36) sectors by rising and culmination",
           "place each birth's planets into sectors",
           "compare observed sector frequencies against a demographically-modelled "
           "expectation, not a flat one"),
    assumptions=("The expectation model must account for the real non-uniformity of birth "
                 "times across the day and the seasonal distribution of births — this is "
                 "where most naive replications go wrong.",),
    limitations=("STATISTICAL ONLY. This module compares GROUPS. It must never be surfaced "
                 "as a statement about the individual asking — a sector frequency in a "
                 "cohort of eminent athletes carries no information about one person.",
                 "Evidential status is genuinely contested: Gauquelin reported the effect, "
                 "Ertel's eminence-ranked reanalysis supported it, and independent "
                 "replications by the CFEPP and the Committee for Skeptical Inquiry did "
                 "not confirm it. The honest summary is 'disputed, not established'.",
                 "Requires accurate recorded birth times, which biases any cohort toward "
                 "countries and eras with good birth registration."),
    implemented_in="app.services.patterns.studies",
    note="Registered so the platform can compute and display the comparison transparently, "
         "with its contested status attached — not as a claim that the effect is real.",
    also_known_as=("mars effect", "gauquelin", "plus zones", "diurnal sectors"),
)

method(
    id="pattern_discovery",
    name="Falsification-gated pattern discovery",
    system="research", level=5, determinacy=STATISTICAL,
    sources=("carlson_1985", "dean_kelly_2003"),
    inputs=("signal_table", "outcome_labels", "stratification_columns"),
    outputs=("surviving_associations", "lift", "adjusted_p", "fdr_q"),
    scope="statistical",
    steps=("split the data into discovery and confirmation halves",
           "mine associations on the discovery half only",
           "require replication on the held-out confirmation half",
           "apply Mantel-Haenszel adjustment stratified by birth era, sex and geography",
           "test against a permutation null built by shuffling outcome labels",
           "control the false discovery rate across all candidates by Benjamini-Hochberg"),
    assumptions=("An association is not believed until it survives every stage. The "
                 "confound control exists because era and geography can masquerade as "
                 "astrological signal — a cohort's birth years encode its life outcomes.",),
    limitations=("Can only find structure present in the data supplied; a null result is "
                 "evidence of absence only to the power the sample supports.",
                 "The negative literature is cited here deliberately: Dean & Kelly's "
                 "time-twins study found no correlation across 100+ variables among "
                 "subjects born minutes apart. This engine is built to be capable of "
                 "reproducing that null rather than to avoid it."),
    implemented_in="app.services.patterns.rigor",
    related=("gauquelin_sectors",),
    also_known_as=("pattern engine", "discovery", "rigor core"),
)


# ═══════════════════════════════════════════════════════════════════════════
# BRADLEY and LANDSCHEIDT — two more computable Level 2 theories
# ═══════════════════════════════════════════════════════════════════════════
from app.services.provenance.sources import register as _register, MODERN as _MODERN, \
    SCIENCE as _SCIENCE

_register("bradley_1948", title="Stock Market Prediction: The Planetary Barometer and "
                                "How to Use It",
          author="Donald A. Bradley (also published as Garth Allen)", date="1948",
          tradition="research", language="English", kind=_MODERN,
          note="Proposes the siderograph, a single weighted curve from planetary aspects "
               "intended to anticipate market turning points. Bradley stated explicitly "
               "that it indicates the TIMING of a reversal and not its direction — a "
               "caveat essentially every commercial reseller of the method has dropped. "
               "Published reconstructions differ on the coefficients, so 'the' "
               "siderograph is not a single well-defined object.")

_register("landscheidt_1989", title="Sun-Earth-Man: A Mesh of Cosmic Oscillations",
          author="Theodor Landscheidt", date="1989", tradition="research",
          language="English", kind=_MODERN,
          note="Argues that the rate of change of the Sun's orbital angular momentum "
               "about the solar-system barycentre modulates solar activity. The "
               "barycentric mechanics are uncontested Newtonian physics; the coupling to "
               "the solar dynamo is not established and has no accepted mechanism.")

_register("jose_1965", title="Sun's Motion and Sunspots",
          author="Paul D. Jose", date="1965, Astronomical Journal 70, 193–200",
          tradition="research", language="English", kind=_SCIENCE,
          note="Identified the ~178.7-year repetition in the giant planets' configuration "
               "and its apparent relation to the sunspot record — the paper Landscheidt "
               "built on, and the earlier and more cautious statement of the idea.")

method(
    id="bradley_siderograph",
    name="Bradley siderograph",
    system="research", level=2, determinacy=DETERMINISTIC,
    sources=("bradley_1948",),
    inputs=("planetary_longitudes", "harmonic_weights", "group_weights", "pair_weights"),
    outputs=("curve_value", "component_totals", "turning_points"),
    scope="mundane",
    steps=("compute the angular separation of every pair within each speed group",
           "map each to a harmonic potential, a weighted sum of cos(n·θ)",
           "weight by pair and by speed group",
           "sum into the combined curve, and read its local extrema"),
    assumptions=("Weights are EXPLICIT PARAMETERS with a documented default, not hidden "
                 "constants. Published reconstructions differ and the commercial versions "
                 "in circulation are not identical to each other.",
                 "Bradley read turning points, not levels, and stated the curve gives "
                 "timing without direction."),
    limitations=("Not established. Independent tests in the finance literature have not "
                 "supported it.",
                 "Uniquely testable, which is why it is here: market turning points are "
                 "recorded, dated and not open to reinterpretation afterwards. But the "
                 "weights must be fixed BEFORE looking at price data — coefficients tuned "
                 "against the series they are meant to predict have predicted nothing.",
                 "The curve is autocorrelated, so a null must be built by shuffling dates "
                 "rather than assuming a flat expectation.",
                 "MUNDANE scope. It says nothing about an individual."),
    implemented_in="app.services.mundane.bradley",
    related=("barbault_cyclic_index", "pattern_discovery"),
    also_known_as=("siderograph", "bradley", "planetary barometer", "garth allen",
                   "financial astrology", "market timing"),
)

method(
    id="landscheidt_torque",
    name="Landscheidt solar barycentric torque",
    system="research", level=2, determinacy=DETERMINISTIC,
    sources=("landscheidt_1989", "jose_1965"),
    inputs=("heliocentric_positions", "sampling_interval"),
    outputs=("barycentre_offset", "solar_angular_momentum", "torque"),
    scope="mundane",
    steps=("sum the mass-weighted planetary position vectors to locate the barycentre",
           "the Sun's displacement is the negative of that vector",
           "differentiate across samples for velocity and specific angular momentum",
           "differentiate again for the torque Landscheidt read"),
    assumptions=("Computed in the ecliptic plane; latitude contributes under half a "
                 "percent to the barycentric offset and is omitted explicitly.",),
    limitations=("The COMPUTATION is uncontested Newtonian mechanics and any astronomer "
                 "would accept it. The HYPOTHESIS built on it — that barycentric torque "
                 "modulates solar activity — is a live minority position, not established.",
                 "The central objection is serious and unanswered: the Sun is in free fall "
                 "about the barycentre, so that motion exerts no tidal or inertial force "
                 "on its interior. No accepted coupling mechanism exists.",
                 "Landscheidt's specific forecasts, including a Grand Minimum around 2030, "
                 "have had mixed results.",
                 "Separating the exact physics from the contested hypothesis is the point "
                 "of registering it — proponents present the whole as settled, and "
                 "dismissers discard the mechanics along with the claim."),
    implemented_in="app.services.mundane.landscheidt",
    related=("barbault_cyclic_index",),
    also_known_as=("landscheidt", "barycentric", "solar barycentre", "torque cycle",
                   "jose cycle", "grand minimum", "planetary hypothesis"),
)
