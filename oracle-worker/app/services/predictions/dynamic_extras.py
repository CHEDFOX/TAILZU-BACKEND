"""
JYOTISH ENGINE - DYNAMIC REMEDIES + LUCKY NUMBERS + DYNAMIC MANTRA + COLOR-METAL-FOOD
All transit-aware, changes daily/monthly.
"""

from datetime import datetime
from typing import Dict
from ..numerology.core import _reduce_to_root, NUMBER_MEANINGS

# Planet → food/metal/color mapping
PLANET_DAILY = {
    'Sun': {'color': 'Orange/Red', 'metal': 'Gold/Copper', 'food': 'Wheat, Jaggery, Orange', 'gem': 'Ruby'},
    'Moon': {'color': 'White/Silver', 'metal': 'Silver', 'food': 'Rice, Milk, Curd, Coconut', 'gem': 'Pearl'},
    'Mars': {'color': 'Red/Scarlet', 'metal': 'Copper', 'food': 'Red lentils, Jaggery, Red fruits', 'gem': 'Red Coral'},
    'Mercury': {'color': 'Green', 'metal': 'Brass', 'food': 'Green moong, Green vegetables, Paan', 'gem': 'Emerald'},
    'Jupiter': {'color': 'Yellow/Saffron', 'metal': 'Gold', 'food': 'Chana dal, Turmeric, Bananas, Ghee', 'gem': 'Yellow Sapphire'},
    'Venus': {'color': 'White/Pink', 'metal': 'Silver/Platinum', 'food': 'Sugar, Rice, White sweets, Kheer', 'gem': 'Diamond'},
    'Saturn': {'color': 'Black/Navy', 'metal': 'Iron', 'food': 'Black sesame, Urad dal, Mustard oil', 'gem': 'Blue Sapphire'},
    'Rahu': {'color': 'Dark Blue/Smoke', 'metal': 'Lead', 'food': 'Coconut, Foreign cuisine', 'gem': 'Hessonite'},
    'Ketu': {'color': 'Grey/Brown', 'metal': 'Panchdhatu', 'food': 'Sesame, Banana', 'gem': "Cat's Eye"},
}

DAY_PLANET = {0: 'Moon', 1: 'Mars', 2: 'Mercury', 3: 'Jupiter', 4: 'Venus', 5: 'Saturn', 6: 'Sun'}


class DynamicRemedies:
    """Transit-aware remedies that change monthly."""

    def __init__(self, engine):
        self.engine = engine
        self.natal = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.moon_rashi = engine.planets.get('Moon', {}).get('rashi', 0)

    def get_current_remedies(self) -> Dict:
        """Remedies based on CURRENT transits, not just birth chart."""
        try:
            transits = self.engine.ephemeris.get_current_transits()
        except Exception:
            transits = {}

        remedies = []

        # Saturn transit remedy
        sat_rashi = transits.get('Saturn', {}).get('rashi', 0)
        sat_house = ((sat_rashi - self.moon_rashi) % 12) + 1
        if sat_house in (1, 2, 12):  # Sade Sati
            remedies.append({
                'for': f'Sade Sati (Saturn in {sat_house}th from Moon)',
                'urgency': 'High',
                'remedy': 'Recite Shani Chalisa on Saturdays. Donate black sesame + mustard oil. Serve elderly. Wear dark blue.',
            })
        elif sat_house in (4, 8):
            remedies.append({
                'for': f'Saturn in {sat_house}th from Moon (Kantaka/Ashtama Shani)',
                'urgency': 'High',
                'remedy': 'Hanuman Chalisa daily. Donate iron items on Saturday. Light sesame oil lamp.',
            })

        # Rahu transit remedy
        rahu_rashi = transits.get('Rahu', {}).get('rashi', 0)
        rahu_house = ((rahu_rashi - self.moon_rashi) % 12) + 1
        if rahu_house in (1, 5, 7, 8):
            remedies.append({
                'for': f'Rahu transiting {rahu_house}th from Moon',
                'urgency': 'Medium',
                'remedy': 'Chant Rahu beej mantra on Saturdays. Donate coconut. Avoid alcohol/tobacco.',
            })

        # Jupiter transit benefit
        jup_rashi = transits.get('Jupiter', {}).get('rashi', 0)
        jup_house = ((jup_rashi - self.moon_rashi) % 12) + 1
        if jup_house in (2, 5, 7, 9, 11):
            remedies.append({
                'for': f'Jupiter in {jup_house}th from Moon (favorable)',
                'urgency': 'Low',
                'remedy': f'Maximize Jupiter energy: wear yellow on Thursdays, donate turmeric, visit temple. Jupiter is blessing your house {jup_house}.',
            })

        # Dasha-specific current remedy
        try:
            dasha = self.engine.get_vimshottari_dasha()
            maha = dasha['mahadasha']['lord']
            pd = PLANET_DAILY.get(maha, {})
            remedies.append({
                'for': f'Current {maha} Mahadasha support',
                'urgency': 'Ongoing',
                'remedy': f'Wear {pd.get("color","")} on {maha} day. Eat {pd.get("food","")}. Strengthen with {pd.get("gem","")} if affordable.',
            })
        except Exception:
            pass

        return {'transit_remedies': remedies, 'count': len(remedies)}


