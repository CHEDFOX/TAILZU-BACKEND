"""
MUNDANE ASTROLOGY — PERSONAL-MUNDANE INTERSECTION
The most powerful feature: how world events affect THIS specific user.

Classical principle (Ptolemy, Tetrabiblos Book II):
"The circumstances of individual lives are subsumed within the fate
of their community. Assess the general before the particular."

This module finds where the current planetary weather (national/global
transits) intersects with the user's natal chart personally.
"""

from datetime import datetime
from typing import Dict, List
from .national_charts import get_country, detect_country_from_text
from .mundane_engine import MUNDANE_HOUSES, PLANET_MUNDANE
from .mundane_transit import TRANSIT_READINGS, TRANSIT_SIGNIFICANCE


# ── PERSONAL IMPACT RULES ─────────────────────────────────────────────────────
# When a transit planet hits the same house in BOTH national AND natal chart,
# the national event affects this person directly in that life domain.

PERSONAL_IMPACT_RULES = {
    # National H2 (economy) hitting user's H2 (personal wealth)
    (2, 2): "National economic conditions directly affect your personal finances. What happens to the country's money hits your money.",
    (2, 11): "National economy affects your income and gains directly.",
    (6, 6): "National health/military events affect your health or work situation personally.",
    (6, 1): "National crisis period affects your personal health and vitality.",
    (7, 7): "National foreign affairs events affect your personal relationships and partnerships.",
    (10, 10): "National political changes affect your career and professional status directly.",
    (10, 1): "Government changes affect your personal identity and life direction.",
    (4, 4): "National land/weather events affect your home and property.",
    (4, 1): "What happens to the nation's land affects your personal foundations.",
    (8, 8): "National debt/disaster events resonate with your chart's transformation house.",
    (9, 9): "National religious/judicial events affect your beliefs, travel, and fortune.",
    (1, 1): "The nation's overall condition is mirrored in your personal circumstances.",
    (11, 11): "National income trends align with your personal gains period.",
    (3, 3): "National media/transport events affect your communication and siblings.",
    (12, 12): "National hidden losses affect your own 12th house themes.",
}

# ── NATAL HOUSE PERSONAL DOMAINS ─────────────────────────────────────────────
NATAL_HOUSE_DOMAINS = {
    1:  'Your body, health, personality, overall life direction',
    2:  'Your personal wealth, savings, family, speech',
    3:  'Your siblings, communication, courage, short travel',
    4:  'Your home, mother, property, emotional foundation',
    5:  'Your children, creativity, romance, intelligence',
    6:  'Your health challenges, enemies, debts, service',
    7:  'Your marriage, business partnerships, relationships',
    8:  'Your transformation, hidden matters, inheritance, longevity',
    9:  'Your fortune, father, guru, long travel, beliefs',
    10: 'Your career, status, authority, public reputation',
    11: 'Your income, gains, friends, social network',
    12: 'Your losses, foreign connections, spirituality, expenses',
}


