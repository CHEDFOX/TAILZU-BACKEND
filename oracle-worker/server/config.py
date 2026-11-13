"""The worker's own settings, and the ones the engine needs before it is first imported.

The engine (app/, Plutto's code) reads its settings from the environment when app.core.config is imported. It insists on three keys; the two
the worker can do without get an empty value here, and ORACLE_PROFILE=bot is the default, so the engine runs as the X0 bot: the subsystem
router, no app screens, follow-up hooks, and the reply on Claude Sonnet 5.5 at low thinking with spares from other companies. Anything set
in the environment wins.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# The engine is Plutto's whole backend config: it would take a database, Supabase, payment and push keys from the environment
# if it found them, and its memory store creates Plutto's tables on any DATABASE_URL. The worker keeps nothing and charges
# nobody, so those names never reach it, whatever environment it is started in (docker-compose gives it the server's tulmi/.env): the memory
# is files in /tmp instead.
NOT_THE_WORKERS = ("DATABASE_URL", "SUPABASE_", "REVENUECAT_", "RAZORPAY_", "WEB_PUSH_", "NOTIFY_", "ADMIN_SECRET")
for _name in [n for n in os.environ if n.startswith(NOT_THE_WORKERS)]:
    del os.environ[_name]

for _name, _value in (("OPENAI_API_KEY", ""), ("GOOGLE_PLACES_API_KEY", ""), ("ORACLE_PROFILE", "bot"),
                      ("PORTRAIT_DIR", "/tmp/oracle-portraits"), ("ORACLE_VECTORS_PATH", "/tmp/oracle-vectors.json")):
    os.environ.setdefault(_name, _value)


def _int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except ValueError:
        return default
    return max(lo, min(hi, value))


@dataclass(frozen=True)
class Settings:
    """secret        ORACLE_WORKER_SECRET, shared with the backend, 32 characters or more
    concurrency      answers at once; one more waits up to `queue_seconds`, then is told the worker is busy
    body_max         the most bytes one request may carry"""

    secret: bytes = b""
    skew_seconds: int = 60
    nonce_ttl_seconds: int = 120
    concurrency: int = 8
    queue_seconds: int = 20
    body_max: int = 256 * 1024


def load() -> Settings:
    return Settings(
        secret=os.environ.get("ORACLE_WORKER_SECRET", "").encode(),
        concurrency=_int("ORACLE_WORKER_CONCURRENCY", 8, 1, 64),
        queue_seconds=_int("ORACLE_WORKER_QUEUE_SECONDS", 20, 1, 120),
    )
