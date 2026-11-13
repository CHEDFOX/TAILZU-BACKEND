"""
JYOTISH ENGINE - DIVISIONAL CHART (VARGA) DEEP ANALYSIS
Detailed analysis of key divisional charts:
- D9 Navamsa (spouse, dharma, inner strength)
- D10 Dasamsa (career specifics)
- D7 Saptamsa (children)
- D3 Drekkana (siblings, courage)
- D12 Dwadasamsa (parents)
- D30 Trimsamsa (misfortune, evil)
- D16 Shodasamsa (vehicles, comforts)
- D24 Chaturvimsamsa (education)
"""

from typing import Dict
from ..core.constants import (
    PLANETS, RASHI_LORDS, RASHI_NAMES,
    KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES,
)
from .divisional_charts import DivisionalCharts


class VargaAnalysis:
    """Deep analysis of divisional charts beyond just planet placement."""

    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi

    def _get_varga_positions(self, division: int) -> Dict:
        return DivisionalCharts.generate_divisional_chart(self.planets, division)

    def _analyze_lord_placement(self, varga_planets: Dict, asc_rashi: int, house: int) -> Dict:
        house_rashi = (asc_rashi + house - 1) % 12
        lord = RASHI_LORDS[house_rashi]
        lord_rashi = varga_planets.get(lord, {}).get('rashi', 0)
        lord_house = ((lord_rashi - asc_rashi) % 12) + 1
        occupants = [p for p, d in varga_planets.items() if ((d.get('rashi', 0) - asc_rashi) % 12) + 1 == house]

        return {
            'house': house, 'lord': lord, 'lord_house': lord_house,
            'occupants': occupants,
            'strength': 'Strong' if lord_house in KENDRA_HOUSES + TRIKONA_HOUSES else
                        'Weak' if lord_house in DUSTHANA_HOUSES else 'Moderate',
        }

    # ═══════════════════════════════════════════════════════════════════
    # D9 NAVAMSA (Marriage, Dharma, Inner Strength)
    # ═══════════════════════════════════════════════════════════════════

    def analyze_navamsa(self) -> Dict:
        d9 = self._get_varga_positions(9)
        d9_planets = d9.get('planets', {})
        d9_asc = d9.get('ascendant_rashi', 0)

        # 7th house analysis (spouse)
        h7 = self._analyze_lord_placement(d9_planets, d9_asc, 7)
        # 1st house (dharma, inner self)
        h1 = self._analyze_lord_placement(d9_planets, d9_asc, 1)
        # Venus placement (marriage karaka)
        venus_rashi = d9_planets.get('Venus', {}).get('rashi', 0)
        venus_house = ((venus_rashi - d9_asc) % 12) + 1

        # Pushkara Navamsa / Vargottama check
        vargottama = []
        for p, d in self.planets.items():
            d1_rashi = d.get('rashi', 0)
            d9_rashi = d9_planets.get(p, {}).get('rashi', 0)
            if d1_rashi == d9_rashi:
                vargottama.append(p)

        # Spouse characteristics from 7th in D9
        h7_rashi = (d9_asc + 6) % 12
        element = PLANETS.get(RASHI_LORDS[h7_rashi], {}).get('element', '')
        spouse_traits = {
            'Fire': 'Energetic, passionate, independent, leader-type spouse',
            'Earth': 'Practical, stable, loyal, financially minded spouse',
            'Air': 'Intellectual, communicative, social, versatile spouse',
            'Water': 'Emotional, nurturing, intuitive, caring spouse',
        }

        spouse_planet_traits = {
            'Sun': 'Authoritative, dignified, government connection',
            'Moon': 'Nurturing, beautiful, emotional, homemaker',
            'Mars': 'Energetic, athletic, strong-willed, independent',
            'Mercury': 'Intellectual, youthful, communicative, business-minded',
            'Jupiter': 'Wise, religious, educated, traditional, generous',
            'Venus': 'Beautiful, artistic, romantic, luxury-loving',
            'Saturn': 'Mature, disciplined, older, hardworking, serious',
            'Rahu': 'Unconventional, foreign, modern, tech-savvy',
            'Ketu': 'Spiritual, detached, intuitive, mysterious',
        }

        return {
            'chart': 'D9 Navamsa',
            'purpose': 'Spouse, Dharma, Inner Strength',
            'navamsa_ascendant': RASHI_NAMES[d9_asc],
            'seventh_house': {
                'lord': h7['lord'],
                'lord_house': h7['lord_house'],
                'occupants': h7['occupants'],
                'strength': h7['strength'],
                'spouse_element': spouse_traits.get(element, 'Mixed qualities'),
            },
            'venus_placement': {
                'house': venus_house,
                'rashi': RASHI_NAMES[venus_rashi],
                'strong': venus_house in KENDRA_HOUSES + TRIKONA_HOUSES,
                'meaning': 'Strong Venus in Navamsa = happy marriage' if venus_house in KENDRA_HOUSES + TRIKONA_HOUSES
                           else 'Venus needs support for marriage harmony',
            },
            'vargottama_planets': vargottama,
            'dharma_strength': h1['strength'],
            'spouse_description': spouse_planet_traits.get(h7['lord'], 'Mixed personality'),
            'marriage_strength': 'Strong' if h7['strength'] == 'Strong' and venus_house not in DUSTHANA_HOUSES
                                 else 'Weak' if h7['strength'] == 'Weak' else 'Moderate',
        }

    # ═══════════════════════════════════════════════════════════════════
    # D10 DASAMSA (Career Specifics)
    # ═══════════════════════════════════════════════════════════════════

    def analyze_dasamsa(self) -> Dict:
        d10 = self._get_varga_positions(10)
        d10_planets = d10.get('planets', {})
        d10_asc = d10.get('ascendant_rashi', 0)

        h10 = self._analyze_lord_placement(d10_planets, d10_asc, 10)
        h1 = self._analyze_lord_placement(d10_planets, d10_asc, 1)

        # Career type from 10th lord placement
        career_map = {
            'Sun': 'Government, politics, administration, authority roles',
            'Moon': 'Public service, hospitality, nursing, food industry, travel',
            'Mars': 'Military, police, engineering, surgery, sports, real estate',
            'Mercury': 'IT, writing, teaching, commerce, accounting, communication',
            'Jupiter': 'Education, law, finance, consulting, religious institutions',
            'Venus': 'Arts, entertainment, fashion, luxury goods, hospitality, beauty',
            'Saturn': 'Mining, construction, labor management, judiciary, agriculture',
            'Rahu': 'Technology, foreign companies, aviation, research, unconventional',
            'Ketu': 'Spiritual organizations, research, alternative healing, occult',
        }

        # Planet in 10th in D10 = strongest career indicator
        d10_h10_occupants = [p for p, d in d10_planets.items()
                             if ((d.get('rashi', 0) - d10_asc) % 12) + 1 == 10]

        primary_career = career_map.get(h10['lord'], 'Diverse career')
        secondary = [career_map.get(p, '') for p in d10_h10_occupants if p in career_map]

        return {
            'chart': 'D10 Dasamsa',
            'purpose': 'Career, Profession, Status',
            'dasamsa_ascendant': RASHI_NAMES[d10_asc],
            'tenth_house': h10,
            'career_type': primary_career,
            'secondary_careers': secondary[:2],
            'career_strength': h10['strength'],
            'rise_potential': 'High' if h10['strength'] == 'Strong' and h1['strength'] != 'Weak'
                              else 'Low' if h10['strength'] == 'Weak' else 'Moderate',
        }

    # ═══════════════════════════════════════════════════════════════════
    # D7 SAPTAMSA (Children)
    # ═══════════════════════════════════════════════════════════════════

    def analyze_saptamsa(self) -> Dict:
        d7 = self._get_varga_positions(7)
        d7_planets = d7.get('planets', {})
        d7_asc = d7.get('ascendant_rashi', 0)

        h5 = self._analyze_lord_placement(d7_planets, d7_asc, 5)
        jup_rashi = d7_planets.get('Jupiter', {}).get('rashi', 0)
        jup_house = ((jup_rashi - d7_asc) % 12) + 1

        return {
            'chart': 'D7 Saptamsa',
            'purpose': 'Children, Progeny',
            'fifth_house': h5,
            'jupiter_placement': {
                'house': jup_house,
                'strong': jup_house in KENDRA_HOUSES + TRIKONA_HOUSES,
            },
            'children_promise': 'Strong' if h5['strength'] == 'Strong' and jup_house not in DUSTHANA_HOUSES
                                else 'Weak' if h5['strength'] == 'Weak' else 'Moderate',
        }

    # ═══════════════════════════════════════════════════════════════════
    # D3 DREKKANA (Siblings, Courage)
    # ═══════════════════════════════════════════════════════════════════

    def analyze_drekkana(self) -> Dict:
        d3 = self._get_varga_positions(3)
        d3_planets = d3.get('planets', {})
        d3_asc = d3.get('ascendant_rashi', 0)

        h3 = self._analyze_lord_placement(d3_planets, d3_asc, 3)
        mars_rashi = d3_planets.get('Mars', {}).get('rashi', 0)
        mars_house = ((mars_rashi - d3_asc) % 12) + 1

        return {
            'chart': 'D3 Drekkana',
            'purpose': 'Siblings, Courage, Initiative',
            'third_house': h3,
            'mars_placement': {'house': mars_house},
            'sibling_promise': h3['strength'],
            'courage_level': 'High' if mars_house in KENDRA_HOUSES else 'Moderate',
        }

    # ═══════════════════════════════════════════════════════════════════
    # D12 DWADASAMSA (Parents)
    # ═══════════════════════════════════════════════════════════════════

    def analyze_dwadasamsa(self) -> Dict:
        d12 = self._get_varga_positions(12)
        d12_planets = d12.get('planets', {})
        d12_asc = d12.get('ascendant_rashi', 0)

        h4 = self._analyze_lord_placement(d12_planets, d12_asc, 4)  # Mother
        h9 = self._analyze_lord_placement(d12_planets, d12_asc, 9)  # Father

        return {
            'chart': 'D12 Dwadasamsa',
            'purpose': 'Parents',
            'mother_house': h4,
            'father_house': h9,
            'mother_relationship': h4['strength'],
            'father_relationship': h9['strength'],
        }

    # ═══════════════════════════════════════════════════════════════════
    # D24 CHATURVIMSAMSA (Education)
    # ═══════════════════════════════════════════════════════════════════

    def analyze_chaturvimsamsa(self) -> Dict:
        d24 = self._get_varga_positions(24)
        d24_planets = d24.get('planets', {})
        d24_asc = d24.get('ascendant_rashi', 0)

        h4 = self._analyze_lord_placement(d24_planets, d24_asc, 4)
        h5 = self._analyze_lord_placement(d24_planets, d24_asc, 5)

        jup_rashi = d24_planets.get('Jupiter', {}).get('rashi', 0)
        jup_house = ((jup_rashi - d24_asc) % 12) + 1
        mer_rashi = d24_planets.get('Mercury', {}).get('rashi', 0)
        mer_house = ((mer_rashi - d24_asc) % 12) + 1

        return {
            'chart': 'D24 Chaturvimsamsa',
            'purpose': 'Education, Learning',
            'education_houses': {'4th': h4, '5th': h5},
            'jupiter': {'house': jup_house, 'strong': jup_house in KENDRA_HOUSES + TRIKONA_HOUSES},
            'mercury': {'house': mer_house, 'strong': mer_house in KENDRA_HOUSES + TRIKONA_HOUSES},
            'education_strength': 'Strong' if (jup_house in KENDRA_HOUSES + TRIKONA_HOUSES or
                                               mer_house in KENDRA_HOUSES + TRIKONA_HOUSES) else 'Moderate',
        }

    # ═══════════════════════════════════════════════════════════════════
    # COMPLETE VARGA REPORT
    # ═══════════════════════════════════════════════════════════════════

    def generate_full_varga_analysis(self) -> Dict:
        return {
            'navamsa_d9': self.analyze_navamsa(),
            'dasamsa_d10': self.analyze_dasamsa(),
            'saptamsa_d7': self.analyze_saptamsa(),
            'drekkana_d3': self.analyze_drekkana(),
            'dwadasamsa_d12': self.analyze_dwadasamsa(),
            'chaturvimsamsa_d24': self.analyze_chaturvimsamsa(),
        }


def analyze_all_vargas(engine) -> Dict:
    va = VargaAnalysis(engine)
    return va.generate_full_varga_analysis()
