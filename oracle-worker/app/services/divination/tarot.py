"""
TAROT — the Rider–Waite–Smith deck, as a reader actually holds it.

WHAT WAS HERE BEFORE was a name and three keywords per card, and the reading was
built from that alone. Three keywords cannot tell the Oracle that the Five of
Cups shows a figure who has not yet turned to see the two cups still standing —
which IS the reading — nor that reversed does not mean "the opposite", nor that
the Tower and the Ten of Swords say very different things about the same ruin.
The I Ching path here already passes trigrams, and the geomancy path passes
witnesses and a judge. Tarot, the most famous of the three, passed the least.

Each card now carries what a reader has in front of them:

  numeral   The Major Arcana are numbered, and the number is read. This deck is
            RWS, so Strength is VIII and Justice XI — the Golden Dawn swap. A
            Marseille reader would have them the other way and would say so.
  image     What is actually drawn. Pamela Colman Smith's pictures are meant to
            be READ, not recognised: the tens, the postures, where the figures
            are looking. Without this the Oracle invents imagery, which a
            querent looking at the card will catch instantly.
  upright   The traditional meaning, as a sentence rather than a keyword list.
  reversed  Its own meaning. Reversal is blockage, excess, interiority or delay
            depending on the card — never simply the upright negated, and a
            reader who treats it that way is read as a beginner.
  astro     The Golden Dawn attribution: a planet or sign for each Major, and a
            decan for each numbered Minor. It is what lets a tarot reading and
            the rest of Plutto agree with each other instead of talking past.

The Minors also carry their suit's element and their number's meaning, because
that is how a reader who does not remember a specific card still reads it
correctly: five of anything is loss or crisis, ten is the end of the cycle.
"""

TITLE = "Tarot"
MEDIA_PREFIX = "tarot"
BACK = "tarot/back"

# THE DECK, NAMED AND CREDITED.
#
# "Waite–Smith", not "Rider-Waite": Rider was the publisher and the hyphenated
# form is a live trademark of another company's modern edition. Waite–Smith is
# also what serious readers now say, so the correct name and the safe one are the
# same name.
#
# And Smith is named. Pamela Colman Smith drew all seventy-eight for a flat fee,
# went uncredited on the box for most of a century, and died without royalties.
# Putting her name on the screen costs nothing and is the first thing a reader
# who knows the deck will look for.
DECK_NAME = "The Waite–Smith deck"
DECK_ARTIST = "Pamela Colman Smith"
DECK_YEAR = "1909"
DECK_CREDIT = "The Waite–Smith deck, 1909 — drawn by Pamela Colman Smith. Public domain."

