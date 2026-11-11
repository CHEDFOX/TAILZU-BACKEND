"""
SEIMEI HANDAN (姓名判断) — Japanese name divination, and SANMEI-GAKU (算命学).

SEIMEI HANDAN is the most consequential divination system in modern Japan by any practical
measure: people change the kanji they write their children's names with because of it,
maternity wards keep stroke-count tables, and 印鑑 shops advertise on it. It reads the
KAKUSŪ (画数) — the stroke counts of the written name — in five fields:

  天格 tenkaku   the surname alone — inherited, and not judged as personal fortune
  人格 jinkaku   last char of the surname + first of the given name — the CORE, the
                 person's own nature; this is the field that matters most
  地格 chikaku   the given name alone — youth, and the years before thirty
  外格 gaikaku   total minus jinkaku — how the outside world receives you
  総格 sōkaku    the whole name — the life taken together, and old age

Each count 1-81 is graded 大吉 through 大凶. The grading below follows the mainstream
Kumazaki Kenʼō lineage; schools differ on perhaps a dozen numbers and any table that
claims to be the only one is overstating.

The stroke count is the hard part, not the grading. Real practice counts by the KANGXI
radical form (旧字体), where 氵 counts 4 as 水 and 忄 counts 4 as 心, not by the modern
simplified glyph — so the same name can be lucky or unlucky depending on which convention
the practitioner uses. Unicode does not carry stroke counts, so this module takes them as
input and provides the kana table (which is fixed and unambiguous) plus the radical
corrections that most often catch people out.

SANMEI-GAKU is a 20th-century Japanese reformulation of pillar astrology by Takaki Jōkō,
built on the 十大主星 (ten major stars) and 十二大従星 (twelve attendant stars) rather than
on the ten gods directly. It shares the pillars with Shichū Suimei and reads them through a
different lattice, which is why it is counted separately.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional

# Kana stroke counts — fixed, and the one part of the count that is not disputed.
KANA_STROKES = {
    "あ": 3, "い": 2, "う": 2, "え": 2, "お": 3, "か": 3, "き": 4, "く": 1, "け": 3, "こ": 2,
    "さ": 3, "し": 1, "す": 2, "せ": 3, "そ": 1, "た": 4, "ち": 3, "つ": 1, "て": 2, "と": 2,
    "な": 5, "に": 3, "ぬ": 4, "ね": 4, "の": 1, "は": 3, "ひ": 2, "ふ": 4, "へ": 1, "ほ": 4,
    "ま": 4, "み": 3, "む": 4, "め": 2, "も": 3, "や": 3, "ゆ": 2, "よ": 3,
    "ら": 2, "り": 2, "る": 2, "れ": 2, "ろ": 1, "わ": 3, "を": 3, "ん": 1,
    "が": 5, "ぎ": 6, "ぐ": 3, "げ": 5, "ご": 4, "ざ": 5, "じ": 3, "ず": 4, "ぜ": 5, "ぞ": 3,
    "だ": 6, "ぢ": 5, "づ": 3, "で": 4, "ど": 4, "ば": 5, "び": 4, "ぶ": 6, "べ": 3, "ぼ": 6,
    "ぱ": 4, "ぴ": 3, "ぷ": 5, "ぺ": 2, "ぽ": 5,
}
# The radical corrections that most often change a verdict. Kangxi form, not modern glyph.
RADICAL_CORRECTIONS = {
    "氵": (3, 4, "the water radical counts as 水, four strokes, not three"),
    "忄": (3, 4, "the heart radical counts as 心, four strokes, not three"),
    "扌": (3, 4, "the hand radical counts as 手, four strokes, not three"),
    "犭": (3, 4, "the dog radical counts as 犬, four strokes, not three"),
    "艹": (3, 6, "the grass radical counts as 艸, six strokes, not three"),
    "辶": (3, 7, "the walk radical counts as 辵, seven strokes, not three"),
    "阝": (2, 8, "as 阜 (left) it counts eight; as 邑 (right) seven"),
    "月": (4, 6, "as the flesh radical it counts as 肉, six strokes"),
    "王": (4, 5, "as the jade radical it counts as 玉, five strokes"),
}

# 1-81 graded. 大吉 best, 大凶 worst.
_GOOD = {1, 3, 5, 6, 7, 8, 11, 13, 15, 16, 17, 18, 21, 23, 24, 25, 29, 31, 32, 33,
         35, 37, 38, 39, 41, 45, 47, 48, 52, 57, 58, 61, 63, 65, 67, 68, 81}
_BAD = {2, 4, 9, 10, 12, 14, 19, 20, 22, 26, 27, 28, 30, 34, 36, 40, 42, 43, 44, 46,
        49, 50, 51, 53, 54, 55, 56, 59, 60, 62, 64, 66, 69, 70, 71, 72, 73, 74, 75,
        76, 77, 78, 79, 80}
_GREAT = {1, 3, 5, 6, 11, 13, 15, 16, 21, 23, 24, 31, 32, 33, 35, 37, 39, 41, 45, 47, 48, 52, 63, 65, 81}
_TERRIBLE = {4, 9, 10, 12, 14, 19, 20, 22, 28, 34, 36, 40, 44, 46, 49, 50, 53, 54, 56, 59, 60, 62, 64, 66, 69, 70, 71, 72, 73, 74, 76, 77, 78, 79, 80}

GRADE_MEANING = {
    "大吉": "greatly auspicious — the number carries the field without strain",
    "吉": "auspicious — favourable, though it asks something of you",
    "半吉": "half auspicious — mixed; the good in it depends on the rest of the name",
    "凶": "inauspicious — the field is obstructed and takes effort to hold",
    "大凶": "greatly inauspicious — the number works against the field it governs",
}

FIELDS = {
    "tenkaku": ("天格", "the surname alone — inherited; not judged as personal fortune"),
    "jinkaku": ("人格", "the core — the person's own nature and the field that decides the reading"),
    "chikaku": ("地格", "youth and the years before thirty"),
    "gaikaku": ("外格", "how the outside world receives you — social fortune"),
    "soukaku": ("総格", "the whole life taken together, and old age"),
}


def grade(n: int) -> str:
    n = int(n)
    if n in _GREAT:
        return "大吉"
    if n in _TERRIBLE:
        return "大凶"
    if n in _GOOD:
        return "吉"
    if n in _BAD:
        return "凶"
    return "半吉"


def kana_strokes(text: str) -> Optional[int]:
    """Stroke count for a name written in kana. Returns None if any character is not kana,
    since guessing a kanji's strokes is exactly the error this module refuses to make."""
    total = 0
    for c in str(text or ""):
        if c in KANA_STROKES:
            total += KANA_STROKES[c]
        elif c in "ー・ 　":
            continue
        else:
            return None
    return total


