"""
SHARED FEATURE HELPERS — used by every feature in this directory.

Goals:
- one place for LLM call shape
- one place for birth-data extraction
- one place for engine caching
- features stay slim (data + prompt + response only)
"""

import asyncio
import os
import re
import time
from datetime import datetime
from threading import Lock
from typing import Optional

import httpx
from fastapi import HTTPException


# ── THE APP'S FACES, NAMED ONCE ──────────────────────────────────────────────
# These are the family names the catalog registers in theme.fonts (each pointing
# at a file in static/fonts). They live here rather than in the catalog builder
# because features need them too: a reel page can ask for a face directly, and a
# feature spelling the name itself would be a fourth copy to keep in step.
FONT_REGULAR = "Plutto"        # Baloo2-Regular  — titles, cards, everything quiet
FONT_MEDIUM = "PluttoMedium"   # Baloo2-Medium   — reading text
FONT_BOLD = "PluttoBold"       # Baloo2-ExtraBold — reel titles and headings


def heavy_titles(pages):
    """Stamp the heavy face onto every reel page's title, in place, and return them.

    For the STACK layout only. The editorial and chapter layouts take their title
    face from theme.reelFonts, which the app already reads — but the stack layout
    asks for theme.serif directly and there is no theme key that reaches it. Its
    one remaining door is the per-page `titleStyle`, which the renderer applies
    AFTER the built-in family, so it wins.

    That door is open on every phone already: this is why none of the typography
    needed a release. A page that sets its own titleStyle is left alone.
    """
    for p in (pages or []):
        if isinstance(p, dict) and p.get("title") and not p.get("titleStyle"):
            p["titleStyle"] = {"font": FONT_BOLD}
    return pages

# ── LLM call throttle + transient-error retry ────────────────────────────────
# A cold home load fires many feature requests at once, each generating via the
# LLM. Left unbounded, the burst stampedes the provider → 429s / long queues →
# blank or late cards. A global semaphore caps how many OpenRouter calls are in
# flight per worker, so excess calls wait a beat instead of failing; transient
# upstream errors (429 / 5xx) are retried with backoff instead of surfacing empty.
_LLM_MAX_CONCURRENCY = int(os.getenv("LLM_MAX_CONCURRENCY", "8"))
_LLM_SEMAPHORE = asyncio.Semaphore(_LLM_MAX_CONCURRENCY)
_LLM_TRANSIENT = {408, 409, 425, 429, 500, 502, 503, 504, 529}

# ── GLOBAL SPEND KILL-SWITCH ─────────────────────────────────────────────────
# Last-resort emergency brake: if total LLM OUTPUT tokens in the current hour/day
# blow past a ceiling, stop making live calls (503) until the window rolls over.
# This caps the absolute worst case of a credit-burn attack even if per-IP limits
# are somehow bypassed. DISABLED by default (0); set FAR above normal peak so it
# only ever trips under attack. Tune via env:
#   LLM_HOURLY_TOKEN_BUDGET / LLM_DAILY_TOKEN_BUDGET  (0 = off)
# Read from Settings, which is what .env feeds (os.getenv never saw a .env line).
from app.core.config import settings as _settings
_LLM_HOURLY_BUDGET = int(getattr(_settings, "LLM_HOURLY_TOKEN_BUDGET", 0) or 0)
_LLM_DAILY_BUDGET = int(getattr(_settings, "LLM_DAILY_TOKEN_BUDGET", 0) or 0)
_budget_lock = Lock()
_budget = {"hour_key": -1, "hour_tokens": 0, "day_key": -1, "day_tokens": 0}


def _budget_roll(now: float):
    hk, dk = int(now // 3600), int(now // 86400)
    if _budget["hour_key"] != hk:
        _budget["hour_key"] = hk
        _budget["hour_tokens"] = 0
    if _budget["day_key"] != dk:
        _budget["day_key"] = dk
        _budget["day_tokens"] = 0


def _budget_ok() -> bool:
    """True if we're within the global token budget (or it's disabled)."""
    if not _LLM_HOURLY_BUDGET and not _LLM_DAILY_BUDGET:
        return True
    with _budget_lock:
        _budget_roll(time.time())
        if _LLM_HOURLY_BUDGET and _budget["hour_tokens"] >= _LLM_HOURLY_BUDGET:
            return False
        if _LLM_DAILY_BUDGET and _budget["day_tokens"] >= _LLM_DAILY_BUDGET:
            return False
    return True


def _budget_add(tokens: int):
    if not tokens or (not _LLM_HOURLY_BUDGET and not _LLM_DAILY_BUDGET):
        return
    with _budget_lock:
        _budget_roll(time.time())
        _budget["hour_tokens"] += tokens
        _budget["day_tokens"] += tokens


async def _post_llm(client, headers, payload, tries: int = 3):
    """POST to OpenRouter under the global concurrency cap, retrying transient
    upstream errors (429 / 5xx) with exponential backoff. Returns the httpx
    response (200 or the last non-200); network errors are retried too."""
    delay = 1.0
    last = None
    for attempt in range(tries):
        try:
            async with _LLM_SEMAPHORE:
                resp = await client.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    headers=headers, json=payload, timeout=120.0)
            if resp.status_code == 200 or resp.status_code not in _LLM_TRANSIENT:
                return resp
            last = resp
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last = e
        if attempt < tries - 1:
            await asyncio.sleep(delay)
            delay *= 2
    if isinstance(last, Exception):
        raise last
    return last


