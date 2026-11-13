from ..core.constants import RASHI_LORDS
import math

SACRED_SITES = [
    {"name":"Varanasi","lat":25.32,"lng":83.01,"deity":"Shiva","planet":"Saturn","theme":"Death and liberation — where karma dissolves"},
    {"name":"Rishikesh","lat":30.09,"lng":78.27,"deity":"Vishnu","planet":"Jupiter","theme":"Spiritual learning and yoga — guru energy"},
    {"name":"Tirupati","lat":13.63,"lng":79.42,"deity":"Balaji","planet":"Jupiter","theme":"Wealth through devotion"},
    {"name":"Haridwar","lat":29.95,"lng":78.16,"deity":"Ganga","planet":"Moon","theme":"Purification — emotional and karmic cleansing"},
    {"name":"Ujjain","lat":23.18,"lng":75.77,"deity":"Mahakala","planet":"Saturn","theme":"Time and death mastery"},
    {"name":"Amarnath","lat":34.22,"lng":75.50,"deity":"Shiva","planet":"Ketu","theme":"Detachment and divine revelation"},
    {"name":"Bodh Gaya","lat":24.70,"lng":84.99,"deity":"Buddha","planet":"Ketu","theme":"Enlightenment"},
    {"name":"Puri","lat":19.81,"lng":85.83,"deity":"Jagannath","planet":"Jupiter","theme":"Universal love and surrender"},
    {"name":"Rameswaram","lat":9.29,"lng":79.31,"deity":"Rama","planet":"Mars","theme":"Valor through devotion"},
    {"name":"Dwarka","lat":22.24,"lng":68.97,"deity":"Krishna","planet":"Moon","theme":"Divine play — joy as spiritual practice"},
    {"name":"Shirdi","lat":19.77,"lng":74.48,"deity":"Sai Baba","planet":"Jupiter","theme":"Universal faith beyond religion"},
    {"name":"Dharamsala","lat":32.22,"lng":76.32,"deity":"Dalai Lama lineage","planet":"Jupiter","theme":"Compassion — wisdom through suffering"},
    {"name":"Kamakhya","lat":26.17,"lng":91.71,"deity":"Shakti","planet":"Rahu","theme":"Raw feminine power — tantric transformation"},
    {"name":"Mount Kailash","lat":31.07,"lng":81.31,"deity":"Shiva","planet":"Ketu","theme":"The axis of the world — ultimate pilgrimage"},
    {"name":"Kedarnath","lat":30.73,"lng":79.07,"deity":"Shiva","planet":"Saturn","theme":"Endurance and devotion"},
    {"name":"Vrindavan","lat":27.58,"lng":77.70,"deity":"Krishna/Radha","planet":"Venus","theme":"Divine love — bhakti in purest form"},
    {"name":"Madurai","lat":9.92,"lng":78.12,"deity":"Meenakshi","planet":"Venus","theme":"Sacred feminine — marriage of Shiva and Shakti"},
    {"name":"Pushkar","lat":26.49,"lng":74.55,"deity":"Brahma","planet":"Sun","theme":"Creation itself — the only Brahma temple"},
    {"name":"Golden Temple","lat":31.62,"lng":74.88,"deity":"Waheguru","planet":"Sun","theme":"Equality and service"},
    {"name":"Ajmer Dargah","lat":26.45,"lng":74.64,"deity":"Chishti","planet":"Jupiter","theme":"Love beyond boundaries — Sufi devotion"},
    {"name":"Mecca","lat":21.42,"lng":39.83,"deity":"Allah","planet":"Sun","theme":"Absolute surrender and unity"},
    {"name":"Jerusalem","lat":31.77,"lng":35.23,"deity":"Multiple","planet":"Saturn","theme":"Convergence of faiths — karmic nexus"},
    {"name":"Lumbini","lat":27.47,"lng":83.28,"deity":"Buddha birthplace","planet":"Moon","theme":"Birth of compassion"},
]

class SacredSiteAlignment:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets
        self.asc_rashi = engine.ascendant_rashi
        self.birth_lat = engine.latitude
        self.birth_lng = engine.longitude

    def find_aligned_sites(self):
        lord_9 = RASHI_LORDS[(self.asc_rashi+8)%12]
        lord_12 = RASHI_LORDS[(self.asc_rashi+11)%12]
        lord_8 = RASHI_LORDS[(self.asc_rashi+7)%12]
        lord_5 = RASHI_LORDS[(self.asc_rashi+4)%12]
        sp_lords = {lord_9, lord_12, lord_8, lord_5}
        ak = None
        try:
            k = self.engine.get_jaimini_karakas()
            ak = k.get("Atmakaraka",{}).get("planet","")   # the engine capitalises its keys
        except: pass
        scored = []
        for site in SACRED_SITES:
            sp = site.get("planet",""); score=0; reasons=[]
            if sp in sp_lords: score+=15; reasons.append(f"{sp} rules your spiritual houses")
            if sp == ak: score+=12; reasons.append(f"{sp} is your Atmakaraka")
            pd = self.planets.get(sp,{}); ph = pd.get("house",0)
            if ph in (9,12,5,8): score+=10; reasons.append(f"{sp} in H{ph}")
            elif ph in (1,4,10): score+=5; reasons.append(f"{sp} angular")
            dist = math.sqrt((site["lat"]-self.birth_lat)**2+((site["lng"]-self.birth_lng)*math.cos(math.radians(self.birth_lat)))**2)
            if dist<5: score+=5; reasons.append("Near birth location")
            if score>0:
                scored.append({"name":site["name"],"lat":site["lat"],"lng":site["lng"],
                    "deity":site["deity"],"theme":site["theme"],"score":score,"reasons":reasons,
                    "alignment":"strong" if score>=20 else "moderate" if score>=10 else "light"})
        scored.sort(key=lambda s:s["score"],reverse=True)
        return {"aligned_sites":scored[:10],"top_pilgrimage":scored[0] if scored else None,
            "spiritual_lords":{"9th_dharma":lord_9,"12th_moksha":lord_12,"8th_transform":lord_8,"5th_punya":lord_5},
            "atmakaraka":ak,"total_sites":len(SACRED_SITES)}