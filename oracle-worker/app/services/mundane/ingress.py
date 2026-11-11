"""
MUNDANE ASTROLOGY — SOLAR INGRESS CHARTS
The four cardinal ingresses are the primary mundane forecasting tool.

Mesha Sankranti (Sun → Aries)  = most important — sets tone for entire year
Karka Sankranti (Sun → Cancer) = monsoon quarter, domestic affairs
Tula Sankranti  (Sun → Libra)  = foreign affairs, diplomacy quarter
Makara Sankranti(Sun → Capricorn) = government, economy quarter

Classical rule (BV Raman, Mundane Astrology Ch.4):
The Ascendant of the ingress chart cast for the capital city determines
which house lord runs the quarter. That lord's strength and placement
tells the story of the next 3 months for that nation.
"""

from datetime import datetime
from typing import Dict, List

# ── INGRESS DEFINITIONS ───────────────────────────────────────────────────────

INGRESS_TYPES = {
    'aries':     {'sign': 0,  'name': 'Mesha Sankranti',  'quarter': 'Annual',   'themes': 'National tone for entire year. War/peace. Leadership.'},
    'cancer':    {'sign': 3,  'name': 'Karka Sankranti',  'quarter': 'Monsoon',  'themes': 'Agriculture, domestic affairs, public mood, water.'},
    'libra':     {'sign': 6,  'name': 'Tula Sankranti',   'quarter': 'Autumn',   'themes': 'Foreign affairs, diplomacy, treaties, trade.'},
    'capricorn': {'sign': 9,  'name': 'Makara Sankranti', 'quarter': 'Winter',   'themes': 'Government, economy, banking, authority.'},
}

# Approximate Sun ingress dates (within ±2 days each year)
# Exact times computed by ephemeris
APPROX_INGRESS_DATES = {
    'aries':     {'month': 4, 'day': 14},  # Mesha Sankranti ~April 14 (sidereal)
    'cancer':    {'month': 7, 'day': 16},  # Karka Sankranti ~July 16
    'libra':     {'month': 10,'day': 17},  # Tula Sankranti ~Oct 17
    'capricorn': {'month': 1, 'day': 14},  # Makara Sankranti ~Jan 14
}

# Mundane house significations for ingress chart reading
# (same as national chart houses)
INGRESS_HOUSE_THEMES = {
    1:  'Nation, people, general conditions',
    2:  'Economy, currency, banks',
    3:  'Media, transport, neighbours',
    4:  'Land, agriculture, weather, masses',
    5:  'Culture, speculation, birth rate',
    6:  'Military, health, labour',
    7:  'Foreign affairs, war, diplomacy',
    8:  'Debt, disasters, taxation',
    9:  'Religion, judiciary, education',
    10: 'Government, PM/President',
    11: 'Parliament, national income',
    12: 'Hidden enemies, losses, espionage',
}

# Planet significations for ingress interpretation
INGRESS_PLANET_THEMES = {
    'Sun':     'Government authority, head of state',
    'Moon':    'Public mood, masses, agriculture',
    'Mars':    'Military, conflict, violence',
    'Mercury': 'Trade, media, communication',
    'Jupiter': 'Economy, law, prosperity',
    'Venus':   'Diplomacy, arts, peace',
    'Saturn':  'Hardship, labour, discipline',
    'Rahu':    'Foreign elements, epidemics, disruption',
    'Ketu':    'Hidden threats, spirituality, sudden events',
}


