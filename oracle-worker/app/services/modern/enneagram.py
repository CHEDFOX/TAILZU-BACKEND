"""
ENNEAGRAM — nine types, with an honest account of where it came from.

Included because users ask for it beside the divinatory systems and because it is
structurally interesting: a nine-pointed figure with a fixed movement pattern
(1→7→5→8→2→4→1 and 3→6→9→3) that determines how each type shifts under stress and in
growth.

PROVENANCE, WHICH IS ROUTINELY MISREPRESENTED
─────────────────────────────────────────────
The enneagram FIGURE comes from G. I. Gurdjieff, who taught it from around 1916 as a
cosmological diagram with no personality typology attached. The TYPOLOGY is separate and
much later: Oscar Ichazo developed it in Chile around 1970, and Claudio Naranjo brought it
to the United States and to psychological framing shortly after.

Claims that it is ancient Sufi teaching, or descends from the desert fathers, or comes
from Pythagorean number mysticism, are not supported. The figure is early twentieth
century and the typology is 1970s. This module records that, because a platform with a
provenance registry has no excuse for repeating a lineage myth.

Not a divinatory system: nothing is computed from a birth moment. It is a typology arrived
at by self-identification, and it belongs beside the others as a different kind of object.
"""
from typing import Dict, List

TYPES = {
    1: ("The Reformer", "anger, held in as resentment",
        "the conviction that things must be corrected; that one must be good to have worth",
        "serenity — accepting reality as it is without needing to fix it"),
    2: ("The Helper", "pride, disguised as selflessness",
        "the belief that love must be earned by being needed",
        "humility — that one's own needs are as legitimate as anyone's"),
    3: ("The Achiever", "deceit, chiefly self-deceit",
        "the belief that worth is what one accomplishes and is seen to accomplish",
        "authenticity — value that does not depend on performance"),
    4: ("The Individualist", "envy",
        "the sense that something essential is missing that others were given",
        "equanimity — that nothing essential is actually absent"),
    5: ("The Investigator", "avarice, of energy and attention rather than goods",
        "the belief that resources are scarce and engagement will deplete one",
        "non-attachment — that participation replenishes rather than drains"),
    6: ("The Loyalist", "fear",
        "the search for something certain to rely on, and doubt of every candidate",
        "courage — acting without the guarantee ever arriving"),
    7: ("The Enthusiast", "gluttony, for experience",
        "the flight from limitation and from pain by keeping options open",
        "sobriety — that this, now, is enough"),
    8: ("The Challenger", "lust, meaning intensity",
        "the determination never to be controlled, and to protect by controlling",
        "innocence — strength that does not require armour"),
    9: ("The Peacemaker", "sloth, of self rather than of action",
        "the suppression of one's own position to keep the peace",
        "right action — showing up as oneself, including when it disturbs"),
}

CENTERS = {
    "body": ([8, 9, 1], "instinct and anger — the question is autonomy"),
    "heart": ([2, 3, 4], "feeling and shame — the question is identity"),
    "head": ([5, 6, 7], "thinking and fear — the question is security"),
}

# The figure's movement lines. Stress and growth run in opposite directions.
STRESS = {1: 4, 4: 2, 2: 8, 8: 5, 5: 7, 7: 1, 3: 9, 9: 6, 6: 3}
GROWTH = {v: k for k, v in STRESS.items()}

WINGS = {n: [((n - 2) % 9) + 1, (n % 9) + 1] for n in range(1, 10)}


def type_profile(n: int) -> Dict:
    n = int(n)
    if n not in TYPES:
        return {}
    name, passion, fixation, virtue = TYPES[n]
    center = next(c for c, (ns, _) in CENTERS.items() if n in ns)
    return {
        "type": n, "name": name,
        "passion": passion, "core_belief": fixation, "virtue": virtue,
        "center": center, "center_meaning": CENTERS[center][1],
        "wings": WINGS[n],
        "under_stress": {"moves_to": STRESS[n], "name": TYPES[STRESS[n]][0]},
        "in_growth": {"moves_to": GROWTH[n], "name": TYPES[GROWTH[n]][0]},
        "note": ("The movement lines are the figure's distinctive claim: a type does not "
                 "simply intensify under pressure, it takes on the unhealthy behaviour of "
                 "a different type entirely."),
    }


def all_types() -> List[Dict]:
    return [type_profile(n) for n in range(1, 10)]


def relationship(a: int, b: int) -> Dict:
    """How two types sit relative to each other on the figure."""
    a, b = int(a), int(b)
    if a not in TYPES or b not in TYPES:
        return {}
    rel = []
    if b in WINGS[a]:
        rel.append("adjacent — wing neighbours, sharing a border")
    if STRESS.get(a) == b:
        rel.append(f"{a} moves to {b} under stress")
    if GROWTH.get(a) == b:
        rel.append(f"{a} moves to {b} in growth")
    same_center = next((c for c, (ns, _) in CENTERS.items() if a in ns and b in ns), None)
    if same_center:
        rel.append(f"same centre ({same_center}) — the same underlying question")
    return {"a": a, "b": b, "connections": rel or ["no direct connection on the figure"],
            "a_name": TYPES[a][0], "b_name": TYPES[b][0]}


PROVENANCE_NOTE = (
    "The enneagram figure comes from G. I. Gurdjieff, taught from c. 1916 as a "
    "cosmological diagram with no personality typology attached. The nine-type typology is "
    "separate and later: Oscar Ichazo, Chile, c. 1970, brought to the United States by "
    "Claudio Naranjo. Claims of ancient Sufi, desert-father or Pythagorean origin are not "
    "supported by evidence."
)

assert len(TYPES) == 9
assert sorted(STRESS) == list(range(1, 10)) and sorted(GROWTH) == list(range(1, 10))
assert all(len(v) == 2 for v in WINGS.values())
