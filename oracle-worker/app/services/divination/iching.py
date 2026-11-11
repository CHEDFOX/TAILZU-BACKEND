"""
I CHING — the 64 hexagrams from the 8 trigrams (verified binary→hexagram data).

The user picks the LOWER then the UPPER trigram; the two combine into a hexagram. The
binary→hexagram map (HEX) was extracted from the published `iching` package and verified:
all 64 hexagrams are reachable from the 8 trigrams and the anchors are correct
(Heaven/Heaven=乾, Earth/Earth=坤, Earth-over-Heaven=泰 Tài, Heaven-over-Earth=否 Pǐ). Encoding:
each hexagram key = upper-trigram (3 lines, top→bottom) + lower-trigram (3 lines, top→bottom).
"""
TITLE = "I Ching"
MEDIA_PREFIX = "iching"
BACK = "iching/back"
NOUN = "trigram"

# (id, English, pinyin, chinese, top→bottom binary, keyword seed)
TRIGRAMS = [
    ("qian", "Heaven", "Qián", "乾", "111", "the creative — strength, initiative, the sky"),
    ("kun",  "Earth",  "Kūn",  "坤", "000", "the receptive — yielding, nourishing, the ground"),
    ("zhen", "Thunder","Zhèn", "震", "001", "the arousing — shock, movement, awakening"),
    ("kan",  "Water",  "Kǎn",  "坎", "010", "the abysmal — danger, depth, the flow"),
    ("gen",  "Mountain","Gèn", "艮", "100", "keeping still — stopping, the threshold, rest"),
    ("xun",  "Wind",   "Xùn",  "巽", "110", "the gentle — penetration, gradual influence"),
    ("li",   "Fire",   "Lí",   "離", "101", "the clinging — light, clarity, awareness"),
    ("dui",  "Lake",   "Duì",  "兌", "011", "the joyous — openness, pleasure, exchange"),
]
_TRI_BIN = {t[0]: t[4] for t in TRIGRAMS}
_TRI_NAME = {t[0]: f"{t[1]} ({t[2]})" for t in TRIGRAMS}
_TRI_SEED = {t[0]: t[5] for t in TRIGRAMS}

# The pickable "deck" is the 8 trigrams; the user places one Lower and one Upper.
DECK = [{"id": t[0], "name": f"{t[1]} · {t[2]}", "seed": t[5], "media": f"{MEDIA_PREFIX}/{t[0]}"} for t in TRIGRAMS]

SPREADS = {
    "hexagram": {"name": "The Hexagram", "positions": [
        {"id": "lower", "label": "Lower", "meaning": "the inner trigram — the foundation"},
        {"id": "upper", "label": "Upper", "meaning": "the outer trigram — the situation around it"}]},
}
DEFAULT_SPREAD = "hexagram"

# VERIFIED binary → hexagram (Chinese name), all 64. key = upper(3)+lower(3), top→bottom.
HEX = {
    "000000": "坤",
    "000001": "复",
    "000010": "师",
    "000011": "临",
    "000100": "谦",
    "000101": "明夷",
    "000110": "升",
    "000111": "泰",
    "001000": "豫",
    "001001": "震",
    "001010": "解",
    "001011": "归妹",
    "001100": "小过",
    "001101": "丰",
    "001110": "恒",
    "001111": "大壮",
    "010000": "比",
    "010001": "屯",
    "010010": "坎",
    "010011": "节",
    "010100": "蹇",
    "010101": "既济",
    "010110": "井",
    "010111": "需",
    "011000": "萃",
    "011001": "随",
    "011010": "困",
    "011011": "兑",
    "011100": "咸",
    "011101": "革",
    "011110": "大过",
    "011111": "夬",
    "100000": "剥",
    "100001": "颐",
    "100010": "蒙",
    "100011": "损",
    "100100": "艮",
    "100101": "贲",
    "100110": "蛊",
    "100111": "大畜",
    "101000": "晋",
    "101001": "噬嗑",
    "101010": "未济",
    "101011": "睽",
    "101100": "旅",
    "101101": "离",
    "101110": "鼎",
    "101111": "大有",
    "110000": "观",
    "110001": "益",
    "110010": "涣",
    "110011": "中孚",
    "110100": "渐",
    "110101": "家人",
    "110110": "巽",
    "110111": "小畜",
    "111000": "否",
    "111001": "无妄",
    "111010": "讼",
    "111011": "履",
    "111100": "遁",
    "111101": "同人",
    "111110": "姤",
    "111111": "乾"
}


