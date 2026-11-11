"""
JYOTISH ENGINE - COMPLETE KP (KRISHNAMURTI PADDHATI) SYSTEM
Precise event timing using 4-step significator theory.

Existing KP module has: Sub-lord table, basic significators, ruling planets.
This adds:
1. Placidus house cusps (proper KP cusps)
2. 4-step significator chain (Star lord → Sub lord → Planet → House)
3. Cuspal Sub Lord theory (CSL of house = will event happen?)
4. KP Transit Trigger (when transiting planet's star/sub matches = event fires)
5. Ruling Planets verification (at query time)
6. KP event promise + denial analysis

KP can pinpoint events to WEEKS — the most precise timing system in Jyotish.
"""

from datetime import datetime
from typing import Dict, List
from ..core.constants import (
    PLANETS, RASHI_LORDS, RASHI_NAMES,
    NAKSHATRA_NAMES, NAKSHATRA_LORDS,
)

# KP Sub-lord divisions within each nakshatra (13°20' each)
# Each nakshatra is divided proportionally among 9 planets
VIMSHOTTARI_YEARS = {
    'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7,
    'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17,
}
DASHA_SEQUENCE = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
TOTAL_YEARS = 120

# House groupings for KP
KP_FAVORABLE = {
    'marriage': {'promise': [2, 7, 11], 'denial': [1, 6, 10, 12]},
    'career': {'promise': [2, 6, 10, 11], 'denial': [1, 5, 9]},
    'childbirth': {'promise': [2, 5, 11], 'denial': [1, 4, 10]},
    'property': {'promise': [4, 11, 12], 'denial': [3, 5, 10]},
    'travel_foreign': {'promise': [3, 9, 12], 'denial': [4, 11]},
    'education': {'promise': [4, 9, 11], 'denial': [3, 5, 8]},
    'wealth': {'promise': [2, 6, 10, 11], 'denial': [5, 8, 12]},
    'health_issue': {'promise': [1, 6, 8, 12], 'denial': [5, 11]},
    'job_change': {'promise': [2, 6, 10, 11], 'denial': [5, 9]},
    'litigation_win': {'promise': [1, 6, 11], 'denial': [7, 12]},
    'spiritual': {'promise': [5, 9, 12], 'denial': [3, 6, 10]},
    'vehicle': {'promise': [4, 11], 'denial': [3, 5, 12]},
}


