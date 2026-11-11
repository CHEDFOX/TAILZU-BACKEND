"""
BPHS Chapter 43 — Ashtakavarga Sodhana (Reduction)
Two-step reduction that removes false bindus:
1. Trikona Shodhana — removes from trine signs
2. Ekadhipati Shodhana — removes from co-owned signs
Without this, raw AV predictions are inflated.
"""
from typing import Dict, List

SIGN_LORDS = {
    0: 'Mars', 1: 'Venus', 2: 'Mercury', 3: 'Moon', 4: 'Sun', 5: 'Mercury',
    6: 'Venus', 7: 'Mars', 8: 'Jupiter', 9: 'Saturn', 10: 'Saturn', 11: 'Jupiter',
}

# Signs owned by the same planet (ekadhipati pairs)
EKADHIPATI_PAIRS = [
    (0, 7),   # Mars: Aries-Scorpio
    (1, 6),   # Venus: Taurus-Libra
    (2, 5),   # Mercury: Gemini-Virgo
    (8, 11),  # Jupiter: Sagittarius-Pisces
    (9, 10),  # Saturn: Capricorn-Aquarius
]

# Trikona groups (signs 120° apart)
TRIKONA_GROUPS = [
    [0, 4, 8],   # Fire: Aries, Leo, Sagittarius
    [1, 5, 9],   # Earth: Taurus, Virgo, Capricorn
    [2, 6, 10],  # Air: Gemini, Libra, Aquarius
    [3, 7, 11],  # Water: Cancer, Scorpio, Pisces
]


def trikona_shodhana(bindus: List[int]) -> List[int]:
    """
    Step 1: Trikona reduction.
    For each trikona group (fire/earth/air/water signs),
    find the minimum bindu count and subtract it from all three.
    """
    result = list(bindus)

    for group in TRIKONA_GROUPS:
        values = [result[i] for i in group]
        minimum = min(values)
        for i in group:
            result[i] -= minimum

    return result


def ekadhipati_shodhana(bindus: List[int]) -> List[int]:
    """
    Step 2: Ekadhipati reduction.
    For signs owned by the same planet, find the minimum
    and subtract from both. Exception: Sun (Leo only) and Moon (Cancer only)
    have single signs — no reduction needed.
    """
    result = list(bindus)

    for s1, s2 in EKADHIPATI_PAIRS:
        minimum = min(result[s1], result[s2])
        result[s1] -= minimum
        result[s2] -= minimum

    return result


def full_sodhana(bindus: List[int]) -> Dict:
    """Apply both reductions in order per BPHS."""
    if len(bindus) != 12:
        return {'error': 'Need 12 bindu values (one per sign)'}

    original = list(bindus)
    after_trikona = trikona_shodhana(bindus)
    after_ekadhipati = ekadhipati_shodhana(after_trikona)

    sign_names = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo',
                  'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces']

    details = []
    for i in range(12):
        details.append({
            'sign': sign_names[i],
            'original': original[i],
            'after_trikona': after_trikona[i],
            'after_sodhana': after_ekadhipati[i],
            'reduced_by': original[i] - after_ekadhipati[i],
        })

    return {
        'original_total': sum(original),
        'reduced_total': sum(after_ekadhipati),
        'total_reduced_by': sum(original) - sum(after_ekadhipati),
        'details': details,
        'reduced_bindus': after_ekadhipati,
    }


def calculate_sodhana_for_all(ashtakavarga_data: Dict) -> Dict:
    """Apply sodhana to all planet charts and SAV."""
    results = {}

    # The ashtakavarga engine returns bindus as {rashi_index: count} dicts under
    # `bindus_by_rashi`. This read `bindus` and `by_rashi`, so every planet chart
    # was skipped — and for the SAV it took a 12-key dict as a 12-item list,
    # where iterating yields the KEYS: the "bindus" it reduced were the sign
    # indices 0..11 (total 66), not the counts (total 337). Shodhya Pinda reads
    # this output, so it was wrong too.
    def _twelve(x):
        if isinstance(x, (list, tuple)) and len(x) == 12:
            return [int(v or 0) for v in x]
        if isinstance(x, dict) and len(x) == 12:
            try:
                return [int(x.get(i, x.get(str(i), 0)) or 0) for i in range(12)]
            except (TypeError, ValueError):
                return None
        return None

    for planet, chart in (ashtakavarga_data.get('planet_charts') or {}).items():
        if not isinstance(chart, dict):
            continue
        bindus = (_twelve(chart.get('bindus')) or _twelve(chart.get('by_rashi'))
                  or _twelve(chart.get('bindus_by_rashi')))
        if bindus:
            results[planet] = full_sodhana(bindus)

    # SAV (Sarvashtakavarga) sodhana
    sav_bindus = _twelve(ashtakavarga_data.get('bindus_by_rashi'))
    if sav_bindus:
        results['SAV'] = full_sodhana(sav_bindus)

    return results