def safe(fn, default=None):
    try:
        result = fn()
        return result if result is not None else default
    except Exception:
        return default


_WARNED_DEFAULT_PLACE = False


def extract_birth(kundli_data) -> Optional[dict]:
    if not isinstance(kundli_data, dict) or not kundli_data:
        return None
    raw = kundli_data.get('raw', {}) if isinstance(kundli_data.get('raw'), dict) else {}
    birth = raw.get('birth_details', {}) or kundli_data.get('birth_details', {})
    # Accept a FLAT birth dict too — the `request_body.birth_data` fallback callers use is an
    # un-normalized client dict (often with latitude/longitude, or already lat/lng). Without
    # this, endpoints that do `extract_birth(kundli_data) or request_body.birth_data` and then
    # index birth['lat'] crash with KeyError/500 on any direct birth_data payload.
    if not birth and (kundli_data.get('year') or kundli_data.get('latitude') or kundli_data.get('lat')):
        birth = kundli_data
    if not birth:
        return None
    if not any(k in birth for k in ('latitude', 'lat')) or not any(k in birth for k in ('longitude', 'lng')):
        global _WARNED_DEFAULT_PLACE
        if not _WARNED_DEFAULT_PLACE:
            _WARNED_DEFAULT_PLACE = True
            print("[birth] a request had no birth coordinates; using New Delhi (28.6, 77.2) as before "
                  "— every house, ascendant and timing in that reading rests on that guess")
    try:
        out = {
            'year': int(birth.get('year', 2000)),
            'month': int(birth.get('month', 1)),
            'day': int(birth.get('day', 1)),
            'hour': int(birth.get('hour', 12)),
            'minute': int(birth.get('minute', 0)),
            'lat': float(birth.get('latitude', birth.get('lat', 28.6))),
            'lng': float(birth.get('longitude', birth.get('lng', 77.2))),
        }
    except (TypeError, ValueError):
        return None

    # WHO THEY ARE, not only when and where. This returned the seven numbers above
    # and nothing else, so every system that reads a name or a gender ran on an
    # empty name and a man: a woman asking which way her desk should face got the
    # male Ba Zhai gua (6, West group, best direction W) instead of her own (9,
    # East group, best direction E), and her Saju luck decades, Tibetan parkha and
    # Kabbalah path came out wrong the same way. The app sends both fields in
    # kundli_data.raw.birth_details; they were dropped here, at the door.
    #
    # Additive on purpose: the engine cache key and the memory hash read only the
    # seven numbers, so neither changes. timezone_offset is deliberately NOT
    # carried — the Vedic engine auto-detects the zone, and only the Western
    # witnesses would honour an explicit one, which would put two different
    # charts for the same person into one briefing.
    name = str(birth.get('name') or kundli_data.get('name') or '').strip()
    if name:
        out['name'] = name[:80]
    gender = norm_gender(birth.get('gender') or kundli_data.get('gender'))
    if gender:
        out['gender'] = gender
    place = str(birth.get('place') or kundli_data.get('place') or '').strip()
    if place:
        out['place'] = place[:120]
    return out


def norm_gender(value) -> str:
    """'male' / 'female' as the app normalises them at chart creation
    (api/public.py), or '' when the value names neither. The traditions that read
    gender are binary by construction (BaZi luck direction, the Ba Zhai gua, the
    Tibetan parkha); for anything else they keep their own default."""
    g = str(value or '').strip().lower()
    if g in ('female', 'f', 'woman', 'girl', 'w') or g.startswith('fem'):
        return 'female'
    if g in ('male', 'm', 'man', 'boy') or g.startswith('mal'):
        return 'male'
    return ''


