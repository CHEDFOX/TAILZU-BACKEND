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
        # WebSocket upgrade for the live /v1/transcribe-stream endpoint:
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
`wss://flow.yourdomain.com/v1/transcribe-stream`.

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

Whether the live engine sends text while someone talks, or only after they
pause, is a separate question with its own check. It speaks a sentence with a
pause in the middle (OpenAI TTS) and streams it through the real live engine,
printing each event at the second it arrived:

```
docker compose exec backend node dist/tulmi/scripts/live-check.js
docker compose exec backend node dist/tulmi/scripts/live-check.js --say "I was going to the" --say "market tomorrow" --gap 1.5
```

Every real dictation also leaves one `live session` line in the log, with no
words in it: how many partials and finals reached the phone, and how long after
the first audio the first of each came. `partials: 0` with finals above it
means text only arrived when a turn ended.

```
docker compose logs backend | grep '"live session"' | tail
```

A turn ends after `OPENAI_LIVE_SILENCE_MS` of quiet (800 by default) and comes
back as a sentence of its own, full stop included. Lower it for quicker
captions and more pause-made full stops for the writer to remove, raise it for
the opposite.

How fast Ask answers a question about a picture, model by model, has a check
of the same kind. It asks each model the same question the way the picture
path asks it, through the server's own code and with the server's own key
(nothing to type): the vision prompt for that model's family, a worksheet
photo of a right triangle carried inside the script, a short chat screen and
"explain this triangle". Runs go one at a time, never at once:

```
docker compose exec backend node dist/tulmi/scripts/time-vision.js
docker compose exec backend node dist/tulmi/scripts/time-vision.js --runs 8 --models google/gemini-3.8-flash,anthropic/claude-haiku-5.5
```

With no `--models` it measures the server's own vision models
(`AGENT_VISION_MODEL`, then `AGENT_VISION_FALLBACK_MODELS`) and two others for
comparison, 3 runs each. `--route none` turns off the lowest-latency provider
routing the server asks for (`--route latency` turns it back on), to see what
it is worth. Each model gets a table: one row per run with the time to the
first byte, to the first sentence and to the end, its tokens, its cost and the
marks it drew, then the median and the worst. The first sentence is the
column that matters, since it is when the person sees and hears an answer
begin: under about 1.5 s feels instant, and a model whose worst is far above
its median will sometimes feel broken. Under the table is that model's first
sentence, so you can see it read the triangle (the long side is 5). The last
two lines name the fastest model to its first sentence and the cost of 1,000
picture questions on each. Each question costs well under a cent (the cost
column says exactly what), so the default dozen comes to a cent or two. It
writes nothing and prints no key, no picture and no answer past that first
sentence.

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
- The desktop's note-taker needs `0014_notes.sql`: paste it into the Supabase
  SQL editor once (it only creates the `notes` table). Speakers are told apart
  with the same `DEEPGRAM_API_KEY` the live dictation uses; without it, notes
  still work and label voices "You" and "Others". `NOTES_MODEL` picks the model
  that organises them (defaults to `CLEANUP_MODEL`).

## Connected apps (Ask acting in Notion, Linear, Jira and so on)

Off by default. While `CONNECTORS` is false nothing changes: Ask's planner gets
exactly the prompt it always did and `/v1/connectors` answers `{"enabled":false}`.

To switch it on:

1. **Migration.** Paste `tulmi/supabase/migrations/0017_connectors.sql` into the
   Supabase SQL editor (or re-run `full_schema.sql`). It creates
   `connector_connections`, `assistant_tasks` and `assistant_audit`. The server
   needs `SUPABASE_SERVICE_KEY` for them; without it connections live in memory
   and are lost on restart.
2. **The key.** `openssl rand -base64 32` into `CONNECTOR_TOKEN_KEY` in
   `tulmi/.env`. It encrypts every stored token and signs the sign-in link; with
   no key the server refuses to store a token. Changing it later disconnects
   everyone (stored tokens no longer open), so keep it with the other secrets.
