"""
CONSENSUS ENGINE — Level 6.

Takes structured verdicts from many traditions and produces one honest answer: what is
corroborated, what rests on a single technique, what actively disagrees, and how much of
the apparent agreement survives once dependent methods are collapsed.

WHAT THIS DELIBERATELY REFUSES TO DO
────────────────────────────────────
  • It does not average traditions into a single score. Vedic and BaZi are not
    measurements of one underlying quantity; averaging them is a category error that
    produces a number meaning nothing.
  • It does not let STATISTICAL findings speak about an individual. A cohort-level result
    (Gauquelin) is registered with determinacy=STATISTICAL and is excluded from personal
    consensus entirely — it can describe populations, never the person asking.
  • It does not hide disagreement. Where traditions genuinely conflict, that conflict IS
    the finding, and it is more useful than a manufactured verdict.

THE CONFIDENCE RULE
───────────────────
Confidence counts INDEPENDENT LINES, not findings. Three methods that share ancestry
count once. A single supporting line is reported as single-source no matter how many
techniques restate it — which is the discipline that makes the number worth reading.
"""
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from app.services import provenance as P
from app.services.consensus import independence as _ind

SUPPORTIVE = "supportive"
ADVERSE = "adverse"
NEUTRAL = "neutral"
MIXED = "mixed"
_DIRECTIONS = {SUPPORTIVE, ADVERSE, NEUTRAL, MIXED}

# Verdict bands, by count of INDEPENDENT lines (never raw finding count).
STRONG = "strong"          # 3+ independent lines agree, no independent line opposes
MODERATE = "moderate"      # 2 independent lines agree
SINGLE_SOURCE = "single"   # 1 line, however many techniques restate it
CONTESTED = "contested"    # independent lines point both ways
INSUFFICIENT = "none"      # nothing admissible was read at all
# Read, and found mixed or neutral: no lean either way. It is not silence. Folding it into
# INSUFFICIENT told the reply "say you don't have a read" on exactly the questions the
# traditions HAD read: two of them agreeing a career was mixed (real support, real
# obstruction) came out as "nothing admissible bears on it", and the oracle refused a
# career question with the career data in front of it.
BALANCED = "balanced"


@dataclass(frozen=True)
class Finding:
    """One tradition's structured verdict on one topic.

    `basis` is human-readable and required — a finding that cannot say why it concluded
    what it concluded is not admissible, because Level 8 has to be able to show it."""
    method_id: str
    topic: str
    direction: str
    strength: float          # 0..1, the method's own confidence in its verdict
    basis: str
    window: Optional[Tuple[str, str]] = None   # ISO dates, when time-bounded

    def __post_init__(self):
        if self.direction not in _DIRECTIONS:
            raise ValueError(f"bad direction {self.direction!r}")
        if not 0.0 <= self.strength <= 1.0:
            raise ValueError(f"strength out of range: {self.strength}")
        if not self.basis:
            raise ValueError(f"finding for {self.method_id!r} has no basis")

    @property
    def method(self):
        return P.get(self.method_id)

    @property
    def system(self) -> str:
        m = self.method
        return m.system if m else "unknown"


def _admissible(f: Finding, scope: str) -> Tuple[bool, str]:
    """Is this finding allowed to speak to this question?"""
    m = f.method
    if not m:
        return False, "method not registered — no provenance, not admissible"
    if scope == "personal" and m.determinacy == P.STATISTICAL:
        return False, ("statistical module: describes populations, cannot speak about an "
                       "individual")
    if scope == "personal" and m.scope in ("mundane", "statistical"):
        return False, f"scope mismatch: method is {m.scope}, question is personal"
    return True, ""


def consensus(findings: Iterable[Finding], topic: str = "", scope: str = "personal") -> Dict:
    """The Level 6 answer.

    Returns supported/opposed/single-source structure with confidence derived from
    independent lines, plus the full independence report so Level 8 can show its work."""
    findings = list(findings)

    admitted: List[Finding] = []
    excluded: List[Dict] = []
    for f in findings:
        ok, why = _admissible(f, scope)
        (admitted.append(f) if ok
         else excluded.append({"method": f.method_id, "reason": why}))

    if not admitted:
        return {
            "topic": topic, "scope": scope, "verdict": INSUFFICIENT,
            "summary": "No admissible evidence for this question.",
            "supported_by": [], "opposed_by": [], "neutral": [],
            "excluded": excluded, "independence": None,
        }

    by_dir: Dict[str, List[Finding]] = {}
    for f in admitted:
        by_dir.setdefault(f.direction, []).append(f)

    sup = by_dir.get(SUPPORTIVE, [])
    adv = by_dir.get(ADVERSE, [])
    neu = by_dir.get(NEUTRAL, []) + by_dir.get(MIXED, [])

    # Independence is computed WITHIN each direction — the question is not "how many
    # methods ran" but "how many separate lines of reasoning reached this conclusion".
    sup_lines = _ind.clusters([f.method_id for f in sup])
    adv_lines = _ind.clusters([f.method_id for f in adv])

    n_sup, n_adv = len(sup_lines), len(adv_lines)

    if n_sup and n_adv:
        verdict = CONTESTED
    elif n_sup >= 3:
        verdict = STRONG
    elif n_sup == 2:
        verdict = MODERATE
    elif n_sup == 1:
        verdict = SINGLE_SOURCE
    elif n_adv >= 2:
        verdict = MODERATE      # moderate agreement that the answer is adverse
    elif n_adv == 1:
        verdict = SINGLE_SOURCE
    else:
        verdict = BALANCED      # everything admitted read it as mixed or neutral

    full_ind = _ind.independence_report([f.method_id for f in admitted])

    def _pack(fs: List[Finding], lines: List) -> List[Dict]:
        out = []
        for cluster in lines:
            members = [f for f in fs if f.method_id in cluster]
            out.append({
                "independent_line": sorted(cluster),
                "traditions": sorted({f.system for f in members}),
                "findings": [
                    {"method": f.method_id, "name": (f.method.name if f.method else f.method_id),
                     "tradition": f.system, "strength": f.strength, "basis": f.basis,
                     "window": list(f.window) if f.window else None,
                     "citation": P.render_citation(f.method_id)}
                    for f in members
                ],
                "restated_by": len(members) - 1,
            })
        return out

    return {
        "topic": topic,
        "scope": scope,
        "verdict": verdict,
        "summary": _summarise(verdict, n_sup, n_adv, full_ind, topic),
        "independent_lines_supporting": n_sup,
        "independent_lines_opposing": n_adv,
        "supported_by": _pack(sup, sup_lines),
        "opposed_by": _pack(adv, adv_lines),
        "neutral": [{"method": f.method_id, "tradition": f.system, "basis": f.basis,
                     "direction": f.direction} for f in neu],
        "excluded": excluded,
        "independence": full_ind,
        "caveats": _caveats(admitted, full_ind),
    }


