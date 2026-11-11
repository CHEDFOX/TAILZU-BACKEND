"""
JYOTISH ENGINE - COMPLETE NUMEROLOGY SYSTEM
8 sub-systems:
1. Mulank (Birth/Root Number) — day of birth
2. Bhagyank (Destiny Number) — full birthdate
3. Namank (Name Number) — Chaldean + Pythagorean
4. Lo Shu Grid — missing/repeated numbers
5. Lucky Numbers — colors, days, directions, gems
6. Name Correction Engine — spelling optimization
7. Compound Numbers (1-52) — Chaldean specific meanings
8. Personal Year/Month/Day — what rules TODAY
"""

from datetime import datetime, date
from typing import Dict

# Chaldean number mapping (more accurate, used in India)
CHALDEAN = {
    'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 8, 'G': 3, 'H': 5,
    'I': 1, 'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'O': 7, 'P': 8,
    'Q': 1, 'R': 2, 'S': 3, 'T': 4, 'U': 6, 'V': 6, 'W': 6, 'X': 5,
    'Y': 1, 'Z': 7,
}

# Pythagorean mapping (Western system)
PYTHAGOREAN = {
    'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
    'I': 9, 'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'O': 6, 'P': 7,
    'Q': 8, 'R': 9, 'S': 1, 'T': 2, 'U': 3, 'V': 4, 'W': 5, 'X': 6,
    'Y': 7, 'Z': 8,
}

# Master numbers (not reduced further)
MASTER_NUMBERS = {11, 22, 33}

