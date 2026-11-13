"""
CATALOG — Single source of truth for what the frontend renders.

Section types:
  - "reading" / "chart" / "compat" / "numerology" / "special":
        Section has an `endpoint`. Frontend fetches it to get the data.
  - "content":
        Section has NO endpoint. The `content` dict is the data. Frontend
        renders it directly. Use for promo banners, editorial cards, event
        alerts, scheduled announcements, etc.

Time windows: start_date / end_date are ISO 8601 strings in UTC.
A section is hidden outside [start_date, end_date]. Either or both can be None.

Editing: this file is the live config. Edit SECTIONS, bump CATALOG_UPDATED_AT,
restart. (Frontend uses updated_at for SWR cache invalidation.)
Future: migrate to a small admin UI backed by a JSON table — same shape.

How to add a content tile:

    _section(
        id="diwali_2026",
        endpoint=None,
        group="daily",
        position=5,
        feature_kind="content",
        tile_type="banner",
        start_date="2026-10-25T00:00:00Z",
        end_date="2026-11-05T23:59:59Z",
        content={
            "title": "Diwali Muhurat",
            "body": "Lakshmi puja window: 6:42pm – 8:14pm",
            "image_url": "https://...",
            "action_label": "View muhurat",
            "action_type": "open_section",   # open_url | open_section | none
            "action_target": "panchanga",
        },
    ),
"""

from typing import List, Dict, Optional

from app.services.catalog.sdui import DEMO_TREE


CATALOG_VERSION = 478
CATALOG_UPDATED_AT = "2026-07-06T00:00:00Z"
# Global feature-cache epoch: part of every feature-cache key on the app. Bump this
# to force EVERY device to refetch ALL feature readings at once (e.g. after a fix to
# how readings are generated). Cheaper than bumping each section's cache_version.
# Bumped: numerology moved out of the system books into its own "Ank" book, and the
# life-Topic readings now speak the COLLECTIVE verdict of all three traditions (Vedic +
# Western + Chinese) — every cached topic reading must refetch to pick up the new voice.
CATALOG_CACHE_EPOCH = "2026-07-18.2"


GROUPS: List[Dict] = [
    {"id": "daily",          "position": 1, "label": "Daily",         "i18n_key": "group.daily"},
    {"id": "charts",         "position": 2, "label": "Charts",        "i18n_key": "group.charts"},
    {"id": "stories",        "position": 3, "label": "Stories",       "i18n_key": "group.stories"},
    {"id": "numerology",     "position": 4, "label": "Numerology",    "i18n_key": "group.numerology"},
    {"id": "compatibility",  "position": 5, "label": "Compatibility", "i18n_key": "group.compatibility"},
    {"id": "special",        "position": 6, "label": "Special",       "i18n_key": "group.special"},
]


# ── DIVINATION SYSTEMS ───────────────────────────────────────────
# The lenses the app reads through. Add a new ancient system here and it
# appears in the Explore filter automatically — no app release. Section
# `system` fields reference these ids. `engine` maps to the chat/engine key.
# `chat: True` makes the system selectable in the Oracle chat picker. Add a new
# chat-enabled system here and it appears in chat automatically — no app release.
SYSTEMS: List[Dict] = [
    # KP is folded INTO Vedic (its sections carry system="bphs"); it is not a
    # separate top-level system. The bphs engine still resolves KP sub-lord work.
    # chat_engines: the lenses the Vedic chat can speak through — Vedic / KP /
    # Mandala. The chat shows ONE option (Vedic); the backend auto-routes to the
    # right lens per question (chat._route_engine). Kept here as the canonical list.
    {"id": "bphs",    "name": "Jyotish",      "engine": "bphs",    "position": 1, "chat": True,  "color": "#D4AF37", "i18n_key": "system.bphs",    "glyph": "systems/system_vedic",      "provenance": "",
     # The Vedic lens IS Jyotish + KP + Mandala working together as one — the backend
     # auto-speaks KP (sub-lord/timing) and Mandala (place/relocation) inside Vedic when
     # a question calls for them (chat._route_engine). So the selector shows just two
     # lenses: Vedic and the cross-system meta-oracle Plutt0.8.
     # Every system now offers ALL three tradition lenses (Vedic · Hermetica · BaZi)
     # + the meta-oracle Plutt0.8 — each computes from the same birth data — with the
     # user's own (auto-selected) tradition first as the default.
     # ONLY Plutt0.8 is selectable for now — the meta-oracle across every system. Name
     # in plain white (textColor), the send button red (color). The other lenses are
     # kept out of the selector; re-add entries here to bring them back (no app release).
     "chat_engines": [
         {"id": "plutto",  "name": "Plutt0.8", "engine": "plutto",  "chat": True, "color": "#EF4444", "textColor": "#FFFFFF", "voice": "nova"},
     ]},
    {"id": "western", "name": "Hermetica",    "engine": "western", "position": 3, "chat": True,  "color": "#A78BFA", "i18n_key": "system.western", "glyph": "systems/system_western",    "provenance": "",
     "chat_engines": [
         {"id": "plutto",  "name": "Plutt0.8", "engine": "plutto",  "chat": True, "color": "#EF4444", "textColor": "#FFFFFF", "voice": "nova"},
     ]},
    {"id": "chinese", "name": "BaZi",    "engine": "chinese", "position": 4, "chat": True,  "color": "#F87171", "i18n_key": "system.chinese", "glyph": "systems/system_chinese",    "provenance": "",
     "chat_engines": [
         {"id": "plutto",  "name": "Plutt0.8", "engine": "plutto",  "chat": True, "color": "#EF4444", "textColor": "#FFFFFF", "voice": "nova"},
     ]},
    # Numerology & Mandala removed from the selectable systems. (Mandala stays as a
    # Vedic chat lens via bphs.chat_engines; numerology features remain universal.)
]


# ── DAILY FEED (home Zone 1) ─────────────────────────────────────
# Fully flexible: `pinned` is hand-curated (always shown, in order); the
# server then adds `rotate_count` more, deterministically rotated by date
# from `rotate_pool` (empty pool = auto: all visible endpoint features).
# Set rotate_count to any number; set it to 0 for hand-curation only.
# `exclude` drops ids from the auto-pool (never rotates them into the deck;
# they still live in their group blocks). Pinned ids ignore exclude.
FEED: Dict = {
    "pinned": ["welcome_card", "blunt_seer", "today_deep", "name_correction"],
    "rotate_pool": [],
    "rotate_count": 0,
    "exclude": ["four_pillars", "kp_horary"],
}

# ── HOME COMPOSITION (server-driven, fully composable) ───────────
# An ordered list of blocks the app renders top→bottom. Each block:
#   {id, type, source, title?, options?}
#   type   → app renderer: "deck" | "grid" | "carousel" (registry in app)
#   source → which sections: "feed" | "all" | "group:X" | "system:X"
#            | "ids:a,b" | "id:a"
# Swap / merge / remove / reorder freely — no app release. A brand-new `type`
# is the only thing that needs a one-time app renderer.
#
# Backend-driven styling levers (no app release — the app honors these generically):
#   options.blockStyle  any RN style on a wrapper around ANY block — margins,
#                       transforms, zIndex… Use it to nudge spacing / pull blocks
#                       together so a connector touches / overlap / shift / layer.
#   options.titleSide   circle tiles: 'left' | 'right' | 'alt' — title beside the
#                       disc (disc stays centred); omit → title beneath.
#   options.titleStyle  circle tiles: RN text style for the title (size/colour/…).
#   media options.gap / options.gapBottom  per-media top/bottom margin (negatives
#                       allowed) so a media strand can touch the blocks around it.
# NOTE: the live HOME composition is defined further down (search "HOME = [").

# All chrome copy the app renders. Backend-controlled and (later) localized per
# `lang`. The frontend holds NO hard text: any key omitted here simply doesn't
# render in the app. Add a key, ship copy — no app release.
HOME_LABELS = {
    "feed": "Today",
    "explore": "Explore",
    "explore_sub": "every reading, every system",
    "filter_all": "All",
    "chat_placeholder": "Speak Freely …",
    "chat_voice": "Voice",
    "chat_error": "The stars are quiet. Ask again.",
    # crash screen (ErrorBoundary) — was hardcoded English; now backend-controllable + translatable
    "crash_title": "The cosmos hiccuped.",
    "crash_message": "Give it a moment and try again.",
    "crash_retry": "Try again",
    "plutto_name": "Plutt0.8",
    "ritual_submit": "Ask the stars",
    "ritual_partner_note": "This reading needs a second chart. Partner input is coming soon.",
    "reveal": "Reveal",
    "open": "Open",
    # chrome the app reads (Settings, personality, paywall) — translated per language
    "settings": "Settings",
    "change_language": "Language",
    "save": "Save",
    "remove": "Remove",
    "personality_title": "Personality",
    "personality_hint": "Who should Plutto be for you? Give it a voice — it remembers.",
    "personality_placeholder": "e.g. a wry old mystic who tells it to me straight…",
    "restore": "Restore purchases",
    "dismiss": "Not now",
    "plans_unavailable": "Plans are not available right now.",
    # ── every label the app asks for must live here, or getLabels().x stays English
    #    forever. These are translated per language alongside the rest. ──
    # onboarding + auth
    "get_started": "Get Started",
    "next": "Next",
    "skip": "Skip",
    "choose": "Choose",
    "name_prefix": "Hello,",
    "name_placeholder": "Add Name",
    "info_dismiss": "Got it",
    "email": "Email",
    "phone": "Phone",
    "search": "Search",
    "sign_in_apple": "Sign in with Apple",
    "sign_in_google": "Sign in with Google",
    # settings
    "change_system": "System",
    # chat / oracle
    "greeting": "Hello",
    "chat_ask": "Ask",
    "chat_empty": "…",
    "chat_empty_reply": "…",
    "chat_listening": "Listening…",
    "feature_chat_placeholder": "Ask about this…",
    "go_deeper": "go deeper",
    # feature inputs (form / input-reveal / ritual)
    "form_submit": "Submit",
    "input_continue": "Continue",
    "input_enter": "Enter",
    "ritual_answer_seed": "answer",
    "ritual_input_seed": "your input",
    "ritual_input_placeholder": "Type your answer",
    # paywall extras
    "not_now": "Not now",
    "terms": "Terms",
    "privacy_policy": "Privacy Policy",
    "periods": {"MONTHLY": "month", "ANNUAL": "year", "WEEKLY": "week",
                "TWO_MONTH": "2 months", "THREE_MONTH": "3 months",
                "SIX_MONTH": "6 months", "LIFETIME": "lifetime"},
    # update gate
    "update_title": "Update available",
    "update_message": "A new version is available.",
    "update_cta": "Update",
    "update_dismiss": "Later",
    # voice
    "voice_error": "The stars are quiet. Try again.",
    # birth-place search field (compatibility / birth pickers)
    "place_search": "Search city of birth",
    # planet info card (KP) — label words; the values (sign/sub-lord) come from the engine
    "cup": "CUP",
    "sub": "SUB",
    # date-ring month names — localized globally (any feature's picker reads these
    # unless it sets its own config.months). Arrays are translated element-wise.
    "months": ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"],
    "monthsShort": ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
}


def _section(
    *,
    id: str,
    group: str,
    position: int,
    endpoint: Optional[str] = None,
    method: Optional[str] = "POST",
    feature_kind: str = "reading",
    tile_type: str = "card",
    requires: Optional[List[str]] = None,
    cache_ttl_seconds: int = 86400,
    cache_version: int = 1,
    i18n_key: Optional[str] = None,
    visible: bool = True,
    hidden: bool = False,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    min_app_version: Optional[str] = None,
    platforms: Optional[List[str]] = None,
    content: Optional[Dict] = None,
    system: Optional[str] = None,
    template: Optional[str] = None,
    media: Optional[str] = None,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    present: Optional[str] = None,
    config: Optional[Dict] = None,
) -> Dict:
    """Build a section entry. For content tiles set feature_kind='content'
    and pass `content={...}` with no endpoint.

    system:   which divination system this belongs to (see SYSTEMS). None =
              cross-system / global. Drives the Explore filter.
    template: which client layout renders this. Auto-derived if omitted:
              content -> 'content'; needs extra input -> 'feature'; else 'reading'.
    media:    RemoteMedia base path for hero art/icon (e.g. 'features/past_life').
              Drop the file in static/<path>.<ext> on the VPS; no app release.
    config:   free-form per-template settings the client reads (e.g. the
              datetime picker's {fields, minuteStep, yearFrom, submitAs, submit}).
              Passed through verbatim to the app.
    """
    if feature_kind == "content":
        endpoint = None
        method = None

    req = requires if requires is not None else (["kundli"] if endpoint else [])

    if template is None:
        if feature_kind == "content":
            template = "content"
        elif set(req) - {"kundli", "coordinates"}:
            template = "feature"   # needs user input (partner, question, name, ...)
        else:
            template = "reading"

    # How the feature opens: visual templates take the full-height sheet;
    # text readings float in a centered card. Backend-overridable per section.
    if present is None:
        present = "full" if template in ("wheel", "arc", "reveal_deck", "collage", "deck", "stack", "datetime") else "card"

    return {
        "present": present,
        "id": id,
        "config": config,
        "group": group,
        "position": position,
        "endpoint": endpoint,
        "method": method,
        "feature_kind": feature_kind,
        "tile_type": tile_type,
        "template": template,
        "system": system,
        "media": media,
        "title": title,
        "subtitle": subtitle,
        "requires": req,
        "cache_ttl_seconds": cache_ttl_seconds,
        "cache_version": cache_version,
        "i18n_key": i18n_key or f"section.{id}",
        "visible": visible,
        "hidden": hidden,
        "start_date": start_date,
        "end_date": end_date,
        "min_app_version": min_app_version,
        "platforms": platforms,
        "content": content,
    }


