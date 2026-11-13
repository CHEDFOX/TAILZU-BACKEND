"""
ONE WAY TO CALL A MODEL, WITH SPARES — so the oracle never goes quiet because one model did.

Each ROLE has a chain of models, best first:
  fast   the machinery that decides what to read (the router's pick, the planner, the verdicts)
  chat   the reply the person reads
  deep   the reply on the deepest turns (the chat chain when no deep model is set)
set as LLM_CHAIN_FAST / LLM_CHAIN_CHAT / LLM_CHAIN_DEEP, comma-separated. Empty → the one model configured today
(OPENROUTER_MODEL_CHAT_FAST, OPENROUTER_MODEL_CHAT, OPENROUTER_MODEL_CHAT_DEEP), so nothing changes until a chain is
set. A model is an OpenRouter id ("anthropic/claude-sonnet-5.5"), or "openai:<model>" to call OpenAI directly with
OPENAI_API_KEY: a spare on another account still answers when OpenRouter is down or out of credit. "@low" (or any
effort the model takes) sets how hard it thinks first: Sonnet 5.5 and Gemini 3.8 Flash always think, and at their
defaults (high, medium) the live test waited 15 seconds for a first word and saw replies cut off when the thinking
ate the length budget; at "@low" the quality held, the wait dropped to 2–7 seconds and nothing was cut.

  * A request goes to the session's primary. If it fails (an error, a timeout, an empty or unusable answer), the
    same request goes straight to the next model, and on down the chain.
  * The model that failed is then CHECKED, in the background, with a one-word request. If the check fails too, the
    model is down: every session skips it for LLM_DOWN_MINUTES, and the session it failed in takes the model that
    answered as its primary for the rest of the session. If the check passes, it was a blip and nothing changes.
  * A session that switched keeps its new primary, so a conversation keeps one voice. A new session starts at the
    top of the chain, skipping a model that is down; once the down time is over, the model is tried again.
  * When every model fails: ModelsUnavailable. The caller says so; nothing is made up in its place.

Logs: journalctl -u plutto-api | grep '\\[llm\\]'
"""
import asyncio
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

_TRANSIENT = {408, 409, 425, 429, 500, 502, 503, 504}
_PROVIDERS = {
    "openrouter": ("https://openrouter.ai/api/v1/chat/completions", "OPENROUTER_API_KEY"),
    "openai": ("https://api.openai.com/v1/chat/completions", "OPENAI_API_KEY"),
}
_DOWN: Dict[str, float] = {}                                  # model → when it may be tried again (monotonic)
_CHECKING: Dict[str, List[Tuple[str, str, str]]] = {}         # model under check → (session, role, answered by)
_SESSIONS: "OrderedDict[str, Dict[str, str]]" = OrderedDict()  # session → role → its primary
_MAX_SESSIONS = 20000
_TASKS: set = set()                                           # running checks, held so they are not collected


class ModelsUnavailable(Exception):
    """Every model in the role's chain failed this request."""


def _settings():
    from app.core.config import settings
    return settings


def _setting(name: str) -> str:
    return str(getattr(_settings(), name, "") or "").strip()


def _split(raw: str) -> List[str]:
    return list(dict.fromkeys(m.strip() for m in str(raw or "").split(",") if m.strip()))


def chain(role: str) -> List[str]:
    """The role's models, best first."""
    base = _setting("OPENROUTER_MODEL")
    if role == "fast":
        one = (_setting("OPENROUTER_MODEL_CHAT_FAST") or _setting("OPENROUTER_MODEL_FAST")
               or _setting("OPENROUTER_MODEL_CHAT") or base)
        return _split(_setting("LLM_CHAIN_FAST")) or ([one] if one else [])
    if role == "deep":
        deep = _setting("OPENROUTER_MODEL_CHAT_DEEP")
        return _split(_setting("LLM_CHAIN_DEEP")) or ([deep] if deep else chain("chat"))
    one = _setting("OPENROUTER_MODEL_CHAT") or base
    return _split(_setting("LLM_CHAIN_CHAT")) or ([one] if one else [])


def has_deep() -> bool:
    return bool(_setting("LLM_CHAIN_DEEP") or _setting("OPENROUTER_MODEL_CHAT_DEEP"))


def _effort(model: str) -> Tuple[str, str]:
    """"anthropic/claude-sonnet-5.5@low" → ("anthropic/claude-sonnet-5.5", "low")."""
    name, _, effort = model.partition("@")
    return name.strip(), effort.strip().lower()


def is_down(model: str) -> bool:
    model = _effort(model)[0]                # a model is up or down whatever effort it is asked to think at
    until = _DOWN.get(model)
    if until is None:
        return False
    if time.monotonic() >= until:
        _DOWN.pop(model, None)
        return False
    return True


