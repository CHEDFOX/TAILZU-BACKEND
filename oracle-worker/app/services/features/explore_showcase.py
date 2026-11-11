"""
EXPLORE SHOWCASE — one FREE, fixed-structure reels endpoint for exploring any of the
standalone tradition systems straight from chat.

When the oracle judges that a computed system is worth exploring, the chat reply carries
a hook whose action opens this endpoint with `?system=<key>`. The endpoint routes to that
system's own (verified) computation, then wraps its reading in ONE consistent reels shape:

    [ branded COVER page — what this system sees ]  +  [ the system's own reading pages ]

So every system is explored through the same beautiful, uniform presentation, and the
chat only ever has to name a system — the fixed structure lives here.

  POST /api/public/explore-showcase?system=mayan   → { title, pages }  (reels)

Free: no paywall gate. The underlying feature handler still applies the normal feature
rate-limit and its own per-user cache, so this adds no new cost beyond opening the feature.
"""
import importlib
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.features.catalog_i18n import localize_labels

router = APIRouter(prefix="/public", tags=["Explore Showcase"])

# key → (display title, "what it sees" cover line, cover media, feature module, handler).
# Only birth-driven systems (no typed input needed). Cover lines are GENERAL framings of
# what the system reveals — never fabricated specifics.
_EXPLORE = {
    "mayan":    ("The Mayan Sign",   "The Maya read the exact day you were born as a living sign — a nature, a tone, a gift.", "home/M2",               "mayan_feature",    "mayan"),
    "celtic":   ("The Celtic Tree",  "The Celtic tree calendar gives every birth a tree — its wood, its temperament, its season.", "features/core_numbers", "celtic_feature",   "celtic"),
    "aztec":    ("The Aztec Sign",   "The Aztec day-count reads your birth as one of twenty sacred signs and its thirteen-day wave.", "home/M2",           "aztec_feature",    "aztec"),
    "nine_star":("Nine Star Ki",     "Nine Star Ki maps the year-energy you were born into and how it moves through a life.", "features/core_numbers",  "ninestar_feature", "ninestar"),
    "tibetan":  ("Tibetan Astrology","Tibetan astrology weaves your birth-animal and element into a single living portrait.", "features/core_numbers",   "tibetan_feature",  "tibetan"),
    "egyptian": ("Egyptian Calendar","The Egyptian calendar places your birth under one of its gods — a guardian and a temperament.", "home/M2",         "egyptian_feature", "egyptian"),
    "mahabote": ("Mahabote",         "Burmese Mahabote reads your birth-weekday as one of its planetary houses.", "features/core_numbers",             "mahabote_feature", "mahabote"),
    "native":   ("The Medicine Wheel","The Native American medicine wheel gives every birth an animal, a wind, and a clan.", "features/core_numbers",    "native_feature",   "native"),
    "lo_shu":   ("The Lo Shu Grid",  "The Lo Shu grid lays your birth numbers on the ancient magic square — where you're full, where you're missing.", "features/core_numbers", "loshu_feature", "lo_shu"),
    "arabic":   ("The Arabic Parts", "The Arabic Parts are calculated points — Fortune, Spirit, Love — drawn from the angles of your birth.", "features/core_numbers", "arabic_feature", "arabic"),
    "sidereal": ("The Sidereal Sky", "The sidereal sky reads your birth against the fixed stars as they truly sit.", "home/M2",                        "sidereal_feature", "sidereal"),
    "uranian":  ("Uranian Midpoints","Uranian astrology works with midpoints — the quiet meeting-points between your planets.", "features/core_numbers", "uranian_feature",  "uranian"),
    "almanac":  ("The Almanac",      "The old almanac reads the quality of the very day you arrived.", "home/M2",                                       "almanac_feature",  "almanac"),
    "kabbalah": ("The Tree of Life", "The Tree of Life places your birth on its sephirot — the vessels light moves through.", "features/core_numbers",  "kabbalah_feature", "kabbalah"),
    "alchemy":  ("Alchemy",          "Alchemy reads your birth as a metal and an operation — the raw material and the work.", "features/core_numbers",   "alchemy_feature",  "alchemy"),
    "hermetic": ("The Hermetic Laws","The Hermetic laws read your life-path as one of seven living principles.", "features/core_numbers",               "hermetic_feature", "hermetic"),
    "taoist":   ("Taoist Cycles",    "The Taoist cycle reads your birth through the five phases and their turning.", "features/core_numbers",            "taoist_feature",   "taoist"),
    "sacred":   ("Sacred Geometry",  "Sacred geometry gives your birth a Platonic solid and the pattern your life keeps drawing.", "features/core_numbers", "sacred_feature", "sacred"),
}


