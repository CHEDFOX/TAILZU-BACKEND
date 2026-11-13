"""
JYOTISH ENGINE - LIFE TIMELINE + CHART SCORE + CROSS-SYSTEM CONFIDENCE
1. Life Timeline: 5-year prediction combining ALL systems
2. Chart Strength: Single 0-100 score
3. Cross-validation: Confidence when multiple systems agree
"""

from datetime import datetime
from typing import Dict


class LifeTimeline:
    """Combine all systems into a unified year-by-year prediction."""

    def __init__(self, engine):
        self.engine = engine

    def generate_timeline(self, years: int = 5) -> Dict:
        """Generate year-by-year life prediction combining all available systems."""
        current_year = datetime.now().year
        timeline = []

        for offset in range(years):
            year = current_year + offset
            year_data = self._analyze_year(year)
            timeline.append(year_data)

        # Find peak years
        best = max(timeline, key=lambda x: x['score'])
        worst = min(timeline, key=lambda x: x['score'])

        return {
            'timeline': timeline,
            'best_year': {'year': best['year'], 'score': best['score'], 'theme': best['primary_theme']},
            'most_challenging': {'year': worst['year'], 'score': worst['score'], 'theme': worst['primary_theme']},
            'current_year_score': timeline[0]['score'] if timeline else 0,
        }

    def _analyze_year(self, year: int) -> Dict:
        """Analyze a single year using multiple systems."""
        score = 50  # Base score
        themes = []
        factors = []

        # Varshaphal
        try:
            vp = self.engine.get_varshaphal(year)
            vp_score = vp['overall']['score']
            score = (score + vp_score) / 2
            factors.append(f"Varshaphal: {vp['overall']['rating']} ({vp_score})")
            themes.append(vp['year_lord']['planet'] + ' year')
        except Exception:
            pass

        # Sudarshana
        try:
            birth_year = self.engine.birth_local.year
            age = year - birth_year
            if age > 0:
                sud = self.engine.get_sudarshana(age)
                cy = sud['current_year']
                if cy['strong_count'] >= 2:
                    score += 10
                    factors.append(f"Sudarshana: {cy['overall']} ({cy['strong_count']}/3 rings)")
                elif cy['strong_count'] == 0:
                    score -= 5
                    factors.append(f"Sudarshana: Quiet year")
        except Exception:
            pass

        # Timing engine — scan what events are likely
        try:
            scan = self.engine.scan_all_predictions()
            top = scan['top_3']
            if top and top[0]['probability'] >= 0.6:
                themes.append(top[0]['event'])
                score += int(top[0]['probability'] * 10)
                factors.append(f"Top prediction: {top[0]['event']} ({top[0]['probability']})")
        except Exception:
            pass

        score = max(0, min(100, int(score)))

        if score >= 75:
            primary_theme = 'Excellent year — major positive developments'
        elif score >= 60:
            primary_theme = 'Good year — steady progress'
        elif score >= 45:
            primary_theme = 'Mixed year — opportunities and challenges'
        elif score >= 30:
            primary_theme = 'Challenging year — patience needed'
        else:
            primary_theme = 'Difficult year — focus on remedies'

        return {
            'year': year,
            'score': score,
            'primary_theme': primary_theme,
            'themes': themes[:3],
            'factors': factors,
        }


class ChartStrength:
    """Calculate single 0-100 chart strength score."""

    def __init__(self, engine):
        self.engine = engine

    def calculate(self) -> Dict:
        """Combine multiple strength indicators into one score."""
        scores = {}
        total_weight = 0

        # 1. Yoga strength (weight: 25)
        try:
            yogas = self.engine.get_yogas()
            pos = yogas['summary']['positive_yogas']
            neg = yogas['summary']['negative_yogas']
            total = yogas['summary']['total_yogas']
            yoga_score = min(100, max(0, 50 + (pos - neg) * 5))
            scores['yogas'] = {'score': yoga_score, 'weight': 25, 'detail': f'{pos} positive, {neg} negative'}
            total_weight += 25
        except Exception:
            pass

        # 2. Ishta/Kashta balance (weight: 20)
        try:
            ik = self.engine.get_ishta_kashta()
            benefic_count = sum(1 for p in ik['planets'].values() if p['verdict'] == 'Benefic')
            total_planets = len(ik['planets'])
            ik_score = int((benefic_count / max(total_planets, 1)) * 100)
            scores['ishta_kashta'] = {'score': ik_score, 'weight': 20, 'detail': f'{benefic_count}/{total_planets} benefic'}
            total_weight += 20
        except Exception:
            pass

        # 3. Lagna lord strength (weight: 15)
        try:
            from ..core.constants import RASHI_LORDS, KENDRA_HOUSES, TRIKONA_HOUSES, DUSTHANA_HOUSES
            l1 = RASHI_LORDS[(self.engine.ascendant_rashi) % 12]
            l1h = self.engine.planets.get(l1, {}).get('house', 1)
            l1r = self.engine.planets.get(l1, {}).get('rashi', 0)
            from ..core.constants import PLANETS as PD
            is_strong = (l1r == PD.get(l1, {}).get('exalted') or l1r in PD.get(l1, {}).get('owns', []))
            if is_strong and l1h in KENDRA_HOUSES:
                lagna_score = 90
            elif l1h in KENDRA_HOUSES + TRIKONA_HOUSES:
                lagna_score = 70
            elif l1h in DUSTHANA_HOUSES:
                lagna_score = 30
            else:
                lagna_score = 50
            scores['lagna_lord'] = {'score': lagna_score, 'weight': 15, 'detail': f'{l1} in house {l1h}'}
            total_weight += 15
        except Exception:
            pass

        # 4. Ashtakavarga total (weight: 15)
        try:
            av = self.engine.get_ashtakavarga()
            total_bindus = av.get('sarvashtakavarga', {}).get('total_bindus', 337)
            # Average is 337, range roughly 250-400
            av_score = min(100, max(0, int((total_bindus - 250) / 1.5)))
            scores['ashtakavarga'] = {'score': av_score, 'weight': 15, 'detail': f'{total_bindus} total bindus'}
            total_weight += 15
        except Exception:
            pass

        # 5. Argala support (weight: 10)
        try:
            arg = self.engine.get_argala()
            supported = len(arg['supported_houses'])
            obstructed = len(arg['obstructed_houses'])
            arg_score = min(100, max(0, 50 + (supported - obstructed) * 8))
            scores['argala'] = {'score': arg_score, 'weight': 10, 'detail': f'{supported} supported, {obstructed} obstructed'}
            total_weight += 10
        except Exception:
            pass

        # 6. Bhava Chalit stability (weight: 15)
        try:
            bc = self.engine.get_bhava_chalit()
            shifts = bc['total_shifts']
            bc_score = max(0, 100 - shifts * 15)
            scores['bhava_stability'] = {'score': bc_score, 'weight': 15, 'detail': f'{shifts} planet shifts'}
            total_weight += 15
        except Exception:
            pass

        # Weighted average
        if total_weight > 0:
            final = sum(s['score'] * s['weight'] for s in scores.values()) / total_weight
        else:
            final = 50

        final = int(max(0, min(100, final)))

        if final >= 80: grade = 'A+ (Exceptional Chart)'
        elif final >= 70: grade = 'A (Very Strong)'
        elif final >= 60: grade = 'B+ (Strong)'
        elif final >= 50: grade = 'B (Above Average)'
        elif final >= 40: grade = 'C (Average)'
        elif final >= 30: grade = 'D (Below Average)'
        else: grade = 'F (Needs Strong Remedies)'

        return {
            'overall_score': final,
            'grade': grade,
            'breakdown': scores,
            'total_factors': len(scores),
        }


