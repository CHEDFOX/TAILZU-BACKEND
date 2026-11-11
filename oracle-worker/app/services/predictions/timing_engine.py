"""
JYOTISH ENGINE - TIMING ENGINE
Three classical tools only. No invented probability weights.

1. CHART PROMISE  — fires actual BPHS slokas via classical_rules.evaluate()
2. DASHA ACTIVATION — does dasha lord connect to relevant house? (lordship/occupation/aspect)
3. DOUBLE TRANSIT  — Jupiter AND Saturn both hit the house? (Phaladeepika Ch.26)

Verdict is qualitative — exactly how a classical Jyotishi reasons.
"""

from datetime import datetime, timedelta
from ..core.constants import (
    PLANETS, RASHI_LORDS,
    KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES,
)

EVENT_HOUSES = {
    'marriage':     {'primary': [7],     'secondary': [2, 11],  'karaka': 'Venus'},
    'career':       {'primary': [10],    'secondary': [6, 2, 11],'karaka': 'Saturn'},
    'promotion':    {'primary': [10,11], 'secondary': [9, 6],   'karaka': 'Sun'},
    'job_change':   {'primary': [10],    'secondary': [3, 6, 9],'karaka': 'Saturn'},
    'business':     {'primary': [7, 10], 'secondary': [2, 11],  'karaka': 'Mercury'},
    'childbirth':   {'primary': [5],     'secondary': [2, 11],  'karaka': 'Jupiter'},
    'education':    {'primary': [4, 5],  'secondary': [9, 2],   'karaka': 'Jupiter'},
    'foreign':      {'primary': [9, 12], 'secondary': [3, 7],   'karaka': 'Rahu'},
    'property':     {'primary': [4],     'secondary': [2, 11],  'karaka': 'Mars'},
    'health_issue': {'primary': [6, 8],  'secondary': [1, 12],  'karaka': 'Saturn'},
    'wealth':       {'primary': [2, 11], 'secondary': [5, 9],   'karaka': 'Jupiter'},
    'vehicle':      {'primary': [4],     'secondary': [11],     'karaka': 'Venus'},
    'relationship': {'primary': [7, 5],  'secondary': [11, 3],  'karaka': 'Venus'},
    'spiritual':    {'primary': [9, 12], 'secondary': [5, 8],   'karaka': 'Ketu'},
    'litigation':   {'primary': [6],     'secondary': [8, 12],  'karaka': 'Mars'},
}

EVENT_TO_CLASSICAL = {
    'marriage':'marriage','career':'career','promotion':'career',
    'job_change':'career','business':'business','childbirth':'children',
    'education':'education','foreign':'foreign','property':'property',
    'health_issue':'health','wealth':'wealth','vehicle':'property',
    'relationship':'love','spiritual':'spiritual','litigation':'business',
}

STRENGTH_ORDER = {
    'ALL THREE CONVERGING':0,'PROMISED \u2014 AWAITING':1,
    'SUPPORTED':2,'POSSIBLE':3,'PROMISED BUT NOT':4,
    'TRANSIT AND DASHA':5,'NOT STRONGLY':6,'CHALLENGED':7,'DENIED':8,
}


