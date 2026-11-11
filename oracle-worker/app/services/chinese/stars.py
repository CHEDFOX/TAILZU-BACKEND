"""
CHINESE ASTROLOGY — SYMBOLIC STARS & ANNUAL LUCK
Noble Stars (天乙贵人), Peach Blossom (桃花), Traveling Horse (驿马),
Academic Star (文昌), and Annual Luck (流年) overlay.
"""

from datetime import datetime
from typing import Dict, List
# DASHA_SEQUENCE was imported here and never used. It is a Vimshottari term —
# it lives in kp/kp_horary.py and has never existed in bazi.py — so this line
# raised ImportError the moment anything touched AnnualLuck, and the Chinese
# annual_luck section was dropped from every briefing that asked for it.
from .bazi import BaZiChart, EARTHLY_BRANCHES, HEAVENLY_STEMS, \
    ELEMENTS_CYCLE, GENERATES, CONTROLS

BRANCH_NAMES = [eb[0] for eb in EARTHLY_BRANCHES]
BRANCH_ANIMALS = [eb[2] for eb in EARTHLY_BRANCHES]


# ═══════════════════════════════════════════════════════════════
# SYMBOLIC STARS
# ═══════════════════════════════════════════════════════════════

# Tian Yi Gui Ren (天乙贵人) — Nobleman Star
# Keyed by Day Stem index, values are branch indices that carry the Nobleman
NOBLEMAN_TABLE = {
    0: [1, 7],   # Jia → Chou, Wei
    1: [0, 8],   # Yi → Zi, Shen
    2: [11, 9],  # Bing → Hai, You
    3: [11, 9],  # Ding → Hai, You
    4: [1, 7],   # Wu → Chou, Wei
    5: [0, 8],   # Ji → Zi, Shen
    6: [1, 7],   # Geng → Chou, Wei (some schools: Yin, Wu)
    7: [2, 6],   # Xin → Yin, Wu
    8: [3, 5],   # Ren → Mao, Si
    9: [3, 5],   # Gui → Mao, Si
}

# Peach Blossom (桃花) — Romance/Charisma Star
# Keyed by Year Branch or Day Branch
PEACH_BLOSSOM = {
    0: 9, 4: 9, 8: 9,    # Zi/Chen/Shen → You (Rooster)
    2: 3, 6: 3, 10: 3,   # Yin/Wu/Xu → Mao (Rabbit)
    5: 0, 9: 0, 1: 0,    # Si/You/Chou → Zi (Rat)
    11: 6, 3: 6, 7: 6,   # Hai/Mao/Wei → Wu (Horse)
}

# Traveling Horse (驿马) — Movement/Travel Star
TRAVELING_HORSE = {
    0: 2, 4: 2, 8: 2,    # Zi/Chen/Shen → Yin (Tiger)
    2: 8, 6: 8, 10: 8,   # Yin/Wu/Xu → Shen (Monkey)
    5: 11, 9: 11, 1: 11, # Si/You/Chou → Hai (Pig)
    11: 5, 3: 5, 7: 5,   # Hai/Mao/Wei → Si (Snake)
}

# Academic Star (文昌) — Intelligence/Study Star
# Keyed by Day Stem
ACADEMIC_STAR = {
    0: 5,  # Jia → Si
    1: 6,  # Yi → Wu
    2: 8,  # Bing → Shen
    3: 9,  # Ding → You
    4: 8,  # Wu → Shen
    5: 9,  # Ji → You
    6: 11, # Geng → Hai
    7: 0,  # Xin → Zi
    8: 2,  # Ren → Yin
    9: 3,  # Gui → Mao
}


