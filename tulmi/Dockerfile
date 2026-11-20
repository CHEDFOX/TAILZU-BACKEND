# Tulmi backend — production image for the VPS.
#
# Three stages keep the runtime image small and reproducible:
#   1. deps    — install ALL deps (incl. dev) deterministically from the lockfile.
#   2. build   — compile TypeScript using those deps.
#   3. runtime — copy a fresh prod-only node_modules + dist + shared prompts.

# ---- 1. deps ----------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app/tulmi
COPY tulmi/package.json tulmi/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- 2. build ---------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app/tulmi
COPY --from=deps /app/tulmi/node_modules ./node_modules
COPY tulmi/ /app/tulmi/
COPY shared/ /app/shared/
RUN npm run build

# ---- migrations --------------------------------------------------------------
# A deploy runs the new database migrations here, while the image is built: before the running server is touched, so new code never
# runs before its tables and a failed migration only stops the build (tulmi/supabase/migrate-pending.sh). Only a deploy build runs them
# (DEPLOY_MIGRATIONS=1 and tulmi/.env as the build secret app_env, both from docker-compose.yml); any other build skips this.
FROM postgres:17-alpine AS migrate
ARG DEPLOY_MIGRATIONS=0
COPY tulmi/supabase/migrations/ /migrations/
COPY tulmi/supabase/LIVE_MIGRATION /LIVE_MIGRATION
COPY tulmi/supabase/migrate-pending.sh /migrate-pending.sh
RUN --mount=type=secret,id=app_env DEPLOY_MIGRATIONS="$DEPLOY_MIGRATIONS" sh /migrate-pending.sh && touch /migrated

# ---- 3. runtime -------------------------------------------------------------
FROM node:22-slim AS runtime

# wget is needed for the HEALTHCHECK below; install + clean in one layer.
# ffmpeg is what POST /v1/media/compress shells out to — it re-encodes both
# the images (to WebP) and the video (to H.264), so one package covers both
# and there is no native Node addon to build. Without it that endpoint
# answers 503 and says so; everything else runs fine.
#
# WITH_BLENDER=1 also installs Blender, and this is the whole of putting 3D on a server: Blender is a command-line
# program that happens to ship with a window, and --background opens none — no screen, no X, no desktop session. It
# reads a Python file, writes pictures and exits (src/cinema/scene/blender.ts, docs/cinema-3d.md). The fonts come with
# it because a bare container has none and a `text` object would render as empty boxes.
#
# It is off by default and on for a deploy (docker-compose.yml), because it is the largest thing in this image by far
# and CI builds the image on every push. With it off, CINEMA_BLENDER names a binary that is not there, ready() says so,
# and the 3D half answers that this machine renders nothing. Nothing else changes.
# WITH_BROWSER=1 installs Chromium, which is the whole of putting a browser on this server. Two things need one and
# both are dark without it: WEB_BROWSER=local, which reads a page that needs JavaScript, and CLOUD_BROWSER, the
# browser that belongs to a person (docs/sites.md) — its sign-in panel needs a page HELD open while somebody types
# in it, which only a local Chrome can do. src/web/browser/chrome.ts finds it as `chromium` on PATH, so nothing
# needs CHROME_PATH. The fonts come with it for the same reason Blender's do: a bare container has none, and a
# sign-in page rendered in boxes is a sign-in page nobody can read.
#
# chromium-sandbox is NOT optional, and --no-install-recommends is why it has to be named: Chromium only recommends
# it, so without it Chrome starts and dies with "No usable sandbox!". It is the SUID helper that lets Chrome sandbox
# itself WITHOUT unprivileged user namespaces, which the host's AppArmor policy denies on Ubuntu 23.10 and later.
# The alternative going around is --no-sandbox, which is the wrong trade here: this browser opens pages nobody
# vetted, and the sandbox is what stands between one of them and the container. The backend service grants no
# capabilities and sets no no-new-privileges (docker-compose.yml), so the SUID helper does its job.
#
# Off by default and on for a deploy (docker-compose.yml), as Blender is. With it off the server says so at boot
# ("CLOUD_BROWSER is on but there is no local browser") and every sites route answers 404; nothing else changes.
ARG WITH_BLENDER=0
ARG WITH_BROWSER=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget ffmpeg \
 && if [ "$WITH_BLENDER" = "1" ]; then apt-get install -y --no-install-recommends blender fonts-dejavu-core; fi \
 && if [ "$WITH_BROWSER" = "1" ]; then apt-get install -y --no-install-recommends chromium chromium-sandbox fonts-liberation; fi \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Tell the app exactly where the shared/ dir (prompts) lives — robust regardless
# of the compiled directory layout.
ENV TULMI_SHARED_DIR=/app/shared

WORKDIR /app/tulmi
COPY --from=build /app/tulmi/package.json /app/tulmi/package-lock.json* ./
# Reinstall with prod-only deps so tsx/typescript/@types/* don't ship to prod.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY --from=build /app/tulmi/dist ./dist
# The phone app's typefaces, served at /fonts/ (see server.ts).
COPY --from=build /app/tulmi/fonts ./fonts
# Blip's animated pictures for the store builds, served at /blip/ (see server.ts).
COPY --from=build /app/tulmi/blip ./blip
# The connected apps' logos, served at /icons/ (see server.ts).
COPY --from=build /app/tulmi/icons ./icons
# The written places' photographs, served at /photos/ (routes/app/staticFiles.ts).
COPY --from=build /app/tulmi/photos ./photos
# Art for keys nothing has been uploaded to yet: the sign-in email's mark
# (/media/k/email.mark, see routes/media.ts).
COPY --from=build /app/tulmi/brand ./brand
# Prompts (.md) are read at runtime and are not emitted by tsc.
COPY --from=build /app/shared /app/shared
# The image is only made once the migrations above ended well (this is what makes the build wait for them).
COPY --from=migrate /migrated /app/.migrated

# Drop root: node:22-slim ships a non-root `node` user (uid 1000). Make sure it
# owns everything the process touches — INCLUDING the /data volume mount used
# by the media store (docker-compose mounts tulmi_media at /data/media). Docker
# creates named volumes as root:root by default, which would EACCES on first
# upload; pre-creating /data with node ownership means the writable-under-mount
# strategy works even though the mount point overlays this later.
# /data/control holds the control plane's live rules (tulmi_control volume).
# /data/trust holds the public network lists abuse prevention downloads itself (tulmi_trust volume, docs/trust.md): without
# this line the daily download cannot write, every network reads "unknown", and nothing is countable.
RUN mkdir -p /data/media /data/control /data/code /data/trust && chown -R node:node /app /data
USER node

EXPOSE 8080

# /healthz is the cheap liveness probe; /readyz adds upstream pings (slower).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["node", "dist/tulmi/src/server.js"]
