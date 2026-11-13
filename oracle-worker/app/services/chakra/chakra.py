"""
JYOTISH ENGINE - CHAKRA ANALYSIS
Map planets to 7 chakras. Identify blocked/overactive centers.
"""

from typing import Dict
from ..core.constants import PLANETS, DUSTHANA_HOUSES

CHAKRA_MAP = {
    'Root (Muladhara)': {
        'planet': 'Saturn', 'secondary': 'Mars',
        'location': 'Base of spine', 'color': 'Red', 'element': 'Earth',
        'balanced': 'Grounded, secure, stable, patient, healthy body',
        'blocked': 'Fear, anxiety, financial worry, lower back pain, lethargy',
        'overactive': 'Greed, materialism, hoarding, stubbornness, resistance to change',
        'remedy': 'Walk barefoot, eat root vegetables, wear red, Muladhara meditation',
    },
    'Sacral (Svadhisthana)': {
        'planet': 'Venus', 'secondary': 'Jupiter',
        'location': 'Below navel', 'color': 'Orange', 'element': 'Water',
        'balanced': 'Creative, passionate, joyful, healthy relationships, emotional flow',
        'blocked': 'Guilt, low libido, creative block, emotional numbness, stiffness',
        'overactive': 'Addiction, emotional drama, attachment, obsessive behavior',
        'remedy': 'Dance, creative art, water therapy, wear orange, hip-opening yoga',
    },
    'Solar Plexus (Manipura)': {
        'planet': 'Mars', 'secondary': 'Sun',
        'location': 'Above navel', 'color': 'Yellow', 'element': 'Fire',
        'balanced': 'Confident, willful, decisive, good digestion, self-esteem',
        'blocked': 'Low self-esteem, indecisive, digestive issues, victim mentality',
        'overactive': 'Controlling, aggressive, anger, domination, perfectionism',
        'remedy': 'Core exercises, fire ceremony, eat yellow foods, Manipura meditation',
    },
    'Heart (Anahata)': {
        'planet': 'Moon', 'secondary': 'Venus',
        'location': 'Center of chest', 'color': 'Green', 'element': 'Air',
        'balanced': 'Loving, compassionate, empathetic, forgiving, peaceful',
        'blocked': 'Grief, loneliness, jealousy, unable to forgive, heart problems',
        'overactive': 'Codependency, people-pleasing, losing self in others',
        'remedy': 'Green vegetables, heart-opening yoga, forgiveness practice, nature walks',
    },
    'Throat (Vishuddha)': {
        'planet': 'Mercury', 'secondary': 'Jupiter',
        'location': 'Throat', 'color': 'Blue', 'element': 'Ether',
        'balanced': 'Clear communication, honest, creative expression, good listener',
        'blocked': 'Fear of speaking, sore throat, thyroid issues, secrets, lies',
        'overactive': 'Gossiping, talking too much, dominating conversations, arrogance',
        'remedy': 'Singing, chanting, blue clothing, neck stretches, journaling',
    },
    'Third Eye (Ajna)': {
        'planet': 'Jupiter', 'secondary': 'Ketu',
        'location': 'Between eyebrows', 'color': 'Indigo', 'element': 'Light',
        'balanced': 'Intuitive, wise, clear vision, good memory, imaginative',
        'blocked': 'Confusion, poor judgment, headaches, lack of purpose, denial',
        'overactive': 'Delusions, hallucinations, overthinking, disconnected from reality',
        'remedy': 'Meditation, third eye focus, purple foods, reduce screen time, tratak',
    },
    'Crown (Sahasrara)': {
        'planet': 'Ketu', 'secondary': 'Sun',
        'location': 'Top of head', 'color': 'Violet/White', 'element': 'Consciousness',
        'balanced': 'Spiritual connection, universal awareness, wisdom, bliss, enlightenment',
        'blocked': 'Spiritual disconnection, depression, close-mindedness, isolation',
        'overactive': 'Spiritual addiction, dissociation, ungrounded, ignoring physical needs',
        'remedy': 'Meditation, silence, fasting, white/violet clothing, prayer, surrender',
    },
}


class ChakraAnalysis:
    def __init__(self, engine):
        self.engine = engine
        self.planets = engine.planets

    def _planet_strength(self, planet: str) -> str:
        p = self.planets.get(planet, {})
        r = p.get('rashi', 0)
        h = p.get('house', 1)
        pd = PLANETS.get(planet, {})
        is_exalted = r == pd.get('exalted')
        is_own = r in pd.get('owns', [])
        is_debilitated = r == pd.get('debilitated')
        in_dusthana = h in DUSTHANA_HOUSES

        if is_exalted or is_own:
            return 'strong'
        elif is_debilitated:
            return 'debilitated'
        elif in_dusthana:
            return 'weakened'
        else:
            return 'moderate'

    def _is_afflicted(self, planet: str) -> bool:
        h = self.planets.get(planet, {}).get('house', 1)
        for mal in ['Saturn', 'Mars', 'Rahu', 'Ketu']:
            if mal != planet and self.planets.get(mal, {}).get('house', 0) == h:
                return True
        return False

    def analyze_chakras(self) -> Dict:
        results = {}
        for chakra_name, data in CHAKRA_MAP.items():
            planet = data['planet']
            secondary = data['secondary']

            p_strength = self._planet_strength(planet)
            s_strength = self._planet_strength(secondary)
            p_afflicted = self._is_afflicted(planet)

            if p_strength == 'debilitated' or (p_strength == 'weakened' and p_afflicted):
                status = 'Blocked'
                description = data['blocked']
            elif p_strength == 'strong' and p_afflicted:
                status = 'Overactive'
                description = data['overactive']
            elif p_strength == 'strong':
                status = 'Balanced'
                description = data['balanced']
            elif p_afflicted:
                status = 'Partially Blocked'
                description = data['blocked']
            else:
                status = 'Moderate'
                description = data['balanced']

            results[chakra_name] = {
                'status': status,
                'ruling_planet': planet,
                'planet_strength': p_strength,
                'afflicted': p_afflicted,
                'description': description,
                'color': data['color'],
                'location': data['location'],
                'remedy': data['remedy'] if status in ('Blocked', 'Partially Blocked', 'Overactive') else 'Maintain current practices',
            }

        blocked = [name for name, d in results.items() if 'Blocked' in d['status']]
        overactive = [name for name, d in results.items() if d['status'] == 'Overactive']
        balanced = [name for name, d in results.items() if d['status'] == 'Balanced']

        return {
            'system': 'chakra',
            'category': 'wellness',
            'triggers': ['chakra', 'energy', 'healing', 'wellness', 'blocked'],
            'chakras': results,
            'blocked_chakras': blocked,
            'overactive_chakras': overactive,
            'balanced_chakras': balanced,
            'primary_focus': blocked[0] if blocked else (overactive[0] if overactive else 'All balanced'),
            'confidence': 0.70,
        }


def analyze_chakras(engine):
    return ChakraAnalysis(engine).analyze_chakras()
