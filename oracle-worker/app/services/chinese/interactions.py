"""
CHINESE ASTROLOGY — BRANCH INTERACTIONS
The Six Clashes, Six Harmonies, Three Harmonies, Three Punishments,
Six Harms, and Destruction — these are the CORE of BaZi reading.

Without these, BaZi is just a list of elements.
With these, BaZi reveals the dynamics between pillars — where conflict,
support, and transformation live.
"""

from typing import Dict, List
from .bazi import BaZiChart, EARTHLY_BRANCHES

# Branch names for lookup
BRANCH_NAMES = [eb[0] for eb in EARTHLY_BRANCHES]  # Zi, Chou, Yin, Mao, ...
BRANCH_ANIMALS = [eb[2] for eb in EARTHLY_BRANCHES]

# ═══════════════════════════════════════════════════════════════
# SIX CLASHES (六冲) — Opposite branches that conflict
# ═══════════════════════════════════════════════════════════════

SIX_CLASHES = [
    (0, 6, "Zi-Wu", "Rat-Horse", "Water vs Fire: emotional/passion conflict"),
    (1, 7, "Chou-Wei", "Ox-Goat", "Earth vs Earth: stubbornness, values clash"),
    (2, 8, "Yin-Shen", "Tiger-Monkey", "Wood vs Metal: control/freedom tension"),
    (3, 9, "Mao-You", "Rabbit-Rooster", "Wood vs Metal: clash of aesthetics vs precision"),
    (4, 10, "Chen-Xu", "Dragon-Dog", "Earth vs Earth: power struggle"),
    (5, 11, "Si-Hai", "Snake-Pig", "Fire vs Water: wisdom vs instinct tension"),
]

# ═══════════════════════════════════════════════════════════════
# SIX HARMONIES (六合) — Pairs that unite and transform
# ═══════════════════════════════════════════════════════════════

SIX_HARMONIES = [
    (0, 1, "Zi-Chou", "Rat-Ox", "Earth", "Stable, productive bond"),
    (2, 11, "Yin-Hai", "Tiger-Pig", "Wood", "Growth and benevolence"),
    (3, 10, "Mao-Xu", "Rabbit-Dog", "Fire", "Warm loyalty and devotion"),
    (4, 9, "Chen-You", "Dragon-Rooster", "Metal", "Precision and ambition"),
    (5, 8, "Si-Shen", "Snake-Monkey", "Water", "Intelligence and adaptability"),
    (6, 7, "Wu-Wei", "Horse-Goat", "Fire", "Passion and creativity"),
]

# ═══════════════════════════════════════════════════════════════
# THREE HARMONIES (三合) — Elemental triads that empower
# ═══════════════════════════════════════════════════════════════

THREE_HARMONIES = [
    ((8, 0, 4), "Shen-Zi-Chen", "Monkey-Rat-Dragon", "Water", "Wisdom, strategy, flow"),
    ((2, 6, 10), "Yin-Wu-Xu", "Tiger-Horse-Dog", "Fire", "Passion, courage, action"),
    ((5, 9, 1), "Si-You-Chou", "Snake-Rooster-Ox", "Metal", "Discipline, precision, wealth"),
    ((11, 3, 7), "Hai-Mao-Wei", "Pig-Rabbit-Goat", "Wood", "Growth, creativity, kindness"),
]

# ═══════════════════════════════════════════════════════════════
# THREE PUNISHMENTS (三刑) — Karmic friction patterns
# ═══════════════════════════════════════════════════════════════

THREE_PUNISHMENTS = [
    ((2, 5, 8), "Yin-Si-Shen", "Tiger-Snake-Monkey", "Ungrateful Punishment",
     "Betrayal dynamics — giving much but receiving little"),
    ((1, 10, 7), "Chou-Xu-Wei", "Ox-Dog-Goat", "Bullying Punishment",
     "Power dynamics — oppression and resentment"),
    ((0, 3), "Zi-Mao", "Rat-Rabbit", "Rude Punishment",
     "Boundary violations — disrespect and rudeness"),
    ((4, 4), "Chen-Chen", "Dragon-Dragon", "Self Punishment",
     "Self-destructive patterns — inner conflict"),
    ((6, 6), "Wu-Wu", "Horse-Horse", "Self Punishment", "Restless self-sabotage"),
    ((9, 9), "You-You", "Rooster-Rooster", "Self Punishment", "Perfectionism turned inward"),
    ((11, 11), "Hai-Hai", "Pig-Pig", "Self Punishment", "Over-indulgence"),
]

