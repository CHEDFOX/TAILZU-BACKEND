"""An error the worker answers with: a code, a message already written for a person, and the HTTP status."""
from __future__ import annotations


class WorkerError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