class LuckyNumberFinder:
    """Lucky phone/car/house numbers based on numerology + chart."""

    def __init__(self, engine):
        bd = engine.birth_local
        self.mulank = _reduce_to_root(bd.day)
        self.bhagyank = _reduce_to_root(bd.day + bd.month + bd.year)
        if self.bhagyank > 9: self.bhagyank = _reduce_to_root(self.bhagyank)
        self.compatible = NUMBER_MEANINGS.get(self.mulank, {}).get('compatible', [])

    def find_lucky(self) -> Dict:
        lucky_nums = sorted(set([self.mulank, self.bhagyank] + self.compatible))

        # Generate phone number pattern
        phone_digits = [str(self.mulank)] * 3 + [str(self.bhagyank)] * 2
        phone_hint = f'Numbers containing {self.mulank} and {self.bhagyank} are luckiest'

        # Car/bike number
        ideal_total = self.mulank
        car_examples = []
        for i in range(1000, 9999):
            if _reduce_to_root(i) in lucky_nums:
                car_examples.append(i)
                if len(car_examples) >= 5:
                    break

        # House/flat number
        house_nums = [n for n in range(1, 100) if _reduce_to_root(n) in lucky_nums][:10]

        return {
            'mulank': self.mulank,
            'bhagyank': self.bhagyank,
            'lucky_single_digits': lucky_nums,
            'phone_hint': phone_hint,
            'car_plate_examples': car_examples,
            'lucky_house_numbers': house_nums,
            'avoid_numbers': [n for n in range(1, 10) if n not in lucky_nums and n not in [self.mulank, self.bhagyank]],
        }


class DynamicMantra:
    """Mantra that changes based on current hora + dasha + transit."""

    def __init__(self, engine):
        self.engine = engine

    def get_current_mantra(self) -> Dict:
        # The hora and the day lord at the chart's place, on its real sunrise —
        # this read the server's clock and counted clock hours from 06:00.
        try:
            h = self.engine.get_current_hora_info()
            hora_planet, day_planet = h['hora_lord'], h['day_lord']
        except Exception:
            now = datetime.now()
            day_planet = DAY_PLANET.get(now.weekday(), 'Sun')
            hora_planet = day_planet

        # Dasha planet
        try:
            dasha = self.engine.get_vimshottari_dasha()
            dasha_planet = dasha['mahadasha']['lord']
        except Exception:
            dasha_planet = 'Jupiter'

        BEEJ_MANTRAS = {
            'Sun': 'Om Hraam Hreem Hraum Sah Suryaya Namah',
            'Moon': 'Om Shraam Shreem Shraum Sah Chandraya Namah',
            'Mars': 'Om Kraam Kreem Kraum Sah Bhaumaya Namah',
            'Mercury': 'Om Braam Breem Braum Sah Budhaya Namah',
            'Jupiter': 'Om Graam Greem Graum Sah Gurave Namah',
            'Venus': 'Om Draam Dreem Draum Sah Shukraya Namah',
            'Saturn': 'Om Praam Preem Praum Sah Shanaischaraya Namah',
            'Rahu': 'Om Bhraam Bhreem Bhraum Sah Rahave Namah',
            'Ketu': 'Om Sraam Sreem Sraum Sah Ketave Namah',
        }

        # Primary = intersection of dasha + hora (most powerful right now)
        primary = hora_planet if hora_planet == dasha_planet else dasha_planet

        return {
            'primary_mantra': BEEJ_MANTRAS.get(primary, ''),
            'primary_planet': primary,
            'reason': f'{primary} is {"both hora lord and dasha lord" if hora_planet == dasha_planet else "your dasha lord"} right now',
            'hora_mantra': BEEJ_MANTRAS.get(hora_planet, ''),
            'hora_planet': hora_planet,
            'day_mantra': BEEJ_MANTRAS.get(day_planet, ''),
            'day_planet': day_planet,
            'count': 108,
            'best_time': 'Right now' if hora_planet == dasha_planet else f'During {dasha_planet} hora',
        }


class ColorMetalFood:
    """What to wear, eat, use TODAY based on chart + day + transit."""

    def __init__(self, engine):
        self.engine = engine
        bd = engine.birth_local
        self.mulank = _reduce_to_root(bd.day)

    def get_today(self) -> Dict:
        try:
            weekday = self.engine.local_now().weekday()
        except Exception:
            weekday = datetime.now().weekday()
        day_planet = DAY_PLANET.get(weekday, 'Sun')
        pd = PLANET_DAILY.get(day_planet, {})

        try:
            dasha = self.engine.get_vimshottari_dasha()
            dasha_planet = dasha['mahadasha']['lord']
            dasha_pd = PLANET_DAILY.get(dasha_planet, {})
        except Exception:
            dasha_planet = 'Jupiter'
            dasha_pd = PLANET_DAILY.get('Jupiter', {})

        num_data = NUMBER_MEANINGS.get(self.mulank, {})

        return {
            'day': datetime.now().strftime('%A'),
            'day_planet': day_planet,
            'wear_color': pd.get('color', ''),
            'wear_metal': pd.get('metal', ''),
            'eat': pd.get('food', ''),
            'dasha_boost_color': dasha_pd.get('color', ''),
            'dasha_boost_food': dasha_pd.get('food', ''),
            'numerology_color': num_data.get('color', ''),
            'gem_of_the_day': pd.get('gem', ''),
            'combined_recommendation': f'Wear {pd.get("color", "")}. Eat {pd.get("food", "").split(",")[0]}. '
                                       f'Metal: {pd.get("metal", "")}. '
                                       f'Dasha boost: add {dasha_pd.get("color", "")} accent.',
        }


def get_dynamic_remedies(engine):
    return DynamicRemedies(engine).get_current_remedies()

def get_lucky_numbers(engine):
    return LuckyNumberFinder(engine).find_lucky()

def get_dynamic_mantra(engine):
    return DynamicMantra(engine).get_current_mantra()

def get_color_metal_food(engine):
    return ColorMetalFood(engine).get_today()
