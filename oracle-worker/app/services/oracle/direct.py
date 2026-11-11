"""
THE DIRECT ROUTER (ORACLE_ROUTER=direct) — the AI picks the subsystems a question needs, from the few dozen nearest
in meaning, each tagged with its tradition.

  1. SHORTLIST   the question (and, for a short follow-up, what they asked before) is embedded once and compared
                 with every subsystem in the index (oracle/subsystems.py, ~300 items), each by its nearest spot (it
                 has one per thing it answers, ~725 in all): the 30 nearest (20 subsystems, 10 whole systems), plus
                 every system they named, plus the six draws. A fraction of a second, no model reading anything.
  2. PICK        one tiny-model call sees only those 30, each tagged with its tradition, and the toolboxes of the
                 engine traditions among them. It returns the reading of the question (topic, shape, scope, date,
                 language, register, the intent under it), the exact subsystems, the planned witnesses for the engine
                 traditions it picked from, a draw if they asked for one, and whether a follow-up stays on the last
                 turn's route (then that route is reused).
  3. CHECK       every pick is checked against the registry (a real subsystem the AI knew without being shown it
                 is kept; an invented one is dropped); the systems come from the picks' tags.

About 2.7k tokens of routing, the same size however many systems are added. No keyword rules anywhere: the pick call
runs on the "fast" chain (core/llm.py), so when its model is down, or answers with nothing usable, the same request
goes to the next model; when every model fails, ModelsUnavailable reaches the caller and nothing is made up. With no
embeddings the AI is shown the whole index (~300 lines) in the same one call.
What comes out is the classifier's own intent dict, so the pipeline after it runs unchanged.
"""
from datetime import datetime
from typing import Dict, List, Optional

from . import subsystems as SS

_TOOLBOX = {"bphs": "bphs", "kp": "bphs", "western": "western", "chinese": "chinese"}     # mandala plans nothing
_TONES = ("curious", "worried", "anxious", "sad", "desperate", "excited", "neutral")
_QTYPES = ("timing", "yes_no", "why", "how_is", "what_kind", "should_i", "general")


def prompt(cands: List[Dict], today: str, last: Optional[Dict] = None) -> str:
    """The pick call's system prompt: the instructions (stable), the candidates, today, the last turn's route."""
    from .router import ROUTING_RULES, PLAN_RULE
    from .computations import toolbox_menu
    toolboxes = []
    for tb, label in (("bphs", "VEDIC (also for KP)"), ("western", "WESTERN"), ("chinese", "CHINESE")):
        if any(_TOOLBOX.get(c.get("system")) == tb for c in cands):
            toolboxes.append(f"[{tb}] {label}:\n{toolbox_menu(tb)}")
    tools = ("\n\nTOOLBOXES (the witnesses a plan may call, for the engine traditions above):\n" + "\n\n".join(toolboxes)) if toolboxes else ""
    plans = (f"\n- plans: an object mapping each engine tradition you picked from (bphs, kp, western, chinese) to its "
             f"plan: {PLAN_RULE} bphs and kp both plan from the VEDIC toolbox. {{}} if you picked none.") if toolboxes else ""
    last_line = (f"LAST TURN: topic {last.get('topic') or 'general'}; picked {', '.join(last.get('picks') or []) or 'nothing'}"
                 if last and last.get("picks") else "LAST TURN: none")
    lines = "\n".join(c["line"] for c in cands)
    return f"""You route a message to an oracle (astrology and divination) by picking the SUBSYSTEMS that answer it.
Each candidate below is one subsystem, tagged with its tradition before the dot (an engine tradition's section), or
a whole system (its full profile), or a draw. They are the candidates nearest in meaning to the message; pick only
from them, exactly as written.

{ROUTING_RULES}

Return a JSON object with:
- topic: one word: marriage / career / wealth / health / spirituality / timing / remedies / compatibility / travel /
  family / personality / general
- secondary_topic: a second topic if the question truly spans two, else null
- question_type: timing | yes_no | why | how_is | what_kind | should_i | general
- scope: "broad" for the whole of a life, a year or a self with no single subject; "narrow" when there is one subject.
  When in doubt, narrow.
- target_date: "YYYY-MM-DD" if they ask about a specific time, resolved from TODAY (the 15th for a month, 15 January
  for a bare year), else null
- emotional_tone: curious | worried | anxious | sad | desperate | excited | neutral
- language: the language of THEIR last message, in lowercase English (english, hindi, hinglish, tamil, spanish …);
  "hinglish" is Hindi or another Indian language in Latin letters mixed with English; never "other"
- register: 3 to 8 English words on how they write
- off_topic: true only for a task unrelated to their life, self, timing or choices; any divination is on-topic
- wants_astrology: true only if they want the astrology itself explained
- small_talk: true for a greeting, thanks or chit-chat with no question
- intent_note: one or two plain English sentences on the real intent beneath the question, for the one who answers
- picks: the subsystems this question needs, most relevant first, exactly as written before the "|": 2 to 6 from one
  to three traditions for a narrow question; 6 to 12 across traditions of different families for a broad one; if they
  name a tradition, only its subsystems; a draw only when they ask for one{plans}
- same_as_last: true only if this message continues the LAST TURN's subject and the same picks still answer it

CANDIDATES:
{lines}{tools}

TODAY is {today}.
{last_line}
Return only the JSON object."""


