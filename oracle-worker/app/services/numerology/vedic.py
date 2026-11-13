"""
ANK JYOTISH — the Vedic friendship + remedy layer over the core numbers.

Indian numerology reads each number 1-9 as a planet (1 Sun, 2 Moon, 3 Jupiter,
4 Rahu, 5 Mercury, 6 Venus, 7 Ketu, 8 Saturn, 9 Mars). Two numbers are FRIEND /
NEUTRAL / ENEMY to each other exactly as their planets are in Jyotish's natural
relationship table (Naisargika Maitri) — so whether your Mulank, Bhagyank and
Namank cooperate or fight is a planetary-friendship question.

This module gives:
  • number → planet
  • relation(a, b)  — friend / neutral / enemy, from the planetary table
  • friends_of / enemies_of
  • REMEDIES        — the per-number upaya layer (beej mantra, gem, metal,
    colour, day, deity, donation, fast) to strengthen a weak/afflicted number
  • analyze(...)    — harmony of a person's core numbers + their remedies

Pure stdlib. The friendship data mirrors Jyotish natural friendships; the nodes
(Rahu=4, Ketu=7) follow their commonly-accepted shadow-planet relationships.
"""

from typing import Dict, List, Optional

NUMBER_PLANET = {
    1: 'Sun', 2: 'Moon', 3: 'Jupiter', 4: 'Rahu', 5: 'Mercury',
    6: 'Venus', 7: 'Ketu', 8: 'Saturn', 9: 'Mars',
}
PLANET_NUMBER = {v: k for k, v in NUMBER_PLANET.items()}

# Naisargika Maitri (natural friendship), expressed in NUMBERS. Anything not
# listed as friend/enemy is neutral. Nodes follow shadow-planet convention:
# Rahu/Ketu befriend Mercury, Venus, Saturn and oppose the luminaries + Mars.
_FRIENDS = {
    1: {2, 3, 9},          # Sun
    2: {1, 5},             # Moon
    3: {1, 2, 9},          # Jupiter
    4: {5, 6, 8},          # Rahu
    5: {1, 6},             # Mercury
    6: {5, 8},             # Venus
    7: {5, 6, 8},          # Ketu
    8: {5, 6},             # Saturn
    9: {1, 2, 3},          # Mars
}
_ENEMIES = {
    1: {6, 8, 4, 7},       # Sun vs Venus, Saturn, the nodes
    2: {4, 7},             # Moon vs the nodes
    3: {5, 6},             # Jupiter vs Mercury, Venus
    4: {1, 2, 9},          # Rahu vs Sun, Moon, Mars
    5: {2},                # Mercury vs Moon
    6: {1, 2},             # Venus vs Sun, Moon
    7: {1, 2},             # Ketu vs Sun, Moon
    8: {1, 2, 9},          # Saturn vs Sun, Moon, Mars
    9: {5, 4},             # Mars vs Mercury, Rahu
}

