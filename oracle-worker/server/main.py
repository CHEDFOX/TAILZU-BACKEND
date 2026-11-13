"""THE ORACLE WORKER: Plutto's oracle (app/, docs/oracle.md) behind one signed endpoint, for the X0 Bot server.

    GET  /healthz      no secret; says that it is up, and whether its model keys arrived (never what they are)
    POST /v1/answer    signed (security.py); a question, the turns before it, the person's birth details if known, and the route the last
                       turn sent back. NDJSON when `stream` (status, text pieces, then the result), else one JSON

Run: uvicorn server.main:create_app --factory. It refuses to start without ORACLE_WORKER_SECRET (32 characters or more), and keeps no
access log: what a person asks is never written down here.
"""
from __future__ import annotations

import asyncio
import os
import json
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from . import security
from .answer import AnswerRequest, answer
from .config import Settings, load
from .errors import WorkerError

_BUSY = WorkerError("busy", "The oracle is busy. Try again in a moment.", 503)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    s = settings or load()
    if len(s.secret) < 32:
        raise RuntimeError("ORACLE_WORKER_SECRET must be set, 32 characters or more")
    nonces = security.NonceCache(s.nonce_ttl_seconds)
    gate = asyncio.Semaphore(s.concurrency)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(WorkerError)
    async def _worker_error(_request: Request, e: WorkerError):
        return JSONResponse({"code": e.code, "message": e.message}, status_code=e.status, headers={"cache-control": "no-store"})

    @app.get("/healthz")
    async def healthz():
        # whether the keys arrived, never what they are: a deploy that forgot them shows here, not at the first question
        return JSONResponse({"ok": True, "models": bool(os.environ.get("OPENROUTER_API_KEY")),
                             "meaning": bool(os.environ.get("ORACLE_EMBED_KEY") or os.environ.get("OPENAI_API_KEY"))},
                            headers={"cache-control": "no-store"})

    async def signed_body(request: Request) -> bytes:
        now = security.now()
        ts, nonce, sig = security.check_headers(request.headers, now, s.skew_seconds)
        body = await request.body()
        if len(body) > s.body_max:
            raise WorkerError("too_large", "That request is too large.", 413)
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        security.verify(s.secret, ts, nonce, sig, request.method, path, body, nonces, now)
        return body

    async def admit() -> None:
        try:
            await asyncio.wait_for(gate.acquire(), timeout=s.queue_seconds)
        except asyncio.TimeoutError:
            raise _BUSY from None

    @app.post("/v1/answer")
    async def answer_route(request: Request):
        body = await signed_body(request)
        try:
            req = AnswerRequest.model_validate_json(body)
        except ValidationError as e:
            raise WorkerError("bad_request", "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:5]), 400) from None
        await admit()
        if not req.stream:
            try:
                return JSONResponse(await answer(req, lambda _e: None), headers={"cache-control": "no-store"})
            finally:
                gate.release()

        queue: asyncio.Queue = asyncio.Queue()

        async def run() -> None:
            try:
                result = await answer(req, queue.put_nowait)
                queue.put_nowait({"t": "result", "result": result})
            except WorkerError as e:
                queue.put_nowait({"t": "error", "code": e.code, "message": e.message})
            except Exception as e:  # never the words, only the kind of failure
                print(f"[oracle] answer failed: {type(e).__name__}")
                queue.put_nowait({"t": "error", "code": "failed", "message": "The oracle couldn't finish that answer. Try again in a moment."})
            finally:
                queue.put_nowait(None)

        async def lines():
            task = asyncio.create_task(run())
            try:
                while True:
                    event = await queue.get()
                    if event is None:
                        break
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            finally:
                if not task.done():
                    task.cancel()
                gate.release()

        return StreamingResponse(lines(), media_type="application/x-ndjson", headers={"cache-control": "no-store"})

    return app