# Number meanings (root 1-9)
NUMBER_MEANINGS = {
    1: {
        'name': 'The Leader',
        'planet': 'Sun',
        'traits': 'Independent, ambitious, pioneering, dominant, original, creative',
        'strengths': 'Leadership, initiative, determination, innovation',
        'weaknesses': 'Ego, stubbornness, loneliness, aggression',
        'career': 'CEO, entrepreneur, politics, military, inventor',
        'compatible': [1, 3, 5, 9],
        'color': 'Gold, Orange, Yellow',
        'day': 'Sunday',
        'gem': 'Ruby, Garnet',
        'direction': 'East',
    },
    2: {
        'name': 'The Diplomat',
        'planet': 'Moon',
        'traits': 'Sensitive, cooperative, peaceful, intuitive, emotional, artistic',
        'strengths': 'Diplomacy, partnership, patience, empathy',
        'weaknesses': 'Indecisive, oversensitive, dependent, moody',
        'career': 'Counselor, diplomat, artist, musician, healer',
        'compatible': [2, 4, 6, 8],
        'color': 'White, Silver, Cream, Light Green',
        'day': 'Monday',
        'gem': 'Pearl, Moonstone',
        'direction': 'Northwest',
    },
    3: {
        'name': 'The Communicator',
        'planet': 'Jupiter',
        'traits': 'Expressive, joyful, creative, social, optimistic, talented',
        'strengths': 'Communication, creativity, humor, enthusiasm',
        'weaknesses': 'Scattered, superficial, gossipy, extravagant',
        'career': 'Writer, actor, teacher, marketing, entertainer',
        'compatible': [1, 3, 5, 6, 9],
        'color': 'Yellow, Purple, Violet',
        'day': 'Thursday',
        'gem': 'Yellow Sapphire, Amethyst',
        'direction': 'Northeast',
    },
    4: {
        'name': 'The Builder',
        'planet': 'Rahu (Uranus)',
        'traits': 'Disciplined, practical, hardworking, stable, systematic, loyal',
        'strengths': 'Organization, persistence, reliability, detail',
        'weaknesses': 'Rigid, stubborn, boring, workaholic, resistant to change',
        'career': 'Engineer, architect, accountant, manager, scientist',
        'compatible': [2, 4, 6, 8],
        'color': 'Blue, Grey, Khaki',
        'day': 'Saturday (or Wednesday)',
        'gem': 'Hessonite (Gomed), Blue Sapphire',
        'direction': 'Southwest',
    },
    5: {
        'name': 'The Freedom Seeker',
        'planet': 'Mercury',
        'traits': 'Adventurous, versatile, energetic, curious, quick, magnetic',
        'strengths': 'Adaptability, resourcefulness, communication, travel',
        'weaknesses': 'Restless, irresponsible, inconsistent, addictive tendencies',
        'career': 'Sales, travel, media, trading, journalism, tech',
        'compatible': [1, 3, 5, 7, 9],
        'color': 'Green, Light Grey',
        'day': 'Wednesday',
        'gem': 'Emerald, Green Tourmaline',
        'direction': 'North',
    },
    6: {
        'name': 'The Nurturer',
        'planet': 'Venus',
        'traits': 'Loving, responsible, domestic, artistic, harmonious, devoted',
        'strengths': 'Love, care, beauty, harmony, responsibility',
        'weaknesses': 'Controlling, self-sacrificing, jealous, possessive',
        'career': 'Doctor, interior design, hospitality, fashion, cosmetics, music',
        'compatible': [2, 3, 4, 6, 9],
        'color': 'Pink, White, Light Blue',
        'day': 'Friday',
        'gem': 'Diamond, Opal, White Sapphire',
        'direction': 'Southeast',
    },
    7: {
        'name': 'The Seeker',
        'planet': 'Ketu (Neptune)',
        'traits': 'Spiritual, analytical, mysterious, introverted, wise, intuitive',
        'strengths': 'Analysis, spirituality, intuition, research, wisdom',
        'weaknesses': 'Isolated, secretive, suspicious, pessimistic, eccentric',
        'career': 'Researcher, scientist, philosopher, occultist, programmer, detective',
        'compatible': [5, 7],
        'color': 'White, Light Green, Grey',
        'day': 'Monday (or Tuesday)',
        'gem': "Cat's Eye, Chrysoberyl",
        'direction': 'Southwest',
    },
    8: {
        'name': 'The Powerhouse',
        'planet': 'Saturn',
        'traits': 'Ambitious, authoritative, karmic, material, executive, strong-willed',
        'strengths': 'Power, management, finance, endurance, authority',
        'weaknesses': 'Ruthless, materialistic, workaholic, misunderstood, lonely',
        'career': 'Banking, real estate, law, politics, corporate leadership',
        'compatible': [2, 4, 6, 8],
        'color': 'Black, Dark Blue, Grey',
        'day': 'Saturday',
        'gem': 'Blue Sapphire, Amethyst',
        'direction': 'West',
    },
    9: {
        'name': 'The Humanitarian',
        'planet': 'Mars',
        'traits': 'Compassionate, generous, idealistic, courageous, passionate, global',
        'strengths': 'Courage, generosity, leadership, completion, universal love',
        'weaknesses': 'Aggressive, impulsive, emotional, self-sacrificing, temperamental',
        'career': 'Military, surgery, sports, NGO, fire service, social work',
        'compatible': [1, 3, 5, 6, 9],
        'color': 'Red, Scarlet, Crimson',
        'day': 'Tuesday',
        'gem': 'Red Coral, Bloodstone',
        'direction': 'South',
    },
}

# Master number meanings
MASTER_MEANINGS = {
    11: {
        'name': 'The Master Intuitive',
        'traits': 'Visionary, psychic, inspirational, idealistic, extremely sensitive',
        'mission': 'To inspire and illuminate others through heightened intuition',
        'challenge': 'Nervous energy, self-doubt, living up to massive potential',
        'career': 'Spiritual teacher, inventor, artist, healer, counselor',
    },
    22: {
        'name': 'The Master Builder',
        'traits': 'Practical visionary, architect of dreams, massive ambition grounded in reality',
        'mission': 'To build something of lasting value that serves humanity',
        'challenge': 'Overwhelming pressure, fear of failure at grand scale',
        'career': 'Architecture, politics, large-scale business, infrastructure, technology',
    },
    33: {
        'name': 'The Master Healer',
        'traits': 'Selfless devotion, cosmic compassion, teacher of teachers',
        'mission': 'To heal and uplift humanity through love and sacrifice',
        'challenge': 'Martyrdom, burnout from over-giving, unrealistic expectations',
        'career': 'Healing, religious leadership, charity, counseling at highest level',
    },
}

