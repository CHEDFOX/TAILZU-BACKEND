"""
JYOTISH ENGINE - CHARA DASHA (JAIMINI SIGN-BASED TIMING)
Completely different timing system from Vimshottari.

Key differences:
- Vimshottari: Planet-based, 120-year cycle, Moon's nakshatra determines starting point
- Chara Dasha: Sign-based, variable cycle, Ascendant determines starting point

When both systems point to the same event window → HIGH CONFIDENCE prediction.

Based on Jaimini Sutras. Uses:
- Sign strength to determine dasha duration
- Chara Karakas for event mapping
- Rashi aspects (different from Parashara aspects)
"""

from datetime import datetime, timedelta
from typing import Dict, List
from ..core.constants import (
    PLANETS, RASHI_LORDS, RASHI_NAMES,
)


# Chara Dasha order depends on whether Ascendant is in odd or even sign
# Odd signs (Aries, Gemini, Leo, Libra, Sagittarius, Aquarius): forward from Ascendant
# Even signs (Taurus, Cancer, Virgo, Scorpio, Capricorn, Pisces): backward from Ascendant

ODD_SIGNS = {0, 2, 4, 6, 8, 10}   # Aries=0, Gemini=2, Leo=4, etc.
EVEN_SIGNS = {1, 3, 5, 7, 9, 11}   # Taurus=1, Cancer=3, etc.

# Maximum years for a sign dasha (some schools cap at 12)
MAX_DASHA_YEARS = 12


