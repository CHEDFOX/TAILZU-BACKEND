"""
THE SUBSYSTEM INDEX — every place a question can land, each tagged with its tradition, and the semantic search that
finds the few dozen a question is about, so the AI never has to read them all.

A question is answered by SUBSYSTEMS, not by traditions as a whole: Vedic's marriage chart (navamsa), KP's event
promise, Western's solar return, the Mayan day-sign. The index lists all of them, about 300:

  * each engine tradition's sections (Vedic 87, Western 36, Chinese 32, astrocartography 21, KP 19), one item each
  * each of the 97 wider-council systems as ONE item: its whole profile is computed in one go, so its facets are
    never chosen apart
  * the six decks a person can ask to have drawn

Every item carries its tradition, so a pick says where it belongs. There is no list of topics anywhere: people can
ask anything, and a question is matched to what each subsystem SAYS IT IS, by meaning, so a question nobody foresaw
still lands near what can answer it. A subsystem is rarely about one thing (a house is any area of life; a whole system
reads character, love and work at once), and one point in the space of meaning would sit in the middle of all of
them, near none. So each item has SPOTS, one per part of itself: its whole description, each part of it, each of the
twelve houses of the house subsystem (from Plutto's own table of what each house signifies), each facet of a whole
system. The spots are embedded once (cached on disk, rebuilt only when the index changes); a question is embedded
once, and an item is as near as its nearest spot. The nearest items are the shortlist, a fair share of each kind: 20
subsystems and 10 whole systems. The router (oracle/direct.py) then lets the AI choose among those. Always on the
shortlist too: a system the person names, the general tools that read any question (GENERAL), and the six draws. If
embeddings are unavailable the shortlist is None and the router shows the AI the whole index.
"""
import asyncio
import base64
import hashlib
import json
import math
import re
import sys
import weakref
from array import array
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:                                    # the scoring is a matrix product with numpy, plain Python without it
    import numpy as _np
except Exception:                       # pragma: no cover
    _np = None

ENGINES = ("bphs", "kp", "western", "chinese", "mandala")
DRAWS = {"tarot": "Tarot", "iching": "I Ching", "runes": "Runes", "ogham": "Ogham", "lenormand": "Lenormand",
         "geomancy": "Geomancy"}
_DRAW_WORDS = {"tarot": "tarot cards, pull a card", "iching": "the I Ching, throw the coins, a hexagram",
               "runes": "the runes, cast the runes", "ogham": "the Ogham staves",
               "lenormand": "Lenormand cards", "geomancy": "geomancy, the sixteen figures"}

# The general tools: they read any question, whatever it is about. A house is any area of life, the periods time
# anything, the transits are the present, and the chart of a moment answers any question put to it. They are always
# on the shortlist, so however unusual the question, the AI has a way to read it. This is not a list of topics: the
# rest of the shortlist is found by meaning, from what each subsystem says it is.
GENERAL = ("bphs.house_detail:N", "bphs.dashas_full", "bphs.transits", "bphs.chart_promise", "bphs.prashna",
           "kp.event_promise", "kp.horary", "western.western_horary")

_ITEMS: Optional[List[Dict]] = None
_SPOTS: Optional[List[Tuple[int, str]]] = None


def items() -> List[Dict]:
    """The whole index: {id, system, section, line (for the AI), spots (for meaning: one per thing it answers), text
    (its first spot: what it is)}; built once from the registry. The draws have no spots: they are never searched for,
    they are always on offer."""
    global _ITEMS
    if _ITEMS is not None:
        return _ITEMS
    from .systems_registry import SYSTEMS, _kind_and_region
    try:
        from .section_catalog import describe_list, describe
    except Exception:
        describe_list, describe = None, (lambda _s: "")
    out: List[Dict] = []
    for sid in ENGINES:
        label = SYSTEMS[sid]["label"]
        names = [x.strip() for x in str(SYSTEMS[sid]["sections"]).replace("\n", " ").split(",") if x.strip()]
        desc = {}
        if describe_list:
            for line in describe_list(names).splitlines():
                if " — " in line:
                    n, d = line.strip().split(" — ", 1)
                    desc[n.strip()] = d.strip()
        for name in names:
            d = desc.get(name, name.replace("_", " "))
            short = d.split(" — ")[0]
            short = short if len(short) <= 70 else short[:70].rsplit(" ", 1)[0] + "…"
            hint = " (give the house number: house_detail:7)" if name.endswith(":N") else ""
            head = f"{label} · {name.split(':')[0].replace('_', ' ')}"
            parts = [x.strip() for x in re.split(r" — |; ", d) if x.strip()]
            spots = [f"{head}: {d}"] + ([f"{head}: {x}" for x in parts] if len(parts) > 1 else [])
            if name == "house_detail:N":
                spots += _house_spots(head)
            out.append({"id": f"{sid}.{name}", "system": sid, "section": name, "spots": list(dict.fromkeys(spots)),
                        "text": spots[0], "line": f"{sid}.{name} | {label}: {short}{hint}"})
    for sid, sp in SYSTEMS.items():
        if sid in ENGINES:
            continue
        kind, region = _kind_and_region(sid)
        meta = ", ".join(x for x in (kind, region) if x)
        facet_ids = list(dict.fromkeys(x.strip().split(":")[0] for x in str(sp["sections"]).replace("\n", " ").split(",") if x.strip()))
        facets = ", ".join(f.replace("_", " ") for f in facet_ids)
        names = [a for a in dict.fromkeys(a for a in (sp.get("aliases") or []) if a)
                 if a.lower() not in (sid, str(sp["label"]).lower())][:5]
        also = f"; also called {', '.join(names)}" if names else ""
        whole = f"{sp['label']}" + (f" ({meta})" if meta else "") + f": {facets}{also}"
        spots = [whole] + [f"{sp['label']} · {f.replace('_', ' ')}" + (f": {describe(f)}" if describe(f) else "")
                           for f in facet_ids]
        out.append({"id": sid, "system": sid, "section": None, "spots": list(dict.fromkeys(spots)), "text": whole,
                    "line": f"{sid} | {sp['label']}" + (f" ({meta})" if meta else "") + f": whole profile, {facets}{also}"})
    for deck, title in DRAWS.items():
        out.append({"id": f"draw.{deck}", "system": None, "section": None, "cast": deck, "spots": [], "text": "",
                    "line": f"draw.{deck} | {title}: a draw laid for them, only when they ask for {_DRAW_WORDS[deck]}"})
    _ITEMS = out
    return out