# The 1-2 word "explore" chip label per system.
_LABEL = {
    "mayan": "Mayan", "celtic": "Celtic", "aztec": "Aztec", "nine_star": "Nine Star",
    "tibetan": "Tibetan", "egyptian": "Egyptian", "mahabote": "Mahabote", "native": "Medicine Wheel",
    "lo_shu": "Lo Shu", "arabic": "Arabic Parts", "sidereal": "Sidereal", "uranian": "Midpoints",
    "almanac": "Almanac", "kabbalah": "Kabbalah", "alchemy": "Alchemy", "hermetic": "Hermetic",
    "taoist": "Taoist", "sacred": "Geometry",
}


# ── DIVINATION recommendations (tarot, runes, I Ching …) ─────────────────────────
# These are INTERACTIVE — the user lays/picks the cards — so the chat hook opens the
# divination PICKER (/divination/{sid}) rather than a pre-computed reels. Sourced from
# the divination registry, so a new deck added there is instantly recommendable.
_DIVINATION_LABEL = {"tarot": "Tarot", "iching": "I Ching", "lenormand": "Lenormand",
                     "runes": "Runes", "geomancy": "Geomancy", "ogham": "Ogham"}
_DIVINATION_HINT = {
    "tarot":     "a crossroads or decision, love / work / luck, 'what's really going on' — a laid spread reveals the pattern",
    "iching":    "change and timing — how a situation will unfold and the wise next move",
    "lenormand": "a plain, concrete answer about the near future of a specific matter",
    "runes":     "fate, an obstacle, a blunt push — what force is really at play",
    "geomancy":  "a clear yes / no on one specific question",
    "ogham":     "growth, roots and what to nurture — a nature lens on the question",
}


def _divination_systems() -> list:
    try:
        from app.services.divination import SYSTEMS
        return list(SYSTEMS.keys())
    except Exception:
        return ["tarot"]


def valid_divination(sid: Optional[str]) -> bool:
    return isinstance(sid, str) and sid in _divination_systems()


def divination_menu() -> str:
    """Compact `sid — "Label" (when a drawn reading fits)` list for the recommender."""
    out = []
    for sid in _divination_systems():
        title = _DIVINATION_LABEL.get(sid, sid.title())
        out.append(f'{sid} — "{title}" ({_DIVINATION_HINT.get(sid, "a drawn reading of the question")})')
    return "\n".join(out)


def build_divination_hook(sid: Optional[str]) -> Optional[dict]:
    """The chat hook that opens a divination PICKER (the user then lays the cards). The
    action carries the whole picker section inline, so it opens under any lens."""
    if not valid_divination(sid):
        return None
    title = _DIVINATION_LABEL.get(sid, sid.title())
    section = {
        "id": f"divination_{sid}", "endpoint": f"/api/public/divination/{sid}",
        "template": "sdui", "present": "fullscreen", "title": title, "requires": [],
        "feature_kind": "reading", "method": "POST",
        "config": {"bg": "#000000"},
    }
    return {"label": title, "action": {"type": "open", "section": section}}


