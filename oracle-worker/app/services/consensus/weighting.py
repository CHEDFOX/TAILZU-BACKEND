"""
CONSENSUS — WEIGHTING (the machinery decides how sure to sound, and then hides).

The engine's structure — which systems agreed, which collapsed into one line, which share
a convention — is DIAGNOSTIC, not editorial. A user asking about their career does not
want a table of traditions and a note on transmission history. They want an answer, in
plain language, pitched at the confidence the evidence actually supports.

So this module converts the consensus structure into two things:

    weight(result)       a single 0–1 number: how much the evidence supports the claim
    to_guidance(result)  an instruction to the model about HOW SURE TO SOUND,
                         naming no system and exposing no machinery

The difference between "three unrelated traditions converge" and "one technique says so,
restated twice" should be audible in the ANSWER — in whether it leads or hedges, in
whether it says "this is a strong period" or "there's a suggestion of" — and invisible as
apparatus. That is the whole point: the rigour buys tone, not a diagram.

WHAT MAKES THE WEIGHT "SMART"
─────────────────────────────
Not a count. Five factors, and the first is the one nobody else computes:

  1. INDEPENDENT LINES, not findings. Four techniques agreeing where three are relatives
     is one-and-a-bit witnesses, not four. This is the whole reason the dependency graph
     exists.
  2. Opposition, weighted the same way — one independent dissent costs more than three
     related ones.
  3. The findings' own strengths, averaged within a line rather than summed, so a line
     does not gain weight by being subdivided.
  4. Determinacy. Deterministic methods agreeing means more than interpretive ones, where
     the source texts themselves permit several readings.
  5. Shared conventions. Methods that all rest on the same ayanamsha cannot test it, so
     unanimity among them is discounted for correlated error.
"""
from typing import Dict

from app.services import provenance as P
from app.services.consensus import engine as _eng

# How much a line's determinacy is trusted. An interpretive method agreeing is real
# evidence, but weaker — its own tradition admits more than one reading of it.
_DETERMINACY_FACTOR = {
    P.DETERMINISTIC: 1.00,
    P.PARAMETRIC: 0.90,
    P.INTERPRETIVE: 0.70,
    P.STATISTICAL: 0.00,     # excluded from personal scope upstream; belt and braces
}

# Diminishing returns. A fourth independent line adds less than the second.
_LINE_VALUE = [0.0, 0.45, 0.72, 0.88, 0.95, 1.0]


def _line_strength(cluster: Dict) -> float:
    """One independent line's strength: mean of its findings, scaled by determinacy.

    MEAN, not sum — otherwise a tradition could inflate its own weight simply by having
    more techniques that say the same thing, which is the error this whole layer exists
    to avoid."""
    fs = cluster.get("findings") or []
    if not fs:
        return 0.0
    strengths = [float(f.get("strength", 0.5)) for f in fs]
    base = sum(strengths) / len(strengths)

    factors = []
    for f in fs:
        m = P.get(f.get("method", ""))
        factors.append(_DETERMINACY_FACTOR.get(m.determinacy, 0.8) if m else 0.8)
    return base * (sum(factors) / len(factors))


def _value_of(n: int) -> float:
    return _LINE_VALUE[min(n, len(_LINE_VALUE) - 1)]