def _house_spots(head: str) -> List[str]:
    """The house subsystem is twelve in one: a spot for each house, from what Plutto's own table says it signifies."""
    try:
        from app.services.core.constants import HOUSES
    except Exception:
        return []
    return [f"{head} {n}, {h.get('meaning', '')}: " + ", ".join(str(x).lower() for x in h.get("signifies") or [])
            for n, h in sorted(HOUSES.items())]


def _spots() -> List[Tuple[int, str]]:
    """Every spot in the index, flat: (the item it belongs to, its text)."""
    global _SPOTS
    if _SPOTS is None:
        _SPOTS = [(i, t) for i, it in enumerate(items()) for t in it["spots"]]
    return _SPOTS


def by_id() -> Dict[str, Dict]:
    return {it["id"]: it for it in items()}


# ── Meaning vectors ────────────────────────────────────────────────────────────────────────────────────────────
def _cfg():
    from app.core.config import settings
    return {"model": getattr(settings, "ORACLE_EMBED_MODEL", "") or "text-embedding-3-small",
            "url": getattr(settings, "ORACLE_EMBED_URL", "") or "https://api.openai.com/v1/embeddings",
            "key": getattr(settings, "ORACLE_EMBED_KEY", "") or getattr(settings, "OPENAI_API_KEY", "") or "",
            "dims": int(getattr(settings, "ORACLE_EMBED_DIMS", 512) or 512),
            "path": getattr(settings, "ORACLE_VECTORS_PATH", "") or ""}


async def embed(texts: List[str]) -> Optional[List[List[float]]]:
    """Meaning vectors for texts (unit length), or None when the embeddings service cannot be reached."""
    cfg = _cfg()
    if not cfg["key"] or not texts:
        return None
    import httpx
    out: List[List[float]] = []
    try:
        async with httpx.AsyncClient() as client:
            for i in range(0, len(texts), 128):
                body = {"model": cfg["model"], "input": texts[i:i + 128]}
                if cfg["dims"] and cfg["model"].startswith("text-embedding-3"):
                    body["dimensions"] = cfg["dims"]
                r = await client.post(cfg["url"], json=body, timeout=20.0,
                                      headers={"Authorization": f"Bearer {cfg['key']}", "Content-Type": "application/json"})
                if r.status_code != 200:
                    print(f"[subsystems] embeddings HTTP {r.status_code}: {r.text[:160]}")
                    return None
                out += [d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])]
    except Exception as e:
        print(f"[subsystems] embeddings failed: {str(e)[:160]}")
        return None
    return [_unit(v) for v in out]