# ── MAJOR ARCANA ────────────────────────────────────────────────────────────
# (id, numeral, name, astro, image, upright, reversed)
_MAJOR = [
 ("the_fool","0","The Fool","Air",
  "a youth steps toward a cliff edge, white rose in hand, small dog at his heel, sun behind him",
  "The leap taken before it can be justified. Beginning, innocence, faith without a map.",
  "Recklessness, or the opposite — refusing a leap that is clearly yours to take."),
 ("the_magician","I","The Magician","Mercury",
  "a figure with one hand raised and one lowered, all four suits on the table, lemniscate overhead",
  "Everything needed is already on the table. Will, focus, the moment of making.",
  "Power turned to manipulation, or scattered — talent with nothing built from it."),
 ("the_high_priestess","II","The High Priestess","Moon",
  "veiled between a black and a white pillar, crescent at her feet, scroll half hidden",
  "What is known and not yet spoken. Intuition, the held secret, patience before knowing.",
  "Ignoring the inner voice, or secrecy that has curdled into hiding."),
 ("the_empress","III","The Empress","Venus",
  "a crowned woman on cushions in a field of ripe wheat, Venus on her shield",
  "Abundance, fertility, the creative body. Something is growing and should be fed.",
  "Smothering, or creative block — the field left untended or over-worked."),
 ("the_emperor","IV","The Emperor","Aries",
  "a bearded ruler on a stone throne carved with rams' heads, barren mountains behind",
  "Structure, authority, the boundary that makes things possible.",
  "Rigidity, domination, or the absence of a structure that was needed."),
 ("the_hierophant","V","The Hierophant","Taurus",
  "a priest between two pillars raising a blessing, two acolytes below, crossed keys at his feet",
  "Tradition, teaching, the institution. The path that others have already walked.",
  "Dogma outliving its use, or the necessary break from it."),
 ("the_lovers","VI","The Lovers","Gemini",
  "a naked pair beneath an angel, tree of flame behind him, serpent in her tree",
  "Union and the choice inside it. Values aligning — or being asked to.",
  "Misalignment, a choice avoided, or a union entered for the wrong reason."),
 ("the_chariot","VII","The Chariot","Cancer",
  "an armoured driver, no reins, a black and a white sphinx pulling in different directions",
  "Victory by will. Two forces held together long enough to arrive.",
  "Driven without direction, or the opposing forces winning."),
 ("strength","VIII","Strength","Leo",
  "a woman calmly closing a lion's jaws, lemniscate above her, flowers at her waist",
  "The soft force that outlasts the hard one. Courage, patience, mastery without violence.",
  "Self-doubt, or force used where gentleness would have worked."),
 ("the_hermit","IX","The Hermit","Virgo",
  "a robed figure alone on a peak, lamp with a six-pointed star, staff in hand",
  "Withdrawal on purpose. The search conducted alone, the light carried rather than followed.",
  "Isolation that has stopped serving, or refusing solitude that is needed."),
 ("wheel_of_fortune","X","Wheel of Fortune","Jupiter",
  "a wheel lettered TARO, sphinx above, serpent descending, four winged creatures reading in the corners",
  "The turn. What is happening is a cycle, not a verdict.",
  "Resisting the turn, bad timing, a cycle repeating because nothing was learnt."),
 ("justice","XI","Justice","Libra",
  "an enthroned figure holding an upright sword and level scales, one foot showing beneath the robe",
  "Cause and effect, plainly. The account is settled and truth is not negotiable.",
  "Unfairness, evasion of consequence, or judgement passed without the facts."),
 ("the_hanged_man","XII","The Hanged Man","Water",
  "a man suspended by one ankle from a living tree, halo around his head, face serene",
  "Suspension chosen. The view only available upside-down, and the pause that must be waited out.",
  "Stalling dressed as patience, or a sacrifice made for nothing."),
 ("death","XIII","Death","Scorpio",
  "an armoured skeleton on a white horse; a king fallen, a child and a bishop before him; sun rising between towers",
  "The ending that will happen whether or not it is agreed to. Transformation, not misfortune.",
  "Clinging to what is over, or a change stalled halfway through."),
 ("temperance","XIV","Temperance","Sagittarius",
  "an angel pouring between two cups, one foot in water and one on land, path to a crown behind",
  "Blending. The right proportion found by patience rather than force.",
  "Imbalance, excess, or impatience with a process that needs time."),
 ("the_devil","XV","The Devil","Capricorn",
  "a horned figure above two chained humans — the chains loose enough to lift off",
  "Attachment, appetite, the bargain being kept. The chain is looser than it feels.",
  "Breaking free, or seeing the bargain clearly for the first time."),
 ("the_tower","XVI","The Tower","Mars",
  "lightning strikes a crowned tower, two figures fall headlong, the crown knocked off",
  "The sudden collapse of what was built wrong. Revelation by demolition.",
  "The collapse delayed, or survived — disaster averted, or already passing."),
 ("the_star","XVII","The Star","Aquarius",
  "a naked figure kneeling by a pool, pouring water onto land and back into water, eight stars above",
  "Hope after the Tower. Quiet faith, healing, being seen as you are.",
  "Faith lost, or hope held so tightly it has stopped being honest."),
 ("the_moon","XVIII","The Moon","Pisces",
  "a path between two towers, dog and wolf howling, crayfish emerging from the pool",
  "The night road. Illusion, dream, fear that may or may not be about the real thing.",
  "Confusion lifting, or a deception finally seen through."),
 ("the_sun","XIX","The Sun","Sun",
  "a child on a white horse beneath a great sun, sunflowers over a garden wall, banner raised",
  "Clarity and gladness. What is happening is good and does not need interpreting.",
  "Joy dimmed or delayed — the good thing true but not yet arrived."),
 ("judgement","XX","Judgement","Fire",
  "an angel's trumpet; figures rising from open coffins with arms lifted",
  "The reckoning that calls you. An awakening, a verdict on the whole of it.",
  "Refusing the call, or judging yourself far more harshly than the facts allow."),
 ("the_world","XXI","The World","Saturn",
  "a dancer within a laurel wreath, wands in both hands, four creatures at the corners",
  "Completion. The circle closed, the thing genuinely finished.",
  "So close and not closed — a loose end keeping the cycle from ending."),
]