def extract_profile(kundli_data) -> dict:
    """The onboarding profile, carried in kundli_data.raw.birth_details
    (name, gender, place, ...). Any feature can personalize with no input field."""
    if not kundli_data:
        return {}
    raw = kundli_data.get('raw', {}) or {}
    bd = raw.get('birth_details', {}) or kundli_data.get('birth_details', {}) or {}
    if not isinstance(bd, dict):
        bd = {}
    return {
        'name': (bd.get('name') or kundli_data.get('name') or '').strip(),
        'gender': (bd.get('gender') or kundli_data.get('gender') or '').strip().lower(),
        'place': (bd.get('place') or '').strip(),
    }


def extract_name(kundli_data) -> str:
    """Convenience: just the onboarding name."""
    return extract_profile(kundli_data).get('name', '')


# ── Localized dates ───────────────────────────────────────────────────────────
# strftime('%b') always emits English month abbreviations (Jan, Feb…), which then
# sit untranslated inside otherwise-localized card markers ("until Jan 15, 2027").
# These helpers translate the month abbreviations via the cached label translator
# and string-replace them in already-built date strings — so the sync date-builders
# don't have to become async.
_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
_MONTH_RE = re.compile(r'\b(' + '|'.join(_MONTHS_EN) + r')\b')


async def month_name_map(language: Optional[str] = 'en') -> dict:
    """{'Jan': '<localized>', …} for the language ({} for English / on failure)."""
    if (language or 'en') == 'en':
        return {}
    try:
        from app.services.features.catalog_i18n import localize_labels
        tr = await localize_labels(_MONTHS_EN, language)
        return {m: tr.get(m, m) for m in _MONTHS_EN if tr.get(m, m) != m}
    except Exception:
        return {}


def localize_months(text: str, tr: dict) -> str:
    """Replace English month abbreviations in `text` with `tr`'s localized ones."""
    if not text or not tr:
        return text
    return _MONTH_RE.sub(lambda m: tr.get(m.group(0), m.group(0)), text)


def teaser(text: str, words: int = 14) -> str:
    """A short curiosity hook from a reading — the first sentence, capped to N words."""
    if not text:
        return ''
    first = re.split(r'(?<=[.!?])\s', text.strip(), maxsplit=1)[0]
    parts = first.split()
    if len(parts) > words:
        return ' '.join(parts[:words]).rstrip('.,;:') + '…'
    return first


def clean_reading(s) -> str:
    """Never ship raw LLM JSON to the app. Strip any ```json code fence, and if what
    remains is still a JSON blob (an unparsed reply), drop it to empty rather than
    letting it render. Plain prose passes through untouched."""
    s = str(s or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"```\s*$", "", s).strip()
    if s[:1] in "{[" or re.match(r'^"?\w+"?\s*:\s*', s):
        return ""
    return s


def concept_split(cards: list):
    """Split a feature's [intro, ...item] cards into the {info, items} shape the
    home 'concept' block consumes: the intro becomes the on-tap info card, the rest
    become the horizontal active-item rail (each with a curiosity teaser). Every
    reading is sanitised so a feature can never emit raw JSON."""
    cards = cards or []
    info = {'title': cards[0].get('title', ''), 'body': clean_reading(cards[0].get('reading', ''))} if cards else {}
    items = []
    for c in cards[1:]:
        secs = c.get('sections') if isinstance(c.get('sections'), list) else None
        if secs:
            secs = [{**s, 'body': clean_reading(s.get('body', ''))} if isinstance(s, dict) else s for s in secs]
        reading = clean_reading(c.get('reading', ''))
        items.append({
            'id': c.get('id', ''),
            'title': c.get('title', ''),
            'marker': '',                      # minimal rail cards: title + context + Explore only
            'curiosity': teaser(reading),
            'reading': reading,
            'sections': secs,                  # rich, section-wise reading (→ reel pages)
            'image': '',                       # rails are a clean type strip — no per-card art
        })
    return info, items


def get_engine(birth_data):
    from app.services.oracle.engine_cache import get_cached_engine
    # Normalize whatever the caller passed (a raw client `birth_data` may use
    # latitude/longitude or omit fields) so this choke point can't KeyError/500 —
    # covers every feature that does `extract_birth(...) or <raw>.birth_data`.
    nb = extract_birth(birth_data) if isinstance(birth_data, dict) else None
    if nb:
        birth_data = nb
    birth_dt = datetime(
        int(birth_data.get('year', 2000)), int(birth_data.get('month', 1)), int(birth_data.get('day', 1)),
        int(birth_data.get('hour', 12)), int(birth_data.get('minute', 0)),
    )
    lat = birth_data.get('lat', birth_data.get('latitude', 28.6))
    lng = birth_data.get('lng', birth_data.get('longitude', 77.2))
    engine, _ = get_cached_engine(birth_dt, float(lat), float(lng))
    return engine


