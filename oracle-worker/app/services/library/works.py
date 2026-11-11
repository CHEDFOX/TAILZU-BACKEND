"""
LIBRARY — the philosophy and cosmology bibliography.

Registers into the SAME `provenance.sources` registry the calculation engines cite, so
there is one bibliography for the platform. A work backing a dasha computation and a work
answering "what is time" are the same kind of object and must never drift into two
catalogues that disagree about a date.

Selection principle: a work earns an entry by being a PRIMARY statement of a position that
some tradition actually holds. Secondary literature appears only in `editions`, as the
route by which a reader can reach the primary text.
"""
from app.services.provenance.sources import register, WISDOM, COSMOLOGY, SCIENCE

# ─── Greek ────────────────────────────────────────────────────────────────
register("heraclitus_fragments", title="Fragments", author="Heraclitus of Ephesus",
         date="c. 500 BCE", tradition="presocratic", language="Greek", kind=WISDOM,
         note="Survives only as quotations in later authors — roughly 130 fragments, "
              "many known solely because someone else disagreed with them.",
         editions=("Charles Kahn, The Art and Thought of Heraclitus (1979)",))

register("parmenides_poem", title="On Nature", author="Parmenides of Elea",
         date="c. 475 BCE", tradition="presocratic", language="Greek", kind=WISDOM,
         note="The founding argument that change is impossible and being is one — the "
              "position everything after it had to answer.")

register("plato_timaeus", title="Timaeus", author="Plato", date="c. 360 BCE",
         tradition="platonic", language="Greek", kind=COSMOLOGY,
         note="The most influential cosmology ever written in the West; for a thousand "
              "years it was the only Plato Latin Europe had.",
         editions=("Donald Zeyl, trans. (Hackett, 2000)",))

register("plato_republic", title="Republic", author="Plato", date="c. 375 BCE",
         tradition="platonic", language="Greek", kind=WISDOM)

register("aristotle_metaphysics", title="Metaphysics", author="Aristotle",
         date="c. 340 BCE", tradition="aristotelian", language="Greek", kind=WISDOM,
         editions=("W. D. Ross, trans.", "Joe Sachs, trans. (1999)"))

register("aristotle_physics", title="Physics", author="Aristotle", date="c. 350 BCE",
         tradition="aristotelian", language="Greek", kind=WISDOM,
         note="Contains the definition of time as 'the number of motion with respect to "
              "before and after' — time as a measure, not a substance.")

register("aristotle_ethics", title="Nicomachean Ethics", author="Aristotle",
         date="c. 340 BCE", tradition="aristotelian", language="Greek", kind=WISDOM)

register("epictetus_discourses", title="Discourses and Enchiridion", author="Epictetus",
         date="c. 108 CE", tradition="stoic", language="Greek", kind=WISDOM)

register("marcus_meditations", title="Meditations", author="Marcus Aurelius",
         date="c. 170–180 CE", tradition="stoic", language="Greek", kind=WISDOM)

register("lucretius_drn", title="De Rerum Natura", author="Lucretius",
         date="c. 55 BCE", tradition="epicurean", language="Latin", kind=COSMOLOGY,
         note="Atomist cosmology in verse — a universe of particles and void, with no "
              "purpose and no gods who care.")

register("plotinus_enneads", title="Enneads", author="Plotinus (ed. Porphyry)",
         date="c. 270 CE", tradition="neoplatonic", language="Greek", kind=WISDOM,
         note="The emanation scheme — reality overflowing downward from the One — that "
              "Kabbalah, Sufism and Christian mysticism all later inherit.",
         editions=("A. H. Armstrong, trans. (Loeb, 7 vols.)",))

register("corpus_hermeticum", title="Corpus Hermeticum",
         author="attrib. Hermes Trismegistus; multiple anonymous authors",
         date="1st–3rd c. CE", tradition="hermetic", language="Greek", kind=WISDOM,
         note="Dated to the Roman period by Isaac Casaubon in 1614, demolishing the "
              "Renaissance belief that it was primordial Egyptian wisdom older than "
              "Moses. The texts remain important; the origin claim does not survive.",
         editions=("Brian Copenhaver, trans. (Cambridge, 1992)",))