class IngressChart:
    """
    Calculate and interpret solar ingress charts for mundane forecasting.
    """

    def __init__(self, year: int, ingress_type: str, latitude: float, longitude: float,
                 country_name: str = '', jyotish_engine_class=None):
        self.year = year
        self.ingress_type = ingress_type.lower()
        self.latitude = latitude
        self.longitude = longitude
        self.country_name = country_name
        self.engine = None
        self._jyotish_engine_class = jyotish_engine_class

        if self.ingress_type not in INGRESS_TYPES:
            raise ValueError(f"Unknown ingress type: {ingress_type}. Use: {list(INGRESS_TYPES.keys())}")

        self._load_engine()

    def _get_ingress_datetime(self) -> datetime:
        """
        Calculate approximate ingress datetime for the given year.
        Uses sidereal (Lahiri) Sun position.
        The real implementation uses ephemeris binary search.
        Returns approximate datetime — exact version uses Swiss Ephemeris.
        """
        info = APPROX_INGRESS_DATES[self.ingress_type]
        month = info['month']
        day = info['day']

        # Handle Capricorn ingress which falls in January of the same year
        # For a "year 2026" forecast, Makara falls Jan 2026
        target_year = self.year
        return datetime(target_year, month, day, 6, 0, 0)  # approximate 6 AM UTC

    def _load_engine(self):
        if self._jyotish_engine_class is None:
            try:
                from ..core.engine import JyotishEngine
                self._jyotish_engine_class = JyotishEngine
            except ImportError:
                return
        try:
            ingress_dt = self._get_ingress_datetime()
            self.engine = self._jyotish_engine_class(
                birth_datetime=ingress_dt,
                latitude=self.latitude,
                longitude=self.longitude,
                timezone_offset=0,
                name=f"{INGRESS_TYPES[self.ingress_type]['name']} {self.year}",
            )
            self.ingress_dt = ingress_dt
        except Exception as e:
            self.engine = None
            self._error = str(e)

    def get_ingress_reading(self) -> Dict:
        """Full ingress chart reading for this quarter."""
        info = INGRESS_TYPES[self.ingress_type]

        if not self.engine:
            return {
                'error': getattr(self, '_error', 'Engine not loaded'),
                'ingress': info['name'],
                'year': self.year,
            }

        planets = self.engine.planets
        asc = self.engine.ascendant
        asc_rashi = self.engine.ascendant_rashi

        # Ascendant lord of ingress chart
        from ..core.constants import RASHI_LORDS
        asc_lord = RASHI_LORDS[asc_rashi]
        asc_lord_house = planets.get(asc_lord, {}).get('house', 1)
        asc_lord_domain = INGRESS_HOUSE_THEMES.get(asc_lord_house, '')

        # Find which planets are in angular houses (1,4,7,10) — most powerful
        angular_planets = []
        for planet, data in planets.items():
            if data.get('house') in (1, 4, 7, 10):
                angular_planets.append({
                    'planet': planet,
                    'house': data['house'],
                    'house_theme': INGRESS_HOUSE_THEMES.get(data['house'], ''),
                    'planet_theme': INGRESS_PLANET_THEMES.get(planet, ''),
                })

        # Find strongest planet in ingress chart (simple: in own sign or exalted)
        from ..core.constants import PLANETS as PLANET_DATA
        strong_planets = []
        for planet, data in planets.items():
            rashi = data.get('rashi', 0)
            pi = PLANET_DATA.get(planet, {})
            if rashi == pi.get('exalted') or rashi in pi.get('owns', []):
                strong_planets.append(planet)

        # Planets in H7 (foreign affairs) and H6 (military)
        war_indicators = []
        for planet, data in planets.items():
            if data.get('house') in (6, 7) and planet in ('Mars', 'Saturn', 'Rahu', 'Ketu'):
                war_indicators.append(f"{planet} in H{data['house']} ({INGRESS_HOUSE_THEMES.get(data['house'], '')})")

        # Planets in H2 (economy) and H10 (government)
        econ_gov = []
        for planet, data in planets.items():
            if data.get('house') in (2, 10):
                econ_gov.append(f"{planet} in H{data['house']} ({INGRESS_HOUSE_THEMES.get(data['house'], '')})")

        # Build qualitative quarter forecast
        forecast = self._build_forecast(
            asc_lord, asc_lord_house, asc_lord_domain,
            angular_planets, strong_planets, war_indicators, econ_gov
        )

        return {
            'country': self.country_name,
            'ingress_type': self.ingress_type,
            'ingress_name': info['name'],
            'quarter': info['quarter'],
            'themes': info['themes'],
            'date': self.ingress_dt.strftime('%Y-%m-%d'),
            'year': self.year,
            'ascendant': asc.get('rashi_name', ''),
            'ascendant_lord': asc_lord,
            'ascendant_lord_house': asc_lord_house,
            'ascendant_lord_domain': asc_lord_domain,
            'angular_planets': angular_planets,
            'strong_planets': strong_planets,
            'war_indicators': war_indicators,
            'economy_government': econ_gov,
            'forecast': forecast,
        }

    def _build_forecast(self, asc_lord: str, asc_lord_house: int, asc_lord_domain: str,
                        angular_planets: List, strong_planets: List,
                        war_indicators: List, econ_gov: List) -> str:
        """Build qualitative quarter forecast from ingress chart factors."""
        info = INGRESS_TYPES[self.ingress_type]
        lines = [f"{info['name']} {self.year} for {self.country_name}:"]

        # Ascendant lord placement
        asc_lord_theme = INGRESS_PLANET_THEMES.get(asc_lord, '')
        lines.append(
            f"Chart lord {asc_lord} ({asc_lord_theme}) falls in H{asc_lord_house} "
            f"({asc_lord_domain}) — the quarter's primary theme is {asc_lord_domain}."
        )

        # Angular planets
        if angular_planets:
            for ap in angular_planets[:2]:
                lines.append(
                    f"{ap['planet']} angular in H{ap['house']} ({ap['house_theme']}) — "
                    f"{ap['planet_theme']} matters are prominent this quarter."
                )

        # Strong planets
        if strong_planets:
            lines.append(f"Strong planets: {', '.join(strong_planets)} — their domains flourish.")

        # War/conflict indicators
        if war_indicators:
            lines.append(f"CONFLICT INDICATORS: {'; '.join(war_indicators)}. Military or diplomatic tension possible.")
        else:
            lines.append("No major conflict indicators in angular houses.")

        # Economy/government
        if econ_gov:
            lines.append(f"Economy/Government focus: {'; '.join(econ_gov)}.")

        # Ingress-specific classical rules
        if self.ingress_type == 'aries':
            lines.append("Mesha Sankranti sets the tone for the full year — this reading applies to all four quarters.")
        elif self.ingress_type == 'cancer':
            lines.append("Karka Sankranti governs monsoon, agriculture, and public mood through Q3.")
        elif self.ingress_type == 'libra':
            lines.append("Tula Sankranti governs foreign policy and diplomacy through Q4.")
        elif self.ingress_type == 'capricorn':
            lines.append("Makara Sankranti governs government stability and economic structure for Q1.")

        return ' '.join(lines)


