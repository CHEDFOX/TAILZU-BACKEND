"""
PROVENANCE — Layer 2 · the METHOD REGISTRY (Level 7 of the architecture).

Every deterministic technique the platform computes is declared here, next to where it
came from. Adding one is a single decorated declaration in any module under
`provenance/methods/` — same plug-in shape as `patterns/registry.py`, so the two
registries feel identical and neither needs to know about the other.

    @method(
        id="vimshottari_dasha",
        name="Vimshottari Dasha",
        system="bphs",
        level=4,
        sources=("bphs", "laghu_parashari"),
        inputs=("moon_longitude", "birth_datetime"),
        outputs=("mahadasha_sequence", "period_boundaries"),
        implemented_in="app.services.dashas.vimshottari",
    )

WHY THE `verified` FLAG EXISTS
──────────────────────────────
A citation that names a chapter and verse the user cannot find is worse than no citation
at all — it manufactures false authority and, once caught, discredits every other claim
the platform makes. So `locus` (chapter / verse / page) is NEVER emitted unless
`verified=True`, meaning a human has checked that exact passage in the exact edition
named in `locus_edition`.

Unverified methods still cite their SOURCE — we know Vimshottari is in BPHS. We simply
do not claim to know which numbered chapter of which recension until someone has looked.
`render_citation()` enforces this; it is not left to the caller's discretion, and the
LLM never sees an unverified locus at all.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.services.provenance import sources as _sources

# Architecture levels (mirrors the platform design doc)
LEVELS = {
    0: "Astronomical Truth",
    1: "Classical Engines",
    2: "Research Modules",
    3: "Cross-System Analysis",
    4: "Time Engine",
    5: "Pattern Engine",
    6: "Consensus Engine",
    7: "Research Database",
    8: "Explainability",
}

# How much interpretive freedom the method carries. This matters for consensus weighting
# (Level 6): a DETERMINISTIC method that two engines disagree on indicates a bug, whereas
# an INTERPRETIVE one may legitimately differ between schools.
DETERMINISTIC = "deterministic"   # same inputs → same outputs, no judgement
PARAMETRIC = "parametric"         # deterministic once a convention is chosen (ayanamsha, house system)
INTERPRETIVE = "interpretive"     # the classical sources themselves disagree
STATISTICAL = "statistical"       # an empirical claim, not a rule

_DETERMINACY = {DETERMINISTIC, PARAMETRIC, INTERPRETIVE, STATISTICAL}


@dataclass(frozen=True)
class Method:
    id: str
    name: str
    system: str                        # bphs | western | chinese | kp | jaimini | research …
    level: int                         # 0–8, the architecture layer it belongs to
    determinacy: str
    sources: Tuple[str, ...]           # source ids from sources.py
    inputs: Tuple[str, ...]
    outputs: Tuple[str, ...]
    scope: str = ""                    # personal | mundane | electional | horary | psychological
    steps: Tuple[str, ...] = ()        # the computation, in words — Level 8 reads this
    assumptions: Tuple[str, ...] = ()
    limitations: Tuple[str, ...] = ()
    deps: Tuple[str, ...] = ()         # other method ids this one builds on
    related: Tuple[str, ...] = ()      # sibling techniques (not dependencies)
    implemented_in: str = ""           # dotted module path to the code that computes it
    locus: str = ""                    # chapter / verse / page — gated by `verified`
    locus_edition: str = ""            # WHICH edition the locus refers to
    verified: bool = False             # has a human checked `locus` in `locus_edition`?
    also_known_as: Tuple[str, ...] = ()
    note: str = ""


_REGISTRY: Dict[str, Method] = {}


def method(id: str, name: str, system: str, level: int, sources: Tuple[str, ...],
           inputs: Tuple[str, ...] = (), outputs: Tuple[str, ...] = (),
           determinacy: str = DETERMINISTIC, **kw):
    """Decorator OR direct call. Registers a method's provenance.

    Used bare (no function to wrap) in the `methods/` modules, since a provenance record
    describes code that already lives elsewhere — `implemented_in` points at it rather
    than the declaration owning it. Returns the Method so it can be referenced."""
    if level not in LEVELS:
        raise ValueError(f"bad level {level!r} for method {id!r}")
    if determinacy not in _DETERMINACY:
        raise ValueError(f"bad determinacy {determinacy!r} for method {id!r}")
    if id in _REGISTRY:
        raise ValueError(f"duplicate method id {id!r}")
    for s in sources:
        if not _sources.get(s):
            raise ValueError(f"method {id!r} cites unknown source {s!r}")
    if kw.get("locus") and not kw.get("verified"):
        # Allowed — but the locus stays invisible until verified. Recording it now means
        # a reviewer has something concrete to go and check.
        pass
    if kw.get("verified") and not kw.get("locus_edition"):
        raise ValueError(f"method {id!r} claims verified but names no edition")

    m = Method(id=id, name=name, system=system, level=level, determinacy=determinacy,
               sources=tuple(sources), inputs=tuple(inputs), outputs=tuple(outputs), **kw)
    _REGISTRY[id] = m
    return m


# ═══════════════════════════════════════════════════════════════════════════
# ACCESSORS
# ═══════════════════════════════════════════════════════════════════════════

def get(method_id: str) -> Optional[Method]:
    return _REGISTRY.get(method_id)


def all_methods() -> Dict[str, Method]:
    return dict(_REGISTRY)


def by_system(system: str) -> List[Method]:
    return sorted((m for m in _REGISTRY.values() if m.system == system), key=lambda m: m.id)


def by_level(level: int) -> List[Method]:
    return sorted((m for m in _REGISTRY.values() if m.level == level), key=lambda m: m.id)


def systems() -> List[str]:
    return sorted({m.system for m in _REGISTRY.values()})


def resolve(name: str) -> List[Method]:
    """Fuzzy lookup by id, name or alias — what the Oracle calls when a user asks about a
    technique by whatever name they happen to know it by."""
    q = (name or "").strip().lower()
    if not q:
        return []
    if q in _REGISTRY:
        return [_REGISTRY[q]]
    hits = []
    for m in _REGISTRY.values():
        hay = [m.id.lower(), m.name.lower(), *(a.lower() for a in m.also_known_as)]
        if any(q == h for h in hay):
            return [m]
        if any(q in h or h in q for h in hay):
            hits.append(m)
    return sorted(hits, key=lambda m: m.id)


def dependency_chain(method_id: str, _seen: Optional[set] = None) -> List[Method]:
    """Every method this one rests on, transitively — the Level 8 'what did this rely on'
    answer. Cycle-safe."""
    seen = _seen if _seen is not None else set()
    m = _REGISTRY.get(method_id)
    if not m or method_id in seen:
        return []
    seen.add(method_id)
    out = [m]
    for d in m.deps:
        out.extend(dependency_chain(d, seen))
    return out


# ═══════════════════════════════════════════════════════════════════════════
# RENDERING — the only sanctioned path from a Method to user-visible text
# ═══════════════════════════════════════════════════════════════════════════

def render_citation(method_id: str, full: bool = False) -> str:
    """Human-readable provenance for one method.

    The locus is emitted ONLY when verified against a named edition. This is the single
    guard that keeps a plausible-looking chapter number from reaching a user."""
    m = _REGISTRY.get(method_id)
    if not m:
        return ""
    cites = []
    for sid in m.sources:
        s = _sources.get(sid)
        if not s:
            continue
        if m.verified and m.locus and sid == m.sources[0]:
            cites.append(f"{_sources.cite(sid, m.locus)} [{m.locus_edition}]")
        else:
            cites.append(_sources.cite(sid))
    line = f"{m.name} — {'; '.join(cites)}"
    if not full:
        return line

    parts = [line]
    if m.determinacy != DETERMINISTIC:
        parts.append(f"Determinacy: {m.determinacy}")
    if m.steps:
        parts.append("Computation: " + " → ".join(m.steps))
    if m.assumptions:
        parts.append("Assumes: " + "; ".join(m.assumptions))
    if m.limitations:
        parts.append("Limitations: " + "; ".join(m.limitations))
    if not m.verified:
        parts.append("Passage-level citation not yet verified against a printed edition; "
                     "the work is certain, the exact chapter is not.")
    return "\n".join(parts)


def to_dict(m: Method) -> dict:
    d = {
        "id": m.id, "name": m.name, "system": m.system,
        "level": m.level, "level_name": LEVELS[m.level],
        "determinacy": m.determinacy, "scope": m.scope,
        "sources": [_sources.to_dict(_sources.get(s)) for s in m.sources if _sources.get(s)],
        "inputs": list(m.inputs), "outputs": list(m.outputs),
        "steps": list(m.steps), "assumptions": list(m.assumptions),
        "limitations": list(m.limitations), "deps": list(m.deps),
        "related": list(m.related), "implemented_in": m.implemented_in,
        "also_known_as": list(m.also_known_as), "note": m.note,
        "verified": m.verified,
        "citation": render_citation(m.id),
    }
    if m.verified and m.locus:
        d["locus"] = m.locus
        d["locus_edition"] = m.locus_edition
    return d


def catalog() -> List[dict]:
    return [to_dict(m) for m in sorted(_REGISTRY.values(), key=lambda x: (x.level, x.system, x.id))]


def verify_implementations() -> dict:
    """Does every `implemented_in` actually resolve to a module?

    This exists because it caught a real error: `barbault_cyclic_index` was declared with
    implemented_in="app.services.mundane" when no cyclic index existed anywhere in that
    package. The registry was asserting a capability the codebase did not have, which is
    the one failure mode a provenance layer must not have — a false claim about itself is
    worse than a missing entry.

    Uses find_spec rather than import, so checking costs nothing and triggers no side
    effects. It verifies the MODULE resolves, not that the function inside it is correct;
    that is what the per-module import assertions are for."""
    import importlib.util

    ok, missing, undeclared = [], [], []
    for m in _REGISTRY.values():
        if not m.implemented_in:
            undeclared.append(m.id)
            continue
        try:
            spec = importlib.util.find_spec(m.implemented_in)
        except (ImportError, ModuleNotFoundError, ValueError):
            spec = None
        (ok if spec else missing).append(
            m.id if spec else {"method": m.id, "claims": m.implemented_in})

    return {
        "total": len(_REGISTRY),
        "resolved": len(ok),
        "unresolved": missing,
        "no_implementation_declared": undeclared,
        "healthy": not missing,
        "note": ("`unresolved` means the registry claims an implementation that does not "
                 "exist. Treat any entry here as a bug in the registry, not a gap in the "
                 "codebase — the claim should be corrected or the code written."),
    }


def coverage() -> dict:
    """How much of the registry is passage-verified — the honest completion metric for
    Level 7, and the work queue for whoever is checking the texts."""
    total = len(_REGISTRY)
    ver = sum(1 for m in _REGISTRY.values() if m.verified)
    per_system: Dict[str, dict] = {}
    for m in _REGISTRY.values():
        b = per_system.setdefault(m.system, {"total": 0, "verified": 0})
        b["total"] += 1
        b["verified"] += 1 if m.verified else 0
    return {"total": total, "verified": ver,
            "unverified": total - ver,
            "pct_verified": round(100.0 * ver / total, 1) if total else 0.0,
            "by_system": per_system,
            "by_level": {lvl: len(by_level(lvl)) for lvl in sorted(LEVELS)}}