# ── SUITS ───────────────────────────────────────────────────────────────────
_SUITS = {
 "wands":     ("Wands","Fire","will, work, drive, spirit — what you are moved to do"),
 "cups":      ("Cups","Water","feeling, love, dream, relation — what moves through you"),
 "swords":    ("Swords","Air","mind, conflict, truth, speech — what you think and say"),
 "pentacles": ("Pentacles","Earth","body, money, craft, place — what you can hold"),
}
# The number, read the same way in every suit — how a reader who does not
# remember one specific card still reads it right.
_NUMBERS = {
 "ace":"the pure root of the element, offered — a beginning not yet spent",
 "two":"the first division: choice, partnership, the balance of two things",
 "three":"the first fruit — something made, shared, or confirmed",
 "four":"stability, and its risk: rest that can become stagnation",
 "five":"the crisis of the suit. Loss, conflict, want — the necessary disturbance",
 "six":"recovery and exchange after the five; help given or received",
 "seven":"the private test — what is held alone, resisted, or imagined",
 "eight":"movement and mastery: work under way, skill or speed",
 "nine":"the near end, at full intensity — the suit at its most itself",
 "ten":"the cycle complete, for better or worse; nothing more of this to come",
}
_COURT = {
 "page":"the student of the suit — news, curiosity, the beginning of understanding",
 "knight":"the suit in motion, at speed and without moderation",
 "queen":"the suit held inwardly — mastered by feeling, and given to others",
 "king":"the suit held outwardly — mastered by authority, and used in the world",
}
_RANKS = [("ace","Ace"),("two","Two"),("three","Three"),("four","Four"),("five","Five"),
          ("six","Six"),("seven","Seven"),("eight","Eight"),("nine","Nine"),("ten","Ten"),
          ("page","Page"),("knight","Knight"),("queen","Queen"),("king","King")]