def primary(role: str, session: Optional[str] = None) -> Optional[str]:
    """The model this session's next request goes to first."""
    seq = order(role, session)
    return seq[0] if seq else None


def order(role: str, session: Optional[str] = None) -> List[str]:
    """The models to try for one request: the session's primary first, then the chain in order. A model that is down
    goes last, tried only if every other one fails."""
    c = chain(role)
    first = _SESSIONS.get(session, {}).get(role) if session else None
    seq = ([first] if first in c else []) + [m for m in c if m != first]
    up = [m for m in seq if not is_down(m)]
    return up + [m for m in seq if m not in up]


def _target(model: str) -> Tuple[str, str, Dict[str, str], bool, bool]:
    """(url, the provider's name for the model, headers, whether it is OpenRouter, whether there is a key)."""
    model = _effort(model)[0]
    head, sep, rest = model.partition(":")
    if sep and head in _PROVIDERS and "/" not in head:   # "openai:gpt-…"; OpenRouter ids keep ":free" and the like
        provider, name = head, rest
    else:
        provider, name = "openrouter", model
    url, key_name = _PROVIDERS[provider]
    key = _setting(key_name)
    return url, name, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, \
        provider == "openrouter", bool(key)


def _body(name: str, is_openrouter: bool, payload: Dict, effort: str = "") -> Dict:
    body = dict(payload, model=name)
    if effort and is_openrouter:
        body["reasoning"] = {"effort": effort}   # the model's own effort wins over the caller's default
    if not is_openrouter:
        body.pop("reasoning", None)          # OpenRouter's own field
        body.pop("usage", None)              # OpenRouter's own cost accounting
        if body.get("stream"):
            body["stream_options"] = {"include_usage": True}   # the tokens, in the stream's last chunk
        body.pop("temperature", None)        # some OpenAI models take only their default
        if "max_tokens" in body:
            body["max_completion_tokens"] = body.pop("max_tokens")
        if effort:
            body["reasoning_effort"] = effort
    return body


def _passes(n_models: int, passes: Optional[int]) -> List[float]:
    """The pause before each pass over the models. A lone model keeps the retries it always had; with spares, each
    model is tried once, since moving on is quicker than waiting."""
    plan = [0.0, 0.8, 1.6, 3.2] if n_models == 1 else [0.0]
    return plan[:passes] if passes else plan


# One attempt at one model: (answered, what it answered, worth retrying the same model, why it failed).
Attempt = Callable[[str], Awaitable[Tuple[bool, Any, bool, str]]]


async def _run(role: str, session: Optional[str], attempt: Attempt, passes: Optional[int] = None):
    seq = order(role, session)
    if not seq:
        raise ModelsUnavailable(f"no model is configured for '{role}'")
    failed: List[str] = []
    retry = list(seq)
    last = ""
    for i, pause in enumerate(_passes(len(seq), passes)):
        if i and not retry:
            break
        if pause:
            await asyncio.sleep(pause)
        for model in list(retry):
            ok, out, transient, why = await attempt(model)
            if ok:
                _answered(role, session, model, failed)
                return out, model
            last = f"{model}: {why}"
            print(f"[llm] {role}: {model} failed ({why})")
            if model not in failed:
                failed.append(model)
            if not transient:
                retry.remove(model)
    _answered(role, session, None, failed)
    raise ModelsUnavailable(last)


def _answered(role: str, session: Optional[str], model: Optional[str], failed: List[str]) -> None:
    """After a request: check every model that failed it, and keep the session on the model that answered when a
    model ahead of it in the chain is down."""
    for f in failed:
        if f != model:
            _check_later(f, role, session, model)
    if model and session:
        c = chain(role)
        ahead = c[:c.index(model)] if model in c else []
        if any(is_down(m) for m in ahead):
            _pin(session, role, model)


def _pin(session: Optional[str], role: str, model: Optional[str]) -> None:
    if not session or not model:
        return
    roles = _SESSIONS.setdefault(session, {})
    if roles.get(role) != model:
        roles[role] = model
        print(f"[llm] session {str(session)[:8]}: '{role}' now runs on {model} for the rest of the session")
    _SESSIONS.move_to_end(session)
    while len(_SESSIONS) > _MAX_SESSIONS:
        _SESSIONS.popitem(last=False)


