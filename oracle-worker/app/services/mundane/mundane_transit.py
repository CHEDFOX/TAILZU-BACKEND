"""
MUNDANE ASTROLOGY — TRANSIT ANALYSIS ON NATIONAL CHARTS
Applies current and future planetary transits to national foundation charts.

Classical rules (BV Raman, Mundane Astrology):
- Saturn transits: 2.5 years per sign — most significant mundane timer
- Jupiter transits: 1 year per sign — expansion/contraction of house themes
- Rahu/Ketu: 18 months per sign — foreign interference, epidemics, disruptions
- Mars transits: 45 days per sign — acute triggers, conflict sparks
- Eclipse transits: check within 5° of natal sensitive points
"""

from datetime import datetime
from typing import Dict, List
from .national_charts import NATIONAL_CHARTS, get_country
from .mundane_engine import MUNDANE_HOUSES, PLANET_MUNDANE, MundaneEngine

# ── TRANSIT SIGNIFICANCE WEIGHTS ─────────────────────────────────────────────
# How long each planet stays in a sign and how significant it is mundanely

TRANSIT_SIGNIFICANCE = {
    'Saturn':  {'duration_months': 30,  'significance': 'CRITICAL',  'reason': 'Defines 2.5 year national chapter'},
    'Jupiter': {'duration_months': 12,  'significance': 'HIGH',      'reason': 'Annual national cycle'},
    'Rahu':    {'duration_months': 18,  'significance': 'HIGH',      'reason': '18-month foreign/epidemic cycle'},
    'Ketu':    {'duration_months': 18,  'significance': 'HIGH',      'reason': '18-month hidden threat cycle'},
    'Mars':    {'duration_months': 1.5, 'significance': 'MEDIUM',    'reason': 'Acute 45-day conflict trigger'},
    'Sun':     {'duration_months': 1,   'significance': 'LOW',       'reason': 'Monthly government focus'},
    'Mercury': {'duration_months': 1,   'significance': 'LOW',       'reason': 'Monthly trade/media focus'},
    'Venus':   {'duration_months': 1,   'significance': 'LOW',       'reason': 'Monthly diplomatic focus'},
    'Moon':    {'duration_months': 0.1, 'significance': 'DAILY',     'reason': 'Daily public mood'},
}

# ── CRITICAL TRANSIT COMBINATIONS ────────────────────────────────────────────
# When two slow planets transit the same house simultaneously

CRITICAL_COMBINATIONS = [
    {
        'planets': ('Saturn', 'Mars'),
        'houses': [6, 7, 8],
        'reading': 'WAR RISK: Saturn + Mars in H{house} — sustained military conflict. Classical texts consider this the primary war indicator.',
        'severity': 'CRITICAL',
    },
    {
        'planets': ('Saturn', 'Rahu'),
        'houses': [1, 6, 8],
        'reading': 'EPIDEMIC/CRISIS: Saturn + Rahu in H{house} — pandemic or major national crisis. Seen before COVID-19 (2020), Spanish Flu (1918).',
        'severity': 'CRITICAL',
    },
    {
        'planets': ('Jupiter', 'Saturn'),
        'houses': [1, 2, 10],
        'reading': 'STRUCTURAL SHIFT: Jupiter + Saturn in H{house} — major national restructuring. Economic or political system change.',
        'severity': 'HIGH',
    },
    {
        'planets': ('Mars', 'Rahu'),
        'houses': [6, 7, 8, 12],
        'reading': 'VIOLENCE RISK: Mars + Rahu in H{house} — sudden violent events, terrorism, unexpected military action.',
        'severity': 'HIGH',
    },
    {
        'planets': ('Jupiter', 'Venus'),
        'houses': [1, 2, 7, 10, 11],
        'reading': 'PROSPERITY: Jupiter + Venus in H{house} — economic growth, diplomatic success, cultural flourishing.',
        'severity': 'POSITIVE',
    },
    {
        'planets': ('Jupiter', 'Mercury'),
        'houses': [2, 3, 10, 11],
        'reading': 'TRADE GROWTH: Jupiter + Mercury in H{house} — commercial expansion, media growth, positive communication.',
        'severity': 'POSITIVE',
    },
]