# Golden Dawn decans: 2–10 of each suit take a planet in a sign. It is what lets
# a tarot reading and the rest of Plutto describe the same sky.
_DECAN = {
 "wands":     ["Mars in Aries","Sun in Aries","Venus in Aries","Saturn in Leo","Jupiter in Leo",
               "Mars in Leo","Mercury in Sagittarius","Moon in Sagittarius","Saturn in Sagittarius"],
 "cups":      ["Venus in Cancer","Mercury in Cancer","Moon in Cancer","Mars in Scorpio","Sun in Scorpio",
               "Venus in Scorpio","Saturn in Pisces","Jupiter in Pisces","Mars in Pisces"],
 "swords":    ["Moon in Libra","Saturn in Libra","Jupiter in Libra","Venus in Aquarius","Mercury in Aquarius",
               "Moon in Aquarius","Mars in Gemini","Sun in Gemini","Venus in Gemini"],
 "pentacles": ["Jupiter in Capricorn","Mars in Capricorn","Sun in Capricorn","Mercury in Taurus",
               "Moon in Taurus","Saturn in Taurus","Venus in Virgo","Mercury in Virgo","Moon in Virgo"],
}
# EVERY MINOR, WRITTEN. Smith's innovation was illustrating the fifty-six as
# SCENES rather than pips, and that is the whole reason this deck became the
# reference. A formula composed from suit and number can say a five is a
# crisis; it cannot say that the man in the Five of Cups has not turned round,
# or that the sky behind the Ten of Swords is already lightening. Those are
# the readings. So each of the fifty-six carries its own picture, its own
# upright and its own reversal, exactly as the twenty-two do.
_MINOR = {
 'wands_ace': ('a hand from a cloud offering a sprouting branch, castle on a distant hill',
   'A new fire offered — the impulse, the invitation, the thing you suddenly want to make.',
   'The spark that will not catch, or energy poured out before it had a direction.'),
 'wands_two': ('a man on a battlement holding a globe, one wand fixed and one in his hand',
   'The world in your hand and the decision not yet made. Planning, range, restlessness at the edge of what you have built.',
   'Playing safe, or planning that never becomes moving.'),
 'wands_three': ('a figure on a cliff watching three ships go out, wands planted beside him',
   'The ships are launched. Waiting on something already in motion, and looking further than before.',
   'Delays, or plans that were never as far-reaching as they felt.'),
 'wands_four': ('a garlanded canopy on four staves, two figures raising bouquets before a castle',
   'Arrival, celebration, the threshold safely crossed. Home, welcome, a milestone worth marking.',
   'The celebration deferred or thin — a homecoming that does not quite land.'),
 'wands_five': ('five youths brandishing staves at each other, more scuffle than battle',
   'Competition and friction, mostly without malice. The clash that sharpens rather than wounds.',
   'Conflict avoided at a cost, or squabbling that has stopped being useful.'),
 'wands_six': ('a rider crowned with laurel on a white horse, footmen walking alongside',
   'Public victory. Recognition arriving, and the confidence that comes with being seen.',
   'Recognition withheld, or a win that turns out to be worth less than the parade.'),
 'wands_seven': ('a man on high ground holding off six staves from below, mismatched shoes',
   'Holding your position against pressure. The high ground is yours, but you have to keep it.',
   'Overwhelmed, or defending a position no longer worth the cost.'),
 'wands_eight': ('eight wands flying level through clear air — no figure in the picture at all',
   'Speed. Everything in motion at once, messages landing, the pace suddenly picking up.',
   'Delays, scattered effort, or arrows loosed at the wrong target.'),
 'wands_nine': ('a bandaged man leaning on his staff, eight more behind him like a fence',
   'Wary endurance. Tired, wounded, still standing — and expecting the next blow.',
   'Paranoia, or defences kept up long after the danger passed.'),
 'wands_ten': ('a man bent under ten staves he cannot see past, the town close ahead',
   'Burden. Carrying more than was ever agreed, with the end genuinely in sight.',
   'Putting it down, or refusing to — collapse, or delegation at last.'),
 'wands_page': ('a youth in a patterned tunic studying the staff he holds, desert behind',
   'News that stirs something, and the enthusiasm of a beginner with real fire in it.',
   'Restlessness without follow-through; a message that comes to nothing.'),
 'wands_knight': ('an armoured rider on a rearing horse, plumed and in motion',
   'Charging in. Passion, adventure, and no interest in whether the ground has been surveyed.',
   'Recklessness, or a fire that burns out before arriving.'),
 'wands_queen': ('a crowned woman with a sunflower and a staff, black cat at her feet',
   'Warmth with authority. Magnetic, sure of herself, generous with the heat she has.',
   'Insecurity dressed as confidence, or warmth turned demanding.'),
 'wands_king': ('a king on a throne of salamanders, staff held upright, lion at his side',
   'The visionary who acts. Leadership by conviction rather than by process.',
   'Domineering, or vision that never leaves the room.'),
 'cups_ace': ('a hand from a cloud holding a cup with five streams and a descending dove',
   'Feeling offered. A new love, a flood of it, the heart opened before it decided to be.',
   'The cup withheld or spilled — emotion blocked, or an offer refused.'),
 'cups_two': ("a man and woman pledging cups, winged lion's head and caduceus above",
   'The exchange. Two people meeting as equals — attraction, agreement, a genuine bond.',
   'Imbalance, a rupture, or a pledge one side is not making.'),
 'cups_three': ('three women raising cups in a circle, fruit and vines at their feet',
   'Friendship and shared joy. The celebration you are inside of rather than watching.',
   'Crowding, gossip, or celebration that has run past what it was for.'),
 'cups_four': ('a man under a tree with arms folded, three cups before him, a fourth offered from a cloud',
   'Discontent with what you have and blindness to what is being handed to you.',
   'Waking up. Boredom lifting, or the offer finally seen.'),
 'cups_five': ('a cloaked figure over three spilled cups, two still standing behind him, bridge and house beyond',
   'Grief that has your whole attention. Two cups are still upright and you have not turned round.',
   'Turning round. Beginning to see what was not lost — or refusing to.'),
 'cups_six': ('a child offering a flowered cup to another in a walled garden',
   'Memory, tenderness, the past reaching in kindly. Innocence, and a gift given freely.',
   'Nostalgia that has become a place to hide, or a past that will not release you.'),
 'cups_seven': ('a figure before seven cups in cloud — a face, a castle, jewels, a wreath, a dragon, a shrouded shape',
   'Too many possibilities, most of them imagined. Fantasy, choice, the wish mistaken for the plan.',
   'Clarity, and the hard work of choosing one — or continuing to drift.'),
 'cups_eight': ('a man walking away from eight stacked cups, into hills under a clouded moon',
   'Walking away from something that still works, because it is no longer enough.',
   'Staying too long, or leaving without knowing why.'),
 'cups_nine': ('a satisfied man seated before nine cups on a curved cloth',
   'The wish granted. Comfort, plenty, the satisfaction you asked for.',
   'Getting it and finding it thinner than expected, or wanting the wrong thing.'),
 'cups_ten': ('a rainbow of ten cups over a couple with arms raised, two children dancing',
   'The whole of it — love, family, belonging. Not a moment but a life.',
   'The picture kept up for others while something inside it is not true.'),
 'cups_page': ('a youth in a floral tunic regarding a fish rising from his cup',
   'News from the heart. Curiosity, tenderness, a feeling arriving unexpectedly.',
   'Immaturity, or feelings performed rather than felt.'),
 'cups_knight': ('a knight riding at a walk, cup held out before him, winged helm',
   'The romantic on his way. An offer made beautifully, and slowly.',
   'Charm without substance, or a promise made faster than it can be kept.'),
 'cups_queen': ('a queen gazing into an ornate lidded cup, throne carved with cherubs, water at her feet',
   'Feeling mastered and given. Intuition, deep care, the one who holds others.',
   "Absorbing everyone's feeling until none of it is hers; care that has become martyrdom."),
 'cups_king': ('a king enthroned on a stone slab afloat on rough water, cup and sceptre held level',
   'Feeling ruled without being suppressed. Steady in turbulence, kind without being moved off course.',
   'Emotion controlled into coldness, or turbulence hidden under a calm face.'),
 'swords_ace': ('a hand from a cloud gripping an upright sword crowned with laurel and olive',
   'The truth, arriving whole. Clarity, the decision made, the thing finally named.',
   'Clarity misused, or a truth wielded to wound rather than to see.'),
 'swords_two': ('a blindfolded woman with two crossed swords, sea and a crescent behind',
   'A stalemate held on purpose. Refusing to look because looking means choosing.',
   'The blindfold coming off. Deadlock breaking, or information you can no longer avoid.'),
 'swords_three': ('three swords through a heart, rain falling — no figure, nothing softened',
   'Grief said plainly. Heartbreak, betrayal, the words that cannot be unheard.',
   'The pain moving through — mending, or a hurt held long past its cause.'),
 'swords_four': ('a knight lying in effigy on a tomb, three swords above him and one beneath',
   'Rest, and not optional. Recovery, retreat, the pause a body or mind demands.',
   'Returning too soon, or a rest that has turned into avoidance.'),
 'swords_five': ('a smirking man gathering swords as two figures walk away under a ragged sky',
   'A win that costs more than it gives. Conflict where nobody comes out well.',
   'Making amends, or a defeat finally accepted.'),
 'swords_six': ('a ferryman poling a boat with six swords upright, a woman and child aboard, water calm ahead',
   'Passage away from difficulty. Not resolution — transit, and calmer water ahead.',
   'Unable to leave, or carrying the trouble with you into the new place.'),
 'swords_seven': ('a man creeping from a camp with five swords, two left standing behind',
   'Getting away with something. Strategy, deception, or a plan you are not telling anyone.',
   'Being caught, confessing, or the cleverness turning on itself.'),
 'swords_eight': ('a bound and blindfolded woman among eight swords, ground before her open and unguarded',
   'Feeling trapped. The bindings are loose, the way out is unwatched, and she cannot see it.',
   'Seeing the way out — or reasoning yourself back into the trap.'),
 'swords_nine': ('a figure sitting up in bed, face in hands, nine swords on the wall behind, carved battle below',
   'The 3am mind. Anguish, guilt, dread — largely made of what has not happened.',
   'The night ending, or despair spoken aloud at last.'),
 'swords_ten': ('a man face down under ten swords, dark sky already lightening at the horizon',
   'The worst of it, and the end of it. Nothing further can be done to this — the sky is lightening.',
   'The slow climb up, or a melodrama being kept alive past its ending.'),
 'swords_page': ('a youth on high ground brandishing a sword, wind in his hair and clouds moving',
   'Watchfulness. Curiosity, news, the mind that wants to know everything at once.',
   'Suspicion, gossip, or vigilance that has become paranoia.'),
 'swords_knight': ('a knight at full gallop, sword high, everything in the picture blown sideways',
   'Charging at the truth. Fast, direct, and not slowing down to check the ground.',
   'Aggression, haste, or a mind moving faster than the facts.'),
 'swords_queen': ('a stern queen, sword upright in her right hand, left hand extended, clouds below her',
   'Clear sight earned through experience. Honest, discerning, unwilling to be lied to.',
   'Coldness, or a sharpness that cuts the people who did not deserve it.'),
 'swords_king': ('a king enthroned facing forward, sword tilted, butterflies and a crescent on the throne',
   'Judgement and authority in the mind. Rule by principle, argued and held.',
   'Rigidity, or intellect used to dominate rather than decide.'),
 'pentacles_ace': ('a hand from a cloud holding a coin above a walled garden and an arched gate',
   'Something solid offered. An opportunity with real weight — money, work, a place to stand.',
   'The offer missed, or a chance without foundation under it.'),
 'pentacles_two': ('a young man juggling two coins in a lemniscate, ships riding high waves behind',
   'Keeping two things going. Balance in motion, and it is working — for now.',
   'Dropping one. Overcommitment, or juggling as a way of avoiding a choice.'),
 'pentacles_three': ('a mason at work in a cathedral while a monk and a noble consult a plan',
   'Skilled work recognised. Collaboration where each brings something the others cannot.',
   'Working at cross purposes, or craft nobody is paying attention to.'),
 'pentacles_four': ('a crowned man clutching one coin, one on his head, two beneath his feet',
   'Holding on. Security, saving, control — and the grip a little too tight.',
   'Loosening, generosity — or hoarding that has hardened into fear.'),
 'pentacles_five': ('two figures in snow beneath a lit stained-glass window they do not look up at',
   'Hardship, and help you are walking past. Loss of money, health, or belonging.',
   'Recovery, or asking for the help at last.'),
 'pentacles_six': ('a merchant weighing scales while giving coins to two kneeling beggars',
   'Giving and receiving, and the imbalance of power inside it. Charity, fair measure, patronage.',
   'Strings attached, debt, or generosity that keeps someone dependent.'),
 'pentacles_seven': ('a farmer leaning on his hoe, considering seven coins on a bush he has grown',
   'The pause to assess. Work done, harvest not yet in, and the question of whether it is worth it.',
   'Impatience, or effort sunk into something that will not yield.'),
 'pentacles_eight': ('a craftsman at his bench carving coins, finished ones hung beside him, town in the distance',
   'Practice. The apprenticeship, the reps, the skill built by doing it again.',
   'Perfectionism, drudgery, or work without craft in it.'),
 'pentacles_nine': ('a woman in a walled vineyard, hooded falcon on her gloved hand',
   'Earned independence. Comfort you built yourself and can enjoy alone.',
   'Dependence, or luxury that has stopped meaning anything.'),
 'pentacles_ten': ('three generations under an arch, ten coins in the Tree of Life pattern, two dogs, a seated elder',
   'Legacy. Wealth that outlasts a person — family, inheritance, the long-built thing.',
   'Family strain over what is owned, or building for a future nobody wants.'),
 'pentacles_page': ('a youth in a field absorbed in a single coin held above his hands',
   'The student. News about money or work, and the willingness to learn slowly.',
   'Distraction, or a plan that never gets past studying it.'),
 'pentacles_knight': ('a knight motionless on a heavy black horse, coin held out, ploughed field behind',
   'The one who actually finishes. Patient, methodical, unglamorous, reliable.',
   'Stubbornness, or standing so still nothing moves at all.'),
 'pentacles_queen': ('a queen cradling a coin in a flowered bower, rabbit in the grass beside her',
   'Practical care. Provision, nurture, the one who makes a place people can live in.',
   'Smothering, or so much given to others that nothing is kept back.'),
 'pentacles_king': ('a king in a robe of vines among his gardens, castle behind, bull heads on the throne',
   'Mastery of the material. Wealth, security, a person who builds things that hold.',
   'Greed, rigidity, or worth measured only in what is owned.'),
}


