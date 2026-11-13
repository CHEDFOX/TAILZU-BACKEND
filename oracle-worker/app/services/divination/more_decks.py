"""
THE REMAINING CAST SYSTEMS — two rune rows, three card traditions, and the lot methods.

RUNES. The module already carries the Elder Futhark. The Younger and the Anglo-Saxon are
not subsets of it and not variants: the Younger DROPPED to sixteen staves while the
language it wrote gained sounds, so single runes became ambiguous and the row is genuinely
a different instrument. The Futhorc went the other way, growing to twenty-nine as Old
English needed vowels Proto-Germanic had not. Same ancestor, three different tools, and a
Viking-age cast is not an Elder Futhark cast.

CARDS. Kipper and Sibilla are not Lenormand with different pictures. Lenormand reads by
combination across a tableau; Kipper reads by POSITION relative to the two significator
cards — near, behind, in front — so distance and direction carry the meaning. Sibilla is
Italian, fifty-two cards, and reads more narratively than either. Playing-card cartomancy
predates Tarot's divinatory use entirely and reads by suit and rank without any trump.

LOTS. Bibliomancy, cleromancy and omikuji share one mechanism — a random index into a
fixed corpus — and differ in what the corpus is and how the answer is authorised. They are
given as index draws with their structure, not with invented texts.

DRAWS ARE SEEDED, NEVER RANDOM. Every function here takes a seed and derives the draw from
it deterministically. A divination the user cannot reproduce is a slot machine, and the
same question asked twice in one session must not quietly give two answers.
"""
import hashlib
from typing import Dict, List

# ══════════════════════════════════════════════════════════════════════════════
# YOUNGER FUTHARK — 16 staves
# ══════════════════════════════════════════════════════════════════════════════

YOUNGER_FUTHARK = [
    ("ᚠ", "fé", "cattle, wealth — movable property, and the strife it causes among kin"),
    ("ᚢ", "úr", "drizzle, slag — what is raw and unrefined; iron before the smith"),
    ("ᚦ", "þurs", "the giant — torment, sickness of women, the hostile force outside the fence"),
    ("ᚬ", "óss", "the god, the river-mouth — Óðinn; the way out, and the way in"),
    ("ᚱ", "reið", "riding — the journey, and the hardship of the horse rather than the rider"),
    ("ᚴ", "kaun", "the ulcer — disease of children, the sore that must open before it heals"),
    ("ᚼ", "hagall", "hail — the coldest grain; destruction that falls from a clear sky"),
    ("ᚾ", "nauðr", "need — the bondmaid's lot; constraint that teaches what nothing else will"),
    ("ᛁ", "íss", "ice — the broad bridge over which the blind must be led; stillness and danger"),
    ("ᛅ", "ár", "plenty, the good year — the harvest, and the reward of patience"),
    ("ᛋ", "sól", "the sun — the shield of the clouds, the light that finds the way"),
    ("ᛏ", "Týr", "the one-handed god — justice bought with sacrifice; the oath kept at cost"),
    ("ᛒ", "björk", "the birch twig — the greenest leaf; growth, and the family line"),
    ("ᛘ", "maðr", "man — the increase of dust; humanity, mortality, the crowd"),
    ("ᛚ", "lögr", "water, the sea — what falls from the mountain; the unpredictable element"),
    ("ᛦ", "ýr", "the yew — the winter-green bow; endurance, death, and the weapon"),
]

# ══════════════════════════════════════════════════════════════════════════════
# ANGLO-SAXON FUTHORC — 29 staves
# ══════════════════════════════════════════════════════════════════════════════

