"""
LIBRARY — what each tradition holds, on each question.

Every `claim` is stated in the tradition's own terms and attributed to it. The platform
does not adjudicate between them. Where a position is internally strained or contested by
that tradition's own scholars, `tension` says so — that is the only place the platform's
own voice appears.

`stance` is a coarse tag used to group positions before independence is computed. It is
deliberately blunt: it exists so the engine can ask "who else says roughly this?" and then
check whether those traditions could have reached it separately. Two positions sharing a
stance are not thereby equivalent, and the engine never claims they are.
"""
from app.services.library.concepts import position

# ═══════════════════════════════════════════════════════════════════════════
# TIME
# ═══════════════════════════════════════════════════════════════════════════

position("time", "vedic",
         "Time is cyclical and vast. The four yugas repeat within kalpas of billions of "
         "years; creation and dissolution recur without a first beginning.",
         sources=("upanishads", "bhagavad_gita"), key_terms=("kala", "yuga", "kalpa"),
         stance="cyclical",
         tension="The cycles are described with numerical precision that the texts "
                 "themselves do not derive from anything — the figures are given, not argued.")

position("time", "maya",
         "Time is cyclical and layered, tracked by interlocking counts. The world has been "
         "created and destroyed repeatedly; the current creation is one of a series.",
         sources=("popol_vuh",), key_terms=("tzolk'in", "long count", "b'ak'tun"),
         stance="cyclical",
         tension="The 2012 'end of the world' reading was a modern Western invention; the "
                 "Long Count simply rolls over, as an odometer does.")

position("time", "stoic",
         "The cosmos passes through identical cycles, each ending in conflagration and "
         "recurring in exactly the same order — the same lives lived again.",
         sources=("marcus_meditations",), key_terms=("ekpyrosis", "palingenesis"),
         stance="cyclical")

position("time", "norse",
         "Time runs toward Ragnarök, after which a renewed world rises — an ending that is "
         "also a turning.",
         sources=("poetic_edda",), stance="cyclical",
         tension="The surviving sources were written by Christians; how much of the "
                 "renewal-after-destruction structure is pre-Christian is genuinely "
                 "uncertain.")

position("time", "nietzschean",
         "Eternal recurrence: everything returns identically, infinitely. Offered less as "
         "cosmology than as a test — could you affirm your life if you had to live it "
         "again without alteration?",
         sources=("nietzsche_gay_science",), key_terms=("ewige Wiederkunft",),
         stance="cyclical")

position("time", "hebrew",
         "Time is linear and directed, running from creation through covenant toward a "
         "consummation. History goes somewhere.",
         sources=("torah",), stance="linear")

position("time", "zoroastrian",
         "Time is a bounded contest. Limited time was set apart from infinite time for the "
         "struggle with evil to be fought and finished.",
         sources=("avesta",), key_terms=("zurvan", "frashokereti"), stance="linear")

position("time", "christian_patristic",
         "Time is created along with the world, not a container the world sits in. It is a "
         "distension of the mind: past and future exist only as memory and expectation.",
         sources=("augustine_confessions",), key_terms=("distentio animi",),
         stance="mind-dependent")

position("time", "aristotelian",
         "Time is not a thing but a measure — the number of motion with respect to before "
         "and after. No motion, no time.",
         sources=("aristotle_physics",), stance="relational")

position("time", "buddhist_early",
         "What exists is momentary. There is no enduring substance persisting through time; "
         "there are only arisings and ceasings in dependence.",
         sources=("pali_nikayas",), key_terms=("anicca", "khana"), stance="momentary")

position("time", "kantian",
         "Time is not discovered in the world but imposed by the mind as a form of "
         "intuition. Asking what time is 'in itself' is asking a question with no answer.",
         sources=("kant_cpr",), stance="mind-dependent")

position("time", "modern_cosmology",
         "Time began with the observable universe roughly 13.8 billion years ago and is "
         "not separable from space. Its apparent direction is tied to entropy increase, "
         "not to anything intrinsic in the equations.",
         sources=("lemaitre_1931", "penzias_wilson_1965"), stance="linear",
         tension="Physics has no settled account of why the arrow of time points one way "
                 "when the underlying laws are nearly time-symmetric.")

