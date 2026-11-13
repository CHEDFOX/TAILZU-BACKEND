"""
LIBRARY SHELVES — where each of the world traditions sits, and what it needs from you.

Two facts per system, and nothing else. Everything the Library screen does is derived
from this table plus the engines that already exist.

SHELF — which rail it appears on. Grouped by where the tradition comes from, because
that is how people already hold them ("Chinese astrology", "Vedic astrology"): it needs
no explaining, and a system added next year just gets dropped on a rail.

    The honest limit of that: regional shelving flattens real history. Firdaria is
    Persian by way of Hellenistic Greece. Tibetan astrology is half Chinese and half
    Indian by its own account. A single shelf per book will occasionally lie — accepted,
    because browsing wants one home per book, and the book's first beat is a better
    place to tell the true story anyway.

    Three shelves are not places. `body` collects palm, face, mole and breath reading,
    which arose in China, India and Europe independently and belong to no one country.
    `sky` and `letters` split Europe, which is otherwise a 28-book bin holding three
    unrelated things — and putting runes beside Kabbalah implies a kinship that does
    not exist.

KIND — what the tradition needs from a person. Not shown on the cover (a cover carrying
a category word reads as a database row), but it decides two things:

    * what the third beat of the book can be — a reading, a throw, or a lesson;
    * the order within a rail. Of these 95, more than a third cannot compute anything
      from a birth date alone. Shuffled in, a reader opens three "we would need a
      throw" books in a row and concludes the app is thin. So rails lead with `birth`.

    birth    reads the chart already on file. Instant, free, no LLM.
    cast     needs a throw; the book performs one.
    moment   reads the instant of asking, not the birth.
    body     read from a hand, a face, a mark. No camera — the book teaches you to
             read your own, which is the honest thing an app without one can offer.
    practice something held and done by a practitioner; the book gives the method.
"""
from typing import Dict, List, Tuple

# shelf id → (rail title, sort position)
SHELVES: Dict[str, Tuple[str, int]] = {
    # Rendered UPPERCASE at 10px with 2.6 letterspacing, so these are small-caps
    # labels, not sentences. Short reads as confident at that size; descriptive
    # reads as a database column header. The covers underneath carry the detail.
    #
    # The three Europe rails run consecutively, so they share a stem and differ
    # in one word — a set, rather than three headings that each begin by
    # repeating the same five letters.
    "yours":    ("Already yours", 0),          # computed per user, not from this table
    "south_asia": ("South Asia", 1),
    "china":    ("China", 2),
    "east_asia": ("East Asia", 3),
    "himalaya": ("The Himalaya", 4),
    "persia":   ("Persia & Arabia", 5),
    "sky":      ("Europe · Sky", 6),
    "letters":  ("Europe · Letters", 7),
    "folk":     ("Europe · Folk", 8),
    "africa":   ("Africa", 9),
    "americas": ("The Americas", 10),
    # Not shortened to "Southeast Asia", though six of the nine live there:
    # Polynesian, Tahitian and Aboriginal reading would then sit under a heading
    # that is simply wrong about them. Two extra words is the cheaper error.
    "pacific":  ("Southeast Asia & Oceania", 11),
    "body":     ("The Body", 12),
}

