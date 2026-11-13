"""
JYOTISH ENGINE - COMPLETE REMEDIES SYSTEM
Personalized remedies based on chart analysis.

1. Gemstone recommendations (mapped to Shadbala + dignity)
2. Mantras (planet-specific + nakshatra deity + dasha-based)
3. Donation & ritual remedies (day-specific)
4. Color therapy & fasting
5. Temple & deity recommendations
"""

from typing import Dict, List
from ..core.constants import (
    PLANETS, RASHI_LORDS, DUSTHANA_HOUSES,
)

# ═══════════════════════════════════════════════════════════════════
# GEMSTONE DATA
# ═══════════════════════════════════════════════════════════════════

GEMSTONE_DATA = {
    'Sun': {
        'primary': 'Ruby',
        'substitute': ['Garnet', 'Red Spinel', 'Star Ruby'],
        'metal': 'Gold',
        'finger': 'Ring finger',
        'weight_min': 3,  # carats
        'weight_ideal': 5,
        'day': 'Sunday',
        'time': 'Morning (Sunrise)',
        'mantra': 'Om Suryaya Namah',
        'mantra_count': 7000,
        'enemies': ['Saturn', 'Venus'],
        'contraindications': 'Never wear with Blue Sapphire or Diamond',
    },
    'Moon': {
        'primary': 'Pearl',
        'substitute': ['Moonstone', 'White Coral'],
        'metal': 'Silver',
        'finger': 'Little finger',
        'weight_min': 4,
        'weight_ideal': 6,
        'day': 'Monday',
        'time': 'Evening',
        'mantra': 'Om Chandraya Namah',
        'mantra_count': 11000,
        'enemies': [],
        'contraindications': 'Avoid if Moon is severely afflicted by Rahu without cancellation',
    },
    'Mars': {
        'primary': 'Red Coral',
        'substitute': ['Carnelian', 'Bloodstone'],
        'metal': 'Gold or Copper',
        'finger': 'Ring finger',
        'weight_min': 5,
        'weight_ideal': 7,
        'day': 'Tuesday',
        'time': 'Morning',
        'mantra': 'Om Mangalaya Namah',
        'mantra_count': 10000,
        'enemies': ['Mercury'],
        'contraindications': 'Never wear with Emerald. Avoid if Mars causes Manglik without cancellation.',
    },
    'Mercury': {
        'primary': 'Emerald',
        'substitute': ['Green Tourmaline', 'Peridot', 'Tsavorite'],
        'metal': 'Gold',
        'finger': 'Little finger',
        'weight_min': 3,
        'weight_ideal': 5,
        'day': 'Wednesday',
        'time': 'Morning',
        'mantra': 'Om Budhaya Namah',
        'mantra_count': 9000,
        'enemies': ['Mars'],
        'contraindications': 'Never wear with Red Coral',
    },
    'Jupiter': {
        'primary': 'Yellow Sapphire',
        'substitute': ['Citrine', 'Yellow Topaz', 'Golden Beryl'],
        'metal': 'Gold',
        'finger': 'Index finger',
        'weight_min': 3,
        'weight_ideal': 5,
        'day': 'Thursday',
        'time': 'Morning',
        'mantra': 'Om Gurave Namah',
        'mantra_count': 19000,
        'enemies': [],
        'contraindications': 'Avoid if Jupiter is lord of 6th/8th/12th and placed badly',
    },
    'Venus': {
        'primary': 'Diamond',
        'substitute': ['White Sapphire', 'Zircon', 'White Topaz'],
        'metal': 'Platinum or Silver',
        'finger': 'Ring finger or Middle finger',
        'weight_min': 0.5,
        'weight_ideal': 1,
        'day': 'Friday',
        'time': 'Morning',
        'mantra': 'Om Shukraya Namah',
        'mantra_count': 16000,
        'enemies': ['Sun', 'Moon'],
        'contraindications': 'Never wear with Ruby or Pearl',
    },
    'Saturn': {
        'primary': 'Blue Sapphire',
        'substitute': ['Amethyst', 'Iolite', 'Blue Spinel'],
        'metal': 'Silver or Iron',
        'finger': 'Middle finger',
        'weight_min': 3,
        'weight_ideal': 5,
        'day': 'Saturday',
        'time': 'Evening',
        'mantra': 'Om Shanaishcharaya Namah',
        'mantra_count': 23000,
        'enemies': ['Sun', 'Moon', 'Mars'],
        'contraindications': 'Never wear with Ruby, Pearl, or Red Coral. Trial period of 3 days recommended.',
    },
    'Rahu': {
        'primary': 'Hessonite (Gomed)',
        'substitute': ['Spessartine Garnet', 'Orange Zircon'],
        'metal': 'Silver or Panchdhatu',
        'finger': 'Middle finger',
        'weight_min': 4,
        'weight_ideal': 6,
        'day': 'Saturday',
        'time': 'Evening',
        'mantra': 'Om Rahave Namah',
        'mantra_count': 18000,
        'enemies': ['Sun', 'Moon'],
        'contraindications': 'Never wear with Ruby or Pearl',
    },
    'Ketu': {
        'primary': "Cat's Eye (Lehsunia)",
        'substitute': ["Tiger's Eye", 'Chrysoberyl'],
        'metal': 'Silver or Panchdhatu',
        'finger': 'Little finger or Ring finger',
        'weight_min': 3,
        'weight_ideal': 5,
        'day': 'Tuesday or Thursday',
        'time': 'Morning',
        'mantra': 'Om Ketave Namah',
        'mantra_count': 17000,
        'enemies': [],
        'contraindications': 'Trial period recommended. Stop if nightmares or unease.',
    },
}

