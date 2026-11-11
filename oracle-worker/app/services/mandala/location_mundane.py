from datetime import datetime
from ..core.constants import RASHI_NAMES
from ..core.ephemeris import get_ephemeris
from .national_charts import NATIONAL_CHARTS, detect_country_from_text
from .mundane_engine import MUNDANE_HOUSES
from .cities_db import CITIES

def _city_to_country_key(city_name):
    cd = CITIES.get(city_name, {})
    country = cd.get("country", "").lower()
    MAP = {
        "india":"india","usa":"usa","uk":"uk","france":"france","germany":"germany",
        "china":"china","japan":"japan","australia":"australia","canada":"canada",
        "brazil":"brazil","russia":"russia","pakistan":"pakistan","bangladesh":"bangladesh",
        "nepal":"nepal","sri lanka":"sri_lanka","singapore":"singapore","thailand":"thailand",
        "indonesia":"indonesia","malaysia":"malaysia","south korea":"south_korea",
        "taiwan":"taiwan","vietnam":"vietnam","philippines":"philippines","uae":"uae",
        "saudi arabia":"saudi_arabia","turkey":"turkey","iran":"iran","iraq":"iraq",
        "israel":"israel","egypt":"egypt","south africa":"south_africa","nigeria":"nigeria",
        "kenya":"kenya","mexico":"mexico","argentina":"argentina","colombia":"colombia",
        "chile":"chile","peru":"peru","spain":"spain","italy":"italy",
        "netherlands":"netherlands","belgium":"belgium","switzerland":"switzerland",
        "austria":"austria","poland":"poland","sweden":"sweden","norway":"norway",
        "denmark":"denmark","finland":"finland","ireland":"ireland","portugal":"portugal",
        "greece":"greece","czechia":"czech_republic","romania":"romania","hungary":"hungary",
        "qatar":"qatar","kuwait":"kuwait","jordan":"jordan","lebanon":"lebanon",
        "new zealand":"new_zealand","cuba":"cuba","myanmar":"myanmar",
    }
    # Also check city name directly against state/city charts
    STATE_MAP = {
        "Jaipur":"rajasthan","Kota":"rajasthan","Jodhpur":"rajasthan","Udaipur":"rajasthan",
        "Mumbai":"maharashtra","Pune":"maharashtra","Nashik":"maharashtra","Nagpur":"maharashtra",
        "Ahmedabad":"gujarat","Surat":"gujarat","Vadodara":"gujarat","Rajkot":"gujarat",
        "Bangalore":"karnataka","Mysore":"karnataka","Hubli":"karnataka",
        "Chennai":"tamil_nadu","Madurai":"tamil_nadu","Coimbatore":"tamil_nadu",
        "Kochi":"kerala","Thiruvananthapuram":"kerala",
        "Lucknow":"uttar_pradesh","Kanpur":"uttar_pradesh","Agra":"uttar_pradesh","Varanasi":"uttar_pradesh",
        "Kolkata":"west_bengal",
        "Chandigarh":"punjab","Ludhiana":"punjab","Amritsar":"punjab",
        "Bhopal":"madhya_pradesh","Indore":"madhya_pradesh","Jabalpur":"madhya_pradesh",
        "Hyderabad":"telangana","Vijayawada":"andhra_pradesh","Visakhapatnam":"andhra_pradesh",
        "Patna":"bihar","Ranchi":"jharkhand","Raipur":"chhattisgarh",
        "Dehradun":"uttarakhand","Rishikesh":"uttarakhand",
        "Bhubaneswar":"odisha","Guwahati":"assam","Goa":"goa",
        "Shimla":"himachal_pradesh","Srinagar":"jammu_kashmir",
        "Delhi":"delhi_city","London":"london_city","New York":"new_york_city",
        "Tokyo":"tokyo_city","Dubai":"dubai_city","Singapore":"singapore_city",
        "Paris":"paris_city","Rome":"rome_city",
    }
    state_key = STATE_MAP.get(city_name)
    if state_key: return state_key
    return MAP.get(country)

