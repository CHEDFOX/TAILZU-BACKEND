"""WHO MAY CALL THE WORKER: A SIGNATURE OVER THE TIME, A NONCE, THE METHOD, THE PATH AND QUERY, AND THE BODY.

The VPS signs every request with the shared secret (MEDIA_WORKER_SECRET), HMAC-SHA256 in hex, over these lines joined by "\\n":

    v1 / timestamp / nonce / METHOD / path with its query string / SHA-256 of the body in hex

and sends X-Tailzu-Timestamp (seconds since the epoch), X-Tailzu-Nonce (16 random bytes in hex) and X-Tailzu-Signature. The worker refuses a
timestamp more than 60 seconds from its own clock, a nonce it has seen in the last two minutes, and a signature that does not match, so a captured
request cannot be sent again, a body cannot be swapped, and a path or a query cannot be changed. The comparison takes the same time whatever the
signature. Mirrors src/media/worker.ts (tulmi), and tests/test_security.py holds the two to one known signature.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
from typing import Mapping

from .errors import WorkerError

VERSION = "v1"
_NONCE = re.compile(r"^[0-9a-f]{16,64}$")
_SIG = re.compile(r"^[0-9a-f]{64}$")


def signed_lines(timestamp: int, nonce: str, method: str, path_with_query: str, body_sha256_hex: str) -> bytes:
    return "\n".join([VERSION, str(timestamp), nonce, method.upper(), path_with_query, body_sha256_hex]).encode()


def sign(secret: bytes, timestamp: int, nonce: str, method: str, path_with_query: str, body: bytes) -> str:
    digest = hashlib.sha256(body).hexdigest()
    return hmac.new(secret, signed_lines(timestamp, nonce, method, path_with_query, digest), hashlib.sha256).hexdigest()


class NonceCache:
    """Nonces seen lately, forgotten after their time is up. Bounded, so it cannot be made to grow without end."""

    def __init__(self, ttl: int, max_entries: int = 100_000) -> None:
        self._ttl = ttl
        self._max = max_entries
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def use(self, nonce: str, now: float) -> bool:
        """True the first time a nonce is used within its time; False for a replay."""
        with self._lock:
            if len(self._seen) >= self._max // 2:
                self._seen = {n: t for n, t in self._seen.items() if t > now}
            if len(self._seen) >= self._max:
                # Full of live nonces: refuse rather than forget one that could be replayed.
                raise WorkerError("busy", "The worker is busy. Try again in a moment.", 503)
            if self._seen.get(nonce, 0) > now:
                return False
            self._seen[nonce] = now + self._ttl
            return True


def check_headers(headers: Mapping[str, str], now: float, skew: int) -> tuple[int, str, str]:
    """The timestamp, nonce and signature if they are well formed and the time is right. Before the body is read."""
    try:
        ts = int(headers.get("x-tailzu-timestamp", ""))
    except ValueError:
        raise WorkerError("auth", "Not signed.", 401) from None
    nonce = headers.get("x-tailzu-nonce", "")
    sig = headers.get("x-tailzu-signature", "")
    if not _NONCE.match(nonce) or not _SIG.match(sig):
        raise WorkerError("auth", "Not signed.", 401)
    if abs(now - ts) > skew:
        raise WorkerError("auth", "The request is too old or too new.", 401)
    return ts, nonce, sig


def verify(secret: bytes, ts: int, nonce: str, sig: str, method: str, path_with_query: str, body: bytes, nonces: NonceCache, now: float) -> None:
    expected = sign(secret, ts, nonce, method, path_with_query, body)
    if not hmac.compare_digest(expected, sig):
        raise WorkerError("auth", "Not signed.", 401)
    # Only a request that is genuine uses up its nonce.
    if not nonces.use(nonce, now):
        raise WorkerError("auth", "That request was already made.", 401)


def now() -> float:
    return time.time()
