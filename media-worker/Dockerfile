# syntax=docker/dockerfile:1.7
# THE MEDIA WORKER (docs/media.md): office files, hard PDFs, pictures and videos for the Tailzu backend. Build context: media-worker/.
#
#   docker build -t tailzu-media-worker media-worker/
#
# The build stage needs the network (PyPI, PyTorch's CPU index, Hugging Face for Docling's models). The image that runs does not: it has everything,
# and docker-compose.yml puts it on a network with no way out.

FROM python:3.13-slim-bookworm AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /build
COPY requirements.txt requirements.lock licenses_check.py ./
# Every version is pinned in the lock. torch and torchvision are the CPU builds (the default wheels carry gigabytes of CUDA libraries nothing here uses).
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.lock
# No AGPL, no GPL: if one slipped in, the build stops here.
RUN python licenses_check.py
# Docling's models are fetched now and baked in; the running worker has no network to fetch them with.
RUN python -c "from pathlib import Path; from docling.utils.model_downloader import download_models; download_models(Path('/opt/docling-models'), with_layout=True, with_tableformer=True, with_code_formula=False, with_picture_classifier=False, with_rapidocr=True)"

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH \
    DOCLING_ARTIFACTS_PATH=/opt/docling-models HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=2
# ffmpeg runs as a separate program (Debian's build is GPL-enabled: it is run here, never linked into the worker and never shipped on). libgl and
# libglib are OpenCV's, libgomp is torch's, tini reaps the children a job leaves behind.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 libgomp1 tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin worker
COPY --from=build /opt/venv /opt/venv
COPY --from=build /opt/docling-models /opt/docling-models
WORKDIR /app
COPY app ./app
USER worker
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["python", "-c", "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)"]
ENTRYPOINT ["/usr/bin/tini", "--"]
# The factory refuses to start without MEDIA_WORKER_SECRET (32 characters or more). No access log: nothing about a file belongs in a log.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--limit-concurrency", "16", "--timeout-keep-alive", "5"]