3. **The redirect.** `CONNECTOR_REDIRECT_URL` defaults to
   `https://api.tailzu.space/v1/connectors/callback`. It must be this server's
   `GET /v1/connectors/callback`, reachable from the person's browser.
   **Who Tailzu is to the apps.** `CONNECTOR_CLIENT_METADATA_URL` defaults to
   `https://api.tailzu.space/oauth/client-metadata.json`, which this server
   serves (built from the redirect above). An app whose auth server reads client
   documents (Notion and Linear say they do) signs people in with that instead
   of registering a new client each time. A staging server sets its own host
   here, or `""` to turn it off: the vendor only sends people back to the
   redirect the document lists.
   **It must be reachable from the public internet**, because the vendors'
   auth servers fetch it themselves: https, a `200` straight away (no
   redirect, no login page, no bot challenge in front of it), served as
   `application/json`. It is only served while `CONNECTORS=true`. Check it from
   a machine outside the VPS:
   `curl -si https://api.tailzu.space/oauth/client-metadata.json | head -5`
   should show `200`, `content-type: application/json` and
   `cache-control: public, max-age=86400`, and the body lists
   `CONNECTOR_REDIRECT_URL` exactly in `redirect_uris`. If a CDN or firewall
   sits in front of the API (Cloudflare's bot fight or "under attack" mode,
   for example), exempt `/oauth/client-metadata.json` and
   `/v1/connectors/callback`.
4. **Which apps.** `CONNECTORS_ENABLED_IDS=notion,linear` (ids from
   `src/connectors/catalog.ts`). **Every catalog entry ships disabled.** Unless
   the table under "More MCP apps" says it can go in now, try an app end to end
   against the live service before its id goes in this list: the MCP URL still
   answers, it signs in (our client document, dynamic client registration, or
   for a per-user URL like Zapier, the pasted link works), a real sign-in comes
   back to the callback, `tools/list` returns tools, and one read and one write
   behave. Then set that entry's `verified`. GitHub and Asana are
   `preRegistered`: register Tailzu with the vendor first (below, "Registering
   Tailzu with a vendor"). Until then Connect answers "not set up yet" (503).
   Jira and Confluence (`atlassian`) is not: it signs in with our client
   document, so there is nothing to register, but see the Atlassian note below
   before trying it.
5. `CONNECTORS=true`, then `docker compose up -d --build`.

Anything that changes, sends, deletes or pays is confirmed by the person first
(the Ask run ends with an `approve` event, the device shows the card, and
`POST /v1/tasks/:id/approve` runs it); a waiting task also pushes to their phone
(`push.approval.*` in the control plane). What ran is in `assistant_audit`, with
no message text.

### Apps people add by link

Off by default (`CUSTOM_CONNECTORS=false`). When on, a person can paste any
remote MCP server's address and connect it for themselves
(`POST /v1/connectors/custom`), like Claude's custom connectors. Nobody has
vetted those servers, so they get the strict treatment in `src/connectors/`:
public https addresses only (`egress.ts`), the strict sign-in checks and no
sign-in at one of the catalog's vendors from another site (`oauth.ts`), a
cleaned tool list pinned by hash so a changed tool is held back until the
person looks again (`hygiene.ts`), a per-tool Allow / Ask / Off instead of a
level, a yes for every call once another app's answer is in the run, and the
assistant only sees the app when the person names it.

1. **Migration.** Paste `tulmi/supabase/migrations/0018_custom_connectors.sql`
   into the Supabase SQL editor (or re-run `full_schema.sql`), after 0017. It
   creates `connector_custom` (one row per app a person added, with where its
   sign-in last sent them, `sign_in_host`), adds `tool_policy`, `tools_pin` and
   `tools_changed` to `connector_connections`, and creates `mcp_directory` and
   `mcp_directory_sync` for More apps (below). Every table is written with the
   service key only; a person's own token can read their own
   `connector_custom` rows and nothing else.
2. `CUSTOM_CONNECTORS=true` (with `CONNECTORS=true`), and
   `CUSTOM_CONNECTORS_MAX` if 10 apps each is not the number (0 to 100). Each
   person may try adding ten an hour.
3. Restart. The phone's Connected apps and the desk's Settings then show
   **Add by link**, a **More apps** search, and, for each added app, Unverified
   with its host, "You'll sign in at {host}" before any sign-in opens, and a
   page of what it can do with Allow / Ask first / Off per tool (a delete or a
   payment only Ask first or Off). A server that changes its tools later shows
   "This app changed. Have a look." until the person accepts the new list.

Switching it off again hides everyone's added apps and More apps (their rows
stay, and can still be removed).

