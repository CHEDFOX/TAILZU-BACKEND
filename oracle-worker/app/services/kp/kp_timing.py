"""
KP TRANSIT TIMING — The WHEN System
KP can say YES/NO (promise/denial via CSL). This module says WHEN.

Two mechanisms:
1. DBA Matching: Event fires when Dasha-Bhukti-Antara lords are all significators
   of the relevant houses.
2. Transit Trigger: Event activates when transiting planet's star-lord AND sub-lord
   match natal significators of the event houses.

Together they pinpoint events to WEEKS — the most precise timing in Jyotish.
"""

from typing import Dict, List, Set
from ..core.constants import NAKSHATRA_LORDS, RASHI_LORDS

DASHA_SEQUENCE = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
VIMSHOTTARI_YEARS = {
    'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7,
    'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17,
}
TOTAL_YEARS = 120

# House groups for events
KP_EVENT_HOUSES = {
    'marriage':       [2, 7, 11],
    'career':         [2, 6, 10, 11],
    'wealth':         [2, 6, 10, 11],
    'childbirth':     [2, 5, 11],
    'education':      [4, 9, 11],
    'travel_foreign': [3, 9, 12],
    'property':       [4, 11, 12],
    'health_issue':   [1, 6, 8, 12],
    'job_change':     [2, 6, 10, 11],
    'litigation':     [1, 6, 11],
    'spiritual':      [5, 9, 12],
    'vehicle':        [4, 11],
    'business':       [2, 7, 10, 11],
}


def _get_sub_lord(longitude: float) -> str:
    """Calculate sub-lord for a longitude."""
    nak_span = 360.0 / 27
    nak_idx = int(longitude / nak_span) % 27
    pos_in_nak = longitude % nak_span
    nak_lord = NAKSHATRA_LORDS[nak_idx]
    start_idx = DASHA_SEQUENCE.index(nak_lord)
    accumulated = 0.0
    for i in range(9):
        planet = DASHA_SEQUENCE[(start_idx + i) % 9]
        sub_span = nak_span * (VIMSHOTTARI_YEARS[planet] / TOTAL_YEARS)
        if accumulated + sub_span > pos_in_nak:
            return planet
        accumulated += sub_span
    return nak_lord


