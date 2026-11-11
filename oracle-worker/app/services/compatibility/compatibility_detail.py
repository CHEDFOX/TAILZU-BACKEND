"""
JYOTISH ENGINE - ASHTAKOOTA DETAILED BREAKDOWN
Explains what each kuta means + Manglik 14-condition check.
"""

from typing import Dict

KUTA_MEANINGS = {
    'Varna': {'max': 1, 'meaning': 'Spiritual/ego compatibility. Higher varna should be groom.'},
    'Vashya': {'max': 2, 'meaning': 'Mutual attraction and control. Who influences whom.'},
    'Tara': {'max': 3, 'meaning': 'Birth star compatibility. Health and destiny alignment.'},
    'Yoni': {'max': 4, 'meaning': 'Sexual and physical compatibility. Intimacy harmony.'},
    'Graha Maitri': {'max': 5, 'meaning': 'Mental compatibility. Friendship between Moon lords.'},
    'Gana': {'max': 6, 'meaning': 'Temperament match. Deva/Manushya/Rakshasa compatibility.'},
    'Bhakut': {'max': 7, 'meaning': 'Financial and family compatibility. Prosperity together.'},
    'Nadi': {'max': 8, 'meaning': 'Health of children and genetic compatibility. Most important.'},
}

MANGLIK_CANCEL = [
    'Mars in own sign (Aries/Scorpio) in 1/4/7/8/12',
    'Mars aspected by Jupiter',
    'Mars conjunct Jupiter',
    'Mars in Leo or Aquarius in offending house',
    'Both partners are Manglik (cancels)',
    'Venus in 1/7 house',
    'Saturn in 1/4/7/8/12 (some schools)',
    'Mars in 2nd house from Lagna',
    'After age 28 (Mars energy matures)',
    'Mars exalted (Capricorn)',
    'Rahu in 1/7 (replaces Mars energy)',
    'Jupiter aspects 7th house',
    'Moon in Kendra in chart',
    'Mars in movable sign in offending house',
]


class CompatibilityDetail:
    def __init__(self, engine1, engine2):
        self.e1 = engine1
        self.e2 = engine2

    def get_detailed_match(self) -> Dict:
        try:
            basic = self.e1.get_compatibility(self.e2)
        except Exception:
            basic = {}

        # Add detailed Manglik analysis
        manglik1 = self._check_manglik(self.e1)
        manglik2 = self._check_manglik(self.e2)

        both_manglik = manglik1['is_manglik'] and manglik2['is_manglik']
        manglik_issue = manglik1['is_manglik'] != manglik2['is_manglik']

        return {
            'basic_score': basic,
            'kuta_meanings': KUTA_MEANINGS,
            'manglik_person1': manglik1,
            'manglik_person2': manglik2,
            'manglik_compatible': both_manglik or (not manglik1['is_manglik'] and not manglik2['is_manglik']),
            'manglik_warning': 'One partner Manglik, other not — check cancellations carefully' if manglik_issue else '',
            'cancellation_conditions': MANGLIK_CANCEL,
        }

    def _check_manglik(self, engine) -> Dict:
        mars_h = engine.planets.get('Mars', {}).get('house', 1)
        is_manglik = mars_h in [1, 4, 7, 8, 12]

        cancellations = []
        if is_manglik:
            mars_r = engine.planets.get('Mars', {}).get('rashi', 0)
            if mars_r in [0, 7]:
                cancellations.append('Mars in own sign')
                is_manglik = False
            if mars_r == 9:
                cancellations.append('Mars exalted in Capricorn')
                is_manglik = False
            jup_h = engine.planets.get('Jupiter', {}).get('house', 0)
            if jup_h == mars_h:
                cancellations.append('Mars conjunct Jupiter')
                is_manglik = False
            ven_h = engine.planets.get('Venus', {}).get('house', 0)
            if ven_h in [1, 7]:
                cancellations.append('Venus in 1st or 7th')

        return {
            'is_manglik': is_manglik,
            'mars_house': mars_h,
            'cancellations': cancellations,
            'cancelled': len(cancellations) > 0,
        }


def detailed_compatibility(engine1, engine2):
    return CompatibilityDetail(engine1, engine2).get_detailed_match()