class CharaDasha:
    """
    Jaimini Chara Dasha Calculator.
    Sign-based dasha system for cross-validation with Vimshottari.
    """

    def __init__(self, planets: Dict, ascendant_rashi: int, birth_datetime: datetime):
        """
        Args:
            planets: Dict of planet data with 'rashi', 'longitude'
            ascendant_rashi: Ascendant sign (0=Aries, 11=Pisces)
            birth_datetime: Birth datetime (UTC)
        """
        self.planets = planets
        self.asc_rashi = ascendant_rashi
        self.birth_dt = birth_datetime
        self._dasha_sequence = None
        self._periods = None

    def _is_odd_sign(self, rashi: int) -> bool:
        return rashi in ODD_SIGNS

    def _get_sign_lord(self, rashi: int) -> str:
        return RASHI_LORDS[rashi]

    def _get_planet_rashi(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('rashi', 0)

    def _get_planet_longitude(self, planet: str) -> float:
        return self.planets.get(planet, {}).get('longitude', 0.0)

    def _get_planet_degree_in_sign(self, planet: str) -> float:
        return self._get_planet_longitude(planet) % 30

    def get_dasha_sequence(self) -> List[int]:
        """
        Determine the order of signs for Chara Dasha.
        Odd Ascendant → signs go forward (Aries, Taurus, Gemini...)
        Even Ascendant → signs go backward (Pisces, Aquarius, Capricorn...)
        Starting from the Ascendant sign.
        """
        if self._dasha_sequence is not None:
            return self._dasha_sequence

        if self._is_odd_sign(self.asc_rashi):
            # Forward from Ascendant
            sequence = [(self.asc_rashi + i) % 12 for i in range(12)]
        else:
            # Backward from Ascendant
            sequence = [(self.asc_rashi - i) % 12 for i in range(12)]

        self._dasha_sequence = sequence
        return sequence

    def calculate_sign_dasha_years(self, rashi: int) -> int:
        """
        Calculate how many years a sign's dasha lasts.

        Method (K.N. Rao school):
        - Find the lord of the sign
        - Count signs from the sign to its lord's position
        - For odd signs: count forward
        - For even signs: count backward
        - Subtract 1 to get years (0 becomes 12)
        """
        lord = self._get_sign_lord(rashi)
        lord_rashi = self._get_planet_rashi(lord)

        if self._is_odd_sign(rashi):
            # Count forward from sign to lord
            distance = (lord_rashi - rashi) % 12
        else:
            # Count backward from sign to lord
            distance = (rashi - lord_rashi) % 12

        # The dasha years = distance
        # If lord is in own sign, distance = 0, which means 12 years
        years = distance if distance > 0 else 12

        # Cap at maximum
        return min(years, MAX_DASHA_YEARS)

    def calculate_all_periods(self) -> List[Dict]:
        """Calculate complete Chara Dasha periods from birth."""
        if self._periods is not None:
            return self._periods

        sequence = self.get_dasha_sequence()
        periods = []
        current_date = self.birth_dt

        # First cycle (12 signs)
        for cycle in range(2):  # 2 cycles covers ~120+ years
            for rashi in sequence:
                years = self.calculate_sign_dasha_years(rashi)
                end_date = current_date + timedelta(days=years * 365.25)

                # Get planets in this sign
                occupants = [
                    p for p, d in self.planets.items()
                    if d.get('rashi') == rashi
                ]

                lord = self._get_sign_lord(rashi)
                lord_rashi = self._get_planet_rashi(lord)
                lord_house_from_sign = ((lord_rashi - rashi) % 12) + 1

                periods.append({
                    'rashi': rashi,
                    'rashi_name': RASHI_NAMES[rashi],
                    'lord': lord,
                    'lord_rashi': lord_rashi,
                    'lord_position': RASHI_NAMES[lord_rashi],
                    'lord_house_from_sign': lord_house_from_sign,
                    'years': years,
                    'start': current_date.strftime('%Y-%m-%d'),
                    'end': end_date.strftime('%Y-%m-%d'),
                    'start_dt': current_date,
                    'end_dt': end_date,
                    'occupants': occupants,
                    'cycle': cycle + 1,
                })

                current_date = end_date

        self._periods = periods
        return periods

    def get_current_dasha(self, query_date: datetime = None) -> Dict:
        """Get the current Chara Dasha period."""
        if query_date is None:
            query_date = datetime.now()

        periods = self.calculate_all_periods()

        current = None
        for period in periods:
            if period['start_dt'] <= query_date < period['end_dt']:
                current = period
                break

        if current is None:
            current = periods[0]

        # Find sub-period (antardasha equivalent)
        sub = self._calculate_sub_period(current, query_date)

        return {
            'mahadasha': {
                'rashi': current['rashi'],
                'rashi_name': current['rashi_name'],
                'lord': current['lord'],
                'years': current['years'],
                'start': current['start'],
                'end': current['end'],
                'occupants': current['occupants'],
            },
            'antardasha': sub,
            'dasha_string': f"{current['rashi_name']}/{sub['rashi_name']}",
        }

    def _calculate_sub_period(self, maha_period: Dict, query_date: datetime) -> Dict:
        """
        Calculate sub-period within a Chara Dasha mahadasha.
        Sub-periods follow same sequence starting from the mahadasha sign.
        """
        maha_rashi = maha_period['rashi']
        maha_years = maha_period['years']
        maha_start = maha_period['start_dt']

        # Sub-period sequence
        if self._is_odd_sign(maha_rashi):
            sub_sequence = [(maha_rashi + i) % 12 for i in range(12)]
        else:
            sub_sequence = [(maha_rashi - i) % 12 for i in range(12)]

        # Each sub-period duration
        total_sub_years = sum(
            self.calculate_sign_dasha_years(r) for r in sub_sequence
        )

        current_start = maha_start

        for sub_rashi in sub_sequence:
            sub_years = self.calculate_sign_dasha_years(sub_rashi)
            # Proportional duration within mahadasha
            proportion = sub_years / total_sub_years if total_sub_years > 0 else 1/12
            actual_days = maha_years * 365.25 * proportion
            sub_end = current_start + timedelta(days=actual_days)

            if current_start <= query_date < sub_end:
                return {
                    'rashi': sub_rashi,
                    'rashi_name': RASHI_NAMES[sub_rashi],
                    'lord': self._get_sign_lord(sub_rashi),
                    'start': current_start.strftime('%Y-%m-%d'),
                    'end': sub_end.strftime('%Y-%m-%d'),
                }

            current_start = sub_end

        # Fallback
        return {
            'rashi': sub_sequence[0],
            'rashi_name': RASHI_NAMES[sub_sequence[0]],
            'lord': self._get_sign_lord(sub_sequence[0]),
            'start': maha_start.strftime('%Y-%m-%d'),
            'end': maha_period['end'],
        }

    def get_dasha_for_date(self, target_date: datetime) -> Dict:
        """Get Chara Dasha for any date."""
        return self.get_current_dasha(target_date)

    def analyze_current_period(self) -> Dict:
        """Deep analysis of current Chara Dasha period."""
        current = self.get_current_dasha()
        maha = current['mahadasha']
        sub = current['antardasha']

        maha_rashi = maha['rashi']
        sub_rashi = sub['rashi']

        # What houses are activated?
        maha_house_from_lagna = ((maha_rashi - self.asc_rashi) % 12) + 1
        sub_house_from_lagna = ((sub_rashi - self.asc_rashi) % 12) + 1

        # What's the relationship between maha and sub signs?
        distance = ((sub_rashi - maha_rashi) % 12) + 1

        if distance in (1, 5, 9):
            relationship = 'Trikona (Harmonious)'
            harmony = 'Good'
        elif distance in (4, 7, 10):
            relationship = 'Kendra (Active)'
            harmony = 'Dynamic'
        elif distance in (6, 8, 12):
            relationship = 'Dusthana (Challenging)'
            harmony = 'Difficult'
        else:
            relationship = 'Neutral'
            harmony = 'Mixed'

        # Theme analysis
        house_themes = {
            1: 'Self, health, new beginnings',
            2: 'Wealth, family, speech',
            3: 'Courage, siblings, short travel',
            4: 'Home, mother, property, comfort',
            5: 'Children, romance, intelligence, creativity',
            6: 'Health challenges, enemies, service',
            7: 'Marriage, partnerships, business',
            8: 'Transformation, occult, inheritance',
            9: 'Fortune, father, higher learning, travel',
            10: 'Career, status, authority',
            11: 'Gains, income, friends, desires fulfilled',
            12: 'Loss, foreign, spirituality, expenses',
        }

        return {
            'current': current,
            'mahadasha_house': maha_house_from_lagna,
            'mahadasha_theme': house_themes.get(maha_house_from_lagna, ''),
            'antardasha_house': sub_house_from_lagna,
            'antardasha_theme': house_themes.get(sub_house_from_lagna, ''),
            'relationship': relationship,
            'harmony': harmony,
            'planets_activated': maha['occupants'],
            'lord_analysis': {
                'mahadasha_lord': maha['lord'],
                'antardasha_lord': sub['lord'],
                'lord_relationship': self._check_lord_friendship(maha['lord'], sub['lord']),
            },
        }

    def _check_lord_friendship(self, lord1: str, lord2: str) -> str:
        """Check natural friendship between two planets."""
        friends = PLANETS.get(lord1, {}).get('friends', [])
        enemies = PLANETS.get(lord1, {}).get('enemies', [])
        if lord2 in friends:
            return 'Friends'
        elif lord2 in enemies:
            return 'Enemies'
        return 'Neutral'

    def cross_validate_with_vimshottari(self, vimshottari_data: Dict) -> Dict:
        """
        Cross-validate Chara Dasha with Vimshottari Dasha.
        When both systems activate the same houses → HIGH confidence.
        """
        chara = self.analyze_current_period()
        vim_maha = vimshottari_data.get('mahadasha', {}).get('lord', '')
        vim_antar = vimshottari_data.get('antardasha', {}).get('lord', '')

        # Which houses does Vimshottari activate?
        vim_maha_house = self.planets.get(vim_maha, {}).get('house', 0)
        vim_antar_house = self.planets.get(vim_antar, {}).get('house', 0)
        vim_houses = {vim_maha_house, vim_antar_house}

        # Which houses does Chara activate?
        chara_houses = {chara['mahadasha_house'], chara['antardasha_house']}

        # Find overlap
        overlap = vim_houses & chara_houses
        overlap.discard(0)  # Remove invalid

        # Calculate agreement score
        if len(overlap) >= 2:
            agreement = 'Very High'
            confidence_boost = 0.25
            description = f'Both systems activate houses {overlap} — very strong indication'
        elif len(overlap) == 1:
            agreement = 'High'
            confidence_boost = 0.15
            description = f'Both systems activate house {overlap.pop()} — strong indication'
        else:
            # Check if lords are related
            chara_lords = {chara['current']['mahadasha']['lord'], chara['current']['antardasha']['lord']}
            vim_lords = {vim_maha, vim_antar}
            lord_overlap = chara_lords & vim_lords
            if lord_overlap:
                agreement = 'Moderate'
                confidence_boost = 0.10
                description = f'Same planet(s) {lord_overlap} active in both systems'
            else:
                agreement = 'Low'
                confidence_boost = 0.0
                description = 'Different houses and lords active — mixed signals'

        return {
            'vimshottari': f'{vim_maha}/{vim_antar}',
            'chara': chara['current']['dasha_string'],
            'vimshottari_houses': list(vim_houses),
            'chara_houses': list(chara_houses),
            'overlapping_houses': list(overlap) if isinstance(overlap, set) else [],
            'agreement': agreement,
            'confidence_boost': confidence_boost,
            'description': description,
        }

    def get_upcoming_periods(self, count: int = 5) -> List[Dict]:
        """Get the next N upcoming Chara Dasha periods."""
        now = datetime.now()
        periods = self.calculate_all_periods()
        upcoming = []

        for period in periods:
            if period['end_dt'] > now:
                upcoming.append({
                    'rashi_name': period['rashi_name'],
                    'lord': period['lord'],
                    'years': period['years'],
                    'start': period['start'],
                    'end': period['end'],
                    'occupants': period['occupants'],
                    'house_from_lagna': ((period['rashi'] - self.asc_rashi) % 12) + 1,
                })
                if len(upcoming) >= count:
                    break

        return upcoming


def calculate_chara_dasha(planets: Dict, asc_rashi: int, birth_dt: datetime) -> Dict:
    """Convenience function."""
    cd = CharaDasha(planets, asc_rashi, birth_dt)
    return cd.get_current_dasha()
