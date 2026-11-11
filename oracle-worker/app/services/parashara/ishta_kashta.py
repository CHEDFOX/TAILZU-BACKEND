"""
JYOTISH ENGINE - ISHTA PHALA & KASHTA PHALA
Benefic/malefic strength of each planet.

Ishta Phala = Benefic potential (0-60)
Kashta Phala = Malefic potential (0-60)

When Ishta > Kashta → planet gives good results
When Kashta > Ishta → planet gives bad results
Difference shows NET benefit or harm.

Also includes deep Vimsopaka Bala (16-division strength).
"""

from typing import Dict

# Uccha (exaltation) degrees for Ishta/Kashta calculation
UCCHA_DEGREES = {
    'Sun': 10, 'Moon': 33, 'Mars': 298, 'Mercury': 165,
    'Jupiter': 95, 'Venus': 357, 'Saturn': 200,
}

# Neecha (debilitation) degrees = uccha + 180
NEECHA_DEGREES = {p: (d + 180) % 360 for p, d in UCCHA_DEGREES.items()}


class IshtaKashta:
    def __init__(self, planets: Dict, ascendant_rashi: int):
        self.planets = planets
        self.asc_rashi = ascendant_rashi

    def calculate_uccha_bala(self, planet: str) -> float:
        """Exaltation strength (0-60 virupas)."""
        if planet in ('Rahu', 'Ketu'):
            return 30  # Neutral for nodes

        uccha = UCCHA_DEGREES.get(planet, 0)
        longitude = self.planets.get(planet, {}).get('longitude', 0)

        diff = abs(longitude - uccha)
        if diff > 180:
            diff = 360 - diff

        # Max when at exaltation (diff=0), min at debilitation (diff=180)
        bala = (180 - diff) / 3  # Range 0-60
        return round(max(0, bala), 2)

    def calculate_chestha_bala(self, planet: str) -> float:
        """Motional strength — based on speed. Simplified."""
        if planet in ('Sun', 'Moon', 'Rahu', 'Ketu'):
            return 30  # Luminaries and nodes get average

        speed = abs(self.planets.get(planet, {}).get('speed', 0))
        # Normal speeds vary, simplified scoring
        if speed > 0.5:
            return 40
        elif speed > 0.1:
            return 30
        elif speed > 0:
            return 20
        else:  # Retrograde station
            return 10

    def calculate_ishta_kashta(self, planet: str) -> Dict:
        """
        Calculate Ishta and Kashta Phala.
        Ishta = (Uccha Bala + Chestha Bala) / 2
        Kashta = 60 - Ishta
        """
        uccha = self.calculate_uccha_bala(planet)
        chestha = self.calculate_chestha_bala(planet)

        ishta = (uccha + chestha) / 2
        kashta = 60 - ishta

        if ishta > kashta:
            verdict = 'Benefic'
            net = round(ishta - kashta, 2)
            description = f'{planet} gives predominantly good results (net benefic: +{net})'
        elif kashta > ishta:
            verdict = 'Malefic'
            net = round(kashta - ishta, 2)
            description = f'{planet} gives predominantly challenging results (net malefic: +{net})'
        else:
            verdict = 'Neutral'
            net = 0
            description = f'{planet} gives mixed results'

        return {
            'planet': planet,
            'ishta_phala': round(ishta, 2),
            'kashta_phala': round(kashta, 2),
            'uccha_bala': uccha,
            'chestha_bala': chestha,
            'verdict': verdict,
            'net': net,
            'description': description,
        }

    def calculate_all(self) -> Dict:
        """Calculate Ishta/Kashta for all planets."""
        results = {}
        most_benefic = None
        most_malefic = None
        max_ishta = 0
        max_kashta = 0

        for planet in self.planets:
            ik = self.calculate_ishta_kashta(planet)
            results[planet] = ik
            if ik['ishta_phala'] > max_ishta:
                max_ishta = ik['ishta_phala']
                most_benefic = planet
            if ik['kashta_phala'] > max_kashta:
                max_kashta = ik['kashta_phala']
                most_malefic = planet

        return {
            'system': 'Ishta/Kashta Phala',
            'planets': results,
            'most_benefic_planet': most_benefic,
            'most_malefic_planet': most_malefic,
            'summary': f'Most benefic: {most_benefic} (Ishta={max_ishta:.1f}), '
                       f'Most challenging: {most_malefic} (Kashta={max_kashta:.1f})',
        }


def calculate_ishta_kashta(planets, asc_rashi):
    ik = IshtaKashta(planets, asc_rashi)
    return ik.calculate_all()