# Explore's card feed is cut after these cards, with a time wheel in each gap
# (explore_part_N sections below; EXPLORE_FEED_BLOCKS further down).
EXPLORE_CUTS = (2, 4, 6)
# Bump after touching the Explore cards (explore_feed._EXPLORE_CARDS): every part
# of the feed, and the whole-feed explore_home, cache by it.
EXPLORE_FEED_CACHE_VERSION = 30

SECTIONS: List[Dict] = [
    # ── VEDIC TIME DECK (home top) ────────────────────────────
    # Four cards rendered by the existing `deck` cover-flow: cards show just the
    # title; tap → flip → the period's reading (lazy per card). One endpoint each.
    # system="bphs" → Vedic only.
    # media: drop art at static/time/<period>.<ext> on the VPS (no app release).
    # Card faces show the art under the title; add config.card.blur/dim per card if
    # the title needs more contrast over a busy image.
    _section(id="vedic_today", endpoint="/api/public/vedic/today", group="daily", position=1, system="bphs", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=3600,   cache_version=7, title="Today",      subtitle="Something in today wants your attention.", media="time/vedic/today", config={"card": {"blur": 0}}),
    _section(id="vedic_week",  endpoint="/api/public/vedic/week",  group="daily", position=2, system="bphs", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=21600,  cache_version=7, title="This Week",  subtitle="A shift is already forming this week.", media="time/vedic/week", config={"card": {"blur": 0}}),
    _section(id="vedic_month", endpoint="/api/public/vedic/month", group="daily", position=3, system="bphs", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=86400,  cache_version=7, title="This Month", subtitle="This month is hiding a pattern.", media="time/vedic/month", config={"card": {"blur": 0}}),
    _section(id="vedic_year",  endpoint="/api/public/vedic/year",  group="daily", position=4, system="bphs", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=604800, cache_version=7, title="This Year",  subtitle="Your year has a secret shape.", media="time/vedic/year", config={"card": {"blur": 0}}),
    # Home rail source: returns the four periods as items (title + curiosity marker);
    # each item opens the matching collage endpoint above. Hidden from Explore —
    # only the home `rail` block sources it (by id). Cheap, no LLM.
    _section(id="vedic_periods", endpoint="/api/public/vedic/periods", group="daily", position=0, system="bphs", tile_type="card", cache_ttl_seconds=3600, cache_version=1, title="Today", visible=True),
    # Time-wheels source: feeds the four-wheel (Days/Weeks/Months/Years) home deck.
    _section(id="vedic_wheels", endpoint="/api/public/time-wheels?system=bphs&only=day", group="daily", position=0, system="bphs", tile_type="card", cache_ttl_seconds=3600, cache_version=11, title="Time", visible=True),
    # SDUI demo — a fully server-driven screen (no endpoint; the tree lives in
    # config). Hidden by default; flip visible=True (or open by id) after the
    # final build to confirm the SDUI renderer works. Proof that the backend can
    # compose a whole screen with no app release.
    _section(id="sdui_demo", group="special", position=99, tile_type="card",
             template="sdui", present="fullscreen", cache_ttl_seconds=0, title="SDUI Demo",
             config={"tree": DEMO_TREE}, visible=False),
    # COMBINATION demo — one SDUI screen that stacks several templates inline via the
    # `embed` node (a grid, the time wheels, then another grid). Proof that the backend
    # can compose multi-template feature screens with no app release. Flip visible=True
    # (or open by id) to try it. Combine ANY home layouts this way.
    _section(id="combo_demo", group="special", position=97, tile_type="card",
             template="sdui", present="fullscreen", cache_ttl_seconds=0, title="Combo",
             visible=False, config={"tree": [
                 {"type": "box", "style": {"paddingHorizontal": 4, "paddingTop": 8}, "children": [
                     {"type": "heading", "text": "One screen, three templates", "style": {"marginBottom": 6}},
                     {"type": "overline", "text": "grid · wheels · grid"},
                     {"type": "embed", "layout": "grid", "source": "id:core_chart", "options": {"cols": 1, "cardH": 120}},
                     {"type": "embed", "layout": "timewheels", "source": "id:vedic_wheels"},
                     {"type": "embed", "layout": "grid", "source": "ids:past_life,life_story", "options": {"cols": 2, "cardH": 110}},
                 ]},
             ]}),
    # Topics ("second viewport"): a tab whose SDUI screen lists life-area cards
    # (Desire/Career/Sex/Money). The endpoint returns {tree}; the tab references
    # this section by id. Hidden from Explore.
    _section(id="topics_screen", endpoint="/api/public/topics", group="special", position=98,
             tile_type="card", cache_ttl_seconds=1800, cache_version=1, title="Discover", visible=True),

    # ── DAILY ─────────────────────────────────────────────────
    _section(id="today_deep",    endpoint="/api/public/today-deep",    group="daily",  position=20, tile_type="card",   cache_ttl_seconds=21600, media="cards/today", cache_version=3, visible=False),
    _section(id="the_word",      endpoint="/api/public/the-word",      group="daily",  position=30, tile_type="small",  cache_ttl_seconds=86400, visible=False),
    _section(id="time_reading",  endpoint="/api/public/time-reading",  group="daily",  position=40, tile_type="card",   cache_ttl_seconds=3600, visible=False),
    _section(id="panchanga",     endpoint="/api/public/panchanga",     group="daily",  position=50, tile_type="small",  cache_ttl_seconds=1800,
             method="GET", requires=["coordinates"], visible=False),

    # ── TALKS BACK — the voice layer (features/talks_back.py). Server-authored SDUI
    # trees in the app's own grammar; nothing technical on a screen, every receipt one
    # tap away. talk_home is the Home block above the wheels; the rest open from it
    # and from Explore cards. All hidden from the feed deck; openable by id.
    _section(id="talk_home",     endpoint="/api/public/talk/home",     group="daily", position=5,  template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=1800, cache_version=8, title="Today", hidden=True),
    _section(id="talk_coming",   endpoint="/api/public/talk/coming",   group="daily", position=6,  template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=3600, cache_version=7, title="Coming", hidden=True, config={"contentPad": {"top": 0, "x": 0, "y": 48}}),
    _section(id="talk_mirror",   endpoint="/api/public/talk/mirror",   group="daily", position=7,  template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=86400, cache_version=7, title="About you", hidden=True, config={"contentPad": {"top": 0, "x": 0, "y": 48}}),
    _section(id="talk_receipts", endpoint="/api/public/talk/receipts", group="daily", position=8,  template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=3600, cache_version=8, title="Receipts", hidden=True, config={"contentPad": {"top": 0, "x": 0, "y": 48}}),
    _section(id="talk_shells",   endpoint="/api/public/talk/shells",   group="daily", position=9,  template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=0, cache_version=7, title="The shells", hidden=True, config={"contentPad": {"top": 0, "x": 0, "y": 48}}),
    # The yearly letter is the one paid room in the layer (gate: talk_letter).
    _section(id="talk_letter",   endpoint="/api/public/talk/letter",   group="daily", position=10, template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=3600, cache_version=7, title="Your letter", hidden=True, config={"contentPad": {"top": 0, "x": 0, "y": 48}}),
    # The letter itself, full screen: a big reading is a reel. Opened from the letter
    # room's "Read the letter" / "Read it again"; gated like the room it opens from.
    _section(id="talk_letter_read", endpoint="/api/public/talk/letter/read", group="daily", position=12, template="reels", present="fullscreen", requires=["kundli"], cache_ttl_seconds=3600, cache_version=1, title="Your letter", hidden=True, config={"reelLayout": "editorial", "axis": "vertical", "bg": "#000000"}),
    _section(id="talk_letter_last", endpoint="/api/public/talk/letter/read?which=last", group="daily", position=13, template="reels", present="fullscreen", requires=["kundli"], cache_ttl_seconds=3600, cache_version=1, title="Last year's letter", hidden=True, config={"reelLayout": "editorial", "axis": "vertical", "bg": "#000000"}),
    _section(id="talk_moons",    endpoint="/api/public/talk/moons",    group="daily", position=11, template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=21600, cache_version=7, title="Moon nights", hidden=True, config={"contentPad": {"top": 0, "x": 0, "y": 48}}),

    # ── CHARTS ────────────────────────────────────────────────
    _section(id="core_chart", media="features/vedic_planets",     endpoint="/api/public/core-chart",     group="charts", position=20, system="bphs", feature_kind="chart", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=86400, cache_version=8, title="Grahas", config={"card": {"blur": 3}}),
    # The traditional birth chart (kundli / wheel / pillars, per system) is NOT a home
    # tile — it lives in the user's PROFILE (opened by the ring), built by /profile.
    # The user's PROFILE space (opened by the home ring). Universal (no system),
    # hidden from tiles, openable by id. Holds the chart today; future personalised
    # content/options are appended to the /profile tree — backend-only.
    _section(id="user_profile", endpoint="/api/public/profile", group="charts", position=999, feature_kind="chart", template="sdui", present="fullscreen", cache_ttl_seconds=86400, cache_version=27, title="Profile", hidden=True),
    # The Explore tab fetches this per-user (kundli → location) → the IG-style feed.
    _section(id="explore_feed", endpoint="/api/public/explore", group="charts", position=998, template="sdui", present="fullscreen", cache_ttl_seconds=2700, cache_version=10, title="Explore", hidden=True),
    # Explore HOME — the redesigned card feed (bg media + topic + curiosity + button).
    # Backend-authored SDUI stack; cards live in explore_feed._EXPLORE_CARDS.
    _section(id="explore_home", endpoint="/api/public/explore-feed", group="charts", position=996, template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=1800, cache_version=EXPLORE_FEED_CACHE_VERSION, title="Explore", hidden=True),
    # THE WHEELS, ONE BLOCK EACH. Home keeps the Day wheel (the *_wheels sections
    # above, `only=day`); Weeks, Months and Years sit between Explore's cards
    # (EXPLORE_FEED_BLOCKS). One wheel per block: no side scroll, no pager.
    *[_section(id=f"{_p}_wheel_{_u}", endpoint=f"/api/public/time-wheels?system={_s}&only={_u}", group="daily",
               position=0, system=_s, tile_type="card", cache_ttl_seconds=3600, cache_version=1,
               title=_t, hidden=True)
      for _p, _s in (("vedic", "bphs"), ("western", "western"), ("chinese", "chinese"))
      for _u, _t in (("week", "Weeks"), ("month", "Months"), ("year", "Years"))],
    # Explore's card feed in parts, cut after the cards in EXPLORE_CUTS (explore_feed
    # `after`/`upto`), so a wheel can sit between them.
    *[_section(id=f"explore_part_{_k + 1}",
               endpoint="/api/public/explore-feed?" + "&".join(
                   ([f"after={_a}"] if _a else []) + ([f"upto={_b}"] if _b else [])),
               group="charts", position=996, template="sdui", present="fullscreen", requires=["kundli"],
               cache_ttl_seconds=1800, cache_version=EXPLORE_FEED_CACHE_VERSION, title="Explore", hidden=True)
      for _k, (_a, _b) in enumerate(zip((0,) + EXPLORE_CUTS, EXPLORE_CUTS + (0,)))],
    # The web app's Home, beneath the wheels: Explore's globe and its Solar System
    # card, and nothing else from that feed (explore_feed `only=`). See WEB_HOME_SKY.
    _section(id="home_sky", endpoint="/api/public/explore-feed?only=globe,solar_system", group="charts", position=997, template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=1800, cache_version=3, title="Sky", hidden=True),
    # Explore card readings (opened from the Explore feed cards; reels).
    _section(id="places_home", endpoint="/api/public/places-home", group="charts", position=995, template="reels", present="fullscreen", requires=["kundli"], cache_ttl_seconds=604800, cache_version=4, title="Your Places", hidden=True, config={"reelLayout": "editorial", "axis": "vertical", "staticBg": True, "dim": 0.5, "blur": 22}),
    _section(id="solar_system", media="explore/solar_system", endpoint="/api/public/solar-system", group="charts", position=994, template="solar", present="fullscreen", requires=["kundli"], cache_ttl_seconds=86400, cache_version=7, title="The Solar System", hidden=True, config={"bg": "#000000", "card": {"blur": 3}, "wheel": {"cupLabel": "Field"}, "theme": {"styleOverrides": {"pw": {"card": {"backgroundColor": "#000000"}}}}}),
    # A PLACE FOR YOU — pick any location (Google autocomplete → lat/lng) and read how
    # that land would treat you, as reels. Mandala relocation, one place at a time.
    _section(id="place_match", media="explore/places_home", endpoint="/api/public/place-match", group="charts", position=996, template="input_reveal", present="fullscreen", requires=["kundli"], cache_ttl_seconds=604800, cache_version=2, title="A Place for You", subtitle="How any place on Earth would hold you.", hidden=True,
             config={"card": {"blur": 3, "w": 0.86, "ratio": 0.66},
                     "input": {"placeholder": "a city, country or place", "submitAs": "place", "keyboard": "default", "continue": "See how it holds you"},
                     "resultReels": True, "reels": {"reelLayout": "editorial", "axis": "vertical", "bg": "#0a0812", "loadingMinMs": 1500}}),
    # config.theme mirrors people._PROFILE_BTN_THEME so a profile opened NESTED from
    # this grid keeps the BIG circular compatibility button (nested opens inherit the
    # grid screen's active theme, not the profile's own). Keep in sync with people.py.
    _section(id="people_home", endpoint="/api/public/explore/people", group="charts", position=993, template="sdui", present="fullscreen", requires=["kundli"], cache_ttl_seconds=0, cache_version=4, title="Lives Already Lived", hidden=True,
             config={"theme": {"styleOverrides": {
                 "rl": {"btnRow": {"position": "absolute", "bottom": 56, "left": 0, "right": 0, "marginTop": 0, "flexWrap": "nowrap", "justifyContent": "center"},
                        "btn": {"width": 132, "height": 132, "borderRadius": 66, "paddingHorizontal": 0, "paddingVertical": 0},
                        "btnText": {"fontSize": 34, "fontWeight": "600", "letterSpacing": 0.5}},
                 "ch2": {"col": {"right": "10%"}}}}}),
    # Library — the Explore tab as an encyclopedia (books = systems, chapters =
    # features). Universal/unscoped so every book is browsable regardless of the
    # user's auto-selected system. Built by app/services/features/library.py.
    _section(id="library", endpoint="/api/public/library", group="charts", position=997, template="sdui", present="fullscreen", requires=[], cache_ttl_seconds=1800, cache_version=34, title="Library", hidden=True),

    # ── WESTERN (tropical) ────────────────────────────────────
    # system="western". Planet wheel's inner ring = the 12 houses (same ring as
    # the KP cusps). All backend; readings via the LLM.
    # Top deck (cover-flow, like Vedic): one section/endpoint per period.
    _section(id="western_today", endpoint="/api/public/western/today", group="daily", position=1, system="western", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=3600,   cache_version=6, title="Today",      subtitle="Something in today wants your attention.", media="time/western/today", config={"card": {"blur": 0}}),
    _section(id="western_week",  endpoint="/api/public/western/week",  group="daily", position=2, system="western", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=21600,  cache_version=6, title="This Week",  subtitle="A shift is already forming this week.", media="time/western/week", config={"card": {"blur": 0}}),
    _section(id="western_month", endpoint="/api/public/western/month", group="daily", position=3, system="western", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=86400,  cache_version=6, title="This Month", subtitle="This month is hiding a pattern.", media="time/western/month", config={"card": {"blur": 0}}),
    _section(id="western_year",  endpoint="/api/public/western/year",  group="daily", position=4, system="western", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=604800, cache_version=6, title="This Year",  subtitle="Your year has a secret shape.", media="time/western/year", config={"card": {"blur": 0}}),
    _section(id="western_periods", endpoint="/api/public/western/periods", group="daily", position=0, system="western", tile_type="card", cache_ttl_seconds=3600, cache_version=1, title="Today", visible=True),
    _section(id="western_wheels", endpoint="/api/public/time-wheels?system=western&only=day", group="daily", position=0, system="western", tile_type="card", cache_ttl_seconds=3600, cache_version=11, title="Time", visible=True),
    _section(id="western_planets", media="features/western_planets", endpoint="/api/public/western/planets", group="charts", position=21, system="western", feature_kind="chart", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=86400, title="The Planets", config={"card": {"blur": 3}, "wheel": {"cupLabel": "House"}}),
    _section(id="western_profections", endpoint="/api/public/western/profections", group="charts", position=22, system="western", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=604800, title="Profections", media="features/cn_balance", config={"card": {"blur": 3}, "reveal": "flip"}),
    _section(id="western_transits", endpoint="/api/public/western/transits", group="charts", position=23, system="western", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=21600, title="Transits", media="features/western/transit-grid", config={"card": {"blur": 3}, "reveal": "flip"}),
    _section(id="western_balance", endpoint="/api/public/western/balance", group="charts", position=24, system="western", tile_type="card", template="reels", present="fullscreen", cache_ttl_seconds=86400, title="Temperament", media="features/cn_relations", config={"axis": "vertical", "bg": "#0a0812", "dim": 0.5, "reelLayout": "editorial", "loadingMinMs": 1200}),
    _section(id="western_patterns", endpoint="/api/public/western/patterns", group="charts", position=25, system="western", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=604800, title="Aspects", media="features/western_aspects", config={"card": {"blur": 3}, "reveal": "beneath"}),
    _section(id="western_tensions", endpoint="/api/public/western/tensions", group="charts", position=26, system="western", tile_type="card", template="reels", present="fullscreen", cache_ttl_seconds=604800, title="Hard Aspects", media="features/cn_animals", config={"axis": "vertical", "bg": "#0a0812", "dim": 0.5, "reelLayout": "editorial", "loadingMinMs": 1200}),
    _section(id="western_electional", endpoint="/api/public/western/electional", group="charts", position=27, system="western", tile_type="card",
             template="form", present="fullscreen", cache_ttl_seconds=0, title="Electional", media="features/cn_animals", requires=["kundli"],
             config={"card": {"blur": 3}, 
                 "fields": [
                     {"kind": "text", "key": "occasion", "submitAs": "occasion", "label": "occasion", "placeholder": "e.g. launch, signing, date", "keyboard": "default"},
                     {"kind": "options", "key": "interval", "submitAs": "interval", "label": "within", "options": [
                         {"value": "month", "label": "Month"}, {"value": "quarter", "label": "Quarter"}, {"value": "year", "label": "Year"}]},
                 ],
                 "landing": {"endpoint": "/api/public/western/electional/today"},
                 "submit": "Find the day",
                 "result": {"template": "hdeck", "present": "card", "reveal": "flip", "revealOn": "center", "timing": {"flipAfterMs": 900}},
             }),
    _section(id="western_compat", endpoint="/api/public/western/compat", group="compatibility", position=13, system="western",
             feature_kind="compat", tile_type="hero", template="datetime", present="fullscreen", cache_ttl_seconds=0,
             requires=["kundli", "partner"], media="features/western_synastry", title="Synastry",
             config={"card": {"blur": 3}, 
                 "fields": ["date", "time", "place", "gender", "name"], "submitAs": "partner", "yearFrom": 1940,
                 "reveal": "pie", "dial": {"mode": "stack", "size": 300},
                 "timing": {"fillMs": 1800, "lingerMs": 3000, "readingFadeMs": 650},
                 "loadingMinMs": 2500,
                 "revelation": {"title": "Synastry", "body": "Where two charts meet — synastry aspects, element overlay."},
                 "genders": [{"value": "female", "media": "icons/gender_female"}, {"value": "male", "media": "icons/gender_male"}],
                 "titles": {"date+time": "Their birth date & time", "name+gender": "About them", "date": "Their birth date", "time": "Their birth time", "place": "Their birthplace", "gender": "Their gender", "name": "Their name"},
             }),

    # ── CHINESE (BaZi) ────────────────────────────────────────
    # All system="chinese". Wheels reuse the planet wheel; periods the rail; luck
    # the flip deck. Plus the existing Zoo / Five Elements / Four Pillars cards.
    # Top deck (cover-flow, like Vedic): one section/endpoint per period.
    _section(id="chinese_today", endpoint="/api/public/chinese/today", group="daily", position=1, system="chinese", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=3600, cache_version=6,   title="Today",      subtitle="Something in today wants your attention.", media="time/chinese/today", config={"card": {"blur": 0}}),
    _section(id="chinese_week",  endpoint="/api/public/chinese/week",  group="daily", position=2, system="chinese", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=21600, cache_version=6,  title="This Week",  subtitle="A shift is already forming this week.", media="time/chinese/week", config={"card": {"blur": 0}}),
    _section(id="chinese_month", endpoint="/api/public/chinese/month", group="daily", position=3, system="chinese", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=86400, cache_version=6,  title="This Month", subtitle="This month is hiding a pattern.", media="time/chinese/month", config={"card": {"blur": 0}}),
    _section(id="chinese_year",  endpoint="/api/public/chinese/year",  group="daily", position=4, system="chinese", tile_type="card", template="collage", present="fullscreen", cache_ttl_seconds=604800, cache_version=6, title="This Year",  subtitle="Your year has a secret shape.", media="time/chinese/year", config={"card": {"blur": 0}}),
    _section(id="chinese_periods", endpoint="/api/public/chinese/periods", group="daily", position=0, system="chinese", tile_type="card", cache_ttl_seconds=3600, cache_version=1, title="Today", visible=True),
    _section(id="chinese_wheels", endpoint="/api/public/time-wheels?system=chinese&only=day", group="daily", position=0, system="chinese", tile_type="card", cache_ttl_seconds=3600, cache_version=11, title="Time", visible=True),
    _section(id="chinese_animals", endpoint="/api/public/chinese/animals", group="charts", position=21, system="chinese", feature_kind="chart", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=86400, cache_version=5, title="Sheng Xiao", media="features/cn_animals", config={"wheel": {"personalColor": "#E0383B", "innerRing": False}, "card": {"blur": 3}}),
    _section(id="chinese_elements", endpoint="/api/public/chinese/elements", group="charts", position=22, system="chinese", feature_kind="chart", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=86400, cache_version=3, title="Wu Xing", media="features/cn_elements", config={"wheel": {"innerRing": False}, "card": {"blur": 3}}),
    _section(id="chinese_luck", endpoint="/api/public/chinese/luck", group="charts", position=23, system="chinese", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=604800, cache_version=3, title="Da Yun", media="features/cn_grid2", config={"reveal": "flip", "card": {"blur": 3}}),
    _section(id="chinese_overlay", endpoint="/api/public/chinese/overlay", group="charts", position=25, system="chinese", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=21600, cache_version=2, title="Liu Nian", media="features/cn_grid", config={"reveal": "flip"}),
    _section(id="chinese_relations", endpoint="/api/public/chinese/relations", group="charts", position=27, system="chinese", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=604800, cache_version=2, title="He & Chong", media="features/cn_relations", config={"reveal": "beneath", "card": {"blur": 3}}),
    _section(id="chinese_balance", endpoint="/api/public/chinese/balance", group="charts", position=26, system="chinese", tile_type="card", template="reels", present="fullscreen", cache_ttl_seconds=86400, title="Yong Shen", media="features/cn_balance", config={"axis": "vertical", "bg": "#0a0812", "dim": 0.5, "reelLayout": "editorial", "loadingMinMs": 1200}),
    _section(id="chinese_auspicious", endpoint="/api/public/chinese/auspicious", group="charts", position=24, system="chinese", tile_type="card",
             template="form", present="fullscreen", cache_ttl_seconds=0, title="Ze Ri", media="features/cn_auspicious", requires=["kundli"],
             config={
                 "card": {"blur": 3},
                 "fields": [
                     {"kind": "text", "key": "occasion", "submitAs": "occasion", "label": "occasion", "placeholder": "e.g. wedding, signing, move", "keyboard": "default"},
                     {"kind": "options", "key": "interval", "submitAs": "interval", "label": "within", "options": [
                         {"value": "month", "label": "Month"}, {"value": "quarter", "label": "Quarter"}, {"value": "year", "label": "Year"}]},
                 ],
                 "landing": {"endpoint": "/api/public/chinese/auspicious/today"},
                 "submit": "Find the day",
                 "result": {"template": "hdeck", "present": "card", "reveal": "flip", "revealOn": "center", "timing": {"flipAfterMs": 900}},
             }),
    _section(id="chinese_compat", endpoint="/api/public/chinese/compat", group="compatibility", position=12, system="chinese",
             feature_kind="compat", tile_type="hero", template="datetime", present="fullscreen", cache_ttl_seconds=0,
             requires=["kundli", "partner"], media="features/chinese_synastry", title="He Hun",
             config={
                 "card": {"blur": 3},
                 "fields": ["date", "time", "place", "gender", "name"], "submitAs": "partner", "yearFrom": 1940,
                 "reveal": "pie", "dial": {"mode": "stack", "size": 300},
                 "timing": {"fillMs": 1800, "lingerMs": 3000, "readingFadeMs": 650},
                 "loadingMinMs": 2500,
                 "revelation": {"title": "He Hun", "body": "Where two BaZi charts meet — Day Masters, animals, elements."},
                 "genders": [{"value": "female", "media": "icons/gender_female"}, {"value": "male", "media": "icons/gender_male"}],
                 "titles": {"date+time": "Their birth date & time", "name+gender": "About them", "date": "Their birth date", "time": "Their birth time", "place": "Their birthplace", "gender": "Their gender", "name": "Their name"},
             }),

    # Two cards (like Stories) that open OVER the blurred home (present="card") as a
    # horizontal hdeck: intro card → one card per currently-active item, time window
    # on top (card.number), meaning beneath. Data from yogas_transits endpoints.
    _section(id="yogas",    endpoint="/api/public/yogas",    group="charts", position=30, system="bphs", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=86400, cache_version=3, title="Yogas",    media="features/yogas",    config={"card": {"blur": 3}, "reveal": "beneath"}),
    _section(id="transits", endpoint="/api/public/transits", group="charts", position=31, system="bphs", tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=86400, cache_version=3, title="Gochara", media="features/gochara", config={"card": {"blur": 3}, "reveal": "beneath"}),

    # Two full-screen features. Dashas: hdeck flip deck (Maha→Prana lords as titles
    # → flip → meaning, reading beneath). Doshas: zig-zag collage of the doshas they
    # have (about → effect → remedy) or a 'lucky one' message if none.
    _section(id="dashas", endpoint="/api/public/dashas", group="charts", position=32, system="bphs", tile_type="card", template="hdeck",   present="fullscreen", cache_ttl_seconds=86400, cache_version=1, title="Dashas", media="features/dashas", config={"card": {"blur": 3}, "reveal": "flip"}),
    _section(id="doshas", endpoint="/api/public/doshas", group="charts", position=33, system="bphs", tile_type="card", template="reels", present="fullscreen", cache_ttl_seconds=86400, cache_version=3, title="Doshas", media="features/cn_relations", config={"axis": "vertical", "bg": "#0a0812", "dim": 0.5, "reelLayout": "editorial", "loadingMinMs": 1200}),
    _section(id="kp_house_clock", media="features/bhavas", endpoint="/api/public/kp-house-clock", group="charts", position=37, system="bphs", feature_kind="chart", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=86400, cache_version=8, title="Bhavas", config={"card": {"blur": 3}, "wheel": {"innerRing": False, "cupLabel": "House"}}),

    # Muhurta: generic `form` (occasion text + month/quarter/year scroller) with
    # today's panchanga + windows beneath; submit → find_muhurta → flip-deck of
    # auspicious windows (date+time front, why-auspicious on the auto-flip).
    _section(id="muhurta", endpoint="/api/public/muhurta", group="charts", position=34, system="bphs", tile_type="card",
             template="form", present="fullscreen", cache_ttl_seconds=0, title="Muhurta", media="features/cn_grid2",
             requires=["kundli"],
             config={"card": {"blur": 3},
                 "fields": [
                     {"kind": "text", "key": "occasion", "submitAs": "occasion", "label": "occasion", "placeholder": "meeting, mating, anything…", "keyboard": "default"},
                     {"kind": "options", "key": "interval", "submitAs": "interval", "label": "time", "options": [
                         {"value": "today", "label": "Today"}, {"value": "this_week", "label": "This Week"},
                         {"value": "this_month", "label": "This Month"}, {"value": "next_month", "label": "Next Month"},
                         {"value": "3_months", "label": "3 Months"}, {"value": "6_months", "label": "6 Months"},
                         {"value": "12_months", "label": "12 Months"}]},
                 ],
                 # Finder styling scoped to THIS feature (themed() styleOverrides, backend-only):
                 # bright card border + input underline, brighter labels, white submit + dark text.
                 "theme": {"styleOverrides": {"fm": {
                     "card": {"borderColor": "rgba(255,255,255,0.40)", "borderWidth": 1},
                     "input": {"borderBottomColor": "rgba(255,255,255,0.5)"},
                     "fieldLabel": {"color": "rgba(255,255,255,0.6)"},
                     "submit": {"backgroundColor": "#FFFFFF", "borderColor": "#FFFFFF"},
                     "submitText": {"color": "#0a0a0f"},
                 }}},
                 "landing": {"endpoint": "/api/public/muhurta/today"},
                 "submit": "Find the muhurta",
                 "result": {"template": "hdeck", "present": "card", "reveal": "flip", "revealOn": "center", "timing": {"flipAfterMs": 900}},
             }),

    # ── STORIES ───────────────────────────────────────────────
    _section(id="past_life", media="features/past_life",    endpoint="/api/public/past-life",    group="stories", position=10, tile_type="hero", template="reels", present="fullscreen", cache_ttl_seconds=604800, cache_version=7, title="Purva Janma", config={"card": {"blur": 3}, "axis": "vertical", "align": "bottom", "reelLayout": "chapter", "ground": "ink",
             # Widen the chapter reading column (default boxes text to ~half width).
             "theme": {"styleOverrides": {"ch2": {"col": {"right": "10%"}}}}}),
    _section(id="life_story", media="features/life_story",   endpoint="/api/public/life-story",   group="stories", position=20, tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=86400, cache_version=5, title="Life Story",
             config={"reveal": "beneath", "start": "current", "readingEndpoint": "/api/public/life-story/chapter",
                     # The chapter title already rides on the sticky deck card face; collapse the
                     # duplicate title (+ its rule) above the reading body via the hd styleOverrides
                     # (backend-only — no frontend change). The section titles inside still show.
                     "theme": {"styleOverrides": {"hd": {
                         "readTitle": {"fontSize": 0, "lineHeight": 0, "height": 0, "marginTop": 0, "marginBottom": 0},
                         "rule": {"height": 0, "width": 0, "marginVertical": 0, "opacity": 0},
                     }}},
                     "collapse": {"headerHeight": 0.5, "collapse": 0.54}, "card": {"image": "fill", "blur": 5, "bg": "#000000"}}),
    _section(id="the_zoo", media="features/the_zoo",      endpoint="/api/public/the-zoo",      group="stories", position=30, tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=31536000, cache_version=4, title="The Zoo",
             config={"reveal": "flip"}),
    _section(id="five_elements", media="features/five_elements", endpoint="/api/public/five-elements", group="stories", position=35, tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=2592000, cache_version=2, title="Five Elements",
             config={"reveal": "flip"}),
    _section(id="four_pillars", media="features/four_pillars", endpoint="/api/public/four-pillars", group="stories", position=40, tile_type="card", template="hdeck", present="fullscreen", cache_ttl_seconds=31536000, cache_version=3, title="Four Pillars",
             config={"reveal": "flip"}),
    # No `media` here, nor on vedic/western/chinese_periods or name_correction: a reading
    # card draws its media as a dark blurred ground, which the Day edition keeps dark
    # while the text turns to ink — black on black. None of those files exist anyway.
    # Give one a media only with a real file, and look at it in Day.
    _section(id="blunt_seer",   endpoint="/api/public/blunt-seer",   group="special", position=50, tile_type="card",   cache_ttl_seconds=0, config={"limit": {"count": 3, "per": "day"}}),

    # ── NUMEROLOGY ────────────────────────────────────────────
    _section(id="core_numbers", media="features/core_numbers",    endpoint="/api/public/core-numbers",    group="numerology", position=10, feature_kind="numerology", tile_type="card", template="numbers", present="fullscreen", cache_ttl_seconds=604800, cache_version=4, title="The Numbers"),
    # Per-system numerology — same engine, filtered to each tradition's numbers.
    _section(id="numbers_vedic", media="features/ank_jyotish",   endpoint="/api/public/core-numbers/vedic",   group="numerology", position=11, system="bphs",    feature_kind="numerology", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=604800, cache_version=6, title="Ank Jyotish", config={"card": {"blur": 3}, "wheel": {"personalColor": "#E0383B", "innerRing": False}}),
    _section(id="numbers_western", media="features/cn_relations", endpoint="/api/public/core-numbers/western", group="numerology", position=12, system="western", feature_kind="numerology", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=604800, cache_version=3, title="Arithmancy", config={"card": {"blur": 3}, "wheel": {"personalColor": "#E0383B", "innerRing": False}}),
    _section(id="numbers_chinese", endpoint="/api/public/core-numbers/chinese", group="numerology", position=13, system="chinese", feature_kind="numerology", tile_type="card", template="wheel", present="fullscreen", cache_ttl_seconds=604800, cache_version=4, title="Jiu Xing", media="features/cn_numbers", config={"card": {"blur": 3}, "wheel": {"personalColor": "#E0383B", "innerRing": False}}),
    _section(id="business_name",   endpoint="/api/public/business-name",   group="numerology", position=20, feature_kind="numerology", tile_type="card", template="input_reveal", present="fullscreen", media="features/business_name", cache_ttl_seconds=604800, cache_version=2,
             requires=["kundli", "business_name"], title="Business Name", subtitle="Is your brand's name working for you?",
             config={"card": {"blur": 3, "w": 0.86, "ratio": 0.66}, "input": {"placeholder": "business name", "submitAs": "business_name", "keyboard": "default", "continue": "Continue"},
                     "resultReels": True, "reels": {"reelLayout": "editorial", "axis": "vertical", "bg": "#0a0812", "loadingMinMs": 1500}}),
    # THE NAME — a two-card chooser (like Guna Milan): Vibration (your own name, no
    # input, opens as reels) + Compatibility (type another name → reading).
    _section(id="name", endpoint="/api/public/name-vibration", group="numerology", position=25,
             feature_kind="numerology", tile_type="card", template="chooser", present="fullscreen",
             media="cards/your_name", title="Your Name", subtitle="How your name resonates — and with whom.",
             config={"card": {"blur": 3},
                "cards": [
                    {"id": "name_vibration", "title": "Name Vibration", "media": "cards/your_name",
                     "endpoint": "/api/public/name-vibration", "template": "reels", "present": "fullscreen",
                     "config": {"axis": "vertical", "align": "center", "padBottom": 120, "reelLayout": "editorial"}},
                    {"id": "name_compat", "title": "Name Compatibility", "media": "features/compatibility",
                     "endpoint": "/api/public/name-compatibility", "template": "input_reveal", "present": "fullscreen",
                     "requires": ["kundli", "name"],
                     "config": {"card": {"blur": 3, "w": 0.86, "ratio": 0.66},
                                "input": {"placeholder": "their name", "submitAs": "name", "keyboard": "default", "continue": "Continue"},
                                "resultReels": True, "reels": {"reelLayout": "editorial", "axis": "vertical", "bg": "#0a0812", "loadingMinMs": 1500}}},
                ]}),
    _section(id="mobile_number",   endpoint="/api/public/mobile-number",   group="numerology", position=30, feature_kind="numerology", tile_type="card", template="input_reveal", present="fullscreen", media="features/mobile_number", cache_ttl_seconds=604800, cache_version=2, subtitle="Do your digits add up for you?",
             requires=["kundli", "mobile"], title="Mobile Number",
             config={"card": {"blur": 3, "w": 0.86, "ratio": 0.66}, "input": {"placeholder": "mobile number", "submitAs": "mobile", "keyboard": "number-pad", "continue": "Continue"},
                     "resultReels": True, "reels": {"reelLayout": "editorial", "axis": "vertical", "bg": "#0a0812", "loadingMinMs": 1500}}),
    _section(id="angel_numbers", endpoint="/api/public/angel-number", group="numerology", position=35, feature_kind="numerology", tile_type="card", template="input_reveal", present="fullscreen", media="features/angel_numbers", cache_ttl_seconds=604800, cache_version=1, subtitle="The number you keep seeing.",
             requires=[], title="Angel Numbers",
             config={"card": {"blur": 3, "w": 0.86, "ratio": 0.66}, "input": {"placeholder": "the number you keep seeing", "submitAs": "number", "keyboard": "number-pad", "continue": "Reveal"},
                     "resultReels": True, "reels": {"reelLayout": "editorial", "axis": "vertical", "bg": "#0a0812", "loadingMinMs": 1200}}),
    _section(id="lo_shu_grid", endpoint="/api/public/lo-shu-grid", group="numerology", position=15, feature_kind="numerology", tile_type="card", template="reels", present="fullscreen", media="features/core_numbers", cache_ttl_seconds=604800, cache_version=1, title="Lo Shu Grid", subtitle="Your birth numbers on the ancient square.",
             requires=["kundli"], config={"reelLayout": "editorial", "axis": "vertical", "staticBg": True, "dim": 0.5, "blur": 22}),
    _section(id="gematria", endpoint="/api/public/gematria", group="numerology", position=36, feature_kind="numerology", tile_type="card", template="input_reveal", present="fullscreen", media="features/core_numbers", cache_ttl_seconds=604800, cache_version=1, subtitle="A Hebrew word's sacred number.",
             requires=[], title="Gematria",
             config={"card": {"blur": 3, "w": 0.86, "ratio": 0.66}, "input": {"placeholder": "\u05d0 Hebrew word", "submitAs": "word", "keyboard": "default", "continue": "Reveal"},
                     "resultReels": True, "reels": {"reelLayout": "editorial", "axis": "vertical", "bg": "#0a0812", "loadingMinMs": 1200}}),
    _section(id="name_correction", endpoint="/api/public/name-correction", group="special", position=60, feature_kind="numerology", tile_type="card", cache_ttl_seconds=604800, cache_version=1, title="Your Name"),
    # Content provider for the numerology rail — its endpoint returns LLM curiosity
    # cards (title + curiosity + cta + target) for Mobile/Business/Name. Not a tile.
    # Content provider for the numerology rail. MUST stay visible=True or the catalog
    # drops it from `sections` and the rail's `id:numerology_cards` resolves to nothing
    # (→ no rail). `hidden` keeps it out of Explore while still resolvable by id.
    _section(id="numerology_cards", endpoint="/api/public/numerology-cards", group="numerology", position=14, feature_kind="numerology", tile_type="card", cache_ttl_seconds=604800, cache_version=1),

    # ── COMPATIBILITY ─────────────────────────────────────────
    # One feature. The birth-input screen collects the full partner birth (date,
    # time, place, gender, name — all required) and posts it under `partner`.
    # The backend computes all five systems and the LLM writes ONE synthesized
    # reading of what they indicate overall — never naming the systems.
    # Reading someone who is NOT the user. The chat can only ever see the seeker's
    # chart, so "what will my husband do next year" had no answer and nowhere to put
    # his details. This is the somewhere: the picker takes one person's birth data,
    # the screen shows their raw placements, and the chat embedded beneath it is bound
    # to THEIR kundli, not the seeker's.
    _section(id="person_reading", endpoint="/api/public/person-reading", group="compatibility", position=4,
             feature_kind="compat", tile_type="card", template="datetime", present="fullscreen",
             cache_ttl_seconds=0, requires=["person"], media="features/vedic_planets", title="Read Someone",
             config={"card": {"blur": 3},
                 "fields": ["date", "time", "place", "gender", "name"], "submitAs": "person", "yearFrom": 1920,
                 "loadingMinMs": 1800,
                 "revelation": {"title": "Their Sky", "body": "Their chart, computed — then ask it anything."},
                 "genders": [{"value": "female", "media": "icons/gender_female"}, {"value": "male", "media": "icons/gender_male"}],
                 "titles": {"date+time": "Their birth date & time", "name+gender": "About them", "date": "Their birth date", "time": "Their birth time", "place": "Their birthplace", "gender": "Their gender", "name": "Their name"},
             }),
    _section(id="compatibility_hook", endpoint="/api/public/compatibility-hook", group="compatibility", position=5, feature_kind="compat", tile_type="banner", cache_ttl_seconds=86400, visible=False),

    # Compatibility = a chooser of TWO cards (General + Ashtakoota). Both collect
    # the SAME partner input, hit DIFFERENT endpoints, and reveal the same way:
    # full-screen black loading media (>=2.5s) → pie dial fills + lingers ALONE →
    # the reading fades in beneath it (dial mode "stack"). All timings/media here.
    _section(
        id="compatibility", endpoint="/api/public/compatibility-deep",
        group="compatibility", position=10, feature_kind="compat", tile_type="hero",
        cache_ttl_seconds=0, system="bphs", template="chooser", present="fullscreen",
        requires=["kundli", "partner"], media="features/guna_milan",
        title="Guna Milan",
        config={"card": {"blur": 3}, 
            "cards": [
                {
                    "id": "compat_general", "title": "General", "media": "features/compatibility",
                    "endpoint": "/api/public/compatibility-deep", "template": "datetime",
                    "present": "fullscreen", "requires": ["kundli", "partner"],
                    "config": {
                        "fields": ["date", "time", "place", "gender", "name"],
                        "submitAs": "partner", "yearFrom": 1940,
                        "reveal": "pie", "dial": {"mode": "stack", "size": 300},
                        "timing": {"fillMs": 1800, "lingerMs": 3000, "readingFadeMs": 650},
                        "loadingBg": "#000000", "loadingMinMs": 2500,
                        "revelation": {"title": "General", "body": "Where two charts meet across every ancient science of union."},
                        "genders": [{"value": "female", "media": "icons/gender_female"}, {"value": "male", "media": "icons/gender_male"}],
                        "titles": {"date+time": "Their birth date & time", "name+gender": "About them", "date": "Their birth date", "time": "Their birth time", "place": "Their birthplace", "gender": "Their gender", "name": "Their name"},
                    },
                },
                {
                    "id": "compat_ashtakoota", "title": "Ashtakoota", "media": "features/ashtakoota",
                    "endpoint": "/api/public/ashtakoota", "template": "datetime",
                    "present": "fullscreen", "requires": ["kundli", "partner"],
                    "config": {
                        "fields": ["date", "time", "place", "gender", "name"],
                        "submitAs": "partner", "yearFrom": 1940,
                        "reveal": "pie", "dial": {"mode": "stack", "size": 300},
                        "timing": {"fillMs": 1800, "lingerMs": 3000, "readingFadeMs": 650},
                        "loadingBg": "#000000", "loadingMinMs": 2500,
                        "revelation": {"title": "Ashtakoota", "body": "The Vedic 36-point system — the classical measure of a union."},
                        "genders": [{"value": "female", "media": "icons/gender_female"}, {"value": "male", "media": "icons/gender_male"}],
                        "titles": {"date+time": "Their birth date & time", "name+gender": "About them", "date": "Their birth date", "time": "Their birth time", "place": "Their birthplace", "gender": "Their gender", "name": "Their name"},
                    },
                },
            ],
        },
    ),

    # ── SPECIAL ───────────────────────────────────────────────
    _section(id="kp_horary", endpoint="/api/public/kp-horary", group="special", position=10, feature_kind="special", tile_type="card",
             template="horary", media="features/prashna", present="fullscreen", cache_ttl_seconds=0, requires=["kundli"], title="Prashna",
             config={
                 "fields": ["number"],
                 "number": {"min": 1, "max": 249},
                 "reveal": "flip",
                 "copy": {"heading": "think of a number", "range": "1 — 249", "continue": "Continue", "tap": "tap to reveal"},
                 "limit": {"count": 1, "per": "day",
                           "lockout_example": "See you again when the stars align.",
                           "lockout_desc": "the once-a-day number oracle"},
                 # After the flip: PURE-BLACK back face, the chosen number reads BIG as
                 # the title, and the reading is pushed well below it (backend-only via
                 # themed styleOverrides — RN merges each override over the base style).
                 "theme": {"styleOverrides": {"fr": {
                     "back": {"backgroundColor": "#000000"},
                     "numSmall": {"fontSize": 80, "marginBottom": 56},
                     "backScroll": {"paddingTop": 88},
                 }}},
             }),

    # ═════════════════════════════════════════════════════════
    # CONTENT TILES — backend-pushed cards, no endpoint
    # ═════════════════════════════════════════════════════════
    #
    # Add these freely. Examples below are commented out.
    # Set visible=False to hide without removing.

    _section(
        id="welcome_card",
        group="special", position=1,
        feature_kind="content", tile_type="banner",
        media="cards/welcome",
        content={
            "title": "Welcome",
            "body": "Your charts have been computed. Begin with Today.",
            "action_label": "Read today",
            "action_type": "open_section",
            "action_target": "today_deep",
        },
    ),

    # _section(
    #     id="diwali_muhurat_2026",
    #     group="daily", position=2,
    #     feature_kind="content", tile_type="banner",
    #     start_date="2026-10-25T00:00:00Z",
    #     end_date="2026-11-05T23:59:59Z",
    #     content={
    #         "title": "Diwali Muhurat",
    #         "body": "Lakshmi puja window: see today's panchanga",
    #         "image_url": None,
    #         "action_label": "View timings",
    #         "action_type": "open_section",
    #         "action_target": "panchanga",
    #     },
    # ),

    # _section(
    #     id="mercury_retro_alert",
    #     group="daily", position=3,
    #     feature_kind="content", tile_type="small",
    #     start_date="2026-05-10T00:00:00Z",
    #     end_date="2026-06-03T00:00:00Z",
    #     content={
    #         "title": "Mercury retrograde begins",
    #         "body": "Slow down communication; review before sending.",
    #     },
    # ),
]