@dataclass
class SeimeiHandan:
    surname_strokes: List[int]
    given_strokes: List[int]
    fields: Dict[str, Dict]

    def as_dict(self) -> Dict:
        return {"system": "Seimei Handan (姓名判断)",
                "surname_strokes": self.surname_strokes,
                "given_strokes": self.given_strokes, "fields": self.fields,
                "convention_note": (
                    "Counted by the strokes supplied. Traditional practice counts by the "
                    "KANGXI radical form, not the modern glyph — 氵 counts 4 as 水 — so a "
                    "name can grade differently depending on the convention used. The "
                    "corrections are listed in RADICAL_CORRECTIONS.")}

    def summary(self) -> str:
        lines = ["姓名判断 — the five fields"]
        for k, v in self.fields.items():
            ja, meaning = FIELDS[k]
            lines.append(f"  {ja} {k:9s} {v['strokes']:>3d}  {v['grade']:3s} — {meaning}")
        return "\n".join(lines)


def seimei_handan(surname_strokes: List[int], given_strokes: List[int]) -> SeimeiHandan:
    """The five fields, from per-character stroke counts.

    Strokes are taken as input rather than derived: Unicode carries no stroke data, and
    the traditional count follows the Kangxi radical rather than the printed glyph, so a
    guessed count would silently produce the wrong verdict on the field that matters most."""
    s = [int(x) for x in (surname_strokes or [1])]
    g = [int(x) for x in (given_strokes or [1])]
    ten = sum(s)
    chi = sum(g)
    jin = s[-1] + g[0]
    sou = ten + chi
    gai = sou - jin if len(s) + len(g) > 2 else 1

    out = {}
    for key, val in (("tenkaku", ten), ("jinkaku", jin), ("chikaku", chi),
                     ("gaikaku", gai), ("soukaku", sou)):
        gr = grade(val)
        out[key] = {"strokes": val, "grade": gr, "grade_meaning": GRADE_MEANING[gr],
                    "japanese": FIELDS[key][0], "field_meaning": FIELDS[key][1]}
    return SeimeiHandan(surname_strokes=s, given_strokes=g, fields=out)


# ══════════════════════════════════════════════════════════════════════════════
# SANMEI-GAKU
# ══════════════════════════════════════════════════════════════════════════════