def weight(result: Dict) -> Dict:
    """A single confidence number, with its reasoning kept for the debugger."""
    if not result or result.get("verdict") == _eng.INSUFFICIENT:
        return {"weight": 0.0, "confidence": "none",
                "why": "no admissible evidence"}
    if result.get("verdict") == _eng.BALANCED:
        # Read, and found mixed or neutral. Its own band, never "none": the traditions did
        # read it, and what they found (a pull both ways, or no push at all) is the answer.
        neu = result.get("neutral") or []
        band = "mixed" if any(n.get("direction") == _eng.MIXED for n in neu) else "neutral"
        return {"weight": 0.5, "confidence": band, "direction": "none",
                "independent_supporting": 0, "independent_opposing": 0,
                "mean_line_strength": None, "correlated_error_discount": 0.0,
                "why": f"{len(neu)} reading(s) found it {band}, none leaning either way"}

    sup = result.get("supported_by") or []
    opp = result.get("opposed_by") or []

    sup_strength = sum(_line_strength(c) for c in sup) / max(len(sup), 1)
    opp_strength = sum(_line_strength(c) for c in opp) / max(len(opp), 1)

    raw_sup = _value_of(len(sup)) * sup_strength
    raw_opp = _value_of(len(opp)) * opp_strength

    net = raw_sup - raw_opp

    # Correlated-error discount: lines resting on a shared convention cannot test it.
    ind = result.get("independence") or {}
    shared = ind.get("shared_conventions") or {}
    discount = 1.0 - min(0.25, 0.08 * len(shared))
    net *= discount

    w = max(0.0, min(1.0, (net + 1.0) / 2.0))     # map −1..1 onto 0..1

    # THE BAND IS THE STRUCTURE, NOT THE NUMBER. The band used to be read off `w`
    # alone, and `w` treats opposition as missing support — so two independent
    # traditions AGREEING that something is hard came out "weak" and the model was
    # told "one line of reasoning only… speak tentatively or leave it out", and a
    # single line (Vedic and KP collapsed into one, exactly as the independence graph
    # requires) came out "moderate", described as "two separate lines". Corroborated
    # bad news was softened and single opinions were inflated: the one inversion this
    # layer exists to prevent. The band now says how many independent lines there are
    # and which way they point; `w` stays for the debugger.
    n_sup, n_opp = len(sup), len(opp)
    if n_sup and n_opp:
        band, direction = "contested", "contested"
    elif not n_sup and not n_opp:
        band, direction = "none", "none"
    else:
        n, strength = (n_sup, sup_strength) if n_sup else (n_opp, opp_strength)
        direction = "supportive" if n_sup else "adverse"
        band = ("strong" if n >= 3 else "moderate" if n == 2
                else "single" if strength >= 0.4 else "weak")
        if direction == "adverse":
            band += "_against"

    return {
        "weight": round(w, 4),
        "confidence": band,
        "direction": direction,
        "independent_supporting": n_sup,
        "independent_opposing": n_opp,
        "mean_line_strength": round(sup_strength if n_sup else opp_strength, 4),
        "correlated_error_discount": round(1 - discount, 4),
        "why": (f"{n_sup} independent supporting line(s), {n_opp} opposing; "
                f"mean line strength {(sup_strength if n_sup else opp_strength):.2f}"
                + (f"; discounted {(1-discount)*100:.0f}% for shared conventions"
                   if shared else "")),
    }


# ═══════════════════════════════════════════════════════════════════════════
# GUIDANCE — how sure to sound, naming nothing
# ═══════════════════════════════════════════════════════════════════════════

_LABEL = {
    "strong": "three or more independent lines agree it favours them",
    "moderate": "two independent lines agree it favours them",
    "single": "one line of reasoning favours it",
    "weak": "one weak indication in its favour",
    "strong_against": "three or more independent lines agree it is hard",
    "moderate_against": "two independent lines agree it is hard",
    "single_against": "one line of reasoning points against it",
    "weak_against": "one weak indication against it",
    "contested": "independent lines point both ways",
    "mixed": "the readings find real pulls both ways, with no clear lean",
    "neutral": "the readings find no lean either way",
    "none": "nothing admissible bears on it",
}