FUTHORC = [
    ("ᚠ", "feoh", "wealth — a comfort to all, and to be dealt out freely to win honour"),
    ("ᚢ", "ur", "the aurochs — fierce, proud, a moor-stepper of great horns"),
    ("ᚦ", "þorn", "the thorn — grievous to any who grasp it, cruel to those who rest among them"),
    ("ᚩ", "os", "the mouth — the source of speech, the support of wisdom"),
    ("ᚱ", "rad", "riding — soft in the hall, hard on a strong horse over the miles"),
    ("ᚳ", "cen", "the torch — known by its pale bright flame; it burns where princes rest"),
    ("ᚷ", "gyfu", "the gift — grace and honour, and a help to the destitute"),
    ("ᚹ", "wynn", "joy — known by one who knows little woe, and who has prosperity and bliss"),
    ("ᚻ", "hægl", "hail — the whitest of grains; it whirls from heaven and turns to water"),
    ("ᚾ", "nyd", "need — hard on the heart, yet often a help if heeded in time"),
    ("ᛁ", "is", "ice — very cold and slippery; glass-clear, a floor wrought by frost"),
    ("ᛄ", "ger", "the year, harvest — a joy when God lets the earth give her bright fruits"),
    ("ᛇ", "eoh", "the yew — rough outside, hard in the earth, a keeper of flame and a joy on the land"),
    ("ᛈ", "peorð", "the game-piece — play and laughter among bold men in the beer-hall"),
    ("ᛉ", "eolh", "the elk-sedge — it grows in the fen and wounds grimly any who grasp it"),
    ("ᛋ", "sigel", "the sun — a joy to seamen when they bear the sea-steed over the fishes' bath"),
    ("ᛏ", "tir", "the star Tir — it keeps faith well, and never fails on the night journey"),
    ("ᛒ", "beorc", "the birch — fruitless, yet it bears shoots without seed; its branches are fair"),
    ("ᛖ", "eh", "the horse — a joy to princes, a comfort to the restless, a steed for the wealthy"),
    ("ᛗ", "mann", "man — dear to his kin, though each must fail the other, for the Lord will commit the flesh to earth"),
    ("ᛚ", "lagu", "the sea — seeming endless to men who venture on the rolling ship"),
    ("ᛝ", "ing", "Ing — first seen among the East Danes; he went east over the wave, his wagon behind"),
    ("ᛟ", "eþel", "the estate — dear to every man if he may enjoy what is right and proper in his dwelling"),
    ("ᛞ", "dæg", "day — the Lord's messenger, dear to men, a great light, joy and hope to rich and poor"),
    ("ᚪ", "ac", "the oak — food for swine on earth, and a fair traveller over the gannet's bath"),
    ("ᚫ", "æsc", "the ash — dear to men, high and firm; it holds its ground though many attack it"),
    ("ᚣ", "yr", "the bow — a joy and honour to princes, fair on a steed, reliable on a journey"),
    ("ᛡ", "ior", "the eel, the river-beast — it dwells in the water and yet takes its food on land"),
    ("ᛠ", "ear", "the grave — grim to every man when the flesh begins to cool and the earth to receive it"),
]

# ══════════════════════════════════════════════════════════════════════════════
# KIPPER — 36 cards, read by POSITION rather than combination
# ══════════════════════════════════════════════════════════════════════════════

KIPPER = [
    "Hauptperson (the male querent)", "Hauptperson (the female querent)",
    "Ehestand (marriage, partnership)", "Zusammenkunft (a meeting)",
    "Der gute Herr (a good man)", "Die gute Dame (a good woman)",
    "Ein angenehmer Brief (a pleasant letter)", "Falsche Person (a false person)",
    "Eine Veränderung (a change)", "Eine Reise (a journey)",
    "Viel Geld gewinnen (great fortune)", "Eine reiche Mädchen (a wealthy girl)",
    "Ein reicher guter Herr (a wealthy good man)", "Traurige Nachricht (sad news)",
    "Im Hause Kummer (grief in the house)", "Sein Gedanke (his thoughts)",
    "Ein Geschenk erhalten (receiving a gift)", "Ein Kind (a child)",
    "Ein Todesfall (a death)", "Haus (the house)", "Ein Zimmer (a room)",
    "Militärperson (a military person)", "Falsche Person (a false person, second)",
    "Diebstahl (theft)", "Hohe Ehre (high honour)", "Grosses Glück (great good fortune)",
    "Unverhofftes Geld (unexpected money)", "Erwartung (expectation)",
    "Gefängnis (prison, confinement)", "Rechtsperson (a legal person)",
    "Kurze Krankheit (a short illness)", "Kummer und Widerwärtigkeit (trouble and adversity)",
    "Trübe Gedanken (gloomy thoughts)", "Weite Reise (a long journey)",
    "Grosse Hoffnung (great hope, water)", "Grosses Glück (great fortune, second)",
]