# Which divination system each section belongs to (None = cross-system).
# Edit freely — drives the Explore filter. New per-system features just set
# `system=` directly in their _section(...) call instead.
_SYSTEM_BY_ID = {
    "today_deep": None,       "the_word": "bphs",
    "time_reading": "bphs",   "panchanga": "bphs",
    "core_chart": "bphs",
    "past_life": "bphs",      "life_story": "bphs",
    "the_zoo": "chinese",     "four_pillars": "chinese", "five_elements": "chinese", "blunt_seer": None,
    "core_numbers": "num",    # legacy combined deck (not shown in any home now)
    # Numerology sub-features sit beneath the number wheel in EVERY system's home,
    # so they're cross-system (None) — not pinned to Vedic.
    "business_name": None,  "mobile_number": None,  "name": None,
    "name_correction": "bphs",
    "compatibility_hook": None,
    "kp_horary": "bphs",
    "welcome_card": None,
}
for _s in SECTIONS:
    if _s["id"] in _SYSTEM_BY_ID:
        _s["system"] = _SYSTEM_BY_ID[_s["id"]]

# Content-provider sections: visible (so the catalog keeps them + the home blocks can
# resolve them by id) but `hidden` so they never render as a tile in Explore.
for _s in SECTIONS:
    if _s["id"] in ("numerology_cards",):
        _s["hidden"] = True


