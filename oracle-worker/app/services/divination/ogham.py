"""Ogham — the 20 feda (the Celtic tree-alphabet), + tree spreads.

The classic 20 feda across the four aicmí (Beith–Luis–Fearn–Sail…), each a tree with
its lore. Set is fixed and historical; keyword seeds carry the tree's divinatory sense.
"""
TITLE = "Ogham"
MEDIA_PREFIX = "ogham"
BACK = "ogham/back"

# (id, name, tree, keyword seed) — the 20 feda in traditional order.
FEDA = [
    ("beith", "Beith", "Birch", "beginnings, cleansing, a fresh start"),
    ("luis", "Luis", "Rowan", "protection, insight, warding"),
    ("fearn", "Fearn", "Alder", "the shield, guidance, standing firm"),
    ("sail", "Sail", "Willow", "intuition, the moon, emotion's flow"),
    ("nion", "Nion", "Ash", "connection, the world-tree, weaving"),
    ("uath", "Uath", "Hawthorn", "the threshold, caution, cleansing fire"),
    ("dair", "Dair", "Oak", "strength, endurance, the doorway"),
    ("tinne", "Tinne", "Holly", "courage, the blade, balance in conflict"),
    ("coll", "Coll", "Hazel", "wisdom, the nut of knowledge, intuition"),
    ("ceirt", "Ceirt", "Apple", "choice, beauty, the gift of the otherworld"),
    ("muin", "Muin", "Vine", "prophecy, release, the honest tongue"),
    ("gort", "Gort", "Ivy", "growth, the labyrinth, tenacity"),
    ("ngeadal", "nGéadal", "Reed", "direct action, the arrow, purpose"),
    ("straif", "Straif", "Blackthorn", "fate, the unavoidable, strong medicine"),
    ("ruis", "Ruis", "Elder", "endings and renewal, the crone, timing"),
    ("ailm", "Ailm", "Fir/Pine", "the far view, clarity, the higher note"),
    ("onn", "Onn", "Gorse", "gathering, hope, persistent light"),
    ("ur", "Úr", "Heather", "passion, the gateway, healing ground"),
    ("eadhadh", "Eadhadh", "Aspen", "resilience, facing fear, the trembling leaf"),
    ("iodhadh", "Iodhadh", "Yew", "death and eternity, the ancestor, the long view"),
]

DECK = [{"id": f[0], "name": f"{f[1]} · {f[2]}", "seed": f[3], "media": f"{MEDIA_PREFIX}/{f[0]}"} for f in FEDA]

SPREADS = {
    "one": {"name": "Single Few", "positions": [
        {"id": "few", "label": "The Few", "meaning": "the heart of the matter"}]},
    "land_sea_sky": {"name": "Land · Sea · Sky", "positions": [
        {"id": "land", "label": "Land", "meaning": "the body, the practical, what is rooted"},
        {"id": "sea", "label": "Sea", "meaning": "the heart, the emotional undercurrent"},
        {"id": "sky", "label": "Sky", "meaning": "the spirit, what watches over it"}]},
}
DEFAULT_SPREAD = "land_sea_sky"
NOUN = "few"