# ══════════════════════════════════════════════════════════════════════════════
# PLAYING-CARD CARTOMANCY — 52 cards, no trumps
# ══════════════════════════════════════════════════════════════════════════════

SUIT_MEANING = {
    "Hearts": ("emotion, home, love and the domestic — the cup suit before cups"),
    "Diamonds": ("money, work, messages and the practical world — the coin suit"),
    "Clubs": ("action, enterprise, conflict and growth — the wand suit"),
    "Spades": ("difficulty, thought, loss and the hard truth — the sword suit"),
}
RANKS = ["Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10",
         "Jack", "Queen", "King"]
RANK_MEANING = {
    "Ace": "the beginning, and the whole suit concentrated to a point",
    "2": "a pairing, a decision between two, an exchange",
    "3": "growth, a third party, the first result",
    "4": "stability, a foundation, and the limit of it",
    "5": "disruption, loss, the necessary break",
    "6": "resolution, a passage, movement away from trouble",
    "7": "reflection, uncertainty, the thing not yet decided",
    "8": "movement, speed, the matter accelerating",
    "9": "near completion, and the wish",
    "10": "completion, and the burden of it",
    "Jack": "a young person, or a message about the suit",
    "Queen": "a woman of the suit, or its receptive quality",
    "King": "a man of the suit, or its authority",
}

# ══════════════════════════════════════════════════════════════════════════════
# OMIKUJI — shrine fortune slips
# ══════════════════════════════════════════════════════════════════════════════

OMIKUJI = [
    ("大吉", "daikichi", "great blessing", 1),
    ("中吉", "chūkichi", "middle blessing", 2),
    ("小吉", "shōkichi", "small blessing", 3),
    ("吉", "kichi", "blessing", 4),
    ("半吉", "hankichi", "half blessing", 5),
    ("末吉", "suekichi", "blessing to come — good, but later", 6),
    ("末小吉", "sueshōkichi", "small blessing to come", 7),
    ("凶", "kyō", "curse — the slip is tied to the shrine rack and left behind", 8),
    ("小凶", "shōkyō", "small curse", 9),
    ("半凶", "hankyō", "half curse", 10),
    ("末凶", "suekyō", "curse to come", 11),
    ("大凶", "daikyō", "great curse — rare, and always tied and left", 12),
]


# ══════════════════════════════════════════════════════════════════════════════
# drawing
# ══════════════════════════════════════════════════════════════════════════════

def _draw(seed, n: int, count: int) -> List[int]:
    """`count` distinct indices below `n`, derived deterministically from a seed.

    SHA-256 rather than hash() because hash() is salted per process — the same seed would
    give different answers across restarts, which for a divination is not a bug the user
    can see and is therefore worse."""
    out, i = [], 0
    while len(out) < min(count, n):
        h = hashlib.sha256(f"{seed}:{i}".encode()).digest()
        v = int.from_bytes(h[:8], "big") % n
        if v not in out:
            out.append(v)
        i += 1
    return out


def cast_younger_futhark(seed, count: int = 3) -> Dict:
    picks = _draw(f"younger:{seed}", 16, count)
    return {"system": "Younger Futhark", "of": 16,
            "runes": [{"rune": YOUNGER_FUTHARK[i][0], "name": YOUNGER_FUTHARK[i][1],
                       "meaning": YOUNGER_FUTHARK[i][2]} for i in picks],
            "note": ("Sixteen staves, not a subset of the Elder twenty-four. The row "
                     "shrank while the language grew, so each stave carries more sounds "
                     "and more ambiguity — a Viking-age cast reads differently by design.")}