# ─── South Asian ──────────────────────────────────────────────────────────
register("upanishads", title="The Principal Upanishads", author="various, anonymous",
         date="c. 800–200 BCE", tradition="vedic", language="Sanskrit", kind=WISDOM,
         note="Not one work but a genre composed across centuries; the earliest "
              "(Brihadaranyaka, Chandogya) differ substantially from the later ones.",
         editions=("Patrick Olivelle, trans. (Oxford, 1996)",))

register("bhagavad_gita", title="Bhagavad Gita", author="attrib. Vyasa",
         date="c. 2nd c. BCE–2nd c. CE", tradition="vedic", language="Sanskrit", kind=WISDOM,
         editions=("Laurie Patton, trans. (Penguin)", "Winthrop Sargeant, interlinear"))

register("samkhya_karika", title="Samkhya Karika", author="Ishvarakrishna",
         date="c. 350–450 CE", tradition="samkhya", language="Sanskrit", kind=WISDOM,
         note="The dualism of purusha (consciousness) and prakriti (nature) that "
              "underlies classical yoga.")

register("shankara_brahmasutra", title="Brahmasutra Bhashya", author="Adi Shankara",
         date="c. 8th c. CE", tradition="advaita", language="Sanskrit", kind=WISDOM)

register("pali_nikayas", title="The Pali Nikayas", author="attrib. the Buddha; oral tradition",
         date="c. 5th c. BCE, written c. 1st c. BCE", tradition="buddhist_early",
         language="Pali", kind=WISDOM,
         editions=("Bhikkhu Bodhi, trans. (Wisdom Publications)",))

register("nagarjuna_mmk", title="Mulamadhyamakakarika", author="Nagarjuna",
         date="c. 150 CE", tradition="madhyamaka", language="Sanskrit", kind=WISDOM,
         note="The argument that nothing has intrinsic existence — including, self-"
              "referentially, that argument.",
         editions=("Jay Garfield, trans. (Oxford, 1995)",))

register("vasubandhu_trimsika", title="Trimsika (Thirty Verses)", author="Vasubandhu",
         date="c. 4th c. CE", tradition="yogacara", language="Sanskrit", kind=WISDOM)

register("tattvartha_sutra", title="Tattvartha Sutra", author="Umasvati",
         date="c. 2nd–5th c. CE", tradition="jain", language="Sanskrit", kind=WISDOM,
         note="Source of anekantavada — the doctrine that reality admits many valid "
              "partial descriptions and no single complete one.")

# ─── East Asian ───────────────────────────────────────────────────────────
register("daodejing", title="Dao De Jing", author="attrib. Laozi",
         date="c. 4th c. BCE (composite)", tradition="daoist",
         language="Classical Chinese", kind=WISDOM,
         editions=("D. C. Lau, trans.", "Roger Ames & David Hall, trans. (2003)"))

register("zhuangzi", title="Zhuangzi", author="Zhuang Zhou and later hands",
         date="c. 4th–2nd c. BCE", tradition="daoist", language="Classical Chinese",
         kind=WISDOM,
         editions=("Burton Watson, trans.", "Brook Ziporyn, trans. (2020)"))

register("analects", title="Analects", author="compiled by disciples of Confucius",
         date="c. 5th–3rd c. BCE", tradition="confucian", language="Classical Chinese",
         kind=WISDOM)

register("yijing", title="Yijing (Book of Changes) with the Ten Wings",
         author="anonymous; the Wings attrib. Confucian school",
         date="core c. 9th c. BCE; commentaries to c. 2nd c. BCE",
         tradition="yijing", language="Classical Chinese", kind=COSMOLOGY,
         note="Divination manual and cosmological treatise in one — the Ten Wings turn a "
              "book of oracles into a philosophy of change.",
         editions=("Richard Wilhelm / Cary Baynes, trans.", "Richard Rutt, trans. (1996)"))

