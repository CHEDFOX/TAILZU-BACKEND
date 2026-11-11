"""
JYOTISH ENGINE - MEDICAL ASTROLOGY + LONGEVITY + MARAKA
Disease prediction, lifespan estimation, danger period identification.

Planet-body mapping (classical):
Sun = Heart, Eyes, Bones, Head | Moon = Mind, Blood, Fluids, Breast
Mars = Blood, Muscles, Accidents, Surgery | Mercury = Nerves, Skin, Speech
Jupiter = Liver, Fat, Diabetes | Venus = Reproductive, Kidneys, Face
Saturn = Bones, Teeth, Chronic, Legs | Rahu = Poison, Mystery illness
Ketu = Injury, Infection, Spiritual illness
"""

from typing import Dict, List
from ..core.constants import (
    PLANETS, RASHIS, RASHI_LORDS, KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES,
)

PLANET_BODY = {
    'Sun': {'organs': ['Heart', 'Eyes', 'Bones', 'Head', 'Spine'], 'diseases': ['Heart disease', 'Eye problems', 'Bone weakness', 'Headaches', 'High BP']},
    'Moon': {'organs': ['Mind', 'Blood', 'Fluids', 'Breast', 'Stomach'], 'diseases': ['Depression', 'Anemia', 'Fluid retention', 'Mental illness', 'Insomnia']},
    'Mars': {'organs': ['Blood', 'Muscles', 'Marrow', 'Head', 'Genitals'], 'diseases': ['Accidents', 'Surgery', 'Fever', 'Blood disorders', 'Burns', 'Inflammation']},
    'Mercury': {'organs': ['Nerves', 'Skin', 'Lungs', 'Hands', 'Speech'], 'diseases': ['Nervous disorders', 'Skin disease', 'Respiratory', 'Stammering', 'Allergies']},
    'Jupiter': {'organs': ['Liver', 'Fat', 'Ears', 'Thighs', 'Arteries'], 'diseases': ['Diabetes', 'Obesity', 'Liver disease', 'Cholesterol', 'Tumors']},
    'Venus': {'organs': ['Reproductive', 'Kidneys', 'Face', 'Throat', 'Eyes'], 'diseases': ['Reproductive issues', 'Kidney problems', 'Diabetes', 'STDs', 'Throat issues']},
    'Saturn': {'organs': ['Bones', 'Teeth', 'Legs', 'Joints', 'Knees'], 'diseases': ['Arthritis', 'Paralysis', 'Chronic pain', 'Depression', 'Dental problems']},
    'Rahu': {'organs': ['Head', 'Skin', 'Feet'], 'diseases': ['Mysterious illness', 'Poisoning', 'Phobias', 'Psychosis', 'Cancer risk']},
    'Ketu': {'organs': ['Spine', 'Skin', 'Feet', 'Ears'], 'diseases': ['Injury', 'Infection', 'Viral', 'Spinal issues', 'Skin eruptions']},
}

HOUSE_BODY = {
    1: 'Head, Brain, General vitality',
    2: 'Face, Right eye, Teeth, Speech',
    3: 'Arms, Shoulders, Ears, Throat',
    4: 'Chest, Heart, Lungs, Breast',
    5: 'Stomach, Upper abdomen, Mind',
    6: 'Intestines, Lower abdomen, Immune system',
    7: 'Kidneys, Lower back, Reproductive',
    8: 'Genitals, Chronic disease, Death',
    9: 'Hips, Thighs, Arteries',
    10: 'Knees, Joints, Skeleton',
    11: 'Ankles, Calves, Left ear',
    12: 'Feet, Left eye, Sleep, Hospitalization',
}


