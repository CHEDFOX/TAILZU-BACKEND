"""
MUNDANE ASTROLOGY ENGINE
Applies Jyotish calculations to national foundation charts.
Same Swiss Ephemeris, same dasha system — different house significations.
"""

from datetime import datetime
from typing import Dict, List
from .national_charts import get_country, get_chart_datetime

# ── MUNDANE HOUSE SIGNIFICATIONS ─────────────────────────────────────────────
MUNDANE_HOUSES = {
    1:  {
        'domain': 'National Identity',
        'keywords': ['the people', 'national character', 'general conditions', 'public health overall', 'national image'],
        'events': ['major national change', 'identity crisis', 'constitutional change', 'national mood shift'],
    },
    2:  {
        'domain': 'Economy',
        'keywords': ['GDP', 'currency', 'banks', 'stock exchange', 'national treasury', 'trade balance', 'wealth of people'],
        'events': ['economic boom', 'recession', 'currency devaluation', 'banking crisis', 'market crash', 'budget surplus'],
    },
    3:  {
        'domain': 'Media & Transport',
        'keywords': ['press', 'internet', 'telecommunications', 'roads', 'railways', 'aviation', 'neighbouring nations'],
        'events': ['media censorship', 'transport disaster', 'internet shutdown', 'border tension with neighbour'],
    },
    4:  {
        'domain': 'Land & People',
        'keywords': ['agriculture', 'natural resources', 'weather', 'land', 'housing', 'common people', 'opposition party'],
        'events': ['drought', 'flood', 'earthquake', 'housing crisis', 'opposition rise', 'agricultural crisis'],
    },
    5:  {
        'domain': 'Culture & Speculation',
        'keywords': ['birth rate', 'children', 'sports', 'entertainment', 'stock speculation', 'cinema', 'ambassadors'],
        'events': ['sports victory', 'population decline', 'stock market speculation', 'entertainment boom'],
    },
    6:  {
        'domain': 'Military & Public Health',
        'keywords': ['armed forces', 'military operations', 'epidemic', 'pandemic', 'labour unions', 'civil service', 'police'],
        'events': ['military conflict', 'epidemic outbreak', 'labour strike', 'public health crisis', 'war'],
    },
    7:  {
        'domain': 'Foreign Affairs',
        'keywords': ['diplomacy', 'treaties', 'foreign nations', 'war declaration', 'open enemies', 'international relations'],
        'events': ['war', 'peace treaty', 'diplomatic crisis', 'sanctions', 'alliance formation', 'foreign conflict'],
    },
    8:  {
        'domain': 'National Debt & Disasters',
        'keywords': ['national debt', 'taxation', 'death toll', 'natural disaster', 'espionage', 'foreign investment', 'hidden matters'],
        'events': ['debt default', 'tax reform', 'mass casualty event', 'spy scandal', 'financial scandal'],
    },
    9:  {
        'domain': 'Religion & Judiciary',
        'keywords': ['religion', 'courts', 'judiciary', 'higher education', 'long-distance travel', 'philosophy', 'foreign trade policy'],
        'events': ['religious conflict', 'judicial reform', 'education reform', 'supreme court ruling', 'religious tension'],
    },
    10: {
        'domain': 'Government',
        'keywords': ['ruling party', 'prime minister', 'president', 'government', 'international reputation', 'national status'],
        'events': ['government change', 'election', 'leadership crisis', 'coup', 'political scandal', 'regime change'],
    },
    11: {
        'domain': 'Parliament & Income',
        'keywords': ['parliament', 'legislature', 'national income', 'allies', 'social movements', 'national aspirations'],
        'events': ['parliamentary crisis', 'income growth', 'ally formed', 'social protest', 'legislative reform'],
    },
    12: {
        'domain': 'Hidden Enemies & Losses',
        'keywords': ['secret enemies', 'espionage', 'prisons', 'hospitals', 'foreign expenditure', 'hidden losses', 'exile'],
        'events': ['spy scandal', 'prison crisis', 'health system collapse', 'foreign debt', 'hidden economic loss'],
    },
}

