"""
LAYERED ROUTER — how deep a chat turn goes, decided in layers, cheapest first.

  L0  DETERMINISTIC GATE   No model, microseconds. A message that is only a greeting,
                           thanks or an emoji is small talk: no classifier call, no
                           chart data, no council, no memory write. Its language is read
                           off its script. Strict on purpose: "hi, will I marry?" is a
                           question, and "yes" / "no" may be answering the Oracle.

  L1  CLASSIFIER           One fast-model call (oracle/classifier.py): intent, scope,
                           language and register, the systems to convene (plutto) and,
                           in the same call, each engine-backed tradition's PLAN — the
                           witnesses to compute. The planner used to be its own round
                           after the classifier, for every deep tradition; it now runs
                           only for a tradition the classifier left without a plan.

  L2  DEPTH TIER           From L1, no model:
                             light    small talk or off-topic: no council, no sections,
                                      no verdicts; off-topic keeps the base chart its
                                      doorway reading needs
                             focused  a narrow question: the routed traditions and the
                                      routed wider-council profiles, and NOT the ambient
                                      one-line council of every other system
                             council  a broad question: breadth across families, the
                                      ambient one-liners, the verdict pass

  L3  REPLY TIER           A council turn (or a focused one whose focused data is still
                           large) may escalate to OPENROUTER_MODEL_CHAT_DEEP; everything
                           else stays on the chat model. This replaced a raw briefing-
                           length test that the ambient one-liners alone (~7.6k chars)
                           nearly passed, so every plutto turn was "deep" and almost no
                           single-tradition turn ever was.

The single-tradition LENS (Vedic → Mandala for where-to-be, KP for yes/no timing) is
chosen before L1 by features/chat._route_engine, because the classifier's section
catalog depends on the lens.
"""
import re
from typing import Dict, List, Optional

# ── L0 ───────────────────────────────────────────────────────────────────────────
_GREET_WORDS = {
    "hi", "hii", "hiii", "hello", "helo", "hey", "heya", "heyy", "yo", "hola", "namaste",
    "namaskar", "namaskaram", "salaam", "salam", "assalamualaikum", "pranam", "vanakkam",
    "sat", "sri", "akal", "gm", "gn", "morning", "evening", "afternoon", "night", "good",
    "thanks", "thank", "thankyou", "thx", "ty", "tysm", "shukriya", "dhanyavad", "dhanyawad",
    "gracias", "merci", "danke", "ok", "okay", "okk", "k", "kk", "cool", "nice", "lol", "lmao",
    "haha", "hahaha", "hehe", "great", "awesome", "amazing", "wow", "bye", "goodbye", "cya",
    "sup", "wassup", "hmm", "hm", "hmmm", "alright", "bonjour", "ciao",
}
_FILLER = {
    "there", "oracle", "plutto", "friend", "again", "all", "everyone", "so", "much", "very",
    "dear", "ji", "bhai", "yaar", "sir", "madam", "mam", "you", "u", "a", "lot", "to", "too",
    "and", "my",
}
_GREET_PHRASES = {
    "how are you", "how r u", "how are u", "how are you doing", "how is it going", "whats up",
    "what's up", "good morning", "good evening", "good night", "good afternoon", "sat sri akal",
    "nice to meet you", "thank you so much",
}


def is_small_talk(message: str) -> bool:
    """Only a greeting, thanks, a sign-off or an emoji — nothing that asks anything."""
    t = (message or "").strip().lower()
    if not t:
        return False
    if all(not c.isalnum() for c in t):
        return True                                     # emoji / punctuation only
    norm = re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", t)).strip()
    if norm in _GREET_PHRASES:
        return True
    toks = norm.split()
    if not toks or len(toks) > 6:
        return False
    return (all(w in _GREET_WORDS or w in _FILLER for w in toks)
            and any(w in _GREET_WORDS for w in toks))


def layer0(message: str) -> Dict:
    """The deterministic gate: small talk or not, and the script's language."""
    from .classifier import script_language
    return {"small_talk": is_small_talk(message), "language": script_language(message) or ""}


