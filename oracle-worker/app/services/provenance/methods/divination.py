"""
PROVENANCE · METHODS — divination systems that read something other than the sky.

These matter disproportionately to the consensus engine. Every astrological method in the
registry ultimately descends from `planetary_positions`, so they share a substrate and
their agreement is partly structural. Ifá reads a cast; Liu Yao charges a hexagram; Plum
Blossom reads a number. None of them touches an ephemeris, which makes them genuinely
independent testimony rather than the same measurement in another vocabulary.
"""
from app.services.provenance.sources import register, CLASSICAL, MODERN, WISDOM
from app.services.provenance.registry import (
    method, DETERMINISTIC, PARAMETRIC, INTERPRETIVE,
)

# ─── Sources ──────────────────────────────────────────────────────────────
# The Odù Ifá corpus is registered HERE rather than in library/works.py: it is both a
# wisdom source and the source behind a computed method, and the method registry validates
# its citations at import — which happens before the library package loads. One entry, in
# the layer that loads first.
register("ifa_corpus", title="Odù Ifá", author="oral corpus, transmitted by babaláwo",
         date="traditional; attested precolonially", tradition="yoruba",
         language="Yoruba", kind=WISDOM,
         note="256 odù, each with a body of verses memorised across years of training. A "
              "living oral system — printed collections are partial records of it, not the "
              "thing itself, and no written version is authoritative over a lineage's own "
              "transmission.")

register("huo_zhu_lin", title="Huo Zhu Lin (火珠林)", author="attrib. Ma Yi",
         date="Song dynasty, c. 10th–13th c.", tradition="chinese",
         language="Classical Chinese", kind=CLASSICAL,
         note="The earliest surviving statement of the na jia hexagram method — the shift "
              "from consulting the Yijing's text to charging its lines with branches and "
              "reading them as a determinate structure. Liu Yao is sometimes still called "
              "the Huo Zhu Lin method after it.")

register("bu_shi_zheng_zong", title="Bu Shi Zheng Zong (卜筮正宗)", author="Wang Weide",
         date="1709", tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="The standard systematic treatment: Useful God selection, the strength tests "
              "against day and month, and the void. Most modern Liu Yao practice follows "
              "its framework.")

register("zeng_shan_bu_yi", title="Zeng Shan Bu Yi (增刪卜易)", author="Ye Feizi, ed. Li Wenhui",
         date="c. 1690", tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="Argues for stripping the method back to the Useful God and its support, "
              "against the accumulated shensha. The two texts genuinely disagree about how "
              "much apparatus the method needs.")

register("mei_hua_yi_shu", title="Mei Hua Yi Shu (梅花易數)",
         author="attrib. Shao Yong", date="attributed to the 11th c.; extant text later",
         tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="The attribution to Shao Yong is traditional rather than established — the "
              "surviving text postdates him and the association may be honorific.")

register("rodden_astrodata", title="The Astro-Data series / AstroDatabank",
         author="Lois M. Rodden", date="1979–2003; database maintained since",
         tradition="research", language="English", kind=MODERN,
         note="Introduced the birth-data quality scale that became the field's standard. "
              "Its significance is methodological rather than astrological: it made it "
              "possible to state how good the inputs to a study actually were, which no "
              "earlier collection had done.")

# ─── Methods ──────────────────────────────────────────────────────────────

method(
    id="liu_yao",
    name="Liu Yao / Wen Wang Gua (六爻)",
    system="chinese", level=1, determinacy=PARAMETRIC,
    sources=("huo_zhu_lin", "bu_shi_zheng_zong", "zeng_shan_bu_yi"),
    inputs=("hexagram_key", "moving_lines", "day_stem", "day_branch", "month_branch",
            "question_topic"),
    outputs=("palace", "six_relatives", "six_gods", "self_and_other_lines", "void_lines",
             "useful_god_verdict"),
    scope="horary",
    steps=("identify the hexagram's palace from the eight-palace transformation scheme",
           "assign each line its earthly branch by na jia (納甲)",
           "derive each line's Six Relative role from its element against the palace element",
           "seed the Six Gods from the day stem",
           "select the Useful God from the question's topic",
           "test that line's strength against the month and day, and for void"),
    assumptions=("The palace is computed from the transformation rule rather than a table, "
                 "and the module asserts that the generation yields all 64 hexagrams "
                 "exactly once.",
                 "Useful God selection follows Bu Shi Zheng Zong's topic mapping."),
    limitations=("Bu Shi Zheng Zong and Zeng Shan Bu Yi disagree about how much apparatus "
                 "the method needs — the second argues for discarding most of the shensha "
                 "the first retains. This implementation follows the leaner reading.",
                 "Useful God selection is where practitioner skill actually lives; the "
                 "topic mapping here handles common cases and cannot handle a question "
                 "whose real subject differs from its stated one.",
                 "Requires the question's own moment, not the querent's birth data — it "
                 "says nothing about a person in general."),
    implemented_in="app.services.chinese.liuyao",
    related=("prashna", "plum_blossom"),
    also_known_as=("liu yao", "wen wang gua", "六爻", "na jia", "chinese horary"),
)

