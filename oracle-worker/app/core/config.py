from pydantic_settings import BaseSettings

# The RevenueCat apps that ARE Plutto — see REVENUECAT_APP_IDS below. Module level
# so the webhook can fall back to it when .env sets the value to something empty,
# rather than silently reverting to "accept every app in the project".
PLUTTO_REVENUECAT_APP_IDS = "app6450b2dcd8,appe633cb0517,appc038622334"


class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8080
    DEBUG: bool = False

    OPENROUTER_API_KEY: str
    OPENROUTER_MODEL: str = "deepseek/deepseek-chat"          # the RESPONDER for FEATURE readings
    # Cheap/fast model for the internal machinery — classifier, planner, system-router.
    # These pick WHICH data to gather (structured JSON); they never write the reply, so a
    # small reliable model is ideal. Empty → falls back to OPENROUTER_MODEL.
    OPENROUTER_MODEL_FAST: str = ""
    # The CHAT responder — the live conversational reply the user reads (text + voice).
    # Kept separate from OPENROUTER_MODEL so feature readings and chat can run on
    # different models (e.g. Gemini Flash for readings, Claude Sonnet for the chat
    # reply). Empty → OPENROUTER_MODEL.
    OPENROUTER_MODEL_CHAT: str = ""
    # The CHAT classifier/planner/system-router — the internal machinery that decides
    # WHICH data to gather for a chat turn (structured JSON, never the reply). Runs on a
    # cheap+fast model (e.g. Claude Haiku). Kept separate from OPENROUTER_MODEL_FAST so
    # the feature home-cards fast lane and the chat classifier can differ. Empty →
    # OPENROUTER_MODEL_FAST → OPENROUTER_MODEL.
    OPENROUTER_MODEL_CHAT_FAST: str = ""
    # OPTIONAL tier-up responder for the DEEPEST chat turns — the pivotal, life-defining
    # questions that draw a full multi-council briefing. Everyday turns stay on the fast,
    # responsive OPENROUTER_MODEL_CHAT; only the deep ones escalate here (e.g. Flash for
    # the 80%, Gemini 2.5 Pro for the deep 20%). EMPTY → no escalation, every turn uses
    # OPENROUTER_MODEL_CHAT exactly as before (safe default — set this to switch on tiering).
    OPENROUTER_MODEL_CHAT_DEEP: str = ""
    # A turn escalates to the deep model when its briefing is at least this many chars — a
    # proxy for "the router assembled a big, multi-tradition reading." Raise it to escalate
    # less (only the very deepest), lower it to escalate more. Tunable without a release.
    CHAT_DEEP_MIN_CHARS: int = 8000
    # Model chains with spares (core/llm.py), best first, comma-separated. When a model fails, the same request goes
    # to the next one; a model that then fails a quick check is skipped for LLM_DOWN_MINUTES, and the session it
    # failed in keeps the model that answered. A model is an OpenRouter id, or "openai:<model>" to call OpenAI
    # directly with OPENAI_API_KEY (a spare that still answers when OpenRouter is down or out of credit).
    # Empty → the single model configured above, exactly as before.
    LLM_CHAIN_FAST: str = ""        # the router's pick, the planner, the verdicts
    LLM_CHAIN_CHAT: str = ""        # the reply
    LLM_CHAIN_DEEP: str = ""        # the reply on the deepest turns (empty → OPENROUTER_MODEL_CHAT_DEEP, else the chat chain)
    LLM_DOWN_MINUTES: int = 10

    OPENAI_API_KEY: str

    GOOGLE_PLACES_API_KEY: str

    # REGISTERED USERS ONLY. When true, every /api route not on the public
    # allowlist (app/core/auth_gate.py) needs a verified Supabase JWT — a request
    # with no token gets 401 instead of being served anonymously.
    #
    # Ships DEFAULT OFF on purpose, and off means REPORT-ONLY: the gate logs the
    # calls it would have rejected and lets them through. The reason is that the
    # binaries already in users' hands call several endpoints without attaching
    # their token — /kundli/generate and /places/* among them, which is the whole
    # of onboarding. Enforcing before those users update would brick the app for
    # them, and an App Store rollout is not instant.
    #
    # The sequence: deploy report-only → watch the log until nothing but genuine
    # strangers appear → ship the app update that attaches the token everywhere →
    # set REQUIRE_AUTH=true. No code change needed to flip it.
    REQUIRE_AUTH: bool = False

    # Chat is the priciest path (Sonnet). This is a COARSE per-IP backstop only —
    # behind carrier/Wi-Fi NAT many real users share one IP, so it needs real
    # headroom or it 429s legitimate traffic (that's what a too-low 200 did). The
    # fine-grained, spammer-proof control is the per-user auth gate (keyed on the
    # verified user id), not this. Keep it generous; tune via RATE_LIMIT_CHAT env.
    RATE_LIMIT_CHAT: int = 3000
    # FREE-TIER daily chat allowance, keyed on the verified user id (paid users are
    # unlimited). Over this, the chat returns the upgrade gate instead of an LLM
    # call. 0 disables the server-side gate (client-side session gate still applies).
    #
    # THIRTY a day for free users; paid users are unlimited (free_over_quota returns
    # False for anyone entitled). This is the AUTHORITATIVE limit: it is keyed on the
    # verified Supabase user id, so it survives reinstalls, cache clears and rotating
    # IPs. The catalog's chat.gate.free_limit is a client-side fast path counting one
    # SESSION and now READS this value, so the two cannot drift; when they disagree
    # the server wins, which is the correct way round.
    #
    # It is a Settings field, so an env var of the same name on the server OVERRIDES
    # this default. Check that before believing the number here is the live one.
    #
    # Voice spends from the same allowance: /realtime/session and /realtime/consult
    # count under the same 'chat' key, so thirty is thirty across both.
    FREE_DAILY_CHAT: int = 30
    # FREE-TIER daily DIVINATION allowance, keyed on the verified user id (paid users are
    # unlimited). Counts NEW LLM readings from the divination feature — a per-card flip
    # reading AND a full spread reveal both draw on it. At 1, a free user gets one live
    # divination reading a day (re-viewing an already-generated reading is free and never
    # gated). 0 disables the gate. Anonymous/unauthed users aren't gated here (per-IP
    # RATE_LIMIT_FEATURE is their backstop).
    FREE_DAILY_DIVINATION: int = 1
    # Per-day cap on the interactive per-card flip readings (tap→expand). Kept separate and
    # more generous than the reveal so laying/flipping a multi-card spread isn't cut off at
    # card 2, while still bounding cost. Applies to free users AND anonymous callers (by IP).
    FREE_DAILY_DIVINATION_CARDS: int = 12
    RATE_LIMIT_KUNDLI: int = 20
    # Minting a realtime token grants live audio on OUR OpenAI account, so this
    # is the tightest cap in the app. A person opens a few voice sessions an hour.
    RATE_LIMIT_REALTIME: int = 20
    # The app warms a voice session on every chat open (no call yet, nothing spent),
    # so warming has its own, wider bucket than the per-call one above.
    RATE_LIMIT_REALTIME_WARM: int = 60
    RATE_LIMIT_WHISPER: int = 30
    RATE_LIMIT_TTS: int = 30
    # Feature reads are prefetch-heavy: the home feed trickles in EVERY reading in the
    # background, so one cold app-open fires dozens of /feature requests — and behind
    # carrier/Wi-Fi NAT many users share one IP. The old implicit 60/hour cap made a
    # cold load 429 halfway through (→ blank/missing cards for up to an hour). Give it
    # real headroom; abuse is still bounded per IP.
    RATE_LIMIT_FEATURE: int = 3000
    # ...and per DAY. An hour's cap alone lets one address take 72k readings a day;
    # a person opens a few dozen. Generous for a shared NAT, fatal for a loop.
    RATE_LIMIT_FEATURE_DAILY: int = 1500

    # GLOBAL SPEND KILL-SWITCH (app/services/features/_base.py): LLM output tokens
    # per clock hour / day before every live call returns 503. 0 = off. Declared
    # here because _base.py read os.getenv, and pydantic-settings loads .env into
    # THIS object, not into os.environ — a value set in .env never took effect.
    LLM_HOURLY_TOKEN_BUDGET: int = 0
    LLM_DAILY_TOKEN_BUDGET: int = 0

    # WEB PUSH (app/services/features/web_push.py): the VAPID key pair browsers
    # verify our messages with. Generate once with scripts/gen_vapid.py. Unset =
    # web notifications off (the app never asks). The public half is public; the
    # private half signs every message and must stay on this server.
    WEB_PUSH_VAPID_PUBLIC_KEY: str = ""
    WEB_PUSH_VAPID_PRIVATE_KEY: str = ""
    WEB_PUSH_CONTACT: str = "mailto:support@plutto.space"

    ALLOWED_ORIGINS: str = "*"

    DATABASE_URL: str = ""
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_SERVICE_KEY: str = ""          # same key under the other name some writers used
    # RevenueCat SECRET API key (sk_…) — lets the server ask RevenueCat directly when the
    # payments row says free, so a missed webhook cannot cost a paying user their access.
    # Never the public appl_/goog_ keys from the catalog.
    REVENUECAT_API_KEY: str = ""
    REVENUECAT_ENTITLEMENT: str = "PLUTTO STAR"
    # RAZORPAY — the web app's checkout (app/services/features/razorpay.py). The key
    # id (rzp_live_… / rzp_test_…) is public and is handed to the browser; the key
    # secret and the webhook secret never leave this server. Any of them empty =
    # the web paywall falls back to Paddle. The plans on sale are in the catalog
    # (subscription.razorpay.plans).
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""
    # Shared secret the RevenueCat webhook must present (Authorization header).
    # Declared here because pydantic-settings loads .env into THIS object, not into
    # os.environ — a reader using os.environ never saw the value at all.
    REVENUECAT_WEBHOOK_AUTH: str = ""
    # RevenueCat app ids this backend serves (comma-separated). NOT the bundle id
    # (`com.jyotish.app`) — the webhook's `app_id` field carries RevenueCat's own
    # `app…` identifier, found under Project settings → Apps.
    # As listed in RevenueCat → Project settings → Apps (checked 27 Sep 2026):
    #   app6450b2dcd8  PLUTTO (App Store)    com.jyotish.app
    #   appe633cb0517  PLUTTO (Play Store)   space.plutto.app
    #   appc038622334  PLUTTO (Paddle)       the web app's checkout at plutto.space
    #   appb341b9cef4  TAILZU                com.tulmi.app      ← NOT Plutto: never list it
    # (app32b4dee1ac, once listed here as Plutto's Play app, is not in the project.)
    # The project also holds TAILZU, and ONE webhook fires for every app in it, so
    # without this filter another product's purchases become rows in Plutto's
    # payments table. Defaulted here rather than left to .env because the failure
    # is silent in both directions: empty accepts everything, and a list missing
    # one store discards that store's real purchases. Override in .env only to add
    # an app — a blank value falls back to these (see revenuecat.py).
    REVENUECAT_APP_IDS: str = PLUTTO_REVENUECAT_APP_IDS
    SUPABASE_JWKS_URL: str = "https://auth.plutto.space/auth/v1/.well-known/jwks.json"

    # WHO WRITES THE NOTIFICATIONS. True: the model writes each one from that
    # person's whole council — every system's computed line — plus today's
    # guidance, in their language, once a day, on the cheap model. False: the
    # hand-written pool in notifications.py, as before.
    #
    # It is never all-or-nothing. A written line that names a tradition, uses a
    # technical word, runs past a lock screen's width or comes back malformed is
    # discarded and the hand-written line is sent instead — so the worst case is
    # the behaviour you had before, not a bad notification.
    NOTIFY_LLM: bool = True

    # Shared secret that gates the push-notification send endpoints. Empty = sending
    # disabled (all calls refused). Set it in .env to enable.
    NOTIFY_SECRET: str = ""

    # Shared secret for the ADMIN data endpoints (browse/export every user's chats +
    # compatibility records — "for us"). Sent as the X-Admin-Key header. Empty =
    # the admin endpoints are DISABLED (403) — set it in .env to enable.
    ADMIN_SECRET: str = ""

    # Where file-backed chat memory lives when the database is unavailable. Empty =
    # the server's /var/www/jyotish/backend/data/portraits.
    PORTRAIT_DIR: str = ""
    # The oracle's router — the AI decides where a question belongs. "full": one call with every section of every
    # system (the merged classifier). "direct" (oracle/direct.py): the question is embedded once and the ~30 nearest
    # subsystems (of ~300, each tagged with its tradition; oracle/subsystems.py) are shortlisted; one AI call picks
    # the exact subsystems, plans and draw from them; a follow-up can reuse the last route. With no embeddings the
    # AI is shown the whole index instead. ORACLE_SHOWCASE=false leaves out the app's "open this screen" menus.
    # A deployment preset. "bot" is the X0 bot (see PROFILES below): set it and the oracle runs as the bot, with
    # every explicitly set variable still winning. Empty: the Plutto app, exactly as configured.
    ORACLE_PROFILE: str = ""
    ORACLE_ROUTER: str = "full"
    ORACLE_SHOWCASE: bool = True
    # Replies sometimes end on a follow-up hook, only when it is psychologically alive (oracle/pipeline.py). Off keeps
    # the app's closing rule: end on the line they reread, never an offer or a question unless one fact is missing.
    ORACLE_FOLLOW_HOOKS: bool = False
    ORACLE_SHORTLIST: int = 30
    # The embeddings that make the shortlist: OpenAI's by default, with OPENAI_API_KEY unless ORACLE_EMBED_KEY is set.
    # The index's vectors are made once and cached at ORACLE_VECTORS_PATH (default data/oracle_subsystem_vectors.json).
    ORACLE_EMBED_MODEL: str = "text-embedding-3-small"
    ORACLE_EMBED_URL: str = "https://api.openai.com/v1/embeddings"
    ORACLE_EMBED_KEY: str = ""
    ORACLE_EMBED_DIMS: int = 512
    ORACLE_VECTORS_PATH: str = ""

    class Config:
        # THE SERVER'S KEYS LIVE IN .env (the systemd unit sets no environment), so
        # without this line every required key is "missing" and the API will not
        # start. It was once removed as dead code; it is not.
        env_file = ".env"
        # NEVER refuse to start over an unknown variable. pydantic-settings forbids
        # extras by default, which turned every new line in .env — a webhook secret,
        # a Postgres password pasted in for reference — into a crash loop for the
        # whole API. An unknown variable is at worst unused; it is never a reason
        # to take the service down.
        extra = "ignore"