**More apps** is a search over the official MCP Registry
(`registry.modelcontextprotocol.io`), copied into `mcp_directory` by the server
itself (`src/connectors/registry.ts`). It runs only while
`CUSTOM_CONNECTORS=true`: a minute after the server starts, then every 12 hours.
The first run reads the whole registry (about 480 pages of 100 in October 2026,
a few minutes); after that it asks only for what changed since the last run that
finished, so a restart does not crawl again. It keeps only servers this code can
connect to (Streamable HTTP on public https, no URL templates, no required
headers, not deleted). The VPS needs outbound https to that host; the log says
`mcp directory synced` or `mcp directory sync failed` (it then waits for the
next turn). Without `SUPABASE_SERVICE_KEY` the copy lives in memory and is made
again at every start. Search shows our own catalog's apps first, then
`DIRECTORY_FEATURED` in `registry.ts` (empty; see its comment for when a
registry name may go in), then entries whose registry name is their own
server's domain, then the rest, every one outside the catalog marked
Unverified. No icon is ever fetched. Adding one is the same add as a pasted
link, recording which entry it came from.

### Registering Tailzu with a vendor (`CONNECTOR_OAUTH_CLIENTS`)

Some vendors' MCP servers accept no client they have not issued themselves: no
client document (CIMD), no dynamic registration. For those, register Tailzu as
an OAuth app in the vendor's own console and give the server the result:

```
CONNECTOR_OAUTH_CLIENTS={"github":{"client_id":"...","client_secret":"...","issuer":"https://github.com/login/oauth"},"asana":{"client_id":"...","client_secret":"...","issuer":"https://app.asana.com"}}
```

One line of JSON in `tulmi/.env`, keyed by the **catalog id** (a client is only
ever used for the catalog app of that id, never for an app someone added by
link). The secret lives there and nowhere else. A bad line is warned about at
start and ignored, so those apps answer "not set up yet" rather than the server
not starting.

What every vendor asks for, the same everywhere:

- **Redirect / callback URL:** exactly `CONNECTOR_REDIRECT_URL`, by default
  `https://api.tailzu.space/v1/connectors/callback`. Vendors compare it as a
  string: no trailing slash, same scheme and host. Staging registers its own.
- **Name, homepage, logo:** Tailzu, `https://tailzu.space`, the app icon.
- **`issuer`:** the vendor's auth server, the first entry of
  `authorization_servers` in its MCP server's metadata:
  `curl -s https://<mcp host>/.well-known/oauth-protected-resource/<mcp path>`
  (or without the path). A client is held to that issuer and never shown to
  another; if the vendor moves its auth server, sign-ins stop with an error
  until this is updated.
- **Scopes:** whatever the vendor's MCP docs list for its server. At sign-in
  Tailzu asks for what the MCP server itself names (the scope in its 401, else
  its `scopes_supported`), so a console that fixes scopes per app has to
  allow those.

Before registering anything for a vendor not yet in the catalog, try its MCP
server once through **Add by link** with nothing in Advanced: if it signs in
with our client document or by registering itself, nothing needs to be made.

- **GitHub** (catalog `github`, `preRegistered`). github.com → Settings →
  Developer settings → OAuth Apps → New OAuth App (under the organisation's
  settings to own it as Tailzu). Asks for an application name, a homepage URL
  and **one** authorization callback URL. Then copy the Client ID and generate
  a client secret. Leave device flow off. Issuer
  `https://github.com/login/oauth`. (A GitHub App works too and its user
  tokens expire and refresh; its callback list takes several URLs.)