register("zhuxi_writings", title="Collected Writings", author="Zhu Xi",
         date="12th c. CE", tradition="neoconfucian", language="Classical Chinese",
         kind=WISDOM, note="The li (pattern) and qi (energy) synthesis.")

# ─── Near Eastern / Abrahamic ─────────────────────────────────────────────
register("torah", title="Torah / Hebrew Bible", author="composite, traditionally Moses",
         date="c. 10th–5th c. BCE", tradition="hebrew", language="Hebrew", kind=COSMOLOGY)

register("sefer_yetzirah", title="Sefer Yetzirah", author="anonymous",
         date="c. 2nd–6th c. CE", tradition="kabbalah", language="Hebrew", kind=COSMOLOGY,
         note="Creation through letter and number — the oldest surviving Hebrew "
              "cosmological text of this kind.")

register("zohar", title="Sefer ha-Zohar", author="attrib. Shimon bar Yochai; "
                                                 "composed by Moses de León",
         date="late 13th c. CE", tradition="kabbalah", language="Aramaic", kind=WISDOM,
         note="Presents itself as a 2nd-century text; scholarship since Gershom Scholem "
              "attributes it to 13th-century Castile. Both facts belong in any honest "
              "citation of it.")

register("augustine_confessions", title="Confessions", author="Augustine of Hippo",
         date="c. 400 CE", tradition="christian_patristic", language="Latin", kind=WISDOM,
         note="Book XI contains the first sustained Western analysis of time as something "
              "belonging to the mind — 'if no one asks me, I know'.")

register("aquinas_summa", title="Summa Theologiae", author="Thomas Aquinas",
         date="1265–1274", tradition="scholastic", language="Latin", kind=WISDOM)

register("ibn_sina_shifa", title="Kitab al-Shifa (The Book of Healing)", author="Ibn Sina (Avicenna)",
         date="c. 1020", tradition="islamic_falsafa", language="Arabic", kind=WISDOM,
         note="The distinction between essence and existence — Aquinas builds on it "
              "directly.")

register("ibn_rushd_tahafut", title="Tahafut al-Tahafut (The Incoherence of the Incoherence)",
         author="Ibn Rushd (Averroes)", date="c. 1180", tradition="islamic_falsafa",
         language="Arabic", kind=WISDOM,
         note="A reply to al-Ghazali's attack on philosophy — the two books together are "
              "the best surviving record of the argument about whether reason can reach "
              "God.")

register("ibn_arabi_fusus", title="Fusus al-Hikam (The Bezels of Wisdom)", author="Ibn Arabi",
         date="c. 1229", tradition="sufi", language="Arabic", kind=WISDOM,
         note="Wahdat al-wujud — the unity of being.")

register("avesta", title="Avesta (Gathas)", author="attrib. Zarathustra",
         date="Gathas c. 1200–1000 BCE", tradition="zoroastrian", language="Avestan",
         kind=COSMOLOGY,
         note="The earliest systematic dualism of good and evil as cosmic principles — "
              "with a claim on later Jewish, Christian and Islamic eschatology that is "
              "widely accepted in outline and disputed in detail.")

# ─── Indigenous and non-Eurasian ──────────────────────────────────────────
register("popol_vuh", title="Popol Vuh", author="anonymous K'iche' Maya",
         date="transcribed c. 1550s from older oral tradition", tradition="maya",
         language="K'iche'", kind=COSMOLOGY,
         note="Records repeated creations and destructions of humanity. Survives because "
              "it was written down in the Latin alphabet after the conquest — the "
              "pre-conquest codices were almost entirely burned.",
         editions=("Dennis Tedlock, trans. (1996)", "Allen Christenson, trans. (2003)"))

# NOTE: the Odù Ifá corpus (`ifa_corpus`) is registered in
# provenance/methods/divination.py, not here. It is both a wisdom source and the source
# behind a computed method, and it must exist before the method registry validates
# `ifa_cast` — which loads earlier in the import chain than this module. One entry, in the
# layer that loads first.

