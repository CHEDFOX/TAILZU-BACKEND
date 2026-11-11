"""
CHINESE ASTROLOGY — Chart Builder & Oracle Integration
Produces a Chinese-specific briefing for the Oracle LLM.
Chinese persona: philosophical, cyclical, elemental. Focus on balance and timing.
"""

from datetime import datetime
from typing import Dict

CHINESE_PERSONA = """You are a Chinese astrology master — philosophical, balanced, and elemental.
You speak in terms of Heavenly Stems, Earthly Branches, Five Elements, and the flow of Qi.
You see life as cycles within cycles — 10-year luck periods, annual influences, seasonal shifts.
Your language is calm, grounded, and wise. You use metaphors from nature.

When discussing personality, lead with the Day Master element and its strength.
When discussing relationships, reference element compatibility and branch interactions.
When discussing timing, reference luck periods, annual luck, and elemental balance.
When giving advice, focus on elemental remedies — what element to add or reduce.

4 to 6 wise sentences. No bullet points. Flowing insight like a river."""


CHINESE_METHOD_CATALOG = """AVAILABLE CHINESE METHODS (pick 3-6):

CHART:
1. get_chinese_chart — Full Four Pillars (BaZi) report
2. get_chinese_animal — Chinese zodiac animal sign
3. get_chinese_day_master — Day Master self-element
4. get_chinese_elements — Five element balance with favorable element
5. get_chinese_profile — Full Chinese profile

TIMING:
6. get_chinese_luck_periods — 10-year Da Yun periods
7. get_chinese_annual_luck(year) — How a specific year affects you
8. get_chinese_forecast — 5-year annual forecast

INTERACTIONS:
9. get_chinese_interactions — Branch clashes, harmonies, punishments, harms
10. get_chinese_stars — Symbolic stars: Nobleman, Peach Blossom, Traveling Horse, Academic

COMPATIBILITY:
11. get_chinese_compatibility — Zodiac + element + Day Master compatibility"""


def build_chinese_chart(engine) -> str:
    """Build a Chinese-specific chart briefing for the Oracle."""
    if hasattr(engine, '_chinese_chart_text') and engine._chinese_chart_text:
        return engine._chinese_chart_text

    lines = []

    try:
        from .bazi import BaZiChart
        bc = BaZiChart(engine.birth_local)
        pillars = bc.get_four_pillars()
        dm = bc.get_day_master()
        animal = bc.get_animal_sign()
        elements = bc.get_element_balance()

        lines.append("CHINESE CHART (BaZi / Four Pillars):")
        lines.append(f"Animal: {animal['full_sign']} | Day Master: {dm['full_name']}")
        lines.append(f"DM Strength: {elements['day_master_strength']} | Favorable Element: {elements['favorable_element']}")

        # Four Pillars
        lines.append("")
        lines.append("PILLARS:")
        for p_name in ['year', 'month', 'day', 'hour']:
            p = pillars[p_name]
            stem = p['stem']
            branch = p['branch']
            lines.append(f"  {p_name.capitalize()}: {stem['full']} / {branch['animal']} ({branch['full']})")

        # Element counts
        counts = elements['counts']
        lines.append(f"\nELEMENTS: Wood={counts['Wood']} Fire={counts['Fire']} Earth={counts['Earth']} Metal={counts['Metal']} Water={counts['Water']}")
        lines.append(f"Dominant: {elements['dominant_element']} | Weak: {elements['weakest_element']}")

        # Branch interactions
        try:
            from .interactions import BranchInteractions
            bi = BranchInteractions(bc)
            analysis = bi.analyze_all()
            clashes = analysis['clashes']
            harmonies = analysis['harmonies']
            if clashes:
                lines.append(f"\nCLASHES: {', '.join(c['branches'] for c in clashes)}")
            if harmonies:
                lines.append(f"HARMONIES: {', '.join(h['branches'] for h in harmonies)}")
        except Exception:
            pass

        # Symbolic stars
        try:
            from .stars import SymbolicStars
            ss = SymbolicStars(bc)
            stars = ss.analyze_all_stars()
            present = [name for name, data in stars.items() if data.get('present')]
            if present:
                lines.append(f"\nSTARS: {', '.join(s.replace('_', ' ').title() for s in present)}")
        except Exception:
            pass

        # Ten Gods
        try:
            ten_gods = bc.get_ten_gods()
            lines.append(f"\nTEN GODS: Year={ten_gods['year']} | Month={ten_gods['month']} | Hour={ten_gods['hour']}")
        except Exception:
            pass

    except Exception as e:
        lines.append(f"Chinese chart error: {str(e)[:100]}")

    result = "\n".join(lines)
    engine._chinese_chart_text = result
    return result


def build_chinese_system_prompt(intent: Dict, briefing: str, user_message: str) -> str:
    """Build Chinese-specific Oracle prompt."""
    language = intent.get("language", "english")
    lang_note = f"\nRespond in {language}." if language.lower() not in ("english", "en") else ""
    today = datetime.now().strftime("%B %d, %Y")

    return f"""{CHINESE_PERSONA}

TODAY: {today}{lang_note}

{briefing}

Maximum 120 words. Reference specific elements and branch interactions. End with one elemental remedy."""