# ── HOUSE-SPECIFIC TRANSIT READINGS ──────────────────────────────────────────
# Detailed readings for each planet transiting each house of a national chart

TRANSIT_READINGS = {
    # SATURN transits
    ('Saturn', 1):  ('CRITICAL', 'National austerity. The people face hardship. General conditions deteriorate. Structural reform forced.'),
    ('Saturn', 2):  ('CRITICAL', 'Economic contraction. Currency under pressure. Banking sector stressed. Recession risk. Austerity measures.'),
    ('Saturn', 3):  ('MEDIUM',   'Media restrictions possible. Transport infrastructure delays. Strained relations with neighbours.'),
    ('Saturn', 4):  ('HIGH',     'Agricultural crisis. Weather extremes. Land disputes. Common people suffer. Housing shortage.'),
    ('Saturn', 5):  ('MEDIUM',   'Birth rate decline. Sports setbacks. Cultural suppression. Stock market speculation restricted.'),
    ('Saturn', 6):  ('HIGH',     'Military reorganisation. Labour strikes. Public health strain. Civil service reform.'),
    ('Saturn', 7):  ('HIGH',     'Diplomatic freeze. Cold relations with foreign nations. Treaty delays. International isolation.'),
    ('Saturn', 8):  ('CRITICAL', 'National debt peaks. Tax burden heavy. Death toll rises. Economic restructuring forced.'),
    ('Saturn', 9):  ('MEDIUM',   'Judicial delays. Religious conservatism. Education budget cuts. Legal system under strain.'),
    ('Saturn', 10): ('CRITICAL', 'Government instability. Leadership under severe pressure. Political restructuring. Election upheaval.'),
    ('Saturn', 11): ('HIGH',     'Parliamentary deadlock. National income falls. Alliances strained. Social aspirations blocked.'),
    ('Saturn', 12): ('HIGH',     'Foreign losses mount. Hidden debt exposed. Prison/hospital system overwhelmed. Exile of leaders.'),
    # JUPITER transits
    ('Jupiter', 1):  ('HIGH',     'National optimism. Prosperity for the people. Positive public mood. Good period overall.'),
    ('Jupiter', 2):  ('HIGH',     'Economic expansion. Stock market rises. Currency strengthens. National wealth grows.'),
    ('Jupiter', 3):  ('MEDIUM',   'Media freedom expands. Transport investment. Positive neighbour relations. Trade communication grows.'),
    ('Jupiter', 4):  ('HIGH',     'Good harvest. Agriculture benefits. Land prosperity. Common people benefit. Domestic happiness.'),
    ('Jupiter', 5):  ('MEDIUM',   'Cultural boom. Sports victories. Birth rate rises. Entertainment flourishes. Market speculation profitable.'),
    ('Jupiter', 6):  ('MEDIUM',   'Military expansion. Health improvements. Labour harmony. Civil service grows.'),
    ('Jupiter', 7):  ('HIGH',     'Diplomatic success. Peace treaties. Foreign alliances. International cooperation.'),
    ('Jupiter', 8):  ('MEDIUM',   'Debt restructuring possible. Research advances. Tax reform positive. Foreign investment.'),
    ('Jupiter', 9):  ('HIGH',     'Legal progress. Religious harmony. Education investment. Foreign trade expands. Judiciary strengthened.'),
    ('Jupiter', 10): ('HIGH',     'Strong government. Respected leadership. International prestige grows. Political stability.'),
    ('Jupiter', 11): ('HIGH',     'National income grows. Parliamentary success. Alliances strengthen. Social programs expand.'),
    ('Jupiter', 12): ('MEDIUM',   'Foreign expenditure managed. Prison reform. Hidden matters resolved. Spiritual national awakening.'),
    # RAHU transits
    ('Rahu', 1):  ('HIGH',     'Foreign interference. Unusual national events. Identity disruption. Epidemic risk if other indicators confirm.'),
    ('Rahu', 2):  ('HIGH',     'Currency manipulation. Unusual economic events. Crypto/speculation surge. Foreign control of economy.'),
    ('Rahu', 3):  ('MEDIUM',   'Disinformation surge. Social media disruption. Unusual transport events. Foreign media interference.'),
    ('Rahu', 4):  ('HIGH',     'Land grabbing. Unusual weather. Foreign control of resources. Agricultural disruption.'),
    ('Rahu', 6):  ('CRITICAL', 'EPIDEMIC RISK. Pandemic or unusual disease. Military confusion. Foreign armed interference.'),
    ('Rahu', 7):  ('HIGH',     'Unclear foreign entanglements. Shadow wars. Unusual diplomatic events. Secret foreign agreements.'),
    ('Rahu', 8):  ('HIGH',     'Hidden financial crisis. Secret deaths. Covert operations exposed. Mysterious large-scale events.'),
    ('Rahu', 10): ('HIGH',     'Unusual leadership. Foreign-influenced government. Unconventional ruler rises. Political disruption.'),
    ('Rahu', 12): ('MEDIUM',   'Foreign losses. Hidden enemies active. Espionage. Unusual prison/hospital events.'),
    # KETU transits
    ('Ketu', 1):  ('HIGH',     'National identity confusion. Spiritual crisis. Sudden disconnection from past identity.'),
    ('Ketu', 6):  ('MEDIUM',   'Sudden end to military conflict OR mysterious health event. Abrupt military withdrawal.'),
    ('Ketu', 7):  ('HIGH',     'Sudden diplomatic severance. Mysterious foreign threat. Terrorism. Abrupt end of alliance.'),
    ('Ketu', 8):  ('HIGH',     'Mysterious deaths. Sudden mass events. Covert operations exposed. Sudden economic shock.'),
    ('Ketu', 10): ('HIGH',     'Sudden government collapse. Leader abruptly removed. Mysterious political crisis.'),
    ('Ketu', 12): ('MEDIUM',   'Sudden foreign loss. Hidden enemies neutralised OR revealed. Prison/espionage revelation.'),
    # MARS transits (acute — 45 days)
    ('Mars', 1):  ('MEDIUM',   'National aggression. Public unrest. Violence risk. Accidents surge.'),
    ('Mars', 4):  ('MEDIUM',   'Domestic violence. Land disputes. Flood/fire disaster risk. Agricultural damage.'),
    ('Mars', 6):  ('HIGH',     'Military action. Armed conflict. Aggressive defence posture. Police action.'),
    ('Mars', 7):  ('HIGH',     'WAR TRIGGER. Open conflict with foreign nation. Diplomatic breakdown. Border aggression.'),
    ('Mars', 8):  ('HIGH',     'Mass casualty event. Disaster. Military fatalities. Violent deaths.'),
    ('Mars', 10): ('MEDIUM',   'Government aggression. Military leadership. Forceful policies. Leader acts rashly.'),
    ('Mars', 12): ('MEDIUM',   'Secret military operations. Covert conflict. Hidden aggression.'),
}