class CrossSystemConfidence:
    """Cross-validate multiple dasha/prediction systems for confidence scoring."""

    def __init__(self, engine):
        self.engine = engine

    def validate_event(self, event: str) -> Dict:
        """Check how many systems agree on an event."""
        agreements = []
        total_systems = 0

        # 1. Timing Engine
        try:
            te = self.engine.predict_event(event)
            if te.get('probability', 0) >= 0.5:
                agreements.append(f"Timing Engine: {te['probability']} probability")
            total_systems += 1
        except Exception:
            pass

        # 2. KP System
        try:
            kp = self.engine.kp_event_analysis(event)
            if 'PROMISED' in kp.get('verdict', ''):
                agreements.append(f"KP System: {kp['verdict']}")
            total_systems += 1
        except Exception:
            pass

        # 3. Chara Dasha cross-validation
        try:
            cv = self.engine.cross_validate_dashas()
            if cv.get('agreement') in ('High', 'Very High'):
                agreements.append(f"Chara-Vimshottari: {cv['agreement']} agreement")
            total_systems += 1
        except Exception:
            pass

        # 4. Varshaphal (current year)
        try:
            vp = self.engine.get_varshaphal(datetime.now().year)
            if vp['overall']['score'] >= 55:
                agreements.append(f"Varshaphal: {vp['overall']['rating']}")
            total_systems += 1
        except Exception:
            pass

        # 5. Nadi reading check
        try:
            nadi = self.engine.get_nadi_reading()
            kp_data = nadi.get('key_predictions', {})
            event_map = {'marriage': 'relationships', 'career': 'career', 'wealth': 'wealth',
                         'health_issue': 'health', 'spiritual': 'spiritual'}
            nadi_key = event_map.get(event, '')
            if nadi_key and kp_data.get(nadi_key):
                agreements.append(f"Nadi: {len(kp_data[nadi_key])} related readings")
            total_systems += 1
        except Exception:
            pass

        # Calculate confidence
        agreement_ratio = len(agreements) / max(total_systems, 1)

        if agreement_ratio >= 0.8:
            confidence = 'Very High (90%+)'
            confidence_score = 0.90
        elif agreement_ratio >= 0.6:
            confidence = 'High (70-90%)'
            confidence_score = 0.75
        elif agreement_ratio >= 0.4:
            confidence = 'Moderate (50-70%)'
            confidence_score = 0.55
        elif agreement_ratio >= 0.2:
            confidence = 'Low (30-50%)'
            confidence_score = 0.35
        else:
            confidence = 'Very Low (<30%)'
            confidence_score = 0.20

        return {
            'event': event,
            'systems_checked': total_systems,
            'systems_agreeing': len(agreements),
            'agreements': agreements,
            'confidence': confidence,
            'confidence_score': confidence_score,
            'recommendation': 'Strongly indicated' if confidence_score >= 0.7 else
                              'Likely' if confidence_score >= 0.5 else
                              'Uncertain — wait for better planetary alignment',
        }

    def validate_all_events(self) -> Dict:
        events = ['marriage', 'career', 'wealth', 'childbirth', 'foreign', 'education', 'property']
        results = {}
        for event in events:
            results[event] = self.validate_event(event)
        ranked = sorted(results.items(), key=lambda x: x[1]['confidence_score'], reverse=True)
        return {
            'validations': results,
            'most_likely': ranked[0][0] if ranked else None,
            'most_likely_confidence': ranked[0][1]['confidence'] if ranked else None,
        }


def generate_life_timeline(engine, years=5):
    return LifeTimeline(engine).generate_timeline(years)

def calculate_chart_strength(engine):
    return ChartStrength(engine).calculate()

def validate_event_confidence(engine, event):
    return CrossSystemConfidence(engine).validate_event(event)