method(
    id="plum_blossom",
    name="Plum Blossom Numerology (梅花易數)",
    system="chinese", level=1, determinacy=PARAMETRIC,
    sources=("mei_hua_yi_shu",),
    inputs=("number_1", "number_2", "optional_number_3"),
    outputs=("hexagram", "moving_line", "ti_trigram", "yong_trigram", "relation_verdict",
             "nuclear", "changed"),
    scope="horary",
    steps=("upper trigram from the first number mod 8, lower from the second",
           "moving line from the total mod 6",
           "the trigram without the moving line is Ti (the querent), the other is Yong",
           "read the five-phase relation between Ti and Yong"),
    assumptions=("先天 (Earlier Heaven) trigram numbering. The 後天 sequence assigns "
                 "different numbers and produces a different hexagram from the same "
                 "inputs — a real fork, chosen explicitly rather than by default.",),
    limitations=("The entire verdict rests on one five-phase relation, which makes the "
                 "method fast and coarse. It answers favourable/unfavourable well and "
                 "specifics badly.",
                 "Any two numbers will serve, so the method offers no protection against "
                 "a querent choosing numbers until they like the answer."),
    implemented_in="app.services.chinese.meihua",
    related=("liu_yao",),
    also_known_as=("plum blossom", "mei hua", "梅花易數", "shao yong method"),
)

method(
    id="ifa_cast",
    name="Ifá odù casting",
    system="ifa", level=1, determinacy=DETERMINISTIC,
    sources=("ifa_corpus",),
    inputs=("opele_throw", "or_ikin_passes"),
    outputs=("odu_compound", "right_leg", "left_leg", "meji_status", "seniority_rank"),
    scope="horary",
    steps=("cast the ọ̀pẹ̀lẹ̀ chain once, or make eight valid ikin passes",
           "read four marks per leg, right leg first",
           "identify each leg's odù from its mark pattern",
           "the pair names the compound odù, which indexes its body of verses"),
    assumptions=("Marks encoded 1 = single, 0 = double, read top to bottom. Under this "
                 "convention the sixteen odù occupy all sixteen 4-bit patterns exactly "
                 "once — asserted at import.",
                 "Standard Yoruba seniority ordering."),
    limitations=("This computes the FIGURE only. The ese — the verses that carry the "
                 "actual divinatory content — are an oral corpus held by initiated "
                 "babaláwo and are not reproduced here. An odù without its verses is an "
                 "index without the text.",
                 "Lineages differ: Yoruba, Fon (Fá), Cuban Lucumí and Brazilian lines do "
                 "not agree on reading direction or on seniority order.",
                 "Traditional practice holds that a valid consultation requires an "
                 "initiated diviner and the accompanying sacrifice (ẹbọ). A computed "
                 "figure is not a consultation, and the platform should not imply it is."),
    implemented_in="app.services.ifa",
    also_known_as=("ifa", "odu", "opele", "ikin", "orunmila", "babalawo"),
)

