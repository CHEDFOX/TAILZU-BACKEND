"""
LIBRARY — Layer 1 · TRANSMISSION (independence, for ideas).

The consensus engine established that agreement is only evidence when the agreeing parties
could have disagreed. The same discipline applies — harder — to philosophy.

When Plotinus, Ficino, Agrippa and a modern occultist all say the cosmos is a living
hierarchy of emanations, that is not four civilisations independently discovering the same
truth. It is one Greek idea, transmitted four times. Presenting it as convergence is the
central rhetorical trick of popular "perennial wisdom" writing, and it is why that genre
cannot be taken seriously.

Genuine convergence does exist and it is far more interesting: the Chinese and Greek
traditions arrived at cyclical cosmology with no contact worth speaking of. THAT is worth
a user's attention, and it can only be identified by a system that knows the difference.

WHAT AN EDGE MEANS
──────────────────
  descends_from   direct inheritance — the later tradition read the earlier one
  transmitted_via a text passed through an intermediary culture (Aristotle reaching Latin
                  Europe through Arabic is the paradigm case)
  contact         documented exchange without inheritance
  disputed        a claimed transmission that scholarship has NOT settled

`disputed` edges are recorded but excluded from independence collapsing by default — we do
not silently treat a contested historical claim as established, in either direction.
"""
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Set, Tuple

DESCENDS = "descends_from"
VIA = "transmitted_via"
CONTACT = "contact"
DISPUTED = "disputed"

_EDGE_KINDS = {DESCENDS, VIA, CONTACT, DISPUTED}
# Edges that make two traditions NON-independent. Contact alone does not — two traditions
# that traded goods and occasional texts can still reach a conclusion separately.
_COLLAPSING = {DESCENDS, VIA}


@dataclass(frozen=True)
class Tradition:
    id: str
    name: str
    region: str
    period: str
    note: str = ""


@dataclass(frozen=True)
class Edge:
    child: str
    parent: str
    kind: str
    note: str = ""


_TRADITIONS: Dict[str, Tradition] = {}
_EDGES: List[Edge] = []


def tradition(id: str, name: str, region: str, period: str, note: str = "") -> Tradition:
    if id in _TRADITIONS:
        raise ValueError(f"duplicate tradition {id!r}")
    t = Tradition(id, name, region, period, note)
    _TRADITIONS[id] = t
    return t


def edge(child: str, parent: str, kind: str = DESCENDS, note: str = "") -> Edge:
    if kind not in _EDGE_KINDS:
        raise ValueError(f"bad edge kind {kind!r}")
    e = Edge(child, parent, kind, note)
    _EDGES.append(e)
    return e


# ═══════════════════════════════════════════════════════════════════════════
# TRADITIONS
# ═══════════════════════════════════════════════════════════════════════════

tradition("presocratic", "Presocratic Greek", "Mediterranean", "c. 6th–5th c. BCE",
          "Heraclitus, Parmenides, Pythagoras, Empedocles, the atomists.")
tradition("platonic", "Platonism", "Mediterranean", "c. 4th c. BCE onward")
tradition("aristotelian", "Aristotelianism", "Mediterranean", "c. 4th c. BCE onward")
tradition("stoic", "Stoicism", "Mediterranean", "c. 3rd c. BCE–3rd c. CE")
tradition("epicurean", "Epicureanism", "Mediterranean", "c. 4th c. BCE–2nd c. CE")
tradition("neoplatonic", "Neoplatonism", "Mediterranean", "3rd–6th c. CE",
          "Plotinus, Porphyry, Proclus. The channel through which Platonism reached the "
          "esoteric traditions.")
tradition("hermetic", "Hermeticism", "Greco-Egyptian", "1st–3rd c. CE",
          "Greek philosophy in Egyptian dress — the 'ancient Egyptian wisdom' framing is "
          "a later and largely inaccurate claim about its own origins.")

