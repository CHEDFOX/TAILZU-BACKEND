"""
THE NUMBER SYSTEMS THAT HAD ENGINES BUT NO DOOR.

Both of these were built, tested and wired to a feature endpoint — and neither was
in the registry, so the router could not reach them. They were answerable only by
tapping the exact tile in the app; asked in words, the question went somewhere else.

  LO SHU     A birth signature like any other. It takes the date and returns which
             of the nine cells are full, empty or doubled. Nothing about it needed
             inventing — it simply had no entry.

  ANGEL      Not a birth signature at all, and that is why it sat unregistered.
             The reading needs a NUMBER the person saw, which no birth date supplies
             and no adapter here can compute. So its deep profile carries the corpus
             instead: the meanings, and the rule for classifying a number that is not
             in it. The Oracle reads the number out of the question — it has the
             message, this module never does — and the corpus lets it answer from the
             tradition rather than from whatever it half-remembers about 1111.

             Registered as `moment` so it is demoted out of natal councils. Angel
             numbers should fire when someone asks about a number in front of them
             and at no other time; a lucky-number reading nobody requested is noise.
"""
from typing import Dict, List

# Read by pipeline._demotable_ids — keeps this out of unasked natal councils.
MOMENT_IDS = {"angel"}


def _loshu(b, name):
    from app.services.numerology.loshu import lo_shu_grid
    g = lo_shu_grid(int(b["day"]), int(b["month"]), int(b["year"]))
    miss = ", ".join(str(m) for m in g.missing) or "none"
    return f"Lo Shu driver {g.driver}, life path {g.life_path} — missing {miss}"


def _deep_loshu(b, name) -> List[str]:
    from app.services.numerology.loshu import lo_shu_grid
    g = lo_shu_grid(int(b["day"]), int(b["month"]), int(b["year"]))
    L = [f"Lo Shu grid from {g.digits} — driver {g.driver}, life path {g.life_path}."]
    rows = [" | ".join(c or "·" for c in row) for row in g.grid]
    L.append("Grid (top row 4-9-2, middle 3-5-7, bottom 8-1-6): " + "  /  ".join(rows))
    if g.repeated:
        L.append(f"Doubled — {', '.join(str(r) for r in g.repeated)}: strengthened to the point of excess.")
    if g.missing:
        L.append(f"Empty cells — {', '.join(str(m) for m in g.missing)}: what this life has to build rather than inherit.")
    for line in g.strength_lines:
        L.append(f"Full line — {line}: a completed arrow, and the grid's plainest strength.")
    for line in g.absent_lines:
        L.append(f"Empty line — {line}: the whole plane absent, which the tradition reads as the life's assignment.")
    L.append("Read: presence is inheritance, absence is the work. A full line is not luck; "
             "an empty one is not a verdict.")
    return L


def _angel(b, name):
    """No number to read yet — this is the person's own root, which is the only
    angel-number fact a birth date can honestly supply."""
    from app.services.numerology.angel import DIGIT_MEANING
    from app.services.numerology.loshu import digital_root
    r = digital_root(int(f"{int(b['day']):02d}{int(b['month']):02d}{int(b['year'])}"))
    return f"root {r} — {DIGIT_MEANING.get(r, '')}"


def _deep_angel(b, name) -> List[str]:
    from app.services.numerology.angel import ANGEL, DIGIT_MEANING
    from app.services.numerology.loshu import digital_root
    r = digital_root(int(f"{int(b['day']):02d}{int(b['month']):02d}{int(b['year'])}"))
    L = [f"Their own root is {r} — {DIGIT_MEANING.get(r, '')}. Every number they ask about "
         f"is read against this.",
         "THE CORPUS — exact meanings, to be used verbatim rather than improvised:"]
    L += [f"  {k} — {v}" for k, v in ANGEL.items()]
    L.append("A number NOT in the corpus is classified and then reduced: repeating (444), "
             "sequence (1234), mirror (1221) or mixed — then its digits are summed to a "
             "single root and read from these:")
    L += [f"  {d} — {m}" for d, m in DIGIT_MEANING.items()]
    L.append("Read: if they named a number, answer on THAT number. If they did not, this "
             "system has nothing to add and should stay silent.")
    return L


NUMBER_SIGNS: Dict[str, Dict] = {
    "loshu": {
        "label": "Lo Shu grid",
        "aliases": ["lo shu", "loshu", "lo shu grid", "magic square", "nine grid",
                    "numerology grid", "birth grid", "洛書"],
        "facets": "grid_cells, missing_numbers, repeated_numbers, planes",
        "one": _loshu, "deep": _deep_loshu,
    },
    "angel": {
        "label": "Angel numbers",
        "aliases": ["angel number", "angel numbers", "repeating numbers", "1111",
                    "111", "222", "333", "444", "555", "777", "888", "999",
                    "seeing numbers", "same number everywhere"],
        "facets": "number_meaning, pattern_kind, root_reduction",
        "one": _angel, "deep": _deep_angel,
    },
}


def register() -> Dict:
    """Add these to the wider-council bus. Idempotent."""
    from app.services.oracle import signatures as S

    added = []
    for sid, spec in NUMBER_SIGNS.items():
        if sid in S.SIGNS:
            continue
        S.SIGNS[sid] = spec
        added.append(sid)

    S.SIGNATURE_IDS = set(S.SIGNS)
    S.MINOR_SYSTEMS = {k: {"label": v["label"], "aliases": v["aliases"],
                           "sections": v["facets"]}
                       for k, v in S.SIGNS.items()}
    return {"added": added, "total": len(S.SIGNS)}