# Languages whose scripts tokenize FAR heavier than English (Indic, Perso-Arabic,
# SE-Asian, etc.) — a token budget sized for English truncates their replies, which
# drops later deck/wheel items ("feature shows no readings" in those languages).
_WIDE_SCRIPT_LANGS = {
    'hi', 'mr', 'ne', 'sa', 'bn', 'as', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml',
    'si', 'ur', 'fa', 'ar', 'am', 'my', 'km', 'lo', 'th', 'ka', 'bo', 'dz', 'ks', 'sd',
}


async def prepend_memory(prompt: str, request, birth_data: dict, system: str = 'bphs',
                         topic: str = '') -> str:
    """Prepend the shared oracle memory (the person's durable portrait, built by the
    chat oracle) to a FEATURE prompt, so readings speak as someone who already knows
    them. Fully soft: no auth / no DB / no memory yet → the prompt is returned
    unchanged. Never raises, never blocks a reading.

    `topic` is OPT-IN. When a feature names its life-area, the newer systems that
    genuinely speak to that area are folded in too (see features/wider_lines.py), along
    with the rule about which of them may be counted as agreeing. Features that pass no
    topic are untouched — a business-name or mobile-number reading has no use for a
    windhorse line, and padding it would be noise."""
    try:
        from app.core.auth import get_user_optional
        from app.services.oracle.portraits import feature_memory_block
        _u = get_user_optional(request.headers.get('authorization')) if request is not None else None
        mem = await feature_memory_block(birth_data, system=system, user_id=(_u["id"] if _u else None))
        if mem:
            prompt = mem + "\n\n" + prompt
    except Exception:
        pass

    if topic and birth_data:
        try:
            from app.services.features.wider_lines import wider_lines, INDEPENDENCE_NOTE
            wide = wider_lines(birth_data, topic)
            if wide:
                prompt = (prompt + "\n\nALSO TRUE OF THEM (translate into lived experience; "
                          "never name a system): " + wide + "\n\n" + INDEPENDENCE_NOTE)
        except Exception:
            pass
    return prompt


async def call_llm(prompt: str, settings, user_message: str = 'Read this for me.',
                   max_tokens: int = 1500, temperature: float = 0.85, fast: bool = False) -> str:
    """Call the LLM and ALWAYS return a complete, non-empty reply when one is possible,
    so a reading never lands blank because of the token limit. Three guarantees:
      1. Language-aware budget — the per-request cap is widened for heavy scripts
         (detected from voice_card's 'ISO code "xx"' marker) so one request suffices.
      2. Auto-continue — if the model stops only because it hit the cap
         (finish_reason == 'length'), we resume from where it stopped and stitch the
         parts together; the total budget grows with the content.
      3. Empty-retry — if a pass yields nothing at all, we retry once from scratch.
    """
    # language-aware per-request budget (a heavier floor for verbose scripts)
    try:
        m = re.search(r'ISO code "([A-Za-z-]+)"', prompt)
        lc = m.group(1).lower().split('-')[0] if m else 'en'
        if lc in _WIDE_SCRIPT_LANGS:
            max_tokens = min(8000, int(max_tokens * 2.3))
        elif lc != 'en':
            max_tokens = min(8000, int(max_tokens * 1.5))   # non-English Latin scripts run longer too
    except Exception:
        pass

    # Model routing: cheap, high-volume, home-blocking generations (time-wheel teasers,
    # curiosity cards, markers) run on the FAST model when one is configured
    # (OPENROUTER_MODEL_FAST); deep readings stay on the quality responder. This keeps
    # a heavy responder (e.g. Sonnet) from making the whole home crawl.
    model = (getattr(settings, 'OPENROUTER_MODEL_FAST', '') or settings.OPENROUTER_MODEL) if fast else settings.OPENROUTER_MODEL

    base = [
        {'role': 'system', 'content': prompt},
        {'role': 'user', 'content': user_message},
    ]

    # Fast, high-volume home content (teasers / cards / markers) is short by design —
    # it never needs the 6× auto-continue loop, and a second empty-retry pass just
    # doubles the load on a cold home. Bound the fast lane to a single pass so a burst
    # of home cards is one call each, not up to twelve.
    _max_passes = 1 if fast else 6

    async def _generate() -> str:
        parts: list = []
        # Global spend kill-switch: refuse new generations once the hourly/daily
        # token ceiling is blown (emergency brake against a credit-burn attack).
        if not _budget_ok():
            raise HTTPException(status_code=503, detail='Service temporarily busy')
        # initial request + up to 5 continuations (≈6x budget) — bounded so a
        # pathological loop can't run away.
        async with httpx.AsyncClient() as client:
            for _ in range(_max_passes):
                messages = base if not parts else base + [
                    {'role': 'assistant', 'content': ''.join(parts)},
                    {'role': 'user', 'content': 'Continue exactly from where you stopped. '
                                                'Do not repeat anything already written; just resume.'},
                ]
                response = await _post_llm(
                    client,
                    headers={'Authorization': f'Bearer {settings.OPENROUTER_API_KEY}',
                             'Content-Type': 'application/json'},
                    payload={'model': model, 'messages': messages,
                             'max_tokens': max_tokens, 'temperature': temperature,
                             # Route to the fastest provider for this model (OpenRouter),
                             # so Sonnet lands on its highest-throughput host.
                             'provider': {'sort': 'throughput'}},
                )
                if response.status_code != 200:
                    # Surface WHY (401 bad key · 402 no credits · 429 rate limit ·
                    # 404 bad model) instead of a blind 502 — the diagnosis lives here.
                    try:
                        import logging
                        logging.getLogger('plutto.llm').error(
                            'OpenRouter %s (model=%s): %s',
                            response.status_code, model, response.text[:400])
                    except Exception:
                        pass
                    if parts:
                        break   # upstream hiccup mid-continuation → keep what we have
                    raise HTTPException(status_code=502, detail='Upstream LLM error')
                _rj = response.json()
                # Meter real output tokens toward the global budget (falls back to
                # completion_tokens or total_tokens; harmless no-op if budget is off).
                _usage = _rj.get('usage') or {}
                _budget_add(_usage.get('completion_tokens') or _usage.get('total_tokens') or 0)
                choice = (_rj.get('choices') or [{}])[0]
                chunk = (choice.get('message') or {}).get('content') or ''
                if not chunk.strip() and parts:
                    break       # a continuation returned nothing → stop (don't spin)
                parts.append(chunk)
                if choice.get('finish_reason') != 'length':
                    break       # the model finished on its own → reply is complete
        return ''.join(parts).strip().replace('```', '').strip()

    text = await _generate()
    if not text and not fast:    # a totally empty reply → one fresh retry (deep reads only)
        try:
            retry = await _generate()
            if retry:
                text = retry
        except HTTPException:
            pass
    return text


