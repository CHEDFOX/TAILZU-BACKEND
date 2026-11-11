"""
PROVENANCE — Layer 3 · LLM CONTEXT (Level 8 of the architecture).

Turns registry records into text the Oracle can quote. Two entry points:

  citations_for(...)  — a compact block naming the sources behind the methods that
                        actually fed a given reading. Injected into the reading prompt so
                        the model can answer a follow-up without a second retrieval.

  answer_source(...)  — the direct response to "where does this come from?". Called when
                        the classifier detects a provenance question.

THE ONE RULE THIS FILE ENFORCES
───────────────────────────────
The model is told, explicitly, that it may cite ONLY what appears in the injected block.
Astrological texts are exactly the kind of material an LLM will confabulate fluently —
plausible Sanskrit titles, plausible chapter numbers, plausible verse counts. The whole
value of this layer is that a user who goes looking finds what we said they would find.
So the prompt fragment below is not decorative; it is the guard.
"""
from typing import Dict, Iterable, List

from app.services.provenance import sources as _sources
from app.services.provenance import registry as _reg
import app.services.provenance.methods  # noqa: F401  (registers everything)


# The instruction that travels with every provenance block.
GUARD = (
    "SOURCES — you may cite ONLY what is listed in this block. Do not name a text, "
    "author, date, chapter or verse that does not appear here, even if you believe you "
    "know it. If asked for a passage that is not listed, say the work is known but the "
    "exact passage has not been verified. A citation the user cannot check is a serious "
    "error, worse than admitting the limit."
)


def _method_block(m: _reg.Method, depth: str = "short") -> str:
    """One method's provenance as prompt text."""
    cites = [_sources.cite(s) for s in m.sources if _sources.get(s)]
    if m.verified and m.locus and m.sources:
        cites[0] = f"{_sources.cite(m.sources[0], m.locus)} [{m.locus_edition}]"
    line = f"• {m.name} — {'; '.join(cites)}"
    if depth == "short":
        return line

    out = [line]
    if m.determinacy != _reg.DETERMINISTIC:
        out.append(f"    type: {m.determinacy}")
    if m.steps:
        out.append("    computed by: " + " → ".join(m.steps))
    if m.assumptions:
        out.append("    assumes: " + " ".join(m.assumptions))
    if m.limitations:
        out.append("    limits: " + " ".join(m.limitations))
    if not m.verified:
        out.append("    passage: work certain, exact chapter unverified — do not invent one")
    return "\n".join(out)


def citations_for(method_ids: Iterable[str], depth: str = "short") -> str:
    """Compact source block for the methods that fed a reading.

    Pass the ids the engine actually used. Anything not passed is not cited — that is the
    point: the block is a record of what ran, not a bibliography of what exists."""
    ms = [_reg.get(mid) for mid in method_ids]
    ms = [m for m in ms if m]
    if not ms:
        return ""
    body = "\n".join(_method_block(m, depth) for m in ms)
    return f"{GUARD}\n\n{body}"


def citations_for_system(system: str, depth: str = "short") -> str:
    """Every registered method for one tradition — used when a reading draws on a whole
    engine rather than a named subset."""
    ms = _reg.by_system(system)
    if not ms:
        return ""
    body = "\n".join(_method_block(m, depth) for m in ms)
    return f"{GUARD}\n\n{body}"


def answer_source(query: str, depth: str = "full") -> str:
    """The provenance answer for a user question naming a technique.

    Returns prompt-ready text, or '' when nothing matches — in which case the caller
    should let the model say it does not know rather than improvise."""
    hits = _reg.resolve(query)
    if not hits:
        return ""

    parts = [GUARD, ""]
    for m in hits[:3]:
        parts.append(_method_block(m, depth))

        for sid in m.sources:
            s = _sources.get(sid)
            if not s:
                continue
            det = [f"    ── {s.title}"]
            det.append(f"       {s.author}, {s.date}, originally in {s.language}")
            if s.note:
                det.append(f"       {s.note}")
            if s.editions:
                det.append("       available as: " + "; ".join(s.editions))
            if s.url:
                det.append(f"       {s.url}")
            parts.append("\n".join(det))

        if m.deps:
            chain = _reg.dependency_chain(m.id)[1:]
            if chain:
                parts.append("    rests on: " + ", ".join(c.name for c in chain))
        if m.related:
            rel = [_reg.get(r) for r in m.related]
            rel = [r.name for r in rel if r]
            if rel:
                parts.append("    compare: " + ", ".join(rel))
        if m.implemented_in:
            parts.append(f"    computed in this platform by: {m.implemented_in}")
        parts.append("")

    return "\n".join(parts).strip()


def trace_reading(method_ids: Iterable[str]) -> Dict:
    """Level 8 — the structured, inspectable record of what produced a reading.

    Not prompt text: this is for the API and the debugger. Returns which methods ran,
    what each rests on, which traditions were involved, and where the disagreements are
    allowed to live (interpretive methods) versus where a disagreement means a bug
    (deterministic ones)."""
    ms = [_reg.get(mid) for mid in method_ids]
    ms = [m for m in ms if m]
    systems: Dict[str, List[str]] = {}
    for m in ms:
        systems.setdefault(m.system, []).append(m.id)

    return {
        "methods": [_reg.to_dict(m) for m in ms],
        "systems": systems,
        "independent_traditions": sorted(systems.keys()),
        "deterministic": [m.id for m in ms if m.determinacy == _reg.DETERMINISTIC],
        "interpretive": [m.id for m in ms if m.determinacy == _reg.INTERPRETIVE],
        "statistical": [m.id for m in ms if m.determinacy == _reg.STATISTICAL],
        "parametric_choices": [
            {"method": m.id, "assumptions": list(m.assumptions)}
            for m in ms if m.determinacy == _reg.PARAMETRIC and m.assumptions
        ],
        "unverified_citations": [m.id for m in ms if not m.verified],
        "bibliography": sorted({s for m in ms for s in m.sources}),
    }


def is_provenance_question(text: str) -> bool:
    """Cheap pre-filter so the classifier can route source questions here.

    Deliberately conservative — a false positive costs one extra context block, a false
    negative means the model answers from memory, which is the failure this layer exists
    to prevent."""
    t = (text or "").lower()
    asks = ("where does", "where is this from", "what is the source", "which text",
            "who wrote", "what book", "is this written", "according to whom",
            "says who", "citation", "reference", "which scripture", "original text",
            "how do you know", "based on what", "who says", "where did this come from",
            "what's the source", "whats the source", "prove it", "source for")
    return any(a in t for a in asks)