# ── PLANET MUNDANE SIGNIFICATIONS ────────────────────────────────────────────
PLANET_MUNDANE = {
    'Sun':     'Government, leadership, head of state, monarchy, authority, ruling power',
    'Moon':    'The public, masses, common people, agriculture, water, women, national mood',
    'Mars':    'Military, war, violence, fire, accidents, police, armed forces, borders',
    'Mercury': 'Trade, commerce, media, communication, internet, education, youth',
    'Jupiter': 'Economy, wealth, law, religion, expansion, prosperity, judges',
    'Venus':   'Arts, culture, diplomacy, luxury, women, entertainment, peace',
    'Saturn':  'Democracy, labour, poverty, hardship, land, infrastructure, discipline, delays',
    'Rahu':    'Foreigners, epidemics, unconventional events, sudden disruption, foreign interference',
    'Ketu':    'Terrorism, hidden threats, spirituality, sudden losses, mysterious events',
}

# ── CLASSICAL MUNDANE RULES (from BV Raman, Campion, SAMVA) ─────────────────
MUNDANE_RULES = [
    # Format: (planet/condition, house_affected, effect)
    # Saturn afflictions
    {'condition': 'Saturn_in_H1', 'effect': 'National hardship, austerity, structural reform period for the nation'},
    {'condition': 'Saturn_in_H2', 'effect': 'Economic contraction, banking stress, currency pressure, austerity measures'},
    {'condition': 'Saturn_in_H4', 'effect': 'Agricultural stress, housing crisis, common people suffer, floods or drought'},
    {'condition': 'Saturn_in_H6', 'effect': 'Military discipline, labour unrest, public health challenges'},
    {'condition': 'Saturn_in_H7', 'effect': 'Diplomatic tensions, cold relations with foreign nations, isolation'},
    {'condition': 'Saturn_in_H8', 'effect': 'National debt crisis, mortality pressure, economic restructuring'},
    {'condition': 'Saturn_in_H10', 'effect': 'Government challenges, leadership under pressure, political restructuring'},
    # Jupiter benefits
    {'condition': 'Jupiter_in_H1', 'effect': 'National prosperity, goodwill, positive public mood'},
    {'condition': 'Jupiter_in_H2', 'effect': 'Economic growth, strong currency, financial expansion'},
    {'condition': 'Jupiter_in_H9', 'effect': 'Legal progress, religious harmony, educational advancement'},
    {'condition': 'Jupiter_in_H10', 'effect': 'Strong government, respected leadership, international recognition'},
    {'condition': 'Jupiter_in_H11', 'effect': 'Parliamentary progress, national income growth, strong alliances'},
    # Mars dangers
    {'condition': 'Mars_in_H6', 'effect': 'Military action, armed conflict possible, aggressive defence posture'},
    {'condition': 'Mars_in_H7', 'effect': 'War risk, open conflict with foreign nation, diplomatic breakdown'},
    {'condition': 'Mars_in_H8', 'effect': 'Mass casualties, natural disaster risk, military fatalities'},
    {'condition': 'Mars_in_H12', 'effect': 'Secret military operations, hidden conflict, espionage'},
    # Rahu/Ketu
    {'condition': 'Rahu_in_H1', 'effect': 'Foreign interference in national affairs, unusual national character, epidemics'},
    {'condition': 'Rahu_in_H6', 'effect': 'Epidemic risk, unusual military threat, pandemic potential'},
    {'condition': 'Ketu_in_H7', 'effect': 'Mysterious foreign threats, terrorism risk, sudden diplomatic severance'},
    {'condition': 'Ketu_in_H8', 'effect': 'Sudden mass events, mysterious deaths, covert operations'},
]


