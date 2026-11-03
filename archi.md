# X0 Bot server: architecture

This repository is the server side of X0 Bot (the product was called Tulmi, then Tailzu, and the code still uses
those names in places). It is the brain behind the phone app (TAILZU-FRONTEND), the desktop app (TAILZU-DESKTOP)
and the website (TAILZU-WEB):

- **Writing.** Voice, typing and the screen go in; text written in the person's own voice comes out
  (speech-to-text, then a model through OpenRouter, shaped by the person's style portrait and the app they are in).
- **Server-driven UI.** Every screen of the phone and desktop apps, and the keyboards' configuration, is built
  here as JSON (a tree of SDUI nodes, `shared/types/sdui.ts`) and drawn by generic renderers in the apps, so the
  UI changes with a deploy instead of a store release.
- **The Bots app.** Bots for planning, travel, shopping, spaces shared with other people, Keybot (the keyboard),
  and a person's own bots, with their calendar, notes, files and connected apps (MCP).
- **Xode, the coding bot.** Connects a GitHub repo, builds a "project brain" of it, chats about the code, and runs
  jobs that change it (an agent loop with tools, a team of agents for larger work, PR care), on this server or on
  Cloudflare Workflows (`jobs/`), with commands run on the person's own computer or GitHub Actions.

Model providers are reached through one gateway each: OpenRouter for text (Anthropic, OpenAI, Google and others),
OpenAI, Groq, Sarvam and Deepgram for speech. Data lives in Supabase (Postgres, auth); blobs in R2.

## Repository layout

```
archi.md                 this file
README.md                what the repo is, quick start
DEPLOY.md                deploying to the VPS (and every optional service), step by step
THIRD_PARTY_NOTICES.md   licences of vendored material
.env.example             the server's settings, every one explained (copy to tulmi/.env); tulmi/.env.example points here
docker-compose.yml       the VPS: backend, optional media worker (profile media), optional Caddy (profile https)
.dockerignore            what the backend image is built from (tulmi/, shared/, three scripts run in the container)
.github/workflows/ci.yml typecheck, tests and build for tulmi/, jobs/ and viewer/; the Docker image build

tulmi/                   the server (Node 20+, TypeScript, Fastify): everything below "tulmi/src" in this file
jobs/                    Cloudflare Worker: Xode's jobs as Workflows, the cron ticker, the live session's Durable Objects
viewer/                  Cloudflare Worker: the artifact viewer, a sandboxed site that renders what bots make
media-worker/            Python service (FastAPI): office files, hard PDFs, pictures and video for the server
shared/types/            the wire contracts: api.ts (requests and responses), sdui.ts (screens, nodes, actions)
shared/bots/             the bots' looks and moments (looks.json) and sounds (sounds.json, sounds/*.m4a)
shared/prompts/          the screen reply's old prompt files, kept so REPLY_PROMPT_VERSION can roll back
deploy/                  ship.sh (the deploy), backup-db.sh (the nightly database backup to R2), Caddyfile, the desktop-release receiver, GitHub App helpers,
                         and the .well-known files for app links
docs/                    one document per subsystem (listed under "Where to find" below)
```

### tulmi/

```
tulmi/
  src/                   the server (below)
  tests/                 vitest suites, one per feature (*.test.ts) and shared rigs (*-rig.ts, fakes, fixtures)
  scripts/               tools run by hand: checks, generators, benches (listed in "Run, test, deploy")
  evals/                 model evals: evals/<role>.jsonl per prompt role, the agent bench (evals/agent), symbol and secret benches
  e2e/                   the reality check: real models on real repos (costs money; run deliberately, see e2e/README.md)
  supabase/              schema: migrations/ (applied in order), full_schema.sql, email templates
  fonts/ blip/ icons/    files the server serves as they are: typefaces, Blip's animations, connected apps' logos
  brand/                 art for media keys nothing has been uploaded to yet (the sign-in email's mark)
  media-seed/            rendered media and its manifest, published with scripts/seed-media.sh
  third_party/gitleaks/  the secret-scanning rules Xode uses (generated into code by scripts/gen-gitleaks.ts)
  Dockerfile             the production image (built from the repo root by docker-compose and CI)
```

### tulmi/src

```
server.ts          entry: builds the Fastify app, wires the services, registers every route module, boots
config.ts          every setting, read from the environment and validated (zod); getConfig()
domainHold.ts      imported first: the addresses a server keeps until the move to x0bot.com is done
domains.ts         the app's own domains
observability.ts   logging options and Sentry
prompts.ts         loads shared/prompts/ (the screen reply's rollback prompts)

http/              HTTP plumbing: error handling, request hooks (cost tally, HTML headers, JSON parser), plugins,
                   reply helpers, guarded() (idempotency and permits for routes that spend money)
routes/            one module per feature, each exporting register…Routes(app, deps)
  account/         account deletion, profile, personality, history, device link (QR sign-in), the review sign-in pair
  app/             the SDUI app (bootstrap, screen, cache), keyboard config and telemetry, live updates, media, static files
  ask/             POST /v1/ask, the desktop's on-screen agent (/v1/agent), the phone's Ask, the front door,
                   the one key's brain (/v1/ask/decide)
  billing/         the /pay page, Razorpay, RevenueCat and Razorpay webhooks
  bots/            the bots platform and every Bots app area (shell, You, bots, Keybot, code, first run, spaces,
                   trips, calendar, push ask, looks, sounds, safety, widgets), routines, the everyday tools' cards
  code/            Xode: projects, jobs, the Worker's internal calls
  connectors/      connected apps, apps added by link, the published OAuth client document
  site/            the website's endpoints: SEO pages, demo, download, legal pages (policies/, in the app's look), health
  writing/         transcribe (one-shot and live), refine, draft, edit, train, vocabulary, speak, voice sample
  artifacts.ts files.ts notes.ts   artifacts, uploaded files, the desktop's meeting notes

experience/        everything the apps draw, built as SDUI JSON
  screens.ts       buildScreen: the one entry for a screen (desk pages for a desktop that draws them, else the phone's)
  bootstrap/       buildBootstrap and what only it sends (start screen, push prompt, launch card, platform flags)
  phone/           the phone app: theme, navigation, shared parts, and one file per screen (you/, training/, onboarding/)
  desk/            the desktop window's pages, one file per page, with their kit, charts and time helpers
  bots/            the Bots app: kit.ts (its UI kit), screens/ (per area: <area>.ts lists its screens, <area>/ holds
                   one file per screen and parts.ts; small areas such as notes, routines are one file), looks, sounds,
                   live data; screens/finds.ts draws what the everyday tools found
  keyboard/        buildKeyboardConfig (GET /v1/keyboard/config): keys, tools row, mic
  assistant/       the phone's Connected apps, Tasks, approval sheet, Ask and the You card
  onboard/         the onboarding: sign-in stage, one file per step, the store builds' variant
  site/            the website's copy and layout (read by seo/)
  *.ts             parts several surfaces share: policy, media registry, cache version, i18n, title case,
                   personality presets, TTS voices, languages, app icons, Blip's loops, rollouts;
                   appKnobsData.ts and keyboardKnobsData.ts are GENERATED by scripts/sync-knobs.mjs

pipeline/          the writing pipeline
  cleanup.ts       the way in to the writers (assist, draftReply, editSelection, answerAbout, portraits, converse)
  writing/         one file per writer, plus the model call, output checks, snippets and slips
  stt.ts, stt/     speech-to-text: transcribe() and each engine, the prompt, duration probes, transcript checks
  assistPrompt.ts  the writer's data blocks; tts.ts, openrouter.ts, field.ts, compose.ts, session.ts, …
principles/        the prompt library: one role per model call (roles.ts), composed with compose()
agent/             the desktop's on-screen agent (Ask): one step, the planner, the resolver, risk; long jobs (docs/long-jobs.md)
askDecide/         the one key's brain: what the person meant by what they said, in any language (docs/ask-decide.md)
front/             the front door: one entry for a message, decided and dispatched (docs/front-door.md)
guard/             overload guards: limiter, breaker, coalescing, idempotency
code/              Xode (docs/code-*.md)
  brain/           model tiers, money, the gateway (callModel), classify and route
  project/         the project brain: scan, tree-sitter symbols, graph, summaries, the project book
  chat/            the code chat (look, answer, cite)
  agent/           the agent loop: phases, tools, checks, the orchestrator
  team/            several agents on one job
  jobs/            the job router and providers (the person's PC, GitHub Actions, the Worker hand-off)
  live/            the live session's shared logic (protocol, tickets, search, unpack); the Durable Objects are in jobs/
  work/ newproject/ prcare/ resources/ secrets/   locating code, starting projects, PR care, library research, secret scanning
  github.ts oauth.ts policy.ts projects.ts …      the GitHub App and sign-in, the permission tiers, projects
bots/              the bots platform: a bot's definition, store, keys, memory, tools, and running one (docs/bots.md)
routines/          routines: a bot does something on a schedule (reading the words, the store, the minute tick) (docs/routines.md)
everyday/          the everyday tools every fitting bot gets, free, no sign-in: flights (Kiwi.com), hotels (trivago),
                   currency (Frankfurter), weather (MET Norway) (docs/everyday.md)
botsBots/          the Bots app's own bots behind their screens: plan, travel, shop, spaces, threads, safety, usage
botsCode/          the Code bot's rules, intake and history as the Bots app keeps them
botsCodeWork/      a Xode job read for the Bots app's work screens
shell/             the Bots app's shell: the activity feed, search, events, sent asks
keybot/            Keybot (the keyboard as a bot): its preferences, stats and views
you/               the You area: settings, limits, spend, usage meter, billing, data export, account deletion sweep
calendar/          the person's own calendar and to-dos
notes/             meeting notes: speakers, organising, extraction, store
connectors/        connected apps over MCP: catalog, OAuth, egress guard, routing, tasks; google/ (native Google apps), handoffs/
artifacts/         things bots make (pages, components, diagrams): store, versions, edits, screenshots (docs/artifacts.md)
media/             files: sniffing, chunks, PDFs, tables, speech, the media worker client (docs/media.md)
web/               reading pages, searching (search/), research, the safe fetch guard, a headless browser (browser/)
places/            geocoding, travel times and weather for the travel bots
widgets/           home-screen widgets and Live Activities (glance, APNs)
push/              the push engine: plans, timing, Expo tokens
live/              live updates to every open device (WS /v1/live)
runs/              the Ask run ledger
control/           the control plane: live rules over every payload, edited at GET /admin
auth/              Supabase sessions, JWT checks, Sign in with Apple, device links
billing/           entitlements (RevenueCat) and Razorpay
usage/             metering, the allowance, request cost, keyboard telemetry
history/           what was written (store.ts) and the numbers from it (stats.ts)
personality/       the person's style profile (store.ts) and learning from use (learn.ts)
profile/           the profile row and the language a request is written in
seo/               the website's pages and facts (also written into TAILZU-WEB by scripts/sync-site.mts)
ads/               Meta and Google Tag Manager events
```

## Where to find

| Looking for | Where |
|---|---|
| A phone screen | `tulmi/src/experience/phone/<screen>.ts`; the id → builder table is `phone/screens.ts` |
| A desktop page | `tulmi/src/experience/desk/<page>.ts`; ids and tabs in `desk/screens.ts` |
| A Bots app screen | `tulmi/src/experience/bots/screens/<area>/<screen>.ts`, listed in `screens/<area>.ts`; ids in `bots/ids.ts`, entry `bots/index.ts` |
| The bootstrap | `tulmi/src/experience/bootstrap/bootstrap.ts` |
| The keyboard config | `tulmi/src/experience/keyboard/config.ts` |
| An SDUI node kind or action | `shared/types/sdui.ts` |
| A request/response shape | `shared/types/api.ts` |
| An API route | `tulmi/src/routes/<area>/<feature>.ts` (registered in `server.ts`) |
| Auth and sessions | `tulmi/src/auth/` (Supabase, JWT, Apple); device sign-in `routes/account/deviceLink.ts` |
| Payments | `tulmi/src/routes/billing/`, `tulmi/src/billing/`, `tulmi/src/you/billing.ts`; plans `experience/phone/paywall.ts` |
| Usage and limits | `tulmi/src/usage/`, `tulmi/src/you/` |
| The writing pipeline | `tulmi/src/pipeline/cleanup.ts` → `pipeline/writing/`; speech `pipeline/stt.ts` → `pipeline/stt/` |
| Prompts | `tulmi/src/principles/roles.ts` (docs/principles.md); evals in `tulmi/evals/<role>.jsonl` |
| Model gateway | Xode and the bots: `tulmi/src/code/brain/gateway.ts`; the writer: `pipeline/writing/model.ts`; Ask: `agent/llm.ts`; client `pipeline/openrouter.ts` |
| The bots platform | `tulmi/src/bots/` (docs/bots.md); the Bots app areas `botsBots/`, `botsCode/`, `shell/`, `keybot/`, `you/` (docs/bots-app.md) |
| Routines | `tulmi/src/routines/`, `routes/bots/routines.ts`, screens `experience/bots/screens/routines.ts` (docs/routines.md) |
| Everyday tools (flights, hotels, currency, weather) | `tulmi/src/everyday/`, the bot tools in `bots/tools.ts`, `routes/bots/everyday.ts`, cards `experience/bots/screens/finds.ts` (docs/everyday.md) |
| The website's own pages (privacy, terms, support, pricing, delete account) | `tulmi/src/routes/site/policies/` (their look in `policies/shell.ts`); the pay page `routes/billing/pay.ts` |
| Xode | `tulmi/src/code/` and `routes/code/`; jobs on Cloudflare in `jobs/` (docs/code-*.md, docs/cloudflare-jobs.md, docs/github-app.md) |
| Connected apps | `tulmi/src/connectors/` |
| Settings (env) | `tulmi/src/config.ts`, `.env.example` |
| Knobs (labels and flags the apps read) | generated `experience/appKnobsData.ts` and `keyboardKnobsData.ts`, merged in `experience/appKnobs.ts`; live rules in `control/` |
| Database | `tulmi/supabase/migrations/`, `tulmi/supabase/full_schema.sql` (docs/SUPABASE.md) |
| Deploy | `deploy/ship.sh`, `docker-compose.yml`, `tulmi/Dockerfile`, DEPLOY.md |
| Tests | `tulmi/tests/` (vitest), `jobs/test/` and `jobs/bundle-test/` (workerd), `viewer/unit`, `viewer/test`, `viewer/e2e`, `media-worker/tests` (pytest) |

## How the parts connect

**Entry points.** `tulmi/src/server.ts` is the server: `buildApp()` makes the Fastify instance (tests call it and
use `app.inject()`), and the block at the end listens and starts the push engine when not under test. The Docker
image runs `node dist/tulmi/src/server.js`. `jobs/src/index.ts` is the Cloudflare jobs Worker (it imports the
server's own code from `tulmi/src`), `viewer/src/index.ts` the artifact viewer Worker, and
`media-worker/app/main.py` the media worker.

**A request.** Fastify → the hooks in `src/http` (error handling, the request's cost tally, the JSON parser that
keeps signed webhook bodies) → the route module's handler, which resolves the user (`auth/supabase.ts`
`resolveUser`), checks the allowance (`usage/metering.ts` `enforceQuota`), calls the service (the writing
pipeline, Xode, the bots, connectors) and records usage. Routes that spend money run through `http/guarded.ts`.

**A screen.** The app calls `POST /v1/app/bootstrap` (`routes/app/appScreens.ts` → `experience/bootstrap`):
theme, navigation, flags, labels and the first screen id, filled out with every knob the app reads
(`appKnobs.ts`) and passed through the control plane's live rules. Each screen is `POST /v1/app/screen` →
`experience/screens.ts` `buildScreen`: a Bots app screen goes to `experience/bots`, a desktop that declares
`DeskShell` gets `experience/desk`, everything else `experience/phone/screens.ts`. The server only sends node kinds
the client declared in its capabilities. Keyboards fetch `GET /v1/keyboard/config` (`experience/keyboard`).
The media the screens name is resolved through `experience/mediaRegistry.ts`, set at boot from `routes/app/media.ts`.

**Background work.** Started in `server.ts` and stopped when the app closes: the push engine's ticker
(`push/`), the routines' minute tick (`routines/`), the run ledger's sweep (`runs/`), the media sweep, PR care's
sweep, the code copies' sweep, the MCP directory sync, the GitHub sign-in sweep, and Xode's job ticker
(`code/jobs/ticker.ts`, local mode). With `CODE_JOBS_MODE=cloudflare` the jobs run on the Worker instead: a
Workflow per job and per brain build, a cron trigger for the ticker, and two Durable Objects for the live session,
with signed calls both ways (`code/jobs/handoff/`).

## Contracts with the other repositories

- **API paths and shapes**: the apps call the routes under `/v1/…` with the shapes in `shared/types/api.ts`, and
  draw `shared/types/sdui.ts`. TAILZU-FRONTEND keeps a hand-synced copy (`app/src/sdui/types.ts`).
- **Knobs**: `node tulmi/scripts/sync-knobs.mjs <TAILZU-FRONTEND>/tools/knobs/app-knobs.json [keyboard-knobs.json]`
  writes `experience/appKnobsData.ts` and `experience/keyboardKnobsData.ts`.
- **The bots' looks and sounds**: TAILZU-FRONTEND and TAILZU-DESKTOP read `shared/bots/looks.json` and
  `shared/bots/sounds.json` (their tests check their copies against these).
- **Store screenshots**: TAILZU-FRONTEND's `tools/media/store/*.mts` import `tulmi/scripts/bots-render/render.ts`,
  `scripts/bots-render/samples/index.ts`, `src/experience/bots/index.ts`, `bots/fixtures.ts`, `bots/kit.ts`, and
  read `tulmi/blip/bots/`.
- **The website's head**: `tulmi/scripts/sync-site.mts` writes the SEO head of TAILZU-WEB's `index.html` from
  `src/seo/`.
- **Desktop releases**: TAILZU-DESKTOP's build workflow posts installers to `deploy/receive-download.sh`.
- **The desktop's layout**: `scripts/bots-render` and `scripts/make-blip-loops.ts` read TAILZU-DESKTOP's
  `src/app/app.html`, `src/app/sdui/*.js` and `src/shared/blip.js`.

## Run, test, deploy

- **Run**: `cd tulmi && npm install && npm run dev` (settings: copy `.env.example` to `tulmi/.env`;
  `DEV_SKIP_AUTH=true` runs without Supabase). More in `tulmi/README.md`.
- **Typecheck and test**: `cd tulmi && npx tsc --noEmit -p . && npx vitest run` (about 9,000 tests, a few
  minutes). `jobs/` and `viewer/` have their own `npx tsc --noEmit` and `npx vitest run`. CI runs all of it
  (`.github/workflows/ci.yml`). `tulmi/e2e` and the benches call paid models: run them deliberately
  (`tulmi/e2e/README.md`).
- **Deploy**: on the VPS the repo root is `~/tulmi`; `./deploy/ship.sh` pulls, rebuilds with docker compose and
  checks what matters is live. DEPLOY.md covers the first setup and every optional service (Caddy, the media
  worker, the jobs Worker, the GitHub App, push, payments). Database changes go through
  `tulmi/supabase/migrations/` (docs/SUPABASE.md).
- **Scripts run in the container**: `scripts/live-check.ts`, `scripts/speech-check.ts` and
  `scripts/apple-signin-check.ts` (`docker compose exec backend node dist/tulmi/scripts/<name>.js`; the
  `.dockerignore` lets these three into the image).
- **Other tools** (`tulmi/scripts/`): generators (`sync-knobs.mjs`, `gen-gitleaks.ts`, `gen-ts-queries.ts`,
  `make-app-icons.ts`, `make-blip-loops.ts`, `make-bot-sounds.py`, `make-bots-art.ts`), the render check and
  preview (`bots-render/`), the quality harness (`quality.sh`), prompt tools (`prompt-dump.ts`, `prompt-sizes.ts`,
  `eval-prompts.ts`), and operational helpers (`paylink.sh`, `paytest.sh`, `seed-media.sh`, `indexnow.sh`,
  `revoke-github-oauth.ts`, `smoke.ts`). Each says how to run it at its top.

## Documents

`docs/ARCHITECTURE.md` (the SDUI model and the keyboard), `docs/SUPABASE.md`, `docs/bots.md`, `docs/bots-app.md`,
`docs/bots-gaps.md`, `docs/bots-keybot-parity.md`, `docs/code-agent.md`, `docs/code-brain.md`, `docs/code-chat.md`,
`docs/code-project-brain.md`, `docs/code-router.md`, `docs/code-team.md`, `docs/code-work.md`,
`docs/cloudflare-jobs.md`, `docs/desktop-runner-session.md`, `docs/github-app.md`, `docs/pr-care.md`,
`docs/front-door.md`, `docs/ask-decide.md`, `docs/long-jobs.md`, `docs/principles.md`, `docs/routines.md`, `docs/everyday.md`, `docs/artifacts.md`,
`docs/media.md`, `docs/web-reader.md`, `docs/web-search.md`, `docs/widgets.md`, `docs/widget-glance-v2.md`, `docs/server-push-audit.md`,
`docs/domain-x0bot.md`, `docs/google-verification.md`, `docs/store-privacy.md` (the store privacy answers),
`viewer/docs/artifact-viewer.md`.