def hexagram(lower_id: str, upper_id: str):
    """Combine the two chosen trigrams into their hexagram. Returns None on bad ids."""
    if lower_id not in _TRI_BIN or upper_id not in _TRI_BIN:
        return None
    key = _TRI_BIN[upper_id] + _TRI_BIN[lower_id]
    return {
        "chinese": HEX.get(key), "key": key,
        "upper": _TRI_NAME[upper_id], "upper_seed": _TRI_SEED[upper_id],
        "lower": _TRI_NAME[lower_id], "lower_seed": _TRI_SEED[lower_id],
    }


# ── DEEPER LAYERS — every derived hexagram is pure bit-math on the 6-bit key
#    (upper top→bottom + lower top→bottom), so each is exact and self-verifying. ──
def _lines_bottom_top(key: str):
    """key → the six lines read BOTTOM→TOP (L1..L6), each 0 (yin) or 1 (yang)."""
    return [int(key[5]), int(key[4]), int(key[3]), int(key[2]), int(key[1]), int(key[0])]


def _key_from_bottom_top(lines):
    """The inverse of _lines_bottom_top: L1..L6 → the 6-bit key."""
    return "".join(str(b) for b in reversed(lines))


def _named(key: str):
    return {"key": key, "chinese": HEX.get(key)}


def nuclear_hexagram(key: str):
    """互卦 — the hidden hexagram inside: lower nuclear = lines 2-3-4, upper = lines 3-4-5.
    It shows the situation's inner, concealed dynamic."""
    L = _lines_bottom_top(key)                      # L[0]=L1 … L[5]=L6
    inner = [L[1], L[2], L[3], L[2], L[3], L[4]]     # L2 L3 L4 (lower) · L3 L4 L5 (upper)
    return _named(_key_from_bottom_top(inner))


def opposite_hexagram(key: str):
    """錯卦 (cuò) — the inverse: every line flipped. The complete polar opposite."""
    return _named("".join("1" if c == "0" else "0" for c in key))


def reversed_hexagram(key: str):
    """綜卦 (zōng) — the hexagram turned upside-down: the same situation seen from the
    other party's point of view."""
    L = _lines_bottom_top(key)
    return _named(_key_from_bottom_top(list(reversed(L))))


def changed_hexagram(key: str, moving_lines):
    """變卦 (biàn / Fan Yao) — flip the given moving line numbers (1-6, bottom→top) to
    get the hexagram the situation is transforming INTO. Empty list → same hexagram."""
    L = _lines_bottom_top(key)
    for n in moving_lines or []:
        if 1 <= int(n) <= 6:
            L[int(n) - 1] ^= 1
    return _named(_key_from_bottom_top(L))


def deep(lower_id: str, upper_id: str, moving_lines=None):
    """The full reading: the primary hexagram plus its nuclear, opposite, reversed and
    (if moving lines are given) changed hexagram — each named from the verified table."""
    primary = hexagram(lower_id, upper_id)
    if not primary:
        return None
    key = primary["key"]
    out = {
        "primary": primary,
        "nuclear": nuclear_hexagram(key),
        "opposite": opposite_hexagram(key),
        "reversed": reversed_hexagram(key),
    }
    if moving_lines:
        out["changed"] = changed_hexagram(key, moving_lines)
        out["moving_lines"] = list(moving_lines)
    return out


if __name__ == "__main__":
    # anchors: Qian(乾) is self-nuclear & self-reversed, its opposite is Kun(坤)
    q = "111111"; k = "000000"
    assert nuclear_hexagram(q)["chinese"] == "乾" and nuclear_hexagram(k)["chinese"] == "坤"
    assert opposite_hexagram(q)["chinese"] == "坤" and opposite_hexagram(k)["chinese"] == "乾"
    assert reversed_hexagram(q)["chinese"] == "乾"
    # 泰 Tài (peace) → nuclear 歸妹(归妹), opposite 否(Pǐ), reversed 否
    tai = hexagram("qian", "kun")["key"]    # lower Heaven, upper Earth = 泰
    print("泰 key", tai, "nuclear", nuclear_hexagram(tai), "opposite", opposite_hexagram(tai),
          "reversed", reversed_hexagram(tai))