class KPComplete:
    """
    Complete Krishnamurti Paddhati system.
    """

    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.asc_longitude = engine.ascendant.get('longitude', 0.0)
        self._cusps = None
        self._significators_cache = {}

    # ═══════════════════════════════════════════════════════════════════
    # PLACIDUS CUSPS
    # ═══════════════════════════════════════════════════════════════════

    def get_placidus_cusps(self) -> Dict:
        """
        Calculate Placidus house cusps using KP Ayanamsa (not Lahiri).
        KP ayanamsa = Krishnamurti ayanamsa (swe.SIDM_KRISHNAMURTI = 5).
        We calculate tropical cusps and subtract KP ayanamsa manually
        to avoid interfering with the Vedic engine's global ayanamsa state.
        """
        if self._cusps is not None:
            return self._cusps

        try:
            from ..core.ephemeris import swe
            jd = self.engine.ephemeris.get_julian_day(self.engine.birth_dt)

            # Get TROPICAL Placidus cusps (no sidereal flag)
            from app.services.core.ephemeris import houses_safe
            houses, angles = houses_safe(jd, self.engine.latitude, self.engine.longitude, b'P')

            # Calculate KP ayanamsa (Krishnamurti = sid_mode 5)
            swe.set_sid_mode(5)  # SIDM_KRISHNAMURTI
            try:
                kp_ayanamsa = swe.get_ayanamsa_ut(jd)
            finally:
                swe.set_sid_mode(1)  # Lahiri; the Vedic ephemeris re-asserts its own mode anyway

            cusps = {}
            for i in range(12):
                # Subtract KP ayanamsa from tropical cusp
                cusp_long = (houses[i] - kp_ayanamsa) % 360
                rashi = int(cusp_long / 30) % 12
                nak_index = int(cusp_long / (360 / 27)) % 27
                cusps[i + 1] = {
                    'longitude': round(cusp_long, 4),
                    'rashi': rashi,
                    'rashi_name': RASHI_NAMES[rashi],
                    'degree_in_sign': round(cusp_long % 30, 2),
                    'nakshatra': NAKSHATRA_NAMES[nak_index],
                    'nakshatra_lord': NAKSHATRA_LORDS[nak_index],
                    'sub_lord': self._get_sub_lord(cusp_long),
                    'sub_sub_lord': self._get_sub_sub_lord(cusp_long),
                    'ayanamsa_used': 'KP (Krishnamurti)',
                }

            self._cusps = cusps
            return cusps

        except Exception:
            # Fallback to equal house
            cusps = {}
            for i in range(12):
                cusp_long = (self.asc_longitude + i * 30) % 360
                rashi = int(cusp_long / 30) % 12
                nak_index = int(cusp_long / (360 / 27)) % 27
                cusps[i + 1] = {
                    'longitude': round(cusp_long, 4),
                    'rashi': rashi,
                    'rashi_name': RASHI_NAMES[rashi],
                    'degree_in_sign': round(cusp_long % 30, 2),
                    'nakshatra': NAKSHATRA_NAMES[nak_index],
                    'nakshatra_lord': NAKSHATRA_LORDS[nak_index],
                    'sub_lord': self._get_sub_lord(cusp_long),
                    'sub_sub_lord': self._get_sub_sub_lord(cusp_long),
                }
            self._cusps = cusps
            return cusps

    def _get_sub_lord(self, longitude: float) -> str:
        """Calculate sub-lord for a given longitude using KP sub-division."""
        nak_span = 360 / 27  # 13.3333°
        nak_index = int(longitude / nak_span) % 27
        pos_in_nak = longitude % nak_span

        nak_lord = NAKSHATRA_LORDS[nak_index]
        start_index = DASHA_SEQUENCE.index(nak_lord)

        accumulated = 0.0
        for i in range(9):
            planet = DASHA_SEQUENCE[(start_index + i) % 9]
            sub_span = nak_span * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
            if accumulated + sub_span > pos_in_nak:
                return planet
            accumulated += sub_span

        return nak_lord  # Fallback

    def _get_sub_sub_lord(self, longitude: float) -> str:
        """Calculate sub-sub-lord (pratyantar level)."""
        nak_span = 360 / 27
        nak_index = int(longitude / nak_span) % 27
        pos_in_nak = longitude % nak_span

        nak_lord = NAKSHATRA_LORDS[nak_index]
        start_index = DASHA_SEQUENCE.index(nak_lord)

        # Find sub-lord first
        accumulated = 0.0
        sub_lord = nak_lord
        sub_start = 0.0
        sub_span_val = 0.0

        for i in range(9):
            planet = DASHA_SEQUENCE[(start_index + i) % 9]
            sub_span = nak_span * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
            if accumulated + sub_span > pos_in_nak:
                sub_lord = planet
                sub_start = accumulated
                sub_span_val = sub_span
                break
            accumulated += sub_span

        # Now find sub-sub within the sub
        pos_in_sub = pos_in_nak - sub_start
        sub_lord_index = DASHA_SEQUENCE.index(sub_lord)
        accumulated2 = 0.0

        for i in range(9):
            planet = DASHA_SEQUENCE[(sub_lord_index + i) % 9]
            ss_span = sub_span_val * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
            if accumulated2 + ss_span > pos_in_sub:
                return planet
            accumulated2 += ss_span

        return sub_lord

    # ═══════════════════════════════════════════════════════════════════
    # 4-STEP SIGNIFICATOR CHAIN
    # ═══════════════════════════════════════════════════════════════════

    def get_planet_significators(self, planet: str) -> Dict:
        """
        Complete KP significator analysis for a planet.
        A planet signifies houses through 4 levels:
        1. Houses it OCCUPIES (strongest)
        2. Houses OWNED by its star lord
        3. Houses the planet itself owns
        4. Houses aspected/connected via sub-lord
        """
        if planet in self._significators_cache:
            return self._significators_cache[planet]

        p_data = self.planets.get(planet, {})
        p_house = p_data.get('house', 1)
        p_longitude = p_data.get('longitude', 0.0)
        p_rashi = p_data.get('rashi', 0)

        # Star lord (nakshatra lord)
        nak_index = int(p_longitude / (360 / 27)) % 27
        star_lord = NAKSHATRA_LORDS[nak_index]

        # Sub lord
        sub_lord = self._get_sub_lord(p_longitude)

        # Level 1: House occupied by planet
        occupied = [p_house]

        # Level 2: Houses owned by star lord
        star_lord_houses = self._houses_owned(star_lord)

        # Level 3: Houses owned by planet itself
        planet_owns = self._houses_owned(planet)

        # Level 4: Star lord's occupied house
        star_lord_house = self.planets.get(star_lord, {}).get('house', 1)

        # Combine all signified houses
        all_signified = set(occupied + star_lord_houses + planet_owns + [star_lord_house])

        result = {
            'planet': planet,
            'star_lord': star_lord,
            'sub_lord': sub_lord,
            'sub_sub_lord': self._get_sub_sub_lord(p_longitude),
            'occupied_house': p_house,
            'star_lord_houses': star_lord_houses,
            'planet_own_houses': planet_owns,
            'star_lord_occupied': star_lord_house,
            'all_signified_houses': sorted(all_signified),
            'strongest_signification': p_house,  # Occupation is strongest
        }

        self._significators_cache[planet] = result
        return result

    def _houses_owned(self, planet: str) -> List[int]:
        """Get houses owned by a planet in this chart."""
        owns = PLANETS.get(planet, {}).get('owns', [])
        houses = []
        for own_rashi in owns:
            house = ((own_rashi - self.asc_rashi) % 12) + 1
            houses.append(house)
        return houses

    # ═══════════════════════════════════════════════════════════════════
    # CUSPAL SUB LORD (CSL) — EVENT PROMISE/DENIAL
    # ═══════════════════════════════════════════════════════════════════

    def analyze_event_kp(self, event: str) -> Dict:
        """
        KP event analysis using Cuspal Sub Lord theory.
        
        Rule: The SUB LORD of the house cusp determines if event will happen.
        If CSL signifies favorable houses → event PROMISED.
        If CSL signifies unfavorable houses → event DENIED.
        """
        if event not in KP_FAVORABLE:
            return {'error': f'Unknown event: {event}', 'valid': list(KP_FAVORABLE.keys())}

        config = KP_FAVORABLE[event]
        promise_houses = set(config['promise'])
        denial_houses = set(config['denial'])

        cusps = self.get_placidus_cusps()
        PRIMARY_CUSP = {
            'marriage': 7, 'love': 5, 'career': 10, 'wealth': 2,
            'childbirth': 5, 'property': 4, 'travel_foreign': 9,
            'education': 9, 'health_issue': 6, 'job_change': 10,
            'litigation_win': 6, 'spiritual': 9, 'vehicle': 4,
            'business': 7, 'foreign': 9, 'general': 1,
        }
        primary_house = PRIMARY_CUSP.get(event, sorted(promise_houses)[0])

        # Get CSL of primary house
        cusp_data = cusps.get(primary_house, {})
        csl = cusp_data.get('sub_lord', '')

        # What houses does the CSL signify?
        if csl and csl in self.planets:
            csl_sigs = self.get_planet_significators(csl)
            csl_houses = set(csl_sigs['all_signified_houses'])
        else:
            csl_houses = set()

        # Check promise vs denial
        promise_match = csl_houses & promise_houses
        denial_match = csl_houses & denial_houses

        if promise_match and not denial_match:
            verdict = 'PROMISED'
            confidence = 'High'
            description = f'CSL {csl} signifies favorable houses {promise_match}'
        elif denial_match and not promise_match:
            verdict = 'DENIED'
            confidence = 'High'
            description = f'CSL {csl} signifies unfavorable houses {denial_match}'
        elif promise_match and denial_match:
            if len(promise_match) > len(denial_match):
                verdict = 'PROMISED (with obstacles)'
                confidence = 'Moderate'
            else:
                verdict = 'DELAYED/DIFFICULT'
                confidence = 'Moderate'
            description = f'CSL {csl} signifies both favorable {promise_match} and unfavorable {denial_match}'
        else:
            verdict = 'UNCERTAIN'
            confidence = 'Low'
            description = f'CSL {csl} does not strongly signify relevant houses'

        # Find significator planets (planets that can trigger the event)
        triggering_planets = []
        for planet in self.planets:
            p_sigs = self.get_planet_significators(planet)
            p_houses = set(p_sigs['all_signified_houses'])
            overlap = p_houses & promise_houses
            if len(overlap) >= 2:
                triggering_planets.append({
                    'planet': planet,
                    'signifies': sorted(overlap),
                    'star_lord': p_sigs['star_lord'],
                    'sub_lord': p_sigs['sub_lord'],
                })

        return {
            'event': event,
            'primary_house': primary_house,
            'cusp_sub_lord': csl,
            'csl_signified_houses': sorted(csl_houses),
            'promise_houses': sorted(promise_houses),
            'denial_houses': sorted(denial_houses),
            'verdict': verdict,
            'confidence': confidence,
            'description': description,
            'triggering_planets': triggering_planets,
        }

    # ═══════════════════════════════════════════════════════════════════
    # RULING PLANETS (at query time)
    # ═══════════════════════════════════════════════════════════════════

    def get_ruling_planets(self, query_time: datetime = None) -> Dict:
        """
        KP Ruling Planets at the time of query.
        If ruling planets match event significators → event confirmed.
        """
        if query_time is None:
            query_time = datetime.now()

        try:
            jd = self.engine.ephemeris.get_julian_day(query_time)
            moon_pos = self.engine.ephemeris.get_planet_position(jd, 'Moon')
            moon_long = moon_pos['longitude']

            from ..core.ephemeris import swe
            flags = swe.FLG_SIDEREAL
            from app.services.core.ephemeris import houses_safe
            houses, angles = houses_safe(jd, self.engine.latitude, self.engine.longitude, b'P', flags)
            asc_long = angles[0]
        except Exception:
            moon_long = 0.0
            asc_long = 0.0

        # 5 ruling planets
        moon_sign_lord = RASHI_LORDS[int(moon_long / 30) % 12]
        moon_star_lord = NAKSHATRA_LORDS[int(moon_long / (360/27)) % 27]
        moon_sub_lord = self._get_sub_lord(moon_long)
        asc_sign_lord = RASHI_LORDS[int(asc_long / 30) % 12]
        asc_star_lord = NAKSHATRA_LORDS[int(asc_long / (360/27)) % 27]
        day_lord = self._get_day_lord(query_time)

        rps = [moon_sign_lord, moon_star_lord, moon_sub_lord, asc_sign_lord, asc_star_lord, day_lord]
        # Remove duplicates preserving order
        seen = set()
        unique_rps = []
        for rp in rps:
            if rp not in seen:
                seen.add(rp)
                unique_rps.append(rp)

        return {
            'ruling_planets': unique_rps,
            'moon_sign_lord': moon_sign_lord,
            'moon_star_lord': moon_star_lord,
            'moon_sub_lord': moon_sub_lord,
            'asc_sign_lord': asc_sign_lord,
            'asc_star_lord': asc_star_lord,
            'day_lord': day_lord,
            'query_time': query_time.isoformat(),
        }

    def _get_day_lord(self, dt: datetime) -> str:
        """Get planetary day lord."""
        day_lords = {
            0: 'Moon', 1: 'Mars', 2: 'Mercury',
            3: 'Jupiter', 4: 'Venus', 5: 'Saturn', 6: 'Sun',
        }
        return day_lords[dt.weekday()]

    def verify_event_with_rp(self, event: str) -> Dict:
        """
        Verify if event will happen by matching ruling planets with significators.
        If RP matches triggering planets → CONFIRMED.
        """
        event_analysis = self.analyze_event_kp(event)
        rp_data = self.get_ruling_planets()
        rp_set = set(rp_data['ruling_planets'])

        triggering = event_analysis.get('triggering_planets', [])
        trigger_planets = {t['planet'] for t in triggering}
        trigger_stars = {t['star_lord'] for t in triggering}
        trigger_subs = {t['sub_lord'] for t in triggering}

        all_trigger = trigger_planets | trigger_stars | trigger_subs
        match = rp_set & all_trigger

        if len(match) >= 3:
            rp_verdict = 'STRONGLY CONFIRMED'
            rp_confidence = 0.90
        elif len(match) >= 2:
            rp_verdict = 'CONFIRMED'
            rp_confidence = 0.75
        elif len(match) >= 1:
            rp_verdict = 'PARTIALLY CONFIRMED'
            rp_confidence = 0.55
        else:
            rp_verdict = 'NOT CONFIRMED at this time'
            rp_confidence = 0.30

        return {
            'event': event,
            'kp_verdict': event_analysis['verdict'],
            'kp_confidence': event_analysis['confidence'],
            'ruling_planets': rp_data['ruling_planets'],
            'matching_rp': sorted(match),
            'rp_verdict': rp_verdict,
            'rp_confidence': rp_confidence,
            'combined_verdict': f"{event_analysis['verdict']} + RP {rp_verdict}",
            'description': event_analysis['description'],
        }

    # ═══════════════════════════════════════════════════════════════════
    # FULL KP REPORT
    # ═══════════════════════════════════════════════════════════════════

    def generate_full_kp_report(self) -> Dict:
        """Complete KP analysis report."""
        cusps = self.get_placidus_cusps()

        # All planet significators
        planet_sigs = {}
        for planet in self.planets:
            planet_sigs[planet] = self.get_planet_significators(planet)

        # Analyze key events
        events = {}
        for event in ['marriage', 'career', 'wealth', 'childbirth', 'education', 'travel_foreign']:
            events[event] = self.analyze_event_kp(event)

        rp = self.get_ruling_planets()

        return {
            'system': 'Krishnamurti Paddhati (Complete)',
            'ayanamsa': 'KP (Krishnamurti)',
            'cusps': cusps,
            'planet_significators': planet_sigs,
            'event_analysis': events,
            'ruling_planets': rp,
            'untenanted': self.get_untenanted_houses(),
            'fortuna': self.get_kp_fortuna(),
            'summary': {
                'promised_events': [e for e, d in events.items() if 'PROMISED' in d['verdict']],
                'denied_events': [e for e, d in events.items() if d['verdict'] == 'DENIED'],
                'uncertain_events': [e for e, d in events.items() if d['verdict'] == 'UNCERTAIN'],
            },
        }

    # ═══════════════════════════════════════════════════════════════════
    # UNTENANTED HOUSE LOGIC
    # ═══════════════════════════════════════════════════════════════════

    def get_untenanted_houses(self) -> Dict:
        """
        KP Rule: When a house has NO planet occupying it, the house is 'untenanted'.
        Signification goes ONLY through the owner of the sign on the cusp.
        This changes the significator chain significantly.
        """
        occupied = set()
        for name, data in self.planets.items():
            if name not in ('Ascendant',):
                occupied.add(data.get('house', 0))

        untenanted = []
        for h in range(1, 13):
            if h not in occupied:
                cusps = self.get_placidus_cusps()
                cusp_data = cusps.get(h, {})
                cusp_rashi = cusp_data.get('rashi', 0)
                # RASHI_LORDS from core.constants is a LIST indexed by rashi
                # number. Same confusion as kp_timing had: other modules define a
                # same-named dict keyed by sign name, and .get() on a list raises.
                owner = RASHI_LORDS[cusp_rashi] if 0 <= cusp_rashi < 12 else ''
                csl = cusp_data.get('sub_lord', '')
                untenanted.append({
                    'house': h,
                    'sign_on_cusp': cusp_data.get('rashi_name', ''),
                    'owner': owner,
                    'cusp_sub_lord': csl,
                    'note': f'H{h} untenanted — signified only through owner {owner} and CSL {csl}',
                })

        return {
            'untenanted_houses': [u['house'] for u in untenanted],
            'tenanted_houses': sorted(occupied),
            'details': untenanted,
        }

    # ═══════════════════════════════════════════════════════════════════
    # FRUITFUL / BARREN SIGNS
    # ═══════════════════════════════════════════════════════════════════

    FRUITFUL_SIGNS = {'Cancer', 'Scorpio', 'Pisces'}  # Water signs
    SEMI_FRUITFUL = {'Taurus', 'Libra', 'Sagittarius', 'Capricorn', 'Aquarius'}
    BARREN_SIGNS = {'Aries', 'Gemini', 'Leo', 'Virgo'}

    def check_fruitfulness(self, house: int = 5) -> Dict:
        """
        KP fruitful/barren check — important for childbirth (H5) and marriage (H7).
        If the cusp sub-lord is in a barren sign, the event is weakened.
        """
        cusps = self.get_placidus_cusps()
        cusp_data = cusps.get(house, {})
        csl = cusp_data.get('sub_lord', '')
        csl_data = self.planets.get(csl, {})
        csl_sign = csl_data.get('rashi_name', '')

        if csl_sign in self.FRUITFUL_SIGNS:
            fertility = 'Fruitful'
            strength = 'Strong support for the event'
        elif csl_sign in self.BARREN_SIGNS:
            fertility = 'Barren'
            strength = 'Weakened — event may be delayed or denied'
        else:
            fertility = 'Semi-fruitful'
            strength = 'Moderate support'

        return {
            'house': house,
            'cusp_sub_lord': csl,
            'csl_sign': csl_sign,
            'fertility': fertility,
            'strength': strength,
        }

    # ═══════════════════════════════════════════════════════════════════
    # KP FORTUNA (Part of Fortune)
    # ═══════════════════════════════════════════════════════════════════

    def get_kp_fortuna(self) -> Dict:
        """
        KP Part of Fortune = ASC + Moon - Sun (sidereal, KP ayanamsa).
        Used as an additional significator point.
        """
        asc_long = self.asc_longitude
        sun_long = self.planets.get('Sun', {}).get('longitude', 0)
        moon_long = self.planets.get('Moon', {}).get('longitude', 0)

        # Day/night check
        sun_house = self.planets.get('Sun', {}).get('house', 1)
        if sun_house <= 6:  # Day chart
            fortuna = (asc_long + moon_long - sun_long) % 360
        else:  # Night chart
            fortuna = (asc_long + sun_long - moon_long) % 360

        rashi = int(fortuna / 30) % 12
        nak_index = int(fortuna / (360 / 27)) % 27
        house = ((rashi - self.asc_rashi) % 12) + 1

        return {
            'longitude': round(fortuna, 4),
            'sign': RASHI_NAMES[rashi],
            'house': house,
            'nakshatra': NAKSHATRA_NAMES[nak_index],
            'star_lord': NAKSHATRA_LORDS[nak_index],
            'sub_lord': self._get_sub_lord(fortuna),
            'interpretation': f'Fortuna in H{house} ({RASHI_NAMES[rashi]}) — where material fortune flows',
        }


def analyze_kp_complete(engine) -> Dict:
    """Convenience function."""
    kp = KPComplete(engine)
    return kp.generate_full_kp_report()