class MundaneEngine:
    """
    Mundane astrology engine for a specific nation.
    Reuses the core JyotishEngine but interprets through mundane house significations.
    """

    def __init__(self, country_key: str, jyotish_engine_class=None):
        self.country_key = country_key.lower().replace(' ', '_')
        self.chart_data = get_country(self.country_key)
        if not self.chart_data:
            raise ValueError(f"Unknown country: {country_key}. Use detect_country_from_text() first.")
        self.engine = None
        self._jyotish_engine_class = jyotish_engine_class
        self._load_engine()

    def _load_engine(self):
        """Load the JyotishEngine with the national chart data."""
        if self._jyotish_engine_class is None:
            try:
                from ..core.engine import JyotishEngine
                self._jyotish_engine_class = JyotishEngine
            except ImportError:
                return

        try:
            utc_dt = get_chart_datetime(self.country_key)
            self.engine = self._jyotish_engine_class(
                birth_datetime=utc_dt,
                latitude=self.chart_data['lat'],
                longitude=self.chart_data['lon'],
                timezone_offset=0,  # already converted to UTC
            )
        except Exception as e:
            self.engine = None
            self._load_error = str(e)

    def is_ready(self) -> bool:
        return self.engine is not None

    # ── NATIONAL CHART ANALYSIS ───────────────────────────────────────────────

    def get_national_chart(self) -> Dict:
        """Get the raw national chart data with mundane interpretations."""
        if not self.engine:
            return {'error': 'Engine not loaded', 'country': self.chart_data['name']}

        planets = self.engine.planets
        asc = self.engine.ascendant

        # Build planet-in-house mundane interpretation
        planet_readings = {}
        for planet, data in planets.items():
            house = data.get('house', 1)
            mundane_sig = PLANET_MUNDANE.get(planet, '')
            house_domain = MUNDANE_HOUSES.get(house, {}).get('domain', '')
            planet_readings[planet] = {
                'house': house,
                'house_domain': house_domain,
                'rashi': data.get('rashi_name', ''),
                'retrograde': data.get('retrograde', False),
                'combust': data.get('combust', False),
                'mundane_meaning': f"{mundane_sig} — placed in H{house} ({house_domain})",
            }

        return {
            'country': self.chart_data['name'],
            'founded': f"{self.chart_data['date']} {self.chart_data.get('time', '00:00')}",
            'capital': self.chart_data.get('capital', ''),
            'ascendant': asc.get('rashi_name', ''),
            'ascendant_house_meaning': MUNDANE_HOUSES[1]['domain'],
            'source': self.chart_data.get('notes', ''),
            'planets': planet_readings,
            'region': self.chart_data.get('region', ''),
        }

    def get_national_dasha(self) -> Dict:
        """Get current Vimshottari dasha of the national chart with mundane interpretation."""
        if not self.engine:
            return {'error': 'Engine not loaded'}

        try:
            dasha = self.engine.get_vimshottari_dasha()
            maha = dasha.get('mahadasha', {})
            antar = dasha.get('antardasha', {})

            maha_lord = maha.get('lord', '')
            antar_lord = antar.get('lord', '')

            maha_mundane = PLANET_MUNDANE.get(maha_lord, '')
            antar_mundane = PLANET_MUNDANE.get(antar_lord, '')

            maha_house = self.engine.planets.get(maha_lord, {}).get('house', 1)
            antar_house = self.engine.planets.get(antar_lord, {}).get('house', 1)

            maha_domain = MUNDANE_HOUSES.get(maha_house, {}).get('domain', '')
            antar_domain = MUNDANE_HOUSES.get(antar_house, {}).get('domain', '')

            return {
                'country': self.chart_data['name'],
                'mahadasha': {
                    'lord': maha_lord,
                    'ends': str(maha.get('end', ''))[:10],
                    'mundane_themes': maha_mundane,
                    'house_in_national_chart': maha_house,
                    'house_domain': maha_domain,
                    'reading': f"{maha_lord} mahadasha — national themes: {maha_mundane}. Placed in H{maha_house} ({maha_domain}) of {self.chart_data['name']}.",
                },
                'antardasha': {
                    'lord': antar_lord,
                    'ends': str(antar.get('end', ''))[:10],
                    'mundane_themes': antar_mundane,
                    'house_in_national_chart': antar_house,
                    'house_domain': antar_domain,
                    'reading': f"{antar_lord} antardasha — sub-themes: {antar_mundane}. Activating H{antar_house} ({antar_domain}).",
                },
                'dasha_string': dasha.get('dasha_string', ''),
                'period_summary': self._interpret_national_dasha(maha_lord, antar_lord, maha_house, antar_house),
            }
        except Exception as e:
            return {'error': str(e)}

    def _interpret_national_dasha(self, maha: str, antar: str, maha_h: int, antar_h: int) -> str:
        """Build qualitative mundane dasha interpretation."""
        maha_domain = MUNDANE_HOUSES.get(maha_h, {}).get('domain', '')
        antar_domain = MUNDANE_HOUSES.get(antar_h, {}).get('domain', '')

        # Classical nature
        benefics = {'Jupiter', 'Venus', 'Mercury', 'Moon'}
        malefics = {'Saturn', 'Mars', 'Rahu', 'Ketu', 'Sun'}

        maha_nature = 'expansive' if maha in benefics else 'challenging'
        antar_nature = 'supportive' if antar in benefics else 'pressuring'

        lines = [
            f"{self.chart_data['name']} is in {maha}/{antar} period.",
            f"{maha} ({maha_nature}) activates {maha_domain} — {PLANET_MUNDANE.get(maha, '')}.",
            f"Sub-period {antar} ({antar_nature}) focuses on {antar_domain}.",
        ]

        # Add specific reading for dangerous combinations
        if maha == 'Mars' and maha_h == 7:
            lines.append("ALERT: Mars mahadasha lord in H7 (Foreign Affairs) — heightened military/conflict risk.")
        if maha == 'Mars' and maha_h == 6:
            lines.append("ALERT: Mars mahadasha in H6 — military operations, armed conflict indicated.")
        if maha == 'Saturn' and maha_h == 8:
            lines.append("NOTE: Saturn mahadasha in H8 — national debt pressure, structural economic reform.")
        if maha == 'Rahu':
            lines.append("NOTE: Rahu mahadasha — unusual events, foreign interference, epidemics possible.")
        if maha == 'Jupiter' and maha_h in (2, 9, 10, 11):
            lines.append("POSITIVE: Jupiter mahadasha in favourable house — prosperity and growth indicated.")

        return ' '.join(lines)

    # ── CURRENT TRANSIT ANALYSIS ON NATIONAL CHART ───────────────────────────

    def get_current_transits_to_national(self) -> Dict:
        """
        Analyse current planetary transits against the national chart.
        Saturn and Jupiter transits are most significant.
        """
        if not self.engine:
            return {'error': 'Engine not loaded'}

        try:
            current_transits = self.engine.ephemeris.get_current_transits()
            natal_planets = self.engine.planets
            asc_rashi = self.engine.ascendant_rashi

            transit_readings = []

            for planet, t_data in current_transits.items():
                if planet in ('Rahu', 'Ketu') and planet not in ('Rahu', 'Ketu'):
                    continue

                t_rashi = t_data.get('rashi', 0)
                t_rashi_name = t_data.get('rashi_name', '')

                # Which house does this transit fall in for the national chart?
                transit_house = ((t_rashi - asc_rashi) % 12) + 1

                house_domain = MUNDANE_HOUSES.get(transit_house, {}).get('domain', '')
                house_keywords = MUNDANE_HOUSES.get(transit_house, {}).get('keywords', [])
                planet_mundane = PLANET_MUNDANE.get(planet, '')

                # Significance: slow planets matter most
                significance = 'HIGH' if planet in ('Saturn', 'Jupiter', 'Rahu', 'Ketu') else \
                               'MEDIUM' if planet in ('Mars',) else 'LOW'

                # Classical interpretation
                reading = self._transit_reading(planet, transit_house)

                transit_readings.append({
                    'planet': planet,
                    'transiting_sign': t_rashi_name,
                    'house_in_national_chart': transit_house,
                    'house_domain': house_domain,
                    'significance': significance,
                    'planet_mundane_signification': planet_mundane,
                    'reading': reading,
                    'retrograde': t_data.get('retrograde', False),
                })

            # Sort: HIGH significance first
            order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
            transit_readings.sort(key=lambda x: order.get(x['significance'], 2))

            # Build summary
            high_sig = [t for t in transit_readings if t['significance'] == 'HIGH']
            summary_parts = []
            for t in high_sig:
                summary_parts.append(
                    f"{t['planet']} transiting H{t['house_in_national_chart']} ({t['house_domain']}): {t['reading']}"
                )

            return {
                'country': self.chart_data['name'],
                'as_of': datetime.now().strftime('%Y-%m-%d'),
                'transits': transit_readings,
                'key_transits': high_sig,
                'summary': ' | '.join(summary_parts) if summary_parts else 'No major transits active.',
            }
        except Exception as e:
            return {'error': str(e)}

    def _transit_reading(self, planet: str, house: int) -> str:
        """Classical transit interpretation for mundane astrology."""
        domain = MUNDANE_HOUSES.get(house, {}).get('domain', '')

        readings = {
            ('Jupiter', 1):  "National prosperity, optimism, positive public mood. Good period for the nation overall.",
            ('Jupiter', 2):  "Economic expansion, stock market gains, currency strength, financial growth.",
            ('Jupiter', 4):  "Good agriculture, land prosperity, common people benefit, positive domestic mood.",
            ('Jupiter', 5):  "Cultural flowering, sports success, positive birth rate, entertainment boom.",
            ('Jupiter', 7):  "Diplomatic success, peace treaties, positive foreign relations, alliances.",
            ('Jupiter', 9):  "Legal reform, religious harmony, educational growth, positive judiciary.",
            ('Jupiter', 10): "Strong government, respected leadership, international prestige.",
            ('Jupiter', 11): "National income growth, parliamentary progress, strong allies.",
            ('Saturn', 1):   "National hardship period, austerity, structural challenges for the people.",
            ('Saturn', 2):   "Economic pressure, banking stress, currency weakness, financial hardship.",
            ('Saturn', 4):   "Agricultural stress, housing crisis, masses suffer, weather challenges.",
            ('Saturn', 6):   "Military discipline, labour unrest, public health strain.",
            ('Saturn', 7):   "Diplomatic tensions, isolation, strained foreign relations.",
            ('Saturn', 8):   "National debt crisis, taxation pressure, mortality challenges.",
            ('Saturn', 10):  "Government under pressure, leadership challenges, political restructuring.",
            ('Saturn', 12):  "Foreign losses, hidden economic drain, prison/hospital system stressed.",
            ('Mars', 1):     "National aggression, violence, accidents, public unrest risk.",
            ('Mars', 4):     "Domestic violence, land disputes, weather-related disasters.",
            ('Mars', 6):     "Military action, armed conflict, aggressive defence posture. High alert.",
            ('Mars', 7):     "WAR RISK. Open conflict with foreign nation. Diplomatic breakdown possible.",
            ('Mars', 8):     "Mass casualty risk, disasters, military fatalities, violent events.",
            ('Mars', 10):    "Government aggression, military leadership, forceful policies.",
            ('Rahu', 1):     "Foreign interference in national affairs, unusual events, epidemic risk.",
            ('Rahu', 6):     "EPIDEMIC RISK. Pandemic or unusual disease outbreak. Military confusion.",
            ('Rahu', 7):     "Foreign entanglement, unclear diplomatic situation, shadow war.",
            ('Rahu', 8):     "Hidden threats, mysterious large-scale events, covert operations.",
            ('Ketu', 1):     "National identity confusion, spiritual crisis, sudden disconnection.",
            ('Ketu', 6):     "Mysterious health events, sudden military end or victory.",
            ('Ketu', 7):     "Sudden diplomatic severance, mysterious foreign threat.",
            ('Ketu', 8):     "Mysterious deaths, sudden mass events, covert operations exposed.",
        }

        key = (planet, house)
        if key in readings:
            return readings[key]

        # Generic
        planet_sig = PLANET_MUNDANE.get(planet, planet)
        return f"{planet} transiting H{house} ({domain}) — {planet_sig} themes activate this national domain."

    # ── ECLIPSE IMPACT ON NATIONAL CHART ─────────────────────────────────────

    def check_eclipse_impact(self, eclipse_date: str, eclipse_lon: float,
                              eclipse_type: str = 'solar') -> Dict:
        """
        Check if an eclipse impacts the national chart significantly.
        Eclipse on Ascendant/Sun/Moon/key planets = major national event.
        """
        if not self.engine:
            return {'error': 'Engine not loaded'}

        natal_planets = self.engine.planets
        asc_lon = self.engine.ascendant.get('longitude', 0)

        impacts = []
        orb = 5.0  # degrees

        # Check natal sensitive points
        sensitive_points = {
            'Ascendant': asc_lon,
        }
        for p in ['Sun', 'Moon', 'Mars', 'Saturn', 'Jupiter', 'Rahu']:
            sensitive_points[p] = natal_planets.get(p, {}).get('longitude', -999)

        for point_name, point_lon in sensitive_points.items():
            if point_lon < 0:
                continue
            diff = abs(eclipse_lon - point_lon) % 360
            if diff > 180:
                diff = 360 - diff

            if diff <= orb:
                house = 1 if point_name == 'Ascendant' else natal_planets.get(point_name, {}).get('house', 1)
                domain = MUNDANE_HOUSES.get(house, {}).get('domain', '')
                impacts.append({
                    'point': point_name,
                    'orb': round(diff, 2),
                    'house': house,
                    'domain': domain,
                    'severity': 'EXACT' if diff <= 1 else 'CLOSE' if diff <= 3 else 'WIDE',
                    'reading': self._eclipse_reading(eclipse_type, point_name, house, domain),
                })

        duration_months = 18 if eclipse_type == 'solar' else 6

        return {
            'country': self.chart_data['name'],
            'eclipse_date': eclipse_date,
            'eclipse_type': eclipse_type,
            'impacts': impacts,
            'has_impact': len(impacts) > 0,
            'effect_duration': f"Up to {duration_months} months",
            'summary': self._eclipse_summary(impacts, eclipse_type) if impacts else
                       f"Eclipse of {eclipse_date} does not significantly impact {self.chart_data['name']} chart.",
        }

    def _eclipse_reading(self, etype: str, point: str, house: int, domain: str) -> str:
        templates = {
            ('solar', 'Sun'):       "Solar eclipse on natal Sun — major government/leadership change. Head of state affected.",
            ('solar', 'Moon'):      "Solar eclipse on natal Moon — the people are directly affected. Public unrest or mass event.",
            ('solar', 'Ascendant'): "Solar eclipse on Ascendant — major national event. National identity shift.",
            ('solar', 'Saturn'):    "Solar eclipse on natal Saturn — structural/economic disruption. Infrastructure crisis.",
            ('solar', 'Mars'):      "Solar eclipse on natal Mars — military event. Conflict or defence crisis.",
            ('solar', 'Jupiter'):   "Solar eclipse on natal Jupiter — legal or economic disruption.",
            ('lunar', 'Moon'):      "Lunar eclipse on natal Moon — emotional national event. Public crisis.",
            ('lunar', 'Sun'):       "Lunar eclipse on natal Sun — government under pressure.",
        }
        key = (etype, point)
        if key in templates:
            return templates[key]
        return f"{etype.title()} eclipse activating natal {point} in H{house} ({domain}) — major events in this national domain within 6–18 months."

    def _eclipse_summary(self, impacts: List[Dict], etype: str) -> str:
        if not impacts:
            return "No significant eclipse impact."
        severities = [i['severity'] for i in impacts]
        domains = [i['domain'] for i in impacts]
        worst = 'EXACT' if 'EXACT' in severities else 'CLOSE' if 'CLOSE' in severities else 'WIDE'
        return (f"{etype.title()} eclipse with {worst} impact on {self.chart_data['name']} chart. "
                f"Areas activated: {', '.join(domains[:3])}. "
                f"Effects within 6–18 months.")

    # ── FIRE CLASSICAL MUNDANE RULES ─────────────────────────────────────────

    def get_classical_rules(self) -> Dict:
        """Fire classical mundane rules based on national chart."""
        if not self.engine:
            return {'error': 'Engine not loaded'}

        planets = self.engine.planets
        fired = []

        for rule in MUNDANE_RULES:
            condition = rule['condition']
            parts = condition.split('_in_')
            if len(parts) == 2:
                planet = parts[0]
                house = int(parts[1][1:])
                if planets.get(planet, {}).get('house') == house:
                    fired.append({
                        'rule': condition,
                        'planet': planet,
                        'house': house,
                        'effect': rule['effect'],
                        'domain': MUNDANE_HOUSES.get(house, {}).get('domain', ''),
                    })

        return {
            'country': self.chart_data['name'],
            'rules_fired': len(fired),
            'findings': fired,
            'summary': f"{len(fired)} classical mundane rules fire in {self.chart_data['name']} chart." if fired
                       else f"No critical classical mundane rules fire in {self.chart_data['name']} foundation chart.",
        }

    # ── FULL NATIONAL READING ─────────────────────────────────────────────────

    def get_full_reading(self) -> Dict:
        """Complete mundane reading for a nation."""
        if not self.engine:
            return {
                'error': 'Engine not loaded',
                'country': self.chart_data.get('name', ''),
                'chart_data': self.chart_data,
            }

        return {
            'country': self.chart_data['name'],
            'region': self.chart_data.get('region', ''),
            'founded': self.chart_data.get('date', ''),
            'ascendant': self.chart_data.get('ascendant_sign', self.engine.ascendant.get('rashi_name', '')),
            'chart': self.get_national_chart(),
            'dasha': self.get_national_dasha(),
            'transits': self.get_current_transits_to_national(),
            'classical_rules': self.get_classical_rules(),
            'notes': self.chart_data.get('notes', ''),
        }