method(
    id="rodden_rating",
    name="Rodden birth-data rating",
    system="research", level=2, determinacy=DETERMINISTIC,
    sources=("rodden_astrodata", "dean_kelly_2003"),
    inputs=("birth_record_provenance",),
    outputs=("rating", "quality_floor", "admissibility", "rounding_bias"),
    scope="statistical",
    steps=("classify each record AA/A/B/C/DD/X/XX by the documentary source of its time",
           "map the technique under test to its minimum viable rating",
           "exclude records below that floor, reporting the count dropped",
           "test the minute distribution for the remembered-time rounding signature"),
    assumptions=("Angular techniques need A or better; lunar techniques B or better; "
                 "date-derived techniques need only the date.",),
    limitations=("A rating describes the SOURCE of a record, not its correctness — an AA "
                 "birth certificate can still record a time written down carelessly.",
                 "Filtering to a quality floor shrinks the sample and can introduce its "
                 "own bias, since documented births skew toward particular countries and "
                 "decades. The filter reports what it dropped for exactly this reason."),
    implemented_in="app.services.patterns.rodden",
    related=("pattern_discovery", "gauquelin_sectors"),
    also_known_as=("rodden rating", "birth data quality", "astrodatabank", "data rating"),
)


# ═══════════════════════════════════════════════════════════════════════════
# THE THREE STYLES (三式) — Qi Men, Da Liu Ren, Tai Yi
# ═══════════════════════════════════════════════════════════════════════════
# Historically the restricted tier of Chinese divination. Possession of Tai Yi texts was
# periodically a criminal matter under several dynasties, on the reasoning that a method
# for predicting the fall of governments interests chiefly those planning one.

register("yanbo_diaosou", title="Yan Bo Diao Sou Ge (煙波釣叟歌)",
         author="anonymous", date="Song–Ming; the verse form is older",
         tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="The memorised verse that carries the Qi Men method — the ju sequence, the "
              "doors and the auspicious configurations, compressed into rhyme because the "
              "system was transmitted orally under restriction.")

register("qimen_tongzong", title="Qi Men Dun Jia Tong Zong (奇門遁甲統宗)",
         author="compiled, attrib. Liu Bowen", date="Ming dynasty",
         tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="The standard systematic compilation. The attribution to Liu Bowen is "
              "traditional and almost certainly honorific — the same pattern as Di Tian "
              "Sui.")

register("liuren_daquan", title="Liu Ren Da Quan (六壬大全)",
         author="compiled under imperial commission", date="Ming dynasty",
         tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="The most complete surviving collection of Da Liu Ren method, including the "
              "nine procedures (九宗門) for extracting the transmissions.")

register("bifa_fu", title="Bi Fa Fu (畢法賦)", author="attrib. Ling Fu",
         date="Song dynasty", tradition="chinese", language="Classical Chinese",
         kind=CLASSICAL,
         note="A hundred judgement rules in verse — the interpretive layer above the "
              "mechanical construction of the chart.")

register("taiyi_jinjing", title="Tai Yi Jin Jing Shi Jing (太乙金鏡式經)",
         author="Wang Xi (王希明)", date="Tang dynasty, 8th c.",
         tradition="chinese", language="Classical Chinese", kind=CLASSICAL,
         note="The earliest substantial Tai Yi text to survive. Later compilations do not "
              "agree with it on the 積年 epoch, which is why any Tai Yi chart must state "
              "the reckoning it uses.")

method(
    id="qimen_dunjia",
    name="Qi Men Dun Jia (奇門遁甲)",
    system="chinese", level=1, determinacy=PARAMETRIC,
    sources=("yanbo_diaosou", "qimen_tongzong"),
    inputs=("solar_term", "day_stem", "day_branch", "hour_stem", "hour_branch"),
    outputs=("ju_selection", "earth_plate", "heaven_plate", "eight_doors", "nine_stars",
             "eight_spirits", "duty_chief", "duty_envoy"),
    scope="electional",
    steps=("determine yin or yang dun from the solar term",
           "read the yuan from the branch of the governing 符頭 day",
           "take the ju number from the term-and-yuan table",
           "lay the Six Instruments and Three Wonders from the ju palace, forward for "
           "yang dun and backward for yin",
           "find the hour's 旬 and its hidden instrument to locate the duty chief",
           "rotate the stars and their stems so the chief lands on the hour stem's palace",
           "move the duty envoy door by the hour's position within its 旬",
           "count the Eight Spirits from the chief's landing palace"),
    assumptions=("拆補法 (chai bu) for yuan selection. 置閏法 inserts an intercalary period "
                 "and yields a different ju on some days — a real fork between schools.",
                 "轉盤 (rotating plate) for the heaven plate. 飛盤 (flying plate) moves "
                 "stems by palace number and produces a different chart entirely.",
                 "Palace 5 holds no door; its duty falls to palace 2 (寄宮)."),
    limitations=("Two competent Qi Men implementations can disagree completely because "
                 "they chose different conventions, not because either is wrong. A chart "
                 "is only comparable to another built the same way.",
                 "The system answers WHERE and WHEN to act. It is not a natal method and "
                 "says nothing about a life as a whole.",
                 "Requires an accurate solar term boundary; a chart cast on the wrong side "
                 "of a term uses the wrong ju entirely."),
    implemented_in="app.services.chinese.qimen",
    related=("muhurta", "liu_yao"),
    also_known_as=("qi men", "qimen", "dun jia", "奇門遁甲", "mysterious gates",
                   "three styles"),
)