- **Asana** (catalog `asana`, `preRegistered`; Asana says outright that it does
  not support dynamic registration). app.asana.com/0/my-apps → Create new app
  (name, what it is for). Under OAuth, add the redirect URL; copy the Client
  ID and Client secret. Under distribution, allow any workspace, or only your
  own while testing. Follow Asana's "Integrating with Asana's MCP server" page
  (the catalog's `docs` link) for the app type and scopes its MCP server
  needs. Issuer `https://app.asana.com`.
- **Jira and Confluence** (catalog `atlassian`, **not** `preRegistered`:
  nothing to register). Atlassian says its MCP server signs clients in by
  registering them (OAuth 2.1 with dynamic registration), and taking an
  OAuth 2.0 (3LO) app made at developer.atlassian.com is still an open request
  (jira.atlassian.com/browse/ROVO-870), so there is no console app to make.
  Its auth server (`https://auth.atlassian.com/<tenant>`, the issuer its
  resource metadata names) takes client documents and lets a client with no secret in, so
  Connect signs in with `CONNECTOR_CLIENT_METADATA_URL` (step 3 above), or
  registers itself where that is off. Check before trying it:
  `curl -s https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp`
  names the auth server, and that server's
  `/.well-known/oauth-authorization-server/<tenant>` should still say
  `"client_id_metadata_document_supported":true` and list `"none"` in
  `token_endpoint_auth_methods_supported` (both true on 2026-10-22). Each
  Atlassian organisation's admin decides which domains may connect to its
  sites (Atlassian Administration → Rovo → Rovo MCP server → Domains;
  Atlassian's "Control Atlassian MCP server settings"), so try it with an
  organisation that allows Tailzu's domain, and expect a person whose admin
  has not allowed it to be refused on Atlassian's page. Leave `atlassian` out
  of `CONNECTOR_OAUTH_CLIENTS`.
- **Slack** (no catalog entry yet; it would be `slack`). api.slack.com/apps →
  Create New App → From scratch (a name and a workspace to build it in).
  OAuth & Permissions → Redirect URLs → add it and Save; choose User Token
  Scopes (the assistant acts as the person). Basic Information → App
  Credentials has the Client ID and Client Secret. To let other workspaces
  connect, Manage Distribution → activate public distribution. Turn on token
  rotation if you want tokens that expire and refresh. Slack decides which
  apps its MCP server accepts: check Slack's MCP docs before relying on it.
- **Canva** (no catalog entry yet; `canva`). canva.com/developers → Your
  integrations → Create an integration (public, to reach people outside your
  team). Configuration has the Client ID and Generate secret; Scopes is where
  the permissions are picked; Authentication → add the redirect URL. A public
  integration is reviewed by Canva before anyone else can use it.
- **Dropbox** (no catalog entry yet; `dropbox`). dropbox.com/developers/apps →
  Create app → Scoped access, then App folder or Full Dropbox, and a name.
  Settings: the App key is the client ID, App secret the secret, and OAuth 2 →
  Redirect URIs → add it. Permissions: tick the scopes and Submit (scopes are
  fixed per token, so set them before anyone connects). A new app links up to
  50 people until you Apply for production.
- **Zoom** (no catalog entry yet; `zoom`). marketplace.zoom.us → Develop →
  Build App → General App (user-managed). Basic Information: Client ID and
  Client Secret (development and production have separate pairs; use
  production for real people), the OAuth Redirect URL, and the same URL in the
  OAuth Allow List. Scopes: add what its MCP server needs. Development
  credentials work only in your own Zoom account until the app is published
  through Zoom's review.

Then restart, and try the app once end to end (Connect, sign in, one read, one
write) before its id goes in `CONNECTORS_ENABLED_IDS` and its entry becomes
`verified: true`.
### More MCP apps: which to switch on

Vendors' own remote MCP servers, read 2026-10-22 (`catalog.ts` has each one's
docs page and what it says). Each signs in with the vendor's OAuth through
Tailzu's client document or dynamic client registration, which `oauth.ts`
already does: no keys, nothing to
register with the vendor. Each is off until its id is in
`CONNECTORS_ENABLED_IDS`.

| id | switch on | why |
| --- | --- | --- |
| `todoist` | now | The docs confirm the URL, Streamable HTTP and registration; a registration with Tailzu's details was accepted on 2026-10-22. |
| `granola` | now | The docs confirm all three. A free Granola plan sees only its last 30 days. |
| `evernote` | now | The docs confirm all three. In beta, and paid plans only: a free account is refused. |
| `monday` | live try first | The docs confirm all three, but until monday pre-approves Tailzu (its MCP integration form) each account's admin must approve it once; nobody else in that account can connect before that. |
| `clickup` | live try first | The docs give the URL and registration, not the transport; ClickUp's blog mentions an allowlist of vetted clients. No refresh token: "Sign in again" whenever one runs out. |
| `airtable`, `calendly` | live try first | The docs give the URL and registration, not the transport. |
| `calcom`, `fireflies`, `make`, `composio` | live try first | The docs don't say how a client registers; the live metadata offers registration. Make may hand back a client secret, which would be stored unencrypted with the client id. |
| `otter`, `pipedream` | live try first | Same, and the docs don't name the transport either. |
| `atlassian`, `trello` | live try first, likely refused | Atlassian's sign-in offers registration, but only from an allowed domain. Until Atlassian adds `api.tailzu.space` to its own list, each org's admin must add it (Atlassian Administration, Connectors, Atlassian MCP server); a person with no admin cannot connect. |

A try that passes means the id can go in. One that fails leaves it out; the
entry's `notes` say what to look at.

### Google Calendar, Google Docs and the email hand-off

These three are built into the server (`src/connectors/google/`), not MCP
servers, so there is nothing to try against a vendor's MCP endpoint: Google
Calendar and Google Docs call Google's REST APIs directly. They sit in the same
Connected apps list and use the same asks, approvals and audit.

**What the owner has already done** (same Google Cloud project as the Google
sign-in): the Calendar, Drive and Docs APIs are enabled, the web OAuth client
lists `https://api.tailzu.space/v1/connectors/callback` as an authorized redirect
URI (it must be exactly `CONNECTOR_REDIRECT_URL`), and the consent screen lists
the scopes `calendar.events`, `calendar.readonly` and `drive.file`. Sign-in is
untouched and never asks for them: they are asked only when someone taps
**Connect** on Google Calendar (calendar.events + calendar.readonly) or Google
Docs (drive.file). Gmail comes later.

1. **The two keys**, in `tulmi/.env`: the id and secret of a web OAuth client
   in that same project. Make one of its own: APIs & Services, Credentials,
   Create credentials, OAuth client ID, Web application, named "Tailzu
   Connected apps", with `https://api.tailzu.space/v1/connectors/callback` as
   its authorized redirect URI. Google shows the secret once, at creation:
   copy it (or download the JSON) then. Do not reset or delete the sign-in
   client's secret: Supabase's Google provider (Authentication, Sign In /
   Providers, Google) holds it, and the desktop, the website and Android's
   fallback sign in through it. The consent screen, its scopes and Google's
   review belong to the project, so they cover the new client too.

   ```
   GOOGLE_CONNECT_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CONNECT_CLIENT_SECRET=...
   ```

   Without both, the apps list but Connect answers "not set up" (503), and the
   server warns at start-up.
2. **Switch the apps on**: add them to `CONNECTORS_ENABLED_IDS`, e.g.
   `CONNECTORS_ENABLED_IDS=notion,linear,google-calendar,google-docs`, with
   `CONNECTORS=true` and the key/migration steps above. Then
   `docker compose up -d --build`. They are off until named here. Each can be
   switched on alone.
3. **The email hand-off needs nothing.** `email-handoff` is there whenever
   `CONNECTORS=true`, is not listed as an app, asks for no permission and sends
   nothing: it only has the desktop open Gmail's compose window with the email
   written, and the person presses Send. Ship the desktop build that handles the
   `open` event first: an older desktop speaks "I've written it in Gmail" and
   opens nothing. The other hand-offs are below.

**While Google reviews the Calendar scopes.** `calendar.events` and
`calendar.readonly` are *sensitive* scopes (`drive.file` is not), so until
Google approves them:

- Keep the consent screen in **Testing** and add each person who will use it
  under Audience, Test users (up to 100, by Google account email). Anyone else
  sees "Access blocked".
- In Testing, Google expires a refresh token after **7 days**: a test user is
  asked to "Sign in again" on the Google Calendar row about weekly. That
  stops once the app is published and verified.
- Publishing to Production before review works, with Google's "unverified app"
  warning and a 100-user cap on the sensitive scopes.
- The privacy policy linked on the consent screen must say what is read and
  that Google data is not used to train models or shown to anyone else
  (Google API Services User Data Policy, Limited Use).

**What to show in Google's review video** (one take, screen recording, English
narration; show the browser address bar on Google's consent page so the
client id is readable):