class PersonalMundaneAnalyzer:
    """
    Finds the intersection between world/national events and
    a specific user's natal chart.
    """

    def __init__(self, natal_engine, country_key: str = 'india',
                 jyotish_engine_class=None):
        """
        natal_engine: the user's JyotishEngine instance
        country_key: which national chart to intersect with
        """
        self.natal = natal_engine
        self.country_key = country_key.lower().replace(' ', '_')
        self.chart_data = get_country(self.country_key)
        self._jec = jyotish_engine_class
        self._national_engine = None
        self._load_national()

    def _load_national(self):
        try:
            from .mundane_engine import MundaneEngine
            self._national_engine = MundaneEngine(self.country_key, self._jec)
        except Exception as e:
            self._error = str(e)

    def _natal_house(self, planet: str) -> int:
        return self.natal.planets.get(planet, {}).get('house', 1)

    def _national_house(self, planet: str) -> int:
        if self._national_engine and self._national_engine.engine:
            return self._national_engine.engine.planets.get(planet, {}).get('house', 1)
        return 1

    def _transit_house_natal(self, transit_rashi: int) -> int:
        return ((transit_rashi - self.natal.ascendant_rashi) % 12) + 1

    def _transit_house_national(self, transit_rashi: int) -> int:
        if self._national_engine and self._national_engine.engine:
            asc = self._national_engine.engine.ascendant_rashi
            return ((transit_rashi - asc) % 12) + 1
        return 1

    # ── MAIN INTERSECTION ANALYSIS ────────────────────────────────────────────

    def get_personal_world_impact(self) -> Dict:
        """
        How does the current planetary weather affect THIS person specifically?
        Finds where national transits and natal chart converge.
        """
        if not self._national_engine or not self._national_engine.is_ready():
            return {'error': getattr(self, '_error', 'National engine not loaded')}

        current_transits = self.natal.ephemeris.get_current_transits()
        intersections = []

        for planet, t_data in current_transits.items():
            t_rashi = t_data.get('rashi', 0)

            # Which house in national chart?
            nat_house = self._transit_house_national(t_rashi)
            # Which house in user's natal chart?
            personal_house = self._transit_house_natal(t_rashi)

            nat_domain = MUNDANE_HOUSES.get(nat_house, {}).get('domain', '')
            personal_domain = NATAL_HOUSE_DOMAINS.get(personal_house, '')

            sig = TRANSIT_SIGNIFICANCE.get(planet, {}).get('significance', 'LOW')
            if sig in ('LOW', 'DAILY'):
                continue  # skip fast planets for personal reading

            # Get national transit reading
            nat_key = (planet, nat_house)
            if nat_key in TRANSIT_READINGS:
                nat_sev, nat_reading = TRANSIT_READINGS[nat_key]
            else:
                nat_sev = sig
                nat_reading = f"{planet} activating {nat_domain} nationally."

            # Personal impact
            personal_reading = self._personal_reading(
                planet, nat_house, personal_house, nat_domain, personal_domain
            )

            # Double hit: same house in both charts = strongest personal impact
            double_hit = (nat_house == personal_house)
            crossover = PERSONAL_IMPACT_RULES.get((nat_house, personal_house), '')

            intersections.append({
                'planet': planet,
                'sign': t_data.get('rashi_name', ''),
                'national_house': nat_house,
                'national_domain': nat_domain,
                'personal_house': personal_house,
                'personal_domain': personal_domain,
                'national_reading': nat_reading,
                'personal_reading': personal_reading,
                'double_hit': double_hit,
                'crossover_rule': crossover,
                'significance': nat_sev,
                'retrograde': t_data.get('retrograde', False),
            })

        # Sort: double hits first, then by significance
        sev_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
        intersections.sort(key=lambda x: (
            0 if x['double_hit'] else 1,
            sev_order.get(x['significance'], 3)
        ))

        # Build personal summary
        summary = self._build_personal_summary(intersections)
        double_hits = [i for i in intersections if i['double_hit']]

        return {
            'country': self.chart_data.get('name', ''),
            'as_of': datetime.now().strftime('%Y-%m-%d'),
            'summary': summary,
            'double_hits': double_hits,
            'all_intersections': intersections,
            'total_intersections': len(intersections),
        }

    def _personal_reading(self, planet: str, nat_house: int, personal_house: int,
                           nat_domain: str, personal_domain: str) -> str:
        """Build a personal reading connecting world event to natal chart."""
        planet_sig = PLANET_MUNDANE.get(planet, planet)

        if nat_house == personal_house:
            return (
                f"{planet} falls in the same house ({nat_house}) in both the national chart "
                f"and your birth chart. The national {nat_domain} situation hits your personal "
                f"{personal_domain} directly. What happens to the country happens to you in this area."
            )

        # Specific personal connections
        connections = {
            (2, 1): f"National economic pressure ({nat_domain}) affects your personal health and vitality ({personal_domain}).",
            (2, 2): f"National economy directly impacts your personal wealth and savings.",
            (2, 11): f"National financial conditions affect your personal income and gains.",
            (6, 6): f"National health/military situation resonates with your own health house.",
            (6, 1): f"National crisis period ({nat_domain}) creates personal health pressure.",
            (10, 10): f"Political changes at the national level affect your career directly.",
            (10, 1): f"Government shifts affect your personal circumstances and identity.",
            (7, 7): f"National foreign affairs tensions mirror pressures in your personal relationships.",
            (4, 4): f"National land/weather events affect your personal home and property.",
            (8, 8): f"National debt/disaster period activates your own 8th house themes.",
            (1, 1): f"The nation's overall condition reflects in your personal life circumstances.",
        }

        key = (nat_house, personal_house)
        if key in connections:
            return connections[key]

        return (
            f"National {nat_domain} ({planet} in H{nat_house}) connects to your personal "
            f"{personal_domain} (H{personal_house}). {planet_sig} themes activate both domains."
        )

    def _build_personal_summary(self, intersections: List[Dict]) -> str:
        """Build the key personal summary for the Oracle."""
        if not intersections:
            return f"No major planetary intersections between your chart and {self.chart_data.get('name', 'national')} events currently."

        country = self.chart_data.get('name', 'national')
        double_hits = [i for i in intersections if i['double_hit']]
        critical = [i for i in intersections if i['significance'] == 'CRITICAL']

        parts = []

        if double_hits:
            dh = double_hits[0]
            parts.append(
                f"The strongest connection: {dh['planet']} falls in H{dh['national_house']} "
                f"in both {country}'s chart and yours — {dh['national_domain']} nationally "
                f"directly affects your {dh['personal_domain']}."
            )

        if critical:
            cr = critical[0]
            parts.append(
                f"Critical national transit: {cr['national_reading']} "
                f"For you personally: {cr['personal_reading']}"
            )
        elif intersections:
            top = intersections[0]
            parts.append(
                f"Key intersection: {top['national_reading']} "
                f"Personal impact: {top['personal_reading']}"
            )

        return ' '.join(parts)

    # ── RELOCATION ANALYSIS ───────────────────────────────────────────────────

    def get_relocation_analysis(self, target_country_key: str) -> Dict:
        """
        How does moving to a different country affect this person?
        Finds which houses the user's natal planets become angular in
        the target country's chart — and what that means.
        """
        target_chart = get_country(target_country_key.lower().replace(' ', '_'))
        if not target_chart:
            return {'error': f'Unknown country: {target_country_key}'}

        try:
            from .mundane_engine import MundaneEngine
            target_engine = MundaneEngine(target_country_key, self._jec)
        except Exception as e:
            return {'error': str(e)}

        if not target_engine.is_ready():
            return {'error': 'Could not load target country engine'}

        target_asc = target_engine.engine.ascendant_rashi
        natal_planets = self.natal.planets

        planet_placements = []
        for planet, data in natal_planets.items():
            natal_rashi = data.get('rashi', 0)
            # Which house does this planet fall in, in the target country's chart?
            house_in_target = ((natal_rashi - target_asc) % 12) + 1
            domain = MUNDANE_HOUSES.get(house_in_target, {}).get('domain', '')
            planet_sig = PLANET_MUNDANE.get(planet, '')
            angular = house_in_target in (1, 4, 7, 10)

            reading = self._relocation_planet_reading(
                planet, house_in_target, domain, angular
            )

            planet_placements.append({
                'planet': planet,
                'house_in_country': house_in_target,
                'country_domain': domain,
                'angular': angular,
                'planet_signification': planet_sig,
                'reading': reading,
                'strength': 'ANGULAR' if angular else 'NORMAL',
            })

        # Key: which planets are angular? Those dominate the relocation experience
        angular_planets = [p for p in planet_placements if p['angular']]
        benefics_angular = [p for p in angular_planets if p['planet'] in ('Jupiter', 'Venus', 'Mercury', 'Moon')]
        malefics_angular = [p for p in angular_planets if p['planet'] in ('Saturn', 'Mars', 'Rahu', 'Ketu')]

        # Overall verdict
        if len(benefics_angular) > len(malefics_angular):
            verdict = 'FAVOURABLE'
            summary = (f"{target_chart['name']} is a positive relocation for you. "
                       f"Benefic planets angular: {', '.join(p['planet'] for p in benefics_angular)}. "
                       f"These planets' domains flourish when you live there.")
        elif len(malefics_angular) > len(benefics_angular):
            verdict = 'CHALLENGING'
            summary = (f"{target_chart['name']} may be challenging for you. "
                       f"Malefic planets angular: {', '.join(p['planet'] for p in malefics_angular)}. "
                       f"Success possible with effort but obstacles are built in.")
        elif not angular_planets:
            verdict = 'NEUTRAL'
            summary = (f"No natal planets angular in {target_chart['name']} chart. "
                       f"This country has a neutral effect — neither strongly beneficial nor harmful.")
        else:
            verdict = 'MIXED'
            summary = (f"{target_chart['name']} is mixed for you. "
                       f"Both benefics ({', '.join(p['planet'] for p in benefics_angular)}) "
                       f"and malefics ({', '.join(p['planet'] for p in malefics_angular)}) are angular.")

        return {
            'target_country': target_chart['name'],
            'verdict': verdict,
            'summary': summary,
            'angular_planets': angular_planets,
            'benefics_angular': benefics_angular,
            'malefics_angular': malefics_angular,
            'all_placements': planet_placements,
            'target_ascendant': target_engine.engine.ascendant.get('rashi_name', ''),
            'note': 'Angular planets (H1,4,7,10) in the target country chart dominate the relocation experience.',
        }

    def _relocation_planet_reading(self, planet: str, house: int,
                                    domain: str, angular: bool) -> str:
        readings = {
            ('Jupiter', True):  f"Jupiter angular — fortune, wealth, and expansion are strongly activated in this country. Excellent for career and prosperity.",
            ('Venus', True):    f"Venus angular — pleasure, beauty, relationships, and comfort. Great quality of life.",
            ('Mercury', True):  f"Mercury angular — trade, business, communication. Excellent for entrepreneurs and traders.",
            ('Moon', True):     f"Moon angular — emotional connection to this land. Feels like home. Public recognition.",
            ('Sun', True):      f"Sun angular — authority and leadership activated. You can rise here but also face challenges from authorities.",
            ('Mars', True):     f"Mars angular — energy and drive but also conflict and aggression. Success through effort but disputes likely.",
            ('Saturn', True):   f"Saturn angular — hard work, obstacles, discipline. Success possible but life is demanding here.",
            ('Rahu', True):     f"Rahu angular — unconventional success, foreign connections, but also instability and confusion.",
            ('Ketu', True):     f"Ketu angular — spiritual connection but material losses. Good for retreat, not for worldly ambition.",
        }
        key = (planet, angular)
        if key in readings:
            return readings[key]
        planet_sig = PLANET_MUNDANE.get(planet, '')
        return f"{planet} in H{house} ({domain}) — {planet_sig} themes activated in this country."

    # ── ECLIPSE PERSONAL IMPACT ───────────────────────────────────────────────

    def get_eclipse_personal_impact(self, eclipse_lon: float,
                                     eclipse_date: str,
                                     eclipse_type: str = 'solar') -> Dict:
        """
        How does an eclipse affect this person personally?
        Checks if eclipse falls on natal sensitive points.
        """
        natal_planets = self.natal.planets
        asc_lon = self.natal.ascendant.get('longitude', 0)
        orb = 5.0

        personal_impacts = []
        sensitive = {'Ascendant': asc_lon}
        for p in ['Sun', 'Moon', 'Mars', 'Saturn', 'Jupiter', 'Rahu', 'Ketu']:
            sensitive[p] = natal_planets.get(p, {}).get('longitude', -999)

        for point, lon in sensitive.items():
            if lon < 0:
                continue
            diff = abs(eclipse_lon - lon) % 360
            if diff > 180:
                diff = 360 - diff
            if diff <= orb:
                house = 1 if point == 'Ascendant' else natal_planets.get(point, {}).get('house', 1)
                domain = NATAL_HOUSE_DOMAINS.get(house, '')
                severity = 'EXACT' if diff <= 1 else 'CLOSE' if diff <= 3 else 'WIDE'
                personal_impacts.append({
                    'point': point,
                    'house': house,
                    'domain': domain,
                    'orb': round(diff, 2),
                    'severity': severity,
                    'reading': self._eclipse_personal_reading(
                        eclipse_type, point, house, domain
                    ),
                })

        # National eclipse impact
        national_impact = {}
        if self._national_engine and self._national_engine.is_ready():
            national_impact = self._national_engine.check_eclipse_impact(
                eclipse_date, eclipse_lon, eclipse_type
            )

        duration = 18 if eclipse_type == 'solar' else 6
        has_personal = len(personal_impacts) > 0
        has_national = national_impact.get('has_impact', False)

        if has_personal and has_national:
            summary = (
                f"DOUBLE IMPACT: Eclipse affects both your natal chart and "
                f"{self.chart_data.get('name', 'national')} chart. "
                f"Personal: {personal_impacts[0]['reading']} "
                f"National: {national_impact.get('summary', '')}"
            )
        elif has_personal:
            summary = (
                f"PERSONAL ECLIPSE: This eclipse hits your natal {personal_impacts[0]['point']} "
                f"in H{personal_impacts[0]['house']} ({personal_impacts[0]['domain']}). "
                f"{personal_impacts[0]['reading']} Effects last up to {duration} months."
            )
        elif has_national:
            summary = (
                f"NATIONAL ECLIPSE: No direct hit on your chart but "
                f"{self.chart_data.get('name', '')} is affected. "
                f"{national_impact.get('summary', '')} "
                f"Indirect personal impact possible through national events."
            )
        else:
            summary = f"This eclipse does not significantly impact your chart or {self.chart_data.get('name', 'national')} chart."

        return {
            'eclipse_date': eclipse_date,
            'eclipse_type': eclipse_type,
            'personal_impacts': personal_impacts,
            'national_impact': national_impact,
            'has_personal_impact': has_personal,
            'has_national_impact': has_national,
            'summary': summary,
            'effect_duration_months': duration,
        }

    def _eclipse_personal_reading(self, etype: str, point: str,
                                   house: int, domain: str) -> str:
        templates = {
            ('solar', 'Sun'):       "Major life event. Authority, father, career — one of these changes significantly.",
            ('solar', 'Moon'):      "Emotional turning point. Mother, home, public life — major shift.",
            ('solar', 'Ascendant'): "Identity eclipse. Your life direction shifts. Major personal transformation.",
            ('solar', 'Mars'):      "Energy and drive disrupted or catalysed. Health or conflict event.",
            ('solar', 'Jupiter'):   "Fortune shift. Wealth, wisdom, or opportunity — major change.",
            ('solar', 'Saturn'):    "Structural life change. Career, discipline, responsibilities — major shift.",
            ('solar', 'Rahu'):      "Sudden foreign or unconventional life event. Obsession activated.",
            ('solar', 'Ketu'):      "Spiritual turning point. Loss or liberation in Ketu's house domain.",
            ('lunar', 'Moon'):      "Intense emotional event. Relationships and public life highlighted.",
            ('lunar', 'Sun'):       "Career or authority-related emotional climax.",
            ('lunar', 'Ascendant'): "Personal emotional turning point. How you feel about your life direction.",
        }
        key = (etype, point)
        if key in templates:
            return templates[key]
        return (f"{etype.title()} eclipse on natal {point} in H{house} ({domain}) — "
                f"major events in this life domain within {18 if etype == 'solar' else 6} months.")

    # ── DASHA-MUNDANE ALIGNMENT ───────────────────────────────────────────────

    def get_dasha_mundane_alignment(self) -> Dict:
        """
        How does the user's current dasha align with national trends?
        When personal dasha and national dasha share the same planet
        or the same themes — the effects are amplified.
        """
        if not self._national_engine or not self._national_engine.is_ready():
            return {'error': 'National engine not loaded'}

        try:
            personal_dasha = self.natal.get_vimshottari_dasha()
            national_dasha = self._national_engine.engine.get_vimshottari_dasha()

            p_maha = personal_dasha.get('mahadasha', {}).get('lord', '')
            p_antar = personal_dasha.get('antardasha', {}).get('lord', '')
            n_maha = national_dasha.get('mahadasha', {}).get('lord', '')
            n_antar = national_dasha.get('antardasha', {}).get('lord', '')

            country = self.chart_data.get('name', '')

            alignments = []

            # Same mahadasha lord = strongest alignment
            if p_maha == n_maha:
                alignments.append({
                    'type': 'MAHADASHA_MATCH',
                    'planet': p_maha,
                    'reading': (
                        f"You and {country} are both in {p_maha} mahadasha. "
                        f"This is a rare and powerful alignment. "
                        f"The national {p_maha} themes permeate your personal life deeply. "
                        f"{PLANET_MUNDANE.get(p_maha, '')} defines both your personal chapter and the nation's."
                    ),
                })

            # Same antardasha = secondary alignment
            if p_antar == n_antar and p_maha != n_maha:
                alignments.append({
                    'type': 'ANTARDASHA_MATCH',
                    'planet': p_antar,
                    'reading': (
                        f"You and {country} share {p_antar} antardasha. "
                        f"{PLANET_MUNDANE.get(p_antar, '')} themes are activated for you personally "
                        f"at the same time they activate nationally."
                    ),
                })

            # Mahadasha/antardasha cross-match
            if p_maha == n_antar:
                alignments.append({
                    'type': 'CROSS_MATCH',
                    'planet': p_maha,
                    'reading': (
                        f"Your mahadasha lord {p_maha} matches {country}'s current antardasha. "
                        f"National {PLANET_MUNDANE.get(p_maha, '')} sub-themes affect your major life chapter."
                    ),
                })

            if not alignments:
                alignment_reading = (
                    f"Your personal dasha ({p_maha}/{p_antar}) and {country}'s dasha "
                    f"({n_maha}/{n_antar}) are running independently. "
                    f"National events affect you through transits more than dasha alignment."
                )
            else:
                alignment_reading = alignments[0]['reading']

            return {
                'country': country,
                'personal_dasha': f"{p_maha}/{p_antar}",
                'national_dasha': f"{n_maha}/{n_antar}",
                'alignments': alignments,
                'has_alignment': len(alignments) > 0,
                'alignment_reading': alignment_reading,
            }
        except Exception as e:
            return {'error': str(e)}

    # ── FULL PERSONAL MUNDANE REPORT ──────────────────────────────────────────

    def get_full_report(self) -> Dict:
        """Complete personal-mundane intersection report."""
        return {
            'country': self.chart_data.get('name', ''),
            'personal_world_impact': self.get_personal_world_impact(),
            'dasha_alignment': self.get_dasha_mundane_alignment(),
            'as_of': datetime.now().strftime('%Y-%m-%d'),
        }


# ── CONVENIENCE FUNCTIONS ─────────────────────────────────────────────────────

def analyze_personal_mundane(natal_engine, question: str,
                              jyotish_engine_class=None) -> Dict:
    """
    Detect country from question and run personal mundane analysis.
    Entry point from the Oracle pipeline.
    """
    country_key = detect_country_from_text(question)
    if not country_key:
        country_key = 'india'  # default for Indian user base

    try:
        analyzer = PersonalMundaneAnalyzer(natal_engine, country_key, jyotish_engine_class)
        return analyzer.get_full_report()
    except Exception as e:
        return {'error': str(e), 'country': country_key}


def get_relocation_advice(natal_engine, target_country: str,
                           jyotish_engine_class=None) -> Dict:
    """Should I move to X? Entry point from Oracle pipeline."""
    country_key = detect_country_from_text(target_country)
    if not country_key:
        country_key = target_country.lower().replace(' ', '_')

    try:
        analyzer = PersonalMundaneAnalyzer(natal_engine, 'india', jyotish_engine_class)
        return analyzer.get_relocation_analysis(country_key)
    except Exception as e:
        return {'error': str(e)}