class MundaneTransitAnalyzer:
    """
    Analyses current and upcoming transits against a national chart.
    """

    def __init__(self, country_key: str, jyotish_engine_class=None):
        self.country_key = country_key.lower().replace(' ', '_')
        self.chart_data = get_country(self.country_key)
        if not self.chart_data:
            raise ValueError(f"Unknown country: {country_key}")
        self._jyotish_engine_class = jyotish_engine_class
        self._mundane_engine = None
        self._load()

    def _load(self):
        try:
            self._mundane_engine = MundaneEngine(
                self.country_key, self._jyotish_engine_class
            )
        except Exception as e:
            self._error = str(e)

    def _get_natal_asc_rashi(self) -> int:
        if self._mundane_engine and self._mundane_engine.engine:
            return self._mundane_engine.engine.ascendant_rashi
        return 0

    def _transit_house(self, transit_rashi: int) -> int:
        asc = self._get_natal_asc_rashi()
        return ((transit_rashi - asc) % 12) + 1

    # ── CURRENT TRANSIT SNAPSHOT ──────────────────────────────────────────────

    def get_current_snapshot(self) -> Dict:
        """
        Full current transit picture for this nation.
        Returns critical/high significance transits with readings.
        """
        if not self._mundane_engine or not self._mundane_engine.is_ready():
            return {'error': getattr(self, '_error', 'Engine not loaded')}

        engine = self._mundane_engine.engine
        current_transits = engine.ephemeris.get_current_transits()
        asc_rashi = engine.ascendant_rashi

        all_transits = []
        for planet, t_data in current_transits.items():
            t_rashi = t_data.get('rashi', 0)
            t_rashi_name = t_data.get('rashi_name', '')
            house = ((t_rashi - asc_rashi) % 12) + 1
            house_domain = MUNDANE_HOUSES.get(house, {}).get('domain', '')

            sig_info = TRANSIT_SIGNIFICANCE.get(planet, {})
            significance = sig_info.get('significance', 'LOW')

            reading_key = (planet, house)
            if reading_key in TRANSIT_READINGS:
                sev, reading = TRANSIT_READINGS[reading_key]
            else:
                sev = significance
                reading = f"{planet} in H{house} ({house_domain}) — {PLANET_MUNDANE.get(planet, '')}."

            all_transits.append({
                'planet': planet,
                'sign': t_rashi_name,
                'house': house,
                'house_domain': house_domain,
                'significance': sev,
                'reading': reading,
                'retrograde': t_data.get('retrograde', False),
                'duration': sig_info.get('duration_months', 1),
            })

        # Sort by severity
        sev_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3, 'DAILY': 4, 'POSITIVE': 0}
        all_transits.sort(key=lambda x: sev_order.get(x['significance'], 3))

        # Check critical combinations
        combinations = self._check_combinations(current_transits, asc_rashi)

        # Filter to meaningful transits
        critical = [t for t in all_transits if t['significance'] == 'CRITICAL']
        high = [t for t in all_transits if t['significance'] == 'HIGH']
        positive = [t for t in all_transits if t['significance'] == 'POSITIVE']

        # Build overall assessment
        assessment = self._build_assessment(critical, high, positive, combinations)

        return {
            'country': self.chart_data['name'],
            'as_of': datetime.now().strftime('%Y-%m-%d'),
            'overall_assessment': assessment,
            'critical_transits': critical,
            'high_transits': high,
            'combinations': combinations,
            'all_transits': all_transits,
        }

    def _check_combinations(self, current_transits: Dict, asc_rashi: int) -> List[Dict]:
        """Check for critical two-planet combinations in same house."""
        # Map planet → house
        planet_houses = {}
        for planet, t_data in current_transits.items():
            t_rashi = t_data.get('rashi', 0)
            planet_houses[planet] = ((t_rashi - asc_rashi) % 12) + 1

        fired = []
        for combo in CRITICAL_COMBINATIONS:
            p1, p2 = combo['planets']
            h1 = planet_houses.get(p1)
            h2 = planet_houses.get(p2)
            if h1 and h2 and h1 == h2 and h1 in combo['houses']:
                reading = combo['reading'].format(house=h1)
                house_domain = MUNDANE_HOUSES.get(h1, {}).get('domain', '')
                fired.append({
                    'planets': list(combo['planets']),
                    'house': h1,
                    'house_domain': house_domain,
                    'severity': combo['severity'],
                    'reading': reading,
                })

        return fired

    def _build_assessment(self, critical: List, high: List,
                           positive: List, combinations: List) -> str:
        """Build overall qualitative assessment."""
        country = self.chart_data['name']
        now = datetime.now().strftime('%B %Y')

        if not critical and not high and not combinations:
            if positive:
                return f"{country} as of {now}: Favourable planetary period. {positive[0]['reading']}"
            return f"{country} as of {now}: Neutral planetary period. No major transits active."

        parts = [f"{country} as of {now}:"]

        crit_combos = [c for c in combinations if c['severity'] == 'CRITICAL']
        if crit_combos:
            parts.append(f"CRITICAL — {crit_combos[0]['reading']}")

        if critical:
            parts.append(f"Critical transit: {critical[0]['reading']}")
            if len(critical) > 1:
                parts.append(f"Also critical: {critical[1]['reading']}")

        if high and not critical:
            parts.append(f"Significant transit: {high[0]['reading']}")

        if positive:
            parts.append(f"Positive factor: {positive[0]['reading']}")

        return ' '.join(parts)

    # ── SPECIFIC DOMAIN ANALYSIS ──────────────────────────────────────────────

    def get_domain_analysis(self, domain: str) -> Dict:
        """
        Deep analysis of a specific mundane domain.
        domain = 'economy', 'military', 'government', 'foreign', 'health'
        """
        domain_house_map = {
            'economy':    [2, 11],
            'military':   [6, 7, 8],
            'government': [10, 1],
            'foreign':    [7, 9, 12],
            'health':     [1, 6, 8],
            'agriculture':[4, 2],
            'religion':   [9, 5],
            'media':      [3, 1],
            'parliament': [11, 10],
            'war':        [6, 7, 8, 12],
            'diplomacy':  [7, 9, 3],
            'disaster':   [4, 8, 6],
        }

        houses = domain_house_map.get(domain.lower(), [1])

        if not self._mundane_engine or not self._mundane_engine.is_ready():
            return {'error': 'Engine not loaded', 'domain': domain}

        engine = self._mundane_engine.engine
        current_transits = engine.ephemeris.get_current_transits()
        asc_rashi = engine.ascendant_rashi

        relevant = []
        for planet, t_data in current_transits.items():
            t_rashi = t_data.get('rashi', 0)
            house = ((t_rashi - asc_rashi) % 12) + 1
            if house in houses:
                sig_info = TRANSIT_SIGNIFICANCE.get(planet, {})
                reading_key = (planet, house)
                if reading_key in TRANSIT_READINGS:
                    sev, reading = TRANSIT_READINGS[reading_key]
                else:
                    sev = sig_info.get('significance', 'LOW')
                    reading = f"{planet} in H{house} — {PLANET_MUNDANE.get(planet, '')}."
                relevant.append({
                    'planet': planet,
                    'house': house,
                    'significance': sev,
                    'reading': reading,
                })

        # Also check natal planets in these houses
        natal = engine.planets
        natal_in_domain = []
        for planet, data in natal.items():
            if data.get('house') in houses:
                natal_in_domain.append({
                    'planet': planet,
                    'house': data['house'],
                    'rashi': data.get('rashi_name', ''),
                    'meaning': f"Natal {planet} in H{data['house']} — {PLANET_MUNDANE.get(planet, '')} permanently signified in {domain}.",
                })

        relevant.sort(key=lambda x: {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}.get(x['significance'], 3))

        if relevant:
            top = relevant[0]
            verdict = f"{self.chart_data['name']} {domain}: {top['reading']}"
        elif natal_in_domain:
            verdict = f"{self.chart_data['name']} {domain}: No active transits. Natal configuration: {natal_in_domain[0]['meaning']}"
        else:
            verdict = f"{self.chart_data['name']} {domain}: No significant planetary activity in relevant houses currently."

        return {
            'country': self.chart_data['name'],
            'domain': domain,
            'relevant_houses': houses,
            'active_transits': relevant,
            'natal_configuration': natal_in_domain,
            'verdict': verdict,
        }

    # ── WAR/CONFLICT RISK ANALYSIS ────────────────────────────────────────────

    def get_conflict_risk(self) -> Dict:
        """
        Classical war indicators from mundane texts.
        BV Raman: Mars or Saturn in H6/H7/H8 of national chart = conflict risk.
        """
        if not self._mundane_engine or not self._mundane_engine.is_ready():
            return {'error': 'Engine not loaded'}

        engine = self._mundane_engine.engine
        current_transits = engine.ephemeris.get_current_transits()
        asc_rashi = engine.ascendant_rashi
        natal = engine.planets

        war_houses = [6, 7, 8, 12]
        war_planets = ['Mars', 'Saturn', 'Rahu', 'Ketu']

        indicators = []

        # Transit war indicators
        for planet in war_planets:
            t_data = current_transits.get(planet, {})
            t_rashi = t_data.get('rashi', 0)
            house = ((t_rashi - asc_rashi) % 12) + 1
            if house in war_houses:
                reading_key = (planet, house)
                if reading_key in TRANSIT_READINGS:
                    sev, reading = TRANSIT_READINGS[reading_key]
                else:
                    sev = 'MEDIUM'
                    reading = f"Transit {planet} in H{house}"
                indicators.append({
                    'type': 'transit',
                    'planet': planet,
                    'house': house,
                    'severity': sev,
                    'reading': reading,
                })

        # Natal war indicators (structural)
        for planet in war_planets:
            n_house = natal.get(planet, {}).get('house', 0)
            if n_house in [6, 7, 8]:
                indicators.append({
                    'type': 'natal',
                    'planet': planet,
                    'house': n_house,
                    'severity': 'STRUCTURAL',
                    'reading': f"Natal {planet} in H{n_house} — structural aggression/conflict tendency in {MUNDANE_HOUSES[n_house]['domain']}.",
                })

        # Combinations
        combinations = self._check_combinations(current_transits, asc_rashi)
        war_combos = [c for c in combinations if any(h in war_houses for h in [c['house']])]

        # Risk level
        critical_count = sum(1 for i in indicators if i['severity'] == 'CRITICAL')
        high_count = sum(1 for i in indicators if i['severity'] == 'HIGH')

        if critical_count >= 2 or war_combos:
            risk_level = 'CRITICAL'
            risk_reading = f"Multiple critical war indicators active. Classical texts indicate high conflict probability."
        elif critical_count == 1 or high_count >= 2:
            risk_level = 'ELEVATED'
            risk_reading = f"Elevated conflict risk. Key indicators active for {self.chart_data['name']}."
        elif high_count == 1:
            risk_level = 'MODERATE'
            risk_reading = f"Moderate tension. One significant indicator active."
        elif indicators:
            risk_level = 'LOW'
            risk_reading = f"Low conflict risk. Only structural/natal indicators, no active transit triggers."
        else:
            risk_level = 'MINIMAL'
            risk_reading = f"No significant conflict indicators for {self.chart_data['name']} currently."

        return {
            'country': self.chart_data['name'],
            'risk_level': risk_level,
            'risk_reading': risk_reading,
            'indicators': indicators,
            'combinations': war_combos,
            'as_of': datetime.now().strftime('%Y-%m-%d'),
        }

    # ── ECONOMIC OUTLOOK ──────────────────────────────────────────────────────

    def get_economic_outlook(self) -> Dict:
        """
        Economic analysis from mundane transits.
        H2 = economy, H11 = income, H5 = speculation.
        Jupiter/Venus = growth. Saturn/Rahu = contraction.
        """
        if not self._mundane_engine or not self._mundane_engine.is_ready():
            return {'error': 'Engine not loaded'}

        engine = self._mundane_engine.engine
        current_transits = engine.ephemeris.get_current_transits()
        asc_rashi = engine.ascendant_rashi

        econ_houses = [2, 5, 11]
        growth_planets = {'Jupiter', 'Venus', 'Mercury'}
        contraction_planets = {'Saturn', 'Rahu', 'Ketu'}

        growth_indicators = []
        contraction_indicators = []

        for planet, t_data in current_transits.items():
            t_rashi = t_data.get('rashi', 0)
            house = ((t_rashi - asc_rashi) % 12) + 1
            if house in econ_houses:
                reading_key = (planet, house)
                reading = TRANSIT_READINGS.get(reading_key, (None, f"{planet} in H{house}"))[1]
                entry = {'planet': planet, 'house': house, 'reading': reading}
                if planet in growth_planets:
                    growth_indicators.append(entry)
                elif planet in contraction_planets:
                    contraction_indicators.append(entry)

        if len(growth_indicators) > len(contraction_indicators):
            outlook = 'POSITIVE'
            summary = f"{self.chart_data['name']} economy: Growth indicators dominate. {growth_indicators[0]['reading'] if growth_indicators else ''}"
        elif len(contraction_indicators) > len(growth_indicators):
            outlook = 'CHALLENGING'
            summary = f"{self.chart_data['name']} economy: Contraction risk. {contraction_indicators[0]['reading'] if contraction_indicators else ''}"
        elif not growth_indicators and not contraction_indicators:
            outlook = 'NEUTRAL'
            summary = f"{self.chart_data['name']} economy: No strong planetary influence on economic houses currently."
        else:
            outlook = 'MIXED'
            summary = f"{self.chart_data['name']} economy: Mixed signals. Growth and contraction factors balance."

        return {
            'country': self.chart_data['name'],
            'outlook': outlook,
            'summary': summary,
            'growth_indicators': growth_indicators,
            'contraction_indicators': contraction_indicators,
            'as_of': datetime.now().strftime('%Y-%m-%d'),
        }


