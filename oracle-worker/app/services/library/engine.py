"""
LIBRARY — Layer 3 · the COMPARISON ENGINE.

The consensus engine (Level 6) asks which traditions agree about a person. This asks which
traditions agree about the world — and applies the same discipline, because the failure
mode is identical and far more common here.

THE CLAIM THIS ENGINE IS BUILT TO REFUSE
────────────────────────────────────────
"All the great traditions teach the same truth." They do not. Where they appear to, it is
usually because one read the other: Neoplatonism, Kabbalah and Sufism share an emanation
cosmology because the lineage runs Plotinus → Islamic transmission → both. Presenting that
as three cultures independently glimpsing one reality inverts the actual history.

And where genuine convergence DOES occur — Vedic, Maya, Stoic and Norse cyclical time,
across four regions with no meaningful contact — it is far more striking than the fake
kind, and it is invisible to anyone who counts agreements without checking lineage.

So `compare()` reports three things separately:
  • stances, grouped, with the traditions holding each
  • how many INDEPENDENT lines hold each stance, after collapsing shared ancestry
  • which apparent agreements collapsed, and what they share

Disagreement is never smoothed. A concept where the traditions genuinely split is
reported as split, because that is the state of the question.
"""
from typing import Dict, List

from app.services.library import concepts as _c
from app.services.library import lineage as _lin


def compare(concept_id: str) -> Dict:
    """Every tradition's position on one question, grouped by stance and weighted by
    genuine independence."""
    concept = _c.get_concept(concept_id)
    if not concept:
        return {}

    positions = _c.positions_for(concept_id)
    if not positions:
        return {"concept": _c.concept_to_dict(concept), "stances": [],
                "summary": "No positions recorded for this question yet."}

    by_stance: Dict[str, List] = {}
    for p in positions:
        by_stance.setdefault(p.stance or "unclassified", []).append(p)

    stances = []
    for stance, ps in sorted(by_stance.items(), key=lambda kv: -len(kv[1])):
        trads = [p.tradition for p in ps]
        conv = _lin.convergence_report(trads)
        stances.append({
            "stance": stance,
            "traditions_holding": len(trads),
            "independent_lines": conv["independent_lines"],
            "collapsed": conv["collapsed"],
            "cross_cultural": conv["genuinely_cross_cultural"],
            "lineage": conv["lines"],
            "positions": [_c.to_dict(p) for p in ps],
        })

    all_trads = [p.tradition for p in positions]
    overall = _lin.convergence_report(all_trads)

    return {
        "concept": _c.concept_to_dict(concept),
        "stances": stances,
        "traditions_total": len(all_trads),
        "independent_lines_total": overall["independent_lines"],
        "summary": _summarise(concept, stances, overall),
        "genuine_convergences": _convergences(stances),
        "apparent_convergences": _apparent(stances),
    }


def _summarise(concept, stances: List[Dict], overall: Dict) -> str:
    n = len(stances)
    if n == 1:
        s = stances[0]
        if s["independent_lines"] >= 3 and s["cross_cultural"]:
            return (f"Unusual agreement: {s['independent_lines']} independent traditions "
                    f"across separate regions hold that {s['stance']}.")
        return f"The recorded traditions agree ({s['stance']}), but not independently."
    top = stances[0]
    return (f"The traditions divide {n} ways on this. The most widely held is "
            f"'{top['stance']}' ({top['independent_lines']} independent line(s) of "
            f"{top['traditions_holding']} tradition(s)). This is a contested question, "
            f"not a settled one.")


def _convergences(stances: List[Dict]) -> List[Dict]:
    """Positions reached by genuinely separate traditions — the findings worth a user's
    attention."""
    out = []
    for s in stances:
        if s["independent_lines"] >= 2 and s["cross_cultural"]:
            regions = sorted({r for line in s["lineage"] for r in line["regions"]})
            out.append({
                "stance": s["stance"],
                "independent_lines": s["independent_lines"],
                "regions": regions,
                "traditions": [t for line in s["lineage"] for t in line["names"]],
                "note": (f"Reached separately in {len(regions)} regions with no "
                         f"transmission recorded between them."),
            })
    return out


def _apparent(stances: List[Dict]) -> List[Dict]:
    """Agreements that collapse once lineage is accounted for — recorded explicitly so the
    platform never presents inheritance as corroboration."""
    out = []
    for s in stances:
        for line in s["lineage"]:
            if len(line["traditions"]) > 1:
                out.append({
                    "stance": s["stance"],
                    "traditions": line["names"],
                    "common_ancestry": line["common_ancestry"],
                    "note": ("These share transmission — their agreement is inheritance, "
                             "not independent confirmation."),
                })
    return out


def positions_of(tradition_id: str) -> Dict:
    """Everything one tradition holds, across all questions — the 'read this school' view."""
    t = _lin.get(tradition_id)
    if not t:
        return {}
    ps = _c.positions_by_tradition(tradition_id)
    return {
        "tradition": {"id": t.id, "name": t.name, "region": t.region, "period": t.period,
                      "note": t.note},
        "descends_from": [e.parent for e in _lin.parents(tradition_id)],
        "positions": [_c.to_dict(p) for p in ps],
        "concepts_covered": sorted({p.concept for p in ps}),
    }


def search(query: str) -> Dict:
    """User-facing entry: a question in plain words → the traditions that answer it."""
    hits = _c.resolve_concept(query)
    if not hits:
        return {"found": False, "query": query}
    return {"found": True, "query": query,
            "results": [compare(c.id) for c in hits[:2]]}


def to_prompt(result: Dict) -> str:
    """Render a comparison for the Oracle."""
    if not result or not result.get("stances"):
        return ""
    c = result["concept"]
    lines = [f"LIBRARY — {c['name']}: {c['question']}", result["summary"], ""]

    for s in result["stances"]:
        head = f"  [{s['stance'].upper()}] {s['traditions_holding']} tradition(s)"
        if s["collapsed"]:
            head += f", {s['independent_lines']} independent after shared lineage collapsed"
        lines.append(head)
        for p in s["positions"]:
            lines.append(f"    · {p['tradition_name']} ({p['region']}, {p['period']}): {p['claim']}")
            if p["key_terms"]:
                lines.append(f"        terms: {', '.join(p['key_terms'])}")
            if p["tension"]:
                lines.append(f"        tension: {p['tension']}")
            if p["sources"]:
                lines.append("        in: " + "; ".join(
                    f"{s2['title']} ({s2['author']}, {s2['date']})" for s2 in p["sources"]))
        lines.append("")

    if result.get("genuine_convergences"):
        lines.append("GENUINE CONVERGENCE (separate traditions, no transmission recorded):")
        for g in result["genuine_convergences"]:
            lines.append(f"  · {g['stance']} — {', '.join(g['traditions'])} "
                         f"[{', '.join(g['regions'])}]")
        lines.append("")

    if result.get("apparent_convergences"):
        lines.append("APPARENT convergence — inheritance, NOT independent agreement:")
        for a in result["apparent_convergences"]:
            anc = f" via {', '.join(a['common_ancestry'])}" if a["common_ancestry"] else ""
            lines.append(f"  · {', '.join(a['traditions'])}{anc}")
        lines.append("")

    lines.append("Present these as distinct answers by distinct traditions. Do not merge "
                 "them into a single teaching, do not claim they all say the same thing, "
                 "and never describe an inherited position as independent confirmation. "
                 "Where they disagree, the disagreement is the answer.")
    return "\n".join(lines)