1. Open Tailzu, Connected apps, tap **Connect** on Google Calendar.
2. Google's consent page: the app name, the two Calendar permissions listed,
   **Continue**; the "You're connected" page; back in Tailzu the row shows
   Connected. Say why each scope is needed (calendar.events: add, move and
   delete events the person asks for; calendar.readonly: read the schedule and
   free/busy to find a time).
3. Ask aloud "what's on my calendar today": it answers from the real calendar.
4. Ask "put a call with <a test email> tomorrow at 4": the confirm card shows the
   exact invite and that Google will email the guest. Tap **Approve**; open
   Google Calendar to show the event, and the invite email in the guest's inbox.
   (Show **Not now** on a second request: nothing is created.)
5. Do the same for Google Docs ("save my last meeting note as a doc"): the card,
   Approve, the new Doc opened from the link; say it can only ever touch Docs
   Tailzu made (drive.file).
6. Back in Tailzu, **Disconnect** each app; show the row go to Not connected,
   and in the Google account's "Third-party apps with account access" page that
   Tailzu is gone (the grant is revoked when the last Google app is
   disconnected). The other Google apps are below.

### Google Tasks, Sheets, Forms, Classroom and YouTube

Built the same way as Calendar and Docs (`src/connectors/google/`): the same
web OAuth client and keys, the same **Connect** flow, the same asks,
approvals and audit. Each one is off until its id is in
`CONNECTORS_ENABLED_IDS`, and each asks for its own scopes only when someone
taps **Connect** on it. The scopes come from each method's own "Authorization
scopes" list in Google's API reference (read 2026-10-22), the smallest that
does the job.