def _check_later(model: str, role: str, session: Optional[str], answered_by: Optional[str]) -> None:
    waiter = (session, role, answered_by) if session and answered_by else None
    model = _effort(model)[0]
    if model in _CHECKING:                   # a check is already running: this session waits on its verdict
        if waiter:
            _CHECKING[model].append(waiter)
        return
    if is_down(model):                       # already checked and down
        if waiter:
            _pin(*waiter)
        return
    _CHECKING[model] = [waiter] if waiter else []
    try:
        task = asyncio.get_running_loop().create_task(_check(model))
    except RuntimeError:
        _CHECKING.pop(model, None)
        return
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def _check(model: str) -> None:
    ok = await ping(model)
    waiting = _CHECKING.pop(model, [])
    if ok:
        print(f"[llm] {model} answered its check: a blip, nothing changes")
        return
    minutes = int(getattr(_settings(), "LLM_DOWN_MINUTES", 10) or 10)
    _DOWN[model] = time.monotonic() + 60 * minutes
    print(f"[llm] {model} failed its check: down for {minutes} min")
    for waiter in waiting:
        _pin(*waiter)


async def ping(model: str, timeout: float = 10.0) -> bool:
    """Is the model answering at all? A one-word request; any proper answer counts."""
    url, name, headers, is_openrouter, has_key = _target(model)
    if not has_key:
        return False
    body = _body(name, is_openrouter, {"messages": [{"role": "user", "content": "Say ok."}], "max_tokens": 16})
    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, headers=headers, json=body)
        return r.status_code == 200
    except Exception:
        return False


async def complete(role: str, messages: List[Dict], *, session: Optional[str] = None, max_tokens: int = 800,
                   temperature: Optional[float] = None, timeout: float = 30.0, extra: Optional[Dict] = None,
                   parse: Optional[Callable[[str], Any]] = None, passes: Optional[int] = None) -> Tuple[Any, str]:
    """One request with failover: (the answer, the model that gave it). Without `parse` the answer is the text, and
    an empty text is a failure. With it, `parse(text)` turns the text into what the caller needs and returns None
    when it cannot be used: an unusable answer is a failure too, so the next model gets the request. Raises
    ModelsUnavailable when every model fails."""
    import httpx
    payload: Dict[str, Any] = {"messages": messages, "max_tokens": max_tokens, **(extra or {})}
    if temperature is not None:
        payload["temperature"] = temperature
    async with httpx.AsyncClient(timeout=timeout) as client:
        async def attempt(model: str):
            url, name, headers, is_openrouter, has_key = _target(model)
            if not has_key:
                return False, None, False, "no API key for it"
            body = _body(name, is_openrouter, payload, _effort(model)[1])
            try:
                r = await client.post(url, headers=headers, json=body)
                if r.status_code == 400 and "reasoning" in body:     # a model that will not take the field
                    r = await client.post(url, headers=headers, json={k: v for k, v in body.items() if k != "reasoning"})
            except Exception as e:
                return False, None, True, f"{type(e).__name__}: {str(e)[:100]}"
            if r.status_code != 200:
                return False, None, r.status_code in _TRANSIENT, f"HTTP {r.status_code}: {r.text[:120]}"
            try:
                text = (((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
            except Exception:
                text = ""
            if parse is None:
                return (True, text, False, "") if text else (False, None, False, "an empty answer")
            try:
                out = parse(text)
            except Exception:
                out = None
            return (True, out, False, "") if out is not None else (False, None, False, "an unusable answer")
        return await _run(role, session, attempt, passes)


async def open_stream(client, role: str, payload: Dict, session: Optional[str] = None,
                      passes: Optional[int] = None):
    """Open a streaming reply on the first model that answers: (response, its stream context, the model). The same
    failover as complete(), up to the first word: a model that fails mid-reply is not swapped, because words already
    shown cannot be taken back. The caller reads the response and closes the context. Raises ModelsUnavailable."""
    async def attempt(model: str):
        url, name, headers, is_openrouter, has_key = _target(model)
        if not has_key:
            return False, None, False, "no API key for it"
        cm = client.stream("POST", url, headers=headers,
                           json=_body(name, is_openrouter, dict(payload, stream=True), _effort(model)[1]))
        try:
            r = await cm.__aenter__()
        except Exception as e:
            return False, None, True, f"{type(e).__name__}: {str(e)[:100]}"
        if r.status_code == 200:
            return True, (r, cm), False, ""
        try:
            detail = (await r.aread())[:120].decode("utf-8", "replace")
        except Exception:
            detail = ""
        await cm.__aexit__(None, None, None)
        return False, None, r.status_code in _TRANSIENT, f"HTTP {r.status_code}: {detail}"
    (resp, cm), model = await _run(role, session, attempt, passes)
    return resp, cm, model


def status() -> Dict:
    """For a health page or a log line: each role's chain, and which models are down."""
    now = time.monotonic()
    return {"chains": {r: chain(r) for r in ("fast", "chat", "deep")},
            "down": {m: round((t - now) / 60, 1) for m, t in _DOWN.items() if t > now},
            "sessions_switched": len(_SESSIONS)}
