"""
LIBRARY — Layer 2 · CONCEPTS and POSITIONS.

A library of wisdom is browsed by QUESTION, not by book. Nobody arrives wanting "the
Enneads"; they arrive wanting to know whether anything survives death, and the Enneads is
one of the places that has been answered.

  Concept   a question the traditions have argued about — time, fate, self, cosmos, death
  Position  what one tradition holds about one concept, and which work says so

A Position is a CLAIM ATTRIBUTED TO A TRADITION, never a claim the platform makes. The
`claim` field states what the tradition holds. The platform's own voice appears only in
`tension` — where a position is internally strained or contested by its own scholars.

WHY POSITIONS CARRY A TRADITION AND NOT A PERSON
────────────────────────────────────────────────
Because independence is computed over traditions (see lineage.py), and because attributing
"the Buddhist view" to one monk misrepresents how these bodies of thought actually work.
Where an individual thinker genuinely departs from their tradition, that is worth its own
tradition node rather than a footnote — which is why Nietzsche and Spinoza have their own
entries while Aquinas sits inside scholasticism.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.services.provenance import sources as _sources
from app.services.library import lineage as _lin


@dataclass(frozen=True)
class Concept:
    id: str
    question: str            # the question in plain words — this is what a user searches
    name: str
    domain: str              # metaphysics | cosmology | ethics | epistemology | mind
    note: str = ""
    also_known_as: Tuple[str, ...] = ()


@dataclass(frozen=True)
class Position:
    concept: str
    tradition: str
    claim: str               # what the tradition holds, stated in its own terms
    sources: Tuple[str, ...] = ()      # bibliography ids
    key_terms: Tuple[str, ...] = ()    # the tradition's own vocabulary, untranslated
    tension: str = ""        # where the position is strained, contested, or unresolved
    stance: str = ""         # a short tag for grouping: cyclical | linear | illusory …


_CONCEPTS: Dict[str, Concept] = {}
_POSITIONS: List[Position] = []


def concept(id: str, question: str, name: str, domain: str, note: str = "",
            also_known_as: Tuple[str, ...] = ()) -> Concept:
    if id in _CONCEPTS:
        raise ValueError(f"duplicate concept {id!r}")
    c = Concept(id, question, name, domain, note, tuple(also_known_as))
    _CONCEPTS[id] = c
    return c


def position(concept: str, tradition: str, claim: str, sources: Tuple[str, ...] = (),
             key_terms: Tuple[str, ...] = (), tension: str = "", stance: str = "") -> Position:
    if concept not in _CONCEPTS:
        raise ValueError(f"position cites unknown concept {concept!r}")
    if not _lin.get(tradition):
        raise ValueError(f"position cites unknown tradition {tradition!r}")
    for s in sources:
        if not _sources.get(s):
            raise ValueError(f"position on {concept!r} cites unknown source {s!r}")
    p = Position(concept, tradition, claim, tuple(sources), tuple(key_terms), tension, stance)
    _POSITIONS.append(p)
    return p


# ═══════════════════════════════════════════════════════════════════════════
# THE QUESTIONS
# ═══════════════════════════════════════════════════════════════════════════

concept("time", "What is time — does it move in a line, a circle, or not at all?",
        "Time", "metaphysics",
        also_known_as=("kala", "chronos", "eternity", "cyclical time", "linear time"))

concept("fate", "Is what happens to me fixed, and if so is anything up to me?",
        "Fate and freedom", "metaphysics",
        note="The question every divinatory tradition must answer to justify itself — if "
             "everything is fixed, guidance is pointless; if nothing is, prediction is.",
        also_known_as=("destiny", "determinism", "free will", "karma", "moira", "qadar"))

concept("self", "Is there a self, and is it the same thing as what I call 'me'?",
        "The self", "mind",
        also_known_as=("atman", "anatta", "soul", "ego", "personal identity"))

concept("cosmos", "Where did all this come from, and does it have a structure?",
        "Origin and order of the cosmos", "cosmology",
        also_known_as=("creation", "cosmogony", "origin", "big bang", "emanation"))

concept("causation", "Why does one thing follow another?",
        "Causation", "metaphysics",
        also_known_as=("cause", "karma", "sympatheia", "correlation", "synchronicity"))

concept("death", "What, if anything, happens after death?",
        "Death and what follows", "metaphysics",
        also_known_as=("afterlife", "rebirth", "reincarnation", "moksha", "resurrection"))

concept("knowledge", "How can I know anything, and what can't I know?",
        "Knowledge and its limits", "epistemology",
        also_known_as=("epistemology", "pramana", "revelation", "gnosis", "reason"))

concept("good", "What makes a life good, and good for whom?",
        "The good life", "ethics",
        also_known_as=("ethics", "virtue", "dharma", "eudaimonia", "ren", "the good"))

concept("one_many", "Is reality ultimately one thing or many?",
        "The one and the many", "metaphysics",
        also_known_as=("monism", "dualism", "pluralism", "advaita", "non-duality"))

concept("meaning", "Does existence have a purpose, or do we supply one?",
        "Meaning and purpose", "metaphysics",
        also_known_as=("purpose", "telos", "nihilism", "absurd", "why are we here"))

concept("consciousness", "What is awareness, and why is there something it is like to be me?",
        "Consciousness", "mind",
        also_known_as=("mind", "awareness", "qualia", "hard problem", "citta"))

concept("change", "Is change real, or is permanence the illusion?",
        "Change and permanence", "metaphysics",
        also_known_as=("impermanence", "flux", "being", "becoming", "anicca"))


# ═══════════════════════════════════════════════════════════════════════════
# ACCESSORS
# ═══════════════════════════════════════════════════════════════════════════

def get_concept(cid: str) -> Optional[Concept]:
    return _CONCEPTS.get(cid)


def all_concepts() -> Dict[str, Concept]:
    return dict(_CONCEPTS)


def positions_for(concept_id: str) -> List[Position]:
    return [p for p in _POSITIONS if p.concept == concept_id]


def positions_by_tradition(tradition_id: str) -> List[Position]:
    return [p for p in _POSITIONS if p.tradition == tradition_id]


def all_positions() -> List[Position]:
    return list(_POSITIONS)


def resolve_concept(query: str) -> List[Concept]:
    """Find a concept by id, name, alias, or words in its question."""
    q = (query or "").strip().lower()
    if not q:
        return []
    if q in _CONCEPTS:
        return [_CONCEPTS[q]]
    exact, partial = [], []
    for c in _CONCEPTS.values():
        hay = [c.id.lower(), c.name.lower(), *(a.lower() for a in c.also_known_as)]
        if any(q == h for h in hay):
            exact.append(c)
        elif any(q in h for h in hay) or q in c.question.lower():
            partial.append(c)
    return exact or partial


def to_dict(p: Position) -> dict:
    t = _lin.get(p.tradition)
    return {
        "concept": p.concept, "tradition": p.tradition,
        "tradition_name": t.name if t else p.tradition,
        "region": t.region if t else "", "period": t.period if t else "",
        "claim": p.claim, "stance": p.stance,
        "key_terms": list(p.key_terms), "tension": p.tension,
        "sources": [_sources.to_dict(_sources.get(s)) for s in p.sources if _sources.get(s)],
    }


def concept_to_dict(c: Concept) -> dict:
    return {"id": c.id, "name": c.name, "question": c.question, "domain": c.domain,
            "note": c.note, "also_known_as": list(c.also_known_as),
            "position_count": len(positions_for(c.id))}


def catalog() -> List[dict]:
    return [concept_to_dict(c) for c in sorted(_CONCEPTS.values(), key=lambda x: x.id)]
