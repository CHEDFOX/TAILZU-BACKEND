"""
NUMEROLOGY — today's numbers and what they prescribe.

Pure arithmetic (no engine needed): from the birth date + the current date we
derive the Personal Year / Month / Day, and from the person's root number the
standing lucky colour / day / gem / direction. All self-contained, never raises.
"""

from datetime import datetime
from typing import Dict, Optional


def _reduce(n: int) -> int:
    """Digital root 1–9 (0 only if input is 0)."""
    n = abs(int(n))
    while n > 9:
        n = sum(int(d) for d in str(n))
    return n


# root number → standing associations (Chaldean/Vedic blend, widely used)
NUMBER_TRAITS = {
    1: {'planet': 'Sun',     'colors': 'red, orange, gold',        'day': 'Sunday',    'gem': 'ruby',          'direction': 'East',      'theme': 'leadership, fresh starts, independence'},
    2: {'planet': 'Moon',    'colors': 'white, cream, silver',     'day': 'Monday',    'gem': 'pearl',         'direction': 'North-West','theme': 'cooperation, sensitivity, patience'},
    3: {'planet': 'Jupiter', 'colors': 'yellow, gold',             'day': 'Thursday',  'gem': 'yellow sapphire','direction': 'North-East','theme': 'creativity, expression, expansion'},
    4: {'planet': 'Rahu',    'colors': 'grey, khaki, electric blue','day': 'Saturday', 'gem': 'hessonite',     'direction': 'South-West','theme': 'structure, discipline, steady work'},
    5: {'planet': 'Mercury', 'colors': 'green',                    'day': 'Wednesday', 'gem': 'emerald',       'direction': 'North',     'theme': 'communication, change, movement'},
    6: {'planet': 'Venus',   'colors': 'pink, white, pastels',     'day': 'Friday',    'gem': 'diamond',       'direction': 'South-East','theme': 'love, beauty, home, comfort'},
    7: {'planet': 'Ketu',    'colors': 'purple, sea-green, white', 'day': 'Monday',    'gem': "cat's eye",     'direction': 'North-West','theme': 'intuition, study, rest, the inner life'},
    8: {'planet': 'Saturn',  'colors': 'black, dark blue',         'day': 'Saturday',  'gem': 'blue sapphire', 'direction': 'West',      'theme': 'career, money, discipline, the long game'},
    9: {'planet': 'Mars',    'colors': 'red, crimson',             'day': 'Tuesday',   'gem': 'red coral',     'direction': 'South',     'theme': 'energy, completion, courage'},
}

# personal-day number → what the day is best used for
DAY_GUIDANCE = {
    1: 'a day to initiate — begin, lead, decide. Plant the seed.',
    2: 'a day to cooperate and wait — partner, listen, let things ripen. Avoid forcing.',
    3: 'a day to express and connect — create, socialise, communicate.',
    4: 'a day to organise and work — handle details, build, tidy the foundations.',
    5: 'a day for change and movement — travel, variety, new contacts. Stay flexible.',
    6: 'a day for home and responsibility — family, love, healing, duty.',
    7: 'a day to reflect and rest — study, plan, retreat inward. Not for big launches.',
    8: 'a day for money and decisions — business, ambition, the big moves.',
    9: 'a day to finish and release — complete, give, let go. Clear the deck.',
}


def _date_parts(birth_data) -> Optional[tuple]:
    try:
        return int(birth_data['day']), int(birth_data['month']), int(birth_data['year'])
    except Exception:
        return None


def today_guidance(birth_data: Dict, when: Optional[datetime] = None) -> Dict:
    """birth_data: {day, month, year}. Returns today's numerology guidance."""
    now = when or datetime.now()
    bp = _date_parts(birth_data or {})
    out: Dict = {'date': now.strftime('%A, %d %B %Y')}

    # Universal day — the day's own number, shared by everyone
    out['universal_day'] = _reduce(now.year + now.month + now.day)

    if not bp:
        out['note'] = 'birth date unavailable — only the universal day is shown'
        out['universal'] = NUMBER_TRAITS.get(out['universal_day'], {})
        return out

    bday, bmonth, byear = bp
    root = _reduce(bday)                                  # root / psychic number
    life_path = _reduce(byear + bmonth + bday)            # destiny / life path
    personal_year = _reduce(bmonth + bday + now.year)
    personal_month = _reduce(personal_year + now.month)
    personal_day = _reduce(personal_month + now.day)

    out.update({
        'root_number': root,
        'life_path': life_path,
        'personal_year': personal_year,
        'personal_month': personal_month,
        'personal_day': personal_day,
        'standing': NUMBER_TRAITS.get(root, {}),           # your lasting lucky colour/day/gem
        'today_is': DAY_GUIDANCE.get(personal_day, ''),
        'today_lucky': NUMBER_TRAITS.get(personal_day, {}),# the day's number colour/direction
    })
    return out


def briefing(birth_data: Dict, when: Optional[datetime] = None) -> str:
    """A compact text block for the chat pipeline / LLM grounding."""
    g = today_guidance(birth_data, when)
    lines = [f"NUMEROLOGY — {g.get('date', '')}"]
    if 'personal_day' in g:
        st = g.get('standing', {})
        ld = g.get('today_lucky', {})
        lines.append(
            f"Root number {g['root_number']} (life path {g['life_path']}). "
            f"Personal year {g['personal_year']}, month {g['personal_month']}, day {g['personal_day']}."
        )
        lines.append(f"Today is {g.get('today_is', '')}")
        if ld:
            lines.append(f"Today's number {g['personal_day']}: lucky colour {ld.get('colors','')}, "
                         f"direction {ld.get('direction','')}, gem {ld.get('gem','')}.")
        if st:
            lines.append(f"Standing (root {g['root_number']}): colours {st.get('colors','')}, lucky day {st.get('day','')}, "
                         f"gem {st.get('gem','')}, favourable direction {st.get('direction','')}.")
    else:
        lines.append(f"Universal day number {g.get('universal_day','')}. {g.get('note','')}")
    return "\n".join(lines)