class TimingEngine:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self._dasha_data = None

    @property
    def dasha_data(self):
        if self._dasha_data is None:
            self._dasha_data = self.engine.get_vimshottari_dasha()
        return self._dasha_data

    def get_house_lord(self, house):
        return RASHI_LORDS[(self.asc_rashi + house - 1) % 12]

    def get_planet_house(self, planet):
        return self.planets.get(planet, {}).get('house', 1)

    def _house_keyword(self, house):
        kw = {
            1:'Self/Body/Health',2:'Wealth/Family/Speech',
            3:'Siblings/Courage/Travel',4:'Mother/Home/Property',
            5:'Children/Intelligence/Romance',6:'Enemies/Disease/Service',
            7:'Marriage/Partner/Business',8:'Death/Transformation',
            9:'Father/Guru/Fortune',10:'Career/Status/Authority',
            11:'Gains/Income/Friends',12:'Loss/Foreign/Liberation',
        }
        return kw.get(house, '')

    def planet_connects_to_house(self, planet, house):
        """BPHS Ch.24 — three classical connections: lord / occupies / aspects."""
        connections = []
        if planet == self.get_house_lord(house):
            connections.append('lord')
        if self.get_planet_house(planet) == house:
            connections.append('occupies')
        p_house = self.get_planet_house(planet)
        for asp in PLANETS.get(planet, {}).get('aspects', [7]):
            if ((p_house + asp - 1) % 12) + 1 == house:
                connections.append('aspects')
                break
        return {'connected': bool(connections), 'connections': connections,
                'planet': planet, 'house': house}

    def check_dasha_activation(self, primary_houses):
        """BPHS Ch.46 — dasha lord must relate to relevant house for event to manifest."""
        dasha = self.dasha_data
        maha = dasha.get('mahadasha', {}).get('lord', '')
        antar = dasha.get('antardasha', {}).get('lord', '')
        mc = {h: self.planet_connects_to_house(maha, h) for h in primary_houses}
        ac = {h: self.planet_connects_to_house(antar, h) for h in primary_houses}
        maha_ok = any(v['connected'] for v in mc.values())
        antar_ok = any(v['connected'] for v in ac.values())

        def s(conns):
            return ', '.join(f"H{h} by {'+'.join(d['connections'])}"
                             for h, d in conns.items() if d['connected']) or 'none'

        if maha_ok and antar_ok:
            strength, desc = 'strong', f'{maha} MD ({s(mc)}) AND {antar} AD ({s(ac)}) both connect'
        elif maha_ok:
            strength, desc = 'partial', f'{maha} MD connects ({s(mc)}); {antar} AD does not'
        elif antar_ok:
            strength, desc = 'partial', f'{antar} AD connects ({s(ac)}); {maha} MD does not'
        else:
            strength, desc = 'none', f'Neither {maha} MD nor {antar} AD connects to relevant houses'

        return {'mahadasha':maha,'antardasha':antar,
                'maha_connected':maha_ok,'antar_connected':antar_ok,
                'strength':strength,'description':desc}

    def _transit_hits(self, planet, transits, target_rashi):
        t = transits.get(planet, {})
        tr = t.get('rashi', 0)
        if tr == target_rashi:
            return {'activates':True,'method':'placement'}
        for asp in PLANETS.get(planet, {}).get('aspects', [7]):
            if (tr + asp - 1) % 12 == target_rashi:
                return {'activates':True,'method':'aspect'}
        return {'activates':False,'method':None}

    def check_double_transit(self, transits, house):
        """Phaladeepika Ch.26 — Jupiter AND Saturn must both activate the house."""
        target = (self.asc_rashi + house - 1) % 12
        jup = self._transit_hits('Jupiter', transits, target)
        sat = self._transit_hits('Saturn', transits, target)
        double = jup['activates'] and sat['activates']
        return {
            'double_transit':double,'house':house,'jupiter':jup,'saturn':sat,
            'strength':'double' if double else 'partial' if (jup['activates'] or sat['activates']) else 'none',
        }

    def predict_event_timing(self, event, transit_planets=None, months_ahead=24):
        if event not in EVENT_HOUSES:
            return {'error':f'Unknown event: {event}','valid_events':list(EVENT_HOUSES.keys())}

        cfg = EVENT_HOUSES[event]
        primary_houses = cfg['primary']
        secondary_houses = cfg['secondary']
        karaka = cfg['karaka']

        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()

        # 1. Chart promise — fires actual BPHS slokas
        chart_promise = {'summary':'Not evaluated','support_count':0,
                         'oppose_count':0,'denial_count':0,
                         'supports':[],'opposes':[],'denies':[]}
        try:
            from .classical_rules import ClassicalRules
            chart_promise = ClassicalRules(self.engine).evaluate(
                EVENT_TO_CLASSICAL.get(event, event))
        except Exception:
            pass

        summary = chart_promise.get('summary', '')
        if 'DENIED' in summary:       promise = 'denied'
        elif 'STRONG' in summary:     promise = 'strong'
        elif 'SUPPORTED' in summary:  promise = 'supported'
        elif 'MIXED' in summary:      promise = 'mixed'
        elif 'WEAK' in summary:       promise = 'weak'
        elif 'NEUTRAL' in summary:    promise = 'neutral'
        elif 'CONFLICTED' in summary: promise = 'conflicted'
        else:                         promise = 'unknown'

        # 2. Dasha activation
        dasha_result = self.check_dasha_activation(primary_houses)

        # 3. Double transit
        dt_results = [self.check_double_transit(transit_planets, h) for h in primary_houses]
        double_houses = [r['house'] for r in dt_results if r['strength'] == 'double']
        partial_houses = [r['house'] for r in dt_results if r['strength'] == 'partial']
        transit_strength = 'double' if double_houses else 'partial' if partial_houses else 'none'
        sec_double = [r['house'] for r in [self.check_double_transit(transit_planets, h)
                      for h in secondary_houses] if r['strength'] == 'double']

        # 4. Karaka classical dignity
        kd = self.planets.get(karaka, {})
        k_rashi = kd.get('rashi', 0)
        k_house = kd.get('house', 1)
        ki = PLANETS.get(karaka, {})
        if k_rashi == ki.get('exalted'):          k_status = 'exalted'
        elif k_rashi in ki.get('owns', []):        k_status = 'own_sign'
        elif k_rashi == ki.get('moolatrikona'):    k_status = 'moolatrikona'
        elif k_rashi == ki.get('debilitated'):     k_status = 'debilitated'
        elif kd.get('retrograde') and karaka not in ('Rahu','Ketu'): k_status = 'retrograde'
        else:                                      k_status = 'neutral'
        k_placement = ('kendra' if k_house in KENDRA_HOUSES else
                       'trikona' if k_house in TRIKONA_HOUSES else
                       'dusthana' if k_house in DUSTHANA_HOUSES else 'neutral')

        verdict, timing_note = self._verdict(promise, dasha_result['strength'], transit_strength)

        return {
            'event': event,
            'verdict': verdict,
            'timing_assessment': timing_note,
            'chart_promise': {
                'level': promise,
                'summary': summary,
                'supporting_rules': chart_promise.get('support_count', 0),
                'opposing_rules': chart_promise.get('oppose_count', 0),
                'denial_rules': chart_promise.get('denial_count', 0),
                'key_supports': [r['text'] for r in chart_promise.get('supports', [])[:3]],
                'key_oppositions': [r['text'] for r in chart_promise.get('opposes', [])[:3]],
                'denials': [r['text'] for r in chart_promise.get('denies', [])],
            },
            'dasha': {
                'mahadasha': dasha_result['mahadasha'],
                'antardasha': dasha_result['antardasha'],
                'activation': dasha_result['strength'],
                'description': dasha_result['description'],
            },
            'transit': {
                'strength': transit_strength,
                'double_transit_houses': double_houses,
                'partial_transit_houses': partial_houses,
                'secondary_double': sec_double,
            },
            'karaka': {'planet':karaka,'house':k_house,'dignity':k_status,'placement':k_placement},
            'window': self._window(promise, dasha_result['strength'], transit_strength, months_ahead),
            'primary_houses': primary_houses,
        }

    def _verdict(self, promise, dasha, transit):
        if promise == 'denied':
            return ('DENIED BY CHART',
                    'Classical texts indicate denial. Dasha and transit cannot override chart promise.')
        if promise == 'strong' and dasha == 'strong' and transit == 'double':
            return ('ALL THREE CONVERGING — EVENT HIGHLY INDICATED',
                    'Chart strongly promises. Dasha activates relevant houses. '
                    'Jupiter and Saturn both transit the primary house. Near-term manifestation indicated.')
        if promise == 'strong' and dasha == 'strong':
            t = ('double transit active' if transit == 'double' else
                 'partial transit' if transit == 'partial' else 'awaiting transit trigger')
            return ('PROMISED \u2014 AWAITING TRANSIT TRIGGER',
                    f'Chart and dasha aligned. {t}. Event indicated when transits complete.')
        if promise in ('strong','supported') and dasha in ('strong','partial'):
            return ('SUPPORTED \u2014 CONDITIONS PARTIALLY ALIGNED',
                    'Chart supports this event. Dasha shows activation. Possible in current period.')
        if promise in ('strong','supported') and dasha == 'none':
            return ('PROMISED BUT NOT YET ACTIVATED',
                    'Chart supports this event but current dasha lords do not connect. '
                    'Await a dasha that activates the relevant house.')
        if promise == 'mixed' and dasha == 'strong':
            return ('POSSIBLE \u2014 MIXED PROMISE WITH ACTIVE DASHA',
                    'Chart shows equal supporting and opposing factors. Dasha activates houses. '
                    'Could manifest with difficulty.')
        if promise in ('weak','conflicted'):
            return ('CHALLENGED \u2014 SIGNIFICANT OBSTACLES',
                    'Classical texts show more opposing than supporting factors for this event.')
        if dasha == 'strong' and transit == 'double':
            return ('TRANSIT AND DASHA ACTIVE \u2014 CHART NEUTRAL',
                    'Dasha and double transit are active. Chart promise is neutral.')
        return ('NOT STRONGLY INDICATED IN CURRENT PERIOD',
                'Chart promise, dasha activation, and transit support are not converging at this time.')

    def _window(self, promise, dasha, transit, months):
        now = datetime.now()
        if promise == 'denied':
            return {'start':None,'end':None,'description':'Event not indicated — chart shows denial'}
        if promise in ('strong','supported') and dasha == 'strong' and transit == 'double':
            return {'start':now.strftime('%Y-%m-%d'),
                    'end':(now+timedelta(days=180)).strftime('%Y-%m-%d'),
                    'description':'All three triggers active — within 6 months'}
        if promise in ('strong','supported') and dasha == 'strong':
            return {'start':now.strftime('%Y-%m-%d'),
                    'end':(now+timedelta(days=365)).strftime('%Y-%m-%d'),
                    'description':'Chart and dasha aligned — watch for transit trigger within 12 months'}
        if dasha in ('strong','partial') and promise not in ('denied','weak'):
            return {'start':(now+timedelta(days=90)).strftime('%Y-%m-%d'),
                    'end':(now+timedelta(days=months*30)).strftime('%Y-%m-%d'),
                    'description':f'Partial conditions — possible within {months} months'}
        return {'start':None,'end':None,
                'description':'Conditions not aligned — no clear window in current period'}

    def scan_all_events(self, transit_planets=None):
        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()
        results = {e: self.predict_event_timing(e, transit_planets) for e in EVENT_HOUSES}
        def sort_key(item):
            v = item[1]['verdict']
            for k, o in STRENGTH_ORDER.items():
                if k in v: return o
            return 5
        ranked = sorted(results.items(), key=sort_key)
        indicated = [(e,r) for e,r in ranked if 'DENIED' not in r['verdict'] and 'NOT STRONGLY' not in r['verdict']]
        return {
            'predictions': results,
            'top_indicated': [
                {'event':e,'verdict':r['verdict'],
                 'dasha':f"{r['dasha']['mahadasha']}/{r['dasha']['antardasha']}",
                 'transit':r['transit']['strength'],'window':r['window']['description']}
                for e,r in indicated[:5]
            ],
            'current_dasha': self.dasha_data.get('dasha_string',''),
            'scan_date': datetime.now().strftime('%Y-%m-%d'),
        }

    def get_period_analysis(self, months=3, transit_planets=None):
        if transit_planets is None:
            transit_planets = self.engine.ephemeris.get_current_transits()
        dasha = self.dasha_data
        maha = dasha.get('mahadasha',{}).get('lord','')
        antar = dasha.get('antardasha',{}).get('lord','')
        activated = []
        for h in range(1, 13):
            mc = self.planet_connects_to_house(maha, h)
            ac = self.planet_connects_to_house(antar, h)
            has_dt = self.check_double_transit(transit_planets, h)['double_transit']
            if mc['connected'] or ac['connected']:
                activated.append({
                    'house':h,'meaning':self._house_keyword(h),
                    'maha_connection':mc['connections'],'antar_connection':ac['connections'],
                    'double_transit':has_dt,
                    'strength':'very_active' if has_dt and mc['connected'] and ac['connected'] else 'active',
                })
        dt_houses = [h for h in range(1,13) if self.check_double_transit(transit_planets,h)['double_transit']]
        convergence = [ah['house'] for ah in activated if ah['double_transit']]
        very_active = [ah for ah in activated if ah['strength']=='very_active']
        if very_active:
            areas = ', '.join(ah['meaning'] for ah in very_active[:3])
            summary = f'{maha}/{antar} dasha with double transit in: {areas}. Events classically indicated.'
        elif activated:
            areas = ', '.join(ah['meaning'] for ah in activated[:3])
            summary = f'{maha}/{antar} dasha connects to: {areas}. Transit trigger needed.'
        else:
            summary = f'{maha}/{antar} — no strong house connections. General consolidation period.'
        return {
            'period':f'Next {months} months','dasha':f'{maha}/{antar}',
            'activated_houses':activated,'convergence_houses':convergence,
            'double_transit_houses':dt_houses,'summary':summary,
        }


def create_timing_engine(engine):
    return TimingEngine(engine)