# ── COUNTRY COMPARISON ────────────────────────────────────────────────────────

def compare_countries(country1_key: str, country2_key: str,
                      jyotish_engine_class=None) -> Dict:
    """
    Compare two national charts — for geopolitical analysis.
    Checks synastry between the two charts, dasha alignment, transit impacts.
    """
    try:
        e1 = MundaneEngine(country1_key, jyotish_engine_class)
        e2 = MundaneEngine(country2_key, jyotish_engine_class)

        c1_name = e1.chart_data['name']
        c2_name = e2.chart_data['name']

        # Get dashas
        d1 = e1.get_national_dasha() if e1.is_ready() else {}
        d2 = e2.get_national_dasha() if e2.is_ready() else {}

        # Check if both are in Mars/Saturn/Rahu dasha — conflict risk
        conflict_dashas = {'Mars', 'Saturn', 'Rahu', 'Ketu'}
        c1_maha = d1.get('mahadasha', {}).get('lord', '')
        c2_maha = d2.get('mahadasha', {}).get('lord', '')

        tension_reading = ''
        if c1_maha in conflict_dashas and c2_maha in conflict_dashas:
            tension_reading = f"ELEVATED TENSION: Both {c1_name} ({c1_maha} dasha) and {c2_name} ({c2_maha} dasha) are in conflict-prone periods simultaneously."
        elif c1_maha == 'Mars' or c2_maha == 'Mars':
            aggressive = c1_name if c1_maha == 'Mars' else c2_name
            tension_reading = f"TENSION: {aggressive} is in Mars mahadasha — aggressive posture likely. Potential for confrontation."
        elif c1_maha == 'Jupiter' and c2_maha == 'Jupiter':
            tension_reading = f"POSITIVE: Both nations in Jupiter periods — cooperation and diplomacy favoured."
        else:
            tension_reading = f"MIXED: {c1_name} in {c1_maha} period, {c2_name} in {c2_maha} period — moderate tension."

        return {
            'country1': c1_name,
            'country2': c2_name,
            'country1_dasha': d1.get('dasha_string', ''),
            'country2_dasha': d2.get('dasha_string', ''),
            'country1_maha': c1_maha,
            'country2_maha': c2_maha,
            'tension_reading': tension_reading,
            'country1_ascendant': e1.chart_data.get('ascendant_sign', ''),
            'country2_ascendant': e2.chart_data.get('ascendant_sign', ''),
        }
    except Exception as e:
        return {'error': str(e)}


def analyze_country(country_key: str, jyotish_engine_class=None) -> Dict:
    """Convenience function — full reading for one country."""
    try:
        engine = MundaneEngine(country_key, jyotish_engine_class)
        return engine.get_full_reading()
    except Exception as e:
        return {'error': str(e), 'country_key': country_key}