def _deck():
    cards = []
    for cid, num, name, astro, image, up, rev in _MAJOR:
        cards.append({"id": cid, "name": name, "arcana": "major", "numeral": num,
                      "astro": astro, "image": image, "upright": up, "reversed": rev,
                      "seed": up, "media": f"{MEDIA_PREFIX}/{cid}"})
    for sid, (sname, elem, domain) in _SUITS.items():
        for i, (rid, rname) in enumerate(_RANKS):
            cid = f"{sid}_{rid}"
            court = rid in _COURT
            meaning = _COURT[rid] if court else _NUMBERS[rid]
            decan = "" if court or rid == "ace" else _DECAN[sid][i-1]
            img, up, rev = _MINOR[cid]
            cards.append({"id": cid, "name": f"{rname} of {sname}", "arcana": "minor",
                          "suit": sname, "element": elem, "rank": rname, "court": court,
                          "astro": decan, "image": img, "rank_note": meaning,
                          "upright": up, "reversed": rev, "seed": up,
                          "media": f"{MEDIA_PREFIX}/{cid}"})
    return cards


DECK = _deck()

# ── SPREADS ─────────────────────────────────────────────────────────────────
# The Celtic Cross is the ten-card spread every reader knows, in Waite's own
# order. What was here before was a five-card invention called "The Cross",
# which is the sort of thing a querent who reads tarot notices immediately.
SPREADS = {
 "one": {"name":"Single Card","positions":[
    {"id":"card","label":"The Card","meaning":"the heart of the matter"}]},
 "three": {"name":"Past · Present · Future","positions":[
    {"id":"past","label":"Past","meaning":"what has shaped this"},
    {"id":"present","label":"Present","meaning":"where you stand now"},
    {"id":"future","label":"Future","meaning":"where this is heading"}]},
 "cross": {"name":"The Celtic Cross","layout":"cross","positions":[
    {"id":"significator","label":"The Heart","meaning":"the matter itself, and the querent within it"},
    {"id":"crossing","label":"The Crossing","meaning":"what crosses it — the obstacle, or the help that complicates"},
    {"id":"crown","label":"The Crown","meaning":"what is known, aimed at, or hoped for above it"},
    {"id":"root","label":"The Root","meaning":"the foundation beneath, often unspoken"},
    {"id":"past","label":"Behind","meaning":"what is passing out of the situation"},
    {"id":"future","label":"Before","meaning":"what is coming into it next"},
    {"id":"self","label":"Yourself","meaning":"how the querent stands in it, honestly"},
    {"id":"others","label":"Around You","meaning":"the people and conditions surrounding it"},
    {"id":"hopes","label":"Hopes and Fears","meaning":"what is wanted and dreaded, usually the same thing"},
    {"id":"outcome","label":"The Outcome","meaning":"where it resolves if nothing changes"}]},
 "relationship": {"name":"Between Two","positions":[
    {"id":"you","label":"You","meaning":"what you bring"},
    {"id":"them","label":"Them","meaning":"what they bring"},
    {"id":"bond","label":"The Bond","meaning":"what actually holds between you"},
    {"id":"challenge","label":"The Challenge","meaning":"what strains it"},
    {"id":"where","label":"Where It Goes","meaning":"what it becomes if both continue as they are"}]},
}
DEFAULT_SPREAD = "three"
NOUN = "card"


def describe(card: dict, reversed_: bool = False) -> str:
    """One card, as a reader would state it before interpreting: what it is, what
    is drawn on it, its attribution, and the meaning for the orientation drawn."""
    bits = [card["name"]]
    if card.get("numeral"):
        bits.append(f"({card['numeral']})")
    if reversed_:
        bits.append("— reversed")
    head = " ".join(bits)
    parts = [head]
    if card.get("image"):
        parts.append(f"Pictured: {card['image']}.")
    if card.get("astro"):
        parts.append(f"Attributed to {card['astro']}.")
    parts.append(card["reversed"] if reversed_ else card["upright"])
    return " ".join(parts)