def deck_response(cards, intro=None, version: int = 1, cache_ttl_seconds: int = 86400) -> dict:
    """Standard card-deck contract for the app's deck templates (vdeck / hdeck)."""
    out = {'cards': list(cards), 'version': version, 'cache_ttl_seconds': cache_ttl_seconds}
    if intro is not None:
        out['intro'] = intro
    return out


def strip_part_label(text: str) -> str:
    """Remove a leading 'Part 1' / 'PART 2:' / 'Section 1 —' label an LLM sometimes
    echoes back from a prompt that named the pieces 'PART 1 / PART 2'."""
    return re.sub(r'^\s*(?:part|section)\s*\d+\s*[:.\-–—)]*\s*', '', text or '', flags=re.I).strip()


def split_segments(raw: str, separator: str = '---', expected: int = None) -> list:
    """Split LLM output into segments, falling back to paragraph breaks.

    When the caller knows how many items it asked for (`expected`), we parse more
    robustly: LLMs don't always honor the `---` separator — they may number the
    items (1. / 1) / 1-) or separate with blank lines. Relying on `---` alone meant
    any deviation collapsed everything into ONE segment, so every item past the
    first fell back to its (often blank) default — that's why "many planets show no
    reading". With `expected`, we try each strategy and pick the parse whose count
    matches (or comes closest, preferring not to under-count and drop readings).
    The no-`expected` path is unchanged.
    """
    raw = raw or ''
    primary = [s.strip() for s in raw.split(separator) if s.strip()]

    if expected and expected > 1:
        if len(primary) == expected:
            return primary
        numbered = [s.strip() for s in re.split(r'(?m)^\s*(?:\d{1,2}[.)\-:]|[•*])\s+', raw) if s.strip()]
        paras = [s.strip() for s in raw.split('\n\n') if s.strip()]
        cands = [c for c in (primary, numbered, paras) if c]
        exact = next((c for c in cands if len(c) == expected), None)
        if exact:
            return exact
        best = min(cands, key=lambda c: (abs(len(c) - expected), len(c) < expected), default=[])
        return best or ([raw.strip()] if raw.strip() else [])

    # Back-compat (unchanged): the requested separator, else blank-line paragraphs.
    if len(primary) < 2:
        primary = [s.strip() for s in raw.split('\n\n') if s.strip()]
    return primary