# Compound number meanings (Chaldean 10-52)
COMPOUND_MEANINGS = {
    10: ('Wheel of Fortune', 'Rise and fall, new beginnings, luck followed by change'),
    11: ('Hidden Dangers', 'Treachery from others, hidden enemies, but also spiritual power'),
    12: ('Sacrifice', 'Suffering for others, anxiety, victim of others plans, but spiritual growth'),
    13: ('Transformation', 'Power of destruction and rebirth, upheaval leading to new life'),
    14: ('Movement', 'Risk from elements, travel, change, magnetic personality'),
    15: ('Magic', 'Eloquence, gifts of music and art, magnetic, temptation'),
    16: ('Tower', 'Catastrophe leading to awakening, ego destruction, humbling'),
    17: ('Star', 'Immortality, rising above trials, peace after storms, spiritual awakening'),
    18: ('Moon', 'Deception, family quarrels, enemies, but also spiritual progress through conflict'),
    19: ('Sun', 'Prince of Heaven, happiness, success, esteem, honor, the most fortunate'),
    20: ('Awakening', 'Delay, hindrance, but eventual success through spiritual awakening'),
    21: ('The World', 'Advancement, honors, elevation, success after struggle'),
    22: ('Illusion', 'Good person surrounded by bad advisors, false judgment'),
    23: ('Royal Star', 'Success, help from superiors, protection, love of people'),
    24: ('Love', 'Assistance from opposite sex, gain through love, creative harmony'),
    25: ('Wisdom', 'Strength gained through experience, observation, learning from past'),
    26: ('Partnerships', 'Disasters through bad partnerships, warnings about associations'),
    27: ('Command', 'Authority, reward, leadership through intellectual power'),
    28: ('Opposition', 'Great promise but loss through others, legal troubles, trust issues'),
    29: ('Grace', 'Uncertainties, unexpected events, but spiritual protection'),
    30: ('Loner', 'Neither success nor failure, retrospection, mental supremacy over emotions'),
    31: ('Isolation', 'Similar to 30 but more isolated, self-contained, intellectual'),
    32: ('Communication', 'Magical power of communication, influence over masses'),
    33: ('Brilliance', 'Same as 24 but amplified, creative genius, world influence'),
    34: ('Suffering', 'Same as 25 but with more struggle before wisdom comes'),
    35: ('Explorer', 'Same as 26, business-oriented, risk in partnerships'),
    36: ('Genius', 'Same as 27 but creative rather than commanding'),
    37: ('Family', 'Good for love and friendship, creativity, gain through partnerships'),
    38: ('Struggle', 'Same as 29, hardship leads to spiritual growth'),
    39: ('Growth', 'Same as 30, but through helping others, teacher number'),
    40: ('Organizer', 'Same as 31, but more practical, executive ability'),
    41: ('Leader', 'Same as 32, magnetic leader, communication genius'),
    42: ('Endurance', 'Same as 24, creative love through patience'),
    43: ('Revolution', 'Same as 34, upheaval leading to new order'),
    44: ('Material', 'Same as 26, danger in material pursuits, hidden dangers'),
    45: ('Wisdom Elder', 'Same as 27, great wisdom gained through age and experience'),
    46: ('Abundance', 'Same as 37, love and creative abundance'),
    47: ('Spirit', 'Same as 29, divine grace and spiritual protection'),
    48: ('Advisor', 'Same as 30, counsel to others, wisdom through reflection'),
    49: ('Reward', 'Same as 31, solitary achievement, intellectual reward'),
    50: ('Communication Power', 'Same as 32, amplified communication, media mogul'),
    51: ('Warrior', 'Same as 33, creative warrior, fights for ideals'),
    52: ('Fortune', 'Same as 25, wisdom through experience, eventual great fortune'),
}


def _reduce_to_root(num: int) -> int:
    """Reduce number to single digit (1-9) or master number."""
    while num > 9 and num not in MASTER_NUMBERS:
        num = sum(int(d) for d in str(num))
    return num

def _digit_sum(num: int) -> int:
    """Sum digits without master number check."""
    while num > 9:
        num = sum(int(d) for d in str(num))
    return num


