# Deploying the Tulmi backend to a Hostinger VPS (shared with other apps)

> **Already set up?** The one command that deploys is
> `ssh root@91.108.104.168 'cd ~/tulmi && git pull --ff-only && ./deploy/ship.sh'`
> — it pulls, rebuilds, and proves the site, the installer and payments are
> live. `CHECK=1` runs the proof alone. The rest of this page is the first
> setup. The commands for the phones, the desktop and the site are in the
> frontend repo's `SHIP.md`.

> **Already cloned before the rename?** The backend folder moved from `backend/`
> to `tulmi/`. Update with:
> ```bash
> cd ~/tulmi && git pull
> cp .env.example tulmi/.env && nano tulmi/.env   # re-add your keys
> docker compose up -d --build
> ```

This VPS already runs other apps, so these steps are designed to **not disturb
them**: Flow runs in its own Docker container, binds to **localhost only** on an
**uncommon port (8770)** by default, and never touches ports 80/443 unless you
explicitly choose to.

You need two API keys: Groq (Whisper STT) and OpenRouter (text cleanup/refine).
Text-to-speech uses the phone's built-in voice, so OpenAI is OPTIONAL — only
needed if you enable the server-side voice-preview endpoints or switch STT to
OpenAI. Supabase is optional for the first run (`DEV_SKIP_AUTH=true`).

> Replace `YOUR_VPS_IP` with your VPS IP, and `flow.yourdomain.com` with your
> domain (only needed for HTTPS).

---

## 1. Connect to the VPS

```bash
ssh root@YOUR_VPS_IP
```

## 2. See what's already running (so we don't clash)

Run these and keep the output handy:

```bash
docker --version                 # is Docker already installed?
docker ps                        # your other app containers
ss -tlnp | grep -E ':(80|443|8770)\b'   # what's on 80/443 and is 8770 free?
```

- If **80 or 443** show a process (nginx/apache/caddy/etc.), you already have a
  web server — we'll route Flow through it (Step 6, Option A). **Do not** use
  Flow's bundled Caddy.
- If **8770** shows nothing, it's free for Flow. If it's taken, pick another
  free port and use it as `FLOW_PORT` below.

## 3. Install Docker — ONLY if Step 2 showed it's missing

```bash
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
```

(The `command -v` guard skips the install if Docker is already there, so your
running containers are untouched.)

## 4. Get the code

```bash
# Private repo: make a token at https://github.com/settings/tokens (scope: repo)
git clone https://YOUR_TOKEN@github.com/chedfox/tulmi.git
# Public repo: git clone https://github.com/chedfox/tulmi.git
cd tulmi
```

## 5. Add your keys

```bash
cp .env.example tulmi/.env
nano tulmi/.env       # fill GROQ_API_KEY (STT) + OPENROUTER_API_KEY (refine); keep STT_PROVIDER=groq + DEV_SKIP_AUTH=true. OPENAI_API_KEY optional (see above).
```

Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

## 6. Start Flow

It now listens **only on `127.0.0.1:8770`** — private to the VPS, invisible to
the internet, zero conflict with your other apps:

```bash
docker compose up -d --build
curl http://localhost:8770/healthz
# -> {"status":"ok","service":"tulmi-backend","version":"0.1.0"}
```

(If 8770 was taken, run `FLOW_PORT=NNNN docker compose up -d --build` instead.)

Now make it reachable from your phone. Pick ONE option:

### Option A — Route through your EXISTING web server (recommended)

You already have nginx/apache/caddy on 80/443. Add **one subdomain** that
forwards to Flow; your other sites are untouched. First point DNS:
`flow.yourdomain.com → YOUR_VPS_IP` (an A record).

**If you use nginx** — create `/etc/nginx/sites-available/flow` :

```nginx
server {
    listen 80;
    server_name flow.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:8770;
        proxy_http_version 1.1;
        # WebSocket upgrade for the live /v1/stream endpoint:
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}
```

Then:

```bash
ln -s /etc/nginx/sites-available/flow /etc/nginx/sites-enabled/flow
nginx -t && systemctl reload nginx          # -t verifies before reloading
# Add HTTPS (free cert) without affecting other sites:
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d flow.yourdomain.com
```

**If you use Caddy** — add to your existing `Caddyfile`:

```caddy
flow.yourdomain.com {
    reverse_proxy 127.0.0.1:8770
}
```

then `caddy reload` (or `systemctl reload caddy`). Caddy gets the HTTPS cert
automatically. WebSockets work with no extra config.

**Apache** — enable `proxy`, `proxy_http`, `proxy_wstunnel`, add a vhost with
`ProxyPass / http://127.0.0.1:8770/` plus a `RewriteRule` upgrading
`Upgrade=websocket` to `ws://127.0.0.1:8770/` — ask me and I'll write it out.

→ Backend is live at `https://flow.yourdomain.com`; the app uses
`wss://flow.yourdomain.com/v1/stream`.

### Option B — Quick public port (testing only, no HTTPS)

Only if **nothing** is on the port and you just want to poke it from your phone:

```bash
FLOW_BIND=0.0.0.0 FLOW_PORT=8770 docker compose up -d --build
ufw allow 8770 2>/dev/null || true     # also open it in Hostinger's hPanel firewall
# reachable at http://YOUR_VPS_IP:8770/healthz
```

Switch to Option A before real use — Android needs HTTPS/`wss://`.

---

## Checking a deploy

Three levels, cheapest first. All run from `~/tulmi` on the VPS.