tradition("vedic", "Vedic / Upanishadic", "South Asia", "c. 1500–500 BCE")
tradition("samkhya", "Samkhya", "South Asia", "c. 4th c. BCE onward")
tradition("advaita", "Advaita Vedanta", "South Asia", "c. 8th c. CE (Shankara)")
tradition("buddhist_early", "Early Buddhism / Abhidharma", "South Asia", "c. 5th c. BCE onward")
tradition("madhyamaka", "Madhyamaka", "South Asia", "c. 2nd c. CE (Nagarjuna)")
tradition("yogacara", "Yogacara", "South Asia", "c. 4th c. CE")
tradition("jain", "Jainism", "South Asia", "c. 6th c. BCE onward")
tradition("nyaya", "Nyaya-Vaisheshika", "South Asia", "c. 2nd c. BCE onward")

tradition("daoist", "Daoism", "East Asia", "c. 4th c. BCE onward")
tradition("confucian", "Confucianism", "East Asia", "c. 5th c. BCE onward")
tradition("yijing", "Yijing cosmology", "East Asia", "c. 9th c. BCE onward")
tradition("wuxing", "Five Phases (wuxing)", "East Asia", "c. 4th c. BCE onward")
tradition("neoconfucian", "Neo-Confucianism", "East Asia", "11th–12th c. CE",
          "Zhu Xi's synthesis — explicitly absorbs Daoist and Buddhist metaphysics.")
tradition("chan", "Chan / Zen", "East Asia", "6th c. CE onward")

tradition("hebrew", "Hebrew scriptural", "Near East", "c. 10th c. BCE onward")
tradition("kabbalah", "Kabbalah", "Near East / Europe", "12th–16th c. CE")
tradition("christian_patristic", "Patristic Christianity", "Mediterranean", "2nd–8th c. CE")
tradition("scholastic", "Scholasticism", "Europe", "11th–14th c. CE")
tradition("islamic_falsafa", "Islamic falsafa", "Near East / Iberia", "9th–12th c. CE",
          "Al-Kindi, Ibn Sina, Ibn Rushd. The custodians of Aristotle during the European "
          "gap, and original philosophers in their own right — not merely transmitters.")
tradition("sufi", "Sufism", "Near East", "8th c. CE onward")
tradition("zoroastrian", "Zoroastrianism", "Persia", "c. 12th–6th c. BCE")

tradition("maya", "Maya cosmology", "Mesoamerica", "c. 250–900 CE and later")
tradition("aztec", "Mexica / Aztec cosmology", "Mesoamerica", "14th–16th c. CE")
tradition("yoruba", "Yoruba / Ifá cosmology", "West Africa", "traditional, attested from "
          "the precolonial period")
tradition("egyptian", "Ancient Egyptian", "North Africa", "c. 3000–30 BCE")
tradition("norse", "Norse / Germanic", "Northern Europe", "attested c. 9th–13th c. CE")
tradition("indigenous_australian", "Aboriginal Australian", "Australia",
          "continuous, tens of millennia",
          "The Dreaming is not a cosmogony of the distant past but an ongoing order — "
          "framing it as 'creation myth' misdescribes it.")

tradition("cartesian", "Cartesian rationalism", "Europe", "17th c.")
tradition("spinozist", "Spinozism", "Europe", "17th c.")
tradition("leibnizian", "Leibnizian metaphysics", "Europe", "17th–18th c.")
tradition("kantian", "Kantian critical philosophy", "Europe", "18th c.")
tradition("hegelian", "German idealism", "Europe", "19th c.")
tradition("nietzschean", "Nietzsche", "Europe", "19th c.")
tradition("process", "Process philosophy", "Anglo-American", "20th c.",
          "Whitehead, Hartshorne.")
tradition("phenomenology", "Phenomenology / existential", "Europe", "20th c.")
tradition("analytic", "Analytic metaphysics", "Anglo-American", "20th c. onward")

tradition("modern_cosmology", "Modern physical cosmology", "global", "20th c. onward",
          "Included because it answers the same questions — origin, time, order, the "
          "place of observers — with a different method. It is in this library as a "
          "position among positions on those questions, not as an adjudicator of the "
          "others and not as a validation of them.")


