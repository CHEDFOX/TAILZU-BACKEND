"""
PORTRAITS — Per-user, per-system, topic-sharded memory.

KEY: the VERIFIED account id when we have it ("uid:<supabase id>"), else the
birth-chart hash ("bh:<hash>"). Account-keyed memory is durable across devices
and small birth-data edits.

STORAGE: Postgres table `oracle_memory` when DATABASE_URL is set (survives server
rebuilds, multi-worker safe, shared by chat AND feature readings). Falls back to
the original per-file store (data/portraits/<hash>/<system>/<topic>.json) when the
DB is unavailable — memory never breaks the app. On read, DB wins and the legacy
filesystem fills any gaps, so nothing is lost while memory migrates to the DB.

Each (system, topic) is a separate packet — BPHS/KP/Western/Chinese/Mandala keep
distinct memories (different vocabularies + methods).

API (all async):
  load_portrait_block(birth_data, primary, secondary, system, user_id) → str   # chat context
  feature_memory_block(birth_data, system, user_id)                    → str   # feature-reading context
  update_user_portraits(birth_data, user_msg, oracle_reply, settings, system, user_id)
"""

import asyncio
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Dict, Optional

# Per-(key, system) asyncio locks that serialize the compatibility read-modify-write
# on the single event loop, so two concurrent checks can't clobber each other's entry.
_compat_locks: dict = {}


def _compat_lock(key: str, system: str):
    k = f"{key}:{system}"
    lock = _compat_locks.get(k)
    if lock is None:
        lock = asyncio.Lock()
        _compat_locks[k] = lock
        if len(_compat_locks) > 5000:   # bound growth (FIFO evict oldest, unlikely-held)
            for old in list(_compat_locks.keys())[:2500]:
                _compat_locks.pop(old, None)
    return lock

import httpx


def _portrait_dir() -> Path:
    """Where file-backed memory lives. It was a hard-coded server path created at
    import, so the module (and chat.py, which imports it outside any try) failed on
    any machine that could not write /var/www — the bot's host among them. Settings
    (.env) or the environment can move it; the server path stays the default."""
    import os
    try:
        from app.core.config import settings
        d = getattr(settings, "PORTRAIT_DIR", "") or ""
    except Exception:
        d = ""
    return Path(d or os.getenv("PORTRAIT_DIR") or "/var/www/jyotish/backend/data/portraits")


PORTRAIT_DIR = _portrait_dir()
try:
    PORTRAIT_DIR.mkdir(parents=True, exist_ok=True)
except Exception as _e:
    print(f"[Portraits] {PORTRAIT_DIR} is not writable ({_e}); file-backed memory is off, "
          f"the database store is unaffected")

SUGGESTED_TOPICS = [
    "marriage", "career", "wealth", "health", "spirituality",
    "timing", "remedies", "compatibility", "travel", "family",
    "personality", "general",
]

ALWAYS_LOAD = {"personality", "compatibility"}   # compatibility history rides along so the oracle can bring it up naturally

_TOPIC_ALIASES = {
    "love": "marriage", "relationship": "marriage", "spouse": "marriage",
    "partner": "marriage", "dating": "marriage",
    "job": "career", "work": "career", "profession": "career",
    "money": "wealth", "finance": "wealth", "investment": "wealth",
    "disease": "health", "illness": "health", "body": "health",
    "soul": "spirituality", "past_life": "spirituality",
    "dasha": "timing", "period": "timing", "phase": "timing",
    "remedy": "remedies", "mantra": "remedies", "gemstone": "remedies",
    "synastry": "compatibility", "match": "compatibility",
    "location": "travel", "city": "travel", "move": "travel",
}

_locks: Dict[str, Lock] = {}
_lock_lock = Lock()


def _topic_lock(user_hash: str, system: str, topic: str) -> Lock:
    key = f"{user_hash}:{system}:{topic}"
    with _lock_lock:
        if key not in _locks:
            _locks[key] = Lock()
            if len(_locks) > 5000:   # bound growth (FIFO evict oldest, unlikely-held)
                for old in list(_locks.keys())[:2500]:
                    if old != key:
                        _locks.pop(old, None)
        return _locks[key]


def _user_hash(birth_data: Dict) -> str:
    key = (
        f"{birth_data.get('year', 0)}-{birth_data.get('month', 0)}-"
        f"{birth_data.get('day', 0)}-{birth_data.get('hour', 0)}-"
        f"{birth_data.get('minute', 0)}-"
        f"{birth_data.get('lat', 0):.2f}-{birth_data.get('lng', 0):.2f}"
    )
    return hashlib.md5(key.encode()).hexdigest()[:12]


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", name.lower().replace(" ", "_")) or "general"


