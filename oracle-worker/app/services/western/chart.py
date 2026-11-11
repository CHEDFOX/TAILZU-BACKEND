"""
WESTERN ASTROLOGY — CHART MODULE
Tropical zodiac, Placidus houses, aspects with orbs, major configurations.
Uses the same Swiss Ephemeris backend as the Vedic system, but tropical (no ayanamsa).
"""

from datetime import datetime
from typing import Dict, List

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

SIGNS = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
]

SIGN_ELEMENTS = {
    "Aries": "Fire", "Taurus": "Earth", "Gemini": "Air", "Cancer": "Water",
    "Leo": "Fire", "Virgo": "Earth", "Libra": "Air", "Scorpio": "Water",
    "Sagittarius": "Fire", "Capricorn": "Earth", "Aquarius": "Air", "Pisces": "Water",
}

SIGN_MODALITIES = {
    "Aries": "Cardinal", "Taurus": "Fixed", "Gemini": "Mutable",
    "Cancer": "Cardinal", "Leo": "Fixed", "Virgo": "Mutable",
    "Libra": "Cardinal", "Scorpio": "Fixed", "Sagittarius": "Mutable",
    "Capricorn": "Cardinal", "Aquarius": "Fixed", "Pisces": "Mutable",
}

SIGN_RULERS = {
    "Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury", "Cancer": "Moon",
    "Leo": "Sun", "Virgo": "Mercury", "Libra": "Venus", "Scorpio": "Pluto",
    "Sagittarius": "Jupiter", "Capricorn": "Saturn", "Aquarius": "Uranus", "Pisces": "Neptune",
}

TRADITIONAL_RULERS = {
    "Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury", "Cancer": "Moon",
    "Leo": "Sun", "Virgo": "Mercury", "Libra": "Venus", "Scorpio": "Mars",
    "Sagittarius": "Jupiter", "Capricorn": "Saturn", "Aquarius": "Saturn", "Pisces": "Jupiter",
}

EXALTATION = {
    "Sun": "Aries", "Moon": "Taurus", "Mercury": "Virgo", "Venus": "Pisces",
    "Mars": "Capricorn", "Jupiter": "Cancer", "Saturn": "Libra",
    "Uranus": "Scorpio", "Neptune": "Cancer", "Pluto": "Leo",
}
DETRIMENT = {
    "Sun": "Aquarius", "Moon": "Capricorn", "Mercury": "Sagittarius", "Venus": "Aries",
    "Mars": "Libra", "Jupiter": "Gemini", "Saturn": "Cancer",
}
FALL = {
    "Sun": "Libra", "Moon": "Scorpio", "Mercury": "Pisces", "Venus": "Virgo",
    "Mars": "Cancer", "Jupiter": "Capricorn", "Saturn": "Aries",
}

WESTERN_PLANETS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
                    'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']

# Aspect definitions: (name, angle, orb)
ASPECTS = [
    ('Conjunction', 0, 8),
    ('Opposition', 180, 8),
    ('Trine', 120, 8),
    ('Square', 90, 7),
    ('Sextile', 60, 6),
    ('Quincunx', 150, 3),
    ('Semi-sextile', 30, 2),
    ('Semi-square', 45, 2),
    ('Sesquiquadrate', 135, 2),
    ('Quintile', 72, 2),
]

ASPECT_NATURE = {
    'Conjunction': 'neutral', 'Opposition': 'challenging', 'Trine': 'harmonious',
    'Square': 'challenging', 'Sextile': 'harmonious', 'Quincunx': 'stressful',
    'Semi-sextile': 'minor', 'Semi-square': 'minor_stress',
    'Sesquiquadrate': 'minor_stress', 'Quintile': 'creative',
}

# Swiss Ephemeris planet IDs for outer planets
OUTER_SWE_IDS = {'Uranus': 7, 'Neptune': 8, 'Pluto': 9}