# ═══════════════════════════════════════════════════════════════════
# MANTRA DATA
# ═══════════════════════════════════════════════════════════════════

PLANET_MANTRAS = {
    'Sun': {
        'beej': 'Om Hraam Hreem Hraum Sah Suryaya Namah',
        'vedic': 'Om Aakrishnena Rajasa Vartamano Niveshayann Amritam Martyam Cha...',
        'gayatri': 'Om Bhaskaraya Vidmahe Mahadhyutikaraya Dheemahi Tanno Aditya Prachodayat',
        'stotra': 'Aditya Hridayam (from Ramayana)',
        'japa_count': 7000,
        'best_time': 'Sunrise',
        'direction': 'East',
    },
    'Moon': {
        'beej': 'Om Shraam Shreem Shraum Sah Chandraya Namah',
        'vedic': 'Om Imam Deva Asapatnam Suvadhwam...',
        'gayatri': 'Om Kshiraputraya Vidmahe Amrittatvaya Dheemahi Tanno Chandra Prachodayat',
        'stotra': 'Chandra Kavacham',
        'japa_count': 11000,
        'best_time': 'Evening / Monday morning',
        'direction': 'Northwest',
    },
    'Mars': {
        'beej': 'Om Kraam Kreem Kraum Sah Bhaumaya Namah',
        'vedic': 'Om Agnir Murdha Divah Kakut...',
        'gayatri': 'Om Angaarakaya Vidmahe Shaktihasthaya Dheemahi Tanno Bhaumah Prachodayat',
        'stotra': 'Mangala Kavacham',
        'japa_count': 10000,
        'best_time': 'Morning / Tuesday',
        'direction': 'South',
        'extra': 'Hanuman Chalisa on Tuesdays is highly effective for Mars affliction',
    },
    'Mercury': {
        'beej': 'Om Braam Breem Braum Sah Budhaya Namah',
        'vedic': 'Om Udbudhyaswa Agne Prati Jagruhi...',
        'gayatri': 'Om Gajadhwajaya Vidmahe Sukhapradaya Dheemahi Tanno Budhah Prachodayat',
        'stotra': 'Budha Kavacham',
        'japa_count': 9000,
        'best_time': 'Morning / Wednesday',
        'direction': 'North',
        'extra': 'Vishnu Sahasranama on Wednesdays',
    },
    'Jupiter': {
        'beej': 'Om Graam Greem Graum Sah Gurave Namah',
        'vedic': 'Om Brihaspate Ati Yadaryo Arhat...',
        'gayatri': 'Om Vrishabadhwajaya Vidmahe Gruhanidhaye Dheemahi Tanno Guruh Prachodayat',
        'stotra': 'Guru Kavacham / Brihaspati Stotra',
        'japa_count': 19000,
        'best_time': 'Morning / Thursday',
        'direction': 'Northeast',
        'extra': 'Dakshinamurthy Stotra for Jupiter strength',
    },
    'Venus': {
        'beej': 'Om Draam Dreem Draum Sah Shukraya Namah',
        'vedic': 'Om Annatparisruto Rasam...',
        'gayatri': 'Om Rajadabaaya Vidmahe Bhrigusuthaya Dheemahi Tanno Shukrah Prachodayat',
        'stotra': 'Shukra Kavacham / Lakshmi Stotra',
        'japa_count': 16000,
        'best_time': 'Morning / Friday',
        'direction': 'Southeast',
        'extra': 'Sri Suktam on Fridays for Venus blessing',
    },
    'Saturn': {
        'beej': 'Om Praam Preem Praum Sah Shanaischaraya Namah',
        'vedic': 'Om Shanno Devir Abhishtaya Aapo...',
        'gayatri': 'Om Sanaischaraya Vidmahe Shanaidevaya Dheemahi Tanno Mandah Prachodayat',
        'stotra': 'Shani Chalisa / Shani Stotra',
        'japa_count': 23000,
        'best_time': 'Evening / Saturday',
        'direction': 'West',
        'extra': 'Hanuman Chalisa on Saturdays. Shani temple visit.',
    },
    'Rahu': {
        'beej': 'Om Bhraam Bhreem Bhraum Sah Rahave Namah',
        'gayatri': 'Om Sookdantaya Vidmahe Ugraroopaya Dheemahi Tanno Rahuh Prachodayat',
        'stotra': 'Rahu Kavacham',
        'japa_count': 18000,
        'best_time': 'Night / Saturday',
        'direction': 'Southwest',
        'extra': 'Durga Chalisa or Saraswati Stotra for Rahu affliction',
    },
    'Ketu': {
        'beej': 'Om Sraam Sreem Sraum Sah Ketave Namah',
        'gayatri': 'Om Ashwadhwajaya Vidmahe Soolahastaya Dheemahi Tanno Ketuh Prachodayat',
        'stotra': 'Ketu Kavacham',
        'japa_count': 17000,
        'best_time': 'Morning or Evening / Tuesday or Thursday',
        'direction': 'Northeast',
        'extra': 'Ganesha worship for Ketu affliction. Matsya Avatar Stotra.',
    },
}