# ── GREAT CONJUNCTIONS ────────────────────────────────────────────────────────

# Jupiter-Saturn conjunctions — occur every ~20 years
# These define world eras in mundane astrology
GREAT_CONJUNCTIONS = [
    {'date': '1961-02-18', 'sign': 'Capricorn', 'degree': 1.0,  'era': 'Cold War intensification, space race, decolonisation'},
    {'date': '1981-01-01', 'sign': 'Libra',     'degree': 9.0,  'era': 'Neoliberal economics era, Reagan-Thatcher, globalisation begins'},
    {'date': '2000-05-28', 'sign': 'Taurus',    'degree': 22.0, 'era': 'Internet age, dot-com, US hegemony, financial capitalism'},
    {'date': '2020-12-21', 'sign': 'Aquarius',  'degree': 0.0,  'era': 'Information age, digital economy, pandemic era, multipolarity'},
    # Next: ~2040 in Libra
]

def get_current_great_conjunction() -> Dict:
    """Return the most recent Great Conjunction and its mundane era."""
    now = datetime.now()
    current = None
    for gc in reversed(GREAT_CONJUNCTIONS):
        gc_date = datetime.strptime(gc['date'], '%Y-%m-%d')
        if gc_date <= now:
            current = gc
            break
    if current:
        gc_date = datetime.strptime(current['date'], '%Y-%m-%d')
        years_in = (now - gc_date).days / 365.25
        return {
            'conjunction_date': current['date'],
            'sign': current['sign'],
            'era_description': current['era'],
            'years_into_era': round(years_in, 1),
            'reading': (
                f"The current world era began with Jupiter-Saturn conjunction in {current['sign']} "
                f"on {current['date']}. We are {years_in:.1f} years into this era. "
                f"Classical theme: {current['era']}."
            ),
        }
    return {}


# ── CONVENIENCE FUNCTIONS ─────────────────────────────────────────────────────

def get_current_ingress(latitude: float, longitude: float,
                        country_name: str = '',
                        jyotish_engine_class=None) -> Dict:
    """
    Get the most recently passed solar ingress chart for a location.
    This is the active ingress for the current quarter.
    """
    now = datetime.now()
    year = now.year

    # Figure out which ingress is currently active
    # Approximate boundaries (sidereal):
    # Aries ingress active: Apr 14 – Jul 15
    # Cancer ingress active: Jul 16 – Oct 16
    # Libra ingress active: Oct 17 – Jan 13
    # Capricorn ingress active: Jan 14 – Apr 13

    month = now.month
    day = now.day

    if (month == 4 and day >= 14) or (month in (5, 6)) or (month == 7 and day <= 15):
        active = 'aries'
    elif (month == 7 and day >= 16) or (month in (8, 9)) or (month == 10 and day <= 16):
        active = 'cancer'
    elif (month == 10 and day >= 17) or month in (11, 12) or (month == 1 and day <= 13):
        active = 'libra'
        if month in (11, 12):
            year = year  # same year
        else:
            year = year  # Jan still same ingress year
    else:
        active = 'capricorn'

    try:
        chart = IngressChart(year, active, latitude, longitude, country_name, jyotish_engine_class)
        return chart.get_ingress_reading()
    except Exception as e:
        return {'error': str(e), 'active_ingress': active, 'year': year}


def get_annual_ingress_forecast(year: int, latitude: float, longitude: float,
                                 country_name: str = '',
                                 jyotish_engine_class=None) -> Dict:
    """Get all four ingress readings for a full year forecast."""
    results = {}
    for ingress_type in INGRESS_TYPES:
        try:
            chart = IngressChart(year, ingress_type, latitude, longitude,
                                 country_name, jyotish_engine_class)
            results[ingress_type] = chart.get_ingress_reading()
        except Exception as e:
            results[ingress_type] = {'error': str(e)}

    # Overall year summary from Aries ingress
    aries = results.get('aries', {})
    year_summary = aries.get('forecast', f"Annual forecast for {year} — see quarterly readings.")

    return {
        'country': country_name,
        'year': year,
        'year_summary': year_summary,
        'great_conjunction': get_current_great_conjunction(),
        'quarters': results,
    }