class LocationMundane:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.ephemeris = get_ephemeris()

    def get_location_weather(self, city_name=None, country_key=None):
        if not country_key and city_name:
            country_key = _city_to_country_key(city_name)
        if not country_key:
            try: country_key = detect_country_from_text(city_name or "")
            except: pass
        if not country_key or country_key not in NATIONAL_CHARTS:
            return {"available": False, "reason": f"No national chart for '{city_name or country_key}'"}
        nc = NATIONAL_CHARTS[country_key]
        nc_asc = nc.get("ascendant_sign", "")
        nc_asc_idx = RASHI_NAMES.index(nc_asc) if nc_asc in RASHI_NAMES else -1
        try: current_transits = self.ephemeris.get_current_transits()
        except: current_transits = {}
        weather = []
        if nc_asc_idx >= 0:
            for planet, td in current_transits.items():
                if planet not in ("Jupiter","Saturn","Rahu","Ketu"): continue
                tr = td.get("rashi", 0)
                nh = ((tr - nc_asc_idx) % 12) + 1
                ph = ((tr - self.asc_rashi) % 12) + 1
                hi = MUNDANE_HOUSES.get(nh, {})
                pi = self._personal_impact(nh, ph, planet)
                weather.append({"planet":planet,"sign":td.get("rashi_name",""),
                    "national_house":nh,"national_domain":hi.get("domain",""),
                    "national_keywords":hi.get("keywords",[])[:3],
                    "your_house":ph,"personal_impact":pi})
        fav = sum(1 for w in weather if "favorable" in w.get("personal_impact","").lower() or "growth" in w.get("personal_impact","").lower())
        chal = sum(1 for w in weather if "challenging" in w.get("personal_impact","").lower() or "pressure" in w.get("personal_impact","").lower())
        mood = "favorable" if fav>chal else ("challenging" if chal>fav else "mixed")
        return {"available":True,"country":nc.get("name",""),"capital":nc.get("capital",""),
            "founded":nc.get("date",""),"ascendant":nc_asc,"current_dasha":nc.get("current_vd_dasha",""),
            "region":nc.get("region",""),"national_weather":weather,"mood":mood,
            "favorable_transits":fav,"challenging_transits":chal}

    def get_country_year(self, country_key=None, year=None):
        if not year: year = datetime.now().year
        w = self.get_location_weather(country_key=country_key)
        if not w.get("available"): return w
        themes = []
        for t in w.get("national_weather",[]):
            p = t["planet"]; d = t["national_domain"]
            if p=="Saturn": themes.append(f"Saturn in {d} — {year} restructures {d.lower()}")
            elif p=="Jupiter": themes.append(f"Jupiter in {d} — {year} expands {d.lower()}")
            elif p=="Rahu": themes.append(f"Rahu in {d} — {year} disrupts {d.lower()}")
            elif p=="Ketu": themes.append(f"Ketu in {d} — {year} detaches from {d.lower()}")
        w["year"] = year
        w["yearly_themes"] = themes
        return w

    def get_personal_mundane_overlay(self, city_name=None):
        w = self.get_location_weather(city_name=city_name)
        if not w.get("available"): return w
        from .relocation import RelocationChart
        reloc = RelocationChart(self.engine)
        cd = CITIES.get(city_name, {})
        ra = reloc.analyze_location(cd["lat"], cd["lng"], city_name) if cd else {}
        impacts = []
        for t in w.get("national_weather",[]):
            if t.get("personal_impact"):
                impacts.append({"planet":t["planet"],
                    "national_effect":f"{t['planet']} in {t['national_domain']} (H{t['national_house']})",
                    "personal_effect":f"Hits your H{t['your_house']}",
                    "meaning":t["personal_impact"]})
        rs = ra.get("overall_score", 50)
        mood = w.get("mood","mixed")
        if rs>=70 and mood=="favorable": syn="Excellent — your chart thrives here AND the country is in a good phase."
        elif rs>=70 and mood=="challenging": syn="Your chart is strong here, but the country faces pressure. You can ride it out."
        elif rs<50 and mood=="favorable": syn="Country is doing well, but your chart doesn't resonate. Limited benefit."
        elif rs<50 and mood=="challenging": syn="Challenging on both levels. Consider better timing."
        else: syn="Mixed — some areas benefit, others face pressure."
        return {"city":city_name,"country":w.get("country",""),"relocation_score":rs,
            "national_mood":mood,"direct_impacts":impacts,"synthesis":syn,
            "national_weather":w.get("national_weather",[]),"yearly_themes":w.get("yearly_themes",[])}

    def _personal_impact(self, nh, ph, planet):
        if nh == ph:
            d = MUNDANE_HOUSES.get(nh,{}).get("domain","")
            if planet=="Jupiter": return f"National {d.lower()} growth directly lifts your H{ph}. Favorable."
            if planet=="Saturn": return f"National {d.lower()} pressure hits your H{ph}. Challenging but builds strength."
            if planet=="Rahu": return f"National {d.lower()} disruption creates opportunity in your H{ph}."
            if planet=="Ketu": return f"National {d.lower()} detachment triggers growth in your H{ph}."
        kendras = {1,4,7,10}
        if nh in kendras and ph in kendras:
            return "Angular alignment — national events strongly shape your life."
        trikonas = {1,5,9}
        if nh in trikonas and ph in trikonas:
            return "Dharmic alignment — national fortune flows into your dharma."
        return ""