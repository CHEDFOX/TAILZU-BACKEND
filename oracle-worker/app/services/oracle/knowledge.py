"""
ORACLE — KNOWLEDGE INJECTION (wires provenance, the library and independence into chat).

Three blocks, each added only when the turn warrants it. Always-on injection across all
three would cost significant tokens on every message including "hi", so each has a
detector and each stays silent otherwise.

  SOURCES       fires on "where does this come from / who says that / which text".
                Without it the model answers from memory, and memory invents plausible
                Sanskrit chapter numbers with total fluency. This is the block that makes
                a citation checkable.

  LIBRARY       fires on a question about meaning rather than about the person — time,
                fate, death, the self. Supplies what the traditions actually hold, with
                genuine convergence separated from inherited convergence.

  INDEPENDENCE  fires whenever more than one tradition is in play. This one is not about
                answering a question; it is a CORRECTION. The meta-oracle lens tells the
                model that agreement across systems is the strongest signal available —
                true only when the agreeing systems could have disagreed. KP and
                Vimshottari both read the Moon's nakshatra, so their agreement is one
                measurement heard twice. Without this block the model presents that as
                two traditions converging, which is the single most misleading thing a
                multi-system reading can do.
"""
import re
from typing import Dict, Iterable, List, Optional

# Representative methods per engine id — what that tradition actually computes with.
# Used to resolve independence between the systems a turn consulted.
_SYSTEM_METHODS: Dict[str, List[str]] = {
    "bphs":    ["rashi_chart", "vimshottari_dasha", "gochara"],
    "kp":      ["kp_sublord"],
    "jaimini": ["chara_dasha", "jaimini_karakas"],
    "tajika":  ["varshaphal"],
    "prashna": ["prashna"],
    "muhurta": ["muhurta"],
    "western": ["tropical_chart", "annual_profection", "zodiacal_releasing"],
    "chinese": ["four_pillars", "luck_pillars", "useful_god"],
    # Systems that read something OTHER than the sky. These are the ones that make a
    # cross-system agreement worth anything, so the independence block must know them.
    "ifa":       ["ifa_cast"],
    "dreams":    ["oneiromancy"],
    "javanese":  ["weton"],
    "balinese":  ["pawukon"],
    "ayurveda":  ["prakriti"],
    # Chinese methods that are NOT the BaZi line — each reasons from its own cast or
    # moment rather than from the four pillars.
    "liuyao":    ["liu_yao"],
    "meihua":    ["plum_blossom"],
    "qimen":     ["qimen_dunjia"],
    "daliuren":  ["da_liu_ren"],
    "taiyi":     ["tai_yi"],
    "fengshui":  ["ba_zhai", "flying_star"],
    # Regional and modern. Several of these DEPEND on a chart already counted, and the
    # dependency graph collapses them automatically — human_design and evolutionary both
    # rest on tropical_chart, so naming them here is what makes that collapse visible
    # rather than silently absent.
    "tibetan":   ["tibetan_elemental"],
    "thai":      ["thai_horasat"],
    "islamic":   ["lunar_mansions"],
    "humandesign": ["human_design"],
    "genekeys":  ["gene_keys"],
    "enneagram": ["enneagram"],
    "evolutionary": ["evolutionary_astrology"],
    "horary":    ["western_horary"],
}

# Words that mark a question as being about MEANING rather than about the person. The
# library should not fire on "when is a good time to travel".
_EXISTENTIAL = (
    "feel empty", "feels empty", "no point", "meaningless", "why am i here",
    "lost my way", "feel lost", "nothing matters", "why bother", "give up",
    "burnt out", "burned out", "so tired of", "cant go on", "can't go on",
    "is this all", "wasting my life", "afraid to die", "scared of dying",
    "grieving", "grief", "why me", "starting over", "start again",
)