# ═══════════════════════════════════════════════════════════════════════════
# FATE AND FREEDOM
# ═══════════════════════════════════════════════════════════════════════════

position("fate", "vedic",
         "Action binds. Karma determines circumstance, but action within circumstance "
         "remains one's own — the Gita's answer is to act without attachment to the fruit.",
         sources=("bhagavad_gita",), key_terms=("karma", "nishkama karma"),
         stance="conditioned freedom",
         tension="If karma determines circumstance and disposition both, what is left to "
                 "choose with? The tradition argues about this and does not settle it.")

position("fate", "stoic",
         "Everything is fated, and freedom lies in assent. What is up to us is our "
         "judgement about events, never the events.",
         sources=("epictetus_discourses", "marcus_meditations"),
         key_terms=("heimarmene", "prohairesis"), stance="compatibilist")

position("fate", "buddhist_early",
         "Conditioned arising, not fate. Nothing is predetermined and nothing is "
         "uncaused — outcomes arise from conditions, and conditions can be altered.",
         sources=("pali_nikayas",), key_terms=("paticcasamuppada",),
         stance="conditioned freedom",
         tension="Explicitly rejects both hard determinism and pure chance, which leaves "
                 "the mechanism of agency underspecified.")

position("fate", "islamic_falsafa",
         "Divine decree encompasses all events, yet human acquisition of acts grounds "
         "responsibility — a position reached to preserve both omniscience and judgement.",
         sources=("ibn_rushd_tahafut",), key_terms=("qadar", "kasb"),
         stance="compatibilist")

position("fate", "scholastic",
         "God knows all things eternally, seeing time as a whole rather than foreseeing it "
         "in sequence; this is held to leave the will free.",
         sources=("aquinas_summa",), stance="compatibilist")

position("fate", "spinozist",
         "Nothing is contingent. Freedom is not exemption from necessity but understanding "
         "it — the free man is the one who grasps why he must act as he does.",
         sources=("spinoza_ethics",), stance="hard determinist")

position("fate", "epicurean",
         "Atoms swerve unpredictably, and that indeterminacy leaves room for the will. A "
         "universe of pure necessity would leave none.",
         sources=("lucretius_drn",), key_terms=("clinamen",), stance="libertarian")

position("fate", "yoruba",
         "Each person chooses a destiny before birth and then forgets it. Divination "
         "recovers what was chosen; ritual can adjust what is adjustable.",
         sources=("ifa_corpus",), key_terms=("orí", "àyànmọ́"),
         stance="conditioned freedom")

position("fate", "daoist",
         "The question is malformed. Effective action follows the grain of things rather "
         "than imposing on it; asking whether one is free or fated already assumes a "
         "separation that does not hold.",
         sources=("daodejing", "zhuangzi"), key_terms=("wu wei", "ziran"),
         stance="dissolves the question")

# ═══════════════════════════════════════════════════════════════════════════
# THE SELF
# ═══════════════════════════════════════════════════════════════════════════

position("self", "vedic",
         "The self is real and is ultimately identical with the ground of everything. "
         "That thou art.",
         sources=("upanishads",), key_terms=("atman", "brahman", "tat tvam asi"),
         stance="self is ultimate")

position("self", "advaita",
         "Only the non-dual is real. The individual self is the universal self under a "
         "misapprehension, and liberation is the correction of an error, not an achievement.",
         sources=("shankara_brahmasutra",), key_terms=("atman", "maya", "avidya"),
         stance="self is ultimate")

position("self", "buddhist_early",
         "No self is found. What is called a person is five processes in flux; the search "
         "for an owner behind them comes back empty.",
         sources=("pali_nikayas",), key_terms=("anatta", "khandha"), stance="no self",
         tension="If there is no self, what is reborn? The tradition's answers to this are "
                 "numerous and not in agreement.")

position("self", "madhyamaka",
         "The self is empty of intrinsic existence — but so is everything else, including "
         "emptiness. It is not that the self is unreal and other things real.",
         sources=("nagarjuna_mmk",), key_terms=("sunyata", "svabhava"), stance="no self")

