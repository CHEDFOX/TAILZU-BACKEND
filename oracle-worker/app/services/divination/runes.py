"""Elder Futhark — the 24 runes (authentic Germanic set), + Norn spreads.

The set is fixed and historical (Elder Futhark, c. 150–800 CE); the keyword seeds are
concise divinatory meanings the reading elaborates. `media` resolves to runes/<id>.
"""
TITLE = "Runes"
MEDIA_PREFIX = "runes"
BACK = "runes/back"

# (id, name, keyword seed) — Elder Futhark in traditional order (Freyr's aett first).
RUNES = [
    ("fehu", "Fehu", "wealth, cattle, earned abundance"),
    ("uruz", "Uruz", "wild strength, vitality, the untamed"),
    ("thurisaz", "Thurisaz", "the thorn, reactive force, a gate"),
    ("ansuz", "Ansuz", "the god-word, insight, the message"),
    ("raidho", "Raidho", "the ride, journey, right rhythm"),
    ("kenaz", "Kenaz", "the torch, craft, revelation"),
    ("gebo", "Gebo", "the gift, exchange, union"),
    ("wunjo", "Wunjo", "joy, harmony, belonging"),
    ("hagalaz", "Hagalaz", "hail, disruption, the necessary storm"),
    ("nauthiz", "Nauthiz", "need, constraint, the lesson in lack"),
    ("isa", "Isa", "ice, stillness, the pause"),
    ("jera", "Jera", "the harvest, cycle, reward in time"),
    ("eihwaz", "Eihwaz", "the yew, endurance, the axis"),
    ("perthro", "Perthro", "the lot-cup, fate, the hidden"),
    ("algiz", "Algiz", "the elk, protection, the higher connection"),
    ("sowilo", "Sowilo", "the sun, wholeness, victory"),
    ("tiwaz", "Tiwaz", "the warrior, justice, honour"),
    ("berkano", "Berkano", "the birch, growth, birth, nurture"),
    ("ehwaz", "Ehwaz", "the horse, partnership, movement"),
    ("mannaz", "Mannaz", "the self, humanity, the mind"),
    ("laguz", "Laguz", "water, intuition, the flow"),
    ("ingwaz", "Ingwaz", "the seed, gestation, potential stored"),
    ("dagaz", "Dagaz", "daybreak, breakthrough, transformation"),
    ("othala", "Othala", "inheritance, home, ancestral ground"),
]

DECK = [{"id": r[0], "name": r[1], "seed": r[2], "media": f"{MEDIA_PREFIX}/{r[0]}"} for r in RUNES]

SPREADS = {
    "one": {"name": "Single Rune", "positions": [
        {"id": "rune", "label": "The Rune", "meaning": "the heart of the matter"}]},
    "norns": {"name": "The Norns", "positions": [
        {"id": "urd", "label": "Urd", "meaning": "what has been — the root"},
        {"id": "verdandi", "label": "Verdandi", "meaning": "what is becoming — now"},
        {"id": "skuld", "label": "Skuld", "meaning": "what shall be — the debt owed"}]},
}
DEFAULT_SPREAD = "norns"
NOUN = "rune"       # what a drawn item is called ("cast the runes")
