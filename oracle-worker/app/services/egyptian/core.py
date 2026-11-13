"""
EGYPTIAN DECANS — the 36 decans (ten-degree divisions of the zodiac).

Decan names and the Chaldean decanate rulers are from the vedika-io/xalen-ephemeris
crate (VERIFIED there: decan 1 Aries = Khnumis/Mars, decan 4 Taurus = Mercury, degrees
contiguous 0..360). Your decan = the decan of the Sun's tropical longitude at birth,
computed with Swiss Ephemeris.
"""
import swisseph as swe

DECAN_NAMES = ["Khnumis", "Situ", "Kherau", "Arostoaris", "Usir-hau", "Sesmut", "Sothis", "Sit", "Khentet-hrt", "Khentet-kht", "Temu-hrt", "Ueshati-besheset", "Kher-khept-sahu", "Ha-djat", "Pehui-djat", "Temu-kht", "Ustha", "Seshmu", "Khentet-hru", "Qetui", "Hatedat", "Kher-khept-khentet", "Seshmu-hor", "Kenmu", "Semed", "Seret", "Sasa", "Kenmu-kht", "Sapu-khentet", "Kherp-khentet", "Hau", "Art", "Remen-hru-an-sah", "Thespy-hrt", "Uaret", "Phui-hor"]
CHALDEAN_RULERS = ["Mars", "Sun", "Venus", "Mercury", "Moon", "Saturn", "Jupiter"]
SIGNS = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"]
PLANET_SEED = {
    "Mars": "drive, courage, the will to act",
    "Sun": "vitality, selfhood, the light you shine",
    "Venus": "love, beauty, what you draw near",
    "Mercury": "mind, skill, the quick tongue",
    "Moon": "emotion, instinct, what makes you feel safe",
    "Saturn": "discipline, time, mastery through limit",
    "Jupiter": "expansion, fortune, meaning and growth",
}


def egyptian_decan(year, month, day, hour=12, minute=0):
    jd = swe.julday(int(year), int(month), int(day), int(hour) + int(minute) / 60.0)
    lon = swe.calc_ut(jd, swe.SUN)[0][0] % 360.0
    idx = int(lon // 10) % 36
    ruler = CHALDEAN_RULERS[idx % 7]
    return {
        "index": idx, "number": idx + 1, "name": DECAN_NAMES[idx],
        "sign": SIGNS[idx // 3], "decan_in_sign": idx % 3 + 1,
        "ruler": ruler, "ruler_seed": PLANET_SEED[ruler],
        "sun_longitude": round(lon, 2),
    }