# Questions ABOUT meaning, matched as whole phrases. This held "what is", "is there a"
# and "believe" as bare substrings, so five of nine everyday questions — "what is the
# best time for me to change jobs?", "is there a chance I'll get the job?", "what is my
# lucky number?", "my mom doesn't believe I can do it" — switched the reply into WISDOM
# MODE, "speak on meaning, death, time, the self and purpose". These are the questions
# that are actually about those things.
_PHILOSOPHICAL = (
    "what's the point", "whats the point", "what is the point", "point of it all",
    "why are we here", "why do we exist", "why does anything exist", "why is there anything",
    "meaning of life", "meaning of it all", "meaning of existence", "purpose of life",
    "what is life", "what is death", "what is time", "what is the soul", "what is consciousness",
    "what is reality", "what happens after death", "what happens when we die",
    "life after death", "is there a god", "does god exist", "is there life after",
    "free will", "is everything predestined", "is it all written", "is everything written",
    "is fate real", "is destiny real", "does anything matter", "does any of this matter",
    "why do we suffer", "why do good people suffer", "why is there suffering", "about suffering",
    "philosophy", "philosophical", "philosopher", "metaphysics", "metaphysical",
    "cosmology", "consciousness", "existence itself",
)


def _has_phrase(text: str, phrases) -> bool:
    """Whole-phrase match on word boundaries — "chan" is not inside "chance"."""
    t = text or ""
    return any(re.search(r"(?<![a-z0-9])" + re.escape(p) + r"(?![a-z0-9])", t) for p in phrases)


def _provenance_block(user_message: str, system: str) -> str:
    """Sources for a technique the user asked about — or for the whole engine in play."""
    try:
        from app.services import provenance as P
    except Exception:
        return ""

    if not P.is_provenance_question(user_message):
        return ""

    # Did they name a technique? Try the longest phrases first so "luck pillars" wins
    # over "pillars".
    words = [w.strip(" ?.,!\"'") for w in (user_message or "").lower().split()]
    for size in (3, 2, 1):
        for i in range(len(words) - size + 1):
            phrase = " ".join(words[i:i + size])
            if len(phrase) < 3:
                continue
            hits = P.resolve(phrase)
            if hits:
                txt = P.answer_source(phrase)
                if txt:
                    return txt

    # They asked for a source but named nothing — give them the engine that produced the
    # reading rather than letting the model reach for whatever it half-remembers.
    return P.citations_for_system(system or "bphs", depth="short")