class MedicalAstrology:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi

    def h(self, p): return self.planets.get(p, {}).get('house', 1)
    def r(self, p): return self.planets.get(p, {}).get('rashi', 0)
    def lord(self, house): return RASHI_LORDS[(self.asc_rashi + house - 1) % 12]
    def conj(self, a, b): return self.h(a) == self.h(b)
    def strong(self, p):
        return self.r(p) == PLANETS.get(p, {}).get('exalted') or self.r(p) in PLANETS.get(p, {}).get('owns', [])
    def weak(self, p): return self.r(p) == PLANETS.get(p, {}).get('debilitated')

    def analyze_health_vulnerabilities(self) -> List[Dict]:
        """Identify health vulnerabilities from chart."""
        vulnerabilities = []

        # 6th house analysis (disease house)
        h6_occ = [p for p in self.planets if self.h(p) == 6]
        l6 = self.lord(6)
        l6_house = self.h(l6)

        for planet in h6_occ:
            body = PLANET_BODY.get(planet, {})
            vulnerabilities.append({
                'source': f'{planet} in 6th house',
                'body_area': body.get('organs', [])[:3],
                'possible_issues': body.get('diseases', [])[:3],
                'severity': 'High' if self.weak(planet) else 'Moderate',
                'timing': f'Aggravated during {planet} dasha/antardasha',
            })

        # 8th house (chronic/hidden disease)
        h8_occ = [p for p in self.planets if self.h(p) == 8]
        for planet in h8_occ:
            body = PLANET_BODY.get(planet, {})
            vulnerabilities.append({
                'source': f'{planet} in 8th house',
                'body_area': body.get('organs', [])[:3],
                'possible_issues': body.get('diseases', [])[:2],
                'severity': 'High',
                'timing': f'Hidden issues, surfaces in {planet} dasha',
            })

        # Debilitated planets
        for planet in self.planets:
            if self.weak(planet) and planet not in ('Rahu', 'Ketu'):
                body = PLANET_BODY.get(planet, {})
                vulnerabilities.append({
                    'source': f'{planet} debilitated',
                    'body_area': body.get('organs', [])[:2],
                    'possible_issues': body.get('diseases', [])[:2],
                    'severity': 'Moderate',
                    'timing': 'Chronic but manageable with remedies',
                })

        # Lagna lord in dusthana
        l1 = self.lord(1)
        if self.h(l1) in DUSTHANA_HOUSES:
            vulnerabilities.append({
                'source': f'Lagna lord {l1} in house {self.h(l1)}',
                'body_area': ['General vitality'],
                'possible_issues': ['Low immunity', 'Frequent illness', 'Slow recovery'],
                'severity': 'High',
                'timing': 'Lifelong tendency, worse in malefic dashas',
            })

        # Moon affliction = mental health
        moon_afflicted = any(self.conj('Moon', m) for m in ['Saturn', 'Rahu', 'Ketu', 'Mars'])
        if moon_afflicted:
            afflictors = [m for m in ['Saturn', 'Rahu', 'Ketu', 'Mars'] if self.conj('Moon', m)]
            vulnerabilities.append({
                'source': f'Moon afflicted by {", ".join(afflictors)}',
                'body_area': ['Mind', 'Emotions'],
                'possible_issues': ['Anxiety', 'Depression', 'Emotional instability', 'Sleep issues'],
                'severity': 'High' if 'Saturn' in afflictors or 'Rahu' in afflictors else 'Moderate',
                'timing': 'Moon/Saturn/Rahu dasha periods',
            })

        return sorted(vulnerabilities, key=lambda x: {'High': 0, 'Moderate': 1, 'Low': 2}.get(x['severity'], 3))

    def calculate_longevity(self) -> Dict:
        """
        Classical longevity estimation (Ayurdaya).
        Uses 3 methods: Amsayurdaya, Pindayurdaya, Naisargikayurdaya.
        """
        l1 = self.lord(1)
        l8 = self.lord(8)
        l1_house = self.h(l1)
        l8_house = self.h(l8)
        saturn_house = self.h('Saturn')

        # Method 1: Lagna lord + 8th lord placement
        score1 = 0
        if l1_house in KENDRA_HOUSES: score1 += 3
        elif l1_house in TRIKONA_HOUSES: score1 += 2
        elif l1_house in DUSTHANA_HOUSES: score1 -= 1

        if l8_house in KENDRA_HOUSES: score1 += 2
        elif l8_house in TRIKONA_HOUSES: score1 += 2
        elif l8_house in DUSTHANA_HOUSES: score1 -= 1

        # Method 2: Saturn's position (karaka of longevity)
        score2 = 0
        if self.strong('Saturn'): score2 += 3
        elif saturn_house in KENDRA_HOUSES: score2 += 2
        elif saturn_house in DUSTHANA_HOUSES: score2 -= 1

        # Method 3: Moon strength
        score3 = 0
        if self.strong('Moon'): score3 += 2
        elif self.h('Moon') in KENDRA_HOUSES: score3 += 1
        elif self.weak('Moon'): score3 -= 2

        # Benefic aspects on Lagna/8th
        for ben in ['Jupiter', 'Venus']:
            if self.h(ben) in KENDRA_HOUSES:
                score1 += 1

        total = score1 + score2 + score3

        if total >= 7:
            category = 'Poornayu (Full Life)'
            range_str = '75-100+ years'
            description = 'Strong longevity indicators, blessed with long life'
        elif total >= 4:
            category = 'Madhyayu (Medium Life)'
            range_str = '50-75 years'
            description = 'Moderate longevity, normal lifespan with care'
        elif total >= 1:
            category = 'Alpayu (Short Life) — with remedies can improve'
            range_str = '35-50 years'
            description = 'Below average indicators, remedies strongly recommended'
        else:
            category = 'Balarishta Risk — needs assessment'
            range_str = 'Requires detailed analysis'
            description = 'Vulnerable periods, especially in early life. Remedies essential.'

        return {
            'category': category,
            'range': range_str,
            'description': description,
            'score': total,
            'factors': {
                'lagna_8th_lords': score1,
                'saturn_strength': score2,
                'moon_strength': score3,
            },
            'lagna_lord': {'planet': l1, 'house': l1_house, 'strong': self.strong(l1)},
            'eighth_lord': {'planet': l8, 'house': l8_house, 'strong': self.strong(l8)},
            'saturn': {'house': saturn_house, 'strong': self.strong('Saturn')},
        }

    def analyze_maraka(self) -> Dict:
        """
        Maraka (death/danger) analysis.
        2nd and 7th houses are Maraka houses.
        Their lords and occupants indicate danger periods.
        """
        l2 = self.lord(2)
        l7 = self.lord(7)
        h2_occ = [p for p in self.planets if self.h(p) == 2]
        h7_occ = [p for p in self.planets if self.h(p) == 7]

        maraka_planets = set()
        maraka_planets.add(l2)
        maraka_planets.add(l7)
        for p in h2_occ + h7_occ:
            maraka_planets.add(p)

        # Danger periods = dasha of maraka planets
        danger_dashas = []
        for mp in maraka_planets:
            severity = 'Primary' if mp in (l2, l7) else 'Secondary'
            danger_dashas.append({
                'planet': mp,
                'role': f'Lord of {"2nd" if mp == l2 else "7th" if mp == l7 else "occupant of 2nd/7th"}',
                'severity': severity,
                'caution': f'{mp} dasha/antardasha requires health vigilance',
            })

        # Badhaka (obstruction) lord
        asc_quality = RASHIS.get(self.asc_rashi, {}).get('quality', 'Fixed')
        if asc_quality == 'Movable':
            badhaka_house = 11
        elif asc_quality == 'Fixed':
            badhaka_house = 9
        else:
            badhaka_house = 7
        badhaka_lord = self.lord(badhaka_house)

        return {
            'maraka_planets': sorted(maraka_planets),
            'second_lord': {'planet': l2, 'house': self.h(l2)},
            'seventh_lord': {'planet': l7, 'house': self.h(l7)},
            'occupants_2nd': h2_occ,
            'occupants_7th': h7_occ,
            'danger_dashas': danger_dashas,
            'badhaka': {
                'house': badhaka_house,
                'lord': badhaka_lord,
                'lord_house': self.h(badhaka_lord),
                'description': f'{badhaka_lord} is Badhaka lord — obstruction and hidden danger',
            },
        }

    def generate_medical_report(self) -> Dict:
        return {
            'health_vulnerabilities': self.analyze_health_vulnerabilities(),
            'longevity': self.calculate_longevity(),
            'maraka': self.analyze_maraka(),
        }


def analyze_medical(engine) -> Dict:
    ma = MedicalAstrology(engine)
    return ma.generate_medical_report()
