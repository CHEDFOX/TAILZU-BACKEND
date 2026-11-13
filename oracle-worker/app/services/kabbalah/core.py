"""
KABBALAH — the Tree of Life as a birth lens.

The Tree is fixed, canonical structure: TEN Sephirot (emanations), TWENTY-TWO Paths
(the Hebrew letters that join them), and FOUR Worlds the soul descends through. A birth
is placed on the Tree by its life-path number → a governing Sephirah (and its World);
the name's gematria → the Path (Hebrew letter) it walks. Nothing here is invented — the
Sephirot, the letter order, and the four Worlds are the standard Kabbalistic scheme; the
letter categories follow the Sefer Yetzirah (3 Mothers = elements, 7 Doubles = the seven
planets, 12 Simples = the zodiac).
"""

# (number, name, translit, title, attribute seed)
SEPHIROT = [
    (1, "כתר", "Kether",    "The Crown",       "pure being, the first spark, unity before division"),
    (2, "חכמה", "Chokmah",  "Wisdom",          "the flash of insight, dynamic force, the father"),
    (3, "בינה", "Binah",    "Understanding",   "form, depth, the great sea, the mother"),
    (4, "חסד", "Chesed",    "Mercy",           "loving-kindness, expansion, generosity, grace"),
    (5, "גבורה", "Geburah", "Severity",        "strength, judgement, the necessary no, discipline"),
    (6, "תפארת", "Tiphareth","Beauty",         "the heart, harmony, the balanced self, the sun within"),
    (7, "נצח", "Netzach",   "Victory",         "desire, feeling, endurance, the pull of love"),
    (8, "הוד", "Hod",       "Splendour",       "intellect, language, pattern, the shaping mind"),
    (9, "יסוד", "Yesod",    "Foundation",      "the unconscious, dreams, the tides beneath, imagination"),
    (10, "מלכות", "Malkuth","The Kingdom",     "the body, the earth, the here-and-now where all descends"),
]

# The soul descends the FOUR WORLDS from spirit into matter (and climbs back).
WORLDS = [
    ("Atziluth", "אצילות", "the World of Emanation — pure divine fire, the archetype"),
    ("Beriah",   "בריאה",  "the World of Creation — the great mind, the throne of understanding"),
    ("Yetzirah", "יצירה",  "the World of Formation — feeling and image, where forms take shape"),
    ("Assiah",   "עשייה",  "the World of Action — the physical, the made, the lived"),
]

# The 22 Paths — the Hebrew letters in order. category: mother (element) / double
# (planet) / simple (zodiac), per Sefer Yetzirah.
LETTERS = [
    ("א", "Aleph",  "ox / breath",        "mother", "Air"),
    ("ב", "Bet",    "house",              "double", "planet"),
    ("ג", "Gimel",  "camel",              "double", "planet"),
    ("ד", "Dalet",  "door",               "double", "planet"),
    ("ה", "Heh",    "window",             "simple", "zodiac"),
    ("ו", "Vav",    "nail / hook",        "simple", "zodiac"),
    ("ז", "Zayin",  "sword",              "simple", "zodiac"),
    ("ח", "Chet",   "fence",              "simple", "zodiac"),
    ("ט", "Tet",    "serpent",            "simple", "zodiac"),
    ("י", "Yod",    "hand / seed",        "simple", "zodiac"),
    ("כ", "Kaph",   "palm",               "double", "planet"),
    ("ל", "Lamed",  "ox-goad / to learn", "simple", "zodiac"),
    ("מ", "Mem",    "water",              "mother", "Water"),
    ("נ", "Nun",    "fish",               "simple", "zodiac"),
    ("ס", "Samekh", "prop / support",     "simple", "zodiac"),
    ("ע", "Ayin",   "eye",                "simple", "zodiac"),
    ("פ", "Peh",    "mouth",              "double", "planet"),
    ("צ", "Tzaddi", "fish-hook",          "simple", "zodiac"),
    ("ק", "Qoph",   "back of the head",   "simple", "zodiac"),
    ("ר", "Resh",   "head",               "double", "planet"),
    ("ש", "Shin",   "tooth / fire",       "mother", "Fire"),
    ("ת", "Tav",    "cross / mark",       "double", "planet"),
]

# Which World each Sephirah belongs to (the classic four-world division of the Tree).
_SEPH_WORLD = {1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3}


def _reduce(n, keep_masters=True):
    while n > 9:
        if keep_masters and n in (11, 22, 33):
            return n
        n = sum(int(d) for d in str(n))
    return n


def _gematria_value(name):
    from app.services.numerology.hebrew import gematria
    try:
        g = gematria(name or "")
        return g.value or 0
    except Exception:
        return 0


class TreeReading:
    def __init__(self, sephirah, world, letter, life_path, path_index):
        self.sephirah = sephirah      # (number, hebrew, translit, title, seed)
        self.world = world            # (name, hebrew, seed)
        self.letter = letter          # (hebrew, translit, meaning, category, corr)
        self.life_path = life_path
        self.path_index = path_index


def tree_of_life(year, month, day, name=""):
    """Place a birth on the Tree: life-path → governing Sephirah (+ its World); the name's
    gematria (or the date, if no name) → the Path letter it walks."""
    total = sum(int(c) for c in f"{int(year)}{int(month):02d}{int(day):02d}")
    lp = _reduce(total)                                   # 1-9 or master 11/22/33
    single = lp if lp <= 9 else _reduce(lp, keep_masters=False)
    sephirah = SEPHIROT[single - 1]                      # 1-9 → Kether…Yesod
    world = WORLDS[_SEPH_WORLD[sephirah[0]]]
    seed = _gematria_value(name) if name else (int(year) + int(month) + int(day))
    path_index = seed % 22
    letter = LETTERS[path_index]
    return TreeReading(sephirah, world, letter, lp, path_index)


if __name__ == "__main__":
    r = tree_of_life(1990, 5, 15, "David")
    print("life path:", r.life_path)
    print("Sephirah:", r.sephirah[2], "-", r.sephirah[3], "| World:", r.world[0])
    print("Path letter:", r.letter[1], f"({r.letter[0]})", "-", r.letter[2], f"[{r.letter[3]}]")
    # sanity: every sephirah maps to a world, all 22 letters present
    assert len(SEPHIROT) == 10 and len(LETTERS) == 22 and len(WORLDS) == 4
    assert all(s[0] in _SEPH_WORLD for s in SEPHIROT)
    print("structure OK")