```
npm --prefix tulmi test          # 609 unit tests, no network, no cost
./tulmi/scripts/paytest.sh       # the purchase path, end to end, no account touched
./tulmi/scripts/quality.sh       # dictation in, finished text out — 79 cases
```

`quality.sh --quick` is the smoke subset when you only want to know the deploy
is alive; `--only dictation` runs the mic path alone; `--no-audio` skips it.
Each run saves its results, so the next one can be compared to it:

```
./tulmi/scripts/quality.sh --compare tulmi/.quality/run-<timestamp>.json
```

which prints FIXED and REGRESSED per case. That is the only honest way to say
a prompt change helped.

The unit tests read nothing off the machine they run on — not `tulmi/.env`, and
not what a shell exported. They used to, and it mattered: the stores fall back
to an in-memory map when Supabase is off, so a real service key in the
environment pointed `npm test` at the production database and it began writing
rows there, caught only by the foreign key because the ids in the tests are not
UUIDs. Skipping the file left the exported half — `ADMIN_SECRET` in the shell
made the test for "no secret configured" fail, since on that machine one was.
Both are closed now: every variable the server reads is cleared before each
test file, so a run means the same thing here as on a laptop.

`cd ~/tulmi && ./tulmi/scripts/quality.sh` is unaffected by that — it talks to
the container over HTTP and measures the deployment on purpose.

If four suites fail to load with `Failed to load url @fastify/static` or
`jose`, the checkout's `node_modules` is a production install. `npm --prefix
tulmi ci` fixes it. That has no effect on the running container, which builds
its own.

`quality.sh` is the one that answers "did that change help?". It asks the
running server over HTTP, so it measures the prompt version, the model and the
config that are actually serving users — not the ones in a checkout. The
production image is built `--omit=dev`, so `npm run eval` cannot run there;
that one is for while you are editing a prompt, against the pipeline in
process.

It costs a few real LLM calls. It reads no user data and writes none.

It prints the cleanup prompt version it measured, asked of the container's own
node — not `printenv`, which is blank whenever the default is in force, and not
the checkout, which `git pull` has already changed while the image is still
whatever it was. It also refuses to run if the prompt file that version names
is missing from the image, which is what a forgotten `--build` looks like.

To compare two versions, pin the old one and run it again —
`CLEANUP_PROMPT_VERSION=v5` in `tulmi/.env`, rebuild, run, then delete the line
to go back to the default.

79 cases across the three paths a user can reach:

  - `dictate`  spoken through /v1/speak, posted to /v1/transcribe-clean as the
              in-app mic does. Both stages come back, so a failure prints
              said / heard / wrote and names which half broke — a recognition
              fault and a writing fault look identical from outside and need
              completely different fixes. It also reports word error rate.
  - `refine`   POST /v1/refine, the keyboard's path.
  - `draft`    POST /v1/draft, the reply and share-sheet path.

The groups: length (invention), meta (instruction vs content), lang (11
languages and scripts), facts (digits, names, links that must survive), repair
(the actual job — fillers, false starts, self-corrections), app (search box vs
message), voice (tone, custom instructions, dictionary, snippets), context,
alt (the live path's second recogniser), draft, dictation.

Every case asserts a property — did it grow, did the digits survive, did the
script flip — never an exact sentence. A harness that pins wording fails on
every good change and passes anything that happens to match.

What the audio path does NOT prove: synthesised speech is clean. No accent, no
room noise, no crosstalk. It exercises the pipeline and the language decisions;
it is not a substitute for testing on real recordings.

    python3 tulmi/scripts/test_quality.py    # the harness checks itself, free

That last one runs offline and costs nothing. It exists because a scorer bug
passes everything silently, which is worse than not measuring: a green run
would be evidence of nothing while reading as proof.

## Control console — change anything, live

Open `https://<your API domain>/admin` and paste `ADMIN_SECRET` from `~/tulmi/tulmi/.env`.

- **Rules** edit what the server sends after the code builds it: the app's bootstrap and screens, the keyboard config, the site copy.
- **Targeting:** platform, keyboard build, app version, language, signed-in, named users, a percentage of users, or a date window.
- **Experiments:** give a rule variants and each user gets one, stable by user id.
- **Preview** builds any payload as any target and shows exactly which paths changed. Use **Find a path** to search a payload for the value you want to change.
- **Every save** is live at once, bumps the cache so apps refetch, and becomes a version you can roll back to under **History**.

The rules live on the `tulmi_control` volume, so they survive every deploy. The same API works from the command line:

```bash
curl -H "x-admin-secret: $SECRET" https://<your API domain>/v1/admin/control
```

## Everyday commands

```bash
docker compose logs -f backend                 # watch logs
docker compose restart backend                 # restart just Flow
docker compose down                            # stop Flow (other apps unaffected)
git pull && docker compose up -d --build       # deploy a new version
```

## Why this won't break your other apps

- Flow's container is isolated; the compose project is namespaced (`tulmi-*`),
  so container/network/volume names can't collide with your other stacks.
- Default binding is `127.0.0.1:8770` — not public, not 80/443.
- The bundled Caddy is opt-in (`--profile https`) and you're advised to use your
  existing proxy instead, so 80/443 are never seized.
- Docker is only installed if missing.

## Notes

- Secrets live only in `tulmi/.env` on the VPS — never committed.
- Swap the cleanup model anytime via `CLEANUP_MODEL` in `tulmi/.env`, then
  `docker compose up -d --build`.
- For real users: set `DEV_SKIP_AUTH=false`, add `SUPABASE_*`, and run the
  migrations in `tulmi/supabase/migrations/`.