_TONE = {
    "strong": (
        "That is as much corroboration as this platform can produce. LEAD with it, state it "
        "plainly and without hedging, and let it carry the reading."),
    "moderate": (
        "Say it directly, but do not oversell — it is well supported, not certain."),
    "single": (
        "Real, but a single indication: other techniques may restate it without being "
        "independent of it. Pitch it as a leaning — 'there's something here that favours…' — "
        "not a verdict, and do not build the whole reading on it."),
    "weak": (
        "Speak tentatively or leave it out. Do not build the reading on this."),
    "strong_against": (
        "This is corroborated difficulty. Say it plainly — softening it into a maybe is the "
        "flattery the truth rules forbid. In the same breath give the counterweight: what eases "
        "it, when it lifts, what they can do."),
    "moderate_against": (
        "Say it directly: this is hard, and two separate readings see it. Give the counterweight "
        "in the same breath — what eases it, when it lifts, what they can do."),
    "single_against": (
        "One indication points against it. Name it honestly as a caution rather than a verdict, "
        "with what would change it."),
    "weak_against": (
        "A faint caution at most. Mention it lightly or leave it out."),
    "contested": (
        "The evidence genuinely pulls both ways. Do NOT manufacture a verdict and do not "
        "split the difference into mush. Name the tension in ordinary human terms — that "
        "there is something pulling each way here — and then give them something usable "
        "anyway: what to watch for, what would tip it. An honest 'this one is genuinely "
        "unsettled, and here is what would decide it' is more useful than false "
        "confidence, and they will trust everything else you say more for it."),
    "mixed": (
        "This was read, and it is genuinely mixed: something favours it and something stands "
        "in its way. Do not refuse, and do not manufacture a verdict. Name both pulls in plain "
        "human terms, lean only where the data's timing leans, and give them something usable: "
        "what to watch for, what would tip it, what is in their hands."),
    "neutral": (
        "This was read, and nothing pushes it strongly either way. Say plainly that it is open, "
        "neither promised nor blocked, and give them what does decide it: the timing in the data "
        "and what is in their hands. Do not invent a verdict, and do not refuse."),
    "none": (
        "Nothing admissible bears on this. Say you don't have a read on it rather than "
        "improvising one."),
}

_SILENCE = (
    "NEVER expose the machinery. Do not name which traditions were consulted, do not say "
    "how many agreed, do not mention independence, corroboration, weighting, or that "
    "systems were compared at all. The confidence above is already priced into how you "
    "should sound — carry it in the phrasing, not as a claim about method. Speak as one "
    "voice that simply knows how sure it is.\n"
    "If — and only if — they ask directly how you know, which tradition says so, or push "
    "for the reasoning, you may go deeper and name specifics. Their asking is the door; "
    "until then it stays shut.")


def to_guidance(result: Dict, topic: str = "") -> str:
    """The Oracle-facing rendering: confidence as tone, machinery invisible."""
    if not result:
        return ""
    w = weight(result)
    band = w["confidence"]
    tone = _TONE.get(band, _TONE["weak"])
    t = topic or result.get("topic") or "this"

    lines = [f"CONFIDENCE on {t}: {_LABEL.get(band, band)}.", tone]

    # The substance, stripped of attribution — the model still needs to know WHAT was
    # found, just not who found it.
    points = []
    for c in (result.get("supported_by") or []):
        for f in c.get("findings", []):
            points.append(f.get("basis", ""))
    against = []
    for c in (result.get("opposed_by") or []):
        for f in c.get("findings", []):
            against.append(f.get("basis", ""))

    if points:
        lines.append("\nWhat supports it (substance only — never attribute these):")
        lines += [f"  · {p}" for p in points if p]
    if against:
        lines.append("\nWhat cuts against it:")
        lines += [f"  · {p}" for p in against if p]
    if band in ("mixed", "neutral"):
        both = [n.get("basis", "") for n in (result.get("neutral") or []) if n.get("basis")]
        if both:
            lines.append("\nWhat pulls each way (substance only — never attribute these):")
            lines += [f"  · {b}" for b in both]

    lines.append("\n" + _SILENCE)
    return "\n".join(lines)


def depth_requested(text: str) -> bool:
    """Has the user asked for the reasoning? Only then does the machinery open.

    Deliberately narrow. A general 'why' about their life is not a request for method —
    'why am I struggling with money' wants an answer, not a bibliography."""
    t = (text or "").lower()
    asks = (
        "how do you know", "which system", "which tradition", "what system",
        "how did you", "what's that based on", "whats that based on", "based on what",
        "which method", "show me the reasoning", "why do you say", "how sure",
        "how confident", "do the systems agree", "what do the other", "prove",
        "which school", "what does vedic say", "what does bazi", "compare the",
    )
    return any(a in t for a in asks)


def to_detail(result: Dict) -> str:
    """The full structure — ONLY for when depth_requested() is true.

    This is the renderer that names systems and shows the collapse. It is the exception,
    not the default."""
    return _eng.to_prompt(result)