# ── Period reading: the shared "explore the day/week/month/year" structure ──
# A single curiosity hook + four beats (pattern → hidden tension → astrological
# support → a truth that lingers), rendered as a fullscreen collage page. Append
# PERIOD_STRUCTURE to any period prompt; pass the LLM's split parts to
# build_period_collage. Used by Vedic / Western / Chinese period endpoints so the
# whole top deck behaves the same across systems.
# THE SHAPE OF A READING THAT IS SWIPED THROUGH, as opposed to one that is read
# down a page. Each beat is a whole screen the reader chooses to leave, and the
# choice is made again at every one of them — so the sequence, not just the
# sentences, is what keeps somebody there.
#
# Use this for reels. PERIOD_STRUCTURE below is a different thing: a fixed
# seven-part plan about a PERIOD ("the weather now"), which is the wrong content
# for a reading that is not about a span of time.
REEL_ARC = (
    "\n\nSeparate the beats with exactly --- and nothing else between them.\n"
    "The FIRST beat has no title. EVERY beat after it opens with a SHORT title "
    "(2-4 words), then ' :: ', then the body:\n"
    "  Title :: body text here\n"
    "Give each one a fresh, characterful name of its own. It is the only word on that "
    "screen besides the reading itself, and a generic or repeated label is the reader "
    "being told that nothing new is coming.\n"
    "\n"
    "HOW THE SEQUENCE HAS TO MOVE — this matters as much as the sentences:\n"
    "\u2022 ESCALATE. Every beat must give more than the one before it: further in, not "
    "wider. Do not save your second-best line for the end. It goes second.\n"
    "\u2022 LEAVE THE DOOR OPEN. End a beat at the edge of something the next one answers. "
    "A beat rounded off completely gives them a clean place to stop, and they will take it.\n"
    "\u2022 BREAK THE RHYTHM. Vary the lengths hard — two lines after a long beat lands like "
    "a hand on the shoulder. Six beats of the same size read as a form letter however "
    "good the words in them are.\n"
    "\u2022 ONLY THE LAST BEAT CLOSES. It is the one that resolves. End on the line they "
    "would repeat to somebody else."
)


PERIOD_STRUCTURE = (
    "\n\nWrite SEVEN parts separated by exactly --- (and nothing else between them).\n"
    "Part 1 is a single vivid curiosity line — a teaser that makes them want to read on (no title, no advice yet).\n"
    "Parts 2-7 each begin with a SHORT title (2-4 words), then ' :: ', then the body. Use this exact form:\n"
    "  Title :: body text here\n"
    "The six titled parts, in order, cover:\n"
    "2) The weather now — what is ACTUALLY happening for them in this period, in warm plain language: the real shift at work, felt and concrete — but NEVER named by its technical term (no transit / placement / day-lord / sign / dasha jargon). Say what it DOES to them, vivid and specific, no vague filler.\n"
    "3) The pattern — the theme at work for them right now and what it's really about.\n"
    "4) The undercurrent — the hidden tension or cost beneath it, told honestly.\n"
    "5) Lean in — the best, most rewarding way to use this period.\n"
    "6) Watch for — the one thing to handle with care, said with a wink not a warning label.\n"
    "7) The throughline — one truth that lingers after they close the app.\n"
    "Give each title a fresh, characterful name (don't just reuse the labels above). 2-3 sentences per body "
    "(part 1 is a single line). Separate every part with exactly ---.\n"
    "\n"
    "TWO RULES ABOUT THE ORDER, which decide whether they reach part 7:\n"
    "\u2022 ESCALATE. Each part must give more than the one before it — further in, not wider. "
    "Do not hold your second-best line back for the end; it belongs at part 3.\n"
    "\u2022 LEAVE THE DOOR OPEN. End each part at the edge of something the next one takes up. "
    "A part rounded off completely gives them a clean place to stop, and they will take it. "
    "Part 7 is the only one that closes."
)