def normalize_topic(t: Optional[str]) -> str:
    t = _safe_name(t or "")
    if not t:
        return "general"
    return _TOPIC_ALIASES.get(t, t)


def _system_dir(user_hash: str, system: str) -> Path:
    d = PORTRAIT_DIR / user_hash / _safe_name(system)
    try:
        d.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass            # unwritable: reads find nothing, writes fail softly
    return d


def _packet_path(user_hash: str, system: str, topic: str) -> Path:
    return _system_dir(user_hash, system) / f"{_safe_name(topic)}.json"


def _read_packet(user_hash: str, system: str, topic: str) -> Dict:
    p = _packet_path(user_hash, system, topic)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def _write_packet(user_hash: str, system: str, topic: str, packet: Dict):
    p = _packet_path(user_hash, system, topic)
    try:
        p.write_text(json.dumps(packet, ensure_ascii=False, indent=None))
    except Exception as e:
        print(f"[Portraits] Write failed for {user_hash}/{system}/{topic}: {e}")


def _list_existing(user_hash: str, system: str) -> Dict[str, str]:
    sys_dir = PORTRAIT_DIR / user_hash / _safe_name(system)
    if not sys_dir.exists():
        return {}
    out = {}
    for f in sys_dir.glob("*.json"):
        try:
            d = json.loads(f.read_text())
            portrait = (d.get("portrait") or "").strip()
            if portrait:
                out[f.stem] = portrait
        except Exception:
            pass
    return out


# ═══════════════════════════════════════════════════════════════
# UNIFIED KEY + DB BACKEND (with filesystem fallback)
# ═══════════════════════════════════════════════════════════════
# The memory key is the VERIFIED account id when we have it (durable across
# devices and birth-data tweaks), else the birth-chart hash (legacy / anonymous).
# Storage is Postgres when DATABASE_URL is configured, so memory survives a server
# rebuild and is shared by chat + every feature. If the DB is unavailable we fall
# back to the original per-file store — the app never breaks over memory.


def memory_key(user_id: Optional[str] = None, birth_data: Optional[Dict] = None) -> str:
    if user_id:
        return f"uid:{user_id}"
    if birth_data:
        return f"bh:{_user_hash(birth_data)}"
    return ""


def _fs_id(user_id: Optional[str], birth_data: Optional[Dict]) -> str:
    """The file-store folder for this memory. An ACCOUNT gets its own folder, keyed by
    the account; birth-hash memory (no account) stays where it always was."""
    if user_id:
        return "acct_" + hashlib.md5(memory_key(user_id).encode()).hexdigest()[:16]
    return _user_hash(birth_data) if birth_data else ""


def _list_person(folder: str) -> Dict[str, str]:
    """{topic: portrait} across every system folder of one file-store folder; the most
    recently updated packet wins per topic."""
    root = PORTRAIT_DIR / folder
    best: Dict[str, tuple] = {}
    try:
        for f in root.glob("*/*.json"):
            try:
                d = json.loads(f.read_text())
            except Exception:
                continue
            portrait = (d.get("portrait") or "").strip()
            if portrait:
                ts = str(d.get("updated_at") or "")
                if f.stem not in best or ts >= best[f.stem][0]:
                    best[f.stem] = (ts, portrait)
    except Exception:
        return {}
    return {t: p for t, (_, p) in best.items()}


async def forget_person(user_id: Optional[str] = None, birth_data: Optional[Dict] = None) -> None:
    """Delete everything remembered about a person — the account's database rows and its
    file folder. For account deletion; never raises."""
    key = memory_key(user_id, birth_data)
    try:
        from app.core.db import pool
        p = await pool()
        async with p.acquire() as con:
            await con.execute("delete from oracle_memory where user_key=$1", key)
    except Exception:
        pass
    folder = _fs_id(user_id, birth_data) if user_id else ""
    if folder:
        try:
            import shutil
            shutil.rmtree(PORTRAIT_DIR / folder, ignore_errors=True)
        except Exception:
            pass


async def _db_all(user_key: str, system: str):
    """{topic: portrait} for this key+system from Postgres. Returns None (not {}) when
    the DB is unavailable, so callers can distinguish 'empty' from 'no DB' and fall
    back to the filesystem."""
    if not user_key:
        return None
    try:
        from app.core.db import pool
        p = await pool()
        async with p.acquire() as con:
            rows = await con.fetch(
                "select topic, portrait from oracle_memory where user_key=$1 and system=$2",
                user_key, _safe_name(system))
        return {r["topic"]: (r["portrait"] or "").strip()
                for r in rows if (r["portrait"] or "").strip()}
    except Exception:
        return None