class WesternChart:
    """
    Complete Western (Tropical) Astrology Chart.

    Usage:
        chart = WesternChart(datetime(1990, 5, 15, 14, 30), 40.7128, -74.0060)
        report = chart.generate_full_report()
    """

    def __init__(self, birth_datetime: datetime, latitude: float, longitude: float,
                 house_system: str = 'P'):
        """
        Args:
            birth_datetime: Birth date/time in UTC
            latitude: Birth latitude
            longitude: Birth longitude
            house_system: 'P'=Placidus, 'K'=Koch, 'E'=Equal, 'W'=Whole Sign
        """
        self.birth_dt = birth_datetime
        self.latitude = latitude
        self.longitude = longitude
        self.house_system = house_system
        self._planets = None
        self._houses = None
        self._ascendant = None
        self._midheaven = None

    def _ensure_calculated(self):
        if self._planets is not None:
            return
        self._calculate_chart()

    def get_planets(self) -> Dict:
        """{name: {longitude, sign, degree, house, retrograde…}}, tropical.

        Seven callers ask for the planets by this method — the wider council's
        tropical helper (Human Design, the lunar mansions, evolutionary astrology,
        the world cycles), the planner's midpoint and lunation witnesses, the
        feature wider-lines, people and time-calendars — and it did not exist. Each
        caught the AttributeError and carried on with nothing, so all of them were
        silently empty."""
        self._ensure_calculated()
        return self._planets or {}

    def _calculate_chart(self):
        """Calculate all tropical positions."""
        import swisseph as swe

        jd = swe.julday(self.birth_dt.year, self.birth_dt.month, self.birth_dt.day,
                        self.birth_dt.hour + self.birth_dt.minute / 60.0)

        # House cusps. Tropical: no sidereal flag is used anywhere in this chart, so
        # the global sidereal mode is irrelevant and is left alone. It used to be set
        # to 255 here ("reset to tropical" — it is SIDM_USER, ~92.9°) and restored to
        # Lahiri only at the end, so a chart that raised in between (Placidus is
        # undefined above ~66° latitude) left every later Vedic chart in the process
        # ~68° wrong until some other Western chart happened to succeed.
        from app.services.core.ephemeris import houses_safe
        cusps, ascmc = houses_safe(jd, self.latitude, self.longitude, self.house_system)

        self._ascendant = ascmc[0] % 360
        self._midheaven = ascmc[1] % 360

        # Houses
        self._houses = {}
        for i in range(12):
            cusp_long = cusps[i] % 360
            sign_idx = int(cusp_long / 30)
            self._houses[i + 1] = {
                'cusp': round(cusp_long, 4),
                'sign': SIGNS[sign_idx],
                'degree': round(cusp_long % 30, 2),
            }

        # Planets
        self._planets = {}
        swe_ids = {'Sun': 0, 'Moon': 1, 'Mercury': 2, 'Venus': 3, 'Mars': 4,
                   'Jupiter': 5, 'Saturn': 6, 'Uranus': 7, 'Neptune': 8, 'Pluto': 9}

        asc_sign_idx = int(self._ascendant / 30)

        for name, swe_id in swe_ids.items():
            result = swe.calc_ut(jd, swe_id, swe.FLG_SWIEPH | swe.FLG_SPEED)
            trop_long = result[0][0] % 360
            speed = result[0][3]
            sign_idx = int(trop_long / 30)
            sign = SIGNS[sign_idx]
            house = ((sign_idx - asc_sign_idx) % 12) + 1

            # For Placidus, calculate house from cusps
            if self.house_system == 'P':
                house = self._house_from_cusps(trop_long, cusps)

            # Dignity
            dignity = self._get_dignity(name, sign)

            self._planets[name] = {
                'longitude': round(trop_long, 4),
                'sign': sign,
                'sign_index': sign_idx,
                'degree': round(trop_long % 30, 2),
                'house': house,
                'retrograde': speed < 0,
                'speed': round(speed, 4),
                'element': SIGN_ELEMENTS[sign],
                'modality': SIGN_MODALITIES[sign],
                'ruler': SIGN_RULERS[sign],
                'dignity': dignity,
            }

        # North Node (Rahu) — True Node
        result = swe.calc_ut(jd, 11, swe.FLG_SWIEPH | swe.FLG_SPEED)  # True Node
        nn_long = result[0][0] % 360
        nn_sign_idx = int(nn_long / 30)
        self._planets['North Node'] = {
            'longitude': round(nn_long, 4), 'sign': SIGNS[nn_sign_idx],
            'degree': round(nn_long % 30, 2),
            'house': self._house_from_cusps(nn_long, cusps) if self.house_system == 'P' else ((nn_sign_idx - asc_sign_idx) % 12) + 1,
            'retrograde': True, 'element': SIGN_ELEMENTS[SIGNS[nn_sign_idx]],
        }

        # South Node
        sn_long = (nn_long + 180) % 360
        sn_sign_idx = int(sn_long / 30)
        self._planets['South Node'] = {
            'longitude': round(sn_long, 4), 'sign': SIGNS[sn_sign_idx],
            'degree': round(sn_long % 30, 2),
            'house': self._house_from_cusps(sn_long, cusps) if self.house_system == 'P' else ((sn_sign_idx - asc_sign_idx) % 12) + 1,
            'retrograde': True, 'element': SIGN_ELEMENTS[SIGNS[sn_sign_idx]],
        }

        # Chiron
        try:
            result = swe.calc_ut(jd, 15, swe.FLG_SWIEPH | swe.FLG_SPEED)  # Chiron
            ch_long = result[0][0] % 360
            ch_sign_idx = int(ch_long / 30)
            self._planets['Chiron'] = {
                'longitude': round(ch_long, 4), 'sign': SIGNS[ch_sign_idx],
                'degree': round(ch_long % 30, 2),
                'house': self._house_from_cusps(ch_long, cusps) if self.house_system == 'P' else ((ch_sign_idx - asc_sign_idx) % 12) + 1,
                'retrograde': result[0][3] < 0,
            }
        except Exception:
            pass


    def _house_from_cusps(self, longitude: float, cusps) -> int:
        """Determine house from Placidus cusps."""
        for i in range(12):
            cusp_start = cusps[i] % 360
            cusp_end = cusps[(i + 1) % 12] % 360
            if cusp_end < cusp_start:
                if longitude >= cusp_start or longitude < cusp_end:
                    return i + 1
            else:
                if cusp_start <= longitude < cusp_end:
                    return i + 1
        return 1

    def _get_dignity(self, planet: str, sign: str) -> str:
        if SIGN_RULERS.get(sign) == planet or TRADITIONAL_RULERS.get(sign) == planet:
            return "Domicile"
        if EXALTATION.get(planet) == sign:
            return "Exalted"
        if DETRIMENT.get(planet) == sign:
            return "Detriment"
        if FALL.get(planet) == sign:
            return "Fall"
        return "Peregrine"

    # ═══════════════════════════════════════════════════════════════
    # ASPECTS
    # ═══════════════════════════════════════════════════════════════

    def get_aspects(self) -> List[Dict]:
        """Calculate all aspects between planets."""
        self._ensure_calculated()
        aspects = []
        planet_names = WESTERN_PLANETS + ['North Node', 'Chiron']
        planet_names = [p for p in planet_names if p in self._planets]

        for i, p1 in enumerate(planet_names):
            for p2 in planet_names[i + 1:]:
                long1 = self._planets[p1]['longitude']
                long2 = self._planets[p2]['longitude']
                diff = abs(long1 - long2)
                if diff > 180:
                    diff = 360 - diff

                for asp_name, asp_angle, asp_orb in ASPECTS:
                    orb_actual = abs(diff - asp_angle)
                    if orb_actual <= asp_orb:
                        applying = self._is_applying(p1, p2, asp_angle)
                        aspects.append({
                            'planet1': p1, 'planet2': p2,
                            'aspect': asp_name, 'exact_angle': asp_angle,
                            'actual_angle': round(diff, 2),
                            'orb': round(orb_actual, 2),
                            'nature': ASPECT_NATURE.get(asp_name, 'neutral'),
                            'applying': applying,
                            'strength': round(1.0 - (orb_actual / asp_orb), 2),
                        })
                        break

        aspects.sort(key=lambda a: a['orb'])
        return aspects

    def _is_applying(self, p1: str, p2: str, angle: float) -> bool:
        """Check if aspect is applying (getting closer) or separating."""
        try:
            s1 = self._planets[p1].get('speed', 0)
            s2 = self._planets[p2].get('speed', 0)
            return abs(s1) > abs(s2)
        except Exception:
            return False

    # ═══════════════════════════════════════════════════════════════
    # CONFIGURATIONS (Patterns)
    # ═══════════════════════════════════════════════════════════════

    def get_configurations(self) -> List[Dict]:
        """Detect major aspect configurations: Grand Trine, T-Square, Grand Cross, Yod, Stellium."""
        self._ensure_calculated()
        configs = []

        aspects = self.get_aspects()
        trines = [(a['planet1'], a['planet2']) for a in aspects if a['aspect'] == 'Trine']
        squares = [(a['planet1'], a['planet2']) for a in aspects if a['aspect'] == 'Square']
        oppositions = [(a['planet1'], a['planet2']) for a in aspects if a['aspect'] == 'Opposition']
        sextiles = [(a['planet1'], a['planet2']) for a in aspects if a['aspect'] == 'Sextile']
        quincunxes = [(a['planet1'], a['planet2']) for a in aspects if a['aspect'] == 'Quincunx']

        # Grand Trine: 3 planets each trine to the other two
        all_planets_in_trines = set()
        for p1, p2 in trines:
            all_planets_in_trines.add(p1)
            all_planets_in_trines.add(p2)
        for p1 in all_planets_in_trines:
            for p2 in all_planets_in_trines:
                if p1 >= p2:
                    continue
                for p3 in all_planets_in_trines:
                    if p2 >= p3:
                        continue
                    pairs = {(p1, p2), (p2, p3), (p1, p3)}
                    trine_set = {(min(a, b), max(a, b)) for a, b in trines}
                    normalized = {(min(a, b), max(a, b)) for a, b in pairs}
                    if normalized.issubset(trine_set):
                        element = self._planets[p1].get('element', '')
                        configs.append({
                            'name': 'Grand Trine', 'planets': [p1, p2, p3],
                            'element': element, 'nature': 'harmonious',
                            'description': f'Exceptional talent and ease in {element} matters',
                        })

        # T-Square: 2 planets in opposition, both square a third
        for op1, op2 in oppositions:
            for sq_planet in all_planets_in_trines | set(p for pair in squares for p in pair):
                if sq_planet in (op1, op2):
                    continue
                sq_set = {(min(a, b), max(a, b)) for a, b in squares}
                if (min(op1, sq_planet), max(op1, sq_planet)) in sq_set and \
                   (min(op2, sq_planet), max(op2, sq_planet)) in sq_set:
                    configs.append({
                        'name': 'T-Square', 'planets': [op1, op2, sq_planet],
                        'apex': sq_planet, 'nature': 'dynamic',
                        'description': f'Dynamic tension driving achievement, apex at {sq_planet}',
                    })

        # Yod (Finger of God): 2 planets sextile, both quincunx a third
        for sx1, sx2 in sextiles:
            qx_set = {(min(a, b), max(a, b)) for a, b in quincunxes}
            for planet in self._planets:
                if planet in (sx1, sx2):
                    continue
                if (min(sx1, planet), max(sx1, planet)) in qx_set and \
                   (min(sx2, planet), max(sx2, planet)) in qx_set:
                    configs.append({
                        'name': 'Yod', 'planets': [sx1, sx2, planet],
                        'apex': planet, 'nature': 'fated',
                        'description': f'Fated mission channeled through {planet}',
                    })

        # Stellium: 3+ planets in the same sign
        sign_groups = {}
        for name, data in self._planets.items():
            if name in WESTERN_PLANETS:
                sign = data.get('sign', '')
                sign_groups.setdefault(sign, []).append(name)
        for sign, planets in sign_groups.items():
            if len(planets) >= 3:
                configs.append({
                    'name': 'Stellium', 'planets': planets,
                    'sign': sign, 'nature': 'concentrated',
                    'description': f'{len(planets)}-planet stellium in {sign}: intense focus on {SIGN_ELEMENTS[sign]} themes',
                })

        # Grand Cross: 4 planets, each square to neighbors, 2 oppositions
        sq_set = {(min(a, b), max(a, b)) for a, b in squares}
        op_set = {(min(a, b), max(a, b)) for a, b in oppositions}
        all_sq_planets = set(p for pair in squares for p in pair)
        for p1 in all_sq_planets:
            for p2 in all_sq_planets:
                if p1 >= p2: continue
                for p3 in all_sq_planets:
                    if p2 >= p3: continue
                    for p4 in all_sq_planets:
                        if p3 >= p4: continue
                        group = [p1, p2, p3, p4]
                        pairs = [(min(group[i], group[j]), max(group[i], group[j]))
                                 for i in range(4) for j in range(i+1, 4)]
                        sq_count = sum(1 for p in pairs if p in sq_set)
                        op_count = sum(1 for p in pairs if p in op_set)
                        if sq_count >= 4 and op_count >= 2:
                            configs.append({
                                'name': 'Grand Cross', 'planets': group,
                                'nature': 'highly dynamic',
                                'description': 'Maximum tension driving exceptional achievement through crisis',
                            })

        # Kite: Grand Trine + one planet opposing a trine planet and sextile to other two
        for gt in [c for c in configs if c['name'] == 'Grand Trine']:
            for planet in self._planets:
                if planet in gt['planets'] or planet not in WESTERN_PLANETS:
                    continue
                opp_count = sum(1 for tp in gt['planets']
                               if (min(planet, tp), max(planet, tp)) in op_set)
                sx_count = sum(1 for tp in gt['planets']
                              if (min(planet, tp), max(planet, tp)) in
                              {(min(a, b), max(a, b)) for a, b in sextiles})
                if opp_count >= 1 and sx_count >= 2:
                    configs.append({
                        'name': 'Kite', 'planets': gt['planets'] + [planet],
                        'apex': planet, 'nature': 'directed talent',
                        'description': f'Grand Trine energy focused and directed through {planet}',
                    })

        # Mystic Rectangle: 2 oppositions + 2 trines + 2 sextiles forming a rectangle
        for i, (op1a, op1b) in enumerate(oppositions):
            for op2a, op2b in oppositions[i+1:]:
                group = {op1a, op1b, op2a, op2b}
                if len(group) != 4: continue
                g = list(group)
                pairs = [(min(g[i], g[j]), max(g[i], g[j]))
                         for i in range(4) for j in range(i+1, 4)]
                tr_set = {(min(a, b), max(a, b)) for a, b in trines}
                sx_set_n = {(min(a, b), max(a, b)) for a, b in sextiles}
                tr_count = sum(1 for p in pairs if p in tr_set)
                sx_count = sum(1 for p in pairs if p in sx_set_n)
                if tr_count >= 2 and sx_count >= 2:
                    configs.append({
                        'name': 'Mystic Rectangle', 'planets': g,
                        'nature': 'structured harmony',
                        'description': 'Practical talent — structured ability to manifest vision',
                    })

        return configs

    # ═══════════════════════════════════════════════════════════════
    # ELEMENT & MODALITY BALANCE
    # ═══════════════════════════════════════════════════════════════

    def get_element_balance(self) -> Dict:
        """Count planets in each element and modality."""
        self._ensure_calculated()
        elements = {'Fire': 0, 'Earth': 0, 'Air': 0, 'Water': 0}
        modalities = {'Cardinal': 0, 'Fixed': 0, 'Mutable': 0}

        for name in WESTERN_PLANETS:
            p = self._planets.get(name, {})
            sign = p.get('sign', '')
            elements[SIGN_ELEMENTS.get(sign, 'Fire')] += 1
            modalities[SIGN_MODALITIES.get(sign, 'Cardinal')] += 1

        dominant_element = max(elements, key=elements.get)
        weak_element = min(elements, key=elements.get)
        dominant_modality = max(modalities, key=modalities.get)

        return {
            'elements': elements,
            'modalities': modalities,
            'dominant_element': dominant_element,
            'weak_element': weak_element,
            'dominant_modality': dominant_modality,
        }

    # ═══════════════════════════════════════════════════════════════
    # BIG THREE + CHART RULER
    # ═══════════════════════════════════════════════════════════════

    def get_big_three(self) -> Dict:
        """Sun sign, Moon sign, Rising sign — the foundation of Western astrology."""
        self._ensure_calculated()
        asc_sign_idx = int(self._ascendant / 30)
        mc_sign_idx = int(self._midheaven / 30)
        return {
            'sun_sign': self._planets['Sun']['sign'],
            'moon_sign': self._planets['Moon']['sign'],
            'rising_sign': SIGNS[asc_sign_idx],
            'ascendant_degree': round(self._ascendant % 30, 2),
            'midheaven_sign': SIGNS[mc_sign_idx],
            'midheaven_degree': round(self._midheaven % 30, 2),
            'chart_ruler': SIGN_RULERS[SIGNS[asc_sign_idx]],
            'chart_ruler_house': self._planets.get(SIGN_RULERS[SIGNS[asc_sign_idx]], {}).get('house', 0),
        }

    # ═══════════════════════════════════════════════════════════════
    # CURRENT TRANSITS (Western)
    # ═══════════════════════════════════════════════════════════════

    def get_current_transits(self) -> List[Dict]:
        """Check current transiting aspects to natal chart."""
        self._ensure_calculated()
        transit_chart = WesternChart(datetime.utcnow(), self.latitude, self.longitude)
        transit_chart._ensure_calculated()

        transit_aspects = []
        for t_name in ['Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']:
            t_long = transit_chart._planets.get(t_name, {}).get('longitude', 0)
            for n_name in WESTERN_PLANETS:
                n_long = self._planets[n_name]['longitude']
                diff = abs(t_long - n_long)
                if diff > 180:
                    diff = 360 - diff
                for asp_name, asp_angle, asp_orb in ASPECTS[:5]:  # Major aspects only
                    orb_actual = abs(diff - asp_angle)
                    if orb_actual <= asp_orb:
                        transit_aspects.append({
                            'transit_planet': t_name,
                            'natal_planet': n_name,
                            'aspect': asp_name,
                            'orb': round(orb_actual, 2),
                            'nature': ASPECT_NATURE[asp_name],
                        })
                        break

        return transit_aspects

    # ═══════════════════════════════════════════════════════════════
    # FULL REPORT
    # ═══════════════════════════════════════════════════════════════

    def generate_full_report(self) -> Dict:
        """Complete Western astrology chart report."""
        self._ensure_calculated()
        big_three = self.get_big_three()
        aspects = self.get_aspects()
        configs = self.get_configurations()
        balance = self.get_element_balance()
        transits = self.get_current_transits()

        # Retrograde planets
        retrogrades = [n for n in WESTERN_PLANETS if self._planets.get(n, {}).get('retrograde')]

        # Dignified / debilitated
        dignified = [n for n in WESTERN_PLANETS if self._planets.get(n, {}).get('dignity') in ('Domicile', 'Exalted')]
        debilitated = [n for n in WESTERN_PLANETS if self._planets.get(n, {}).get('dignity') in ('Detriment', 'Fall')]

        return {
            'system': 'Western (Tropical)',
            'house_system': {'P': 'Placidus', 'K': 'Koch', 'E': 'Equal', 'W': 'Whole Sign'}.get(self.house_system, 'Placidus'),
            'big_three': big_three,
            'planets': {n: self._planets[n] for n in WESTERN_PLANETS if n in self._planets},
            'nodes': {
                'north_node': self._planets.get('North Node', {}),
                'south_node': self._planets.get('South Node', {}),
            },
            'chiron': self._planets.get('Chiron', {}),
            'houses': self._houses,
            'ascendant': round(self._ascendant, 4),
            'midheaven': round(self._midheaven, 4),
            'aspects': aspects,
            'configurations': configs,
            'element_balance': balance,
            'retrogrades': retrogrades,
            'dignified_planets': dignified,
            'debilitated_planets': debilitated,
            'transits': transits,
        }

    @property
    def planets(self):
        self._ensure_calculated()
        return self._planets
