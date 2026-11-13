import math
from ..core.ephemeris import get_ephemeris

LINE_PLANETS = ["Sun","Moon","Mars","Mercury","Jupiter","Venus","Saturn"]
PARAN_INTERP = {
    ("Jupiter","Venus"):{"theme":"Wisdom meets beauty","area":"love, wealth, grace","quality":"most favorable"},
    ("Sun","Jupiter"):{"theme":"Authority meets wisdom","area":"career expansion","quality":"highly favorable"},
    ("Moon","Venus"):{"theme":"Emotion meets love","area":"romance and comfort","quality":"highly favorable"},
    ("Moon","Jupiter"):{"theme":"Emotion meets wisdom","area":"emotional fulfillment","quality":"very favorable"},
    ("Mars","Jupiter"):{"theme":"Action meets expansion","area":"bold ventures","quality":"very favorable"},
    ("Sun","Venus"):{"theme":"Authority meets beauty","area":"creative career","quality":"favorable"},
    ("Mercury","Jupiter"):{"theme":"Intellect meets wisdom","area":"teaching, publishing","quality":"favorable"},
    ("Mercury","Venus"):{"theme":"Intellect meets art","area":"creative communication","quality":"favorable"},
    ("Mars","Venus"):{"theme":"Passion meets beauty","area":"romance, attraction","quality":"magnetic"},
    ("Sun","Moon"):{"theme":"Identity meets emotion","area":"personal wholeness","quality":"integration"},
    ("Sun","Mars"):{"theme":"Authority meets drive","area":"leadership","quality":"powerful but volatile"},
    ("Sun","Mercury"):{"theme":"Authority meets intellect","area":"communication","quality":"articulate"},
    ("Sun","Saturn"):{"theme":"Authority meets discipline","area":"structured career","quality":"demanding"},
    ("Moon","Mars"):{"theme":"Emotion meets action","area":"passionate life","quality":"intense"},
    ("Moon","Saturn"):{"theme":"Emotion meets structure","area":"emotional maturity","quality":"sobering"},
    ("Mars","Saturn"):{"theme":"Action meets restriction","area":"hard discipline","quality":"challenging"},
    ("Jupiter","Saturn"):{"theme":"Expansion meets contraction","area":"balanced growth","quality":"mixed but powerful"},
    ("Venus","Saturn"):{"theme":"Beauty meets time","area":"lasting love","quality":"slow but deep"},
    ("Mercury","Saturn"):{"theme":"Intellect meets structure","area":"research, depth","quality":"serious"},
    ("Mars","Mercury"):{"theme":"Action meets intellect","area":"strategic execution","quality":"sharp"},
    ("Moon","Mercury"):{"theme":"Emotion meets intellect","area":"emotional intelligence","quality":"balanced"},
}

class ParanCalculator:
    def __init__(self, engine):
        self.engine = engine
        self.birth_lat = engine.latitude
        self.ephemeris = get_ephemeris()
        self.jd = self.ephemeris.get_julian_day(engine.birth_dt)

    def calculate_all_parans(self):
        planet_lats = {}
        for planet in LINE_PLANETS:
            pos = self.ephemeris.get_planet_position(self.jd, planet)
            tl = pos.get("tropical_longitude", pos["longitude"])
            planet_lats[(planet,"MC")] = list(range(-60,65,2))
            planet_lats[(planet,"ASC")] = self._rising_lats(tl)
        parans = []
        for i, p1 in enumerate(LINE_PLANETS):
            for p2 in LINE_PLANETS[i+1:]:
                for a1 in ["ASC","MC"]:
                    for a2 in ["ASC","MC","DSC","IC"]:
                        if p1==p2 and a1==a2: continue
                        l1 = set(planet_lats.get((p1,a1),[]))
                        l2 = set(planet_lats.get((p2,a2),[]))
                        for la1 in l1:
                            for la2 in l2:
                                if abs(la1-la2)<=2:
                                    key = tuple(sorted([p1,p2]))
                                    interp = PARAN_INTERP.get(key,{})
                                    parans.append({"latitude":round((la1+la2)/2,1),"planet_1":p1,"angle_1":a1,
                                        "planet_2":p2,"angle_2":a2,"theme":interp.get("theme",f"{p1} meets {p2}"),
                                        "life_area":interp.get("area",""),"quality":interp.get("quality","neutral")})
        unique = self._dedup(parans)
        bp = min(unique, key=lambda p:abs(p["latitude"]-self.birth_lat)) if unique else None
        fav = [p for p in unique if p["quality"] in ("favorable","very favorable","highly favorable","most favorable")]
        chal = [p for p in unique if p["quality"] in ("challenging","demanding","intense")]
        love = [p for p in unique if "love" in p.get("life_area","").lower() or "romance" in p.get("life_area","").lower()]
        return {"parans":unique[:20],"birth_paran":bp,"birth_latitude":self.birth_lat,
            "favorable_bands":fav[:8],"challenging_bands":chal[:5],"love_parans":love[:3],
            "total_found":len(unique),
            "summary":f"Birth at {self.birth_lat}° aligns with {bp['planet_1']}-{bp['planet_2']} ({bp['theme']})." if bp else ""}

    def _rising_lats(self, tl):
        valid=[]; obl=math.radians(23.4393); ecl=math.radians(tl)
        decl=math.asin(math.sin(obl)*math.sin(ecl))
        for lat in range(-60,65,2):
            cv=-math.tan(math.radians(lat))*math.tan(decl)
            if abs(cv)<=1: valid.append(lat)
        return valid

    def _dedup(self, parans):
        u=[]
        for p in parans:
            if not any(abs(p["latitude"]-x["latitude"])<4 and set([p["planet_1"],p["planet_2"]])==set([x["planet_1"],x["planet_2"]]) for x in u):
                u.append(p)
        u.sort(key=lambda p:0 if p["quality"] in ("most favorable","highly favorable") else 1 if "favorable" in p["quality"] else 2)
        return u