# Display title + subtitle per section. Backend-controlled (localize later via
# the strings system). The app renders these; it only falls back to the id if
# a title is missing here.
_TITLES = {
    "today_deep":        ("Today", "what the day holds"),
    "the_word":          ("The Word", "one question, one answer"),
    "time_reading":      ("Your Time", "the quality of the hour"),
    "panchanga":         ("Panchanga", "the five limbs of today"),
    "core_chart":        ("The Planet", "every planet, in you"),
    "past_life":         ("Past Life", "who you were before"),
    "life_story":        ("Life Story", "every chapter, birth to beyond"),
    "the_zoo":           ("The Zoo", "your four hidden animals"),
    "four_pillars":      ("Four Pillars", "Kama · Karma · Dharma · Moksha"),
    "blunt_seer":        ("The Blunt Seer", "tap if you dare"),
    "core_numbers":      ("Your Numbers", "the figures that define you"),
    "business_name":     ("Business Name", "check your brand's vibration"),
    "mobile_number":     ("Mobile Number", "dial your digits"),
    "name_correction":   ("Name Correction", "is your name working for you?"),
    "compatibility_hook":("Compatibility", "how you meet another"),
    "kp_horary":         ("The Moment", "ask once"),
    "welcome_card":      ("Welcome", "begin here"),
}
for _s in SECTIONS:
    if _s["id"] in _TITLES and not _s.get("title"):
        _s["title"], _s["subtitle"] = _TITLES[_s["id"]]