# ── GLOBAL SCAN ───────────────────────────────────────────────────────────────

def scan_global_hotspots(jyotish_engine_class=None, top_n: int = 10) -> Dict:
    """
    Scan all national charts for critical transits.
    Returns the nations with the most active/critical planetary activity.
    """
    from .national_charts import NATIONAL_CHARTS

    results = []
    for key in NATIONAL_CHARTS:
        try:
            analyzer = MundaneTransitAnalyzer(key, jyotish_engine_class)
            conflict = analyzer.get_conflict_risk()
            economy = analyzer.get_economic_outlook()
            results.append({
                'country': NATIONAL_CHARTS[key]['name'],
                'region': NATIONAL_CHARTS[key].get('region', ''),
                'conflict_risk': conflict.get('risk_level', 'UNKNOWN'),
                'economic_outlook': economy.get('outlook', 'UNKNOWN'),
                'conflict_reading': conflict.get('risk_reading', ''),
                'economic_reading': economy.get('summary', ''),
            })
        except Exception:
            continue

    # Sort by conflict risk
    risk_order = {'CRITICAL': 0, 'ELEVATED': 1, 'MODERATE': 2, 'LOW': 3, 'MINIMAL': 4, 'UNKNOWN': 5}
    results.sort(key=lambda x: risk_order.get(x['conflict_risk'], 5))

    critical = [r for r in results if r['conflict_risk'] == 'CRITICAL']
    elevated = [r for r in results if r['conflict_risk'] == 'ELEVATED']

    return {
        'scan_date': datetime.now().strftime('%Y-%m-%d'),
        'total_nations_scanned': len(results),
        'critical_hotspots': critical,
        'elevated_hotspots': elevated[:5],
        'all_results': results[:top_n],
    }


