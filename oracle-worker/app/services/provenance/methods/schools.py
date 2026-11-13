"""
PROVENANCE · METHODS — the modern schools, and the influential works behind them.

Two kinds of entry here.

IMPLEMENTED — Ebertin's cosmobiology and Rudhyar's lunation cycle, both exactly computable
and both now built.

REGISTERED BUT NOT IMPLEMENTED — works that shaped the field and that a user may ask
about, entered as SOURCES with no method. That is not an oversight: a source without a
method is the registry saying "this exists, we know what it is, and we do not compute it."
Some cannot be computed at all (Tarnas correlates archetypes across history; Campion writes
history), and one — Nicola's conditionalist RET — could be, but I do not know its
construction well enough to implement without inventing parts of it, so it is named rather
than faked.

`verify_implementations()` checks methods, not sources, so these register cleanly and the
Oracle can answer "who is Rudhyar" or "what is Project Hindsight" from the bibliography
without any claim that the platform computes them.
"""
from app.services.provenance.sources import register, MODERN, STUDY, WISDOM
from app.services.provenance.registry import (
    method, DETERMINISTIC, PARAMETRIC,
)

# ═══════════════════════════════════════════════════════════════════════════
# IMPLEMENTED
# ═══════════════════════════════════════════════════════════════════════════

register("ebertin_1940", title="Kombination der Gestirneinflüsse "
                               "(The Combination of Stellar Influences)",
         author="Reinhold Ebertin", date="1940; English translation 1972",
         tradition="western", language="German", kind=MODERN,
         note="The founding text of cosmobiology. Around 800 midpoint combinations, each "
              "given a terse behavioural reading. Ebertin deliberately discarded the "
              "houses, sign rulerships and minor aspects to leave something small enough "
              "to be tested — an austerity almost unique in the field.",
         editions=("Ebertin-Verlag, trans. Alfred G. Roosedale & Linda Kratzsch (1972)",))

register("rudhyar_1967", title="The Lunation Cycle",
         author="Dane Rudhyar", date="1967", tradition="western", language="English",
         kind=MODERN,
         note="Source of the eight soli-lunar phase names in universal contemporary use — "
              "'balsamic moon' is Rudhyar's, and dates to 1967, which almost nobody using "
              "the term knows.")

register("rudhyar_1936", title="The Astrology of Personality",
         author="Dane Rudhyar", date="1936", tradition="western", language="English",
         kind=MODERN,
         note="Founded humanistic astrology, explicitly moving the practice away from "
              "prediction and toward a language for psychological development. Rudhyar "
              "came through Theosophy and Jung; the reframing is his, not inherited.")

method(
    id="cosmobiology",
    name="Cosmobiology — the 90° dial and midpoint trees",
    system="western", level=1, determinacy=PARAMETRIC,
    sources=("ebertin_1940",),
    inputs=("tropical_longitudes", "orb", "dial"),
    outputs=("dial_positions", "midpoint_trees", "sensitive_points"),
    scope="personal",
    steps=("reduce every longitude modulo 90, collapsing conjunction, square and "
           "opposition onto one position",
           "compute the midpoint of every pair",
           "for each body, list the midpoints it occupies within a tight orb"),
    assumptions=("A 1°30' orb on the 90° dial, Ebertin's working tolerance. This is a "
                 "constraint of the method, not a stylistic preference.",
                 "Houses, sign rulerships and minor aspects are deliberately excluded — "
                 "cosmobiology discards them on principle."),
    limitations=("Loosening the orb destroys the method: every body then sits on a dozen "
                 "midpoints, the trees become noise, and the claim to precision "
                 "evaporates. This is the usual way cosmobiology is misapplied.",
                 "The combination readings are Ebertin's own attributions, recorded as "
                 "his; only a fraction of his ~800 entries are carried here.",
                 "Built from the tropical chart, so it is not independent testimony of "
                 "it — the same positions, differently arranged."),
    deps=("tropical_chart",),
    related=("antiscia", "harmonics"),
    implemented_in="app.services.western.cosmobiology",
    also_known_as=("cosmobiology", "ebertin", "midpoint", "midpoints", "90 degree dial",
                   "midpoint tree", "uranian midpoints"),
)

method(
    id="lunation_cycle",
    name="Lunation cycle (soli-lunar phase)",
    system="western", level=1, determinacy=DETERMINISTIC,
    sources=("rudhyar_1967", "rudhyar_1936"),
    inputs=("sun_longitude", "moon_longitude"),
    outputs=("phase", "elongation", "illumination"),
    scope="personal",
    steps=("subtract the Sun's longitude from the Moon's",
           "divide the 360° cycle into eight 45° phases"),
    assumptions=("The eight-phase division is Rudhyar's. Other schemes exist — four "
                 "quarters, or twenty-eight mansions — and give different boundaries.",),
    limitations=("Rudhyar's humanistic framing explicitly rejects prediction. The phase "
                 "describes a characteristic way of moving through a cycle, not an event, "
                 "and forecasting from it misuses the source.",
                 "Derived from the Sun and Moon alone, so it shares its substrate with "
                 "every other chart method and is not independent testimony."),
    deps=("tropical_chart",),
    implemented_in="app.services.western.lunation",
    also_known_as=("lunation", "lunar phase", "moon phase", "balsamic", "balsamic moon",
                   "new moon phase", "progressed lunation", "rudhyar"),
)

