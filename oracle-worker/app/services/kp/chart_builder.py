"""
KP SYSTEM — Chart Builder & Oracle Integration
Produces a KP-specific briefing for the Oracle LLM.
KP persona: precise, scientific, evidence-based. No mysticism — only significators and sub-lords.
"""

from datetime import datetime
from typing import Dict

# KP Ayanamsa: 23°06'42" as of Jan 1, 1900 + annual precession ~50.28"
# This is the Krishnamurti ayanamsa, slightly different from Lahiri
KP_AYANAMSA_RATE = 50.2388475  # arc-seconds per year
KP_AYANAMSA_1900 = 22.362306   # degrees at Jan 1, 1900 (KP value)


def get_kp_ayanamsa(year: float) -> float:
    """Calculate KP ayanamsa for a given year (fractional)."""
    return KP_AYANAMSA_1900 + (year - 1900) * KP_AYANAMSA_RATE / 3600


KP_PERSONA = """You are a KP (Krishnamurti Paddhati) astrologer — precise, scientific, evidence-based.
You speak in terms of significators, sub-lords, cuspal sub-lords, ruling planets, and house groupings.
You do NOT use mystical language. You present findings like a doctor presenting test results — clear, specific, actionable.

When you say YES or NO, you cite the cuspal sub-lord, its signified houses, and whether they match.
When you give timing, you reference DBA periods and transit triggers.
When you give remedies, you say "KP does not prescribe remedies — it reveals timing and promise."

4 to 6 precise sentences. No poetry. No headers. Just analysis."""


KP_METHOD_CATALOG = """AVAILABLE KP METHODS (pick 3-6):

PROMISE/DENIAL:
1. get_kp_complete — Full KP report: cusps, significators, event analysis
2. kp_event_analysis(topic) — CSL-based YES/NO. Topics: marriage,career,wealth,childbirth,education,travel_foreign,property,health_issue
3. kp_verify_event(topic) — CSL + Ruling Planet verification

TIMING:
4. get_kp_timing(topic) — DBA + Transit trigger combined timing
5. get_kp_dba_scan — Scan which events are active in current DBA
6. get_kp_transit_triggers(topic) — Current transit planets triggering event

ANALYSIS:
7. get_kp_significators — All planet significators (4-level chain)
8. get_kp_cusps — Placidus cusps with sub-lords
9. get_kp_ruling_planets — Current moment ruling planets

HORARY:
10. kp_horary(number,question,category) — Number-based 1-249 yes/no"""


def build_kp_chart(engine) -> str:
    """
    Build a KP-specific chart briefing for the Oracle.
    Focuses on cuspal sub-lords, significators, and DBA — not yogas or dignity.
    """
    if hasattr(engine, '_kp_chart_text') and engine._kp_chart_text:
        return engine._kp_chart_text

    lines = []
    planets = engine.planets
    asc = engine.ascendant

    lines.append("KP CHART:")
    lines.append(f"Ascendant: {asc.get('rashi_name', '')} {round(asc.get('longitude', 0) % 30, 2)}°")

    # Planets with star lord and sub lord
    for name in ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]:
        d = planets.get(name, {})
        p_long = d.get('longitude', 0)
        nak_idx = int(p_long / (360 / 27)) % 27
        from ..core.constants import NAKSHATRA_LORDS
        star_lord = NAKSHATRA_LORDS[nak_idx]

        from .kp_complete import KPComplete
        # Quick sub-lord calc
        kpc = KPComplete(engine)
        sub_lord = kpc._get_sub_lord(p_long)

        retro = " R" if d.get("retrograde") else ""
        lines.append(f"{name}: {d.get('rashi_name', '')} H{d.get('house', '?')} | Star: {star_lord} | Sub: {sub_lord}{retro}")

    # Cuspal sub-lords (the heart of KP)
    try:
        kpc = KPComplete(engine)
        cusps = kpc.get_placidus_cusps()
        lines.append("")
        lines.append("CUSPAL SUB-LORDS:")
        for h in range(1, 13):
            c = cusps.get(h, {})
            lines.append(f"  H{h}: {c.get('sub_lord', '?')} in {c.get('rashi_name', '')}")
    except Exception:
        pass

    # Current dasha (for DBA reference)
    try:
        dasha = engine.get_vimshottari_dasha()
        lines.append("")
        lines.append(f"CURRENT DBA: {dasha.get('dasha_string', 'unknown')}")
    except Exception:
        pass

    result = "\n".join(lines)
    engine._kp_chart_text = result
    return result


def build_kp_system_prompt(intent: Dict, briefing: str, user_message: str) -> str:
    """Build KP-specific Oracle prompt."""
    language = intent.get("language", "english")
    lang_note = f"\nRespond in {language}." if language.lower() not in ("english", "en") else ""
    today = datetime.now().strftime("%B %d, %Y")

    return f"""{KP_PERSONA}

TODAY: {today}{lang_note}

{briefing}

Maximum 120 words. Cite specific cuspal sub-lords and significators. End with one timing observation."""