# system id → (shelf, kind)
SYSTEM_SHELF: Dict[str, Tuple[str, str]] = {
    # ── South Asia ──────────────────────────────────────────────────────────
    "numerology":     ("south_asia", "birth"),
    "tamil":          ("south_asia", "birth"),
    "sarvatobhadra":  ("south_asia", "birth"),
    "ramala":         ("south_asia", "cast"),
    "ashtamangala":   ("south_asia", "cast"),
    "nekath":         ("south_asia", "practice"),
    # ── China ───────────────────────────────────────────────────────────────
    "chenggu":        ("china", "birth"),
    "guolao":         ("china", "birth"),
    "tieban":         ("china", "birth"),
    "bazhai":         ("china", "birth"),
    "flyingstar":     ("china", "moment"),
    "sanhe":          ("china", "moment"),
    "qimen":          ("china", "moment"),
    "daliuren":       ("china", "moment"),
    "meihua":         ("china", "moment"),
    "taiyi":          ("china", "moment"),
    "xiaoliuren":     ("china", "moment"),
    "kauchim":        ("china", "cast"),
    "lingqi":         ("china", "cast"),
    "taoist":         ("china", "practice"),
    "loshu":          ("china", "birth"),
    # ── Japan · Korea · Vietnam ─────────────────────────────────────────────
    "saju":           ("east_asia", "birth"),
    "tojeong":        ("east_asia", "birth"),
    "gunghap":        ("east_asia", "birth"),
    "tuvi":           ("east_asia", "birth"),
    "tutru":          ("east_asia", "birth"),
    "suimei":         ("east_asia", "birth"),
    "sanmei":         ("east_asia", "birth"),
    "onmyodo":        ("east_asia", "birth"),
    "ninestar":       ("east_asia", "birth"),
    "omikuji":        ("east_asia", "cast"),
    "seimei":         ("east_asia", "practice"),
    # ── Tibet & the Himalaya ────────────────────────────────────────────────
    "tibetan":        ("himalaya", "birth"),
    "kartsi":         ("himalaya", "birth"),
    "zurhai":         ("himalaya", "birth"),
    # ── Persia & Arabia ─────────────────────────────────────────────────────
    "firdaria":       ("persia", "birth"),
    "abjad":          ("persia", "birth"),
    "jafr":           ("persia", "birth"),
    "mansions":       ("persia", "birth"),
    "ikhtiyarat":     ("persia", "moment"),
    "zairja":         ("persia", "moment"),
    "istikhara":      ("persia", "cast"),
    "hafez":          ("persia", "cast"),
    # ── Europe — the sky ────────────────────────────────────────────────────
    "hermetic":       ("sky", "birth"),
    "medical":        ("sky", "birth"),
    "evolutionary":   ("sky", "birth"),
    "humandesign":    ("sky", "birth"),
    "egyptian":       ("sky", "birth"),
    "sacred":         ("sky", "birth"),
    "alchemy":        ("sky", "birth"),
    "barbault":       ("sky", "moment"),
    "bradley":        ("sky", "moment"),
    "landscheidt":    ("sky", "moment"),
    # ── Europe — letters & number ───────────────────────────────────────────
    "kabbalah":       ("letters", "birth"),
    "gematria":       ("letters", "birth"),
    "isopsephy":      ("letters", "birth"),
    "angel":          ("letters", "moment"),
    "mazalot":        ("letters", "birth"),
    # ── Europe — folk ───────────────────────────────────────────────────────
    "celtic":         ("folk", "birth"),
    "futhorc":        ("folk", "cast"),
    "younger_futhark":("folk", "cast"),
    "goralot":        ("folk", "cast"),
    "kipper":         ("folk", "cast"),
    "sibilla":        ("folk", "cast"),
    "cartomancy":     ("folk", "cast"),
    "cleromancy":     ("folk", "cast"),
    "bibliomancy":    ("folk", "cast"),
    "slavic":         ("folk", "practice"),
    "baltic":         ("folk", "practice"),
    "tasseography":   ("folk", "practice"),
    "scrying":        ("folk", "practice"),
    "dowsing":        ("folk", "practice"),
    # ── Africa ──────────────────────────────────────────────────────────────
    "akan":           ("africa", "birth"),
    "sikidy":         ("africa", "cast"),
    "merindinlogun":  ("africa", "cast"),
    "african_held":   ("africa", "practice"),
    # ── The Americas ────────────────────────────────────────────────────────
    "mayan":          ("americas", "birth"),
    "aztec":          ("americas", "birth"),
    "oaxacan":        ("americas", "birth"),
    "andean":         ("americas", "birth"),
    "native":         ("americas", "birth"),
    # ── The Pacific & Southeast Asia ────────────────────────────────────────
    "mahabote":       ("pacific", "birth"),
    "thai":           ("pacific", "birth"),
    "khmer":          ("pacific", "birth"),
    "lao":            ("pacific", "birth"),
    "pawukon":        ("pacific", "birth"),
    "weton":          ("pacific", "birth"),
    "polynesian":     ("pacific", "birth"),
    "tahitian":       ("pacific", "birth"),
    "aboriginal":     ("pacific", "practice"),
    # ── Read from the body ──────────────────────────────────────────────────
    "chiromancy":     ("body", "body"),
    "shouxiang":      ("body", "body"),
    "mianxiang":      ("body", "body"),
    "physiognomy":    ("body", "body"),
    "samudrika":      ("body", "body"),
    "moleosophy":     ("body", "body"),
    "svara":          ("body", "body"),
}

# Rails lead with what can actually read you — see the KIND note above.
_KIND_ORDER = {"birth": 0, "cast": 1, "moment": 2, "body": 3, "practice": 4}


def kind_of(sid: str) -> str:
    return SYSTEM_SHELF.get(sid, ("", "practice"))[1]


def shelf_of(sid: str) -> str:
    return SYSTEM_SHELF.get(sid, ("", ""))[0]


def books_on(shelf: str, known: set) -> List[str]:
    """System ids on `shelf`, depth first — only those actually registered."""
    ids = [s for s, (sh, _k) in SYSTEM_SHELF.items() if sh == shelf and s in known]
    ids.sort(key=lambda s: (_KIND_ORDER.get(kind_of(s), 9), s))
    return ids


def ordered_shelves() -> List[Tuple[str, str]]:
    """[(shelf_id, title)] in display order, excluding the computed 'yours' rail."""
    out = [(k, v[0]) for k, v in SHELVES.items() if k != "yours"]
    out.sort(key=lambda kv: SHELVES[kv[0]][1])
    return out