def _unit(v: List[float]) -> List[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _signature() -> str:
    cfg = _cfg()
    idx = items()
    raw = cfg["model"] + "|" + str(cfg["dims"]) + "|" + "\n".join(idx[i]["id"] + "=" + t for i, t in _spots())
    return hashlib.sha1(raw.encode()).hexdigest()


def _pack(vs) -> str:
    a = array("f", (float(x) for v in vs for x in v))
    if sys.byteorder == "big":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode()


def _unpack(blob: str, n: int):
    a = array("f")
    a.frombytes(base64.b64decode(blob))
    if sys.byteorder == "big":
        a.byteswap()
    if not n or not len(a) or len(a) % n:
        return None
    d = len(a) // n
    return [a[i * d:(i + 1) * d].tolist() for i in range(n)]


def _scores(qv: List[float], V) -> List[float]:
    """The question's nearness to every spot (unit vectors, so the dot product is the cosine)."""
    if _np is not None and isinstance(V, _np.ndarray):
        return (V @ _np.asarray(qv, dtype=_np.float32)).tolist()
    return [sum(a * b for a, b in zip(qv, v)) for v in V]


def _cache_path() -> Path:
    p = _cfg()["path"]
    if p:
        return Path(p)
    return Path(__file__).resolve().parents[3] / "data" / "oracle_subsystem_vectors.json"


_VECTORS = None                         # one vector per spot: a float32 matrix with numpy, lists without
_VECTORS_SIG = ""
_LOCKS: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()     # one per event loop


async def vectors():
    """The spots' vectors, in _spots() order: from memory, else the disk cache when it matches this index, else
    embedded now (and saved). None when they cannot be had; the router then shows the whole index. Questions that
    arrive together before the vectors exist wait for one embedding of the index, not one each."""
    sig = _signature()
    if _VECTORS is not None and _VECTORS_SIG == sig:
        return _VECTORS
    loop = asyncio.get_running_loop()
    lock = _LOCKS.get(loop)
    if lock is None:
        lock = _LOCKS[loop] = asyncio.Lock()
    async with lock:
        return await _load_or_embed(sig)


def _keep(vs, sig: str):
    global _VECTORS, _VECTORS_SIG
    _VECTORS = _np.asarray(vs, dtype=_np.float32) if _np is not None else vs
    _VECTORS_SIG = sig
    return _VECTORS


async def _load_or_embed(sig: str):
    if _VECTORS is not None and _VECTORS_SIG == sig:      # another question made them while this one waited
        return _VECTORS
    path, n = _cache_path(), len(_spots())
    try:
        cached = json.loads(path.read_text())
        if cached.get("signature") == sig and cached.get("count") == n:
            got = _unpack(cached["vectors"], n)
            if got:
                return _keep(got, sig)
    except Exception:
        pass
    got = await embed([t for _, t in _spots()])
    if not got or len(got) != n:
        return None
    kept = _keep(got, sig)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"signature": sig, "count": n, "dims": len(got[0]), "vectors": _pack(got)}))
    except Exception as e:
        print(f"[subsystems] could not save the vectors ({str(e)[:120]}); they stay in memory")
    return kept


# ── The shortlist ──────────────────────────────────────────────────────────────────────────────────────────────
async def shortlist(message: str, history: Optional[List] = None, k: int = 30,
                    only: Optional[str] = None) -> Optional[List[Dict]]:
    """The k index items nearest in meaning to the question (with the last thing they said, for a follow-up), most
    relevant first: an item is as near as its nearest spot, so a subsystem that answers many things is found from any
    of them. A fair share of each kind: two thirds subsystems, one third whole systems, so neither crowds the other
    out. Plus every system the person named, the general tools (GENERAL: they read any question), and the six draws
    (a draw is an act, not a subsystem: it must be there to pick whenever they ask for one, however the question is
    worded). `only` keeps the search inside one tradition. None when there are no vectors."""
    V = await vectors()
    if V is None:
        return None
    prev = ""
    for h in reversed(history or []):
        if isinstance(h, dict) and h.get("role", "user") == "user" and str(h.get("content") or "").strip():
            prev = str(h["content"])[:300]
            break
    query = (message or "")[:1500] + (f"\n(earlier they asked: {prev})" if prev and len(message or "") < 80 else "")
    q = await embed([query])
    if not q:
        return None
    idx = items()
    near: Dict[int, float] = {}
    for (i, _), score in zip(_spots(), _scores(q[0], V)):
        if (only is None or idx[i]["system"] == only) and score > near.get(i, -2.0):
            near[i] = score
    ranked = sorted(near, key=near.get, reverse=True)
    if only is None:
        whole_k = k // 3
        picked = ([i for i in ranked if idx[i]["section"] is not None][:k - whole_k] +
                  [i for i in ranked if idx[i]["section"] is None][:whole_k])
        picked.sort(key=near.get, reverse=True)
    else:
        picked = ranked[:k]
    chosen = [idx[i] for i in picked]
    if only is None:
        from .systems_registry import detect_named_systems
        for sid in detect_named_systems(message or ""):   # what they named is there: its item, or its best sections
            if sid in ENGINES:
                best = [idx[i] for i in ranked if idx[i]["system"] == sid][:8]
            else:
                best = [it for it in idx if it["id"] == sid]
            chosen += [it for it in best if it not in chosen]
    general = [by_id()[g] for g in GENERAL if g in by_id()]
    chosen += [it for it in general if it not in chosen and (only is None or it["system"] == only)]
    return chosen + [it for it in idx if it.get("cast")]