1. **Turn on the APIs** in the same Google Cloud project (APIs & Services,
   Library): **Google Tasks API**, **Google Sheets API**, **Google Forms API**,
   **Google Classroom API** and **YouTube Data API v3**. The Drive API is
   already on for Docs; Sheets and Forms use it too, to find their own files
   by name.
2. **Add the scopes to the consent screen** (Google Auth Platform, Data
   Access):

   | app | id | scopes asked at Connect | Google's class |
   | --- | --- | --- | --- |
   | Google Tasks | `google-tasks` | `.../auth/tasks` | sensitive |
   | Google Sheets | `google-sheets` | `.../auth/drive.file` (already there for Docs) | non-sensitive |
   | Google Forms | `google-forms` | `.../auth/drive.file` (already there) | non-sensitive |
   | Google Classroom | `google-classroom` | `.../auth/classroom.courses.readonly`, `.../auth/classroom.coursework.me.readonly`, `.../auth/classroom.announcements.readonly` | sensitive |
   | YouTube | `google-youtube` | `.../auth/youtube` | sensitive |

   `drive.file` is documented as non-sensitive (Sheets scopes page, Drive
   scope guide). Google's API pages print no class for the Tasks, Classroom
   and YouTube scopes; Google counts scopes like these as sensitive, and the
   console marks each one when it is added: check "Your sensitive scopes"
   there. None of them is restricted.
   - **Sheets** needs only `drive.file`: spreadsheets.create,
     spreadsheets.values.append and .get all accept it. Tailzu can reach only
     the sheets it made.
   - **Forms** needs only `drive.file` too: forms.create, batchUpdate,
     setPublishSettings, get and responses.list all accept it, so neither
     `forms.body` nor `forms.responses.readonly` (both sensitive) is asked.
     Tailzu sees only the forms it made, and their answers.
   - **YouTube** asks `youtube`, not `youtube.readonly`: adding to a playlist
     (playlistItems.insert) accepts only `youtube`, `youtube.force-ssl` or
     `youtubepartner`, and `youtube` covers the searches and playlists too.
   - **Classroom** is read only: one read-only scope per call it makes
     (courses.list, courseWork.list with the person's own
     studentSubmissions.list, announcements.list).
3. **Switch them on**: add the ids to `CONNECTORS_ENABLED_IDS`, any of them
   alone, e.g.
   `CONNECTORS_ENABLED_IDS=notion,linear,google-calendar,google-docs,google-tasks,google-sheets,google-forms,google-classroom,google-youtube`,
   then `docker compose up -d --build`.
4. **Google's review.** The sensitive ones (Tasks, Classroom, YouTube) live
   under the same rules as Calendar's until Google approves them: Testing
   mode, listed test users, a "Sign in again" about weekly. Add them to the
   same verification request and the same video: for each, **Connect**, the
   consent page with its scopes (say why each is needed), one read, and for
   Tasks and YouTube one write through the confirm card and **Approve**
   ("remind me tomorrow to call the bank" then the task in Google Tasks;
   "add this video to my workout playlist" then the playlist), then
   **Disconnect**. Sheets and Forms ask nothing new.
