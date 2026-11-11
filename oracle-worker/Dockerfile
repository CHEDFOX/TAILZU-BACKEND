# syntax=docker/dockerfile:1.7
# THE ORACLE WORKER (docs/oracle.md): Plutto's oracle for the X0 Bot server. Build context: oracle-worker/.
#
#   docker build -t tailzu-oracle-worker oracle-worker/
#
# It calls the models (OpenRouter, and OpenAI for the search by meaning), so unlike the media worker it has a way out; it has no port on the
# host, and only a signed request from the backend is answered.

FROM python:3.13-slim-bookworm AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt /build/requirements.txt
RUN pip install -r /build/requirements.txt

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10002 --home-dir /nonexistent --shell /usr/sbin/nologin oracle
COPY --from=build /opt/venv /opt/venv
WORKDIR /srv
COPY app ./app
COPY server ./server
USER oracle
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "server.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
