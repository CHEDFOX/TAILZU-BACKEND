"""
Catalog i18n — translate the catalog's UI copy (labels + section titles/
subtitles) into the requested language, tone-preserving, cached per language.

DEFENSIVE BY DESIGN: any failure (no key, LLM error, bad JSON, anything)
returns the English payload unchanged, so the /catalog endpoint can never
break — worst case the UI stays English.

Cache: data/cache/catalog_i18n/<lang>.json, keyed by a hash of the English
copy so a copy change auto-invalidates the translation.
"""
import asyncio
import re
import json
import hashlib
import logging
from pathlib import Path

import httpx

from app.core.config import settings

_log = logging.getLogger(__name__)
_CACHE_DIR = Path(__file__).resolve().parents[3] / "data" / "cache" / "catalog_i18n"
_mem: dict = {}

# Bump to invalidate ALL cached translations after a translator-prompt change
# (the cache key is a hash of the source copy, which doesn't change when only the
# prompt does — so this version is mixed into the hash).
_TR_PROMPT_VERSION = "3"   # bumped: explicit language name + Sanskrit/Hindi anti-drift guard


def _hash(obj) -> str:
    return hashlib.md5(json.dumps([_TR_PROMPT_VERSION, obj], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]


def _lang(lang) -> str:
    """Every caller's language, narrowed to one the app offers ("en" otherwise).
    The code is a file name below and an LLM target, so a feature endpoint that
    passes a request's `language` straight through must not be able to aim either."""
    from app.services.onboarding_content import supported_language
    return supported_language(lang)


def _disk(lang: str) -> Path:
    return _CACHE_DIR / f"{lang}.json"


def _load(lang: str, h: str):
    e = _mem.get(lang)
    if e and e.get("h") == h:
        return e["data"]
    try:
        with _disk(lang).open(encoding="utf-8") as f:
            e = json.load(f)
        if e.get("h") == h:
            _mem[lang] = e
            return e["data"]
    except Exception:
        pass
    return None


def _save(lang: str, h: str, data) -> None:
    _mem[lang] = {"h": h, "data": data}
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with _disk(lang).open("w", encoding="utf-8") as f:
            json.dump({"h": h, "data": data}, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


async def _translate(bundle: dict, lang: str):
    if not getattr(settings, "OPENROUTER_API_KEY", None):
        return None
    # Name the language explicitly + guard drift-prone targets (Sanskrit↔Hindi,
    # Gujarati↔Kannada, …) — the ISO code alone lets the model fall back to a sibling.
    from app.services.voice import LANG_NAMES, LANG_GUARD
    _lc = (lang or '').split('-')[0]
    _name = LANG_NAMES.get(_lc, '')
    _target = f"{_name} (ISO code '{lang}')" if _name else f"the language with ISO code '{lang}'"
    _guard = LANG_GUARD.get(_lc)
    _guard_clause = f" The language is {_guard[0]}. {_guard[1]} " if _guard else " "
    prompt = (
        f"Translate the string VALUES of this JSON into {_target}.{_guard_clause}"
        "Keep an elegant, calm, slightly poetic register (a premium astrology app). "
        "Preserve the JSON shape and ALL keys exactly. Keep short labels short; keep ACTION "
        "words uppercase if the script supports caps. Translate every value — do not leave English. "
        f"CRITICAL — SCRIPT RULE: write EVERY value in the script of the target language '{lang}' ONLY. "
        "Never output Chinese characters (Hanzi) unless the target language IS Chinese; never output "
        "Devanagari unless the target language itself uses it. A reader of "
        f"'{lang}' must be able to read every character. "
        "For TRADITIONAL or technical terms (astrology / numerology, Sanskrit or Chinese concepts "
        "such as Grahas, Gochara, Bhavas, Dashas, Guna Milan, Wu Xing, Da Yun, Liu Nian, He Hun, "
        "Jiu Xing, Synastry, Arithmancy, the five elements, the zodiac animals): give the term's "
        "established native form WRITTEN IN THE TARGET LANGUAGE'S SCRIPT — e.g. for Hindi use the "
        "conventional Devanagari rendering, transliterating a Chinese BaZi term into Devanagari if "
        "there is no native word. Only render a term in Hanzi when the target language is Chinese. "
        "Return ONLY the translated JSON object, no prose, no markdown fences.\n\n"
        + json.dumps(bundle, ensure_ascii=False)
    )
    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": settings.OPENROUTER_MODEL,
                    "messages": [
                        {"role": "system", "content": "You translate UI copy. Output only valid JSON. No prose."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 9000,
                    "response_format": {"type": "json_object"},
                },
            )
            if r.status_code != 200:
                return None
            raw = r.json()["choices"][0]["message"]["content"].strip()
            # Tolerate the usual model slips (code fences, trailing commas, stray
            # comments) so a single malformed char doesn't drop the whole batch back
            # to English. parse_json_or_text returns {'text': raw} only on total
            # failure — treat that as "no translation" (None) so callers fall back.
            from app.services.features._base import parse_json_or_text
            d = parse_json_or_text(raw)
            return d if (isinstance(d, dict) and list(d.keys()) != ["text"]) else None
    except Exception:
        return None


# PER-STRING translation cache (the durable fix for "titles & buttons leak
# English"): a flat {english: translated} map per language, accumulated over
# time. Unlike the old per-BATCH hash, a stable string (a button, a title) is
# cached the first time it's ever seen and ALWAYS hits afterwards — even when the
# same request also carries dynamic strings (names, dates, generated titles) that
# would have changed a batch hash and forced everything to re-translate live (and
# leak English on any flake). Only genuinely-new strings ever hit the LLM.
_str_mem: dict = {}            # lang -> {english: translated}
_STRCACHE_CAP = 8000           # cap per language; trim oldest (insertion order) on overflow

# Heavy / non-Latin scripts whose translated output is far more token-dense, so a
# big batch makes one LLM call strain or fail (this is why complex languages leaked
# while Latin ones were fine). We translate these in SMALL chunks — many light,
# reliable calls instead of one heavy one — and cap how many run per request so no
# single turn carries a big load; the rest fill in over the next few requests
# (per-string cache makes that cheap and permanent).
_HEAVY_SCRIPT_LANGS = {
    'hi', 'mr', 'ne', 'sa', 'kok', 'mai', 'bn', 'as', 'gu', 'pa', 'or', 'ta', 'te',
    'kn', 'ml', 'si', 'ur', 'fa', 'ar', 'am', 'my', 'km', 'lo', 'th', 'ks', 'sd',
    'he', 'el', 'ru', 'uk', 'ja', 'ko', 'zh',
    # The rest of the Eighth Schedule and the large regional languages. Devanagari
    # and Kannada are already represented above, so the chunking reason is the same;
    # Ol Chiki (sat) and Meitei Mayek (mni) are rarer still and chunk smaller for it.
    'doi', 'sat', 'mni', 'brx', 'bho', 'mag', 'awa', 'hne', 'raj', 'bgc', 'tcy',
}


# LETTER-SPACING BREAKS JOINED SCRIPTS. Small capitals are tracked (letterSpacing
# 2-3) in Latin, and the same style on Devanagari, Bengali, Tamil, Arabic, Thai…
# pulls each conjunct and matra apart ("बुधवार" reads "बु ध वा र"). Those scripts
# have no capitals to space, so a tree shown in one gets its tracking removed.
_JOINED = re.compile('[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0fff\u1000-\u109f\u1780-\u18af\u1c50-\u1c7f\ua8e0-\uabff]')


def joined_script(text: str) -> bool:
    """True when `text` is written in a script that tracking breaks."""
    return bool(text) and bool(_JOINED.search(text))


def untrack(tree) -> None:
    """Set letterSpacing to 0 on every styled node of an SDUI tree, in place."""
    if isinstance(tree, dict):
        st = tree.get("style")
        if isinstance(st, dict) and st.get("letterSpacing"):
            st["letterSpacing"] = 0
        if tree.get("type") in ("text", "heading", "overline", "label", "paragraph"):
            tree["style"] = {**(st or {}), "letterSpacing": 0}
        for v in tree.values():
            if isinstance(v, (dict, list)):
                untrack(v)
    elif isinstance(tree, list):
        for v in tree:
            untrack(v)


# TRANSLATED TYPE MUST FIT ITS COLUMN. A title set in English for a 320px column
# meets German compounds, Malayalam and Tamil words twice as long, and Devanagari
# marks above and below the line. Three things cut it on a phone:
#   1. a line cap ("lines": 3) that was right for English — the rest became "…";
#   2. ONE word wider than the column — the app breaks it mid-word or clips it;
#   3. a line height set for Latin capitals — tall scripts lose their tops.
# fit_type() walks a finished tree with the width each node really has (the phone,
# less every padding, margin, width and maxWidth on the way down) and fixes all
# three after translation, so a builder written in English never needs to know.
# Widths are measured averages of the app's own cuts (Baloo 2) and the system
# fallback, in em per code point, rounded up.
_FIT_SCREEN = 360           # the narrow end of phones in use, in points
_TALL = re.compile('[؀-ۿऀ-෿฀-࿿က-႟ក-៿]')
_WIDE = re.compile('[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]')
_TEXT_NODES = ("text", "heading", "overline", "label", "paragraph", "button")


def _em(ch: str, upper: bool) -> float:
    if ch.isspace():
        return 0.28
    if _WIDE.match(ch):
        return 1.0
    if ch.isdigit():
        return 0.56
    if "a" <= ch.lower() <= "z" or "À" <= ch <= "ɏ":
        return 0.69 if (upper or ch.isupper()) else 0.54
    if _TALL.match(ch) or "Ѐ" <= ch <= "ӿ" or "Ͱ" <= ch <= "Ͽ":
        return 0.58 if not (upper and "Ѐ" <= ch <= "ӿ") else 0.7
    return 0.5


def _span(text: str, size: float, spacing: float, upper: bool) -> float:
    return sum(_em(c, upper) for c in text) * size + spacing * len(text)


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _inner(st: dict, avail: float) -> float:
    w = _num(st.get("width"))
    w = w if w is not None else avail
    mw = _num(st.get("maxWidth"))
    if mw is not None:
        w = min(w, mw)
    def side(k):
        return _num(st.get(k)) or 0
    pad = (side("paddingLeft") or side("paddingHorizontal") or side("padding")) + \
          (side("paddingRight") or side("paddingHorizontal") or side("padding"))
    mar = (side("marginLeft") or side("marginHorizontal")) + (side("marginRight") or side("marginHorizontal"))
    return max(40.0, w - pad - mar)


def _fit_node(n: dict, avail: float) -> None:
    text = n.get("text") if n.get("type") != "button" else (n.get("text") or n.get("label"))
    if not isinstance(text, str) or not text.strip() or _WIDE.search(text):
        return
    st = dict(n.get("style") or {})
    size = _num(st.get("fontSize")) or (13 if n.get("type") == "button" else 15)
    spacing = _num(st.get("letterSpacing")) or 0
    upper = st.get("textTransform") == "uppercase" or n.get("type") == "overline"
    words = text.split()
    longest = max((_span(w, size, spacing, upper) for w in words), default=0)
    if longest > avail:                      # one word wider than the column
        k = max(0.55, avail / longest * 0.96)
        size = round(size * k, 1)
        st["fontSize"] = size
        if _num(st.get("lineHeight")):
            st["lineHeight"] = round(st["lineHeight"] * k, 1)
        if spacing:
            spacing = round(spacing * k, 2)
            st["letterSpacing"] = spacing
    lh = _num(st.get("lineHeight"))
    if _TALL.search(text) and lh and lh < size * 1.5:
        st["lineHeight"] = round(size * 1.5, 1)    # room for marks above and below
    n["style"] = st
    props = n.get("props") if isinstance(n.get("props"), dict) else {}
    cap = props.get("lines")
    if cap is None and n.get("type") in ("overline", "button"):
        cap = 1                                   # the app's default for these
    if isinstance(cap, int) and cap > 0:
        # the lines it needs, greedily wrapped — and one spare, never a "…"
        lines, cur = 1, 0.0
        sp = _span(" ", size, spacing, upper)
        for w in words:
            ww = _span(w, size, spacing, upper)
            if cur and cur + sp + ww > avail * 0.97:
                lines, cur = lines + 1, ww
            else:
                cur = cur + sp + ww if cur else ww
        if lines >= cap:
            n["props"] = {**props, "lines": lines + 1}


def fit_type(tree, width: float = _FIT_SCREEN) -> None:
    """Make every text node of a finished SDUI tree fit its column, in place."""
    if isinstance(tree, list):
        for v in tree:
            fit_type(v, width)
        return
    if not isinstance(tree, dict):
        return
    st = tree.get("style") if isinstance(tree.get("style"), dict) else {}
    inner = _inner(st, width)
    if tree.get("type") in _TEXT_NODES:
        _fit_node(tree, inner)
    horizontal = tree.get("type") == "scroll" and (tree.get("props") or {}).get("horizontal")
    for k, v in tree.items():
        if k in ("style", "props", "action", "data", "bind"):
            continue
        if isinstance(v, (dict, list)):
            fit_type(v, 2000 if horizontal and not _num(st.get("width")) else inner)


# The app's own components cap their titles (numberOfLines 1-3, baked into the
# shipped JS), so a language that runs longer than English ends them in "…" — the
# time wheels' title and line, the deck names, the rails. The cap cannot be lifted
# from here, but every one of those styles is themed (theme.styleOverrides
# .<sheet>.<name>, templates.js), and the catalog is built per language. So the
# catalog measures how much wider THIS language's own strings run than their
# English, and sets those capped styles that much smaller (never under 74%), with
# the line height a tall script needs. English is untouched.
# (sheet, name): (fontSize, lineHeight or None, fixed height in lines or None)
_CAPPED = {
    ("tw", "title"): (25, 31, 3), ("tw", "support"): (14, 21, 4),
    ("t", "tileTitle"): (16, 22, None), ("t", "rowTitle"): (21, None, None),
    ("t", "rowSub"): (13.5, 19, None), ("t", "belowTitle"): (18, None, None),
    ("t", "ftitle"): (20, None, None), ("t", "periodTitle"): (21, None, None),
    ("t", "periodReading"): (14.5, 24, None), ("t", "hdrTitle"): (34, 40, None),
    ("t", "readTitle"): (22, None, None), ("t", "circleTitle"): (14, None, None),
    ("ch", "cardTitle"): (21, None, None), ("dk", "name"): (19, None, None),
    ("dk", "sub"): (12, 17, None), ("hd", "faceTitle"): (17, None, None),
    ("hd", "faceTitleC"): (16, None, None), ("ir", "resTitle"): (25, None, None),
    ("ss", "wheelTitle"): (22, None, None),
}


def text_expansion(pairs) -> float:
    """How much wider a language's strings run than their English, set in the same type."""
    en = tr = 0.0
    for a, b in pairs:
        if isinstance(a, str) and isinstance(b, str) and a.strip() and b.strip() and not _WIDE.search(b):
            en += _span(a, 1, 0, False)
            tr += _span(b, 1, 0, False)
    return (tr / en) if en > 200 else 1.0      # too little to judge → leave it


def fit_theme(payload: dict, pairs) -> None:
    """Size the app's line-capped styles for the catalog's language, in place."""
    theme = payload.get("theme")
    if not isinstance(theme, dict):
        return
    ratio = text_expansion(pairs)
    tall = any(isinstance(b, str) and _TALL.search(b) for _, b in pairs)
    k = max(0.74, min(1.0, 1.0 / ratio)) if ratio > 1.06 else 1.0
    if k == 1.0 and not tall:
        return
    so = {sc: dict(v) for sc, v in (theme.get("styleOverrides") or {}).items() if isinstance(v, dict)}
    for (sheet, name), (fs, lh, rows) in _CAPPED.items():
        cur = dict(so.get(sheet, {}).get(name) or {})
        size = round((_num(cur.get("fontSize")) or fs) * k, 1)
        line = _num(cur.get("lineHeight")) or lh
        line = round(line * k, 1) if line else None
        if tall:
            line = max(line or 0, round(size * 1.5, 1))
        cur["fontSize"] = size
        if line:
            cur["lineHeight"] = line
        if rows and line:
            cur["height"] = round(line * rows)   # the slot keeps its lines, so the button keeps its place
        so.setdefault(sheet, {})[name] = cur
    payload["theme"] = {**theme, "styleOverrides": so}


# Keys and values that are addresses, not words: never replaced by a translation.
_NOT_COPY_KEYS = {"media", "present", "terms", "privacy", "url", "href", "src", "image",
                  "icon", "video", "background", "bg", "color", "colour", "accent", "layout"}
_ADDRESS = re.compile(r"^(?:https?://|mailto:|tel:|#|/)|^[\w.-]+/[\w./-]*$|^[\w-]+\.(?:png|jpe?g|webp|gif|mp4|mov|json)$", re.I)


def _not_copy(key, original) -> bool:
    if key in _NOT_COPY_KEYS:
        return True
    return isinstance(original, str) and not any(c.isspace() for c in original) and bool(_ADDRESS.search(original))


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _strcache_path(lang: str) -> Path:
    return _CACHE_DIR / f"strcache_{lang}_v{_TR_PROMPT_VERSION}.json"


def _load_strcache(lang: str) -> dict:
    if lang in _str_mem:
        return _str_mem[lang]
    d = {}
    try:
        with _strcache_path(lang).open(encoding="utf-8") as f:
            d = json.load(f)
        if not isinstance(d, dict):
            d = {}
    except Exception:
        d = {}
    _str_mem[lang] = d
    return d


def _save_strcache(lang: str, d: dict) -> None:
    if len(d) > _STRCACHE_CAP:                      # FIFO trim — keep the most recent
        d = dict(list(d.items())[-(_STRCACHE_CAP * 3 // 4):])
    _str_mem[lang] = d
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with _strcache_path(lang).open("w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
    except Exception:
        pass


async def localize_labels(labels, lang: str) -> dict:
    """Translate UI labels / titles / button text into `lang`, cached PER STRING.
    Returns {english: translated}; English or any failure falls back per-string to
    the English text, so callers can always do `m.get(x, x)` safely.

    A string translates at most once per language (then it's a permanent cache
    hit), so stable UI copy — titles, buttons — never re-translates just because a
    dynamic string shares the batch, and never leaks English after its first
    successful translation. Pass a list or dict of strings.
    """
    try:
        items = list(labels.values()) if isinstance(labels, dict) else list(labels)
        items = sorted({s for s in items if isinstance(s, str) and s.strip()})
        ident = {s: s for s in items}
        lang = _lang(lang)
        if lang == "en" or not items:
            return ident
        cache = _load_strcache(lang)
        missing = [s for s in items if s not in cache]
        if missing:
            base = (lang or '').split('-')[0]
            heavy = base in _HEAVY_SCRIPT_LANGS
            # Split into SMALL chunks (light per call so heavy scripts don't choke),
            # then run them ALL CONCURRENTLY and wait for every one — so the reply is
            # FULLY translated before it's sent (no English fallback, no "fills in
            # later"). Many light parallel calls = fast AND complete.
            chunk_size = 12 if heavy else 40
            chunk_list = list(_chunks(missing, chunk_size))
            _sem = asyncio.Semaphore(6)   # fast, but don't stampede the translator

            async def _one(ch):
                async with _sem:
                    return await _translate({s: s for s in ch}, lang)

            results = await asyncio.gather(*[_one(ch) for ch in chunk_list], return_exceptions=True)
            changed = False
            for ch, tr in zip(chunk_list, results):
                if not isinstance(tr, dict):
                    continue
                for s in ch:
                    v = tr.get(s)
                    if isinstance(v, str) and v.strip():
                        cache[s] = v
                        changed = True
            if changed:
                _save_strcache(lang, cache)
        # everything translated (and cached for next time); a string only stays
        # English if the translator itself is down for that string this turn.
        return {s: cache.get(s, s) for s in items}
    except Exception:
        try:
            base = list(labels.values()) if isinstance(labels, dict) else list(labels)
            return {s: s for s in base if isinstance(s, str)}
        except Exception:
            return {}


# Section-config text that must be translated, beyond title/subtitle/copy. Only
# these keys are touched — ids, endpoints, media paths, colours, option `value`s,
# `submitAs`, `kind`, etc. are never collected, so nothing structural is altered.
_CFG_TEXT_KEYS = {
    "title", "subtitle", "label", "placeholder", "body", "submit", "cta",
    "hint", "note", "heading", "overline", "empty", "range", "tap",
    "continue", "header", "description", "caption", "message", "intro",
    "cupLabel", "subLabel", "action_label", "prompt",
    # SDUI node display copy (heading/paragraph/text/button/overline all carry it).
    "text",
}
# Dicts whose every string VALUE is display text (keys are field names, not copy):
# e.g. config.titles = {"date": "Their birth date", ...}.
_CFG_TEXT_MAP_KEYS = {"titles"}
# Handled separately by the copy path — don't double-touch.
_CFG_SKIP_KEYS = {"copy"}


def _collect_cfg_text(node, out: set):
    if isinstance(node, dict):
        for k, v in node.items():
            if k in _CFG_SKIP_KEYS:
                continue
            if isinstance(v, str):
                if k in _CFG_TEXT_KEYS and v.strip():
                    out.add(v)
            elif isinstance(v, dict):
                if k in _CFG_TEXT_MAP_KEYS:
                    for vv in v.values():
                        if isinstance(vv, str) and vv.strip():
                            out.add(vv)
                else:
                    _collect_cfg_text(v, out)
            elif isinstance(v, list):
                _collect_cfg_text(v, out)
    elif isinstance(node, list):
        for it in node:
            _collect_cfg_text(it, out)


def _apply_cfg_text(node, tmap: dict):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in _CFG_SKIP_KEYS:
                out[k] = v
            elif isinstance(v, str):
                out[k] = tmap.get(v, v) if k in _CFG_TEXT_KEYS else v
            elif isinstance(v, dict):
                if k in _CFG_TEXT_MAP_KEYS:
                    out[k] = {kk: (tmap.get(vv, vv) if isinstance(vv, str) else vv) for kk, vv in v.items()}
                else:
                    out[k] = _apply_cfg_text(v, tmap)
            elif isinstance(v, list):
                out[k] = _apply_cfg_text(v, tmap)
            else:
                out[k] = v
        return out
    if isinstance(node, list):
        return [_apply_cfg_text(it, tmap) for it in node]
    return node


async def localize(payload: dict, lang: str) -> dict:
    """Return `payload` with labels + section titles/subtitles translated to
    `lang`. English (or any failure) returns the payload unchanged."""
    try:
        lang = _lang(lang)
        if lang == "en":
            return payload
        labels = payload.get("labels") or {}
        sections = payload.get("sections") or []
        titles = {s["id"]: s.get("title") for s in sections if s.get("id") and s.get("title")}
        subs = {s["id"]: s.get("subtitle") for s in sections if s.get("id") and s.get("subtitle")}
        # per-feature UI copy (headings, buttons, hints inside the feature)
        copy = {}
        for s in sections:
            c = s.get("config")
            if s.get("id") and isinstance(c, dict) and isinstance(c.get("copy"), dict) and c["copy"]:
                copy[s["id"]] = {k: v for k, v in c["copy"].items() if isinstance(v, str) and v.strip()}
        # app chrome: settings page (title + item labels) and tab labels
        setn = payload.get("settings") or {}
        set_items = {it["id"]: it.get("label") for it in (setn.get("items") or [])
                     if isinstance(it, dict) and it.get("id") and isinstance(it.get("label"), str) and it["label"].strip()}
        # The trailing VALUE on a row ("Upgrade", a plan name) is copy the reader
        # sees, and it was the one string in the settings card that never got
        # translated — only `label` was ever collected, so every language showed
        # Plutto Star with an English "Upgrade" beside it. Keyed by id in its own
        # map so it cannot collide with the label of the same row.
        set_values = {it["id"]: it["value"] for it in (setn.get("items") or [])
                      if isinstance(it, dict) and it.get("id") and isinstance(it.get("value"), str) and it["value"].strip()}
        chrome = {"settings_title": setn.get("title") if isinstance(setn.get("title"), str) else None,
                  "settings_items": set_items,
                  "settings_values": set_values}
        tabn = payload.get("tabs") or {}
        tab_items = {it["key"]: it.get("label") for it in (tabn.get("items") or [])
                     if isinstance(it, dict) and it.get("key") and isinstance(it.get("label"), str) and it["label"].strip()}
        chrome["tabs"] = tab_items
        # paywall copy (subscription.paywall) — translate string + string-list values
        paywall = ((payload.get("subscription") or {}).get("paywall")) or {}
        pw = {}
        for _k, _v in paywall.items():
            if isinstance(_v, str) and _v.strip():
                pw[_k] = _v
            elif isinstance(_v, list) and _v and all(isinstance(x, str) for x in _v):
                pw[_k] = _v
        # deep config text (placeholders, field labels, compat titles, revelation,
        # chooser card titles, wheel cup/sub labels, submit, …) — value-keyed so
        # identical strings share one translation regardless of where they appear.
        cfg_strings = set()
        # paywall PLAN labels bypass the string/string-list paths above: the duration/
        # period maps (packageType → label) and the plansFallback rows (list of {title,
        # period} dicts). Value-key their strings so the plan titles + per-period labels
        # follow the language too (Weekly/Quarterly/Annual, week/month/year …).
        for _mapk in ("durations", "periods"):
            _m = paywall.get(_mapk)
            if isinstance(_m, dict):
                for _val in _m.values():
                    if isinstance(_val, str) and _val.strip():
                        cfg_strings.add(_val)
        for _pf in (paywall.get("plansFallback") or []):
            if isinstance(_pf, dict):
                for _pk in ("title", "period"):
                    if isinstance(_pf.get(_pk), str) and _pf[_pk].strip():
                        cfg_strings.add(_pf[_pk])
        for s in sections:
            c = s.get("config")
            if isinstance(c, dict):
                _collect_cfg_text(c, cfg_strings)
            # section-level kicker above the title (top-deck overline, etc.)
            ov = s.get("overline")
            if isinstance(ov, str) and ov.strip():
                cfg_strings.add(ov)
        # home-block group titles (the headings above the circular home groups,
        # e.g. "Graha Sthiti" / "Karma & Phala") — value-keyed via cfgtext.
        for b in (payload.get("home") or []):
            if isinstance(b, dict) and isinstance(b.get("title"), str) and b["title"].strip():
                cfg_strings.add(b["title"])
        # Inline SDUI composition trees: home/explore blocks that carry their own
        # `options.tree` (e.g. the Explore CTA card) render backend-authored text
        # (heading / paragraph / text / button) that bypasses every other path
        # above — collect it here so it translates like all other chrome.
        for _ck in ("home", "explore"):
            for b in (payload.get(_ck) or []):
                if isinstance(b, dict) and isinstance(b.get("options"), dict):
                    _collect_cfg_text(b["options"].get("tree"), cfg_strings)
        # system / model names (the chat model selector + system switcher),
        # e.g. "Jyotish" / "Hermetica" / "BaZi" — value-keyed via cfgtext. The chat
        # model pill shows the NESTED chat_engines[].name (e.g. "Plutt0.8"), so collect
        # those too — otherwise the selector stays English while everything else is
        # translated.
        for sy in (payload.get("systems") or []):
            if not isinstance(sy, dict):
                continue
            if isinstance(sy.get("name"), str) and sy["name"].strip():
                cfg_strings.add(sy["name"])
            for _e in (sy.get("chat_engines") or []):
                if isinstance(_e, dict) and isinstance(_e.get("name"), str) and _e["name"].strip():
                    cfg_strings.add(_e["name"])
        # home-section group headings (Daily / Charts / Stories / Numerology / …),
        # shown above each grouped block — value-keyed via cfgtext.
        for g in (payload.get("groups") or []):
            if isinstance(g, dict) and isinstance(g.get("label"), str) and g["label"].strip():
                cfg_strings.add(g["label"])
        # The settings row VALUES go down a SECOND road as well as their own map
        # above. Not belt-and-braces for its own sake: `settings_values` is a new
        # key in a nested object and the model has to choose to keep it, whereas
        # cfgtext is a flat value-keyed map that has carried system names and
        # group headings in production for months. A dropped key here is silent —
        # the labels around it translate perfectly and one word stays English,
        # which reads as a bug in the word rather than in the transport.
        for _it in (setn.get("items") or []):
            if isinstance(_it, dict) and isinstance(_it.get("value"), str) and _it["value"].strip():
                cfg_strings.add(_it["value"])
        bundle = {"labels": labels, "titles": titles, "subtitles": subs, "copy": copy, "chrome": chrome, "paywall": pw,
                  "cfgtext": {x: x for x in sorted(cfg_strings)}}
        h = _hash(bundle)
        tr = _load(lang, h)
        if tr is None:
            tr = await _translate(bundle, lang)
            # SAY WHEN THE MODEL DROPS A KEY. It is asked to preserve the shape and
            # usually does, but when it quietly omits one the result is a handful of
            # strings that stay English while everything around them translates —
            # which looks like a bug in those strings and sends you hunting through
            # the wrong code. Nothing recorded that, so the only way to find it was
            # to notice the English by eye and guess. One line, at the moment it
            # happens, naming the key.
            if isinstance(tr, dict):
                _missing = [k for k in bundle if k not in tr]
                _missing += [f"chrome.{k}" for k in (bundle.get("chrome") or {})
                             if k not in ((tr.get("chrome") or {}) if isinstance(tr.get("chrome"), dict) else {})]
                if _missing:
                    _log.warning("catalog_i18n[%s]: translator dropped %s — those strings stay English", lang, ", ".join(_missing))
            if tr is None:
                return payload
            _save(lang, h, tr)
        t_labels = tr.get("labels") or {}
        t_titles = tr.get("titles") or {}
        t_subs = tr.get("subtitles") or {}
        t_copy = tr.get("copy") or {}
        t_chrome = tr.get("chrome") or {}
        t_pw = tr.get("paywall") or {}
        t_cfg = tr.get("cfgtext") or {}
        cfgmap = {x: (t_cfg.get(x) or x) for x in cfg_strings}
        out = dict(payload)
        out["labels"] = {**labels, **{k: v for k, v in t_labels.items() if v}}
        # apply chrome (settings + tabs) translations
        t_set_title = t_chrome.get("settings_title")
        t_set_items = t_chrome.get("settings_items") or {}
        t_set_values = t_chrome.get("settings_values") or {}

        def _localized_item(it):
            """Label and value both, or the row untouched. A row may have one
            translated and not the other, so neither is assumed from the other."""
            if not isinstance(it, dict) or not it.get("id"):
                return it
            lab = t_set_items.get(it["id"])
            # Its own map first, then the flat one, then English. Any of the three
            # is a correct answer; the point is that no single one has to hold.
            val = t_set_values.get(it["id"])
            if not val and isinstance(it.get("value"), str):
                val = cfgmap.get(it["value"])
            if not lab and not val:
                return it
            out_it = dict(it)
            if lab:
                out_it["label"] = lab
            if val:
                out_it["value"] = val
            return out_it

        if isinstance(setn, dict) and (t_set_title or t_set_items or t_set_values or cfgmap):
            s_out = dict(setn)
            if t_set_title:
                s_out["title"] = t_set_title
            if setn.get("items"):
                s_out["items"] = [_localized_item(it) for it in setn["items"]]
            out["settings"] = s_out
        t_tabs = t_chrome.get("tabs") or {}
        if isinstance(tabn, dict) and tabn.get("items") and t_tabs:
            tb_out = dict(tabn)
            tb_out["items"] = [
                ({**it, "label": t_tabs[it["key"]]}
                 if isinstance(it, dict) and it.get("key") in t_tabs and t_tabs[it["key"]] else it)
                for it in tabn["items"]
            ]
            out["tabs"] = tb_out
        new_sections = []
        for s in sections:
            s2 = dict(s)
            sid = s.get("id")
            if sid in t_titles and t_titles[sid]:
                s2["title"] = t_titles[sid]
            if sid in t_subs and t_subs[sid]:
                s2["subtitle"] = t_subs[sid]
            if sid in t_copy and isinstance(s2.get("config"), dict) and isinstance(s2["config"].get("copy"), dict):
                cfg = dict(s2["config"])
                cfg["copy"] = {**cfg["copy"], **{k: v for k, v in (t_copy[sid] or {}).items() if v}}
                s2["config"] = cfg
            # section-level overline (kicker above the title)
            if cfgmap and isinstance(s2.get("overline"), str) and s2["overline"] in cfgmap:
                s2["overline"] = cfgmap[s2["overline"]]
            # deep-translate the rest of the config text (placeholders, field labels,
            # compat titles, revelation, chooser cards, wheel cup/sub labels, submit…)
            if cfgmap and isinstance(s2.get("config"), dict):
                s2["config"] = _apply_cfg_text(s2["config"], cfgmap)
            new_sections.append(s2)
        out["sections"] = new_sections
        # translate the home-block group titles in place
        if cfgmap and isinstance(out.get("home"), list):
            out["home"] = [
                ({**b, "title": cfgmap[b["title"]]}
                 if isinstance(b, dict) and isinstance(b.get("title"), str) and b["title"] in cfgmap else b)
                for b in out["home"]
            ]
        # translate inline SDUI composition trees (home/explore blocks' options.tree)
        for _ck in ("home", "explore"):
            if cfgmap and isinstance(out.get(_ck), list):
                _blocks = []
                for b in out[_ck]:
                    if (isinstance(b, dict) and isinstance(b.get("options"), dict)
                            and b["options"].get("tree") is not None):
                        _opts = dict(b["options"])
                        _opts["tree"] = _apply_cfg_text(_opts["tree"], cfgmap)
                        b = {**b, "options": _opts}
                    _blocks.append(b)
                out[_ck] = _blocks
        # translate the system / model names in place — the top-level system name AND
        # each nested chat_engines[].name (the chat model-selector pill).
        if cfgmap and isinstance(out.get("systems"), list):
            _sys_out = []
            for sy in out["systems"]:
                if not isinstance(sy, dict):
                    _sys_out.append(sy)
                    continue
                sy2 = dict(sy)
                if isinstance(sy2.get("name"), str) and sy2["name"] in cfgmap:
                    sy2["name"] = cfgmap[sy2["name"]]
                if isinstance(sy2.get("chat_engines"), list):
                    sy2["chat_engines"] = [
                        ({**e, "name": cfgmap[e["name"]]}
                         if isinstance(e, dict) and isinstance(e.get("name"), str) and e["name"] in cfgmap else e)
                        for e in sy2["chat_engines"]
                    ]
                _sys_out.append(sy2)
            out["systems"] = _sys_out
        # translate the home-section group headings in place
        if cfgmap and isinstance(out.get("groups"), list):
            out["groups"] = [
                ({**g, "label": cfgmap[g["label"]]}
                 if isinstance(g, dict) and isinstance(g.get("label"), str) and g["label"] in cfgmap else g)
                for g in out["groups"]
            ]
        if (t_pw or cfgmap) and isinstance(out.get("subscription"), dict):
            _sub = dict(out["subscription"])
            _bpw = dict(_sub.get("paywall") or {})
            for _k, _v in (t_pw or {}).items():
                # Only COPY is replaced. The paywall's string values travel to the
                # translator together, and `media: "paywall/hero"` is a string too:
                # a translated path names no file, so in every language but English
                # the paywall lost its picture (and the Terms/Privacy links their
                # target). A path, a url, a colour keeps its original value.
                if _v and not _not_copy(_k, _bpw.get(_k)):
                    _bpw[_k] = _v
            # plan labels: translate the duration/period maps + plansFallback rows.
            if cfgmap:
                for _mapk in ("durations", "periods"):
                    _m = _bpw.get(_mapk)
                    if isinstance(_m, dict):
                        _bpw[_mapk] = {kk: (cfgmap.get(vv, vv) if isinstance(vv, str) else vv)
                                       for kk, vv in _m.items()}
                _pf_list = _bpw.get("plansFallback")
                if isinstance(_pf_list, list):
                    _bpw["plansFallback"] = [
                        ({**pf, **{pk: cfgmap[pf[pk]] for pk in ("title", "period")
                                   if isinstance(pf.get(pk), str) and pf[pk] in cfgmap}}
                         if isinstance(pf, dict) else pf)
                        for pf in _pf_list
                    ]
            _sub["paywall"] = _bpw
            out["subscription"] = _sub
        try:
            pairs = [(titles[k], t_titles[k]) for k in titles if isinstance(t_titles.get(k), str)]
            pairs += [(subs[k], t_subs[k]) for k in subs if isinstance(t_subs.get(k), str)]
            pairs += [(labels[k], t_labels[k]) for k in labels
                      if isinstance(labels.get(k), str) and isinstance(t_labels.get(k), str)]
            fit_theme(out, pairs)
        except Exception:
            pass
        return out
    except Exception:
        return payload