5. **YouTube's quota.** search.list has its own bucket of **100 calls a day
   for the whole project** (not per person; it resets at midnight Pacific).
   After that a search answers "YouTube has done all it can for today. Try
   again tomorrow." playlistItems.insert costs 50 of the project's 10,000
   units a day, a playlist or video read 1. Ask Google for more (YouTube API
   quota extension form, which comes with a compliance audit) before telling
   many people. "Play X" never uses it: that is the play hand-off below.

| id | tools |
| --- | --- |
| `google-tasks` | `list_tasks(list?, due?)` read; `add_task(title, due?, notes?, list?)` write; `complete_task(task, list?)` write; `delete_task(task, list?)` destructive |
| `google-sheets` | `create_sheet(title, rows?)` write; `append_rows(sheet, rows)` write; `read_sheet(sheet)` read |
| `google-forms` | `create_form(title, questions[], description?)` write; `list_responses(form)` read |
| `google-classroom` | `my_classes()`, `whats_due(days?, class?)`, `announcements(class?)`, all read |
| `google-youtube` | `search_videos(query, max?)` read; `my_playlists()` read; `add_to_playlist(video, playlist)` write |

- **Days in the person's zone.** Tasks, Classroom and Forms say days and
  times in the zone the person names, else the zone set on their Google
  calendar when Google Calendar is switched on and connected (read once an
  hour with Calendar's own connection), else India's.
- **Google Tasks keeps the day, never the time** (the API cannot store one):
  "remind me tomorrow at 9" is a task due tomorrow with "At 09:00" in its
  notes, and Ask says so. Google Tasks will not ring at 9.
- **Sheets and Forms by name.** "my expenses sheet" is matched among the
  sheets Tailzu made (the 50 changed last); a link to anyone else's is "not
  one I made". Rows go in as typed values, never as formulas.
- **Forms** are made unpublished, get their questions, then are opened for
  answers (Google makes API forms unpublished by default since 2026-06-30).
  A choice question is single-choice, a text one short-answer. Nothing is
  sent to anyone: Ask gives the link to share.
- **Classroom** reports what is due only in classes the person is a student
  in. A school's Google Workspace admin can block third-party apps from
  Classroom data; then that school's accounts cannot connect. Personal Google
  accounts work.
- **Disconnect** forgets the token, and the one Google grant is revoked at
  Google only when no Google app of theirs still holds a token, counting
  apps switched off on the server since they connected them.

### The hand-offs: WhatsApp, calls, UPI, Maps and the rest

Built into the server (`src/connectors/handoffs/`), always on with
`CONNECTORS=true`, never listed as apps. **They need no keys, no sign-in and
no migration**, and nothing in `CONNECTORS_ENABLED_IDS`. Each one only writes a
link and has the person's own device open it with everything filled in; the
person presses Send, Call, Pay, Post or Book in the other app. Tailzu never
sends, calls or pays. They run only on a command ("tell Mom I'm on my way on
WhatsApp", not "how do I message Mom?") and never ask for an approval, since
nothing happens until the person finishes it there. Each one says one line as
it opens ("Rahul's chat is open with your message. Just hit Send.", in
Hinglish for a Hinglish profile).

| id | tools | link |
| --- | --- | --- |
| `whatsapp` | `send_message(text, phone?, name?)` | `https://wa.me/<digits>?text=` or, with no number, `https://wa.me/?text=` (WhatsApp's own chat picker). 10 digits are taken as +91. |
| `telegram` | `send_message(text, username?, name?)` | `https://t.me/<username>?text=` or `https://t.me/share/url?url=<message>` |
| `phone` | `call(number)`, `text(body, number?)` | `tel:`, `sms:<number>?body=` **phone only** |
| `upi` | `pay(vpa, amount, name?, note?)` | `upi://pay?pa=&pn=&am=&cu=INR&tn=` **phone only** |
| `maps` | `directions(destination, mode?)`, `search(query)` | `https://www.google.com/maps/dir/?api=1&destination=`, `https://www.google.com/maps/search/?api=1&query=` |
| `uber` | `ride(destination)` | `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=` |
| `shopping` | `amazon_search(query)`, `flipkart_search(query)` | `https://www.amazon.in/s?k=`, `https://www.flipkart.com/search?q=` |
| `play` | `youtube(query)`, `youtube_music(query)`, `spotify(query)` | `https://www.youtube.com/results?search_query=`, `https://music.youtube.com/search?q=`, `https://open.spotify.com/search/` |
| `threads` | `post(text)` | `https://www.threads.com/intent/post?text=` (500 characters at most) |
| `booking` | `hotels(city, checkin?, checkout?, guests?)` | `https://www.booking.com/searchresults.html?ss=&checkin=&checkout=&group_adults=&no_rooms=1` |

Every argument is percent-encoded and cut to a length the app takes, and every
link is checked against one list (`handoffs/links.ts`) before it leaves the
server: anything else is never sent. A link is at most 8000 characters (what
the desktop opens), a Google Maps one 2048 (Google's limit); a message, post or
email too long for its link once encoded (a long one in Hindi, whose letters
are nine characters each) is refused with "Ask me for a shorter one."

- **Phone only.** `tel:`, `sms:` and `upi:` links go only to a phone. Asked for
  on the desktop, Ask says "That one's for your phone. Ask me there." and opens
  nothing.
- **Never from another app's words.** Once a step has read another app
  (Classroom, YouTube, Notion), a hand-off that names a number, a Telegram
  username or a UPI ID opens only when the person said it themselves; one that
  appears only in what the app returned is refused ("I only fill in a number,
  username or UPI ID you give me... Who should it go to?"). Email recipients
  are not held to this.
- **UPI.** The person must give the payee's UPI ID (name@bank); with none, Ask
  asks for it. Some UPI apps decline a prefilled payment to a personal UPI ID
  (one that is not a merchant's), so a person-to-person payment may have to be
  finished by hand in the app. The PIN is always the person's, typed in their
  own UPI app; Tailzu fills in at most ₹1,00,000 and pays nothing.
- **What the vendors document** (read 2026-10-22): WhatsApp click to chat,
  Telegram's t.me links, Google Maps URLs, Threads Web Intents, `tel:`
  (RFC 3966), `sms:` (RFC 5724) and NPCI's UPI linking specification. **Not
  documented**, only each site's own search address: Amazon, Flipkart,
  YouTube, YouTube Music, Spotify and Booking.com. **Uber**: its page now
  documents `uber://?action=setPickup...` and `https://m.uber.com/looking?drop[0]=`
  with coordinates; the `m.uber.com/ul/` link with only an address is the older
  form. Try each hand-off once on a real Android phone and a real iPhone before
  telling anyone about it.
- **The desktop** opens only the Gmail and mailto: links today (agent.js
  `safeOpenUrl`): until a desktop build accepts the links above it says the
  line and logs "open skipped". Ship that build with or before this.
- **The phone** opens links through `openUrl`, which today allows https:,
  mailto:, tel: and sms: but not `upi:` (`app/src/security.ts`, `OPENABLE`):
  until a phone build adds it, a UPI hand-off says its line and then "Couldn't
  open link".

### Ask on the phone

`POST /v1/assistant/ask` `{ text, lang?, platform? }` answers
`{ say, open?: { url, label, fallback? }, taskId? }`: the same planner and
connected apps as the desktop's Ask, as a command, with no screen. The phone's
**Ask me** screen (`assistant_ask`, from Settings and from Connected apps) is
sent by the server like the rest: a field, the mic, **Do it**, and three
examples to tap. It shows `say`, opens `open.url`, and goes to the confirm
sheet when there is a `taskId`. It is there only while `CONNECTORS=true`
(otherwise the route answers 404 and the screen says Ask can't reach the
apps). It is held to Ask's rate limit (`AGENT_RATE_LIMIT_MAX` /
`AGENT_RATE_LIMIT_WINDOW_MS`) and the free plan's allowance, and metered like
an Ask step. A question back (the planner's, or a tool's, say for a UPI ID) is
kept for five minutes in the server's memory, so the person's next ask is read
as its answer, up to three questions in a row; a restart forgets it. The phone
opens an answer's link only if it is on the hand-off list (`openUrl` with
`handoff: true`, `isHandoffUrl` in `app/src/security.ts`); an older build
holds it to its general `openUrl` check.