async def _db_write(user_key: str, system: str, topic: str, portrait: str) -> bool:
    if not user_key:
        return False
    try:
        from app.core.db import pool
        p = await pool()
        async with p.acquire() as con:
            await con.execute(
                """insert into oracle_memory
                       (user_key, system, topic, portrait, message_count, created_at, updated_at)
                   values ($1, $2, $3, $4, 1, now(), now())
                   on conflict (user_key, system, topic) do update
                       set portrait = excluded.portrait,
                           message_count = oracle_memory.message_count + 1,
                           updated_at = now()""",
                user_key, _safe_name(system), _safe_name(topic), portrait)
        return True
    except Exception:
        return False


async def _db_all_person(user_key: str) -> Optional[Dict[str, str]]:
    """{topic: portrait} for this person across EVERY system. Memory is about the PERSON,
    not the astrology lens they happened to chat through — chat writes under its lens
    (often 'plutto'), so a feature reading under 'bphs' would otherwise find nothing.
    Most-recently-updated portrait wins per topic. Returns None when the DB is down."""
    if not user_key:
        return None
    try:
        from app.core.db import pool
        p = await pool()
        async with p.acquire() as con:
            rows = await con.fetch(
                "select topic, portrait from oracle_memory where user_key=$1 order by updated_at asc",
                user_key)
        return {r["topic"]: (r["portrait"] or "").strip()
                for r in rows if (r["portrait"] or "").strip()}   # later (newer) row wins per topic
    except Exception:
        return None


async def _all_portraits(user_id: Optional[str], birth_data: Optional[Dict], system: str) -> Dict[str, str]:
    """Merged {topic: portrait} for this PERSON (across every system): DB (account-durable)
    wins, the legacy filesystem store (birth-hash) fills in anything the DB doesn't have
    yet — so nothing is lost while memory migrates from disk to the DB. Person-scoped so
    the same memory reaches chat AND every feature regardless of the lens it was built in."""
    key = memory_key(user_id, birth_data)
    db = await _db_all_person(key)
    # filesystem fallback is legacy + per-system; merge the reading lens plus the common lenses
    fs = {}
    if birth_data and not user_id:   # birth-hash memory is shared by everyone with that birth — never merged into an account
        uh = _user_hash(birth_data)
        for s in {system, 'plutto', 'bphs'}:
            try:
                fs.update(_list_existing(uh, s))
            except Exception:
                pass
    elif user_id and db is None:
        # No database: an account's memory is file-backed in its own folder. Writes used
        # to land in the birth-hash folder, which account reads never consult (rightly —
        # it is shared by everyone with that birth), so without a database an account's
        # memory was write-only.
        fs.update(_list_person(_fs_id(user_id, birth_data)))
    if db is None:
        return fs                      # no DB → filesystem only (original behaviour)
    return {**fs, **db}                # DB wins per topic


# ═══════════════════════════════════════════════════════════════
# READ — used by pipeline to inject context
# ═══════════════════════════════════════════════════════════════

# The compatibility portrait stores ALL checks (never truncated). For the CHAT
# prompt we inject only the most recent few so the context stays bounded — nothing
# is deleted from storage; the oracle just doesn't need all of them every turn.
_COMPAT_INJECT_RECENT = 25


def _compat_for_context(portrait: str, n: int = _COMPAT_INJECT_RECENT) -> str:
    lines = portrait.split("\n")
    entries = [ln for ln in lines if ln.strip().startswith("-")]
    if len(entries) <= n:
        return portrait
    header = lines[0] if lines and lines[0].lower().startswith("compatibility") else "Compatibility checks (most recent last):"
    return header + "\n" + "\n".join(entries[-n:])


async def load_portrait_block(birth_data: Dict, primary: str,
                              secondary: Optional[str] = None,
                              system: str = "bphs",
                              user_id: Optional[str] = None) -> str:
    if not birth_data and not user_id:
        return ""

    topics_to_load = {normalize_topic(primary)}
    if secondary:
        topics_to_load.add(normalize_topic(secondary))
    topics_to_load.update(ALWAYS_LOAD)

    merged = await _all_portraits(user_id, birth_data, system)

    blocks = []
    for topic in sorted(topics_to_load):
        portrait = (merged.get(topic) or "").strip()
        if not portrait:
            continue
        if topic == "compatibility":
            portrait = _compat_for_context(portrait)   # store-all; inject recent only
        blocks.append(f"[{topic.upper()}] {portrait}")

    if not blocks:
        return ""

    return (
        "WHAT YOU KNOW ABOUT THIS PERSON (use naturally — never announce "
        "'we discussed' or 'last time', just speak as someone who already knows them):\n"
        + "\n".join(blocks)
    )


