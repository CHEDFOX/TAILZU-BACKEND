
from typing import Dict
from .relocation import RelocationChart

class GlobalScan:
    """
    Scan the entire planet as a grid.
    Every point on Earth gets a score for your chart.
    Output: heat map data — lat, lng, score for career/love/health/wealth/spiritual/overall.
    """

    def __init__(self, engine):
        self.engine = engine
        self.reloc = RelocationChart(engine)

    def scan_globe(self, resolution: int = 5, purpose: str = "overall") -> Dict:
        """
        Scan entire planet at given resolution (degrees).
        resolution=5 → ~2500 points (fast, ~2 sec)
        resolution=2 → ~16000 points (detailed, ~10 sec)
        resolution=10 → ~650 points (quick overview)
        """
        points = []
        best = {"lat": 0, "lng": 0, "score": 0}
        worst = {"lat": 0, "lng": 0, "score": 100}

        for lat in range(-60, 65, resolution):
            for lng in range(-180, 180, resolution):
                try:
                    analysis = self.reloc.analyze_location(lat, lng, "")
                    score = analysis["scores"].get(purpose, analysis["scores"].get("overall", 50))
                    point = {"lat": lat, "lng": lng, "score": score}
                    points.append(point)
                    if score > best["score"]:
                        best = point.copy()
                    if score < worst["score"]:
                        worst = point.copy()
                except Exception:
                    continue

        # Build latitude bands (average score per latitude)
        lat_bands = {}
        for p in points:
            lat_bands.setdefault(p["lat"], []).append(p["score"])
        lat_averages = {lat: round(sum(scores)/len(scores)) for lat, scores in lat_bands.items()}

        # Build longitude bands
        lng_bands = {}
        for p in points:
            lng_bands.setdefault(p["lng"], []).append(p["score"])
        lng_averages = {lng: round(sum(scores)/len(scores)) for lng, scores in lng_bands.items()}

        # Best longitude band (determines best meridian)
        best_lng = max(lng_averages, key=lng_averages.get) if lng_averages else 0

        return {
            "points": points,
            "total_points": len(points),
            "resolution_deg": resolution,
            "purpose": purpose,
            "best_point": best,
            "worst_point": worst,
            "best_longitude_band": best_lng,
            "best_lng_score": lng_averages.get(best_lng, 0),
            "lat_averages": lat_averages,
            "lng_averages": lng_averages,
        }

    def scan_region(self, lat_min: float, lat_max: float,
                    lng_min: float, lng_max: float,
                    resolution: float = 1, purpose: str = "overall") -> Dict:
        """
        Dense scan of a specific region.
        Example: scan_region(35, 60, -10, 30, 1) scans Europe at 1° resolution.
        """
        points = []
        best = {"lat": 0, "lng": 0, "score": 0}
        lat = lat_min
        while lat <= lat_max:
            lng = lng_min
            while lng <= lng_max:
                try:
                    analysis = self.reloc.analyze_location(lat, lng, "")
                    score = analysis["scores"].get(purpose, analysis["scores"].get("overall", 50))
                    point = {"lat": round(lat, 1), "lng": round(lng, 1), "score": score}
                    points.append(point)
                    if score > best["score"]:
                        best = point.copy()
                except Exception:
                    pass
                lng += resolution
            lat += resolution

        return {
            "points": points,
            "total_points": len(points),
            "resolution_deg": resolution,
            "region": {"lat_min": lat_min, "lat_max": lat_max, "lng_min": lng_min, "lng_max": lng_max},
            "purpose": purpose,
            "best_point": best,
        }

    def analyze_any_point(self, lat: float, lng: float, name: str = "") -> Dict:
        """
        Full analysis of ANY point on Earth. No city database needed.
        """
        if not name:
            name = f"{abs(lat):.1f}{'N' if lat>=0 else 'S'}, {abs(lng):.1f}{'E' if lng>=0 else 'W'}"
        return self.reloc.full_relocation_report(lat, lng, name)