position("self", "samkhya",
         "Consciousness and nature are utterly distinct. The witness does not act; all "
         "activity belongs to nature, and bondage is the confusion of the two.",
         sources=("samkhya_karika",), key_terms=("purusha", "prakriti"),
         stance="dualist")

position("self", "cartesian",
         "The thinking thing is the one certainty available. Whatever else may be doubted, "
         "the doubter cannot be.",
         sources=("descartes_meditations",), key_terms=("res cogitans", "cogito"),
         stance="dualist")

position("self", "confucian",
         "A person is constituted by relationships and cultivated through them. There is no "
         "self to find prior to the roles that form it.",
         sources=("analects",), key_terms=("ren", "li"), stance="relational")

position("self", "phenomenology",
         "The self is not a thing but a way of existing — thrown into a world, projecting "
         "toward possibilities, defined by having to become something.",
         sources=("heidegger_bt",), key_terms=("Dasein", "Geworfenheit"),
         stance="relational")

position("self", "analytic",
         "Whatever else explanation achieves, it leaves unexplained why any of it is "
         "accompanied by experience at all.",
         sources=("chalmers_1995",), stance="unresolved")

# ═══════════════════════════════════════════════════════════════════════════
# COSMOS
# ═══════════════════════════════════════════════════════════════════════════

position("cosmos", "neoplatonic",
         "Reality overflows downward from the One through Intellect and Soul into matter. "
         "Nothing is created; everything emanates, and everything seeks return.",
         sources=("plotinus_enneads",), key_terms=("the One", "nous", "emanation"),
         stance="emanation")

position("cosmos", "kabbalah",
         "The infinite contracts to make room for the world, which unfolds through ten "
         "sefirot as vessels of divine light.",
         sources=("zohar", "sefer_yetzirah"), key_terms=("Ein Sof", "sefirot", "tzimtzum"),
         stance="emanation",
         tension="Structurally Neoplatonic. Presented within the tradition as revelation "
                 "rather than as inheritance, but the transmission is well attested.")

position("cosmos", "sufi",
         "There is only one being; the world is its self-disclosure. Creation is not an "
         "event but a continuous manifestation.",
         sources=("ibn_arabi_fusus",), key_terms=("wahdat al-wujud", "tajalli"),
         stance="emanation")

position("cosmos", "hermetic",
         "The cosmos is a living whole whose parts correspond. What is below reflects what "
         "is above, and the human being contains the pattern of the whole.",
         sources=("corpus_hermeticum",), key_terms=("as above so below", "macrocosm"),
         stance="correspondence")

position("cosmos", "platonic",
         "A craftsman shapes a disordered receptacle after an eternal model. The world is "
         "a copy, and it is the best copy possible.",
         sources=("plato_timaeus",), key_terms=("demiurge", "forms", "chora"),
         stance="crafted")

position("cosmos", "hebrew",
         "Created by speech, out of nothing, by a will that stands outside it. The world "
         "is not divine and not eternal.",
         sources=("torah",), stance="created")

position("cosmos", "yijing",
         "The world is not made but generated — an unceasing alternation of two aspects "
         "producing the ten thousand things.",
         sources=("yijing",), key_terms=("yin", "yang", "taiji"), stance="generative")

position("cosmos", "daoist",
         "The nameless precedes the named. One gives rise to two, two to three, three to "
         "everything — and the source is not a maker.",
         sources=("daodejing",), key_terms=("dao", "wu", "ziran"), stance="generative")

position("cosmos", "epicurean",
         "Atoms and void, endlessly recombining. No design, no purpose, no gods with any "
         "interest in it.",
         sources=("lucretius_drn",), stance="material")

position("cosmos", "maya",
         "The world has been made and unmade several times. The current humanity is a "
         "later attempt, earlier ones having failed.",
         sources=("popol_vuh",), stance="repeated creation")

position("cosmos", "spinozist",
         "There is one substance, which may be called God or Nature. The world is not made "
         "by it; the world is it, seen under an attribute.",
         sources=("spinoza_ethics",), key_terms=("Deus sive Natura",), stance="monist")

