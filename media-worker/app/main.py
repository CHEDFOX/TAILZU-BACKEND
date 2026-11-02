"""THE MEDIA WORKER'S HTTP SIDE. Start it with `uvicorn app.main:create_app --factory`.

    GET  /healthz      what is installed (no secret needed; it says nothing about any file)
    POST /v1/convert   ?format=docx|xlsx|pptx|odt|ods|odp|epub|html      body: the file      -> {markdown, pages, tables, notes}
    POST /v1/pdf       body: a PDF (scanned or complex)                                       -> {markdown, pages, notes}  pages split by a form feed
    POST /v1/image     ?max=1568&format=auto|webp|png|jpeg&quality=82   body: a picture       -> the picture, with X-Image-Width, -Height, -Format
    POST /v1/video     body: a video                                                          -> {duration, width, height, frames, audio, notes}

Every POST is SIGNED (app/security.py): a timestamp within a minute, a nonce used once, and an HMAC of the method, the path with its query and the body.
The headers are checked before the body is read, the body is read only up to the endpoint's cap, and a job starts only when a slot is free
(WORKER_CONCURRENCY), else 503 busy. Each job runs in a child process with a clock, a memory limit and no network (app/isolate.py). Errors are
{"code", "message"}, the message written for a person; nothing of a file's content or of a traceback is ever in one.
"""
from __future__ import annotations

import importlib.util
import shutil
import threading
import time
from typing import Any, Callable

from fastapi import FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from . import __version__, isolate
from .config import MIN_SECRET_BYTES, Settings
from .errors import WorkerError
from .security import NonceCache, check_headers, verify

FORMATS = ("docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "html")
HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def create_app(settings: Settings | None = None, clock: Callable[[], float] = time.time) -> FastAPI:
    s = settings or Settings.from_env()
    if len(s.secret) < MIN_SECRET_BYTES:
        raise RuntimeError(f"MEDIA_WORKER_SECRET must be set, at least {MIN_SECRET_BYTES} characters (openssl rand -hex 32)")

    app = FastAPI(title="Tailzu media worker", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    nonces = NonceCache(s.nonce_ttl_seconds)
    slots = threading.BoundedSemaphore(s.concurrency)

    @app.exception_handler(WorkerError)
    async def _worker_error(_request: Request, e: WorkerError) -> JSONResponse:
        headers = dict(HEADERS)
        if e.code == "busy":
            headers["Retry-After"] = "5"
        return JSONResponse(e.as_dict(), status_code=e.status, headers=headers)

    async def signed_body(request: Request, endpoint: str) -> bytes:
        ts, nonce, sig = check_headers(request.headers, clock(), s.skew_seconds)
        limit = s.body_max[endpoint]
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            raise WorkerError("too_big", f"That file is over {limit // (1024 * 1024)} MB, which is the most I take here.", 413)
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise WorkerError("too_big", f"That file is over {limit // (1024 * 1024)} MB, which is the most I take here.", 413)
            chunks.append(chunk)
        body = b"".join(chunks)
        raw_query = request.scope.get("query_string", b"").decode("latin1")
        verify(s.secret, ts, nonce, sig, request.method, request.url.path + (f"?{raw_query}" if raw_query else ""), body, nonces, clock())
        if not body:
            raise WorkerError("unsupported", "Nothing was sent.", 400)
        return body

    async def job(task: str, endpoint: str, body: bytes, args: dict[str, Any], after: Callable | None = None) -> Any:
        if not slots.acquire(blocking=False):
            raise WorkerError("busy", "The file reader is busy. Try again in a moment.", 503)
        try:
            return await run_in_threadpool(
                lambda: isolate.run(task, body, {**args, "_settings": s.public()}, timeout=s.timeout[endpoint], memory_mb=s.memory_mb[endpoint], after=after)
            )
        finally:
            slots.release()

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        return JSONResponse(
            {
                "ok": True, "version": __version__,
                "markitdown": importlib.util.find_spec("markitdown") is not None,
                "docling": importlib.util.find_spec("docling") is not None,
                "ffmpeg": shutil.which("ffmpeg") is not None,
            },
            headers=HEADERS,
        )

    @app.post("/v1/convert")
    async def convert(request: Request, format: str = Query(...)) -> JSONResponse:
        if format not in FORMATS:
            raise WorkerError("unsupported", f"format is one of {', '.join(FORMATS)}.", 400)
        body = await signed_body(request, "convert")
        return JSONResponse(await job("convert", "convert", body, {"format": format}), headers=HEADERS)

    @app.post("/v1/pdf")
    async def pdf(request: Request) -> JSONResponse:
        body = await signed_body(request, "pdf")
        if not body.lstrip()[:1024].startswith(b"%PDF-") and b"%PDF-" not in body[:1024]:
            raise WorkerError("unsupported", "That is not a PDF.")
        return JSONResponse(await job("pdf", "pdf", body, {}), headers=HEADERS)

    @app.post("/v1/image")
    async def image(request: Request, max: int = Query(1568, ge=16, le=8000), format: str = Query("auto"), quality: int = Query(82, ge=30, le=95)) -> Response:
        if format not in ("auto", "webp", "png", "jpeg"):
            raise WorkerError("unsupported", "format is auto, webp, png or jpeg.", 400)
        body = await signed_body(request, "image")

        def after(folder, meta: dict) -> tuple[bytes, dict]:
            return (folder / "out.img").read_bytes(), meta

        data, meta = await job("image", "image", body, {"max": max, "format": format, "quality": quality}, after)
        return Response(
            data, media_type=f"image/{meta['format']}",
            headers={**HEADERS, "X-Image-Width": str(meta["width"]), "X-Image-Height": str(meta["height"]), "X-Image-Format": meta["format"]},
        )

    @app.post("/v1/video")
    async def video(request: Request) -> JSONResponse:
        body = await signed_body(request, "video")
        return JSONResponse(await job("video", "video", body, {}), headers=HEADERS)

    return app