method(
    id="da_liu_ren",
    name="Da Liu Ren (大六壬)",
    system="chinese", level=1, determinacy=INTERPRETIVE,
    sources=("liuren_daquan", "bifa_fu"),
    inputs=("month_general_term", "day_stem", "day_branch", "hour_branch", "daytime"),
    outputs=("heaven_plate", "twelve_generals", "four_lessons", "three_transmissions"),
    scope="horary",
    steps=("take the month general from the 中氣 the sun has passed",
           "turn the heaven plate until the month general rests on the hour branch",
           "seat the twelve generals from 貴人, placed by day stem and by whether it is day "
           "or night",
           "read the Four Lessons from the stem's lodging branch and the day branch",
           "extract the Three Transmissions by 賊剋, falling through to 比用 and beyond"),
    assumptions=("The 賊剋 and 比用 procedures are implemented. The remaining seven of the "
                 "nine procedures — 涉害, 遙剋, 昴星, 別責, 八專 and the two degenerate "
                 "cases — are DETECTED and named but not resolved.",),
    limitations=("Where the implemented procedures cannot settle the initial transmission, "
                 "the chart reports it unresolved rather than guessing. The whole reading "
                 "hangs on that one branch, so a plausible wrong answer is worse than an "
                 "acknowledged gap.",
                 "伏吟 and 返吟 charts are detected but take special transmission rules "
                 "not implemented here.",
                 "The day/night distinction for 貴人 needs true local sunrise and sunset, "
                 "not clock hours."),
    implemented_in="app.services.chinese.daliuren",
    related=("liu_yao", "prashna", "qimen_dunjia"),
    also_known_as=("liu ren", "da liu ren", "大六壬", "six ren", "four lessons",
                   "three transmissions"),
)

method(
    id="tai_yi",
    name="Tai Yi Shen Shu (太乙神數)",
    system="chinese", level=4, determinacy=INTERPRETIVE,
    sources=("taiyi_jinjing",),
    inputs=("year", "epoch_year", "guest_offset"),
    outputs=("taiyi_palace", "host_calculation", "guest_calculation", "favoured_party"),
    scope="mundane",
    steps=("count accumulated years from the stated epoch",
           "advance Tai Yi one palace every three years through the eight palaces",
           "reduce the host and guest reckonings into the sixteen positions",
           "judge which party the configuration favours by proximity to Tai Yi's palace"),
    assumptions=("The epoch is a REQUIRED parameter with no default. Surviving texts "
                 "disagree about it by margins large enough to change which palace Tai Yi "
                 "occupies, so a silent default would let incompatible reckonings be "
                 "compared as though they matched.",),
    limitations=("The least well transmitted of the Three Styles. The sixteen positions "
                 "and the host/guest architecture are stable across sources; the 計神, "
                 "始擊 and 三基/五福 apparatus is not, and is not computed here.",
                 "MUNDANE only — states, campaigns, eras. Applying it to an individual is "
                 "a category error the tradition itself does not make, and the consensus "
                 "engine will exclude it from personal-scope questions on that basis.",
                 "Several surviving texts are partial and modern reconstructions disagree "
                 "about the gaps."),
    implemented_in="app.services.chinese.taiyi",
    related=("barbault_cyclic_index", "qimen_dunjia"),
    also_known_as=("tai yi", "taiyi", "太乙神數", "tai yi shen shu", "three styles"),
)