# Deployment presets: what a profile sets, unless the environment set it explicitly.
#
# "bot", the X0 bot: chat only (no app screens to open), the subsystem router, follow-up hooks, and the reply on
# Claude Sonnet 5.5 at low thinking. The live test (scripts/compare_reply_models.py, 11 Nov 2026: nine deep
# questions, two blind judges from other labs) put a Sonnet setup first in 16 of 18 gradings. At low thinking it
# kept its quality (6.8 against 7.1 out of 10) while the first word came sooner, a reply cost about 2.7¢, and none was
# cut off by its own thinking. The spares come from other companies, so one outage cannot silence the bot: Gemini
# 3.8 Flash at low thinking (the best value, 5.6), then OpenAI directly with OPENAI_API_KEY in case OpenRouter itself
# is down. Routing runs on Gemini 2.5 Flash, which chose the right subsystems for every test question; it is
# deprecated, so Haiku 5.5 stands behind it.
PROFILES = {
    "bot": {
        "ORACLE_ROUTER": "direct",
        "ORACLE_SHOWCASE": False,
        "ORACLE_FOLLOW_HOOKS": True,
        "LLM_CHAIN_CHAT": "anthropic/claude-sonnet-5.5@low,google/gemini-3.8-flash@low,openai:gpt-6.1-sol@low",
        "LLM_CHAIN_DEEP": "anthropic/claude-sonnet-5.5@low,google/gemini-3.8-flash@low,openai:gpt-6.1-sol@low",
        "LLM_CHAIN_FAST": "google/gemini-2.5-flash,anthropic/claude-haiku-5.5,openai:gpt-6-luna",
    },
}


def apply_profile(s: "Settings") -> "Settings":
    """Fill in the profile's settings that the environment left unset."""
    for name, value in PROFILES.get(str(s.ORACLE_PROFILE or "").strip().lower(), {}).items():
        if name not in s.model_fields_set:
            setattr(s, name, value)
    return s


settings = apply_profile(Settings())