position("cosmos", "modern_cosmology",
         "Expansion from a hot dense state 13.8 billion years ago, evidenced by the "
         "microwave background and by the abundances of light elements.",
         sources=("lemaitre_1931", "penzias_wilson_1965"), stance="created",
         tension="Says nothing about what preceded it, or whether that question is "
                 "well-formed. The theory describes the evolution of the universe, not "
                 "its origination from nothing.")

# ═══════════════════════════════════════════════════════════════════════════
# DEATH · CHANGE · MEANING
# ═══════════════════════════════════════════════════════════════════════════

position("death", "vedic", "Rebirth continues until liberation ends it.",
         sources=("upanishads", "bhagavad_gita"), key_terms=("samsara", "moksha"),
         stance="rebirth")

position("death", "buddhist_early",
         "Rebirth without a soul that transmigrates — a continuity of process, likened to "
         "one flame lighting another.",
         sources=("pali_nikayas",), key_terms=("punabbhava", "nibbana"), stance="rebirth")

position("death", "epicurean",
         "Death is nothing to us. Where death is, we are not; sensation ends and there is "
         "no one left for it to be bad for.",
         sources=("lucretius_drn",), stance="annihilation")

position("death", "egyptian",
         "Continued existence depends on the preservation of name, body and rite; the "
         "heart is weighed against truth.",
         sources=("egyptian_funerary",), key_terms=("ka", "ba", "maat"),
         stance="judgement")

position("death", "zoroastrian", "The soul is judged, and at the end all is renewed.",
         sources=("avesta",), key_terms=("frashokereti",), stance="judgement")

position("change", "presocratic",
         "Everything flows; the world is an ever-living fire kindling and going out in "
         "measures. Strife is the condition of order, not its enemy.",
         sources=("heraclitus_fragments",), key_terms=("panta rhei", "logos"),
         stance="change is fundamental")

position("change", "presocratic",
         "Change is impossible and the senses deceive. What is, is; what is not, cannot be "
         "spoken of.",
         sources=("parmenides_poem",), stance="permanence is fundamental",
         tension="Recorded under the same tradition as Heraclitus and directly "
                 "contradicting it — the Presocratics are not one position, and the "
                 "library does not smooth that over.")

position("change", "process",
         "The fundamental units of reality are events, not substances. A thing is an "
         "abstraction from a process.",
         sources=("whitehead_pr",), stance="change is fundamental",
         tension="Structurally close to Buddhist momentariness. Whitehead reached it from "
                 "mathematics and physics, with no meaningful Buddhist input — one of the "
                 "clearest genuine convergences in this library.")

position("meaning", "phenomenology",
         "The universe offers no answer. Meaning is not found but made, and the honest "
         "response to that is neither hope nor despair.",
         sources=("camus_sisyphus",), key_terms=("the absurd",), stance="constructed")

position("meaning", "aristotelian",
         "Everything has a characteristic activity, and doing it well is what flourishing "
         "consists in. Purpose is built into what a thing is.",
         sources=("aristotle_ethics", "aristotle_metaphysics"),
         key_terms=("telos", "eudaimonia"), stance="intrinsic purpose")

position("meaning", "daoist",
         "Seeking a purpose is itself the disturbance. Things left to themselves are "
         "already as they should be.",
         sources=("zhuangzi",), key_terms=("wu wei",), stance="dissolves the question")

position("one_many", "advaita", "Only one, without a second; multiplicity is superimposed.",
         sources=("shankara_brahmasutra",), stance="monist")

position("one_many", "jain",
         "Reality has many aspects and no single description captures it. Every claim is "
         "true from some standpoint and false from another.",
         sources=("tattvartha_sutra",), key_terms=("anekantavada", "syadvada"),
         stance="pluralist")

position("one_many", "leibnizian",
         "Infinitely many simple substances, each mirroring the whole universe from its "
         "own point of view, none interacting.",
         sources=("leibniz_monadology",), key_terms=("monad",), stance="pluralist")

position("one_many", "neoconfucian",
         "One pattern, many manifestations — as one moon appears in ten thousand rivers.",
         sources=("zhuxi_writings",), key_terms=("li", "qi"), stance="monist")
