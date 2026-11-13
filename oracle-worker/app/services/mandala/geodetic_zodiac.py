from ..core.constants import RASHI_NAMES

COUNTRY_GEO = {
    "UK":{"lng":(-5,2),"idx":11,"sign":"Pisces"},
    "France":{"lng":(-5,8),"idx":0,"sign":"Aries"},
    "Germany":{"lng":(6,15),"idx":0,"sign":"Aries"},
    "Turkey":{"lng":(26,45),"idx":1,"sign":"Taurus"},
    "Egypt":{"lng":(25,35),"idx":1,"sign":"Taurus"},
    "UAE":{"lng":(51,56),"idx":1,"sign":"Taurus"},
    "Pakistan":{"lng":(61,77),"idx":2,"sign":"Gemini"},
    "India West":{"lng":(68,78),"idx":2,"sign":"Gemini"},
    "India Central":{"lng":(78,88),"idx":2,"sign":"Gemini/Cancer"},
    "India East":{"lng":(85,97),"idx":3,"sign":"Cancer"},
    "Nepal":{"lng":(80,88),"idx":2,"sign":"Gemini"},
    "Thailand":{"lng":(97,106),"idx":3,"sign":"Cancer"},
    "Singapore":{"lng":(103,104),"idx":3,"sign":"Cancer"},
    "China East":{"lng":(110,122),"idx":3,"sign":"Cancer/Leo"},
    "Japan":{"lng":(130,146),"idx":4,"sign":"Leo"},
    "Australia East":{"lng":(140,154),"idx":4,"sign":"Leo"},
    "USA West":{"lng":(-125,-115),"idx":7,"sign":"Scorpio"},
    "USA Central":{"lng":(-105,-85),"idx":9,"sign":"Capricorn"},
    "USA East":{"lng":(-85,-70),"idx":9,"sign":"Capricorn/Aquarius"},
    "Brazil":{"lng":(-73,-35),"idx":10,"sign":"Aquarius/Pisces"},
    "Canada":{"lng":(-140,-55),"idx":8,"sign":"Sagittarius to Aquarius"},
    "South Africa":{"lng":(17,33),"idx":0,"sign":"Aries"},
    "Korea":{"lng":(124,132),"idx":4,"sign":"Leo"},
}

class GeodeticZodiac:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.birth_lat = engine.latitude
        self.birth_lng = engine.longitude

    def get_birth_geodetic(self):
        si = self._lng_to_sign(self.birth_lng)
        sn = RASHI_NAMES[si]
        rp = [p for p,d in self.planets.items() if p!="Ascendant" and d.get("rashi",-1)==si]
        am = self.asc_rashi == si
        return {"birth_lng":self.birth_lng,"geodetic_sign":sn,"geodetic_sign_idx":si,
            "resonant_planets":rp,"ascendant_match":am,
            "power_level":"very high" if am else ("high" if rp else "neutral"),
            "interpretation":self._interp(sn,rp,am)}

    def match_countries(self):
        from ..core.constants import RASHI_LORDS
        matches = []
        for country, data in COUNTRY_GEO.items():
            si = data["idx"]; score=0; reasons=[]
            for p,pd in self.planets.items():
                if p=="Ascendant": continue
                if pd.get("rashi",-1)==si:
                    is_b = p in ("Jupiter","Venus","Mercury","Moon")
                    ps = 12 if is_b else 6
                    h = pd.get("house",0)
                    if h in (1,4,5,7,9,10): ps+=5
                    score+=ps; reasons.append(f"{p} in {RASHI_NAMES[si]} amplified here")
            if self.asc_rashi==si: score+=15; reasons.append("Ascendant matches geodetic sign")
            l10 = RASHI_LORDS[(self.asc_rashi+9)%12]
            if self.planets.get(l10,{}).get("rashi",-1)==si:
                score+=10; reasons.append(f"10th lord {l10} activated — career amplification")
            if score>0:
                matches.append({"country":country,"geodetic_sign":data["sign"],"score":score,"reasons":reasons})
        matches.sort(key=lambda m:m["score"],reverse=True)
        return matches

    def analyze_city_geodetic(self, lng, city_name=""):
        si = self._lng_to_sign(lng); sn = RASHI_NAMES[si]
        rp = [p for p,d in self.planets.items() if p!="Ascendant" and d.get("rashi",-1)==si]
        am = self.asc_rashi==si
        return {"city":city_name,"longitude":lng,"geodetic_sign":sn,"resonant_planets":rp,
            "ascendant_match":am,"geodetic_score":len(rp)*10+(15 if am else 0)}

    def _lng_to_sign(self, lng):
        n = lng%360
        if lng<0: n=360+lng
        return int(n/30)%12

    def _interp(self, sign, planets, asc_match):
        if asc_match and planets: return f"Born in geodetic {sign} matching your ascendant AND housing {', '.join(planets)}. Deep amplification."
        if asc_match: return f"Born in geodetic {sign} matching your ascendant. Naturally aligned."
        if planets: return f"Born in geodetic {sign} where your {', '.join(planets)} {'resides' if len(planets)==1 else 'reside'}. Amplified by earth."
        return f"Born in geodetic {sign}. Your strengths lie in other geographies."