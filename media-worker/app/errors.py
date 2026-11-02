"""A refusal or a failure with a sentence a person can read. The VPS shows `message` as it is."""
from __future__ import annotations


class WorkerError(Exception):
    """code is one of: password, bomb, corrupt, too_big, unsupported, too_long, timeout, busy, failed, auth."""

    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message}