class KPTransitTiming:
    """
    KP Transit-based event timing.
    Works with existing KPComplete for significator data.
    """

    def __init__(self, engine):
        self.engine = engine
        # engine.planets is annotated -> Dict and returns self._chart['planets'],
        # which is not always a dict: on some charts it arrives as a LIST of
        # planet records. Every lookup below is .get(planet), so a list raised
        # "'list' object has no attribute 'get'" and dropped BOTH dba_timing and
        # transit_triggers out of the KP briefing — silently, with the responder
        # writing its timing answer without any timing data.
        #
        # Normalised once here rather than guarded at each of the call sites.
        # This is a shim: the real fix is for the chart builder to settle on one
        # shape, but that reaches far more code than the two sections that are
        # broken today.
        self.planets = self._as_map(engine.planets)
        self.asc_rashi = engine.ascendant_rashi
        self._sig_cache = {}

    @staticmethod
    def _as_map(planets):
        if isinstance(planets, dict):
            return planets
        out = {}
        for p in (planets or []):
            if isinstance(p, dict):
                key = p.get('name') or p.get('planet') or p.get('Planet')
                if key:
                    out[key] = p
        return out

    def _get_planet_signified_houses(self, planet: str) -> Set[int]:
        """Get all houses a planet signifies (occupation + ownership + star lord chain)."""
        if planet in self._sig_cache:
            return self._sig_cache[planet]

        p_data = self.planets.get(planet, {})
        if not p_data:
            return set()

        houses = set()

        # 1. House it occupies
        houses.add(p_data.get('house', 1))

        # 2. Houses it owns
        for i in range(12):
            rashi_idx = (self.asc_rashi + i) % 12
            # core.constants.RASHI_LORDS is a LIST indexed by rashi number, not a
            # dict keyed by sign name — sections_bphs.py defines a same-named dict
            # and the two got confused. .get() on a list raised here on the FIRST
            # ownership check, so this function never returned once and KP's
            # dba_timing and transit_triggers have never built at all.
            if RASHI_LORDS[rashi_idx] == planet:
                houses.add(i + 1)

        # 3. Star lord's occupation and ownership
        p_long = p_data.get('longitude', 0)
        nak_idx = int(p_long / (360 / 27)) % 27
        star_lord = NAKSHATRA_LORDS[nak_idx]
        sl_data = self.planets.get(star_lord, {})
        if sl_data:
            houses.add(sl_data.get('house', 1))
            for i in range(12):
                rashi_idx = (self.asc_rashi + i) % 12
                if RASHI_LORDS[rashi_idx] == star_lord:
                    houses.add(i + 1)

        self._sig_cache[planet] = houses
        return houses

    # ═══════════════════════════════════════════════════════════════
    # DBA MATCHING — Dasha-Bhukti-Antara significator check
    # ═══════════════════════════════════════════════════════════════

    def check_dba_for_event(self, event: str) -> Dict:
        """
        Check if current Dasha-Bhukti-Antara lords are significators
        of the event houses. If all 3 match → event is imminent.
        """
        event_houses = set(KP_EVENT_HOUSES.get(event, [1, 11]))

        try:
            dasha = self.engine.get_vimshottari_dasha()
            md_lord = dasha.get('mahadasha', {}).get('lord', '')
            ad_lord = dasha.get('antardasha', {}).get('lord', '')
            dasha_string = dasha.get('dasha_string', '')

            # Extract pratyantar if available
            pd_lord = ''
            parts = dasha_string.split('/')
            if len(parts) >= 3:
                pd_lord = parts[2].strip()
        except Exception:
            return {'error': 'Could not calculate dasha'}

        # Check each level's signification
        md_houses = self._get_planet_signified_houses(md_lord) if md_lord else set()
        ad_houses = self._get_planet_signified_houses(ad_lord) if ad_lord else set()
        pd_houses = self._get_planet_signified_houses(pd_lord) if pd_lord else set()

        md_match = md_houses & event_houses
        ad_match = ad_houses & event_houses
        pd_match = pd_houses & event_houses

        matches = sum(1 for m in [md_match, ad_match, pd_match] if m)

        if matches == 3:
            verdict = 'ACTIVE NOW — all three DBA lords signify event houses'
            confidence = 'Very High'
        elif matches == 2:
            verdict = 'Strong period — 2 of 3 DBA lords signify event houses'
            confidence = 'High'
        elif matches == 1:
            verdict = 'Moderate period — only 1 DBA lord signifies event houses'
            confidence = 'Moderate'
        else:
            verdict = 'Not active — current DBA does not signify this event'
            confidence = 'Low'

        return {
            'event': event,
            'event_houses': sorted(event_houses),
            'mahadasha': {'lord': md_lord, 'signifies': sorted(md_houses), 'matches': sorted(md_match)},
            'antardasha': {'lord': ad_lord, 'signifies': sorted(ad_houses), 'matches': sorted(ad_match)},
            'pratyantar': {'lord': pd_lord, 'signifies': sorted(pd_houses), 'matches': sorted(pd_match)},
            'dba_matches': matches,
            'verdict': verdict,
            'confidence': confidence,
            'dasha_string': dasha_string if 'dasha_string' in dir() else '',
        }

    def scan_dba_all_events(self) -> Dict:
        """Scan which events are active in current DBA."""
        results = {}
        for event in KP_EVENT_HOUSES:
            r = self.check_dba_for_event(event)
            results[event] = {
                'matches': r['dba_matches'],
                'verdict': r['verdict'],
                'confidence': r['confidence'],
            }

        # Sort by match count
        active = {k: v for k, v in sorted(results.items(), key=lambda x: -x[1]['matches'])}
        top_events = [k for k, v in active.items() if v['matches'] >= 2]

        return {
            'events': active,
            'top_active_events': top_events,
            'dasha': results.get('career', {}).get('verdict', ''),
        }

    # ═══════════════════════════════════════════════════════════════
    # TRANSIT TRIGGER — when transiting planet activates event
    # ═══════════════════════════════════════════════════════════════

    def check_transit_triggers(self, event: str) -> List[Dict]:
        """
        Check if any current transiting planet's star-lord + sub-lord
        are significators of the event houses.
        
        KP Rule: Event triggers when transiting planet is in the
        star of a significator AND sub of a significator of event houses.
        """
        event_houses = set(KP_EVENT_HOUSES.get(event, [1, 11]))

        # Build set of significator planets for this event
        event_significators = set()
        for planet_name in self.planets:
            p_houses = self._get_planet_signified_houses(planet_name)
            if p_houses & event_houses:
                event_significators.add(planet_name)

        # Get current transits
        try:
            # Same two-shapes problem as engine.planets: this can hand back a
            # list of transit records instead of a map keyed by planet, and the
            # lookup below is .get(t_name). Note the try covered only the CALL,
            # so a list sailed past it and raised on the next line instead.
            current = self._as_map(self.engine.ephemeris.get_current_transits())
        except Exception:
            return []

        triggers = []
        for t_name in ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']:
            t_data = current.get(t_name, {})
            t_long = t_data.get('longitude', 0)

            # Star lord of transit planet
            nak_idx = int(t_long / (360 / 27)) % 27
            t_star_lord = NAKSHATRA_LORDS[nak_idx]

            # Sub lord of transit planet
            t_sub_lord = _get_sub_lord(t_long)

            star_match = t_star_lord in event_significators
            sub_match = t_sub_lord in event_significators

            if star_match and sub_match:
                triggers.append({
                    'transit_planet': t_name,
                    'transit_sign': t_data.get('rashi_name', ''),
                    'star_lord': t_star_lord,
                    'sub_lord': t_sub_lord,
                    'strength': 'STRONG — both star and sub match',
                    'active': True,
                })
            elif star_match:
                triggers.append({
                    'transit_planet': t_name,
                    'transit_sign': t_data.get('rashi_name', ''),
                    'star_lord': t_star_lord,
                    'sub_lord': t_sub_lord,
                    'strength': 'PARTIAL — star matches, sub does not',
                    'active': False,
                })

        # Sort: strong triggers first
        triggers.sort(key=lambda t: (0 if t['active'] else 1))
        return triggers

    def get_full_timing(self, event: str) -> Dict:
        """
        Complete KP timing: DBA check + Transit triggers combined.
        This is the full KP timing answer.
        """
        dba = self.check_dba_for_event(event)
        triggers = self.check_transit_triggers(event)
        active_triggers = [t for t in triggers if t.get('active')]

        # Combined verdict
        dba_active = dba['dba_matches'] >= 2
        transit_active = len(active_triggers) > 0

        if dba_active and transit_active:
            combined = f"EVENT IMMINENT — DBA period is active AND transit triggers are firing ({len(active_triggers)} planets)"
            timing = "Days to weeks"
        elif dba_active and not transit_active:
            combined = "Period is favorable but no transit trigger yet — watch for trigger transits"
            timing = "Weeks to months (waiting for transit trigger)"
        elif transit_active and not dba_active:
            combined = "Transit triggers exist but DBA period is not aligned — event may be felt but not fully manifest"
            timing = "Not in this dasha period"
        else:
            combined = "Neither DBA nor transits are aligned for this event currently"
            timing = "Not imminent"

        return {
            'event': event,
            'dba_analysis': dba,
            'transit_triggers': triggers,
            'active_triggers': len(active_triggers),
            'combined_verdict': combined,
            'timing': timing,
        }