# --- plutto: clear grid subtext ---
for _s in SECTIONS:
    if _s.get("id") in ("kp_horary", "core_chart", "past_life"):
        _s["subtitle"] = None


# --- plutto: per-system TTS voice ---
_SYS_VOICE = {"bphs": "onyx", "kp": "echo", "western": "shimmer", "chinese": "fable", "num": "alloy", "mandala": "nova"}
for _s in SYSTEMS:
    _s.setdefault("voice", _SYS_VOICE.get(_s.get("id"), "nova"))


# --- plutto: per-system voice + character (OpenAI gpt-4o-mini-tts) ---
VOICE_MAP = {
    "bphs":    {"voice": "onyx",    "style": "Speak as an ancient Vedic sage: grave, measured, reverent and unhurried, with warmth beneath the gravitas."},
    "kp":      {"voice": "echo",    "style": "Speak precisely and analytically: crisp, confident, a master technician revealing exact timing."},
    "western": {"voice": "shimmer", "style": "Speak warmly and fluidly: modern, intimate, psychologically insightful."},
    "chinese": {"voice": "fable",   "style": "Speak calmly and poetically: elemental and balanced, like flowing water and still mountains."},
    "num":     {"voice": "alloy",   "style": "Speak clearly and rhythmically: exact, almost musical, each number deliberate."},
    "mandala": {"voice": "nova",    "style": "Speak softly and ethereally: dreamlike, spacious, cosmic."},
    "plutto":  {"voice": "nova",    "style": "Speak as Plutto, the meta-oracle who sees every tradition at once: calm, wise, intimate, weaving all systems into one clear voice."},
}
for _s in SYSTEMS:
    _vd = VOICE_MAP.get(_s.get("id")) or {}
    _s.setdefault("voice", _vd.get("voice", "nova"))
    _s.setdefault("voice_style", _vd.get("style", "Speak as a calm, wise, intimate oracle: warm and grounded."))


# --- plutto: home = Vedic time-rails on top, then the composed lower part ---
# The old feed deck is gone; the four time-rails lead (Today / This Week / This
# Month / This Year, read on the Vedic calendar, rendered inline). Everything
# below is the former lower part, shifted down unchanged.
# Circular home (all systems share one rhythm): the wheels + topics lead, then
# the features sit in round tiles — single centred discs, side-by-side pairs, and
# horizontal-scroll rows under a traditional group title (translated per language).
#   options.shape:'circle'  → round tile + title beneath
#   options.scroll:'horizontal' → a scrolling row of tiles (under a group title)
#   options.align:'center'  → a centred single tile / side-by-side pair
#   options.size            → tile diameter (px)
# THE THREAD SPINE — every feature is its OWN row: one circular tile, centred,
# with the connective thread strand dropped between the tiles so the page reads as
# one connected flow (beads on a thread, like the topics spine / Prashna). Built
# from SHIPPED renderers only — a single-tile `grid` per feature + a `media` strand
# between each — so it's a backend-only change (no app release). Swap the strand
# once via HOME_THREAD_MEDIA; tune tile size / strand size in _spine().
HOME_THREAD_MEDIA = "home/thread"   # the connective strand (static/home/thread.*)


# The app's home blocks carry a 36px bottom margin; a strand with gap=-_BLOCK_MB
# (top) and gapBottom=0 cancels that margin so the strand TOUCHES the tile above
# and below — its height then just sets the spacing. Tied to the app's t.block.
_BLOCK_MB = 36


def _spine(prefix: str, ids: List[str], size: int = 150,
           strand_w: int = 70, strand_h: int = 120, lead_h: int = 90,
           overlap: int = 10) -> List[Dict]:
    """One feature per row, centred, joined by the thread strand. The strand JUST
    TOUCHES each disc — no overlap — so the circular tiles are never clipped:
    `gap = -_BLOCK_MB` cancels the upper tile's bottom margin (strand top meets the
    tile bottom exactly) and `gapBottom = 0` sits the strand flush against the next
    tile's top. The visible gap between two tiles therefore equals the strand height,
    which the thread media fills exactly. `lead_h` is a shorter leading strand from
    topics to the first tile. (`overlap` retained for callers but no longer used.)"""
    def _strand(i, h):
        return {"id": f"{prefix}_t{i}", "type": "media",
                "options": {"media": HOME_THREAD_MEDIA, "width": strand_w, "height": h,
                            "align": "center", "resizeMode": "cover",
                            # Tuck the strand a few px UNDER each disc on both ends so it
                            # always TOUCHES — top cancels the tile's 36px bottom margin
                            # (+10 overlap), bottom pulls the next tile up 10px over the
                            # strand's end. The tiles (circular, transparent corners) draw
                            # over the small overlap, so nothing is clipped.
                            "gap": -(_BLOCK_MB + 10), "gapBottom": -10,
                            # overflow visible keeps the shifted strand from being clipped.
                            "blockStyle": {"overflow": "visible"}}}
    blocks: List[Dict] = []
    if lead_h:
        blocks.append(_strand("lead", lead_h))
    n = len(ids)
    for i, fid in enumerate(ids):
        blocks.append({"id": f"{prefix}_{fid}", "type": "grid", "source": f"id:{fid}",
                       "options": {"shape": "circle", "align": "center", "size": size,
                                   "titleSide": "left" if i % 2 == 0 else "right"}})
        if i < n - 1:
            blocks.append(_strand(i, strand_h))
    return blocks