# 十大主星 — the ten major stars, Sanmei's lattice over the ten gods.
JUDAI_SHUSEI = {
    "hiken": ("貫索星", "kansaku", "the unbending — self-reliance carried to obstinacy"),
    "gouzai": ("石門星", "sekimon", "the stone gate — sociable, and shrewd about alliances"),
    "shokujin": ("鳳閣星", "hōkaku", "the phoenix pavilion — natural ease, play, long life"),
    "shoukan": ("調舒星", "chōjo", "the tuned reed — sensitivity and the artist's discontent"),
    "henzai": ("禄存星", "rokuzon", "the store — generosity that expects to be seen"),
    "seizai": ("司禄星", "shiroku", "the steward — thrift, accumulation, domestic order"),
    "henkan": ("車騎星", "shaki", "the chariot — direct force, action before thought"),
    "seikan": ("牽牛星", "kengyū", "the ox-herd — duty, office, reputation and its weight"),
    "hennin": ("龍高星", "ryūkō", "the high dragon — invention, foreign things, the unorthodox"),
    "injyu": ("玉堂星", "gyokudō", "the jade hall — learning, tradition, the mother's line"),
}
# 十二大従星 — the twelve attendant stars, energy values 1-12.
JUNI_DAIJUSEI = [
    ("天報星", "tenpō", 3, "the herald — changeable, many beginnings"),
    ("天印星", "tenin", 6, "the seal — guileless, loved, protected"),
    ("天貴星", "tenki", 9, "the noble — raised expectations, an early burden"),
    ("天恍星", "tenkō", 7, "the dazzle — romantic, restless, drawn to distance"),
    ("天南星", "tennan", 10, "the south star — vigorous, impatient, young in force"),
    ("天禄星", "tenroku", 11, "the stipend — steady, established, self-supporting"),
    ("天将星", "tenshō", 12, "the general — the maximum; command, and the weight of it"),
    ("天堂星", "tendō", 8, "the hall — mature, mediating, respected"),
    ("天胡星", "tenko", 4, "the invalid — delicate, imaginative, indoor"),
    ("天極星", "tenkyoku", 2, "the extreme — otherworldly, dependent, spiritual"),
    ("天庫星", "tenko2", 5, "the vault — inheritance, research, what is kept and studied"),
    ("天馳星", "tenchi", 1, "the courier — the minimum; fleeting, driven, elsewhere"),
]


def sanmei(year: int, month: int, day: int, hour: int = 12, minute: int = 0) -> Dict:
    """A Sanmei-gaku reading — the pillars read through Sanmei's own lattice.

    Shares the four pillars with Shichū Suimei and reads them through the ten major stars
    and twelve attendant stars instead of the ten gods, which is what makes it a separate
    tradition rather than a translation."""
    from .suimei import suimei, JUNIUN

    s = suimei(year, month, day, hour, minute)
    shusei = {}
    for pos, god in s.tsuhensei.items():
        cn, rom, meaning = JUDAI_SHUSEI[god]
        shusei[pos] = {"star": cn, "romaji": rom, "meaning": meaning, "from_god": god}

    # The attendant star follows the twelve-stage position, which suimei already computes.
    jusei = {}
    for pos, stage in s.juniun.items():
        i = [j[0] for j in JUNIUN].index(stage[0])
        cn, rom, energy, meaning = JUNI_DAIJUSEI[i]
        jusei[pos] = {"star": cn, "romaji": rom, "energy": energy, "meaning": meaning}

    total_energy = sum(v["energy"] for v in jusei.values())
    return {
        "system": "Sanmei-gaku (算命学)",
        "pillars": s.pillars, "day_master": s.day_master,
        "major_stars": shusei, "attendant_stars": jusei,
        "total_energy": total_energy, "energy_of": 48,
        "energy_reading": ("a large constitution — force to spend, and it must be spent"
                           if total_energy >= 30 else
                           "a small constitution — conserve; the strength is in precision"
                           if total_energy <= 18 else
                           "a middling constitution — enough force for a steady life"),
        "note": ("Sanmei-gaku was formulated by Takaki Jōkō in the 20th century from "
                 "Chinese pillar material. It shares the pillars with Shichū Suimei and "
                 "reads them through a different lattice — the ten major and twelve "
                 "attendant stars — which is why it is counted as its own system."),
    }


assert len(JUDAI_SHUSEI) == 10 and len(JUNI_DAIJUSEI) == 12
assert sorted(v[2] for v in JUNI_DAIJUSEI) == list(range(1, 13)), \
    "the attendant stars must carry energies 1-12 exactly once each"
assert all(1 <= n <= 81 for n in _GOOD | _BAD), "grades run 1-81"
assert _GREAT <= _GOOD and _TERRIBLE <= _BAD, "extremes must sit inside their class"