def valid_system(key: Optional[str]) -> bool:
    return isinstance(key, str) and key in _EXPLORE


def systems_menu() -> str:
    """Compact `key — title (what it sees)` list, for the oracle's recommender prompt."""
    return "\n".join(f"{k} — \"{v[0]}\" ({v[1]})" for k, v in _EXPLORE.items())


def build_showcase_hook(system_key: Optional[str]) -> Optional[dict]:
    """The chat hook that opens a system's fixed reels showcase. The action carries the
    whole section inline (endpoint + reels template), so it opens regardless of what the
    active catalog holds — the same path the concept hooks use."""
    if not valid_system(system_key):
        return None
    title = _EXPLORE[system_key][0]
    section = {
        "id": f"explore_{system_key}",
        "endpoint": f"/api/public/explore-showcase?system={system_key}",
        "template": "reels", "present": "fullscreen", "requires": ["kundli"],
        "title": title, "feature_kind": "reading", "method": "POST",
        "config": {"reelLayout": "editorial", "axis": "vertical", "staticBg": True,
                   "dim": 0.5, "blur": 22},
    }
    return {"label": _LABEL.get(system_key, "Explore"),
            "action": {"type": "open", "section": section}}


class _Req(BaseModel):
    system: Optional[str] = None
    kundli_data: Optional[dict] = None
    birth_data: Optional[dict] = None
    language: Optional[str] = "en"


class _CReq:
    """A duck-typed body the routed feature handler accepts (same fields its own _Req has).

    Every routed handler defines its own pydantic `_Req` with Optional fields that default
    to None (e.g. kabbalah reads `.name`). This shim must mirror that: any field a handler
    reads but we didn't explicitly copy resolves to None — exactly like a missing Optional —
    instead of raising AttributeError (which the endpoint swallows into an empty cover-only
    reels). Without this, `showcase(system=kabbalah)` opened blank on every call."""
    def __init__(self, req: _Req):
        self.kundli_data = req.kundli_data
        self.birth_data = req.birth_data
        self.language = req.language

    def __getattr__(self, _name):   # any optional field a handler reads → None (pydantic parity)
        return None


@router.post("/explore-showcase")
async def explore_showcase(req: _Req, request: Request):
    # `system` may arrive on the query string (?system=mayan) or in the body.
    key = req.system or request.query_params.get("system")
    if not valid_system(key):
        raise HTTPException(status_code=404, detail="unknown system")
    if not (req.kundli_data or req.birth_data):
        raise HTTPException(status_code=400, detail="Birth data required")

    title, cover_line, media, module, func = _EXPLORE[key]
    language = req.language or "en"

    try:
        loc = await localize_labels([title, cover_line, "Worth exploring"], language)
    except Exception:
        loc = {}
    g = lambda x: loc.get(x, x)   # noqa: E731

    # Route to the system's OWN verified computation + narration.
    pages = []
    try:
        mod = importlib.import_module(f"app.services.features.{module}")
        result = await getattr(mod, func)(_CReq(req), request)
        if isinstance(result, dict):
            pages = [p for p in (result.get("pages") or []) if isinstance(p, dict)]
    except HTTPException:
        raise
    except Exception:
        pages = []

    # The FIXED structure: a branded cover, then the system's reading pages.
    cover = {"media": media, "dim": 0.48, "blur": 20, "fit": "cover", "align": "center",
             "overline": g("Worth exploring"), "title": g(title), "body": g(cover_line)}
    out_pages = [cover] + pages
    if len(out_pages) == 1:   # computation yielded nothing — keep the cover meaningful
        cover["body"] = g(cover_line)

    return {"title": g(title), "pages": out_pages,
            "config": {"reelLayout": "editorial", "axis": "vertical", "staticBg": True,
                       "dim": 0.5, "blur": 22},
            "version": 1, "cache_ttl_seconds": 604800}


explore_showcase_router = router
