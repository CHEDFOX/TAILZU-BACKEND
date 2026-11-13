"""Petit Lenormand — the 36-card deck (fixed, historical), + spreads.

The 36 cards in their canonical numbered order; keyword seeds carry each card's terse,
concrete Lenormand meaning (Lenormand reads plainer and more literal than Tarot).
"""
TITLE = "Lenormand"
MEDIA_PREFIX = "lenormand"
BACK = "lenormand/back"

# DRAWN FOR PLUTTO, and said so. The tarot beside this is the 1909 Waite–Smith
# deck — a real historic artefact — and it would be dishonest to let these sit
# next to it looking like one. The 36 SYMBOLS are traditional and fixed (the
# Rider is always first, the Cross always last); the engraving is ours.
#
# Each card also carries its PLAYING-CARD correspondence, which the historic
# decks print in the corner and readers actually use — the Man is the Ace of
# Hearts, the Ring the Ace of Clubs.
DECK_NAME = "Plutto's Lenormand"
DECK_CREDIT = "The traditional 36, engraved for Plutto. Playing-card correspondences as the historic decks give them."
PIPS = {1:"9♥",2:"6♦",3:"10♠",4:"K♥",5:"7♥",6:"K♣",7:"Q♣",8:"9♦",9:"Q♠",10:"J♦",
        11:"J♣",12:"7♦",13:"J♠",14:"9♣",15:"10♣",16:"6♥",17:"Q♥",18:"10♥",19:"6♠",
        20:"8♠",21:"8♣",22:"Q♦",23:"7♣",24:"J♥",25:"A♣",26:"10♦",27:"7♠",28:"A♥",
        29:"A♠",30:"K♠",31:"A♦",32:"8♥",33:"8♦",34:"K♦",35:"9♠",36:"6♣"}

# (number, id, name, keyword seed) — canonical 1..36.
CARDS = [
    (1, "rider", "Rider", "news, a message, arrival"),
    (2, "clover", "Clover", "luck, a small chance, lightness"),
    (3, "ship", "Ship", "travel, distance, movement away"),
    (4, "house", "House", "home, family, stability"),
    (5, "tree", "Tree", "health, roots, slow growth"),
    (6, "clouds", "Clouds", "confusion, doubt, a passing trouble"),
    (7, "snake", "Snake", "complication, desire, a detour"),
    (8, "coffin", "Coffin", "ending, loss, transformation"),
    (9, "bouquet", "Bouquet", "a gift, charm, a happy invitation"),
    (10, "scythe", "Scythe", "a sudden cut, decision, danger"),
    (11, "whip", "Whip", "conflict, repetition, friction"),
    (12, "birds", "Birds", "talk, nerves, a pair, chatter"),
    (13, "child", "Child", "something new, small, innocent"),
    (14, "fox", "Fox", "cunning, work, watch for deceit"),
    (15, "bear", "Bear", "power, a protector, money, strength"),
    (16, "star", "Star", "hope, guidance, clarity at night"),
    (17, "stork", "Stork", "change, a move, renewal"),
    (18, "dog", "Dog", "a friend, loyalty, the faithful"),
    (19, "tower", "Tower", "authority, isolation, institutions"),
    (20, "garden", "Garden", "the public, community, an event"),
    (21, "mountain", "Mountain", "an obstacle, delay, a block"),
    (22, "crossroads", "Crossroads", "a choice, a fork, more than one path"),
    (23, "mice", "Mice", "loss, stress, something eaten away"),
    (24, "heart", "Heart", "love, warmth, the feeling"),
    (25, "ring", "Ring", "a bond, a contract, commitment"),
    (26, "book", "Book", "a secret, knowledge, the unknown"),
    (27, "letter", "Letter", "a document, written word, communication"),
    (28, "man", "Man", "the man (the querent or a male figure)"),
    (29, "woman", "Woman", "the woman (the querent or a female figure)"),
    (30, "lily", "Lily", "peace, maturity, virtue, an elder"),
    (31, "sun", "Sun", "success, energy, warmth, the win"),
    (32, "moon", "Moon", "emotion, reputation, recognition"),
    (33, "key", "Key", "the answer, certainty, an opening"),
    (34, "fish", "Fish", "money, flow, abundance, business"),
    (35, "anchor", "Anchor", "stability, work, what holds fast"),
    (36, "cross", "Cross", "burden, fate, a heavy but passing weight"),
]

DECK = [{"id": c[1], "name": f"{c[0]}. {c[2]}", "seed": c[3], "number": c[0],
         "pip": PIPS.get(c[0]), "media": f"{MEDIA_PREFIX}/{c[1]}"} for c in CARDS]

SPREADS = {
    "one": {"name": "Single Card", "positions": [
        {"id": "card", "label": "The Card", "meaning": "the heart of the matter"}]},
    "three": {"name": "Three Cards", "positions": [
        {"id": "past", "label": "Past", "meaning": "what led here"},
        {"id": "present", "label": "Present", "meaning": "where it stands"},
        {"id": "future", "label": "Future", "meaning": "where it goes"}]},
}
DEFAULT_SPREAD = "three"
NOUN = "card"
