import math
from ..core.ephemeris import get_ephemeris
from ..core.constants import RASHI_NAMES

ECLIPSES = [
    {"date":"2025-09-07","type":"Lunar Total","lng":-170.0,"lat":-5.0,"sign":"Pisces","deg":15.0},
    {"date":"2025-09-21","type":"Solar Partial","lng":25.0,"lat":55.0,"sign":"Virgo","deg":29.0},
    {"date":"2026-02-17","type":"Solar Annular","lng":-45.0,"lat":-50.0,"sign":"Aquarius","deg":29.0},
    {"date":"2026-03-03","type":"Lunar Total","lng":80.0,"lat":15.0,"sign":"Virgo","deg":12.0},
    {"date":"2026-08-12","type":"Solar Total","lng":30.0,"lat":65.0,"sign":"Leo","deg":19.0},
    {"date":"2026-08-28","type":"Lunar Partial","lng":-120.0,"lat":20.0,"sign":"Aquarius","deg":5.0},
]

class EclipseGeography:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.ephemeris = get_ephemeris()
        self.jd = self.ephemeris.get_julian_day(engine.birth_dt)

    def analyze_eclipse_geography(self):
        from .astrocartography import Astrocartography
        acg = Astrocartography(self.engine)
        all_lines = acg.calculate_all_lines()
        impacts = []
        for ecl in ECLIPSES:
            hits = []
            for planet, data in all_lines.items():
                for angle, ld in data["lines"].items():
                    for pt in ld.get("points",[]):
                        d = math.sqrt((pt["lat"]-ecl["lat"])**2+((pt["lng"]-ecl["lng"])*math.cos(math.radians(ecl["lat"])))**2)
                        if d < 10:
                            hits.append({"planet":planet,"angle":angle,"distance":round(d,1),
                                "effect":self._effect(planet,angle,ecl["type"])})
            natal_hits = []
            ei = RASHI_NAMES.index(ecl["sign"]) if ecl["sign"] in RASHI_NAMES else -1
            if ei>=0:
                for p,pd in self.planets.items():
                    if p=="Ascendant": continue
                    pr = pd.get("rashi",-1)
                    if pr==ei: natal_hits.append({"planet":p,"type":"conjunction","house":pd.get("house",0)})
                    elif (pr+6)%12==ei: natal_hits.append({"planet":p,"type":"opposition","house":pd.get("house",0)})
            if hits or natal_hits:
                lvl = "high" if len(hits)>=2 else ("medium" if hits else "low")
                impacts.append({"date":ecl["date"],"type":ecl["type"],"sign":ecl["sign"],"degree":ecl["deg"],
                    "peak":{"lat":ecl["lat"],"lng":ecl["lng"]},"acg_hits":hits[:5],"natal_hits":natal_hits,
                    "impact_level":lvl,"advice":self._advice(hits,ecl)})
        most = max(impacts, key=lambda e:len(e.get("acg_hits",[]))) if impacts else None
        return {"eclipse_impacts":impacts,"most_impactful":most,
            "total_checked":len(ECLIPSES),"eclipses_affecting_you":len(impacts)}

    def _effect(self, planet, angle, etype):
        m = {("Sun","MC"):"Major career event",("Moon","ASC"):"Deep emotional shift",
            ("Jupiter","MC"):"Career breakthrough",("Venus","ASC"):"Love encounter possible",
            ("Saturn","MC"):"Career restructuring",("Mars","MC"):"Bold career move"}
        return m.get((planet,angle), f"{planet} {angle} activated by eclipse")

    def _advice(self, hits, ecl):
        if not hits: return ""
        p = hits[0]["planet"]; a = hits[0]["angle"]
        bf = {"Jupiter","Venus","Mercury"}
        if p in bf and a in ("MC","ASC"):
            return f"Consider being near {ecl['lat']}° during this eclipse — {p} amplified."
        if p in ("Saturn","Mars") and a in ("MC","ASC"):
            return f"Avoid major decisions near {ecl['lat']}° during this eclipse."
        return f"Eclipse activates your {p} {a} line."