def _thread(sid: str, h: int = 140, w: int = 70) -> Dict:
    """A standalone thread strand block (continues the spine THROUGH the concept
    tiles + rails). The block ABOVE a _thread is a concept tile + its card RAIL — a
    rectangular strip, not a transparent disc — so the strand's TOP must JUST TOUCH
    the rail's bottom edge (gap = -_BLOCK_MB cancels the block's 36px margin exactly,
    no overlap that would poke up into the rail). Its BOTTOM still tucks 10px under the
    next circular tile (gapBottom = -10), whose transparent corners draw over the end."""
    return {"id": sid, "type": "media",
            "options": {"media": HOME_THREAD_MEDIA, "width": w, "height": h,
                        "align": "center", "resizeMode": "cover",
                        "gap": -_BLOCK_MB, "gapBottom": -10,
                        "blockStyle": {"overflow": "visible"}}}


# ── Concept EDUCATION — the tap-to-open info reels TEACH the topic itself (what a
# yoga / dosha / transit IS and why it matters), NOT the user's personal reading.
# Authored here as ready reel PAGES [{title, body}, …] so the whole thing — content
# AND the reels structure — is backend-driven; the app only renders them.
CONCEPT_EDU: Dict[str, List[Dict]] = {
    "yogas": [
        {"title": "What a Yoga Is", "body": "A yoga is a special meeting of planets in your chart — when certain planets sit together, or reach each other across the houses, they fuse into a single force with a character all its own. It is not one planet acting alone, but a combination that behaves like a new ingredient in the recipe of a life."},
        {"title": "Why They Matter", "body": "Yogas are the signatures of a chart. Some lift you toward fortune, recognition or wisdom; others describe the knots you came to untie. They show where your gifts concentrate and where life asks the most of you — the deep grammar beneath your whole story."},
    ],
    "transits": [
        {"title": "What Gochara Is", "body": "Gochara is the living sky — where the planets are actually travelling right now, and how they touch the fixed chart you were born with as they pass overhead. Your birth chart is the stage; the moving planets are the actors who walk on and off it, hour by hour, year by year."},
        {"title": "Why It Matters", "body": "A transit is a moving planet lighting up one area of your chart, opening a window of time when a theme grows loud — a push in work, a test in love, a season of rest. Transits are how a timeless map turns into timing: not what you are, but what is moving through you now."},
    ],
    "dashas": [
        {"title": "What a Dasha Is", "body": "Life does not unfold evenly — it moves in long planetary chapters called dashas. The Vimshottari system divides a lifetime into periods, each ruled by one planet for a stretch of years, with smaller sub-periods nested inside like chapters within a book."},
        {"title": "Why It Matters", "body": "The planet ruling your current dasha colours those years — its nature and placement set the weather of the era you are living. Two people the same age can be in utterly different seasons of life; the dasha is why. It is the clock behind the chart."},
    ],
    "doshas": [
        {"title": "What a Dosha Is", "body": "A dosha is a knot in the chart — a placement that pulls against ease in one area of life, whether marriage, health, temperament or fortune. It is not a curse or a verdict; it is a stress line, a place dealt a harder hand that asks for conscious handling."},
        {"title": "Why It Matters", "body": "Naming a dosha is the first step to working WITH it instead of being blindsided by it. Every dosha has its timing, its remedies, and often a hidden gift — the very friction that, once understood, becomes strength."},
    ],
    "chinese_luck": [
        {"title": "What Luck Pillars Are", "body": "In BaZi, life moves in ten-year luck pillars — Dayun — great cycles that overlay your birth chart and shift the elemental weather every decade. If your birth chart is the seed, the luck pillars are the seasons that seed passes through as it grows."},
        {"title": "Why They Matter", "body": "Each pillar adds a new element into the mix, strengthening some forces and clashing with others — turning a decade into a rise, a struggle, a harvest or a turning point. Your pillars show the shape of the road ahead: when to build, when to hold, when to let go."},
    ],
    "chinese_overlay": [
        {"title": "What the Overlay Is", "body": "The overlay is the current year meeting your chart — how this year's animal and element interact with the elements you were born under. Every year carries its own Qi, and it either supports, drains or challenges your native balance."},
        {"title": "Why It Matters", "body": "The same year that lifts one person can test another — it depends entirely on how the year's energy meets yours. The overlay shows where this year flows with you and where it asks for care, so you can move with the season rather than against it."},
    ],
    "chinese_relations": [
        {"title": "Harmonies & Clashes", "body": "In Chinese astrology the animals and elements form harmonies (He) and clashes (Chong). Some combinations complete and support each other like well-matched partners; others grind, generating friction and change. These bonds run beneath every relationship and every year."},
        {"title": "Why It Matters", "body": "Your chart's harmonies show where you find ease, allies and natural flow; its clashes show where growth comes through tension. They explain why some people and some times feel effortless while others demand work — and how to make the most of both."},
    ],
    "western_profections": [
        {"title": "What Profection Is", "body": "Annual profection is an ancient timing technique: each year of life advances one house around the chart, and the planet ruling that house becomes the 'time-lord' of your year — the ruler and theme of the twelve months ahead."},
        {"title": "Why It Matters", "body": "Profection tells you which part of your chart is switched on this year — which planet holds the keys, which house of life takes the stage. It turns your birth chart into a calendar, pointing to the theme you're being asked to live out right now."},
    ],
    "western_transits": [
        {"title": "What a Transit Is", "body": "A transit is a planet in today's sky forming an angle to a planet in your birth chart — the moving heavens touching your fixed potential. Your natal chart is the instrument; the transits are the hands that play it, sounding different notes as they pass."},
        {"title": "Why It Matters", "body": "Transits are the timing behind the chart — they mark when a theme awakens: a breakthrough, a pressure, a meeting, a mood. Slow outer-planet transits shape whole years of growth; faster ones set the tone of a week. They are how the sky keeps time with your life."},
    ],
    "western_patterns": [
        {"title": "What Aspects Are", "body": "Aspects are the geometric angles between planets — conjunction, sextile, square, trine, opposition — the conversations your planets hold with one another. Two planets in easy angle cooperate; in hard angle they challenge; that dialogue is the inner dynamic of a chart."},
        {"title": "Why They Matter", "body": "Your aspect patterns show how the different parts of you work together or pull apart — where talent flows freely and where growth comes through friction. They are the wiring diagram of your temperament, the reason your gifts and struggles are shaped the way they are."},
    ],
}


# The label on the "explore your rails" button that rides the bottom of every
# info-reel slide — tapping it opens the live rail as a Pinterest-style board.
_RAILS_LABEL: Dict[str, str] = {
    "yogas": "Explore your yogas",
    "transits": "Explore your transits",
    "dashas": "Explore your dashās",
    "doshas": "Explore your doshas",
    "chinese_luck": "Explore your luck pillars",
    "chinese_overlay": "Explore your overlays",
    "chinese_relations": "Explore your relations",
    "western_profections": "Explore your years",
    "western_transits": "Explore your transits",
    "western_patterns": "Explore your aspects",
}


def _concept(cid: str, source: str, side: str = "left", **extra) -> Dict:
    """A concept tile whose tap-to-open info reels TEACH the topic (CONCEPT_EDU).
    Every info-reel slide carries an "explore your rails" button; tapping it opens
    the active components (the live rail) as a Pinterest-style board — the client
    builds the board from the per-user rail, the backend authors the label + copy."""
    key = source.replace("id:", "")
    opts = {"titleSide": side, "infoMedia": True}
    if key in CONCEPT_EDU:
        opts["infoPages"] = CONCEPT_EDU[key]
    # railsButton → the frontend puts a ghost button on each education slide that
    # opens the concept's active components as a masonry board (more randomness =
    # the shuffle happens client-side). Backend controls the label + on/off.
    opts["railsButton"] = {"label": _RAILS_LABEL.get(key, "Explore your rails")}
    opts.update(extra)
    return {"id": cid, "type": "concept", "source": source, "options": opts}


# HOME now carries ONLY the timing wheels (the "top timing thing"). Every other
# concept has been SHIFTED — not removed — onto Explore below.
# Beneath the timing layer (with a generous gap): a quiet invitation into the
# Explore library. Pure SDUI home block — a line about what Plutto does (reads the
# patterns of your life across the ancient systems) and a button that switches to
# the Explore tab. Shared by every system's HOME.
_EXPLORE_CTA = {
    "id": "explore_cta",
    "type": "sdui",
    # THE LAST PAGE OF TODAY'S ISSUE, turning to the features (the Explore tab): the
    # plate, a hairline, a mono kicker, a Bodoni headline and the way on in mono
    # capitals — set like explore_feed's features. Words are `label` nodes (the app
    # Title-Cases text/heading); nothing sits on the photograph, so the paper edition
    # turns every word. The whole page switches to the Explore tab.
    "options": {"tree": [
        {"type": "box",
         "action": {"kind": "nav", "nav": "tab", "arg": "explore"},
         "style": {"marginTop": 34, "marginBottom": 40},
         "children": [
             {"type": "image", "src": "home/explore", "props": {"fit": "cover"},
              "style": {"width": "100%", "height": 220}},
             {"type": "box", "style": {"paddingHorizontal": 22, "paddingTop": 16}, "children": [
                 {"type": "box", "style": {"height": 1, "backgroundColor": "rgba(245,238,222,0.9)", "marginBottom": 12}},
                 {"type": "label", "text": "Continued in the features", "props": {"lines": 1},
                  "style": {"fontFamily": "PluttoMono", "fontSize": 9.5, "letterSpacing": 2.4,
                            "textTransform": "uppercase", "color": "rgba(245,238,222,0.55)"}},
                 {"type": "box", "style": {"marginTop": 8}, "children": [
                     {"type": "label", "text": "Cause and effect", "props": {"lines": 2},
                      "style": {"fontFamily": "$serifBold", "fontSize": 34, "lineHeight": 38, "letterSpacing": -0.3,
                                "textTransform": "none", "color": "rgba(245,238,222,0.98)"}}]},
                 {"type": "row", "style": {"alignItems": "center", "marginTop": 16, "paddingTop": 12,
                                           "borderTopWidth": 1, "borderTopColor": "rgba(245,238,222,0.9)"},
                  "children": [
                      {"type": "label", "text": "Turn the page", "props": {"lines": 1},
                       "style": {"fontFamily": "PluttoMono", "fontSize": 10.5, "letterSpacing": 2.4,
                                 "textTransform": "uppercase", "color": "rgba(245,238,222,0.96)"}},
                      {"type": "box", "style": {"flex": 1}},
                      {"type": "label", "text": "→", "props": {"lines": 1},
                       "style": {"fontFamily": "PluttoMono", "fontSize": 16, "textTransform": "none",
                                 "color": "rgba(245,238,222,0.96)"}}]},
             ]},
         ]},
    ]},
}


# The voice layer's Home block (talks_back.py): today's line, the dead hour, what is
# coming, the shells, the wrong number. Above the wheels in every system's Home.
# Remove this one entry to take the whole layer off Home; no release.
# It is built like the Explore cards (black-and-white photographs, words set on them)
# and runs edge to edge; its own text carries the 24px gutter. In the reader's language.
_TALK_HOME = {"id": "talk_home", "type": "sdui", "source": "id:talk_home", "options": {"style": {"paddingHorizontal": 0, "marginTop": 0, "marginBottom": 0}}}

HOME = [
    _TALK_HOME,
    {"id": "vedic_time", "type": "timewheels", "source": "id:vedic_wheels"},
    _EXPLORE_CTA,
]


# EXPLORE — everything that used to sit on Home, organised, plus the people /
# legends feed kept at the very bottom (the `sdui` block). Nothing was killed;
# the whole feature spine simply moved here.
EXPLORE = [
    # (The globe is NOT here — it lives in EXPLORE_FEED_BLOCKS, the list that is
    # actually served. This composition is legacy and reaches no device.)
    # Life-area topic cards (Desire/Career/Sex/Money) — already a thread spine.
    {"id": "topics", "type": "sdui", "source": "id:topics_screen", "options": {"style": {"marginTop": -56}}},
    # Every Vedic feature, one per row, centred, on the thread — Prashna → the
    # working chart → Karma & Phala → Muhurta → Anka, in order.
    *_spine("v", ["kp_horary", "core_chart", "kp_house_clock"]),
    # Yogas / Gochara / Dashas / Doshas — each a circular concept tile (centred on the
    # thread, like the other tiles): tap reveals an inline "what is this" info card,
    # and the currently-active components sit beneath as a horizontal card rail, each
    # opening its full reading as reels. Thread strands run BETWEEN them so the rail
    # connects down to the next tile (one continuous flow).
    _thread("v_cy", 120),
    _concept("concept_yogas", "id:yogas", "left"),
    _thread("v_cy0", 120),
    _concept("concept_transits", "id:transits", "right"),
    _thread("v_cy1", 120),
    _concept("concept_dashas", "id:dashas", "left"),
    _thread("v_cy2", 120),
    _concept("concept_doshas", "id:doshas", "right"),
    _thread("v_cy3", 120),
    *_spine("v", ["past_life", "life_story", "muhurta", "compatibility", "numbers_vedic"], lead_h=0),
    # Numerology sub-features beneath the number wheel — backend curiosity cards
    # (FeatureRail). A strand connects the wheel down to the rail.
    _thread("v_num", 120),
    {"id": "numerology_rail_v", "type": "featurerail", "source": "id:numerology_cards", "options": {}},
    # The people / legends feed — SHIFTED to the foot of Explore, not removed. This
    # sdui block fetches /api/public/explore per-user and renders it inline.
    {"id": "explore_people", "type": "sdui", "source": "id:explore_feed", "options": {}},
]