# ═══════════════════════════════════════════════════════════════════════════
# TRANSMISSION EDGES
# ═══════════════════════════════════════════════════════════════════════════

edge("platonic", "presocratic", DESCENDS, "Pythagorean number-metaphysics and Parmenides.")
edge("aristotelian", "platonic", DESCENDS, "Aristotle studied under Plato and rejects much of him.")
edge("stoic", "presocratic", DESCENDS, "Heraclitean logos.")
edge("epicurean", "presocratic", DESCENDS, "Atomism from Democritus.")
edge("neoplatonic", "platonic", DESCENDS)
edge("hermetic", "platonic", DESCENDS)
edge("hermetic", "stoic", DESCENDS)
edge("hermetic", "egyptian", CONTACT,
     "Egyptian setting and imagery; the philosophical content is substantially Greek.")

edge("samkhya", "vedic", DESCENDS)
edge("advaita", "vedic", DESCENDS, "Upanishadic non-dualism made systematic.")
edge("advaita", "madhyamaka", DISPUTED,
     "Shankara was accused by opponents of being a crypto-Buddhist; the extent of actual "
     "Madhyamaka influence is contested and not settled.")
edge("buddhist_early", "vedic", CONTACT,
     "Shares the shramana milieu and vocabulary (karma, samsara) while rejecting Vedic "
     "authority and the atman.")
edge("madhyamaka", "buddhist_early", DESCENDS)
edge("yogacara", "buddhist_early", DESCENDS)
edge("jain", "vedic", CONTACT)

edge("neoconfucian", "confucian", DESCENDS)
edge("neoconfucian", "daoist", DESCENDS, "li/qi metaphysics is substantially Daoist.")
edge("neoconfucian", "buddhist_early", DESCENDS, "Absorbs Chan metaphysics while "
     "polemicising against Buddhism.")
edge("chan", "madhyamaka", DESCENDS)
edge("chan", "daoist", DESCENDS)
edge("wuxing", "yijing", CONTACT)
edge("daoist", "yijing", CONTACT)

edge("kabbalah", "hebrew", DESCENDS)
edge("kabbalah", "neoplatonic", DESCENDS,
     "The sefirotic emanation scheme is structurally Neoplatonic — this is the clearest "
     "case in the whole graph of an apparent independent parallel that is not one.")
edge("christian_patristic", "hebrew", DESCENDS)
edge("christian_patristic", "neoplatonic", DESCENDS, "Augustine, Pseudo-Dionysius.")
edge("islamic_falsafa", "aristotelian", VIA,
     "Via Syriac Christian translators into Arabic.")
edge("islamic_falsafa", "neoplatonic", VIA,
     "The so-called Theology of Aristotle was in fact Plotinus, an attribution error with "
     "centuries of consequences.")
edge("scholastic", "aristotelian", VIA,
     "Aristotle returned to Latin Europe through Arabic translation and Ibn Rushd's "
     "commentaries — Aquinas read him through Islamic eyes.")
edge("scholastic", "islamic_falsafa", DESCENDS)
edge("scholastic", "christian_patristic", DESCENDS)
edge("sufi", "neoplatonic", DESCENDS, "Especially Ibn Arabi's emanationism.")

edge("cartesian", "scholastic", DESCENDS)
edge("spinozist", "cartesian", DESCENDS)
edge("spinozist", "kabbalah", DISPUTED, "Long-claimed, never established.")
edge("leibnizian", "scholastic", DESCENDS)
edge("leibnizian", "yijing", CONTACT,
     "Leibniz corresponded about the Yijing hexagrams and saw binary arithmetic in them — "
     "genuine contact, but his metaphysics was already formed.")
edge("kantian", "leibnizian", DESCENDS)
edge("hegelian", "kantian", DESCENDS)
edge("nietzschean", "presocratic", DESCENDS)
edge("process", "hegelian", DESCENDS)
edge("phenomenology", "kantian", DESCENDS)
edge("analytic", "aristotelian", DESCENDS)
edge("modern_cosmology", "analytic", CONTACT)

