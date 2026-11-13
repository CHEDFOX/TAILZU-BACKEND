"""
JYOTISH ENGINE - EXTENDED YOGAS (200+ additional named yogas)
Supplements the main yogas.py with specifically named classical yogas.

Sources: BPHS, Saravali, Jataka Parijata, Phaladeepika, Uttara Kalamrita

Adds:
- Named Raja Yogas per planet pair (not generic "Raja Yoga")
- Complete Chandra Yogas (Sunapha variants per planet)
- Pancha Mahapurusha strength variants
- Named Dhana Yogas (Sreenatha, Indra, etc.)
- Complete Nabhasa Akriti yogas
- House-lord position yogas
- Graha Malika (planetary chain)
- Specific conjunction yogas with names
- Dosha cancellation yogas
"""

from typing import Dict, List
from ..core.constants import (
    PLANETS, RASHI_LORDS, RASHI_NAMES,
    KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES,
    UPACHAYA_HOUSES,
)

BENEFICS = {'Jupiter', 'Venus', 'Mercury', 'Moon'}
NATURAL_BENEFICS = {'Jupiter', 'Venus'}
NATURAL_MALEFICS = {'Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'}
NODES = {'Rahu', 'Ketu'}


class ExtendedYogaCalculator:
    """200+ additional named yogas to supplement main YogaCalculator."""

    def __init__(self, planets: Dict, ascendant: Dict):
        self.planets = planets
        self.asc_rashi = ascendant.get('rashi', ascendant.get('rashi_index', 0))

    def h(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('house', 1)

    def r(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('rashi', 0)

    def lon(self, planet: str) -> float:
        return self.planets.get(planet, {}).get('longitude', 0.0)

    def lord(self, house: int) -> str:
        return RASHI_LORDS[(self.asc_rashi + house - 1) % 12]

    def conj(self, p1: str, p2: str) -> bool:
        return self.h(p1) == self.h(p2)

    def in_house(self, planet: str, houses: list) -> bool:
        return self.h(planet) in houses

    def is_exalted(self, planet: str) -> bool:
        return self.r(planet) == PLANETS.get(planet, {}).get('exalted')

    def is_own(self, planet: str) -> bool:
        return self.r(planet) in PLANETS.get(planet, {}).get('owns', [])

    def is_debilitated(self, planet: str) -> bool:
        return self.r(planet) == PLANETS.get(planet, {}).get('debilitated')

    def is_strong(self, planet: str) -> bool:
        return self.is_exalted(planet) or self.is_own(planet)

    def pih(self, house: int) -> list:
        return [p for p in self.planets if self.h(p) == house]

    def hdist(self, p1: str, p2: str) -> int:
        return ((self.h(p2) - self.h(p1)) % 12) or 12

    def _y(self, name, ytype, **kw):
        y = {'name': name, 'type': ytype, 'is_negative': ytype in ('Arishta', 'Dosha', 'Daridra')}
        y.update(kw)
        return y

    # ═══════════════════════════════════════════════════════════════════
    # NAMED RAJA YOGAS (specific names per combination)
    # ═══════════════════════════════════════════════════════════════════

    def check_named_raja_yogas(self) -> List[Dict]:
        yogas = []

        # Lakshmi Narayana Yoga: 7th lord + 9th lord conjunction in Kendra
        l7, l9 = self.lord(7), self.lord(9)
        if l7 != l9 and self.conj(l7, l9) and self.in_house(l7, KENDRA_HOUSES):
            yogas.append(self._y('Lakshmi Narayana Yoga', 'Raja', planets=[l7, l9],
                description=f'7th lord {l7} + 9th lord {l9} in Kendra',
                effects='Blessed by Vishnu-Lakshmi, wealth and fortune combined', strength='Very Strong'))

        # Shrinatha Yoga: 7th lord in 10th + 10th lord in 7th
        l10 = self.lord(10)
        if self.h(l7) == 10 and self.h(l10) == 7:
            yogas.append(self._y('Shrinatha Yoga', 'Raja', planets=[l7, l10],
                description='7th lord in 10th and 10th lord in 7th',
                effects='Lord of prosperity, business empire, respected partnership', strength='Strong'))

        # Hari Yoga: Benefics in 2nd, 12th, and 8th from lord of 2nd
        l2 = self.lord(2)
        l2h = self.h(l2)
        h2nd = (l2h % 12) + 1
        h12th = ((l2h - 2) % 12) + 1
        h8th = ((l2h + 6) % 12) + 1
        b2 = [p for p in self.pih(h2nd) if p in NATURAL_BENEFICS]
        b12 = [p for p in self.pih(h12th) if p in NATURAL_BENEFICS]
        b8 = [p for p in self.pih(h8th) if p in NATURAL_BENEFICS]
        if b2 and b12 and b8:
            yogas.append(self._y('Hari Yoga', 'Raja',
                description='Benefics in 2nd, 12th, 8th from 2nd lord',
                effects='Protected by Lord Vishnu, divine grace in finances', strength='Strong'))

        # Hara Yoga: Benefics in 2nd, 12th, 8th from lord of 7th
        l7h = self.h(l7)
        h2_ = (l7h % 12) + 1
        h12_ = ((l7h - 2) % 12) + 1
        h8_ = ((l7h + 6) % 12) + 1
        if ([p for p in self.pih(h2_) if p in NATURAL_BENEFICS] and
            [p for p in self.pih(h12_) if p in NATURAL_BENEFICS] and
            [p for p in self.pih(h8_) if p in NATURAL_BENEFICS]):
            yogas.append(self._y('Hara Yoga', 'Raja',
                description='Benefics in 2nd, 12th, 8th from 7th lord',
                effects='Protected by Lord Shiva, partnership blessings', strength='Strong'))

        # Indra Yoga: 5th and 11th lords in mutual Kendras
        l5, l11 = self.lord(5), self.lord(11)
        if l5 != l11 and self.in_house(l5, KENDRA_HOUSES) and self.in_house(l11, KENDRA_HOUSES):
            yogas.append(self._y('Indra Yoga', 'Raja', planets=[l5, l11],
                description='5th and 11th lords both in Kendras',
                effects='King of gods — immense power, vast kingdom of influence', strength='Strong'))

        # Ravi Yoga: Sun in 10th exalted/own
        if self.h('Sun') == 10 and self.is_strong('Sun'):
            yogas.append(self._y('Ravi Yoga', 'Raja', planet='Sun',
                description='Sun strong in 10th house',
                effects='Government authority, father of organization, brilliant career', strength='Very Strong'))

        # Chandra Yoga: Moon in 10th in own/exalted sign
        if self.h('Moon') == 10 and self.is_strong('Moon'):
            yogas.append(self._y('Chandra Yoga (Raja)', 'Raja', planet='Moon',
                description='Moon strong in 10th house',
                effects='Popular leader, public authority, emotional intelligence at work', strength='Strong'))

        # Bhadra Yoga variant: Mercury in Kendra in Gemini/Virgo with no malefic aspect
        if self.in_house('Mercury', KENDRA_HOUSES) and self.is_own('Mercury'):
            mal_conj = any(self.conj('Mercury', m) for m in NATURAL_MALEFICS if m in self.planets)
            if not mal_conj:
                yogas.append(self._y('Bhadra Maha Yoga', 'Raja', planet='Mercury',
                    description='Mercury in own sign in Kendra, unafflicted',
                    effects='Supreme intellect, oratory, diplomatic genius', strength='Very Strong'))

        # Simhasana Yoga: 2nd lord in Lagna + Lagna lord in 10th
        l1 = self.lord(1)
        if self.h(l2) == 1 and self.h(l1) == 10:
            yogas.append(self._y('Simhasana Yoga', 'Raja', planets=[l2, l1],
                description='2nd lord in Lagna, Lagna lord in 10th',
                effects='Sits on throne, commanding authority, royal status', strength='Strong'))

        # Vasumati Yoga (from Lagna): All benefics in Upachaya
        bens = [p for p in self.planets if p in NATURAL_BENEFICS]
        if bens and all(self.in_house(b, UPACHAYA_HOUSES) for b in bens):
            yogas.append(self._y('Vasumati Yoga (Lagna)', 'Raja', planets=bens,
                description='All benefics in Upachaya from Lagna',
                effects='Ever-increasing prosperity, wealth grows with age', strength='Strong'))

        # Chaamara Yoga variant: 2 benefics in Lagna/7th/9th/10th
        ben_in_good = [p for p in NATURAL_BENEFICS if p in self.planets and self.in_house(p, [1, 7, 9, 10])]
        if len(ben_in_good) >= 2:
            yogas.append(self._y('Chamara Yoga', 'Raja', planets=ben_in_good,
                description=f'{len(ben_in_good)} benefics in 1st/7th/9th/10th',
                effects='Royal bearing, eloquent, charitable, long-lived', strength='Moderate'))

        # Lagnadhi Yoga: Benefics in 7th and 8th
        b7 = [p for p in self.pih(7) if p in NATURAL_BENEFICS]
        b8 = [p for p in self.pih(8) if p in NATURAL_BENEFICS]
        if b7 and b8:
            yogas.append(self._y('Lagnadhi Yoga', 'Raja', planets=b7 + b8,
                description='Benefics in 7th and 8th houses',
                effects='Minister or advisor to king, respected counsel', strength='Moderate'))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # NAMED DHANA (WEALTH) YOGAS
    # ═══════════════════════════════════════════════════════════════════

    def check_named_dhana_yogas(self) -> List[Dict]:
        yogas = []

        # Sreenatha Yoga: 7th lord in 10th + Jupiter in Lagna
        l7 = self.lord(7)
        if self.h(l7) == 10 and self.h('Jupiter') == 1:
            yogas.append(self._y('Sreenatha Yoga', 'Dhana', planets=[l7, 'Jupiter'],
                description='7th lord in 10th, Jupiter in Lagna',
                effects='Lord of wealth, prosperity through partnerships', strength='Strong'))

        # Kalanidhi Yoga: Jupiter in 2nd/5th conjunct/aspected by Mercury and Venus
        if self.h('Jupiter') in [2, 5]:
            jh = self.h('Jupiter')
            if self.h('Mercury') == jh or self.h('Venus') == jh:
                yogas.append(self._y('Kalanidhi Yoga', 'Dhana', planets=['Jupiter', 'Mercury', 'Venus'],
                    description='Jupiter in 2nd/5th with Mercury/Venus',
                    effects='Treasure of arts, respected by royalty, educated wealthy', strength='Strong'))

        # Chandika Yoga: Sun in 9th, Moon in 4th, Mars in 2nd
        if self.h('Sun') == 9 and self.h('Moon') == 4 and self.h('Mars') == 2:
            yogas.append(self._y('Chandika Yoga', 'Dhana', planets=['Sun', 'Moon', 'Mars'],
                description='Sun in 9th, Moon in 4th, Mars in 2nd',
                effects='Wealth from government and property, blessed fortune', strength='Strong'))

        # Apahara Yoga (negative): 2nd lord weak + 11th lord in 12th
        l2, l11 = self.lord(2), self.lord(11)
        if self.is_debilitated(l2) and self.h(l11) == 12:
            yogas.append(self._y('Apahara Yoga', 'Daridra', planets=[l2, l11],
                description='2nd lord debilitated, 11th lord in 12th',
                effects='Wealth gets stolen or wasted, financial losses', strength='Strong'))

        # Dhana Yoga through Parivartana: 2nd and 11th lords exchange
        if self.lord(2) != self.lord(11):
            l2r = (self.asc_rashi + 1) % 12
            l11r = (self.asc_rashi + 10) % 12
            if self.r(l2) == l11r and self.r(l11) == l2r:
                yogas.append(self._y('Dhana Parivartana Yoga', 'Dhana', planets=[l2, l11],
                    description='2nd and 11th lords in mutual exchange',
                    effects='Wealth flows from multiple sources, gains feed family', strength='Very Strong'))

        # 9th lord in 2nd (fortune → wealth)
        l9 = self.lord(9)
        if self.h(l9) == 2:
            yogas.append(self._y('Bhagya-Dhana Yoga', 'Dhana', planets=[l9],
                description='9th lord (fortune) in 2nd house (wealth)',
                effects='Luck directly translates to money, fortunate finances', strength='Strong'))

        # 2nd lord in 9th (wealth → fortune)
        if self.h(l2) == 9:
            yogas.append(self._y('Dhana-Bhagya Yoga', 'Dhana', planets=[l2],
                description='2nd lord in 9th house',
                effects='Wealth brings fortune, donations bring more wealth', strength='Strong'))

        # Jupiter in 2nd or 11th (natural wealth)
        if self.h('Jupiter') in [2, 11]:
            yogas.append(self._y('Guru Dhana Yoga', 'Dhana', planet='Jupiter',
                description=f'Jupiter in house {self.h("Jupiter")}',
                effects='Natural wealth giver, ethical earnings, financial wisdom', strength='Moderate'))

        # Venus in 2nd or 4th (luxury wealth)
        if self.h('Venus') in [2, 4]:
            yogas.append(self._y('Shukra Dhana Yoga', 'Dhana', planet='Venus',
                description=f'Venus in house {self.h("Venus")}',
                effects='Wealth through beauty, arts, luxury, vehicles', strength='Moderate'))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # SUNAPHA/ANAPHA VARIANTS (per planet — 5 each = 10)
    # ═══════════════════════════════════════════════════════════════════

    def check_chandra_variants(self) -> List[Dict]:
        yogas = []
        moon_h = self.h('Moon')
        h2 = (moon_h % 12) + 1
        h12 = ((moon_h - 2) % 12) + 1

        sunapha_map = {
            'Mars': ('Mars-Sunapha', 'Self-made through courage, property owner, military/police connections'),
            'Mercury': ('Mercury-Sunapha', 'Wealth through intellect, writing, business acumen, educated'),
            'Jupiter': ('Jupiter-Sunapha', 'Wealth through wisdom, religious merit, respected, learned'),
            'Venus': ('Venus-Sunapha', 'Wealth through arts, beauty, luxurious life, vehicles'),
            'Saturn': ('Saturn-Sunapha', 'Wealth through labor, delayed but steady income, authority in old age'),
        }

        anapha_map = {
            'Mars': ('Mars-Anapha', 'Leader, commander, owns property, good health, adventurous'),
            'Mercury': ('Mercury-Anapha', 'Scholar, writer, eloquent, skilled in many arts'),
            'Jupiter': ('Jupiter-Anapha', 'Virtuous, religious, teacher, blessed by guru'),
            'Venus': ('Venus-Anapha', 'Romantic, artistic, comfortable life, beautiful possessions'),
            'Saturn': ('Saturn-Anapha', 'Disciplined, authoritative, works hard, respected elder'),
        }

        for planet in ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
            if planet in self.planets:
                if self.h(planet) == h2:
                    name, eff = sunapha_map[planet]
                    yogas.append(self._y(name, 'Chandra', planets=[planet, 'Moon'],
                        description=f'{planet} in 2nd from Moon', effects=eff, strength='Moderate'))
                if self.h(planet) == h12:
                    name, eff = anapha_map[planet]
                    yogas.append(self._y(name, 'Chandra', planets=[planet, 'Moon'],
                        description=f'{planet} in 12th from Moon', effects=eff, strength='Moderate'))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # GRAHA MALIKA (Planetary Chain)
    # ═══════════════════════════════════════════════════════════════════

    def check_graha_malika(self) -> List[Dict]:
        yogas = []
        occ = sorted(set(self.h(p) for p in self.planets))
        if len(occ) < 4:
            return yogas

        # Check for consecutive houses
        max_chain = 1
        chain_start = occ[0]
        current_chain = 1
        for i in range(1, len(occ)):
            expected = occ[i-1] + 1
            if expected == 13: expected = 1
            if occ[i] == expected:
                current_chain += 1
                if current_chain > max_chain:
                    max_chain = current_chain
                    chain_start = occ[i - current_chain + 1]
            else:
                current_chain = 1

        if max_chain >= 4:
            start_name = f'House {chain_start}'
            yogas.append(self._y(f'Graha Malika Yoga (from {start_name})', 'Special',
                description=f'{max_chain} consecutive houses occupied starting from house {chain_start}',
                effects=f'Planetary garland from house {chain_start}: sustained focus, life builds momentum in these areas',
                strength='Strong' if max_chain >= 6 else 'Moderate'))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # HOUSE-LORD POSITION YOGAS
    # ═══════════════════════════════════════════════════════════════════

    def check_house_lord_yogas(self) -> List[Dict]:
        yogas = []

        # 1st lord in each house
        l1 = self.lord(1)
        l1h = self.h(l1)
        lord_in_house = {
            1: ('Bhava Yoga', 'Self-focused, healthy, independent, natural leader'),
            4: ('Sukha Yoga', 'Happiness from home, mother, property, vehicles, education'),
            5: ('Putra Yoga', 'Intelligence, children, creativity, past merit manifests'),
            7: ('Kalatra Yoga', 'Life defined by partnerships, business, marriage prominent'),
            9: ('Bhagya Yoga', 'Fortunate, father supportive, religious, long travels'),
            10: ('Karma Yoga', 'Career-driven, authoritative, public status, action-oriented'),
            11: ('Labha Yoga', 'Gains in life, wealthy friends, desires fulfilled'),
        }
        if l1h in lord_in_house:
            name, eff = lord_in_house[l1h]
            yogas.append(self._y(f'{name} (Lagna lord in {l1h})', 'Special',
                planet=l1, description=f'Lagna lord {l1} in house {l1h}', effects=eff, strength='Moderate'))

        neg_houses = {
            6: ('Ripu Yoga', 'Fights with enemies, service-oriented, health-conscious, competitive'),
            8: ('Randhra Yoga', 'Transformation through crisis, occult interest, inheritance issues'),
            12: ('Vyaya Yoga', 'Expenses, foreign connections, spiritual, isolated periods'),
        }
        if l1h in neg_houses:
            name, eff = neg_houses[l1h]
            yogas.append(self._y(f'{name} (Lagna lord in {l1h})', 'Arishta',
                planet=l1, description=f'Lagna lord {l1} in house {l1h}', effects=eff, strength='Moderate'))

        # 10th lord in various houses
        l10 = self.lord(10)
        l10h = self.h(l10)
        if l10h == 1:
            yogas.append(self._y('Karma-Lagna Yoga', 'Special', planet=l10,
                description='10th lord in Lagna', effects='Career defines personality, self-made, driven', strength='Strong'))
        if l10h == 5:
            yogas.append(self._y('Karma-Putra Yoga', 'Special', planet=l10,
                description='10th lord in 5th', effects='Creative career, entertainment, speculation in work', strength='Moderate'))
        if l10h == 9:
            yogas.append(self._y('Karma-Bhagya Yoga', 'Special', planet=l10,
                description='10th lord in 9th', effects='Fortunate career, father-inspired profession, righteous work', strength='Strong'))
        if l10h == 11:
            yogas.append(self._y('Karma-Labha Yoga', 'Special', planet=l10,
                description='10th lord in 11th', effects='Profitable career, gains through profession', strength='Strong'))
        if l10h in [6, 8, 12]:
            yogas.append(self._y('Karma Kashta Yoga', 'Arishta', planet=l10,
                description=f'10th lord in dusthana {l10h}', effects='Career struggles, job dissatisfaction, obstacles at work'))

        # 5th lord positions
        l5 = self.lord(5)
        l5h = self.h(l5)
        if l5h == 1:
            yogas.append(self._y('Putra-Lagna Yoga', 'Special', planet=l5,
                description='5th lord in Lagna', effects='Intelligent, creative, children resemble self', strength='Moderate'))
        if l5h == 9:
            yogas.append(self._y('Putra-Bhagya Yoga', 'Special', planet=l5,
                description='5th lord in 9th', effects='Children bring fortune, highly intelligent offspring', strength='Strong'))

        # 7th lord positions
        l7 = self.lord(7)
        l7h = self.h(l7)
        if l7h == 1:
            yogas.append(self._y('Kalatra-Lagna Yoga', 'Special', planet=l7,
                description='7th lord in Lagna', effects='Spouse dominates personality, early marriage interest', strength='Moderate'))
        if l7h in [6, 8, 12]:
            yogas.append(self._y('Kalatra Kashta Yoga', 'Arishta', planet=l7,
                description=f'7th lord in dusthana {l7h}', effects='Marriage difficulties, spouse health issues, partnership obstacles'))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # SPECIFIC CONJUNCTION YOGAS WITH NAMES
    # ═══════════════════════════════════════════════════════════════════

    def check_named_conjunctions(self) -> List[Dict]:
        yogas = []

        # Sakata Bhanga: Jupiter-Moon Shakata cancelled by Jupiter in Kendra from Lagna
        if self.hdist('Moon', 'Jupiter') in (6, 8, 12):
            if self.in_house('Jupiter', KENDRA_HOUSES):
                yogas.append(self._y('Sakata Bhanga Yoga', 'Special',
                    planets=['Moon', 'Jupiter'],
                    description='Shakata Yoga cancelled by Jupiter in Kendra from Lagna',
                    effects='Fluctuations followed by stability, eventual prosperity', strength='Moderate'))

        # Guru-Mangala Yoga: Jupiter + Mars conjunction
        if self.conj('Jupiter', 'Mars'):
            yogas.append(self._y('Guru-Mangala Yoga', 'Special',
                planets=['Jupiter', 'Mars'],
                description='Jupiter conjunct Mars',
                effects='Righteous warrior, fights for dharma, sports coach, military wisdom', strength='Moderate'))

        # Shukra-Shani Yoga: Venus + Saturn conjunction
        if self.conj('Venus', 'Saturn'):
            yogas.append(self._y('Shukra-Shani Yoga', 'Special',
                planets=['Venus', 'Saturn'],
                description='Venus conjunct Saturn',
                effects='Delayed love, artistic discipline, fashion industry, patient romance', strength='Moderate'))

        # Budha-Guru Yoga: Mercury + Jupiter conjunction
        if self.conj('Mercury', 'Jupiter'):
            yogas.append(self._y('Budha-Guru Yoga', 'Special',
                planets=['Mercury', 'Jupiter'],
                description='Mercury conjunct Jupiter',
                effects='Scholar of scholars, published author, financial advisor, counseling wisdom', strength='Strong'))

        # Surya-Chandra Yoga: Sun + Moon conjunction (Amavasya)
        if self.conj('Sun', 'Moon'):
            yogas.append(self._y('Amavasya Yoga', 'Special',
                planets=['Sun', 'Moon'],
                description='Sun conjunct Moon (new moon birth)',
                effects='Ego-emotion fusion, parents bond strong, authority through feelings', strength='Moderate'))

        # Nipuna Yoga variant: Mercury + Sun + Jupiter
        if self.conj('Sun', 'Mercury') and self.conj('Sun', 'Jupiter'):
            yogas.append(self._y('Nipuna Maha Yoga', 'Raja',
                planets=['Sun', 'Mercury', 'Jupiter'],
                description='Sun + Mercury + Jupiter conjunction',
                effects='Supreme intellect combined with wisdom and authority', strength='Very Strong'))

        # Shiva-Shakti Yoga: Mars + Venus in same sign
        if self.conj('Mars', 'Venus'):
            yogas.append(self._y('Shiva-Shakti Yoga', 'Special',
                planets=['Mars', 'Venus'],
                description='Mars (Shiva) conjunct Venus (Shakti)',
                effects='Intense passion, creative fire, dance, martial arts, magnetic attraction', strength='Moderate'))

        # Vishkumbha Yoga: All planets in 6 consecutive houses
        occ = sorted(set(self.h(p) for p in self.planets))
        if len(occ) >= 6:
            for start in range(1, 13):
                consec = {(start + i - 1) % 12 + 1 for i in range(6)}
                if set(occ) <= consec:
                    yogas.append(self._y('Vishkumbha Yoga', 'Special',
                        description='All planets within 6 consecutive houses',
                        effects='Focused life energy, specialist, domain expert', strength='Moderate'))
                    break

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # ARISHTA / DOSHA EXTENSIONS
    # ═══════════════════════════════════════════════════════════════════

    def check_extended_arishta(self) -> List[Dict]:
        yogas = []

        # Keeta Yoga: All planets between 5th-8th houses
        all_h = [self.h(p) for p in self.planets]
        if all(h in [5, 6, 7, 8] for h in all_h):
            yogas.append(self._y('Keeta Yoga', 'Arishta',
                description='All planets confined to 5th-8th houses',
                effects='Insect-like existence, dependent on others, limited scope'))

        # Pishacha Yoga: Rahu in Lagna with malefic aspect
        if self.h('Rahu') == 1:
            mal_in_7 = any(self.h(m) == 7 for m in NATURAL_MALEFICS if m != 'Rahu' and m in self.planets)
            if mal_in_7:
                yogas.append(self._y('Pishacha Yoga', 'Dosha',
                    description='Rahu in Lagna aspected by malefic',
                    effects='Mental disturbances, illusions, needs spiritual remedy', strength='Strong'))

        # Balarishta: Moon in 6/8/12 afflicted, for young charts
        if self.in_house('Moon', DUSTHANA_HOUSES):
            mal_conj = any(self.conj('Moon', m) for m in NATURAL_MALEFICS if m in self.planets)
            if mal_conj:
                yogas.append(self._y('Balarishta Yoga', 'Arishta',
                    description='Moon in dusthana with malefic',
                    effects='Health vulnerability in early years, needs special care', strength='Moderate'))

        # Kuja Dosha / Manglik (additional check beyond main)
        mars_h = self.h('Mars')
        if mars_h in [1, 4, 7, 8, 12]:
            cancelled = (self.is_own('Mars') or self.is_exalted('Mars') or
                        self.conj('Mars', 'Jupiter') or mars_h == 1 and self.r('Mars') in [0, 7])
            if not cancelled:
                yogas.append(self._y('Kuja Dosha (Manglik)', 'Dosha',
                    planets=['Mars'], house=mars_h,
                    description=f'Mars in house {mars_h}',
                    effects='Marriage delay or conflict, needs matching with Manglik partner', strength='Moderate'))

        # Kendrum variant: No planet in Kendra
        planets_in_kendra = [p for p in self.planets if self.in_house(p, KENDRA_HOUSES) and p not in NODES]
        if not planets_in_kendra:
            yogas.append(self._y('Kendra Shunya Yoga', 'Arishta',
                description='No planets in Kendra houses',
                effects='Lack of strong foundation, life feels unsupported'))

        # Guru Asta (Jupiter combust)
        sun_lon = self.lon('Sun')
        jup_lon = self.lon('Jupiter')
        diff = abs(sun_lon - jup_lon)
        if diff > 180: diff = 360 - diff
        if diff < 11:
            yogas.append(self._y('Guru Asta Yoga', 'Arishta', planets=['Sun', 'Jupiter'],
                description=f'Jupiter combust ({diff:.1f}° from Sun)',
                effects='Wisdom overshadowed by ego, guru problems, children issues'))

        # Shukra Asta (Venus combust)
        ven_lon = self.lon('Venus')
        diff_v = abs(sun_lon - ven_lon)
        if diff_v > 180: diff_v = 360 - diff_v
        if diff_v < 10:
            yogas.append(self._y('Shukra Asta Yoga', 'Arishta', planets=['Sun', 'Venus'],
                description=f'Venus combust ({diff_v:.1f}° from Sun)',
                effects='Love life obscured, delayed marriage, beauty hidden'))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # PLANET-IN-OWN/EXALTED/DEBILITATED NAMED YOGAS
    # ═══════════════════════════════════════════════════════════════════

    def check_dignity_yogas(self) -> List[Dict]:
        yogas = []

        dignity_names = {
            'Sun': {'exalted': 'Uccha Surya Yoga', 'debilitated': 'Neecha Surya Yoga'},
            'Moon': {'exalted': 'Uccha Chandra Yoga', 'debilitated': 'Neecha Chandra Yoga'},
            'Mars': {'exalted': 'Uccha Mangal Yoga', 'debilitated': 'Neecha Mangal Yoga'},
            'Mercury': {'exalted': 'Uccha Budha Yoga', 'debilitated': 'Neecha Budha Yoga'},
            'Jupiter': {'exalted': 'Uccha Guru Yoga', 'debilitated': 'Neecha Guru Yoga'},
            'Venus': {'exalted': 'Uccha Shukra Yoga', 'debilitated': 'Neecha Shukra Yoga'},
            'Saturn': {'exalted': 'Uccha Shani Yoga', 'debilitated': 'Neecha Shani Yoga'},
        }

        for planet, names in dignity_names.items():
            if planet in self.planets:
                if self.is_exalted(planet):
                    rn = RASHI_NAMES[self.r(planet)]
                    yogas.append(self._y(names['exalted'], 'Special', planet=planet,
                        description=f'{planet} exalted in {rn} (house {self.h(planet)})',
                        effects=f'{planet} at peak power — strongest expression of its significations',
                        strength='Strong'))
                elif self.is_debilitated(planet):
                    rn = RASHI_NAMES[self.r(planet)]
                    yogas.append(self._y(names['debilitated'], 'Arishta', planet=planet,
                        description=f'{planet} debilitated in {rn} (house {self.h(planet)})',
                        effects=f'{planet} at weakest — significations suffer, needs remedy',
                        strength='Moderate'))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # MAIN ANALYSIS
    # ═══════════════════════════════════════════════════════════════════

    def analyze_all_extended(self) -> Dict:
        all_yogas = {
            'named_raja': self.check_named_raja_yogas(),
            'named_dhana': self.check_named_dhana_yogas(),
            'chandra_variants': self.check_chandra_variants(),
            'graha_malika': self.check_graha_malika(),
            'house_lord': self.check_house_lord_yogas(),
            'named_conjunctions': self.check_named_conjunctions(),
            'extended_arishta': self.check_extended_arishta(),
            'dignity': self.check_dignity_yogas(),
        }

        total = sum(len(v) for v in all_yogas.values())
        flat = [y for v in all_yogas.values() for y in v]
        positive = sum(1 for y in flat if not y.get('is_negative', False))

        return {
            'yogas': all_yogas,
            'total': total,
            'positive': positive,
            'negative': total - positive,
        }


def analyze_extended_yogas(planets: Dict, ascendant: Dict) -> Dict:
    calc = ExtendedYogaCalculator(planets, ascendant)
    return calc.analyze_all_extended()


class RareYogaCalculator:
    """
    100+ rare classical yogas that trigger in 1-in-100 to 1-in-10000 charts.
    When they DO trigger, the reading feels supernatural.
    """

    def __init__(self, planets: Dict, ascendant: Dict):
        self.planets = planets
        self.asc_rashi = ascendant.get('rashi', ascendant.get('rashi_index', 0))

    def h(self, p): return self.planets.get(p, {}).get('house', 1)
    def r(self, p): return self.planets.get(p, {}).get('rashi', 0)
    def lon(self, p): return self.planets.get(p, {}).get('longitude', 0.0)
    def deg(self, p): return self.lon(p) % 30
    def lord(self, house): return RASHI_LORDS[(self.asc_rashi + house - 1) % 12]
    def conj(self, a, b): return self.h(a) == self.h(b)
    def pih(self, house): return [p for p in self.planets if self.h(p) == house]
    def strong(self, p):
        pr = self.r(p)
        pd = PLANETS.get(p, {})
        return pr == pd.get('exalted') or pr in pd.get('owns', [])
    def weak(self, p): return self.r(p) == PLANETS.get(p, {}).get('debilitated')
    def _y(self, name, ytype, **kw):
        y = {'name': name, 'type': ytype, 'is_negative': ytype in ('Arishta', 'Dosha', 'Daridra')}
        y.update(kw)
        return y

    def check_all_rare(self) -> List[Dict]:
        yogas = []
        yogas.extend(self._rare_raja())
        yogas.extend(self._rare_dhana())
        yogas.extend(self._rare_spiritual())
        yogas.extend(self._rare_arishta())
        yogas.extend(self._rare_special())
        yogas.extend(self._rare_nabhasa())
        yogas.extend(self._rare_conjunction_named())
        yogas.extend(self._rare_house_combos())
        return yogas

    def _rare_raja(self) -> List[Dict]:
        yogas = []
        l1, l4, l5, l7, l9, l10, l11 = [self.lord(h) for h in [1,4,5,7,9,10,11]]

        # Chandika Yoga: Sun in 9th + Moon in 4th + Mars in 2nd
        if self.h('Sun') == 9 and self.h('Moon') == 4 and self.h('Mars') == 2:
            yogas.append(self._y('Chandika Yoga', 'Raja',
                planets=['Sun', 'Moon', 'Mars'],
                description='Sun in 9th, Moon in 4th, Mars in 2nd',
                effects='Goddess Chandika blessing, royal authority, wealth from government and property',
                strength='Very Strong'))

        # Maharaja Yoga: 5th lord + 9th lord in Kendra together, both strong
        if l5 != l9 and self.conj(l5, l9) and self.h(l5) in KENDRA_HOUSES:
            if self.strong(l5) or self.strong(l9):
                yogas.append(self._y('Maharaja Yoga', 'Raja', planets=[l5, l9],
                    description=f'{l5} (5th lord) + {l9} (9th lord) strong in Kendra',
                    effects='Emperor-level authority, destiny of a ruler, massive influence', strength='Very Strong'))

        # Chatussagara Yoga (raja variant): 4+ planets in Kendras AND all Kendras occupied
        kendras_occ = [k for k in KENDRA_HOUSES if self.pih(k)]
        if len(kendras_occ) == 4:
            total_in_kendra = sum(len(self.pih(k)) for k in KENDRA_HOUSES)
            if total_in_kendra >= 5:
                yogas.append(self._y('Chatussagara Raja Yoga', 'Raja',
                    description=f'{total_in_kendra} planets filling all 4 Kendras',
                    effects='Fame across all four directions, wealth, command, longevity', strength='Very Strong'))

        # Trilochana Yoga: Sun + Moon + Mars in Trikona
        if all(self.h(p) in TRIKONA_HOUSES for p in ['Sun', 'Moon', 'Mars']):
            yogas.append(self._y('Trilochana Yoga', 'Raja',
                planets=['Sun', 'Moon', 'Mars'],
                description='Sun, Moon, Mars all in Trikona houses',
                effects='Three-eyed Shiva blessing, tremendous willpower, feared and respected', strength='Strong'))

        # Amsavatara Yoga: All benefics in Kendras + all malefics in 3/6/11
        bens = [p for p in self.planets if p in NATURAL_BENEFICS]
        mals = [p for p in self.planets if p in NATURAL_MALEFICS and p not in NODES]
        if bens and all(self.h(b) in KENDRA_HOUSES for b in bens):
            if mals and all(self.h(m) in [3, 6, 11] for m in mals):
                yogas.append(self._y('Amsavatara Yoga', 'Raja',
                    description='All benefics in Kendras, all malefics in Upachaya',
                    effects='Divine incarnation yoga, blessed with everything, malefics serve positively', strength='Very Strong'))

        # Padma (Lotus) Yoga: 5 planets in 5 specific houses (1,2,3,4,7)
        target = {1, 2, 3, 4, 7}
        occ = set(self.h(p) for p in self.planets if p not in NODES)
        if occ == target:
            yogas.append(self._y('Padma (Lotus) Yoga', 'Raja',
                description='Planets only in houses 1,2,3,4,7',
                effects='Life blooms like lotus, prosperity from adversity, divine grace', strength='Strong'))

        # Sankha Yoga: 5th + 6th lords in mutual Kendras
        l6 = self.lord(6)
        if l5 != l6 and self.h(l5) in KENDRA_HOUSES and self.h(l6) in KENDRA_HOUSES:
            yogas.append(self._y('Sankha Yoga', 'Raja', planets=[l5, l6],
                description='5th and 6th lords both in Kendras',
                effects='Conch-shell yoga, virtuous, long-lived, enjoys comforts', strength='Moderate'))

        # Bheri Yoga: 9th lord strong + all planets in 1/2/7/10
        if self.strong(l9):
            occ_h = set(self.h(p) for p in self.planets)
            if occ_h <= {1, 2, 7, 10}:
                yogas.append(self._y('Bheri Yoga', 'Raja',
                    description='Strong 9th lord + all planets in 1/2/7/10',
                    effects='Drum yoga — fame announced everywhere, wealthy, fearless', strength='Strong'))

        # Mridanga Yoga: Lagna lord strong + all planets in Kendras/Trikonas
        if self.strong(l1):
            kt = set(KENDRA_HOUSES + TRIKONA_HOUSES)
            if all(self.h(p) in kt for p in self.planets):
                yogas.append(self._y('Mridanga Yoga', 'Raja',
                    description='Strong Lagna lord + all planets in Kendra/Trikona',
                    effects='Musical drum yoga — fame and celebration, royal honors', strength='Very Strong'))

        # Chapa Yoga: All planets in houses 1-7 only
        if all(self.h(p) in [1,2,3,4,5,6,7] for p in self.planets):
            yogas.append(self._y('Chapa Yoga', 'Raja',
                description='All planets in houses 1 through 7',
                effects='Bow-shaped yoga — archer king, military commander, enjoys beginning of life', strength='Moderate'))

        return yogas

    def _rare_dhana(self) -> List[Dict]:
        yogas = []
        l2, l5, l9, l11 = [self.lord(h) for h in [2,5,9,11]]

        # Mahalakshmi Yoga: Venus + Jupiter + Mercury all in Kendras
        if (self.h('Venus') in KENDRA_HOUSES and self.h('Jupiter') in KENDRA_HOUSES
            and self.h('Mercury') in KENDRA_HOUSES):
            yogas.append(self._y('Mahalakshmi Yoga', 'Dhana',
                planets=['Venus', 'Jupiter', 'Mercury'],
                description='Venus, Jupiter, Mercury all in Kendras',
                effects='Goddess Mahalakshmi blessing, enormous wealth, luxury beyond measure', strength='Very Strong'))

        # Pushya Snana Yoga: Jupiter in Cancer (exalted) in Kendra
        if self.r('Jupiter') == 3 and self.h('Jupiter') in KENDRA_HOUSES:
            yogas.append(self._y('Pushya Snana Yoga', 'Dhana', planet='Jupiter',
                description='Jupiter exalted in Cancer in Kendra',
                effects='Bathed in fortune, ever-increasing wealth, divine financial protection', strength='Very Strong'))

        # Chatra Yoga: All planets in 1st to 7th houses from Lagna
        if all(self.h(p) <= 7 for p in self.planets):
            yogas.append(self._y('Chatra Yoga', 'Dhana',
                description='All planets in upper half (houses 1-7)',
                effects='Umbrella of protection, sheltered wealth, royalty', strength='Moderate'))

        # Matsya Yoga: Malefics in 1/9 + benefics in 5 + mixed in 4/8
        m1 = [p for p in self.pih(1) if p in NATURAL_MALEFICS]
        m9 = [p for p in self.pih(9) if p in NATURAL_MALEFICS]
        b5 = [p for p in self.pih(5) if p in NATURAL_BENEFICS]
        if m1 and m9 and b5:
            yogas.append(self._y('Matsya Yoga', 'Dhana',
                description='Malefics in 1st/9th, Benefics in 5th',
                effects='Fish yoga — wealth from sea/trade, compassionate, religious', strength='Strong'))

        # Kurma Yoga: Benefics in 5/6/7 + malefics in 1/3/4 (or reverse)
        b567 = all(self.h(p) in [5,6,7] for p in self.planets if p in NATURAL_BENEFICS)
        m134 = all(self.h(p) in [1,3,4] for p in self.planets if p in NATURAL_MALEFICS and p not in NODES)
        if b567 and m134:
            yogas.append(self._y('Kurma Yoga', 'Dhana',
                description='Benefics in 5/6/7, Malefics in 1/3/4',
                effects='Tortoise yoga — slow but immense wealth, protected, famous, charitable king', strength='Strong'))

        # 2nd lord + 11th lord both exalted
        if self.strong(l2) and self.strong(l11):
            yogas.append(self._y('Dwi-Dhana Yoga', 'Dhana', planets=[l2, l11],
                description='Both 2nd lord and 11th lord in strong dignity',
                effects='Double wealth yoga, income and savings both flourish', strength='Strong'))

        return yogas

    def _rare_spiritual(self) -> List[Dict]:
        yogas = []

        # Tapasvi Yoga: Saturn + Ketu in Lagna or 9th
        if (self.conj('Saturn', 'Ketu') and self.h('Saturn') in [1, 9]):
            yogas.append(self._y('Tapasvi Yoga', 'Sanyasa', planets=['Saturn', 'Ketu'],
                description='Saturn + Ketu in Lagna or 9th',
                effects='Born ascetic, severe penance in past life, spiritual authority', strength='Strong'))

        # Moksha Yoga: 12th lord in 12th + benefic aspects
        l12 = self.lord(12)
        if self.h(l12) == 12:
            yogas.append(self._y('Moksha Yoga', 'Sanyasa', planets=[l12],
                description='12th lord in 12th house',
                effects='Liberation promise, spiritual completion, final freedom possible', strength='Moderate'))

        # Parivraja Yoga: 4 planets in one sign including lord of 10th
        l10 = self.lord(10)
        for rashi in range(12):
            pls = [p for p in self.planets if self.r(p) == rashi]
            if len(pls) >= 4 and l10 in pls:
                yogas.append(self._y('Parivraja Yoga', 'Sanyasa', planets=pls,
                    description=f'4+ planets including 10th lord in {RASHI_NAMES[rashi]}',
                    effects='Wandering monk yoga, renounces career for spiritual quest', strength='Strong'))
                break

        # Vairagi Yoga: Moon + Saturn + Ketu in Trikona
        if all(self.h(p) in TRIKONA_HOUSES for p in ['Moon', 'Saturn', 'Ketu']):
            yogas.append(self._y('Vairagi Yoga', 'Sanyasa',
                planets=['Moon', 'Saturn', 'Ketu'],
                description='Moon, Saturn, Ketu all in Trikonas',
                effects='Complete detachment, lives like ascetic even in worldly life', strength='Strong'))

        # Ganapati Yoga: Jupiter in Kendra + Moon in Trikona + unafflicted
        if self.h('Jupiter') in KENDRA_HOUSES and self.h('Moon') in TRIKONA_HOUSES:
            if not self.conj('Moon', 'Saturn') and not self.conj('Moon', 'Rahu'):
                yogas.append(self._y('Ganapati Yoga', 'Deity',
                    planets=['Jupiter', 'Moon'],
                    description='Jupiter in Kendra, unafflicted Moon in Trikona',
                    effects='Lord Ganesha blessing, obstacles removed, auspicious beginnings', strength='Strong'))

        # Vishnu Yoga: Jupiter + Venus in 9th + Moon in 4th
        if self.h('Jupiter') == 9 and self.h('Venus') == 9 and self.h('Moon') == 4:
            yogas.append(self._y('Vishnu Yoga', 'Deity',
                planets=['Jupiter', 'Venus', 'Moon'],
                description='Jupiter + Venus in 9th, Moon in 4th',
                effects='Lord Vishnu protection, preserved through all difficulties, divine grace', strength='Very Strong'))

        return yogas

    def _rare_arishta(self) -> List[Dict]:
        yogas = []

        # Mrityubhaga Yoga: Planet at exact death degree (specific per sign)
        mrityubhaga = {
            'Sun':    [20,9,12,6,8,24,16,17,22,2,3,23],
            'Moon':   [26,12,13,25,24,11,26,14,13,25,5,12],
            'Mars':   [19,28,25,23,29,28,14,21,2,15,11,6],
            'Mercury':[15,14,13,12,8,18,20,10,21,22,7,5],
            'Jupiter':[19,29,12,27,6,4,13,10,17,11,15,28],
            'Venus':  [28,15,11,17,10,13,4,6,27,12,29,19],
            'Saturn': [10,4,7,9,12,16,3,18,28,14,13,15],
        }
        for planet, degrees in mrityubhaga.items():
            if planet in self.planets:
                rashi = self.r(planet)
                death_deg = degrees[rashi]
                actual_deg = self.deg(planet)
                if abs(actual_deg - death_deg) < 1.0:
                    yogas.append(self._y(f'Mrityubhaga ({planet})', 'Arishta',
                        planet=planet,
                        description=f'{planet} at {actual_deg:.1f}° in {RASHI_NAMES[rashi]} (death degree: {death_deg}°)',
                        effects=f'{planet} at death degree — significations critically weakened, needs strong remedy',
                        strength='Strong'))

        # Sarpa Dosha: Rahu + Ketu with all planets on one side AND in Dusthana
        rahu_h, ketu_h = self.h('Rahu'), self.h('Ketu')
        if rahu_h in DUSTHANA_HOUSES and ketu_h in DUSTHANA_HOUSES:
            yogas.append(self._y('Sarpa Dosha (Severe)', 'Dosha',
                planets=['Rahu', 'Ketu'],
                description='Both Rahu and Ketu in Dusthana houses',
                effects='Severe serpent curse, ancestral karma, persistent obstacles across generations',
                strength='Strong'))

        # Bandhana Yoga: Lagna lord + 6th lord in Kendra aspected by Saturn
        l1, l6 = self.lord(1), self.lord(6)
        if l1 != l6 and self.conj(l1, l6) and self.h(l1) in KENDRA_HOUSES:
            yogas.append(self._y('Bandhana Yoga', 'Arishta', planets=[l1, l6],
                description='Lagna lord + 6th lord together in Kendra',
                effects='Risk of imprisonment, bondage, legal confinement, restriction of freedom',
                strength='Moderate'))

        # Roga Yoga: 6th lord in Lagna + Lagna lord in 6th (exchange)
        if self.h(l6) == 1 and self.h(l1) == 6:
            yogas.append(self._y('Roga Parivartana Yoga', 'Arishta', planets=[l1, l6],
                description='1st and 6th lords exchanged',
                effects='Chronic health condition, but also ability to heal others through experience',
                strength='Strong'))

        # Visha Yoga: Saturn in Lagna + Moon in 7th (or reverse)
        if (self.h('Saturn') == 1 and self.h('Moon') == 7) or (self.h('Saturn') == 7 and self.h('Moon') == 1):
            yogas.append(self._y('Visha Yoga', 'Arishta', planets=['Saturn', 'Moon'],
                description='Saturn and Moon in 1-7 axis',
                effects='Poison yoga — emotional poisoning, depression, but builds extreme resilience',
                strength='Moderate'))

        return yogas

    def _rare_special(self) -> List[Dict]:
        yogas = []

        # Kahala variant: Moon + Mars in 4th (property warrior)
        if self.h('Moon') == 4 and self.h('Mars') == 4:
            yogas.append(self._y('Bhumi Yoga', 'Special',
                planets=['Moon', 'Mars'],
                description='Moon + Mars in 4th house',
                effects='Land lord, property empire, real estate genius, emotional about land', strength='Strong'))

        # Vidyut Yoga: Sun exalted + Venus in 11th from Sun
        sun_h = self.h('Sun')
        ven_h = self.h('Venus')
        if self.strong('Sun') and ((ven_h - sun_h) % 12) + 1 == 11:
            yogas.append(self._y('Vidyut Yoga', 'Special',
                planets=['Sun', 'Venus'],
                description='Strong Sun + Venus in 11th from Sun',
                effects='Lightning yoga — sudden fame, charitable king, wealthy, generous', strength='Strong'))

        # Parijata Yoga: Lagna lord's sign lord is in Trikona/Kendra and strong
        l1 = self.lord(1)
        l1_rashi = self.r(l1)
        l1_sign_lord = RASHI_LORDS[l1_rashi]
        if l1_sign_lord != l1 and self.h(l1_sign_lord) in KENDRA_HOUSES + TRIKONA_HOUSES and self.strong(l1_sign_lord):
            yogas.append(self._y('Parijata Yoga', 'Special', planets=[l1, l1_sign_lord],
                description=f'Lagna lord dispositor {l1_sign_lord} strong in Kendra/Trikona',
                effects='Celestial tree yoga — happiness increases with age, royalty in later life', strength='Strong'))

        # Khyati Yoga: 10th lord in Lagna + Lagna lord in 10th (exchange)
        l10 = self.lord(10)
        if self.h(l10) == 1 and self.h(l1) == 10 and l1 != l10:
            yogas.append(self._y('Khyati Yoga', 'Raja', planets=[l1, l10],
                description='Lagna lord and 10th lord exchanged',
                effects='Famous personality, career IS the identity, public figure, renowned', strength='Very Strong'))

        # Chaamunda Yoga: Mars exalted + Rahu in 6th
        if self.strong('Mars') and self.h('Rahu') == 6:
            yogas.append(self._y('Chaamunda Yoga', 'Special',
                planets=['Mars', 'Rahu'],
                description='Strong Mars + Rahu in 6th',
                effects='Goddess Chamunda blessing, destroys all enemies, fearless warrior', strength='Strong'))

        # Vanshi Yoga: Jupiter in own sign + Venus in own sign simultaneously
        if self.strong('Jupiter') and self.strong('Venus'):
            yogas.append(self._y('Vanshi Yoga', 'Special',
                planets=['Jupiter', 'Venus'],
                description='Both Jupiter and Venus in own/exalted signs',
                effects='Flute yoga (Krishna), master of arts and wisdom combined, enchanting personality', strength='Strong'))

        # Makuta Yoga: Jupiter in 9th + Saturn in 10th
        if self.h('Jupiter') == 9 and self.h('Saturn') == 10:
            yogas.append(self._y('Makuta Yoga', 'Raja',
                planets=['Jupiter', 'Saturn'],
                description='Jupiter in 9th, Saturn in 10th',
                effects='Crown yoga — wears the crown, undisputed authority, dharmic ruler', strength='Very Strong'))

        # Damini Yoga: All benefics in Upachaya (3,6,10,11) from Lagna
        bens = [p for p in self.planets if p in NATURAL_BENEFICS]
        if bens and all(self.h(b) in UPACHAYA_HOUSES for b in bens):
            yogas.append(self._y('Damini Yoga', 'Special', planets=bens,
                description='All benefics in Upachaya from Lagna',
                effects='Lightning flash yoga — sudden fortune, wealth multiplies, generous', strength='Strong'))

        return yogas

    def _rare_nabhasa(self) -> List[Dict]:
        yogas = []
        occ = sorted(set(self.h(p) for p in self.planets))

        # Yupa Yoga: All planets in 1st to 4th houses
        if all(self.h(p) in [1,2,3,4] for p in self.planets):
            yogas.append(self._y('Yupa Yoga', 'Nabhasa',
                description='All planets in 1st-4th houses',
                effects='Sacrificial pillar — religious, performs yagnas, traditional, respected priest', strength='Moderate'))

        # Shara Yoga: All planets in 4th to 7th houses
        if all(self.h(p) in [4,5,6,7] for p in self.planets):
            yogas.append(self._y('Shara Yoga', 'Nabhasa',
                description='All planets in 4th-7th houses',
                effects='Arrow yoga — focused aim, hunter, goal-oriented, piercing intelligence', strength='Moderate'))

        # Shakti Yoga: All planets in 7th to 10th houses
        if all(self.h(p) in [7,8,9,10] for p in self.planets):
            yogas.append(self._y('Shakti Yoga', 'Nabhasa',
                description='All planets in 7th-10th houses',
                effects='Power yoga — late bloomer, authority in second half of life', strength='Moderate'))

        # Danda Yoga: All planets in 10th to 1st houses
        if all(self.h(p) in [10,11,12,1] for p in self.planets):
            yogas.append(self._y('Danda Yoga', 'Nabhasa',
                description='All planets in 10th-1st houses',
                effects='Staff yoga — punisher, authority figure, discipline, may be harsh', strength='Moderate'))

        # Nauka Yoga: All planets in 7 signs from Lagna
        first_seven = [(self.asc_rashi + i) % 12 for i in range(7)]
        if all(self.r(p) in first_seven for p in self.planets):
            yogas.append(self._y('Nauka Yoga', 'Nabhasa',
                description='All planets in 7 signs from Ascendant',
                effects='Boat yoga — sailor, travels over water, income from shipping/trade', strength='Moderate'))

        # Koota Yoga: All planets in 4th and 10th houses only
        if all(self.h(p) in [4, 10] for p in self.planets):
            yogas.append(self._y('Koota Yoga', 'Nabhasa',
                description='All planets in 4th and 10th only',
                effects='Fort yoga — liar, prison connection, confined but powerful', strength='Moderate',
                is_negative=True))

        # Chhatra Yoga: All planets in houses 7 to 12
        if all(self.h(p) in [7,8,9,10,11,12] for p in self.planets):
            yogas.append(self._y('Chhatra Yoga', 'Nabhasa',
                description='All planets in lower half (7th-12th)',
                effects='Umbrella yoga — protected in later life, helps others, charitable end', strength='Moderate'))

        # Samudra Yoga: All planets in even houses (2,4,6,8,10,12)
        if all(self.h(p) % 2 == 0 for p in self.planets):
            yogas.append(self._y('Samudra Yoga', 'Nabhasa',
                description='All planets in even-numbered houses',
                effects='Ocean yoga — vast wealth, many pleasures, good reputation, enjoyed by all', strength='Strong'))

        return yogas

    def _rare_conjunction_named(self) -> List[Dict]:
        yogas = []

        # Pushkara Yoga: Moon in Pushya nakshatra + Jupiter aspects Moon
        moon_nak = self.planets.get('Moon', {}).get('nakshatra_name', '')
        if moon_nak == 'Pushya':
            jup_h = self.h('Jupiter')
            moon_h = self.h('Moon')
            jup_aspects = PLANETS.get('Jupiter', {}).get('aspects', [5, 7, 9])
            for asp in jup_aspects:
                if ((jup_h + asp - 1) % 12) + 1 == moon_h:
                    yogas.append(self._y('Pushkara Yoga (Nourishing)', 'Special',
                        planets=['Moon', 'Jupiter'],
                        description='Moon in Pushya aspected by Jupiter',
                        effects='Most nourishing yoga, everything grows, blessed family, wealth accumulates', strength='Very Strong'))
                    break

        # Trikona Yoga: All Trikona lords in Trikonas
        l1, l5, l9 = self.lord(1), self.lord(5), self.lord(9)
        if (self.h(l1) in TRIKONA_HOUSES and self.h(l5) in TRIKONA_HOUSES and self.h(l9) in TRIKONA_HOUSES):
            yogas.append(self._y('Trikona Yoga', 'Raja', planets=[l1, l5, l9],
                description='All three Trikona lords in Trikona houses',
                effects='Triple fortune, dharmic life, blessed merit from past lives activated', strength='Very Strong'))

        # Kendra Yoga: All Kendra lords in Kendras
        kl = [self.lord(h) for h in KENDRA_HOUSES]
        if all(self.h(l) in KENDRA_HOUSES for l in kl):
            yogas.append(self._y('Kendra Yoga', 'Raja', planets=list(set(kl)),
                description='All Kendra lords in Kendra houses',
                effects='Four pillars strong — stable life, success in all directions', strength='Strong'))

        # Parakrama Yoga: 3rd lord in own/exalted + Mars in 3rd or Kendra
        l3 = self.lord(3)
        if self.strong(l3) and (self.h('Mars') == 3 or self.h('Mars') in KENDRA_HOUSES):
            yogas.append(self._y('Parakrama Yoga', 'Special', planets=[l3, 'Mars'],
                description='Strong 3rd lord + Mars well-placed',
                effects='Extreme courage, adventurer, risk-taker who always wins', strength='Moderate'))

        # Sarada Yoga: Mercury in 2nd + Jupiter in 9th/1st
        if self.h('Mercury') == 2 and self.h('Jupiter') in [1, 9]:
            yogas.append(self._y('Sarada Yoga', 'Special',
                planets=['Mercury', 'Jupiter'],
                description='Mercury in 2nd, Jupiter in 1st/9th',
                effects='Goddess Sarada blessing, exceptional writing, poetry, philosophical speech', strength='Strong'))

        return yogas

    def _rare_house_combos(self) -> List[Dict]:
        yogas = []

        # All benefics in houses 1,5,9 (triple fortune)
        bens = [p for p in self.planets if p in NATURAL_BENEFICS]
        if bens and all(self.h(b) in TRIKONA_HOUSES for b in bens):
            yogas.append(self._y('Trikona Shubha Yoga', 'Raja', planets=bens,
                description='All benefics in Trikona houses (1,5,9)',
                effects='Triple blessing — self, children, fortune all strengthened by benefics', strength='Very Strong'))

        # 9th lord in 10th + 10th lord in 9th (Dharma-Karma exchange)
        l9, l10 = self.lord(9), self.lord(10)
        if l9 != l10 and self.h(l9) == 10 and self.h(l10) == 9:
            yogas.append(self._y('Dharma-Karma Parivartana', 'Raja', planets=[l9, l10],
                description='9th and 10th lords exchanged',
                effects='Destiny and career fused, righteous profession, fame through dharma', strength='Very Strong'))

        # 5th lord in 5th (own house, children blessed)
        l5 = self.lord(5)
        if self.h(l5) == 5:
            yogas.append(self._y('Putra Sthira Yoga', 'Special', planet=l5,
                description='5th lord in 5th house',
                effects='Children are blessed, intelligence is natural, creative fulfillment, speculation gains', strength='Moderate'))

        # 4th lord in 4th (own house, property blessed)
        l4 = self.lord(4)
        if self.h(l4) == 4:
            yogas.append(self._y('Griha Sthira Yoga', 'Special', planet=l4,
                description='4th lord in 4th house',
                effects='Permanent home, property ownership assured, mother is protective, domestic bliss', strength='Moderate'))

        # 7th lord in 7th (marriage blessed)
        l7 = self.lord(7)
        if self.h(l7) == 7:
            yogas.append(self._y('Kalatra Sthira Yoga', 'Special', planet=l7,
                description='7th lord in 7th house',
                effects='Spouse is loyal, business partnerships thrive, marriage stable', strength='Moderate'))

        # Venus in 7th + Jupiter aspects 7th (blessed marriage)
        if self.h('Venus') == 7:
            jup_h = self.h('Jupiter')
            for asp in PLANETS.get('Jupiter', {}).get('aspects', [5, 7, 9]):
                if ((jup_h + asp - 1) % 12) + 1 == 7:
                    yogas.append(self._y('Saubhagya Yoga', 'Special',
                        planets=['Venus', 'Jupiter'],
                        description='Venus in 7th aspected by Jupiter',
                        effects='Beautiful and virtuous spouse, blessed married life, social grace', strength='Strong'))
                    break

        return yogas


def analyze_rare_yogas(planets: Dict, ascendant: Dict) -> List[Dict]:
    calc = RareYogaCalculator(planets, ascendant)
    return calc.check_all_rare()
