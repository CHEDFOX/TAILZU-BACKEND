"""
PROVENANCE — Layer 1 · the BIBLIOGRAPHY (the works themselves).

Every method in `provenance/methods/` cites one or more SOURCE ids declared here, so a
work is described exactly once and a hundred methods can point at it. This is the
"where is it written" half of the answer; `registry.py` holds the "what does it do" half.

HONESTY RULES (these are load-bearing — the whole point is that a citation can be trusted):
  • `author` records what scholarship actually claims. Where a text is traditionally
    attributed rather than authored, that says "(attrib.)" — Parashara did not sit down
    and write BPHS in one lifetime, and we do not pretend otherwise.
  • `date` is a RANGE when the range is genuinely disputed. A false precision here is
    worse than a wide window.
  • `editions` lists translations a user could actually go and buy or borrow. A citation
    nobody can check is decoration.
  • Nothing in this file asserts that a method WORKS. Provenance is a question of where a
    technique came from, not whether it predicts anything. Efficacy — including the
    negative results — lives in `research.py` and in each method's `limitations`.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

CLASSICAL = "classical"      # a primary text of a living divinatory tradition
MODERN = "modern"            # a named modern practitioner's formalisation
ASTRONOMICAL = "astronomical"  # an ephemeris / algorithm reference
STUDY = "study"              # a published empirical study (positive OR negative)
WISDOM = "wisdom"            # a philosophical / metaphysical work — computes nothing
COSMOLOGY = "cosmology"      # an account of the origin and structure of the world
SCIENCE = "science"          # a modern scientific result bearing on the same questions

_KINDS = {CLASSICAL, MODERN, ASTRONOMICAL, STUDY, WISDOM, COSMOLOGY, SCIENCE}


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    author: str
    date: str
    tradition: str
    language: str            # the language it was ORIGINALLY written in
    kind: str
    note: str = ""
    editions: Tuple[str, ...] = ()   # translations / editions a reader can obtain
    url: str = ""                    # only for sources with a stable public location


_SOURCES: Dict[str, Source] = {}


def register(id: str, **kw) -> Source:
    """Add a work to the bibliography.

    Public so the library package can populate philosophy and cosmology into the SAME
    registry the calculation engines cite. One bibliography, many populators — a user
    asking "where does this come from" and a user browsing the library must never be
    reading from two different catalogues that can drift apart."""
    if kw["kind"] not in _KINDS:
        raise ValueError(f"bad kind {kw['kind']!r} for source {id!r}")
    if id in _SOURCES:
        raise ValueError(f"duplicate source id {id!r}")
    s = Source(id=id, **kw)
    _SOURCES[id] = s
    return s


_src = register  # internal alias used by the declarations below


# ═══════════════════════════════════════════════════════════════════════════
# JYOTISH — the Sanskrit corpus
# ═══════════════════════════════════════════════════════════════════════════

_src("bphs",
     title="Brihat Parashara Hora Shastra",
     author="Parashara (attrib.)",
     date="compiled c. 7th–12th c. CE; earlier oral strata claimed",
     tradition="jyotish", language="Sanskrit", kind=CLASSICAL,
     note="The root text of Parashari jyotish. Surviving manuscripts vary in chapter "
          "count and ordering, so chapter numbers differ between editions — a locus is "
          "only recorded on a method when the edition is named alongside it.",
     editions=("R. Santhanam, trans., 2 vols. (Ranjan Publications, 1984)",
               "Girish Chand Sharma, trans. (Sagar Publications)"))

_src("brihat_jataka",
     title="Brihat Jataka",
     author="Varahamihira",
     date="c. 6th c. CE",
     tradition="jyotish", language="Sanskrit", kind=CLASSICAL,
     note="The most securely dated of the classical jyotish texts — Varahamihira is a "
          "historical figure with a known floruit, unlike most attributions in the corpus.",
     editions=("B. Suryanarain Rao, trans. (1905)",))

_src("saravali",
     title="Saravali",
     author="Kalyana Varma",
     date="c. 8th–10th c. CE",
     tradition="jyotish", language="Sanskrit", kind=CLASSICAL,
     note="Large yoga compendium; much of the later yoga literature restates it.",
     editions=("R. Santhanam, trans., 2 vols. (Ranjan Publications)",))

_src("phaladeepika",
     title="Phaladeepika",
     author="Mantreswara",
     date="c. 13th–15th c. CE",
     tradition="jyotish", language="Sanskrit", kind=CLASSICAL,
     editions=("G. S. Kapoor, trans. (Ranjan Publications)",))

_src("jataka_parijata",
     title="Jataka Parijata",
     author="Vaidyanatha Dikshita",
     date="c. 15th–16th c. CE",
     tradition="jyotish", language="Sanskrit", kind=CLASSICAL,
     editions=("V. Subrahmanya Sastri, trans.",))

_src("laghu_parashari",
     title="Laghu Parashari (Jataka Chandrika)",
     author="unknown; a Parashari digest",
     date="medieval",
     tradition="jyotish", language="Sanskrit", kind=CLASSICAL,
     note="A short digest of dasha-phala rules. Widely used precisely because it is "
          "terse and rule-shaped — much of what practitioners call 'Parashari dasha "
          "logic' is in practice this text rather than BPHS itself.")

_src("jaimini_sutras",
     title="Upadesa Sutras (Jaimini Sutras)",
     author="Jaimini (attrib.)",
     date="disputed; c. 4th c. BCE–4th c. CE for the attribution, later for the text",
     tradition="jaimini", language="Sanskrit", kind=CLASSICAL,
     note="Aphoristic to the point of ambiguity — the sutras admit multiple readings and "
          "the major commentaries genuinely disagree. Any Jaimini implementation is an "
          "implementation of ONE reading; ours records which.",
     editions=("B. Suryanarain Rao, trans.", "Sanjay Rath, commentary (modern)"))

_src("prashna_marga",
     title="Prashna Marga",
     author="a Namboothiri brahmin of Kerala (unnamed in the text)",
     date="1649 CE",
     tradition="prashna", language="Sanskrit", kind=CLASSICAL,
     note="Self-dated in its own colophon — one of the few firm dates in the corpus.",
     editions=("B. V. Raman, trans., 2 vols.",))

_src("shatpanchasika",
     title="Shatpanchasika",
     author="Prithuyasas",
     date="c. 6th c. CE",
     tradition="prashna", language="Sanskrit", kind=CLASSICAL,
     note="By Varahamihira's son; the older horary layer beneath Prashna Marga.")

_src("tajika_neelakanthi",
     title="Tajika Neelakanthi",
     author="Neelakantha Daivajna",
     date="1587 CE",
     tradition="tajika", language="Sanskrit", kind=CLASSICAL,
     note="The Sanskrit reception of Perso-Arabic annual-chart technique. Tajika is "
          "genuinely a HYBRID — its aspects and sahams are Arabic in origin, not "
          "Parashari, which is why its rules do not agree with BPHS and should not be "
          "silently blended with it.")

_src("muhurta_chintamani",
     title="Muhurta Chintamani",
     author="Ram Daivagya",
     date="1600 CE",
     tradition="muhurta", language="Sanskrit", kind=CLASSICAL,
     editions=("B. Suryanarain Rao, trans.",))

_src("kalaprakasika",
     title="Kalaprakasika",
     author="N. P. Subramania Iyer (compiler)",
     date="traditional material; this compilation early 20th c.",
     tradition="muhurta", language="Sanskrit", kind=CLASSICAL)

_src("krishnamurti_readers",
     title="Krishnamurti Padhdhati (Readers I–VI)",
     author="K. S. Krishnamurti",
     date="1963–1972",
     tradition="kp", language="English", kind=MODERN,
     note="KP is a MODERN system (20th c.), not a classical one. It fixes the sub-lord "
          "division on top of Vimshottari proportions and adopts the Placidus house "
          "cusps — both deliberate departures from Parashari practice. Presenting KP "
          "as ancient would be a factual error.")

_src("surya_siddhanta",
     title="Surya Siddhanta",
     author="unknown (revised over centuries)",
     date="core c. 4th–5th c. CE; extant recension later",
     tradition="jyotish", language="Sanskrit", kind=ASTRONOMICAL,
     note="The astronomical (not interpretive) substrate of the Indian tradition — "
          "planetary mean motions, and the ayanamsha question descends from it.")


# ═══════════════════════════════════════════════════════════════════════════
# WESTERN — Hellenistic, medieval, modern
# ═══════════════════════════════════════════════════════════════════════════

_src("tetrabiblos",
     title="Tetrabiblos (Apotelesmatika)",
     author="Claudius Ptolemy",
     date="c. 150 CE",
     tradition="western", language="Greek", kind=CLASSICAL,
     note="The most influential and LEAST typical Hellenistic text — Ptolemy rationalises "
          "and omits much standard practice (he drops most lots, and the sect logic is "
          "thinner than in Valens). Citing Ptolemy for 'what Hellenistic astrologers did' "
          "is a common error; he is better read as one opinionated reformer.",
     editions=("F. E. Robbins, trans. (Loeb Classical Library, 1940)",
               "Robert Schmidt, trans. (Project Hindsight)"))

_src("valens_anthology",
     title="Anthologiae (The Anthology)",
     author="Vettius Valens",
     date="c. 150–175 CE",
     tradition="western", language="Greek", kind=CLASSICAL,
     note="The richest surviving record of Hellenistic practice, with ~130 worked example "
          "charts — which makes it uniquely checkable against real birth data.",
     editions=("Mark Riley, trans. (free PDF, Univ. of Chicago / CSUS)",),
     url="https://www.csus.edu/indiv/r/rileymt/")

_src("dorotheus",
     title="Carmen Astrologicum",
     author="Dorotheus of Sidon",
     date="c. 75 CE (surviving via a 9th c. Arabic translation)",
     tradition="western", language="Greek (extant in Arabic)", kind=CLASSICAL,
     note="The Greek original is lost. What survives passed through Umar al-Tabari's "
          "Arabic — so the transmission itself introduces uncertainty that any citation "
          "should carry.",
     editions=("David Pingree, trans. (Teubner, 1976)",
               "Benjamin Dykes, trans. (2017)"))

_src("paulus",
     title="Introductory Matters (Eisagogika)",
     author="Paulus Alexandrinus",
     date="378 CE",
     tradition="western", language="Greek", kind=CLASSICAL,
     note="Firmly dated by an internal example chart — rare and useful.",
     editions=("Robert Schmidt, trans. (Project Hindsight)",
               "Dorian Gieseler Greenbaum, trans."))

_src("firmicus",
     title="Mathesis",
     author="Julius Firmicus Maternus",
     date="c. 334–337 CE",
     tradition="western", language="Latin", kind=CLASSICAL,
     editions=("Jean Rhys Bram, trans. (1975)", "James Holden, trans. (2011)"))

_src("bonatti",
     title="Liber Astronomiae",
     author="Guido Bonatti",
     date="c. 1277",
     tradition="western", language="Latin", kind=CLASSICAL,
     editions=("Benjamin Dykes, trans., Book of Astronomy (2007)",))

_src("lilly_ca",
     title="Christian Astrology",
     author="William Lilly",
     date="1647",
     tradition="western", language="English", kind=CLASSICAL,
     note="The fullest English statement of traditional horary and the dignity tables "
          "most modern implementations actually follow.",
     editions=("facsimile (Regulus, 1985)", "Deborah Houlding, ed. (Ascella)"))

_src("placidus_primum",
     title="Primum Mobile",
     author="Placidus de Titis",
     date="1657",
     tradition="western", language="Latin", kind=CLASSICAL,
     note="Source of the Placidus house division and of his primary-directions method.")

_src("brennan_hellenistic",
     title="Hellenistic Astrology: The Study of Fate and Fortune",
     author="Chris Brennan",
     date="2017",
     tradition="western", language="English", kind=MODERN,
     note="The standard modern reconstruction. Zodiacal releasing and annual profections "
          "reached contemporary practice largely through this revival lineage (Project "
          "Hindsight, Schmidt, Brennan) rather than continuously — worth stating plainly "
          "when a user asks how old a technique 'really' is.")


# ═══════════════════════════════════════════════════════════════════════════
# CHINESE — BaZi / Zi Wei
# ═══════════════════════════════════════════════════════════════════════════

_src("yuan_hai_zi_ping",
     title="Yuan Hai Zi Ping (淵海子平)",
     author="compiled by Xu Sheng; method attrib. Xu Ziping",
     date="method c. 10th c.; this compilation Song–Ming",
     tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
     note="The founding text of the Ziping (four-pillars) method — the shift from "
          "year-pillar to DAY-pillar as the self reference happens here.")

_src("san_ming_tong_hui",
     title="San Ming Tong Hui (三命通會)",
     author="Wan Minying",
     date="1578",
     tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
     note="The largest classical BaZi compendium; the standard reference for the "
          "shensha (symbolic stars) that later texts abbreviate.")

_src("di_tian_sui",
     title="Di Tian Sui (滴天髓, Drops of Heavenly Marrow)",
     author="attrib. Liu Bowen; commentary by Ren Tieqiao",
     date="Ming dynasty; standard commentary 1930s",
     tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
     note="The source of the strength-and-balance reasoning behind Useful God selection. "
          "Terse enough that the Ren Tieqiao commentary is effectively part of the text.")

_src("qiong_tong_bao_jian",
     title="Qiong Tong Bao Jian (窮通寶鑑)",
     author="unknown",
     date="Ming–Qing",
     tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
     note="Seasonal-adjustment reference — which element a day master needs by birth "
          "month. The practical counterweight to Di Tian Sui's abstraction.")

_src("ziwei_doushu",
     title="Zi Wei Dou Shu (紫微斗數)",
     author="attrib. Chen Tuan",
     date="attrib. c. 10th c.; extant texts later",
     tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
     note="A separate system from BaZi with its own star-placement logic — not a variant "
          "of it, and its results should never be merged into a BaZi reading.")


# ═══════════════════════════════════════════════════════════════════════════
# ASTRONOMICAL — Level 0 substrate
# ═══════════════════════════════════════════════════════════════════════════

_src("swiss_ephemeris",
     title="Swiss Ephemeris",
     author="Astrodienst AG (Alois Treindl, Dieter Koch)",
     date="1997–present",
     tradition="astronomy", language="C / documentation in English", kind=ASTRONOMICAL,
     note="The ephemeris this platform computes on. Derived from JPL DE431/DE441, with "
          "stated accuracy better than 0.001 arcsec for the major planets over the "
          "historical period.",
     url="https://www.astro.com/swisseph/")

_src("jpl_de441",
     title="JPL Planetary and Lunar Ephemeris DE441",
     author="NASA Jet Propulsion Laboratory (Park, Folkner et al.)",
     date="2020",
     tradition="astronomy", language="English", kind=ASTRONOMICAL,
     note="The underlying numerical integration; DE441 spans roughly −13,200 to +17,191.",
     url="https://ssd.jpl.nasa.gov/")

_src("meeus",
     title="Astronomical Algorithms",
     author="Jean Meeus",
     date="1991; 2nd ed. 1998",
     tradition="astronomy", language="English", kind=ASTRONOMICAL,
     note="Reference for the derived quantities computed on top of the ephemeris — "
          "rising/setting, phase, parallax, refraction.")

_src("iau_sofa",
     title="IAU SOFA (Standards of Fundamental Astronomy)",
     author="IAU SOFA Board",
     date="current release",
     tradition="astronomy", language="C / Fortran", kind=ASTRONOMICAL,
     note="Authority for frame transformations, precession-nutation and time scales.",
     url="https://www.iausofa.org/")


# ═══════════════════════════════════════════════════════════════════════════
# LEVEL 2 — modern research, INCLUDING the negative results
# ═══════════════════════════════════════════════════════════════════════════
# A research layer that cites only supportive studies is marketing. These are here so
# that a method's `limitations` can point at the strongest evidence AGAINST it, and so
# the Oracle can answer "has this been tested?" honestly rather than evasively.

_src("barbault_1967",
     title="Les astres et l'histoire",
     author="André Barbault",
     date="1967",
     tradition="research", language="French", kind=MODERN,
     note="Source of the cyclic index — a summed measure of the angular separations "
          "between the five outer planet pairs, proposed as a mundane indicator. It is "
          "fully deterministic and therefore implementable exactly; whether it tracks "
          "anything is a separate question from whether we compute it correctly.")

_src("gauquelin_1955",
     title="L'influence des astres: étude critique et expérimentale",
     author="Michel Gauquelin",
     date="1955",
     tradition="research", language="French", kind=STUDY,
     note="The diurnal-position ('plus zones') findings, of which the Mars–athletes "
          "result is best known. Method: compare observed frequencies of planetary "
          "placement in diurnal sectors for eminent professionals against a "
          "demographically-modelled expectation. STATISTICAL, not predictive — it says "
          "nothing about an individual chart.")

_src("ertel_1988",
     title="Raising the hurdle for the athletes' Mars effect",
     author="Suitbert Ertel",
     date="1988, Journal of Scientific Exploration",
     tradition="research", language="English", kind=STUDY,
     note="Introduced eminence-ranked testing, finding the effect concentrated among the "
          "most eminent. Independent replication attempts have been mixed; the CFEPP "
          "and Committee for Skeptical Inquiry studies did not confirm it.")

_src("carlson_1985",
     title="A double-blind test of astrology",
     author="Shawn Carlson",
     date="1985, Nature 318, 419–425",
     tradition="research", language="English", kind=STUDY,
     note="NEGATIVE RESULT. Astrologers matching natal charts to CPI personality profiles "
          "performed at chance. Methodologically contested since (both directions), but "
          "it remains the most-cited controlled test and any honest research layer must "
          "surface it.")

_src("dean_kelly_2003",
     title="Is astrology relevant to consciousness and psi?",
     author="Geoffrey Dean and Ivan W. Kelly",
     date="2003, Journal of Consciousness Studies 10(6–7)",
     tradition="research", language="English", kind=STUDY,
     note="NEGATIVE RESULT. The 'time twins' study — over 2,000 subjects born minutes "
          "apart showed no correlation across 100+ measured variables. The strongest "
          "single challenge to natal astrology's core claim, and the reason this "
          "platform's pattern engine is built around falsification rather than "
          "confirmation.")


# ═══════════════════════════════════════════════════════════════════════════
# ACCESSORS
# ═══════════════════════════════════════════════════════════════════════════

def get(source_id: str) -> Optional[Source]:
    return _SOURCES.get(source_id)


def all_sources() -> Dict[str, Source]:
    return dict(_SOURCES)


def by_tradition(tradition: str) -> List[Source]:
    return sorted((s for s in _SOURCES.values() if s.tradition == tradition),
                  key=lambda s: s.date)


def by_kind(kind: str) -> List[Source]:
    return sorted((s for s in _SOURCES.values() if s.kind == kind), key=lambda s: s.id)


def cite(source_id: str, locus: str = "") -> str:
    """One-line human citation. `locus` is appended ONLY by callers that have verified it
    against a named edition — see `registry.Method.locus`."""
    s = _SOURCES.get(source_id)
    if not s:
        return ""
    base = f"{s.title} ({s.author}, {s.date})"
    return f"{base}, {locus}" if locus else base


def to_dict(s: Source) -> dict:
    return {"id": s.id, "title": s.title, "author": s.author, "date": s.date,
            "tradition": s.tradition, "language": s.language, "kind": s.kind,
            "note": s.note, "editions": list(s.editions), "url": s.url}


def catalog() -> List[dict]:
    """Serializable bibliography, for the API and the docs."""
    return [to_dict(s) for s in sorted(_SOURCES.values(),
                                       key=lambda x: (x.tradition, x.date, x.id))]