class NumerologyEngine:
    def __init__(self, name: str = '', birth_date: date = None):
        self.name = name.upper().strip()
        self.birth_date = birth_date

    # ═══════════════════════════════════════════════════════════════
    # 1. MULANK (Birth/Root Number)
    # ═══════════════════════════════════════════════════════════════

    def get_mulank(self) -> Dict:
        """Root number from day of birth. Most important personal number."""
        if not self.birth_date:
            return {'error': 'Birth date required'}
        day = self.birth_date.day
        mulank = _reduce_to_root(day)
        meaning = NUMBER_MEANINGS.get(mulank, {})
        return {
            'number': mulank,
            'birth_day': day,
            'name': meaning.get('name', ''),
            'planet': meaning.get('planet', ''),
            'traits': meaning.get('traits', ''),
            'strengths': meaning.get('strengths', ''),
            'weaknesses': meaning.get('weaknesses', ''),
            'career': meaning.get('career', ''),
            'compatible_numbers': meaning.get('compatible', []),
            'color': meaning.get('color', ''),
            'day': meaning.get('day', ''),
            'gem': meaning.get('gem', ''),
            'direction': meaning.get('direction', ''),
        }

    # ═══════════════════════════════════════════════════════════════
    # 2. BHAGYANK (Destiny/Life Path Number)
    # ═══════════════════════════════════════════════════════════════

    def get_bhagyank(self) -> Dict:
        """Destiny number from full birthdate. Shows life purpose."""
        if not self.birth_date:
            return {'error': 'Birth date required'}
        d = self.birth_date
        total = _reduce_to_root(d.day) + _reduce_to_root(d.month) + _reduce_to_root(d.year)
        bhagyank = _reduce_to_root(total)

        meaning = NUMBER_MEANINGS.get(bhagyank if bhagyank <= 9 else _digit_sum(bhagyank), {})
        master = MASTER_MEANINGS.get(bhagyank, None) if bhagyank in MASTER_NUMBERS else None

        result = {
            'number': bhagyank,
            'is_master': bhagyank in MASTER_NUMBERS,
            'calculation': f'{d.day}/{d.month}/{d.year} → {_reduce_to_root(d.day)}+{_reduce_to_root(d.month)}+{_reduce_to_root(d.year)} = {total} → {bhagyank}',
            'name': meaning.get('name', ''),
            'planet': meaning.get('planet', ''),
            'traits': meaning.get('traits', ''),
            'career': meaning.get('career', ''),
        }
        if master:
            result['master_number'] = master
        return result

    # ═══════════════════════════════════════════════════════════════
    # 3. NAMANK (Name Number) — Chaldean + Pythagorean
    # ═══════════════════════════════════════════════════════════════

    def get_namank(self) -> Dict:
        """Name vibration number using both systems."""
        if not self.name:
            return {'error': 'Name required'}

        # Chaldean
        chaldean_total = sum(CHALDEAN.get(c, 0) for c in self.name if c.isalpha())
        chaldean_compound = chaldean_total
        chaldean_root = _reduce_to_root(chaldean_total)

        # Pythagorean
        pyth_total = sum(PYTHAGOREAN.get(c, 0) for c in self.name if c.isalpha())
        pyth_compound = pyth_total
        pyth_root = _reduce_to_root(pyth_total)

        # Letter breakdown
        breakdown = []
        for c in self.name:
            if c.isalpha():
                breakdown.append({
                    'letter': c,
                    'chaldean': CHALDEAN.get(c, 0),
                    'pythagorean': PYTHAGOREAN.get(c, 0),
                })

        chaldean_meaning = NUMBER_MEANINGS.get(chaldean_root, {})
        compound_info = COMPOUND_MEANINGS.get(chaldean_compound, ('', ''))

        return {
            'name': self.name,
            'chaldean': {
                'compound': chaldean_compound,
                'root': chaldean_root,
                'compound_name': compound_info[0],
                'compound_meaning': compound_info[1],
                'root_meaning': chaldean_meaning.get('name', ''),
            },
            'pythagorean': {
                'compound': pyth_compound,
                'root': pyth_root,
                'root_meaning': NUMBER_MEANINGS.get(pyth_root, {}).get('name', ''),
            },
            'letter_breakdown': breakdown,
            'primary_system': 'Chaldean (recommended for Indian names)',
        }

    # ═══════════════════════════════════════════════════════════════
    # 4. LO SHU GRID (Magic Square)
    # ═══════════════════════════════════════════════════════════════

    def get_lo_shu_grid(self) -> Dict:
        """Lo Shu Grid analysis — missing numbers = weaknesses."""
        if not self.birth_date:
            return {'error': 'Birth date required'}

        date_str = self.birth_date.strftime('%d%m%Y')
        digits = [int(d) for d in date_str if d != '0']

        # Lo Shu positions
        # 4 9 2
        # 3 5 7
        # 8 1 6
        grid = {i: digits.count(i) for i in range(1, 10)}

        missing = [n for n in range(1, 10) if grid[n] == 0]
        repeated = {n: grid[n] for n in range(1, 10) if grid[n] > 1}
        present = [n for n in range(1, 10) if grid[n] > 0]

        # Plane analysis
        planes = {
            'mental': {'numbers': [4, 9, 2], 'name': 'Mental Plane (thinking)'},
            'emotional': {'numbers': [3, 5, 7], 'name': 'Emotional Plane (feeling)'},
            'practical': {'numbers': [8, 1, 6], 'name': 'Practical Plane (doing)'},
            'thought': {'numbers': [4, 3, 8], 'name': 'Thought Arrow'},
            'will': {'numbers': [9, 5, 1], 'name': 'Will Arrow'},
            'action': {'numbers': [2, 7, 6], 'name': 'Action Arrow'},
            'determination': {'numbers': [4, 5, 6], 'name': 'Determination Arrow'},
            'emotional_balance': {'numbers': [2, 5, 8], 'name': 'Emotional Balance Arrow'},
            'activity': {'numbers': [3, 5, 7], 'name': 'Activity Arrow'},
        }

        complete_arrows = []
        missing_arrows = []
        for arrow_name, arrow_data in planes.items():
            nums = arrow_data['numbers']
            if all(grid[n] > 0 for n in nums):
                complete_arrows.append(arrow_data['name'])
            elif all(grid[n] == 0 for n in nums):
                missing_arrows.append(arrow_data['name'])

        missing_meanings = {
            1: 'Lack of self-confidence and communication skills',
            2: 'Oversensitive, lack of patience',
            3: 'Poor imagination, difficulty expressing self',
            4: 'Lack of organization and discipline',
            5: 'Emotional instability, fear of freedom',
            6: 'Difficulty in relationships and responsibility',
            7: 'Lack of spiritual interest, poor learning',
            8: 'Lack of financial management, careless about details',
            9: 'Selfish tendencies, lack of humanitarian concern',
        }

        repeated_meanings = {
            1: 'Strong communicator, expressive, can be verbose',
            2: 'Highly sensitive, empathetic, may be oversensitive',
            3: 'Very creative, imaginative, can be scattered',
            4: 'Extremely organized, can be rigid',
            5: 'Emotionally intense, freedom-loving, restless',
            6: 'Very loving, domestic, can be overprotective',
            7: 'Deeply spiritual/analytical, can be reclusive',
            8: 'Strong business sense, detail-oriented, workaholic',
            9: 'Highly idealistic, generous to a fault, ambitious',
        }

        return {
            'birth_date': self.birth_date.strftime('%d/%m/%Y'),
            'digits_used': digits,
            'grid': grid,
            'grid_visual': f"{grid[4]}{grid[9]}{grid[2]}\n{grid[3]}{grid[5]}{grid[7]}\n{grid[8]}{grid[1]}{grid[6]}",
            'missing_numbers': missing,
            'missing_meanings': {n: missing_meanings[n] for n in missing},
            'repeated_numbers': repeated,
            'repeated_meanings': {n: repeated_meanings[n] for n, c in repeated.items()},
            'present_numbers': present,
            'complete_arrows': complete_arrows,
            'missing_arrows': missing_arrows,
            'strength': 'Strong' if len(missing) <= 2 else 'Moderate' if len(missing) <= 4 else 'Weak',
        }

    # ═══════════════════════════════════════════════════════════════
    # 5. NAME CORRECTION ENGINE
    # ═══════════════════════════════════════════════════════════════

    def get_personal_year(self, year: int = None) -> Dict:
        """What number rules this year for you."""
        if not self.birth_date:
            return {'error': 'Birth date required'}
        if year is None:
            year = datetime.now().year

        py = _reduce_to_root(self.birth_date.day + self.birth_date.month + year)

        year_themes = {
            1: 'New beginnings, fresh start, independence, leadership opportunities',
            2: 'Partnerships, patience, cooperation, relationships deepen',
            3: 'Creativity, self-expression, socializing, joy, travel',
            4: 'Hard work, building foundation, discipline, structure, planning',
            5: 'Change, freedom, adventure, major life shifts, travel',
            6: 'Home, family, responsibility, love, domestic matters',
            7: 'Introspection, spirituality, study, alone time, analysis',
            8: 'Power, money, career advancement, authority, karma',
            9: 'Completion, endings, humanitarianism, release, letting go',
        }

        root = py if py <= 9 else _digit_sum(py)
        return {
            'year': year,
            'personal_year': root,
            'theme': year_themes.get(root, ''),
            'planet': NUMBER_MEANINGS.get(root, {}).get('planet', ''),
        }

    def get_personal_month(self, year: int = None, month: int = None) -> Dict:
        if not self.birth_date:
            return {'error': 'Birth date required'}
        now = datetime.now()
        if year is None: year = now.year
        if month is None: month = now.month
        py = self.get_personal_year(year)['personal_year']
        pm = _reduce_to_root(py + month)
        root = pm if pm <= 9 else _digit_sum(pm)
        return {
            'year': year, 'month': month,
            'personal_month': root,
            'planet': NUMBER_MEANINGS.get(root, {}).get('planet', ''),
            'traits': NUMBER_MEANINGS.get(root, {}).get('traits', ''),
        }

    def get_personal_day(self, target_date: date = None) -> Dict:
        if not self.birth_date:
            return {'error': 'Birth date required'}
        if target_date is None:
            target_date = date.today()
        pm = self.get_personal_month(target_date.year, target_date.month)['personal_month']
        pd = _reduce_to_root(pm + target_date.day)
        root = pd if pd <= 9 else _digit_sum(pd)
        return {
            'date': target_date.strftime('%Y-%m-%d'),
            'personal_day': root,
            'planet': NUMBER_MEANINGS.get(root, {}).get('planet', ''),
            'color': NUMBER_MEANINGS.get(root, {}).get('color', ''),
        }

    def check_compatibility(self, other_date: date) -> Dict:
        if not self.birth_date:
            return {'error': 'Birth date required'}
        m1 = _reduce_to_root(self.birth_date.day)
        b1 = _reduce_to_root(self.birth_date.day + self.birth_date.month + self.birth_date.year)
        if b1 in MASTER_NUMBERS: b1 = _digit_sum(b1)
        m2 = _reduce_to_root(other_date.day)
        b2 = _reduce_to_root(other_date.day + other_date.month + other_date.year)
        if b2 in MASTER_NUMBERS: b2 = _digit_sum(b2)
        compat1 = NUMBER_MEANINGS.get(m1, {}).get('compatible', [])
        mulank_match = m2 in compat1
        compat2 = NUMBER_MEANINGS.get(b1, {}).get('compatible', [])
        bhagyank_match = b2 in compat2
        cross1 = m1 in NUMBER_MEANINGS.get(b2, {}).get('compatible', [])
        cross2 = b1 in NUMBER_MEANINGS.get(m2, {}).get('compatible', [])
        score = sum([mulank_match * 25, bhagyank_match * 25, cross1 * 25, cross2 * 25])
        if score >= 75: verdict = 'Excellent compatibility'
        elif score >= 50: verdict = 'Good compatibility'
        elif score >= 25: verdict = 'Moderate — needs effort'
        else: verdict = 'Challenging — number clash'
        return {
            'person1': {'mulank': m1, 'bhagyank': b1},
            'person2': {'mulank': m2, 'bhagyank': b2},
            'mulank_match': mulank_match, 'bhagyank_match': bhagyank_match,
            'score': score, 'verdict': verdict,
        }

    def suggest_name_correction(self) -> Dict:
        if not self.name or not self.birth_date:
            return {'error': 'Both name and birth date required'}
        mulank = self.get_mulank()['number']
        bhagyank = self.get_bhagyank()['number']
        if bhagyank in MASTER_NUMBERS: bhagyank = _digit_sum(bhagyank)
        current = self.get_namank()
        current_root = current['chaldean']['root']
        compatible = NUMBER_MEANINGS.get(mulank, {}).get('compatible', [])
        ideal_numbers = [mulank, bhagyank] + compatible
        if current_root in ideal_numbers:
            return {
                'current_name': self.name, 'current_namank': current_root,
                'mulank': mulank, 'bhagyank': bhagyank,
                'verdict': 'GOOD — Name number compatible with birth numbers',
                'needs_correction': False, 'suggestions': [],
            }
        suggestions = []
        for letter, value in sorted(CHALDEAN.items(), key=lambda x: x[1]):
            new_name = self.name + letter
            new_total = sum(CHALDEAN.get(c, 0) for c in new_name if c.isalpha())
            new_root = _reduce_to_root(new_total)
            if new_root in ideal_numbers and new_name != self.name:
                suggestions.append({
                    'name': new_name, 'namank': new_root,
                    'change': f'Added "{letter}" at end',
                })
                if len(suggestions) >= 5:
                    break
        return {
            'current_name': self.name, 'current_namank': current_root,
            'mulank': mulank, 'bhagyank': bhagyank,
            'verdict': f'Name number {current_root} NOT compatible with birth ({mulank}/{bhagyank})',
            'needs_correction': True, 'ideal_numbers': ideal_numbers[:4],
            'suggestions': suggestions,
        }

    def generate_full_report(self) -> Dict:
        report = {
            'system': 'numerology',
            'category': 'personality',
            'triggers': ['name', 'number', 'lucky', 'numerology'],
        }
        if self.birth_date:
            report['mulank'] = self.get_mulank()
            report['bhagyank'] = self.get_bhagyank()
            report['lo_shu_grid'] = self.get_lo_shu_grid()
            report['personal_year'] = self.get_personal_year()
            report['personal_month'] = self.get_personal_month()
            report['personal_day'] = self.get_personal_day()
        if self.name:
            report['namank'] = self.get_namank()
            if self.birth_date:
                report['name_correction'] = self.suggest_name_correction()
        if self.birth_date:
            m = report.get('mulank', {})
            b = report.get('bhagyank', {})
            report['summary'] = (
                f"Mulank {m.get('number', '?')} ({m.get('name', '')}) — "
                f"Bhagyank {b.get('number', '?')} ({b.get('name', '')}). "
                f"Lucky color: {m.get('color', '')}. Lucky day: {m.get('day', '')}."
            )
            report['confidence'] = 0.80
        return report