# Cross-topic themes a FEATURE reading benefits from (a life story, a past life,
# a dosha reading all speak better knowing the person's durable portrait).
FEATURE_TOPICS = ("personality", "general", "life", "spirituality", "career", "marriage")


async def record_compatibility(partner: str, summary: str, birth_data: Dict = None,
                               system: str = "bphs", user_id: Optional[str] = None,
                               score=None):
    """Remember a compatibility check the user ran with someone — who, and the gist —
    in a dedicated 'compatibility' portrait, so the oracle can later reference it
    ('you and Priya…') for a warmer, more personal experience. Deterministic (no LLM),
    keeps the most recent ~6 checks, dedupes by partner. Fully soft — never raises."""
    try:
        partner = (partner or "").strip()[:40]
        if not partner or (not birth_data and not user_id):
            return
        gist = (summary or "").strip().replace("\n", " ")
        if score is not None:
            gist = f"{score} — {gist}" if gist else str(score)
        gist = gist[:120]
        entry = f"- {partner}: {gist}" if gist else f"- {partner}"

        key = memory_key(user_id, birth_data)
        _p = partner.lower()
        # Serialize the whole read-modify-write for this user so two overlapping checks
        # can't each read the old value and clobber the other's entry.
        async with _compat_lock(key, system):
            merged = await _all_portraits(user_id, birth_data, system)
            cur = (merged.get("compatibility") or "").strip()
            # Dedup this partner regardless of whether the stored line has a colon
            # (a scoreless first check stores "- Priya", a later one "- Priya: 82 …").
            lines = [ln.strip() for ln in cur.split("\n")
                     if ln.strip().startswith("-")
                     and ln.strip().lower() != f"- {_p}"
                     and not ln.strip().lower().startswith(f"- {_p}:")]
            lines.append(entry)
            # STORE EVERY unique partner — no count cap, no size truncation, nothing
            # falls off. (Chat injection is windowed separately in load_portrait_block
            # so the prompt stays bounded; the stored record keeps them all.)
            header = "Compatibility checks (most recent last):\n"
            portrait = header + "\n".join(lines)

            wrote = await _db_write(key, system, "compatibility", portrait)
            uh = _fs_id(user_id, birth_data)
            if not wrote and uh:
                lock = _topic_lock(uh, system, "compatibility")
                with lock:
                    packet = _read_packet(uh, system, "compatibility") or {
                        "topic": "compatibility", "system": system, "user_hash": uh,
                        "created_at": datetime.now().isoformat(), "message_count": 0}
                    packet["portrait"] = portrait
                    packet["updated_at"] = datetime.now().isoformat()
                    packet["message_count"] = packet.get("message_count", 0) + 1
                    _write_packet(uh, system, "compatibility", packet)
    except Exception as e:
        print(f"[Portraits] record_compatibility failed: {e}")


async def feature_memory_block(birth_data: Dict, system: str = "bphs",
                               user_id: Optional[str] = None) -> str:
    """Compact 'what we already know about this person' block for FEATURE readings —
    the same durable memory the chat oracle builds, so the whole app speaks as one
    voice that knows the user. Empty string when there's nothing yet (graceful)."""
    if not birth_data and not user_id:
        return ""
    merged = await _all_portraits(user_id, birth_data, system)
    blocks = [f"[{t.upper()}] {merged[t].strip()}"
              for t in FEATURE_TOPICS if (merged.get(t) or "").strip()]
    if not blocks:
        return ""
    return (
        "WHAT YOU ALREADY KNOW ABOUT THIS PERSON (from their oracle conversations — "
        "weave it in naturally, never say 'we discussed' or 'last time'):\n"
        + "\n".join(blocks)
    )


def get_user_stats(birth_data: Dict, system: str = "bphs") -> Dict:
    if not birth_data:
        return {}
    uh = _user_hash(birth_data)
    existing = _list_existing(uh, system)
    return {"user_hash": uh, "system": system,
            "topics": list(existing.keys()), "topic_count": len(existing)}


