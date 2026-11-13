"""
CHINESE ASTROLOGY — PROFILES & COMPATIBILITY
Animal sign profiles, element interactions, zodiac compatibility.
"""

from typing import Dict
from .bazi import BaZiChart, GENERATES, CONTROLS

ANIMAL_PROFILES = {
    "Rat": {
        "traits": ["clever", "resourceful", "charming", "sociable"],
        "shadow": ["cunning", "greedy", "secretive"],
        "compatible": ["Dragon", "Monkey", "Ox"],
        "incompatible": ["Horse", "Goat"],
        "lucky_numbers": [2, 3], "lucky_colors": ["Blue", "Gold", "Green"],
        "archetype": "The Strategist",
    },
    "Ox": {
        "traits": ["dependable", "patient", "hardworking", "determined"],
        "shadow": ["stubborn", "rigid", "slow to change"],
        "compatible": ["Rat", "Snake", "Rooster"],
        "incompatible": ["Tiger", "Dragon", "Horse", "Goat"],
        "lucky_numbers": [1, 4], "lucky_colors": ["White", "Yellow", "Green"],
        "archetype": "The Builder",
    },
    "Tiger": {
        "traits": ["brave", "competitive", "confident", "charismatic"],
        "shadow": ["impulsive", "aggressive", "restless"],
        "compatible": ["Dragon", "Horse", "Pig"],
        "incompatible": ["Ox", "Tiger", "Snake", "Monkey"],
        "lucky_numbers": [1, 3, 4], "lucky_colors": ["Blue", "Gray", "Orange"],
        "archetype": "The Warrior",
    },
    "Rabbit": {
        "traits": ["gentle", "elegant", "alert", "compassionate"],
        "shadow": ["timid", "conservative", "superficial"],
        "compatible": ["Goat", "Pig", "Dog"],
        "incompatible": ["Rat", "Dragon", "Rooster"],
        "lucky_numbers": [3, 4, 6], "lucky_colors": ["Red", "Pink", "Purple"],
        "archetype": "The Diplomat",
    },
    "Dragon": {
        "traits": ["ambitious", "energetic", "fearless", "magnetic"],
        "shadow": ["arrogant", "demanding", "impatient"],
        "compatible": ["Rat", "Tiger", "Snake", "Monkey", "Rooster"],
        "incompatible": ["Ox", "Rabbit", "Dog"],
        "lucky_numbers": [1, 6, 7], "lucky_colors": ["Gold", "Silver", "Gray"],
        "archetype": "The Emperor",
    },
    "Snake": {
        "traits": ["wise", "intuitive", "graceful", "analytical"],
        "shadow": ["suspicious", "jealous", "cold"],
        "compatible": ["Ox", "Dragon", "Rooster"],
        "incompatible": ["Tiger", "Pig"],
        "lucky_numbers": [2, 8, 9], "lucky_colors": ["Black", "Red", "Yellow"],
        "archetype": "The Mystic",
    },
    "Horse": {
        "traits": ["energetic", "independent", "warm-hearted", "free-spirited"],
        "shadow": ["impatient", "hot-tempered", "restless"],
        "compatible": ["Tiger", "Goat", "Dog"],
        "incompatible": ["Rat", "Ox", "Rabbit"],
        "lucky_numbers": [2, 3, 7], "lucky_colors": ["Brown", "Yellow", "Purple"],
        "archetype": "The Adventurer",
    },
    "Goat": {
        "traits": ["gentle", "creative", "kind", "empathetic"],
        "shadow": ["indecisive", "pessimistic", "dependent"],
        "compatible": ["Rabbit", "Horse", "Pig"],
        "incompatible": ["Ox", "Rat", "Dog"],
        "lucky_numbers": [2, 7], "lucky_colors": ["Brown", "Red", "Purple"],
        "archetype": "The Artist",
    },
    "Monkey": {
        "traits": ["intelligent", "witty", "inventive", "versatile"],
        "shadow": ["manipulative", "restless", "unreliable"],
        "compatible": ["Rat", "Dragon", "Snake"],
        "incompatible": ["Tiger", "Pig"],
        "lucky_numbers": [4, 9], "lucky_colors": ["White", "Blue", "Gold"],
        "archetype": "The Inventor",
    },
    "Rooster": {
        "traits": ["observant", "hardworking", "courageous", "honest"],
        "shadow": ["critical", "vain", "blunt"],
        "compatible": ["Ox", "Dragon", "Snake"],
        "incompatible": ["Rabbit", "Rooster", "Dog"],
        "lucky_numbers": [5, 7, 8], "lucky_colors": ["Gold", "Brown", "Yellow"],
        "archetype": "The Perfectionist",
    },
    "Dog": {
        "traits": ["loyal", "honest", "prudent", "kind"],
        "shadow": ["anxious", "pessimistic", "stubborn"],
        "compatible": ["Rabbit", "Tiger", "Horse"],
        "incompatible": ["Dragon", "Goat", "Rooster"],
        "lucky_numbers": [3, 4, 9], "lucky_colors": ["Red", "Green", "Purple"],
        "archetype": "The Guardian",
    },
    "Pig": {
        "traits": ["generous", "compassionate", "diligent", "optimistic"],
        "shadow": ["naive", "over-indulgent", "lazy"],
        "compatible": ["Tiger", "Rabbit", "Goat"],
        "incompatible": ["Snake", "Monkey"],
        "lucky_numbers": [2, 5, 8], "lucky_colors": ["Yellow", "Gray", "Brown"],
        "archetype": "The Philanthropist",
    },
}

