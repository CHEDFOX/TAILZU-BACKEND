"""
JYOTISH ENGINE - VIMSHOTTARI DASHA
120-year planetary period system
"""

from datetime import datetime, timedelta
from typing import Dict, List
from ..core.constants import (
    VIMSHOTTARI_YEARS, VIMSHOTTARI_ORDER, VIMSHOTTARI_TOTAL,
    NAKSHATRA_LORDS, PLANETS
)
from ..core.utils import get_nakshatra_from_longitude


class VimshottariDasha:
    """
    Calculate Vimshottari Dasha periods
    Based on Moon's nakshatra at birth
    """
    
    def __init__(self, moon_longitude: float, birth_datetime: datetime):
        """
        Initialize with Moon position and birth time
        
        Args:
            moon_longitude: Moon's sidereal longitude (0-360)
            birth_datetime: Birth date and time
        """
        self.moon_longitude = moon_longitude
        self.birth_dt = birth_datetime
        
        # Calculate nakshatra and initial dasha
        self.nakshatra = get_nakshatra_from_longitude(moon_longitude)
        self.nakshatra_lord = NAKSHATRA_LORDS[self.nakshatra]
        
        # Calculate balance of first dasha
        self.dasha_balance = self._calculate_dasha_balance()
    
    def _calculate_dasha_balance(self) -> float:
        """
        Calculate remaining years of first dasha at birth
        Based on portion of nakshatra traversed by Moon
        """
        # Each nakshatra spans 13°20' (13.333... degrees)
        nakshatra_span = 360 / 27
        
        # Moon's position within nakshatra
        degree_in_nakshatra = self.moon_longitude % nakshatra_span
        
        # Portion traversed (0 to 1)
        portion_traversed = degree_in_nakshatra / nakshatra_span
        
        # Remaining portion
        portion_remaining = 1 - portion_traversed
        
        # Dasha years for nakshatra lord
        dasha_years = VIMSHOTTARI_YEARS[self.nakshatra_lord]
        
        # Remaining years
        return dasha_years * portion_remaining
    
    def get_dasha_sequence(self) -> List[str]:
        """Get dasha sequence starting from birth dasha"""
        start_index = VIMSHOTTARI_ORDER.index(self.nakshatra_lord)
        sequence = []
        
        for i in range(9):  # 9 dashas in cycle
            index = (start_index + i) % 9
            sequence.append(VIMSHOTTARI_ORDER[index])
        
        return sequence
    
    def calculate_mahadasha_periods(self, years_to_calculate: int = 120) -> List[Dict]:
        """
        Calculate Mahadasha (major period) dates
        
        Args:
            years_to_calculate: How many years to calculate (default 120)
        
        Returns:
            List of Mahadasha periods with start/end dates
        """
        periods = []
        current_date = self.birth_dt
        sequence = self.get_dasha_sequence()
        
        # First dasha (with balance)
        first_lord = sequence[0]
        first_end = current_date + timedelta(days=self.dasha_balance * 365.25)
        
        periods.append({
            'lord': first_lord,
            'start': current_date,
            'end': first_end,
            'years': round(self.dasha_balance, 2),
            'is_birth_dasha': True,
        })
        
        current_date = first_end
        total_years = self.dasha_balance
        
        # Subsequent dashas
        for i in range(1, len(sequence)):
            if total_years >= years_to_calculate:
                break
            
            lord = sequence[i]
            years = VIMSHOTTARI_YEARS[lord]
            end_date = current_date + timedelta(days=years * 365.25)
            
            periods.append({
                'lord': lord,
                'start': current_date,
                'end': end_date,
                'years': years,
                'is_birth_dasha': False,
            })
            
            current_date = end_date
            total_years += years
        
        # Add more cycles if needed
        cycle = 1
        while total_years < years_to_calculate:
            for lord in VIMSHOTTARI_ORDER:
                if total_years >= years_to_calculate:
                    break
                
                years = VIMSHOTTARI_YEARS[lord]
                end_date = current_date + timedelta(days=years * 365.25)
                
                periods.append({
                    'lord': lord,
                    'start': current_date,
                    'end': end_date,
                    'years': years,
                    'cycle': cycle + 1,
                })
                
                current_date = end_date
                total_years += years
            
            cycle += 1
        
        return periods
    
    def calculate_antardasha(self, mahadasha_lord: str, 
                             maha_start: datetime, maha_years: float) -> List[Dict]:
        """
        Calculate Antardasha (sub-periods) within a Mahadasha
        
        Args:
            mahadasha_lord: Lord of Mahadasha
            maha_start: Start date of Mahadasha
            maha_years: Duration of Mahadasha in years
        """
        antardashas = []
        start_index = VIMSHOTTARI_ORDER.index(mahadasha_lord)
        current_date = maha_start
        
        for i in range(9):
            antar_lord = VIMSHOTTARI_ORDER[(start_index + i) % 9]
            
            # Antardasha duration = (Mahadasha years × Antardasha lord years) / 120
            antar_years = (maha_years * VIMSHOTTARI_YEARS[antar_lord]) / VIMSHOTTARI_TOTAL
            antar_days = antar_years * 365.25
            
            end_date = current_date + timedelta(days=antar_days)
            
            antardashas.append({
                'lord': antar_lord,
                'start': current_date,
                'end': end_date,
                'years': round(antar_years, 4),
                'months': round(antar_years * 12, 2),
                'days': round(antar_days, 0),
            })
            
            current_date = end_date
        
        return antardashas
    
    def calculate_pratyantardasha(self, mahadasha_lord: str, antardasha_lord: str,
                                   antar_start: datetime, antar_years: float) -> List[Dict]:
        """
        Calculate Pratyantardasha (sub-sub-periods)
        
        Args:
            mahadasha_lord: Lord of Mahadasha
            antardasha_lord: Lord of Antardasha
            antar_start: Start date of Antardasha
            antar_years: Duration of Antardasha in years
        """
        pratyantars = []
        start_index = VIMSHOTTARI_ORDER.index(antardasha_lord)
        current_date = antar_start
        
        for i in range(9):
            prat_lord = VIMSHOTTARI_ORDER[(start_index + i) % 9]
            
            # Pratyantardasha duration
            prat_years = (antar_years * VIMSHOTTARI_YEARS[prat_lord]) / VIMSHOTTARI_TOTAL
            prat_days = prat_years * 365.25
            
            end_date = current_date + timedelta(days=prat_days)
            
            pratyantars.append({
                'lord': prat_lord,
                'start': current_date,
                'end': end_date,
                'days': round(prat_days, 1),
            })
            
            current_date = end_date
        
        return pratyantars
    
    def calculate_sookshmadasha(self, mahadasha_lord: str, antardasha_lord: str,
                                pratyantardasha_lord: str,
                                prat_start: datetime, prat_days: float) -> List[Dict]:
        """
        Calculate Sookshmadasha (sub-sub-sub-periods) — BPHS same proportion formula.
        Gives time windows of DAYS.
        """
        sookshmas = []
        start_index = VIMSHOTTARI_ORDER.index(pratyantardasha_lord)
        prat_years = prat_days / 365.25
        current_date = prat_start

        for i in range(9):
            sookshma_lord = VIMSHOTTARI_ORDER[(start_index + i) % 9]
            sookshma_years = (prat_years * VIMSHOTTARI_YEARS[sookshma_lord]) / VIMSHOTTARI_TOTAL
            sookshma_days = sookshma_years * 365.25
            end_date = current_date + timedelta(days=sookshma_days)

            sookshmas.append({
                'lord': sookshma_lord,
                'start': current_date,
                'end': end_date,
                'days': round(sookshma_days, 2),
                'hours': round(sookshma_days * 24, 1),
            })
            current_date = end_date

        return sookshmas

    def calculate_pranadasha(self, sookshma_lord: str,
                              sookshma_start: datetime, sookshma_days: float) -> List[Dict]:
        """
        Calculate Pranadasha (sub-sub-sub-sub-periods) — BPHS same proportion formula.
        Gives time windows of HOURS.
        """
        pranas = []
        start_index = VIMSHOTTARI_ORDER.index(sookshma_lord)
        sookshma_years = sookshma_days / 365.25
        current_date = sookshma_start

        for i in range(9):
            prana_lord = VIMSHOTTARI_ORDER[(start_index + i) % 9]
            prana_years = (sookshma_years * VIMSHOTTARI_YEARS[prana_lord]) / VIMSHOTTARI_TOTAL
            prana_days = prana_years * 365.25
            prana_hours = prana_days * 24
            prana_minutes = prana_hours * 60
            end_date = current_date + timedelta(days=prana_days)

            pranas.append({
                'lord': prana_lord,
                'start': current_date,
                'end': end_date,
                'hours': round(prana_hours, 2),
                'minutes': round(prana_minutes, 1),
            })
            current_date = end_date

        return pranas

    def get_current_dasha(self, query_date: datetime = None) -> Dict:
        """
        Get current running dasha at given date
        
        Returns:
            Dict with Mahadasha, Antardasha, Pratyantardasha
        """
        if query_date is None:
            query_date = datetime.now()
        
        # Get all mahadashas
        mahadashas = self.calculate_mahadasha_periods()
        
        current_maha = None
        for maha in mahadashas:
            if maha['start'] <= query_date < maha['end']:
                current_maha = maha
                break
        
        if not current_maha:
            return {'error': 'Date outside calculated range'}
        
        # Get antardashas within current mahadasha
        antardashas = self.calculate_antardasha(
            current_maha['lord'],
            current_maha['start'],
            current_maha['years']
        )
        
        current_antar = None
        for antar in antardashas:
            if antar['start'] <= query_date < antar['end']:
                current_antar = antar
                break
        
        if not current_antar:
            current_antar = antardashas[0]
        
        # Get pratyantardashas
        pratyantars = self.calculate_pratyantardasha(
            current_maha['lord'],
            current_antar['lord'],
            current_antar['start'],
            current_antar['years']
        )
        
        current_prat = None
        for prat in pratyantars:
            if prat['start'] <= query_date < prat['end']:
                current_prat = prat
                break
        
        if not current_prat:
            current_prat = pratyantars[0]
        
        result = {
            'query_date': query_date.isoformat(),
            'mahadasha': {
                'lord': current_maha['lord'],
                'start': current_maha['start'].isoformat(),
                'end': current_maha['end'].isoformat(),
                'years_total': current_maha['years'],
                'years_remaining': round((current_maha['end'] - query_date).days / 365.25, 2),
            },
            'antardasha': {
                'lord': current_antar['lord'],
                'start': current_antar['start'].isoformat(),
                'end': current_antar['end'].isoformat(),
                'months': current_antar['months'],
            },
            'pratyantardasha': {
                'lord': current_prat['lord'],
                'start': current_prat['start'].isoformat(),
                'end': current_prat['end'].isoformat(),
                'days': current_prat['days'],
            },
            'dasha_string': f"{current_maha['lord']}-{current_antar['lord']}-{current_prat['lord']}",
        }

        # Sookshma dasha — BPHS same proportion formula, level 4 (days)
        try:
            sookshmas = self.calculate_sookshmadasha(
                current_maha['lord'], current_antar['lord'], current_prat['lord'],
                current_prat['start'], current_prat['days'])
            current_sookshma = sookshmas[0]
            for s in sookshmas:
                if s['start'] <= query_date < s['end']:
                    current_sookshma = s
                    break
            result['sookshmadasha'] = {
                'lord': current_sookshma['lord'],
                'start': current_sookshma['start'].isoformat(),
                'end': current_sookshma['end'].isoformat(),
                'days': current_sookshma['days'],
                'hours': current_sookshma['hours'],
            }
            pranas = self.calculate_pranadasha(
                current_sookshma['lord'],
                current_sookshma['start'], current_sookshma['days'])
            current_prana = pranas[0]
            for pr in pranas:
                if pr['start'] <= query_date < pr['end']:
                    current_prana = pr
                    break
            result['pranadasha'] = {
                'lord': current_prana['lord'],
                'start': current_prana['start'].isoformat(),
                'end': current_prana['end'].isoformat(),
                'hours': current_prana['hours'],
                'minutes': current_prana['minutes'],
            }
            result['dasha_string'] = f"{result['mahadasha']['lord']}-{result['antardasha']['lord']}-{result['pratyantardasha']['lord']}-{current_sookshma['lord']}-{current_prana['lord']}"
        except Exception:
            pass

        return result

    def get_dasha_for_date(self, target_date: datetime) -> Dict:
        """Alias for get_current_dasha with specific date"""
        return self.get_current_dasha(target_date)
    
    def find_dasha_period(self, mahadasha_lord: str, 
                          antardasha_lord: str = None) -> List[Dict]:
        """
        Find when a specific dasha combination will occur
        
        Args:
            mahadasha_lord: Required Mahadasha lord
            antardasha_lord: Optional Antardasha lord
        
        Returns:
            List of matching periods
        """
        matches = []
        mahadashas = self.calculate_mahadasha_periods()
        
        for maha in mahadashas:
            if maha['lord'] != mahadasha_lord:
                continue
            
            if antardasha_lord is None:
                matches.append({
                    'type': 'Mahadasha',
                    'mahadasha': mahadasha_lord,
                    'start': maha['start'].isoformat(),
                    'end': maha['end'].isoformat(),
                })
            else:
                antardashas = self.calculate_antardasha(
                    maha['lord'], maha['start'], maha['years']
                )
                for antar in antardashas:
                    if antar['lord'] == antardasha_lord:
                        matches.append({
                            'type': 'Antardasha',
                            'mahadasha': mahadasha_lord,
                            'antardasha': antardasha_lord,
                            'start': antar['start'].isoformat(),
                            'end': antar['end'].isoformat(),
                        })
        
        return matches
    
    def analyze_dasha_effects(self, mahadasha_lord: str, 
                              planets: Dict, ascendant_rashi: int) -> Dict:
        """
        Analyze expected effects of a Mahadasha
        
        Args:
            mahadasha_lord: Dasha lord
            planets: Planet positions
            ascendant_rashi: Ascendant rashi
        """
        planet_data = planets.get(mahadasha_lord, {})
        planet_rashi = planet_data.get('rashi', 0)
        planet_house = planet_data.get('house', 1)
        
        # Determine houses ruled by dasha lord
        houses_owned = []
        for house in range(1, 13):
            house_rashi = (ascendant_rashi + house - 1) % 12
            if house_rashi in PLANETS.get(mahadasha_lord, {}).get('owns', []):
                houses_owned.append(house)
        
        # Check dignity
        from ..parashara.dignity import PlanetaryDignity
        dignity = PlanetaryDignity.get_dignity(mahadasha_lord, planet_rashi)
        
        # Determine general effects
        effects = []
        
        # House position effects
        house_effects = {
            1: 'Focus on self, health, new beginnings',
            2: 'Wealth, family matters, speech',
            3: 'Siblings, courage, short journeys, skills',
            4: 'Home, mother, property, vehicles, peace',
            5: 'Children, creativity, romance, education',
            6: 'Health challenges, enemies, debts, service',
            7: 'Marriage, partnerships, business',
            8: 'Transformation, obstacles, inheritance',
            9: 'Luck, father, higher learning, travel',
            10: 'Career, status, authority, achievements',
            11: 'Gains, income, friends, wishes fulfilled',
            12: 'Expenses, foreign travel, spirituality, losses',
        }
        
        effects.append(house_effects.get(planet_house, ''))
        
        # Dignity effects
        if dignity['is_exalted']:
            effects.append('Excellent results due to exaltation')
        elif dignity['is_debilitated']:
            effects.append('Challenges due to debilitation')
        elif dignity['is_own_sign']:
            effects.append('Good results, planet in own sign')
        
        return {
            'dasha_lord': mahadasha_lord,
            'house_position': planet_house,
            'rashi': planet_rashi,
            'houses_owned': houses_owned,
            'dignity': dignity['dignity'],
            'strength': dignity['strength'],
            'expected_effects': effects,
            'areas_activated': [f"House {h}" for h in houses_owned + [planet_house]],
        }


# Convenience functions
def calculate_vimshottari(moon_longitude: float, birth_datetime: datetime) -> Dict:
    """Quick function to calculate current dasha"""
    calculator = VimshottariDasha(moon_longitude, birth_datetime)
    return calculator.get_current_dasha()

def get_dasha_periods(moon_longitude: float, birth_datetime: datetime, 
                      years: int = 120) -> List[Dict]:
    """Get all Mahadasha periods"""
    calculator = VimshottariDasha(moon_longitude, birth_datetime)
    return calculator.calculate_mahadasha_periods(years)