# --- plutto: per-system HOME (timing wheels only) + per-system EXPLORE. HOME is
# the default (Vedic / unscoped); a system listed here gets its own composition.
# get_catalog picks by active system, then scope-filters as usual. Pure backend.
HOME_CHINESE: List[Dict] = [
    _TALK_HOME,
    {"id": "cn_time", "type": "timewheels", "source": "id:chinese_wheels"},
    _EXPLORE_CTA,
]
EXPLORE_CHINESE: List[Dict] = [
    {"id": "topics", "type": "sdui", "source": "id:topics_screen", "options": {"style": {"marginTop": -56}}},
    # Every BaZi feature, one per row, centred, on the thread — Ben Ming → Yun Shi
    # → He Hun, in order.
    *_spine("cn", ["chinese_animals", "chinese_elements"]),
    # Concept tiles (tap = info, active components beneath as a rail → reels). These
    # hdeck features ship a plain card list; the app derives the rail from it.
    _thread("cn_c0", 120),
    _concept("concept_cn_luck", "id:chinese_luck", "left"),
    _thread("cn_ov", 120),
    _concept("concept_cn_overlay", "id:chinese_overlay", "right"),
    _thread("cn_c1", 120),
    _concept("concept_cn_rel", "id:chinese_relations", "left"),
    _thread("cn_c2", 120),
    *_spine("cn", ["chinese_balance", "chinese_auspicious", "chinese_compat", "numbers_chinese"], lead_h=0),
    _thread("cn_num", 120),
    {"id": "numerology_rail_cn", "type": "featurerail", "source": "id:numerology_cards", "options": {}},
    {"id": "explore_people", "type": "sdui", "source": "id:explore_feed", "options": {}},
]

HOME_WESTERN: List[Dict] = [
    _TALK_HOME,
    {"id": "w_time", "type": "timewheels", "source": "id:western_wheels"},
    _EXPLORE_CTA,
]
EXPLORE_WESTERN: List[Dict] = [
    {"id": "topics", "type": "sdui", "source": "id:topics_screen", "options": {"style": {"marginTop": -56}}},
    # Every Western feature, one per row, centred, on the thread — The Heavens →
    # Arithmancy → Synastry, in order.
    *_spine("w", ["western_planets"]),
    # Concept tiles (tap = info, active components beneath as a rail → reels). These
    # hdeck features ship a plain card list; the app derives the rail from it.
    _thread("w_c0", 120),
    _concept("concept_w_prof", "id:western_profections", "left"),
    _thread("w_c1", 120),
    _concept("concept_w_trans", "id:western_transits", "right",
             railBg={"slides": ["features/western/transit-rail-1", "features/western/transit-rail-2"]},
             railBgBlur=12, railBgTint="rgba(12,10,26,0.42)"),
    _thread("w_c2", 120),
    _concept("concept_w_patt", "id:western_patterns", "left",
             railBg={"slides": ["features/western/aspect-rail-1", "features/western/aspect-rail-2", "features/western/aspect-hard-rail-1"]},
             railBgBlur=12, railBgTint="rgba(12,10,26,0.42)"),
    _thread("w_c3", 120),
    *_spine("w", ["western_balance", "western_tensions", "western_compat", "numbers_western"], lead_h=0),
    _thread("w_num", 120),
    {"id": "numerology_rail_w", "type": "featurerail", "source": "id:numerology_cards", "options": {}},
    {"id": "explore_people", "type": "sdui", "source": "id:explore_feed", "options": {}},
]

HOME_BY_SYSTEM: Dict[str, List[Dict]] = {
    "chinese": HOME_CHINESE,
    "western": HOME_WESTERN,
}

EXPLORE_BY_SYSTEM: Dict[str, List[Dict]] = {
    "chinese": EXPLORE_CHINESE,
    "western": EXPLORE_WESTERN,
}

# ── EXPLORE PAGE — REDESIGN ──────────────────────────────────────────────────
# The legacy EXPLORE* compositions above are preserved verbatim (nothing deleted)
# but no longer served. The redesigned Explore is a single backend-authored card
# feed (bg media + topic + curiosity + button) built by explore_feed.py; the app
# renders it via this one sdui block. Cards are added in explore_feed._EXPLORE_CARDS.
#
# THIS list is what the Explore tab actually receives — catalog.py builds the
# legacy `EXPLORE` composition and then replaces it wholesale while
# EXPLORE_ENABLED is True. A block added to EXPLORE and not to this one is
# built, filtered and discarded without a trace. That is exactly how the globe
# came to exist on both sides and appear on neither.
# THE WHEELS BETWEEN THE CARDS. The feed is served in parts (explore_part_N, cut
# after cards 2, 4 and 6 — the explore_part sections above) with Weeks, Months and
# Years between them, each a block of its own. The wheels are top-level blocks, not
# nodes in the feed's tree, on purpose: only a top-level `timewheels` block is
# remounted when its tab is shown again (CatalogHome REMOUNT_ON_SHOW) and kept on
# the black ground in the paper edition (DAY_NIGHT_BLOCKS) — inside the tree its
# drag would go dead and it would be drawn on paper.
_EXPLORE_WHEELS = ("week", "month", "year")   # one per gap, in EXPLORE_CUTS order


def _explore_feed_blocks(prefix: str) -> List[Dict]:
    out: List[Dict] = []
    for k in range(len(EXPLORE_CUTS) + 1):
        # The globe is NOT a block here — it is a node INSIDE the card feed
        # (explore_feed.GLOBE_AT), so it sits between cards rather than above them all.
        out.append({"id": f"explore_part_{k + 1}", "type": "sdui", "source": f"id:explore_part_{k + 1}", "options": {}})
        if k < len(_EXPLORE_WHEELS):
            unit = _EXPLORE_WHEELS[k]
            out.append({"id": f"explore_time_{unit}", "type": "timewheels", "source": f"id:{prefix}_wheel_{unit}"})
    return out


# Vedic is everyone's default (nobody picks a system); the others by active system.
EXPLORE_FEED_BLOCKS: List[Dict] = _explore_feed_blocks("vedic")
EXPLORE_FEED_BLOCKS_BY_SYSTEM: Dict[str, List[Dict]] = {
    "western": _explore_feed_blocks("western"),
    "chinese": _explore_feed_blocks("chinese"),
}

# Master switch. False → Explore serves nothing (blank, while cards are still being
# added). True → serves the card feed above. Flip on once the first card is in.
EXPLORE_ENABLED = True


# ── THE WEB APP (plutto.space/app — the catalog request carries client=web) ────
# Switches that apply to the web build ONLY; the phone apps are untouched by both.
#
# WEB_HOME_SKY: Home is the wheels and, beneath them, Explore's globe and Solar
# System card (the home_sky section). The "Discover" card that led to Explore is
# dropped, and the Explore tab becomes "download the app" with a button straight
# to each store (catalog._web_get_app_block, links from the catalog's `store`).
# OFF: the web app is the phone app, identical in everything.
#
# WEB_GET_APP_ON_EXPLORE: the one thing the web adds — "download the app" with the
# App Store and Google Play buttons, at the TOP of Explore, above the phone's whole
# Explore feed. (Ignored while WEB_HOME_SKY is on: Explore is then that panel alone.)
#
# WEB_PAYWALL_OFF: no paywall on the web for now. The catalog tells the web build
# subscriptions are off (so nothing is locked and the launch paywall never shows,
# and Settings loses its Plutto Star row), and the server lets a SIGNED-IN caller
# from the web origins through the paid-reading gate and the free chat limit
# (app/core/paywall_gate.web_is_free). The gates themselves stay in place — this
# switch turns them off for the web, and turning it back is this one line.
#
#   True              off (everything open on the web, the daily chat limit applies)
#   False             on (sells through subscription.webProvider)
#   "until_razorpay"  off UNTIL Razorpay is ready (keys in .env and at least one
#                     plan in subscription.razorpay.plans), then on, by itself —
#                     the first request after those are set opens the shop.
WEB_HOME_SKY = False
WEB_GET_APP_ON_EXPLORE = True
# THE MAGAZINE EDITION (features/magazine.py): Bodoni / Source Serif / Plex Mono for
# Latin-script languages, an ink accent instead of gold, monochrome palettes, square
# corners. False puts the previous look back everywhere (bump CATALOG_VERSION).
MAGAZINE_THEME = True
# THE DAY EDITION (features/magazine.py apply_day): the magazine on paper, ink on
# #F2EFE8. Sent only to a bundle that asks for it (catalog ?caps=day — a bundle in
# which every colour follows the theme); every older bundle keeps the Night edition.
# False = Night for everyone, no release either way.
MAGAZINE_DAY = True
# Features that keep the black ground inside the Day edition, so colour that would
# dissolve on paper keeps its contrast. Add or remove an id, bump CATALOG_VERSION.
DAY_NIGHT_FEATURES = ('talk_shells', 'talk_moons', 'home_sky', 'solar_system')
# Home blocks (by type or id) that keep the black ground inside the Day edition:
# the time wheels, whose planet renders and dials are drawn for the night.
DAY_NIGHT_BLOCKS = ('timewheels',)
WEB_PAYWALL_OFF = "until_razorpay"
# WEB_DAILY_CHAT: the web's Oracle allowance per signed-in person per day, while its
# paywall is off (text and voice together). It counts under the SAME per-user key as
# the phone's FREE_DAILY_CHAT, so it is thirty a day per person across web and phone,
# not thirty on each. Plutto Star subscribers stay unlimited everywhere. There is
# nothing to buy on the web while its paywall is off, so the web is told the limit
# and when it resets, never "go premium". 0 = no daily limit on the web.
WEB_DAILY_CHAT = 30

# ── VOICE, RUN FROM THE SERVER (app/services/features/realtime_live.py) ─────
# VOICE_VIA_SERVER: every voice call connects through our /realtime/calls (the
# catalog sets theme.voice.realtimeUrl to VOICE_CALLS_URL, which every build of
# the app already reads). The server then watches the call and counts each
# SPOKEN answer toward the day's replies — 30 means 30 answers, typed or spoken —
# and ends the call after the last with the chat's limit card. False = calls go
# straight to OpenAI again (one per call, one per chart lookup). Bump
# CATALOG_VERSION when flipping it, so phones pick up the address.
#
# VOICE_SPARES: after each written reply the server mints the voice session that
# chat would ask for, so tapping the voice button opens a call without waiting.
VOICE_VIA_SERVER = True
VOICE_CALLS_URL = "https://api.plutto.space/api/public/realtime/calls"
VOICE_SPARES = True
WEB_ORIGINS = ("https://plutto.space", "https://www.plutto.space")
WEB_HOME_SKY_BLOCK: Dict = {"id": "home_sky", "type": "sdui", "source": "id:home_sky", "options": {}}


# --- plutto: compatibility always live (no caching) ---
for _s in SECTIONS:
    if _s.get("id") == "compatibility":
        _s["cache_ttl_seconds"] = 0
        _s["cache_version"] = (_s.get("cache_version") or 1) + 1


# --- plutto: every REEL gets a tint + blur (backend-only — the reels template
# already reads cfg.blur / cfg.dim). We set it on EACH reel source: every
# reels-template section (incl. nested sub-feature configs like the Name chooser)
# AND every home `concept` block (its items open as reels via options.reels). A
# per-page/per-config value still wins; set blur:0 to opt a reel out. ---
_REEL_BG = {"blur": 22, "dim": 0.42}


def _apply_reel_bg(cfg):
    if not isinstance(cfg, dict):
        return
    cfg.setdefault("blur", _REEL_BG["blur"])
    cfg.setdefault("dim", _REEL_BG["dim"])


def _seed_reels(node):
    """Recurse any section/config tree; wherever a reels template is opened, give
    its config the default tint+blur."""
    if isinstance(node, dict):
        if node.get("template") == "reels":
            _apply_reel_bg(node.setdefault("config", {}))
        for _v in node.values():
            _seed_reels(_v)
    elif isinstance(node, list):
        for _v in node:
            _seed_reels(_v)


for _s in SECTIONS:
    _seed_reels(_s)

# Every feature RAIL's background uses the SAME media as the feature grid — i.e. the
# source feature's own tile media (sec.media). The reel-INSIDE media is left as-is.
_MEDIA_BY_ID = {_s.get("id"): _s.get("media") for _s in SECTIONS if isinstance(_s, dict) and _s.get("media")}


def _rail_source_media(block):
    src = block.get("source") or ""
    if isinstance(src, str) and src.startswith("id:"):
        return _MEDIA_BY_ID.get(src.split(":", 1)[1])
    return None