# ═══════════════════════════════════════════════════════════════════════════
# REGISTERED, NOT IMPLEMENTED
# ═══════════════════════════════════════════════════════════════════════════
# Named honestly. The Oracle can answer questions about these from the bibliography; the
# absence of a method is the registry stating that the platform does not compute them.

register("nicola_ret", title="Astrologie Conditionaliste (the RET model)",
         author="Jean-Pierre Nicola", date="from the 1960s", tradition="western",
         language="French", kind=MODERN,
         note="The most rigorous attempt to DERIVE planetary meanings from structure — "
              "ranking the planets by their observational relationship to the Sun and "
              "Earth rather than inheriting the traditional attributions. Deterministic "
              "and implementable in principle. NOT implemented here: I do not know its "
              "construction well enough to build it without inventing parts, and a "
              "half-right RET would be worse than none.")

register("fagan_sidereal", title="Zodiacs Old and New / the Synetic Vernal Point",
         author="Cyril Fagan, with Donald Bradley", date="1950s",
         tradition="western", language="English", kind=MODERN,
         note="Founded Western sidereal astrology and fixed the SVP ayanamsha. The "
              "platform computes sidereal positions but does not implement Fagan's "
              "mundane ingress technique.")

register("kollerstrom_metals", title="Metal-planet correlation experiments",
         author="Nicholas Kollerstrom", date="1970s onward", tradition="research",
         language="English", kind=STUDY,
         note="Laboratory crystallisation trials testing claimed metal-planet "
              "correspondences. Rare in this field for having an actual protocol and for "
              "publishing null results alongside positive ones. Not implemented — it is "
              "an experimental programme, not a calculation.")

register("seymour_1988", title="The Scientific Basis of Astrology",
         author="Percy Seymour", date="1988", tradition="research", language="English",
         kind=STUDY,
         note="Proposes a MECHANISM — geomagnetic resonance modulated by planetary "
              "tidal effects on the solar wind — which almost no other author in this "
              "field attempts. Largely rejected by both astronomers and astrologers. "
              "Registered because a falsifiable mechanism is worth more to a research "
              "layer than an unfalsifiable correlation, whichever way it went.")

register("hand_1976", title="Planets in Transit",
         author="Robert Hand", date="1976", tradition="western", language="English",
         kind=MODERN,
         note="The transit orb conventions most astrological software silently inherits "
              "come from here. Worth registering precisely because its influence is "
              "invisible — practitioners use Hand's tolerances believing them traditional.")

register("project_hindsight", title="Project Hindsight translations",
         author="Robert Schmidt, Robert Hand, Robert Zoller", date="from 1993",
         tradition="western", language="English", kind=MODERN,
         note="The translation programme that recovered Hellenistic technique from the "
              "Greek. Zodiacal releasing, annual profections and sect logic reached "
              "contemporary practice through this work — so several methods this platform "
              "computes as 'ancient' arrived by way of a 1990s scholarly project, which "
              "is part of their honest provenance.")

register("tarnas_2006", title="Cosmos and Psyche",
         author="Richard Tarnas", date="2006", tradition="research", language="English",
         kind=WISDOM,
         note="The most intellectually serious modern defence of astrological "
              "correlation, arguing archetypal patterns across cultural history. NOT "
              "implementable: the correlations are interpretive and historical, and "
              "reducing them to a formula would misrepresent the argument. Belongs in "
              "the library rather than the method registry.")

register("campion_history", title="A History of Western Astrology",
         author="Nicholas Campion", date="2008–2009, 2 vols.", tradition="research",
         language="English", kind=WISDOM,
         note="The standard scholarly history. Reference for what the traditions actually "
              "did and when, as against what they are popularly said to have done.")

register("pingree_transmission", title="From Astral Omens to Astrology: From Babylon to Bikaner",
         author="David Pingree", date="1997", tradition="research", language="English",
         kind=WISDOM,
         note="The transmission scholarship. Indispensable for any claim about how "
              "Babylonian, Hellenistic and Indian astrology relate — including the "
              "Yavanajataka's evidence that Greek horoscopy reached India, which is the "
              "basis for treating jyotish and Hellenistic technique as partly related "
              "rather than independent.")

register("neugebauer_exact", title="The Exact Sciences in Antiquity",
         author="Otto Neugebauer", date="1951; 2nd ed. 1957", tradition="astronomy",
         language="English", kind=WISDOM,
         note="The mathematical-astronomy foundation underlying all of the above. "
              "Establishes what ancient astronomers could actually compute, which bounds "
              "what their astrological methods could have rested on.")

register("cfepp_1996", title="The 'Mars Effect': A French Test of Over 1,000 Sports Champions",
         author="Comité Français pour l'Étude des Phénomènes Paranormaux (Benski et al.)",
         date="1996", tradition="research", language="English", kind=STUDY,
         note="NEGATIVE RESULT. A careful independent replication attempt that did not "
              "confirm the Mars effect. Registered alongside Ertel's supportive "
              "reanalysis: two competent teams reaching opposite conclusions on "
              "overlapping data is what a genuinely open question looks like, and a "
              "research layer that carried only one side would be advocacy.")

register("dean_1986", title="Does Astrology Need to Be True?",
         author="Geoffrey Dean", date="1986–87, Skeptical Inquirer",
         tradition="research", language="English", kind=STUDY,
         note="NEGATIVE RESULT. The reversed-chart experiments — subjects accepted "
              "readings derived from charts with every placement inverted as readily as "
              "their own. Directly relevant to whether chart-specific content is doing "
              "the work in a reading, which is a question this platform's own product "
              "raises.")
