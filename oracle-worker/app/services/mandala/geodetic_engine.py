"""
MANDALA ENGINE — Master entry point for geodetic astrology.
"""
from typing import Dict
from .astrocartography import Astrocartography
from .relocation import RelocationChart
from .directions import DirectionCompass
from .travel_windows import TravelWindows

class MandalaEngine:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.ascendant = engine.ascendant
        self.asc_rashi = engine.ascendant_rashi
        self.birth_dt = engine.birth_dt
        self.birth_lat = engine.latitude
        self.birth_lng = engine.longitude
        self.ephemeris = engine.ephemeris

    def get_power_map(self) -> Dict:
        acg = Astrocartography(self.engine)
        lines = acg.calculate_all_lines()
        zones = acg.find_power_zones(lines)
        crossings = acg.find_line_crossings(lines)
        return {
            "planetary_lines": lines,
            "power_zones": zones,
            "crossings": crossings,
            "birth_location": {"lat": self.birth_lat, "lng": self.birth_lng},
            "strongest_line": acg.get_strongest_line(lines),
            "summary": acg.summarize(lines, zones),
        }

    def get_best_cities(self, purpose="overall", cities=None) -> Dict:
        return RelocationChart(self.engine).rank_cities(purpose=purpose, cities=cities)

    def get_here_now(self, lat=None, lng=None, city_name=None) -> Dict:
        lat = lat or self.birth_lat
        lng = lng or self.birth_lng
        city_name = city_name or "Current location"
        reloc = RelocationChart(self.engine)
        result = reloc.analyze_location(lat, lng, city_name)
        try:
            transit_planets = self.ephemeris.get_current_transits()
            active = []
            for planet, data in transit_planets.items():
                t_house = ((data["rashi"] - result["relocated_asc_rashi"]) % 12) + 1
                if t_house in (1, 4, 7, 10):
                    active.append({"planet": planet, "transit_house": t_house, "sign": data["rashi_name"]})
            result["active_transits"] = active
        except Exception:
            result["active_transits"] = []
        return result

    def get_compass(self) -> Dict:
        return DirectionCompass(self.engine).full_compass()

    def get_relocation(self, city_name=None, lat=None, lng=None) -> Dict:
        return RelocationChart(self.engine).full_relocation_report(lat, lng, city_name)

    def get_travel_windows(self, months=6, purpose="general") -> Dict:
        return TravelWindows(self.engine).find_windows(months=months, purpose=purpose)

    def get_local_space(self) -> Dict:
        from .local_space import LocalSpace
        return LocalSpace(self.engine).calculate_all_lines()

    def get_active_direction(self) -> Dict:
        from .local_space import LocalSpace
        return LocalSpace(self.engine).get_active_direction()

    def get_geodetic_zodiac(self) -> Dict:
        from .geodetic_zodiac import GeodeticZodiac
        gz = GeodeticZodiac(self.engine)
        return {"birth": gz.get_birth_geodetic(), "country_matches": gz.match_countries()}

    def get_parans(self) -> Dict:
        from .parans import ParanCalculator
        return ParanCalculator(self.engine).calculate_all_parans()

    def get_sacred_sites(self) -> Dict:
        from .sacred_sites import SacredSiteAlignment
        return SacredSiteAlignment(self.engine).find_aligned_sites()

    def get_eclipse_geography(self) -> Dict:
        from .eclipse_geo import EclipseGeography
        return EclipseGeography(self.engine).analyze_eclipse_geography()

    def get_migration_roadmap(self) -> Dict:
        from .migration import MigrationRoadmap
        return MigrationRoadmap(self.engine).generate_roadmap()

    def get_time_place_score(self, city_name: str) -> Dict:
        from .migration import MigrationRoadmap
        return MigrationRoadmap(self.engine).get_time_place_score(city_name)

    def get_danger_zones(self) -> Dict:
        from .migration import MigrationRoadmap
        return MigrationRoadmap(self.engine).get_danger_zones()

    def get_relationship_geography(self) -> Dict:
        from .migration import MigrationRoadmap
        return MigrationRoadmap(self.engine).get_relationship_geography()

    def scan_globe(self, resolution: int = 5, purpose: str = "overall") -> Dict:
        from .global_scan import GlobalScan
        return GlobalScan(self.engine).scan_globe(resolution=resolution, purpose=purpose)

    def scan_region(self, lat_min: float, lat_max: float, lng_min: float, lng_max: float,
                    resolution: float = 1, purpose: str = "overall") -> Dict:
        from .global_scan import GlobalScan
        return GlobalScan(self.engine).scan_region(lat_min, lat_max, lng_min, lng_max, resolution, purpose)

    def analyze_any_point(self, lat: float, lng: float, name: str = "") -> Dict:
        from .global_scan import GlobalScan
        return GlobalScan(self.engine).analyze_any_point(lat, lng, name)

    def get_location_weather(self, city_name=None, country_key=None):
        from .location_mundane import LocationMundane
        return LocationMundane(self.engine).get_location_weather(city_name=city_name, country_key=country_key)

    def get_country_year(self, country_key=None, year=None):
        from .location_mundane import LocationMundane
        return LocationMundane(self.engine).get_country_year(country_key=country_key, year=year)

    def get_personal_mundane(self, city_name=None):
        from .location_mundane import LocationMundane
        return LocationMundane(self.engine).get_personal_mundane_overlay(city_name=city_name)

    def analyze_coordinate_mundane(self, lat: float, lng: float, name: str = "") -> Dict:
        from .universal_mundane import UniversalMundane
        return UniversalMundane(self.engine).analyze_coordinate(lat, lng, name)