class SymbolicStars:
    """Analyze symbolic stars in a BaZi chart."""

    def __init__(self, chart: BaZiChart):
        self.chart = chart
        chart._ensure_calculated()
        self._pillars = chart._pillars

    def _branch_list(self) -> List[int]:
        return [self._pillars[p]['branch'] for p in ['year', 'month', 'day', 'hour']]

    def get_nobleman(self) -> Dict:
        """Check for Nobleman (天乙贵人) — help from influential people."""
        day_stem = self._pillars['day']['stem']
        nobleman_branches = NOBLEMAN_TABLE.get(day_stem, [])
        branches = self._branch_list()

        found = []
        for i, pillar in enumerate(['year', 'month', 'day', 'hour']):
            if branches[i] in nobleman_branches:
                found.append({
                    'pillar': pillar,
                    'branch': BRANCH_ANIMALS[branches[i]],
                    'meaning': f"Nobleman in {pillar} pillar — help from {'elders/society' if pillar == 'year' else 'career/authority' if pillar == 'month' else 'spouse/partner' if pillar == 'day' else 'subordinates/children'}",
                })

        return {
            'star': 'Nobleman (天乙贵人)',
            'present': len(found) > 0,
            'count': len(found),
            'locations': found,
            'interpretation': 'You attract helpful people naturally' if found else 'No nobleman star — must build support networks consciously',
        }

    def get_peach_blossom(self) -> Dict:
        """Check for Peach Blossom (桃花) — romance and charisma."""
        year_branch = self._pillars['year']['branch']
        day_branch = self._pillars['day']['branch']
        branches = self._branch_list()

        peach_from_year = PEACH_BLOSSOM.get(year_branch, -1)
        peach_from_day = PEACH_BLOSSOM.get(day_branch, -1)

        found = []
        for i, pillar in enumerate(['year', 'month', 'day', 'hour']):
            if branches[i] == peach_from_year or branches[i] == peach_from_day:
                found.append({'pillar': pillar, 'branch': BRANCH_ANIMALS[branches[i]]})

        return {
            'star': 'Peach Blossom (桃花)',
            'present': len(found) > 0,
            'count': len(found),
            'locations': found,
            'interpretation': 'Strong romantic charisma and attractiveness' if found else 'Romantic charm develops through effort',
        }

    def get_traveling_horse(self) -> Dict:
        """Check for Traveling Horse (驿马) — movement, travel, change."""
        year_branch = self._pillars['year']['branch']
        branches = self._branch_list()
        horse_branch = TRAVELING_HORSE.get(year_branch, -1)

        found = []
        for i, pillar in enumerate(['year', 'month', 'day', 'hour']):
            if branches[i] == horse_branch:
                found.append({'pillar': pillar, 'branch': BRANCH_ANIMALS[branches[i]]})

        return {
            'star': 'Traveling Horse (驿马)',
            'present': len(found) > 0,
            'locations': found,
            'interpretation': 'Life involves frequent movement, travel, or change of environment' if found else 'More settled life path',
        }

    def get_academic_star(self) -> Dict:
        """Check for Academic Star (文昌) — intelligence and study."""
        day_stem = self._pillars['day']['stem']
        academic_branch = ACADEMIC_STAR.get(day_stem, -1)
        branches = self._branch_list()

        found = []
        for i, pillar in enumerate(['year', 'month', 'day', 'hour']):
            if branches[i] == academic_branch:
                found.append({'pillar': pillar, 'branch': BRANCH_ANIMALS[branches[i]]})

        return {
            'star': 'Academic Star (文昌)',
            'present': len(found) > 0,
            'locations': found,
            'interpretation': 'Natural academic talent and love of learning' if found else 'Knowledge gained through experience more than study',
        }

    def get_sky_happiness(self) -> Dict:
        """Sky Happiness Star (天喜) — joy, celebrations, good news."""
        # Keyed by Year Branch: opposite of Peach Blossom direction
        SKY_HAPPINESS = {
            0: 3, 1: 6, 2: 9, 3: 0, 4: 3, 5: 6, 6: 9, 7: 0, 8: 3, 9: 6, 10: 9, 11: 0
        }
        year_branch = self._pillars['year']['branch']
        target = SKY_HAPPINESS.get(year_branch, -1)
        branches = self._branch_list()
        found = [{'pillar': p, 'branch': BRANCH_ANIMALS[branches[i]]}
                 for i, p in enumerate(['year', 'month', 'day', 'hour']) if branches[i] == target]
        return {
            'star': 'Sky Happiness (天喜)', 'present': len(found) > 0, 'locations': found,
            'interpretation': 'Joy and celebration energy — auspicious for weddings, births' if found else 'Happiness comes through effort',
        }

    def get_funeral_door(self) -> Dict:
        """Funeral Door Star (丧门) — grief, loss, endings."""
        FUNERAL_DOOR = {0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 9, 8: 10, 9: 11, 10: 0, 11: 1}
        year_branch = self._pillars['year']['branch']
        target = FUNERAL_DOOR.get(year_branch, -1)
        branches = self._branch_list()
        found = [{'pillar': p} for i, p in enumerate(['year', 'month', 'day', 'hour']) if branches[i] == target]
        return {
            'star': 'Funeral Door (丧门)', 'present': len(found) > 0,
            'interpretation': 'Sensitivity to loss and endings — but also ability to transform through grief' if found else 'Not present',
        }

    def get_lonesome_star(self) -> Dict:
        """Lonesome Star (孤辰) + Widow Star (寡宿) — solitude tendency."""
        LONESOME = {0: 2, 1: 2, 2: 5, 3: 5, 4: 5, 5: 8, 6: 8, 7: 8, 8: 11, 9: 11, 10: 11, 11: 2}
        WIDOW = {0: 10, 1: 10, 2: 1, 3: 1, 4: 1, 5: 4, 6: 4, 7: 4, 8: 7, 9: 7, 10: 7, 11: 10}
        year_branch = self._pillars['year']['branch']
        branches = self._branch_list()
        lone_target = LONESOME.get(year_branch, -1)
        widow_target = WIDOW.get(year_branch, -1)
        has_lone = any(b == lone_target for b in branches)
        has_widow = any(b == widow_target for b in branches)
        return {
            'star': 'Lonesome/Widow (孤辰/寡宿)',
            'lonesome': has_lone, 'widow': has_widow,
            'present': has_lone or has_widow,
            'interpretation': 'Tendency toward independence and solitude — but also deep self-reliance' if (has_lone or has_widow) else 'Not present',
        }

    def get_bloody_knife(self) -> Dict:
        """Bloody Knife Star (血刃) — injury, surgery, accidents."""
        BLOODY_KNIFE = {0: 9, 1: 6, 2: 3, 3: 0, 4: 9, 5: 6, 6: 3, 7: 0, 8: 9, 9: 6, 10: 3, 11: 0}
        year_branch = self._pillars['year']['branch']
        target = BLOODY_KNIFE.get(year_branch, -1)
        branches = self._branch_list()
        found = any(b == target for b in branches)
        return {
            'star': 'Bloody Knife (血刃)', 'present': found,
            'interpretation': 'Susceptibility to injury or surgery — take extra care with physical safety' if found else 'Not present',
        }

    def analyze_all_stars(self) -> Dict:
        """Get all symbolic stars."""
        return {
            'nobleman': self.get_nobleman(),
            'peach_blossom': self.get_peach_blossom(),
            'traveling_horse': self.get_traveling_horse(),
            'academic_star': self.get_academic_star(),
            'sky_happiness': self.get_sky_happiness(),
            'funeral_door': self.get_funeral_door(),
            'lonesome_widow': self.get_lonesome_star(),
            'bloody_knife': self.get_bloody_knife(),
        }