edge("aztec", "maya", CONTACT, "Shared Mesoamerican calendrical and cosmological substrate.")


# ═══════════════════════════════════════════════════════════════════════════
# QUERIES
# ═══════════════════════════════════════════════════════════════════════════

def get(tid: str) -> Optional[Tradition]:
    return _TRADITIONS.get(tid)


def all_traditions() -> Dict[str, Tradition]:
    return dict(_TRADITIONS)


def parents(tid: str, collapsing_only: bool = True) -> List[Edge]:
    kinds = _COLLAPSING if collapsing_only else _EDGE_KINDS
    return [e for e in _EDGES if e.child == tid and e.kind in kinds]


def ancestry(tid: str, collapsing_only: bool = True, _seen: Optional[Set[str]] = None) -> Set[str]:
    """Everything this tradition inherited from, transitively."""
    seen = _seen if _seen is not None else set()
    if tid in seen:
        return set()
    seen.add(tid)
    out: Set[str] = set()
    for e in parents(tid, collapsing_only):
        out.add(e.parent)
        out |= ancestry(e.parent, collapsing_only, seen)
    return out


def shares_lineage(a: str, b: str) -> Tuple[bool, List[str]]:
    """Are two traditions genuinely independent witnesses?

    Returns (dependent, what_they_share). Dependence means one descends from the other, or
    both descend from a common ancestor."""
    if a == b:
        return True, [a]
    aa, ab = ancestry(a), ancestry(b)
    if b in aa:
        return True, [b]
    if a in ab:
        return True, [a]
    common = aa & ab
    return (bool(common), sorted(common))


def independent_groups(tids: Iterable[str]) -> List[Set[str]]:
    """Partition traditions into genuinely independent lines. Union-find, same shape as
    the consensus engine's method clustering — one discipline, applied twice."""
    ids = [t for t in dict.fromkeys(tids) if t in _TRADITIONS]
    parent: Dict[str, str] = {t: t for t in ids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            dep, _ = shares_lineage(a, b)
            if dep:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[rb] = ra

    groups: Dict[str, Set[str]] = {}
    for t in ids:
        groups.setdefault(find(t), set()).add(t)
    return sorted(groups.values(), key=lambda s: (-len(s), sorted(s)[0]))


def convergence_report(tids: Iterable[str]) -> Dict:
    """The question this whole module exists to answer: when several traditions agree, how
    many of them actually arrived there separately?"""
    ids = [t for t in dict.fromkeys(tids) if t in _TRADITIONS]
    groups = independent_groups(ids)
    detail = []
    for g in groups:
        g_sorted = sorted(g)
        shared: Set[str] = set()
        for i, a in enumerate(g_sorted):
            for b in g_sorted[i + 1:]:
                dep, sh = shares_lineage(a, b)
                if dep:
                    shared |= set(sh)
        detail.append({
            "traditions": g_sorted,
            "names": [_TRADITIONS[t].name for t in g_sorted],
            "regions": sorted({_TRADITIONS[t].region for t in g_sorted}),
            "common_ancestry": sorted(shared - set(g_sorted)) or None,
        })
    return {
        "traditions_cited": len(ids),
        "independent_lines": len(groups),
        "collapsed": len(ids) - len(groups),
        "lines": detail,
        "genuinely_cross_cultural": len({r for g in groups
                                         for r in {_TRADITIONS[t].region for t in g}}) > 1,
    }


def catalog() -> List[dict]:
    return [
        {"id": t.id, "name": t.name, "region": t.region, "period": t.period, "note": t.note,
         "descends_from": [e.parent for e in parents(t.id)],
         "contact_with": [e.parent for e in _EDGES if e.child == t.id and e.kind == CONTACT],
         "disputed_links": [e.parent for e in _EDGES if e.child == t.id and e.kind == DISPUTED]}
        for t in sorted(_TRADITIONS.values(), key=lambda x: (x.region, x.period, x.id))
    ]
