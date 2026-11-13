"""
JYOTISH ENGINE - COMPLETE YOGA ENCYCLOPEDIA
300+ classical yogas from Brihat Parashara Hora Shastra, Saravali,
Jataka Parijata, Phaladeepika, and Uttara Kalamrita.
"""

from typing import Dict, List, Set
from ..core.constants import (
    PLANETS, RASHIS, RASHI_LORDS, HOUSES,
    KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES,
    UPACHAYA_HOUSES, RASHI_NAMES,
    SEVEN_PLANETS,
)
from .yogas_extended import ExtendedYogaCalculator

BENEFICS = {'Jupiter', 'Venus', 'Mercury', 'Moon'}
NATURAL_BENEFICS = {'Jupiter', 'Venus'}
MALEFICS = {'Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'}
NATURAL_MALEFICS = {'Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'}
NODES = {'Rahu', 'Ketu'}
LUMINARIES = {'Sun', 'Moon'}


class YogaCalculator:
    def __init__(self, planets: Dict, ascendant: Dict):
        self.planets = planets
        self.asc_rashi = ascendant.get('rashi', ascendant.get('rashi_index', 0))
        self.asc_lon = ascendant.get('longitude')
        self._house_cache: Dict[str, int] = {}
        self._rashi_cache: Dict[str, int] = {}

    def _is_day_birth(self):
        """True when the Sun was above the horizon at birth: on the ecliptic it is
        exactly the arc from the descendant through the MC to the ascendant, i.e. more
        than 180° past the ascendant. None when the longitudes are unknown."""
        try:
            return ((float(self.planets['Sun']['longitude']) - float(self.asc_lon)) % 360) > 180
        except Exception:
            return None

    def get_planet_house(self, planet: str) -> int:
        if planet not in self._house_cache:
            self._house_cache[planet] = self.planets.get(planet, {}).get('house', 1)
        return self._house_cache[planet]

    def get_planet_rashi(self, planet: str) -> int:
        if planet not in self._rashi_cache:
            self._rashi_cache[planet] = self.planets.get(planet, {}).get('rashi', 0)
        return self._rashi_cache[planet]

    def get_planet_longitude(self, planet: str) -> float:
        return self.planets.get(planet, {}).get('longitude', 0.0)

    def get_planet_degree_in_sign(self, planet: str) -> float:
        return self.get_planet_longitude(planet) % 30

    def is_retrograde(self, planet: str) -> bool:
        return self.planets.get(planet, {}).get('retrograde', False)

    def get_house_lord(self, house: int) -> str:
        house_rashi = (self.asc_rashi + house - 1) % 12
        return RASHI_LORDS[house_rashi]

    def get_rashi_lord(self, rashi: int) -> str:
        return RASHI_LORDS[rashi]

    def is_in_kendra(self, planet: str) -> bool:
        return self.get_planet_house(planet) in KENDRA_HOUSES

    def is_in_trikona(self, planet: str) -> bool:
        return self.get_planet_house(planet) in TRIKONA_HOUSES

    def is_in_dusthana(self, planet: str) -> bool:
        return self.get_planet_house(planet) in DUSTHANA_HOUSES

    def is_in_upachaya(self, planet: str) -> bool:
        return self.get_planet_house(planet) in UPACHAYA_HOUSES

    def is_exalted(self, planet: str) -> bool:
        return self.get_planet_rashi(planet) == PLANETS.get(planet, {}).get('exalted')

    def is_own_sign(self, planet: str) -> bool:
        return self.get_planet_rashi(planet) in PLANETS.get(planet, {}).get('owns', [])

    def is_debilitated(self, planet: str) -> bool:
        return self.get_planet_rashi(planet) == PLANETS.get(planet, {}).get('debilitated')

    def is_moolatrikona(self, planet: str) -> bool:
        p = PLANETS.get(planet, {})
        mt = p.get('moolatrikona')
        if mt is None or self.get_planet_rashi(planet) != mt:
            return False
        deg = self.get_planet_degree_in_sign(planet)
        return p.get('moolatrikona_start', 0) <= deg <= p.get('moolatrikona_end', 30)

    def is_strong(self, planet: str) -> bool:
        return self.is_exalted(planet) or self.is_own_sign(planet) or self.is_moolatrikona(planet)

    def planets_in_house(self, house: int) -> List[str]:
        return [p for p in self.planets if self.get_planet_house(p) == house]

    def planets_in_rashi(self, rashi: int) -> List[str]:
        return [p for p in self.planets if self.get_planet_rashi(p) == rashi]

    def are_conjunct(self, p1: str, p2: str) -> bool:
        return self.get_planet_house(p1) == self.get_planet_house(p2)

    def house_distance(self, from_planet: str, to_planet: str) -> int:
        return ((self.get_planet_house(to_planet) - self.get_planet_house(from_planet)) % 12) or 12

    def house_from_house(self, from_house: int, to_house: int) -> int:
        return ((to_house - from_house) % 12) or 12

    def occupied_houses(self) -> Set[int]:
        return set(self.get_planet_house(p) for p in self.planets)

    def _benefics_in_house(self, house: int) -> List[str]:
        return [p for p in self.planets_in_house(house) if p in BENEFICS]

    def _malefics_in_house(self, house: int) -> List[str]:
        return [p for p in self.planets_in_house(house) if p in MALEFICS]

    def _get_kendra_lords(self) -> List[str]:
        return list(set(self.get_house_lord(h) for h in KENDRA_HOUSES))

    def _get_trikona_lords(self) -> List[str]:
        return list(set(self.get_house_lord(h) for h in TRIKONA_HOUSES))

    def _planet_aspects_house(self, planet: str, house: int) -> bool:
        p_house = self.get_planet_house(planet)
        aspect_distances = PLANETS.get(planet, {}).get('aspects', [7])
        for asp in aspect_distances:
            target = ((p_house + asp - 1) % 12) + 1
            if target == house:
                return True
        return False

    def _yoga(self, name, yoga_type, **kw):
        y = {'name': name, 'type': yoga_type}
        y.update(kw)
        if 'is_negative' not in y:
            y['is_negative'] = yoga_type in ('Arishta', 'Daridra', 'Dosha')
        return y

    def _raja_strength(self, p1: str, p2: str) -> str:
        strong = sum(1 for p in [p1, p2] if self.is_strong(p))
        if strong == 2: return 'Very Strong'
        if strong == 1: return 'Strong'
        return 'Moderate'

    # ═══════════════════════════════════════════════════════════════════
    # 1. PANCHA MAHAPURUSHA YOGAS (5)
    # ═══════════════════════════════════════════════════════════════════

    def check_mahapurusha_yogas(self) -> List[Dict]:
        yogas = []
        cfg = {
            'Mars':    ('Ruchaka',  'Brave, powerful, military success, strong physique'),
            'Mercury': ('Bhadra',   'Intelligent, learned, eloquent, skilled in arts and sciences'),
            'Jupiter': ('Hamsa',    'Righteous, spiritual, respected, handsome, fortunate'),
            'Venus':   ('Malavya',  'Attractive, wealthy, luxurious, artistic, sensual pleasures'),
            'Saturn':  ('Sasha',    'Powerful position, authority, wealth through hard work'),
        }
        for planet, (name, effects) in cfg.items():
            if self.is_in_kendra(planet) and (self.is_exalted(planet) or self.is_own_sign(planet)):
                yogas.append(self._yoga(
                    f'{name} Yoga', 'Mahapurusha', planet=planet,
                    house=self.get_planet_house(planet),
                    strength='Strong' if self.is_exalted(planet) else 'Moderate',
                    description=f'{planet} in Kendra in {"exaltation" if self.is_exalted(planet) else "own sign"}',
                    effects=effects,
                ))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 2. RAJA YOGAS (~45)
    # ═══════════════════════════════════════════════════════════════════

    def check_raja_yogas(self) -> List[Dict]:
        yogas = []
        kendra_lords = self._get_kendra_lords()
        trikona_lords = self._get_trikona_lords()

        seen = set()
        for kl in kendra_lords:
            for tl in trikona_lords:
                if kl == tl: continue
                pair = tuple(sorted([kl, tl]))
                if pair in seen: continue
                if self.are_conjunct(kl, tl):
                    seen.add(pair)
                    yogas.append(self._yoga(
                        'Raja Yoga', 'Raja', planets=[kl, tl],
                        house=self.get_planet_house(kl), formation='conjunction',
                        strength=self._raja_strength(kl, tl),
                        description=f'Kendra lord {kl} conjunct Trikona lord {tl}',
                        effects='Power, authority, success, high position',
                    ))

        l9, l10 = self.get_house_lord(9), self.get_house_lord(10)
        if self.are_conjunct(l9, l10) and l9 != l10:
            yogas.append(self._yoga(
                'Dharma-Karmadhipati Yoga', 'Raja', planets=[l9, l10],
                house=self.get_planet_house(l9), strength='Very Strong',
                description='9th lord conjunct 10th lord',
                effects='Great success in career aligned with purpose, fame',
            ))

        dist = self.house_distance('Moon', 'Jupiter')
        if dist in (1, 4, 7, 10):
            yogas.append(self._yoga(
                'Gaja Kesari Yoga', 'Raja', planets=['Moon', 'Jupiter'],
                strength='Strong' if self.is_in_kendra('Jupiter') else 'Moderate',
                description='Jupiter in Kendra from Moon',
                effects='Wisdom, wealth, good reputation, leadership',
            ))

        for p in ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']:
            if self.is_in_kendra(p) and self.is_exalted(p):
                yogas.append(self._yoga(
                    f'{p} Exalted Kendra Raja Yoga', 'Raja', planet=p,
                    house=self.get_planet_house(p), strength='Very Strong',
                    description=f'{p} exalted in Kendra',
                    effects='Exceptional rise, authority, fame',
                ))

        asc_odd = (self.asc_rashi % 2 == 0)
        sun_odd = (self.get_planet_rashi('Sun') % 2 == 0)
        moon_odd = (self.get_planet_rashi('Moon') % 2 == 0)
        # Mahabhagya needs the time of birth as well as the signs: a man born by DAY
        # with lagna, Sun and Moon in odd signs, a woman born by NIGHT with all three
        # in even signs. The day/night condition was missing, so the yoga was claimed
        # for every odd or even chart. Gender is not known here; the forms keep their
        # names and the reader's own form is chosen where gender is known.
        day_birth = self._is_day_birth()
        if asc_odd and sun_odd and moon_odd and day_birth is not False:
            yogas.append(self._yoga(
                'Mahabhagya Yoga (Male)', 'Raja',
                description='Born by day; lagna, Sun and Moon all in odd signs (the form for a man)',
                effects='Great fortune, long life, fame, power', strength='Strong',
            ))
        if not asc_odd and not sun_odd and not moon_odd and day_birth is not True:
            yogas.append(self._yoga(
                'Mahabhagya Yoga (Female)', 'Raja',
                description='Born by night; lagna, Sun and Moon all in even signs (the form for a woman)',
                effects='Great fortune, wealth, comfort, respected', strength='Strong',
            ))

        benefics_10 = self._benefics_in_house(10)
        if benefics_10 and not self._malefics_in_house(10):
            yogas.append(self._yoga(
                'Amala Yoga', 'Raja', planets=benefics_10,
                description='Only benefics in 10th house',
                effects='Spotless reputation, virtuous career, fame', strength='Strong',
            ))

        l1 = self.get_house_lord(1)
        l7 = self.get_house_lord(7)
        if (self.is_in_kendra(l1) or self.is_in_trikona(l1)) and not self.is_in_dusthana(l1):
            if self.is_in_kendra(l7) or self.is_in_trikona(l7):
                yogas.append(self._yoga(
                    'Parvata Yoga', 'Raja', planets=[l1, l7],
                    description='Lagna lord and 7th lord in Kendra/Trikona',
                    effects='Fame, leadership, wealth', strength='Moderate',
                ))

        l4 = self.get_house_lord(4)
        l9_ = self.get_house_lord(9)
        if l4 != l9_ and self.is_in_kendra(l4) and self.is_in_kendra(l9_):
            yogas.append(self._yoga(
                'Kahala Yoga', 'Raja', planets=[l4, l9_],
                description='4th and 9th lords both in Kendras',
                effects='Bold, courageous, head of organization', strength='Moderate',
            ))

        if self.is_in_kendra(l1) and self.is_exalted(l1):
            if self._planet_aspects_house('Jupiter', self.get_planet_house(l1)):
                yogas.append(self._yoga(
                    'Chamara Yoga', 'Raja', planets=[l1, 'Jupiter'],
                    description='Exalted Lagna lord in Kendra aspected by Jupiter',
                    effects='Royalty, eloquence, command, long life', strength='Very Strong',
                ))

        b_6 = [p for p in self.planets_in_house(6) if p in NATURAL_BENEFICS]
        b_7 = [p for p in self.planets_in_house(7) if p in NATURAL_BENEFICS]
        b_8 = [p for p in self.planets_in_house(8) if p in NATURAL_BENEFICS]
        adhi_c = len(b_6) + len(b_7) + len(b_8)
        if adhi_c >= 2:
            yogas.append(self._yoga(
                'Adhi Yoga (Lagna)', 'Raja', planets=b_6 + b_7 + b_8,
                description=f'Benefics in 6/7/8 from Lagna ({adhi_c})',
                effects='Commander, minister, king',
                strength='Very Strong' if adhi_c >= 3 else 'Strong',
            ))

        l2 = self.get_house_lord(2)
        l11 = self.get_house_lord(11)
        if self.is_in_kendra('Jupiter') and (self.is_in_kendra(l2) or self.is_in_kendra(l9_) or self.is_in_kendra(l11)):
            yogas.append(self._yoga(
                'Akhanda Samrajya Yoga', 'Raja',
                description='Jupiter in Kendra + 2nd/9th/11th lord in Kendra',
                effects='Undivided empire, great authority, vast wealth', strength='Very Strong',
            ))

        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 3. DHANA YOGAS (~25)
    # ═══════════════════════════════════════════════════════════════════

    def check_dhana_yogas(self) -> List[Dict]:
        yogas = []
        l2 = self.get_house_lord(2)
        l5 = self.get_house_lord(5)
        l9 = self.get_house_lord(9)
        l11 = self.get_house_lord(11)
        dhana_lords = {2: l2, 5: l5, 9: l9, 11: l11}
        houses = [2, 5, 9, 11]
        for i, h1 in enumerate(houses):
            for h2 in houses[i+1:]:
                lord1, lord2 = dhana_lords[h1], dhana_lords[h2]
                if lord1 != lord2 and self.are_conjunct(lord1, lord2):
                    yogas.append(self._yoga(
                        'Dhana Yoga', 'Dhana', planets=[lord1, lord2],
                        house=self.get_planet_house(lord1),
                        description=f'{h1}th lord {lord1} conjunct {h2}th lord {lord2}',
                        effects='Wealth accumulation, financial gains',
                        strength='Strong' if 9 in (h1, h2) else 'Moderate',
                    ))
        venus_h = self.get_planet_house('Venus')
        l9_h = self.get_planet_house(l9)
        if (venus_h in KENDRA_HOUSES + TRIKONA_HOUSES and
                l9_h in KENDRA_HOUSES + TRIKONA_HOUSES and
                (self.is_strong('Venus') or self.is_strong(l9))):
            yogas.append(self._yoga(
                'Lakshmi Yoga', 'Dhana', planets=['Venus', l9],
                description='Venus and 9th lord strong in Kendra/Trikona',
                effects='Great wealth, luxuries, blessed by Goddess Lakshmi', strength='Very Strong',
            ))
        if self.are_conjunct('Jupiter', 'Moon') and (
            self.get_planet_house('Jupiter') in [2, 11] or self.get_planet_house('Moon') in [2, 11]):
            yogas.append(self._yoga(
                'Kubera Yoga', 'Dhana', planets=['Jupiter', 'Moon'],
                description='Jupiter-Moon conjunction in wealth houses',
                effects='Immense wealth, financial genius', strength='Strong',
            ))
        benefic_list = [p for p in self.planets if p in NATURAL_BENEFICS]
        if benefic_list:
            moon_h = self.get_planet_house('Moon')
            all_upachaya = all(
                self.house_from_house(moon_h, self.get_planet_house(b)) in [3, 6, 10, 11]
                for b in benefic_list)
            if all_upachaya:
                yogas.append(self._yoga(
                    'Vasumati Yoga', 'Dhana', planets=benefic_list,
                    description='All benefics in Upachaya from Moon',
                    effects='Ever-increasing wealth', strength='Strong',
                ))
        if self.are_conjunct('Moon', 'Mars'):
            yogas.append(self._yoga(
                'Chandra-Mangala Yoga', 'Dhana', planets=['Moon', 'Mars'],
                house=self.get_planet_house('Moon'),
                description='Moon-Mars conjunction',
                effects='Self-made wealth, bold financial moves', strength='Moderate',
            ))
        if self.get_planet_house(l2) == 11:
            yogas.append(self._yoga('Dhana Yoga (2-11)', 'Dhana', planets=[l2],
                description='2nd lord in 11th house', effects='Steady income from gains', strength='Strong'))
        if self.get_planet_house(l11) == 2:
            yogas.append(self._yoga('Dhana Yoga (11-2)', 'Dhana', planets=[l11],
                description='11th lord in 2nd house', effects='Gains increase family wealth', strength='Strong'))
        if l5 != l9 and self.are_conjunct(l5, l9):
            h = self.get_planet_house(l5)
            if h in KENDRA_HOUSES:
                yogas.append(self._yoga(
                    'Maha Dhana Yoga', 'Dhana', planets=[l5, l9], house=h,
                    description='5th and 9th lords conjunct in Kendra',
                    effects='Enormous wealth from fortune and merit', strength='Very Strong',
                ))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 4. CHANDRA (MOON) YOGAS (15)
    # ═══════════════════════════════════════════════════════════════════

    def check_chandra_yogas(self) -> List[Dict]:
        yogas = []
        moon_h = self.get_planet_house('Moon')
        h2m = (moon_h % 12) + 1
        h12m = ((moon_h - 2) % 12) + 1
        non2 = [p for p in self.planets if p not in NODES and p != 'Moon' and self.get_planet_house(p) == h2m]
        non12 = [p for p in self.planets if p not in NODES and p != 'Moon' and self.get_planet_house(p) == h12m]
        sun2 = [p for p in non2 if p != 'Sun']
        sun12 = [p for p in non12 if p != 'Sun']
        if sun2:
            yogas.append(self._yoga('Sunapha Yoga', 'Chandra', planets=sun2,
                description=f'{", ".join(sun2)} in 2nd from Moon',
                effects='Self-made wealth, intelligent, good reputation', strength='Strong'))
        if sun12:
            yogas.append(self._yoga('Anapha Yoga', 'Chandra', planets=sun12,
                description=f'{", ".join(sun12)} in 12th from Moon',
                effects='Healthy, virtuous, famous, comfortable', strength='Strong'))
        if sun2 and sun12:
            yogas.append(self._yoga('Durudhura Yoga', 'Chandra', planets=sun2 + sun12,
                description='Planets flanking Moon on both sides',
                effects='Wealth, vehicles, fame, generous', strength='Strong'))
        if not non2 and not non12:
            cancelled = (self.is_in_kendra('Moon') or
                         any(self.are_conjunct('Moon', p) for p in self.planets if p != 'Moon'))
            if not cancelled:
                yogas.append(self._yoga('Kemadruma Yoga', 'Chandra',
                    description='No planets in 2nd or 12th from Moon',
                    effects='Poverty, struggle, loneliness', strength='Strong', is_negative=True))
        dist = self.house_distance('Moon', 'Jupiter')
        if dist in (1, 4, 7, 10):
            yogas.append(self._yoga('Gajakesari Yoga', 'Chandra', planets=['Moon', 'Jupiter'],
                description='Jupiter in Kendra from Moon',
                effects='Elephant-like strength, fame, wealth',
                strength='Very Strong' if self.is_strong('Jupiter') else 'Strong'))
        if dist in (6, 8, 12):
            yogas.append(self._yoga('Shakata Yoga', 'Chandra', planets=['Moon', 'Jupiter'],
                description=f'Jupiter in {dist}th from Moon',
                effects='Fluctuating fortunes', strength='Moderate', is_negative=True))
        m6 = ((moon_h + 4) % 12) + 1
        m7 = ((moon_h + 5) % 12) + 1
        m8 = ((moon_h + 6) % 12) + 1
        bm = ([p for p in self.planets_in_house(m6) if p in NATURAL_BENEFICS] +
              [p for p in self.planets_in_house(m7) if p in NATURAL_BENEFICS] +
              [p for p in self.planets_in_house(m8) if p in NATURAL_BENEFICS])
        if len(bm) >= 2:
            yogas.append(self._yoga('Adhi Yoga (Moon)', 'Chandra', planets=bm,
                description=f'Benefics in 6/7/8 from Moon ({len(bm)})',
                effects='Authority and respect',
                strength='Very Strong' if len(bm) >= 3 else 'Strong'))
        msl = self.get_rashi_lord(self.get_planet_rashi('Moon'))
        l1 = self.get_house_lord(1)
        if l1 != msl and self.are_conjunct(l1, msl) and self.get_planet_house(l1) in KENDRA_HOUSES:
            yogas.append(self._yoga('Pushkala Yoga', 'Chandra', planets=[l1, msl],
                description='Lagna lord + Moon dispositor in Kendra',
                effects='Sweet speech, wealth, fame', strength='Strong'))
        h10m = ((moon_h + 8) % 12) + 1
        b10m = [p for p in self.planets_in_house(h10m) if p in NATURAL_BENEFICS]
        if b10m and not [p for p in self.planets_in_house(h10m) if p in NATURAL_MALEFICS]:
            yogas.append(self._yoga('Amala Yoga (Moon)', 'Chandra', planets=b10m,
                description='Only benefics in 10th from Moon',
                effects='Pure reputation, lasting fame', strength='Strong'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 5. SURYA (SUN) YOGAS (5)
    # ═══════════════════════════════════════════════════════════════════

    def check_surya_yogas(self) -> List[Dict]:
        yogas = []
        sun_h = self.get_planet_house('Sun')
        h2s = (sun_h % 12) + 1
        h12s = ((sun_h - 2) % 12) + 1
        skip = {'Sun', 'Moon', 'Rahu', 'Ketu'}
        p2 = [p for p in self.planets if p not in skip and self.get_planet_house(p) == h2s]
        p12 = [p for p in self.planets if p not in skip and self.get_planet_house(p) == h12s]
        if p2:
            yogas.append(self._yoga('Veshi Yoga', 'Surya', planets=p2,
                description=f'{", ".join(p2)} in 2nd from Sun',
                effects='Balanced speech, truthful, good memory', strength='Moderate'))
        if p12:
            yogas.append(self._yoga('Voshi Yoga', 'Surya', planets=p12,
                description=f'{", ".join(p12)} in 12th from Sun',
                effects='Charitable, strong, clever', strength='Moderate'))
        if p2 and p12:
            yogas.append(self._yoga('Ubhayachari Yoga', 'Surya', planets=p2 + p12,
                description='Planets flanking Sun on both sides',
                effects='Kingly status, eloquent, wealthy', strength='Strong'))
        if self.are_conjunct('Sun', 'Mercury'):
            h = self.get_planet_house('Sun')
            yogas.append(self._yoga('Budhaditya Yoga', 'Surya', planets=['Sun', 'Mercury'], house=h,
                description='Sun-Mercury conjunction',
                effects='Highly intelligent, fame through intellect',
                strength='Strong' if h in KENDRA_HOUSES + TRIKONA_HOUSES else 'Moderate'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 6. NABHASA YOGAS (32)
    # ═══════════════════════════════════════════════════════════════════

    def check_nabhasa_yogas(self) -> List[Dict]:
        yogas = []
        occ = self.occupied_houses()
        num_occ = len(occ)
        sp = [p for p in self.planets if p in set(SEVEN_PLANETS)]
        movable = sum(1 for p in sp if RASHIS[self.get_planet_rashi(p)]['quality'] == 'Movable')
        fixed = sum(1 for p in sp if RASHIS[self.get_planet_rashi(p)]['quality'] == 'Fixed')
        dual = sum(1 for p in sp if RASHIS[self.get_planet_rashi(p)]['quality'] == 'Dual')

        if movable == 7:
            yogas.append(self._yoga('Rajju Yoga', 'Nabhasa',
                description='All 7 planets in Movable signs', effects='Travel, wandering, lives abroad'))
        if fixed == 7:
            yogas.append(self._yoga('Musala Yoga', 'Nabhasa',
                description='All 7 planets in Fixed signs', effects='Proud, wealthy, stable, learned'))
        if dual == 7:
            yogas.append(self._yoga('Nala Yoga', 'Nabhasa',
                description='All 7 planets in Dual signs', effects='Clever, skilled, fond of relatives'))

        kt = set(KENDRA_HOUSES + TRIKONA_HOUSES)
        if all(self.get_planet_house(p) in kt for p in sp):
            yogas.append(self._yoga('Mala Yoga', 'Nabhasa',
                description='All planets in Kendra/Trikona', effects='Wealthy, splendorous'))
        if all(self.get_planet_house(p) in {3, 6, 9, 12} for p in sp):
            yogas.append(self._yoga('Sarpa Yoga', 'Nabhasa',
                description='All planets in cadent houses', effects='Miserable, dependent', is_negative=True))

        sankhya = {
            1: ('Gola', 'All planets in one sign'), 2: ('Yuga', 'Planets in two signs'),
            3: ('Shoola', 'Planets in three signs'), 4: ('Kedara', 'Planets in four signs'),
            5: ('Pasha', 'Planets in five signs'), 6: ('Dama', 'Planets in six signs'),
            7: ('Veena', 'Planets in seven signs'),
        }
        if num_occ in sankhya:
            n, d = sankhya[num_occ]
            yogas.append(self._yoga(f'{n} Yoga', 'Nabhasa', description=d, effects=f'Sankhya yoga: {d}'))

        if all(self.get_planet_house(p) in KENDRA_HOUSES for p in self.planets):
            yogas.append(self._yoga('Kamala Yoga', 'Nabhasa',
                description='All planets in Kendras', effects='Virtuous, famous, long-lived, wealthy'))
        if all(self.get_planet_house(p) in [2, 5, 8, 11] for p in self.planets):
            yogas.append(self._yoga('Vapi Yoga', 'Nabhasa',
                description='All planets in Panapara houses', effects='Hoards wealth, happy'))

        b17 = all(self.get_planet_house(p) in [1, 7] for p in self.planets if p in BENEFICS)
        m410 = all(self.get_planet_house(p) in [4, 10] for p in self.planets if p in MALEFICS)
        if b17 and m410:
            yogas.append(self._yoga('Vajra Yoga', 'Nabhasa',
                description='Benefics in 1/7, Malefics in 4/10', effects='Happy start and end, brave'))
        m17 = all(self.get_planet_house(p) in [1, 7] for p in self.planets if p in MALEFICS)
        b410 = all(self.get_planet_house(p) in [4, 10] for p in self.planets if p in BENEFICS)
        if m17 and b410:
            yogas.append(self._yoga('Yava Yoga', 'Nabhasa',
                description='Malefics in 1/7, Benefics in 4/10', effects='Happy middle life, charitable'))

        for start in range(1, 13):
            consec = {(start + i - 1) % 12 + 1 for i in range(7)}
            if occ <= consec and num_occ >= 6:
                yogas.append(self._yoga('Ardha-Chandra Yoga', 'Nabhasa',
                    description='Planets in 7 consecutive houses', effects='Commander, strong, popular'))
                break

        if all(any(self.get_planet_house(p) == k for p in self.planets) for k in KENDRA_HOUSES):
            yogas.append(self._yoga('Chatussagara Yoga', 'Nabhasa',
                description='At least one planet in each Kendra', effects='Fame in all directions, wealthy'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 7. PARIVARTANA YOGAS (Exchange)
    # ═══════════════════════════════════════════════════════════════════

    def check_parivartana_yogas(self) -> List[Dict]:
        yogas = []
        for h1 in range(1, 13):
            lord1 = self.get_house_lord(h1)
            rashi1 = (self.asc_rashi + h1 - 1) % 12
            for h2 in range(h1 + 1, 13):
                lord2 = self.get_house_lord(h2)
                if lord1 == lord2: continue
                rashi2 = (self.asc_rashi + h2 - 1) % 12
                if self.get_planet_rashi(lord1) == rashi2 and self.get_planet_rashi(lord2) == rashi1:
                    both_good = (h1 in KENDRA_HOUSES + TRIKONA_HOUSES and h2 in KENDRA_HOUSES + TRIKONA_HOUSES)
                    one_dust = (h1 in DUSTHANA_HOUSES or h2 in DUSTHANA_HOUSES)
                    if both_good:
                        yn, yt = 'Maha Yoga Parivartana', 'Raja'
                        eff = 'Powerful exchange, raja yoga equivalent'
                    elif one_dust:
                        yn, yt = 'Dainya Parivartana', 'Parivartana'
                        eff = 'Challenging exchange, struggles then growth'
                    else:
                        yn, yt = 'Khala Parivartana', 'Parivartana'
                        eff = 'Mixed exchange, difficulties then improvement'
                    yogas.append(self._yoga(yn, yt, planets=[lord1, lord2], houses=[h1, h2],
                        description=f'{lord1} (lord {h1}) <-> {lord2} (lord {h2})',
                        effects=eff, strength='Strong' if both_good else 'Moderate',
                        is_negative=one_dust))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 8. ARISHTA & DARIDRA YOGAS (~20)
    # ═══════════════════════════════════════════════════════════════════

    def check_arishta_yogas(self) -> List[Dict]:
        yogas = []
        l1 = self.get_house_lord(1)
        l11 = self.get_house_lord(11)
        if self.is_in_dusthana(l11):
            yogas.append(self._yoga('Daridra Yoga', 'Arishta', planets=[l11],
                description='11th lord in dusthana', effects='Difficulties with income'))
        if self.is_in_dusthana(l1):
            yogas.append(self._yoga('Arishta Yoga (Lagna lord)', 'Arishta', planets=[l1],
                description='Lagna lord in 6/8/12', effects='Health problems, obstacles'))
        for lum in LUMINARIES:
            for node in NODES:
                if self.are_conjunct(lum, node):
                    yogas.append(self._yoga('Grahan Yoga', 'Arishta', planets=[lum, node],
                        description=f'{lum} conjunct {node}',
                        effects=f'Eclipse yoga: {lum} significations damaged'))
        dist = self.house_distance('Moon', 'Jupiter')
        if dist in (6, 8, 12):
            yogas.append(self._yoga('Shakata Yoga', 'Arishta', planets=['Moon', 'Jupiter'],
                description=f'Jupiter {dist}th from Moon', effects='Fluctuating fortunes'))
        mal_2 = self._malefics_in_house(2)
        mal_12 = self._malefics_in_house(12)
        if mal_2 and mal_12:
            yogas.append(self._yoga('Papakartari (Lagna)', 'Arishta', planets=mal_2 + mal_12,
                description='Malefics hemming Lagna', effects='Obstruction, health issues'))
        mal_kendra = [p for p in NATURAL_MALEFICS if p in self.planets and self.is_in_kendra(p)]
        if len(mal_kendra) >= 3:
            yogas.append(self._yoga('Kendra Malefic Affliction', 'Arishta', planets=mal_kendra,
                description=f'{len(mal_kendra)} malefics in Kendras', effects='Challenges from all directions'))
        moon_h = self.get_planet_house('Moon')
        hb = ((moon_h - 2) % 12) + 1
        ha = (moon_h % 12) + 1
        if self._malefics_in_house(hb) and self._malefics_in_house(ha):
            yogas.append(self._yoga('Chandra Papakartari', 'Arishta',
                description='Moon hemmed by malefics', effects='Mental stress, emotional instability'))
        if self.is_debilitated(l1):
            yogas.append(self._yoga('Debilitated Lagna Lord', 'Arishta', planets=[l1],
                description=f'Lagna lord {l1} debilitated', effects='Weak constitution, low confidence'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 9. KALA SARPA / KALA AMRITA (24)
    # ═══════════════════════════════════════════════════════════════════

    def check_kala_sarpa_yogas(self) -> List[Dict]:
        yogas = []
        rahu_h = self.get_planet_house('Rahu')
        ketu_h = self.get_planet_house('Ketu')
        others = [p for p in self.planets if p not in NODES]

        def houses_between(hf, ht):
            r = []
            h = hf
            while True:
                h = (h % 12) + 1
                if h == ht: break
                r.append(h)
            return set(r)

        r2k = houses_between(rahu_h, ketu_h)
        k2r = houses_between(ketu_h, rahu_h)
        oh = {p: self.get_planet_house(p) for p in others}
        all_rahu = all(h in r2k or h == rahu_h for h in oh.values())
        all_ketu = all(h in k2r or h == ketu_h for h in oh.values())

        AXIS = {
            (1,7):'Ananta',(2,8):'Kulik',(3,9):'Vasuki',(4,10):'Shankhpal',
            (5,11):'Padma',(6,12):'Maha Padma',(7,1):'Takshak',(8,2):'Karkotak',
            (9,3):'Shankhachud',(10,4):'Ghatak',(11,5):'Vishdhar',(12,6):'Sheshnag',
        }
        ax = AXIS.get((rahu_h, ketu_h), 'Unknown')

        if all_rahu and not all_ketu:
            yogas.append(self._yoga(f'Kala Sarpa Yoga ({ax})', 'Kala_Sarpa',
                planets=['Rahu', 'Ketu'], axis=f'{rahu_h}-{ketu_h}', variant=ax,
                description=f'All planets between Rahu ({rahu_h}H) and Ketu ({ketu_h}H)',
                effects='Struggles, karmic lessons, spiritual growth after 36',
                strength='Strong', is_negative=True))
        if all_ketu and not all_rahu:
            yogas.append(self._yoga(f'Kala Amrita Yoga ({ax})', 'Kala_Sarpa',
                planets=['Ketu', 'Rahu'], axis=f'{ketu_h}-{rahu_h}', variant=ax,
                description=f'All planets between Ketu ({ketu_h}H) and Rahu ({rahu_h}H)',
                effects='Spiritual blessings, success after struggles',
                strength='Strong', is_negative=True))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 10. KARTARI YOGAS (Hemming)
    # ═══════════════════════════════════════════════════════════════════

    def check_kartari_yogas(self) -> List[Dict]:
        yogas = []
        for house in [1, 2, 4, 5, 7, 9, 10, 11]:
            hb = ((house - 2) % 12) + 1
            ha = (house % 12) + 1
            bb, ba = self._benefics_in_house(hb), self._benefics_in_house(ha)
            mb, ma = self._malefics_in_house(hb), self._malefics_in_house(ha)
            if bb and ba and not mb and not ma:
                yogas.append(self._yoga(f'Shubhkartari (House {house})', 'Kartari',
                    description=f'Benefics hemming house {house}',
                    effects=f'Protection of {HOUSES[house]["meaning"]}', strength='Strong'))
            elif mb and ma:
                yogas.append(self._yoga(f'Papakartari (House {house})', 'Kartari',
                    description=f'Malefics hemming house {house}',
                    effects=f'Obstruction of {HOUSES[house]["meaning"]}', strength='Strong', is_negative=True))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 11. SANYASA YOGAS (8)
    # ═══════════════════════════════════════════════════════════════════

    def check_sanyasa_yogas(self) -> List[Dict]:
        yogas = []
        for h in range(1, 13):
            pls = self.planets_in_house(h)
            if len(pls) >= 4:
                yogas.append(self._yoga('Sanyasa Yoga (Stellium)', 'Sanyasa', planets=pls, house=h,
                    description=f'{len(pls)} planets in house {h}',
                    effects='Potential for renunciation',
                    strength='Strong' if len(pls) >= 5 else 'Moderate'))
        if self.are_conjunct('Ketu', 'Moon'):
            yogas.append(self._yoga('Sanyasa Yoga (Ketu-Moon)', 'Sanyasa', planets=['Ketu', 'Moon'],
                description='Ketu conjunct Moon', effects='Spiritual detachment', strength='Moderate'))
        l1 = self.get_house_lord(1)
        if self.are_conjunct('Ketu', l1) and l1 != 'Ketu':
            yogas.append(self._yoga('Sanyasa Yoga (Ketu-Lagna)', 'Sanyasa', planets=['Ketu', l1],
                description=f'Ketu conjunct Lagna lord {l1}', effects='Loss of material attachment', strength='Moderate'))
        if self.are_conjunct('Saturn', 'Moon'):
            yogas.append(self._yoga('Pravrajya Yoga', 'Sanyasa', planets=['Saturn', 'Moon'],
                description='Saturn conjunct Moon', effects='Asceticism, solitary nature', strength='Moderate'))
        l10 = self.get_house_lord(10)
        if self.get_planet_house(l10) == 12:
            yogas.append(self._yoga('Sanyasa Yoga (Karma-Moksha)', 'Sanyasa', planets=[l10],
                description='10th lord in 12th', effects='Career leads to spiritual path', strength='Moderate'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 12. DEITY YOGAS (8)
    # ═══════════════════════════════════════════════════════════════════

    def check_deity_yogas(self) -> List[Dict]:
        yogas = []
        good = set(KENDRA_HOUSES + TRIKONA_HOUSES + [2])
        if all(self.get_planet_house(p) in good for p in ['Jupiter', 'Venus', 'Mercury']):
            yogas.append(self._yoga('Saraswati Yoga', 'Deity', planets=['Jupiter', 'Venus', 'Mercury'],
                description='Jupiter, Venus, Mercury in Kendra/Trikona/2nd',
                effects='Mastery of arts and sciences, eloquence, wisdom',
                strength='Very Strong' if self.is_strong('Jupiter') else 'Strong'))
        if self.is_in_kendra('Jupiter') and self.is_in_kendra('Venus'):
            yogas.append(self._yoga('Brahma Yoga', 'Deity', planets=['Jupiter', 'Venus'],
                description='Jupiter and Venus both in Kendras',
                effects='Creation, prosperity, respected', strength='Strong'))
        l5 = self.get_house_lord(5)
        l9 = self.get_house_lord(9)
        if self.get_planet_house(l5) == 9 and self.get_planet_house(l9) == 10:
            yogas.append(self._yoga('Shiva Yoga', 'Deity', planets=[l5, l9],
                description='5th lord in 9th and 9th lord in 10th',
                effects='Transformative power, spiritual authority', strength='Strong'))
        if self.is_in_trikona('Jupiter') and self.is_strong('Jupiter') and self.is_strong(l5):
            yogas.append(self._yoga('Ganesha Yoga', 'Deity', planets=['Jupiter', l5],
                description='Strong Jupiter in Trikona + strong 5th lord',
                effects='Remover of obstacles, wise, successful', strength='Strong'))
        rahu_h = self.get_planet_house('Rahu')
        if rahu_h in [3, 6] and self.is_strong('Mars'):
            yogas.append(self._yoga('Durga Yoga', 'Deity', planets=['Rahu', 'Mars'],
                description='Rahu in Upachaya + strong Mars',
                effects='Destroys enemies, fierce courage', strength='Strong'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 13. DOSHA YOGAS
    # ═══════════════════════════════════════════════════════════════════

    def check_dosha_yogas(self) -> List[Dict]:
        yogas = []
        if self.are_conjunct('Jupiter', 'Rahu'):
            yogas.append(self._yoga('Guru Chandal Yoga', 'Dosha', planets=['Jupiter', 'Rahu'],
                house=self.get_planet_house('Jupiter'),
                description='Jupiter conjunct Rahu',
                effects='Unconventional wisdom, breaks traditions', strength='Strong'))
        if self.are_conjunct('Jupiter', 'Ketu'):
            yogas.append(self._yoga('Guru Ketu Yoga', 'Dosha', planets=['Jupiter', 'Ketu'],
                description='Jupiter conjunct Ketu',
                effects='Spiritual confusion or deep mysticism', strength='Moderate'))
        if self.get_planet_house('Sun') == 9:
            aff = [m for m in ['Rahu', 'Saturn', 'Ketu'] if self.are_conjunct('Sun', m)]
            if aff:
                yogas.append(self._yoga('Pitru Dosha', 'Dosha', planets=['Sun'] + aff,
                    description=f'Sun in 9th with {", ".join(aff)}',
                    effects='Problems from father, ancestral karma'))
        l9 = self.get_house_lord(9)
        if self.is_in_dusthana(l9):
            yogas.append(self._yoga('Pitru Dosha (9th lord)', 'Dosha', planets=[l9],
                description=f'9th lord {l9} in dusthana', effects='Blocked fortune'))
        if self.get_planet_house('Moon') == 4:
            aff = [m for m in ['Mars', 'Saturn', 'Rahu'] if self.are_conjunct('Moon', m)]
            if aff:
                yogas.append(self._yoga('Matru Dosha', 'Dosha', planets=['Moon'] + aff,
                    description=f'Moon in 4th with {", ".join(aff)}',
                    effects='Issues with mother, disturbed domestic peace'))
        if self.are_conjunct('Saturn', 'Rahu'):
            yogas.append(self._yoga('Shrapit Dosha', 'Dosha', planets=['Saturn', 'Rahu'],
                description='Saturn conjunct Rahu',
                effects='Past life curse, delays, chronic obstacles', strength='Strong'))
        if self.are_conjunct('Mars', 'Rahu'):
            yogas.append(self._yoga('Angarak Yoga', 'Dosha', planets=['Mars', 'Rahu'],
                description='Mars conjunct Rahu',
                effects='Anger, aggression, accidents, tremendous drive', strength='Strong'))
        if self.are_conjunct('Moon', 'Rahu'):
            yogas.append(self._yoga('Chandra Grahan Dosha', 'Dosha', planets=['Moon', 'Rahu'],
                description='Moon conjunct Rahu',
                effects='Mental restlessness, anxiety, psychic ability', strength='Strong'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 14. NEECHA BHANGA RAJA YOGA
    # ═══════════════════════════════════════════════════════════════════

    def check_neecha_bhanga_yogas(self) -> List[Dict]:
        yogas = []
        for planet in self.planets:
            if not self.is_debilitated(planet): continue
            deb_rashi = self.get_planet_rashi(planet)
            sign_lord = self.get_rashi_lord(deb_rashi)
            reasons = []
            if self.get_planet_house(sign_lord) in KENDRA_HOUSES:
                reasons.append(f'{sign_lord} (sign lord) in Kendra')
            moon_h = self.get_planet_house('Moon')
            sl_h = self.get_planet_house(sign_lord)
            if self.house_from_house(moon_h, sl_h) in (1, 4, 7, 10):
                reasons.append(f'{sign_lord} in Kendra from Moon')
            if self.is_in_kendra(planet):
                reasons.append(f'{planet} itself in Kendra')
            for other in self.planets:
                if other != planet and self.are_conjunct(planet, other) and self.is_exalted(other):
                    reasons.append(f'Conjunct exalted {other}')
            if reasons:
                yogas.append(self._yoga('Neecha Bhanga Raja Yoga', 'Special', planets=[planet],
                    description=f'{planet} debilitation cancelled: {"; ".join(reasons)}',
                    effects='Rise from adversity, strength from weakness',
                    strength='Very Strong' if len(reasons) >= 2 else 'Strong',
                    cancellation_reasons=reasons))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 15. MISCELLANEOUS CLASSICAL
    # ═══════════════════════════════════════════════════════════════════

    def check_misc_yogas(self) -> List[Dict]:
        yogas = []
        for planet in self.planets:
            d1 = self.get_planet_rashi(planet)
            lon = self.get_planet_longitude(planet)
            nav = int((lon % 360) / (360 / 108)) % 12
            if d1 == nav:
                yogas.append(self._yoga(f'Vargottama ({planet})', 'Misc', planet=planet,
                    description=f'{planet} same sign in Rashi and Navamsa',
                    effects=f'{planet} gains double strength', strength='Strong'))

        gandanta = [(3, 4), (7, 8), (11, 0)]
        for planet in self.planets:
            rashi = self.get_planet_rashi(planet)
            deg = self.get_planet_degree_in_sign(planet)
            for water, fire in gandanta:
                if (rashi == water and deg > 29.0) or (rashi == fire and deg < 1.0):
                    yogas.append(self._yoga(f'Gandanta ({planet})', 'Misc', planet=planet,
                        description=f'{planet} at water-fire junction ({RASHI_NAMES[rashi]} {deg:.1f} deg)',
                        effects=f'Karmic knot for {planet} significations', strength='Strong', is_negative=True))

        sun_long = self.get_planet_longitude('Sun')
        comb_orbs = {'Moon':12,'Mars':17,'Mercury':14,'Jupiter':11,'Venus':10,'Saturn':15}
        for planet, orb in comb_orbs.items():
            if planet in self.planets:
                diff = abs(sun_long - self.get_planet_longitude(planet))
                if diff > 180: diff = 360 - diff
                if diff < orb:
                    yogas.append(self._yoga(f'Combustion ({planet})', 'Misc', planets=['Sun', planet],
                        description=f'{planet} combust at {diff:.1f} deg from Sun',
                        effects=f'{planet} significations weakened',
                        strength='Strong' if diff < orb / 2 else 'Moderate', is_negative=True))

        db = {'Jupiter':1,'Mercury':1,'Moon':4,'Venus':4,'Saturn':7,'Sun':10,'Mars':10}
        for planet, best in db.items():
            if planet in self.planets and self.get_planet_house(planet) == best:
                yogas.append(self._yoga(f'Dig Bala ({planet})', 'Misc', planet=planet,
                    description=f'{planet} in directional strength (house {best})',
                    effects=f'{planet} at maximum directional power', strength='Moderate'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # 16. LONGEVITY YOGAS
    # ═══════════════════════════════════════════════════════════════════

    def check_longevity_yogas(self) -> List[Dict]:
        yogas = []
        l1 = self.get_house_lord(1)
        l8 = self.get_house_lord(8)
        if self.is_strong(l1) and self.is_strong(l8):
            yogas.append(self._yoga('Deerghayu Yoga', 'Longevity', planets=[l1, l8],
                description='Lagna lord and 8th lord both strong',
                effects='Long life, above-average lifespan', strength='Strong'))
        if self.is_in_dusthana(l1) and self.is_in_dusthana(l8):
            yogas.append(self._yoga('Alpayu Yoga', 'Longevity', planets=[l1, l8],
                description='Lagna lord and 8th lord both in dusthana',
                effects='Health vulnerabilities, needs remedies', strength='Moderate', is_negative=True))
        if self.get_planet_house('Saturn') == 1 and self._planet_aspects_house('Saturn', 8):
            yogas.append(self._yoga('Saturn Longevity Yoga', 'Longevity', planets=['Saturn'],
                description='Saturn in Lagna aspecting 8th',
                effects='Disciplined life, long-lived', strength='Moderate'))
        return yogas

    # ═══════════════════════════════════════════════════════════════════
    # MAIN ANALYSIS
    # ═══════════════════════════════════════════════════════════════════

    def analyze_all_yogas(self) -> Dict:
        all_yogas = {
            'mahapurusha': self.check_mahapurusha_yogas(),
            'raja': self.check_raja_yogas(),
            'dhana': self.check_dhana_yogas(),
            'chandra': self.check_chandra_yogas(),
            'surya': self.check_surya_yogas(),
            'nabhasa': self.check_nabhasa_yogas(),
            'parivartana': self.check_parivartana_yogas(),
            'arishta': self.check_arishta_yogas(),
            'kala_sarpa': self.check_kala_sarpa_yogas(),
            'kartari': self.check_kartari_yogas(),
            'sanyasa': self.check_sanyasa_yogas(),
            'deity': self.check_deity_yogas(),
            'dosha': self.check_dosha_yogas(),
            'neecha_bhanga': self.check_neecha_bhanga_yogas(),
            'misc': self.check_misc_yogas(),
            'longevity': self.check_longevity_yogas(),
            'special': [],
        }
        # Merge extended yogas
        try:
            ext = ExtendedYogaCalculator(self.planets, {'rashi': self.asc_rashi})
            ext_result = ext.analyze_all_extended()
            # Also add rare yogas
            from .yogas_extended import RareYogaCalculator
            rare = RareYogaCalculator(self.planets, {"rashi": self.asc_rashi})
            rare_list = rare.check_all_rare()
            if rare_list:
                all_yogas.setdefault("rare", [])
                all_yogas["rare"].extend(rare_list)
            for cat, ylist in ext_result['yogas'].items():
                if cat in all_yogas:
                    all_yogas[cat].extend(ylist)
                else:
                    all_yogas[cat] = ylist
        except Exception:
            pass

        total = sum(len(y) for y in all_yogas.values())
        positive = sum(1 for c in all_yogas.values() for y in c if not y.get('is_negative', False))
        negative = total - positive
        all_flat = [y for c in all_yogas.values() for y in c]
        strong = [y for y in all_flat if y.get('strength') in ('Strong', 'Very Strong')]
        return {
            'yogas': all_yogas,
            'summary': {
                'total_yogas': total,
                'positive_yogas': positive,
                'negative_yogas': negative,
                'strong_yogas': len(strong),
                'very_strong_yogas': len([y for y in strong if y.get('strength') == 'Very Strong']),
                'categories_detected': sum(1 for v in all_yogas.values() if v),
            },
            'highlights': sorted(strong,
                key=lambda y: (y.get('strength') == 'Very Strong', y.get('type') == 'Raja'),
                reverse=True)[:8],
        }


def analyze_yogas(planets: Dict, ascendant: Dict) -> Dict:
    calculator = YogaCalculator(planets, ascendant)
    return calculator.analyze_all_yogas()