for _home in (EXPLORE, EXPLORE_CHINESE, EXPLORE_WESTERN):
    for _b in _home:
        if not isinstance(_b, dict) or _b.get("type") not in ("concept", "featurerail"):
            continue
        _opts = _b.setdefault("options", {})
        # SIMPLE + ELEGANT rails: no busy per-card image behind each active. The cards
        # read as a clean type strip (see theme.styleOverrides.t.period*) on the home's
        # own ground. The tap-to-open info card KEEPS its hero image (infoMedia below).
        _opts["railBg"] = None
        _opts["railBgForce"] = False
        if _b.get("type") == "concept":
            _apply_reel_bg(_opts.setdefault("reels", {}))   # reel-INSIDE bg unchanged
            _opts["reels"].setdefault("reelLayout", "editorial")   # concept rail readings → editorial
            # Minimal rail cards: just the title, one AI-written context line, and an
            # Explore button. Keep the staggered rise-in; no index, no marker (blanked
            # in concept_split), no gold.
            _opts.setdefault("stagger", True)
            _opts.setdefault("cta", "Explore")
            # Info-pop image: make it DOMINATE the card (the shipped app draws it as a
            # tall image atop the info card — the biggest media the current build allows
            # without an app update; a true full-bleed is the app-side change).
            _opts.setdefault("infoMediaH", 320)
            _opts.setdefault("infoMediaRounded", 16)


# Ank Jyotish / numerology rails carry the SAME media as that system's number-wheel
# GRID feature. Their own source (`numerology_cards`) has no media, so the loop above
# leaves them art-less; map each rail to its system's number grid explicitly.
_NUM_RAIL_GRID = {
    "numerology_rail_v":  "numbers_vedic",     # Ank Jyotish
    "numerology_rail_w":  "numbers_western",   # Arithmancy
    "numerology_rail_cn": "numbers_chinese",   # Jiu Xing
}
for _home in (EXPLORE, EXPLORE_CHINESE, EXPLORE_WESTERN):
    for _b in _home:
        if not isinstance(_b, dict) or _b.get("id") not in _NUM_RAIL_GRID:
            continue
        _gm = _MEDIA_BY_ID.get(_NUM_RAIL_GRID[_b["id"]])
        if _gm:
            _o = _b.setdefault("options", {})
            _o["railBg"] = _gm
            _o["railBgForce"] = True
            _o.setdefault("railBgBlur", 10)
            _o.setdefault("railBgTint", "rgba(12,10,26,0.40)")


# --- plutto: prefetch-ahead buffer (generic, backend-controlled) ---
# Add "prefetch": N to ANY feature's config to keep N readings buffered (no
# loader, fresh each open). Set here for Blunt Seer; works for any feature.
for _s in SECTIONS:
    if _s.get("id") == "blunt_seer":
        _s["cache_ttl_seconds"] = 86400
        _cfg = dict(_s.get("config") or {})
        _cfg["prefetch"] = 2
        _s["config"] = _cfg


# --- plutto: subscription / paywall (backend-controlled monetization) ---
# enabled=False → app is fully FREE: nothing locked, no paywall, store stays
# dormant. Flip to True (after RevenueCat keys + products are set up) to turn
# payments on — no app update. `gates` = section ids that lock; tapping a locked
# feature opens the paywall card automatically.
SUBSCRIPTION = {
    "enabled": True,                  # gate ON — gated features open the paywall; store SDK initializes.
    "entitlement": "PLUTTO STAR",
    "offering": "default",
    "iosKey": "appl_DHHZDhMxJhpRrsJbrjLnAanbbEo",                     # RevenueCat PUBLIC sdk key (iOS)  — fill in later
    "androidKey": "goog_DqFMyarqPIOtZsCwnuzRARUZjnR",                 # RevenueCat PUBLIC sdk key (Android) — fill in later
    # RevenueCat Web Billing PUBLIC sdk key (starts `rcb_`), from the dashboard's
    # Web Billing app. EMPTY until that app and its products exist — and empty is a
    # real setting, not a placeholder: the web paywall checks out through Stripe
    # (billing.py) while this is blank, and switches to RevenueCat the moment it is
    # filled, with no web deploy. Both routes end at the same `payments` row, so
    # entitlement, the gates and the daily chat limit read one answer either way.
    "webKey": "",
    # ── PADDLE — the web's merchant of record ────────────────────────────────
    # Paddle takes the money and handles the tax; RevenueCat stays the
    # entitlement brain (Paddle's server notifications flow into it and it
    # grants PLUTTO STAR exactly as the App Store does). So nothing downstream
    # learns a third store exists — `is_entitled` asks one authority as before.
    #
    # `token` is Paddle's PUBLIC client-side token (`test_…` / `live_…`), the
    # only value here that belongs in a browser; the API key stays on the
    # server side of RevenueCat and must never appear in this file. EMPTY is a
    # real setting: blank → the web checks out through Stripe/Web Billing as it
    # does today, filled → Paddle, with no web deploy either way.
    #
    # `environment` must match the token — a live token with "sandbox" fails
    # against hosts that do not know it, and the error says almost nothing.
    #
    # THE PRICE IDS ARE THE PLANS. Order is display order, `title`/`period` are
    # what the button says when the live price lookup fails, and the localised
    # price (₹/£/$) is fetched in the browser per country. Changing a price is
    # a catalog edit and a CATALOG_VERSION bump — never a deploy.
    "paddle": {
        "token": "live_a3920a3a08ac449c692844c6d09",
        "environment": "production",
        "prices": [
            {"id": "pri_01m31x6pr2tdn4e58q6713h0n5", "title": "Weekly",    "period": "week",     "market": "IN"},
            {"id": "pri_01m31x81j6d1w45yb9sw7wsnv6", "title": "Quarterly", "period": "3 months", "market": "IN"},
            {"id": "pri_01m31x8yynjx16kgtkmmps69pn", "title": "Annual",    "period": "year",     "market": "IN"},
        ],
    },
    # ── RAZORPAY — the web's checkout, ahead of Paddle ─────────────────────
    # `webProvider` picks the browser's checkout: "razorpay", or "paddle". With
    # "razorpay" the web app asks /billing/razorpay/plans first, and falls back
    # to Paddle on its own while the server has no Razorpay keys or no plan
    # below is live, so this can ship before the keys do.
    #
    # THE PLAN IDS ARE THE PRICES (plan_… from Razorpay → Subscriptions →
    # Plans, or scripts/razorpay_plans.py). Order is display order; the amount
    # and currency shown are read from Razorpay itself. A new price is a new
    # plan there and an edit here, plus a CATALOG_VERSION bump. `cycles` is
    # optional (how many renewals a subscription allows; about ten years by
    # default). The keys live in .env, never here.
    #
    # `market` splits the plans by who sees them: "IN" for readers in India
    # (rupees, UPI AutoPay), "world" for everyone else (the default). The web
    # app sends its time zone and gets its market's set; a market with no plans
    # of its own is offered the other's.
    "webProvider": "razorpay",
    "razorpay": {
        # The checkout window, dressed like the site: the name and product line it
        # shows, the Plutto mark, a near-black accent (header and pay button, as
        # the site's black-and-white) and the site's black behind the window.
        "name": "Plutto",
        "product": "Plutto Star",
        "image": "https://plutto.space/brand/plutto-mark.png",
        "color": "#0A0A0A",
        "backdrop": "#000000",
        # Skip the contact step: hide the field the sign-in did not give us (the
        # phone of an email/Google/Apple sign-in, the email of a phone one), via
        # Checkout's `hidden`. If Razorpay then refuses or still asks, set False.
        "hideMissing": True,
        "plans": [
            # Live plans, created 1 Oct 2026 with scripts/razorpay_plans.py. Same
            # prices as the phone app: India in rupees, everyone else in dollars.
            {"id": "plan_TipVCFMLhTIqpd", "title": "Weekly",    "period": "week",     "market": "IN"},     # ₹599
            {"id": "plan_TipVCOXJS0gjXi", "title": "Quarterly", "period": "3 months", "market": "IN"},     # ₹1,999
            {"id": "plan_TipVCZuOcrgHgK", "title": "Annual",    "period": "year",     "market": "IN"},     # ₹2,999
            {"id": "plan_TipVD6n4BLztkw", "title": "Weekly",    "period": "week",     "market": "world"},  # $5.99
            {"id": "plan_TipVDHRPOmicCE", "title": "Quarterly", "period": "3 months", "market": "world"},  # $19.99
            {"id": "plan_TipVDQbVXwRTNJ", "title": "Annual",    "period": "year",     "market": "world"},  # $29.99
        ],
    },
    "dismissible": True,              # False = hard paywall (no "Not now")
    "present": "fullscreen",          # edge-to-edge sheet (✕ + swipe-to-close) on EVERY build
    "trigger": "launch",              # paywall surfaces on home arrival (not only on gated taps)
    "triggerDelayMs": 4000,           # ...a few moments later — appears "out of nowhere". 0 = immediate
    "gates": [
        # Match — locked in every system (incl. the collective Explore-card compat)
        "compatibility", "western_compat", "chinese_compat", "compat_plutto",
        # Vedic — the yoga & dosha rails + the deep ones
        "yogas", "doshas", "past_life", "muhurta",
        # Western — the interesting rails (transits, profections, aspects)
        "western_transits", "western_profections", "western_patterns",
        # Chinese — the interesting rails (luck, overlay, relations)
        "chinese_luck", "chinese_overlay", "chinese_relations",
        # Talks back — the yearly letter is its one paid room
        "talk_letter",
        "talk_letter_read",
        "talk_letter_last",
    ],   # everything else is open (Grahas, wheels, dashas, transits stay free)
    "paywall": {
        # Full-bleed media layout: the image fills the screen; title + subtitle sit
        # at the TOP (small), plans + footer at the bottom. The app composes this from
        # `media` + `title` + `subtitle` + the live store plans — no `blocks` (those
        # duplicated the hero image and the title in the new slot layout).
        "media": "paywall/hero",      # full-bleed background → app uses the minimal media layout
        "dim": 0.25,                  # overlay darkening over the media (0–1)
        # IN A BROWSER the paywall is a card over the dimmed app, not a full
        # screen: the hero fills the whole card and fades to dark under the
        # plans. maxWidth px; mediaSpace = how much picture shows above the
        # title; fade = [top, middle, bottom] shadow opacity; False here puts the
        # full-screen layout back on the web.
        "webCard": {"maxWidth": 400, "mediaSpace": 190, "fade": [0, 0.55, 0.94]},
        "title": "PLUTTO STAR",
        "subtitle": "Every reading. Every system.",
        "cta": "Continue",
        "restore": "Restore purchases",
        "dismiss": "Not now",
        "hideDismiss": True,          # remove the "Not now" link (✕ close + swipe still dismiss it)
        "badge": False,               # no gold badge above the price
        # REQUIRED by App Store review (Guideline 3.1.2): the paywall must state the
        # auto-renew terms and link functional Terms (EULA) + Privacy Policy. The
        # plan rows already show price + period. Keep this — removing it risks a 3.1.2
        # rejection.
        "note": "Plutto Star auto-renews at the price shown until cancelled. Cancel anytime in your Apple ID settings. Payment is charged to your Apple ID at confirmation of purchase.",
        # WEB ONLY. `note`/`priceNote` above are the App Store's wording and are
        # wrong for a browser purchase — there is no Apple ID involved; Razorpay
        # takes the payment. The web paywall prefers these. Kept the same length as
        # `note`, so the web paywall's plans sit where the app's do (the support
        # address is on the Terms page).
        "webNote": "Plutto Star auto-renews at the price shown until cancelled. "
                   "Cancel anytime in Settings → Manage subscription. "
                   "Payment is processed securely by Razorpay.",
        "webPriceNote": "Exact price and billing period are shown on each plan and "
                        "confirmed at checkout. Taxes are calculated at checkout.",
        "terms": "https://api.plutto.space/terms",
        "termsLabel": "Terms of Use",
        "privacy": "https://api.plutto.space/privacy",
        "privacyLabel": "Privacy Policy",
        # App Review 3.1.2(c): the required subscription facts must be visible in the
        # binary AT ALL TIMES — even if the live store offering fails to load in the
        # sandbox (a common silent cause of the rejection). These static rows render
        # whenever the live RevenueCat plans are unavailable, so title + length are
        # never missing. Live prices still drive the actual purchase when present.
        "length": "Plutto Star is an auto-renewing subscription, billed weekly, quarterly, or annually. Each billing period unlocks the full app — every reading across every tradition (Vedic, Western, Chinese, KP & numerology), unlimited compatibility matches, and the live Oracle chat.",
        "priceNote": "Exact price and billing length are shown on each plan button and confirmed at checkout in your Apple ID.",
        # Plan-row LABELS by RevenueCat package type. The app reads these FIRST (before
        # its hardcoded English), so providing them here — and localizing them (see
        # catalog_i18n) — makes the LIVE plan titles + per-period labels follow the
        # user's language instead of showing English.
        "durations": {"WEEKLY": "Weekly", "MONTHLY": "Monthly", "TWO_MONTH": "Every 2 Months",
                      "THREE_MONTH": "Quarterly", "SIX_MONTH": "Every 6 Months",
                      "ANNUAL": "Annual", "LIFETIME": "Lifetime"},
        "periods": {"WEEKLY": "week", "MONTHLY": "month", "TWO_MONTH": "2 months",
                    "THREE_MONTH": "3 months", "SIX_MONTH": "6 months",
                    "ANNUAL": "year", "LIFETIME": "lifetime"},
        # Fallback rows shown when the live store offering fails to load in review.
        # SET each `price` to the EXACT App Store Connect price for that plan (same
        # currency/number ASC shows) so a reviewer ALWAYS sees title + length + price
        # even if StoreKit doesn't load; leave "" only if you truly cannot. The live
        # store price still drives every real purchase when present.
        "plansFallback": [
            {"title": "Weekly",    "period": "week",     "price": ""},
            {"title": "Quarterly", "period": "3 months", "price": ""},
            {"title": "Annual",    "period": "year",     "price": ""},
        ],
    },
}