async def _ask(messages: List[Dict], max_tokens: int, session: Optional[str] = None, usable=None):
    """The one model call (one place, so tests can stand in for it): (the answer as a dict, the model that gave it).
    It runs on the "fast" chain with spares (core/llm.py). An answer that is not a JSON object, or that `usable`
    turns down, counts as a failure, so the next model gets the request. Raises ModelsUnavailable when every model
    fails."""
    from app.core import llm
    from .classifier import _loads_salvaging

    def read(text: str):
        out = _loads_salvaging(text.replace("```json", "").replace("```", "").strip())
        if not isinstance(out, dict):
            return None
        return usable(out) if usable else out
    return await llm.complete("fast", messages, session=session, max_tokens=max_tokens, temperature=0.1,
                              timeout=20.0, extra={"reasoning": {"enabled": False}}, parse=read, passes=1)


def _read(r: Dict) -> Dict:
    lang = str(r.get("language") or "").strip().lower()
    td = r.get("target_date")
    return {
        "topic": str(r.get("topic") or "general").strip().lower() or "general",
        "secondary_topic": r.get("secondary_topic") if isinstance(r.get("secondary_topic"), str) else None,
        "question_type": r.get("question_type") if r.get("question_type") in _QTYPES else "general",
        "scope": r.get("scope") if r.get("scope") in ("broad", "narrow") else "narrow",
        "target_date": td if isinstance(td, str) and len(td) == 10 and td[4] == "-" else None,
        "emotional_tone": r.get("emotional_tone") if r.get("emotional_tone") in _TONES else "neutral",
        "language": "" if lang in ("other", "unknown") else lang,
        "register": str(r.get("register") or "")[:120],
        "off_topic": r.get("off_topic") is True, "wants_astrology": r.get("wants_astrology") is True,
        "small_talk": r.get("small_talk") is True, "intent_note": str(r.get("intent_note") or "")[:500],
        "same_as_last": r.get("same_as_last") is True,
    }


def resolve(picks):
    """(systems map, cast, the picks that were real) from picked ids: an engine section to its tradition, a whole
    system to its default sections, a draw to `cast`. The registry is the check, not the shortlist: a real subsystem
    the AI picked without being shown it still answers; an id the index does not hold is dropped."""
    from .systems_registry import _known_only, _default_sections
    index = SS.by_id()
    systems: Dict[str, List[str]] = {}
    cast, real = None, []
    for p in picks or []:
        if not isinstance(p, str):
            continue
        p = p.strip()
        base = p.split(":")[0]
        key = next((k for k in (p, base + ":N") if k in index), base if base in index else None)
        if not key:
            continue
        it = index[key]
        if it.get("cast"):
            cast = cast or it["cast"]
        elif it["section"] is None:
            systems.setdefault(it["system"], _default_sections(it["system"]))
        else:
            sec = p.split(".", 1)[1] if "." in p else it["section"]
            if sec.endswith(":N"):                             # a house with no number given is not a section
                continue
            if _known_only(it["system"], [sec]):
                cur = systems.setdefault(it["system"], [])
                if sec not in cur:
                    cur.append(sec)
        real.append(p)
    return systems, cast, real


