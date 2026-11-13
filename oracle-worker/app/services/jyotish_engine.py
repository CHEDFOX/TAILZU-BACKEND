"""
JYOTISH ENGINE - MASTER INTEGRATION
Single entry point for all astrological calculations
"""

from datetime import datetime
from typing import Dict, List

# Core imports
from .core.ephemeris import get_ephemeris

# Chart imports
from .charts.divisional_charts import DivisionalCharts
from .charts.bhava_chalit import BhavaChalit
from .predictions.timing_engine import TimingEngine
from .tajika.varshaphal import Varshaphal
from .remedies.remedies import RemediesEngine
from .dashas.chara_dasha import CharaDasha
from .prashna.prashna import PrashnaKundli
from .nadi.bhrigu_nandi import BhriguNandiNadi
from .kp.kp_complete import KPComplete
from .charts.sudarshana import SudarshanChakra
from .charts.varga_analysis import VargaAnalysis
from .predictions.medical_astrology import MedicalAstrology
from .transits.transit_deep import TransitDeep
from .predictions.classical_rules import ClassicalRules
from .muhurta.time_systems import TimeSystems
from .predictions.personality import PersonalityEngine
from .dashas.kalachakra_dasha import KalachakraDasha
from .dashas.narayana_dasha import NarayanaDasha
from .jaimini.argala import ArgalaAnalysis
from .charts.sarvatobhadra import SarvatobhadraChakra
from .parashara.ishta_kashta import IshtaKashta
from .predictions.nakshatra_profiles import NakshatraProfiles
from .muhurta.muhurta_selector import MuhurtaSelector
from .predictions.life_timeline import LifeTimeline, ChartStrength, CrossSystemConfidence
from .predictions.baby_names import BabyNameGenerator
from .compatibility.synastry import Synastry
from .predictions.planetary_returns import PlanetaryReturns
from .numerology.core import NumerologyEngine
from .vastu.vastu import VastuAnalysis
from .chakra.chakra import ChakraAnalysis
from .mandala.geodetic_engine import MandalaEngine
from .predictions.career_aptitude import CareerAptitude
from .predictions.daily_ritual import DailyRitual, Biorhythm
from .transits.ashtakavarga_transit import AshtakavargaTransit
from .transits.future_transits import FutureTransitCalculator
from .parashara.yoga_timing import YogaTiming
from .dashas.pratyantar import PratyantarDasha
from .transits.transit_aspects import TransitNatalAspects
from .predictions.weekly_forecast import WeeklyForecast
from .kp.kp_horary import KPHorary
from .parashara.shadbala_complete import ShadbalaComplete
from .parashara.retrograde_natal import RetrogradeNatal
from .parashara.pushkara import PushkaraAnalysis
from .parashara.combustion import analyze_combustion
from .parashara.gandanta import analyze_gandanta
from .transits.eclipse_calendar import EclipseCalendar
from .predictions.transit_calendar import TransitCalendar
from .tajika.tithi_pravesh import TithiPravesh
from .muhurta.hora_notifications import get_current_hora, generate_notification, get_next_favorable_hora
from .prashna.prashna_refined import PrashnaRefined
from .compatibility.composite import CompositeChart
from .transits.vedha import check_vedha

# Parashara imports
from .parashara.dignity import PlanetaryDignity
from .parashara.aspects import PlanetaryAspects
from .parashara.yogas import YogaCalculator
from .parashara.shadbala import ShadbalaCalculator
from .parashara.ashtakavarga import AshtakavargaCalculator

# Dasha imports
from .dashas.vimshottari import VimshottariDasha
from .dashas.yogini import YoginiDasha

# Compatibility imports
from .compatibility.ashtakoota import AshtakootaMatch
from .compatibility.manglik import ManglikAnalysis

# Muhurta imports
from .muhurta.panchanga import Panchanga, Muhurta

# Jaimini imports
from .jaimini.karakas import JaiminiKarakas, ArudhaPada

# KP imports
from .kp.sublords import KPSystem

# Transit imports
from .transits.transit_analysis import TransitAnalyzer
from .predictions.time_query import TimeQueryEngine
from .predictions.realtime_dashboard import RealtimeDashboard
from .predictions.past_event import PastEventExplainer
from .predictions.hour_query import HourQuery
from .predictions.location_analysis import LocationAnalysis
from .predictions.dynamic_extras import DynamicRemedies, LuckyNumberFinder, DynamicMantra, ColorMetalFood
from .predictions.chart_promise import ChartPromise


from app.services.bphs import (calculate_all_avasthas, calculate_vimshopaka, calculate_graha_yuddha, calculate_nabhasa_yogas, calculate_sannyasa_yogas, calculate_maraka, calculate_sodhana_for_all, calculate_prastara, calculate_shodhya_pinda, calculate_dasha_sandhi, calculate_rashi_drishti)

