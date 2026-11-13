"""
CONSENSUS — Layer 1 · INDEPENDENCE (what makes agreement mean anything).

"Three systems agree" is the claim every divination platform makes and almost none of
them earn. Agreement is only evidence when the agreeing methods could have disagreed —
and two methods that read the same quantity cannot.

Vimshottari Dasha and KP both key off the Moon's nakshatra position. When both report a
favourable period they are not two witnesses; they are one measurement reported twice. To
count that as corroboration is to manufacture confidence out of arithmetic, and it is the
single most common way a multi-system reading misleads.

This module computes actual independence from the provenance dependency graph rather than
assuming it from the fact that two techniques have different names.

TWO KINDS OF SHARING, TREATED DIFFERENTLY
─────────────────────────────────────────
  SUBSTRATE (level 0)  Every method on earth depends on planetary positions. That is not
                       shared reasoning, it is shared reality, and treating it as
                       dependence would collapse everything into one cluster. Level-0
                       ancestry is recorded as a shared CONVENTION, not as dependence.

  TECHNIQUE (level 1+)  Two methods that both rest on the rashi chart share an ayanamsha,
                        a house system and a sidereal frame. If that frame is wrong they
                        are wrong together. THAT is dependence.

Shared conventions are reported separately, because they are the correlated-error risk: a
consensus built entirely on tropical-zodiac methods is unanimous about nothing if the
tropical frame is the wrong question to be asking.
"""
from typing import Dict, Iterable, List, Set, Tuple

from app.services import provenance as P


def _ancestry(method_id: str) -> Set[str]:
    """Every method in this one's dependency chain, itself included."""
    return {m.id for m in P.dependency_chain(method_id)}


def _technique_ancestry(method_id: str) -> Set[str]:
    """Ancestry above the astronomical substrate — the part that represents shared
    REASONING rather than shared sky."""
    out = set()
    for m in P.dependency_chain(method_id):
        if m.level > 0:
            out.add(m.id)
    return out


def shares_reasoning(a: str, b: str) -> Tuple[bool, Set[str]]:
    """Do two methods rest on common technique? Returns (verdict, what they share).

    True when one descends from the other, or when both descend from a common
    non-substrate ancestor."""
    ta, tb = _technique_ancestry(a), _technique_ancestry(b)
    shared = (ta & tb) - {a, b}
    if a in tb or b in ta:
        # direct ancestry — the strongest form of dependence
        shared = shared | ({a} if a in tb else set()) | ({b} if b in ta else set())
        return True, shared
    return bool(shared), shared


def shared_conventions(method_ids: Iterable[str]) -> Dict[str, List[str]]:
    """Level-0 choices the given methods hold in common — the correlated-error surface.

    A consensus whose members all share `ayanamsha` is not robust to the ayanamsha being
    the wrong convention; it is unanimous *because* of it."""
    ids = list(method_ids)
    counts: Dict[str, List[str]] = {}
    for mid in ids:
        for m in P.dependency_chain(mid):
            if m.level == 0 and m.determinacy == P.PARAMETRIC:
                counts.setdefault(m.id, []).append(mid)
    # only interesting when more than one method leans on it
    return {k: v for k, v in counts.items() if len(v) > 1}


def clusters(method_ids: Iterable[str]) -> List[Set[str]]:
    """Partition methods into independent groups. Methods within a cluster corroborate
    each other only weakly; methods in different clusters are genuine separate testimony.

    Union-find over the `shares_reasoning` relation."""
    ids = [m for m in dict.fromkeys(method_ids) if P.get(m)]
    parent: Dict[str, str] = {m: m for m in ids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: str, y: str) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            linked, _ = shares_reasoning(a, b)
            if linked:
                union(a, b)

    groups: Dict[str, Set[str]] = {}
    for m in ids:
        groups.setdefault(find(m), set()).add(m)
    return sorted(groups.values(), key=lambda s: (-len(s), sorted(s)[0]))


def independence_report(method_ids: Iterable[str]) -> Dict:
    """Full picture: how many genuinely separate lines of evidence are present, why the
    dependent ones are dependent, and which conventions they all rest on."""
    ids = [m for m in dict.fromkeys(method_ids) if P.get(m)]
    cl = clusters(ids)

    explained = []
    for group in cl:
        g = sorted(group)
        why = []
        if len(g) > 1:
            for i, a in enumerate(g):
                for b in g[i + 1:]:
                    linked, shared = shares_reasoning(a, b)
                    if linked and shared:
                        why.append({"methods": [a, b], "shares": sorted(shared)})
        explained.append({
            "methods": g,
            "traditions": sorted({P.get(m).system for m in g}),
            "size": len(g),
            "why_grouped": why,
        })

    return {
        "method_count": len(ids),
        "independent_lines": len(cl),
        "clusters": explained,
        "shared_conventions": shared_conventions(ids),
        "collapsed": len(ids) - len(cl),
    }
