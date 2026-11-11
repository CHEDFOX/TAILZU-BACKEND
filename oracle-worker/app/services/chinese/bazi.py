"""
CHINESE ASTROLOGY — BAZI (FOUR PILLARS OF DESTINY)
八字 — Year, Month, Day, Hour pillars using Heavenly Stems & Earthly Branches.

Each pillar = 1 Heavenly Stem + 1 Earthly Branch
The Day Stem is the "Day Master" — represents the self.
"""

from datetime import datetime, date
from typing import Dict, List

# ═══════════════════════════════════════════════════════════════
# HEAVENLY STEMS (天干) & EARTHLY BRANCHES (地支)
# ═══════════════════════════════════════════════════════════════

HEAVENLY_STEMS = [
    ("Jia", "甲", "Yang Wood"),   ("Yi", "乙", "Yin Wood"),
    ("Bing", "丙", "Yang Fire"),  ("Ding", "丁", "Yin Fire"),
    ("Wu", "戊", "Yang Earth"),   ("Ji", "己", "Yin Earth"),
    ("Geng", "庚", "Yang Metal"), ("Xin", "辛", "Yin Metal"),
    ("Ren", "壬", "Yang Water"),  ("Gui", "癸", "Yin Water"),
]

EARTHLY_BRANCHES = [
    ("Zi", "子", "Rat", "Yang Water"),     ("Chou", "丑", "Ox", "Yin Earth"),
    ("Yin", "寅", "Tiger", "Yang Wood"),   ("Mao", "卯", "Rabbit", "Yin Wood"),
    ("Chen", "辰", "Dragon", "Yang Earth"),("Si", "巳", "Snake", "Yin Fire"),
    ("Wu", "午", "Horse", "Yang Fire"),    ("Wei", "未", "Goat", "Yin Earth"),
    ("Shen", "申", "Monkey", "Yang Metal"),("You", "酉", "Rooster", "Yin Metal"),
    ("Xu", "戌", "Dog", "Yang Earth"),     ("Hai", "亥", "Pig", "Yin Water"),
]

ANIMALS = ["Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake",
           "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig"]

ELEMENTS_CYCLE = ["Wood", "Wood", "Fire", "Fire", "Earth", "Earth",
                   "Metal", "Metal", "Water", "Water"]

ELEMENT_NAMES = ["Wood", "Fire", "Earth", "Metal", "Water"]

# Five Element interactions
GENERATES = {"Wood": "Fire", "Fire": "Earth", "Earth": "Metal", "Metal": "Water", "Water": "Wood"}
CONTROLS = {"Wood": "Earth", "Earth": "Water", "Water": "Fire", "Fire": "Metal", "Metal": "Wood"}

# Hidden stems in each branch
HIDDEN_STEMS = {
    0: [8],        # Zi: Gui(Water)→ actually index 9 is Gui. Let me fix
}
# Actually let me use proper hidden stems
BRANCH_HIDDEN_STEMS = {
    "Zi":     ["Gui"],
    "Chou":   ["Ji", "Gui", "Xin"],
    "Yin":    ["Jia", "Bing", "Wu"],
    "Mao":    ["Yi"],
    "Chen":   ["Wu", "Yi", "Gui"],
    "Si":     ["Bing", "Wu", "Geng"],
    "Wu":     ["Ding", "Ji"],
    "Wei":    ["Ji", "Ding", "Yi"],
    "Shen":   ["Geng", "Ren", "Wu"],
    "You":    ["Xin"],
    "Xu":     ["Wu", "Xin", "Ding"],
    "Hai":    ["Ren", "Jia"],
}

# Solar term dates (approximate — month boundaries for BaZi)
# Month 1 (Tiger): Feb 4, Month 2 (Rabbit): Mar 6, etc.
SOLAR_TERM_STARTS = [
    (2, 4),   # Month 1: Li Chun (Start of Spring)
    (3, 6),   # Month 2: Jing Zhe
    (4, 5),   # Month 3: Qing Ming
    (5, 6),   # Month 4: Li Xia
    (6, 6),   # Month 5: Mang Zhong
    (7, 7),   # Month 6: Xiao Shu
    (8, 7),   # Month 7: Li Qiu
    (9, 8),   # Month 8: Bai Lu
    (10, 8),  # Month 9: Han Lu
    (11, 7),  # Month 10: Li Dong
    (12, 7),  # Month 11: Da Xue
    (1, 6),   # Month 12: Xiao Han
]