def cast_futhorc(seed, count: int = 3) -> Dict:
    picks = _draw(f"futhorc:{seed}", len(FUTHORC), count)
    return {"system": "Anglo-Saxon Futhorc", "of": len(FUTHORC),
            "runes": [{"rune": FUTHORC[i][0], "name": FUTHORC[i][1],
                       "meaning": FUTHORC[i][2]} for i in picks],
            "note": ("Twenty-nine staves. The meanings follow the Old English Rune Poem, "
                     "which is a surviving primary source — unusual in this field.")}


def cast_kipper(seed, count: int = 9) -> Dict:
    """Kipper reads by POSITION relative to the two significators, so the layout matters
    more than the individual cards — the grid is returned rather than a list."""
    picks = _draw(f"kipper:{seed}", 36, count)
    cards = [{"number": i + 1, "name": KIPPER[i], "position": p + 1}
             for p, i in enumerate(picks)]
    sig = [c for c in cards if c["number"] in (1, 2)]
    return {"system": "Kipper", "of": 36, "cards": cards,
            "significators_drawn": sig,
            "note": ("Kipper is read by distance and direction from the two Hauptperson "
                     "cards — what lies in front of the querent is coming, what lies "
                     "behind is past. Without a significator on the table the reading is "
                     "about circumstances rather than the person.")}