# ═══════════════════════════════════════════════════════════════
# SIX HARMS (六害) — Hidden damage between branches
# ═══════════════════════════════════════════════════════════════

SIX_HARMS = [
    (0, 7, "Zi-Wei", "Rat-Goat", "Emotional manipulation"),
    (1, 6, "Chou-Wu", "Ox-Horse", "Broken trust"),
    (2, 5, "Yin-Si", "Tiger-Snake", "Hidden jealousy"),
    (3, 4, "Mao-Chen", "Rabbit-Dragon", "Undermining each other"),
    (8, 11, "Shen-Hai", "Monkey-Pig", "Deception"),
    (9, 10, "You-Xu", "Rooster-Dog", "Constant friction"),
]

# ═══════════════════════════════════════════════════════════════
# DESTRUCTION (破) — Minor destabilization
# ═══════════════════════════════════════════════════════════════

DESTRUCTIONS = [
    (0, 9, "Zi-You", "Rat-Rooster"),
    (1, 4, "Chou-Chen", "Ox-Dragon"),
    (2, 11, "Yin-Hai", "Tiger-Pig"),
    (3, 6, "Mao-Wu", "Rabbit-Horse"),
    (5, 8, "Si-Shen", "Snake-Monkey"),
    (7, 10, "Wei-Xu", "Goat-Dog"),
]


class BranchInteractions:
    """
    Analyze all branch interactions within a BaZi chart.
    This is where the real BaZi reading happens.
    """

    def __init__(self, chart: BaZiChart):
        self.chart = chart
        chart._ensure_calculated()
        self._pillars = chart._pillars
        self._branches = [
            self._pillars['year']['branch'],
            self._pillars['month']['branch'],
            self._pillars['day']['branch'],
            self._pillars['hour']['branch'],
        ]
        self._pillar_names = ['year', 'month', 'day', 'hour']

    def _branch_pairs(self) -> List[tuple]:
        """Generate all pairs of branches from the four pillars."""
        pairs = []
        for i in range(4):
            for j in range(i + 1, 4):
                pairs.append((i, j, self._branches[i], self._branches[j]))
        return pairs

    def check_clashes(self) -> List[Dict]:
        """Find all Six Clashes in the chart."""
        results = []
        for pi, pj, bi, bj in self._branch_pairs():
            for b1, b2, chinese, animals, meaning in SIX_CLASHES:
                if (bi == b1 and bj == b2) or (bi == b2 and bj == b1):
                    results.append({
                        'type': 'Clash (冲)',
                        'pillars': [self._pillar_names[pi], self._pillar_names[pj]],
                        'branches': animals,
                        'chinese': chinese,
                        'meaning': meaning,
                        'severity': 'High',
                    })
        return results

    def check_harmonies(self) -> List[Dict]:
        """Find all Six Harmonies in the chart."""
        results = []
        for pi, pj, bi, bj in self._branch_pairs():
            for b1, b2, chinese, animals, element, meaning in SIX_HARMONIES:
                if (bi == b1 and bj == b2) or (bi == b2 and bj == b1):
                    results.append({
                        'type': 'Harmony (合)',
                        'pillars': [self._pillar_names[pi], self._pillar_names[pj]],
                        'branches': animals,
                        'transforms_to': element,
                        'meaning': meaning,
                    })
        return results

    def check_three_harmonies(self) -> List[Dict]:
        """Find Three Harmony triads."""
        results = []
        branch_set = set(self._branches)
        for trio, chinese, animals, element, meaning in THREE_HARMONIES:
            trio_set = set(trio)
            overlap = branch_set & trio_set
            if len(overlap) >= 2:
                completeness = 'Complete' if len(overlap) == 3 else 'Partial (2 of 3)'
                results.append({
                    'type': 'Three Harmony (三合)',
                    'branches': animals,
                    'element': element,
                    'completeness': completeness,
                    'meaning': meaning,
                })
        return results

    def check_punishments(self) -> List[Dict]:
        """Find Three Punishments."""
        results = []
        branch_set = set(self._branches)

        for entry in THREE_PUNISHMENTS:
            trio = entry[0]
            chinese = entry[1]
            animals = entry[2]
            punishment_type = entry[3]
            meaning = entry[4]

            trio_set = set(trio) if isinstance(trio, tuple) else {trio}
            overlap = branch_set & trio_set

            if len(trio_set) == 1:
                # Self-punishment: count how many times this branch appears
                count = self._branches.count(list(trio_set)[0])
                if count >= 2:
                    results.append({
                        'type': f'Self Punishment (自刑)',
                        'branches': animals,
                        'punishment': punishment_type,
                        'meaning': meaning,
                        'severity': 'Medium',
                    })
            elif len(overlap) >= 2:
                results.append({
                    'type': f'Punishment (刑)',
                    'branches': animals,
                    'punishment': punishment_type,
                    'meaning': meaning,
                    'severity': 'High' if len(overlap) == len(trio_set) else 'Medium',
                })
        return results

    def check_harms(self) -> List[Dict]:
        """Find Six Harms."""
        results = []
        for pi, pj, bi, bj in self._branch_pairs():
            for b1, b2, chinese, animals, meaning in SIX_HARMS:
                if (bi == b1 and bj == b2) or (bi == b2 and bj == b1):
                    results.append({
                        'type': 'Harm (害)',
                        'pillars': [self._pillar_names[pi], self._pillar_names[pj]],
                        'branches': animals,
                        'meaning': meaning,
                    })
        return results

    def analyze_all(self) -> Dict:
        """Complete branch interaction analysis."""
        clashes = self.check_clashes()
        harmonies = self.check_harmonies()
        three_harm = self.check_three_harmonies()
        punishments = self.check_punishments()
        harms = self.check_harms()

        total_positive = len(harmonies) + len(three_harm)
        total_negative = len(clashes) + len(punishments) + len(harms)

        if total_negative == 0 and total_positive > 0:
            overall = "Harmonious chart — branches support each other"
        elif total_negative > total_positive:
            overall = "Turbulent chart — significant internal conflicts to navigate"
        elif total_positive > total_negative:
            overall = "Mostly supportive — some tension creates growth"
        else:
            overall = "Balanced — equal forces of harmony and challenge"

        return {
            'clashes': clashes,
            'harmonies': harmonies,
            'three_harmonies': three_harm,
            'punishments': punishments,
            'harms': harms,
            'summary': {
                'positive_interactions': total_positive,
                'negative_interactions': total_negative,
                'overall': overall,
            },
        }


