import math
from ..core.ephemeris import get_ephemeris

LINE_PLANETS = ["Sun","Moon","Mars","Mercury","Jupiter","Venus","Saturn","Rahu","Ketu"]
PLANET_ACTIVATION = {
    "Sun": {"when":"authority, career push","activity":"Face this direction at sunrise"},
    "Moon": {"when":"emotional decisions, mother","activity":"Meditate facing this direction"},
    "Mars": {"when":"physical challenges, competition","activity":"Exercise in this direction"},
    "Mercury": {"when":"business, exams, contracts","activity":"Work facing this direction"},
    "Jupiter": {"when":"spiritual growth, legal matters","activity":"Read or pray facing this direction"},
    "Venus": {"when":"love, art, social events","activity":"Create or socialize in this direction"},
    "Saturn": {"when":"discipline, hard work","activity":"Do hardest task facing this direction"},
    "Rahu": {"when":"unconventional moves, foreign","activity":"Take risks in this direction"},
    "Ketu": {"when":"spiritual retreat, letting go","activity":"Meditate or release in this direction"},
}
DIRS = [(0,"North"),(22.5,"NNE"),(45,"Northeast"),(67.5,"ENE"),(90,"East"),(112.5,"ESE"),(135,"Southeast"),(157.5,"SSE"),(180,"South"),(202.5,"SSW"),(225,"Southwest"),(247.5,"WSW"),(270,"West"),(292.5,"WNW"),(315,"Northwest"),(337.5,"NNW")]

class LocalSpace:
    def __init__(self, engine):
        self.engine = engine
        self.birth_dt = engine.birth_dt
        self.birth_lat = engine.latitude
        self.birth_lng = engine.longitude
        self.ephemeris = get_ephemeris()
        self.jd = self.ephemeris.get_julian_day(self.birth_dt)

    def calculate_all_lines(self):
        lines = {}
        for planet in LINE_PLANETS:
            pos = self.ephemeris.get_planet_position(self.jd, planet)
            az = self._calc_azimuth(pos)
            d = self._az_to_dir(az)
            act = PLANET_ACTIVATION.get(planet, {})
            ep = self._project(az, 2000)
            lines[planet] = {"azimuth":round(az,1),"direction":d,"sign":pos.get("rashi_name",""),
                "activate_when":act.get("when",""),"activity":act.get("activity",""),
                "line":{"start":{"lat":self.birth_lat,"lng":self.birth_lng},"end":ep}}
        sp = self._strongest(lines)
        return {"lines":lines,"birth_location":{"lat":self.birth_lat,"lng":self.birth_lng},
            "strongest_pull":sp,
            "love_direction":lines.get("Venus",{}).get("direction",""),
            "career_direction":lines.get("Sun",{}).get("direction",""),
            "wealth_direction":lines.get("Jupiter",{}).get("direction",""),
            "spiritual_direction":lines.get("Ketu",{}).get("direction","")}

    def get_active_direction(self):
        lines = self.calculate_all_lines()
        tp = self.ephemeris.get_current_transits()
        acts = []
        for t_p, t_d in tp.items():
            t_az = self._calc_azimuth(t_d)
            for n_p, n_l in lines["lines"].items():
                diff = abs(t_az - n_l["azimuth"])
                if diff > 180: diff = 360 - diff
                if diff < 10:
                    acts.append({"natal_planet":n_p,"transit_planet":t_p,"direction":n_l["direction"],
                        "azimuth":n_l["azimuth"],"orb":round(diff,1),
                        "meaning":f"{t_p} activates your {n_p} line — {n_l.get('activate_when','')}"})
        acts.sort(key=lambda a:a["orb"])
        hot = acts[0]["direction"] if acts else lines.get("strongest_pull",{}).get("direction","East")
        return {"hot_direction":hot,"activations":acts[:5],"total_active":len(acts)}

    def _calc_azimuth(self, pd):
        try:
            tl = pd.get("tropical_longitude", pd.get("longitude",0))
            pl = pd.get("latitude",0)
            obl = math.radians(23.4393)
            ecl = math.radians(tl)
            lat = math.radians(pl)
            ra = math.atan2(math.sin(ecl)*math.cos(obl)-math.tan(lat)*math.sin(obl), math.cos(ecl))
            decl = math.asin(math.sin(lat)*math.cos(obl)+math.cos(lat)*math.sin(obl)*math.sin(ecl))
            from ..core.ephemeris import swe
            gst = swe.sidtime(self.jd)
            lst = gst + self.birth_lng/15.0
            ha = math.radians(lst*15.0) - ra
            ol = math.radians(self.birth_lat)
            az = math.atan2(math.sin(ha), math.cos(ha)*math.sin(ol)-math.tan(decl)*math.cos(ol))
            return (math.degrees(az)+360)%360
        except: return pd.get("longitude",0)%360

    def _az_to_dir(self, az):
        for deg, name in reversed(DIRS):
            if az >= deg: return name
        return "North"

    def _project(self, az, km):
        R=6371; d=km/R; ar=math.radians(az)
        la=math.radians(self.birth_lat); lo=math.radians(self.birth_lng)
        la2=math.asin(math.sin(la)*math.cos(d)+math.cos(la)*math.sin(d)*math.cos(ar))
        lo2=lo+math.atan2(math.sin(ar)*math.sin(d)*math.cos(la),math.cos(d)-math.sin(la)*math.sin(la2))
        return {"lat":round(math.degrees(la2),2),"lng":round(math.degrees(lo2),2)}

    def _strongest(self, lines):
        best=None; bs=0; bf={"Jupiter","Venus","Mercury"}
        for p,d in lines.items():
            s=5
            if p in bf: s+=3
            if s>bs: bs=s; best={"planet":p,"direction":d["direction"],"azimuth":d["azimuth"]}
        return best or {}