class BaZiChart:
    """
    Four Pillars of Destiny (八字) Calculator.

    Usage:
        chart = BaZiChart(datetime(1990, 5, 15, 14, 30))
        report = chart.generate_report()
    """

    def __init__(self, birth_datetime: datetime):
        self.birth_dt = birth_datetime
        self._pillars = None

    def _ensure_calculated(self):
        if self._pillars is not None:
            return
        self._calculate_pillars()

    def _calculate_pillars(self):
        """Calculate all four pillars."""
        year_stem, year_branch = self._year_pillar()
        month_stem, month_branch = self._month_pillar(year_stem)
        day_stem, day_branch = self._day_pillar()
        hour_stem, hour_branch = self._hour_pillar(day_stem)

        self._pillars = {
            'year': {'stem': year_stem, 'branch': year_branch},
            'month': {'stem': month_stem, 'branch': month_branch},
            'day': {'stem': day_stem, 'branch': day_branch},
            'hour': {'stem': hour_stem, 'branch': hour_branch},
        }

    def _year_pillar(self) -> tuple:
        """Calculate Year Pillar. Chinese year starts ~Feb 4."""
        year = self.birth_dt.year
        # If before Feb 4, use previous year
        if self.birth_dt.month < 2 or (self.birth_dt.month == 2 and self.birth_dt.day < 4):
            year -= 1

        # Stem: (year - 4) % 10
        stem_idx = (year - 4) % 10
        # Branch: (year - 4) % 12
        branch_idx = (year - 4) % 12

        return stem_idx, branch_idx

    def _month_pillar(self, year_stem: int) -> tuple:
        """Calculate Month Pillar based on solar terms."""
        m = self.birth_dt.month
        d = self.birth_dt.day

        # Find Chinese month (1-12 based on solar terms)
        chinese_month = 0
        for i, (sm, sd) in enumerate(SOLAR_TERM_STARTS):
            if i < 11:
                nm, nd = SOLAR_TERM_STARTS[i + 1]
            else:
                nm, nd = SOLAR_TERM_STARTS[0]

            if sm == m and d >= sd:
                chinese_month = i + 1
                break
            elif sm == m - 1 or (sm == 12 and m == 1):
                chinese_month = i + 1

        if chinese_month == 0:
            chinese_month = 1

        # Month stem depends on year stem
        # Formula: (year_stem * 2 + chinese_month) % 10
        month_stem = (year_stem * 2 + chinese_month) % 10

        # Month branch: Tiger(2) = month 1, Rabbit(3) = month 2, etc.
        month_branch = (chinese_month + 1) % 12

        return month_stem, month_branch

    def _day_pillar(self) -> tuple:
        """
        Calculate Day Pillar using a reference date method.
        Reference: Jan 1, 1900 = Jia Zi (Stem 0, Branch 0) — offset by known value.
        """
        # Days from reference date (Jan 1, 1900)
        ref = date(1900, 1, 1)
        target = date(self.birth_dt.year, self.birth_dt.month, self.birth_dt.day)
        delta = (target - ref).days

        # Jan 1, 1900 is Jia Chen (stem=0, branch=4) in the sexagenary cycle
        # Adjusted reference: stem offset = 0, branch offset = 4
        stem_idx = (delta + 0) % 10   # Jia = 0
        branch_idx = (delta + 4) % 12  # Chen = 4

        return stem_idx, branch_idx

    def _hour_pillar(self, day_stem: int) -> tuple:
        """
        Calculate Hour Pillar.
        Chinese hours are 2-hour blocks: 23:00-01:00 = Zi, 01:00-03:00 = Chou, etc.
        """
        h = self.birth_dt.hour
        # Convert to Chinese hour index
        if h == 23 or h == 0:
            hour_branch = 0  # Zi
        else:
            hour_branch = ((h + 1) // 2) % 12

        # Hour stem depends on day stem
        # Formula: (day_stem * 2 + hour_branch) % 10
        hour_stem = (day_stem * 2 + hour_branch) % 10

        return hour_stem, hour_branch

    # ═══════════════════════════════════════════════════════════════
    # PUBLIC API
    # ═══════════════════════════════════════════════════════════════

    def get_four_pillars(self) -> Dict:
        """Get all four pillars with full details."""
        self._ensure_calculated()
        result = {}
        for pillar_name in ['year', 'month', 'day', 'hour']:
            p = self._pillars[pillar_name]
            si = p['stem']
            bi = p['branch']
            stem_info = HEAVENLY_STEMS[si]
            branch_info = EARTHLY_BRANCHES[bi]
            stem_element = ELEMENTS_CYCLE[si]
            polarity = "Yang" if si % 2 == 0 else "Yin"

            result[pillar_name] = {
                'stem': {'name': stem_info[0], 'chinese': stem_info[1],
                         'element': stem_element, 'polarity': polarity,
                         'full': stem_info[2]},
                'branch': {'name': branch_info[0], 'chinese': branch_info[1],
                           'animal': branch_info[2], 'element': branch_info[3].split()[1],
                           'full': branch_info[3]},
                'hidden_stems': BRANCH_HIDDEN_STEMS.get(branch_info[0], []),
                'sexagenary': f"{stem_info[0]} {branch_info[0]}",
            }
        return result

    def get_day_master(self) -> Dict:
        """The Day Stem = the self. Most important element in BaZi."""
        self._ensure_calculated()
        si = self._pillars['day']['stem']
        stem = HEAVENLY_STEMS[si]
        element = ELEMENTS_CYCLE[si]
        polarity = "Yang" if si % 2 == 0 else "Yin"

        descriptions = {
            "Yang Wood": "Like a tall tree — upright, ambitious, benevolent, can be rigid",
            "Yin Wood": "Like a vine or flower — flexible, artistic, adaptable, gentle",
            "Yang Fire": "Like the sun — radiant, passionate, generous, can be domineering",
            "Yin Fire": "Like a candle — warm, refined, intelligent, can be anxious",
            "Yang Earth": "Like a mountain — stable, trustworthy, stubborn, patient",
            "Yin Earth": "Like a garden — nurturing, resourceful, adaptable, supportive",
            "Yang Metal": "Like a sword — decisive, righteous, disciplined, can be harsh",
            "Yin Metal": "Like jewelry — elegant, precise, sensitive, detail-oriented",
            "Yang Water": "Like an ocean — expansive, wise, adventurous, can be reckless",
            "Yin Water": "Like rain or dew — gentle, intuitive, imaginative, perceptive",
        }

        return {
            'stem': stem[0],
            'chinese': stem[1],
            'element': element,
            'polarity': polarity,
            'full_name': stem[2],
            'description': descriptions.get(stem[2], ''),
        }

    def get_animal_sign(self) -> Dict:
        """Chinese zodiac animal sign (year-based)."""
        self._ensure_calculated()
        bi = self._pillars['year']['branch']
        branch = EARTHLY_BRANCHES[bi]
        animal = branch[2]

        year = self.birth_dt.year
        if self.birth_dt.month < 2 or (self.birth_dt.month == 2 and self.birth_dt.day < 4):
            year -= 1

        si = self._pillars['year']['stem']
        element = ELEMENTS_CYCLE[si]
        polarity = "Yang" if si % 2 == 0 else "Yin"

        return {
            'animal': animal,
            'element': element,
            'polarity': polarity,
            'full_sign': f"{element} {animal}",
            'chinese_year': year,
        }

    def get_element_balance(self) -> Dict:
        """Count elements across all four pillars (stems + branches)."""
        self._ensure_calculated()
        counts = {e: 0 for e in ELEMENT_NAMES}

        for pillar_name in ['year', 'month', 'day', 'hour']:
            p = self._pillars[pillar_name]
            # Stem element
            stem_element = ELEMENTS_CYCLE[p['stem']]
            counts[stem_element] += 1
            # Branch element
            branch_info = EARTHLY_BRANCHES[p['branch']]
            branch_element = branch_info[3].split()[1]
            counts[branch_element] += 1

        day_master_element = ELEMENTS_CYCLE[self._pillars['day']['stem']]
        strong = counts[day_master_element] >= 3
        dominant = max(counts, key=counts.get)
        weakest = min(counts, key=counts.get)

        # Favorable element (what Day Master needs)
        if strong:
            # Strong DM needs what it generates or what controls it
            favorable = CONTROLS.get(day_master_element, day_master_element)
        else:
            # Weak DM needs same element or what generates it
            favorable = day_master_element

        return {
            'counts': counts,
            'day_master_element': day_master_element,
            'day_master_strength': 'Strong' if strong else 'Weak',
            'dominant_element': dominant,
            'weakest_element': weakest,
            'favorable_element': favorable,
            'lucky_color': self._element_color(favorable),
            'lucky_direction': self._element_direction(favorable),
        }

    def _element_color(self, element: str) -> str:
        return {"Wood": "Green", "Fire": "Red", "Earth": "Yellow/Brown",
                "Metal": "White/Gold", "Water": "Blue/Black"}.get(element, "")

    def _element_direction(self, element: str) -> str:
        return {"Wood": "East", "Fire": "South", "Earth": "Center",
                "Metal": "West", "Water": "North"}.get(element, "")

    def get_ten_gods(self) -> Dict:
        """
        Ten Gods (十神) — relationship of each stem to the Day Master.
        This determines career, relationships, authority, creativity, etc.
        """
        self._ensure_calculated()
        dm_idx = self._pillars['day']['stem']
        dm_element = ELEMENTS_CYCLE[dm_idx]
        dm_polarity = "Yang" if dm_idx % 2 == 0 else "Yin"

        god_names = {
            ('same', 'same_polarity'): 'Companion (比肩)',
            ('same', 'diff_polarity'): 'Rob Wealth (劫财)',
            ('generates', 'same_polarity'): 'Eating God (食神)',
            ('generates', 'diff_polarity'): 'Hurting Officer (伤官)',
            ('generated_by', 'same_polarity'): 'Indirect Resource (偏印)',
            ('generated_by', 'diff_polarity'): 'Direct Resource (正印)',
            ('controls', 'same_polarity'): 'Indirect Wealth (偏财)',
            ('controls', 'diff_polarity'): 'Direct Wealth (正财)',
            ('controlled_by', 'same_polarity'): '7 Killings (七杀)',
            ('controlled_by', 'diff_polarity'): 'Direct Officer (正官)',
        }

        result = {}
        for pillar_name in ['year', 'month', 'day', 'hour']:
            si = self._pillars[pillar_name]['stem']
            if pillar_name == 'day':
                result[pillar_name] = 'Day Master (日主)'
                continue

            other_element = ELEMENTS_CYCLE[si]
            other_polarity = "Yang" if si % 2 == 0 else "Yin"

            # Determine relationship
            if other_element == dm_element:
                relation = 'same'
            elif GENERATES.get(dm_element) == other_element:
                relation = 'generates'
            elif GENERATES.get(other_element) == dm_element:
                relation = 'generated_by'
            elif CONTROLS.get(dm_element) == other_element:
                relation = 'controls'
            else:
                relation = 'controlled_by'

            polarity_match = 'same_polarity' if dm_polarity == other_polarity else 'diff_polarity'
            god = god_names.get((relation, polarity_match), 'Unknown')
            result[pillar_name] = god

        return result

    def get_luck_periods(self, count: int = 8, gender: str = "male") -> List[Dict]:
        """
        Da Yun (大运) — 10-year luck periods.
        Direction: Yang year stem + male = forward, Yang year stem + female = backward.
                   Yin year stem + male = backward, Yin year stem + female = forward.
        """
        self._ensure_calculated()
        year_stem = self._pillars['year']['stem']
        month_stem = self._pillars['month']['stem']
        month_branch = self._pillars['month']['branch']

        # Yang stem (even index) + male = forward, Yin stem (odd) + male = backward
        yang_stem = (year_stem % 2 == 0)
        is_male = gender.lower() in ('male', 'm', 'man', 'boy')
        forward = (yang_stem and is_male) or (not yang_stem and not is_male)

        # Da Yun onset (起运 / qǐ yùn): the real luck-onset age, from the distance
        # between birth and the adjacent solar term ÷ 3 — NOT a flat 10. Pre-onset
        # childhood is ruled by Xiao Yun, so the first pillar starts at `onset`,
        # then +10 each decade. Fallback to 0 only if the ephemeris call fails.
        try:
            from .extended import calculate_dayun_onset
            onset = calculate_dayun_onset(self.birth_dt, year_stem, gender).get('onset_age', 0) or 0
        except Exception:
            onset = 0
        base_age = int(round(onset))

        periods = []
        current_stem = month_stem
        current_branch = month_branch

        for i in range(count):
            if forward:
                current_stem = (current_stem + 1) % 10
                current_branch = (current_branch + 1) % 12
            else:
                current_stem = (current_stem - 1) % 10
                current_branch = (current_branch - 1) % 12

            stem_info = HEAVENLY_STEMS[current_stem]
            branch_info = EARTHLY_BRANCHES[current_branch]
            start_age = base_age + i * 10

            periods.append({
                'period': i + 1,
                'start_age': start_age,
                'end_age': start_age + 9,
                'stem': stem_info[0],
                'branch': branch_info[0],
                'animal': branch_info[2],
                'element': stem_info[2],
                'pillar': f"{stem_info[0]} {branch_info[0]}",
            })

        return periods

    def generate_report(self) -> Dict:
        """Complete BaZi report."""
        four_pillars = self.get_four_pillars()
        day_master = self.get_day_master()
        animal = self.get_animal_sign()
        elements = self.get_element_balance()
        ten_gods = self.get_ten_gods()
        luck_periods = self.get_luck_periods()

        return {
            'system': 'Chinese Astrology (BaZi / Four Pillars)',
            'birth': self.birth_dt.isoformat(),
            'four_pillars': four_pillars,
            'day_master': day_master,
            'animal_sign': animal,
            'element_balance': elements,
            'ten_gods': ten_gods,
            'luck_periods': luck_periods,
        }