def _summarise(verdict: str, n_sup: int, n_adv: int, ind: Dict, topic: str) -> str:
    t = topic or "this question"
    collapsed = ind.get("collapsed", 0)
    tail = ""
    if collapsed:
        tail = (f" {collapsed} further technique(s) agreed but share reasoning with a line "
                f"already counted, so they add no independent weight.")
    if verdict == STRONG:
        return f"{n_sup} independent traditions agree on {t}.{tail}"
    if verdict == MODERATE and n_sup:
        return f"Two independent lines agree on {t}; not yet corroborated further.{tail}"
    if verdict == MODERATE and n_adv:
        return f"Two independent lines point AGAINST {t}.{tail}"
    if verdict == SINGLE_SOURCE:
        return (f"Rests on a single line of reasoning. Treat as one opinion, not a "
                f"convergence.{tail}")
    if verdict == CONTESTED:
        return (f"The traditions genuinely disagree on {t}: {n_sup} independent line(s) "
                f"support it, {n_adv} oppose. The disagreement is the honest answer.{tail}")
    if verdict == BALANCED:
        return (f"The traditions read {t} and find no lean: it pulls both ways, or neither. "
                f"That balance is the honest answer, not an absence of one.{tail}")
    return f"Insufficient evidence on {t}."


def _caveats(findings: List[Finding], ind: Dict) -> List[str]:
    """Everything a careful reader should know before trusting the verdict."""
    out: List[str] = []

    conv = ind.get("shared_conventions") or {}
    for cid, users in conv.items():
        m = P.get(cid)
        if m:
            out.append(
                f"{len(users)} of the methods rest on the same convention ({m.name}). "
                f"If that choice is wrong they are wrong together — their agreement does "
                f"not test it."
            )

    interp = [f.method_id for f in findings
              if f.method and f.method.determinacy == P.INTERPRETIVE]
    if interp:
        out.append(
            f"Interpretive method(s) involved ({', '.join(sorted(set(interp)))}): the "
            f"source texts themselves admit more than one reading, so a different "
            f"school could reach a different verdict from the same chart."
        )

    unver = [f.method_id for f in findings if f.method and not f.method.verified]
    if unver:
        out.append(
            "Citations are at work level, not passage level — the texts are named "
            "correctly but exact chapters have not been verified against printed editions."
        )
    return out


def to_prompt(result: Dict) -> str:
    """Render a consensus for the Oracle, with the discipline preserved in words.

    The model receives the structure AND the reasons, so a follow-up question about why
    something was discounted can be answered without another retrieval."""
    if not result or result.get("verdict") == INSUFFICIENT:
        return "CONSENSUS: no admissible evidence — say so plainly rather than improvising."

    lines = [f"CONSENSUS on {result.get('topic') or 'this question'} — {result['verdict'].upper()}",
             result["summary"], ""]

    if result["supported_by"]:
        lines.append("SUPPORTED BY (each bullet is one INDEPENDENT line of reasoning):")
        for c in result["supported_by"]:
            names = ", ".join(f["name"] for f in c["findings"])
            trads = "/".join(c["traditions"])
            extra = f" (+{c['restated_by']} restating it, not independent)" if c["restated_by"] else ""
            lines.append(f"  • [{trads}] {names}{extra}")
            for f in c["findings"]:
                lines.append(f"      {f['basis']}")

    if result["opposed_by"]:
        lines.append("")
        lines.append("NOT SUPPORTED BY:")
        for c in result["opposed_by"]:
            names = ", ".join(f["name"] for f in c["findings"])
            lines.append(f"  • [{'/'.join(c['traditions'])}] {names}")
            for f in c["findings"]:
                lines.append(f"      {f['basis']}")

    if result.get("verdict") == BALANCED and result.get("neutral"):
        lines.append("")
        lines.append("READ AS MIXED OR NEUTRAL:")
        for n in result["neutral"]:
            lines.append(f"  • [{n.get('tradition')}] {n.get('direction')}: {n.get('basis')}")

    if result.get("excluded"):
        lines.append("")
        lines.append("EXCLUDED: " + "; ".join(
            f"{e['method']} ({e['reason']})" for e in result["excluded"]))

    if result.get("caveats"):
        lines.append("")
        lines.append("CAVEATS — state these if the user asks how confident to be:")
        for c in result["caveats"]:
            lines.append(f"  · {c}")

    lines.append("")
    lines.append("Do not present this as one unified verdict. Where traditions differ, say "
                 "so — the disagreement is information, not a failure. Never describe "
                 "restating techniques as additional agreement.")
    return "\n".join(lines)