def _plans(raw, systems: Dict[str, List[str]]) -> Dict[str, List[Dict]]:
    from .computations import REGISTRY, WEST_REGISTRY, CN_REGISTRY
    reg = {"bphs": REGISTRY, "western": WEST_REGISTRY, "chinese": CN_REGISTRY}
    out = {}
    for sid, steps in (raw or {}).items() if isinstance(raw, dict) else []:
        if sid in systems and sid in _TOOLBOX and isinstance(steps, list):
            ok = [s for s in steps if isinstance(s, dict) and s.get("name") in reg[_TOOLBOX[sid]]]
            if ok:
                out[sid] = ok
    return out


def _intent(read: Dict, systems: Dict[str, List[str]], plans: Dict, cast: Optional[str], picks: List[str],
            system: str, how: Dict) -> Dict:
    lens = system if system != "plutto" else None
    return {
        "topic": read["topic"], "secondary_topic": read["secondary_topic"], "question_type": read["question_type"],
        "scope": read["scope"], "target_date": read["target_date"], "emotional_tone": read["emotional_tone"],
        "language": read["language"], "register": read["register"], "off_topic": read["off_topic"],
        "wants_astrology": read["wants_astrology"], "small_talk": read["small_talk"], "intent_note": read["intent_note"],
        "cast": cast,
        "showcase_feature": None, "showcase_system": None, "showcase_divination": None, "showcase_label": None,
        "showcase_alternatives": [],
        "systems": {} if lens else systems, "sections": systems.get(lens, []) if lens else [],
        "plans": plans, "plan": plans.get(lens, []) if lens else [],
        "router": how,
        "route_state": {"topic": read["topic"], "picks": picks, "systems": systems, "plans": plans, "cast": cast},
    }


async def route(message: str, history: Optional[List], api_key: str = "", model: str = "", system: str = "plutto",
                last: Optional[Dict] = None, today: Optional[str] = None, session: Optional[str] = None) -> Dict:
    """Shortlist, one pick call, check. Returns the classifier's intent dict (with `router` saying how it was routed
    and `route_state` to pass back as `last_route` next turn). The models come from the "fast" chain (core/llm.py);
    `api_key` and `model` are kept for the caller's signature. Raises ModelsUnavailable when no model answers."""
    from app.core.config import settings
    from .classifier import history_messages
    today = today or datetime.now().strftime("%Y-%m-%d")
    k = int(getattr(settings, "ORACLE_SHORTLIST", 30) or 30)
    lens = system if system != "plutto" and any(it["system"] == system for it in SS.items()) else None
    cands = await SS.shortlist(message, history, k, only=lens)    # one tradition: the search stays inside it
    how = {"shortlist": len(cands) if cands else 0}
    if not cands:                                       # no embeddings: the whole index, in the same one call
        cands = [c for c in SS.items() if lens is None or c.get("system") == lens or c.get("cast")]
        how["shortlist"] = "all"
    msgs = [{"role": "system", "content": prompt(cands, today, last)}] + history_messages(history, 4, 400) + \
           [{"role": "user", "content": (message or "")[:3000]}]

    def usable(d: Dict):
        """An answer the turn can be read from; anything else goes to the next model."""
        rd = _read(d)
        if rd["small_talk"] or rd["off_topic"]:
            return d
        if rd["same_as_last"] and last and last.get("picks") and any(resolve(last["picks"])[:2]):
            return d
        systems, cast, _ = resolve(d.get("picks"))
        return d if (cast or (lens in systems if lens else systems)) else None

    r, used = await _ask(msgs, 800, session, usable)
    how["model"] = used
    read = _read(r)
    if read["small_talk"] or read["off_topic"]:
        return _intent(read, {}, {}, None, [], system, how)
    if read["same_as_last"] and last and last.get("picks"):
        systems, cast, picks = resolve(last["picks"])
        plans = {s: p for s, p in (last.get("plans") or {}).items() if s in systems}
        if read["target_date"]:
            for s in plans:
                if _TOOLBOX.get(s) == "bphs":
                    plans[s] = [st for st in plans[s] if st.get("name") not in ("dasha_at", "transits_at")] + [
                        {"name": "dasha_at", "params": {"date": read["target_date"]}},
                        {"name": "transits_at", "params": {"date": read["target_date"]}}]
        if systems or cast:
            return _intent(read, systems, plans, cast, picks, system, dict(how, reused=True))
    systems, cast, picks = resolve(r.get("picks"))
    if lens:                                            # one tradition: what it picked elsewhere does not count
        systems = {lens: systems[lens]} if lens in systems else {}
    return _intent(read, systems, _plans(r.get("plans"), systems), cast, picks, system, how)
