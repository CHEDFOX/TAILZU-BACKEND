"""
NATIVE AMERICAN BIRTH TOTEM — the animal spirit of a birth date.

The widely-published birth-totem wheel (twelve moons of the medicine wheel). Each
totem owns a contiguous date range across the year; the table is self-verifying —
every day of the year maps to exactly one totem, no gaps, no overlaps.
"""

# (totem, clan/element, direction, (start_month, start_day), (end_month, end_day), seed)
# Ranges are inclusive and wrap the year (Goose spans the Dec→Jan boundary).
TOTEMS = [
    ("Otter", "Butterfly · Air", "North", (1, 20), (2, 18),
     "unconventional, inventive, quietly humanitarian — you see what others miss"),
    ("Wolf", "Frog · Water", "North", (2, 19), (3, 20),
     "deeply feeling, gentle, philosophical — loyal to the ones you love"),
    ("Falcon", "Thunderbird · Fire", "East", (3, 21), (4, 19),
     "a natural leader, quick to act, decisive — you begin what others finish"),
    ("Beaver", "Turtle · Earth", "East", (4, 20), (5, 20),
     "steady, industrious, self-reliant — you build things that last"),
    ("Deer", "Butterfly · Air", "East", (5, 21), (6, 20),
     "bright, quick-witted, playful — the spark that lifts a room"),
    ("Woodpecker", "Frog · Water", "South", (6, 21), (7, 21),
     "nurturing, devoted, protective — the keeper of home and heart"),
    ("Salmon", "Thunderbird · Fire", "South", (7, 22), (8, 21),
     "confident, generous, magnetic — you move with purpose and warmth"),
    ("Bear", "Turtle · Earth", "South", (8, 22), (9, 21),
     "practical, grounded, discerning — the one others lean on"),
    ("Raven", "Butterfly · Air", "West", (9, 22), (10, 22),
     "charming, diplomatic, adaptable — you find the balance in everything"),
    ("Snake", "Frog · Water", "West", (10, 23), (11, 22),
     "intense, transformative, intuitive — you sense the current beneath the surface"),
    ("Owl", "Thunderbird · Fire", "West", (11, 23), (12, 21),
     "seeking, adventurous, warm — a wanderer with an open heart"),
    ("Goose", "Turtle · Earth", "North", (12, 22), (1, 19),
     "ambitious, persevering, dependable — you climb steadily toward your vision"),
]


class Totem:
    def __init__(self, name, clan, direction, seed):
        self.name = name
        self.clan = clan
        self.direction = direction
        self.seed = seed


def _in_range(month, day, start, end):
    (sm, sd), (em, ed) = start, end
    md = (month, day)
    if (sm, sd) <= (em, ed):            # normal, within one year
        return (sm, sd) <= md <= (em, ed)
    return md >= (sm, sd) or md <= (em, ed)   # wraps the year end (Goose)


def native_totem(month, day):
    for name, clan, direction, start, end, seed in TOTEMS:
        if _in_range(int(month), int(day), start, end):
            return Totem(name, clan, direction, seed)
    return Totem(*TOTEMS[0][:1], *TOTEMS[0][1:3], TOTEMS[0][5])  # unreachable; safety


# ── self-verification: every day of a (leap) year maps to exactly one totem ──
def _verify():
    from calendar import monthrange
    seen = 0
    for m in range(1, 13):
        for d in range(1, monthrange(2024, m)[1] + 1):
            hits = [t[0] for t in TOTEMS if _in_range(m, d, t[3], t[4])]
            assert len(hits) == 1, f"{m}/{d} -> {hits}"
            seen += 1
    return seen


if __name__ == "__main__":
    print("days covered:", _verify())
    for m, d in [(1, 25), (3, 25), (7, 4), (10, 31), (12, 25), (1, 1)]:
        t = native_totem(m, d)
        print(f"{m:2d}/{d:02d}: {t.name} ({t.clan}, {t.direction})")