def _wisdom_block(user_message: str, has_chart: bool = True) -> str:
    """The wisdom layer — what the traditions hold about meaning, and how to weave it.

    Replaces the old positions-dump. The model knows world philosophy far better than any
    file this platform could keep — Mohism, Mimamsa, Sikh thought, Shinto, Carvaka, none
    of which the library stores. So this instruction OPENS that knowledge rather than
    substituting for it, and the stored data becomes a GUARD around the two things a model
    reliably gets wrong: transmission, and dates.

    THREE MODES, chosen by what the question actually wants:

      PURE WISDOM  "what is time", "does any of this mean anything" — no chart needed.
      MERGED       "why does my life feel empty right now" — the chart says WHAT is
                   happening and when; the traditions say what it means that it is
                   happening at all. This is the case the product exists for, and the one
                   a horoscope app cannot do.
      SILENT       an ordinary reading question — this block adds nothing.
    """
    msg = (user_message or "").lower()
    wisdom = _has_phrase(msg, _PHILOSOPHICAL)
    existential = _has_phrase(msg, _EXISTENTIAL)

    try:
        from app.services import library as L
    except Exception:
        return ""

    # Only the traditions the question actually touches get lineage data. Dumping all 44
    # transmission edges on every question would drown the prompt.
    named = []
    try:
        for tid, t in (L.all_traditions() or {}).items():
            # Word boundaries: "chan" (Chan Buddhism) matched "chance" and "change",
            # and "maya" any message that mentioned someone called Maya.
            if _has_phrase(msg, (tid.replace("_", " "), t.name.lower())):
                named.append(tid)
    except Exception:
        named = []

    # Naming two or more traditions is itself a wisdom question, whatever words are used.
    # "Do Kabbalah and Neoplatonism agree" contains no philosophical keyword but is
    # precisely the case the transmission guard exists for — and precisely where the model
    # would otherwise volunteer a convergence that is actually descent.
    if len(named) >= 2:
        wisdom = True
    if not (wisdom or existential):
        return ""

    L_ = []

    if existential and has_chart and not wisdom:
        L_.append("MERGED MODE — they are LIVING this question, not studying it. The "
                  "chart data above says what is happening and when; the traditions say "
                  "what it means that it is happening at all. Weave both into one voice.")
        L_.append("  - Lead with the particular: their actual timing, their actual "
                  "pattern. Someone in the middle of something does not want a survey of "
                  "philosophy.")
        L_.append("  - Then let the frame land — that others have stood exactly here, and "
                  "what was found worth saying about it. One or two traditions, chosen "
                  "because they fit THIS person. Never a list.")
        L_.append("  - The frame must never float free of the particular. 'This is a long "
                  "narrowing season, and there is an old word for exactly this weather' is "
                  "the shape. 'Philosophers have long wondered about suffering' is not.")
        L_.append("  - Do not name the machinery — no system names, no method names.")
    else:
        L_.append("WISDOM MODE — speak on meaning, death, time, the self and purpose "
                  "freely and in your own voice, across ANY tradition or thinker the "
                  "question touches. Your knowledge here is far wider than anything this "
                  "platform stores; use it.")
        L_.append("  - Answer as one voice that has read widely, not as a survey. Two or "
                  "three positions well chosen beat ten listed.")
        L_.append("  - Where traditions genuinely disagree, that disagreement IS the "
                  "answer. Do not resolve it into a consensus that does not exist.")
        if has_chart:
            L_.append("  - If their own chart bears on it, bring it in — as the particular "
                      "case beneath the general question, never as a change of subject.")

    L_.append("")
    L_.append("THE ONE THING YOU MAY NOT DO — claim two traditions reached something "
              "INDEPENDENTLY.")
    L_.append("  - Where a transmission is recorded below, they did not. Say so plainly, "
              "or say nothing about their agreeing.")
    L_.append("  - Where both are NOT recorded below, you have no transmission data at "
              "all. Describe what each holds; do not call their agreement independent, "
              "convergent, or evidence of anything shared. Silence about convergence is "
              "the default.")
    L_.append("  - This matters because inherited agreement sounds identical to discovered "
              "agreement and means far less. Kabbalah's emanation scheme is Neoplatonic by "
              "descent, not by parallel insight; Islamic dream interpretation descends "
              "from Artemidorus through a ninth-century translation. Presenting either as "
              "convergence is the standard error in this subject.")

    if named:
        try:
            conv = L.convergence_report(named)
            if conv.get("collapsed"):
                L_.append("")
                L_.append("TRANSMISSION — for the traditions this question names:")
                for line in conv.get("lines", []):
                    if len(line["traditions"]) > 1:
                        anc = line.get("common_ancestry")
                        via = (" via " + ", ".join(anc)) if anc else ""
                        L_.append("  - " + ", ".join(line["names"]) + " share ancestry"
                                  + via + " — NOT independent.")
            elif len(named) > 1:
                L_.append("")
                L_.append("TRANSMISSION — no descent is recorded between the traditions "
                          "named here, so genuine convergence is possible. Say it "
                          "carefully: an absent record is weaker evidence than a known "
                          "separation.")
        except Exception:
            pass

    L_.append("")
    L_.append("Never state a date, author or attribution you have not been given. You will "
              "feel certain about several and be wrong — the Zohar's authorship, the "
              "Corpus Hermeticum's dating, when Human Design was formulated. Without it, "
              "say the work is known but you would not give a date from memory.")

    return chr(10).join(L_)

