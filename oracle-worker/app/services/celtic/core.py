"""
CELTIC TREE ASTROLOGY — the 13-sign Ogham tree calendar.

The widely-published Celtic (Druid) tree zodiac: thirteen ~28-day lunar-month signs,
each a sacred tree of the Ogham, keyed to the birth date. Fixed, deterministic date
ranges (Graves' Ogham-calendar lineage). Birch wraps the winter solstice.

Verifiable by construction: the ranges are exact and contiguous across the year.
"""
from dataclasses import dataclass

# (tree, ogham-name, (start_month, start_day), (end_month, end_day), keyword seed)
# Birch is the wrap sign (Dec 24 – Jan 20).
TREES = [
    ("Birch",    "Beith",  (12, 24), (1, 20),  "the pioneer — fresh starts, drive, renewal"),
    ("Rowan",    "Luis",   (1, 21),  (2, 17),  "the thinker — vision, idealism, quiet influence"),
    ("Ash",      "Nion",   (2, 18),  (3, 17),  "the enchanter — imagination, connection, the sea"),
    ("Alder",    "Fearn",  (3, 18),  (4, 14),  "the trailblazer — confidence, action, the pathmaker"),
    ("Willow",   "Sail",   (4, 15),  (5, 12),  "the observer — intuition, memory, the moon"),
    ("Hawthorn", "Uath",   (5, 13),  (6, 9),   "the illusionist — wit, contradiction, hidden depth"),
    ("Oak",      "Dair",   (6, 10),  (7, 7),   "the stabiliser — strength, protection, endurance"),
    ("Holly",    "Tinne",  (7, 8),   (8, 4),   "the ruler — nobility, courage, natural authority"),
    ("Hazel",    "Coll",   (8, 5),   (9, 1),   "the knower — intelligence, knowledge, the well"),
    ("Vine",     "Muin",   (9, 2),   (9, 29),  "the equaliser — balance, refinement, the two sides"),
    ("Ivy",      "Gort",   (9, 30),  (10, 27), "the survivor — resilience, loyalty, the spiral"),
    ("Reed",     "nGéadal", (10, 28), (11, 24), "the inquisitor — truth-seeking, secrets, purpose"),
    ("Elder",    "Ruis",   (11, 25), (12, 23), "the seeker — freedom, honesty, the wanderer"),
]


@dataclass
class CelticTree:
    tree: str
    ogham: str
    seed: str
    range_str: str


def _md_key(m: int, d: int) -> int:
    return m * 100 + d


def celtic_tree(month: int, day: int) -> CelticTree:
    k = _md_key(int(month), int(day))
    for tree, ogham, (sm, sd), (em, ed), seed in TREES:
        start, end = _md_key(sm, sd), _md_key(em, ed)
        hit = (start <= k <= end) if start <= end else (k >= start or k <= end)   # Birch wraps
        if hit:
            return CelticTree(tree=tree, ogham=ogham, seed=seed,
                              range_str=f"{sm:02d}-{sd:02d} → {em:02d}-{ed:02d}")
    # Contiguous ranges cover the whole year; this is unreachable, but stay safe.
    return CelticTree(tree="Birch", ogham="Beith", seed=TREES[0][4], range_str="")
