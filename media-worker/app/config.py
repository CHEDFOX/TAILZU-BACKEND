"""Every limit of the worker, in one place. Strict by default; an environment variable can lower or raise one, never remove it."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

MB = 1024 * 1024


def _int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(os.environ.get(name, default))
    except ValueError:
        return default
    return max(lo, min(hi, v))


@dataclass(frozen=True)
class Settings:
    """What the worker is held to.

    body_max       the most bytes one request may carry, by endpoint (the VPS holds each kind to a cap of its own, lower or equal)
    timeout        the most seconds one job may run before it is killed
    memory_mb      the address space one job may use (RLIMIT_AS); a job that wants more is killed, not the server
    """

    secret: bytes = b""
    skew_seconds: int = 60
    nonce_ttl_seconds: int = 120
    concurrency: int = 2
    body_max: dict = field(default_factory=lambda: {"convert": 30 * MB, "pdf": 30 * MB, "image": 15 * MB, "video": 60 * MB})
    timeout: dict = field(default_factory=lambda: {"convert": 120, "pdf": 240, "image": 30, "video": 300})
    memory_mb: dict = field(default_factory=lambda: {"convert": 2048, "pdf": 6144, "image": 1536, "video": 3072})
    # Outputs
    markdown_chars_max: int = 2_000_000
    pdf_pages_max: int = 300
    image_pixels_max: int = 50_000_000
    video_seconds_max: int = 20 * 60
    frames_max: int = 8
    audio_bytes_max: int = 8 * MB
    # Zip containers (docx, xlsx, pptx, odt, ods, odp, epub)
    zip_entries_max: int = 3000
    zip_declared_max: int = 400 * MB
    zip_ratio_max: int = 200
    tables_max: int = 6
    rows_max: int = 500
    columns_max: int = 40

    def public(self) -> dict:
        """Every limit, as plain data for the child process of a job. The secret never goes."""
        from dataclasses import asdict

        d = asdict(self)
        d.pop("secret")
        return d

    @staticmethod
    def from_public(d: dict) -> "Settings":
        return Settings(**{**d, "secret": b""})

    @staticmethod
    def from_env() -> "Settings":
        secret = os.environ.get("MEDIA_WORKER_SECRET", "").encode()
        return Settings(
            secret=secret,
            concurrency=_int("WORKER_CONCURRENCY", 2, 1, 16),
        )


MIN_SECRET_BYTES = 32