def _independence_block(systems: Iterable[str]) -> str:
    """The correction: which of the consulted traditions are actually independent."""
    ids = [s for s in dict.fromkeys(systems or []) if s in _SYSTEM_METHODS]
    if len(ids) < 2:
        return ""
    try:
        from app.services.consensus import independence as I
        from app.services import provenance as P
    except Exception:
        return ""

    methods = [m for sid in ids for m in _SYSTEM_METHODS[sid]]
    report = I.independence_report(methods)

    # Which SYSTEMS ended up sharing a cluster?
    sys_of = {m: sid for sid in ids for m in _SYSTEM_METHODS[sid]}
    collapsed_pairs = []
    for cluster in report["clusters"]:
        systems_in = sorted({sys_of[m] for m in cluster["methods"] if m in sys_of})
        if len(systems_in) > 1:
            shares = sorted({s for w in cluster["why_grouped"] for s in w["shares"]})
            collapsed_pairs.append((systems_in, shares))

    if not collapsed_pairs and not report.get("shared_conventions"):
        return ("INDEPENDENCE — the traditions consulted this turn ("
                + ", ".join(ids) + ") do not share technique. Where they agree, that "
                "agreement is genuine corroboration and may be leaned on.")

    lines = ["INDEPENDENCE — read before treating agreement as confirmation:"]
    for systems_in, shares in collapsed_pairs:
        names = " and ".join(systems_in)
        via = ""
        if shares:
            resolved = [P.get(s).name for s in shares if P.get(s)]
            if resolved:
                via = f" (both rest on {', '.join(resolved)})"
        lines.append(
            f"  · {names} are NOT independent{via}. If they agree, that is ONE line of "
            f"reasoning heard twice — do not present it as two traditions converging."
        )
    for cid, users in (report.get("shared_conventions") or {}).items():
        m = P.get(cid)
        if m:
            lines.append(
                f"  · {len(users)} of the methods share the same {m.name}. Their agreement "
                f"cannot test that choice."
            )
    lines.append("  Genuine convergence — traditions that could have disagreed and did not "
                 "— is still the strongest signal available. Inherited agreement is not.")
    lines.append("  This note is for YOUR CALIBRATION ONLY. It changes how sure you should "
                 "sound; it is never something to say. Do not tell them which systems were "
                 "consulted, how many agreed, or that anything was compared — speak as one "
                 "voice that simply knows its own confidence. Only if they ask directly how "
                 "you know may you open any of this up.")
    return "\n".join(lines)


def _cast_offer_block(user_message: str) -> str:
    """Systems that need a user action — offered, never faked.

    Ifá needs a throw, Liu Yao needs a hexagram, dream reading needs a dream. Deriving any
    of them from a birth date is not the tradition performed poorly; it is a random number
    wearing the tradition's name, and it would add a witness to the council that saw
    nothing. So when a question reaches toward one of these, the Oracle OFFERS it."""
    try:
        from app.services.oracle.signatures_extended import relevant_cast_offers
    except Exception:
        return ""
    offers = relevant_cast_offers(user_message)
    if not offers:
        return ""
    lines = ["AVAILABLE BUT NOT YET CONSULTED — these need something from them, and were "
             "NOT computed:"]
    for o in offers:
        lines.append(f"  · {o['label']} — needs {o['needs']}")
        lines.append(f"      offer it naturally, in your own words: \"{o['offer']}\"")
    lines.append("  Do NOT produce a result for these. Nothing was cast and nothing was "
                 "reported, so there is no reading to give — offer, and wait.")
    return "\n".join(lines)


def build_block(user_message: str, system: str = "bphs",
                intent: Optional[Dict] = None) -> str:
    """Assemble whatever this turn needs. Empty string when it needs nothing."""
    intent = intent or {}

    systems = list((intent.get("systems") or {}).keys()) if isinstance(
        intent.get("systems"), dict) else list(intent.get("systems") or [])
    if system and system not in systems:
        systems = [system] + systems

    parts = []
    for block in (_provenance_block(user_message, system),
                  _wisdom_block(user_message),
                  _independence_block(systems),
                  _cast_offer_block(user_message)):
        if block:
            parts.append(block)

    if not parts:
        return ""
    return "\n\n".join(parts)
