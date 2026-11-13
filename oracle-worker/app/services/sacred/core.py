"""
SACRED GEOMETRY — pattern interpretation as a birth lens (not divination).

The five Platonic solids are the five elements; the great patterns (the Golden Ratio,
the Flower of Life, Sri Yantra, the Vesica Piscis) are the templates the cosmos repeats
at every scale. A birth is given its ruling SOLID (by its life-path) and the PATTERN it
lives inside — the shape of order it carries.
"""

# (name, element, faces, seed) — the five Platonic solids ↔ the five elements.
SOLIDS = [
    ("Tetrahedron",  "Fire",   4,  "the spark and the will — 4 triangular faces, the simplest flame of form"),
    ("Cube (Hexahedron)", "Earth", 6, "the ground and the body — 6 square faces, stability made visible"),
    ("Octahedron",   "Air",    8,  "the breath and the mind — 8 faces balanced on their points, thought in motion"),
    ("Icosahedron",  "Water",  20, "the flow and the feeling — 20 faces, the most fluid of the solids"),
    ("Dodecahedron", "Aether", 12, "the cosmos and the soul — 12 pentagons, the shape Plato gave the heavens"),
]

# (name, seed) — the universal patterns.
PATTERNS = [
    ("The Golden Ratio (φ)", "1.618… — the proportion of growth itself, in the shell, the galaxy and the face; "
                             "beauty as a ratio the universe keeps returning to"),
    ("The Flower of Life",   "the overlapping circles from which every form unfolds — the seed of all geometry"),
    ("Sri Yantra",           "nine interlocking triangles around the still centre — the map of creation "
                             "descending from the point into the world"),
    ("The Vesica Piscis",    "the almond where two circles overlap — the womb of form, where one becomes two "
                             "and the third is born"),
    ("Metatron's Cube",      "the figure holding all five Platonic solids at once — the blueprint behind the "
                             "blueprints"),
]


def _reduce(n):
    while n > 9:
        n = sum(int(d) for d in str(n))
    return n


def sacred_geometry(year, month, day):
    total = sum(int(c) for c in f"{int(year)}{int(month):02d}{int(day):02d}")
    lp = _reduce(total)
    solid = SOLIDS[(lp - 1) % 5]
    pattern = PATTERNS[(int(day) - 1) % len(PATTERNS)]
    return {"life_path": lp, "solid": solid, "pattern": pattern}


if __name__ == "__main__":
    for d in (15, 7, 3, 20, 28):
        r = sacred_geometry(1990, 5, d)
        print(f"LP{r['life_path']} → {r['solid'][0]} ({r['solid'][1]}) · {r['pattern'][0]}")
    assert len(SOLIDS) == 5 and len(PATTERNS) == 5
    print("structure OK")