def analyze_two_nations(country1: str, country2: str,
                        jyotish_engine_class=None) -> Dict:
    """
    Compare conflict/cooperation potential between two nations.
    """
    try:
        a1 = MundaneTransitAnalyzer(country1, jyotish_engine_class)
        a2 = MundaneTransitAnalyzer(country2, jyotish_engine_class)

        c1 = a1.get_conflict_risk()
        c2 = a2.get_conflict_risk()
        e1 = a1.get_economic_outlook()
        e2 = a2.get_economic_outlook()

        n1 = NATIONAL_CHARTS.get(country1, {}).get('name', country1)
        n2 = NATIONAL_CHARTS.get(country2, {}).get('name', country2)

        both_aggressive = (
            c1.get('risk_level') in ('CRITICAL', 'ELEVATED') and
            c2.get('risk_level') in ('CRITICAL', 'ELEVATED')
        )

        if both_aggressive:
            bilateral = f"DANGER: Both {n1} and {n2} show elevated conflict indicators simultaneously. Classical texts identify this as a high-risk bilateral period."
        elif c1.get('risk_level') in ('CRITICAL', 'ELEVATED'):
            bilateral = f"CAUTION: {n1} shows aggressive planetary indicators. {n2} is relatively stable. {n1} may initiate tension."
        elif c2.get('risk_level') in ('CRITICAL', 'ELEVATED'):
            bilateral = f"CAUTION: {n2} shows aggressive planetary indicators. {n1} is relatively stable. {n2} may initiate tension."
        else:
            bilateral = f"STABLE: Neither {n1} nor {n2} shows critical conflict indicators. Diplomatic engagement favoured."

        return {
            'country1': n1,
            'country2': n2,
            'bilateral_assessment': bilateral,
            'country1_conflict': c1.get('risk_level', ''),
            'country2_conflict': c2.get('risk_level', ''),
            'country1_economy': e1.get('outlook', ''),
            'country2_economy': e2.get('outlook', ''),
            'country1_reading': c1.get('risk_reading', ''),
            'country2_reading': c2.get('risk_reading', ''),
            'as_of': datetime.now().strftime('%Y-%m-%d'),
        }
    except Exception as e:
        return {'error': str(e)}