# ═══════════════════════════════════════════════════════════════
# STEM CLASHES (天干相冲) — Heavenly Stem conflicts
# ═══════════════════════════════════════════════════════════════

STEM_CLASHES = [
    (0, 4, "Jia-Wu", "Yang Wood vs Yang Earth", "Authority challenge — control vs growth"),
    (1, 5, "Yi-Ji", "Yin Wood vs Yin Earth", "Quiet undermining — passive conflict"),
    (2, 6, "Bing-Geng", "Yang Fire vs Yang Metal", "Open confrontation — will vs discipline"),
    (3, 7, "Ding-Xin", "Yin Fire vs Yin Metal", "Subtle tension — sensitivity vs precision"),
    (4, 8, "Wu-Ren", "Yang Earth vs Yang Water", "Stability vs change — dam vs flood"),
    (5, 9, "Ji-Gui", "Yin Earth vs Yin Water", "Quiet erosion — values slowly undermined"),
]

# ═══════════════════════════════════════════════════════════════
# STEM COMBINATIONS (天干合) — Heavenly Stem unions
# ═══════════════════════════════════════════════════════════════

STEM_COMBINATIONS = [
    (0, 5, "Jia-Ji", "Wood + Earth → Earth", "Righteous union — loyalty and duty"),
    (1, 6, "Yi-Geng", "Wood + Metal → Metal", "Passionate union — beauty and justice"),
    (2, 7, "Bing-Xin", "Fire + Metal → Water", "Devotion union — warmth and elegance"),
    (3, 8, "Ding-Ren", "Fire + Water → Wood", "Passionate bond — intensity and depth"),
    (4, 9, "Wu-Gui", "Earth + Water → Fire", "Soulmate union — grounding and intuition"),
]


# ═══════════════════════════════════════════════════════════════
# EMPTY / VOID BRANCHES (空亡 Kong Wang)
# ═══════════════════════════════════════════════════════════════