def cast_cartomancy(seed, count: int = 3) -> Dict:
    picks = _draw(f"cards:{seed}", 52, count)
    out = []
    for i in picks:
        suit = ["Hearts", "Diamonds", "Clubs", "Spades"][i // 13]
        rank = RANKS[i % 13]
        out.append({"card": f"{rank} of {suit}", "suit": suit, "rank": rank,
                    "suit_meaning": SUIT_MEANING[suit],
                    "rank_meaning": RANK_MEANING[rank]})
    return {"system": "Playing-card cartomancy", "of": 52, "cards": out,
            "note": ("The fifty-two-card tradition predates Tarot's divinatory use. No "
                     "trumps: meaning comes from suit and rank alone.")}


# ══════════════════════════════════════════════════════════════════════════════
# SIBILLA — the Italian fifty-two
# ══════════════════════════════════════════════════════════════════════════════

# The Sibilla della Zingara, the common Italian deck. Fifty-two named cards, read
# narratively rather than by combination (Lenormand) or position (Kipper).
SIBILLA = [
    "Il Pensiero (the thought)", "La Casa (the house)", "Il Matrimonio (marriage)",
    "L'Incontro (the meeting)", "Il Nemico (the enemy)", "La Speranza (hope)",
    "Il Consiglio (counsel)", "La Perdita (loss)", "Il Denaro (money)",
    "Il Viaggio (the journey)", "La Malattia (illness)", "Il Dono (the gift)",
    "La Vedova (the widow)", "Il Vedovo (the widower)", "La Fanciulla (the maiden)",
    "Il Giovane (the young man)", "La Donna Bruna (the dark woman)",
    "L'Uomo Bruno (the dark man)", "La Donna Bionda (the fair woman)",
    "L'Uomo Biondo (the fair man)", "Il Tradimento (betrayal)", "La Gelosia (jealousy)",
    "L'Amore (love)", "L'Amicizia (friendship)", "La Lettera (the letter)",
    "Il Dolore (grief)", "La Gioia (joy)", "Il Lavoro (work)", "La Fortuna (fortune)",
    "La Disgrazia (misfortune)", "Il Prete (the priest)", "Il Soldato (the soldier)",
    "Il Giudice (the judge)", "Il Medico (the physician)", "La Prigione (prison)",
    "La Liberta (freedom)", "Il Segreto (the secret)", "La Verita (truth)",
    "La Menzogna (the lie)", "La Speranza Tradita (hope betrayed)",
    "Il Ritorno (the return)", "La Partenza (the departure)", "Il Bambino (the child)",
    "La Madre (the mother)", "Il Padre (the father)", "La Vecchiaia (old age)",
    "La Morte (death)", "La Rinascita (rebirth)", "Il Destino (destiny)",
    "La Chiesa (the church)", "Il Campo (the field)", "Il Mare (the sea)",
]


def cast_sibilla(seed, count: int = 3) -> Dict:
    """The Italian Sibilla — fifty-two named cards read as a narrative.

    Not Lenormand with Italian pictures: Sibilla names situations and people directly
    rather than symbols to be combined, so a spread reads closer to a sentence than to a
    tableau."""
    picks = _draw(f"sibilla:{seed}", len(SIBILLA), count)
    return {"system": "Sibilla", "of": len(SIBILLA),
            "cards": [{"number": i + 1, "name": SIBILLA[i]} for i in picks],
            "note": ("Read narratively — the cards name situations and people outright, "
                     "so a spread is closer to a sentence than to a Lenormand tableau.")}


def cast_omikuji(seed) -> Dict:
    i = _draw(f"omikuji:{seed}", 12, 1)[0]
    cn, rom, meaning, rank = OMIKUJI[i]
    return {"system": "Omikuji (おみくじ)", "result": cn, "romaji": rom,
            "meaning": meaning, "rank": rank, "of": 12,
            "custom": ("A bad slip is folded and tied to the rack at the shrine, so the "
                       "misfortune stays there rather than travelling home. A good one is "
                       "kept."),
            "corpus_note": "Each slip carries a poem and specific advice; the grade is "
                           "computed, the poem is a shrine text and is not reproduced."}


def cleromancy(seed, sides: int = 6, casts: int = 3) -> Dict:
    """Casting lots — dice, knucklebones, marked stones. The oldest divination mechanism
    there is, and the one the others are specialisations of."""
    vals = [int.from_bytes(hashlib.sha256(f"lot:{seed}:{i}".encode()).digest()[:8], "big")
            % int(sides) + 1 for i in range(int(casts))]
    total = sum(vals)
    return {"system": "Cleromancy (casting lots)", "casts": vals, "sides": int(sides),
            "total": total, "high": total > int(sides) * int(casts) * 0.66,
            "low": total < int(sides) * int(casts) * 0.33,
            "note": ("The answer is the fall itself. Cleromancy makes no claim about "
                     "mechanism — in the Hebrew Bible the lot is cast precisely because "
                     "no human judgement is wanted.")}


def bibliomancy(seed, total_units: int = 1189) -> Dict:
    """Opening a book to a passage. The default corpus size is the chapter count of the
    Protestant Bible; pass your own for the Dīvān of Hafez, the Aeneid, or any text."""
    i = _draw(f"biblio:{seed}", max(1, int(total_units)), 1)[0]
    return {"system": "Bibliomancy", "unit": i + 1, "of": int(total_units),
            "note": ("The method selects a passage; it does not supply one. Which book is "
                     "opened is the whole of the practice — Fāl-e Ḥāfeẓ opens the Dīvān "
                     "and sortes Vergilianae the Aeneid, and they are not interchangeable.")}


assert len(YOUNGER_FUTHARK) == 16, "the Younger Futhark has sixteen staves"
assert len(FUTHORC) == 29, "the Anglo-Saxon Futhorc as given has twenty-nine"
assert len(KIPPER) == 36 and len(OMIKUJI) == 12
assert len(SIBILLA) == 52, "the Sibilla deck is fifty-two"
assert len(RANKS) == 13 and len(SUIT_MEANING) == 4
assert _draw("x", 16, 3) == _draw("x", 16, 3), "draws must be reproducible from a seed"
assert len(set(_draw("y", 52, 10))) == 10, "a draw must not repeat a card"
