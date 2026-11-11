from datetime import datetime, timedelta
from ..core.constants import RASHI_LORDS
from .relocation import RelocationChart
from .cities_db import CITIES as WORLD_CITIES

PLANET_GEO = {
    "Sun":{"tendency":"stay visible","best":"career cities","dir":"East"},
    "Moon":{"tendency":"go home","best":"emotional comfort","dir":"homeland"},
    "Mars":{"tendency":"conquer new territory","best":"competitive cities","dir":"bold move"},
    "Mercury":{"tendency":"network hub","best":"tech/business centers","dir":"connected cities"},
    "Jupiter":{"tendency":"expand abroad","best":"educational/spiritual centers","dir":"abroad"},
    "Venus":{"tendency":"seek beauty","best":"artistic/romantic cities","dir":"beautiful places"},
    "Saturn":{"tendency":"return to roots","best":"birth region","dir":"homeland"},
    "Rahu":{"tendency":"foreign obsession","best":"foreign countries","dir":"far abroad"},
    "Ketu":{"tendency":"retreat","best":"spiritual retreats","dir":"pilgrimage"},
}

class MigrationRoadmap:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.birth_dt = engine.birth_dt
        self.birth_lat = engine.latitude
        self.birth_lng = engine.longitude

    def generate_roadmap(self):
        try: periods = self.engine.get_vimshottari_periods()
        except: return {"error":"No dasha data","phases":[]}
        reloc = RelocationChart(self.engine); now = datetime.now(); phases = []
        for p in periods:
            lord = p.get("lord",p.get("planet",""))
            start = str(p.get("start",p.get("start_date","")))[:10]
            end = str(p.get("end",p.get("end_date","")))[:10]
            if not lord or not start: continue
            try: sd=datetime.strptime(start,"%Y-%m-%d"); ed=datetime.strptime(end,"%Y-%m-%d")
            except: continue
            status = "past" if ed<now else ("current" if sd<=now<=ed else "future")
            gn = PLANET_GEO.get(lord,{})
            purpose = "career" if lord in ("Sun","Saturn","Mercury","Rahu") else ("love" if lord in ("Venus","Moon") else ("spiritual" if lord in ("Jupiter","Ketu") else "overall"))
            bc = self._best_city(reloc,purpose)
            ma = self._move_advice(lord)
            phases.append({"lord":lord,"start":start,"end":end,"years":round((ed-sd).days/365.25,1),
                "status":status,"tendency":gn.get("tendency",""),"best_city_type":gn.get("best",""),
                "recommended_city":bc.get("city",""),"city_score":bc.get("score",0),"move_advice":ma,
                "direction":gn.get("dir","")})
        cur = next((p for p in phases if p["status"]=="current"),None)
        nm = next((p for p in phases if p["status"]=="future" and p["lord"] in ("Jupiter","Rahu","Venus")),None)
        if not nm: nm = next((p for p in phases if p["status"]=="future"),None)
        return {"phases":phases,"current_phase":cur,"next_move":nm,"total_phases":len(phases),
            "summary":self._summary(cur,nm)}

    def get_time_place_score(self, city_name):
        cd = WORLD_CITIES.get(city_name)
        if not cd: return {"error":f"City '{city_name}' not found","score":0}
        reloc = RelocationChart(self.engine)
        ba = reloc.analyze_location(cd["lat"],cd["lng"],city_name)
        bs = ba.get("overall_score",50)
        from .travel_windows import TravelWindows
        tw = TravelWindows(self.engine)
        monthly = []; today = datetime.now()
        for m in range(6):
            d = today+timedelta(days=30*m)
            ms = tw._score_month(d,"general")
            combined = int(bs*0.6+ms["score"]*0.4)
            monthly.append({"month":ms["month"],"city_score":bs,"timing_score":ms["score"],
                "combined_score":combined,"favorable":combined>=60,"factors":ms.get("factors",[])})
        bm = max(monthly,key=lambda m:m["combined_score"])
        return {"city":city_name,"city_base_score":bs,"city_rating":ba.get("rating",""),
            "monthly_scores":monthly,"best_month":bm,
            "recommendation":f"{'Go' if bm['combined_score']>=60 else 'Reconsider'} — best: {bm['month']} ({bm['combined_score']}/100)"}

    def get_danger_zones(self):
        reloc = RelocationChart(self.engine); dz = []
        for cn,cd in WORLD_CITIES.items():
            a = reloc.analyze_location(cd["lat"],cd["lng"],cn); dangers=[]
            for p,s in a.get("planet_shifts",{}).items():
                nh = s.get("new_house",0)
                if p in ("Saturn","Mars","Rahu","Ketu"):
                    if nh==1: dangers.append(f"{p} in 1st — health pressure")
                    elif nh==8: dangers.append(f"{p} in 8th — crisis risk")
                    elif nh==6: dangers.append(f"{p} in 6th — conflict/legal")
                    elif nh==12: dangers.append(f"{p} in 12th — losses")
            if dangers: dz.append({"city":cn,"country":cd.get("country",""),"dangers":dangers,
                "severity":"high" if len(dangers)>=2 else "moderate","score":a.get("overall_score",50)})
        dz.sort(key=lambda d:len(d["dangers"]),reverse=True)
        return {"danger_zones":dz[:10],"total_checked":len(WORLD_CITIES)}

    def get_relationship_geography(self):
        reloc = RelocationChart(self.engine)
        lord_7 = RASHI_LORDS[(self.asc_rashi+6)%12]
        vh = self.planets.get("Venus",{}).get("house",0)
        dk = None
        try: dk = self.engine.get_jaimini_karakas().get("Darakaraka",{}).get("planet","")   # the engine capitalises its keys
        except: pass
        lc = []
        for cn,cd in WORLD_CITIES.items():
            a = reloc.analyze_location(cd["lat"],cd["lng"],cn)
            ls = a.get("scores",{}).get("love",50); bonuses=[]
            shifts = a.get("planet_shifts",{})
            vs = shifts.get("Venus",{})
            if vs.get("new_house") in (1,7,5): ls+=10; bonuses.append(f"Venus in H{vs['new_house']}")
            l7s = shifts.get(lord_7,{})
            if l7s.get("new_house") in (1,7,11): ls+=8; bonuses.append(f"7th lord {lord_7} in H{l7s['new_house']}")
            if dk and dk in shifts:
                dks = shifts[dk]
                if dks.get("new_house") in (1,7,5): ls+=8; bonuses.append(f"DK {dk} in H{dks['new_house']}")
            lc.append({"city":cn,"country":cd.get("country",""),"love_score":min(100,ls),"bonuses":bonuses})
        lc.sort(key=lambda c:c["love_score"],reverse=True)
        return {"love_cities":lc[:10],"best_for_love":lc[0] if lc else {},
            "love_planets":{"7th_lord":lord_7,"venus_house":vh,"darakaraka":dk}}

    def _best_city(self, reloc, purpose):
        best={"city":"","score":0}
        for cn in list(WORLD_CITIES.keys())[:20]:
            cd = WORLD_CITIES[cn]
            a = reloc.analyze_location(cd["lat"],cd["lng"],cn)
            s = a["scores"].get(purpose,a["scores"].get("overall",50))
            if s>best["score"]: best={"city":cn,"score":s}
        return best

    def _move_advice(self, lord):
        ml={"Rahu","Jupiter","Venus","Mercury"}; sm = lord in ml
        reasons = {"Saturn":"Stay, build, endure.","Rahu":"Foreign soil. Make the bold move.",
            "Jupiter":"Expand. Move to where growth lives.","Moon":"Stay close to home and roots.",
            "Ketu":"Visit spiritual places, don't uproot.","Venus":"Move to a city that feeds your senses.",
            "Mars":"Move only if the new place demands your effort.","Mercury":"Go where the connections are.",
            "Sun":"Be where you can be seen."}
        return {"should_move":sm,"confidence":"strong" if lord in ("Rahu","Jupiter") else "moderate",
            "reason":reasons.get(lord,"Stay or move based on circumstances.")}

    def _summary(self, cur, nm):
        parts=[]
        if cur: parts.append(f"Now: {cur['lord']} dasha — {cur['tendency']}. Best: {cur['best_city_type']}.")
        if nm: parts.append(f"Next: {nm['lord']} dasha ({nm['start']}). {nm['move_advice'].get('reason','')}")
        return " ".join(parts)