def build_period_collage(title: str, marker: str, segs: list, ttl: int = 3600) -> dict:
    """Shape period parts into a FLAT block list: overline(marker) · heading(title)
    · hook · then titled beats as alternating left/right (overline title + paragraph)
    with dividers. Each beat may be 'Title :: body' — the title becomes an overline.
    Flat (not wrapped in a `collage` block) so the deck's flip-reader renders it
    inside its ScrollView. Graceful if the LLM returns fewer/untitled parts."""
    parts = [s.strip() for s in (segs or []) if s and s.strip()]
    hook = parts[0] if parts else ''
    rest = parts[1:7] if len(parts) > 1 else []
    blocks = []
    if marker:
        blocks.append({'type': 'overline', 'text': marker, 'style': {'align': 'center'}})
    blocks.append({'type': 'heading', 'text': title, 'style': {'align': 'center'}})
    if hook:
        # If the hook itself slipped in a 'Title :: body', keep only the body.
        hook_body = hook.split('::', 1)[1].strip() if '::' in hook else hook
        blocks.append({'type': 'paragraph', 'text': hook_body, 'style': {'align': 'center'}})
        blocks.append({'type': 'divider'})
    # Section (beat) titles: bigger than the body, smaller than the main title,
    # centred and white — matching the wheel / deck readings, so the period reads as
    # spaced sections, not one paragraph. Gold is reserved for rare, sacred accents,
    # not every section heading. (The overline's forced size is overridden by this
    # per-block style, which the Blocks renderer applies last.)
    SECTION_TITLE = {'align': 'center', 'fontSize': 20, 'letterSpacing': 0.6, 'color': 'rgba(255,255,255,0.9)'}
    for i, p in enumerate(rest):
        if '::' in p:
            head, body = p.split('::', 1)
            head, body = head.strip(), body.strip()
            if head:
                blocks.append({'type': 'overline', 'text': head, 'style': dict(SECTION_TITLE)})
            blocks.append({'type': 'paragraph', 'text': body or head, 'style': {'align': 'center'}})
        else:
            blocks.append({'type': 'paragraph', 'text': p, 'style': {'align': 'center'}})
        blocks.append({'type': 'divider'})
    return {'title': title, 'blocks': blocks, 'pages': reel_pages_from_blocks(blocks),
            'version': 6, 'cache_ttl_seconds': ttl}


# Style presets applied per reel page. These use ONLY fields the shipped reel
# renderer already honors (align + overline/title/body style overrides), so a
# feature reads DIFFERENTLY per mood even before the richer layout registry ships;
# once it does, the layout takes over and these remain a harmless base.
_REEL_PRESETS = {
    'editorial': {'align': 'center',
                  'overlineStyle': {'letterSpacing': 3, 'fontSize': 10},
                  # NB: the renderer's textStyle reads `size`/`weight`, not fontSize/
                  # fontWeight, so these two never applied and the title stays the
                  # layout's 30pt — the lineHeight (which it does read) is sized
                  # for that: 48 is 1.6 em, Baloo 2's own line, or Android clips it.
                  'titleStyle': {'fontSize': 27, 'lineHeight': 48, 'letterSpacing': 0.2, 'fontWeight': '700'},
                  'bodyStyle': {'fontSize': 16, 'lineHeight': 26, 'textAlign': 'center'}},
    'chapter':   {'align': 'bottom',
                  'titleStyle': {'fontSize': 31, 'lineHeight': 50, 'fontWeight': '700', 'letterSpacing': -0.3},
                  'bodyStyle': {'fontSize': 15, 'lineHeight': 24}},
}


def _apply_reel_preset(pages, preset):
    p = _REEL_PRESETS.get(preset)
    if not p:
        return pages
    for pg in pages:
        if p.get('align'):
            pg['align'] = p['align']   # the preset's alignment wins over the builder default
        for k in ('overlineStyle', 'titleStyle', 'bodyStyle'):
            if p.get(k):
                pg[k] = {**p[k], **(pg.get(k) or {})}   # per-page override still wins
    return pages


def reel_pages_from_blocks(blocks, media=None, preset=None):
    """Derive reels `pages` from a reading's block list so a collage/reading endpoint
    can also render as `reels` (the app's ReelsTemplate reads data.pages). Each heading
    — or a beat's overline — starts a page; the paragraphs under it become its reading.
    A single leading overline (the marker) merges into the first heading's page.
    Accepts a flat block list OR a `[{type:'collage', blocks:[…]}]` wrapper. `preset`
    stamps a per-mood style (editorial/chapter) using only fields the shipped renderer
    already honors, so features vary even before the layout registry is deployed."""
    if isinstance(blocks, list) and len(blocks) == 1 and isinstance(blocks[0], dict) and blocks[0].get('type') == 'collage':
        blocks = blocks[0].get('blocks') or []
    pages, cur = [], None

    def _flush():
        nonlocal cur
        if cur and (cur.get('title') or cur.get('reading') or cur.get('overline')):
            if media:
                cur.setdefault('media', media)
            pages.append(cur)
        cur = None

    for b in (blocks or []):
        if not isinstance(b, dict):
            continue
        typ = b.get('type')
        txt = str(b.get('text', '')).strip()
        if typ == 'heading':
            if cur and cur.get('overline') and not cur.get('title') and not cur.get('reading'):
                cur['title'] = txt                       # marker overline + heading = one page
            else:
                _flush(); cur = {'title': txt, 'align': 'center'}
        elif typ == 'overline':
            if not txt:
                continue
            if cur is None:
                cur = {'overline': txt, 'align': 'center'}
            else:
                _flush(); cur = {'title': txt, 'align': 'center'}   # a later overline = a new beat
        elif typ == 'paragraph':
            if not txt:
                continue
            if cur is None:
                cur = {'align': 'center'}
            cur['reading'] = (cur.get('reading', '') + '\n\n' + txt).strip() if cur.get('reading') else txt
        # divider / other → page separator handled implicitly
    _flush()
    return _apply_reel_preset(pages, preset)