def get_numerology(name='', birth_date=None):
    return NumerologyEngine(name, birth_date).generate_full_report()

def get_name_analysis(name, birth_date=None):
    ne = NumerologyEngine(name, birth_date)
    result = {'namank': ne.get_namank()}
    if birth_date:
        result['name_correction'] = ne.suggest_name_correction()
    return result

def check_number_compatibility(date1, date2):
    return NumerologyEngine(birth_date=date1).check_compatibility(date2)


LO_SHU_REMEDIES = {
    1: {'remedy': 'Chant Sun mantra, wear Ruby/Garnet, offer water to Sun at sunrise', 'element': 'Fire'},
    2: {'remedy': 'Chant Moon mantra, wear Pearl/Moonstone, drink milk on Mondays', 'element': 'Water'},
    3: {'remedy': 'Chant Jupiter mantra, wear Yellow Sapphire, donate turmeric on Thursdays', 'element': 'Fire'},
    4: {'remedy': 'Chant Rahu mantra, wear Hessonite, donate on Saturdays', 'element': 'Air'},
    5: {'remedy': 'Chant Mercury mantra, wear Emerald, feed green parrots, read on Wednesdays', 'element': 'Earth'},
    6: {'remedy': 'Chant Venus mantra, wear Diamond/Opal, donate white items on Fridays', 'element': 'Water'},
    7: {'remedy': 'Chant Ketu mantra, wear Cats Eye, feed dogs, meditate on Tuesdays', 'element': 'Water'},
    8: {'remedy': 'Chant Saturn mantra, wear Blue Sapphire (with caution), serve elderly on Saturdays', 'element': 'Earth'},
    9: {'remedy': 'Chant Mars mantra, wear Red Coral, donate blood, Hanuman Chalisa on Tuesdays', 'element': 'Fire'},
}


def get_lo_shu_remedies(birth_date):
    ne = NumerologyEngine(birth_date=birth_date)
    grid = ne.get_lo_shu_grid()
    remedies = []
    for num in grid.get('missing_numbers', []):
        r = LO_SHU_REMEDIES.get(num, {})
        remedies.append({
            'missing_number': num,
            'remedy': r.get('remedy', ''),
            'element': r.get('element', ''),
            'meaning': grid['missing_meanings'].get(num, ''),
        })
    return {'missing': grid['missing_numbers'], 'remedies': remedies}