# ═══════════════════════════════════════════════════════════════
# WRITE — LLM picks which packet(s) to update or create
# ═══════════════════════════════════════════════════════════════

UPDATE_PROMPT = """You maintain shorthand portraits of this client. One file per topic, within the {system} astrology system.

EXISTING PORTRAITS:
{existing_block}

NEW EXCHANGE:
USER: {user_message}
ORACLE: {oracle_response}

Decide where this fits:
- Continues an existing topic above → update that portrait.
- New topic → create one. Prefer a name from: {topic_list}.
- Cross-cutting personality observations → also update 'personality'.

Each portrait stays under 500 chars, dense shorthand. Match the format of the existing portraits.
If none exist yet, use this format:
S{{n}}|{{Mmm-yy}}|{{topic}}|{system}
Ask: subtopic(count,status)
Pred: event timeframe(status)
Rem: remedy(status)
Tone: what-works
Open: unresolved threads
Avoid: already-said

Return ONLY valid JSON:
{{"updates": [{{"topic": "career", "action": "update", "portrait": "..."}}]}}

Typically 1-2 updates. No prose, no markdown."""


async def update_user_portraits(
    birth_data: Dict,
    user_message: str,
    oracle_response: str,
    settings,
    system: str = "bphs",
    user_id: Optional[str] = None,
):
    if (not birth_data and not user_id) or not user_message or not oracle_response:
        return

    key = memory_key(user_id, birth_data)
    uh = _fs_id(user_id, birth_data)       # the file-store folder, used only without a database
    existing = await _all_portraits(user_id, birth_data, system)
    # The compatibility record is kept by record_compatibility, deterministically, and
    # holds every partner ever checked. Shown here, the model could "update" it — and
    # every portrait it writes is cut to 500 characters, so the list could be wiped.
    # It is neither shown nor writable here; this also keeps the prompt bounded.
    existing = {t: p for t, p in existing.items() if t != "compatibility"}

    if existing:
        existing_block = "\n\n".join(f"[{t}]\n{p}" for t, p in existing.items())
    else:
        existing_block = "(no existing portraits yet for this system)"

    prompt = (UPDATE_PROMPT
              .replace("{system}", system)
              .replace("{existing_block}", existing_block)
              .replace("{user_message}", user_message[:400])
              .replace("{oracle_response}", oracle_response[:1000])
              .replace("{topic_list}", ", ".join(SUGGESTED_TOPICS)))

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    # Dense structured shorthand, not prose the reader sees: the fast
                    # machinery model, not OPENROUTER_MODEL (the feature responder).
                    "model": (getattr(settings, "OPENROUTER_MODEL_CHAT_FAST", "")
                              or getattr(settings, "OPENROUTER_MODEL_FAST", "")
                              or settings.OPENROUTER_MODEL),
                    "messages": [
                        {"role": "system", "content":
                            "Write dense shorthand portraits matching the format of the existing ones. 500 chars max each."},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 500,
                    "temperature": 0.3,
                },
                timeout=25.0,
            )
        if resp.status_code != 200:
            return

        raw = resp.json()["choices"][0]["message"]["content"].strip()
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            s, e = cleaned.find('{'), cleaned.rfind('}')
            if s >= 0 and e > s:
                try:
                    parsed = json.loads(cleaned[s:e+1])
                except Exception:
                    return
            else:
                return
    except Exception as e:
        print(f"[Portraits] LLM failed: {e}")
        return

    updates = parsed.get("updates", []) if isinstance(parsed, dict) else []
    if not isinstance(updates, list):
        return

    now = datetime.now().isoformat()
    for u in updates:
        if not isinstance(u, dict):
            continue
        topic = normalize_topic(u.get("topic", ""))
        portrait_text = (u.get("portrait") or "").strip()[:500]
        if not topic or not portrait_text or topic == "compatibility":
            continue
        action = u.get("action", "update")

        # DB first (account-durable, shared with features). If the DB is
        # unavailable, fall back to the per-file store so memory still persists.
        wrote = await _db_write(key, system, topic, portrait_text)
        if not wrote and uh:
            lock = _topic_lock(uh, system, topic)
            with lock:
                packet = _read_packet(uh, system, topic)
                if not packet:
                    packet = {
                        "topic": topic, "system": system, "user_hash": uh,
                        "created_at": now, "message_count": 0,
                    }
                packet["portrait"] = portrait_text
                packet["updated_at"] = now
                packet["message_count"] = packet.get("message_count", 0) + 1
                packet["last_action"] = action
                _write_packet(uh, system, topic, packet)