def calculate_empty_branches(day_stem: int, day_branch: int) -> list:
    """
    Kong Wang (空亡) — Empty/Void branches.
    Based on the Day Pillar's position in the sexagenary cycle.
    The two branches left over in each 10-day cycle are 'empty'.
    
    Formula: Sexagenary number = (stem + branch) in the 60 cycle
    The two branches (day_branch + 10) and (day_branch + 11) mod 12 are void.
    Actually: The empty branches are determined by the JiaZi cycle position.
    """
    # Find which Jia-Zi group the day pillar belongs to
    # Each group starts with Jia (stem=0) and covers 10 days
    # The pillar's offset from the nearest Jia determines which branches are void
    stem_offset = day_stem  # 0=Jia, 1=Yi, ...
    # The two void branches are: (day_branch - stem_offset + 10) % 12 and (day_branch - stem_offset + 11) % 12
    # Actually, standard formula: void branches are the two NOT used in the current 10-stem set
    # Starting branch of the group: day_branch - stem_offset (mod 12)
    group_start = (day_branch - stem_offset) % 12
    # The 10 stems pair with branches group_start through group_start+9
    used_branches = set((group_start + i) % 12 for i in range(10))
    all_branches = set(range(12))
    empty = all_branches - used_branches
    return sorted(empty)


class StemInteractions:
    """Analyze Heavenly Stem interactions in a BaZi chart."""

    def __init__(self, chart):
        self.chart = chart
        chart._ensure_calculated()
        self._pillars = chart._pillars
        self._stems = [
            self._pillars['year']['stem'],
            self._pillars['month']['stem'],
            self._pillars['day']['stem'],
            self._pillars['hour']['stem'],
        ]
        self._pillar_names = ['year', 'month', 'day', 'hour']

    def check_stem_clashes(self) -> List[Dict]:
        """Find Heavenly Stem clashes."""
        results = []
        for i in range(4):
            for j in range(i + 1, 4):
                si, sj = self._stems[i], self._stems[j]
                for s1, s2, chinese, nature, meaning in STEM_CLASHES:
                    if (si == s1 and sj == s2) or (si == s2 and sj == s1):
                        results.append({
                            'type': 'Stem Clash (冲)',
                            'pillars': [self._pillar_names[i], self._pillar_names[j]],
                            'stems': chinese,
                            'nature': nature,
                            'meaning': meaning,
                        })
        return results

    def check_stem_combinations(self) -> List[Dict]:
        """Find Heavenly Stem combinations (unions)."""
        results = []
        for i in range(4):
            for j in range(i + 1, 4):
                si, sj = self._stems[i], self._stems[j]
                for s1, s2, chinese, transform, meaning in STEM_COMBINATIONS:
                    if (si == s1 and sj == s2) or (si == s2 and sj == s1):
                        results.append({
                            'type': 'Stem Combination (合)',
                            'pillars': [self._pillar_names[i], self._pillar_names[j]],
                            'stems': chinese,
                            'transforms_to': transform,
                            'meaning': meaning,
                        })
        return results

    def check_empty_branches(self) -> Dict:
        """Check for empty/void branches (Kong Wang 空亡)."""
        day_stem = self._pillars['day']['stem']
        day_branch = self._pillars['day']['branch']
        empty = calculate_empty_branches(day_stem, day_branch)

        from .bazi import EARTHLY_BRANCHES
        empty_animals = [EARTHLY_BRANCHES[b][2] for b in empty]

        # Check if any pillar branch is empty
        affected = []
        branches = [self._pillars[p]['branch'] for p in self._pillar_names]
        for i, pillar in enumerate(self._pillar_names):
            if branches[i] in empty:
                affected.append({
                    'pillar': pillar,
                    'animal': EARTHLY_BRANCHES[branches[i]][2],
                    'meaning': f'{pillar} pillar is void — its energy is weakened or unreliable',
                })

        return {
            'empty_branches': empty_animals,
            'affected_pillars': affected,
            'has_void': len(affected) > 0,
            'interpretation': 'Void branches indicate areas of life that feel empty or unreliable until activated by luck period or annual energy' if affected else 'No pillar branches are void — chart pillars are all solidly grounded',
        }

    def analyze_all_stems(self) -> Dict:
        """Complete stem interaction analysis."""
        clashes = self.check_stem_clashes()
        combos = self.check_stem_combinations()
        empty = self.check_empty_branches()

        return {
            'stem_clashes': clashes,
            'stem_combinations': combos,
            'empty_branches': empty,
        }