# ═══════════════════════════════════════════════════════════════════
# DONATION & RITUAL DATA
# ═══════════════════════════════════════════════════════════════════

PLANET_REMEDIES = {
    'Sun': {
        'donation': 'Wheat, jaggery, red cloth, copper vessel',
        'donation_day': 'Sunday',
        'donation_to': 'Father figure, government official, or temple priest',
        'fasting': 'Sunday fasting (one meal, no salt)',
        'color': 'Red, Orange, Saffron',
        'wear_color_day': 'Sunday',
        'food_avoid': 'Non-veg on Sundays',
        'deity': 'Lord Surya (Sun God), Lord Rama',
        'temple': 'Surya Narayan temple, Konark Sun Temple',
        'charity': 'Feed cows, donate to eye hospitals',
        'metal': 'Gold or Copper',
        'rudraksha': '1 Mukhi or 12 Mukhi',
    },
    'Moon': {
        'donation': 'Rice, white cloth, silver, milk, curd',
        'donation_day': 'Monday',
        'donation_to': 'Mother figure, elderly women',
        'fasting': 'Monday fasting (Somvar Vrat)',
        'color': 'White, Silver, Cream',
        'wear_color_day': 'Monday',
        'food_avoid': 'Non-veg on Mondays',
        'deity': 'Lord Shiva, Goddess Parvati',
        'temple': 'Shiva temple, Somnath',
        'charity': 'Donate milk/water to the needy',
        'metal': 'Silver',
        'rudraksha': '2 Mukhi',
    },
    'Mars': {
        'donation': 'Red lentils (masoor dal), red cloth, copper',
        'donation_day': 'Tuesday',
        'donation_to': 'Soldiers, police, sports persons',
        'fasting': 'Tuesday fasting (Mangalvar Vrat)',
        'color': 'Red, Scarlet, Maroon',
        'wear_color_day': 'Tuesday',
        'food_avoid': 'Non-veg on Tuesdays, avoid anger',
        'deity': 'Lord Hanuman, Lord Kartikeya',
        'temple': 'Hanuman temple on Tuesdays',
        'charity': 'Donate blood, help fire victims',
        'metal': 'Copper',
        'rudraksha': '3 Mukhi',
    },
    'Mercury': {
        'donation': 'Green moong dal, green cloth, books, pens',
        'donation_day': 'Wednesday',
        'donation_to': 'Students, writers, young children',
        'fasting': 'Wednesday fasting',
        'color': 'Green, Emerald Green',
        'wear_color_day': 'Wednesday',
        'food_avoid': 'Non-veg on Wednesdays',
        'deity': 'Lord Vishnu, Lord Krishna',
        'temple': 'Vishnu temple on Wednesdays',
        'charity': 'Donate books, sponsor education',
        'metal': 'Brass',
        'rudraksha': '4 Mukhi',
    },
    'Jupiter': {
        'donation': 'Turmeric, yellow cloth, chana dal, gold, bananas',
        'donation_day': 'Thursday',
        'donation_to': 'Brahmins, teachers, gurus, priests',
        'fasting': 'Thursday fasting (Brihaspativar Vrat)',
        'color': 'Yellow, Golden, Saffron',
        'wear_color_day': 'Thursday',
        'food_avoid': 'Non-veg on Thursdays, avoid banana after sunset',
        'deity': 'Lord Vishnu, Lord Dattatreya, Guru (Teacher)',
        'temple': 'Vishnu/Dattatreya temple on Thursdays',
        'charity': 'Feed Brahmins, donate to temples/ashrams',
        'metal': 'Gold',
        'rudraksha': '5 Mukhi',
    },
    'Venus': {
        'donation': 'White rice, white cloth, sugar, ghee, perfume',
        'donation_day': 'Friday',
        'donation_to': 'Young women, artists, musicians',
        'fasting': 'Friday fasting (Shukravar Vrat)',
        'color': 'White, Pink, Light Blue, Cream',
        'wear_color_day': 'Friday',
        'food_avoid': 'Sour foods on Fridays',
        'deity': 'Goddess Lakshmi, Goddess Santoshi Maa',
        'temple': 'Lakshmi temple on Fridays',
        'charity': 'Help women, donate to art/music schools',
        'metal': 'Silver or Platinum',
        'rudraksha': '6 Mukhi',
    },
    'Saturn': {
        'donation': 'Black sesame (til), mustard oil, iron, black cloth, urad dal',
        'donation_day': 'Saturday',
        'donation_to': 'Servants, laborers, elderly, disabled persons',
        'fasting': 'Saturday fasting (Shanivar Vrat)',
        'color': 'Black, Dark Blue, Navy',
        'wear_color_day': 'Saturday',
        'food_avoid': 'Non-veg on Saturdays, avoid alcohol',
        'deity': 'Lord Shani, Lord Hanuman, Lord Bhairav',
        'temple': 'Shani temple on Saturdays, Hanuman temple',
        'charity': 'Feed the poor, help disabled, serve elderly',
        'metal': 'Iron',
        'rudraksha': '7 Mukhi or 14 Mukhi',
    },
    'Rahu': {
        'donation': 'Coconut, blue/black cloth, mustard, sesame',
        'donation_day': 'Saturday or Wednesday',
        'donation_to': 'Sweepers, outcaste people, foreigners',
        'fasting': 'Saturday fasting',
        'color': 'Dark Blue, Smoky, Grey',
        'wear_color_day': 'Saturday',
        'food_avoid': 'Non-veg, alcohol, tobacco — reduce confusion',
        'deity': 'Goddess Durga, Goddess Saraswati',
        'temple': 'Rahu-Kaal Sarpa temple (Trimbakeshwar, Kalahasti)',
        'charity': 'Help lepers, serve in old-age homes',
        'metal': 'Lead or Panchdhatu',
        'rudraksha': '8 Mukhi',
    },
    'Ketu': {
        'donation': 'Blanket (brown/grey), sesame, dog food, flag',
        'donation_day': 'Tuesday or Thursday',
        'donation_to': 'Sadhus, monks, spiritual people',
        'fasting': 'Tuesday or Thursday fasting',
        'color': 'Grey, Brown, Smoky',
        'wear_color_day': 'Thursday',
        'food_avoid': 'Non-veg on Tuesdays',
        'deity': 'Lord Ganesha, Matsya Avatar',
        'temple': 'Ganesha temple, Ketu temples (Kalahasti)',
        'charity': 'Feed dogs, donate blankets',
        'metal': 'Panchdhatu',
        'rudraksha': '9 Mukhi',
    },
}


