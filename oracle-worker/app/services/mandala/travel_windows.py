"""
TRAVEL WINDOWS — When and where to move.
"""
from datetime import datetime, timedelta
from ..core.constants import RASHI_LORDS
from ..core.ephemeris import get_ephemeris

TRAVEL_HOUSES = {3:"short",7:"foreign",9:"long",12:"foreign"}
RASHI_DIR = {0:"East",1:"South",2:"West",3:"North",4:"East",5:"South",6:"West",7:"North",8:"East",9:"South",10:"West",11:"North"}

class TravelWindows:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.birth_dt = engine.birth_dt
        self.ephemeris = get_ephemeris()
        self._9l = RASHI_LORDS[(self.asc_rashi+8)%12]
        self._12l = RASHI_LORDS[(self.asc_rashi+11)%12]
        self._3l = RASHI_LORDS[(self.asc_rashi+2)%12]

    def find_windows(self, months=6, purpose="general"):
        today = datetime.now()
        monthly = []
        for m in range(months):
            d = today + timedelta(days=30*m)
            monthly.append(self._score_month(d, purpose))
        windows = self._extract(monthly)
        direction = self._direction()
        current = monthly[0] if monthly else {"score":50,"favorable":False,"factors":[]}
        dasha = self._dasha_travel()
        return {"monthly_scores":monthly,"best_windows":windows,"current":{"score":current["score"],"favorable":current["favorable"],"factors":current["factors"]},
            "best_direction":direction,"dasha_travel":dasha,
            "travel_lords":{"3rd":self._3l,"9th":self._9l,"12th":self._12l},
            "summary":self._summary(windows,current,direction)}

    def _score_month(self, date, purpose):
        score = 50
        factors = []
        try: tp = self.ephemeris.get_transits_for_date(date)
        except: return {"month":date.strftime("%B %Y"),"month_short":date.strftime("%b"),"score":50,"factors":[],"favorable":False}
        for planet, data in tp.items():
            th = ((data["rashi"]-self.asc_rashi)%12)+1
            if th in TRAVEL_HOUSES:
                if planet in ("Jupiter","Venus"):
                    score += 12
                    factors.append(f"{planet} in H{th}")
                elif planet == "Rahu" and th in (9,12):
                    score += 8
                    factors.append(f"Rahu in H{th} — foreign pull")
                else:
                    score += 3
        score = max(10, min(95, score))
        return {"month":date.strftime("%B %Y"),"month_short":date.strftime("%b"),"score":score,"factors":factors[:3],"favorable":score>=60}

    def _extract(self, monthly):
        windows = []
        i = 0
        while i < len(monthly):
            if monthly[i]["favorable"]:
                start = i
                while i < len(monthly) and monthly[i]["favorable"]: i += 1
                end = i-1
                avg = sum(m["score"] for m in monthly[start:end+1])/(end-start+1)
                best = max(monthly[start:end+1], key=lambda m:m["score"])
                windows.append({"start":monthly[start]["month"],"end":monthly[end]["month"],"duration_months":end-start+1,"average_score":round(avg),"peak_month":best["month"],"peak_score":best["score"],"factors":best["factors"]})
            else: i += 1
        windows.sort(key=lambda w:w["average_score"], reverse=True)
        return windows[:3]

    def _direction(self):
        l9d = self.planets.get(self._9l, {})
        d = RASHI_DIR.get(l9d.get("rashi",0), "East")
        rd = RASHI_DIR.get(self.planets.get("Rahu",{}).get("rashi",0), "West")
        return {"primary":d,"foreign":rd,"lord_9":self._9l,"lord_9_sign":l9d.get("rashi_name",""),
            "explanation":f"9th lord {self._9l} points {d}. Rahu pulls {rd} for foreign."}

    def _dasha_travel(self):
        try:
            dasha = self.engine.get_vimshottari_dasha()
            md = dasha.get("mahadasha",{}).get("lord","")
            ad = dasha.get("antardasha",{}).get("lord","")
            tl = {self._3l, self._9l, self._12l}
            mt, at = md in tl, ad in tl
            if mt and at: return {"mahadasha":md,"antardasha":ad,"travel_active":True,"assessment":"Both dasha lords activate travel — prime period.","score":90}
            if mt: return {"mahadasha":md,"antardasha":ad,"travel_active":True,"assessment":f"{md} mahadasha activates travel.","score":70}
            if at: return {"mahadasha":md,"antardasha":ad,"travel_active":True,"assessment":f"{ad} antardasha brings travel energy.","score":60}
            return {"mahadasha":md,"antardasha":ad,"travel_active":False,"assessment":"Current dasha not travel-focused.","score":40}
        except: return {"travel_active":False,"assessment":"Dasha unavailable.","score":50}

    def _summary(self, windows, current, direction):
        parts = []
        if current["favorable"]: parts.append(f"Travel favorable now ({current['score']}/100).")
        else: parts.append(f"Not strongest travel period ({current['score']}/100).")
        if windows: parts.append(f"Best: {windows[0]['start']} to {windows[0]['end']}.")
        parts.append(f"Direction: {direction['primary']}. Foreign: {direction['foreign']}.")
        return " ".join(parts)