def light_intent(l0: Dict) -> Dict:
    """The intent of a turn L0 answered without a classifier."""
    return {
        "topic": "general", "secondary_topic": None, "question_type": "general",
        "scope": "narrow", "emotional_tone": "neutral", "language": l0.get("language") or "",
        "register": "", "off_topic": False, "wants_astrology": False, "small_talk": True,
        "intent_note": "", "showcase_feature": None, "showcase_system": None,
        "showcase_divination": None, "showcase_label": None, "showcase_alternatives": [],
        "sections": [], "systems": {}, "plans": {}, "plan": [],
    }


# ── L2 ───────────────────────────────────────────────────────────────────────────
def depth_tier(intent: Dict) -> str:
    if (intent or {}).get("small_talk") or (intent or {}).get("off_topic"):
        return "light"
    return "council" if str((intent or {}).get("scope") or "").strip().lower() == "broad" else "focused"


# ── L1: what the classifier is told about plans and routing ──────────────────────
# Which toolbox each engine-backed tradition plans from (computations.py). KP and the
# astrocartography lens read the Vedic chart, so they plan from the Vedic toolbox.
_TOOLBOX_OF = {"bphs": "bphs", "kp": "bphs", "mandala": "bphs", "western": "western", "chinese": "chinese"}
_TOOLBOX_LABEL = {"bphs": "VEDIC — also used for KP and astrocartography",
                  "western": "WESTERN", "chinese": "CHINESE (BaZi)"}


def toolbox_block(systems) -> str:
    """The witnesses the classifier may plan, per tradition (one copy per toolbox)."""
    from .computations import toolbox_menu
    seen, parts = set(), []
    for sid in systems:
        tb = _TOOLBOX_OF.get(sid)
        if tb and tb not in seen:
            seen.add(tb)
            parts.append(f"[{tb}] {_TOOLBOX_LABEL[tb]}:\n{toolbox_menu(tb)}")
    return "\n\n".join(parts)


ROUTING_RULES = """ROUTING RULES — read before filling `systems`:
- Each system is tagged with what it needs to work. birth: computes from the birth data,
  always available. cast: needs something thrown first (coins, sticks, shells, a shuffle);
  nothing has been cast, so pick one ONLY if the user asked for that reading by name.
  moment: reads the instant of the question — right for "should I, right now", wrong for
  "what am I like". body: reads a hand, face or mark this app has never seen; pick one only
  when they ask about their own hand or face. practice: a method held and practised, not
  calculated from a birth.
- NARROW questions stay narrow: one life area, one named technique or concept, one event,
  one named tradition → at most 2–3 systems, often one. The tradition that owns a technique
  answers it; a second joins only if it has the same technique under another name.
- BROAD questions ("how will my year go", "tell me about myself", "what should I know") →
  4–6 systems from DIFFERENT families (South Asian, East Asian, Western, Persian/Arabic,
  African, Pacific, body-reading), never several that share a parent. Vedic and KP are one
  family; Western and Human Design read the same sky.
- If the user names a system, use only that one."""

PLAN_RULE = ("the classical council the texts prescribe for THIS matter, from that tradition's "
             "TOOLBOX above: the governing houses and their lords, the kāraka(s), the topic's own "
             "divisional chart (marriage 9, career 10, children 7, wealth 2, spirituality 20 — reason "
             "out the right one for anything else), the KP sub-lord of the key house, the relevant "
             "yogas or doshas, and the daśā, with dasha_at / transits_at and the date YYYY-MM-DD when a "
             "time is mentioned or implied. 5 to 12 steps, each {\"name\": ..., \"params\": {...}}. "
             "Reason from significations: no topic is unsupported.")


def plan_for(intent: Dict, sid: str) -> Optional[List[Dict]]:
    """The classifier's plan for one tradition, kept only if it names real witnesses."""
    from .computations import REGISTRY, WEST_REGISTRY, CN_REGISTRY
    reg = {"western": WEST_REGISTRY, "chinese": CN_REGISTRY}.get(_TOOLBOX_OF.get(sid, "bphs"), REGISTRY)
    intent = intent or {}
    plans = intent.get("plans") if isinstance(intent.get("plans"), dict) else {}
    raw = plans.get(sid)
    if raw is None:
        raw = intent.get("plan")
    if not isinstance(raw, list):
        return None
    steps = [s for s in raw if isinstance(s, dict) and s.get("name") in reg]
    return steps or None