class RemediesEngine:
    """
    Personalized remedy recommendations based on chart analysis.
    """

    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi

    def get_planet_house(self, planet: str) -> int:
        return self.planets.get(planet, {}).get('house', 1)

    def get_house_lord(self, house: int) -> str:
        return RASHI_LORDS[(self.asc_rashi + house - 1) % 12]

    def is_strong(self, planet: str) -> bool:
        r = self.planets.get(planet, {}).get('rashi', 0)
        p = PLANETS.get(planet, {})
        return r == p.get('exalted') or r in p.get('owns', [])

    def is_weak(self, planet: str) -> bool:
        r = self.planets.get(planet, {}).get('rashi', 0)
        p = PLANETS.get(planet, {})
        return r == p.get('debilitated')

    def is_afflicted(self, planet: str) -> bool:
        p_house = self.get_planet_house(planet)
        for mal in ['Saturn', 'Mars', 'Rahu', 'Ketu']:
            if mal != planet and self.get_planet_house(mal) == p_house:
                return True
        return p_house in DUSTHANA_HOUSES

    def get_weak_planets(self) -> List[Dict]:
        """Identify planets that need strengthening."""
        weak = []
        for planet in self.planets:
            reasons = []
            score = 0
            if self.is_weak(planet):
                reasons.append('Debilitated')
                score += 3
            if self.is_afflicted(planet):
                reasons.append('Afflicted by malefic')
                score += 2
            if self.get_planet_house(planet) in DUSTHANA_HOUSES:
                reasons.append(f'In dusthana (house {self.get_planet_house(planet)})')
                score += 1
            # Check combustion (near Sun)
            if planet not in ('Sun', 'Rahu', 'Ketu'):
                sun_long = self.planets.get('Sun', {}).get('longitude', 0)
                p_long = self.planets.get(planet, {}).get('longitude', 0)
                diff = abs(sun_long - p_long)
                if diff > 180: diff = 360 - diff
                orbs = {'Moon':12,'Mars':17,'Mercury':14,'Jupiter':11,'Venus':10,'Saturn':15}
                if diff < orbs.get(planet, 15):
                    reasons.append('Combust (too close to Sun)')
                    score += 2
            if reasons:
                weak.append({'planet': planet, 'score': score, 'reasons': reasons})
        weak.sort(key=lambda x: x['score'], reverse=True)
        return weak

    def recommend_gemstones(self) -> List[Dict]:
        """Recommend gemstones based on chart analysis."""
        recommendations = []
        dasha = self.engine.get_vimshottari_dasha()
        maha_lord = dasha['mahadasha']['lord']
        antar_lord = dasha['antardasha']['lord']

        # Priority 1: Gemstone for Lagna lord (always beneficial)
        l1 = self.get_house_lord(1)
        if l1 in GEMSTONE_DATA:
            gem = GEMSTONE_DATA[l1]
            recommendations.append({
                'priority': 1,
                'reason': f'Lagna lord ({l1}) strengthening — always beneficial',
                'planet': l1,
                'gemstone': gem['primary'],
                'substitute': gem['substitute'],
                'metal': gem['metal'],
                'finger': gem['finger'],
                'weight': f'{gem["weight_ideal"]} carats (min {gem["weight_min"]})',
                'day_to_wear': gem['day'],
                'time': gem['time'],
                'mantra_while_wearing': gem['mantra'],
                'contraindications': gem['contraindications'],
            })

        # Priority 2: Gemstone for Mahadasha lord
        if maha_lord in GEMSTONE_DATA and maha_lord != l1:
            gem = GEMSTONE_DATA[maha_lord]
            recommendations.append({
                'priority': 2,
                'reason': f'Current Mahadasha lord ({maha_lord}) — supports current life period',
                'planet': maha_lord,
                'gemstone': gem['primary'],
                'substitute': gem['substitute'],
                'metal': gem['metal'],
                'finger': gem['finger'],
                'weight': f'{gem["weight_ideal"]} carats (min {gem["weight_min"]})',
                'day_to_wear': gem['day'],
                'time': gem['time'],
                'mantra_while_wearing': gem['mantra'],
                'contraindications': gem['contraindications'],
            })

        # Priority 3: Gemstone for 9th lord (fortune)
        l9 = self.get_house_lord(9)
        if l9 in GEMSTONE_DATA and l9 not in (l1, maha_lord):
            gem = GEMSTONE_DATA[l9]
            recommendations.append({
                'priority': 3,
                'reason': f'9th lord ({l9}) — enhances fortune and luck',
                'planet': l9,
                'gemstone': gem['primary'],
                'substitute': gem['substitute'],
                'metal': gem['metal'],
                'finger': gem['finger'],
                'weight': f'{gem["weight_ideal"]} carats (min {gem["weight_min"]})',
                'day_to_wear': gem['day'],
                'time': gem['time'],
                'mantra_while_wearing': gem['mantra'],
                'contraindications': gem['contraindications'],
            })

        # Check enemy gems and add warnings
        worn_planets = [r['planet'] for r in recommendations]
        for rec in recommendations:
            enemies = GEMSTONE_DATA.get(rec['planet'], {}).get('enemies', [])
            conflicts = [p for p in enemies if p in worn_planets and p != rec['planet']]
            if conflicts:
                conflict_gems = [GEMSTONE_DATA[c]['primary'] for c in conflicts if c in GEMSTONE_DATA]
                rec['warning'] = f'Do NOT wear together with {", ".join(conflict_gems)}'

        return recommendations

    def recommend_mantras(self) -> Dict:
        """Recommend mantras based on dasha and weak planets."""
        dasha = self.engine.get_vimshottari_dasha()
        maha_lord = dasha['mahadasha']['lord']
        antar_lord = dasha['antardasha']['lord']
        weak = self.get_weak_planets()

        primary_mantras = []
        # Dasha lord mantra (always relevant)
        if maha_lord in PLANET_MANTRAS:
            m = PLANET_MANTRAS[maha_lord]
            primary_mantras.append({
                'for': f'Current Mahadasha ({maha_lord})',
                'beej_mantra': m['beej'],
                'gayatri_mantra': m['gayatri'],
                'stotra': m.get('stotra', ''),
                'japa_count': m['japa_count'],
                'best_time': m['best_time'],
                'extra': m.get('extra', ''),
            })

        # Weak planet mantras
        for w in weak[:2]:  # Top 2 weakest
            planet = w['planet']
            if planet in PLANET_MANTRAS and planet != maha_lord:
                m = PLANET_MANTRAS[planet]
                primary_mantras.append({
                    'for': f'Strengthen weak {planet} ({", ".join(w["reasons"])})',
                    'beej_mantra': m['beej'],
                    'gayatri_mantra': m['gayatri'],
                    'stotra': m.get('stotra', ''),
                    'japa_count': m['japa_count'],
                    'best_time': m['best_time'],
                    'extra': m.get('extra', ''),
                })

        # Nakshatra deity mantra
        moon_nak = self.planets.get('Moon', {}).get('nakshatra_name', '')
        nak_mantra = self._get_nakshatra_mantra(moon_nak)

        return {
            'primary_mantras': primary_mantras,
            'nakshatra_mantra': nak_mantra,
            'daily_practice': {
                'morning': f'Chant {maha_lord} beej mantra 108 times at sunrise',
                'evening': 'Chant Hanuman Chalisa or Vishnu Sahasranama',
                'special_day': f'{PLANET_REMEDIES.get(maha_lord, {}).get("fasting", "Monday fasting")}',
            },
        }

    def _get_nakshatra_mantra(self, nakshatra: str) -> Dict:
        """Get deity mantra for birth nakshatra."""
        nak_deities = {
            'Ashwini': ('Ashwini Kumaras', 'Om Ashwini Kumarabhyam Namah'),
            'Bharani': ('Yama', 'Om Yamaya Namah'),
            'Krittika': ('Agni', 'Om Agnaye Namah'),
            'Rohini': ('Brahma', 'Om Brahmane Namah'),
            'Mrigashira': ('Soma/Chandra', 'Om Somaya Namah'),
            'Ardra': ('Rudra', 'Om Rudraya Namah'),
            'Punarvasu': ('Aditi', 'Om Aditaye Namah'),
            'Pushya': ('Brihaspati', 'Om Brihaspataye Namah'),
            'Ashlesha': ('Sarpa', 'Om Sarpebhyo Namah'),
            'Magha': ('Pitris', 'Om Pitribhyo Namah'),
            'Purva Phalguni': ('Bhaga', 'Om Bhagaya Namah'),
            'Uttara Phalguni': ('Aryaman', 'Om Aryamne Namah'),
            'Hasta': ('Savitar', 'Om Savitre Namah'),
            'Chitra': ('Vishwakarma', 'Om Vishwakarmane Namah'),
            'Swati': ('Vayu', 'Om Vayave Namah'),
            'Vishakha': ('Indra-Agni', 'Om Indragnibhyam Namah'),
            'Anuradha': ('Mitra', 'Om Mitraya Namah'),
            'Jyeshtha': ('Indra', 'Om Indraya Namah'),
            'Mula': ('Nirriti', 'Om Nirritaye Namah'),
            'Purva Ashadha': ('Apas', 'Om Adbhyo Namah'),
            'Uttara Ashadha': ('Vishwedeva', 'Om Vishwedevebhyo Namah'),
            'Shravana': ('Vishnu', 'Om Vishnave Namah'),
            'Dhanishta': ('Vasu', 'Om Vasubhyo Namah'),
            'Shatabhisha': ('Varuna', 'Om Varunaya Namah'),
            'Purva Bhadrapada': ('Ajaikapad', 'Om Ajaikapadaya Namah'),
            'Uttara Bhadrapada': ('Ahirbudhnya', 'Om Ahirbudhnyaya Namah'),
            'Revati': ('Pushan', 'Om Pushne Namah'),
        }
        deity, mantra = nak_deities.get(nakshatra, ('Unknown', 'Om Namah'))
        return {
            'nakshatra': nakshatra,
            'deity': deity,
            'mantra': mantra,
            'practice': f'Chant {mantra} 108 times on birth star day (when Moon transits {nakshatra})',
        }

    def recommend_rituals(self) -> Dict:
        """Recommend rituals, donations, fasting, colors based on weak planets and dasha."""
        dasha = self.engine.get_vimshottari_dasha()
        maha_lord = dasha['mahadasha']['lord']
        weak = self.get_weak_planets()

        rituals = []
        # Dasha lord rituals
        if maha_lord in PLANET_REMEDIES:
            r = PLANET_REMEDIES[maha_lord]
            rituals.append({
                'for': f'Current Mahadasha ({maha_lord})',
                'donation': r['donation'],
                'donation_day': r['donation_day'],
                'donation_to': r['donation_to'],
                'fasting': r['fasting'],
                'color_therapy': f'Wear {r["color"]} on {r["wear_color_day"]}',
                'deity': r['deity'],
                'temple': r['temple'],
                'charity': r['charity'],
                'rudraksha': r['rudraksha'],
            })

        # Weak planet rituals
        for w in weak[:2]:
            planet = w['planet']
            if planet in PLANET_REMEDIES and planet != maha_lord:
                r = PLANET_REMEDIES[planet]
                rituals.append({
                    'for': f'Strengthen {planet} ({", ".join(w["reasons"])})',
                    'donation': r['donation'],
                    'donation_day': r['donation_day'],
                    'fasting': r['fasting'],
                    'color_therapy': f'Wear {r["color"]} on {r["wear_color_day"]}',
                    'deity': r['deity'],
                    'temple': r['temple'],
                })

        return {
            'rituals': rituals,
            'weekly_schedule': self._build_weekly_schedule(maha_lord, weak),
        }

    def _build_weekly_schedule(self, maha_lord: str, weak: List[Dict]) -> Dict:
        """Build a weekly remedial schedule."""
        schedule = {
            'Monday': {'color': 'White', 'deity': 'Lord Shiva', 'activity': 'Meditation, drink milk'},
            'Tuesday': {'color': 'Red', 'deity': 'Hanuman', 'activity': 'Hanuman Chalisa, donate blood'},
            'Wednesday': {'color': 'Green', 'deity': 'Lord Vishnu', 'activity': 'Read/study, donate books'},
            'Thursday': {'color': 'Yellow', 'deity': 'Jupiter/Guru', 'activity': 'Guru worship, donate turmeric'},
            'Friday': {'color': 'White/Pink', 'deity': 'Goddess Lakshmi', 'activity': 'Sri Suktam, donate sweets'},
            'Saturday': {'color': 'Black/Navy', 'deity': 'Lord Shani', 'activity': 'Serve poor, donate oil/sesame'},
            'Sunday': {'color': 'Red/Orange', 'deity': 'Lord Surya', 'activity': 'Surya Namaskar, offer water to Sun'},
        }
        # Highlight the most important day
        if maha_lord in PLANET_REMEDIES:
            day = PLANET_REMEDIES[maha_lord]['donation_day']
            if day in schedule:
                schedule[day]['priority'] = 'HIGH — Mahadasha lord day'
        return schedule

    def generate_full_remedies(self) -> Dict:
        """Generate complete personalized remedy report."""
        weak = self.get_weak_planets()
        gems = self.recommend_gemstones()
        mantras = self.recommend_mantras()
        rituals = self.recommend_rituals()
        dasha = self.engine.get_vimshottari_dasha()

        return {
            'current_dasha': dasha.get('dasha_string', ''),
            'weak_planets': weak,
            'gemstone_recommendations': gems,
            'mantra_recommendations': mantras,
            'ritual_recommendations': rituals,
            'summary': {
                'most_needed_remedy': weak[0]['planet'] if weak else 'None',
                'primary_gemstone': gems[0]['gemstone'] if gems else 'None',
                'primary_mantra': mantras['primary_mantras'][0]['beej_mantra'] if mantras['primary_mantras'] else 'None',
                'total_weak_planets': len(weak),
            },
        }


def generate_remedies(engine) -> Dict:
    """Convenience function."""
    re = RemediesEngine(engine)
    return re.generate_full_remedies()