def parse_json_or_text(raw: str) -> dict:
    """Try to parse LLM output as JSON; fall back to {'text': raw}.

    Tolerates the common ways a model breaks strict JSON: ```code fences```,
    // line and /* block */ comments (often echoed from a JSON template's hints),
    and trailing commas. Without this a single stray `// ...` line makes the whole
    reply unparseable, and callers that fall back to r['text'] end up dumping the
    entire raw JSON into the UI (e.g. a concept info card) with no structured items.
    """
    import json
    import re

    def _clean(s: str) -> str:
        s = s.strip()
        if s.startswith('```'):                       # ```json … ``` fences
            s = re.sub(r'^```[a-zA-Z]*\s*', '', s)
            if s.endswith('```'):
                s = s[:-3]
        s = re.sub(r'(?m)^[ \t]*//.*$', '', s)         # whole-line // comments
        s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)    # /* block */ comments
        s = re.sub(r',(\s*[}\]])', r'\1', s)           # trailing commas
        return s

    for cand in (raw, _clean(raw)):
        if not isinstance(cand, str):
            continue
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            s, e = cand.find('{'), cand.rfind('}')
            if s >= 0 and e > s:
                try:
                    return json.loads(cand[s:e + 1])
                except json.JSONDecodeError:
                    pass
    return {'text': raw}


def salvage_sections(raw: str) -> list:
    """Recover [{title, body}] from a JSON-ish reply that json.loads couldn't parse.

    A model (esp. Gemini) sometimes TRUNCATES mid-JSON at the token limit, or emits
    unescaped newlines/quotes in long prose — either breaks strict parsing, and the raw
    `{ "sections": [...] }` string would otherwise dump straight into the UI. This pulls
    each "title"/"body" string value tolerantly (stopping at the next unescaped quote or
    the truncation point), so the reading survives even a half-written JSON reply.
    """
    import re
    if not isinstance(raw, str):
        return []

    def _unescape(v: str) -> str:
        return (v.replace('\\n', '\n').replace('\\t', '\t')
                 .replace('\\"', '"').replace("\\'", "'").replace('\\\\', '\\').strip())

    def _vals(key: str) -> list:
        pat = '"' + key + r'"\s*:\s*"((?:\\.|[^"\\])*)'
        return [_unescape(m.group(1)) for m in re.finditer(pat, raw, re.S)]

    titles, bodies = _vals('title'), _vals('body')
    secs = []
    for i, b in enumerate(bodies):
        if b:
            secs.append({'title': titles[i] if i < len(titles) else '', 'body': b})
    return secs


def readable_fallback(raw) -> str:
    """Turn a possibly-broken-JSON model reply into readable prose — NEVER raw JSON.

    Use this on every 'the model was asked for JSON but we must show text' fallback path
    (kp_horary, name, natal theme, …). It first tries to salvage "body"/"reading"/"text"
    values; if none, it strips JSON scaffolding (fences, braces, keys, quotes) so a broken
    reply degrades to prose instead of dumping `{ "..." }` onto a card.
    """
    import re
    if not isinstance(raw, str) or not raw.strip():
        return ''
    secs = salvage_sections(raw)
    if secs:
        joined = '\n\n'.join(s['body'] for s in secs if s.get('body'))
        if joined.strip():
            return joined.strip()
    # tolerant single-value pulls for other common keys
    for key in ('reading', 'body', 'overview', 'text', 'front'):
        m = re.search('"' + key + r'"\s*:\s*"((?:\\.|[^"\\])*)', raw, re.S)
        if m and m.group(1).strip():
            return (m.group(1).replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')).strip()
    # last resort: strip JSON scaffolding to leave whatever prose is there
    s = re.sub(r'```[a-zA-Z]*', '', raw)
    s = re.sub(r'^\s*json\b', '', s, flags=re.I)
    s = re.sub(r'"(?:pages|sections|title|body|front|reading|overview|items|text)"\s*:', '', s)
    s = re.sub(r'[{}\[\]"]', '', s)
    return s.strip().strip(',').strip()