# ═══════════════════════════════════════════════════════════════
# ANNUAL LUCK (流年) — Year-by-year overlay
# ═══════════════════════════════════════════════════════════════

class AnnualLuck:
    """
    Liu Nian (流年) — how a specific year interacts with the natal chart.
    The annual stem-branch overlays on the natal pillars.
    """

    def __init__(self, chart: BaZiChart):
        self.chart = chart
        chart._ensure_calculated()

    def analyze_year(self, year: int) -> Dict:
        """Analyze how a specific year affects the native."""
        # Year's stem and branch
        year_stem = (year - 4) % 10
        year_branch = (year - 4) % 12
        year_stem_info = HEAVENLY_STEMS[year_stem]
        year_branch_info = EARTHLY_BRANCHES[year_branch]
        year_element = ELEMENTS_CYCLE[year_stem]
        year_animal = year_branch_info[2]

        # Day master
        dm = self.chart.get_day_master()
        dm_element = dm['element']

        # Element relationship to Day Master
        if year_element == dm_element:
            element_relation = "Companion — support and competition"
            score = 60
        elif GENERATES.get(dm_element) == year_element:
            element_relation = "Output — expression, creativity, exhaustion"
            score = 50
        elif GENERATES.get(year_element) == dm_element:
            element_relation = "Resource — support, nourishment, learning"
            score = 80
        elif CONTROLS.get(dm_element) == year_element:
            element_relation = "Wealth — opportunity, also effort"
            score = 70
        elif CONTROLS.get(year_element) == dm_element:
            element_relation = "Authority — pressure, structure, career"
            score = 55
        else:
            element_relation = "Neutral interaction"
            score = 60

        # Check clashes with natal branches
        natal_branches = [self.chart._pillars[p]['branch'] for p in ['year', 'month', 'day', 'hour']]
        clashes = []
        clash_pairs = [(0, 6), (1, 7), (2, 8), (3, 9), (4, 10), (5, 11)]
        for b1, b2 in clash_pairs:
            if year_branch == b1 and any(nb == b2 for nb in natal_branches):
                clashes.append(f"Clashes natal {BRANCH_ANIMALS[b2]}")
                score -= 15
            elif year_branch == b2 and any(nb == b1 for nb in natal_branches):
                clashes.append(f"Clashes natal {BRANCH_ANIMALS[b1]}")
                score -= 15

        # Check harmonies with natal
        harmonies = []
        harmony_pairs = [(0, 1), (2, 11), (3, 10), (4, 9), (5, 8), (6, 7)]
        for b1, b2 in harmony_pairs:
            if year_branch == b1 and any(nb == b2 for nb in natal_branches):
                harmonies.append(f"Harmonizes with natal {BRANCH_ANIMALS[b2]}")
                score += 10
            elif year_branch == b2 and any(nb == b1 for nb in natal_branches):
                harmonies.append(f"Harmonizes with natal {BRANCH_ANIMALS[b1]}")
                score += 10

        score = max(10, min(95, score))

        return {
            'year': year,
            'animal': year_animal,
            'element': year_element,
            'stem': year_stem_info[2],
            'element_relation': element_relation,
            'clashes': clashes,
            'harmonies': harmonies,
            'score': score,
            'outlook': 'Excellent' if score >= 75 else 'Good' if score >= 60 else 'Challenging' if score >= 40 else 'Difficult',
        }

    def forecast_years(self, count: int = 5) -> List[Dict]:
        """Forecast the next N years."""
        current_year = datetime.now().year
        return [self.analyze_year(current_year + i) for i in range(count)]