ELEMENT_PROFILES = {
    "Wood": {
        "qualities": ["growth", "creativity", "flexibility", "benevolence"],
        "organ": "Liver/Gallbladder", "season": "Spring",
        "direction": "East", "color": "Green",
    },
    "Fire": {
        "qualities": ["passion", "joy", "dynamism", "inspiration"],
        "organ": "Heart/Small Intestine", "season": "Summer",
        "direction": "South", "color": "Red",
    },
    "Earth": {
        "qualities": ["stability", "nourishment", "practicality", "balance"],
        "organ": "Spleen/Stomach", "season": "Late Summer",
        "direction": "Center", "color": "Yellow",
    },
    "Metal": {
        "qualities": ["precision", "discipline", "integrity", "refinement"],
        "organ": "Lungs/Large Intestine", "season": "Autumn",
        "direction": "West", "color": "White",
    },
    "Water": {
        "qualities": ["wisdom", "adaptability", "depth", "intuition"],
        "organ": "Kidneys/Bladder", "season": "Winter",
        "direction": "North", "color": "Black/Blue",
    },
}


class ChineseProfiles:
    """Interpretive layer for Chinese astrology."""

    def __init__(self, chart: BaZiChart):
        self.chart = chart

    def get_animal_profile(self) -> Dict:
        sign = self.chart.get_animal_sign()
        animal = sign['animal']
        profile = ANIMAL_PROFILES.get(animal, {})
        return {
            **sign,
            **profile,
        }

    def get_element_profile(self) -> Dict:
        balance = self.chart.get_element_balance()
        favorable = balance['favorable_element']
        return {
            'balance': balance,
            'favorable_profile': ELEMENT_PROFILES.get(favorable, {}),
            'all_elements': ELEMENT_PROFILES,
        }

    def get_full_profile(self) -> Dict:
        return {
            'animal': self.get_animal_profile(),
            'day_master': self.chart.get_day_master(),
            'elements': self.get_element_profile(),
            'four_pillars': self.chart.get_four_pillars(),
            'ten_gods': self.chart.get_ten_gods(),
            'luck_periods': self.chart.get_luck_periods(6),
        }


class ChineseCompatibility:
    """Chinese zodiac compatibility between two charts."""

    def __init__(self, chart1: BaZiChart, chart2: BaZiChart):
        self.chart1 = chart1
        self.chart2 = chart2

    def analyze(self) -> Dict:
        a1 = self.chart1.get_animal_sign()
        a2 = self.chart2.get_animal_sign()
        animal1 = a1['animal']
        animal2 = a2['animal']

        p1 = ANIMAL_PROFILES.get(animal1, {})
        p2 = ANIMAL_PROFILES.get(animal2, {})

        # Animal compatibility
        if animal2 in p1.get('compatible', []):
            animal_score = 90
            animal_verdict = "Highly compatible"
        elif animal2 in p1.get('incompatible', []):
            animal_score = 30
            animal_verdict = "Challenging pairing"
        else:
            animal_score = 60
            animal_verdict = "Neutral — workable with effort"

        # Element compatibility
        e1 = a1['element']
        e2 = a2['element']
        if e1 == e2:
            element_score = 75
            element_verdict = "Same element — deep understanding"
        elif GENERATES.get(e1) == e2 or GENERATES.get(e2) == e1:
            element_score = 85
            element_verdict = "Generating cycle — nurturing bond"
        elif CONTROLS.get(e1) == e2 or CONTROLS.get(e2) == e1:
            element_score = 45
            element_verdict = "Controlling cycle — power struggles"
        else:
            element_score = 60
            element_verdict = "Neutral elements"

        # Day Master compatibility
        dm1 = self.chart1.get_day_master()
        dm2 = self.chart2.get_day_master()
        dm_e1 = dm1['element']
        dm_e2 = dm2['element']
        if GENERATES.get(dm_e1) == dm_e2 or GENERATES.get(dm_e2) == dm_e1:
            dm_score = 85
        elif dm_e1 == dm_e2:
            dm_score = 70
        elif CONTROLS.get(dm_e1) == dm_e2 or CONTROLS.get(dm_e2) == dm_e1:
            dm_score = 40
        else:
            dm_score = 55

        total = int((animal_score * 0.4) + (element_score * 0.3) + (dm_score * 0.3))

        return {
            'system': 'Chinese Compatibility',
            'person1': {'animal': animal1, 'element': e1, 'day_master': dm1['full_name']},
            'person2': {'animal': animal2, 'element': e2, 'day_master': dm2['full_name']},
            'animal_compatibility': {'score': animal_score, 'verdict': animal_verdict},
            'element_compatibility': {'score': element_score, 'verdict': element_verdict},
            'day_master_compatibility': {'score': dm_score},
            'overall_score': total,
            'overall_verdict': "Excellent match" if total >= 80 else "Good match" if total >= 60 else "Challenging" if total >= 40 else "Difficult",
        }