class JyotishEngine:
    """
    Master Jyotish Engine - Complete Vedic Astrology Calculator
    
    Usage:
        engine = JyotishEngine(birth_datetime, latitude, longitude)
        chart = engine.generate_complete_chart()
        predictions = engine.get_predictions()
    """
    
    def __init__(self, birth_datetime: datetime, latitude: float, longitude: float,
                 ayanamsa: str = 'LAHIRI', timezone_offset: float = None):
        """
        Initialize Jyotish Engine
        
        Args:
            birth_datetime: Birth date and time in LOCAL time
            latitude: Birth latitude  
            longitude: Birth longitude (geographic)
            ayanamsa: Ayanamsa system (LAHIRI, RAMAN, KP)
            timezone_offset: Hours from UTC. If None, auto-detected from coordinates + date.
        """
        from .core.timezone_utils import get_timezone_manager
        
        self.birth_local = birth_datetime
        self.latitude = latitude
        self.longitude = longitude
        self.ayanamsa = ayanamsa
        
        # Get timezone info (considers DST and historical changes)
        tz_manager = get_timezone_manager()
        tz_info = tz_manager.get_timezone_info(latitude, longitude, birth_datetime)
        
        if timezone_offset is None:
            timezone_offset = tz_info['offset_hours']
        
        self.tz_offset = timezone_offset
        self.tz_name = tz_info['timezone_name']
        self.tz_info = tz_info
        
        # Convert local time to UTC for Swiss Ephemeris calculations
        self.birth_dt = tz_manager.local_to_utc(birth_datetime, latitude, longitude, timezone_offset)
        
        self.ephemeris = get_ephemeris(ayanamsa)
        self._chart = None
        self._planets = None
        self._ascendant = None
    
    def _ensure_chart(self):
        if self._chart is None:
            self._chart = self.ephemeris.generate_chart(
                self.birth_dt, self.latitude, self.longitude
            )
            self._planets = self._chart['planets']
            self._ascendant = self._chart['ascendant']
    
    @property
    def planets(self) -> Dict:
        self._ensure_chart()
        return self._planets
    
    @property
    def ascendant(self) -> Dict:
        self._ensure_chart()
        return self._ascendant
    
    @property
    def ascendant_rashi(self) -> int:
        self._ensure_chart()
        return self._ascendant['rashi']
    
    def get_rashi_chart(self) -> Dict:
        self._ensure_chart()
        return self._chart
    
    def get_navamsa_chart(self) -> Dict:
        self._ensure_chart()
        return DivisionalCharts.generate_divisional_chart(self._planets, 9)
    
    def get_dasamsa_chart(self) -> Dict:
        self._ensure_chart()
        return DivisionalCharts.generate_divisional_chart(self._planets, 10)
    
    def get_all_divisional_charts(self) -> Dict:
        self._ensure_chart()
        return DivisionalCharts.generate_all_vargas(self._planets)
    
    def get_divisional_chart(self, division: int) -> Dict:
        self._ensure_chart()
        return DivisionalCharts.generate_divisional_chart(self._planets, division)
    
    def get_planetary_dignity(self) -> Dict:
        self._ensure_chart()
        return PlanetaryDignity.analyze_all_planets(self._planets, self.ascendant_rashi)
    
    def get_upagrahas(self) -> Dict:
        """The sub-planets — the five from the Sun and the five from time.

        Rahu and Ketu have always been computed; these had not been, and the only
        one whose NAME appeared anywhere was Gulika, as a band of the day the
        muhurta feature avoids rather than as a body a chart can read. See
        app/services/bphs/upagrahas.py for both derivations.

        Returns {} rather than raising if the day cannot be bounded — there is no
        sunrise to divide inside a polar summer, and the five from the Sun are
        still returned in that case because they need no horizon.
        """
        self._ensure_chart()
        from .bphs.upagrahas import all_upagrahas
        sun = (self._planets or {}).get('Sun', {})
        return all_upagrahas(
            self.birth_dt, self.latitude, self.longitude,
            sun.get('longitude', 0.0), self.ephemeris,
            asc_rashi=self.ascendant_rashi,
        )

    def get_planetary_aspects(self) -> Dict:
        self._ensure_chart()
        return PlanetaryAspects.generate_aspect_table(self._planets)
    
    def get_shadbala(self) -> Dict:
        self._ensure_chart()
        calculator = ShadbalaCalculator(
            self._planets, self._ascendant, 
            self.birth_dt, self.latitude, self.longitude
        )
        return calculator.calculate_all_planets_shadbala()
    
    def get_ashtakavarga(self) -> Dict:
        self._ensure_chart()
        calculator = AshtakavargaCalculator(self._planets, self.ascendant_rashi)
        return calculator.calculate_sarvashtakavarga()
    
    def get_yogas(self) -> Dict:
        self._ensure_chart()
        calculator = YogaCalculator(self._planets, self._ascendant)
        return calculator.analyze_all_yogas()
    
    def get_raja_yogas(self) -> List[Dict]:
        yogas = self.get_yogas()
        return yogas['yogas'].get('raja', [])
    
    def get_dhana_yogas(self) -> List[Dict]:
        yogas = self.get_yogas()
        return yogas['yogas'].get('dhana', [])
    
    def get_vimshottari_dasha(self) -> Dict:
        self._ensure_chart()
        moon_long = self._planets['Moon']['longitude']
        dasha = VimshottariDasha(moon_long, self.birth_dt)
        # Use get_dasha_for_date(now) for consistent 5-level accuracy
        from datetime import datetime as dt_now
        result = dasha.get_dasha_for_date(dt_now.now())
        current = dasha.get_current_dasha()
        current['dasha_string'] = result.get('dasha_string', current.get('dasha_string', ''))
        return current
    
    def get_vimshottari_periods(self, years: int = 120) -> List[Dict]:
        self._ensure_chart()
        moon_long = self._planets['Moon']['longitude']
        dasha = VimshottariDasha(moon_long, self.birth_dt)
        return dasha.calculate_mahadasha_periods(years)
    
    def get_yogini_dasha(self) -> Dict:
        self._ensure_chart()
        moon_long = self._planets['Moon']['longitude']
        dasha = YoginiDasha(moon_long, self.birth_dt)
        return dasha.get_current_dasha()
    
    def get_dasha_for_date(self, date: datetime) -> Dict:
        self._ensure_chart()
        moon_long = self._planets['Moon']['longitude']
        dasha = VimshottariDasha(moon_long, self.birth_dt)
        return dasha.get_dasha_for_date(date)
    
    def get_current_transits(self) -> Dict:
        self._ensure_chart()
        current_planets = self.ephemeris.get_current_transits()
        analyzer = TransitAnalyzer(self._planets, self.ascendant_rashi)
        return analyzer.get_current_transit_summary(current_planets)
    
    def get_transit_positions(self, date: datetime = None) -> Dict[str, Dict]:
        """Where every planet is now (or on `date`, UTC), keyed by planet, each with
        its house counted from this chart's lagna and from the natal Moon.

        get_current_transits() returns the transit ANALYSIS — {transit_analysis,
        sade_sati, jupiter_transit, double_transit, overall_period} — and most of
        its readers wanted positions: they read it as {Moon: {rashi_name}}, found
        nothing, and wrote "Moon in  ()" into the daily readings. This is the flat
        map they meant. Each entry is the ephemeris record (rashi, rashi_name,
        nakshatra_name, longitude, speed, retrograde, …) plus the two houses."""
        self._ensure_chart()
        raw = (self.ephemeris.get_transits_for_date(date) if date is not None
               else self.ephemeris.get_current_transits()) or {}
        asc = self.ascendant_rashi
        moon = (self._planets.get('Moon') or {}).get('rashi')
        out: Dict[str, Dict] = {}
        for name, d in raw.items():
            if not isinstance(d, dict):
                continue
            r = d.get('rashi')
            entry = dict(d)
            if isinstance(r, int):
                entry['house'] = ((r - asc) % 12) + 1
                if isinstance(moon, int):
                    entry['house_from_moon'] = ((r - moon) % 12) + 1
            out[name] = entry
        return out

    def get_transit_for_date(self, date: datetime) -> Dict:
        self._ensure_chart()
        transit_planets = self.ephemeris.get_transits_for_date(date)
        analyzer = TransitAnalyzer(self._planets, self.ascendant_rashi)
        return analyzer.get_current_transit_summary(transit_planets)
    
    def check_sade_sati(self) -> Dict:
        self._ensure_chart()
        current_planets = self.ephemeris.get_current_transits()
        saturn_rashi = current_planets['Saturn']['rashi']
        analyzer = TransitAnalyzer(self._planets, self.ascendant_rashi)
        return analyzer.analyze_sade_sati(saturn_rashi)
    
    def get_jaimini_karakas(self) -> Dict:
        self._ensure_chart()
        calculator = JaiminiKarakas(self._planets, include_rahu=True)
        return calculator.get_all_karakas()
    
    def get_arudha_padas(self) -> Dict:
        self._ensure_chart()
        calculator = ArudhaPada(self._planets, self.ascendant_rashi)
        return calculator.calculate_all_arudhas()
    
    def get_karakamsa(self) -> Dict:
        self._ensure_chart()
        asc_long = self._ascendant['longitude']
        nav_asc = DivisionalCharts.calculate_d9(asc_long)
        calculator = JaiminiKarakas(self._planets, include_rahu=True)
        return calculator.analyze_karakamsa(nav_asc)
    
    def get_kp_analysis(self) -> Dict:
        self._ensure_chart()
        kp = KPSystem(self._planets)
        planet_sublords = {}
        for planet, data in self._planets.items():
            planet_sublords[planet] = kp.get_sub_lord(data['longitude'])
        return {'planet_sublords': planet_sublords}
    
    def get_kp_significators(self, house: int) -> Dict:
        self._ensure_chart()
        kp = KPSystem(self._planets)
        return kp.get_house_significators(house)
    
    def match_compatibility(self, partner_moon_longitude: float) -> Dict:
        self._ensure_chart()
        my_moon = self._planets['Moon']['longitude']
        match = AshtakootaMatch(my_moon, partner_moon_longitude)
        return match.calculate_total()
    
    def check_manglik(self) -> Dict:
        self._ensure_chart()
        weekday = self.birth_dt.weekday()
        analyzer = ManglikAnalysis(self._planets, self.ascendant_rashi, weekday)
        return analyzer.full_analysis()
    
    def _local_utc_offset(self, date: datetime = None):
        """(local, utc, offset_hours) for a moment at the chart's place. No date → now.
        A given date is read as LOCAL time there; the ephemeris wants UT, and reading
        the two as one shifted every tithi and nakshatra boundary by the zone offset.

        The offset is the one in force AT THAT MOMENT, from the place's zone. It was
        the offset at birth, which is right in India and an hour out for half of
        every year anywhere that keeps summer time."""
        from datetime import timedelta
        tz = None
        try:
            import pytz
            if getattr(self, 'tz_name', None):
                tz = pytz.timezone(self.tz_name)
        except Exception:
            tz = None
        if date is None:
            utc = datetime.utcnow()
            if tz is not None:
                try:
                    import pytz
                    loc = pytz.utc.localize(utc).astimezone(tz)
                    return loc.replace(tzinfo=None), utc, loc.utcoffset().total_seconds() / 3600
                except Exception:
                    pass
            off = float(self.tz_offset or 0)
            return utc + timedelta(hours=off), utc, off
        local = date.replace(tzinfo=None) if date.tzinfo else date
        off = float(self.tz_offset or 0)
        if tz is not None:
            for is_dst in (None, False):
                try:
                    off = tz.localize(local, is_dst=is_dst).utcoffset().total_seconds() / 3600
                    break
                except Exception:
                    continue
        return local, local - timedelta(hours=off), off

    def local_now(self) -> datetime:
        """Now, on the clock at the chart's place (DST-aware). Every "today" and
        "this hour" reading takes its time from here, not from the server."""
        return self._local_utc_offset(None)[0]

    def _local_and_utc(self, date: datetime = None):
        """(local, utc) for a moment at the chart's place — see _local_utc_offset."""
        local, utc, _ = self._local_utc_offset(date)
        return local, utc

    def _local_sun(self, date: datetime = None):
        """(local, sunrise, sunset) at the chart's place, on its real sunrise and sunset."""
        from .muhurta.suntimes import sun_times
        local, _, off = self._local_utc_offset(date)
        st = sun_times(local, self.latitude, self.longitude, off)
        return local, st['sunrise'], st['sunset']

    def get_panchanga(self, date: datetime = None) -> Dict:
        local, utc = self._local_and_utc(date)
        planets = self.ephemeris.get_transits_for_date(utc)
        sun_long = planets['Sun']['longitude']
        moon_long = planets['Moon']['longitude']
        panchanga = Panchanga(sun_long, moon_long, local)
        return panchanga.get_full_panchanga()

    def get_muhurta(self, date: datetime = None) -> Dict:
        """The day's hours at the chart's place, on the REAL sunrise and sunset there
        (muhurta/suntimes.py). Every period is an eighth of that span."""
        local, sunrise, sunset = self._local_sun(date)
        muhurta = Muhurta(local, sunrise, sunset)
        return muhurta.get_all_muhurtas()

    def predict_event(self, event: str, months_ahead: int = 24) -> Dict:
        """Predict timing for a life event (marriage, career, etc)."""
        self._ensure_chart()
        te = TimingEngine(self)
        return te.predict_event_timing(event)

    def scan_all_predictions(self) -> Dict:
        """Scan all major life events ranked by probability."""
        self._ensure_chart()
        te = TimingEngine(self)
        return te.scan_all_events()

    def get_period_analysis(self, months: int = 3) -> Dict:
        """What themes dominate the next N months."""
        self._ensure_chart()
        te = TimingEngine(self)
        return te.get_period_analysis(months)

    def get_varshaphal(self, year: int) -> Dict:
        """Get complete annual horoscope (Varshaphal) for a given year."""
        self._ensure_chart()
        vp = Varshaphal(self, year)
        return vp.generate_full_varshaphal()

    def get_annual_prediction(self, year: int) -> Dict:
        """Quick annual prediction — overall rating + key factors."""
        result = self.get_varshaphal(year)
        return {
            "year": year,
            "rating": result["overall"]["rating"],
            "score": result["overall"]["score"],
            "summary": result["overall"]["summary"],
            "year_lord": result["year_lord"]["planet"],
            "year_lord_strength": result["year_lord"]["strength"],
            "muntha_house": result["muntha"]["house"],
            "muntha_strength": result["muntha"]["strength"],
            "tajika_yogas_count": len(result["tajika_yogas"]),
        }













    def get_ashtakavarga_transits(self) -> Dict:
        """Personalized transit scoring using Ashtakavarga bindus."""
        self._ensure_chart()
        return AshtakavargaTransit(self).score_all_current_transits()

    def get_future_transits(self, months: int = 24) -> Dict:
        """Find when major planets change signs in next N months."""
        self._ensure_chart()
        return FutureTransitCalculator(self).find_all_major_transits(months)

    def get_yoga_timing(self) -> list:
        """When does each yoga activate based on dasha."""
        self._ensure_chart()
        return YogaTiming(self).time_yogas()

    def get_pratyantar_dasha(self) -> Dict:
        """3rd level dasha — narrows timing to weeks."""
        self._ensure_chart()
        return PratyantarDasha(self).calculate_pratyantar()

    def get_transit_aspects(self) -> list:
        """Transit planet aspects on natal planets."""
        self._ensure_chart()
        return TransitNatalAspects(self).check_aspects()

    def get_weekly_forecast(self) -> Dict:
        """7-day personalized prediction."""
        self._ensure_chart()
        return WeeklyForecast(self).generate_weekly()

    def get_shadbala_complete(self) -> Dict:
        """Full 6-fold planetary strength."""
        self._ensure_chart()
        return ShadbalaComplete(self).calculate_all()

    def get_natal_retrogrades(self) -> Dict:
        """Past-life karma from natal retrograde planets."""
        self._ensure_chart()
        return RetrogradeNatal(self).analyze()

    def get_pushkara(self) -> Dict:
        """Pushkara Navamsa and Bhaga lucky degrees."""
        self._ensure_chart()
        return PushkaraAnalysis(self).check_pushkara()

    def get_eclipse_calendar(self) -> Dict:
        """Upcoming eclipses and personal impact."""
        self._ensure_chart()
        return EclipseCalendar(self).generate_eclipse_report()
    def get_vastu(self) -> Dict:
        """Vastu Shastra — lucky directions based on chart."""
        self._ensure_chart()
        return VastuAnalysis(self).generate_vastu_report()

    def get_chakra_analysis(self) -> Dict:
        """Chakra mapping — blocked/overactive energy centers."""
        self._ensure_chart()
        return ChakraAnalysis(self).analyze_chakras()

    # ═══════════════════════════════════════════════════════════════
    # MANDALA SYSTEM — Geodetic / Locational Astrology
    # ═══════════════════════════════════════════════════════════════

    def get_power_map(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_power_map()

    def get_best_cities(self, purpose: str = 'overall') -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_best_cities(purpose=purpose)

    def get_here_now(self, lat: float = None, lng: float = None, city_name: str = None) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_here_now(lat=lat, lng=lng, city_name=city_name)

    def get_compass(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_compass()

    def get_relocation(self, city_name: str = None, lat: float = None, lng: float = None) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_relocation(city_name=city_name, lat=lat, lng=lng)

    def get_travel_windows(self, months: int = 6, purpose: str = 'general') -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_travel_windows(months=months, purpose=purpose)

    def get_local_space(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_local_space()

    def get_active_direction(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_active_direction()

    def get_geodetic_zodiac(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_geodetic_zodiac()

    def get_parans(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_parans()

    def get_sacred_sites(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_sacred_sites()

    def get_eclipse_geography(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_eclipse_geography()

    def get_migration_roadmap(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_migration_roadmap()

    def get_time_place_score(self, city_name: str) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_time_place_score(city_name)

    def get_danger_zones(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_danger_zones()

    def get_relationship_geography(self) -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).get_relationship_geography()

    def scan_globe(self, resolution: int = 5, purpose: str = 'overall') -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).scan_globe(resolution=resolution, purpose=purpose)

    def scan_region(self, lat_min: float, lat_max: float, lng_min: float, lng_max: float,
                    resolution: float = 1, purpose: str = 'overall') -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).scan_region(lat_min, lat_max, lng_min, lng_max, resolution, purpose)

    def analyze_any_point(self, lat: float, lng: float, name: str = '') -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).analyze_any_point(lat, lng, name)

    def get_location_weather(self, city_name=None, country_key=None):
        self._ensure_chart()
        return MandalaEngine(self).get_location_weather(city_name=city_name, country_key=country_key)

    def get_country_year(self, country_key=None, year=None):
        self._ensure_chart()
        return MandalaEngine(self).get_country_year(country_key=country_key, year=year)

    def get_personal_mundane(self, city_name=None):
        self._ensure_chart()
        return MandalaEngine(self).get_personal_mundane(city_name=city_name)

    def analyze_coordinate_mundane(self, lat: float, lng: float, name: str = '') -> Dict:
        self._ensure_chart()
        return MandalaEngine(self).analyze_coordinate_mundane(lat, lng, name)


    def get_career_aptitude(self) -> Dict:
        """Career aptitude percentages across 14 fields."""
        self._ensure_chart()
        return CareerAptitude(self).calculate_aptitude()

    def get_daily_ritual(self) -> Dict:
        """Personalized daily ritual for today."""
        self._ensure_chart()
        return DailyRitual(self).get_daily_ritual()

    def get_biorhythm(self) -> Dict:
        """Physical/emotional/intellectual biorhythm cycles."""
        from datetime import date as dt_date
        bd = self.birth_dt
        return Biorhythm(dt_date(bd.year, bd.month, bd.day)).calculate()
    def get_numerology(self, name: str = '') -> Dict:
        """Complete numerology report from birth date + optional name."""
        from datetime import date as dt_date
        bd = self.birth_dt
        ne = NumerologyEngine(name, dt_date(bd.year, bd.month, bd.day))
        return ne.generate_full_report()

    def get_name_numerology(self, name: str) -> Dict:
        """Analyze name vibration (Chaldean + Pythagorean)."""
        from datetime import date as dt_date
        bd = self.birth_dt
        ne = NumerologyEngine(name, dt_date(bd.year, bd.month, bd.day))
        return {'namank': ne.get_namank(), 'correction': ne.suggest_name_correction()}

    def get_personal_day(self) -> Dict:
        """What number rules today for this person."""
        from datetime import date as dt_date
        bd = self.birth_dt
        ne = NumerologyEngine(birth_date=dt_date(bd.year, bd.month, bd.day))
        return {'year': ne.get_personal_year(), 'month': ne.get_personal_month(), 'day': ne.get_personal_day()}
    def find_muhurta(self, event: str = 'general', days: int = 90) -> Dict:
        """Find best auspicious dates for an event."""
        ms = MuhurtaSelector(self.latitude, self.longitude)
        return ms.find_auspicious_dates(event, days)

    def get_life_timeline(self, years: int = 5) -> Dict:
        """5-year life prediction combining all systems."""
        self._ensure_chart()
        return LifeTimeline(self).generate_timeline(years)

    def get_chart_strength(self) -> Dict:
        """Single 0-100 chart strength score."""
        self._ensure_chart()
        return ChartStrength(self).calculate()

    def validate_event(self, event: str) -> Dict:
        """Cross-system confidence for an event prediction."""
        self._ensure_chart()
        return CrossSystemConfidence(self).validate_event(event)

    def get_baby_names(self, gender: str = 'both') -> Dict:
        """Baby name suggestions based on Moon nakshatra pada."""
        self._ensure_chart()
        nak = self._planets.get('Moon', {}).get('nakshatra_name', '')
        pada = self._planets.get('Moon', {}).get('pada', 1)
        return BabyNameGenerator(nak, pada).generate(gender)

    def get_synastry(self, other_engine) -> Dict:
        """Deep compatibility between two charts."""
        self._ensure_chart()
        return Synastry(self, other_engine).generate_synastry()

    def get_planetary_returns(self) -> Dict:
        """Track Saturn/Jupiter/Rahu returns — life-changing periods."""
        self._ensure_chart()
        return PlanetaryReturns(self).get_all_returns()
    def get_kalachakra_dasha(self) -> Dict:
        """Kalachakra Dasha — most complex timing system."""
        self._ensure_chart()
        kc = KalachakraDasha(self._planets['Moon']['longitude'], self.birth_dt)
        return kc.get_current_dasha()

    def get_narayana_dasha(self) -> Dict:
        """Narayana Dasha — Jaimini sign-based (K.N. Rao school)."""
        self._ensure_chart()
        nd = NarayanaDasha(self._planets, self.ascendant_rashi, self.birth_dt)
        return nd.get_current_dasha()

    def get_argala(self) -> Dict:
        """Argala — Jaimini planetary intervention analysis."""
        self._ensure_chart()
        return ArgalaAnalysis(self._planets, self.ascendant_rashi).analyze_all_houses()

    def get_sarvatobhadra(self) -> Dict:
        """Sarvatobhadra Chakra — nakshatra vedha from transits."""
        self._ensure_chart()
        transit = self.ephemeris.get_current_transits()
        return SarvatobhadraChakra(self._planets).analyze_current_vedhas(transit)

    def get_ishta_kashta(self) -> Dict:
        """Ishta/Kashta Phala — benefic/malefic strength per planet."""
        self._ensure_chart()
        return IshtaKashta(self._planets, self.ascendant_rashi).calculate_all()

    def get_nakshatra_profile(self) -> Dict:
        """108-pada nakshatra profile for Moon."""
        self._ensure_chart()
        np = NakshatraProfiles(self)
        return {'moon_profile': np.get_moon_pada_profile(), 'all_planets': np.get_all_planet_pada_info()}
    def get_medical_report(self) -> Dict:
        """Health vulnerabilities, longevity, maraka analysis."""
        self._ensure_chart()
        return MedicalAstrology(self).generate_medical_report()

    def get_transit_deep(self) -> Dict:
        """Deep transit analysis: gochar, sade sati, retrogrades, eclipses."""
        self._ensure_chart()
        return TransitDeep(self).generate_full_transit_report()

    def get_daily_timing(self, date: datetime = None) -> Dict:
        """Choghadiya, hora and Abhijit for now (or a LOCAL `date`) at the chart's
        place, on its real sunrise and sunset. This used the server's clock as the
        reader's local time and a 06:00 sunrise everywhere."""
        local, sunrise, sunset = self._local_sun(date)
        return TimeSystems(local, self.latitude, sunrise, sunset).generate_daily_timing()

    def get_personality(self) -> Dict:
        """Full personality profile: Moon sign, Ascendant, Nakshatra, Dasha shift."""
        self._ensure_chart()
        return PersonalityEngine(self).generate_full_personality()
    def get_sudarshana(self, current_age: int = None) -> Dict:
        """Get Sudarshana Chakra triple-ring analysis."""
        self._ensure_chart()
        sc = SudarshanChakra(self._planets, self.ascendant_rashi)
        if current_age:
            return sc.get_life_overview(current_age)
        return sc.get_full_cycle()

    def get_varga_analysis(self) -> Dict:
        """Deep analysis of all key divisional charts (D3,D7,D9,D10,D12,D24)."""
        self._ensure_chart()
        va = VargaAnalysis(self)
        return va.generate_full_varga_analysis()

    def get_navamsa_analysis(self) -> Dict:
        """Detailed D9 Navamsa analysis for marriage."""
        self._ensure_chart()
        va = VargaAnalysis(self)
        return va.analyze_navamsa()

    def get_career_analysis(self) -> Dict:
        """Detailed D10 Dasamsa career analysis."""
        self._ensure_chart()
        va = VargaAnalysis(self)
        return va.analyze_dasamsa()
    def get_kp_complete(self) -> Dict:
        """Get complete KP analysis with Placidus cusps and significators."""
        self._ensure_chart()
        kp = KPComplete(self)
        return kp.generate_full_kp_report()

    def kp_event_analysis(self, event: str) -> Dict:
        """KP analysis for specific event (marriage, career, etc)."""
        self._ensure_chart()
        kp = KPComplete(self)
        return kp.analyze_event_kp(event)

    def kp_verify_event(self, event: str) -> Dict:
        """Verify event using KP + Ruling Planets."""
        self._ensure_chart()
        kp = KPComplete(self)
        return kp.verify_event_with_rp(event)
    def get_nadi_reading(self) -> Dict:
        """Get Bhrigu Nandi Nadi reading — supernaturally specific predictions."""
        self._ensure_chart()
        nadi = BhriguNandiNadi(self)
        return nadi.generate_full_nadi_report()
    def cast_prashna(self, category: str = 'general') -> Dict:
        """Cast Prashna chart using user's location. No birth data needed for chart — uses current time."""
        from datetime import datetime as dt
        pk = PrashnaKundli(dt.utcnow(), self.latitude, self.longitude)
        return pk.generate_full_prashna(category)
    def get_chara_dasha(self) -> Dict:
        """Get current Chara Dasha (Jaimini sign-based timing)."""
        self._ensure_chart()
        cd = CharaDasha(self._planets, self.ascendant_rashi, self.birth_dt)
        return cd.get_current_dasha()

    def get_chara_dasha_analysis(self) -> Dict:
        """Deep analysis of current Chara Dasha period."""
        self._ensure_chart()
        cd = CharaDasha(self._planets, self.ascendant_rashi, self.birth_dt)
        return cd.analyze_current_period()

    def cross_validate_dashas(self) -> Dict:
        """Cross-validate Vimshottari and Chara Dasha for confidence scoring."""
        self._ensure_chart()
        vim = self.get_vimshottari_dasha()
        cd = CharaDasha(self._planets, self.ascendant_rashi, self.birth_dt)
        return cd.cross_validate_with_vimshottari(vim)
    def get_remedies(self) -> Dict:
        """Get complete personalized remedies (gemstones, mantras, rituals)."""
        self._ensure_chart()
        re = RemediesEngine(self)
        return re.generate_full_remedies()

    def get_gemstone_recommendations(self) -> list:
        """Get gemstone recommendations only."""
        self._ensure_chart()
        re = RemediesEngine(self)
        return re.recommend_gemstones()
    def get_bhava_chalit(self) -> Dict:
        """Get Bhava Chalit (cusp-based) chart with shift analysis."""
        self._ensure_chart()
        bc = BhavaChalit(self._planets, self._ascendant)
        return bc.generate_bhava_chalit()

    def get_bhava_strengths(self) -> Dict:
        """Get planet strength by Bhava position (Madhya vs Sandhi)."""
        self._ensure_chart()
        bc = BhavaChalit(self._planets, self._ascendant)
        return bc.all_planet_bhava_strengths()


    def query_time(self, target_date: str, end_date: str = None) -> Dict:
        """Query any date or period. Format: YYYY-MM-DD."""
        self._ensure_chart()
        from datetime import datetime as dt
        start = dt.strptime(target_date, '%Y-%m-%d')
        tq = TimeQueryEngine(self)
        if end_date:
            end = dt.strptime(end_date, '%Y-%m-%d')
            return tq.query_period(start, end)
        return tq.query_date(start)

    def query_month(self, year: int, month: int) -> Dict:
        """Query a specific month."""
        self._ensure_chart()
        return TimeQueryEngine(self).query_month(year, month)

    def query_year_detailed(self, year: int) -> Dict:
        """Month-by-month analysis of a year."""
        self._ensure_chart()
        return TimeQueryEngine(self).query_year(year)

    def get_realtime_dashboard(self) -> Dict:
        """Complete snapshot of this moment for this person."""
        self._ensure_chart()
        return RealtimeDashboard(self).snapshot()

    def explain_past_event(self, event_date: str, event_type: str, desc: str = '') -> Dict:
        """Why did a past event happen? Reverse astrology."""
        self._ensure_chart()
        return PastEventExplainer(self).explain_event(event_date, event_type, desc)

    def validate_life_events(self, events: list) -> Dict:
        """Validate multiple past events against astrology."""
        self._ensure_chart()
        return PastEventExplainer(self).validate_life_events(events)

    def analyze_hour(self, target_dt: str, activity: str = 'general') -> Dict:
        """Hour-level analysis. Format: YYYY-MM-DD HH:MM."""
        self._ensure_chart()
        from datetime import datetime as dt
        t = dt.strptime(target_dt, '%Y-%m-%d %H:%M')
        return HourQuery(self).analyze_hour(t, activity)

    def analyze_location(self, city: str, lat: float = None, lng: float = None) -> Dict:
        """Relocation chart for a city."""
        self._ensure_chart()
        return LocationAnalysis(self).analyze_city(city, lat, lng)

    def compare_locations(self, cities: list = None) -> Dict:
        """Compare multiple cities."""
        self._ensure_chart()
        return LocationAnalysis(self).compare_cities(cities)

    def get_dynamic_remedies(self) -> Dict:
        """Transit-aware remedies that change monthly."""
        self._ensure_chart()
        return DynamicRemedies(self).get_current_remedies()

    def get_lucky_numbers(self) -> Dict:
        """Lucky phone/car/house numbers."""
        self._ensure_chart()
        return LuckyNumberFinder(self).find_lucky()

    def get_dynamic_mantra(self) -> Dict:
        """Best mantra RIGHT NOW based on hora + dasha."""
        self._ensure_chart()
        return DynamicMantra(self).get_current_mantra()

    def get_color_metal_food(self) -> Dict:
        """What to wear, eat, use today."""
        self._ensure_chart()
        return ColorMetalFood(self).get_today()

    def get_classical_analysis(self, event: str = None) -> Dict:
        """Classical text-based life event analysis. Every rule from BPHS/Phaladeepika. No invented scores."""
        self._ensure_chart()
        try:
            cr = ClassicalRules(self)
            if event:
                event_map = {"childbirth": "children", "travel_foreign": "foreign", "health_issue": "health"}
                mapped = event_map.get(event, event)
                result = cr.evaluate(mapped)
                return result
            else:
                events = ["marriage", "children", "wealth", "career", "spiritual", "health",
                          "foreign", "property", "education", "longevity", "father", "mother",
                          "siblings", "business", "love", "fame"]
                results = {}
                for ev in events:
                    r = cr.evaluate(ev)
                    results[ev] = {"summary": r["summary"], "rules_fired": r["rules_fired"],
                                   "supports": len(r["supports"]), "opposes": len(r["opposes"]),
                                   "denials": r["denial_count"],
                                   "top_rules": [rule["text"] for rule in r["supports"][:3]] + [rule["text"] for rule in r["opposes"][:2]]}
                return {"type": "full_life_reading", "events": results}
        except Exception as e:
            return {"error": str(e)[:200]}

    def get_chart_promise(self, event: str = None) -> Dict:
        """Lifetime promise — does chart support this event ever?"""
        self._ensure_chart()
        cp = ChartPromise(self)
        if event:
            return cp.evaluate(event)
        return cp.evaluate_all()

    def generate_complete_chart(self) -> Dict:
        self._ensure_chart()
        return {
            'birth_details': {
                'datetime': self.birth_dt.isoformat(),
                'latitude': self.latitude,
                'longitude': self.longitude,
                'ayanamsa': self.ayanamsa,
            },
            'chart': self._chart,
            'ascendant': self._ascendant,
            'planets': self._planets,
            'dignity': self.get_planetary_dignity(),
            'navamsa': self.get_navamsa_chart(),
        }
    
    def generate_full_analysis(self) -> Dict:
        self._ensure_chart()
        return {
            'chart': self.generate_complete_chart(),
            'yogas': self.get_yogas(),
            'dasha': self.get_vimshottari_dasha(),
            'shadbala': self.get_shadbala(),
            'ashtakavarga': self.get_ashtakavarga(),
            'jaimini': {
                'karakas': self.get_jaimini_karakas(),
                'arudhas': self.get_arudha_padas(),
            },
            'transits': self.get_current_transits(),
            'manglik': self.check_manglik(),
        }
    
    def get_prediction_data(self) -> Dict:
        self._ensure_chart()
        return {
            'ascendant': {
                'rashi': self._ascendant['rashi_name'],
                'nakshatra': self._ascendant['nakshatra_name'],
            },
            'moon': {
                'rashi': self._planets['Moon']['rashi_name'],
                'nakshatra': self._planets['Moon']['nakshatra_name'],
                'house': self._planets['Moon']['house'],
            },
            'sun': {
                'rashi': self._planets['Sun']['rashi_name'],
                'house': self._planets['Sun']['house'],
            },
            'current_dasha': self.get_vimshottari_dasha(),
            'yogas_summary': self.get_yogas()['summary'],
            'strong_yogas': self.get_yogas()['highlights'][:3],
            'transits': self.get_current_transits()['overall_period'],
            'sade_sati': self.check_sade_sati()['is_sade_sati'],
        }

    def get_hora_notification(self) -> Dict:
        """Get personalized notification based on current hora + chart."""
        self._ensure_chart()
        return generate_notification(self)

    def get_current_hora_info(self) -> Dict:
        """What planetary hora is active right now at the chart's place."""
        local, sunrise, sunset = self._local_sun(None)
        return get_current_hora(self.latitude, self.longitude, now=local, sunrise=sunrise, sunset=sunset)

    def get_next_hora(self, planet: str) -> Dict:
        """When is the next hora for a specific planet, at the chart's place."""
        local, sunrise, sunset = self._local_sun(None)
        return get_next_favorable_hora(planet, now=local, sunrise=sunrise, sunset=sunset)

    def cast_prashna_refined(self, category: str = "general") -> Dict:
        """Refined Prashna with classical Ashtamangala rules and yes/no verdict."""
        self._ensure_chart()
        from datetime import datetime as dt
        from .prashna.prashna import PrashnaKundli
        pk = PrashnaKundli(dt.utcnow(), self.latitude, self.longitude)
        # Use a JyotishEngine for the prashna moment
        from .jyotish_engine import JyotishEngine
        prashna_engine = JyotishEngine(dt.now(), self.latitude, self.longitude)
        refined = PrashnaRefined(prashna_engine, category)
        basic = pk.generate_full_prashna(category)
        refinement = refined.refine()
        return {
            "basic_prashna": basic,
            "refined_verdict": refinement,
        }

    def get_tithi_pravesh(self, year: int = None) -> Dict:
        """Tithi Pravesh annual chart — second opinion on the year ahead."""
        self._ensure_chart()
        y = year or datetime.now().year
        return TithiPravesh(self, y).generate_annual_chart()

    def get_composite_chart(self, other_engine) -> Dict:
        """Composite (midpoint) chart for a relationship."""
        self._ensure_chart()
        return CompositeChart(self, other_engine).generate_composite_report()

    def get_transit_calendar(self, months: int = 6) -> Dict:
        """Personal transit calendar with dates and impact scores."""
        self._ensure_chart()
        return TransitCalendar(self).generate_calendar(months)

    def get_vedha(self) -> Dict:
        """Check vedha obstruction on current transits."""
        self._ensure_chart()
        current = self.ephemeris.get_current_transits()
        moon_rashi = self._planets["Moon"]["rashi"]
        return check_vedha(current, moon_rashi)

    def get_combustion(self) -> Dict:
        """Check all planets for combustion with the Sun."""
        self._ensure_chart()
        return analyze_combustion(self._planets)

    def get_gandanta(self) -> Dict:
        """Check all planets for Gandanta (karmic knot) placement."""
        self._ensure_chart()
        return analyze_gandanta(self._planets)

    # ═══════════════════════════════════════════════════════════════
    # BPHS COMPLETION — 15 remaining classical features
    # ═══════════════════════════════════════════════════════════════

    def get_avasthas(self):
        """BPHS Ch45: All 4 types of planetary avasthas."""
        dignity = self.get_planetary_dignity()
        return calculate_all_avasthas(self.planets, dignity)

    def get_vimshopaka(self, scheme='shodashavarga'):
        """BPHS Ch16: 20-point divisional chart strength."""
        return calculate_vimshopaka(self.planets, scheme)

    def get_graha_yuddha(self):
        """BPHS Ch17: Planetary war detection."""
        return calculate_graha_yuddha(self.planets)

    def get_nabhasa_yogas(self):
        """BPHS Ch34: 32 pattern-based yogas."""
        return calculate_nabhasa_yogas(self.planets)

    def get_sannyasa_yogas(self):
        """BPHS Ch36: Renunciation and spiritual seeker yogas."""
        asc_rashi = self.planets.get('Ascendant', {}).get('rashi', 0)
        return calculate_sannyasa_yogas(self.planets, asc_rashi)

    def get_maraka(self):
        """BPHS Ch44: Death-inflicting planet analysis."""
        asc_rashi = self.planets.get('Ascendant', {}).get('rashi', 0)
        return calculate_maraka(self.planets, asc_rashi)

    def get_av_sodhana(self):
        """BPHS Ch43: Ashtakavarga reduction (Trikona + Ekadhipati)."""
        av = self.get_ashtakavarga()
        return calculate_sodhana_for_all(av)

    def get_prastara_av(self):
        """BPHS Ch43: Individual planet contribution tables."""
        return calculate_prastara(self.planets)

    def get_shodhya_pinda(self):
        """BPHS Ch43: Numerical strength from reduced AV."""
        sodhita = self.get_av_sodhana()
        return calculate_shodhya_pinda(sodhita, self.planets)

    def get_dasha_sandhi(self):
        """BPHS Ch40: Dasha junction/chidra period analysis."""
        from datetime import datetime as dt_class
        dasha = self.get_dasha_for_date(dt_class.now())
        return calculate_dasha_sandhi(dasha)

    def get_rashi_drishti(self):
        """BPHS Ch28: Sign-based aspects."""
        return calculate_rashi_drishti(self.planets)

    # ═══════════════════════════════════════════════════════════════
    # WESTERN ASTROLOGY (Tropical)
    # ═══════════════════════════════════════════════════════════════

    def get_western_chart(self) -> Dict:
        """Complete Western (tropical) chart with aspects, configurations, elements."""
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return wc.generate_full_report()

    def get_western_big_three(self) -> Dict:
        """Sun sign, Moon sign, Rising sign (Western/tropical)."""
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return wc.get_big_three()

    def get_western_aspects(self) -> list:
        """All natal aspects in the tropical chart."""
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return wc.get_aspects()

    def get_western_configurations(self) -> list:
        """Major configurations: Grand Trine, T-Square, Yod, Stellium."""
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return wc.get_configurations()

    def get_western_transits(self) -> list:
        """Current outer planet transits to natal chart (Western)."""
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return wc.get_current_transits()

    def get_western_profile(self) -> Dict:
        """Full Western personality profile."""
        from .western.chart import WesternChart
        from .western.profiles import WesternProfiles
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return WesternProfiles(wc).get_full_profile()

    def get_western_compatibility(self, other_engine) -> Dict:
        """Western synastry with another chart."""
        from .western.chart import WesternChart
        from .western.compatibility import WesternCompatibility
        wc1 = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc2 = WesternChart(other_engine.birth_dt, other_engine.latitude, other_engine.longitude)
        return WesternCompatibility(wc1, wc2).generate_synastry_report()

    def get_western_progressions(self) -> Dict:
        """Secondary Progressions — day-for-a-year inner development."""
        from .western.chart import WesternChart
        from .western.timing import SecondaryProgressions
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return SecondaryProgressions(wc).get_progressed_chart()

    def get_western_solar_return(self, year: int = None) -> Dict:
        """Solar Return — theme of a specific year."""
        from .western.chart import WesternChart
        from .western.timing import SolarReturn
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return SolarReturn(wc, year).generate_solar_return()

    def get_western_solar_arc(self) -> Dict:
        """Solar Arc Directions — ~1° per year timing."""
        from .western.chart import WesternChart
        from .western.timing import SolarArcDirections
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return SolarArcDirections(wc).get_solar_arc()

    def get_western_lilith(self) -> Dict:
        """Black Moon Lilith — shadow self."""
        from .western.extras import calculate_lilith
        return calculate_lilith(self.birth_dt)

    def get_western_fortune(self) -> Dict:
        """Part of Fortune — where abundance flows."""
        from .western.chart import WesternChart
        from .western.extras import calculate_part_of_fortune
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        is_night = wc.planets['Sun'].get('house', 1) > 6
        return calculate_part_of_fortune(wc._ascendant, wc.planets['Sun']['longitude'],
                                          wc.planets['Moon']['longitude'], is_night)

    def get_western_fixed_stars(self) -> list:
        """Fixed star conjunctions with natal planets."""
        from .western.chart import WesternChart
        from .western.extras import check_fixed_star_conjunctions
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        return check_fixed_star_conjunctions(wc.planets)

    def get_western_void_moon(self) -> Dict:
        """Is the Moon void of course right now?"""
        from .western.chart import WesternChart
        from .western.extras import check_void_of_course
        wc = WesternChart(datetime.now(), self.latitude, self.longitude)
        wc._ensure_calculated()
        return check_void_of_course(wc.planets['Moon']['longitude'], wc.planets)

    def get_western_composite(self, other_engine) -> Dict:
        """Composite (midpoint) chart for a relationship."""
        from .western.chart import WesternChart
        from .western.extras import calculate_composite
        wc1 = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc2 = WesternChart(other_engine.birth_dt, other_engine.latitude, other_engine.longitude)
        return calculate_composite(wc1, wc2)

    def get_western_mutual_receptions(self) -> list:
        """Find mutual receptions — hidden planet alliances."""
        from .western.chart import WesternChart
        from .western.extras import find_mutual_receptions
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        return find_mutual_receptions(wc.planets)

    def get_western_retrograde_stations(self) -> list:
        """Check for stationary planets at birth — extremely powerful."""
        from .western.chart import WesternChart
        from .western.extras import check_retrograde_stations
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        return check_retrograde_stations(self.birth_dt, wc.planets)

    def get_western_lunar_return(self, month: int = None, year: int = None) -> Dict:
        """Lunar Return — monthly emotional theme."""
        from .western.chart import WesternChart
        from .western.extras import calculate_lunar_return
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        natal_moon = wc.planets['Moon']['longitude']
        return calculate_lunar_return(natal_moon, self.latitude, self.longitude, month, year)

    def get_western_profections(self) -> Dict:
        """Annual Profections — activated house by age."""
        from .western.hellenistic import calculate_profections_with_chart
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        asc_idx = int(wc._ascendant / 30)
        return calculate_profections_with_chart(self.birth_dt, asc_idx)

    def get_western_sect(self) -> Dict:
        """Sect — day/night chart benefic/malefic recalculation."""
        from .western.hellenistic import calculate_sect
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        sun_h = wc.planets['Sun'].get('house', 1)
        return calculate_sect(sun_h, wc.planets)

    def get_western_arabic_parts(self) -> Dict:
        """20 Arabic Parts/Lots."""
        from .western.hellenistic import calculate_arabic_parts
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        is_night = wc.planets['Sun'].get('house', 1) > 6
        return calculate_arabic_parts(wc._ascendant, wc.planets, is_night)

    def get_western_zodiacal_releasing(self) -> Dict:
        """Zodiacal Releasing from Lot of Fortune."""
        from .western.hellenistic import calculate_zodiacal_releasing
        from .western.extras import calculate_part_of_fortune
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        is_night = wc.planets['Sun'].get('house', 1) > 6
        pof = calculate_part_of_fortune(wc._ascendant, wc.planets['Sun']['longitude'],
                                         wc.planets['Moon']['longitude'], is_night)
        return calculate_zodiacal_releasing(pof['sign'], self.birth_dt)

    def get_western_antiscia(self) -> Dict:
        """Antiscia and Contra-antiscia — hidden planet connections."""
        from .western.hellenistic import calculate_antiscia
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        return calculate_antiscia(wc.planets)

    def get_western_midpoints(self) -> Dict:
        """All midpoints with activations (Cosmobiology)."""
        from .western.midpoints import calculate_all_midpoints, find_midpoint_activations
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        mps = calculate_all_midpoints(wc.planets)
        acts = find_midpoint_activations(mps, wc.planets)
        return {'midpoints': mps, 'activations': acts}

    def get_western_harmonics(self) -> Dict:
        """Harmonic charts — H5 (talent), H7 (inspiration), H9 (spiritual)."""
        from .western.midpoints import get_key_harmonics
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        return get_key_harmonics(wc.planets)

    def get_western_horary(self, question: str = "", category: str = "general") -> Dict:
        """Western Horary — Lilly's method."""
        from .western.hellenistic import western_horary_judgment
        from .western.chart import WesternChart
        now = datetime.now()
        qc = WesternChart(now, self.latitude, self.longitude)
        report = qc.generate_full_report()
        return western_horary_judgment(report, question, category)

    # ═══════════════════════════════════════════════════════════════
    # JAIMINI COMPLETE
    # ═══════════════════════════════════════════════════════════════

    def get_complete_jaimini(self) -> Dict:
        """Complete Jaimini — all 12 Arudha Padas, Upapada, Swamsa, yogas."""
        from .jaimini.jaimini_complete import get_complete_jaimini
        return get_complete_jaimini(self.planets, self.ascendant_rashi)

    def get_upapada(self) -> Dict:
        """Upapada Lagna — Jaimini spouse indicator."""
        from .jaimini.jaimini_complete import calculate_upapada
        return calculate_upapada(self.planets, self.ascendant_rashi)

    def get_swamsa(self) -> Dict:
        """Swamsa — soul purpose from Atmakaraka in Navamsa."""
        from .jaimini.jaimini_complete import calculate_swamsa
        return calculate_swamsa(self.planets)

    def get_jaimini_yogas(self) -> list:
        """Jaimini-specific yogas."""
        from .jaimini.jaimini_complete import check_jaimini_yogas
        return check_jaimini_yogas(self.planets, self.ascendant_rashi)

    def get_jaimini_aspects(self) -> Dict:
        """Jaimini rashi-based aspects."""
        from .jaimini.jaimini_complete import get_jaimini_aspects
        return get_jaimini_aspects()

    # ═══════════════════════════════════════════════════════════════
    # MUHURTA COMPLETE
    # ═══════════════════════════════════════════════════════════════

    def get_muhurta_rules(self, event_type: str = "marriage") -> Dict:
        """Get muhurta rules for a specific event type (20+ types)."""
        from .muhurta.muhurta_complete import get_muhurta_rules
        return get_muhurta_rules(event_type)

    def evaluate_muhurta(self, event_type: str = "marriage") -> Dict:
        """Evaluate current moment for an event."""
        from .muhurta.muhurta_complete import evaluate_moment
        panchanga = self.get_panchanga()
        return evaluate_moment(panchanga, event_type)

    # ═══════════════════════════════════════════════════════════════
    # CHINESE ASTROLOGY (BaZi / Four Pillars)
    # ═══════════════════════════════════════════════════════════════

    def get_chinese_chart(self) -> Dict:
        """Complete Chinese BaZi (Four Pillars) report."""
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return bc.generate_report()

    def get_chinese_animal(self) -> Dict:
        """Chinese zodiac animal sign."""
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return bc.get_animal_sign()

    def get_chinese_day_master(self) -> Dict:
        """BaZi Day Master — the self element."""
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return bc.get_day_master()

    def get_chinese_elements(self) -> Dict:
        """Five element balance in BaZi chart."""
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return bc.get_element_balance()

    def get_chinese_luck_periods(self) -> list:
        """10-year luck periods (Da Yun)."""
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return bc.get_luck_periods()

    def get_chinese_profile(self) -> Dict:
        """Full Chinese astrology profile."""
        from .chinese.bazi import BaZiChart
        from .chinese.profiles import ChineseProfiles
        bc = BaZiChart(self.birth_local)
        return ChineseProfiles(bc).get_full_profile()

    def get_chinese_compatibility(self, other_engine) -> Dict:
        """Chinese zodiac compatibility with another chart."""
        from .chinese.bazi import BaZiChart
        from .chinese.profiles import ChineseCompatibility
        bc1 = BaZiChart(self.birth_local)
        bc2 = BaZiChart(other_engine.birth_local)
        return ChineseCompatibility(bc1, bc2).analyze()

    def get_chinese_interactions(self) -> Dict:
        """Branch AND stem interactions: clashes, harmonies, punishments, harms, combinations, void."""
        from .chinese.bazi import BaZiChart
        from .chinese.interactions import BranchInteractions, StemInteractions
        bc = BaZiChart(self.birth_local)
        branch = BranchInteractions(bc).analyze_all()
        stem = StemInteractions(bc).analyze_all_stems()
        return {**branch, **stem}

    def get_chinese_stars(self) -> Dict:
        """Symbolic stars: Nobleman, Peach Blossom, Traveling Horse, Academic."""
        from .chinese.bazi import BaZiChart
        from .chinese.stars import SymbolicStars
        bc = BaZiChart(self.birth_local)
        return SymbolicStars(bc).analyze_all_stars()

    def get_chinese_annual_luck(self, year: int = None) -> Dict:
        """How a specific year affects you (Liu Nian)."""
        from .chinese.bazi import BaZiChart
        from .chinese.stars import AnnualLuck
        bc = BaZiChart(self.birth_local)
        y = year or datetime.now().year
        return AnnualLuck(bc).analyze_year(y)

    def get_chinese_forecast(self, years: int = 5) -> list:
        """Multi-year annual forecast."""
        from .chinese.bazi import BaZiChart
        from .chinese.stars import AnnualLuck
        bc = BaZiChart(self.birth_local)
        return AnnualLuck(bc).forecast_years(years)

    def get_chinese_na_yin(self) -> Dict:
        """Na Yin — 60 poetic element names for all four pillars."""
        from .chinese.bazi import BaZiChart
        from .chinese.advanced import get_all_na_yin
        bc = BaZiChart(self.birth_local)
        bc._ensure_calculated()
        return get_all_na_yin(bc._pillars)

    def get_chinese_life_stages(self) -> Dict:
        """12 Life Stages (长生十二宫) for the Day Stem."""
        from .chinese.bazi import BaZiChart
        from .chinese.advanced import get_life_stages
        bc = BaZiChart(self.birth_local)
        bc._ensure_calculated()
        return get_life_stages(bc._pillars['day']['stem'])

    def get_chinese_yong_shen(self) -> Dict:
        """Yong Shen (useful god) / Ji Shen (jealous god) analysis."""
        from .chinese.bazi import BaZiChart
        from .chinese.advanced import calculate_yong_shen
        bc = BaZiChart(self.birth_local)
        dm = bc.get_day_master()
        elements = bc.get_element_balance()
        return calculate_yong_shen(dm['element'], elements['counts'], elements['day_master_strength'])

    def get_chinese_extended_stars(self) -> Dict:
        """30+ symbolic stars (extended set)."""
        from .chinese.bazi import BaZiChart
        from .chinese.advanced import get_extended_stars
        bc = BaZiChart(self.birth_local)
        bc._ensure_calculated()
        p = bc._pillars
        branches = [p[k]['branch'] for k in ['year', 'month', 'day', 'hour']]
        return get_extended_stars(p['year']['branch'], p['day']['stem'], p['day']['branch'], branches)

    def get_chinese_fan_fu_yin(self) -> Dict:
        """Fan Yin / Fu Yin — repeated or opposing pillar patterns."""
        from .chinese.bazi import BaZiChart
        from .chinese.advanced import check_fan_fu_yin
        bc = BaZiChart(self.birth_local)
        bc._ensure_calculated()
        return check_fan_fu_yin(bc._pillars)

    def get_chinese_advanced(self) -> Dict:
        """Complete Chinese advanced analysis."""
        from .chinese.bazi import BaZiChart
        from .chinese.advanced import get_complete_chinese_advanced
        bc = BaZiChart(self.birth_local)
        return get_complete_chinese_advanced(bc)

    # ═══════════════════════════════════════════════════════════════
    # KP TIMING (Transit Triggers + DBA Matching)
    # ═══════════════════════════════════════════════════════════════

    def get_kp_timing(self, event: str = "career") -> Dict:
        """Full KP timing: DBA check + transit triggers combined."""
        from .kp.kp_timing import KPTransitTiming
        return KPTransitTiming(self).get_full_timing(event)

    def get_kp_dba_scan(self) -> Dict:
        """Scan which events are active in current DBA period."""
        from .kp.kp_timing import KPTransitTiming
        return KPTransitTiming(self).scan_dba_all_events()

    def get_kp_transit_triggers(self, event: str = "career") -> list:
        """Current transit planets triggering a specific event."""
        from .kp.kp_timing import KPTransitTiming
        return KPTransitTiming(self).check_transit_triggers(event)

    def get_kp_medical(self) -> Dict:
        """KP Medical diagnosis — body part + disease tendency."""
        from .kp.kp_advanced import kp_medical_diagnosis
        return kp_medical_diagnosis(self)

    def get_kp_stellar_theory(self) -> Dict:
        """KP Stellar Theory — planet behaves as its star lord."""
        from .kp.kp_advanced import stellar_theory_analysis
        return stellar_theory_analysis(self)

    def get_kp_four_level(self, planet: str = "Moon") -> Dict:
        """4-level chain: Star → Sub → Sub-sub → Sub-sub-sub."""
        from .kp.kp_advanced import get_four_level_chain
        p_long = self.planets.get(planet, {}).get('longitude', 0)
        result = get_four_level_chain(p_long)
        result['planet'] = planet
        return result

    # ═══════════════════════════════════════════════════════════════
    # KP HORARY (Number-based)
    # ═══════════════════════════════════════════════════════════════

    def kp_horary(self, number: int, question: str = "", category: str = "general") -> Dict:
        """KP Horary analysis using number 1-249."""
        kph = KPHorary(number, question, category, self.latitude, self.longitude)
        return kph.analyze()

    # ═══════════════════════════════════════════════════════════════
    # WIRED-IN MODULES (previously orphaned)
    # ═══════════════════════════════════════════════════════════════

    def get_daridra_yogas(self) -> list:
        """BPHS Ch.42 — poverty/penury yogas."""
        from .predictions.daridra_yogas import check_daridra_yogas
        return check_daridra_yogas(self)

    def get_female_horoscopy(self) -> list:
        """BPHS Ch.77-80 — female-specific chart rules."""
        from .predictions.female_horoscopy import get_female_specific_rules
        return get_female_specific_rules(self)

    def get_longevity(self) -> Dict:
        """BPHS Ch.40 — longevity determination (3-pair method)."""
        from .predictions.longevity_calc import calculate_longevity
        return calculate_longevity(self)

    def get_dasha_psychology(self) -> Dict:
        """Psychological state based on current dasha lord."""
        from .predictions.dasha_psychology import get_psychological_state
        return get_psychological_state(self)

    def get_dasha_interpretation(self) -> Dict:
        """BPHS Ch.45-50 — current dasha period interpretation."""
        from .predictions.dasha_effects import get_current_dasha_interpretation
        return get_current_dasha_interpretation(self)

    def get_special_lagnas(self) -> Dict:
        """BPHS Ch.5 — Hora Lagna, Ghati Lagna effects."""
        from .predictions.special_lagnas import get_special_lagna_effects
        return get_special_lagna_effects(self)

    def get_compatibility_detail(self, other_engine) -> Dict:
        """Detailed Ashtakoota breakdown with explanations."""
        from .compatibility.compatibility_detail import detailed_compatibility
        return detailed_compatibility(self, other_engine)

    # ═══════════════════════════════════════════════════════════════
    # NEW: BPHS EXTENDED
    # ═══════════════════════════════════════════════════════════════
    def get_d60_interpretation(self) -> Dict:
        from .parashara.bphs_extended import get_all_d60
        return get_all_d60(self.planets)

    def get_remaining_vargas(self) -> Dict:
        from .parashara.bphs_extended import interpret_all_remaining_vargas
        return interpret_all_remaining_vargas(self)

    def get_mrityu_bhaga(self) -> list:
        from .parashara.bphs_extended import check_mrityu_bhaga
        return check_mrityu_bhaga(self.planets)

    def get_bhrigu_bindu(self) -> Dict:
        from .parashara.bphs_extended import calculate_bhrigu_bindu
        return calculate_bhrigu_bindu(self.planets)

    def get_pada_archetypes(self) -> Dict:
        from .parashara.bphs_extended import get_all_planet_padas
        return get_all_planet_padas(self.planets)

    def get_pancha_pakshi(self) -> Dict:
        from .parashara.bphs_extended import get_pancha_pakshi
        moon_nak = int(self.planets.get('Moon', {}).get('longitude', 0) / (360/27)) % 27
        local, sunrise, sunset = self._local_sun(None)
        return get_pancha_pakshi(moon_nak, now=local, sunrise=sunrise, sunset=sunset)

    def get_graha_shanti(self) -> Dict:
        from .parashara.bphs_extended import get_full_graha_shanti
        weak = [n for n in ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn']
                if self.planets.get(n, {}).get('dignity', '') in ('debilitated', 'Debilitated', 'combust')]
        if not weak:
            weak = [self.get_vimshottari_dasha().get('mahadasha', {}).get('lord', 'Saturn')]
        return get_full_graha_shanti(weak)

    # ═══════════════════════════════════════════════════════════════
    # NEW: KP EXTENDED
    # ═══════════════════════════════════════════════════════════════
    def get_kp_sensitive_points(self, months: int = 12) -> Dict:
        from .kp.kp_extended import calculate_sensitive_points
        return calculate_sensitive_points(self, months)

    def get_kp_marriage_match(self, other_engine) -> Dict:
        from .kp.kp_extended import kp_marriage_match
        return kp_marriage_match(self, other_engine)

    def get_kp_profession(self) -> Dict:
        from .kp.kp_extended import kp_profession
        return kp_profession(self)

    def get_kp_cuspal_interlinks(self) -> list:
        from .kp.kp_extended import find_cuspal_interlinks
        return find_cuspal_interlinks(self)

    def get_kp_lost_object(self) -> Dict:
        from .kp.kp_extended import kp_lost_object
        return kp_lost_object(self)

    def get_kp_rp_timing(self) -> Dict:
        from .kp.kp_extended import get_rp_timing
        return get_rp_timing(self)

    # ═══════════════════════════════════════════════════════════════
    # NEW: WESTERN EXTENDED
    # ═══════════════════════════════════════════════════════════════
    def get_western_full_dignities(self) -> Dict:
        from .western.extended import calculate_all_dignities
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        is_day = wc.planets['Sun'].get('house', 1) <= 6
        return calculate_all_dignities(wc.planets, is_day)

    def get_western_almuten(self) -> Dict:
        from .western.extended import calculate_almuten
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        is_day = wc.planets['Sun'].get('house', 1) <= 6
        return calculate_almuten(wc.planets, wc._ascendant, wc._midheaven, is_day)

    def get_western_hayz(self) -> Dict:
        from .western.extended import check_hayz
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        is_day = wc.planets['Sun'].get('house', 1) <= 6
        return check_hayz(wc.planets, is_day)

    def get_western_joys(self) -> list:
        from .western.extended import check_planetary_joys
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        return check_planetary_joys(wc.planets)

    def get_western_asteroids(self) -> Dict:
        from .western.extended import calculate_asteroids
        return calculate_asteroids(self.birth_dt)

    def get_western_planetary_nodes(self) -> Dict:
        from .western.extended import get_planetary_nodes
        return get_planetary_nodes()

    def get_western_prenatal(self) -> Dict:
        from .western.extended import find_prenatal_lunation
        return find_prenatal_lunation(self.birth_dt)

    def get_western_decennials(self) -> Dict:
        from .western.extended import calculate_decennials
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        wc._ensure_calculated()
        is_day = wc.planets['Sun'].get('house', 1) <= 6
        return calculate_decennials(self.birth_dt, is_day)

    def get_western_tertiary(self) -> Dict:
        from .western.extended import tertiary_progressions
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return tertiary_progressions(wc)

    def get_western_converse(self) -> Dict:
        from .western.extended import converse_progressions
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return converse_progressions(wc)

    def get_western_prog_lunation(self) -> Dict:
        from .western.extended import progressed_lunation_cycle
        from .western.chart import WesternChart
        wc = WesternChart(self.birth_dt, self.latitude, self.longitude)
        return progressed_lunation_cycle(wc)

    def get_western_electional(self) -> Dict:
        from .western.extended import evaluate_electional_moment
        return evaluate_electional_moment(self.birth_dt, self.latitude, self.longitude)

    # ═══════════════════════════════════════════════════════════════
    # NEW: CHINESE EXTENDED
    # ═══════════════════════════════════════════════════════════════
    def get_chinese_dayun_onset(self, gender: str = "male") -> Dict:
        from .chinese.extended import calculate_dayun_onset
        bc = __import__('app.services.chinese.bazi', fromlist=['BaZiChart']).BaZiChart(self.birth_local)
        bc._ensure_calculated()
        return calculate_dayun_onset(self.birth_local, bc._pillars['year']['stem'], gender)

    def get_chinese_xiao_yun(self, gender: str = "male") -> list:
        from .chinese.extended import calculate_xiao_yun, calculate_dayun_onset
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        bc._ensure_calculated()
        onset = calculate_dayun_onset(self.birth_local, bc._pillars['year']['stem'], gender)
        return calculate_xiao_yun(self.birth_local, bc._pillars['year']['stem'],
                                   bc._pillars['hour']['branch'], onset['onset_years'], gender)

    def get_chinese_pillar_overlay(self) -> Dict:
        from .chinese.extended import get_current_pillar_overlay
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return get_current_pillar_overlay(bc)

    def get_chinese_hidden_strength(self) -> Dict:
        from .chinese.extended import get_hidden_stems_with_strength
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        bc._ensure_calculated()
        return get_hidden_stems_with_strength(bc._pillars)

    def get_chinese_gods_matrix(self) -> list:
        from .chinese.extended import analyze_ten_gods_matrix
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return analyze_ten_gods_matrix(bc.get_ten_gods())

    def get_chinese_date_selection(self, event: str = "general") -> list:
        from .chinese.extended import select_auspicious_date
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        dm = bc.get_day_master()
        return select_auspicious_date(dm['element'], event)

    def get_chinese_feng_shui(self) -> Dict:
        from .chinese.extended import get_feng_shui_directions
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        return get_feng_shui_directions(bc.get_day_master()['element'])

    def get_chinese_medical(self) -> Dict:
        from .chinese.extended import chinese_medical_analysis
        from .chinese.bazi import BaZiChart
        bc = BaZiChart(self.birth_local)
        dm = bc.get_day_master()
        elem = bc.get_element_balance()
        return chinese_medical_analysis(elem['counts'], dm['element'], elem['day_master_strength'])

    def get_zi_wei_chart(self, gender: str = "male") -> Dict:
        # Gender is not cosmetic here: it sets the DIRECTION the ten-year limits travel,
        # so the whole timing half of the chart depends on it.
        from .chinese.ziwei import ZiWeiChart
        zw = ZiWeiChart(self.birth_local, gender)
        return zw.generate_report()

    def get_zi_wei_grid(self, gender: str = "male") -> str:
        from .chinese.ziwei import ZiWeiChart
        return ZiWeiChart(self.birth_local, gender).text_grid()


def create_engine(birth_datetime: datetime, latitude: float, longitude: float,
                  ayanamsa: str = 'LAHIRI') -> JyotishEngine:
    return JyotishEngine(birth_datetime, latitude, longitude, ayanamsa)
