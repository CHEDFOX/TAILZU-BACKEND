"""
PROVENANCE · METHODS — Level 0, the astronomical substrate.

Nothing here interprets. These are the computations every tradition above depends on, and
they are the only layer of the platform whose correctness is objectively checkable — a
planetary longitude either matches JPL or it does not. Recording their provenance lets the
Oracle answer "how accurate is this, really?" with a number rather than a reassurance.
"""
from app.services.provenance.registry import method, DETERMINISTIC, PARAMETRIC

method(
    id="planetary_positions",
    name="Planetary positions",
    system="astronomy", level=0, determinacy=DETERMINISTIC,
    sources=("swiss_ephemeris", "jpl_de441"),
    inputs=("julian_day_ut", "body_id", "flags"),
    outputs=("ecliptic_longitude", "ecliptic_latitude", "distance", "speed"),
    scope="astronomical",
    steps=("convert civil time to Universal Time and then to Julian Day",
           "call the Swiss Ephemeris, which interpolates JPL DE441",
           "apply the requested frame: tropical or sidereal, geocentric or topocentric"),
    assumptions=("Geocentric apparent positions unless stated otherwise.",),
    limitations=("Accuracy is better than 0.001 arcsec for the major planets across the "
                 "historical period — far finer than any interpretive method requires. "
                 "The real error in a reading is always the birth time, never the "
                 "ephemeris.",),
    implemented_in="app.services.core.ephemeris",
    note="Some peripheral modules (e.g. mundane.football) use the Moshier fallback "
         "FLG_MOSEPH, which is analytical rather than JPL-interpolated and is accurate to "
         "roughly 0.1 arcsec. Adequate there, but not the same computation.",
    also_known_as=("ephemeris", "planet positions", "longitudes"),
)

method(
    id="ayanamsha",
    name="Ayanamsha (precession offset)",
    system="astronomy", level=0, determinacy=PARAMETRIC,
    sources=("surya_siddhanta", "swiss_ephemeris"),
    inputs=("julian_day_ut", "ayanamsha_mode"),
    outputs=("ayanamsha_degrees",),
    scope="astronomical",
    steps=("evaluate the chosen ayanamsha model at the given epoch",
           "subtract from tropical longitude to obtain sidereal"),
    assumptions=("Lahiri (Chitrapaksha) is this platform's default, fixing Spica near 180°.",),
    limitations=("This is the deepest unresolved parameter in the platform. Lahiri, Raman, "
                 "KP and Fagan-Bradley differ by up to ~2° today — enough to move a planet "
                 "into a different sign, change a nakshatra, and shift every dasha "
                 "boundary. No computation can settle which is correct; it is a "
                 "definitional choice about where the sidereal zodiac begins.",),
    implemented_in="app.services.core.ephemeris",
    also_known_as=("ayanamsa", "precession", "sidereal offset", "lahiri"),
)

method(
    id="house_cusps",
    name="House division",
    system="astronomy", level=0, determinacy=PARAMETRIC,
    sources=("swiss_ephemeris", "placidus_primum", "meeus"),
    inputs=("julian_day_ut", "latitude", "longitude", "house_system"),
    outputs=("twelve_cusps", "ascendant", "midheaven", "vertex"),
    scope="astronomical",
    steps=("compute local sidereal time",
           "derive the ascendant and midheaven",
           "divide by the selected system's rule"),
    assumptions=("Whole-sign for Hellenistic and BPHS work, Placidus for KP, "
                 "Placidus by default for modern Western.",),
    limitations=("Quadrant systems (Placidus, Koch, Regiomontanus) degrade toward the "
                 "poles and Placidus is undefined beyond the polar circles. Whole-sign "
                 "and equal house remain valid at any latitude.",),
    deps=("planetary_positions",),
    implemented_in="app.services.core.ephemeris",
    also_known_as=("houses", "cusps", "house system", "placidus", "whole sign"),
)

method(
    id="nakshatra_division",
    name="Nakshatra (lunar mansion) division",
    system="astronomy", level=0, determinacy=DETERMINISTIC,
    sources=("surya_siddhanta", "bphs"),
    inputs=("sidereal_longitude",),
    outputs=("nakshatra", "pada", "elapsed_fraction"),
    scope="astronomical",
    steps=("divide the 360° sidereal circle into 27 equal arcs of 13°20′",
           "subdivide each into four padas of 3°20′"),
    assumptions=("The 27-nakshatra equal division. A 28-nakshatra scheme including "
                 "Abhijit exists in the older literature and is used in some branches.",),
    limitations=("The equal division is a convention; the actual star groups the "
                 "nakshatras are named for are neither equally spaced nor equally sized.",),
    deps=("ayanamsha",),
    implemented_in="app.services.core.utils",
    also_known_as=("nakshatra", "lunar mansion", "constellation", "star sign vedic"),
)

method(
    id="retrograde_stations",
    name="Retrograde motion and stations",
    system="astronomy", level=0, determinacy=DETERMINISTIC,
    sources=("swiss_ephemeris", "meeus"),
    inputs=("julian_day_ut", "body_id"),
    outputs=("speed", "is_retrograde", "station_instants"),
    scope="astronomical",
    steps=("read the daily motion returned by the ephemeris",
           "a sign change in longitudinal speed marks a station"),
    assumptions=("Apparent geocentric motion. Retrogradation is a perspective effect of "
                 "relative orbital velocity, not a change in the planet's actual motion — "
                 "worth stating when a user asks what it physically is.",),
    limitations=(),
    deps=("planetary_positions",),
    implemented_in="app.services.parashara.retrograde_natal",
    also_known_as=("retrograde", "stations", "vakri", "direct motion"),
)

method(
    id="combustion",
    name="Combustion (proximity to the Sun)",
    system="astronomy", level=0, determinacy=PARAMETRIC,
    sources=("bphs", "brihat_jataka", "lilly_ca"),
    inputs=("planet_longitudes", "sun_longitude"),
    outputs=("is_combust", "is_cazimi", "orb_from_sun"),
    scope="astronomical",
    steps=("measure each planet's angular distance from the Sun",
           "compare against the per-planet orb given by the tradition in use"),
    assumptions=("Orbs differ between traditions and between planets — BPHS and Lilly do "
                 "not agree on the values.",),
    limitations=("Whether combustion is measured in longitude alone or in true angular "
                 "separation including latitude is not specified by the classical sources.",),
    deps=("planetary_positions",),
    implemented_in="app.services.parashara.combustion",
    also_known_as=("combust", "cazimi", "under the beams", "astangata"),
)

method(
    id="eclipses",
    name="Eclipse computation",
    system="astronomy", level=0, determinacy=DETERMINISTIC,
    sources=("swiss_ephemeris", "meeus", "jpl_de441"),
    inputs=("date_range", "latitude", "longitude"),
    outputs=("eclipse_type", "magnitude", "contact_times", "visibility"),
    scope="astronomical",
    steps=("search for syzygies where the Moon is near a node",
           "compute the geometry of the shadow cone for the location"),
    assumptions=(),
    limitations=("Local circumstances depend on ΔT, whose uncertainty grows for dates far "
                 "from the present — pre-medieval eclipse timings carry minutes of error.",),
    deps=("planetary_positions",),
    implemented_in="app.services.almanac",
    also_known_as=("eclipse", "grahan", "solar eclipse", "lunar eclipse"),
)