# Per-number remedy (upaya) layer — strengthen a weak/afflicted core number.
REMEDIES = {
    1: {'planet': 'Sun', 'beej_mantra': 'Om Hraam Hreem Hraum Sah Suryaya Namah',
        'gem': 'Ruby', 'metal': 'Gold/Copper', 'colour': 'Golden, Orange',
        'day': 'Sunday', 'deity': 'Surya / Lord Rama',
        'donation': 'Wheat, jaggery, copper on Sunday',
        'practice': 'Offer water (arghya) to the Sun at sunrise; respect father and elders.'},
    2: {'planet': 'Moon', 'beej_mantra': 'Om Shraam Shreem Shraum Sah Chandraya Namah',
        'gem': 'Pearl / Moonstone', 'metal': 'Silver', 'colour': 'White, Silver',
        'day': 'Monday', 'deity': 'Chandra / Lord Shiva',
        'donation': 'Rice, milk, white cloth on Monday',
        'practice': 'Keep water by the bedside; honour the mother; avoid emotional excess.'},
    3: {'planet': 'Jupiter', 'beej_mantra': 'Om Graam Greem Graum Sah Gurave Namah',
        'gem': 'Yellow Sapphire', 'metal': 'Gold', 'colour': 'Yellow',
        'day': 'Thursday', 'deity': 'Brihaspati / Lord Vishnu',
        'donation': 'Turmeric, chana dal, yellow cloth on Thursday',
        'practice': 'Respect teachers and gurus; study scripture; feed Brahmins/teachers.'},
    4: {'planet': 'Rahu', 'beej_mantra': 'Om Bhraam Bhreem Bhraum Sah Rahave Namah',
        'gem': 'Hessonite (Gomed)', 'metal': 'Lead/Silver', 'colour': 'Smoky Blue, Grey',
        'day': 'Saturday', 'deity': 'Goddess Durga / Bhairava',
        'donation': 'Black/blue items, mustard oil, coconut on Saturday',
        'practice': 'Feed stray dogs; keep clean dark corners; avoid intoxicants and shortcuts.'},
    5: {'planet': 'Mercury', 'beej_mantra': 'Om Braam Breem Braum Sah Budhaya Namah',
        'gem': 'Emerald', 'metal': 'Bronze', 'colour': 'Green',
        'day': 'Wednesday', 'deity': 'Budha / Lord Vishnu (Vamana)',
        'donation': 'Green gram, green cloth on Wednesday',
        'practice': 'Feed green fodder to cows; help students; keep your word.'},
    6: {'planet': 'Venus', 'beej_mantra': 'Om Draam Dreem Draum Sah Shukraya Namah',
        'gem': 'Diamond / Opal / White Sapphire', 'metal': 'Silver', 'colour': 'White, Pink',
        'day': 'Friday', 'deity': 'Shukra / Goddess Lakshmi',
        'donation': 'White sweets, perfume, white cloth on Friday',
        'practice': 'Honour women; keep surroundings beautiful and clean; avoid indulgence.'},
    7: {'planet': 'Ketu', 'beej_mantra': 'Om Sraam Sreem Sraum Sah Ketave Namah',
        'gem': "Cat's Eye (Lehsunia)", 'metal': 'Mixed metals (Ashtadhatu)', 'colour': 'Grey, Smoky',
        'day': 'Tuesday', 'deity': 'Lord Ganesha / Bhairava',
        'donation': 'Sesame, blanket, multicoloured items',
        'practice': 'Feed dogs; keep a dog; meditate; serve at temples and spiritual places.'},
    8: {'planet': 'Saturn', 'beej_mantra': 'Om Praam Preem Praum Sah Shanaye Namah',
        'gem': 'Blue Sapphire (test first)', 'metal': 'Iron', 'colour': 'Black, Dark Blue',
        'day': 'Saturday', 'deity': 'Shani / Lord Hanuman',
        'donation': 'Black sesame, mustard oil, iron, black cloth on Saturday',
        'practice': 'Serve the elderly, labourers and the poor; recite Hanuman Chalisa; be patient.'},
    9: {'planet': 'Mars', 'beej_mantra': 'Om Kraam Kreem Kraum Sah Bhaumaya Namah',
        'gem': 'Red Coral', 'metal': 'Copper', 'colour': 'Red',
        'day': 'Tuesday', 'deity': 'Mangal / Lord Hanuman / Kartikeya',
        'donation': 'Red lentils (masoor), red cloth, copper on Tuesday',
        'practice': 'Recite Hanuman Chalisa; donate blood; control anger and impatience.'},
}


def _root(n: int) -> int:
    """Single digit 1-9 for friendship lookup."""
    if n is None:
        return 0
    n = int(n)
    while n > 9:
        n = sum(int(d) for d in str(n))
    return n


def number_planet(n: int) -> str:
    return NUMBER_PLANET.get(_root(n), '')


def relation(a: int, b: int) -> str:
    """friend / neutral / enemy between two numbers, via the planetary table."""
    a, b = _root(a), _root(b)
    if not a or not b:
        return 'neutral'
    if b in _FRIENDS.get(a, set()):
        return 'friend'
    if b in _ENEMIES.get(a, set()):
        return 'enemy'
    return 'neutral'


def friends_of(n: int) -> List[int]:
    return sorted(_FRIENDS.get(_root(n), set()))


def enemies_of(n: int) -> List[int]:
    return sorted(_ENEMIES.get(_root(n), set()))


def remedies_for(n: int) -> Dict:
    return dict(REMEDIES.get(_root(n), {}))


def analyze(mulank: int, bhagyank: int, namank: Optional[int] = None) -> Dict:
    """How a person's core numbers get along, plus the remedy for each.

    The pairwise relations between Mulank (root), Bhagyank (destiny) and Namank
    (name) say whether the chart's numbers reinforce or fight each other; the
    remedy layer is attached so a weak/clashing number can be strengthened.
    """
    nums = {'mulank': _root(mulank), 'bhagyank': _root(bhagyank)}
    if namank:
        nums['namank'] = _root(namank)

    pairs = []
    keys = list(nums)
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = keys[i], keys[j]
            rel = relation(nums[a], nums[b])
            pairs.append({'between': f'{a}↔{b}', 'numbers': [nums[a], nums[b]],
                          'planets': [number_planet(nums[a]), number_planet(nums[b])],
                          'relation': rel})

    friendly = sum(1 for p in pairs if p['relation'] == 'friend')
    hostile = sum(1 for p in pairs if p['relation'] == 'enemy')
    total = len(pairs) or 1
    harmony = round((friendly - hostile) / total, 2)   # -1 (all clash) … +1 (all friends)
    if harmony >= 0.5:
        verdict = 'The core numbers reinforce each other.'
    elif harmony <= -0.5:
        verdict = 'The core numbers pull against each other — remedies matter here.'
    else:
        verdict = 'A mixed field — some numbers help, some need balancing.'

    return {
        'numbers': nums,
        'planets': {k: number_planet(v) for k, v in nums.items()},
        'pairs': pairs,
        'harmony': harmony,
        'verdict': verdict,
        'remedies': {k: remedies_for(v) for k, v in nums.items()},
    }
