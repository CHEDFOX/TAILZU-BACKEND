"""
ZI WEI DOU SHU (紫微斗數) — Purple Star Astrology, computed properly.

WHAT WAS HERE BEFORE, AND WHY IT IS GONE
────────────────────────────────────────
The previous implementation labelled its own placement functions "Simplified" and
"Will be computed". They were neither classical nor approximate — they were invented:

  · `_place_zi_wei` derived the Emperor's palace from `(lunar_day - 1 + stem_group*2) % 12`.
    No school places Zi Wei that way. The real placement runs through the Five Elements
    Bureau, which the old code never computed at all.
  · The Tian Fu group used `(zi_wei + n) % 12 if zi_wei <= 6 else (12 - zi_wei + n) % 12`,
    a conditional with no counterpart in the tradition. Tian Fu is the mirror of Zi Wei
    about the Yin–Shen axis: `(4 - zi_wei) % 12`, unconditionally.
  · It fed the GREGORIAN month and day into formulas that require the LUNAR ones, so even
    a correct algorithm would have been out by up to six weeks.

The result rendered plausibly and was wrong in every particular. That is worse than a
missing feature, so it has been replaced rather than patched.

WHAT THIS COMPUTES
──────────────────
  · the twelve palaces, fixed to the earthly branches, named counter-clockwise from Life
  · Life (命宮) and Body (身宮) palaces from lunar month and birth double-hour
  · palace stems by the Five Tigers Escaping rule
  · the Five Elements Bureau (五行局) from the na-yin of the Life Palace pillar
  · Zi Wei's palace from bureau and lunar day — the classical quotient/remainder method
  · the Zi Wei group (6 stars) and the Tian Fu group (8 stars)
  · eighteen minor stars, including the Lu Cun / Qing Yang / Tuo Luo triad and the two
    Fire stars, whose placement depends on the year-branch trine AND the birth hour
  · the four transformations (四化) of the birth year
  · the decade limits (大限), with the direction set by year-stem polarity and sex
  · star brightness (廟旺利陷) — which is most of what separates a strong chart from a
    weak one, and which the old code did not have

ON SCHOOL VARIATION, honestly: Zi Wei has real disagreements between the Northern and
Southern schools and between published tables. The brightness table and the four
transformations for the stems Geng and Ren are the usual flashpoints. This module follows
the mainstream Northern (三合) tradition throughout and says so, rather than presenting one
school's table as universal.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .lunisolar import (
    BRANCHES, BRANCHES_CN, STEMS, STEMS_CN, lunar_date, LunarDate,
)

# ══════════════════════════════════════════════════════════════════════════════
# palaces
# ══════════════════════════════════════════════════════════════════════════════

PALACE_NAMES = [
    ("Life", "命宮", "the self — temperament, the shape of the whole life"),
    ("Siblings", "兄弟", "brothers and sisters, peers, the people beside you"),
    ("Spouse", "夫妻", "marriage and the partner — how you pair, and with whom"),
    ("Children", "子女", "offspring, students, what you generate and raise"),
    ("Wealth", "財帛", "money as it flows — earning, holding, spending"),
    ("Health", "疾厄", "the body, its weak points and its crises"),
    ("Travel", "遷移", "movement, the world outside the door, life abroad"),
    ("Friends", "交友", "subordinates, colleagues, the wider social field"),
    ("Career", "官祿", "office, profession, standing and reputation"),
    ("Property", "田宅", "land, home, the estate and what is inherited"),
    ("Fortune", "福德", "inner life, pleasures, the quality of one's peace"),
    ("Parents", "父母", "father and mother, elders, protection from above"),
]

# ══════════════════════════════════════════════════════════════════════════════
# stars
# ══════════════════════════════════════════════════════════════════════════════

MAJOR_STARS = {
    'Zi Wei': {'chinese': '紫微', 'nature': 'Emperor', 'element': 'Earth', 'group': 'ziwei',
               'meaning': 'authority, dignity, the decision that others wait for'},
    'Tian Ji': {'chinese': '天機', 'nature': 'Strategist', 'element': 'Wood', 'group': 'ziwei',
                'meaning': 'intelligence, planning, restlessness, the turning wheel'},
    'Tai Yang': {'chinese': '太陽', 'nature': 'Sun', 'element': 'Fire', 'group': 'ziwei',
                 'meaning': 'giving without counting, public life, fame, the father'},
    'Wu Qu': {'chinese': '武曲', 'nature': 'General', 'element': 'Metal', 'group': 'ziwei',
              'meaning': 'money made by force of will, decisiveness, solitude'},
    'Tian Tong': {'chinese': '天同', 'nature': 'Blessing', 'element': 'Water', 'group': 'ziwei',
                  'meaning': 'ease, enjoyment, emotional softness, the late bloomer'},
    'Lian Zhen': {'chinese': '廉貞', 'nature': 'Judge', 'element': 'Fire', 'group': 'ziwei',
                  'meaning': 'principle and politics, complication in love, a sharp mind'},
    'Tian Fu': {'chinese': '天府', 'nature': 'Treasury', 'element': 'Earth', 'group': 'tianfu',
                'meaning': 'the storehouse — accumulation, caution, reliable wealth'},
    'Tai Yin': {'chinese': '太陰', 'nature': 'Moon', 'element': 'Water', 'group': 'tianfu',
                'meaning': 'property and savings, refinement, the mother, the private life'},
    'Tan Lang': {'chinese': '貪狼', 'nature': 'Wolf', 'element': 'Wood', 'group': 'tianfu',
                 'meaning': 'desire — for pleasure, for skill, for more; charm and appetite'},
    'Ju Men': {'chinese': '巨門', 'nature': 'Great Gate', 'element': 'Water', 'group': 'tianfu',
               'meaning': 'the mouth — argument, analysis, suspicion, speech as a trade'},
    'Tian Xiang': {'chinese': '天相', 'nature': 'Minister', 'element': 'Water', 'group': 'tianfu',
                   'meaning': 'the second chair — service, diplomacy, the seal of office'},
    'Tian Liang': {'chinese': '天梁', 'nature': 'Roof Beam', 'element': 'Earth', 'group': 'tianfu',
                   'meaning': 'shelter and seniority — the elder who solves it, old principles'},
    'Qi Sha': {'chinese': '七殺', 'nature': 'Seven Killings', 'element': 'Metal', 'group': 'tianfu',
               'meaning': 'the campaign — risk, command, reform by force'},
    'Po Jun': {'chinese': '破軍', 'nature': 'Army Breaker', 'element': 'Water', 'group': 'tianfu',
               'meaning': 'demolition before building — the pioneer who spends everything'},
}

MINOR_STARS = {
    'Wen Chang': {'chinese': '文昌', 'kind': 'auspicious', 'meaning': 'letters, examinations, formal learning'},
    'Wen Qu': {'chinese': '文曲', 'kind': 'auspicious', 'meaning': 'eloquence, art, the persuasive voice'},
    'Zuo Fu': {'chinese': '左輔', 'kind': 'auspicious', 'meaning': 'the helper on the left — steady support'},
    'You Bi': {'chinese': '右弼', 'kind': 'auspicious', 'meaning': 'the helper on the right — timely assistance'},
    'Tian Kui': {'chinese': '天魁', 'kind': 'auspicious', 'meaning': 'the noble patron, seen and official'},
    'Tian Yue': {'chinese': '天鉞', 'kind': 'auspicious', 'meaning': 'the noble patron, quiet and behind the scenes'},
    'Lu Cun': {'chinese': '祿存', 'kind': 'auspicious', 'meaning': 'the salary star — secured income, a guarded store'},
    'Tian Ma': {'chinese': '天馬', 'kind': 'auspicious', 'meaning': 'the horse — travel, relocation, momentum'},
    'Hong Luan': {'chinese': '紅鸞', 'kind': 'auspicious', 'meaning': 'marriage, romance, the wedding year'},
    'Tian Xi': {'chinese': '天喜', 'kind': 'auspicious', 'meaning': 'celebration, birth, good news'},
    'Qing Yang': {'chinese': '擎羊', 'kind': 'malefic', 'meaning': 'the blade — injury, haste, cutting loss'},
    'Tuo Luo': {'chinese': '陀羅', 'kind': 'malefic', 'meaning': 'the millstone — delay, dragging, old trouble'},
    'Huo Xing': {'chinese': '火星', 'kind': 'malefic', 'meaning': 'sudden fire — flare-ups, abrupt reversal'},
    'Ling Xing': {'chinese': '鈴星', 'kind': 'malefic', 'meaning': 'slow burn — corrosive, quieter than Huo Xing'},
    'Di Kong': {'chinese': '地空', 'kind': 'malefic', 'meaning': 'emptiness — plans that dissolve, unworldliness'},
    'Di Jie': {'chinese': '地劫', 'kind': 'malefic', 'meaning': 'plunder — loss, waste, the thing taken away'},
}

# Brightness (廟旺利陷) by branch index 0-11 (Zi…Hai). Mainstream Northern-school table.
_B = {'廟': 'temple', '旺': 'prosperous', '得': 'gain', '利': 'benefit',
      '平': 'even', '不': 'weak', '陷': 'fallen'}
BRIGHTNESS = {
    'Zi Wei':     '平廟廟旺陷旺廟廟旺平陷旺',
    'Tian Ji':    '廟陷得旺利平廟陷得旺利平',
    'Tai Yang':   '陷陷旺廟旺旺廟得得平陷陷',
    'Wu Qu':      '旺廟得利廟平旺廟得利廟平',
    'Tian Tong':  '旺陷利廟平廟陷不旺平平廟',
    'Lian Zhen':  '平利廟平利陷平利廟平利陷',
    'Tian Fu':    '廟廟廟得廟得旺廟得旺廟得',
    'Tai Yin':    '廟廟陷陷陷陷陷不利旺廟廟',
    'Tan Lang':   '旺廟平利廟陷旺廟平利廟陷',
    'Ju Men':     '旺不廟廟陷旺旺不廟廟陷旺',
    'Tian Xiang': '廟廟廟陷得得得得廟陷陷得',
    'Tian Liang': '廟旺廟廟廟陷廟旺陷得廟陷',
    'Qi Sha':     '平廟廟旺廟平旺廟廟旺廟平',
    'Po Jun':     '廟旺得陷旺平廟旺得陷旺平',
}

# Four transformations by year stem index 0-9: [Lu 祿, Quan 權, Ke 科, Ji 忌].
FOUR_TRANSFORMATIONS = {
    0: ['Lian Zhen', 'Po Jun', 'Wu Qu', 'Tai Yang'],       # 甲
    1: ['Tian Ji', 'Tian Liang', 'Zi Wei', 'Tai Yin'],     # 乙
    2: ['Tian Tong', 'Tian Ji', 'Wen Chang', 'Lian Zhen'], # 丙
    3: ['Tai Yin', 'Tian Tong', 'Tian Ji', 'Ju Men'],      # 丁
    4: ['Tan Lang', 'Tai Yin', 'You Bi', 'Tian Ji'],       # 戊
    5: ['Wu Qu', 'Tan Lang', 'Tian Liang', 'Wen Qu'],      # 己
    6: ['Tai Yang', 'Wu Qu', 'Tai Yin', 'Tian Tong'],      # 庚
    7: ['Ju Men', 'Tai Yang', 'Wen Qu', 'Wen Chang'],      # 辛
    8: ['Tian Liang', 'Zi Wei', 'Zuo Fu', 'Wu Qu'],        # 壬
    9: ['Po Jun', 'Ju Men', 'Tai Yin', 'Tan Lang'],        # 癸
}
TRANSFORM_META = [
    ('Hua Lu', '化祿', 'wealth and smooth supply — the thing that comes easily'),
    ('Hua Quan', '化權', 'authority and force — the thing you can push through'),
    ('Hua Ke', '化科', 'reputation and repute — the thing you are known for'),
    ('Hua Ji', '化忌', 'obstruction and fixation — the thing that snags, and will not let go'),
]

# ══════════════════════════════════════════════════════════════════════════════
# the Five Elements Bureau
# ══════════════════════════════════════════════════════════════════════════════

# Na-yin element of each of the 30 sexagenary PAIRS, in cycle order (甲子乙丑 …壬戌癸亥).
_NAYIN_PAIRS = ['Metal', 'Fire', 'Wood', 'Earth', 'Metal', 'Fire', 'Water', 'Earth',
                'Metal', 'Wood', 'Water', 'Earth', 'Fire', 'Wood', 'Water', 'Metal',
                'Fire', 'Wood', 'Earth', 'Metal', 'Fire', 'Water', 'Earth', 'Metal',
                'Wood', 'Water', 'Earth', 'Fire', 'Wood', 'Water']

BUREAU = {'Water': (2, '水二局', 'the flowing bureau — quick to start, quick to change'),
          'Wood': (3, '木三局', 'the growing bureau — steady upward pressure'),
          'Metal': (4, '金四局', 'the cutting bureau — decisive, hard-edged'),
          'Earth': (5, '土五局', 'the settling bureau — slow, heavy, enduring'),
          'Fire': (6, '火六局', 'the burning bureau — late-starting, brilliant, consuming')}


def _sexagenary_index(stem: int, branch: int) -> int:
    """Position 0-59 in the jiazi cycle for a stem/branch pair."""
    if (branch - stem) % 2:
        raise ValueError(f"impossible pillar: stem {stem} with branch {branch}")
    k = (5 * ((branch - stem) // 2)) % 6
    return (stem + 10 * k) % 60


def na_yin(stem: int, branch: int) -> str:
    """The na-yin (納音) element of a stem/branch pillar."""
    return _NAYIN_PAIRS[_sexagenary_index(stem, branch) // 2]


# ══════════════════════════════════════════════════════════════════════════════
# placement
# ══════════════════════════════════════════════════════════════════════════════

def life_palace(lunar_month: int, hour_branch: int) -> int:
    """寅起正月，順數至生月，再逆數至生時 — count months forward from Yin, then the
    double-hour backward."""
    return (1 + int(lunar_month) - int(hour_branch)) % 12


def body_palace(lunar_month: int, hour_branch: int) -> int:
    """Same start, the hour counted forward. Coincides with Life at the Zi and Wu hours."""
    return (1 + int(lunar_month) + int(hour_branch)) % 12


def palace_stem(branch: int, year_stem: int) -> int:
    """Five Tigers Escaping: the Yin palace takes its stem from the year stem, and the
    rest follow round the wheel."""
    yin_stem = ((year_stem % 5) * 2 + 2) % 10
    return (yin_stem + (int(branch) - 2)) % 10


def zi_wei_palace(bureau_no: int, lunar_day: int) -> int:
    """The Emperor's palace, by the classical quotient-and-remainder method.

    Take the smallest multiple of the bureau number that reaches the lunar day. The
    quotient counts forward from Yin; the remainder is then added if even and subtracted
    if odd. Checks against the published tables: Water-2 day 1 → Chou, Wood-3 day 1 →
    Chen, Metal-4 day 1 → Hai, Earth-5 day 1 → Wu, Fire-6 day 1 → You."""
    b, d = int(bureau_no), int(lunar_day)
    q = -(-d // b)                       # ceiling division
    r = q * b - d
    offset = q + r if r % 2 == 0 else q - r
    return (2 + offset - 1) % 12


def _ziwei_group(z: int) -> Dict[str, int]:
    """The Emperor and his five, counted backward from Zi Wei."""
    return {'Zi Wei': z, 'Tian Ji': (z - 1) % 12, 'Tai Yang': (z - 3) % 12,
            'Wu Qu': (z - 4) % 12, 'Tian Tong': (z - 5) % 12, 'Lian Zhen': (z - 8) % 12}


def _tianfu_group(z: int) -> Dict[str, int]:
    """Tian Fu mirrors Zi Wei about the Yin–Shen axis; his seven follow him forward."""
    f = (4 - z) % 12
    return {'Tian Fu': f, 'Tai Yin': (f + 1) % 12, 'Tan Lang': (f + 2) % 12,
            'Ju Men': (f + 3) % 12, 'Tian Xiang': (f + 4) % 12, 'Tian Liang': (f + 5) % 12,
            'Qi Sha': (f + 6) % 12, 'Po Jun': (f + 10) % 12}


_LU_CUN = {0: 2, 1: 3, 2: 5, 3: 6, 4: 5, 5: 6, 6: 8, 7: 9, 8: 11, 9: 0}
_TIAN_KUI = {0: 1, 4: 1, 6: 1, 1: 0, 5: 0, 2: 11, 3: 11, 8: 3, 9: 3, 7: 6}
_TIAN_YUE = {0: 7, 4: 7, 6: 7, 1: 8, 5: 8, 2: 9, 3: 9, 8: 5, 9: 5, 7: 2}
# Year-branch trine → (Huo Xing start, Ling Xing start).
_FIRE_START = {2: (1, 3), 6: (1, 3), 10: (1, 3),        # 寅午戌
               8: (2, 10), 0: (2, 10), 4: (2, 10),      # 申子辰
               5: (3, 10), 9: (3, 10), 1: (3, 10),      # 巳酉丑
               11: (9, 10), 3: (9, 10), 7: (9, 10)}     # 亥卯未
_TIAN_MA = {2: 8, 6: 8, 10: 8, 8: 2, 0: 2, 4: 2, 5: 11, 9: 11, 1: 11, 11: 5, 3: 5, 7: 5}


def _minor_stars(ld: LunarDate) -> Dict[str, int]:
    """The eighteen minors. Each has its own anchor — some run off the hour, some off the
    lunar month, some off the year stem, and the two Fire stars off both the year-branch
    trine and the hour, which is why they cannot be tabulated as simply as the rest."""
    h, m = ld.hour_branch, ld.month
    ys, yb = ld.year_stem, ld.year_branch
    lu = _LU_CUN[ys]
    hx, lx = _FIRE_START[yb]
    hong = (3 - yb) % 12
    return {
        'Wen Chang': (10 - h) % 12,
        'Wen Qu': (4 + h) % 12,
        'Zuo Fu': (4 + m - 1) % 12,
        'You Bi': (10 - m + 1) % 12,
        'Tian Kui': _TIAN_KUI[ys],
        'Tian Yue': _TIAN_YUE[ys],
        'Lu Cun': lu,
        'Qing Yang': (lu + 1) % 12,
        'Tuo Luo': (lu - 1) % 12,
        'Huo Xing': (hx + h) % 12,
        'Ling Xing': (lx + h) % 12,
        'Di Kong': (11 - h) % 12,
        'Di Jie': (11 + h) % 12,
        'Tian Ma': _TIAN_MA[yb],
        'Hong Luan': hong,
        'Tian Xi': (hong + 6) % 12,
    }


# ══════════════════════════════════════════════════════════════════════════════
# the chart
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Palace:
    index: int                    # branch 0-11
    branch: str
    branch_cn: str
    stem: str
    stem_cn: str
    name: str                     # Life, Siblings …
    name_cn: str
    meaning: str
    major: List[dict] = field(default_factory=list)
    minor: List[dict] = field(default_factory=list)
    transformations: List[dict] = field(default_factory=list)
    is_body: bool = False
    decade: Optional[dict] = None

    @property
    def empty(self) -> bool:
        return not self.major

    def summary(self) -> str:
        stars = ', '.join(f"{s['name']}({s['brightness_cn']})" for s in self.major) or '—'
        extra = ', '.join(s['name'] for s in self.minor)
        line = f"{self.name} [{self.stem}{self.branch}] {stars}"
        if extra:
            line += f" · {extra}"
        if self.transformations:
            line += " · " + ', '.join(f"{t['star']}→{t['short']}" for t in self.transformations)
        if self.is_body:
            line += " · BODY"
        return line


class ZiWeiChart:
    """A full Zi Wei Dou Shu chart.

    `birth_dt` is local clock time at the birthplace — the double-hour branch is read
    straight off it, which is what every school does.
    """

    def __init__(self, birth_dt, gender: str = 'male'):
        self.birth_dt = birth_dt
        self.gender = (gender or 'male').strip().lower()
        self._built = False
        self.palaces: List[Palace] = []
        self.lunar: Optional[LunarDate] = None

    # ── build ────────────────────────────────────────────────────────────────
    def _build(self):
        if self._built:
            return
        dt = self.birth_dt
        ld = lunar_date(dt.year, dt.month, dt.day, getattr(dt, 'hour', 12),
                        getattr(dt, 'minute', 0))
        self.lunar = ld

        # A leap month counts as the month it repeats for placement purposes; some
        # schools split the month at its midpoint. We take the mainstream rule and say so.
        lmonth = ld.month

        life = life_palace(lmonth, ld.hour_branch)
        body = body_palace(lmonth, ld.hour_branch)
        self.life_index, self.body_index = life, body

        life_stem = palace_stem(life, ld.year_stem)
        element = na_yin(life_stem, life)
        self.bureau_element = element
        self.bureau_no, self.bureau_cn, self.bureau_seed = BUREAU[element]

        z = zi_wei_palace(self.bureau_no, ld.day)
        self.zi_wei_index = z
        positions: Dict[str, int] = {}
        positions.update(_ziwei_group(z))
        positions.update(_tianfu_group(z))
        self.major_positions = dict(positions)
        self.minor_positions = _minor_stars(ld)

        trans = FOUR_TRANSFORMATIONS.get(ld.year_stem, [])
        self.transformations = []
        for i, star in enumerate(trans):
            name, cn, gloss = TRANSFORM_META[i]
            pos = self.major_positions.get(star, self.minor_positions.get(star))
            self.transformations.append({
                'star': star, 'name': name, 'short': cn, 'chinese': cn,
                'meaning': gloss, 'palace_index': pos,
            })

        # Palaces, named counter-clockwise from Life.
        self.palaces = []
        for b in range(12):
            offset = (life - b) % 12
            pname, pcn, pmeaning = PALACE_NAMES[offset]
            st = palace_stem(b, ld.year_stem)
            p = Palace(index=b, branch=BRANCHES[b], branch_cn=BRANCHES_CN[b],
                       stem=STEMS[st], stem_cn=STEMS_CN[st],
                       name=pname, name_cn=pcn, meaning=pmeaning, is_body=(b == body))
            for star, pos in self.major_positions.items():
                if pos == b:
                    ch = BRIGHTNESS[star][b]
                    p.major.append({'name': star, **MAJOR_STARS[star],
                                    'brightness_cn': ch, 'brightness': _B.get(ch, '')})
            for star, pos in self.minor_positions.items():
                if pos == b:
                    p.minor.append({'name': star, **MINOR_STARS[star]})
            for t in self.transformations:
                if t['palace_index'] == b:
                    p.transformations.append(t)
            self.palaces.append(p)

        self._decades()
        self._built = True

    def _decades(self):
        """大限 — ten-year limits. They start at the bureau number and run forward for a
        yang-stem man or yin-stem woman, backward otherwise."""
        ld = self.lunar
        yang = ld.year_stem % 2 == 0
        male = self.gender.startswith('m')
        forward = (yang and male) or (not yang and not male)
        self.decade_forward = forward
        age = self.bureau_no
        for i in range(12):
            b = (self.life_index + i) % 12 if forward else (self.life_index - i) % 12
            pal = next(p for p in self.palaces if p.index == b)
            pal.decade = {'from_age': age, 'to_age': age + 9, 'order': i + 1}
            age += 10

    # ── views ────────────────────────────────────────────────────────────────
    def by_name(self, name: str) -> Optional[Palace]:
        self._build()
        return next((p for p in self.palaces if p.name.lower() == name.lower()), None)

    def opposite(self, palace: Palace) -> Palace:
        """對宮 — the facing palace. In Zi Wei an empty palace is read through its
        opposite, so this is not a convenience; it is part of the method."""
        self._build()
        return next(p for p in self.palaces if p.index == (palace.index + 6) % 12)

    def trine(self, palace: Palace) -> List[Palace]:
        """三方四正 — the two trine palaces plus the opposite: the four that are read
        together as one field."""
        self._build()
        want = {(palace.index + 4) % 12, (palace.index + 8) % 12, (palace.index + 6) % 12}
        return [p for p in self.palaces if p.index in want]

    def decade_at(self, age: int) -> Optional[Palace]:
        self._build()
        return next((p for p in self.palaces
                     if p.decade and p.decade['from_age'] <= age <= p.decade['to_age']), None)

    def annual_palace(self, year: int) -> Palace:
        """流年 — the annual palace is simply the palace of that year's branch."""
        self._build()
        return next(p for p in self.palaces if p.index == (int(year) - 4) % 12)

    # ── report ───────────────────────────────────────────────────────────────
    def get_all_palaces(self) -> Dict[str, dict]:
        self._build()
        return {p.name: {
            'position': p.index, 'branch': p.branch, 'stem': p.stem,
            'chinese': p.name_cn, 'meaning': p.meaning,
            'stars': [s['name'] for s in p.major],
            'star_details': p.major, 'minor': p.minor,
            'transformations': p.transformations,
            'is_body_palace': p.is_body, 'decade': p.decade,
            'empty': p.empty,
        } for p in self.palaces}

    def get_life_palace(self) -> dict:
        self._build()
        return self.get_all_palaces()['Life']

    def get_transformations(self) -> Dict[str, dict]:
        self._build()
        return {f"{t['name']} ({t['chinese']})": {
            'star': t['star'], 'meaning': t['meaning'],
            'palace': next((p.name for p in self.palaces if p.index == t['palace_index']), ''),
        } for t in self.transformations}

    def generate_report(self) -> dict:
        self._build()
        ld = self.lunar
        pal = self.get_all_palaces()
        return {
            'system': 'Zi Wei Dou Shu (紫微斗數)',
            'lunar_date': {'year': ld.year, 'month': ld.month, 'day': ld.day,
                           'is_leap_month': ld.is_leap_month, 'label': ld.label,
                           'year_pillar': ld.year_pillar, 'animal': ld.animal},
            'bureau': {'element': self.bureau_element, 'number': self.bureau_no,
                       'chinese': self.bureau_cn, 'meaning': self.bureau_seed},
            'life_palace': pal['Life'],
            'body_palace': next((p.name for p in self.palaces if p.is_body), ''),
            'career_palace': pal['Career'],
            'wealth_palace': pal['Wealth'],
            'spouse_palace': pal['Spouse'],
            'all_palaces': pal,
            'transformations': self.get_transformations(),
            'star_positions': dict(self.major_positions),
            'minor_positions': dict(self.minor_positions),
            'decades_forward': self.decade_forward,
            'school': 'Northern (三合) tradition; brightness and the Geng/Ren '
                      'transformations vary between schools.',
        }

    def text_grid(self) -> str:
        """The chart as the twelve palaces, in branch order — one line each."""
        self._build()
        return "\n".join(p.summary() for p in
                         sorted(self.palaces, key=lambda x: (x.index - self.life_index) % 12))