register("egyptian_funerary", title="Pyramid, Coffin and Book of the Dead texts",
         author="anonymous priestly compilers", date="c. 2400–50 BCE",
         tradition="egyptian", language="Egyptian", kind=COSMOLOGY,
         note="Not a single scripture but three overlapping corpora spanning two millennia; "
              "'the Egyptian Book of the Dead' names a genre, not a book.")

register("poetic_edda", title="Poetic Edda", author="anonymous",
         date="compiled 13th c. from older oral material", tradition="norse",
         language="Old Norse", kind=COSMOLOGY,
         note="Written down by Christians two centuries after conversion — the sole route "
              "to Norse cosmology, and not a neutral one.")

# ─── Modern European ──────────────────────────────────────────────────────
register("descartes_meditations", title="Meditations on First Philosophy", author="René Descartes",
         date="1641", tradition="cartesian", language="Latin", kind=WISDOM)

register("spinoza_ethics", title="Ethics", author="Baruch Spinoza", date="1677",
         tradition="spinozist", language="Latin", kind=WISDOM,
         note="God and Nature as one substance, argued in geometrical form. Got him "
              "excommunicated and, for a century after, made 'Spinozist' a synonym for "
              "atheist.")

register("leibniz_monadology", title="Monadology", author="Gottfried Wilhelm Leibniz",
         date="1714", tradition="leibnizian", language="French", kind=WISDOM)

register("kant_cpr", title="Critique of Pure Reason", author="Immanuel Kant",
         date="1781 / 1787", tradition="kantian", language="German", kind=WISDOM,
         note="Space and time as forms the mind imposes rather than features it finds — "
              "which makes every cosmology in this library a claim about appearances.")

register("hegel_phenomenology", title="Phenomenology of Spirit", author="G. W. F. Hegel",
         date="1807", tradition="hegelian", language="German", kind=WISDOM)

register("nietzsche_gay_science", title="The Gay Science", author="Friedrich Nietzsche",
         date="1882", tradition="nietzschean", language="German", kind=WISDOM,
         note="Introduces eternal recurrence — a cyclical cosmology arrived at in a "
              "culture that had been linear for a millennium.")

register("whitehead_pr", title="Process and Reality", author="Alfred North Whitehead",
         date="1929", tradition="process", language="English", kind=WISDOM,
         note="Reality as events rather than things — the most developed Western attempt "
              "to make process primary, and structurally close to Buddhist momentariness "
              "though reached independently.")

register("heidegger_bt", title="Being and Time", author="Martin Heidegger", date="1927",
         tradition="phenomenology", language="German", kind=WISDOM)

register("camus_sisyphus", title="The Myth of Sisyphus", author="Albert Camus", date="1942",
         tradition="phenomenology", language="French", kind=WISDOM)

# ─── Modern science ───────────────────────────────────────────────────────
register("lemaitre_1931", title="The Beginning of the World from the Point of View of "
                                "Quantum Theory",
         author="Georges Lemaître", date="1931, Nature 127",
         tradition="modern_cosmology", language="English", kind=SCIENCE,
         note="The primeval-atom hypothesis — the universe having a beginning, proposed "
              "by a Catholic priest and initially resisted as suspiciously theological.")

register("penzias_wilson_1965", title="A Measurement of Excess Antenna Temperature at "
                                      "4080 Mc/s",
         author="Arno Penzias and Robert Wilson", date="1965, Astrophysical Journal 142",
         tradition="modern_cosmology", language="English", kind=SCIENCE,
         note="The cosmic microwave background, found by accident while eliminating noise. "
              "The observation that settled the question of whether the universe had a "
              "beginning.")

register("chalmers_1995", title="Facing Up to the Problem of Consciousness",
         author="David Chalmers", date="1995, Journal of Consciousness Studies 2(3)",
         tradition="analytic", language="English", kind=SCIENCE,
         note="Names the 'hard problem' — why physical processing is accompanied by "
              "experience at all. The point where modern philosophy of mind meets the "
              "question the contemplative traditions started from.")
